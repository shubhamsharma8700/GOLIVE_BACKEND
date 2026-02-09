import express from "express";
import { getAnalyticsByEventId } from "../controllers/analyticsSendController.js";

const router = express.Router();

// Handles both cases automatically
router.post("/", getAnalyticsByEventId);

export default router;