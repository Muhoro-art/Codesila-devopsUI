/**
 * Pipeline & Run Integration Tests — TC-PIPE-01 through TC-PIPE-03,
 * TC-RUN-01 through TC-RUN-06
 *
 * Verify pipeline YAML validation, run lifecycle, execution engine,
 * retry semantics, and cancellation against the real Express app
 * with a live PostgreSQL database.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { authRateLimitStore, apiRateLimitStore } from "../middlewares/rateLimit";
import { seedRbacTables } from "../modules/admin/rbac/rbac.service";
import {
  executePipeline,
  retryPipelineExecution,
} from "../modules/devflow/conveyor/pipeline-executor";
import type {
  PipelineConfig,
  RunCallbacks,
} from "../modules/devflow/conveyor/pipeline-executor";
import type { DockerRunner } from "../modules/devflow/conveyor/docker-runner";

const prisma = new PrismaClient();

// ─── Test constants ──────────────────────────────────────────
const TEST_ORG_ID = "org_test_pipe_run";
const PASS = "Str0ng!Pass@2026xZ";

const VALID_YAML = `
name: build-and-test
trigger: push
stages:
  - name: build
    type: shell
    command: npm run build
  - name: test
    type: shell
    command: npm test
`;

const MALFORMED_YAML = "name: test\n  stages:\n- invalid: {{{}}}yaml: ::\n";

const NO_STAGES_YAML = `
name: incomplete
trigger: push
description: Missing stages array
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

// ─── Mock factories ──────────────────────────────────────────

/** Maps executor status strings → Prisma PipelineRunStatus enum values */
function dbStatus(s: string): string {
  if (s === "FAILED") return "FAILURE";
  if (s === "ERROR") return "FAILURE";
  return s;
}

/** Creates a mock DockerRunner that returns the given exit codes per step. */
function createMockRunner(exitCodes: number[]): DockerRunner {
  let callIndex = 0;
  return {
    executeStep: async (
      _step: unknown,
      onLog?: (line: string) => void,
    ): Promise<number> => {
      onLog?.(`[mock] Executing stage ${callIndex}`);
      const code = exitCodes[callIndex] ?? 0;
      callIndex++;
      return code;
    },
    getExitCode: () => 0,
  } as unknown as DockerRunner;
}

/**
 * Mock runner that throws for the first `failCalls` invocations,
 * then returns exit code 0 — simulates transient infra failures.
 */
function createTransientFailRunner(failCalls: number): DockerRunner {
  let calls = 0;
  return {
    executeStep: async (): Promise<number> => {
      calls++;
      if (calls <= failCalls) {
        throw new Error("Transient Docker connection error");
      }
      return 0;
    },
    getExitCode: () => 0,
  } as unknown as DockerRunner;
}

/** In-memory mock callbacks that track all status transitions. */
function createMockCallbacks(): {
  runStatuses: string[];
  steps: Map<string, { name: string; status: string }>;
  callbacks: RunCallbacks;
} {
  const runStatuses: string[] = [];
  const steps = new Map<string, { name: string; status: string }>();
  let stepCounter = 0;

  return {
    runStatuses,
    steps,
    callbacks: {
      updateRunStatus: async (status: string) => {
        runStatuses.push(status);
      },
      createStepRecord: async (name: string, _sortOrder: number) => {
        const id = `mock-step-${stepCounter++}`;
        steps.set(id, { name, status: "QUEUED" });
        return id;
      },
      updateStepStatus: async (stepId: string, status: string) => {
        const step = steps.get(stepId);
        if (step) step.status = status;
      },
      appendLog: async () => {},
    },
  };
}

