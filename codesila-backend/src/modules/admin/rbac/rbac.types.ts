// src/modules/admin/rbac/rbac.types.ts — RBAC types (§2.5.1, §3.2)

import { type Action } from "./permissions";

export type RolePermissionMap = Record<string, Action[]>;

export interface RbacRoleDTO {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  createdAt: Date;
}

export interface CreateRoleInput {
  name: string;
  description?: string;
  permissions: string[];
}

export interface UpdateRoleInput {
  name?: string;
  description?: string;
  permissions?: string[];
}

export interface AssignRoleInput {
  userId: string;
  roleId: string;
}
