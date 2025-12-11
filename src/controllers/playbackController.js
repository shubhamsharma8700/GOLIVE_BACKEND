// src/controllers/playbackController.js
import {
  ddbDocClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  ScanCommand,
} from "../config/awsClients.js";

import { v4 as uuidv4 } from "uuid";
import { signViewerToken } from "../utils/viewerJwt.js";
import bcrypt from "bcryptjs";

const EVENTS_TABLE = process.env.EVENTS_TABLE_NAME || "go-live-poc-events";
const VIEWERS_TABLE = process.env.VIEWERS_TABLE_NAME || "go-live-poc-viewers";
const SESSIONS_TABLE = process.env.SESSIONS_TABLE_NAME || "go-live-poc-sessions";

const nowISO = () => new Date().toISOString();

export default class PlaybackController {

  /**
   * GET /api/playback/:eventId/access
   * Describe access model & registration fields (frontend will decide UI)
   */
  static async getAccessConfig(req, res) {
    try {
      const { eventId } = req.params;
      if (!eventId) return res.status(400).json({ success: false, message: "eventId required" });

      const { Item } = await ddbDocClient.send(
        new GetCommand({ TableName: EVENTS_TABLE, Key: { eventId } })
      );

      if (!Item) return res.status(404).json({ success: false, message: "Event not found" });

      const accessMode = Item.accessMode || "freeAccess";

      // determine required fields depending on mode
      const requiresForm = accessMode === "emailAccess" || accessMode === "passwordAccess" || accessMode === "paidAccess";
      const requiresPassword = accessMode === "passwordAccess";

      // default/explicit registration fields come from event.registrationFields (if any)
      const registrationFields = Array.isArray(Item.registrationFields)
        ? Item.registrationFields
        : (Item.registrationFields ? Object.entries(Item.registrationFields).map(([id, cfg]) => ({ id, ...cfg })) : []);

      return res.status(200).json({
        success: true,
        accessMode,
        requiresForm,
        requiresPassword,
        registrationFields,
      });
    } catch (err) {
      console.error("getAccessConfig error", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/playback/:eventId/register
   * Register a viewer record (per-event viewerToken). Returns viewerToken.
   */
  static async registerViewer(req, res) {
    try {
      const { eventId } = req.params;
      const { clientViewerId, formData, name, email, deviceInfo, ipAddress } = req.body || {};

      if (!eventId) return res.status(400).json({ success: false, message: "eventId required" });

      // fetch event
      const { Item: event } = await ddbDocClient.send(
        new GetCommand({ TableName: EVENTS_TABLE, Key: { eventId } })
      );
      if (!event) return res.status(404).json({ success: false, message: "Event not found" });

      // Build viewer record
      const viewerToken = uuidv4(); // per-event token
      const now = nowISO();
      const accessType = (() => {
        if (event.accessMode === "passwordAccess") return "password";
        if (event.accessMode === "emailAccess") return "form";
        if (event.accessMode === "paidAccess") return "form"; // payment handled separately
        return "anonymous";
      })();

      const accessVerified = event.accessMode === "freeAccess"; // auto-verified for freeAccess

      const viewerItem = {
        viewerToken,
        eventId,
        clientViewerId: clientViewerId || null,
        email: email || (formData && formData.email) || null,
        name: name || (formData && formData.name) || null,
        accessType,
        formData: formData || null,
        isPaidViewer: false,
        paymentStatus: "none",
        accessVerified: !!accessVerified,
        deviceType: deviceInfo?.deviceType || null,
        ipAddress: ipAddress || req.ip || null,
        firstJoinAt: now,
        lastJoinAt: now,
        totalSessions: 0,
        totalWatchTime: 0,
        createdAt: now,
        updatedAt: now,
      };

      // store viewer
      await ddbDocClient.send(
        new PutCommand({
          TableName: VIEWERS_TABLE,
          Item: viewerItem,
        })
      );

      // sign a token with minimal payload (viewerToken, eventId)
      const token = signViewerToken({ viewerToken, eventId });

      return res.status(201).json({
        success: true,
        viewerToken: token,
        eventId,
        accessVerified,
      });
    } catch (err) {
      console.error("registerViewer error", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/playback/:eventId/verify-password
   * Verify the event's single password (password sent to the user's email by admin or system).
   * Body: { viewerToken, password }
   */
  static async verifyPassword(req, res) {
    try {
      const { eventId } = req.params;
      const { viewerToken, password } = req.body || {};

      if (!eventId || !viewerToken || !password)
        return res.status(400).json({ success: false, message: "Missing parameters" });

      // fetch event, ensure password exists
      const { Item: event } = await ddbDocClient.send(
        new GetCommand({ TableName: EVENTS_TABLE, Key: { eventId } })
      );
      if (!event) return res.status(404).json({ success: false, message: "Event not found" });

      if (event.accessMode !== "passwordAccess") {
        return res.status(400).json({ success: false, message: "Event is not password protected" });
      }
      if (!event.accessPassword) {
        return res.status(400).json({ success: false, message: "No password configured for this event" });
      }

      // fetch viewer record by viewerToken key (viewerToken is stored in DB)
      const { Item: viewer } = await ddbDocClient.send(
        new GetCommand({ TableName: VIEWERS_TABLE, Key: { viewerToken } })
      );

      if (!viewer || viewer.eventId !== eventId) {
        return res.status(404).json({ success: false, message: "Viewer record not found" });
      }

      // compare password against event.accessPassword (hashed)
      const match = await bcrypt.compare(password, event.accessPassword);
      if (!match) return res.status(401).json({ success: false, message: "Invalid password" });

      // mark viewer.accessVerified = true
      await ddbDocClient.send(
        new UpdateCommand({
          TableName: VIEWERS_TABLE,
          Key: { viewerToken },
          UpdateExpression: "SET accessVerified = :t, updatedAt = :u",
          ExpressionAttributeValues: {
            ":t": true,
            ":u": nowISO(),
          },
          ReturnValues: "UPDATED_NEW",
        })
      );

      return res.status(200).json({ success: true, accessVerified: true });
    } catch (err) {
      console.error("verifyPassword error", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/playback/:eventId/stream
   * Requires viewerAuth middleware (verifies viewer token). Returns the stream URL if allowed.
   */
  static async getStream(req, res) {
    try {
      const { eventId } = req.params;
      const viewerPayload = req.viewer; // from viewerAuth: { viewerToken, eventId, ... }

      if (!eventId) return res.status(400).json({ success: false, message: "Missing eventId" });
      if (!viewerPayload) return res.status(401).json({ success: false, message: "Missing viewer token" });

      const { viewerToken } = viewerPayload;

      // fetch viewer
      const { Item: viewer } = await ddbDocClient.send(
        new GetCommand({ TableName: VIEWERS_TABLE, Key: { viewerToken } })
      );

      if (!viewer || viewer.eventId !== eventId) {
        return res.status(403).json({ success: false, message: "Viewer not authorized for this event" });
      }

      // load event
      const { Item: event } = await ddbDocClient.send(
        new GetCommand({ TableName: EVENTS_TABLE, Key: { eventId } })
      );
      if (!event) return res.status(404).json({ success: false, message: "Event not found" });

      // check paidAccess
      if (event.accessMode === "paidAccess" && !viewer.isPaidViewer) {
        return res.status(402).json({ success: false, message: "Payment required" });
      }

      // check accessVerified (for password/email)
      if ((event.accessMode === "passwordAccess" || event.accessMode === "emailAccess") && !viewer.accessVerified) {
        return res.status(403).json({ success: false, message: "Viewer has not completed registration/verification" });
      }

      // derive stream URL: prefer CloudFront / mediaPackage / vod urls
      const streamUrl =
        event.cloudFrontUrl ||
        event.mediaPackageUrl ||
        event.vodCloudFrontUrl ||
        event.vod1080pUrl ||
        event.liveUrl ||
        event.vodUrl ||
        null;

      if (!streamUrl) {
        return res.status(503).json({ success: false, message: "Stream URL not configured" });
      }

      // update viewer lastJoinAt
      await ddbDocClient.send(
        new UpdateCommand({
          TableName: VIEWERS_TABLE,
          Key: { viewerToken },
          UpdateExpression: "SET lastJoinAt = :t, updatedAt = :t",
          ExpressionAttributeValues: { ":t": nowISO() },
        })
      );

      return res.status(200).json({
        success: true,
        streamUrl,
        eventType: event.eventType || "live",
      });
    } catch (err) {
      console.error("getStream error", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/playback/:eventId/session
   * Log session start/end for analytics.
   * Body: { action: "start"|"end", sessionId?, viewerToken, deviceInfo?, ipAddress?, endTime?, duration? }
   */
  static async logSession(req, res) {
    try {
      const { eventId } = req.params;
      const { action, sessionId, viewerToken, deviceInfo, ipAddress, endTime, duration } = req.body || {};

      if (!eventId || !action) return res.status(400).json({ success: false, message: "eventId and action required" });
      if (!viewerToken) return res.status(400).json({ success: false, message: "viewerToken required" });

      if (action === "start") {
        const sid = sessionId || uuidv4();
        const now = nowISO();

        // write session
        await ddbDocClient.send(
          new PutCommand({
            TableName: SESSIONS_TABLE,
            Item: {
              sessionId: sid,
              eventId,
              viewerToken,
              startTime: now,
              endTime: null,
              duration: 0,
              playbackType: "live", // frontend may pass different
              deviceInfo: deviceInfo || null,
              ipAddress: ipAddress || req.ip || null,
              createdAt: now,
            },
          })
        );

        // increment viewer.totalSessions and update lastJoinAt
        await ddbDocClient.send(
          new UpdateCommand({
            TableName: VIEWERS_TABLE,
            Key: { viewerToken },
            UpdateExpression: "SET lastJoinAt = :t, totalSessions = if_not_exists(totalSessions, :zero) + :inc, updatedAt = :t",
            ExpressionAttributeValues: { ":t": nowISO(), ":inc": 1, ":zero": 0 },
          })
        );

        return res.status(201).json({ success: true, sessionId: sid });
      }

      if (action === "end") {
        if (!sessionId) return res.status(400).json({ success: false, message: "sessionId required for end" });

        // update session end/time/duration
        const end = endTime || nowISO();
        const dur = typeof duration === "number" ? duration : null;

        // patch session (simple put-style: update fields)
        const updateExp = [
          "SET endTime = :end",
          "updatedAt = :u"
        ];
        const attr = { ":end": end, ":u": nowISO() };

        if (dur !== null) {
          updateExp.push("duration = if_not_exists(duration, :zero) + :d");
          attr[":d"] = dur;
          attr[":zero"] = 0;
        }

        await ddbDocClient.send(
          new UpdateCommand({
            TableName: SESSIONS_TABLE,
            Key: { sessionId },
            UpdateExpression: updateExp.join(", "),
            ExpressionAttributeValues: attr,
          })
        );

        // increment viewer totalWatchTime
        if (dur !== null) {
          await ddbDocClient.send(
            new UpdateCommand({
              TableName: VIEWERS_TABLE,
              Key: { viewerToken },
              UpdateExpression: "SET totalWatchTime = if_not_exists(totalWatchTime, :zero) + :d, updatedAt = :u",
              ExpressionAttributeValues: { ":d": dur, ":zero": 0, ":u": nowISO() },
            })
          );
        }

        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ success: false, message: "Unknown action" });
    } catch (err) {
      console.error("logSession error", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

}
