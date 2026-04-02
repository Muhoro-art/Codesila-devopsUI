import { prisma } from "../../../infra/db";
import type { Role } from "@prisma/client";
import crypto from "crypto";

export async function createInvitation(data: {
  orgId: string;
  email: string;
  role: Role;
  invitedById: string;
  expiresInDays?: number;
}) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + (data.expiresInDays ?? 7));

  const token = crypto.randomBytes(32).toString("hex");

  return prisma.orgInvitation.create({
    data: {
      orgId: data.orgId,
      email: data.email.toLowerCase().trim(),
      role: data.role,
      invitedById: data.invitedById,
      token,
      expiresAt,
      status: "PENDING",
    },
  });
}

export async function listInvitations(orgId: string) {
  return prisma.orgInvitation.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    include: {
      invitedBy: { select: { id: true, name: true, email: true } },
    },
  });
}

export async function getInvitationByToken(token: string) {
  return prisma.orgInvitation.findUnique({
    where: { token },
    include: { organization: true },
  });
}

export async function acceptInvitation(token: string) {
  const invitation = await prisma.orgInvitation.findUnique({
    where: { token },
  });

  if (!invitation) throw new Error("Invitation not found");
  if (invitation.status !== "PENDING") throw new Error("Invitation already " + invitation.status.toLowerCase());
  if (invitation.expiresAt < new Date()) {
    await prisma.orgInvitation.update({
      where: { id: invitation.id },
      data: { status: "EXPIRED" },
    });
    throw new Error("Invitation has expired");
  }

  return prisma.orgInvitation.update({
    where: { id: invitation.id },
    data: { status: "ACCEPTED" },
  });
}

export async function revokeInvitation(invitationId: string, orgId: string) {
  return prisma.orgInvitation.updateMany({
    where: { id: invitationId, orgId, status: "PENDING" },
    data: { status: "REVOKED" },
  });
}

export async function resendInvitation(invitationId: string, orgId: string) {
  const newToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  return prisma.orgInvitation.updateMany({
    where: { id: invitationId, orgId, status: "PENDING" },
    data: { token: newToken, expiresAt },
  });
}

export async function cleanupExpiredInvitations() {
  return prisma.orgInvitation.updateMany({
    where: {
      status: "PENDING",
      expiresAt: { lt: new Date() },
    },
    data: { status: "EXPIRED" },
  });
}
