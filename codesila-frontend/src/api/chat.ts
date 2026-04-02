import { API_BASE, getAuthHeader } from "./client";

async function readJsonResponse<T>(res: Response, fallbackMessage: string) {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    throw new Error(text || fallbackMessage);
  }

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || fallbackMessage);
  }

  return data as T;
}

export type ChatRoom = {
  id: string;
  name: string;
  type: "private" | "group";
  participants: { id: string; name: string; role: string }[];
  lastMessage?: string;
  unreadCount: number;
  project?: string;
};

export type ChatMessage = {
  id: string;
  content: string;
  sender: { id: string; name: string; role: string; avatar?: string };
  timestamp: string;
  roomId: string;
  readBy: string[];
  priority?: 'normal' | 'urgent';
  pinnedAt?: string | null;
};

export type ChatUser = {
  id: string;
  name: string;
  role: string;
  email: string;
};

export async function listChatRooms() {
  const res = await fetch(`${API_BASE}/chat/rooms`, {
    headers: {
      ...getAuthHeader(),
    },
  });

  return readJsonResponse<ChatRoom[]>(res, "Failed to load chat rooms");
}

export async function listChatMessages(roomId: string) {
  const res = await fetch(`${API_BASE}/chat/rooms/${roomId}/messages`, {
    headers: {
      ...getAuthHeader(),
    },
  });

  return readJsonResponse<ChatMessage[]>(res, "Failed to load chat messages");
}

export async function sendChatMessage(roomId: string, content: string) {
  const res = await fetch(`${API_BASE}/chat/rooms/${roomId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeader(),
    },
    body: JSON.stringify({ content }),
  });

  return readJsonResponse<ChatMessage>(res, "Failed to send message");
}

export async function listChatUsers() {
  const res = await fetch(`${API_BASE}/chat/users`, {
    headers: {
      ...getAuthHeader(),
    },
  });

  return readJsonResponse<ChatUser[]>(res, "Failed to load chat users");
}

export async function createDirectRoom(targetUserId: string) {
  const res = await fetch(`${API_BASE}/chat/rooms/direct`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeader(),
    },
    body: JSON.stringify({ userId: targetUserId }),
  });

  return readJsonResponse<ChatRoom>(res, "Failed to create direct room");
}
