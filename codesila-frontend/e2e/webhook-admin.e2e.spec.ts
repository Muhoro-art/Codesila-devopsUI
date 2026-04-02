/**
 * CodeSila E2E Tests — TC-E2E-03 (Webhook-triggered run) & TC-E2E-04 (Unauthorized admin blocked)
 *
 * Preconditions: Backend running on localhost:3000, Frontend on localhost:5173.
 */
import { test, expect, type Page } from "@playwright/test";
import * as crypto from "crypto";

const API = "http://localhost:3000";

/* ─── Shared test credentials ────────────────────────────── */
const ADMIN_EMAIL = `e2e-wh-admin-${Date.now()}@codesila.local`;
const ADMIN_PASSWORD = "E2eTest!Secure9";
const ADMIN_NAME = "E2E Webhook Admin";

const DEV_EMAIL = `e2e-wh-dev-${Date.now()}@codesila.local`;
const DEV_PASSWORD = "E2eTest!Dev1234";

let adminAuth: { token: string; user: any; organization?: any; refreshToken?: string };
let devAuth: { token: string; user: any; organization?: any; refreshToken?: string };

/* ─── Helpers (same pattern as existing E2E suites) ──────── */

async function registerAdmin() {
  const res = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyName: "E2E Webhook Corp",
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

async function apiCreateProject(
  token: string,
  input: { name: string; key: string; description?: string; type?: string },
) {
  const res = await fetch(`${API}/projects`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Create project failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return res.json();
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

/* ─── Test Suite ─────────────────────────────────────────── */

test.describe("Webhook & Admin Auth E2E", () => {
  test.describe.configure({ mode: "serial" });

  let projectId: string;
  let pipelineId: string;
  let webhookSecret: string;
  let githubRepoId: number;

  test.beforeAll(async () => {
    await fetch(`${API}/_test/reset-rate-limits`, { method: "POST" }).catch(() => {});
    adminAuth = await registerAdmin();
    await createDevUser(adminAuth.token);
    devAuth = await apiLogin(DEV_EMAIL, DEV_PASSWORD);
  });

  // ═══════════════════════════════════════════════════════════════
  // TC-E2E-03  Webhook-triggered execution appears in dashboard
  //            and run history
  // ═══════════════════════════════════════════════════════════════
  test("TC-E2E-03 Webhook-triggered run appears in pipeline run history", async ({ page }) => {
    // Step 1: Create a project via API
    const projName = `WebhookProj-${Date.now()}`;
    const projKey = `WP${Date.now().toString().slice(-4)}`;
    const proj = await apiCreateProject(adminAuth.token, {
      name: projName,
      key: projKey,
      description: "Webhook E2E test project",
      type: "API",
    });
    projectId = proj.id;

    // Step 2: Create a pipeline for this project via API
    const pipelineRes = await fetch(`${API}/api/projects/${projectId}/pipelines`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminAuth.token}`,
      },
      body: JSON.stringify({
        name: "Webhook CI Pipeline",
        config_yaml: "stages:\n  - name: build\n    commands:\n      - echo build",
      }),
    });
    expect(pipelineRes.ok).toBeTruthy();
    const pipelineData = await pipelineRes.json();
    pipelineId = pipelineData.data.id;

    // Step 3: Seed a GitHubRepo record via the test endpoint
    const seedRes = await fetch(`${API}/_test/seed-webhook-repo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgId: adminAuth.organization.id,
        projectId,
      }),
    });
    expect(seedRes.ok).toBeTruthy();
    const seedData = await seedRes.json();
    webhookSecret = seedData.webhookSecret;
    githubRepoId = seedData.githubRepoId;

    // Step 4: Send a GitHub push webhook with a valid HMAC signature
    const commitSha = "abc1234567890def1234567890abcdef12345678";
    const webhookBody = {
      ref: "refs/heads/main",
      repository: { id: githubRepoId, full_name: "e2e-org/e2e-repo" },
      sender: { login: "e2e-bot", avatar_url: "" },
      commits: [
        {
          id: commitSha,
          message: "E2E webhook push test commit",
          author: { name: "E2E Bot", email: "bot@test.local" },
          url: "https://github.com/e2e-org/e2e-repo/commit/" + commitSha,
          timestamp: new Date().toISOString(),
          added: ["file.ts"],
          modified: [],
          removed: [],
        },
      ],
    };

    const bodyStr = JSON.stringify(webhookBody);
    const signature =
      "sha256=" +
      crypto.createHmac("sha256", webhookSecret).update(bodyStr).digest("hex");

    const whRes = await fetch(`${API}/integrations/github/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "push",
        "X-Hub-Signature-256": signature,
        "X-GitHub-Delivery": `e2e-delivery-${Date.now()}`,
      },
      body: bodyStr,
    });
    expect(whRes.ok).toBeTruthy();

    // Step 5: Verify the pipeline run was created via API
    const runsRes = await fetch(`${API}/api/pipelines/${pipelineId}/runs`, {
      headers: { Authorization: `Bearer ${adminAuth.token}` },
    });
    expect(runsRes.ok).toBeTruthy();
    const runsData = await runsRes.json();
    expect(runsData.data.length).toBeGreaterThanOrEqual(1);
    const webhookRun = runsData.data.find(
      (r: any) => r.commit_sha === commitSha && r.branch === "main",
    );
    expect(webhookRun).toBeTruthy();
    expect(webhookRun.status).toBe("QUEUED");

    // Step 6: Navigate to the Pipelines page and verify the run appears in the UI
    await injectAuthAndGo(
      page,
      adminAuth,
      `/project/${projectId}/pipelines`,
    );

    // The pipeline name should be visible
    await expect(page.getByText("Webhook CI Pipeline")).toBeVisible({ timeout: 15_000 });

    // Click on the pipeline to select it (if not auto-selected)
    await page.getByText("Webhook CI Pipeline").click();

    // Run History heading should appear
    await expect(page.getByText("Run History")).toBeVisible({ timeout: 10_000 });

    // The QUEUED status badge for the webhook-triggered run should be visible
    await expect(page.getByText("QUEUED").first()).toBeVisible({ timeout: 10_000 });

    // The branch "main" should be visible in the run row
    await expect(page.getByText("main").first()).toBeVisible({ timeout: 10_000 });
  });

  // ═══════════════════════════════════════════════════════════════
  // TC-E2E-04  Unauthorized user cannot perform administrative
  //            workflow — both UI redirect and API 403
  // ═══════════════════════════════════════════════════════════════
  test("TC-E2E-04 Developer cannot access admin dashboard or admin API", async ({ page }) => {
    // Part A: UI guard — developer navigating to /admin gets redirected
    await fetch(`${API}/_test/reset-rate-limits`, { method: "POST" }).catch(() => {});

    await page.route("**/auth/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...devAuth.user, organization: devAuth.organization }),
      });
    });

    await page.addInitScript((d) => {
      sessionStorage.setItem("token", d.token);
      sessionStorage.setItem("user", JSON.stringify(d.user));
      if (d.organization) {
        sessionStorage.setItem("organization", JSON.stringify(d.organization));
      }
    }, devAuth);

    await page.goto("/admin");

    // Should be redirected away from /admin (to /developer or /login)
    await expect(page).not.toHaveURL(/\/admin/, { timeout: 15_000 });

    // Part B: API guard — developer calling admin endpoint gets 403 (no UserRead permission)
    const usersRes = await fetch(`${API}/admin/users`, {
      headers: { Authorization: `Bearer ${devAuth.token}` },
    });
    expect(usersRes.status).toBe(403);

    // Part C: API guard — developer cannot create users (no UserManage permission)
    const createUserRes = await fetch(`${API}/admin/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${devAuth.token}`,
      },
      body: JSON.stringify({
        email: "rogue@test.local",
        password: "PasswordTest!1",
        role: "ADMIN",
      }),
    });
    expect(createUserRes.status).toBe(403);
  });
});
