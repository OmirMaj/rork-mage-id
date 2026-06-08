// Shared Gemini embeddings helper for Project Memory v2 (and any future
// semantic feature). Uses text-embedding-004 (768 dims) via the same
// Generative Language API + GEMINI_API_KEY the `ai` function already uses.

const GK = Deno.env.get("GEMINI_API_KEY") || "";
const BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
export const EMBED_MODEL = "text-embedding-004";
export const EMBED_DIMS = 768;

/** Embed a batch of texts → array of 768-float vectors, order-preserved. */
export async function geminiEmbed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (!GK) throw new Error("GEMINI_API_KEY not set on server");
  const r = await fetch(`${BASE}${EMBED_MODEL}:batchEmbedContents?key=${GK}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: texts.map((t) => ({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text: (t || "").slice(0, 8000) }] },
      })),
    }),
  });
  if (!r.ok) {
    const e = await r.text().catch(() => "");
    throw new Error(`gemini embed ${r.status}: ${e.slice(0, 300)}`);
  }
  const j = await r.json();
  return (j.embeddings ?? []).map((e: { values: number[] }) => e.values);
}

/** Format a vector as a pgvector text literal: "[v1,v2,...]". */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
