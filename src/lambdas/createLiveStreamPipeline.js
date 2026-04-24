import {
  MediaLiveClient,
  CreateInputCommand,
  CreateChannelCommand as CreateMLChannelCommand,
  CreateInputSecurityGroupCommand,
  StartChannelCommand,
  DescribeChannelCommand
} from "@aws-sdk/client-medialive";
import {
  MediaPackageClient,
  CreateChannelCommand as CreateMPChannelCommand,
  CreateOriginEndpointCommand
} from "@aws-sdk/client-mediapackage";
import {
  CloudFrontClient,
  GetDistributionConfigCommand,
  UpdateDistributionCommand
} from "@aws-sdk/client-cloudfront";
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand
} from "@aws-sdk/client-dynamodb";

const medialive = new MediaLiveClient({
  maxAttempts: 3,
  requestTimeout: 30000
});
const mediapackage = new MediaPackageClient({
  maxAttempts: 3,
  requestTimeout: 30000
});
const cloudfront = new CloudFrontClient({
  maxAttempts: 3,
  requestTimeout: 60000
});
const dynamodb = new DynamoDBClient({
  maxAttempts: 3,
  requestTimeout: 10000
});

// 🔧 CONFIG
const TABLE_NAME = "go-live-poc-events";
const RESPONSE_HEADERS_POLICY_ID = "df87bddf-02e3-4626-8bbd-0a64b5888f85";
const EXISTING_DISTRIBUTION_ID = "E31K7IWMGF7E0K";
const S3_VOD_BUCKET = "go-live-vod";
const MEDIALIVE_ROLE_ARN = "arn:aws:iam::779564891877:role/MediaLiveAccessRole";

