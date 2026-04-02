// src/modules/devflow/conveyor/conveyor.types.ts — CI/CD Pipeline types (§2.5.2, §3.3)

export type PipelineStage = "BUILD" | "TEST" | "DEPLOY";

export type PipelineStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILURE" | "CANCELLED";

export interface StageResult {
  stage: PipelineStage;
  status: PipelineStatus;
  startedAt: Date;
  finishedAt?: Date;
  durationMs?: number;
  logs: string[];
  error?: string;
}

export interface PipelineRun {
  id: string;
  projectId: string;
  serviceId: string;
  environment: string;
  branch: string;
  commitSha?: string;
  version: string;
  triggeredBy: string;
  status: PipelineStatus;
  stages: StageResult[];
  startedAt: Date;
  finishedAt?: Date;
  createdAt: Date;
}

export interface TriggerPipelineInput {
  projectId: string;
  serviceId: string;
  environment: string;
  branch: string;
  version: string;
  commitSha?: string;
}
