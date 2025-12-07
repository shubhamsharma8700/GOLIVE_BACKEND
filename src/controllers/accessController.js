import {
  ddbDocClient,
  GetCommand,
  PutCommand,
  ScanCommand,
} from "../config/awsClients.js";

import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { signViewerToken } from "../utils/jwt.js";
import { sendPasswordFromServer } from "../utils/sendPasswordFromServer.js";

const EVENTS_TABLE = process.env.EVENTS_TABLE_NAME || "go-live-poc-events";
const VIEWERS_TABLE =
  process.env.VIWERS_TABLE_NAME ||
  process.env.VIEWERS_TABLE_NAME ||
  "go-live-poc-viewers";

const SUCCESS_STATES = new Set(["success", "succeeded", "paid"]);

const ACCESS_MODES = new Set([
  "freeAccess",
  "emailAccess",
  "passwordAccess",
  "paidAccess",
]);

// ----------------- Utility Helpers --------------------

const normalizeAccessMode = (value) =>
  !value ? null : ACCESS_MODES.has(value) ? value : null;

const resolveAccessMode = (event = {}) =>
  normalizeAccessMode(event.accessMode) || "freeAccess";

const getClientIp = (req) => {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.ip;
};

const validEmail = (e) =>
  typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// --------------------------------------------------------
//                  ACCESS CONTROLLER
// --------------------------------------------------------

export default class AccessController {
  // =============================
  // VERIFY ACCESS
  // =============================
  static async verifyAccess(req, res) {
    try {
      const { eventId } = req.params;
      if (!eventId) return res.status(400).json({ message: "Missing eventId" });

      // --- Fetch Event ---
      const eventResult = await ddbDocClient.send(
        new GetCommand({
          TableName: EVENTS_TABLE,
          Key: { eventId },
        })
      );

      if (!eventResult.Item)
        return res.status(404).json({ message: "Event not found" });

      const event = eventResult.Item;
      const accessMode = resolveAccessMode(event);
      const paymentGateEnabled =
        accessMode === "paidAccess" ||
        Boolean(event.isPaidEvent || event.paymentAmount);

      let {
        clientViewerId,
        email,
        name,
        password,
        formData,
        deviceType,
        paymentStatus = "none",
        metadata,
        mode,
      } = req.body || {};

      let accessGranted = false;
      let message = "";

      // ========================== ACCESS MODE LOGIC ==========================

      // FREE ACCESS
      if (accessMode === "freeAccess") {
        accessGranted = true;
        message = "Free access granted";
      }

      // EMAIL ACCESS
      else if (accessMode === "emailAccess") {
        const registration = formData || {};
        const firstName = registration.firstName;
        const lastName = registration.lastName;
        const primaryEmail = email || registration.email;

        if (!firstName || !lastName || !primaryEmail)
          return res
            .status(400)
            .json({ message: "firstName, lastName, email required" });

        if (!validEmail(primaryEmail))
          return res.status(400).json({ message: "Invalid email" });

        formData = {
          firstName,
          lastName,
          email: primaryEmail,
        };

        email = primaryEmail;
        name = name || `${firstName} ${lastName}`.trim();

        accessGranted = true;
        message = "Email verified";
      }

      // PASSWORD ACCESS
      else if (accessMode === "passwordAccess") {
        const storedPassword =
          event.accessPassword || event.password || null;
        if (!storedPassword)
          return res
            .status(500)
            .json({ message: "Event password not configured" });

        const flowMode =
          typeof mode === "string" && mode.toLowerCase() === "register"
            ? "register"
            : "login";

        // REGISTER MODE
        if (flowMode === "register") {
          const registration = formData || {};
          const primaryEmail = email || registration.email;
          const firstName = registration.firstName;
          const lastName = registration.lastName;

          if (!firstName || !lastName || !primaryEmail)
            return res.status(400).json({
              message:
                "firstName, lastName, email required for Password Access registration",
            });

          formData = {
            firstName,
            lastName,
            email: primaryEmail,
          };

          email = primaryEmail;
          name = `${firstName} ${lastName}`.trim();

          try {
            await sendPasswordFromServer({
              eventId,
              clientViewerId,
              email,
              firstName,
              lastName,
              password: storedPassword,
              eventTitle: event.title || eventId,
            });
          } catch (e) {
            console.error("Email sending failed:", e);
          }

          accessGranted = false;
          message = "Registration successful. Password sent to email.";
        }

        // LOGIN MODE
        else {
          if (!email)
            return res
              .status(400)
              .json({ message: "email is required for Password Access" });

          if (!password)
            return res
              .status(400)
              .json({ message: "password is required for Password Access" });

          const matches = storedPassword.startsWith("$2")
            ? await bcrypt.compare(password, storedPassword)
            : storedPassword === password;

          if (!matches)
            return res.status(403).json({ message: "Invalid password" });

          accessGranted = true;
          message = "Password accepted";
        }
      }

      // PAID ACCESS
      else if (accessMode === "paidAccess") {
        if (!email)
          return res.status(400).json({ message: "email is required" });

        accessGranted = true;
        message = "Payment required";
      }

      // --------------------------- PAYMENT CHECK ----------------------------

      const paymentResolved = SUCCESS_STATES.has(
        (paymentStatus || "").toLowerCase()
      );

      if (paymentGateEnabled && !paymentResolved) {
        accessGranted = false;
        message = "Payment confirmation required";
      }

      // --------------------------- VIEWER RECORD ----------------------------

      const shouldPersistViewer = Boolean(clientViewerId);

      let existingViewer = null;

      if (shouldPersistViewer) {
        const result = await ddbDocClient.send(
          new GetCommand({
            TableName: VIEWERS_TABLE,
            Key: { eventId, clientViewerId },
          })
        );

        existingViewer = result.Item || null;
      }

      const now = new Date().toISOString();

      const viewerId = existingViewer?.viewerId || uuidv4();
      const ipAddress = existingViewer?.ipAddress || getClientIp(req);

      const viewerItem = {
        eventId,
        clientViewerId,
        viewerId,
        email: email || existingViewer?.email || null,
        name: name || existingViewer?.name || null,
        accessMode,
        formData: formData || existingViewer?.formData || null,
        isPaidViewer: paymentResolved,
        paymentStatus,
        accessVerified: accessGranted,
        deviceType: deviceType || existingViewer?.deviceType || null,
        ipAddress,
        metadata: metadata || existingViewer?.metadata || null,
        firstJoinAt: existingViewer?.firstJoinAt || now,
        lastJoinAt: now,
        totalSessions: (existingViewer?.totalSessions || 0) + (accessGranted ? 1 : 0),
        totalWatchTime: existingViewer?.totalWatchTime || 0,
        createdAt: existingViewer?.createdAt || now,
        updatedAt: now,
      };

      // SAVE VIEWER IF WE HAVE AN ID
      if (shouldPersistViewer) {
        await ddbDocClient.send(
          new PutCommand({
            TableName: VIEWERS_TABLE,
            Item: viewerItem,
          })
        );
      }

      // --------------------------- TOKEN ----------------------------
      let token = null;
      if (accessGranted) {
        token = signViewerToken({
          viewerId,
          eventId,
          accessMode,
          isPaidViewer: paymentResolved,
        });
      }

      return res.status(200).json({
        success: true,
        accessGranted,
        accessMode,
        status: accessGranted ? "success" : "failure",
        needsPayment: paymentGateEnabled && !accessGranted,
        message,
        viewerId,
        token,
      });
    } catch (error) {
      console.error("verifyAccess error", error);
      return res
        .status(500)
        .json({ success: false, message: "Unable to verify access" });
    }
  }

