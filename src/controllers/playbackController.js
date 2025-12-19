// src/controllers/playbackController.js

import {
  ddbDocClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
} from "../config/awsClients.js";

import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";

import { signViewerToken } from "../utils/viewerJwt.js";
import { sendPasswordFromServer } from "../utils/sendPasswordFromServer.js";

const EVENTS_TABLE =
  process.env.EVENTS_TABLE_NAME || "go-live-poc-events";
const VIEWERS_TABLE =
  process.env.VIEWERS_TABLE_NAME || "go-live-poc-viewers";

const nowISO = () => new Date().toISOString();

/* =========================================================
   STREAM RESOLUTION + TIME GATING
========================================================= */
function resolveStreamUrl(event) {
  const now = new Date();

  const startTime = event.startTime ? new Date(event.startTime) : null;
  const endTime = event.endTime ? new Date(event.endTime) : null;

  const liveUrl =
    event.cloudFrontUrl ||
    event.mediaPackageUrl ||
    null;

  const vodUrl =
    event.vodcloudFrontUrl ||
    event.vodCloudFrontUrl ||
    event.vod1080pUrl ||
    event.vod720pUrl ||
    event.vod480pUrl ||
    null;

  /* ---------------- SCHEDULED / LIVE ---------------- */
  if (event.eventType === "live" || event.eventType === "scheduled") {
    if (startTime && now < startTime) {
      return {
        blocked: true,
        reason: "Event has not started yet",
      };
    }

    if (endTime && now > endTime) {
      if (event.vodStatus === "READY" && vodUrl) {
        return { streamUrl: vodUrl, playbackType: "vod" };
      }

      return {
        blocked: true,
        reason: "Event has ended",
      };
    }

    if (liveUrl) {
      return { streamUrl: liveUrl, playbackType: "live" };
    }

    return {
      blocked: true,
      reason: "Live stream not available yet",
    };
  }

  /* ---------------- VOD ---------------- */
  if (event.eventType === "vod") {
    if (event.vodStatus === "READY" && vodUrl) {
      return { streamUrl: vodUrl, playbackType: "vod" };
    }

    return {
      blocked: true,
      reason: "VOD is still processing",
    };
  }

  return {
    blocked: true,
    reason: "Unsupported event type",
  };
}

