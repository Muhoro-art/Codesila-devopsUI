// src/components/chat/ChatSidebar.tsx
import { useState } from 'react';
import {
  Search, Plus, Users, Lock, MessageSquare,
  AlertTriangle, Crown,
} from 'lucide-react';
import {
  getRoleColor, getRoleLabel, getRoleLevel, getRolePerks,
  getAvatarColor, formatTime,
} from './chatConfig';
import type { ChatUser } from '../../api/chat';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface ChatRoom {
  id: string;
  name: string;
  type: 'private' | 'group';
  participants: { id: string; name: string; role: string }[];
  lastMessage?: string;
  unreadCount: number;
  project?: string;
}

interface Props {
  rooms: ChatRoom[];
  activeRoomId: string | null;
  onSelectRoom: (room: ChatRoom) => void;
  chatUsers: ChatUser[];
  onStartDirect: (userId: string) => void;
  currentUser: { id: string; name?: string; email: string; role: string };
  onCreateGroup?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

const ChatSidebar = ({
  rooms,
  activeRoomId,
  onSelectRoom,
  chatUsers,
  onStartDirect,
  currentUser,
  onCreateGroup,
}: Props) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);

  const perks = getRolePerks(currentUser.role);
  const myColor = getRoleColor(currentUser.role);

  /* Filter rooms by search */
  const filteredRooms = rooms.filter((room) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    if (room.name.toLowerCase().includes(q)) return true;
    if (room.participants.some((p) => p.name.toLowerCase().includes(q))) return true;
    return false;
  });

  /* Get display info for a room */
  const getRoomDisplay = (room: ChatRoom) => {
    if (room.type === 'private') {
      const other = room.participants.find((p) => p.id !== currentUser.id);
      return {
        name: other?.name ?? room.name,
        role: other?.role ?? 'user',
        isPrivate: true,
        avatar: other?.name?.[0]?.toUpperCase() ?? '?',
        avatarColor: other ? getAvatarColor(other.id) : '#666',
      };
    }
    return {
      name: room.name,
      role: null,
      isPrivate: false,
      avatar: room.name[0]?.toUpperCase() ?? '#',
      avatarColor: getAvatarColor(room.id),
    };
  };

  /* Group users by role for new chat panel */
  const roleOrder = ['admin', 'super_admin', 'manager', 'devops', 'developer', 'pm', 'user'];
  const groupedUsers = chatUsers.reduce<Record<string, ChatUser[]>>((acc, u) => {
    const role = u.role?.toLowerCase() || 'user';
    if (!acc[role]) acc[role] = [];
    acc[role].push(u);
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-full bg-cyber-base">
      {/* ── Header ── */}
      <div
        className="px-4 py-3 flex items-center justify-between shrink-0"
        style={{ background: 'linear-gradient(135deg, #0a0a12 0%, #0d1117 100%)' }}
      >
        <div className="flex items-center gap-2.5">
          {/* User avatar */}
          <div
            className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ring-2 ${myColor.ring}`}
            style={{ backgroundColor: myColor.accent + '30', color: myColor.accent }}
          >
            {currentUser.name?.[0]?.toUpperCase() ?? currentUser.email[0].toUpperCase()}
          </div>
          <div>
            <div className="text-sm font-semibold text-white leading-tight">
              {currentUser.name ?? currentUser.email.split('@')[0]}
            </div>
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${myColor.bg} ${myColor.text}`}
            >
              {getRoleLabel(currentUser.role)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {perks.canCreateGroup && (
            <button
              onClick={onCreateGroup}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition"
              title="New Group"
            >
              <Users size={18} />
            </button>
          )}
          <button
            onClick={() => setShowNewChat(!showNewChat)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition"
            title="New Chat"
          >
            <Plus size={18} />
          </button>
        </div>
      </div>

      {/* ── Search Bar ── */}
      <div className="px-3 py-2 shrink-0">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search or start new chat"
            className="w-full bg-gray-900/60 border border-cyber-cyan/20 text-cyber-text text-sm font-fira pl-9 pr-3 py-2 rounded-lg
                       placeholder-gray-500 focus:outline-none focus:border-cyber-cyan/50 focus:ring-1 focus:ring-cyber-cyan/20
                       transition"
          />
        </div>
      </div>

      {/* ── New Chat Panel ── */}
      {showNewChat && (
        <div className="border-b border-cyber-cyan/10 bg-cyber-base/80 max-h-48 overflow-y-auto shrink-0">
          <div className="px-3 py-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
            Start conversation with
          </div>
          {roleOrder.flatMap((role) => {
            const members = groupedUsers[role];
            if (!members?.length) return [];
            return [
              <div key={`label-${role}`} className="px-3 py-1">
                <span className={`text-[10px] font-bold uppercase tracking-wider ${getRoleColor(role).text}`}>
                  {getRoleLabel(role)}
                </span>
              </div>,
              ...members.map((member) => {
                const mColor = getRoleColor(member.role);
                return (
                  <button
                    key={member.id}
                    onClick={() => {
                      onStartDirect(member.id);
                      setShowNewChat(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 transition text-left"
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                      style={{ backgroundColor: mColor.accent + '25', color: mColor.accent }}
                    >
                      {member.name[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">{member.name}</div>
                      <div className={`text-[10px] ${mColor.text}`}>{mColor.label}</div>
                    </div>
                    <div className="shrink-0">
                      {getRoleLevel(member.role) >= 4 && (
                        <Crown size={12} className="text-amber-400/60" />
                      )}
                    </div>
                  </button>
                );
              }),
            ];
          })}
          {chatUsers.length === 0 && (
            <div className="px-3 py-4 text-xs text-gray-500 text-center">No users available</div>
          )}
        </div>
      )}

      {/* ── Conversation List ── */}
      <div className="flex-1 overflow-y-auto">
        {filteredRooms.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <MessageSquare size={32} className="mb-2 opacity-40" />
            <p className="text-sm">No conversations yet</p>
            <p className="text-xs mt-1">Start a new chat above</p>
          </div>
        )}

        {filteredRooms.map((room) => {
          const display = getRoomDisplay(room);
          const isActive = room.id === activeRoomId;
          const roleColor = display.role ? getRoleColor(display.role) : null;
          const hasUrgent = room.lastMessage?.startsWith('🔴');

          return (
            <button
              key={room.id}
              onClick={() => onSelectRoom(room)}
              className={`w-full flex items-center gap-3 px-4 py-3 transition-all border-b border-gray-800/50
                ${isActive
                  ? 'bg-cyber-cyan/10 border-l-2 border-l-cyber-cyan'
                  : 'hover:bg-white/[0.03] border-l-2 border-l-transparent'
                }
              `}
            >
              {/* Avatar */}
              <div className="relative shrink-0">
                <div
                  className={`w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold
                    ${display.isPrivate ? '' : 'ring-1 ring-gray-600/50'}`}
                  style={{
                    backgroundColor: display.avatarColor + '20',
                    color: display.avatarColor,
                  }}
                >
                  {display.isPrivate ? (
                    display.avatar
                  ) : (
                    <Users size={18} />
                  )}
                </div>
                {/* Role indicator dot */}
                {roleColor && (
                  <div
                    className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-cyber-base"
                    style={{ backgroundColor: roleColor.accent }}
                    title={roleColor.label}
                  />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 text-left">
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {display.isPrivate && <Lock size={10} className="text-gray-500 shrink-0" />}
                    <span className={`text-sm font-medium truncate ${isActive ? 'text-white' : 'text-gray-200'}`}>
                      {display.name}
                    </span>
                    {roleColor && getRoleLevel(display.role!) >= 4 && (
                      <Crown size={11} className="text-amber-400 shrink-0" />
                    )}
                  </div>
                  <span className={`text-[10px] shrink-0 ml-2 ${room.unreadCount > 0 ? 'text-cyber-green' : 'text-gray-500'}`}>
                    {room.lastMessage ? formatTime(new Date().toISOString()) : ''}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <p className={`text-xs truncate pr-2 ${room.unreadCount > 0 ? 'text-gray-300 font-medium' : 'text-gray-500'}`}>
                    {hasUrgent && <AlertTriangle size={10} className="inline text-red-400 mr-1" />}
                    {room.lastMessage || 'No messages yet'}
                  </p>
                  {room.unreadCount > 0 && (
                    <span className="shrink-0 bg-cyber-green text-[10px] text-cyber-base font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                      {room.unreadCount > 99 ? '99+' : room.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ChatSidebar;
