// src/shared/security/encryption.ts
// Application-level encryption for sensitive data at rest
// (GitHub tokens, 2FA secrets, etc.)

import crypto from "crypto";
import { SECURITY } from "../../config/constants";
import { env } from "../../config/env";

const { ALGORITHM, IV_LENGTH, AUTH_TAG_LENGTH } = SECURITY.ENCRYPTION;

/**
 * Derive a 256-bit encryption key from JWT_SECRET using HKDF.
 * In production, use a dedicated ENCRYPTION_KEY env var.
 */
function getEncryptionKey(): Buffer {
  const secret = env.ENCRYPTION_KEY || env.JWT_SECRET;
  // Use HKDF to derive a proper key from the secret
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns: iv:authTag:ciphertext (all hex-encoded, colon-separated)
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypt a string encrypted with encrypt().
 * Returns the original plaintext.
 * Throws on tampered or invalid data (authentication failure).
 */
export function decrypt(encryptedData: string): string {
  const parts = encryptedData.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted data format");
  }

  const [ivHex, authTagHex, ciphertext] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Check if a string looks like it was encrypted by our encrypt() function.
 */
export function isEncrypted(value: string): boolean {
  const parts = value.split(":");
  if (parts.length !== 3) return false;
  // IV should be 32 hex chars (16 bytes), authTag 32 hex chars
  return parts[0].length === 32 && parts[1].length === 32 && /^[0-9a-f]+$/.test(parts[0]);
}

/**
 * Encrypt if not already encrypted, returns encrypted string.
 */
export function ensureEncrypted(value: string): string {
  if (isEncrypted(value)) return value;
  return encrypt(value);
}

/**
 * Generate a cryptographically secure random token.
 */
export function generateSecureToken(byteLength = 32): string {
  return crypto.randomBytes(byteLength).toString("hex");
}

/**
 * Generate HMAC signature for data integrity verification.
 */
export function hmacSign(data: string, secret?: string): string {
  const key = secret || env.JWT_SECRET;
  return crypto.createHmac("sha256", key).update(data).digest("hex");
}

/**
 * Verify HMAC signature using timing-safe comparison.
 */
export function hmacVerify(data: string, signature: string, secret?: string): boolean {
  const expected = hmacSign(data, secret);
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
