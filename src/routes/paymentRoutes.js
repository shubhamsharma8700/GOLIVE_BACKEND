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

/**
 * @swagger
 * /api/payments/{eventId}/create-session:
 *   post:
 *     summary: Create a Stripe Checkout Session for the event
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
 *         description: Stripe session created
 */
router.post("/:eventId/create-session", viewerAuth, PaymentsController.createSession);

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
 */
router.get("/:eventId/verify", viewerAuth, PaymentsController.checkStatus);

/**
 * @swagger
 * /api/payments/{eventId}/list:
 *   get:
 *     summary: Admin - View all payments for an event
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
router.get("/:eventId/list", requireAuth, PaymentsController.listForEvent);

/**
 * @swagger
 * /api/payments/detail/{paymentId}:
 *   get:
 *     summary: Admin - Get payment detail by paymentId
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: paymentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: createdAt
 *         required: false
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payment details returned
 */
router.get("/detail/:paymentId", requireAuth, PaymentsController.getPayment);

export default router;