  // =============================
  // REQUEST ACCESS
  // =============================
  static async requestAccess(req, res) {
    return AccessController.verifyAccess(req, res);
  }

  // =============================
  // LIST VIEWERS
  // =============================
  static async listViewers(req, res) {
    try {
      const { eventId } = req.query;

      let params = { TableName: VIEWERS_TABLE };
      if (eventId) {
        params.FilterExpression = "eventId = :e";
        params.ExpressionAttributeValues = { ":e": eventId };
      }

      const items = [];
      let lastKey;

      do {
        const resp = await ddbDocClient.send(
          new ScanCommand({
            ...params,
            ExclusiveStartKey: lastKey,
          })
        );

        if (resp.Items) items.push(...resp.Items);
        lastKey = resp.LastEvaluatedKey;
      } while (lastKey);

      const viewers = items.map((v) => ({
        viewerId: v.viewerId,
        eventId: v.eventId,
        clientViewerId: v.clientViewerId,
        accessMode: resolveAccessMode(v),
        accessVerified: Boolean(v.accessVerified),
        status: v.accessVerified ? "success" : "failure",
        isPaidViewer: Boolean(v.isPaidViewer),
        paymentStatus: v.paymentStatus || "none",
        firstJoinAt: v.firstJoinAt,
        lastJoinAt: v.lastJoinAt,
      }));

      return res.status(200).json({
        success: true,
        count: viewers.length,
        viewers,
      });
    } catch (error) {
      console.error("listViewers error:", error);
      return res
        .status(500)
        .json({ success: false, message: "Unable to list viewers" });
    }
  }

  // =============================
  // GET VIEWER ACCESS MODE
  // =============================
  static async getViewerAccessMode(req, res) {
    try {
      const { viewerId } = req.params;
      if (!viewerId)
        return res.status(400).json({ message: "Missing viewerId" });

      const resp = await ddbDocClient.send(
        new ScanCommand({
          TableName: VIEWERS_TABLE,
          FilterExpression: "viewerId = :v",
          ExpressionAttributeValues: { ":v": viewerId },
          Limit: 1,
        })
      );

      const item = resp.Items?.[0];
      if (!item)
        return res.status(404).json({ message: "Viewer not found" });

      return res.status(200).json({
        success: true,
        viewerId: item.viewerId,
        eventId: item.eventId,
        clientViewerId: item.clientViewerId,
        accessMode: resolveAccessMode(item),
        isPaidViewer: Boolean(item.isPaidViewer),
        paymentStatus: item.paymentStatus || "none",
      });
    } catch (error) {
      console.error("getViewerAccessMode error:", error);
      return res
        .status(500)
        .json({ success: false, message: "Unable to fetch viewer accessMode" });
    }
  }
}
