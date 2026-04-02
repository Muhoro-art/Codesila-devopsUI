import type { Request, Response, NextFunction } from "express";
import logger from "../config/logger";

/**
 * Global error handler middleware.
 * Must be registered AFTER all routes (4-argument signature required by Express).
 *
 * Security hardening:
 * - NEVER leaks stack traces, internal paths, or DB errors to clients
 * - Logs full errors server-side for debugging
 * - Uses request ID for correlation
 * - Sanitizes error messages
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  const requestId = (req as any).requestId ?? "unknown";
  const status = (err as any).statusCode ?? 500;

  // Log the full error server-side (never to client)
  logger.error(
    {
      err: {
        message: err.message,
        stack: err.stack,
        name: err.name,
      },
      requestId,
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      userId: res.locals.user?.sub,
    },
    `[ERROR] ${err.message}`
  );

  // Generic error messages for all environments in production
  // In dev, show the error message but NEVER the stack trace via API
  const isProduction = process.env.NODE_ENV === "production";

  // Never expose these internal error patterns to clients
  const sensitivePatterns = [
    /prisma/i, /database/i, /postgres/i, /sql/i,
    /ECONNREFUSED/, /ENOTFOUND/, /timeout/i,
    /internal/i, /stack/i, /at\s+\w+/,
    /node_modules/, /\.ts:/, /\.js:/,
  ];

  let clientMessage = "An unexpected error occurred";

  if (!isProduction && status < 500) {
    // In dev, show app-level error messages (400, 401, 403, etc.)
    const isSensitive = sensitivePatterns.some((p) => p.test(err.message));
    clientMessage = isSensitive ? "An unexpected error occurred" : err.message;
  } else if (status < 500) {
    // In production, only show safe client errors
    const safeMessages = [
      "Not found", "Unauthorized", "Forbidden", "Bad request",
      "Validation failed", "Invalid input",
    ];
    const isSafe = safeMessages.some((m) =>
      err.message.toLowerCase().includes(m.toLowerCase())
    );
    clientMessage = isSafe ? err.message : "Request could not be processed";
  }

  res.status(status).json({
    error: clientMessage,
    requestId, // Include for support correlation
  });
}
