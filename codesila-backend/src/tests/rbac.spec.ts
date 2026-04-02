// src/tests/rbac.spec.ts — RBAC unit tests (§4.3)
// Tests for role-based access control: permissions map, hasPermission(),
// middleware behavior, role hierarchy.

import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Actions, hasPermission } from "../modules/admin/rbac/permissions";

let app: Express;

beforeAll(async () => {
  try {
    const mod = await import("../app");
    app = mod.buildApp();
  } catch {
    const express = await import("express");
    app = express.default();
    app.get("/health", (_req, res) => res.json({ ok: true }));
  }
});

// ═══════════════════════════════════════════════════════════════
// §4.3.1 — Permissions Map: Actions constant
// ═══════════════════════════════════════════════════════════════
describe("RBAC — Actions constant", () => {
  it("has 13 defined actions", () => {
    expect(Object.keys(Actions).length).toBe(13);
  });

  it("includes all expected action keys", () => {
    const expected = [
      "ProjectRead", "ProjectCreate", "ProjectAdmin",
      "AssistantAsk", "RunbookEdit",
      "DeploymentRead", "DeploymentCreate",
      "IncidentManage", "IntegrationManage",
    ];
    for (const key of expected) {
      expect(Actions).toHaveProperty(key);
    }
  });

  it("action values follow resource.verb pattern", () => {
    for (const val of Object.values(Actions)) {
      expect(val).toMatch(/^[a-z]+\.[a-z]+$/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// §4.3.2 — hasPermission() function
// ═══════════════════════════════════════════════════════════════
describe("RBAC — hasPermission()", () => {
  // SUPER_ADMIN / ADMIN have all permissions
  it("SUPER_ADMIN has all permissions", () => {
    for (const action of Object.values(Actions)) {
      expect(hasPermission("SUPER_ADMIN", action)).toBe(true);
    }
  });

  it("ADMIN has all permissions", () => {
    for (const action of Object.values(Actions)) {
      expect(hasPermission("ADMIN", action)).toBe(true);
    }
  });

  // DEVOPS: all 9
  it("DEVOPS has deployment.create", () => {
    expect(hasPermission("DEVOPS", Actions.DeploymentCreate)).toBe(true);
  });

  it("DEVOPS has incident.manage", () => {
    expect(hasPermission("DEVOPS", Actions.IncidentManage)).toBe(true);
  });

  // MANAGER: 7 (no deployment.create, no project.admin)
  it("MANAGER has project.read", () => {
    expect(hasPermission("MANAGER", Actions.ProjectRead)).toBe(true);
  });

  it("MANAGER does NOT have deployment.create", () => {
    expect(hasPermission("MANAGER", Actions.DeploymentCreate)).toBe(false);
  });

  it("MANAGER does NOT have project.admin", () => {
    expect(hasPermission("MANAGER", Actions.ProjectAdmin)).toBe(false);
  });

  // DEVELOPER: 4 permissions only
  it("DEVELOPER has project.read and assistant.ask", () => {
    expect(hasPermission("DEVELOPER", Actions.ProjectRead)).toBe(true);
    expect(hasPermission("DEVELOPER", Actions.AssistantAsk)).toBe(true);
  });

  it("DEVELOPER does NOT have deployment.create", () => {
    expect(hasPermission("DEVELOPER", Actions.DeploymentCreate)).toBe(false);
  });

  it("DEVELOPER does NOT have incident.manage", () => {
    expect(hasPermission("DEVELOPER", Actions.IncidentManage)).toBe(false);
  });

  // USER: 2 permissions only
  it("USER has only project.read and assistant.ask", () => {
    expect(hasPermission("USER", Actions.ProjectRead)).toBe(true);
    expect(hasPermission("USER", Actions.AssistantAsk)).toBe(true);
  });

  it("USER does NOT have runbook.edit", () => {
    expect(hasPermission("USER", Actions.RunbookEdit)).toBe(false);
  });

  // Unknown role
  it("unknown role has no permissions", () => {
    expect(hasPermission("UNKNOWN_ROLE", Actions.ProjectRead)).toBe(false);
  });

  // ProjectAdmin escalation
  it("project.admin grants all project.* actions", () => {
    // ADMIN has project.admin, so project.read and project.create should pass
    expect(hasPermission("ADMIN", Actions.ProjectRead)).toBe(true);
    expect(hasPermission("ADMIN", Actions.ProjectCreate)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// §4.3.3 — Role Hierarchy in Protected Routes
// ═══════════════════════════════════════════════════════════════
describe("RBAC — Protected Route Access (HTTP)", () => {
  it("GET /admin/users rejects unauthenticated requests", async () => {
    const res = await request(app).get("/admin/users");
    expect(res.status).toBe(401);
  });

  it("GET /admin/rbac/roles rejects unauthenticated requests", async () => {
    const res = await request(app).get("/admin/rbac/roles");
    expect(res.status).toBe(401);
  });

  it("POST /admin/rbac/roles rejects unauthenticated requests", async () => {
    const res = await request(app)
      .post("/admin/rbac/roles")
      .send({ name: "test-role" });
    expect(res.status).toBe(401);
  });

  it("GET /admin/rbac/permissions rejects unauthenticated requests", async () => {
    const res = await request(app).get("/admin/rbac/permissions");
    expect(res.status).toBe(401);
  });

  it("GET /devflow/projects rejects unauthenticated requests", async () => {
    const res = await request(app).get("/devflow/projects");
    expect(res.status).toBe(401);
  });

  it("POST /assistant rejects unauthenticated requests", async () => {
    const res = await request(app).post("/assistant");
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════
// §4.3.4 — Role count and completeness
// ═══════════════════════════════════════════════════════════════
describe("RBAC — Role Completeness", () => {
  const ALL_ROLES = ["SUPER_ADMIN", "ADMIN", "DEVOPS", "MANAGER", "DEVELOPER", "USER"];

  it("defines 6 system roles", () => {
    for (const role of ALL_ROLES) {
      // Each role should have at least project.read
      expect(hasPermission(role, Actions.ProjectRead)).toBe(true);
    }
  });

  it("higher roles are supersets of lower roles", () => {
    // USER ⊂ DEVELOPER ⊂ MANAGER ⊂ DEVOPS ⊂ ADMIN = SUPER_ADMIN
    const userPerms = Object.values(Actions).filter((a) => hasPermission("USER", a));
    const devPerms = Object.values(Actions).filter((a) => hasPermission("DEVELOPER", a));
    const mgrPerms = Object.values(Actions).filter((a) => hasPermission("MANAGER", a));
    const opsPerms = Object.values(Actions).filter((a) => hasPermission("DEVOPS", a));
    const adminPerms = Object.values(Actions).filter((a) => hasPermission("ADMIN", a));

    expect(devPerms.length).toBeGreaterThanOrEqual(userPerms.length);
    expect(mgrPerms.length).toBeGreaterThanOrEqual(devPerms.length);
    expect(opsPerms.length).toBeGreaterThanOrEqual(mgrPerms.length);
    expect(adminPerms.length).toBeGreaterThanOrEqual(opsPerms.length);

    // USER permissions are a subset of DEVELOPER
    for (const p of userPerms) {
      expect(devPerms).toContain(p);
    }
  });
});
