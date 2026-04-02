// src/middlewares/security.ts
// Centralized security middleware stack — request ID, input sanitization,
// suspicious activity detection, and security headers.

import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { logSecurityEvent } from "../config/logger";
import { detectSqlInjection, detectPathTraversal } from "../shared/utils/sanitize";

/**
 * Adds a unique X-Request-ID to every request for tracing.
 */
export function requestId(req: Request, res: Response, next: NextFunction) {
  const id = (req.headers["x-request-id"] as string) || crypto.randomUUID();
  req.headers["x-request-id"] = id;
  res.setHeader("X-Request-ID", id);
  (req as any).requestId = id;
  next();
}

/**
 * Detect and block suspicious input patterns (SQLi, path traversal).
 * Runs on all incoming request bodies and query parameters.
 */
export function inputProtection(req: Request, res: Response, next: NextFunction) {
  const valuesToCheck: string[] = [];

  // Body fields that legitimately contain code/YAML/markdown/natural language — skip SQL-pattern checks
  const codeContentFields = new Set([
    "config_yaml", "configYaml", "content", "command", "script",
    "pipelineYaml", "markdown", "body",
    "query", "history", "description", "summary",
  ]);

  // Collect all query parameters
  for (const val of Object.values(req.query)) {
    if (typeof val === "string") valuesToCheck.push(val);
  }

  // Collect URL params
  for (const val of Object.values(req.params)) {
    if (typeof val === "string") valuesToCheck.push(val);
  }

  // Collect body string values (shallow — deep objects are checked by Zod)
  // Skip known code-content fields that naturally contain #, --, SQL keywords, etc.
  if (req.body && typeof req.body === "object") {
    for (const [key, val] of Object.entries(req.body)) {
      if (typeof val === "string" && !codeContentFields.has(key)) {
        valuesToCheck.push(val);
      }
    }
  }

  for (const value of valuesToCheck) {
    if (detectSqlInjection(value)) {
      logSecurityEvent({
        event: "SQL_INJECTION_ATTEMPT",
        ip: req.ip,
        userAgent: req.headers["user-agent"],
        requestId: (req as any).requestId,
        resource: req.originalUrl,
        severity: "CRITICAL",
        details: { method: req.method },
      });
      return res.status(400).json({ error: "Invalid input detected" });
    }

    if (detectPathTraversal(value)) {
      logSecurityEvent({
        event: "SUSPICIOUS_ACTIVITY",
        ip: req.ip,
        userAgent: req.headers["user-agent"],
        requestId: (req as any).requestId,
        resource: req.originalUrl,
        severity: "HIGH",
        details: { type: "path_traversal", method: req.method },
      });
      return res.status(400).json({ error: "Invalid input detected" });
    }
  }

  next();
}

/**
 * Additional security headers beyond what Helmet provides.
 */
export function extraSecurityHeaders(_req: Request, res: Response, next: NextFunction) {
  // Prevent caching of sensitive API responses
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");

  // Permissions policy — restrict browser features
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()"
  );

  // Prevent content-type sniffing (also in Helmet, but double-ensure)
  res.setHeader("X-Content-Type-Options", "nosniff");

  // Referrer policy — don't leak full URLs
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  // Remove powered-by header (also done by Helmet)
  res.removeHeader("X-Powered-By");

  next();
}

/**
 * Log slow requests that might indicate DoS or abuse.
 */
export function requestTiming(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    // Log requests that take more than 5 seconds
    if (duration > 5000) {
      logSecurityEvent({
        event: "SUSPICIOUS_ACTIVITY",
        ip: req.ip,
        requestId: (req as any).requestId,
        resource: req.originalUrl,
        severity: "MEDIUM",
        details: { type: "slow_request", durationMs: duration, method: req.method },
      });
    }
  });

  next();
}
