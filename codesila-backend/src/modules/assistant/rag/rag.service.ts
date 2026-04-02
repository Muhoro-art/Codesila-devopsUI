// src/modules/assistant/rag/rag.service.ts

export type RagCitation = {
  title: string;
  url: string | null;       // <- IMPORTANT: no undefined (fixes TS url mismatch)
  sourceId?: string;
};

export type RagChunk = {
  id: string;
  text: string;
  score?: number;
  metadata?: Record<string, unknown>;
  citation?: RagCitation;
};

export type RagContextItem = {
  title?: string;
  url?: string | null;
  chunk: string;
};

export type RagRetrieveInput = {
  // What AssistantService currently passes
  orgId?: string;
  conversationHint?: string;

  // Existing / useful params
  query: string;
  projectId?: string;
  topK?: number;
};

export type RagRetrieveResult = {
  // What AssistantService currently reads
  context: RagContextItem[];
  citations: { title: string; url: string | null }[];

  // Keep chunk results available for later features
  chunks: RagChunk[];
};

/**
 * Minimal RAG service.
 * Today: uses a small in-memory store.
 * Later: swap the store for pgvector / Qdrant / Pinecone, etc.
 */
export class RagService {
  private store: RagChunk[] = [];

  async loadProjectContext(_projectId: string): Promise<void> {
    // TODO: Load docs/snippets from DB/filesystem and build chunks.
    return;
  }

  upsertChunks(chunks: RagChunk[]): void {
    const byId = new Map(this.store.map((c) => [c.id, c]));
    for (const c of chunks) byId.set(c.id, c);
    this.store = Array.from(byId.values());
  }

  /**
   * Retrieve relevant chunks for a query.
   * Returns both:
   *  - chunks (raw)
   *  - context (assistant-friendly)
   */
  async retrieve(input: RagRetrieveInput): Promise<RagRetrieveResult> {
    const topK = input.topK ?? 6;
    const query = (input.query ?? "").trim();

    if (!query) {
      return { chunks: [], context: [], citations: [] };
    }

    if (input.projectId) {
      await this.loadProjectContext(input.projectId);
    }

    const scored: RagChunk[] = this.store
      .map((c) => ({ chunk: c, score: this.simpleScore(query, c.text) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((x) => ({ ...x.chunk, score: x.score }));

    // Build assistant-friendly context items
    const context: RagContextItem[] = scored.map((c) => ({
      title: c.citation?.title ?? c.id,
      url: c.citation?.url ?? null,
      chunk: c.text,
    }));

    // Dedup citations
    const citations: { title: string; url: string | null }[] = [];
    const seen = new Set<string>();

    for (const c of scored) {
      const cit = c.citation;
      if (!cit) continue;

      // Normalize url to null (never undefined)
      const url = cit.url ?? null;
      const key = `${cit.title}|${url}|${cit.sourceId ?? ""}`;

      if (seen.has(key)) continue;
      seen.add(key);

      citations.push({ title: cit.title, url });
    }

    return { chunks: scored, context, citations };
  }

  /**
   * Turn context into a prompt-ready block (AssistantService can use this too).
   */
  buildContext(items: RagContextItem[]): string {
    if (!items.length) return "";

    return items
      .slice(0, 10)
      .map((c, i) => {
        const header = `[#${i + 1}] ${c.title ?? "Untitled"} (${c.url ?? "local"})`;
        return `${header}\n${c.chunk}`.trim();
      })
      .join("\n\n---\n\n");
  }

  private simpleScore(query: string, text: string): number {
    const q = query.toLowerCase();
    const t = (text ?? "").toLowerCase();
    if (!t) return 0;

    const tokens = q
      .split(/[\s,.;:!?(){}\[\]"'`<>/\\|_-]+/g)
      .map((x) => x.trim())
      .filter((x) => x.length >= 3);

    if (!tokens.length) return 0;

    let score = 0;
    for (const tok of tokens) {
      let idx = t.indexOf(tok);
      while (idx !== -1) {
        score += 1;
        idx = t.indexOf(tok, idx + tok.length);
      }
    }
    return score;
  }
}
