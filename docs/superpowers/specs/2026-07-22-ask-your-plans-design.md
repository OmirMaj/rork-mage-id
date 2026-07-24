# Ask Your Plans — Design Spec

**Date:** 2026-07-22
**Status:** Approved (design, via conversation); ready for implementation plan
**Branch target:** off `main`

## Goal

Let a contractor, architect, or engineer upload construction plans and **ask a natural-language question** — *"what's the beam size on grid line 4?"*, *"where's the panel schedule?"*, *"did they detail the roof-to-wall connection?"* — and get back a **plain answer with a citation** (which sheet, what it says) and a **tap-to-jump** to that sheet. The brain doesn't just store the PDF; it reads and recalls it.

This is the **"reads & recalls your plans"** faculty — comprehension + retrieval. It's the most defensible brain feature yet: a filing cabinet holds the drawing set; only a brain answers questions from it.

## Why this is a *medium* build, not a moonshot

Nearly every hard primitive already exists in the repo and is reused, not reinvented:

- **`convert-pdf-to-images`** (edge fn) — turns a plan PDF into per-sheet images (the ingestion step).
- **`analyze-plan-code` / `drawing-analyzer` / `plan-intelligence`** — vision over plan sheets already works (the "read the drawing" primitive).
- **`project-memory-embed` + `project-memory-search` + `match_project_memory` + `project_memory_pgvector`** — a full pgvector semantic-search engine already in the app.
- **`plan-viewer` / `plans.tsx` / `plan-intelligence.tsx`** — the surface to host the ask box and jump to a sheet.
- **`mageAI → ai`** relay — for the grounded answer.
- The **offline-first sync layer** (offline queue, Supabase-first project load) — the storage/sync model this rides on.

The new work is the connective tissue: a plan-scoped index table + an ingestion pipeline that fills it + a query endpoint + the ask UI.

## Architecture — cloud is the source of truth, local is a cache

The cross-device recall risk ("plan uploaded on the laptop, asked from the phone") is solved by keying everything to the **project**, in the **cloud** — never to a device:

- **Files** live in Supabase Storage (existing `pdf-uploads` / `plan-sheets` buckets), attached to the project.
- **The searchable index** (per-sheet extracted content + embeddings) lives in cloud pgvector, keyed to `project_id` + `plan_id` + `sheet` — not to any device.
- **Any device** (phone / laptop / web) queries the cloud index, so it sees every plan anyone uploaded from any device.
- **Local storage is only an offline cache** for viewing sheets without signal — following MAGE's existing offline-first pattern. Nothing depends on which device holds the file.

## The pipeline

### Ingest (index-once, cached, cost-guarded)
Triggered **on-demand** — when someone first asks about a plan (not on every upload). Per sheet:
1. `convert-pdf-to-images` → per-sheet image (existing).
2. **Free path first:** if the PDF sheet has a usable text layer, extract it (free) → chunk.
3. **Vision path:** for image-only/scanned sheets (or when the text layer is thin), run vision (the existing plan-vision pattern) to extract a rich description + the callouts, notes, schedules, dimensions on that sheet → chunk.
4. Embed each chunk (reuse `project-memory-embed`) → store rows in the new `plan_chunks` pgvector table.
5. **Cache:** mark the plan `indexed_at`; never re-vision a sheet. Re-index only on a plan **revision** (there is already `plan_sheet_revisions`).

### Ask
1. User types a question in the ask box on the plan view.
2. Embed the query → semantic match (reuse `match_project_memory` / `project-memory-search`) over that project's `plan_chunks`.
3. Feed the top-K chunks + the question to the `ai` relay → a grounded answer that **must cite the sheet(s)** it used.
4. Render the answer + a **citation chip** (sheet number/name) → tap jumps to that sheet in `plan-viewer`.

## Cost guardrails (storage is pennies; the AI is the cost)

Storage is negligible (a few MB/plan, cents/GB/mo). The spend is vision-at-ingestion, and it is bounded by:

