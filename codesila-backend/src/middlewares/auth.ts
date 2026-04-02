import jwt, { type JwtPayload } from "jsonwebtoken";
import { env } from "../config/env";
import { SECURITY } from "../config/constants";
import { logSecurityEvent } from "../config/logger";
import type { Request, Response, NextFunction } from "express";
import { prisma } from "../infra/db";

export type AuthUser = JwtPayload & {
  sub: string;      // userId
  role: string;
  orgId: string;
  email: string;
  type?: "access" | "refresh";
};

/**
 * JWT verification options — pinned algorithm, issuer, audience.
 * Prevents algorithm confusion attacks and token misuse.
 */
const JWT_VERIFY_OPTIONS: jwt.VerifyOptions = {
  algorithms: [SECURITY.JWT.ALGORITHM],
  issuer: SECURITY.JWT.ISSUER,
  audience: SECURITY.JWT.AUDIENCE,
  clockTolerance: SECURITY.JWT.CLOCK_TOLERANCE,
};

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  // Support token from query string for SSE (EventSource cannot set custom headers)
  const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;

  if (!header && !queryToken) {
    return res.status(401).json({ success: false, error: { code: "NO_TOKEN", message: "Missing Authorization header" }, code: "NO_TOKEN" });
  }

  let token: string | undefined;
  if (header) {
    const [scheme, t] = header.split(" ");
    if (scheme !== "Bearer" || !t) {
      return res.status(401).json({ success: false, error: { code: "INVALID_TOKEN", message: "Invalid Authorization header format" }, code: "INVALID_TOKEN" });
    }
    token = t;
  } else {
    token = queryToken;
  }

  // Reject obviously invalid tokens (basic format check)
  if (token.split(".").length !== 3) {
    logSecurityEvent({
      event: "AUTH_TOKEN_INVALID",
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      requestId: (req as any).requestId,
      severity: "MEDIUM",
      details: { reason: "malformed_token" },
    });
    return res.status(401).json({ success: false, error: { code: "INVALID_TOKEN", message: "Invalid token" }, code: "INVALID_TOKEN" });
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET, JWT_VERIFY_OPTIONS) as AuthUser;

    // Ensure this is an access token, not a refresh token
    if (payload.type === "refresh") {
      return res.status(401).json({ success: false, error: { code: "INVALID_TOKEN", message: "Invalid token type" }, code: "INVALID_TOKEN" });
    }

    // Verify user is still active in database
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { isActive: true, passwordChangedAt: true },
    });

    if (!user || !user.isActive) {
      logSecurityEvent({
        event: "FORBIDDEN_ACCESS",
        userId: payload.sub,
        orgId: payload.orgId,
        ip: req.ip,
        severity: "HIGH",
        details: { reason: user ? "account_deactivated" : "user_not_found" },
      });
      return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Access revoked" }, code: "FORBIDDEN" });
    }

    // Invalidate tokens issued before the most recent password change
    if (user.passwordChangedAt && payload.iat) {
      const passwordChangedTimestamp = Math.floor(user.passwordChangedAt.getTime() / 1000);
      if (payload.iat < passwordChangedTimestamp) {
        logSecurityEvent({
          event: "AUTH_TOKEN_EXPIRED",
          userId: payload.sub,
          ip: req.ip,
          severity: "MEDIUM",
          details: { reason: "password_changed_after_token_issued" },
        });
        return res.status(401).json({ success: false, error: { code: "INVALID_TOKEN", message: "Token invalidated. Please log in again." }, code: "INVALID_TOKEN" });
      }
    }

    res.locals.user = payload;
    return next();
  } catch (err) {
    const isExpired = err instanceof jwt.TokenExpiredError;
    const message = isExpired
      ? "Token expired"
      : err instanceof jwt.NotBeforeError
      ? "Token not yet valid"
      : "Invalid or expired token";
    const code = isExpired ? "TOKEN_EXPIRED" : "INVALID_TOKEN";

    logSecurityEvent({
      event: "AUTH_TOKEN_INVALID",
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      requestId: (req as any).requestId,
      severity: "MEDIUM",
      details: { reason: message },
    });

    return res.status(401).json({ success: false, error: { code, message }, code });
  }
}
