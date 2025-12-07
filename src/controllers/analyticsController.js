import {
  ddbDocClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  ScanCommand,
} from "../config/awsClients.js";

const ANALYTICS_TABLE =
  process.env.ANALYTICS_TABLE_NAME || "go-live-analytics";

class AnalyticsController {
  // ======================================================
  // UPSERT SESSION
  // ======================================================
  static async upsertSession(req, res) {
    try {
      const { sessionId, eventId, startTime, durationSec } = req.body || {};

      if (!sessionId || String(sessionId).length > 128)
        return res.status(400).json({ error: "Invalid or missing sessionId" });

      if (!eventId)
        return res.status(400).json({ error: "Missing eventId" });

      if (!startTime || Number.isNaN(Date.parse(startTime)))
        return res.status(400).json({ error: "Invalid or missing startTime" });

      if (durationSec !== undefined && typeof durationSec !== "number")
        return res.status(400).json({ error: "durationSec must be a number" });

      const { endTime, deviceInfo, location, network, meta } = req.body || {};

      const authViewer = req.viewer || req.user || null;
      const viewerId = authViewer?.viewerId || authViewer?.id || null;
      const isPaidViewer = authViewer ? Boolean(authViewer.isPaidViewer) : false;

      const item = {
        sessionId,
        eventId,
        viewerId,
        startTime,
        endTime: endTime || null,
        duration: typeof durationSec === "number" ? durationSec : undefined,
        isPaidViewer,
        deviceInfo: deviceInfo || undefined,
        location: location || undefined,
        network: network || undefined,
        meta: meta || undefined,
      };

      // Remove undefined fields
      Object.keys(item).forEach((k) => item[k] === undefined && delete item[k]);

      await ddbDocClient.send(
        new PutCommand({
          TableName: ANALYTICS_TABLE,
          Item: item,
        })
      );

      return res
        .status(200)
        .json({ message: "Session analytics recorded" });
    } catch (error) {
      console.error("upsertSession error", error);
      return res
        .status(500)
        .json({ message: "Failed to record analytics session" });
    }
  }

  // ======================================================
  // EVENT SUMMARY (AGGREGATED ANALYTICS)
  // ======================================================
  static async getEventSummary(req, res) {
    try {
      const { eventId } = req.params;
      const range = req.query.range || "24h";

      if (!eventId)
        return res.status(400).json({ message: "eventId is required" });

      const now = new Date();
      const from = new Date(now);

      if (range === "1h") from.setHours(now.getHours() - 1);
      else if (range === "7d") from.setDate(now.getDate() - 7);
      else from.setDate(now.getDate() - 1);

      const fromISO = from.toISOString();

      const queryParams = {
        TableName: ANALYTICS_TABLE,
        IndexName: "event-startTime-index",
        KeyConditionExpression: "eventId = :eid AND #startTime >= :from",
        ExpressionAttributeNames: { "#startTime": "startTime" },
        ExpressionAttributeValues: {
          ":eid": eventId,
          ":from": fromISO,
        },
        Limit: 1000,
      };

      const items = [];
      let lastKey;

      do {
        const resp = await ddbDocClient.send(
          new QueryCommand({
            ...queryParams,
            ExclusiveStartKey: lastKey,
          })
        );

        if (resp.Items) items.push(...resp.Items);
        lastKey = resp.LastEvaluatedKey;
      } while (lastKey);

      // ----------------- AGGREGATION -----------------
      let totalViews = 0;
      let totalWatchTimeSec = 0;
      const viewerSet = new Set();
      let paidViewers = 0;
      const deviceCounts = {};
      const countryCounts = {};
      const minuteConcurrent = new Map();

      for (const s of items) {
        const viewerId = s.viewerId || s.sessionId;
        const duration = Number(s.duration) || 0;
        const isPaid = Boolean(s.isPaidViewer);

        const deviceType = s?.deviceInfo?.deviceType || "unknown";
        const country = s?.location?.country || "unknown";

        const start = s.startTime ? new Date(s.startTime) : null;
        const end = s.endTime ? new Date(s.endTime) : null;

        totalViews += 1;
        totalWatchTimeSec += duration;
        viewerSet.add(viewerId);
        if (isPaid) paidViewers++;

        deviceCounts[deviceType] = (deviceCounts[deviceType] || 0) + 1;
        countryCounts[country] = (countryCounts[country] || 0) + 1;

        if (start && end && end > from) {
          const clamp = new Date(Math.max(start.getTime(), from.getTime()));
          clamp.setSeconds(0, 0);

          const endBucket = new Date(end);
          endBucket.setSeconds(0, 0);

          for (
            let t = new Date(clamp);
            t <= endBucket;
            t.setMinutes(t.getMinutes() + 1)
          ) {
            const key = t.toISOString();
            minuteConcurrent.set(key, (minuteConcurrent.get(key) || 0) + 1);
          }
        }
      }

      const uniqueViewers = viewerSet.size;
      const avgWatchTimeSec =
        totalViews > 0 ? totalWatchTimeSec / totalViews : 0;

      const concurrentSeries = Array.from(minuteConcurrent.entries())
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([ts, val]) => ({ ts, value: val }));

      const concurrentPeak =
        concurrentSeries.reduce(
          (max, p) => (p.value > max ? p.value : max),
          0
        ) || 0;

      return res.json({
        eventId,
        range,
        kpis: {
          totalViews,
          uniqueViewers,
          avgWatchTimeSec,
          paidViewers,
          concurrentPeak,
        },
        timeseries: { concurrent: concurrentSeries },
        breakdowns: {
          byDevice: Object.entries(deviceCounts).map(([d, c]) => ({
            device: d,
            count: c,
          })),
          byCountry: Object.entries(countryCounts).map(([c, v]) => ({
            country: c,
            count: v,
          })),
        },
      });
    } catch (error) {
      console.error("getEventSummary error", error);
      return res
        .status(500)
        .json({ message: "Failed to load analytics summary" });
    }
  }

  // ======================================================
  // RECENT SESSIONS
  // ======================================================
  static async getRecentSessions(req, res) {
    try {
      const { eventId } = req.params;
      const limit = Number(req.query.limit) || 50;

      if (!eventId)
        return res.status(400).json({ message: "eventId is required" });

      const safeLimit = Math.min(Math.max(limit, 1), 200);

      const queryParams = {
        TableName: ANALYTICS_TABLE,
        IndexName: "event-startTime-index",
        KeyConditionExpression: "eventId = :eid",
        ExpressionAttributeValues: { ":eid": eventId },
        ScanIndexForward: false,
        Limit: safeLimit,
      };

      const items = [];
      let lastKey;

      do {
        const resp = await ddbDocClient.send(
          new QueryCommand({
            ...queryParams,
            ExclusiveStartKey: lastKey,
          })
        );

        if (resp.Items) items.push(...resp.Items);
        lastKey = resp.LastEvaluatedKey;
      } while (lastKey && items.length < safeLimit);

      const sessions = items.map((s) => ({
        sessionId: s.sessionId,
        viewerId: s.viewerId || null,
        eventId: s.eventId,
        startTime: s.startTime,
        endTime: s.endTime || null,
        duration: Number(s.duration) || 0,
        isPaidViewer: Boolean(s.isPaidViewer),
        deviceType: (s.deviceInfo && s.deviceInfo.deviceType) || "unknown",
      }));

      return res.json({
        eventId,
        sessions,
        lastKey: lastKey || null,
      });
    } catch (error) {
      console.error("getRecentSessions error", error);
      return res
        .status(500)
        .json({ message: "Failed to load recent sessions" });
    }
  }
}

export default AnalyticsController;
