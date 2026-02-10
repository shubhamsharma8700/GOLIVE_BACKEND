import express from "express";
import { getDashboardAnalytics } from "../controllers/DashboardController.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Dashboard
 *   description: Dashboard analytics APIs
 */

/**
 * @swagger
 * /api/dashboard/analytics:
 *   get:
 *     summary: Get dashboard summary and analytics
 *     tags: [Dashboard]
 *     responses:
 *       200:
 *         description: Dashboard analytics returned
 */
router.get("/analytics", getDashboardAnalytics);

export default router;
