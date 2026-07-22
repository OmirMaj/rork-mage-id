# Ask Your Plans (MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sheet-level "ask your plans" — a contractor/architect/engineer types a question about an uploaded plan set and gets a plain answer + the sheet it's on + a tap-to-jump.

**Architecture:** Reuse the existing pgvector memory pipeline. A plan sheet's extracted text is indexed as a project-memory doc (`source:'Plan Sheet'`, `ref:<sheet number>`, `doc_id:plan-sheet:<sheetId>[#chunk]`) via `project-memory-embed`; questions retrieve via `project-memory-search` (filtered to `source==='Plan Sheet'`) → the `mageAI` relay writes a grounded, cited answer → the citation's `doc_id` yields the `sheetId` for a jump to `plan-viewer`. The ONLY new backend is a `plan-extract` vision edge fn (sheet image → searchable text). **No new table, no new migration** for the MVP.

**Tech Stack:** React Native / Expo, TypeScript strict, bun; Supabase edge fns (Deno) reusing `_shared/auth.ts` `requireTier` + `_shared/embeddings.ts`; Gemini vision (`gemini-2.5-flash`) + `text-embedding-004` (768-dim); pgvector `memory_embeddings` + `match_project_memory`; `mageAI` → `ai` relay.

---

## Repo conventions (read before starting)
- **bun**. Type-check `npx tsc --noEmit`. Lint `bun run lint` (anti-slop: `Colors`/`Type`/`Tokens` only — no raw hex / inline `fontSize` / `borderRadius`; raw padding/gap/width OK). Full gate `bun run ship-check`.
- **No jest** — pure functions tested via `scripts/validate-*.ts` wired into the `ship-check` `&&`-chain (convention: relative imports `../utils/...`/`../types`, tiny `ok(name,cond)` harness, footer `console.log(\`\n${pass} passed, ${fail} failed\`); if(fail) process.exit(1);` — see `scripts/validate-copilot-diff-schedule.ts`).
- **OTA-safe** for the app/UI + pure code. The `plan-extract` edge fn is **owner-gated to deploy** (`supabase functions deploy plan-extract`). No migration in this MVP.
- **Verified reuse interfaces:**
  - `project-memory-embed` (POST): `{ projectId, docs: [{ doc_id, source, ref, content }] }` → `{ success, embedded }`. `requireTier(['pro','business','enterprise'],'project_memory')`, user-JWT.
  - `project-memory-search` (POST): `{ projectId, query, matchCount }` → `{ success, matches: [{ doc_id, source, ref, content, similarity }] }`.
  - `convert-pdf-to-images` (POST): `{ pdfStoragePath, projectId, dpi?, maxPages? }` → `{ pages:[{pageNumber, storagePath, publicUrl, width, height}], usage }`.
  - `analyze-plan-code/index.ts` vision mechanism (reuse pattern): `gemini-2.5-flash`, input `{ imageBase64, mimeType }`, strict-JSON out. `_shared/auth.ts` `requireTier` + `_shared/embeddings.ts geminiEmbed(texts:string[]):number[][]`.
  - `PlanSheet` (`types/index.ts`): `{ id, projectId, name, sheetNumber?, imageUri, pageNumber?, width?, height?, revision?, superseded?, createdAt, updatedAt }`.
  - `mageAI({ prompt, schema?, schemaHint?, tier?, maxTokens?, feature? }) → { success, data, raw?, errorKind? }` (`utils/mageAI.ts`).
  - `plan-viewer` jump: `router.push({ pathname: '/plan-viewer', params: { sheetId } })`; reads `useLocalSearchParams().sheetId`.

