import {
  ddbDocClient,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from "../config/awsClients.js";
import { v4 as uuidv4 } from "uuid";

const ANALYTICS_TABLE = process.env.ANALYTICS_TABLE || "go-live-analytics";
const VIEWERS_TABLE = process.env.VIEWERS_TABLE_NAME || "go-live-viewers";

const nowISO = () => new Date().toISOString();

export default class AnalyticsController {

  /* ============================================================
     1. START SESSION  (viewer)
     ============================================================ */
  static async startSession(req, res) {
    try {
      const { eventId } = req.params;
      const viewer = req.viewer;

      if (!viewer) {
        return res.status(401).json({ success: false, message: "Viewer unauthorized" });
      }

      const sessionId = uuidv4();

      const item = {
        sessionId,
        eventId,
        viewerId: viewer.viewerId,
        playbackType: req.body.playbackType || "vod",
        deviceInfo: req.body.deviceInfo || {},
        location: req.body.location || {},
        ipAddress: req.ip,
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

      return res.status(200).json({ success: true, sessionId });
    } catch (err) {
      console.error("startSession error:", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  /* ============================================================
     2. END SESSION  (viewer)
     ============================================================ */
  static async endSession(req, res) {
    try {
      const { sessionId, duration } = req.body;

      if (!sessionId)
        return res.status(400).json({ success: false, message: "sessionId required" });

      await ddbDocClient.send(
        new UpdateCommand({
          TableName: ANALYTICS_TABLE,
          Key: { sessionId },
          UpdateExpression: "set endTime = :end, duration = :dur",
          ExpressionAttributeValues: {
            ":end": nowISO(),
            ":dur": duration || 0,
          },
        })
      );

      return res.status(200).json({ success: true });
    } catch (err) {
      console.error("endSession error:", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  /* ============================================================
     3. HEARTBEAT (viewer)
     ============================================================ */
  static async heartbeat(req, res) {
    try {
      const { sessionId, seconds } = req.body;

      if (!sessionId)
        return res.status(400).json({ success: false, message: "sessionId required" });

      await ddbDocClient.send(
        new UpdateCommand({
          TableName: ANALYTICS_TABLE,
          Key: { sessionId },
          UpdateExpression: "ADD duration :sec",
          ExpressionAttributeValues: {
            ":sec": Number(seconds) || 0,
          },
        })
      );

      return res.status(200).json({ success: true });
    } catch (err) {
      console.error("heartbeat error:", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  /* ============================================================
     4. ADMIN — SUMMARY API (Required by your swagger)
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
      const totalWatchTime = sessions.reduce((sum, s) => sum + (s.duration || 0), 0);
      const avgWatch = totalSessions ? totalWatchTime / totalSessions : 0;

      return res.status(200).json({
        success: true,
        eventId,
        summary: {
          totalSessions,
          totalWatchTime,
          avgWatchTime: avgWatch,
        },
      });

    } catch (err) {
      console.error("getEventSummary error:", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  /* ============================================================
     5. ADMIN — RECENT SESSIONS API (Required by your swagger)
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
      return res.status(500).json({ success: false, message: err.message });
    }
  }

}
