// src/modules/devflow/conveyor/deployment-executor.ts — Real deployment executor (§3.3)
// Connects to registered DeploymentTargets via SSH and executes Docker-based deployments.

import { Client as SSHClient } from "ssh2";
import { prisma } from "../../../infra/db";
import logger from "../../../config/logger";
import type { StageResult } from "./conveyor.types";

/** Provider-specific config stored in DeploymentTarget.configJson */
interface DockerDeployConfig {
  /** Docker image name (e.g. "codesila/myapp") — defaults to project name */
  imageName?: string;
  /** Docker registry (e.g. "registry.digitalocean.com/myregistry") */
  registry?: string;
  /** Container port to expose */
  containerPort?: number;
  /** Host port to bind */
  hostPort?: number;
  /** Extra docker run flags (e.g. "--env-file /opt/app/.env") */
  extraRunFlags?: string;
  /** Health check URL path (e.g. "/health") */
  healthCheckPath?: string;
  /** SSH private key (PEM) — if not provided, falls back to Droplet SSH keys */
  sshPrivateKey?: string;
  /** Container name override */
  containerName?: string;
}

interface DeployContext {
  orgId: string;
  projectId: string;
  projectName: string;
  version: string;
  environment: string;
}

/**
 * Execute a real deployment against the registered DeploymentTarget.
 *
 * Strategy:
 * 1. Look up DeploymentTarget for project + environment
 * 2. Resolve SSH connection details (from Droplet or configJson)
 * 3. SSH into the target server
 * 4. Execute docker pull → stop → run sequence
 * 5. Run health check if configured
 * 6. Return real logs and status
 *
 * Falls back to local simulation if no target is registered.
 */
export async function executeDeployment(ctx: DeployContext): Promise<StageResult> {
  const startedAt = new Date();
  const logs: string[] = [];

  logs.push(`[DEPLOY] Deploying ${ctx.projectName} v${ctx.version} to ${ctx.environment}`);

  // 1. Look up deployment target
  const target = await prisma.deploymentTarget.findFirst({
    where: {
      projectId: ctx.projectId,
      environment: ctx.environment as any,
    },
  });

  if (!target) {
    logs.push(`[DEPLOY] No deployment target registered for ${ctx.environment}`);
    logs.push(`[DEPLOY] Register a target at Integrations → Deployment Targets`);
    logs.push(`[DEPLOY] Falling back to local simulation...`);
    return simulatedDeploy(ctx, startedAt, logs);
  }

  logs.push(`[DEPLOY] Target: ${target.name} (${target.provider})`);
  if (target.region) logs.push(`[DEPLOY] Region: ${target.region}`);

  // 2. Route by provider
  switch (target.provider) {
    case "DOCKER":
    case "DIGITALOCEAN":
    case "CUSTOM":
      return await sshDockerDeploy(ctx, target, startedAt, logs);

    default:
      logs.push(`[DEPLOY] Provider ${target.provider} — executing via Docker over SSH`);
      return await sshDockerDeploy(ctx, target, startedAt, logs);
  }
}

/**
 * SSH into the target and deploy via Docker.
 */
async function sshDockerDeploy(
  ctx: DeployContext,
  target: {
    id: string;
    orgId: string;
    projectId: string;
    provider: string;
    configJson: any;
    url: string | null;
  },
  startedAt: Date,
  logs: string[],
): Promise<StageResult> {
  const config: DockerDeployConfig = (target.configJson as DockerDeployConfig) ?? {};

  // Resolve SSH connection from linked Droplet or config
  const ssh = await resolveSSHConnection(target.orgId, target.projectId, config);
  if (!ssh) {
    logs.push("[DEPLOY] ERROR: No SSH credentials found");
    logs.push("[DEPLOY] Link a Droplet to this project or add sshPrivateKey to target config");
    return failResult(startedAt, logs, "No SSH credentials available");
  }

  logs.push(`[DEPLOY] Connecting to ${ssh.host}:${ssh.port} as ${ssh.username}...`);

  const imageName = config.registry
    ? `${config.registry}/${config.imageName || ctx.projectName}:${ctx.version}`
    : `${config.imageName || ctx.projectName}:${ctx.version}`;
  const containerName = config.containerName || `${ctx.projectName}-${ctx.environment}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const hostPort = config.hostPort || 3000;
  const containerPort = config.containerPort || 3000;

  // Build the deployment script
  const commands = [
    `echo "=== Pulling image ${imageName} ==="`,
    `docker pull ${imageName}`,
    `echo "=== Stopping existing container ${containerName} ==="`,
    `docker stop ${containerName} 2>/dev/null || true`,
    `docker rm ${containerName} 2>/dev/null || true`,
    `echo "=== Starting new container ==="`,
    `docker run -d --name ${containerName} --restart unless-stopped -p ${hostPort}:${containerPort} ${config.extraRunFlags || ""} ${imageName}`,
    `echo "=== Verifying container is running ==="`,
    `sleep 3`,
    `docker ps --filter name=${containerName} --format "{{.Status}}"`,
  ];

  // Add health check if configured
  if (config.healthCheckPath) {
    const healthUrl = `http://localhost:${hostPort}${config.healthCheckPath}`;
    commands.push(
      `echo "=== Running health check ==="`,
      `for i in 1 2 3 4 5; do`,
      `  STATUS=$(curl -s -o /dev/null -w "%{http_code}" ${healthUrl} 2>/dev/null || echo "000")`,
      `  if [ "$STATUS" = "200" ]; then echo "Health check passed (HTTP 200)"; exit 0; fi`,
      `  echo "Attempt $i: HTTP $STATUS — retrying in 5s..."`,
      `  sleep 5`,
      `done`,
      `echo "Health check FAILED after 5 attempts"`,
      `exit 1`,
    );
  }

  const script = commands.join("\n");

  try {
    const result = await executeSSHScript(ssh, script, logs);

    // Update target with last deploy info
    await prisma.deploymentTarget.update({
      where: { id: target.id },
      data: {
        lastDeployAt: new Date(),
        lastStatus: result.exitCode === 0 ? "SUCCESS" : "FAILED",
      },
    }).catch((e) => logger.error({ err: e }, "Failed to update deployment target"));

    const finishedAt = new Date();
    if (result.exitCode === 0) {
      logs.push(`[DEPLOY] Successfully deployed to ${ctx.environment}`);
      if (target.url) logs.push(`[DEPLOY] Live URL: ${target.url}`);
      return {
        stage: "DEPLOY",
        status: "SUCCESS",
        startedAt,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        logs,
      };
    } else {
      logs.push(`[DEPLOY] FAILURE — deployment script exited with code ${result.exitCode}`);
      return failResult(startedAt, logs, `Deployment failed with exit code ${result.exitCode}`);
    }
  } catch (err: any) {
    logs.push(`[DEPLOY] SSH ERROR: ${err.message}`);
    return failResult(startedAt, logs, `SSH connection failed: ${err.message}`);
  }
}

