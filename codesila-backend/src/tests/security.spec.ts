// src/tests/security.spec.ts — Security test suite (§4.4)
// Tests for XSS prevention, SQL injection detection, path traversal detection,
// account lockout, progressive delay, and HTTP security headers.

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import {
  sanitizeString,
  sanitizeEmail,
  sanitizeObject,
  detectSqlInjection,
  detectPathTraversal,
  sanitizeFilename,
  sanitizeUrl,
} from "../shared/utils/sanitize";
import {
  isAccountLocked,
  recordFailedLogin,
  resetFailedAttempts,
  getProgressiveDelay,
} from "../middlewares/accountLockout";

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

// ═══════════════════════════════════════════════════════════════
// §4.4.1 — XSS Prevention (sanitizeString)
// ═══════════════════════════════════════════════════════════════
describe("XSS Prevention — sanitizeString", () => {
  it("strips <script> tags completely", () => {
    const result = sanitizeString('<script>alert("xss")</script>');
    expect(result).not.toContain("<script");
    expect(result).not.toContain("</script>");
  });

  it("strips inline event handlers", () => {
    const result = sanitizeString('<img src=x onerror="alert(1)">');
    expect(result).not.toContain("onerror");
  });

  it("strips javascript: protocol links", () => {
    const result = sanitizeString('<a href="javascript:alert(1)">click</a>');
    expect(result).not.toContain("javascript:");
  });

  it("strips <iframe> tags", () => {
    const result = sanitizeString('<iframe src="https://evil.com"></iframe>');
    expect(result).not.toContain("<iframe");
  });

  it("strips <style> tags", () => {
    const result = sanitizeString("<style>body{display:none}</style>");
    expect(result).not.toContain("<style");
  });

  it("preserves plain text", () => {
    expect(sanitizeString("Hello World")).toBe("Hello World");
  });

  it("returns empty string for non-string input", () => {
    expect(sanitizeString(42 as any)).toBe("");
  });

  it("trims whitespace", () => {
    expect(sanitizeString("  hello  ")).toBe("hello");
  });
});

