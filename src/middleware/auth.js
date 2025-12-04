import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;

export function requireAuth(req, res, next) {
  if (!JWT_SECRET) {
    console.error("JWT_SECRET is missing from environment variables.");
    return res.status(500).json({ error: "Server misconfiguration" });
  }

  // Check Authorization header or cookie
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.split(" ")[1]
    : req.cookies?.token;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized: No token provided" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // attach user payload
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
