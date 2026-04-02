/**
 * TC-FE-06  Pipeline YAML editor blocks invalid configuration
 * TC-FE-07  Valid pipeline can be created and executed from UI
 * TC-FE-08  Live log viewer receives streaming output
 * TC-FE-09  Cancel action updates UI and final run state
 */
import { render, screen, waitFor, within, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, type Mock } from "vitest";

/* ─── Mocks ──────────────────────────────────────────────── */

const mockNavigate = vi.fn();
const mockProjectId = "proj-001";

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom"
  );
  return {
    ...actual,
    useParams: () => ({ projectId: mockProjectId }),
    useNavigate: () => mockNavigate,
  };
});

// Monaco Editor mock — renders a <textarea> so we can type YAML
vi.mock("@monaco-editor/react", () => ({
  default: ({ value, onChange, options }: any) => (
    <textarea
      data-testid="yaml-editor"
      data-readonly={options?.readOnly ? "true" : "false"}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));

vi.mock("../../api/cicd");
vi.mock("../../api/projects");

const {
  listPipelines,
  createPipeline,
  updatePipeline,
  deletePipeline,
  listPipelineRuns,
  triggerPipelineRun,
  cancelPipelineRun,
  getRunSteps,
  getStepLogs,
  getPipelineRun,
  subscribePipelineLogs,
} = await import("../../api/cicd");

const { getProject } = await import("../../api/projects");

// Dynamic import of component AFTER mocks are set up
const { default: PipelinesPage } = await import("../PipelinesPage");

/* ─── Helpers ────────────────────────────────────────────── */

const VALID_YAML = `stages:
  - name: build
    image: node:20-alpine
    commands:
      - npm ci
      - npm run build
`;

const MALFORMED_YAML = `stages:
  - name: build
    image: node:20-alpine
    commands: [
      incomplete array
    invalid_indentation
  extra: {{{{
`;

const mockProject = {
  id: mockProjectId,
  name: "Test Project",
  key: "TP",
  type: "WEB" as const,
  status: "ACTIVE",
  orgId: "org-1",
  ownerId: "user-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const mockPipeline = {
  id: "pipe-001",
  name: "CI Pipeline",
  project_id: mockProjectId,
  config_yaml: VALID_YAML,
  created_at: "2026-01-01T00:00:00Z",
};

function setupDefaults() {
  (getProject as Mock).mockResolvedValue(mockProject);
  (listPipelines as Mock).mockResolvedValue([]);
  (listPipelineRuns as Mock).mockResolvedValue({ data: [], meta: { total: 0, page: 1, limit: 20 } });
  (createPipeline as Mock).mockResolvedValue({ id: "pipe-new", name: "New Pipeline" });
  (triggerPipelineRun as Mock).mockResolvedValue({ runId: "run-001", status: "QUEUED" });
  (cancelPipelineRun as Mock).mockResolvedValue(undefined);
  (getRunSteps as Mock).mockResolvedValue([]);
  (getStepLogs as Mock).mockResolvedValue({ logs: "" });
  (getPipelineRun as Mock).mockResolvedValue({ id: "run-001", status: "QUEUED", pipeline_id: "pipe-001", triggered_by: null, branch: null, commit_sha: null, created_at: "2026-01-01T00:00:00Z", started_at: null, finished_at: null });
  (subscribePipelineLogs as Mock).mockReturnValue(() => {});
}

/* ─── Tests ──────────────────────────────────────────────── */

describe("TC-FE-06: Pipeline YAML editor blocks invalid configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
  });

  it("shows save button disabled when pipeline name is empty", async () => {
    render(<PipelinesPage />);

    // Click "New Pipeline" to enter create mode
    await userEvent.click(await screen.findByText("New Pipeline"));

    // Name input is empty, Save should be disabled
    const saveBtn = screen.getByRole("button", { name: /save/i });
    expect(saveBtn).toBeDisabled();
  });

  it("shows save button disabled when YAML is empty", async () => {
    render(<PipelinesPage />);

    await userEvent.click(await screen.findByText("New Pipeline"));

    // Type a name but clear the YAML editor
    await userEvent.type(screen.getByPlaceholderText("Pipeline name"), "My Pipeline");

    // Clear the yaml editor
    const editor = screen.getByTestId("yaml-editor");
    await userEvent.clear(editor);

    const saveBtn = screen.getByRole("button", { name: /save/i });
    expect(saveBtn).toBeDisabled();
  });

  it("displays error message when backend rejects malformed YAML", async () => {
    (createPipeline as Mock).mockRejectedValue(new Error("Invalid YAML configuration"));

    render(<PipelinesPage />);

    await userEvent.click(await screen.findByText("New Pipeline"));
    await userEvent.type(screen.getByPlaceholderText("Pipeline name"), "Bad Pipeline");

    // Set malformed YAML via fireEvent (userEvent.type interprets { as keyboard descriptors)
    const editor = screen.getByTestId("yaml-editor");
    fireEvent.change(editor, { target: { value: MALFORMED_YAML } });

    // Attempt save
    const saveBtn = screen.getByRole("button", { name: /save/i });
    await userEvent.click(saveBtn);

    // Validation error shown
    await waitFor(() => {
      expect(screen.getByText("Invalid YAML configuration")).toBeInTheDocument();
    });

    // Pipeline not saved — createPipeline was called but failed
    expect(createPipeline).toHaveBeenCalledTimes(1);
  });

  it("does NOT save pipeline when backend validation fails", async () => {
    (createPipeline as Mock).mockRejectedValue(new Error("YAML parse error at line 7"));

    render(<PipelinesPage />);

    await userEvent.click(await screen.findByText("New Pipeline"));
    await userEvent.type(screen.getByPlaceholderText("Pipeline name"), "Bad Pipeline");

    const editor = screen.getByTestId("yaml-editor");
    fireEvent.change(editor, { target: { value: MALFORMED_YAML } });

    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(screen.getByText("YAML parse error at line 7")).toBeInTheDocument();
    });

    // Editor should still be in create mode (not switched to view mode)
    expect(screen.getByPlaceholderText("Pipeline name")).toBeInTheDocument();
  });
});

