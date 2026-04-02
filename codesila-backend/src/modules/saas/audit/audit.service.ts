import { prisma } from "../../../infra/db";

/**
 * Enhanced audit service — wraps the existing AuditEvent model with
 * a cleaner interface for the SaaS platform.
 */

export interface AuditLogEntry {
  orgId: string;
  actorId?: string;
  projectId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export async function log(entry: AuditLogEntry) {
  return prisma.auditEvent.create({
    data: {
      orgId: entry.orgId,
      actorId: entry.actorId,
      projectId: entry.projectId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: entry.metadata as any,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
    },
  });
}

export async function listAuditLogs(orgId: string, options?: {
  actorId?: string;
  entityType?: string;
  action?: string;
  projectId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}) {
  const where: Record<string, unknown> = { orgId };
  if (options?.actorId) where.actorId = options.actorId;
  if (options?.entityType) where.entityType = options.entityType;
  if (options?.action) where.action = { contains: options.action };
  if (options?.projectId) where.projectId = options.projectId;
  if (options?.startDate || options?.endDate) {
    where.createdAt = {};
    if (options?.startDate) (where.createdAt as any).gte = options.startDate;
    if (options?.endDate) (where.createdAt as any).lte = options.endDate;
  }

  const [items, total] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
      include: {
        actor: { select: { id: true, name: true, email: true } },
        project: { select: { id: true, name: true } },
      },
    }),
    prisma.auditEvent.count({ where }),
  ]);

  return { items, total };
}

export async function getAuditStats(orgId: string, days: number = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const events = await prisma.auditEvent.groupBy({
    by: ["action"],
    where: {
      orgId,
      createdAt: { gte: startDate },
    },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 20,
  });

  const totalCount = await prisma.auditEvent.count({
    where: { orgId, createdAt: { gte: startDate } },
  });

  return {
    totalEvents: totalCount,
    topActions: events.map((e) => ({ action: e.action, count: e._count.id })),
    period: { startDate, endDate: new Date() },
  };
}
