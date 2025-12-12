import { getViewerToken } from "./auth.js";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

async function doRequest(path, options = {}) {
  const url = `${API_BASE_URL}${path}`;
  const headers = new Headers(options.headers || {});

  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }

  const token = getViewerToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(url, { ...options, headers });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // ignore non-JSON
  }
  return { ok: res.ok, status: res.status, data };
}

export function getEvent(eventId) {
  return doRequest(`/api/event/event/${encodeURIComponent(eventId)}`);
}

export function requestAccess(eventId, body) {
  return doRequest(`/api/access/event/${encodeURIComponent(eventId)}/requestAccess`, {
    method: "POST",
    body: JSON.stringify(body || {}),
  });
}

export function getStream(eventId) {
  return doRequest(`/api/playback/event/${encodeURIComponent(eventId)}/stream`);
}

export function resendPassword(eventId, body) {
  return doRequest(`/api/access/event/${encodeURIComponent(eventId)}/resend-password`, {
    method: "POST",
    body: JSON.stringify(body || {}),
  });
}
