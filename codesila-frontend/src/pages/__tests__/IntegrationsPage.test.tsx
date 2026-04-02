/**
 * TC-FE-10  Integration form reports invalid credentials
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, type Mock } from "vitest";

/* ─── Mocks ──────────────────────────────────────────────── */

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom"
  );
  return { ...actual, useNavigate: () => vi.fn(), useParams: () => ({}) };
});

vi.mock("../../api/integrationMgmt");

const {
  listIntegrations,
  createIntegration,
  deleteIntegration,
  listIntegrationRepos,
  listBranches,
} = await import("../../api/integrationMgmt");

const { default: IntegrationsPage } = await import("../IntegrationsPage");

/* ─── Helpers ────────────────────────────────────────────── */

function setupDefaults() {
  (listIntegrations as Mock).mockResolvedValue([]);
  (createIntegration as Mock).mockResolvedValue({
    id: "int-1",
    type: "github",
    name: "Test",
    owner_scope: "org",
    created_at: "2026-01-01T00:00:00Z",
  });
}

/* ─── Tests ──────────────────────────────────────────────── */

describe("TC-FE-10: Integration form reports invalid credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
  });

  it("shows error message when backend rejects credentials", async () => {
    (createIntegration as Mock).mockRejectedValue(
      new Error("Bad credentials – token verification failed")
    );

    render(<IntegrationsPage />);

    // Open create modal
    await userEvent.click(await screen.findByText("Add Integration"));

    // Fill form
    await userEvent.type(
      screen.getByPlaceholderText("e.g. My GitHub Account"),
      "Invalid GitHub"
    );
    await userEvent.type(
      screen.getByPlaceholderText("ghp_... or glpat-..."),
      "ghp_bad_token_12345"
    );

    // Submit
    await userEvent.click(screen.getByText("Connect"));

    // Error displayed
    await waitFor(() => {
      expect(
        screen.getByText("Bad credentials – token verification failed")
      ).toBeInTheDocument();
    });

    // createIntegration was called once
    expect(createIntegration).toHaveBeenCalledTimes(1);
    expect(createIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "github",
        name: "Invalid GitHub",
        token: "ghp_bad_token_12345",
      })
    );
  });

  it("does NOT close the modal when creation fails", async () => {
    (createIntegration as Mock).mockRejectedValue(
      new Error("Unauthorized")
    );

    render(<IntegrationsPage />);

    await userEvent.click(await screen.findByText("Add Integration"));

    await userEvent.type(
      screen.getByPlaceholderText("e.g. My GitHub Account"),
      "Bad account"
    );
    await userEvent.type(
      screen.getByPlaceholderText("ghp_... or glpat-..."),
      "ghp_nope"
    );

    await userEvent.click(screen.getByText("Connect"));

    await waitFor(() => {
      expect(screen.getByText("Unauthorized")).toBeInTheDocument();
    });

    // Modal should still be open (we can still see the form fields)
    expect(screen.getByText("New Integration")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. My GitHub Account")).toBeInTheDocument();
  });

  it("keeps integration list empty when credentials fail", async () => {
    (createIntegration as Mock).mockRejectedValue(
      new Error("Invalid token")
    );
    // list stays empty regardless — no new integration added
    (listIntegrations as Mock).mockResolvedValue([]);

    render(<IntegrationsPage />);

    await userEvent.click(await screen.findByText("Add Integration"));

    await userEvent.type(
      screen.getByPlaceholderText("e.g. My GitHub Account"),
      "Fail"
    );
    await userEvent.type(
      screen.getByPlaceholderText("ghp_... or glpat-..."),
      "ghp_wrong"
    );

    await userEvent.click(screen.getByText("Connect"));

    await waitFor(() => {
      expect(screen.getByText("Invalid token")).toBeInTheDocument();
    });

    // Integration list still shows empty state message
    expect(screen.getByText("No Integrations")).toBeInTheDocument();
  });

  it("Connect button is disabled when name or token is empty", async () => {
    render(<IntegrationsPage />);

    await userEvent.click(await screen.findByText("Add Integration"));

    // Both empty — Connect button disabled
    const connectBtn = screen.getByText("Connect");
    expect(connectBtn).toBeDisabled();

    // Only name — still disabled
    await userEvent.type(
      screen.getByPlaceholderText("e.g. My GitHub Account"),
      "Name only"
    );
    expect(connectBtn).toBeDisabled();

    // Add token — now enabled
    await userEvent.type(
      screen.getByPlaceholderText("ghp_... or glpat-..."),
      "ghp_realtoken"
    );
    expect(connectBtn).not.toBeDisabled();
  });

  it("reports error for bad GitLab credentials", async () => {
    (createIntegration as Mock).mockRejectedValue(
      new Error("GitLab token invalid or insufficient scopes")
    );

    render(<IntegrationsPage />);

    await userEvent.click(await screen.findByText("Add Integration"));

    // Switch to GitLab
    await userEvent.selectOptions(
      screen.getByDisplayValue("GitHub (PAT)"),
      "gitlab"
    );

    await userEvent.type(
      screen.getByPlaceholderText("e.g. My GitHub Account"),
      "Bad GitLab"
    );
    await userEvent.type(
      screen.getByPlaceholderText("ghp_... or glpat-..."),
      "glpat-bad"
    );

    await userEvent.click(screen.getByText("Connect"));

    await waitFor(() => {
      expect(
        screen.getByText("GitLab token invalid or insufficient scopes")
      ).toBeInTheDocument();
    });

    expect(createIntegration).toHaveBeenCalledWith(
      expect.objectContaining({ type: "gitlab", token: "glpat-bad" })
    );
  });
});
