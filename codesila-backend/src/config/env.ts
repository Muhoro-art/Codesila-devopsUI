import { config } from "dotenv";
import crypto from "crypto";

config();

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`FATAL: Missing required env var: ${key}`);
  }
  return value;
}

function requiredNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Env var ${key} must be a valid number, got: ${raw}`);
  }
  return n;
}

/**
 * Validate that JWT_SECRET has sufficient entropy.
 * Rejects weak/default secrets in production.
 */
function validateJwtSecret(secret: string): void {
  const isProduction = (process.env.NODE_ENV ?? "development") === "production";
  const WEAK_SECRETS = [
    "supersecret_dev_key", "secret", "password", "jwt_secret",
    "changeme", "development", "test", "12345",
  ];

  if (WEAK_SECRETS.includes(secret.toLowerCase().trim())) {
    if (isProduction) {
      throw new Error(
        "FATAL: JWT_SECRET is too weak for production. " +
        "Generate a strong secret: openssl rand -base64 64"
      );
    }
    console.warn(
      "⚠️  WARNING: JWT_SECRET is weak. For production use: openssl rand -base64 64"
    );
  }

  if (isProduction && secret.length < 32) {
    throw new Error(
      "FATAL: JWT_SECRET must be at least 32 characters in production. " +
      "Generate: openssl rand -base64 64"
    );
  }
}

const jwtSecret = required("JWT_SECRET");
validateJwtSecret(jwtSecret);

export const env = {
  // ─── App ───────────────────────────────────────────────────
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: requiredNumber("PORT", 3000),

  // ─── Auth / JWT ────────────────────────────────────────────
  JWT_SECRET: jwtSecret,

  // ─── Encryption key for at-rest data (tokens, 2FA secrets) ──
  // If not set, derived from JWT_SECRET (acceptable for dev only)
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? "",

  // ─── Database ──────────────────────────────────────────────
  DATABASE_URL: required("DATABASE_URL"),

  // ─── CORS — comma-separated origins ────────────────────────
  // NEVER use "*" in production — always specify exact origins.
  CORS_ORIGINS: process.env.CORS_ORIGINS ?? "http://localhost:5173",

  // ─── OpenAI (optional — assistant module) ──────────────────
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",

  // ─── Redis / Queue (optional for now) ──────────────────────
  REDIS_URL: process.env.REDIS_URL ?? "",

  // ─── GitHub OAuth App (optional — integrations module) ─────
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID ?? "",
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET ?? "",
  GITHUB_CALLBACK_URL: process.env.GITHUB_CALLBACK_URL ?? "http://localhost:3000/integrations/github/callback",
  GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET ?? "",

  // ─── GitHub App (installation-level auth — preferred) ──────
  // App ID (numeric) and PEM private key enable org-scoped tokens
  // that don't depend on any individual user's OAuth session.
  GITHUB_APP_ID: process.env.GITHUB_APP_ID ?? "",
  GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY ?? "",
  GITHUB_APP_SLUG: process.env.GITHUB_APP_SLUG ?? "", // e.g. "codesilalabs"

  // ─── HMAC secret for OAuth state signing ───────────────────
  // Prevents CSRF attacks on OAuth callbacks.
  OAUTH_STATE_SECRET: process.env.OAUTH_STATE_SECRET || crypto.randomBytes(32).toString("hex"),

  // ─── DigitalOcean (optional — droplet/SSH management) ──────
  DO_API_TOKEN: process.env.DO_API_TOKEN ?? "",

  // ─── Frontend URL (for redirects) ──────────────────────────
  FRONTEND_URL: process.env.FRONTEND_URL ?? "http://localhost:5173",

  // ─── Trusted proxies (for accurate IP detection) ───────────
  TRUST_PROXY: process.env.TRUST_PROXY ?? "loopback",
};
