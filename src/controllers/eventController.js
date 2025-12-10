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
  // 2. CREATE EVENT
  // =====================================================
  static async createEvent(req, res) {
    try {
      const payload = req.body || {};
      const title = payload.title?.trim();
      const description = payload.description?.trim();
      const { eventType, accessMode } = payload;

      // createdBy from JWT middleware
      const createdBy =
        req.user?.id ||
        req.user?.adminId ||
        req.user?.email ||
        "unknown-admin";

      // ------------------ VALIDATION ------------------

      if (!title) return res.status(400).json({ message: "title is required" });
      if (!description) return res.status(400).json({ message: "description is required" });
      if (!eventType) return res.status(400).json({ message: "eventType is required" });
      if (!EVENT_TYPES.has(eventType))
        return res.status(400).json({ message: "eventType must be live or vod" });

      if (!ACCESS_MODES.has(accessMode))
        return res.status(400).json({ message: "Invalid accessMode" });

      // ------------------ LIVE ------------------
      let startTime = null;
      let endTime = null;

      if (eventType === "live") {
        if (!payload.startTime)
          return res.status(400).json({ message: "startTime required for live event" });

        startTime = toIsoString(payload.startTime);
        endTime = payload.endTime ? toIsoString(payload.endTime) : null;
      }

      // ------------------ VOD ------------------
      let s3Key = null;
      let s3Prefix = null;

      if (eventType === "vod") {
        if (!payload.s3Key)
          return res.status(400).json({ message: "s3Key is required for VOD" });

        s3Key = payload.s3Key;
        s3Prefix = s3Key.substring(0, s3Key.lastIndexOf("/") + 1);

        // Ensure file exists
        try {
          await s3Client.send(
            new HeadObjectCommand({ Bucket: VOD_BUCKET, Key: s3Key })
          );
        } catch {
          return res.status(400).json({ message: "Invalid s3Key. File not found." });
        }
      }

      // ------------------ ACCESS MODE LOGIC ------------------

      let accessPassword = null;
      let formFields = null;
      let paymentAmount = null;
      let currency = null;

      // EMAIL ACCESS → default fields + custom merge
      if (accessMode === "emailAccess") {
        const defaultFields = {
          firstName: { type: "string", required: true },
          lastName: { type: "string", required: true },
          email: { type: "string", required: true },
        };

        const custom = payload.formFields ? parseFormFields(payload.formFields) : {};
        formFields = { ...defaultFields, ...custom };
      }

      // PASSWORD ACCESS → password required + optional custom form
      if (accessMode === "passwordAccess") {
        if (!payload.accessPassword)
          return res.status(400).json({ message: "accessPassword required" });

        accessPassword = await bcrypt.hash(payload.accessPassword, SALT_ROUNDS);

        formFields = payload.formFields ? parseFormFields(payload.formFields) : null;
      }

      // PAID ACCESS → amount + currency
      if (accessMode === "paidAccess") {
        if (!payload.paymentAmount)
          return res.status(400).json({ message: "paymentAmount required" });

        if (!payload.currency)
          return res.status(400).json({ message: "currency required" });

        paymentAmount = parseNumber(payload.paymentAmount);
        currency = resolveCurrency(payload.currency);
      }

      // FREE ACCESS → no form, no password
      if (accessMode === "freeAccess") {
        accessPassword = null;
        formFields = null;
        paymentAmount = null;
        currency = null;
      }

      // ------------------ SAVE EVENT ------------------

      const eventId = uuidv4();
      const timestamp = nowISO();

      const item = {
        eventId,
        title,
        description,
        eventType,
        createdBy,
        createdAt: timestamp,
        updatedAt: timestamp,

        // Access
        accessMode,
        accessPassword,
        formFields,
        paymentAmount,
        currency,

        // Live
        startTime,
        endTime,
        status: eventType === "live" ? "scheduled" : "uploaded",

        // VOD
        s3Key,
        s3Prefix,
        vodStatus: eventType === "vod" ? "UPLOADED" : null,
      };

      await ddbDocClient.send(
        new PutCommand({
          TableName: EVENTS_TABLE,
          Item: item,
        })
      );

      return res.status(201).json({
        success: true,
        message: "Event created successfully",
        eventId,
      });

    } catch (err) {
      console.error("Create event error:", err);
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
  // 5. UPDATE EVENT
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

      // Prevent switching between live/vod
      if (payload.eventType && payload.eventType !== existing.eventType)
        return res.status(400).json({ message: "Changing eventType is not allowed" });

      // ------------------ LIVE ------------------
      let startTime = existing.startTime;
      let endTime = existing.endTime;

      if (payload.startTime) startTime = toIsoString(payload.startTime);
      if (payload.endTime) endTime = toIsoString(payload.endTime);

      // ------------------ ACCESS MODE LOGIC ------------------

      let accessMode = payload.accessMode || existing.accessMode;
      let accessPassword = existing.accessPassword;
      let formFields = existing.formFields;
      let paymentAmount = existing.paymentAmount;
      let currency = existing.currency;

      // EMAIL ACCESS
      if (accessMode === "emailAccess") {
        const defaultFields = {
          firstName: { type: "string", required: true },
          lastName: { type: "string", required: true },
          email: { type: "string", required: true },
        };

        const custom = payload.formFields ? parseFormFields(payload.formFields) : {};
        formFields = { ...defaultFields, ...custom };

        accessPassword = null;
        paymentAmount = null;
        currency = null;
      }

      // PASSWORD ACCESS
      if (accessMode === "passwordAccess") {
        if (payload.accessPassword)
          accessPassword = await bcrypt.hash(payload.accessPassword, SALT_ROUNDS);

        if (!accessPassword)
          return res.status(400).json({ message: "accessPassword required" });

        formFields = payload.formFields
          ? parseFormFields(payload.formFields)
          : formFields;

        paymentAmount = null;
        currency = null;
      }

      // PAID ACCESS
      if (accessMode === "paidAccess") {
        paymentAmount = payload.paymentAmount
          ? parseNumber(payload.paymentAmount)
          : paymentAmount;

        currency = payload.currency
          ? resolveCurrency(payload.currency)
          : currency;

        accessPassword = null;
        formFields = null;
      }

      // FREE ACCESS
      if (accessMode === "freeAccess") {
        accessPassword = null;
        formFields = null;
        paymentAmount = null;
        currency = null;
      }

      // ------------------ SAVE UPDATED EVENT ------------------

      const updated = {
        ...existing,
        ...payload,
        startTime,
        endTime,
        accessMode,
        accessPassword,
        formFields,
        paymentAmount,
        currency,
        updatedAt: nowISO(),
      };

      await ddbDocClient.send(
        new PutCommand({
          TableName: EVENTS_TABLE,
          Item: updated,
        })
      );

      return res.status(200).json({
        success: true,
        message: "Event updated successfully",
        eventId,
      });
    } catch (err) {
      console.error("Update event error:", err);
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
