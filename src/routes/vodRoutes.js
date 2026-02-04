// src/routes/vodRoutes.js
import express from "express";
import { generatePermanentVodLink } from "../controllers/vodController.js";
import { requireAuth } from "../middlewares/auth.js"; 

const router = express.Router();

router.post(
  "/:eventId/permanent-link",
  requireAuth,                 //  admin auth
  generatePermanentVodLink
);

export default router;
