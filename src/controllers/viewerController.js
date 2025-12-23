import {
  ddbDocClient,
  ScanCommand,
  QueryCommand,
  DeleteCommand,
} from "../config/awsClients.js";

const VIEWERS_TABLE = process.env.VIEWERS_TABLE_NAME;
const VIEWER_ID_INDEX = "viewerId-index";

if (!VIEWERS_TABLE) {
  throw new Error("Missing ENV variable: VIEWERS_TABLE_NAME");
}

/* -------------------------------------------------------
   Helper
------------------------------------------------------- */
function formatViewer(v) {
  if (!v) return null;

  return {
    ...v,
    createdAt: v.createdAt
      ? new Date(v.createdAt).toISOString()
      : null,
    lastActiveAt: v.lastActiveAt
      ? new Date(v.lastActiveAt).toISOString()
      : null,
  };
}

/* =======================================================
   1. LIST ALL VIEWERS (ADMIN)
   GET /api/viewers
   Uses Scan (no global PK exists)
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

    const nextKey = result.LastEvaluatedKey;

    res.json({
      items: (result.Items || []).map(formatViewer),
      pagination: {
        limit,
        nextKey: nextKey
          ? {
              lastEventId: nextKey.eventId,
              lastClientViewerId: nextKey.clientViewerId,
            }
          : null,
        hasMore: Boolean(nextKey),
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

    const lastKey = req.query.lastClientViewerId
      ? { eventId, clientViewerId: req.query.lastClientViewerId }
      : null;

    if (!eventId) {
      return res.status(400).json({ error: "eventId is required" });
    }

    const params = {
      TableName: VIEWERS_TABLE,
      KeyConditionExpression: "eventId = :e",
      ExpressionAttributeValues: { ":e": eventId },
      Limit: limit,
      ScanIndexForward: false, // latest viewers first
    };

    if (lastKey) {
      params.ExclusiveStartKey = lastKey;
    }

    const result = await ddbDocClient.send(new QueryCommand(params));

    res.json({
      items: (result.Items || []).map(formatViewer),
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
   Uses GSI (viewerId-index)
======================================================= */
export async function getViewerById(req, res, next) {
  try {
    const { clientViewerId } = req.params;

    const result = await ddbDocClient.send(
      new QueryCommand({
        TableName: VIEWERS_TABLE,
        IndexName: VIEWER_ID_INDEX,
        KeyConditionExpression: "clientViewerId = :v",
        ExpressionAttributeValues: { ":v": clientViewerId },
        ScanIndexForward: false, // latest activity first
      })
    );

    if (!result.Items || result.Items.length === 0) {
      return res.status(404).json({ error: "Viewer not found" });
    }

    // Viewer may exist across multiple events
    res.json(result.Items.map(formatViewer));
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
