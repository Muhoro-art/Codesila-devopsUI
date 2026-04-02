// src/pages/ProjectDetailPage.tsx
import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Users, GitBranch, GitCommitHorizontal, Package, Activity, Shield,
  Settings, UserPlus, UserMinus, Pencil, Save, X,
  MessageSquare, Cpu, FileText, Play, Terminal,
  Link2, Cloud, Plus, Trash2, ExternalLink, RefreshCw
} from "lucide-react";
import {
  getProject, updateProject, archiveProject,
  listProjectMembers, addProjectMembers, removeProjectMember,
  changeMemberRole,
  type Project, type ProjectMember, type ProjectType,
} from "../api/projects";
import {
  listDeployments, listServices, listIncidents, listRunbooks,
  listAuditEvents, createDeployment,
  type Deployment, type Service, type Incident, type Runbook, type AuditEvent,
} from "../api/devflow";
import { listUsers, type AdminUser } from "../api/auth";
import { listPipelines, type Pipeline } from "../api/cicd";
import { useAuth } from "../contexts/AuthContext";
import {
  getDeploymentTargets, createDeploymentTarget, deleteDeploymentTarget,
  type DeploymentTarget,
} from "../api/integrations";
import {
  listProjectIntegrations, listAvailableIntegrations, bindProjectIntegration, unbindProjectIntegration,
  listIntegrationRepos, listBranches, createRepoViaIntegration, listCommits,
  type ProjectIntegrationBinding, type IntegrationInfo as PlatformIntegration,
  type IntegrationRepo, type BranchInfo, type CommitInfo,
} from "../api/integrationMgmt";

const PROJECT_TYPES: { value: ProjectType; label: string; icon: string }[] = [
  { value: "API", label: "API / Backend", icon: "🔌" },
  { value: "WEB", label: "Web App", icon: "🌐" },
  { value: "MOBILE", label: "Mobile App", icon: "📱" },
  { value: "FULLSTACK", label: "Full-Stack", icon: "🏗️" },
  { value: "DATA", label: "Data Pipeline", icon: "📊" },
  { value: "INFRA", label: "Infrastructure", icon: "☁️" },
  { value: "LIBRARY", label: "Library / SDK", icon: "📦" },
  { value: "OTHER", label: "Other", icon: "🔧" },
];

function typeLabel(t?: string) {
  return PROJECT_TYPES.find((pt) => pt.value === t)?.label ?? t ?? "Unknown";
}
function typeIcon(t?: string) {
  return PROJECT_TYPES.find((pt) => pt.value === t)?.icon ?? "📁";
}

