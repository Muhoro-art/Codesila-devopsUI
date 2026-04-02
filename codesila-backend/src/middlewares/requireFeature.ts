import type { Request, Response, NextFunction } from "express";
import { isFeatureEnabled } from "../modules/saas/features/features.service";

/**
 * Middleware factory: gate a route behind a feature flag.
 * Usage: app.use("/sso", requireFeature("sso"), ssoRouter);
 */
export function requireFeature(featureKey: string) {
  return async (_req: Request, res: Response, next: NextFunction) => {
    const user = res.locals.user;
    if (!user?.orgId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const enabled = await isFeatureEnabled(user.orgId, featureKey);
    if (!enabled) {
      return res.status(403).json({
        error: `Feature "${featureKey}" is not available on your current plan. Please upgrade.`,
        code: "FEATURE_NOT_AVAILABLE",
        feature: featureKey,
      });
    }

    return next();
  };
}
