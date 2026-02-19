import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ANALYTICS_TABLE, ddbDocClient } from "../config/awsClients.js";
import { enrichPaymentsWithUsd } from "../utils/currency.js";

const ANALYTICS_TABLE_NAME = ANALYTICS_TABLE;
const ADMINS_TABLE = process.env.ADMIN_TABLE_NAME;
const PAYMENTS_TABLE = process.env.PAYMENTS_TABLE;
const EVENTS_TABLE = process.env.EVENTS_TABLE_NAME;

const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const formatNumber = (num) => {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return Math.round(num / 1000) + "K";
  return String(num);
};

const formatCurrency = (num) => "$" + toNumber(num).toLocaleString();

const percentageDelta = (currentValue, previousValue) => {
  if (!previousValue) return currentValue > 0 ? "+100%" : "+0%";
  const delta = ((currentValue - previousValue) / previousValue) * 100;
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${delta.toFixed(0)}%`;
};

const positivePercentage = (newCount, totalCount) => {
  if (!totalCount || newCount <= 0) return "+0%";
  const percent = (newCount / totalCount) * 100;
  return `+${percent.toFixed(0)}%`;
};

const formatDurationShort = (seconds) => {
  const safeSeconds = Math.max(0, toNumber(seconds));
  const totalMinutes = Math.round(safeSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
};

const safeDate = (value) => {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
};

const monthKey = (date) => {
  const d = safeDate(date);
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const weekDayKey = (date) => {
  const d = safeDate(date);
  if (!d) return null;
  const jsDay = d.getDay();
  const map = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return map[jsDay];
};

const getCurrentWeekRange = () => {
  const now = new Date();
  const start = new Date(now);
  const day = start.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + diffToMonday);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
};

const scanAllItems = async (tableName) => {
  if (!tableName) return [];

  const allItems = [];
  let lastEvaluatedKey;

  do {
    const result = await ddbDocClient.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (result.Items?.length) {
      allItems.push(...result.Items);
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return allItems;
};

export const getDashboardAnalytics = async (req, res) => {
  try {
    const now = new Date();
    const currentYear = now.getFullYear();
    const previousYear = currentYear - 1;

    const [analyticsItems, events, admins, payments] = await Promise.all([
      scanAllItems(ANALYTICS_TABLE_NAME),
      scanAllItems(EVENTS_TABLE),
      scanAllItems(ADMINS_TABLE),
      scanAllItems(PAYMENTS_TABLE),
    ]);

    const totalViews = analyticsItems.length;
    const totalEvents = events.length;

    const eventMap = new Map();
    events.forEach((event) => {
      eventMap.set(event.eventId, {
        event,
        totalViews: 0,
        totalWatchTime: 0,
        uniqueViewers: new Set(),
        hourlySessions: new Map(),
        latestSeenAt: null,
      });
    });

    const weeklyMap = {
      Mon: new Set(),
      Tue: new Set(),
      Wed: new Set(),
      Thu: new Set(),
      Fri: new Set(),
      Sat: new Set(),
      Sun: new Set(),
    };

    const monthlyEngagementMap = {};
    for (let i = 0; i < 12; i += 1) {
      monthlyEngagementMap[`${currentYear}-${String(i + 1).padStart(2, "0")}`] = 0;
    }

    const { start: weekStart, end: weekEnd } = getCurrentWeekRange();

    analyticsItems.forEach((item) => {
      const eventId = item.eventId;
      const clientViewerId = item.clientViewerId;
      const duration = Math.max(0, toNumber(item.duration));

      const itemDate = safeDate(item.startTime || item.createdAt);

      if (itemDate) {
        const mKey = monthKey(itemDate);
        if (mKey && Object.prototype.hasOwnProperty.call(monthlyEngagementMap, mKey)) {
          monthlyEngagementMap[mKey] += 1;
        }

        if (itemDate >= weekStart && itemDate < weekEnd && eventId) {
          const dKey = weekDayKey(itemDate);
          if (dKey && weeklyMap[dKey]) {
            weeklyMap[dKey].add(eventId);
          }
        }
      }

      if (!eventId) return;

      if (!eventMap.has(eventId)) {
        eventMap.set(eventId, {
          event: {
            eventId,
            title: "Untitled",
            startTime: null,
            endTime: null,
            status: "unknown",
            eventType: "unknown",
          },
          totalViews: 0,
          totalWatchTime: 0,
          uniqueViewers: new Set(),
          hourlySessions: new Map(),
          latestSeenAt: null,
        });
      }

      const row = eventMap.get(eventId);
      row.totalViews += 1;
      row.totalWatchTime += duration;

      if (clientViewerId) {
        row.uniqueViewers.add(clientViewerId);
      }

      if (itemDate) {
        const hourKey = itemDate.toISOString().slice(0, 13);
        row.hourlySessions.set(hourKey, (row.hourlySessions.get(hourKey) || 0) + 1);

        if (!row.latestSeenAt || itemDate > row.latestSeenAt) {
          row.latestSeenAt = itemDate;
        }
      }
    });

    const currentMonthKey = `${currentYear}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const totalAdmins = admins.length;
    const newAdminsThisMonth = admins.reduce((count, admin) => {
      const key = monthKey(admin.createdAt);
      return key === currentMonthKey ? count + 1 : count;
    }, 0);

    const currentYtdPayments = [];
    const previousYtdPayments = [];
    const currentMonthNum = now.getMonth() + 1;

    payments.forEach((payment) => {
      if (payment.status !== "succeeded") return;

      const pDate = safeDate(payment.createdAt || payment.updatedAt);
      if (!pDate) return;

      const year = pDate.getFullYear();
      const month = pDate.getMonth() + 1;

      if (year === currentYear && month <= currentMonthNum) {
        currentYtdPayments.push(payment);
      }

      if (year === previousYear && month <= currentMonthNum) {
        previousYtdPayments.push(payment);
      }
    });

    const [currentYtdPaymentsUsd, previousYtdPaymentsUsd] = await Promise.all([
      enrichPaymentsWithUsd(currentYtdPayments),
      enrichPaymentsWithUsd(previousYtdPayments),
    ]);

    const ytdRevenue = currentYtdPaymentsUsd.reduce(
      (sum, payment) => sum + toNumber(payment.amountUsd, 0),
      0
    );

    const previousYtdRevenue = previousYtdPaymentsUsd.reduce(
      (sum, payment) => sum + toNumber(payment.amountUsd, 0),
      0
    );

    const dashboardCards = [
      {
        title: "Total Events",
        value: formatNumber(totalEvents),
        change: "+0%",
        icon: "Calendar",
        color: "#B89B5E",
      },
      {
        title: "Active Admins",
        value: formatNumber(totalAdmins),
        change: positivePercentage(newAdminsThisMonth, totalAdmins),
        icon: "Users",
        color: "#10B981",
      },
      {
        title: "Total Revenue",
        value: formatCurrency(ytdRevenue),
        change: percentageDelta(ytdRevenue, previousYtdRevenue),
        icon: "UserPlus",
        color: "#3B82F6",
      },
      {
        title: "Total Views",
        value: formatNumber(totalViews),
        change: "+0%",
        icon: "Eye",
        color: "#8B5CF6",
      },
    ];

    const eventData = WEEK_DAYS.map((d) => ({
      name: d,
      events: weeklyMap[d].size,
    }));

    const engagementData = MONTH_NAMES.map((name, idx) => {
      const key = `${currentYear}-${String(idx + 1).padStart(2, "0")}`;
      return {
        name,
        viewers: monthlyEngagementMap[key] || 0,
      };
    });

    const previousGoLiveEvents = Array.from(eventMap.values())
      .map((row) => {
        const event = row.event || {};
        const peakViewers = Array.from(row.hourlySessions.values()).reduce(
          (max, current) => Math.max(max, current),
          0
        );

        const avgWatchTimeSeconds =
          row.totalViews > 0 ? row.totalWatchTime / row.totalViews : 0;

        return {
          eventId: event.eventId,
          title: event.title || "Untitled",
          startTime: event.startTime || event.createdAt || null,
          endTime: event.endTime || event.createdAt || null,
          status: event.status || event.vodStatus || "unknown",
          eventType: event.eventType || "unknown",
          thumbnailUrl:
            event.thumbnailUrl ||
            "https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=100&q=80",
          totalViewers: row.uniqueViewers.size,
          totalSessions: row.totalViews,
          peakViewers,
          avgWatchTime: formatDurationShort(avgWatchTimeSeconds),
          avgWatchTimeSeconds: Math.round(avgWatchTimeSeconds),
          totalWatchTimeSeconds: Math.round(row.totalWatchTime),
          lastActivityAt: row.latestSeenAt ? row.latestSeenAt.toISOString() : null,
        };
      })
      .filter((event) => {
        const start = safeDate(event.startTime);
        if (!start) return true;
        return start <= now;
      })
      .sort((a, b) => {
        const aTs = safeDate(a.startTime)?.getTime() || 0;
        const bTs = safeDate(b.startTime)?.getTime() || 0;
        return bTs - aTs;
      });

    return res.status(200).json({
      year: String(currentYear),
      cards: dashboardCards,
      eventData,
      engagementData,
      previousGoLiveEvents,
      events: previousGoLiveEvents.map((event) => ({
        eventId: event.eventId,
        title: event.title,
        startTime: event.startTime,
        endTime: event.endTime,
        eventType: event.eventType,
        status: event.status,
        thumbnailUrl: event.thumbnailUrl,
        totalViewers: event.totalViewers,
        peakViewers: event.peakViewers,
        avgWatchTime: event.avgWatchTime,
      })),
      summary: {
        totalEvents,
        totalViews,
        totalAdmins,
        ytdRevenue,
        previousYtdRevenue,
        revenueCurrency: "USD",
      },
    });
  } catch (error) {
    console.error("Dashboard analytics error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error?.message || "An error occurred while fetching dashboard analytics",
    });
  }
};
