import express from "express";
import downloadUrlController from "../controllers/downloadUrlController.js";

const router = express.Router();

router.get(
  "/vod/download/:eventId",
  downloadUrlController.downloadVod
);

export default router;