/** Creates RunCallbacks that persist to the real database. */
function createDbCallbacks(runId: string): RunCallbacks {
  return {
    updateRunStatus: async (status: string) => {
      const data: Record<string, unknown> = { status: dbStatus(status) };
      if (status === "RUNNING") data.startedAt = new Date();
      if (["SUCCESS", "FAILED", "ERROR", "FAILURE", "CANCELLED"].includes(status)) {
        data.finishedAt = new Date();
      }
      await prisma.pipelineRun.update({ where: { id: runId }, data: data as any });
    },
    createStepRecord: async (name: string, sortOrder: number) => {
      const step = await prisma.runStep.create({
        data: { runId, name, sortOrder, status: "QUEUED" },
      });
      return step.id;
    },
    updateStepStatus: async (stepId: string, status: string) => {
      await prisma.runStep.update({
        where: { id: stepId },
        data: { status: dbStatus(status) as any },
      });
    },
    appendLog: async (stepId: string, line: string) => {
      const step = await prisma.runStep.findUnique({ where: { id: stepId } });
      await prisma.runStep.update({
        where: { id: stepId },
        data: { logOutput: (step?.logOutput ?? "") + line + "\n" },
      });
    },
  };
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

  // ── Isolated test organisation ─────────────────────────────
  await prisma.organization.upsert({
    where: { id: TEST_ORG_ID },
    update: {},
    create: { id: TEST_ORG_ID, name: "Pipeline Test Org", slug: "pipe-test-org" },
  });

  // ── Seed RBAC tables ───────────────────────────────────────
  await seedRbacTables();

  // ── Test users ─────────────────────────────────────────────
  const devops = await prisma.user.create({
    data: {
      email: "pipe-devops@codesila.test", passwordHash: hash,
      name: "Pipe DevOps", role: "DEVOPS", orgId: TEST_ORG_ID, isActive: true,
    },
  });
  const developer = await prisma.user.create({
    data: {
      email: "pipe-developer@codesila.test", passwordHash: hash,
      name: "Pipe Developer", role: "DEVELOPER", orgId: TEST_ORG_ID, isActive: true,
    },
  });

  devopsUser    = { id: devops.id,    token: signToken(devops.id,    "DEVOPS",    devops.email) };
  developerUser = { id: developer.id, token: signToken(developer.id, "DEVELOPER", developer.email) };

  // ── Test project ───────────────────────────────────────────
  const project = await prisma.project.create({
    data: { orgId: TEST_ORG_ID, name: "Pipeline Test Project", key: "PIPE_TST", ownerId: devops.id },
  });
  testProjectId = project.id;
}, 30_000);

afterAll(async () => {
  // Dependency-safe teardown (innermost FKs first)
  await prisma.runStep.deleteMany({
    where: { run: { pipeline: { projectId: testProjectId } } },
  }).catch(() => {});
  await prisma.pipelineRun.deleteMany({
    where: { pipeline: { projectId: testProjectId } },
  }).catch(() => {});
  await prisma.pipeline.deleteMany({ where: { projectId: testProjectId } }).catch(() => {});
  await prisma.auditEvent.deleteMany({ where: { orgId: TEST_ORG_ID } }).catch(() => {});
  await prisma.userRole.deleteMany({
    where: { userId: { in: [devopsUser.id, developerUser.id] } },
  }).catch(() => {});
  await prisma.projectMember.deleteMany({ where: { projectId: testProjectId } }).catch(() => {});
  await prisma.projectEnvironment.deleteMany({ where: { projectId: testProjectId } }).catch(() => {});
  await prisma.project.deleteMany({ where: { orgId: TEST_ORG_ID } }).catch(() => {});
  await prisma.user.deleteMany({ where: { orgId: TEST_ORG_ID } }).catch(() => {});
  await prisma.organization.delete({ where: { id: TEST_ORG_ID } }).catch(() => {});
  await prisma.$disconnect();
});

