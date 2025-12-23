import {
  ddbDocClient,
  PutCommand,
  ScanCommand,
  GetCommand,
  DeleteCommand,
} from "../config/awsClients.js";

import {
  CloudFrontClient,
  GetDistributionConfigCommand,
  UpdateDistributionCommand,
  DeleteDistributionCommand,
} from "@aws-sdk/client-cloudfront";

import {
  MediaLiveClient,
  StopChannelCommand,
  DeleteChannelCommand,
  DeleteInputCommand,
} from "@aws-sdk/client-medialive";

import {
  MediaPackageClient,
  DeleteChannelCommand as DeleteMediaPackageChannelCommand,
} from "@aws-sdk/client-mediapackage";

import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";

/* ======================================================
   CONSTANTS
====================================================== */

const EVENTS_TABLE = process.env.EVENTS_TABLE_NAME || "go-live-poc-events";
const VOD_BUCKET = process.env.S3_VOD_BUCKET || "go-live-vod";
const SIGNED_URL_EXPIRES = Number(process.env.SIGNED_URL_EXPIRES || 900);

const EVENT_TYPES = new Set(["live", "scheduled", "vod"]);
const ACCESS_MODES = new Set([
  "freeAccess",
  "emailAccess",
  "passwordAccess",
  "paidAccess",
]);

const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 10);

/* ======================================================
   AWS CLIENTS
====================================================== */

const region = process.env.AWS_REGION || "ap-south-1";

const s3Client = new S3Client({ region });
const cloudFrontClient = new CloudFrontClient({ region });
const mediaLiveClient = new MediaLiveClient({ region });
const mediaPackageClient = new MediaPackageClient({ region });

/* ======================================================
   HELPERS
====================================================== */

const nowISO = () => new Date().toISOString();

const toIsoString = (value) => {
  if (!value) return null;
  const dt = new Date(value);
  if (isNaN(dt.getTime())) throw new Error("Invalid date format");
  return dt.toISOString();
};

const parseNumber = (value) => {
  const n = Number(value);
  if (isNaN(n)) throw new Error("Invalid numeric value");
  return n;
};

const parseFormFields = (value) => {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error("formFields must be valid JSON");
    }
  }
  throw new Error("Invalid formFields input");
};

const resolveCurrency = (value) => {
  const cur = value?.toString()?.trim()?.toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) throw new Error("currency must be ISO 4217");
  return cur;
};

/** Delete all objects under an S3 prefix */
async function deleteS3Prefix(bucket, prefix) {
  let token;

  do {
    const res = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      })
    );

    if (!res.Contents || res.Contents.length === 0) return;

    await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: res.Contents.map((o) => ({ Key: o.Key })),
        },
      })
    );

    token = res.NextContinuationToken;
  } while (token);
}

/** Disable & delete CloudFront distribution */
async function deleteCloudFrontDistribution(distributionId) {
  const { DistributionConfig, ETag } =
    await cloudFrontClient.send(
      new GetDistributionConfigCommand({ Id: distributionId })
    );

  if (DistributionConfig.Enabled) {
    DistributionConfig.Enabled = false;

    await cloudFrontClient.send(
      new UpdateDistributionCommand({
        Id: distributionId,
        IfMatch: ETag,
        DistributionConfig,
      })
    );

    await new Promise((res) => setTimeout(res, 60_000));
  }

  await cloudFrontClient.send(
    new DeleteDistributionCommand({
      Id: distributionId,
      IfMatch: ETag,
    })
  );
}

// =======================================================
//        EVENT CONTROLLER
// =======================================================

export default class EventController {

