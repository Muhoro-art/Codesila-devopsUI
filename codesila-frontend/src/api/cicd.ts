// src/api/cicd.ts — CI/CD Pipeline API client (§3.3)
import { API_BASE, getAuthHeader } from "./client";

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text();
    throw new Error(text || fallback);
  }
  const data = await res.json();
  if (!res.ok) {
    // Include validation details when available
    let msg = data.code || data.error || fallback;
    if (Array.isArray(data.details) && data.details.length > 0) {
      const detailMsgs = data.details.map((d: any) => d.message || d.field).join("; ");
      msg += `: ${detailMsgs}`;
    }
    throw new Error(msg);
  }
  return data as T;
}

/* ─── Types ─────────────────────────────────────────────── */

export interface Pipeline {
  id: string;
  name: string;
  project_id: string;
  config_yaml: string;
  created_at: string;
  updated_at?: string;
}

export interface PipelineRun {
  id: string;
  pipeline_id: string;
  status: "QUEUED" | "RUNNING" | "SUCCESS" | "FAILURE" | "CANCELLED";
  triggered_by: string | null;
  branch: string | null;
  commit_sha: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface RunStep {
  id: string;
  run_id: string;
  name: string;
  status: "QUEUED" | "RUNNING" | "SUCCESS" | "FAILURE" | "CANCELLED";
  sort_order: number;
  started_at: string | null;
  finished_at: string | null;
}

export interface StepLogs {
  id: string;
  name: string;
  logs: string;
}

/* ─── Cross-project recent runs ────────────────────────── */

export interface RecentPipelineRun {
  id: string;
  pipeline_id: string;
  pipeline_name: string | null;
  project_id: string | null;
  project_name: string | null;
  project_key: string | null;
  status: "QUEUED" | "RUNNING" | "SUCCESS" | "FAILURE" | "CANCELLED";
  triggered_by: string | null;
  branch: string | null;
  commit_sha: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export async function listRecentPipelineRuns(opts?: { limit?: number; status?: string }): Promise<RecentPipelineRun[]> {
  const search = new URLSearchParams();
  if (opts?.limit) search.set("limit", String(opts.limit));
  if (opts?.status) search.set("status", opts.status);

  const res = await fetch(`${API_BASE}/api/cicd/runs/recent?${search.toString()}`, {
    headers: { ...getAuthHeader() },
  });
  const body = await readJson<{ data: RecentPipelineRun[] }>(res, "Failed to load recent runs");
  return body.data;
}

/* ─── Pipelines ─────────────────────────────────────────── */

export async function listPipelines(projectId: string): Promise<Pipeline[]> {
  const res = await fetch(`${API_BASE}/api/projects/${projectId}/pipelines`, {
    headers: { ...getAuthHeader() },
  });
  const body = await readJson<{ data: any[] }>(res, "Failed to load pipelines");
  return body.data.map((p) => ({
    id: p.id,
    name: p.name,
    project_id: p.project_id ?? p.projectId,
    config_yaml: p.config_yaml ?? p.configYaml,
    created_at: p.created_at ?? p.createdAt,
    updated_at: p.updated_at ?? p.updatedAt,
  }));
}

export async function createPipeline(projectId: string, name: string, configYaml: string): Promise<Pipeline> {
  const res = await fetch(`${API_BASE}/api/projects/${projectId}/pipelines`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeader() },
    body: JSON.stringify({ name, config_yaml: configYaml }),
  });
  const body = await readJson<{ data: Pipeline }>(res, "Failed to create pipeline");
  return body.data;
}

export async function updatePipeline(pipelineId: string, data: { name?: string; config_yaml?: string }): Promise<Pipeline> {
  const res = await fetch(`${API_BASE}/api/pipelines/${pipelineId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getAuthHeader() },
    body: JSON.stringify(data),
  });
  const body = await readJson<{ data: Pipeline }>(res, "Failed to update pipeline");
  return body.data;
}

export async function deletePipeline(pipelineId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/pipelines/${pipelineId}`, {
    method: "DELETE",
    headers: { ...getAuthHeader() },
  });
  await readJson<{ ok: boolean }>(res, "Failed to delete pipeline");
}

/* ─── Pipeline Runs ─────────────────────────────────────── */

export async function listPipelineRuns(pipelineId: string, page = 1, limit = 20): Promise<{ data: PipelineRun[]; meta: { total: number; page: number; limit: number } }> {
  const res = await fetch(`${API_BASE}/api/pipelines/${pipelineId}/runs?page=${page}&limit=${limit}`, {
    headers: { ...getAuthHeader() },
  });
  return readJson(res, "Failed to load runs");
}

export async function triggerPipelineRun(pipelineId: string, opts?: { branch?: string; commitSha?: string }): Promise<{ runId: string; status: string }> {
  const res = await fetch(`${API_BASE}/api/pipelines/${pipelineId}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeader() },
    body: JSON.stringify(opts ?? {}),
  });
  const body = await readJson<{ data: { runId: string; status: string } }>(res, "Failed to trigger run");
  return body.data;
}

export async function getPipelineRun(runId: string): Promise<PipelineRun> {
  const res = await fetch(`${API_BASE}/api/runs/${runId}`, {
    headers: { ...getAuthHeader() },
  });
  const body = await readJson<{ data: PipelineRun }>(res, "Failed to load run");
  return body.data;
}

export async function cancelPipelineRun(runId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/runs/${runId}/cancel`, {
    method: "POST",
    headers: { ...getAuthHeader() },
  });
  await readJson<{ ok: boolean }>(res, "Failed to cancel run");
}

/* ─── Run Steps & Logs ──────────────────────────────────── */

export async function getRunSteps(runId: string): Promise<RunStep[]> {
  const res = await fetch(`${API_BASE}/api/runs/${runId}/steps`, {
    headers: { ...getAuthHeader() },
  });
  const body = await readJson<{ data: RunStep[] }>(res, "Failed to load steps");
  return body.data;
}

export async function getStepLogs(runId: string, stepId: string): Promise<StepLogs> {
  const res = await fetch(`${API_BASE}/api/runs/${runId}/steps/${stepId}/logs`, {
    headers: { ...getAuthHeader() },
  });
  const body = await readJson<{ data: StepLogs }>(res, "Failed to load logs");
  return body.data;
}

/* ─── SSE Live Logs ─────────────────────────────────────── */

export function subscribePipelineLogs(runId: string, onMessage: (event: { type: string; data: any }) => void): () => void {
  const token = sessionStorage.getItem("token");
  const url = `${API_BASE}/api/runs/${runId}/logs/stream?token=${encodeURIComponent(token || "")}`;
  const es = new EventSource(url);

  es.addEventListener("step_status", (e) => onMessage({ type: "step_status", data: JSON.parse(e.data) }));
  es.addEventListener("log", (e) => onMessage({ type: "log", data: JSON.parse(e.data) }));
  es.addEventListener("run_status", (e) => onMessage({ type: "run_status", data: JSON.parse(e.data) }));
  es.addEventListener("done", () => { onMessage({ type: "done", data: null }); es.close(); });
  es.onerror = () => { es.close(); };

  return () => es.close();
}
