import { dynamoDB, lambda } from "../config/awsClients.js";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { signViewerToken } from "../utils/jwt.js";

const EVENTS_TABLE = process.env.EVENTS_TABLE_NAME || "go-live-poc-events";
const VIEWERS_TABLE = process.env.VIWERS_TABLE_NAME || process.env.VIEWERS_TABLE_NAME || "go-live-poc-viewers";
const SUCCESS_STATES = new Set(["success", "succeeded", "paid"]);

// Canonical accessMode values
// freeAccess: formerly openAccess (no gate)
// emailAccess: form/email gate
// passwordAccess: password gate
// paidAccess: payment gate
const ACCESS_MODES = new Set(["freeAccess", "emailAccess", "passwordAccess", "paidAccess"]);

const normalizeAccessMode = (value) => {
  if (!value) return null;
  const candidate = value.toString().trim();
  if (ACCESS_MODES.has(candidate)) return candidate;
  return null;
};

const resolveAccessMode = (event = {}) => normalizeAccessMode(event.accessMode) || "freeAccess";

const normalizePaymentStatus = (status) => (typeof status === "string" ? status.toLowerCase() : "none");

const getClientIp = (req) => {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded && typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.ip;
};

const validEmail = (e) => typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export default class AccessController {
  static async verifyAccess(req, res) {
    try {
      const { eventId } = req.params;
      let { clientViewerId, email, name, password, formData, deviceType, paymentStatus = "none", metadata, mode } = req.body || {};

      if (!eventId) return res.status(400).json({ message: "Missing eventId" });

      const eventResult = await dynamoDB.get({ TableName: EVENTS_TABLE, Key: { eventId } }).promise();
      if (!eventResult.Item) return res.status(404).json({ message: "Event not found" });
      const event = eventResult.Item;

      const accessMode = resolveAccessMode(event);
      const paymentGateEnabled = accessMode === "paidAccess" || Boolean(event.isPaidEvent || event.paymentAmount);

      let accessGranted = false;
      let message = "";

      // Normalize mode for passwordAccess flows
      const normalizedMode = typeof mode === "string" ? mode.toLowerCase() : "login";

      // Validate per-accessMode viewer inputs
      if (accessMode === "freeAccess") {
        // open/free access: no viewer fields are strictly required
      } else if (accessMode === "emailAccess") {
        const registrationPayload = formData && typeof formData === "object" ? formData : {};

        const primaryEmail = email || registrationPayload.email;
        const firstName = registrationPayload.firstName || registrationPayload.fname || null;
        const lastName = registrationPayload.lastName || registrationPayload.lname || null;

        if (!firstName || !lastName || !primaryEmail) {
          return res.status(400).json({ message: "firstName, lastName and email are required for Email Access" });
        }

        if (!validEmail(primaryEmail)) {
          return res.status(400).json({ message: "invalid email" });
        }

        // Build a normalized formData with firstName, lastName, email
        if (!formData || typeof formData !== "object") {
          formData = {
            firstName,
            lastName,
            email: primaryEmail,
          };
        } else {
          formData.email = formData.email || primaryEmail;
          if (!formData.firstName && firstName) formData.firstName = firstName;
          if (!formData.lastName && lastName) formData.lastName = lastName;
        }

        // Derive display name from firstName/lastName if not provided
        if (!name && (firstName || lastName)) {
          name = [firstName, lastName].filter(Boolean).join(" ");
        }
        email = primaryEmail;
      } else if (accessMode === "passwordAccess") {
        const flowMode = normalizedMode === "register" ? "register" : "login";

        if (flowMode === "register") {
          const registrationPayload = formData && typeof formData === "object" ? formData : {};

          const primaryEmail = email || registrationPayload.email;
          const firstName = registrationPayload.firstName || registrationPayload.fname || null;
          const lastName = registrationPayload.lastName || registrationPayload.lname || null;

          if (!firstName || !lastName || !primaryEmail) {
            return res.status(400).json({ message: "firstName, lastName and email are required for Password Access registration" });
          }

          if (!validEmail(primaryEmail)) {
            return res.status(400).json({ message: "invalid email" });
          }

          // Normalize formData
          if (!formData || typeof formData !== "object") {
            formData = {
              firstName,
              lastName,
              email: primaryEmail,
            };
          } else {
            formData.email = formData.email || primaryEmail;
            if (!formData.firstName && firstName) formData.firstName = firstName;
            if (!formData.lastName && lastName) formData.lastName = lastName;
          }

          if (!name && (firstName || lastName)) {
            name = [firstName, lastName].filter(Boolean).join(" ");
          }

          email = primaryEmail;

          const storedPassword = event.accessPassword || event.password;
          if (!storedPassword) return res.status(500).json({ message: "Event password not configured" });

          // Fire-and-forget invoke of the sendPassword Lambda to email the password
          try {
            const lambdaPayload = {
              eventId,
              clientViewerId,
              email,
              formData: {
                firstName,
                lastName,
                email,
              },
            };

            console.log("[requestAccess] invoking sendPassword Lambda with:", lambdaPayload);

            await lambda
              .invoke({
                FunctionName: process.env.SEND_PASSWORD_LAMBDA || "sendPassword",
                InvocationType: "Event", // async, do not wait for email to finish
                Payload: JSON.stringify(lambdaPayload),
              })
              .promise();
          } catch (err) {
            console.error("[requestAccess] ERROR invoking sendPassword Lambda:", err);
            // Do not block registration on email failure; Lambda errors can be inspected in CloudWatch
          }

          accessGranted = false;
          message = "Registration successful. Password will be sent via email.";
        } else {
          if (!email) return res.status(400).json({ message: "email is required for Password Access" });
          if (!password) return res.status(400).json({ message: "password is required for Password Access" });
          const storedPassword = event.accessPassword || event.password;
          if (!storedPassword) return res.status(500).json({ message: "Event password not configured" });
          const matches = storedPassword.startsWith("$2") ? await bcrypt.compare(password, storedPassword) : storedPassword === password;
          if (!matches) return res.status(403).json({ message: "Invalid password" });
        }
      } else if (accessMode === "paidAccess") {
        if (!email) return res.status(400).json({ message: "email is required for Paid Access" });
        // paymentAmount itself is configured on the event; here we only need viewer email
        email = email;
      }

      // Decide accessGranted + message after validating inputs
      if (accessMode === "freeAccess") {
        accessGranted = true;
        message = "Free access granted";
      } else if (accessMode === "emailAccess") {
        accessGranted = true;
        message = "Email verified";
      } else if (accessMode === "passwordAccess") {
        // For register mode, accessGranted may already be false with message set above
        if (normalizedMode !== "register") {
          accessGranted = true;
          message = "Password accepted";
        }
      } else if (accessMode === "paidAccess") {
        accessGranted = true;
        message = "Payment status pending";
      }

      const normalizedPaymentStatus = normalizePaymentStatus(paymentStatus);
      if (paymentGateEnabled) {
        const paymentVerified = SUCCESS_STATES.has(normalizedPaymentStatus);
        if (!paymentVerified) {
          accessGranted = false;
          message = "Payment confirmation required";
        }
      }

      // For freeAccess, clientViewerId is optional — we will not persist without it
      const shouldPersistViewer = Boolean(clientViewerId);
      let existingViewer = null;
      if (shouldPersistViewer) {
        const viewerKey = { eventId, clientViewerId };
        try {
          const viewerResult = await dynamoDB.get({ TableName: VIEWERS_TABLE, Key: viewerKey }).promise();
          existingViewer = viewerResult.Item || null;
        } catch (error) {
          console.error("Viewer lookup failed", error);
        }
      }

      const now = new Date().toISOString();
      const viewerId = existingViewer?.viewerId || uuidv4();
      const ipAddress = existingViewer?.ipAddress || getClientIp(req);
      const paymentResolved = SUCCESS_STATES.has(normalizedPaymentStatus);

      const viewerItem = {
        eventId,
        clientViewerId,
        viewerId,
        email: email || existingViewer?.email || (formData && formData.email) || null,
        name:
          name ||
          existingViewer?.name ||
          (formData &&
            [formData.firstName, formData.lastName]
              .filter(Boolean)
              .join(" ")) ||
          null,
        accessMode: accessMode,
        formData: formData || existingViewer?.formData || null,
        isPaidViewer: paymentGateEnabled ? paymentResolved : existingViewer?.isPaidViewer || false,
        paymentStatus: paymentGateEnabled ? normalizedPaymentStatus : existingViewer?.paymentStatus || normalizedPaymentStatus,
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

      if (shouldPersistViewer) {
        try {
          await dynamoDB.put({ TableName: VIEWERS_TABLE, Item: viewerItem }).promise();
        } catch (error) {
          console.error("Viewer upsert failed", error);
        }
      }

      let token = null;
      if (accessGranted) {
        try {
          token = signViewerToken({
            viewerId,
            eventId,
            accessMode: accessMode,
            isPaidViewer: viewerItem.isPaidViewer,
          });
        } catch (error) {
          console.error("Token sign failed", error);
        }
      }

      return res.status(200).json({
        success: true,
        accessGranted,
        accessMode,
        needsPayment: paymentGateEnabled && !accessGranted,
        status: accessGranted ? "success" : "failure",
        message,
        viewerId,
        token,
      });
    } catch (error) {
      console.error("verifyAccess error", error);
      return res.status(500).json({ success: false, message: "Unable to verify access" });
    }
  }
  // Unified access entrypoint for all access modes
  static async requestAccess(req, res) {
    // Reuse verifyAccess logic as the single gateway
    return AccessController.verifyAccess(req, res);
  }

  // List all viewers with their accessMode and access status
  static async listViewers(req, res) {
    try {
      const { eventId } = req.query;

      const params = {
        TableName: VIEWERS_TABLE,
      };

      if (eventId) {
        params.FilterExpression = "eventId = :e";
        params.ExpressionAttributeValues = { ":e": eventId };
      }

      const items = [];
      let lastKey;
      do {
        const resp = await dynamoDB.scan({ ...params, ExclusiveStartKey: lastKey }).promise();
        if (resp.Items) items.push(...resp.Items);
        lastKey = resp.LastEvaluatedKey;
      } while (lastKey);

      const viewers = items.map((v) => ({
        viewerId: v.viewerId,
        eventId: v.eventId,
        clientViewerId: v.clientViewerId,
        accessMode: resolveAccessMode({ accessMode: v.accessMode }),
        accessVerified: Boolean(v.accessVerified),
        status: v.accessVerified ? "success" : "failure",
        isPaidViewer: Boolean(v.isPaidViewer),
        paymentStatus: v.paymentStatus || "none",
        firstJoinAt: v.firstJoinAt,
        lastJoinAt: v.lastJoinAt,
      }));

      return res.status(200).json({ success: true, count: viewers.length, viewers });
    } catch (error) {
      console.error("listViewers error", error);
      return res.status(500).json({ success: false, message: "Unable to list viewers" });
    }
  }

  // Fetch accessMode details for a viewer
  static async getViewerAccessMode(req, res) {
    try {
      const { viewerId } = req.params;

      if (!viewerId) {
        return res.status(400).json({ message: "Missing viewerId" });
      }

      // Scan viewers table for this viewerId (event-agnostic)
      const result = await dynamoDB
        .scan({
          TableName: VIEWERS_TABLE,
          FilterExpression: "viewerId = :v",
          ExpressionAttributeValues: { ":v": viewerId },
          Limit: 1,
        })
        .promise();

      const item = (result.Items || [])[0];
      if (!item) {
        return res.status(404).json({ message: "Viewer not found" });
      }

      const accessMode = resolveAccessMode({ accessMode: item.accessMode });
      return res.status(200).json({
        success: true,
        viewerId: item.viewerId,
        eventId: item.eventId,
        clientViewerId: item.clientViewerId,
        accessMode,
        isPaidViewer: Boolean(item.isPaidViewer),
        paymentStatus: item.paymentStatus || "none",
      });
    } catch (error) {
      console.error("getViewerAccessMode error", error);
      return res.status(500).json({ success: false, message: "Unable to fetch viewer accessMode" });
    }
  }
}
