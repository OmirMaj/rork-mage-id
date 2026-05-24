# Plan Code Red-Line (Construction AI — A) — Design

**Date:** 2026-05-23
**Status:** Approved (design) — ready for implementation plan
**Scope:** v1 of feature **A**. Ships in the same batched release as **B** (Permit & Inspection Roadmap, already built).

## Goal

An **AI pre-check** that flags *likely* code violations in the GC's **uploaded drawings** before the city does — egress window size, stair riser/tread, hallway/door width, ceiling height, fire separation, ADA, guards/handrails. It runs on the GC's *actual* PlanSheets (the moat). Explicitly framed as a pre-check the GC **verifies against the AHJ** — not a substitute for plan review.

## OTA note (important)

Vision must run **server-side** (the Gemini key can't ship to the client, and `analyze-drawings` is hard-wired to quantity takeoff). So A needs **one new edge function** (`analyze-plan-code`), deployed via the Supabase CLI/MCP — **not pure OTA**. The **client "Plan Review" UI is OTA**. Batched release = OTA (B + A's client UI) **+** one edge-fn deploy.

## Architecture

### New edge function: `supabase/functions/analyze-plan-code/index.ts`
Mirror `analyze-drawings/index.ts` structure (Deno `serve`, CORS, Gemini call, `requireTier`, `aiUsageIncrement`, byte cap):
- **Auth/tier:** `requireTier(req, ['pro','business'], 'plan_code_review')` (Pro+; free tier blocked). Add a `plan_code_review` row to `MONTHLY_CAPS` in `supabase/functions/_shared/auth.ts` — **low caps** (vision is costly): `free: 0, pro: 10, business: 30, enterprise: 60`. Increment via `aiUsageIncrement(userId, 'plan_code_review')` on success only.
- **Input:** `{ imageBase64: string, mimeType: string, location?: string, projectType?: string }`. Enforce the same `MAX_PAGE_BYTES` (8 MB) guard on the decoded image.
- **Prompt:** a building-code reviewer. "Review this construction drawing for LIKELY code issues. For each, give: category (egress|stairs|width|height|fire|ada|guards|other), codeRef (IRC/IBC section), requirement, observed (what the drawing shows that conflicts), severity (high|med|low), confidence (high|med|low). Only flag what you can actually see; prefer fewer high-confidence findings over speculation. This is a pre-check the GC will verify against their AHJ."
- **Output:** `{ success: boolean, data?: { findings: Finding[], disclaimer: string }, error?: string }` where `Finding = { category, codeRef, requirement, observed, severity, confidence }`. Use Gemini's JSON mode + defensive parsing (mirror analyze-drawings).
- **verify_jwt:** true (deploy default — user-authed feature, like analyze-drawings).

### Client data model (`types/index.ts`)
```ts
export interface CodeFinding {
  id: string;
  category: string;          // egress | stairs | width | height | fire | ada | guards | other
  codeRef: string;
  requirement: string;
  observed: string;
  severity: 'high' | 'med' | 'low';
  confidence: 'high' | 'med' | 'low';
  status: 'open' | 'resolved' | 'dismissed';
}
export interface PlanReview {
  id: string;
  projectId: string;
  planSheetId: string;
  reviewedAt: string;
  findings: CodeFinding[];
}
```

### Persistence (`tertiary_plan_reviews`, local-first — mirror PlanZone/DrawingPin)
ProjectContext: state `planReviews: PlanReview[]`, `getPlanReviewForSheet(planSheetId)`, `savePlanReview` (upsert one per planSheetId), `updatePlanReview(id, patch)` (finding status toggles), `deletePlanReview(id)`. **No `supabaseWrite`** (v1 local-first; no migration).

### Client flow ("Plan Review" mode in `app/(tabs)/construction-ai/index.tsx`)
Third mode toggle: **Code Check | Project Roadmap | Plan Review**. In Plan Review:
1. Pick project → pick a **PlanSheet** (`getPlanSheetsForProject`).
2. **"Review for code"** → read the sheet image to **base64** (use the app's existing image→base64 approach — verify how `drawing-analyzer.tsx`/photo flows convert `imageUri`; `expo-file-system` `readAsStringAsync({encoding:'base64'})` for `file://`, `fetch`+base64 for `https`/data URI) → `supabase.functions.invoke('analyze-plan-code', { body: { imageBase64, mimeType, location: project.location, projectType: project.type } })`.
3. Gate with the existing client limiter — new `ai_plan_review` `FEATURE_LIMITS` entry (`free 0, pro 10, business 30, enterprise 60`) + `checkAILimit`/`recordAIUsage` (a new `planReview` feature key, mirroring `drawingAnalysis`), and a Paywall for free tier.
4. On success → `savePlanReview` (assign `id`s + `status:'open'`). Render findings **grouped by severity**, each with the code ref, requirement, observed, a **confidence chip**, and a status control (open → resolved → dismissed, persisted via `updatePlanReview`). A persistent **disclaimer banner**: "AI pre-check — verify each finding against your local code official. Not a substitute for plan review." Re-run = "Re-review" (replaces, carrying over `status` by `codeRef` match). Reuse the screen's existing loader Modal.

## Reliability (per the approved choice)
Pre-check + per-finding **confidence** + the **disclaimer banner**. The prompt biases toward fewer high-confidence findings. v1 = **text findings only** (no on-plan coordinate pins — vision coordinate output is unreliable).

## Edge cases
- **No PlanSheet** → empty state ("Upload a floor plan / drawing first").
- **Image read fails** → error toast; don't call the fn.
- **AI failure / rate-limited** → error state + retry; daily/monthly cap message (reuse the code-check/limit alert).
- **No location** → fn returns generic IRC/IBC guidance + the UI shows "jurisdiction unknown — verify locally."
- **Free tier** → Paywall (server also blocks via `plan_code_review: 0`).

## Testing & gates
No unit runner (per CLAUDE.md). Client gate per task = `npx tsc --noEmit` clean + grep. The edge fn is type-checked at deploy (esbuild) — deploy with `--no-verify-jwt` NOT used (keep verify_jwt default true). Strict TS, no `any`, theme-aware, OTA-safe client.

## Out of scope (v1)
- On-plan location **pins** for findings.
- Multi-page **batch** review (v1 = one sheet at a time).
- Jurisdiction-specific code **database** (AI cites general IRC/IBC).
- Auto-linking findings to permits/schedule.
- Cross-device **sync** of reviews (local-first now).