## File Structure
- **Create** `utils/plans/planChunk.ts` — pure: turn a sheet's extracted text into embed-ready memory docs. Validator-safe.
- **Create** `utils/plans/planAnswer.ts` — pure: build the grounded ask-prompt from retrieved matches + parse the cited answer (+ the "prefer not-found over hallucination" rule + `doc_id → sheetId`). Validator-safe.
- **Create** `scripts/validate-plan-chunk.ts`, `scripts/validate-plan-answer.ts` — validators; wire into ship-check.
- **Create** `supabase/functions/plan-extract/index.ts` — vision edge fn: sheet image → searchable text. `requireTier` Business+.
- **Create** `utils/plans/askYourPlans.ts` — non-pure orchestrator: `indexPlanSheets(sheets, projectId)` and `askPlans(projectId, question)`. Wires plan-extract → project-memory-embed and project-memory-search → mageAI.
- **Create** `components/plans/AskPlansPanel.tsx` — the ask box + answer/citation UI with jump-to-sheet.
- **Modify** `app/plan-intelligence.tsx` (or `app/plan-viewer.tsx`) — mount `AskPlansPanel`.

---

### Task 1: Pure `planChunk` + validator (TDD)

**Files:** Create `utils/plans/planChunk.ts`; Create `scripts/validate-plan-chunk.ts`.

- [ ] **Step 1 — write the failing validator** `scripts/validate-plan-chunk.ts`:

```ts
// scripts/validate-plan-chunk.ts — pure-fn validator for planChunk.
import { sheetToDocs, sheetIdFromDocId, type ExtractedSheet } from '../utils/plans/planChunk';

let pass = 0, fail = 0;
function ok(n: string, c: boolean) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

const sheet: ExtractedSheet = { sheetId: 'abc', sheetNumber: 'S-201', text: 'Beam on grid 4 is W12x26. Panel schedule note 3.' };
const docs = sheetToDocs(sheet);
ok('one doc for a short sheet', docs.length === 1);
ok('source is Plan Sheet', docs[0].source === 'Plan Sheet');
ok('ref is the sheet number', docs[0].ref === 'S-201');
ok('doc_id encodes the sheet id', docs[0].doc_id === 'plan-sheet:abc');
ok('content carries the text', docs[0].content.includes('W12x26'));

const big: ExtractedSheet = { sheetId: 'x', sheetNumber: 'A-1', text: 'z'.repeat(9000) };
const bigDocs = sheetToDocs(big);
ok('splits >8000 chars into multiple chunks', bigDocs.length >= 2);
ok('chunk doc_ids are unique + suffixed', bigDocs[0].doc_id === 'plan-sheet:x#0' && bigDocs[1].doc_id === 'plan-sheet:x#1');
ok('every chunk ≤ 8000 chars', bigDocs.every(d => d.content.length <= 8000));

ok('sheetIdFromDocId parses single', sheetIdFromDocId('plan-sheet:abc') === 'abc');
ok('sheetIdFromDocId parses chunked', sheetIdFromDocId('plan-sheet:x#1') === 'x');
ok('sheetIdFromDocId ignores non-plan docs', sheetIdFromDocId('RFI#12') === null);
ok('empty text → no docs', sheetToDocs({ sheetId: 'e', sheetNumber: 'E', text: '   ' }).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
```

- [ ] **Step 2 — run it, expect FAIL** (`Cannot find module '../utils/plans/planChunk'`): `bun run scripts/validate-plan-chunk.ts`

- [ ] **Step 3 — implement** `utils/plans/planChunk.ts`:

```ts
// utils/plans/planChunk.ts — pure. Turn an extracted plan sheet into embed-ready
// project-memory docs (source 'Plan Sheet'), keyed so the sheet id round-trips
// back out of the doc_id for jump-to-sheet. React/RN-free (validator drives it).
export interface ExtractedSheet { sheetId: string; sheetNumber: string; text: string; }
export interface MemoryDoc { doc_id: string; source: string; ref: string; content: string; }

const MAX = 8000; // memory_embeddings.content cap
export const PLAN_SOURCE = 'Plan Sheet';

export function sheetToDocs(sheet: ExtractedSheet): MemoryDoc[] {
  const text = (sheet.text || '').trim();
  if (!text) return [];
  const ref = sheet.sheetNumber || 'Sheet';
  if (text.length <= MAX) {
    return [{ doc_id: `plan-sheet:${sheet.sheetId}`, source: PLAN_SOURCE, ref, content: text }];
  }
  const docs: MemoryDoc[] = [];
  for (let i = 0, n = 0; i < text.length; i += MAX, n += 1) {
    docs.push({ doc_id: `plan-sheet:${sheet.sheetId}#${n}`, source: PLAN_SOURCE, ref, content: text.slice(i, i + MAX) });
  }
  return docs;
}

