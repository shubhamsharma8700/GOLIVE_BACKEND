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
 *   - name: Admin
 *     description: Admin management and authentication
 *
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   schemas:
 *     Admin:
 *       type: object
 *       properties:
 *         adminID:
 *           type: string
 *         name:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         status:
 *           type: string
 *           enum: [active, inactive]
 *         createdAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         lastLoginAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *     AdminListResponse:
 *       type: object
 *       properties:
 *         items:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Admin'
 *         pagination:
 *           type: object
 *           properties:
 *             totalItems:
 *               type: integer
 *             limit:
 *               type: integer
 *             nextKey:
 *               type: string
 *               nullable: true
 *             hasMore:
 *               type: boolean
 *     AuthTokenResponse:
 *       type: object
 *       properties:
 *         token:
 *           type: string
 *         expiresIn:
 *           type: integer
 *         admin:
 *           $ref: '#/components/schemas/Admin'
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         error:
 *           type: string
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name:
 *                 type: string
 *                 example: Super Admin
 *               email:
 *                 type: string
 *                 format: email
 *                 example: admin@example.com
 *               password:
 *                 type: string
 *                 minLength: 6
 *                 example: Admin@123
 *     responses:
 *       201:
 *         description: Admin created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Admin'
 *       400:
 *         description: Missing required fields
 *       409:
 *         description: Email already registered
 */
router.post("/register", registerAdmin);

/**
 * @swagger
 * /api/admin/login:
 *   post:
 *     summary: Login as admin (access + refresh token)
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: admin@example.com
 *               password:
 *                 type: string
 *                 example: Admin@123
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthTokenResponse'
 *       401:
 *         description: Invalid credentials
 *       403:
 *         description: Account is inactive
 */
router.post("/login", login);

/**
 * @swagger
 * /api/admin/refresh:
 *   post:
 *     summary: Refresh access token using refresh cookie
 *     tags: [Admin]
 *     description: Requires `refreshToken` cookie set by `/api/admin/login`.
 *     responses:
 *       200:
 *         description: New access token issued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                 expiresIn:
 *                   type: integer
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
 *                 example: admin@example.com
 *     responses:
 *       200:
 *         description: OTP sent
 *       404:
 *         description: Email not found
 *       429:
 *         description: OTP already sent recently
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
 *                 format: email
 *                 example: admin@example.com
 *               otp:
 *                 type: string
 *                 example: "123456"
 *               newPassword:
 *                 type: string
 *                 minLength: 6
 *                 example: NewPass@123
 *     responses:
 *       200:
 *         description: Password updated
 *       400:
 *         description: Invalid input, expired OTP, or incorrect OTP
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
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 20
 *         description: Number of records to return
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search by name or email
 *       - in: query
 *         name: lastKey
 *         schema:
 *           type: string
 *         description: Pagination cursor (`adminID`) from previous response
 *     responses:
 *       200:
 *         description: List of admins
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminListResponse'
 *       401:
 *         description: Unauthorized
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
 *         description: Logged-in admin profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Admin'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Admin not found
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
 *     parameters:
 *       - in: path
 *         name: adminID
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Admin details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Admin'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Admin not found
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
 *     parameters:
 *       - in: path
 *         name: adminID
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: Updated Name
 *               status:
 *                 type: string
 *                 enum: [active, inactive]
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Not allowed; API returns error if provided
 *     responses:
 *       200:
 *         description: Admin updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Admin'
 *       400:
 *         description: Invalid update request
 *       401:
 *         description: Unauthorized
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
 *     parameters:
 *       - in: path
 *         name: adminID
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Admin deleted successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Admin not found
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
 *     responses:
 *       200:
 *         description: Logged out successfully
 */
router.post("/logout", logoutAdmin);

export default router;
