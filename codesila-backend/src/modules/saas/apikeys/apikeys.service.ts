import { prisma } from "../../../infra/db";
import crypto from "crypto";

const KEY_PREFIX = "csk_live_";

function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = KEY_PREFIX + crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hash, prefix: raw.slice(0, 12) };
}

export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

export async function createApiKey(data: {
  orgId: string;
  userId: string;
  name: string;
  scopes?: string;
  expiresInDays?: number;
  rateLimit?: number;
}) {
  const { raw, hash, prefix } = generateApiKey();

  const expiresAt = data.expiresInDays
    ? new Date(Date.now() + data.expiresInDays * 86400000)
    : null;

  const key = await prisma.apiKey.create({
    data: {
      orgId: data.orgId,
      userId: data.userId,
      name: data.name,
      keyHash: hash,
      keyPrefix: prefix,
      scopes: data.scopes ?? "read",
      expiresAt,
      rateLimit: data.rateLimit ?? 1000,
    },
  });

  return { ...key, rawKey: raw }; // rawKey is only returned on creation
}

export async function listApiKeys(orgId: string) {
  return prisma.apiKey.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      scopes: true,
      status: true,
      lastUsedAt: true,
      expiresAt: true,
      rateLimit: true,
      createdAt: true,
      owner: { select: { id: true, name: true, email: true } },
    },
  });
}

export async function revokeApiKey(keyId: string, orgId: string) {
  return prisma.apiKey.updateMany({
    where: { id: keyId, orgId },
    data: { status: "REVOKED" },
  });
}

export async function validateApiKey(rawKey: string) {
  const hash = hashApiKey(rawKey);
  const key = await prisma.apiKey.findUnique({
    where: { keyHash: hash },
    include: {
      owner: { select: { id: true, role: true, orgId: true, isActive: true } },
    },
  });

  if (!key) return null;
  if (key.status !== "ACTIVE") return null;
  if (key.expiresAt && key.expiresAt < new Date()) {
    await prisma.apiKey.update({ where: { id: key.id }, data: { status: "EXPIRED" } });
    return null;
  }

  // Update last used
  await prisma.apiKey.update({
    where: { id: key.id },
    data: { lastUsedAt: new Date() },
  });

  return key;
}

export async function updateApiKey(keyId: string, orgId: string, data: {
  name?: string;
  scopes?: string;
  rateLimit?: number;
}) {
  return prisma.apiKey.updateMany({
    where: { id: keyId, orgId },
    data,
  });
}
