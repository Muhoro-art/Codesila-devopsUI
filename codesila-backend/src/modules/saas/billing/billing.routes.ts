import { Router, Request, Response } from "express";
import { z } from "zod";
import * as billing from "./billing.service";

const router = Router();

// GET /saas/plans — list all available plans
router.get("/plans", async (_req: Request, res: Response) => {
  try {
    const plans = await billing.listPlans();
    res.json({ plans });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /saas/subscription — get current org subscription
router.get("/subscription", async (_req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    const subscription = await billing.getOrgSubscription(orgId);
    res.json({ subscription });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /saas/subscription — create subscription
const createSubSchema = z.object({
  planId: z.string(),
  billingCycle: z.enum(["MONTHLY", "ANNUAL"]).optional(),
  trialDays: z.number().int().min(0).max(90).optional(),
});

router.post("/subscription", async (req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    const body = createSubSchema.parse(req.body);
    const subscription = await billing.createSubscription({
      orgId,
      planId: body.planId,
      billingCycle: body.billingCycle as any,
      trialDays: body.trialDays,
    });
    res.status(201).json({ subscription });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /saas/subscription/plan — change plan
const changePlanSchema = z.object({ planId: z.string() });

router.put("/subscription/plan", async (req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    const { planId } = changePlanSchema.parse(req.body);
    const subscription = await billing.changePlan(orgId, planId);
    res.json({ subscription });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /saas/subscription/cancel — cancel subscription
router.post("/subscription/cancel", async (req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    const immediate = req.body.immediate === true;
    const subscription = await billing.cancelSubscription(orgId, immediate);
    res.json({ subscription });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /saas/subscription/reactivate — reactivate cancelled subscription
router.post("/subscription/reactivate", async (req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    const subscription = await billing.reactivateSubscription(orgId);
    res.json({ subscription });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /saas/invoices — list invoices
router.get("/invoices", async (_req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    const invoices = await billing.listInvoices(orgId);
    res.json({ invoices });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /saas/limits — get current org limits
router.get("/limits", async (_req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    const limits = await billing.getOrgLimits(orgId);
    res.json({ limits });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /saas/limits/check/:resource — check if allowed to create resource
router.get("/limits/check/:resource", async (req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    const resource = req.params.resource as "users" | "projects" | "droplets" | "webhooks";
    const result = await billing.checkLimit(orgId, resource);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
