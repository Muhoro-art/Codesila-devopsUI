/**
 * Webhook & Docker Execution Integration Tests
 *   TC-GIT-01  Valid Git integration credentials allow repository retrieval
 *   TC-GIT-02  Invalid Git token is rejected
 *   TC-GIT-03  Incoming webhook triggers pipeline execution
 *   TC-DKR-01  Step executes in isolated Docker container
 *   TC-DKR-02  Container stdout/stderr captured into logs
 *   TC-DKR-03  Execution container removed after completion
 *
 * Uses real external APIs where required (skipIf when creds are absent).
 * Docker tests use mock injection — no real Docker needed.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";
import type { Express } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { authRateLimitStore, apiRateLimitStore } from "../middlewares/rateLimit";
import { seedRbacTables } from "../modules/admin/rbac/rbac.service";
import { encrypt } from "../shared/security/encryption";
import {
  executePipeline,
} from "../modules/devflow/conveyor/pipeline-executor";
import type {
  PipelineConfig,
  RunCallbacks,
} from "../modules/devflow/conveyor/pipeline-executor";
import {
  DockerRunner,
} from "../modules/devflow/conveyor/docker-runner";
import type {
  DockerClient,
  DockerContainer_I,
} from "../modules/devflow/conveyor/docker-runner";

const prisma = new PrismaClient();

// ─── Real tokens from environment ────────────────────────────
const GITHUB_PAT = process.env.GITHUB_PAT || "";
const hasGitHub = !!GITHUB_PAT;

// ─── Test constants ──────────────────────────────────────────
const TEST_ORG_ID = "org_test_webhook_docker";
const PASS = "Str0ng!Pass@2026xZ";

const VALID_YAML = `
name: webhook-test-pipeline
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
    create: { id: TEST_ORG_ID, name: "Webhook Docker Test Org", slug: "wh-docker-test-org" },
  });

  await seedRbacTables();

  const devops = await prisma.user.create({
    data: { email: "whdock-devops@codesila.test", passwordHash: hash, name: "WHDock DevOps", role: "DEVOPS", orgId: TEST_ORG_ID, isActive: true },
  });
  const developer = await prisma.user.create({
    data: { email: "whdock-developer@codesila.test", passwordHash: hash, name: "WHDock Developer", role: "DEVELOPER", orgId: TEST_ORG_ID, isActive: true },
  });

  devopsUser = { id: devops.id, token: signToken(devops.id, "DEVOPS", devops.email) };
  developerUser = { id: developer.id, token: signToken(developer.id, "DEVELOPER", developer.email) };

  const project = await prisma.project.create({
    data: { orgId: TEST_ORG_ID, name: "Webhook Docker Test Project", key: "WHDOCK_TST", ownerId: devops.id },
  });
  testProjectId = project.id;
}, 30_000);

afterAll(async () => {
  // Clean up in FK-safe order
  await prisma.runStep.deleteMany({ where: { run: { pipeline: { projectId: testProjectId } } } }).catch(() => {});
  await prisma.pipelineRun.deleteMany({ where: { pipeline: { projectId: testProjectId } } }).catch(() => {});
  await prisma.pipeline.deleteMany({ where: { projectId: testProjectId } }).catch(() => {});
  await prisma.gitCommit.deleteMany({ where: { orgId: TEST_ORG_ID } }).catch(() => {});
  await prisma.gitHubRepo.deleteMany({ where: { orgId: TEST_ORG_ID } }).catch(() => {});
  await prisma.gitHubInstallation.deleteMany({ where: { orgId: TEST_ORG_ID } }).catch(() => {});
  await prisma.integration.deleteMany({ where: { orgId: TEST_ORG_ID } }).catch(() => {});
  await prisma.auditEvent.deleteMany({ where: { orgId: TEST_ORG_ID } }).catch(() => {});
  await prisma.userRole.deleteMany({ where: { userId: { in: [devopsUser.id, developerUser.id] } } }).catch(() => {});
  await prisma.projectMember.deleteMany({ where: { projectId: testProjectId } }).catch(() => {});
  await prisma.project.deleteMany({ where: { orgId: TEST_ORG_ID } }).catch(() => {});
  await prisma.user.deleteMany({ where: { orgId: TEST_ORG_ID } }).catch(() => {});
  await prisma.organization.delete({ where: { id: TEST_ORG_ID } }).catch(() => {});
  await prisma.$disconnect();
});

// ═════════════════════════════════════════════════════════════
// TC-GIT-01  Valid Git integration credentials allow repository retrieval
// ═════════════════════════════════════════════════════════════
describe.skipIf(!hasGitHub)("TC-GIT-01 — Valid Git credentials allow repository retrieval", () => {
  let integrationId: string;

  beforeAll(async () => {
    // Create integration with valid PAT (pre-encrypted in DB)
    const integ = await prisma.integration.create({
      data: { orgId: TEST_ORG_ID, type: "github", name: "TC-GIT-01 GitHub", credentialsEnc: encrypt(GITHUB_PAT), createdById: devopsUser.id },
    });
    integrationId = integ.id;
  });

  it("Integration is saved and active", async () => {
    const dbRow = await prisma.integration.findUnique({ where: { id: integrationId } });
    expect(dbRow).not.toBeNull();
    expect(dbRow!.isActive).toBe(true);
    expect(dbRow!.type).toBe("github");
  });

  it("Repository list has >= 1 repos in unified format", async () => {
    const res = await request(app)
      .get(`/api/integrations/${integrationId}/repositories`)
      .set("Authorization", `Bearer ${devopsUser.token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);

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
// TC-GIT-02  Invalid Git token is rejected
// ═════════════════════════════════════════════════════════════
describe("TC-GIT-02 — Invalid Git token is rejected", () => {
  it("GitHub integration with bad token returns 400 INVALID_TOKEN", async () => {
    const res = await request(app)
      .post("/api/integrations")
      .set("Authorization", `Bearer ${devopsUser.token}`)
      .send({ type: "github", token: "ghp_INVALID_TOKEN_12345678901234567890", name: "Bad Token" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_TOKEN");
  });

  it("Integration is NOT persisted in DB on invalid token", async () => {
    const bad = await prisma.integration.findFirst({
      where: { orgId: TEST_ORG_ID, name: "Bad Token" },
    });
    expect(bad).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════
// TC-GIT-03  Incoming webhook triggers pipeline execution
// ═════════════════════════════════════════════════════════════
describe("TC-GIT-03 — Incoming webhook triggers pipeline execution", () => {
  const WEBHOOK_SECRET = "test-webhook-secret-" + Date.now();
  let trackedRepoId: string;
  let pipelineId: string;

  beforeAll(async () => {
    // Create a pipeline for the project (webhook should trigger a run)
    const pipeline = await prisma.pipeline.create({
      data: { projectId: testProjectId, name: "TC-GIT-03 Auto Pipeline", configYaml: VALID_YAML, createdById: devopsUser.id },
    });
    pipelineId = pipeline.id;

    // Create a GitHubInstallation (required FK)
    const installation = await prisma.gitHubInstallation.upsert({
      where: { orgId: TEST_ORG_ID },
      update: {},
      create: {
        orgId: TEST_ORG_ID,
        installationId: 99999,
        accessToken: "fake-install-token",
        githubLogin: "test-org",
        connectedById: devopsUser.id,
      },
    });

    // Create a tracked GitHubRepo with webhook secret
    const repo = await prisma.gitHubRepo.create({
      data: {
        orgId: TEST_ORG_ID,
        projectId: testProjectId,
        installationId: installation.id,
        githubRepoId: 123456789,
        fullName: "test-org/test-repo",
        defaultBranch: "main",
        htmlUrl: "https://github.com/test-org/test-repo",
        webhookSecret: WEBHOOK_SECRET,
        trackPushes: true,
      },
    });
    trackedRepoId = repo.id;
  });

  it("Push webhook with valid signature creates commits and triggers pipeline run", async () => {
    const runCountBefore = await prisma.pipelineRun.count({ where: { pipelineId } });

    // Build a realistic GitHub push webhook payload
    const payload = {
      ref: "refs/heads/main",
      repository: { id: 123456789, full_name: "test-org/test-repo" },
      sender: { avatar_url: "https://avatars.githubusercontent.com/u/1?v=4" },
      commits: [
        {
          id: "abc123def456789012345678901234567890abcd",
          message: "feat: add new feature",
          author: { name: "Test User", email: "test@example.com" },
          url: "https://github.com/test-org/test-repo/commit/abc123",
          added: ["src/new.ts"],
          modified: [],
          removed: [],
          timestamp: new Date().toISOString(),
        },
        {
          id: "def456abc789012345678901234567890abcdef01",
          message: "fix: resolve bug",
          author: { name: "Test User", email: "test@example.com" },
          url: "https://github.com/test-org/test-repo/commit/def456",
          added: [],
          modified: ["src/fix.ts"],
          removed: [],
          timestamp: new Date().toISOString(),
        },
      ],
    };

    // Compute HMAC-SHA256 signature
    const payloadStr = JSON.stringify(payload);
    const signature = "sha256=" + crypto.createHmac("sha256", WEBHOOK_SECRET).update(payloadStr).digest("hex");

    const res = await request(app)
      .post("/integrations/github/webhook")
      .set("x-github-event", "push")
      .set("x-hub-signature-256", signature)
      .set("x-github-delivery", "test-delivery-" + Date.now())
      .set("Content-Type", "application/json")
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Webhook processed");

    // Verify commits were created in DB
    const commits = await prisma.gitCommit.findMany({
      where: { repoId: trackedRepoId },
      orderBy: { timestamp: "asc" },
    });
    expect(commits.length).toBeGreaterThanOrEqual(2);
    expect(commits.some((c) => c.message.includes("add new feature"))).toBe(true);
    expect(commits.some((c) => c.message.includes("resolve bug"))).toBe(true);

    // Verify a pipeline run was created (triggered by webhook)
    const runCountAfter = await prisma.pipelineRun.count({ where: { pipelineId } });
    expect(runCountAfter).toBe(runCountBefore + 1);

    const latestRun = await prisma.pipelineRun.findFirst({
      where: { pipelineId },
      orderBy: { createdAt: "desc" },
    });
    expect(latestRun).not.toBeNull();
    expect(latestRun!.status).toBe("QUEUED");
    expect(latestRun!.branch).toBe("main");
    expect(latestRun!.commitSha).toBeTruthy();
  });

  it("Webhook with invalid signature returns 401", async () => {
    const payload = {
      ref: "refs/heads/main",
      repository: { id: 123456789, full_name: "test-org/test-repo" },
      commits: [],
    };

    const res = await request(app)
      .post("/integrations/github/webhook")
      .set("x-github-event", "push")
      .set("x-hub-signature-256", "sha256=invalid_signature_000000000000000000000000000000000000000000000000000000000000")
      .set("x-github-delivery", "test-bad-sig-" + Date.now())
      .set("Content-Type", "application/json")
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body.error).toContain("Invalid signature");
  });

  it("Webhook with missing signature returns 401", async () => {
    const payload = {
      ref: "refs/heads/main",
      repository: { id: 123456789, full_name: "test-org/test-repo" },
      commits: [],
    };

    const res = await request(app)
      .post("/integrations/github/webhook")
      .set("x-github-event", "push")
      .set("x-github-delivery", "test-no-sig-" + Date.now())
      .set("Content-Type", "application/json")
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body.error).toContain("Missing webhook signature");
  });
});

// ═════════════════════════════════════════════════════════════
// TC-DKR-01  Step executes in isolated Docker container
// ═════════════════════════════════════════════════════════════
describe("TC-DKR-01 — Step executes in isolated Docker container", () => {
  it("Container.run is called with correct isolation settings", async () => {
    const runCalls: Array<{ image: string; opts: any }> = [];

    const mockContainer: DockerContainer_I = {
      logs: () => [],
      wait: async () => ({ StatusCode: 0 }),
      remove: async () => {},
    };

    const mockClient: DockerClient = {
      containers: {
        run: async (image: string, opts: any) => {
          runCalls.push({ image, opts });
          return mockContainer;
        },
      },
    };

    const runner = new DockerRunner(mockClient);
    const exitCode = await runner.executeStep({ image: "node:18-alpine", command: "npm test" });

    expect(exitCode).toBe(0);
    expect(runCalls.length).toBe(1);
    expect(runCalls[0].image).toBe("node:18-alpine");
    expect(runCalls[0].opts.command).toBe("npm test");

    // Verify isolation settings
    expect(runCalls[0].opts.mem_limit).toBe("512m");
    expect(runCalls[0].opts.cpu_quota).toBe(50000);
    expect(runCalls[0].opts.cap_drop).toEqual(["ALL"]);
    expect(runCalls[0].opts.detach).toBe(true);
  });

  it("Environment variables are passed to the container", async () => {
    const runCalls: Array<{ opts: any }> = [];

    const mockClient: DockerClient = {
      containers: {
        run: async (_image: string, opts: any) => {
          runCalls.push({ opts });
          return {
            logs: () => [],
            wait: async () => ({ StatusCode: 0 }),
            remove: async () => {},
          };
        },
      },
    };

    const runner = new DockerRunner(mockClient);
    await runner.executeStep({
      image: "node:18",
      command: "echo test",
      env: { NODE_ENV: "test", CI: "true" },
    });

    expect(runCalls[0].opts.env).toEqual({ NODE_ENV: "test", CI: "true" });
  });

  it("Non-zero exit code is returned correctly", async () => {
    const mockClient: DockerClient = {
      containers: {
        run: async () => ({
          logs: () => [],
          wait: async () => ({ StatusCode: 1 }),
          remove: async () => {},
        }),
      },
    };

    const runner = new DockerRunner(mockClient);
    const exitCode = await runner.executeStep({ image: "node:18", command: "exit 1" });
    expect(exitCode).toBe(1);
    expect(runner.getExitCode()).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════
// TC-DKR-02  Container stdout/stderr captured into logs
// ═════════════════════════════════════════════════════════════
describe("TC-DKR-02 — Container stdout/stderr captured into logs", () => {
  it("All log lines from container stdout are captured via onLog callback", async () => {
    const capturedLines: string[] = [];

    // Mock container that emits log lines as an async iterable
    const logLines = ["Building project...", "Compiling main.ts", "Warning: unused import", "Build succeeded"];

    const mockClient: DockerClient = {
      containers: {
        run: async () => ({
          logs: () => ({
            [Symbol.asyncIterator]: async function* () {
              for (const line of logLines) {
                yield line;
              }
            },
          }),
          wait: async () => ({ StatusCode: 0 }),
          remove: async () => {},
        }),
      },
    };

    const runner = new DockerRunner(mockClient);
    const exitCode = await runner.executeStep(
      { image: "node:18", command: "npm run build" },
      (line: string) => capturedLines.push(line),
    );

    expect(exitCode).toBe(0);
    expect(capturedLines).toEqual(logLines);
    expect(capturedLines.length).toBe(4);
    expect(capturedLines).toContain("Warning: unused import");
    expect(capturedLines).toContain("Build succeeded");
  });

  it("Stderr lines are also captured", async () => {
    const capturedLines: string[] = [];

    const logLines = ["stdout: Starting...", "stderr: Connection warning", "stdout: Done"];

    const mockClient: DockerClient = {
      containers: {
        run: async () => ({
          logs: () => ({
            [Symbol.asyncIterator]: async function* () {
              for (const line of logLines) {
                yield line;
              }
            },
          }),
          wait: async () => ({ StatusCode: 1 }),
          remove: async () => {},
        }),
      },
    };

    const runner = new DockerRunner(mockClient);
    const exitCode = await runner.executeStep(
      { image: "node:18", command: "npm test" },
      (line: string) => capturedLines.push(line),
    );

    expect(exitCode).toBe(1);
    // Both stdout and stderr should be captured
    expect(capturedLines).toContain("stderr: Connection warning");
    expect(capturedLines).toContain("stdout: Starting...");
    expect(capturedLines.length).toBe(3);
  });

  it("Logs integrate end-to-end with pipeline executor DB callbacks", async () => {
    // Create a real pipeline run + use executor with mock runner
    const pipeline = await prisma.pipeline.create({
      data: { projectId: testProjectId, name: "TC-DKR-02 E2E", configYaml: VALID_YAML, createdById: devopsUser.id },
    });
    const run = await prisma.pipelineRun.create({
      data: { pipelineId: pipeline.id, status: "QUEUED", triggeredById: devopsUser.id },
    });

    const mockRunner = {
      executeStep: async (_step: unknown, onLog?: (line: string) => void): Promise<number> => {
        await onLog?.("stdout: Downloading dependencies...");
        await onLog?.("stderr: npm warn deprecated package@1.0");
        await onLog?.("stdout: All tests passed (42 tests).");
        return 0;
      },
      getExitCode: () => 0,
    } as unknown as DockerRunner;

    const callbacks: RunCallbacks = {
      updateRunStatus: async (status: string) => {
        const data: Record<string, unknown> = { status: dbStatus(status) };
        if (status === "RUNNING") data.startedAt = new Date();
        if (["SUCCESS", "FAILED", "ERROR", "FAILURE"].includes(status)) data.finishedAt = new Date();
        await prisma.pipelineRun.update({ where: { id: run.id }, data: data as any });
      },
      createStepRecord: async (name: string, sortOrder: number) => {
        const step = await prisma.runStep.create({ data: { runId: run.id, name, sortOrder, status: "QUEUED" } });
        return step.id;
      },
      updateStepStatus: async (stepId: string, status: string) => {
        await prisma.runStep.update({ where: { id: stepId }, data: { status: dbStatus(status) as any } });
      },
      appendLog: async (stepId: string, line: string) => {
        const step = await prisma.runStep.findUnique({ where: { id: stepId } });
        await prisma.runStep.update({
          where: { id: stepId },
          data: { logOutput: (step?.logOutput ?? "") + line + "\n" },
        });
      },
    };

    const config: PipelineConfig = {
      name: "dkr-02-e2e",
      stages: [{ name: "test-step", image: "node:18", command: "npm test" }],
    };

    await executePipeline(config, mockRunner, callbacks);

    // Verify logs persisted in DB
    const steps = await prisma.runStep.findMany({ where: { runId: run.id } });
    expect(steps.length).toBe(1);
    expect(steps[0].logOutput).toContain("Downloading dependencies");
    expect(steps[0].logOutput).toContain("npm warn deprecated");
    expect(steps[0].logOutput).toContain("All tests passed");

    // Verify run status
    const dbRun = await prisma.pipelineRun.findUnique({ where: { id: run.id } });
    expect(dbRun!.status).toBe("SUCCESS");
  });
});

// ═════════════════════════════════════════════════════════════
// TC-DKR-03  Execution container removed after completion
// ═════════════════════════════════════════════════════════════
describe("TC-DKR-03 — Execution container removed after completion", () => {
  it("container.remove() is called after successful execution", async () => {
    let removeCalled = false;

    const mockClient: DockerClient = {
      containers: {
        run: async () => ({
          logs: () => [],
          wait: async () => ({ StatusCode: 0 }),
          remove: async () => { removeCalled = true; },
        }),
      },
    };

    const runner = new DockerRunner(mockClient);
    await runner.executeStep({ image: "node:18", command: "echo done" });

    expect(removeCalled).toBe(true);
  });

  it("container.remove() is called even after non-zero exit code", async () => {
    let removeCalled = false;

    const mockClient: DockerClient = {
      containers: {
        run: async () => ({
          logs: () => [],
          wait: async () => ({ StatusCode: 1 }),
          remove: async () => { removeCalled = true; },
        }),
      },
    };

    const runner = new DockerRunner(mockClient);
    const exitCode = await runner.executeStep({ image: "node:18", command: "exit 1" });

    expect(exitCode).toBe(1);
    expect(removeCalled).toBe(true);
  });

  it("container.remove() is called even when logs throw an error", async () => {
    let removeCalled = false;

    const mockClient: DockerClient = {
      containers: {
        run: async () => ({
          logs: () => ({
            [Symbol.asyncIterator]: async function* () {
              throw new Error("Log stream broken");
            },
          }),
          wait: async () => ({ StatusCode: 0 }),
          remove: async () => { removeCalled = true; },
        }),
      },
    };

    const runner = new DockerRunner(mockClient);

    // executeStep should propagate or swallow the error, but remove must still be called
    try {
      await runner.executeStep({ image: "node:18", command: "echo test" });
    } catch {
      // error is acceptable
    }

    expect(removeCalled).toBe(true);
  });

  it("Multiple sequential steps each get their container removed", async () => {
    let removeCount = 0;

    const mockClient: DockerClient = {
      containers: {
        run: async () => ({
          logs: () => [],
          wait: async () => ({ StatusCode: 0 }),
          remove: async () => { removeCount++; },
        }),
      },
    };

    const runner = new DockerRunner(mockClient);

    await runner.executeStep({ image: "node:18", command: "step1" });
    await runner.executeStep({ image: "node:18", command: "step2" });
    await runner.executeStep({ image: "node:18", command: "step3" });

    expect(removeCount).toBe(3);
  });
});
