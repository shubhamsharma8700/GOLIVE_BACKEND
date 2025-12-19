// src/utils/viewerJwt.js
import jwt from "jsonwebtoken";

const VIEWER_JWT_SECRET =
  process.env.VIEWER_JWT_SECRET || "replace_this_secret";
const VIEWER_JWT_EXP =
  process.env.VIEWER_JWT_EXP || "7d";

export function signViewerToken({ eventId, clientViewerId }) {
  if (!eventId || !clientViewerId) {
    throw new Error("eventId and clientViewerId required for viewer token");
  }

  return jwt.sign(
    { eventId, clientViewerId },
    VIEWER_JWT_SECRET,
    { expiresIn: VIEWER_JWT_EXP }
  );
}

export function verifyViewerToken(token) {
  return jwt.verify(token, VIEWER_JWT_SECRET);
}
