import { Router } from "express";
import { authMiddleware } from "../middlewares/auth";
import { requireRole } from "../middlewares/requireRole";
import { requirePermission } from "../middlewares/requirePermission";
import { Actions } from "../modules/admin/rbac/permissions";
import { prisma } from "../infra/db";
import rbacRouter from "../modules/admin/rbac/rbac.routes";

const router = Router();

// ADMIN-ONLY TEST ROUTE
router.get(
  "/stats",
  authMiddleware,
  requireRole("ADMIN", "SUPER_ADMIN"),
  (req, res) => {
    res.json({
      message: "Admin-only endpoint works",
      user: res.locals.user,
    });
  }
);

// USER MANAGEMENT — permission-based (§2.5.1)
router.get(
  "/users",
  authMiddleware,
  requirePermission(Actions.UserRead),
  async (_req, res) => {
    try {
      const orgId = res.locals.user?.orgId;
      const users = await prisma.user.findMany({
        where: orgId ? { orgId } : undefined,
        select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      });
      return res.json({ success: true, data: users, meta: { total: users.length, page: 1 } });
    } catch {
      return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Failed to list users" } });
    }
  }
);

// Single user by ID — validates UUID
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
      select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
    });
    if (!user) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "User not found" }, code: "NOT_FOUND" });
    return res.json({ success: true, data: user });
  }
);

router.post(
  "/users",
  authMiddleware,
  requirePermission(Actions.UserManage),
  async (req, res) => {
    try {
      const { email, name, role, password } = req.body ?? {};
      if (!email || !password) {
        return res.status(400).json({ error: "email and password are required" });
      }
      const bcrypt = await import("bcrypt");
      const hash = await bcrypt.hash(password, 10);
      const orgId = res.locals.user?.orgId;
      const user = await prisma.user.create({
        data: { email, name, role: role ?? "USER", passwordHash: hash, orgId },
        select: { id: true, email: true, name: true, role: true, isActive: true },
      });
      return res.status(201).json(user);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create user";
      return res.status(400).json({ error: msg });
    }
  }
);

// PATCH /admin/users/:id — update role, active status (§2.5.1)
router.patch(
  "/users/:id",
  authMiddleware,
  requirePermission(Actions.UserManage),
  async (req, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_PATH_PARAM", message: "Invalid UUID format" } });
      }
      const orgId = res.locals.user?.orgId;
      const existing = await prisma.user.findFirst({
        where: { id: req.params.id, ...(orgId ? { orgId } : {}) },
      });
      if (!existing) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "User not found" } });
      }

      const { role, isActive } = req.body ?? {};
      const VALID_ROLES = ["ADMIN", "USER", "DEVELOPER", "DEVOPS", "MANAGER"];

      if (role !== undefined && !VALID_ROLES.includes(role)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_ROLE", message: `Role must be one of: ${VALID_ROLES.join(", ")}` } });
      }
      if (role !== undefined && existing.role === "SUPER_ADMIN") {
        return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Cannot change SUPER_ADMIN role" } });
      }
      if (isActive !== undefined && typeof isActive !== "boolean") {
        return res.status(400).json({ success: false, error: { code: "INVALID_VALUE", message: "isActive must be a boolean" } });
      }

      const updated = await prisma.user.update({
        where: { id: req.params.id },
        data: {
          ...(role !== undefined ? { role } : {}),
          ...(isActive !== undefined ? { isActive } : {}),
        },
        select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
      });

      return res.json({ success: true, data: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update user";
      return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: msg } });
    }
  }
);

// RBAC management (§2.5.1, §3.2) — admin-only
router.use(
  "/rbac",
  authMiddleware,
  requireRole("ADMIN", "SUPER_ADMIN"),
  rbacRouter
);

export default router;
