// src/modules/devflow/conveyor/stages/architecture.stage.ts — Architecture validation (§3.3)
// Validates project structure before build.

export interface ArchitectureCheckResult {
  valid: boolean;
  checks: { name: string; passed: boolean; message: string }[];
}

/**
 * Validates that a project has the required configuration for CI/CD.
 */
export function validateArchitecture(project: {
  gitRepositoryUrl?: string | null;
  defaultBranch?: string | null;
}): ArchitectureCheckResult {
  const checks: ArchitectureCheckResult["checks"] = [];

  checks.push({
    name: "git_repository",
    passed: !!project.gitRepositoryUrl,
    message: project.gitRepositoryUrl
      ? `Repository: ${project.gitRepositoryUrl}`
      : "No Git repository linked",
  });

  checks.push({
    name: "default_branch",
    passed: !!project.defaultBranch,
    message: project.defaultBranch
      ? `Branch: ${project.defaultBranch}`
      : "No default branch configured",
  });

  return {
    valid: checks.every((c) => c.passed),
    checks,
  };
}
