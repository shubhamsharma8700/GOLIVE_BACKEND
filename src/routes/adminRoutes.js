import express from "express";

import {
    deleteAdmin,
    listAdmin,
    login,
    registerAdmin,
    requestPasswordReset,
    updateAdmin,
    verifyOtpAndReset
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
 *   schemas:
 *     AdminRegister:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         password:
 *           type: string
 *       required:
 *         - name
 *         - email
 *         - password
 *     AdminLogin:
 *       type: object
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *         password:
 *           type: string
 *       required:
 *         - email
 *         - password
 *     Admin:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         name:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 */

// Public Routes
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
 *             $ref: '#/components/schemas/AdminRegister'
 *     responses:
 *       201:
 *         description: Admin created
 *       400:
 *         description: Validation error
 */
router.post("/register", registerAdmin);

/**
 * @swagger
 * /api/admin/login:
 *   post:
 *     summary: Login as admin
 *     tags: [admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AdminLogin'
 *     responses:
 *       200:
 *         description: Login successful (returns token)
 *       401:
 *         description: Invalid credentials
 */
router.post("/login", login);

/**
 * @swagger
 * /api/admin/forgot-password/request-otp:
 *   post:
 *     summary: Request OTP for password reset
 *     tags: [admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *             required:
 *               - email
 *     responses:
 *       200:
 *         description: OTP sent
 *       404:
 *         description: Admin not found
 */
router.post("/forgot-password/request-otp", requestPasswordReset);

/**
 * @swagger
 * /api/admin/forgot-password/verify-reset:
 *   post:
 *     summary: Verify OTP and reset password
 *     tags: [admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               otp:
 *                 type: string
 *               newPassword:
 *                 type: string
 *             required:
 *               - email
 *               - otp
 *               - newPassword
 *     responses:
 *       200:
 *         description: Password reset successful
 *       400:
 *         description: Invalid OTP or input
 */
router.post("/forgot-password/verify-reset", verifyOtpAndReset);

// Protected Routes
/**
 * @swagger
 * /api/admin:
 *   get:
 *     summary: List all admin
 *     tags: [admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of admin
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Admin'
 */
router.get("/", requireAuth, listAdmin);

/**
 * @swagger
 * /api/admin/{adminID}:
 *   put:
 *     summary: Update an admin by ID
 *     tags: [admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: adminID
 *         schema:
 *           type: string
 *         required: true
 *         description: Admin ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Admin updated
 *       400:
 *         description: Validation error
 */
router.put("/:adminID", requireAuth, updateAdmin);

/**
 * @swagger
 * /api/admin/{adminID}:
 *   delete:
 *     summary: Delete an admin by ID
 *     tags: [admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: adminID
 *         schema:
 *           type: string
 *         required: true
 *         description: Admin ID
 *     responses:
 *       204:
 *         description: Admin deleted
 *       404:
 *         description: Admin not found
 */
router.delete("/:adminID", requireAuth, deleteAdmin);

export default router;
