import {
  ddbDocClient,
  DeleteCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TABLE,
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

console.log("TABLE inside controller:", TABLE);

// REGISTER
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
        Item: item,
        ConditionExpression: "attribute_not_exists(adminID)"
      })
    );

    delete item.passwordHash;
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
}

// LOGIN
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

    //--- status check
    if (admin.status === "inactive")
      return res.status(403).json({
        error: "Your account is inactive. Contact an administrator."
    });
    //---
    const valid = await comparePassword(password, admin.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      {
        sub: admin.adminID,
        email: admin.email,
        name: admin.name
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    await ddbDocClient.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { adminID: admin.adminID },
        UpdateExpression: "SET lastLoginAt = :l, updatedAt = :u",
        ExpressionAttributeValues: { ":l": Date.now(), ":u": Date.now() }
      })
    );

    res.json({
      token,
      expiresIn: JWT_EXPIRES_IN,
      admin: {
        adminID: admin.adminID,
        name: admin.name,
        email: admin.email
      }
    });
  } catch (err) {
    next(err);
  }
}

// LIST
export async function listAdmin(req, res, next) {
  try {
    const result = await ddbDocClient.send(new ScanCommand({ TableName: TABLE }));
    const safe = result.Items.map(({ passwordHash, passwordResetOTP, passwordResetOtpExpiry, ...rest }) => rest);
    res.json(safe);
  } catch (err) {
    next(err);
  }
}

// UPDATE
export async function updateAdmin(req, res, next) {
  try {
    const { adminID } = req.params;
    const { name, status, email } = req.body;

    const now = Date.now();
    const updates = [];
    const names = {};
    const values = {};

    if (name) { updates.push("#n = :n"); names["#n"] = "name"; values[":n"] = name; }
    if (status) { updates.push("#s = :s"); names["#s"] = "status"; values[":s"] = status; }
    if (email) { updates.push("#e = :e"); names["#e"] = "email"; values[":e"] = email; }

    updates.push("#u = :u");
    names["#u"] = "updatedAt";
    values[":u"] = now;

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

    const { passwordHash, passwordResetOTP, passwordResetOtpExpiry, ...safe } = updated.Attributes;
    res.json(safe);
  } catch (err) {
    next(err);
  }
}

// DELETE
export async function deleteAdmin(req, res, next) {
  try {
    const { adminID } = req.params;

    await ddbDocClient.send(
      new DeleteCommand({
        TableName: TABLE,
        Key: { adminID }
      })
    );

    res.json({ message: "Admin Deleted Successfully" });
  } catch (err) {
    next(err);
  }
}

// FORGOT PASSWORD → request OTP
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
    const otp = generateOtp();
    const expiry = getExpiry();

    await ddbDocClient.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { adminID: admin.adminID },
        UpdateExpression: "SET passwordResetOTP = :otp, passwordResetOtpExpiry = :exp",
        ExpressionAttributeValues: {
          ":otp": otp,
          ":exp": expiry
        }
      })
    );

    await sendOtpEmail(email, otp);

    res.json({ message: "Otp sent successfully" });
  } catch (err) {
    next(err);
  }
}

// VERIFY OTP & RESET PASSWORD
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

    if (admin.passwordResetOTP !== otp)
      return res.status(400).json({ error: "Invalid OTP" });

    if (Date.now() > admin.passwordResetOtpExpiry)
      return res.status(400).json({ error: "OTP expired" });

    const passwordHash = await hashPassword(newPassword);

    const updated = await ddbDocClient.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { adminID: admin.adminID },
        UpdateExpression:
          "SET passwordHash = :ph REMOVE passwordResetOTP, passwordResetOtpExpiry",
        ExpressionAttributeValues: { ":ph": passwordHash },
        ReturnValues: "ALL_NEW"
      })
    );

    res.json({ message: "Password updated" });
  } catch (err) {
    next(err);
  }
}
