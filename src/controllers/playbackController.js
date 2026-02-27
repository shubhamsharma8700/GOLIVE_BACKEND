// src/controllers/playbackController.js

import {
  ddbDocClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  QueryCommand,
} from "../config/awsClients.js";
import crypto from "crypto";

import { extractViewerContext } from "../utils/cloudfrontHeaders.js";

import { signViewerToken, verifyViewerToken } from "../utils/viewerJwt.js";
import { sendPasswordFromServer } from "../utils/sendPasswordFromServer.js";

const EVENTS_TABLE =
  process.env.EVENTS_TABLE_NAME || "go-live-poc-events";
const VIEWERS_TABLE =
  process.env.VIEWERS_TABLE_NAME || "go-live-poc-viewers";

const nowISO = () => new Date().toISOString();

const REGISTRATION_REQUIRED_ACCESS_MODES = new Set([
  "emailAccess",
  "passwordAccess",
  "paidAccess",
]);

const safeString = (value) => String(value || "").trim();

const normalizeValue = (value) => safeString(value).toLowerCase();

const normalizeFormData = (formData) => {
  if (!formData || typeof formData !== "object") return {};

  return Object.keys(formData)
    .sort()
    .reduce((acc, key) => {
      const normalizedKey = safeString(key);
      if (!normalizedKey) return acc;
      const normalizedVal = safeString(formData[key]);
      if (!normalizedVal) return acc;
      acc[normalizedKey] = normalizedVal;
      return acc;
    }, {});
};

const buildRegistrationIdentityKey = ({ formData, name, email }) => {
  const normalizedFormData = normalizeFormData(formData);
  const normalizedName = normalizeValue(name || normalizedFormData.name);
  const normalizedEmail = normalizeValue(email || normalizedFormData.email);

  const payload = {
    name: normalizedName || "",
    email: normalizedEmail || "",
    fields: normalizedFormData,
  };

  const hasIdentityData =
    Boolean(payload.name) ||
    Boolean(payload.email) ||
    Object.keys(payload.fields).length > 0;

  if (!hasIdentityData) {
    return {
      registrationIdentityKey: null,
      normalizedEmail: null,
      normalizedName: null,
      normalizedFormData,
    };
  }

  const registrationIdentityKey = crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");

  return {
    registrationIdentityKey,
    normalizedEmail: payload.email || null,
    normalizedName: payload.name || null,
    normalizedFormData,
  };
};

const hasAccessForMode = (accessMode, viewer) => {
  if (!viewer) return false;
  if (accessMode === "freeAccess" || accessMode === "emailAccess") {
    return true;
  }
  if (accessMode === "passwordAccess") {
    return viewer.accessVerified === true;
  }
  if (accessMode === "paidAccess") {
    return viewer.isPaidViewer === true;
  }
  return false;
};

const deriveStepState = (accessMode, viewer) => {
  const formSubmitted =
    accessMode === "freeAccess"
      ? true
      : Boolean(viewer?.formData || viewer?.email || viewer?.name);

  const passwordVerified =
    accessMode === "passwordAccess"
      ? viewer?.accessVerified === true
      : accessMode === "paidAccess"
        ? viewer?.passwordVerified === true
        : true;

  const paymentVerified =
    accessMode === "paidAccess" ? viewer?.isPaidViewer === true : true;

  const registrationComplete =
    formSubmitted && passwordVerified && paymentVerified;

  return {
    formSubmitted,
    passwordVerified,
    paymentVerified,
    registrationComplete,
    accessGranted: hasAccessForMode(accessMode, viewer),
  };
};

