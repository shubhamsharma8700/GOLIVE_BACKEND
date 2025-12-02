# GoLive Backend - API Reference

## Overview
This document provides a complete reference for all API endpoints in the GoLive Backend. The API is organized into three main groups:
1. **Admin Authentication** - User login and session management
2. **Event Management** - CRUD operations and live stream control
3. **Viewer Access** - Entry points for viewers with different access modes

---

## Authentication

### Admin Authentication
Admin endpoints require a valid JWT token in the Authorization header after login.

**Header format:**
```
Authorization: Bearer <jwt_token>
```

---

## Endpoints

### Admin Authentication

#### 1. Admin Login
**Endpoint:** `POST /api/admin/login`

Authenticates an admin user and returns a JWT token for subsequent requests.

**Request Body:**
```json
{
  "username": "admin@example.com",
  "password": "password123"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response (401 Unauthorized):**
```json
{
  "success": false,
  "message": "Invalid credentials"
}
```

---

### Event Management

> **Note:** All event management endpoints require admin authentication. Include the JWT token from login in the Authorization header.

#### 2. Create Event
**Endpoint:** `POST /api/admin/event/create`  
**Auth Required:** Yes (Admin)

Creates a new event with live streaming configuration.

**Request Body:**
```json
{
  "title": "Live Conference 2024",
  "description": "Annual tech conference",
  "thumbnail": "https://example.com/thumbnail.jpg",
  "accessMode": "openAccess",
  "paymentMode": "free",
  "price": 0,
  "eventDate": "2024-02-15T18:00:00Z",
  "duration": 120,
  "mediaLiveChannelId": "channel-12345",
  "mediaLiveInputId": "input-67890",
  "mediaPackageChannelId": "pkg-channel-11111",
  "hlsPlaylistUrl": "https://example.com/playlist.m3u8",
  "stripeAccountId": "acct_stripe123",
  "password": "secure_password_123"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "message": "Event created successfully",
  "eventId": "evt_abc123xyz",
  "event": {
    "eventId": "evt_abc123xyz",
    "title": "Live Conference 2024",
    "description": "Annual tech conference",
    "thumbnail": "https://example.com/thumbnail.jpg",
    "accessMode": "openAccess",
    "paymentMode": "free",
    "price": 0,
    "createdAt": "2024-02-01T10:00:00Z"
  }
}
```

**Response (400 Bad Request):**
```json
{
  "success": false,
  "message": "Invalid access mode. Must be one of: openAccess, emailAccess, passwordAccess, paymentAccess"
}
```

---

#### 3. List All Events
**Endpoint:** `GET /api/admin/event/list`  
**Auth Required:** Yes (Admin)

Retrieves all events with pagination support.

**Query Parameters:**
- `page` (optional, default: 1): Page number for pagination
- `limit` (optional, default: 10): Number of events per page

**Response (200 OK):**
```json
{
  "success": true,
  "events": [
    {
      "eventId": "evt_abc123xyz",
      "title": "Live Conference 2024",
      "description": "Annual tech conference",
      "accessMode": "openAccess",
      "paymentMode": "free",
      "price": 0,
      "createdAt": "2024-02-01T10:00:00Z",
      "status": "active"
    }
  ],
  "total": 1,
  "page": 1,
  "totalPages": 1
}
```

---

#### 4. Get Event Details
**Endpoint:** `GET /api/admin/event/:eventId`  
**Auth Required:** Yes (Admin)

Retrieves detailed information for a specific event.

**Path Parameters:**
- `eventId` (required): Unique event identifier

**Response (200 OK):**
```json
{
  "success": true,
  "event": {
    "eventId": "evt_abc123xyz",
    "title": "Live Conference 2024",
    "description": "Annual tech conference",
    "thumbnail": "https://example.com/thumbnail.jpg",
    "accessMode": "openAccess",
    "paymentMode": "free",
    "price": 0,
    "eventDate": "2024-02-15T18:00:00Z",
    "duration": 120,
    "mediaLiveChannelId": "channel-12345",
    "mediaLiveInputId": "input-67890",
    "mediaPackageChannelId": "pkg-channel-11111",
    "hlsPlaylistUrl": "https://example.com/playlist.m3u8",
    "stripeAccountId": "acct_stripe123",
    "createdAt": "2024-02-01T10:00:00Z"
  }
}
```

**Response (404 Not Found):**
```json
{
  "success": false,
  "message": "Event not found"
}
```

---

#### 5. Update Event
**Endpoint:** `PUT /api/admin/event/:eventId`  
**Auth Required:** Yes (Admin)

Updates an existing event. Only provided fields are updated.

**Path Parameters:**
- `eventId` (required): Unique event identifier

**Request Body (all fields optional):**
```json
{
  "title": "Updated Conference Title",
  "description": "Updated description",
  "thumbnail": "https://example.com/new-thumbnail.jpg",
  "accessMode": "passwordAccess",
  "paymentMode": "paid",
  "price": 29.99,
  "password": "new_password_456",
  "hlsPlaylistUrl": "https://example.com/updated-playlist.m3u8"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Event updated successfully",
  "event": {
    "eventId": "evt_abc123xyz",
    "title": "Updated Conference Title",
    "description": "Updated description",
    "accessMode": "passwordAccess",
    "paymentMode": "paid",
    "price": 29.99
  }
}
```

---

#### 6. Delete Event
**Endpoint:** `DELETE /api/admin/event/:eventId`  
**Auth Required:** Yes (Admin)

Permanently deletes an event.

**Path Parameters:**
- `eventId` (required): Unique event identifier

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Event deleted successfully"
}
```

