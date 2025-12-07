import {
  ddbDocClient,
  PutCommand,
  ScanCommand,
  GetCommand,
  DeleteCommand,
  UpdateCommand,
} from "../config/awsClients.js";

import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";

const EVENTS_TABLE = process.env.EVENTS_TABLE_NAME || "go-live-poc-events";

const EVENT_STATUSES = new Set(["draft", "scheduled", "live", "ended", "archived"]);
const EVENT_TYPES = new Set(["live", "vod"]);
const ACCESS_MODES = new Set(["freeAccess", "emailAccess", "passwordAccess", "paidAccess"]);

const TRUTHY_VALUES = new Set(["true", "1", "yes", "y", "on"]);
const FALSY_VALUES = new Set(["false", "0", "no", "n", "off"]);
const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 10);


// ------------------ Helper Functions ------------------

const toIsoString = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (isNaN(date.getTime())) throw new Error("Invalid date value");
  return date.toISOString();
};

const parseNumber = (value) => {
  if (!value) return null;
  const parsed = Number(value);
  if (isNaN(parsed)) throw new Error("Invalid numeric value");
  return parsed;
};

const parseFormFields = (value) => {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error("formFields must be valid JSON");
    }
  }
  if (typeof value === "object") return value;
  throw new Error("formFields must be JSON or object");
};

const resolveCurrency = (value) => {
  const normalized = value?.trim()?.toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) throw new Error("currency must be ISO 4217");
  return normalized;
};


// ------------------ EVENT CONTROLLER ------------------

export default class EventController {

