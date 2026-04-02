/**
 * CI/CD Integration Tests — TC-CICD-01 through TC-CICD-22
 *
 * Verify pipeline CRUD, run lifecycle, step/log retrieval, cancellation,
 * pagination, RBAC enforcement, and concurrent runs against the real
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
const TEST_ORG_ID = "org_test_cicd_integration";
const PASS = "Str0ng!Pass@2026xZ";

const VALID_YAML = `
name: build-and-deploy
trigger: push
stages:
  - name: build
    type: shell
    command: npm run build
  - name: test
    type: shell
    command: npm test
`;

const DOCKER_YAML = `
name: docker-pipeline
trigger: push
stages:
  - name: docker-build
    type: docker_build
    dockerfile: ./Dockerfile
    tag: latest
    push: true
`;

const NO_STAGES_YAML = `
name: broken-pipeline
trigger: push
`;

const BROKEN_YAML = "name: test\n  stages:\n- invalid: {{{}}}yaml: ::\n";

let app: Express;
let jwtSecret: string;

let devopsUser: { id: string; token: string };
let developerUser: { id: string; token: string };
let regularUser: { id: string; token: string };

let testProjectId: string;

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
    create: { id: TEST_ORG_ID, name: "CICD Test Org", slug: "cicd-test-org" },
  });

  // ── Test users ─────────────────────────────────────────────
  const devops = await prisma.user.create({
    data: { email: "cicd-devops@codesila.test", passwordHash: hash, name: "CICD DevOps", role: "DEVOPS", orgId: TEST_ORG_ID, isActive: true },
  });
  const developer = await prisma.user.create({
    data: { email: "cicd-developer@codesila.test", passwordHash: hash, name: "CICD Developer", role: "DEVELOPER", orgId: TEST_ORG_ID, isActive: true },
  });
  const regular = await prisma.user.create({
    data: { email: "cicd-user@codesila.test", passwordHash: hash, name: "CICD User", role: "USER", orgId: TEST_ORG_ID, isActive: true },
  });

  devopsUser    = { id: devops.id,    token: signToken(devops.id,    "DEVOPS",    devops.email) };
  developerUser = { id: developer.id, token: signToken(developer.id, "DEVELOPER", developer.email) };
  regularUser   = { id: regular.id,   token: signToken(regular.id,   "USER",      regular.email) };

  // ── Seed RBAC tables ───────────────────────────────────────
  await seedRbacTables();

  // ── Test project ───────────────────────────────────────────
  const project = await prisma.project.create({
    data: {
      orgId: TEST_ORG_ID,
      name: "CICD Test Project",
      key: "CICD_TEST",
      ownerId: devops.id,
    },
  });
  testProjectId = project.id;
}, 30_000);

afterAll(async () => {
  // Dependency-safe teardown (innermost FKs first)
  await prisma.runStep.deleteMany({
    where: { run: { pipeline: { projectId: testProjectId } } },
  });
  await prisma.pipelineRun.deleteMany({
    where: { pipeline: { projectId: testProjectId } },
  });
  await prisma.pipeline.deleteMany({ where: { projectId: testProjectId } });
  await prisma.auditEvent.deleteMany({ where: { orgId: TEST_ORG_ID } });
  await prisma.userRole.deleteMany({
    where: { userId: { in: [devopsUser.id, developerUser.id, regularUser.id] } },
  });
  await prisma.project.deleteMany({ where: { orgId: TEST_ORG_ID } });
  await prisma.user.deleteMany({ where: { orgId: TEST_ORG_ID } });
  await prisma.organization.delete({ where: { id: TEST_ORG_ID } }).catch(() => {});
  await prisma.$disconnect();
});

// ─────────────────────────────────────────────────────────────
// TC-CICD-01  Pipeline created with valid YAML — 201 returned
// ─────────────────────────────────────────────────────────────
describe("TC-CICD-01", () => {
  it("Pipeline created with valid YAML — 201 returned", async () => {
    const res = await request(app)
      .post(`/api/projects/${testProjectId}/pipelines`)
      .set("Authorization", `Bearer ${devopsUser.token}`)
      .send({ name: "TC01 Pipeline", config_yaml: VALID_YAML });

    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.name).toBe("TC01 Pipeline");
    expect(res.body.data.project_id).toBe(testProjectId);
  });
});

// ─────────────────────────────────────────────────────────────
// TC-CICD-02  Pipeline with missing stages returns 400
// ─────────────────────────────────────────────────────────────
describe("TC-CICD-02", () => {
  it("Pipeline with missing stages returns 400", async () => {
    const res = await request(app)
      .post(`/api/projects/${testProjectId}/pipelines`)
      .set("Authorization", `Bearer ${devopsUser.token}`)
      .send({ name: "No Stages", config_yaml: NO_STAGES_YAML });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_PIPELINE_CONFIG");
    expect(res.body.details[0].field).toBe("stages");
  });
});

// ─────────────────────────────────────────────────────────────
// TC-CICD-03  Syntactically broken YAML returns 400 YAML_PARSE_ERROR
// ─────────────────────────────────────────────────────────────
describe("TC-CICD-03", () => {
  it("Broken YAML returns 400 YAML_PARSE_ERROR", async () => {
    const res = await request(app)
      .post(`/api/projects/${testProjectId}/pipelines`)
      .set("Authorization", `Bearer ${devopsUser.token}`)
      .send({ name: "Broken YAML", config_yaml: BROKEN_YAML });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("YAML_PARSE_ERROR");
  });
});

// ─────────────────────────────────────────────────────────────
// TC-CICD-04  Pipeline name missing returns 400 validation error
// ─────────────────────────────────────────────────────────────
describe("TC-CICD-04", () => {
  it("Missing pipeline name returns 400", async () => {
    const res = await request(app)
      .post(`/api/projects/${testProjectId}/pipelines`)
      .set("Authorization", `Bearer ${devopsUser.token}`)
      .send({ config_yaml: VALID_YAML });

    expect(res.status).toBe(400);
    expect(res.body.details.some((d: any) => d.field === "name")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// TC-CICD-05  Developer cannot create pipelines (403)
// ─────────────────────────────────────────────────────────────
describe("TC-CICD-05", () => {
  it("Developer cannot create pipelines (403)", async () => {
    const res = await request(app)
      .post(`/api/projects/${testProjectId}/pipelines`)
      .set("Authorization", `Bearer ${developerUser.token}`)
      .send({ name: "Should Fail", config_yaml: VALID_YAML });

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────
// TC-CICD-06  Pipeline launch returns 202 with runId
// ─────────────────────────────────────────────────────────────
describe("TC-CICD-06", () => {
  let pipelineId: string;

  beforeAll(async () => {
    const p = await prisma.pipeline.create({
      data: { projectId: testProjectId, name: "TC06 Pipeline", configYaml: VALID_YAML, createdById: devopsUser.id },
    });
    pipelineId = p.id;
  });

  it("Pipeline launch returns 202 with runId", async () => {
    const res = await request(app)
      .post(`/api/pipelines/${pipelineId}/runs`)
      .set("Authorization", `Bearer ${developerUser.token}`)
      .send({});

    expect(res.status).toBe(202);
    expect(res.body.data.runId).toBeDefined();
    // UUID-like check (cuid is alphanumeric, at least 20 chars)
    expect(typeof res.body.data.runId).toBe("string");
    expect(res.body.data.runId.length).toBeGreaterThanOrEqual(20);
  });
});

// ─────────────────────────────────────────────────────────────
// TC-CICD-07  Newly created run has QUEUED status
// ─────────────────────────────────────────────────────────────
describe("TC-CICD-07", () => {
  let pipelineId: string;

  beforeAll(async () => {
    const p = await prisma.pipeline.create({
      data: { projectId: testProjectId, name: "TC07 Pipeline", configYaml: VALID_YAML, createdById: devopsUser.id },
    });
    pipelineId = p.id;
  });

  it("New run has QUEUED status", async () => {
    const launchRes = await request(app)
      .post(`/api/pipelines/${pipelineId}/runs`)
      .set("Authorization", `Bearer ${developerUser.token}`)
      .send({});

    const runId = launchRes.body.data.runId;

    const getRes = await request(app)
      .get(`/api/runs/${runId}`)
      .set("Authorization", `Bearer ${developerUser.token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.status).toBe("QUEUED");
    expect(getRes.body.data.pipeline_id).toBe(pipelineId);
  });
});

// ─────────────────────────────────────────────────────────────
// TC-CICD-08  Run.triggered_by matches the requesting user
// ─────────────────────────────────────────────────────────────
describe("TC-CICD-08", () => {
  let pipelineId: string;

  beforeAll(async () => {
    const p = await prisma.pipeline.create({
      data: { projectId: testProjectId, name: "TC08 Pipeline", configYaml: VALID_YAML, createdById: devopsUser.id },
    });
    pipelineId = p.id;
  });

  it("triggered_by matches the developer who launched", async () => {
    const launchRes = await request(app)
      .post(`/api/pipelines/${pipelineId}/runs`)
      .set("Authorization", `Bearer ${developerUser.token}`)
      .send({});

    const runId = launchRes.body.data.runId;
    const dbRow = await prisma.pipelineRun.findUnique({ where: { id: runId } });
    expect(dbRow!.triggeredById).toBe(developerUser.id);
  });
});

// ─────────────────────────────────────────────────────────────
// TC-CICD-09  Read-only user cannot launch runs (403)
// ─────────────────────────────────────────────────────────────
describe("TC-CICD-09", () => {
  let pipelineId: string;

  beforeAll(async () => {
    const p = await prisma.pipeline.create({
      data: { projectId: testProjectId, name: "TC09 Pipeline", configYaml: VALID_YAML, createdById: devopsUser.id },
    });
    pipelineId = p.id;
  });

  it("USER role cannot launch runs (403)", async () => {
    const res = await request(app)
      .post(`/api/pipelines/${pipelineId}/runs`)
      .set("Authorization", `Bearer ${regularUser.token}`)
      .send({});

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────
// TC-CICD-10  Non-existent pipeline launch returns 404
// ─────────────────────────────────────────────────────────────
describe("TC-CICD-10", () => {
  it("Non-existent pipeline returns 404", async () => {
    const res = await request(app)
      .post("/api/pipelines/00000000000000000000000/runs")
      .set("Authorization", `Bearer ${developerUser.token}`)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("PIPELINE_NOT_FOUND");
  });
});

// ─────────────────────────────────────────────────────────────
// TC-CICD-11  Run steps listed with statuses
// ─────────────────────────────────────────────────────────────
describe("TC-CICD-11", () => {
  let runId: string;

  beforeAll(async () => {
    const pipeline = await prisma.pipeline.create({
      data: { projectId: testProjectId, name: "TC11 Pipeline", configYaml: VALID_YAML, createdById: devopsUser.id },
    });
    const run = await prisma.pipelineRun.create({
      data: { pipelineId: pipeline.id, status: "SUCCESS", triggeredById: devopsUser.id },
    });
    runId = run.id;
    await prisma.runStep.createMany({
      data: [
        { runId: run.id, name: "build", status: "SUCCESS", sortOrder: 0 },
        { runId: run.id, name: "test", status: "SUCCESS", sortOrder: 1 },
      ],
    });
  });

  it("Steps listed with statuses", async () => {
    const res = await request(app)
      .get(`/api/runs/${runId}/steps`)
      .set("Authorization", `Bearer ${developerUser.token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(2);

    const names = res.body.data.map((s: any) => s.name);
    expect(names).toContain("build");
    expect(names).toContain("test");
    res.body.data.forEach((s: any) => expect(s.status).toBeDefined());
  });
});

// ─────────────────────────────────────────────────────────────
// TC-CICD-12  Step logs retrievable by step ID
// ─────────────────────────────────────────────────────────────
describe("TC-CICD-12", () => {
  let runId: string;
  let stepId: string;

  beforeAll(async () => {
    const pipeline = await prisma.pipeline.create({
      data: { projectId: testProjectId, name: "TC12 Pipeline", configYaml: VALID_YAML, createdById: devopsUser.id },
    });
    const run = await prisma.pipelineRun.create({
      data: { pipelineId: pipeline.id, status: "SUCCESS", triggeredById: devopsUser.id },
    });
    runId = run.id;
    const step = await prisma.runStep.create({
      data: { runId: run.id, name: "build", status: "SUCCESS", logOutput: "Build succeeded in 12.3s\nAll tests passed." },
    });
    stepId = step.id;
  });

  it("Step logs contain seeded text", async () => {
    const res = await request(app)
      .get(`/api/runs/${runId}/steps/${stepId}/logs`)
      .set("Authorization", `Bearer ${developerUser.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.logs).toContain("Build succeeded");
  });
});

// ─────────────────────────────────────────────────────────────
// TC-CICD-13  Cancel a RUNNING run — status becomes CANCELLED
// ─────────────────────────────────────────────────────────────
describe("TC-CICD-13", () => {
  let runId: string;

  beforeAll(async () => {
    const pipeline = await prisma.pipeline.create({
      data: { projectId: testProjectId, name: "TC13 Pipeline", configYaml: VALID_YAML, createdById: devopsUser.id },
    });
    const run = await prisma.pipelineRun.create({
      data: { pipelineId: pipeline.id, status: "RUNNING", triggeredById: devopsUser.id },
    });
    runId = run.id;
  });

  it("Cancel RUNNING run returns 200, DB status is CANCELLED", async () => {
    const res = await request(app)
      .post(`/api/runs/${runId}/cancel`)
      .set("Authorization", `Bearer ${developerUser.token}`);

    expect(res.status).toBe(200);

    const dbRow = await prisma.pipelineRun.findUnique({ where: { id: runId } });
    expect(dbRow!.status).toBe("CANCELLED");
  });
});

// ─────────────────────────────────────────────────────────────
// TC-CICD-14  Cancelling finished run returns 409
// ─────────────────────────────────────────────────────────────
describe("TC-CICD-14", () => {
  let runId: string;

  beforeAll(async () => {
    const pipeline = await prisma.pipeline.create({
      data: { projectId: testProjectId, name: "TC14 Pipeline", configYaml: VALID_YAML, createdById: devopsUser.id },
    });
    const run = await prisma.pipelineRun.create({
      data: { pipelineId: pipeline.id, status: "SUCCESS", triggeredById: devopsUser.id },
    });
    runId = run.id;
  });

  it("Cancelling finished run returns 409 RUN_ALREADY_FINISHED", async () => {
    const res = await request(app)
      .post(`/api/runs/${runId}/cancel`)
      .set("Authorization", `Bearer ${developerUser.token}`);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("RUN_ALREADY_FINISHED");
  });
});

// ─────────────────────────────────────────────────────────────
// TC-CICD-15  Run history sorted newest-first
// ─────────────────────────────────────────────────────────────
describe("TC-CICD-15", () => {
  let pipelineId: string;

  beforeAll(async () => {
    const pipeline = await prisma.pipeline.create({
      data: { projectId: testProjectId, name: "TC15 Pipeline", configYaml: VALID_YAML, createdById: devopsUser.id },
    });
    pipelineId = pipeline.id;

    // Create 3 runs with staggered timestamps
    for (let i = 0; i < 3; i++) {
      await prisma.pipelineRun.create({
        data: {
          pipelineId: pipeline.id,
          status: "SUCCESS",
          triggeredById: devopsUser.id,
          createdAt: new Date(Date.now() - (2 - i) * 60_000), // oldest first in DB
        },
      });
    }
  });

  it("Runs returned in descending created_at order", async () => {
    const res = await request(app)
      .get(`/api/pipelines/${pipelineId}/runs`)
      .set("Authorization", `Bearer ${developerUser.token}`);

    expect(res.status).toBe(200);
    const runs = res.body.data;
    expect(runs.length).toBe(3);
    for (let i = 0; i < runs.length - 1; i++) {
      expect(new Date(runs[i].created_at).getTime()).toBeGreaterThanOrEqual(
        new Date(runs[i + 1].created_at).getTime()
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────
// TC-CICD-16  Run history supports pagination
// ─────────────────────────────────────────────────────────────
describe("TC-CICD-16", () => {
  let pipelineId: string;

  beforeAll(async () => {
    const pipeline = await prisma.pipeline.create({
      data: { projectId: testProjectId, name: "TC16 Pipeline", configYaml: VALID_YAML, createdById: devopsUser.id },
    });
    pipelineId = pipeline.id;

    // Create 15 runs
    for (let i = 0; i < 15; i++) {
      await prisma.pipelineRun.create({
        data: {
          pipelineId: pipeline.id,
          status: "SUCCESS",
          triggeredById: devopsUser.id,
          createdAt: new Date(Date.now() - i * 60_000),
        },
      });
    }
  });

  it("Pages do not overlap and meta.total is correct", async () => {
    const page1 = await request(app)
      .get(`/api/pipelines/${pipelineId}/runs?page=1&limit=10`)
      .set("Authorization", `Bearer ${developerUser.token}`);
    const page2 = await request(app)
      .get(`/api/pipelines/${pipelineId}/runs?page=2&limit=10`)
      .set("Authorization", `Bearer ${developerUser.token}`);

    expect(page1.status).toBe(200);
    expect(page2.status).toBe(200);

    const ids1 = new Set(page1.body.data.map((r: any) => r.id));
    const ids2 = new Set(page2.body.data.map((r: any) => r.id));

    // No overlap
    for (const id of ids2) {
      expect(ids1.has(id)).toBe(false);
    }

    expect(page1.body.meta.total).toBeGreaterThanOrEqual(15);
  });
});

// ─────────────────────────────────────────────────────────────
// TC-CICD-17  docker_build stage type accepted as valid config
// ─────────────────────────────────────────────────────────────
describe("TC-CICD-17", () => {
  it("docker_build stage accepted — 201", async () => {
    const res = await request(app)
      .post(`/api/projects/${testProjectId}/pipelines`)
      .set("Authorization", `Bearer ${devopsUser.token}`)
      .send({ name: "TC17 Docker Pipeline", config_yaml: DOCKER_YAML });

    expect(res.status).toBe(201);
  });
});

// ─────────────────────────────────────────────────────────────
// TC-CICD-18  Pipeline update stores new config
// ─────────────────────────────────────────────────────────────
describe("TC-CICD-18", () => {
  let pipelineId: string;

  beforeAll(async () => {
    const p = await prisma.pipeline.create({
      data: { projectId: testProjectId, name: "TC18 Original", configYaml: VALID_YAML, createdById: devopsUser.id },
    });
    pipelineId = p.id;
  });

  it("PUT updates pipeline name and config", async () => {
    const res = await request(app)
      .put(`/api/pipelines/${pipelineId}`)
      .set("Authorization", `Bearer ${devopsUser.token}`)
      .send({ name: "TC18 Updated", config_yaml: DOCKER_YAML });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("TC18 Updated");
  });
});

// ─────────────────────────────────────────────────────────────
// TC-CICD-19  Pipeline deletion removes DB record
// ─────────────────────────────────────────────────────────────
describe("TC-CICD-19", () => {
  let pipelineId: string;

  beforeAll(async () => {
    const p = await prisma.pipeline.create({
      data: { projectId: testProjectId, name: "TC19 Deletable", configYaml: VALID_YAML, createdById: devopsUser.id },
    });
    pipelineId = p.id;
  });

  it("DELETE removes pipeline from DB", async () => {
    const res = await request(app)
      .delete(`/api/pipelines/${pipelineId}`)
      .set("Authorization", `Bearer ${devopsUser.token}`);

    expect(res.status).toBe(200);

    const dbRow = await prisma.pipeline.findUnique({ where: { id: pipelineId } });
    expect(dbRow).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// TC-CICD-20  Concurrent runs allowed for same pipeline
// ─────────────────────────────────────────────────────────────
describe("TC-CICD-20", () => {
  let pipelineId: string;

  beforeAll(async () => {
    const p = await prisma.pipeline.create({
      data: { projectId: testProjectId, name: "TC20 Concurrent", configYaml: VALID_YAML, createdById: devopsUser.id },
    });
    pipelineId = p.id;
  });

  it("Two concurrent launches return 202 with distinct runIds", async () => {
    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/api/pipelines/${pipelineId}/runs`)
        .set("Authorization", `Bearer ${developerUser.token}`)
        .send({}),
      request(app)
        .post(`/api/pipelines/${pipelineId}/runs`)
        .set("Authorization", `Bearer ${developerUser.token}`)
        .send({}),
    ]);

    expect(res1.status).toBe(202);
    expect(res2.status).toBe(202);
    expect(res1.body.data.runId).not.toBe(res2.body.data.runId);
  });
});

// ─────────────────────────────────────────────────────────────
// TC-CICD-21  Trigger metadata stored on run record
// ─────────────────────────────────────────────────────────────
describe("TC-CICD-21", () => {
  let pipelineId: string;

  beforeAll(async () => {
    const p = await prisma.pipeline.create({
      data: { projectId: testProjectId, name: "TC21 Meta", configYaml: VALID_YAML, createdById: devopsUser.id },
    });
    pipelineId = p.id;
  });

  it("Branch metadata persisted in DB run record", async () => {
    const res = await request(app)
      .post(`/api/pipelines/${pipelineId}/runs`)
      .set("Authorization", `Bearer ${developerUser.token}`)
      .send({ branch: "feature/cicd-tests", commitSha: "abc123" });

    expect(res.status).toBe(202);
    const runId = res.body.data.runId;

    const dbRow = await prisma.pipelineRun.findUnique({ where: { id: runId } });
    expect(dbRow!.branch).toBe("feature/cicd-tests");
  });
});

// ─────────────────────────────────────────────────────────────
// TC-CICD-22  All pipelines for a project are listed
// ─────────────────────────────────────────────────────────────
describe("TC-CICD-22", () => {
  beforeAll(async () => {
    await prisma.pipeline.createMany({
      data: [
        { projectId: testProjectId, name: "TC22 Pipeline A", configYaml: VALID_YAML, createdById: devopsUser.id },
        { projectId: testProjectId, name: "TC22 Pipeline B", configYaml: VALID_YAML, createdById: devopsUser.id },
      ],
    });
  });

  it("Both pipelines returned for the project", async () => {
    const res = await request(app)
      .get(`/api/projects/${testProjectId}/pipelines`)
      .set("Authorization", `Bearer ${developerUser.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
  });
});
