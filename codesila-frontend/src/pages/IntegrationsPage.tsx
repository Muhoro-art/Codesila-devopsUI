// src/pages/IntegrationsPage.tsx — Integration Management (§3.4, FR-06/FR-07)
import { type ReactNode, useState, useEffect, useCallback } from "react";
import {
  Plus, Trash2, Link2, GitBranch, Server, Eye, EyeOff,
  RefreshCw, ChevronDown, ChevronRight, Globe, Lock, ExternalLink,
} from "lucide-react";
import {
  listIntegrations, createIntegration, deleteIntegration,
  listIntegrationRepos, listBranches,
  type IntegrationInfo, type IntegrationRepo, type BranchInfo,
} from "../api/integrationMgmt";

/* ─── type icon/color ────────────────────────────────────── */

const PROVIDER_META: Record<string, { label: string; icon: ReactNode; color: string }> = {
  github: { label: "GitHub", icon: <GitBranch size={18} />, color: "text-gray-100" },
  gitlab: { label: "GitLab", icon: <GitBranch size={18} />, color: "text-orange-400" },
  docker_registry: { label: "Docker Registry", icon: <Server size={18} />, color: "text-blue-400" },
};

/* ═══════════════════════════════════════════════════════════ */

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createType, setCreateType] = useState<"github" | "gitlab" | "docker_registry">("github");
  const [createName, setCreateName] = useState("");
  const [createToken, setCreateToken] = useState("");
  const [createRegistryUrl, setCreateRegistryUrl] = useState("");
  const [createUsername, setCreateUsername] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState("");

  // Expanded integration (show repos)
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [repos, setRepos] = useState<IntegrationRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState("");

  // Branch viewer
  const [branchTarget, setBranchTarget] = useState<{ integrationId: string; owner: string; repo: string } | null>(null);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);

  /* ─── Load integrations ────────────────────────────────── */

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listIntegrations();
      setIntegrations(data);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  /* ─── Create integration ───────────────────────────────── */

  const handleCreate = async () => {
    setCreateLoading(true);
    setCreateError("");
    try {
      await createIntegration({
        type: createType,
        name: createName,
        token: createToken,
        registryUrl: createType === "docker_registry" ? createRegistryUrl : undefined,
        username: createType === "docker_registry" ? createUsername : undefined,
      });
      setShowCreate(false);
      setCreateName("");
      setCreateToken("");
      setCreateRegistryUrl("");
      setCreateUsername("");
      refresh();
    } catch (e: any) {
      setCreateError(e.message);
    }
    setCreateLoading(false);
  };

  /* ─── Delete integration ───────────────────────────────── */

  const handleDelete = async (integ: IntegrationInfo) => {
    if (!confirm(`Remove integration "${integ.name}"?`)) return;
    try {
      await deleteIntegration(integ.id);
      if (expandedId === integ.id) { setExpandedId(null); setRepos([]); }
      refresh();
    } catch (e: any) {
      alert(e.message);
    }
  };

  /* ─── Browse repos ─────────────────────────────────────── */

  const handleToggleRepos = async (integ: IntegrationInfo) => {
    if (expandedId === integ.id) { setExpandedId(null); return; }
    setExpandedId(integ.id);
    setBranchTarget(null);
    setReposLoading(true);
    setReposError("");
    try {
      const data = await listIntegrationRepos(integ.id);
      setRepos(data);
    } catch (e: any) {
      setReposError(e.message);
      setRepos([]);
    }
    setReposLoading(false);
  };

  const handleViewBranches = async (integrationId: string, repo: IntegrationRepo) => {
    const [owner, name] = repo.fullName.split("/");
    if (branchTarget?.repo === name && branchTarget?.owner === owner) { setBranchTarget(null); return; }
    setBranchTarget({ integrationId, owner, repo: name });
    setBranchesLoading(true);
    try {
      const data = await listBranches(integrationId, owner, name);
      setBranches(data);
    } catch {
      setBranches([]);
    }
    setBranchesLoading(false);
  };

  /* ─── Render ───────────────────────────────────────────── */

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-orbitron text-cyber-cyan">Integrations</h2>
          <p className="text-sm text-gray-400">Manage GitHub, GitLab, and Docker Registry connections</p>
        </div>
        <button onClick={() => { setShowCreate(true); setCreateError(""); }} className="flex items-center gap-2 px-4 py-2 bg-cyber-cyan text-cyber-base font-bold rounded hover:bg-cyber-cyan/80 transition">
          <Plus size={16} /> Add Integration
        </button>
      </div>

      {error && <div className="text-cyber-red text-sm mb-4">{error}</div>}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-cyber-cyan/30 rounded-lg w-full max-w-md p-6">
            <h3 className="text-lg font-orbitron text-cyber-cyan mb-4">New Integration</h3>

            <label className="block text-sm text-gray-400 mb-1">Provider</label>
            <select
              value={createType}
              onChange={(e) => setCreateType(e.target.value as any)}
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm mb-3 focus:border-cyber-cyan focus:outline-none"
            >
              <option value="github">GitHub (PAT)</option>
              <option value="gitlab">GitLab (PAT)</option>
              <option value="docker_registry">Docker Registry</option>
            </select>

            <label className="block text-sm text-gray-400 mb-1">Name</label>
            <input
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="e.g. My GitHub Account"
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm mb-3 focus:border-cyber-cyan focus:outline-none"
            />

            <label className="block text-sm text-gray-400 mb-1">Access Token</label>
            <div className="relative mb-3">
              <input
                type={showToken ? "text" : "password"}
                value={createToken}
                onChange={(e) => setCreateToken(e.target.value)}
                placeholder="ghp_... or glpat-..."
                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm pr-10 focus:border-cyber-cyan focus:outline-none"
              />
              <button onClick={() => setShowToken(!showToken)} className="absolute right-2 top-2 text-gray-400 hover:text-gray-200">
                {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {createType === "docker_registry" && (
              <>
                <label className="block text-sm text-gray-400 mb-1">Registry URL</label>
                <input
                  value={createRegistryUrl}
                  onChange={(e) => setCreateRegistryUrl(e.target.value)}
                  placeholder="https://registry.example.com"
                  className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm mb-3 focus:border-cyber-cyan focus:outline-none"
                />
                <label className="block text-sm text-gray-400 mb-1">Username</label>
                <input
                  value={createUsername}
                  onChange={(e) => setCreateUsername(e.target.value)}
                  placeholder="docker_user"
                  className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm mb-3 focus:border-cyber-cyan focus:outline-none"
                />
              </>
            )}

            {createError && <div className="text-cyber-red text-sm mb-3">{createError}</div>}

            <div className="flex justify-end gap-3">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm border border-gray-600 rounded text-gray-300 hover:bg-gray-800">Cancel</button>
              <button
                onClick={handleCreate}
                disabled={createLoading || !createName.trim() || !createToken.trim()}
                className="px-4 py-2 text-sm bg-cyber-cyan text-cyber-base font-bold rounded hover:bg-cyber-cyan/80 disabled:opacity-50"
              >
                {createLoading ? "Connecting..." : "Connect"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Integration List */}
      {loading && <div className="text-gray-400 text-sm animate-pulse">Loading integrations...</div>}
      {!loading && integrations.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <Link2 size={48} className="mb-4 text-gray-600" />
          <p className="text-lg font-orbitron mb-2">No Integrations</p>
          <p className="text-sm">Connect GitHub, GitLab, or Docker Registry to manage your infrastructure.</p>
        </div>
      )}

      <div className="space-y-4">
        {integrations.map((integ) => {
          const meta = PROVIDER_META[integ.type] || { label: integ.type, icon: <Link2 size={18} />, color: "text-gray-400" };
          const isExpanded = expandedId === integ.id;
          return (
            <div key={integ.id} className="bg-gray-900/30 border border-gray-700 rounded-lg overflow-hidden">
              {/* Header row */}
              <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={meta.color}>{meta.icon}</span>
                  <div>
                    <div className="font-medium">{integ.name}</div>
                    <div className="text-xs text-gray-400 flex items-center gap-2">
                      <span className="bg-gray-800 px-2 py-0.5 rounded">{meta.label}</span>
                      {integ.registryUrl && <span className="truncate max-w-[200px]">{integ.registryUrl}</span>}
                      {integ.createdAt && <span>Added {new Date(integ.createdAt).toLocaleDateString()}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {integ.type !== "docker_registry" && (
                    <button
                      onClick={() => handleToggleRepos(integ)}
                      className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-600 rounded text-gray-300 hover:bg-gray-800"
                    >
                      <RefreshCw size={14} /> Repos {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  )}
                  <button onClick={() => handleDelete(integ)} className="p-2 hover:bg-gray-700 rounded text-red-400" title="Remove">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {/* Repos panel */}
              {isExpanded && (
                <div className="border-t border-gray-700 p-4">
                  {reposLoading && <div className="text-gray-400 text-sm animate-pulse">Loading repositories...</div>}
                  {reposError && <div className="text-cyber-red text-sm">{reposError}</div>}
                  {!reposLoading && repos.length === 0 && !reposError && <div className="text-gray-500 text-sm">No repositories found.</div>}
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {repos.map((repo) => {
                      const [owner, repoName] = repo.fullName.split("/");
                      const isBranchOpen = branchTarget?.owner === owner && branchTarget?.repo === repoName;
                      return (
                        <div key={repo.fullName} className="bg-gray-800/50 rounded">
                          <div className="flex items-center justify-between p-3">
                            <div className="flex items-center gap-2">
                              {repo.isPrivate ? <Lock size={14} className="text-yellow-400" /> : <Globe size={14} className="text-green-400" />}
                              <span className="text-sm font-medium">{repo.fullName}</span>
                              <span className="text-xs text-gray-500">{repo.defaultBranch}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleViewBranches(integ.id, repo)}
                                className="flex items-center gap-1 px-2 py-1 text-xs border border-gray-600 rounded text-gray-300 hover:bg-gray-700"
                              >
                                <GitBranch size={12} /> Branches
                              </button>
                              <a href={repo.cloneUrl.replace(/\.git$/, "")} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-200">
                                <ExternalLink size={14} />
                              </a>
                            </div>
                          </div>
                          {isBranchOpen && (
                            <div className="px-3 pb-3">
                              {branchesLoading ? (
                                <div className="text-gray-400 text-xs animate-pulse">Loading branches...</div>
                              ) : branches.length === 0 ? (
                                <div className="text-gray-500 text-xs">No branches found.</div>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {branches.map((b) => (
                                    <span key={b.name} className="px-2 py-0.5 bg-gray-700 rounded text-xs text-gray-200">{b.name} <span className="text-gray-500">{b.sha.slice(0, 7)}</span></span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
