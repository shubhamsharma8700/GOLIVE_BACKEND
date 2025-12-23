import express from "express";

import {
  registerAdmin,
  login,
  refreshToken,
  requestPasswordReset,
  verifyOtpAndReset,
  listAdmin,
  getAdminById,
  updateAdmin,
  deleteAdmin,
  getAdminProfile,
  logoutAdmin,
} from "../controllers/adminController.js";

import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Admin
 *   description: Admin management and authentication
 *
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 */

/* -------------------------------------------------------
   PUBLIC ROUTES
------------------------------------------------------- */

/**
 * @swagger
 * /api/admin/register:
 *   post:
 *     summary: Register a new admin
 *     tags: [Admin]
 */
router.post("/register", registerAdmin);

/**
 * @swagger
 * /api/admin/login:
 *   post:
 *     summary: Login as admin (access + refresh token)
 *     tags: [Admin]
 */
router.post("/login", login);

/**
 * @swagger
 * /api/admin/refresh:
 *   post:
 *     summary: Refresh access token using refresh cookie
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: New access token issued
 *       401:
 *         description: Refresh token expired or missing
 */
router.post("/refresh", refreshToken);

/**
 * @swagger
 * /api/admin/forgot-password/request-otp:
 *   post:
 *     summary: Request OTP for password reset
 *     tags: [Admin]
 */
router.post("/forgot-password/request-otp", requestPasswordReset);

/**
 * @swagger
 * /api/admin/forgot-password/verify-reset:
 *   post:
 *     summary: Verify OTP and reset password
 *     tags: [Admin]
 */
router.post("/forgot-password/verify-reset", verifyOtpAndReset);

/* -------------------------------------------------------
   PROTECTED ROUTES (Access Token Required)
------------------------------------------------------- */

/**
 * @swagger
 * /api/admin:
 *   get:
 *     summary: List admins
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get("/", requireAuth, listAdmin);

/**
 * @swagger
 * /api/admin/profile:
 *   get:
 *     summary: Get logged-in admin profile
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get("/profile", requireAuth, getAdminProfile);

/**
 * @swagger
 * /api/admin/{adminID}:
 *   get:
 *     summary: Get admin by ID
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get("/:adminID", requireAuth, getAdminById);

/**
 * @swagger
 * /api/admin/{adminID}:
 *   put:
 *     summary: Update admin (name, status)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.put("/:adminID", requireAuth, updateAdmin);

/**
 * @swagger
 * /api/admin/{adminID}:
 *   delete:
 *     summary: Delete admin
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.delete("/:adminID", requireAuth, deleteAdmin);

/* -------------------------------------------------------
   LOGOUT (NO AUTH REQUIRED)
------------------------------------------------------- */

/**
 * @swagger
 * /api/admin/logout:
 *   post:
 *     summary: Logout admin (clears refresh cookie)
 *     tags: [Admin]
 */
router.post("/logout", logoutAdmin);

export default router;
