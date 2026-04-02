// src/modules/integrations/cicd/cicd.types.ts — CI/CD integration types (§3.3)

export interface CIPipelineConfig {
  name: string;
  trigger: "push" | "pull_request" | "manual" | "schedule";
  branch: string;
  steps: CIStep[];
}

export interface CIStep {
  name: string;
  command: string;
  timeout?: number;
  env?: Record<string, string>;
}

export interface CIRunResult {
  runId: string;
  pipeline: string;
  status: "queued" | "in_progress" | "completed" | "failed" | "cancelled";
  conclusion?: "success" | "failure" | "cancelled" | "timed_out";
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  logs?: string;
}
