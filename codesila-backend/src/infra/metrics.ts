// src/infra/metrics.ts — Prometheus-compatible metrics (§2.4.3, §4.3)
import type { Request, Response, NextFunction } from "express";

// ─── Counters & histograms stored in memory ─────────────────
const httpRequestsTotal: Record<string, number> = {};
const httpRequestDuration: number[] = [];
let requestCount = 0;

/**
 * Express middleware — tracks request count and latency for Prometheus.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const key = `${req.method} ${res.statusCode}`;
    httpRequestsTotal[key] = (httpRequestsTotal[key] || 0) + 1;
    httpRequestDuration.push(durationMs);
    requestCount++;

    // Keep last 10 000 latency samples to avoid unbounded growth
    if (httpRequestDuration.length > 10_000) {
      httpRequestDuration.splice(0, httpRequestDuration.length - 10_000);
    }
  });

  next();
}

/**
 * GET /metrics — Prometheus text exposition format.
 */
export function metricsEndpoint(_req: Request, res: Response): void {
  const lines: string[] = [];

  // ── http_requests_total counter ────────────────────────────
  lines.push("# HELP http_requests_total Total HTTP requests");
  lines.push("# TYPE http_requests_total counter");
  for (const [key, count] of Object.entries(httpRequestsTotal)) {
    const [method, status] = key.split(" ");
    lines.push(`http_requests_total{method="${method}",status="${status}"} ${count}`);
  }

  // ── http_request_duration_ms summary ───────────────────────
  if (httpRequestDuration.length > 0) {
    const sorted = [...httpRequestDuration].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;

    lines.push("# HELP http_request_duration_ms HTTP request latency in ms");
    lines.push("# TYPE http_request_duration_ms summary");
    lines.push(`http_request_duration_ms{quantile="0.5"} ${p50.toFixed(2)}`);
    lines.push(`http_request_duration_ms{quantile="0.95"} ${p95.toFixed(2)}`);
    lines.push(`http_request_duration_ms{quantile="0.99"} ${p99.toFixed(2)}`);
    lines.push(`http_request_duration_ms_avg ${avg.toFixed(2)}`);
    lines.push(`http_request_duration_ms_count ${httpRequestDuration.length}`);
  }

  // ── process metrics ────────────────────────────────────────
  const mem = process.memoryUsage();
  lines.push("# HELP process_heap_bytes Node.js heap usage");
  lines.push("# TYPE process_heap_bytes gauge");
  lines.push(`process_heap_bytes ${mem.heapUsed}`);
  lines.push(`process_rss_bytes ${mem.rss}`);

  lines.push("# HELP process_uptime_seconds Process uptime");
  lines.push("# TYPE process_uptime_seconds gauge");
  lines.push(`process_uptime_seconds ${process.uptime().toFixed(0)}`);

  res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.send(lines.join("\n") + "\n");
}