/** Recover the plan sheet id from a doc_id ('plan-sheet:<id>' or 'plan-sheet:<id>#<n>'). */
export function sheetIdFromDocId(docId: string): string | null {
  if (!docId.startsWith('plan-sheet:')) return null;
  return docId.slice('plan-sheet:'.length).split('#')[0];
}
```

- [ ] **Step 4 — run it, expect `12 passed, 0 failed`**: `bun run scripts/validate-plan-chunk.ts`
- [ ] **Step 5 — commit**: `git add utils/plans/planChunk.ts scripts/validate-plan-chunk.ts && git commit -m "plans: pure planChunk (sheet→memory docs) + validator" ` (trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`)

---

### Task 2: Pure `planAnswer` + validator (TDD)

**Files:** Create `utils/plans/planAnswer.ts`; Create `scripts/validate-plan-answer.ts`.

- [ ] **Step 1 — write the failing validator** `scripts/validate-plan-answer.ts`:

```ts
// scripts/validate-plan-answer.ts — pure-fn validator for planAnswer.
import { buildAskPrompt, citedSheetRefs, type PlanMatch } from '../utils/plans/planAnswer';

let pass = 0, fail = 0;
function ok(n: string, c: boolean) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

const matches: PlanMatch[] = [
  { doc_id: 'plan-sheet:s2', source: 'Plan Sheet', ref: 'S-201', content: 'Beam on grid 4: W12x26.', similarity: 0.82 },
  { doc_id: 'plan-sheet:e3', source: 'Plan Sheet', ref: 'E-301', content: 'Panel: 200A, 42 circuits.', similarity: 0.44 },
];
const p = buildAskPrompt('what beam is on grid 4?', matches);
ok('prompt carries the question', p.includes('what beam is on grid 4?'));
ok('prompt includes sheet refs as sources', p.includes('S-201') && p.includes('E-301'));
ok('prompt includes the content', p.includes('W12x26'));
ok('prompt forbids hallucination', /only.*sheets|do not|prefer.*not found|if.*not.*say/i.test(p));
ok('prompt asks for a citation', /cite|sheet/i.test(p));

ok('no matches → prompt still safe (say not found)', /not found|couldn.t find|no/i.test(buildAskPrompt('x', [])));

ok('citedSheetRefs extracts refs mentioned in an answer', JSON.stringify(citedSheetRefs('It is on Sheet S-201.', matches)) === JSON.stringify([{ ref: 'S-201', sheetId: 's2' }]));
ok('citedSheetRefs empty when none named', citedSheetRefs('Not found.', matches).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
```

- [ ] **Step 2 — run, expect FAIL**: `bun run scripts/validate-plan-answer.ts`
- [ ] **Step 3 — implement** `utils/plans/planAnswer.ts`:

