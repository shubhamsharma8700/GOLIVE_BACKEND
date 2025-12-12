import express from "express";
import EventController from "../controllers/eventController.js";

const router = express.Router();

router.get("/event/:eventId", EventController.getEventForViewer);

export default router;
