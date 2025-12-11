// src/controllers/paymentsController.js
import {
  ddbDocClient,
  PutCommand,
  UpdateCommand,
  GetCommand,
  QueryCommand,
  ScanCommand
} from "../config/awsClients.js";

import Stripe from "stripe";
import { v4 as uuidv4 } from "uuid";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PAYMENTS_TABLE = process.env.PAYMENTS_TABLE || "go-live-payments";
const EVENTS_TABLE = process.env.EVENTS_TABLE_NAME || "go-live-poc-events";
const VIEWERS_TABLE = process.env.VIEWERS_TABLE_NAME || "go-live-viewers";

const nowISO = () => new Date().toISOString();

export default class PaymentsController {

  // ==========================================================
  // 1. CREATE STRIPE CHECKOUT SESSION (Viewer)
  // ==========================================================
  static async createSession(req, res) {
    try {
      const { eventId } = req.params;
      const viewer = req.viewer;

      if (!viewer?.viewerId) {
        return res.status(401).json({ message: "Invalid viewer token" });
      }

      // Fetch event
      const eventData = await ddbDocClient.send(
        new GetCommand({
          TableName: EVENTS_TABLE,
          Key: { eventId }
        })
      );

      const event = eventData.Item;
      if (!event) return res.status(404).json({ message: "Event not found" });

      if (event.accessMode !== "paidAccess") {
        return res.status(400).json({ message: "Event is not paid" });
      }

      const paymentId = uuidv4();
      const amount = Number(event.paymentAmount) * 100;

      // Create Stripe Checkout session
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: event.currency,
              product_data: { name: event.title },
              unit_amount: amount
            },
            quantity: 1
          }
        ],
        metadata: {
          paymentId,
          viewerId: viewer.viewerId,
          eventId
        },
        success_url: `${process.env.FRONTEND_URL}/event/${eventId}/payment-success`,
        cancel_url: `${process.env.FRONTEND_URL}/event/${eventId}/payment-cancel`
      });

      // Save DB entry
      await ddbDocClient.send(
        new PutCommand({
          TableName: PAYMENTS_TABLE,
          Item: {
            paymentId,
            eventId,
            viewerId: viewer.viewerId,
            amount: event.paymentAmount,
            currency: event.currency,
            status: "created",
            stripeCheckoutSessionId: session.id,
            stripePaymentIntentId: null,
            receiptUrl: null,
            createdAt: nowISO(),
            updatedAt: nowISO()
          }
        })
      );

      return res.status(200).json({
        success: true,
        sessionId: session.id,
        url: session.url
      });

    } catch (err) {
      console.error("Stripe session error:", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // ==========================================================
  // 2. STRIPE WEBHOOK (Server)
  // ==========================================================
  static async webhook(req, res) {
    try {
      const signature = req.headers["stripe-signature"];
      let event;

      try {
        event = stripe.webhooks.constructEvent(
          req.rawBody,
          signature,
          process.env.STRIPE_WEBHOOK_SECRET
        );
      } catch (err) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      if (event.type === "checkout.session.completed") {
        const data = event.data.object;

        const paymentId = data.metadata.paymentId;
        const viewerId = data.metadata.viewerId;
        const eventId = data.metadata.eventId;

        const intentId = data.payment_intent;

        // Retrieve receipt
        const intent = await stripe.paymentIntents.retrieve(intentId);
        const receiptUrl = intent?.charges?.data?.[0]?.receipt_url || null;

        // Update payment record
        await ddbDocClient.send(
          new UpdateCommand({
            TableName: PAYMENTS_TABLE,
            Key: { paymentId },
            UpdateExpression:
              "SET status = :s, stripePaymentIntentId = :pi, receiptUrl = :r, updatedAt = :u",
            ExpressionAttributeValues: {
              ":s": "succeeded",
              ":pi": intentId,
              ":r": receiptUrl,
              ":u": nowISO()
            }
          })
        );

        // Update viewer record → mark paid
        await ddbDocClient.send(
          new UpdateCommand({
            TableName: VIEWERS_TABLE,
            Key: { eventId, clientViewerId: viewerId },
            UpdateExpression:
              "SET isPaidViewer = :p, paymentStatus = :ps, lastPaymentId = :pid, updatedAt = :u",
            ExpressionAttributeValues: {
              ":p": true,
              ":ps": "success",
              ":pid": paymentId,
              ":u": nowISO()
            }
          })
        );
      }

      return res.status(200).json({ received: true });

    } catch (err) {
      console.error("Webhook handler error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ==========================================================
  // 3. CHECK PAYMENT STATUS (Viewer)
  // ==========================================================
  static async checkStatus(req, res) {
    try {
      const viewer = req.viewer;
      const { eventId } = req.params;

      if (!viewer) {
        return res.status(401).json({ success: false, message: "Invalid token" });
      }

      // Query payment history
      const result = await ddbDocClient.send(
        new QueryCommand({
          TableName: PAYMENTS_TABLE,
          IndexName: "eventId-viewerId-index",
          KeyConditionExpression: "eventId = :e AND viewerId = :v",
          ExpressionAttributeValues: {
            ":e": eventId,
            ":v": viewer.viewerId
          },
          ScanIndexForward: false,
          Limit: 1
        })
      );

      return res.status(200).json({
        success: true,
        payment: result.Items?.[0] || null
      });

    } catch (err) {
      console.error("Payment check error:", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // ==========================================================
  // 4. ADMIN — LIST PAYMENTS FOR EVENT
  // ==========================================================
  static async listForEvent(req, res) {
    try {
      const { eventId } = req.params;

      const result = await ddbDocClient.send(
        new QueryCommand({
          TableName: PAYMENTS_TABLE,
          IndexName: "eventId-index",
          KeyConditionExpression: "eventId = :e",
          ExpressionAttributeValues: { ":e": eventId }
        })
      );

      return res.status(200).json({
        success: true,
        payments: result.Items || []
      });

    } catch (err) {
      console.error("List payments error:", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // ==========================================================
  // 5. ADMIN — GET PAYMENT DETAIL
  // ==========================================================
  static async getPayment(req, res) {
    try {
      const { paymentId } = req.params;

      const record = await ddbDocClient.send(
        new GetCommand({
          TableName: PAYMENTS_TABLE,
          Key: { paymentId }
        })
      );

      return res.status(200).json({
        success: true,
        payment: record.Item || null
      });

    } catch (err) {
      console.error("Get payment error:", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
}
