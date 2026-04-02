/**
 * Security Integration Tests — TC-SEC-01 through TC-SEC-12
 *
 * These tests verify OWASP-aligned security controls against the real
 * Express app with a live PostgreSQL database. They create isolated test
 * data in beforeAll and clean up in afterAll.
 *
 * Covers: SQL injection, brute-force rate limiting, JWT abuse,
 * IDOR, password leakage, tech-stack hiding, XSS storage,
 * mass assignment, and error message sanitization.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { authRateLimitStore } from "../middlewares/rateLimit";

const prisma = new PrismaClient();

// ─── Isolated test constants ─────────────────────────────────
const TEST_ORG_ID = "org_test_sec_integration";
const USER1_EMAIL = "sec-user1@codesila.test";
const USER2_EMAIL = "sec-user2@codesila.test";
const USER_PASSWORD = "Str0ng!Pass@2026xZ";
const JWT_SECRET = process.env.JWT_SECRET ?? "supersecret_dev_key";

let app: Express;
let user1Id: string;
let user2Id: string;
let adminToken: string;
let user1Token: string;

/** Sign a real access token for testing (matches auth middleware expectations) */
function signTestToken(userId: string, email: string, orgId: string, role: string): string {
  return jwt.sign(
    { sub: userId, email, orgId, role, type: "access" },
    JWT_SECRET,
    { algorithm: "HS256", expiresIn: "15m", issuer: "codesila-api", audience: "codesila-client" },
  );
}

// Reset auth rate-limiter between tests (except the brute-force test)
beforeEach(async () => {
  await authRateLimitStore.resetAll();
});

beforeAll(async () => {
  const mod = await import("../app");
  app = mod.buildApp();

  // ── Create isolated org + users ────────────────────────────
  await prisma.organization.upsert({
    where: { id: TEST_ORG_ID },
    update: {},
    create: { id: TEST_ORG_ID, name: "Sec Test Org", slug: "sec-test-org" },
  });

  const hash = await bcrypt.hash(USER_PASSWORD, 10);

  const u1 = await prisma.user.create({
    data: {
      email: USER1_EMAIL,
      passwordHash: hash,
      name: "Sec User 1",
      role: "ADMIN",
      orgId: TEST_ORG_ID,
      isActive: true,
    },
  });
  user1Id = u1.id;

  const u2 = await prisma.user.create({
    data: {
      email: USER2_EMAIL,
      passwordHash: hash,
      name: "Sec User 2",
      role: "DEVELOPER",
      orgId: TEST_ORG_ID,
      isActive: true,
    },
  });
  user2Id = u2.id;

  // Get real tokens via signin
  const loginRes = await request(app)
    .post("/api/auth/signin")
    .send({ email: USER1_EMAIL, password: USER_PASSWORD });
  adminToken = loginRes.body.data.accessToken;
  user1Token = adminToken;

  // Reset rate limit after setup logins
  await authRateLimitStore.resetAll();
}, 30_000);

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { orgId: TEST_ORG_ID } });
  await prisma.project.deleteMany({ where: { orgId: TEST_ORG_ID } });
  await prisma.user.deleteMany({ where: { orgId: TEST_ORG_ID } });
  await prisma.organization.delete({ where: { id: TEST_ORG_ID } }).catch(() => {});
  await prisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════
// TC-SEC-01  SQL injection in email field does not bypass auth
// ═══════════════════════════════════════════════════════════════
describe("TC-SEC-01", () => {
  it("SQL injection in email field does not bypass authentication", async () => {
    const countBefore = await prisma.user.count({ where: { orgId: TEST_ORG_ID } });

    const res = await request(app)
      .post("/api/auth/signin")
      .send({ email: "' OR 1=1--", password: "anything" });

    // Must never return 200
    expect(res.status).not.toBe(200);
    expect([400, 401]).toContain(res.status);

    // DB user count must be unchanged
    const countAfter = await prisma.user.count({ where: { orgId: TEST_ORG_ID } });
    expect(countAfter).toBe(countBefore);
  });
});

