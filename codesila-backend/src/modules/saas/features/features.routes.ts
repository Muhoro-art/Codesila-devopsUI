import { Router, Request, Response } from "express";
import { z } from "zod";
import * as features from "./features.service";

const router = Router();

// GET /saas/features — get current org's feature flags
router.get("/", async (_req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    const flags = await features.getOrgFeatures(orgId);
    res.json({ features: flags });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /saas/features/check/:key — check single feature
router.get("/check/:key", async (req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    const enabled = await features.isFeatureEnabled(orgId, req.params.key);
    res.json({ key: req.params.key, enabled });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /saas/features/flags — list all flags (admin only)
router.get("/flags", async (_req: Request, res: Response) => {
  try {
    const { role } = res.locals.user;
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Admin access required" });
    }
    const flags = await features.listAllFlags();
    res.json({ flags });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /saas/features/flags — create/update flag (admin only)
const flagSchema = z.object({
  key: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  defaultOn: z.boolean().optional(),
  isGlobal: z.boolean().optional(),
});

router.post("/flags", async (req: Request, res: Response) => {
  try {
    const { role } = res.locals.user;
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Admin access required" });
    }
    const body = flagSchema.parse(req.body);
    const flag = await features.upsertFlag(body);
    res.json({ flag });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /saas/features/override/:key — set per-org override (admin)
const overrideSchema = z.object({ enabled: z.boolean() });

router.put("/override/:key", async (req: Request, res: Response) => {
  try {
    const { role } = res.locals.user;
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Admin access required" });
    }
    const { orgId } = res.locals.user;
    const { enabled } = overrideSchema.parse(req.body);
    const override = await features.setFeatureOverride(orgId, req.params.key, enabled);
    res.json({ override });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /saas/features/override/:key — remove per-org override
router.delete("/override/:key", async (req: Request, res: Response) => {
  try {
    const { role } = res.locals.user;
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Admin access required" });
    }
    const { orgId } = res.locals.user;
    await features.removeFeatureOverride(orgId, req.params.key);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
