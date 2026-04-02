// src/routes/cicd.routes.ts — CI/CD Pipeline API (§3.3, FR-03..FR-05)

import { Router, Request, Response } from "express";
import { requirePermission } from "../middlewares/requirePermission";
import { Actions } from "../modules/admin/rbac/permissions";
import { prisma } from "../infra/db";
import yaml from "yaml";

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────

function validatePipelineConfig(configYaml: string) {
  let parsed: any;
  try {
    parsed = yaml.parse(configYaml);
  } catch {
    return { ok: false as const, code: "YAML_PARSE_ERROR", details: [] };
  }

  const details: { field: string; message: string }[] = [];

  if (!parsed || typeof parsed !== "object") {
    return { ok: false as const, code: "INVALID_PIPELINE_CONFIG", details: [{ field: "config_yaml", message: "Config must be a YAML object" }] };
  }

  if (!Array.isArray(parsed.stages)) {
    details.push({ field: "stages", message: "stages array is required" });
  }

  if (details.length > 0) {
    return { ok: false as const, code: "INVALID_PIPELINE_CONFIG", details };
  }

  return { ok: true as const, parsed };
}

// ─── Cross-project: /api/cicd/runs/recent ────────────────────

// Recent runs across all pipelines (for DevOps dashboard overview)
router.get(
  "/cicd/runs/recent",
  requirePermission(Actions.PipelineRun),
  async (req: Request, res: Response) => {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const status = req.query.status as string | undefined;

    const where: any = {};
    if (status) where.status = status;

    const runs = await prisma.pipelineRun.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        pipeline: {
          select: { id: true, name: true, projectId: true, project: { select: { name: true, key: true } } },
        },
      },
    });

    return res.json({
      data: runs.map((r) => ({
        id: r.id,
        pipeline_id: r.pipelineId,
        pipeline_name: r.pipeline?.name ?? null,
        project_id: r.pipeline?.projectId ?? null,
        project_name: r.pipeline?.project?.name ?? null,
        project_key: r.pipeline?.project?.key ?? null,
        status: r.status,
        triggered_by: r.triggeredById,
        branch: r.branch,
        commit_sha: r.commitSha,
        created_at: r.createdAt,
        started_at: r.startedAt,
        finished_at: r.finishedAt,
      })),
    });
  }
);

// ─── Project-scoped: /api/projects/:pid/pipelines ───────────

// List pipelines for a project
router.get(
  "/projects/:pid/pipelines",
  requirePermission(Actions.PipelineRun),
  async (req: Request, res: Response) => {
    const pipelines = await prisma.pipeline.findMany({
      where: { projectId: req.params.pid },
      orderBy: { createdAt: "desc" },
    });
    return res.json({ data: pipelines });
  }
);

// Create a pipeline
router.post(
  "/projects/:pid/pipelines",
  requirePermission(Actions.PipelineManage),
  async (req: Request, res: Response) => {
    const { name, config_yaml } = req.body ?? {};
    const details: { field: string; message: string }[] = [];

    if (!name) details.push({ field: "name", message: "name is required" });
    if (!config_yaml) details.push({ field: "config_yaml", message: "config_yaml is required" });

    if (details.length > 0) {
      return res.status(400).json({ code: "VALIDATION_ERROR", details });
    }

    const validation = validatePipelineConfig(config_yaml);
    if (!validation.ok) {
      return res.status(400).json({ code: validation.code, details: validation.details });
    }

    const pipeline = await prisma.pipeline.create({
      data: {
        projectId: req.params.pid,
        name,
        configYaml: config_yaml,
        createdById: res.locals.user?.sub,
      },
    });

    return res.status(201).json({
      data: {
        id: pipeline.id,
        name: pipeline.name,
        project_id: pipeline.projectId,
        config_yaml: pipeline.configYaml,
        created_at: pipeline.createdAt,
      },
    });
  }
);

// ─── Pipeline-scoped: /api/pipelines/:id ────────────────────

