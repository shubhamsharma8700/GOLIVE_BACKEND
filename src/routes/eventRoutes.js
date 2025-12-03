import express from "express";
import EventController from "../controllers/eventController.js";

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
 *               - eventType
 *               - accessMode
 *               - status
 *               - createdBy
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
 *               eventType:
 *                 type: string
 *                 enum: [live, vod]
 *               status:
 *                 type: string
 *                 enum: [scheduled, live, vod, ended]
 *               accessMode:
 *                 type: string
 *                 enum: [freeAccess, emailAccess, passwordAccess, paidAccess]
 *                 description: Access control type
 *               createdBy:
 *                 type: string
 *                 description: Admin ID
 *               accessPassword:
 *                 type: string
 *                 description: Required if accessMode = passwordAccess
 *               formFields:
 *                 type: object
 *                 description: Form schema for emailAccess (optional, e.g. firstName, lastName, email + custom fields)
 *               paymentAmount:
 *                 type: number
 *                 description: Required if accessMode = paidAccess
 *               currency:
 *                 type: string
 *                 example: USD
 *                 description: Required if accessMode = paidAccess
 *     responses:
 *       201:
 *         description: Event created
 *       400:
 *         description: Invalid input
 */
router.post("/create", EventController.createEvent);


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
router.get("/list", EventController.listEvents);


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
 *               eventType:
 *                 type: string
 *                 enum: [live, vod]
 *               createdBy:
 *                 type: string
 *                 description: Admin ID if changing ownership
 *               thumbnailUrl:
 *                 type: string
 *                 example: https://example.com/thumbnail.png
 *               mediaLiveChannelId:
 *                 type: string
 *               mediaPackageChannelId:
 *                 type: string
 *               liveUrl:
 *                 type: string
 *               vodUrl:
 *                 type: string
 *               s3Bucket:
 *                 type: string
 *               accessMode:
 *                 type: string
 *                 enum: [freeAccess, emailAccess, passwordAccess, paidAccess]
 *                 description: Change the event gate type
 *               accessPassword:
 *                 type: string
 *                 description: Required if accessMode = passwordAccess
 *               formFields:
 *                 type: object
 *                 description: Form schema for emailAccess (optional)
 *               paymentAmount:
 *                 type: number
 *                 description: Required if accessMode = paidAccess
 *               currency:
 *                 type: string
 *                 description: Required if accessMode = paidAccess
 *               status:
 *                 type: string
 *                 enum: [scheduled, live, vod, ended]
 *     responses:
 *       200:
 *         description: Event updated successfully
 *       404:
 *         description: Event not found
 */
router.put("/update/:eventId", EventController.updateEvent);


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
router.delete("/delete/:eventId", EventController.deleteEvent);


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
router.get("/event/:eventId", EventController.getEventById);

/**
 * @swagger
 * /api/admin/event/channel/start:
 *   post:
 *     summary: Start an AWS MediaLive channel
 *     description: Initiates the start process for a MediaLive channel.
 *     tags: [Events]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - channelId
 *             properties:
 *               channelId:
 *                 type: string
 *                 example: "1234567"
 *     responses:
 *       200:
 *         description: Channel start initiated
 *       400:
 *         description: Missing required fields
 *       500:
 *         description: Server error
 */
router.post("/channel/start", EventController.startChannel);


/**
 * @swagger
 * /api/admin/event/channel/stop:
 *   post:
 *     summary: Stop an AWS MediaLive channel
 *     description: Initiates the stop process for a MediaLive channel.
 *     tags: [Events]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - channelId
 *             properties:
 *               channelId:
 *                 type: string
 *                 example: "1234567"
 *     responses:
 *       200:
 *         description: Channel stop initiated
 *       400:
 *         description: Missing required fields
 *       500:
 *         description: Server error
 */
router.post("/channel/stop", EventController.stopChannel);




export default router;
