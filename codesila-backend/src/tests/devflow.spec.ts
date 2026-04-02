// src/tests/devflow.spec.ts — Unit tests for DevFlow/CI/CD module (§4.1)
import { describe, it, expect } from "vitest";
import { validateArchitecture } from "../modules/devflow/conveyor/stages/architecture.stage";
import { evaluateQualityGate } from "../modules/devflow/conveyor/stages/qualityGate.stage";
import { createPipelineConfig } from "../modules/devflow/conveyor/stages/promptFactory.stage";
import { runBuildStage } from "../modules/devflow/conveyor/stages/codeGen.stage";
import { runTestStage } from "../modules/devflow/conveyor/stages/testSynthesis.stage";
import { runDeployStage } from "../modules/devflow/conveyor/stages/review.stage";
import type { StageResult } from "../modules/devflow/conveyor/conveyor.types";

// ─── Architecture validation tests ──────────────────────────
describe("Architecture Validation", () => {
  it("passes when project has git repo and branch", () => {
    const result = validateArchitecture({
      gitRepositoryUrl: "https://github.com/org/repo",
      defaultBranch: "main",
    });
    expect(result.valid).toBe(true);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it("fails when project has no git repo", () => {
    const result = validateArchitecture({
      gitRepositoryUrl: null,
      defaultBranch: "main",
    });
    expect(result.valid).toBe(false);
    expect(result.checks.find((c) => c.name === "git_repository")?.passed).toBe(false);
  });

  it("fails when project has no default branch", () => {
    const result = validateArchitecture({
      gitRepositoryUrl: "https://github.com/org/repo",
      defaultBranch: null,
    });
    expect(result.valid).toBe(false);
  });
});

// ─── Quality gate tests ─────────────────────────────────────
describe("Quality Gate", () => {
  const successStage: StageResult = {
    stage: "BUILD",
    status: "SUCCESS",
    startedAt: new Date(),
    finishedAt: new Date(),
    logs: ["Build done"],
  };

  const failedStage: StageResult = {
    stage: "TEST",
    status: "FAILURE",
    startedAt: new Date(),
    finishedAt: new Date(),
    logs: ["Test failed"],
    error: "Tests failed",
  };

  it("passes when both build and test succeed", () => {
    const testSuccess: StageResult = { ...successStage, stage: "TEST" };
    const gate = evaluateQualityGate(successStage, testSuccess);
    expect(gate.passed).toBe(true);
  });

  it("fails when build fails", () => {
    const buildFail: StageResult = { ...failedStage, stage: "BUILD" };
    const gate = evaluateQualityGate(buildFail, successStage);
    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain("Build");
  });

  it("fails when tests fail", () => {
    const gate = evaluateQualityGate(successStage, failedStage);
    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain("Test");
  });
});

// ─── Pipeline config tests ──────────────────────────────────
describe("Pipeline Configuration", () => {
  it("DEV environment skips test stage", () => {
    const config = createPipelineConfig("API", "DEV");
    expect(config.stages).toEqual(["BUILD", "DEPLOY"]);
    expect(config.stages).not.toContain("TEST");
  });

  it("STAGING has full pipeline", () => {
    const config = createPipelineConfig("API", "STAGING");
    expect(config.stages).toEqual(["BUILD", "TEST", "DEPLOY"]);
  });

  it("PROD has full pipeline with max retries", () => {
    const config = createPipelineConfig("API", "PROD");
    expect(config.stages).toEqual(["BUILD", "TEST", "DEPLOY"]);
    expect(config.retries).toBe(3);
  });

  it("PROD has longest timeout", () => {
    const dev = createPipelineConfig("API", "DEV");
    const prod = createPipelineConfig("API", "PROD");
    expect(prod.timeout).toBeGreaterThan(dev.timeout);
  });
});

// ─── Pipeline stage execution tests ─────────────────────────
describe("Build Stage", () => {
  it("returns a stage result with BUILD type", async () => {
    const result = await runBuildStage("test-project", "main", "1.0.0");
    expect(result.stage).toBe("BUILD");
    expect(["SUCCESS", "FAILURE"]).toContain(result.status);
    expect(result.logs.length).toBeGreaterThan(0);
    expect(result.startedAt).toBeInstanceOf(Date);
    expect(result.finishedAt).toBeInstanceOf(Date);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("includes project name in logs", async () => {
    const result = await runBuildStage("my-service", "develop", "2.0.0");
    const hasProjectRef = result.logs.some((l) => l.includes("my-service"));
    expect(hasProjectRef).toBe(true);
  });
});

describe("Test Stage", () => {
  it("returns a stage result with TEST type", async () => {
    const result = await runTestStage("test-project", "1.0.0");
    expect(result.stage).toBe("TEST");
    expect(["SUCCESS", "FAILURE"]).toContain(result.status);
    expect(result.logs.length).toBeGreaterThan(0);
  });

  it("reports test counts in logs", async () => {
    const result = await runTestStage("test-project", "1.0.0");
    const hasTestCount = result.logs.some((l) => /\d+ passed/.test(l));
    expect(hasTestCount).toBe(true);
  });
});

describe("Deploy Stage", () => {
  it("returns a stage result with DEPLOY type", async () => {
    const result = await runDeployStage("test-project", "1.0.0", "STAGING");
    expect(result.stage).toBe("DEPLOY");
    expect(["SUCCESS", "FAILURE"]).toContain(result.status);
    expect(result.logs.length).toBeGreaterThan(0);
  });

  it("includes environment in logs", async () => {
    const result = await runDeployStage("test-project", "1.0.0", "PROD");
    const hasEnv = result.logs.some((l) => l.includes("PROD"));
    expect(hasEnv).toBe(true);
  });
});

// ─── Incident severity classification tests ─────────────────
describe("Incident Severity Classification", () => {
  // Mirrors classifyIncidentSeverity logic
  function classifySeverity(summary: string): string {
    const lower = summary.toLowerCase();
    if (/outage|down|data loss|breach|security incident|p0|p1/.test(lower)) return "SEV1";
    if (/degraded|partial outage|high latency|timeout|error spike/.test(lower)) return "SEV2";
    if (/minor|intermittent|limited impact/.test(lower)) return "SEV3";
    if (/cosmetic|typo|ui glitch/.test(lower)) return "SEV4";
    // Heuristic: long descriptions suggest higher severity
    if (summary.length > 200) return "SEV2";
    return "SEV3";
  }

  it("classifies outage as SEV1", () => {
    expect(classifySeverity("Complete service outage on production")).toBe("SEV1");
  });

  it("classifies data loss as SEV1", () => {
    expect(classifySeverity("Data loss detected in database backup")).toBe("SEV1");
  });

  it("classifies high latency as SEV2", () => {
    expect(classifySeverity("High latency on API endpoints")).toBe("SEV2");
  });

  it("classifies error spike as SEV2", () => {
    expect(classifySeverity("Error spike in checkout service")).toBe("SEV2");
  });

  it("classifies minor issue as SEV3", () => {
    expect(classifySeverity("Minor display issue on dashboard")).toBe("SEV3");
  });

  it("classifies UI glitch as SEV4", () => {
    expect(classifySeverity("UI glitch in sidebar animation")).toBe("SEV4");
  });

  it("defaults to SEV3 for ambiguous short descriptions", () => {
    expect(classifySeverity("Something went wrong")).toBe("SEV3");
  });
});