// ═════════════════════════════════════════════════════════════
// TC-PIPE-01  Valid pipeline YAML is accepted
// ═════════════════════════════════════════════════════════════
describe("TC-PIPE-01 — Valid pipeline YAML is accepted", () => {
  it("POST valid YAML returns 201 with pipeline id", async () => {
    const res = await request(app)
      .post(`/api/projects/${testProjectId}/pipelines`)
      .set("Authorization", `Bearer ${devopsUser.token}`)
      .send({ name: "TC-PIPE-01 Pipeline", config_yaml: VALID_YAML });

    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.id).toBeDefined();
    expect(typeof res.body.data.id).toBe("string");
    expect(res.body.data.name).toBe("TC-PIPE-01 Pipeline");
    expect(res.body.data.project_id).toBe(testProjectId);
  });
});

// ═════════════════════════════════════════════════════════════
// TC-PIPE-02  Invalid pipeline YAML is rejected
// ═════════════════════════════════════════════════════════════
describe("TC-PIPE-02 — Invalid pipeline YAML is rejected", () => {
  it("POST malformed YAML returns 400, no pipeline persisted", async () => {
    const countBefore = await prisma.pipeline.count({ where: { projectId: testProjectId } });

    const res = await request(app)
      .post(`/api/projects/${testProjectId}/pipelines`)
      .set("Authorization", `Bearer ${devopsUser.token}`)
      .send({ name: "TC-PIPE-02 Bad YAML", config_yaml: MALFORMED_YAML });

    expect(res.status).toBe(400);

    const countAfter = await prisma.pipeline.count({ where: { projectId: testProjectId } });
    expect(countAfter).toBe(countBefore);
  });
});

