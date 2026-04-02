import { prisma } from "../../../infra/db";
import type { DataExportType } from "@prisma/client";

export async function requestExport(data: {
  orgId: string;
  requestedById: string;
  type: DataExportType;
  format?: string;
}) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // export links expire in 7 days

  return prisma.dataExport.create({
    data: {
      orgId: data.orgId,
      requestedById: data.requestedById,
      type: data.type,
      format: data.format ?? "json",
      status: "PENDING",
      expiresAt,
    },
  });
}

export async function listExports(orgId: string) {
  return prisma.dataExport.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      requestedBy: { select: { id: true, name: true, email: true } },
    },
  });
}

export async function getExport(id: string, orgId: string) {
  return prisma.dataExport.findFirst({
    where: { id, orgId },
  });
}

/**
 * Process an export — in production this would be a background job.
 * For now it generates JSON in-memory.
 */
export async function processExport(exportId: string) {
  const exportReq = await prisma.dataExport.findUnique({ where: { id: exportId } });
  if (!exportReq) throw new Error("Export not found");

  await prisma.dataExport.update({
    where: { id: exportId },
    data: { status: "PROCESSING" },
  });

  try {
    let data: unknown;

    switch (exportReq.type) {
      case "FULL_ORG":
        data = await exportFullOrg(exportReq.orgId);
        break;
      case "USER_DATA":
        data = await exportUserData(exportReq.requestedById);
        break;
      case "AUDIT_LOGS":
        data = await exportAuditLogs(exportReq.orgId);
        break;
      case "PROJECTS":
        data = await exportProjects(exportReq.orgId);
        break;
      case "BILLING":
        data = await exportBilling(exportReq.orgId);
        break;
    }

    const jsonStr = JSON.stringify(data, null, 2);
    const fileSize = Buffer.byteLength(jsonStr, "utf8");

    // In production, upload to S3/GCS and store URL
    // For now, store a placeholder URL
    await prisma.dataExport.update({
      where: { id: exportId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        fileSize: BigInt(fileSize),
        fileUrl: `/api/saas/exports/${exportId}/download`,
      },
    });

    return data;
  } catch (err: any) {
    await prisma.dataExport.update({
      where: { id: exportId },
      data: {
        status: "FAILED",
        error: err.message,
      },
    });
    throw err;
  }
}

async function exportFullOrg(orgId: string) {
  const [org, users, projects] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId } }),
    prisma.user.findMany({
      where: { orgId },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    }),
    prisma.project.findMany({
      where: { orgId },
      select: { id: true, name: true, key: true, status: true, createdAt: true },
    }),
  ]);
  return { organization: org, users, projects, exportedAt: new Date() };
}

async function exportUserData(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, name: true, role: true, timezone: true, locale: true,
      createdAt: true, updatedAt: true,
    },
  });
  const preferences = await prisma.userPreference.findMany({ where: { userId } });
  return { user, preferences, exportedAt: new Date() };
}

async function exportAuditLogs(orgId: string) {
  const events = await prisma.auditEvent.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take: 10000,
  });
  return { auditEvents: events, count: events.length, exportedAt: new Date() };
}

async function exportProjects(orgId: string) {
  const projects = await prisma.project.findMany({
    where: { orgId },
    include: {
      environments: true,
      memberships: { include: { user: { select: { email: true, name: true } } } },
    },
  });
  return { projects, exportedAt: new Date() };
}

async function exportBilling(orgId: string) {
  const sub = await prisma.subscription.findUnique({
    where: { orgId },
    include: { plan: true, invoices: true },
  });
  return { subscription: sub, exportedAt: new Date() };
}
