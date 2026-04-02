// src/modules/devflow/conveyor/stages/promptFactory.stage.ts — Prompt/config factory (§3.3)
// Creates configuration for pipeline execution based on project type.

import type { PipelineStage } from "../conveyor.types";

export interface PipelineConfig {
  stages: PipelineStage[];
  timeout: number;       // total pipeline timeout in ms
  retries: number;       // max retries for failed stages
}

/**
 * Generates a pipeline configuration based on project type and environment.
 */
export function createPipelineConfig(
  projectType: string,
  environment: string,
): PipelineConfig {
  const stages: PipelineStage[] = ["BUILD", "TEST", "DEPLOY"];

  // Production deployments get full pipeline; dev can skip tests
  if (environment === "DEV") {
    return { stages: ["BUILD", "DEPLOY"], timeout: 300_000, retries: 1 };
  }

  // Staging gets full pipeline with relaxed timeout
  if (environment === "STAGING") {
    return { stages, timeout: 600_000, retries: 2 };
  }

  // Production — full pipeline, strict
  return { stages, timeout: 900_000, retries: 3 };
}
