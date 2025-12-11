// src/utils/viewerJwt.js
import jwt from "jsonwebtoken";

const VIEWER_JWT_SECRET = process.env.VIEWER_JWT_SECRET || "replace_this_secret";
const VIEWER_JWT_EXP = process.env.VIEWER_JWT_EXP || "7d"; // token lifetime

export function signViewerToken(payload = {}) {
  // payload should include { viewerToken, eventId, clientViewerId? }
  return jwt.sign(payload, VIEWER_JWT_SECRET, { expiresIn: VIEWER_JWT_EXP });
}

export function verifyViewerToken(token) {
  return jwt.verify(token, VIEWER_JWT_SECRET);
}
