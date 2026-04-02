import { Request, Response } from "express";
import { prisma } from "../../../infra/db";
import { SECURITY } from "../../../config/constants";
import { logSecurityEvent } from "../../../config/logger";

function getRoleLevel(role: string): number {
  return SECURITY.ROLE_HIERARCHY[role] ?? 0;
}

export async function revokeUserHandler(req: Request, res: Response) {
  try {
    const orgId = res.locals.user?.orgId;
    const requesterId = res.locals.user?.sub;
    const targetId = req.params.id;

    if (!orgId || !requesterId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!targetId) {
      return res.status(400).json({ error: "Missing user id" });
    }

    if (targetId === requesterId) {
      return res.status(400).json({ error: "Cannot revoke your own access" });
    }

    const target = await prisma.user.findFirst({
      where: { id: targetId, orgId },
      select: { id: true, role: true },
    });

    if (!target) {
      return res.status(404).json({ error: "User not found" });
    }

    // Prevent lower-privilege admins from revoking higher-privilege users
    const requesterLevel = getRoleLevel(res.locals.user?.role);
    const targetLevel = getRoleLevel(target.role);
    if (targetLevel >= requesterLevel) {
      return res.status(403).json({ error: "Cannot revoke a user with equal or higher privileges" });
    }

    await prisma.user.update({
      where: { id: targetId },
      data: { isActive: false },
    });

    logSecurityEvent({
      event: "USER_DEACTIVATED",
      userId: requesterId,
      orgId,
      severity: "MEDIUM",
      details: { targetId, targetRole: target.role },
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("REVOKE USER ERROR:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
