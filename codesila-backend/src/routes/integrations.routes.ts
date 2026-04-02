// src/routes/integrations.routes.ts
// GitHub OAuth, repo linking, webhook receiver, commit/build tracking,
// deployment targets — the layer that makes projects real.

import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { prisma } from "../infra/db";
import { requirePermission } from "../middlewares/requirePermission";
import { requireRole } from "../middlewares/requireRole";
import { authMiddleware } from "../middlewares/auth";
import { Actions } from "../modules/admin/rbac/permissions";
import { env } from "../config/env";
import { logSecurityEvent } from "../config/logger";
import { hmacSign, hmacVerify, encrypt, decrypt } from "../shared/security/encryption";
import { sanitizeString } from "../shared/utils/sanitize";
import { getInstallationToken, isAppAuthConfigured, listAppInstallations } from "../shared/github/appAuth";


const router = Router();

/* ─── helpers ────────────────────────────────────────────── */

function getOrgId(_req: Request, res: Response): string {
  const orgId = res.locals.user?.orgId as string | undefined;
  if (!orgId) throw new Error("Missing orgId");
  return orgId;
}

function getActorId(res: Response): string {
  const sub = res.locals.user?.sub as string | undefined;
  if (!sub) throw new Error("Missing sub");
  return sub;
}

/**
 * Get a usable GitHub API token.
 * Prefers App installation tokens (org-scoped, no personal dependency).
 * Falls back to the stored OAuth token if App credentials aren't configured.
 */
async function getGitHubToken(installation: { installationId: number | null; accessToken: string }): Promise<string> {
  if (isAppAuthConfigured() && installation.installationId) {
    return getInstallationToken(installation.installationId);
  }
  return decrypt(installation.accessToken);
}

/* ═══════════════════════════════════════════════════════════
   SECTION 1 — GITHUB OAUTH
   ═══════════════════════════════════════════════════════════ */

/**
 * GET /integrations/github/connect
 * Redirect user to GitHub to authorize the OAuth app.
 * Passes orgId + userId in state so callback can look them up.
 */
router.get("/github/connect", authMiddleware, requireRole("ADMIN", "SUPER_ADMIN"), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const actorId = getActorId(res);

    if (!env.GITHUB_CLIENT_ID) {
      return res.status(501).json({ error: "GitHub integration is not configured. Set GITHUB_CLIENT_ID." });
    }

    const state = Buffer.from(JSON.stringify({ orgId, actorId })).toString("base64url");
    // HMAC-sign the state to prevent CSRF/tampering
    const signature = hmacSign(state, env.OAUTH_STATE_SECRET);
    const signedState = `${state}.${signature}`;

    const scopes = "repo,read:org,admin:repo_hook,workflow";
    const url = `https://github.com/login/oauth/authorize?client_id=${env.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(env.GITHUB_CALLBACK_URL)}&scope=${scopes}&state=${signedState}`;

    return res.json({ url });
  } catch {
    return res.status(500).json({ error: "Failed to start GitHub connect" });
  }
});

/**
 * GET /integrations/github/callback
 * GitHub redirects here after user authorizes.
 * Exchanges code for token and stores installation.
 */