/** Resolve SSH host/port/credentials from Droplet or configJson */
async function resolveSSHConnection(
  orgId: string,
  projectId: string,
  config: DockerDeployConfig,
): Promise<{ host: string; port: number; username: string; privateKey: string } | null> {
  // Option 1: SSH key directly in config
  if (config.sshPrivateKey) {
    const droplet = await prisma.droplet.findFirst({
      where: { orgId, projectId },
      orderBy: { createdAt: "desc" },
    });
    if (droplet) {
      return {
        host: droplet.ipAddress,
        port: droplet.sshPort,
        username: droplet.sshUser,
        privateKey: config.sshPrivateKey,
      };
    }
  }

  // Option 2: Find Droplet linked to this project + its SSH keys
  const droplet = await prisma.droplet.findFirst({
    where: { orgId, projectId, status: "ACTIVE" },
    include: { sshKeys: true },
    orderBy: { createdAt: "desc" },
  });

  if (!droplet) return null;

  // Look for a key that has been added to the droplet
  const activeKey = droplet.sshKeys.find((k) => k.addedToDroplet);

  // If we have a private key in config, use it with the droplet's connection info
  if (config.sshPrivateKey) {
    return {
      host: droplet.ipAddress,
      port: droplet.sshPort,
      username: droplet.sshUser,
      privateKey: config.sshPrivateKey,
    };
  }

  // If no private key available, we can't connect
  // (Public keys are stored in DropletSSHKey but private keys must be in configJson)
  if (!activeKey) {
    logger.warn(
      { dropletId: droplet.id, projectId },
      "Droplet found but no SSH private key configured — add sshPrivateKey to deployment target configJson",
    );
    return null;
  }

  // DropletSSHKey stores public keys only; private key must be in configJson
  logger.warn(
    { dropletId: droplet.id },
    "SSH key found on droplet but private key not in target config",
  );
  return null;
}

/** Execute a shell script over SSH and stream output to logs array */
function executeSSHScript(
  conn: { host: string; port: number; username: string; privateKey: string },
  script: string,
  logs: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const client = new SSHClient();
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      client.end();
      reject(new Error("SSH command timed out after 300s"));
    }, 300_000);

    client.on("ready", () => {
      logs.push("[DEPLOY] SSH connection established");
      client.exec(script, { env: {} }, (err, stream) => {
        if (err) {
          clearTimeout(timeout);
          client.end();
          return reject(err);
        }

        stream.on("data", (data: Buffer) => {
          const lines = data.toString().split("\n").filter(Boolean);
          for (const line of lines) {
            logs.push(`[DEPLOY] ${line}`);
            stdout += line + "\n";
          }
        });

        stream.stderr.on("data", (data: Buffer) => {
          const lines = data.toString().split("\n").filter(Boolean);
          for (const line of lines) {
            logs.push(`[DEPLOY:ERR] ${line}`);
            stderr += line + "\n";
          }
        });

        stream.on("close", (code: number) => {
          clearTimeout(timeout);
          client.end();
          resolve({ exitCode: code ?? 0, stdout, stderr });
        });
      });
    });

    client.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    client.connect({
      host: conn.host,
      port: conn.port,
      username: conn.username,
      privateKey: conn.privateKey,
      readyTimeout: 30_000,
      keepaliveInterval: 10_000,
    });
  });
}

/** Simulated deploy for when no target is registered (graceful fallback) */
async function simulatedDeploy(
  ctx: DeployContext,
  startedAt: Date,
  logs: string[],
): Promise<StageResult> {
  logs.push(`[DEPLOY:SIM] Pulling image ${ctx.projectName}:${ctx.version}...`);
  await delay(200);
  logs.push("[DEPLOY:SIM] Stopping previous containers...");
  await delay(150);
  logs.push("[DEPLOY:SIM] Starting new containers...");
  await delay(300);
  logs.push("[DEPLOY:SIM] Health check passed (simulated)");
  logs.push(`[DEPLOY:SIM] Simulated deployment to ${ctx.environment} complete`);
  logs.push("[DEPLOY:SIM] ⚠ This was a simulation — register a deployment target for real deployments");

  const finishedAt = new Date();
  return {
    stage: "DEPLOY",
    status: "SUCCESS",
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    logs,
  };
}

function failResult(startedAt: Date, logs: string[], error: string): StageResult {
  const finishedAt = new Date();
  return {
    stage: "DEPLOY",
    status: "FAILURE",
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    logs,
    error,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
