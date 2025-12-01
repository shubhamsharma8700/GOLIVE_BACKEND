import AWS from "aws-sdk";
import dotenv from "dotenv";
dotenv.config();

AWS.config.update({
  region: process.env.AWS_REGION || "ap-south-1",
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const eventBridge = new AWS.EventBridge();
const medialive = new AWS.MediaLive();
const lambda = new AWS.Lambda();

// Debug which AWS account/credentials are being used at startup
try {
  const sts = new AWS.STS();
  sts
    .getCallerIdentity()
    .promise()
    .then((id) => {
      console.log("[AWS] Using account:", id.Account, "ARN:", id.Arn);
    })
    .catch((err) => {
      console.error("[AWS] ERROR getting caller identity:", err);
    });
} catch (err) {
  console.error("[AWS] Failed to initialize STS for caller identity:", err);
}

export { dynamoDB, eventBridge, medialive, lambda };
