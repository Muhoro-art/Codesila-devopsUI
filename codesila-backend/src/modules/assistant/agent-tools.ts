// src/modules/assistant/agent-tools.ts — Autonomous agent tool definitions & executors (§3.3)
// Gives the AI assistant the ability to actually execute DevOps actions.

import { prisma } from "../../infra/db";
import { executeDeployment } from "../devflow/conveyor/deployment-executor";
import { decrypt } from "../../shared/security/encryption";
import logger from "../../config/logger";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

/* ─── OpenAI function definitions ─────────────────────────── */

export const AGENT_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_projects",
      description: "List all projects in the organization with their status, services, and team info",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "create_project",
      description: "Create a new project in the organization with default environments (dev/staging/prod), a default service, and a deploy runbook",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Project name" },
          key: { type: "string", description: "Short unique key (e.g. 'MYPROJ'). Auto-generated from name if not provided." },
          description: { type: "string", description: "Project description (optional)" },
          type: { type: "string", enum: ["API", "WEB", "MOBILE", "FULLSTACK", "DATA", "INFRA", "LIBRARY", "OTHER"], description: "Project type (default API)" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_deployments",
      description: "List recent deployments, optionally filtered by project or environment",
      parameters: {
        type: "object",
        properties: {
          projectName: { type: "string", description: "Filter by project name (optional)" },
          environment: { type: "string", enum: ["DEV", "STAGING", "PROD"], description: "Filter by environment (optional)" },
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "trigger_deployment",
      description: "Deploy a service to a target environment. This executes a real deployment via SSH to the registered deployment target.",
      parameters: {
        type: "object",
        properties: {
          projectName: { type: "string", description: "Name of the project to deploy" },
          serviceName: { type: "string", description: "Name of the service within the project" },
          version: { type: "string", description: "Version tag to deploy (e.g. '1.2.3' or 'latest')" },
          environment: { type: "string", enum: ["DEV", "STAGING", "PROD"], description: "Target environment" },
        },
        required: ["projectName", "serviceName", "version", "environment"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "trigger_pipeline",
      description: "Trigger a full CI/CD pipeline run (build → test → deploy) for a project service",
      parameters: {
        type: "object",
        properties: {
          projectName: { type: "string", description: "Name of the project" },
          serviceName: { type: "string", description: "Name of the service" },
          branch: { type: "string", description: "Git branch to build from (default: main)" },
          version: { type: "string", description: "Version tag for this build" },
          environment: { type: "string", enum: ["DEV", "STAGING", "PROD"], description: "Target environment" },
        },
        required: ["projectName", "serviceName", "version", "environment"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_incidents",
      description: "List open incidents, optionally filtered by project or severity",
      parameters: {
        type: "object",
        properties: {
          projectName: { type: "string", description: "Filter by project name (optional)" },
          severity: { type: "string", enum: ["SEV1", "SEV2", "SEV3", "SEV4"], description: "Filter by severity (optional)" },
          status: { type: "string", enum: ["OPEN", "INVESTIGATING", "MITIGATED", "RESOLVED"], description: "Filter by status (optional)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_incident",
      description: "Create a new incident for a project",
      parameters: {
        type: "object",
        properties: {
          projectName: { type: "string", description: "Name of the affected project" },
          summary: { type: "string", description: "Brief incident summary" },
          description: { type: "string", description: "Detailed description (optional)" },
          severity: { type: "string", enum: ["SEV1", "SEV2", "SEV3", "SEV4"], description: "Severity level (default SEV3)" },
        },
        required: ["projectName", "summary"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_incident",
      description: "Update an incident's status or severity (e.g. escalate, resolve)",
      parameters: {
        type: "object",
        properties: {
          incidentId: { type: "string", description: "Incident ID" },
          status: { type: "string", enum: ["OPEN", "INVESTIGATING", "MITIGATED", "RESOLVED"], description: "New status" },
          severity: { type: "string", enum: ["SEV1", "SEV2", "SEV3", "SEV4"], description: "New severity" },
        },
        required: ["incidentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_runbooks",
      description: "List runbooks, optionally filtered by project",
      parameters: {
        type: "object",
        properties: {
          projectName: { type: "string", description: "Filter by project name (optional)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_deployment_targets",
      description: "List registered deployment targets for a project showing where it can be deployed",
      parameters: {
        type: "object",
        properties: {
          projectName: { type: "string", description: "Project name to look up targets for" },
        },
        required: ["projectName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_pipeline_status",
      description: "Get the status of recent pipeline runs for a project",
      parameters: {
        type: "object",
        properties: {
          projectName: { type: "string", description: "Project name" },
          limit: { type: "number", description: "Max results (default 5)" },
        },
        required: ["projectName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rollback_deployment",
      description: "Rollback a service to a previous version by triggering a deployment with the old version tag",
      parameters: {
        type: "object",
        properties: {
          projectName: { type: "string", description: "Project name" },
          serviceName: { type: "string", description: "Service name" },
          targetVersion: { type: "string", description: "Version to roll back to" },
          environment: { type: "string", enum: ["DEV", "STAGING", "PROD"], description: "Environment" },
        },
        required: ["projectName", "serviceName", "targetVersion", "environment"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_repo",
      description: "Create a new repository on GitHub or GitLab through the platform's connected integration. If projectName is provided, the repo is automatically linked to that project so it appears in the project's Integrations tab.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Repository name (alphanumeric, dots, hyphens, underscores)" },
          description: { type: "string", description: "Repository description (optional)" },
          isPrivate: { type: "boolean", description: "Private repo (default true)" },
          provider: { type: "string", enum: ["github", "gitlab"], description: "Which provider to create on (default: first active integration)" },
          defaultBranch: { type: "string", description: "Default branch name (default 'main')" },
          projectName: { type: "string", description: "CodeSila project to automatically link the new repo to (optional but recommended)" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_repos",
      description: "List repositories available from connected GitHub/GitLab integrations",
      parameters: {
        type: "object",
        properties: {
          provider: { type: "string", enum: ["github", "gitlab"], description: "Filter by provider (optional)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "link_repo_to_project",
      description: "Link an existing repository from a connected integration to a CodeSila project",
      parameters: {
        type: "object",
        properties: {
          repoFullName: { type: "string", description: "Full repository name (e.g. 'owner/repo-name')" },
          projectName: { type: "string", description: "CodeSila project to link the repo to" },
          provider: { type: "string", enum: ["github", "gitlab"], description: "Provider (default: auto-detect)" },
        },
        required: ["repoFullName", "projectName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_integrations",
      description: "List connected integrations (GitHub, GitLab, Docker Registry) for the organization",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "scaffold_project",
      description:
        "Generate project architecture files using GitHub Copilot (via GitHub Models API) and push them to the project's linked GitHub repository. " +
        "Creates a complete project scaffold with directory structure, boilerplate code, configs, Dockerfile, CI pipeline, and README based on the project description and type. " +
        "Requires a GitHub integration and a linked repo.",
      parameters: {
        type: "object",
        properties: {
          projectName: {
            type: "string",
            description: "CodeSila project name (must have a linked GitHub repo)",
          },
          description: {
            type: "string",
            description:
              "Detailed description of what the project should do. The more detail, the better the generated architecture. " +
              'E.g. "REST API for e-commerce with auth, products, cart, orders, Stripe payments, PostgreSQL, Redis caching"',
          },
          stack: {
            type: "string",
            description:
              'Tech stack hint, e.g. "Node.js + Express + TypeScript + Prisma + PostgreSQL" or "Python + FastAPI + SQLAlchemy". ' +
              "If omitted, the agent infers from project type.",
          },
          branch: {
            type: "string",
            description: "Branch to push files to (default: main)",
          },
        },
        required: ["projectName", "description"],
      },
    },
  },
];

/* ─── Tool execution context ──────────────────────────────── */

export interface ToolContext {
  orgId: string;
  userId: string;
}

/* ─── Resolve project by name ─────────────────────────────── */

async function resolveProject(orgId: string, projectName: string) {
  return prisma.project.findFirst({
    where: {
      orgId,
      OR: [
        { name: { equals: projectName, mode: "insensitive" } },
        { key: { equals: projectName.toUpperCase(), mode: "insensitive" } },
      ],
    },
    include: { services: true },
  });
}

async function resolveService(projectId: string, serviceName: string) {
  return prisma.service.findFirst({
    where: {
      projectId,
      OR: [
        { name: { equals: serviceName, mode: "insensitive" } },
        { key: { equals: serviceName.toUpperCase(), mode: "insensitive" } },
      ],
    },
  });
}

/* ─── Tool executor ───────────────────────────────────────── */

export async function executeTool(
  name: string,
  args: Record<string, any>,
  ctx: ToolContext,
): Promise<string> {
  try {
    switch (name) {
      case "list_projects":
        return await toolListProjects(ctx);
      case "create_project":
        return await toolCreateProject(ctx, args);
      case "list_deployments":
        return await toolListDeployments(ctx, args);
      case "trigger_deployment":
        return await toolTriggerDeployment(ctx, args);
      case "trigger_pipeline":
        return await toolTriggerPipeline(ctx, args);
      case "list_incidents":
        return await toolListIncidents(ctx, args);
      case "create_incident":
        return await toolCreateIncident(ctx, args);
      case "update_incident":
        return await toolUpdateIncident(ctx, args);
      case "list_runbooks":
        return await toolListRunbooks(ctx, args);
      case "get_deployment_targets":
        return await toolGetTargets(ctx, args);
      case "get_pipeline_status":
        return await toolGetPipelineStatus(ctx, args);
      case "rollback_deployment":
        return await toolRollback(ctx, args);
      case "create_repo":
        return await toolCreateRepo(ctx, args);
      case "list_repos":
        return await toolListRepos(ctx, args);
      case "link_repo_to_project":
        return await toolLinkRepo(ctx, args);
      case "list_integrations":
        return await toolListIntegrations(ctx);
      case "scaffold_project":
        return await toolScaffoldProject(ctx, args);
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err: any) {
    logger.error({ err, tool: name }, "Agent tool execution error");
    return JSON.stringify({ error: err.message });
  }
}

/* ─── Individual tool implementations ─────────────────────── */

async function toolListProjects(ctx: ToolContext): Promise<string> {
  const projects = await prisma.project.findMany({
    where: { orgId: ctx.orgId },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      services: { select: { id: true, name: true, key: true } },
      owner: { select: { name: true, email: true } },
      _count: { select: { memberships: true, deployments: true, incidents: true } },
    },
  });

  return JSON.stringify(
    projects.map((p) => ({
      id: p.id,
      name: p.name,
      key: p.key,
      status: p.status,
      type: p.type,
      owner: p.owner?.name ?? p.owner?.email,
      services: p.services.map((s) => s.name),
      members: p._count.memberships,
      deployments: p._count.deployments,
      incidents: p._count.incidents,
    })),
  );
}

async function toolCreateProject(ctx: ToolContext, args: Record<string, any>): Promise<string> {
  const name = args.name?.trim();
  if (!name) return JSON.stringify({ error: "Project name is required" });

  const key = (args.key || name.toUpperCase().replace(/[^A-Z0-9]/g, "_").slice(0, 12))
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");

  // Check for duplicate
  const existing = await prisma.project.findFirst({
    where: { orgId: ctx.orgId, OR: [{ name }, { key }] },
  });
  if (existing) {
    return JSON.stringify({ error: `Project with name "${name}" or key "${key}" already exists` });
  }

  const result = await prisma.$transaction(async (tx) => {
    // 1. Create project
    const project = await tx.project.create({
      data: {
        orgId: ctx.orgId,
        name,
        key,
        description: args.description || null,
        type: args.type || "API",
        ownerId: ctx.userId,
      },
    });

    // 2. Create default environments
    await tx.projectEnvironment.createMany({
      data: [
        { orgId: ctx.orgId, projectId: project.id, name: "Development", key: "dev", isDefault: true },
        { orgId: ctx.orgId, projectId: project.id, name: "Staging", key: "staging" },
        { orgId: ctx.orgId, projectId: project.id, name: "Production", key: "prod" },
      ],
    });

    // 3. Create default service
    const service = await tx.service.create({
      data: {
        orgId: ctx.orgId,
        projectId: project.id,
        name: "Core Service",
        key: "core",
        description: `Default service for ${name}`,
      },
    });

    // 4. Create default runbook
    await tx.runbook.create({
      data: {
        orgId: ctx.orgId,
        projectId: project.id,
        serviceId: service.id,
        title: `${name} — Deploy Runbook`,
        content: `# ${name} Deploy Runbook\n\n## Deploy\nSteps to deploy safely.\n\n## Rollback\nSteps to rollback.\n\n## Monitoring\nDashboards and alerts.`,
        status: "DRAFT",
        createdById: ctx.userId,
        updatedById: ctx.userId,
      },
    });

    // 5. Add owner as project admin
    await tx.projectMember.create({
      data: { projectId: project.id, userId: ctx.userId, role: "ADMIN" },
    });

    // 6. Create project chat room
    await tx.chatRoom.create({
      data: {
        name,
        type: "group",
        orgId: ctx.orgId,
        projectId: project.id,
        participants: { create: [{ userId: ctx.userId }] },
      },
    });

    return { project, service };
  });

  return JSON.stringify({
    success: true,
    projectId: result.project.id,
    name: result.project.name,
    key: result.project.key,
    type: result.project.type,
    service: result.service.name,
    environments: ["dev", "staging", "prod"],
    message: `Project "${name}" created with key ${key}, default service "Core Service", 3 environments, deploy runbook, and team chat.`,
  });
}

async function toolListDeployments(ctx: ToolContext, args: Record<string, any>): Promise<string> {
  const limit = Math.min(args.limit ?? 10, 30);
  const where: any = { orgId: ctx.orgId };

  if (args.projectName) {
    const project = await resolveProject(ctx.orgId, args.projectName);
    if (!project) return JSON.stringify({ error: `Project "${args.projectName}" not found` });
    where.projectId = project.id;
  }
  if (args.environment) where.environment = args.environment;

  const deployments = await prisma.deployment.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      project: { select: { name: true } },
      service: { select: { name: true } },
    },
  });

  return JSON.stringify(
    deployments.map((d) => ({
      id: d.id,
      project: d.project?.name,
      service: d.service?.name,
      version: d.version,
      environment: d.environment,
      status: d.status,
      startedAt: d.startedAt?.toISOString(),
      finishedAt: d.finishedAt?.toISOString(),
    })),
  );
}

async function toolTriggerDeployment(ctx: ToolContext, args: Record<string, any>): Promise<string> {
  const project = await resolveProject(ctx.orgId, args.projectName);
  if (!project) return JSON.stringify({ error: `Project "${args.projectName}" not found` });

  const service = await resolveService(project.id, args.serviceName);
  if (!service) return JSON.stringify({ error: `Service "${args.serviceName}" not found in project "${project.name}"` });

  // Create deployment record
  const deployment = await prisma.deployment.create({
    data: {
      orgId: ctx.orgId,
      projectId: project.id,
      serviceId: service.id,
      environment: args.environment,
      version: args.version,
      status: "RUNNING",
      startedAt: new Date(),
      createdById: ctx.userId,
      triggeredById: ctx.userId,
    },
  });

  // Execute real deployment asynchronously
  executeDeployment({
    orgId: ctx.orgId,
    projectId: project.id,
    projectName: project.name,
    version: args.version,
    environment: args.environment,
  }).then(async (result) => {
    const status = result.status === "SUCCESS" ? "SUCCESS" : "FAILED";
    await prisma.deployment.update({
      where: { id: deployment.id },
      data: { status, finishedAt: new Date() },
    }).catch(() => {});
  }).catch(() => {});

  return JSON.stringify({
    success: true,
    deploymentId: deployment.id,
    message: `Deployment triggered: ${project.name}/${service.name} v${args.version} → ${args.environment}`,
    note: "Deployment is executing in the background. Check deployment status for progress.",
  });
}

async function toolTriggerPipeline(ctx: ToolContext, args: Record<string, any>): Promise<string> {
  const project = await resolveProject(ctx.orgId, args.projectName);
  if (!project) return JSON.stringify({ error: `Project "${args.projectName}" not found` });

  const service = await resolveService(project.id, args.serviceName);
  if (!service) return JSON.stringify({ error: `Service "${args.serviceName}" not found in project "${project.name}"` });

  const branch = args.branch ?? "main";
  const version = args.version;
  const environment = args.environment;

  // Find or create a Pipeline DB record for this project
  let pipeline = await prisma.pipeline.findFirst({
    where: { projectId: project.id },
  });
  if (!pipeline) {
    pipeline = await prisma.pipeline.create({
      data: {
        projectId: project.id,
        name: `${project.name} Pipeline`,
        configYaml: `stages:\n  - build\n  - test\n  - deploy`,
        createdById: ctx.userId,
      },
    });
  }

  // Create PipelineRun DB record (visible to frontend)
  const run = await prisma.pipelineRun.create({
    data: {
      pipelineId: pipeline.id,
      triggeredById: ctx.userId,
      branch,
      commitSha: args.commitSha ?? null,
      metadata: { version, environment, serviceName: service.name },
      status: "RUNNING",
      startedAt: new Date(),
    },
  });

  // Create RunStep records for each stage
  const stages = ["Build", "Test", "Deploy"];
  const stepIds: string[] = [];
  for (let i = 0; i < stages.length; i++) {
    const step = await prisma.runStep.create({
      data: {
        runId: run.id,
        name: stages[i],
        sortOrder: i,
        status: "QUEUED",
      },
    });
    stepIds.push(step.id);
  }

  // Execute pipeline stages in background (so the agent can return immediately)
  (async () => {
    try {
      const { runBuildStage } = await import("../devflow/conveyor/stages/codeGen.stage");
      const { runTestStage } = await import("../devflow/conveyor/stages/testSynthesis.stage");
      const { runDeployStage } = await import("../devflow/conveyor/stages/review.stage");

      let failed = false;

      // BUILD
      await prisma.runStep.update({ where: { id: stepIds[0] }, data: { status: "RUNNING", startedAt: new Date() } });
      const buildResult = await runBuildStage(project.name, branch, version);
      const buildStatus = buildResult.status === "SUCCESS" ? "SUCCESS" : "FAILURE";
      await prisma.runStep.update({
        where: { id: stepIds[0] },
        data: { status: buildStatus, finishedAt: new Date(), logOutput: buildResult.logs?.join("\n") ?? null },
      });
      if (buildStatus !== "SUCCESS") failed = true;

      // TEST (skip if build failed)
      if (!failed) {
        await prisma.runStep.update({ where: { id: stepIds[1] }, data: { status: "RUNNING", startedAt: new Date() } });
        const testResult = await runTestStage(project.name, version);
        const testStatus = testResult.status === "SUCCESS" ? "SUCCESS" : "FAILURE";
        await prisma.runStep.update({
          where: { id: stepIds[1] },
          data: { status: testStatus, finishedAt: new Date(), logOutput: testResult.logs?.join("\n") ?? null },
        });
        if (testStatus !== "SUCCESS") failed = true;
      } else {
        await prisma.runStep.update({ where: { id: stepIds[1] }, data: { status: "CANCELLED", finishedAt: new Date() } });
      }

      // DEPLOY (skip if earlier stages failed)
      if (!failed) {
        await prisma.runStep.update({ where: { id: stepIds[2] }, data: { status: "RUNNING", startedAt: new Date() } });
        const deployResult = await runDeployStage(project.name, version, environment, {
          orgId: ctx.orgId,
          projectId: project.id,
        });
        const deployStatus = deployResult.status === "SUCCESS" ? "SUCCESS" : "FAILURE";
        await prisma.runStep.update({
          where: { id: stepIds[2] },
          data: { status: deployStatus, finishedAt: new Date(), logOutput: deployResult.logs?.join("\n") ?? null },
        });
        if (deployStatus !== "SUCCESS") failed = true;
      } else {
        await prisma.runStep.update({ where: { id: stepIds[2] }, data: { status: "CANCELLED", finishedAt: new Date() } });
      }

      // Finalize run
      await prisma.pipelineRun.update({
        where: { id: run.id },
        data: { status: failed ? "FAILURE" : "SUCCESS", finishedAt: new Date() },
      });

      // Also record a Deployment record
      await prisma.deployment.create({
        data: {
          orgId: ctx.orgId,
          projectId: project.id,
          serviceId: service.id,
          environment: environment as any,
          version,
          status: failed ? "FAILED" : "SUCCESS",
          createdById: ctx.userId,
          triggeredById: ctx.userId,
          startedAt: new Date(),
          finishedAt: new Date(),
        },
      }).catch(() => {});
    } catch (err: any) {
      logger.error({ err, runId: run.id }, "Agent pipeline execution error");
      await prisma.pipelineRun.update({
        where: { id: run.id },
        data: { status: "FAILURE", finishedAt: new Date() },
      }).catch(() => {});
    }
  })();

  return JSON.stringify({
    success: true,
    pipelineRunId: run.id,
    pipelineId: pipeline.id,
    status: "RUNNING",
    message: `Pipeline triggered: ${project.name}/${service.name} v${version} (${environment}). Stages: Build → Test → Deploy. Check pipeline status for progress.`,
  });
}

async function toolListIncidents(ctx: ToolContext, args: Record<string, any>): Promise<string> {
  const where: any = { orgId: ctx.orgId };

  if (args.projectName) {
    const project = await resolveProject(ctx.orgId, args.projectName);
    if (!project) return JSON.stringify({ error: `Project "${args.projectName}" not found` });
    where.projectId = project.id;
  }
  if (args.severity) where.severity = args.severity;
  if (args.status) where.status = args.status;
  else where.status = { in: ["OPEN", "INVESTIGATING", "MITIGATED"] };

  const incidents = await prisma.incident.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: 15,
    include: {
      project: { select: { name: true } },
      service: { select: { name: true } },
    },
  });

  return JSON.stringify(
    incidents.map((i) => ({
      id: i.id,
      project: i.project?.name,
      service: i.service?.name,
      severity: i.severity,
      status: i.status,
      summary: i.summary,
      startedAt: i.startedAt.toISOString(),
    })),
  );
}

async function toolCreateIncident(ctx: ToolContext, args: Record<string, any>): Promise<string> {
  const project = await resolveProject(ctx.orgId, args.projectName);
  if (!project) return JSON.stringify({ error: `Project "${args.projectName}" not found` });

  // serviceId is required — use the first service if not specified
  const service = project.services?.[0];
  if (!service) return JSON.stringify({ error: `Project "${project.name}" has no services — create a service first` });

  const incident = await prisma.incident.create({
    data: {
      organization: { connect: { id: ctx.orgId } },
      project: { connect: { id: project.id } },
      service: { connect: { id: service.id } },
      summary: args.summary,
      description: args.description,
      severity: args.severity ?? "SEV3",
      status: "OPEN",
      startedAt: new Date(),
      owner: { connect: { id: ctx.userId } },
    },
  });

  return JSON.stringify({
    success: true,
    incidentId: incident.id,
    message: `Incident created: [${incident.severity}] ${incident.summary} for project "${project.name}"`,
  });
}

async function toolUpdateIncident(ctx: ToolContext, args: Record<string, any>): Promise<string> {
  const data: any = {};
  if (args.status) {
    data.status = args.status;
    if (args.status === "RESOLVED") data.resolvedAt = new Date();
  }
  if (args.severity) data.severity = args.severity;

  const incident = await prisma.incident.update({
    where: { id: args.incidentId },
    data,
    include: { project: { select: { name: true } } },
  });

  return JSON.stringify({
    success: true,
    message: `Incident updated: [${incident.severity}] ${incident.status} — ${incident.summary}`,
  });
}

async function toolListRunbooks(ctx: ToolContext, args: Record<string, any>): Promise<string> {
  const where: any = { orgId: ctx.orgId };

  if (args.projectName) {
    const project = await resolveProject(ctx.orgId, args.projectName);
    if (!project) return JSON.stringify({ error: `Project "${args.projectName}" not found` });
    where.projectId = project.id;
  }

  const runbooks = await prisma.runbook.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 15,
    include: {
      project: { select: { name: true } },
      service: { select: { name: true } },
    },
  });

  return JSON.stringify(
    runbooks.map((r) => ({
      id: r.id,
      title: r.title,
      project: r.project?.name,
      service: r.service?.name,
      status: r.status,
      version: r.version,
      updatedAt: r.updatedAt.toISOString(),
    })),
  );
}

async function toolGetTargets(ctx: ToolContext, args: Record<string, any>): Promise<string> {
  const project = await resolveProject(ctx.orgId, args.projectName);
  if (!project) return JSON.stringify({ error: `Project "${args.projectName}" not found` });

  const targets = await prisma.deploymentTarget.findMany({
    where: { orgId: ctx.orgId, projectId: project.id },
  });

  return JSON.stringify(
    targets.map((t) => ({
      id: t.id,
      name: t.name,
      environment: t.environment,
      provider: t.provider,
      url: t.url,
      region: t.region,
      lastDeployAt: t.lastDeployAt?.toISOString(),
      lastStatus: t.lastStatus,
    })),
  );
}

async function toolGetPipelineStatus(ctx: ToolContext, args: Record<string, any>): Promise<string> {
  const project = await resolveProject(ctx.orgId, args.projectName);
  if (!project) return JSON.stringify({ error: `Project "${args.projectName}" not found` });

  const limit = Math.min(args.limit ?? 5, 20);

  const pipelines = await prisma.pipeline.findMany({
    where: { projectId: project.id },
    include: {
      runs: {
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          status: true,
          branch: true,
          commitSha: true,
          createdAt: true,
          startedAt: true,
          finishedAt: true,
        },
      },
    },
  });

  return JSON.stringify(
    pipelines.map((p) => ({
      pipelineId: p.id,
      name: p.name,
      recentRuns: p.runs.map((r) => ({
        id: r.id,
        status: r.status,
        branch: r.branch,
        commitSha: r.commitSha,
        createdAt: r.createdAt.toISOString(),
        startedAt: r.startedAt?.toISOString(),
        finishedAt: r.finishedAt?.toISOString(),
      })),
    })),
  );
}

async function toolRollback(ctx: ToolContext, args: Record<string, any>): Promise<string> {
  // Rollback is just a deployment with the old version
  return toolTriggerDeployment(ctx, {
    projectName: args.projectName,
    serviceName: args.serviceName,
    version: args.targetVersion,
    environment: args.environment,
  });
}

/* ─── Repository & Integration tools ─────────────────────── */

async function resolveIntegration(orgId: string, provider?: string) {
  const where: any = { orgId, isActive: true };
  if (provider) where.type = provider;
  else where.type = { in: ["github", "gitlab"] };

  return prisma.integration.findFirst({ where, orderBy: { createdAt: "desc" } });
}

async function toolCreateRepo(ctx: ToolContext, args: Record<string, any>): Promise<string> {
  const name = args.name;
  if (!name || !/^[a-zA-Z0-9._-]+$/.test(name)) {
    return JSON.stringify({ error: "Invalid repo name. Use alphanumeric, dots, hyphens, underscores only." });
  }

  const integration = await resolveIntegration(ctx.orgId, args.provider);
  if (!integration) {
    return JSON.stringify({ error: "No active GitHub or GitLab integration found. Connect one first in Settings → Integrations." });
  }

  // Optionally resolve project for auto-bind
  let project: Awaited<ReturnType<typeof resolveProject>> = null;
  if (args.projectName) {
    project = await resolveProject(ctx.orgId, args.projectName);
    if (!project) {
      return JSON.stringify({ error: `Project "${args.projectName}" not found. Create it first, then create the repo.` });
    }
  }

  const token = decrypt(integration.credentialsEnc);
  const isPrivate = args.isPrivate ?? true;
  const defaultBranch = args.defaultBranch || "main";
  const description = args.description || `Created by CodeSila`;

  if (integration.type === "github") {
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
        description,
        private: isPrivate,
        auto_init: true,
        default_branch: defaultBranch,
      }),
    });

    if (response.status === 422) {
      return JSON.stringify({ error: `Repository "${name}" already exists on GitHub` });
    }
    if (!response.ok) {
      const err = await response.text();
      return JSON.stringify({ error: `GitHub API error (${response.status}): ${err}` });
    }

    const repo = (await response.json()) as any;

    // Auto-bind to project if specified
    if (project) {
      await autoBindRepo(ctx, integration, project, {
        fullName: repo.full_name,
        htmlUrl: repo.html_url,
        defaultBranch: repo.default_branch || defaultBranch,
        githubRepoId: repo.id,
        isPrivate: repo.private,
        provider: "github",
      });
    }

    return JSON.stringify({
      success: true,
      provider: "github",
      name: repo.name,
      fullName: repo.full_name,
      url: repo.html_url,
      cloneUrl: repo.clone_url,
      isPrivate: repo.private,
      defaultBranch: repo.default_branch,
      linkedToProject: project?.name ?? null,
      message: project
        ? `Repository created and linked to "${project.name}": [${repo.full_name}](${repo.html_url})`
        : `Repository created: [${repo.full_name}](${repo.html_url})`,
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
        description,
        visibility: isPrivate ? "private" : "public",
        initialize_with_readme: true,
        default_branch: defaultBranch,
      }),
    });

    if (response.status === 400) {
      const err = (await response.json()) as any;
      if (err.message?.name?.[0]?.includes("already been taken")) {
        return JSON.stringify({ error: `Repository "${name}" already exists on GitLab` });
      }
      return JSON.stringify({ error: `GitLab error: ${JSON.stringify(err.message)}` });
    }
    if (!response.ok) {
      return JSON.stringify({ error: `GitLab API error (${response.status})` });
    }

    const proj = (await response.json()) as any;

    // Auto-bind to project if specified
    if (project) {
      await autoBindRepo(ctx, integration, project, {
        fullName: proj.path_with_namespace,
        htmlUrl: proj.web_url,
        defaultBranch: proj.default_branch || defaultBranch,
        provider: "gitlab",
      });
    }

    return JSON.stringify({
      success: true,
      provider: "gitlab",
      name: proj.name,
      fullName: proj.path_with_namespace,
      url: proj.web_url,
      cloneUrl: proj.http_url_to_repo,
      isPrivate: proj.visibility === "private",
      defaultBranch: proj.default_branch,
      linkedToProject: project?.name ?? null,
      message: project
        ? `Repository created and linked to "${project.name}": [${proj.path_with_namespace}](${proj.web_url})`
        : `Repository created: [${proj.path_with_namespace}](${proj.web_url})`,
    });
  }

  return JSON.stringify({ error: `Unsupported provider: ${integration.type}` });
}

/** Shared helper: create ProjectIntegration binding + update project's git URL */
async function autoBindRepo(
  ctx: ToolContext,
  integration: { id: string; type: string },
  project: { id: string; name: string },
  repo: {
    fullName: string;
    htmlUrl: string;
    defaultBranch: string;
    githubRepoId?: number;
    isPrivate?: boolean;
    provider: string;
  },
) {
  // Create ProjectIntegration binding (what the UI Integrations tab reads)
  const existing = await prisma.projectIntegration.findUnique({
    where: { projectId_integrationId: { projectId: project.id, integrationId: integration.id } },
  });
  if (!existing) {
    await prisma.projectIntegration.create({
      data: {
        projectId: project.id,
        integrationId: integration.id,
        configJson: {
          repo: repo.fullName,
          branch: repo.defaultBranch,
          url: repo.htmlUrl,
        },
      },
    });
  }

  // For GitHub: also create GitHubRepo record if installation exists
  if (repo.provider === "github" && repo.githubRepoId) {
    const installation = await prisma.gitHubInstallation.findUnique({
      where: { orgId: ctx.orgId },
    });
    if (installation) {
      const existingGhRepo = await prisma.gitHubRepo.findFirst({
        where: { orgId: ctx.orgId, fullName: repo.fullName },
      });
      if (!existingGhRepo) {
        await prisma.gitHubRepo.create({
          data: {
            orgId: ctx.orgId,
            projectId: project.id,
            installationId: installation.id,
            githubRepoId: repo.githubRepoId,
            fullName: repo.fullName,
            defaultBranch: repo.defaultBranch,
            private: repo.isPrivate ?? true,
            htmlUrl: repo.htmlUrl,
          },
        });
      }
    }
  }

  // Update project's gitRepositoryUrl
  await prisma.project.update({
    where: { id: project.id },
    data: { gitRepositoryUrl: repo.htmlUrl, defaultBranch: repo.defaultBranch },
  });
}

async function toolListRepos(ctx: ToolContext, args: Record<string, any>): Promise<string> {
  const integration = await resolveIntegration(ctx.orgId, args.provider);
  if (!integration) {
    return JSON.stringify({ error: "No active GitHub or GitLab integration found." });
  }

  const token = decrypt(integration.credentialsEnc);

  if (integration.type === "github") {
    const res = await fetch("https://api.github.com/user/repos?per_page=30&sort=updated&direction=desc", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "CodeSila/1.0",
      },
    });
    if (!res.ok) return JSON.stringify({ error: `GitHub API error (${res.status})` });

    const repos = (await res.json()) as any[];
    return JSON.stringify(
      repos.map((r) => ({
        name: r.name,
        fullName: r.full_name,
        url: r.html_url,
        isPrivate: r.private,
        defaultBranch: r.default_branch,
        language: r.language,
        updatedAt: r.updated_at,
      })),
    );
  }

  if (integration.type === "gitlab") {
    const res = await fetch("https://gitlab.com/api/v4/projects?membership=true&per_page=30&order_by=updated_at", {
      headers: { "PRIVATE-TOKEN": token },
    });
    if (!res.ok) return JSON.stringify({ error: `GitLab API error (${res.status})` });

    const projects = (await res.json()) as any[];
    return JSON.stringify(
      projects.map((p) => ({
        name: p.name,
        fullName: p.path_with_namespace,
        url: p.web_url,
        isPrivate: p.visibility === "private",
        defaultBranch: p.default_branch,
        updatedAt: p.last_activity_at,
      })),
    );
  }

  return JSON.stringify({ error: `Unsupported provider: ${integration.type}` });
}

async function toolLinkRepo(ctx: ToolContext, args: Record<string, any>): Promise<string> {
  const project = await resolveProject(ctx.orgId, args.projectName);
  if (!project) return JSON.stringify({ error: `Project "${args.projectName}" not found` });

  const repoFullName = args.repoFullName;

  // Resolve integration (supports both github and gitlab)
  const integration = await resolveIntegration(ctx.orgId, args.provider);
  if (!integration) {
    return JSON.stringify({ error: "No active GitHub or GitLab integration found. Connect one first in Settings → Integrations." });
  }

  // Check if project-integration binding already exists
  const existingBinding = await prisma.projectIntegration.findUnique({
    where: { projectId_integrationId: { projectId: project.id, integrationId: integration.id } },
  });
  if (existingBinding) {
    return JSON.stringify({
      success: true,
      alreadyLinked: true,
      message: `An integration is already bound to project "${project.name}"`,
    });
  }

  if (integration.type === "github") {
    const ghToken = decrypt(integration.credentialsEnc);

    // Fetch repo info from GitHub API to get the numeric ID
    const ghRes = await fetch(`https://api.github.com/repos/${repoFullName}`, {
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "CodeSila/1.0",
      },
    });

    if (!ghRes.ok) {
      if (ghRes.status === 404) {
        return JSON.stringify({ error: `Repository "${repoFullName}" not found on GitHub. Check the name or your access permissions.` });
      }
      return JSON.stringify({ error: `GitHub API error (${ghRes.status}) when fetching repo info` });
    }

    const ghRepo = (await ghRes.json()) as any;

    await autoBindRepo(ctx, integration, project, {
      fullName: ghRepo.full_name,
      htmlUrl: ghRepo.html_url,
      defaultBranch: ghRepo.default_branch || "main",
      githubRepoId: ghRepo.id,
      isPrivate: ghRepo.private,
      provider: "github",
    });

    return JSON.stringify({
      success: true,
      message: `Linked [${ghRepo.full_name}](${ghRepo.html_url}) to project "${project.name}"`,
    });
  }

  if (integration.type === "gitlab") {
    const glToken = decrypt(integration.credentialsEnc);
    const encodedPath = encodeURIComponent(repoFullName);
    const glRes = await fetch(`https://gitlab.com/api/v4/projects/${encodedPath}`, {
      headers: { "PRIVATE-TOKEN": glToken },
    });

    if (!glRes.ok) {
      if (glRes.status === 404) {
        return JSON.stringify({ error: `Repository "${repoFullName}" not found on GitLab.` });
      }
      return JSON.stringify({ error: `GitLab API error (${glRes.status})` });
    }

    const glRepo = (await glRes.json()) as any;

    await autoBindRepo(ctx, integration, project, {
      fullName: glRepo.path_with_namespace,
      htmlUrl: glRepo.web_url,
      defaultBranch: glRepo.default_branch || "main",
      provider: "gitlab",
    });

    return JSON.stringify({
      success: true,
      message: `Linked [${glRepo.path_with_namespace}](${glRepo.web_url}) to project "${project.name}"`,
    });
  }

  return JSON.stringify({ error: `Unsupported provider: ${integration.type}` });
}

async function toolListIntegrations(ctx: ToolContext): Promise<string> {
  const integrations = await prisma.integration.findMany({
    where: { orgId: ctx.orgId, isActive: true },
    select: {
      id: true,
      type: true,
      name: true,
      username: true,
      registryUrl: true,
      createdAt: true,
    },
  });

  // Also check GitHub OAuth/App connection
  const ghInstall = await prisma.gitHubInstallation.findUnique({
    where: { orgId: ctx.orgId },
    select: { githubLogin: true, createdAt: true },
  });

  const result: any[] = integrations.map((i) => ({
    id: i.id,
    type: i.type,
    name: i.name,
    username: i.username,
    registryUrl: i.registryUrl,
    createdAt: i.createdAt.toISOString(),
  }));

  if (ghInstall) {
    result.push({
      type: "github_oauth",
      name: `GitHub (${ghInstall.githubLogin})`,
      username: ghInstall.githubLogin,
      createdAt: ghInstall.createdAt.toISOString(),
    });
  }

  if (result.length === 0) {
    return JSON.stringify({ message: "No integrations connected. Go to Settings → Integrations to add GitHub, GitLab, or Docker Registry." });
  }

  return JSON.stringify(result);
}

/* ─── Scaffold / Architecture Generation ──────────────────── */

const SCAFFOLD_SYSTEM_PROMPT = `You are a senior software architect acting as an AI code generation agent. Given a project description and tech stack, generate a complete project scaffold.

Return a JSON object with a single key "files" containing an array. Each element has "path" (relative to repo root) and "content" (full file contents).

Rules:
1. Generate a realistic, production-ready project structure — not toy examples.
2. Include: entry point, routes/controllers, models/schemas, middleware, config, .env.example, Dockerfile, docker-compose.yml, CI pipeline (.github/workflows/ci.yml), README.md, .gitignore, package.json or equivalent.
3. For TypeScript/Node.js: use ESM, strict mode, proper tsconfig.json.
4. For Python: include requirements.txt, pyproject.toml, proper __init__.py files.
5. Include meaningful placeholder logic — not just empty files. Controllers should have CRUD stubs, models should have schema definitions, etc.
6. Include a Prisma schema or equivalent ORM config if a database is specified.
7. Keep files reasonable in size (under 200 lines each).
8. Use best practices for the chosen stack (error handling, env-based config, logging).
9. Generate between 10 and 25 files. Do not exceed 25 files.
10. Return ONLY raw JSON — no markdown, no explanation, no code fences.

Example output format:
{ "files": [
  { "path": "src/index.ts", "content": "import express from 'express';\\n..." },
  { "path": "package.json", "content": "{\\n  \\"name\\": \\"my-app\\"..." },
  { "path": "Dockerfile", "content": "FROM node:22-alpine\\n..." }
] }`;

async function toolScaffoldProject(ctx: ToolContext, args: Record<string, any>): Promise<string> {
  const project = await resolveProject(ctx.orgId, args.projectName);
  if (!project) return JSON.stringify({ error: `Project "${args.projectName}" not found` });

  // Find linked GitHub repo
  const ghRepo = await prisma.gitHubRepo.findFirst({
    where: { projectId: project.id },
  });

  // Also check ProjectIntegration for repo info
  let repoFullName: string | null = ghRepo?.fullName ?? null;
  let ghToken: string | null = null;

  if (!repoFullName) {
    const projectIntegration = await prisma.projectIntegration.findFirst({
      where: { projectId: project.id },
      include: { integration: true },
    });
    if (projectIntegration?.integration?.type === "github") {
      const config = projectIntegration.configJson as any;
      repoFullName = config?.repo ?? null;
      ghToken = decrypt(projectIntegration.integration.credentialsEnc);
    }
  }

  if (!repoFullName) {
    return JSON.stringify({
      error: `Project "${project.name}" has no linked GitHub repository. Link one first with link_repo_to_project or create one with create_repo.`,
    });
  }

  // Get GitHub token
  if (!ghToken) {
    const integration = await resolveIntegration(ctx.orgId, "github");
    if (!integration) {
      return JSON.stringify({ error: "No active GitHub integration found." });
    }
    ghToken = decrypt(integration.credentialsEnc);
  }

  const branch = args.branch || project.defaultBranch || "main";
  const description = args.description;
  const stack = args.stack || inferStack(project.type);

  // Step 1: Generate files using GitHub Models API (agent-to-agent: OpenClaw → GitHub AI)
  const userPrompt =
    `Project: ${project.name}\n` +
    `Type: ${project.type}\n` +
    `Description: ${description}\n` +
    `Tech stack: ${stack}\n` +
    `Project key: ${project.key}\n` +
    (project.services?.[0]?.name ? `Primary service: ${project.services[0].name}\n` : "") +
    `\nGenerate the full project scaffold. Focus on:\n` +
    `- Production-ready project structure with proper error handling\n` +
    `- Docker and CI/CD pipeline files (.github/workflows/ci.yml)\n` +
    `- Environment-based configuration (.env.example)\n` +
    `- A comprehensive README.md with setup instructions\n` +
    `- Meaningful placeholder logic in controllers/routes (CRUD stubs, not empty files)\n`;

  let files: Array<{ path: string; content: string }>;

  try {
    files = await withRetry(
      () => generateFilesWithGitHubModels(ghToken, userPrompt),
      2, "GitHub Models generation",
    );
  } catch (err: any) {
    // Fallback: try with OpenAI if GitHub Models fails
    logger.warn({ err }, "GitHub Models API failed after retries, falling back to OpenAI");
    try {
      files = await withRetry(
        () => generateFilesWithOpenAI(userPrompt),
        2, "OpenAI generation",
      );
    } catch (err2: any) {
      return JSON.stringify({
        error: `Code generation failed: ${err2.message}. Original error: ${err.message}`,
      });
    }
  }

  if (!files || files.length === 0) {
    return JSON.stringify({ error: "Code generation returned no files." });
  }

  // Step 2: Push all files in a single atomic commit via Git Trees API
  try {
    const commitMessage =
      `scaffold: initialize ${project.name} project structure\n\n` +
      `Generated ${files.length} files with stack: ${stack}\n` +
      `Via CodeSila AI scaffold agent`;
    const { commitSha, commitUrl } = await pushFilesViaGitTree(
      ghToken, repoFullName, files, branch, commitMessage,
    );

    // Update project git URL if not set
    if (!project.gitRepositoryUrl) {
      await prisma.project.update({
        where: { id: project.id },
        data: { gitRepositoryUrl: `https://github.com/${repoFullName}` },
      }).catch(() => {});
    }

    return JSON.stringify({
      success: true,
      project: project.name,
      repo: repoFullName,
      branch,
      filesGenerated: files.length,
      filesPushed: files.length,
      pushedFiles: files.map((f) => f.path),
      commitSha,
      commitUrl,
      message:
        `Scaffolded ${files.length} files for "${project.name}" in a single commit → [${repoFullName}](${commitUrl})\n` +
        `Files: ${files.map((f) => f.path).join(", ")}`,
    });
  } catch (pushErr: any) {
    logger.error({ err: pushErr, repo: repoFullName }, "Git Trees push failed");
    return JSON.stringify({
      error: `Failed to push scaffold to GitHub: ${pushErr.message}`,
      filesGenerated: files.length,
      generatedFilePaths: files.map((f) => f.path),
      note: "Files were generated by GitHub AI but could not be pushed to the repo. You can retry.",
    });
  }
}

function inferStack(projectType: string): string {
  const stacks: Record<string, string> = {
    API: "Node.js + Express + TypeScript + Prisma + PostgreSQL",
    WEB: "React + TypeScript + Vite + TailwindCSS",
    MOBILE: "React Native + TypeScript + Expo",
    FULLSTACK: "Next.js + TypeScript + Prisma + PostgreSQL + TailwindCSS",
    DATA: "Python + FastAPI + SQLAlchemy + PostgreSQL",
    INFRA: "Terraform + Docker + GitHub Actions",
    LIBRARY: "TypeScript + tsup + vitest",
    OTHER: "Node.js + TypeScript",
  };
  return stacks[projectType] || stacks.OTHER;
}

/* ─── Retry utility ───────────────────────────────────────── */

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 2,
  label: string = "operation",
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      logger.warn({ err, attempt, label }, `${label} failed, attempt ${attempt}/${maxAttempts}`);
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }
  throw lastError!;
}

/* ─── Agent-to-Agent: GitHub Models API (Copilot-backed AI) ─ */

async function generateFilesWithGitHubModels(
  ghToken: string,
  prompt: string,
): Promise<Array<{ path: string; content: string }>> {
  const response = await fetch("https://models.github.ai/inference/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ghToken}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2025-04-01",
    },
    body: JSON.stringify({
      model: "openai/gpt-4.1",
      messages: [
        { role: "system", content: SCAFFOLD_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      max_tokens: 32000,
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`GitHub Models API ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await response.json()) as any;
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from GitHub Models API");

  return parseGeneratedFiles(content);
}

/** Fallback: generate files using OpenAI directly */
async function generateFilesWithOpenAI(prompt: string): Promise<Array<{ path: string; content: string }>> {
  const { env: appEnv } = await import("../../config/env");
  if (!appEnv.OPENAI_API_KEY) throw new Error("No OPENAI_API_KEY configured");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${appEnv.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SCAFFOLD_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      max_tokens: 16000,
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await response.json()) as any;
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from OpenAI");

  return parseGeneratedFiles(content);
}

/* ─── Resilient JSON parser (4-layer) ─────────────────────── */

function parseGeneratedFiles(raw: string): Array<{ path: string; content: string }> {
  // Layer 1: Strip markdown code fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  // Layer 2: Direct parse — handle both array and { files: [...] } wrapper
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return validateFileEntries(parsed);
    if (parsed.files && Array.isArray(parsed.files)) return validateFileEntries(parsed.files);
  } catch {
    // continue to layer 3
  }

  // Layer 3: Extract JSON array from surrounding text
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return validateFileEntries(parsed);
    } catch {
      // fall through
    }
  }

  // Layer 4: Try to repair truncated JSON (missing closing brackets)
  for (const suffix of ['"}]', '"}]}', "]", "]}"] ) {
    try {
      const repaired = cleaned + suffix;
      const parsed = JSON.parse(repaired);
      const arr = Array.isArray(parsed) ? parsed : parsed?.files;
      if (Array.isArray(arr)) return validateFileEntries(arr);
    } catch {
      // try next suffix
    }
  }

  throw new Error(
    "Failed to parse generated files. The AI model returned invalid JSON. " +
    `First 200 chars: ${raw.slice(0, 200)}`,
  );
}

function validateFileEntries(entries: any[]): Array<{ path: string; content: string }> {
  const validated = entries
    .filter((f: any) => typeof f.path === "string" && typeof f.content === "string")
    .map((f: any) => ({
      path: f.path.replace(/^\//, "").trim(),
      content: f.content,
    }))
    .filter((f) => f.path.length > 0 && f.content.length > 0);

  if (validated.length === 0) {
    throw new Error("Parsed JSON but found no valid { path, content } file entries");
  }

  return validated;
}

/* ─── Git Trees API: atomic single-commit push ────────────── */

async function pushFilesViaGitTree(
  token: string,
  repo: string,
  files: Array<{ path: string; content: string }>,
  branch: string,
  commitMessage: string,
): Promise<{ commitSha: string; commitUrl: string }> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
    "User-Agent": "CodeSila/1.0",
  };
  const baseUrl = `https://api.github.com/repos/${repo}`;

  // Step 1: Get current HEAD ref SHA
  const refRes = await fetch(`${baseUrl}/git/ref/heads/${branch}`, { headers });
  if (!refRes.ok) {
    throw new Error(`Failed to get ref heads/${branch}: ${refRes.status} ${await refRes.text()}`);
  }
  const refData = (await refRes.json()) as any;
  const latestCommitSha: string = refData.object.sha;

  // Step 2: Get base tree SHA from that commit
  const commitRes = await fetch(`${baseUrl}/git/commits/${latestCommitSha}`, { headers });
  if (!commitRes.ok) {
    throw new Error(`Failed to get commit: ${commitRes.status}`);
  }
  const commitData = (await commitRes.json()) as any;
  const baseTreeSha: string = commitData.tree.sha;

  // Step 3: Create blobs for each file (sequential to respect rate limits)
  const treeEntries: Array<{ path: string; mode: string; type: string; sha: string }> = [];

  for (const file of files) {
    const blobRes = await fetch(`${baseUrl}/git/blobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content: file.content, encoding: "utf-8" }),
    });
    if (!blobRes.ok) {
      throw new Error(`Failed to create blob for ${file.path}: ${blobRes.status}`);
    }
    const blobData = (await blobRes.json()) as any;
    treeEntries.push({
      path: file.path,
      mode: "100644", // regular file
      type: "blob",
      sha: blobData.sha,
    });
  }

  // Step 4: Create new tree with base_tree (preserves existing files like README)
  const treeRes = await fetch(`${baseUrl}/git/trees`, {
    method: "POST",
    headers,
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
  });
  if (!treeRes.ok) {
    throw new Error(`Failed to create tree: ${treeRes.status} ${await treeRes.text()}`);
  }
  const treeData = (await treeRes.json()) as any;

  // Step 5: Create commit pointing to new tree
  const newCommitRes = await fetch(`${baseUrl}/git/commits`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      message: commitMessage,
      tree: treeData.sha,
      parents: [latestCommitSha],
    }),
  });
  if (!newCommitRes.ok) {
    throw new Error(`Failed to create commit: ${newCommitRes.status}`);
  }
  const newCommitData = (await newCommitRes.json()) as any;

  // Step 6: Update branch ref to point to new commit
  const updateRefRes = await fetch(`${baseUrl}/git/refs/heads/${branch}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ sha: newCommitData.sha }),
  });
  if (!updateRefRes.ok) {
    throw new Error(`Failed to update ref: ${updateRefRes.status}`);
  }

  return {
    commitSha: newCommitData.sha,
    commitUrl: `https://github.com/${repo}/commit/${newCommitData.sha}`,
  };
}
