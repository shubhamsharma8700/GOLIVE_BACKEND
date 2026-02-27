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

function parseLimit(value, fallback = 10, max = 100) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function encodePageToken(lastEvaluatedKey) {
  if (!lastEvaluatedKey) return null;
  return Buffer.from(JSON.stringify(lastEvaluatedKey)).toString("base64");
}

function decodePageToken(token) {
  if (!token) return null;
  try {
    const decoded = Buffer.from(token, "base64").toString("utf8");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

async function getTableCount(tableName) {
  let total = 0;
  let lastEvaluatedKey;

  do {
    const result = await ddbDocClient.send(
      new ScanCommand({
        TableName: tableName,
        Select: "COUNT",
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    total += result.Count || 0;
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return total;
}

async function scanAllViewers(tableName) {
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
}

async function getEventViewerCount(eventId) {
  let total = 0;
  let lastEvaluatedKey;

  do {
    const result = await ddbDocClient.send(
      new QueryCommand({
        TableName: VIEWERS_TABLE,
        KeyConditionExpression: "eventId = :e",
        ExpressionAttributeValues: { ":e": eventId },
        Select: "COUNT",
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    total += result.Count || 0;
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return total;
}

async function scanViewersByClientViewerId(clientViewerId, limit = null) {
  const matched = [];
  let lastEvaluatedKey;

  do {
    const result = await ddbDocClient.send(
      new ScanCommand({
        TableName: VIEWERS_TABLE,
        FilterExpression: "clientViewerId = :v",
        ExpressionAttributeValues: {
          ":v": clientViewerId,
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (result.Items?.length) {
      matched.push(...result.Items);
      if (limit && matched.length >= limit) {
        return matched.slice(0, limit);
      }
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return matched;
}

async function findViewersByClientViewerId(clientViewerId, limit = null) {
  const gsiResult = await ddbDocClient.send(
    new QueryCommand({
      TableName: VIEWERS_TABLE,
      IndexName: VIEWER_ID_INDEX,
      KeyConditionExpression: "clientViewerId = :v",
      ExpressionAttributeValues: {
        ":v": clientViewerId,
      },
      ScanIndexForward: false,
      ...(limit ? { Limit: limit } : {}),
    })
  );

  if (gsiResult.Items?.length) {
    return gsiResult.Items;
  }

  // Fallback for rows that do not contain the GSI sort key (lastActiveAt)
  return scanViewersByClientViewerId(clientViewerId, limit);
}

/* =======================================================
   1. LIST ALL VIEWERS (ADMIN)
   GET /api/viewers
======================================================= */
export async function listViewers(req, res, next) {
  try {
    const limit = parseLimit(req.query.limit, 10, 100);
    const q = String(req.query.q || "")
      .trim()
      .toLowerCase();

    const tokenKey = decodePageToken(req.query.nextToken || req.query.lastKey);
    const legacyKey =
      req.query.lastEventId && req.query.lastClientViewerId
        ? {
          eventId: req.query.lastEventId,
          clientViewerId: req.query.lastClientViewerId,
        }
        : null;

    const exclusiveStartKey = tokenKey || legacyKey;

    let viewers = [];
    let totalItems = 0;
    let lastEvaluatedKey = null;

    /* ---------- SEARCH CASE ---------- */
    if (q) {
      const allViewers = await scanAllViewers(VIEWERS_TABLE);

      const filtered = allViewers.filter((v) => {
        const fields = [
          v?.name,
          v?.email,
          v?.formData?.name,
          v?.formData?.email,
        ];
        return fields.some((field) =>
          String(field || "").toLowerCase().includes(q)
        );
      });

      totalItems = filtered.length;

      const offset =
        typeof tokenKey?.offset === "number" && tokenKey.offset >= 0
          ? tokenKey.offset
          : 0;

      viewers = filtered.slice(offset, offset + limit);

      if (offset + limit < totalItems) {
        lastEvaluatedKey = { offset: offset + limit };
      }
    } else {
      /* ---------- NORMAL SCAN CASE ---------- */
      const params = {
        TableName: VIEWERS_TABLE,
        Limit: limit,
      };

      if (exclusiveStartKey) {
        params.ExclusiveStartKey = exclusiveStartKey;
      }

      const [result, count] = await Promise.all([
        ddbDocClient.send(new ScanCommand(params)),
        getTableCount(VIEWERS_TABLE),
      ]);

      viewers = result.Items || [];
      totalItems = count;
      lastEvaluatedKey = result.LastEvaluatedKey || null;
    }

    /* ---------- NEW FILTER (REGISTRATION COMPLETE) ---------- */
    viewers = viewers.filter((v) => v?.registrationComplete === true);

    /* ---------- FETCH EVENTS PER VIEWER ---------- */
    const eventIds = [...new Set(viewers.map((v) => v.eventId))];

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
      totalItems:viewers.length,
      count: viewers.length,
      items: viewers.map((v) => ({
        ...formatViewer(v),
        event: eventMap[v.eventId] || null,
      })),
      pagination: {
        limit,
        totalItems,
        nextKey:
          lastEvaluatedKey?.eventId && lastEvaluatedKey?.clientViewerId
            ? {
              lastEventId: lastEvaluatedKey.eventId,
              lastClientViewerId: lastEvaluatedKey.clientViewerId,
            }
            : null,
        nextToken: encodePageToken(lastEvaluatedKey),
        hasMore: Boolean(lastEvaluatedKey),
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
    const eventId = req.params.eventId || req.params.eventID;
    const limit = parseLimit(req.query.limit, 10, 100);

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

    const tokenKey = decodePageToken(req.query.nextToken || req.query.lastKey);
    if (tokenKey) {
      params.ExclusiveStartKey = tokenKey;
    } else if (req.query.lastClientViewerId) {
      params.ExclusiveStartKey = {
        eventId,
        clientViewerId: req.query.lastClientViewerId,
      };
    }

    const [result, totalItems] = await Promise.all([
      ddbDocClient.send(new QueryCommand(params)),
      getEventViewerCount(eventId),
    ]);

    res.json({
      event: eventInfo,
      totalItems,
      count: (result.Items || []).length,
      items: (result.Items || []).map(v => ({
        ...formatViewer(v),
        event: eventInfo,
      })),
      pagination: {
        limit,
        totalItems,
        nextKey: result.LastEvaluatedKey
          ? {
            lastEventId: result.LastEvaluatedKey.eventId,
            lastClientViewerId: result.LastEvaluatedKey.clientViewerId,
          }
          : null,
        nextToken: encodePageToken(result.LastEvaluatedKey),
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

    const items = await findViewersByClientViewerId(clientViewerId);

    if (!items || items.length === 0) {
      return res.status(404).json({ error: "Viewer not found" });
    }

    const enriched = await Promise.all(
      items.map(async (v) => {
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
    const { viewerID } = req.params;
    const clientViewerId = viewerID;

    if (!clientViewerId) {
      return res.status(400).json({ error: "viewerID is required" });
    }

    const viewers = await findViewersByClientViewerId(clientViewerId, 1);
    const viewer = viewers?.[0];
    if (!viewer) {
      return res.status(404).json({ error: "Viewer not found" });
    }

    await ddbDocClient.send(
      new DeleteCommand({
        TableName: VIEWERS_TABLE,
        Key: { eventId: viewer.eventId, clientViewerId },
      })
    );

    res.json({
      message: "Viewer deleted successfully",
      deleted: {
        eventId: viewer.eventId,
        clientViewerId,
      },
    });
  } catch (err) {
    next(err);
  }
}
