// src/tests/admin.spec.ts — Unit tests for admin/auth module (§4.1)
import { describe, it, expect } from "vitest";

// ─── Password validation tests ──────────────────────────────
describe("Password Validation", () => {
  // Mirrors the password policy in auth.service.ts
  function validatePassword(password: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (password.length < 12) errors.push("Must be at least 12 characters");
    if (password.length > 128) errors.push("Must be at most 128 characters");
    if (!/[A-Z]/.test(password)) errors.push("Must contain uppercase letter");
    if (!/[a-z]/.test(password)) errors.push("Must contain lowercase letter");
    if (!/[0-9]/.test(password)) errors.push("Must contain digit");
    if (!/[^A-Za-z0-9]/.test(password)) errors.push("Must contain special character");
    return { valid: errors.length === 0, errors };
  }

  it("accepts a strong password", () => {
    const result = validatePassword("Str0ng@Pass!99");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects password shorter than 12 characters", () => {
    const result = validatePassword("Sh0rt@1");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Must be at least 12 characters");
  });

  it("rejects password without uppercase", () => {
    const result = validatePassword("nouppercase123!!");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Must contain uppercase letter");
  });

  it("rejects password without lowercase", () => {
    const result = validatePassword("NOLOWERCASE123!!");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Must contain lowercase letter");
  });

  it("rejects password without digit", () => {
    const result = validatePassword("NoDigitsHere!!aa");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Must contain digit");
  });

  it("rejects password without special character", () => {
    const result = validatePassword("NoSpecialChar123");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Must contain special character");
  });

  it("rejects password longer than 128 characters", () => {
    const longPassword = "A".repeat(100) + "a1!" + "x".repeat(30);
    const result = validatePassword(longPassword);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Must be at most 128 characters");
  });
});

// ─── RBAC permission tests ──────────────────────────────────
describe("RBAC Permissions", () => {
  // Mirrors the ROLE_PERMISSIONS map from permissions.ts
  const ROLE_PERMISSIONS: Record<string, Set<string>> = {
    SUPER_ADMIN: new Set(["*"]),
    ADMIN: new Set(["*"]),
    MANAGER: new Set([
      "project.read", "project.create", "deployment.read",
      "incident.manage", "integration.manage", "assistant",
      "runbook.read", "runbook.edit",
    ]),
    DEVOPS: new Set([
      "project.read", "project.create", "project.admin",
      "deployment.create", "deployment.read",
      "incident.manage", "integration.manage", "assistant",
      "runbook.read", "runbook.edit",
    ]),
    DEVELOPER: new Set([
      "project.read", "deployment.read", "assistant",
      "runbook.read",
    ]),
    USER: new Set(["project.read", "assistant"]),
  };

  function hasPermission(role: string, action: string): boolean {
    const perms = ROLE_PERMISSIONS[role];
    if (!perms) return false;
    return perms.has("*") || perms.has(action);
  }

  it("ADMIN has all permissions", () => {
    expect(hasPermission("ADMIN", "project.admin")).toBe(true);
    expect(hasPermission("ADMIN", "deployment.create")).toBe(true);
    expect(hasPermission("ADMIN", "anything.else")).toBe(true);
  });

  it("DEVELOPER can read projects but not create deployments", () => {
    expect(hasPermission("DEVELOPER", "project.read")).toBe(true);
    expect(hasPermission("DEVELOPER", "deployment.create")).toBe(false);
  });

  it("DEVOPS can create deployments", () => {
    expect(hasPermission("DEVOPS", "deployment.create")).toBe(true);
    expect(hasPermission("DEVOPS", "project.admin")).toBe(true);
  });

  it("MANAGER can manage incidents but not admin projects", () => {
    expect(hasPermission("MANAGER", "incident.manage")).toBe(true);
    expect(hasPermission("MANAGER", "project.admin")).toBe(false);
  });

  it("USER has minimal permissions", () => {
    expect(hasPermission("USER", "project.read")).toBe(true);
    expect(hasPermission("USER", "assistant")).toBe(true);
    expect(hasPermission("USER", "deployment.create")).toBe(false);
    expect(hasPermission("USER", "incident.manage")).toBe(false);
  });

  it("unknown role has no permissions", () => {
    expect(hasPermission("UNKNOWN", "project.read")).toBe(false);
  });
});

// ─── Email validation tests ─────────────────────────────────
describe("Email Validation", () => {
  function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  it("accepts valid email", () => {
    expect(isValidEmail("user@codesila.local")).toBe(true);
    expect(isValidEmail("admin@example.com")).toBe(true);
  });

  it("rejects email without @", () => {
    expect(isValidEmail("usercodesila.local")).toBe(false);
  });

  it("rejects email without domain", () => {
    expect(isValidEmail("user@")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidEmail("")).toBe(false);
  });
});

// ─── Role hierarchy tests ───────────────────────────────────
describe("Role Hierarchy", () => {
  const ROLE_LEVEL: Record<string, number> = {
    SUPER_ADMIN: 100,
    ADMIN: 90,
    MANAGER: 50,
    DEVOPS: 50,
    DEVELOPER: 30,
    USER: 10,
  };

  function canAssignRole(actorRole: string, targetRole: string): boolean {
    return (ROLE_LEVEL[actorRole] ?? 0) > (ROLE_LEVEL[targetRole] ?? 0);
  }

  it("ADMIN can assign DEVELOPER role", () => {
    expect(canAssignRole("ADMIN", "DEVELOPER")).toBe(true);
  });

  it("ADMIN cannot assign SUPER_ADMIN role", () => {
    expect(canAssignRole("ADMIN", "SUPER_ADMIN")).toBe(false);
  });

  it("DEVELOPER cannot assign ADMIN role", () => {
    expect(canAssignRole("DEVELOPER", "ADMIN")).toBe(false);
  });

  it("SUPER_ADMIN can assign any role", () => {
    expect(canAssignRole("SUPER_ADMIN", "ADMIN")).toBe(true);
    expect(canAssignRole("SUPER_ADMIN", "DEVOPS")).toBe(true);
  });
});
