import express from "express";
import {
  listViewers,
  listViewersByEvent,
  getViewerById,
  deleteViewer,
} from "../controllers/viewerController.js";

import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Viewers
 *   description: Viewer management APIs
 */

/* -------------------------------------------------------
   PROTECTED ROUTES
------------------------------------------------------- */

/**
 * @swagger
 * /api/viewers:
 *   get:
 *     summary: List all viewers (search, pagination, sort)
 *     tags: [Viewers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: number
 *       - in: query
 *         name: lastKey
 *         schema:
 *           type: string
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search by name or email
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [lastActiveAt, watchingHours]
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *     responses:
 *       200:
 *         description: Viewer list
 */
router.get("/", requireAuth, listViewers);

/**
 * @swagger
 * /api/viewers/event/{eventId}:
 *   get:
 *     summary: List viewers for a specific event
 *     tags: [Viewers]
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
 *       - in: query
 *         name: lastKey
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Viewer list by event
 */
router.get("/event/:eventId", requireAuth, listViewersByEvent);

/**
 * @swagger
 * /api/viewers/{viewerID}:
 *   get:
 *     summary: Get viewer by ID
 *     tags: [Viewers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: viewerID
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Viewer details
 *       404:
 *         description: Viewer not found
 */
router.get("/:viewerID", requireAuth, getViewerById);

/**
 * @swagger
 * /api/viewers/{viewerID}:
 *   delete:
 *     summary: Delete viewer by ID
 *     tags: [Viewers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: viewerID
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Viewer deleted
 */
router.delete("/:viewerID", requireAuth, deleteViewer);

export default router;
