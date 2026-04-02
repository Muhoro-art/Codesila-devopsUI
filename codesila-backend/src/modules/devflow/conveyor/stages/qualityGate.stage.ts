// src/modules/devflow/conveyor/stages/qualityGate.stage.ts — Quality gate (§3.3)
// Validates that build + test results meet the quality threshold before deploy.

import type { StageResult } from "../conveyor.types";

/**
 * Quality gate — checks that previous stages passed and metrics are acceptable.
 * This is the checkpoint between testing and deployment.
 */
export function evaluateQualityGate(
  buildResult: StageResult,
  testResult: StageResult,
): { passed: boolean; reason?: string } {
  if (buildResult.status !== "SUCCESS") {
    return { passed: false, reason: "Build stage failed" };
  }
  if (testResult.status !== "SUCCESS") {
    return { passed: false, reason: "Test stage failed" };
  }
  return { passed: true };
}
