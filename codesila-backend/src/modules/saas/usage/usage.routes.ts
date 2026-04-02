import { Router, Request, Response } from "express";
import * as usage from "./usage.service";

const router = Router();

// GET /saas/usage — current period usage summary
router.get("/", async (_req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    const summary = await usage.getUsageSummary(orgId);
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /saas/usage/current — raw current period metrics
router.get("/current", async (_req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    const current = await usage.getCurrentUsage(orgId);
    res.json({ usage: current });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /saas/usage/history/:metric — usage history for a metric
router.get("/history/:metric", async (req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    const months = parseInt(req.query.months as string) || 6;
    const history = await usage.getUsageHistory(orgId, req.params.metric as any, months);
    res.json({
      history: history.map((r) => ({
        metric: r.metric,
        value: Number(r.value),
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
