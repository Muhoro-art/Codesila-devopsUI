import { Router, Request, Response } from "express";
import * as audit from "./audit.service";

const router = Router();

// GET /saas/audit — list audit logs with filters
router.get("/", async (req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    const result = await audit.listAuditLogs(orgId, {
      actorId: req.query.actorId as string,
      entityType: req.query.entityType as string,
      action: req.query.action as string,
      projectId: req.query.projectId as string,
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      limit,
      offset,
    });

    res.json({ auditLogs: result.items, total: result.total, limit, offset });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /saas/audit/stats — audit activity stats
router.get("/stats", async (req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    const days = parseInt(req.query.days as string) || 30;
    const stats = await audit.getAuditStats(orgId, days);
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