export const handler = async (event, context) => {
  const timeoutBuffer = 10000;
  const startTime = Date.now();
  const maxExecutionTime = context.getRemainingTimeInMillis
    ? context.getRemainingTimeInMillis() - timeoutBuffer
    : 290000;

  const checkTimeout = () => {
    const elapsed = Date.now() - startTime;
    if (elapsed > maxExecutionTime) {
      throw new Error("Lambda timeout imminent - operation aborted");
    }
  };

  const { eventId } = event;
  if (!eventId) {
    throw new Error("eventId is required");
  }

  try {
    // 1️⃣ Get event from DynamoDB
    checkTimeout();
    const { Item } = await dynamodb.send(
      new GetItemCommand({
        TableName: TABLE_NAME,
        Key: { eventId: { S: eventId } }
      })
    );

    if (!Item) {
      throw new Error(`Event ${eventId} not found in ${TABLE_NAME}`);
    }

    const title = Item.title?.S || "Untitled Event";

    // 2️⃣ MediaPackage channel
    checkTimeout();
    console.log("Creating MediaPackage channel...");
    const mpChannelResponse = await mediapackage.send(
      new CreateMPChannelCommand({
        Id: `mp-${eventId}`,
        Description: `MediaPackage channel for ${title}`
      })
    );
    console.log("✅ MediaPackage channel created");

    const mediaPackageChannelId = mpChannelResponse.Id;

    // 3️⃣ MediaPackage endpoint + MediaLive Security Group
    checkTimeout();
    console.log("Creating MediaPackage endpoint + Input Security Group...");
    const [mpEndpointResponse, sgResponse] = await Promise.all([
      mediapackage.send(
        new CreateOriginEndpointCommand({
          ChannelId: mpChannelResponse.Id,
          Id: `ep-${eventId}`,
          ManifestName: "index",
          StartoverWindowSeconds: 300,
          TimeDelaySeconds: 0,
          HlsPackage: {
            SegmentDurationSeconds: 6,
            PlaylistWindowSeconds: 60
          },
          Origination: "ALLOW"
        })
      ),
      medialive.send(
        new CreateInputSecurityGroupCommand({
          WhitelistRules: [{ Cidr: "0.0.0.0/0" }],
          Tags: {
            Name: `sg-${eventId}`,
            Project: "go-live-poc"
          }
        })
      )
    ]);
    console.log("✅ MediaPackage endpoint + SG created");

    const securityGroupId = sgResponse.SecurityGroup.Id;
    const mediaPackageEndpointId = mpEndpointResponse.Id;

    // 4️⃣ MediaLive Input (RTMP_PUSH)
    checkTimeout();
    console.log("Creating MediaLive input...");
    const inputResponse = await medialive.send(
      new CreateInputCommand({
        Name: `input-${eventId}`,
        Type: "RTMP_PUSH",
        Destinations: [{ StreamName: `live/${eventId}` }],
        InputSecurityGroups: [securityGroupId]
      })
    );
    console.log("✅ MediaLive input created");

    const mediaLiveInputId = inputResponse.Input.Id;

    // 5️⃣ MediaLive Channel with:
    //    - OutputGroup 1: MediaPackage (live)
    //    - OutputGroup 2: HLS to S3 (archive for VOD)
    checkTimeout();
    console.log("Creating MediaLive channel...");

    const ingestEndpoint = mpChannelResponse.HlsIngest.IngestEndpoints[0];

    const s3HlsPrefix = `recordings/${eventId}/hls`; // <== we will use index.m3u8 here
    const s3DestinationUrl = `s3ssl://${S3_VOD_BUCKET}/${s3HlsPrefix}/index`;

    const mlChannelResponse = await medialive.send(
      new CreateMLChannelCommand({
        Name: `ml-${eventId}`,
        RoleArn: MEDIALIVE_ROLE_ARN,
        ChannelClass: "SINGLE_PIPELINE",
        InputSpecification: {
          Codec: "AVC",
          Resolution: "HD",
          MaximumBitrate: "MAX_10_MBPS"
        },
        InputAttachments: [
          {
            InputId: mediaLiveInputId,
            InputAttachmentName: `attachment-${eventId}`
          }
        ],
        Destinations: [
          {
            Id: "destination1",
            MediaPackageSettings: [
              {
                ChannelId: mpChannelResponse.Id
              }
            ]
          },
          {
            Id: "destination2",
            Settings: [
              {
                Url: s3DestinationUrl // HLS group will use this
              }
            ]
          }
        ],
        EncoderSettings: {
          TimecodeConfig: { Source: "EMBEDDED" },
          AudioDescriptions: [
            {
              AudioSelectorName: "default",
              CodecSettings: {
                AacSettings: {
                  Bitrate: 96000,
                  CodingMode: "CODING_MODE_2_0",
                  InputType: "NORMAL",
                  Profile: "LC",
                  RateControlMode: "CBR",
                  RawFormat: "NONE",
                  SampleRate: 48000,
                  Spec: "MPEG4"
                }
              },
              AudioTypeControl: "FOLLOW_INPUT",
              LanguageCodeControl: "FOLLOW_INPUT",
              Name: "audio_1"
            }
          ],
          VideoDescriptions: [
            {
              CodecSettings: {
                H264Settings: {
                  AdaptiveQuantization: "HIGH",
                  Bitrate: 5000000,
                  ColorMetadata: "INSERT",
                  EntropyEncoding: "CABAC",
                  FlickerAq: "ENABLED",
                  FramerateControl: "SPECIFIED",
                  FramerateNumerator: 30,
                  FramerateDenominator: 1,
                  GopBReference: "DISABLED",
                  GopClosedCadence: 1,
                  GopNumBFrames: 2,
                  GopSize: 60,
                  GopSizeUnits: "FRAMES",
                  Level: "H264_LEVEL_AUTO",
                  LookAheadRateControl: "HIGH",
                  ParControl: "SPECIFIED",
                  Profile: "HIGH",
                  RateControlMode: "CBR",
                  ScanType: "PROGRESSIVE",
                  SceneChangeDetect: "ENABLED",
                  SpatialAq: "ENABLED",
                  TemporalAq: "ENABLED",
                  TimecodeInsertion: "DISABLED"
                }
              },
              Height: 1080,
              Name: "video_1080p30",
              RespondToAfd: "NONE",
              ScalingBehavior: "DEFAULT",
              Width: 1920,
              Sharpness: 50
            }
          ],
          OutputGroups: [
            // Live → MediaPackage
            {
              Name: "MediaPackageGroup",
              OutputGroupSettings: {
                MediaPackageGroupSettings: {
                  Destination: {
                    DestinationRefId: "destination1"
                  }
                }
              },
              Outputs: [
                {
                  OutputName: "1080p30",
                  VideoDescriptionName: "video_1080p30",
                  AudioDescriptionNames: ["audio_1"],
                  OutputSettings: {
                    MediaPackageOutputSettings: {}
                  }
                }
              ]
            },
            // Archive → HLS to S3 (for VOD)
            {
              Name: "HLS Archive to S3",
              OutputGroupSettings: {
                HlsGroupSettings: {
                  Destination: {
                    DestinationRefId: "destination2"
                  },
                  SegmentLength: 6,
                  MinSegmentLength: 0,
                  TsFileMode: "SEGMENTED_FILES",
                  KeepSegments: 999999,
                  IndexNSegments: 999999,
                  PlaylistWindowSeconds: 999999,
                  Mode: "VOD",
                  DirectoryStructure: "SINGLE_DIRECTORY",
                  ManifestDurationFormat: "INTEGER",
                  OutputSelection: "MANIFESTS_AND_SEGMENTS",
                  ClientCache: "ENABLED",
                  CodecSpecification: "RFC_4281",
                  ProgramDateTime: "EXCLUDE",
                  StreamInfResolution: "INCLUDE",
                }
              },
              Outputs: [
                {
                  OutputName: "archive_1080p",
                  VideoDescriptionName: "video_1080p30",
                  AudioDescriptionNames: ["audio_1"],
                  OutputSettings: {
                    HlsOutputSettings: {
                      NameModifier: "_1080p",
                      HlsSettings: {
                        StandardHlsSettings: {
                          M3u8Settings: {
                            AudioFramesPerPes: 4,
                            PcrControl: "PCR_EVERY_PES_PACKET"
                          },
                          AudioRenditionSets: "PROGRAM_AUDIO"
                        }
                      }
                    }
                  }
                }
              ]
            }
          ]
        }
      })
    );
    console.log("✅ MediaLive channel created with HLS archive to S3");

    const channelId = mlChannelResponse.Channel.Id;

    // 5.5️⃣ Wait for IDLE then start channel
    checkTimeout();
    console.log("Waiting for MediaLive channel to reach IDLE...");

    const maxWaitTime = 120000;
    const pollInterval = 5000;
    const waitStartTime = Date.now();
    let channelState = "CREATING";

    while (
      channelState !== "IDLE" &&
      Date.now() - waitStartTime < maxWaitTime
    ) {
      checkTimeout();
      await new Promise((r) => setTimeout(r, pollInterval));

      const describe = await medialive.send(
        new DescribeChannelCommand({ ChannelId: channelId })
      );
      channelState = describe.State;
      console.log(`Channel state: ${channelState}`);

      if (channelState === "CREATE_FAILED") {
        throw new Error("MediaLive channel creation failed");
      }
    }

    if (channelState === "IDLE") {
      console.log("Starting MediaLive channel...");
      await medialive.send(new StartChannelCommand({ ChannelId: channelId }));
      console.log("✅ MediaLive channel started");
    } else {
      console.warn(
        `⚠️ Channel did not reach IDLE in time (current: ${channelState}). Not starting automatically.`
      );
    }

    // 6️⃣ Update CloudFront for LIVE (MediaPackage origin) – same as your old logic
    checkTimeout();
    console.log("Updating CloudFront distribution for live origin...");

    const getConfigResponse = await cloudfront.send(
      new GetDistributionConfigCommand({
        Id: EXISTING_DISTRIBUTION_ID
      })
    );

    const distributionConfig = getConfigResponse.DistributionConfig;
    const etag = getConfigResponse.ETag;

    if (!distributionConfig.DefaultCacheBehavior.LambdaFunctionAssociations) {
      distributionConfig.DefaultCacheBehavior.LambdaFunctionAssociations = {
        Quantity: 0,
        Items: []
      };
    }

    const domain = mpEndpointResponse.Url.replace(/^https?:\/\//, "").replace(
      /\/.*$/,
      ""
    );
    const newOriginId = `MediaPackage-${eventId}`;
    const behaviorIds = [];

    const existingOriginIndex = distributionConfig.Origins.Items.findIndex(
      (origin) => origin.Id === newOriginId
    );

    let updateResponse = null;

    if (existingOriginIndex === -1) {
      console.log(`Adding new origin: ${newOriginId}`);

      distributionConfig.Origins.Items.push({
        Id: newOriginId,
        DomainName: domain,
        OriginPath: "",
        CustomOriginConfig: {
          HTTPPort: 80,
          HTTPSPort: 443,
          OriginProtocolPolicy: "https-only",
          OriginSslProtocols: {
            Quantity: 1,
            Items: ["TLSv1.2"]
          },
          OriginReadTimeout: 30,
          OriginKeepaliveTimeout: 5
        },
        CustomHeaders: {
          Quantity: 0,
          Items: []
        },
        ConnectionAttempts: 3,
        ConnectionTimeout: 10,
        OriginShield: {
          Enabled: false
        }
      });
      distributionConfig.Origins.Quantity =
        distributionConfig.Origins.Items.length;

      const newCacheBehaviors = [
        {
          PathPattern: `*/${eventId}/*.m3u8`,
          TargetOriginId: newOriginId,
          ViewerProtocolPolicy: "redirect-to-https",
          LambdaFunctionAssociations: { Quantity: 0, Items: [] },
          AllowedMethods: {
            Quantity: 3,
            Items: ["GET", "HEAD", "OPTIONS"],
            CachedMethods: { Quantity: 2, Items: ["GET", "HEAD"] }
          },
          Compress: true,
          ForwardedValues: {
            QueryString: true,
            QueryStringCacheKeys: { Quantity: 0, Items: [] },
            Cookies: {
              Forward: "none",
              WhitelistedNames: { Quantity: 0, Items: [] }
            },
            Headers: {
              Quantity: 4,
              Items: [
                "Origin",
                "Access-Control-Request-Method",
                "Access-Control-Request-Headers",
                "Range"
              ]
            }
          },
          MinTTL: 0,
          DefaultTTL: 2,
          MaxTTL: 5,
          TrustedSigners: { Enabled: false, Quantity: 0, Items: [] },
          TrustedKeyGroups: { Enabled: false, Quantity: 0, Items: [] },
          ResponseHeadersPolicyId: RESPONSE_HEADERS_POLICY_ID,
          SmoothStreaming: false,
          FieldLevelEncryptionId: ""
        },
        {
          PathPattern: `*/${eventId}/*.ts`,
          TargetOriginId: newOriginId,
          ViewerProtocolPolicy: "redirect-to-https",
          LambdaFunctionAssociations: { Quantity: 0, Items: [] },
          AllowedMethods: {
            Quantity: 3,
            Items: ["GET", "HEAD", "OPTIONS"],
            CachedMethods: { Quantity: 2, Items: ["GET", "HEAD"] }
          },
          Compress: false,
          ForwardedValues: {
            QueryString: true,
            QueryStringCacheKeys: { Quantity: 0, Items: [] },
            Cookies: {
              Forward: "none",
              WhitelistedNames: { Quantity: 0, Items: [] }
            },
            Headers: {
              Quantity: 4,
              Items: [
                "Origin",
                "Access-Control-Request-Method",
                "Access-Control-Request-Headers",
                "Range"
              ]
            }
          },
          MinTTL: 0,
          DefaultTTL: 60,
          MaxTTL: 86400,
          TrustedSigners: { Enabled: false, Quantity: 0, Items: [] },
          TrustedKeyGroups: { Enabled: false, Quantity: 0, Items: [] },
          ResponseHeadersPolicyId: RESPONSE_HEADERS_POLICY_ID,
          SmoothStreaming: false,
          FieldLevelEncryptionId: ""
        },
        {
          PathPattern: `*/${eventId}/*`,
          TargetOriginId: newOriginId,
          ViewerProtocolPolicy: "redirect-to-https",
          LambdaFunctionAssociations: { Quantity: 0, Items: [] },
          AllowedMethods: {
            Quantity: 3,
            Items: ["GET", "HEAD", "OPTIONS"],
            CachedMethods: { Quantity: 2, Items: ["GET", "HEAD"] }
          },
          Compress: true,
          ForwardedValues: {
            QueryString: true,
            QueryStringCacheKeys: { Quantity: 0, Items: [] },
            Cookies: { Forward: "none" },
            Headers: {
              Quantity: 4,
              Items: [
                "Origin",
                "Access-Control-Request-Method",
                "Access-Control-Request-Headers",
                "Range"
              ]
            }
          },
          MinTTL: 0,
          DefaultTTL: 5,
          MaxTTL: 10,
          TrustedSigners: { Enabled: false, Quantity: 0, Items: [] },
          TrustedKeyGroups: { Enabled: false, Quantity: 0, Items: [] },
          ResponseHeadersPolicyId: RESPONSE_HEADERS_POLICY_ID,
          SmoothStreaming: false,
          FieldLevelEncryptionId: ""
        }
      ];

      newCacheBehaviors.forEach((b) => behaviorIds.push(b.PathPattern));

      if (!distributionConfig.CacheBehaviors) {
        distributionConfig.CacheBehaviors = { Quantity: 0, Items: [] };
      }
      distributionConfig.CacheBehaviors.Items.push(...newCacheBehaviors);
      distributionConfig.CacheBehaviors.Quantity =
        distributionConfig.CacheBehaviors.Items.length;

      updateResponse = await cloudfront.send(
        new UpdateDistributionCommand({
          Id: EXISTING_DISTRIBUTION_ID,
          DistributionConfig: distributionConfig,
          IfMatch: etag
        })
      );

      console.log("✅ CloudFront updated for live");
    } else {
      console.log(`Origin ${newOriginId} already exists`);
      distributionConfig.CacheBehaviors?.Items?.forEach((b) => {
        if (b.PathPattern.includes(eventId)) {
          behaviorIds.push(b.PathPattern);
        }
      });
    }

    const cloudFrontDomain =
      updateResponse?.Distribution?.DomainName ||
      getConfigResponse.DistributionConfig.Aliases?.Items?.[0] ||
      `${EXISTING_DISTRIBUTION_ID}.cloudfront.net`;

    const mpUrl = mpEndpointResponse.Url;
    const pathOnly = new URL(mpUrl).pathname.substring(1);
    const cloudFrontUrl = `https://${cloudFrontDomain}/${pathOnly}`;

    // S3 HLS recording info
    const s3RecordingPrefix = s3HlsPrefix; // recordings/{eventId}/hls
    const s3RecordingManifestKey = `${s3RecordingPrefix}/index.m3u8`;
    const s3RecordingUrl = `s3://${S3_VOD_BUCKET}/${s3RecordingManifestKey}`;
    // Direct S3 VOD Manifest URL
    const vodcloudFrontUrl = `https://${cloudFrontDomain}/recordings/${eventId}/hls/index.m3u8`;


    // 7️⃣ Save everything in DynamoDB
    checkTimeout();
    console.log("Updating DynamoDB with live + recording info...");

    await dynamodb.send(
      new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: { eventId: { S: eventId } },
        UpdateExpression:
          "set rtmpInputUrl = :rtmp, " +
          "mediaPackageUrl = :mp, " +
          "cloudFrontUrl = :cf, " +
          "#st = :status, " +
          "cloudFrontDomain = :domain, " +
          "channelState = :channelState, " +
          "s3RecordingBucket = :s3bucket, " +
          "s3RecordingPrefix = :s3prefix, " +
          "s3RecordingManifestKey = :s3manifest, " +
          "vodcloudFrontUrl = :vodUrl, " +
          "mediaLiveInputId = :mlInputId, " +
          "mediaLiveInputSecurityGroupId = :mlSgId, " +
          "mediaLiveChannelId = :mlChannelId, " +
          "mediaPackageChannelId = :mpChannelId, " +
          "mediaPackageEndpointId = :mpEndpointId, " +
          "distributionId = :distId, " +
          "originId = :originId, " +
          "cacheBehaviorIds = :behaviorIds",
        ExpressionAttributeNames: {
          "#st": "status"
        },
        ExpressionAttributeValues: {
          ":rtmp": { S: inputResponse.Input.Destinations[0].Url },
          ":mp": { S: mpEndpointResponse.Url },
          ":cf": { S: cloudFrontUrl },
          ":vodUrl": { S: vodcloudFrontUrl },

          ":status": {
            S:
              channelState === "IDLE" ||
                channelState === "STARTING" ||
                channelState === "RUNNING"
                ? "Ready for Live"
                : "Channel Not Started"
          },
          ":domain": { S: cloudFrontDomain },
          ":channelState": { S: channelState },
          ":s3bucket": { S: S3_VOD_BUCKET },
          ":s3prefix": { S: s3RecordingPrefix },
          ":s3manifest": { S: s3RecordingManifestKey },
          ":mlInputId": { S: mediaLiveInputId },
          ":mlSgId": { S: securityGroupId },
          ":mlChannelId": { S: channelId },
          ":mpChannelId": { S: mediaPackageChannelId },
          ":mpEndpointId": { S: mediaPackageEndpointId },
          ":distId": { S: EXISTING_DISTRIBUTION_ID },
          ":originId": { S: newOriginId },
          ":behaviorIds": {
            SS: behaviorIds.length > 0 ? behaviorIds : ["none"]
          }
        }
      })
    );

    console.log("✅ DynamoDB updated for live pipeline");

    return {
      statusCode: 200,
      message:
        "Live pipeline created successfully with HLS archive to S3 for VOD",
      rtmpInputUrl: inputResponse.Input.Destinations[0].Url,
      mediaPackageUrl: mpEndpointResponse.Url,
      cloudFrontUrl,
      cloudFrontDomain,
      resourceIds: {
        mediaLiveInputId,
        mediaLiveInputSecurityGroupId: securityGroupId,
        mediaLiveChannelId: channelId,
        mediaPackageChannelId,
        mediaPackageEndpointId,
        distributionId: EXISTING_DISTRIBUTION_ID,
        originId: newOriginId,
        cacheBehaviorIds: behaviorIds
      },
      channelState,
      channelStarted:
        channelState === "STARTING" || channelState === "RUNNING",
      s3Recording: {
        bucket: S3_VOD_BUCKET,
        prefix: s3RecordingPrefix,
        manifestKey: s3RecordingManifestKey,
        fullUrl: s3RecordingUrl,
        format: "HLS (index.m3u8 + .ts)"
      }
    };
  } catch (error) {
    console.error("❌ Error creating live pipeline:", error);

    try {
      await dynamodb.send(
        new UpdateItemCommand({
          TableName: TABLE_NAME,
          Key: { eventId: { S: eventId } },
          UpdateExpression: "set #st = :status, errorMessage = :error",
          ExpressionAttributeNames: { "#st": "status" },
          ExpressionAttributeValues: {
            ":status": { S: "Failed" },
            ":error": { S: error.message }
          }
        })
      );
    } catch (dbError) {
      console.error("Failed to update DynamoDB with error:", dbError);
    }

    throw error;
  }
};
