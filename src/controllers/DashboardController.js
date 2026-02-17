import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ANALYTICS_TABLE, ddbDocClient } from "../config/awsClients.js";

const ANALYTICS_TABLE_NAME = ANALYTICS_TABLE;
const EVENTS_TABLE_NAME = process.env.EVENTS_TABLE_NAME || "go-live-poc-events";
const ADMINS_TABLE = process.env.ADMIN_TABLE_NAME;
const PAYMENTS_TABLE = process.env.PAYMENTS_TABLE;

const TIME_ZONE = "Australia/Sydney";

// ================= FORMATTERS =================
const formatMonthKey = (date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).format(date);

const formatMonthShort = (date) =>
  new Intl.DateTimeFormat("en-AU", {
    timeZone: TIME_ZONE,
    month: "short",
  }).format(date);

const formatWeekday = (date) =>
  new Intl.DateTimeFormat("en-AU", {
    timeZone: TIME_ZONE,
    weekday: "short",
  }).format(date);

// ================= UTIL =================
const positivePercentage = (newCount, totalCount) => {
  if (!totalCount || newCount <= 0) return "+0%";
  const percent = (newCount / totalCount) * 100;
  return `+${percent.toFixed(0)}%`;
};

const formatNumber = (num) => {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return Math.round(num / 1000) + "K";
  return num.toString();
};

const formatCurrency = (num) => "$" + num.toLocaleString();

// ================= CONTROLLER =================
export const getDashboardAnalytics = async (req, res) => {
  try {
    const now = new Date();
    const currentMonthKey = formatMonthKey(now);
    const currentYear = new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
    }).format(now);

    const previousMonthDate = new Date(now);
    previousMonthDate.setMonth(now.getMonth() - 1);
    const previousMonthKey = formatMonthKey(previousMonthDate);
    
    // Previous year (for YTD comparison)
    const previousYear = String(Number(currentYear) - 1);

    // =====================================================
    // EVENTS TABLE - Get Total Events Count
    // =====================================================
    const eventsResult = await ddbDocClient.send(
      new ScanCommand({
        TableName: EVENTS_TABLE_NAME,
      })
    );

    const events = eventsResult.Items || [];
    const totalEvents = events.length;

    // =====================================================
    // ANALYTICS TABLE (MATCHES YOUR WORKING API LOGIC)
    // =====================================================
    const analyticsResult = await ddbDocClient.send(
      new ScanCommand({
        TableName: ANALYTICS_TABLE_NAME,
      })
    );

    const Items = analyticsResult.Items || [];

    const uniqueEventsSet = new Set();

    let totalViews = Items.length; // EXACT match to totalSessions

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

    for (let i = 0; i < 12; i++) {
      const d = new Date(`${currentYear}-01-01`);
      d.setMonth(i);
      monthlyEngagementMap[formatMonthKey(d)] = 0;
    }

    const startOfWeek = new Date(now);
    const day = startOfWeek.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    startOfWeek.setDate(startOfWeek.getDate() + diffToMonday);
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);

    Items.forEach((item) => {
      if (item.eventId) {
        uniqueEventsSet.add(item.eventId);
      }

      if (item.startTime) {
        const date = new Date(item.startTime);

        // Weekly
        if (date >= startOfWeek && date < endOfWeek && item.eventId) {
          const weekday = formatWeekday(date);
          if (weeklyMap[weekday]) {
            weeklyMap[weekday].add(item.eventId);
          }
        }

        // Yearly month engagement
        const monthKey = formatMonthKey(date);
        if (monthlyEngagementMap.hasOwnProperty(monthKey)) {
          monthlyEngagementMap[monthKey]++;
        }
      }
    });

    // =====================================================
    // ADMINS TABLE
    // =====================================================
    const adminResult = await ddbDocClient.send(
      new ScanCommand({ TableName: ADMINS_TABLE })
    );

    const admins = adminResult.Items || [];
    const totalAdmins = admins.length;

    let newAdminsThisMonth = 0;

    admins.forEach((admin) => {
      if (!admin.createdAt) return;
      const date = new Date(admin.createdAt);
      if (formatMonthKey(date) === currentMonthKey) {
        newAdminsThisMonth++;
      }
    });

    // =====================================================
    // PAYMENTS TABLE (SUCCEEDED ONLY) - YEAR-TO-DATE
    // =====================================================
    const paymentsResult = await ddbDocClient.send(
      new ScanCommand({ TableName: PAYMENTS_TABLE })
    );

    const payments = paymentsResult.Items || [];

    let ytdRevenue = 0;                    // Current year Jan to current month
    let previousYtdRevenue = 0;            // Previous year same period (Jan to current month)

    const currentMonthNum = now.getMonth(); // 0-11

    payments.forEach((payment) => {
      // Only count succeeded/completed payments
      if (payment.status !== "succeeded") return;
      if (!payment.amount || !payment.createdAt) return;

      const paymentDate = new Date(payment.createdAt);
      const paymentYear = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        year: "numeric",
      }).format(paymentDate);
      const paymentMonthNum = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        month: "2-digit",
      }).format(paymentDate);

      const amount = Number(payment.amount);

      // Current year YTD: same year, month <= current month
      if (paymentYear === currentYear && parseInt(paymentMonthNum) <= currentMonthNum + 1) {
        ytdRevenue += amount;
      }

      // Previous year YTD: same period last year
      if (paymentYear === previousYear && parseInt(paymentMonthNum) <= currentMonthNum + 1) {
        previousYtdRevenue += amount;
      }
    });

    // =====================================================
    // CARDS (YTD - YEAR-TO-DATE WITH YoY COMPARISON)
    // =====================================================
    const dashboardCards = [
      {
        title: "Total Events",
        value: formatNumber(totalEvents),
        change: "+0%", // Events not based on createdAt
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
        change: positivePercentage(ytdRevenue, previousYtdRevenue),
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

    // =====================================================
    // CHART DATA
    // =====================================================
    const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

    const eventData = weekDays.map((d) => ({
      name: d,
      events: weeklyMap[d].size,
    }));

    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

    const engagementData = monthNames.map((name, index) => {
      const d = new Date(`${currentYear}-01-01`);
      d.setMonth(index);
      const key = formatMonthKey(d);
      return {
        name,
        viewers: monthlyEngagementMap[key] || 0,
      };
    });

    // =====================================================
    // RESPONSE
    // =====================================================
    return res.status(200).json({
      year: currentYear,
      timezone: TIME_ZONE,
      cards: dashboardCards,
      eventData,
      engagementData,
    });

  } catch (error) {
    console.error("Dashboard analytics error:", error);
    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
};
