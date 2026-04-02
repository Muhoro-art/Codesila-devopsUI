import { Router, Request, Response } from "express";
import { z } from "zod";
import * as invitations from "./invitations.service";
import { checkLimit } from "../billing/billing.service";

const router = Router();

// GET /saas/invitations — list org invitations
router.get("/", async (_req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    const list = await invitations.listInvitations(orgId);
    res.json({ invitations: list });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /saas/invitations — create invitation
const createSchema = z.object({
  email: z.string().email(),
  role: z.enum(["USER", "DEVELOPER", "DEVOPS", "MANAGER", "ADMIN"]).default("USER"),
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const { orgId, sub: userId } = res.locals.user;

    // Check seat limits
    const limitCheck = await checkLimit(orgId, "users");
    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: `User limit reached (${limitCheck.current}/${limitCheck.limit}). Upgrade your plan to add more team members.`,
      });
    }

    const body = createSchema.parse(req.body);
    const invitation = await invitations.createInvitation({
      orgId,
      email: body.email,
      role: body.role as any,
      invitedById: userId,
    });
    res.status(201).json({ invitation });
  } catch (err: any) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "An invitation for this email already exists" });
    }
    res.status(400).json({ error: err.message });
  }
});

// GET /saas/invitations/accept/:token — accept invitation (public)
router.get("/accept/:token", async (req: Request, res: Response) => {
  try {
    const invitation = await invitations.getInvitationByToken(req.params.token);
    if (!invitation) return res.status(404).json({ error: "Invitation not found" });
    res.json({
      invitation: {
        email: invitation.email,
        role: invitation.role,
        organization: invitation.organization.name,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /saas/invitations/accept/:token — accept invitation
router.post("/accept/:token", async (req: Request, res: Response) => {
  try {
    const accepted = await invitations.acceptInvitation(req.params.token);
    res.json({ invitation: accepted });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /saas/invitations/:id — revoke invitation
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    await invitations.revokeInvitation(req.params.id, orgId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /saas/invitations/:id/resend — resend invitation
router.post("/:id/resend", async (req: Request, res: Response) => {
  try {
    const { orgId } = res.locals.user;
    await invitations.resendInvitation(req.params.id, orgId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
