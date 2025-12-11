import express from "express";
import MediaLiveController from "../controllers/awsController.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: AWS
 *   description: AWS Dashboard API
 */

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
router.post("/channel/start", MediaLiveController.startChannel);

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
router.post("/channel/stop", MediaLiveController.stopChannel);

/**
 * @swagger
 * /api/aws/channel/list:
 *   get:
 *     summary: List all MediaLive channels
 *     description: Retrieves a list of all MediaLive channels.
 *     tags: [AWS]
 *     responses:
 *       200:
 *         description: List of channels
 *       500:
 *         description: Server error
 */
router.get("/channel/list", MediaLiveController.listChannels);

/**
 * @swagger
 * /api/aws/channel/{channelId}:
 *   get:
 *     summary: Describe a MediaLive channel
 *     description: Retrieves details of a specific MediaLive channel.
 *     tags: [AWS]
 *     parameters:
 *       - in: path
 *         name: channelId
 *         required: true
 *         schema:
 *           type: string
 *         example: "1234567"
 *     responses:
 *       200:
 *         description: Channel details
 *       400:
 *         description: Missing required fields
 *       500:
 *         description: Server error
 */
router.get("/channel/:channelId", MediaLiveController.describeChannel);

/**
 * @swagger
 * /api/aws/s3/buckets:
 *   get:
 *     summary: List S3 buckets
 *     description: Retrieves a list of all S3 buckets.
 *     tags: [AWS]
 *     responses:
 *       200:
 *         description: List of buckets
 *       500:
 *         description: Server error
 */
router.get("/s3/buckets", MediaLiveController.listBuckets);

/**
 * @swagger
 * /api/aws/cost/usage:
 *   get:
 *     summary: Get AWS cost and usage
 *     description: Retrieves cost and usage data for the AWS account.
 *     tags: [AWS]
 *     parameters:
 *       - in: query
 *         name: start
 *         schema:
 *           type: string
 *           format: date
 *         example: "2023-01-01"
 *       - in: query
 *         name: end
 *         schema:
 *           type: string
 *           format: date
 *         example: "2023-12-31"
 *     responses:
 *       200:
 *         description: Cost data
 *       500:
 *         description: Server error
 */
router.get("/cost/usage", MediaLiveController.getCostAndUsage);

/**
 * @swagger
 * /api/aws/budgets:
 *   get:
 *     summary: Describe AWS budgets
 *     description: Retrieves information about AWS budgets.
 *     tags: [AWS]
 *     responses:
 *       200:
 *         description: Budget data
 *       500:
 *         description: Server error
 */
router.get("/budgets", MediaLiveController.describeBudgets);

export default router;
