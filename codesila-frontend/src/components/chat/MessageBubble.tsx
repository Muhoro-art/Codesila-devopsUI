// src/components/chat/MessageBubble.tsx
import {
  AlertTriangle, Check, CheckCheck, Crown, Pin,
} from 'lucide-react';
import {
  getRoleColor, getRoleLabel, getRoleLevel,
  getAvatarColor, formatMessageTime,
} from './chatConfig';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface Message {
  id: string;
  content: string;
  sender: { id: string; name: string; role: string; avatar?: string };
  timestamp: string;
  roomId: string;
  readBy: string[];
  priority?: 'normal' | 'urgent';
  pinnedAt?: string | null;
}

interface Props {
  message: Message;
  isSelf: boolean;
  isGroupChat: boolean;
  /** Show sender name (first message in a consecutive sequence) */
  showSender: boolean;
  /** Compact spacing (consecutive messages from same sender) */
  compact: boolean;
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

const MessageBubble = ({ message, isSelf, isGroupChat, showSender, compact }: Props) => {
  const roleColor = getRoleColor(message.sender.role);
  const isUrgent = message.priority === 'urgent' || message.content.startsWith('🔴');
  const isPinned = !!message.pinnedAt;
  const isHighRank = getRoleLevel(message.sender.role) >= 4;

  // Cyber-themed bubble colors (no WhatsApp green)
  const bubbleBase = isSelf
    ? 'bg-cyber-cyan/15 border border-cyber-cyan/25'
    : 'bg-gray-900/60 border border-cyber-cyan/10';

  const urgentStyle = isUrgent
    ? 'ring-1 ring-red-500/40 shadow-[0_0_12px_rgba(239,68,68,0.15)]'
    : '';

  return (
    <div
      className={`flex ${isSelf ? 'justify-end' : 'justify-start'} ${compact ? 'mt-0.5' : 'mt-3'}`}
    >
      <div className={`flex gap-2 max-w-[85%] ${isSelf ? 'flex-row-reverse' : ''}`}>
        {/* Avatar — only for first in sequence, only for others in group */}
        {!isSelf && isGroupChat && (
          <div className="shrink-0 w-8 self-end">
            {showSender ? (
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                style={{
                  backgroundColor: getAvatarColor(message.sender.id) + '25',
                  color: getAvatarColor(message.sender.id),
                }}
              >
                {message.sender.avatar || message.sender.name[0]?.toUpperCase()}
              </div>
            ) : (
              <div className="w-8" /> /* spacer */
            )}
          </div>
        )}

        {/* Bubble */}
        <div className="min-w-0">
          {/* Sender name + role badge (group chats only, first in sequence) */}
          {showSender && !isSelf && isGroupChat && (
            <div className="flex items-center gap-1.5 mb-1 pl-1">
              <span
                className="text-xs font-semibold"
                style={{ color: roleColor.accent }}
              >
                {message.sender.name}
              </span>
              <span
                className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${roleColor.bg} ${roleColor.text}`}
              >
                {getRoleLabel(message.sender.role)}
              </span>
              {isHighRank && <Crown size={10} className="text-amber-400" />}
            </div>
          )}

          <div
            className={`relative rounded-2xl px-3 py-2 ${bubbleBase} ${urgentStyle}
              ${isSelf ? 'rounded-br-md' : 'rounded-bl-md'}
            `}
          >
            {/* Urgent banner */}
            {isUrgent && (
              <div className="flex items-center gap-1 text-red-400 text-[10px] font-bold mb-1.5 pb-1.5 border-b border-red-500/20">
                <AlertTriangle size={11} />
                <span>URGENT MESSAGE</span>
              </div>
            )}

            {/* Pinned indicator */}
            {isPinned && (
              <div className="flex items-center gap-1 text-amber-400 text-[10px] mb-1">
                <Pin size={9} />
                <span>Pinned</span>
              </div>
            )}

            {/* Message content */}
            <div className="text-[13.5px] leading-relaxed text-cyber-text break-words whitespace-pre-wrap font-fira">
              {message.content.replace(/^🔴\s*/, '')}
            </div>

            {/* Time + status footer */}
            <div className={`flex items-center gap-1 mt-1 ${isSelf ? 'justify-end' : 'justify-end'}`}>
              <span className="text-[10px] text-cyber-text/40">
                {formatMessageTime(message.timestamp)}
              </span>
              {isSelf && (
                <span className="text-cyber-text/40">
                  {message.readBy && message.readBy.length > 1 ? (
                    <CheckCheck size={13} className="text-cyber-cyan" />
                  ) : (
                    <Check size={13} />
                  )}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MessageBubble;
