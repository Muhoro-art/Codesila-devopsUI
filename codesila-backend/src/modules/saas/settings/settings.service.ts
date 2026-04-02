import { prisma } from "../../../infra/db";
import { OrgSize } from "@prisma/client";

// ─── Org Settings ───────────────────────────────────────────

export async function getOrgSettings(orgId: string) {
  const settings = await prisma.orgSetting.findMany({ where: { orgId } });
  const result: Record<string, string> = {};
  for (const s of settings) result[s.key] = s.value;
  return result;
}

export async function getOrgSetting(orgId: string, key: string) {
  const setting = await prisma.orgSetting.findUnique({
    where: { orgId_key: { orgId, key } },
  });
  return setting?.value ?? null;
}

export async function setOrgSetting(orgId: string, key: string, value: string) {
  return prisma.orgSetting.upsert({
    where: { orgId_key: { orgId, key } },
    create: { orgId, key, value },
    update: { value },
  });
}

export async function deleteOrgSetting(orgId: string, key: string) {
  return prisma.orgSetting.deleteMany({
    where: { orgId, key },
  });
}

export async function setOrgSettingsBatch(orgId: string, settings: Record<string, string>) {
  const ops = Object.entries(settings).map(([key, value]) =>
    prisma.orgSetting.upsert({
      where: { orgId_key: { orgId, key } },
      create: { orgId, key, value },
      update: { value },
    })
  );
  return prisma.$transaction(ops);
}

// ─── User Preferences ──────────────────────────────────────

export async function getUserPreferences(userId: string) {
  const prefs = await prisma.userPreference.findMany({ where: { userId } });
  const result: Record<string, string> = {};
  for (const p of prefs) result[p.key] = p.value;
  return result;
}

export async function getUserPreference(userId: string, key: string) {
  const pref = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key } },
  });
  return pref?.value ?? null;
}

export async function setUserPreference(userId: string, key: string, value: string) {
  return prisma.userPreference.upsert({
    where: { userId_key: { userId, key } },
    create: { userId, key, value },
    update: { value },
  });
}

export async function setUserPreferencesBatch(userId: string, preferences: Record<string, string>) {
  const ops = Object.entries(preferences).map(([key, value]) =>
    prisma.userPreference.upsert({
      where: { userId_key: { userId, key } },
      create: { userId, key, value },
      update: { value },
    })
  );
  return prisma.$transaction(ops);
}

// ─── Organization Profile ───────────────────────────────────

export async function updateOrgProfile(orgId: string, data: {
  name?: string;
  logoUrl?: string;
  domain?: string;
  industry?: string;
  size?: OrgSize;
}) {
  return prisma.organization.update({
    where: { id: orgId },
    data,
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      domain: true,
      industry: true,
      size: true,
      createdAt: true,
      _count: {
        select: {
          users: true,
          projects: true,
        },
      },
    },
  });
}

export async function getOrgProfile(orgId: string) {
  return prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      domain: true,
      industry: true,
      size: true,
      createdAt: true,
      _count: {
        select: {
          users: true,
          projects: true,
        },
      },
    },
  });
}

// ─── User Profile ───────────────────────────────────────────

export async function updateUserProfile(userId: string, data: {
  name?: string;
  avatarUrl?: string;
  timezone?: string;
  locale?: string;
}) {
  return prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      name: true,
      email: true,
      avatarUrl: true,
      timezone: true,
      locale: true,
      role: true,
    },
  });
}

export async function completeOnboarding(userId: string) {
  return prisma.user.update({
    where: { id: userId },
    data: { onboardingComplete: true },
  });
}
