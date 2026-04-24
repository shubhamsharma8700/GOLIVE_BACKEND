import {
  MediaLiveClient,
  StopChannelCommand,
  DeleteChannelCommand,
  DeleteInputCommand,
  DeleteInputSecurityGroupCommand,
  DescribeChannelCommand
} from "@aws-sdk/client-medialive";

import {
  MediaPackageClient,
  DeleteChannelCommand as DeleteMPChannelCommand,
  DeleteOriginEndpointCommand
} from "@aws-sdk/client-mediapackage";

import {
  CloudFrontClient,
  GetDistributionConfigCommand,
  UpdateDistributionCommand
} from "@aws-sdk/client-cloudfront";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

/* ===================== CONFIG ===================== */

const REGION = process.env.AWS_REGION || "ap-south-1";
const EVENTS_TABLE = process.env.EVENTS_TABLE;

const medialive = new MediaLiveClient({ region: REGION });
const mediapackage = new MediaPackageClient({ region: REGION });
const cloudfront = new CloudFrontClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION })
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ===================== HELPERS ===================== */

const deleteInputWithRetry = async (inputId) => {
  const MAX_RETRIES = 10;
  const WAIT_MS = 10000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`🧹 Attempt ${attempt}: Deleting MediaLive Input ${inputId}`);
      await medialive.send(new DeleteInputCommand({ InputId: inputId }));
      console.log("✅ MediaLive Input deleted");
      return;
    } catch (err) {
      if (err.name === "ConflictException" && attempt < MAX_RETRIES) {
        console.log(`⏳ Input BUSY, retrying in ${WAIT_MS / 1000}s`);
        await sleep(WAIT_MS);
      } else if (err.name === "NotFoundException") {
        console.log("ℹ️ MediaLive Input already deleted");
        return;
      } else {
        throw err;
      }
    }
  }

  throw new Error("MediaLive Input delete retries exhausted");
};

/* ===================== HANDLER ===================== */

