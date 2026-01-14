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
      //const now = nowISO();
      const nowISOTime = new Date().toISOString();   // for logs & UI
      const nowEpoch = Date.now();                  // for GSI & queries


      // Trusted network context (CloudFront)
      const viewerContext = extractViewerContext(req);
        const info = req.body?.deviceInfo || {};
        const ua = info.userAgent || "";

        const deviceType = /Mobi|Android/i.test(ua) ? "mobile" : "desktop";
        

        let browser = null;
        if (/Edg/i.test(ua)) browser = "Edge";
        else if (/Chrome/i.test(ua)) browser = "Chrome";
        else if (/Firefox/i.test(ua)) browser = "Firefox";
        else if (/Safari/i.test(ua)) browser = "Safari";

        let os = null;
        if (/Windows/i.test(ua)) os = "Windows";
        else if (/Mac OS/i.test(ua)) os = "MacOS";
        else if (/Android/i.test(ua)) os = "Android";
        else if (/iPhone|iPad/i.test(ua)) os = "iOS";

      /* ---------------- SESSION ITEM ---------------- */
      const sessionItem = {
        sessionId,

        // GSIs
        eventId,
        clientViewerId: viewer.clientViewerId,

        viewerToken: viewer.viewerToken,
        playbackType: req.body?.playbackType || "vod",

        /*device: {
          deviceType: req.body?.deviceInfo?.deviceType || null,
          userAgent: req.body?.deviceInfo?.userAgent || null,
          browser: req.body?.deviceInfo?.browser || null,
          os: req.body?.deviceInfo?.os || null,
          screen: req.body?.deviceInfo?.screen || null,
          timezone: req.body?.deviceInfo?.timezone || null,
        }, */
      

        device: {
          deviceType,
          userAgent: ua,
          browser,
          os,
          screen: info.screen || null,
          timezone: info.timezone || null,
        },

        network: viewerContext,

        startTime: nowISOTime,
        endTime: null,
        duration: 0,

        createdAt: nowISOTime,
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
              lastJoinAt = :iso,
              lastActiveAt = :epoch,
              updatedAt = :iso,
              device = :device,
              totalSessions = if_not_exists(totalSessions, :zero) + :one
          `,
          ExpressionAttributeValues: {
            ":iso": nowISOTime,
            ":epoch": nowEpoch,
            ":one": 1,
            ":zero": 0,
             ":device": {
              deviceType,
              browser,
              os,
              userAgent: ua,
              screen: info.screen || null,
              timezone: info.timezone || null
            }
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
      //const now = nowISO();
      const nowISOTime = new Date().toISOString();
      const nowEpoch = Date.now();

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
            SET
              totalWatchTime = if_not_exists(totalWatchTime, :zero) + :sec,
              lastActiveAt = :epoch,
              updatedAt = :iso
          `,
          ExpressionAttributeValues: {
            ":sec": increment,
            ":epoch": nowEpoch,
            ":iso": nowISOTime,
            ":zero": 0
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
