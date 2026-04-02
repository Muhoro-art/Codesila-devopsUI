// src/modules/integrations/secrets/secrets.service.ts — Secrets management service
// Uses Prisma OrgSetting model for encrypted key-value secret storage.

import { prisma } from "../../../infra/db";
import crypto from "crypto";
import { env } from "../../../config/env";

const ALGORITHM = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  const key = env.ENCRYPTION_KEY || env.JWT_SECRET;
  return crypto.scryptSync(key, "codesila-salt", 32);
}

/**
 * Encrypt a secret value for storage.
 */
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt a secret value from storage.
 */
export function decryptSecret(ciphertext: string): string {
  const [ivHex, tagHex, encHex] = ciphertext.split(":");
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(Buffer.from(encHex, "hex")) + decipher.final("utf8");
}

/**
 * Store a secret for an organization.
 */
export async function setSecret(orgId: string, secretKey: string, value: string): Promise<void> {
  const encrypted = encryptSecret(value);
  await prisma.orgSetting.upsert({
    where: { orgId_key: { orgId, key: `secret:${secretKey}` } },
    create: { orgId, key: `secret:${secretKey}`, value: encrypted },
    update: { value: encrypted },
  });
}

/**
 * Retrieve a secret for an organization.
 */
export async function getSecret(orgId: string, secretKey: string): Promise<string | null> {
  const setting = await prisma.orgSetting.findUnique({
    where: { orgId_key: { orgId, key: `secret:${secretKey}` } },
  });
  if (!setting) return null;
  return decryptSecret(setting.value);
}
