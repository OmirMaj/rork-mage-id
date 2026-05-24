# Plan Code Red-Line (Construction AI — A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an AI pre-check that flags likely code violations in a GC's uploaded plan sheet (egress, stairs, width, height, fire, ADA, guards) before the city does — a new server-side vision edge function plus an OTA client "Plan Review" mode in the Construction AI tool.

**Architecture:** A new Deno edge function `analyze-plan-code` (mirrors `analyze-drawings`, but takes one inline base64 image instead of fetching page URLs) calls Gemini for a structured findings list. The client converts a `PlanSheet` image to base64, invokes the function via `supabase.functions.invoke`, persists the result local-first in `ProjectContext` (`tertiary_plan_reviews`, no Supabase sync, no migration), and renders findings grouped by severity with confidence chips, a status control, and a persistent disclaimer banner. Gating mirrors feature B: server `requireTier` + `MONTHLY_CAPS`, client `FEATURE_LIMITS.ai_plan_review_daily` + `ai_usage_daily_*` RPCs.

**Tech Stack:** React Native / Expo (TypeScript strict, no `any`), Supabase edge functions (Deno), Gemini 2.5 Flash vision, `expo-file-system`, `lucide-react-native`, AsyncStorage local-first persistence.

**Per-task gate (NO unit runner — per CLAUDE.md):** Each task ends with `npx tsc --noEmit` clean at the worktree root **plus** the grep assertion(s) listed, then a commit. Strict TS, no `any`, theme-aware, OTA-safe client. The edge function (Task 2) is Deno and is excluded from the app `tsconfig` — its real type-check is at deploy (esbuild); its task gate is file-creation + self-review + grep + confirming app `tsc` stays clean. **Do NOT deploy the edge function or run `eas update` during this plan** — deployment/OTA is a separate batched ship step (A + B together) gated on the user's explicit signal.

**Worktree:** `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`, branch `claude/p0-launch-on-main`. Run all commands from the worktree root.

---

## File Structure

- **Create:** `supabase/functions/analyze-plan-code/index.ts` — the vision edge function (inline base64 → Gemini → findings JSON). Owns server-side auth, cap check, prompt, parse.
- **Modify:** `supabase/functions/_shared/auth.ts` — add `plan_code_review` to every tier in `MONTHLY_CAPS`.
- **Modify:** `types/index.ts` — add `CodeFinding` + `PlanReview` domain types (single source of truth).
- **Modify:** `contexts/ProjectContext.tsx` — add `tertiary_plan_reviews` local-first state + CRUD (mirror `PlanZone`), wired into the context interface, the returned value object, and the `useMemo` dependency array.
- **Create:** `utils/planCodeReviewer.ts` — client helpers: `imageUriToBase64` (file/https/data) and `reviewPlanCode` (the `supabase.functions.invoke` wrapper). One responsibility: get an image to the function and back.
- **Modify:** `hooks/useTierAccess.ts` — add `ai_plan_review_daily` to `FEATURE_LIMITS`.
- **Modify:** `app/(tabs)/construction-ai/index.tsx` — add the third "Plan Review" mode (toggle, project + sheet pickers, run/re-review, findings render, status control, disclaimer banner, paywall on over-limit).

---

## Task 1: Domain types — `CodeFinding` + `PlanReview`

**Files:**
- Modify: `types/index.ts` (add near the `PlanZone` interface, around L1916)

- [ ] **Step 1: Add the types**

In `types/index.ts`, immediately after the `PlanZone` interface (ends ~L1916), add:

