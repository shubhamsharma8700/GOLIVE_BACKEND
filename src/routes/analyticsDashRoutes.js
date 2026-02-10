import express from "express";
import { getDashboardAnalytics } from "../controllers/analyticsDashController.js";

const router = express.Router();

router.get("/analytics", getDashboardAnalytics);

export default router;