router.get("/github/callback", async (req, res) => {
  try {
    const { code, state, installation_id, setup_action } = req.query;

    if (!code) {
      return res.status(400).json({ error: "Missing authorization code" });
    }

    let orgId: string;
    let actorId: string;

    if (state) {
      // ── Flow A: OAuth initiated from our /github/connect endpoint ──
      const stateStr = String(state);
      const dotIndex = stateStr.lastIndexOf(".");
      if (dotIndex === -1) {
        logSecurityEvent({
          event: "OAUTH_STATE_TAMPERED",
          ip: req.ip,
          severity: "CRITICAL",
          details: { reason: "missing_signature" },
        });
        return res.status(400).json({ error: "Invalid state parameter" });
      }
      const stateData = stateStr.substring(0, dotIndex);
      const stateSig = stateStr.substring(dotIndex + 1);
      if (!hmacVerify(stateData, stateSig, env.OAUTH_STATE_SECRET)) {
        logSecurityEvent({
          event: "OAUTH_STATE_TAMPERED",
          ip: req.ip,
          severity: "CRITICAL",
          details: { reason: "signature_mismatch" },
        });
        return res.status(400).json({ error: "Invalid state parameter" });
      }
      const parsed = JSON.parse(Buffer.from(stateData, "base64url").toString());
      orgId = parsed.orgId;
      actorId = parsed.actorId;
    } else if (installation_id && setup_action === "install") {
      // ── Flow B: GitHub App installed directly from GitHub (public install) ──
      // No state parameter — resolve org + actor from the database.
      const defaultOrg = await prisma.organization.findFirst({ select: { id: true } });
      if (!defaultOrg) {
        return res.redirect(`${env.FRONTEND_URL}/devops?github=error&reason=no_org`);
      }
      const adminUser = await prisma.user.findFirst({
        where: { orgId: defaultOrg.id, role: "ADMIN" },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      if (!adminUser) {
        return res.redirect(`${env.FRONTEND_URL}/devops?github=error&reason=no_admin`);
      }
      orgId = defaultOrg.id;
      actorId = adminUser.id;
    } else {
      return res.status(400).json({ error: "Missing state or installation_id" });
    }

    // Exchange code for access token
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code: String(code),
        redirect_uri: env.GITHUB_CALLBACK_URL,
      }),
    });
    const tokenData = await tokenRes.json() as any;

    if (tokenData.error || !tokenData.access_token) {
      return res.status(400).json({ error: tokenData.error_description || "GitHub OAuth failed" });
    }

    // Get authenticated user info
    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/json" },
    });
    const ghUser = await userRes.json() as any;

    // Upsert installation record (encrypt access token at rest)
    const encryptedAccessToken = encrypt(tokenData.access_token);
    const encryptedRefreshToken = tokenData.refresh_token ? encrypt(tokenData.refresh_token) : null;
    let ghInstallationId = installation_id ? Number(installation_id) : null;

    // Auto-detect installation ID if the App is configured but no
    // installation_id came from the callback (normal OAuth flow).
    // When an App installation is found, prefer the org account login/avatar.
    let displayLogin: string = ghUser.login;
    let displayAvatar: string | null = ghUser.avatar_url ?? null;
    if (!ghInstallationId && isAppAuthConfigured()) {
      try {
        const installs = await listAppInstallations();
        // First try to match by OAuth user login
        let match = installs.find(
          (i) => i.account.login.toLowerCase() === ghUser.login?.toLowerCase()
        );
        // Prefer Organization-type installations for cohesion
        if (!match) {
          const orgInstalls = installs.filter((i) => i.account.type === "Organization");
          match = orgInstalls.length === 1 ? orgInstalls[0] : installs.length === 1 ? installs[0] : undefined;
        }
        if (match) {
          ghInstallationId = match.id;
          displayLogin = match.account.login;
          if (match.account.avatar_url) displayAvatar = match.account.avatar_url;
        }
      } catch { /* best-effort */ }
    }

    await prisma.gitHubInstallation.upsert({
      where: { orgId },
      create: {
        orgId,
        installationId: ghInstallationId,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        tokenExpiresAt: tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : null,
        githubLogin: displayLogin,
        avatarUrl: displayAvatar,
        scope: tokenData.scope ?? null,
        connectedById: actorId,
      },
      update: {
        installationId: ghInstallationId,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        tokenExpiresAt: tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : null,
        githubLogin: displayLogin,
        avatarUrl: displayAvatar,
        scope: tokenData.scope ?? null,
        connectedById: actorId,
      },
    });

    logSecurityEvent({
      event: "ADMIN_ACTION",
      userId: actorId,
      orgId,
      ip: req.ip,
      severity: "LOW",
      details: { action: "github_connected", githubLogin: ghUser.login, flow: state ? "oauth" : "app_install" },
    });

    // Redirect back to frontend
    return res.redirect(`${env.FRONTEND_URL}/devops?github=connected`);
  } catch (err: any) {
    console.error("GitHub callback error:", err);
    return res.redirect(`${env.FRONTEND_URL}/devops?github=error`);
  }
});

/**
 * GET /integrations/github/status
 * Returns current GitHub connection status for the org.
 */
router.get("/github/status", authMiddleware, requirePermission(Actions.ProjectRead), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const installation = await prisma.gitHubInstallation.findUnique({
      where: { orgId },
      select: {
        id: true,
        githubLogin: true,
        avatarUrl: true,
        scope: true,
        createdAt: true,
        updatedAt: true,
        connectedBy: { select: { id: true, email: true, name: true } },
        _count: { select: { repos: true } },
      },
    });

    return res.json({ connected: !!installation, installation });
  } catch {
    return res.status(500).json({ error: "Failed to check GitHub status" });
  }
});

/**
 * DELETE /integrations/github/disconnect
 * Disconnects GitHub — removes installation and all tracked repos.
 */
