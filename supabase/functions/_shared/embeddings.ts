// Shared Gemini embeddings helper for Project Memory v2, Ask Your Plans and
// Ask Your Home. The model + dimension come from _shared/models.ts.
//
// Audit AI-F1 (2026-09-03): this file hard-coded text-embedding-004, which
// Google shut down on 2026-01-14 — every semantic feature has 404'd since and
// memory_embeddings never held a row. The pgvector column is vector(768) with
// an HNSW vector_cosine_ops index, so we request `outputDimensionality: 768`
// (MRL truncation, supported by gemini-embedding-001 and gemini-embedding-2 —
// https://ai.google.dev/gemini-api/docs/embeddings) and L2-normalize the
// result: gemini-embedding-2 already returns unit vectors for truncated dims,
// gemini-embedding-001 does not, and normalizing is a no-op on a unit vector.

import { GEMINI_EMBED_DIMS, GEMINI_EMBED_MODEL } from "./models.ts";

const GK = Deno.env.get("GEMINI_API_KEY") || "";
const BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
export const EMBED_MODEL = GEMINI_EMBED_MODEL;
export const EMBED_DIMS = GEMINI_EMBED_DIMS;
// B3 (review): bounded upstream fetch so a hung socket surfaces as an error
// the caller maps to a CORS-carrying response, not an isolate killed at the
// wall clock.
const EMBED_TIMEOUT_MS = 60_000;

function normalize(vec: number[]): number[] {
  let sum = 0;
  for (const v of vec) sum += v * v;
  const norm = Math.sqrt(sum);
  return norm > 0 ? vec.map((v) => v / norm) : vec;
}

/** Embed a batch of texts → array of EMBED_DIMS-float unit vectors, order-preserved. */
export async function geminiEmbed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (!GK) throw new Error("GEMINI_API_KEY not set on server");
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), EMBED_TIMEOUT_MS);
  let r: Response;
  try {
    r = await fetch(`${BASE}${EMBED_MODEL}:batchEmbedContents?key=${GK}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // One text part per request → one embedding per request (gemini-embedding-2
        // aggregates multiple parts of ONE request into a single vector, which is
        // not what a per-document index wants).
        requests: texts.map((t) => ({
          model: `models/${EMBED_MODEL}`,
          content: { parts: [{ text: (t || "").slice(0, 8000) }] },
          outputDimensionality: EMBED_DIMS,
        })),
      }),
      signal: ac.signal,
    });
  } catch (e) {
    throw new Error((e as Error).name === "AbortError"
      ? `gemini embed timed out after ${EMBED_TIMEOUT_MS} ms`
      : `gemini embed network error: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) {
    const e = await r.text().catch(() => "");
    throw new Error(`gemini embed ${r.status}: ${e.slice(0, 300)}`);
  }
  const j = await r.json();
  const vectors: number[][] = (j.embeddings ?? []).map((e: { values: number[] }) => e.values);
  // Fail loudly if the model ignored outputDimensionality: a wrong-width vector
  // would otherwise surface as an opaque pgvector "expected 768 dimensions"
  // error on the upsert — after the Gemini spend.
  for (const v of vectors) {
    if (!Array.isArray(v) || v.length !== EMBED_DIMS) {
      throw new Error(`gemini embed returned ${Array.isArray(v) ? v.length : "no"} dims (expected ${EMBED_DIMS}) from ${EMBED_MODEL}`);
    }
  }
  return vectors.map(normalize);
}

/** Format a vector as a pgvector text literal: "[v1,v2,...]". */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
