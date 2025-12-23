import {
  ddbDocClient,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from "../config/awsClients.js";
import { v4 as uuidv4 } from "uuid";
import { extractViewerContext } from "../utils/cloudfrontHeaders.js";

const ANALYTICS_TABLE =
  process.env.ANALYTICS_TABLE || "go-live-analytics";

const VIEWERS_TABLE =
  process.env.VIEWERS_TABLE_NAME || "go-live-viewers";

const nowISO = () => new Date().toISOString();

export default class AnalyticsController {

  /* ============================================================
     1. START SESSION (Viewer)
     ============================================================ */
  static async startSession(req, res) {
    try {
      const { eventId } = req.params;
      const viewer = req.viewer;

      if (!viewer || viewer.eventId !== eventId) {
        return res.status(401).json({
          success: false,
          message: "Viewer unauthorized for this event",
        });
      }

      const sessionId = uuidv4();
      const now = nowISO();

      // Trusted network context (CloudFront)
      const viewerContext = extractViewerContext(req);

      /* ---------------- SESSION ITEM ---------------- */
      const sessionItem = {
        sessionId,

        // GSIs
        eventId,
        clientViewerId: viewer.clientViewerId,

        viewerToken: viewer.viewerToken,
        playbackType: req.body?.playbackType || "vod",

        device: {
          deviceType: req.body?.deviceInfo?.deviceType || null,
          userAgent: req.body?.deviceInfo?.userAgent || null,
          browser: req.body?.deviceInfo?.browser || null,
          os: req.body?.deviceInfo?.os || null,
          screen: req.body?.deviceInfo?.screen || null,
          timezone: req.body?.deviceInfo?.timezone || null,
        },

        network: viewerContext,

        startTime: now,
        endTime: null,
        duration: 0,

        createdAt: now,
      };

      /* ---------------- SAVE SESSION ---------------- */
      await ddbDocClient.send(
        new PutCommand({
          TableName: ANALYTICS_TABLE,
          Item: sessionItem,
        })
      );

      /* ---------------- UPDATE VIEWER ---------------- */
      await ddbDocClient.send(
        new UpdateCommand({
          TableName: VIEWERS_TABLE,
          Key: {
            eventId,
            clientViewerId: viewer.clientViewerId,
          },
          UpdateExpression: `
            SET
              lastJoinAt = :now,
              lastActiveAt = :now,
              updatedAt = :now
            ADD
              totalSessions :one
          `,
          ExpressionAttributeValues: {
            ":now": now,
            ":one": 1,
          },
        })
      );

      return res.status(201).json({
        success: true,
        sessionId,
      });

    } catch (err) {
      console.error("startSession error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to start analytics session",
      });
    }
  }

  /* ============================================================
     2. END SESSION (Viewer)
     ============================================================ */
  static async endSession(req, res) {
    try {
      const { sessionId, duration } = req.body;

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          message: "sessionId required",
        });
      }

      const now = nowISO();
      const dur = Number(duration) || 0;

      /* ---------------- UPDATE SESSION ---------------- */
      await ddbDocClient.send(
        new UpdateCommand({
          TableName: ANALYTICS_TABLE,
          Key: { sessionId },
          UpdateExpression: "SET endTime = :end, #d = :dur",
          ExpressionAttributeNames: {
            "#d": "duration",
          },
          ExpressionAttributeValues: {
            ":end": now,
            ":dur": dur,
          },
        })
      );

      return res.status(200).json({ success: true });
    } catch (err) {
      console.error("endSession error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to end session",
      });
    }
  }

  /* ============================================================
     3. HEARTBEAT (Viewer)
     ============================================================ */
  static async heartbeat(req, res) {
    try {
      const { sessionId, seconds, eventId, clientViewerId } = req.body;

      if (!sessionId || !eventId || !clientViewerId) {
        return res.status(400).json({
          success: false,
          message: "sessionId, eventId, clientViewerId required",
        });
      }

      const increment = Math.max(0, Number(seconds) || 0);
      const now = nowISO();

      /* ---------------- UPDATE SESSION ---------------- */
      await ddbDocClient.send(
        new UpdateCommand({
          TableName: ANALYTICS_TABLE,
          Key: { sessionId },
          UpdateExpression: "ADD #d :sec",
          ExpressionAttributeNames: {
            "#d": "duration",
          },
          ExpressionAttributeValues: {
            ":sec": increment,
          },
        })
      );

      /* ---------------- UPDATE VIEWER ---------------- */
      await ddbDocClient.send(
        new UpdateCommand({
          TableName: VIEWERS_TABLE,
          Key: {
            eventId,
            clientViewerId,
          },
          UpdateExpression: `
            ADD totalWatchTime :sec
            SET lastActiveAt = :now, updatedAt = :now
          `,
          ExpressionAttributeValues: {
            ":sec": increment,
            ":now": now,
          },
        })
      );

      return res.status(200).json({ success: true });
    } catch (err) {
      console.error("heartbeat error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to update heartbeat",
      });
    }
  }

  /* ============================================================
     4. ADMIN — EVENT SUMMARY
     ============================================================ */
  static async getEventSummary(req, res) {
    try {
      const { eventId } = req.params;

      const raw = await ddbDocClient.send(
        new QueryCommand({
          TableName: ANALYTICS_TABLE,
          IndexName: "eventId-index",
          KeyConditionExpression: "eventId = :e",
          ExpressionAttributeValues: { ":e": eventId },
        })
      );

      const sessions = raw.Items || [];

      const totalSessions = sessions.length;
      const totalWatchTime = sessions.reduce(
        (sum, s) => sum + (s.duration || 0),
        0
      );

      return res.status(200).json({
        success: true,
        eventId,
        summary: {
          totalSessions,
          totalWatchTime,
          avgWatchTime: totalSessions
            ? Math.round(totalWatchTime / totalSessions)
            : 0,
        },
      });

    } catch (err) {
      console.error("getEventSummary error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch event summary",
      });
    }
  }

  /* ============================================================
     5. ADMIN — RECENT SESSIONS
     ============================================================ */
  static async getRecentSessions(req, res) {
    try {
      const { eventId } = req.params;

      const raw = await ddbDocClient.send(
        new QueryCommand({
          TableName: ANALYTICS_TABLE,
          IndexName: "eventId-index",
          KeyConditionExpression: "eventId = :e",
          ExpressionAttributeValues: { ":e": eventId },
          Limit: 50,
          ScanIndexForward: false,
        })
      );

      return res.status(200).json({
        success: true,
        eventId,
        sessions: raw.Items || [],
      });

    } catch (err) {
      console.error("getRecentSessions error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch recent sessions",
      });
    }
  }
}
