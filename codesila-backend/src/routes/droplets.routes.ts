// src/routes/droplets.routes.ts
// Manage DigitalOcean droplets, SSH keys, VS Code Remote SSH config,
// and GitHub SSH authentication on droplets.

import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { prisma } from "../infra/db";
import { requirePermission } from "../middlewares/requirePermission";
import { authMiddleware } from "../middlewares/auth";
import { Actions } from "../modules/admin/rbac/permissions";
import { env } from "../config/env";

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

/** Call the DigitalOcean API */
async function doFetch(path: string, options: RequestInit = {}): Promise<globalThis.Response> {
  if (!env.DO_API_TOKEN) throw new Error("DO_API_TOKEN not configured");
  return fetch(`https://api.digitalocean.com/v2${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.DO_API_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers ?? {}),
    },
  });
}

/** Execute a command on a remote droplet via DigitalOcean API (using user data / cloud-init isn't ideal for runtime commands,
 *  but we can use SSH or the DO API actions). For now we track state locally and provide scripts. */

/* ═══════════════════════════════════════════════════════════
   SECTION 1 — DROPLET CRUD (register existing droplets)
   ═══════════════════════════════════════════════════════════ */

/**
 * POST /droplets
 * Register an existing DigitalOcean droplet (user already created it).
 * Requires: name, ipAddress. Optional: dropletId, region, size, sshUser, sshPort, projectId, tags
 */
router.post("/", authMiddleware, requirePermission(Actions.IntegrationManage), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const actorId = getActorId(res);
    const { name, ipAddress, dropletId, region, size, image, sshUser, sshPort, projectId, tags } = req.body ?? {};

    if (!name || !ipAddress) {
      return res.status(400).json({ error: "name and ipAddress are required" });
    }

    // Validate IP format (basic)
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ipAddress)) {
      return res.status(400).json({ error: "Invalid IP address format" });
    }

    // If projectId provided, verify it belongs to this org
    if (projectId) {
      const proj = await prisma.project.findFirst({ where: { id: projectId, orgId } });
      if (!proj) return res.status(404).json({ error: "Project not found" });
    }

    const droplet = await prisma.droplet.create({
      data: {
        orgId,
        name: name.trim(),
        ipAddress: ipAddress.trim(),
        dropletId: dropletId ? String(dropletId) : null,
        region: region || "nyc3",
        size: size || "s-1vcpu-1gb",
        image: image || "ubuntu-22-04-x64",
        sshUser: sshUser || "root",
        sshPort: sshPort || 22,
        projectId: projectId || null,
        tags: tags || null,
        status: "ACTIVE",
        createdById: actorId,
      },
    });

    return res.status(201).json(droplet);
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.status(409).json({ error: "A droplet with this name already exists in your organization" });
    }
    console.error("droplet.create error:", err);
    return res.status(500).json({ error: err.message || "Failed to register droplet" });
  }
});

/**
 * GET /droplets
 * List all registered droplets for the org.
 */
router.get("/", authMiddleware, requirePermission(Actions.DeploymentRead), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const projectId = req.query.projectId ? String(req.query.projectId) : undefined;

    const droplets = await prisma.droplet.findMany({
      where: { orgId, ...(projectId ? { projectId } : {}) },
      include: {
        project: { select: { id: true, name: true, key: true } },
        createdBy: { select: { id: true, email: true, name: true } },
        _count: { select: { sshKeys: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(droplets);
  } catch {
    return res.status(500).json({ error: "Failed to list droplets" });
  }
});

/**
 * GET /droplets/:id
 * Get a single droplet with its SSH keys.
 */
router.get("/:id", authMiddleware, requirePermission(Actions.DeploymentRead), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const droplet = await prisma.droplet.findFirst({
      where: { id: req.params.id, orgId },
      include: {
        project: { select: { id: true, name: true, key: true } },
        createdBy: { select: { id: true, email: true, name: true } },
        sshKeys: {
          select: { id: true, label: true, fingerprint: true, addedToDroplet: true, userId: true, createdAt: true,
                    user: { select: { id: true, email: true, name: true } } },
        },
      },
    });
    if (!droplet) return res.status(404).json({ error: "Droplet not found" });
    return res.json(droplet);
  } catch {
    return res.status(500).json({ error: "Failed to get droplet" });
  }
});

/**
 * PATCH /droplets/:id
 * Update droplet info (name, ip, project, status, etc).
 */
router.patch("/:id", authMiddleware, requirePermission(Actions.IntegrationManage), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const { id } = req.params;
    const { name, ipAddress, sshUser, sshPort, projectId, tags, status, githubConnected, vscodeReady } = req.body ?? {};

    const existing = await prisma.droplet.findFirst({ where: { id, orgId } });
    if (!existing) return res.status(404).json({ error: "Droplet not found" });

    const droplet = await prisma.droplet.update({
      where: { id },
      data: {
        ...(name ? { name: name.trim() } : {}),
        ...(ipAddress ? { ipAddress: ipAddress.trim() } : {}),
        ...(sshUser ? { sshUser } : {}),
        ...(sshPort !== undefined ? { sshPort } : {}),
        ...(projectId !== undefined ? { projectId: projectId || null } : {}),
        ...(tags !== undefined ? { tags } : {}),
        ...(status ? { status } : {}),
        ...(githubConnected !== undefined ? { githubConnected } : {}),
        ...(vscodeReady !== undefined ? { vscodeReady } : {}),
      },
    });

    return res.json(droplet);
  } catch {
    return res.status(500).json({ error: "Failed to update droplet" });
  }
});

/**
 * DELETE /droplets/:id
 * Remove a droplet registration (does NOT destroy the actual DO droplet).
 */
router.delete("/:id", authMiddleware, requirePermission(Actions.IntegrationManage), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const existing = await prisma.droplet.findFirst({ where: { id: req.params.id, orgId } });
    if (!existing) return res.status(404).json({ error: "Droplet not found" });

    await prisma.droplet.delete({ where: { id: req.params.id } });
    return res.json({ message: "Droplet removed" });
  } catch {
    return res.status(500).json({ error: "Failed to delete droplet" });
  }
});

/* ═══════════════════════════════════════════════════════════
   SECTION 2 — SSH KEY MANAGEMENT
   ═══════════════════════════════════════════════════════════ */

/**
 * POST /droplets/:id/ssh-keys
 * Add an SSH public key for a user to access this droplet.
 */
router.post("/:id/ssh-keys", authMiddleware, requirePermission(Actions.IntegrationManage), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const actorId = getActorId(res);
    const { id: dropletId } = req.params;
    const { label, publicKey } = req.body ?? {};

    if (!label || !publicKey) {
      return res.status(400).json({ error: "label and publicKey are required" });
    }

    const droplet = await prisma.droplet.findFirst({ where: { id: dropletId, orgId } });
    if (!droplet) return res.status(404).json({ error: "Droplet not found" });

    // Generate fingerprint from public key
    const keyParts = publicKey.trim().split(/\s+/);
    const keyData = keyParts.length >= 2 ? keyParts[1] : keyParts[0];
    const hash = crypto.createHash("sha256").update(Buffer.from(keyData, "base64")).digest("base64").replace(/=+$/, "");
    const fingerprint = `SHA256:${hash}`;

    const sshKey = await prisma.dropletSSHKey.create({
      data: {
        orgId,
        dropletId,
        userId: actorId,
        label: label.trim(),
        publicKey: publicKey.trim(),
        fingerprint,
        addedToDroplet: false,
      },
    });

    return res.status(201).json(sshKey);
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.status(409).json({ error: "This SSH key is already registered for this droplet" });
    }
    return res.status(500).json({ error: "Failed to add SSH key" });
  }
});

/**
 * DELETE /droplets/:dropletId/ssh-keys/:keyId
 * Remove an SSH key from a droplet.
 */
router.delete("/:dropletId/ssh-keys/:keyId", authMiddleware, requirePermission(Actions.IntegrationManage), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const key = await prisma.dropletSSHKey.findFirst({
      where: { id: req.params.keyId, dropletId: req.params.dropletId, orgId },
    });
    if (!key) return res.status(404).json({ error: "SSH key not found" });

    await prisma.dropletSSHKey.delete({ where: { id: req.params.keyId } });
    return res.json({ message: "SSH key removed" });
  } catch {
    return res.status(500).json({ error: "Failed to remove SSH key" });
  }
});

/* ═══════════════════════════════════════════════════════════
   SECTION 3 — VS CODE REMOTE SSH CONFIG
   ═══════════════════════════════════════════════════════════ */

/**
 * GET /droplets/:id/vscode-config
 * Returns an SSH config block and a one-click VS Code deep link
 * for opening the droplet via the Remote-SSH extension.
 */
router.get("/:id/vscode-config", authMiddleware, requirePermission(Actions.DeploymentRead), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const droplet = await prisma.droplet.findFirst({
      where: { id: req.params.id, orgId },
      include: { project: { select: { name: true, key: true } } },
    });
    if (!droplet) return res.status(404).json({ error: "Droplet not found" });

    const hostAlias = `codesila-${droplet.name}`.replace(/[^a-zA-Z0-9_-]/g, "-");

    // SSH config block to add to ~/.ssh/config
    const sshConfig = [
      `Host ${hostAlias}`,
      `  HostName ${droplet.ipAddress}`,
      `  User ${droplet.sshUser}`,
      `  Port ${droplet.sshPort}`,
      `  ForwardAgent yes`,
      `  StrictHostKeyChecking no`,
      `  ServerAliveInterval 60`,
      `  ServerAliveCountMax 3`,
    ].join("\n");

    // VS Code deep link (opens Remote-SSH directly)
    const vscodeUri = `vscode://vscode-remote/ssh-remote+${hostAlias}/home/${droplet.sshUser}`;

    // Shell script to auto-configure SSH
    const setupScript = [
      `#!/bin/bash`,
      `# CodeSila — Auto-configure SSH for VS Code Remote`,
      `# Run this on your LOCAL machine.`,
      ``,
      `SSH_CONFIG="$HOME/.ssh/config"`,
      `MARKER="# >>> CodeSila: ${hostAlias}"`,
      `END_MARKER="# <<< CodeSila: ${hostAlias}"`,
      ``,
      `# Remove old entry if exists`,
      `if grep -q "$MARKER" "$SSH_CONFIG" 2>/dev/null; then`,
      `  sed -i "/$MARKER/,/$END_MARKER/d" "$SSH_CONFIG"`,
      `fi`,
      ``,
      `# Append new config`,
      `cat >> "$SSH_CONFIG" << 'EOF'`,
      `$MARKER`,
      sshConfig,
      `$END_MARKER`,
      `EOF`,
      ``,
      `chmod 600 "$SSH_CONFIG"`,
      `echo "✅ SSH config updated for ${hostAlias}"`,
      `echo "You can now open VS Code with: code --remote ssh-remote+${hostAlias} /home/${droplet.sshUser}"`,
    ].join("\n");

    // CLI command to open VS Code directly
    const cliCommand = `code --remote ssh-remote+${hostAlias} /home/${droplet.sshUser}`;

    return res.json({
      hostAlias,
      sshConfig,
      vscodeUri,
      cliCommand,
      setupScript,
      droplet: {
        id: droplet.id,
        name: droplet.name,
        ipAddress: droplet.ipAddress,
        sshUser: droplet.sshUser,
        sshPort: droplet.sshPort,
        project: droplet.project,
      },
    });
  } catch (err) {
    console.error("vscode-config error:", err);
    return res.status(500).json({ error: "Failed to generate VS Code config" });
  }
});

