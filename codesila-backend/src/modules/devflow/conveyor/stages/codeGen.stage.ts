// src/modules/devflow/conveyor/stages/codeGen.stage.ts — Build stage (§3.3)
// Simulates the build/compilation step of a CI/CD pipeline.

import type { StageResult } from "../conveyor.types";

/**
 * Build stage — compiles source code and produces artifacts.
 * In a production system this would invoke Docker build or a build runner.
 * Here we simulate the process with realistic timing and logging.
 */
export async function runBuildStage(
  projectName: string,
  branch: string,
  version: string,
): Promise<StageResult> {
  const startedAt = new Date();
  const logs: string[] = [];

  logs.push(`[BUILD] Starting build for ${projectName}@${branch} v${version}`);
  logs.push("[BUILD] Pulling latest source from repository...");

  // Simulate build time (100-500ms)
  await delay(100 + Math.random() * 400);
  logs.push("[BUILD] Installing dependencies...");

  await delay(50 + Math.random() * 200);
  logs.push("[BUILD] Compiling TypeScript...");

  await delay(50 + Math.random() * 150);
  logs.push("[BUILD] Running linters...");

  // Simulate occasional build failure (5% chance)
  if (Math.random() < 0.05) {
    const finishedAt = new Date();
    logs.push("[BUILD] FAILURE — compilation errors detected");
    return {
      stage: "BUILD",
      status: "FAILURE",
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      logs,
      error: "Compilation failed: type errors found in src/index.ts",
    };
  }

  await delay(50 + Math.random() * 100);
  logs.push("[BUILD] Building Docker image...");

  await delay(100 + Math.random() * 200);
  const finishedAt = new Date();
  logs.push(`[BUILD] Image built: codesila/${projectName}:${version}`);
  logs.push("[BUILD] Build completed successfully");

  return {
    stage: "BUILD",
    status: "SUCCESS",
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    logs,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
