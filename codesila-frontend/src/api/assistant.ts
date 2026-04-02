// src/api/assistant.ts
// API client for assistant conversations (persistent chat history)

import { API_BASE, secureFetch } from "./client";

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(res.ok ? "Invalid response format" : `Server error: ${res.status}`);
  }
}

export type ConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  _count: { messages: number };
};

export type ConversationMessage = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{ name: string; args: any; result?: string }> | null;
  createdAt: string;
};

export type ConversationFull = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ConversationMessage[];
};

/** List user's conversations (last 24h) */
export async function listConversations(): Promise<ConversationSummary[]> {
  const res = await secureFetch(`${API_BASE}/assistant/conversations`);
  if (!res.ok) throw new Error("Failed to list conversations");
  return readJson<ConversationSummary[]>(res);
}

/** Create a new conversation */
export async function createConversation(title?: string): Promise<{ id: string; title: string }> {
  const res = await secureFetch(`${API_BASE}/assistant/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("Failed to create conversation");
  return readJson(res);
}

/** Load a conversation with all its messages */
export async function getConversation(id: string): Promise<ConversationFull> {
  const res = await secureFetch(`${API_BASE}/assistant/conversations/${id}`);
  if (!res.ok) throw new Error("Failed to load conversation");
  return readJson<ConversationFull>(res);
}

/** Update conversation title */
export async function updateConversation(id: string, title: string): Promise<void> {
  const res = await secureFetch(`${API_BASE}/assistant/conversations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("Failed to update conversation");
}

/** Delete a conversation */
export async function deleteConversation(id: string): Promise<void> {
  const res = await secureFetch(`${API_BASE}/assistant/conversations/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error("Failed to delete conversation");
}
