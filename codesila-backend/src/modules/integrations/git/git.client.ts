// src/modules/integrations/git/git.client.ts — GitHub API client (§3.4)

import logger from "../../../config/logger";
import type { GitRepository, GitCommit, GitBranch } from "./git.types";

const GITHUB_API = "https://api.github.com";

/**
 * GitHub REST API client for repository operations (§3.4).
 * Uses personal access token or OAuth token for authentication.
 */
export class GitClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "CodeSila-DevOps/1.0",
    };
  }

  /**
   * List repositories accessible to the authenticated user.
   */
  async listRepos(page = 1, perPage = 30): Promise<GitRepository[]> {
    const url = `${GITHUB_API}/user/repos?sort=updated&per_page=${perPage}&page=${page}`;
    const res = await fetch(url, { headers: this.headers() });

    if (!res.ok) {
      logger.error({ status: res.status }, "GitHub listRepos failed");
      throw new Error(`GitHub API error: ${res.status}`);
    }

    const data = await res.json() as any[];
    return data.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      defaultBranch: r.default_branch,
      private: r.private,
      htmlUrl: r.html_url,
      cloneUrl: r.clone_url,
      description: r.description,
      language: r.language,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * List branches for a repository.
   */
  async listBranches(owner: string, repo: string): Promise<GitBranch[]> {
    const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`;
    const res = await fetch(url, { headers: this.headers() });

    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);

    const data = await res.json() as any[];
    return data.map((b) => ({
      name: b.name,
      sha: b.commit.sha,
      protected: b.protected,
    }));
  }

  /**
   * Get recent commits for a branch.
   */
  async listCommits(
    owner: string,
    repo: string,
    branch: string,
    limit = 20,
  ): Promise<GitCommit[]> {
    const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?sha=${encodeURIComponent(branch)}&per_page=${limit}`;
    const res = await fetch(url, { headers: this.headers() });

    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);

    const data = await res.json() as any[];
    return data.map((c) => ({
      sha: c.sha,
      message: c.commit.message,
      author: c.commit.author.name,
      authorEmail: c.commit.author.email,
      date: c.commit.author.date,
      branch,
      filesChanged: 0,
      additions: 0,
      deletions: 0,
    }));
  }

  /**
   * Trigger a workflow dispatch event (GitHub Actions).
   */
  async triggerWorkflow(
    owner: string,
    repo: string,
    workflowId: string,
    ref: string,
  ): Promise<boolean> {
    const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`;
    const res = await fetch(url, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ ref }),
    });

    if (!res.ok) {
      logger.error({ status: res.status }, "GitHub triggerWorkflow failed");
      return false;
    }

    return true;
  }

  /**
   * Get workflow runs (CI build status).
   */
  async listWorkflowRuns(
    owner: string,
    repo: string,
    branch?: string,
    limit = 10,
  ): Promise<any[]> {
    let url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs?per_page=${limit}`;
    if (branch) url += `&branch=${encodeURIComponent(branch)}`;

    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);

    const data = await res.json() as any;
    return (data.workflow_runs ?? []).map((r: any) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      conclusion: r.conclusion,
      branch: r.head_branch,
      commitSha: r.head_sha,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      htmlUrl: r.html_url,
    }));
  }
}