router.delete("/github/disconnect", authMiddleware, requireRole("ADMIN", "SUPER_ADMIN"), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    await prisma.gitHubInstallation.deleteMany({ where: { orgId } });
    return res.json({ message: "GitHub disconnected" });
  } catch {
    return res.status(500).json({ error: "Failed to disconnect GitHub" });
  }
});

/**
 * POST /integrations/github/detect-installation
 * Uses the App's JWT to find the installation on GitHub and store its ID.
 * Call this after the App has been installed on a GitHub org/user.
 */
router.post("/github/detect-installation", authMiddleware, requireRole("ADMIN", "SUPER_ADMIN"), async (req, res) => {
  try {
    if (!isAppAuthConfigured()) {
      return res.status(501).json({ error: "GitHub App credentials not configured" });
    }

    const orgId = getOrgId(req, res);
    const existing = await prisma.gitHubInstallation.findUnique({ where: { orgId } });

    const installs = await listAppInstallations();
    if (installs.length === 0) {
      return res.status(404).json({ error: "No GitHub App installations found. Install the App on your GitHub org first." });
    }

    // Try to match by the connected GitHub login, or prefer Organization accounts, or accept the only one
    let matched = existing?.githubLogin
      ? installs.find((i) => i.account.login.toLowerCase() === existing.githubLogin.toLowerCase())
      : null;
    if (!matched) {
      // Prefer Organization-type installations over personal accounts
      const orgInstalls = installs.filter((i) => i.account.type === "Organization");
      if (orgInstalls.length === 1) {
        matched = orgInstalls[0];
      } else if (installs.length === 1) {
        matched = installs[0];
      }
    }
    if (!matched) {
      // Return the list so the user can choose
      return res.status(404).json({
        error: "Could not auto-match installation. Available installations:",
        installations: installs.map((i) => ({ id: i.id, login: i.account.login, type: i.account.type })),
      });
    }

    if (existing) {
      await prisma.gitHubInstallation.update({
        where: { orgId },
        data: { installationId: matched.id, githubLogin: matched.account.login },
      });
    } else {
      // No OAuth record yet — create a minimal one (token will come from App)
      const actorId = getActorId(res);
      await prisma.gitHubInstallation.create({
        data: {
          orgId,
          installationId: matched.id,
          accessToken: encrypt("app-managed"), // placeholder — App tokens used instead
          githubLogin: matched.account.login,
          connectedById: actorId,
        },
      });
    }

    return res.json({
      message: "Installation detected",
      installationId: matched.id,
      githubLogin: matched.account.login,
    });
  } catch (err: any) {
    console.error("detect-installation error:", err);
    return res.status(500).json({ error: err.message || "Failed to detect installation" });
  }
});

/* ═══════════════════════════════════════════════════════════
   SECTION 2 — REPOSITORY LISTING + LINKING
   ═══════════════════════════════════════════════════════════ */

/**
 * GET /integrations/github/repos/available
 * Lists repos the connected GitHub user has access to.
 */
router.get("/github/repos/available", authMiddleware, requirePermission(Actions.ProjectCreate), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const installation = await prisma.gitHubInstallation.findUnique({ where: { orgId } });
    if (!installation) {
      return res.status(400).json({ error: "GitHub not connected. Connect first." });
    }

    // Get token — prefer installation token (org-scoped) over personal OAuth
    const ghToken = await getGitHubToken(installation);

    // If using App installation token, list repos the App can access.
    // If using personal OAuth token, list the user's repos.
    const repoUrl = (isAppAuthConfigured() && installation.installationId)
      ? "https://api.github.com/installation/repositories?per_page=100"
      : "https://api.github.com/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member";
    const ghRes = await fetch(repoUrl, {
      headers: { Authorization: `Bearer ${ghToken}`, Accept: "application/json" },
    });

    if (!ghRes.ok) {
      return res.status(502).json({ error: "Failed to fetch repos from GitHub" });
    }

    const raw = await ghRes.json() as any;
    // Installation endpoint wraps repos in { repositories: [...] }
    const repos: any[] = Array.isArray(raw) ? raw : (raw.repositories ?? []);

    // Already-linked repo IDs
    const linked = await prisma.gitHubRepo.findMany({
      where: { orgId },
      select: { githubRepoId: true },
    });
    const linkedSet = new Set(linked.map((r) => r.githubRepoId));

    return res.json(
      repos.map((r: any) => ({
        id: r.id,
        fullName: r.full_name,
        defaultBranch: r.default_branch,
        private: r.private,
        htmlUrl: r.html_url,
        description: r.description,
        language: r.language,
        pushedAt: r.pushed_at,
        linked: linkedSet.has(r.id),
      }))
    );
  } catch {
    return res.status(500).json({ error: "Failed to list available repos" });
  }
});

