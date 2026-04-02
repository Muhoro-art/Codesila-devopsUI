// src/modules/devflow/conveyor/stages/review.stage.ts — Deploy stage (§3.3)
// Routes to the real DeploymentExecutor which SSHes into registered targets.

import type { StageResult } from "../conveyor.types";
import { executeDeployment } from "../deployment-executor";

/**
 * Deploy stage — pushes built artifacts to the target environment.
 *
 * If a DeploymentTarget is registered for the project+environment, the executor
 * connects via SSH and runs real Docker commands on the remote host.
 * Otherwise falls back to a clearly-labelled simulation.
 */
export async function runDeployStage(
  projectName: string,
  version: string,
  environment: string,
  opts?: { orgId?: string; projectId?: string },
): Promise<StageResult> {
  if (opts?.orgId && opts?.projectId) {
    return executeDeployment({
      orgId: opts.orgId,
      projectId: opts.projectId,
      projectName,
      version,
      environment,
    });
  }

  // Legacy call path (no orgId/projectId) — graceful fallback
  return executeDeployment({
    orgId: "",
    projectId: "",
    projectName,
    version,
    environment,
  });
}
