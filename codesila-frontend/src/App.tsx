import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import DashboardLayout from "./components/layout/DashboardLayout";
import DeveloperPage from "./pages/DeveloperPage";
import ManagerPage from "./pages/ManagerPage";
import DevOpsPage from "./pages/DevOpsPage";
import AdminPage from "./pages/AdminPage";
import ProjectsPage from "./pages/ProjectsPage";
import LoginPage from "./pages/LoginPage";
import Verify2FAPage from "./pages/Verify2FAPage";
import Setup2FAPage from "./pages/Setup2FAPage";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import ProjectDetailPage from "./pages/ProjectDetailPage";
import RegisterPage from "./pages/RegisterPage";
import BillingPage from "./pages/BillingPage";
import TeamPage from "./pages/TeamPage";
import ApiKeysPage from "./pages/ApiKeysPage";
import AuditLogPage from "./pages/AuditLogPage";
import SettingsPage from "./pages/SettingsPage";
import NotificationsPage from "./pages/NotificationsPage";import PipelinesPage from './pages/PipelinesPage';
import IntegrationsPage from './pages/IntegrationsPage';
import CreateProjectWizard from './pages/CreateProjectWizard';
import './index.css';

/** Route guard — redirects to /login if not authenticated */
function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: string[] }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-cyber-base flex items-center justify-center">
        <div className="text-cyber-cyan animate-pulse font-orbitron">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    // Redirect to role-appropriate dashboard
    const roleRoutes: Record<string, string> = {
      ADMIN: "/admin",
      SUPER_ADMIN: "/admin",
      DEVELOPER: "/developer",
      DEVOPS: "/devops",
      MANAGER: "/manager",
      USER: "/developer",
    };
    return <Navigate to={roleRoutes[user.role] || "/developer"} replace />;
  }

  return <>{children}</>;
}

/** 404 page */
function NotFound() {
  return (
    <div className="min-h-screen bg-cyber-base flex items-center justify-center flex-col gap-4">
      <h1 className="text-6xl font-orbitron text-cyber-cyan">404</h1>
      <p className="text-gray-400">Page not found</p>
      <a href="/" className="text-cyber-cyan hover:underline">Go home</a>
    </div>
  );
}

