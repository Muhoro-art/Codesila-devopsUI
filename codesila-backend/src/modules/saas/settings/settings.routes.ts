import { Router, Request, Response } from "express";
import { z } from "zod";
import * as settings from "./settings.service";

const router = Router();

// ─── Org Settings ───────────────────────────────────────────

// GET /saas/settings/org — get all org settings
router.get("/org", async (_req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    const orgSettings = await settings.getOrgSettings(orgId);
    res.json({ settings: orgSettings });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /saas/settings/org — batch update org settings
const orgSettingsSchema = z.record(z.string(), z.string());

router.put("/org", async (req: Request, res: Response) => {
  try {
    const { orgId, role } = res.locals.user;
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Admin access required" });
    }
    const body = orgSettingsSchema.parse(req.body);
    await settings.setOrgSettingsBatch(orgId, body);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Org Profile ────────────────────────────────────────────

// GET /saas/settings/org/profile — get org profile
router.get("/org/profile", async (_req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    const profile = await settings.getOrgProfile(orgId);
    res.json({ profile });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /saas/settings/org/profile — update org profile
const orgProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  logoUrl: z.string().url().optional(),
  domain: z.string().max(100).optional(),
  industry: z.string().max(100).optional(),
  size: z.enum(["SOLO", "SMALL", "MEDIUM", "LARGE", "ENTERPRISE"]).optional(),
});

router.put("/org/profile", async (req: Request, res: Response) => {
  try {
    const { orgId, role } = res.locals.user;
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Admin access required" });
    }
    const body = orgProfileSchema.parse(req.body);
    const profile = await settings.updateOrgProfile(orgId, body);
    res.json({ profile });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ─── User Preferences ──────────────────────────────────────

// GET /saas/settings/user — get user preferences
router.get("/user", async (_req: Request, res: Response) => {
  try {
    const { sub: userId } = res.locals.user;
    const prefs = await settings.getUserPreferences(userId);
    res.json({ preferences: prefs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /saas/settings/user — batch update preferences
const userPrefsSchema = z.record(z.string(), z.string());

router.put("/user", async (req: Request, res: Response) => {
  try {
    const { sub: userId } = res.locals.user;
    const body = userPrefsSchema.parse(req.body);
    await settings.setUserPreferencesBatch(userId, body);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ─── User Profile ───────────────────────────────────────────

// PUT /saas/settings/user/profile — update user profile
const userProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().optional(),
  timezone: z.string().max(50).optional(),
  locale: z.string().max(10).optional(),
});

router.put("/user/profile", async (req: Request, res: Response) => {
  try {
    const { sub: userId } = res.locals.user;
    const body = userProfileSchema.parse(req.body);
    const profile = await settings.updateUserProfile(userId, body);
    res.json({ profile });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /saas/settings/user/onboarding-complete — mark onboarding done
router.post("/user/onboarding-complete", async (_req: Request, res: Response) => {
  try {
    const { sub: userId } = res.locals.user;
    await settings.completeOnboarding(userId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
