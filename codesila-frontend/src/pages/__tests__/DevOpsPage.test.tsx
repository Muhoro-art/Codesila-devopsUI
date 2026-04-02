/**
 * TC-FE-11  Dashboard displays metrics accurately
 */
import { render, screen, waitFor } from "@testing-library/react";
import { vi, type Mock } from "vitest";

/* ─── Mocks ──────────────────────────────────────────────── */

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom"
  );
  return {
    ...actual,
    useLocation: () => ({ pathname: "/devops" }),
    useNavigate: () => mockNavigate,
    Link: ({ children, to, ...props }: any) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  };
});

vi.mock("../../contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u-1", name: "Admin", email: "admin@codesila.io", role: "ADMIN" },
    organization: { id: "org-1", name: "CodeSila" },
    token: "test-token",
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
    setOrganization: vi.fn(),
  }),
}));

vi.mock("../../api/devflow");
vi.mock("../../api/projects");
vi.mock("../../api/auth");

const {
  getInsights,
  listAuditEvents,
  listProjects: listDevflowProjects,
  listDeployments,
  listServices,
  listIncidents,
} = await import("../../api/devflow");
const { listProjects: listCoreProjects } = await import("../../api/projects");
const { listUsers } = await import("../../api/auth");

const { default: DevOpsPage } = await import("../DevOpsPage");

/* ─── Fixtures ───────────────────────────────────────────── */

const MOCK_INSIGHTS = {
  deployments: [
    { id: "dep-1", service: "api", project: "proj-1", version: "v1.0.0", environment: "DEV", status: "SUCCEEDED", startedAt: "2026-03-01T10:00:00Z", finishedAt: "2026-03-01T10:05:00Z" },
    { id: "dep-2", service: "web", project: "proj-1", version: "v1.1.0", environment: "STAGING", status: "IN_PROGRESS", startedAt: "2026-03-02T12:00:00Z" },
    { id: "dep-3", service: "worker", project: "proj-2", version: "v2.0.0", environment: "PROD", status: "SUCCEEDED", startedAt: "2026-03-03T08:00:00Z", finishedAt: "2026-03-03T08:12:00Z" },
  ],
  deploymentStats: { meanDurationMinutes: 4.3, windowDays: 7 },
  deploymentActors: [],
  incidents: [
    { id: "inc-1", project: "proj-1", service: "api", severity: "HIGH", status: "OPEN", summary: "API latency spike", startedAt: "2026-03-02T14:00:00Z" },
    { id: "inc-2", project: "proj-2", service: "worker", severity: "MEDIUM", status: "INVESTIGATING", summary: "Memory leak in worker", startedAt: "2026-03-03T09:00:00Z" },
  ],
  degradedServices: [
    { id: "svc-1", name: "api-gateway" },
  ],
  runbookUpdates: [],
};

const MOCK_PROJECTS = [
  { id: "proj-1", name: "Platform", key: "PLT", type: "WEB", status: "ACTIVE" },
  { id: "proj-2", name: "Backend API", key: "BAPI", type: "API", status: "ACTIVE" },
];

const MOCK_DEPLOYMENTS = [
  { id: "dep-1", orgId: "org-1", projectId: "proj-1", serviceId: "svc-1", environment: "DEV", version: "v1.0.0", status: "SUCCEEDED", startedAt: "2026-03-01T10:00:00Z" },
];

/* ─── Helpers ────────────────────────────────────────────── */

function setupDefaults() {
  (getInsights as Mock).mockResolvedValue(MOCK_INSIGHTS);
  (listAuditEvents as Mock).mockResolvedValue([]);
  (listDevflowProjects as Mock).mockResolvedValue(MOCK_PROJECTS);
  (listDeployments as Mock).mockResolvedValue(MOCK_DEPLOYMENTS);
  (listServices as Mock).mockResolvedValue([]);
  (listIncidents as Mock).mockResolvedValue([]);
  (listCoreProjects as Mock).mockResolvedValue([]);
  (listUsers as Mock).mockResolvedValue([]);
}

/* ─── Tests ──────────────────────────────────────────────── */

describe("TC-FE-11: Dashboard displays metrics accurately", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
  });

  it("renders Quick Stats section with correct deployment count", async () => {
    render(<DevOpsPage />);

    await waitFor(() => {
      // 3 deployments in insights — may appear in multiple places (Quick Stats, etc.)
      expect(screen.getAllByText("3").length).toBeGreaterThanOrEqual(1);
    });

    // "Deployments" label in Quick Stats
    expect(screen.getAllByText("Deployments").length).toBeGreaterThanOrEqual(1);
  });

  it("displays correct incident count from insights", async () => {
    render(<DevOpsPage />);

    await waitFor(() => {
      // 2 incidents
      expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.getAllByText("Incidents").length).toBeGreaterThanOrEqual(1);
  });

  it("shows degraded services count", async () => {
    render(<DevOpsPage />);

    await waitFor(() => {
      // 1 degraded service
      expect(screen.getAllByText("1").length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.getAllByText(/Degraded/i).length).toBeGreaterThanOrEqual(1);
  });

  it("shows mean deploy time from insights", async () => {
    render(<DevOpsPage />);

    await waitFor(() => {
      // meanDurationMinutes: 4.3 → "4.3m"
      expect(screen.getAllByText("4.3m").length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.getAllByText(/Avg Deploy/i).length).toBeGreaterThanOrEqual(1);
  });

  it("renders project names in Projects section", async () => {
    render(<DevOpsPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Platform").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getAllByText("Backend API").length).toBeGreaterThanOrEqual(1);
  });

  it("shows '—' for mean deploy time when data is null", async () => {
    (getInsights as Mock).mockResolvedValue({
      ...MOCK_INSIGHTS,
      deploymentStats: { meanDurationMinutes: null, windowDays: 7 },
    });

    render(<DevOpsPage />);

    await waitFor(() => {
      expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows 'No data' when insights fetch fails", async () => {
    (getInsights as Mock).mockRejectedValue(new Error("Network error"));

    render(<DevOpsPage />);

    await waitFor(() => {
      expect(screen.getByText("No data")).toBeInTheDocument();
    });
  });

  it("calls getInsights on mount", async () => {
    render(<DevOpsPage />);

    await waitFor(() => {
      expect(getInsights).toHaveBeenCalledTimes(1);
    });
  });
});
