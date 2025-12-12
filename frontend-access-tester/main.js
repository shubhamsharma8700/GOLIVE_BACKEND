const LS_PREFIX = "accessTester.";

function lsGet(key, fallback = null) {
  try {
    const v = localStorage.getItem(LS_PREFIX + key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function lsSet(key, value) {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function $(id) {
  return document.getElementById(id);
}

function buildCommonPayload() {
  const clientViewerId = $("clientViewerId").value.trim() || `cv-${Math.random().toString(36).slice(2, 8)}`;
  $("clientViewerId").value = clientViewerId;
  const deviceType = $("deviceType").value;
  const email = $("email").value.trim();
  const password = $("password").value.trim();
  const paymentStatus = $("paymentStatus").value;
  const firstName = $("firstName").value.trim();
  const lastName = $("lastName").value.trim();
  const mode = $("passwordMode").value;

  return {
    clientViewerId,
    deviceType,
    email,
    password,
    paymentStatus,
    firstName,
    lastName,
    mode,
  };
}

async function callAccess(variant) {
  const baseUrl = $("baseUrl").value.trim() || "http://localhost:5000";
  const eventId = $("eventId").value.trim();
  if (!eventId) {
    alert("Please enter eventId");
    return;
  }

  const common = buildCommonPayload();
  let body = { clientViewerId: common.clientViewerId, deviceType: common.deviceType, metadata: { source: "access-tester", variant } };

  if (variant === "emailAccess") {
    body.email = common.email;
    body.formData = {
      firstName: common.firstName || "Test",
      lastName: common.lastName || "Viewer",
      email: common.email,
    };
  }

  if (variant === "passwordRegister") {
    body.mode = "register";
    body.formData = {
      firstName: common.firstName || "Test",
      lastName: common.lastName || "Viewer",
      email: common.email,
    };
  }

  if (variant === "passwordLogin") {
    body.mode = "login";
    body.email = common.email;
    body.password = common.password;
  }

  if (variant === "paidPre") {
    body.email = common.email;
  }

  if (variant === "paidPaid") {
    body.email = common.email;
    body.paymentStatus = common.paymentStatus === "none" ? "success" : common.paymentStatus;
  }

  $("accessOutput").textContent = "Loading...";
  setPills();

  try {
    const res = await fetch(`${baseUrl}/api/access/event/${encodeURIComponent(eventId)}/requestAccess`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));

    $("accessOutput").textContent = JSON.stringify({ status: res.status, data }, null, 2);

    if (res.ok) {
      if (data.token) lsSet("viewerToken", data.token);
      if (data.viewerId) lsSet("viewerId", data.viewerId);
      lsSet("eventId", eventId);
      lsSet("clientViewerId", common.clientViewerId);
      setPills(data);
    } else {
      setPills(data);
    }
  } catch (err) {
    $("accessOutput").textContent = String(err);
    setPills();
  }

  renderState();
}

function setPills(data = {}) {
  const statusEl = $("pillStatus");
  const accessEl = $("pillAccess");
  const payEl = $("pillPayment");

  const { status, accessGranted, needsPayment } = data;

  statusEl.textContent = `status: ${status ?? "-"}`;
  accessEl.textContent = `access: ${accessGranted === true ? "granted" : accessGranted === false ? "denied" : "-"}`;
  payEl.textContent = `payment: ${needsPayment === true ? "needed" : needsPayment === false ? "ok" : "-"}`;

  statusEl.className = "pill" + (status === "success" ? " ok" : status === "failure" ? " bad" : "");
  accessEl.className = "pill" + (accessGranted === true ? " ok" : accessGranted === false ? " bad" : "");
  payEl.className = "pill" + (needsPayment === true ? " warn" : needsPayment === false ? " ok" : "");
}

async function callPlayback() {
  const baseUrl = $("baseUrl").value.trim() || "http://localhost:5000";
  const eventId = $("eventId").value.trim() || lsGet("eventId");
  const token = lsGet("viewerToken");

  if (!eventId) {
    alert("No eventId (enter above or get from a successful access call)");
    return;
  }
  if (!token) {
    alert("No viewer token stored. Run an access flow that grants access first.");
    return;
  }

  $("playbackOutput").textContent = "Loading...";

  try {
    const res = await fetch(`${baseUrl}/api/playback/event/${encodeURIComponent(eventId)}/stream`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    $("playbackOutput").textContent = `HTTP ${res.status}\n\n${text}`;
  } catch (err) {
    $("playbackOutput").textContent = String(err);
  }
}

async function callAnalytics() {
  const baseUrl = $("baseUrl").value.trim() || "http://localhost:5000";
  const eventId = $("eventId").value.trim() || lsGet("eventId");
  const token = lsGet("viewerToken");

  if (!eventId) {
    alert("No eventId available.");
    return;
  }
  if (!token) {
    alert("No viewer token stored.");
    return;
  }

  const now = new Date();
  const start = now.toISOString();
  const end = new Date(now.getTime() + 5 * 60 * 1000).toISOString();

  const body = {
    sessionId: `sess-${Math.random().toString(36).slice(2, 10)}`,
    eventId,
    startTime: start,
    endTime: end,
    durationSec: 300,
    deviceInfo: { deviceType: "desktop", os: "Windows", browser: "Chrome" },
    meta: { source: "access-tester" },
  };

  $("analyticsOutput").textContent = "Loading...";

  try {
    const res = await fetch(`${baseUrl}/api/analytics/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    $("analyticsOutput").textContent = `HTTP ${res.status}\n\n${text}`;
  } catch (err) {
    $("analyticsOutput").textContent = String(err);
  }
}

function renderState() {
  const state = {
    eventId: lsGet("eventId"),
    viewerId: lsGet("viewerId"),
    clientViewerId: lsGet("clientViewerId"),
    hasToken: !!lsGet("viewerToken"),
  };
  $("stateOutput").textContent = JSON.stringify(state, null, 2);
}

function wire() {
  $("btnFree").onclick = () => callAccess("freeAccess");
  $("btnEmail").onclick = () => callAccess("emailAccess");
  $("btnPwdRegister").onclick = () => callAccess("passwordRegister");
  $("btnPwdLogin").onclick = () => callAccess("passwordLogin");
  $("btnPaidPre").onclick = () => callAccess("paidPre");
  $("btnPaidPaid").onclick = () => callAccess("paidPaid");

  $("btnPlayback").onclick = () => callPlayback();
  $("btnAnalytics").onclick = () => callAnalytics();

  renderState();
}

wire();
