import { verifyViewerToken } from "../utils/jwt.js";

// Minimal viewer authentication middleware using JWT
export default function viewerAuth(req, res, next) {
  const authHeader = req.headers.authorization || req.headers["x-viewer-token"];

  if (!authHeader) {
    return res.status(401).json({ success: false, message: "Viewer token required" });
  }

  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;

  try {
    const payload = verifyViewerToken(token);
    req.viewer = payload;
    return next();
  } catch (error) {
    console.log("viewerAuth payload", token);
    console.error("viewerAuth token error", error);
    return res.status(401).json({ success: false, message: "Invalid or expired viewer token" });
  }
  
}
