// src/pages/ProjectsPage.tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { GitBranch, Search } from "lucide-react";
import { listProjects, type Project } from "../api/projects";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch((e: any) => setError(e.message || "Failed to load projects"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = search.trim()
    ? projects.filter(
        (p) =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.key.toLowerCase().includes(search.toLowerCase())
      )
    : projects;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-cyber-cyan animate-pulse font-orbitron">Loading projects...</div>
      </div>
    );
  }

  return (
    <div className="text-gray-200">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-orbitron text-cyber-cyan flex items-center gap-2">
            <GitBranch size={24} /> Projects
          </h1>
          <div className="flex items-center gap-3">
            <Link to="/projects/new" className="px-4 py-2 bg-cyber-cyan text-cyber-base font-bold rounded text-sm font-orbitron hover:bg-cyber-cyan/90">+ New Project</Link>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search projects..."
                className="pl-9 pr-4 py-2 bg-gray-800 rounded border border-gray-700 text-white text-sm focus:border-cyber-cyan/50 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {error && <div className="text-cyber-red text-sm mb-4">{error}</div>}

        <div className="space-y-3">
          {filtered.map((project) => (
            <Link
              to={`/project/${project.id}`}
              key={project.id}
              className="block p-4 bg-gray-900/30 border border-gray-700 rounded-lg hover:border-cyber-cyan/40 transition"
            >
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-medium text-cyber-cyan text-lg">{project.name}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {project.key}
                    {project.type ? ` • ${project.type}` : ""}
                  </div>
                </div>
                <span className="text-xs px-2 py-1 bg-cyber-green/20 text-cyber-green rounded">
                  {project.status}
                </span>
              </div>
              {project.description && (
                <div className="text-sm text-gray-400 mt-2">{project.description}</div>
              )}
              <div className="flex gap-4 mt-2 text-xs text-gray-500">
                {project.owner && <span>Owner: {project.owner.email}</span>}
                {project._count && (
                  <>
                    <span>{project._count.services} services</span>
                    <span>{project._count.deployments} deployments</span>
                  </>
                )}
              </div>
            </Link>
          ))}
          {!loading && filtered.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              {search ? "No projects match your search." : "No projects yet. Click + New Project to get started."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