describe("TC-FE-07: Valid pipeline can be created and executed from UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
  });

  it("creates a valid pipeline and shows it in the list", async () => {
    const createdPipeline = { id: "pipe-new", name: "Deploy Pipeline", project_id: mockProjectId, config_yaml: VALID_YAML, created_at: "2026-03-20T00:00:00Z" };
    (createPipeline as Mock).mockResolvedValue(createdPipeline);
    // After creating, refresh should return the new pipeline
    (listPipelines as Mock)
      .mockResolvedValueOnce([]) // initial load
      .mockResolvedValue([createdPipeline]); // after create

    render(<PipelinesPage />);

    await userEvent.click(await screen.findByText("New Pipeline"));
    await userEvent.type(screen.getByPlaceholderText("Pipeline name"), "Deploy Pipeline");

    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(createPipeline).toHaveBeenCalledWith(
        mockProjectId,
        "Deploy Pipeline",
        expect.any(String)
      );
    });

    // Pipeline appears in the list after refresh — may appear multiple times (sidebar + heading)
    await waitFor(() => {
      expect(screen.getAllByText("Deploy Pipeline").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("triggers a run and shows QUEUED status", async () => {
    const pipeline = { ...mockPipeline };
    (listPipelines as Mock).mockResolvedValue([pipeline]);
    const run = {
      id: "run-001",
      pipeline_id: pipeline.id,
      status: "QUEUED" as const,
      triggered_by: null,
      branch: "main",
      commit_sha: null,
      created_at: "2026-03-20T00:00:00Z",
      started_at: null,
      finished_at: null,
    };
    (listPipelineRuns as Mock)
      .mockResolvedValueOnce({ data: [], meta: { total: 0, page: 1, limit: 20 } })
      .mockResolvedValue({ data: [run], meta: { total: 1, page: 1, limit: 20 } });

    render(<PipelinesPage />);

    // Select the pipeline
    await userEvent.click(await screen.findByText("CI Pipeline"));

    // Type branch and trigger run
    await userEvent.type(screen.getByPlaceholderText(/branch/i), "main");
    await userEvent.click(screen.getByRole("button", { name: /run pipeline/i }));

    await waitFor(() => {
      expect(triggerPipelineRun).toHaveBeenCalledWith(pipeline.id, { branch: "main" });
    });

    // Status should update to show run
    await waitFor(() => {
      expect(screen.getByText("QUEUED")).toBeInTheDocument();
    });
  });

  it("pipeline save succeeds and editor exits create mode", async () => {
    const createdPipeline = { id: "pipe-new", name: "My New Pipeline", project_id: mockProjectId, config_yaml: VALID_YAML, created_at: "2026-03-20T00:00:00Z" };
    (createPipeline as Mock).mockResolvedValue(createdPipeline);
    (listPipelines as Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValue([createdPipeline]);

    render(<PipelinesPage />);

    await userEvent.click(await screen.findByText("New Pipeline"));

    // Verify we're in create mode
    expect(screen.getByPlaceholderText("Pipeline name")).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("Pipeline name"), "My New Pipeline");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    // After successful save, name input should disappear (editor exits create mode)
    await waitFor(() => {
      expect(screen.queryByPlaceholderText("Pipeline name")).not.toBeInTheDocument();
    });
  });
});

describe("TC-FE-08: Live log viewer receives streaming output", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
  });

  it("subscribes to SSE when viewing an active run", async () => {
    const pipeline = { ...mockPipeline };
    (listPipelines as Mock).mockResolvedValue([pipeline]);

    const activeRun = {
      id: "run-live",
      pipeline_id: pipeline.id,
      status: "RUNNING" as const,
      triggered_by: null,
      branch: "main",
      commit_sha: null,
      created_at: "2026-03-20T00:00:00Z",
      started_at: "2026-03-20T00:00:01Z",
      finished_at: null,
    };
    (listPipelineRuns as Mock).mockResolvedValue({
      data: [activeRun],
      meta: { total: 1, page: 1, limit: 20 },
    });
    (getRunSteps as Mock).mockResolvedValue([
      { id: "step-1", run_id: "run-live", name: "build", status: "RUNNING", sort_order: 1, started_at: "2026-03-20T00:00:01Z", finished_at: null },
    ]);

    // Track SSE subscription
    const sseCleanup = vi.fn();
    let sseCallback: ((event: { type: string; data: any }) => void) | null = null;
    (subscribePipelineLogs as Mock).mockImplementation((_runId: string, cb: any) => {
      sseCallback = cb;
      return sseCleanup;
    });

    render(<PipelinesPage />);

    // Select pipeline
    await userEvent.click(await screen.findByText("CI Pipeline"));

    // Click run to open detail
    await waitFor(() => {
      expect(screen.getByText("RUNNING")).toBeInTheDocument();
    });

    // Click on the run row
    const runRow = screen.getByText("RUNNING").closest("[class*='cursor-pointer']");
    if (runRow) await userEvent.click(runRow);

    await waitFor(() => {
      expect(subscribePipelineLogs).toHaveBeenCalledWith("run-live", expect.any(Function));
    });

    // Live indicator should be visible
    await waitFor(() => {
      expect(screen.getByText("Live")).toBeInTheDocument();
    });
  });

  it("displays log lines delivered via SSE", async () => {
    const pipeline = { ...mockPipeline };
    (listPipelines as Mock).mockResolvedValue([pipeline]);

    const activeRun = {
      id: "run-live",
      pipeline_id: pipeline.id,
      status: "RUNNING" as const,
      triggered_by: null,
      branch: null,
      commit_sha: null,
      created_at: "2026-03-20T00:00:00Z",
      started_at: "2026-03-20T00:00:01Z",
      finished_at: null,
    };
    (listPipelineRuns as Mock).mockResolvedValue({
      data: [activeRun],
      meta: { total: 1, page: 1, limit: 20 },
    });

    const step = { id: "step-1", run_id: "run-live", name: "build", status: "RUNNING", sort_order: 1, started_at: "2026-03-20T00:00:01Z", finished_at: null };
    (getRunSteps as Mock).mockResolvedValue([step]);

    let sseCallback: ((event: { type: string; data: any }) => void) | null = null;
    (subscribePipelineLogs as Mock).mockImplementation((_runId: string, cb: any) => {
      sseCallback = cb;
      return () => {};
    });

    render(<PipelinesPage />);

    // Select pipeline
    await userEvent.click(await screen.findByText("CI Pipeline"));

    // Click the run
    await waitFor(() => expect(screen.getByText("RUNNING")).toBeInTheDocument());
    const runRow = screen.getByText("RUNNING").closest("[class*='cursor-pointer']");
    if (runRow) await userEvent.click(runRow);

    // Wait for SSE subscription
    await waitFor(() => expect(sseCallback).not.toBeNull());

    // Expand the step to see logs
    await waitFor(() => expect(screen.getByText("build")).toBeInTheDocument());
    await userEvent.click(screen.getByText("build"));

    // Simulate SSE log events
    act(() => {
      sseCallback!({ type: "log", data: { stepId: "step-1", line: "Installing dependencies..." } });
      sseCallback!({ type: "log", data: { stepId: "step-1", line: "Build completed successfully" } });
    });

    // At least one new log line appears
    await waitFor(() => {
      expect(screen.getByText(/Installing dependencies/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Build completed successfully/)).toBeInTheDocument();
  });
});

