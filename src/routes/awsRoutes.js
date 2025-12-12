import express from "express";
import EventController from "../controllers/awsController.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: AWS
 *   description: AWS Dashboard API
 */

/**


/**
 * @swagger
 * /api/aws/channel/start:
 *   post:
 *     summary: Start an AWS MediaLive channel
 *     description: Initiates the start process for a MediaLive channel.
 *     tags: [AWS]
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
 * /api/aws/channel/stop:
 *   post:
 *     summary: Stop an AWS MediaLive channel
 *     description: Initiates the stop process for a MediaLive channel.
 *     tags: [AWS]
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