// ═════════════════════════════════════════════════════════════
// TC-PIPE-03  Unsupported pipeline schema is rejected
// ═════════════════════════════════════════════════════════════
describe("TC-PIPE-03 — Unsupported pipeline schema is rejected", () => {
  it("POST YAML without stages returns 400 with schema validation error", async () => {
    const res = await request(app)
      .post(`/api/projects/${testProjectId}/pipelines`)
      .set("Authorization", `Bearer ${devopsUser.token}`)
      .send({ name: "TC-PIPE-03 No Stages", config_yaml: NO_STAGES_YAML });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_PIPELINE_CONFIG");
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details.some((d: any) => d.field === "stages")).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════
// TC-RUN-01  Pipeline run enters QUEUED state after submission
// ═════════════════════════════════════════════════════════════
describe("TC-RUN-01 — Pipeline run enters QUEUED state after submission", () => {
  let pipelineId: string;

  beforeAll(async () => {
    const p = await prisma.pipeline.create({
      data: {
        projectId: testProjectId, name: "TC-RUN-01 Pipeline",
        configYaml: VALID_YAML, createdById: devopsUser.id,
      },
    });
    pipelineId = p.id;
  });

  it("POST creates run, GET confirms QUEUED status", async () => {
    const submitRes = await request(app)
      .post(`/api/pipelines/${pipelineId}/runs`)
      .set("Authorization", `Bearer ${developerUser.token}`)
      .send({ branch: "main" });

    expect([200, 201, 202]).toContain(submitRes.status);
    const runId = submitRes.body.data.runId;
    expect(runId).toBeDefined();

    const getRes = await request(app)
      .get(`/api/runs/${runId}`)
      .set("Authorization", `Bearer ${developerUser.token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.status).toBe("QUEUED");
  });
});

// ═════════════════════════════════════════════════════════════
// TC-RUN-02  Worker transitions run from QUEUED to RUNNING
// ═════════════════════════════════════════════════════════════
describe("TC-RUN-02 — Worker transitions run from QUEUED to RUNNING", () => {
  let pipelineId: string;
  let runId: string;

  beforeAll(async () => {
    const p = await prisma.pipeline.create({
      data: {
        projectId: testProjectId, name: "TC-RUN-02 Pipeline",
        configYaml: VALID_YAML, createdById: devopsUser.id,
      },
    });
    pipelineId = p.id;

    const run = await prisma.pipelineRun.create({
      data: { pipelineId: p.id, status: "QUEUED", triggeredById: devopsUser.id },
    });
    runId = run.id;
  });

  it("status changes from QUEUED to RUNNING within timeout", async () => {
    // Verify initial QUEUED state
    const before = await prisma.pipelineRun.findUnique({ where: { id: runId } });
    expect(before!.status).toBe("QUEUED");

    // Gate keeps mock step "running" so we can observe the RUNNING state
    let releaseGate!: () => void;
    const gate = new Promise<void>((r) => { releaseGate = r; });

    const runner = {
      executeStep: async () => { await gate; return 0; },
    } as unknown as DockerRunner;

    const callbacks = createDbCallbacks(runId);

    // Start execution (non-blocking)
    const execPromise = executePipeline(
      { name: "tc-run-02", stages: [{ name: "build", image: "node:18", command: "echo ok" }] },
      runner,
      callbacks,
    );

    // Wait for updateRunStatus("RUNNING") to persist
    await new Promise((r) => setTimeout(r, 300));

    // Poll the API — should see RUNNING
    const res = await request(app)
      .get(`/api/runs/${runId}`)
      .set("Authorization", `Bearer ${devopsUser.token}`);

    expect(res.body.data.status).toBe("RUNNING");

    // Release gate so execution completes
    releaseGate();
    await execPromise;
  });
});

// ═════════════════════════════════════════════════════════════
// TC-RUN-03  Successful pipeline execution ends with SUCCESS
// ═════════════════════════════════════════════════════════════
describe("TC-RUN-03 — Successful pipeline execution ends with SUCCESS", () => {
  let runId: string;

  beforeAll(async () => {
    const p = await prisma.pipeline.create({
      data: {
        projectId: testProjectId, name: "TC-RUN-03 Pipeline",
        configYaml: VALID_YAML, createdById: devopsUser.id,
      },
    });

    const run = await prisma.pipelineRun.create({
      data: { pipelineId: p.id, status: "QUEUED", triggeredById: devopsUser.id },
    });
    runId = run.id;
  });

  it("all steps succeed — run final state is SUCCESS", async () => {
    const runner = createMockRunner([0, 0]); // 2 stages, both succeed
    const callbacks = createDbCallbacks(runId);

    await executePipeline(
      {
        name: "tc-run-03",
        stages: [
          { name: "build", image: "node:18", command: "npm run build" },
          { name: "test",  image: "node:18", command: "npm test" },
        ],
      },
      runner,
      callbacks,
    );

    // Verify run status via DB
    const run = await prisma.pipelineRun.findUnique({ where: { id: runId } });
    expect(run!.status).toBe("SUCCESS");

    // Verify all steps succeeded
    const steps = await prisma.runStep.findMany({
      where: { runId },
      orderBy: { sortOrder: "asc" },
    });
    expect(steps.length).toBe(2);
    for (const step of steps) {
      expect(step.status).toBe("SUCCESS");
    }

    // Verify via API
    const res = await request(app)
      .get(`/api/runs/${runId}`)
      .set("Authorization", `Bearer ${devopsUser.token}`);
    expect(res.body.data.status).toBe("SUCCESS");
  });
});

// ═════════════════════════════════════════════════════════════
// TC-RUN-04  Failing step without allow_failure marks run FAILED
// ═════════════════════════════════════════════════════════════
describe("TC-RUN-04 — Failing step without allow_failure marks run FAILED", () => {
  let runId: string;

  beforeAll(async () => {
    const p = await prisma.pipeline.create({
      data: {
        projectId: testProjectId, name: "TC-RUN-04 Pipeline",
        configYaml: VALID_YAML, createdById: devopsUser.id,
      },
    });

    const run = await prisma.pipelineRun.create({
      data: { pipelineId: p.id, status: "QUEUED", triggeredById: devopsUser.id },
    });
    runId = run.id;
  });

  it("mandatory step fails — run is FAILURE, at least one step is FAILURE", async () => {
    // Stage 0 succeeds (exit 0), stage 1 fails (exit 1), stage 2 never reached
    const runner = createMockRunner([0, 1, 0]);
    const callbacks = createDbCallbacks(runId);

    await executePipeline(
      {
        name: "tc-run-04",
        stages: [
          { name: "build",  image: "node:18", command: "npm run build" },
          { name: "test",   image: "node:18", command: "npm test" },       // fails
          { name: "deploy", image: "node:18", command: "npm run deploy" }, // not reached
        ],
      },
      runner,
      callbacks,
    );

    // Verify run final state (executor "FAILED" → DB "FAILURE")
    const run = await prisma.pipelineRun.findUnique({ where: { id: runId } });
    expect(run!.status).toBe("FAILURE");

    // Verify at least one step is FAILURE
    const steps = await prisma.runStep.findMany({ where: { runId } });
    const failedSteps = steps.filter((s) => s.status === "FAILURE");
    expect(failedSteps.length).toBeGreaterThanOrEqual(1);
    expect(failedSteps.some((s) => s.name === "test")).toBe(true);

    // Deploy step should NOT have been created (stop-on-fail)
    expect(steps.length).toBe(2);
  });
});

// ═════════════════════════════════════════════════════════════
// TC-RUN-05  Retry policy applies on transient execution failure
// ═════════════════════════════════════════════════════════════
describe("TC-RUN-05 — Retry policy applies on transient execution failure", () => {
  it("system retries up to configured limit, retryCount > 0", async () => {
    const maxRetries = 3;
    const transientFailCount = 2; // Fail first 2 attempts, succeed on 3rd

    const runner = createTransientFailRunner(transientFailCount);
    const mocks = createMockCallbacks();

    const { retryCount } = await retryPipelineExecution(
      {
        name: "tc-run-05",
        stages: [{ name: "build", image: "node:18", command: "echo ok" }],
      },
      runner,
      mocks.callbacks,
      { maxRetries, backoffMs: 10 },
    );

    // Pass criteria: retry_count > 0 AND retry_count <= configured_limit
    expect(retryCount).toBeGreaterThan(0);
    expect(retryCount).toBeLessThanOrEqual(maxRetries);
    expect(retryCount).toBe(transientFailCount);

    // The last attempt should have succeeded
    expect(mocks.runStatuses[mocks.runStatuses.length - 1]).toBe("SUCCESS");
  });

  it("exhausted retries re-throw the error", async () => {
    const runner = createTransientFailRunner(100); // always throws
    const mocks = createMockCallbacks();

    await expect(
      retryPipelineExecution(
        {
          name: "tc-run-05-exhaust",
          stages: [{ name: "build", image: "node:18", command: "echo fail" }],
        },
        runner,
        mocks.callbacks,
        { maxRetries: 2, backoffMs: 10 },
      ),
    ).rejects.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════
// TC-RUN-06  Running pipeline can be cancelled
// ═════════════════════════════════════════════════════════════
describe("TC-RUN-06 — Running pipeline can be cancelled", () => {
  let runId: string;

  beforeAll(async () => {
    const p = await prisma.pipeline.create({
      data: {
        projectId: testProjectId, name: "TC-RUN-06 Pipeline",
        configYaml: VALID_YAML, createdById: devopsUser.id,
      },
    });

    // Simulate an actively running pipeline
    const run = await prisma.pipelineRun.create({
      data: {
        pipelineId: p.id, status: "RUNNING",
        triggeredById: devopsUser.id, startedAt: new Date(),
      },
    });
    runId = run.id;
  });

  it("POST cancel returns [200|202|204], final status CANCELLED", async () => {
    const cancelRes = await request(app)
      .post(`/api/runs/${runId}/cancel`)
      .set("Authorization", `Bearer ${devopsUser.token}`);

    expect([200, 202, 204]).toContain(cancelRes.status);

    // Verify via API
    const getRes = await request(app)
      .get(`/api/runs/${runId}`)
      .set("Authorization", `Bearer ${devopsUser.token}`);

    expect(getRes.body.data.status).toBe("CANCELLED");
  });
});
