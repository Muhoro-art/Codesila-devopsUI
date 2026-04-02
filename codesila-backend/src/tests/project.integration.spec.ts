/**
 * Project Integration Tests — TC-BE-PROJ-001 through TC-BE-PROJ-005
 *
 * Verify project CRUD, access-scoped listing, update authorisation,
 * archive / soft-delete behaviour, and repository-link association
 * against the real Express app with a live PostgreSQL database.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { authRateLimitStore } from "../middlewares/rateLimit";
import { seedRbacTables } from "../modules/admin/rbac/rbac.service";
import { encrypt } from "../shared/security/encryption";

const prisma = new PrismaClient();

// ─── Test constants ──────────────────────────────────────────
const TEST_ORG_ID = "org_test_proj_integration";
const PASS = "Str0ng!Pass@2026xZ";

let app: Express;
let jwtSecret: string;

let adminUser: { id: string; token: string };
let devopsUser: { id: string; token: string };
let developerUser: { id: string; token: string };
let regularUser: { id: string; token: string };

// Track created project IDs for cleanup
const createdProjectIds: string[] = [];

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
    create: { id: TEST_ORG_ID, name: "Project Test Org", slug: "proj-test-org" },
  });

  // ── Seed RBAC tables ───────────────────────────────────────
  await seedRbacTables();

  // ── Test users (various roles) ─────────────────────────────
  const admin = await prisma.user.create({
    data: { email: "proj-admin@codesila.test", passwordHash: hash, name: "Proj Admin", role: "ADMIN", orgId: TEST_ORG_ID, isActive: true },
  });
  const devops = await prisma.user.create({
    data: { email: "proj-devops@codesila.test", passwordHash: hash, name: "Proj DevOps", role: "DEVOPS", orgId: TEST_ORG_ID, isActive: true },
  });
  const developer = await prisma.user.create({
    data: { email: "proj-developer@codesila.test", passwordHash: hash, name: "Proj Developer", role: "DEVELOPER", orgId: TEST_ORG_ID, isActive: true },
  });
  const regular = await prisma.user.create({
    data: { email: "proj-user@codesila.test", passwordHash: hash, name: "Proj User", role: "USER", orgId: TEST_ORG_ID, isActive: true },
  });

  adminUser     = { id: admin.id,     token: signToken(admin.id,     "ADMIN",     admin.email) };
  devopsUser    = { id: devops.id,    token: signToken(devops.id,    "DEVOPS",    devops.email) };
  developerUser = { id: developer.id, token: signToken(developer.id, "DEVELOPER", developer.email) };
  regularUser   = { id: regular.id,   token: signToken(regular.id,   "USER",      regular.email) };
}, 30_000);

afterAll(async () => {
  // Dependency-safe teardown (innermost FKs first)
  for (const pid of createdProjectIds) {
    await prisma.gitHubRepo.deleteMany({ where: { projectId: pid } }).catch(() => {});
    await prisma.pipeline.deleteMany({ where: { projectId: pid } }).catch(() => {});
    await prisma.chatParticipant.deleteMany({ where: { room: { projectId: pid } } }).catch(() => {});
    await prisma.chatRoom.deleteMany({ where: { projectId: pid } }).catch(() => {});
    await prisma.runbook.deleteMany({ where: { projectId: pid } }).catch(() => {});
    await prisma.service.deleteMany({ where: { projectId: pid } }).catch(() => {});
    await prisma.projectEnvironment.deleteMany({ where: { projectId: pid } }).catch(() => {});
    await prisma.projectMember.deleteMany({ where: { projectId: pid } }).catch(() => {});
    await prisma.deploymentTarget.deleteMany({ where: { projectId: pid } }).catch(() => {});
  }
  await prisma.auditEvent.deleteMany({ where: { orgId: TEST_ORG_ID } });
  await prisma.project.deleteMany({ where: { orgId: TEST_ORG_ID } });
  await prisma.userRole.deleteMany({
    where: { userId: { in: [adminUser.id, devopsUser.id, developerUser.id, regularUser.id] } },
  });
  await prisma.gitHubInstallation.deleteMany({ where: { orgId: TEST_ORG_ID } }).catch(() => {});
  await prisma.user.deleteMany({ where: { orgId: TEST_ORG_ID } });
  await prisma.organization.delete({ where: { id: TEST_ORG_ID } }).catch(() => {});
  await prisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════
// TC-BE-PROJ-001  Create project
// ═══════════════════════════════════════════════════════════════
describe("TC-BE-PROJ-001 — Create project", () => {
  it("Admin creates a project — 201 with correct shape", async () => {
    const res = await request(app)
      .post("/projects")
      .set("Authorization", `Bearer ${adminUser.token}`)
      .send({
        name: "Alpha Service",
        key: "ALPHA",
        description: "Integration test project",
        type: "API",
        defaultBranch: "main",
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe("Alpha Service");
    expect(res.body.key).toBe("ALPHA");
    expect(res.body.orgId).toBe(TEST_ORG_ID);
    expect(res.body.ownerId).toBe(adminUser.id);
    expect(res.body.type).toBe("API");
    expect(res.body.status).toBe("ACTIVE");
    createdProjectIds.push(res.body.id);
  });

  it("Owner is stored as ADMIN member of the project", async () => {
    const projectId = createdProjectIds[0];
    const res = await request(app)
      .get(`/projects/${projectId}/members`)
      .set("Authorization", `Bearer ${adminUser.token}`);

    expect(res.status).toBe(200);
    const owner = res.body.find((m: any) => m.userId === adminUser.id);
    expect(owner).toBeDefined();
    expect(owner.projectRole).toBe("ADMIN");
  });

  it("Default environments are created (dev, staging, prod)", async () => {
    const projectId = createdProjectIds[0];
    const envs = await prisma.projectEnvironment.findMany({
      where: { projectId },
      orderBy: { key: "asc" },
    });
    expect(envs).toHaveLength(3);
    expect(envs.map((e) => e.key)).toEqual(["dev", "prod", "staging"]);
  });

  it("DevOps role can also create a project", async () => {
    const res = await request(app)
      .post("/projects")
      .set("Authorization", `Bearer ${devopsUser.token}`)
      .send({ name: "Beta Service", key: "BETA", type: "WEB" });

    expect(res.status).toBe(201);
    expect(res.body.ownerId).toBe(devopsUser.id);
    createdProjectIds.push(res.body.id);
  });

  it("Duplicate key in same org returns 409", async () => {
    const res = await request(app)
      .post("/projects")
      .set("Authorization", `Bearer ${adminUser.token}`)
      .send({ name: "Dup Alpha", key: "ALPHA" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/key already exists/i);
  });

  it("Missing name/key returns 400", async () => {
    const res = await request(app)
      .post("/projects")
      .set("Authorization", `Bearer ${adminUser.token}`)
      .send({ description: "no name or key" });

    expect(res.status).toBe(400);
  });

  it("DEVELOPER role is denied project creation — 403", async () => {
    const res = await request(app)
      .post("/projects")
      .set("Authorization", `Bearer ${developerUser.token}`)
      .send({ name: "Should Fail", key: "NOPE" });

    expect(res.status).toBe(403);
  });

  it("USER role is denied project creation — 403", async () => {
    const res = await request(app)
      .post("/projects")
      .set("Authorization", `Bearer ${regularUser.token}`)
      .send({ name: "Should Fail", key: "NOPE2" });

    expect(res.status).toBe(403);
  });

  it("Project created with team members includes them as MEMBERs", async () => {
    const res = await request(app)
      .post("/projects")
      .set("Authorization", `Bearer ${adminUser.token}`)
      .send({
        name: "Team Project",
        key: "TPROJ",
        type: "FULLSTACK",
        memberIds: [devopsUser.id, developerUser.id],
      });

    expect(res.status).toBe(201);
    createdProjectIds.push(res.body.id);

    const members = await prisma.projectMember.findMany({
      where: { projectId: res.body.id },
    });
    expect(members).toHaveLength(3); // owner + 2 members
    const devopsMember = members.find((m) => m.userId === devopsUser.id);
    expect(devopsMember?.role).toBe("MEMBER");
  });
});

// ═══════════════════════════════════════════════════════════════
// TC-BE-PROJ-002  List projects by user access scope
// ═══════════════════════════════════════════════════════════════
describe("TC-BE-PROJ-002 — List projects by user access scope", () => {
  it("Admin sees all org projects (elevated role)", async () => {
    const res = await request(app)
      .get("/projects")
      .set("Authorization", `Bearer ${adminUser.token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Admin should see at least the projects created in TC-001
    expect(res.body.length).toBeGreaterThanOrEqual(3);
  });

  it("DevOps sees all org projects (elevated role)", async () => {
    const res = await request(app)
      .get("/projects")
      .set("Authorization", `Bearer ${devopsUser.token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(3);
  });

  it("DEVELOPER only sees projects they are a member of", async () => {
    const res = await request(app)
      .get("/projects")
      .set("Authorization", `Bearer ${developerUser.token}`);

    expect(res.status).toBe(200);
    // Developer was only added to TPROJ (Team Project)
    const projectKeys = res.body.map((p: any) => p.key);
    expect(projectKeys).toContain("TPROJ");
    expect(projectKeys).not.toContain("ALPHA");
    expect(projectKeys).not.toContain("BETA");
  });

  it("USER only sees projects they are a member of (none)", async () => {
    const res = await request(app)
      .get("/projects")
      .set("Authorization", `Bearer ${regularUser.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it("DevOps can fetch single project detail for any org project", async () => {
    const projectId = createdProjectIds[0]; // ALPHA — owned by admin
    const res = await request(app)
      .get(`/projects/${projectId}`)
      .set("Authorization", `Bearer ${devopsUser.token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(projectId);
    expect(res.body.key).toBe("ALPHA");
  });

  it("DEVELOPER denied access to project they are not a member of — 403", async () => {
    const projectId = createdProjectIds[0]; // ALPHA — dev is NOT a member
    const res = await request(app)
      .get(`/projects/${projectId}`)
      .set("Authorization", `Bearer ${developerUser.token}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not a member/i);
  });

  it("Non-existent project returns 404", async () => {
    const res = await request(app)
      .get("/projects/non-existent-id-12345")
      .set("Authorization", `Bearer ${adminUser.token}`);

    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════
// TC-BE-PROJ-003  Update project settings
// ═══════════════════════════════════════════════════════════════
describe("TC-BE-PROJ-003 — Update project settings", () => {
  it("Admin can update project name and description", async () => {
    const projectId = createdProjectIds[0]; // ALPHA
    const res = await request(app)
      .patch(`/projects/${projectId}`)
      .set("Authorization", `Bearer ${adminUser.token}`)
      .send({ name: "Alpha Service v2", description: "Updated description" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Alpha Service v2");
    expect(res.body.description).toBe("Updated description");
  });

  it("DevOps can update project type and git URL", async () => {
    const projectId = createdProjectIds[0];
    const res = await request(app)
      .patch(`/projects/${projectId}`)
      .set("Authorization", `Bearer ${devopsUser.token}`)
      .send({ type: "FULLSTACK", gitRepositoryUrl: "https://github.com/test/repo" });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("FULLSTACK");
    expect(res.body.gitRepositoryUrl).toBe("https://github.com/test/repo");
  });

  it("Changes are persisted in the database", async () => {
    const projectId = createdProjectIds[0];
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    expect(project?.name).toBe("Alpha Service v2");
    expect(project?.type).toBe("FULLSTACK");
    expect(project?.gitRepositoryUrl).toBe("https://github.com/test/repo");
  });

  it("DEVELOPER role is denied project update — 403", async () => {
    const projectId = createdProjectIds[0];
    const res = await request(app)
      .patch(`/projects/${projectId}`)
      .set("Authorization", `Bearer ${developerUser.token}`)
      .send({ name: "Should Fail" });

    expect(res.status).toBe(403);
  });

  it("USER role is denied project update — 403", async () => {
    const projectId = createdProjectIds[0];
    const res = await request(app)
      .patch(`/projects/${projectId}`)
      .set("Authorization", `Bearer ${regularUser.token}`)
      .send({ name: "Should Fail" });

    expect(res.status).toBe(403);
  });

  it("Empty body returns 400", async () => {
    const projectId = createdProjectIds[0];
    const res = await request(app)
      .patch(`/projects/${projectId}`)
      .set("Authorization", `Bearer ${adminUser.token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no changes/i);
  });

  it("Update on non-existent project returns 404", async () => {
    const res = await request(app)
      .patch("/projects/non-existent-id-12345")
      .set("Authorization", `Bearer ${adminUser.token}`)
      .send({ name: "Ghost" });

    expect(res.status).toBe(404);
  });

  it("Audit event is recorded for update", async () => {
    const projectId = createdProjectIds[0];
    const events = await prisma.auditEvent.findMany({
      where: { orgId: TEST_ORG_ID, projectId, action: "project.update" },
      orderBy: { createdAt: "desc" },
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].entityType).toBe("project");
  });
});

// ═══════════════════════════════════════════════════════════════
// TC-BE-PROJ-004  Delete or archive project
// ═══════════════════════════════════════════════════════════════
describe("TC-BE-PROJ-004 — Delete or archive project", () => {
  let archiveProjectId: string;

  beforeAll(async () => {
    // Create a project specifically for archive testing
    const res = await request(app)
      .post("/projects")
      .set("Authorization", `Bearer ${adminUser.token}`)
      .send({ name: "Archive Target", key: "ARCH_TGT", type: "API" });
    archiveProjectId = res.body.id;
    createdProjectIds.push(archiveProjectId);

    // Add a pipeline so we can verify dependent behaviour
    await prisma.pipeline.create({
      data: {
        projectId: archiveProjectId,
        name: "Build Pipeline",
        configYaml: "stages:\n  - name: build\n    command: echo ok\n",
        createdById: adminUser.id,
      },
    });
  });

  it("Admin can archive a project — 200", async () => {
    const res = await request(app)
      .delete(`/projects/${archiveProjectId}`)
      .set("Authorization", `Bearer ${adminUser.token}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/archived/i);
    expect(res.body.project.status).toBe("ARCHIVED");
  });

  it("Archived project status is ARCHIVED in database", async () => {
    const project = await prisma.project.findUnique({ where: { id: archiveProjectId } });
    expect(project?.status).toBe("ARCHIVED");
  });

  it("Pipelines still exist after archive (not cascade deleted)", async () => {
    const pipelines = await prisma.pipeline.findMany({ where: { projectId: archiveProjectId } });
    expect(pipelines.length).toBeGreaterThanOrEqual(1);
  });

  it("Archived project is excluded from active list when status filter used", async () => {
    const res = await request(app)
      .get("/projects?status=ACTIVE")
      .set("Authorization", `Bearer ${adminUser.token}`);

    expect(res.status).toBe(200);
    const ids = res.body.map((p: any) => p.id);
    expect(ids).not.toContain(archiveProjectId);
  });

  it("DEVOPS role can archive — 200 (has ProjectAdmin)", async () => {
    // DEVOPS has project.admin permission, so it can archive
    const targetId = createdProjectIds[1]; // BETA
    const res = await request(app)
      .delete(`/projects/${targetId}`)
      .set("Authorization", `Bearer ${devopsUser.token}`);

    expect(res.status).toBe(200);
    expect(res.body.project.status).toBe("ARCHIVED");
  });

  it("DEVELOPER role is denied archive — 403", async () => {
    const targetId = createdProjectIds[1];
    const res = await request(app)
      .delete(`/projects/${targetId}`)
      .set("Authorization", `Bearer ${developerUser.token}`);

    expect(res.status).toBe(403);
  });

  it("Archive of non-existent project returns 404", async () => {
    const res = await request(app)
      .delete("/projects/non-existent-id-12345")
      .set("Authorization", `Bearer ${adminUser.token}`);

    expect(res.status).toBe(404);
  });

  it("Audit event is recorded for archive", async () => {
    const events = await prisma.auditEvent.findMany({
      where: { orgId: TEST_ORG_ID, projectId: archiveProjectId, action: "project.archive" },
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// TC-BE-PROJ-005  Link repository to project
// ═══════════════════════════════════════════════════════════════
describe("TC-BE-PROJ-005 — Link repository to project", () => {
  let linkProjectId: string;

  beforeAll(async () => {
    // Create project for linking tests
    const res = await request(app)
      .post("/projects")
      .set("Authorization", `Bearer ${adminUser.token}`)
      .send({ name: "Repo Link Project", key: "REPOLINK", type: "API" });
    linkProjectId = res.body.id;
    createdProjectIds.push(linkProjectId);

    // Create a fake GitHubInstallation so the link endpoint doesn't fail
    // with "GitHub not connected"
    await prisma.gitHubInstallation.upsert({
      where: { orgId: TEST_ORG_ID },
      update: {},
      create: {
        orgId: TEST_ORG_ID,
        installationId: null,
        accessToken: encrypt("ghs_fake_token_for_test"),
        tokenExpiresAt: new Date(Date.now() + 3600000),
        githubLogin: "test-org",
        connectedById: adminUser.id,
      },
    });
  });

  it("Repo metadata is associated with project — 201", async () => {
    // The actual GitHub API call to create the webhook will likely fail
    // (no real token), but the record creation should still succeed
    // because the route catches webhook creation errors gracefully.
    const res = await request(app)
      .post("/integrations/github/repos/link")
      .set("Authorization", `Bearer ${adminUser.token}`)
      .send({
        projectId: linkProjectId,
        githubRepoId: 123456789,
        fullName: "test-org/test-repo",
        defaultBranch: "main",
        private: false,
        htmlUrl: "https://github.com/test-org/test-repo",
      });

    expect(res.status).toBe(201);
    expect(res.body.projectId).toBe(linkProjectId);
    expect(res.body.fullName).toBe("test-org/test-repo");
    expect(res.body.githubRepoId).toBe(123456789);
  });

  it("Linked repo is stored in database correctly", async () => {
    const repo = await prisma.gitHubRepo.findFirst({
      where: { projectId: linkProjectId, githubRepoId: 123456789 },
    });
    expect(repo).toBeDefined();
    expect(repo?.fullName).toBe("test-org/test-repo");
    expect(repo?.defaultBranch).toBe("main");
    expect(repo?.private).toBe(false);
  });

  it("Project gitRepositoryUrl is auto-updated when not previously set", async () => {
    const project = await prisma.project.findUnique({ where: { id: linkProjectId } });
    expect(project?.gitRepositoryUrl).toBe("https://github.com/test-org/test-repo");
    expect(project?.defaultBranch).toBe("main");
  });

  it("Linked repos are retrievable via GET /integrations/github/repos", async () => {
    const res = await request(app)
      .get(`/integrations/github/repos?projectId=${linkProjectId}`)
      .set("Authorization", `Bearer ${adminUser.token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const linked = res.body.find((r: any) => r.githubRepoId === 123456789);
    expect(linked).toBeDefined();
    expect(linked.fullName).toBe("test-org/test-repo");
  });

  it("Duplicate link returns 409", async () => {
    const res = await request(app)
      .post("/integrations/github/repos/link")
      .set("Authorization", `Bearer ${adminUser.token}`)
      .send({
        projectId: linkProjectId,
        githubRepoId: 123456789,
        fullName: "test-org/test-repo",
        htmlUrl: "https://github.com/test-org/test-repo",
      });

    expect(res.status).toBe(409);
  });

  it("Missing required fields returns 400", async () => {
    const res = await request(app)
      .post("/integrations/github/repos/link")
      .set("Authorization", `Bearer ${adminUser.token}`)
      .send({ projectId: linkProjectId }); // missing githubRepoId, fullName, htmlUrl

    expect(res.status).toBe(400);
  });

  it("Link to non-existent project returns 404", async () => {
    const res = await request(app)
      .post("/integrations/github/repos/link")
      .set("Authorization", `Bearer ${adminUser.token}`)
      .send({
        projectId: "non-existent-project-id",
        githubRepoId: 999999999,
        fullName: "test-org/ghost-repo",
        htmlUrl: "https://github.com/test-org/ghost-repo",
      });

    expect(res.status).toBe(404);
  });

  it("DEVELOPER role is denied repo link — 403", async () => {
    const res = await request(app)
      .post("/integrations/github/repos/link")
      .set("Authorization", `Bearer ${developerUser.token}`)
      .send({
        projectId: linkProjectId,
        githubRepoId: 999888777,
        fullName: "test-org/other-repo",
        htmlUrl: "https://github.com/test-org/other-repo",
      });

    expect(res.status).toBe(403);
  });
});
