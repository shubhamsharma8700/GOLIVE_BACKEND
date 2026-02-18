import {
  ddbDocClient,
  PutCommand,
  UpdateCommand,
  GetCommand,
  QueryCommand,
} from "../config/awsClients.js";

import Stripe from "stripe";
import { v4 as uuidv4 } from "uuid";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_PUBLISHABLE_KEY =
  process.env.STRIPE_PUBLISHABLE_KEY || process.env.PUBLISHABLE_KEY || null;

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;
let stripeAccountIdCache = null;

const PAYMENTS_TABLE = process.env.PAYMENTS_TABLE || "go-live-payments";
const EVENTS_TABLE = process.env.EVENTS_TABLE_NAME || "go-live-poc-events";
const VIEWERS_TABLE =
  process.env.VIEWERS_TABLE_NAME || "go-live-poc-viewers";

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

const nowISO = () => new Date().toISOString();

const STRIPE_SUCCESS_PAYMENT_STATUSES = new Set(["paid", "succeeded"]);

function getStripeConfigError() {
  if (!STRIPE_SECRET_KEY) {
    return "Missing STRIPE_SECRET_KEY in backend environment";
  }

  if (!STRIPE_SECRET_KEY.startsWith("sk_")) {
    return "Invalid STRIPE_SECRET_KEY format";
  }

  if (STRIPE_PUBLISHABLE_KEY && !STRIPE_PUBLISHABLE_KEY.startsWith("pk_")) {
    return "Invalid STRIPE_PUBLISHABLE_KEY format";
  }

  return null;
}

async function getStripeAccountIdSafe() {
  if (stripeAccountIdCache || !stripe) return stripeAccountIdCache;
  try {
    const account = await stripe.accounts.retrieve();
    stripeAccountIdCache = account?.id || null;
    return stripeAccountIdCache;
  } catch (err) {
    console.error("Failed to fetch Stripe account id:", err.message);
    return null;
  }
}

function sanitizeCurrency(currency) {
  return String(currency || "USD").toUpperCase();
}

function toMinorUnits(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

function mapCheckoutEventToStatus(stripeEventType, paymentStatus) {
  const normalizedPaymentStatus = String(paymentStatus || "").toLowerCase();

  if (
    stripeEventType === "checkout.session.async_payment_failed" ||
    stripeEventType === "checkout.session.expired"
  ) {
    return stripeEventType === "checkout.session.expired"
      ? "canceled"
      : "failed";
  }

  if (
    stripeEventType === "checkout.session.completed" ||
    stripeEventType === "checkout.session.async_payment_succeeded"
  ) {
    if (STRIPE_SUCCESS_PAYMENT_STATUSES.has(normalizedPaymentStatus)) {
      return "succeeded";
    }
    return "pending";
  }

  return "pending";
}

async function updateViewerPaymentState({
  eventId,
  clientViewerId,
  status,
  paymentId,
  createdAt,
  stripeCheckoutSessionId,
  stripePaymentIntentId,
}) {
  if (!eventId || !clientViewerId) return;

  const isPaid = status === "succeeded";

  await ddbDocClient.send(
    new UpdateCommand({
      TableName: VIEWERS_TABLE,
      Key: {
        eventId,
        clientViewerId,
      },
      UpdateExpression: `
        SET
          isPaidViewer = :isPaid,
          viewerpaid = :isPaid,
          paymentStatus = :status,
          lastPaymentId = :pid,
          lastPaymentCreatedAt = :createdAt,
          lastStripeCheckoutSessionId = :sessionId,
          lastStripePaymentIntentId = :intentId,
          updatedAt = :updatedAt
      `,
      ExpressionAttributeValues: {
        ":isPaid": isPaid,
        ":status": status,
        ":pid": paymentId || null,
        ":createdAt": createdAt || null,
        ":sessionId": stripeCheckoutSessionId || null,
        ":intentId": stripePaymentIntentId || null,
        ":updatedAt": nowISO(),
      },
    })
  );
}

async function getStripeIntentDetails(paymentIntentId) {
  if (!paymentIntentId) {
    return {
      receiptUrl: null,
      paymentMethodId: null,
      paymentMethodType: null,
      paymentMethodDetails: null,
    };
  }

  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ["latest_charge"],
  });

  const latestCharge = intent?.latest_charge || null;
  const paymentMethodDetails = latestCharge?.payment_method_details || null;

  return {
    receiptUrl: latestCharge?.receipt_url || null,
    paymentMethodId: intent?.payment_method || null,
    paymentMethodType: paymentMethodDetails?.type || null,
    paymentMethodDetails,
  };
}

