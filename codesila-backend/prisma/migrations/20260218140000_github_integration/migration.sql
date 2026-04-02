-- CreateEnum
CREATE TYPE "CIBuildStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SUCCESS', 'FAILURE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeployProvider" AS ENUM ('AWS_ECS', 'AWS_LAMBDA', 'RAILWAY', 'VERCEL', 'DOCKER', 'K8S', 'CUSTOM');

-- CreateTable
CREATE TABLE "github_installations" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "installationId" INTEGER,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "githubLogin" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "scope" TEXT,
    "connectedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_repos" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "githubRepoId" INTEGER NOT NULL,
    "fullName" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "private" BOOLEAN NOT NULL DEFAULT false,
    "htmlUrl" TEXT NOT NULL,
    "webhookId" INTEGER,
    "webhookSecret" TEXT,
    "trackPushes" BOOLEAN NOT NULL DEFAULT true,
    "trackPRs" BOOLEAN NOT NULL DEFAULT true,
    "trackBuilds" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_repos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "git_commits" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "sha" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorEmail" TEXT NOT NULL,
    "authorAvatar" TEXT,
    "branch" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "additions" INTEGER NOT NULL DEFAULT 0,
    "deletions" INTEGER NOT NULL DEFAULT 0,
    "filesChanged" INTEGER NOT NULL DEFAULT 0,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "git_commits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ci_builds" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "runId" INTEGER,
    "workflowName" TEXT,
    "branch" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "status" "CIBuildStatus" NOT NULL DEFAULT 'PENDING',
    "conclusion" TEXT,
    "htmlUrl" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationSecs" INTEGER,
    "triggeredBy" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ci_builds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployment_targets" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "environment" "Environment" NOT NULL,
    "provider" "DeployProvider" NOT NULL DEFAULT 'CUSTOM',
    "name" TEXT NOT NULL,
    "url" TEXT,
    "region" TEXT,
    "configJson" JSONB,
    "lastDeployAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deployment_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "github_installations_orgId_key" ON "github_installations"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "github_repos_projectId_githubRepoId_key" ON "github_repos"("projectId", "githubRepoId");

-- CreateIndex
CREATE INDEX "github_repos_orgId_idx" ON "github_repos"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "git_commits_repoId_sha_key" ON "git_commits"("repoId", "sha");

-- CreateIndex
CREATE INDEX "git_commits_orgId_repoId_idx" ON "git_commits"("orgId", "repoId");

-- CreateIndex
CREATE UNIQUE INDEX "ci_builds_repoId_runId_key" ON "ci_builds"("repoId", "runId");

-- CreateIndex
CREATE INDEX "ci_builds_orgId_projectId_idx" ON "ci_builds"("orgId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "deployment_targets_projectId_environment_name_key" ON "deployment_targets"("projectId", "environment", "name");

-- CreateIndex
CREATE INDEX "deployment_targets_orgId_idx" ON "deployment_targets"("orgId");

-- AddForeignKey
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_repos" ADD CONSTRAINT "github_repos_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_repos" ADD CONSTRAINT "github_repos_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_repos" ADD CONSTRAINT "github_repos_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "github_installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "git_commits" ADD CONSTRAINT "git_commits_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "github_repos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ci_builds" ADD CONSTRAINT "ci_builds_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "github_repos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ci_builds" ADD CONSTRAINT "ci_builds_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_targets" ADD CONSTRAINT "deployment_targets_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_targets" ADD CONSTRAINT "deployment_targets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