/**
 * POST /integrations/github/repos/link
 * Links a GitHub repo to a project and creates webhook for change tracking.
 */
router.post("/github/repos/link", authMiddleware, requirePermission(Actions.ProjectCreate), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const { projectId, githubRepoId, fullName, defaultBranch, private: isPrivate, htmlUrl } = req.body ?? {};

    if (!projectId || !githubRepoId || !fullName || !htmlUrl) {
      return res.status(400).json({ error: "projectId, githubRepoId, fullName, htmlUrl required" });
    }

    const installation = await prisma.gitHubInstallation.findUnique({ where: { orgId } });
    if (!installation) {
      return res.status(400).json({ error: "GitHub not connected" });
    }

    const project = await prisma.project.findFirst({ where: { id: projectId, orgId } });
    if (!project) return res.status(404).json({ error: "Project not found" });

    // Generate webhook secret
    const webhookSecret = crypto.randomBytes(32).toString("hex");

    // Create webhook on GitHub repo
    const ghTokenForHook = await getGitHubToken(installation);
    let webhookId: number | null = null;
    try {
      const [owner, repo] = fullName.split("/");
      const hookRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/hooks`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ghTokenForHook}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "web",
          active: true,
          events: ["push", "pull_request", "workflow_run", "check_run"],
          config: {
            url: `${env.GITHUB_CALLBACK_URL.replace("/github/callback", "")}/github/webhook`,
            content_type: "json",
            secret: webhookSecret,
            insecure_ssl: "0",
          },
        }),
      });

      if (hookRes.ok) {
        const hookData = (await hookRes.json()) as any;
        webhookId = hookData.id;
      }
    } catch {
      // Webhook creation failed — continue without it (user can still manually view)
    }

    const record = await prisma.gitHubRepo.create({
      data: {
        orgId,
        projectId,
        installationId: installation.id,
        githubRepoId,
        fullName,
        defaultBranch: defaultBranch || "main",
        private: isPrivate ?? false,
        htmlUrl,
        webhookId,
        webhookSecret,
      },
    });

    // Update project gitRepositoryUrl if not set
    if (!project.gitRepositoryUrl) {
      await prisma.project.update({
        where: { id: projectId },
        data: { gitRepositoryUrl: htmlUrl, defaultBranch: defaultBranch || "main" },
      });
    }

    return res.status(201).json(record);
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.status(409).json({ error: "This repo is already linked to this project" });
    }
    console.error("repo.link error", err);
    return res.status(500).json({ error: "Failed to link repo" });
  }
});

/**
 * GET /integrations/github/repos?projectId=
 * Lists linked repos, optionally filtered by project.
 */
router.get("/github/repos", authMiddleware, requirePermission(Actions.ProjectRead), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const projectId = req.query.projectId ? String(req.query.projectId) : undefined;

    const repos = await prisma.gitHubRepo.findMany({
      where: { orgId, ...(projectId ? { projectId } : {}) },
      include: {
        project: { select: { id: true, name: true, key: true } },
        _count: { select: { commits: true, builds: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(repos);
  } catch {
    return res.status(500).json({ error: "Failed to list linked repos" });
  }
});

/**
 * DELETE /integrations/github/repos/:repoId
 * Unlinks a repo and removes webhook.
 */
router.delete("/github/repos/:repoId", authMiddleware, requirePermission(Actions.ProjectCreate), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const { repoId } = req.params;

    const repo = await prisma.gitHubRepo.findFirst({
      where: { id: repoId, orgId },
      include: { installation: { select: { installationId: true, accessToken: true } } },
    });
    if (!repo) return res.status(404).json({ error: "Repo not found" });

    // Try to remove webhook from GitHub
    if (repo.webhookId) {
      try {
        const [owner, repoName] = repo.fullName.split("/");
        const ghTokenForDelete = await getGitHubToken(repo.installation);
        await fetch(`https://api.github.com/repos/${owner}/${repoName}/hooks/${repo.webhookId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${ghTokenForDelete}`, Accept: "application/json" },
        });
      } catch { /* best-effort */ }
    }

    await prisma.gitHubRepo.delete({ where: { id: repoId } });
    return res.json({ message: "Repo unlinked" });
  } catch {
    return res.status(500).json({ error: "Failed to unlink repo" });
  }
});

