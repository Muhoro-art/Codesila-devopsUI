import { EventEmitter } from "events";

type ChatMessagePayload = {
  type: "message";
  recipients: string[];
  roomId: string;
  message: {
    id: string;
    content: string;
    sender: { id: string; name: string; role: string };
    timestamp: string;
    roomId: string;
    readBy: string[];
  };
};

type ChatRoomPayload = {
  type: "room";
  recipients: string[];
  room: {
    id: string;
    name: string;
    type: "private" | "group";
    participants: { id: string; name: string; role: string }[];
    lastMessage?: string;
    unreadCount: number;
    project?: string;
  };
};

export type ChatEvent = ChatMessagePayload | ChatRoomPayload;

export const chatEvents = new EventEmitter();

export function emitChatEvent(event: ChatEvent) {
  chatEvents.emit("event", event);
}
