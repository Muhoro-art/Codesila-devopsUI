import { API_BASE, getAuthHeader } from "./client";

async function readJsonResponse<T>(res: Response, fallbackMessage: string) {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    throw new Error(text || fallbackMessage);
  }

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || fallbackMessage);
  }

  return data as T;
}

export type AuditEvent = {
  id: string;
  orgId: string;
  projectId?: string | null;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
};

export type ProjectSummary = {
  id: string;
  name: string;
  key: string;
  description?: string | null;
  type?: string;
  status?: string;
  ownerId?: string;
  owner?: { id: string; name: string | null; email: string; role: string };
  memberships?: Array<{
    id: string;
    role: string;
    user: { id: string; name: string | null; email: string; role: string };
  }>;
  _count?: { services: number; deployments: number; incidents: number };
  chatRoom?: { id: string; name: string } | null;
  createdAt?: string;
};

export type InsightSnapshot = {
  deployments: Array<{
    id: string;
    service: string;
    project: string;
    version: string;
    environment: string;
    status: string;
    startedAt: string;
    finishedAt?: string | null;
  }>;
  deploymentStats: {
    meanDurationMinutes?: number | null;
    windowDays: number;
  };
  deploymentActors: Array<{
    version: string;
    project: string;
    service: string;
    environment: string;
    status: string;
    startedAt: string;
    actor?: string | null;
    triggeredBy?: string | null;
  }>;
  incidents: Array<{
    id: string;
    project: string;
    service: string;
    severity: string;
    status: string;
    summary: string;
    startedAt: string;
  }>;
  degradedServices: Array<{ id: string; name: string }>;
  runbookUpdates: Array<{
    id: string;
    title: string;
    project: string;
    service?: string | null;
    status: string;
    updatedAt: string;
  }>;
};

export async function listAuditEvents(params?: {
  projectId?: string;
  entityType?: string;
  actorId?: string;
  limit?: number;
}) {
  const search = new URLSearchParams();
  if (params?.projectId) search.set("projectId", params.projectId);
  if (params?.entityType) search.set("entityType", params.entityType);
  if (params?.actorId) search.set("actorId", params.actorId);
  if (params?.limit) search.set("limit", String(params.limit));

  const res = await fetch(`${API_BASE}/devflow/audit?${search.toString()}`, {
    headers: {
      ...getAuthHeader(),
    },
  });

  return readJsonResponse<AuditEvent[]>(res, "Failed to load audit events");
}

export async function listProjects() {
  const res = await fetch(`${API_BASE}/devflow/projects`, {
    headers: {
      ...getAuthHeader(),
    },
  });

  return readJsonResponse<ProjectSummary[]>(res, "Failed to load projects");
}

export async function getInsights(params?: {
  projectId?: string;
  windowDays?: number;
}) {
  const search = new URLSearchParams();
  if (params?.projectId) search.set("projectId", params.projectId);
  if (params?.windowDays) search.set("windowDays", String(params.windowDays));

  const res = await fetch(`${API_BASE}/devflow/insights?${search.toString()}`, {
    headers: {
      ...getAuthHeader(),
    },
  });

  return readJsonResponse<InsightSnapshot>(res, "Failed to load insights");
}

/* ───────── Deployments ───────── */

export type Deployment = {
  id: string;
  orgId: string;
  projectId: string;
  serviceId: string;
  environment: string;
  version: string;
  status: string;
  startedAt: string;
  finishedAt?: string | null;
  deployedAt?: string | null;
  createdById?: string | null;
  triggeredById?: string | null;
  createdAt: string;
  project?: { name: string; key: string };
  service?: { name: string; key: string };
};

export async function listDeployments(params?: {
  projectId?: string;
  serviceId?: string;
  limit?: number;
}) {
  const search = new URLSearchParams();
  if (params?.projectId) search.set("projectId", params.projectId);
  if (params?.serviceId) search.set("serviceId", params.serviceId);
  if (params?.limit) search.set("limit", String(params.limit));

  const res = await fetch(`${API_BASE}/devflow/deployments?${search.toString()}`, {
    headers: { ...getAuthHeader() },
  });

  return readJsonResponse<Deployment[]>(res, "Failed to load deployments");
}

