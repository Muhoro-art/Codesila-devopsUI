import { prisma } from "../../../infra/db";
import type { BillingCycle, SubscriptionStatus } from "@prisma/client";

// ─── Plan queries ───────────────────────────────────────────

export async function listPlans() {
  return prisma.plan.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });
}

export async function getPlanById(planId: string) {
  return prisma.plan.findUnique({ where: { id: planId } });
}

export async function getPlanByName(name: string) {
  return prisma.plan.findUnique({ where: { name } });
}

// ─── Subscription queries ───────────────────────────────────

export async function getOrgSubscription(orgId: string) {
  return prisma.subscription.findUnique({
    where: { orgId },
    include: { plan: true, invoices: { orderBy: { invoiceDate: "desc" }, take: 5 } },
  });
}

export async function createSubscription(data: {
  orgId: string;
  planId: string;
  billingCycle?: BillingCycle;
  trialDays?: number;
}) {
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + (data.billingCycle === "ANNUAL" ? 12 : 1));

  const trialEndsAt = data.trialDays
    ? new Date(now.getTime() + data.trialDays * 86400000)
    : null;

  return prisma.subscription.create({
    data: {
      orgId: data.orgId,
      planId: data.planId,
      status: trialEndsAt ? "TRIALING" : "ACTIVE",
      billingCycle: data.billingCycle ?? "MONTHLY",
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      trialEndsAt,
      quantity: 1,
    },
    include: { plan: true },
  });
}

export async function changePlan(orgId: string, newPlanId: string) {
  const sub = await prisma.subscription.findUnique({ where: { orgId } });
  if (!sub) throw new Error("No active subscription");

  return prisma.subscription.update({
    where: { orgId },
    data: {
      planId: newPlanId,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
    },
    include: { plan: true },
  });
}

export async function cancelSubscription(orgId: string, immediate = false) {
  const update: Record<string, unknown> = {
    cancelAtPeriodEnd: !immediate,
    cancelledAt: new Date(),
  };
  if (immediate) {
    update.status = "CANCELLED" as SubscriptionStatus;
  }

  return prisma.subscription.update({
    where: { orgId },
    data: update,
    include: { plan: true },
  });
}

export async function reactivateSubscription(orgId: string) {
  return prisma.subscription.update({
    where: { orgId },
    data: {
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      status: "ACTIVE",
    },
    include: { plan: true },
  });
}

// ─── Invoice queries ────────────────────────────────────────

export async function listInvoices(orgId: string, limit = 20) {
  const sub = await prisma.subscription.findUnique({ where: { orgId } });
  if (!sub) return [];

  return prisma.invoice.findMany({
    where: { subscriptionId: sub.id },
    orderBy: { invoiceDate: "desc" },
    take: limit,
  });
}

export async function createInvoice(subscriptionId: string, data: {
  amountDue: number;
  lineItems: unknown[];
  notes?: string;
}) {
  const invoiceNumber = `INV-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);

  return prisma.invoice.create({
    data: {
      subscriptionId,
      amountDue: data.amountDue,
      invoiceNumber,
      dueDate,
      lineItems: data.lineItems as any,
      notes: data.notes,
      status: "OPEN",
    },
  });
}

// ─── Limits check ───────────────────────────────────────────

export async function getOrgLimits(orgId: string) {
  const sub = await prisma.subscription.findUnique({
    where: { orgId },
    include: { plan: true },
  });

  if (!sub) {
    // Default to free plan limits
    const freePlan = await prisma.plan.findUnique({ where: { name: "free" } });
    return {
      maxUsers: freePlan?.maxUsers ?? 5,
      maxProjects: freePlan?.maxProjects ?? 3,
      maxStorage: Number(freePlan?.maxStorage ?? 1073741824),
      maxApiCalls: freePlan?.maxApiCalls ?? 10000,
      maxDroplets: freePlan?.maxDroplets ?? 1,
      maxWebhooks: freePlan?.maxWebhooks ?? 3,
      planName: "free",
      features: freePlan?.features ?? {},
    };
  }

  return {
    maxUsers: sub.plan.maxUsers,
    maxProjects: sub.plan.maxProjects,
    maxStorage: Number(sub.plan.maxStorage),
    maxApiCalls: sub.plan.maxApiCalls,
    maxDroplets: sub.plan.maxDroplets,
    maxWebhooks: sub.plan.maxWebhooks,
    planName: sub.plan.name,
    features: sub.plan.features,
  };
}

export async function checkLimit(orgId: string, resource: "users" | "projects" | "droplets" | "webhooks"): Promise<{ allowed: boolean; current: number; limit: number }> {
  const limits = await getOrgLimits(orgId);

  let current = 0;
  let limit = 0;

  switch (resource) {
    case "users":
      current = await prisma.user.count({ where: { orgId } });
      limit = limits.maxUsers;
      break;
    case "projects":
      current = await prisma.project.count({ where: { orgId } });
      limit = limits.maxProjects;
      break;
    case "droplets":
      current = await prisma.droplet.count({ where: { orgId } });
      limit = limits.maxDroplets;
      break;
    case "webhooks":
      current = await prisma.webhookEndpoint.count({ where: { orgId } });
      limit = limits.maxWebhooks;
      break;
  }

  return { allowed: current < limit, current, limit };
}