/* ═══════════════════════════════════════════════════════════
   SECTION 4 — GITHUB SSH SETUP ON DROPLET
   ═══════════════════════════════════════════════════════════ */

/**
 * POST /droplets/:id/setup-github
 * Returns a setup script that configures GitHub SSH access on the droplet.
 * This sets up SSH key generation + adds it to the GitHub account using a token,
 * and configures git globally.
 *
 * Expects: { githubToken: string } — a GitHub personal access token with admin:public_key scope
 */
router.post("/:id/setup-github", authMiddleware, requirePermission(Actions.IntegrationManage), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const droplet = await prisma.droplet.findFirst({ where: { id: req.params.id, orgId } });
    if (!droplet) return res.status(404).json({ error: "Droplet not found" });

    const { githubToken, gitName, gitEmail } = req.body ?? {};

    // If we have the org's GitHub installation token, we can use it for API calls
    let token = githubToken;
    if (!token) {
      const installation = await prisma.gitHubInstallation.findUnique({ where: { orgId } });
      if (installation) {
        token = installation.accessToken;
      }
    }

    if (!token) {
      return res.status(400).json({
        error: "Either provide a GitHub personal access token (admin:public_key scope) or connect GitHub to your org first.",
      });
    }

    const keyLabel = `codesila-${droplet.name}-${Date.now()}`;

    // Script to run ON the droplet (via SSH)
    const setupScript = [
      `#!/bin/bash`,
      `set -e`,
      ``,
      `echo "🔧 CodeSila — Setting up GitHub SSH on this droplet..."`,
      ``,
      `# 1. Generate SSH key for GitHub (if not exists)`,
      `GITHUB_KEY="$HOME/.ssh/github_codesila"`,
      `if [ ! -f "$GITHUB_KEY" ]; then`,
      `  ssh-keygen -t ed25519 -C "${keyLabel}" -f "$GITHUB_KEY" -N ""`,
      `  echo "✅ SSH key generated: $GITHUB_KEY"`,
      `else`,
      `  echo "ℹ️  SSH key already exists: $GITHUB_KEY"`,
      `fi`,
      ``,
      `# 2. Configure SSH to use this key for GitHub`,
      `SSH_CONFIG="$HOME/.ssh/config"`,
      `if ! grep -q "Host github.com" "$SSH_CONFIG" 2>/dev/null; then`,
      `  cat >> "$SSH_CONFIG" << 'SSHEOF'`,
      ``,
      `Host github.com`,
      `  HostName github.com`,
      `  User git`,
      `  IdentityFile ~/.ssh/github_codesila`,
      `  IdentitiesOnly yes`,
      `SSHEOF`,
      `  chmod 600 "$SSH_CONFIG"`,
      `  echo "✅ SSH config updated for github.com"`,
      `fi`,
      ``,
      `# 3. Add public key to GitHub via API`,
      `PUB_KEY=$(cat "$GITHUB_KEY.pub")`,
      `echo "📤 Adding SSH key to GitHub..."`,
      `RESPONSE=$(curl -s -w "\\n%{http_code}" -X POST https://api.github.com/user/keys \\`,
      `  -H "Authorization: Bearer ${token}" \\`,
      `  -H "Accept: application/vnd.github+json" \\`,
      `  -d "{\\"title\\":\\"${keyLabel}\\",\\"key\\":\\"$PUB_KEY\\"}")`,
      `HTTP_CODE=$(echo "$RESPONSE" | tail -1)`,
      `BODY=$(echo "$RESPONSE" | head -n -1)`,
      ``,
      `if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "422" ]; then`,
      `  echo "✅ SSH key registered with GitHub"`,
      `else`,
      `  echo "⚠️  GitHub API response ($HTTP_CODE): $BODY"`,
      `fi`,
      ``,
      `# 4. Configure git globally`,
      ...(gitName ? [`git config --global user.name "${gitName}"`] : []),
      ...(gitEmail ? [`git config --global user.email "${gitEmail}"`] : []),
      ``,
      `# 5. Test GitHub SSH connection`,
      `echo "🔑 Testing GitHub SSH connection..."`,
      `ssh -T git@github.com -o StrictHostKeyChecking=accept-new 2>&1 || true`,
      ``,
      `# 6. Install useful tools for VS Code + Copilot`,
      `echo "📦 Installing development tools..."`,
      `if command -v apt-get &> /dev/null; then`,
      `  apt-get update -qq`,
      `  apt-get install -y -qq git curl wget unzip jq htop 2>/dev/null || true`,
      `fi`,
      ``,
      `# 7. Ensure git credential helper is set for HTTPS fallback`,
      `git config --global credential.helper store`,
      ``,
      `echo ""`,
      `echo "✅ GitHub SSH setup complete!"`,
      `echo "   You can now clone repos with:  git clone git@github.com:owner/repo.git"`,
      `echo "   VS Code Copilot will work once you sign in via VS Code."`,
    ].join("\n");

    // Also provide the one-liner SSH command to run it
    const sshCommand = `ssh ${droplet.sshUser}@${droplet.ipAddress} -p ${droplet.sshPort} 'bash -s' << 'SCRIPT'\n${setupScript}\nSCRIPT`;

    return res.json({
      setupScript,
      sshCommand,
      keyLabel,
      instructions: [
        `1. Copy the setup script or use the SSH command below`,
        `2. Run it on your droplet (${droplet.ipAddress})`,
        `3. The script will generate an SSH key, register it with GitHub, and configure git`,
        `4. Open VS Code with Remote-SSH to your droplet — Copilot will be available after signing in`,
      ],
    });
  } catch (err) {
    console.error("setup-github error:", err);
    return res.status(500).json({ error: "Failed to generate GitHub setup script" });
  }
});