```ts
// ── Plan Code Red-Line (Construction AI — A) ─────────────────────────────
export type CodeFindingCategory =
  | 'egress' | 'stairs' | 'width' | 'height' | 'fire' | 'ada' | 'guards' | 'other';
export type CodeFindingSeverity = 'high' | 'med' | 'low';
export type CodeFindingConfidence = 'high' | 'med' | 'low';
export type CodeFindingStatus = 'open' | 'resolved' | 'dismissed';

export interface CodeFinding {
  id: string;
  category: CodeFindingCategory;
  codeRef: string;           // e.g. "IRC R311.7.5" / "IBC 1011.5"
  requirement: string;       // what code requires
  observed: string;          // what the drawing shows that conflicts
  severity: CodeFindingSeverity;
  confidence: CodeFindingConfidence;
  status: CodeFindingStatus;
}

export interface PlanReview {
  id: string;
  projectId: string;
  planSheetId: string;       // one review per plan sheet (upsert)
  reviewedAt: string;        // ISO timestamp
  findings: CodeFinding[];
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean (no new errors).

- [ ] **Step 3: Grep assertion**

Run: `grep -n "export interface CodeFinding" types/index.ts && grep -n "export interface PlanReview" types/index.ts && grep -n "export type CodeFindingStatus" types/index.ts`
Expected: all three match.

- [ ] **Step 4: Commit**

```bash
git add types/index.ts
git commit -m "feat(plan-review): CodeFinding + PlanReview types"
```

---

## Task 2: Edge function `analyze-plan-code` + monthly cap

**Files:**
- Create: `supabase/functions/analyze-plan-code/index.ts`
- Modify: `supabase/functions/_shared/auth.ts` (`MONTHLY_CAPS`, ~L278-311)

- [ ] **Step 1: Add the monthly cap key**

In `supabase/functions/_shared/auth.ts`, add `plan_code_review` to each tier in `MONTHLY_CAPS` (vision is costly → low caps). The object becomes:

```ts
export const MONTHLY_CAPS: Record<Tier, Record<string, number>> = {
  free:       { analyze_drawings: 0,   analyze_photos: 0,   convert_pdf: 0,   takeoff_pages: 0,   ai_text: 150,  plan_code_review: 0  },
  pro:        { analyze_drawings: 15,  analyze_photos: 50,  convert_pdf: 50,  takeoff_pages: 30,  ai_text: 900,  plan_code_review: 10 },
  business:   { analyze_drawings: 50,  analyze_photos: 150, convert_pdf: 150, takeoff_pages: 100, ai_text: 2400, plan_code_review: 30 },
  enterprise: { analyze_drawings: 100, analyze_photos: 200, convert_pdf: 300, takeoff_pages: 300, ai_text: 4500, plan_code_review: 60 },
};
```

(Keep the existing keys/values exactly — only append `plan_code_review` to each line.)

- [ ] **Step 2: Verify `aiUsageGet` exists**

Run: `grep -n "export async function aiUsageGet" supabase/functions/_shared/auth.ts`
Expected: a match (~L236). It is `aiUsageGet(userId: string, feature: string): Promise<number>`. The function uses it to check the cap *before* the Gemini call so a credit is only consumed on success (per spec: "increment on success only").

- [ ] **Step 3: Create the edge function**

Create `supabase/functions/analyze-plan-code/index.ts` with exactly:

```ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier, aiUsageGet, aiUsageIncrement, MONTHLY_CAPS } from "../_shared/auth.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const MAX_PAGE_BYTES = 8 * 1024 * 1024;
const MODEL = "gemini-2.5-flash";
function geminiEndpoint(): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

interface PlanCodeRequest {
  imageBase64: string;
  mimeType: string;
  location?: string;
  projectType?: string;
}

function buildPrompt(req: PlanCodeRequest): string {
  const loc = req.location?.trim() || "jurisdiction unknown";
  const ptype = req.projectType?.trim() || "residential/commercial construction";
  return [
    "You are a meticulous building-code plan reviewer. Review THIS construction drawing for LIKELY code issues a plan examiner would flag.",
    `Project location: ${loc}. Project type: ${ptype}.`,
    "Cite general IRC/IBC sections (and ADA where relevant). If the location is unknown, give general IRC/IBC guidance and do not invent local amendments.",
    "Only flag what you can ACTUALLY SEE in the drawing. Prefer fewer high-confidence findings over speculation. This is a PRE-CHECK the GC will verify against their AHJ — it is not a substitute for plan review.",
    "Return STRICT JSON of this exact shape and nothing else:",
    '{"findings":[{"category":"egress|stairs|width|height|fire|ada|guards|other","codeRef":"IRC/IBC section","requirement":"what code requires","observed":"what the drawing shows that conflicts","severity":"high|med|low","confidence":"high|med|low"}],"disclaimer":"one sentence reminding the GC to verify against the local code official"}',
    'If you see no likely issues, return {"findings":[],"disclaimer":"..."}.',
  ].join("\n");
}

function approxBase64Bytes(b64: string): number {
  const len = b64.length;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((len * 3) / 4) - padding;
}

