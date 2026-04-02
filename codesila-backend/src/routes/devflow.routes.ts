import { Router, type Request, type Response } from "express";
import { prisma } from "../infra/db";
import { requirePermission } from "../middlewares/requirePermission";
import { Actions } from "../modules/admin/rbac/permissions";
import { classifyIncidentSeverity } from "../modules/devflow/incidents/incident.classifier";
import { OrgContextLoader } from "../modules/assistant/context.loader";
import conveyorRouter from "../modules/devflow/conveyor/conveyor.routes";

const router = Router();
const orgContext = new OrgContextLoader();

// Mount CI/CD conveyor sub-router (§3.3)
router.use("/conveyor", conveyorRouter);

/** Roles that have full org-wide project visibility */
const ELEVATED_ROLES = new Set(["ADMIN", "SUPER_ADMIN", "MANAGER", "DEVOPS"]);

/** orgId MUST come from the JWT — never trust client headers */
function getOrgId(_req: Request, res: Response): string {
	const orgId = res.locals.user?.orgId as string | undefined;
	if (!orgId) throw new Error("Missing orgId in token");
	return orgId;
}

function getActorId(res: Response): string {
	const sub = res.locals.user?.sub as string | undefined;
	if (!sub) throw new Error("Missing sub in token");
	return sub;
}

async function logAuditEvent(input: {
	orgId: string;
	projectId?: string;
	actorId?: string;
	entityType: string;
	entityId?: string;
	action: string;
	previousState?: unknown;
	newState?: unknown;
	metadata?: Record<string, unknown>;
}) {
	const { previousState, newState, metadata, ...rest } = input;
	return prisma.auditEvent.create({
		data: {
			...rest,
			metadata: {
				...(metadata ?? {}),
				previousState: previousState as any,
				newState: newState as any,
			} as any,
		},
	});
}

/* ─── devflow/projects — redirect-style: reuses the enriched /projects data ─── */

router.get(
	"/projects",
	requirePermission(Actions.ProjectRead),
	async (req, res) => {
		try {
			const orgId = getOrgId(req, res);
			const actorId = getActorId(res);
			const role = res.locals.user?.role as string;

			// Non-elevated roles only see projects they're a member of
			const memberFilter = ELEVATED_ROLES.has(role)
				? {}
				: { memberships: { some: { userId: actorId } } };

			const projects = await prisma.project.findMany({
				where: { orgId, ...memberFilter },
				include: {
					owner: { select: { id: true, name: true, email: true, role: true } },
					memberships: {
						include: { user: { select: { id: true, name: true, email: true, role: true } } },
					},
					_count: { select: { services: true, deployments: true, incidents: true } },
					chatRoom: { select: { id: true, name: true } },
				},
				orderBy: { createdAt: "desc" },
			});
			return res.json(projects);
		} catch {
			return res.status(500).json({ error: "Failed to load projects" });
		}
	}
);

router.get(
	"/projects/:projectId",
	requirePermission(Actions.ProjectRead),
	async (req, res) => {
		try {
			const orgId = getOrgId(req, res);
			const actorId = getActorId(res);
			const role = res.locals.user?.role as string;
			const { projectId } = req.params;

			const project = await prisma.project.findFirst({
				where: { id: projectId, orgId },
				include: { services: true, memberships: { select: { userId: true } } },
			});

			if (!project) {
				return res.status(404).json({ error: "Project not found" });
			}

			// Non-elevated roles must be a member
			if (!ELEVATED_ROLES.has(role)) {
				const isMember = project.memberships?.some((m) => m.userId === actorId);
				if (!isMember) {
					return res.status(403).json({ error: "You are not a member of this project" });
				}
			}

			return res.json(project);
		} catch {
			return res.status(500).json({ error: "Failed to load project" });
		}
	}
);

router.get(
	"/projects/:projectId/services",
	requirePermission(Actions.ProjectRead),
	async (req, res) => {
		try {
			const orgId = getOrgId(req, res);
			const { projectId } = req.params;
			const services = await prisma.service.findMany({
				where: { orgId, projectId },
				orderBy: { createdAt: "desc" },
			});
			return res.json(services);
		} catch {
			return res.status(500).json({ error: "Failed to load services" });
		}
	}
);

