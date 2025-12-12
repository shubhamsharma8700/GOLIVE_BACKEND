import { getOrCreateClientViewerId } from "../utils/uuid.js";

const KEY_TOKEN = "viewerToken";
const KEY_VIEWER_ID = "viewerId";
const KEY_CLIENT_ID = "clientViewerId";

function get(key) {
  try {
    const v = localStorage.getItem(key);
    return v || null;
  } catch {
    return null;
  }
}

function set(key, value) {
  try {
    if (value == null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // ignore
  }
}

export function getViewerToken() {
  return get(KEY_TOKEN);
}

export function getViewerId() {
  return get(KEY_VIEWER_ID);
}

export function setViewerSession({ token, viewerId }) {
  if (token) set(KEY_TOKEN, token);
  if (viewerId) set(KEY_VIEWER_ID, String(viewerId));
}

export function clearViewerSession() {
  set(KEY_TOKEN, null);
  set(KEY_VIEWER_ID, null);
}

export function getClientViewerId() {
  const existing = get(KEY_CLIENT_ID);
  if (existing) return existing;
  const created = getOrCreateClientViewerId();
  set(KEY_CLIENT_ID, created);
  return created;
}

export function isLoggedIn() {
  return !!getViewerToken();
}
