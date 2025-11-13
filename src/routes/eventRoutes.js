import express from "express";
import EventController from "../controllers/eventController.js";
import { adminMiddleware } from "../middleware/adminMiddleware.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Events
 *   description: Event management API
 */

/**
 * @swagger
 * /api/admin/event/create:
 *   post:
 *     summary: Create a new event
 *     description: Adds a new event record to DynamoDB
 *     tags: [Events]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - description
 *               - startTime
 *               - accessMode
 *             properties:
 *               title:
 *                 type: string
 *                 example: AWS Workshop
 *               description:
 *                 type: string
 *                 example: Learn AWS Media Services
 *               startTime:
 *                 type: string
 *                 example: 2025-11-10T10:00:00Z
 *               endTime:
 *                 type: string
 *                 example: 2025-11-10T12:00:00Z
 *               accessMode:
 *                 type: string
 *                 enum: [free, password, payment]
 *                 example: password
 *               password:
 *                 type: string
 *                 example: abc123
 *               paymentAmount:
 *                 type: number
 *                 example: 200
 *     responses:
 *       201:
 *         description: Event created successfully
 *       400:
 *         description: Missing required fields
 */
router.post("/create", adminMiddleware, EventController.createEvent);


/**
 * @swagger
 * /api/admin/event/list:
 *   get:
 *     summary: List all events
 *     description: Retrieves all events from DynamoDB
 *     tags: [Events]
 *     responses:
 *       200:
 *         description: List of events retrieved successfully
 */
router.get("/list", adminMiddleware, EventController.listEvents);


/**
 * @swagger
 * /api/admin/event/update/{eventId}:
 *   put:
 *     summary: Update an existing event
 *     description: Updates details of an existing event
 *     tags: [Events]
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         description: The ID of the event to update
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - description
 *               - startTime
 *               - accessMode
 *             properties:
 *               title:
 *                 type: string
 *                 example: Updated AWS Workshop
 *               description:
 *                 type: string
 *                 example: Updated event description
 *               startTime:
 *                 type: string
 *                 example: 2025-11-10T10:00:00Z
 *               endTime:
 *                 type: string
 *                 example: 2025-11-10T12:00:00Z
 *               accessMode:
 *                 type: string
 *                 enum: [free, password, payment]
 *                 example: payment
 *               password:
 *                 type: string
 *                 example: mypass123
 *               paymentAmount:
 *                 type: number
 *                 example: 300
 *     responses:
 *       200:
 *         description: Event updated successfully
 *       404:
 *         description: Event not found
 */
router.put("/update/:eventId", adminMiddleware, EventController.updateEvent);


/**
 * @swagger
 * /api/admin/event/delete/{eventId}:
 *   delete:
 *     summary: Delete an event
 *     description: Removes an event from DynamoDB
 *     tags: [Events]
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         description: ID of the event to delete
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Event deleted successfully
 *       404:
 *         description: Event not found
 */
router.delete("/delete/:eventId", adminMiddleware, EventController.deleteEvent);


/**
 * @swagger
 * /api/admin/event/event/{eventId}:
 *   get:
 *     summary: Get event details
 *     description: Fetch a single event from DynamoDB by eventId
 *     tags: [Events]
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         description: Event ID to fetch
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Event retrieved successfully
 *       404:
 *         description: Event not found
 */
router.get("/event/:eventId", adminMiddleware, EventController.getEventById);


export default router;