// ═══════════════════════════════════════════════════════════════
// TC-SEC-02  SQL injection in search param returns safely
// ═══════════════════════════════════════════════════════════════
describe("TC-SEC-02", () => {
  it("SQL injection in search param returns empty results or 400, not 500", async () => {
    const res = await request(app)
      .get("/admin/users?search=' OR 1=1--")
      .set("Authorization", `Bearer ${adminToken}`);

    // Must never return 500
    expect(res.status).not.toBe(500);
    // Should be 200 (empty/ignored) or 400 (input rejected)
    expect([200, 400]).toContain(res.status);
  });
});

// ═══════════════════════════════════════════════════════════════
// TC-SEC-03  Brute-force blocked after repeated failed logins
// ═══════════════════════════════════════════════════════════════
describe("TC-SEC-03", () => {
  it("returns 429 after repeated failed login attempts", async () => {
    // Clear rate limit state so this test starts fresh
    await authRateLimitStore.resetAll();

    const statuses: number[] = [];

    for (let i = 0; i < 15; i++) {
      const res = await request(app)
        .post("/api/auth/signin")
        .send({ email: "brute-force@codesila.test", password: "Wrong!Pass999" });
      statuses.push(res.status);
    }

    // At least one response must be 429
    expect(statuses).toContain(429);
  }, 30_000);
});

