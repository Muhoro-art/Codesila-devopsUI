// src/modules/admin/rbac/rbac.routes.ts — RBAC API endpoints (§2.5.1, §3.2)

import { Router, Request, Response, NextFunction } from "express";
import * as rbacService from "./rbac.service";

const router = Router();

// ─── Roles CRUD ─────────────────────────────────────────────

router.get("/roles", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const roles = await rbacService.listRoles();
    res.json(roles);
  } catch (err) { next(err); }
});

router.get("/roles/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const role = await rbacService.getRole(req.params.id);
    if (!role) return res.status(404).json({ error: "Role not found" });
    res.json(role);
  } catch (err) { next(err); }
});

router.post("/roles", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description, permissions } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });
    const role = await rbacService.createRole({ name, description, permissions: permissions ?? [] });
    res.status(201).json(role);
  } catch (err) {
    if ((err as Error).message === "Role name already exists") return res.status(409).json({ error: "Role name already exists" });
    next(err);
  }
});

router.put("/roles/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const role = await rbacService.updateRole(req.params.id, req.body);
    res.json(role);
  } catch (err) {
    if ((err as Error).message === "Role not found") return res.status(404).json({ error: "Role not found" });
    if ((err as Error).message === "Cannot modify system role") return res.status(403).json({ error: "Cannot modify system role" });
    next(err);
  }
});

router.delete("/roles/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await rbacService.deleteRole(req.params.id);
    res.status(204).end();
  } catch (err) {
    if ((err as Error).message === "Role not found") return res.status(404).json({ error: "Role not found" });
    if ((err as Error).message === "Cannot delete system role") return res.status(400).json({ error: "Cannot delete system role" });
    next(err);
  }
});

// ─── Permissions (read-only) ────────────────────────────────

router.get("/permissions", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const permissions = await rbacService.listPermissions();
    res.json(permissions);
  } catch (err) { next(err); }
});

// ─── User ↔ Role ────────────────────────────────────────────

router.get("/users/:userId/roles", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roles = await rbacService.getUserRoles(req.params.userId);
    res.json(roles);
  } catch (err) { next(err); }
});

router.post("/users/:userId/roles", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roleId } = req.body;
    if (!roleId) return res.status(400).json({ error: "roleId is required" });
    const assignedBy = res.locals.user?.sub;
    const result = await rbacService.assignRole(req.params.userId, roleId, assignedBy);
    res.json(result);
  } catch (err) {
    if ((err as Error).message === "Role not found") return res.status(404).json({ error: "Role not found" });
    if ((err as Error).message === "User not found") return res.status(404).json({ error: "User not found" });
    next(err);
  }
});

router.delete("/users/:userId/roles/:roleId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await rbacService.removeRole(req.params.userId, req.params.roleId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;