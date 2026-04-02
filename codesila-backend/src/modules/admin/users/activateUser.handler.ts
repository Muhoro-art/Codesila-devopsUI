import { Request, Response } from "express";
import { prisma } from "../../../infra/db";
import { SECURITY } from "../../../config/constants";
import { logSecurityEvent } from "../../../config/logger";

function getRoleLevel(role: string): number {
  return SECURITY.ROLE_HIERARCHY[role] ?? 0;
}

export async function activateUserHandler(req: Request, res: Response) {
  try {
    const orgId = res.locals.user?.orgId;
    const requesterId = res.locals.user?.sub;
    const requesterRole = res.locals.user?.role;
    const targetId = req.params.id;

    if (!orgId || !requesterId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!targetId) {
      return res.status(400).json({ error: "Missing user id" });
    }

    const target = await prisma.user.findFirst({
      where: { id: targetId, orgId },
      select: { id: true, role: true },
    });

    if (!target) {
      return res.status(404).json({ error: "User not found" });
    }

    // Enforce role hierarchy — prevent privilege escalation
    const requesterLevel = getRoleLevel(requesterRole);
    const targetLevel = getRoleLevel(target.role);
    if (targetLevel >= requesterLevel) {
      logSecurityEvent({
        event: "PRIVILEGE_ESCALATION_ATTEMPT",
        userId: requesterId,
        orgId,
        ip: req.ip,
        severity: "HIGH",
        details: {
          action: "activate_user",
          targetId,
          targetRole: target.role,
          requesterRole,
        },
      });
      return res.status(403).json({
        error: "Cannot activate a user with equal or higher privileges",
      });
    }

    await prisma.user.update({
      where: { id: targetId },
      data: { isActive: true },
    });

    logSecurityEvent({
      event: "USER_ACTIVATED",
      userId: requesterId,
      orgId,
      severity: "LOW",
      details: { targetId, targetRole: target.role },
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("ACTIVATE USER ERROR:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