const ProjectDetailPage = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { user: ctxUser } = useAuth();

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("overview");

  // Team
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [orgUsers, setOrgUsers] = useState<AdminUser[]>([]);
  const [addUserIds, setAddUserIds] = useState<string[]>([]);
  const [addRole, setAddRole] = useState("MEMBER");
  const [addLoading, setAddLoading] = useState(false);

  // Services
  const [services, setServices] = useState<Service[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);

  // Deployments
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [deploymentsLoading, setDeploymentsLoading] = useState(false);
  const [deployServiceId, setDeployServiceId] = useState("");
  const [deployVersion, setDeployVersion] = useState("");
  const [deployEnv, setDeployEnv] = useState("DEV");
  const [deployLoading, setDeployLoading] = useState(false);

  // Incidents
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [incidentsLoading, setIncidentsLoading] = useState(false);

  // Runbooks
  const [runbooks, setRunbooks] = useState<Runbook[]>([]);
  const [runbooksLoading, setRunbooksLoading] = useState(false);

  // Audit
  const [auditLogs, setAuditLogs] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  // Pipelines
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [pipelinesLoading, setPipelinesLoading] = useState(false);
  const [pipelinesError, setPipelinesError] = useState("");

  // Settings (edit mode)
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", description: "", type: "" as string, gitRepositoryUrl: "", defaultBranch: "" });
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState("");

  // Integrations
  const [deployTargets, setDeployTargets] = useState<DeploymentTarget[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [showAddTarget, setShowAddTarget] = useState(false);
  const [newTarget, setNewTarget] = useState({ name: "", environment: "DEV", provider: "DOCKER", url: "", region: "" });

  // Platform Integrations (Level 2 — project ↔ integration bindings)
  const [projectBindings, setProjectBindings] = useState<ProjectIntegrationBinding[]>([]);
  const [availablePlatform, setAvailablePlatform] = useState<PlatformIntegration[]>([]);
  const [bindingsLoading, setBindingsLoading] = useState(false);
  const [showBindModal, setShowBindModal] = useState(false);
  const [bindConfig, setBindConfig] = useState<Record<string, string>>({});
  const [selectedBindId, setSelectedBindId] = useState<string | null>(null);
  const [bindLoading, setBindLoading] = useState(false);
  // 2-mode bind: "connect" existing or "create" new repo
  const [bindMode, setBindMode] = useState<"connect" | "create">("connect");
  const [providerRepos, setProviderRepos] = useState<IntegrationRepo[]>([]);
  const [providerBranches, setProviderBranches] = useState<BranchInfo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [repoSearch, setRepoSearch] = useState("");
  const [newRepoForm, setNewRepoForm] = useState({ name: "", description: "", isPrivate: true, autoInit: true });

  // Commits per binding
  const [bindingCommits, setBindingCommits] = useState<Record<string, CommitInfo[]>>({});
  const [commitsLoading, setCommitsLoading] = useState<Record<string, boolean>>({});
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());

  /* ─── Load project ─────────────────────────────────────── */
  const loadProject = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const p = await getProject(projectId);
      setProject(p);
      setEditForm({
        name: p.name,
        description: p.description ?? "",
        type: p.type ?? "API",
        gitRepositoryUrl: p.gitRepositoryUrl ?? "",
        defaultBranch: p.defaultBranch ?? "main",
      });
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { loadProject(); }, [loadProject]);

  /* ─── Load tab data ────────────────────────────────────── */
  useEffect(() => {
    if (!projectId) return;

    if (activeTab === "team" || activeTab === "overview") {
      setMembersLoading(true);
      listProjectMembers(projectId).then(setMembers).catch(() => {}).finally(() => setMembersLoading(false));
      listUsers().then(setOrgUsers).catch(() => {});
    }
    if (activeTab === "services" || activeTab === "overview" || activeTab === "deployments") {
      setServicesLoading(true);
      listServices(projectId).then((s) => {
        setServices(s);
        if (s.length > 0 && !deployServiceId) setDeployServiceId(s[0].id);
      }).catch(() => {}).finally(() => setServicesLoading(false));
    }
    if (activeTab === "deployments" || activeTab === "overview") {
      setDeploymentsLoading(true);
      listDeployments({ projectId }).then(setDeployments).catch(() => {}).finally(() => setDeploymentsLoading(false));
    }
    if (activeTab === "incidents" || activeTab === "overview") {
      setIncidentsLoading(true);
      listIncidents({ projectId }).then(setIncidents).catch(() => {}).finally(() => setIncidentsLoading(false));
    }
    if (activeTab === "runbooks") {
      setRunbooksLoading(true);
      listRunbooks({ projectId }).then(setRunbooks).catch(() => {}).finally(() => setRunbooksLoading(false));
    }
    if (activeTab === "audit") {
      setAuditLoading(true);
      listAuditEvents({ projectId, limit: 50 }).then(setAuditLogs).catch(() => {}).finally(() => setAuditLoading(false));
    }
    if (activeTab === "pipelines") {
      setPipelinesLoading(true);
      setPipelinesError("");
      listPipelines(projectId).then(setPipelines).catch((e) => setPipelinesError(e.message || "Failed to load pipelines")).finally(() => setPipelinesLoading(false));
    }
    if (activeTab === "integrations" || activeTab === "overview") {
      // Load deployment targets
      setTargetsLoading(true);
      getDeploymentTargets(projectId).then(setDeployTargets).catch(() => {}).finally(() => setTargetsLoading(false));
      // Load project ↔ platform integration bindings
      setBindingsLoading(true);
      listProjectIntegrations(projectId).then(setProjectBindings).catch(() => {}).finally(() => setBindingsLoading(false));
    }
  }, [projectId, activeTab]);

  /* ─── Handlers ─────────────────────────────────────────── */
  const handleAddMembers = async () => {
    if (!projectId || addUserIds.length === 0) return;
    setAddLoading(true);
    try {
      const updated = await addProjectMembers(projectId, { userIds: addUserIds, role: addRole });
      setMembers(updated);
      setAddUserIds([]);
      loadProject();
    } catch { /* */ }
    finally { setAddLoading(false); }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!projectId) return;
    try {
      await removeProjectMember(projectId, userId);
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
      loadProject();
    } catch { /* */ }
  };

  const handleChangeRole = async (userId: string, newRole: string) => {
    if (!projectId) return;
    try {
      await changeMemberRole(projectId, userId, newRole);
      setMembers((prev) => prev.map((m) => m.userId === userId ? { ...m, projectRole: newRole } : m));
    } catch { /* */ }
  };

  const handleSaveSettings = async () => {
    if (!projectId) return;
    setEditLoading(true);
    setEditError("");
    try {
      const p = await updateProject(projectId, {
        name: editForm.name || undefined,
        description: editForm.description,
        type: editForm.type as ProjectType || undefined,
        gitRepositoryUrl: editForm.gitRepositoryUrl,
        defaultBranch: editForm.defaultBranch || undefined,
      });
      setProject(p);
      setEditing(false);
    } catch (e: any) { setEditError(e.message); }
    finally { setEditLoading(false); }
  };

  const handleArchive = async () => {
    if (!projectId || !confirm("Archive this project? It will be hidden from active lists.")) return;
    try {
      await archiveProject(projectId);
      navigate(-1);
    } catch { /* */ }
  };

  const handleDeploy = async () => {
    if (!projectId || !deployServiceId || !deployVersion.trim()) return;
    setDeployLoading(true);
    try {
      await createDeployment({ projectId, serviceId: deployServiceId, environment: deployEnv, version: deployVersion.trim() });
      setDeployVersion("");
      const deps = await listDeployments({ projectId });
      setDeployments(deps);
    } catch { /* */ }
    finally { setDeployLoading(false); }
  };

  const handleAddTarget = async () => {
    if (!projectId || !newTarget.name.trim()) return;
    try {
      const t = await createDeploymentTarget({
        projectId,
        environment: newTarget.environment,
        provider: newTarget.provider,
        name: newTarget.name.trim(),
        url: newTarget.url || undefined,
        region: newTarget.region || undefined,
      });
      setDeployTargets((prev) => [t, ...prev]);
      setShowAddTarget(false);
      setNewTarget({ name: "", environment: "DEV", provider: "DOCKER", url: "", region: "" });
    } catch { /* */ }
  };

  const handleDeleteTarget = async (targetId: string) => {
    if (!confirm("Delete this deployment target?")) return;
    try {
      await deleteDeploymentTarget(targetId);
      setDeployTargets((prev) => prev.filter((t) => t.id !== targetId));
    } catch { /* */ }
  };

  /* ─── Platform Integration Handlers ────────────────────── */

  const handleOpenBindModal = async () => {
    if (!projectId) return;
    setShowBindModal(true);
    setBindMode("connect");
    setProviderRepos([]);
    setProviderBranches([]);
    setRepoSearch("");
    setBindConfig({});
    setSelectedBindId(null);
    setNewRepoForm({ name: "", description: "", isPrivate: true, autoInit: true });
    try {
      const avail = await listAvailableIntegrations(projectId);
      setAvailablePlatform(avail);
    } catch { setAvailablePlatform([]); }
  };

  const handleSelectIntegration = async (integId: string) => {
    setSelectedBindId(selectedBindId === integId ? null : integId);
    setBindConfig({});
    setProviderRepos([]);
    setProviderBranches([]);
    setRepoSearch("");
    setBindMode("connect");
    if (selectedBindId !== integId) {
      const integ = availablePlatform.find((i) => i.id === integId);
      if (integ && (integ.type === "github" || integ.type === "gitlab")) {
        setReposLoading(true);
        try {
          const repos = await listIntegrationRepos(integId);
          setProviderRepos(repos);
        } catch { setProviderRepos([]); }
        finally { setReposLoading(false); }
      }
    }
  };

  const handleSelectRepo = async (integId: string, repo: IntegrationRepo) => {
    setBindConfig((p) => ({ ...p, repo: repo.fullName, branch: repo.defaultBranch }));
    setBranchesLoading(true);
    try {
      const [owner, repoName] = repo.fullName.split("/");
      const branches = await listBranches(integId, owner, repoName);
      setProviderBranches(branches);
    } catch { setProviderBranches([]); }
    finally { setBranchesLoading(false); }
  };

  const handleBindIntegration = async (integrationId: string) => {
    if (!projectId) return;
    setBindLoading(true);
    try {
      const config: Record<string, unknown> = {};
      if (bindConfig.repo) config.repo = bindConfig.repo;
      if (bindConfig.branch) config.branch = bindConfig.branch;
      if (bindConfig.namespace) config.namespace = bindConfig.namespace;
      if (bindConfig.environment) config.environment = bindConfig.environment;
      const binding = await bindProjectIntegration(projectId, integrationId, Object.keys(config).length ? config : undefined);
      setProjectBindings((prev) => [binding, ...prev]);
      setAvailablePlatform((prev) => prev.filter((i) => i.id !== integrationId));
      setBindConfig({});
      setSelectedBindId(null);
      setShowBindModal(false);
    } catch { /* */ }
    finally { setBindLoading(false); }
  };

  const handleCreateAndBind = async (integrationId: string) => {
    if (!projectId || !newRepoForm.name.trim()) return;
    setBindLoading(true);
    try {
      const repo = await createRepoViaIntegration(integrationId, {
        name: newRepoForm.name.trim(),
        description: newRepoForm.description || undefined,
        isPrivate: newRepoForm.isPrivate,
        autoInit: newRepoForm.autoInit,
      });
      // Auto-bind the newly created repo to this project
      const config: Record<string, unknown> = {
        repo: repo.fullName,
        branch: repo.defaultBranch,
      };
      if (bindConfig.environment) config.environment = bindConfig.environment;
      const binding = await bindProjectIntegration(projectId, integrationId, config);
      setProjectBindings((prev) => [binding, ...prev]);
      setAvailablePlatform((prev) => prev.filter((i) => i.id !== integrationId));
      setSelectedBindId(null);
      setShowBindModal(false);
      setNewRepoForm({ name: "", description: "", isPrivate: true, autoInit: true });
    } catch { /* */ }
    finally { setBindLoading(false); }
  };

  const handleUnbindIntegration = async (bindingId: string) => {
    if (!projectId || !confirm("Remove this integration from the project?")) return;
    try {
      await unbindProjectIntegration(projectId, bindingId);
      setProjectBindings((prev) => prev.filter((b) => b.id !== bindingId));
    } catch { /* */ }
  };

  const handleToggleCommits = async (binding: ProjectIntegrationBinding) => {
    const id = binding.id;
    if (expandedCommits.has(id)) {
      setExpandedCommits((prev) => { const n = new Set(prev); n.delete(id); return n; });
      return;
    }
    setExpandedCommits((prev) => new Set(prev).add(id));
    await loadBindingCommits(binding);
  };

  const loadBindingCommits = async (binding: ProjectIntegrationBinding) => {
    const cfg = binding.configJson as Record<string, string> | null;
    const repoFullName = cfg?.repo;
    if (!repoFullName) return;
    const [owner, repo] = repoFullName.split("/");
    if (!owner || !repo) return;

    setCommitsLoading((prev) => ({ ...prev, [binding.id]: true }));
    try {
      const commits = await listCommits(binding.integrationId, owner, repo, { branch: cfg?.branch, limit: 15 });
      setBindingCommits((prev) => ({ ...prev, [binding.id]: commits }));
    } catch {
      setBindingCommits((prev) => ({ ...prev, [binding.id]: [] }));
    } finally {
      setCommitsLoading((prev) => ({ ...prev, [binding.id]: false }));
    }
  };

  /* ─── Computed ──────────────────────────────────────────── */
  const memberUserIds = new Set(members.map((m) => m.userId));
  const availableUsers = orgUsers.filter((u) => !memberUserIds.has(u.id) && u.isActive);
  const isOwner = project?.ownerId === ctxUser?.id;
  const canManage = isOwner || ctxUser?.role === "ADMIN" || ctxUser?.role === "SUPER_ADMIN" || ctxUser?.role === "MANAGER" || ctxUser?.role === "DEVOPS";

  const tabs = [
    { key: "overview", label: "Overview", icon: <Package size={16} /> },
    { key: "team", label: "Team", icon: <Users size={16} /> },
    { key: "services", label: "Services", icon: <Cpu size={16} /> },
    { key: "deployments", label: "Deployments", icon: <Play size={16} /> },
    { key: "incidents", label: "Incidents", icon: <Shield size={16} /> },
    { key: "runbooks", label: "Runbooks", icon: <FileText size={16} /> },
    { key: "audit", label: "Audit", icon: <Activity size={16} /> },
    { key: "integrations", label: "Integrations", icon: <Link2 size={16} /> },
    { key: "pipelines", label: "Pipelines", icon: <Terminal size={16} /> },
    { key: "settings", label: "Settings", icon: <Settings size={16} /> },
  ];

  /* ─── Loading / Error ──────────────────────────────────── */
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-cyber-cyan animate-pulse font-orbitron">Loading project...</div>
      </div>
    );
  }
  if (error || !project) {
    return (
      <div className="flex items-center justify-center flex-col gap-4 py-20">
        <div className="text-cyber-red font-orbitron">{error || "Project not found"}</div>
        <button onClick={() => navigate(-1)} className="text-cyber-cyan hover:underline flex items-center gap-2"><ArrowLeft size={16}/> Go back</button>
      </div>
    );
  }

  /* ─── Render ───────────────────────────────────────────── */
  return (
    <div>
      {/* Header */}
      <header className="flex justify-between items-start mb-6">
        <div>
          <button onClick={() => navigate(-1)} className="text-cyber-cyan hover:underline flex items-center gap-1 text-sm mb-2"><ArrowLeft size={14}/> Back</button>
          <div className="flex items-center gap-3">
            <span className="text-3xl">{typeIcon(project.type)}</span>
            <div>
              <h1 className="text-2xl font-bold font-orbitron text-cyber-cyan">{project.name}</h1>
              <p className="text-sm text-gray-400">{project.key} &bull; {typeLabel(project.type)} &bull; {project.status}</p>
            </div>
          </div>
          {project.description && <p className="text-sm text-gray-400 mt-2 max-w-xl">{project.description}</p>}
        </div>
        <div className="flex items-center gap-3 text-sm">
          {project.chatRoom && (
            <div className="flex items-center gap-1 text-cyber-magenta"><MessageSquare size={14}/> Project Chat Active</div>
          )}
          {project.gitRepositoryUrl && (
            <a href={project.gitRepositoryUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-cyber-cyan hover:underline"><GitBranch size={14}/> {project.defaultBranch ?? "main"}</a>
          )}
        </div>
      </header>

      {/* Quick Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <div className="bg-gray-900/40 border border-cyber-cyan/20 p-3 rounded text-center">
          <div className="text-xl font-bold text-cyber-cyan">{project._count?.services ?? services.length}</div>
          <div className="text-xs text-gray-400">Services</div>
        </div>
        <div className="bg-gray-900/40 border border-cyber-green/20 p-3 rounded text-center">
          <div className="text-xl font-bold text-cyber-green">{project._count?.deployments ?? deployments.length}</div>
          <div className="text-xs text-gray-400">Deployments</div>
        </div>
        <div className="bg-gray-900/40 border border-yellow-500/20 p-3 rounded text-center">
          <div className="text-xl font-bold text-yellow-400">{project._count?.incidents ?? incidents.length}</div>
          <div className="text-xs text-gray-400">Incidents</div>
        </div>
        <div className="bg-gray-900/40 border border-cyber-magenta/20 p-3 rounded text-center">
          <div className="text-xl font-bold text-cyber-magenta">{project.memberships?.length ?? members.length}</div>
          <div className="text-xs text-gray-400">Team</div>
        </div>
        <div className="bg-gray-900/40 border border-purple-500/20 p-3 rounded text-center">
          <div className="text-xl font-bold text-purple-400">{project.environments?.length ?? 3}</div>
          <div className="text-xs text-gray-400">Environments</div>
        </div>
      </div>

      <div>
        <div>
          {/* Tabs */}
          <div className="flex gap-1 mb-6 border-b border-cyber-cyan/20 pb-2 flex-wrap">
            {tabs.map((tab) => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`px-3 py-2 rounded-t-lg text-sm flex items-center gap-1.5 ${activeTab === tab.key ? "bg-cyber-cyan text-cyber-base font-bold" : "text-cyber-cyan hover:bg-cyber-cyan/10"}`}>
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>

          {/* ═══ OVERVIEW TAB ═══ */}
          {activeTab === "overview" && (
            <div className="space-y-6">
              {/* Team Preview */}
              <div className="bg-gray-900/30 border border-cyber-magenta/30 p-5 rounded-lg">
                <h2 className="text-cyber-magenta font-orbitron mb-3 flex items-center gap-2"><Users size={18}/> Team ({members.length})</h2>
                {membersLoading ? <div className="text-sm text-gray-400">Loading...</div> : (
                  <div className="flex flex-wrap gap-3">
                    {members.map((m) => (
                      <div key={m.userId} className="flex items-center gap-2 bg-gray-800/50 px-3 py-2 rounded">
                        <div className="w-8 h-8 rounded-full bg-cyber-cyan/20 flex items-center justify-center text-xs font-bold text-cyber-cyan">
                          {(m.name || m.email)[0].toUpperCase()}
                        </div>
                        <div>
                          <div className="text-sm font-medium">{m.name}</div>
                          <div className="text-xs text-gray-400">{m.projectRole} &bull; {m.systemRole}</div>
                        </div>
                      </div>
                    ))}
                    {members.length === 0 && <div className="text-sm text-gray-400">No team members assigned.</div>}
                  </div>
                )}
              </div>

              {/* Services + Recent Deployments side by side */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-gray-900/30 border border-cyber-cyan/30 p-5 rounded-lg">
                  <h2 className="text-cyber-cyan font-orbitron mb-3 flex items-center gap-2"><Cpu size={18}/> Services ({services.length})</h2>
                  {servicesLoading ? <div className="text-sm text-gray-400">Loading...</div> : (
                    <div className="space-y-2">
                      {services.map((s) => (
                        <div key={s.id} className="flex justify-between items-center p-2 bg-gray-800/50 rounded">
                          <div><div className="font-medium">{s.name}</div><div className="text-xs text-gray-400">{s.key} &bull; {s.tier}</div></div>
                        </div>
                      ))}
                      {services.length === 0 && <div className="text-sm text-gray-400">No services.</div>}
                    </div>
                  )}
                </div>
                <div className="bg-gray-900/30 border border-cyber-green/30 p-5 rounded-lg">
                  <h2 className="text-cyber-green font-orbitron mb-3 flex items-center gap-2"><Activity size={18}/> Recent Deployments</h2>
                  {deploymentsLoading ? <div className="text-sm text-gray-400">Loading...</div> : (
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {deployments.slice(0, 8).map((dep) => (
                        <div key={dep.id} className="flex justify-between items-center p-2 bg-gray-800/50 rounded">
                          <div><div className="font-medium text-sm">{dep.version}</div><div className="text-xs text-gray-400">{dep.environment} &bull; {new Date(dep.startedAt).toLocaleDateString()}</div></div>
                          <span className={`px-2 py-1 rounded text-xs font-bold ${dep.status === "SUCCESS" ? "bg-green-900/50 text-green-400" : dep.status === "FAILED" ? "bg-red-900/50 text-red-400" : "bg-blue-900/50 text-blue-400"}`}>{dep.status}</span>
                        </div>
                      ))}
                      {deployments.length === 0 && <div className="text-sm text-gray-400">No deployments yet.</div>}
                    </div>
                  )}
                </div>
              </div>

              {/* Open Incidents */}
              {incidents.filter((i) => i.status !== "RESOLVED").length > 0 && (
                <div className="bg-gray-900/30 border border-cyber-red/30 p-5 rounded-lg">
                  <h2 className="text-cyber-red font-orbitron mb-3 flex items-center gap-2"><Shield size={18}/> Open Incidents</h2>
                  <div className="space-y-2">
                    {incidents.filter((i) => i.status !== "RESOLVED").slice(0, 5).map((inc) => (
                      <div key={inc.id} className="flex justify-between items-center p-2 bg-gray-800/50 rounded">
                        <div><div className="font-medium text-sm">{inc.summary}</div><div className="text-xs text-gray-400">{inc.status} &bull; {new Date(inc.startedAt).toLocaleDateString()}</div></div>
                        <span className={`px-2 py-1 rounded text-xs font-bold ${inc.severity === "SEV1" ? "bg-red-900/50 text-red-400" : inc.severity === "SEV2" ? "bg-orange-900/50 text-orange-400" : "bg-yellow-900/50 text-yellow-400"}`}>{inc.severity}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══ TEAM TAB ═══ */}
          {activeTab === "team" && (
            <div className="space-y-6">
              {/* Add Members */}
              {canManage && (
                <div className="bg-gray-900/30 border border-cyber-green/30 p-5 rounded-lg">
                  <h2 className="text-cyber-green font-orbitron mb-3 flex items-center gap-2"><UserPlus size={18}/> Add Team Members</h2>
                  <div className="flex flex-wrap gap-3 mb-3">
                    {availableUsers.map((u) => (
                      <label key={u.id} className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer border ${addUserIds.includes(u.id) ? "border-cyber-green bg-cyber-green/10" : "border-gray-700 bg-gray-800/50 hover:border-gray-500"}`}>
                        <input type="checkbox" checked={addUserIds.includes(u.id)} onChange={(e) => {
                          if (e.target.checked) setAddUserIds((p) => [...p, u.id]);
                          else setAddUserIds((p) => p.filter((x) => x !== u.id));
                        }} className="hidden" />
                        <div className="w-6 h-6 rounded-full bg-cyber-cyan/20 flex items-center justify-center text-xs font-bold text-cyber-cyan">
                          {(u.email)[0].toUpperCase()}
                        </div>
                        <div>
                          <div className="text-sm">{u.email}</div>
                          <div className="text-xs text-gray-400">{u.role}</div>
                        </div>
                      </label>
                    ))}
                    {availableUsers.length === 0 && <div className="text-sm text-gray-400">All org users are already on this team.</div>}
                  </div>
                  {addUserIds.length > 0 && (
                    <div className="flex items-center gap-3">
                      <select value={addRole} onChange={(e) => setAddRole(e.target.value)} className="bg-gray-800 text-white p-2 rounded border border-gray-600">
                        <option value="MEMBER">Member</option>
                        <option value="ADMIN">Admin</option>
                        <option value="VIEWER">Viewer</option>
                      </select>
                      <button onClick={handleAddMembers} disabled={addLoading} className="px-4 py-2 bg-cyber-green text-cyber-base font-bold rounded disabled:opacity-50">
                        {addLoading ? "Adding..." : `Add ${addUserIds.length} member${addUserIds.length > 1 ? "s" : ""}`}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Members List */}
              <div className="bg-gray-900/30 border border-cyber-magenta/30 p-5 rounded-lg">
                <h2 className="text-cyber-magenta font-orbitron mb-3 flex items-center gap-2"><Users size={18}/> Team Members ({members.length})</h2>
                {membersLoading ? <div className="text-sm text-gray-400">Loading...</div> : (
                  <div className="space-y-3">
                    {members.map((m) => (
                      <div key={m.userId} className="flex justify-between items-center p-3 bg-gray-800/50 rounded">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-cyber-cyan/20 flex items-center justify-center text-sm font-bold text-cyber-cyan">
                            {(m.name || m.email)[0].toUpperCase()}
                          </div>
                          <div>
                            <div className="font-medium">{m.name}</div>
                            <div className="text-xs text-gray-400">{m.email}</div>
                            <div className="text-xs text-gray-500">System: {m.systemRole} &bull; Joined: {new Date(m.joinedAt).toLocaleDateString()}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {canManage ? (
                            <select value={m.projectRole} onChange={(e) => handleChangeRole(m.userId, e.target.value)}
                              className="bg-gray-800 text-white p-1 rounded text-xs border border-gray-600">
                              <option value="ADMIN">Admin</option>
                              <option value="MEMBER">Member</option>
                              <option value="VIEWER">Viewer</option>
                            </select>
                          ) : (
                            <span className={`px-2 py-1 rounded text-xs ${m.projectRole === "ADMIN" ? "bg-purple-900/50 text-purple-300" : m.projectRole === "VIEWER" ? "bg-gray-700 text-gray-400" : "bg-cyan-900/50 text-cyan-300"}`}>{m.projectRole}</span>
                          )}
                          {canManage && m.userId !== project.ownerId && (
                            <button onClick={() => handleRemoveMember(m.userId)} className="text-red-400 hover:text-red-300 p-1" title="Remove from project"><UserMinus size={16}/></button>
                          )}
                          {m.userId === project.ownerId && (
                            <span className="text-xs text-yellow-400 font-bold ml-1">Owner</span>
                          )}
                        </div>
                      </div>
                    ))}
                    {members.length === 0 && <div className="text-sm text-gray-400">No team members.</div>}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══ SERVICES TAB ═══ */}
          {activeTab === "services" && (
            <div className="bg-gray-900/30 border border-cyber-cyan/30 p-5 rounded-lg">
              <h2 className="text-cyber-cyan font-orbitron mb-3 flex items-center gap-2"><Cpu size={18}/> Services</h2>
              {servicesLoading ? <div className="text-sm text-gray-400">Loading...</div> : (
                <div className="space-y-3">
                  {services.map((s) => (
                    <div key={s.id} className="p-4 bg-gray-800/50 rounded">
                      <div className="flex justify-between items-center mb-1">
                        <div className="font-medium text-cyber-cyan">{s.name}</div>
                        <span className={`px-2 py-1 rounded text-xs ${s.tier === "TIER_1" ? "bg-red-900/50 text-red-400" : s.tier === "TIER_2" ? "bg-yellow-900/50 text-yellow-400" : "bg-gray-700 text-gray-400"}`}>{s.tier}</span>
                      </div>
                      <div className="text-xs text-gray-400">{s.key}</div>
                      {s.description && <div className="text-sm text-gray-400 mt-2">{s.description}</div>}
                    </div>
                  ))}
                  {services.length === 0 && <div className="text-sm text-gray-400">No services.</div>}
                </div>
              )}
            </div>
          )}

          {/* ═══ DEPLOYMENTS TAB ═══ */}
          {activeTab === "deployments" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Deploy Runner */}
              {canManage && (
                <div className="bg-gray-900/30 border border-cyber-green/30 p-5 rounded-lg">
                  <h2 className="text-cyber-green font-orbitron mb-3 flex items-center gap-2"><Play size={18}/> Deploy</h2>
                  <div className="space-y-3">
                    <select value={deployServiceId} onChange={(e) => setDeployServiceId(e.target.value)} className="w-full bg-gray-800 text-white p-2 rounded border border-gray-600">
                      <option value="">Select service</option>
                      {services.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.key})</option>)}
                    </select>
                    <select value={deployEnv} onChange={(e) => setDeployEnv(e.target.value)} className="w-full bg-gray-800 text-white p-2 rounded border border-gray-600">
                      <option value="DEV">Development</option>
                      <option value="STAGING">Staging</option>
                      <option value="PROD">Production</option>
                    </select>
                    <input type="text" value={deployVersion} onChange={(e) => setDeployVersion(e.target.value)} placeholder="Version (e.g. v1.2.3)" className="w-full bg-gray-800 text-white p-2 rounded border border-gray-600" />
                    <button onClick={handleDeploy} disabled={deployLoading || !deployServiceId || !deployVersion.trim()} className="w-full py-2 bg-cyber-green text-cyber-base font-bold rounded disabled:opacity-50">
                      {deployLoading ? "Deploying..." : "Deploy"}
                    </button>
                  </div>
                </div>
              )}

              {/* Deployment History */}
              <div className={`bg-gray-900/30 border border-cyber-cyan/30 p-5 rounded-lg ${!canManage ? "lg:col-span-2" : ""}`}>
                <h2 className="text-cyber-cyan font-orbitron mb-3 flex items-center gap-2"><Activity size={18}/> Deployment History</h2>
                {deploymentsLoading ? <div className="text-sm text-gray-400">Loading...</div> : (
                  <div className="space-y-2 max-h-[500px] overflow-y-auto">
                    {deployments.map((dep) => (
                      <div key={dep.id} className="flex justify-between items-center p-3 bg-gray-800/50 rounded">
                        <div>
                          <div className="font-medium">{dep.version}</div>
                          <div className="text-xs text-gray-400">{dep.environment} &bull; {new Date(dep.startedAt).toLocaleString()}</div>
                        </div>
                        <span className={`px-2 py-1 rounded text-xs font-bold ${dep.status === "SUCCESS" ? "bg-green-900/50 text-green-400" : dep.status === "FAILED" ? "bg-red-900/50 text-red-400" : "bg-blue-900/50 text-blue-400"}`}>{dep.status}</span>
                      </div>
                    ))}
                    {deployments.length === 0 && <div className="text-sm text-gray-400">No deployments yet.</div>}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══ INCIDENTS TAB ═══ */}
          {activeTab === "incidents" && (
            <div className="bg-gray-900/30 border border-cyber-red/30 p-5 rounded-lg">
              <h2 className="text-cyber-red font-orbitron mb-3 flex items-center gap-2"><Shield size={18}/> Incidents</h2>
              {incidentsLoading ? <div className="text-sm text-gray-400">Loading...</div> : (
                <div className="space-y-3">
                  {incidents.map((inc) => (
                    <div key={inc.id} className="p-3 bg-gray-800/50 rounded">
                      <div className="flex justify-between items-center mb-1">
                        <div className="font-medium">{inc.summary}</div>
                        <div className="flex gap-2">
                          <span className={`px-2 py-1 rounded text-xs ${inc.severity === "SEV1" ? "bg-red-900/50 text-red-400" : inc.severity === "SEV2" ? "bg-orange-900/50 text-orange-400" : "bg-yellow-900/50 text-yellow-400"}`}>{inc.severity}</span>
                          <span className={`px-2 py-1 rounded text-xs ${inc.status === "RESOLVED" ? "bg-green-900/50 text-green-400" : inc.status === "MITIGATED" ? "bg-yellow-900/50 text-yellow-400" : "bg-red-900/50 text-red-400"}`}>{inc.status}</span>
                        </div>
                      </div>
                      {inc.description && <div className="text-xs text-gray-400 mt-1">{inc.description}</div>}
                      <div className="text-xs text-gray-500 mt-1">{new Date(inc.startedAt).toLocaleString()}</div>
                    </div>
                  ))}
                  {incidents.length === 0 && <div className="text-sm text-gray-400">No incidents.</div>}
                </div>
              )}
            </div>
          )}

          {/* ═══ RUNBOOKS TAB ═══ */}
          {activeTab === "runbooks" && (
            <div className="bg-gray-900/30 border border-blue-500/30 p-5 rounded-lg">
              <h2 className="text-blue-400 font-orbitron mb-3 flex items-center gap-2"><FileText size={18}/> Runbooks</h2>
              {runbooksLoading ? <div className="text-sm text-gray-400">Loading...</div> : (
                <div className="space-y-3">
                  {runbooks.map((rb) => (
                    <div key={rb.id} className="p-4 bg-gray-800/50 rounded">
                      <div className="flex justify-between items-center mb-2">
                        <div className="font-medium text-blue-400">{rb.title}</div>
                        <span className={`px-2 py-1 rounded text-xs ${rb.status === "ACTIVE" ? "bg-green-900/50 text-green-400" : rb.status === "DEPRECATED" ? "bg-red-900/50 text-red-400" : "bg-gray-700 text-gray-400"}`}>{rb.status}</span>
                      </div>
                      <div className="text-xs text-gray-400">v{rb.version} &bull; Updated: {new Date(rb.updatedAt).toLocaleDateString()}</div>
                      <pre className="mt-3 text-xs text-gray-300 bg-gray-900/50 p-3 rounded max-h-40 overflow-y-auto whitespace-pre-wrap">{rb.content}</pre>
                    </div>
                  ))}
                  {runbooks.length === 0 && <div className="text-sm text-gray-400">No runbooks.</div>}
                </div>
              )}
            </div>
          )}

          {/* ═══ AUDIT TAB ═══ */}
          {activeTab === "audit" && (
            <div className="bg-gray-900/30 border border-purple-500/30 p-5 rounded-lg">
              <h2 className="text-purple-400 font-orbitron mb-3 flex items-center gap-2"><Activity size={18}/> Audit Trail</h2>
              {auditLoading ? <div className="text-sm text-gray-400">Loading...</div> : (
                <div className="space-y-2 max-h-[500px] overflow-y-auto">
                  {auditLogs.map((evt) => (
                    <div key={evt.id} className="flex justify-between items-center p-2 bg-gray-800/50 rounded text-sm">
                      <div>
                        <span className="font-medium text-purple-300">{evt.action}</span>
                        <span className="text-gray-400 ml-2">{evt.entityType}{evt.entityId ? `:${evt.entityId.slice(0, 8)}` : ""}</span>
                      </div>
                      <div className="text-xs text-gray-500">{new Date(evt.createdAt).toLocaleString()}</div>
                    </div>
                  ))}
                  {auditLogs.length === 0 && <div className="text-sm text-gray-400">No audit events.</div>}
                </div>
              )}
            </div>
          )}

          {/* ═══ INTEGRATIONS TAB ═══ */}
          {activeTab === "integrations" && (
            <div className="space-y-6">

              {/* ─── Platform Integrations (Level 2 bindings) ─── */}
              <div className="bg-gray-900/30 border border-yellow-500/30 p-5 rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-yellow-400 font-orbitron flex items-center gap-2"><Link2 size={18}/> Platform Integrations</h2>
                  {canManage && (
                    <button onClick={handleOpenBindModal} className="px-3 py-1.5 bg-yellow-500 text-cyber-base font-bold rounded text-sm flex items-center gap-1">
                      <Plus size={14}/> Bind Integration
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-400 mb-3">
                  These are organization-level integrations (GitHub, GitLab, Docker) linked to this project with project-specific configuration.
                </p>

                {/* Bind modal */}
                {showBindModal && (
                  <div className="bg-gray-800/50 p-4 rounded mb-4 space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-yellow-300">Select an integration to bind</span>
                      <button onClick={() => { setShowBindModal(false); setSelectedBindId(null); setBindConfig({}); }} className="text-gray-400 hover:text-white"><X size={16}/></button>
                    </div>
                    {availablePlatform.length === 0 ? (
                      <div className="text-sm text-gray-500">
                        No available integrations. Create platform-level integrations first at <button onClick={() => navigate("/integrations")} className="text-cyber-cyan hover:underline">Integrations</button>.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {availablePlatform.map((integ) => (
                          <div key={integ.id} className="bg-gray-900/50 rounded p-3">
                            <div className="flex justify-between items-center">
                              <div className="flex items-center gap-2">
                                {integ.type === "github" && <GitBranch size={16} className="text-gray-100"/>}
                                {integ.type === "gitlab" && <GitBranch size={16} className="text-orange-400"/>}
                                {integ.type === "docker_registry" && <Package size={16} className="text-blue-400"/>}
                                <span className="font-medium text-sm">{integ.name}</span>
                                <span className="text-xs bg-gray-700 px-2 py-0.5 rounded">{integ.type}</span>
                              </div>
                              <button
                                onClick={() => handleSelectIntegration(integ.id)}
                                className="px-2 py-1 text-xs border border-yellow-500/40 rounded text-yellow-400 hover:bg-yellow-900/30"
                              >
                                {selectedBindId === integ.id ? "Cancel" : "Configure & Bind"}
                              </button>
                            </div>

                            {/* Expanded config panel for selected integration */}
                            {selectedBindId === integ.id && (integ.type === "github" || integ.type === "gitlab") && (
                              <div className="mt-3 space-y-3">
                                {/* Mode toggle */}
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => setBindMode("connect")}
                                    className={`px-3 py-1.5 text-xs font-bold rounded transition ${
                                      bindMode === "connect" ? "bg-cyber-cyan text-cyber-base" : "border border-gray-600 text-gray-400 hover:text-white"
                                    }`}
                                  >
                                    🔗 Connect Existing Repo
                                  </button>
                                  <button
                                    onClick={() => setBindMode("create")}
                                    className={`px-3 py-1.5 text-xs font-bold rounded transition ${
                                      bindMode === "create" ? "bg-cyber-green text-cyber-base" : "border border-gray-600 text-gray-400 hover:text-white"
                                    }`}
                                  >
                                    ➕ Create New Repository
                                  </button>
                                </div>

                                {/* ─── MODE 1: Connect existing repo ─── */}
                                {bindMode === "connect" && (
                                  <div className="space-y-2">
                                    {reposLoading ? (
                                      <div className="text-sm text-gray-400 animate-pulse">Loading repositories from {integ.type}...</div>
                                    ) : (
                                      <>
                                        <input
                                          value={repoSearch}
                                          onChange={(e) => setRepoSearch(e.target.value)}
                                          placeholder="Search repositories..."
                                          className="w-full bg-gray-800 text-white p-2 rounded border border-gray-600 text-sm"
                                        />
                                        <div className="max-h-48 overflow-y-auto space-y-1">
                                          {providerRepos
                                            .filter((r) => r.fullName.toLowerCase().includes(repoSearch.toLowerCase()))
                                            .map((repo) => (
                                              <button
                                                key={repo.fullName}
                                                onClick={() => handleSelectRepo(integ.id, repo)}
                                                className={`w-full text-left p-2 rounded text-sm flex justify-between items-center transition ${
                                                  bindConfig.repo === repo.fullName
                                                    ? "bg-cyber-cyan/20 border border-cyber-cyan/50"
                                                    : "bg-gray-800/50 hover:bg-gray-700/50 border border-transparent"
                                                }`}
                                              >
                                                <div>
                                                  <span className="font-medium">{repo.fullName}</span>
                                                  {repo.isPrivate && <span className="ml-2 text-xs text-yellow-400">private</span>}
                                                </div>
                                                <span className="text-xs text-gray-500">{repo.defaultBranch}</span>
                                              </button>
                                            ))}
                                          {providerRepos.filter((r) => r.fullName.toLowerCase().includes(repoSearch.toLowerCase())).length === 0 && (
                                            <div className="text-xs text-gray-500 p-2">No matching repositories found.</div>
                                          )}
                                        </div>
                                        {/* Branch picker (after repo selected) */}
                                        {bindConfig.repo && (
                                          <div className="grid grid-cols-2 gap-2">
                                            <div>
                                              <label className="text-xs text-gray-400 block mb-1">Branch</label>
                                              {branchesLoading ? (
                                                <div className="text-xs text-gray-500 animate-pulse p-2">Loading branches...</div>
                                              ) : (
                                                <select
                                                  value={bindConfig.branch || ""}
                                                  onChange={(e) => setBindConfig((p) => ({ ...p, branch: e.target.value }))}
                                                  className="w-full bg-gray-800 text-white p-2 rounded border border-gray-600 text-sm"
                                                >
                                                  {providerBranches.map((b) => (
                                                    <option key={b.name} value={b.name}>{b.name}</option>
                                                  ))}
                                                  {providerBranches.length === 0 && <option value={bindConfig.branch}>{bindConfig.branch}</option>}
                                                </select>
                                              )}
                                            </div>
                                            <div>
                                              <label className="text-xs text-gray-400 block mb-1">Environment</label>
                                              <input value={bindConfig.environment || ""} onChange={(e) => setBindConfig((p) => ({ ...p, environment: e.target.value }))} placeholder="production" className="w-full bg-gray-800 text-white p-2 rounded border border-gray-600 text-sm" />
                                            </div>
                                          </div>
                                        )}
                                        {bindConfig.repo && (
                                          <button
                                            onClick={() => handleBindIntegration(integ.id)}
                                            disabled={bindLoading}
                                            className="px-4 py-1.5 bg-cyber-cyan text-cyber-base font-bold rounded text-sm disabled:opacity-50"
                                          >
                                            {bindLoading ? "Binding..." : `Bind ${bindConfig.repo}`}
                                          </button>
                                        )}
                                      </>
                                    )}
                                  </div>
                                )}

                                {/* ─── MODE 2: Create new repo ─── */}
                                {bindMode === "create" && (
                                  <div className="space-y-2">
                                    <div className="grid grid-cols-2 gap-2">
                                      <div>
                                        <label className="text-xs text-gray-400 block mb-1">Repository Name *</label>
                                        <input
                                          value={newRepoForm.name}
                                          onChange={(e) => setNewRepoForm((p) => ({ ...p, name: e.target.value.replace(/[^a-zA-Z0-9._-]/g, "") }))}
                                          placeholder="my-new-project"
                                          className="w-full bg-gray-800 text-white p-2 rounded border border-gray-600 text-sm"
                                        />
                                      </div>
                                      <div>
                                        <label className="text-xs text-gray-400 block mb-1">Description</label>
                                        <input
                                          value={newRepoForm.description}
                                          onChange={(e) => setNewRepoForm((p) => ({ ...p, description: e.target.value }))}
                                          placeholder="Short description..."
                                          className="w-full bg-gray-800 text-white p-2 rounded border border-gray-600 text-sm"
                                        />
                                      </div>
                                      <div className="flex items-center gap-3 col-span-2">
                                        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                                          <input type="checkbox" checked={newRepoForm.isPrivate} onChange={(e) => setNewRepoForm((p) => ({ ...p, isPrivate: e.target.checked }))} className="accent-cyber-cyan" />
                                          Private repository
                                        </label>
                                        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                                          <input type="checkbox" checked={newRepoForm.autoInit} onChange={(e) => setNewRepoForm((p) => ({ ...p, autoInit: e.target.checked }))} className="accent-cyber-cyan" />
                                          Initialize with README
                                        </label>
                                      </div>
                                      <div>
                                        <label className="text-xs text-gray-400 block mb-1">Environment</label>
                                        <input value={bindConfig.environment || ""} onChange={(e) => setBindConfig((p) => ({ ...p, environment: e.target.value }))} placeholder="production" className="w-full bg-gray-800 text-white p-2 rounded border border-gray-600 text-sm" />
                                      </div>
                                    </div>
                                    <button
                                      onClick={() => handleCreateAndBind(integ.id)}
                                      disabled={bindLoading || !newRepoForm.name.trim()}
                                      className="px-4 py-1.5 bg-cyber-green text-cyber-base font-bold rounded text-sm disabled:opacity-50"
                                    >
                                      {bindLoading ? "Creating..." : `Create & Bind "${newRepoForm.name || "..."}" to Project`}
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Docker registry config (unchanged) */}
                            {selectedBindId === integ.id && integ.type === "docker_registry" && (
                              <div className="mt-3 space-y-2">
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="text-xs text-gray-400 block mb-1">Namespace</label>
                                    <input value={bindConfig.namespace || ""} onChange={(e) => setBindConfig((p) => ({ ...p, namespace: e.target.value }))} placeholder="org/project" className="w-full bg-gray-800 text-white p-2 rounded border border-gray-600 text-sm" />
                                  </div>
                                  <div>
                                    <label className="text-xs text-gray-400 block mb-1">Environment</label>
                                    <input value={bindConfig.environment || ""} onChange={(e) => setBindConfig((p) => ({ ...p, environment: e.target.value }))} placeholder="production" className="w-full bg-gray-800 text-white p-2 rounded border border-gray-600 text-sm" />
                                  </div>
                                </div>
                                <button
                                  onClick={() => handleBindIntegration(integ.id)}
                                  disabled={bindLoading}
                                  className="px-4 py-1.5 bg-yellow-500 text-cyber-base font-bold rounded text-sm disabled:opacity-50"
                                >
                                  {bindLoading ? "Binding..." : "Bind to Project"}
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Current bindings list */}
                {bindingsLoading ? <div className="text-gray-400 text-sm animate-pulse">Loading platform integrations...</div> : (
                  <div className="space-y-2">
                    {projectBindings.map((b) => {
                      const cfg = b.configJson as Record<string, string> | null;
                      const hasRepo = !!(cfg?.repo);
                      const isExpanded = expandedCommits.has(b.id);
                      const commits = bindingCommits[b.id] || [];
                      const isLoadingCommits = commitsLoading[b.id] || false;
                      return (
                        <div key={b.id} className="bg-gray-800/50 rounded overflow-hidden">
                          <div className="flex items-center justify-between p-3">
                            <div className="flex items-center gap-3">
                              {b.integration.type === "github" && <GitBranch size={18} className="text-gray-100"/>}
                              {b.integration.type === "gitlab" && <GitBranch size={18} className="text-orange-400"/>}
                              {b.integration.type === "docker_registry" && <Package size={18} className="text-blue-400"/>}
                              <div>
                                <div className="font-medium text-sm">{b.integration.name}</div>
                                <div className="text-xs text-gray-400 flex items-center gap-2">
                                  <span className="bg-gray-700 px-2 py-0.5 rounded">{b.integration.type}</span>
                                  {cfg?.repo && <span>repo: {cfg.repo}</span>}
                                  {cfg?.branch && <span>branch: {cfg.branch}</span>}
                                  {cfg?.namespace && <span>ns: {cfg.namespace}</span>}
                                  {cfg?.environment && <span>env: {cfg.environment}</span>}
                                  <span className={b.status === "active" ? "text-green-400" : "text-gray-500"}>{b.status}</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {hasRepo && (b.integration.type === "github" || b.integration.type === "gitlab") && (
                                <button
                                  onClick={() => handleToggleCommits(b)}
                                  className={`px-2 py-1 text-xs rounded flex items-center gap-1 transition ${
                                    isExpanded ? "bg-cyber-cyan/20 text-cyber-cyan border border-cyber-cyan/40" : "border border-gray-600 text-gray-400 hover:text-white"
                                  }`}
                                  title="Show recent commits"
                                >
                                  <GitCommitHorizontal size={12}/> Commits
                                </button>
                              )}
                              {canManage && (
                                <button onClick={() => handleUnbindIntegration(b.id)} className="text-red-400 hover:text-red-300 p-1" title="Unbind">
                                  <Trash2 size={14}/>
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Expanded commits panel */}
                          {isExpanded && hasRepo && (
                            <div className="border-t border-gray-700/50 bg-gray-900/40 px-3 py-2">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs text-gray-400 font-medium flex items-center gap-1">
                                  <GitCommitHorizontal size={12}/> Recent commits on <span className="text-cyber-cyan">{cfg?.branch || "default"}</span>
                                </span>
                                <button
                                  onClick={() => loadBindingCommits(b)}
                                  disabled={isLoadingCommits}
                                  className="text-xs text-gray-400 hover:text-cyber-cyan flex items-center gap-1"
                                >
                                  <RefreshCw size={10} className={isLoadingCommits ? "animate-spin" : ""}/> Refresh
                                </button>
                              </div>
                              {isLoadingCommits ? (
                                <div className="text-xs text-gray-500 animate-pulse py-3 text-center">Loading commits...</div>
                              ) : commits.length === 0 ? (
                                <div className="text-xs text-gray-500 py-3 text-center">No commits found.</div>
                              ) : (
                                <div className="space-y-1 max-h-64 overflow-y-auto">
                                  {commits.map((c) => (
                                    <div key={c.sha} className="flex items-start gap-2 py-1.5 px-1 hover:bg-gray-800/50 rounded text-xs">
                                      {c.authorAvatar ? (
                                        <img src={c.authorAvatar} alt="" className="w-5 h-5 rounded-full mt-0.5 flex-shrink-0" />
                                      ) : (
                                        <div className="w-5 h-5 rounded-full bg-gray-700 flex items-center justify-center mt-0.5 flex-shrink-0">
                                          <span className="text-[8px] text-gray-400">{c.authorName.charAt(0).toUpperCase()}</span>
                                        </div>
                                      )}
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                          <a
                                            href={c.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="font-mono text-cyber-cyan hover:underline flex-shrink-0"
                                          >
                                            {c.shortSha}
                                          </a>
                                          <span className="text-gray-200 truncate">{c.message}</span>
                                        </div>
                                        <div className="text-gray-500 mt-0.5">
                                          {c.authorName} &bull; {new Date(c.date).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                        </div>
                                      </div>
                                      {c.url && (
                                        <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-cyber-cyan flex-shrink-0">
                                          <ExternalLink size={10}/>
                                        </a>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {projectBindings.length === 0 && !bindingsLoading && (
                      <div className="text-sm text-gray-500">No platform integrations bound to this project yet. Bind one to connect GitHub, GitLab, or Docker to this project&apos;s pipelines.</div>
                    )}
                  </div>
                )}
              </div>
              {/* Deployment Targets */}
              <div className="bg-gray-900/30 border border-cyber-magenta/30 p-5 rounded-lg">
                <div className="flex justify-between items-center mb-3">
                  <h2 className="text-cyber-magenta font-orbitron flex items-center gap-2"><Cloud size={18}/> Deployment Targets ({deployTargets.length})</h2>
                  {canManage && (
                    <button onClick={() => setShowAddTarget(!showAddTarget)} className="px-3 py-1.5 bg-cyber-magenta text-cyber-base font-bold rounded text-sm flex items-center gap-1"><Plus size={14}/> Add Target</button>
                  )}
                </div>

                {showAddTarget && (
                  <div className="bg-gray-800/50 p-4 rounded mb-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">Name</label>
                        <input value={newTarget.name} onChange={(e) => setNewTarget((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Production AWS" className="w-full bg-gray-800 text-white p-2 rounded border border-gray-600" />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">Environment</label>
                        <select value={newTarget.environment} onChange={(e) => setNewTarget((p) => ({ ...p, environment: e.target.value }))} className="w-full bg-gray-800 text-white p-2 rounded border border-gray-600">
                          <option value="DEV">Development</option>
                          <option value="STAGING">Staging</option>
                          <option value="PROD">Production</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">Provider</label>
                        <select value={newTarget.provider} onChange={(e) => setNewTarget((p) => ({ ...p, provider: e.target.value }))} className="w-full bg-gray-800 text-white p-2 rounded border border-gray-600">
                          <option value="AWS_ECS">AWS ECS</option>
                          <option value="AWS_LAMBDA">AWS Lambda</option>
                          <option value="RAILWAY">Railway</option>
                          <option value="VERCEL">Vercel</option>
                          <option value="DOCKER">Docker</option>
                          <option value="K8S">Kubernetes</option>
                          <option value="CUSTOM">Custom</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">URL (optional)</label>
                        <input value={newTarget.url} onChange={(e) => setNewTarget((p) => ({ ...p, url: e.target.value }))} placeholder="https://..." className="w-full bg-gray-800 text-white p-2 rounded border border-gray-600" />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={handleAddTarget} disabled={!newTarget.name.trim()} className="px-4 py-2 bg-cyber-green text-cyber-base font-bold rounded text-sm disabled:opacity-50">Create Target</button>
                      <button onClick={() => setShowAddTarget(false)} className="px-4 py-2 border border-gray-600 text-gray-400 rounded text-sm">Cancel</button>
                    </div>
                  </div>
                )}

                {targetsLoading ? <div className="text-sm text-gray-400">Loading...</div> : (
                  <div className="space-y-2">
                    {deployTargets.map((t) => (
                      <div key={t.id} className="flex justify-between items-center p-3 bg-gray-800/50 rounded">
                        <div className="flex items-center gap-3">
                          <Cloud size={20} className="text-cyber-magenta" />
                          <div>
                            <div className="font-medium">{t.name}</div>
                            <div className="text-xs text-gray-400">
                              {t.environment} &bull; {t.provider}
                              {t.region && ` • ${t.region}`}
                              {t.lastDeployAt && ` • Last deploy: ${new Date(t.lastDeployAt).toLocaleDateString()}`}
                              {t.lastStatus && ` • ${t.lastStatus}`}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {t.url && <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-cyber-cyan"><ExternalLink size={14}/></a>}
                          {canManage && <button onClick={() => handleDeleteTarget(t.id)} className="text-red-400 hover:text-red-300 p-1" title="Delete target"><Trash2 size={14}/></button>}
                        </div>
                      </div>
                    ))}
                    {deployTargets.length === 0 && <div className="text-sm text-gray-400">No deployment targets configured. Add one to define where this project deploys.</div>}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══ PIPELINES TAB ═══ */}
          {activeTab === "pipelines" && (
            <div className="space-y-6">
              <div className="bg-gray-900/30 border border-blue-500/30 p-5 rounded-lg">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-blue-400 font-orbitron flex items-center gap-2"><Terminal size={18}/> CI/CD Pipelines</h2>
                  <button
                    onClick={() => navigate(`/project/${projectId}/pipelines`)}
                    className="flex items-center gap-2 px-4 py-2 bg-cyber-cyan text-cyber-base font-bold rounded text-sm hover:bg-cyber-cyan/80 transition"
                  >
                    <Terminal size={14}/> Open Pipeline Manager
                  </button>
                </div>
                <p className="text-sm text-gray-400 mb-4">
                  Manage CI/CD pipelines for this project. Click &ldquo;Open Pipeline Manager&rdquo; to create, edit, trigger, and monitor runs.
                </p>

                {pipelinesLoading ? (
                  <div className="text-sm text-gray-400 animate-pulse">Loading pipelines...</div>
                ) : pipelinesError ? (
                  <div className="text-sm text-red-400 bg-red-900/20 border border-red-500/30 p-3 rounded">{pipelinesError}</div>
                ) : pipelines.length === 0 ? (
                  <div className="text-sm text-gray-500">No pipelines configured yet. Open the Pipeline Manager to create one.</div>
                ) : (
                  <div className="space-y-2">
                    {pipelines.map((pl) => (
                      <div key={pl.id} className="flex items-center justify-between p-3 bg-gray-800/50 rounded border border-gray-700 hover:border-blue-500/40 transition cursor-pointer"
                        onClick={() => navigate(`/project/${projectId}/pipelines`)}
                      >
                        <div className="flex items-center gap-3">
                          <Terminal size={16} className="text-blue-400" />
                          <div>
                            <div className="text-sm font-medium text-gray-200">{pl.name}</div>
                            <div className="text-xs text-gray-500">Created {new Date(pl.created_at).toLocaleDateString()}</div>
                          </div>
                        </div>
                        <Play size={14} className="text-gray-500" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══ SETTINGS TAB ═══ */}
          {activeTab === "settings" && (
            <div className="space-y-6">
              <div className="bg-gray-900/30 border border-orange-500/30 p-5 rounded-lg">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-orange-400 font-orbitron flex items-center gap-2"><Settings size={18}/> Project Settings</h2>
                  {canManage && !editing && (
                    <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-cyber-cyan hover:underline text-sm"><Pencil size={14}/> Edit</button>
                  )}
                </div>

                {editing ? (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Name</label>
                      <input value={editForm.name} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} className="w-full bg-gray-800 text-white p-2 rounded border border-gray-600" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Description</label>
                      <textarea value={editForm.description} onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))} rows={3} className="w-full bg-gray-800 text-white p-2 rounded border border-gray-600" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Type</label>
                      <select value={editForm.type} onChange={(e) => setEditForm((p) => ({ ...p, type: e.target.value }))} className="w-full bg-gray-800 text-white p-2 rounded border border-gray-600">
                        {PROJECT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Git Repository URL</label>
                      <input value={editForm.gitRepositoryUrl} onChange={(e) => setEditForm((p) => ({ ...p, gitRepositoryUrl: e.target.value }))} placeholder="https://github.com/..." className="w-full bg-gray-800 text-white p-2 rounded border border-gray-600" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Default Branch</label>
                      <input value={editForm.defaultBranch} onChange={(e) => setEditForm((p) => ({ ...p, defaultBranch: e.target.value }))} className="w-full bg-gray-800 text-white p-2 rounded border border-gray-600" />
                    </div>
                    {editError && <div className="text-sm text-cyber-red">{editError}</div>}
                    <div className="flex gap-3">
                      <button onClick={handleSaveSettings} disabled={editLoading} className="px-4 py-2 bg-cyber-green text-cyber-base font-bold rounded flex items-center gap-1 disabled:opacity-50"><Save size={14}/> {editLoading ? "Saving..." : "Save"}</button>
                      <button onClick={() => setEditing(false)} className="px-4 py-2 border border-gray-600 text-gray-400 rounded flex items-center gap-1"><X size={14}/> Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div><div className="text-xs text-gray-400">Name</div><div className="text-sm">{project.name}</div></div>
                    <div><div className="text-xs text-gray-400">Key</div><div className="text-sm font-mono">{project.key}</div></div>
                    <div><div className="text-xs text-gray-400">Type</div><div className="text-sm">{typeIcon(project.type)} {typeLabel(project.type)}</div></div>
                    <div><div className="text-xs text-gray-400">Status</div><div className="text-sm">{project.status}</div></div>
                    <div><div className="text-xs text-gray-400">Git Repository</div><div className="text-sm">{project.gitRepositoryUrl || "Not set"}</div></div>
                    <div><div className="text-xs text-gray-400">Default Branch</div><div className="text-sm">{project.defaultBranch || "main"}</div></div>
                    <div><div className="text-xs text-gray-400">Owner</div><div className="text-sm">{project.owner?.name ?? project.owner?.email ?? "—"}</div></div>
                    <div><div className="text-xs text-gray-400">Created</div><div className="text-sm">{new Date(project.createdAt).toLocaleDateString()}</div></div>
                  </div>
                )}
              </div>

              {/* Environments */}
              <div className="bg-gray-900/30 border border-cyber-cyan/30 p-5 rounded-lg">
                <h2 className="text-cyber-cyan font-orbitron mb-3">Environments</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {(project.environments ?? []).map((env) => (
                    <div key={env.id} className="p-3 bg-gray-800/50 rounded text-center">
                      <div className="font-medium">{env.name}</div>
                      <div className="text-xs text-gray-400">{env.key} {env.isDefault ? "(default)" : ""}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Danger Zone */}
              {canManage && project.status === "ACTIVE" && (
                <div className="bg-gray-900/30 border border-cyber-red/30 p-5 rounded-lg">
                  <h2 className="text-cyber-red font-orbitron mb-3">Danger Zone</h2>
                  <p className="text-sm text-gray-400 mb-3">Archiving hides the project from active lists but preserves all data.</p>
                  <button onClick={handleArchive} className="px-4 py-2 border border-cyber-red text-cyber-red rounded hover:bg-cyber-red/10 font-bold">Archive Project</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProjectDetailPage;