  // =====================================================
  // 1. PRESIGN URL FOR VOD UPLOAD
  // =====================================================
  static async vodPresignUpload(req, res) {
    try {
      const { filename, contentType } = req.query;

      if (!filename)
        return res.status(400).json({ success: false, message: "filename is required" });

      const fileKey = `vod-uploads/${uuidv4()}/${filename}`;

      const command = new PutObjectCommand({
        Bucket: "go-live-vod",
        Key: fileKey,
        ContentType: contentType || "video/mp4",
      });

      const uploadUrl = await getSignedUrl(s3Client, command, {
        expiresIn: SIGNED_URL_EXPIRES,
      });

      return res.status(200).json({
        success: true,
        uploadUrl,
        fileKey,
      });
    } catch (err) {
      console.error("Presign error:", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // =====================================================
  // 2. CREATE EVENT  (Updated for new frontend payload)
  // =====================================================
  static async createEvent(req, res) {
    try {
      const payload = req.body || {};

      const {
        title,
        description,
        eventType,
        accessMode,

        startTime,
        endTime,

        s3Key,
        s3Prefix,

        videoConfig,
        registrationFields,

        paymentAmount,
        currency,
        accessPasswordHash,
        accessPassword,
      } = payload;

      // ---------------- BASIC VALIDATION ----------------
      if (!title) return res.status(400).json({ message: "title is required" });
      if (!description)
        return res.status(400).json({ message: "description is required" });
      if (!EVENT_TYPES.has(eventType))
        return res.status(400).json({ message: "Invalid eventType" });
      if (!ACCESS_MODES.has(accessMode))
        return res.status(400).json({ message: "Invalid accessMode" });

      // videoConfig validation (minimal, safe)
      if (videoConfig) {
        const { resolution, frameRate, bitrateProfile } = videoConfig;

        if (
          resolution &&
          !["1080p", "720p", "480p"].includes(resolution)
        ) {
          return res
            .status(400)
            .json({ message: "Invalid videoConfig.resolution" });
        }

        if (
          frameRate &&
          ![25, 30, 60].includes(Number(frameRate))
        ) {
          return res
            .status(400)
            .json({ message: "Invalid videoConfig.frameRate" });
        }

        if (
          bitrateProfile &&
          !["low", "medium", "high"].includes(bitrateProfile)
        ) {
          return res
            .status(400)
            .json({ message: "Invalid videoConfig.bitrateProfile" });
        }
      }

      const createdBy =
        req.user?.email ||
        req.user?.id ||
        req.user?.adminId ||
        "unknown-admin";

      // ---------------- TIME HANDLING ----------------
      let finalStart = null;
      let finalEnd = null;

      if (eventType === "live" || eventType === "scheduled") {
        if (!startTime)
          return res.status(400).json({ message: "startTime is required" });

        finalStart = toIsoString(startTime);
        finalEnd = endTime ? toIsoString(endTime) : null;

        if (eventType === "scheduled") {
          if (new Date(finalStart) <= new Date()) {
            return res.status(400).json({
              message: "Scheduled event startTime must be in the future",
            });
          }
        }
      }

      // ---------------- VOD ----------------
      let finalS3Key = null;
      let finalPrefix = null;

      if (eventType === "vod") {
        if (!s3Key)
          return res
            .status(400)
            .json({ message: "s3Key required for VOD" });

        finalS3Key = s3Key;
        finalPrefix =
          s3Prefix || s3Key.substring(0, s3Key.lastIndexOf("/") + 1);
      }

      // ---------------- ACCESS MODE ----------------
      let finalPasswordHash = null;
      let finalRegFields = null;
      let finalPayment = null;
      let finalCurrency = null;

      if (accessMode === "passwordAccess") {
        if (!accessPassword) {
          return res.status(400).json({ message: "Password required" });
        }

        finalRegFields = registrationFields || [];
      }


      if (accessMode === "emailAccess") {
        finalRegFields = registrationFields || [];
      }

      if (accessMode === "paidAccess") {
        finalPayment = Number(paymentAmount);
        finalCurrency = resolveCurrency(currency);
      }

      // ---------------- STATUS ----------------
      const status =
        eventType === "live"
          ? "live"
          : eventType === "scheduled"
            ? "scheduled"
            : "uploaded";

      // ---------------- SAVE ----------------
      const now = nowISO();
      const eventId = uuidv4();

      const item = {
        eventId,
        title,
        description,
        eventType,
        accessMode,
        status,

        startTime: finalStart,
        endTime: finalEnd,

        s3Key: finalS3Key,
        s3Prefix: finalPrefix,
        vodStatus: eventType === "vod" ? "UPLOADED" : null,

        videoConfig: videoConfig || {
          resolution: "1080p",
          frameRate: 30,
          bitrateProfile: "medium",
        },

        registrationFields: finalRegFields,

        accessPassword: finalPasswordHash,
        paymentAmount: finalPayment,
        currency: finalCurrency,

        createdBy,
        createdAt: now,
        updatedAt: now,
      };

      await ddbDocClient.send(
        new PutCommand({
          TableName: EVENTS_TABLE,
          Item: item,
        })
      );

      return res.status(201).json({
        success: true,
        eventId,
        message: "Event created successfully",
      });
    } catch (err) {
      console.error("Create Event Error:", err);
      return res.status(500).json({
        success: false,
        message: err.message,
      });
    }
  }



  // =====================================================
  // 3. LIST EVENTS (Search capable)
  // =====================================================
  static async listEvents(req, res) {
    try {
      let { q, type, limit = 20 } = req.query;
      limit = Number(limit);

      const raw = await ddbDocClient.send(
        new ScanCommand({ TableName: EVENTS_TABLE })
      );

      let events = raw.Items || [];

      if (q) {
        q = q.toLowerCase();
        events = events.filter(
          (e) =>
            e.title?.toLowerCase().includes(q) ||
            e.description?.toLowerCase().includes(q)
        );
      }

      if (type && EVENT_TYPES.has(type)) {
        events = events.filter((e) => e.eventType === type);
      }

      return res.status(200).json({
        success: true,
        count: events.length,
        events: events.slice(0, limit),
      });
    } catch (err) {
      console.error("List event error:", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // =====================================================
  // 4. GET EVENT
  // =====================================================
  static async getEventById(req, res) {
    try {
      const { eventId } = req.params;

      const result = await ddbDocClient.send(
        new GetCommand({
          TableName: EVENTS_TABLE,
          Key: { eventId },
        })
      );

      if (!result.Item)
        return res.status(404).json({ success: false, message: "Event not found" });

      return res.status(200).json({
        success: true,
        event: result.Item,
      });
    } catch (err) {
      console.error("Get event error:", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // =====================================================
  // 5. UPDATE EVENT (Updated for new frontend payload)
  // =====================================================
  static async updateEvent(req, res) {
    try {
      const { eventId } = req.params;
      const payload = req.body || {};

      const { Item: existing } = await ddbDocClient.send(
        new GetCommand({
          TableName: EVENTS_TABLE,
          Key: { eventId },
        })
      );

      if (!existing) {
        return res.status(404).json({ message: "Event not found" });
      }

      // --------------------------------------------------
      // ❌ eventType CANNOT be changed (for any event)
      // --------------------------------------------------
      if (payload.eventType && payload.eventType !== existing.eventType) {
        return res.status(400).json({
          message: "eventType cannot be changed",
        });
      }

      const updated = {
        ...existing,
        updatedAt: nowISO(),
      };

      // ==================================================
      // 1. TIME + VIDEO CONFIG (ONLY FOR SCHEDULED EVENTS)
      // ==================================================
      if (existing.eventType === "scheduled") {
        // ---- startTime ----
        if (payload.startTime) {
          const newStart = toIsoString(payload.startTime);
          if (new Date(newStart) <= new Date()) {
            return res.status(400).json({
              message: "Scheduled event startTime must be in the future",
            });
          }
          updated.startTime = newStart;
        }

        // ---- endTime ----
        if (payload.endTime) {
          updated.endTime = toIsoString(payload.endTime);
        }

        // ---- videoConfig ----
        if (payload.videoConfig) {
          const { resolution, frameRate, bitrateProfile } = payload.videoConfig;

          if (
            resolution &&
            !["1080p", "720p", "480p"].includes(resolution)
          ) {
            return res
              .status(400)
              .json({ message: "Invalid videoConfig.resolution" });
          }

          if (
            frameRate &&
            ![25, 30, 60].includes(Number(frameRate))
          ) {
            return res
              .status(400)
              .json({ message: "Invalid videoConfig.frameRate" });
          }

          if (
            bitrateProfile &&
            !["low", "medium", "high"].includes(bitrateProfile)
          ) {
            return res
              .status(400)
              .json({ message: "Invalid videoConfig.bitrateProfile" });
          }

          updated.videoConfig = {
            ...existing.videoConfig,
            ...payload.videoConfig,
          };
        }
      } else {
        // ------------------------------------------------
        // ❌ BLOCK time / videoConfig updates for LIVE/VOD
        // ------------------------------------------------
        if (payload.startTime || payload.endTime || payload.videoConfig) {
          return res.status(400).json({
            message:
              "startTime, endTime, and videoConfig can only be updated for scheduled events",
          });
        }
      }

      // ==================================================
      // 2. ACCESS MODE (ALLOWED FOR ALL EVENTS)
      // ==================================================
      if (payload.accessMode) {
        if (!ACCESS_MODES.has(payload.accessMode)) {
          return res.status(400).json({ message: "Invalid accessMode" });
        }
        updated.accessMode = payload.accessMode;
      }

      if (payload.registrationFields) {
        updated.registrationFields = payload.registrationFields;
      }

      // ---- password access ----
      if (payload.accessPassword) {
        updated.accessPassword = await bcrypt.hash(
          payload.accessPassword,
          SALT_ROUNDS
        );
      }

      if (payload.accessPasswordHash) {
        updated.accessPassword = payload.accessPasswordHash;
      }

      // ---- paid access ----
      if (payload.paymentAmount !== undefined) {
        updated.paymentAmount = Number(payload.paymentAmount);
      }

      if (payload.currency) {
        updated.currency = resolveCurrency(payload.currency);
      }

      // ==================================================
      // 3. SAFE META UPDATES
      // ==================================================
      if (payload.title) updated.title = payload.title;
      if (payload.description) updated.description = payload.description;

      // ==================================================
      // 4. SAVE
      // ==================================================
      await ddbDocClient.send(
        new PutCommand({
          TableName: EVENTS_TABLE,
          Item: updated,
        })
      );

      return res.status(200).json({
        success: true,
        message: "Event updated successfully",
        eventId,
      });
    } catch (err) {
      console.error("Update Event Error:", err);
      return res.status(500).json({
        success: false,
        message: err.message,
      });
    }
  }



  // =====================================================
  // 6. DELETE EVENT
  // =====================================================
  // static async deleteEvent(req, res) {
  //   try {
  //     const { eventId } = req.params;

  //     const response = await ddbDocClient.send(
  //       new DeleteCommand({
  //         TableName: EVENTS_TABLE,
  //         Key: { eventId },
  //         ReturnValues: "ALL_OLD",
  //       })
  //     );

  //     if (!response.Attributes)
  //       return res.status(404).json({ success: false, message: "Event not found" });

  //     return res.status(200).json({ success: true, message: "Event deleted" });
  //   } catch (err) {
  //     console.error("Delete event error:", err);
  //     return res.status(500).json({ success: false, message: err.message });
  //   }
  // }

  static async deleteEvent(req, res) {
    try {
      const { eventId } = req.params;

      const { Item: event } = await ddbDocClient.send(
        new GetCommand({
          TableName: EVENTS_TABLE,
          Key: { eventId },
        })
      );

      if (!event)
        return res.status(404).json({ success: false, message: "Event not found" });

      /* ---------- LIVE CLEANUP ---------- */
      if (event.eventType === "live") {
        if (event.mediaLiveChannelId) {
          await mediaLiveClient.send(
            new StopChannelCommand({ ChannelId: event.mediaLiveChannelId })
          );
          await mediaLiveClient.send(
            new DeleteChannelCommand({ ChannelId: event.mediaLiveChannelId })
          );
        }

        if (event.mediaLiveInputId) {
          await mediaLiveClient.send(
            new DeleteInputCommand({ InputId: event.mediaLiveInputId })
          );
        }

        if (event.mediaPackageChannelId) {
          await mediaPackageClient.send(
            new DeleteMediaPackageChannelCommand({
              Id: event.mediaPackageChannelId,
            })
          );
        }

        if (event.distributionId) {
          await deleteCloudFrontDistribution(event.distributionId);
        }

        if (event.s3RecordingBucket && event.s3RecordingPrefix) {
          await deleteS3Prefix(
            event.s3RecordingBucket,
            event.s3RecordingPrefix
          );
        }
      }

      /* ---------- VOD CLEANUP ---------- */
      if (event.eventType === "vod") {
        if (event.s3Prefix) {
          await deleteS3Prefix(VOD_BUCKET, event.s3Prefix);
        }
        if (event.vodOutputPath) {
          await deleteS3Prefix(VOD_BUCKET, event.vodOutputPath);
        }
      }

      await ddbDocClient.send(
        new DeleteCommand({
          TableName: EVENTS_TABLE,
          Key: { eventId },
        })
      );

      return res.status(200).json({
        success: true,
        message: "Event and all related resources deleted successfully",
      });
    } catch (err) {
      console.error("Delete event error:", err);
      return res.status(500).json({
        success: false,
        message: err.message || "Failed to delete event",
      });
    }
  }
}