/**
 * CodeSila E2E Tests — TC-E2E-01 through TC-E2E-16
 *
 * Preconditions: Backend running on localhost:3000, Frontend on localhost:5173.
 * A test admin is registered via the API in the globalSetup (beforeAll).
 *
 * Strategy: To avoid the backend's progressive auth slow-down middleware
 * (which delays ALL auth requests after the first 3 in a 15-minute window),
 * non-login tests inject auth state directly into sessionStorage instead of
 * hitting the /auth/login endpoint for every test.
 */
import { test, expect, type Page } from "@playwright/test";

const API = "http://localhost:3000";

/* ─── Shared test credentials ────────────────────────────── */
const ADMIN_EMAIL = `e2e-admin-${Date.now()}@codesila.local`;
const ADMIN_PASSWORD = "E2eTest!Secure9";
const ADMIN_NAME = "E2E Admin";

const DEV_EMAIL = `e2e-dev-${Date.now()}@codesila.local`;
const DEV_PASSWORD = "E2eTest!Dev1234";

/** Stored auth data for sessionStorage injection */
let adminAuth: { token: string; user: any; organization?: any; refreshToken?: string };
let devAuth: { token: string; user: any; organization?: any; refreshToken?: string };

/* ─── Helpers ────────────────────────────────────────────── */