```ts
// utils/plans/planAnswer.ts — pure. Build the grounded ask-prompt from retrieved
// plan chunks, and pull the cited sheet(s) back out of an answer (with the sheetId
// for jump-to-sheet). Grounding rule: answer ONLY from the given sheets; if not
// present, say so — never invent. React/RN-free.
import { sheetIdFromDocId } from './planChunk';
export interface PlanMatch { doc_id: string; source: string; ref: string; content: string; similarity: number; }

export function buildAskPrompt(question: string, matches: PlanMatch[]): string {
  const src = matches.length
    ? matches.map((m, i) => `[${i + 1}] Sheet ${m.ref}:\n${m.content}`).join('\n\n')
    : '(no matching plan sheets found)';
  return [
    'You answer questions about a construction plan set, using ONLY the plan sheets below.',
    'Rules: answer in one or two plain sentences. Cite the sheet you used by its number',
    '(e.g. "Sheet S-201"). If the answer is NOT in these sheets, say you couldn’t find it',
    'in the indexed plans and suggest rephrasing — do NOT invent an answer.',
    '',
    'PLAN SHEETS:', src,
    '',
    'QUESTION: ' + question,
    'ANSWER:',
  ].join('\n');
}

/** Which of the retrieved sheets the answer actually names → [{ref, sheetId}]. */
export function citedSheetRefs(answer: string, matches: PlanMatch[]): { ref: string; sheetId: string }[] {
  const out: { ref: string; sheetId: string }[] = [];
  const seen = new Set<string>();
  for (const m of matches) {
    const sid = sheetIdFromDocId(m.doc_id);
    if (sid && !seen.has(m.ref) && answer.includes(m.ref)) { seen.add(m.ref); out.push({ ref: m.ref, sheetId: sid }); }
  }
  return out;
}
```

- [ ] **Step 4 — run, expect `8 passed, 0 failed`**: `bun run scripts/validate-plan-answer.ts`
- [ ] **Step 5 — commit**: `git add utils/plans/planAnswer.ts scripts/validate-plan-answer.ts && git commit -m "plans: pure planAnswer (grounded ask-prompt + citation extraction) + validator"` (+ trailer)

---

### Task 3: Wire both validators into ship-check

**Files:** Modify `package.json`.

- [ ] **Step 1** — add scripts near the other `test:*`:
```json
"test:plan-chunk": "bun run scripts/validate-plan-chunk.ts",
"test:plan-answer": "bun run scripts/validate-plan-answer.ts",
```
- [ ] **Step 2** — append ` && bun run test:plan-chunk && bun run test:plan-answer` to the `ship-check` chain (after the last existing validator).
- [ ] **Step 3** — `bun run test:plan-chunk && bun run test:plan-answer` → both pass.
- [ ] **Step 4 — commit**: `git add package.json && git commit -m "chore: wire plan-chunk + plan-answer validators into ship-check"` (+ trailer)

---

### Task 4: `plan-extract` vision edge function

**Files:** Create `supabase/functions/plan-extract/index.ts`.

- [ ] **Step 1 — read the reuse pattern**: `sed -n '1,119p' supabase/functions/analyze-plan-code/index.ts` (CORS, `requireTier`, the `gemini-2.5-flash` vision call shape, strict-JSON parse, metering) and `supabase/functions/_shared/auth.ts` (`requireTier`, metering helpers).

- [ ] **Step 2 — implement** `supabase/functions/plan-extract/index.ts`, mirroring `analyze-plan-code`'s structure but with a **general extraction** prompt (not code findings). Request: `{ imageBase64: string, mimeType: string, sheetNumber?: string }`. Gate `requireTier(req, ['business','enterprise'], 'plan_extract')`. Prompt the model to return strict JSON `{ text: string }` where `text` is a dense, search-friendly transcription of everything legible on the sheet — the title/number, general description of what the sheet shows, and every callout, note, dimension, schedule row, and label it can read (so a later keyword/semantic search can find them). Cap output tokens sensibly. Meter one unit per successful call (reuse the same metering helper `analyze-plan-code` uses, with a `plan_extract` key). Return `{ success: true, text }` or `{ success: false, error }`. Match the file's existing error handling + CORS exactly.

- [ ] **Step 3 — deno type-check** (best-effort): `deno check supabase/functions/plan-extract/index.ts` if deno is available; otherwise confirm it mirrors `analyze-plan-code` structurally (imports from `_shared/*`, same handler shape).

- [ ] **Step 4 — commit** (do NOT deploy — owner-gated): `git add supabase/functions/plan-extract/index.ts && git commit -m "plans: plan-extract vision edge fn (sheet image -> searchable text), Business+"` (+ trailer). Note in the commit body that deploy is owner-gated (`supabase functions deploy plan-extract`).

