import {
  MediaConvertClient,
  GetJobCommand
} from "@aws-sdk/client-mediaconvert";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";

const MEDIACONVERT_ENDPOINT =
  process.env.MEDIACONVERT_ENDPOINT ||
  "https://mediaconvert.ap-south-1.amazonaws.com";
const DYNAMODB_TABLE = process.env.EVENTS_TABLE_NAME || "go-live-poc-events";

const mediaconvert = new MediaConvertClient({
  endpoint: MEDIACONVERT_ENDPOINT,
  maxAttempts: 3,
  requestTimeout: 30000
});

const ddbClient = new DynamoDBClient({
  maxAttempts: 3,
  requestTimeout: 10000
});

const ddbDocClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: true,
  },
});

function extractOutputDestination(job) {
  const groups = job?.Settings?.OutputGroups || [];

  for (const group of groups) {
    const settings = group?.OutputGroupSettings || {};
    if (settings.HlsGroupSettings?.Destination) {
      return settings.HlsGroupSettings.Destination;
    }
    if (settings.FileGroupSettings?.Destination) {
      return settings.FileGroupSettings.Destination;
    }
  }

  return "";
}

function inferJobDetails(job) {
  const metadata = job?.UserMetadata || {};
  const outputUrl = extractOutputDestination(job);

  let jobType = metadata.jobType;
  let eventId = metadata.eventId;
  const trimRequestId = metadata.trimRequestId;

  if (!eventId) {
    const eventIdMatch = outputUrl.match(/(?:vod-output|trimmed)\/([^\/]+)\//);
    eventId = eventIdMatch?.[1];
  }

  if (!jobType) {
    if (outputUrl.includes("/trimmed/")) {
      jobType = "trim";
    } else if (outputUrl.includes("/vod-output/")) {
      jobType = "vod";
    }
  }

  return { eventId, jobType, trimRequestId, outputUrl };
}

function upsertTrimDetail(trimDetails, trimRequestId, patch) {
  const list = Array.isArray(trimDetails) ? [...trimDetails] : [];
  const index = list.findIndex((detail) => detail?.trimRequestId === trimRequestId);

  if (index >= 0) {
    list[index] = {
      ...list[index],
      ...patch,
    };
    return list;
  }

  return [...list, { trimRequestId, ...patch }];
}

export const handler = async (event) => {
  console.log("Received MediaConvert event:", JSON.stringify(event, null, 2));

  try {
    const detail = event.detail || {};
    const jobId = detail.jobId;
    const status = detail.status;

    if (!jobId || !status) {
      throw new Error("jobId and status are required in MediaConvert event");
    }

    const jobResponse = await mediaconvert.send(
      new GetJobCommand({ Id: jobId })
    );

    const job = jobResponse.Job;
    const { eventId, jobType, trimRequestId, outputUrl } = inferJobDetails(job);

    if (!eventId || !jobType) {
      console.error("Could not resolve eventId/jobType from job:", outputUrl);
      return { statusCode: 400, body: "Unable to resolve MediaConvert job" };
    }

    if (jobType === "vod") {
      let vodStatus = status;
      const expressionValues = {
        ":vodStatus": status
      };
      let updateExpression = "SET vodStatus = :vodStatus";

      if (status === "COMPLETE") {
        vodStatus = "READY";
        expressionValues[":vodStatus"] = vodStatus;
        updateExpression += ", vodReadyAt = :readyAt";
        expressionValues[":readyAt"] = new Date().toISOString();
      } else if (status === "ERROR" || status === "CANCELED") {
        updateExpression += ", vodError = :error, vodErrorTime = :errorTime";
        expressionValues[":error"] = job?.ErrorMessage || "Unknown error";
        expressionValues[":errorTime"] = new Date().toISOString();
      }

      await ddbDocClient.send(
        new UpdateCommand({
          TableName: DYNAMODB_TABLE,
          Key: { eventId },
          UpdateExpression: updateExpression,
          ExpressionAttributeValues: expressionValues
        })
      );

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: "vod status updated",
          eventId,
          jobType,
          status: vodStatus
        })
      };
    }

    if (!trimRequestId) {
      throw new Error("trimRequestId not found in MediaConvert job metadata");
    }

    const latestEvent = await ddbDocClient.send(
      new GetCommand({
        TableName: DYNAMODB_TABLE,
        Key: { eventId }
      })
    );

    const trimPatch = {};
    let resolvedStatus = status;

    if (status === "COMPLETE") {
      resolvedStatus = "READY";
      trimPatch.status = "READY";
      trimPatch.readyAt = new Date().toISOString();
    } else if (status === "ERROR" || status === "CANCELED") {
      resolvedStatus = "FAILED";
      trimPatch.status = "FAILED";
      trimPatch.error = job?.ErrorMessage || "Unknown error";
      trimPatch.errorAt = new Date().toISOString();
    } else {
      trimPatch.status = status;
    }

    const updatedTrimDetails = upsertTrimDetail(
      latestEvent.Item?.TrimDetails,
      trimRequestId,
      trimPatch
    );

    const expressionValues = {
      ":trimStatus": resolvedStatus,
      ":trimDetails": updatedTrimDetails,
    };

    let updateExpression = "SET trimStatus = :trimStatus, TrimDetails = :trimDetails";

    if (resolvedStatus === "READY") {
      updateExpression += ", trimReadyAt = :readyAt";
      expressionValues[":readyAt"] = new Date().toISOString();
    } else if (resolvedStatus === "FAILED") {
      updateExpression += ", trimError = :error, trimErrorTime = :errorTime";
      expressionValues[":error"] = job?.ErrorMessage || "Unknown error";
      expressionValues[":errorTime"] = new Date().toISOString();
    }

    await ddbDocClient.send(
      new UpdateCommand({
        TableName: DYNAMODB_TABLE,
        Key: { eventId },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: expressionValues
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "trim status updated",
        eventId,
        trimRequestId,
        jobType,
        status: resolvedStatus
      })
    };
  } catch (error) {
    console.error("Error updating MediaConvert status:", error);
    throw error;
  }
};
