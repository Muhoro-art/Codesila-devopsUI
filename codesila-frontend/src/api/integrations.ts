// Frontend API layer for GitHub integration, commits, builds, deployment targets

import { API_BASE, getAuthHeader, readJsonResponse } from "./client";

/* ─── Types ──────────────────────────────────────────────── */

export interface GitHubStatus {
  connected: boolean;
  installation: {
    id: string;
    githubLogin: string;
    avatarUrl: string | null;
    scope: string | null;
    createdAt: string;
    updatedAt: string;
    connectedBy: { id: string; email: string; name: string | null };
    _count: { repos: number };
  } | null;
}

export interface AvailableRepo {
  id: number;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  htmlUrl: string;
  description: string | null;
  language: string | null;
  pushedAt: string;
  linked: boolean;
}

export interface LinkedRepo {
  id: string;
  orgId: string;
  projectId: string;
  githubRepoId: number;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  htmlUrl: string;
  trackPushes: boolean;
  trackPRs: boolean;
  trackBuilds: boolean;
  createdAt: string;
  project: { id: string; name: string; key: string };
  _count: { commits: number; builds: number };
}

export interface GitCommit {
  id: string;
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  authorAvatar: string | null;
  branch: string;
  url: string;
  additions: number;
  deletions: number;
  filesChanged: number;
  timestamp: string;
  repo: { fullName: string; htmlUrl: string; project: { id: string; name: string; key: string } };
}

export interface CIBuild {
  id: string;
  runId: number;
  workflowName: string | null;
  branch: string;
  commitSha: string;
  status: "PENDING" | "IN_PROGRESS" | "SUCCESS" | "FAILURE" | "CANCELLED";
  conclusion: string | null;
  htmlUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationSecs: number | null;
  triggeredBy: string | null;
  errorMessage: string | null;
  createdAt: string;
  repo: { fullName: string; htmlUrl: string };
  project: { id: string; name: string; key: string };
}

export interface DeploymentTarget {
  id: string;
  projectId: string;
  environment: string;
  provider: string;
  name: string;
  url: string | null;
  region: string | null;
  configJson: string | null;
  lastDeployAt: string | null;
  lastStatus: string | null;
  createdAt: string;
  project: { id: string; name: string; key: string };
}

/* ─── GitHub OAuth ───────────────────────────────────────── */

export async function getGitHubConnectUrl(): Promise<{ url: string }> {
  const headers = getAuthHeader();
  if (!headers) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/integrations/github/connect`, { headers });
  const data = await readJsonResponse<{ url?: string; error?: string }>(res);
  if (!res.ok || data.error) {
    throw new Error(data.error || `Server error: ${res.status}`);
  }
  if (!data.url) throw new Error("No URL returned from server");
  return { url: data.url };
}

export async function getGitHubStatus(): Promise<GitHubStatus> {
  const headers = getAuthHeader();
  if (!headers) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/integrations/github/status`, { headers });
  return readJsonResponse(res);
}

export async function disconnectGitHub(): Promise<void> {
  const headers = getAuthHeader();
  if (!headers) throw new Error("Not authenticated");
  await fetch(`${API_BASE}/integrations/github/disconnect`, {
    method: "DELETE",
    headers,
  });
}

/* ─── Repos ──────────────────────────────────────────────── */

export async function getAvailableRepos(): Promise<AvailableRepo[]> {
  const headers = getAuthHeader();
  if (!headers) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/integrations/github/repos/available`, { headers });
  return readJsonResponse(res);
}

export async function linkRepo(data: {
  projectId: string;
  githubRepoId: number;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  htmlUrl: string;
}): Promise<LinkedRepo> {
  const headers = getAuthHeader();
  if (!headers) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/integrations/github/repos/link`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return readJsonResponse(res);
}

export async function getLinkedRepos(projectId?: string): Promise<LinkedRepo[]> {
  const headers = getAuthHeader();
  if (!headers) throw new Error("Not authenticated");
  const qs = projectId ? `?projectId=${projectId}` : "";
  const res = await fetch(`${API_BASE}/integrations/github/repos${qs}`, { headers });
  return readJsonResponse(res);
}

export async function unlinkRepo(repoId: string): Promise<void> {
  const headers = getAuthHeader();
  if (!headers) throw new Error("Not authenticated");
  await fetch(`${API_BASE}/integrations/github/repos/${repoId}`, {
    method: "DELETE",
    headers,
  });
}

export async function syncRepo(repoId: string): Promise<{ commitsImported: number; buildsImported: number; webhookFixed: boolean }> {
  const headers = getAuthHeader();
  if (!headers) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/integrations/github/repos/${repoId}/sync`, {
    method: "POST",
    headers,
  });
  return readJsonResponse(res);
}

/* ─── Commits ────────────────────────────────────────────── */

export async function getCommits(params: { projectId?: string; repoId?: string; branch?: string; limit?: number } = {}): Promise<GitCommit[]> {
  const headers = getAuthHeader();
  if (!headers) throw new Error("Not authenticated");
  const qs = new URLSearchParams();
  if (params.projectId) qs.set("projectId", params.projectId);
  if (params.repoId) qs.set("repoId", params.repoId);
  if (params.branch) qs.set("branch", params.branch);
  if (params.limit) qs.set("limit", String(params.limit));
  const res = await fetch(`${API_BASE}/integrations/commits?${qs.toString()}`, { headers });
  return readJsonResponse(res);
}

/* ─── Builds ─────────────────────────────────────────────── */

export async function getBuilds(params: { projectId?: string; repoId?: string; status?: string; limit?: number } = {}): Promise<CIBuild[]> {
  const headers = getAuthHeader();
  if (!headers) throw new Error("Not authenticated");
  const qs = new URLSearchParams();
  if (params.projectId) qs.set("projectId", params.projectId);
  if (params.repoId) qs.set("repoId", params.repoId);
  if (params.status) qs.set("status", params.status);
  if (params.limit) qs.set("limit", String(params.limit));
  const res = await fetch(`${API_BASE}/integrations/builds?${qs.toString()}`, { headers });
  return readJsonResponse(res);
}

/* ─── Deployment Targets ─────────────────────────────────── */

export async function getDeploymentTargets(projectId?: string): Promise<DeploymentTarget[]> {
  const headers = getAuthHeader();
  if (!headers) throw new Error("Not authenticated");
  const qs = projectId ? `?projectId=${projectId}` : "";
  const res = await fetch(`${API_BASE}/integrations/targets${qs}`, { headers });
  return readJsonResponse(res);
}

export async function createDeploymentTarget(data: {
  projectId: string;
  environment: string;
  provider?: string;
  name: string;
  url?: string;
  region?: string;
  configJson?: string;
}): Promise<DeploymentTarget> {
  const headers = getAuthHeader();
  if (!headers) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/integrations/targets`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return readJsonResponse(res);
}

export async function updateDeploymentTarget(targetId: string, data: Partial<{
  name: string;
  url: string;
  region: string;
  provider: string;
  configJson: string;
  lastDeployAt: string;
  lastStatus: string;
}>): Promise<DeploymentTarget> {
  const headers = getAuthHeader();
  if (!headers) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/integrations/targets/${targetId}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return readJsonResponse(res);
}

export async function deleteDeploymentTarget(targetId: string): Promise<void> {
  const headers = getAuthHeader();
  if (!headers) throw new Error("Not authenticated");
  await fetch(`${API_BASE}/integrations/targets/${targetId}`, {
    method: "DELETE",
    headers,
  });
}
