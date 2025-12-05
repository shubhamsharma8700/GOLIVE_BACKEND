import { dynamoDB } from "../config/awsClients.js";

// Allow table name to be configured via env; fall back to default for
// local/dev until infrastructure is updated.
const ANALYTICS_TABLE =
  process.env.ANALYTICS_TABLE_NAME || "go-live-analytics";

class AnalyticsController {
  static async upsertSession(req, res) {
    try {
      // Minimal payload validation. TODO: tighten rules (e.g. max durations,
      // stricter schemas) once client usage is stable.
      const { sessionId, eventId, startTime, durationSec } = req.body || {};

      if (!sessionId || String(sessionId).length > 128) {
        return res
          .status(400)
          .json({ error: "Invalid or missing sessionId" });
      }

      if (!eventId) {
        return res.status(400).json({ error: "Missing eventId" });
      }

      if (!startTime || Number.isNaN(Date.parse(startTime))) {
        return res
          .status(400)
          .json({ error: "Invalid or missing startTime" });
      }

      if (
        durationSec !== undefined &&
        typeof durationSec !== "number"
      ) {
        return res
          .status(400)
          .json({ error: "durationSec must be a number" });
      }

      const {
        viewerId,
        endTime,
        isPaidViewer,
        deviceInfo,
        location,
        network,
        meta,
      } = req.body || {};

      const item = {
        sessionId,
        eventId,
        viewerId,
        startTime,
        endTime: endTime || null,
        duration: typeof durationSec === "number" ? durationSec : undefined,
        isPaidViewer: Boolean(isPaidViewer),
        deviceInfo: deviceInfo || undefined,
        location: location || undefined,
        network: network || undefined,
        meta: meta || undefined,
      };

      // Clean out undefined so we don't overwrite existing attributes with them
      Object.keys(item).forEach((key) => {
        if (item[key] === undefined) {
          delete item[key];
        }
      });

      await dynamoDB
        .put({
          TableName: ANALYTICS_TABLE,
          Item: item,
        })
        .promise();

      return res.status(200).json({ message: "Session analytics recorded" });
    } catch (error) {
      console.error("upsertSession error", error);
      return res
        .status(500)
        .json({ message: "Failed to record analytics session" });
    }
  }

