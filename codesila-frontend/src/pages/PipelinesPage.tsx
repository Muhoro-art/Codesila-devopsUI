// src/pages/PipelinesPage.tsx — Pipeline Management (§3.3, FR-03..FR-05)
import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Plus, Play, Trash2, Pencil, X, Save,
  CircleCheck, CircleX, Clock, Loader, Ban, GitBranch,
  ChevronDown, ChevronRight, Terminal
} from "lucide-react";
import Editor from "@monaco-editor/react";
import {
  listPipelines, createPipeline, updatePipeline, deletePipeline,
  listPipelineRuns, triggerPipelineRun, cancelPipelineRun,
  getRunSteps, getStepLogs, getPipelineRun,
  subscribePipelineLogs,
  type Pipeline, type PipelineRun, type RunStep,
} from "../api/cicd";
import { getProject, type Project } from "../api/projects";

/* ─── Status helpers ─────────────────────────────────────── */

function statusIcon(s: string) {
  switch (s) {
    case "SUCCESS": return <CircleCheck size={16} className="text-green-400" />;
    case "FAILURE": return <CircleX size={16} className="text-red-400" />;
    case "RUNNING": return <Loader size={16} className="text-blue-400 animate-spin" />;
    case "QUEUED": return <Clock size={16} className="text-yellow-400" />;
    case "CANCELLED": return <Ban size={16} className="text-gray-400" />;
    default: return <Clock size={16} className="text-gray-400" />;
  }
}

