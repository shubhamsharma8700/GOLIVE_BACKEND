import express from "express";
import AnalyticsController from "../controllers/analyticsController.js";
import { requireAuth } from "../middleware/auth.js";
import viewerAuth from "../middleware/viewerAuth.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Analytics
 *     description: Event analytics and viewer session tracking
 */

/* ========================================================================
   1. SESSION START (Player → onPlay)
   ======================================================================== */
/**
 * @swagger
 * /api/analytics/{eventId}/session/start:
 *   post:
 *     summary: Start a viewer playback session
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     description: |
 *       Viewer must be authenticated using viewerAuth.  
 *       Creates a session record in the analytics table.
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         description: Event ID
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               playbackType:
 *                 type: string
 *                 enum: [live, vod]
 *               deviceInfo:
 *                 type: object
 *               location:
 *                 type: object
 *     responses:
 *       200:
 *         description: Session created
 */
router.post(
  "/:eventId/session/start",
  viewerAuth,
  AnalyticsController.startSession
);

/* ========================================================================
   2. SESSION END (Player → onPause / onEnded)
   ======================================================================== */
/**
 * @swagger
 * /api/analytics/session/end:
 *   post:
 *     summary: End a playback session
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     description: Marks the session as completed.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId]
 *             properties:
 *               sessionId:
 *                 type: string
 *               duration:
 *                 type: number
 *     responses:
 *       200:
 *         description: Session ended
 */
router.post("/session/end", viewerAuth, AnalyticsController.endSession);

/* ========================================================================
   3. HEARTBEAT (Every 30 seconds)
   ======================================================================== */
/**
 * @swagger
 * /api/analytics/session/heartbeat:
 *   post:
 *     summary: Increment watch-time
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     description: Called by player every 30 seconds to add watch-time.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, seconds]
 *             properties:
 *               sessionId:
 *                 type: string
 *               seconds:
 *                 type: number
 *                 description: Time to add
 *     responses:
 *       200:
 *         description: Updated duration
 */
router.post(
  "/session/heartbeat",
  viewerAuth,
  AnalyticsController.heartbeat
);

/* ========================================================================
   4. ADMIN: EVENT ANALYTICS SUMMARY
   ======================================================================== */
/**
 * @swagger
 * /api/analytics/{eventId}/summary:
 *   get:
 *     summary: Get analytics summary for an event
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     description: Returns totals, averages, and engagement stats.
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: range
 *         schema:
 *           type: string
 *           enum: [1h, 24h, 7d]
 *     responses:
 *       200:
 *         description: Event analytics summary
 */
router.get(
  "/:eventId/summary",
  requireAuth,
  AnalyticsController.getEventSummary
);

/* ========================================================================
   5. ADMIN: RECENT SESSIONS
   ======================================================================== */
/**
 * @swagger
 * /api/analytics/{eventId}/recent-sessions:
 *   get:
 *     summary: Recent viewer sessions
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: number
 *           default: 50
 *       - in: query
 *         name: lastKey
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of sessions
 */
router.get(
  "/:eventId/recent-sessions",
  requireAuth,
  AnalyticsController.getRecentSessions
);

export default router;
