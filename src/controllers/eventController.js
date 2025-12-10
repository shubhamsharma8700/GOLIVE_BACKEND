import {
  ddbDocClient,
  PutCommand,
  ScanCommand,
  GetCommand,
  DeleteCommand,
} from "../config/awsClients.js";

import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";

const EVENTS_TABLE = process.env.EVENTS_TABLE_NAME || "go-live-poc-events";
const VOD_BUCKET = process.env.S3_VOD_BUCKET || "go-live-vod";
const SIGNED_URL_EXPIRES = Number(process.env.SIGNED_URL_EXPIRES || 900);

const EVENT_TYPES = new Set(["live", "vod"]);
const ACCESS_MODES = new Set([
  "freeAccess",
  "emailAccess",
  "passwordAccess",
  "paidAccess",
]);

const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 10);

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "ap-south-1",
});

// ------------------ Helpers ------------------

const nowISO = () => new Date().toISOString();

const toIsoString = (value) => {
  if (!value) return null;
  const dt = new Date(value);
  if (isNaN(dt.getTime())) throw new Error("Invalid date format");
  return dt.toISOString();
};

const parseNumber = (value) => {
  const n = Number(value);
  if (isNaN(n)) throw new Error("Invalid numeric value");
  return n;
};

const parseFormFields = (value) => {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error("formFields must be valid JSON");
    }
  }
  throw new Error("Invalid formFields input");
};

const resolveCurrency = (value) => {
  const cur = value?.toString()?.trim()?.toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) throw new Error("currency must be ISO 4217");
  return cur;
};

// =======================================================
//        EVENT CONTROLLER
// =======================================================

export default class EventController {

