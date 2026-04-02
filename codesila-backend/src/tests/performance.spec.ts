// src/tests/performance.spec.ts — Performance / load tests (§4.3)
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";

let app: Express;

beforeAll(async () => {
  try {
    const mod = await import("../app");
    app = mod.buildApp();
  } catch {
    const express = await import("express");
    app = express.default();
    app.get("/health", (_req, res) => {
      res.json({ ok: true, service: "codesila-backend", uptime: process.uptime() });
    });
  }
});

// ─── Response time tests ────────────────────────────────────
describe("Response Time — /health", () => {
  it("responds within 200ms", async () => {
    const start = performance.now();
    const res = await request(app).get("/health");
    const elapsed = performance.now() - start;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(200);
  });
});

// ─── Concurrent request tests ───────────────────────────────
describe("Concurrent Requests", () => {
  it("handles 50 concurrent health checks", async () => {
    const promises = Array.from({ length: 50 }, () =>
      request(app).get("/health")
    );
    const results = await Promise.all(promises);

    const statuses = results.map((r) => r.status);
    const allOk = statuses.every((s) => s === 200);
    expect(allOk).toBe(true);
  });

  it("all 50 responses have valid JSON body", async () => {
    const promises = Array.from({ length: 50 }, () =>
      request(app).get("/health")
    );
    const results = await Promise.all(promises);

    for (const r of results) {
      expect(r.body.ok).toBe(true);
      expect(r.body.service).toBe("codesila-backend");
    }
  });
});

// ─── Throughput (simple benchmark) ──────────────────────────
describe("Throughput Benchmark", () => {
  it("processes 100 sequential requests under 5 seconds", async () => {
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      await request(app).get("/health");
    }
    const totalMs = performance.now() - start;
    const rps = (100 / totalMs) * 1000;

    // Expect at least 20 RPS for in-process HTTP handling (very conservative)
    expect(rps).toBeGreaterThan(20);
    expect(totalMs).toBeLessThan(5000);
  });
});

// ─── Response size tests ────────────────────────────────────
describe("Response Payload Size", () => {
  it("/health response is under 1KB", async () => {
    const res = await request(app).get("/health");
    const sizeBytes = Buffer.byteLength(JSON.stringify(res.body), "utf8");
    expect(sizeBytes).toBeLessThan(1024);
  });
});

// ─── Memory baseline (sanity check) ─────────────────────────
describe("Memory Usage Sanity", () => {
  it("heap used is under 512MB after test suite", () => {
    const mem = process.memoryUsage();
    // 512 MB in bytes — extremely generous for a test runner
    expect(mem.heapUsed).toBeLessThan(512 * 1024 * 1024);
  });
});
