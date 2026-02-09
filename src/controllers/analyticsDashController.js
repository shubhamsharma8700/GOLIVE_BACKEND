import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ANALYTICS_TABLE, ddbDocClient } from "../config/awsClients.js";

const ANALYTICS_TABLE_NAME = ANALYTICS_TABLE;
const ADMINS_TABLE = process.env.ADMIN_TABLE_NAME;
const VIEWERS_TABLE = process.env.VIEWERS_TABLE_NAME;

const TIME_ZONE = "Australia/Sydney";

// Cached formatter factory to produce YYYY-MM-DD or YYYY-MM
const createDateFormatter = (timeZone = TIME_ZONE) => {
  const cache = {};
  return (date, granularity = "day") => {
    const key = granularity; // "day" or "month"
    if (!cache[key]) {
      cache[key] = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        ...(granularity === "day" ? { day: "2-digit" } : {}),
      });
    }
    return cache[key].format(date);
  };
};

const _format = createDateFormatter();
const formatDate = (date) => _format(date, "day"); // YYYY-MM-DD
const formatMonth = (date) => _format(date, "month"); // YYYY-MM

export const getDashboardAnalytics = async (req, res) => {
  try {
    // -------------------- FETCH ANALYTICS --------------------
    const analyticsResult = await ddbDocClient.send(
      new ScanCommand({
        TableName: ANALYTICS_TABLE_NAME,
        ProjectionExpression: "eventId, sessionId, startTime",
      })
    );

    const analyticsItems = analyticsResult.Items || [];

    const uniqueEventsSet = new Set();
    const viewsByDayMap = {};
    const eventsByMonthMap = {};

    analyticsItems.forEach((item) => {
      if (!item.startTime) return;

      const date = new Date(item.startTime);

      // ---------- DAILY VIEWS ----------
      const dayKey = formatDate(date);
      viewsByDayMap[dayKey] = (viewsByDayMap[dayKey] || 0) + 1;

      // ---------- EVENTS ----------
      if (item.eventId) {
        uniqueEventsSet.add(item.eventId);

        const monthKey = formatMonth(date);
        if (!eventsByMonthMap[monthKey]) {
          eventsByMonthMap[monthKey] = new Set();
        }
        eventsByMonthMap[monthKey].add(item.eventId);
      }
    });

    const totalEvents = uniqueEventsSet.size;
    const totalViews = analyticsItems.length;

    // -------------------- FETCH ADMINS --------------------
    const adminResult = await ddbDocClient.send(
      new ScanCommand({
        TableName: ADMINS_TABLE,
        ProjectionExpression: "adminId",
      })
    );

    const activeAdmins = adminResult.Items?.length || 0;

    // -------------------- FETCH VIEWERS --------------------
    const viewerResult = await ddbDocClient.send(
      new ScanCommand({
        TableName: VIEWERS_TABLE,
        ProjectionExpression: "viewerId",
      })
    );

    const uniqueViewersSet = new Set();
    viewerResult.Items?.forEach((v) => {
      if (v.viewerId) uniqueViewersSet.add(v.viewerId);
    });

    const newSignUps = uniqueViewersSet.size;

    // -------------------- FORMAT RESPONSE --------------------
    const viewsByDay = Object.entries(viewsByDayMap).map(
      ([date, totalViews]) => ({
        date,
        totalViews,
      })
    );

    const eventsByMonth = Object.entries(eventsByMonthMap).map(
      ([month, eventSet]) => ({
        month,
        totalEvents: eventSet.size,
      })
    );

    // -------------------- RESPONSE --------------------
    return res.status(200).json({
      summary: {
        totalEvents,
        activeAdmins,
        newSignUps,
        totalViews,
      },
      analytics: {
        viewsByDay,
        eventsByMonth,
      },
      timezone: TIME_ZONE,
    });

  } catch (error) {
    console.error("Dashboard analytics error:", error);
    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
};
