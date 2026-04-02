// src/infra/storage/s3.ts — S3-compatible storage adapter (placeholder)
// In production, use AWS SDK or MinIO for object storage.

import logger from "../../config/logger";

const S3_ENDPOINT = process.env.S3_ENDPOINT || "";
const S3_BUCKET = process.env.S3_BUCKET || "codesila-uploads";

/**
 * Upload a file to S3-compatible storage.
 */
export async function uploadToS3(
  key: string,
  data: Buffer,
  contentType = "application/octet-stream",
): Promise<string> {
  if (!S3_ENDPOINT) {
    logger.warn("S3_ENDPOINT not configured — skipping upload");
    return "";
  }

  // In production, use @aws-sdk/client-s3
  const url = `${S3_ENDPOINT}/${S3_BUCKET}/${key}`;
  logger.info({ key, bucket: S3_BUCKET }, "S3 upload");
  return url;
}

/**
 * Generate a pre-signed download URL.
 */
export async function getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
  if (!S3_ENDPOINT) return "";
  return `${S3_ENDPOINT}/${S3_BUCKET}/${key}?expires=${expiresIn}`;
}
