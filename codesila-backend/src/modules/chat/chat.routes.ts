import { Router, type Request, type Response } from "express";
import { prisma } from "../../infra/db";
import { emitChatEvent } from "./chat.events";

const ROLE_MAP: Record<string, string> = {
  ADMIN: "admin",
  SUPER_ADMIN: "admin",
  DEVOPS: "devops",
  DEVELOPER: "developer",
  MANAGER: "manager",
  USER: "developer",
};

function mapRole(role?: string | null) {
  if (!role) return "developer";
  return ROLE_MAP[role] ?? role.toLowerCase();
}

function mapUser(user: { id: string; name: string | null; email: string; role: string }) {
  return {
    id: user.id,
    name: user.name ?? user.email,
    role: mapRole(user.role),
  };
}

function formatMessage(message: {
  id: string;
  content: string;
  createdAt: Date;
  roomId: string;
  priority?: string | null;
  pinnedAt?: Date | null;
  sender: { id: string; name: string | null; email: string; role: string };
}) {
  return {
    id: message.id,
    content: message.content,
    sender: mapUser(message.sender),
    timestamp: message.createdAt.toISOString(),
    roomId: message.roomId,
    readBy: [],
    priority: (message.priority as 'normal' | 'urgent') ?? 'normal',
    pinnedAt: message.pinnedAt?.toISOString() ?? null,
  };
}

function formatRoom(room: {
  id: string;
  name: string;
  type: string;
  projectId: string | null;
  participants: { user: { id: string; name: string | null; email: string; role: string } }[];
  messages: { content: string }[];
}) {
  return {
    id: room.id,
    name: room.name,
    type: room.type as "private" | "group",
    participants: room.participants.map((p) => mapUser(p.user)),
    lastMessage: room.messages[0]?.content,
    unreadCount: 0,
    project: room.projectId ?? undefined,
  };
}

