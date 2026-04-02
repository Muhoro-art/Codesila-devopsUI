import OpenAI from "openai";

export class Embedder {
  private openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY!,
  });

  async embed(input: string): Promise<number[]> {
    const r = await this.openai.embeddings.create({
      model: "text-embedding-3-small",
      input,
    });
    return r.data[0].embedding as number[];
  }
}
