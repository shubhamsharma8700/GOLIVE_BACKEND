import {
  ddbDocClient,
  DeleteCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  GetCommand,
  UpdateCommand,
} from "../config/awsClients.js";

import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { comparePassword, hashPassword } from "../utils/hash.js";
import { generateOtp, getExpiry } from "../utils/otp.js";
import { sendOtpEmail } from "../utils/sesMailer.js";

/* =====================================================
   ENV CONFIG
===================================================== */

const ADMIN_TABLE = process.env.ADMIN_TABLE_NAME;
const ADMIN_EMAIL_INDEX = process.env.ADMIN_EMAIL_INDEX || "email-index";

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

const JWT_ACCESS_EXPIRES_IN = parseInt(
  process.env.JWT_ACCESS_EXPIRES_IN || "900",
  10
); // 15 minutes

const JWT_REFRESH_EXPIRES_IN = parseInt(
  process.env.JWT_REFRESH_EXPIRES_IN || "2592000",
  10
); // 30 days

if (!ADMIN_TABLE || !JWT_ACCESS_SECRET || !JWT_REFRESH_SECRET) {
  throw new Error("Missing required environment variables");
}

/* =====================================================
   TOKEN HELPERS
===================================================== */

function signAccessToken(admin) {
  return jwt.sign(
    {
      sub: admin.adminID,
      email: admin.email,
      name: admin.name,
      type: "access",
    },
    JWT_ACCESS_SECRET,
    { expiresIn: JWT_ACCESS_EXPIRES_IN }
  );
}

function signRefreshToken(admin) {
  return jwt.sign(
    {
      sub: admin.adminID,
      type: "refresh",
    },
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRES_IN }
  );
}

/* =====================================================
   FORMATTER
===================================================== */

function formatAdmin(admin) {
  if (!admin) return null;

  return {
    ...admin,
    createdAt: admin.createdAt
      ? new Date(admin.createdAt).toISOString()
      : null,
    updatedAt: admin.updatedAt
      ? new Date(admin.updatedAt).toISOString()
      : null,
    lastLoginAt: admin.lastLoginAt
      ? new Date(admin.lastLoginAt).toISOString()
      : null,
  };
}

/* =====================================================
   1. REGISTER ADMIN
===================================================== */

export async function registerAdmin(req, res, next) {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password)
      return res
        .status(400)
        .json({ error: "name, email, password required" });

    const emailCheck = await ddbDocClient.send(
      new QueryCommand({
        TableName: ADMIN_TABLE,
        IndexName: ADMIN_EMAIL_INDEX,
        KeyConditionExpression: "email = :email",
        ExpressionAttributeValues: { ":email": email },
      })
    );

    if (emailCheck.Items?.length)
      return res.status(409).json({ error: "Email already registered" });

    const adminID = uuidv4();
    const now = Date.now();

    await ddbDocClient.send(
      new PutCommand({
        TableName: ADMIN_TABLE,
        Item: {
          adminID,
          name,
          email,
          passwordHash: await hashPassword(password),
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
      })
    );

    res.status(201).json(
      formatAdmin({
        adminID,
        name,
        email,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
    );
  } catch (err) {
    next(err);
  }
}

/* =====================================================
   2. LOGIN (ACCESS + REFRESH TOKENS)
===================================================== */

export async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    const q = await ddbDocClient.send(
      new QueryCommand({
        TableName: ADMIN_TABLE,
        IndexName: ADMIN_EMAIL_INDEX,
        KeyConditionExpression: "email = :email",
        ExpressionAttributeValues: { ":email": email },
      })
    );

    if (!q.Items?.length)
      return res.status(401).json({ error: "Invalid credentials" });

    const admin = q.Items[0];

    if (admin.status !== "active")
      return res.status(403).json({ error: "Your account is inactive" });

    const valid = await comparePassword(password, admin.passwordHash);
    if (!valid)
      return res.status(401).json({ error: "Invalid credentials" });

    const accessToken = signAccessToken(admin);
    const refreshToken = signRefreshToken(admin);

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: JWT_REFRESH_EXPIRES_IN * 1000,
    });

    const now = Date.now();

    await ddbDocClient.send(
      new UpdateCommand({
        TableName: ADMIN_TABLE,
        Key: { adminID: admin.adminID },
        UpdateExpression: "SET lastLoginAt = :l, updatedAt = :u",
        ExpressionAttributeValues: { ":l": now, ":u": now },
      })
    );

    res.json({
      token: accessToken,
      expiresIn: JWT_ACCESS_EXPIRES_IN,
      admin: formatAdmin({
        adminID: admin.adminID,
        name: admin.name,
        email: admin.email,
        lastLoginAt: now,
        updatedAt: now,
      }),
    });
  } catch (err) {
    next(err);
  }
}