/* =========================================================
   PLAYBACK CONTROLLER
========================================================= */
export default class PlaybackController {
  /* =====================================================
     GET ACCESS CONFIG
  ===================================================== */
static async getAccessConfig(req, res) {
  try {
    const { eventId } = req.params;
    if (!eventId) {
      return res.status(400).json({
        success: false,
        message: "eventId required",
      });
    }

    const { Item: event } = await ddbDocClient.send(
      new GetCommand({
        TableName: EVENTS_TABLE,
        Key: { eventId },
      })
    );

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    const accessMode = event.accessMode || "freeAccess";

    return res.status(200).json({
      success: true,
      accessMode,

      requiresForm:
        accessMode === "emailAccess" ||
        accessMode === "passwordAccess" ||
        accessMode === "paidAccess",

      requiresPassword: accessMode === "passwordAccess",

      registrationFields: event.registrationFields || [],

      // ✅ FIXED
      payment:
        accessMode === "paidAccess"
          ? {
              amount: Number(event.paymentAmount || 0),
              currency: event.currency || "USD",
            }
          : null,
    });
  } catch (err) {
    console.error("getAccessConfig error:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
}





  /* =====================================================
     REGISTER VIEWER
  ===================================================== */
static async registerViewer(req, res) {
  try {
    const { eventId } = req.params;
    const {
      clientViewerId,
      formData,
      name,
      email,
      deviceInfo,
      ipAddress,
    } = req.body || {};

    // ---------------- BASIC VALIDATION ----------------
    if (!eventId || !clientViewerId) {
      return res.status(400).json({
        success: false,
        message: "eventId and clientViewerId required",
      });
    }

    // ---------------- FETCH EVENT ----------------
    const { Item: event } = await ddbDocClient.send(
      new GetCommand({
        TableName: EVENTS_TABLE,
        Key: { eventId },
      })
    );

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    const now = nowISO();

    // ---------------- ACCESS RULES ----------------
    // Free + Email access = immediate playback
    const accessVerified =
      event.accessMode === "freeAccess" ||
      event.accessMode === "emailAccess";

    // ---------------- BUILD VIEWER ITEM ----------------
    const viewerItem = {
      eventId,
      clientViewerId,
      email: email || formData?.email || null,
      name: name || formData?.name || null,
      formData: formData || null,

      accessVerified,
      isPaidViewer: false,
      paymentStatus: "none",

      deviceType: deviceInfo?.deviceType || null,
      ipAddress: ipAddress || req.ip || null,

      firstJoinAt: now,
      lastJoinAt: now,
      totalSessions: 0,
      totalWatchTime: 0,

      createdAt: now,
      updatedAt: now,
    };

    // ---------------- SAVE / OVERWRITE VIEWER ----------------
    await ddbDocClient.send(
      new PutCommand({
        TableName: VIEWERS_TABLE,
        Item: viewerItem,
      })
    );

    // ---------------- PASSWORD ACCESS → EMAIL SAME EVENT PASSWORD ----------------
    if (event.accessMode === "passwordAccess") {
      const targetEmail = email || formData?.email;

      if (!targetEmail) {
        return res.status(400).json({
          success: false,
          message: "Email required for password access",
        });
      }

      if (!event.accessPassword) {
        return res.status(500).json({
          success: false,
          message: "Event password not configured",
        });
      }

      await sendPasswordFromServer({
        eventId,
        email: targetEmail,
        firstName: name || "",
        password: event.accessPassword, // SAME PASSWORD FOR ALL
        eventTitle: event.title,
      });
    }

    // ---------------- ISSUE VIEWER TOKEN ----------------
    const token = signViewerToken({
      eventId,
      clientViewerId,
      isPaidViewer: false,
    });

    // ---------------- RESPONSE ----------------
    return res.status(201).json({
      success: true,
      viewerToken: token,
      accessVerified,
      accessMode: event.accessMode,
    });
  } catch (err) {
    console.error("registerViewer error:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
}


  /* =====================================================
     VERIFY PASSWORD
  ===================================================== */
static async verifyPassword(req, res) {
  try {
    const { eventId } = req.params;
    const { clientViewerId, password } = req.body || {};

    // ---------------- BASIC VALIDATION ----------------
    if (!eventId || !clientViewerId || !password) {
      return res.status(400).json({
        success: false,
        message: "Missing parameters",
      });
    }

    // ---------------- FETCH EVENT ----------------
    const { Item: event } = await ddbDocClient.send(
      new GetCommand({
        TableName: EVENTS_TABLE,
        Key: { eventId },
      })
    );

    if (!event || event.accessMode !== "passwordAccess") {
      return res.status(400).json({
        success: false,
        message: "Invalid event access mode",
      });
    }

    // ---------------- PASSWORD CHECK (PLAIN TEXT) ----------------
    if (password !== event.accessPassword) {
      return res.status(401).json({
        success: false,
        message: "Invalid password",
      });
    }

    // ---------------- MARK VIEWER AS VERIFIED ----------------
    await ddbDocClient.send(
      new UpdateCommand({
        TableName: VIEWERS_TABLE,
        Key: { eventId, clientViewerId },
        UpdateExpression:
          "SET accessVerified = :t, updatedAt = :u",
        ExpressionAttributeValues: {
          ":t": true,
          ":u": nowISO(),
        },
      })
    );

    // ---------------- RESPONSE ----------------
    return res.status(200).json({
      success: true,
      accessVerified: true,
    });
  } catch (err) {
    console.error("verifyPassword error:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
}


  /* =====================================================
     GET STREAM
  ===================================================== */
  static async getStream(req, res) {
    try {
      const { eventId } = req.params;
      const { eventId: tokenEventId, clientViewerId } = req.viewer;

      if (eventId !== tokenEventId) {
        return res.status(403).json({
          success: false,
          message: "Event mismatch",
        });
      }

      const { Item: viewer } = await ddbDocClient.send(
        new GetCommand({
          TableName: VIEWERS_TABLE,
          Key: { eventId, clientViewerId },
        })
      );

      if (!viewer) {
        return res.status(403).json({
          success: false,
          message: "Viewer not authorized",
        });
      }

      const { Item: event } = await ddbDocClient.send(
        new GetCommand({
          TableName: EVENTS_TABLE,
          Key: { eventId },
        })
      );

      if (!event) {
        return res.status(404).json({
          success: false,
          message: "Event not found",
        });
      }

      /* ACCESS ENFORCEMENT */
      if (
        (event.accessMode === "emailAccess" ||
          event.accessMode === "passwordAccess") &&
        !viewer.accessVerified
      ) {
        return res.status(403).json({
          success: false,
          message: "Access not verified",
        });
      }

      if (event.accessMode === "paidAccess" && !viewer.isPaidViewer) {
        return res.status(402).json({
          success: false,
          message: "Payment required",
        });
      }

      const resolved = resolveStreamUrl(event);

      if (resolved.blocked) {
        return res.status(403).json({
          success: false,
          message: resolved.reason,
        });
      }

      await ddbDocClient.send(
        new UpdateCommand({
          TableName: VIEWERS_TABLE,
          Key: { eventId, clientViewerId },
          UpdateExpression:
            "SET lastJoinAt = :t, updatedAt = :t",
          ExpressionAttributeValues: {
            ":t": nowISO(),
          },
        })
      );

      return res.status(200).json({
        success: true,
        streamUrl: resolved.streamUrl,
        playbackType: resolved.playbackType,
        eventType: event.eventType,
      });
    } catch (err) {
      console.error("getStream error:", err);
      return res.status(500).json({
        success: false,
        message: err.message,
      });
    }
  }
}
