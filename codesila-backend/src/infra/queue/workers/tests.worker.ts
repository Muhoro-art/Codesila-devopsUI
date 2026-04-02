// src/infra/queue/workers/tests.worker.ts — Test execution worker
// Runs test suites as part of CI/CD pipeline.

import { runTestStage } from "../../../modules/devflow/conveyor/stages/testSynthesis.stage";
import logger from "../../../config/logger";

export interface TestJobPayload {
  projectName: string;
  version: string;
}

/**
 * Worker handler for isolated test execution.
 */
export async function testWorker(payload: TestJobPayload): Promise<void> {
  logger.info({ project: payload.projectName, version: payload.version }, "Test worker started");

  const result = await runTestStage(payload.projectName, payload.version);

  logger.info(
    { status: result.status, logs: result.logs.length },
    "Test worker completed",
  );
}
