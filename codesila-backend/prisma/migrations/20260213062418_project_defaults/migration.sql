-- AlterTable
ALTER TABLE "deployments" ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "triggeredById" TEXT;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "defaultBranch" TEXT DEFAULT 'main',
ADD COLUMN     "gitRepositoryUrl" TEXT;

-- CreateTable
CREATE TABLE "project_environments" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_environments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_environments_orgId_projectId_idx" ON "project_environments"("orgId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "project_environments_projectId_key_key" ON "project_environments"("projectId", "key");

-- AddForeignKey
ALTER TABLE "project_environments" ADD CONSTRAINT "project_environments_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_environments" ADD CONSTRAINT "project_environments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