/**
 * POST /droplets/:id/setup-vscode
 * Returns a script to install VS Code Server and dev dependencies on the droplet.
 * This makes the droplet ready for VS Code Remote-SSH.
 */
router.post("/:id/setup-vscode", authMiddleware, requirePermission(Actions.IntegrationManage), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const droplet = await prisma.droplet.findFirst({ where: { id: req.params.id, orgId } });
    if (!droplet) return res.status(404).json({ error: "Droplet not found" });

    const setupScript = [
      `#!/bin/bash`,
      `set -e`,
      ``,
      `echo "🔧 CodeSila — Setting up VS Code Remote SSH environment..."`,
      ``,
      `# 1. System updates`,
      `apt-get update -qq && apt-get upgrade -y -qq`,
      ``,
      `# 2. Install essential development tools`,
      `apt-get install -y -qq \\`,
      `  git curl wget unzip jq htop tree \\`,
      `  build-essential gcc g++ make \\`,
      `  python3 python3-pip \\`,
      `  ca-certificates gnupg lsb-release`,
      ``,
      `# 3. Install Node.js (LTS)`,
      `if ! command -v node &> /dev/null; then`,
      `  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -`,
      `  apt-get install -y nodejs`,
      `  echo "✅ Node.js $(node --version) installed"`,
      `fi`,
      ``,
      `# 4. Install Docker (if not present)`,
      `if ! command -v docker &> /dev/null; then`,
      `  curl -fsSL https://get.docker.com | sh`,
      `  systemctl enable docker`,
      `  echo "✅ Docker installed"`,
      `fi`,
      ``,
      `# 5. Configure SSH for agent forwarding (enables Copilot auth)`,
      `SSH_CONFIG="/etc/ssh/sshd_config"`,
      `if ! grep -q "AllowAgentForwarding yes" "$SSH_CONFIG"; then`,
      `  echo "AllowAgentForwarding yes" >> "$SSH_CONFIG"`,
      `  systemctl restart sshd`,
      `  echo "✅ SSH agent forwarding enabled"`,
      `fi`,
      ``,
      `# 6. Create workspace directory`,
      `mkdir -p /home/${droplet.sshUser}/workspace`,
      ``,
      `# 7. VS Code Server will auto-install when you connect via Remote-SSH`,
      `echo ""`,
      `echo "✅ VS Code Remote environment ready!"`,
      `echo "   Connect with: code --remote ssh-remote+codesila-${droplet.name} /home/${droplet.sshUser}/workspace"`,
      `echo ""`,
      `echo "📋 Next steps:"`,
      `echo "   1. Add your SSH public key to this droplet (if not done)"`,
      `echo "   2. Configure ~/.ssh/config on your LOCAL machine"`,
      `echo "   3. Open VS Code → Remote-SSH → Connect to Host"`,
      `echo "   4. Sign in to GitHub Copilot in VS Code once connected"`,
    ].join("\n");

    const sshCommand = `ssh ${droplet.sshUser}@${droplet.ipAddress} -p ${droplet.sshPort} 'bash -s' << 'SCRIPT'\n${setupScript}\nSCRIPT`;

    // Mark droplet as vscodeReady
    await prisma.droplet.update({
      where: { id: droplet.id },
      data: { vscodeReady: true },
    });

    return res.json({
      setupScript,
      sshCommand,
      instructions: [
        `1. Run the setup script on your droplet (${droplet.ipAddress})`,
        `2. It installs Node.js, Docker, Git, and configures SSH agent forwarding`,
        `3. VS Code Server installs automatically when you first connect`,
        `4. Use Remote-SSH extension in VS Code to connect`,
      ],
    });
  } catch (err) {
    console.error("setup-vscode error:", err);
    return res.status(500).json({ error: "Failed to generate VS Code setup script" });
  }
});

