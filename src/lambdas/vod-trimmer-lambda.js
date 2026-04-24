import {
  MediaConvertClient,
  CreateJobCommand
} from "@aws-sdk/client-mediaconvert";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import {
  HeadObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";

const REGION = process.env.AWS_REGION || "ap-south-1";
const MEDIACONVERT_ENDPOINT =
  process.env.MEDIACONVERT_ENDPOINT ||
  "https://mediaconvert.ap-south-1.amazonaws.com";
const MEDIACONVERT_ROLE =
  process.env.MEDIACONVERT_ROLE ||
  "arn:aws:iam::779564891877:role/MediaConvertJobRole";
const VOD_OUTPUT_BUCKET = process.env.S3_VOD_BUCKET || "go-live-vod";
const DYNAMODB_TABLE = process.env.EVENTS_TABLE_NAME || "go-live-poc-events";
const DEFAULT_CLOUDFRONT_DOMAIN =
  process.env.VOD_CLOUDFRONT_DOMAIN ||
  process.env.CLOUDFRONT_DOMAIN ||
  "https://d13f4rjaj0zx64.cloudfront.net";

const mediaconvert = new MediaConvertClient({
  region: REGION,
  endpoint: MEDIACONVERT_ENDPOINT,
  maxAttempts: 3,
  requestTimeout: 30000
});

const ddbClient = new DynamoDBClient({
  region: REGION,
  maxAttempts: 3,
  requestTimeout: 10000
});

const ddbDocClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: true,
  },
});

const s3 = new S3Client({
  region: REGION,
  maxAttempts: 3,
  requestTimeout: 30000
});

function normalizeCloudFrontDomain(domain) {
  const value = String(domain || DEFAULT_CLOUDFRONT_DOMAIN).trim();
  if (!value) return DEFAULT_CLOUDFRONT_DOMAIN;

  const withProtocol = /^https?:\/\//i.test(value)
    ? value
    : `https://${value}`;

  return withProtocol.replace(/\/+$/, "");
}

function sanitizeOutputName(value) {
  const normalized = String(value || "trimmed-clip")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "trimmed-clip";
}

function buildTrimSegmentFolder(value = new Date().toISOString()) {
  const iso = new Date(value).toISOString();
  const compact = iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `segment_${compact.replace("T", "_").replace("Z", "")}`;
}

function parseTimeToSeconds(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value < 0) throw new Error("Trim time cannot be negative");
    return value;
  }

  const raw = String(value || "").trim();
  if (!raw) throw new Error("Trim time is required");

  if (/^\d+(\.\d+)?$/.test(raw)) {
    return Number(raw);
  }

  const parts = raw.split(":");
  if (parts.length < 2 || parts.length > 3) {
    throw new Error("Invalid trim time format. Use seconds or HH:MM:SS");
  }

  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part) => Number.isNaN(part) || part < 0)) {
    throw new Error("Invalid trim time format. Use seconds or HH:MM:SS");
  }

  if (parts.length === 2) {
    const [minutes, seconds] = numbers;
    return minutes * 60 + seconds;
  }

  const [hours, minutes, seconds] = numbers;
  return hours * 3600 + minutes * 60 + seconds;
}

