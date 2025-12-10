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
 *     EventCreate:
 *       type: object
 *       required: [title, description, eventType, accessMode]
 *       properties:
 *         title:
 *           type: string
 *         description:
 *           type: string
 *         eventType:
 *           type: string
 *           enum: [live, vod]
 *         startTime:
 *           type: string
 *         endTime:
 *           type: string
 *         s3Key:
 *           type: string
 *           description: Required for VOD events
 *         accessMode:
 *           type: string
 *           enum: [freeAccess, emailAccess, passwordAccess, paidAccess]
 *         accessPassword:
 *           type: string
 *         formFields:
 *           type: object
 *         paymentAmount:
 *           type: number
 *         currency:
 *           type: string
 *
 *     EventUpdate:
 *       type: object
 *       description: Only fields passed will be updated
 *       properties:
 *         title:
 *           type: string
 *         description:
 *           type: string
 *         startTime:
 *           type: string
 *         endTime:
 *           type: string
 *         accessMode:
 *           type: string
 *         accessPassword:
 *           type: string
 *         formFields:
 *           type: object
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
 *     summary: Generate S3 pre-signed upload URL for VOD files
 *     tags: [Events]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: contentType
 *         schema:
 *           type: string
 *           default: video/mp4
 *     responses:
 *       200:
 *         description: Upload URL generated
 */
router.get("/vod/presign", requireAuth, EventController.vodPresignUpload);

/* ============================================================
   2. CREATE EVENT
   ============================================================ */
/**
 * @swagger
 * /api/events:
 *   post:
 *     summary: Create a new Live or VOD event
 *     tags: [Events]
 *     security:
 *       - bearerAuth: []
 *     description: createdBy is injected automatically from JWT.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/EventCreate'
 *     responses:
 *       201:
 *         description: Event created successfully
 */
router.post("/", requireAuth, EventController.createEvent);

/* ============================================================
   3. LIST EVENTS
   ============================================================ */
/**
 * @swagger
 * /api/events:
 *   get:
 *     summary: Get all events (supports filters)
 *     tags: [Events]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search text
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
 *         description: Events retrieved
 */
router.get("/", requireAuth, EventController.listEvents);

/* ============================================================
   4. GET EVENT BY ID
   ============================================================ */
/**
 * @swagger
 * /api/events/{eventId}:
 *   get:
 *     summary: Get event details by ID
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
 *         description: Event details
 */
router.get("/:eventId", requireAuth, EventController.getEventById);

/* ============================================================
   5. UPDATE EVENT
   ============================================================ */
/**
 * @swagger
 * /api/events/{eventId}:
 *   put:
 *     summary: Update an existing event
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
 *         description: Event deleted
 */
router.delete("/:eventId", requireAuth, EventController.deleteEvent);

export default router;
