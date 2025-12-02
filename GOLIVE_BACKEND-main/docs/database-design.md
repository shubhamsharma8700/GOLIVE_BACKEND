# GoLive Platform — Database Design Documentation

**Version:** 1.0  
**Date:** November 18, 2025  
**Prepared for:** GoLive Migration & Modernization Project

---

## 1. Purpose & Scope
The GoLive database architecture captures every viewer-facing touchpoint of the live/VOD workflow—admin provisioning, event metadata, access controls, payments, telemetry, and AWS workflow automation. This document explains the DynamoDB-first logical design so platform engineers, data teams, and DevOps can evolve the system without jeopardizing reliability or traceability.

## 2. Architecture Tenets
- **Lean schema:** A handful of purpose-built tables reduce cross-partition joins and keep hot paths predictable.
- **Partition-aware scalability:** Partition keys align with the highest traffic dimensions (eventId, viewerId) to sustain thousands of concurrent watchers.
- **Forward compatibility:** Optional attributes (form data, personalization flags, automation metadata) allow incremental upgrades without rework.
- **Full-fidelity observability:** Every join, playback, and automation event is time-stamped to support compliance and RCA workflows.
- **Automation native:** Table layouts are Lambda- and EventBridge-friendly, embracing idempotent writes, TTLs, and streaming triggers.

## 3. Domain Overview
| Domain | Entities | Notes |
| --- | --- | --- |
| Administration | Admins | Manages platform configuration and governance. |
| Content Management | Events | Owns media metadata, AWS pipeline IDs, and access policies. |
| Viewer & Analytics | Viewers, Analytics | Tracks viewer identity, joins, sessions, and device-level telemetry. |
| Payments | Payments | Stripe-centric commerce tracking for paid events. |
| Automation | Automation (optional) | Audits AWS orchestration hooks around event lifecycle. |

**Entity flow (textual ER):** `Admins → Events → Viewers → Analytics`, with `Events → Payments` and `Events → Automation` as side branches.

## 4. Table Specifications
Each table targets DynamoDB with on-demand capacity unless otherwise noted. Timestamps use ISO-8601 strings to simplify Lambda integrations.

### 4.1 Admins
- **Primary key:** `PK = adminId`
- **Purpose:** Single source of truth for privileged operators.

| Field | Type | Description |
| --- | --- | --- |
| adminId | String | UUID (v4) or ULID; also used in audit trails. |
| name | String | Human-readable display name. |
| email | String | Unique login identifier; enforce global secondary index for lookup. |
| passwordHash | String | Bcrypt hash with per-user salt. |
| status | Enum(`active`, `inactive`) | Controls authentication outcome. |
| lastLoginAt | Timestamp | Updated through auth Lambda. |
| createdAt | Timestamp | Creation time. |
| updatedAt | Timestamp | Last mutation time. |

**Recommended GSIs:** `GSI1` on `email` for login resolution.

### 4.2 Events
- **Primary key:** `PK = eventId`
- **Purpose:** Encapsulates playback configuration, access policy, and billing state.

| Field | Type | Description |
| --- | --- | --- |
| eventId | String | Globally unique identifier (ULID recommended). |
| title | String | Event title (<= 120 chars). |
| description | String | Markdown allowed for page rendering. |
| thumbnailUrl | String | HTTPS asset in S3/CloudFront. |
| status | Enum(`draft`, `scheduled`, `live`, `ended`, `archived`) | Drives automation triggers. |
| eventType | Enum(`live`, `vod`) | Determines playback pipelines. |
| scheduledStart | Timestamp | Planned start. |
| scheduledEnd | Timestamp | Planned end. |
| createdBy | String | FK to `Admins.adminId`. |
| mediaLiveChannelId | String | AWS MediaLive channel reference. |
| mediaPackageChannelId | String | AWS MediaPackage channel reference. |
| liveUrl | String | CloudFront distribution for live playback. |
| vodUrl | String | CloudFront/S3 path for VOD. |
| s3Bucket | String | Storage bucket alias. |
| accessType | Enum(`anonymous`, `form`, `password`) | Governs viewer gates. |
| accessPassword | String | Bcrypt hash when `accessType = password`. |
| formFields | JSON | Schema for custom registration forms. |
| isPaidEvent | Boolean | True if payment mandatory. |
| priceAmount | Number | Minor currency units (e.g., cents). |
| currency | String | ISO 4217 code. |
| stripeProductId | String | Stripe Product identifier. |
| stripePriceId | String | Stripe Price identifier. |
| stripeSetupStatus | Enum(`pending`, `created`, `failed`) | Automation state for Stripe resources. |
| createdAt | Timestamp | Creation time. |
| updatedAt | Timestamp | Last mutation time. |

**Indexes & Streams:** Enable DynamoDB Streams to trigger automation lambdas when `status` or `stripeSetupStatus` changes.