function statusBadge(s: string) {
  const colors: Record<string, string> = {
    SUCCESS: "bg-green-900/50 text-green-400",
    FAILURE: "bg-red-900/50 text-red-400",
    RUNNING: "bg-blue-900/50 text-blue-400",
    QUEUED: "bg-yellow-900/50 text-yellow-400",
    CANCELLED: "bg-gray-700 text-gray-400",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold ${colors[s] || "bg-gray-700 text-gray-400"}`}>
      {statusIcon(s)} {s}
    </span>
  );
}

const DEFAULT_YAML = `# Pipeline Configuration
stages:
  - name: build
    image: node:20-alpine
    commands:
      - npm ci
      - npm run build

  - name: test
    image: node:20-alpine
    commands:
      - npm test

  - name: deploy
    image: alpine:latest
    commands:
      - echo "Deploying..."
`;

/* ═══════════════════════════════════════════════════════════ */
/*  MAIN COMPONENT                                            */
/* ═══════════════════════════════════════════════════════════ */

export default function PipelinesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  // Project info
  const [project, setProject] = useState<Project | null>(null);

  // Pipeline list
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Selected pipeline
  const [selected, setSelected] = useState<Pipeline | null>(null);

  // Editor mode
  const [editorMode, setEditorMode] = useState<"view" | "create" | "edit">("view");
  const [editorName, setEditorName] = useState("");
  const [editorYaml, setEditorYaml] = useState(DEFAULT_YAML);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Runs
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [runsTotal, setRunsTotal] = useState(0);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runBranch, setRunBranch] = useState("");
  const [triggerLoading, setTriggerLoading] = useState(false);

  // Run detail / logs
  const [activeRun, setActiveRun] = useState<PipelineRun | null>(null);
  const [runSteps, setRunSteps] = useState<RunStep[]>([]);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [stepLogs, setStepLogs] = useState<Record<string, string>>({});
  const [liveLogsActive, setLiveLogsActive] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  const sseCleanupRef = useRef<(() => void) | null>(null);

  /* ─── Load project + pipelines ─────────────────────────── */

  const refreshPipelines = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError("");
    try {
      const pl = await listPipelines(projectId);
      setPipelines(pl);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    getProject(projectId).then(setProject).catch(() => {});
    refreshPipelines();
  }, [projectId, refreshPipelines]);

  /* ─── Load runs when pipeline selected ─────────────────── */

  const refreshRuns = useCallback(async (pipelineId: string) => {
    setRunsLoading(true);
    try {
      const result = await listPipelineRuns(pipelineId);
      setRuns(result.data);
      setRunsTotal(result.meta.total);
    } catch { /* ignore */ }
    setRunsLoading(false);
  }, []);

  useEffect(() => {
    if (selected) {
      refreshRuns(selected.id);
    } else {
      setRuns([]);
      setRunsTotal(0);
    }
  }, [selected, refreshRuns]);

  /* ─── Cleanup SSE on unmount ───────────────────────────── */

  useEffect(() => {
    return () => { sseCleanupRef.current?.(); };
  }, []);

  /* ─── Pipeline Actions ─────────────────────────────────── */

  const handleCreate = () => {
    setEditorMode("create");
    setEditorName("");
    setEditorYaml(DEFAULT_YAML);
    setSaveError("");
    setSelected(null);
  };

  const handleEdit = (p: Pipeline) => {
    setEditorMode("edit");
    setEditorName(p.name);
    setEditorYaml(p.config_yaml);
    setSaveError("");
    setSelected(p);
  };

  const handleSave = async () => {
    if (!projectId) return;
    setSaveLoading(true);
    setSaveError("");
    try {
      if (editorMode === "create") {
        const created = await createPipeline(projectId, editorName, editorYaml);
        await refreshPipelines();
        setSelected({ ...created, project_id: projectId, config_yaml: editorYaml, created_at: new Date().toISOString() });
        setEditorMode("view");
      } else if (editorMode === "edit" && selected) {
        await updatePipeline(selected.id, { name: editorName, config_yaml: editorYaml });
        await refreshPipelines();
        setSelected({ ...selected, name: editorName, config_yaml: editorYaml });
        setEditorMode("view");
      }
    } catch (e: any) {
      setSaveError(e.message);
    }
    setSaveLoading(false);
  };

  const handleDelete = async (p: Pipeline) => {
    if (!confirm(`Delete pipeline "${p.name}"? This cannot be undone.`)) return;
    try {
      await deletePipeline(p.id);
      if (selected?.id === p.id) { setSelected(null); setEditorMode("view"); }
      refreshPipelines();
    } catch (e: any) {
      alert(e.message);
    }
  };

  /* ─── Run Actions ──────────────────────────────────────── */

  const handleTriggerRun = async () => {
    if (!selected) return;
    setTriggerLoading(true);
    try {
      await triggerPipelineRun(selected.id, runBranch ? { branch: runBranch } : undefined);
      setRunBranch("");
      refreshRuns(selected.id);
    } catch (e: any) {
      alert(e.message);
    }
    setTriggerLoading(false);
  };

  const handleCancelRun = async (runId: string) => {
    try {
      await cancelPipelineRun(runId);
      if (selected) refreshRuns(selected.id);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleViewRun = async (run: PipelineRun) => {
    setActiveRun(run);
    setExpandedStep(null);
    setStepLogs({});
    setLiveLogsActive(false);
    sseCleanupRef.current?.();
    try {
      const steps = await getRunSteps(run.id);
      setRunSteps(steps);
    } catch { setRunSteps([]); }

    // Start live log streaming if run is still active
    if (run.status === "QUEUED" || run.status === "RUNNING") {
      setLiveLogsActive(true);
      const cleanup = subscribePipelineLogs(run.id, (event) => {
        if (event.type === "log") {
          setStepLogs((prev) => ({
            ...prev,
            [event.data.stepId]: (prev[event.data.stepId] || "") + event.data.line + "\n",
          }));
        } else if (event.type === "step_status") {
          setRunSteps((prev) =>
            prev.map((s) => (s.id === event.data.stepId ? { ...s, status: event.data.status } : s))
          );
        } else if (event.type === "run_status") {
          setActiveRun((prev) => prev ? { ...prev, status: event.data.status } : prev);
          if (event.data.status === "SUCCESS" || event.data.status === "FAILURE" || event.data.status === "CANCELLED") {
            setLiveLogsActive(false);
          }
        } else if (event.type === "done") {
          setLiveLogsActive(false);
        }
      });
      sseCleanupRef.current = cleanup;
    }
  };

  const handleLoadStepLogs = async (step: RunStep) => {
    if (expandedStep === step.id) { setExpandedStep(null); return; }
    setExpandedStep(step.id);
    if (stepLogs[step.id]) return; // already loaded
    try {
      const logs = await getStepLogs(activeRun!.id, step.id);
      setStepLogs((prev) => ({ ...prev, [step.id]: logs.logs }));
    } catch { setStepLogs((prev) => ({ ...prev, [step.id]: "(Failed to load logs)" })); }
  };

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [stepLogs, expandedStep]);

  // Poll active runs for status updates
  useEffect(() => {
    if (!activeRun || (activeRun.status !== "QUEUED" && activeRun.status !== "RUNNING")) return;
    const interval = setInterval(async () => {
      try {
        const updated = await getPipelineRun(activeRun.id);
        setActiveRun(updated);
        const steps = await getRunSteps(activeRun.id);
        setRunSteps(steps);
        if (updated.status !== "QUEUED" && updated.status !== "RUNNING") {
          if (selected) refreshRuns(selected.id);
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(interval);
  }, [activeRun, selected, refreshRuns]);

  /* ─── Render ───────────────────────────────────────────── */

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(projectId ? `/project/${projectId}` : "/projects")} className="p-2 rounded hover:bg-gray-800 text-cyber-cyan">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h2 className="text-2xl font-orbitron text-cyber-cyan">Pipelines</h2>
          {project && <p className="text-sm text-gray-400">{project.name} ({project.key})</p>}
        </div>
      </div>

      {error && <div className="text-cyber-red text-sm mb-4">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
        {/* ═══ LEFT: Pipeline List ═══ */}
        <div className="space-y-3">
          <button onClick={handleCreate} className="w-full flex items-center justify-center gap-2 py-2 bg-cyber-cyan text-cyber-base font-bold rounded hover:bg-cyber-cyan/80 transition">
            <Plus size={16} /> New Pipeline
          </button>

          {loading && <div className="text-gray-400 text-sm animate-pulse">Loading pipelines...</div>}
          {!loading && error && <div className="text-red-400 text-sm bg-red-900/20 border border-red-500/30 p-3 rounded">{error}</div>}
          {!loading && !error && pipelines.length === 0 && <div className="text-gray-500 text-sm">No pipelines yet. Create one to get started.</div>}

          {pipelines.map((p) => (
            <div
              key={p.id}
              onClick={() => { setSelected(p); setEditorMode("view"); setActiveRun(null); }}
              className={`p-3 rounded cursor-pointer border transition ${
                selected?.id === p.id
                  ? "bg-cyber-cyan/10 border-cyber-cyan/40"
                  : "bg-gray-900/30 border-gray-700 hover:border-gray-500"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm truncate">{p.name}</span>
                <div className="flex items-center gap-1">
                  <button onClick={(e) => { e.stopPropagation(); handleEdit(p); }} className="p-1 hover:bg-gray-700 rounded" title="Edit">
                    <Pencil size={14} className="text-gray-400" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(p); }} className="p-1 hover:bg-gray-700 rounded" title="Delete">
                    <Trash2 size={14} className="text-red-400" />
                  </button>
                </div>
              </div>
              <div className="text-xs text-gray-500 mt-1">Created {new Date(p.created_at).toLocaleDateString()}</div>
            </div>
          ))}
        </div>

        {/* ═══ RIGHT: Content Area ═══ */}
        <div className="space-y-6">
          {/* ─── Create/Edit Mode: YAML Editor ─── */}
          {(editorMode === "create" || editorMode === "edit") && (
            <div className="bg-gray-900/30 border border-cyber-cyan/30 rounded-lg overflow-hidden">
              <div className="p-4 border-b border-gray-700 flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1">
                  <h3 className="text-cyber-cyan font-orbitron text-sm">
                    {editorMode === "create" ? "New Pipeline" : `Edit: ${selected?.name}`}
                  </h3>
                  <input
                    value={editorName}
                    onChange={(e) => setEditorName(e.target.value)}
                    placeholder="Pipeline name"
                    className="flex-1 max-w-xs bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:border-cyber-cyan focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => { setEditorMode("view"); setSaveError(""); }} className="p-2 hover:bg-gray-700 rounded text-gray-400">
                    <X size={16} />
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saveLoading || !editorName.trim() || !editorYaml.trim()}
                    className="flex items-center gap-1 px-4 py-1.5 bg-cyber-green text-cyber-base font-bold rounded text-sm hover:opacity-90 disabled:opacity-50"
                  >
                    <Save size={14} /> {saveLoading ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
              {saveError && <div className="px-4 py-2 text-cyber-red text-sm bg-red-900/10">{saveError}</div>}
              <div className="h-[500px]">
                <Editor
                  height="100%"
                  language="yaml"
                  theme="vs-dark"
                  value={editorYaml}
                  onChange={(v) => setEditorYaml(v || "")}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 14,
                    lineNumbers: "on",
                    scrollBeyondLastLine: false,
                    wordWrap: "on",
                    tabSize: 2,
                    automaticLayout: true,
                  }}
                />
              </div>
            </div>
          )}

          {/* ─── View Mode: Selected Pipeline ─── */}
          {editorMode === "view" && selected && !activeRun && (
            <>
              {/* Pipeline Info + Trigger */}
              <div className="bg-gray-900/30 border border-cyber-cyan/30 p-5 rounded-lg">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-orbitron text-cyber-cyan">{selected.name}</h3>
                  <button onClick={() => handleEdit(selected)} className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-600 rounded text-gray-300 hover:bg-gray-800">
                    <Pencil size={14} /> Edit YAML
                  </button>
                </div>

                {/* YAML Preview (read only) */}
                <div className="h-[200px] mb-4 rounded overflow-hidden border border-gray-700">
                  <Editor
                    height="100%"
                    language="yaml"
                    theme="vs-dark"
                    value={selected.config_yaml}
                    options={{
                      readOnly: true,
                      minimap: { enabled: false },
                      fontSize: 13,
                      lineNumbers: "on",
                      scrollBeyondLastLine: false,
                      wordWrap: "on",
                      tabSize: 2,
                    }}
                  />
                </div>

                {/* Trigger Run */}
                <div className="flex items-center gap-3">
                  <input
                    value={runBranch}
                    onChange={(e) => setRunBranch(e.target.value)}
                    placeholder="Branch (optional, e.g. main)"
                    className="flex-1 max-w-xs bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white focus:border-cyber-cyan focus:outline-none"
                  />
                  <button
                    onClick={handleTriggerRun}
                    disabled={triggerLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-cyber-green text-cyber-base font-bold rounded hover:opacity-90 disabled:opacity-50"
                  >
                    <Play size={16} /> {triggerLoading ? "Starting..." : "Run Pipeline"}
                  </button>
                </div>
              </div>

              {/* Run History */}
              <div className="bg-gray-900/30 border border-gray-700 p-5 rounded-lg">
                <h3 className="text-cyber-cyan font-orbitron text-sm mb-3">Run History ({runsTotal})</h3>
                {runsLoading && <div className="text-gray-400 text-sm animate-pulse">Loading runs...</div>}
                {!runsLoading && runs.length === 0 && <div className="text-gray-500 text-sm">No runs yet. Click "Run Pipeline" to start.</div>}
                <div className="space-y-2">
                  {runs.map((run) => (
                    <div
                      key={run.id}
                      onClick={() => handleViewRun(run)}
                      className="flex items-center justify-between p-3 bg-gray-800/50 rounded cursor-pointer hover:bg-gray-800/80 transition"
                    >
                      <div className="flex items-center gap-3">
                        {statusBadge(run.status)}
                        <div>
                          <div className="text-sm font-medium">{run.id.slice(0, 8)}</div>
                          <div className="text-xs text-gray-400">
                            {run.branch && <><GitBranch size={10} className="inline mr-1" />{run.branch} · </>}
                            {new Date(run.created_at).toLocaleString()}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {(run.status === "QUEUED" || run.status === "RUNNING") && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCancelRun(run.id); }}
                            className="px-2 py-1 text-xs border border-red-500/40 text-red-400 rounded hover:bg-red-900/30"
                          >
                            Cancel
                          </button>
                        )}
                        <ChevronRight size={16} className="text-gray-500" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ─── Run Detail: Steps + Logs ─── */}
          {activeRun && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <button onClick={() => setActiveRun(null)} className="p-2 rounded hover:bg-gray-800 text-cyber-cyan">
                  <ArrowLeft size={18} />
                </button>
                <div>
                  <h3 className="text-lg font-orbitron text-cyber-cyan flex items-center gap-2">
                    Run {activeRun.id.slice(0, 8)} {statusBadge(activeRun.status)}
                  </h3>
                  <p className="text-xs text-gray-400">
                    {activeRun.branch && <><GitBranch size={10} className="inline mr-1" />{activeRun.branch} · </>}
                    Started {activeRun.started_at ? new Date(activeRun.started_at).toLocaleString() : "pending"}
                    {activeRun.finished_at && <> · Finished {new Date(activeRun.finished_at).toLocaleString()}</>}
                  </p>
                </div>
                {liveLogsActive && (
                  <span className="ml-auto flex items-center gap-1 text-xs text-blue-400">
                    <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" /> Live
                  </span>
                )}
                {(activeRun.status === "QUEUED" || activeRun.status === "RUNNING") && (
                  <button
                    onClick={() => handleCancelRun(activeRun.id)}
                    className="ml-auto px-3 py-1.5 text-sm border border-red-500/40 text-red-400 rounded hover:bg-red-900/30"
                  >
                    Cancel Run
                  </button>
                )}
              </div>

              {/* Steps */}
              <div className="bg-gray-900/30 border border-gray-700 rounded-lg overflow-hidden">
                <div className="p-3 border-b border-gray-700">
                  <h4 className="text-sm font-orbitron text-cyber-cyan flex items-center gap-2"><Terminal size={16} /> Pipeline Steps</h4>
                </div>
                {runSteps.length === 0 && <div className="p-4 text-gray-500 text-sm">No steps recorded yet.</div>}
                {runSteps.map((step) => (
                  <div key={step.id} className="border-b border-gray-800 last:border-0">
                    <button
                      onClick={() => handleLoadStepLogs(step)}
                      className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-800/30 transition text-left"
                    >
                      <div className="flex items-center gap-3">
                        {statusIcon(step.status)}
                        <span className="text-sm font-medium">{step.name}</span>
                        <span className="text-xs text-gray-500">{step.status}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        {step.started_at && step.finished_at && (
                          <span>{((new Date(step.finished_at).getTime() - new Date(step.started_at).getTime()) / 1000).toFixed(1)}s</span>
                        )}
                        {expandedStep === step.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </div>
                    </button>
                    {expandedStep === step.id && (
                      <pre
                        ref={logRef}
                        className="px-4 py-3 bg-black/60 text-green-300 text-xs font-mono overflow-auto max-h-[400px] whitespace-pre-wrap"
                      >
                        {stepLogs[step.id] || "(No logs available)"}
                        {liveLogsActive && step.status === "RUNNING" && (
                          <span className="animate-pulse text-blue-400">▌</span>
                        )}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─── Empty State ─── */}
          {editorMode === "view" && !selected && !activeRun && (
            <div className="flex flex-col items-center justify-center py-20 text-gray-500">
              <Terminal size={48} className="mb-4 text-gray-600" />
              <p className="text-lg font-orbitron mb-2">Pipeline Management</p>
              <p className="text-sm">
                {pipelines.length === 0
                  ? "Create your first pipeline to define CI/CD workflows with YAML."
                  : "Select a pipeline from the list to view its configuration and run history."
                }
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
