// src/components/chat/ChatWindow.tsx
import { useRef, useEffect } from 'react';
import {
  ArrowLeft, Lock, Users,
  MoreVertical, Crown, Loader2,
} from 'lucide-react';
import MessageBubble from './MessageBubble';
import ChatInput from './ChatInput';
import type { Message } from './MessageBubble';
import type { ChatRoom } from './ChatSidebar';
import {
  getRoleColor, getRolePerks, getRoleLevel, getRoleLabel,
  getAvatarColor, getDateLabel, isDifferentDay,
} from './chatConfig';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface Props {
  room: ChatRoom;
  messages: Message[];
  currentUser: { id: string; name?: string; email: string; role: string };
  onSendMessage: (content: string, priority: 'normal' | 'urgent') => void;
  onBack: () => void;
  loading: boolean;
  error: string | null;
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

const ChatWindow = ({
  room,
  messages,
  currentUser,
  onSendMessage,
  onBack,
  loading,
  error,
}: Props) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const perks = getRolePerks(currentUser.role);
  const isGroupChat = room.type === 'group';

  // Get the "other" user info for private chats
  const otherParticipant = room.type === 'private'
    ? room.participants.find((p) => p.id !== currentUser.id)
    : null;

  const displayName = otherParticipant?.name ?? room.name;
  const displayRole = otherParticipant?.role ?? null;
  const roleColor = displayRole ? getRoleColor(displayRole) : null;

  // Auto-scroll to bottom (contained within the messages div, no page jolt)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages]);

  // Group messages for consecutive sender detection
  const shouldShowSender = (index: number): boolean => {
    if (index === 0) return true;
    const prev = messages[index - 1];
    const curr = messages[index];
    if (prev.sender.id !== curr.sender.id) return true;
    // Show sender again if gap > 5 minutes
    const gap = new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime();
    return gap > 300000;
  };

  const isCompact = (index: number): boolean => {
    if (index === 0) return false;
    return messages[index - 1].sender.id === messages[index].sender.id &&
      !isDifferentDay(messages[index - 1].timestamp, messages[index].timestamp);
  };

  return (
    <div className="flex flex-col h-full bg-cyber-base">
      {/* ── Chat Header ── */}
      <div
        className="flex items-center gap-3 px-3 py-2.5 shrink-0 border-b border-cyber-cyan/20"
        style={{ background: 'linear-gradient(135deg, #0a0a12 0%, #0d1117 100%)' }}
      >
        {/* Back button */}
        <button
          onClick={onBack}
          className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition shrink-0"
        >
          <ArrowLeft size={18} />
        </button>

        {/* Avatar */}
        <div className="relative shrink-0">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold"
            style={{
              backgroundColor: (otherParticipant
                ? getAvatarColor(otherParticipant.id)
                : getAvatarColor(room.id)) + '25',
              color: otherParticipant
                ? getAvatarColor(otherParticipant.id)
                : getAvatarColor(room.id),
            }}
          >
            {room.type === 'private'
              ? (otherParticipant?.name?.[0]?.toUpperCase() ?? '?')
              : <Users size={16} />
            }
          </div>
          {roleColor && (
            <div
              className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-cyber-base"
              style={{ backgroundColor: roleColor.accent }}
            />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {room.type === 'private' && <Lock size={10} className="text-gray-500 shrink-0" />}
            <span className="text-sm font-semibold text-white truncate">{displayName}</span>
            {roleColor && getRoleLevel(displayRole!) >= 4 && (
              <Crown size={11} className="text-amber-400 shrink-0" />
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            {roleColor && (
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${roleColor.bg} ${roleColor.text}`}>
                {getRoleLabel(displayRole)}
              </span>
            )}
            {isGroupChat && (
              <span className="text-[10px] text-gray-500">
                {room.participants.length} members
              </span>
            )}
            {room.project && (
              <span className="text-[10px] text-cyan-500/70">
                📂 {room.project}
              </span>
            )}
          </div>
        </div>

        {/* Header actions (placeholder for future) */}
        <div className="flex items-center gap-1 shrink-0">
          <button className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/10 transition" title="More">
            <MoreVertical size={16} />
          </button>
        </div>
      </div>

      {/* ── Messages Area ── */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto overscroll-contain px-3 py-2"
        style={{
          backgroundImage: `radial-gradient(circle at 20% 50%, rgba(0,243,255,0.02) 0%, transparent 50%),
                            radial-gradient(circle at 80% 50%, rgba(0,255,157,0.02) 0%, transparent 50%)`,
        }}
      >
        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-6">
            <Loader2 size={20} className="text-cyber-cyan animate-spin" />
            <span className="text-xs text-gray-500 ml-2">Loading messages…</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mx-auto max-w-xs bg-red-900/20 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-400 text-center my-4">
            {error}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <div className="w-16 h-16 rounded-full bg-gray-800/50 flex items-center justify-center mb-3">
              {room.type === 'private' ? <Lock size={24} className="text-gray-600" /> : <Users size={24} className="text-gray-600" />}
            </div>
            <p className="text-sm font-medium text-gray-400">No messages yet</p>
            <p className="text-xs mt-1">Send a message to start the conversation</p>
          </div>
        )}

        {/* Messages */}
        {messages.map((msg, idx) => {
          const showDate = idx === 0 || isDifferentDay(messages[idx - 1].timestamp, msg.timestamp);

          return (
            <div key={msg.id}>
              {/* Date separator */}
              {showDate && (
                <div className="flex items-center justify-center my-4">
                  <div className="bg-cyber-base border border-cyber-cyan/20 rounded-full px-4 py-1">
                    <span className="text-[11px] text-gray-400 font-medium">
                      {getDateLabel(msg.timestamp)}
                    </span>
                  </div>
                </div>
              )}

              <MessageBubble
                message={msg}
                isSelf={msg.sender.id === currentUser.id}
                isGroupChat={isGroupChat}
                showSender={shouldShowSender(idx)}
                compact={isCompact(idx)}
              />
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input Area ── */}
      <ChatInput
        onSend={onSendMessage}
        placeholder={`Message ${displayName}…`}
        perks={perks}
      />
    </div>
  );
};

export default ChatWindow;
