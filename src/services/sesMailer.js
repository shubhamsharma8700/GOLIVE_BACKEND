import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const REGION = process.env.AWS_REGION || "ap-south-1";

const ses = new SESClient({ region: REGION });

// Must be verified in SES
const SOURCE_EMAIL = process.env.SES_SOURCE_EMAIL;

export async function sendOtpEmail(to, otp, ttlSeconds = process.env.OTP_TTL_SECONDS || 900) {
  if (!SOURCE_EMAIL) {
    console.log(`Simulated SES email → to=${to}, otp=${otp}`);
    return;
  }

  const params = {
    Destination: { ToAddresses: [to] },
    Message: {
      Body: { Text: { Data: `Your OTP is ${otp}. Expires in ${ttlSeconds / 60} minutes.` }},
      Subject: { Data: "Your Password Reset OTP" }
    },
    Source: SOURCE_EMAIL
  };

  await ses.send(new SendEmailCommand(params));
}
