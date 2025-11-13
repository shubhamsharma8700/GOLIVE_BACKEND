import {
  MediaLiveClient,
  CreateInputCommand,
  CreateChannelCommand as CreateMLChannelCommand,
  CreateInputSecurityGroupCommand
} from "@aws-sdk/client-medialive";
import {
  MediaPackageClient,
  CreateChannelCommand as CreateMPChannelCommand,
  CreateOriginEndpointCommand
} from "@aws-sdk/client-mediapackage";
import {
  CloudFrontClient,
  CreateDistributionCommand
} from "@aws-sdk/client-cloudfront";
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand
} from "@aws-sdk/client-dynamodb";

// Initialize AWS service clients with timeouts
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
  requestTimeout: 60000 // CloudFront takes longer
});
const dynamodb = new DynamoDBClient({ 
  maxAttempts: 3,
  requestTimeout: 10000 
});

export const handler = async (event, context) => {
  // Set remaining time buffer (exit 10 seconds before timeout)
  const timeoutBuffer = 10000;
  const startTime = Date.now();
  const maxExecutionTime = context.getRemainingTimeInMillis ? 
    context.getRemainingTimeInMillis() - timeoutBuffer : 
    290000; // Default to 290 seconds (leave 10s buffer from 300s max)

  const checkTimeout = () => {
    const elapsed = Date.now() - startTime;
    if (elapsed > maxExecutionTime) {
      throw new Error('Lambda timeout imminent - operation aborted');
    }
  };

  const { eventId } = event;
  const TableName = "go-live-poc-events";

  try {
    // 1️⃣ Get event details from DynamoDB
    checkTimeout();
    const { Item } = await dynamodb.send(
      new GetItemCommand({
        TableName,
        Key: { eventId: { S: eventId } },
      })
    );

    if (!Item) {
      throw new Error(`Event ${eventId} not found in ${TableName}`);
    }

    const title = Item.title?.S || "Untitled Event";

    // 2️⃣ Create MediaPackage channel
    checkTimeout();
    console.log("Creating MediaPackage channel...");
    const mpChannelResponse = await mediapackage.send(
      new CreateMPChannelCommand({
        Id: `mp-${eventId}`,
        Description: `MediaPackage channel for ${title}`,
      })
    );
    console.log("✅ MediaPackage channel created");

    // 3️⃣ & 3.5️⃣ Create MediaPackage endpoint and Security Group in parallel
    checkTimeout();
    console.log("Creating MediaPackage endpoint and Security Group...");
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
            PlaylistWindowSeconds: 60,
          },
        })
      ),
      medialive.send(
        new CreateInputSecurityGroupCommand({
          WhitelistRules: [{ Cidr: "0.0.0.0/0" }],
          Tags: {
            Name: `sg-${eventId}`,
            Project: "go-live-poc",
          },
        })
      )
    ]);
    console.log("✅ MediaPackage endpoint and Security Group created");

    const securityGroupId = sgResponse.SecurityGroup.Id;

    // 4️⃣ Create MediaLive input (RTMP)
    checkTimeout();
    console.log("Creating MediaLive input...");
    const inputResponse = await medialive.send(
      new CreateInputCommand({
        Name: `input-${eventId}`,
        Type: "RTMP_PUSH",
        Destinations: [{ StreamName: `live/${eventId}` }],
        InputSecurityGroups: [securityGroupId],
      })
    );
    console.log("✅ MediaLive input created");

    // 5️⃣ Create MediaLive channel
    checkTimeout();
    console.log("Creating MediaLive channel (this may take a while)...");
    const ingestEndpoint = mpChannelResponse.HlsIngest.IngestEndpoints[0];
    
    const mlChannelResponse = await medialive.send(
      new CreateMLChannelCommand({
        Name: `ml-${eventId}`,
        RoleArn:"arn:aws:iam::779564891877:role/MediaLiveAccessRole",
        ChannelClass: "SINGLE_PIPELINE",
        InputSpecification: {
          Codec: "AVC",
          Resolution: "HD",
          MaximumBitrate: "MAX_10_MBPS",
        },
        InputAttachments: [
          {
            InputId: inputResponse.Input.Id,
            InputAttachmentName: `attachment-${eventId}`,
          },
        ],
        Destinations: [
          {
            Id: "destination1",
            MediaPackageSettings: [
              {
                ChannelId: mpChannelResponse.Id,
              },
            ],
          },
        ],
        EncoderSettings: {
          TimecodeConfig: {
            Source: "EMBEDDED",
          },
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
                  Spec: "MPEG4",
                },
              },
              AudioTypeControl: "FOLLOW_INPUT",
              LanguageCodeControl: "FOLLOW_INPUT",
              Name: "audio_1",
            },
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
                  TimecodeInsertion: "DISABLED",
                },
              },
              Height: 1080,
              Name: "video_1080p30",
              RespondToAfd: "NONE",
              Sharpness: 50,
              ScalingBehavior: "DEFAULT",
              Width: 1920,
            },
          ],
          OutputGroups: [
            {
              OutputGroupSettings: {
                MediaPackageGroupSettings: {
                  Destination: {
                    DestinationRefId: "destination1",
                  },
                },
              },
              Outputs: [
                {
                  OutputName: "1080p30",
                  VideoDescriptionName: "video_1080p30",
                  AudioDescriptionNames: ["audio_1"],
                  OutputSettings: {
                    MediaPackageOutputSettings: {},
                  },
                },
              ],
            },
          ],
        },
      })
    );
    console.log("✅ MediaLive channel created");

    // 6️⃣ Create CloudFront distribution (this is slow - skip if timing out)
    checkTimeout();
    console.log("Creating CloudFront distribution...");
    
    const domain = mpEndpointResponse.Url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const cfDistResponse = await cloudfront.send(
      new CreateDistributionCommand({
        DistributionConfig: {
          CallerReference: `${eventId}-${Date.now()}`,
          Comment: `Distribution for ${title}`,
          Enabled: true,
          Origins: {
            Quantity: 1,
            Items: [
              {
                Id: "Origin1",
                DomainName: domain,
                CustomOriginConfig: {
                  HTTPPort: 80,
                  HTTPSPort: 443,
                  OriginProtocolPolicy: "https-only",
                  OriginSslProtocols: {
                    Quantity: 1,
                    Items: ["TLSv1.2"],
                  },
                },
              },
            ],
          },
          DefaultCacheBehavior: {
            TargetOriginId: "Origin1",
            ViewerProtocolPolicy: "redirect-to-https",
            AllowedMethods: {
              Quantity: 2,
              Items: ["GET", "HEAD"],
              CachedMethods: {
                Quantity: 2,
                Items: ["GET", "HEAD"],
              },
            },
            ForwardedValues: {
              QueryString: false,
              Cookies: {
                Forward: "none",
              },
            },
            TrustedSigners: {
              Enabled: false,
              Quantity: 0,
            },
            MinTTL: 0,
          },
        },
      })
    );
    console.log("✅ CloudFront distribution created");

    const cloudFrontUrl = `https://${cfDistResponse.Distribution.DomainName}/out/v1/${mpEndpointResponse.Id}/index.m3u8`;

    // 7️⃣ Update DynamoDB with stream details
    checkTimeout();
    await dynamodb.send(
      new UpdateItemCommand({
        TableName,
        Key: { eventId: { S: eventId } },
        UpdateExpression:
          "set rtmpInputUrl = :rtmp, mediaPackageUrl = :mp, cloudFrontUrl = :cf, #st = :status",
        ExpressionAttributeNames: {
          "#st": "status",
        },
        ExpressionAttributeValues: {
          ":rtmp": { S: inputResponse.Input.Destinations[0].Url },
          ":mp": { S: mpEndpointResponse.Url },
          ":cf": { S: cloudFrontUrl },
          ":status": { S: "Ready for Live" },
        },
      })
    );

    return {
      statusCode: 200,
      message: "Live pipeline created successfully",
      rtmpInputUrl: inputResponse.Input.Destinations[0].Url,
      mediaPackageUrl: mpEndpointResponse.Url,
      cloudFrontUrl,
    };

  } catch (error) {
    console.error("❌ Error creating live pipeline:", error);
    
    // Update DynamoDB with error status
    try {
      await dynamodb.send(
        new UpdateItemCommand({
          TableName,
          Key: { eventId: { S: eventId } },
          UpdateExpression: "set #st = :status, errorMessage = :error",
          ExpressionAttributeNames: {
            "#st": "status",
          },
          ExpressionAttributeValues: {
            ":status": { S: "Failed" },
            ":error": { S: error.message },
          },
        })
      );
    } catch (dbError) {
      console.error("Failed to update DynamoDB with error status:", dbError);
    }

    throw error;
  }
};