/**
 * GET /droplets/:id/connection-test
 * Checks if the droplet is reachable by verifying the DigitalOcean API (if dropletId present)
 * or by simply validating the stored info.
 */
router.get("/:id/connection-test", authMiddleware, requirePermission(Actions.DeploymentRead), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const droplet = await prisma.droplet.findFirst({ where: { id: req.params.id, orgId } });
    if (!droplet) return res.status(404).json({ error: "Droplet not found" });

    const result: any = {
      dropletId: droplet.id,
      ipAddress: droplet.ipAddress,
      sshUser: droplet.sshUser,
      sshPort: droplet.sshPort,
      githubConnected: droplet.githubConnected,
      vscodeReady: droplet.vscodeReady,
    };

    // If we have a DO droplet ID and API token, check its real status
    if (droplet.dropletId && env.DO_API_TOKEN) {
      try {
        const doRes = await doFetch(`/droplets/${droplet.dropletId}`);
        if (doRes.ok) {
          const data = (await doRes.json()) as any;
          result.doStatus = data.droplet?.status ?? "unknown";
          result.doIp = data.droplet?.networks?.v4?.find((n: any) => n.type === "public")?.ip_address ?? null;
          result.doRegion = data.droplet?.region?.slug ?? null;
          result.reachable = data.droplet?.status === "active";

          // Sync IP if changed
          if (result.doIp && result.doIp !== droplet.ipAddress) {
            await prisma.droplet.update({ where: { id: droplet.id }, data: { ipAddress: result.doIp } });
            result.ipUpdated = true;
          }
        } else {
          result.doError = `DO API returned ${doRes.status}`;
          result.reachable = null;
        }
      } catch {
        result.doError = "Failed to reach DigitalOcean API";
        result.reachable = null;
      }
    } else {
      result.reachable = null;
      result.note = "No DO API token or dropletId — cannot verify automatically. Test SSH manually.";
    }

    // Provide SSH test command
    result.sshTestCommand = `ssh -o ConnectTimeout=5 -o BatchMode=yes ${droplet.sshUser}@${droplet.ipAddress} -p ${droplet.sshPort} echo "Connection OK"`;

    return res.json(result);
  } catch (err) {
    console.error("connection-test error:", err);
    return res.status(500).json({ error: "Failed to test connection" });
  }
});

