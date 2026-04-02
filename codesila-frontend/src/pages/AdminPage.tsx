// src/pages/AdminPage.tsx
import { useEffect, useMemo, useState } from "react";
import { ShieldAlert, Settings, FileText, Github } from "lucide-react";
import { activateUser, createUser, listUsers, revokeUser, type AdminUser } from "../api/auth";
import { listAuditEvents, getInsights, listProjects, listDeployments, type AuditEvent, type InsightSnapshot, type ProjectSummary, type Deployment } from "../api/devflow";
import { getGitHubStatus, getGitHubConnectUrl, disconnectGitHub, type GitHubStatus } from "../api/integrations";

const AdminPage = () => {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userLoading, setUserLoading] = useState(false);
  const [userError, setUserError] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [auditLogs, setAuditLogs] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState("");
  const [insights, setInsights] = useState<InsightSnapshot | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [, setProjectsLoading] = useState(false);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [, setDeploymentsLoading] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", role: "DEVELOPER" });

  // GitHub integration
  const [githubStatus, setGithubStatus] = useState<GitHubStatus | null>(null);
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubError, setGithubError] = useState("");

  const sortedUsers = useMemo(() => [...users].sort((a, b) => a.email.localeCompare(b.email)), [users]);

  // Compute real role distribution
  const roleDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    users.forEach((u) => { counts[u.role] = (counts[u.role] || 0) + 1; });
    return counts;
  }, [users]);

  const refreshUsers = async () => {
    setUserError(""); setUserLoading(true);
    try { setUsers(await listUsers()); }
    catch (err: any) { setUserError(err.message || "Failed to load users"); }
    finally { setUserLoading(false); }
  };

  useEffect(() => { refreshUsers(); }, []);

  useEffect(() => {
    setAuditLoading(true);
    listAuditEvents({ limit: 20 }).then(setAuditLogs).catch((e: any) => setAuditError(e.message)).finally(() => setAuditLoading(false));
  }, []);

  useEffect(() => {
    setInsightsLoading(true);
    getInsights({ windowDays: 7 }).then(setInsights).catch(() => {}).finally(() => setInsightsLoading(false));
  }, []);

  useEffect(() => {
    setProjectsLoading(true);
    listProjects().then(setProjects).catch(() => {}).finally(() => setProjectsLoading(false));
  }, []);

  useEffect(() => {
    setDeploymentsLoading(true);
    listDeployments({ limit: 10 }).then(setDeployments).catch(() => {}).finally(() => setDeploymentsLoading(false));
  }, []);

  // Load GitHub status
  const refreshGithubStatus = () => {
    setGithubLoading(true);
    setGithubError("");
    getGitHubStatus()
      .then(setGithubStatus)
      .catch((e: any) => setGithubError(e.message))
      .finally(() => setGithubLoading(false));
  };
  useEffect(() => { refreshGithubStatus(); }, []);

  const handleConnectGitHub = async () => {
    try {
      const { url } = await getGitHubConnectUrl();
      window.location.href = url;
    } catch (e: any) {
      setGithubError(e.message || "Failed to get GitHub connect URL");
    }
  };

  const handleDisconnectGitHub = async () => {
    if (!confirm("Disconnect GitHub? All webhooks and linked repos will be removed.")) return;
    try {
      await disconnectGitHub();
      refreshGithubStatus();
    } catch (e: any) {
      setGithubError(e.message || "Failed to disconnect");
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault(); setFormError(""); setCreateLoading(true);
    try { await createUser({ email: form.email.trim(), password: form.password, role: form.role }); setForm({ email: "", password: "", role: form.role }); await refreshUsers(); }
    catch (err: any) { setFormError(err.message || "Failed to create user"); }
    finally { setCreateLoading(false); }
  };

  const handleRevoke = async (userId: string) => {
    setUserError("");
    try { await revokeUser(userId); await refreshUsers(); }
    catch (err: any) { setUserError(err.message || "Failed to revoke user"); }
  };

  const handleActivate = async (userId: string) => {
    setUserError("");
    try { await activateUser(userId); await refreshUsers(); }
    catch (err: any) { setUserError(err.message || "Failed to activate user"); }
  };

  const formatAuditLabel = (event: AuditEvent) => {
    const id = event.entityId ? `:${event.entityId}` : "";
    return `${event.action} ${event.entityType}${id}`.trim();
  };

  return (
    <div>
      <h2 className="text-2xl font-orbitron text-cyber-cyan mb-6">Admin Dashboard</h2>

      {/* GitHub Integration Status */}
      <div className="bg-gray-900/30 border border-purple-500/30 p-5 rounded-lg mb-8">
        <h2 className="text-purple-400 font-orbitron mb-3 flex items-center gap-2"><Github size={20} /> GitHub Integration</h2>
        {githubLoading && <div className="text-sm text-gray-400">Checking GitHub connection...</div>}
        {githubError && <div className="text-sm text-cyber-red mb-2">{githubError}</div>}
        {!githubLoading && githubStatus && !githubStatus.connected && (
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-400 mb-1">GitHub is not connected to your organization.</div>
              <div className="text-xs text-gray-500">Connect to import repos, track commits, and monitor CI builds.</div>
            </div>
            <button onClick={handleConnectGitHub} className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded transition flex items-center gap-2">
              <Github size={16} /> Connect GitHub
            </button>
          </div>
        )}
        {!githubLoading && githubStatus?.connected && githubStatus.installation && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {githubStatus.installation.avatarUrl && <img src={githubStatus.installation.avatarUrl} alt="" className="w-8 h-8 rounded-full" />}
              <div>
                <div className="font-medium text-cyber-green flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-400 inline-block"></span>
                  Connected to <span className="text-purple-300">{githubStatus.installation.githubLogin}</span>
                </div>
                <div className="text-xs text-gray-400">
                  {githubStatus.installation._count.repos} linked repo{githubStatus.installation._count.repos !== 1 ? "s" : ""}
                  {" \u2022 "}Connected by {githubStatus.installation.connectedBy?.email ?? "unknown"}
                </div>
              </div>
            </div>
            <button onClick={handleDisconnectGitHub} className="px-3 py-1 border border-red-500/40 text-red-400 text-sm rounded hover:bg-red-900/30 transition">
              Disconnect
            </button>
          </div>
        )}
      </div>

      {/* User Access Management */}
      <div className="bg-gray-900/30 border border-cyber-cyan/30 p-5 rounded-lg mb-8">
            <h2 className="text-cyber-cyan font-orbitron mb-4 flex items-center gap-2"><ShieldAlert size={20} /> Access Management</h2>
            <form onSubmit={handleCreateUser} className="grid grid-cols-1 md:grid-cols-[1.5fr_1fr_1fr_auto] gap-3 mb-4">
              <input type="email" value={form.email} onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))} placeholder="new.user@codesila.local" className="bg-gray-800 text-white p-2 rounded border border-cyber-cyan/30" required />
              <input type="password" value={form.password} onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))} placeholder="Temporary password" className="bg-gray-800 text-white p-2 rounded border border-cyber-cyan/30" required minLength={8} />
              <select value={form.role} onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value }))} className="bg-gray-800 text-white p-2 rounded border border-cyber-cyan/30">
                <option value="ADMIN">ADMIN</option><option value="MANAGER">MANAGER</option><option value="DEVOPS">DEVOPS</option><option value="DEVELOPER">DEVELOPER</option>
              </select>
              <button type="submit" disabled={createLoading} className="px-4 py-2 bg-cyber-green text-cyber-base font-bold rounded hover:opacity-90 disabled:opacity-50">{createLoading ? "Creating..." : "Add User"}</button>
            </form>
            {formError && <div className="text-sm text-cyber-red mb-3">{formError}</div>}
            {userError && <div className="text-sm text-cyber-red mb-3">{userError}</div>}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-cyber-cyan/20 text-left"><th className="py-2">Email</th><th className="py-2">Role</th><th className="py-2">Status</th><th className="py-2">2FA</th><th className="py-2">Created</th><th className="py-2">Action</th></tr></thead>
                <tbody>
                  {userLoading && <tr><td className="py-3 text-gray-400" colSpan={6}>Loading users...</td></tr>}
                  {!userLoading && sortedUsers.length === 0 && <tr><td className="py-3 text-gray-400" colSpan={6}>No users found.</td></tr>}
                  {sortedUsers.map((user) => (
                    <tr key={user.id} className="border-b border-gray-800/60">
                      <td className="py-2 text-cyber-cyan">{user.email}</td>
                      <td className="py-2">{user.role}</td>
                      <td className="py-2">{user.isActive ? <span className="text-green-400">Active</span> : <span className="text-red-400">Revoked</span>}</td>
                      <td className="py-2">{user.twoFactorEnabled ? "Enabled" : "Off"}</td>
                      <td className="py-2 text-gray-400">{new Date(user.createdAt).toLocaleDateString()}</td>
                      <td className="py-2">
                        {user.isActive
                          ? <button onClick={() => handleRevoke(user.id)} className="px-3 py-1 text-xs bg-cyber-red text-cyber-base rounded">Revoke</button>
                          : <button onClick={() => handleActivate(user.id)} className="px-3 py-1 text-xs bg-cyber-green text-cyber-base rounded">Activate</button>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            {/* Audit Trail */}
            <div className="lg:col-span-2 bg-gray-900/30 border border-cyber-red/30 p-5 rounded-lg">
              <h2 className="text-cyber-red font-orbitron mb-3 flex items-center gap-2"><ShieldAlert size={20} /> Audit Trail</h2>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-cyber-red/20"><th>User</th><th>Action</th><th>IP</th><th>Time</th></tr></thead>
                <tbody>
                  {auditLoading && <tr><td className="py-3 text-gray-400" colSpan={4}>Loading audit events...</td></tr>}
                  {!auditLoading && auditError && <tr><td className="py-3 text-cyber-red" colSpan={4}>{auditError}</td></tr>}
                  {!auditLoading && !auditError && auditLogs.length === 0 && <tr><td className="py-3 text-gray-400" colSpan={4}>No audit events found.</td></tr>}
                  {!auditLoading && !auditError && auditLogs.map((log) => (
                    <tr key={log.id} className="border-b border-gray-700/50">
                      <td>{log.actorId ?? "system"}</td>
                      <td>{formatAuditLabel(log)}</td>
                      <td className="text-cyber-cyan">{log.ipAddress ?? "-"}</td>
                      <td>{new Date(log.createdAt).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* System Overview (real data) */}
            <div className="bg-gray-900/30 border border-cyber-green/30 p-5 rounded-lg">
              <h2 className="text-cyber-green font-orbitron mb-3 flex items-center gap-2"><Settings size={20} /> System Overview</h2>
              {insightsLoading && <div className="text-sm text-gray-400">Loading...</div>}
              {!insightsLoading && insights && (
                <div className="space-y-3 text-sm">
                  <div>Total Users: <span className="text-cyber-green">{users.length}</span></div>
                  <div>Active Users: <span className="text-cyber-green">{users.filter(u => u.isActive).length}</span></div>
                  <div>Total Projects: <span className="text-cyber-cyan">{projects.length}</span></div>
                  <div>Recent Deployments: <span className="text-cyber-cyan">{deployments.length}</span></div>
                  <div>Open Incidents: <span className={insights.incidents.length > 0 ? "text-yellow-400" : "text-cyber-green"}>{insights.incidents.length}</span></div>
                  <div>Degraded Services: <span className={insights.degradedServices.length > 0 ? "text-cyber-red" : "text-cyber-green"}>{insights.degradedServices.length}</span></div>
                  <div>Mean Deploy Time: <span className="text-cyber-green">{insights.deploymentStats.meanDurationMinutes != null ? `${insights.deploymentStats.meanDurationMinutes.toFixed(1)} min` : "—"}</span></div>
                </div>
              )}
              {!insightsLoading && !insights && (
                <div className="space-y-3 text-sm">
                  <div>Total Users: <span className="text-cyber-green">{users.length}</span></div>
                  <div>Active Users: <span className="text-cyber-green">{users.filter(u => u.isActive).length}</span></div>
                  <div>Total Projects: <span className="text-cyber-cyan">{projects.length}</span></div>
                </div>
              )}
            </div>
          </div>

          {/* Role Distribution (real data from users) */}
          <div className="bg-gray-900/30 border border-cyber-cyan/30 p-5 rounded-lg">
            <h2 className="text-cyber-cyan font-orbitron mb-3 flex items-center gap-2"><FileText size={20} /> Role Distribution</h2>
            <div className="flex flex-wrap gap-4">
              {Object.entries(roleDistribution).map(([role, count]) => (
                <div key={role} className="bg-gray-800/50 p-4 rounded text-center min-w-[120px]">
                  <div className="font-orbitron text-cyber-cyan">{role}</div>
                  <div className="text-2xl font-bold mt-2">{count}</div>
                  <div className="text-xs text-gray-400 mt-1">{count === 1 ? "user" : "users"}</div>
                </div>
              ))}
              {Object.keys(roleDistribution).length === 0 && !userLoading && (
                <div className="text-sm text-gray-400">No role data available.</div>
              )}
            </div>
          </div>
    </div>
  );
};

export default AdminPage;