  // CREATE EVENT
  static async createEvent(req, res) {
    try {
      const payload = req.body || {};
      const title = (payload.title || "").trim();
      const description = (payload.description || "").trim();
      const { eventType, startTime, endTime = null, accessMode, createdBy } = payload;

      // VALIDATIONS
      if (!title) return res.status(400).json({ message: "title is required" });
      if (!description) return res.status(400).json({ message: "description is required" });
      if (!eventType) return res.status(400).json({ message: "eventType is required" });
      if (!startTime) return res.status(400).json({ message: "startTime is required" });
      if (!accessMode) return res.status(400).json({ message: "accessMode is required" });
      if (!createdBy) return res.status(400).json({ message: "createdBy is required" });

      if (!EVENT_TYPES.has(eventType))
        return res.status(400).json({ message: "eventType must be live or vod" });

      if (!ACCESS_MODES.has(accessMode))
        return res.status(400).json({ message: "Invalid accessMode" });

      // VALIDATE DATES
      let startTimeISO = toIsoString(startTime);
      let endTimeISO = endTime ? toIsoString(endTime) : null;

      // PASSWORD MODE
      let accessPassword = null;
      if (accessMode === "passwordAccess") {
        if (!payload.accessPassword)
          return res.status(400).json({ message: "accessPassword required" });

        accessPassword = await bcrypt.hash(payload.accessPassword, SALT_ROUNDS);
      }

      // EMAIL MODE
      let formFields = null;
      if (accessMode === "emailAccess") {
        formFields = payload.formFields
          ? parseFormFields(payload.formFields)
          : {
              firstName: { type: "string", required: true },
              lastName: { type: "string", required: true },
              email: { type: "string", required: true },
            };
      }

      // PAID MODE
      let paymentAmount = null;
      let currency = null;

      if (accessMode === "paidAccess") {
        if (!payload.paymentAmount)
          return res.status(400).json({ message: "paymentAmount required" });

        if (!payload.currency)
          return res.status(400).json({ message: "currency required" });

        paymentAmount = parseNumber(payload.paymentAmount);
        currency = resolveCurrency(payload.currency);
      }

      const now = new Date().toISOString();
      const eventId = uuidv4();

      const item = {
        eventId,
        title,
        description,
        status: payload.status || "scheduled",
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

      await ddbDocClient.send(
        new PutCommand({
          TableName: EVENTS_TABLE,
          Item: item,
        })
      );

      res.status(201).json({ success: true, message: "Event created", eventId });

    } catch (err) {
      console.error("Create event error:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  }


  // LIST EVENTS
  static async listEvents(req, res) {
    try {
      const result = await ddbDocClient.send(
        new ScanCommand({ TableName: EVENTS_TABLE })
      );

      res.status(200).json({
        success: true,
        count: result.Items?.length || 0,
        events: result.Items || [],
      });

    } catch (err) {
      console.error("List event error:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  }


  // GET EVENT
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

      res.status(200).json({ success: true, event: result.Item });

    } catch (err) {
      console.error("Get event error:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  }


 // UPDATE EVENT
static async updateEvent(req, res) {
  try {
    const { eventId } = req.params;
    const payload = req.body || {};

    // Fetch existing event
    const result = await ddbDocClient.send(
      new GetCommand({
        TableName: EVENTS_TABLE,
        Key: { eventId },
      })
    );

    if (!result.Item) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    const existing = result.Item;

    // ------------------------
    // VALIDATIONS
    // ------------------------
    if (payload.title !== undefined && payload.title.trim() === "") {
      return res.status(400).json({ message: "title cannot be empty" });
    }

    if (payload.description !== undefined && payload.description.trim() === "") {
      return res.status(400).json({ message: "description cannot be empty" });
    }

    if (payload.eventType && !EVENT_TYPES.has(payload.eventType)) {
      return res.status(400).json({ message: "Invalid eventType" });
    }

    if (payload.status && !EVENT_STATUSES.has(payload.status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    if (payload.accessMode && !ACCESS_MODES.has(payload.accessMode)) {
      return res.status(400).json({ message: "Invalid accessMode" });
    }

    // ------------------------
    // DATE HANDLING
    // ------------------------
    let startTime = existing.startTime;
    let endTime = existing.endTime;

    if (payload.startTime) startTime = toIsoString(payload.startTime);
    if (payload.endTime) endTime = toIsoString(payload.endTime);

    // ------------------------
    // ACCESS MODE PROCESSING
    // ------------------------
    let accessPassword = existing.accessPassword || null;
    let formFields = existing.formFields || null;
    let paymentAmount = existing.paymentAmount || null;
    let currency = existing.currency || null;

    const mode = payload.accessMode || existing.accessMode;

    // PASSWORD MODE
    if (mode === "passwordAccess") {
      if (payload.accessPassword) {
        accessPassword = await bcrypt.hash(payload.accessPassword, SALT_ROUNDS);
      } else if (!existing.accessPassword) {
        return res.status(400).json({ message: "accessPassword required for passwordAccess" });
      }
      formFields = null;
      paymentAmount = null;
      currency = null;
    }

    // EMAIL MODE
    else if (mode === "emailAccess") {
      formFields = payload.formFields
        ? parseFormFields(payload.formFields)
        : existing.formFields || {
            firstName: { type: "string", required: true },
            lastName: { type: "string", required: true },
            email: { type: "string", required: true },
          };
      accessPassword = null;
      paymentAmount = null;
      currency = null;
    }

    // PAID MODE
    else if (mode === "paidAccess") {
      if (payload.paymentAmount === undefined && !existing.paymentAmount)
        return res.status(400).json({ message: "paymentAmount required" });

      if (payload.currency === undefined && !existing.currency)
        return res.status(400).json({ message: "currency required" });

      paymentAmount = payload.paymentAmount
        ? parseNumber(payload.paymentAmount)
        : existing.paymentAmount;

      currency = payload.currency
        ? resolveCurrency(payload.currency)
        : existing.currency;

      accessPassword = null;
      formFields = null;
    }

    // FREE MODE
    else if (mode === "freeAccess") {
      accessPassword = null;
      formFields = null;
      paymentAmount = null;
      currency = null;
    }

    // ------------------------
    // FINAL UPDATED ITEM
    // ------------------------
    const now = new Date().toISOString();

    const updatedItem = {
      ...existing,
      ...payload,
      startTime,
      endTime,
      accessMode: mode,
      accessPassword,
      formFields,
      paymentAmount,
      currency,
      updatedAt: now,
    };

    // Save updated event
    await ddbDocClient.send(
      new PutCommand({
        TableName: EVENTS_TABLE,
        Item: updatedItem,
      })
    );

    return res.status(200).json({
      success: true,
      message: "Event updated",
      eventId,
    });

  } catch (err) {
    console.error("Update event error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}



  // DELETE EVENT
  static async deleteEvent(req, res) {
    try {
      const { eventId } = req.params;

      const result = await ddbDocClient.send(
        new DeleteCommand({
          TableName: EVENTS_TABLE,
          Key: { eventId },
          ReturnValues: "ALL_OLD",
        })
      );

      if (!result.Attributes)
        return res.status(404).json({ message: "Event not found" });

      res.status(200).json({ success: true, message: "Event deleted" });

    } catch (err) {
      console.error("Delete event error:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
}
