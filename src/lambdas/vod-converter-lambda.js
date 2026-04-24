import {
  MediaConvertClient,
  CreateJobCommand
} from "@aws-sdk/client-mediaconvert";
import {
  DynamoDBClient,
  UpdateItemCommand,
  GetItemCommand,
  ScanCommand
} from "@aws-sdk/client-dynamodb";
import {
  S3Client,
  HeadObjectCommand
} from "@aws-sdk/client-s3";

// 🔧 CONFIG
const MEDIACONVERT_ENDPOINT = "https://mediaconvert.ap-south-1.amazonaws.com";
const MEDIACONVERT_ROLE = "arn:aws:iam::779564891877:role/MediaConvertJobRole";
const VOD_OUTPUT_BUCKET = "go-live-vod";
const CLOUDFRONT_DOMAIN = "https://d13f4rjaj0zx64.cloudfront.net";
const DYNAMODB_TABLE = "go-live-poc-events";

// ✅ Supported VOD upload file extensions
const SUPPORTED_VIDEO_EXTENSIONS = [".mp4", ".mov", ".mkv"];

const mediaconvert = new MediaConvertClient({
  endpoint: MEDIACONVERT_ENDPOINT,
  maxAttempts: 3,
  requestTimeout: 30000
});

const dynamodb = new DynamoDBClient({
  maxAttempts: 3,
  requestTimeout: 10000
});

const s3 = new S3Client({
  maxAttempts: 3,
  requestTimeout: 30000
});

// Helper: extract channelId from ARN
function extractChannelIdFromArn(channelArn) {
  const parts = channelArn.split(":");
  return parts[parts.length - 1];
}

// ✅ Helper: get file extension (lowercase)
function getFileExtension(s3Key) {
  const match = s3Key.match(/\.([^.]+)$/);
  return match ? `.${match[1].toLowerCase()}` : "";
}

// ✅ Helper: check if s3Key is a supported video file
function isSupportedVideoFile(s3Key) {
  const ext = getFileExtension(s3Key);
  return SUPPORTED_VIDEO_EXTENSIONS.includes(ext);
}

// ✅ Helper: build MediaConvert Input settings based on file type
// MKV requires Container to be declared; MOV is a QuickTime container (auto-detected by MediaConvert).
// For MKV we also skip ZEROBASED timecode since MKV often embeds its own.
function buildMediaConvertInput(inputSource, s3Key) {
  const ext = getFileExtension(s3Key);

  const baseInput = {
    FileInput: inputSource,
    AudioSelectors: {
      "Audio Selector 1": {
        DefaultSelection: "DEFAULT"
      }
    },
    VideoSelector: {}
  };

  if (ext === ".mkv") {
    // MKV: use embedded timecode if present; no forced ZEROBASED
    return {
      ...baseInput,
      TimecodeSource: "EMBEDDED"
    };
  }

  // MP4 / MOV: zero-based timecode works reliably
  return {
    ...baseInput,
    TimecodeSource: "ZEROBASED"
  };
}

// Helper: determine event type
function determineEventType(event) {
  // Type 1: MediaLive EventBridge
  if (
    event.source === "aws.medialive" &&
    event["detail-type"] === "MediaLive Channel State Change"
  ) {
    return "MEDIALIVE";
  }

  // Type 2: Direct DynamoDB item (VOD upload)
  // ✅ Accepts mp4 / mov / mkv via isSupportedVideoFile check later
  if (event.eventType?.S === "vod" || event.eventType?.S === "VOD") {
    return "VOD_UPLOAD";
  }

  // Type 3: Manual invocation with eventId
  if (event.eventId && typeof event.eventId === "string") {
    return "MANUAL";
  }

  // Type 4: API Gateway
  if (event.body) {
    return "API_GATEWAY";
  }

  return "UNKNOWN";
}