  // =====================================================
  // 1. PRESIGN URL FOR VOD UPLOAD
  // =====================================================
  static async vodPresignUpload(req, res) {
    try {
      const { filename, contentType } = req.query;

      if (!filename)
        return res.status(400).json({ success: false, message: "filename is required" });

      const fileKey = `vod-uploads/${uuidv4()}/${filename}`;

      const command = new PutObjectCommand({
        Bucket: "go-live-vod",
        Key: fileKey,
        ContentType: contentType || "video/mp4",
      });

      const uploadUrl = await getSignedUrl(s3Client, command, {
        expiresIn: SIGNED_URL_EXPIRES,
      });

      return res.status(200).json({
        success: true,
        uploadUrl,
        fileKey,
      });
    } catch (err) {
      console.error("Presign error:", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

// =====================================================
// 2. CREATE EVENT  (Updated for new frontend payload)
// =====================================================
static async createEvent(req, res) {
  try {
    const payload = req.body || {};

    const {
      title,
      description,
      eventType,
      accessMode,

      startTime,
      endTime,

      s3Key,
      s3Prefix,

      videoConfig,           // NEW
      registrationFields,    // NEW ARRAY (instead of formFields)

      paymentAmount,
      currency,
      accessPasswordHash,    // FRONTEND VERSION (optional)
      accessPassword         // RAW PASSWORD (if present)
    } = payload;

    // ------------------ BASIC VALIDATION ------------------
    if (!title) return res.status(400).json({ message: "title is required" });
    if (!description) return res.status(400).json({ message: "description is required" });
    if (!EVENT_TYPES.has(eventType))
      return res.status(400).json({ message: "Invalid eventType" });
    if (!ACCESS_MODES.has(accessMode))
      return res.status(400).json({ message: "Invalid accessMode" });

    // CreatedBy from JWT
    const createdBy =
      req.user?.email ||
      req.user?.id ||
      req.user?.adminId ||
      "unknown-admin";

    // ------------------ LIVE LOGIC ------------------
    let finalStart = null;
    let finalEnd = null;

    if (eventType === "live") {
      if (!startTime)
        return res.status(400).json({ message: "startTime is required" });

      finalStart = toIsoString(startTime);
      finalEnd = endTime ? toIsoString(endTime) : null;
    }

    // ------------------ VOD LOGIC ------------------
    let finalS3Key = null;
    let finalPrefix = null;

    if (eventType === "vod") {
      if (!s3Key)
        return res.status(400).json({ message: "s3Key required for VOD" });

      finalS3Key = s3Key;
      finalPrefix = s3Prefix || s3Key.substring(0, s3Key.lastIndexOf("/") + 1);
    }

    // ------------------ ACCESS MODE ------------------
    let finalPasswordHash = null;
    let finalRegFields = null;
    let finalPayment = null;
    let finalCurrency = null;

    if (accessMode === "passwordAccess") {
      if (accessPasswordHash)
        finalPasswordHash = accessPasswordHash;
      else if (accessPassword)
        finalPasswordHash = await bcrypt.hash(accessPassword, SALT_ROUNDS);
      else
        return res.status(400).json({ message: "Password required" });

      finalRegFields = registrationFields || [];
    }

    if (accessMode === "emailAccess") {
      finalRegFields = registrationFields || [];
    }

    if (accessMode === "paidAccess") {
      finalPayment = Number(paymentAmount);
      finalCurrency = currency;
    }

    if (accessMode === "freeAccess") {
      finalRegFields = null;
    }

    // ------------------ SAVE ITEM ------------------
    const now = nowISO();
    const eventId = uuidv4();

    const item = {
      eventId,
      title,
      description,
      eventType,
      accessMode,
      createdBy,
      createdAt: now,
      updatedAt: now,

      startTime: finalStart,
      endTime: finalEnd,

      s3Key: finalS3Key,
      s3Prefix: finalPrefix,
      vodStatus: eventType === "vod" ? "UPLOADED" : null,

      videoConfig,           // NEW
      registrationFields: finalRegFields, // NEW

      accessPassword: finalPasswordHash || null,
      paymentAmount: finalPayment,
      currency: finalCurrency,

      status: eventType === "live" ? "scheduled" : "uploaded",
    };

    await ddbDocClient.send(
      new PutCommand({
        TableName: EVENTS_TABLE,
        Item: item,
      })
    );

    res.status(201).json({
      success: true,
      eventId,
      message: "Event created",
    });
  } catch (err) {
    console.error("Create Event Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}


  // =====================================================
  // 3. LIST EVENTS (Search capable)
  // =====================================================
  static async listEvents(req, res) {
    try {
      let { q, type, limit = 20 } = req.query;
      limit = Number(limit);

      const raw = await ddbDocClient.send(
        new ScanCommand({ TableName: EVENTS_TABLE })
      );

      let events = raw.Items || [];

      if (q) {
        q = q.toLowerCase();
        events = events.filter(
          (e) =>
            e.title?.toLowerCase().includes(q) ||
            e.description?.toLowerCase().includes(q)
        );
      }

      if (type && EVENT_TYPES.has(type)) {
        events = events.filter((e) => e.eventType === type);
      }

      return res.status(200).json({
        success: true,
        count: events.length,
        events: events.slice(0, limit),
      });
    } catch (err) {
      console.error("List event error:", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // =====================================================
  // 4. GET EVENT
  // =====================================================
  static async getEventById(req, res) {
    try {
      const { eventId } = req.params;

      const result = await ddbDocClient.send(
        new GetCommand({
          TableName: EVENTS_TABLE,
          Key: { eventId },
        })
      );

      if (!result.Item)
        return res.status(404).json({ success: false, message: "Event not found" });

      return res.status(200).json({
        success: true,
        event: result.Item,
      });
    } catch (err) {
      console.error("Get event error:", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

// =====================================================
// 5. UPDATE EVENT (Updated for new frontend payload)
// =====================================================
static async updateEvent(req, res) {
  try {
    const { eventId } = req.params;
    const payload = req.body || {};

    const { Item: existing } = await ddbDocClient.send(
      new GetCommand({ TableName: EVENTS_TABLE, Key: { eventId } })
    );

    if (!existing)
      return res.status(404).json({ success: false, message: "Event not found" });

    // Prevent live ↔ vod change
    if (payload.eventType && payload.eventType !== existing.eventType)
      return res.status(400).json({ message: "eventType cannot be changed" });

    // ------------------ COMBINE FIELDS ------------------
    const updated = {
      ...existing,
      ...payload,
      updatedAt: nowISO(),
    };

    // Normalize registration fields
    if (payload.registrationFields) {
      updated.registrationFields = payload.registrationFields;
    }

    // Normalize video config
    if (payload.videoConfig) {
      updated.videoConfig = {
        ...existing.videoConfig,
        ...payload.videoConfig,
      };
    }

    // Password update
    if (payload.accessPasswordHash) {
      updated.accessPassword = payload.accessPasswordHash;
    }

    // Save final version
    await ddbDocClient.send(
      new PutCommand({
        TableName: EVENTS_TABLE,
        Item: updated,
      })
    );

    res.status(200).json({
      success: true,
      message: "Event updated",
      eventId,
    });
  } catch (err) {
    console.error("Update Event Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}


  // =====================================================
  // 6. DELETE EVENT
  // =====================================================
  static async deleteEvent(req, res) {
    try {
      const { eventId } = req.params;

      const response = await ddbDocClient.send(
        new DeleteCommand({
          TableName: EVENTS_TABLE,
          Key: { eventId },
          ReturnValues: "ALL_OLD",
        })
      );

      if (!response.Attributes)
        return res.status(404).json({ success: false, message: "Event not found" });

      return res.status(200).json({ success: true, message: "Event deleted" });
    } catch (err) {
      console.error("Delete event error:", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
}
