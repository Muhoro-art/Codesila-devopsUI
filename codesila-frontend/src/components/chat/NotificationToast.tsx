// src/components/chat/NotificationToast.tsx
import { useEffect, useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { getRoleColor, getAvatarColor, getRoleLabel } from './chatConfig';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface ChatNotification {
  id: string;
  senderName: string;
  senderRole: string;
  senderId: string;
  roomId: string;
  roomName: string;
  content: string;
  isUrgent: boolean;
  timestamp: number;
}

interface Props {
  notifications: ChatNotification[];
  onDismiss: (id: string) => void;
  onClick: (notification: ChatNotification) => void;
}

/* ------------------------------------------------------------------ */
/*  Single Toast                                                      */
/* ------------------------------------------------------------------ */

const Toast = ({
  notification,
  onDismiss,
  onClick,
}: {
  notification: ChatNotification;
  onDismiss: () => void;
  onClick: () => void;
}) => {
  const [isExiting, setIsExiting] = useState(false);
  const roleColor = getRoleColor(notification.senderRole);
  const avatarColor = getAvatarColor(notification.senderId);

  // Auto-dismiss after 6s (urgent stays longer: 12s)
  useEffect(() => {
    const timeout = setTimeout(() => {
      setIsExiting(true);
      setTimeout(onDismiss, 300);
    }, notification.isUrgent ? 12000 : 6000);

    return () => clearTimeout(timeout);
  }, []);

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExiting(true);
    setTimeout(onDismiss, 300);
  };

  return (
    <div
      onClick={onClick}
      className={`
        relative overflow-hidden rounded-xl cursor-pointer
        transition-all duration-300 ease-out
        ${isExiting ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0'}
        ${notification.isUrgent
          ? 'bg-red-950/90 border border-red-500/40 shadow-lg shadow-red-500/10'
          : 'bg-cyber-base/95 border border-cyber-cyan/20 shadow-lg shadow-black/30'
        }
        backdrop-blur-sm
      `}
    >
      {/* Urgent pulse bar */}
      {notification.isUrgent && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-red-500 via-red-400 to-red-500 animate-pulse" />
      )}

      <div className="flex items-start gap-3 p-3">
        {/* Avatar */}
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
          style={{ backgroundColor: avatarColor + '25', color: avatarColor }}
        >
          {notification.senderName[0]?.toUpperCase() ?? '?'}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-sm font-semibold text-white truncate">
              {notification.senderName}
            </span>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${roleColor.bg} ${roleColor.text}`}>
              {getRoleLabel(notification.senderRole)}
            </span>
            {notification.isUrgent && (
              <AlertTriangle size={11} className="text-red-400 shrink-0" />
            )}
          </div>
          <p className="text-xs text-gray-400 truncate">{notification.roomName}</p>
          <p className="text-xs text-gray-300 truncate mt-0.5">
            {notification.content}
          </p>
        </div>

        {/* Dismiss */}
        <button
          onClick={handleDismiss}
          className="p-1 rounded-lg text-gray-500 hover:text-white hover:bg-white/10 transition shrink-0"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Toast Container                                                   */
/* ------------------------------------------------------------------ */

const NotificationToast = ({ notifications, onDismiss, onClick }: Props) => {
  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] w-80 space-y-2 pointer-events-auto">
      {notifications.slice(0, 3).map((notif) => (
        <Toast
          key={notif.id}
          notification={notif}
          onDismiss={() => onDismiss(notif.id)}
          onClick={() => onClick(notif)}
        />
      ))}
      {notifications.length > 3 && (
        <div className="text-center text-xs text-gray-500 py-1">
          +{notifications.length - 3} more messages
        </div>
      )}
    </div>
  );
};

export default NotificationToast;