**Response (404 Not Found):**
```json
{
  "success": false,
  "message": "Event not found"
}
```

---

#### 7. Start Live Channel
**Endpoint:** `POST /api/admin/event/:eventId/channel/start`  
**Auth Required:** Yes (Admin)

Starts the AWS MediaLive channel for the event.

**Path Parameters:**
- `eventId` (required): Unique event identifier

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Channel started successfully",
  "channelId": "channel-12345",
  "state": "RUNNING"
}
```

**Response (400 Bad Request):**
```json
{
  "success": false,
  "message": "Channel is already running"
}
```

---

#### 8. Stop Live Channel
**Endpoint:** `POST /api/admin/event/:eventId/channel/stop`  
**Auth Required:** Yes (Admin)

Stops the AWS MediaLive channel for the event.

**Path Parameters:**
- `eventId` (required): Unique event identifier

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Channel stopped successfully",
  "channelId": "channel-12345",
  "state": "STOPPED"
}
```

**Response (400 Bad Request):**
```json
{
  "success": false,
  "message": "Channel is not running"
}
```

---

### Viewer Access

> **Note:** Viewer access endpoints do NOT require admin authentication. Each access mode has different requirements.

#### 9. Open Access
**Endpoint:** `POST /api/access/event/:eventId/openAccess`  
**Auth Required:** No  
**Access Mode:** `openAccess`

Grants immediate access to viewers for open access events. No request body or authentication required.

**Path Parameters:**
- `eventId` (required): Unique event identifier

**Request Body:**
```
(empty - no body required)
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Open access granted",
  "eventId": "evt_abc123xyz",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600
}
```

**Response (404 Not Found):**
```json
{
  "success": false,
  "message": "Event not found"
}
```

**Example cURL:**
```bash
curl -X POST http://localhost:3000/api/access/event/evt_abc123xyz/openAccess \
  -H "Content-Type: application/json"
```

---

#### 10. Email Access Registration
**Endpoint:** `POST /api/access/event/:eventId/register`  
**Auth Required:** No  
**Access Mode:** `emailAccess`

Registers a viewer with their email for email access events.

**Path Parameters:**
- `eventId` (required): Unique event identifier

**Request Body:**
```json
{
  "clientViewerId": "viewer_12345",
  "fname": "John",
  "sName": "Doe",
  "email": "john.doe@example.com",
  "deviceType": "desktop"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Registration successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600,
  "viewerId": "viewer_abc123"
}
```

