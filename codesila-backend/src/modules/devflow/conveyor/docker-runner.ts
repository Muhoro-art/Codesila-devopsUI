// src/modules/devflow/conveyor/docker-runner.ts
// Docker container runner for CI/CD pipeline steps (§3.3, FR-07)

export interface StepConfig {
  image: string;
  command: string;
  env?: Record<string, string>;
  timeout?: number;
  allowFailure?: boolean;
}

export interface ContainerRunResult {
  exitCode: number;
  logs: string[];
}

/**
 * DockerRunner wraps Docker Engine API calls for step execution.
 * In production this calls the Docker socket; tests inject a mock client.
 */
export class DockerRunner {
  private lastExitCode = 0;
  private client: DockerClient;

  constructor(client?: DockerClient) {
    this.client = client ?? createDefaultClient();
  }

  /**
   * Execute a single pipeline step inside a Docker container.
   * Streams log lines via the onLog callback.
   * Returns exit code.
   */
  async executeStep(
    step: StepConfig,
    onLog?: (line: string) => void,
  ): Promise<number> {
    const container = await this.client.containers.run(step.image, {
      command: step.command,
      env: step.env,
      mem_limit: "512m",
      cpu_quota: 50000,
      cap_drop: ["ALL"],
      volumes: { "/workspace": { bind: "/workspace", mode: "rw" } },
      detach: true,
    });

    try {
      // Collect logs (streaming)
      const logStream = container.logs({ follow: true, stdout: true, stderr: true });
      if (logStream && typeof logStream[Symbol.asyncIterator] === "function") {
        for await (const chunk of logStream) {
          const line = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");
          if (onLog) onLog(line);
        }
      } else if (Array.isArray(logStream)) {
        for (const chunk of logStream) {
          const line = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");
          if (onLog) onLog(line);
        }
      }

      const waitResult = await container.wait();
      this.lastExitCode = waitResult.StatusCode;
    } finally {
      await container.remove();
    }

    return this.lastExitCode;
  }

  getExitCode(): number {
    return this.lastExitCode;
  }
}

/* ─── Docker client interface (for mocking) ──────────────── */

export interface DockerContainer_I {
  logs(opts?: any): any;
  wait(): Promise<{ StatusCode: number }>;
  remove(): Promise<void>;
}

export interface DockerClient {
  containers: {
    run(image: string, opts: any): Promise<DockerContainer_I>;
  };
}

function createDefaultClient(): DockerClient {
  // In production, this would connect to Docker Engine via socket
  throw new Error("Docker client not configured — inject via constructor");
}
