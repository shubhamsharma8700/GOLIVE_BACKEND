import {
  ddbDocClient,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from "../config/awsClients.js";
import { v4 as uuidv4 } from "uuid";

const ANALYTICS_TABLE =
  process.env.ANALYTICS_TABLE || "go-live-analytics";

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

      const item = {
        sessionId,                     // PK
        eventId,                       // GSI
        viewerToken: viewer.viewerToken,
        clientViewerId: viewer.clientViewerId,

        playbackType: req.body.playbackType || "vod",

        // Session-specific metadata
        deviceInfo: req.body.deviceInfo || {},
        location: req.body.location || {},

        // Trusted server-side IP
        ipAddress:
          req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
          req.socket.remoteAddress ||
          null,


        startTime: nowISO(),
        endTime: null,
        duration: 0,

        createdAt: nowISO(),
      };

      await ddbDocClient.send(
        new PutCommand({
          TableName: ANALYTICS_TABLE,
          Item: item,
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

      await ddbDocClient.send(
        new UpdateCommand({
          TableName: ANALYTICS_TABLE,
          Key: { sessionId },
          UpdateExpression: "SET endTime = :end, #d = :dur",
          ExpressionAttributeNames: {
            "#d": "duration",
          },
          ExpressionAttributeValues: {
            ":end": nowISO(),
            ":dur": Number(duration) || 0,
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
      const { sessionId, seconds } = req.body;

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          message: "sessionId required",
        });
      }

      const increment = Math.max(0, Number(seconds) || 0);

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
