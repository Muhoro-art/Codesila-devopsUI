// src/modules/devflow/conveyor/conveyor.service.ts — CI/CD Pipeline orchestrator (§2.5.2, §3.3)

import { randomUUID } from "crypto";
import { prisma } from "../../../infra/db";
import { runBuildStage } from "./stages/codeGen.stage";
import { runTestStage } from "./stages/testSynthesis.stage";
import { runDeployStage } from "./stages/review.stage";
import { evaluateQualityGate } from "./stages/qualityGate.stage";
import { validateArchitecture } from "./stages/architecture.stage";
import { createPipelineConfig } from "./stages/promptFactory.stage";
import type { PipelineRun, StageResult, TriggerPipelineInput } from "./conveyor.types";
import logger from "../../../config/logger";

// In-memory store for pipeline runs (would be Redis-backed in production)
const pipelineRuns = new Map<string, PipelineRun>();

/**
 * Trigger a new CI/CD pipeline run (§3.3 — build → test → deploy).
 */
export async function triggerPipeline(
  orgId: string,
  userId: string,
  input: TriggerPipelineInput,
): Promise<PipelineRun> {
  // 1. Validate project exists and has required config
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, orgId },
    include: { services: true },
  });

  if (!project) throw new Error("Project not found");

  const archCheck = validateArchitecture(project);
  if (!archCheck.valid) {
    throw new Error(
      `Architecture check failed: ${archCheck.checks
        .filter((c) => !c.passed)
        .map((c) => c.message)
        .join("; ")}`,
    );
  }

  // 2. Verify service exists
  const service = await prisma.service.findFirst({
    where: { id: input.serviceId, projectId: input.projectId },
  });
  if (!service) throw new Error("Service not found");

  // 3. Create pipeline run
  const config = createPipelineConfig(project.type, input.environment);
  const run: PipelineRun = {
    id: randomUUID(),
    projectId: input.projectId,
    serviceId: input.serviceId,
    environment: input.environment,
    branch: input.branch,
    commitSha: input.commitSha,
    version: input.version,
    triggeredBy: userId,
    status: "RUNNING",
    stages: [],
    startedAt: new Date(),
    createdAt: new Date(),
  };

  pipelineRuns.set(run.id, run);
  logger.info({ pipelineId: run.id, project: project.name }, "Pipeline started");

  // 4. Execute stages sequentially (§3.3 — build/test/deploy sequence)
  try {
    // BUILD stage
    const buildResult = await runBuildStage(project.name, input.branch, input.version);
    run.stages.push(buildResult);

    if (buildResult.status !== "SUCCESS") {
      run.status = "FAILURE";
      run.finishedAt = new Date();
      await recordDeployment(orgId, input, userId, "FAILED");
      return run;
    }

    // TEST stage (skip for DEV environment per pipeline config)
    let testResult: StageResult | null = null;
    if (config.stages.includes("TEST")) {
      testResult = await runTestStage(project.name, input.version);
      run.stages.push(testResult);

      // Quality gate check before deploy
      const gate = evaluateQualityGate(buildResult, testResult);
      if (!gate.passed) {
        run.status = "FAILURE";
        run.finishedAt = new Date();
        await recordDeployment(orgId, input, userId, "FAILED");
        return run;
      }
    }

    // DEPLOY stage — pass orgId + projectId so executor can resolve the real target
    const deployResult = await runDeployStage(project.name, input.version, input.environment, {
      orgId,
      projectId: input.projectId,
    });
    run.stages.push(deployResult);

    if (deployResult.status !== "SUCCESS") {
      run.status = "FAILURE";
      await recordDeployment(orgId, input, userId, "FAILED");
    } else {
      run.status = "SUCCESS";
      await recordDeployment(orgId, input, userId, "SUCCESS");
    }
  } catch (err: any) {
    run.status = "FAILURE";
    logger.error({ err, pipelineId: run.id }, "Pipeline execution error");
  }

  run.finishedAt = new Date();
  return run;
}

/**
 * Record the deployment outcome in the database.
 */
async function recordDeployment(
  orgId: string,
  input: TriggerPipelineInput,
  userId: string,
  status: "SUCCESS" | "FAILED",
) {
  try {
    await prisma.deployment.create({
      data: {
        orgId,
        projectId: input.projectId,
        serviceId: input.serviceId,
        environment: input.environment as any,
        version: input.version,
        status,
        createdById: userId,
        triggeredById: userId,
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });
  } catch (err) {
    logger.error({ err }, "Failed to record deployment");
  }
}

/**
 * Get a pipeline run by ID.
 */
export function getPipelineRun(id: string): PipelineRun | undefined {
  return pipelineRuns.get(id);
}

/**
 * List recent pipeline runs for a project.
 */
export function listPipelineRuns(projectId: string): PipelineRun[] {
  return Array.from(pipelineRuns.values())
    .filter((r) => r.projectId === projectId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 50);
}
