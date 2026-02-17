import {
  BatchGetCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

import { ddbDocClient } from "../config/awsClients.js";

const ANALYTICS_TABLE = process.env.ANALYTICS_TABLE;
const PAYMENTS_TABLE = process.env.PAYMENTS_TABLE;
const VIEWERS_TABLE = process.env.VIEWERS_TABLE_NAME;
const EVENTS_TABLE = process.env.EVENTS_TABLE_NAME;
const EVENT_INDEX = "eventId-index";

export const getFullDashboardData = async (req, res) => {
  try {
    const { eventId } = req.body;

    // ====================================================
    // AUSTRALIA TIMEZONE SETUP
    // ====================================================
    const convertToAU = (dateStr) =>
      new Date(
        new Date(dateStr).toLocaleString("en-US", {
          timeZone: "Australia/Sydney",
        })
      );

    const australiaNow = convertToAU(new Date());

    const currentMonth = australiaNow.getMonth();
    const currentYear = australiaNow.getFullYear();

    const previousMonthDate = new Date(currentYear, currentMonth - 1);
    const previousMonth = previousMonthDate.getMonth();
    const previousMonthYear = previousMonthDate.getFullYear();

    const isCurrentMonth = (date) =>
      date.getMonth() === currentMonth &&
      date.getFullYear() === currentYear;

    const isPreviousMonth = (date) =>
      date.getMonth() === previousMonth &&
      date.getFullYear() === previousMonthYear;

    // ====================================================
    // FETCH ANALYTICS
    // ====================================================
    let analyticsItems = [];

    if (eventId) {
      const result = await ddbDocClient.send(
        new QueryCommand({
          TableName: ANALYTICS_TABLE,
          IndexName: EVENT_INDEX,
          KeyConditionExpression: "eventId = :eid",
          ExpressionAttributeValues: { ":eid": eventId },
        })
      );
      analyticsItems = result.Items || [];
    } else {
      const result = await ddbDocClient.send(
        new ScanCommand({ TableName: ANALYTICS_TABLE })
      );
      analyticsItems = result.Items || [];
    }

    // ====================================================
    // FETCH PAYMENTS
    // ====================================================
    const paymentsResult = await ddbDocClient.send(
      new ScanCommand({ TableName: PAYMENTS_TABLE })
    );
    const paymentItems = paymentsResult.Items || [];

    // ====================================================
    // FETCH VIEWERS
    // ====================================================
    let viewerItems = [];

    if (eventId) {
      const result = await ddbDocClient.send(
        new ScanCommand({
          TableName: VIEWERS_TABLE,
          FilterExpression: "eventId = :eid",
          ExpressionAttributeValues: { ":eid": eventId },
        })
      );
      viewerItems = result.Items || [];
    } else {
      const result = await ddbDocClient.send(
        new ScanCommand({ TableName: VIEWERS_TABLE })
      );
      viewerItems = result.Items || [];
    }

    // ====================================================
    // EVENT IDS
    // ====================================================
    const eventIds = [...new Set(analyticsItems.map(i => i.eventId))];

    // ====================================================
    // FETCH EVENT DETAILS
    // ====================================================
    let eventDetailsMap = {};

    if (eventIds.length > 0) {
      const batchResult = await ddbDocClient.send(
        new BatchGetCommand({
          RequestItems: {
            [EVENTS_TABLE]: {
              Keys: eventIds.map(id => ({ eventId: id })),
              ProjectionExpression: "eventId, title, startTime, endTime",
            },
          },
        })
      );

      const events = batchResult.Responses?.[EVENTS_TABLE] || [];
      events.forEach(ev => {
        eventDetailsMap[ev.eventId] = ev;
      });
    }

    // ====================================================
    // DASHBOARD CALCULATIONS
    // ====================================================
    let totalWatchSeconds = 0;
    let totalRevenue = 0;

    let currentMonthViews = 0;
    let previousMonthViews = 0;

    let currentMonthWatchSeconds = 0;
    let previousMonthWatchSeconds = 0;

    let currentMonthRevenue = 0;
    let previousMonthRevenue = 0;

    const uniqueViewersSet = new Set();
    const uniqueEventsSet = new Set();

    const paymentMap = new Map();
    paymentItems.forEach(payment => {
      const key = `${payment.eventId}_${payment.clientViewerId}`;
      paymentMap.set(key, payment);
    });

    analyticsItems.forEach(item => {
      const auDate = convertToAU(item.createdAt);
      const duration = Number(item.duration || 0);

      totalWatchSeconds += duration;
      uniqueViewersSet.add(item.clientViewerId);
      if (!eventId) uniqueEventsSet.add(item.eventId);

      if (isCurrentMonth(auDate)) {
        currentMonthViews++;
        currentMonthWatchSeconds += duration;
      }

      if (isPreviousMonth(auDate)) {
        previousMonthViews++;
        previousMonthWatchSeconds += duration;
      }

      // Revenue Matching
      const key = `${item.eventId}_${item.clientViewerId}`;
      const payment = paymentMap.get(key);

      if (payment) {
        const amount = Number(payment.amount || 0);
        totalRevenue += amount;

        const paymentDate = convertToAU(payment.createdAt);

        if (isCurrentMonth(paymentDate)) currentMonthRevenue += amount;
        if (isPreviousMonth(paymentDate)) previousMonthRevenue += amount;
      }
    });

    const totalSessions = analyticsItems.length;
    const totalViewers = uniqueViewersSet.size;
    const totalEvents = eventId ? 1 : uniqueEventsSet.size;

    const averageViewers =
      totalEvents > 0 ? Math.round(totalSessions / totalEvents) : 0;

    const averageWatchTimeMinutes =
      totalViewers > 0
        ? Math.round((totalWatchSeconds / totalViewers) / 60)
        : 0;

    // ====================================================
    // CORRECT PERCENT CHANGE
    // ====================================================
    const percentChange = (current, previous) => {
      if (previous === 0) return current > 0 ? "100%" : "0%";
      const change = ((current - previous) / previous) * 100;
      return `${change.toFixed(1)}%`;
    };

    const dashboardStats = [
      {
        title: "Total Views",
        value: totalSessions,
        change: percentChange(currentMonthViews, previousMonthViews),
      },
      {
        title: "Average Viewers",
        value: averageViewers,
        change: percentChange(currentMonthViews, previousMonthViews),
      },
      {
        title: "Watch Time (mins)",
        value: Math.round(totalWatchSeconds / 60),
        change: percentChange(
          currentMonthWatchSeconds,
          previousMonthWatchSeconds
        ),
      },
      {
        title: "Total Events",
        value: totalEvents,
        change: percentChange(currentMonthViews, previousMonthViews),
      },
      {
        title: "Total Revenue",
        value: totalRevenue,
        change: percentChange(
          currentMonthRevenue,
          previousMonthRevenue
        ),
      },
    ];

    // ====================================================
    // VIEWERSHIP TRENDS
    // ====================================================
    const monthNames = [
      "Jan","Feb","Mar","Apr","May","Jun",
      "Jul","Aug","Sep","Oct","Nov","Dec"
    ];

    const monthlyMap = {};
    monthNames.forEach(month => {
      monthlyMap[month] = { registered: 0, anonymous: 0 };
    });

    viewerItems.forEach(item => {
      const auDate = convertToAU(item.createdAt);
      if (auDate.getFullYear() !== currentYear) return;

      const month = monthNames[auDate.getMonth()];

      if (item.accessVarified) monthlyMap[month].registered++;
      else monthlyMap[month].anonymous++;
    });

    const viewershipTrends = monthNames.map(month => ({
      name: month,
      registered: monthlyMap[month].registered,
      anonymous: monthlyMap[month].anonymous,
    }));

    // ====================================================
    // EVENT AGGREGATION
    // ====================================================
    const eventAggregation = {};

    analyticsItems.forEach(item => {
      if (!eventAggregation[item.eventId]) {
        eventAggregation[item.eventId] = {
          totalViewers: 0,
          totalSeconds: 0,
        };
      }

      eventAggregation[item.eventId].totalViewers++;
      eventAggregation[item.eventId].totalSeconds += Number(item.duration || 0);
    });

    const mostWatchedEvents = Object.keys(eventAggregation).map(eid => {
      const totalV = eventAggregation[eid].totalViewers;
      const totalSeconds = eventAggregation[eid].totalSeconds;

      return {
        name: eventDetailsMap[eid]?.title || eid,
        eventId: eid,
        totalViewers: totalV,
        avgWatchTime:
          totalV > 0
            ? Math.round((totalSeconds / totalV) / 60)
            : 0,
      };
    });

    let topPerformingEvents = Object.keys(eventAggregation).map(eid => {
      const totalV = eventAggregation[eid].totalViewers;
      const details = eventDetailsMap[eid] || {};

      const startTime = details.startTime
        ? new Date(details.startTime)
        : null;
      const endTime = details.endTime
        ? new Date(details.endTime)
        : null;

      let duration = "N/A";

      if (startTime && endTime) {
        const diffMinutes = Math.floor((endTime - startTime) / 60000);
        const hours = Math.floor(diffMinutes / 60);
        const minutes = diffMinutes % 60;
        duration = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
      }

      return {
        eventId: eid,
        eventName: details.title || eid,
        date: startTime
          ? startTime.toLocaleDateString("en-AU", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })
          : "N/A",
        totalViewers: totalV,
        duration,
      };
    });

    topPerformingEvents.sort((a, b) => b.totalViewers - a.totalViewers);
    topPerformingEvents = topPerformingEvents.map((e, i) => ({
      rank: i + 1,
      ...e,
    }));

    return res.status(200).json({
      eventId: eventId ?? "ALL",
      summary: {
        totalEvents,
        totalViewers,
        totalSessions,
        totalWatchTimeMinutes: Math.round(totalWatchSeconds / 60),
        averageWatchTimeMinutes,
        totalRevenue,
      },
      dashboardStats,
      viewershipTrends,
      mostWatchedEvents,
      topPerformingEvents,
    });

  } catch (error) {
    console.error("Dashboard error:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};
