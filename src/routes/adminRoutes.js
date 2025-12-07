import express from "express";

import {
  registerAdmin,
  login,
  requestPasswordReset,
  verifyOtpAndReset,
  listAdmin,
  getAdminById,
  updateAdmin,
  deleteAdmin,getAdminProfile
    ,logoutAdmin
} from "../controllers/adminController.js";

import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: admin
 *   description: Admin management and authentication
 *
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *
 *   schemas:
 *     AdminRegister:
 *       type: object
 *       required: [name, email, password]
 *       properties:
 *         name:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         password:
 *           type: string
 *
 *     AdminLogin:
 *       type: object
 *       required: [email, password]
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *         password:
 *           type: string
 *
 *     AdminUpdate:
 *       type: object
 *       description: Only name and status can be updated
 *       properties:
 *         name:
 *           type: string
 *         status:
 *           type: string
 *           enum: [active, inactive]
 *
 *     AdminResponse:
 *       type: object
 *       properties:
 *         adminID:
 *           type: string
 *         name:
 *           type: string
 *         email:
 *           type: string
 *         status:
 *           type: string
 *         createdAt:
 *           type: number
 *         updatedAt:
 *           type: number
 */

/* -------------------------------------------------------
   PUBLIC ROUTES
------------------------------------------------------- */

/**
 * @swagger
 * /api/admin/register:
 *   post:
 *     summary: Register a new admin
 *     tags: [admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AdminRegister'
 *     responses:
 *       201:
 *         description: Admin created successfully
 */
router.post("/register", registerAdmin);

/**
 * @swagger
 * /api/admin/login:
 *   post:
 *     summary: Login as admin
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AdminLogin'
 *     responses:
 *       200:
 *         description: Login successful (returns token + cookie)
 *       401:
 *         description: Invalid credentials
 */
router.post("/login", login);

/**
 * @swagger
 * /api/admin/forgot-password/request-otp:
 *   post:
 *     summary: Request OTP for password reset
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: OTP sent successfully
 */
router.post("/forgot-password/request-otp", requestPasswordReset);

/**
 * @swagger
 * /api/admin/forgot-password/verify-reset:
 *   post:
 *     summary: Verify OTP and reset password
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, otp, newPassword]
 *             properties:
 *               email:
 *                 type: string
 *               otp:
 *                 type: string
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password reset successful
 */
router.post("/forgot-password/verify-reset", verifyOtpAndReset);

/* 
   PROTECTED ROUTES (requireAuth)
 */

/**
 * @swagger
 * /api/admin:
 *   get:
 *     summary: List admins with pagination & search
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: number
 *         description: Number of admins per page
 *       - in: query
 *         name: lastKey
 *         schema:
 *           type: string
 *         description: Pagination cursor
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search by name/email
 *     responses:
 *       200:
 *         description: Paginated admin list
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
 *     responses:
 *       200:
 *         description: Admin profile returned
 *       401:
 *         description: Unauthorized
 */
router.get("/profile", requireAuth, getAdminProfile);

/**
 * @swagger
 * /api/admin/logout:
 *   post:
 *     summary: Logout admin (clears auth cookie)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully
 */
router.post("/logout", requireAuth, logoutAdmin);

/**
 * @swagger
 * /api/admin/{adminID}:
 *   get:
 *     summary: Get admin details by ID
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: adminID
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Admin details fetched
 *       404:
 *         description: Not found
 */
router.get("/:adminID", requireAuth, getAdminById);

/**
 * @swagger
 * /api/admin/{adminID}:
 *   put:
 *     summary: Update admin (name, status only)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: adminID
 *         required: true
 *         schema:
 *           type: string
 *         description: Admin ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AdminUpdate'
 *     responses:
 *       200:
 *         description: Admin updated
 */
router.put("/:adminID", requireAuth, updateAdmin);

/**
 * @swagger
 * /api/admin/{adminID}:
 *   delete:
 *     summary: Delete admin by ID
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: adminID
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Admin deleted
 */
router.delete("/:adminID", requireAuth, deleteAdmin);



export default router;