**Response (400 Bad Request):**
```json
{
  "success": false,
  "message": "All fields are required: clientViewerId, fname, sName, email"
}
```

**Example cURL:**
```bash
curl -X POST http://localhost:3000/api/access/event/evt_abc123xyz/register \
  -H "Content-Type: application/json" \
  -d '{
    "clientViewerId": "viewer_12345",
    "fname": "John",
    "sName": "Doe",
    "email": "john.doe@example.com",
    "deviceType": "desktop"
  }'
```

---

#### 11. Password Access Verification
**Endpoint:** `POST /api/access/event/:eventId/password`  
**Auth Required:** No  
**Access Mode:** `passwordAccess`

Verifies the event password and grants access if correct.

**Path Parameters:**
- `eventId` (required): Unique event identifier

**Request Body:**
```json
{
  "clientViewerId": "viewer_12345",
  "password": "secure_password_123"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Password verified",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600,
  "viewerId": "viewer_abc123"
}
```

**Response (401 Unauthorized):**
```json
{
  "success": false,
  "message": "Invalid password"
}
```

**Response (400 Bad Request):**
```json
{
  "success": false,
  "message": "clientViewerId and password are required"
}
```

**Example cURL:**
```bash
curl -X POST http://localhost:3000/api/access/event/evt_abc123xyz/password \
  -H "Content-Type: application/json" \
  -d '{
    "clientViewerId": "viewer_12345",
    "password": "secure_password_123"
  }'
```

---

#### 12. Payment Access Checkout
**Endpoint:** `POST /api/access/event/:eventId/pay`  
**Auth Required:** No  
**Access Mode:** `paymentAccess`

Creates a payment record for viewers purchasing access to paid events.

**Path Parameters:**
- `eventId` (required): Unique event identifier

**Request Body:**
```json
{
  "viewerId": "viewer_12345",
  "amount": 29.99,
  "currency": "USD"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Payment processed successfully",
  "paymentId": "pay_xyz789",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600,
  "amount": 29.99,
  "currency": "USD"
}
```

**Response (400 Bad Request):**
```json
{
  "success": false,
  "message": "viewerId and amount are required"
}
```

**Example cURL:**
```bash
curl -X POST http://localhost:3000/api/access/event/evt_abc123xyz/pay \
  -H "Content-Type: application/json" \
  -d '{
    "viewerId": "viewer_12345",
    "amount": 29.99,
    "currency": "USD"
  }'
```

---

## JWT Token Usage

All viewer access endpoints return a JWT token upon successful access grant. This token can be used for:
- Verifying viewer identity
- Tracking access sessions
- Extending permissions for protected resources

**Token Structure:**
```json
{
  "viewerId": "viewer_abc123",
  "eventId": "evt_abc123xyz",
  "accessMode": "passwordAccess",
  "isPaidViewer": false,
  "iat": 1706779200,
  "exp": 1706782800
}
```

**Token Expiry:** 1 hour (3600 seconds) from issue time

**Using the Token:**
Include the token in subsequent requests' Authorization header:
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## Access Modes Summary

| Mode | Auth Required | Fields Required | Use Case |
|------|---------------|-----------------|----------|
| `openAccess` | No | None | Free, no registration |
| `emailAccess` | No | fname, sName, email, clientViewerId | Email registration required |
| `passwordAccess` | No | password, clientViewerId | Password protected |
| `paymentAccess` | No | viewerId, amount | Paid access |

---

## Environment Variables

Configure the following environment variables:

```
# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key

# JWT Configuration
JWT_SECRET=your_jwt_secret_key

# Server Configuration
PORT=3000
NODE_ENV=production
```

---

## Error Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request (missing/invalid fields) |
| 401 | Unauthorized (invalid credentials/password) |
| 404 | Not Found (event/resource doesn't exist) |
| 500 | Internal Server Error |

---

## Rate Limiting

Currently, no rate limiting is implemented. Consider adding rate limiting middleware for production environments.

---

## CORS

CORS is configured to allow requests from configured origins. Update the CORS settings in `src/app.js` for production use.

---

## Version

API Version: 1.0.0  
Last Updated: February 2024
