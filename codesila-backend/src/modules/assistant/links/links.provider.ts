export type ServiceKey = "payments" | "checkout" | "auth";

export type LinkItem = {
  title: string;
  url: string;
};

export interface LinksProvider {
  getLinks(orgId: string, service: ServiceKey): Promise<LinkItem[]>;
}

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
