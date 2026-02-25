import express from "express";
import { getDashboardAnalytics } from "../controllers/DashboardController.js";
import { requireAuth } from "../middleware/auth.js";

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
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard analytics returned
 *       401:
 *         description: Unauthorized
 */
router.get("/analytics", requireAuth, getDashboardAnalytics);

export default router;
