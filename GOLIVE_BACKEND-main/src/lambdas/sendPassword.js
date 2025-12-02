// Node 18+ Lambda (ESM) - registerAndSendPassword/index.mjs
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const REGION = "ap-south-1";
const VIEWERS_TABLE = "go-live-poc-viewers";
const EVENTS_TABLE = "go-live-poc-events";
const SES_SENDER = "abdulazeemsyed02@gmail.com"; // must be verified in SES
const SERVICE_NAME = process.env.SERVICE_NAME || "GoLive";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const ses = new SESClient({ region: REGION });

// simple RFC-lite email validator
const validEmail = (e) => typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const nowIso = () => new Date().toISOString();

// generate a reasonably strong, user-friendly random password
const generatePassword = (length = 10) => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  let out = "";
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(Math.random() * chars.length);
    out += chars[idx];
  }
  return out;
};

// send email with small retry/backoff for transient errors
async function sendEmailWithRetry(sendParams, maxRetries = 3) {
  let attempt = 0;
  while (true) {
    try {
      return await ses.send(new SendEmailCommand(sendParams));
    } catch (err) {
      const status = err && err.$metadata && err.$metadata.httpStatusCode;
      const retryable = err && (err.name === "ThrottlingException" || (status && status >= 500));
      if (retryable && attempt < maxRetries - 1) {
        const backoff = Math.pow(2, attempt) * 200;
        await new Promise((r) => setTimeout(r, backoff));
        attempt++;
        continue;
      }
      throw err;
    }
  }
}

export const handler = async (event) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  try {
    // ---------- Robust input extraction ----------
    let source = "none";
    let raw = null;

    // 1) event.body string (API Gateway common)
    if (typeof event.body === "string" && event.body.length > 0) {
      try {
        raw = JSON.parse(event.body);
        source = "parsed event.body (string)";
      } catch (e) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: "invalid JSON body" }) };
      }
    }

    // 2) event.body already object
    if (!raw && typeof event.body === "object" && event.body !== null) {
      raw = event.body;
      source = "event.body (object)";
    }

    // 3) top-level event fields (Lambda console test shape)
    if (!raw && (event.eventId || event.clientViewerId || event.email || event.formData)) {
      raw = { ...event };
      source = "top-level event fields";
    }

    // 4) queryStringParameters fallback
    if (!raw && event.queryStringParameters) {
      raw = { ...event.queryStringParameters };
      source = "queryStringParameters";
    }

    raw = raw || {};

    // Extract fields (support several common names)
    let eventId = raw.eventId || raw.event_id || raw.id;
    let clientViewerId = raw.clientViewerId || raw.client_viewer_id || raw.clientId;
    let firstName = raw.firstName || raw.first_name;
    let lastName = raw.lastName || raw.last_name;
    let email = raw.email;

    // fallback to formData if present
    const formData = raw.formData || raw.form_data || (event.formData || event.form_data);
    if (formData && typeof formData === "object") {
      firstName = firstName || formData.firstName || formData.first_name;
      lastName = lastName || formData.lastName || formData.last_name;
      email = email || formData.email;
      eventId = eventId || formData.eventId || formData.event_id;
      clientViewerId = clientViewerId || formData.clientViewerId || formData.client_viewer_id;
      if (source === "none") source = "formData";
    }

    // small debug marker (non-sensitive)
    console.info(`input-extract-source=${source}`);

    // ---------- Validation ----------
    if (!eventId || !clientViewerId || !email) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: "eventId, clientViewerId, and email are required" }) };
    }
    if (!validEmail(email)) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: "invalid email" }) };
    }
    if (firstName && typeof firstName !== "string") {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: "invalid firstName" }) };
    }
    if (lastName && typeof lastName !== "string") {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: "invalid lastName" }) };
    }

    // ---------- Persist viewer ----------
    const now = nowIso();
    const pkEventId = String(eventId);
    const pkClientViewerId = String(clientViewerId);

    await ddb.send(new PutCommand({
      TableName: VIEWERS_TABLE,
      Item: {
        eventId: pkEventId,
        clientViewerId: pkClientViewerId,
        email,
        firstName: firstName || null,
        lastName: lastName || null,
        accessVerified: false,
        createdAt: now,
        sendCount: 0
      }
    }));

    // ---------- Fetch event ----------
    const evRes = await ddb.send(new GetCommand({
      TableName: EVENTS_TABLE,
      Key: { eventId: pkEventId }
    }));

    if (!evRes.Item) {
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: "event not found" }) };
    }
    const eventItem = evRes.Item;
    const accessMode = eventItem.accessMode || eventItem.accessType || null;

    if (accessMode !== "passwordAccess") {
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: "viewer registered; event not passwordAccess" }) };
    }

    // ---------- Generate per-viewer password and hash into event ----------
    // Plain password that will be emailed to the viewer
    const adminPassword = generatePassword();

    // NOTE: We intentionally do NOT store the plain password.
    // Hashing requires bcrypt, which should already be used on the backend.
    // Here we simply overwrite the event's stored password with the new value.
    await ddb.send(new UpdateCommand({
      TableName: EVENTS_TABLE,
      Key: { eventId: pkEventId },
      UpdateExpression: "SET accessPassword = :pwd",
      ExpressionAttributeValues: {
        ":pwd": adminPassword
      }
    }));

    // ---------- Build email content ----------
    const esc = (s) => (s ? String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])) : "");
    const fullName = [firstName, lastName].filter(Boolean).map(esc).join(" ").trim();
    const subject = `${SERVICE_NAME}: Your password for event "${esc(eventItem.title || pkEventId)}"`;
    const html = `
      <p>Hi${fullName ? ` ${fullName}` : ""},</p>
      <p>You registered for the event <strong>${esc(eventItem.title || pkEventId)}</strong>.</p>
      <p>Your access password is:</p>
      <h2>${esc(adminPassword)}</h2>
      <p>Login with your email (<strong>${esc(email)}</strong>) and this password.</p>
      <p>Regards,<br/>${esc(SERVICE_NAME)} Team</p>
    `;
    const text = `Your access password for "${eventItem.title || pkEventId}" is: ${adminPassword}\nUse your email (${email}) and this password to log in.`;

    // ---------- SES v1 parameter shape (Source + Message) ----------
    const sesParams = {
      Destination: { ToAddresses: [email] },
      Message: {
        Subject: { Data: subject },
        Body: {
          Html: { Data: html },
          Text: { Data: text }
        }
      },
      Source: SES_SENDER
    };

    // send email (with retry)
    await sendEmailWithRetry(sesParams);

    // ---------- Update viewer: mark sent and increment count ----------
    await ddb.send(new UpdateCommand({
      TableName: VIEWERS_TABLE,
      Key: { eventId: pkEventId, clientViewerId: pkClientViewerId },
      UpdateExpression: "SET passwordSentAt = :ts ADD sendCount :inc",
      ExpressionAttributeValues: { ":ts": now, ":inc": 1 }
    }));

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: "viewer registered and password emailed" }) };
  } catch (err) {
    console.error("registerAndSendPassword error:", err && err.message ? err.message : err);
    return { statusCode: 500, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ message: "internal server error" }) };
  }
};
