import { dynamoDB, eventBridge, medialive } from "../config/awsClients.js";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";

const EVENTS_TABLE = process.env.EVENTS_TABLE_NAME || "go-live-poc-events";
const EVENT_STATUSES = new Set(["draft", "scheduled", "live", "ended", "archived"]);
const EVENT_TYPES = new Set(["live", "vod"]);
// Canonical accessMode values kept in sync with AccessController
const ACCESS_MODES = new Set(["freeAccess", "emailAccess", "passwordAccess", "paidAccess"]);
const STRIPE_SETUP_STATUSES = new Set(["pending", "created", "failed"]);
const TRUTHY_VALUES = new Set(["true", "1", "yes", "y", "on"]);
const FALSY_VALUES = new Set(["false", "0", "no", "n", "off"]);
const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 10);

const normalizeEnum = (value, allowed, fallback = null) => {
  if (!value && fallback) return fallback;
  if (!value) return null;
  const normalized = value.toString().trim().toLowerCase();
  const match = Array.from(allowed).find((option) => option.toLowerCase() === normalized);
  return match || null;
};

const normalizeAccessMode = (value, fallback = "openAccess") => {
  const candidate = (value || fallback || "freeAccess").toString().trim();
  if (ACCESS_MODES.has(candidate)) return candidate;
  return null;
};

const isPasswordMode = (mode) => mode === "passwordAccess";
const isPaymentMode = (mode) => mode === "paymentAccess";

const toIsoString = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date value");
  }
  return date.toISOString();
};

const parseBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (TRUTHY_VALUES.has(normalized)) return true;
    if (FALSY_VALUES.has(normalized)) return false;
  }
  return fallback;
};

const parseNumber = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error("Invalid numeric value");
  }
  return parsed;
};

const parseFormFields = (value) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new Error("formFields must be valid JSON");
    }
  }
  if (typeof value === "object") return value;
  throw new Error("formFields must be an object or JSON string");
};

const resolveCurrency = (value) => {
  if (!value) return null;
  const normalized = value.toString().trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error("currency must be a valid ISO 4217 code");
  }
  return normalized;
};

const hashAccessPassword = async (accessMode, passwordInput, existingHash = null, requirePassword = false) => {
  if (!isPasswordMode(accessMode)) return null;
  if (passwordInput) {
    return bcrypt.hash(passwordInput, SALT_ROUNDS);
  }
  if (existingHash) return existingHash;
  if (requirePassword) {
    throw new Error("Password required when accessMode is passwordAccess");
  }
  return null;
};

export default class EventController {

