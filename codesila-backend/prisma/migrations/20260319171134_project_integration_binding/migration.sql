-- AlterTable
ALTER TABLE "integrations" ADD COLUMN     "ownerScope" TEXT NOT NULL DEFAULT 'org';

-- CreateTable
CREATE TABLE "project_integrations" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "configJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_integrations_projectId_idx" ON "project_integrations"("projectId");

-- CreateIndex
CREATE INDEX "project_integrations_integrationId_idx" ON "project_integrations"("integrationId");

-- CreateIndex
CREATE UNIQUE INDEX "project_integrations_projectId_integrationId_key" ON "project_integrations"("projectId", "integrationId");

-- AddForeignKey
ALTER TABLE "project_integrations" ADD CONSTRAINT "project_integrations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_integrations" ADD CONSTRAINT "project_integrations_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
