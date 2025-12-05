import express from "express";
import AnalyticsController from "../controllers/analyticsController.js";
import { requireAuth } from "../middleware/auth.js";
import viewerAuth from "../middleware/viewerAuth.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Analytics
 *   description: Event analytics and viewer statistics
 */

/**
 * @swagger
 * /api/analytics/session:
 *   post:
 *     summary: Ingest or update a viewer session analytics record
 *     description: Called by the player to create or update a viewer session in the analytics table.
 *     tags: [Analytics]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sessionId
 *               - eventId
 *               - startTime
 *             properties:
 *               sessionId:
 *                 type: string
 *                 description: Unique id for this viewer session
 *               eventId:
 *                 type: string
 *                 description: Event id this session belongs to
 *               viewerId:
 *                 type: string
 *                 description: Optional viewer/user id
 *               startTime:
 *                 type: string
 *                 format: date-time
 *                 description: Session start time in ISO format
 *               endTime:
 *                 type: string
 *                 format: date-time
 *                 description: Session end time in ISO format
 *               durationSec:
 *                 type: number
 *                 description: Total watched duration in seconds
 *               isPaidViewer:
 *                 type: boolean
 *               deviceInfo:
 *                 type: object
 *                 properties:
 *                   deviceType:
 *                     type: string
 *                   os:
 *                     type: string
 *                   browser:
 *                     type: string
 *               location:
 *                 type: object
 *                 properties:
 *                   country:
 *                     type: string
 *                   city:
 *                     type: string
 *               network:
 *                 type: object
 *                 properties:
 *                   bandwidthKbps:
 *                     type: number
 *               meta:
 *                 type: object
 *                 additionalProperties: true
 *     responses:
 *       200:
 *         description: Session analytics recorded
 *       400:
 *         description: Missing or invalid fields
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
// Use viewer-level auth for ingestion so player clients can send analytics
// without requiring full admin credentials.
router.post("/session", viewerAuth, AnalyticsController.upsertSession);

/**
 * @swagger
 * /api/analytics/{eventId}/summary:
 *   get:
 *     summary: Get analytics summary for an event
 *     description: Returns KPI tiles and time-series analytics for a specific event over a given time range.
 *     tags: [Analytics]
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the event to get analytics for
 *       - in: query
 *         name: range
 *         required: false
 *         schema:
 *           type: string
 *           enum: ["1h", "24h", "7d"]
 *           default: "24h"
 *         description: Time range to aggregate over
 *     responses:
 *       200:
 *         description: Analytics summary for the event
 *       400:
 *         description: Invalid eventId or parameters
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get(
  "/:eventId/summary",
  requireAuth,
  AnalyticsController.getEventSummary
);

/**
 * @swagger
 * /api/analytics/{eventId}/recent-sessions:
 *   get:
 *     summary: Get recent viewer sessions for an event
 *     description: Returns a list of recent viewer sessions for an event.
 *     tags: [Analytics]
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the event to get sessions for
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           default: 50
 *           minimum: 1
 *           maximum: 200
 *         description: Maximum number of sessions to return
 *     responses:
 *       200:
 *         description: List of recent sessions
 *       400:
 *         description: Invalid eventId
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get(
  "/:eventId/recent-sessions",
  requireAuth,
  AnalyticsController.getRecentSessions
);

export default router;
