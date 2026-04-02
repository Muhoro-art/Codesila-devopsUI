// src/modules/integrations/secrets/secrets.types.ts — Secrets management types

export interface Secret {
  key: string;
  value: string;    // encrypted at rest
  scope: "org" | "project" | "service";
  scopeId: string;
  createdAt: string;
  updatedAt: string;
}
