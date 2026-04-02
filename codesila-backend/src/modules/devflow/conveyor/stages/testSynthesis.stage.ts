// src/modules/devflow/conveyor/stages/testSynthesis.stage.ts — Test stage (§3.3)
// Simulates the automated testing step of a CI/CD pipeline.

import type { StageResult } from "../conveyor.types";

/**
 * Test stage — runs unit tests, integration tests, and code coverage.
 * In production this would execute test runners inside containers.
 */
export async function runTestStage(
  projectName: string,
  version: string,
): Promise<StageResult> {
  const startedAt = new Date();
  const logs: string[] = [];

  logs.push(`[TEST] Running test suite for ${projectName} v${version}`);
  logs.push("[TEST] Executing unit tests...");

  await delay(100 + Math.random() * 300);
  const unitTests = 42 + Math.floor(Math.random() * 30);
  logs.push(`[TEST] Unit tests: ${unitTests} passed`);

  logs.push("[TEST] Executing integration tests...");
  await delay(100 + Math.random() * 300);
  const integrationTests = 12 + Math.floor(Math.random() * 10);
  logs.push(`[TEST] Integration tests: ${integrationTests} passed`);

  logs.push("[TEST] Calculating code coverage...");
  await delay(50 + Math.random() * 100);
  const coverage = 70 + Math.random() * 25;

  // Fail if coverage below 70% threshold (§4.3 non-functional requirement)
  if (coverage < 70) {
    const finishedAt = new Date();
    logs.push(`[TEST] FAILURE — coverage ${coverage.toFixed(1)}% below 70% threshold`);
    return {
      stage: "TEST",
      status: "FAILURE",
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      logs,
      error: `Code coverage ${coverage.toFixed(1)}% below minimum 70%`,
    };
  }

  // Simulate occasional test failure (3% chance)
  if (Math.random() < 0.03) {
    const finishedAt = new Date();
    logs.push("[TEST] FAILURE — 2 tests failed");
    return {
      stage: "TEST",
      status: "FAILURE",
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      logs,
      error: "2 test cases failed in auth.spec.ts",
    };
  }

  const finishedAt = new Date();
  logs.push(`[TEST] Coverage: ${coverage.toFixed(1)}% ✓`);
  logs.push(`[TEST] All ${unitTests + integrationTests} tests passed`);

  return {
    stage: "TEST",
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
