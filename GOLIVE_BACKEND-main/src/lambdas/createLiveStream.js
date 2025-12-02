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
  requestTimeout: 60000
});
const dynamodb = new DynamoDBClient({ 
  maxAttempts: 3,
  requestTimeout: 10000 
});

// Response Headers Policy ID
const RESPONSE_HEADERS_POLICY_ID = "df87bddf-02e3-4626-8bbd-0a64b5888f85";

export const handler = async (event, context) => {
  const timeoutBuffer = 10000;
  const startTime = Date.now();
  const maxExecutionTime = context.getRemainingTimeInMillis ? 
    context.getRemainingTimeInMillis() - timeoutBuffer : 
    290000;

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

    // 2️⃣ Create MediaPackage channel with CORS enabled
    checkTimeout();
    console.log("Creating MediaPackage channel...");
    const mpChannelResponse = await mediapackage.send(
      new CreateMPChannelCommand({
        Id: `mp-${eventId}`,
        Description: `MediaPackage channel for ${title}`,
      })
    );
    console.log("✅ MediaPackage channel created");

    // 3️⃣ & 3.5️⃣ Create MediaPackage endpoint with CORS and Security Group in parallel
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
          // Enable CORS on MediaPackage endpoint
          Origination: "ALLOW",
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

    // 5.5️⃣ Wait for channel to be in IDLE state, then start it
    checkTimeout();
    console.log("Waiting for MediaLive channel to be ready to start...");
    
    const channelId = mlChannelResponse.Channel.Id;
    const maxWaitTime = 120000; // 2 minutes max wait
    const pollInterval = 5000; // Check every 5 seconds
    const waitStartTime = Date.now();
    
    let channelState = "CREATING";
    while (channelState !== "IDLE" && (Date.now() - waitStartTime) < maxWaitTime) {
      checkTimeout();
      
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
      const describeResponse = await medialive.send(
        new DescribeChannelCommand({ ChannelId: channelId })
      );
      
      channelState = describeResponse.State;
      console.log(`Channel state: ${channelState}`);
      
      if (channelState === "IDLE") {
        break;
      }
      
      if (channelState === "CREATE_FAILED") {
        throw new Error("MediaLive channel creation failed");
      }
    }
    
    if (channelState !== "IDLE") {
      console.warn(`⚠️ Channel did not reach IDLE state within timeout. Current state: ${channelState}`);
      console.log("Proceeding without starting the channel. You may need to start it manually.");
    } else {
      // Start the channel
      console.log("Starting MediaLive channel...");
      await medialive.send(
        new StartChannelCommand({ ChannelId: channelId })
      );
      console.log("✅ MediaLive channel started successfully");
    }

    // 6️⃣ Create CloudFront distribution with proper CORS and caching settings
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
                Id: "MediaPackageOrigin",
                DomainName: domain,
                CustomOriginConfig: {
                  HTTPPort: 80,
                  HTTPSPort: 443,
                  OriginProtocolPolicy: "https-only",
                  OriginSslProtocols: {
                    Quantity: 1,
                    Items: ["TLSv1.2"],
                  },
                  OriginReadTimeout: 30,
                  OriginKeepaliveTimeout: 5,
                },
                // Custom headers to forward to origin
                CustomHeaders: {
                  Quantity: 0,
                },
              },
            ],
          },
          DefaultCacheBehavior: {
            TargetOriginId: "MediaPackageOrigin",
            ViewerProtocolPolicy: "redirect-to-https",
            AllowedMethods: {
              Quantity: 3,
              Items: ["GET", "HEAD", "OPTIONS"],
              CachedMethods: {
                Quantity: 2,
                Items: ["GET", "HEAD"],
              },
            },
            // Compress content for better performance
            Compress: true,
            // Forward necessary headers for CORS and HLS
            ForwardedValues: {
              QueryString: true,
              Cookies: {
                Forward: "none",
              },
              Headers: {
                Quantity: 4,
                Items: [
                  "Origin",
                  "Access-Control-Request-Method",
                  "Access-Control-Request-Headers",
                  "Range"
                ],
              },
            },
            TrustedSigners: {
              Enabled: false,
              Quantity: 0,
            },
            // Optimized TTL for live streaming
            MinTTL: 0,
            DefaultTTL: 5,      // 5 seconds for segments
            MaxTTL: 10,         // Max 10 seconds
            SmoothStreaming: false,
            // Add Response Headers Policy
            ResponseHeadersPolicyId: RESPONSE_HEADERS_POLICY_ID,
          },
          // Cache behaviors for different content types
          CacheBehaviors: {
            Quantity: 2,
            Items: [
              // Manifest files (.m3u8) - shorter cache
              {
                PathPattern: "*.m3u8",
                TargetOriginId: "MediaPackageOrigin",
                ViewerProtocolPolicy: "redirect-to-https",
                AllowedMethods: {
                  Quantity: 3,
                  Items: ["GET", "HEAD", "OPTIONS"],
                  CachedMethods: {
                    Quantity: 2,
                    Items: ["GET", "HEAD"],
                  },
                },
                Compress: true,
                ForwardedValues: {
                  QueryString: true,
                  Cookies: { Forward: "none" },
                  Headers: {
                    Quantity: 4,
                    Items: ["Origin", "Access-Control-Request-Method", "Access-Control-Request-Headers", "Range"],
                  },
                },
                MinTTL: 0,
                DefaultTTL: 2,
                MaxTTL: 5,
                TrustedSigners: { Enabled: false, Quantity: 0 },
                // Add Response Headers Policy
                ResponseHeadersPolicyId: RESPONSE_HEADERS_POLICY_ID,
              },
              // Video segments (.ts) - can cache longer
              {
                PathPattern: "*.ts",
                TargetOriginId: "MediaPackageOrigin",
                ViewerProtocolPolicy: "redirect-to-https",
                AllowedMethods: {
                  Quantity: 3,
                  Items: ["GET", "HEAD", "OPTIONS"],
                  CachedMethods: {
                    Quantity: 2,
                    Items: ["GET", "HEAD"],
                  },
                },
                Compress: false, // Don't compress video segments
                ForwardedValues: {
                  QueryString: true,
                  Cookies: { Forward: "none" },
                  Headers: {
                    Quantity: 4,
                    Items: ["Origin", "Access-Control-Request-Method", "Access-Control-Request-Headers", "Range"],
                  },
                },
                MinTTL: 0,
                DefaultTTL: 60,
                MaxTTL: 86400,
                TrustedSigners: { Enabled: false, Quantity: 0 },
                // Add Response Headers Policy
                ResponseHeadersPolicyId: RESPONSE_HEADERS_POLICY_ID,
              },
            ],
          },
          // Custom error responses (optional - removed to avoid configuration issues)
          CustomErrorResponses: {
            Quantity: 0,
          },
          Comment: `Live streaming distribution for ${title} with CORS support`,
          PriceClass: "PriceClass_All",
          HttpVersion: "http2",
        },
      })
    );
    console.log("✅ CloudFront distribution created");
    const mpDomain=mpEndpointResponse.Url
    const pathOnly = new URL(mpDomain).pathname.substring(1);
    // const cloudFrontUrl = `https://${cfDistResponse.Distribution.DomainName}/out/v1/${mpEndpointResponse.Id}/index.m3u8`;
    const cloudFrontUrl = `https://${cfDistResponse.Distribution.DomainName}/${pathOnly}`;

    // 7️⃣ Update DynamoDB with stream details
    checkTimeout();
    await dynamodb.send(
      new UpdateItemCommand({
        TableName,
        Key: { eventId: { S: eventId } },
        UpdateExpression:
          "set rtmpInputUrl = :rtmp, mediaPackageUrl = :mp, cloudFrontUrl = :cf, #st = :status, cloudFrontDomain = :domain, channelState = :channelState,channelId = :channelId",
        ExpressionAttributeNames: {
          "#st": "status",
        },
        ExpressionAttributeValues: {
          ":rtmp": { S: inputResponse.Input.Destinations[0].Url },
          ":mp": { S: mpEndpointResponse.Url },
          ":cf": { S: cloudFrontUrl },
          ":status": { S: channelState === "IDLE" || channelState === "STARTING" || channelState === "RUNNING" ? "Ready for Live" : "Channel Not Started" },
          ":domain": { S: cfDistResponse.Distribution.DomainName },
          ":channelState": { S: channelState },
          ":channelId": { S: channelId },
        },
      })
    );

    return {
      statusCode: 200,
      message: "Live pipeline created successfully",
      rtmpInputUrl: inputResponse.Input.Destinations[0].Url,
      mediaPackageUrl: mpEndpointResponse.Url,
      cloudFrontUrl,
      cloudFrontDomain: cfDistResponse.Distribution.DomainName,
      channelState,
      channelStarted: channelState === "STARTING" || channelState === "RUNNING",
      note: `CloudFront distribution may take 15-20 minutes to fully deploy. CORS is configured for video.js playback from any origin including localhost. ${channelState === "IDLE" || channelState === "STARTING" || channelState === "RUNNING" ? "MediaLive channel has been started automatically." : "MediaLive channel needs to be started manually from AWS Console."}`
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