/* ═══════════════════════════════════════════════════════════
   SECTION 3 — WEBHOOK RECEIVER (push/PR/build events)
   ═══════════════════════════════════════════════════════════ */

/**
 * POST /integrations/github/webhook
 * Receives GitHub webhooks: push, pull_request, workflow_run, check_run.
 * NO AUTH MIDDLEWARE — uses signature verification instead.
 */
router.post("/github/webhook", async (req: Request, res: Response) => {
  try {
    const event = req.headers["x-github-event"] as string;
    const signature = req.headers["x-hub-signature-256"] as string;
    const delivery = req.headers["x-github-delivery"] as string;
    const body = req.body;

    if (!event || !body) {
      return res.status(400).json({ error: "Missing event data" });
    }

    // Determine which repo this belongs to
    const ghRepoId = body.repository?.id;
    if (!ghRepoId) return res.status(200).json({ message: "No repo context, ignoring" });

    const trackedRepo = await prisma.gitHubRepo.findFirst({
      where: { githubRepoId: ghRepoId },
      include: { project: { select: { id: true, orgId: true, name: true, chatRoom: { select: { id: true } } } } },
    });

    if (!trackedRepo) {
      return res.status(200).json({ message: "Repo not tracked, ignoring" });
    }

    // Verify webhook signature — MANDATORY when secret is set
    if (trackedRepo.webhookSecret) {
      if (!signature) {
        logSecurityEvent({
          event: "WEBHOOK_SIGNATURE_MISSING",
          severity: "CRITICAL",
          details: { repoId: trackedRepo.id, fullName: trackedRepo.fullName, delivery },
        });
        return res.status(401).json({ error: "Missing webhook signature" });
      }
      const expected = "sha256=" + crypto.createHmac("sha256", trackedRepo.webhookSecret).update(JSON.stringify(body)).digest("hex");
      if (expected.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        logSecurityEvent({
          event: "WEBHOOK_SIGNATURE_INVALID",
          severity: "CRITICAL",
          details: { repoId: trackedRepo.id, fullName: trackedRepo.fullName, delivery },
        });
        return res.status(401).json({ error: "Invalid signature" });
      }
    }

    const orgId = trackedRepo.orgId;
    const projectId = trackedRepo.projectId;

    /* ─── PUSH event → track commits ─── */
    if (event === "push" && trackedRepo.trackPushes) {
      const commits = body.commits ?? [];
      const branch = (body.ref ?? "").replace("refs/heads/", "");

      const commitData = commits.map((c: any) => ({
        orgId,
        repoId: trackedRepo.id,
        sha: c.id,
        message: c.message?.substring(0, 500) ?? "",
        authorName: c.author?.name ?? "unknown",
        authorEmail: c.author?.email ?? "",
        authorAvatar: body.sender?.avatar_url ?? null,
        branch,
        url: c.url ?? "",
        additions: c.added?.length ?? 0,
        deletions: c.removed?.length ?? 0,
        filesChanged: (c.added?.length ?? 0) + (c.modified?.length ?? 0) + (c.removed?.length ?? 0),
        timestamp: c.timestamp ? new Date(c.timestamp) : new Date(),
      }));

      if (commitData.length > 0) {
        await prisma.gitCommit.createMany({ data: commitData, skipDuplicates: true });

        // Auto-trigger pipeline execution for push events (TC-GIT-03)
        const latestPipeline = await prisma.pipeline.findFirst({
          where: { projectId },
          orderBy: { createdAt: "desc" },
        });
        if (latestPipeline) {
          await prisma.pipelineRun.create({
            data: {
              pipelineId: latestPipeline.id,
              status: "QUEUED",
              branch,
              commitSha: commits[commits.length - 1]?.id ?? "",
            },
          });
        }

        // Notify project chat about new commits
        if (trackedRepo.project.chatRoom) {
          const participants = await prisma.chatParticipant.findMany({
            where: { roomId: trackedRepo.project.chatRoom.id },
            select: { userId: true },
          });

          // Create a system message in the project chat
          const header = `📝 ${commits.length} new commit${commits.length > 1 ? "s" : ""} pushed to **${branch}**`;
          const details = commits.slice(0, 3).map((c: any) => `\`${c.id.substring(0, 7)}\` ${c.message?.split("\n")[0]?.substring(0, 80) ?? ""}`).join("\n");
          const content = `${header}\n${details}${commits.length > 3 ? `\n... and ${commits.length - 3} more` : ""}`;

          await prisma.chatMessage.create({
            data: {
              roomId: trackedRepo.project.chatRoom.id,
              senderId: (await prisma.projectMember.findFirst({ where: { projectId }, orderBy: { createdAt: "asc" }, select: { userId: true } }))?.userId ?? "",
              content: `[System] ${content}`,
            },
          });
        }
      }
    }

    /* ─── WORKFLOW_RUN event → track CI builds ─── */
    if (event === "workflow_run" && trackedRepo.trackBuilds) {
      const run = body.workflow_run;
      if (run) {
        const statusMap: Record<string, string> = {
          queued: "PENDING",
          in_progress: "IN_PROGRESS",
          completed: "SUCCESS",
        };
        let status: any = statusMap[run.status] ?? "PENDING";
        if (run.conclusion === "failure") status = "FAILURE";
        if (run.conclusion === "cancelled") status = "CANCELLED";

        await prisma.cIBuild.upsert({
          where: {
            repoId_runId: { repoId: trackedRepo.id, runId: run.id },
          },
          create: {
            orgId,
            repoId: trackedRepo.id,
            projectId,
            runId: run.id,
            workflowName: run.name ?? null,
            branch: run.head_branch ?? "unknown",
            commitSha: run.head_sha ?? "",
            status,
            conclusion: run.conclusion ?? null,
            htmlUrl: run.html_url ?? null,
            startedAt: run.run_started_at ? new Date(run.run_started_at) : null,
            completedAt: run.updated_at && run.conclusion ? new Date(run.updated_at) : null,
            durationSecs: run.run_started_at && run.updated_at && run.conclusion
              ? Math.floor((new Date(run.updated_at).getTime() - new Date(run.run_started_at).getTime()) / 1000)
              : null,
            triggeredBy: run.event ?? null,
            errorMessage: run.conclusion === "failure" ? `Workflow "${run.name}" failed` : null,
          },
          update: {
            status,
            conclusion: run.conclusion ?? null,
            completedAt: run.updated_at && run.conclusion ? new Date(run.updated_at) : null,
            durationSecs: run.run_started_at && run.updated_at && run.conclusion
              ? Math.floor((new Date(run.updated_at).getTime() - new Date(run.run_started_at).getTime()) / 1000)
              : null,
            errorMessage: run.conclusion === "failure" ? `Workflow "${run.name}" failed` : null,
          },
        });

        // Notify project chat about build status changes
        if (trackedRepo.project.chatRoom && run.conclusion) {
          const icon = run.conclusion === "success" ? "✅" : run.conclusion === "failure" ? "❌" : "⚠️";
          const content = `[System] ${icon} Build **${run.name}** on \`${run.head_branch}\` — ${run.conclusion.toUpperCase()}`;

          await prisma.chatMessage.create({
            data: {
              roomId: trackedRepo.project.chatRoom.id,
              senderId: (await prisma.projectMember.findFirst({ where: { projectId }, orderBy: { createdAt: "asc" }, select: { userId: true } }))?.userId ?? "",
              content,
            },
          });
        }
      }
    }

    return res.status(200).json({ message: "Webhook processed", event, delivery });
  } catch (err) {
    console.error("Webhook processing error:", err);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
});

/* ═══════════════════════════════════════════════════════════
   SECTION 4 — SYNC (pull commits from GitHub API + fix webhook)
   ═══════════════════════════════════════════════════════════ */

/**
 * POST /integrations/github/repos/:repoId/sync
 * Pulls recent commits from GitHub API and re-creates webhook if missing.
 */
router.post("/github/repos/:repoId/sync", authMiddleware, requirePermission(Actions.ProjectCreate), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const { repoId } = req.params;

    const repo = await prisma.gitHubRepo.findFirst({
      where: { id: repoId, orgId },
      include: { installation: { select: { installationId: true, accessToken: true } } },
    });
    if (!repo) return res.status(404).json({ error: "Repo not found" });

    const token = await getGitHubToken(repo.installation);
    const [owner, repoName] = repo.fullName.split("/");

    // 1. Re-create webhook if missing
    let webhookFixed = false;
    if (!repo.webhookId) {
      try {
        const webhookSecret = repo.webhookSecret || crypto.randomBytes(32).toString("hex");
        const hookRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/hooks`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: "web",
            active: true,
            events: ["push", "pull_request", "workflow_run", "check_run"],
            config: {
              url: `${env.GITHUB_CALLBACK_URL.replace("/github/callback", "")}/github/webhook`,
              content_type: "json",
              secret: webhookSecret,
              insecure_ssl: "0",
            },
          }),
        });
        if (hookRes.ok) {
          const hookData = (await hookRes.json()) as any;
          await prisma.gitHubRepo.update({
            where: { id: repoId },
            data: { webhookId: hookData.id, webhookSecret },
          });
          webhookFixed = true;
        }
      } catch { /* best-effort */ }
    }

    // 2. Fetch recent commits from GitHub API
    const commitsRes = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/commits?sha=${repo.defaultBranch}&per_page=50`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
    );
    if (!commitsRes.ok) {
      return res.status(502).json({ error: "Failed to fetch commits from GitHub" });
    }
    const ghCommits = (await commitsRes.json()) as any[];

    // 3. Store commits (skip duplicates)
    const commitData = ghCommits.map((c: any) => ({
      orgId,
      repoId,
      sha: c.sha,
      message: (c.commit?.message || "").substring(0, 500),
      authorName: c.commit?.author?.name || "unknown",
      authorEmail: c.commit?.author?.email || "",
      authorAvatar: c.author?.avatar_url || null,
      branch: repo.defaultBranch,
      url: c.html_url || "",
      additions: c.stats?.additions ?? 0,
      deletions: c.stats?.deletions ?? 0,
      filesChanged: (c.files?.length) ?? 0,
      timestamp: c.commit?.author?.date ? new Date(c.commit.author.date) : new Date(),
    }));

    if (commitData.length > 0) {
      await prisma.gitCommit.createMany({ data: commitData, skipDuplicates: true });
    }

    // 4. Fetch recent workflow runs
    let buildsImported = 0;
    try {
      const runsRes = await fetch(
        `https://api.github.com/repos/${owner}/${repoName}/actions/runs?per_page=20`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
      );
      if (runsRes.ok) {
        const runsData = (await runsRes.json()) as any;
        const runs = runsData.workflow_runs || [];
        for (const run of runs) {
          const statusMap: Record<string, string> = {
            queued: "PENDING", in_progress: "IN_PROGRESS", completed: "SUCCESS",
          };
          const conclusionMap: Record<string, string> = {
            success: "SUCCESS", failure: "FAILURE", cancelled: "CANCELLED",
            timed_out: "FAILURE", action_required: "PENDING",
          };
          let status = statusMap[run.status] || "PENDING";
          if (run.status === "completed" && run.conclusion) {
            status = conclusionMap[run.conclusion] || "SUCCESS";
          }
          const startedAt = run.run_started_at ? new Date(run.run_started_at) : null;
          const completedAt = run.updated_at && run.status === "completed" ? new Date(run.updated_at) : null;
          const durationSecs = startedAt && completedAt
            ? Math.round((completedAt.getTime() - startedAt.getTime()) / 1000) : null;

          await prisma.cIBuild.upsert({
            where: { repoId_runId: { repoId, runId: run.id } },
            create: {
              orgId,
              repoId,
              projectId: repo.projectId,
              runId: run.id,
              workflowName: run.name || "workflow",
              branch: run.head_branch || repo.defaultBranch,
              commitSha: run.head_sha || "",
              status: status as any,
              conclusion: run.conclusion || null,
              htmlUrl: run.html_url || "",
              startedAt,
              completedAt,
              durationSecs,
              triggeredBy: run.triggering_actor?.login || null,
            },
            update: {
              status: status as any,
              conclusion: run.conclusion || null,
              completedAt,
              durationSecs,
            },
          });
          buildsImported++;
        }
      }
    } catch { /* best-effort */ }

    return res.json({
      message: "Sync complete",
      commitsImported: commitData.length,
      buildsImported,
      webhookFixed,
    });
  } catch (err: any) {
    console.error("Sync error:", err);
    return res.status(500).json({ error: "Sync failed" });
  }
});

