import { ddbDocClient, GetCommand } from "../config/awsClients.js";
import { verifyViewerToken } from "../utils/viewerJwt.js";

const VIEWERS_TABLE =
  process.env.VIEWERS_TABLE_NAME || "go-live-poc-viewers";

export default async function viewerAuth(req, res, next) {
  try {
    const header =
      req.headers.authorization ||
      req.headers["x-viewer-token"];

    if (!header) {
      return res.status(401).json({
        success: false,
        message: "Viewer token required"
      });
    }

    const rawToken = header
      .replace("Bearer ", "")
      .trim();

    // 1️⃣ Verify JWT
    let payload;
    try {
      payload = verifyViewerToken(rawToken);
    } catch {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired viewer token"
      });
    }

    const { eventId, clientViewerId } = payload;

    if (!eventId || !clientViewerId) {
      return res.status(401).json({
        success: false,
        message: "Malformed viewer token"
      });
    }

    // 2️⃣ DynamoDB lookup using PK + SK
    const { Item } = await ddbDocClient.send(
      new GetCommand({
        TableName: VIEWERS_TABLE,
        Key: {
          eventId,
          clientViewerId
        }
      })
    );

    if (!Item) {
      return res.status(401).json({
        success: false,
        message: "Viewer not authorized"
      });
    }

    // 3️⃣ Attach minimal viewer context
    req.viewer = {
      eventId,
      clientViewerId,
      accessVerified: Item.accessVerified,
      isPaidViewer: Item.isPaidViewer,
      viewerpaid: Item.viewerpaid
    };

    return next();
  } catch (err) {
    console.error("viewerAuth error:", err);
    return res.status(500).json({
      success: false,
      message: "Viewer authentication failed"
    });
  }
}
