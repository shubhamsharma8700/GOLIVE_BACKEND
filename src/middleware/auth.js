import jwt from "jsonwebtoken";

/**
 * Middleware to protect admin routes
 * - Validates ACCESS token only
 * - Rejects refresh tokens
 * - Attaches decoded user to req.user
 */
export function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    // Authorization: Bearer <accessToken>
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

    // Extra safety: ensure this is an access token
    if (decoded.type !== "access") {
      return res.status(401).json({ error: "Invalid token type" });
    }

    req.user = decoded;
    next();
  } catch (err) {
    // Token expired or invalid
    return res.status(401).json({ error: "Token expired or invalid" });
  }
}
