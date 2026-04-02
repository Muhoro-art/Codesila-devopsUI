/**
 * API Standards Integration Tests — TC-API-01 through TC-API-09
 *
 * Verify response envelope format, security headers, content-type
 * enforcement, UUID validation, rate limiting, health check, and
 * 404 handling against the real Express app with PostgreSQL.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { authRateLimitStore } from "../middlewares/rateLimit";
import { seedRbacTables } from "../modules/admin/rbac/rbac.service";

const prisma = new PrismaClient();

const TEST_ORG_ID = "org_test_api_standards";
const PASS = "Str0ng!Pass@2026xZ";

let app: Express;
let jwtSecret: string;
let adminUser: { id: string; token: string };

function signToken(userId: string, role: string, email: string): string {
  return jwt.sign(
    { sub: userId, role, orgId: TEST_ORG_ID, email, type: "access" },
    jwtSecret,
    { algorithm: "HS256", issuer: "codesila-api", audience: "codesila-client", expiresIn: "15m" },
  );
}

beforeEach(async () => {
  await authRateLimitStore.resetAll();
});

beforeAll(async () => {
  const mod = await import("../app");
  app = mod.buildApp();

  const { env } = await import("../config/env");
  jwtSecret = env.JWT_SECRET;

  // Seed RBAC tables
  await seedRbacTables();

  // Create test org
  await prisma.organization.upsert({
    where: { id: TEST_ORG_ID },
    update: {},
    create: { id: TEST_ORG_ID, name: "API Test Org", slug: `api-test-org-${Date.now()}` },
  });

  // Create admin user
  const hash = await bcrypt.hash(PASS, 10);
  const admin = await prisma.user.create({
    data: { email: `api-admin-${Date.now()}@test.io`, name: "API Admin", passwordHash: hash, role: "ADMIN", orgId: TEST_ORG_ID },
  });
  adminUser = { id: admin.id, token: signToken(admin.id, "ADMIN", admin.email) };
});

afterAll(async () => {
  // Clean up test data
  await prisma.user.deleteMany({ where: { orgId: TEST_ORG_ID } });
  await prisma.organization.deleteMany({ where: { id: TEST_ORG_ID } });
  await prisma.$disconnect();
});

// ═════════════════════════════════════════════════════════════
// TC-API-01  Successful responses use {success, data, meta} envelope
// ═════════════════════════════════════════════════════════════
describe("TC-API-01", () => {
  it("GET /api/users returns success/data/meta envelope", async () => {
    const res = await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${adminUser.token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.meta).toBeDefined();
    expect(res.body.meta.total).toBeTypeOf("number");
    expect(res.body.meta.page).toBeTypeOf("number");
  });
});

// ═════════════════════════════════════════════════════════════
// TC-API-02  Error responses use {success:false, error:{code,message}}
// ═════════════════════════════════════════════════════════════
describe("TC-API-02", () => {
  it("GET /api/users without auth returns error envelope", async () => {
    const res = await request(app).get("/api/users");

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBeDefined();
    expect(res.body.error.message).toBeDefined();
    expect(res.body.data).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════
// TC-API-03  Security headers set by Helmet.js
// ═════════════════════════════════════════════════════════════
describe("TC-API-03", () => {
  it("X-Content-Type-Options, X-Frame-Options present; X-Powered-By absent", async () => {
    const res = await request(app).get("/api/health");

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBeDefined();
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════
// TC-API-04  POST without JSON Content-Type returns 415
// ═════════════════════════════════════════════════════════════
describe("TC-API-04", () => {
  it("POST /api/auth/signin with Content-Type: text/plain returns 415", async () => {
    const res = await request(app)
      .post("/api/auth/signin")
      .set("Content-Type", "text/plain")
      .send("not json");

    expect(res.status).toBe(415);
  });
});

// ═════════════════════════════════════════════════════════════
// TC-API-05  Empty POST body returns 400 with field details
// ═════════════════════════════════════════════════════════════
describe("TC-API-05", () => {
  it("POST /api/auth/signin with {} returns 400 with details array", async () => {
    const res = await request(app)
      .post("/api/auth/signin")
      .send({});

    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.details)).toBe(true);
    const fieldNames = res.body.details.map((d: any) => d.field);
    expect(fieldNames).toContain("email");
    expect(fieldNames).toContain("password");
  });
});

// ═════════════════════════════════════════════════════════════
// TC-API-06  Invalid UUID in path parameter returns 400
// ═════════════════════════════════════════════════════════════
describe("TC-API-06", () => {
  it("GET /api/users/not-a-valid-uuid returns 400 INVALID_PATH_PARAM", async () => {
    const res = await request(app)
      .get("/api/users/not-a-valid-uuid")
      .set("Authorization", `Bearer ${adminUser.token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_PATH_PARAM");
  });
});

// ═════════════════════════════════════════════════════════════
// TC-API-07  Rate limiting blocks excessive requests with 429
// ═════════════════════════════════════════════════════════════
describe("TC-API-07", () => {
  it("20 concurrent auth requests trigger at least one 429 with Retry-After", async () => {
    // Reset rate limiters to start clean
    await authRateLimitStore.resetAll();

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        request(app)
          .post("/api/auth/signin")
          .send({ email: "rate-test@example.com", password: "wrong" }),
      ),
    );

    const tooMany = results.filter((r) => r.status === 429);
    expect(tooMany.length).toBeGreaterThan(0);
    // At least one 429 response should have Retry-After header
    const hasRetryAfter = tooMany.some(
      (r) => r.headers["retry-after"] !== undefined,
    );
    expect(hasRetryAfter).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════
// TC-API-08  GET /api/health returns 200 without authentication
// ═════════════════════════════════════════════════════════════
describe("TC-API-08", () => {
  it("Health endpoint returns status, database, and redis fields", async () => {
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect("database" in res.body).toBe(true);
    expect("redis" in res.body).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════
// TC-API-09  Unknown routes return 404 NOT_FOUND
// ═════════════════════════════════════════════════════════════
describe("TC-API-09", () => {
  it("GET /api/this-does-not-exist returns 404 NOT_FOUND", async () => {
    const res = await request(app)
      .get("/api/this-does-not-exist")
      .set("Authorization", `Bearer ${adminUser.token}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });
});