---

### Task 5: `askYourPlans` orchestrator (client)

**Files:** Create `utils/plans/askYourPlans.ts`.

- [ ] **Step 1 — read** how the app calls edge fns with the user session (grep an existing caller, e.g. how `convert-pdf-to-images` / `project-memory-*` are invoked from the app — look for `supabase.functions.invoke` or a fetch helper + how the image is fetched to base64, e.g. `expo-file-system`/`FileSystem.readAsStringAsync`).

- [ ] **Step 2 — implement** `utils/plans/askYourPlans.ts` with two functions, reusing the verified interfaces:

```ts
// utils/plans/askYourPlans.ts — orchestrates "ask your plans": index a project's
// plan sheets into project-memory (via plan-extract vision -> project-memory-embed),
// and answer a question (project-memory-search -> mageAI grounded answer). Cloud is
// the source of truth (per project); this only wires cloud calls.
import { supabase } from '@/lib/supabase';
import { mageAI } from '@/utils/mageAI';
import { sheetToDocs, PLAN_SOURCE, type ExtractedSheet } from './planChunk';
import { buildAskPrompt, citedSheetRefs, type PlanMatch } from './planAnswer';
import type { PlanSheet } from '@/types';

async function imageToBase64(uri: string): Promise<{ b64: string; mime: string }> {
  // Reuse the app's existing image->base64 pattern found in Step 1 (FileSystem for
  // file://, fetch+blob for https). Return base64 (no data: prefix) + mime.
  /* implement per Step 1 findings */ return { b64: '', mime: 'image/png' };
}

/** Index (or re-index) a project's plan sheets. Extract text per sheet (vision),
 *  then embed as project-memory docs (source 'Plan Sheet'). Returns count embedded. */
export async function indexPlanSheets(projectId: string, sheets: PlanSheet[]): Promise<number> {
  const extracted: ExtractedSheet[] = [];
  for (const s of sheets) {
    const { b64, mime } = await imageToBase64(s.imageUri);
    if (!b64) continue;
    const { data, error } = await supabase.functions.invoke('plan-extract', { body: { imageBase64: b64, mimeType: mime, sheetNumber: s.sheetNumber } });
    if (error || !data?.success || !data.text) continue;
    extracted.push({ sheetId: s.id, sheetNumber: s.sheetNumber || s.name || 'Sheet', text: data.text });
  }
  const docs = extracted.flatMap(sheetToDocs);
  if (!docs.length) return 0;
  const { data } = await supabase.functions.invoke('project-memory-embed', { body: { projectId, docs } });
  return data?.embedded ?? 0;
}

export interface PlanAnswer { answer: string; citations: { ref: string; sheetId: string }[]; noneFound: boolean; }

/** Answer a question about the project's plans. */
export async function askPlans(projectId: string, question: string): Promise<PlanAnswer> {
  const { data: sr } = await supabase.functions.invoke('project-memory-search', { body: { projectId, query: question, matchCount: 8 } });
  const matches: PlanMatch[] = (sr?.matches ?? []).filter((m: PlanMatch) => m.source === PLAN_SOURCE);
  const res = await mageAI({ prompt: buildAskPrompt(question, matches), tier: 'smart', maxTokens: 400, feature: 'planAsk' });
  const answer = (res.success ? (res.data?.text ?? res.raw ?? '') : '').toString().trim()
    || 'I couldn’t reach the plan brain just now — try again.';
  const citations = citedSheetRefs(answer, matches);
  return { answer, citations, noneFound: matches.length === 0 };
}
```

Replace the `imageToBase64` body with the real pattern from Step 1. If `mageAI` returns text under a different field than `data.text`/`raw`, match what Step 1 of Task-5 review shows `mageAI` returns for a plain-text (non-schema) call.

- [ ] **Step 3 — type-check**: `npx tsc --noEmit` → clean.
- [ ] **Step 4 — commit**: `git add utils/plans/askYourPlans.ts && git commit -m "plans: askYourPlans orchestrator (index sheets + answer questions)"` (+ trailer)