async function callGemini(req: PlanCodeRequest): Promise<unknown> {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured on the server.");
  if (!req.imageBase64) throw new Error("No image provided.");
  if (approxBase64Bytes(req.imageBase64) > MAX_PAGE_BYTES) {
    throw new Error("Image too large (max 8MB). Try a lower-resolution export.");
  }
  const mimeType = req.mimeType && req.mimeType.startsWith("image/")
    ? req.mimeType.split(";")[0]
    : "image/png";
  const body = {
    contents: [{ parts: [
      { inlineData: { mimeType, data: req.imageBase64 } },
      { text: buildPrompt(req) },
    ] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 8192 },
  };
  const r = await fetch(`${geminiEndpoint()}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    throw new Error(`Gemini ${r.status}: ${errText.slice(0, 400)}`);
  }
  const json = await r.json();
  const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!raw) throw new Error("Gemini returned no text.");
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Could not parse AI response as JSON: ${(e as Error).message}\nRaw: ${raw.slice(0, 400)}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "Method not allowed" }, 405);

  const auth = await requireTier(req, ["pro", "business"], "plan_code_review");
  if (!auth.ok) return jsonResponse(auth.body, auth.status);

  try {
    const body = await req.json() as PlanCodeRequest;
    if (!body || typeof body.imageBase64 !== "string" || !body.imageBase64) {
      return jsonResponse({ success: false, error: "Missing imageBase64" }, 400);
    }

    const cap = MONTHLY_CAPS[auth.tier].plan_code_review;
    const used = await aiUsageGet(auth.userId, "plan_code_review");
    if (used >= cap) {
      return jsonResponse({
        success: false,
        error: `Monthly plan-review limit reached (${cap} on ${auth.tier}). Resets on the 1st.`,
        code: "monthly_cap_reached",
        used,
        cap,
      }, 429);
    }

    const data = await callGemini(body);
    const newUsed = await aiUsageIncrement(auth.userId, "plan_code_review");
    return jsonResponse({ success: true, data, usage: { used: newUsed, cap } });
  } catch (e) {
    console.error("[analyze-plan-code] failed", e);
    return jsonResponse({ success: false, error: String((e as Error).message ?? e) }, 500);
  }
});
```

- [ ] **Step 4: Self-review against `analyze-drawings`**

Open `supabase/functions/analyze-drawings/index.ts` and confirm the new file matches its conventions: same CORS header literal, same `jsonResponse` shape, same `requireTier(...)` → `if (!auth.ok)` guard, same Gemini endpoint/JSON-mode config, same `console.error('[analyze-plan-code] failed', e)` style. Confirm the import line resolves real exports: `requireTier`, `aiUsageGet`, `aiUsageIncrement`, `MONTHLY_CAPS` all exist in `_shared/auth.ts`.

- [ ] **Step 5: Confirm the app type-check is unaffected**

Run: `npx tsc --noEmit`
Expected: clean. (The app `tsconfig` excludes `supabase/functions`, which use Deno/remote imports — `analyze-drawings` already lives there and `tsc` is clean, so the new file must not introduce app errors. If `tsc` reports errors *inside* `supabase/functions/**`, the exclude is missing — STOP and report; do not edit `tsconfig` without confirmation.)

- [ ] **Step 6: Grep assertions**

Run:
```bash
grep -n "plan_code_review" supabase/functions/_shared/auth.ts | head
grep -n "requireTier(req, \[\"pro\", \"business\"\], \"plan_code_review\")" supabase/functions/analyze-plan-code/index.ts
grep -n "inlineData: { mimeType, data: req.imageBase64 }" supabase/functions/analyze-plan-code/index.ts
```
Expected: `plan_code_review` appears 4× in auth.ts (one per tier); both grep lines in the new file match.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/analyze-plan-code/index.ts supabase/functions/_shared/auth.ts
git commit -m "feat(plan-review): analyze-plan-code edge function + monthly cap"
```

---

## Task 3: Local-first persistence — `tertiary_plan_reviews`

**Files:**
- Modify: `contexts/ProjectContext.tsx`

This mirrors the `PlanZone` pattern (local-only, **no `supabaseWrite`, no migration**) but upserts **one review per `planSheetId`**. Updates must land in **three** places: the context-type interface, the returned object literal, and the `useMemo` dependency array.

- [ ] **Step 1: Import the type**

Find the existing type import from `@/types` (the import that already pulls `PlanZone`, `PlanSheet`, etc.). Add `PlanReview` to it. Verify:

Run: `grep -n "PlanZone" contexts/ProjectContext.tsx | head`
Then add `PlanReview` alongside `PlanZone` in that import list.

- [ ] **Step 2: Add the AsyncStorage key constant**

Next to `const PLAN_ZONES_KEY = 'tertiary_plan_zones';` (~L40) add:

```ts
const PLAN_REVIEWS_KEY = 'tertiary_plan_reviews';
```

- [ ] **Step 3: Add state**

Next to `const [planZones, setPlanZones] = useState<PlanZone[]>([]);` (~L2933) add:

```ts
const [planReviews, setPlanReviews] = useState<PlanReview[]>([]);
```

- [ ] **Step 4: Load from storage**

In the same startup effect that contains `void loadLocal<PlanZone[]>(PLAN_ZONES_KEY, []).then(setPlanZones);` (~L2941) add the sibling line:

```ts
void loadLocal<PlanReview[]>(PLAN_REVIEWS_KEY, []).then(setPlanReviews);
```

- [ ] **Step 5: Add the persist helper + CRUD**

Next to `persistPlanZones` (~L2955) add:

```ts
const persistPlanReviews = useCallback((list: PlanReview[]) => {
  setPlanReviews(list);
  void saveLocal(PLAN_REVIEWS_KEY, list);
}, []);
```

Next to the `PlanZone` CRUD block (~L3126-3142) add:

```ts
const getPlanReviewForSheet = useCallback((planSheetId: string): PlanReview | null =>
  planReviews.find((r) => r.planSheetId === planSheetId) ?? null, [planReviews]);

const savePlanReview = useCallback((review: PlanReview) => {
  // upsert one review per plan sheet
  persistPlanReviews([review, ...planReviews.filter((r) => r.planSheetId !== review.planSheetId)]);
}, [planReviews, persistPlanReviews]);

const updatePlanReview = useCallback((id: string, patch: Partial<PlanReview>) => {
  persistPlanReviews(planReviews.map((r) => (r.id === id ? { ...r, ...patch } : r)));
}, [planReviews, persistPlanReviews]);

const deletePlanReview = useCallback((id: string) => {
  persistPlanReviews(planReviews.filter((r) => r.id !== id));
}, [planReviews, persistPlanReviews]);
```

- [ ] **Step 6: Declare in the context-type interface**

Find the `ProjectContextValue` interface block where `planZones` / `addPlanZone` are declared (~L171-176) and add:

```ts
planReviews: PlanReview[];
getPlanReviewForSheet: (planSheetId: string) => PlanReview | null;
savePlanReview: (review: PlanReview) => void;
updatePlanReview: (id: string, patch: Partial<PlanReview>) => void;
deletePlanReview: (id: string) => void;
```

- [ ] **Step 7: Add to the returned value object**

In the `useMemo` return object where `planZones, addPlanZone, ...` are listed (~L3252) add:

```ts
planReviews, getPlanReviewForSheet, savePlanReview, updatePlanReview, deletePlanReview,
```

- [ ] **Step 8: Add to the `useMemo` dependency array**

In the same `useMemo`'s dependency array (~L3256) append:

```ts
planReviews, getPlanReviewForSheet, savePlanReview, updatePlanReview, deletePlanReview, persistPlanReviews,
```

- [ ] **Step 9: Type-check**

Run: `npx tsc --noEmit`
Expected: clean. (A missing entry in any of the three places, or a signature mismatch, will surface here.)

- [ ] **Step 10: Grep assertions**

Run:
```bash
grep -n "tertiary_plan_reviews" contexts/ProjectContext.tsx
grep -n "getPlanReviewForSheet" contexts/ProjectContext.tsx | wc -l
grep -n "savePlanReview" contexts/ProjectContext.tsx | wc -l
```
Expected: `tertiary_plan_reviews` matches once; `getPlanReviewForSheet` and `savePlanReview` each appear ≥3× (interface, definition, return object).

- [ ] **Step 11: Commit**

```bash
git add contexts/ProjectContext.tsx
git commit -m "feat(plan-review): tertiary_plan_reviews local-first persistence"
```

---

## Task 4: Client gate + invoke wrapper

**Files:**
- Modify: `hooks/useTierAccess.ts` (`FEATURE_LIMITS`)
- Create: `utils/planCodeReviewer.ts`

- [ ] **Step 1: Add the daily limit entry**

In `hooks/useTierAccess.ts`, find the `FEATURE_LIMITS` object and the existing `ai_permit_roadmap_daily` entry. Run:

`grep -n "ai_permit_roadmap_daily" hooks/useTierAccess.ts`

Directly below that entry, add (matching its exact shape):

```ts
ai_plan_review_daily: { free: 0, pro: 10, business: 30, enterprise: 60 },
```

(These daily caps mirror the server `MONTHLY_CAPS.plan_code_review` so the UI and server agree.)

- [ ] **Step 2: Create the client wrapper + image helper**

Create `utils/planCodeReviewer.ts` with exactly:

```ts
import * as FileSystem from 'expo-file-system';
import { supabase } from '@/lib/supabase';

export interface PlanCodeFindingRaw {
  category?: string;
  codeRef?: string;
  requirement?: string;
  observed?: string;
  severity?: string;
  confidence?: string;
}

export interface PlanCodeResult {
  findings: PlanCodeFindingRaw[];
  disclaimer: string;
}

export const PLAN_REVIEW_DISCLAIMER =
  'AI pre-check — verify each finding against your local code official. Not a substitute for plan review.';

function mimeFromExt(uri: string): string {
  const ext = uri.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic') return 'image/heic';
  return 'image/jpeg';
}

/**
 * Convert a PlanSheet image URI (data:, file://, /, or https://) to base64 + mime.
 * Local files are read directly; remote files are downloaded to cache then read.
 */
export async function imageUriToBase64(uri: string): Promise<{ base64: string; mimeType: string }> {
  if (uri.startsWith('data:')) {
    const comma = uri.indexOf(',');
    const meta = uri.slice(5, comma); // e.g. "image/png;base64"
    const mimeType = meta.split(';')[0] || 'image/png';
    return { base64: uri.slice(comma + 1), mimeType };
  }
  if (uri.startsWith('file:') || uri.startsWith('/')) {
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
    return { base64, mimeType: mimeFromExt(uri) };
  }
  // remote http(s): download to cache, read, clean up
  const target = `${FileSystem.cacheDirectory}plan-review-${Date.now()}`;
  const dl = await FileSystem.downloadAsync(uri, target);
  try {
    const base64 = await FileSystem.readAsStringAsync(dl.uri, { encoding: 'base64' });
    return { base64, mimeType: mimeFromExt(uri) };
  } finally {
    void FileSystem.deleteAsync(dl.uri, { idempotent: true });
  }
}

export async function reviewPlanCode(opts: {
  imageBase64: string;
  mimeType: string;
  location?: string;
  projectType?: string;
}): Promise<PlanCodeResult> {
  const { data, error } = await supabase.functions.invoke<{
    success: boolean;
    data?: PlanCodeResult;
    error?: string;
  }>('analyze-plan-code', { body: opts });
  if (error) throw new Error(`Plan review call failed: ${error.message}`);
  if (!data?.success || !data.data) throw new Error(data?.error ?? 'Plan review returned an empty result.');
  return {
    findings: Array.isArray(data.data.findings) ? data.data.findings : [],
    disclaimer: data.data.disclaimer || PLAN_REVIEW_DISCLAIMER,
  };
}
```

- [ ] **Step 3: Verify `expo-file-system` API usage matches existing code**

Run: `grep -n "readAsStringAsync" utils/photoAnalyzer.ts`
Expected: confirms the app already calls `FileSystem.readAsStringAsync(..., { encoding: 'base64' })` — the new file uses the identical call shape. (If `photoAnalyzer.ts` uses a different encoding form, match whatever compiles there.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Grep assertions**

Run:
```bash
grep -n "ai_plan_review_daily" hooks/useTierAccess.ts
grep -n "supabase.functions.invoke" utils/planCodeReviewer.ts
grep -n "analyze-plan-code" utils/planCodeReviewer.ts
```
Expected: all match.

- [ ] **Step 6: Commit**

```bash
git add hooks/useTierAccess.ts utils/planCodeReviewer.ts
git commit -m "feat(plan-review): client gate + analyze-plan-code invoke wrapper"
```

---

## Task 5: "Plan Review" mode in the Construction AI screen

**Files:**
- Modify: `app/(tabs)/construction-ai/index.tsx`

This adds a third mode to the existing `Code Check | Project Roadmap` toggle. Mirror feature B's roadmap mode (project picker, daily-usage RPC gate, paywall on over-limit, loader, results render). Use static-hex colors for any chip that appends an alpha suffix (the screen's existing `INSP_STATUS_COLORS` rule).

- [ ] **Step 1: Imports**

At the top of the file:
- Add to the `@/types` import: `CodeFinding`, `PlanReview`.
- Add a new import: `import { reviewPlanCode, imageUriToBase64, PLAN_REVIEW_DISCLAIMER } from '@/utils/planCodeReviewer';`
- Add a Lucide icon for the toggle: include `ShieldCheck` (and `FileWarning` for finding rows) in the existing `lucide-react-native` import.
- In the `useProjects()` destructure, add: `getPlanSheetsForProject`, `getPlanReviewForSheet`, `savePlanReview`, `updatePlanReview`.

Verify the destructure target:
Run: `grep -n "useProjects()" app/(tabs)/construction-ai/index.tsx`

- [ ] **Step 2: Module-scope constants + normalizers + usage helpers**

Near the existing `INSP_STATUS_COLORS` / `getRoadmapTodayUsage` definitions (module scope, above the component), add:

```ts
const SEVERITY_COLORS: Record<CodeFinding['severity'], string> = {
  high: '#FF3B30',
  med: '#FF9500',
  low: '#34C759',
};
const SEVERITY_LABEL: Record<CodeFinding['severity'], string> = {
  high: 'High', med: 'Medium', low: 'Low',
};
const CONFIDENCE_LABEL: Record<CodeFinding['confidence'], string> = {
  high: 'High confidence', med: 'Medium confidence', low: 'Low confidence',
};
const FINDING_STATUS_LABEL: Record<CodeFinding['status'], string> = {
  open: 'Open', resolved: 'Resolved', dismissed: 'Dismissed',
};
const SEVERITY_ORDER: CodeFinding['severity'][] = ['high', 'med', 'low'];
const CODE_CATEGORIES: CodeFinding['category'][] =
  ['egress', 'stairs', 'width', 'height', 'fire', 'ada', 'guards', 'other'];

function normalizeCategory(c?: string): CodeFinding['category'] {
  const v = (c ?? '').toLowerCase() as CodeFinding['category'];
  return CODE_CATEGORIES.includes(v) ? v : 'other';
}
function normalizeLevel(s?: string): 'high' | 'med' | 'low' {
  const v = (s ?? '').toLowerCase();
  return v === 'high' || v === 'low' ? v : 'med';
}

async function getPlanReviewTodayUsage(userId?: string): Promise<number> {
  if (!userId) return 0;
  const { data } = await supabase.rpc('ai_usage_daily_get', { p_user_id: userId, p_feature: 'ai_plan_review' });
  return typeof data === 'number' ? data : 0;
}
async function bumpPlanReviewTodayUsage(userId?: string): Promise<void> {
  if (!userId) return;
  await supabase.rpc('ai_usage_daily_increment', { p_user_id: userId, p_feature: 'ai_plan_review' });
}
```

- [ ] **Step 3: Widen the mode union + add state**

Change the mode state (currently `useState<'code' | 'roadmap'>('code')`, ~L238) to:

```ts
const [mode, setMode] = useState<'code' | 'roadmap' | 'plan'>('code');
```

Near the roadmap state (~L260), add Plan Review state + derived values:

```ts
const [planProjectId, setPlanProjectId] = useState<string | null>(projects[0]?.id ?? null);
const [planSheetId, setPlanSheetId] = useState<string | null>(null);
const [planLoading, setPlanLoading] = useState(false);
const [planOverLimit, setPlanOverLimit] = useState(false);

const planProject = projects.find((p) => p.id === planProjectId) ?? null;
const planSheets = planProjectId ? getPlanSheetsForProject(planProjectId) : [];
const planSheet = planSheets.find((s) => s.id === planSheetId) ?? null;
const existingReview = planSheetId ? getPlanReviewForSheet(planSheetId) : null;
const planDailyCap = useMemo(() => FEATURE_LIMITS.ai_plan_review_daily[tier], [tier]);
```

- [ ] **Step 4: The run handler**

Near `runGenerateRoadmap` (~L272) add:

```ts
const runPlanReview = useCallback(async () => {
  if (!planProject || !planSheet) return;
  const used = await getPlanReviewTodayUsage(user?.id);
  if (used >= planDailyCap) {
    setPlanOverLimit(true);
    return;
  }
  setPlanLoading(true);
  try {
    const { base64, mimeType } = await imageUriToBase64(planSheet.imageUri);
    const res = await reviewPlanCode({
      imageBase64: base64,
      mimeType,
      location: planProject.location,
      projectType: planProject.type,
    });

    const prior = getPlanReviewForSheet(planSheet.id);
    const priorStatusByRef = new Map(
      (prior?.findings ?? []).map((f) => [f.codeRef, f.status] as const),
    );
    const reviewId = prior?.id ?? `plan-review-${planSheet.id}-${Date.now()}`;

    const findings: CodeFinding[] = res.findings.map((f, i) => {
      const codeRef = (f.codeRef ?? '').trim() || 'IRC/IBC (general)';
      return {
        id: `${reviewId}-${i}`,
        category: normalizeCategory(f.category),
        codeRef,
        requirement: (f.requirement ?? '').trim(),
        observed: (f.observed ?? '').trim(),
        severity: normalizeLevel(f.severity),
        confidence: normalizeLevel(f.confidence),
        status: priorStatusByRef.get(codeRef) ?? 'open',
      };
    });

    savePlanReview({
      id: reviewId,
      projectId: planProject.id,
      planSheetId: planSheet.id,
      reviewedAt: new Date().toISOString(),
      findings,
    });
    void bumpPlanReviewTodayUsage(user?.id);
  } catch (e) {
    Alert.alert('Plan review failed', e instanceof Error ? e.message : 'Please try again.');
  } finally {
    setPlanLoading(false);
  }
}, [planProject, planSheet, planDailyCap, user?.id, getPlanReviewForSheet, savePlanReview]);

const cycleFindingStatus = useCallback((review: PlanReview, findingId: string) => {
  const next: Record<CodeFinding['status'], CodeFinding['status']> = {
    open: 'resolved', resolved: 'dismissed', dismissed: 'open',
  };
  updatePlanReview(review.id, {
    findings: review.findings.map((f) => (f.id === findingId ? { ...f, status: next[f.status] } : f)),
  });
}, [updatePlanReview]);
```

- [ ] **Step 5: Add the third toggle button**

In the mode-toggle bar JSX (the row with `mode-toggle-code` / `mode-toggle-roadmap`, ~L423-442), add a third `TouchableOpacity` mirroring the others:

```tsx
<TouchableOpacity
  testID="mode-toggle-plan"
  style={[styles.modeToggleBtn, mode === 'plan' && styles.modeToggleBtnActive]}
  onPress={() => setMode('plan')}
>
  <ShieldCheck size={16} color={mode === 'plan' ? Colors.background : Colors.text} />
  <Text style={[styles.modeToggleText, mode === 'plan' && styles.modeToggleTextActive]}>Plan Review</Text>
</TouchableOpacity>
```

(Match the exact icon-color / active-text-color expressions used by the existing two buttons — if they use a theme token other than `Colors.background`/`Colors.text`, mirror that.)

- [ ] **Step 6: Render the Plan Review body**

The body currently switches on `mode === 'code' ? (...) : (...)`. Convert to handle three modes. Keep the existing code block for `'code'` and the roadmap block for `'roadmap'`, and add a `'plan'` block. The cleanest edit: change the ternary to render by mode, e.g. wrap each existing block and append the new one:

```tsx
{mode === 'code' && (
  /* ...existing Code Check block unchanged... */
)}
{mode === 'roadmap' && (
  /* ...existing Project Roadmap block unchanged... */
)}
{mode === 'plan' && (
  <View style={styles.section}>
    {/* Disclaimer banner — always visible in this mode */}
    <View style={styles.planDisclaimer}>
      <Text style={styles.planDisclaimerText}>{PLAN_REVIEW_DISCLAIMER}</Text>
    </View>

    {/* Project picker */}
    <Text style={styles.label}>Project</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
      {projects.map((p) => (
        <TouchableOpacity
          key={p.id}
          style={[styles.chip, planProjectId === p.id && styles.chipActive]}
          onPress={() => { setPlanProjectId(p.id); setPlanSheetId(null); }}
        >
          <Text style={[styles.chipText, planProjectId === p.id && styles.chipTextActive]}>{p.name}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>

    {/* Plan sheet picker / empty state */}
    {planSheets.length === 0 ? (
      <Text style={styles.emptyState}>Upload a floor plan or drawing for this project first.</Text>
    ) : (
      <>
        <Text style={styles.label}>Plan sheet</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {planSheets.map((s) => (
            <TouchableOpacity
              key={s.id}
              style={[styles.chip, planSheetId === s.id && styles.chipActive]}
              onPress={() => setPlanSheetId(s.id)}
            >
              <Text style={[styles.chipText, planSheetId === s.id && styles.chipTextActive]}>
                {s.sheetNumber ? `${s.sheetNumber} · ${s.name}` : s.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Run / Re-review */}
        {planSheet && (
          <TouchableOpacity
            testID="run-plan-review"
            style={[styles.primaryBtn, planLoading && styles.primaryBtnDisabled]}
            disabled={planLoading}
            onPress={runPlanReview}
          >
            <Text style={styles.primaryBtnText}>
              {planLoading ? 'Reviewing…' : existingReview ? 'Re-review for code' : 'Review for code'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Results */}
        {existingReview && !planLoading && (
          existingReview.findings.length === 0 ? (
            <Text style={styles.emptyState}>No likely code issues found — still verify with your AHJ.</Text>
          ) : (
            <View style={styles.findingsWrap}>
              {SEVERITY_ORDER.map((sev) => {
                const rows = existingReview.findings.filter((f) => f.severity === sev);
                if (rows.length === 0) return null;
                return (
                  <View key={sev} style={styles.severityGroup}>
                    <View style={styles.severityHeaderRow}>
                      <View style={[styles.severityDot, { backgroundColor: SEVERITY_COLORS[sev] }]} />
                      <Text style={styles.severityHeaderText}>{SEVERITY_LABEL[sev]} · {rows.length}</Text>
                    </View>
                    {rows.map((f) => (
                      <View
                        key={f.id}
                        style={[
                          styles.findingCard,
                          f.status !== 'open' && styles.findingCardMuted,
                        ]}
                      >
                        <View style={styles.findingTopRow}>
                          <Text style={styles.findingCodeRef}>{f.codeRef}</Text>
                          <Text style={styles.findingConfidence}>{CONFIDENCE_LABEL[f.confidence]}</Text>
                        </View>
                        <Text style={styles.findingRequirement}>{f.requirement}</Text>
                        {!!f.observed && <Text style={styles.findingObserved}>Observed: {f.observed}</Text>}
                        <TouchableOpacity
                          style={styles.findingStatusBtn}
                          onPress={() => cycleFindingStatus(existingReview, f.id)}
                        >
                          <Text style={styles.findingStatusText}>{FINDING_STATUS_LABEL[f.status]}</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                );
              })}
            </View>
          )
        )}
      </>
    )}
  </View>
)}
```

(Reuse the screen's existing style names where they already exist — `styles.section`, `styles.label`, `styles.chipRow`, `styles.chip`, `styles.chipActive`, `styles.chipText`, `styles.chipTextActive`, `styles.emptyState`, `styles.primaryBtn`, `styles.primaryBtnDisabled`, `styles.primaryBtnText`. Only add new styles for the ones below that don't exist.)

- [ ] **Step 7: Extend the over-limit paywall**

Find the over-limit render (`overLimit`/`roadmapOverLimit` → `<Paywall .../>`, ~L388-408). Add `planOverLimit` to the condition so it shows the paywall in Plan Review mode too:

```tsx
if (overLimit || roadmapOverLimit || planOverLimit) {
  return (
    <Paywall
      visible
      feature="AI Plan Review"
      requiredTier={tier === 'free' ? 'pro' : 'business'}
      onClose={() => { setOverLimit(false); setRoadmapOverLimit(false); setPlanOverLimit(false); }}
    />
  );
}
```

(Match the existing `Paywall` props/usage exactly — if `feature` expects a specific union or the existing code passes different prop names, mirror them; the key change is adding `planOverLimit` to the guard and resetting it in `onClose`.)

- [ ] **Step 8: Add the new styles**

In the `StyleSheet.create({...})` at the bottom, add only the styles not already present:

```ts
planDisclaimer: {
  backgroundColor: '#FF950022', // static hex+alpha — never `token + '22'` (token may be rgba())
  borderColor: '#FF9500',
  borderWidth: 1,
  borderRadius: 10,
  padding: 12,
  marginBottom: 16,
},
planDisclaimerText: { color: Colors.text, fontSize: 13, lineHeight: 18 },
findingsWrap: { marginTop: 16, gap: 16 },
severityGroup: { gap: 8 },
severityHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
severityDot: { width: 10, height: 10, borderRadius: 5 },
severityHeaderText: { color: Colors.text, fontSize: 14, fontWeight: '700' },
findingCard: {
  backgroundColor: Colors.card,
  borderRadius: 12,
  padding: 14,
  gap: 6,
  borderWidth: 1,
  borderColor: Colors.border,
},
findingCardMuted: { opacity: 0.55 },
findingTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
findingCodeRef: { color: Colors.text, fontSize: 14, fontWeight: '700' },
findingConfidence: { color: Colors.textMuted, fontSize: 12 },
findingRequirement: { color: Colors.text, fontSize: 14, lineHeight: 19 },
findingObserved: { color: Colors.textMuted, fontSize: 13, lineHeight: 18 },
findingStatusBtn: {
  alignSelf: 'flex-start',
  marginTop: 4,
  paddingVertical: 6,
  paddingHorizontal: 12,
  borderRadius: 8,
  backgroundColor: Colors.backgroundSecondary,
},
findingStatusText: { color: Colors.text, fontSize: 13, fontWeight: '600' },
```

(Use whatever theme tokens the file already imports — if it uses `theme.colors.*` from a hook rather than a `Colors` constant, mirror the file's existing convention. Match existing token names: confirm `Colors.warning`, `Colors.card`, `Colors.border`, `Colors.textMuted`, `Colors.backgroundSecondary` exist in this file's color source; substitute the nearest existing token if any are absent.)

- [ ] **Step 9: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 10: Grep assertions**

Run:
```bash
grep -n "mode-toggle-plan" "app/(tabs)/construction-ai/index.tsx"
grep -n "runPlanReview" "app/(tabs)/construction-ai/index.tsx" | wc -l
grep -n "reviewPlanCode" "app/(tabs)/construction-ai/index.tsx"
grep -n "PLAN_REVIEW_DISCLAIMER" "app/(tabs)/construction-ai/index.tsx"
grep -n "ai_plan_review" "app/(tabs)/construction-ai/index.tsx"
```
Expected: `mode-toggle-plan`, `reviewPlanCode`, `PLAN_REVIEW_DISCLAIMER`, and `ai_plan_review` each match; `runPlanReview` appears ≥2× (definition + onPress).

- [ ] **Step 11: Commit**

```bash
git add "app/(tabs)/construction-ai/index.tsx"
git commit -m "feat(plan-review): Plan Review mode in Construction AI"
```

---

## Final verification (after all tasks)

- [ ] `npx tsc --noEmit` clean at the worktree root.
- [ ] `bun run lint` passes for the touched files (no new warnings/errors).
- [ ] Whole-implementation review across all five commits (opus): edge fn mirrors `analyze-drawings` and is safe (cap enforced before the paid call, increment only on success, 8 MB guard, no key leak); client gate caps match server caps; persistence updates all three context locations; UI handles all edge cases (no sheet, image read fail, AI failure/over-limit, no location, free tier).
- [ ] **Do NOT deploy / OTA.** Commits sit on `claude/p0-launch-on-main` awaiting the user's batched ship signal (A + B together: `eas update` for the client + `supabase functions deploy analyze-plan-code` for the edge fn, with `verify_jwt` left at its default `true`).

## Edge cases covered (from spec)

- **No PlanSheet** → empty state ("Upload a floor plan or drawing for this project first").
- **Image read fails** → caught in `runPlanReview`, error Alert, function not called with empty data.
- **AI failure / rate-limited** → server returns `{success:false,error}` (or 429 `monthly_cap_reached`); client shows error Alert; client daily cap → Paywall.
- **No location** → function prompt falls back to "jurisdiction unknown"; findings cite general IRC/IBC.
- **Free tier** → client `planDailyCap = 0` → Paywall; server `requireTier(['pro','business'])` + `MONTHLY_CAPS.free.plan_code_review = 0` block it too.
- **Re-review** → replaces the per-sheet review, carrying over each finding's `status` by `codeRef` match.

## Out of scope (v1)

On-plan coordinate pins; multi-page batch review; jurisdiction-specific code database; auto-linking findings to permits/schedule; cross-device sync of reviews.
