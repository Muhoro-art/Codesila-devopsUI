import { prisma } from "../../../infra/db";

export async function getRecentBuilds(orgId: string, opts?: { projectId?: string; limit?: number }) {
	const limit = opts?.limit ?? 10;
	const builds = await prisma.cIBuild.findMany({
		where: {
			orgId,
			...(opts?.projectId ? { projectId: opts.projectId } : {}),
		},
		orderBy: { createdAt: "desc" },
		take: limit,
		include: {
			repo: { select: { fullName: true } },
			project: { select: { name: true } },
		},
	});

	return builds.map((b) => ({
		repo: b.repo?.fullName ?? "unknown",
		project: b.project?.name ?? "unknown",
		workflow: b.workflowName,
		branch: b.branch ?? "unknown",
		status: b.status,
		conclusion: b.conclusion,
		startedAt: b.createdAt.toISOString(),
		htmlUrl: b.htmlUrl,
	}));
}

export async function getBuildSummary(orgId: string, projectId?: string) {
	const where = { orgId, ...(projectId ? { projectId } : {}) };
	const [total, success, failure] = await Promise.all([
		prisma.cIBuild.count({ where }),
		prisma.cIBuild.count({ where: { ...where, conclusion: "success" } }),
		prisma.cIBuild.count({ where: { ...where, conclusion: "failure" } }),
	]);

	return {
		total,
		success,
		failure,
		other: total - success - failure,
		successRate: total > 0 ? Math.round((success / total) * 100) : null,
	};
}
