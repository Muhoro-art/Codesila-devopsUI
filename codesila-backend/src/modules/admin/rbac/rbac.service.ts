// src/modules/admin/rbac/rbac.service.ts — RBAC business logic (§2.5.1, §3.2)

import * as repo from "./rbac.repo";
import { Actions } from "./permissions";
import type { RbacRoleDTO, CreateRoleInput, UpdateRoleInput } from "./rbac.types";

// ─── Roles ──────────────────────────────────────────────────

function toRoleDTO(role: any): RbacRoleDTO {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissions: role.rolePermissions?.map((rp: any) => rp.permission.action) ?? [],
    createdAt: role.createdAt,
  };
}

export async function listRoles(): Promise<RbacRoleDTO[]> {
  const roles = await repo.findAllRoles();
  return roles.map(toRoleDTO);
}

export async function getRole(id: string): Promise<RbacRoleDTO | null> {
  const role = await repo.findRoleById(id);
  return role ? toRoleDTO(role) : null;
}

export async function createRole(input: CreateRoleInput): Promise<RbacRoleDTO> {
  const existingByName = await repo.findRoleByName(input.name);
  if (existingByName) throw new Error("Role name already exists");

  const role = await repo.createRole({ name: input.name, description: input.description });

  if (input.permissions.length > 0) {
    const allPerms = await repo.findAllPermissions();
    const permIds = allPerms
      .filter((p) => input.permissions.includes(p.action))
      .map((p) => p.id);
    if (permIds.length > 0) {
      await repo.setRolePermissions(role.id, permIds);
    }
  }

  const full = await repo.findRoleById(role.id);
  return toRoleDTO(full!);
}

export async function updateRole(id: string, input: UpdateRoleInput): Promise<RbacRoleDTO> {
  const existing = await repo.findRoleById(id);
  if (!existing) throw new Error("Role not found");
  if (existing.isSystem) throw new Error("Cannot modify system role");

  if (input.name || input.description !== undefined) {
    await repo.updateRole(id, { name: input.name, description: input.description });
  }

  if (input.permissions) {
    const allPerms = await repo.findAllPermissions();
    const permIds = allPerms
      .filter((p) => input.permissions!.includes(p.action))
      .map((p) => p.id);
    await repo.setRolePermissions(id, permIds);
  }

  const full = await repo.findRoleById(id);
  return toRoleDTO(full!);
}

export async function deleteRole(id: string): Promise<void> {
  const existing = await repo.findRoleById(id);
  if (!existing) throw new Error("Role not found");
  if (existing.isSystem) throw new Error("Cannot delete system role");
  await repo.deleteRole(id);
}

// ─── Permissions ────────────────────────────────────────────

export async function listPermissions() {
  return repo.findAllPermissions();
}

// ─── User ↔ Role ────────────────────────────────────────────

export async function getUserRoles(userId: string): Promise<RbacRoleDTO[]> {
  const userRoles = await repo.findUserRoles(userId);
  return userRoles.map((ur) => toRoleDTO(ur.role));
}

export async function assignRole(userId: string, roleId: string, assignedBy?: string) {
  const role = await repo.findRoleById(roleId);
  if (!role) throw new Error("Role not found");
  return repo.assignRoleToUser(userId, roleId, assignedBy);
}

export async function removeRole(userId: string, roleId: string) {
  return repo.removeRoleFromUser(userId, roleId);
}

// ─── Seed system roles & permissions (§3.2) ─────────────────

export async function seedRbacTables(): Promise<void> {
  const actionValues = Object.values(Actions);

  // Upsert all permissions
  for (const action of actionValues) {
    await repo.findPermissionByAction(action) ??
      await repo.createPermission({ action, description: action.replace(".", " "), resource: action.split(".")[0] });
  }

  // Seed system roles matching the enum
  const systemRoles: { name: string; permissions: string[] }[] = [
    { name: "SUPER_ADMIN", permissions: [...actionValues] },
    { name: "ADMIN", permissions: [...actionValues] },
    { name: "DEVOPS", permissions: [Actions.ProjectRead, Actions.ProjectCreate, Actions.ProjectAdmin, Actions.AssistantAsk, Actions.RunbookEdit, Actions.DeploymentRead, Actions.DeploymentCreate, Actions.IncidentManage, Actions.IntegrationManage, Actions.PipelineRun, Actions.PipelineManage] },
    { name: "MANAGER", permissions: [Actions.ProjectRead, Actions.ProjectCreate, Actions.AssistantAsk, Actions.RunbookEdit, Actions.DeploymentRead, Actions.IncidentManage, Actions.IntegrationManage] },
    { name: "DEVELOPER", permissions: [Actions.ProjectRead, Actions.AssistantAsk, Actions.RunbookEdit, Actions.DeploymentRead, Actions.PipelineRun] },
    { name: "USER", permissions: [Actions.ProjectRead, Actions.AssistantAsk] },
  ];

  const allPerms = await repo.findAllPermissions();

  for (const sr of systemRoles) {
    let existing = await repo.findRoleByName(sr.name);
    let roleId: string;
    if (!existing) {
      const created = await repo.createRole({ name: sr.name, description: `System role: ${sr.name}`, isSystem: true });
      roleId = created.id;
    } else {
      roleId = existing.id;
    }

    const permIds = allPerms
      .filter((p) => sr.permissions.includes(p.action))
      .map((p) => p.id);

    if (permIds.length > 0) {
      await repo.setRolePermissions(roleId, permIds);
    }
  }
}