// ═══════════════════════════════════════════════════════════════
// §4.4.1 — sanitizeEmail
// ═══════════════════════════════════════════════════════════════
describe("sanitizeEmail", () => {
  it("lowercases and trims email", () => {
    expect(sanitizeEmail("  Admin@Example.COM  ")).toBe("admin@example.com");
  });

  it("returns empty for non-string", () => {
    expect(sanitizeEmail(null as any)).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════
// §4.4.1 — sanitizeObject (deep sanitization)
// ═══════════════════════════════════════════════════════════════
describe("sanitizeObject", () => {
  it("sanitizes string values in an object", () => {
    const input = { name: '<script>alert("xss")</script>', age: 25 };
    const result = sanitizeObject(input);
    expect(result.name).not.toContain("<script");
    expect(result.age).toBe(25);
  });

  it("recursively sanitizes nested objects", () => {
    const input = { user: { bio: '<img onerror="hack()">' } };
    const result = sanitizeObject(input);
    expect(result.user.bio).not.toContain("onerror");
  });

  it("sanitizes arrays of strings", () => {
    const input = { tags: ["<b>bold</b>", "safe"] };
    const result = sanitizeObject(input);
    expect(result.tags[0]).not.toContain("<b>");
    expect(result.tags[1]).toBe("safe");
  });
});

// ═══════════════════════════════════════════════════════════════
// §4.4.2 — SQL Injection Detection
// ═══════════════════════════════════════════════════════════════
describe("SQL Injection Detection — detectSqlInjection", () => {
  it("detects SELECT statement", () => {
    expect(detectSqlInjection("SELECT * FROM users")).toBe(true);
  });

  it("detects UNION injection", () => {
    expect(detectSqlInjection("1 UNION SELECT password FROM users")).toBe(true);
  });

  it("detects DROP TABLE", () => {
    expect(detectSqlInjection("; DROP TABLE users")).toBe(true);
  });

  it("detects OR 1=1 tautology", () => {
    expect(detectSqlInjection("admin' OR 1=1 --")).toBe(true);
  });

  it("detects comment-based injection (--)", () => {
    expect(detectSqlInjection("admin'--")).toBe(true);
  });

  it("detects block comment (/*)", () => {
    expect(detectSqlInjection("admin' /*")).toBe(true);
  });

  it("allows normal text input", () => {
    expect(detectSqlInjection("John Doe")).toBe(false);
  });

  it("allows email-like input", () => {
    expect(detectSqlInjection("user@example.com")).toBe(false);
  });

  it("returns false for non-string", () => {
    expect(detectSqlInjection(123 as any)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// §4.4.3 — Path Traversal Detection
// ═══════════════════════════════════════════════════════════════
describe("Path Traversal Detection — detectPathTraversal", () => {
  it("detects ../", () => {
    expect(detectPathTraversal("../../etc/passwd")).toBe(true);
  });

  it("detects ..\\", () => {
    expect(detectPathTraversal("..\\..\\windows\\system32")).toBe(true);
  });

  it("detects URL-encoded traversal %2e%2e", () => {
    expect(detectPathTraversal("%2e%2e/etc/passwd")).toBe(true);
  });

  it("detects double-encoded traversal %252e%252e", () => {
    expect(detectPathTraversal("%252e%252e/etc/passwd")).toBe(true);
  });

  it("detects mixed encoding ..%2f", () => {
    expect(detectPathTraversal("..%2fetc/passwd")).toBe(true);
  });

  it("allows normal paths", () => {
    expect(detectPathTraversal("users/profile/avatar.png")).toBe(false);
  });

  it("returns false for non-string", () => {
    expect(detectPathTraversal(42 as any)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// §4.4.4 — Filename Sanitization
// ═══════════════════════════════════════════════════════════════
describe("sanitizeFilename", () => {
  it("replaces dangerous characters", () => {
    expect(sanitizeFilename("../../../etc/passwd")).not.toContain("/");
  });

  it("removes consecutive dots", () => {
    const result = sanitizeFilename("file...name.txt");
    expect(result).not.toContain("..");
  });

  it("truncates to 255 characters", () => {
    const long = "a".repeat(300) + ".txt";
    expect(sanitizeFilename(long).length).toBeLessThanOrEqual(255);
  });

  it("preserves safe filenames", () => {
    expect(sanitizeFilename("document-2024.pdf")).toBe("document-2024.pdf");
  });
});

// ═══════════════════════════════════════════════════════════════
// §4.4.5 — URL Sanitization
// ═══════════════════════════════════════════════════════════════
describe("sanitizeUrl", () => {
  it("allows https URLs", () => {
    expect(sanitizeUrl("https://example.com")).toBeTruthy();
  });

  it("allows http URLs", () => {
    expect(sanitizeUrl("http://localhost:3000")).toBeTruthy();
  });

  it("rejects javascript: protocol", () => {
    expect(sanitizeUrl("javascript:alert(1)")).toBeNull();
  });

  it("rejects data: protocol", () => {
    expect(sanitizeUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("rejects ftp: protocol", () => {
    expect(sanitizeUrl("ftp://evil.com/malware.exe")).toBeNull();
  });

  it("rejects invalid URLs", () => {
    expect(sanitizeUrl("not a url")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// §4.4.6 — Account Lockout
// ═══════════════════════════════════════════════════════════════
describe("Account Lockout", () => {
  const testId = `lockout-test-${Date.now()}`;

  beforeEach(() => {
    resetFailedAttempts(testId);
  });

  it("account is unlocked initially", () => {
    const result = isAccountLocked(testId);
    expect(result.locked).toBe(false);
  });

  it("account remains unlocked below threshold", () => {
    for (let i = 0; i < 4; i++) {
      recordFailedLogin(testId);
    }
    const result = isAccountLocked(testId);
    expect(result.locked).toBe(false);
  });

  it("locks account after 5 failed attempts", () => {
    for (let i = 0; i < 5; i++) {
      recordFailedLogin(testId);
    }
    const result = isAccountLocked(testId);
    expect(result.locked).toBe(true);
    if (result.locked) {
      expect(result.remainingMs).toBeGreaterThan(0);
    }
  });

  it("is case-insensitive for identifiers", () => {
    const upper = `LOCKTEST-CI-${Date.now()}`;
    for (let i = 0; i < 5; i++) {
      recordFailedLogin(upper);
    }
    const result = isAccountLocked(upper.toLowerCase());
    expect(result.locked).toBe(true);
  });

  it("resets state after resetFailedAttempts()", () => {
    for (let i = 0; i < 5; i++) {
      recordFailedLogin(testId);
    }
    expect(isAccountLocked(testId).locked).toBe(true);
    resetFailedAttempts(testId);
    expect(isAccountLocked(testId).locked).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// §4.4.7 — Progressive Delay
// ═══════════════════════════════════════════════════════════════
describe("Progressive Delay — getProgressiveDelay", () => {
  const delayId = `delay-test-${Date.now()}`;

  beforeEach(() => {
    resetFailedAttempts(delayId);
  });

  it("returns 0 for unknown identifiers", () => {
    expect(getProgressiveDelay(`unknown-${Date.now()}`)).toBe(0);
  });

  it("returns increasing delay with more failures", () => {
    recordFailedLogin(delayId);
    const d1 = getProgressiveDelay(delayId);

    recordFailedLogin(delayId);
    const d2 = getProgressiveDelay(delayId);

    recordFailedLogin(delayId);
    const d3 = getProgressiveDelay(delayId);

    expect(d2).toBeGreaterThan(d1);
    expect(d3).toBeGreaterThan(d2);
  });

  it("caps at 10 seconds maximum", () => {
    for (let i = 0; i < 20; i++) {
      recordFailedLogin(delayId);
    }
    expect(getProgressiveDelay(delayId)).toBeLessThanOrEqual(10_000);
  });
});

// ═══════════════════════════════════════════════════════════════
// §4.4.8 — HTTP Security Headers (integration)
// ═══════════════════════════════════════════════════════════════
describe("HTTP Security Headers", () => {
  it("includes X-Request-ID header", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-request-id"]).toBeDefined();
  });

  it("includes X-Content-Type-Options: nosniff", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("includes X-Frame-Options: DENY", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });

  it("includes Strict-Transport-Security header", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["strict-transport-security"]).toBeDefined();
  });

  it("does not expose X-Powered-By", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("includes Content-Security-Policy header", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["content-security-policy"]).toBeDefined();
  });

  it("includes Referrer-Policy header", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["referrer-policy"]).toBeDefined();
  });

  it("includes X-DNS-Prefetch-Control header", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-dns-prefetch-control"]).toBe("off");
  });
});

// ═══════════════════════════════════════════════════════════════
// §4.4.9 — Input Protection Middleware (SQLi / path traversal)
// ═══════════════════════════════════════════════════════════════
describe("Input Protection Middleware", () => {
  it("rejects SQL injection in request body", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "admin' OR 1=1 --", password: "test" });
    expect(res.status).toBe(400);
  });

  it("rejects path traversal in request body", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "../../etc/passwd", password: "test" });
    expect(res.status).toBe(400);
  });

  it("allows legitimate request body", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "user@example.com", password: "ValidPass123" });
    // Should not be blocked by input protection (may fail auth but not 400 from WAF)
    expect(res.status).not.toBe(400);
  });
});
