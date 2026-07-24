# Home Passport + Ask Your Home — Design

**Date:** 2026-07-23
**Status:** Approved (design); ready for implementation plan
**Branch target:** `claude/home-passport` (off `main`)

## Goal

The property-side brain, v1. At closeout, the contractor's project data becomes the homeowner's **living house record** — and the homeowner can **ask it questions in English** with cited answers. Two capabilities:

1. **Home Passport** — an upgraded closeout deliverable: finishes/selections, warranties, maintenance schedule, who-built-what (trade contacts enriched from commitments), photo highlights, plus a pre-answered FAQ — assembled largely from data the closeout binder already compiles.
2. **Ask Your Home** — a question box in the client portal: *"what paint is the kitchen?" "who did the electrical?" "when does the roof warranty end?"* → grounded, cited answers from the project's indexed memory.

**Why it matters:** competitors' filing cabinets archive the job; MAGE hands the *house a memory*. It is also a growth flywheel — contractors win bids by offering it, homeowners keep the passport (and MAGE) after the job, and their next project flows back to a MAGE contractor.

## Grounding (verified in code, 2026-07-23)

- **The closeout binder already exists** — `utils/closeoutBinderEngine.ts` (`CloseoutBinder`: finishes, warranties, maintenance, trade contacts; `draft → finalized → sent`), delivered via portal snapshot v8 `closeout` section (`utils/portalSnapshot.ts`). The passport is an intelligence upgrade of this flow, not a new surface.
- **Portal auth = 192-bit access token** (`projects.client_portal->>'accessToken'`) gating SECURITY DEFINER RPCs (`portal_get_snapshot`, `portal_get_messages`). The 2026-07-13 hardening blessed this model; a Part B lock (dropping remaining anon direct reads) is **staged but not applied** — nothing here may rely on direct anon table reads.
- **pgvector project memory is live in prod**: `memory_embeddings`, `match_project_memory(p_user_id, p_project_id, p_query, p_match_count)`, `project-memory-embed` / `project-memory-search` edge fns, `_shared/embeddings.ts geminiEmbed` (Gemini text-embedding-004). The Ask Your Plans branch adds only `plan-extract` + client utils.
- **Local-only constraint**: photos (`mageid_photos`), warranties (`mageid_warranties`), selections (`mageid_selections`), commitments (`mageid_commitments`) live in AsyncStorage and reach the portal **only through the snapshot**. The passport therefore assembles on the contractor's device (where the data lives) and ships via snapshot + memory indexing — no new sync layer.
- **Rate limiting pattern**: `validate-portal-passcode` edge fn + `rate_limit_counters` (locked to service role by the 2026-07-21 hardening) show the per-portal/per-IP throttle pattern to reuse.

## Identity decision

**Portal access token only. No homeowner accounts in v1.** The homeowner keeps using the exact link the contractor already sends. Ask Your Home authenticates every request with the same token, validated server-side. (Homeowner accounts + email→project linking are a future increment; Model 1 was chosen over magic-link accounts for zero friction and zero new attack surface.)

## Architecture

### 1. Pure assembly engine — `utils/passport/buildHomePassport.ts`

`buildHomePassport(input): HomePassport` — pure, validator-tested. Input: the project + its closeout binder, selections (chosen options), warranties, commitments + subcontractors, photos (sent-to-portal ones), maintenance items. Output:

```ts
export interface HomePassport {
  docs: PassportDoc[];      // indexable text docs, each ≤ 4000 chars
  faqInputs: FaqInput[];    // ~10 question+context pairs for pre-answering
  summary: PassportSummary; // counts for the UI (photos, materials, warranties, trades)
}
export interface PassportDoc {
  docId: string;            // 'passport:<kind>:<id>' — kinds: finish | warranty | trade | maintenance | photo
  ref: string;              // human citation label ("Warranty — Trane HVAC", "Photo — kitchen west wall, Mar 12")
  text: string;             // dense searchable text (product/brand/SKU/supplier, coverage dates, trade+scope+contact, photo caption+location+date)
  kind: 'finish' | 'warranty' | 'trade' | 'maintenance' | 'photo';
}
```

Trade docs are enriched from commitments: trade/CSI + scope description + phase + sub contact — answering "who did the electrical." Photo docs index caption/location/linked-task/date (not pixels) so answers can cite photos the snapshot already carries.

