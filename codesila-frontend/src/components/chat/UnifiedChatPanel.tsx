// src/components/chat/UnifiedChatPanel.tsx
// ─── WhatsApp‑style Chat Panel ──────────────────────────────────────────────
//
// Redesigned with:
//  • Mobile‑WhatsApp navigation (conversation list ↔ chat view)
//  • Role‑based sender colors & hierarchy perks
//  • Urgent message support with notifications
//  • Real‑time WebSocket messages
//  • AI Assistant with persistent multi-conversation history
//
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Bot, MessageSquare, Send, ChevronDown,
  Lock, Shield, Plus, Trash2, ArrowLeft, X,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  listChatRooms, listChatMessages, sendChatMessage,
  listChatUsers, createDirectRoom,
  type ChatUser,
} from '../../api/chat';
import {
  listConversations, getConversation, deleteConversation,
  type ConversationSummary, type ConversationFull,
} from '../../api/assistant';
import { API_BASE, getAuthToken, getWebSocketBase } from '../../api/client';

// Sub‑components
import MarkdownMessage from './MarkdownMessage';
import ChatSidebar from './ChatSidebar';
import ChatWindow from './ChatWindow';
import NotificationToast from './NotificationToast';
import type { ChatRoom } from './ChatSidebar';
import type { Message } from './MessageBubble';
import type { ChatNotification } from './NotificationToast';

/* ================================================================== */
/*  Types                                                             */
/* ================================================================== */

type ToolCallInfo = { name: string; args: any; result?: string };
type AssistantMessage = {
  role: 'user' | 'assistant';
  text: string;
  toolCalls?: ToolCallInfo[];
  isStreaming?: boolean;
};

type View = 'sidebar' | 'chat';
type AssistantView = 'list' | 'chat';

/* ================================================================== */
/*  Outer wrapper – auth gate                                         */
/* ================================================================== */

const UnifiedChatPanel = ({ onClose }: { onClose?: () => void }) => {
  const { user } = useAuth();

  if (!user) {
    return (
      <div className="h-full bg-cyber-base flex items-center justify-center">
        <div className="text-center">
          <Lock size={28} className="mx-auto mb-2 text-gray-600" />
          <p className="text-gray-500 text-sm font-fira">Please log in to use chat.</p>
        </div>
      </div>
    );
  }

  return <ChatPanelInner user={user} onClose={onClose} />;
};

/* ================================================================== */
/*  Inner panel – all the logic                                       */
/* ================================================================== */