// ═══════════════════════════════════════════════════════════════
// TC-SEC-04  JWT with tampered signature is rejected
// ═══════════════════════════════════════════════════════════════
describe("TC-SEC-04", () => {
  it("rejects JWT with corrupted signature", async () => {
    // Take a valid token and replace its signature
    const parts = adminToken.split(".");
    const tampered = `${parts[0]}.${parts[1]}.invalidsignature`;

    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${tampered}`);

    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════
// TC-SEC-05  JWT with algorithm=none is rejected
// ═══════════════════════════════════════════════════════════════
describe("TC-SEC-05", () => {
  it("rejects JWT crafted with alg:none", async () => {
    // Craft a token with alg: none
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        sub: user1Id,
        email: USER1_EMAIL,
        orgId: TEST_ORG_ID,
        role: "ADMIN",
        type: "access",
        iss: "codesila-api",
        aud: "codesila-client",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900,
      }),
    ).toString("base64url");
    const noneToken = `${header}.${payload}.`;

    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${noneToken}`);

    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════
// TC-SEC-06  Token from different secret is rejected
// ═══════════════════════════════════════════════════════════════
describe("TC-SEC-06", () => {
  it("rejects JWT signed with a foreign secret", async () => {
    const foreignToken = jwt.sign(
      {
        sub: user1Id,
        email: USER1_EMAIL,
        orgId: TEST_ORG_ID,
        role: "ADMIN",
        type: "access",
      },
      "completely_different_secret_key_12345",
      { algorithm: "HS256", expiresIn: "15m", issuer: "codesila-api", audience: "codesila-client" },
    );

    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${foreignToken}`);

    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════
// TC-SEC-07  IDOR — user cannot access another user's data
// ═══════════════════════════════════════════════════════════════
describe("TC-SEC-07", () => {
  it("user cannot access another user's private data (password_hash absent)", async () => {
    // Get a Developer token for user2
    await authRateLimitStore.resetAll();
    const loginRes = await request(app)
      .post("/api/auth/signin")
      .send({ email: USER2_EMAIL, password: USER_PASSWORD });
    const devToken = loginRes.body.data.accessToken;

    // Try fetching user1's data with user2's token
    // The admin/users/:id endpoint enforces orgId scoping
    const res = await request(app)
      .get(`/admin/users/${user1Id}`)
      .set("Authorization", `Bearer ${devToken}`);

    // Should be 403 (no permission) since user2 is DEVELOPER
    // and UserRead requires ADMIN/SUPER_ADMIN/DEVOPS/MANAGER
    expect([403, 404]).toContain(res.status);

    // Even if somehow accessible, password_hash must never appear
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("password_hash");
    expect(body).not.toContain("passwordHash");
  });
});

// ═══════════════════════════════════════════════════════════════
// TC-SEC-08  Passwords never returned in any API response
// ═══════════════════════════════════════════════════════════════
describe("TC-SEC-08", () => {
  it("password_hash never appears in users list response", async () => {
    const res = await request(app)
      .get("/admin/users")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);

    // Stringify the entire body and search for password-related fields
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("password_hash");
    expect(body).not.toContain("passwordHash");
    expect(body).not.toContain('"password"');
  });
});

// ═══════════════════════════════════════════════════════════════
// TC-SEC-09  X-Powered-By header absent (tech-stack hiding)
// ═══════════════════════════════════════════════════════════════
describe("TC-SEC-09", () => {
  it("X-Powered-By header is not present on any response", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// TC-SEC-10  XSS payload in project name stored safely
// ═══════════════════════════════════════════════════════════════
describe("TC-SEC-10", () => {
  it("XSS script tag in project name is not stored as executable markup", async () => {
    const xssName = '<script>alert(1)</script>';

    const res = await request(app)
      .post("/projects")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: xssName, key: "XSSTEST" });

    // Could be 201/200 (stored safely) or 400 (rejected)
    if (res.status === 200 || res.status === 201) {
      // If stored, the returned name must not contain raw script tag
      const body = JSON.stringify(res.body);
      expect(body).not.toContain("<script>");
    } else {
      // Rejected input is also acceptable
      expect([400, 422]).toContain(res.status);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// TC-SEC-11  Mass assignment — isActive cannot be set via update
// ═══════════════════════════════════════════════════════════════
describe("TC-SEC-11", () => {
  it("isActive cannot be flipped via user profile update", async () => {
    // Confirm user1 is active before the test
    const before = await prisma.user.findUnique({ where: { id: user1Id } });
    expect(before?.isActive).toBe(true);

    // Attempt to set isActive=false via change-password or any user-facing endpoint.
    // The app has no generic PATCH /users/:id for self-update, so we try
    // sending extra fields in the change-password endpoint (mass assignment).
    const res = await request(app)
      .post("/auth/change-password")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        currentPassword: USER_PASSWORD,
        newPassword: USER_PASSWORD, // same password — focus is on isActive
        isActive: false,
        role: "SUPER_ADMIN",
      });

    // Regardless of the endpoint's response (could succeed or fail),
    // the user must still be active in the DB.
    const after = await prisma.user.findUnique({ where: { id: user1Id } });
    expect(after?.isActive).toBe(true);
    // Role must not have changed either
    expect(after?.role).toBe("ADMIN");
  });
});

// ═══════════════════════════════════════════════════════════════
// TC-SEC-12  Error messages do not reveal database internals
// ═══════════════════════════════════════════════════════════════
describe("TC-SEC-12", () => {
  it("error responses do not contain SQL or DB keywords", async () => {
    // Trigger a 400 (bad login)
    const loginErr = await request(app)
      .post("/api/auth/signin")
      .send({ email: "not-exist@x.com", password: "Wrong!Pass999" });

    const body400 = JSON.stringify(loginErr.body).toLowerCase();
    expect(body400).not.toContain("column");
    expect(body400).not.toContain('"table"');
    expect(body400).not.toContain("postgres");
    expect(body400).not.toContain("prisma");

    // Trigger a 401 (no/bad token)
    const authErr = await request(app)
      .get("/auth/me")
      .set("Authorization", "Bearer invalid.token.here");

    const body401 = JSON.stringify(authErr.body).toLowerCase();
    expect(body401).not.toContain("column");
    expect(body401).not.toContain('"table"');
    expect(body401).not.toContain("postgres");
    expect(body401).not.toContain("prisma");
  });
});