// Update a pipeline
router.put(
  "/pipelines/:id",
  requirePermission(Actions.PipelineManage),
  async (req: Request, res: Response) => {
    const { name, config_yaml } = req.body ?? {};
    const existing = await prisma.pipeline.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ code: "PIPELINE_NOT_FOUND" });

    if (config_yaml) {
      const validation = validatePipelineConfig(config_yaml);
      if (!validation.ok) {
        return res.status(400).json({ code: validation.code, details: validation.details });
      }
    }

    const updated = await prisma.pipeline.update({
      where: { id: req.params.id },
      data: {
        ...(name ? { name } : {}),
        ...(config_yaml ? { configYaml: config_yaml } : {}),
      },
    });

    return res.json({
      data: {
        id: updated.id,
        name: updated.name,
        project_id: updated.projectId,
        config_yaml: updated.configYaml,
        updated_at: updated.updatedAt,
      },
    });
  }
);

// Delete a pipeline
router.delete(
  "/pipelines/:id",
  requirePermission(Actions.PipelineManage),
  async (req: Request, res: Response) => {
    const existing = await prisma.pipeline.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ code: "PIPELINE_NOT_FOUND" });

    await prisma.pipeline.delete({ where: { id: req.params.id } });
    return res.json({ ok: true });
  }
);

// ─── Pipeline Runs: /api/pipelines/:id/runs ─────────────────

