import express from "express";
import EventController from "../controllers/eventController.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Events
 *   description: Event Management API
 *
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *
 *   schemas:
 *     VideoConfig:
 *       type: object
 *       properties:
 *         resolution:
 *           type: string
 *           example: "1080p"
 *         frameRate:
 *           type: string
 *           example: "30"
 *         bitrate:
 *           type: string
 *           example: "medium"
 *         pixelProvider:
 *           type: string
 *           example: "none"
 *         pixelId:
 *           type: string
 *           nullable: true
 *
 *     RegistrationField:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         label:
 *           type: string
 *         type:
 *           type: string
 *         required:
 *           type: boolean
 *
 *     EventCreate:
 *       type: object
 *       required:
 *         - title
 *         - description
 *         - eventType
 *         - accessMode
 *       properties:
 *         title:
 *           type: string
 *         description:
 *           type: string
 *         eventType:
 *           type: string
 *           enum: [live, vod]
 *         accessMode:
 *           type: string
 *           enum: [freeAccess, emailAccess, passwordAccess, paidAccess]
 *
 *         # LIVE ONLY
 *         startTime:
 *           type: string
 *         endTime:
 *           type: string
 *
 *         # VOD ONLY
 *         s3Key:
 *           type: string
 *           description: S3 key of uploaded VOD file
 *         s3Prefix:
 *           type: string
 *
 *         # Video config (LIVE ONLY)
 *         videoConfig:
 *           $ref: '#/components/schemas/VideoConfig'
 *
 *         # Registration fields (email/password access)
 *         registrationFields:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/RegistrationField'
 *
 *         # Access mode extras
 *         accessPasswordHash:
 *           type: string
 *         accessPassword:
 *           type: string
 *
 *         # Payment access mode
 *         paymentAmount:
 *           type: number
 *         currency:
 *           type: string
 *           example: "USD"
 *
 *     EventUpdate:
 *       type: object
 *       description: Only provided fields are updated
 *       properties:
 *         title:
 *           type: string
 *         description:
 *           type: string
 *         startTime:
 *           type: string
 *         endTime:
 *           type: string
 *         s3Key:
 *           type: string
 *         s3Prefix:
 *           type: string
 *         accessMode:
 *           type: string
 *         accessPassword:
 *           type: string
 *         accessPasswordHash:
 *           type: string
 *         registrationFields:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/RegistrationField'
 *         videoConfig:
 *           $ref: '#/components/schemas/VideoConfig'
 *         paymentAmount:
 *           type: number
 *         currency:
 *           type: string
 *
 *     EventResponse:
 *       type: object
 *       properties:
 *         eventId:
 *           type: string
 *         title:
 *           type: string
 *         description:
 *           type: string
 *         eventType:
 *           type: string
 *         status:
 *           type: string
 *         accessMode:
 *           type: string
 *         startTime:
 *           type: string
 *         endTime:
 *           type: string
 *
 *         # VOD fields
 *         s3Key:
 *           type: string
 *         s3Prefix:
 *           type: string
 *         vodStatus:
 *           type: string
 *
 *         # Config
 *         videoConfig:
 *           $ref: '#/components/schemas/VideoConfig'
 *         registrationFields:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/RegistrationField'
 *
 *         createdBy:
 *           type: string
 *         createdAt:
 *           type: string
 *         updatedAt:
 *           type: string
 */

/* ============================================================
   1. GET PRESIGNED URL FOR VOD UPLOAD
   ============================================================ */
/**
 * @swagger
 * /api/events/vod/presign:
 *   get:
 *     summary: Generate S3 pre-signed upload URL for VOD upload
 *     tags: [Events]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: filename
 *         schema:
 *           type: string
 *         required: true
 *       - in: query
 *         name: contentType
 *         schema:
 *           type: string
 *           default: video/mp4
 *     responses:
 *       200:
 *         description: Presigned URL returned
 */
router.get("/vod/presign", requireAuth, EventController.vodPresignUpload);

/* ============================================================
   DOWNLOAD VOD (Presigned URL)
   ============================================================ */
/**
 * @swagger
 * /api/events/vod/download/{eventId}/{resolution}:
 *   get:
 *     summary: Generate presigned download URL for full VOD MP4
 *     tags: [Events]
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: resolution
 *         required: true
 *         schema:
 *           type: string
 *           enum: [1080p, 720p, 480p]
 *         description: Requested video resolution
 *     responses:
 *       200:
 *         description: Presigned download URL returned
 */
router.get("/vod/download/:eventId/:resolution", EventController.downloadVod);

/* ============================================================
   2. CREATE EVENT
   ============================================================ */
/**
 * @swagger
 * /api/events:
 *   post:
 *     summary: Create a new event (Live or VOD)
 *     tags: [Events]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/EventCreate'
 *     responses:
 *       201:
 *         description: Event created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EventResponse'
 */
router.post("/", requireAuth, EventController.createEvent);

/* ============================================================
   3. LIST EVENTS
   ============================================================ */
/**
 * @swagger
 * /api/events:
 *   get:
 *     summary: Get all events (search + filter supported)
 *     tags: [Events]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Text search across title/description
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [live, vod]
 *       - in: query
 *         name: limit
 *         schema:
 *           type: number
 *     responses:
 *       200:
 *         description: List of events
 */
router.get("/", requireAuth, EventController.listEvents);

/* ============================================================
   4. GET EVENT BY ID
   ============================================================ */
/**
 * @swagger
 * /api/events/{eventId}:
 *   get:
 *     summary: Get detailed event information
 *     tags: [Events]
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
 *         description: Event details retrieved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EventResponse'
 */
router.get("/:eventId", requireAuth, EventController.getEventById);

/* ============================================================
   5. UPDATE EVENT
   ============================================================ */
/**
 * @swagger
 * /api/events/{eventId}:
 *   put:
 *     summary: Update an existing event (partial updates)
 *     tags: [Events]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/EventUpdate'
 *     responses:
 *       200:
 *         description: Event updated successfully
 */
router.put("/:eventId", requireAuth, EventController.updateEvent);

/* ============================================================
   6. DELETE EVENT
   ============================================================ */
/**
 * @swagger
 * /api/events/{eventId}:
 *   delete:
 *     summary: Delete an event
 *     tags: [Events]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *     responses:
 *       200:
 *         description: Event deleted successfully
 */
router.delete("/:eventId", requireAuth, EventController.deleteEvent);

export default router;
