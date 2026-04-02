import type { Request, Response, NextFunction } from "express";
import { checkLimit } from "../modules/saas/billing/billing.service";

/**
 * Middleware factory: enforce resource creation limits per plan.
 * Usage: router.post("/", requirePlanLimit("projects"), createProjectHandler);
 */
export function requirePlanLimit(resource: "users" | "projects" | "droplets" | "webhooks") {
  return async (_req: Request, res: Response, next: NextFunction) => {
    const user = res.locals.user;
    if (!user?.orgId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const result = await checkLimit(user.orgId, resource);
    if (!result.allowed) {
      return res.status(403).json({
        error: `${resource} limit reached (${result.current}/${result.limit}). Upgrade your plan to add more.`,
        code: "PLAN_LIMIT_EXCEEDED",
        resource,
        current: result.current,
        limit: result.limit,
      });
    }

    return next();
  };
}
