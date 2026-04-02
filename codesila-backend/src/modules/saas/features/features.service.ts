import { prisma } from "../../../infra/db";

/**
 * Check if a feature is enabled for an organization.
 * Resolution priority:
 * 1. Global flags (always on for all orgs)
 * 2. Per-org override
 * 3. Plan features (from the org's subscription plan)
 * 4. Default flag value
 */
export async function isFeatureEnabled(orgId: string, featureKey: string): Promise<boolean> {
  // 1. Check global flag
  const flag = await prisma.featureFlag.findUnique({ where: { key: featureKey } });
  if (!flag) return false;
  if (flag.isGlobal && flag.defaultOn) return true;

  // 2. Check per-org override
  const override = await prisma.featureOverride.findUnique({
    where: { orgId_flagId: { orgId, flagId: flag.id } },
  });
  if (override) return override.enabled;

  // 3. Check plan features
  const sub = await prisma.subscription.findUnique({
    where: { orgId },
    include: { plan: true },
  });
  if (sub?.plan?.features) {
    const planFeatures = sub.plan.features as Record<string, boolean>;
    if (featureKey in planFeatures) return planFeatures[featureKey];
  }

  // 4. Default
  return flag.defaultOn;
}

export async function listAllFlags() {
  return prisma.featureFlag.findMany({ orderBy: { key: "asc" } });
}

export async function getOrgFeatures(orgId: string) {
  const allFlags = await prisma.featureFlag.findMany({ orderBy: { key: "asc" } });
  const overrides = await prisma.featureOverride.findMany({ where: { orgId } });
  const sub = await prisma.subscription.findUnique({
    where: { orgId },
    include: { plan: true },
  });

  const planFeatures = (sub?.plan?.features as Record<string, boolean>) ?? {};
  const overrideMap = new Map(overrides.map((o) => [o.flagId, o]));

  return allFlags.map((flag) => {
    const override = overrideMap.get(flag.id);
    let enabled = flag.defaultOn;

    if (flag.isGlobal && flag.defaultOn) {
      enabled = true;
    } else if (override) {
      enabled = override.enabled;
    } else if (flag.key in planFeatures) {
      enabled = planFeatures[flag.key];
    }

    return {
      key: flag.key,
      name: flag.name,
      description: flag.description,
      enabled,
      source: override ? "override" : flag.isGlobal ? "global" : flag.key in planFeatures ? "plan" : "default",
    };
  });
}

export async function setFeatureOverride(orgId: string, featureKey: string, enabled: boolean) {
  const flag = await prisma.featureFlag.findUnique({ where: { key: featureKey } });
  if (!flag) throw new Error(`Feature flag "${featureKey}" not found`);

  return prisma.featureOverride.upsert({
    where: { orgId_flagId: { orgId, flagId: flag.id } },
    create: { orgId, flagId: flag.id, enabled },
    update: { enabled },
  });
}

export async function removeFeatureOverride(orgId: string, featureKey: string) {
  const flag = await prisma.featureFlag.findUnique({ where: { key: featureKey } });
  if (!flag) throw new Error(`Feature flag "${featureKey}" not found`);

  return prisma.featureOverride.deleteMany({
    where: { orgId, flagId: flag.id },
  });
}

// Admin-only: create/update feature flags
export async function upsertFlag(data: {
  key: string;
  name: string;
  description?: string;
  defaultOn?: boolean;
  isGlobal?: boolean;
}) {
  return prisma.featureFlag.upsert({
    where: { key: data.key },
    create: {
      key: data.key,
      name: data.name,
      description: data.description,
      defaultOn: data.defaultOn ?? false,
      isGlobal: data.isGlobal ?? false,
    },
    update: {
      name: data.name,
      description: data.description,
      defaultOn: data.defaultOn,
      isGlobal: data.isGlobal,
    },
  });
}