---

### Task 6: `AskPlansPanel` UI + mount on the plan view

**Files:** Create `components/plans/AskPlansPanel.tsx`; Modify `app/plan-intelligence.tsx` (mount it).

- [ ] **Step 1 — read** `app/plan-intelligence.tsx` (and `app/plan-viewer.tsx` for the jump signature) to find where to mount the panel and confirm `router.push({ pathname: '/plan-viewer', params: { sheetId } })`.

- [ ] **Step 2 — implement** `components/plans/AskPlansPanel.tsx`: a text input ("Ask your plans…") + a submit, calling `askPlans(projectId, q)`; while awaiting, show a reassuring state ("Reading your plans…"); render the answer text; render each citation as a tappable chip (`Sheet {ref}`) that calls `router.push({ pathname: '/plan-viewer', params: { sheetId } })`. If `noneFound`, show the actionable "couldn't find it in the indexed plans — try rephrasing" message. Include a subtle "Index / re-index plans" action that calls `indexPlanSheets(projectId, sheets)` (first-run + after new uploads), with a progress state. Style with `Colors`/`Type`/`Tokens` only — NO raw hex / inline fontSize / borderRadius. Gate the panel behind the Business tier (reuse the app's tier hook, e.g. `useTierAccess`/`canAccess`) with a short upsell if locked.

- [ ] **Step 3 — mount** `<AskPlansPanel projectId={project.id} sheets={sheets} />` in `app/plan-intelligence.tsx` at a sensible spot (top of the plan-intelligence content). Pass the project's plan sheets from wherever the screen already has them.

- [ ] **Step 4 — gates**: `npx tsc --noEmit` clean; `bun run lint` 0 errors; `bun run ship-check` green (EXIT 0).
- [ ] **Step 5 — commit**: `git add components/plans/AskPlansPanel.tsx app/plan-intelligence.tsx && git commit -m "plans: Ask-your-plans panel (ask box + cited answer + jump-to-sheet)"` (+ trailer)

---

### Task 7: Full verification

**Files:** none.

- [ ] **Step 1** — `bun run ship-check` → green, including `test:plan-chunk` + `test:plan-answer`.
- [ ] **Step 2** — Note the owner-gated / sim-verified items that can't be auto-checked here: deploy `plan-extract` (`supabase functions deploy plan-extract`), then on the sim/web index a real plan and ask a question end-to-end (extract → embed → search → cited answer → jump-to-sheet). Record that these are owner-side.
- [ ] **Step 3** — Do NOT merge or deploy (owner-gated).

---

## Self-Review
- **Spec coverage:** cloud-source-of-truth via project-scoped memory docs (Tasks 1/5) ✓; ingest = vision extract → embed (Tasks 4/5) ✓; ask = search → grounded cited answer → jump-to-sheet (Tasks 2/5/6) ✓; cost guardrails — Business-tier gate on `plan-extract` (Task 4) + on the panel (Task 6), index-once/on-demand via the explicit "Index plans" action (Task 6), reuse of existing embed/search (no new vector infra) ✓; grounding "prefer not-found over hallucination" (Task 2) ✓; MVP = sheet-level, region-highlight deferred to v2 ✓.
- **Placeholder note:** two spots are intentionally implementer-resolved against real code and flagged as such — `imageToBase64` (reuse the app's existing image→base64 pattern, Task 5 Step 1) and the exact `mageAI` plain-text return field (Task 5). Everything else is complete code.
- **Type consistency:** `MemoryDoc`/`ExtractedSheet`/`PlanMatch`/`sheetIdFromDocId`/`PLAN_SOURCE` are defined in Tasks 1–2 and used consistently in Task 5; edge-fn request shape `{ imageBase64, mimeType, sheetNumber }` matches between Tasks 4 and 5; `project-memory-embed`/`search` request/response shapes match the grounded interfaces.
