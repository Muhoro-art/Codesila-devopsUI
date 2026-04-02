// src/pages/ManagerPage.tsx
import { useEffect, useState } from "react";
import { TrendingUp, AlertTriangle, BarChart3, FileText, Activity } from 'lucide-react';
import { Link } from "react-router-dom";
import {
  listAuditEvents,
  listDeployments,
  getInsights,
  listProjects,
  listIncidents,
  listRunbooks,
  type AuditEvent,
  type Deployment,
  type InsightSnapshot,
  type ProjectSummary,
  type Incident,
  type Runbook,
} from "../api/devflow";

const ManagerPage = () => {

  const [insights, setInsights] = useState<InsightSnapshot | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [deploymentsLoading, setDeploymentsLoading] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [incidentsLoading, setIncidentsLoading] = useState(false);
  const [runbooks, setRunbooks] = useState<Runbook[]>([]);
  const [runbooksLoading, setRunbooksLoading] = useState(false);
  const [windowDays, setWindowDays] = useState(7);
  const [selectedProjectId, setSelectedProjectId] = useState("all");

  useEffect(() => {
    setProjectsLoading(true);
    listProjects()
      .then(setProjects)
      .catch(() => {})
      .finally(() => setProjectsLoading(false));
  }, []);

  useEffect(() => {
    setInsightsLoading(true);
    getInsights({
      windowDays,
      projectId: selectedProjectId === "all" ? undefined : selectedProjectId,
    })
      .then(setInsights)
      .catch(() => {})
      .finally(() => setInsightsLoading(false));
  }, [windowDays, selectedProjectId]);

  useEffect(() => {
    setDeploymentsLoading(true);
    listDeployments({ limit: 10 })
      .then(setDeployments)
      .catch(() => {})
      .finally(() => setDeploymentsLoading(false));
  }, []);

  useEffect(() => {
    setAuditLoading(true);
    listAuditEvents({ limit: 15 })
      .then(setAuditLogs)
      .catch(() => {})
      .finally(() => setAuditLoading(false));
  }, []);

  useEffect(() => {
    setIncidentsLoading(true);
    listIncidents({ limit: 10 })
      .then(setIncidents)
      .catch(() => {})
      .finally(() => setIncidentsLoading(false));
  }, []);

  useEffect(() => {
    setRunbooksLoading(true);
    listRunbooks()
      .then(setRunbooks)
      .catch(() => {})
      .finally(() => setRunbooksLoading(false));
  }, []);

  const succeededDeploys = deployments.filter((d) => d.status === "SUCCEEDED").length;
  const failedDeploys = deployments.filter((d) => d.status === "FAILED").length;
  const deployRate = deployments.length > 0 ? Math.round((succeededDeploys / deployments.length) * 100) : 0;

  const metrics = [
    { label: 'Deployments', value: String(deployments.length), change: `${succeededDeploys} succeeded`, icon: TrendingUp, color: 'text-cyber-cyan' },
    { label: 'Failed Builds', value: String(failedDeploys), change: `of ${deployments.length}`, icon: AlertTriangle, color: 'text-cyber-red' },
    { label: 'Success Rate', value: `${deployRate}%`, change: `${windowDays}d window`, icon: BarChart3, color: 'text-cyber-green' },
  ];

  const formatAuditLabel = (event: AuditEvent) => {
    const id = event.entityId ? `:${event.entityId}` : "";
    return `${event.action} ${event.entityType}${id}`.trim();
  };

  return (
    <div>
      <h2 className="text-2xl font-orbitron text-cyber-cyan mb-6">Manager Dashboard</h2>

      {/* Metrics HUD from real data */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            {metrics.map((m, i) => {
              const Icon = m.icon;
              return (
                <div key={i} className="bg-gray-900/40 border border-cyber-cyan/20 p-4 rounded text-center">
                  <Icon className={`w-8 h-8 mx-auto mb-2 ${m.color}`} />
                  <div className="text-2xl font-orbitron">{deploymentsLoading ? "..." : m.value}</div>
                  <div className="text-sm">{m.label}</div>
                  <div className={`text-xs mt-1 ${m.color}`}>{m.change}</div>
                </div>
              );
            })}
          </div>

          {/* Insights Filter + Overview */}
          <div className="bg-gray-900/30 border border-cyber-cyan/30 p-5 rounded-lg mb-8">
            <h2 className="text-cyber-cyan font-orbitron mb-4 flex items-center gap-2">
              <BarChart3 size={20} /> Operational Insights
            </h2>
            <div className="flex flex-wrap gap-3 mb-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-gray-400">Project</span>
                <select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)} className="bg-gray-800 text-white p-2 rounded border border-cyber-cyan/30">
                  <option value="all">All projects</option>
                  {projects.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400">Window</span>
                <select value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))} className="bg-gray-800 text-white p-2 rounded border border-cyber-cyan/30">
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                </select>
              </div>
            </div>
            {insightsLoading && <div className="text-sm text-gray-400">Loading insights...</div>}
            {!insightsLoading && insights && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gray-800/50 p-3 rounded text-center">
                  <div className="text-2xl font-bold text-cyber-green">{insights.deploymentStats.meanDurationMinutes != null ? `${insights.deploymentStats.meanDurationMinutes.toFixed(1)}m` : "—"}</div>
                  <div className="text-xs text-gray-400">Mean Deploy Time</div>
                </div>
                <div className="bg-gray-800/50 p-3 rounded text-center">
                  <div className="text-2xl font-bold text-cyber-cyan">{insights.deployments.length}</div>
                  <div className="text-xs text-gray-400">Recent Deployments</div>
                </div>
                <div className="bg-gray-800/50 p-3 rounded text-center">
                  <div className="text-2xl font-bold text-yellow-400">{insights.incidents.length}</div>
                  <div className="text-xs text-gray-400">Open Incidents</div>
                </div>
                <div className="bg-gray-800/50 p-3 rounded text-center">
                  <div className="text-2xl font-bold text-orange-400">{insights.degradedServices.length}</div>
                  <div className="text-xs text-gray-400">Degraded Services</div>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Recent Deployments */}
            <div className="bg-gray-900/30 border border-cyber-magenta/30 p-5 rounded-lg">
              <h2 className="text-cyber-magenta font-orbitron mb-3 flex items-center gap-2">
                <Activity size={20} /> Recent Deployments
              </h2>
              {deploymentsLoading && <div className="text-sm text-gray-400">Loading...</div>}
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {deployments.map((dep) => (
                  <div key={dep.id} className="flex justify-between items-center p-3 bg-gray-800/50 rounded">
                    <div>
                      <div className="font-medium">{dep.version}</div>
                      <div className="text-xs text-gray-400">{dep.environment} • {new Date(dep.startedAt).toLocaleString()}</div>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs ${dep.status === 'SUCCEEDED' ? 'bg-green-900/50 text-green-400' : dep.status === 'FAILED' ? 'bg-red-900/50 text-red-400' : 'bg-yellow-900/50 text-yellow-400'}`}>
                      {dep.status}
                    </span>
                  </div>
                ))}
                {!deploymentsLoading && deployments.length === 0 && <div className="text-sm text-gray-400">No deployments yet.</div>}
              </div>
            </div>

            {/* Incidents */}
            <div className="bg-gray-900/30 border border-cyber-red/30 p-5 rounded-lg">
              <h2 className="text-cyber-red font-orbitron mb-3 flex items-center gap-2">
                <AlertTriangle size={20} /> Incidents
              </h2>
              {incidentsLoading && <div className="text-sm text-gray-400">Loading...</div>}
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {incidents.map((inc) => (
                  <div key={inc.id} className="p-3 bg-gray-800/50 rounded">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-medium">{inc.summary}</span>
                      <span className={`px-2 py-1 rounded text-xs ${inc.severity === 'SEV1' ? 'bg-red-900/50 text-red-400' : inc.severity === 'SEV2' ? 'bg-orange-900/50 text-orange-400' : 'bg-yellow-900/50 text-yellow-400'}`}>
                        {inc.severity}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400">{inc.status} • {new Date(inc.startedAt).toLocaleString()}</div>
                  </div>
                ))}
                {!incidentsLoading && incidents.length === 0 && <div className="text-sm text-gray-400">No incidents.</div>}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Projects */}
            <div className="bg-gray-900/30 border border-cyber-green/30 p-5 rounded-lg">
              <h2 className="text-cyber-green font-orbitron mb-3 flex items-center gap-2">
                <FileText size={20} /> Projects
              </h2>
              {projectsLoading && <div className="text-sm text-gray-400">Loading...</div>}
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {projects.map((proj) => (
                  <Link to={`/project/${proj.id}`} key={proj.id} className="flex justify-between items-center p-3 bg-gray-800/50 rounded hover:bg-gray-800/80 transition">
                    <div>
                      <div className="font-medium text-cyber-cyan">{proj.name}</div>
                      <div className="text-xs text-gray-400">{proj.key} {proj.type ? `• ${proj.type}` : ""}</div>
                      {proj.owner && <div className="text-xs text-gray-500 mt-1">Owner: {proj.owner.email}</div>}
                    </div>
                    <div className="text-right">
                      {proj._count && <div className="text-xs text-gray-500">{proj._count.services} svc • {proj._count.deployments} dep • {proj._count.incidents} inc</div>}
                      {proj.memberships && <div className="text-xs text-gray-500">{proj.memberships.length} team members</div>}
                    </div>
                  </Link>
                ))}
                {!projectsLoading && projects.length === 0 && <div className="text-sm text-gray-400">No projects.</div>}
              </div>
            </div>

            {/* Runbooks */}
            <div className="bg-gray-900/30 border border-cyber-purple/30 p-5 rounded-lg">
              <h2 className="text-purple-400 font-orbitron mb-3 flex items-center gap-2">
                <FileText size={20} /> Runbooks
              </h2>
              {runbooksLoading && <div className="text-sm text-gray-400">Loading...</div>}
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {runbooks.map((rb) => (
                  <div key={rb.id} className="p-3 bg-gray-800/50 rounded">
                    <div className="flex justify-between items-center">
                      <span className="font-medium">{rb.title}</span>
                      <span className={`px-2 py-1 rounded text-xs ${rb.status === 'ACTIVE' ? 'bg-green-900/50 text-green-400' : rb.status === 'DRAFT' ? 'bg-yellow-900/50 text-yellow-400' : 'bg-gray-700 text-gray-400'}`}>
                        {rb.status}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-1">v{rb.version} • {new Date(rb.updatedAt).toLocaleString()}</div>
                  </div>
                ))}
                {!runbooksLoading && runbooks.length === 0 && <div className="text-sm text-gray-400">No runbooks.</div>}
              </div>
            </div>
          </div>

          {/* Audit Trail */}
          <div className="bg-gray-900/30 border border-cyber-cyan/30 p-5 rounded-lg mt-8">
            <h2 className="text-cyber-cyan font-orbitron mb-3">📊 Audit Trail</h2>
            {auditLoading && <div className="text-sm text-gray-400">Loading audit events...</div>}
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {auditLogs.map((log) => (
                <div key={log.id} className="flex justify-between items-center p-2 bg-gray-800/40 rounded text-sm">
                  <div>
                    <span className="font-medium">{formatAuditLabel(log)}</span>
                    <span className="text-xs text-gray-400 ml-2">{log.actorId ?? "system"}</span>
                  </div>
                  <span className="text-xs text-gray-400">{new Date(log.createdAt).toLocaleString()}</span>
                </div>
              ))}
              {!auditLoading && auditLogs.length === 0 && <div className="text-sm text-gray-400">No audit events.</div>}
            </div>
          </div>
    </div>
  );
};

export default ManagerPage;