const ChatPanelInner = ({
  user,
  onClose,
}: {
  user: { id: string; name?: string; email: string; role: string };
  onClose?: () => void;
}) => {
  /* ─── Tab state ─── */
  const [activeTab, setActiveTab] = useState<'assistant' | 'chat'>('chat');

  /* ─── Chat state ─── */
  const [view, setView] = useState<View>('sidebar');
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [activeRoom, setActiveRoom] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatUsers, setChatUsers] = useState<ChatUser[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  /* ─── Notifications ─── */
  const [notifications, setNotifications] = useState<ChatNotification[]>([]);

  /* ─── Assistant conversation state ─── */
  const [assistantView, setAssistantView] = useState<AssistantView>('list');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConvoId, setActiveConvoId] = useState<string | null>(null);
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([]);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [convoListLoading, setConvoListLoading] = useState(false);

  /* ─── Refs ─── */
  const assistantEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const activeRoomRef = useRef<string | null>(null);
  const viewRef = useRef<View>('sidebar');

  // Keep refs in sync
  useEffect(() => { activeRoomRef.current = activeRoom?.id ?? null; }, [activeRoom?.id]);
  useEffect(() => { viewRef.current = view; }, [view]);

  /* ─── Total unread count ─── */
  const totalUnread = rooms.reduce((s, r) => s + r.unreadCount, 0);

  /* ================================================================ */
  /*  Data fetching                                                   */
  /* ================================================================ */

  useEffect(() => {
    if (activeTab !== 'chat') return;
    let alive = true;
    setChatLoading(true);
    setChatError(null);

    Promise.all([listChatRooms(), listChatUsers()])
      .then(([roomsData, usersData]) => {
        if (!alive) return;
        setRooms(roomsData);
        setChatUsers(usersData.filter((u) => u.id !== user.id));
      })
      .catch((err) => {
        if (!alive) return;
        setChatError((err as Error).message || 'Failed to load chat');
      })
      .finally(() => { if (alive) setChatLoading(false); });

    return () => { alive = false; };
  }, [activeTab]);

  // Load messages when room changes
  useEffect(() => {
    if (activeTab !== 'chat' || !activeRoom) return;
    let alive = true;
    setChatLoading(true);
    setChatError(null);

    listChatMessages(activeRoom.id)
      .then((data) => { if (alive) setMessages(data as Message[]); })
      .catch((err) => { if (alive) setChatError((err as Error).message || 'Failed to load messages'); })
      .finally(() => { if (alive) setChatLoading(false); });

    return () => { alive = false; };
  }, [activeTab, activeRoom?.id]);

  /* ─── Load assistant conversations list ─── */
  const loadConversations = useCallback(async () => {
    setConvoListLoading(true);
    try {
      const data = await listConversations();
      setConversations(data);
    } catch {
      // silently fail — user will see empty list
    } finally {
      setConvoListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'assistant' && assistantView === 'list') {
      loadConversations();
    }
  }, [activeTab, assistantView, loadConversations]);

  /* ─── Load a specific conversation ─── */
  const openConversation = useCallback(async (id: string) => {
    setActiveConvoId(id);
    setAssistantView('chat');
    setAssistantMessages([]);
    try {
      const convo: ConversationFull = await getConversation(id);
      const msgs: AssistantMessage[] = convo.messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        text: m.content,
        toolCalls: m.toolCalls as ToolCallInfo[] | undefined,
      }));
      setAssistantMessages(msgs);
    } catch {
      setAssistantMessages([{ role: 'assistant', text: 'Failed to load conversation history.' }]);
    }
  }, []);

  /* ─── Start a new conversation ─── */
  const startNewConversation = useCallback(() => {
    setActiveConvoId(null);
    setAssistantMessages([]);
    setAssistantView('chat');
  }, []);

  /* ─── Delete a conversation ─── */
  const handleDeleteConvo = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteConversation(id);
      setConversations((p) => p.filter((c) => c.id !== id));
      if (activeConvoId === id) {
        setActiveConvoId(null);
        setAssistantMessages([]);
        setAssistantView('list');
      }
    } catch {
      // silently fail
    }
  }, [activeConvoId]);

  /* ─── Back to conversation list ─── */
  const backToConvoList = useCallback(() => {
    setAssistantView('list');
    loadConversations();
  }, [loadConversations]);

  /* ================================================================ */
  /*  WebSocket                                                       */
  /* ================================================================ */

  useEffect(() => {
    const token = getAuthToken();
    if (!token) return;

    let alive = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (!alive) return;
      const ws = new WebSocket(`${getWebSocketBase()}/ws?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as
            | { type: 'message'; message: Message; roomId: string }
            | { type: 'room'; room: ChatRoom };

          if (payload.type === 'message') {
            const msg = payload.message;

            setMessages((prev) => {
              if (msg.roomId !== activeRoomRef.current) return prev;
              if (prev.some((m) => m.id === msg.id)) return prev;
              return [...prev, msg];
            });

            setRooms((prev) => {
              const updated = prev.map((r) => {
                if (r.id !== msg.roomId) return r;
                const incr = msg.sender.id !== user.id && activeRoomRef.current !== r.id;
                return {
                  ...r,
                  lastMessage: msg.content,
                  unreadCount: incr ? r.unreadCount + 1 : r.unreadCount,
                };
              });
              const target = updated.find((r) => r.id === msg.roomId);
              if (!target) return updated;
              return [target, ...updated.filter((r) => r.id !== msg.roomId)];
            });

            if (
              msg.sender.id !== user.id &&
              (msg.roomId !== activeRoomRef.current || viewRef.current !== 'chat')
            ) {
              const isUrgent = msg.priority === 'urgent' || msg.content.startsWith('\u{1f534}');

              const notif: ChatNotification = {
                id: msg.id,
                senderName: msg.sender.name,
                senderRole: msg.sender.role,
                senderId: msg.sender.id,
                roomId: msg.roomId,
                roomName: '',
                content: msg.content.slice(0, 100),
                isUrgent,
                timestamp: Date.now(),
              };

              setRooms((prev) => {
                const room = prev.find((r) => r.id === msg.roomId);
                if (room) {
                  notif.roomName =
                    room.type === 'private'
                      ? (room.participants.find((p) => p.id !== user.id)?.name ?? room.name)
                      : room.name;
                }
                return prev;
              });

              setNotifications((prev) => [notif, ...prev].slice(0, 10));

              if (Notification.permission === 'granted') {
                const title = isUrgent
                  ? `\u{1f534} URGENT: ${notif.senderName}`
                  : notif.senderName;
                new Notification(title, {
                  body: msg.content.slice(0, 120),
                  tag: msg.id,
                  silent: !isUrgent,
                });
              }
            }
          }

          if (payload.type === 'room') {
            setRooms((prev) => {
              if (prev.some((r) => r.id === payload.room.id)) return prev;
              return [payload.room, ...prev];
            });
          }
        } catch (err) {
          console.error('WS parse error:', err);
        }
      };

      ws.onclose = () => {
        if (alive) reconnectTimer = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    };

    connect();

    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    return () => {
      alive = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [user?.id]);

  /* ================================================================ */
  /*  Handlers                                                        */
  /* ================================================================ */

  const handleSelectRoom = useCallback(
    (room: ChatRoom) => {
      setActiveRoom(room);
      setView('chat');
      setRooms((prev) =>
        prev.map((r) => (r.id === room.id ? { ...r, unreadCount: 0 } : r)),
      );
    },
    [],
  );

  const handleBackToSidebar = useCallback(() => {
    setView('sidebar');
  }, []);

  const handleSendChatMessage = useCallback(
    async (content: string, priority: 'normal' | 'urgent') => {
      if (!activeRoom) return;
      setChatError(null);

      try {
        const finalContent = priority === 'urgent' ? `\u{1f534} ${content}` : content;
        await sendChatMessage(activeRoom.id, finalContent);
      } catch (err) {
        setChatError((err as Error).message || 'Failed to send message');
      }
    },
    [activeRoom],
  );

  const handleStartDirect = useCallback(async (targetId: string) => {
    if (!targetId) return;
    setChatError(null);
    setChatLoading(true);

    try {
      const room = await createDirectRoom(targetId);
      setRooms((prev) => {
        const exists = prev.some((r) => r.id === room.id);
        return exists ? prev : [room, ...prev];
      });
      setActiveRoom(room);
      setView('chat');
      setRooms((prev) =>
        prev.map((r) => (r.id === room.id ? { ...r, unreadCount: 0 } : r)),
      );
    } catch (err) {
      setChatError((err as Error).message || 'Failed to start conversation');
    } finally {
      setChatLoading(false);
    }
  }, []);

  const handleNotificationClick = useCallback(
    (notif: ChatNotification) => {
      const room = rooms.find((r) => r.id === notif.roomId);
      if (room) {
        handleSelectRoom(room);
        setActiveTab('chat');
      }
      setNotifications((prev) => prev.filter((n) => n.id !== notif.id));
    },
    [rooms, handleSelectRoom],
  );

  const handleDismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  /* ================================================================ */
  /*  Assistant send handler                                          */
  /* ================================================================ */

  const handleSendAssistant = async () => {
    if (!assistantInput.trim()) return;
    const queryText = assistantInput;
    const userMsg: AssistantMessage = { role: 'user', text: queryText };
    const next = [...assistantMessages, userMsg];
    setAssistantMessages(next);
    setAssistantInput('');
    setAssistantLoading(true);

    try {
      const token = getAuthToken();
      if (!token) throw new Error('Not signed in');

      const res = await fetch(`${API_BASE}/assistant/ask/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          query: queryText,
          history: next,
          conversationId: activeConvoId || undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(errData?.error || 'Assistant request failed');
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';
      const toolCalls: ToolCallInfo[] = [];

      // Add a streaming placeholder message
      setAssistantMessages((p) => [
        ...p,
        { role: 'assistant', text: 'Thinking...', isStreaming: true, toolCalls: [] },
      ]);

      const updateStreamMsg = (updates: Partial<AssistantMessage>) => {
        setAssistantMessages((p) => {
          const copy = [...p];
          const last = copy[copy.length - 1];
          if (last && last.role === 'assistant') {
            copy[copy.length - 1] = { ...last, ...updates };
          }
          return copy;
        });
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventType === 'conversation') {
                // Server created/confirmed the conversation — track its ID
                if (data.id) setActiveConvoId(data.id);
              } else if (eventType === 'status') {
                updateStreamMsg({ text: data.message });
              } else if (eventType === 'tool_call') {
                toolCalls.push({ name: data.name, args: data.args });
                const toolLabel = formatToolName(data.name);
                updateStreamMsg({
                  text: `Executing: **${toolLabel}**...`,
                  toolCalls: [...toolCalls],
                });
              } else if (eventType === 'tool_result') {
                const tc = toolCalls.find((t) => t.name === data.name && !t.result);
                if (tc) tc.result = data.result;
                updateStreamMsg({ toolCalls: [...toolCalls] });
              } else if (eventType === 'answer') {
                updateStreamMsg({
                  text: data.answer_md ?? '(no response)',
                  isStreaming: false,
                  toolCalls: data.toolCalls ?? toolCalls,
                });
                // Update conversation ID if returned
                if (data.conversationId) setActiveConvoId(data.conversationId);
              } else if (eventType === 'error') {
                updateStreamMsg({
                  text: `\u26a0\ufe0f ${data.message}`,
                  isStreaming: false,
                });
              }
            } catch {}
            eventType = '';
          }
        }
      }
    } catch (err) {
      setAssistantMessages((p) => {
        const copy = [...p];
        const last = copy[copy.length - 1];
        if (last?.isStreaming) {
          copy[copy.length - 1] = { role: 'assistant', text: `\u26a0\ufe0f ${(err as Error).message}` };
        } else {
          copy.push({ role: 'assistant', text: `\u26a0\ufe0f ${(err as Error).message}` });
        }
        return copy;
      });
    } finally {
      setAssistantLoading(false);
    }
  };

  /** Human-readable tool names */
  const formatToolName = (name: string): string => {
    const map: Record<string, string> = {
      list_projects: 'Listing projects',
      create_project: 'Creating project',
      list_deployments: 'Checking deployments',
      trigger_deployment: 'Triggering deployment',
      trigger_pipeline: 'Running pipeline',
      list_incidents: 'Checking incidents',
      create_incident: 'Creating incident',
      update_incident: 'Updating incident',
      list_runbooks: 'Loading runbooks',
      get_deployment_targets: 'Checking deployment targets',
      get_pipeline_status: 'Checking pipeline status',
      rollback_deployment: 'Rolling back deployment',
      create_repo: 'Creating repository',
      list_repos: 'Listing repositories',
      link_repo_to_project: 'Linking repository',
      list_integrations: 'Checking integrations',
      scaffold_project: 'Generating project architecture',
    };
    return map[name] || name.replace(/_/g, ' ');
  };

  /** Format relative time */
  const timeAgo = (dateStr: string): string => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  // Auto-scroll assistant messages
  useEffect(() => {
    assistantEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [assistantMessages]);

  /* ================================================================ */
  /*  Full render                                                     */
  /* ================================================================ */

  return (
    <>
      {/* Floating notifications */}
      <NotificationToast
        notifications={notifications}
        onDismiss={handleDismissNotification}
        onClick={handleNotificationClick}
      />

      <div className="flex flex-col h-full bg-cyber-base overflow-hidden">
        {/* ── Tab Bar ── */}
        <div className="flex items-center justify-between bg-cyber-base border-b border-cyber-cyan/20 shrink-0">
          <div className="flex">
            <button
              className={`relative px-5 py-2.5 text-sm font-semibold flex items-center gap-2 transition-all
                ${
                  activeTab === 'chat'
                    ? 'text-cyber-green border-b-2 border-cyber-green bg-cyber-green/5'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.02]'
                }`}
              onClick={() => setActiveTab('chat')}
            >
              <MessageSquare size={15} />
              Chat
              {totalUnread > 0 && (
                <span className="bg-cyber-green text-cyber-base text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                  {totalUnread}
                </span>
              )}
            </button>
            <button
              className={`px-5 py-2.5 text-sm font-semibold flex items-center gap-2 transition-all
                ${
                  activeTab === 'assistant'
                    ? 'text-cyber-cyan border-b-2 border-cyber-cyan bg-cyber-cyan/5'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.02]'
                }`}
              onClick={() => setActiveTab('assistant')}
            >
              <Bot size={15} />
              Assistant
            </button>
          </div>

          {onClose && (
            <button
              onClick={onClose}
              className="p-2 mr-2 rounded-lg text-gray-500 hover:text-white hover:bg-white/10 transition"
              title="Close panel"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-hidden min-h-0">
          {/* ════════════ CHAT TAB ════════════ */}
          {activeTab === 'chat' && (
            <div className="h-full">
              {view === 'sidebar' ? (
                <ChatSidebar
                  rooms={rooms}
                  activeRoomId={activeRoom?.id ?? null}
                  onSelectRoom={handleSelectRoom}
                  chatUsers={chatUsers}
                  onStartDirect={handleStartDirect}
                  currentUser={user}
                />
              ) : activeRoom ? (
                <ChatWindow
                  room={activeRoom}
                  messages={messages}
                  currentUser={user}
                  onSendMessage={handleSendChatMessage}
                  onBack={handleBackToSidebar}
                  loading={chatLoading}
                  error={chatError}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-gray-500 text-sm">
                  Select a conversation
                </div>
              )}
            </div>
          )}

          {/* ════════════ ASSISTANT TAB ════════════ */}
          {activeTab === 'assistant' && (
            <div className="flex flex-col h-full">
              {/* ── Conversation List View ── */}
              {assistantView === 'list' && (
                <div className="flex flex-col h-full">
                  {/* List header */}
                  <div className="px-4 py-3 border-b border-cyber-cyan/20 shrink-0 bg-cyber-base flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyber-cyan/20 to-cyber-green/10 flex items-center justify-center ring-2 ring-cyber-cyan/20">
                        <Bot size={17} className="text-cyber-cyan" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-white">
                          DevOps Agent
                        </h3>
                        <p className="text-[11px] text-gray-500">
                          v3.0 • Your conversations
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={startNewConversation}
                      className="p-2 rounded-lg bg-cyber-cyan/10 text-cyber-cyan hover:bg-cyber-cyan/20 transition"
                      title="New conversation"
                    >
                      <Plus size={16} />
                    </button>
                  </div>

                  {/* Conversation list */}
                  <div className="flex-1 overflow-y-auto overscroll-contain">
                    {convoListLoading && conversations.length === 0 ? (
                      <div className="flex items-center justify-center py-12">
                        <div className="flex items-center gap-2 text-gray-500 text-sm">
                          <div className="w-2 h-2 bg-cyber-cyan rounded-full animate-bounce" />
                          <span>Loading...</span>
                        </div>
                      </div>
                    ) : conversations.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-gray-500 px-4">
                        <div className="w-16 h-16 rounded-full bg-cyber-cyan/10 flex items-center justify-center mb-3">
                          <Bot size={28} className="text-cyber-cyan/40" />
                        </div>
                        <p className="text-sm font-medium text-gray-400">
                          No conversations yet
                        </p>
                        <p className="text-xs mt-1 text-center max-w-[240px]">
                          Start a new conversation with the agent to deploy, manage incidents, and more.
                        </p>
                        <button
                          onClick={startNewConversation}
                          className="mt-4 px-4 py-2 rounded-xl bg-cyber-cyan/15 border border-cyber-cyan/20 text-cyber-cyan text-sm hover:bg-cyber-cyan/25 transition"
                        >
                          <Plus size={14} className="inline mr-1.5 -mt-0.5" />
                          New Conversation
                        </button>
                      </div>
                    ) : (
                      <div className="py-1">
                        {conversations.map((c) => (
                          <div
                            key={c.id}
                            onClick={() => openConversation(c.id)}
                            className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/[0.03] transition group"
                          >
                            <div className="w-9 h-9 rounded-full bg-cyber-cyan/10 flex items-center justify-center shrink-0">
                              <Bot size={15} className="text-cyber-cyan/60" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-white truncate pr-2">
                                  {c.title}
                                </span>
                                <span className="text-[10px] text-gray-600 shrink-0">
                                  {timeAgo(c.updatedAt)}
                                </span>
                              </div>
                              <div className="text-[11px] text-gray-500 mt-0.5">
                                {c._count.messages} message{c._count.messages !== 1 ? 's' : ''}
                              </div>
                            </div>
                            <button
                              onClick={(e) => handleDeleteConvo(c.id, e)}
                              className="p-1.5 rounded opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 hover:bg-red-900/20 transition"
                              title="Delete conversation"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Active Conversation View ── */}
              {assistantView === 'chat' && (
                <div className="flex flex-col h-full">
                  {/* Chat header */}
                  <div className="px-3 py-2.5 border-b border-cyber-cyan/20 shrink-0 bg-cyber-base flex items-center gap-2">
                    <button
                      onClick={backToConvoList}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition"
                      title="Back to conversations"
                    >
                      <ArrowLeft size={16} />
                    </button>
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyber-cyan/20 to-cyber-green/10 flex items-center justify-center ring-1 ring-cyber-cyan/20">
                      <Bot size={14} className="text-cyber-cyan" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-white truncate">
                        {activeConvoId
                          ? conversations.find((c) => c.id === activeConvoId)?.title || 'Conversation'
                          : 'New Conversation'}
                      </h3>
                      <p className="text-[10px] text-gray-500">
                        Autonomous Agent • Can execute actions
                      </p>
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto px-4 py-3 overscroll-contain">
                    {assistantMessages.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                        <div className="w-16 h-16 rounded-full bg-cyber-cyan/10 flex items-center justify-center mb-3">
                          <Bot size={28} className="text-cyber-cyan/40" />
                        </div>
                        <p className="text-sm font-medium text-gray-400">
                          Autonomous Agent Ready
                        </p>
                        <p className="text-xs mt-1 text-center max-w-[240px]">
                          I can deploy services, trigger pipelines, manage incidents, check status — just ask.
                        </p>
                      </div>
                    )}

                    <div className="space-y-3">
                      {assistantMessages.map((msg, i) => (
                        <div
                          key={i}
                          className={
                            msg.role === 'user'
                              ? 'flex justify-end'
                              : 'flex justify-start'
                          }
                        >
                          <div
                            className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm font-fira ${
                              msg.role === 'user'
                                ? 'bg-cyber-cyan/15 border border-cyber-cyan/20 rounded-br-md text-cyber-text'
                                : 'bg-gray-900/60 border border-cyber-cyan/10 rounded-bl-md text-cyber-text/80'
                            }`}
                          >
                            {/* Tool call badges */}
                            {msg.toolCalls && msg.toolCalls.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mb-2">
                                {msg.toolCalls.map((tc, j) => (
                                  <span
                                    key={j}
                                    className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium ${
                                      tc.result
                                        ? 'bg-cyber-green/15 text-cyber-green border border-cyber-green/20'
                                        : 'bg-amber-500/15 text-amber-400 border border-amber-500/20 animate-pulse'
                                    }`}
                                  >
                                    {tc.result ? '\u2713' : '\u27f3'} {formatToolName(tc.name)}
                                  </span>
                                ))}
                              </div>
                            )}
                            {msg.role === 'user' ? (
                              <pre className="whitespace-pre-wrap font-fira text-[13px] leading-relaxed">
                                {msg.text}
                              </pre>
                            ) : (
                              <MarkdownMessage content={msg.text} />
                            )}
                            <div
                              className={`text-[10px] mt-1.5 ${
                                msg.role === 'user'
                                  ? 'text-white/30'
                                  : 'text-white/25'
                              }`}
                            >
                              {msg.role === 'user' ? 'You' : msg.toolCalls?.length ? 'Agent' : 'Assistant'}
                            </div>
                          </div>
                        </div>
                      ))}
                      {assistantLoading && assistantMessages[assistantMessages.length - 1]?.role !== 'assistant' && (
                        <div className="flex justify-start">
                          <div className="bg-gray-900/60 border border-cyber-cyan/10 rounded-2xl rounded-bl-md px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <div className="w-2 h-2 bg-cyber-cyan rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                              <div className="w-2 h-2 bg-cyber-cyan rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                              <div className="w-2 h-2 bg-cyber-cyan rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                            </div>
                          </div>
                        </div>
                      )}
                      <div ref={assistantEndRef} />
                    </div>
                  </div>

                  {/* Input */}
                  <div className="border-t border-cyber-cyan/20 bg-cyber-base p-3 shrink-0">
                    <div className="flex gap-2">
                      <textarea
                        value={assistantInput}
                        onChange={(e) => setAssistantInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && e.ctrlKey) {
                            e.preventDefault();
                            handleSendAssistant();
                          }
                        }}
                        placeholder="Deploy my app, check incidents, trigger pipeline... (Ctrl+Enter)"
                        rows={2}
                        className="flex-1 bg-gray-900/60 border border-cyber-cyan/20 text-cyber-text text-sm font-fira px-4 py-2.5 rounded-2xl
                                   placeholder-gray-500 resize-none focus:outline-none focus:border-cyber-cyan/40 focus:ring-1
                                   focus:ring-cyber-cyan/20 transition"
                      />
                      <button
                        onClick={handleSendAssistant}
                        disabled={assistantLoading || !assistantInput.trim()}
                        className={`p-3 rounded-full transition-all self-end ${
                          assistantInput.trim()
                            ? 'bg-cyber-cyan text-cyber-base hover:bg-cyber-cyan/90 shadow-lg shadow-cyber-cyan/20'
                            : 'bg-gray-700/50 text-gray-500 cursor-not-allowed'
                        }`}
                      >
                        <Send size={16} />
                      </button>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-gray-600 mt-2 px-1">
                      <div className="flex items-center gap-1">
                        <Lock size={9} className="text-emerald-500/70" />
                        <span>Encrypted</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Shield size={9} className="text-cyber-green/70" />
                        <span>RBAC • {user.role.toUpperCase()}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default UnifiedChatPanel;
