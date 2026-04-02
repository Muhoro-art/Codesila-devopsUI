/**
 * CodeSila E2E Tests — Project Management (TC-PROJ-01 through TC-PROJ-20)
 *
 * Covers: project creation, listing, search/filter, project detail page (tabs),
 * settings editing, archival, team management, RBAC, and navigation.
 *
 * Preconditions: Backend running on localhost:3000, Frontend on localhost:5173.
 * A test admin is registered via the API in beforeAll.
 *
 * Strategy: Auth state is injected into sessionStorage to avoid hitting the
 * /auth/login endpoint (which triggers progressive slow-down middleware).
 */
import { test, expect, type Page } from "@playwright/test";

const API = "http://localhost:3000";

/* ─── Shared test credentials ────────────────────────────── */
const ADMIN_EMAIL = `e2e-proj-admin-${Date.now()}@codesila.local`;
const ADMIN_PASSWORD = "E2eTest!Secure9";
const ADMIN_NAME = "E2E Proj Admin";

const DEV_EMAIL = `e2e-proj-dev-${Date.now()}@codesila.local`;
const DEV_PASSWORD = "E2eTest!Dev1234";

/** Stored auth data for sessionStorage injection */
let adminAuth: { token: string; user: any; organization?: any; refreshToken?: string };
let devAuth: { token: string; user: any; organization?: any; refreshToken?: string };

/** Project created in beforeAll for detail-page tests */
let seedProjectId: string;
let seedProjectName: string;
let seedProjectKey: string;

/* ─── Helpers ────────────────────────────────────────────── */

async function registerAdmin() {
  const res = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyName: "E2E Proj Corp",
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

/** Create a project via API (used in beforeAll to seed data) */
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

/** Add a user as a member of a project via API */
async function apiAddProjectMember(token: string, projectId: string, userId: string) {
  const res = await fetch(`${API}/projects/${projectId}/members`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ userIds: [userId] }),
  });
  // Ignore if already a member
  return res.ok;
}