/* ═══════════════════════════════════════════════════════════
   SECTION 5 — COMMIT + BUILD QUERIES
   ═══════════════════════════════════════════════════════════ */

/**
 * GET /integrations/commits?projectId=&repoId=&branch=&limit=
 */
router.get("/commits", authMiddleware, requirePermission(Actions.ProjectRead), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const projectId = req.query.projectId ? String(req.query.projectId) : undefined;
    const repoId = req.query.repoId ? String(req.query.repoId) : undefined;
    const branch = req.query.branch ? String(req.query.branch) : undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    // Build filter — if projectId given, find repo IDs for that project
    let repoFilter: string[] | undefined;
    if (projectId) {
      const repos = await prisma.gitHubRepo.findMany({ where: { orgId, projectId }, select: { id: true } });
      repoFilter = repos.map((r) => r.id);
    } else if (repoId) {
      repoFilter = [repoId];
    }

    const commits = await prisma.gitCommit.findMany({
      where: {
        orgId,
        ...(repoFilter ? { repoId: { in: repoFilter } } : {}),
        ...(branch ? { branch } : {}),
      },
      include: {
        repo: { select: { fullName: true, htmlUrl: true, project: { select: { id: true, name: true, key: true } } } },
      },
      orderBy: { timestamp: "desc" },
      take: limit,
    });

    return res.json(commits);
  } catch {
    return res.status(500).json({ error: "Failed to load commits" });
  }
});