export const handler = async (event) => {
  const { eventId } = event;
  if (!eventId) {
    return { statusCode: 400, message: "Missing eventId" };
  }

  console.log("🧹 SAFE DELETE STARTED:", eventId);

  try {
    /* =====================================================
       1️⃣ FETCH EVENT FROM DYNAMODB
    ===================================================== */
    const { Item } = await ddb.send(
      new GetCommand({
        TableName: EVENTS_TABLE,
        Key: { eventId }
      })
    );

    if (!Item) {
      throw new Error("Event not found in DynamoDB");
    }

    const {
      mediaLiveChannelId,
      mediaLiveInputId,
      mediaLiveInputSecurityGroupId,
      mediaPackageChannelId,
      mediaPackageEndpointId,
      distributionId,
      originId,
      cacheBehaviorIds
    } = Item;

    //behaviour list 
    const cacheBehaviorIdList = Array.isArray(cacheBehaviorIds)
      ? cacheBehaviorIds
      : cacheBehaviorIds instanceof Set
        ? [...cacheBehaviorIds]
        : cacheBehaviorIds?.values
          ? cacheBehaviorIds.values
          : Object.values(cacheBehaviorIds || {}).flat();


    /* =====================================================
       2️⃣ STOP + DELETE MEDIALIVE CHANNEL
    ===================================================== */
    if (mediaLiveChannelId) {
      try {
        const desc = await medialive.send(
          new DescribeChannelCommand({ ChannelId: mediaLiveChannelId })
        );

        if (["RUNNING", "STARTING"].includes(desc.State)) {
          await medialive.send(
            new StopChannelCommand({ ChannelId: mediaLiveChannelId })
          );

          for (let i = 0; i < 30; i++) {
            const state = await medialive.send(
              new DescribeChannelCommand({ ChannelId: mediaLiveChannelId })
            );
            if (["IDLE", "STOPPED"].includes(state.State)) break;
            await sleep(5000);
          }
        }
      } catch (err) {
        if (err.name !== "NotFoundException") throw err;
      }

      try {
        await medialive.send(
          new DeleteChannelCommand({ ChannelId: mediaLiveChannelId })
        );
      } catch (err) {
        if (err.name !== "NotFoundException") throw err;
      }

      await sleep(10000);
    }

    /* =====================================================
       3️⃣ DELETE MEDIALIVE INPUT
    ===================================================== */
    if (mediaLiveInputId) {
      await deleteInputWithRetry(mediaLiveInputId);
    }

    /* =====================================================
       4️⃣ DELETE INPUT SECURITY GROUP
    ===================================================== */
    if (mediaLiveInputSecurityGroupId) {
      try {
        await medialive.send(
          new DeleteInputSecurityGroupCommand({
            InputSecurityGroupId: mediaLiveInputSecurityGroupId
          })
        );
      } catch (err) {
        if (err.name !== "NotFoundException") throw err;
      }
    }

    /* =====================================================
       5️⃣ DELETE MEDIAPACKAGE ENDPOINT
    ===================================================== */
    if (mediaPackageEndpointId) {
      try {
        await mediapackage.send(
          new DeleteOriginEndpointCommand({ Id: mediaPackageEndpointId })
        );
      } catch (err) {
        if (err.name !== "NotFoundException") throw err;
      }
    }

    /* =====================================================
       6️⃣ DELETE MEDIAPACKAGE CHANNEL
    ===================================================== */
    if (mediaPackageChannelId) {
      try {
        await mediapackage.send(
          new DeleteMPChannelCommand({ Id: mediaPackageChannelId })
        );
      } catch (err) {
        if (err.name !== "NotFoundException") throw err;
      }
    }

    /* =====================================================
       7️⃣ CLOUDFRONT (FIXED – TWO PHASE DELETE)
    ===================================================== */
    if (distributionId && originId && cacheBehaviorIdList.length) {
      console.log("🌍 Removing CloudFront cache behaviors");

      /* ---- PHASE 1: REMOVE CACHE BEHAVIORS ---- */
      const { DistributionConfig, ETag } =
        await cloudfront.send(
          new GetDistributionConfigCommand({ Id: distributionId })
        );

      DistributionConfig.CacheBehaviors.Items =
        DistributionConfig.CacheBehaviors.Items.filter(
          b => !cacheBehaviorIdList.includes(b.PathPattern)
        );

      DistributionConfig.CacheBehaviors.Quantity =
        DistributionConfig.CacheBehaviors.Items.length;

      await cloudfront.send(
        new UpdateDistributionCommand({
          Id: distributionId,
          IfMatch: ETag,
          DistributionConfig
        })
      );

      console.log("✅ Cache behaviors removed");
      await sleep(15000);

      /* ---- PHASE 2: REMOVE ORIGIN ---- */
      const updated = await cloudfront.send(
        new GetDistributionConfigCommand({ Id: distributionId })
      );

      const fallbackOrigin =
        updated.DistributionConfig.Origins.Items.find(
          o => o.Id !== originId
        );

      if (fallbackOrigin) {
        if (
          updated.DistributionConfig.DefaultCacheBehavior.TargetOriginId === originId
        ) {
          updated.DistributionConfig.DefaultCacheBehavior.TargetOriginId =
            fallbackOrigin.Id;
        }

        updated.DistributionConfig.Origins.Items =
          updated.DistributionConfig.Origins.Items.filter(
            o => o.Id !== originId
          );

        updated.DistributionConfig.Origins.Quantity =
          updated.DistributionConfig.Origins.Items.length;

        await cloudfront.send(
          new UpdateDistributionCommand({
            Id: distributionId,
            IfMatch: updated.ETag,
            DistributionConfig: updated.DistributionConfig
          })
        );

        console.log("✅ Origin removed safely");
      }
    }

    /* =====================================================
   8️⃣ UPDATE DYNAMODB – MARK RESOURCES AS DELETED
    ===================================================== */
    await ddb.send(
      new UpdateCommand({
        TableName: EVENTS_TABLE,
        Key: { eventId },
        UpdateExpression: "SET resourcesDeleted = :val, deletedAt = :ts",
        ExpressionAttributeValues: {
          ":val": true,
          ":ts": new Date().toISOString()
        }
      })
    );

    return {
      statusCode: 200,
      message: "Pipeline deleted successfully"
    };

  } catch (err) {
    console.error("❌ SAFE DELETE FAILED:", err);
    return { statusCode: 500, message: err.message };
  } finally {
    console.log("🧹 SAFE DELETE FINISHED:", eventId);
  }
};
