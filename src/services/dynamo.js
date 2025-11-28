import dotenv from "dotenv";
dotenv.config();

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DeleteCommand,
    DynamoDBDocumentClient,
    GetCommand,
    PutCommand,
    QueryCommand,
    ScanCommand,
    UpdateCommand
} from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "ap-south-1";

const ddbClient = new DynamoDBClient({ region: REGION });

const marshallOptions = { removeUndefinedValues: true };
const unmarshallOptions = {};

const ddbDocClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions,
  unmarshallOptions
});

const TABLE = process.env.DYNAMODB_TABLE;

console.log("TABLE inside dynamo.js:", TABLE);

export {
    ddbDocClient, DeleteCommand, GetCommand, PutCommand, QueryCommand, ScanCommand, TABLE, UpdateCommand
};

