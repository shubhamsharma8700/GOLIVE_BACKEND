// src/utils/viewerJwt.js
import jwt from "jsonwebtoken";

const VIEWER_JWT_SECRET =
  process.env.VIEWER_JWT_SECRET || "golive-viewer-secret";
const VIEWER_JWT_EXP =
  process.env.VIEWER_JWT_EXP || "7d";

export function signViewerToken({ eventId, clientViewerId, isPaidViewer }) {
  if (!eventId || !clientViewerId) {
    throw new Error("eventId and clientViewerId required");
  }

  return jwt.sign(
    {
      eventId,
      clientViewerId,
      isPaidViewer: Boolean(isPaidViewer),
    },
    VIEWER_JWT_SECRET,
    { expiresIn: VIEWER_JWT_EXP }
  );
}

export function verifyViewerToken(token) {
  return jwt.verify(token, VIEWER_JWT_SECRET);
}
