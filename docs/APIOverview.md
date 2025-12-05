# API Overview

This document summarizes the main APIs exposed by the backend for:

- Admin authentication and management
- Event management
- Viewer access and playback
- Analytics

Authentication flows, high–level contracts, and typical usage are described so frontend and backoffice teams can integrate without digging into controllers.

> NOTE: Paths below assume the server mounts routes as in `src/app.js`:
>
> - `app.use("/api/admin", adminRoutes);`
> - `app.use("/api/event", eventRoutes);`
> - `app.use("/api/access", accessRoutes);`
> - `app.use("/api/playback", playbackRoutes);`
> - `app.use("/api/analytics", analyticsRoutes);`

All authenticated calls use JWT in the `Authorization` header:

```http
Authorization: Bearer <token>
```

---

## 1. Admin APIs

Admin APIs live under `/api/admin` and are documented in `src/routes/adminRoutes.js`.

### 1.1 Register Admin

- **POST** `/api/admin/register`
- **Purpose**: Create a new admin user.
- **Body**:

```json
{
  "name": "Alice Admin",
  "email": "admin@example.com",
  "password": "StrongPassword123"
}
```

- **Responses**:
  - `201` — admin created.
  - `400` — validation error.

### 1.2 Login Admin

- **POST** `/api/admin/login`
- **Purpose**: Authenticate an admin and obtain a JWT.
- **Body**:

```json
{
  "email": "admin@example.com",
  "password": "StrongPassword123"
}
```

- **Response** (shape may vary slightly):

```json
{
  "token": "<jwt>",
  "admin": {
    "id": "...",
    "name": "Alice Admin",
    "email": "admin@example.com"
  }
}
```

- Use the `token` for subsequent admin-only requests.

### 1.3 Get Admin Profile (if enabled)

- **GET** `/api/admin/me`
- **Purpose**: Return the currently authenticated admin (protected route, if implemented in your controllers).

---

## 2. Event Management APIs (Admin)

Event APIs are mounted under `/api/event` and documented in `src/routes/eventRoutes.js`.

These routes are typically protected with admin auth (see `auth.js` / `requireAuth`).

### 2.1 Create Event

- **POST** `/api/event/create`
- **Purpose**: Create a new live event.
- **Typical body** (fields may vary; see `eventController.createEvent`):

```json
{
  "title": "My Live Event",
  "description": "Launch announcement",
  "status": "scheduled",
  "eventType": "live",
  "startTime": "2025-12-04T10:00:00.000Z",
  "endTime": "2025-12-04T11:00:00.000Z",
  "accessMode": "public"  
}
```

- **Responses**:
  - `201` — event created (returns event object).
  - `400` — validation or time format error.

### 2.2 List Events

- **GET** `/api/event/list`
- **Purpose**: List events for the admin (with pagination/filtering as defined in `eventController.listEvents`).

### 2.3 Get Event Details

- **GET** `/api/event/:eventId`
- **Purpose**: Fetch details of a single event.

### 2.4 Update Event

- **PUT** `/api/event/:eventId`
- **Purpose**: Update fields (title, description, times, access mode, etc.).
- **Body**: Partial event data; any field omitted leaves the existing value intact.

### 2.5 Delete/Archive Event

- **DELETE** `/api/event/:eventId`
- **Purpose**: Remove or archive an event (depending on controller logic).

### 2.6 Start/Stop Channel (if supported)

- **POST** `/api/event/:eventId/start`
- **POST** `/api/event/:eventId/stop`
- **Purpose**: Start or stop the underlying MediaLive/streaming channel for the event.

> For exact request/response payloads, refer to `src/controllers/eventController.js` and the Swagger annotations in `src/routes/eventRoutes.js`.

---

## 3. Viewer Access & Auth APIs

Viewer/attendee–side APIs are primarily exposed via `/api/access` and `/api/playback`.

### 3.1 Request Access (Verify Access)

- **POST** `/api/access/verify`
- **Purpose**: Given event and viewer information, decide whether the viewer can access the event and optionally create/update a viewer record.
- **Typical body** (exact fields depend on your form/access mode):

```json
{
  "eventId": "event-abc",
  "email": "viewer@example.com",
  "phone": "+91...",
  "password": "optional-or-empty",
  "formFields": {
    "company": "ACME",
    "designation": "Engineer"
  }
}
```

- **Response**: Contains whether access is granted, a viewer identifier, and any token or link needed for playback (see `accessController.verifyAccess`).

### 3.2 Viewer Login (if password protected)

If your flows support explicit viewer login, it will be handled via `/api/access` routes (e.g. `/api/access/login`) returning a viewer-level token to be used in `/api/playback` calls.

### 3.3 Playback Info

- **GET** `/api/playback/:eventId`
- **Purpose**: Return playback details (playback URL, DRM/license info, etc.) for the viewer to start the player.
- **Auth**: May require a viewer token depending on your configuration.

> See `src/routes/playbackRoutes.js` and `src/controllers/playbackController.js` for the exact contract.

---

## 4. Analytics APIs

Analytics APIs are under `/api/analytics` and are documented in detail in `docs/Analytics.md`.

### 4.1 Ingest / Update Session (Player)

- **POST** `/api/analytics/session`
- **Purpose**: Player sends session start/end and context (device, location, paid/free, etc.) to store in DynamoDB table `go-live-analytics`.

### 4.2 Event Summary (Admin Dashboard)

- **GET** `/api/analytics/{eventId}/summary?range=24h`
- **Purpose**: KPI tiles + concurrency timeseries + device/country breakdowns for one event.

### 4.3 Recent Sessions (Admin Dashboard)

- **GET** `/api/analytics/{eventId}/recent-sessions?limit=50`
- **Purpose**: Recent viewer sessions list for tables and drill-down.

---

## 5. Typical Flows

### 5.1 Admin Creates and Manages Events

1. Admin registers/logs in via `/api/admin/register` + `/api/admin/login`.
2. Admin creates events via `/api/event/create`.
3. Admin updates/schedules events via `/api/event/:eventId` (PUT), and starts/stops channels as needed.

### 5.2 Viewer Joins Event

1. Viewer hits a landing page and submits details.
2. Frontend calls `/api/access/verify` with event + viewer data.
3. If access granted, frontend uses `/api/playback/:eventId` to get player config/URL.
4. Player starts; on start/end of playback, frontend calls `/api/analytics/session`.

### 5.3 Admin Views Analytics

1. Admin opens dashboard with a valid admin JWT.
2. Dashboard calls:
   - `/api/analytics/{eventId}/summary` for KPI tiles and charts.
   - `/api/analytics/{eventId}/recent-sessions` for tables.
3. Optionally aggregates multiple events client–side for "All Events" views.

---

For more detailed schemas, refer to the Swagger annotations directly in the route files:

- `src/routes/adminRoutes.js`
- `src/routes/eventRoutes.js`
- `src/routes/accessRoutes.js`
- `src/routes/playbackRoutes.js`
- `src/routes/analyticsRoutes.js`

And to controller implementations for any edge cases and validations:

- `src/controllers/adminController.js`
- `src/controllers/eventController.js`
- `src/controllers/accessController.js`
- `src/controllers/playbackController.js`
- `src/controllers/analyticsController.js`