describe("TC-FE-09: Cancel action updates UI and final run state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
  });

  it("shows Cancel button for RUNNING runs", async () => {
    const pipeline = { ...mockPipeline };
    (listPipelines as Mock).mockResolvedValue([pipeline]);

    const runningRun = {
      id: "run-cancel",
      pipeline_id: pipeline.id,
      status: "RUNNING" as const,
      triggered_by: null,
      branch: null,
      commit_sha: null,
      created_at: "2026-03-20T00:00:00Z",
      started_at: "2026-03-20T00:00:01Z",
      finished_at: null,
    };
    (listPipelineRuns as Mock).mockResolvedValue({
      data: [runningRun],
      meta: { total: 1, page: 1, limit: 20 },
    });

    render(<PipelinesPage />);

    await userEvent.click(await screen.findByText("CI Pipeline"));

    await waitFor(() => {
      expect(screen.getByText("Cancel")).toBeInTheDocument();
    });
  });

  it("does NOT show Cancel button for completed runs", async () => {
    const pipeline = { ...mockPipeline };
    (listPipelines as Mock).mockResolvedValue([pipeline]);

    const completedRun = {
      id: "run-done",
      pipeline_id: pipeline.id,
      status: "SUCCESS" as const,
      triggered_by: null,
      branch: null,
      commit_sha: null,
      created_at: "2026-03-20T00:00:00Z",
      started_at: "2026-03-20T00:00:01Z",
      finished_at: "2026-03-20T00:00:10Z",
    };
    (listPipelineRuns as Mock).mockResolvedValue({
      data: [completedRun],
      meta: { total: 1, page: 1, limit: 20 },
    });

    render(<PipelinesPage />);

    await userEvent.click(await screen.findByText("CI Pipeline"));

    await waitFor(() => {
      expect(screen.getByText("SUCCESS")).toBeInTheDocument();
    });

    expect(screen.queryByText("Cancel")).not.toBeInTheDocument();
  });

  it("calls cancelPipelineRun and refreshes run list on cancel click", async () => {
    const pipeline = { ...mockPipeline };
    (listPipelines as Mock).mockResolvedValue([pipeline]);

    const runningRun = {
      id: "run-cancel",
      pipeline_id: pipeline.id,
      status: "RUNNING" as const,
      triggered_by: null,
      branch: null,
      commit_sha: null,
      created_at: "2026-03-20T00:00:00Z",
      started_at: "2026-03-20T00:00:01Z",
      finished_at: null,
    };
    const cancelledRun = { ...runningRun, status: "CANCELLED" as const, finished_at: "2026-03-20T00:01:00Z" };

    (listPipelineRuns as Mock)
      .mockResolvedValueOnce({ data: [runningRun], meta: { total: 1, page: 1, limit: 20 } })
      .mockResolvedValue({ data: [cancelledRun], meta: { total: 1, page: 1, limit: 20 } });

    render(<PipelinesPage />);

    await userEvent.click(await screen.findByText("CI Pipeline"));

    await waitFor(() => {
      expect(screen.getByText("Cancel")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Cancel"));

    await waitFor(() => {
      expect(cancelPipelineRun).toHaveBeenCalledWith("run-cancel");
    });

    // After cancel, run list refreshed — should show CANCELLED status
    await waitFor(() => {
      expect(screen.getByText("CANCELLED")).toBeInTheDocument();
    });
  });

  it("shows CANCELLED status when SSE reports cancellation on run detail", async () => {
    const pipeline = { ...mockPipeline };
    (listPipelines as Mock).mockResolvedValue([pipeline]);

    const runningRun = {
      id: "run-sse-cancel",
      pipeline_id: pipeline.id,
      status: "RUNNING" as const,
      triggered_by: null,
      branch: null,
      commit_sha: null,
      created_at: "2026-03-20T00:00:00Z",
      started_at: "2026-03-20T00:00:01Z",
      finished_at: null,
    };
    (listPipelineRuns as Mock).mockResolvedValue({
      data: [runningRun],
      meta: { total: 1, page: 1, limit: 20 },
    });
    (getRunSteps as Mock).mockResolvedValue([]);

    let sseCallback: ((event: { type: string; data: any }) => void) | null = null;
    (subscribePipelineLogs as Mock).mockImplementation((_runId: string, cb: any) => {
      sseCallback = cb;
      return () => {};
    });
    // Override getPipelineRun for polling
    (getPipelineRun as Mock).mockResolvedValue(runningRun);

    render(<PipelinesPage />);

    await userEvent.click(await screen.findByText("CI Pipeline"));

    // Open run detail
    await waitFor(() => expect(screen.getByText("RUNNING")).toBeInTheDocument());
    const runRow = screen.getByText("RUNNING").closest("[class*='cursor-pointer']");
    if (runRow) await userEvent.click(runRow);

    await waitFor(() => expect(sseCallback).not.toBeNull());

    // SSE delivers cancelled status
    act(() => {
      sseCallback!({ type: "run_status", data: { status: "CANCELLED" } });
    });

    await waitFor(() => {
      expect(screen.getByText("CANCELLED")).toBeInTheDocument();
    });
  });
});
