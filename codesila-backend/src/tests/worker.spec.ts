/**
 * Pipeline Worker & DockerRunner Tests — TC-WORKER-01 through TC-WORKER-18
 *
 * Unit tests for:
 *  - Pipeline execution engine (executePipeline) — status transitions,
 *    allow_failure, error propagation, log streaming
 *  - DockerRunner — container lifecycle, resource limits, security,
 *    exit codes, log decoding, cleanup
 *  - Encryption round-trip (encrypt/decrypt integrity)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DockerRunner } from "../modules/devflow/conveyor/docker-runner";
import type { DockerClient, DockerContainer_I } from "../modules/devflow/conveyor/docker-runner";
import { executePipeline } from "../modules/devflow/conveyor/pipeline-executor";
import type { PipelineConfig, RunCallbacks } from "../modules/devflow/conveyor/pipeline-executor";
import { encrypt, decrypt } from "../shared/security/encryption";

/* ─── Helpers: mock Docker client factories ──────────────── */

function mockContainer(overrides: Partial<DockerContainer_I> = {}): DockerContainer_I {
  return {
    logs: vi.fn().mockReturnValue([]),
    wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function mockClient(container?: DockerContainer_I): { client: DockerClient; containerSpy: DockerContainer_I } {
  const c = container ?? mockContainer();
  const client: DockerClient = {
    containers: {
      run: vi.fn().mockResolvedValue(c),
    },
  };
  return { client, containerSpy: c };
}

function makeCallbacks(overrides: Partial<RunCallbacks> = {}): RunCallbacks & {
  updateRunStatus: ReturnType<typeof vi.fn>;
  createStepRecord: ReturnType<typeof vi.fn>;
  updateStepStatus: ReturnType<typeof vi.fn>;
  appendLog: ReturnType<typeof vi.fn>;
} {
  let stepCounter = 0;
  return {
    updateRunStatus: vi.fn(),
    createStepRecord: vi.fn().mockImplementation(() => `step-${++stepCounter}`),
    updateStepStatus: vi.fn(),
    appendLog: vi.fn(),
    ...overrides,
  };
}

function simpleConfig(stages: PipelineConfig["stages"]): PipelineConfig {
  return { name: "test-pipeline", stages };
}

// ═════════════════════════════════════════════════════════════
// TC-WORKER-01  All steps passing → run status = SUCCESS
// ═════════════════════════════════════════════════════════════
describe("TC-WORKER-01", () => {
  it("All steps passing → run status = SUCCESS", async () => {
    const { client } = mockClient(mockContainer({ wait: vi.fn().mockResolvedValue({ StatusCode: 0 }) }));
    const runner = new DockerRunner(client);
    const cb = makeCallbacks();

    const config = simpleConfig([
      { name: "build", image: "node:20", command: "npm run build" },
      { name: "test", image: "node:20", command: "npm test" },
    ]);

    await executePipeline(config, runner, cb);

    const statusCalls = cb.updateRunStatus.mock.calls.map((c: any[]) => c[0]);
    expect(statusCalls[0]).toBe("RUNNING");
    expect(statusCalls[statusCalls.length - 1]).toBe("SUCCESS");
  });
});

// ═════════════════════════════════════════════════════════════
// TC-WORKER-02  Step exit code 1 → run status = FAILED
// ═════════════════════════════════════════════════════════════
describe("TC-WORKER-02", () => {
  it("Step exit code 1 → run status = FAILED", async () => {
    const { client } = mockClient(mockContainer({ wait: vi.fn().mockResolvedValue({ StatusCode: 1 }) }));
    const runner = new DockerRunner(client);
    const cb = makeCallbacks();

    const config = simpleConfig([
      { name: "lint", image: "node:20", command: "npm run lint" },
    ]);

    await executePipeline(config, runner, cb);

    const statusCalls = cb.updateRunStatus.mock.calls.map((c: any[]) => c[0]);
    expect(statusCalls[statusCalls.length - 1]).toBe("FAILED");
  });
});

// ═════════════════════════════════════════════════════════════
// TC-WORKER-03  Failing step stops subsequent steps
// ═════════════════════════════════════════════════════════════
describe("TC-WORKER-03", () => {
  it("Failing first step prevents remaining steps from running", async () => {
    const { client } = mockClient(mockContainer({ wait: vi.fn().mockResolvedValue({ StatusCode: 1 }) }));
    const runner = new DockerRunner(client);
    const cb = makeCallbacks();

    const config = simpleConfig([
      { name: "step1", image: "node:20", command: "exit 1" },
      { name: "step2", image: "node:20", command: "echo ok" },
      { name: "step3", image: "node:20", command: "echo ok" },
    ]);

    await executePipeline(config, runner, cb);

    expect(cb.createStepRecord).toHaveBeenCalledTimes(1);
  });
});

// ═════════════════════════════════════════════════════════════
// TC-WORKER-04  allow_failure step continues pipeline
// ═════════════════════════════════════════════════════════════
describe("TC-WORKER-04", () => {
  it("allow_failure step continues pipeline on failure", async () => {
    const { client } = mockClient(mockContainer({ wait: vi.fn().mockResolvedValue({ StatusCode: 1 }) }));
    const runner = new DockerRunner(client);
    const cb = makeCallbacks();

    const config = simpleConfig([
      { name: "optional", image: "node:20", command: "exit 1", allowFailure: true },
      { name: "required", image: "node:20", command: "echo ok" },
    ]);

    await executePipeline(config, runner, cb);

    expect(cb.createStepRecord).toHaveBeenCalledTimes(2);
  });
});

// ═════════════════════════════════════════════════════════════
// TC-WORKER-05  Each log line appended individually (streaming)
// ═════════════════════════════════════════════════════════════
describe("TC-WORKER-05", () => {
  it("Each log line appended individually", async () => {
    const container = mockContainer({
      logs: vi.fn().mockReturnValue(["line1", "line2", "line3"]),
      wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
    });
    const { client } = mockClient(container);
    const runner = new DockerRunner(client);
    const cb = makeCallbacks();

    const config = simpleConfig([
      { name: "deploy", image: "node:20", command: "deploy.sh" },
    ]);

    await executePipeline(config, runner, cb);

    expect(cb.appendLog).toHaveBeenCalledTimes(3);
    expect(cb.appendLog.mock.calls[0]).toEqual(["step-1", "line1"]);
    expect(cb.appendLog.mock.calls[1]).toEqual(["step-1", "line2"]);
    expect(cb.appendLog.mock.calls[2]).toEqual(["step-1", "line3"]);
  });
});

// ═════════════════════════════════════════════════════════════
// TC-WORKER-06  Unexpected exception → run status = ERROR
// ═════════════════════════════════════════════════════════════
describe("TC-WORKER-06", () => {
  it("Unexpected exception → run status = ERROR and exception re-raised", async () => {
    const container = mockContainer({
      logs: vi.fn().mockReturnValue([]),
      wait: vi.fn().mockRejectedValue(new Error("Docker daemon crashed")),
    });
    const { client } = mockClient(container);
    const runner = new DockerRunner(client);
    const cb = makeCallbacks();

    const config = simpleConfig([
      { name: "step1", image: "node:20", command: "run" },
    ]);

    await expect(executePipeline(config, runner, cb)).rejects.toThrow("Docker daemon crashed");

    const statusCalls = cb.updateRunStatus.mock.calls.map((c: any[]) => c[0]);
    expect(statusCalls).toContain("ERROR");
  });
});

// ═════════════════════════════════════════════════════════════
// TC-WORKER-07  Step status transitions: RUNNING then SUCCESS
// ═════════════════════════════════════════════════════════════
describe("TC-WORKER-07", () => {
  it("Step status transitions: RUNNING then SUCCESS", async () => {
    const { client } = mockClient(mockContainer({ wait: vi.fn().mockResolvedValue({ StatusCode: 0 }) }));
    const runner = new DockerRunner(client);
    const cb = makeCallbacks();

    const config = simpleConfig([
      { name: "build", image: "node:20", command: "make" },
    ]);

    await executePipeline(config, runner, cb);

    const stepCalls = cb.updateStepStatus.mock.calls;
    const statuses = stepCalls.filter((c: any[]) => c[0] === "step-1").map((c: any[]) => c[1]);
    expect(statuses).toContain("RUNNING");
    expect(statuses).toContain("SUCCESS");
    expect(statuses.indexOf("RUNNING")).toBeLessThan(statuses.indexOf("SUCCESS"));
  });
});

// ═════════════════════════════════════════════════════════════
// TC-WORKER-08  Container started with specified image
// ═════════════════════════════════════════════════════════════
describe("TC-WORKER-08", () => {
  it("Container started with image='node:20-alpine'", async () => {
    const { client, containerSpy } = mockClient();
    const runner = new DockerRunner(client);

    await runner.executeStep({ image: "node:20-alpine", command: "echo hi" });

    expect(client.containers.run).toHaveBeenCalledWith(
      "node:20-alpine",
      expect.objectContaining({ command: "echo hi" }),
    );
  });
});

// ═════════════════════════════════════════════════════════════
// TC-WORKER-09  Container launched with memory and CPU limits
// ═════════════════════════════════════════════════════════════
describe("TC-WORKER-09", () => {
  it("Container has mem_limit and cpu_quota set", async () => {
    const { client } = mockClient();
    const runner = new DockerRunner(client);

    await runner.executeStep({ image: "node:20", command: "echo hi" });

    const callArgs = (client.containers.run as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(callArgs.mem_limit).toBeDefined();
    expect(callArgs.cpu_quota).toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════
// TC-WORKER-10  Container started with cap_drop=["ALL"]
// ═════════════════════════════════════════════════════════════
describe("TC-WORKER-10", () => {
  it("Container has cap_drop=['ALL']", async () => {
    const { client } = mockClient();
    const runner = new DockerRunner(client);

    await runner.executeStep({ image: "node:20", command: "echo hi" });

    const callArgs = (client.containers.run as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(callArgs.cap_drop).toEqual(["ALL"]);
  });
});

// ═════════════════════════════════════════════════════════════
// TC-WORKER-11  Container removed after log collection
// ═════════════════════════════════════════════════════════════
describe("TC-WORKER-11", () => {
  it("Container removed exactly once after wait", async () => {
    const container = mockContainer({ wait: vi.fn().mockResolvedValue({ StatusCode: 0 }) });
    const { client } = mockClient(container);
    const runner = new DockerRunner(client);

    await runner.executeStep({ image: "node:20", command: "echo hi" });

    expect(container.remove).toHaveBeenCalledTimes(1);
  });
});

// ═════════════════════════════════════════════════════════════
// TC-WORKER-12  Non-zero exit code captured via get_exit_code()
// ═════════════════════════════════════════════════════════════
describe("TC-WORKER-12", () => {
  it("Non-zero exit code captured via getExitCode()", async () => {
    const container = mockContainer({ wait: vi.fn().mockResolvedValue({ StatusCode: 2 }) });
    const { client } = mockClient(container);
    const runner = new DockerRunner(client);

    await runner.executeStep({ image: "node:20", command: "exit 2" });

    expect(runner.getExitCode()).toBe(2);
  });
});

// ═════════════════════════════════════════════════════════════
// TC-WORKER-13  Binary log output decoded as UTF-8
// ═════════════════════════════════════════════════════════════
describe("TC-WORKER-13", () => {
  it("Cyrillic UTF-8 bytes decoded correctly", async () => {
    const cyrillicText = "Привет мир";
    const container = mockContainer({
      logs: vi.fn().mockReturnValue([Buffer.from(cyrillicText, "utf-8")]),
      wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
    });
    const { client } = mockClient(container);
    const runner = new DockerRunner(client);
    const lines: string[] = [];

    await runner.executeStep(
      { image: "node:20", command: "echo" },
      (line) => lines.push(line),
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(cyrillicText);
  });
});

// ═════════════════════════════════════════════════════════════
// TC-WORKER-14  /workspace volume mounted for file sharing
// ═════════════════════════════════════════════════════════════
describe("TC-WORKER-14", () => {
  it("/workspace volume mounted with rw mode", async () => {
    const { client } = mockClient();
    const runner = new DockerRunner(client);

    await runner.executeStep({ image: "node:20", command: "ls" });

    const callArgs = (client.containers.run as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(callArgs.volumes).toBeDefined();
    expect(callArgs.volumes["/workspace"]).toBeDefined();
    expect(callArgs.volumes["/workspace"].mode).toBe("rw");
  });
});

// ═════════════════════════════════════════════════════════════
// TC-WORKER-15  Container removed even if wait() raises
// ═════════════════════════════════════════════════════════════
describe("TC-WORKER-15", () => {
  it("Container removed even when wait() throws", async () => {
    const container = mockContainer({
      wait: vi.fn().mockRejectedValue(new Error("timeout")),
    });
    const { client } = mockClient(container);
    const runner = new DockerRunner(client);

    await expect(runner.executeStep({ image: "node:20", command: "hang" })).rejects.toThrow("timeout");

    expect(container.remove).toHaveBeenCalledTimes(1);
  });
});

// ═════════════════════════════════════════════════════════════
// TC-WORKER-16  Encrypt → Decrypt round-trip returns original
// ═════════════════════════════════════════════════════════════
describe("TC-WORKER-16", () => {
  it("decrypt(encrypt(x)) === x", () => {
    const original = "super_secret_token_12345";
    const ciphertext = encrypt(original);
    const decrypted = decrypt(ciphertext);
    expect(decrypted).toBe(original);
  });
});

// ═════════════════════════════════════════════════════════════
// TC-WORKER-17  Same plaintext produces different ciphertexts
// ═════════════════════════════════════════════════════════════
describe("TC-WORKER-17", () => {
  it("Two encryptions of same value produce different ciphertexts (random IV)", () => {
    const value = "deterministic_input";
    const enc1 = encrypt(value);
    const enc2 = encrypt(value);
    expect(enc1).not.toBe(enc2);
    // Both decrypt to same value
    expect(decrypt(enc1)).toBe(value);
    expect(decrypt(enc2)).toBe(value);
  });
});

// ═════════════════════════════════════════════════════════════
// TC-WORKER-18  Tampered ciphertext raises exception on decrypt
// ═════════════════════════════════════════════════════════════
describe("TC-WORKER-18", () => {
  it("Tampered ciphertext raises on decrypt", () => {
    const ciphertext = encrypt("sensitive_data");
    // Corrupt the last 4 hex chars
    const tampered = ciphertext.slice(0, -4) + "dead";
    expect(() => decrypt(tampered)).toThrow();
  });
});