/**
 * GET /integrations/builds?projectId=&repoId=&status=&limit=
 */
router.get("/builds", authMiddleware, requirePermission(Actions.ProjectRead), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const projectId = req.query.projectId ? String(req.query.projectId) : undefined;
    const repoId = req.query.repoId ? String(req.query.repoId) : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const builds = await prisma.cIBuild.findMany({
      where: {
        orgId,
        ...(projectId ? { projectId } : {}),
        ...(repoId ? { repoId } : {}),
        ...(status ? { status: status as any } : {}),
      },
      include: {
        repo: { select: { fullName: true, htmlUrl: true } },
        project: { select: { id: true, name: true, key: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return res.json(builds);
  } catch {
    return res.status(500).json({ error: "Failed to load builds" });
  }
});

/* ═══════════════════════════════════════════════════════════
   SECTION 5 — DEPLOYMENT TARGETS
   ═══════════════════════════════════════════════════════════ */

/**
 * GET /integrations/targets?projectId=
 */
router.get("/targets", authMiddleware, requirePermission(Actions.ProjectRead), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const projectId = req.query.projectId ? String(req.query.projectId) : undefined;

    const targets = await prisma.deploymentTarget.findMany({
      where: { orgId, ...(projectId ? { projectId } : {}) },
      include: {
        project: { select: { id: true, name: true, key: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(targets);
  } catch {
    return res.status(500).json({ error: "Failed to load deployment targets" });
  }
});

/**
 * POST /integrations/targets
 * Define where a project deploys to.
 */
router.post("/targets", authMiddleware, requirePermission(Actions.ProjectCreate), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const { projectId, environment, provider, name, url, region, configJson } = req.body ?? {};

    if (!projectId || !environment || !name) {
      return res.status(400).json({ error: "projectId, environment, name required" });
    }

    const project = await prisma.project.findFirst({ where: { id: projectId, orgId } });
    if (!project) return res.status(404).json({ error: "Project not found" });

    const target = await prisma.deploymentTarget.create({
      data: {
        orgId,
        projectId,
        environment: environment as any,
        provider: provider || "CUSTOM",
        name,
        url: url || null,
        region: region || null,
        configJson: configJson || null,
      },
    });

    return res.status(201).json(target);
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.status(409).json({ error: "A target with this name already exists for this environment" });
    }
    return res.status(500).json({ error: "Failed to create deployment target" });
  }
});

/**
 * PATCH /integrations/targets/:targetId
 */
router.patch("/targets/:targetId", authMiddleware, requirePermission(Actions.ProjectCreate), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const { targetId } = req.params;
    const { name, url, region, provider, configJson, lastDeployAt, lastStatus } = req.body ?? {};

    const existing = await prisma.deploymentTarget.findFirst({ where: { id: targetId, orgId } });
    if (!existing) return res.status(404).json({ error: "Target not found" });

    const target = await prisma.deploymentTarget.update({
      where: { id: targetId },
      data: {
        ...(name ? { name } : {}),
        ...(url !== undefined ? { url } : {}),
        ...(region !== undefined ? { region } : {}),
        ...(provider ? { provider } : {}),
        ...(configJson !== undefined ? { configJson } : {}),
        ...(lastDeployAt ? { lastDeployAt: new Date(lastDeployAt) } : {}),
        ...(lastStatus ? { lastStatus } : {}),
      },
    });

    return res.json(target);
  } catch {
    return res.status(500).json({ error: "Failed to update target" });
  }
});

/**
 * DELETE /integrations/targets/:targetId
 */
router.delete("/targets/:targetId", authMiddleware, requirePermission(Actions.ProjectCreate), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const { targetId } = req.params;

    const existing = await prisma.deploymentTarget.findFirst({ where: { id: targetId, orgId } });
    if (!existing) return res.status(404).json({ error: "Target not found" });

    await prisma.deploymentTarget.delete({ where: { id: targetId } });
    return res.json({ message: "Target deleted" });
  } catch {
    return res.status(500).json({ error: "Failed to delete target" });
  }
});

export default router;
