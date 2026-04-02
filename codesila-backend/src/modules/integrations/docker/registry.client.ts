// src/modules/integrations/docker/registry.client.ts — Docker Engine API client (§3.4)

import logger from "../../../config/logger";
import type { DockerContainer, DockerImage } from "./docker.types";

const DOCKER_SOCKET = process.env.DOCKER_HOST || "http://localhost:2375";

/**
 * Docker Engine API client (§3.4).
 * Communicates with the Docker daemon via REST API.
 * In production, uses Unix socket /var/run/docker.sock or TCP.
 */
export class DockerClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || DOCKER_SOCKET;
  }

  /**
   * List running containers.
   */
  async listContainers(all = false): Promise<DockerContainer[]> {
    try {
      const url = `${this.baseUrl}/v1.43/containers/json?all=${all}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Docker API error: ${res.status}`);

      const data = await res.json() as any[];
      return data.map((c) => ({
        id: c.Id?.slice(0, 12) ?? "",
        name: (c.Names?.[0] ?? "").replace(/^\//, ""),
        image: c.Image ?? "",
        status: c.State ?? "unknown",
        ports: (c.Ports ?? []).map(
          (p: any) => `${p.PublicPort || ""}:${p.PrivatePort}/${p.Type}`,
        ),
        createdAt: new Date((c.Created ?? 0) * 1000).toISOString(),
        state: c.Status ?? "",
      }));
    } catch (err) {
      logger.warn({ err }, "Docker listContainers failed — daemon may not be accessible");
      return [];
    }
  }

  /**
   * List local Docker images.
   */
  async listImages(): Promise<DockerImage[]> {
    try {
      const url = `${this.baseUrl}/v1.43/images/json`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Docker API error: ${res.status}`);

      const data = await res.json() as any[];
      return data.map((img) => {
        const repoTag = (img.RepoTags?.[0] ?? ":").split(":");
        return {
          id: img.Id?.slice(0, 12) ?? "",
          repository: repoTag[0] ?? "<none>",
          tag: repoTag[1] ?? "latest",
          size: img.Size ?? 0,
          createdAt: new Date((img.Created ?? 0) * 1000).toISOString(),
        };
      });
    } catch (err) {
      logger.warn({ err }, "Docker listImages failed");
      return [];
    }
  }

  /**
   * Stop a container by ID.
   */
  async stopContainer(containerId: string): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/v1.43/containers/${encodeURIComponent(containerId)}/stop`;
      const res = await fetch(url, { method: "POST" });
      return res.ok || res.status === 304;  // 304 = already stopped
    } catch (err) {
      logger.error({ err, containerId }, "Docker stopContainer failed");
      return false;
    }
  }

  /**
   * Start a container by ID.
   */
  async startContainer(containerId: string): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/v1.43/containers/${encodeURIComponent(containerId)}/start`;
      const res = await fetch(url, { method: "POST" });
      return res.ok || res.status === 304;  // 304 = already running
    } catch (err) {
      logger.error({ err, containerId }, "Docker startContainer failed");
      return false;
    }
  }

  /**
   * Get container logs.
   */
  async getContainerLogs(containerId: string, tail = 100): Promise<string> {
    try {
      const url = `${this.baseUrl}/v1.43/containers/${encodeURIComponent(containerId)}/logs?stdout=true&stderr=true&tail=${tail}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Docker API error: ${res.status}`);
      return res.text();
    } catch (err) {
      logger.error({ err, containerId }, "Docker getContainerLogs failed");
      return "";
    }
  }

  /**
   * Check if Docker daemon is reachable.
   */
  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v1.43/_ping`);
      return res.ok;
    } catch {
      return false;
    }
  }
}
