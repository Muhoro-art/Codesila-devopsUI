/**
 * CodeSila Compatibility Tests — TC-COMP-01/02/03
 *
 * Critical workflows verified across Chrome, Edge, and Firefox.
 * The playwright.config.ts defines three projects: chromium, msedge, firefox.
 * Running `npx playwright test compat.e2e.spec.ts` exercises all three browsers.
 *
 * TC-COMP-01: Critical workflows pass in Chrome  (chromium project)
 * TC-COMP-02: Critical workflows pass in Edge    (msedge project)
 * TC-COMP-03: Critical workflows pass in Firefox (firefox project)
 *
 * Preconditions: Backend on localhost:3000, Frontend on localhost:5173.
 */
import { test, expect, type Page } from "@playwright/test";

const API = "http://localhost:3000";

/* ─── Unique credentials per worker / browser ────────────── */
const TS = Date.now();
const ADMIN_PASSWORD = "E2eTest!Secure9";
const ADMIN_NAME = "E2E Compat Admin";

let adminAuth: { token: string; user: any; organization?: any; refreshToken?: string };

/* ─── Helpers ────────────────────────────────────────────── */

async function registerAdmin(suffix: string) {
  const email = `e2e-compat-${suffix}-${Date.now()}@codesila.local`;
  const res = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyName: `Compat ${suffix} Corp`,
      companySize: "SMALL",
      email,
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
    email,
    token: data.token as string,
    user: data.user,
    organization: data.organization,
    refreshToken: data.refreshToken,
  };
}

async function injectAuthAndGo(
  page: Page,
  auth: { token: string; user: any; organization?: any; refreshToken?: string },
  targetUrl: string,
): Promise<void> {
  await fetch(`${API}/_test/reset-rate-limits`, { method: "POST" }).catch(() => {});

  await page.route("**/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...auth.user, organization: auth.organization }),
    });
  });

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

/* ─── Tests ──────────────────────────────────────────────── */

test.describe("Cross-Browser Compatibility", () => {
  test.describe.configure({ mode: "serial" });

  let email: string;
  let projectId: string;
  let pipelineId: string;

  test.beforeAll(async () => {
    await fetch(`${API}/_test/reset-rate-limits`, { method: "POST" }).catch(() => {});
    const suffix = `${Date.now()}`;
    const reg = await registerAdmin(suffix);
    adminAuth = reg;
    email = reg.email;
  });

  // ──────────────────────────────────────────────────────────
  // Workflow 1: Login via UI → admin dashboard loads
  // ──────────────────────────────────────────────────────────
  test("Login and admin dashboard renders correctly", async ({ page }) => {
    await fetch(`${API}/_test/reset-rate-limits`, { method: "POST" }).catch(() => {});

    await page.goto("/login");
    await page.locator('input[placeholder="name@company.com"]').fill(email);
    await page.locator('input[placeholder="••••••••••••"]').fill(ADMIN_PASSWORD);
    await page.locator('button[type="submit"]').click();

    // Should arrive at admin dashboard
    await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });
    await page.locator("aside").waitFor({ state: "visible", timeout: 15_000 });
    await expect(page.locator("aside").getByText("Dashboard")).toBeVisible();
  });

  // ──────────────────────────────────────────────────────────
  // Workflow 2: Projects page renders and seeded project visible
  // ──────────────────────────────────────────────────────────
  test("Projects page lists a seeded project", async ({ page }) => {
    // Create a project via API
    const projName = `Compat-${Date.now()}`;
    const projKey = `CK${Date.now().toString().slice(-4)}`;
    const res = await fetch(`${API}/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminAuth.token}`,
      },
      body: JSON.stringify({ name: projName, key: projKey, type: "API" }),
    });
    expect(res.ok).toBeTruthy();
    const proj = await res.json();
    projectId = proj.id;

    await injectAuthAndGo(page, adminAuth, "/projects");

    // Project should appear in the list
    await expect(page.getByText(projName)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(projKey)).toBeVisible({ timeout: 10_000 });
  });

  // ──────────────────────────────────────────────────────────
  // Workflow 3: Create and trigger a pipeline run
  // ──────────────────────────────────────────────────────────
  test("Create pipeline and trigger a run", async ({ page }) => {
    // Ensure we have a project
    if (!projectId) {
      const res = await fetch(`${API}/projects`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminAuth.token}`,
        },
        body: JSON.stringify({
          name: `CompatFB-${Date.now()}`,
          key: `CF${Date.now().toString().slice(-4)}`,
          type: "API",
        }),
      });
      const data = await res.json();
      projectId = data.id;
    }

    // Create pipeline via API for speed
    const pipRes = await fetch(`${API}/api/projects/${projectId}/pipelines`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminAuth.token}`,
      },
      body: JSON.stringify({
        name: "Compat Pipeline",
        config_yaml: "stages:\n  - name: test\n    commands:\n      - echo ok",
      }),
    });
    expect(pipRes.ok).toBeTruthy();
    const pipData = await pipRes.json();
    pipelineId = pipData.data.id;

    // Trigger a run via API
    const runRes = await fetch(`${API}/api/pipelines/${pipelineId}/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminAuth.token}`,
      },
      body: JSON.stringify({ branch: "main" }),
    });
    expect(runRes.ok).toBeTruthy();

    // Navigate to pipeline page and verify run appears
    await injectAuthAndGo(
      page,
      adminAuth,
      `/project/${projectId}/pipelines`,
    );

    await expect(page.getByText("Compat Pipeline")).toBeVisible({ timeout: 15_000 });
    await page.getByText("Compat Pipeline").click();

    await expect(page.getByText("Run History")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("QUEUED").first()).toBeVisible({ timeout: 10_000 });
  });

  // ──────────────────────────────────────────────────────────
  // Workflow 4: Sidebar navigation works
  // ──────────────────────────────────────────────────────────
  test("Sidebar navigation works across pages", async ({ page }) => {
    await injectAuthAndGo(page, adminAuth, "/admin");

    // Navigate to Projects via sidebar
    await page.locator("aside").getByText("Projects").click();
    await expect(page).toHaveURL(/\/projects/, { timeout: 10_000 });

    // Navigate back to Dashboard
    await page.locator("aside").getByText("Dashboard").click();
    await expect(page).toHaveURL(/\/admin/, { timeout: 10_000 });
  });
});
