// src/api/integrationMgmt.ts — Generic Integration Management API client (§3.4)
import { API_BASE, getAuthHeader } from "./client";

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text();
    throw new Error(text || fallback);
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.code || data.error || fallback);
  return data as T;
}

/* ─── Types ─────────────────────────────────────────────── */

export interface IntegrationInfo {
  id: string;
  type: string;
  name: string;
  registryUrl?: string;
  username?: string;
  createdAt?: string;
}

export interface ProjectIntegrationBinding {
  id: string;
  projectId: string;
  integrationId: string;
  configJson: Record<string, unknown> | null;
  status: string;
  createdAt?: string;
  integration: IntegrationInfo;
}

export interface IntegrationRepo {
  name: string;
  fullName: string;
  cloneUrl: string;
  defaultBranch: string;
  isPrivate: boolean;
}

export interface BranchInfo {
  name: string;
  sha: string;
}

export interface CommitInfo {
  sha: string;
  shortSha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  authorAvatar: string;
  date: string;
  url: string;
}

/* ─── CRUD ──────────────────────────────────────────────── */

export async function listIntegrations(): Promise<IntegrationInfo[]> {
  const res = await fetch(`${API_BASE}/api/integrations`, {
    headers: { ...getAuthHeader() },
  });
  const body = await readJson<{ data: IntegrationInfo[] }>(res, "Failed to load integrations");
  return body.data;
}

export async function createIntegration(data: {
  type: "github" | "gitlab" | "docker_registry";
  name: string;
  token: string;
  registryUrl?: string;
  username?: string;
}): Promise<IntegrationInfo> {
  const res = await fetch(`${API_BASE}/api/integrations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeader() },
    body: JSON.stringify(data),
  });
  const body = await readJson<{ data: IntegrationInfo }>(res, "Failed to create integration");
  return body.data;
}

export async function deleteIntegration(integrationId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/integrations/${integrationId}`, {
    method: "DELETE",
    headers: { ...getAuthHeader() },
  });
  await readJson<{ ok: boolean }>(res, "Failed to delete integration");
}

/* ─── Repositories ──────────────────────────────────────── */

export async function listIntegrationRepos(integrationId: string): Promise<IntegrationRepo[]> {
  const res = await fetch(`${API_BASE}/api/integrations/${integrationId}/repositories`, {
    headers: { ...getAuthHeader() },
  });
  const body = await readJson<{ data: IntegrationRepo[] }>(res, "Failed to load repositories");
  return body.data;
}

export async function listBranches(integrationId: string, owner: string, repo: string): Promise<BranchInfo[]> {
  const res = await fetch(
    `${API_BASE}/api/integrations/${integrationId}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`,
    { headers: { ...getAuthHeader() } },
  );
  const body = await readJson<{ data: BranchInfo[] }>(res, "Failed to load branches");
  return body.data;
}

export async function createWebhook(integrationId: string, owner: string, repo: string, webhookUrl: string, events?: string[]): Promise<{ webhookId: string }> {
  const res = await fetch(
    `${API_BASE}/api/integrations/${integrationId}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/webhooks`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify({ webhookUrl, events }),
    },
  );
  const body = await readJson<{ data: { webhookId: string } }>(res, "Failed to create webhook");
  return body.data;
}

export async function listCommits(
  integrationId: string,
  owner: string,
  repo: string,
  options?: { branch?: string; limit?: number },
): Promise<CommitInfo[]> {
  const qs = new URLSearchParams();
  if (options?.branch) qs.set("branch", options.branch);
  if (options?.limit) qs.set("limit", String(options.limit));
  const res = await fetch(
    `${API_BASE}/api/integrations/${integrationId}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?${qs}`,
    { headers: { ...getAuthHeader() } },
  );
  const body = await readJson<{ data: CommitInfo[] }>(res, "Failed to load commits");
  return body.data;
}

export async function createRepoViaIntegration(
  integrationId: string,
  data: { name: string; description?: string; isPrivate?: boolean; defaultBranch?: string; autoInit?: boolean },
): Promise<IntegrationRepo & { htmlUrl: string; owner: string }> {
  const res = await fetch(`${API_BASE}/api/integrations/${integrationId}/repositories`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeader() },
    body: JSON.stringify(data),
  });
  const body = await readJson<{ data: IntegrationRepo & { htmlUrl: string; owner: string } }>(res, "Failed to create repository");
  return body.data;
}

/* ─── Project ↔ Integration Bindings ────────────────────── */

export async function listProjectIntegrations(projectId: string): Promise<ProjectIntegrationBinding[]> {
  const res = await fetch(`${API_BASE}/api/projects/${projectId}/integrations`, {
    headers: { ...getAuthHeader() },
  });
  const body = await readJson<{ data: ProjectIntegrationBinding[] }>(res, "Failed to load project integrations");
  return body.data;
}

export async function listAvailableIntegrations(projectId: string): Promise<IntegrationInfo[]> {
  const res = await fetch(`${API_BASE}/api/projects/${projectId}/integrations/available`, {
    headers: { ...getAuthHeader() },
  });
  const body = await readJson<{ data: IntegrationInfo[] }>(res, "Failed to load available integrations");
  return body.data;
}

export async function bindProjectIntegration(
  projectId: string,
  integrationId: string,
  configJson?: Record<string, unknown>,
): Promise<ProjectIntegrationBinding> {
  const res = await fetch(`${API_BASE}/api/projects/${projectId}/integrations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeader() },
    body: JSON.stringify({ integrationId, configJson }),
  });
  const body = await readJson<{ data: ProjectIntegrationBinding }>(res, "Failed to bind integration");
  return body.data;
}

export async function updateProjectIntegration(
  projectId: string,
  bindingId: string,
  data: { configJson?: Record<string, unknown>; status?: string },
): Promise<ProjectIntegrationBinding> {
  const res = await fetch(`${API_BASE}/api/projects/${projectId}/integrations/${bindingId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getAuthHeader() },
    body: JSON.stringify(data),
  });
  const body = await readJson<{ data: ProjectIntegrationBinding }>(res, "Failed to update binding");
  return body.data;
}

export async function unbindProjectIntegration(projectId: string, bindingId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/projects/${projectId}/integrations/${bindingId}`, {
    method: "DELETE",
    headers: { ...getAuthHeader() },
  });
  await readJson<{ ok: boolean }>(res, "Failed to unbind integration");
}
