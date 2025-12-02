import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";

export const signViewerToken = ({ viewerId, eventId, accessMode, isPaidViewer }) => {
  if (!viewerId || !eventId) {
    throw new Error("viewerId and eventId are required to sign token");
  }

  const payload = {
    viewerId,
    eventId,
    accessMode,
    isPaidViewer: Boolean(isPaidViewer),
  };

  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

export const verifyViewerToken = (token) => {
  return jwt.verify(token, JWT_SECRET);
};
