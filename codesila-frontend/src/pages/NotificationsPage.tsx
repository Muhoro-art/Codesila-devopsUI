import { useState, useEffect, useCallback } from "react";
import {
  listNotifications, markNotificationRead, markAllNotificationsRead,
  type AppNotification,
} from "../api/saas";

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const load = useCallback(async () => {
    try {
      const res = await listNotifications(filter === "unread");
      setNotifications(res.notifications);
      setUnreadCount(res.unreadCount);
    } catch {}
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const handleMarkRead = async (id: string) => {
    await markNotificationRead(id);
    load();
  };

  const handleMarkAllRead = async () => {
    await markAllNotificationsRead();
    load();
  };

  const typeIcon: Record<string, string> = {
    SYSTEM: "⚙️",
    BILLING: "💳",
    INVITATION: "📨",
    DEPLOYMENT: "🚀",
    INCIDENT: "🚨",
    SECURITY: "🔒",
    USAGE_WARNING: "⚠️",
    FEATURE_UPDATE: "✨",
  };

  return (
    <div className="text-gray-200">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-orbitron text-cyber-cyan">Notifications</h1>
            <p className="text-gray-400 mt-1">{unreadCount} unread</p>
          </div>
          {unreadCount > 0 && (
            <button onClick={handleMarkAllRead} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-300">
              Mark all as read
            </button>
          )}
        </div>

        <div className="flex gap-2">
          <button onClick={() => setFilter("all")}
            className={`px-3 py-1.5 rounded text-sm ${filter === "all" ? "bg-cyber-cyan text-cyber-base" : "bg-gray-700 text-gray-400"}`}>
            All
          </button>
          <button onClick={() => setFilter("unread")}
            className={`px-3 py-1.5 rounded text-sm ${filter === "unread" ? "bg-cyber-cyan text-cyber-base" : "bg-gray-700 text-gray-400"}`}>
            Unread ({unreadCount})
          </button>
        </div>

        <div className="space-y-2">
          {loading ? (
            <div className="text-center text-gray-500 animate-pulse py-12">Loading...</div>
          ) : notifications.length === 0 ? (
            <div className="text-center text-gray-500 py-12">
              {filter === "unread" ? "No unread notifications" : "No notifications yet"}
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                className={`flex items-start gap-4 p-4 rounded-lg border transition-colors cursor-pointer ${
                  n.readAt
                    ? "bg-cyber-surface border-gray-700"
                    : "bg-cyber-surface border-cyber-cyan/30"
                }`}
                onClick={() => !n.readAt && handleMarkRead(n.id)}
              >
                <span className="text-xl">{typeIcon[n.type] || "📌"}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${n.readAt ? "text-gray-400" : "text-white"}`}>
                      {n.title}
                    </span>
                    {!n.readAt && <span className="w-2 h-2 rounded-full bg-cyber-cyan flex-shrink-0" />}
                  </div>
                  {n.body && <p className="text-xs text-gray-500 mt-1">{n.body}</p>}
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-gray-600">{new Date(n.createdAt).toLocaleString()}</span>
                    {n.link && (
                      <a href={n.link} className="text-xs text-cyber-cyan hover:underline" onClick={(e) => e.stopPropagation()}>
                        View →
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
