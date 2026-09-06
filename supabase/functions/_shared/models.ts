// _shared/models.ts — the ONE place a Gemini model id is chosen (audit AI-F1 /
// AI-F12). Every id is overridable per environment, so a Google lifecycle
// event (text-embedding-004 was shut down 2026-01-14 and nobody noticed for
// eight months) becomes a `supabase secrets set`, not a redeploy of every
// function that names a model.
//
// Sources, checked 2026-09-04:
//   https://ai.google.dev/gemini-api/docs/deprecations — text-embedding-004
//     shut down 2026-01-14 (recommended replacement: gemini-embedding-2);
//     gemini-embedding-001 shuts down 2028-05-14; gemini-embedding-2,
//     gemini-2.5-flash and gemini-2.5-pro have no announced shutdown date.
//   https://ai.google.dev/gemini-api/docs/embeddings — gemini-embedding-001 and
//     gemini-embedding-2 are both MRL models: 3072 dims by default, truncatable
//     with `outputDimensionality` ("We recommend using 768, 1536, or 3072").
//     gemini-embedding-2 auto-normalizes truncated vectors; gemini-embedding-001
//     needs manual normalization (embeddings.ts normalizes either way).
//
// AI-F12 follow-up: the vision functions (analyze-drawings, -takeoff,
// -spec-book, compare-drawings, scan-*, safety-*) still carry `gemini-2.5-*`
// literals tied to their ALLOWED_MODELS unions; migrate them here when that
// lands. A weekly canary that GETs /v1beta/models and alerts on a missing id
// is the other half of that follow-up.

export const GEMINI_TEXT_MODEL = Deno.env.get('GEMINI_TEXT_MODEL') || 'gemini-2.5-flash';
export const GEMINI_VISION_MODEL = Deno.env.get('GEMINI_VISION_MODEL') || 'gemini-2.5-pro';
export const GEMINI_EMBED_MODEL = Deno.env.get('GEMINI_EMBED_MODEL') || 'gemini-embedding-2';

/**
 * Must match `memory_embeddings.embedding vector(768)` (supabase/schema.sql)
 * and the HNSW cosine index on it. Changing the model OR the dimension means
 * re-embedding every row — vectors from different models are not comparable
 * (the table holds 0 rows today, so switching now costs nothing).
 */
export const GEMINI_EMBED_DIMS = 768;
