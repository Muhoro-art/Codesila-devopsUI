/**
 * Log & SSE Integration Tests — TC-LOG-01 and TC-LOG-02
 *
 * TC-LOG-01: Run logs are available through the log endpoint
 * TC-LOG-02: SSE stream delivers live log events
 *
 * Verifies step-log retrieval and real-time SSE streaming against
 * the real Express app with a live PostgreSQL database.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import http from "http";
import type { Express } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { authRateLimitStore, apiRateLimitStore } from "../middlewares/rateLimit";
import { seedRbacTables } from "../modules/admin/rbac/rbac.service";
import {
  executePipeline,
} from "../modules/devflow/conveyor/pipeline-executor";
import type {
  PipelineConfig,
  RunCallbacks,
} from "../modules/devflow/conveyor/pipeline-executor";
import type { DockerRunner } from "../modules/devflow/conveyor/docker-runner";

const prisma = new PrismaClient();

// ─── Test constants ──────────────────────────────────────────
const TEST_ORG_ID = "org_test_log_sse";
const PASS = "Str0ng!Pass@2026xZ";

const VALID_YAML = `
name: log-test-pipeline
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

/** Maps executor status strings → Prisma PipelineRunStatus enum values */
function dbStatus(s: string): string {
  if (s === "FAILED") return "FAILURE";
  if (s === "ERROR") return "FAILURE";
  return s;
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

  await prisma.organization.upsert({
    where: { id: TEST_ORG_ID },
    update: {},
    create: { id: TEST_ORG_ID, name: "Log SSE Test Org", slug: "log-sse-test-org" },
  });

  await seedRbacTables();

  const devops = await prisma.user.create({
    data: { email: "logsse-devops@codesila.test", passwordHash: hash, name: "LogSSE DevOps", role: "DEVOPS", orgId: TEST_ORG_ID, isActive: true },
  });
  const developer = await prisma.user.create({
    data: { email: "logsse-developer@codesila.test", passwordHash: hash, name: "LogSSE Developer", role: "DEVELOPER", orgId: TEST_ORG_ID, isActive: true },
  });

  devopsUser = { id: devops.id, token: signToken(devops.id, "DEVOPS", devops.email) };
  developerUser = { id: developer.id, token: signToken(developer.id, "DEVELOPER", developer.email) };

  const project = await prisma.project.create({
    data: { orgId: TEST_ORG_ID, name: "Log SSE Test Project", key: "LOGSSE_TST", ownerId: devops.id },
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
// TC-LOG-01  Run logs available through log endpoint
// ═════════════════════════════════════════════════════════════
describe("TC-LOG-01 — Run logs available through log endpoint", () => {
  let runId: string;
  let buildStepId: string;
  let testStepId: string;

  const BUILD_LOG = "Step 1/4: FROM node:18\nStep 2/4: COPY . .\nStep 3/4: RUN npm install\nStep 4/4: Build succeeded in 12.3s";
  const TEST_LOG = "Running test suite...\n✓ auth.spec (5 passed)\n✓ api.spec (12 passed)\nAll tests passed.";

  beforeAll(async () => {
    const pipeline = await prisma.pipeline.create({
      data: { projectId: testProjectId, name: "TC-LOG-01 Pipeline", configYaml: VALID_YAML, createdById: devopsUser.id },
    });
    const run = await prisma.pipelineRun.create({
      data: { pipelineId: pipeline.id, status: "SUCCESS", triggeredById: devopsUser.id, startedAt: new Date(), finishedAt: new Date() },
    });
    runId = run.id;

    const buildStep = await prisma.runStep.create({
      data: { runId: run.id, name: "build", status: "SUCCESS", sortOrder: 0, logOutput: BUILD_LOG, startedAt: new Date(), finishedAt: new Date() },
    });
    buildStepId = buildStep.id;

    const testStep = await prisma.runStep.create({
      data: { runId: run.id, name: "test", status: "SUCCESS", sortOrder: 1, logOutput: TEST_LOG, startedAt: new Date(), finishedAt: new Date() },
    });
    testStepId = testStep.id;
  });

  it("GET /api/runs/:runId/steps/:stepId/logs returns seeded build logs", async () => {
    const res = await request(app)
      .get(`/api/runs/${runId}/steps/${buildStepId}/logs`)
      .set("Authorization", `Bearer ${developerUser.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.logs).toContain("Build succeeded");
    expect(res.body.data.logs).toContain("Step 1/4");
    expect(res.body.data.name).toBe("build");
  });

  it("GET /api/runs/:runId/steps/:stepId/logs returns seeded test logs", async () => {
    const res = await request(app)
      .get(`/api/runs/${runId}/steps/${testStepId}/logs`)
      .set("Authorization", `Bearer ${developerUser.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.logs).toContain("All tests passed");
    expect(res.body.data.logs).toContain("auth.spec");
  });

  it("Log lines appear in chronological order (build step has 4 lines in order)", async () => {
    const res = await request(app)
      .get(`/api/runs/${runId}/steps/${buildStepId}/logs`)
      .set("Authorization", `Bearer ${developerUser.token}`);

    const logs = res.body.data.logs as string;
    const step1Pos = logs.indexOf("Step 1/4");
    const step2Pos = logs.indexOf("Step 2/4");
    const step3Pos = logs.indexOf("Step 3/4");
    const step4Pos = logs.indexOf("Step 4/4");

    expect(step1Pos).toBeLessThan(step2Pos);
    expect(step2Pos).toBeLessThan(step3Pos);
    expect(step3Pos).toBeLessThan(step4Pos);
  });

  it("Logs are populated via pipeline execution engine with DB callbacks", async () => {
    // Create a pipeline run and execute it with a mock runner that emits logs
    const pipeline = await prisma.pipeline.create({
      data: { projectId: testProjectId, name: "TC-LOG-01 Engine", configYaml: VALID_YAML, createdById: devopsUser.id },
    });
    const run = await prisma.pipelineRun.create({
      data: { pipelineId: pipeline.id, status: "QUEUED", triggeredById: devopsUser.id },
    });

    const mockRunner = {
      executeStep: async (_step: unknown, onLog?: (line: string) => void): Promise<number> => {
        await onLog?.("Starting build...");
        await onLog?.("Compiling TypeScript...");
        await onLog?.("Build complete.");
        return 0;
      },
      getExitCode: () => 0,
    } as unknown as DockerRunner;

    const callbacks = createDbCallbacks(run.id);
    const config: PipelineConfig = {
      name: "engine-log-test",
      stages: [{ name: "compile", image: "node:18", command: "tsc" }],
    };

    await executePipeline(config, mockRunner, callbacks);

    // Retrieve step and verify logs persisted
    const steps = await prisma.runStep.findMany({ where: { runId: run.id }, orderBy: { sortOrder: "asc" } });
    expect(steps.length).toBeGreaterThan(0);

    const firstStep = steps[0];
    expect(firstStep.logOutput).toContain("Starting build...");
    expect(firstStep.logOutput).toContain("Compiling TypeScript...");
    expect(firstStep.logOutput).toContain("Build complete.");

    // Now verify the API returns the same logs
    const res = await request(app)
      .get(`/api/runs/${run.id}/steps/${firstStep.id}/logs`)
      .set("Authorization", `Bearer ${developerUser.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.logs).toContain("Build complete.");
  });
});

// ═════════════════════════════════════════════════════════════
// TC-LOG-02  SSE stream delivers live log events
// ═════════════════════════════════════════════════════════════
describe("TC-LOG-02 — SSE stream delivers live log events", () => {
  it("SSE stream returns initial state + done event for a terminal run", async () => {
    // Create a completed run with step logs
    const pipeline = await prisma.pipeline.create({
      data: { projectId: testProjectId, name: "TC-LOG-02 SSE Terminal", configYaml: VALID_YAML, createdById: devopsUser.id },
    });
    const run = await prisma.pipelineRun.create({
      data: { pipelineId: pipeline.id, status: "SUCCESS", triggeredById: devopsUser.id },
    });
    await prisma.runStep.create({
      data: { runId: run.id, name: "build", status: "SUCCESS", sortOrder: 0, logOutput: "Line A\nLine B\n" },
    });

    // Use a real HTTP server to test SSE streaming
    const server = http.createServer(app as any);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    const events = await new Promise<string[]>((resolve, reject) => {
      const collectedEvents: string[] = [];
      const timeout = setTimeout(() => {
        resolve(collectedEvents);
      }, 5000);

      const req = http.get(
        `http://127.0.0.1:${port}/api/runs/${run.id}/logs/stream`,
        { headers: { Authorization: `Bearer ${developerUser.token}` } },
        (res) => {
          let buffer = "";
          res.on("data", (chunk: Buffer) => {
            buffer += chunk.toString();
            // Parse complete SSE events
            const parts = buffer.split("\n\n");
            buffer = parts.pop() ?? "";
            for (const part of parts) {
              const eventMatch = part.match(/^event: (.+)$/m);
              if (eventMatch) {
                collectedEvents.push(eventMatch[1]);
                if (eventMatch[1] === "done") {
                  clearTimeout(timeout);
                  resolve(collectedEvents);
                }
              }
            }
          });
          res.on("end", () => {
            clearTimeout(timeout);
            resolve(collectedEvents);
          });
          res.on("error", reject);
        },
      );
      req.on("error", reject);
    });

    server.close();

    // Verify SSE events
    expect(events).toContain("run_status");
    expect(events).toContain("step_status");
    expect(events).toContain("log");
    expect(events).toContain("done");
  }, 10_000);

  it("SSE stream delivers new log events for a running pipeline", async () => {
    // Create a RUNNING run
    const pipeline = await prisma.pipeline.create({
      data: { projectId: testProjectId, name: "TC-LOG-02 SSE Live", configYaml: VALID_YAML, createdById: devopsUser.id },
    });
    const run = await prisma.pipelineRun.create({
      data: { pipelineId: pipeline.id, status: "RUNNING", triggeredById: devopsUser.id, startedAt: new Date() },
    });
    const step = await prisma.runStep.create({
      data: { runId: run.id, name: "build", status: "RUNNING", sortOrder: 0, logOutput: "initial log\n" },
    });

    const server = http.createServer(app as any);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    // After 1.5s (before poll cycle), add new logs; after 3s mark done
    setTimeout(async () => {
      await prisma.runStep.update({
        where: { id: step.id },
        data: { logOutput: "initial log\nnew live log line\n" },
      });
    }, 1500);

    setTimeout(async () => {
      await prisma.runStep.update({
        where: { id: step.id },
        data: { status: "SUCCESS" },
      });
      await prisma.pipelineRun.update({
        where: { id: run.id },
        data: { status: "SUCCESS", finishedAt: new Date() },
      });
    }, 3000);

    const events = await new Promise<Array<{ event: string; data: string }>>((resolve, reject) => {
      const collected: Array<{ event: string; data: string }> = [];
      const timeout = setTimeout(() => resolve(collected), 8000);

      const req = http.get(
        `http://127.0.0.1:${port}/api/runs/${run.id}/logs/stream`,
        { headers: { Authorization: `Bearer ${developerUser.token}` } },
        (res) => {
          let buffer = "";
          res.on("data", (chunk: Buffer) => {
            buffer += chunk.toString();
            const parts = buffer.split("\n\n");
            buffer = parts.pop() ?? "";
            for (const part of parts) {
              const eventMatch = part.match(/^event: (.+)$/m);
              const dataMatch = part.match(/^data: (.+)$/m);
              if (eventMatch) {
                collected.push({
                  event: eventMatch[1],
                  data: dataMatch ? dataMatch[1] : "",
                });
                if (eventMatch[1] === "done") {
                  clearTimeout(timeout);
                  resolve(collected);
                }
              }
            }
          });
          res.on("end", () => {
            clearTimeout(timeout);
            resolve(collected);
          });
          res.on("error", reject);
        },
      );
      req.on("error", reject);
    });

    server.close();

    // Verify we received the initial run_status, then live log events, then done
    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toContain("run_status");
    expect(eventTypes).toContain("done");

    // Check that live log line was delivered
    const logEvents = events.filter((e) => e.event === "log");
    const logTexts = logEvents.map((e) => {
      try { return JSON.parse(e.data).line; } catch { return ""; }
    });
    expect(logTexts.some((t: string) => t.includes("new live log line"))).toBe(true);
  }, 15_000);
});