function RoleRedirect() {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="min-h-screen bg-cyber-base flex items-center justify-center">
        <div className="text-cyber-cyan animate-pulse font-orbitron">Loading...</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  const roleRoutes: Record<string, string> = {
    ADMIN: "/admin",
    SUPER_ADMIN: "/admin",
    DEVELOPER: "/developer",
    DEVOPS: "/devops",
    MANAGER: "/manager",
    USER: "/developer",
  };
  return <Navigate to={roleRoutes[user.role] || "/developer"} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RoleRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/verify-2fa" element={<Verify2FAPage />} />

      {/* Protected routes — all wrapped in DashboardLayout */}
      <Route path="/developer" element={<ProtectedRoute allowedRoles={["DEVELOPER", "USER", "ADMIN", "SUPER_ADMIN"]}><DashboardLayout><DeveloperPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/manager" element={<ProtectedRoute allowedRoles={["MANAGER", "ADMIN", "SUPER_ADMIN"]}><DashboardLayout><ManagerPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/devops" element={<ProtectedRoute allowedRoles={["DEVOPS", "ADMIN", "SUPER_ADMIN"]}><DashboardLayout><DevOpsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute allowedRoles={["ADMIN", "SUPER_ADMIN"]}><DashboardLayout><AdminPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/project/:projectId" element={<ProtectedRoute><DashboardLayout><ProjectDetailPage /></DashboardLayout></ProtectedRoute>} />

      {/* Projects route (shared across roles) */}
      <Route path="/projects" element={<ProtectedRoute><DashboardLayout><ProjectsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/projects/new" element={<ProtectedRoute allowedRoles={["DEVOPS", "ADMIN", "SUPER_ADMIN"]}><DashboardLayout><CreateProjectWizard /></DashboardLayout></ProtectedRoute>} />

      {/* Pipeline management — per-project */}
      <Route path="/project/:projectId/pipelines" element={<ProtectedRoute allowedRoles={["DEVOPS", "ADMIN", "SUPER_ADMIN", "DEVELOPER", "MANAGER"]}><DashboardLayout><PipelinesPage /></DashboardLayout></ProtectedRoute>} />

      {/* Integration management */}
      <Route path="/integrations" element={<ProtectedRoute allowedRoles={["ADMIN", "SUPER_ADMIN", "DEVOPS"]}><DashboardLayout><IntegrationsPage /></DashboardLayout></ProtectedRoute>} />

      {/* DevOps sub-routes (§3.5) */}
      <Route path="/devops/pipelines" element={<ProtectedRoute allowedRoles={["DEVOPS", "ADMIN", "SUPER_ADMIN"]}><DashboardLayout><DevOpsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/devops/deployments" element={<ProtectedRoute allowedRoles={["DEVOPS", "ADMIN", "SUPER_ADMIN"]}><DashboardLayout><DevOpsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/devops/projects" element={<ProtectedRoute allowedRoles={["DEVOPS", "ADMIN", "SUPER_ADMIN"]}><DashboardLayout><DevOpsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/devops/users" element={<ProtectedRoute allowedRoles={["DEVOPS", "ADMIN", "SUPER_ADMIN"]}><DashboardLayout><DevOpsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/devops/incidents" element={<ProtectedRoute allowedRoles={["DEVOPS", "ADMIN", "SUPER_ADMIN"]}><DashboardLayout><DevOpsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/devops/runbooks" element={<ProtectedRoute allowedRoles={["DEVOPS", "ADMIN", "SUPER_ADMIN"]}><DashboardLayout><DevOpsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/devops/audit" element={<ProtectedRoute allowedRoles={["DEVOPS", "ADMIN", "SUPER_ADMIN"]}><DashboardLayout><DevOpsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/devops/insights" element={<ProtectedRoute allowedRoles={["DEVOPS", "ADMIN", "SUPER_ADMIN"]}><DashboardLayout><DevOpsPage /></DashboardLayout></ProtectedRoute>} />

      {/* Manager sub-routes (§3.5) */}
      <Route path="/manager/insights" element={<ProtectedRoute allowedRoles={["MANAGER", "ADMIN", "SUPER_ADMIN"]}><DashboardLayout><ManagerPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/manager/incidents" element={<ProtectedRoute allowedRoles={["MANAGER", "ADMIN", "SUPER_ADMIN"]}><DashboardLayout><ManagerPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/manager/runbooks" element={<ProtectedRoute allowedRoles={["MANAGER", "ADMIN", "SUPER_ADMIN"]}><DashboardLayout><ManagerPage /></DashboardLayout></ProtectedRoute>} />

      <Route path="/setup-2fa" element={<ProtectedRoute><DashboardLayout><Setup2FAPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/change-password" element={<ProtectedRoute><DashboardLayout><ChangePasswordPage /></DashboardLayout></ProtectedRoute>} />

      {/* SaaS routes — billing and team restricted to admins */}
      <Route path="/billing" element={<ProtectedRoute allowedRoles={["ADMIN", "SUPER_ADMIN"]}><DashboardLayout><BillingPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/team" element={<ProtectedRoute allowedRoles={["ADMIN", "SUPER_ADMIN", "MANAGER"]}><DashboardLayout><TeamPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/api-keys" element={<ProtectedRoute><DashboardLayout><ApiKeysPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><DashboardLayout><SettingsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/notifications" element={<ProtectedRoute><DashboardLayout><NotificationsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/audit-log" element={<ProtectedRoute allowedRoles={["ADMIN", "SUPER_ADMIN", "MANAGER"]}><DashboardLayout><AuditLogPage /></DashboardLayout></ProtectedRoute>} />

      {/* 404 catch-all */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
