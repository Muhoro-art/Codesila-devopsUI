// src/modules/integrations/docker/docker.types.ts — Docker integration types (§3.4)

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: "running" | "stopped" | "exited" | "created";
  ports: string[];
  createdAt: string;
  state: string;
}

export interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  size: number;
  createdAt: string;
}

export interface DockerBuildOptions {
  imageName: string;
  tag: string;
  dockerfile?: string;
  context?: string;
  buildArgs?: Record<string, string>;
}

export interface DockerRunOptions {
  image: string;
  name?: string;
  ports?: Record<string, string>;   // "3000": "3000"
  env?: Record<string, string>;
  volumes?: string[];
  detach?: boolean;
}
