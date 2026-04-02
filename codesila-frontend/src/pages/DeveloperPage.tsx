// src/pages/DeveloperPage.tsx
import { useState, useEffect } from 'react';
import { Link } from "react-router-dom";
import { Play, GitBranch, Clock, BarChart, Activity, Terminal } from 'lucide-react';
import {
  listAuditEvents,
  listDeployments,
  getInsights,
  listProjects,
  createDeployment,
  listServices,
  type AuditEvent,
  type Deployment,
  type InsightSnapshot,
  type ProjectSummary,
  type Service,
} from "../api/devflow";

const DeveloperPage = () => {

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState("");
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [deploymentsLoading, setDeploymentsLoading] = useState(false);
  const [deploymentsError, setDeploymentsError] = useState("");
  const [insights, setInsights] = useState<InsightSnapshot | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState("");
  const [services, setServices] = useState<Service[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [deployVersion, setDeployVersion] = useState("");
  const [deployEnv, setDeployEnv] = useState("DEV");
  const [deployLoading, setDeployLoading] = useState(false);

  const formatAuditLabel = (event: AuditEvent) => {
    const id = event.entityId ? `:${event.entityId}` : "";
    return `${event.action} ${event.entityType}${id}`.trim();
  };

  const formatDuration = (dep: Deployment) => {
    if (!dep.startedAt) return "—";
    const start = new Date(dep.startedAt).getTime();
    const end = dep.finishedAt ? new Date(dep.finishedAt).getTime() : Date.now();
    const diffMs = end - start;
    const mins = Math.floor(diffMs / 60000);
    const secs = Math.floor((diffMs % 60000) / 1000);
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  useEffect(() => {
    setProjectsLoading(true);
    listProjects()
      .then((data) => {
        setProjects(data);
        if (data.length > 0 && !selectedProjectId) setSelectedProjectId(data[0].id);
      })
      .catch((e) => setProjectsError(e.message))
      .finally(() => setProjectsLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedProjectId) return;
    listServices(selectedProjectId)
      .then((data) => {
        setServices(data);
        if (data.length > 0) setSelectedServiceId(data[0].id);
      })
      .catch(() => setServices([]));
  }, [selectedProjectId]);

  const refreshDeployments = () => {
    setDeploymentsLoading(true);
    listDeployments({ limit: 10 })
      .then(setDeployments)
      .catch((e) => setDeploymentsError(e.message))
      .finally(() => setDeploymentsLoading(false));
  };

  useEffect(() => { refreshDeployments(); }, []);

  useEffect(() => {
    setInsightsLoading(true);
    getInsights({ windowDays: 7 })
      .then(setInsights)
      .catch(() => {})
      .finally(() => setInsightsLoading(false));
  }, []);

  useEffect(() => {
    setAuditLoading(true);
    listAuditEvents({ limit: 10 })
      .then(setAuditLogs)
      .catch((e) => setAuditError(e.message))
      .finally(() => setAuditLoading(false));
  }, []);

  const handleRunPipeline = async () => {
    if (!selectedProjectId || !selectedServiceId || !deployVersion.trim()) return;
    setDeployLoading(true);
    try {
      await createDeployment({
        projectId: selectedProjectId,
        serviceId: selectedServiceId,
        environment: deployEnv,
        version: deployVersion.trim(),
      });
      setDeployVersion("");
      refreshDeployments();
    } catch { /* silently handled */ }
    finally { setDeployLoading(false); }
  };

  return (
    <div>
      <h2 className="text-2xl font-orbitron text-cyber-cyan mb-6">Developer Dashboard</h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            {/* Projects */}
            <div className="bg-gray-900/30 border border-cyber-cyan/30 p-5 rounded-lg">
              <h2 className="text-cyber-cyan font-orbitron mb-3 flex items-center gap-2">
                <GitBranch size={18} /> Projects
              </h2>
              {projectsLoading && <div className="text-sm text-gray-400">Loading...</div>}
              {projectsError && <div className="text-sm text-red-400">{projectsError}</div>}
              <div className="space-y-3">
                {projects.map((proj) => (
                  <Link to={`/project/${proj.id}`} key={proj.id} className="bg-gray-800/50 p-3 rounded flex justify-between items-center hover:bg-gray-800/80 transition">
                    <div>
                      <div className="font-medium">{proj.name}</div>
                      <div className="text-xs text-gray-400">Key: {proj.key} {proj.type ? `• ${proj.type}` : ""}</div>
                      {proj.owner && <div className="text-xs text-gray-500 mt-1">Owner: {proj.owner.email}</div>}
                    </div>
                    <div className="text-right">
                      <span className="text-xs px-2 py-1 bg-cyber-green/20 text-cyber-green rounded">{proj.status || "Active"}</span>
                      {proj._count && <div className="text-xs text-gray-500 mt-1">{proj._count.services} svc • {proj._count.deployments} dep</div>}
                    </div>
                  </Link>
                ))}
                {!projectsLoading && projects.length === 0 && !projectsError && (
                  <div className="text-sm text-gray-400">No projects</div>
                )}
              </div>
            </div>

            {/* Deploy Runner */}
            <div className="bg-gray-900/30 border border-cyber-magenta/30 p-5 rounded-lg">
              <h2 className="text-cyber-magenta font-orbitron mb-3">▶️ Deploy</h2>
              <div className="space-y-3">
                <select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)} className="w-full bg-gray-800 text-white p-2 rounded border border-cyber-magenta/20">
                  <option value="">Select project</option>
                  {projects.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                </select>
                <select value={selectedServiceId} onChange={(e) => setSelectedServiceId(e.target.value)} className="w-full bg-gray-800 text-white p-2 rounded border border-cyber-magenta/20">
                  <option value="">Select service</option>
                  {services.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                </select>
                <select value={deployEnv} onChange={(e) => setDeployEnv(e.target.value)} className="w-full bg-gray-800 text-white p-2 rounded border border-cyber-magenta/20">
                  <option value="DEV">Development</option>
                  <option value="STAGING">Staging</option>
                  <option value="PROD">Production</option>
                </select>
                <input type="text" value={deployVersion} onChange={(e) => setDeployVersion(e.target.value)} placeholder="Version (e.g. v1.2.3)" className="w-full bg-gray-800 text-white p-2 rounded border border-cyber-magenta/20" />
                <button onClick={handleRunPipeline} disabled={deployLoading || !selectedProjectId || !selectedServiceId || !deployVersion.trim()} className="w-full flex items-center justify-center gap-2 bg-cyber-green text-cyber-base font-bold py-2 rounded hover:animate-pulseNeon transition disabled:opacity-50">
                  <Play size={16} /> {deployLoading ? "Deploying..." : "Run Deployment"}
                </button>
              </div>
              {deployments.length > 0 && (
                <div className="mt-4 p-3 bg-gray-800/30 rounded">
                  <div className="flex items-center justify-between text-sm">
                    <span className={deployments[0].status === 'SUCCEEDED' ? 'text-cyber-green' : deployments[0].status === 'FAILED' ? 'text-red-400' : 'text-yellow-400'}>
                      Last: {deployments[0].status}
                    </span>
                    <span className="flex items-center gap-1"><Clock size={12} /> {formatDuration(deployments[0])}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Reports from Insights */}
            <div className="bg-gray-900/30 border border-cyber-green/30 p-5 rounded-lg">
              <h2 className="text-cyber-green font-orbitron mb-3 flex items-center gap-2">
                <BarChart size={18} /> Reports & Metrics
              </h2>
              {insightsLoading && <div className="text-sm text-gray-400">Loading metrics...</div>}
              {!insightsLoading && insights && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-800/50 p-3 rounded">
                    <div className="text-xs text-gray-400 mb-1">Mean Deploy Time</div>
                    <div className="text-xl font-bold text-cyber-green">{insights.deploymentStats.meanDurationMinutes != null ? `${insights.deploymentStats.meanDurationMinutes.toFixed(1)}м` : "—"}</div>
                  </div>
                  <div className="bg-gray-800/50 p-3 rounded">
                    <div className="text-xs text-gray-400 mb-1">Deploys (7d)</div>
                    <div className="text-xl font-bold text-cyber-cyan">{insights.deployments.length}</div>
                  </div>
                  <div className="bg-gray-800/50 p-3 rounded">
                    <div className="text-xs text-gray-400 mb-1">Incidents</div>
                    <div className="text-xl font-bold text-cyber-magenta">{insights.incidents.length}</div>
                  </div>
                  <div className="bg-gray-800/50 p-3 rounded">
                    <div className="text-xs text-gray-400 mb-1">Degraded</div>
                    <div className="text-xl font-bold text-yellow-400">{insights.degradedServices.length}</div>
                  </div>
                </div>
              )}
              {!insightsLoading && !insights && <div className="text-sm text-gray-400">No data</div>}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Deployments List */}
            <div className="bg-gray-900/30 border border-cyber-magenta/30 p-5 rounded-lg">
              <h2 className="text-cyber-magenta font-orbitron mb-3">📦 Deployment Status</h2>
              {deploymentsLoading && <div className="text-sm text-gray-400">Loading...</div>}
              {deploymentsError && <div className="text-sm text-red-400">{deploymentsError}</div>}
              <div className="space-y-2 mb-4">
                {deployments.map((dep) => (
                  <div key={dep.id} className="flex justify-between items-center bg-gray-800/50 p-3 rounded hover:bg-gray-800/70 transition">
                    <div>
                      <div className="font-medium">{dep.version}</div>
                      <div className="text-xs text-gray-400">{new Date(dep.startedAt).toLocaleString()} • {dep.environment} • {formatDuration(dep)}</div>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs ${dep.status === 'SUCCEEDED' ? 'bg-cyber-green/20 text-cyber-green' : dep.status === 'FAILED' ? 'bg-red-500/20 text-red-400' : dep.status === 'IN_PROGRESS' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400'}`}>
                      {dep.status}
                    </span>
                  </div>
                ))}
                {!deploymentsLoading && deployments.length === 0 && !deploymentsError && (
                  <div className="text-sm text-gray-400">No deployments</div>
                )}
              </div>
              <div className="flex justify-between text-sm">
                <button onClick={refreshDeployments} className="text-cyber-cyan hover:text-white transition">Refresh ↻</button>
                <div className="flex items-center gap-2"><Activity size={14} /><span>Total: {deployments.length}</span></div>
              </div>
            </div>

            {/* Audit Trail */}
            <div className="bg-gray-900/30 border border-cyber-green/30 p-5 rounded-lg">
              <h2 className="text-cyber-green font-orbitron mb-3 flex items-center gap-2">
                <Terminal size={18} /> Audit & Activity
              </h2>
              <div className="h-64 overflow-y-auto space-y-2">
                {auditLoading && <div className="text-sm text-gray-400">Loading audit...</div>}
                {!auditLoading && auditError && <div className="text-sm text-red-400">{auditError}</div>}
                {!auditLoading && !auditError && auditLogs.length === 0 && <div className="text-sm text-gray-400">No audit events.</div>}
                {!auditLoading && !auditError && auditLogs.map((a) => (
                  <div key={a.id} className="flex items-center justify-between text-sm bg-gray-800/40 p-2 rounded">
                    <div>
                      <div className="font-medium">{formatAuditLabel(a)}</div>
                      <div className="text-xs text-gray-400">{a.actorId ?? "system"} • {new Date(a.createdAt).toLocaleString()}</div>
                    </div>
                    <span className="text-xs px-2 py-1 rounded bg-cyber-green/20 text-cyber-green">logged</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
    </div>
  );
};

export default DeveloperPage;
