import {
  BatchGetCommand,
  GetCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

import { ANALYTICS_TABLE, ddbDocClient } from "../config/awsClients.js";
import { enrichPaymentsWithUsd } from "../utils/currency.js";

const ANALYTICS_TABLE_NAME = ANALYTICS_TABLE;
const EVENTS_TABLE = process.env.EVENTS_TABLE_NAME || "go-live-poc-events";
const VIEWERS_TABLE =
  process.env.VIEWERS_TABLE_NAME || "go-live-poc-viewers";
const PAYMENTS_TABLE = process.env.PAYMENTS_TABLE || "go-live-payments";

const ANALYTICS_EVENT_INDEX = "eventId-index";
const PAYMENTS_EVENT_INDEX = "eventId-index";

const MONTH_FMT = new Intl.DateTimeFormat("en-US", { month: "short" });
const WEEKDAY_FMT = new Intl.DateTimeFormat("en-US", { weekday: "long" });

const DAY_ORDER = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const HOUR_LABELS = Array.from({ length: 24 }, (_, hour) =>
  `${String(hour).padStart(2, "0")}:00`
);

const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const toIsoOrNull = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
};

const formatDurationShort = (seconds) => {
  const safe = Math.max(0, toNumber(seconds));
  const minutes = Math.round(safe / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMins = minutes % 60;
  return `${hours}h ${remMins}m`;
};

const buildCompositeViewerKey = (eventId, clientViewerId) =>
  `${eventId}::${clientViewerId}`;

async function scanAllItems(tableName) {
  if (!tableName) return [];

  const all = [];
  let lastEvaluatedKey;

  do {
    const result = await ddbDocClient.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (result.Items?.length) {
      all.push(...result.Items);
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return all;
}

async function queryAll(input) {
  const all = [];
  let lastEvaluatedKey;

  do {
    const result = await ddbDocClient.send(
      new QueryCommand({
        ...input,
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (result.Items?.length) {
      all.push(...result.Items);
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return all;
}

function isMissingIndexError(err) {
  const msg = String(err?.message || "");
  return msg.includes("does not have the specified index");
}

async function fetchByEventIdWithFallback({
  tableName,
  eventId,
  indexName,
  allowPrimaryKeyQuery = false,
}) {
  if (allowPrimaryKeyQuery) {
    return queryAll({
      TableName: tableName,
      KeyConditionExpression: "eventId = :eid",
      ExpressionAttributeValues: {
        ":eid": eventId,
      },
    });
  }

  try {
    return await queryAll({
      TableName: tableName,
      IndexName: indexName,
      KeyConditionExpression: "eventId = :eid",
      ExpressionAttributeValues: {
        ":eid": eventId,
      },
    });
  } catch (err) {
    if (!isMissingIndexError(err)) throw err;
    return scanAllItems(tableName).then((items) =>
      items.filter((item) => item?.eventId === eventId)
    );
  }
}

async function fetchEventsMap(eventId, analyticsItems, viewerItems, paymentItems) {
  const eventIds = new Set();

  if (eventId) {
    eventIds.add(eventId);
  }

  analyticsItems.forEach((item) => item?.eventId && eventIds.add(item.eventId));
  viewerItems.forEach((item) => item?.eventId && eventIds.add(item.eventId));
  paymentItems.forEach((item) => item?.eventId && eventIds.add(item.eventId));

  if (eventIds.size === 0) {
    return {};
  }

  if (eventId && eventIds.size === 1) {
    const result = await ddbDocClient.send(
      new GetCommand({
        TableName: EVENTS_TABLE,
        Key: { eventId },
      })
    );

    return result.Item ? { [eventId]: result.Item } : {};
  }

  const ids = Array.from(eventIds);
  const eventsMap = {};

  const chunkSize = 100;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const keys = ids.slice(i, i + chunkSize).map((id) => ({ eventId: id }));

    const batchResult = await ddbDocClient.send(
      new BatchGetCommand({
        RequestItems: {
          [EVENTS_TABLE]: {
            Keys: keys,
          },
        },
      })
    );

    const events = batchResult.Responses?.[EVENTS_TABLE] || [];
    events.forEach((event) => {
      eventsMap[event.eventId] = event;
    });
  }

  return eventsMap;
}

function buildRegistrationSourceData(viewerItems) {
  const sourceMap = new Map();

  const classify = (viewer) => {
    const source =
      viewer?.formData?.source ||
      viewer?.formData?.utmSource ||
      viewer?.formData?.referrer ||
      viewer?.network?.source ||
      null;

    if (!source) return "Direct";

    const s = String(source).toLowerCase();
    if (s.includes("facebook") || s.includes("instagram") || s.includes("x") || s.includes("twitter") || s.includes("youtube") || s.includes("linkedin")) {
      return "Social Media";
    }
    if (s.includes("email") || s.includes("newsletter")) {
      return "Email Campaign";
    }
    if (s.includes("ref") || s.includes("affiliate")) {
      return "Referral";
    }

    return "Direct";
  };

  viewerItems.forEach((viewer) => {
    const key = classify(viewer);
    sourceMap.set(key, (sourceMap.get(key) || 0) + 1);
  });

  if (sourceMap.size === 0) {
    sourceMap.set("Direct", 0);
  }

  const colors = {
    Direct: "#B89B5E",
    "Social Media": "#3B82F6",
    "Email Campaign": "#10B981",
    Referral: "#EC4899",
  };

  const total = Array.from(sourceMap.values()).reduce((a, b) => a + b, 0);

  return Array.from(sourceMap.entries())
    .map(([source, count]) => ({
      source,
      count,
      color: colors[source] || "#6B7280",
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

export const getAnalyticsByEventId = async (req, res) => {
  try {
    const rawEventId = req.body?.eventId;
    const eventId =
      typeof rawEventId === "string" &&
      rawEventId.trim().toLowerCase() === "all"
        ? null
        : rawEventId || null;

    let analyticsItems = [];
    let viewerItems = [];
    let paymentItems = [];

    if (eventId) {
      analyticsItems = await fetchByEventIdWithFallback({
        tableName: ANALYTICS_TABLE_NAME,
        eventId,
        indexName: ANALYTICS_EVENT_INDEX,
      });

      viewerItems = await fetchByEventIdWithFallback({
        tableName: VIEWERS_TABLE,
        eventId,
        allowPrimaryKeyQuery: true,
      });

      paymentItems = await fetchByEventIdWithFallback({
        tableName: PAYMENTS_TABLE,
        eventId,
        indexName: PAYMENTS_EVENT_INDEX,
      });
    } else {
      const [allAnalytics, allViewers, allPayments] = await Promise.all([
        scanAllItems(ANALYTICS_TABLE_NAME),
        scanAllItems(VIEWERS_TABLE),
        scanAllItems(PAYMENTS_TABLE),
      ]);

      analyticsItems = allAnalytics;
      viewerItems = allViewers;
      paymentItems = allPayments;
    }

    const eventsMap = await fetchEventsMap(
      eventId,
      analyticsItems,
      viewerItems,
      paymentItems
    );

    const viewerMap = new Map();
    viewerItems.forEach((viewer) => {
      viewerMap.set(
        buildCompositeViewerKey(viewer.eventId, viewer.clientViewerId),
        viewer
      );
    });

    const now = new Date();
    const monthBuckets = [];
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setMonth(d.getMonth() - i, 1);
      d.setHours(0, 0, 0, 0);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      monthBuckets.push({
        key,
        month: MONTH_FMT.format(d),
        registered: 0,
        anonymous: 0,
      });
    }

    const monthBucketMap = new Map(monthBuckets.map((m) => [m.key, m]));

    const peakHourCounts = new Map(HOUR_LABELS.map((h) => [h, 0]));
    const weekdayMap = new Map(
      DAY_ORDER.map((day) => [day, { day, views: 0, totalWatchSeconds: 0 }])
    );

    const uniqueViewerKeys = new Set();
    let totalWatchTime = 0;

    const eventAggMap = new Map();

    const getEventAgg = (id) => {
      if (!eventAggMap.has(id)) {
        eventAggMap.set(id, {
          eventId: id,
          totalViews: 0,
          totalWatchSeconds: 0,
          uniqueViewers: new Set(),
          completionHits: 0,
          hourlySessionCount: new Map(),
          playbackTypeCount: new Map(),
        });
      }
      return eventAggMap.get(id);
    };

    analyticsItems.forEach((item) => {
      const sid = item?.sessionId || null;
      const eId = item?.eventId || null;
      const vId = item?.clientViewerId || null;
      const start = toIsoOrNull(item?.startTime || item?.createdAt);
      const duration = Math.max(0, toNumber(item?.duration, 0));

      totalWatchTime += duration;

      if (eId && vId) {
        uniqueViewerKeys.add(buildCompositeViewerKey(eId, vId));
      }

      if (start) {
        const d = new Date(start);
        const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const bucket = monthBucketMap.get(monthKey);

        if (bucket && eId && vId) {
          const viewer = viewerMap.get(buildCompositeViewerKey(eId, vId));
          const isRegistered = Boolean(
            viewer?.email ||
              viewer?.name ||
              (viewer?.formData && Object.keys(viewer.formData).length)
          );

          if (isRegistered) bucket.registered += 1;
          else bucket.anonymous += 1;
        }

        const hourLabel = `${String(d.getHours()).padStart(2, "0")}:00`;
        peakHourCounts.set(hourLabel, (peakHourCounts.get(hourLabel) || 0) + 1);

        const weekday = WEEKDAY_FMT.format(d);
        if (weekdayMap.has(weekday)) {
          const current = weekdayMap.get(weekday);
          current.views += 1;
          current.totalWatchSeconds += duration;
        }
      }

      if (eId) {
        const agg = getEventAgg(eId);
        agg.totalViews += 1;
        agg.totalWatchSeconds += duration;

        if (vId) {
          agg.uniqueViewers.add(vId);
        }

        if (duration >= 15 * 60) {
          agg.completionHits += 1;
        }

        if (start) {
          const hourBucket = new Date(start).toISOString().slice(0, 13);
          agg.hourlySessionCount.set(
            hourBucket,
            (agg.hourlySessionCount.get(hourBucket) || 0) + 1
          );
        }

        const playbackType = item?.playbackType || "unknown";
        agg.playbackTypeCount.set(
          playbackType,
          (agg.playbackTypeCount.get(playbackType) || 0) + 1
        );
      }

      if (!sid && eId) {
        getEventAgg(eId).totalViews += 0;
      }
    });

    const succeededPayments = paymentItems.filter(
      (payment) => payment?.status === "succeeded"
    );

    const succeededPaymentsUsd = await enrichPaymentsWithUsd(succeededPayments);

    const revenueByEventId = new Map();
    succeededPaymentsUsd.forEach((payment) => {
      const key = payment?.eventId || null;
      if (!key) return;
      revenueByEventId.set(
        key,
        toNumber(revenueByEventId.get(key), 0) + toNumber(payment.amountUsd, 0)
      );
    });

    const totalRevenue = succeededPaymentsUsd.reduce(
      (sum, payment) => sum + toNumber(payment?.amountUsd, 0),
      0
    );

    const allEventRows = Array.from(eventAggMap.values())
      .map((agg) => {
        const event = eventsMap[agg.eventId] || {};
        const avgWatchMinutes =
          agg.totalViews > 0 ? Math.round(agg.totalWatchSeconds / agg.totalViews / 60) : 0;

        const peakConcurrent = Array.from(agg.hourlySessionCount.values()).reduce(
          (max, count) => Math.max(max, count),
          0
        );

        const completionRate =
          agg.totalViews > 0 ? Math.round((agg.completionHits / agg.totalViews) * 100) : 0;

        const engagement = Math.min(
          100,
          Math.max(0, Math.round((avgWatchMinutes / 45) * 100))
        );

        return {
          eventId: agg.eventId,
          name: event.title || "Untitled Event",
          date: event.startTime || event.createdAt || null,
          type: event.eventType || "unknown",
          status: event.status || event.vodStatus || "unknown",
          viewers: agg.totalViews,
          uniqueViewers: agg.uniqueViewers.size,
          peakConcurrent,
          avgWatchTime: avgWatchMinutes,
          duration: formatDurationShort(agg.totalWatchSeconds),
          engagement,
          completionRate,
          size: Math.max(80, Math.round(agg.totalViews / 100)),
          revenueUsd: toNumber(revenueByEventId.get(agg.eventId), 0),
        };
      })
      .sort((a, b) => b.viewers - a.viewers);

    const eventRows = eventId
      ? allEventRows.filter((event) => event.eventId === eventId)
      : allEventRows;

    const paidViewers = viewerItems.filter(
      (viewer) => viewer?.isPaidViewer === true || viewer?.viewerpaid === true
    ).length;

    const totalViews = analyticsItems.length;
    const totalEvents = eventId ? (eventsMap[eventId] ? 1 : 0) : Object.keys(eventsMap).length;

    const avgViewers = totalEvents > 0 ? Math.round(totalViews / totalEvents) : 0;
    const avgWatchTimePerSession =
      totalViews > 0 ? Math.round(totalWatchTime / totalViews) : 0;

    const viewershipData = monthBuckets.map((m) => ({
      month: m.month,
      anonymous: m.anonymous,
      registered: m.registered,
      total: m.anonymous + m.registered,
    }));

    const dailyEngagementData = DAY_ORDER.map((day) => {
      const value = weekdayMap.get(day);
      const avgTimeSec =
        value.views > 0 ? Math.round(value.totalWatchSeconds / value.views) : 0;

      return {
        day,
        views: value.views,
        avgTime: formatDurationShort(avgTimeSec),
      };
    });

    const peakHoursData = HOUR_LABELS.map((hour) => ({
      hour,
      viewers: peakHourCounts.get(hour) || 0,
    }));

    const topVideosData = eventRows.slice(0, 5).map((event) => ({
      name: event.name,
      views: event.viewers,
      completionRate: event.completionRate,
    }));

    const topEventsComparison = eventRows.slice(0, 6).map((event) => ({
      name: event.name,
      viewers: event.viewers,
      peakConcurrent: event.peakConcurrent,
      avgWatchTime: event.avgWatchTime,
    }));

    const eventEngagementData = eventRows.slice(0, 8).map((event) => ({
      name: event.name,
      viewers: event.viewers,
      engagement: event.engagement,
      completionRate: event.completionRate,
      size: event.size,
    }));

    const response = {
      success: true,
      filter: {
        eventId: eventId || "all",
      },

      summary: {
        totalViews,
        avgViewers,
        totalWatchTime,
        avgWatchTimePerSession,
        totalEvents,
        totalViewers: uniqueViewerKeys.size,
        totalSessions: totalViews,
        paidViewers,
        totalRevenue,
        totalRevenueCurrency: "USD",
      },

      charts: {
        viewershipData,
        registrationSourceData: buildRegistrationSourceData(viewerItems),
        topVideosData,
        dailyEngagementData,
        peakHoursData,
        topEventsComparison,
        eventEngagementData,
      },

      topEvents: eventRows,

      // Backward compatibility with previous contract
      viewerDurations: [],
      eventSessions: eventRows.map((event) => ({
        eventId: event.eventId,
        eventName: event.name,
        totalSessions: event.viewers,
      })),
      viewers: analyticsItems.map((item) => {
        const event = eventsMap[item.eventId] || {};
        return {
          sessionId: item.sessionId,
          clientViewerId: item.clientViewerId,
          eventId: item.eventId,
          eventName: event.title || null,
          startTime: item.startTime,
          endTime: item.endTime ?? null,
          duration: item.duration ?? 0,
          playbackType: item.playbackType,
          device: {
            browser: item.device?.browser,
            os: item.device?.os,
            deviceType: item.device?.deviceType,
            timezone: item.device?.timezone,
          },
          network: {
            ip: item.network?.ip,
            country: item.network?.geo?.country,
            region: item.network?.geo?.region,
            city: item.network?.geo?.city,
          },
          createdAt: item.createdAt,
        };
      }),
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error("Analytics report fetch error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error?.message || "Failed to build analytics report",
    });
  }
};
