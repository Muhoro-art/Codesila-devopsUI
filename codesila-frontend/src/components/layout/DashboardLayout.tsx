import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, GitBranch, Activity, AlertTriangle,
  Shield, Users, Settings, Bell, CreditCard, Key,
  LogOut, Lock, ChevronLeft, ChevronRight, MessageSquare, BarChart3,
  BookOpen, Link2, GripVertical
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import UnifiedChatPanel from "../chat/UnifiedChatPanel";

interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
}

const NAV_BY_ROLE: Record<string, NavItem[]> = {
  ADMIN: [
    { label: "Dashboard", path: "/admin", icon: LayoutDashboard },
    { label: "Projects", path: "/projects", icon: GitBranch },
    { label: "Integrations", path: "/integrations", icon: Link2 },
    { label: "Team", path: "/team", icon: Users },
    { label: "Audit Log", path: "/audit-log", icon: Shield },
    { label: "Notifications", path: "/notifications", icon: Bell },
    { label: "Billing", path: "/billing", icon: CreditCard },
    { label: "API Keys", path: "/api-keys", icon: Key },
    { label: "Settings", path: "/settings", icon: Settings },
  ],
  SUPER_ADMIN: [
    { label: "Dashboard", path: "/admin", icon: LayoutDashboard },
    { label: "Projects", path: "/projects", icon: GitBranch },
    { label: "Integrations", path: "/integrations", icon: Link2 },
    { label: "Team", path: "/team", icon: Users },
    { label: "Audit Log", path: "/audit-log", icon: Shield },
    { label: "Notifications", path: "/notifications", icon: Bell },
    { label: "Billing", path: "/billing", icon: CreditCard },
    { label: "API Keys", path: "/api-keys", icon: Key },
    { label: "Settings", path: "/settings", icon: Settings },
  ],
  DEVOPS: [
    { label: "Dashboard", path: "/devops", icon: LayoutDashboard },
    { label: "Deployments", path: "/devops/deployments", icon: Activity },
    { label: "Projects", path: "/devops/projects", icon: GitBranch },
    { label: "Integrations", path: "/integrations", icon: Link2 },
    { label: "Incidents", path: "/devops/incidents", icon: AlertTriangle },
    { label: "Insights", path: "/devops/insights", icon: BarChart3 },
    { label: "Settings", path: "/settings", icon: Settings },
  ],
  DEVELOPER: [
    { label: "Dashboard", path: "/developer", icon: LayoutDashboard },
    { label: "Projects", path: "/projects", icon: GitBranch },
    { label: "Notifications", path: "/notifications", icon: Bell },
    { label: "Settings", path: "/settings", icon: Settings },
  ],
  MANAGER: [
    { label: "Dashboard", path: "/manager", icon: LayoutDashboard },
    { label: "Insights", path: "/manager/insights", icon: BarChart3 },
    { label: "Projects", path: "/projects", icon: GitBranch },
    { label: "Incidents", path: "/manager/incidents", icon: AlertTriangle },
    { label: "Runbooks", path: "/manager/runbooks", icon: BookOpen },
    { label: "Audit Log", path: "/audit-log", icon: Shield },
    { label: "Notifications", path: "/notifications", icon: Bell },
    { label: "Settings", path: "/settings", icon: Settings },
  ],
  USER: [
    { label: "Dashboard", path: "/developer", icon: LayoutDashboard },
    { label: "Projects", path: "/projects", icon: GitBranch },
    { label: "Settings", path: "/settings", icon: Settings },
  ],
};

const PANEL_MIN = 320;
const PANEL_MAX = 600;
const PANEL_DEFAULT = 380;

