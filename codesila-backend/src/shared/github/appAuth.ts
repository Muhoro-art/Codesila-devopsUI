// src/shared/github/appAuth.ts
// GitHub App authentication: JWT signing + installation access tokens.
// Installation tokens are org-scoped and auto-expire (1 hour).
// This replaces personal OAuth tokens for all API calls.

import crypto from "crypto";
import { env } from "../../config/env";

/**
 * Create a JWT to authenticate as the GitHub App (RS256).
 * Short-lived (10 min) — only used to request installation tokens.
 */
function createAppJWT(): string {
  const now = Math.floor(Date.now() / 1000);

  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iat: now - 60,          // 60s clock-drift tolerance
      exp: now + 10 * 60,     // 10-minute expiry
      iss: env.GITHUB_APP_ID, // GitHub App ID (numeric string)
    })
  ).toString("base64url");

  const unsigned = `${header}.${payload}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(unsigned);
  // Private key may have literal \n — normalise to real newlines
  const pem = env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n");
  const signature = sign.sign(pem, "base64url");

  return `${unsigned}.${signature}`;
}

// ── In-memory cache for installation access tokens ──────────
const tokenCache = new Map<number, { token: string; expiresAt: number }>();

/**
 * Get a short-lived installation access token from GitHub.
 * Cached and reused until 5 minutes before expiry.
 */
export async function getInstallationToken(installationId: number): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) {
    return cached.token;
  }

  const jwt = createAppJWT();

  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
      },
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub App token exchange failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { token: string; expires_at: string };
  const expiresAt = new Date(data.expires_at).getTime();
  tokenCache.set(installationId, { token: data.token, expiresAt });
  return data.token;
}

/**
 * True when the App ID + Private Key are both configured,
 * meaning we can use installation tokens instead of personal OAuth.
 */
export function isAppAuthConfigured(): boolean {
  return !!(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY);
}

/**
 * List all installations of this GitHub App.
 * Used to auto-detect the installationId for an org/user.
 */
export async function listAppInstallations(): Promise<Array<{
  id: number;
  account: { login: string; type: string; avatar_url?: string };
}>> {
  const jwt = createAppJWT();
  const res = await fetch("https://api.github.com/app/installations?per_page=100", {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to list App installations (${res.status}): ${body}`);
  }
  return (await res.json()) as Array<{ id: number; account: { login: string; type: string; avatar_url?: string } }>;
}
