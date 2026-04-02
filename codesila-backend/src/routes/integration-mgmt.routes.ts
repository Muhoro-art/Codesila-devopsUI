// src/routes/integration-mgmt.routes.ts
// Generic integration management — GitHub PAT, GitLab, Docker Registry (§3.4, FR-06/FR-07)

import { Router, Request, Response } from "express";
import { requirePermission } from "../middlewares/requirePermission";
import { Actions } from "../modules/admin/rbac/permissions";
import { prisma } from "../infra/db";
import { encrypt, decrypt } from "../shared/security/encryption";

const router = Router();

/* ─── Provider validation (calls upstream APIs) ──────────── */

async function validateGitHubToken(token: string): Promise<boolean> {
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json", "User-Agent": "CodeSila/1.0" },
  });
  return res.ok;
}

async function validateGitLabToken(token: string): Promise<boolean> {
  const res = await fetch("https://gitlab.com/api/v4/user", {
    headers: { "PRIVATE-TOKEN": token },
  });
  return res.ok;
}

async function validateDockerRegistry(url: string, username: string, token: string): Promise<{ ok: boolean; code?: string }> {
  try {
    let base = url.replace(/\/+$/, "");
    // Normalize Docker Hub shorthand
    if (/^(https?:\/\/)?(hub\.)?docker\.(io|com)$/i.test(base)) {
      base = "https://index.docker.io";
    }
    if (!base.startsWith("http")) base = `https://${base}`;
    const basic = `Basic ${Buffer.from(`${username}:${token}`).toString("base64")}`;
    const res = await fetch(`${base}/v2/`, { headers: { Authorization: basic } });
    if (res.ok) return { ok: true };

    // Docker Hub (and some registries) return 401 with WWW-Authenticate
    // pointing to a token service. Try the token-exchange flow.
    if (res.status === 401) {
      const wwwAuth = res.headers.get("www-authenticate") || "";
      const realmMatch = wwwAuth.match(/realm="([^"]+)"/);
      const serviceMatch = wwwAuth.match(/service="([^"]+)"/);
      if (realmMatch) {
        const realm = realmMatch[1];
        const service = serviceMatch ? serviceMatch[1] : "";
        const tokenUrl = `${realm}?service=${encodeURIComponent(service)}&scope=repository:library/alpine:pull`;
        const tokenRes = await fetch(tokenUrl, { headers: { Authorization: basic } });
        if (tokenRes.ok) return { ok: true };
      }
      return { ok: false, code: "INVALID_TOKEN" };
    }

    return { ok: false, code: "INVALID_TOKEN" };
  } catch {
    return { ok: false, code: "REGISTRY_UNREACHABLE" };
  }
}

/* ─── GitHub/GitLab repo helpers ─────────────────────────── */

