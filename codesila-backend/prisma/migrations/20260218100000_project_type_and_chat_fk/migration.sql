-- CreateEnum
CREATE TYPE "ProjectType" AS ENUM ('API', 'WEB', 'MOBILE', 'FULLSTACK', 'DATA', 'INFRA', 'LIBRARY', 'OTHER');

-- AlterTable: add type column to projects
ALTER TABLE "projects" ADD COLUMN "type" "ProjectType" NOT NULL DEFAULT 'API';

-- AlterTable: rename project → projectId on chat_rooms
ALTER TABLE "chat_rooms" RENAME COLUMN "project" TO "projectId";

-- CreateIndex
CREATE UNIQUE INDEX "chat_rooms_projectId_key" ON "chat_rooms"("projectId");

-- AddForeignKey
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