export default class PaymentsController {
  static async createSession(req, res) {
    try {
      const stripeConfigError = getStripeConfigError();
      if (stripeConfigError || !stripe) {
        return res.status(500).json({
          success: false,
          message: stripeConfigError || "Stripe is not configured",
        });
      }

      const { eventId } = req.params;
      const viewer = req.viewer;

      if (!viewer?.clientViewerId) {
        return res.status(401).json({
          success: false,
          message: "Invalid viewer token",
        });
      }

      const { Item: event } = await ddbDocClient.send(
        new GetCommand({
          TableName: EVENTS_TABLE,
          Key: { eventId },
        })
      );

      if (!event) {
        return res.status(404).json({
          success: false,
          message: "Event not found",
        });
      }

      if (event.accessMode !== "paidAccess") {
        return res.status(400).json({
          success: false,
          message: "Event is not a paid event",
        });
      }

      if (typeof event.paymentAmount !== "number" || !event.currency) {
        return res.status(400).json({
          success: false,
          message: "Payment configuration missing",
        });
      }

      const { Item: viewerRecord } = await ddbDocClient.send(
        new GetCommand({
          TableName: VIEWERS_TABLE,
          Key: {
            eventId,
            clientViewerId: viewer.clientViewerId,
          },
        })
      );

      if (!viewerRecord) {
        return res.status(404).json({
          success: false,
          message: "Viewer registration not found",
        });
      }

      if (viewerRecord.isPaidViewer === true) {
        return res.status(200).json({
          success: true,
          message: "Viewer already paid",
          paymentStatus: "succeeded",
          alreadyPaid: true,
        });
      }

      const paymentId = uuidv4();
      const createdAt = nowISO();
      const amountInMinorUnits = toMinorUnits(event.paymentAmount);
      const currency = sanitizeCurrency(event.currency);

      if (!amountInMinorUnits) {
        return res.status(400).json({
          success: false,
          message: "Invalid payment amount configured",
        });
      }

      const session = await stripe.checkout.sessions.create(
        {
          payment_method_types: ["card"],
          mode: "payment",
          line_items: [
            {
              price_data: {
                currency,
                product_data: {
                  name: event.title || "Event Access",
                },
                unit_amount: amountInMinorUnits,
              },
              quantity: 1,
            },
          ],
          metadata: {
            paymentId,
            eventId,
            clientViewerId: viewer.clientViewerId,
            createdAt,
          },
          payment_intent_data: {
            metadata: {
              paymentId,
              eventId,
              clientViewerId: viewer.clientViewerId,
              createdAt,
            },
          },
          customer_email: viewerRecord.email || undefined,
          client_reference_id: `${eventId}:${viewer.clientViewerId}`,
          success_url: `${FRONTEND_URL}/player/${eventId}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${FRONTEND_URL}/player/${eventId}?payment=cancel`,
        },
        {
          idempotencyKey: paymentId,
        }
      );

      await ddbDocClient.send(
        new PutCommand({
          TableName: PAYMENTS_TABLE,
          Item: {
            paymentId,
            createdAt,
            eventId,
            clientViewerId: viewer.clientViewerId,
            amount: Number(event.paymentAmount),
            amountMinor: amountInMinorUnits,
            currency,
            status: "pending",
            stripeCheckoutSessionId: session.id,
            stripePaymentIntentId:
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : null,
            stripeEventType: "checkout.session.created",
            stripeSessionStatus: session.status || null,
            stripePaymentStatus: session.payment_status || null,
            stripeCustomerId:
              typeof session.customer === "string" ? session.customer : null,
            stripeCustomerEmail:
              session.customer_details?.email || viewerRecord.email || null,
            paymentMethodId: null,
            paymentMethodType: null,
            paymentMethodDetails: null,
            receiptUrl: null,
            failureReason: null,
            updatedAt: createdAt,
          },
        })
      );

      await updateViewerPaymentState({
        eventId,
        clientViewerId: viewer.clientViewerId,
        status: "pending",
        paymentId,
        createdAt,
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : null,
      });

      return res.status(200).json({
        success: true,
        paymentId,
        createdAt,
        status: "pending",
        sessionId: session.id,
        url: session.url,
        stripeAccountId: await getStripeAccountIdSafe(),
      });
    } catch (err) {
      console.error("createSession error:", err);
      return res.status(500).json({
        success: false,
        message: err.message,
      });
    }
  }