router.post(
	"/projects/:projectId/services",
	requirePermission(Actions.ProjectAdmin),
	async (req, res) => {
		try {
			const { name, key, description, tier } = req.body ?? {};
			const { projectId } = req.params;
			const orgId = getOrgId(req, res);

			if (!name || !key) {
				return res.status(400).json({ error: "name and key required" });
			}

			const service = await prisma.service.create({
				data: {
					orgId,
					projectId,
					name,
					key,
					description,
					tier,
				},
			});

			return res.status(201).json(service);
		} catch (err: any) {
			if (err?.code === "P2002") {
				return res.status(409).json({ error: "Service key already exists" });
			}
			return res.status(500).json({ error: "Failed to create service" });
		}
	}
);

router.get(
	"/deployments",
	requirePermission(Actions.DeploymentRead),
	async (req, res) => {
		try {
			const orgId = getOrgId(req, res);
			const { projectId, serviceId } = req.query;
			const deployments = await prisma.deployment.findMany({
				where: {
					orgId,
					...(projectId ? { projectId: String(projectId) } : {}),
					...(serviceId ? { serviceId: String(serviceId) } : {}),
				},
				orderBy: { deployedAt: "desc" },
			});
			return res.json(deployments);
		} catch {
			return res.status(500).json({ error: "Failed to load deployments" });
		}
	}
);

router.get(
	"/runbooks",
	requirePermission(Actions.ProjectRead),
	async (req, res) => {
		try {
			const orgId = getOrgId(req, res);
			const { projectId, serviceId } = req.query;
			const runbooks = await prisma.runbook.findMany({
				where: {
					orgId,
					...(projectId ? { projectId: String(projectId) } : {}),
					...(serviceId ? { serviceId: String(serviceId) } : {}),
				},
				orderBy: { updatedAt: "desc" },
			});
			return res.json(runbooks);
		} catch {
			return res.status(500).json({ error: "Failed to load runbooks" });
		}
	}
);

router.post(
	"/runbooks",
	requirePermission(Actions.RunbookEdit),
	async (req, res) => {
		try {
			const { projectId, serviceId, title, content, status } = req.body ?? {};
			const orgId = getOrgId(req, res);
			const createdById = res.locals.user?.sub as string | undefined;

			if (!projectId || !title || !content) {
				return res.status(400).json({ error: "projectId, title, content required" });
			}

			const runbook = await prisma.runbook.create({
				data: {
					orgId,
					projectId,
					serviceId,
					title,
					content,
					status,
					createdById,
					updatedById: createdById,
				},
			});

			await logAuditEvent({
				orgId,
				projectId,
				actorId: createdById,
				entityType: "runbook",
				entityId: runbook.id,
				action: "runbook.create",
				newState: runbook,
			});

			return res.status(201).json(runbook);
		} catch {
			return res.status(500).json({ error: "Failed to create runbook" });
		}
	}
);

router.patch(
	"/runbooks/:runbookId",
	requirePermission(Actions.RunbookEdit),
	async (req, res) => {
		try {
			const { runbookId } = req.params;
			const { title, content, status } = req.body ?? {};
			const orgId = getOrgId(req, res);
			const updatedById = res.locals.user?.sub as string | undefined;

			if (!title && !content && !status) {
				return res.status(400).json({ error: "No changes provided" });
			}

			const existing = await prisma.runbook.findFirst({
				where: { id: runbookId, orgId },
			});

			if (!existing) {
				return res.status(404).json({ error: "Runbook not found" });
			}

			const runbook = await prisma.runbook.update({
				where: { id: runbookId },
				data: {
					...(title ? { title } : {}),
					...(content ? { content } : {}),
					...(status ? { status } : {}),
					...(updatedById ? { updatedById } : {}),
					updatedAt: new Date(),
				},
			});

			await logAuditEvent({
				orgId,
				projectId: runbook.projectId,
				actorId: updatedById,
				entityType: "runbook",
				entityId: runbook.id,
				action: "runbook.update",
				previousState: existing,
				newState: runbook,
			});

			return res.json(runbook);
		} catch {
			return res.status(500).json({ error: "Failed to update runbook" });
		}
	}
);

