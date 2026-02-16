import {
    BatchGetCommand,
    QueryCommand,
    ScanCommand
} from "@aws-sdk/lib-dynamodb";

import {
    ANALYTICS_TABLE,
    ddbDocClient
} from "../config/awsClients.js";

const TABLE_NAME = ANALYTICS_TABLE;
const EVENT_INDEX = "eventId-index";
const EVENTS_TABLE = process.env.Events_Table_Name;

export const getAnalyticsByEventId = async (req, res) => {
  try {
    const { eventId } = req.body;

    let Items = [];

    // -------------------- FETCH ANALYTICS --------------------
    if (eventId) {
      const params = {
        TableName: TABLE_NAME,
        IndexName: EVENT_INDEX,
        KeyConditionExpression: "eventId = :eid",
        ExpressionAttributeValues: {
          ":eid": eventId,
        },
      };

      const result = await ddbDocClient.send(new QueryCommand(params));
      Items = result.Items || [];
    } else {
      const params = { TableName: TABLE_NAME };
      const result = await ddbDocClient.send(new ScanCommand(params));
      Items = result.Items || [];
    }

    // -------------------- AGGREGATION --------------------
    let totalWatchTime = 0;
    let totalRevenue = 0;

    const uniqueViewersSet = new Set();
    const paidViewersSet = new Set();
    const uniqueEventsSet = new Set();

    const viewerDurationMap = {};
    const eventSessionMap = {};

    const eventIdsSet = new Set(); 

    Items.forEach((item) => {
      if (item.eventId) eventIdsSet.add(item.eventId);

      // Viewer aggregation
      if (item.clientViewerId) {
        uniqueViewersSet.add(item.clientViewerId);

        if (!viewerDurationMap[item.clientViewerId]) {
          viewerDurationMap[item.clientViewerId] = {
            clientViewerId: item.clientViewerId,
            totalWatchTime: 0,
            totalSessions: 0,
          };
        }

        viewerDurationMap[item.clientViewerId].totalSessions += 1;

        if (item.duration) {
          viewerDurationMap[item.clientViewerId].totalWatchTime += Number(item.duration);
        }
      }

      // Event aggregation
      if (item.eventId) {
        if (!eventSessionMap[item.eventId]) {
          eventSessionMap[item.eventId] = {
            eventId: item.eventId,
            totalSessions: 0,
          };
        }
        eventSessionMap[item.eventId].totalSessions += 1;

        if (!eventId) uniqueEventsSet.add(item.eventId);
      }

      if (item.duration) totalWatchTime += Number(item.duration);

      if (item.isPaid === true) {
        paidViewersSet.add(item.clientViewerId);
        if (item.amount) totalRevenue += Number(item.amount);
      }
    });

    // -------------------- FETCH EVENT NAMES --------------------
    let eventNameMap = {};

    if (eventIdsSet.size > 0) {
      const keys = Array.from(eventIdsSet).map((id) => ({
        eventId: id,
      }));

      const batchParams = {
        RequestItems: {
          [EVENTS_TABLE]: {
            Keys: keys,
            ProjectionExpression: "eventId, eventName",
          },
        },
      };

      const batchResult = await ddbDocClient.send(
        new BatchGetCommand(batchParams)
      );

      const events = batchResult.Responses?.[EVENTS_TABLE] || [];

      events.forEach((ev) => {
        eventNameMap[ev.eventId] = ev.eventName;
      });
    }

    const viewers = Items.map((item) => ({
      sessionId: item.sessionId,
      clientViewerId: item.clientViewerId,
      eventId: item.eventId,
      eventName: eventNameMap[item.eventId] ?? null, 
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
    }));

    const viewerDurations = Object.values(viewerDurationMap);
    const eventSessions = Object.values(eventSessionMap).map((ev) => ({
      ...ev,
      eventName: eventNameMap[ev.eventId] ?? null, 
    }));

    const totalViewers = uniqueViewersSet.size;
    const totalSessions = Items.length;
    const averageWatchTime =
      totalViewers > 0 ? Math.round(totalWatchTime / totalViewers) : 0;

    const totalEvents = !eventId ? uniqueEventsSet.size : undefined;

    //Response----

    return res.status(200).json({ 
      eventId: eventId ?? "ALL",
      summary: {
        ...(totalEvents !== undefined && { totalEvents }),
        totalViewers,
        totalSessions,
        totalWatchTime,
        averageWatchTime,
        paidViewers: paidViewersSet.size,
        totalRevenue,
      },
      viewerDurations,
      eventSessions,
      viewers,
    });

  } catch (error) {
    console.error("Analytics fetch error:", error);
    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
};