function formatTimecode(totalSeconds) {
  const fps = 30;
  const safeSeconds = Math.max(totalSeconds, 0);
  const wholeSeconds = Math.floor(safeSeconds);
  const fractionalSeconds = safeSeconds - wholeSeconds;
  let frames = Math.round(fractionalSeconds * fps);
  let adjustedSeconds = wholeSeconds;

  if (frames >= fps) {
    adjustedSeconds += 1;
    frames = 0;
  }

  const hours = Math.floor(adjustedSeconds / 3600);
  const minutes = Math.floor((adjustedSeconds % 3600) / 60);
  const seconds = adjustedSeconds % 60;

  return [hours, minutes, seconds, frames]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
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
  console.log("TRIM EVENT:", JSON.stringify(event, null, 2));

  let eventId;
  let trimRequestId;

  try {
    const payload =
      typeof event?.body === "string" ? JSON.parse(event.body) : (event || {});

    eventId = payload.eventId;
    trimRequestId = payload.trimRequestId;
    const startTime = payload.startTime;
    const endTime = payload.endTime;
    const requestedAt = payload.requestedAt || new Date().toISOString();
    const requestedBy = payload.requestedBy || "system";
    const outputName = sanitizeOutputName(payload.outputName);
    const trimFolderName =
      payload.trimFolderName || buildTrimSegmentFolder(requestedAt);
    const trimOutputPath =
      payload.trimOutputPath || `trimmed/${eventId}/${trimFolderName}`;

    if (!eventId) throw new Error("eventId is required");
    if (!trimRequestId) throw new Error("trimRequestId is required");
    if (startTime === undefined || endTime === undefined) {
      throw new Error("startTime and endTime are required");
    }

    const startSeconds = parseTimeToSeconds(startTime);
    const endSeconds = parseTimeToSeconds(endTime);

    if (endSeconds <= startSeconds) {
      throw new Error("endTime must be greater than startTime");
    }

    const { Item } = await ddbDocClient.send(
      new GetCommand({
        TableName: DYNAMODB_TABLE,
        Key: { eventId }
      })
    );

    if (!Item) {
      throw new Error(`Event ${eventId} not found`);
    }

    const recordingBucket = Item.s3RecordingBucket || VOD_OUTPUT_BUCKET;
    const recordingManifestKey =
      Item.s3RecordingManifestKey || `recordings/${eventId}/hls/index.m3u8`;
    const inputSource = `s3://${recordingBucket}/${recordingManifestKey}`;

    await s3.send(
      new HeadObjectCommand({
        Bucket: recordingBucket,
        Key: recordingManifestKey
      })
    );

    const outputDestination = `s3://${VOD_OUTPUT_BUCKET}/${trimOutputPath}/`;
    const cloudFrontBase = normalizeCloudFrontDomain(Item.cloudFrontDomain);
    const trimCloudFrontUrl = `${cloudFrontBase}/${trimOutputPath}/index.m3u8`;
    const trimMp4CloudFrontUrl =
      `${cloudFrontBase}/${trimOutputPath}/index_full.mp4`;
    const trimDurationSeconds = endSeconds - startSeconds;
    const processingStartTime = new Date().toISOString();

    const jobParams = {
      Role: MEDIACONVERT_ROLE,
      UserMetadata: {
        eventId,
        jobType: "trim",
        trimRequestId,
        trimFolderName,
        trimOutputPath
      },
      Settings: {
        Inputs: [
          {
            FileInput: inputSource,
            AudioSelectors: {
              "Audio Selector 1": {
                DefaultSelection: "DEFAULT"
              }
            },
            VideoSelector: {},
            TimecodeSource: "ZEROBASED",
            InputClippings: [
              {
                StartTimecode: formatTimecode(startSeconds),
                EndTimecode: formatTimecode(endSeconds)
              }
            ]
          }
        ],
        OutputGroups: [
          {
            Name: "Trimmed HLS",
            OutputGroupSettings: {
              Type: "HLS_GROUP_SETTINGS",
              HlsGroupSettings: {
                SegmentLength: 6,
                MinSegmentLength: 0,
                Destination: outputDestination,
                SegmentControl: "SEGMENTED_FILES",
                ManifestDurationFormat: "INTEGER",
                ProgramDateTime: "EXCLUDE",
                CodecSpecification: "RFC_4281",
                OutputSelection: "MANIFESTS_AND_SEGMENTS",
                ManifestCompression: "NONE",
                StreamInfResolution: "INCLUDE",
                ClientCache: "ENABLED"
              }
            },
            Outputs: [
              {
                NameModifier: "_1080p",
                ContainerSettings: { Container: "M3U8" },
                VideoDescription: {
                  Width: 1920,
                  Height: 1080,
                  CodecSettings: {
                    Codec: "H_264",
                    H264Settings: {
                      RateControlMode: "QVBR",
                      MaxBitrate: 5000000,
                      CodecProfile: "HIGH",
                      FramerateControl: "INITIALIZE_FROM_SOURCE"
                    }
                  }
                },
                AudioDescriptions: [
                  {
                    CodecSettings: {
                      Codec: "AAC",
                      AacSettings: {
                        Bitrate: 128000,
                        CodingMode: "CODING_MODE_2_0",
                        SampleRate: 48000
                      }
                    }
                  }
                ]
              }
            ]
          },
          {
            Name: "Trimmed MP4",
            OutputGroupSettings: {
              Type: "FILE_GROUP_SETTINGS",
              FileGroupSettings: {
                Destination: outputDestination
              }
            },
            Outputs: [
              {
                NameModifier: "_full",
                ContainerSettings: {
                  Container: "MP4",
                  Mp4Settings: {
                    CslgAtom: "INCLUDE",
                    FreeSpaceBox: "EXCLUDE",
                    MoovPlacement: "PROGRESSIVE_DOWNLOAD"
                  }
                },
                VideoDescription: {
                  Width: 1920,
                  Height: 1080,
                  CodecSettings: {
                    Codec: "H_264",
                    H264Settings: {
                      RateControlMode: "QVBR",
                      MaxBitrate: 6000000,
                      CodecProfile: "HIGH",
                      FramerateControl: "INITIALIZE_FROM_SOURCE",
                      SceneChangeDetect: "TRANSITION_DETECTION"
                    }
                  }
                },
                AudioDescriptions: [
                  {
                    CodecSettings: {
                      Codec: "AAC",
                      AacSettings: {
                        Bitrate: 160000,
                        CodingMode: "CODING_MODE_2_0",
                        SampleRate: 48000
                      }
                    }
                  }
                ]
              }
            ]
          }
        ]
      },
      StatusUpdateInterval: "SECONDS_60",
      Priority: 0
    };

    const createJobResponse = await mediaconvert.send(
      new CreateJobCommand(jobParams)
    );
    const jobId = createJobResponse.Job.Id;

    const updatedTrimDetails = upsertTrimDetail(Item.TrimDetails, trimRequestId, {
      trimRequestId,
      status: "PROCESSING",
      requestedAt,
      requestedBy,
      startTime: String(startTime),
      endTime: String(endTime),
      outputName,
      trimFolderName,
      trimOutputPath,
      trimS3Path: outputDestination,
      trimCloudFrontUrl,
      trimMp4CloudFrontUrl,
      trimManifestKey: `${trimOutputPath}/index.m3u8`,
      trimMp4Key: `${trimOutputPath}/index_full.mp4`,
      trimInputSource: inputSource,
      trimDurationSeconds,
      trimSourceType: "HLS_RECORDING",
      trimJobId: jobId,
      processingStartTime,
    });

    await ddbDocClient.send(
      new UpdateCommand({
        TableName: DYNAMODB_TABLE,
        Key: { eventId },
        UpdateExpression:
          "SET trimStatus = :trimStatus, " +
          "trimRequestId = :trimRequestId, " +
          "trimJobId = :jobId, " +
          "trimS3Path = :s3Path, " +
          "trimCloudFrontUrl = :trimUrl, " +
          "trimMp4CloudFrontUrl = :trimMp4Url, " +
          "trimManifestKey = :manifestKey, " +
          "trimMp4Key = :mp4Key, " +
          "trimInputSource = :inputSource, " +
          "trimProcessingStartTime = :processingStartTime, " +
          "trimDurationSeconds = :duration, " +
          "trimSourceType = :sourceType, " +
          "trimOutputName = :outputName, " +
          "trimStartTime = :startTime, " +
          "trimEndTime = :endTime, " +
          "trimFolderName = :trimFolderName, " +
          "trimOutputPath = :outputPath, " +
          "TrimDetails = :trimDetails",
        ExpressionAttributeValues: {
          ":trimStatus": "PROCESSING",
          ":trimRequestId": trimRequestId,
          ":jobId": jobId,
          ":s3Path": outputDestination,
          ":trimUrl": trimCloudFrontUrl,
          ":trimMp4Url": trimMp4CloudFrontUrl,
          ":manifestKey": `${trimOutputPath}/index.m3u8`,
          ":mp4Key": `${trimOutputPath}/index_full.mp4`,
          ":inputSource": inputSource,
          ":processingStartTime": processingStartTime,
          ":duration": trimDurationSeconds,
          ":sourceType": "HLS_RECORDING",
          ":outputName": outputName,
          ":startTime": String(startTime),
          ":endTime": String(endTime),
          ":trimFolderName": trimFolderName,
          ":outputPath": trimOutputPath,
          ":trimDetails": updatedTrimDetails,
        }
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Trim job started successfully",
        eventId,
        trimRequestId,
        jobId,
        trimCloudFrontUrl,
        trimMp4CloudFrontUrl,
        trimOutputPath
      })
    };
  } catch (error) {
    console.error("TRIM ERROR:", error);

    if (eventId && trimRequestId) {
      try {
        const latestEvent = await ddbDocClient.send(
          new GetCommand({
            TableName: DYNAMODB_TABLE,
            Key: { eventId }
          })
        );

        const failedTrimDetails = upsertTrimDetail(
          latestEvent.Item?.TrimDetails,
          trimRequestId,
          {
            status: "FAILED",
            error: error.message || "Unknown trim error",
            errorAt: new Date().toISOString(),
          }
        );

        await ddbDocClient.send(
          new UpdateCommand({
            TableName: DYNAMODB_TABLE,
            Key: { eventId },
            UpdateExpression:
              "SET trimStatus = :trimStatus, trimError = :trimError, trimErrorTime = :trimErrorTime, TrimDetails = :trimDetails",
            ExpressionAttributeValues: {
              ":trimStatus": "FAILED",
              ":trimError": error.message || "Unknown trim error",
              ":trimErrorTime": new Date().toISOString(),
              ":trimDetails": failedTrimDetails,
            }
          })
        );
      } catch (dbError) {
        console.error("Failed to persist trim error:", dbError);
      }
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message || "Failed to create trim job"
      })
    };
  }
};
