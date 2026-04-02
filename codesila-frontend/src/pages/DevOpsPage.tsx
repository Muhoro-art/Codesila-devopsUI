// src/pages/DevOpsPage.tsx — Unified DevOps Control Plane (§2.1, §3.5)
//
// This page is the operational centre of the platform. Every tab lets the user
// *act* — not just view. After one-time onboarding (Git token, server provision,
// registry account), a project team should be able to run the full delivery
// lifecycle from this single page without context-switching.

import { useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import {
  GitBranch, Shield, Users, Activity, GitPullRequest, BarChart,
  FileText, Package, Play, CircleCheck, CircleX, Clock, Loader,
  Ban, Terminal, Plus, ChevronDown, ChevronUp, AlertTriangle,
  BookOpen, RefreshCw, X,
} from 'lucide-react';
import {
  getInsights, listAuditEvents, listProjects,
  listDeployments, createDeployment, listServices, listIncidents,
  createIncident, updateIncident,
  listRunbooks, createRunbook, updateRunbook,
  type AuditEvent, type InsightSnapshot, type ProjectSummary,
  type Deployment, type Service, type Incident, type Runbook,
} from "../api/devflow";
import { listProjects as listCoreProjects, createProject, type Project } from "../api/projects";
import { listUsers, updateUser, type AdminUser } from "../api/auth";
import {
  listRecentPipelineRuns, listPipelines, triggerPipelineRun,
  getRunSteps, getStepLogs,
  type RecentPipelineRun, type Pipeline, type RunStep, type StepLogs,
} from "../api/cicd";
import { useAuth } from "../contexts/AuthContext";

/* ═══════════════════════════════════════════════════════════════
   TABS
   ═══════════════════════════════════════════════════════════════ */

const TABS = ['dashboard', 'pipelines', 'deployments', 'projects', 'users', 'incidents', 'runbooks', 'audit', 'insights'] as const;
type Tab = typeof TABS[number];

const TAB_META: Record<Tab, { label: string; icon: React.ReactNode }> = {
  dashboard:   { label: 'Dashboard',   icon: <BarChart size={16} /> },
  pipelines:   { label: 'Pipelines',   icon: <Play size={16} /> },
  deployments: { label: 'Deployments', icon: <Activity size={16} /> },
  projects:    { label: 'Projects',    icon: <Package size={16} /> },
  users:       { label: 'Users',       icon: <Users size={16} /> },
  incidents:   { label: 'Incidents',   icon: <AlertTriangle size={16} /> },
  runbooks:    { label: 'Runbooks',    icon: <BookOpen size={16} /> },
  audit:       { label: 'Audit',       icon: <FileText size={16} /> },
  insights:    { label: 'Insights',    icon: <BarChart size={16} /> },
};

const TAB_FROM_PATH: Record<string, Tab> = {
  '/devops':             'dashboard',
  '/devops/pipelines':   'pipelines',
  '/devops/deployments': 'deployments',
  '/devops/projects':    'projects',
  '/devops/incidents':   'incidents',
  '/devops/insights':    'insights',
  '/devops/runbooks':    'runbooks',
  '/devops/audit':       'audit',
  '/devops/users':       'users',
};

/* ═══════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════ */

function statusIcon(s: string) {
  switch (s) {
    case 'SUCCESS': return <CircleCheck size={14} className="text-green-400" />;
    case 'FAILURE': return <CircleX size={14} className="text-red-400" />;
    case 'RUNNING': return <Loader size={14} className="text-blue-400 animate-spin" />;
    case 'QUEUED':  return <Clock size={14} className="text-yellow-400" />;
    case 'CANCELLED': return <Ban size={14} className="text-gray-400" />;
    default: return <Clock size={14} className="text-gray-400" />;
  }
}

function statusBadge(s: string) {
  const colors: Record<string, string> = {
    SUCCESS: 'bg-green-900/50 text-green-400',
    FAILURE: 'bg-red-900/50 text-red-400',
    RUNNING: 'bg-blue-900/50 text-blue-400',
    QUEUED: 'bg-yellow-900/50 text-yellow-400',
    CANCELLED: 'bg-gray-700 text-gray-400',
    SUCCEEDED: 'bg-green-900/50 text-green-400',
    IN_PROGRESS: 'bg-blue-900/50 text-blue-400',
    FAILED: 'bg-red-900/50 text-red-400',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold ${colors[s] || 'bg-gray-700 text-gray-400'}`}>
      {statusIcon(s)} {s}
    </span>
  );
}

function timeAgo(dateStr: string) {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function durationStr(start: string | null, end: string | null) {
  if (!start) return '—';
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const sec = Math.floor((e - s) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════ */

const DevOpsPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  const activeTab: Tab = TAB_FROM_PATH[location.pathname] || 'dashboard';

  const handleTabClick = (tab: Tab) => {
    navigate(tab === 'dashboard' ? '/devops' : `/devops/${tab}`);
  };

  /* ─── Shared state ─────────────────────────────────────── */
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);

  /* ─── Dashboard state ──────────────────────────────────── */
  const [insights, setInsights] = useState<InsightSnapshot | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('all');
  const [windowDays, setWindowDays] = useState(7);
  const [recentRuns, setRecentRuns] = useState<RecentPipelineRun[]>([]);
  const [recentRunsLoading, setRecentRunsLoading] = useState(false);

  /* ─── Pipelines tab state ──────────────────────────────── */
  const [allRuns, setAllRuns] = useState<RecentPipelineRun[]>([]);
  const [allRunsLoading, setAllRunsLoading] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [runSteps, setRunSteps] = useState<RunStep[]>([]);
  const [stepsLoading, setStepsLoading] = useState(false);
  const [stepLogs, setStepLogs] = useState<Record<string, string>>({});
  const [logsLoading, setLogsLoading] = useState<string | null>(null);
  // Quick-trigger from pipeline list
  const [projectPipelines, setProjectPipelines] = useState<Record<string, Pipeline[]>>({});
  const [triggerProjectId, setTriggerProjectId] = useState('');
  const [triggerPipelineId, setTriggerPipelineId] = useState('');
  const [triggerLoading, setTriggerLoading] = useState(false);

  /* ─── Deployments tab state ────────────────────────────── */
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [deploymentsLoading, setDeploymentsLoading] = useState(false);
  const [services, setServices] = useState<Service[]>([]);
  const [deployProjectId, setDeployProjectId] = useState('');
  const [deployServiceId, setDeployServiceId] = useState('');
  const [deployVersion, setDeployVersion] = useState('');
  const [deployEnv, setDeployEnv] = useState('DEV');
  const [deployLoading, setDeployLoading] = useState(false);
  const [deployTriggerPipeline, setDeployTriggerPipeline] = useState(true);

  /* ─── Projects tab state ───────────────────────────────── */
  const [coreProjects, setCoreProjects] = useState<Project[]>([]);
  const [coreProjectsLoading, setCoreProjectsLoading] = useState(false);
  const [coreProjectsError, setCoreProjectsError] = useState('');

  /* ─── Users tab state ──────────────────────────────────── */
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState('');
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState('');
  const [userActionLoading, setUserActionLoading] = useState<string | null>(null);

  /* ─── Incidents tab state ──────────────────────────────── */
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [incidentsLoading, setIncidentsLoading] = useState(false);
  const [showCreateIncident, setShowCreateIncident] = useState(false);
  const [incidentProjectId, setIncidentProjectId] = useState('');
  const [incidentServiceId, setIncidentServiceId] = useState('');
  const [incidentSummary, setIncidentSummary] = useState('');
  const [incidentDescription, setIncidentDescription] = useState('');
  const [incidentServices, setIncidentServices] = useState<Service[]>([]);
  const [incidentCreateLoading, setIncidentCreateLoading] = useState(false);
  const [incidentUpdateLoading, setIncidentUpdateLoading] = useState<string | null>(null);

  /* ─── Runbooks tab state ───────────────────────────────── */
  const [runbooks, setRunbooks] = useState<Runbook[]>([]);
  const [runbooksLoading, setRunbooksLoading] = useState(false);
  const [showCreateRunbook, setShowCreateRunbook] = useState(false);
  const [runbookProjectId, setRunbookProjectId] = useState('');
  const [runbookTitle, setRunbookTitle] = useState('');
  const [runbookContent, setRunbookContent] = useState('');
  const [runbookCreateLoading, setRunbookCreateLoading] = useState(false);
  const [editingRunbookId, setEditingRunbookId] = useState<string | null>(null);
  const [editRunbookTitle, setEditRunbookTitle] = useState('');
  const [editRunbookContent, setEditRunbookContent] = useState('');
  const [editRunbookStatus, setEditRunbookStatus] = useState('');
  const [runbookUpdateLoading, setRunbookUpdateLoading] = useState(false);

  /* ─── Audit tab state ──────────────────────────────────── */
  const [auditLogs, setAuditLogs] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState('');
  const [auditProjectId, setAuditProjectId] = useState('all');
  const [auditEntityType, setAuditEntityType] = useState('all');
  const [auditLimit, setAuditLimit] = useState(20);

  /* ═══════════════════════════════════════════════════════════
     DATA LOADING
     ═══════════════════════════════════════════════════════════ */

  // Projects (shared across tabs)
  useEffect(() => {
    setProjectsLoading(true);
    listProjects()
      .then((data) => {
        setProjects(data);
        if (data.length > 0 && !deployProjectId) setDeployProjectId(data[0].id);
      })
      .catch(() => {})
      .finally(() => setProjectsLoading(false));
  }, []);

  // Core projects
  useEffect(() => {
    setCoreProjectsLoading(true);
    listCoreProjects()
      .then(setCoreProjects)
      .catch((e: any) => setCoreProjectsError(e.message))
      .finally(() => setCoreProjectsLoading(false));
  }, []);

  // Insights
  useEffect(() => {
    setInsightsError(''); setInsightsLoading(true);
    getInsights({ windowDays, projectId: selectedProjectId === 'all' ? undefined : selectedProjectId })
      .then(setInsights)
      .catch((e: any) => setInsightsError(e.message))
      .finally(() => setInsightsLoading(false));
  }, [selectedProjectId, windowDays]);

  // Recent runs (dashboard widget)
  const refreshRecentRuns = useCallback(() => {
    setRecentRunsLoading(true);
    listRecentPipelineRuns({ limit: 8 })
      .then(setRecentRuns)
      .catch(() => {})
      .finally(() => setRecentRunsLoading(false));
  }, []);
  useEffect(() => { refreshRecentRuns(); }, [refreshRecentRuns]);

  // Pipelines tab — all runs
  const refreshAllRuns = useCallback(() => {
    setAllRunsLoading(true);
    listRecentPipelineRuns({ limit: 50 })
      .then(setAllRuns)
      .catch(() => {})
      .finally(() => setAllRunsLoading(false));
  }, []);

  // Deployments
  const refreshDeployments = useCallback(() => {
    setDeploymentsLoading(true);
    listDeployments({ limit: 30 })
      .then(setDeployments)
      .catch(() => {})
      .finally(() => setDeploymentsLoading(false));
  }, []);
  useEffect(() => { refreshDeployments(); }, [refreshDeployments]);

  // Users
  useEffect(() => {
    setUsersLoading(true);
    listUsers()
      .then(setUsers)
      .catch((e: any) => setUsersError(e.message))
      .finally(() => setUsersLoading(false));
  }, []);

  // Incidents
  const refreshIncidents = useCallback(() => {
    setIncidentsLoading(true);
    listIncidents({ limit: 30 })
      .then(setIncidents)
      .catch(() => {})
      .finally(() => setIncidentsLoading(false));
  }, []);
  useEffect(() => { refreshIncidents(); }, [refreshIncidents]);

  // Runbooks
  const refreshRunbooks = useCallback(() => {
    setRunbooksLoading(true);
    listRunbooks()
      .then(setRunbooks)
      .catch(() => {})
      .finally(() => setRunbooksLoading(false));
  }, []);
  useEffect(() => { refreshRunbooks(); }, [refreshRunbooks]);

  // Audit
  useEffect(() => {
    setAuditError(''); setAuditLoading(true);
    listAuditEvents({ limit: auditLimit, projectId: auditProjectId === 'all' ? undefined : auditProjectId, entityType: auditEntityType === 'all' ? undefined : auditEntityType })
      .then(setAuditLogs)
      .catch((e: any) => setAuditError(e.message))
      .finally(() => setAuditLoading(false));
  }, [auditLimit, auditProjectId, auditEntityType]);

  // Services for deploy project
  useEffect(() => {
    if (!deployProjectId) return;
    listServices(deployProjectId)
      .then((data) => { setServices(data); if (data.length > 0) setDeployServiceId(data[0].id); })
      .catch(() => setServices([]));
  }, [deployProjectId]);

  // Services for incident project
  useEffect(() => {
    if (!incidentProjectId) { setIncidentServices([]); return; }
    listServices(incidentProjectId).then(setIncidentServices).catch(() => setIncidentServices([]));
  }, [incidentProjectId]);

  // Pipelines for trigger project
  useEffect(() => {
    if (!triggerProjectId) return;
    if (projectPipelines[triggerProjectId]) return;
    listPipelines(triggerProjectId).then((p) => {
      setProjectPipelines(prev => ({ ...prev, [triggerProjectId]: p }));
      if (p.length > 0) setTriggerPipelineId(p[0].id);
    }).catch(() => {});
  }, [triggerProjectId]);

  // Load pipelines for deploy project (to wire deploy → pipeline)
  useEffect(() => {
    if (!deployProjectId) return;
    if (projectPipelines[deployProjectId]) return;
    listPipelines(deployProjectId).then((p) => {
      setProjectPipelines(prev => ({ ...prev, [deployProjectId]: p }));
    }).catch(() => {});
  }, [deployProjectId]);

  // Lazy-load tab data
  useEffect(() => {
    if (activeTab === 'pipelines') refreshAllRuns();
  }, [activeTab, refreshAllRuns]);

  /* ═══════════════════════════════════════════════════════════
     ACTIONS
     ═══════════════════════════════════════════════════════════ */

  // Expand a pipeline run to see steps + logs
  const toggleRunExpand = async (runId: string) => {
    if (expandedRunId === runId) { setExpandedRunId(null); return; }
    setExpandedRunId(runId);
    setRunSteps([]); setStepLogs({});
    setStepsLoading(true);
    try {
      const steps = await getRunSteps(runId);
      setRunSteps(steps);
    } catch { /* handled */ }
    finally { setStepsLoading(false); }
  };

  const loadStepLogs = async (runId: string, stepId: string) => {
    if (stepLogs[stepId]) return;
    setLogsLoading(stepId);
    try {
      const data = await getStepLogs(runId, stepId);
      setStepLogs(prev => ({ ...prev, [stepId]: data.logs }));
    } catch { /* handled */ }
    finally { setLogsLoading(null); }
  };

  // Trigger pipeline from Pipelines tab
  const handleTriggerPipeline = async () => {
    if (!triggerPipelineId) return;
    setTriggerLoading(true);
    try {
      await triggerPipelineRun(triggerPipelineId);
      refreshAllRuns();
      refreshRecentRuns();
    } catch { /* handled */ }
    finally { setTriggerLoading(false); }
  };

  // Create deployment (optionally triggers pipeline)
  const handleCreateDeployment = async () => {
    if (!deployProjectId || !deployServiceId || !deployVersion.trim()) return;
    setDeployLoading(true);
    try {
      await createDeployment({ projectId: deployProjectId, serviceId: deployServiceId, environment: deployEnv, version: deployVersion.trim() });

      // If user opted to trigger pipeline and one exists for this project
      if (deployTriggerPipeline) {
        const pipelines = projectPipelines[deployProjectId];
        if (pipelines && pipelines.length > 0) {
          try { await triggerPipelineRun(pipelines[0].id); } catch { /* non-critical */ }
        }
      }

      setDeployVersion('');
      refreshDeployments();
      refreshRecentRuns();
    } catch { /* handled */ }
    finally { setDeployLoading(false); }
  };

  // Incident create
  const handleCreateIncident = async () => {
    if (!incidentProjectId || !incidentSummary.trim()) return;
    setIncidentCreateLoading(true);
    try {
      await createIncident({
        projectId: incidentProjectId,
        serviceId: incidentServiceId || undefined,
        summary: incidentSummary.trim(),
        description: incidentDescription.trim() || undefined,
      });
      setIncidentSummary(''); setIncidentDescription('');
      setShowCreateIncident(false);
      refreshIncidents();
    } catch { /* handled */ }
    finally { setIncidentCreateLoading(false); }
  };

  // Incident status update
  const handleIncidentStatusChange = async (incidentId: string, newStatus: string) => {
    setIncidentUpdateLoading(incidentId);
    try {
      await updateIncident(incidentId, {
        status: newStatus,
        ...(newStatus === 'RESOLVED' ? { resolvedAt: new Date().toISOString() } : {}),
      });
      refreshIncidents();
    } catch { /* handled */ }
    finally { setIncidentUpdateLoading(null); }
  };

  // User role / active change
  const handleUserRoleChange = async (userId: string, role: string) => {
    setUserActionLoading(userId);
    try {
      const updated = await updateUser(userId, { role });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...updated } : u));
      setEditingUserId(null);
    } catch { /* handled */ }
    finally { setUserActionLoading(null); }
  };

  const handleToggleUserActive = async (userId: string, isActive: boolean) => {
    setUserActionLoading(userId);
    try {
      const updated = await updateUser(userId, { isActive });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...updated } : u));
    } catch { /* handled */ }
    finally { setUserActionLoading(null); }
  };

  // Runbook create
  const handleCreateRunbook = async () => {
    if (!runbookProjectId || !runbookTitle.trim() || !runbookContent.trim()) return;
    setRunbookCreateLoading(true);
    try {
      await createRunbook({ projectId: runbookProjectId, title: runbookTitle.trim(), content: runbookContent.trim() });
      setRunbookTitle(''); setRunbookContent(''); setShowCreateRunbook(false);
      refreshRunbooks();
    } catch { /* handled */ }
    finally { setRunbookCreateLoading(false); }
  };

  // Runbook update
  const handleUpdateRunbook = async (runbookId: string) => {
    setRunbookUpdateLoading(true);
    try {
      await updateRunbook(runbookId, {
        title: editRunbookTitle || undefined,
        content: editRunbookContent || undefined,
        status: editRunbookStatus || undefined,
      });
      setEditingRunbookId(null);
      refreshRunbooks();
    } catch { /* handled */ }
    finally { setRunbookUpdateLoading(false); }
  };

  const refreshProjects = () => {
    setCoreProjectsLoading(true);
    listCoreProjects().then(setCoreProjects).catch((e: any) => setCoreProjectsError(e.message)).finally(() => setCoreProjectsLoading(false));
    listProjects().then((data) => { setProjects(data); }).catch(() => {});
  };

  const formatAuditLabel = (event: AuditEvent) => {
    const id = event.entityId ? `:${event.entityId.slice(0, 8)}` : '';
    return `${event.action} ${event.entityType}${id}`.trim();
  };

  /* ═══════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════ */

  return (
    <div>
      <h2 className="text-2xl font-orbitron text-cyber-cyan mb-6">DevOps Control Plane</h2>

      {/* ─── Tab Navigation ───────────────────────────────────── */}
      <div className="flex gap-1 mb-6 border-b border-cyber-cyan/20 pb-2 overflow-x-auto">
        {TABS.map((tab) => (
          <button key={tab} onClick={() => handleTabClick(tab)}
            className={`px-3 py-2 rounded-t-lg text-sm whitespace-nowrap flex items-center gap-1.5 transition-colors ${activeTab === tab ? 'bg-cyber-cyan text-cyber-base font-bold' : 'text-gray-400 hover:text-cyber-cyan hover:bg-cyber-cyan/10'}`}>
            {TAB_META[tab].icon} {TAB_META[tab].label}
          </button>
        ))}
      </div>

      {/* ═════════════════════════════════════════════════════════
         DASHBOARD TAB
         ═════════════════════════════════════════════════════════ */}
      {activeTab === 'dashboard' && (
        <>
          {/* Row 1: Quick Stats + Recent Pipeline Runs + Recent Deployments */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            {/* Quick Stats */}
            <div className="bg-gray-900/30 border border-orange-500/30 p-5 rounded-lg">
              <h3 className="text-orange-400 font-orbitron mb-3 flex items-center gap-2"><BarChart size={18} /> Quick Stats</h3>
              {insightsLoading && <div className="text-sm text-gray-400">Loading...</div>}
              {!insightsLoading && insights && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-800/50 p-3 rounded text-center"><div className="text-2xl font-bold text-cyber-green">{insights.deployments.length}</div><div className="text-xs text-gray-400">Deployments</div></div>
                  <div className="bg-gray-800/50 p-3 rounded text-center"><div className="text-2xl font-bold text-yellow-400">{insights.incidents.length}</div><div className="text-xs text-gray-400">Incidents</div></div>
                  <div className="bg-gray-800/50 p-3 rounded text-center"><div className="text-2xl font-bold text-orange-400">{insights.degradedServices.length}</div><div className="text-xs text-gray-400">Degraded</div></div>
                  <div className="bg-gray-800/50 p-3 rounded text-center"><div className="text-2xl font-bold text-cyber-cyan">{insights.deploymentStats.meanDurationMinutes != null ? `${insights.deploymentStats.meanDurationMinutes.toFixed(1)}m` : '—'}</div><div className="text-xs text-gray-400">Avg Deploy</div></div>
                </div>
              )}
            </div>

            {/* Recent Pipeline Runs — THE KEY WIDGET */}
            <div className="bg-gray-900/30 border border-blue-500/30 p-5 rounded-lg">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-blue-400 font-orbitron flex items-center gap-2"><Play size={18} /> Recent Builds</h3>
                <button onClick={refreshRecentRuns} className="text-gray-400 hover:text-blue-400"><RefreshCw size={14} /></button>
              </div>
              {recentRunsLoading && <div className="text-sm text-gray-400">Loading...</div>}
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {recentRuns.map((run) => (
                  <div key={run.id} className="flex justify-between items-center p-2 bg-gray-800/50 rounded text-sm">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{run.pipeline_name || 'Pipeline'}</div>
                      <div className="text-xs text-gray-400 truncate">{run.project_name} {run.branch ? `/ ${run.branch}` : ''} &middot; {timeAgo(run.created_at)}</div>
                    </div>
                    {statusBadge(run.status)}
                  </div>
                ))}
                {!recentRunsLoading && recentRuns.length === 0 && <div className="text-sm text-gray-400">No pipeline runs yet.</div>}
              </div>
              {recentRuns.length > 0 && (
                <button onClick={() => handleTabClick('pipelines')} className="mt-2 text-xs text-blue-400 hover:underline">View all runs &rarr;</button>
              )}
            </div>

            {/* Recent Deployments */}
            <div className="bg-gray-900/30 border border-cyber-green/30 p-5 rounded-lg">
              <h3 className="text-cyber-green font-orbitron mb-3 flex items-center gap-2"><Activity size={18} /> Recent Deployments</h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {deployments.slice(0, 6).map((dep) => (
                  <div key={dep.id} className="flex justify-between items-center p-2 bg-gray-800/50 rounded text-sm">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{dep.project?.name || 'Project'} / {dep.service?.name || 'Service'}</div>
                      <div className="text-xs text-gray-400">{dep.version} &middot; {dep.environment} &middot; {timeAgo(dep.startedAt)}</div>
                    </div>
                    {statusBadge(dep.status)}
                  </div>
                ))}
                {!deploymentsLoading && deployments.length === 0 && <div className="text-sm text-gray-400">No deployments.</div>}
              </div>
            </div>
          </div>

          {/* Row 2: Projects + Users */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <div className="bg-gray-900/30 border border-cyber-cyan/30 p-5 rounded-lg">
              <h3 className="text-cyber-cyan font-orbitron mb-3 flex items-center gap-2"><Package size={18} /> Projects</h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {coreProjects.slice(0, 6).map((proj) => (
                  <Link to={`/project/${proj.id}`} key={proj.id} className="flex justify-between items-center p-2 bg-gray-800/50 rounded hover:bg-gray-800/80 transition text-sm">
                    <div><div className="font-medium text-cyber-cyan">{proj.name}</div><div className="text-xs text-gray-400">{proj.key} {proj.type ? `• ${proj.type}` : ''}</div></div>
                    <span className="text-xs text-cyber-green">{proj.status}</span>
                  </Link>
                ))}
                {!coreProjectsLoading && coreProjects.length === 0 && <div className="text-sm text-gray-400">No projects yet.</div>}
              </div>
            </div>

            {/* Audit + Incidents summary */}
            <div className="bg-gray-900/30 border border-purple-500/30 p-5 rounded-lg">
              <h3 className="text-purple-400 font-orbitron mb-3 flex items-center gap-2"><FileText size={18} /> Recent Activity</h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {auditLogs.slice(0, 8).map((log) => (
                  <div key={log.id} className="p-2 bg-gray-800/50 rounded text-sm">
                    <div className="flex justify-between items-start">
                      <span className="font-medium text-cyber-cyan truncate">{formatAuditLabel(log)}</span>
                      <span className="text-xs text-gray-400 whitespace-nowrap ml-2">{timeAgo(log.createdAt)}</span>
                    </div>
                  </div>
                ))}
                {auditLogs.length === 0 && <div className="text-sm text-gray-400">No activity.</div>}
              </div>
              {auditLogs.length > 0 && (
                <button onClick={() => handleTabClick('audit')} className="mt-2 text-xs text-purple-400 hover:underline">View full audit log &rarr;</button>
              )}
            </div>
          </div>
        </>
      )}

      {/* ═════════════════════════════════════════════════════════
         PIPELINES TAB — cross-project run history + trigger + logs
         ═════════════════════════════════════════════════════════ */}
      {activeTab === 'pipelines' && (
        <div className="space-y-6">
          {/* Trigger a pipeline */}
          <div className="bg-gray-900/30 border border-blue-500/30 p-5 rounded-lg">
            <h3 className="text-blue-400 font-orbitron mb-3 flex items-center gap-2"><Play size={18} /> Trigger Pipeline</h3>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Project</label>
                <select value={triggerProjectId} onChange={(e) => { setTriggerProjectId(e.target.value); setTriggerPipelineId(''); }}
                  className="bg-gray-800 text-white p-2 rounded border border-blue-500/30 text-sm">
                  <option value="">Select project</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Pipeline</label>
                <select value={triggerPipelineId} onChange={(e) => setTriggerPipelineId(e.target.value)}
                  className="bg-gray-800 text-white p-2 rounded border border-blue-500/30 text-sm" disabled={!triggerProjectId}>
                  <option value="">Select pipeline</option>
                  {(projectPipelines[triggerProjectId] || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <button onClick={handleTriggerPipeline} disabled={triggerLoading || !triggerPipelineId}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded text-sm disabled:opacity-50 flex items-center gap-1.5">
                {triggerLoading ? <Loader size={14} className="animate-spin" /> : <Play size={14} />} Run
              </button>
              <button onClick={refreshAllRuns} className="px-3 py-2 text-gray-400 hover:text-blue-400"><RefreshCw size={14} /></button>
            </div>
          </div>

          {/* Run History */}
          <div className="bg-gray-900/30 border border-cyber-cyan/30 p-5 rounded-lg">
            <h3 className="text-cyber-cyan font-orbitron mb-3 flex items-center gap-2"><Terminal size={18} /> Pipeline Run History</h3>
            {allRunsLoading && <div className="text-sm text-gray-400">Loading...</div>}
            <div className="space-y-2">
              {allRuns.map((run) => (
                <div key={run.id} className="bg-gray-800/50 rounded overflow-hidden">
                  <button onClick={() => toggleRunExpand(run.id)}
                    className="w-full flex justify-between items-center p-3 text-sm text-left hover:bg-gray-800/80 transition">
                    <div className="flex items-center gap-3 min-w-0">
                      {expandedRunId === run.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      <div className="min-w-0">
                        <div className="font-medium truncate">{run.pipeline_name || 'Pipeline'} <span className="text-gray-500">({run.project_name || run.project_key || '?'})</span></div>
                        <div className="text-xs text-gray-400">
                          {run.branch ? `${run.branch} ` : ''}{run.commit_sha ? `${run.commit_sha.slice(0, 7)} ` : ''}&middot; {timeAgo(run.created_at)} &middot; {durationStr(run.started_at, run.finished_at)}
                        </div>
                      </div>
                    </div>
                    {statusBadge(run.status)}
                  </button>

                  {/* Expanded: steps + logs */}
                  {expandedRunId === run.id && (
                    <div className="border-t border-gray-700 p-3">
                      {stepsLoading && <div className="text-sm text-gray-400">Loading steps...</div>}
                      {!stepsLoading && runSteps.length === 0 && <div className="text-sm text-gray-400">No steps recorded.</div>}
                      <div className="space-y-2">
                        {runSteps.map((step) => (
                          <div key={step.id}>
                            <button onClick={() => loadStepLogs(run.id, step.id)}
                              className="w-full flex items-center gap-2 p-2 rounded hover:bg-gray-700/50 text-sm text-left">
                              {statusIcon(step.status)}
                              <span className="font-medium">{step.name}</span>
                              <span className="text-xs text-gray-400 ml-auto">{durationStr(step.started_at, step.finished_at)}</span>
                              <Terminal size={12} className="text-gray-500" />
                            </button>
                            {stepLogs[step.id] !== undefined && (
                              <pre className="bg-gray-950 text-green-300 text-xs p-3 rounded mt-1 max-h-48 overflow-auto font-mono whitespace-pre-wrap">
                                {stepLogs[step.id] || '(no output)'}
                              </pre>
                            )}
                            {logsLoading === step.id && <div className="text-xs text-gray-400 pl-6">Loading logs...</div>}
                          </div>
                        ))}
                      </div>
                      {/* Link to full pipeline page */}
                      {run.project_id && (
                        <Link to={`/project/${run.project_id}/pipelines`} className="text-xs text-blue-400 hover:underline mt-2 inline-block">
                          Open pipeline editor &rarr;
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {!allRunsLoading && allRuns.length === 0 && <div className="text-sm text-gray-400">No pipeline runs yet. Select a project and pipeline above to trigger your first build.</div>}
            </div>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════
         DEPLOYMENTS TAB — create deployment + trigger pipeline
         ═════════════════════════════════════════════════════════ */}
      {activeTab === 'deployments' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-gray-900/30 border border-cyber-green/30 p-5 rounded-lg">
            <h3 className="text-cyber-green font-orbitron mb-3 flex items-center gap-2"><GitPullRequest size={18} /> New Deployment</h3>
            <div className="space-y-3">
              <select value={deployProjectId} onChange={(e) => setDeployProjectId(e.target.value)} className="w-full bg-gray-800 text-white p-2 rounded text-sm">
                <option value="">Select project</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select value={deployServiceId} onChange={(e) => setDeployServiceId(e.target.value)} className="w-full bg-gray-800 text-white p-2 rounded text-sm">
                <option value="">Select service</option>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select value={deployEnv} onChange={(e) => setDeployEnv(e.target.value)} className="w-full bg-gray-800 text-white p-2 rounded text-sm">
                <option value="DEV">Development</option><option value="STAGING">Staging</option><option value="PROD">Production</option>
              </select>
              <input type="text" value={deployVersion} onChange={(e) => setDeployVersion(e.target.value)} placeholder="Version (e.g. v1.2.3)" className="w-full bg-gray-800 text-white p-2 rounded text-sm" />

              {/* Pipeline trigger option */}
              {deployProjectId && (projectPipelines[deployProjectId]?.length ?? 0) > 0 && (
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={deployTriggerPipeline} onChange={(e) => setDeployTriggerPipeline(e.target.checked)}
                    className="rounded border-gray-600" />
                  <Play size={14} className="text-blue-400" />
                  Also trigger pipeline <span className="text-gray-500">({projectPipelines[deployProjectId]?.[0]?.name})</span>
                </label>
              )}

              <button onClick={handleCreateDeployment} disabled={deployLoading || !deployProjectId || !deployServiceId || !deployVersion.trim()}
                className="w-full py-2 bg-cyber-green text-cyber-base font-bold rounded disabled:opacity-50 text-sm">
                {deployLoading ? 'Deploying...' : 'Deploy'}
              </button>
            </div>
          </div>

          <div className="bg-gray-900/30 border border-cyber-cyan/30 p-5 rounded-lg">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-cyber-cyan font-orbitron flex items-center gap-2"><Activity size={18} /> Deployment History</h3>
              <button onClick={refreshDeployments} className="text-gray-400 hover:text-cyber-cyan"><RefreshCw size={14} /></button>
            </div>
            {deploymentsLoading && <div className="text-sm text-gray-400">Loading...</div>}
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {deployments.map((dep) => (
                <div key={dep.id} className="flex justify-between items-center p-2.5 bg-gray-800/50 rounded text-sm">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{dep.project?.name || 'Project'} / {dep.service?.name || 'Service'}</div>
                    <div className="text-xs text-gray-400">{dep.version} &middot; {dep.environment} &middot; {timeAgo(dep.startedAt)}</div>
                  </div>
                  {statusBadge(dep.status)}
                </div>
              ))}
              {!deploymentsLoading && deployments.length === 0 && <div className="text-sm text-gray-400">No deployments yet.</div>}
            </div>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════
         PROJECTS TAB
         ═════════════════════════════════════════════════════════ */}
      {activeTab === 'projects' && (
        <div className="space-y-4">
          <div className="bg-gray-900/30 border border-cyber-green/30 p-5 rounded-lg">
            <div className="flex justify-between items-center">
              <h3 className="text-cyber-green font-orbitron flex items-center gap-2"><Package size={18} /> Projects</h3>
              <Link to="/projects/new" className="px-3 py-1.5 bg-cyber-green text-cyber-base font-bold rounded text-sm">+ New Project</Link>
            </div>
          </div>

          <div className="bg-gray-900/30 border border-cyber-cyan/30 p-5 rounded-lg">
            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {coreProjectsLoading && <div className="text-sm text-gray-400">Loading...</div>}
              {coreProjects.map((proj) => (
                <Link to={`/project/${proj.id}`} key={proj.id} className="block p-3 bg-gray-800/50 rounded hover:bg-gray-800/80 transition">
                  <div className="flex justify-between items-center">
                    <div><div className="font-medium text-cyber-cyan">{proj.name}</div><div className="text-xs text-gray-400">{proj.key} {proj.type ? `• ${proj.type}` : ''}</div></div>
                    <span className="text-xs text-cyber-green">{proj.status}</span>
                  </div>
                  {proj.description && <div className="text-xs text-gray-400 mt-1">{proj.description}</div>}
                  <div className="flex gap-3 mt-1 text-xs text-gray-500">
                    {proj.owner && <span>Owner: {proj.owner.email}</span>}
                    {proj._count && <span>{proj._count.services} svc &middot; {proj._count.deployments} deploys</span>}
                  </div>
                </Link>
              ))}
              {!coreProjectsLoading && coreProjects.length === 0 && (
                <div className="text-sm text-gray-400 py-2">
                  No projects yet. Click <strong className="text-cyber-green">+ New Project</strong> above to create one.
                  <div className="text-xs text-gray-500 border-t border-gray-700 pt-2 mt-2">
                    The project wizard lets you set up everything in one place — name, git repo, team, pipeline, and deployment targets.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════
         USERS TAB — full RBAC management
         ═════════════════════════════════════════════════════════ */}
      {activeTab === 'users' && (
        <div className="bg-gray-900/30 border border-blue-500/30 p-5 rounded-lg">
          <h3 className="text-blue-400 font-orbitron mb-3 flex items-center gap-2"><Users size={18} /> User Management</h3>
          {usersLoading && <div className="text-sm text-gray-400">Loading users...</div>}
          {usersError && <div className="text-sm text-red-400">{usersError}</div>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-blue-500/20 text-left">
                  <th className="py-2">Email</th><th className="py-2">Role</th><th className="py-2">Status</th><th className="py-2">2FA</th><th className="py-2">Created</th>
                  {isAdmin && <th className="py-2">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-gray-800/60">
                    <td className="py-2 text-cyber-cyan">{u.email}</td>
                    <td className="py-2">
                      {editingUserId === u.id ? (
                        <div className="flex items-center gap-1">
                          <select value={editRole} onChange={(e) => setEditRole(e.target.value)} className="bg-gray-800 text-white p-1 rounded text-xs border border-blue-500/30">
                            {['ADMIN', 'DEVOPS', 'DEVELOPER', 'MANAGER', 'USER'].map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                          <button onClick={() => handleUserRoleChange(u.id, editRole)} disabled={userActionLoading === u.id}
                            className="text-green-400 hover:text-green-300 p-0.5"><CircleCheck size={14} /></button>
                          <button onClick={() => setEditingUserId(null)} className="text-gray-400 hover:text-gray-300 p-0.5"><X size={14} /></button>
                        </div>
                      ) : (
                        <span className={`px-2 py-0.5 rounded text-xs ${u.role === 'ADMIN' || u.role === 'SUPER_ADMIN' ? 'bg-purple-900/50 text-purple-300' : u.role === 'DEVOPS' ? 'bg-cyan-900/50 text-cyan-300' : u.role === 'DEVELOPER' ? 'bg-green-900/50 text-green-300' : u.role === 'MANAGER' ? 'bg-yellow-900/50 text-yellow-300' : 'bg-gray-700 text-gray-300'}`}>
                          {u.role}
                        </span>
                      )}
                    </td>
                    <td className="py-2">{u.isActive ? <span className="text-green-400">Active</span> : <span className="text-red-400">Revoked</span>}</td>
                    <td className="py-2">{u.twoFactorEnabled ? 'Enabled' : 'Off'}</td>
                    <td className="py-2 text-gray-400">{new Date(u.createdAt).toLocaleDateString()}</td>
                    {isAdmin && (
                      <td className="py-2">
                        {u.role !== 'SUPER_ADMIN' && (
                          <div className="flex gap-1">
                            {editingUserId !== u.id && (
                              <button onClick={() => { setEditingUserId(u.id); setEditRole(u.role); }}
                                className="text-xs text-blue-400 hover:underline">Change role</button>
                            )}
                            <button onClick={() => handleToggleUserActive(u.id, !u.isActive)}
                              disabled={userActionLoading === u.id}
                              className={`text-xs ml-2 ${u.isActive ? 'text-red-400 hover:underline' : 'text-green-400 hover:underline'}`}>
                              {userActionLoading === u.id ? '...' : u.isActive ? 'Revoke' : 'Activate'}
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!usersLoading && users.length === 0 && <div className="text-sm text-gray-400 mt-3">No users found.</div>}
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════
         INCIDENTS TAB — create, view, change status
         ═════════════════════════════════════════════════════════ */}
      {activeTab === 'incidents' && (
        <div className="space-y-4">
          <div className="bg-gray-900/30 border border-red-500/30 p-5 rounded-lg">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-red-400 font-orbitron flex items-center gap-2"><AlertTriangle size={18} /> Incidents</h3>
              <div className="flex gap-2">
                <button onClick={refreshIncidents} className="text-gray-400 hover:text-red-400"><RefreshCw size={14} /></button>
                <button onClick={() => setShowCreateIncident(!showCreateIncident)}
                  className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white font-bold rounded text-sm flex items-center gap-1">
                  <Plus size={14} /> Report Incident
                </button>
              </div>
            </div>

            {/* Create incident form */}
            {showCreateIncident && (
              <div className="bg-gray-800/50 p-4 rounded mb-4 space-y-3 border border-red-500/20">
                <select value={incidentProjectId} onChange={(e) => setIncidentProjectId(e.target.value)} className="w-full bg-gray-800 text-white p-2 rounded text-sm border border-gray-700">
                  <option value="">Select project</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {incidentProjectId && incidentServices.length > 0 && (
                  <select value={incidentServiceId} onChange={(e) => setIncidentServiceId(e.target.value)} className="w-full bg-gray-800 text-white p-2 rounded text-sm border border-gray-700">
                    <option value="">All services (optional)</option>
                    {incidentServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
                <input type="text" value={incidentSummary} onChange={(e) => setIncidentSummary(e.target.value)}
                  placeholder="Incident summary" className="w-full bg-gray-800 text-white p-2 rounded text-sm border border-gray-700" />
                <textarea value={incidentDescription} onChange={(e) => setIncidentDescription(e.target.value)}
                  placeholder="Description (optional)" className="w-full bg-gray-800 text-white p-2 rounded text-sm border border-gray-700 h-20 resize-none" />
                <div className="flex gap-2">
                  <button onClick={handleCreateIncident} disabled={incidentCreateLoading || !incidentProjectId || !incidentSummary.trim()}
                    className="px-4 py-2 bg-red-600 text-white font-bold rounded text-sm disabled:opacity-50">
                    {incidentCreateLoading ? 'Creating...' : 'Create Incident'}
                  </button>
                  <button onClick={() => setShowCreateIncident(false)} className="px-4 py-2 text-gray-400 hover:text-white text-sm">Cancel</button>
                </div>
              </div>
            )}

            {/* Incident list */}
            {incidentsLoading && <div className="text-sm text-gray-400">Loading...</div>}
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {incidents.map((inc) => (
                <div key={inc.id} className="p-3 bg-gray-800/50 rounded">
                  <div className="flex justify-between items-start mb-1">
                    <div className="min-w-0">
                      <div className="font-medium">{inc.summary}</div>
                      <div className="text-xs text-gray-400">
                        {inc.project?.name}{inc.service ? ` / ${inc.service.name}` : ''} &middot; {timeAgo(inc.startedAt)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${inc.severity === 'SEV1' ? 'bg-red-900/50 text-red-400' : inc.severity === 'SEV2' ? 'bg-orange-900/50 text-orange-400' : inc.severity === 'SEV3' ? 'bg-yellow-900/50 text-yellow-400' : 'bg-gray-700 text-gray-400'}`}>
                        {inc.severity}
                      </span>
                    </div>
                  </div>
                  {inc.description && <div className="text-xs text-gray-400 mt-1 mb-2">{inc.description}</div>}
                  {/* Status management */}
                  <div className="flex items-center gap-2 mt-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${inc.status === 'OPEN' ? 'bg-red-900/30 text-red-300' : inc.status === 'INVESTIGATING' ? 'bg-yellow-900/30 text-yellow-300' : inc.status === 'MITIGATED' ? 'bg-orange-900/30 text-orange-300' : inc.status === 'RESOLVED' ? 'bg-green-900/30 text-green-300' : 'bg-gray-700 text-gray-300'}`}>
                      {inc.status}
                    </span>
                    {inc.status !== 'RESOLVED' && (
                      <div className="flex gap-1 ml-auto">
                        {inc.status === 'OPEN' && (
                          <button onClick={() => handleIncidentStatusChange(inc.id, 'INVESTIGATING')}
                            disabled={incidentUpdateLoading === inc.id}
                            className="text-xs px-2 py-0.5 bg-yellow-900/30 text-yellow-300 rounded hover:bg-yellow-900/50">
                            {incidentUpdateLoading === inc.id ? '...' : 'Investigate'}
                          </button>
                        )}
                        {(inc.status === 'OPEN' || inc.status === 'INVESTIGATING') && (
                          <button onClick={() => handleIncidentStatusChange(inc.id, 'MITIGATED')}
                            disabled={incidentUpdateLoading === inc.id}
                            className="text-xs px-2 py-0.5 bg-orange-900/30 text-orange-300 rounded hover:bg-orange-900/50">
                            {incidentUpdateLoading === inc.id ? '...' : 'Mitigate'}
                          </button>
                        )}
                        <button onClick={() => handleIncidentStatusChange(inc.id, 'RESOLVED')}
                          disabled={incidentUpdateLoading === inc.id}
                          className="text-xs px-2 py-0.5 bg-green-900/30 text-green-300 rounded hover:bg-green-900/50">
                          {incidentUpdateLoading === inc.id ? '...' : 'Resolve'}
                        </button>
                      </div>
                    )}
                    {inc.status === 'RESOLVED' && inc.resolvedAt && (
                      <span className="text-xs text-gray-400 ml-auto">Resolved {timeAgo(inc.resolvedAt)}</span>
                    )}
                  </div>
                </div>
              ))}
              {!incidentsLoading && incidents.length === 0 && <div className="text-sm text-gray-400">No incidents. That's a good thing.</div>}
            </div>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════
         RUNBOOKS TAB — create, edit, manage lifecycle
         ═════════════════════════════════════════════════════════ */}
      {activeTab === 'runbooks' && (
        <div className="space-y-4">
          <div className="bg-gray-900/30 border border-emerald-500/30 p-5 rounded-lg">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-emerald-400 font-orbitron flex items-center gap-2"><BookOpen size={18} /> Runbooks</h3>
              <div className="flex gap-2">
                <button onClick={refreshRunbooks} className="text-gray-400 hover:text-emerald-400"><RefreshCw size={14} /></button>
                <button onClick={() => setShowCreateRunbook(!showCreateRunbook)}
                  className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded text-sm flex items-center gap-1">
                  <Plus size={14} /> New Runbook
                </button>
              </div>
            </div>

            {/* Create runbook form */}
            {showCreateRunbook && (
              <div className="bg-gray-800/50 p-4 rounded mb-4 space-y-3 border border-emerald-500/20">
                <select value={runbookProjectId} onChange={(e) => setRunbookProjectId(e.target.value)} className="w-full bg-gray-800 text-white p-2 rounded text-sm border border-gray-700">
                  <option value="">Select project</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input type="text" value={runbookTitle} onChange={(e) => setRunbookTitle(e.target.value)}
                  placeholder="Runbook title" className="w-full bg-gray-800 text-white p-2 rounded text-sm border border-gray-700" />
                <textarea value={runbookContent} onChange={(e) => setRunbookContent(e.target.value)}
                  placeholder="Runbook content (procedures, checklists, links...)" className="w-full bg-gray-800 text-white p-2 rounded text-sm border border-gray-700 h-32 resize-none font-mono" />
                <div className="flex gap-2">
                  <button onClick={handleCreateRunbook} disabled={runbookCreateLoading || !runbookProjectId || !runbookTitle.trim() || !runbookContent.trim()}
                    className="px-4 py-2 bg-emerald-600 text-white font-bold rounded text-sm disabled:opacity-50">
                    {runbookCreateLoading ? 'Creating...' : 'Create Runbook'}
                  </button>
                  <button onClick={() => setShowCreateRunbook(false)} className="px-4 py-2 text-gray-400 hover:text-white text-sm">Cancel</button>
                </div>
              </div>
            )}

            {/* Runbook list */}
            {runbooksLoading && <div className="text-sm text-gray-400">Loading...</div>}
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {runbooks.map((rb) => (
                <div key={rb.id} className="p-3 bg-gray-800/50 rounded">
                  {editingRunbookId === rb.id ? (
                    /* Edit mode */
                    <div className="space-y-2">
                      <input type="text" value={editRunbookTitle} onChange={(e) => setEditRunbookTitle(e.target.value)}
                        className="w-full bg-gray-800 text-white p-2 rounded text-sm border border-emerald-500/30" />
                      <textarea value={editRunbookContent} onChange={(e) => setEditRunbookContent(e.target.value)}
                        className="w-full bg-gray-800 text-white p-2 rounded text-sm border border-emerald-500/30 h-28 resize-none font-mono" />
                      <div className="flex items-center gap-3">
                        <select value={editRunbookStatus} onChange={(e) => setEditRunbookStatus(e.target.value)}
                          className="bg-gray-800 text-white p-1.5 rounded text-xs border border-emerald-500/30">
                          <option value="DRAFT">DRAFT</option><option value="ACTIVE">ACTIVE</option><option value="DEPRECATED">DEPRECATED</option>
                        </select>
                        <button onClick={() => handleUpdateRunbook(rb.id)} disabled={runbookUpdateLoading}
                          className="px-3 py-1 bg-emerald-600 text-white rounded text-xs disabled:opacity-50">
                          {runbookUpdateLoading ? 'Saving...' : 'Save'}
                        </button>
                        <button onClick={() => setEditingRunbookId(null)} className="px-3 py-1 text-gray-400 text-xs">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    /* View mode */
                    <>
                      <div className="flex justify-between items-start mb-1">
                        <div>
                          <div className="font-medium">{rb.title}</div>
                          <div className="text-xs text-gray-400">
                            {rb.project?.name}{rb.service ? ` / ${rb.service.name}` : ''} &middot; v{rb.version} &middot; Updated {timeAgo(rb.updatedAt)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-xs ${rb.status === 'ACTIVE' ? 'bg-green-900/30 text-green-300' : rb.status === 'DRAFT' ? 'bg-yellow-900/30 text-yellow-300' : 'bg-gray-700 text-gray-300'}`}>
                            {rb.status}
                          </span>
                          <button onClick={() => {
                            setEditingRunbookId(rb.id);
                            setEditRunbookTitle(rb.title);
                            setEditRunbookContent(rb.content);
                            setEditRunbookStatus(rb.status);
                          }} className="text-gray-400 hover:text-emerald-400"><FileText size={14} /></button>
                        </div>
                      </div>
                      <pre className="text-xs text-gray-300 mt-2 bg-gray-900/50 p-2 rounded max-h-24 overflow-auto whitespace-pre-wrap font-mono">
                        {rb.content}
                      </pre>
                    </>
                  )}
                </div>
              ))}
              {!runbooksLoading && runbooks.length === 0 && <div className="text-sm text-gray-400">No runbooks yet. Create one to document operational procedures.</div>}
            </div>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════
         AUDIT TAB
         ═════════════════════════════════════════════════════════ */}
      {activeTab === 'audit' && (
        <div className="bg-gray-900/30 border border-purple-500/30 p-5 rounded-lg">
          <h3 className="text-purple-400 font-orbitron mb-3 flex items-center gap-2"><FileText size={18} /> Audit Logs</h3>
          <div className="flex flex-wrap gap-3 mb-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-gray-400">Project</span>
              <select value={auditProjectId} onChange={(e) => setAuditProjectId(e.target.value)} className="bg-gray-800 text-white p-2 rounded border border-purple-500/30 text-sm">
                <option value="all">All</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-400">Entity</span>
              <select value={auditEntityType} onChange={(e) => setAuditEntityType(e.target.value)} className="bg-gray-800 text-white p-2 rounded border border-purple-500/30 text-sm">
                <option value="all">All</option>
                <option value="deployment">deployment</option>
                <option value="incident">incident</option>
                <option value="runbook">runbook</option>
                <option value="project">project</option>
                <option value="service">service</option>
                <option value="pipeline">pipeline</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-400">Limit</span>
              <select value={auditLimit} onChange={(e) => setAuditLimit(Number(e.target.value))} className="bg-gray-800 text-white p-2 rounded border border-purple-500/30 text-sm">
                <option value={10}>10</option><option value={20}>20</option><option value={50}>50</option>
              </select>
            </div>
          </div>
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {auditLoading && <div className="text-sm text-gray-400">Loading...</div>}
            {!auditLoading && auditError && <div className="text-sm text-red-400">{auditError}</div>}
            {!auditLoading && !auditError && auditLogs.map((log) => (
              <div key={log.id} className="p-3 bg-gray-800/50 rounded text-sm">
                <div className="flex justify-between items-start mb-1">
                  <span className="font-medium text-cyber-cyan">{formatAuditLabel(log)}</span>
                  <span className="text-xs text-gray-400 ml-2 whitespace-nowrap">{new Date(log.createdAt).toLocaleString()}</span>
                </div>
                <div className="text-xs text-gray-400">
                  Actor: {log.actorId ? log.actorId.slice(0, 8) : 'system'}
                  {log.ipAddress && <span> &middot; IP: {log.ipAddress}</span>}
                </div>
              </div>
            ))}
            {!auditLoading && !auditError && auditLogs.length === 0 && <div className="text-sm text-gray-400">No events.</div>}
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════
         INSIGHTS TAB
         ═════════════════════════════════════════════════════════ */}
      {activeTab === 'insights' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-gray-900/30 border border-orange-500/30 p-5 rounded-lg">
            <h3 className="text-orange-400 font-orbitron mb-3 flex items-center gap-2"><BarChart size={18} /> Insights</h3>
            <div className="flex flex-wrap gap-3 mb-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-gray-400">Project</span>
                <select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)} className="bg-gray-800 text-white p-2 rounded border border-orange-500/30 text-sm">
                  <option value="all">All projects</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400">Window</span>
                <select value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))} className="bg-gray-800 text-white p-2 rounded border border-orange-500/30 text-sm">
                  <option value={7}>7d</option><option value={14}>14d</option><option value={30}>30d</option>
                </select>
              </div>
            </div>
            {insightsLoading && <div className="text-sm text-gray-400">Loading insights...</div>}
            {!insightsLoading && insightsError && <div className="text-sm text-red-400">{insightsError}</div>}
            {!insightsLoading && !insightsError && insights && (
              <div className="grid grid-cols-1 gap-3 text-sm">
                <div className="bg-gray-800/50 p-3 rounded">
                  <div className="text-xs text-gray-400">Mean deploy time ({windowDays}d)</div>
                  <div className="text-lg font-semibold text-cyber-green">{insights.deploymentStats.meanDurationMinutes == null ? 'n/a' : `${insights.deploymentStats.meanDurationMinutes.toFixed(1)} min`}</div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-800/50 p-3 rounded"><div className="text-xs text-gray-400">Open incidents</div><div className="text-lg font-semibold text-yellow-400">{insights.incidents.length}</div></div>
                  <div className="bg-gray-800/50 p-3 rounded"><div className="text-xs text-gray-400">Degraded services</div><div className="text-lg font-semibold text-orange-400">{insights.degradedServices.length}</div></div>
                </div>
                <div className="bg-gray-800/50 p-3 rounded">
                  <div className="text-xs text-gray-400">Last deployment</div>
                  {insights.deployments[0] ? (
                    <div className="text-sm text-cyber-cyan">{insights.deployments[0].project}/{insights.deployments[0].service} {insights.deployments[0].version} {insights.deployments[0].environment} {insights.deployments[0].status}</div>
                  ) : <div className="text-sm text-gray-400">No deployments</div>}
                </div>
                <div className="bg-gray-800/50 p-3 rounded">
                  <div className="text-xs text-gray-400">Recent incidents</div>
                  {insights.incidents.slice(0, 5).map((inc) => (
                    <div key={inc.id} className="text-sm text-cyber-cyan">{inc.project}/{inc.service} {inc.severity} {inc.summary}</div>
                  ))}
                  {insights.incidents.length === 0 && <div className="text-sm text-gray-400">No open incidents</div>}
                </div>
                <div className="bg-gray-800/50 p-3 rounded">
                  <div className="text-xs text-gray-400">Runbook updates</div>
                  {insights.runbookUpdates.slice(0, 5).map((rb) => (
                    <div key={rb.id} className="text-sm text-cyber-cyan">{rb.project} — {rb.title} ({rb.status})</div>
                  ))}
                  {insights.runbookUpdates.length === 0 && <div className="text-sm text-gray-400">No recent updates</div>}
                </div>
              </div>
            )}
          </div>

          {/* Architecture Monitoring */}
          <div className="bg-gray-900/30 border border-orange-500/30 p-5 rounded-lg">
            <h3 className="text-orange-400 font-orbitron mb-3 flex items-center gap-2"><Shield size={18} /> Architecture Monitoring</h3>
            {!insightsLoading && insights && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-800/50 p-3 rounded text-center"><div className="text-2xl font-bold text-cyber-green">{insights.deployments.length}</div><div className="text-xs text-gray-400">Deployments</div></div>
                  <div className="bg-gray-800/50 p-3 rounded text-center"><div className="text-2xl font-bold text-cyber-cyan">{insights.deploymentStats.meanDurationMinutes != null ? `${insights.deploymentStats.meanDurationMinutes.toFixed(1)}m` : '—'}</div><div className="text-xs text-gray-400">Avg Deploy Time</div></div>
                  <div className="bg-gray-800/50 p-3 rounded text-center"><div className="text-2xl font-bold text-yellow-400">{insights.incidents.length}</div><div className="text-xs text-gray-400">Open Incidents</div></div>
                  <div className="bg-gray-800/50 p-3 rounded text-center"><div className="text-2xl font-bold text-orange-400">{insights.degradedServices.length}</div><div className="text-xs text-gray-400">Degraded Svcs</div></div>
                </div>
                <div className="text-sm space-y-2">
                  {insights.degradedServices.map((svc) => (
                    <div key={svc.id} className="flex justify-between"><span>{svc.name}</span><span className="text-yellow-400">Degraded</span></div>
                  ))}
                  {insights.degradedServices.length === 0 && <div className="flex justify-between"><span>All Services</span><span className="text-green-400">Healthy</span></div>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default DevOpsPage;
