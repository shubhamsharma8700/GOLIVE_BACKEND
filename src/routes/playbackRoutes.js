import express from "express";
import PlaybackController from "../controllers/playbackController.js";
import viewerAuth from "../middleware/viewerAuth.js";

const router = express.Router();

/**
 * @swagger
 * /api/playback/event/{eventId}/stream:
 *   get:
 *     summary: Get playback stream URL for an authorized viewer
 *     description: Requires a valid viewer JWT from the access API. Ensures the viewer is authorized for the given event and, for paidAccess, has completed payment.
 *     tags: [Playback]
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Stream URL returned
 *       401:
 *         description: Missing or invalid viewer token
 *       403:
 *         description: Viewer not authorized for this event
 *       402:
 *         description: Payment required
 */
router.get("/event/:eventId/stream", viewerAuth, PlaybackController.getStream);

export default router;
