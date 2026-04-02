// src/modules/admin/users/createUser.handler.ts
import { Request, Response } from "express";
import { prisma } from "../../../infra/db";
import bcrypt from "bcrypt";
import { z } from "zod";
import { Role } from "@prisma/client";
import { SECURITY } from "../../../config/constants";
import { logSecurityEvent } from "../../../config/logger";
import { sanitizeEmail, sanitizeString } from "../../../shared/utils/sanitize";

const ALLOWED_ROLES = [
  "ADMIN",
  "USER",
  "DEVELOPER",
  "DEVOPS",
  "MANAGER",
  "SUPER_ADMIN",
];

const createUserSchema = z.object({
  email: z.string().email("Invalid email format").max(254),
  password: z
    .string()
    .min(SECURITY.PASSWORD.MIN_LENGTH, `Password must be at least ${SECURITY.PASSWORD.MIN_LENGTH} characters`)
    .max(SECURITY.PASSWORD.MAX_LENGTH)
    .regex(/[A-Z]/, "Password must contain an uppercase letter")
    .regex(/[a-z]/, "Password must contain a lowercase letter")
    .regex(/[0-9]/, "Password must contain a number")
    .regex(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/, "Password must contain a special character"),
  role: z.enum(ALLOWED_ROLES as [string, ...string[]]),
});

function getRoleLevel(role: string): number {
  return SECURITY.ROLE_HIERARCHY[role] ?? 0;
}

export async function createUserHandler(req: Request, res: Response) {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => e.message).join("; ");
      return res.status(400).json({ error: message });
    }

    const { password, role } = parsed.data;
    const email = sanitizeEmail(parsed.data.email);

    // Enforce role hierarchy — cannot create users with equal or higher role
    const requesterRole = res.locals.user?.role;
    const requesterLevel = getRoleLevel(requesterRole);
    const targetLevel = getRoleLevel(role);

    if (targetLevel >= requesterLevel) {
      logSecurityEvent({
        event: "PRIVILEGE_ESCALATION_ATTEMPT",
        userId: res.locals.user?.sub,
        orgId: res.locals.user?.orgId,
        ip: req.ip,
        severity: "HIGH",
        details: {
          action: "create_user",
          requestedRole: role,
          requesterRole,
        },
      });
      return res.status(403).json({
        error: "Cannot create a user with equal or higher privileges",
      });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: "User already exists" });
    }

    const passwordHash = await bcrypt.hash(password, SECURITY.PASSWORD.BCRYPT_ROUNDS);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: role as Role,
        isActive: true,
        orgId: res.locals.user.orgId,
      },
    });

    logSecurityEvent({
      event: "USER_CREATED",
      userId: res.locals.user?.sub,
      orgId: res.locals.user?.orgId,
      severity: "LOW",
      details: { targetId: user.id, email, role },
    });

    return res.status(201).json({
      id: user.id,
      email: user.email,
      role: user.role,
      orgId: user.orgId,
    });
  } catch (err) {
    console.error("CREATE USER ERROR:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
