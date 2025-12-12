// config/awsClients.js
import dotenv from "dotenv";
dotenv.config();

// ----------------------
// AWS REGION
// ----------------------
const REGION = process.env.AWS_REGION || "ap-south-1";

// ----------------------
// DYNAMODB (v3)
// ----------------------
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";

const ddbClient = new DynamoDBClient({ region: REGION });

export const ddbDocClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: true,
  },
});

// Export DynamoDB Commands
export {
  PutCommand,
  GetCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand
};


// ----------------------
// MEDIALIVE (v3)
// ----------------------
import { MediaLiveClient } from "@aws-sdk/client-medialive";
export const medialive = new MediaLiveClient({ region: REGION });


// ----------------------
// EVENTBRIDGE (v3)
// ----------------------
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
export const eventBridge = new EventBridgeClient({ region: REGION });


// ----------------------
// LAMBDA (v3)
// ----------------------
import { LambdaClient } from "@aws-sdk/client-lambda";
export const lambda = new LambdaClient({ region: REGION });


// ----------------------
// SES (v3)
// ----------------------
import { SESClient } from "@aws-sdk/client-ses";
export const ses = new SESClient({ region: REGION });


// ----------------------
// STS (Check AWS Identity)
// ----------------------
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
const sts = new STSClient({ region: REGION });

sts.send(new GetCallerIdentityCommand({}))
  .then((id) => {
    console.log("[AWS v3] Account:", id.Account, "ARN:", id.Arn);
  })
  .catch((err) => {
    console.error("[AWS v3] STS Error:", err);
  });


// ----------------------
// EXPORT TABLE NAMES
// ----------------------
export const ADMIN_TABLE_NAME = process.env.ADMIN_TABLE_NAME;
export const EVENTS_TABLE_NAME = process.env.EVENTS_TABLE_NAME;
export const USERS_TABLE_NAME = process.env.USERS_TABLE_NAME;
