// src/modules/integrations/git/git.types.ts — Git integration types (§3.4)

export interface GitRepository {
  id: number;
  fullName: string;       // "owner/repo"
  defaultBranch: string;
  private: boolean;
  htmlUrl: string;
  cloneUrl: string;
  description?: string;
  language?: string;
  updatedAt: string;
}

export interface GitCommit {
  sha: string;
  message: string;
  author: string;
  authorEmail: string;
  date: string;
  branch: string;
  filesChanged: number;
  additions: number;
  deletions: number;
}

export interface GitBranch {
  name: string;
  sha: string;
  protected: boolean;
}

export interface GitPullRequest {
  id: number;
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  author: string;
  sourceBranch: string;
  targetBranch: string;
  createdAt: string;
  updatedAt: string;
}