- **Index once + cache** — a sheet is visioned at most once; re-index only on revision.
- **Free-text-layer-first** — vision only fires on sheets without a usable text layer.
- **On-demand indexing** — index a plan when it's first asked about, not on upload.
- **Tier-gate (Business+)** — server-side `requireTier(['business','enterprise'])`, mirroring Cost X-Ray, so the people paying for AI trigger the cost.
- Surface index progress to the user (first-ask can take a few seconds/sheet) with a reassuring state, like the Cost X-Ray "~20s" pattern.

## Phasing

- **MVP** — sheet-level Q&A: answer + "it's on Sheet S-201, here's what it says" + tap-to-jump. Ships on existing infra.
- **v2** — region-level: highlight the exact spot on the sheet (reuse the bbox / `drawing_pins` infra from Cost X-Ray & drawing-analyzer).
- **v3** — role lenses over the same index (contractor "finish spec here" vs architect "built to my detail?" vs engineer "where's my connection callout").

## Data model

New table **`plan_chunks`** (mirrors `project_memory_pgvector`):
- `id`, `project_id`, `plan_id`, `sheet_ref` (sheet number/name), `content` (text), `embedding` (vector), `source` (`'text' | 'vision'`), `bbox` (nullable json, for v2), `created_at`.
- pgvector index for cosine similarity; RLS scoped to the project owner (follow the existing `project_memory` RLS + this-session's security hardening — no anon read, tenant-scoped).
- Index status on the plan record: `indexed_at`, `sheet_count`, `chunk_count` (or a small `plan_index_status` table).

## Files

**New:**
- Migration: `plan_chunks` table + pgvector index + RLS (applied via Supabase MCP `apply_migration`, owner-gated; NEVER `db push`).
- Edge fn (or extend `project-memory-*`): `plan-index` (ingest a plan → chunks) and `plan-ask` (embed query → match → grounded cited answer). Reuse the embed/match code paths; `requireTier` Business+.
- Pure (validator-safe): the chunking + citation-assembly + answer-grounding helpers (React-free), with `scripts/validate-*.ts` wired into ship-check.
- UI: an **ask box + answer/citation panel** on `plan-intelligence.tsx` / `plan-viewer.tsx`, with a "jump to sheet" action and an indexing/loading state.

**Reused unchanged:** `convert-pdf-to-images`, the plan-vision pattern, `project-memory-embed`/`search`/`match_project_memory`, `mageAI`/`ai`, `plan-viewer`, the storage buckets, the offline-sync layer.

## Error / edge states

- **Unindexed plan** → an "Indexing your plans…" state (first ask), then the answer.
- **No answer found** → "I couldn't find that in these plans — try rephrasing, or it may be on a sheet that isn't indexed yet," not a dead end.
- **Offline** → cached sheets are viewable; asking requires a connection (it's a cloud query) — say so clearly.
- **Tier-locked** → a clear paywall explaining the value ("ask your plans in plain English"), Business+ gated.
- **Grounding discipline** → the answer must cite a sheet from the retrieved chunks; if retrieval is weak, prefer "not found" over a hallucinated answer.

## Testing

- **Pure-fn validators** for chunking, citation assembly, and the "prefer not-found over hallucination" grounding rule (React/RN-free) → wired into the ship-check `&&`-chain.
- **Edge-fn drift guards** (`validate-edge-security` style) for the new fns (tier gate + tenant scoping).
- **Manual** retrieval-quality checks on a real plan set (the answer/citation accuracy is judgment, not unit-testable).
- OTA-safe for the UI; the edge fns + migration are backend (deploy + apply owner-gated, per the Supabase/edge-fn procedures).

## Out of scope (for MVP)

- Region/bbox highlighting on the sheet (v2).
- Cross-plan / cross-project search (this is per-project).
- Editing/markup from the answer (jump-to-sheet only).
- Real-time collaborative asking.
