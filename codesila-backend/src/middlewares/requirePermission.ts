import { Request, Response, NextFunction } from "express";
import { hasPermission, type Action } from "../modules/admin/rbac/permissions";
import { prisma } from "../infra/db";
import { log as auditLog } from "../modules/saas/audit/audit.service";

export function requirePermission(action: Action) {
  return async (_req: Request, res: Response, next: NextFunction) => {
    const user = res.locals.user;

    if (!user?.role) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Fast path: check in-memory role permissions
    if (hasPermission(user.role, action)) {
      return next();
    }

    // Slow path: check DB-assigned roles (multi-role support)
    try {
      if (user.sub) {
        const userRoles = await prisma.userRole.findMany({
          where: { userId: user.sub },
          include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
        });
        for (const ur of userRoles) {
          for (const rp of ur.role.rolePermissions) {
            if (rp.permission.action === action) {
              return next();
            }
          }
        }
      }
    } catch {
      // DB check failed — fall through to denial
    }

    // Access denied — record audit event
    if (user.sub && user.orgId) {
      auditLog({
        orgId: user.orgId,
        actorId: user.sub,
        action: "rbac.access.denied",
        entityType: "permission",
        entityId: action,
        metadata: { role: user.role, requiredPermission: action },
      }).catch(() => {});
    }

    return res.status(403).json({ error: "Forbidden" });
  };
}