### 4.3 Viewers
- **Primary key:** `PK = eventId`, `SK = clientViewerId` to keep sessions co-located per event.
- **Purpose:** Canonical mapping between anonymous/pseudonymous viewers and their access/payment posture.

| Field | Type | Description |
| --- | --- | --- |
| viewerId | String | Synthetic ID for referencing from analytics/payments. |
| eventId | String | FK to Events. |
| clientViewerId | String | Fingerprint (cookie/localStorage); deterministic per browser. |
| email | String | Optional email collected via forms. |
| name | String | Optional display name. |
| accessMode | Enum | Resolved access path. |
| formData | JSON | Persisted responses from dynamic forms. |
| isPaidViewer | Boolean | True once Stripe success recorded. |
| paymentStatus | Enum(`none`, `pending`, `success`, `failed`) | Mirrors latest charge attempt. |
| accessVerified | Boolean | Set after password/form validation. |
| deviceType | Enum(`desktop`, `mobile`, `tablet`) | Derived from UA parser. |
| ipAddress | String | First-join IP; immutable for audit trail. |
| firstJoinAt | Timestamp | Creation timestamp for the viewer-item. |
| lastJoinAt | Timestamp | Updated on every join. |
| totalSessions | Number | Counter of sessions from Analytics ingestion. |
| totalWatchTime | Number | Aggregate seconds watched. |
| createdAt | Timestamp | Record creation time. |

**GSIs:**
- `GSI1 (viewerId -> eventId)` for reverse lookup via `viewerId`.
- `GSI2 (email + eventId)` to handle email-based re-entry.

### 4.4 Analytics
- **Primary key:** `PK = sessionId`
- **Purpose:** Immutable session reports for dashboards and troubleshooting.

| Field | Type | Description |
| --- | --- | --- |
| sessionId | String | Generated per playback session. |
| eventId | String | FK to Events. |
| viewerId | String | FK to Viewers.viewerId. |
| startTime | Timestamp | Session start. |
| endTime | Timestamp | Session end (nullable until closed). |
| duration | Number | Seconds watched; computed post-session. |
| playbackType | Enum(`live`, `vod`) | Session modality. |
| ipAddress | String | Session IP (can differ from viewer record). |
| deviceInfo | JSON | Full UA metadata. |
| location | JSON | `{ country, city }` from GeoIP. |
| createdAt | Timestamp | Insert time.

**Analytics pipeline:** Kinesis Firehose → Lambda → DynamoDB; also push to S3 for Athena queries.

### 4.5 Payments
- **Primary key:** `PK = paymentId`
- **Purpose:** Durable ledger of Stripe interactions tied back to events and viewers.

| Field | Type | Description |
| --- | --- | --- |
| paymentId | String | Internal ID (e.g., `pay_<ULID>`). |
| eventId | String | FK to Events. |
| viewerId | String | FK to Viewers.viewerId. |
| stripePaymentIntentId | String | Stripe Payment Intent reference. |
| stripeCheckoutSessionId | String | Checkout Session reference. |
| stripeCustomerId | String | Customer ID when saved. |
| currency | String | ISO 4217. |
| amount | Number | Minor units (cents). |
| status | Enum(`created`, `pending`, `succeeded`, `failed`, `refunded`) | Lifecycle indicator. |
| paymentMethod | String | Card/Wallet/UPI descriptor. |
| receiptUrl | String | Stripe-hosted receipt. |
| metadata | JSON | Arbitrary Stripe metadata (e.g., coupon, campaign). |
| initiatedAt | Timestamp | Charge attempt time. |
| confirmedAt | Timestamp | Success timestamp. |
| updatedAt | Timestamp | Last update.

**GSIs:**
- `GSI1 (eventId, status)` for ops dashboards.
- `GSI2 (stripePaymentIntentId)` for webhook idempotency checks.

### 4.6 Automation (Optional)
- **Primary key:** `PK = automationId`
- **Purpose:** Trace AWS workflow hooks (MediaLive start/stop, MediaConvert jobs, cleanups).

| Field | Type | Description |
| --- | --- | --- |
| automationId | String | ULID/UUID. |
| eventId | String | FK to Events. |
| triggerType | Enum(`preStart`, `postStop`, `mediaConvert`, `cleanup`) | Workflow stage. |
| lambdaName | String | Executed Lambda identifier. |
| executionStatus | Enum(`pending`, `success`, `failed`) | Result state. |
| timestamp | Timestamp | Execution time. |
| logDetails | String | CloudWatch Logs / X-Ray reference. |

**Usage:** Feed into operations dashboards and incident retrospectives.

## 5. Relationships & Access Patterns
- **Admins → Events:** `createdBy` attribute allows filtering events per admin; consider a GSI to paginate by `createdBy`.
- **Events → Viewers:** Partition per `eventId` supports quick access checks and leaderboard queries.
- **Viewers → Analytics:** `viewerId` referenced in Analytics to rebuild session timelines.
- **Events → Payments:** Payments table filtered by `eventId` to reconcile revenue per event.
- **Events → Automation:** Automation records keyed by `eventId` to view lifecycle activity.

