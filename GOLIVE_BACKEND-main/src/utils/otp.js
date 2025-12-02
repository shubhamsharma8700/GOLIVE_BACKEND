import crypto from "crypto";

export function generateOtp(digits = 6) {
  const max = 10 ** digits;
  const num = crypto.randomInt(0, max);
  return String(num).padStart(digits, "0");
}

export function getExpiry(ttl = process.env.OTP_TTL_SECONDS || 900) {
  return Date.now() + ttl * 1000;
}
