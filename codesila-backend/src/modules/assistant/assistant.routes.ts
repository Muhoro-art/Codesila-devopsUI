import { Router } from "express";
import { AssistantService } from "./assistant.service";
import { requirePermission } from "../../middlewares/requirePermission";
import { Actions } from "../admin/rbac/permissions";
import { prisma } from "../../infra/db";

export function buildAssistantRouter(
  assistant: AssistantService
): Router {
  const router = Router();

  /* ================================================================ */
  /*  Conversation CRUD                                               */
  /* ================================================================ */

  // List user's conversations (most recent first, last 24h only)
  router.get("/conversations", requirePermission(Actions.AssistantAsk), async (_req, res) => {
    try {
      const userId = res.locals.user?.sub as string;
      const orgId = res.locals.user?.orgId as string;

      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const conversations = await prisma.assistantConversation.findMany({
        where: { userId, orgId, updatedAt: { gte: cutoff } },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          title: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { messages: true } },
        },
      });

      res.json(conversations);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Failed to list conversations" });
    }
  });

  // Create a new conversation
  router.post("/conversations", requirePermission(Actions.AssistantAsk), async (req, res) => {
    try {
      const userId = res.locals.user?.sub as string;
      const orgId = res.locals.user?.orgId as string;
      const title = typeof req.body.title === "string" ? req.body.title.trim() : "New conversation";

      const convo = await prisma.assistantConversation.create({
        data: { orgId, userId, title: title || "New conversation" },
      });

      res.status(201).json(convo);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Failed to create conversation" });
    }
  });

  // Get a conversation with its messages
  router.get("/conversations/:id", requirePermission(Actions.AssistantAsk), async (req, res) => {
    try {
      const userId = res.locals.user?.sub as string;
      const convo = await prisma.assistantConversation.findFirst({
        where: { id: req.params.id, userId },
        include: {
          messages: { orderBy: { createdAt: "asc" } },
        },
      });

      if (!convo) return res.status(404).json({ error: "Conversation not found" });
      res.json(convo);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Failed to load conversation" });
    }
  });

  // Update conversation title
  router.patch("/conversations/:id", requirePermission(Actions.AssistantAsk), async (req, res) => {
    try {
      const userId = res.locals.user?.sub as string;
      const existing = await prisma.assistantConversation.findFirst({
        where: { id: req.params.id, userId },
      });
      if (!existing) return res.status(404).json({ error: "Conversation not found" });

      const title = typeof req.body.title === "string" ? req.body.title.trim() : undefined;
      const updated = await prisma.assistantConversation.update({
        where: { id: req.params.id },
        data: { ...(title ? { title } : {}) },
      });

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Failed to update conversation" });
    }
  });

  // Delete a conversation
  router.delete("/conversations/:id", requirePermission(Actions.AssistantAsk), async (req, res) => {
    try {
      const userId = res.locals.user?.sub as string;
      const existing = await prisma.assistantConversation.findFirst({
        where: { id: req.params.id, userId },
      });
      if (!existing) return res.status(404).json({ error: "Conversation not found" });

      await prisma.assistantConversation.delete({ where: { id: req.params.id } });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Failed to delete conversation" });
    }
  });

  /* ================================================================ */
  /*  Ask endpoints (with auto-save to conversation)                  */
  /* ================================================================ */

  // Standard JSON endpoint (backward-compatible)
  router.post("/ask", requirePermission(Actions.AssistantAsk), async (req, res) => {
    try {
      const { query, history, projectId } = req.body;

      if (!query || typeof query !== "string" || !query.trim()) {
        return res.status(400).json({ error: "query is required" });
      }

      const orgId = res.locals.user?.orgId as string;
      const userId = res.locals.user?.sub as string;
      if (!orgId) {
        return res.status(400).json({ error: "Missing orgId in token" });
      }

      const result = await assistant.ask({
        orgId,
        userId,
        query,
        history,
        projectId: typeof projectId === "string" ? projectId : undefined,
      });

      res.json(result);
    } catch (err: any) {
      res.status(500).json({
        error: err?.message ?? "Assistant error",
      });
    }
  });

  // SSE streaming endpoint — sends tool execution events in real time
  // Now auto-persists messages to the conversation
  router.post("/ask/stream", requirePermission(Actions.AssistantAsk), async (req, res) => {
    const { query, history, projectId, conversationId } = req.body;

    if (!query || typeof query !== "string" || !query.trim()) {
      return res.status(400).json({ error: "query is required" });
    }

    const orgId = res.locals.user?.orgId as string;
    const userId = res.locals.user?.sub as string;
    if (!orgId) {
      return res.status(400).json({ error: "Missing orgId in token" });
    }

    // SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const send = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      // Resolve or create conversation
      let convoId = conversationId;
      if (!convoId) {
        const convo = await prisma.assistantConversation.create({
          data: {
            orgId,
            userId,
            title: query.slice(0, 80).trim() || "New conversation",
          },
        });
        convoId = convo.id;
      }

      // Send the conversation ID so the frontend knows where to save
      send("conversation", { id: convoId });

      // Save user message
      await prisma.assistantMessage.create({
        data: { conversationId: convoId, role: "user", content: query },
      });

      send("status", { message: "Analyzing your request..." });

      // Build history from DB if not provided
      let resolvedHistory = history;
      if (!resolvedHistory || !Array.isArray(resolvedHistory) || resolvedHistory.length === 0) {
        const dbMessages = await prisma.assistantMessage.findMany({
          where: { conversationId: convoId },
          orderBy: { createdAt: "asc" },
          take: 20,
        });
        resolvedHistory = dbMessages.slice(0, -1).map((m) => ({
          role: m.role as "user" | "assistant",
          text: m.content,
        }));
      }

      const result = await assistant.ask({
        orgId,
        userId,
        query,
        history: resolvedHistory,
        projectId: typeof projectId === "string" ? projectId : undefined,
      });

      // Send tool calls as individual events
      if (result.toolCalls) {
        for (const tc of result.toolCalls) {
          send("tool_call", { name: tc.name, args: tc.args });
          send("tool_result", { name: tc.name, result: tc.result });
        }
      }

      // Save assistant message
      await prisma.assistantMessage.create({
        data: {
          conversationId: convoId,
          role: "assistant",
          content: result.answer_md,
          toolCalls: result.toolCalls ?? undefined,
        },
      });

      // Touch conversation updatedAt
      await prisma.assistantConversation.update({
        where: { id: convoId },
        data: { updatedAt: new Date() },
      });

      // Send final answer
      send("answer", {
        answer_md: result.answer_md,
        citations: result.citations,
        toolCalls: result.toolCalls,
        conversationId: convoId,
      });

      send("done", {});
    } catch (err: any) {
      send("error", { message: err?.message ?? "Assistant error" });
    } finally {
      res.end();
    }
  });

  return router;
}
