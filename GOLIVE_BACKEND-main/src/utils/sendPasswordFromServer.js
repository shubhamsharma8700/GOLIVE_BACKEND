// sendPasswordFromServer.js
// Reusable helper for sending password emails via SES from the backend server.

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const REGION = process.env.AWS_REGION || "ap-south-1";
const SES_SENDER = process.env.SES_SOURCE_EMAIL || "abdulazeemsyed02@gmail.com"; // must be verified

const ses = new SESClient({ region: REGION });

const esc = (s) => (s ? String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])) : "");

export async function sendPasswordFromServer({
  eventId,
  clientViewerId,
  email,
  firstName,
  lastName,
  password,
  eventTitle,
}) {
  if (!email || !password) {
    throw new Error("email and password are required to send password email");
  }

  const subject = `Your event password for "${eventTitle || eventId}"`;
  const html = `
    <p>Hi ${esc(firstName || "")} ${esc(lastName || "")},</p>
    <p>Your access password for <strong>${esc(eventTitle || eventId)}</strong> is:</p>
    <h2>${esc(password)}</h2>
    <p>Use your email (${esc(email)}) and this password to login.</p>
  `;
  const text = `Your access password for "${eventTitle || eventId}" is: ${password}`;

  const params = {
    Destination: { ToAddresses: [email] },
    Message: {
      Subject: { Data: subject },
      Body: { Html: { Data: html }, Text: { Data: text } },
    },
    Source: SES_SENDER,
  };

  await ses.send(new SendEmailCommand(params));

  console.log("[sendPasswordFromServer] Sent password email to", email, "for event", eventId, "clientViewerId", clientViewerId);
}

