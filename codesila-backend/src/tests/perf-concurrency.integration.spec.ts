/**
 * Performance & Concurrency Integration Tests — TC-PERF-01 and TC-PERF-02
 *
 * TC-PERF-01: API P95 latency stays below threshold under nominal load
 * TC-PERF-02: Concurrent pipeline submissions do not corrupt state
 *
 * Runs against the real Express app with a live PostgreSQL database.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { authRateLimitStore, apiRateLimitStore } from "../middlewares/rateLimit";
import { seedRbacTables } from "../modules/admin/rbac/rbac.service";

const prisma = new PrismaClient();

// ─── Test constants ──────────────────────────────────────────
const TEST_ORG_ID = "org_test_perf_concurrency";
const PASS = "Str0ng!Pass@2026xZ";

const VALID_YAML = `
name: perf-test-pipeline
trigger: push
stages:
  - name: build
    type: shell
    command: npm run build
  - name: test
    type: shell
    command: npm test
`;

let app: Express;
let jwtSecret: string;

let devopsUser: { id: string; token: string };
let developerUser: { id: string; token: string };

let testProjectId: string;

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
  await apiRateLimitStore.resetAll();
});

beforeAll(async () => {
  const mod = await import("../app");
  app = mod.buildApp();

  const { env } = await import("../config/env");
  jwtSecret = env.JWT_SECRET;

  const hash = await bcrypt.hash(PASS, 10);

  await prisma.organization.upsert({
    where: { id: TEST_ORG_ID },
    update: {},
    create: { id: TEST_ORG_ID, name: "Perf Concurrency Test Org", slug: "perf-conc-test-org" },
  });

  await seedRbacTables();

  const devops = await prisma.user.create({
    data: { email: "perf-devops@codesila.test", passwordHash: hash, name: "Perf DevOps", role: "DEVOPS", orgId: TEST_ORG_ID, isActive: true },
  });
  const developer = await prisma.user.create({
    data: { email: "perf-developer@codesila.test", passwordHash: hash, name: "Perf Developer", role: "DEVELOPER", orgId: TEST_ORG_ID, isActive: true },
  });

  devopsUser = { id: devops.id, token: signToken(devops.id, "DEVOPS", devops.email) };
  developerUser = { id: developer.id, token: signToken(developer.id, "DEVELOPER", developer.email) };

  const project = await prisma.project.create({
    data: { orgId: TEST_ORG_ID, name: "Perf Concurrency Test Project", key: "PERF_TST", ownerId: devops.id },
  });
  testProjectId = project.id;
}, 30_000);

afterAll(async () => {
  await prisma.runStep.deleteMany({ where: { run: { pipeline: { projectId: testProjectId } } } }).catch(() => {});
  await prisma.pipelineRun.deleteMany({ where: { pipeline: { projectId: testProjectId } } }).catch(() => {});
  await prisma.pipeline.deleteMany({ where: { projectId: testProjectId } }).catch(() => {});
  await prisma.auditEvent.deleteMany({ where: { orgId: TEST_ORG_ID } }).catch(() => {});
  await prisma.userRole.deleteMany({ where: { userId: { in: [devopsUser.id, developerUser.id] } } }).catch(() => {});
  await prisma.projectMember.deleteMany({ where: { projectId: testProjectId } }).catch(() => {});
  await prisma.project.deleteMany({ where: { orgId: TEST_ORG_ID } }).catch(() => {});
  await prisma.user.deleteMany({ where: { orgId: TEST_ORG_ID } }).catch(() => {});
  await prisma.organization.delete({ where: { id: TEST_ORG_ID } }).catch(() => {});
  await prisma.$disconnect();
});

// ═════════════════════════════════════════════════════════════
// TC-PERF-01  API P95 latency below threshold under nominal load
// ═════════════════════════════════════════════════════════════
describe("TC-PERF-01 — API P95 latency below threshold under nominal load", () => {
  it("Health endpoint P95 latency < 100ms over 100 requests", async () => {
    const latencies: number[] = [];

    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      await request(app).get("/health");
      latencies.push(performance.now() - start);
    }

    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(latencies.length * 0.95)];

    expect(p95).toBeLessThan(100);
    // Also sanity check the median
    const p50 = latencies[Math.floor(latencies.length * 0.50)];
    expect(p50).toBeLessThan(50);
  });

  it("Authenticated API endpoint P95 latency < 300ms over 50 requests", async () => {
    // Create a pipeline for listing
    await prisma.pipeline.create({
      data: { projectId: testProjectId, name: "TC-PERF-01 Pipeline", configYaml: VALID_YAML, createdById: devopsUser.id },
    });

    const latencies: number[] = [];

    for (let i = 0; i < 50; i++) {
      await authRateLimitStore.resetAll();
      await apiRateLimitStore.resetAll();

      const start = performance.now();
      const res = await request(app)
        .get(`/api/projects/${testProjectId}/pipelines`)
        .set("Authorization", `Bearer ${developerUser.token}`);
      latencies.push(performance.now() - start);

      expect(res.status).toBe(200);
    }

    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(latencies.length * 0.95)];

    expect(p95).toBeLessThan(300);
  });

  it("Pipeline run retrieval P95 latency < 300ms over 30 requests", async () => {
    const pipeline = await prisma.pipeline.create({
      data: { projectId: testProjectId, name: "TC-PERF-01 Run Latency", configYaml: VALID_YAML, createdById: devopsUser.id },
    });
    const run = await prisma.pipelineRun.create({
      data: { pipelineId: pipeline.id, status: "SUCCESS", triggeredById: devopsUser.id },
    });

    const latencies: number[] = [];

    for (let i = 0; i < 30; i++) {
      await authRateLimitStore.resetAll();
      await apiRateLimitStore.resetAll();

      const start = performance.now();
      const res = await request(app)
        .get(`/api/runs/${run.id}`)
        .set("Authorization", `Bearer ${developerUser.token}`);
      latencies.push(performance.now() - start);

      expect(res.status).toBe(200);
    }

    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(latencies.length * 0.95)];

    expect(p95).toBeLessThan(300);
  });
});

// ═════════════════════════════════════════════════════════════
// TC-PERF-02  Concurrent pipeline submissions don't corrupt state
// ═════════════════════════════════════════════════════════════
describe("TC-PERF-02 — Concurrent pipeline submissions don't corrupt state", () => {
  let pipelineId: string;

  beforeAll(async () => {
    const pipeline = await prisma.pipeline.create({
      data: { projectId: testProjectId, name: "TC-PERF-02 Concurrent", configYaml: VALID_YAML, createdById: devopsUser.id },
    });
    pipelineId = pipeline.id;
  });

  it("10 concurrent pipeline run submissions each produce a unique, valid run", async () => {
    const N = 10;

    // Submit N runs concurrently
    const promises = Array.from({ length: N }, (_, i) =>
      request(app)
        .post(`/api/pipelines/${pipelineId}/runs`)
        .set("Authorization", `Bearer ${developerUser.token}`)
        .send({ branch: `branch-${i}` }),
    );

    const results = await Promise.all(promises);

    // All should succeed
    const successful = results.filter((r) => [200, 201, 202].includes(r.status));
    expect(successful.length).toBe(N);

    // Each should have a unique runId
    const runIds = successful.map((r) => r.body.data.runId);
    const uniqueIds = new Set(runIds);
    expect(uniqueIds.size).toBe(N);

    // Verify each run in the database
    for (const runId of runIds) {
      const dbRun = await prisma.pipelineRun.findUnique({ where: { id: runId } });
      expect(dbRun).not.toBeNull();
      expect(dbRun!.status).toBe("QUEUED");
      expect(dbRun!.pipelineId).toBe(pipelineId);
    }
  });

  it("Concurrent runs don't share or overwrite each other's data", async () => {
    const N = 5;

    const promises = Array.from({ length: N }, (_, i) =>
      request(app)
        .post(`/api/pipelines/${pipelineId}/runs`)
        .set("Authorization", `Bearer ${developerUser.token}`)
        .send({ branch: `iso-branch-${i}`, commitSha: `sha${i}` }),
    );

    const results = await Promise.all(promises);
    const runIds = results.map((r) => r.body.data.runId);

    // Fetch all runs and verify isolation
    const runs = await prisma.pipelineRun.findMany({
      where: { id: { in: runIds } },
    });

    expect(runs.length).toBe(N);

    // Each run should have its own distinct branch
    const branches = runs.map((r) => r.branch).sort();
    const uniqueBranches = new Set(branches);
    expect(uniqueBranches.size).toBe(N);

    // Each run should have the correct commit SHA
    for (let i = 0; i < N; i++) {
      const run = runs.find((r) => r.branch === `iso-branch-${i}`);
      expect(run).toBeDefined();
      expect(run!.commitSha).toBe(`sha${i}`);
    }
  });

  it("Concurrent submissions + retrievals don't interfere", async () => {
    const N = 8;

    // First create N runs
    const createPromises = Array.from({ length: N }, (_, i) =>
      request(app)
        .post(`/api/pipelines/${pipelineId}/runs`)
        .set("Authorization", `Bearer ${developerUser.token}`)
        .send({ branch: `mixed-${i}` }),
    );
    const createResults = await Promise.all(createPromises);
    const runIds = createResults.map((r) => r.body.data.runId);

    // Now retrieve all N runs concurrently
    const readPromises = runIds.map((runId) =>
      request(app)
        .get(`/api/runs/${runId}`)
        .set("Authorization", `Bearer ${developerUser.token}`),
    );
    const readResults = await Promise.all(readPromises);

    // All reads should succeed
    for (const res of readResults) {
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("QUEUED");
      expect(res.body.data.pipeline_id).toBe(pipelineId);
    }

    // Each read should return the correct run
    const readIds = readResults.map((r) => r.body.data.id);
    expect(new Set(readIds).size).toBe(N);
  });
});
