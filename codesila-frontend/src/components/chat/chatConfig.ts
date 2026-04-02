// ─── Role Hierarchy, Colors & Perks ─────────────────────────────────────────
// Higher number = higher in hierarchy = more perks

export const ROLE_HIERARCHY: Record<string, number> = {
  super_admin: 6,
  admin: 5,
  manager: 4,
  devops: 3,
  developer: 2,
  pm: 2,
  user: 1,
};

export interface RoleColorConfig {
  /** Tailwind/hex background for subtle tints */
  bg: string;
  /** Foreground / name color */
  text: string;
  /** Accent (online dot, highlights) */
  accent: string;
  /** Bubble background for sent messages - slightly tinted */
  bubbleSent: string;
  /** Label shown in badge */
  label: string;
  /** Ring / glow class */
  ring: string;
}

export const ROLE_COLORS: Record<string, RoleColorConfig> = {
  super_admin: {
    bg: 'bg-amber-900/30',
    text: 'text-amber-400',
    accent: '#f59e0b',
    bubbleSent: 'bg-amber-900/40 border-amber-500/30',
    label: 'OWNER',
    ring: 'ring-amber-500/50',
  },
  admin: {
    bg: 'bg-amber-900/25',
    text: 'text-amber-300',
    accent: '#fbbf24',
    bubbleSent: 'bg-amber-900/30 border-amber-400/25',
    label: 'ADMIN',
    ring: 'ring-amber-400/40',
  },
  manager: {
    bg: 'bg-purple-900/25',
    text: 'text-purple-400',
    accent: '#a855f7',
    bubbleSent: 'bg-purple-900/30 border-purple-500/25',
    label: 'MANAGER',
    ring: 'ring-purple-500/40',
  },
  devops: {
    bg: 'bg-cyan-900/25',
    text: 'text-cyan-400',
    accent: '#06b6d4',
    bubbleSent: 'bg-cyan-900/30 border-cyan-500/25',
    label: 'DEVOPS',
    ring: 'ring-cyan-500/40',
  },
  developer: {
    bg: 'bg-emerald-900/25',
    text: 'text-emerald-400',
    accent: '#10b981',
    bubbleSent: 'bg-emerald-900/30 border-emerald-500/25',
    label: 'DEV',
    ring: 'ring-emerald-500/40',
  },
  pm: {
    bg: 'bg-pink-900/25',
    text: 'text-pink-400',
    accent: '#ec4899',
    bubbleSent: 'bg-pink-900/30 border-pink-500/25',
    label: 'PM',
    ring: 'ring-pink-500/40',
  },
  user: {
    bg: 'bg-slate-700/30',
    text: 'text-slate-400',
    accent: '#94a3b8',
    bubbleSent: 'bg-slate-700/30 border-slate-500/20',
    label: 'USER',
    ring: 'ring-slate-500/30',
  },
};

export interface RolePerks {
  canMarkUrgent: boolean;
  canPinMessage: boolean;
  canDeleteAny: boolean;
  canBroadcast: boolean;
  canCreateGroup: boolean;
  canSendFiles: boolean;
  canReact: boolean;
  maxMessageLength: number;
}

export const ROLE_PERKS: Record<string, RolePerks> = {
  super_admin: {
    canMarkUrgent: true,
    canPinMessage: true,
    canDeleteAny: true,
    canBroadcast: true,
    canCreateGroup: true,
    canSendFiles: true,
    canReact: true,
    maxMessageLength: 10000,
  },
  admin: {
    canMarkUrgent: true,
    canPinMessage: true,
    canDeleteAny: true,
    canBroadcast: true,
    canCreateGroup: true,
    canSendFiles: true,
    canReact: true,
    maxMessageLength: 10000,
  },
  manager: {
    canMarkUrgent: true,
    canPinMessage: true,
    canDeleteAny: false,
    canBroadcast: false,
    canCreateGroup: true,
    canSendFiles: true,
    canReact: true,
    maxMessageLength: 5000,
  },
  devops: {
    canMarkUrgent: true,
    canPinMessage: false,
    canDeleteAny: false,
    canBroadcast: false,
    canCreateGroup: true,
    canSendFiles: true,
    canReact: true,
    maxMessageLength: 3000,
  },
  developer: {
    canMarkUrgent: false,
    canPinMessage: false,
    canDeleteAny: false,
    canBroadcast: false,
    canCreateGroup: false,
    canSendFiles: true,
    canReact: true,
    maxMessageLength: 2000,
  },
  pm: {
    canMarkUrgent: false,
    canPinMessage: false,
    canDeleteAny: false,
    canBroadcast: false,
    canCreateGroup: true,
    canSendFiles: true,
    canReact: true,
    maxMessageLength: 2000,
  },
  user: {
    canMarkUrgent: false,
    canPinMessage: false,
    canDeleteAny: false,
    canBroadcast: false,
    canCreateGroup: false,
    canSendFiles: false,
    canReact: false,
    maxMessageLength: 500,
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

export function getRoleLevel(role?: string | null): number {
  if (!role) return 1;
  return ROLE_HIERARCHY[role.toLowerCase()] ?? 1;
}

export function getRoleColor(role?: string | null): RoleColorConfig {
  if (!role) return ROLE_COLORS.user;
  return ROLE_COLORS[role.toLowerCase()] ?? ROLE_COLORS.user;
}

export function getRolePerks(role?: string | null): RolePerks {
  if (!role) return ROLE_PERKS.user;
  return ROLE_PERKS[role.toLowerCase()] ?? ROLE_PERKS.user;
}

export function getRoleLabel(role?: string | null): string {
  return getRoleColor(role).label;
}

/** Generate a stable avatar color from a user id */
export function getAvatarColor(userId: string): string {
  const colors = [
    '#ef4444', '#f97316', '#f59e0b', '#84cc16',
    '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
    '#6366f1', '#8b5cf6', '#a855f7', '#ec4899',
  ];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

/** Format timestamp for display */
export function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Format timestamp for message bubble */
export function formatMessageTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Get date separator label */
export function getDateLabel(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/** Check if two timestamps are on different dates */
export function isDifferentDay(ts1: string, ts2: string): boolean {
  const d1 = new Date(ts1);
  const d2 = new Date(ts2);
  return (
    d1.getFullYear() !== d2.getFullYear() ||
    d1.getMonth() !== d2.getMonth() ||
    d1.getDate() !== d2.getDate()
  );
}
