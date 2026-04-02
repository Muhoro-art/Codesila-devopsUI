// src/modules/devflow/conveyor/pipeline-executor.ts
// Pipeline execution engine — orchestrates step execution (§3.3, FR-04/FR-05)

import type { DockerRunner, StepConfig } from "./docker-runner";

export interface PipelineConfig {
  name: string;
  stages: StageConfig[];
}

export interface StageConfig {
  name: string;
  image: string;
  command: string;
  allowFailure?: boolean;
  env?: Record<string, string>;
  timeout?: number;
}

export interface RunCallbacks {
  updateRunStatus: (status: string) => Promise<void> | void;
  createStepRecord: (name: string, sortOrder: number) => Promise<string> | string;
  updateStepStatus: (stepId: string, status: string) => Promise<void> | void;
  appendLog: (stepId: string, line: string) => Promise<void> | void;
}

/**
 * Execute a full pipeline: iterate stages, run each in Docker,
 * stream logs, and update statuses via callbacks.
 */
export async function executePipeline(
  config: PipelineConfig,
  runner: DockerRunner,
  callbacks: RunCallbacks,
): Promise<void> {
  await callbacks.updateRunStatus("RUNNING");

  let failed = false;

  for (let i = 0; i < config.stages.length; i++) {
    const stage = config.stages[i];

    const stepId = await callbacks.createStepRecord(stage.name, i);
    await callbacks.updateStepStatus(stepId, "RUNNING");

    try {
      const exitCode = await runner.executeStep(
        {
          image: stage.image,
          command: stage.command,
          env: stage.env,
          timeout: stage.timeout,
          allowFailure: stage.allowFailure,
        },
        (line) => callbacks.appendLog(stepId, line),
      );

      if (exitCode === 0) {
        await callbacks.updateStepStatus(stepId, "SUCCESS");
      } else {
        await callbacks.updateStepStatus(stepId, "FAILED");
        if (!stage.allowFailure) {
          failed = true;
          break; // Stop pipeline on non-allowed failure
        }
      }
    } catch (err) {
      await callbacks.updateStepStatus(stepId, "ERROR");
      await callbacks.updateRunStatus("ERROR");
      throw err; // Re-raise for retry
    }
  }

  await callbacks.updateRunStatus(failed ? "FAILED" : "SUCCESS");
}

// ─── Retry wrapper (§3.3, NFR-REL-01) ──────────────────────

export interface RetryPolicy {
  maxRetries: number;
  backoffMs?: number;
}

/**
 * Wrap executePipeline with retry logic for transient infra errors.
 * Returns the number of retries that occurred before success.
 */
export async function retryPipelineExecution(
  config: PipelineConfig,
  runner: DockerRunner,
  callbacks: RunCallbacks,
  policy: RetryPolicy,
): Promise<{ retryCount: number }> {
  let retryCount = 0;

  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    try {
      await executePipeline(config, runner, callbacks);
      return { retryCount };
    } catch (err) {
      if (attempt < policy.maxRetries) {
        retryCount++;
        if (policy.backoffMs) {
          await new Promise((r) => setTimeout(r, policy.backoffMs!));
        }
      } else {
        throw err;
      }
    }
  }

  return { retryCount };
}
