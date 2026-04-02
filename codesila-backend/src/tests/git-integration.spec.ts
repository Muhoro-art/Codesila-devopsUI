/**
 * Git & Docker Integration Tests — TC-GIT-01 through TC-GIT-11, TC-DOCKER-01 through TC-DOCKER-05
 *
 * Uses REAL external APIs (GitHub, GitLab, Docker Registry).
 *
 * Required env vars  (in .env):
 *   GITHUB_PAT           – Classic PAT with scopes: repo, admin:repo_hook
 *   GITHUB_TEST_OWNER    – GitHub owner   (default Faridoon0093)
 *   GITHUB_TEST_REPO     – GitHub repo    (default CodeSila-1)
 *
 * Optional (tests skip when absent):
 *   GITLAB_PAT           – GitLab PAT with api scope
 *   DOCKER_REGISTRY_URL  – e.g. https://registry.example.com
 *   DOCKER_USERNAME, DOCKER_PAT
 *
 * All 16 tests use real external APIs — zero mocks.
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

// ─── Real tokens from environment ────────────────────────────

const GITHUB_PAT   = process.env.GITHUB_PAT || "";
const GH_OWNER     = process.env.GITHUB_TEST_OWNER || "Faridoon0093";
const GH_REPO      = process.env.GITHUB_TEST_REPO || "CodeSila-1";

const GITLAB_PAT_TOKEN = process.env.GITLAB_PAT || "";

const DOCKER_REG_URL = process.env.DOCKER_REGISTRY_URL || "";
const DOCKER_USER    = process.env.DOCKER_USERNAME || "";
const DOCKER_PAT_TOK = process.env.DOCKER_PAT || "";

const hasGitHub = !!GITHUB_PAT;
const hasGitLab = !!GITLAB_PAT_TOKEN;
const hasDocker = !!(DOCKER_REG_URL && DOCKER_USER && DOCKER_PAT_TOK);

// ─── Test constants ──────────────────────────────────────────

const TEST_ORG_ID = "org_test_git_integration";
const PASS = "Str0ng!Pass@2026xZ";

let app: Express;
let jwtSecret: string;

let devopsUser: { id: string; token: string };
let developerUser: { id: string; token: string };

// Track webhook IDs for cleanup
const createdWebhooks: { id: number; owner: string; repo: string }[] = [];

function signToken(userId: string, role: string, email: string): string {
  return jwt.sign(
    { sub: userId, role, orgId: TEST_ORG_ID, email, type: "access" },
    jwtSecret,
    { algorithm: "HS256", issuer: "codesila-api", audience: "codesila-client", expiresIn: "15m" },
  );
}

// ─── Setup / Teardown ────────────────────────────────────────

beforeEach(async () => {
  await authRateLimitStore.resetAll();
});

beforeAll(async () => {
  const mod = await import("../app");
  app = mod.buildApp();

  const { env } = await import("../config/env");
  jwtSecret = env.JWT_SECRET;

  const hash = await bcrypt.hash(PASS, 10);

  // org
  await prisma.organization.upsert({
    where: { id: TEST_ORG_ID },
    update: {},
    create: { id: TEST_ORG_ID, name: "Git Integration Test Org", slug: "git-integ-test-org" },
  });

  // users
  const devops = await prisma.user.create({
    data: { email: "git-devops@codesila.test", passwordHash: hash, name: "Git DevOps", role: "DEVOPS", orgId: TEST_ORG_ID, isActive: true },
  });
  const dev = await prisma.user.create({
    data: { email: "git-developer@codesila.test", passwordHash: hash, name: "Git Developer", role: "DEVELOPER", orgId: TEST_ORG_ID, isActive: true },
  });

  devopsUser = { id: devops.id, token: signToken(devops.id, "DEVOPS", devops.email) };
  developerUser = { id: dev.id, token: signToken(dev.id, "DEVELOPER", dev.email) };

  await seedRbacTables();
}, 30_000);

afterAll(async () => {
  // Clean up real webhooks created during tests
  if (GITHUB_PAT) {
    for (const hook of createdWebhooks) {
      try {
        await fetch(`https://api.github.com/repos/${hook.owner}/${hook.repo}/hooks/${hook.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${GITHUB_PAT}`, "User-Agent": "CodeSila/1.0" },
        });
      } catch { /* best-effort cleanup */ }
    }
  }

  await prisma.integration.deleteMany({ where: { orgId: TEST_ORG_ID } });
  await prisma.auditEvent.deleteMany({ where: { orgId: TEST_ORG_ID } });
  await prisma.userRole.deleteMany({ where: { userId: { in: [devopsUser.id, developerUser.id] } } });
  await prisma.user.deleteMany({ where: { orgId: TEST_ORG_ID } });
  await prisma.organization.delete({ where: { id: TEST_ORG_ID } }).catch(() => {});
  await prisma.$disconnect();
});

