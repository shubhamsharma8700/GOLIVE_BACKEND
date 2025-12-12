import { ddbDocClient, GetCommand } from "../config/awsClients.js";

const VIEWERS_TABLE = process.env.VIEWERS_TABLE_NAME || "go-live-viewers";

/**
 * Viewer Authentication Middleware
 * Validates viewerToken stored in DynamoDB (NOT JWT)
 */
export default async function viewerAuth(req, res, next) {
  try {
    const header =
      req.headers.authorization ||
      req.headers["x-viewer-token"];

    if (!header) {
      return res.status(401).json({ success: false, message: "Viewer token required" });
    }

    const token = header.replace("Bearer ", "").replace("ViewerToken ", "").trim();

    if (!token) {
      return res.status(401).json({ success: false, message: "Invalid viewer token" });
    }

    // ---- Direct PK lookup ----
    const result = await ddbDocClient.send(
      new GetCommand({
        TableName: VIEWERS_TABLE,
        Key: { viewerToken: token }
      })
    );

    if (!result.Item) {
      return res.status(401).json({
        success: false,
        message: "Viewer token not found"
      });
    }

    const viewer = result.Item;

    // ---- OPTIONAL TOKEN EXPIRY SUPPORT ----
    if (viewer.tokenExpiresAt && new Date(viewer.tokenExpiresAt) < new Date()) {
      return res.status(401).json({ success: false, message: "Viewer token expired" });
    }

    req.viewer = viewer;
    return next();

  } catch (err) {
    console.error("viewerAuth error:", err);
    return res.status(500).json({ success: false, message: "Viewer authentication failed" });
  }
}
