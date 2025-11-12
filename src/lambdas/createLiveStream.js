import {
  MediaLiveClient,
  CreateInputCommand,
  CreateChannelCommand as CreateMLChannelCommand
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

// Initialize AWS service clients
const medialive = new MediaLiveClient({});
const mediapackage = new MediaPackageClient({});
const cloudfront = new CloudFrontClient({});
const dynamodb = new DynamoDBClient({});

export const handler = async (event) => {
  const { eventId } = event;
  const TableName = "go-live-poc-events";

  // 1️⃣ Get event details from DynamoDB
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
  const mpChannel = await mediapackage.send(
    new CreateMPChannelCommand({
      Id: `mp-${eventId}`,
      Description: `MediaPackage channel for ${title}`,
    })
  );

  // 3️⃣ Create MediaPackage endpoint (HLS)
  const mpEndpoint = await mediapackage.send(
    new CreateOriginEndpointCommand({
      ChannelId: mpChannel.Id,
      Id: `ep-${eventId}`,
      ManifestName: "index",
      StartoverWindowSeconds: 300,
      TimeDelaySeconds: 0,
      HlsPackage: {
        SegmentDurationSeconds: 6,
        PlaylistWindowSeconds: 60,
      },
    })
  );

  // 4️⃣ Create MediaLive input (RTMP)
  const input = await medialive.send(
    new CreateInputCommand({
      Name: `input-${eventId}`,
      Type: "RTMP_PUSH",
      Destinations: [{ StreamName: `live/${eventId}` }],
      SecurityGroups: ["3226995"],
    })
  );

  // 5️⃣ Create MediaLive channel linked to MediaPackage
  const ingestEndpoint = mpChannel.HlsIngest.IngestEndpoints[0];
  const mlChannel = await medialive.send(
    new CreateMLChannelCommand({
      Name: `ml-${eventId}`,
      InputSpecification: {
        Codec: "AVC",
        Resolution: "HD",
        MaximumBitrate: "MAX_10_MBPS",
      },
      InputAttachments: [{ InputId: input.Input.Id }],
      Destinations: [
        {
          Id: "destination1",
          Settings: [
            {
              Url: ingestEndpoint.Url,
              Username: ingestEndpoint.Username,
              PasswordParam: ingestEndpoint.Password,
            },
          ],
        },
      ],
    })
  );

  // 6️⃣ Create CloudFront distribution for playback
  const domain = mpEndpoint.Url.replace(/^https?:\/\//, "");
  const cfDist = await cloudfront.send(
    new CreateDistributionCommand({
      DistributionConfig: {
        CallerReference: `${Date.now()}`,
        Enabled: true,
        Origins: [
          {
            Id: "Origin1",
            DomainName: domain,
            CustomOriginConfig: {
              HTTPPort: 80,
              HTTPSPort: 443,
              OriginProtocolPolicy: "https-only",
            },
          },
        ],
        DefaultCacheBehavior: {
          TargetOriginId: "Origin1",
          ViewerProtocolPolicy: "redirect-to-https",
          AllowedMethods: ["GET", "HEAD"],
        },
      },
    })
  );

  // 7️⃣ Update DynamoDB with stream details
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
        ":rtmp": { S: input.Input.Destinations[0].Url },
        ":mp": { S: mpEndpoint.Url },
        ":cf": { S: `https://${cfDist.Distribution.DomainName}/index.m3u8` },
        ":status": { S: "Ready for Live" },
      },
    })
  );

  return {
    message: "Live pipeline created successfully",
    mediaPackageUrl: mpEndpoint.Url,
    cloudFrontUrl: `https://${cfDist.Distribution.DomainName}/index.m3u8`,
  };
};
 