export const handler = async (event) => {
  console.log("EVENT RECEIVED:", JSON.stringify(event, null, 2));

  let eventId;
  let bucketName;
  let channelArn;
  let channelId;
  let channelState;
  let inputSource;
  let isVodUpload = false;
  let vodS3Key; // ✅ track s3Key for input builder

  try {
    const eventType = determineEventType(event);
    console.log(`Event Type Detected: ${eventType}`);

    // 1️⃣ Handle different event types
    if (eventType === "VOD_UPLOAD") {
      // ========== VOD UPLOAD PROCESSING ==========
      console.log("Processing VOD Upload event");
      isVodUpload = true;

      eventId = event.eventId.S;
      const s3Key = event.s3Key?.S;
      const vodStatus = event.vodStatus?.S;

      console.log(`EventId: ${eventId}`);
      console.log(`S3 Key: ${s3Key}`);
      console.log(`VOD Status: ${vodStatus}`);

      if (!s3Key) {
        throw new Error("s3Key not found in VOD upload event");
      }

      // ✅ Validate file extension
      if (!isSupportedVideoFile(s3Key)) {
        const ext = getFileExtension(s3Key);
        console.error(`❌ Unsupported file type: ${ext}`);

        await dynamodb.send(
          new UpdateItemCommand({
            TableName: DYNAMODB_TABLE,
            Key: { eventId: { S: eventId } },
            UpdateExpression:
              "set vodStatus = :status, vodError = :error, vodErrorTime = :time",
            ExpressionAttributeValues: {
              ":status": { S: "FAILED" },
              ":error": {
                S: `Unsupported file type: ${ext}. Supported types: ${SUPPORTED_VIDEO_EXTENSIONS.join(", ")}`
              },
              ":time": { S: new Date().toISOString() }
            }
          })
        );

        return {
          statusCode: 400,
          body: JSON.stringify({
            error: `Unsupported file type: ${ext}`,
            supported: SUPPORTED_VIDEO_EXTENSIONS,
            eventId,
            s3Key
          })
        };
      }

      bucketName = VOD_OUTPUT_BUCKET;
      vodS3Key = s3Key; // ✅ save for input builder

      // Check if VOD is already processing
      if (vodStatus === "PROCESSING" || vodStatus === "COMPLETE") {
        console.log(`⏭️ VOD already ${vodStatus} for event ${eventId}`);
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: `VOD already ${vodStatus}`,
            eventId,
            vodStatus
          })
        };
      }

      // Verify file exists in S3
      console.log(`Checking ${getFileExtension(s3Key).toUpperCase()} file in S3...`);
      try {
        await s3.send(
          new HeadObjectCommand({
            Bucket: bucketName,
            Key: s3Key
          })
        );
        console.log("✅ Video file found");
      } catch (e) {
        console.error("❌ Video file not found:", e);

        await dynamodb.send(
          new UpdateItemCommand({
            TableName: DYNAMODB_TABLE,
            Key: { eventId: { S: eventId } },
            UpdateExpression:
              "set vodStatus = :status, vodError = :error, vodErrorTime = :time",
            ExpressionAttributeValues: {
              ":status": { S: "FAILED" },
              ":error": {
                S: `Video file not found at s3://${bucketName}/${s3Key}`
              },
              ":time": { S: new Date().toISOString() }
            }
          })
        );

        return {
          statusCode: 400,
          body: JSON.stringify({
            error: "Video file not found for this event",
            eventId,
            filePath: `s3://${bucketName}/${s3Key}`
          })
        };
      }

      inputSource = `s3://${bucketName}/${s3Key}`;

    } else if (eventType === "MEDIALIVE") {
      // ========== MEDIALIVE RECORDING PROCESSING ==========
      console.log("Processing MediaLive event");

      channelArn = event.detail.channel_arn;
      channelState = event.detail.state;
      channelId = extractChannelIdFromArn(channelArn);

      console.log(`MediaLive state: ${channelState}`);
      console.log(`Channel ARN: ${channelArn}`);
      console.log(`Channel ID: ${channelId}`);

      // Only process when channel is STOPPED (stream ended)
      if (channelState !== "STOPPED") {
        console.log(
          `⏭️ Skipping VOD processing - channel state is ${channelState}`
        );
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: `Skipping VOD processing - channel state is ${channelState}`,
            channelArn,
            channelId
          })
        };
      }

      console.log(
        `Scanning DynamoDB for event with mediaLiveChannelId = ${channelId}`
      );
      const scanResponse = await dynamodb.send(
        new ScanCommand({
          TableName: DYNAMODB_TABLE,
          FilterExpression: "mediaLiveChannelId = :channelId",
          ExpressionAttributeValues: {
            ":channelId": { S: channelId }
          }
        })
      );

      if (!scanResponse.Items || scanResponse.Items.length === 0) {
        throw new Error(
          `No event found for mediaLiveChannelId: ${channelId} (ARN: ${channelArn})`
        );
      }

      eventId = scanResponse.Items[0].eventId.S;
      console.log(`✅ Found eventId: ${eventId}`);

    } else if (eventType === "MANUAL") {
      eventId = event.eventId;
      console.log("Manual invocation detected");
    } else if (eventType === "API_GATEWAY") {
      const body = JSON.parse(event.body);
      eventId = body.eventId;
      console.log("API Gateway invocation detected");
    } else {
      throw new Error("Invalid event format - unable to determine event type");
    }

    console.log(`Processing VOD for eventId: ${eventId}`);

    // 2️⃣ Get event record from DynamoDB (if not VOD upload)
    let Item;
    if (isVodUpload) {
      Item = event;
    } else {
      const getItemResponse = await dynamodb.send(
        new GetItemCommand({
          TableName: DYNAMODB_TABLE,
          Key: { eventId: { S: eventId } }
        })
      );

      if (!getItemResponse.Item) {
        throw new Error(`Event ${eventId} not found in DynamoDB`);
      }

      Item = getItemResponse.Item;
    }

    // 3️⃣ Determine input source based on event type
    if (!isVodUpload) {
      bucketName = Item.s3RecordingBucket?.S || VOD_OUTPUT_BUCKET;
      const s3RecordingPrefix =
        Item.s3RecordingPrefix?.S || `recordings/${eventId}/hls`;
      const s3RecordingManifestKey =
        Item.s3RecordingManifestKey?.S ||
        `${s3RecordingPrefix}/index.m3u8`;

      const dbChannelState = Item.channelState?.S;
      console.log(`DynamoDB channelState: ${dbChannelState}`);
      console.log(`Recording bucket: ${bucketName}`);
      console.log(`Recording prefix: ${s3RecordingPrefix}`);
      console.log(`Recording manifest key: ${s3RecordingManifestKey}`);

      // Check VOD status to avoid duplicates
      const vodStatus = Item.vodStatus?.S;
      if (vodStatus === "PROCESSING" || vodStatus === "COMPLETE") {
        console.log(`⏭️ VOD already ${vodStatus} for event ${eventId}`);
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: `VOD already ${vodStatus}`,
            eventId,
            vodStatus
          })
        };
      }

      // Ensure the manifest exists in S3
      console.log("Checking HLS manifest in S3...");
      try {
        await s3.send(
          new HeadObjectCommand({
            Bucket: bucketName,
            Key: s3RecordingManifestKey
          })
        );
        console.log("✅ HLS manifest found");
      } catch (e) {
        console.error("❌ HLS manifest not found:", e);

        await dynamodb.send(
          new UpdateItemCommand({
            TableName: DYNAMODB_TABLE,
            Key: { eventId: { S: eventId } },
            UpdateExpression:
              "set vodStatus = :status, vodError = :error, vodErrorTime = :time",
            ExpressionAttributeValues: {
              ":status": { S: "FAILED" },
              ":error": {
                S: `HLS manifest not found at s3://${bucketName}/${s3RecordingManifestKey}`
              },
              ":time": { S: new Date().toISOString() }
            }
          })
        );

        return {
          statusCode: 400,
          body: JSON.stringify({
            error: "HLS manifest not found for this event",
            eventId,
            manifestPath: `s3://${bucketName}/${s3RecordingManifestKey}`
          })
        };
      }

      inputSource = `s3://${bucketName}/${s3RecordingManifestKey}`;
    }

    // Extract base filename for output naming
    let baseFileName = "index";
    if (isVodUpload) {
      const s3Key = event.s3Key.S;
      const fileName = s3Key.split("/").pop();
      // ✅ Strip extension regardless of .mp4 / .mov / .mkv
      baseFileName = fileName.replace(/\.[^/.]+$/, "");
      console.log(`Extracted base filename: ${baseFileName}`);
    }

    const vodOutputPath = `vod-output/${eventId}`;
    const outputUrl = `s3://${VOD_OUTPUT_BUCKET}/${vodOutputPath}/`;

    console.log(`MediaConvert input: ${inputSource}`);
    console.log(`MediaConvert output: ${outputUrl}`);
    console.log(`Base filename for outputs: ${baseFileName}`);

    // ✅ Build input settings with format-aware timecode handling
    const mediaConvertInput = isVodUpload
      ? buildMediaConvertInput(inputSource, vodS3Key)
      : {
          FileInput: inputSource,
          AudioSelectors: {
            "Audio Selector 1": { DefaultSelection: "DEFAULT" }
          },
          VideoSelector: {},
          TimecodeSource: "ZEROBASED"
        };

    // 4️⃣ Create MediaConvert job
    const jobParams = {
      Role: MEDIACONVERT_ROLE,
      Settings: {
        Inputs: [mediaConvertInput],  // ✅ uses format-aware input
        OutputGroups: [
          // =========================
          // HLS OUTPUT GROUP
          // =========================
          {
            Name: "Apple HLS",
            OutputGroupSettings: {
              Type: "HLS_GROUP_SETTINGS",
              HlsGroupSettings: {
                SegmentLength: 6,
                MinSegmentLength: 0,
                Destination: outputUrl,
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
              // 1080p
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
              },

              // 720p
              {
                NameModifier: "_720p",
                ContainerSettings: { Container: "M3U8" },
                VideoDescription: {
                  Width: 1280,
                  Height: 720,
                  CodecSettings: {
                    Codec: "H_264",
                    H264Settings: {
                      RateControlMode: "QVBR",
                      MaxBitrate: 3000000,
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
                        Bitrate: 96000,
                        CodingMode: "CODING_MODE_2_0",
                        SampleRate: 48000
                      }
                    }
                  }
                ]
              },

              // 480p
              {
                NameModifier: "_480p",
                ContainerSettings: { Container: "M3U8" },
                VideoDescription: {
                  Width: 854,
                  Height: 480,
                  CodecSettings: {
                    Codec: "H_264",
                    H264Settings: {
                      RateControlMode: "QVBR",
                      MaxBitrate: 1500000,
                      CodecProfile: "MAIN",
                      FramerateControl: "INITIALIZE_FROM_SOURCE"
                    }
                  }
                },
                AudioDescriptions: [
                  {
                    CodecSettings: {
                      Codec: "AAC",
                      AacSettings: {
                        Bitrate: 64000,
                        CodingMode: "CODING_MODE_2_0",
                        SampleRate: 48000
                      }
                    }
                  }
                ]
              }
            ]
          },

          // =========================
          // MP4 OUTPUT GROUP
          // =========================
          {
            Name: "MP4 File",
            OutputGroupSettings: {
              Type: "FILE_GROUP_SETTINGS",
              FileGroupSettings: {
                Destination: `s3://${VOD_OUTPUT_BUCKET}/vod-output/${eventId}/`
              }
            },
            Outputs: [
              // FULL MP4 – 1080p
              {
                NameModifier: "_full_1080p",
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
              },

              // FULL MP4 – 720p
              {
                NameModifier: "_full_720p",
                ContainerSettings: {
                  Container: "MP4",
                  Mp4Settings: {
                    CslgAtom: "INCLUDE",
                    FreeSpaceBox: "EXCLUDE",
                    MoovPlacement: "PROGRESSIVE_DOWNLOAD"
                  }
                },
                VideoDescription: {
                  Width: 1280,
                  Height: 720,
                  CodecSettings: {
                    Codec: "H_264",
                    H264Settings: {
                      RateControlMode: "QVBR",
                      MaxBitrate: 3500000,
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
                        Bitrate: 128000,
                        CodingMode: "CODING_MODE_2_0",
                        SampleRate: 48000
                      }
                    }
                  }
                ]
              },

              // FULL MP4 – 480p
              {
                NameModifier: "_full_480p",
                ContainerSettings: {
                  Container: "MP4",
                  Mp4Settings: {
                    CslgAtom: "INCLUDE",
                    FreeSpaceBox: "EXCLUDE",
                    MoovPlacement: "PROGRESSIVE_DOWNLOAD"
                  }
                },
                VideoDescription: {
                  Width: 854,
                  Height: 480,
                  CodecSettings: {
                    Codec: "H_264",
                    H264Settings: {
                      RateControlMode: "QVBR",
                      MaxBitrate: 1800000,
                      CodecProfile: "MAIN",
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
                        Bitrate: 96000,
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

    console.log("Creating MediaConvert job...");
    const createJobResponse = await mediaconvert.send(
      new CreateJobCommand(jobParams)
    );
    const jobId = createJobResponse.Job.Id;
    console.log(`✅ MediaConvert job created: ${jobId}`);

    // 5️⃣ Generate CloudFront URLs
    const encodedBaseFileName = encodeURIComponent(baseFileName).replace(/%20/g, "+");

    const vodCloudFrontUrl = `${CLOUDFRONT_DOMAIN}/${vodOutputPath}/${encodedBaseFileName}.m3u8`;
    const vod1080pUrl = `${CLOUDFRONT_DOMAIN}/${vodOutputPath}/${encodedBaseFileName}_1080p.m3u8`;
    const vod720pUrl = `${CLOUDFRONT_DOMAIN}/${vodOutputPath}/${encodedBaseFileName}_720p.m3u8`;
    const vod480pUrl = `${CLOUDFRONT_DOMAIN}/${vodOutputPath}/${encodedBaseFileName}_480p.m3u8`;

    console.log("VOD URLs generated:");
    console.log(`Master: ${vodCloudFrontUrl}`);
    console.log(`1080p: ${vod1080pUrl}`);
    console.log(`720p: ${vod720pUrl}`);
    console.log(`480p: ${vod480pUrl}`);

    // ✅ Determine source file type label for DynamoDB
    const sourceFileType = isVodUpload
      ? getFileExtension(vodS3Key).replace(".", "").toUpperCase() + "_UPLOAD"
      : "HLS_RECORDING";

    // 6️⃣ Update DynamoDB
    await dynamodb.send(
      new UpdateItemCommand({
        TableName: DYNAMODB_TABLE,
        Key: { eventId: { S: eventId } },
        UpdateExpression:
          "set vodStatus = :vodStatus, " +
          "vodJobId = :jobId, " +
          "vodS3Path = :s3path, " +
          "vodCloudFrontUrl = :vodUrl, " +
          "vod1080pUrl = :vod1080p, " +
          "vod720pUrl = :vod720p, " +
          "vod480pUrl = :vod480p, " +
          "vodOutputPath = :outputPath, " +
          "vodInputSource = :inputSrc, " +
          "vodProcessingStartTime = :startTime, " +
          "vodSourceType = :sourceType",
        ExpressionAttributeValues: {
          ":vodStatus": { S: "PROCESSING" },
          ":jobId": { S: jobId },
          ":s3path": { S: outputUrl },
          ":vodUrl": { S: vodCloudFrontUrl },
          ":vod1080p": { S: vod1080pUrl },
          ":vod720p": { S: vod720pUrl },
          ":vod480p": { S: vod480pUrl },
          ":outputPath": { S: vodOutputPath },
          ":inputSrc": { S: inputSource },
          ":startTime": { S: new Date().toISOString() },
          ":sourceType": { S: sourceFileType }  // ✅ e.g. "MOV_UPLOAD", "MKV_UPLOAD", "MP4_UPLOAD"
        }
      })
    );

    console.log("✅ DynamoDB updated with VOD info and all resolution URLs");

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "VOD conversion started successfully",
        eventId,
        jobId,
        sourceType: sourceFileType,
        vodUrls: {
          master: vodCloudFrontUrl,
          "1080p": vod1080pUrl,
          "720p": vod720pUrl,
          "480p": vod480pUrl
        },
        inputSource,
        channelId: channelId || "N/A",
        channelArn: channelArn || "N/A",
        triggeredBy: determineEventType(event)
      })
    };
  } catch (error) {
    console.error("❌ Error processing VOD:", error);

    // Try update DynamoDB with error
    try {
      let resolvedEventId = eventId;

      if (!resolvedEventId) {
        if (event.source === "aws.medialive" && event.detail?.channel_arn) {
          const chId = extractChannelIdFromArn(event.detail.channel_arn);
          const scanResponse = await dynamodb.send(
            new ScanCommand({
              TableName: DYNAMODB_TABLE,
              FilterExpression: "mediaLiveChannelId = :channelId",
              ExpressionAttributeValues: {
                ":channelId": { S: chId }
              }
            })
          );
          if (scanResponse.Items && scanResponse.Items.length > 0) {
            resolvedEventId = scanResponse.Items[0].eventId.S;
          }
        } else if (event.eventId?.S) {
          resolvedEventId = event.eventId.S;
        } else if (event.eventId) {
          resolvedEventId = event.eventId;
        } else if (event.body) {
          const body = JSON.parse(event.body);
          resolvedEventId = body.eventId;
        }
      }

      if (resolvedEventId) {
        await dynamodb.send(
          new UpdateItemCommand({
            TableName: DYNAMODB_TABLE,
            Key: { eventId: { S: resolvedEventId } },
            UpdateExpression:
              "set vodStatus = :status, vodError = :error, vodErrorTime = :time",
            ExpressionAttributeValues: {
              ":status": { S: "FAILED" },
              ":error": { S: error.message },
              ":time": { S: new Date().toISOString() }
            }
          })
        );
      }
    } catch (dbError) {
      console.error("Failed to update DynamoDB with VOD error:", dbError);
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message,
        details: error.stack
      })
    };
  }
};
