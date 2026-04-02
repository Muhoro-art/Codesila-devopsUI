import type { Request, Response, NextFunction } from "express";
import { recordUsage } from "../modules/saas/usage/usage.service";

/**
 * Middleware: track API usage per org for the current billing period.
 * Lightweight — fires async, does not block requests.
 */
export function trackUsage(req: Request, res: Response, next: NextFunction) {
  // Fire after response is sent
  res.on("finish", () => {
    const user = res.locals.user;
    if (!user?.orgId) return;

    // Only track successful API calls
    if (res.statusCode < 400) {
      recordUsage(user.orgId, "API_CALLS").catch(() => {});
    }
  });

  next();
}
