import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth";
import { requireAdmin } from "./requireAdmin";
import { requirePermission } from "../../middlewares/requirePermission";
import { Actions } from "./rbac/permissions";
import { createUserHandler } from "./users/createUser.handler";
import { activateUserHandler } from "./users/activateUser.handler";
import { listUsersHandler } from "./users/listUsers.handler";
import { revokeUserHandler } from "./users/revokeUser.handler";
import rbacRouter from "./rbac/rbac.routes";
import { prisma } from "../../infra/db";

const router = Router();

// USER MANAGEMENT — permission-based access (§2.5.1)
router.post(
  "/users",
  authMiddleware,
  requirePermission(Actions.UserManage),
  createUserHandler
);

router.get(
  "/users",
  authMiddleware,
  requirePermission(Actions.UserRead),
  listUsersHandler
);

// Single user by ID — validates UUID format
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get(
  "/users/:id",
  authMiddleware,
  requirePermission(Actions.UserRead),
  async (req, res) => {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ success: false, error: { code: "INVALID_PATH_PARAM", message: "Invalid UUID format" }, code: "INVALID_PATH_PARAM" });
    }
    const orgId = res.locals.user?.orgId;
    const user = await prisma.user.findFirst({
      where: { id: req.params.id, ...(orgId ? { orgId } : {}) },
      select: { id: true, email: true, role: true, isActive: true, createdAt: true },
    });
    if (!user) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "User not found" }, code: "NOT_FOUND" });
    return res.json({ success: true, data: user });
  }
);

router.delete(
  "/users/:id",
  authMiddleware,
  requireAdmin,
  revokeUserHandler
);

router.post(
  "/users/:id/activate",
  authMiddleware,
  requireAdmin,
  activateUserHandler
);

// RBAC management (§2.5.1, §3.2) — admin-only
router.use(
  "/rbac",
  authMiddleware,
  requireAdmin,
  rbacRouter
);

export default router;
