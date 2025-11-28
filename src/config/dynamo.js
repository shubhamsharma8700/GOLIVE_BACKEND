const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand, QueryCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const REGION = process.env.AWS_REGION || 'ap-south-1';

const ddbClient = new DynamoDBClient({ region: REGION });

const marshallOptions = { removeUndefinedValues: true };
const unmarshallOptions = {};

const ddbDocClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions,
  unmarshallOptions
});

const TABLE = process.env.DYNAMODB_TABLE;
module.exports = {
  ddbDocClient,
  PutCommand,
  GetCommand,
  ScanCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  TABLE
};
