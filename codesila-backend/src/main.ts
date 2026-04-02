import "dotenv/config";
import http, { type IncomingMessage } from "http";
import jwt from "jsonwebtoken";
import { WebSocketServer, WebSocket } from "ws";
import { env } from "./config/env";
import { SECURITY } from "./config/constants";
import logger, { logSecurityEvent } from "./config/logger";
import { buildApp } from "./app";
import { chatEvents, type ChatEvent } from "./modules/chat/chat.events";
import type { AuthUser } from "./middlewares/auth";
import { prisma } from "./infra/db";

// Validate critical env vars at boot (never log secrets)
if (!env.JWT_SECRET) {
  logger.fatal("FATAL: JWT_SECRET is not set");
  process.exit(1);
}

const app = buildApp();
const server = http.createServer(app);

const wss = new WebSocketServer({
  server,
  path: "/ws",
  maxPayload: SECURITY.WEBSOCKET.MAX_MESSAGE_SIZE,
});
const connections = new Map<string, Set<WebSocket>>();

// WebSocket heartbeat interval (30s) to clean up dead connections
const HEARTBEAT_INTERVAL = SECURITY.WEBSOCKET.HEARTBEAT_INTERVAL_MS;
const MAX_CONNECTIONS_PER_USER = SECURITY.WEBSOCKET.MAX_CONNECTIONS_PER_USER;

const heartbeat = setInterval(() => {
  wss.clients.forEach((socket) => {
    if ((socket as any).__isAlive === false) {
      socket.terminate();
      return;
    }
    (socket as any).__isAlive = false;
    socket.ping();
  });
}, HEARTBEAT_INTERVAL);

wss.on("close", () => clearInterval(heartbeat));

function addConnection(userId: string, socket: WebSocket) {
  if (!connections.has(userId)) {
    connections.set(userId, new Set());
  }
  connections.get(userId)?.add(socket);
}

function removeConnection(userId: string, socket: WebSocket) {
  const sockets = connections.get(userId);
  if (!sockets) return;
  sockets.delete(socket);
  if (sockets.size === 0) {
    connections.delete(userId);
  }
}

wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
  try {
    const url = new URL(req.url ?? "", "http://localhost");
    const token = url.searchParams.get("token");

    if (!token) {
      socket.close(1008, "Unauthorized");
      return;
    }

    const payload = jwt.verify(token, env.JWT_SECRET, {
      algorithms: [SECURITY.JWT.ALGORITHM],
      issuer: SECURITY.JWT.ISSUER,
      audience: SECURITY.JWT.AUDIENCE,
    }) as AuthUser;
    const userId = payload.sub;

    // Enforce max connections per user
    const existing = connections.get(userId);
    if (existing && existing.size >= MAX_CONNECTIONS_PER_USER) {
      socket.close(1008, "Too many connections");
      return;
    }

    addConnection(userId, socket);

    // Heartbeat tracking
    (socket as any).__isAlive = true;
    socket.on("pong", () => {
      (socket as any).__isAlive = true;
    });

    socket.on("close", () => {
      removeConnection(userId, socket);
    });

    socket.on("error", () => {
      removeConnection(userId, socket);
    });
  } catch {
    socket.close(1008, "Unauthorized");
  }
});

chatEvents.on("event", (event: ChatEvent) => {
  const payload = JSON.stringify(event);
  event.recipients.forEach((userId) => {
    const sockets = connections.get(userId);
    if (!sockets) return;
    sockets.forEach((socket) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
      }
    });
  });
});

const PORT = env.PORT;

server.listen(PORT, "0.0.0.0", async () => {
  logger.info(`Backend running on 0.0.0.0:${PORT} [${env.NODE_ENV}]`);

  // Auto-repair: bind orphaned GitHubRepos that lack a ProjectIntegration record
  try {
    const ghRepos = await prisma.gitHubRepo.findMany({
      select: { orgId: true, projectId: true, fullName: true, defaultBranch: true, htmlUrl: true },
    });
    for (const gh of ghRepos) {
      const integration = await prisma.integration.findFirst({
        where: { orgId: gh.orgId, type: "github", isActive: true },
      });
      if (!integration) continue;
      const existing = await prisma.projectIntegration.findUnique({
        where: { projectId_integrationId: { projectId: gh.projectId, integrationId: integration.id } },
      });
      if (!existing) {
        await prisma.projectIntegration.create({
          data: {
            projectId: gh.projectId,
            integrationId: integration.id,
            configJson: { repo: gh.fullName, branch: gh.defaultBranch, url: gh.htmlUrl },
          },
        });
        await prisma.project.update({
          where: { id: gh.projectId },
          data: { gitRepositoryUrl: gh.htmlUrl, defaultBranch: gh.defaultBranch },
        });
        logger.info(`Auto-bound orphaned repo ${gh.fullName} → project ${gh.projectId}`);
      }
    }
  } catch (err) {
    logger.error("Auto-repair binding check failed: %s", String(err));
  }
});

// Cleanup assistant conversations older than 24 hours (runs every hour)
const CONVO_TTL_MS = 24 * 60 * 60 * 1000;
setInterval(async () => {
  try {
    const cutoff = new Date(Date.now() - CONVO_TTL_MS);
    const { count } = await prisma.assistantConversation.deleteMany({
      where: { updatedAt: { lt: cutoff } },
    });
    if (count > 0) {
      logger.info(`Cleaned up ${count} expired assistant conversation(s)`);
    }
  } catch (err) {
    logger.error("Failed to clean up assistant conversations: %s", String(err));
  }
}, 60 * 60 * 1000);
