import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { getEvent, getStream } from "../services/api.js";
import { getViewerToken, clearViewerSession, getClientViewerId } from "../services/auth.js";
import AccessGate from "../components/AccessGate.jsx";
import VideoPlayer from "../components/VideoPlayer.jsx";

function normalizeAccessMode(raw) {
  if (!raw) return "public";
  const m = String(raw).toLowerCase();
  if (m === "publicaccess" || m === "freeaccess") return "public";
  if (m === "privateaccess" || m === "emailaccess") return "private";
  if (m === "passwordaccess") return "password";
  if (m === "paymentaccess" || m === "paidaccess") return "payment";
  return "public";
}

function EventViewer() {
  const { eventId } = useParams();
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [streamUrl, setStreamUrl] = useState(null);

  const loadEvent = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getEvent(eventId);
    if (res.ok) {
      setEvent(res.data?.event || res.data);
    } else {
      setError(res.data?.message || `Failed to load event (${res.status})`);
      setEvent(null);
    }
    setLoading(false);
  }, [eventId]);

  const tryFetchStream = useCallback(
    async (reason = "initial") => {
      const res = await getStream(eventId);
      if (res.ok && res.data?.streamUrl) {
        setStreamUrl(res.data.streamUrl);
        return true;
      }
      if (res.status === 401 || res.status === 403) {
        clearViewerSession();
      }
      setStreamUrl(null);
      return false;
    },
    [eventId]
  );

  useEffect(() => {
    loadEvent();
  }, [loadEvent]);

  useEffect(() => {
    if (!event) return;
    const token = getViewerToken();
    const mode = normalizeAccessMode(event.accessMode);
    if (mode === "public") {
      return;
    }
    if (token) {
      tryFetchStream("with-token");
    }
  }, [event, tryFetchStream]);

  const handleAccessGranted = async () => {
    await tryFetchStream("after-access");
  };

  const handleLogout = () => {
    clearViewerSession();
    setStreamUrl(null);
  };

  const accessMode = normalizeAccessMode(event?.accessMode);
  const clientViewerId = getClientViewerId();
  const persistedToken = typeof window !== "undefined" ? localStorage.getItem("viewerToken") : null;

  return (
    <div className="app-shell">
      {loading && <div className="card">Loading event…</div>}
      {error && !loading && <div className="card">Error: {error}</div>}

      {event && (
        <div className="card">
          <h1>{event.title || "Live Event"}</h1>
          <p>
            Access mode: <strong>{accessMode} </strong>
            · eventId: <code>{eventId}</code>
          </p>
        </div>
      )}

      {event && !streamUrl && (
        <AccessGate
          key={accessMode}
          event={event}
          eventId={eventId}
          accessMode={accessMode}
          onAccessGranted={handleAccessGranted}
        />
      )}

      {streamUrl && (
        <div className="card">
          <h2>Playback</h2>
          <VideoPlayer src={streamUrl} />
          <div style={{ marginTop: 8 }}>
            <button className="secondary" onClick={handleLogout}>
              Logout viewer
            </button>
          </div>
        </div>
      )}

      {import.meta.env.DEV && (
        <div className="card">
          <h2>Dev Panel</h2>
          <small>Viewer token stored in localStorage.</small>
          <pre className="debug">
            {JSON.stringify({ persistedToken, event, streamUrl }, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export default EventViewer;