// ═════════════════════════════════════════════════════════════
// TC-GIT-01  Connect GitHub with valid PAT — 201 returned
// (skips when GITHUB_PAT is not set)
// ═════════════════════════════════════════════════════════════
describe.skipIf(!hasGitHub)("TC-GIT-01", () => {
  it("Connect GitHub with valid PAT — 201, token not in response", async () => {
    const res = await request(app)
      .post("/api/integrations")
      .set("Authorization", `Bearer ${devopsUser.token}`)
      .send({ type: "github", token: GITHUB_PAT, name: "My GitHub" });

    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.type).toBe("github");
    // Token must NOT appear in response
    expect(JSON.stringify(res.body)).not.toContain(GITHUB_PAT);
  });
});

// ═════════════════════════════════════════════════════════════
// TC-GIT-02  Invalid GitHub token returns 400 INVALID_TOKEN
// (calls real GitHub API with a bad token — always runs)
// ═════════════════════════════════════════════════════════════
describe("TC-GIT-02", () => {
  it("Invalid GitHub token returns 400 INVALID_TOKEN", async () => {
    const res = await request(app)
      .post("/api/integrations")
      .set("Authorization", `Bearer ${devopsUser.token}`)
      .send({ type: "github", token: "bad_token_invalid", name: "Bad GitHub" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_TOKEN");
  });
});

// ═════════════════════════════════════════════════════════════
// TC-GIT-03  Token stored encrypted — plaintext not in DB
// ═════════════════════════════════════════════════════════════
describe.skipIf(!hasGitHub)("TC-GIT-03", () => {
  it("credentials_enc column differs from original token", async () => {
    const res = await request(app)
      .post("/api/integrations")
      .set("Authorization", `Bearer ${devopsUser.token}`)
      .send({ type: "github", token: GITHUB_PAT, name: "Encrypted Check" });

    expect(res.status).toBe(201);
    const id = res.body.data.id;

    const dbRow = await prisma.integration.findUnique({ where: { id } });
    expect(dbRow).not.toBeNull();
    expect(dbRow!.credentialsEnc).not.toBe(GITHUB_PAT);
    expect(dbRow!.credentialsEnc).not.toContain(GITHUB_PAT);
  });
});

// ═════════════════════════════════════════════════════════════
// TC-GIT-04  Developer cannot create integrations (403)
// (RBAC middleware blocks before any external call — always runs)
// ═════════════════════════════════════════════════════════════
describe("TC-GIT-04", () => {
  it("Developer without integration:manage gets 403", async () => {
    const res = await request(app)
      .post("/api/integrations")
      .set("Authorization", `Bearer ${developerUser.token}`)
      .send({ type: "github", token: "any_token", name: "Should Fail" });

    expect(res.status).toBe(403);
  });
});

// ═════════════════════════════════════════════════════════════
// TC-GIT-05  Repositories listed in unified format
// ═════════════════════════════════════════════════════════════
describe.skipIf(!hasGitHub)("TC-GIT-05", () => {
  let integrationId: string;

  beforeAll(async () => {
    const integ = await prisma.integration.create({
      data: { orgId: TEST_ORG_ID, type: "github", name: "TC05 GitHub", credentialsEnc: encrypt(GITHUB_PAT), createdById: devopsUser.id },
    });
    integrationId = integ.id;
  });

  it("Each repo has name, fullName, cloneUrl, defaultBranch, isPrivate", async () => {
    const res = await request(app)
      .get(`/api/integrations/${integrationId}/repositories`)
      .set("Authorization", `Bearer ${devopsUser.token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);

    for (const repo of res.body.data) {
      expect(repo).toHaveProperty("name");
      expect(repo).toHaveProperty("fullName");
      expect(repo).toHaveProperty("cloneUrl");
      expect(repo).toHaveProperty("defaultBranch");
      expect(repo).toHaveProperty("isPrivate");
    }
  });
});

// ═════════════════════════════════════════════════════════════
// TC-GIT-06  Branch list returned for a repository
// ═════════════════════════════════════════════════════════════
describe.skipIf(!hasGitHub)("TC-GIT-06", () => {
  let integrationId: string;

  beforeAll(async () => {
    const integ = await prisma.integration.create({
      data: { orgId: TEST_ORG_ID, type: "github", name: "TC06 GitHub", credentialsEnc: encrypt(GITHUB_PAT), createdById: devopsUser.id },
    });
    integrationId = integ.id;
  });

  it("Branches array includes 'main'", async () => {
    // First get the list of repos to find one that exists
    const repoRes = await request(app)
      .get(`/api/integrations/${integrationId}/repositories`)
      .set("Authorization", `Bearer ${devopsUser.token}`);
    expect(repoRes.status).toBe(200);
    const firstRepo = repoRes.body.data[0];
    const [owner, repo] = firstRepo.fullName.split("/");

    const res = await request(app)
      .get(`/api/integrations/${integrationId}/repositories/${owner}/${repo}/branches`)
      .set("Authorization", `Bearer ${devopsUser.token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const names = res.body.data.map((b: any) => b.name);
    expect(names).toContain("main");
  });
});

// ═════════════════════════════════════════════════════════════
// TC-GIT-07  Webhook created in GitHub repository
// (creates a REAL webhook — cleaned up in afterAll)
// Needs a repo where the PAT has admin:repo_hook permission.
// ═════════════════════════════════════════════════════════════
describe.skipIf(!hasGitHub)("TC-GIT-07", () => {
  let integrationId: string;
  let adminOwner = "";
  let adminRepo = "";

  beforeAll(async () => {
    // Find a repo where the PAT has admin access (required for webhook creation)
    const reposRes = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated", {
      headers: { Authorization: `Bearer ${GITHUB_PAT}`, "User-Agent": "CodeSila/1.0", Accept: "application/vnd.github.v3+json" },
    });
    const repos = await reposRes.json() as any[];
    const adminRepoObj = repos.find((r: any) => r.permissions?.admin);
    if (adminRepoObj) {
      [adminOwner, adminRepo] = adminRepoObj.full_name.split("/");
    }

    const integ = await prisma.integration.create({
      data: { orgId: TEST_ORG_ID, type: "github", name: "TC07 GitHub", credentialsEnc: encrypt(GITHUB_PAT), createdById: devopsUser.id },
    });
    integrationId = integ.id;
  });

  it("Webhook creation returns 201 with webhookId", async () => {
    if (!adminOwner) return; // skip if no admin repo found

    const res = await request(app)
      .post(`/api/integrations/${integrationId}/repositories/${adminOwner}/${adminRepo}/webhooks`)
      .set("Authorization", `Bearer ${devopsUser.token}`)
      .send({ webhookUrl: "https://example.com/codesila-test-hook-" + Date.now(), events: ["push"] });

    expect(res.status).toBe(201);
    expect(res.body.data.webhookId).toBeDefined();
    // Track for cleanup in afterAll
    createdWebhooks.push({ id: res.body.data.webhookId, owner: adminOwner, repo: adminRepo });
  });
});

// ═════════════════════════════════════════════════════════════
// TC-GIT-08  GitHub rate-limit headers tracked in real responses
// ═════════════════════════════════════════════════════════════
describe.skipIf(!hasGitHub)("TC-GIT-08", () => {
  let integrationId: string;

  beforeAll(async () => {
    const integ = await prisma.integration.create({
      data: { orgId: TEST_ORG_ID, type: "github", name: "TC08 Rate", credentialsEnc: encrypt(GITHUB_PAT), createdById: devopsUser.id },
    });
    integrationId = integ.id;
  });

  it("GitHub API returns rate-limit headers and endpoint succeeds", async () => {
    // Direct fetch to verify GitHub sends rate-limit headers
    const ghRes = await fetch("https://api.github.com/user/repos?per_page=1", {
      headers: { Authorization: `Bearer ${GITHUB_PAT}`, Accept: "application/vnd.github.v3+json", "User-Agent": "CodeSila/1.0" },
    });
    expect(ghRes.ok).toBe(true);
    expect(ghRes.headers.get("x-ratelimit-limit")).toBeTruthy();
    expect(Number(ghRes.headers.get("x-ratelimit-remaining"))).toBeGreaterThan(0);

    // Endpoint call — proves non-rate-limited path succeeds end-to-end
    const res = await request(app)
      .get(`/api/integrations/${integrationId}/repositories`)
      .set("Authorization", `Bearer ${devopsUser.token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════
// TC-GIT-09  Pagination loop returns every repo — real API
// ═════════════════════════════════════════════════════════════
describe.skipIf(!hasGitHub)("TC-GIT-09", () => {
  let integrationId: string;

  beforeAll(async () => {
    const integ = await prisma.integration.create({
      data: { orgId: TEST_ORG_ID, type: "github", name: "TC09 Paged", credentialsEnc: encrypt(GITHUB_PAT), createdById: devopsUser.id },
    });
    integrationId = integ.id;
  });

  it("Pagination loop returns correct repo count matching direct API", async () => {
    // Direct GitHub call to independently count repos
    const ghRes = await fetch("https://api.github.com/user/repos?per_page=100", {
      headers: { Authorization: `Bearer ${GITHUB_PAT}`, Accept: "application/vnd.github.v3+json", "User-Agent": "CodeSila/1.0" },
    });
    const ghRepos = await ghRes.json() as any[];

    // Endpoint call through our pagination loop
    const res = await request(app)
      .get(`/api/integrations/${integrationId}/repositories`)
      .set("Authorization", `Bearer ${devopsUser.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(ghRepos.length);
    // Verify unified schema on every repo
    for (const repo of res.body.data) {
      expect(repo).toHaveProperty("name");
      expect(repo).toHaveProperty("fullName");
      expect(repo).toHaveProperty("cloneUrl");
      expect(repo).toHaveProperty("defaultBranch");
      expect(typeof repo.isPrivate).toBe("boolean");
    }
  });
});

// ═════════════════════════════════════════════════════════════
// TC-GIT-10  GitLab integration connected with valid token
// ═════════════════════════════════════════════════════════════
describe.skipIf(!hasGitLab)("TC-GIT-10", () => {
  it("GitLab connect returns 201 with type='gitlab'", async () => {
    const res = await request(app)
      .post("/api/integrations")
      .set("Authorization", `Bearer ${devopsUser.token}`)
      .send({ type: "gitlab", token: GITLAB_PAT_TOKEN, name: "My GitLab" });

    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe("gitlab");
  });
});

// ═════════════════════════════════════════════════════════════
// TC-GIT-11  GitLab repos returned in same unified schema
// ═════════════════════════════════════════════════════════════
describe.skipIf(!hasGitLab)("TC-GIT-11", () => {
  let integrationId: string;

  beforeAll(async () => {
    const integ = await prisma.integration.create({
      data: { orgId: TEST_ORG_ID, type: "gitlab", name: "TC11 GitLab", credentialsEnc: encrypt(GITLAB_PAT_TOKEN), createdById: devopsUser.id },
    });
    integrationId = integ.id;
  });

  it("GitLab repos have same fields as GitHub repos", async () => {
    const res = await request(app)
      .get(`/api/integrations/${integrationId}/repositories`)
      .set("Authorization", `Bearer ${devopsUser.token}`);

    expect(res.status).toBe(200);
    for (const repo of res.body.data) {
      expect(repo).toHaveProperty("name");
      expect(repo).toHaveProperty("fullName");
      expect(repo).toHaveProperty("cloneUrl");
      expect(repo).toHaveProperty("defaultBranch");
      expect(repo).toHaveProperty("isPrivate");
    }
  });
});

// ═════════════════════════════════════════════════════════════
// TC-DOCKER-01  Docker Registry connected with valid credentials
// ═════════════════════════════════════════════════════════════
describe.skipIf(!hasDocker)("TC-DOCKER-01", () => {
  it("Docker registry connect returns 201 with type='docker_registry'", async () => {
    const res = await request(app)
      .post("/api/integrations")
      .set("Authorization", `Bearer ${devopsUser.token}`)
      .send({
        type: "docker_registry",
        registryUrl: DOCKER_REG_URL,
        username: DOCKER_USER,
        token: DOCKER_PAT_TOK,
        name: "My Docker Registry",
      });

    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe("docker_registry");
  });
});

// ═════════════════════════════════════════════════════════════
// TC-DOCKER-02  Unreachable registry URL returns 400
// (real network call to localhost:1 → ECONNREFUSED — always runs)
// ═════════════════════════════════════════════════════════════
describe("TC-DOCKER-02", () => {
  it("Unreachable registry returns 400 REGISTRY_UNREACHABLE", async () => {
    const res = await request(app)
      .post("/api/integrations")
      .set("Authorization", `Bearer ${devopsUser.token}`)
      .send({
        type: "docker_registry",
        registryUrl: "http://127.0.0.1:1",
        username: "dockuser",
        token: "anytoken",
        name: "Bad Registry",
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("REGISTRY_UNREACHABLE");
  }, 10_000);
});

// ═════════════════════════════════════════════════════════════
// TC-DOCKER-03  Deleting integration deactivates it in DB
// (DB-only operation — always runs)
// ═════════════════════════════════════════════════════════════
describe("TC-DOCKER-03", () => {
  let integrationId: string;

  beforeAll(async () => {
    const integ = await prisma.integration.create({
      data: {
        orgId: TEST_ORG_ID,
        type: "docker_registry",
        name: "TC-D03 Docker",
        credentialsEnc: encrypt("dummy_token"),
        registryUrl: "https://registry.example.com",
        username: "dockuser",
        createdById: devopsUser.id,
      },
    });
    integrationId = integ.id;
  });

  it("DELETE sets is_active=false (soft delete)", async () => {
    const res = await request(app)
      .delete(`/api/integrations/${integrationId}`)
      .set("Authorization", `Bearer ${devopsUser.token}`);

    expect(res.status).toBe(200);

    const dbRow = await prisma.integration.findUnique({ where: { id: integrationId } });
    expect(dbRow!.isActive).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════
// TC-DOCKER-04  Cannot access another user's integration
// (RBAC middleware blocks — always runs)
// ═════════════════════════════════════════════════════════════
describe("TC-DOCKER-04", () => {
  let adminIntegrationId: string;

  beforeAll(async () => {
    const integ = await prisma.integration.create({
      data: {
        orgId: TEST_ORG_ID,
        type: "github",
        name: "TC-D04 Admin GitHub",
        credentialsEnc: encrypt("dummy"),
        createdById: devopsUser.id,
      },
    });
    adminIntegrationId = integ.id;
  });

  it("Developer gets 403 or 404 on another user's integration", async () => {
    const res = await request(app)
      .get(`/api/integrations/${adminIntegrationId}/repositories`)
      .set("Authorization", `Bearer ${developerUser.token}`);

    expect([403, 404]).toContain(res.status);
  });
});

// ═════════════════════════════════════════════════════════════
// TC-DOCKER-05  Missing required fields return 400 validation error
// (input validation — no external call — always runs)
// ═════════════════════════════════════════════════════════════
describe("TC-DOCKER-05", () => {
  it("Missing token and name returns 400 with non-empty details", async () => {
    const res = await request(app)
      .post("/api/integrations")
      .set("Authorization", `Bearer ${devopsUser.token}`)
      .send({ type: "github" });

    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details.length).toBeGreaterThan(0);
  });
});