async function fetchGitHubRepos(token: string): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(`https://api.github.com/user/repos?per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json", "User-Agent": "CodeSila/1.0" },
    });
    if (res.status === 403) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      if (remaining === "0") throw Object.assign(new Error("rate limited"), { code: "RATE_LIMITED" });
      throw new Error(`GitHub API 403`);
    }
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const data = await res.json() as any[];
    all.push(...data);
    // Check Link header for next page
    const link = res.headers.get("link") || "";
    if (!link.includes('rel="next"')) break;
    page++;
  }
  return all;
}

function mapGitHubRepo(r: any) {
  return {
    name: r.name,
    fullName: r.full_name,
    cloneUrl: r.clone_url,
    defaultBranch: r.default_branch,
    isPrivate: r.private,
  };
}

async function fetchGitLabProjects(token: string): Promise<any[]> {
  const res = await fetch("https://gitlab.com/api/v4/projects?membership=true&per_page=100", {
    headers: { "PRIVATE-TOKEN": token },
  });
  if (!res.ok) throw new Error(`GitLab API ${res.status}`);
  return res.json() as Promise<any[]>;
}

function mapGitLabProject(p: any) {
  return {
    name: p.name,
    fullName: p.path_with_namespace,
    cloneUrl: p.http_url_to_repo,
    defaultBranch: p.default_branch,
    isPrivate: p.visibility !== "public",
  };
}

/* ─── GET /api/integrations — list org integrations ──────── */

router.get(
  "/integrations",
  requirePermission(Actions.IntegrationManage),
  async (_req: Request, res: Response) => {
    const orgId = res.locals.user?.orgId;
    const rows = await prisma.integration.findMany({
      where: { orgId, isActive: true },
      select: { id: true, type: true, name: true, registryUrl: true, username: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    return res.json({ data: rows });
  },
);

/* ─── POST /api/integrations — create integration ────────── */

router.post(
  "/integrations",
  requirePermission(Actions.IntegrationManage),
  async (req: Request, res: Response) => {
    const { type, token, name, registryUrl, username } = req.body ?? {};
    const details: { field: string; message: string }[] = [];

    if (!type) details.push({ field: "type", message: "type is required" });
    if (!name) details.push({ field: "name", message: "name is required" });
    if (!token) details.push({ field: "token", message: "token is required" });
    if (type === "docker_registry") {
      if (!registryUrl) details.push({ field: "registryUrl", message: "registryUrl is required" });
      if (!username) details.push({ field: "username", message: "username is required" });
    }
    if (details.length) {
      return res.status(400).json({ code: "VALIDATION_ERROR", details });
    }

    const orgId = res.locals.user?.orgId;
    const userId = res.locals.user?.sub;

    // Validate token against provider
    if (type === "github") {
      const valid = await validateGitHubToken(token);
      if (!valid) return res.status(400).json({ code: "INVALID_TOKEN" });
    } else if (type === "gitlab") {
      const valid = await validateGitLabToken(token);
      if (!valid) return res.status(400).json({ code: "INVALID_TOKEN" });
    } else if (type === "docker_registry") {
      const check = await validateDockerRegistry(registryUrl, username, token);
      if (!check.ok) return res.status(400).json({ code: check.code });
    }

    const integration = await prisma.integration.create({
      data: {
        orgId,
        type,
        name,
        credentialsEnc: encrypt(token),
        registryUrl: registryUrl ?? null,
        username: username ?? null,
        createdById: userId,
      },
    });

    return res.status(201).json({
      data: { id: integration.id, type: integration.type, name: integration.name },
    });
  },
);

/* ─── GET /api/integrations/:id/repositories ─────────────── */

router.get(
  "/integrations/:id/repositories",
  requirePermission(Actions.IntegrationManage),
  async (req: Request, res: Response) => {
    const orgId = res.locals.user?.orgId;
    const integration = await prisma.integration.findFirst({
      where: { id: req.params.id, isActive: true },
    });
    if (!integration) return res.status(404).json({ code: "INTEGRATION_NOT_FOUND" });
    if (integration.orgId !== orgId) return res.status(403).json({ code: "FORBIDDEN" });

    const token = decrypt(integration.credentialsEnc);

    try {
      let repos: any[];
      if (integration.type === "github") {
        const raw = await fetchGitHubRepos(token);
        repos = raw.map(mapGitHubRepo);
      } else if (integration.type === "gitlab") {
        const raw = await fetchGitLabProjects(token);
        repos = raw.map(mapGitLabProject);
      } else {
        return res.status(400).json({ code: "REPOS_NOT_SUPPORTED" });
      }
      return res.json({ data: repos });
    } catch (err: any) {
      if (err.code === "RATE_LIMITED") {
        return res.status(503).json({ code: "UPSTREAM_RATE_LIMITED" });
      }
      throw err;
    }
  },
);

/* ─── GET /api/integrations/:id/repositories/:repo/branches ─ */

router.get(
  "/integrations/:id/repositories/:owner/:repo/branches",
  requirePermission(Actions.IntegrationManage),
  async (req: Request, res: Response) => {
    const orgId = res.locals.user?.orgId;
    const integration = await prisma.integration.findFirst({
      where: { id: req.params.id, isActive: true },
    });
    if (!integration) return res.status(404).json({ code: "INTEGRATION_NOT_FOUND" });
    if (integration.orgId !== orgId) return res.status(403).json({ code: "FORBIDDEN" });

    const token = decrypt(integration.credentialsEnc);
    const { owner, repo } = req.params;

    if (integration.type === "github") {
      const response = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json", "User-Agent": "CodeSila/1.0" } },
      );
      if (!response.ok) return res.status(response.status).json({ code: "UPSTREAM_ERROR" });
      const data = await response.json() as any[];
      return res.json({ data: data.map((b: any) => ({ name: b.name, sha: b.commit?.sha })) });
    }

    if (integration.type === "gitlab") {
      const response = await fetch(
        `https://gitlab.com/api/v4/projects/${encodeURIComponent(`${owner}/${repo}`)}/repository/branches?per_page=100`,
        { headers: { "PRIVATE-TOKEN": token } },
      );
      if (!response.ok) return res.status(response.status).json({ code: "UPSTREAM_ERROR" });
      const data = await response.json() as any[];
      return res.json({ data: data.map((b: any) => ({ name: b.name, sha: b.commit?.id })) });
    }

    return res.status(400).json({ code: "BRANCHES_NOT_SUPPORTED" });
  },
);

