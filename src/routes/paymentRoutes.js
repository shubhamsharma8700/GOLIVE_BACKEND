// src/routes/payments.routes.js
import express from "express";
import PaymentsController from "../controllers/paymentsController.js";
import viewerAuth from "../middleware/viewerAuth.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Payments
 *   description: Stripe payment APIs and viewer purchase verification
 */

/* ======================================================================
   1. CREATE STRIPE CHECKOUT SESSION (Viewer)
   ====================================================================== */
/**
 * @swagger
 * /api/payments/{eventId}/create-session:
 *   post:
 *     summary: Create a Stripe Checkout Session for the event
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     description: |
 *       Viewer must already be registered for the event and authenticated via viewerAuth.  
 *       Returns a Stripe Checkout URL.
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Stripe session created
 *       401:
 *         description: Unauthorized viewer
 *       400:
 *         description: Invalid event or event is not paid
 *       500:
 *         description: Stripe error or server error
 */
router.post(
  "/:eventId/create-session",
  viewerAuth,
  PaymentsController.createSession
);

/* ======================================================================
   2. STRIPE WEBHOOK (Server → GoLive Backend)
   ====================================================================== */
/**
 * @swagger
 * /api/payments/stripe/webhook:
 *   post:
 *     summary: Stripe webhook endpoint for payment events
 *     tags: [Payments]
 *     description: |
 *       Stripe calls this endpoint automatically.  
 *       Must NOT be protected by viewer or admin auth.  
 *       Uses raw body for signature verification.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Webhook processed successfully
 *       400:
 *         description: Invalid webhook signature
 */
router.post(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  PaymentsController.webhook
);

/* ======================================================================
   3. CHECK PAYMENT STATUS (Viewer)
   ====================================================================== */
/**
 * @swagger
 * /api/payments/{eventId}/verify:
 *   get:
 *     summary: Check if viewer has paid for the event
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payment status returned
 *       401:
 *         description: Unauthorized viewer token
 */
router.get(
  "/:eventId/verify",
  viewerAuth,
  PaymentsController.checkStatus
);

/* ======================================================================
   4. ADMIN — LIST PAYMENTS FOR EVENT
   ====================================================================== */
/**
 * @swagger
 * /api/payments/{eventId}/list:
 *   get:
 *     summary: Admin — View all payments for an event
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of payments for the event
 */
router.get(
  "/:eventId/list",
  requireAuth,
  PaymentsController.listForEvent
);

/* ======================================================================
   5. ADMIN — PAYMENT DETAILS
   ====================================================================== */
/**
 * @swagger
 * /api/payments/detail/{paymentId}:
 *   get:
 *     summary: Admin — Get payment detail by paymentId
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: paymentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payment details returned
 */
router.get(
  "/detail/:paymentId",
  requireAuth,
  PaymentsController.getPayment
);

export default router;
