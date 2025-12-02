import express from "express";
import AccessController from "../controllers/accessController.js";
const router = express.Router();

/**
 * @swagger
 * /api/access/event/{eventId}/requestAccess:
 *   post:
 *     summary: Unified access entrypoint
 *     description: Single endpoint for all access modes (freeAccess, emailAccess, passwordAccess, paidAccess). Payload shape depends on the event's accessMode.
 *     tags: [Viewer Access]
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Generic viewer access payload. Backend validates required fields based on event accessMode.
 *             properties:
 *               mode:
 *                 type: string
 *                 description: Optional. For passwordAccess use "register" to send password email or "login" to verify password. Defaults to "login".
 *               clientViewerId:
 *                 type: string
 *                 description: Optional client-specific ID. Used to persist viewer record for analytics.
 *               deviceType:
 *                 type: string
 *                 enum: [desktop, mobile, tablet]
 *               email:
 *                 type: string
 *                 description: Required for emailAccess, passwordAccess and paidAccess.
 *               password:
 *                 type: string
 *                 description: For passwordAccess login step. Must match the admin-configured event password sent by email.
 *               formData:
 *                 type: object
 *                 description: For emailAccess, must contain firstName, lastName and email.
 *             examples:
 *               freeAccess:
 *                 summary: Free/open access (no inputs strictly required)
 *                 value:
 *                   {}
 *               emailAccess:
 *                 summary: Email access viewer payload (firstName, lastName, email required)
 *                 value:
 *                   email: "viewer@example.com"
 *                   formData:
 *                     firstName: "Test"
 *                     lastName: "Viewer"
 *                     email: "viewer@example.com"
 *               passwordAccessRegister:
 *                 summary: Password access registration (collect name + email and send password email)
 *                 value:
 *                   mode: "register"
 *                   formData:
 *                     firstName: "Test"
 *                     lastName: "Viewer"
 *                     email: "viewer@example.com"
 *               passwordAccessLogin:
 *                 summary: Password access login (email + password after email received)
 *                 value:
 *                   mode: "login"
 *                   email: "viewer@example.com"
 *                   password: "ADMIN_EVENT_PASSWORD"
 *               paidAccess:
 *                 summary: Paid access viewer payload (email required; amount configured on event)
 *                 value:
 *                   email: "viewer@example.com"
 *     responses:
 *       200:
 *         description: Access verification result for the viewer.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 accessGranted:
 *                   type: boolean
 *                 accessMode:
 *                   type: string
 *                   enum: [freeAccess, emailAccess, passwordAccess, paidAccess]
 *                 needsPayment:
 *                   type: boolean
 *                 status:
 *                   type: string
 *                   description: success or failure for this access attempt.
 *                 message:
 *                   type: string
 *                 viewerId:
 *                   type: string
 *                 token:
 *                   type: string
 *                   description: JWT token to be used for playback APIs when access is granted.
 *             examples:
 *               freeAccess:
 *                 summary: Free access granted
 *                 value:
 *                   success: true
 *                   accessGranted: true
 *                   accessMode: freeAccess
 *                   needsPayment: false
 *                   status: success
 *                   message: Free access granted
 *                   viewerId: "viewer-uuid"
 *                   token: "<jwt-token>"
 *               passwordAccessSuccess:
 *                 summary: Password accepted
 *                 value:
 *                   success: true
 *                   accessGranted: true
 *                   accessMode: passwordAccess
 *                   needsPayment: false
 *                   status: success
 *                   message: Password accepted
 *                   viewerId: "viewer-uuid"
 *                   token: "<jwt-token>"
 *               passwordAccessFailure:
 *                 summary: Invalid password
 *                 value:
 *                   success: false
 *                   accessGranted: false
 *                   accessMode: passwordAccess
 *                   needsPayment: false
 *                   status: failure
 *                   message: Invalid password
 *                   viewerId: null
 *                   token: null
 */
router.post("/event/:eventId/requestAccess", AccessController.requestAccess);

/**
 * @swagger
 * /api/access/viewer/{viewerId}/accessMode:
 *   get:
 *     summary: Get viewer accessMode details
 *     description: Returns the accessMode (freeAccess, emailAccess, passwordAccess, paidAccess) and related flags for a viewerId.
 *     tags: [Viewer Access]
 *     parameters:
 *       - in: path
 *         name: viewerId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Viewer accessMode details
 *       404:
 *         description: Viewer not found
 */
router.get("/viewer/:viewerId/accessMode", AccessController.getViewerAccessMode);

/**
 * @swagger
 * /api/access/viewers:
 *   get:
 *     summary: List viewers and their accessMode
 *     description: Returns all viewers who have attempted access, optionally filtered by eventId.
 *     tags: [Viewer Access]
 *     parameters:
 *       - in: query
 *         name: eventId
 *         required: false
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of viewers with access status
 */
router.get("/viewers", AccessController.listViewers);

export default router;
