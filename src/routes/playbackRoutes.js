import express from "express";
import PlaybackController from "../controllers/playbackController.js";
import viewerAuth from "../middleware/viewerAuth.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Playback
 *   description: End-user playback & access APIs
 */

/* ============================================================
   1. GET ACCESS CONFIG (public)
   ============================================================ */
/**
 * @swagger
 * /api/playback/event/{eventId}/access:
 *   get:
 *     summary: Get access configuration for an event
 *     description: 
 *       Returns the accessMode (free/email/password/paid), required form fields, and whether password is required.
 *     tags: [Playback]
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Access configuration returned
 *       404:
 *         description: Event not found
 */
router.get("/event/:eventId/access", PlaybackController.getAccessConfig);


/* ============================================================
   2. REGISTER VIEWER (public)
   ============================================================ */
/**
 * @swagger
 * /api/playback/event/{eventId}/register:
 *   post:
 *     summary: Register a viewer for the event
 *     description: 
 *       Creates a viewer record and issues a viewerToken.  
 *       Used for open, email-access, password-access and paid events.
 *     tags: [Playback]
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               clientViewerId: { type: string }
 *               formData: { type: object }
 *               name: { type: string }
 *               email: { type: string }
 *               deviceInfo: { type: object }
 *     responses:
 *       201: { description: Viewer registered }
 *       404: { description: Event not found }
 */
router.post("/event/:eventId/register", PlaybackController.registerViewer);


/* ============================================================
   3. VERIFY PASSWORD (public)
   ============================================================ */
/**
 * @swagger
 * /api/playback/event/{eventId}/verify-password:
 *   post:
 *     summary: Verify event password for password-protected events
 *     description:
 *       Validates the password and enables viewer access.
 *     tags: [Playback]
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [viewerToken, password]
 *             properties:
 *               viewerToken: { type: string }
 *               password: { type: string }
 *     responses:
 *       200: { description: Password verified }
 *       401: { description: Invalid password }
 */
router.post("/event/:eventId/verify-password", PlaybackController.verifyPassword);


/* ============================================================
   4. GET STREAM URL (requires viewerAuth)
   ============================================================ */
/**
 * @swagger
 * /api/playback/event/{eventId}/stream:
 *   get:
 *     summary: Get streaming playback URL
 *     description:
 *       Returns CloudFront/Mediapackage HLS URL if viewer is authorized.
 *     tags: [Playback]
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string }
 *     security:
 *       - bearerAuth: []  # viewerToken is provided here
 *     responses:
 *       200:
 *         description: Stream URL returned
 *       401:
 *         description: Invalid or missing viewer token
 *       403:
 *         description: Viewer not verified or not authorized
 */
router.get("/event/:eventId/stream", viewerAuth, PlaybackController.getStream);


/* ============================================================
   5. SESSION LOGGING (analytics)
   ============================================================ */
/**
 * @swagger
 * /api/playback/event/{eventId}/session:
 *   post:
 *     summary: Log playback session (start/end)
 *     tags: [Playback]
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [action, viewerToken]
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [start, end]
 *               sessionId: 
 *                 type: string
 *               viewerToken:
 *                 type: string
 *               deviceInfo:
 *                 type: object
 *               duration:
 *                 type: number
 *               endTime:
 *                 type: string
 *     responses:
 *       200: { description: Session updated }
 *       201: { description: Session started }
 */
router.post("/event/:eventId/session", PlaybackController.logSession);


export default router;
