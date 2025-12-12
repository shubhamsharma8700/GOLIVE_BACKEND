# React Viewer UI (frontend-access-tester)

This is a small React + Video.js app that acts as a **viewer UI** to exercise your backend access flows and playback.

- Supports 4 conceptual access types: `publicAccess`, `privateAccess`, `passwordAccess`, `paymentAccess` (and will also work with existing names like `freeAccess`, `emailAccess`, `paidAccess`).
- Implements password registration + login via the unified `POST /api/access/event/:eventId/requestAccess` endpoint.
- Persists the viewer JWT and `clientViewerId` in `localStorage` so the viewer stays logged in across refreshes.
- Uses Video.js to play the HLS stream returned by `GET /api/playback/event/:eventId/stream`.
- **Does not modify the backend** – it only calls existing endpoints.

## Backend assumptions

The app assumes the following endpoints exist and behave as described:

- `GET /api/event/event/:eventId` – returns an event object including at least `accessMode` and metadata.
- `POST /api/access/event/:eventId/requestAccess` – unified access API for all modes.
   - For password access, use `mode: "register"` (to trigger password email) and `mode: "login"` (to log in).
   - On successful login it returns `{ accessGranted: true, token, viewerId, ... }`.
- `GET /api/playback/event/:eventId/stream` – requires `Authorization: Bearer <viewerToken>` (or `x-viewer-token`) and returns `{ success: true, streamUrl }`.

## Configuration

- Backend base URL is controlled by `VITE_API_BASE_URL`.
   - If not set, it defaults to `http://localhost:5000`.

## Setup & Run

From the backend root, ensure the API is running:

```pwsh
cd E:\GOLIVE_BACKEND
npm run dev
```

In another terminal, run the viewer UI:

```pwsh
cd E:\GOLIVE_BACKEND\frontend-access-tester
npm install
npm run dev
```

Then open `http://localhost:5173/viewer/<eventId>` in your browser, replacing `<eventId>` with a real event id.

## How it works

- On load, `EventViewer` reads `eventId` from the route (`/viewer/:eventId`) and calls `GET /api/event/event/:eventId`.
- It normalizes `event.accessMode` into one of: `public`, `private`, `password`, `payment`.
- If a viewer token is already stored, it immediately attempts `GET /api/playback/event/:eventId/stream` so refreshes keep the viewer in.
- If no token or the stream call is unauthorized, it shows `AccessGate` with the correct UI for the access mode.

### AccessGate flows

- **Public access** (`publicAccess` / `freeAccess`):
   - Shows a simple "Continue" button; the app then tries to fetch the stream.
- **Private access** (`privateAccess` / `emailAccess`):
   - Provides a textarea where you can paste a viewer token manually for testing.
   - On submit, it stores the token and triggers playback.
- **Password access** (`passwordAccess`):
   - **Registration panel**: collects `firstName`, `lastName`, `email` and calls:
      - `POST /api/access/event/:eventId/requestAccess` with `{ mode: "register", formData: { firstName, lastName, email }, clientViewerId }`.
   - **Login panel**: collects `email`, `password` and calls:
      - `POST /api/access/event/:eventId/requestAccess` with `{ mode: "login", email, password, clientViewerId }`.
   - On `{ accessGranted: true, token, viewerId }` it stores the session and attempts playback.
- **Payment access** (`paymentAccess` / `paidAccess`):
   - Shows a "Simulate payment" button that marks the viewer as "paid" in the UI.
   - Then, on submit, calls `POST /api/access/event/:eventId/requestAccess` with `{ clientViewerId, email, isPaidViewer: true }`.
   - On success with `{ accessGranted: true, token, viewerId }` it stores the session and attempts playback.

### Token & clientViewerId persistence

- `clientViewerId` is generated once using `crypto.randomUUID()` (or a random fallback) and stored under `localStorage.clientViewerId`.
- Viewer token is stored under `localStorage.viewerToken`, viewer id under `localStorage.viewerId`.
- On app start, if a token exists, the UI will try to fetch the stream immediately.
   - If the server responds `401`/`403`, the token is cleared and the user is shown the access gate again.

## Developer notes

- All backend interaction is wrapped in `src/services/api.js`.
- Local storage handling and `clientViewerId` management are in `src/services/auth.js` and `src/utils/uuid.js`.
- Video.js is wrapped in `src/components/VideoPlayer.jsx` and only initialized after a valid `streamUrl` is returned.
- A small dev panel (visible only in dev builds) shows the raw event object and last stream call for debugging.

### Suggested backend improvements for production (not implemented here)

- Add a refresh-token mechanism with short-lived access tokens and long-lived refresh tokens.
- Move tokens to httpOnly cookies instead of `localStorage`.
- Use signed CloudFront URLs for playback instead of returning raw origin URLs.

## QA checklist

- **Public access**
   - Configure an event with `accessMode=publicAccess` or `freeAccess`.
   - Visit `/viewer/:eventId` and confirm the stream plays without any login.
- **Password access**
   - Configure an event with `accessMode=passwordAccess`.
   - Use the registration panel to trigger a password email.
   - Use the login panel with the emailed password.
   - Confirm playback works and a refresh still plays the stream (token persisted).
- **Private access**
   - Obtain a valid viewer token out-of-band.
   - Visit `/viewer/:eventId` for a `privateAccess` event.
   - Paste the token into the private access gate and confirm playback works.
- **Payment access**
   - Configure an event as `paymentAccess` / `paidAccess`.
   - Without clicking "Simulate payment", confirm access is not granted.
   - After clicking "Simulate payment" and requesting access, confirm playback works.
- **Token expiry simulation**
   - Manually clear `localStorage.viewerToken` in devtools, refresh the page.
   - UI should no longer auto-play and should show the access gate again.
