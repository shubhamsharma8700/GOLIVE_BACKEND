import {
  ddbDocClient,
  DeleteCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TABLE,
  GetCommand,
  UpdateCommand
} from "../config/awsClients.js";

import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { comparePassword, hashPassword } from "../utils/hash.js";
import { generateOtp, getExpiry } from "../utils/otp.js";
import { sendOtpEmail } from "../utils/sesMailer.js";


const ADMIN_EMAIL_INDEX = process.env.ADMIN_EMAIL_INDEX || "email-index";
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = parseInt(process.env.JWT_EXPIRES_IN || "3600", 10);


  //  Helper → Convert timestamps to ISO format

function formatAdmin(admin) {
  if (!admin) return null;

  return {
    ...admin,
    createdAt: admin.createdAt ? new Date(admin.createdAt).toISOString() : null,
    updatedAt: admin.updatedAt ? new Date(admin.updatedAt).toISOString() : null,
    lastLoginAt: admin.lastLoginAt
      ? new Date(admin.lastLoginAt).toISOString()
      : null
  };
}


  //  1. REGISTER ADMIN

export async function registerAdmin(req, res, next) {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ error: "name, email, password required" });

    const emailCheck = await ddbDocClient.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: ADMIN_EMAIL_INDEX,
        KeyConditionExpression: "email = :email",
        ExpressionAttributeValues: { ":email": email }
      })
    );

    if (emailCheck.Items?.length > 0)
      return res.status(409).json({ error: "Email already registered" });

    const adminID = uuidv4();
    const now = Date.now();
    const passwordHash = await hashPassword(password);

    const item = {
      adminID,
      name,
      email,
      passwordHash,
      status: "active",
      createdAt: now,
      updatedAt: now
    };

    await ddbDocClient.send(
      new PutCommand({
        TableName: TABLE,
        Item: item
      })
    );

    delete item.passwordHash;

    res.status(201).json(formatAdmin(item));
  } catch (err) {
    next(err);
  }
}

//  2. LOGIN (with cookie support)
export async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    const q = await ddbDocClient.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: ADMIN_EMAIL_INDEX,
        KeyConditionExpression: "email = :email",
        ExpressionAttributeValues: { ":email": email }
      })
    );

    if (!q.Items || q.Items.length === 0)
      return res.status(401).json({ error: "Invalid credentials" });

    const admin = q.Items[0];

    if (admin.status === "inactive")
      return res.status(403).json({ error: "Your account is inactive." });

    const valid = await comparePassword(password, admin.passwordHash);
    if (!valid)
      return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      {
        sub: admin.adminID,
        email: admin.email,
        name: admin.name
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: JWT_EXPIRES_IN * 1000
    });

    const now = Date.now();

    await ddbDocClient.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { adminID: admin.adminID },
        UpdateExpression: "SET lastLoginAt = :l, updatedAt = :u",
        ExpressionAttributeValues: {
          ":l": now,
          ":u": now
        }
      })
    );

    return res.json({
      token,
      expiresIn: JWT_EXPIRES_IN,
      admin: formatAdmin({
        adminID: admin.adminID,
        name: admin.name,
        email: admin.email,
        lastLoginAt: now,
        updatedAt: now
      })
    });
  } catch (err) {
    next(err);
  }
}

//  3. LIST ADMINS (Pagination + Search + ISO Dates)
export async function listAdmin(req, res, next) {
  try {
    const limit = parseInt(req.query.limit || "20", 10);
    const search = req.query.q?.trim().toLowerCase();
    const lastKey = req.query.lastKey || null;

    // Count total items
    const totalScan = await ddbDocClient.send(
      new ScanCommand({
        TableName: TABLE,
        Select: "COUNT"
      })
    );

    const totalItems = totalScan.Count || 0;

    // Pagination scan
    const params = { TableName: TABLE, Limit: limit };

    if (lastKey) {
      params.ExclusiveStartKey = { adminID: lastKey };
    }

    const result = await ddbDocClient.send(new ScanCommand(params));

    let items = result.Items.map(
      ({ passwordHash, passwordResetOTP, passwordResetOtpExpiry, ...rest }) =>
        formatAdmin(rest)
    );

    // Search filter
    if (search) {
      items = items.filter(
        (item) =>
          item.name?.toLowerCase().includes(search) ||
          item.email?.toLowerCase().includes(search)
      );
    }

    const nextKey = result.LastEvaluatedKey?.adminID || null;

    res.json({
      items,
      pagination: {
        totalItems,
        limit,
        totalPages: Math.ceil(totalItems / limit),
        nextKey,
        hasMore: Boolean(nextKey)
      }
    });
  } catch (err) {
    next(err);
  }
}

//  4. GET ADMIN BY ID (ISO Dates)
export async function getAdminById(req, res, next) {
  try {
    const { adminID } = req.params;

    const result = await ddbDocClient.send(
      new GetCommand({
        TableName: TABLE,
        Key: { adminID }
      })
    );

    if (!result.Item)
      return res.status(404).json({ error: "Admin not found" });

    const {
      passwordHash,
      passwordResetOTP,
      passwordResetOtpExpiry,
      ...safe
    } = result.Item;

    res.json(formatAdmin(safe));
  } catch (err) {
    next(err);
  }
}

