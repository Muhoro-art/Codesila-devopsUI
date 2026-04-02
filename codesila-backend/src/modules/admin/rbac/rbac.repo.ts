// src/modules/admin/rbac/rbac.repo.ts — RBAC data access (§2.5.1, §3.2)

import { prisma } from "../../../infra/db";

// ─── Roles ──────────────────────────────────────────────────

export function findAllRoles() {
  return prisma.rbacRole.findMany({
    include: { rolePermissions: { include: { permission: true } } },
    orderBy: { name: "asc" },
  });
}

export function findRoleById(id: string) {
  return prisma.rbacRole.findUnique({
    where: { id },
    include: { rolePermissions: { include: { permission: true } } },
  });
}

export function findRoleByName(name: string) {
  return prisma.rbacRole.findUnique({
    where: { name },
    include: { rolePermissions: { include: { permission: true } } },
  });
}

export function createRole(data: { name: string; description?: string; isSystem?: boolean }) {
  return prisma.rbacRole.create({ data });
}

export function updateRole(id: string, data: { name?: string; description?: string }) {
  return prisma.rbacRole.update({ where: { id }, data });
}

export function deleteRole(id: string) {
  return prisma.rbacRole.delete({ where: { id } });
}

// ─── Permissions ────────────────────────────────────────────

export function findAllPermissions() {
  return prisma.rbacPermission.findMany({ orderBy: { action: "asc" } });
}

export function findPermissionByAction(action: string) {
  return prisma.rbacPermission.findUnique({ where: { action } });
}

export function createPermission(data: { action: string; description?: string; resource?: string }) {
  return prisma.rbacPermission.create({ data });
}

// ─── Role ↔ Permission mapping ──────────────────────────────

export function addPermissionToRole(roleId: string, permissionId: string) {
  return prisma.rolePermission.create({ data: { roleId, permissionId } });
}

export function removePermissionFromRole(roleId: string, permissionId: string) {
  return prisma.rolePermission.deleteMany({ where: { roleId, permissionId } });
}

export async function setRolePermissions(roleId: string, permissionIds: string[]) {
  await prisma.rolePermission.deleteMany({ where: { roleId } });
  if (permissionIds.length > 0) {
    await prisma.rolePermission.createMany({
      data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
      skipDuplicates: true,
    });
  }
}

// ─── User ↔ Role mapping ───────────────────────────────────

export function findUserRoles(userId: string) {
  return prisma.userRole.findMany({
    where: { userId },
    include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
  });
}

export function assignRoleToUser(userId: string, roleId: string, assignedBy?: string) {
  return prisma.userRole.create({ data: { userId, roleId, assignedBy } });
}

export function removeRoleFromUser(userId: string, roleId: string) {
  return prisma.userRole.deleteMany({ where: { userId, roleId } });
}