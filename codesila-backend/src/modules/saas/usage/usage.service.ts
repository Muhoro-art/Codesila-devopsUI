import { prisma } from "../../../infra/db";
import type { UsageMetric } from "@prisma/client";

/**
 * Record or increment a usage metric for the current billing period.
 */
export async function recordUsage(orgId: string, metric: UsageMetric, amount: number = 1) {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  // Upsert: try to find existing record for this period, else create
  const existing = await prisma.usageRecord.findFirst({
    where: {
      orgId,
      metric,
      periodStart: { gte: periodStart },
      periodEnd: { lte: new Date(periodEnd.getTime() + 86400000) },
    },
  });

  if (existing) {
    return prisma.usageRecord.update({
      where: { id: existing.id },
      data: { value: { increment: amount } },
    });
  }

  return prisma.usageRecord.create({
    data: {
      orgId,
      metric,
      value: amount,
      periodStart,
      periodEnd,
    },
  });
}

/**
 * Get current period usage for all metrics
 */
export async function getCurrentUsage(orgId: string) {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const records = await prisma.usageRecord.findMany({
    where: {
      orgId,
      periodStart: { gte: periodStart },
    },
  });

  const usage: Record<string, number> = {};
  for (const record of records) {
    usage[record.metric] = Number(record.value);
  }

  return usage;
}

/**
 * Get usage history for a metric over N months
 */
export async function getUsageHistory(orgId: string, metric: UsageMetric, months: number = 6) {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth() - months, 1);

  return prisma.usageRecord.findMany({
    where: {
      orgId,
      metric,
      periodStart: { gte: startDate },
    },
    orderBy: { periodStart: "asc" },
  });
}

/**
 * Get a summary dashboard for org usage vs limits
 */
export async function getUsageSummary(orgId: string) {
  const [usage, userCount, projectCount, dropletCount] = await Promise.all([
    getCurrentUsage(orgId),
    prisma.user.count({ where: { orgId } }),
    prisma.project.count({ where: { orgId } }),
    prisma.droplet.count({ where: { orgId } }),
  ]);

  // Get plan limits
  const sub = await prisma.subscription.findUnique({
    where: { orgId },
    include: { plan: true },
  });

  const plan = sub?.plan;

  return {
    currentPeriod: {
      apiCalls: usage.API_CALLS ?? 0,
      storage: usage.STORAGE_BYTES ?? 0,
      ciBuilds: usage.CI_BUILDS ?? 0,
      deployments: usage.DEPLOYMENTS ?? 0,
      chatMessages: usage.CHAT_MESSAGES ?? 0,
      assistantQueries: usage.ASSISTANT_QUERIES ?? 0,
    },
    resources: {
      users: userCount,
      projects: projectCount,
      droplets: dropletCount,
    },
    limits: plan
      ? {
          maxUsers: plan.maxUsers,
          maxProjects: plan.maxProjects,
          maxStorage: Number(plan.maxStorage),
          maxApiCalls: plan.maxApiCalls,
          maxDroplets: plan.maxDroplets,
        }
      : null,
    plan: plan?.name ?? "free",
    subscription: sub
      ? {
          status: sub.status,
          billingCycle: sub.billingCycle,
          currentPeriodEnd: sub.currentPeriodEnd,
        }
      : null,
  };
}