  static async getEventSummary(req, res) {
    try {
      const { eventId } = req.params;
      const range = req.query.range || "24h";

      if (!eventId) {
        return res.status(400).json({ message: "eventId is required" });
      }

      const now = new Date();
      const from = new Date(now);
      if (range === "1h") {
        from.setHours(now.getHours() - 1);
      } else if (range === "7d") {
        from.setDate(now.getDate() - 7);
      } else {
        from.setDate(now.getDate() - 1);
      }

      const fromISO = from.toISOString();

      // Prefer a query on a GSI (eventId + startTime) over a full table
      // scan. This assumes a GSI named "event-startTime-index" exists; if it
      // does not yet, the call will fail at runtime and should be addressed
      // alongside infrastructure changes.
      // TODO: create GSI (PK: eventId, SK: startTime) for this access pattern.
      const queryParams = {
        TableName: ANALYTICS_TABLE,
        IndexName: "event-startTime-index",
        KeyConditionExpression: "eventId = :eid AND #startTime >= :from",
        ExpressionAttributeNames: {
          "#startTime": "startTime",
        },
        ExpressionAttributeValues: {
          ":eid": eventId,
          ":from": fromISO,
        },
        Limit: 1000,
      };

      const items = [];
      let lastEvaluatedKey;

      do {
        const params = lastEvaluatedKey
          ? { ...queryParams, ExclusiveStartKey: lastEvaluatedKey }
          : queryParams;

        const data = await dynamoDB.query(params).promise();
        if (data.Items) {
          items.push(...data.Items);
        }
        lastEvaluatedKey = data.LastEvaluatedKey;
      } while (lastEvaluatedKey);

      // Aggregation logic unchanged below – compute KPIs, timeseries, and break
      let totalViews = 0;
      let totalWatchTimeSec = 0;
      const viewerSet = new Set();
      let paidViewers = 0;
      const deviceCounts = {};
      const countryCounts = {};
      const minuteConcurrent = new Map();

      for (const s of items) {
        const sessionId = s.sessionId;
        const viewerId = s.viewerId || sessionId;
        const duration = Number(s.duration) || 0;
        const isPaid = Boolean(s.isPaidViewer);
        const deviceType = (s.deviceInfo && s.deviceInfo.deviceType) || "unknown";
        const country = (s.location && s.location.country) || "unknown";
        const startTime = s.startTime ? new Date(s.startTime) : null;
        const endTime = s.endTime ? new Date(s.endTime) : null;

        totalViews += 1;
        totalWatchTimeSec += duration;
        viewerSet.add(viewerId);
        if (isPaid) {
          paidViewers += 1;
        }
        deviceCounts[deviceType] = (deviceCounts[deviceType] || 0) + 1;
        countryCounts[country] = (countryCounts[country] || 0) + 1;

        if (startTime && endTime && endTime > from) {
          const clampedStart = new Date(Math.max(startTime.getTime(), from.getTime()));
          clampedStart.setSeconds(0, 0);
          const endBucket = new Date(endTime);
          endBucket.setSeconds(0, 0);

          for (
            let t = new Date(clampedStart);
            t <= endBucket;
            t.setMinutes(t.getMinutes() + 1)
          ) {
            const key = t.toISOString();
            minuteConcurrent.set(key, (minuteConcurrent.get(key) || 0) + 1);
          }
        }
      }

      const uniqueViewers = viewerSet.size;
      const avgWatchTimeSec = totalViews > 0 ? totalWatchTimeSec / totalViews : 0;

      const concurrentSeries = Array.from(minuteConcurrent.entries())
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([ts, value]) => ({ ts, value }));

      const concurrentPeak = concurrentSeries.reduce(
        (max, point) => (point.value > max ? point.value : max),
        0
      );

      const breakdownDevices = Object.entries(deviceCounts).map(
        ([device, count]) => ({ device, count })
      );

      const breakdownCountries = Object.entries(countryCounts).map(
        ([country, count]) => ({ country, count })
      );

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
        timeseries: {
          concurrent: concurrentSeries,
        },
        breakdowns: {
          byDevice: breakdownDevices,
          byCountry: breakdownCountries,
        },
      });
    } catch (error) {
      console.error("getEventSummary error", error);
      return res
        .status(500)
        .json({ message: "Failed to load analytics summary" });
    }
  }

  static async getRecentSessions(req, res) {
    try {
      const { eventId } = req.params;
      const limit = Number(req.query.limit) || 50;

      if (!eventId) {
        return res.status(400).json({ message: "eventId is required" });
      }

      const baseParams = {
        TableName: ANALYTICS_TABLE,
        FilterExpression: "#eventId = :eventId",
        ExpressionAttributeNames: {
          "#eventId": "eventId",
        },
        ExpressionAttributeValues: {
          ":eventId": eventId,
        },
      };

      const items = [];
      let lastEvaluatedKey;

      do {
        const params = lastEvaluatedKey
          ? { ...baseParams, ExclusiveStartKey: lastEvaluatedKey }
          : baseParams;

        const data = await dynamoDB.scan(params).promise();
        if (data.Items) {
          items.push(...data.Items);
        }
        lastEvaluatedKey = data.LastEvaluatedKey;
      } while (lastEvaluatedKey && items.length < limit * 2);

      const sorted = items
        .filter((s) => s.startTime)
        .sort((a, b) =>
          a.startTime < b.startTime ? 1 : a.startTime > b.startTime ? -1 : 0
        )
        .slice(0, limit);

      const sessions = sorted.map((s) => ({
        sessionId: s.sessionId,
        viewerId: s.viewerId || null,
        eventId: s.eventId,
        startTime: s.startTime,
        endTime: s.endTime || null,
        duration: Number(s.duration) || 0,
        isPaidViewer: Boolean(s.isPaidViewer),
        deviceType: (s.deviceInfo && s.deviceInfo.deviceType) || "unknown",
      }));

      return res.json({ eventId, sessions });
    } catch (error) {
      console.error("getRecentSessions error", error);
      return res
        .status(500)
        .json({ message: "Failed to load recent sessions" });
    }
  }
}

export default AnalyticsController;