/**
 * GET /droplets/do/list
 * List droplets from DigitalOcean API (for importing).
 */
router.get("/do/list", authMiddleware, requirePermission(Actions.IntegrationManage), async (req, res) => {
  try {
    if (!env.DO_API_TOKEN) {
      return res.status(501).json({ error: "DigitalOcean API token not configured. Set DO_API_TOKEN." });
    }

    const orgId = getOrgId(req, res);

    const doRes = await doFetch("/droplets?per_page=100");
    if (!doRes.ok) {
      return res.status(502).json({ error: `DigitalOcean API returned ${doRes.status}` });
    }

    const data = (await doRes.json()) as any;

    // Check which droplets are already registered
    const registered = await prisma.droplet.findMany({
      where: { orgId },
      select: { dropletId: true },
    });
    const registeredSet = new Set(registered.map((d) => d.dropletId));

    const droplets = (data.droplets ?? []).map((d: any) => ({
      dropletId: String(d.id),
      name: d.name,
      ipAddress: d.networks?.v4?.find((n: any) => n.type === "public")?.ip_address ?? null,
      region: d.region?.slug ?? "",
      size: d.size_slug ?? "",
      image: d.image?.slug ?? "",
      status: d.status,
      tags: d.tags?.join(",") ?? "",
      registered: registeredSet.has(String(d.id)),
    }));

    return res.json(droplets);
  } catch (err) {
    console.error("do.list error:", err);
    return res.status(500).json({ error: "Failed to list DigitalOcean droplets" });
  }
});

export default router;
