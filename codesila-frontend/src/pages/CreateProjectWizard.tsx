// src/pages/CreateProjectWizard.tsx — Unified project creation wizard
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, Check, Package, GitBranch, Users, Terminal,
  Cloud, Loader2, Search, Plus, X, Trash2,
} from "lucide-react";
import {
  createProject,
  addProjectMembers,
  type ProjectType,
} from "../api/projects";
import {
  listIntegrations,
  listIntegrationRepos,
  listBranches,
  bindProjectIntegration,
  createRepoViaIntegration,
  type IntegrationInfo,
  type IntegrationRepo,
  type BranchInfo,
} from "../api/integrationMgmt";
import { createPipeline } from "../api/cicd";
import { createDeploymentTarget } from "../api/integrations";
import { listUsers, type AdminUser } from "../api/auth";
import { useAuth } from "../contexts/AuthContext";

/* ─── Constants ──────────────────────────────────────── */

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

const PROVIDERS = [
  "AWS_ECS", "AWS_LAMBDA", "RAILWAY", "VERCEL", "DOCKER", "KUBERNETES", "CUSTOM",
] as const;

const STEPS = [
  { key: "basics", label: "Project Basics", icon: <Package size={18} /> },
  { key: "git", label: "Git Integration", icon: <GitBranch size={18} /> },
  { key: "team", label: "Team Members", icon: <Users size={18} /> },
  { key: "pipeline", label: "Pipeline", icon: <Terminal size={18} /> },
  { key: "targets", label: "Deployment Targets", icon: <Cloud size={18} /> },
  { key: "review", label: "Review & Create", icon: <Check size={18} /> },
] as const;

const DEFAULT_PIPELINE_YAML = `stages:
  - name: build
    steps:
      - name: Install dependencies
        command: npm ci
      - name: Build
        command: npm run build

  - name: test
    steps:
      - name: Run tests
        command: npm test

  - name: deploy
    steps:
      - name: Deploy to staging
        command: echo "Deploying..."
`;

/* ─── Types ──────────────────────────────────────────── */

type TargetDraft = {
  name: string;
  environment: string;
  provider: string;
  url: string;
  region: string;
};

type TeamMemberDraft = {
  userId: string;
  email: string;
  name: string;
  role: string;
};

/* ─── Component ──────────────────────────────────────── */

