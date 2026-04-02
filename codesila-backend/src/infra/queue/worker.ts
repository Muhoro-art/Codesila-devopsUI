// src/infra/queue/worker.ts — Standalone background worker entry point (§3.1.2)
// Registers all job handlers and processes the queue.

import logger from "../../config/logger";
import { registerJob } from "./index";
import { pipelineWorker } from "./workers/codegen.worker";
import { ingestJob } from "./workers/ingest.worker";
import { testWorker } from "./workers/tests.worker";

// Register all workers
registerJob("codegen", pipelineWorker);
registerJob("ingest", ingestJob);
registerJob("tests", testWorker);

logger.info("Worker process started — listening for jobs");

// Keep-alive so the process doesn't exit
setInterval(() => {
  logger.debug("Worker heartbeat");
}, 60_000);