/* =====================================================
   3. REFRESH ACCESS TOKEN
===================================================== */

export async function refreshToken(req, res) {
  try {
    const token = req.cookies?.refreshToken;
    if (!token)
      return res.status(401).json({ error: "No refresh token" });

    const decoded = jwt.verify(token, JWT_REFRESH_SECRET);
    if (decoded.type !== "refresh")
      return res.status(401).json({ error: "Invalid token type" });

    const result = await ddbDocClient.send(
      new GetCommand({
        TableName: ADMIN_TABLE,
        Key: { adminID: decoded.sub },
      })
    );

    if (!result.Item || result.Item.status !== "active")
      return res.status(401).json({ error: "Admin not found" });

    const newAccessToken = signAccessToken(result.Item);

    res.json({
      token: newAccessToken,
      expiresIn: JWT_ACCESS_EXPIRES_IN,
    });
  } catch {
    res.status(401).json({ error: "Refresh token expired" });
  }
}

/* =====================================================
   4. LIST ADMINS
===================================================== */

export async function listAdmin(req, res, next) {
  try {
    const limit = parseInt(req.query.limit || "20", 10);
    const search = req.query.q?.trim().toLowerCase();
    const lastKey = req.query.lastKey || null;

    const totalScan = await ddbDocClient.send(
      new ScanCommand({
        TableName: ADMIN_TABLE,
        Select: "COUNT",
      })
    );

    const params = { TableName: ADMIN_TABLE, Limit: limit };
    if (lastKey) params.ExclusiveStartKey = { adminID: lastKey };

    const result = await ddbDocClient.send(new ScanCommand(params));

    let items = result.Items.map(
      ({ passwordHash, passwordResetOTP, passwordResetOtpExpiry, ...rest }) =>
        formatAdmin(rest)
    );

    if (search) {
      items = items.filter(
        (i) =>
          i.name?.toLowerCase().includes(search) ||
          i.email?.toLowerCase().includes(search)
      );
    }

    res.json({
      items,
      pagination: {
        totalItems: totalScan.Count || 0,
        limit,
        nextKey: result.LastEvaluatedKey?.adminID || null,
        hasMore: Boolean(result.LastEvaluatedKey),
      },
    });
  } catch (err) {
    next(err);
  }
}

/* =====================================================
   5. GET / UPDATE / DELETE ADMIN
===================================================== */

export async function getAdminById(req, res, next) {
  try {
    const { adminID } = req.params;

    const result = await ddbDocClient.send(
      new GetCommand({
        TableName: ADMIN_TABLE,
        Key: { adminID },
      })
    );

    if (!result.Item)
      return res.status(404).json({ error: "Admin not found" });

    const { passwordHash, ...safe } = result.Item;
    res.json(formatAdmin(safe));
  } catch (err) {
    next(err);
  }
}

export async function updateAdmin(req, res, next) {
  try {
    const { adminID } = req.params;
    const { name, status, email } = req.body;

    if (email)
      return res.status(400).json({ error: "Email cannot be updated" });

    const updates = [];
    const names = { "#u": "updatedAt" };
    const values = { ":u": Date.now() };

    if (name) {
      updates.push("#n = :n");
      names["#n"] = "name";
      values[":n"] = name;
    }

    if (status) {
      updates.push("#s = :s");
      names["#s"] = "status";
      values[":s"] = status;
    }

    updates.push("#u = :u");

    const updated = await ddbDocClient.send(
      new UpdateCommand({
        TableName: ADMIN_TABLE,
        Key: { adminID },
        UpdateExpression: "SET " + updates.join(", "),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      })
    );

    const { passwordHash, ...safe } = updated.Attributes;
    res.json(formatAdmin(safe));
  } catch (err) {
    next(err);
  }
}