/* ─── GET /api/integrations/:id/repositories/:owner/:repo/commits ─ */

router.get(
  "/integrations/:id/repositories/:owner/:repo/commits",
  requirePermission(Actions.ProjectRead),
  async (req: Request, res: Response) => {
    const orgId = res.locals.user?.orgId;
    const integration = await prisma.integration.findFirst({
      where: { id: req.params.id, isActive: true },
    });
    if (!integration) return res.status(404).json({ code: "INTEGRATION_NOT_FOUND" });
    if (integration.orgId !== orgId) return res.status(403).json({ code: "FORBIDDEN" });

    const token = decrypt(integration.credentialsEnc);
    const { owner, repo } = req.params;
    const branch = typeof req.query.branch === "string" ? req.query.branch : undefined;
    const limit = Math.min(Number(req.query.limit) || 20, 100);

    if (integration.type === "github") {
      const qs = new URLSearchParams({ per_page: String(limit) });
      if (branch) qs.set("sha", branch);
      const response = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?${qs}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json", "User-Agent": "CodeSila/1.0" } },
      );
      if (!response.ok) return res.status(response.status).json({ code: "UPSTREAM_ERROR" });
      const data = await response.json() as any[];
      return res.json({
        data: data.map((c: any) => ({
          sha: c.sha,
          shortSha: c.sha.substring(0, 7),
          message: c.commit?.message?.split("\n")[0] || "",
          authorName: c.commit?.author?.name || "",
          authorEmail: c.commit?.author?.email || "",
          authorAvatar: c.author?.avatar_url || "",
          date: c.commit?.author?.date || "",
          url: c.html_url || "",
        })),
      });
    }

    if (integration.type === "gitlab") {
      const qs = new URLSearchParams({ per_page: String(limit) });
      if (branch) qs.set("ref_name", branch);
      const response = await fetch(
        `https://gitlab.com/api/v4/projects/${encodeURIComponent(`${owner}/${repo}`)}/repository/commits?${qs}`,
        { headers: { "PRIVATE-TOKEN": token } },
      );
      if (!response.ok) return res.status(response.status).json({ code: "UPSTREAM_ERROR" });
      const data = await response.json() as any[];
      return res.json({
        data: data.map((c: any) => ({
          sha: c.id,
          shortSha: c.short_id,
          message: c.title || c.message?.split("\n")[0] || "",
          authorName: c.author_name || "",
          authorEmail: c.author_email || "",
          authorAvatar: "",
          date: c.authored_date || c.created_at || "",
          url: c.web_url || "",
        })),
      });
    }

    return res.status(400).json({ code: "COMMITS_NOT_SUPPORTED" });
  },
);