/** Delete/archive a project via API (cleanup) */
async function apiArchiveProject(token: string, projectId: string) {
  const res = await fetch(`${API}/projects/${projectId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  // Ignore failures during cleanup
  return res.ok;
}

/**
 * Inject auth state into sessionStorage and navigate to a dashboard page.
 * Bypasses login endpoint to avoid rate-limit / slow-down middleware.
 */
async function injectAuthAndGo(
  page: Page,
  auth: { token: string; user: any; organization?: any; refreshToken?: string },
  targetUrl: string,
): Promise<void> {
  // Reset backend rate-limit counters so tests don't hit 429
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

/* ─── All tests run serially ─── */

test.describe("Project Management E2E", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    // Reset rate limits before registering
    await fetch(`${API}/_test/reset-rate-limits`, { method: "POST" }).catch(() => {});

    // Register an admin org + user
    adminAuth = await registerAdmin();

    // Create a dev user
    await createDevUser(adminAuth.token);
    devAuth = await apiLogin(DEV_EMAIL, DEV_PASSWORD);

    // Seed a project for detail-page tests
    seedProjectName = `Seed-Proj-${Date.now()}`;
    seedProjectKey = `SP${Date.now().toString().slice(-4)}`;
    const proj = await apiCreateProject(adminAuth.token, {
      name: seedProjectName,
      key: seedProjectKey,
      description: "E2E seed project for detail tests",
      type: "API",
    });
    seedProjectId = proj.id;

    // Add dev user as member of seed project so DEVELOPER can see it
    await apiAddProjectMember(adminAuth.token, seedProjectId, devAuth.user.id);
  });

  // ═══════════════════════════════════════════════════════════
  // TC-PROJ-01  Projects page loads and shows heading
  // ═══════════════════════════════════════════════════════════
  test("TC-PROJ-01 Projects page loads with heading", async ({ page }) => {
    await injectAuthAndGo(page, adminAuth, "/projects");

    await expect(page.getByRole("heading", { name: /projects/i })).toBeVisible();
  });

  // ═══════════════════════════════════════════════════════════
  // TC-PROJ-02  Seeded project appears in the projects list
  // ═══════════════════════════════════════════════════════════
  test("TC-PROJ-02 Seeded project appears in projects list", async ({ page }) => {
    await injectAuthAndGo(page, adminAuth, "/projects");

    await expect(page.getByText(seedProjectName)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(seedProjectKey)).toBeVisible();
  });

  // ═══════════════════════════════════════════════════════════
  // TC-PROJ-03  Search filters projects in real time
  // ═══════════════════════════════════════════════════════════
  test("TC-PROJ-03 Search filters projects by name", async ({ page }) => {
    await injectAuthAndGo(page, adminAuth, "/projects");

    // Wait for the seed project to appear
    await expect(page.getByText(seedProjectName)).toBeVisible({ timeout: 10_000 });

    // Type a search that won't match any project
    const searchInput = page.locator('input[placeholder="Search projects..."]');
    await searchInput.fill("zzznomatch999");

    // Seed project should be hidden
    await expect(page.getByText(seedProjectName)).not.toBeVisible();
    await expect(page.getByText("No projects match your search.")).toBeVisible();

    // Clear search — seed project reappears
    await searchInput.clear();
    await expect(page.getByText(seedProjectName)).toBeVisible();
  });

  // ═══════════════════════════════════════════════════════════
  // TC-PROJ-04  Clicking a project navigates to project detail
  // ═══════════════════════════════════════════════════════════
  test("TC-PROJ-04 Click project navigates to detail page", async ({ page }) => {
    await injectAuthAndGo(page, adminAuth, "/projects");

    await expect(page.getByText(seedProjectName)).toBeVisible({ timeout: 10_000 });
    await page.getByText(seedProjectName).click();

    await expect(page).toHaveURL(new RegExp(`/project/${seedProjectId}`), { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: seedProjectName })).toBeVisible();
  });

  // ═══════════════════════════════════════════════════════════
  // TC-PROJ-05  Project detail shows quick stats bar
  // ═══════════════════════════════════════════════════════════
  test("TC-PROJ-05 Project detail shows quick stats", async ({ page }) => {
    await injectAuthAndGo(page, adminAuth, `/project/${seedProjectId}`);

    // Stats bar should show Services, Deployments, Incidents, Team, Environments
    await expect(page.getByText("Services").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Deployments").first()).toBeVisible();
    await expect(page.getByText("Incidents").first()).toBeVisible();
    await expect(page.getByText("Team").first()).toBeVisible();
    await expect(page.getByText("Environments").first()).toBeVisible();
  });

  // ═══════════════════════════════════════════════════════════
  // TC-PROJ-06  Project detail tabs are all visible
  // ═══════════════════════════════════════════════════════════
  test("TC-PROJ-06 Project detail shows all tabs", async ({ page }) => {
    await injectAuthAndGo(page, adminAuth, `/project/${seedProjectId}`);

    const expectedTabs = [
      "Overview", "Team", "Services", "Deployments",
      "Incidents", "Runbooks", "Audit", "Integrations",
      "Pipelines", "Settings",
    ];

    for (const tab of expectedTabs) {
      await expect(
        page.locator("button", { hasText: tab }).first(),
      ).toBeVisible({ timeout: 10_000 });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // TC-PROJ-07  Overview tab shows team and deployments sections
  // ═══════════════════════════════════════════════════════════
  test("TC-PROJ-07 Overview tab shows team and deployments", async ({ page }) => {
    await injectAuthAndGo(page, adminAuth, `/project/${seedProjectId}`);

    // Overview is the default tab — should show Team and Recent Deployments headings
    await expect(page.getByText("Team (").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Recent Deployments").first()).toBeVisible();
    await expect(page.getByText("Services (").first()).toBeVisible();
  });

  // ═══════════════════════════════════════════════════════════
  // TC-PROJ-08  Switching to Team tab shows team members section
  // ═══════════════════════════════════════════════════════════
  test("TC-PROJ-08 Team tab shows members section", async ({ page }) => {
    await injectAuthAndGo(page, adminAuth, `/project/${seedProjectId}`);

    // Wait for tabs to render, then click Team tab
    const teamTab = page.locator("button", { hasText: "Team" }).first();
    await teamTab.waitFor({ state: "visible", timeout: 15_000 });
    await teamTab.click();

    // Should see "Team Members" heading and "Add Team Members" section
    await expect(page.getByText("Team Members (").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Add Team Members").first()).toBeVisible();
  });

  // ═══════════════════════════════════════════════════════════
  // TC-PROJ-09  Settings tab shows project information
  // ═══════════════════════════════════════════════════════════
  test("TC-PROJ-09 Settings tab shows project info", async ({ page }) => {
    await injectAuthAndGo(page, adminAuth, `/project/${seedProjectId}`);

    // Click Settings tab
    await page.locator("button", { hasText: "Settings" }).first().click();

    // Should show project settings
    await expect(page.getByText("Project Settings").first()).toBeVisible({ timeout: 10_000 });

    // Key fields should be visible
    await expect(page.getByText("Name").first()).toBeVisible();
    await expect(page.getByText("Key").first()).toBeVisible();
    await expect(page.getByText("Type").first()).toBeVisible();
    await expect(page.getByText("Status").first()).toBeVisible();
  });

  // ═══════════════════════════════════════════════════════════
  // TC-PROJ-10  Edit button in Settings enables editing mode
  // ═══════════════════════════════════════════════════════════
  test("TC-PROJ-10 Settings edit mode enables form fields", async ({ page }) => {
    await injectAuthAndGo(page, adminAuth, `/project/${seedProjectId}`);

    await page.locator("button", { hasText: "Settings" }).first().click();
    await expect(page.getByText("Project Settings").first()).toBeVisible({ timeout: 10_000 });

    // Click Edit
    await page.getByText("Edit").click();

    // Form inputs should appear — Save and Cancel buttons should be visible
    await expect(page.getByRole("button", { name: /save/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /cancel/i })).toBeVisible();
  });

  // ═══════════════════════════════════════════════════════════
  // TC-PROJ-11  Update project name via Settings
  // ═══════════════════════════════════════════════════════════
  test("TC-PROJ-11 Update project name via Settings", async ({ page }) => {
    await injectAuthAndGo(page, adminAuth, `/project/${seedProjectId}`);

    await page.locator("button", { hasText: "Settings" }).first().click();
    await expect(page.getByText("Project Settings").first()).toBeVisible({ timeout: 10_000 });

    // Click Edit
    await page.getByText("Edit").click();

    // Change the name
    const updatedName = `Updated-${Date.now()}`;
    const nameInput = page.locator("label:has-text('Name') + input, label:has-text('Name') ~ input").first();
    // The settings form uses label + input pattern — target the first text input in the edit form
    const nameField = page.locator(".space-y-3 input").first();
    await nameField.clear();
    await nameField.fill(updatedName);

    // Click Save
    await page.getByRole("button", { name: /save/i }).click();

    // After saving, the heading should update
    await expect(page.getByRole("heading", { name: updatedName })).toBeVisible({ timeout: 10_000 });

    // Restore original name for subsequent tests
    seedProjectName = updatedName;
  });

  // ═══════════════════════════════════════════════════════════
  // TC-PROJ-12  Cancel edit discards changes
  // ═══════════════════════════════════════════════════════════
  test("TC-PROJ-12 Cancel edit discards changes", async ({ page }) => {
    await injectAuthAndGo(page, adminAuth, `/project/${seedProjectId}`);

    await page.locator("button", { hasText: "Settings" }).first().click();
    await expect(page.getByText("Project Settings").first()).toBeVisible({ timeout: 10_000 });

    await page.getByText("Edit").click();

    // Type something in the name field
    const nameField = page.locator(".space-y-3 input").first();
    await nameField.clear();
    await nameField.fill("ShouldNotSave");

    // Click Cancel
    await page.getByRole("button", { name: /cancel/i }).click();

    // Edit mode should close — Edit button should reappear
    await expect(page.getByText("Edit").first()).toBeVisible();

    // The heading should still be the original name
    await expect(page.getByRole("heading", { name: seedProjectName })).toBeVisible();
  });

  // ═══════════════════════════════════════════════════════════
  // TC-PROJ-13  Danger Zone — Archive button is visible for active project
  // ═══════════════════════════════════════════════════════════
  test("TC-PROJ-13 Danger Zone shows archive button", async ({ page }) => {
    await injectAuthAndGo(page, adminAuth, `/project/${seedProjectId}`);

    await page.locator("button", { hasText: "Settings" }).first().click();

    // Danger Zone section
    await expect(page.getByText("Danger Zone").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /archive project/i })).toBeVisible();
  });

  // ═══════════════════════════════════════════════════════════
  // TC-PROJ-14  Create project via DevOps projects tab
  // ═══════════════════════════════════════════════════════════
  test("TC-PROJ-14 Create project via DevOps projects tab", async ({ page }) => {
    await injectAuthAndGo(page, adminAuth, "/devops/projects");

    // Click "+ New Project"
    await page.getByRole("button", { name: /new project/i }).click();

    // Fill project form
    const projName = `E2E-Create-${Date.now()}`;
    await page.locator('input[placeholder="Project name"]').fill(projName);

    // Key should auto-populate
    const keyInput = page.locator('input[placeholder="Key (e.g. PROJ)"]');
    await expect(keyInput).not.toHaveValue("");

    // Click Create Project
    await page.getByRole("button", { name: /create project/i }).click();

    // Project should appear in the project list
    await expect(page.getByText(projName)).toBeVisible({ timeout: 15_000 });
  });

  // ═══════════════════════════════════════════════════════════
  // TC-PROJ-15  Empty project name disables Create button
  // ═══════════════════════════════════════════════════════════
  test("TC-PROJ-15 Empty project name disables Create button", async ({ page }) => {
    await injectAuthAndGo(page, adminAuth, "/devops/projects");

    // Open create form
    await page.getByRole("button", { name: /new project/i }).click();

    // Don't fill any fields — Create Project button should be disabled
    const createBtn = page.getByRole("button", { name: /create project/i });
    await expect(createBtn).toBeDisabled();
  });

  // ═══════════════════════════════════════════════════════════
  // TC-PROJ-16  Deployments tab shows deployment history section
  // ═══════════════════════════════════════════════════════════
  test("TC-PROJ-16 Deployments tab shows history section", async ({ page }) => {
    await injectAuthAndGo(page, adminAuth, `/project/${seedProjectId}`);

    // Click Deployments tab
    await page.locator("button", { hasText: "Deployments" }).first().click();

    // Should show Deployment History heading
    await expect(page.getByText("Deployment History").first()).toBeVisible({ timeout: 10_000 });

    // And either deployments or empty state
    const deployOrEmpty = page
      .getByText("No deployments yet.")
      .or(page.locator(".space-y-2 .bg-gray-800\\/50").first());
    await expect(deployOrEmpty.first()).toBeVisible();
  });

  // ═══════════════════════════════════════════════════════════
  // TC-PROJ-17  Incidents tab loads with heading
  // ═══════════════════════════════════════════════════════════
  test("TC-PROJ-17 Incidents tab loads", async ({ page }) => {
    await injectAuthAndGo(page, adminAuth, `/project/${seedProjectId}`);

    await page.locator("button", { hasText: "Incidents" }).first().click();

    await expect(page.getByText("Incidents").nth(1)).toBeVisible({ timeout: 10_000 });

    // Either incidents or empty state
    const incidentsOrEmpty = page
      .getByText("No incidents.")
      .or(page.locator(".space-y-3 .bg-gray-800\\/50").first());
    await expect(incidentsOrEmpty.first()).toBeVisible();
  });

  // ═══════════════════════════════════════════════════════════
  // TC-PROJ-18  Pipelines tab shows pipeline manager link
  // ═══════════════════════════════════════════════════════════
  test("TC-PROJ-18 Pipelines tab shows pipeline manager", async ({ page }) => {
    await injectAuthAndGo(page, adminAuth, `/project/${seedProjectId}`);

    await page.locator("button", { hasText: "Pipelines" }).first().click();

    await expect(page.getByText("CI/CD Pipelines").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /open pipeline manager/i })).toBeVisible();
  });

  // ═══════════════════════════════════════════════════════════
  // TC-PROJ-19  Back button navigates away from project detail
  // ═══════════════════════════════════════════════════════════
  test("TC-PROJ-19 Back button navigates away from detail", async ({ page }) => {
    // Navigate to projects list first, then open project detail
    await injectAuthAndGo(page, adminAuth, "/projects");
    await expect(page.getByText(seedProjectName)).toBeVisible({ timeout: 10_000 });
    await page.getByText(seedProjectName).click();
    await expect(page).toHaveURL(new RegExp(`/project/${seedProjectId}`), { timeout: 10_000 });

    // Click "Back" button
    await page.getByRole("button", { name: "Back" }).click();

    // Should navigate back to /projects
    await expect(page).toHaveURL(/\/projects/, { timeout: 10_000 });
  });

  // ═══════════════════════════════════════════════════════════
  // TC-PROJ-20  Developer can access /projects page
  // ═══════════════════════════════════════════════════════════
  test("TC-PROJ-20 Developer can view projects page", async ({ page }) => {
    await injectAuthAndGo(page, devAuth, "/projects");

    // Developer should see the Projects heading
    await expect(page.getByRole("heading", { name: /projects/i })).toBeVisible({ timeout: 10_000 });

    // Seed project should be visible (shared across org)
    await expect(page.getByText(seedProjectName)).toBeVisible({ timeout: 10_000 });
  });

  // ═══════════════════════════════════════════════════════════
  // TC-PROJ-21  Developer can open project detail
  // ═══════════════════════════════════════════════════════════
  test("TC-PROJ-21 Developer can open project detail", async ({ page }) => {
    await injectAuthAndGo(page, devAuth, `/project/${seedProjectId}`);

    await expect(page.getByRole("heading", { name: seedProjectName })).toBeVisible({ timeout: 10_000 });

    // Tabs should be visible
    await expect(page.locator("button", { hasText: "Overview" }).first()).toBeVisible();
  });

  // ═══════════════════════════════════════════════════════════
  // TC-PROJ-22  Sidebar Projects link navigates to /projects
  // ═══════════════════════════════════════════════════════════
  test("TC-PROJ-22 Sidebar Projects link navigates correctly", async ({ page }) => {
    await injectAuthAndGo(page, adminAuth, "/admin");

    // Click Projects in sidebar
    await page.locator("aside").getByText("Projects").click();
    await expect(page).toHaveURL(/\/projects/, { timeout: 10_000 });
  });

  // ═══════════════════════════════════════════════════════════
  // TC-PROJ-23  Integrations tab shows GitHub section
  // ═══════════════════════════════════════════════════════════
  test("TC-PROJ-23 Integrations tab shows GitHub section", async ({ page }) => {
    await injectAuthAndGo(page, adminAuth, `/project/${seedProjectId}`);

    await page.locator("button", { hasText: "Integrations" }).first().click();

    // GitHub Connection section should be visible
    await expect(page.getByText("GitHub Connection").first()).toBeVisible({ timeout: 10_000 });

    // Either connected state or connect prompt
    const githubState = page
      .getByText("Connected to")
      .or(page.getByText("Connect GitHub"))
      .or(page.getByText("GitHub is not connected"));
    await expect(githubState.first()).toBeVisible();

    // Linked Repositories section
    await expect(page.getByText("Linked Repositories").first()).toBeVisible();
  });

  // ═══════════════════════════════════════════════════════════
  // TC-PROJ-24  Audit tab loads
  // ═══════════════════════════════════════════════════════════
  test("TC-PROJ-24 Audit tab loads", async ({ page }) => {
    await injectAuthAndGo(page, adminAuth, `/project/${seedProjectId}`);

    await page.locator("button", { hasText: "Audit" }).first().click();

    await expect(page.getByText("Audit Trail").first()).toBeVisible({ timeout: 10_000 });

    // Either audit events or empty state
    const auditOrEmpty = page
      .getByText("No audit events.")
      .or(page.locator(".space-y-2 .bg-gray-800\\/50").first());
    await expect(auditOrEmpty.first()).toBeVisible();
  });

  // ═══════════════════════════════════════════════════════════
  // TC-PROJ-25  Archive project via Settings and verify redirect
  // ═══════════════════════════════════════════════════════════
  test("TC-PROJ-25 Archive project and verify navigation", async ({ page }) => {
    // Create a disposable project for archival
    const archiveName = `E2E-Archive-${Date.now()}`;
    const archiveKey = `AR${Date.now().toString().slice(-4)}`;
    const proj = await apiCreateProject(adminAuth.token, {
      name: archiveName,
      key: archiveKey,
      type: "WEB",
    });

    await injectAuthAndGo(page, adminAuth, `/project/${proj.id}`);

    // Go to Settings tab
    await page.locator("button", { hasText: "Settings" }).first().click();
    await expect(page.getByText("Danger Zone").first()).toBeVisible({ timeout: 10_000 });

    // Accept the confirmation dialog
    page.on("dialog", (dialog) => dialog.accept());

    // Click Archive Project
    await page.getByRole("button", { name: /archive project/i }).click();

    // Should navigate away (back to previous page)
    await expect(page).not.toHaveURL(new RegExp(`/project/${proj.id}`), { timeout: 15_000 });
  });

}); // end describe
