// src/config/logger.ts
// Structured logging with security audit trail using Pino.
// All security events are tagged for easy filtering.

import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: isProduction ? "info" : "debug",
  ...(isProduction
    ? {
        // JSON output in production (ingestible by log aggregators)
        formatters: {
          level: (label: string) => ({ level: label }),
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      }
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss.l",
            ignore: "pid,hostname",
          },
        },
      }),
  // Redact sensitive fields from ever appearing in logs
  redact: {
    paths: [
      "password",
      "passwordHash",
      "token",
      "accessToken",
      "refreshToken",
      "secret",
      "twoFactorSecret",
      "apiKey",
      "rawKey",
      "authorization",
      "req.headers.authorization",
      "req.headers.cookie",
      "body.password",
      "body.currentPassword",
      "body.newPassword",
    ],
    censor: "[REDACTED]",
  },
});

// ─── Security Audit Logger ─────────────────────────────────────
// All security-relevant events routed through here for compliance.

export type SecurityEventType =
  | "AUTH_LOGIN_SUCCESS"
  | "AUTH_LOGIN_FAILED"
  | "AUTH_LOGIN_LOCKED"
  | "AUTH_REGISTER"
  | "AUTH_LOGOUT"
  | "AUTH_TOKEN_REFRESH"
  | "AUTH_2FA_GENERATED"
  | "AUTH_2FA_VERIFIED"
  | "AUTH_2FA_FAILED"
  | "AUTH_PASSWORD_CHANGED"
  | "AUTH_ACCOUNT_LOCKED"
  | "AUTH_ACCOUNT_UNLOCKED"
  | "USER_CREATED"
  | "USER_ACTIVATED"
  | "USER_DEACTIVATED"
  | "USER_ROLE_CHANGED"
  | "API_KEY_CREATED"
  | "API_KEY_REVOKED"
  | "API_KEY_INVALID"
  | "OAUTH_STATE_INVALID"
  | "OAUTH_CALLBACK"
  | "WEBHOOK_SIGNATURE_INVALID"
  | "WEBHOOK_PROCESSED"
  | "RATE_LIMIT_EXCEEDED"
  | "PERMISSION_DENIED"
  | "SUSPICIOUS_ACTIVITY"
  | "CSRF_TOKEN_INVALID"
  | "INPUT_VALIDATION_FAILED"
  | "SESSION_INVALIDATED";

export interface SecurityEvent {
  event: SecurityEventType;
  userId?: string;
  orgId?: string;
  ip?: string;
  userAgent?: string;
  resource?: string;
  action?: string;
  success: boolean;
  reason?: string;
  metadata?: Record<string, unknown>;
}

const securityLogger = logger.child({ module: "security-audit" });

export function auditLog(event: SecurityEvent): void {
  const payload = {
    ...event,
    timestamp: new Date().toISOString(),
  };

  if (event.success) {
    securityLogger.info(payload, `[AUDIT] ${event.event}`);
  } else {
    securityLogger.warn(payload, `[AUDIT] ${event.event}`);
  }
}

// ─── Convenience function used throughout the codebase ─────────
// Accepts severity/details instead of success/reason for quick logging.

export type SecuritySeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface LogSecurityEventInput {
  event: string;
  userId?: string;
  orgId?: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  resource?: string;
  severity?: SecuritySeverity;
  details?: Record<string, unknown>;
}

export function logSecurityEvent(input: LogSecurityEventInput): void {
  const { event, severity = "MEDIUM", details, ...rest } = input;
  const payload = {
    event,
    severity,
    ...rest,
    ...(details ? { metadata: details } : {}),
    timestamp: new Date().toISOString(),
  };

  if (severity === "HIGH" || severity === "CRITICAL") {
    securityLogger.warn(payload, `[SECURITY] ${event}`);
  } else {
    securityLogger.info(payload, `[SECURITY] ${event}`);
  }
}

export default logger;