// List runs for a pipeline (newest first, paginated)
router.get(
  "/pipelines/:id/runs",
  requirePermission(Actions.PipelineRun),
  async (req: Request, res: Response) => {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const skip = (page - 1) * limit;

    const [runs, total] = await Promise.all([
      prisma.pipelineRun.findMany({
        where: { pipelineId: req.params.id },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.pipelineRun.count({ where: { pipelineId: req.params.id } }),
    ]);

    return res.json({
      data: runs.map((r) => ({
        id: r.id,
        pipeline_id: r.pipelineId,
        status: r.status,
        triggered_by: r.triggeredById,
        branch: r.branch,
        commit_sha: r.commitSha,
        created_at: r.createdAt,
        started_at: r.startedAt,
        finished_at: r.finishedAt,
      })),
      meta: { total, page, limit },
    });
  }
);

// Launch a run
router.post(
  "/pipelines/:id/runs",
  requirePermission(Actions.PipelineRun),
  async (req: Request, res: Response) => {
    const pipeline = await prisma.pipeline.findUnique({ where: { id: req.params.id } });
    if (!pipeline) return res.status(404).json({ code: "PIPELINE_NOT_FOUND" });

    const { branch, commitSha } = req.body ?? {};
    const run = await prisma.pipelineRun.create({
      data: {
        pipelineId: pipeline.id,
        triggeredById: res.locals.user?.sub,
        branch: branch ?? null,
        commitSha: commitSha ?? null,
        metadata: req.body ?? {},
        status: "QUEUED",
      },
    });

    return res.status(202).json({
      data: { runId: run.id, status: run.status, pipeline_id: run.pipelineId },
    });
  }
);

// ─── Run-scoped: /api/runs/:runId ───────────────────────────

// Get a single run
router.get(
  "/runs/:runId",
  requirePermission(Actions.PipelineRun),
  async (req: Request, res: Response) => {
    const run = await prisma.pipelineRun.findUnique({ where: { id: req.params.runId } });
    if (!run) return res.status(404).json({ code: "RUN_NOT_FOUND" });

    return res.json({
      data: {
        id: run.id,
        pipeline_id: run.pipelineId,
        status: run.status,
        triggered_by: run.triggeredById,
        branch: run.branch,
        commit_sha: run.commitSha,
        created_at: run.createdAt,
        started_at: run.startedAt,
        finished_at: run.finishedAt,
      },
    });
  }
);

// Cancel a run
router.post(
  "/runs/:runId/cancel",
  requirePermission(Actions.PipelineRun),
  async (req: Request, res: Response) => {
    const run = await prisma.pipelineRun.findUnique({ where: { id: req.params.runId } });
    if (!run) return res.status(404).json({ code: "RUN_NOT_FOUND" });

    if (run.status === "SUCCESS" || run.status === "FAILURE" || run.status === "CANCELLED") {
      return res.status(409).json({ code: "RUN_ALREADY_FINISHED" });
    }

    await prisma.pipelineRun.update({
      where: { id: req.params.runId },
      data: { status: "CANCELLED", finishedAt: new Date() },
    });

    return res.json({ ok: true, status: "CANCELLED" });
  }
);

// ─── Run Steps: /api/runs/:runId/steps ──────────────────────

// List steps for a run
router.get(
  "/runs/:runId/steps",
  requirePermission(Actions.PipelineRun),
  async (req: Request, res: Response) => {
    const steps = await prisma.runStep.findMany({
      where: { runId: req.params.runId },
      orderBy: { sortOrder: "asc" },
    });

    return res.json({
      data: steps.map((s) => ({
        id: s.id,
        run_id: s.runId,
        name: s.name,
        status: s.status,
        sort_order: s.sortOrder,
        started_at: s.startedAt,
        finished_at: s.finishedAt,
      })),
    });
  }
);

// Get step logs
router.get(
  "/runs/:runId/steps/:stepId/logs",
  requirePermission(Actions.PipelineRun),
  async (req: Request, res: Response) => {
    const step = await prisma.runStep.findFirst({
      where: { id: req.params.stepId, runId: req.params.runId },
    });
    if (!step) return res.status(404).json({ code: "STEP_NOT_FOUND" });

    return res.json({
      data: { id: step.id, name: step.name, logs: step.logOutput ?? "" },
    });
  }
);

/* ─── SSE /api/runs/:runId/logs/stream — live log streaming ── */

router.get(
  "/runs/:runId/logs/stream",
  requirePermission(Actions.PipelineRun),
  async (req: Request, res: Response) => {
    const { runId } = req.params;

    // Validate run exists
    const run = await prisma.pipelineRun.findUnique({
      where: { id: runId },
      include: { steps: { orderBy: { sortOrder: "asc" } } },
    });
    if (!run) return res.status(404).json({ code: "RUN_NOT_FOUND" });

    // Set up SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Send initial state
    send("run_status", { status: run.status, runId });
    for (const step of run.steps) {
      send("step_status", { stepId: step.id, name: step.name, status: step.status });
      if (step.logOutput) {
        // Send existing logs line by line (up to 500 lines for initial load)
        const lines = step.logOutput.split("\n").slice(-500);
        for (const line of lines) {
          send("log", { stepId: step.id, line });
        }
      }
    }

    // If run is already terminal, send done and close
    if (["SUCCESS", "FAILURE", "CANCELLED"].includes(run.status)) {
      send("done", { status: run.status });
      res.end();
      return;
    }

    // Poll for updates while run is active
    let lastStepStates = new Map(
      run.steps.map((s) => [s.id, { status: s.status, logLen: (s.logOutput ?? "").length }])
    );
    let lastRunStatus = run.status;

    const pollInterval = setInterval(async () => {
      try {
        const current = await prisma.pipelineRun.findUnique({
          where: { id: runId },
          include: { steps: { orderBy: { sortOrder: "asc" } } },
        });
        if (!current) { clearInterval(pollInterval); send("done", { status: "UNKNOWN" }); res.end(); return; }

        // Check for run status change
        if (current.status !== lastRunStatus) {
          lastRunStatus = current.status;
          send("run_status", { status: current.status, runId });
        }

        // Check each step for updates
        for (const step of current.steps) {
          const prev = lastStepStates.get(step.id);
          if (!prev) {
            // New step
            send("step_status", { stepId: step.id, name: step.name, status: step.status });
            lastStepStates.set(step.id, { status: step.status, logLen: (step.logOutput ?? "").length });
            continue;
          }
          if (step.status !== prev.status) {
            send("step_status", { stepId: step.id, name: step.name, status: step.status });
            prev.status = step.status;
          }
          const logOutput = step.logOutput ?? "";
          if (logOutput.length > prev.logLen) {
            const newPart = logOutput.slice(prev.logLen);
            const newLines = newPart.split("\n");
            for (const line of newLines) {
              if (line) send("log", { stepId: step.id, line });
            }
            prev.logLen = logOutput.length;
          }
        }

        // If terminal, close stream
        if (["SUCCESS", "FAILURE", "CANCELLED"].includes(current.status)) {
          clearInterval(pollInterval);
          send("done", { status: current.status });
          res.end();
        }
      } catch {
        clearInterval(pollInterval);
        send("done", { status: "ERROR" });
        res.end();
      }
    }, 2000);

    // Clean up on client disconnect
    req.on("close", () => {
      clearInterval(pollInterval);
    });
  }
);

export default router;
