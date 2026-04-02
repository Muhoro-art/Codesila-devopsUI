import { prisma } from "../../../infra/db";

export async function getRecentCommits(orgId: string, opts?: { projectId?: string; limit?: number }) {
	const limit = opts?.limit ?? 15;
	const commits = await prisma.gitCommit.findMany({
		where: {
			orgId,
			...(opts?.projectId ? { repo: { projectId: opts.projectId } } : {}),
		},
		orderBy: { timestamp: "desc" },
		take: limit,
		include: { repo: { select: { fullName: true } } },
	});

	return commits.map((c) => ({
		repo: c.repo?.fullName ?? "unknown",
		sha: c.sha.slice(0, 7),
		message: c.message.split("\n")[0].slice(0, 120),
		author: c.authorName ?? "unknown",
		branch: c.branch ?? "unknown",
		timestamp: c.timestamp.toISOString(),
	}));
}

export async function getCommitsByRepo(orgId: string, repoFullName: string, limit = 10) {
	const commits = await prisma.gitCommit.findMany({
		where: { orgId, repo: { fullName: repoFullName } },
		orderBy: { timestamp: "desc" },
		take: limit,
	});

	return commits.map((c) => ({
		sha: c.sha.slice(0, 7),
		message: c.message.split("\n")[0].slice(0, 120),
		author: c.authorName ?? "unknown",
		branch: c.branch ?? "unknown",
		additions: c.additions,
		deletions: c.deletions,
		timestamp: c.timestamp.toISOString(),
	}));
}