Typical access patterns:
1. **Landing page:** Fetch `Events` by `eventId`, then check gating fields.
2. **Viewer admission:** Upsert into `Viewers` (idempotent on `clientViewerId`).
3. **Playback analytics:** Stream session documents into `Analytics`; aggregate by `eventId` for dashboards.
4. **Payments:** Create `Payments` record when initiating Stripe checkout; update via webhooks.
5. **Automation log:** Insert into `Automation` when Lambdas fire around event start/stop.

## 5.1 User Access Architecture
- **Access layers:**
  - `anonymous` — Event page auto-admits visitors; `Viewers.accessVerified = true` immediately while tracking fingerprint and IP.
  - `form` — Custom form described by `Events.formFields`; submitted payload stored in `Viewers.formData` before granting access.
  - `password` — Bcrypt-hashed secret stored in `Events.accessPassword`; compare hash within Lambda/API before toggling `accessVerified`.
- **Paid overlay:** When `Events.isPaidEvent = true`, a successful `Payments` item is required in addition to the base access mode. The viewer record flips `isPaidViewer` and `paymentStatus` once Stripe webhooks confirm.
- **Admission workflow:**
  1. Fetch event metadata and render the proper gate based on `accessMode` and `isPaidEvent`.
  2. Validate form/password if applicable; persist viewer fingerprint plus any contextual metadata.
  3. For paid events, create a `Payments` entry and redirect to Stripe Checkout; webhook updates finalize access.
  4. Mark `Viewers.accessVerified = true` and issue a short-lived access token (e.g., CloudFront signed cookie) referencing `viewerId`.
- **Re-entry logic:** Requests reuse `clientViewerId` (localStorage) to fetch the viewer row. If form/password already cleared and payment succeeded, the gate is bypassed and only `lastJoinAt` updates.
- **Operational notes:** Failed password attempts or payment declines stay visible via `paymentStatus`/`accessVerified`, allowing support teams to triage without manual log dives.

## 6. Data Flow Walkthrough
1. Admin creates an event (Admins → Events write). Stripe and MediaLive IDs provisioned asynchronously.
2. Viewer hits the event page; `Viewers` record either created (new fingerprint) or updated.
3. Playback Lambda emits session start/end into `Analytics`, boosting `totalWatchTime` via incremental updates on `Viewers`.
4. Paid events prompt a Stripe session; `Payments` entry created with `status = pending` and reconciled on webhook callback.
5. Successful payment toggles `Viewers.isPaidViewer = true` and `paymentStatus = success`.
6. Event lifecycle Lambdas log entries in `Automation`, enabling audit timelines.

## 7. Security & Compliance Notes
- **Secrets:** Never store plaintext passwords; bcrypt with adaptive cost. Access passwords follow the same pattern.
- **PII boundaries:** `Viewers.email`, `ipAddress`, `deviceInfo` classified as sensitive; apply DynamoDB encryption at rest + VPC endpoints.
- **Auditing:** Enable DynamoDB Streams + Kinesis Data Firehose to archive mutations for forensic replay.
- **Retention:** Apply TTL on `Analytics` and `Automation` if regulatory policy permits; keep `Events`/`Payments` indefinitely for financial compliance.

## 8. Operational Playbook
- **On-call dashboards:**
  - Event health: `Events.status`, `Automation.executionStatus` filters.
  - Viewer funnel: count of `Viewers` per `accessMode`, `paymentStatus`.
  - Revenue: sum `Payments.amount` where `status = succeeded`.
- **Backfills:** Use AWS Glue or Lambda batch jobs to recompute aggregates if needed.
- **Disaster recovery:** Export tables to S3 via Point-in-Time Recovery; replicate to secondary region if required.

## 9. Roadmap & Extensibility
- Subscription support: add `subscriptionId` references to `Viewers` and `Payments`.
- Multi-tenant support: prepend `tenantId` to partition keys or introduce a composite key design.
- Personalization: store viewer preferences in `Viewers.formData` or a dedicated extensions table keyed by `viewerId`.
- Advanced analytics: stream `Analytics` events to Redshift or ClickHouse for real-time dashboards.

## 10. Appendix
| Relationship | Cardinality | Description |
| --- | --- | --- |
| Admins → Events | 1:N | One admin can own multiple events. |
| Events → Viewers | 1:N | Each event aggregates many viewer fingerprints. |
| Viewers → Analytics | 1:N | A viewer spawns many playback sessions. |
| Events → Payments | 1:N | Every paid event may spawn multiple Stripe payments. |
| Events → Automation | 1:N | Lifecycle hooks per event state change. |

This database blueprint gives GoLive a trusted, automation-ready foundation for future expansion into subscriptions, localized catalogs, and deeper analytics while safeguarding operational simplicity.
