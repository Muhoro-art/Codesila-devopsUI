/**
 * RBAC Integration Tests — TC-RBAC-01 through TC-RBAC-15
 *
 * Verify permission-based access control, role assignment/revocation,
 * audit logging, custom roles, and multi-role union against the real
 * Express app with a live PostgreSQL database.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { authRateLimitStore } from "../middlewares/rateLimit";
import { seedRbacTables } from "../modules/admin/rbac/rbac.service";

const prisma = new PrismaClient();

// ─── Test constants ──────────────────────────────────────────
const TEST_ORG_ID = "org_test_rbac_integration";
const PASS = "Str0ng!Pass@2026xZ";

let app: Express;
let jwtSecret: string;

let adminUser: { id: string; token: string };
let developerUser: { id: string; token: string };
let devopsUser: { id: string; token: string };
let managerUser: { id: string; token: string };
let regularUser: { id: string; token: string };

function signToken(userId: string, role: string, email: string): string {
  return jwt.sign(
    { sub: userId, role, orgId: TEST_ORG_ID, email, type: "access" },
    jwtSecret,
    { algorithm: "HS256", issuer: "codesila-api", audience: "codesila-client", expiresIn: "15m" },
  );
}

beforeEach(async () => {
  await authRateLimitStore.resetAll();
});

beforeAll(async () => {
  const mod = await import("../app");
  app = mod.buildApp();

  const { env } = await import("../config/env");
  jwtSecret = env.JWT_SECRET;

  const hash = await bcrypt.hash(PASS, 10);

  // ── Isolated test organisation ─────────────────────────────
  await prisma.organization.upsert({
    where: { id: TEST_ORG_ID },
    update: {},
    create: { id: TEST_ORG_ID, name: "RBAC Test Org", slug: "rbac-test-org" },
  });

  // ── Test users (one per role) ──────────────────────────────
  const admin = await prisma.user.create({
    data: { email: "rbac-admin@codesila.test", passwordHash: hash, name: "RBAC Admin", role: "ADMIN", orgId: TEST_ORG_ID, isActive: true },
  });
  const developer = await prisma.user.create({
    data: { email: "rbac-developer@codesila.test", passwordHash: hash, name: "RBAC Developer", role: "DEVELOPER", orgId: TEST_ORG_ID, isActive: true },
  });
  const devops = await prisma.user.create({
    data: { email: "rbac-devops@codesila.test", passwordHash: hash, name: "RBAC DevOps", role: "DEVOPS", orgId: TEST_ORG_ID, isActive: true },
  });
  const manager = await prisma.user.create({
    data: { email: "rbac-manager@codesila.test", passwordHash: hash, name: "RBAC Manager", role: "MANAGER", orgId: TEST_ORG_ID, isActive: true },
  });
  const regular = await prisma.user.create({
    data: { email: "rbac-user@codesila.test", passwordHash: hash, name: "RBAC Regular", role: "USER", orgId: TEST_ORG_ID, isActive: true },
  });

  adminUser     = { id: admin.id,     token: signToken(admin.id,     "ADMIN",     admin.email) };
  developerUser = { id: developer.id, token: signToken(developer.id, "DEVELOPER", developer.email) };
  devopsUser    = { id: devops.id,    token: signToken(devops.id,    "DEVOPS",    devops.email) };
  managerUser   = { id: manager.id,   token: signToken(manager.id,   "MANAGER",   manager.email) };
  regularUser   = { id: regular.id,   token: signToken(regular.id,   "USER",      regular.email) };

  // Ensure system RBAC roles & permissions exist in DB
  await seedRbacTables();
}, 30_000);

afterAll(async () => {
  const userIds = [adminUser.id, developerUser.id, devopsUser.id, managerUser.id, regularUser.id];

  // Dependency-safe teardown
  await prisma.auditEvent.deleteMany({ where: { orgId: TEST_ORG_ID } });
  await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });

  // Delete custom roles created during tests
  const customRoles = await prisma.rbacRole.findMany({ where: { isSystem: false, name: { startsWith: "RBAC_TEST_" } } });
  if (customRoles.length > 0) {
    const ids = customRoles.map((r) => r.id);
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: ids } } });
    await prisma.rbacRole.deleteMany({ where: { id: { in: ids } } });
  }

  await prisma.user.deleteMany({ where: { orgId: TEST_ORG_ID } });
  await prisma.organization.delete({ where: { id: TEST_ORG_ID } }).catch(() => {});
  await prisma.$disconnect();
});

// ─────────────────────────────────────────────────────────────
// TC-RBAC-01  Admin can list all users (user:read permission)
// ─────────────────────────────────────────────────────────────
describe("TC-RBAC-01", () => {
  it("Admin can list all users (user:read permission)", async () => {
    const res = await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${adminUser.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// TC-RBAC-02  Developer denied user:read — returns 403
// ─────────────────────────────────────────────────────────────
describe("TC-RBAC-02", () => {
  it("Developer denied user:read — returns 403", async () => {
    const res = await request(app)
      .get("/admin/users")
      .set("Authorization", `Bearer ${developerUser.token}`);
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────
// TC-RBAC-03  DevOps denied user:manage — cannot create user
// ─────────────────────────────────────────────────────────────
describe("TC-RBAC-03", () => {
  it("DevOps denied user:manage — cannot create user", async () => {
    const res = await request(app)
      .post("/admin/users")
      .set("Authorization", `Bearer ${devopsUser.token}`)
      .send({ email: "should-not-create@codesila.test", password: PASS, role: "USER" });
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────
// TC-RBAC-04  Manager denied pipeline:run — returns 403
// ─────────────────────────────────────────────────────────────
describe("TC-RBAC-04", () => {
  it("Manager denied pipeline:run — returns 403", async () => {
    const res = await request(app)
      .post("/devflow/pipelines/run")
      .set("Authorization", `Bearer ${managerUser.token}`)
      .send({});
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────
// TC-RBAC-05  Developer can run pipelines (has pipeline:run)
// ─────────────────────────────────────────────────────────────
describe("TC-RBAC-05", () => {
  it("Developer can run pipelines (has pipeline:run)", async () => {
    const res = await request(app)
      .post("/devflow/pipelines/run")
      .set("Authorization", `Bearer ${developerUser.token}`)
      .send({});
    expect(res.status).not.toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────
// TC-RBAC-06  Admin can assign a role to a user
// ─────────────────────────────────────────────────────────────
describe("TC-RBAC-06", () => {
  it("Admin can assign a role to a user", async () => {
    const devRole = await prisma.rbacRole.findUnique({ where: { name: "DEVELOPER" } });
    expect(devRole).toBeTruthy();

    const res = await request(app)
      .post(`/admin/rbac/users/${regularUser.id}/roles`)
      .set("Authorization", `Bearer ${adminUser.token}`)
      .send({ roleId: devRole!.id });
    expect(res.status).toBe(200);

    // Clean up for subsequent tests
    await prisma.userRole.deleteMany({ where: { userId: regularUser.id, roleId: devRole!.id } });
  });
});

// ─────────────────────────────────────────────────────────────
// TC-RBAC-07  Non-admin cannot assign roles (403)
// ─────────────────────────────────────────────────────────────
describe("TC-RBAC-07", () => {
  it("Non-admin cannot assign roles (403)", async () => {
    const devRole = await prisma.rbacRole.findUnique({ where: { name: "DEVELOPER" } });
    const res = await request(app)
      .post(`/admin/rbac/users/${regularUser.id}/roles`)
      .set("Authorization", `Bearer ${developerUser.token}`)
      .send({ roleId: devRole!.id });
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────
// TC-RBAC-08  Admin can revoke a role from a user
// ─────────────────────────────────────────────────────────────
describe("TC-RBAC-08", () => {
  it("Admin can revoke a role from a user", async () => {
    const devRole = await prisma.rbacRole.findUnique({ where: { name: "DEVELOPER" } });

    // Assign first
    await prisma.userRole.create({ data: { userId: regularUser.id, roleId: devRole!.id } });

    const res = await request(app)
      .delete(`/admin/rbac/users/${regularUser.id}/roles/${devRole!.id}`)
      .set("Authorization", `Bearer ${adminUser.token}`);
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────
// TC-RBAC-09  Assigning a non-existent role returns 404
// ─────────────────────────────────────────────────────────────
describe("TC-RBAC-09", () => {
  it("Assigning a non-existent role returns 404", async () => {
    const res = await request(app)
      .post(`/admin/rbac/users/${regularUser.id}/roles`)
      .set("Authorization", `Bearer ${adminUser.token}`)
      .send({ roleId: "non_existent_role_id_xxxx" });
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────
// TC-RBAC-10  Multi-role user receives union of permissions
// ─────────────────────────────────────────────────────────────
describe("TC-RBAC-10", () => {
  it("Multi-role user receives union of permissions", async () => {
    const devRole = await prisma.rbacRole.findUnique({ where: { name: "DEVELOPER" } });
    const mgrRole = await prisma.rbacRole.findUnique({ where: { name: "MANAGER" } });
    expect(devRole).toBeTruthy();
    expect(mgrRole).toBeTruthy();

    // Assign both DEVELOPER and MANAGER DB roles to the USER
    await prisma.userRole.create({ data: { userId: regularUser.id, roleId: devRole!.id } });
    await prisma.userRole.create({ data: { userId: regularUser.id, roleId: mgrRole!.id } });

    // Endpoint A: requires pipeline.run (DEVELOPER has it, USER does not)
    const resA = await request(app)
      .post("/devflow/pipelines/run")
      .set("Authorization", `Bearer ${regularUser.token}`)
      .send({});

    // Endpoint B: requires incident.manage (MANAGER has it, USER does not)
    const resB = await request(app)
      .get("/devflow/incidents")
      .set("Authorization", `Bearer ${regularUser.token}`);

    // Neither endpoint should return 403
    expect(resA.status).not.toBe(403);
    expect(resB.status).not.toBe(403);

    // Clean up
    await prisma.userRole.deleteMany({ where: { userId: regularUser.id } });
  });
});

// ─────────────────────────────────────────────────────────────
// TC-RBAC-11  Access denial is recorded in audit_logs
// ─────────────────────────────────────────────────────────────
describe("TC-RBAC-11", () => {
  it("Access denial is recorded in audit_logs", async () => {
    // Clear prior denial events for this org
    await prisma.auditEvent.deleteMany({
      where: { orgId: TEST_ORG_ID, action: "rbac.access.denied" },
    });

    // Trigger a denial — USER cannot access pipeline:run
    await request(app)
      .post("/devflow/pipelines/run")
      .set("Authorization", `Bearer ${regularUser.token}`)
      .send({});

    // Brief wait for the async audit log write
    await new Promise((r) => setTimeout(r, 500));

    const auditEntry = await prisma.auditEvent.findFirst({
      where: {
        orgId: TEST_ORG_ID,
        actorId: regularUser.id,
        action: "rbac.access.denied",
      },
    });
    expect(auditEntry).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────
// TC-RBAC-12  Admin can create a custom role
// ─────────────────────────────────────────────────────────────
describe("TC-RBAC-12", () => {
  it("Admin can create a custom role", async () => {
    const res = await request(app)
      .post("/admin/rbac/roles")
      .set("Authorization", `Bearer ${adminUser.token}`)
      .send({ name: "RBAC_TEST_CUSTOM_ROLE", description: "Test custom role", permissions: ["project.read"] });
    expect(res.status).toBe(201);
  });
});

// ─────────────────────────────────────────────────────────────
// TC-RBAC-13  Duplicate role name returns 409
// ─────────────────────────────────────────────────────────────
describe("TC-RBAC-13", () => {
  it("Duplicate role name returns 409", async () => {
    // RBAC_TEST_CUSTOM_ROLE was created in TC-RBAC-12
    const res = await request(app)
      .post("/admin/rbac/roles")
      .set("Authorization", `Bearer ${adminUser.token}`)
      .send({ name: "RBAC_TEST_CUSTOM_ROLE", description: "Duplicate", permissions: [] });
    expect(res.status).toBe(409);
  });
});

// ─────────────────────────────────────────────────────────────
// TC-RBAC-14  Admin can list all roles
// ─────────────────────────────────────────────────────────────
describe("TC-RBAC-14", () => {
  it("Admin can list all roles", async () => {
    const res = await request(app)
      .get("/admin/rbac/roles")
      .set("Authorization", `Bearer ${adminUser.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// TC-RBAC-15  System roles cannot be deleted (400)
// ─────────────────────────────────────────────────────────────
describe("TC-RBAC-15", () => {
  it("System roles cannot be deleted (400)", async () => {
    const systemRole = await prisma.rbacRole.findFirst({ where: { isSystem: true } });
    expect(systemRole).toBeTruthy();

    const res = await request(app)
      .delete(`/admin/rbac/roles/${systemRole!.id}`)
      .set("Authorization", `Bearer ${adminUser.token}`);
    expect(res.status).toBe(400);
  });
});
