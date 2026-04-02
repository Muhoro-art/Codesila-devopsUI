import type { Request, Response, NextFunction } from "express";
import { validateApiKey } from "../modules/saas/apikeys/apikeys.service";
import { logSecurityEvent } from "../config/logger";

/**
 * In-memory per-API-key rate limit tracker.
 * Replace with Redis for multi-instance production deployments.
 */
const apiKeyUsage = new Map<string, { count: number; windowStart: number }>();

// Cleanup expired windows every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, usage] of apiKeyUsage.entries()) {
    if (now - usage.windowStart > 3600_000) {
      apiKeyUsage.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Check per-API-key rate limit.
 * Returns true if within limit, false if exceeded.
 */
function checkApiKeyRateLimit(keyId: string, limitPerHour: number): boolean {
  const now = Date.now();
  const usage = apiKeyUsage.get(keyId);

  if (!usage || now - usage.windowStart > 3600_000) {
    // New window
    apiKeyUsage.set(keyId, { count: 1, windowStart: now });
    return true;
  }

  usage.count += 1;
  return usage.count <= limitPerHour;
}

/**
 * Middleware: authenticate via API key (Bearer token starting with "csk_live_")
 * This is an alternative to JWT auth for programmatic access.
 * Falls through to next middleware if no API key is present.
 */
export async function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header) return next();

  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return next();

  // Only intercept API key tokens (csk_live_ prefix)
  if (!token.startsWith("csk_live_")) return next();

  const key = await validateApiKey(token);
  if (!key) {
    logSecurityEvent({
      event: "API_KEY_INVALID",
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      requestId: (req as any).requestId,
      severity: "HIGH",
      details: { prefix: token.slice(0, 12) },
    });
    return res.status(401).json({ error: "Invalid or expired API key" });
  }

  if (!key.owner.isActive) {
    logSecurityEvent({
      event: "FORBIDDEN_ACCESS",
      userId: key.owner.id,
      ip: req.ip,
      severity: "HIGH",
      details: { reason: "api_key_owner_deactivated", keyId: key.id },
    });
    return res.status(403).json({ error: "Account deactivated" });
  }

  // Enforce per-API-key rate limit
  if (key.rateLimit && !checkApiKeyRateLimit(key.id, key.rateLimit)) {
    logSecurityEvent({
      event: "API_KEY_RATE_LIMITED",
      userId: key.owner.id,
      ip: req.ip,
      severity: "MEDIUM",
      details: { keyId: key.id, rateLimit: key.rateLimit },
    });
    return res.status(429).json({
      error: "API key rate limit exceeded",
      retryAfter: "3600",
    });
  }

  // Set res.locals.user similar to JWT auth
  res.locals.user = {
    sub: key.owner.id,
    role: key.owner.role,
    orgId: key.owner.orgId,
    apiKeyId: key.id,
    scopes: key.scopes.split(",").map((s: string) => s.trim()),
  };

  return next();
}

/**
 * Middleware factory: require specific API key scopes.
 * Usage: router.post("/", requireScope("write"), handler);
 */
export function requireScope(...requiredScopes: string[]) {
  return (_req: Request, res: Response, next: NextFunction) => {
    const user = res.locals.user;
    if (!user) return res.status(401).json({ error: "Authentication required" });

    // If not using API key, allow (JWT users have full access)
    if (!user.scopes) return next();

    const hasScope = requiredScopes.some(
      (s) => user.scopes.includes(s) || user.scopes.includes("admin")
    );

    if (!hasScope) {
      logSecurityEvent({
        event: "FORBIDDEN_ACCESS",
        userId: user.sub,
        severity: "MEDIUM",
        details: {
          reason: "insufficient_scope",
          required: requiredScopes,
          actual: user.scopes,
        },
      });
      return res.status(403).json({
        error: `Insufficient API key scope. Required: ${requiredScopes.join(" or ")}`,
        code: "INSUFFICIENT_SCOPE",
      });
    }

    return next();
  };
}