### 2. Contractor-side generation — closeout binder hook (OTA-safe)

A "Generate Home Passport" step in `app/closeout-binder.tsx` at finalize:
1. `buildHomePassport(...)` assembles the docs.
2. Index docs into `memory_embeddings` via the existing `project-memory-embed` edge fn (contractor's JWT; source `'Home Passport'`; re-generation re-indexes idempotently by docId).
3. Pre-answer the FAQ: for each `FaqInput`, run the existing memory-search + `mageAI` grounded-answer flow (cited, "prefer not-found"); bake `faq: {q, a, refs[]}[]` into the snapshot's closeout section.
4. Snapshot version bumps; portal renders the passport sections it already receives (finishes/warranties/contacts) plus the new FAQ.

Failure anywhere is non-blocking: the binder still finalizes/sends exactly as today; the passport degrades to the FAQ-less binder.

### 3. Homeowner-side ask — `portal-ask-home` edge fn (owner-gated deploy)

`POST { portalId, accessToken, question }` →
1. Validate token against `projects.client_portal->>'accessToken'` (constant-time, mirroring `validate-portal-passcode`).
2. Rate limit via `rate_limit_counters`: 20 questions/day per portal + per-IP hourly cap.
3. Embed the question (`geminiEmbed`), search `match_project_memory` with the project owner's `user_id` + `projectId` (service role, server-side only), filtered to passport-relevant sources (`'Home Passport'` + daily-report/RFI summaries already indexed).
4. `mageAI`-style grounded answer with citations; strict system rule: answer only from retrieved docs, prefer "that's not in your home's records — contact your contractor."
5. Return `{ answer, refs: [{ref, kind, photoUrl?}] }`.

No new tables. No anon table reads. Token never logged.

### 4. Portal UI — "Ask your home" section (Netlify build-free deploy)

In `marketing/portal/index.html`: a passport header card (counts from `PassportSummary`), the pre-baked FAQ as tappable cards (instant, zero-cost answers), and a question box wired to `portal-ask-home` with a soft daily-limit message. Cited photo refs render the snapshot's existing photo URLs. Matches the Renovation Journal design language already in the portal.

## Testing

- `scripts/validate-home-passport.ts` in ship-check: doc assembly from each source kind, ≤4000-char chunking, docId stability across re-generation, trade enrichment from commitments (CSI/trade mapping), empty-input totality (no throw, empty docs), FAQ input construction, summary counts.
- Prompt-builder pure fn for the ask flow validated for the grounding rule (cites refs, forbids invention) — same pattern as `validate-plan-answer`.
- `npx tsc --noEmit` clean; anti-slop lint; `bun run ship-check` green.

## Ship boundary

- **OTA-safe:** engine + closeout-binder UI (app side).
- **Owner-gated:** `portal-ask-home` edge fn deploy; portal HTML deploy via the build-free Netlify procedure. Both after merge, coordinated with (and not blocking) the staged portal Part B lock.
- **Tier:** passport generation gated `client_portal`-level access (Pro+ — matches the portal itself); the FAQ pre-answering + memory indexing ride existing `project_memory` caps.

## Out of scope (v2+)

- Maintenance/warranty foresight nudges to the homeowner (House FORESEES — increment 2, rides on this data).
- Homeowner accounts / email→project linking; multi-contractor house history.
- Photo phase-tagging UI ("pre-drywall") and vision indexing of photo *content*; v1 indexes captions/locations only.
- Warranty claim filing from the portal.

## Files

- **Create:** `utils/passport/buildHomePassport.ts`, `utils/passport/askHomePrompt.ts`, `scripts/validate-home-passport.ts`, `supabase/functions/portal-ask-home/index.ts`
- **Modify:** `app/closeout-binder.tsx` (generate step), `utils/portalSnapshot.ts` (faq + passport summary in closeout section), `marketing/portal/index.html` (passport + ask UI), `package.json` (validator)
- **Reference (unchanged):** `utils/closeoutBinderEngine.ts`, `utils/projectMemory.ts`, `supabase/functions/project-memory-embed/`, `supabase/functions/validate-portal-passcode/` (auth+rate-limit pattern), `_shared/embeddings.ts`
