import {
  ddbDocClient,
  PutCommand,
  UpdateCommand,
  GetCommand,
  QueryCommand,
} from "../config/awsClients.js";

import Stripe from "stripe";
import { v4 as uuidv4 } from "uuid";
import { sendPasswordFromServer } from "../utils/sendPasswordFromServer.js";

/* =========================================================
   STRIPE
========================================================= */
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/* =========================================================
   TABLES
========================================================= */
const PAYMENTS_TABLE =
  process.env.PAYMENTS_TABLE || "go-live-payments";

const EVENTS_TABLE =
  process.env.EVENTS_TABLE_NAME || "go-live-poc-events";

const VIEWERS_TABLE =
  process.env.VIEWERS_TABLE_NAME || "go-live-poc-viewers";

const FRONTEND_URL =
  process.env.FRONTEND_URL || "http://localhost:5173";

const nowISO = () => new Date().toISOString();

/* =========================================================
   PAYMENTS CONTROLLER
========================================================= */
export default class PaymentsController {

  /* ======================================================
     1️⃣ CREATE STRIPE CHECKOUT SESSION (VIEWER)
     ====================================================== */
  static async createSession(req, res) {
    try {
      const { eventId } = req.params;
      const viewer = req.viewer;

      if (!viewer?.clientViewerId) {
        return res.status(401).json({
          success: false,
          message: "Invalid viewer token",
        });
      }

      /* ---------- Fetch Event ---------- */
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

      if (
        typeof event.paymentAmount !== "number" ||
        !event.currency
      ) {
        return res.status(400).json({
          success: false,
          message: "Payment configuration missing",
        });
      }

      /* ---------- Create Payment ---------- */
      const paymentId = uuidv4();
      const createdAt = nowISO();
      const amountInMinorUnits = Math.round(event.paymentAmount * 100);

      const session = await stripe.checkout.sessions.create(
        {
          payment_method_types: ["card"],
          mode: "payment",
          line_items: [
            {
              price_data: {
                currency: event.currency,
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
          success_url: `${FRONTEND_URL}/player/${eventId}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${FRONTEND_URL}/player/${eventId}?payment=cancel`,

        },
        {
          idempotencyKey: paymentId,
        }
      );

      /* ---------- Persist Payment ---------- */
      await ddbDocClient.send(
        new PutCommand({
          TableName: PAYMENTS_TABLE,
          Item: {
            paymentId,
            createdAt,
            eventId,
            clientViewerId: viewer.clientViewerId,
            amount: event.paymentAmount,
            currency: event.currency,
            status: "created",
            stripeCheckoutSessionId: session.id,
            stripePaymentIntentId: null,
            receiptUrl: null,
            updatedAt: createdAt,
          },
        })
      );

      return res.status(200).json({
        success: true,
        sessionId: session.id,
        url: session.url,
      });

    } catch (err) {
      console.error("createSession error:", err);
      return res.status(500).json({
        success: false,
        message: err.message,
      });
    }
  }

  /* ======================================================
     2️⃣ STRIPE WEBHOOK (SERVER ONLY)
     ====================================================== */
  static async webhook(req, res) {
    let stripeEvent;

    try {
      const signature = req.headers["stripe-signature"];

      stripeEvent = stripe.webhooks.constructEvent(
        req.body, // RAW BUFFER (because express.raw)
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("Stripe signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      if (stripeEvent.type === "checkout.session.completed") {
        const session = stripeEvent.data.object;

        const {
          paymentId,
          eventId,
          clientViewerId,
          createdAt,
        } = session.metadata || {};

        if (!paymentId || !createdAt) {
          console.warn("Missing payment metadata");
          return res.status(200).json({ received: true });
        }

        // ✅ Correct lookup (PK + SK)
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

        if (!payment || payment.status === "succeeded") {
          return res.status(200).json({ received: true });
        }

        let receiptUrl = null;
        if (session.payment_intent) {
          const intent = await stripe.paymentIntents.retrieve(
            session.payment_intent
          );
          receiptUrl =
            intent?.charges?.data?.[0]?.receipt_url || null;
        }

        // ✅ Update payment
        await ddbDocClient.send(
          new UpdateCommand({
            TableName: PAYMENTS_TABLE,
            Key: {
              paymentId,
              createdAt,
            },
            UpdateExpression:
              "SET #s = :s, stripePaymentIntentId = :pi, receiptUrl = :r, updatedAt = :u",
            ExpressionAttributeNames: {
              "#s": "status",
            },
            ExpressionAttributeValues: {
              ":s": "succeeded",
              ":pi": session.payment_intent,
              ":r": receiptUrl,
              ":u": nowISO(),
            },
          })
        );

        // ✅ Grant viewer access
        await ddbDocClient.send(
          new UpdateCommand({
            TableName: VIEWERS_TABLE,
            Key: {
              eventId,
              clientViewerId,
            },
            UpdateExpression:
              "SET isPaidViewer = :p, paymentStatus = :ps, lastPaymentId = :pid, updatedAt = :u",
            ExpressionAttributeValues: {
              ":p": true,
              ":ps": "success",
              ":pid": paymentId,
              ":u": nowISO(),
            },
          })
        );

        // Send password if event requires it
        if (event.requirePasswordForPaidAccess && event.accessPassword && viewer.email) {
          await sendPasswordFromServer({
            eventId,
            email: viewer.email,
            firstName: viewer.name || "",
            password: event.accessPassword,
            eventTitle: event.title,
          });
        }
      }

      return res.status(200).json({ received: true });

    } catch (err) {
      console.error("Webhook processing error:", err);
      return res.status(500).json({ error: err.message });
    }
  }


  /* ======================================================
     3️⃣ CHECK PAYMENT STATUS (VIEWER)
     ====================================================== */
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
          KeyConditionExpression:
            "eventId = :e AND clientViewerId = :v",
          ExpressionAttributeValues: {
            ":e": eventId,
            ":v": viewer.clientViewerId,
          },
          ScanIndexForward: false,
          Limit: 1,
        })
      );

      return res.status(200).json({
        success: true,
        payment: result.Items?.[0] || null,
      });

    } catch (err) {
      console.error("checkStatus error:", err);
      return res.status(500).json({
        success: false,
        message: err.message,
      });
    }
  }

  /* ======================================================
     4️⃣ ADMIN — LIST PAYMENTS FOR EVENT
     ====================================================== */
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

  /* ======================================================
     5️⃣ ADMIN — GET PAYMENT DETAIL
     ====================================================== */
  static async getPayment(req, res) {
    try {
      const { paymentId, createdAt } = req.params;

      if (!paymentId || !createdAt) {
        return res.status(400).json({
          success: false,
          message: "paymentId and createdAt required",
        });
      }

      const record = await ddbDocClient.send(
        new GetCommand({
          TableName: PAYMENTS_TABLE,
          Key: {
            paymentId,
            createdAt,
          },
        })
      );

      return res.status(200).json({
        success: true,
        payment: record.Item || null,
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