  // CREATE EVENT
  static async createEvent(req, res) {
    try {
      const payload = req.body || {};
      const title = (payload.title || "").trim();
      const description = (payload.description || "").trim();
      const status = payload.status || "scheduled";
      const eventType = payload.eventType;
      const startTime = payload.startTime;
      const endTime = payload.endTime || null;
      const accessMode = payload.accessMode;
      const createdBy = payload.createdBy;

      // Validate required fields
      if (!title) return res.status(400).json({ message: "title is required" });
      if (!description) return res.status(400).json({ message: "description is required" });
      if (!eventType) return res.status(400).json({ message: "eventType is required (live or vod)" });
      if (!startTime) return res.status(400).json({ message: "startTime is required" });
      if (!accessMode) return res.status(400).json({ message: "accessMode is required" });
      if (!createdBy) return res.status(400).json({ message: "createdBy is required" });

      // Validate enum values
      if (!EVENT_TYPES.has(eventType)) return res.status(400).json({ message: "eventType must be live or vod" });
      if (!EVENT_STATUSES.has(status)) return res.status(400).json({ message: "status must be scheduled, live, vod, or ended" });
      if (!ACCESS_MODES.has(accessMode)) return res.status(400).json({ message: "accessMode must be freeAccess, emailAccess, passwordAccess, or paidAccess" });

      // Parse and validate dates
      let startTimeISO, endTimeISO = null;
      try {
        startTimeISO = toIsoString(startTime);
        if (endTime) endTimeISO = toIsoString(endTime);
      } catch (err) {
        return res.status(400).json({ message: "Invalid startTime or endTime format" });
      }

      // Handle per-accessMode optional fields
      let accessPassword = null;
      if (accessMode === "passwordAccess") {
        if (!payload.accessPassword) return res.status(400).json({ message: "accessPassword is required for passwordAccess" });
        try {
          accessPassword = await bcrypt.hash(payload.accessPassword, SALT_ROUNDS);
        } catch (err) {
          return res.status(400).json({ message: "Failed to hash password" });
        }
      }

      let formFields = null;
      if (accessMode === "emailAccess") {
        if (payload.formFields) {
          try {
            formFields = parseFormFields(payload.formFields);
          } catch (err) {
            return res.status(400).json({ message: err.message });
          }
        } else {
          // Default email registration fields
          formFields = {
            firstName: { type: "string", required: true },
            lastName: { type: "string", required: true },
            email: { type: "string", required: true },
          };
        }
      }

      let paymentAmount = null, currency = null;
      if (accessMode === "paidAccess") {
        if (!payload.paymentAmount) return res.status(400).json({ message: "paymentAmount is required for paidAccess" });
        if (!payload.currency) return res.status(400).json({ message: "currency is required for paidAccess" });
        try {
          paymentAmount = parseNumber(payload.paymentAmount);
          currency = resolveCurrency(payload.currency);
        } catch (err) {
          return res.status(400).json({ message: err.message });
        }
      }

      const now = new Date().toISOString();
      const eventId = uuidv4();
      const item = {
        eventId,
        title,
        description,
        status,
        eventType,
        startTime: startTimeISO,
        endTime: endTimeISO,
        accessMode,
        accessPassword,
        formFields,
        paymentAmount,
        currency,
        createdBy,
        createdAt: now,
        updatedAt: now,
      };

      await dynamoDB.put({ TableName: EVENTS_TABLE, Item: item }).promise();
      return res.status(201).json({ success: true, message: "Event created", eventId });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: "Internal server error" });
    }
  }

  // LIST EVENTS
  static async listEvents(req, res) {
    try {
      const params = {
        TableName: EVENTS_TABLE,
      };

      const data = await dynamoDB.scan(params).promise();
      const events = data.Items || [];

      return res.status(200).json({
        success: true,
        count: events.length,
        events,
      });

    } catch (err) {
      console.error(err);
      return res.status(500).json({
        success: false,
        message: "Unable to fetch events",
      });
    }
  }

  // UPDATE EVENT
  static async updateEvent(req, res) {
    try {
      const { eventId } = req.params;
      if (!eventId) return res.status(400).json({ message: "Missing eventId" });

      const existingResult = await dynamoDB.get({ TableName: EVENTS_TABLE, Key: { eventId } }).promise();
      if (!existingResult.Item) return res.status(404).json({ message: "Event not found" });

      const existing = existingResult.Item;
      const payload = req.body || {};

      // Update only provided fields
      const title = payload.title !== undefined ? (payload.title || "").trim() : existing.title;
      const description = payload.description !== undefined ? (payload.description || "").trim() : existing.description;
      const status = payload.status !== undefined ? payload.status : existing.status;
      const eventType = payload.eventType !== undefined ? payload.eventType : existing.eventType;
      const startTime = payload.startTime !== undefined ? payload.startTime : existing.startTime;
      const endTime = payload.endTime !== undefined ? payload.endTime : existing.endTime;
      const accessMode = payload.accessMode !== undefined ? payload.accessMode : existing.accessMode;
      const createdBy = payload.createdBy !== undefined ? payload.createdBy : existing.createdBy;

      // Validate required fields
      if (!title) return res.status(400).json({ message: "title cannot be empty" });
      if (!description) return res.status(400).json({ message: "description cannot be empty" });
      if (!EVENT_TYPES.has(eventType)) return res.status(400).json({ message: "eventType must be live or vod" });
      if (!EVENT_STATUSES.has(status)) return res.status(400).json({ message: "status must be scheduled, live, vod, or ended" });
      if (!ACCESS_MODES.has(accessMode)) return res.status(400).json({ message: "accessMode must be freeAccess, emailAccess, passwordAccess, or paidAccess" });

      // Parse dates
      let startTimeISO = startTime;
      let endTimeISO = endTime || null;
      try {
        if (payload.startTime) startTimeISO = toIsoString(payload.startTime);
        if (payload.endTime) endTimeISO = toIsoString(payload.endTime);
      } catch (err) {
        return res.status(400).json({ message: "Invalid startTime or endTime format" });
      }

      // Handle per-accessMode optional fields
      let accessPassword = existing.accessPassword || null;
      if (accessMode === "passwordAccess") {
        if (payload.accessPassword) {
          try {
            accessPassword = await bcrypt.hash(payload.accessPassword, SALT_ROUNDS);
          } catch (err) {
            return res.status(400).json({ message: "Failed to hash password" });
          }
        } else if (!accessPassword) {
          return res.status(400).json({ message: "accessPassword is required for passwordAccess" });
        }
      } else {
        accessPassword = null;
      }

      let formFields = existing.formFields || null;
      if (accessMode === "emailAccess") {
        if (payload.formFields) {
          try {
            formFields = parseFormFields(payload.formFields);
          } catch (err) {
            return res.status(400).json({ message: err.message });
          }
        } else if (!formFields) {
          formFields = {
            firstName: { type: "string", required: true },
            lastName: { type: "string", required: true },
            email: { type: "string", required: true },
          };
        }
      } else {
        formFields = null;
      }

      let paymentAmount = existing.paymentAmount || null;
      let currency = existing.currency || null;
      if (accessMode === "paidAccess") {
        if (payload.paymentAmount !== undefined) {
          try {
            paymentAmount = parseNumber(payload.paymentAmount);
          } catch (err) {
            return res.status(400).json({ message: err.message });
          }
        }
        if (payload.currency !== undefined) {
          try {
            currency = resolveCurrency(payload.currency);
          } catch (err) {
            return res.status(400).json({ message: err.message });
          }
        }
        if (!paymentAmount) return res.status(400).json({ message: "paymentAmount is required for paidAccess" });
        if (!currency) return res.status(400).json({ message: "currency is required for paidAccess" });
      } else {
        paymentAmount = null;
        currency = null;
      }

      const now = new Date().toISOString();
      const updatedItem = {
        eventId,
        title,
        description,
        status,
        eventType,
        startTime: startTimeISO,
        endTime: endTimeISO,
        createdBy,
        accessMode,
        accessPassword,
        formFields,
        paymentAmount: paymentAmount ?? null,
        currency: currency ?? null,
        createdAt: existing.createdAt,
        updatedAt: now,
      };

      await dynamoDB.put({ TableName: EVENTS_TABLE, Item: updatedItem }).promise();

      return res.status(200).json({
        success: true,
        message: "Event updated",
        eventId,
      });

    } catch (err) {
      console.error(err);
      return res.status(500).json({
        success: false,
        message: "Unable to update event",
      });
    }
  }

  // DELETE EVENT
  static async deleteEvent(req, res) {
    try {
      const { eventId } = req.params;

      if (!eventId) {
        return res.status(400).json({ message: "Missing eventId" });
      }

      const params = {
        TableName: EVENTS_TABLE,
        Key: { eventId },
        ReturnValues: "ALL_OLD",
      };

      const result = await dynamoDB.delete(params).promise();

      if (!result.Attributes) {
        return res.status(404).json({ message: "Event not found" });
      }

      return res.status(200).json({
        success: true,
        message: "Event deleted successfully",
      });

    } catch (err) {
      console.error(err);
      return res.status(500).json({
        success: false,
        message: "Unable to delete event",
      });
    }
  }

  // GET EVENT BY ID
  static async getEventById(req, res) {
    try {
      const { eventId } = req.params;

      if (!eventId) {
        return res.status(400).json({ message: "Missing eventId" });
      }

      const params = {
        TableName: EVENTS_TABLE,
        Key: { eventId },
      };

      const result = await dynamoDB.get(params).promise();

      if (!result.Item) {
        return res.status(404).json({
          success: false,
          message: "Event not found",
        });
      }

      return res.status(200).json({
        success: true,
        event: result.Item,
      });

    } catch (err) {
      console.error(err);
      return res.status(500).json({
        success: false,
        message: "Unable to fetch event details",
      });
    }
  }

   // START MEDIALIVE CHANNEL
  static async startChannel(req, res) {
    try {
      const { channelId } = req.body;

      if (!channelId) {
        return res.status(400).json({ message: "channelId is required" });
      }

      // Optional: check channel details
      const details = await medialive.describeChannel({ ChannelId: channelId }).promise();
      if (details.State === "RUNNING") {
        return res.json({ message: "Channel already running" });
      }

      const response = await medialive.startChannel({
        ChannelId: channelId
      }).promise();

      return res.status(200).json({
        success: true,
        message: "Channel start initiated",
        response
      });

    } catch (error) {
      console.error("Start Channel Error:", error);
      return res.status(500).json({ message: error.message });
    }
  }

  // STOP MEDIALIVE CHANNEL
  static async stopChannel(req, res) {
    try {
      const { channelId } = req.body;

      if (!channelId) {
        return res.status(400).json({ message: "channelId is required" });
      }

      const details = await medialive.describeChannel({ ChannelId: channelId }).promise();
      if (details.State === "IDLE") {
        return res.json({ message: "Channel already stopped" });
      }

      const response = await medialive.stopChannel({
        ChannelId: channelId
      }).promise();

      return res.status(200).json({
        success: true,
        message: "Channel stop initiated",
        response
      });

    } catch (error) {
      console.error("Stop Channel Error:", error);
      return res.status(500).json({ message: error.message });
    }
  }
}
