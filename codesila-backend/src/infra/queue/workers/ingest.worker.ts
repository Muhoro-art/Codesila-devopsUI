import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { remark } from "remark";
import gfm from "remark-gfm";
import { Pool } from "pg";
import { Embedder } from "../../../modules/assistant/rag/embedder";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const embedder = new Embedder();

function chunkText(text: string, max = 900): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let cur = "";

  for (const s of sentences) {
    if ((cur + " " + s).length > max) {
      if (cur) chunks.push(cur.trim());
      cur = s;
    } else {
      cur += " " + s;
    }
  }

  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

async function ingestFile(
  orgId: string,
  filePath: string
) {
  const raw = fs.readFileSync(filePath, "utf8");
  const fm = matter(raw);

  let content = fm.content;
  try {
    content = String(await remark().use(gfm).process(fm.content));
  } catch {}

  for (const chunk of chunkText(content)) {
    const embedding = await embedder.embed(chunk);
    const vec = `[${embedding.join(",")}]`;

    await pool.query(
      `
      INSERT INTO docs (org_id, path, title, url, chunk, embedding)
      VALUES ($1, $2, $3, $4, $5, $6::vector)
      `,
      [
        orgId,
        filePath,
        fm.data.title || path.basename(filePath),
        fm.data.url || null,
        chunk,
        vec,
      ]
    );
  }
}

export async function ingestJob(payload: {
  orgId: string;
  rootDir: string;
}) {
  async function walk(dir: string) {
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) {
        await walk(full);
      } else if (f.endsWith(".md")) {
        await ingestFile(payload.orgId, full);
      }
    }
  }

  await walk(payload.rootDir);
}
