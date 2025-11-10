import express from "express";
import AuthController from "../controllers/authController.js";
import { adminMiddleware } from "../middleware/adminMiddleware.js";

const router = express.Router();

router.post("/login", adminMiddleware, AuthController.adminLogin);

export default router;
