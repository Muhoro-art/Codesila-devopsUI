-- CreateEnum
CREATE TYPE "DropletStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'PROVISIONING', 'ERROR');

-- AlterEnum
ALTER TYPE "DeployProvider" ADD VALUE 'DIGITALOCEAN';

-- CreateTable
CREATE TABLE "droplets" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "dropletId" TEXT,
    "ipAddress" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'nyc3',
    "size" TEXT NOT NULL DEFAULT 's-1vcpu-1gb',
    "image" TEXT NOT NULL DEFAULT 'ubuntu-22-04-x64',
    "status" "DropletStatus" NOT NULL DEFAULT 'ACTIVE',
    "sshUser" TEXT NOT NULL DEFAULT 'root',
    "sshPort" INTEGER NOT NULL DEFAULT 22,
    "sshKeyFingerprint" TEXT,
    "githubConnected" BOOLEAN NOT NULL DEFAULT false,
    "vscodeReady" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "droplets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "droplet_ssh_keys" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dropletId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "addedToDroplet" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "droplet_ssh_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "droplets_dropletId_key" ON "droplets"("dropletId");
CREATE UNIQUE INDEX "droplets_orgId_name_key" ON "droplets"("orgId", "name");
CREATE INDEX "droplets_orgId_idx" ON "droplets"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "droplet_ssh_keys_dropletId_fingerprint_key" ON "droplet_ssh_keys"("dropletId", "fingerprint");
CREATE INDEX "droplet_ssh_keys_orgId_userId_idx" ON "droplet_ssh_keys"("orgId", "userId");

-- AddForeignKey
ALTER TABLE "droplets" ADD CONSTRAINT "droplets_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "droplets" ADD CONSTRAINT "droplets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "droplets" ADD CONSTRAINT "droplets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "droplet_ssh_keys" ADD CONSTRAINT "droplet_ssh_keys_dropletId_fkey" FOREIGN KEY ("dropletId") REFERENCES "droplets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "droplet_ssh_keys" ADD CONSTRAINT "droplet_ssh_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
