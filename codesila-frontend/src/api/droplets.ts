// Frontend API layer for DigitalOcean droplets, SSH keys,
// VS Code Remote SSH, and GitHub dev environment setup

import { API_BASE, getAuthHeader, readJsonResponse } from "./client";

/* ─── Types ──────────────────────────────────────────────── */

export interface Droplet {
  id: string;
  orgId: string;
  projectId: string | null;
  name: string;
  dropletId: string | null;
  ipAddress: string;
  region: string;
  size: string;
  image: string;
  status: "ACTIVE" | "INACTIVE" | "PROVISIONING" | "ERROR";
  sshUser: string;
  sshPort: number;
  sshKeyFingerprint: string | null;
  githubConnected: boolean;
  vscodeReady: boolean;
  tags: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  project?: { id: string; name: string; key: string } | null;
  createdBy?: { id: string; email: string; name: string | null };
  _count?: { sshKeys: number };
  sshKeys?: DropletSSHKey[];
}

export interface DropletSSHKey {
  id: string;
  label: string;
  fingerprint: string;
  addedToDroplet: boolean;
  userId: string;
  createdAt: string;
  user?: { id: string; email: string; name: string | null };
}

export interface VSCodeConfig {
  hostAlias: string;
  sshConfig: string;
  vscodeUri: string;
  cliCommand: string;
  setupScript: string;
  droplet: {
    id: string;
    name: string;
    ipAddress: string;
    sshUser: string;
    sshPort: number;
    project: { name: string; key: string } | null;
  };
}

export interface GitHubSetupResult {
  setupScript: string;
  sshCommand: string;
  keyLabel: string;
  instructions: string[];
}

export interface VSCodeSetupResult {
  setupScript: string;
  sshCommand: string;
  instructions: string[];
}

export interface DODroplet {
  dropletId: string;
  name: string;
  ipAddress: string | null;
  region: string;
  size: string;
  image: string;
  status: string;
  tags: string;
  registered: boolean;
}

export interface ConnectionTestResult {
  dropletId: string;
  ipAddress: string;
  sshUser: string;
  sshPort: number;
  githubConnected: boolean;
  vscodeReady: boolean;
  doStatus?: string;
  doIp?: string | null;
  reachable: boolean | null;
  sshTestCommand: string;
  note?: string;
}

/* ─── Droplet CRUD ───────────────────────────────────────── */

export async function listDroplets(projectId?: string): Promise<Droplet[]> {
  const headers = getAuthHeader();
  if (!headers) throw new Error("Not authenticated");
  const qs = projectId ? `?projectId=${projectId}` : "";
  const res = await fetch(`${API_BASE}/droplets${qs}`, { headers });
  return readJsonResponse(res);
}

export async function getDroplet(id: string): Promise<Droplet> {
  const headers = getAuthHeader();
  if (!headers) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/droplets/${id}`, { headers });
  return readJsonResponse(res);
}

export async function registerDroplet(data: {
  name: string;
  ipAddress: string;
  dropletId?: string;
  region?: string;
  size?: string;
  sshUser?: string;
  sshPort?: number;
  projectId?: string;
  tags?: string;
}): Promise<Droplet> {
  const headers = getAuthHeader();
  if (!headers) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/droplets`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return readJsonResponse(res);
}

export async function updateDroplet(id: string, data: Partial<{
  name: string;
  ipAddress: string;
  sshUser: string;
  sshPort: number;
  projectId: string | null;
  tags: string;
  status: string;
}>): Promise<Droplet> {
  const headers = getAuthHeader();
  if (!headers) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/droplets/${id}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return readJsonResponse(res);
}

export async function deleteDroplet(id: string): Promise<void> {
  const headers = getAuthHeader();
  if (!headers) throw new Error("Not authenticated");
  await fetch(`${API_BASE}/droplets/${id}`, { method: "DELETE", headers });
}

/* ─── SSH Keys ───────────────────────────────────────────── */

export async function addSSHKey(dropletId: string, data: { label: string; publicKey: string }): Promise<DropletSSHKey> {
  const headers = getAuthHeader();
  if (!headers) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/droplets/${dropletId}/ssh-keys`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return readJsonResponse(res);
}

export async function removeSSHKey(dropletId: string, keyId: string): Promise<void> {
  const headers = getAuthHeader();
  if (!headers) throw new Error("Not authenticated");
  await fetch(`${API_BASE}/droplets/${dropletId}/ssh-keys/${keyId}`, { method: "DELETE", headers });
}

/* ─── VS Code SSH Config ────────────────────────────────── */

export async function getVSCodeConfig(dropletId: string): Promise<VSCodeConfig> {
  const headers = getAuthHeader();
  if (!headers) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/droplets/${dropletId}/vscode-config`, { headers });
  return readJsonResponse(res);
}

/* ─── GitHub SSH Setup ───────────────────────────────────── */

export async function setupGitHub(dropletId: string, data?: { githubToken?: string; gitName?: string; gitEmail?: string }): Promise<GitHubSetupResult> {
  const headers = getAuthHeader();
  if (!headers) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/droplets/${dropletId}/setup-github`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(data ?? {}),
  });
  return readJsonResponse(res);
}

/* ─── VS Code Environment Setup ──────────────────────────── */

export async function setupVSCode(dropletId: string): Promise<VSCodeSetupResult> {
  const headers = getAuthHeader();
  if (!headers) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/droplets/${dropletId}/setup-vscode`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  return readJsonResponse(res);
}

/* ─── Connection Test ────────────────────────────────────── */

export async function testConnection(dropletId: string): Promise<ConnectionTestResult> {
  const headers = getAuthHeader();
  if (!headers) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/droplets/${dropletId}/connection-test`, { headers });
  return readJsonResponse(res);
}

/* ─── DigitalOcean Droplet Import ────────────────────────── */

export async function listDODroplets(): Promise<DODroplet[]> {
  const headers = getAuthHeader();
  if (!headers) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/droplets/do/list`, { headers });
  return readJsonResponse(res);
}
