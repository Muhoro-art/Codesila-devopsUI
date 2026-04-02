import { Router, Request, Response } from "express";
import { z } from "zod";
import * as exports from "./exports.service";

const router = Router();

// GET /saas/exports — list exports
router.get("/", async (_req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    const list = await exports.listExports(orgId);
    res.json({ exports: list });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /saas/exports — request new export
const requestSchema = z.object({
  type: z.enum(["FULL_ORG", "USER_DATA", "AUDIT_LOGS", "PROJECTS", "BILLING"]),
  format: z.enum(["json", "csv"]).optional(),
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const { orgId, sub: userId } = res.locals.user;
    const body = requestSchema.parse(req.body);

    const exportReq = await exports.requestExport({
      orgId,
      requestedById: userId,
      type: body.type as any,
      format: body.format,
    });

    // Process immediately (in production, queue this)
    exports.processExport(exportReq.id).catch(() => {});

    res.status(202).json({ export: exportReq });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /saas/exports/:id — get export status
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    const exp = await exports.getExport(req.params.id, orgId);
    if (!exp) return res.status(404).json({ error: "Export not found" });
    res.json({ export: exp });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /saas/exports/:id/download — download export
router.get("/:id/download", async (req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    const exp = await exports.getExport(req.params.id, orgId);
    if (!exp) return res.status(404).json({ error: "Export not found" });
    if (exp.status !== "COMPLETED") return res.status(400).json({ error: "Export not ready" });
    if (exp.expiresAt && exp.expiresAt < new Date()) {
      return res.status(410).json({ error: "Export link has expired" });
    }

    // In production, redirect to signed S3 URL
    // For now, re-generate the data
    const data = await exports.processExport(exp.id);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="codesila-export-${exp.type.toLowerCase()}-${exp.id}.json"`);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
