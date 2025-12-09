import {
    AbortMultipartUploadCommand,
    CompleteMultipartUploadCommand,
    CreateMultipartUploadCommand,
    PutObjectCommand,
    S3Client,
    UploadPartCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const REGION = process.env.AWS_REGION;
const BUCKET = process.env.S3_BUCKET_NAME;

const s3 = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * POST /presign/simple
 * Body: { filename, contentType, metadata?: { key: value }, expiresInSeconds?: number }
 * Returns: { url, key, expiresIn }
 */
export async function getPresignedPutUrl(req, res) {
  try {
    const { filename, contentType = "application/octet-stream", metadata = {}, expiresInSeconds = 3600 } = req.body;
    if (!filename) return res.status(400).json({ error: "filename required" });

    const key = `videos/${Date.now()}-${filename}`;

    const cmd = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType,
      Metadata: normalizeMetadata(metadata),
    });

    const url = await getSignedUrl(s3, cmd, { expiresIn: expiresInSeconds });

    return res.json({ url, key, expiresIn: expiresInSeconds });
  } catch (err) {
    console.error("getPresignedPutUrl err:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * POST /presign/multipart/initiate
 * Body: { filename, contentType, fileSize, partSizeBytes? }
 * Returns: { uploadId, key, parts: [{partNumber, url}, ...], partSizeBytes }
 *
 * Behavior:
 * - calculates number of parts from fileSize and partSizeBytes (defaults to 8MB)
 * - creates an S3 multipart upload and returns presigned UploadPart URLs for each part
 */
export async function initiateMultipartUpload(req, res) {
  try {
    const { filename, contentType = "application/octet-stream", fileSize, partSizeBytes = 8 * 1024 * 1024 } = req.body;
    if (!filename || !fileSize) return res.status(400).json({ error: "filename and fileSize required" });

    const key = `videos/${Date.now()}-${filename}`;

    // Start multipart upload
    const createCmd = new CreateMultipartUploadCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType,
    });

    const createResp = await s3.send(createCmd);
    const uploadId = createResp.UploadId;
    if (!uploadId) throw new Error("Failed to create multipart upload");

    // compute parts
    const partsCount = Math.ceil(fileSize / partSizeBytes);
    if (partsCount > 10000) {
      // S3 limit
      await s3.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId }));
      return res.status(400).json({ error: "Too many parts required. Increase partSizeBytes." });
    }

    // generate presigned URLs for each part
    const urls = [];
    for (let partNumber = 1; partNumber <= partsCount; partNumber++) {
      const uploadPartCmd = new UploadPartCommand({
        Bucket: BUCKET,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      });

      // expiry: 1 hour by default; adjust as needed
      const url = await getSignedUrl(s3, uploadPartCmd, { expiresIn: 3600 });
      urls.push({ partNumber, url });
    }

    return res.json({
      uploadId,
      key,
      parts: urls,
      partSizeBytes,
      partsCount,
    });
  } catch (err) {
    console.error("initiateMultipartUpload err:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * POST /presign/multipart/complete
 * Body: { key, uploadId, parts: [{ ETag, partNumber }, ...] }
 * Returns: the Completed multipart response from S3
 */
export async function completeMultipartUpload(req, res) {
  try {
    const { key, uploadId, parts } = req.body;
    if (!key || !uploadId || !Array.isArray(parts)) return res.status(400).json({ error: "key, uploadId, parts required" });

    // S3 expects parts sorted ascending by PartNumber
    const sortedParts = parts
      .map(p => ({ ETag: p.ETag, PartNumber: Number(p.partNumber ?? p.partNumber) || Number(p.PartNumber) }))
      .sort((a, b) => a.PartNumber - b.PartNumber);

    const completeCmd = new CompleteMultipartUploadCommand({
      Bucket: BUCKET,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: sortedParts },
    });

    const completeResp = await s3.send(completeCmd);

    return res.json({ message: "Completed", result: completeResp });
  } catch (err) {
    console.error("completeMultipartUpload err:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * POST /presign/multipart/abort
 * Body: { key, uploadId }
 * Returns: confirmation
 */
export async function abortMultipartUpload(req, res) {
  try {
    const { key, uploadId } = req.body;
    if (!key || !uploadId) return res.status(400).json({ error: "key and uploadId required" });

    const abortCmd = new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId });
    await s3.send(abortCmd);
    return res.json({ message: "Aborted" });
  } catch (err) {
    console.error("abortMultipartUpload err:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

/** Helper: ensure metadata object values are strings (S3 metadata must be string) */
function normalizeMetadata(metadata = {}) {
  const out = {};
  for (const k of Object.keys(metadata)) {
    const v = metadata[k];
    out[k.toLowerCase()] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return out;
}
