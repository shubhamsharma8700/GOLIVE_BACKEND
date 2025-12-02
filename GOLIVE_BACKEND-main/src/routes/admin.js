import express from "express";

import {
    deleteAdmin,
    listAdmins,
    login,
    registerAdmin,
    requestPasswordReset,
    updateAdmin,
    verifyOtpAndReset
} from "../controllers/adminController.js";

import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// Public Routes
router.post("/register", registerAdmin);
router.post("/login", login);
router.post("/forgot-password/request-otp", requestPasswordReset);
router.post("/forgot-password/verify-reset", verifyOtpAndReset);

// Protected Routes
router.get("/", requireAuth, listAdmins);
router.put("/:adminID", requireAuth, updateAdmin);
router.delete("/:adminID", requireAuth, deleteAdmin);

export default router;