const CreateProjectWizard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);

  // Step 1: Basics
  const [projectName, setProjectName] = useState("");
  const [projectKey, setProjectKey] = useState("");
  const [description, setDescription] = useState("");
  const [projectType, setProjectType] = useState<ProjectType>("API");
  const [defaultBranch, setDefaultBranch] = useState("main");

  // Step 2: Git Integration
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([]);
  const [integrationsLoading, setIntegrationsLoading] = useState(false);
  const [selectedIntegration, setSelectedIntegration] = useState<string | null>(null);
  const [gitMode, setGitMode] = useState<"connect" | "create">("connect");
  const [repos, setRepos] = useState<IntegrationRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [repoSearch, setRepoSearch] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<IntegrationRepo | null>(null);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [newRepoName, setNewRepoName] = useState("");
  const [newRepoDesc, setNewRepoDesc] = useState("");
  const [newRepoPrivate, setNewRepoPrivate] = useState(true);

  // Step 3: Team
  const [orgUsers, setOrgUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [teamMembers, setTeamMembers] = useState<TeamMemberDraft[]>([]);
  const [teamSearch, setTeamSearch] = useState("");
  const [teamRole, setTeamRole] = useState("MEMBER");

  // Step 4: Pipeline (pre-populated so a default pipeline is created)
  const [pipelineName, setPipelineName] = useState("main-ci");
  const [pipelineYaml, setPipelineYaml] = useState("");
  const [useDefaultYaml, setUseDefaultYaml] = useState(true);

  // Step 5: Deployment Targets
  const [targets, setTargets] = useState<TargetDraft[]>([]);
  const [targetForm, setTargetForm] = useState<TargetDraft>({
    name: "", environment: "STAGING", provider: "DOCKER", url: "", region: "",
  });

  // Submission
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitProgress, setSubmitProgress] = useState<string[]>([]);

  /* ─── Load integrations & users when those steps appear ── */

  useEffect(() => {
    if (currentStep === 1 && integrations.length === 0) {
      setIntegrationsLoading(true);
      listIntegrations()
        .then(setIntegrations)
        .catch(() => {})
        .finally(() => setIntegrationsLoading(false));
    }
  }, [currentStep]);

  useEffect(() => {
    if (currentStep === 2 && orgUsers.length === 0 && !usersError) {
      setUsersLoading(true);
      setUsersError("");
      listUsers()
        .then(setOrgUsers)
        .catch((e: any) => setUsersError(e.message || "Could not load users. You may not have permission to view the user list."))
        .finally(() => setUsersLoading(false));
    }
  }, [currentStep]);

  // Load repos when integration selected
  useEffect(() => {
    if (!selectedIntegration) { setRepos([]); return; }
    setReposLoading(true);
    listIntegrationRepos(selectedIntegration)
      .then(setRepos)
      .catch(() => setRepos([]))
      .finally(() => setReposLoading(false));
  }, [selectedIntegration]);

  // Load branches when repo selected
  useEffect(() => {
    if (!selectedIntegration || !selectedRepo) { setBranches([]); return; }
    const [owner, repo] = selectedRepo.fullName.split("/");
    if (!owner || !repo) return;
    setBranchesLoading(true);
    listBranches(selectedIntegration, owner, repo)
      .then((b) => {
        setBranches(b);
        if (b.length > 0 && !selectedBranch) {
          setSelectedBranch(selectedRepo.defaultBranch || b[0].name);
        }
      })
      .catch(() => setBranches([]))
      .finally(() => setBranchesLoading(false));
  }, [selectedIntegration, selectedRepo]);

  /* ─── Navigation ───────────────────────────────────────── */

  const canProceed = () => {
    if (currentStep === 0) return projectName.trim().length > 0 && projectKey.trim().length > 0;
    return true; // Steps 1-4 are all optional
  };

  const goNext = () => {
    if (currentStep < STEPS.length - 1 && canProceed()) setCurrentStep(currentStep + 1);
  };
  const goBack = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };

  /* ─── Submit ───────────────────────────────────────────── */

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError("");
    setSubmitProgress([]);

    try {
      // 1. Create project
      setSubmitProgress(["Creating project..."]);
      const memberIds = teamMembers.map((m) => m.userId);
      const proj = await createProject({
        name: projectName.trim(),
        key: projectKey.trim().toUpperCase(),
        description: description.trim() || undefined,
        type: projectType,
        defaultBranch: defaultBranch.trim() || "main",
        memberIds: memberIds.length > 0 ? memberIds : undefined,
      });

      const projectId = proj.id;

      // 2. Bind integration (if selected)
      if (selectedIntegration) {
        setSubmitProgress((p) => [...p, "Binding git integration..."]);
        if (gitMode === "create" && newRepoName.trim()) {
          const created = await createRepoViaIntegration(selectedIntegration, {
            name: newRepoName.trim(),
            description: newRepoDesc.trim() || undefined,
            isPrivate: newRepoPrivate,
            autoInit: true,
          });
          await bindProjectIntegration(projectId, selectedIntegration, {
            repository: created.fullName,
            branch: created.defaultBranch,
            cloneUrl: created.cloneUrl,
          });
        } else if (gitMode === "connect" && selectedRepo) {
          await bindProjectIntegration(projectId, selectedIntegration, {
            repository: selectedRepo.fullName,
            branch: selectedBranch || selectedRepo.defaultBranch,
            cloneUrl: selectedRepo.cloneUrl,
          });
        }
      }

      // 3. Add team members with roles
      if (teamMembers.length > 0) {
        setSubmitProgress((p) => [...p, "Adding team members..."]);
        const grouped = teamMembers.reduce<Record<string, string[]>>((acc, m) => {
          if (!acc[m.role]) acc[m.role] = [];
          acc[m.role].push(m.userId);
          return acc;
        }, {});
        for (const [role, userIds] of Object.entries(grouped)) {
          await addProjectMembers(projectId, { userIds, role });
        }
      }

      // 4. Create pipeline (if configured) — non-blocking: project succeeds even if pipeline fails
      let pipelineFailed = false;
      const yaml = useDefaultYaml ? DEFAULT_PIPELINE_YAML : pipelineYaml.trim();
      if (pipelineName.trim() && yaml) {
        setSubmitProgress((p) => [...p, "Creating pipeline..."]);
        try {
          await createPipeline(projectId, pipelineName.trim(), yaml);
        } catch (pipelineErr: any) {
          pipelineFailed = true;
          setSubmitProgress((p) => [...p, `⚠ Pipeline creation failed: ${pipelineErr.message || "Unknown error"}. You can create it later from the Pipeline Manager.`]);
        }
      }

      // 5. Create deployment targets
      if (targets.length > 0) {
        setSubmitProgress((p) => [...p, "Setting up deployment targets..."]);
        for (const t of targets) {
          await createDeploymentTarget({
            projectId,
            name: t.name,
            environment: t.environment,
            provider: t.provider,
            url: t.url || undefined,
            region: t.region || undefined,
          });
        }
      }

      if (pipelineFailed) {
        setSubmitProgress((p) => [...p, "Project created. Pipeline was NOT created — see warning above. Redirecting in 5s..."]);
        setTimeout(() => navigate(`/project/${projectId}`), 5000);
      } else {
        setSubmitProgress((p) => [...p, "Done! Redirecting..."]);
        setTimeout(() => navigate(`/project/${projectId}`), 600);
      }
    } catch (e: any) {
      setSubmitError(e.message || "Failed to create project");
    } finally {
      setSubmitting(false);
    }
  };

  /* ─── Team helpers ─────────────────────────────────────── */

  const addTeamMember = (u: AdminUser) => {
    if (teamMembers.find((m) => m.userId === u.id)) return;
    if (u.id === user?.id) return; // Can't add self (already owner)
    setTeamMembers([...teamMembers, { userId: u.id, email: u.email, name: u.email.split("@")[0], role: teamRole }]);
  };

  const removeTeamMember = (userId: string) => {
    setTeamMembers(teamMembers.filter((m) => m.userId !== userId));
  };

  /* ─── Target helpers ───────────────────────────────────── */

  const addTarget = () => {
    if (!targetForm.name.trim()) return;
    setTargets([...targets, { ...targetForm }]);
    setTargetForm({ name: "", environment: "STAGING", provider: "DOCKER", url: "", region: "" });
  };

  const removeTarget = (idx: number) => {
    setTargets(targets.filter((_, i) => i !== idx));
  };

  /* ─── Filtered repos ───────────────────────────────────── */
  const filteredRepos = repoSearch
    ? repos.filter((r) => r.fullName.toLowerCase().includes(repoSearch.toLowerCase()))
    : repos;

  const filteredUsers = teamSearch
    ? orgUsers.filter((u) =>
        u.id !== user?.id &&
        !teamMembers.find((m) => m.userId === u.id) &&
        (u.email.toLowerCase().includes(teamSearch.toLowerCase()))
      )
    : orgUsers.filter((u) => u.id !== user?.id && !teamMembers.find((m) => m.userId === u.id));

  /* ─── Render ─────────────────────────────────────────── */

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <button onClick={() => navigate(-1)} className="text-cyber-cyan hover:underline flex items-center gap-1 text-sm mb-2">
          <ArrowLeft size={14} /> Back
        </button>
        <h1 className="text-2xl font-bold font-orbitron text-cyber-cyan flex items-center gap-3">
          <Package size={28} /> Create New Project
        </h1>
        <p className="text-sm text-gray-400 mt-1">Set up everything in one place — project details, git repo, team, pipeline, and deployment targets.</p>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-1 mb-8 overflow-x-auto pb-2">
        {STEPS.map((step, idx) => (
          <div key={step.key} className="flex items-center">
            <button
              onClick={() => idx <= currentStep && setCurrentStep(idx)}
              disabled={idx > currentStep}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                idx === currentStep
                  ? "bg-cyber-cyan text-cyber-base font-orbitron"
                  : idx < currentStep
                  ? "bg-cyber-cyan/20 text-cyber-cyan cursor-pointer hover:bg-cyber-cyan/30"
                  : "bg-gray-800/50 text-gray-500 cursor-not-allowed"
              }`}
            >
              {idx < currentStep ? <Check size={16} /> : step.icon}
              <span className="hidden sm:inline">{step.label}</span>
              <span className="sm:hidden">{idx + 1}</span>
            </button>
            {idx < STEPS.length - 1 && (
              <div className={`w-6 h-0.5 mx-1 ${idx < currentStep ? "bg-cyber-cyan" : "bg-gray-700"}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step Content */}
      <div className="bg-gray-900/30 border border-cyber-cyan/30 rounded-lg p-6 min-h-[400px]">

        {/* ─── Step 1: Project Basics ───────────────────── */}
        {currentStep === 0 && (
          <div className="space-y-6">
            <h2 className="text-lg font-orbitron text-cyber-cyan flex items-center gap-2"><Package size={20} /> Project Basics</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Project Name <span className="text-cyber-red">*</span></label>
                <input
                  type="text" placeholder="My Awesome Project" value={projectName}
                  onChange={(e) => {
                    setProjectName(e.target.value);
                    // Auto-generate key from name
                    const autoKey = e.target.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").substring(0, 6);
                    if (!projectKey || projectKey === projectName.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").substring(0, 6)) {
                      setProjectKey(autoKey);
                    }
                  }}
                  className="w-full bg-gray-800 text-white p-3 rounded border border-cyber-cyan/30 focus:border-cyber-cyan focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Project Key <span className="text-cyber-red">*</span></label>
                <input
                  type="text" placeholder="PROJ" value={projectKey}
                  onChange={(e) => setProjectKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").substring(0, 10))}
                  className="w-full bg-gray-800 text-white p-3 rounded border border-cyber-cyan/30 focus:border-cyber-cyan focus:outline-none font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Description</label>
              <textarea
                placeholder="What does this project do?" value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full bg-gray-800 text-white p-3 rounded border border-cyber-cyan/30 focus:border-cyber-cyan focus:outline-none resize-none"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Project Type</label>
                <select
                  value={projectType} onChange={(e) => setProjectType(e.target.value as ProjectType)}
                  className="w-full bg-gray-800 text-white p-3 rounded border border-cyber-cyan/30 focus:border-cyber-cyan focus:outline-none"
                >
                  {PROJECT_TYPES.map((pt) => (
                    <option key={pt.value} value={pt.value}>{pt.icon} {pt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Default Branch</label>
                <input
                  type="text" placeholder="main" value={defaultBranch}
                  onChange={(e) => setDefaultBranch(e.target.value)}
                  className="w-full bg-gray-800 text-white p-3 rounded border border-cyber-cyan/30 focus:border-cyber-cyan focus:outline-none font-mono"
                />
              </div>
            </div>
          </div>
        )}

        {/* ─── Step 2: Git Integration ─────────────────── */}
        {currentStep === 1 && (
          <div className="space-y-6">
            <h2 className="text-lg font-orbitron text-cyber-cyan flex items-center gap-2"><GitBranch size={20} /> Git Integration</h2>
            <p className="text-sm text-gray-400">Choose <strong className="text-gray-300">one</strong> git provider to connect a repository. You can pick either GitHub or GitLab — not both at once. <span className="text-gray-500">(Optional — you can do this later)</span></p>

            {integrationsLoading ? (
              <div className="flex items-center gap-2 text-gray-400"><Loader2 size={16} className="animate-spin" /> Loading integrations...</div>
            ) : integrations.length === 0 ? (
              <div className="bg-gray-800/50 border border-yellow-500/30 p-4 rounded text-sm text-yellow-300">
                No integrations configured yet. Visit <button onClick={() => navigate("/integrations")} className="text-cyber-cyan underline">Integrations</button> to add a GitHub or GitLab token first, then come back here.
              </div>
            ) : (
              <>
                {/* Group integrations by type */}
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Choose a Git Provider</label>
                  <p className="text-xs text-gray-500 mb-3">Select one integration below. Picking a GitHub integration connects a GitHub repo; picking a GitLab integration connects a GitLab repo. Docker registries are listed separately.</p>

                  {/* GitHub integrations */}
                  {integrations.filter((i) => i.type === "github").length > 0 && (
                    <div className="mb-3">
                      <div className="text-xs text-gray-500 uppercase tracking-wider mb-1.5">🐙 GitHub</div>
                      <div className="flex flex-wrap gap-2">
                        {integrations.filter((i) => i.type === "github").map((integ) => (
                          <button
                            key={integ.id}
                            onClick={() => {
                              setSelectedIntegration(selectedIntegration === integ.id ? null : integ.id);
                              setSelectedRepo(null);
                              setSelectedBranch("");
                              setRepoSearch("");
                            }}
                            className={`px-4 py-2 rounded border text-sm transition-all ${
                              selectedIntegration === integ.id
                                ? "bg-cyber-cyan/20 border-cyber-cyan text-cyber-cyan"
                                : "bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500"
                            }`}
                          >
                            🐙 {integ.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* GitLab integrations */}
                  {integrations.filter((i) => i.type === "gitlab").length > 0 && (
                    <div className="mb-3">
                      <div className="text-xs text-gray-500 uppercase tracking-wider mb-1.5">🦊 GitLab</div>
                      <div className="flex flex-wrap gap-2">
                        {integrations.filter((i) => i.type === "gitlab").map((integ) => (
                          <button
                            key={integ.id}
                            onClick={() => {
                              setSelectedIntegration(selectedIntegration === integ.id ? null : integ.id);
                              setSelectedRepo(null);
                              setSelectedBranch("");
                              setRepoSearch("");
                            }}
                            className={`px-4 py-2 rounded border text-sm transition-all ${
                              selectedIntegration === integ.id
                                ? "bg-cyber-cyan/20 border-cyber-cyan text-cyber-cyan"
                                : "bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500"
                            }`}
                          >
                            🦊 {integ.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Docker Registry integrations */}
                  {integrations.filter((i) => i.type === "docker_registry").length > 0 && (
                    <div className="mb-3">
                      <div className="text-xs text-gray-500 uppercase tracking-wider mb-1.5">🐳 Docker Registry</div>
                      <div className="flex flex-wrap gap-2">
                        {integrations.filter((i) => i.type === "docker_registry").map((integ) => (
                          <button
                            key={integ.id}
                            onClick={() => {
                              setSelectedIntegration(selectedIntegration === integ.id ? null : integ.id);
                              setSelectedRepo(null);
                              setSelectedBranch("");
                              setRepoSearch("");
                            }}
                            className={`px-4 py-2 rounded border text-sm transition-all ${
                              selectedIntegration === integ.id
                                ? "bg-cyber-cyan/20 border-cyber-cyan text-cyber-cyan"
                                : "bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500"
                            }`}
                          >
                            🐳 {integ.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Show which provider is selected */}
                  {selectedIntegration && (() => {
                    const sel = integrations.find((i) => i.id === selectedIntegration);
                    return (
                      <div className="mt-2 text-sm text-cyber-cyan bg-cyber-cyan/10 border border-cyber-cyan/30 px-3 py-2 rounded">
                        Selected: <strong>{sel?.name}</strong> ({sel?.type === "github" ? "GitHub" : sel?.type === "gitlab" ? "GitLab" : "Docker Registry"})
                        {sel?.type !== "docker_registry" && " — a repo will be connected on this provider only."}
                      </div>
                    );
                  })()}
                </div>

                {selectedIntegration && integrations.find((i) => i.id === selectedIntegration)?.type !== "docker_registry" && (
                  <>
                    {/* Mode toggle */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => setGitMode("connect")}
                        className={`px-4 py-2 rounded text-sm font-medium ${gitMode === "connect" ? "bg-cyber-cyan text-cyber-base" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}
                      >
                        Connect Existing Repo
                      </button>
                      <button
                        onClick={() => setGitMode("create")}
                        className={`px-4 py-2 rounded text-sm font-medium ${gitMode === "create" ? "bg-cyber-cyan text-cyber-base" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}
                      >
                        Create New Repo
                      </button>
                    </div>

                    {gitMode === "connect" && (
                      <div className="space-y-4">
                        {/* Search repos */}
                        <div className="relative">
                          <Search size={16} className="absolute left-3 top-3 text-gray-500" />
                          <input
                            type="text" placeholder="Search repositories..." value={repoSearch}
                            onChange={(e) => setRepoSearch(e.target.value)}
                            className="w-full bg-gray-800 text-white p-3 pl-10 rounded border border-cyber-cyan/30 focus:border-cyber-cyan focus:outline-none"
                          />
                        </div>

                        {reposLoading ? (
                          <div className="flex items-center gap-2 text-gray-400"><Loader2 size={16} className="animate-spin" /> Loading repos...</div>
                        ) : (
                          <div className="max-h-48 overflow-y-auto space-y-1">
                            {filteredRepos.map((r) => (
                              <button
                                key={r.fullName}
                                onClick={() => {
                                  setSelectedRepo(r);
                                  setSelectedBranch(r.defaultBranch);
                                }}
                                className={`w-full text-left p-3 rounded text-sm transition-all ${
                                  selectedRepo?.fullName === r.fullName
                                    ? "bg-cyber-cyan/20 border border-cyber-cyan text-white"
                                    : "bg-gray-800/50 hover:bg-gray-800 text-gray-300"
                                }`}
                              >
                                <div className="font-medium">{r.fullName}</div>
                                <div className="text-xs text-gray-500">{r.isPrivate ? "🔒 Private" : "🌐 Public"} · {r.defaultBranch}</div>
                              </button>
                            ))}
                            {filteredRepos.length === 0 && !reposLoading && (
                              <div className="text-sm text-gray-500 py-2">No repositories found.</div>
                            )}
                          </div>
                        )}

                        {/* Branch selector */}
                        {selectedRepo && (
                          <div>
                            <label className="block text-sm text-gray-400 mb-1">Branch</label>
                            {branchesLoading ? (
                              <div className="flex items-center gap-2 text-gray-400 text-sm"><Loader2 size={14} className="animate-spin" /> Loading branches...</div>
                            ) : (
                              <select
                                value={selectedBranch}
                                onChange={(e) => setSelectedBranch(e.target.value)}
                                className="w-full bg-gray-800 text-white p-3 rounded border border-cyber-cyan/30 focus:border-cyber-cyan focus:outline-none"
                              >
                                {branches.map((b) => (
                                  <option key={b.name} value={b.name}>{b.name}</option>
                                ))}
                                {branches.length === 0 && <option value={selectedRepo.defaultBranch}>{selectedRepo.defaultBranch}</option>}
                              </select>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {gitMode === "create" && (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm text-gray-400 mb-1">Repository Name</label>
                          <input
                            type="text" placeholder="my-new-repo" value={newRepoName}
                            onChange={(e) => setNewRepoName(e.target.value)}
                            className="w-full bg-gray-800 text-white p-3 rounded border border-cyber-cyan/30 focus:border-cyber-cyan focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-gray-400 mb-1">Description</label>
                          <input
                            type="text" placeholder="Repository description" value={newRepoDesc}
                            onChange={(e) => setNewRepoDesc(e.target.value)}
                            className="w-full bg-gray-800 text-white p-3 rounded border border-cyber-cyan/30 focus:border-cyber-cyan focus:outline-none"
                          />
                        </div>
                        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                          <input
                            type="checkbox" checked={newRepoPrivate}
                            onChange={(e) => setNewRepoPrivate(e.target.checked)}
                            className="accent-cyber-cyan"
                          />
                          Private repository
                        </label>
                      </div>
                    )}
                  </>
                )}

                {/* Docker registry config */}
                {selectedIntegration && integrations.find((i) => i.id === selectedIntegration)?.type === "docker_registry" && (
                  <div className="bg-gray-800/50 p-4 rounded text-sm text-gray-300">
                    🐳 Docker Registry integration will be bound to this project with default settings.
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ─── Step 3: Team Members ────────────────────── */}
        {currentStep === 2 && (
          <div className="space-y-6">
            <h2 className="text-lg font-orbitron text-cyber-cyan flex items-center gap-2"><Users size={20} /> Team Members</h2>
            <p className="text-sm text-gray-400">Add team members to your project. You'll be added as the owner automatically. <span className="text-gray-500">(Optional)</span></p>

            {/* Selected members — always visible at top */}
            <div className="bg-gray-800/30 border border-cyber-cyan/20 rounded-lg p-4">
              <h3 className="text-sm font-medium text-cyber-cyan mb-3 flex items-center gap-2">
                <Users size={16} /> Project Team {teamMembers.length > 0 && <span className="text-xs bg-cyber-cyan/20 px-2 py-0.5 rounded">{teamMembers.length} added</span>}
              </h3>
              <div className="flex items-center gap-2 p-2 bg-gray-900/50 rounded text-sm mb-2">
                <span className="w-2 h-2 rounded-full bg-cyber-green"></span>
                <span className="text-gray-300">{user?.email ?? "You"}</span>
                <span className="text-xs px-2 py-0.5 rounded bg-cyber-green/20 text-cyber-green ml-auto">OWNER</span>
              </div>
              {teamMembers.length > 0 ? (
                <div className="space-y-1">
                  {teamMembers.map((m) => (
                    <div key={m.userId} className="flex items-center justify-between p-2 bg-gray-900/50 rounded text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-cyber-cyan"></span>
                        <span className="text-gray-200">{m.email}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          value={m.role}
                          onChange={(e) => setTeamMembers(teamMembers.map((tm) => tm.userId === m.userId ? { ...tm, role: e.target.value } : tm))}
                          className="bg-gray-800 text-xs text-cyber-cyan px-2 py-0.5 rounded border border-cyber-cyan/20"
                        >
                          <option value="MEMBER">MEMBER</option>
                          <option value="ADMIN">ADMIN</option>
                          <option value="VIEWER">VIEWER</option>
                        </select>
                        <button onClick={() => removeTeamMember(m.userId)} className="text-gray-500 hover:text-cyber-red transition-colors"><X size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-gray-500 mt-1">No additional members added yet. Search and add users below.</div>
              )}
            </div>

            {/* Add members section */}
            <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-300 mb-3">Add Members</h3>

              {usersError ? (
                <div className="bg-yellow-900/20 border border-yellow-500/30 p-3 rounded text-sm text-yellow-300">
                  {usersError}
                  <div className="text-xs text-gray-400 mt-1">You can add team members later from the project's Team tab.</div>
                </div>
              ) : (
                <>
                  <div className="flex gap-3 mb-3">
                    <div className="relative flex-1">
                      <Search size={16} className="absolute left-3 top-3 text-gray-500" />
                      <input
                        type="text" placeholder="Search users by email..." value={teamSearch}
                        onChange={(e) => setTeamSearch(e.target.value)}
                        className="w-full bg-gray-800 text-white p-3 pl-10 rounded border border-gray-600 focus:border-cyber-cyan focus:outline-none"
                      />
                    </div>
                    <select
                      value={teamRole} onChange={(e) => setTeamRole(e.target.value)}
                      className="bg-gray-800 text-white p-3 rounded border border-gray-600"
                    >
                      <option value="MEMBER">Member</option>
                      <option value="ADMIN">Admin</option>
                      <option value="VIEWER">Viewer</option>
                    </select>
                  </div>

                  {usersLoading ? (
                    <div className="flex items-center gap-2 text-gray-400"><Loader2 size={16} className="animate-spin" /> Loading users...</div>
                  ) : filteredUsers.length === 0 ? (
                    <div className="text-sm text-gray-500 py-2">{teamSearch ? "No users match your search." : "No additional users available to add."}</div>
                  ) : (
                    <div className="max-h-48 overflow-y-auto space-y-1 border border-gray-700/50 rounded p-1">
                      {filteredUsers.slice(0, 30).map((u) => (
                        <button
                          key={u.id}
                          onClick={() => addTeamMember(u)}
                          className="w-full text-left p-2.5 rounded text-sm bg-gray-800/50 hover:bg-gray-700 text-gray-300 flex items-center justify-between transition-colors"
                        >
                          <span>{u.email} <span className="text-gray-500 text-xs">({u.role})</span></span>
                          <span className="flex items-center gap-1 text-cyber-cyan text-xs"><Plus size={12} /> Add as {teamRole}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* ─── Step 4: Pipeline ────────────────────────── */}
        {currentStep === 3 && (
          <div className="space-y-6">
            <h2 className="text-lg font-orbitron text-cyber-cyan flex items-center gap-2"><Terminal size={20} /> Pipeline Configuration</h2>
            <p className="text-sm text-gray-400">A default CI/CD pipeline will be created. <span className="text-gray-500">Clear the name to skip.</span></p>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Pipeline Name</label>
              <input
                type="text" placeholder="e.g. main-ci" value={pipelineName}
                onChange={(e) => setPipelineName(e.target.value)}
                className="w-full bg-gray-800 text-white p-3 rounded border border-cyber-cyan/30 focus:border-cyber-cyan focus:outline-none"
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox" checked={useDefaultYaml}
                onChange={(e) => {
                  setUseDefaultYaml(e.target.checked);
                  if (e.target.checked) setPipelineYaml("");
                }}
                className="accent-cyber-cyan"
              />
              Use default pipeline template (build → test → deploy)
            </label>

            {!useDefaultYaml && (
              <div>
                <label className="block text-sm text-gray-400 mb-1">Pipeline YAML</label>
                <textarea
                  placeholder={DEFAULT_PIPELINE_YAML}
                  value={pipelineYaml}
                  onChange={(e) => setPipelineYaml(e.target.value)}
                  rows={14}
                  className="w-full bg-gray-800 text-white p-3 rounded border border-cyber-cyan/30 focus:border-cyber-cyan focus:outline-none font-mono text-sm resize-none"
                  spellCheck={false}
                />
              </div>
            )}

            {useDefaultYaml && (
              <div className="bg-gray-800/50 border border-cyber-cyan/20 rounded p-4">
                <div className="text-xs text-gray-400 mb-2">Default template preview:</div>
                <pre className="text-xs text-cyber-cyan/80 whitespace-pre font-mono overflow-x-auto">{DEFAULT_PIPELINE_YAML}</pre>
              </div>
            )}
          </div>
        )}

        {/* ─── Step 5: Deployment Targets ──────────────── */}
        {currentStep === 4 && (
          <div className="space-y-6">
            <h2 className="text-lg font-orbitron text-cyber-cyan flex items-center gap-2"><Cloud size={20} /> Deployment Targets</h2>
            <p className="text-sm text-gray-400">Configure where your project will be deployed. <span className="text-gray-500">(Optional)</span></p>

            <div className="bg-gray-800/50 border border-gray-700 rounded p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Target Name</label>
                  <input
                    type="text" placeholder="e.g. staging-server" value={targetForm.name}
                    onChange={(e) => setTargetForm({ ...targetForm, name: e.target.value })}
                    className="w-full bg-gray-800 text-white p-2 rounded border border-gray-600 focus:border-cyber-cyan focus:outline-none text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Environment</label>
                  <select
                    value={targetForm.environment}
                    onChange={(e) => setTargetForm({ ...targetForm, environment: e.target.value })}
                    className="w-full bg-gray-800 text-white p-2 rounded border border-gray-600 text-sm"
                  >
                    <option value="DEV">DEV</option>
                    <option value="STAGING">STAGING</option>
                    <option value="PROD">PROD</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Provider</label>
                  <select
                    value={targetForm.provider}
                    onChange={(e) => setTargetForm({ ...targetForm, provider: e.target.value })}
                    className="w-full bg-gray-800 text-white p-2 rounded border border-gray-600 text-sm"
                  >
                    {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">URL</label>
                  <input
                    type="text" placeholder="https://..." value={targetForm.url}
                    onChange={(e) => setTargetForm({ ...targetForm, url: e.target.value })}
                    className="w-full bg-gray-800 text-white p-2 rounded border border-gray-600 focus:border-cyber-cyan focus:outline-none text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Region</label>
                  <input
                    type="text" placeholder="us-east-1" value={targetForm.region}
                    onChange={(e) => setTargetForm({ ...targetForm, region: e.target.value })}
                    className="w-full bg-gray-800 text-white p-2 rounded border border-gray-600 focus:border-cyber-cyan focus:outline-none text-sm"
                  />
                </div>
              </div>
              <button
                onClick={addTarget}
                disabled={!targetForm.name.trim()}
                className="px-4 py-2 bg-cyber-cyan/20 text-cyber-cyan rounded text-sm font-medium hover:bg-cyber-cyan/30 disabled:opacity-50 flex items-center gap-1"
              >
                <Plus size={14} /> Add Target
              </button>
            </div>

            {/* Added targets */}
            {targets.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm text-gray-400">Configured Targets ({targets.length})</h3>
                {targets.map((t, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-gray-800/50 rounded text-sm">
                    <div>
                      <span className="text-gray-200 font-medium">{t.name}</span>
                      <span className="text-gray-500 ml-2">{t.environment} · {t.provider}</span>
                      {t.url && <span className="text-gray-500 ml-2">· {t.url}</span>}
                    </div>
                    <button onClick={() => removeTarget(idx)} className="text-gray-500 hover:text-cyber-red"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── Step 6: Review & Create ─────────────────── */}
        {currentStep === 5 && (
          <div className="space-y-6">
            <h2 className="text-lg font-orbitron text-cyber-cyan flex items-center gap-2"><Check size={20} /> Review & Create</h2>

            {/* Project Summary */}
            <div className="bg-gray-800/50 border border-cyber-cyan/20 rounded p-4 space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">{PROJECT_TYPES.find((pt) => pt.value === projectType)?.icon}</span>
                <div>
                  <div className="text-lg font-semibold text-white">{projectName}</div>
                  <div className="text-xs text-gray-400 font-mono">{projectKey} · {PROJECT_TYPES.find((pt) => pt.value === projectType)?.label} · {defaultBranch}</div>
                </div>
              </div>
              {description && <p className="text-sm text-gray-400">{description}</p>}
            </div>

            {/* Git */}
            <SummarySection
              icon={<GitBranch size={16} />}
              title="Git Integration"
              configured={!!selectedIntegration}
              details={
                selectedIntegration ? (
                  gitMode === "connect" && selectedRepo
                    ? `${integrations.find((i) => i.id === selectedIntegration)?.name} → ${selectedRepo.fullName} (${selectedBranch})`
                    : gitMode === "create" && newRepoName
                    ? `${integrations.find((i) => i.id === selectedIntegration)?.name} → Create "${newRepoName}"`
                    : integrations.find((i) => i.id === selectedIntegration)?.name ?? "Selected"
                ) : undefined
              }
            />

            {/* Team */}
            <SummarySection
              icon={<Users size={16} />}
              title="Team Members"
              configured={teamMembers.length > 0}
              details={teamMembers.length > 0 ? `${teamMembers.length} member(s): ${teamMembers.map((m) => m.email).join(", ")}` : undefined}
            />

            {/* Pipeline */}
            <SummarySection
              icon={<Terminal size={16} />}
              title="Pipeline"
              configured={!!(pipelineName && (useDefaultYaml || pipelineYaml.trim()))}
              details={pipelineName ? `"${pipelineName}" ${useDefaultYaml ? "(default template)" : "(custom YAML)"}` : undefined}
            />

            {/* Targets */}
            <SummarySection
              icon={<Cloud size={16} />}
              title="Deployment Targets"
              configured={targets.length > 0}
              details={targets.length > 0 ? targets.map((t) => `${t.name} (${t.environment})`).join(", ") : undefined}
            />

            {/* Submit */}
            {submitError && <div className="text-sm text-cyber-red bg-red-900/20 border border-cyber-red/30 p-3 rounded">{submitError}</div>}

            {submitProgress.length > 0 && (
              <div className="space-y-1">
                {submitProgress.map((msg, i) => (
                  <div key={i} className="text-sm text-cyber-cyan flex items-center gap-2">
                    {i === submitProgress.length - 1 && submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    {msg}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation Buttons */}
      <div className="flex justify-between items-center mt-6">
        <button
          onClick={goBack}
          disabled={currentStep === 0}
          className="flex items-center gap-2 px-5 py-2.5 bg-gray-800 text-gray-300 rounded font-medium text-sm hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ArrowLeft size={16} /> Back
        </button>

        {currentStep < STEPS.length - 1 ? (
          <button
            onClick={goNext}
            disabled={!canProceed()}
            className="flex items-center gap-2 px-5 py-2.5 bg-cyber-cyan text-cyber-base rounded font-bold font-orbitron text-sm hover:bg-cyber-cyan/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next <ArrowRight size={16} />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex items-center gap-2 px-6 py-2.5 bg-cyber-green text-cyber-base rounded font-bold font-orbitron text-sm hover:bg-cyber-green/90 disabled:opacity-50"
          >
            {submitting ? <><Loader2 size={16} className="animate-spin" /> Creating...</> : <><Check size={16} /> Create Project</>}
          </button>
        )}
      </div>
    </div>
  );
};

/* ─── Summary Section Component ──────────────────────── */

function SummarySection({ icon, title, configured, details }: {
  icon: React.ReactNode;
  title: string;
  configured: boolean;
  details?: string;
}) {
  return (
    <div className={`flex items-start gap-3 p-3 rounded border ${configured ? "bg-gray-800/50 border-cyber-green/30" : "bg-gray-800/20 border-gray-700/50"}`}>
      <div className={configured ? "text-cyber-green mt-0.5" : "text-gray-500 mt-0.5"}>{icon}</div>
      <div>
        <div className={`text-sm font-medium ${configured ? "text-white" : "text-gray-500"}`}>{title}</div>
        {configured && details ? (
          <div className="text-xs text-gray-400 mt-0.5">{details}</div>
        ) : (
          <div className="text-xs text-gray-600">Skipped</div>
        )}
      </div>
      <div className="ml-auto">
        {configured ? <Check size={16} className="text-cyber-green" /> : <span className="text-xs text-gray-600">—</span>}
      </div>
    </div>
  );
}

export default CreateProjectWizard;