  static async webhook(req, res) {
    const stripeConfigError = getStripeConfigError();
    if (stripeConfigError || !stripe) {
      return res.status(500).json({
        success: false,
        message: stripeConfigError || "Stripe is not configured",
      });
    }

    let stripeEvent;

    try {
      const signature = req.headers["stripe-signature"];

      stripeEvent = stripe.webhooks.constructEvent(
        req.body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("Stripe signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      if (
        stripeEvent.type === "checkout.session.completed" ||
        stripeEvent.type === "checkout.session.async_payment_succeeded" ||
        stripeEvent.type === "checkout.session.async_payment_failed" ||
        stripeEvent.type === "checkout.session.expired"
      ) {
        const session = stripeEvent.data.object;
        const {
          paymentId,
          eventId,
          clientViewerId,
          createdAt,
        } = session.metadata || {};

        if (!paymentId || !createdAt) {
          return res.status(200).json({ received: true });
        }

        const paymentRecord = await ddbDocClient.send(
          new GetCommand({
            TableName: PAYMENTS_TABLE,
            Key: {
              paymentId,
              createdAt,
            },
          })
        );

        const payment = paymentRecord.Item;
        if (!payment) {
          return res.status(200).json({ received: true });
        }

        const mappedStatus = mapCheckoutEventToStatus(
          stripeEvent.type,
          session.payment_status
        );

        const stripePaymentIntentId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : null;

        const {
          receiptUrl,
          paymentMethodId,
          paymentMethodType,
          paymentMethodDetails,
        } = await getStripeIntentDetails(stripePaymentIntentId);

        const failureReason =
          mappedStatus === "failed"
            ? "Stripe checkout payment failed"
            : mappedStatus === "canceled"
              ? "Stripe checkout session expired"
              : null;

        await ddbDocClient.send(
          new UpdateCommand({
            TableName: PAYMENTS_TABLE,
            Key: {
              paymentId,
              createdAt,
            },
            UpdateExpression:
              "SET #s = :s, stripePaymentIntentId = :pi, stripeCheckoutSessionId = :si, stripeEventType = :et, stripeSessionStatus = :ss, stripePaymentStatus = :ps, stripeCustomerId = :cid, stripeCustomerEmail = :cem, paymentMethodId = :pmid, paymentMethodType = :pmt, paymentMethodDetails = :pmd, receiptUrl = :r, failureReason = :fr, updatedAt = :u",
            ExpressionAttributeNames: {
              "#s": "status",
            },
            ExpressionAttributeValues: {
              ":s": mappedStatus,
              ":pi": stripePaymentIntentId,
              ":si": session.id || null,
              ":et": stripeEvent.type,
              ":ss": session.status || null,
              ":ps": session.payment_status || null,
              ":cid":
                typeof session.customer === "string" ? session.customer : null,
              ":cem": session.customer_details?.email || null,
              ":pmid": paymentMethodId,
              ":pmt": paymentMethodType,
              ":pmd": paymentMethodDetails,
              ":r": receiptUrl,
              ":fr": failureReason,
              ":u": nowISO(),
            },
          })
        );

        await updateViewerPaymentState({
          eventId,
          clientViewerId,
          status: mappedStatus,
          paymentId,
          createdAt,
          stripeCheckoutSessionId: session.id || null,
          stripePaymentIntentId,
        });
      }

      if (stripeEvent.type === "payment_intent.payment_failed") {
        const intent = stripeEvent.data.object;
        const {
          paymentId,
          eventId,
          clientViewerId,
          createdAt,
        } = intent.metadata || {};

        if (!paymentId || !createdAt) {
          return res.status(200).json({ received: true });
        }

        await ddbDocClient.send(
          new UpdateCommand({
            TableName: PAYMENTS_TABLE,
            Key: {
              paymentId,
              createdAt,
            },
            UpdateExpression:
              "SET #s = :s, stripePaymentIntentId = :pi, stripeEventType = :et, stripePaymentStatus = :ps, failureReason = :fr, updatedAt = :u",
            ExpressionAttributeNames: {
              "#s": "status",
            },
            ExpressionAttributeValues: {
              ":s": "failed",
              ":pi": intent.id || null,
              ":et": stripeEvent.type,
              ":ps": intent.status || "failed",
              ":fr":
                intent.last_payment_error?.message ||
                "Payment failed at Stripe",
              ":u": nowISO(),
            },
          })
        );

        await updateViewerPaymentState({
          eventId,
          clientViewerId,
          status: "failed",
          paymentId,
          createdAt,
          stripeCheckoutSessionId: null,
          stripePaymentIntentId: intent.id || null,
        });
      }

      return res.status(200).json({ received: true });
    } catch (err) {
      console.error("Webhook processing error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  static async checkStatus(req, res) {
    try {
      const { eventId } = req.params;
      const viewer = req.viewer;

      if (!viewer?.clientViewerId) {
        return res.status(401).json({
          success: false,
          message: "Invalid viewer token",
        });
      }

      const result = await ddbDocClient.send(
        new QueryCommand({
          TableName: PAYMENTS_TABLE,
          IndexName: "eventId-clientViewerId-index",
          KeyConditionExpression: "eventId = :e AND clientViewerId = :v",
          ExpressionAttributeValues: {
            ":e": eventId,
            ":v": viewer.clientViewerId,
          },
          ScanIndexForward: false,
          Limit: 1,
        })
      );

      const { Item: viewerRecord } = await ddbDocClient.send(
        new GetCommand({
          TableName: VIEWERS_TABLE,
          Key: {
            eventId,
            clientViewerId: viewer.clientViewerId,
          },
        })
      );

      return res.status(200).json({
        success: true,
        payment: result.Items?.[0] || null,
        paymentStatus: viewerRecord?.paymentStatus || "none",
        isPaidViewer: Boolean(viewerRecord?.isPaidViewer),
        viewerpaid: Boolean(viewerRecord?.viewerpaid),
      });
    } catch (err) {
      console.error("checkStatus error:", err);
      return res.status(500).json({
        success: false,
        message: err.message,
      });
    }
  }

  static async listForEvent(req, res) {
    try {
      const { eventId } = req.params;

      const result = await ddbDocClient.send(
        new QueryCommand({
          TableName: PAYMENTS_TABLE,
          IndexName: "eventId-index",
          KeyConditionExpression: "eventId = :e",
          ExpressionAttributeValues: {
            ":e": eventId,
          },
        })
      );

      return res.status(200).json({
        success: true,
        payments: result.Items || [],
      });
    } catch (err) {
      console.error("listForEvent error:", err);
      return res.status(500).json({
        success: false,
        message: err.message,
      });
    }
  }

  static async getPayment(req, res) {
    try {
      const { paymentId } = req.params;
      const createdAt = req.params.createdAt || req.query.createdAt;

      if (!paymentId) {
        return res.status(400).json({
          success: false,
          message: "paymentId required",
        });
      }

      let payment = null;

      if (createdAt) {
        const record = await ddbDocClient.send(
          new GetCommand({
            TableName: PAYMENTS_TABLE,
            Key: {
              paymentId,
              createdAt,
            },
          })
        );
        payment = record.Item || null;
      } else {
        const result = await ddbDocClient.send(
          new QueryCommand({
            TableName: PAYMENTS_TABLE,
            KeyConditionExpression: "paymentId = :pid",
            ExpressionAttributeValues: {
              ":pid": paymentId,
            },
            ScanIndexForward: false,
            Limit: 1,
          })
        );
        payment = result.Items?.[0] || null;
      }

      return res.status(200).json({
        success: true,
        payment,
      });
    } catch (err) {
      console.error("getPayment error:", err);
      return res.status(500).json({
        success: false,
        message: err.message,
      });
    }
  }
}
