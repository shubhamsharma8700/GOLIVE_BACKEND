import crypto from "crypto";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDocClient } from "../config/awsClients.js";

// DynamoDB table name
const EVENTS_TABLE =
  process.env.EVENTS_TABLE_NAME || "go-live-poc-events";

// CloudFront signing config
const CF_KEY_PAIR_ID = process.env.CLOUDFRONT_KEY_PAIR_ID;
const CF_PRIVATE_KEY = process.env.CLOUDFRONT_PRIVATE_KEY;

// 20 years (treated as permanent)
const TWENTY_YEARS_IN_SECONDS = 60 * 60 * 24 * 365 * 20;

/**
 * Generate CloudFront signed URL (long-lived)
 */
function generateSignedCloudFrontUrl(url) {
  if (!CF_KEY_PAIR_ID || !CF_PRIVATE_KEY) {
    throw new Error("CloudFront signing keys are not configured");
  }

  const expires =
    Math.floor(Date.now() / 1000) + TWENTY_YEARS_IN_SECONDS;

  const policy = JSON.stringify({
    Statement: [
      {
        Resource: url,
        Condition: {
          DateLessThan: {
            "AWS:EpochTime": expires,
          },
        },
      },
    ],
  });

  const signer = crypto.createSign("RSA-SHA1");
  signer.update(policy);
  signer.end();

  const signature = signer.sign(CF_PRIVATE_KEY, "base64");

  const encodedSignature = signature
    .replace(/\+/g, "-")
    .replace(/=/g, "_")
    .replace(/\//g, "~");

  return (
    `${url}` +
    `?Expires=${expires}` +
    `&Signature=${encodedSignature}` +
    `&Key-Pair-Id=${CF_KEY_PAIR_ID}`
  );
}

/**
 * ADMIN API
 * Generate a permanent (long-lived) VOD share link
 */
export async function generatePermanentVodLink(req, res) {
  try {
    const { eventId } = req.params;

    if (!eventId) {
      return res.status(400).json({
        success: false,
        message: "eventId is required",
      });
    }

    // 1️⃣ Fetch event from DynamoDB
    const result = await ddbDocClient.send(
      new GetCommand({
        TableName: EVENTS_TABLE,
        Key: { eventId },
      })
    );

    const event = result.Item;

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    // 2️⃣ READ VOD URL FROM videoConfig (YOUR STRUCTURE)
    const vodUrl =
      event.videoConfig?.vodCloudFrontUrl ||
      event.videoConfig?.vod1080pUrl ||
      event.videoConfig?.vod720pUrl ||
      event.videoConfig?.vod480pUrl;

    if (!vodUrl) {
      return res.status(400).json({
        success: false,
        message: "VOD URL not found in videoConfig",
      });
    }

    // 3️⃣ Generate signed CloudFront URL
    const signedUrl = generateSignedCloudFrontUrl(vodUrl);

    // 4️⃣ Return response
    return res.status(200).json({
      success: true,
      eventId,
      shareUrl: signedUrl,
      note: "This link is valid for ~20 years (treated as permanent)",
    });
  } catch (error) {
    console.error("generatePermanentVodLink error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to generate permanent VOD link",
    });
  }
}
