import { Router, Request, Response } from "express";
import { z } from "zod";
import * as apikeys from "./apikeys.service";

const router = Router();

// GET /saas/api-keys — list all API keys for org
router.get("/", async (_req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    const keys = await apikeys.listApiKeys(orgId);
    res.json({ apiKeys: keys });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /saas/api-keys — create new API key
const createSchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.string().optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  rateLimit: z.number().int().min(10).max(100000).optional(),
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const { orgId, sub: userId } = res.locals.user;
    const body = createSchema.parse(req.body);
    const key = await apikeys.createApiKey({
      orgId,
      userId,
      name: body.name,
      scopes: body.scopes,
      expiresInDays: body.expiresInDays,
      rateLimit: body.rateLimit,
    });
    // Return the raw key ONLY on creation — client must store it
    res.status(201).json({
      apiKey: {
        id: key.id,
        name: key.name,
        keyPrefix: key.keyPrefix,
        scopes: key.scopes,
        expiresAt: key.expiresAt,
        rateLimit: key.rateLimit,
        rawKey: key.rawKey, // ⚠️ only returned once
      },
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /saas/api-keys/:id — update API key
const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  scopes: z.string().optional(),
  rateLimit: z.number().int().min(10).max(100000).optional(),
});

router.put("/:id", async (req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    const body = updateSchema.parse(req.body);
    await apikeys.updateApiKey(req.params.id, orgId, body);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /saas/api-keys/:id — revoke API key
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    await apikeys.revokeApiKey(req.params.id, orgId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