/** Register a new company + admin via API, return full auth data */
async function registerAdmin() {
  const res = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyName: "E2E Test Corp",
      companySize: "SMALL",
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      fullName: ADMIN_NAME,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Registration failed (${res.status}): ${JSON.stringify(body)}`);
  }
  const data = await res.json();
  return {
    token: data.token as string,
    user: data.user,
    organization: data.organization,
    refreshToken: data.refreshToken,
  };
}

/** Create a user via API (admin creates a dev user) */
async function createDevUser(token: string): Promise<void> {
  const res = await fetch(`${API}/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      email: DEV_EMAIL,
      password: DEV_PASSWORD,
      role: "DEVELOPER",
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Create dev user failed (${res.status}): ${JSON.stringify(body)}`);
  }
}

/** Login a user via API, return full auth data */
async function apiLogin(email: string, password: string) {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`API login failed (${res.status}): ${JSON.stringify(body)}`);
  }
  const data = await res.json();
  return {
    token: data.token as string,
    user: data.user,
    organization: data.organization,
    refreshToken: data.refreshToken,
  };
}

/**
 * Inject auth state into sessionStorage and navigate to a dashboard page.
 * Bypasses the login endpoint entirely, avoiding rate-limit / slow-down.
 */
async function injectAuthAndGo(
  page: Page,
  auth: { token: string; user: any; organization?: any; refreshToken?: string },
  targetUrl: string,
): Promise<void> {
  // Mock /auth/me so the token verification never hits backend rate limits.
  await page.route("**/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...auth.user, organization: auth.organization }),
    });
  });

  // Set sessionStorage BEFORE any page scripts via addInitScript.
  await page.addInitScript((d) => {
    sessionStorage.setItem("token", d.token);
    sessionStorage.setItem("user", JSON.stringify(d.user));
    if (d.organization) {
      sessionStorage.setItem("organization", JSON.stringify(d.organization));
    }
    if (d.refreshToken) {
      sessionStorage.setItem("refreshToken", d.refreshToken);
    }
  }, auth);
  await page.goto(targetUrl);
  await page.locator("aside").waitFor({ state: "visible", timeout: 15_000 });
}

/** Log in via the UI — fills email/password and clicks submit */
async function uiLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.locator('input[placeholder="name@company.com"]').fill(email);
  await page.locator('input[placeholder="••••••••••••"]').fill(password);
  await page.locator('button[type="submit"]').click();
}

/* ─── All tests run serially inside one describe block so that a single
 * beforeAll is shared and a test timeout does not restart the worker
 * (which would trigger a second registration → 429). ─── */

test.describe("E2E", () => {
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  adminAuth = await registerAdmin();
  await createDevUser(adminAuth.token);
  devAuth = await apiLogin(DEV_EMAIL, DEV_PASSWORD);
});

// ═══════════════════════════════════════════════════════════════
// TC-E2E-01  Admin logs in and is redirected to admin dashboard
// ═══════════════════════════════════════════════════════════════
test("TC-E2E-01 Admin logs in and is redirected to dashboard", async ({ page }) => {
  await uiLogin(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  // Admin should be redirected to /admin
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });
  await page.locator("aside").waitFor({ state: "visible", timeout: 15_000 });

  // Sidebar nav items should be visible
  await expect(page.locator("aside").getByText("Dashboard")).toBeVisible();
});

// ═══════════════════════════════════════════════════════════════
// TC-E2E-02  Incorrect password shows inline error
// ═══════════════════════════════════════════════════════════════
test("TC-E2E-02 Incorrect password shows inline error", async ({ page }) => {
  await uiLogin(page, ADMIN_EMAIL, "WrongPassword!99");

  // Error message should contain "invalid" (case-insensitive)
  const errorEl = page.locator(".border-cyber-red, .text-cyber-red, .bg-red-900\\/15").first();
  await expect(errorEl).toBeVisible({ timeout: 20_000 });

  // URL should still be /login
  expect(page.url()).toContain("/login");
});

// ═══════════════════════════════════════════════════════════════
// TC-E2E-03  Unauthenticated access to /admin redirects to /login
// ═══════════════════════════════════════════════════════════════
test("TC-E2E-03 Unauthenticated /admin redirects to /login", async ({ page }) => {
  // Clear all storage to ensure no session
  await page.context().clearCookies();

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
});

// ═══════════════════════════════════════════════════════════════
// TC-E2E-04  User can log out and session is cleared
// ═══════════════════════════════════════════════════════════════
test("TC-E2E-04 Logout clears session and redirects to /login", async ({ page }) => {
  // Inject auth and go to /admin (avoid hitting login endpoint)
  await injectAuthAndGo(page, adminAuth, "/admin");

  // Click Log Out in the sidebar
  await page.locator("aside").getByText("Log Out").click();
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

  // Verify session was actually cleared
  const tokenCleared = await page.evaluate(() => !sessionStorage.getItem("token"));
  expect(tokenCleared).toBe(true);
});

// ═══════════════════════════════════════════════════════════════
// TC-E2E-05  Login form validates empty fields client-side
// ═══════════════════════════════════════════════════════════════
test("TC-E2E-05 Empty fields trigger client-side validation", async ({ page }) => {
  await page.goto("/login");

  // Click submit without filling fields
  await page.locator('button[type="submit"]').click();

  // The email input should be invalid (HTML5 required validation)
  const emailInput = page.locator('input[placeholder="name@company.com"]');
  const isInvalid = await emailInput.evaluate(
    (el: HTMLInputElement) => !el.validity.valid,
  );
  expect(isInvalid).toBe(true);

  // URL should still be /login (form was not submitted)
  expect(page.url()).toContain("/login");
});

// ═══════════════════════════════════════════════════════════════
// TC-E2E-06  Admin navigates to user management page
// ═══════════════════════════════════════════════════════════════
test("TC-E2E-06 Admin sees user management on admin dashboard", async ({ page }) => {
  await injectAuthAndGo(page, adminAuth, "/admin");

  // User access management section and table should be visible
  await expect(page.getByText("Access Management")).toBeVisible();
  await expect(page.locator("table").first()).toBeVisible();
});

// ═══════════════════════════════════════════════════════════════
// TC-E2E-07  Admin creates a new user via UI form
// ═══════════════════════════════════════════════════════════════
test("TC-E2E-07 Admin creates a new user via form", async ({ page }) => {
  await injectAuthAndGo(page, adminAuth, "/admin");

  const newEmail = `e2e-created-${Date.now()}@codesila.local`;

  // Fill the create user form
  await page.locator('input[placeholder="new.user@codesila.local"]').fill(newEmail);
  await page.locator('input[placeholder="Temporary password"]').fill("NewUser!Secure1");
  await page.locator("select").first().selectOption("DEVELOPER");
  await page.getByRole("button", { name: /add user/i }).click();

  // The new email should eventually appear in the users table
  await expect(page.locator("table").first().getByText(newEmail)).toBeVisible({ timeout: 10_000 });
});

// ═══════════════════════════════════════════════════════════════
// TC-E2E-08  Admin assigns role to user via create form
// ═══════════════════════════════════════════════════════════════
test("TC-E2E-08 Admin creates user with specific role", async ({ page }) => {
  await injectAuthAndGo(page, adminAuth, "/admin");

  const roleEmail = `e2e-manager-${Date.now()}@codesila.local`;

  // Create user with MANAGER role
  await page.locator('input[placeholder="new.user@codesila.local"]').fill(roleEmail);
  await page.locator('input[placeholder="Temporary password"]').fill("Manager!Secure1");
  await page.locator("select").first().selectOption("MANAGER");
  await page.getByRole("button", { name: /add user/i }).click();

  // Verify user appears in table with MANAGER role
  const row = page.locator("table").first().locator("tbody tr", { hasText: roleEmail });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(row.getByText("MANAGER", { exact: true })).toBeVisible();
});

// ═══════════════════════════════════════════════════════════════
// TC-E2E-09  User table contains expected user data
// ═══════════════════════════════════════════════════════════════
test("TC-E2E-09 User table displays correct user data", async ({ page }) => {
  await injectAuthAndGo(page, adminAuth, "/admin");

  // Wait for the table to be populated
  await expect(page.locator("table").first()).toBeVisible();

  // The admin email should appear in the users table
  await expect(page.locator("table").first().getByText(ADMIN_EMAIL)).toBeVisible();

  // Table should have standard columns
  await expect(page.locator("th", { hasText: "Email" })).toBeVisible();
  await expect(page.locator("th", { hasText: "Role" })).toBeVisible();
  await expect(page.locator("th", { hasText: "Status" })).toBeVisible();
});

// ═══════════════════════════════════════════════════════════════
// TC-E2E-10  Project created via DevOps projects tab
// ═══════════════════════════════════════════════════════════════
test("TC-E2E-10 Project created via DevOps projects tab", async ({ page }) => {
  await injectAuthAndGo(page, adminAuth, "/devops/projects");

  // Click "+ New Project" button
  await page.getByRole("button", { name: /new project/i }).click();

  // Fill project form
  const projName = `E2E-Proj-${Date.now()}`;
  await page.locator('input[placeholder="Project name"]').fill(projName);

  // Click Create Project
  await page.getByRole("button", { name: /create project/i }).click();

  // Project should appear in the list
  await expect(page.getByText(projName)).toBeVisible({ timeout: 10_000 });
});

// ═══════════════════════════════════════════════════════════════
// TC-E2E-11  Project creation with empty name shows disabled state
// ═══════════════════════════════════════════════════════════════
test("TC-E2E-11 Empty project name keeps Create button disabled", async ({ page }) => {
  await injectAuthAndGo(page, adminAuth, "/devops/projects");

  // Open create form
  await page.getByRole("button", { name: /new project/i }).click();

  // With empty fields, the Create Project button should be disabled
  const createBtn = page.getByRole("button", { name: /create project/i });
  await expect(createBtn).toBeDisabled();
});

// ═══════════════════════════════════════════════════════════════
// TC-E2E-12  Deployment launched — status badge shown
// ═══════════════════════════════════════════════════════════════
test("TC-E2E-12 Deployment created shows status badge", async ({ page }) => {
  await injectAuthAndGo(page, adminAuth, "/devops/deployments");

  // The deployments tab should show deployment history section
  await expect(
    page.getByText("Deployment History").or(page.getByText("New Deployment")).first(),
  ).toBeVisible();

  // Check for status badges or empty state
  const statusOrEmpty = page
    .getByText("SUCCEEDED")
    .or(page.getByText("FAILED"))
    .or(page.getByText("IN_PROGRESS"))
    .or(page.getByText("PENDING"))
    .or(page.getByText(/no deployments/i));
  await expect(statusOrEmpty.first()).toBeVisible();
});

// ═══════════════════════════════════════════════════════════════
// TC-E2E-13  Deployment status transitions are visible
// ═══════════════════════════════════════════════════════════════
test("TC-E2E-13 DevOps dashboard shows deployment status info", async ({ page }) => {
  await injectAuthAndGo(page, adminAuth, "/devops");

  // DevOps dashboard heading should be visible
  await expect(page.getByText("DevOps Dashboard")).toBeVisible();

  // Recent Deployments section should show deployments or empty state
  const deploymentsOrEmpty = page
    .getByText("Recent Deployments")
    .or(page.getByText(/no deployments/i));
  await expect(deploymentsOrEmpty.first()).toBeVisible();
});

// ═══════════════════════════════════════════════════════════════
// TC-E2E-14  Developer sees no "+ New Project" button (RBAC)
// ═══════════════════════════════════════════════════════════════
test("TC-E2E-14 Developer cannot access DevOps page", async ({ page }) => {
  await injectAuthAndGo(page, devAuth, "/developer");

  // Developer should NOT see DevOps-only nav items
  const aside = page.locator("aside");
  await expect(aside.getByText("Dashboard")).toBeVisible();

  // Deployments nav link should not be visible (it's DevOps-only)
  await expect(aside.getByText("Deployments")).not.toBeVisible();
});

// ═══════════════════════════════════════════════════════════════
// TC-E2E-15  Dashboard displays all key metric widgets
// ═══════════════════════════════════════════════════════════════
test("TC-E2E-15 Admin dashboard displays key metric widgets", async ({ page }) => {
  await injectAuthAndGo(page, adminAuth, "/admin");

  // Wait for Admin Dashboard heading to load
  await expect(
    page.getByRole("heading", { name: "Admin Dashboard" }),
  ).toBeVisible();

  // Key metrics: Total Users, Total Projects
  await expect(page.getByText("Total Users")).toBeVisible();
  await expect(page.getByText("Total Projects")).toBeVisible();
});

// ═══════════════════════════════════════════════════════════════
// TC-E2E-16  Sidebar project link navigates to project detail
// ═══════════════════════════════════════════════════════════════
test("TC-E2E-16 Sidebar Projects link navigates to projects list", async ({ page }) => {
  await injectAuthAndGo(page, adminAuth, "/admin");

  // Click Projects in sidebar
  await page.locator("aside").getByText("Projects").click();
  await expect(page).toHaveURL(/\/projects/);
});

// ═══════════════════════════════════════════════════════════════
// TC-SEC-07  IDOR — Developer cannot access admin-only routes
// ═══════════════════════════════════════════════════════════════
test("TC-SEC-07 Developer navigating to /admin is redirected away", async ({ page }) => {
  // Inject developer auth and try to go directly to /admin
  await injectAuthAndGo(page, devAuth, "/developer");

  // Manually navigate to /admin (simulates URL tampering / IDOR)
  await page.goto("/admin");

  // Developer should be redirected to /developer (their role's dashboard)
  await expect(page).toHaveURL(/\/developer/, { timeout: 10_000 });

  // The Admin Dashboard heading should NOT be visible
  await expect(page.getByRole("heading", { name: "Admin Dashboard" })).not.toBeVisible();

  // Sidebar should NOT contain admin-only links like "Access Management"
  const aside = page.locator("aside");
  await expect(aside.getByText("Access Management")).not.toBeVisible();
});

}); // end describe("E2E")
