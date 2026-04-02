// src/modules/integrations/cicd/runner.client.ts — CI runner client (§3.3)
// Dispatches CI/CD runs via GitHub Actions or other providers.

import { GitClient } from "../git/git.client";
import logger from "../../../config/logger";

/**
 * CI Runner — triggers GitHub Actions workflows (§3.3).
 */
export class CIRunnerClient {
  private git: GitClient;

  constructor(githubToken: string) {
    this.git = new GitClient(githubToken);
  }

  /**
   * Trigger a CI workflow for a repository.
   */
  async triggerBuild(
    owner: string,
    repo: string,
    workflowFile: string,
    branch: string,
  ): Promise<boolean> {
    logger.info({ owner, repo, workflowFile, branch }, "Triggering CI build");
    return this.git.triggerWorkflow(owner, repo, workflowFile, branch);
  }

  /**
   * Get recent build runs for a repository.
   */
  async getBuilds(owner: string, repo: string, branch?: string) {
    return this.git.listWorkflowRuns(owner, repo, branch, 20);
  }
}
