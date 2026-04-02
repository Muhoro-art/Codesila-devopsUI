import rateLimit, { MemoryStore } from "express-rate-limit";
import slowDown from "express-slow-down";
import { SECURITY } from "../config/constants";
import { logSecurityEvent } from "../config/logger";
import type { Request, Response } from "express";

/** Shared stores – exported so integration tests can call resetAll(). */
export const authRateLimitStore = new MemoryStore();
export const apiRateLimitStore = new MemoryStore();

/**
 * Rate limiter for auth endpoints (login, register, 2FA).
 * 5 attempts per 15-minute window per IP (reduced from 10).
 */
export const authRateLimiter = rateLimit({
  windowMs: SECURITY.RATE_LIMIT.AUTH_WINDOW_MS,
  max: SECURITY.RATE_LIMIT.AUTH_MAX_ATTEMPTS,
  store: authRateLimitStore,
  message: { error: "Too many authentication attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Only count failures toward the limit
  handler: (req: Request, res: Response) => {
    logSecurityEvent({
      event: "RATE_LIMIT_EXCEEDED",
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      requestId: (req as any).requestId,
      resource: req.originalUrl,
      severity: "HIGH",
      details: { type: "auth_rate_limit" },
    });
    res.status(429).json({
      error: "Too many authentication attempts. Please try again later.",
    });
  },
});

/**
 * Progressive slow-down for auth endpoints.
 * Adds increasing delay after 3 requests in window.
 */
export const authSlowDown = slowDown({
  windowMs: SECURITY.RATE_LIMIT.AUTH_WINDOW_MS,
  delayAfter: SECURITY.RATE_LIMIT.SLOW_DOWN_DELAY_AFTER,
  delayMs: (used: number) =>
    (used - SECURITY.RATE_LIMIT.SLOW_DOWN_DELAY_AFTER) *
    SECURITY.RATE_LIMIT.SLOW_DOWN_DELAY_MS,
  maxDelayMs: 10_000, // Max 10s delay
});

/**
 * General API rate limiter.
 * 100 requests per minute per IP.
 */
export const apiRateLimiter = rateLimit({
  windowMs: SECURITY.RATE_LIMIT.API_WINDOW_MS,
  max: SECURITY.RATE_LIMIT.API_MAX_REQUESTS,
  store: apiRateLimitStore,
  message: { error: "Too many requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    logSecurityEvent({
      event: "RATE_LIMIT_EXCEEDED",
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      requestId: (req as any).requestId,
      resource: req.originalUrl,
      severity: "MEDIUM",
      details: { type: "api_rate_limit" },
    });
    res.status(429).json({
      error: "Too many requests. Please try again later.",
    });
  },
});

/**
 * Strict rate limiter for sensitive operations (password change, 2FA setup).
 * 3 requests per 15 minutes.
 */
export const sensitiveOpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: { error: "Too many attempts on this action. Please wait." },
  standardHeaders: true,
  legacyHeaders: false,
});