export async function createDeployment(input: {
  projectId: string;
  serviceId: string;
  environment: string;
  version: string;
}) {
  const res = await fetch(`${API_BASE}/devflow/deployments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeader(),
    },
    body: JSON.stringify(input),
  });

  return readJsonResponse<Deployment>(res, "Failed to create deployment");
}

/* ───────── Services ───────── */

export type Service = {
  id: string;
  orgId: string;
  projectId: string;
  name: string;
  key: string;
  description?: string | null;
  tier: string;
  createdAt: string;
};

export async function listServices(projectId: string) {
  const res = await fetch(`${API_BASE}/devflow/projects/${projectId}/services`, {
    headers: { ...getAuthHeader() },
  });

  return readJsonResponse<Service[]>(res, "Failed to load services");
}

export async function createService(projectId: string, input: {
  name: string;
  key: string;
  description?: string;
  tier?: string;
}) {
  const res = await fetch(`${API_BASE}/devflow/projects/${projectId}/services`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeader(),
    },
    body: JSON.stringify(input),
  });

  return readJsonResponse<Service>(res, "Failed to create service");
}

/* ───────── Incidents ───────── */

export type Incident = {
  id: string;
  orgId: string;
  projectId: string;
  serviceId?: string | null;
  severity: string;
  status: string;
  summary: string;
  description?: string | null;
  startedAt: string;
  resolvedAt?: string | null;
  ownerId?: string | null;
  createdAt: string;
  project?: { name: string };
  service?: { name: string } | null;
};

export async function listIncidents(params?: {
  projectId?: string;
  serviceId?: string;
  status?: string;
  limit?: number;
}) {
  const search = new URLSearchParams();
  if (params?.projectId) search.set("projectId", params.projectId);
  if (params?.serviceId) search.set("serviceId", params.serviceId);
  if (params?.status) search.set("status", params.status);
  if (params?.limit) search.set("limit", String(params.limit));

  const res = await fetch(`${API_BASE}/devflow/incidents?${search.toString()}`, {
    headers: { ...getAuthHeader() },
  });

  return readJsonResponse<Incident[]>(res, "Failed to load incidents");
}

export async function createIncident(input: {
  projectId: string;
  serviceId?: string;
  summary: string;
  description?: string;
}) {
  const res = await fetch(`${API_BASE}/devflow/incidents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeader(),
    },
    body: JSON.stringify(input),
  });

  return readJsonResponse<Incident>(res, "Failed to create incident");
}

export async function updateIncident(incidentId: string, input: {
  status?: string;
  severity?: string;
  summary?: string;
  description?: string;
  ownerId?: string;
  resolvedAt?: string;
}) {
  const res = await fetch(`${API_BASE}/devflow/incidents/${incidentId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeader(),
    },
    body: JSON.stringify(input),
  });

  return readJsonResponse<Incident>(res, "Failed to update incident");
}

/* ───────── Runbooks ───────── */

export type Runbook = {
  id: string;
  orgId: string;
  projectId: string;
  serviceId?: string | null;
  title: string;
  content: string;
  version: number;
  status: string;
  createdById?: string | null;
  updatedById?: string | null;
  createdAt: string;
  updatedAt: string;
  project?: { name: string };
  service?: { name: string } | null;
};

export async function listRunbooks(params?: {
  projectId?: string;
  serviceId?: string;
}) {
  const search = new URLSearchParams();
  if (params?.projectId) search.set("projectId", params.projectId);
  if (params?.serviceId) search.set("serviceId", params.serviceId);

  const res = await fetch(`${API_BASE}/devflow/runbooks?${search.toString()}`, {
    headers: { ...getAuthHeader() },
  });

  return readJsonResponse<Runbook[]>(res, "Failed to load runbooks");
}

export async function createRunbook(input: {
  projectId: string;
  serviceId?: string;
  title: string;
  content: string;
}) {
  const res = await fetch(`${API_BASE}/devflow/runbooks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeader(),
    },
    body: JSON.stringify(input),
  });

  return readJsonResponse<Runbook>(res, "Failed to create runbook");
}

export async function updateRunbook(runbookId: string, input: {
  title?: string;
  content?: string;
  status?: string;
}) {
  const res = await fetch(`${API_BASE}/devflow/runbooks/${runbookId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeader(),
    },
    body: JSON.stringify(input),
  });

  return readJsonResponse<Runbook>(res, "Failed to update runbook");
}

/* ───────── DevFlow Project Detail ───────── */

export type DevFlowProject = {
  id: string;
  orgId: string;
  name: string;
  key: string;
  description?: string | null;
  gitRepositoryUrl?: string | null;
  defaultBranch?: string | null;
  status: string;
  ownerId: string;
  services?: Service[];
  createdAt: string;
  updatedAt: string;
};

export async function getProject(projectId: string) {
  const res = await fetch(`${API_BASE}/devflow/projects/${projectId}`, {
    headers: { ...getAuthHeader() },
  });

  return readJsonResponse<DevFlowProject>(res, "Failed to load project");
}
