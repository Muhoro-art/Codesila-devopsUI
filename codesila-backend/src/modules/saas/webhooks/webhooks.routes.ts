import { Router, Request, Response } from "express";
import { z } from "zod";
import * as webhooks from "./webhooks.service";
import { checkLimit } from "../billing/billing.service";

const VALID_EVENTS = [
  "*",
  "project.created",
  "project.updated",
  "project.deleted",
  "deployment.started",
  "deployment.completed",
  "deployment.failed",
  "incident.opened",
  "incident.resolved",
  "member.added",
  "member.removed",
  "invitation.sent",
  "invitation.accepted",
  "build.started",
  "build.completed",
  "build.failed",
];

const router = Router();

// GET /saas/webhooks — list webhook endpoints
router.get("/", async (_req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    const endpoints = await webhooks.listWebhookEndpoints(orgId);
    res.json({ webhooks: endpoints });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /saas/webhooks/events — list available events
router.get("/events", (_req: Request, res: Response) => {
  res.json({ events: VALID_EVENTS });
});

// GET /saas/webhooks/:id — get webhook with recent deliveries
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    const webhook = await webhooks.getWebhookEndpoint(req.params.id, orgId);
    if (!webhook) return res.status(404).json({ error: "Webhook not found" });
    res.json({ webhook });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /saas/webhooks — create webhook endpoint
const createSchema = z.object({
  url: z.string().url(),
  description: z.string().max(200).optional(),
  events: z.array(z.string()).min(1),
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;

    // Check webhook limits
    const limitCheck = await checkLimit(orgId, "webhooks");
    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: `Webhook limit reached (${limitCheck.current}/${limitCheck.limit}). Upgrade plan.`,
      });
    }

    const body = createSchema.parse(req.body);
    const endpoint = await webhooks.createWebhookEndpoint({
      orgId,
      url: body.url,
      description: body.description,
      events: body.events,
    });
    res.status(201).json({ webhook: endpoint });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /saas/webhooks/:id — update webhook
const updateSchema = z.object({
  url: z.string().url().optional(),
  description: z.string().max(200).optional(),
  events: z.array(z.string()).min(1).optional(),
  status: z.enum(["ACTIVE", "PAUSED", "DISABLED"]).optional(),
});

router.put("/:id", async (req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    const body = updateSchema.parse(req.body);
    await webhooks.updateWebhookEndpoint(req.params.id, orgId, body);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /saas/webhooks/:id — delete webhook
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    await webhooks.deleteWebhookEndpoint(req.params.id, orgId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /saas/webhooks/:id/rotate-secret — rotate signing secret
router.post("/:id/rotate-secret", async (req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    const newSecret = await webhooks.rotateWebhookSecret(req.params.id, orgId);
    res.json({ secret: newSecret });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /saas/webhooks/test — test a webhook endpoint
router.post("/test", async (req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    await webhooks.dispatchWebhook(orgId, "webhook.test", {
      event: "webhook.test",
      orgId,
      timestamp: new Date().toISOString(),
      message: "This is a test webhook delivery from CodeSila",
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
