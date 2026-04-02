// src/modules/devflow/conveyor/conveyor.routes.ts — CI/CD Pipeline API (§3.3, §3.6)

import { Router } from "express";
import { triggerPipeline, getPipelineRun, listPipelineRuns } from "./conveyor.service";
import { requirePermission } from "../../../middlewares/requirePermission";

const router = Router();

/**
 * POST /devflow/conveyor/trigger — Trigger a new CI/CD pipeline (§3.3)
 */
router.post("/trigger", requirePermission("deployment.create"), async (req, res) => {
  try {
    const user = (req as any).user;
    const { projectId, serviceId, environment, branch, version, commitSha } = req.body;

    if (!projectId || !serviceId || !environment || !branch || !version) {
      return res.status(400).json({ error: "Missing required fields: projectId, serviceId, environment, branch, version" });
    }

    const run = await triggerPipeline(user.orgId, user.id, {
      projectId,
      serviceId,
      environment,
      branch,
      version,
      commitSha,
    });

    res.status(201).json(run);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /devflow/conveyor/:id — Get pipeline run status (§3.3)
 */
router.get("/:id", (req, res) => {
  const run = getPipelineRun(req.params.id);
  if (!run) return res.status(404).json({ error: "Pipeline run not found" });
  res.json(run);
});

/**
 * GET /devflow/conveyor/project/:projectId — List pipeline runs for project
 */
router.get("/project/:projectId", (req, res) => {
  const runs = listPipelineRuns(req.params.projectId);
  res.json(runs);
});

export default router;
