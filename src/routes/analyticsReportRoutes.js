import express from "express";
import { getAnalyticsByEventId } from "../controllers/analyticsReportController.js";

const router = express.Router();

// Handles both cases automatically
router.post("/", getAnalyticsByEventId);

export default router;