router.get(
	"/incidents",
	requirePermission(Actions.IncidentManage),
	async (req, res) => {
		try {
			const orgId = getOrgId(req, res);
			const { projectId, serviceId, status } = req.query;
			const incidents = await prisma.incident.findMany({
				where: {
					orgId,
					...(projectId ? { projectId: String(projectId) } : {}),
					...(serviceId ? { serviceId: String(serviceId) } : {}),
				...(status ? { status: String(status) as any } : {}),
				},
				orderBy: { startedAt: "desc" },
			});
			return res.json(incidents);
		} catch {
			return res.status(500).json({ error: "Failed to load incidents" });
		}
	}
);

router.post(
	"/incidents",
	requirePermission(Actions.IncidentManage),
	async (req, res) => {
		try {
			const { projectId, serviceId, severity, summary, description, deploymentId } = req.body ?? {};
			const orgId = getOrgId(req, res);
			const ownerId = res.locals.user?.sub as string | undefined;

			if (!projectId || !serviceId || !summary) {
				return res.status(400).json({ error: "projectId, serviceId, summary required" });
			}

			const computedSeverity = severity
				? String(severity)
				: await classifyIncidentSeverity({
					summary,
					description,
				});

			const incident = await prisma.incident.create({
				data: {
					orgId,
					projectId,
					serviceId,
					deploymentId,
					severity: computedSeverity as any,
					summary,
					description,
					ownerId,
				},
			});

			await logAuditEvent({
				orgId,
				projectId,
				actorId: ownerId,
				entityType: "incident",
				entityId: incident.id,
				action: "incident.create",
				newState: incident,
			});

			return res.status(201).json(incident);
		} catch {
			return res.status(500).json({ error: "Failed to create incident" });
		}
	}
);

router.patch(
	"/incidents/:incidentId",
	requirePermission(Actions.IncidentManage),
	async (req, res) => {
		try {
			const { incidentId } = req.params;
			const { status, resolvedAt, summary, description, ownerId, severity, autoClassify } = req.body ?? {};
			const orgId = getOrgId(req, res);

			if (!status && !resolvedAt && !summary && !description && !ownerId && !severity && !autoClassify) {
				return res.status(400).json({ error: "No changes provided" });
			}

			const existing = await prisma.incident.findFirst({
				where: { id: incidentId, orgId },
			});

			if (!existing) {
				return res.status(404).json({ error: "Incident not found" });
			}

			const nextSummary = summary ?? existing.summary;
			const nextDescription = description ?? existing.description;
			const nextSeverity = autoClassify
				? await classifyIncidentSeverity({
						summary: nextSummary,
						description: nextDescription,
					})
				: severity;

			const incident = await prisma.incident.update({
				where: { id: incidentId },
				data: {
					...(status ? { status } : {}),
					...(resolvedAt ? { resolvedAt: new Date(resolvedAt) } : {}),
					...(summary ? { summary } : {}),
					...(description ? { description } : {}),
					...(ownerId ? { ownerId } : {}),
					...(nextSeverity ? { severity: nextSeverity } : {}),
					updatedAt: new Date(),
				},
			});

			await logAuditEvent({
				orgId,
				projectId: incident.projectId,
				actorId: res.locals.user?.sub as string | undefined,
				entityType: "incident",
				entityId: incident.id,
				action: "incident.update",
				previousState: existing,
				newState: incident,
			});

			return res.json(incident);
		} catch {
			return res.status(500).json({ error: "Failed to update incident" });
		}
	}
);

