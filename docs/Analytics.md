# Analytics API Contract

This document describes the minimal analytics API used by the player and the admin dashboard.

All endpoints are mounted under the base URL:

- `https://<backend-host>/api/analytics`

Authentication: all endpoints require a valid JWT token in the `Authorization` header:

```http
Authorization: Bearer <token>
```

## 1. Ingest / Update Session (Player)

**Endpoint**

- `POST /api/analytics/session`

**Purpose**

Called by the player to create or update a viewer session in the `go-live-analytics` table. One item = one viewer session.

**Request body**

```json
{
  "sessionId": "sess-123",        
  "eventId": "event-abc",        
  "viewerId": "user-42",         
  "startTime": "2025-12-04T10:00:00.000Z",
  "endTime": "2025-12-04T10:45:00.000Z",   
  "durationSec": 2700,             
  "isPaidViewer": true,
  "deviceInfo": {                  
    "deviceType": "web",         
    "os": "Windows",
    "browser": "Chrome"
  },
  "location": {                    
    "country": "IN",
    "city": "Delhi"
  },
  "network": {                     
    "bandwidthKbps": 3500
  },
  "meta": {                        
    "referrer": "https://example.com"
  }
}
```

**Required fields**

- `sessionId` — unique per viewer session (string).
- `eventId` — the event this session belongs to (string).
- `startTime` — session start time in ISO-8601 format.

All other fields are optional and can be sent in the first call or in later updates.

**Typical usage from player**

- On playback start: call once with `sessionId`, `eventId`, `startTime`, and any known context (device, location, etc.).
- On playback end: call again with the same `sessionId` and `eventId`, plus `endTime` and `durationSec`. This upserts the existing row.

**Responses**

- `200` — `{ "message": "Session analytics recorded" }`
- `400` — missing or invalid fields.
- `401` — missing/invalid token.
- `500` — server error.

---

## 2. Event Summary (Admin Dashboard)

**Endpoint**

- `GET /api/analytics/{eventId}/summary?range=24h`

**Purpose**

Provides KPI tiles and time-series analytics for a single event over a given time range.

**Path parameters**

- `eventId` — ID of the event to fetch analytics for.

**Query parameters**

- `range` (optional):
  - `"1h"` — last 1 hour
  - `"24h"` — last 24 hours (default)
  - `"7d"` — last 7 days

**Response shape**

```json
{
  "eventId": "event-abc",
  "range": "24h",
  "kpis": {
    "totalViews": 1234,
    "uniqueViewers": 987,
    "avgWatchTimeSec": 456.7,
    "paidViewers": 120,
    "concurrentPeak": 320
  },
  "timeseries": {
    "concurrent": [
      { "ts": "2025-12-04T10:00:00.000Z", "value": 10 },
      { "ts": "2025-12-04T10:01:00.000Z", "value": 15 }
    ]
  },
  "breakdowns": {
    "byDevice": [
      { "device": "web", "count": 500 },
      { "device": "mobile", "count": 300 }
    ],
    "byCountry": [
      { "country": "IN", "count": 600 },
      { "country": "US", "count": 200 }
    ]
  }
}
```

**Usage examples**

- Home/dashboard tiles for a specific event.
- Concurrency line chart using `timeseries.concurrent`.
- Device and geo breakdown components using `breakdowns.byDevice` and `breakdowns.byCountry`.

---

## 3. Recent Sessions (Admin Dashboard)

**Endpoint**

- `GET /api/analytics/{eventId}/recent-sessions?limit=50`

**Purpose**

Provides a list of the most recent viewer sessions for a given event, useful for tables and drill-down views.

**Path parameters**

- `eventId` — ID of the event.

**Query parameters**

- `limit` (optional) — maximum number of sessions to return (default: 50, max: 200).

**Response shape**

```json
{
  "eventId": "event-abc",
  "sessions": [
    {
      "sessionId": "sess-123",
      "viewerId": "user-42",
      "eventId": "event-abc",
      "startTime": "2025-12-04T10:00:00.000Z",
      "endTime": "2025-12-04T10:45:00.000Z",
      "duration": 2700,
      "isPaidViewer": true,
      "deviceType": "web"
    }
  ]
}
```

**Usage examples**

- "Recent viewers" table for an event.
- Admin drill-down into specific sessions (combined with event details and access logs if needed).

---

## Notes & Extensions

- All analytics are stored in the DynamoDB table `go-live-analytics`, one item per viewer session.
- For now, all analytics are computed on-the-fly from session data. If performance becomes an issue, consider adding a separate pre-aggregated metrics table and new endpoints (this can be done later without changing the existing contracts above).