async function queryAllViewersByEventId(eventId) {
  const allItems = [];
  let lastEvaluatedKey;

  do {
    const result = await ddbDocClient.send(
      new QueryCommand({
        TableName: VIEWERS_TABLE,
        KeyConditionExpression: "eventId = :eid",
        ExpressionAttributeValues: {
          ":eid": eventId,
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (result.Items?.length) {
      allItems.push(...result.Items);
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return allItems;
}

async function findViewerByIdentity({
  eventId,
  registrationIdentityKey,
  normalizedEmail,
}) {
  if (!registrationIdentityKey && !normalizedEmail) return null;

  const viewers = await queryAllViewersByEventId(eventId);
  const matched = viewers.filter((viewer) => {
    if (registrationIdentityKey && viewer?.registrationIdentityKey === registrationIdentityKey) {
      return true;
    }
    if (normalizedEmail && viewer?.normalizedEmail === normalizedEmail) {
      return true;
    }
    return false;
  });

  if (!matched.length) return null;

  matched.sort((a, b) => {
    const rank = (row) =>
      (row?.isPaidViewer ? 100 : 0) +
      (row?.registrationComplete ? 10 : 0) +
      (row?.accessVerified ? 5 : 0);
    const rankDiff = rank(b) - rank(a);
    if (rankDiff !== 0) return rankDiff;
    const bTs = new Date(b?.updatedAt || 0).getTime();
    const aTs = new Date(a?.updatedAt || 0).getTime();
    return bTs - aTs;
  });

  return matched[0];
}

function resolveViewerIdFromRequest(req) {
  const fromBody = safeString(req.body?.clientViewerId);
  if (fromBody) return fromBody;

  const fromBodyToken = safeString(req.body?.viewerToken);
  const fromAuthHeader = safeString(req.headers.authorization || req.headers["x-viewer-token"]);
  const rawToken = fromBodyToken || fromAuthHeader.replace(/^Bearer\s+/i, "");

  if (!rawToken) return null;

  try {
    const payload = verifyViewerToken(rawToken);
    return safeString(payload?.clientViewerId) || null;
  } catch {
    return null;
  }
}

/* =========================================================
   STREAM RESOLUTION + TIME GATING
========================================================= */
function resolveStreamUrl(event) {
  const now = new Date();

  const startTime = event.startTime ? new Date(event.startTime) : null;

  const liveUrl =
    event.cloudFrontUrl ||
    event.mediaPackageUrl ||
    null;

  const vodUrl =
    event.vodCloudFrontUrl ||
    event.vod1080pUrl ||
    event.vod720pUrl ||
    event.vod480pUrl ||
    null;

  const isVodReady = event.vodStatus === "READY";

  /* ---------------- LIVE ---------------- */
  if (event.eventType === "live") {
    // ✅ Once VOD is ready → ALWAYS switch to VOD
    if (isVodReady && vodUrl) {
      return { streamUrl: vodUrl, playbackType: "vod" };
    }

    // ✅ Otherwise allow LIVE if URL exists
    if (liveUrl) {
      return { streamUrl: liveUrl, playbackType: "live" };
    }

    return {
      blocked: true,
      reason: "Live stream not available",
    };
  }

  /* ---------------- SCHEDULED ---------------- */
  if (event.eventType === "scheduled") {
    // ❌ Before scheduled start
    if (startTime && now < startTime) {
      return {
        blocked: true,
        reason: "Event has not started yet",
      };
    }

    // ✅ After live stops → VOD only when ready
    if (isVodReady && vodUrl) {
      return { streamUrl: vodUrl, playbackType: "vod" };
    }

    // ✅ During scheduled live window
    if (liveUrl) {
      return { streamUrl: liveUrl, playbackType: "live" };
    }

    return {
      blocked: true,
      reason: "Live stream not available",
    };
  }

  /* ---------------- VOD ---------------- */
  if (event.eventType === "vod") {
    if (isVodReady && vodUrl) {
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

        requiresPassword:
          accessMode === "passwordAccess" || accessMode === "paidAccess",

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
      const { clientViewerId, formData, name, email, deviceInfo } = req.body || {};
      if (!eventId || !clientViewerId) {
        return res.status(400).json({
          success: false,
          message: "eventId and clientViewerId required",
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
      const now = nowISO();
      const accessMode = event.accessMode || "freeAccess";
      const requiresRegistrationData = REGISTRATION_REQUIRED_ACCESS_MODES.has(accessMode);
      const submittedEmail = safeString(email || formData?.email) || null;
      // const submittedName = safeString(name || `${formData?.firstName} ${formData?.lastName}`) || null;
      const submittedName = formData?.firstName
        ? safeString(`${formData.firstName} ${formData?.lastName || ""}`.trim())
        : null;
      const {
        registrationIdentityKey,
        normalizedEmail,
        normalizedName,
        normalizedFormData,
      } = buildRegistrationIdentityKey({
        formData,
        name: submittedName,
        email: submittedEmail,
      });
      if (
        requiresRegistrationData &&
        !submittedEmail &&
        !submittedName &&
        Object.keys(normalizedFormData).length === 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Registration details are required for this access mode",
        });
      }
      const viewerContext = extractViewerContext(req);
      const { Item: existingByClient } = await ddbDocClient.send(
        new GetCommand({
          TableName: VIEWERS_TABLE,
          Key: { eventId, clientViewerId },
        })
      );
      let matchedByIdentity = null;
      if (!existingByClient && (registrationIdentityKey || normalizedEmail)) {
        matchedByIdentity = await findViewerByIdentity({
          eventId,
          registrationIdentityKey,
          normalizedEmail,
        });
      }
      const reusableIdentityViewer =
        matchedByIdentity && hasAccessForMode(accessMode, matchedByIdentity)
          ? matchedByIdentity
          : null;
      if (reusableIdentityViewer) {
        const reuseViewer = {
          ...reusableIdentityViewer,
          formData:
            Object.keys(normalizedFormData).length > 0
              ? normalizedFormData
              : reusableIdentityViewer.formData || null,
          email: submittedEmail || reusableIdentityViewer.email || null,
          normalizedEmail:
            normalizeValue(submittedEmail || reusableIdentityViewer.email) || null,
          name: submittedName || reusableIdentityViewer.name || null,
          normalizedName:
            normalizeValue(submittedName || reusableIdentityViewer.name) || null,
          device: {
            deviceType: deviceInfo?.deviceType || reusableIdentityViewer.device?.deviceType || null,
            userAgent: deviceInfo?.userAgent || reusableIdentityViewer.device?.userAgent || null,
            browser: deviceInfo?.browser || reusableIdentityViewer.device?.browser || null,
            os: deviceInfo?.os || reusableIdentityViewer.device?.os || null,
            screen: deviceInfo?.screen || reusableIdentityViewer.device?.screen || null,
            timezone: deviceInfo?.timezone || reusableIdentityViewer.device?.timezone || null,
          },
          network: viewerContext,
          registrationIdentityKey:
            registrationIdentityKey || reusableIdentityViewer.registrationIdentityKey || null,
          updatedAt: now,
        };
        const stepState = deriveStepState(accessMode, reuseViewer);
        reuseViewer.registrationComplete = stepState.registrationComplete;
        await ddbDocClient.send(
          new PutCommand({
            TableName: VIEWERS_TABLE,
            Item: reuseViewer,
          })
        );
        const token = signViewerToken({
          eventId,
          clientViewerId: reuseViewer.clientViewerId,
          isPaidViewer: Boolean(reuseViewer.isPaidViewer),
        });
        return res.status(200).json({
          success: true,
          reusedExistingViewer: true,
          viewerToken: token,
          resolvedClientViewerId: reuseViewer.clientViewerId,
          accessVerified: stepState.accessGranted,
          accessMode,
          steps: {
            formSubmitted: stepState.formSubmitted,
            passwordVerified: stepState.passwordVerified,
            paymentVerified: stepState.paymentVerified,
            registrationComplete: stepState.registrationComplete,
          },
        });
      }
      const baseViewer = existingByClient || {};
      const isPaidViewer = baseViewer.isPaidViewer === true;
      const passwordVerified = baseViewer.passwordVerified === true;
      const paymentStatus = baseViewer.paymentStatus || "none";
      const accessVerified =
        accessMode === "freeAccess" ||
        accessMode === "emailAccess" ||
        (accessMode === "passwordAccess" && baseViewer.accessVerified === true) ||
        (accessMode === "paidAccess" && isPaidViewer);
      const viewerItem = {
        eventId,
        clientViewerId,
        email: submittedEmail,
        normalizedEmail,
        name: submittedName,
        normalizedName,
        formData:
          Object.keys(normalizedFormData).length > 0
            ? normalizedFormData
            : null,
        registrationIdentityKey,
        accessVerified,
        passwordVerified,
        passwordVerifiedAt: baseViewer.passwordVerifiedAt || null,
        isPaidViewer,
        viewerpaid: isPaidViewer,
        paymentStatus,
        device: {
          deviceType: deviceInfo?.deviceType || baseViewer.device?.deviceType || null,
          userAgent: deviceInfo?.userAgent || baseViewer.device?.userAgent || null,
          browser: deviceInfo?.browser || baseViewer.device?.browser || null,
          os: deviceInfo?.os || baseViewer.device?.os || null,
          screen: deviceInfo?.screen || baseViewer.device?.screen || null,
          timezone: deviceInfo?.timezone || baseViewer.device?.timezone || null,
        },
        network: viewerContext,
        firstJoinAt: baseViewer.firstJoinAt || now,
        lastJoinAt: now,
        totalSessions: Number(baseViewer.totalSessions || 0),
        totalWatchTime: Number(baseViewer.totalWatchTime || 0),
        createdAt: baseViewer.createdAt || now,
        updatedAt: now,
      };
      const stepState = deriveStepState(accessMode, viewerItem);
      viewerItem.registrationComplete = stepState.registrationComplete;
      if (stepState.registrationComplete && !baseViewer.registrationCompletedAt) {
        viewerItem.registrationCompletedAt = now;
      } else {
        viewerItem.registrationCompletedAt = baseViewer.registrationCompletedAt || null;
      }
      await ddbDocClient.send(
        new PutCommand({
          TableName: VIEWERS_TABLE,
          Item: viewerItem,
        })
      );
      const mustHandlePassword =
        (accessMode === "passwordAccess" || accessMode === "paidAccess") &&
        !viewerItem.passwordVerified;
      if (mustHandlePassword) {
        if (!event.accessPassword) {
          return res.status(400).json({
            success: false,
            message: "Event password not configured",
          });
        }
        if (submittedEmail) {
          await sendPasswordFromServer({
            eventId,
            email: submittedEmail,
            firstName: submittedName || "",
            password: event.accessPassword,
            eventTitle: event.title,
          });
        }
      }
      const token = signViewerToken({
        eventId,
        clientViewerId,
        isPaidViewer,
      });
      return res.status(existingByClient ? 200 : 201).json({
        success: true,
        viewerToken: token,
        resolvedClientViewerId: clientViewerId,
        accessVerified: stepState.accessGranted,
        accessMode,
        steps: {
          formSubmitted: stepState.formSubmitted,
          passwordVerified: stepState.passwordVerified,
          paymentVerified: stepState.paymentVerified,
          registrationComplete: stepState.registrationComplete,
        },
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
      const { password } = req.body || {};
      const clientViewerId = resolveViewerIdFromRequest(req);
      if (!eventId || !clientViewerId || !password) {
        return res.status(400).json({
          success: false,
          message: "Missing parameters",
        });
      }
      const { Item: event } = await ddbDocClient.send(
        new GetCommand({
          TableName: EVENTS_TABLE,
          Key: { eventId },
        })
      );
      const allowedAccessModes = ["passwordAccess", "paidAccess"];
      if (!event || !allowedAccessModes.includes(event.accessMode)) {
        return res.status(400).json({
          success: false,
          message: "Invalid event access mode",
        });
      }
      if (!event.accessPassword) {
        return res.status(400).json({
          success: false,
          message: "Event password not configured",
        });
      }
      if (password !== event.accessPassword) {
        return res.status(401).json({
          success: false,
          message: "Invalid password",
        });
      }
      const { Item: viewer } = await ddbDocClient.send(
        new GetCommand({
          TableName: VIEWERS_TABLE,
          Key: { eventId, clientViewerId },
        })
      );
      if (!viewer) {
        return res.status(404).json({
          success: false,
          message: "Viewer registration not found",
        });
      }
      const now = nowISO();
      const accessVerified =
        event.accessMode === "passwordAccess"
          ? true
          : viewer.isPaidViewer === true;
      const registrationComplete =
        event.accessMode === "passwordAccess"
          ? true
          : viewer.isPaidViewer === true;
      await ddbDocClient.send(
        new UpdateCommand({
          TableName: VIEWERS_TABLE,
          Key: { eventId, clientViewerId },
          UpdateExpression:
            "SET accessVerified = :accessVerified, passwordVerified = :passwordVerified, passwordVerifiedAt = :passwordVerifiedAt, registrationComplete = :registrationComplete, registrationCompletedAt = :registrationCompletedAt, updatedAt = :u",
          ExpressionAttributeValues: {
            ":accessVerified": accessVerified,
            ":passwordVerified": true,
            ":passwordVerifiedAt": now,
            ":registrationComplete": registrationComplete,
            ":registrationCompletedAt": registrationComplete
              ? now
              : viewer.registrationCompletedAt || null,
            ":u": now,
          },
        })
      );
      return res.status(200).json({
        success: true,
        accessVerified,
        passwordVerified: true,
        registrationComplete,
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

