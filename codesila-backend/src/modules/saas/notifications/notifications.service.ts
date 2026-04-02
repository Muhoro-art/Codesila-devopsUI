import { prisma } from "../../../infra/db";
import type { NotificationType, NotificationChannel } from "@prisma/client";

export async function createNotification(data: {
  orgId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  channel?: NotificationChannel;
  metadata?: Record<string, unknown>;
}) {
  return prisma.notification.create({
    data: {
      orgId: data.orgId,
      userId: data.userId,
      type: data.type,
      title: data.title,
      body: data.body,
      link: data.link,
      channel: data.channel ?? "IN_APP",
      metadata: data.metadata as any,
    },
  });
}

export async function notifyOrgAdmins(orgId: string, type: NotificationType, title: string, body?: string, link?: string) {
  const admins = await prisma.user.findMany({
    where: { orgId, role: { in: ["ADMIN", "SUPER_ADMIN"] }, isActive: true },
    select: { id: true },
  });

  return prisma.notification.createMany({
    data: admins.map((admin) => ({
      orgId,
      userId: admin.id,
      type,
      title,
      body,
      link,
      channel: "IN_APP" as NotificationChannel,
    })),
  });
}

export async function listNotifications(userId: string, options?: {
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
}) {
  const where: Record<string, unknown> = { userId };
  if (options?.unreadOnly) where.readAt = null;

  return prisma.notification.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: options?.limit ?? 50,
    skip: options?.offset ?? 0,
  });
}

export async function getUnreadCount(userId: string) {
  return prisma.notification.count({
    where: { userId, readAt: null },
  });
}

export async function markAsRead(notificationId: string, userId: string) {
  return prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { readAt: new Date() },
  });
}

export async function markAllAsRead(userId: string) {
  return prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function deleteNotification(notificationId: string, userId: string) {
  return prisma.notification.deleteMany({
    where: { id: notificationId, userId },
  });
}
