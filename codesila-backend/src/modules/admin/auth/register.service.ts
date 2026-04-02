import { prisma } from "../../../infra/db";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { env } from "../../../config/env";
import { SECURITY } from "../../../config/constants";
import { logSecurityEvent } from "../../../config/logger";
import type { OrgSize } from "@prisma/client";

function validatePassword(password: string): string | null {
  if (password.length < SECURITY.PASSWORD.MIN_LENGTH)
    return `Password must be at least ${SECURITY.PASSWORD.MIN_LENGTH} characters`;
  if (password.length > SECURITY.PASSWORD.MAX_LENGTH)
    return `Password must not exceed ${SECURITY.PASSWORD.MAX_LENGTH} characters`;
  if (!/[A-Z]/.test(password))
    return "Password must contain at least one uppercase letter";
  if (!/[a-z]/.test(password))
    return "Password must contain at least one lowercase letter";
  if (!/[0-9]/.test(password))
    return "Password must contain at least one number";
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password))
    return "Password must contain at least one special character";
  // Reject common passwords
  const lower = password.toLowerCase();
  for (const blocked of SECURITY.PASSWORD.BLOCKED_PATTERNS) {
    if (lower.includes(blocked))
      return "Password is too common. Choose a stronger password.";
  }
  return null;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export interface RegisterCompanyInput {
  // Company info
  companyName: string;
  industry?: string;
  companySize: OrgSize;
  domain?: string;

  // Admin user info
  email: string;
  password: string;
  fullName: string;
  jobTitle?: string;
}

/**
 * Registers a new company (organization) along with the founding admin user.
 * Automatically assigns the free "Startup" plan subscription.
 *
 * Returns a JWT so the user is logged in immediately after registration.
 */
export async function registerCompany(input: RegisterCompanyInput) {
  // ── Validate password ──────────────────────────────────────
  const passwordError = validatePassword(input.password);
  if (passwordError) throw new Error(passwordError);

  // ── Check email uniqueness ──────────────────────────────────
  const existingUser = await prisma.user.findUnique({
    where: { email: input.email },
  });
  if (existingUser) throw new Error("An account with this email already exists");

  // ── Generate unique slug ───────────────────────────────────
  let slug = slugify(input.companyName);
  const existingOrg = await prisma.organization.findUnique({ where: { slug } });
  if (existingOrg) {
    slug = `${slug}-${Date.now().toString(36)}`;
  }

  // ── Check domain uniqueness (if provided) ──────────────────
  if (input.domain) {
    const existingDomain = await prisma.organization.findUnique({
      where: { domain: input.domain },
    });
    if (existingDomain) throw new Error("This domain is already registered");
  }

  // ── Hash password (with strengthened rounds) ───────────────
  const passwordHash = await bcrypt.hash(input.password, SECURITY.PASSWORD.BCRYPT_ROUNDS);

  // ── Find the free/startup plan ─────────────────────────────
  const starterPlan = await prisma.plan.findFirst({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" }, // cheapest first
  });

  // ── Create org + admin user + subscription in a transaction ─
  const result = await prisma.$transaction(async (tx) => {
    // 1. Create organization
    const org = await tx.organization.create({
      data: {
        name: input.companyName,
        slug,
        domain: input.domain || null,
        industry: input.industry || null,
        size: input.companySize,
      },
    });

    // 2. Create the founding admin user
    const user = await tx.user.create({
      data: {
        email: input.email,
        passwordHash,
        name: input.fullName,
        role: "ADMIN",
        orgId: org.id,
        isActive: true,
        onboardingComplete: false,
      },
    });

    // 3. Auto-assign the startup/free plan
    let subscription = null;
    if (starterPlan) {
      const periodEnd = new Date();
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      subscription = await tx.subscription.create({
        data: {
          orgId: org.id,
          planId: starterPlan.id,
          status: "ACTIVE",
          billingCycle: "MONTHLY",
          currentPeriodStart: new Date(),
          currentPeriodEnd: periodEnd,
          quantity: 1,
        },
        include: { plan: true },
      });
    }

    return { org, user, subscription };
  });

  // ── Issue JWT with hardened options ─────────────────────────
  const token = jwt.sign(
    {
      sub: result.user.id,
      role: result.user.role,
      orgId: result.org.id,
      email: result.user.email,
      type: "access",
    },
    env.JWT_SECRET,
    {
      expiresIn: SECURITY.JWT.ACCESS_TOKEN_EXPIRY,
      algorithm: SECURITY.JWT.ALGORITHM,
      issuer: SECURITY.JWT.ISSUER,
      audience: SECURITY.JWT.AUDIENCE,
    }
  );

  logSecurityEvent({
    event: "USER_CREATED",
    userId: result.user.id,
    orgId: result.org.id,
    severity: "LOW",
    details: { email: input.email, role: "ADMIN", action: "company_registration" },
  });

  return {
    token,
    user: {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      role: result.user.role,
      orgId: result.org.id,
      onboardingComplete: result.user.onboardingComplete,
    },
    organization: {
      id: result.org.id,
      name: result.org.name,
      slug: result.org.slug,
      industry: result.org.industry,
      size: result.org.size,
      logoUrl: result.org.logoUrl,
    },
    subscription: result.subscription
      ? {
          planName: result.subscription.plan.displayName,
          status: result.subscription.status,
        }
      : null,
  };
}
