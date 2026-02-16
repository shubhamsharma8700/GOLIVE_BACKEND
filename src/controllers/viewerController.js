import {
  ddbDocClient,
  ScanCommand,
  QueryCommand,
  DeleteCommand,
  GetCommand,
} from "../config/awsClients.js";

const VIEWERS_TABLE = process.env.VIEWERS_TABLE_NAME;
const EVENTS_TABLE = process.env.EVENTS_TABLE_NAME;
const VIEWER_ID_INDEX = "viewerId-index";

if (!VIEWERS_TABLE) {
  throw new Error("Missing ENV variable: VIEWERS_TABLE_NAME");
}

if (!EVENTS_TABLE) {
  throw new Error("Missing ENV variable: EVENTS_TABLE_NAME");
}

/* -------------------------------------------------------
   Helpers
------------------------------------------------------- */
function formatViewer(v) {
  if (!v) return null;

  return {
    ...v,
    createdAt: v.createdAt ? new Date(v.createdAt).toISOString() : null,
    updatedAt: v.updatedAt ? new Date(v.updatedAt).toISOString() : null,
    lastActiveAt: v.lastActiveAt
      ? new Date(v.lastActiveAt).toISOString()
      : null,
    firstJoinAt: v.firstJoinAt
      ? new Date(v.firstJoinAt).toISOString()
      : null,
    lastJoinAt: v.lastJoinAt
      ? new Date(v.lastJoinAt).toISOString()
      : null,
  };
}

function formatEvent(e) {
  if (!e) return null;

  return {
    eventId: e.eventId,
    title: e.title,
    eventType: e.eventType,
    accessMode: e.accessMode,
    status: e.status,
    startTime: e.startTime || null,
    endTime: e.endTime || null,
  };
}

/* =======================================================
   1. LIST ALL VIEWERS (ADMIN)
   GET /api/viewers
======================================================= */
export async function listViewers(req, res, next) {
  try {
    const limit = parseInt(req.query.limit || "10", 10);

    const lastKey =
      req.query.lastEventId && req.query.lastClientViewerId
        ? {
            eventId: req.query.lastEventId,
            clientViewerId: req.query.lastClientViewerId,
          }
        : null;

    const params = {
      TableName: VIEWERS_TABLE,
      Limit: limit,
    };

    if (lastKey) {
      params.ExclusiveStartKey = lastKey;
    }

    const result = await ddbDocClient.send(new ScanCommand(params));
    const viewers = result.Items || [];

    /* ---------- FETCH EVENTS PER VIEWER ---------- */
    const eventIds = [...new Set(viewers.map(v => v.eventId))];

    const eventMap = {};
    await Promise.all(
      eventIds.map(async (eventId) => {
        const res = await ddbDocClient.send(
          new GetCommand({
            TableName: EVENTS_TABLE,
            Key: { eventId },
          })
        );
        if (res.Item) {
          eventMap[eventId] = formatEvent(res.Item);
        }
      })
    );

    res.json({
      items: viewers.map(v => ({
        ...formatViewer(v),
        event: eventMap[v.eventId] || null,
      })),
      pagination: {
        limit,
        nextKey: result.LastEvaluatedKey
          ? {
              lastEventId: result.LastEvaluatedKey.eventId,
              lastClientViewerId: result.LastEvaluatedKey.clientViewerId,
            }
          : null,
        hasMore: Boolean(result.LastEvaluatedKey),
      },
    });
  } catch (err) {
    next(err);
  }
}

/* =======================================================
   2. LIST VIEWERS BY EVENT
   GET /api/viewers/event/:eventId
======================================================= */
export async function listViewersByEvent(req, res, next) {
  try {
    const { eventId } = req.params;
    const limit = parseInt(req.query.limit || "10", 10);

    if (!eventId) {
      return res.status(400).json({ error: "eventId is required" });
    }

    /* ---------- FETCH EVENT ONCE ---------- */
    const eventRes = await ddbDocClient.send(
      new GetCommand({
        TableName: EVENTS_TABLE,
        Key: { eventId },
      })
    );

    if (!eventRes.Item) {
      return res.status(404).json({ error: "Event not found" });
    }

    const eventInfo = formatEvent(eventRes.Item);

    const params = {
      TableName: VIEWERS_TABLE,
      KeyConditionExpression: "eventId = :e",
      ExpressionAttributeValues: { ":e": eventId },
      Limit: limit,
      ScanIndexForward: false,
    };

    if (req.query.lastClientViewerId) {
      params.ExclusiveStartKey = {
        eventId,
        clientViewerId: req.query.lastClientViewerId,
      };
    }

    const result = await ddbDocClient.send(new QueryCommand(params));

    res.json({
      event: eventInfo,
      items: (result.Items || []).map(v => ({
        ...formatViewer(v),
        event: eventInfo,
      })),
      pagination: {
        limit,
        nextKey: result.LastEvaluatedKey
          ? result.LastEvaluatedKey.clientViewerId
          : null,
        hasMore: Boolean(result.LastEvaluatedKey),
      },
    });
  } catch (err) {
    next(err);
  }
}

/* =======================================================
   3. GET VIEWER BY ID (ADMIN)
   GET /api/viewers/:clientViewerId
======================================================= */
export async function getViewerById(req, res, next) {
  try {
    // console.log("Received request to get viewer with ID:", req.params);

    const { viewerID } = req.params; // FIXED (match exact case)
    const clientViewerId = viewerID;

    // console.log("Fetching viewer with clientViewerId:", clientViewerId);

    if (!clientViewerId || clientViewerId.trim() === "") {
      return res.status(400).json({
        error: "clientViewerId is required",
      });
    }

    const result = await ddbDocClient.send(
      new QueryCommand({
        TableName: VIEWERS_TABLE,
        IndexName: VIEWER_ID_INDEX,
        KeyConditionExpression: "clientViewerId = :v",
        ExpressionAttributeValues: {
          ":v": clientViewerId,
        },
        ScanIndexForward: false,
      })
    );

    if (!result.Items || result.Items.length === 0) {
      return res.status(404).json({ error: "Viewer not found" });
    }

    const enriched = await Promise.all(
      result.Items.map(async (v) => {
        const eventRes = await ddbDocClient.send(
          new GetCommand({
            TableName: EVENTS_TABLE,
            Key: { eventId: v.eventId },
          })
        );

        return {
          ...formatViewer(v),
          event: eventRes.Item ? formatEvent(eventRes.Item) : null,
        };
      })
    );

    res.json(enriched);
  } catch (err) {
    next(err);
  }
}



/* =======================================================
   4. DELETE VIEWER
   DELETE /api/viewers/:eventId/:clientViewerId
======================================================= */
export async function deleteViewer(req, res, next) {
  try {
    const { eventId, clientViewerId } = req.params;

    await ddbDocClient.send(
      new DeleteCommand({
        TableName: VIEWERS_TABLE,
        Key: { eventId, clientViewerId },
      })
    );

    res.json({ message: "Viewer deleted successfully" });
  } catch (err) {
    next(err);
  }
}
