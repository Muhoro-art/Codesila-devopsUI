// src/infra/queue/workers/codegen.worker.ts — CI/CD pipeline worker
// Processes pipeline execution requests from the job queue.

import { triggerPipeline } from "../../../modules/devflow/conveyor/conveyor.service";
import logger from "../../../config/logger";

export interface PipelineJobPayload {
  orgId: string;
  userId: string;
  projectId: string;
  serviceId: string;
  environment: string;
  branch: string;
  version: string;
  commitSha?: string;
}

/**
 * Worker handler for async pipeline execution.
 */
export async function pipelineWorker(payload: PipelineJobPayload): Promise<void> {
  logger.info({ projectId: payload.projectId, version: payload.version }, "Pipeline worker started");

  const result = await triggerPipeline(payload.orgId, payload.userId, {
    projectId: payload.projectId,
    serviceId: payload.serviceId,
    environment: payload.environment,
    branch: payload.branch,
    version: payload.version,
    commitSha: payload.commitSha,
  });

  logger.info(
    { pipelineId: result.id, status: result.status },
    "Pipeline worker completed",
  );
}