/* ─── POST /api/integrations/:id/repositories/:owner/:repo/webhooks ─ */

router.post(
  "/integrations/:id/repositories/:owner/:repo/webhooks",
  requirePermission(Actions.IntegrationManage),
  async (req: Request, res: Response) => {
    const orgId = res.locals.user?.orgId;
    const integration = await prisma.integration.findFirst({
      where: { id: req.params.id, isActive: true },
    });
    if (!integration) return res.status(404).json({ code: "INTEGRATION_NOT_FOUND" });
    if (integration.orgId !== orgId) return res.status(403).json({ code: "FORBIDDEN" });

    const token = decrypt(integration.credentialsEnc);
    const { owner, repo } = req.params;
    const { webhookUrl, events } = req.body ?? {};

    if (integration.type === "github") {
      const response = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/hooks`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github.v3+json",
            "Content-Type": "application/json",
            "User-Agent": "CodeSila/1.0",
          },
          body: JSON.stringify({
            name: "web",
            active: true,
            events: events ?? ["push"],
            config: { url: webhookUrl, content_type: "json" },
          }),
        },
      );
      if (!response.ok) return res.status(response.status).json({ code: "UPSTREAM_ERROR" });
      const hook = await response.json() as any;
      return res.status(201).json({ data: { webhookId: hook.id } });
    }

    return res.status(400).json({ code: "WEBHOOKS_NOT_SUPPORTED" });
  },
);

/* ─── POST /api/integrations/:id/repositories — create repo ── */

router.post(
  "/integrations/:id/repositories",
  requirePermission(Actions.IntegrationManage),
  async (req: Request, res: Response) => {
    const orgId = res.locals.user?.orgId;
    const integration = await prisma.integration.findFirst({
      where: { id: req.params.id, isActive: true },
    });
    if (!integration) return res.status(404).json({ code: "INTEGRATION_NOT_FOUND" });
    if (integration.orgId !== orgId) return res.status(403).json({ code: "FORBIDDEN" });

    const token = decrypt(integration.credentialsEnc);
    const { name, description, isPrivate, defaultBranch, autoInit } = req.body ?? {};
    if (!name || typeof name !== "string" || !/^[a-zA-Z0-9._-]+$/.test(name)) {
      return res.status(400).json({ code: "INVALID_REPO_NAME" });
    }

    if (integration.type === "github") {
      // Check if user has org scope — determine owner
      const userRes = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json", "User-Agent": "CodeSila/1.0" },
      });
      if (!userRes.ok) return res.status(401).json({ code: "INVALID_TOKEN" });
      const ghUser = await userRes.json() as any;

      const response = await fetch("https://api.github.com/user/repos", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "User-Agent": "CodeSila/1.0",
        },
        body: JSON.stringify({
          name,
          description: description || `Created by CodeSila`,
          private: isPrivate ?? true,
          auto_init: autoInit ?? true,
          default_branch: defaultBranch || "main",
        }),
      });

      if (response.status === 422) {
        return res.status(409).json({ code: "REPO_ALREADY_EXISTS" });
      }
      if (!response.ok) {
        return res.status(response.status).json({ code: "UPSTREAM_ERROR" });
      }

      const repo = await response.json() as any;
      return res.status(201).json({
        data: {
          name: repo.name,
          fullName: repo.full_name,
          cloneUrl: repo.clone_url,
          defaultBranch: repo.default_branch,
          isPrivate: repo.private,
          htmlUrl: repo.html_url,
          owner: ghUser.login,
        },
      });
    }

    if (integration.type === "gitlab") {
      const response = await fetch("https://gitlab.com/api/v4/projects", {
        method: "POST",
        headers: {
          "PRIVATE-TOKEN": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          description: description || `Created by CodeSila`,
          visibility: isPrivate === false ? "public" : "private",
          initialize_with_readme: autoInit ?? true,
          default_branch: defaultBranch || "main",
        }),
      });

      if (response.status === 400) {
        const err = await response.json() as any;
        if (err.message?.name?.[0]?.includes("already been taken")) {
          return res.status(409).json({ code: "REPO_ALREADY_EXISTS" });
        }
        return res.status(400).json({ code: "UPSTREAM_ERROR", message: err.message });
      }
      if (!response.ok) {
        return res.status(response.status).json({ code: "UPSTREAM_ERROR" });
      }

      const proj = await response.json() as any;
      return res.status(201).json({
        data: {
          name: proj.name,
          fullName: proj.path_with_namespace,
          cloneUrl: proj.http_url_to_repo,
          defaultBranch: proj.default_branch,
          isPrivate: proj.visibility === "private",
          htmlUrl: proj.web_url,
          owner: proj.namespace?.path || proj.path_with_namespace.split("/")[0],
        },
      });
    }

    return res.status(400).json({ code: "REPO_CREATE_NOT_SUPPORTED" });
  },
);

/* ─── DELETE /api/integrations/:id — soft-delete ─────────── */

router.delete(
  "/integrations/:id",
  requirePermission(Actions.IntegrationManage),
  async (req: Request, res: Response) => {
    const orgId = res.locals.user?.orgId;
    const integration = await prisma.integration.findFirst({
      where: { id: req.params.id },
    });
    if (!integration) return res.status(404).json({ code: "INTEGRATION_NOT_FOUND" });
    if (integration.orgId !== orgId) return res.status(403).json({ code: "FORBIDDEN" });

    await prisma.integration.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });

    return res.json({ ok: true });
  },
);

/* ═══════════════════════════════════════════════════════════
   LEVEL 2 — Project ↔ Integration bindings
   ═══════════════════════════════════════════════════════════ */

/* ─── GET /api/projects/:projectId/integrations — list bindings ── */

router.get(
  "/projects/:projectId/integrations",
  requirePermission(Actions.ProjectRead),
  async (req: Request, res: Response) => {
    const orgId = res.locals.user?.orgId;
    const { projectId } = req.params;

    // Verify project belongs to org
    const project = await prisma.project.findFirst({
      where: { id: projectId, orgId },
    });
    if (!project) return res.status(404).json({ code: "PROJECT_NOT_FOUND" });

    const bindings = await prisma.projectIntegration.findMany({
      where: { projectId },
      include: {
        integration: {
          select: { id: true, type: true, name: true, registryUrl: true, username: true, isActive: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json({
      data: bindings.map((b) => ({
        id: b.id,
        projectId: b.projectId,
        integrationId: b.integrationId,
        configJson: b.configJson,
        status: b.status,
        createdAt: b.createdAt,
        integration: b.integration,
      })),
    });
  },
);

/* ─── POST /api/projects/:projectId/integrations — bind integration ── */

router.post(
  "/projects/:projectId/integrations",
  requirePermission(Actions.IntegrationManage),
  async (req: Request, res: Response) => {
    const orgId = res.locals.user?.orgId;
    const { projectId } = req.params;
    const { integrationId, configJson } = req.body ?? {};

    if (!integrationId) {
      return res.status(400).json({ code: "VALIDATION_ERROR", details: [{ field: "integrationId", message: "integrationId is required" }] });
    }

    // Verify project belongs to org
    const project = await prisma.project.findFirst({
      where: { id: projectId, orgId },
    });
    if (!project) return res.status(404).json({ code: "PROJECT_NOT_FOUND" });

    // Verify integration belongs to same org and is active
    const integration = await prisma.integration.findFirst({
      where: { id: integrationId, orgId, isActive: true },
    });
    if (!integration) return res.status(404).json({ code: "INTEGRATION_NOT_FOUND" });

    // Check for existing binding
    const existing = await prisma.projectIntegration.findUnique({
      where: { projectId_integrationId: { projectId, integrationId } },
    });
    if (existing) return res.status(409).json({ code: "ALREADY_BOUND" });

    const binding = await prisma.projectIntegration.create({
      data: { projectId, integrationId, configJson: configJson ?? undefined },
      include: {
        integration: {
          select: { id: true, type: true, name: true, registryUrl: true, username: true },
        },
      },
    });

    return res.status(201).json({
      data: {
        id: binding.id,
        projectId: binding.projectId,
        integrationId: binding.integrationId,
        configJson: binding.configJson,
        status: binding.status,
        integration: binding.integration,
      },
    });
  },
);

/* ─── PUT /api/projects/:projectId/integrations/:bindingId — update config ── */

router.put(
  "/projects/:projectId/integrations/:bindingId",
  requirePermission(Actions.IntegrationManage),
  async (req: Request, res: Response) => {
    const orgId = res.locals.user?.orgId;
    const { projectId, bindingId } = req.params;
    const { configJson, status } = req.body ?? {};

    const project = await prisma.project.findFirst({
      where: { id: projectId, orgId },
    });
    if (!project) return res.status(404).json({ code: "PROJECT_NOT_FOUND" });

    const binding = await prisma.projectIntegration.findFirst({
      where: { id: bindingId, projectId },
    });
    if (!binding) return res.status(404).json({ code: "BINDING_NOT_FOUND" });

    const updated = await prisma.projectIntegration.update({
      where: { id: bindingId },
      data: {
        ...(configJson !== undefined ? { configJson } : {}),
        ...(status !== undefined ? { status } : {}),
      },
      include: {
        integration: {
          select: { id: true, type: true, name: true, registryUrl: true, username: true },
        },
      },
    });

    return res.json({
      data: {
        id: updated.id,
        projectId: updated.projectId,
        integrationId: updated.integrationId,
        configJson: updated.configJson,
        status: updated.status,
        integration: updated.integration,
      },
    });
  },
);

/* ─── DELETE /api/projects/:projectId/integrations/:bindingId — unbind ── */

router.delete(
  "/projects/:projectId/integrations/:bindingId",
  requirePermission(Actions.IntegrationManage),
  async (req: Request, res: Response) => {
    const orgId = res.locals.user?.orgId;
    const { projectId, bindingId } = req.params;

    const project = await prisma.project.findFirst({
      where: { id: projectId, orgId },
    });
    if (!project) return res.status(404).json({ code: "PROJECT_NOT_FOUND" });

    const binding = await prisma.projectIntegration.findFirst({
      where: { id: bindingId, projectId },
    });
    if (!binding) return res.status(404).json({ code: "BINDING_NOT_FOUND" });

    await prisma.projectIntegration.delete({ where: { id: bindingId } });

    return res.json({ ok: true });
  },
);

/* ─── GET /api/projects/:projectId/integrations/available — unlinked integrations ── */

router.get(
  "/projects/:projectId/integrations/available",
  requirePermission(Actions.ProjectRead),
  async (req: Request, res: Response) => {
    const orgId = res.locals.user?.orgId;
    const { projectId } = req.params;

    const project = await prisma.project.findFirst({
      where: { id: projectId, orgId },
    });
    if (!project) return res.status(404).json({ code: "PROJECT_NOT_FOUND" });

    // Get IDs of integrations already bound to this project
    const bound = await prisma.projectIntegration.findMany({
      where: { projectId },
      select: { integrationId: true },
    });
    const boundIds = bound.map((b) => b.integrationId);

    const available = await prisma.integration.findMany({
      where: { orgId, isActive: true, id: { notIn: boundIds } },
      select: { id: true, type: true, name: true, registryUrl: true, username: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    return res.json({ data: available });
  },
);

export default router;
