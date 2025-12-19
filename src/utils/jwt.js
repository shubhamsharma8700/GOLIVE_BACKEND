import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "12h";

export const signViewerToken = ({ eventId, clientViewerId, isPaidViewer }) => {
  if (!eventId || !clientViewerId) {
    throw new Error("eventId and clientViewerId are required");
  }

  const payload = {
    eventId,
    clientViewerId,
    isPaidViewer: Boolean(isPaidViewer),
  };

  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};


export const verifyViewerToken = (token) => {
  return jwt.verify(token, JWT_SECRET);
};