function readStorage<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, organization, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  // Persistent panel state
  const [chatOpen, setChatOpen] = useState(() => readStorage("cs_chatOpen", false));
  const [panelWidth, setPanelWidth] = useState(() => readStorage("cs_chatWidth", PANEL_DEFAULT));

  // Save to localStorage on change
  useEffect(() => { localStorage.setItem("cs_chatOpen", JSON.stringify(chatOpen)); }, [chatOpen]);
  useEffect(() => { localStorage.setItem("cs_chatWidth", JSON.stringify(panelWidth)); }, [panelWidth]);

  // Resize drag state
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartW = useRef(PANEL_DEFAULT);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartW.current = panelWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [panelWidth]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      // Dragging left edge means: moving mouse left = wider panel
      const delta = dragStartX.current - e.clientX;
      const next = Math.min(PANEL_MAX, Math.max(PANEL_MIN, dragStartW.current + delta));
      setPanelWidth(next);
    };
    const onUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const role = user?.role || "USER";
  const navItems = NAV_BY_ROLE[role] || NAV_BY_ROLE.USER;

  const orgLabel =
    organization?.name && organization.name.toUpperCase() !== "CODESILA"
      ? organization.name.toUpperCase()
      : "CODESILA";

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const isActive = (path: string) => location.pathname === path;

  const sidebarW = collapsed ? 64 : 224; // w-16 = 64px, w-56 = 224px

  return (
    <div className="min-h-screen bg-cyber-base text-cyber-text font-fira flex">
      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 h-full z-30 flex flex-col bg-gray-900/80 border-r border-cyber-cyan/20 backdrop-blur-sm transition-all duration-200 ${
          collapsed ? "w-16" : "w-56"
        }`}
      >
        {/* Brand */}
        <div className="flex items-center gap-2 px-4 py-4 border-b border-cyber-cyan/20">
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <h1 className="text-sm font-orbitron text-cyber-cyan truncate">{orgLabel}</h1>
              {organization?.name && organization.name.toUpperCase() !== "CODESILA" && (
                <span className="text-[8px] text-cyber-cyan/40 font-orbitron tracking-wider">CodeSila™</span>
              )}
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1.5 rounded hover:bg-cyber-cyan/10 text-cyber-cyan"
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        {/* User Info */}
        <div className={`px-4 py-3 border-b border-gray-800/60 ${collapsed ? "text-center" : ""}`}>
          {collapsed ? (
            <div
              className="w-8 h-8 mx-auto rounded-full bg-cyber-magenta/20 text-cyber-magenta flex items-center justify-center text-xs font-bold"
              title={`${user?.name || user?.email} (${role})`}
            >
              {(user?.name || user?.email || "U")[0].toUpperCase()}
            </div>
          ) : (
            <>
              <div className="text-sm font-medium truncate">{user?.name || user?.email}</div>
              <div className="text-xs text-cyber-magenta">{role}</div>
            </>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                title={collapsed ? item.label : undefined}
                className={`flex items-center gap-3 px-4 py-2.5 mx-2 rounded text-sm transition-colors ${
                  active
                    ? "bg-cyber-cyan/15 text-cyber-cyan border-l-2 border-cyber-cyan"
                    : "text-gray-400 hover:text-cyber-text hover:bg-gray-800/40"
                }`}
              >
                <Icon size={18} className={active ? "text-cyber-cyan" : ""} />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Bottom Actions */}
        <div className="border-t border-gray-800/60 py-2">
          <button
            onClick={() => setChatOpen(!chatOpen)}
            title="Chat"
            className={`flex items-center gap-3 px-4 py-2.5 mx-2 rounded text-sm w-[calc(100%-16px)] text-gray-400 hover:text-cyber-cyan hover:bg-gray-800/40 transition-colors ${
              chatOpen ? "text-cyber-cyan bg-cyber-cyan/10" : ""
            }`}
          >
            <MessageSquare size={18} />
            {!collapsed && <span>Chat</span>}
          </button>
          <Link
            to="/change-password"
            title="Change Password"
            className="flex items-center gap-3 px-4 py-2.5 mx-2 rounded text-sm text-gray-400 hover:text-cyber-magenta hover:bg-gray-800/40 transition-colors"
          >
            <Lock size={18} />
            {!collapsed && <span>Password</span>}
          </Link>
          <Link
            to="/setup-2fa"
            title="2FA Setup"
            className="flex items-center gap-3 px-4 py-2.5 mx-2 rounded text-sm text-gray-400 hover:text-cyber-green hover:bg-gray-800/40 transition-colors"
          >
            <Shield size={18} />
            {!collapsed && <span>2FA Setup</span>}
          </Link>
          <button
            onClick={handleLogout}
            title="Log Out"
            className="flex items-center gap-3 px-4 py-2.5 mx-2 rounded text-sm w-[calc(100%-16px)] text-gray-400 hover:text-cyber-red hover:bg-red-900/20 transition-colors"
          >
            <LogOut size={18} />
            {!collapsed && <span>Log Out</span>}
          </button>
        </div>
      </aside>

      {/* Main Content — reflows to avoid panel overlap */}
      <div
        className="flex-1 transition-all duration-200"
        style={{
          marginLeft: sidebarW,
          marginRight: chatOpen ? panelWidth : 0,
        }}
      >
        <main className="p-6">{children}</main>
      </div>

      {/* Chat Panel – docked to the right, resizable */}
      {chatOpen && (
        <div
          className="fixed top-0 right-0 h-full z-40 flex"
          style={{ width: panelWidth }}
        >
          {/* Resize handle */}
          <div
            onMouseDown={onResizeStart}
            className="w-1.5 h-full cursor-col-resize flex items-center justify-center group hover:bg-cyber-cyan/10 transition-colors shrink-0"
            title="Drag to resize"
          >
            <div className="w-0.5 h-8 rounded-full bg-cyber-cyan/20 group-hover:bg-cyber-cyan/50 transition-colors" />
          </div>
          {/* Panel content */}
          <div className="flex-1 min-w-0 border-l border-cyber-cyan/20 shadow-2xl">
            <UnifiedChatPanel onClose={() => setChatOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
