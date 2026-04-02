import { prisma } from "../../infra/db";

export type OrgContextSnapshot = {
	github: {
		connected: boolean;
		login: string | null;
	};
	projects: Array<{
		id: string;
		name: string;
		key: string;
		type: string;
		status: string;
		description: string | null;
		createdAt: string;
		owner: string;
		members: string[];
		repoCount: number;
		memberCount: number;
		repos: Array<{ fullName: string; defaultBranch: string }>;
	}>;
	recentCommits: Array<{
		repo: string;
		sha: string;
		message: string;
		author: string;
		branch: string;
		timestamp: string;
		additions: number;
		deletions: number;
	}>;
	ciBuilds: Array<{
		repo: string;
		project: string;
		workflow: string | null;
		branch: string;
		status: string;
		conclusion: string | null;
		startedAt: string;
	}>;
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
	degradedServices: Array<{
		id: string;
		name: string;
	}>;
	runbookUpdates: Array<{
		id: string;
		title: string;
		project: string;
		service?: string | null;
		status: string;
		updatedAt: string;
	}>;
};

export class OrgContextLoader {
	async load(
		orgId: string,
		options?: {
			projectId?: string;
			windowDays?: number;
		}
	): Promise<OrgContextSnapshot> {
		const windowDays = options?.windowDays ?? 7;
		const since = new Date();
		since.setDate(since.getDate() - windowDays);
		const projectFilter = options?.projectId
			? { projectId: options.projectId }
			: {};

		const [deployments, recentDeployments, incidents, runbooks, degradedIncidents, ghInstallation, projects, recentCommits, ciBuilds] = await Promise.all([
			prisma.deployment.findMany({
				where: { orgId, ...projectFilter },
				orderBy: { deployedAt: "desc" },
				take: 5,
				include: {
					service: { select: { name: true } },
					project: { select: { name: true } },
				},
			}),
			prisma.deployment.findMany({
				where: { orgId, startedAt: { gte: since }, ...projectFilter },
				orderBy: { startedAt: "desc" },
				take: 20,
				include: {
					service: { select: { name: true } },
					project: { select: { name: true } },
					createdBy: { select: { name: true, email: true } },
					triggeredBy: { select: { name: true, email: true } },
				},
			}),
			prisma.incident.findMany({
				where: { orgId, status: { in: ["OPEN", "MITIGATED"] }, ...projectFilter },
				orderBy: { startedAt: "desc" },
				take: 10,
				include: {
					service: { select: { name: true } },
					project: { select: { name: true } },
				},
			}),
			prisma.runbook.findMany({
				where: { orgId, ...projectFilter },
				orderBy: { updatedAt: "desc" },
				take: 5,
				include: {
					service: { select: { name: true } },
					project: { select: { name: true } },
				},
			}),
			prisma.incident.findMany({
				where: { orgId, status: { in: ["OPEN", "MITIGATED"] }, ...projectFilter },
				distinct: ["serviceId"],
				include: { service: { select: { id: true, name: true } } },
			}),
			prisma.gitHubInstallation.findUnique({
				where: { orgId },
				select: { githubLogin: true },
			}),
			prisma.project.findMany({
				where: { orgId, ...(options?.projectId ? { id: options.projectId } : {}) },
				orderBy: { createdAt: "desc" },
				take: 20,
				select: {
					id: true,
					name: true,
					key: true,
					type: true,
					status: true,
					description: true,
					createdAt: true,
					owner: { select: { name: true, email: true } },
					memberships: { select: { user: { select: { name: true, email: true } }, role: true }, take: 10 },
					githubRepos: { select: { fullName: true, defaultBranch: true } },
					_count: { select: { githubRepos: true, memberships: true } },
				},
			}),
			prisma.gitCommit.findMany({
				where: { orgId, timestamp: { gte: since }, ...(options?.projectId ? { repo: { projectId: options.projectId } } : {}) },
				orderBy: { timestamp: "desc" },
				take: 15,
				include: { repo: { select: { fullName: true } } },
			}),
			prisma.cIBuild.findMany({
				where: { orgId, ...(options?.projectId ? { projectId: options.projectId } : {}) },
				orderBy: { createdAt: "desc" },
				take: 10,
				include: {
					repo: { select: { fullName: true } },
					project: { select: { name: true } },
				},
			}),
		]);

		const durations = recentDeployments
			.filter((d) => d.finishedAt)
			.map((d) => (d.finishedAt!.getTime() - d.startedAt.getTime()) / 60000)
			.filter((d) => Number.isFinite(d));
		const meanDurationMinutes = durations.length
			? durations.reduce((sum, v) => sum + v, 0) / durations.length
			: null;

		return {
			github: {
				connected: !!ghInstallation,
				login: ghInstallation?.githubLogin ?? null,
			},
			projects: projects.map((p) => ({
				id: p.id,
				name: p.name,
				key: p.key,
				type: p.type,
				status: p.status,
				description: p.description ?? null,
				createdAt: p.createdAt.toISOString(),
				owner: p.owner?.name ?? p.owner?.email ?? "unknown",
				members: p.memberships.map((m) => `${m.user?.name ?? m.user?.email ?? "unknown"} (${m.role})`),
				repoCount: p._count.githubRepos,
				memberCount: p._count.memberships,
				repos: p.githubRepos.map((r) => ({
					fullName: r.fullName,
					defaultBranch: r.defaultBranch,
				})),
			})),
			recentCommits: recentCommits.map((c) => ({
				repo: c.repo?.fullName ?? "unknown",
				sha: c.sha.slice(0, 7),
				message: c.message.split("\n")[0].slice(0, 120),
				author: c.authorName ?? "unknown",
				branch: c.branch ?? "unknown",
				timestamp: c.timestamp.toISOString(),
				additions: c.additions,
				deletions: c.deletions,
			})),
			ciBuilds: ciBuilds.map((b) => ({
				repo: b.repo?.fullName ?? "unknown",
				project: b.project?.name ?? "unknown",
				workflow: b.workflowName,
				branch: b.branch ?? "unknown",
				status: b.status,
				conclusion: b.conclusion,
				startedAt: b.createdAt.toISOString(),
			})),
			deployments: deployments.map((d) => ({
				id: d.id,
				service: d.service?.name ?? "unknown",
				project: d.project?.name ?? "unknown",
				version: d.version,
				environment: d.environment,
				status: d.status,
				startedAt: d.startedAt.toISOString(),
				finishedAt: d.finishedAt?.toISOString() ?? null,
			})),
			deploymentStats: {
				meanDurationMinutes,
				windowDays,
			},
			deploymentActors: recentDeployments.map((d) => ({
				version: d.version,
				project: d.project?.name ?? "unknown",
				service: d.service?.name ?? "unknown",
				environment: d.environment,
				status: d.status,
				startedAt: d.startedAt.toISOString(),
				actor: d.createdBy?.name ?? d.createdBy?.email ?? null,
				triggeredBy: d.triggeredBy?.name ?? d.triggeredBy?.email ?? null,
			})),
			incidents: incidents.map((i) => ({
				id: i.id,
				project: i.project?.name ?? "unknown",
				service: i.service?.name ?? "unknown",
				severity: i.severity,
				status: i.status,
				summary: i.summary,
				startedAt: i.startedAt.toISOString(),
			})),
			degradedServices: degradedIncidents
				.map((i) => i.service)
				.filter((s): s is { id: string; name: string } => Boolean(s)),
			runbookUpdates: runbooks.map((r) => ({
				id: r.id,
				title: r.title,
				project: r.project?.name ?? "unknown",
				service: r.service?.name ?? null,
				status: r.status,
				updatedAt: r.updatedAt.toISOString(),
			})),
		};
	}