export async function deleteAdmin(req, res, next) {
  try {
    const { adminID } = req.params;

    const result = await ddbDocClient.send(
      new DeleteCommand({
        TableName: ADMIN_TABLE,
        Key: { adminID },
        ReturnValues: "ALL_OLD",
      })
    );

    if (!result.Attributes)
      return res.status(404).json({ error: "Admin not found" });

    res.json({ message: "Admin deleted successfully" });
  } catch (err) {
    next(err);
  }
}

/* =====================================================
   6. PASSWORD RESET
===================================================== */

export async function requestPasswordReset(req, res, next) {
  try {
    const { email } = req.body;

    const q = await ddbDocClient.send(
      new QueryCommand({
        TableName: ADMIN_TABLE,
        IndexName: ADMIN_EMAIL_INDEX,
        KeyConditionExpression: "email = :email",
        ExpressionAttributeValues: { ":email": email },
      })
    );

    if (!q.Items?.length)
      return res.json({ message: "If email exists, OTP sent" });

    const admin = q.Items[0];
    const now = Date.now();

    if (
      admin.passwordResetRequestedAt &&
      now - admin.passwordResetRequestedAt < 120000
    ) {
      return res.status(429).json({ error: "OTP already sent" });
    }

    const otp = generateOtp();
    const expiry = getExpiry();

    await ddbDocClient.send(
      new UpdateCommand({
        TableName: ADMIN_TABLE,
        Key: { adminID: admin.adminID },
        UpdateExpression:
          "SET passwordResetOTP = :o, passwordResetOtpExpiry = :e, passwordResetRequestedAt = :n",
        ExpressionAttributeValues: {
          ":o": await hashPassword(otp),
          ":e": expiry,
          ":n": now,
        },
      })
    );

    await sendOtpEmail(email, otp);

    res.json({
      message: "OTP sent",
      expiresAt: new Date(expiry).toISOString(),
    });
  } catch (err) {
    next(err);
  }
}

export async function verifyOtpAndReset(req, res, next) {
  try {
    const { email, otp, newPassword } = req.body;

    const q = await ddbDocClient.send(
      new QueryCommand({
        TableName: ADMIN_TABLE,
        IndexName: ADMIN_EMAIL_INDEX,
        KeyConditionExpression: "email = :email",
        ExpressionAttributeValues: { ":email": email },
      })
    );

    if (!q.Items?.length)
      return res.status(400).json({ error: "Invalid email/OTP" });

    const admin = q.Items[0];

    if (Date.now() > admin.passwordResetOtpExpiry)
      return res.status(400).json({ error: "OTP expired" });

    if (!(await comparePassword(otp, admin.passwordResetOTP)))
      return res.status(400).json({ error: "Invalid OTP" });

    await ddbDocClient.send(
      new UpdateCommand({
        TableName: ADMIN_TABLE,
        Key: { adminID: admin.adminID },
        UpdateExpression:
          "SET passwordHash = :p REMOVE passwordResetOTP, passwordResetOtpExpiry, passwordResetRequestedAt",
        ExpressionAttributeValues: {
          ":p": await hashPassword(newPassword),
        },
      })
    );

    res.json({ message: "Password updated" });
  } catch (err) {
    next(err);
  }
}

/* =====================================================
   7. PROFILE + LOGOUT
===================================================== */

export async function getAdminProfile(req, res, next) {
  try {
    const adminID = req.user?.sub;
    if (!adminID) return res.status(401).json({ error: "Unauthorized" });

    const result = await ddbDocClient.send(
      new GetCommand({
        TableName: ADMIN_TABLE,
        Key: { adminID },
      })
    );

    if (!result.Item)
      return res.status(404).json({ error: "Admin not found" });

    const { passwordHash, ...safe } = result.Item;
    res.json(formatAdmin(safe));
  } catch (err) {
    next(err);
  }
}

export async function logoutAdmin(req, res) {
  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
  });

  res.json({ message: "Logged out successfully" });
}