router.post(
	"/deployments",
	requirePermission(Actions.DeploymentCreate),
	async (req, res) => {
		try {
			const { serviceId, version, environment, status, startedAt, finishedAt, triggeredBy } = req.body ?? {};
			const orgId = getOrgId(req, res);
			const actorId = res.locals.user?.sub as string | undefined;

			if (!serviceId || !version || !environment) {
				return res.status(400).json({ error: "serviceId, version, environment required" });
			}

			const service = await prisma.service.findFirst({
				where: { id: serviceId, orgId },
			});

			if (!service) {
				return res.status(404).json({ error: "Service not found" });
			}

			const startedAtDate = startedAt ? new Date(startedAt) : new Date();
			const finishedAtDate = finishedAt ? new Date(finishedAt) : undefined;
			const deployedAt = finishedAtDate ?? startedAtDate;

			const deployment = await prisma.deployment.create({
				data: {
					orgId,
					projectId: service.projectId,
					serviceId,
					version,
					environment,
					status,
					startedAt: startedAtDate,
					finishedAt: finishedAtDate,
					deployedAt,
					triggeredById: triggeredBy ?? actorId,
					createdById: actorId,
				},
			});

			await logAuditEvent({
				orgId,
				projectId: service.projectId,
				actorId,
				entityType: "deployment",
				entityId: deployment.id,
				action: "deployment.create",
				newState: deployment,
			});

			// Trigger real deployment execution asynchronously
			// The deployment record is returned immediately; execution happens in background
			const { executeDeployment } = await import("../modules/devflow/conveyor/deployment-executor");
			const project = await prisma.project.findUnique({ where: { id: service.projectId } });

			if (project) {
				executeDeployment({
					orgId,
					projectId: service.projectId,
					projectName: project.name,
					version,
					environment,
				}).then(async (result) => {
					const finalStatus = result.status === "SUCCESS" ? "SUCCESS" : "FAILED";
					await prisma.deployment.update({
						where: { id: deployment.id },
						data: {
							status: finalStatus,
							finishedAt: result.finishedAt ?? new Date(),
						},
					}).catch(() => {});

					await logAuditEvent({
						orgId,
						projectId: service.projectId,
						actorId,
						entityType: "deployment",
						entityId: deployment.id,
						action: `deployment.${finalStatus.toLowerCase()}`,
						newState: { status: finalStatus, logs: result.logs },
					}).catch(() => {});
				}).catch(() => {});
			}

			return res.status(201).json(deployment);
		} catch {
			return res.status(500).json({ error: "Failed to create deployment" });
		}
	}
);

router.get(
	"/audit",
	requirePermission(Actions.ProjectRead),
	async (req, res) => {
		try {
			const orgId = getOrgId(req, res);
			const { projectId, entityType, actorId, limit } = req.query;
			const take = Math.min(Number(limit) || 50, 200);

			const events = await prisma.auditEvent.findMany({
				where: {
					orgId,
					...(projectId ? { projectId: String(projectId) } : {}),
					...(entityType ? { entityType: String(entityType) } : {}),
					...(actorId ? { actorId: String(actorId) } : {}),
				},
				orderBy: { createdAt: "desc" },
				take,
			});

			return res.json(events);
		} catch {
			return res.status(500).json({ error: "Failed to load audit events" });
		}
	}
);

router.get(
	"/insights",
	requirePermission(Actions.ProjectRead),
	async (req, res) => {
		try {
			const orgId = getOrgId(req, res);
			const { projectId, windowDays } = req.query;
			const snapshot = await orgContext.load(orgId, {
				projectId: projectId ? String(projectId) : undefined,
				windowDays: windowDays ? Number(windowDays) : undefined,
			});
			return res.json(snapshot);
		} catch {
			return res.status(500).json({ error: "Failed to load insights" });
		}
	}
);

// ─── Pipeline Run (§3.3) ────────────────────────────────────
router.post(
	"/pipelines/run",
	requirePermission(Actions.PipelineRun),
	async (req: Request, res: Response) => {
		try {
			const orgId = getOrgId(req, res);
			const actorId = getActorId(res);
			const { projectId, branch, pipelineName } = req.body ?? {};
			return res.json({
				ok: true,
				message: "Pipeline triggered",
				orgId,
				actorId,
				projectId: projectId ?? null,
				branch: branch ?? "main",
				pipelineName: pipelineName ?? "default",
			});
		} catch {
			return res.status(500).json({ error: "Failed to trigger pipeline" });
		}
	}
);

export default router;
