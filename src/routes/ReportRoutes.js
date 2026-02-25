import express from "express";
import { getAnalyticsByEventId } from "../controllers/ReportController.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Reports
 *   description: Analytics report APIs
 */

/**
 * @swagger
 * /api/analyticsReport:
 *   post:
 *     summary: Get analytics report for an event or all events
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               eventId:
 *                 type: string
 *                 description: Event ID to filter analytics (omit for all events)
 *     responses:
 *       200:
 *         description: Analytics report returned
 *       401:
 *         description: Unauthorized
 */
// Handles both cases automatically
router.post("/", requireAuth, getAnalyticsByEventId);

export default router;
