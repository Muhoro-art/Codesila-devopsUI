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

/* ─── Types ────────────────────────────────────────────── */

export type ProjectType = "API" | "WEB" | "MOBILE" | "FULLSTACK" | "DATA" | "INFRA" | "LIBRARY" | "OTHER";

export type ProjectMember = {
  id: string;
  userId: string;
  name: string;
  email: string;
  systemRole: string;
  projectRole: string;
  isActive: boolean;
  joinedAt: string;
};

export type ProjectChatRoom = {
  id: string;
  name: string;
};

export type ProjectOwner = {
  id: string;
  name: string | null;
  email: string;
  role: string;
};

export type ProjectEnvironment = {
  id: string;
  name: string;
  key: string;
  isDefault: boolean;
};

export type ProjectService = {
  id: string;
  name: string;
  key: string;
  description?: string | null;
  tier: string;
  createdAt: string;
};

export type Project = {
  id: string;
  name: string;
  key: string;
  description?: string | null;
  type: ProjectType;
  gitRepositoryUrl?: string | null;
  defaultBranch?: string | null;
  status: string;
  orgId: string;
  ownerId: string;
  owner?: ProjectOwner;
  memberships?: Array<{
    id: string;
    role: string;
    user: { id: string; name: string | null; email: string; role: string };
  }>;
  _count?: {
    services: number;
    deployments: number;
    incidents: number;
  };
  chatRoom?: ProjectChatRoom | null;
  services?: ProjectService[];
  environments?: ProjectEnvironment[];
  createdAt: string;
  updatedAt: string;
};

/* ─── List Projects ──────────────────────────────────────── */

export async function listProjects(params?: { status?: string }) {
  const search = new URLSearchParams();
  if (params?.status) search.set("status", params.status);
  const qs = search.toString();

  const res = await fetch(`${API_BASE}/projects${qs ? `?${qs}` : ""}`, {
    headers: { ...getAuthHeader() },
  });

  return readJsonResponse<Project[]>(res, "Failed to load projects");
}

/* ─── Create Project ─────────────────────────────────────── */

export async function createProject(input: {
  name: string;
  key: string;
  description?: string;
  type?: ProjectType;
  gitRepositoryUrl?: string;
  defaultBranch?: string;
  memberIds?: string[];
}) {
  const res = await fetch(`${API_BASE}/projects`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeader(),
    },
    body: JSON.stringify(input),
  });

  return readJsonResponse<Project>(res, "Failed to create project");
}

/* ─── Get Project Detail ─────────────────────────────────── */

export async function getProject(projectId: string) {
  const res = await fetch(`${API_BASE}/projects/${projectId}`, {
    headers: { ...getAuthHeader() },
  });

  return readJsonResponse<Project>(res, "Failed to load project");
}

/* ─── Update Project ─────────────────────────────────────── */

export async function updateProject(projectId: string, input: {
  name?: string;
  description?: string;
  type?: ProjectType;
  gitRepositoryUrl?: string;
  defaultBranch?: string;
  status?: string;
}) {
  const res = await fetch(`${API_BASE}/projects/${projectId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeader(),
    },
    body: JSON.stringify(input),
  });

  return readJsonResponse<Project>(res, "Failed to update project");
}

/* ─── Archive (Delete) Project ───────────────────────────── */

export async function archiveProject(projectId: string) {
  const res = await fetch(`${API_BASE}/projects/${projectId}`, {
    method: "DELETE",
    headers: { ...getAuthHeader() },
  });

  return readJsonResponse<{ message: string; project: Project }>(res, "Failed to archive project");
}

/* ─── List Project Members ───────────────────────────────── */

export async function listProjectMembers(projectId: string) {
  const res = await fetch(`${API_BASE}/projects/${projectId}/members`, {
    headers: { ...getAuthHeader() },
  });

  return readJsonResponse<ProjectMember[]>(res, "Failed to load members");
}

/* ─── Add Members ────────────────────────────────────────── */

export async function addProjectMembers(projectId: string, input: {
  userIds: string[];
  role?: string;
}) {
  const res = await fetch(`${API_BASE}/projects/${projectId}/members`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeader(),
    },
    body: JSON.stringify(input),
  });

  return readJsonResponse<ProjectMember[]>(res, "Failed to add members");
}

/* ─── Change Member Role ─────────────────────────────────── */

export async function changeMemberRole(projectId: string, userId: string, role: string) {
  const res = await fetch(`${API_BASE}/projects/${projectId}/members/${userId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeader(),
    },
    body: JSON.stringify({ role }),
  });

  return readJsonResponse<ProjectMember>(res, "Failed to change member role");
}

/* ─── Remove Member ──────────────────────────────────────── */

export async function removeProjectMember(projectId: string, userId: string) {
  const res = await fetch(`${API_BASE}/projects/${projectId}/members/${userId}`, {
    method: "DELETE",
    headers: { ...getAuthHeader() },
  });

  return readJsonResponse<{ message: string }>(res, "Failed to remove member");
}