//  5. UPDATE ADMIN (ISO Dates)
export async function updateAdmin(req, res, next) {
  try {
    const { adminID } = req.params;
    const { name, status, email } = req.body;

    if (email)
      return res.status(400).json({ error: "Email cannot be updated" });

    const now = Date.now();
    const updates = [];
    const names = { "#u": "updatedAt" };
    const values = { ":u": now };

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
        TableName: TABLE,
        Key: { adminID },
        UpdateExpression: "SET " + updates.join(", "),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW"
      })
    );

    const {
      passwordHash,
      passwordResetOTP,
      passwordResetOtpExpiry,
      ...safe
    } = updated.Attributes;

    res.json(formatAdmin(safe));
  } catch (err) {
    next(err);
  }
}

//  6. DELETE ADMIN
export async function deleteAdmin(req, res, next) {
  try {
    const { adminID } = req.params;

    await ddbDocClient.send(
      new DeleteCommand({
        TableName: TABLE,
        Key: { adminID }
      })
    );

    res.json({ message: "Admin deleted successfully" });
  } catch (err) {
    next(err);
  }
}

//  7. REQUEST OTP (ISO if returned)
export async function requestPasswordReset(req, res, next) {
  try {
    const { email } = req.body;

    const q = await ddbDocClient.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: ADMIN_EMAIL_INDEX,
        KeyConditionExpression: "email = :email",
        ExpressionAttributeValues: { ":email": email }
      })
    );

    if (!q.Items || q.Items.length === 0) {
      return res.json({ message: "If that email exists, an OTP was sent" });
    }

    const admin = q.Items[0];
    const now = Date.now();

    // Cooldown (2 minutes)
    if (
      admin.passwordResetRequestedAt &&
      now - admin.passwordResetRequestedAt < 120000
    ) {
      return res
        .status(429)
        .json({ error: "OTP already sent. Try again later." });
    }

    const otp = generateOtp();
    const expiry = getExpiry();
    const otpHash = await hashPassword(otp);
    console.log("Generated OTP for", email, "is", otp); // For testing/demo purposes

    await ddbDocClient.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { adminID: admin.adminID },
        UpdateExpression:
          "SET passwordResetOTP = :otp, passwordResetOtpExpiry = :exp, passwordResetRequestedAt = :now",
        ExpressionAttributeValues: {
          ":otp": otpHash,
          ":exp": expiry,
          ":now": now
        }
      })
    );

    await sendOtpEmail(email, otp);

    res.json({
      message: "OTP sent successfully",
      requestedAt: new Date(now).toISOString(),
      expiresAt: new Date(expiry).toISOString()
    });
  } catch (err) {
    next(err);
  }
}

//  8. VERIFY OTP + RESET PASSWORD
export async function verifyOtpAndReset(req, res, next) {
  try {
    const { email, otp, newPassword } = req.body;

    const q = await ddbDocClient.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: ADMIN_EMAIL_INDEX,
        KeyConditionExpression: "email = :email",
        ExpressionAttributeValues: { ":email": email }
      })
    );

    if (!q.Items || q.Items.length === 0)
      return res.status(400).json({ error: "Invalid email/OTP" });

    const admin = q.Items[0];

    if (Date.now() > admin.passwordResetOtpExpiry)
      return res.status(400).json({ error: "OTP expired" });

    const validOtp = await comparePassword(otp, admin.passwordResetOTP);
    if (!validOtp)
      return res.status(400).json({ error: "Invalid OTP" });

    const passwordHash = await hashPassword(newPassword);

    await ddbDocClient.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { adminID: admin.adminID },
        UpdateExpression:
          "SET passwordHash = :ph REMOVE passwordResetOTP, passwordResetOtpExpiry, passwordResetRequestedAt",
        ExpressionAttributeValues: { ":ph": passwordHash }
      })
    );

    res.json({ message: "Password updated" });
  } catch (err) {
    next(err);
  }
}



//  9. GET LOGGED-IN ADMIN PROFILE (ISO Dates)
export async function getAdminProfile(req, res) {
  try {
    const adminID = req.user?.sub; // from JWT token

    if (!adminID) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    


    const result = await ddbDocClient.send(
      new GetCommand({
        TableName: TABLE,
        Key: { adminID }
      })
    );

    if (!result.Item) {
      return res.status(404).json({ error: "Admin not found" });
    }

    const {
      passwordHash,
      passwordResetOTP,
      passwordResetOtpExpiry,
      ...safe
    } = result.Item;

    res.json(formatAdmin(safe));
  } catch (err) {
    next(err);
  }
}


/*  10. LOGOUT ADMIN (Clear Cookie) */
export async function logoutAdmin(req, res, next) {
  try {
    // Clear JWT cookie
    res.clearCookie("token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });

    return res.json({ message: "Logged out successfully" });
  } catch (err) {
    next(err);
  }
}
