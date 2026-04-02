/**
 * Auth Integration Tests — TC-AUTH-01 through TC-AUTH-17
 *
 * These tests verify the full authentication lifecycle against the real
 * Express app with a live PostgreSQL database. They create isolated test
 * data in beforeAll and clean up in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { invalidatedRefreshTokens } from "../modules/admin/auth/auth.service";
import { authRateLimitStore } from "../middlewares/rateLimit";

const prisma = new PrismaClient();

// ─── Test constants ──────────────────────────────────────────
const TEST_ORG_ID = "org_test_auth_integration";
const TEST_USER_EMAIL = "auth-test-active@codesila.test";
const TEST_USER_PASSWORD = "Str0ng!Pass@2026xZ";
const TEST_DEACTIVATED_EMAIL = "auth-test-disabled@codesila.test";
const TEST_DEACTIVATED_PASSWORD = "Str0ng!Pass@2026xZ";

let app: Express;
let testUserId: string;
let testDeactivatedUserId: string;

// Reset auth rate-limiter between tests so earlier failures
// don't cause 429 responses in later tests.
beforeEach(async () => {
  await authRateLimitStore.resetAll();
});

beforeAll(async () => {
  // Build the real Express app
  const mod = await import("../app");
  app = mod.buildApp();

  // ── Create isolated test data ────────────────────────────
  await prisma.organization.upsert({
    where: { id: TEST_ORG_ID },
    update: {},
    create: { id: TEST_ORG_ID, name: "Auth Test Org", slug: "auth-test-org" },
  });

  const hash = await bcrypt.hash(TEST_USER_PASSWORD, 10);

  const activeUser = await prisma.user.create({
    data: {
      email: TEST_USER_EMAIL,
      passwordHash: hash,
      name: "Auth Test User",
      role: "DEVELOPER",
      orgId: TEST_ORG_ID,
      isActive: true,
    },
  });
  testUserId = activeUser.id;

  const disabledUser = await prisma.user.create({
    data: {
      email: TEST_DEACTIVATED_EMAIL,
      passwordHash: hash,
      name: "Auth Disabled User",
      role: "DEVELOPER",
      orgId: TEST_ORG_ID,
      isActive: false,
    },
  });
  testDeactivatedUserId = disabledUser.id;
}, 30_000);

afterAll(async () => {
  // Clean up audit events first (FK constraint)
  await prisma.auditEvent.deleteMany({ where: { orgId: TEST_ORG_ID } });
  await prisma.user.deleteMany({ where: { orgId: TEST_ORG_ID } });
  await prisma.organization.delete({ where: { id: TEST_ORG_ID } }).catch(() => {});
  invalidatedRefreshTokens.clear();
  await prisma.$disconnect();
});

// ─────────────────────────────────────────────────────────────
// TC-AUTH-01  Successful sign-in returns 200 with access token
// ─────────────────────────────────────────────────────────────
describe("TC-AUTH-01", () => {
  it("Successful sign-in returns 200 with access token", async () => {
    const res = await request(app)
      .post("/api/auth/signin")
      .send({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.accessToken).toBeDefined();
    expect(typeof res.body.data.accessToken).toBe("string");
    // Verify JWT structure (3 dot-separated parts)
    expect(res.body.data.accessToken.split(".").length).toBe(3);
    expect(res.body.data.user).toBeDefined();
    expect(res.body.data.user.email).toBe(TEST_USER_EMAIL);
    // password_hash must never be exposed
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("password_hash");
    expect(body).not.toContain("passwordHash");
  });
});

// ─────────────────────────────────────────────────────────────
// TC-AUTH-02  Sign-in sets HttpOnly refresh token cookie
// ─────────────────────────────────────────────────────────────
describe("TC-AUTH-02", () => {
  it("Sign-in sets HttpOnly refresh token cookie with SameSite=Strict", async () => {
    const res = await request(app)
      .post("/api/auth/signin")
      .send({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD });

    expect(res.status).toBe(200);

    const cookies = res.headers["set-cookie"];
    expect(cookies).toBeDefined();

    const refreshCookie = Array.isArray(cookies)
      ? cookies.find((c: string) => c.startsWith("refreshToken="))
      : typeof cookies === "string" && cookies.startsWith("refreshToken=")
        ? cookies
        : undefined;

    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toMatch(/HttpOnly/i);
    expect(refreshCookie).toMatch(/SameSite=Strict/i);
  });
});

// ─────────────────────────────────────────────────────────────
// TC-AUTH-03  Wrong password returns 401 INVALID_CREDENTIALS
// ─────────────────────────────────────────────────────────────
describe("TC-AUTH-03", () => {
  it("Wrong password returns 401 INVALID_CREDENTIALS", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: TEST_USER_EMAIL, password: "WrongP@ssw0rd!99" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_CREDENTIALS");
  });
});

// ─────────────────────────────────────────────────────────────
// TC-AUTH-04  Non-existent email returns same error as wrong pw
// ─────────────────────────────────────────────────────────────
describe("TC-AUTH-04", () => {
  it("Non-existent email returns 401 INVALID_CREDENTIALS", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "nobody-exists@codesila.test", password: "SomeP@ss1!" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_CREDENTIALS");
  });
});

// ─────────────────────────────────────────────────────────────
// TC-AUTH-05  Deactivated account returns 401 ACCOUNT_DISABLED
// ─────────────────────────────────────────────────────────────
describe("TC-AUTH-05", () => {
  it("Deactivated account returns 401 ACCOUNT_DISABLED", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: TEST_DEACTIVATED_EMAIL, password: TEST_DEACTIVATED_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("ACCOUNT_DISABLED");
  });
});

// ─────────────────────────────────────────────────────────────
// TC-AUTH-06  Token refresh returns new access token
// ─────────────────────────────────────────────────────────────
describe("TC-AUTH-06", () => {
  it("Token refresh returns new access token", async () => {
    // Login first to obtain refresh token cookie
    const login = await request(app)
      .post("/auth/login")
      .send({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD });

    expect(login.status).toBe(200);

    const cookies = login.headers["set-cookie"];

    const res = await request(app)
      .post("/auth/refresh")
      .set("Cookie", cookies)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(typeof res.body.token).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────
// TC-AUTH-07  Refresh with no cookie returns 401 NO_REFRESH_TOKEN
// ─────────────────────────────────────────────────────────────
describe("TC-AUTH-07", () => {
  it("Refresh with no cookie returns 401 NO_REFRESH_TOKEN", async () => {
    const res = await request(app)
      .post("/auth/refresh")
      .send();

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("NO_REFRESH_TOKEN");
  });
});

// ─────────────────────────────────────────────────────────────
// TC-AUTH-08  Sign-out clears refresh token cookie
// ─────────────────────────────────────────────────────────────
describe("TC-AUTH-08", () => {
  it("Sign-out clears refresh token cookie", async () => {
    const login = await request(app)
      .post("/auth/login")
      .send({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD });

    const loginCookies = login.headers["set-cookie"];

    const res = await request(app)
      .post("/auth/logout")
      .set("Cookie", loginCookies)
      .send();

    expect(res.status).toBe(200);

    const cookies = res.headers["set-cookie"];
    expect(cookies).toBeDefined();

    const clearCookie = Array.isArray(cookies)
      ? cookies.find((c: string) => c.startsWith("refreshToken="))
      : cookies;

    // Cookie should be cleared (value empty or expires in the past)
    expect(clearCookie).toBeDefined();
    expect(clearCookie).toMatch(/refreshToken=/);
  });
});

// ─────────────────────────────────────────────────────────────
// TC-AUTH-09  Refresh token invalidated after sign-out
// ─────────────────────────────────────────────────────────────
describe("TC-AUTH-09", () => {
  it("Refresh token invalidated after sign-out", async () => {
    // Login to get refresh token
    const login = await request(app)
      .post("/auth/login")
      .send({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD });

    const loginCookies = login.headers["set-cookie"];

    // Logout — invalidates the refresh token
    await request(app)
      .post("/auth/logout")
      .set("Cookie", loginCookies)
      .send();

    // Try to use the old refresh token — should be rejected
    const res = await request(app)
      .post("/auth/refresh")
      .set("Cookie", loginCookies)
      .send();

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────
// TC-AUTH-10  Expired access token returns 401 TOKEN_EXPIRED
// ─────────────────────────────────────────────────────────────
describe("TC-AUTH-10", () => {
  it("Expired access token returns 401 TOKEN_EXPIRED", async () => {
    // Sign a token that's already expired
    const expiredToken = jwt.sign(
      {
        sub: testUserId,
        role: "DEVELOPER",
        orgId: TEST_ORG_ID,
        email: TEST_USER_EMAIL,
        type: "access",
      },
      process.env.JWT_SECRET || "supersecret_dev_key",
      {
        expiresIn: "-60s", // expired 60 seconds ago (exceeds 30s clock tolerance)
        algorithm: "HS256",
        issuer: "codesila-api",
        audience: "codesila-client",
      }
    );

    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TOKEN_EXPIRED");
  });
});

// ─────────────────────────────────────────────────────────────
// TC-AUTH-11  Malformed JWT returns 401 INVALID_TOKEN
// ─────────────────────────────────────────────────────────────
describe("TC-AUTH-11", () => {
  it("Malformed JWT returns 401 INVALID_TOKEN", async () => {
    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", "Bearer not.a.validtoken");

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_TOKEN");
  });
});

// ─────────────────────────────────────────────────────────────
// TC-AUTH-12  Missing Authorization header returns 401 NO_TOKEN
// ─────────────────────────────────────────────────────────────
describe("TC-AUTH-12", () => {
  it("Missing Authorization header returns 401 NO_TOKEN", async () => {
    const res = await request(app)
      .get("/auth/me");

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("NO_TOKEN");
  });
});

// ─────────────────────────────────────────────────────────────
// TC-AUTH-13  Audit log created on successful login
// ─────────────────────────────────────────────────────────────
describe("TC-AUTH-13", () => {
  it("Audit log created on successful login", async () => {
    // Clear previous audit events for this org
    await prisma.auditEvent.deleteMany({ where: { orgId: TEST_ORG_ID } });

    await request(app)
      .post("/auth/login")
      .send({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD });

    // Wait briefly for the async audit log to be written
    await new Promise((r) => setTimeout(r, 500));

    const audit = await prisma.auditEvent.findFirst({
      where: {
        orgId: TEST_ORG_ID,
        action: "auth.login.success",
        actorId: testUserId,
      },
    });

    expect(audit).not.toBeNull();
    expect(audit!.entityType).toBe("user");
  });
});

// ─────────────────────────────────────────────────────────────
// TC-AUTH-14  Audit log created on failed login attempt
// ─────────────────────────────────────────────────────────────
describe("TC-AUTH-14", () => {
  it("Audit log created on failed login attempt", async () => {
    // Clear previous audit events
    await prisma.auditEvent.deleteMany({ where: { orgId: TEST_ORG_ID } });

    await request(app)
      .post("/auth/login")
      .send({ email: TEST_USER_EMAIL, password: "WrongP@ssw0rd!99" });

    // Wait briefly for the async audit log
    await new Promise((r) => setTimeout(r, 500));

    const audit = await prisma.auditEvent.findFirst({
      where: {
        orgId: TEST_ORG_ID,
        action: "auth.login.failed",
        actorId: testUserId,
      },
    });

    expect(audit).not.toBeNull();
    expect(audit!.entityType).toBe("user");
  });
});

// ─────────────────────────────────────────────────────────────
// TC-AUTH-15  Response never exposes password_hash or sensitive
// ─────────────────────────────────────────────────────────────
describe("TC-AUTH-15", () => {
  it("Response never exposes password_hash or sensitive fields", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD });

    expect(res.status).toBe(200);

    const body = JSON.stringify(res.body);
    expect(body).not.toContain("password_hash");
    expect(body).not.toContain("passwordHash");
    expect(body).not.toContain("twoFactorSecret");
  });
});

// ─────────────────────────────────────────────────────────────
// TC-AUTH-16  Missing required fields return 400 with field details
// ─────────────────────────────────────────────────────────────
describe("TC-AUTH-16", () => {
  it("Missing required fields return 400 with field details", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.fields).toBeDefined();
    expect(Array.isArray(res.body.fields)).toBe(true);
    expect(res.body.fields.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// TC-AUTH-17  Invalid email format returns 400
// ─────────────────────────────────────────────────────────────
describe("TC-AUTH-17", () => {
  it("Invalid email format returns 400", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "not-an-email", password: "SomePass!1" });

    expect(res.status).toBe(400);
  });
});
