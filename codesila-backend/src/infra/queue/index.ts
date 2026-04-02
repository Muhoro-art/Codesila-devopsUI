// src/infra/queue/index.ts — Simple in-process job queue
// In production, replace with BullMQ + Redis (§2.4.3).

import logger from "../../config/logger";

type JobHandler = (payload: any) => Promise<void>;

const handlers = new Map<string, JobHandler>();
const jobQueue: { name: string; payload: any }[] = [];
let processing = false;

/**
 * Register a job handler.
 */
export function registerJob(name: string, handler: JobHandler): void {
  handlers.set(name, handler);
}

/**
 * Enqueue a job for async processing.
 */
export function enqueueJob(name: string, payload: any): void {
  jobQueue.push({ name, payload });
  processNext();
}

async function processNext(): Promise<void> {
  if (processing || jobQueue.length === 0) return;
  processing = true;

  const job = jobQueue.shift()!;
  const handler = handlers.get(job.name);

  if (!handler) {
    logger.warn({ job: job.name }, "No handler registered for job");
    processing = false;
    processNext();
    return;
  }

  try {
    await handler(job.payload);
    logger.info({ job: job.name }, "Job completed");
  } catch (err) {
    logger.error({ err, job: job.name }, "Job failed");
  }

  processing = false;
  processNext();
}