	buildContextBlock(snapshot: OrgContextSnapshot): string {
		const lines: string[] = [];

		lines.push("Operational Context:");

		// GitHub connection
		lines.push("\nGitHub Integration:");
		if (snapshot.github.connected) {
			lines.push(`- Connected as ${snapshot.github.login}`);
		} else {
			lines.push("- Not connected");
		}

		// Projects
		lines.push("\nProjects:");
		if (snapshot.projects.length === 0) {
			lines.push("- none");
		} else {
			snapshot.projects.forEach((p) => {
				lines.push(`\n  Project: ${p.name} (${p.key})`);
				lines.push(`  Type: ${p.type} | Status: ${p.status}`);
				if (p.description) lines.push(`  Description: ${p.description}`);
				lines.push(`  Owner/Creator: ${p.owner}`);
				lines.push(`  Created: ${p.createdAt}`);
				lines.push(`  Members (${p.memberCount}): ${p.members.length > 0 ? p.members.join(", ") : "none listed"}`);
				lines.push(`  Repos (${p.repoCount}): ${p.repos.map((r) => `${r.fullName} (branch: ${r.defaultBranch})`).join(", ") || "none linked"}`);
			});
		}

		// Recent commits
		lines.push("\nRecent Git commits:");
		if (snapshot.recentCommits.length === 0) {
			lines.push("- none");
		} else {
			snapshot.recentCommits.forEach((c) => {
				lines.push(
					`- [${c.sha}] ${c.repo}@${c.branch}: "${c.message}" by ${c.author} (+${c.additions}/-${c.deletions}) ${c.timestamp}`
				);
			});
		}

		// CI builds
		lines.push("\nCI/CD Builds:");
		if (snapshot.ciBuilds.length === 0) {
			lines.push("- none");
		} else {
			snapshot.ciBuilds.forEach((b) => {
				const conclusion = b.conclusion ? ` (${b.conclusion})` : "";
				lines.push(
					`- ${b.repo} ${b.workflow} ${b.branch} ${b.status}${conclusion} (${b.startedAt})`
				);
			});
		}

		lines.push("\nLast 5 deployments:");
		if (snapshot.deployments.length === 0) {
			lines.push("- none");
		} else {
			snapshot.deployments.forEach((d) => {
				const finished = d.finishedAt ? ` -> ${d.finishedAt}` : "";
				lines.push(
					`- ${d.project}/${d.service} ${d.version} ${d.environment} ${d.status} ${d.startedAt}${finished}`
				);
			});
		}

		lines.push("\nDeployment stats (last 7 days):");
		if (snapshot.deploymentStats.meanDurationMinutes == null) {
			lines.push("- mean duration: n/a");
		} else {
			lines.push(
				`- mean duration: ${snapshot.deploymentStats.meanDurationMinutes.toFixed(1)} minutes`
			);
		}

		lines.push("\nRecent deployment actors:");
		if (snapshot.deploymentActors.length === 0) {
			lines.push("- none");
		} else {
			snapshot.deploymentActors.slice(0, 5).forEach((d) => {
				const actor = d.actor ?? "unknown";
				const triggered = d.triggeredBy ? ` (triggered by ${d.triggeredBy})` : "";
				lines.push(
					`- ${d.project}/${d.service} ${d.version} ${d.environment} ${d.status} by ${actor}${triggered}`
				);
			});
		}

		lines.push("\nOpen incidents:");
		if (snapshot.incidents.length === 0) {
			lines.push("- none");
		} else {
			snapshot.incidents.forEach((i) => {
				lines.push(
					`- ${i.project}/${i.service} ${i.severity} ${i.status} ${i.summary} (${i.startedAt})`
				);
			});
		}

		lines.push("\nDegraded services:");
		if (snapshot.degradedServices.length === 0) {
			lines.push("- none");
		} else {
			snapshot.degradedServices.forEach((s) => {
				lines.push(`- ${s.name}`);
			});
		}

		lines.push("\nRecent runbook updates:");
		if (snapshot.runbookUpdates.length === 0) {
			lines.push("- none");
		} else {
			snapshot.runbookUpdates.forEach((r) => {
				const service = r.service ? `/${r.service}` : "";
				lines.push(`- ${r.project}${service} ${r.title} ${r.status} (${r.updatedAt})`);
			});
		}

		return lines.join("\n");
	}
}
