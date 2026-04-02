import type { LinksProvider, ServiceKey, LinkItem } from "./links.provider";

/**
 * Simple in-memory implementation.
 * Replace later with org-config / DB-backed links.
 */
export class StaticLinksProvider implements LinksProvider {
  private readonly data: Record<ServiceKey, LinkItem[]>;

  constructor(data: Record<ServiceKey, LinkItem[]>) {
    this.data = data;
  }

  async getLinks(_orgId: string, service: ServiceKey): Promise<LinkItem[]> {
    return this.data[service] ?? [];
  }
}