async function ensureDefaultRoom(orgId: string, userId: string) {
  const users = await prisma.user.findMany({
    where: { orgId },
    select: { id: true },
  });

  const participantIds = users.length ? users.map((user) => user.id) : [userId];

  return prisma.chatRoom.create({
    data: {
      name: "Team Lounge",
      type: "group",
      orgId,
      participants: {
        create: participantIds.map((id) => ({ userId: id })),
      },
    },
    include: {
      participants: {
        include: {
          user: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
}

async function ensureDirectRoom(orgId: string, userId: string, targetUserId: string) {
  if (userId === targetUserId) {
    throw new Error("Cannot create a direct room with yourself");
  }

  const targetUser = await prisma.user.findFirst({
    where: { id: targetUserId, orgId },
    select: { id: true, name: true, email: true },
  });

  if (!targetUser) {
    throw new Error("User not found");
  }

  const existingRoom = await prisma.chatRoom.findFirst({
    where: {
      orgId,
      type: "private",
      participants: { some: { userId } },
      AND: [{ participants: { some: { userId: targetUserId } } }],
    },
    include: {
      participants: {
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
        },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (existingRoom) {
    return { room: existingRoom, created: false };
  }

  const room = await prisma.chatRoom.create({
    data: {
      name: targetUser.name ?? targetUser.email,
      type: "private",
      orgId,
      participants: {
        create: [{ userId }, { userId: targetUserId }],
      },
    },
    include: {
      participants: {
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
        },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  return { room, created: true };
}

export function buildChatRouter(): Router {
  const router = Router();

  router.get("/users", async (_req: Request, res: Response) => {
    try {
      const userId = res.locals.user?.sub as string | undefined;
      const orgId = res.locals.user?.orgId as string;

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const users = await prisma.user.findMany({
        where: { orgId, isActive: true },
        select: { id: true, name: true, email: true, role: true },
        orderBy: { createdAt: "asc" },
      });

      const payload = users.map((user) => ({
        ...mapUser(user),
        email: user.email,
      }));

      return res.json(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load users";
      return res.status(500).json({ error: msg });
    }
  });

  router.get("/rooms", async (_req: Request, res: Response) => {
    try {
      const userId = res.locals.user?.sub as string | undefined;
      const orgId = res.locals.user?.orgId as string;

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      let rooms = await prisma.chatRoom.findMany({
        where: {
          orgId,
          participants: { some: { userId } },
        },
        include: {
          participants: {
            include: {
              user: {
                select: { id: true, name: true, email: true, role: true },
              },
            },
          },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
        orderBy: { updatedAt: "desc" },
      });

      if (rooms.length === 0) {
        const room = await ensureDefaultRoom(orgId, userId);
        rooms = [room];
      }

      const payload = rooms.map((room) => formatRoom(room));

      return res.json(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load rooms";
      return res.status(500).json({ error: msg });
    }
  });

  router.post("/rooms/direct", async (req: Request, res: Response) => {
    try {
      const userId = res.locals.user?.sub as string | undefined;
      const orgId = res.locals.user?.orgId as string;
      const { userId: targetUserId } = req.body ?? {};

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (!targetUserId || typeof targetUserId !== "string") {
        return res.status(400).json({ error: "userId is required" });
      }

      const { room, created } = await ensureDirectRoom(orgId, userId, targetUserId);
      const payload = formatRoom(room);

      if (created) {
        const recipients = room.participants.map((p) => p.user.id);
        emitChatEvent({
          type: "room",
          recipients,
          room: payload,
        });
      }

      return res.status(201).json(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create direct room";
      return res.status(500).json({ error: msg });
    }
  });

  router.get("/rooms/:roomId/messages", async (req: Request, res: Response) => {
    try {
      const userId = res.locals.user?.sub as string | undefined;
      const orgId = res.locals.user?.orgId as string;
      const { roomId } = req.params;

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const room = await prisma.chatRoom.findFirst({
        where: {
          id: roomId,
          orgId,
          participants: { some: { userId } },
        },
        select: { id: true },
      });

      if (!room) {
        return res.status(404).json({ error: "Room not found" });
      }

      const rawLimit = Number(req.query.limit);
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 200;

      const messages = await prisma.chatMessage.findMany({
        where: { roomId },
        include: {
          sender: { select: { id: true, name: true, email: true, role: true } },
        },
        orderBy: { createdAt: "asc" },
        take: limit,
      });

      return res.json(messages.map(formatMessage));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load messages";
      return res.status(500).json({ error: msg });
    }
  });

  router.post("/rooms/:roomId/messages", async (req: Request, res: Response) => {
    try {
      const userId = res.locals.user?.sub as string | undefined;
      const orgId = res.locals.user?.orgId as string;
      const { roomId } = req.params;
      const { content, priority: rawPriority } = req.body ?? {};

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (!content || typeof content !== "string" || !content.trim()) {
        return res.status(400).json({ error: "content is required" });
      }

      const priority = rawPriority === 'urgent' ? 'urgent' : 'normal';

      const room = await prisma.chatRoom.findFirst({
        where: {
          id: roomId,
          orgId,
          participants: { some: { userId } },
        },
        select: { id: true },
      });

      if (!room) {
        return res.status(404).json({ error: "Room not found" });
      }

      const message = await prisma.chatMessage.create({
        data: {
          roomId,
          senderId: userId,
          content: content.trim(),
          ...(priority === 'urgent' ? { priority: 'urgent' } : {}),
        },
        include: {
          sender: { select: { id: true, name: true, email: true, role: true } },
        },
      });

      await prisma.chatRoom.update({
        where: { id: roomId },
        data: { updatedAt: new Date() },
      });

      const participants = await prisma.chatParticipant.findMany({
        where: { roomId },
        select: { userId: true },
      });

      emitChatEvent({
        type: "message",
        recipients: participants.map((participant) => participant.userId),
        roomId,
        message: formatMessage(message),
      });

      return res.status(201).json(formatMessage(message));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send message";
      return res.status(500).json({ error: msg });
    }
  });

  return router;
}
