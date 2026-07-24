# Home Passport + Ask Your Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At closeout, turn the contractor's project data into the homeowner's living house record: (1) a **Home Passport** generated at binder-finalize — finishes/warranties/trades/maintenance/photo docs indexed into `memory_embeddings` plus a pre-answered FAQ baked into the portal snapshot; (2) **Ask Your Home** — a token-authenticated question box in the client portal returning grounded, cited answers via a new `portal-ask-home` edge function (code only; deploy is owner-gated).

**Architecture:** Pure assembly engine (`utils/passport/buildHomePassport.ts`, validator-tested) → contractor-side generation hook in `app/closeout-binder.tsx` (index via existing `project-memory-embed` with contractor JWT + source `'Home Passport'`; pre-answer FAQ via the existing `answerFromMemory` + `mageAI` flow; persist baked result in AsyncStorage `mageid_home_passport`) → portal snapshot v9 carries `closeout.faq` + `closeout.passport` → static portal renders passport card + FAQ + ask box → `portal-ask-home` edge fn validates the 192-bit portal access token constant-time, rate-limits via `rate_limit_counters`, retrieves via `geminiEmbed` + `match_project_memory` (owner `user_id`, service role), answers with a strict prefer-not-found grounding prompt. No new tables, no migrations, no anon table reads. Failure anywhere is non-blocking: binder finalize/deliver is untouched.

**Tech Stack:** React Native / Expo (TS strict, bun), Supabase edge functions (Deno), pgvector `memory_embeddings` + `match_project_memory` RPC (live in prod), Gemini `text-embedding-004` + `gemini-2.5-flash`, static portal HTML (`marketing/portal/index.html`, ES5-style vanilla JS), validators run by bun and chained into `ship-check`.

---

## Grounded reality (verified in code 2026-07-23 — the plan's code compiles against THESE shapes)

**`utils/closeoutBinderEngine.ts`:**
```ts
export interface MaintenanceItem {
  id: string;
  task: string;            // "HVAC service"
  frequency: string;       // "Annual"
  nextDate?: string;       // ISO date for first reminder
  notes?: string;
}
export interface CloseoutBinder {
  id: string; projectId: string; userId: string;
  pdfUrl?: string; html?: string;
  maintenanceSchedule: MaintenanceItem[];
  notes: string;
  status: 'draft' | 'finalized' | 'sent';
  finalizedAt?: string; sentAt?: string; createdAt: string; updatedAt: string;
}
```
Finishes come from chosen selections (`(c.options ?? []).find(o => o.isChosen)`), trade contacts from non-draft commitments (`c.vendorName`, `c.description ?? c.type`, `c.phase`), warranties filtered by `w.projectId === project.id`.

**`utils/portalSnapshot.ts`:** `export const PORTAL_SNAPSHOT_VERSION = 8;`. The `closeout` section (only emitted when binder status ∈ {finalized, sent}):
```ts
closeout?: {
  id: string; status: 'finalized' | 'sent'; completionDate?: string;
  noteFromContractor?: string;
  finishes: { category: string; productName: string; brand?: string; sku?: string; supplier?: string }[];
  warranties: { title: string; provider?: string; durationMonths?: number; endDate?: string }[];
  maintenance: { task: string; frequency: string; nextDate?: string; notes?: string }[];
  tradeContacts: { company: string; scope?: string; phase?: string; phone?: string; email?: string }[];
  emergencyEmail?: string; emergencyPhone?: string;
};
```
Photos carry URLs as `sections.photos[] = { url, caption, timestamp, markup? }` (caption = `photo.tag ?? photo.location`). `isShared(s?: PortalState)` = `s == null || s.status === 'sent'`. Snapshot builders: `app/client-portal-setup.tsx:242` (rich, pushes to `portal_snapshots` upsert on `portal_id`) and `app/project-detail.tsx:323` (lite background sync).

**`types/index.ts`:** `SelectionOption` (`productName`, `brand`, `sku`, `description`, `unitPrice`, `unit`, `supplier?`, `highlights: string[]`, `isChosen`, `chosenAt?`, `createdAt`), `SelectionCategory` (`id`, `projectId`, `userId`, `category`, `styleBrief`, `budget`, `status: 'pending'|'browsing'|'chosen'|'exceeded'`, `notes`, `displayOrder`, `createdAt`, `updatedAt`, `options?`, `portalState?`), `Commitment` (`id`, `projectId`, `number`, `type: 'subcontract'|'purchase_order'`, `subcontractorId?`, `vendorName?`, `description`, `amount`, `signedDate`, `phase?`, `csiDivision?`, `status: 'draft'|'active'|'closed'`, `createdAt`, `updatedAt`), `Subcontractor` (`companyName`, `contactName`, `phone`, `email`, `trade: SubTrade` where `SubTrade = 'General'|'Framing'|'Electrical'|'Plumbing'|'HVAC'|'Roofing'|'Concrete'|'Drywall'|'Painting'|'Flooring'|'Landscaping'|'Other'`), `ProjectPhoto` (`id`, `projectId`, `uri`, `timestamp`, `location?`, `tag?`, `linkedTaskId?`, `linkedTaskName?`, `locationLabel?`, `createdAt`, `portalState?`), `Warranty` (`id`, `projectId`, `projectName`, `title`, `category: WarrantyCategory`, `description?`, `provider`, `startDate`, `durationMonths`, `endDate`, `coverageDetails?`, `exclusions?`, `status`, `claims`, `createdAt`, `updatedAt`, `portalState?`), `ClientPortalSettings` (`enabled`, `portalId`, `accessToken?` — the server-managed 192-bit decision token that travels only in the share link's `?t=` param).

**`utils/projectMemory.ts`:**
```ts
export type MemorySource = 'RFI' | 'Daily Report' | 'Change Order' | 'Submittal' | 'Punch Item';
export interface MemoryDoc { id: string; source: MemorySource; ref: string; date: string; text: string }
export async function syncMemoryEmbeddings(projectId: string, docs: MemoryDoc[]): Promise<void>
  // POSTs { projectId, docs: docs.slice(0,250).map(d => ({ doc_id: d.id, source: d.source, ref: d.ref, content: d.text })) }
  // to /functions/v1/project-memory-embed with the contractor's JWT. Fire-and-forget, never throws.
export async function answerFromMemory(question: string, docs: MemoryDoc[]): Promise<MemoryAnswer>
  // TF-IDF retrieve over the PASSED docs only → mageAI({ tier: 'smart', maxTokens: 700 }) cited answer. Never throws.
export async function answerFromMemorySemantic(question: string, projectId: string, docs: MemoryDoc[]): Promise<MemoryAnswer>
  // semantic path searches the WHOLE project index (all sources) — see Task 3 note on why FAQ uses answerFromMemory instead.
interface MemoryAnswer { answer: string; usedRefs: string[]; searched: number; matched: boolean; semantic?: boolean; errorKind?: string; fromCache?: boolean }
```

**`supabase/functions/project-memory-embed/index.ts`** request body: `{ projectId: string, docs: { doc_id: string; source: string; ref: string; content: string }[] }` (max 250 docs; `source` stored `.slice(0, 40)`, `content` `.slice(0, 8000)`); auth `requireTier(req, ["pro","business","enterprise"], "project_memory")`; upserts `memory_embeddings` on `(user_id, doc_id)` — re-generation with stable doc_ids is idempotent.

**`supabase/functions/project-memory-search/index.ts`** calls RPC `match_project_memory` with `{ p_user_id, p_project_id, p_query: toVectorLiteral(vec), p_match_count }`; rows come back as `{ doc_id, source, ref, content, similarity }`.

**`supabase/functions/validate-portal-passcode/index.ts`** (template for `portal-ask-home`): service-role REST lookup `projects?select=client_portal&client_portal->>portalId=eq.<id>&limit=1`, `constantTimeEqual(a, b)` char-XOR compare, `rateLimitCount(scope)` from `_shared/auth.ts` (returns post-increment count for the current hour, `-1` when limiter unavailable → caller chooses fail-open), 250ms delay + identical 401 on any miss.

**`rate_limit_increment(p_scope text)`** (verified in prod via `pg_get_functiondef`): SECURITY DEFINER; `INSERT INTO rate_limit_counters (scope, bucket_start, count) VALUES (p_scope, date_trunc('hour', NOW()), 1) ON CONFLICT (scope, bucket_start) DO UPDATE SET count = count + 1 RETURNING count`. So buckets are **hourly per scope**; a daily cap = increment, then SUM today's buckets from `rate_limit_counters` (columns `scope`, `bucket_start`, `count`) with the service role.

**`supabase/functions/_shared/embeddings.ts`:** `export async function geminiEmbed(texts: string[]): Promise<number[][]>` (text-embedding-004, 768 dims, throws on error), `export function toVectorLiteral(vec: number[]): string`.

**Gemini text generation** (pattern from `supabase/functions/ai/index.ts`): `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=<GEMINI_API_KEY>` with `{ contents: [{ role: "user", parts: [{ text }] }], generationConfig: { maxOutputTokens, temperature } }`; answer at `data.candidates?.[0]?.content?.parts?.[0]?.text`.

**`marketing/portal/index.html`** (5614 lines): snapshot read via token-gated RPC `portal_get_snapshot` (`fetchSnapshotFromServer`, ~line 5553); edge-fn call pattern = `portal-mark-viewed` (~line 5285): plain `fetch(<supabase>/functions/v1/<fn>, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ portalId, accessToken, ... }) })` with token from `getPortalToken()` (~4140, reads `?t=`); i18n via `t(key)` over `data.uiStrings` falling back to `FALLBACK_STRINGS` (~2432); sections built with `addSection(id, iconKey, title, subtitle, count, body)` → `mkSection` renders `<section class="section" id="sec-<id>">`; closeout renders via `renderCloseout(c)` (return block ~3516) inside `addSection('closeout', ...)` (~4871); binder print path shows only `#sec-closeout` (`body.printing-binder` CSS ~1335-1343). Data is stashed at `window.__portalData`.

**Validator harness** (`scripts/validate-schedule-colors.ts` pattern): plain bun script, `let pass = 0, fail = 0`, `expect(name, got, want)` via `JSON.stringify` compare, final `console.log(\`\n${pass} passed, ${fail} failed\`); if (fail > 0) process.exit(1);`. Wired as `"test:<name>": "bun run scripts/validate-<name>.ts"` in `package.json` and appended to the `ship-check` `&&` chain.

**Tier gate:** `hooks/useTierAccess.ts` → `canAccess('client_portal')` (requires `pro`; higher tiers satisfy automatically).

**Cache keys:** any new per-user `mageid_*` AsyncStorage key MUST be added to `LOCAL_USER_CACHE_KEYS` in `contexts/AuthContext.tsx` (list ends `'mageid_sub_portal_links',`).

### Deliberate deviations from the spec (justified)

1. **`PassportDoc` gains a `date: string` field** (superset of the spec interface). `MemoryDoc` requires a `date` for recency fallback + display; deriving it per-entity (warranty end date, photo timestamp, commitment signed date) beats stamping everything with `generatedAt`.
2. **`utils/projectMemory.ts` gets a 1-line additive change** (spec listed it "reference, unchanged"): `MemorySource` union gains `'Home Passport'`. Required to reuse `syncMemoryEmbeddings`/`answerFromMemory` with typed docs instead of duplicating the embed client.
3. **One extra created file: `utils/passport/passportStore.ts`.** The baked FAQ must survive until the NEXT snapshot build (which happens in `client-portal-setup.tsx` / `project-detail.tsx`, not in the closeout screen), so it needs persistent storage. AsyncStorage cannot be imported by the pure engine (the validator runs under bun), hence a separate tiny store module.
4. **FAQ pre-answering uses `answerFromMemory` (TF-IDF over passport docs only), not `answerFromMemorySemantic`.** The semantic path retrieves from the whole project index — change orders / submittals / punch items could leak pricing or dispute context into a homeowner-facing FAQ. Restricting the FAQ context to the passport's own docs is the safe interpretation of "existing memory search + mageAI flow". (`portal-ask-home` DOES search the index, but filtered server-side to `Home Passport` / `Daily Report` / `RFI` per the spec.)
5. **Portal FAQ/ask strings ship as English `FALLBACK_STRINGS` only.** `t()` already falls back per-key, so non-English portals render these new strings in English rather than blocking on 6-language translation. Translation keys in `utils/portalLanguages.ts` are a follow-up.
6. **Cited photo refs render as chips + best-effort thumbnail.** Snapshot photos carry no IDs (`{url, caption, timestamp}`), so the portal matches a `photo`-kind ref against snapshot captions to attach a thumbnail; when no caption matches, the chip alone renders. Exact ID plumbing is a v2 item.

---

## Task 1 — Pure assembly engine (`utils/passport/`) — TDD

### 1.1 Types

- [ ] Create `utils/passport/types.ts`:

```ts
// Home Passport — shared types.
//
// The passport is assembled ENTIRELY on the contractor's device (where
// selections/warranties/commitments/photos live) by the pure engine in
// buildHomePassport.ts, then:
//   - docs are indexed into memory_embeddings (project-memory-embed,
//     source 'Home Passport') so portal-ask-home can retrieve them;
//   - faqInputs are pre-answered via the existing project-memory AI flow
//     and baked into the portal snapshot's closeout section (v9);
//   - summary drives the passport header card in the portal.

export type PassportDocKind = 'finish' | 'warranty' | 'trade' | 'maintenance' | 'photo';

export interface PassportDoc {
  /** 'passport:<kind>:<entityId>' — STABLE across re-generations so the
   *  embed upsert on (user_id, doc_id) re-indexes idempotently. */
  docId: string;
  /** Human citation label, e.g. "Warranty — Trane HVAC". */
  ref: string;
  /** Dense searchable text, ≤ 4000 chars (clamped by the builder). */
  text: string;
  kind: PassportDocKind;
  /** ISO date for recency fallback + display (MemoryDoc.date). */
  date: string;
}

export interface FaqInput {
  id: string;
  question: string;
  /** Included only when ≥1 doc of ANY of these kinds exists. */
  requires: PassportDocKind[];
}

export interface PassportSummary {
  finishes: number;
  warranties: number;
  trades: number;
  maintenanceItems: number;
  photos: number;
  docCount: number;
  generatedAt: string;
}

export interface HomePassport {
  docs: PassportDoc[];
  faqInputs: FaqInput[];
  summary: PassportSummary;
}

export interface BakedFaqEntry {
  q: string;
  a: string;
  refs: string[];
}

/** What generation persists + what the portal snapshot bakes in. */
export interface BakedHomePassport {
  faq: BakedFaqEntry[];
  summary: PassportSummary;
  generatedAt: string;
}
```

### 1.2 Failing validator (RED)

- [ ] Create `scripts/validate-home-passport.ts`:

```ts
// validate-home-passport.ts — unit tests for the Home Passport engine.
// Run via: bun run scripts/validate-home-passport.ts
//
// Mirrors validate-schedule-colors.ts: bun executes TS natively; the module
// under test is pure (type-only imports of domain types, no RN dependencies).

import { buildHomePassport, MAX_DOC_CHARS, MAX_FAQ_INPUTS, type BuildHomePassportInput } from '../utils/passport/buildHomePassport';
import type {
  SelectionCategory, SelectionOption, Warranty, Commitment, Subcontractor, ProjectPhoto,
} from '../types';
import type { MaintenanceItem } from '../utils/closeoutBinderEngine';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else    { fail++; console.log('  ✗', name, '\n      got:  ', JSON.stringify(got), '\n      want: ', JSON.stringify(want)); }
}
function expectTrue(name: string, got: boolean) { expect(name, got, true); }

// ── Fixtures ────────────────────────────────────────────────────────

const PROJECT = { id: 'proj-1', name: 'Henderson Remodel', location: '12 Oak St' };
const GENERATED_AT = '2026-07-23T12:00:00.000Z';

function mkOption(over: Partial<SelectionOption>): SelectionOption {
  return {
    id: 'opt-1', categoryId: 'cat-1', source: 'gc_added',
    productName: 'Duration Home Interior', brand: 'Sherwin-Williams', sku: 'SW-7008',
    description: 'Matte, scrubbable', unitPrice: 62, unit: 'gal', quantity: 5, total: 310,
    supplier: 'SW Store #204', highlights: ['One-coat coverage'], isChosen: true,
    createdAt: '2026-03-01T00:00:00.000Z',
    ...over,
  };
}
function mkSelection(over: Partial<SelectionCategory>): SelectionCategory {
  return {
    id: 'cat-1', projectId: 'proj-1', userId: 'u1', category: 'Kitchen Paint',
    styleBrief: 'warm neutral', budget: 400, status: 'chosen', notes: '', displayOrder: 0,
    createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-03-02T00:00:00.000Z',
    options: [mkOption({})],
    ...over,
  };
}
function mkWarranty(over: Partial<Warranty>): Warranty {
  return {
    id: 'war-1', projectId: 'proj-1', projectName: 'Henderson Remodel',
    title: 'Trane HVAC', category: 'hvac', provider: 'Trane',
    startDate: '2026-05-01', durationMonths: 120, endDate: '2036-05-01',
    coverageDetails: 'Compressor and parts', exclusions: 'Filters',
    status: 'active', claims: [],
    createdAt: '2026-05-01T00:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z',
    ...over,
  };
}
function mkCommitment(over: Partial<Commitment>): Commitment {
  return {
    id: 'com-1', projectId: 'proj-1', number: 'SC-001', type: 'subcontract',
    subcontractorId: 'sub-1', description: 'Full electrical rough-in and trim',
    amount: 18000, signedDate: '2026-02-10', phase: 'Rough-in', csiDivision: '26',
    status: 'active',
    createdAt: '2026-02-10T00:00:00.000Z', updatedAt: '2026-02-10T00:00:00.000Z',
    ...over,
  };
}
function mkSub(over: Partial<Subcontractor>): Subcontractor {
  return {
    id: 'sub-1', companyName: 'Volt Bros Electric', contactName: 'Ray Ortiz',
    phone: '555-0100', email: 'ray@voltbros.com', address: '9 Amp Way',
    trade: 'Electrical', licenseNumber: 'E-1234', licenseExpiry: '2027-01-01',
    coiExpiry: '2027-01-01', w9OnFile: true, bidHistory: [], assignedProjects: [],
    notes: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}
function mkPhoto(over: Partial<ProjectPhoto>): ProjectPhoto {
  return {
    id: 'ph-1', projectId: 'proj-1', uri: 'https://cdn.example/ph-1.jpg',
    timestamp: '2026-03-12T15:00:00.000Z', tag: 'Kitchen west wall',
    createdAt: '2026-03-12T15:00:00.000Z',
    ...over,
  };
}
const MAINT: MaintenanceItem[] = [
  { id: 'm1', task: 'HVAC filter replacement', frequency: 'Quarterly', nextDate: '2026-10-01', notes: 'MERV 11+' },
];

function fullInput(): BuildHomePassportInput {
  return {
    project: PROJECT,
    selections: [mkSelection({})],
    warranties: [mkWarranty({})],
    commitments: [mkCommitment({})],
    subcontractors: [mkSub({})],
    photos: [mkPhoto({})],
    maintenance: MAINT,
    generatedAt: GENERATED_AT,
  };
}

console.log('\nbuildHomePassport validation:');

// ── Empty-input totality ──
const empty = buildHomePassport({
  project: PROJECT, selections: [], warranties: [], commitments: [],
  subcontractors: [], photos: [], maintenance: [], generatedAt: GENERATED_AT,
});
expect('empty input → no docs', empty.docs.length, 0);
expect('empty input → no FAQ inputs', empty.faqInputs.length, 0);
expect('empty input → zero summary counts',
  [empty.summary.finishes, empty.summary.warranties, empty.summary.trades,
   empty.summary.maintenanceItems, empty.summary.photos, empty.summary.docCount],
  [0, 0, 0, 0, 0, 0]);
expect('empty input → generatedAt passthrough', empty.summary.generatedAt, GENERATED_AT);

// ── Full assembly: one doc per kind ──
const full = buildHomePassport(fullInput());
const byKind = (k: string) => full.docs.filter(d => d.kind === k);
expect('full input → 5 docs (one per kind)', full.docs.length, 5);
expect('one doc of each kind',
  ['finish', 'warranty', 'trade', 'maintenance', 'photo'].map(k => byKind(k).length),
  [1, 1, 1, 1, 1]);

// ── Finish doc ──
const finish = byKind('finish')[0];
expect('finish docId from category id', finish.docId, 'passport:finish:cat-1');
expect('finish ref names the category', finish.ref, 'Finish — Kitchen Paint');
expectTrue('finish text carries brand', finish.text.includes('Sherwin-Williams'));
expectTrue('finish text carries SKU', finish.text.includes('SW-7008'));
expectTrue('finish text carries supplier', finish.text.includes('SW Store #204'));
const noChoice = buildHomePassport({
  ...fullInput(),
  selections: [mkSelection({ options: [mkOption({ isChosen: false })] })],
});
expect('unchosen selection → no finish doc', noChoice.docs.filter(d => d.kind === 'finish').length, 0);

// ── Warranty doc ──
const warr = byKind('warranty')[0];
expect('warranty docId from warranty id', warr.docId, 'passport:warranty:war-1');
expect('warranty ref', warr.ref, 'Warranty — Trane HVAC');
expectTrue('warranty text carries provider', warr.text.includes('Trane'));
expectTrue('warranty text carries end date', warr.text.includes('May 1, 2036'));
expectTrue('warranty text carries duration', warr.text.includes('120 months'));
expectTrue('warranty text carries coverage', warr.text.includes('Compressor and parts'));
const otherProjWarranty = buildHomePassport({
  ...fullInput(),
  warranties: [mkWarranty({ id: 'war-2', projectId: 'proj-OTHER' })],
});
expect('other-project warranty excluded', otherProjWarranty.docs.filter(d => d.kind === 'warranty').length, 0);

// ── Trade doc — commitment enriched with sub contact ──
const trade = byKind('trade')[0];
expect('trade docId from commitment id', trade.docId, 'passport:trade:com-1');
expect('trade ref names the sub company', trade.ref, 'Trade — Volt Bros Electric');
expectTrue('trade text carries the trade', trade.text.includes('Electrical'));
expectTrue('trade text carries phone', trade.text.includes('555-0100'));
expectTrue('trade text carries email', trade.text.includes('ray@voltbros.com'));
expectTrue('trade text carries scope', trade.text.includes('Full electrical rough-in'));
const noSub = buildHomePassport({
  ...fullInput(),
  commitments: [mkCommitment({ id: 'com-2', subcontractorId: undefined, vendorName: 'ACME Plumbing' })],
});
expect('vendorName fallback when no sub match',
  noSub.docs.filter(d => d.kind === 'trade')[0]?.ref, 'Trade — ACME Plumbing');
const draftOnly = buildHomePassport({
  ...fullInput(),
  commitments: [mkCommitment({ status: 'draft' })],
});
expect('draft commitment excluded', draftOnly.docs.filter(d => d.kind === 'trade').length, 0);
const otherProjCommit = buildHomePassport({
  ...fullInput(),
  commitments: [mkCommitment({ projectId: 'proj-OTHER' })],
});
expect('other-project commitment excluded', otherProjCommit.docs.filter(d => d.kind === 'trade').length, 0);

// ── Maintenance doc ──
const maint = byKind('maintenance')[0];
expect('maintenance docId from item id', maint.docId, 'passport:maintenance:m1');
expectTrue('maintenance text carries frequency', maint.text.includes('Quarterly'));
expectTrue('maintenance text carries notes', maint.text.includes('MERV 11+'));

// ── Photo doc ──
const photo = byKind('photo')[0];
expect('photo docId from photo id', photo.docId, 'passport:photo:ph-1');
expectTrue('photo ref carries caption', photo.ref.includes('Kitchen west wall'));
expectTrue('photo ref carries date', photo.ref.includes('Mar 12, 2026'));
const draftPhoto = buildHomePassport({
  ...fullInput(),
  photos: [mkPhoto({ portalState: { status: 'draft' } as unknown as ProjectPhoto['portalState'] })],
});
expect('unsent (draft) photo excluded', draftPhoto.docs.filter(d => d.kind === 'photo').length, 0);
const otherProjPhoto = buildHomePassport({
  ...fullInput(),
  photos: [mkPhoto({ projectId: 'proj-OTHER' })],
});
expect('other-project photo excluded', otherProjPhoto.docs.filter(d => d.kind === 'photo').length, 0);

// ── 4000-char clamp ──
const longText = buildHomePassport({
  ...fullInput(),
  warranties: [mkWarranty({ coverageDetails: 'x'.repeat(10000) })],
});
const clamped = longText.docs.filter(d => d.kind === 'warranty')[0];
expectTrue('doc text clamped to MAX_DOC_CHARS', clamped.text.length <= MAX_DOC_CHARS);
expect('MAX_DOC_CHARS is the spec 4000', MAX_DOC_CHARS, 4000);

// ── docId stability across re-generation ──
const runA = buildHomePassport(fullInput());
const runB = buildHomePassport(fullInput());
expect('re-generation yields identical docIds',
  runA.docs.map(d => d.docId), runB.docs.map(d => d.docId));

// ── FAQ inputs ──
expect('full input → the full FAQ catalog (capped)', full.faqInputs.length, MAX_FAQ_INPUTS);
expectTrue('every FAQ question is non-empty', full.faqInputs.every(f => f.question.trim().length > 0));
expectTrue('FAQ ids are unique', new Set(full.faqInputs.map(f => f.id)).size === full.faqInputs.length);
const maintOnly = buildHomePassport({
  project: PROJECT, selections: [], warranties: [], commitments: [],
  subcontractors: [], photos: [], maintenance: MAINT, generatedAt: GENERATED_AT,
});
expect('maintenance-only input → only maintenance FAQs',
  maintOnly.faqInputs.map(f => f.id), ['faq-maint-schedule', 'faq-maint-seasonal']);

// ── Summary counts ──
expect('summary counts match docs',
  [full.summary.finishes, full.summary.warranties, full.summary.trades,
   full.summary.maintenanceItems, full.summary.photos, full.summary.docCount],
  [1, 1, 1, 1, 1, 5]);
expect('summary.generatedAt passthrough', full.summary.generatedAt, GENERATED_AT);

// ── summary ─────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] Run it and confirm it FAILS (module under test doesn't exist yet):

```bash
bun run scripts/validate-home-passport.ts
```
Expected output: a module-resolution error naming `../utils/passport/buildHomePassport` (non-zero exit). Do NOT proceed until you see this failure.

### 1.3 Implement the engine (GREEN)

- [ ] Create `utils/passport/buildHomePassport.ts`:

```ts
// buildHomePassport — pure assembly of the Home Passport from data the
// closeout binder already compiles. No I/O, no Date.now(), no randomness:
// docIds derive from entity ids so re-generation re-indexes idempotently
// (project-memory-embed upserts on (user_id, doc_id)).
//
// Consumers:
//   1. app/closeout-binder.tsx converts docs → MemoryDoc and pushes them to
//      memory_embeddings via syncMemoryEmbeddings (source 'Home Passport');
//      portal-ask-home retrieves them for homeowner questions.
//   2. faqInputs feed answerFromMemory (over these docs ONLY — homeowner-safe)
//      to pre-answer the portal FAQ.
//   3. summary drives the passport header card (portal snapshot v9).

import type {
  SelectionCategory, Warranty, Commitment, Subcontractor, ProjectPhoto, PortalState,
} from '@/types';
import type { MaintenanceItem } from '@/utils/closeoutBinderEngine';
import type { FaqInput, HomePassport, PassportDoc, PassportDocKind } from './types';

export const MAX_DOC_CHARS = 4000;
export const MAX_FAQ_INPUTS = 10;

export interface BuildHomePassportInput {
  project: { id: string; name: string; location?: string };
  /** Selection categories with options — the chosen option becomes a finish doc. */
  selections: SelectionCategory[];
  /** All warranties — filtered to project.id internally. */
  warranties: Warranty[];
  /** All commitments — filtered to project.id + non-draft internally. */
  commitments: Commitment[];
  /** Sub roster for contact enrichment (matched via commitment.subcontractorId). */
  subcontractors: Subcontractor[];
  /** All photos — filtered to project.id + shared-to-portal internally. */
  photos: ProjectPhoto[];
  /** The binder's maintenance schedule (already project-scoped). */
  maintenance: MaintenanceItem[];
  /** ISO timestamp stamped on the summary. Injected so tests are deterministic. */
  generatedAt: string;
}

function clean(s: string | undefined | null): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

function clamp(s: string): string {
  return s.length > MAX_DOC_CHARS ? s.slice(0, MAX_DOC_CHARS) : s;
}

/** Mirror of portalSnapshot's isShared: undefined portalState is
 *  grandfathered as sent; only explicit 'sent' otherwise. */
function isShared(s?: PortalState): boolean {
  return s == null || s.status === 'sent';
}

/** Timezone-free "Mar 12, 2026" from an ISO date/timestamp prefix. */
function shortDate(iso: string | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mi = parseInt(m[2], 10) - 1;
  if (mi < 0 || mi > 11) return '';
  return `${months[mi]} ${parseInt(m[3], 10)}, ${m[1]}`;
}

// The FAQ catalog. `requires` = include the question only when at least one
// doc of ANY listed kind exists — so an empty project pre-answers nothing.
const FAQ_CATALOG: FaqInput[] = [
  { id: 'faq-finishes',       question: 'What finishes, brands, and materials were installed in my home?', requires: ['finish'] },
  { id: 'faq-paint',          question: 'What paint or finish should I buy for touch-ups?',                requires: ['finish'] },
  { id: 'faq-warranty-list',  question: 'What warranties do I have and when does each one end?',           requires: ['warranty'] },
  { id: 'faq-warranty-claim', question: 'What should I do if something breaks while under warranty?',      requires: ['warranty', 'trade'] },
  { id: 'faq-who-electrical', question: 'Who did the electrical work and how do I reach them?',            requires: ['trade'] },
  { id: 'faq-who-plumbing',   question: 'Who did the plumbing work and how do I reach them?',              requires: ['trade'] },
  { id: 'faq-who-built',      question: 'Which companies worked on my home and what did each one do?',     requires: ['trade'] },
  { id: 'faq-maint-schedule', question: 'What routine maintenance should I do, and how often?',            requires: ['maintenance'] },
  { id: 'faq-maint-seasonal', question: 'What should I check before winter and summer each year?',         requires: ['maintenance'] },
  { id: 'faq-photos',         question: 'What photos do I have of the work while it was being built?',     requires: ['photo'] },
];

export function buildHomePassport(input: BuildHomePassportInput): HomePassport {
  const { project, generatedAt } = input;
  const docs: PassportDoc[] = [];

  // ── Finishes: the chosen option in each selection category ──
  for (const cat of input.selections ?? []) {
    const chosen = (cat.options ?? []).find(o => o.isChosen);
    if (!chosen) continue;
    const parts = [
      `${clean(cat.category)} in ${clean(project.name)}: ${clean(chosen.productName)}`,
      chosen.brand && `Brand: ${clean(chosen.brand)}`,
      chosen.sku && `SKU / model: ${clean(chosen.sku)}`,
      chosen.supplier && `Supplier: ${clean(chosen.supplier)}`,
      chosen.description && `Details: ${clean(chosen.description)}`,
      (chosen.highlights ?? []).length > 0 && `Highlights: ${(chosen.highlights ?? []).map(clean).filter(Boolean).join('; ')}`,
      chosen.unitPrice > 0 && `Price: $${chosen.unitPrice} per ${clean(chosen.unit) || 'unit'}`,
    ].filter(Boolean) as string[];
    docs.push({
      docId: `passport:finish:${cat.id}`,
      kind: 'finish',
      ref: `Finish — ${clean(cat.category)}`,
      date: chosen.chosenAt || chosen.createdAt || cat.updatedAt || '',
      text: clamp(parts.join('. ')),
    });
  }

  // ── Warranties ──
  for (const w of input.warranties ?? []) {
    if (w.projectId !== project.id) continue;
    const parts = [
      `Warranty for ${clean(w.title)} (${clean(w.category)})`,
      w.provider && `Provider: ${clean(w.provider)}`,
      w.startDate && `Coverage starts ${shortDate(w.startDate)}`,
      w.endDate && `Coverage ends ${shortDate(w.endDate)}`,
      w.durationMonths > 0 && `Duration: ${w.durationMonths} months`,
      w.coverageDetails && `Covers: ${clean(w.coverageDetails)}`,
      w.exclusions && `Not covered: ${clean(w.exclusions)}`,
      w.description && `Notes: ${clean(w.description)}`,
    ].filter(Boolean) as string[];
    docs.push({
      docId: `passport:warranty:${w.id}`,
      kind: 'warranty',
      ref: `Warranty — ${clean(w.title)}`,
      date: w.endDate || w.startDate || '',
      text: clamp(parts.join('. ')),
    });
  }

  // ── Trades: commitments enriched with sub contact ("who did the electrical") ──
  const subsById = new Map((input.subcontractors ?? []).map(s => [s.id, s]));
  for (const c of input.commitments ?? []) {
    if (c.projectId !== project.id || c.status === 'draft') continue;
    const sub = c.subcontractorId ? subsById.get(c.subcontractorId) : undefined;
    const company = clean(sub?.companyName) || clean(c.vendorName) || 'Subcontractor';
    const parts = [
      `${company} worked on ${clean(project.name)}`,
      sub?.trade && `Trade: ${clean(String(sub.trade))}`,
      c.description && `Scope: ${clean(c.description)}`,
      c.phase && `Phase: ${clean(c.phase)}`,
      c.csiDivision && `CSI division: ${clean(c.csiDivision)}`,
      sub?.contactName && `Contact: ${clean(sub.contactName)}`,
      sub?.phone && `Phone: ${clean(sub.phone)}`,
      sub?.email && `Email: ${clean(sub.email)}`,
      c.signedDate && `Contracted ${shortDate(c.signedDate)}`,
    ].filter(Boolean) as string[];
    docs.push({
      docId: `passport:trade:${c.id}`,
      kind: 'trade',
      ref: `Trade — ${company}`,
      date: c.signedDate || c.createdAt || '',
      text: clamp(parts.join('. ')),
    });
  }

  // ── Maintenance schedule ──
  for (const m of input.maintenance ?? []) {
    if (!clean(m.task)) continue;
    const parts = [
      `Maintenance task: ${clean(m.task)}`,
      m.frequency && `Frequency: ${clean(m.frequency)}`,
      m.nextDate && `Next due ${shortDate(m.nextDate)}`,
      m.notes && `Notes: ${clean(m.notes)}`,
    ].filter(Boolean) as string[];
    docs.push({
      docId: `passport:maintenance:${m.id}`,
      kind: 'maintenance',
      ref: `Maintenance — ${clean(m.task)}`,
      date: m.nextDate || '',
      text: clamp(parts.join('. ')),
    });
  }

  // ── Photos: captions/locations/dates — NOT pixels (v1). Only photos the
  //    portal already shows (shared), so answers never cite an image the
  //    homeowner can't see. ──
  for (const p of input.photos ?? []) {
    if (p.projectId !== project.id || !isShared(p.portalState)) continue;
    const caption = clean(p.tag) || clean(p.location) || 'Site photo';
    const parts = [
      `Photo: ${caption}`,
      p.location && clean(p.location) !== caption && `Location: ${clean(p.location)}`,
      p.locationLabel && `Address: ${clean(p.locationLabel)}`,
      p.linkedTaskName && `During: ${clean(p.linkedTaskName)}`,
      p.timestamp && `Taken ${shortDate(p.timestamp)}`,
    ].filter(Boolean) as string[];
    docs.push({
      docId: `passport:photo:${p.id}`,
      kind: 'photo',
      ref: `Photo — ${caption}${p.timestamp ? `, ${shortDate(p.timestamp)}` : ''}`,
      date: p.timestamp || p.createdAt || '',
      text: clamp(parts.join('. ')),
    });
  }

  // ── FAQ inputs + summary ──
  const kindsPresent = new Set<PassportDocKind>(docs.map(d => d.kind));
  const faqInputs = FAQ_CATALOG
    .filter(f => f.requires.some(k => kindsPresent.has(k)))
    .slice(0, MAX_FAQ_INPUTS);

  const count = (k: PassportDocKind) => docs.filter(d => d.kind === k).length;
  return {
    docs,
    faqInputs,
    summary: {
      finishes: count('finish'),
      warranties: count('warranty'),
      trades: count('trade'),
      maintenanceItems: count('maintenance'),
      photos: count('photo'),
      docCount: docs.length,
      generatedAt,
    },
  };
}
```

- [ ] Run the validator again — must pass:

```bash
bun run scripts/validate-home-passport.ts
```
Expected output ends with a line matching `NN passed, 0 failed` (exit 0).

### 1.4 Wire into ship-check + type-check

- [ ] In `package.json`, after the line `"test:copilot-split-intents": "bun run scripts/validate-copilot-split-intents.ts",` add:

```json
    "test:home-passport": "bun run scripts/validate-home-passport.ts",
```

- [ ] In `package.json`'s `"ship-check"` script, append to the END of the `&&` chain (immediately after `bun run test:copilot-split-intents`):

```
 && bun run test:home-passport
```

- [ ] Verify:

```bash
npx tsc --noEmit
bun run test:home-passport
```
Expected: tsc silent (exit 0); validator `NN passed, 0 failed`.

### 1.5 Commit

- [ ] ```bash
git add utils/passport/types.ts utils/passport/buildHomePassport.ts scripts/validate-home-passport.ts package.json
git commit -m "passport: pure Home Passport assembly engine (docs + FAQ inputs + summary) with validator

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2 — Grounded ask-your-home prompt builder — TDD

### 2.1 Failing validator cases (RED)

- [ ] In `scripts/validate-home-passport.ts`, add below the existing imports:

```ts
import { buildAskHomePrompt, ASK_HOME_NOT_FOUND } from '../utils/passport/askHomePrompt';
```

- [ ] In the same file, insert IMMEDIATELY ABOVE the `// ── summary ──…` block:

```ts
// ── askHomePrompt ───────────────────────────────────────────────────

console.log('\nbuildAskHomePrompt validation:');

const promptDocs = [
  { ref: 'Warranty — Trane HVAC', content: 'Warranty for Trane HVAC. Coverage ends May 1, 2036' },
  { ref: 'Trade — Volt Bros Electric', content: 'Volt Bros Electric worked on Henderson Remodel. Phone: 555-0100' },
];
const p1 = buildAskHomePrompt('When does the HVAC warranty end?', promptDocs);
expectTrue('prompt contains the question', p1.includes('When does the HVAC warranty end?'));
expectTrue('prompt contains every ref as a citation label',
  p1.includes('[Warranty — Trane HVAC]') && p1.includes('[Trade — Volt Bros Electric]'));
expectTrue('prompt contains the ONLY-grounding rule', p1.includes('ONLY the home records'));
expectTrue('prompt embeds the exact not-found line', p1.includes(ASK_HOME_NOT_FOUND));
expectTrue('prompt forbids invention', p1.toLowerCase().includes('never invent'));
expectTrue('records precede the question', p1.indexOf('HOME RECORDS:') < p1.indexOf('HOMEOWNER QUESTION:'));

const p2 = buildAskHomePrompt('anything', []);
expectTrue('empty docs → still instructs not-found', p2.includes(ASK_HOME_NOT_FOUND));
expectTrue('empty docs → explicit no-records marker', p2.includes('(no records found for this question)'));
expectTrue('question is trimmed', buildAskHomePrompt('  hi  ', []).endsWith('HOMEOWNER QUESTION: hi'));
```

- [ ] Run and confirm FAILURE (module doesn't exist):

```bash
bun run scripts/validate-home-passport.ts
```
Expected: module-resolution error naming `../utils/passport/askHomePrompt` (non-zero exit).

### 2.2 Implement (GREEN)

- [ ] Create `utils/passport/askHomePrompt.ts`:

```ts
// askHomePrompt — the grounding contract for Ask Your Home answers.
//
// Pure string builder, validator-tested (scripts/validate-home-passport.ts).
// The strict rule: answer ONLY from retrieved records, cite refs, and PREFER
// the not-found line over guessing — a wrong brand/date in a homeowner's
// house record is worse than no answer.
//
// KEEP IN SYNC with supabase/functions/portal-ask-home/index.ts — edge
// functions can't import app code across the deploy boundary, so the edge fn
// carries a copy. The validator asserts the edge fn embeds the same not-found
// line and grounding rule so drift fails ship-check.

export const ASK_HOME_NOT_FOUND =
  "That's not in your home's records — ask your contractor.";

export interface AskHomeDoc {
  ref: string;
  content: string;
}

export function buildAskHomePrompt(question: string, docs: AskHomeDoc[]): string {
  const context = docs.length > 0
    ? docs.map(d => `[${d.ref}] ${d.content}`).join('\n\n')
    : '(no records found for this question)';
  return (
    'You are the memory of a home, answering the HOMEOWNER who lives there. ' +
    'Answer the question using ONLY the home records below. Never invent brands, ' +
    'dates, contacts, prices, or coverage terms. Write in plain, friendly language ' +
    'a homeowner understands — no contractor jargon. Lead with the direct answer, ' +
    'and cite the record reference in parentheses for each fact, e.g. ' +
    '(Warranty — Trane HVAC). If the records do not contain the answer, reply ' +
    `exactly: "${ASK_HOME_NOT_FOUND}" When unsure, prefer that reply over guessing.` +
    '\n\n' +
    `HOME RECORDS:\n${context}\n\n` +
    `HOMEOWNER QUESTION: ${question.trim()}`
  );
}
```

- [ ] Run — must pass:

```bash
bun run scripts/validate-home-passport.ts
npx tsc --noEmit
```
Expected: `NN passed, 0 failed`; tsc silent.

### 2.3 Commit

- [ ] ```bash
git add utils/passport/askHomePrompt.ts scripts/validate-home-passport.ts
git commit -m "passport: grounded ask-your-home prompt builder + validator cases

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3 — Contractor-side generation + snapshot v9

Two commits: **3A** (plumbing: store, memory-source, cache key, snapshot v9, both snapshot call sites) then **3B** (closeout-binder generation UI).

### 3A.1 Passport store (AsyncStorage)

- [ ] Create `utils/passport/passportStore.ts`:

```ts
// passportStore — persists the baked Home Passport (pre-answered FAQ +
// summary) per project, so the portal snapshot builders in
// app/client-portal-setup.tsx and app/project-detail.tsx can bake it into
// snapshot v9 on their next push. Kept OUT of buildHomePassport.ts so the
// engine stays pure (the validator runs it under bun, where AsyncStorage
// does not resolve).
//
// Key mageid_home_passport is registered in LOCAL_USER_CACHE_KEYS
// (contexts/AuthContext.tsx) — required for every per-user mageid_* key or
// it leaks across tenants on shared devices.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BakedHomePassport } from './types';

const STORE_KEY = 'mageid_home_passport';

type PassportStoreShape = Record<string, BakedHomePassport>;

async function readStore(): Promise<PassportStoreShape> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as PassportStoreShape) : {};
  } catch {
    return {};
  }
}

export async function loadBakedPassport(projectId: string): Promise<BakedHomePassport | null> {
  if (!projectId) return null;
  const store = await readStore();
  return store[projectId] ?? null;
}

export async function saveBakedPassport(projectId: string, baked: BakedHomePassport): Promise<void> {
  if (!projectId) return;
  try {
    const store = await readStore();
    store[projectId] = baked;
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // Non-fatal — the GC can re-generate anytime; the binder is unaffected.
  }
}
```

### 3A.2 Memory source union

- [ ] In `utils/projectMemory.ts`, change:

```ts
export type MemorySource = 'RFI' | 'Daily Report' | 'Change Order' | 'Submittal' | 'Punch Item';
```
to:
```ts
export type MemorySource = 'RFI' | 'Daily Report' | 'Change Order' | 'Submittal' | 'Punch Item' | 'Home Passport';
```

### 3A.3 Cache-key registry

- [ ] In `contexts/AuthContext.tsx`, change the last line of `LOCAL_USER_CACHE_KEYS`:

```ts
  'mageid_sub_portal_links',
```
to:
```ts
  'mageid_sub_portal_links', 'mageid_home_passport',
```

### 3A.4 Snapshot v9 (`utils/portalSnapshot.ts`)

- [ ] Change the version constant and document the bump. Replace:

```ts
export const PORTAL_SNAPSHOT_VERSION = 8;
```
with:
```ts
// v9 adds (Home Passport):
// - closeout.faq: pre-answered homeowner FAQ ({q, a, refs}) baked at
//   passport generation time on the contractor's device.
// - closeout.passport: summary counts + generatedAt driving the passport
//   header card in the portal closeout section.
export const PORTAL_SNAPSHOT_VERSION = 9;
```

- [ ] Extend the `closeout` section type. Replace:

```ts
    tradeContacts: { company: string; scope?: string; phase?: string; phone?: string; email?: string }[];
    emergencyEmail?: string;
    emergencyPhone?: string;
  };
```
with:
```ts
    tradeContacts: { company: string; scope?: string; phase?: string; phone?: string; email?: string }[];
    emergencyEmail?: string;
    emergencyPhone?: string;
    /** v9: pre-answered Home Passport FAQ — instant, zero-cost answers in
     *  the portal. Absent when the GC never generated a passport. */
    faq?: { q: string; a: string; refs: string[] }[];
    /** v9: Home Passport summary counts + generation stamp. */
    passport?: {
      finishes: number; warranties: number; trades: number;
      maintenanceItems: number; photos: number; generatedAt: string;
    };
  };
```

- [ ] Extend `BuildOpts`. Replace:

```ts
  // Project warranties — used by the closeout block.
  warranties?: import('@/types').Warranty[];
}
```
with:
```ts
  // Project warranties — used by the closeout block.
  warranties?: import('@/types').Warranty[];
  // Baked Home Passport (pre-answered FAQ + summary counts), loaded from
  // utils/passport/passportStore. Omitted when the GC never generated one.
  homePassport?: import('./passport/types').BakedHomePassport | null;
}
```

- [ ] Emit it from the closeout builder. In the `closeout: (() => { ... })()` IIFE, replace the return object:

```ts
      return {
        id: cb.id,
        status: cb.status,
        completionDate: project.closedAt ?? project.updatedAt,
        noteFromContractor: cb.notes || undefined,
        finishes: chosenSelections,
        warranties: warrantyList,
        maintenance: cb.maintenanceSchedule ?? [],
        tradeContacts,
        emergencyEmail: settings?.branding?.email,
        emergencyPhone: settings?.branding?.phone,
      };
```
with:
```ts
      // v9 — Home Passport bake. Only present when the GC has generated a
      // passport; the portal degrades to the plain binder when absent.
      const hp = opts.homePassport;
      return {
        id: cb.id,
        status: cb.status,
        completionDate: project.closedAt ?? project.updatedAt,
        noteFromContractor: cb.notes || undefined,
        finishes: chosenSelections,
        warranties: warrantyList,
        maintenance: cb.maintenanceSchedule ?? [],
        tradeContacts,
        emergencyEmail: settings?.branding?.email,
        emergencyPhone: settings?.branding?.phone,
        faq: hp && hp.faq.length > 0 ? hp.faq.map(f => ({ q: f.q, a: f.a, refs: f.refs })) : undefined,
        passport: hp
          ? {
              finishes: hp.summary.finishes,
              warranties: hp.summary.warranties,
              trades: hp.summary.trades,
              maintenanceItems: hp.summary.maintenanceItems,
              photos: hp.summary.photos,
              generatedAt: hp.generatedAt,
            }
          : undefined,
      };
```

### 3A.5 Rich snapshot call site (`app/client-portal-setup.tsx`)

- [ ] Add imports (alongside the existing `@/utils/portalSnapshot` import):

```ts
import { loadBakedPassport } from '@/utils/passport/passportStore';
import type { BakedHomePassport } from '@/utils/passport/types';
```

- [ ] Immediately BEFORE the `const snapshot = useMemo(() => {` block (~line 240), insert:

```ts
  // Baked Home Passport (FAQ + counts) — generated from the closeout-binder
  // screen, persisted in AsyncStorage, baked into snapshot v9 here.
  const [homePassport, setHomePassport] = useState<BakedHomePassport | null>(null);
  useEffect(() => {
    if (!project?.id) return;
    let cancelled = false;
    void loadBakedPassport(project.id).then(hp => { if (!cancelled) setHomePassport(hp); });
    return () => { cancelled = true; };
  }, [project?.id]);
```

- [ ] In the `buildPortalSnapshot({ ... })` options, replace:

```ts
      commitments: getCommitmentsForProject(project.id),
      warranties: getWarrantiesForProject(project.id),
    });
```
with:
```ts
      commitments: getCommitmentsForProject(project.id),
      warranties: getWarrantiesForProject(project.id),
      homePassport,
    });
```

- [ ] In the same `useMemo`'s dependency array, replace:

```ts
    contractQ.data, selectionsQ.data, closeoutQ.data,
    getCommitmentsForProject, getWarrantiesForProject,
  ]);
```
with:
```ts
    contractQ.data, selectionsQ.data, closeoutQ.data,
    getCommitmentsForProject, getWarrantiesForProject, homePassport,
  ]);
```

### 3A.6 Lite snapshot call site (`app/project-detail.tsx`)

- [ ] Add import (near the existing `buildPortalSnapshot` import at line ~67):

```ts
import { loadBakedPassport } from '@/utils/passport/passportStore';
```

- [ ] In the background-sync effect, replace:

```ts
        const [contract, selections, closeoutBinder] = await Promise.all([
          fetchActiveContract(project.id).catch(() => undefined),
          fetchSelectionsForProject(project.id).catch(() => undefined),
          fetchCloseoutBinder(project.id).catch(() => undefined),
        ]);
```
with:
```ts
        const [contract, selections, closeoutBinder, homePassport] = await Promise.all([
          fetchActiveContract(project.id).catch(() => undefined),
          fetchSelectionsForProject(project.id).catch(() => undefined),
          fetchCloseoutBinder(project.id).catch(() => undefined),
          loadBakedPassport(project.id).catch(() => null),
        ]);
```

- [ ] In the same effect's `buildPortalSnapshot({ ... })`, replace:

```ts
          contract: contract ?? undefined,
          selections: selections ?? undefined,
          closeoutBinder: closeoutBinder ?? undefined,
```
with:
```ts
          contract: contract ?? undefined,
          selections: selections ?? undefined,
          closeoutBinder: closeoutBinder ?? undefined,
          homePassport: homePassport ?? undefined,
```

### 3A.7 Verify + commit

- [ ] ```bash
npx tsc --noEmit
bun run test:home-passport
```
Expected: both clean.

- [ ] ```bash
git add utils/passport/passportStore.ts utils/projectMemory.ts contexts/AuthContext.tsx utils/portalSnapshot.ts app/client-portal-setup.tsx app/project-detail.tsx
git commit -m "passport: snapshot v9 carries baked FAQ + summary; passport store + cache-key registration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### 3B.1 Generation flow + UI in `app/closeout-binder.tsx`

- [ ] Extend imports. Change the lucide import block to add `BookOpen`:

```ts
import {
  ChevronLeft, FileDown, Plus, Trash2, Wrench,
  CheckCircle2, Send, Lock, RefreshCw, Stamp, FileText, Shield, X,
  ShieldCheck, BookOpen,
} from 'lucide-react-native';
```

and add after the existing `@/utils` imports:

```ts
import { buildHomePassport } from '@/utils/passport/buildHomePassport';
import type { BakedFaqEntry, BakedHomePassport } from '@/utils/passport/types';
import { loadBakedPassport, saveBakedPassport } from '@/utils/passport/passportStore';
import { syncMemoryEmbeddings, answerFromMemory, type MemoryDoc } from '@/utils/projectMemory';
import { useTierAccess } from '@/hooks/useTierAccess';
```

- [ ] Pull `subcontractors` from the context. Change:

```ts
  const { getProject, commitments, warranties, projectPhotos, rfis, submittals, settings, updateProject: ctxUpdateProject, getPunchItemsForProject, getInvoicesForProject, getChangeOrdersForProject } = useProjects() as any;
```
to:
```ts
  const { getProject, commitments, warranties, projectPhotos, rfis, submittals, settings, updateProject: ctxUpdateProject, getPunchItemsForProject, getInvoicesForProject, getChangeOrdersForProject, subcontractors } = useProjects() as any;
```

- [ ] Add state + tier hook. After the `const [aiaModal, setAiaModal] = useState<AiaFormId | null>(null);` line, insert:

```ts
  // Home Passport — baked result (FAQ + counts) for this project, plus
  // generation progress. Generation is ALWAYS non-blocking: the binder
  // finalize/deliver flow never waits on it and never fails because of it.
  const [passportBaked, setPassportBaked] = useState<BakedHomePassport | null>(null);
  const [passportBusy, setPassportBusy] = useState(false);
  const [passportStep, setPassportStep] = useState('');
  const { canAccess } = useTierAccess();
```

- [ ] Load the baked passport with the existing data load. In the mount effect, change:

```ts
      const [existing, sels, waivers] = await Promise.all([
        fetchCloseoutBinder(projectId),
        fetchSelectionsForProject(projectId),
        fetchLienWaiversForProject(projectId),
      ]);
      if (cancelled) return;
```
to:
```ts
      const [existing, sels, waivers, baked] = await Promise.all([
        fetchCloseoutBinder(projectId),
        fetchSelectionsForProject(projectId),
        fetchLienWaiversForProject(projectId),
        loadBakedPassport(projectId),
      ]);
      if (cancelled) return;
      setPassportBaked(baked);
```

- [ ] Add the generation callback AFTER `handleSave` and BEFORE `handleFinalize` (order matters — `handleFinalize` references it):

```ts
  // ── Home Passport generation ──────────────────────────────────────
  // 1. buildHomePassport assembles pure docs from this project's data.
  // 2. Docs are indexed into memory_embeddings via project-memory-embed
  //    (contractor JWT, source 'Home Passport', idempotent by docId) so
  //    the homeowner's portal-ask-home can retrieve them.
  // 3. Each FaqInput is pre-answered via answerFromMemory over the
  //    passport docs ONLY (never the full project index — change orders /
  //    punch items stay contractor-internal) and baked to AsyncStorage;
  //    the next snapshot push carries it to the portal (v9).
  const runPassportGeneration = useCallback(async () => {
    if (!project || passportBusy) return;
    if (!canAccess('client_portal')) {
      router.push('/paywall');
      return;
    }
    setPassportBusy(true);
    setPassportStep('Assembling home records…');
    try {
      const generatedAt = new Date().toISOString();
      const projectCommitments = (commitments ?? []).filter((c: any) => c.projectId === project.id);
      const projectWarranties = (warranties ?? []).filter((w: any) => w.projectId === project.id);
      const projectPhotosArr = (projectPhotos ?? []).filter((p: any) => p.projectId === project.id);
      const passport = buildHomePassport({
        project: { id: project.id, name: project.name, location: project.location },
        selections,
        warranties: projectWarranties,
        commitments: projectCommitments,
        subcontractors: subcontractors ?? [],
        photos: projectPhotosArr,
        maintenance,
        generatedAt,
      });
      if (passport.docs.length === 0) {
        Alert.alert(
          'Nothing to index yet',
          'The passport is assembled from selections, warranties, commitments, photos, and the maintenance schedule. Add some of those to this project first.',
        );
        return;
      }

      setPassportStep('Indexing for the portal…');
      const memoryDocs: MemoryDoc[] = passport.docs.map(d => ({
        id: d.docId,
        source: 'Home Passport',
        ref: d.ref,
        date: d.date,
        text: d.text,
      }));
      await syncMemoryEmbeddings(project.id, memoryDocs);

      const faq: BakedFaqEntry[] = [];
      let consecutiveFailures = 0;
      for (let i = 0; i < passport.faqInputs.length; i++) {
        const item = passport.faqInputs[i];
        setPassportStep(`Pre-answering ${i + 1} of ${passport.faqInputs.length}…`);
        const res = await answerFromMemory(item.question, memoryDocs);
        if (res.answer && !res.errorKind) {
          faq.push({ q: item.question, a: res.answer, refs: res.usedRefs.slice(0, 4) });
          consecutiveFailures = 0;
        } else {
          consecutiveFailures += 1;
          if (consecutiveFailures >= 2) break; // offline / signed out / capped — keep what we have
        }
      }

      const baked: BakedHomePassport = { faq, summary: passport.summary, generatedAt };
      await saveBakedPassport(project.id, baked);
      setPassportBaked(baked);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      // Non-blocking by design — the binder flow is untouched.
      console.warn('[home-passport] generation failed:', e);
      Alert.alert('Passport not generated', 'The binder is unaffected. Check your connection and tap Generate again.');
    } finally {
      setPassportBusy(false);
      setPassportStep('');
    }
  }, [project, passportBusy, canAccess, router, commitments, warranties, projectPhotos, selections, subcontractors, maintenance]);
```

- [ ] Hook generation into finalize. In `handleFinalize`, change:

```ts
              if (saved) {
                setBinderId(saved.id);
                setStatus('finalized');
                setFinalizedAt(now);
                if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              } else {
```
to:
```ts
              if (saved) {
                setBinderId(saved.id);
                setStatus('finalized');
                setFinalizedAt(now);
                if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                // Home Passport: index + pre-answer in the background.
                // Never blocks or fails the finalize itself.
                void runPassportGeneration();
              } else {
```
and change the callback's dependency array from `[persistBinder]` to `[persistBinder, runPassportGeneration]`.

- [ ] Add the passport card to the ScrollView. Insert AFTER the closing `</View>` of the "What's in it" `previewCard` block (i.e., immediately before the `{/* Notes */}` comment):

```tsx
          {/* Home Passport — generation status + manual (re-)generate.
              Shown once the binder is finalized; auto-runs at finalize. */}
          {status !== 'draft' && (
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardLabel}>Home Passport</Text>
                  <Text style={styles.cardHelper}>
                    Indexes this project&apos;s finishes, warranties, trades, and photos so the homeowner can ask their portal questions — &ldquo;what paint is the kitchen?&rdquo; — and get cited answers, plus a pre-answered FAQ.
                  </Text>
                </View>
                <BookOpen size={18} color={themeColors.accent} strokeWidth={1.75} />
              </View>
              {passportBaked ? (
                <Text style={styles.emptyHint}>
                  Generated {formattedAt(passportBaked.generatedAt)} — {passportBaked.summary.docCount} records indexed, {passportBaked.faq.length} questions pre-answered. Re-generate after editing selections, warranties, or contacts.
                </Text>
              ) : (
                <Text style={styles.emptyHint}>
                  Not generated yet. The portal shows the binder either way; the passport adds the question box and pre-answered FAQ.
                </Text>
              )}
              <TouchableOpacity
                style={[styles.smallBtn, { alignSelf: 'flex-start', marginTop: 8 }]}
                onPress={() => { void runPassportGeneration(); }}
                disabled={passportBusy}
                testID="passport-generate"
                accessibilityRole="button"
                accessibilityLabel={passportBaked ? 'Re-generate Home Passport' : 'Generate Home Passport'}
              >
                {passportBusy ? (
                  <>
                    <ActivityIndicator size="small" color={themeColors.accent} />
                    <Text style={styles.smallBtnText}>{passportStep || 'Generating…'}</Text>
                  </>
                ) : (
                  <>
                    <RefreshCw size={13} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={styles.smallBtnText}>{passportBaked ? 'Re-generate passport' : 'Generate Home Passport'}</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}
```

Note: `formattedAt` is already defined in this component; `styles.card` / `cardHead` / `cardLabel` / `cardHelper` / `emptyHint` / `smallBtn` / `smallBtnText` already exist — no new styles (anti-slop: reuse Colors/Type/Tokens via the existing themed styles).

### 3B.2 Verify + commit

- [ ] ```bash
npx tsc --noEmit
bun run test:home-passport
bun run test:app-slop
```
Expected: all clean. If typed-routes rejects `router.push('/paywall')`, the correct fix is to check the route name in `app/_layout.tsx` — do NOT cast.

- [ ] ```bash
git add app/closeout-binder.tsx
git commit -m "closeout: Generate Home Passport at finalize — index docs, pre-answer FAQ, bake for snapshot

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4 — `portal-ask-home` edge function (code only — deploy is OWNER-GATED)

### 4.1 Failing sync-check validator cases (RED)

- [ ] In `scripts/validate-home-passport.ts`, add below the existing imports:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
```

- [ ] Insert IMMEDIATELY ABOVE the `// ── summary ──…` block:

```ts
// ── portal-ask-home ↔ askHomePrompt sync ────────────────────────────
// Edge functions can't import app code, so portal-ask-home carries a copy of
// the grounding prompt. These checks pin the copy to the canonical version.

console.log('\nportal-ask-home sync validation:');

const edgeSrc = readFileSync(join(import.meta.dir, '../supabase/functions/portal-ask-home/index.ts'), 'utf8');
expectTrue('edge fn embeds the exact not-found line', edgeSrc.includes(ASK_HOME_NOT_FOUND));
expectTrue('edge fn keeps the ONLY-grounding rule', edgeSrc.includes('ONLY the home records'));
expectTrue('edge fn never logs the access token', !/console\.(log|warn|error)\([^)]*accessToken/i.test(edgeSrc));
expectTrue('edge fn uses constant-time token compare', edgeSrc.includes('constantTimeEqual'));
expectTrue('edge fn enforces the 20/day portal cap', edgeSrc.includes('PORTAL_DAILY_LIMIT = 20'));
expectTrue('edge fn filters to homeowner-safe sources', edgeSrc.includes('ALLOWED_SOURCES'));
```

- [ ] Run and confirm FAILURE (file doesn't exist → `readFileSync` throws, non-zero exit):

```bash
bun run scripts/validate-home-passport.ts
```

### 4.2 Implement the edge function (GREEN)

- [ ] Create `supabase/functions/portal-ask-home/index.ts`:

```ts
// portal-ask-home
//
// Ask Your Home: the homeowner's question box in the client portal. Anonymous
// (no JWT) — authenticated by the same 192-bit client_portal accessToken that
// gates portal_get_snapshot / portal_sign_contract. Flow:
//   1. Validate token against projects.client_portal->>'accessToken'
//      (constant-time compare, mirroring validate-portal-passcode).
//   2. Rate limit via rate_limit_counters: 20 questions/day per portal
//      (sum of today's hourly buckets) + a per-IP hourly cap.
//   3. Embed the question (geminiEmbed) → match_project_memory with the
//      project OWNER's user_id + projectId (service role, server-side only),
//      filtered to homeowner-safe sources.
//   4. Grounded Gemini answer — cites refs, prefers the not-found line.
//   5. Return { success, answer, refs: [{ ref, kind }] }.
//
// No new tables. No anon table reads. The access token is NEVER logged.
//
// Deploy (OWNER-GATED — do not deploy from a work session):
//   supabase functions deploy portal-ask-home
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY (all already set).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { rateLimitCount } from "../_shared/auth.ts";
import { geminiEmbed, toVectorLiteral } from "../_shared/embeddings.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://nteoqhcswappxxjlpvap.supabase.co";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const GEMINI_MODEL = "gemini-2.5-flash";

const PORTAL_DAILY_LIMIT = 20;   // questions per portal per UTC day (spec)
const IP_HOURLY_LIMIT = 15;      // questions per source IP per hour
const MAX_QUESTION_CHARS = 500;
const MATCH_COUNT = 12;          // fetch wide, filter to safe sources, keep 8
const KEEP_MATCHES = 8;

// Sources a homeowner may read. Change orders / submittals / punch items stay
// contractor-internal (pricing + dispute context).
const ALLOWED_SOURCES = new Set(["Home Passport", "Daily Report", "RFI"]);

// KEEP IN SYNC with utils/passport/askHomePrompt.ts —
// scripts/validate-home-passport.ts asserts this file embeds the same
// not-found line and grounding rule.
const ASK_HOME_NOT_FOUND = "That's not in your home's records — ask your contractor.";

function buildPrompt(question: string, docs: { ref: string; content: string }[]): string {
  const context = docs.length > 0
    ? docs.map((d) => `[${d.ref}] ${d.content}`).join("\n\n")
    : "(no records found for this question)";
  return (
    "You are the memory of a home, answering the HOMEOWNER who lives there. " +
    "Answer the question using ONLY the home records below. Never invent brands, " +
    "dates, contacts, prices, or coverage terms. Write in plain, friendly language " +
    "a homeowner understands — no contractor jargon. Lead with the direct answer, " +
    "and cite the record reference in parentheses for each fact, e.g. " +
    "(Warranty — Trane HVAC). If the records do not contain the answer, reply " +
    `exactly: "${ASK_HOME_NOT_FOUND}" When unsure, prefer that reply over guessing.` +
    "\n\n" +
    `HOME RECORDS:\n${context}\n\n` +
    `HOMEOWNER QUESTION: ${question.trim()}`
  );
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still iterate one of them so the timing on length mismatch is similar.
    let _diff = 0;
    for (let i = 0; i < a.length; i++) _diff |= a.charCodeAt(i) ^ 0;
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Sum today's hourly buckets for this portal's ask scope. -1 = unavailable
 *  (caller fails OPEN — the access token is the primary gate and 20 flash
 *  calls/day is a bounded cost). */
async function portalDailyCount(portalId: string): Promise<number> {
  try {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const scope = `askhome:portal:${portalId}`;
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/rate_limit_counters?select=count&scope=eq.${encodeURIComponent(scope)}&bucket_start=gte.${dayStart.toISOString()}`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (!r.ok) return -1;
    const rows = (await r.json()) as { count: number }[];
    return rows.reduce((s, x) => s + (x.count ?? 0), 0);
  } catch {
    return -1;
  }
}

function kindFromDocId(docId: string): string {
  const m = /^passport:([a-z]+):/.exec(docId || "");
  return m ? m[1] : "record";
}

interface AskRequest { portalId?: string; accessToken?: string; question?: string }
interface MemoryMatch { doc_id: string; source: string; ref: string; content: string; similarity: number }

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ success: false, error: "Use POST" }, 405);
  if (!SERVICE_ROLE_KEY || !GEMINI_KEY) return json({ success: false, error: "Server not configured" }, 500);

  let body: AskRequest;
  try { body = (await req.json()) as AskRequest; } catch { return json({ success: false, error: "Invalid JSON" }, 400); }

  const portalId = (body.portalId ?? "").trim();
  const accessToken = (body.accessToken ?? "").trim();
  const question = (body.question ?? "").trim();
  if (!portalId || !accessToken || !question) {
    return json({ success: false, error: "Missing portalId, accessToken, or question" }, 400);
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return json({ success: false, error: "Question too long — keep it under 500 characters." }, 400);
  }

  // Per-IP hourly throttle. Fail OPEN on limiter unavailability (count < 0):
  // the access token is the primary gate.
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  if (ip) {
    const ipHits = await rateLimitCount(`askhome:ip:${ip}`);
    if (ipHits > IP_HOURLY_LIMIT) {
      return json({ success: false, error: "Too many questions from this connection — please wait a bit.", code: "rate_limited" }, 429);
    }
  }

  // Resolve the owning project (id + owner user_id + portal config) with the
  // service role — anon can't read projects, and nothing here leaks: the
  // response never includes ids or tokens.
  const lookup = await fetch(
    `${SUPABASE_URL}/rest/v1/projects?select=id,user_id,client_portal&client_portal->>portalId=eq.${encodeURIComponent(portalId)}&limit=1`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!lookup.ok) {
    console.error("[portal-ask-home] lookup failed:", lookup.status);
    return json({ success: false, error: "Lookup failed" }, 500);
  }
  const rows = (await lookup.json()) as {
    id: string;
    user_id: string;
    client_portal: { accessToken?: string; enabled?: boolean } | null;
  }[];
  const proj = rows[0];
  const portal = proj?.client_portal ?? null;
  if (!proj || !portal?.enabled || !portal.accessToken || !constantTimeEqual(accessToken, portal.accessToken)) {
    // Same shape + delay for "no such portal" and "bad token" — don't reveal
    // which. Never log the submitted token.
    await new Promise((r) => setTimeout(r, 250));
    return json({ success: false, error: "Invalid portal link" }, 401);
  }

  // Per-portal daily cap: increment this hour's bucket, then sum today.
  await rateLimitCount(`askhome:portal:${portalId}`);
  const daily = await portalDailyCount(portalId);
  if (daily > PORTAL_DAILY_LIMIT) {
    return json({
      success: false,
      error: "Daily question limit reached — the answered questions above are always available. Try again tomorrow.",
      code: "daily_limit",
    }, 429);
  }

  // Retrieve from the project's memory index using the OWNER's user_id.
  let qvec: number[][];
  try {
    qvec = await geminiEmbed([question]);
  } catch (e) {
    console.error("[portal-ask-home] query embed failed:", String(e));
    return json({ success: false, error: "Embedding failed" }, 502);
  }
  if (!qvec[0]) return json({ success: false, error: "Empty embedding" }, 502);

  const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/match_project_memory`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_user_id: proj.user_id,
      p_project_id: proj.id,
      p_query: toVectorLiteral(qvec[0]),
      p_match_count: MATCH_COUNT,
    }),
  });
  if (!rpc.ok) {
    const t = await rpc.text().catch(() => "");
    console.error("[portal-ask-home] rpc failed:", rpc.status, t.slice(0, 300));
    return json({ success: false, error: "Search failed" }, 500);
  }
  const allMatches = (await rpc.json()) as MemoryMatch[];
  const matches = (Array.isArray(allMatches) ? allMatches : [])
    .filter((m) => ALLOWED_SOURCES.has(m.source))
    .slice(0, KEEP_MATCHES);

  if (matches.length === 0) {
    // Nothing homeowner-safe matched — the honest answer, free of charge.
    return json({ success: true, answer: ASK_HOME_NOT_FOUND, refs: [] });
  }

  // Grounded answer.
  const prompt = buildPrompt(question, matches.map((m) => ({ ref: m.ref, content: m.content })));
  const gen = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 500, temperature: 0.2 },
      }),
    },
  );
  if (!gen.ok) {
    const t = await gen.text().catch(() => "");
    console.error("[portal-ask-home] gemini failed:", gen.status, t.slice(0, 200));
    return json({ success: false, error: "No answer right now — try again in a moment." }, 502);
  }
  const genData = await gen.json();
  const answer = (genData.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
  if (!answer) {
    return json({ success: false, error: "No answer right now — try again in a moment." }, 502);
  }

  const refs = matches.map((m) => ({ ref: m.ref, kind: kindFromDocId(m.doc_id) }));
  return json({ success: true, answer, refs });
});
```

- [ ] Run the validator — must pass:

```bash
bun run scripts/validate-home-passport.ts
```
Expected: `NN passed, 0 failed`. (`npx tsc --noEmit` ignores `supabase/functions/` — Deno files are outside the app tsconfig — but run it anyway to confirm nothing app-side broke.)

- [ ] **Do NOT deploy.** No `supabase functions deploy`, no MCP `deploy_edge_function`. The header comment marks it owner-gated.

### 4.3 Commit

- [ ] ```bash
git add supabase/functions/portal-ask-home/index.ts scripts/validate-home-passport.ts
git commit -m "edge: portal-ask-home — token-gated grounded Q&A over home records (code only, deploy owner-gated)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5 — Portal UI: passport card + FAQ + ask box (`marketing/portal/index.html`)

All edits are to `marketing/portal/index.html`. The portal script is ES5-style vanilla JS (`var`, `function`, no arrows) — match it. Everything user-visible goes through `esc()`. Netlify deploy of this file is OWNER-GATED (build-free `netlify deploy --dir` procedure) — this task only edits the file.

### 5.1 Strings

- [ ] In `FALLBACK_STRINGS`, after the line `closeoutNoteEyebrow: 'A NOTE FROM YOUR CONTRACTOR',` add:

```js
    passportEyebrow: 'YOUR HOME PASSPORT',
    passportChipFinishes: 'finishes',
    passportChipWarranties: 'warranties',
    passportChipTrades: 'trade contacts',
    passportChipMaintenance: 'maintenance tasks',
    passportChipPhotos: 'photos',
    askHomeFaqTitle: 'Answers ready for you',
    askHomeTitle: 'Ask your home',
    askHomeSubtitle: 'What paint is the kitchen? Who did the electrical? When does the roof warranty end?',
    askHomePlaceholder: 'Ask anything about your home…',
    askHomeButton: 'Ask',
    askHomeThinking: 'Checking your home’s records…',
    askHomeUnavailable: 'Questions aren’t available yet — your contractor’s records are still being prepared. The binder above has everything on file.',
    askHomeLimit: 'You’ve reached today’s question limit. The answered questions above are always available — try again tomorrow.',
    askHomeError: 'Couldn’t reach your home’s records right now. Try again in a moment.',
```

### 5.2 Styles

- [ ] After the `.co-status-pill { ... }` CSS rule (the block ending `text-transform: uppercase;\n  }`), add:

```css
  /* ───────── Home Passport / Ask your home ───────── */
  .ah-passport {
    background: #FFF7E6; border: 1px solid #F4D88E;
    border-radius: 12px; padding: 14px 16px; margin-bottom: 18px;
  }
  .ah-eyebrow {
    font-size: 10px; font-weight: 800; letter-spacing: 1px;
    color: #C26A00; text-transform: uppercase; margin-bottom: 8px;
  }
  .ah-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .ah-chip {
    font-size: 11px; color: #4A5159; background: #fff;
    border: 1px solid #F4D88E; border-radius: 999px; padding: 4px 10px;
  }
  .ah-chip strong { color: #0B0D10; font-weight: 800; }
  .ah-faq { margin-top: 18px; }
  .ah-faq-item {
    border: 1px solid rgba(11, 13, 16, 0.1); border-radius: 10px;
    margin-bottom: 8px; background: #fff;
  }
  .ah-faq-item summary {
    cursor: pointer; padding: 12px 14px; font-size: 13px;
    font-weight: 700; color: #0B0D10; list-style: none;
  }
  .ah-faq-item summary::-webkit-details-marker { display: none; }
  .ah-faq-item[open] summary { border-bottom: 1px solid rgba(11, 13, 16, 0.1); }
  .ah-faq-a { padding: 12px 14px; font-size: 13px; color: #4A5159; line-height: 1.6; }
  .ah-refs { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
  .ah-ref {
    font-size: 10px; font-weight: 700; color: #C26A00;
    background: #FFF1E6; padding: 3px 8px; border-radius: 999px;
  }
  .ah-ref-photo { display: block; max-width: 160px; border-radius: 8px; margin-top: 8px; }
  .ah-ask { margin-top: 18px; }
  .ah-ask-sub { font-size: 12px; color: #8B9099; margin: 4px 0 10px; }
  .ah-ask-row { display: flex; gap: 8px; }
  .ah-ask-row input {
    flex: 1; border: 1px solid rgba(11, 13, 16, 0.14); border-radius: 10px;
    padding: 12px 14px; font-size: 14px; font-family: inherit; color: #0B0D10;
  }
  .ah-ask-row .btn-primary {
    padding: 12px 18px; background: #FF6A1A; color: #fff; border: none;
    border-radius: 10px; font-weight: 800; font-size: 13px; cursor: pointer;
  }
  .ah-ask-row .btn-primary:disabled { opacity: 0.6; cursor: default; }
  .ah-status { margin-top: 10px; font-size: 12px; color: #8B9099; font-style: italic; }
  .ah-answer-card {
    margin-top: 12px; border: 1px solid rgba(11, 13, 16, 0.1);
    border-radius: 12px; padding: 14px 16px; background: #fff;
  }
  .ah-q { font-size: 11px; font-weight: 700; color: #8B9099; margin-bottom: 6px; }
  .ah-a { font-size: 13px; color: #0B0D10; line-height: 1.6; }
```

- [ ] Keep the binder PRINT clean. After the print rule `body.printing-binder #sec-closeout .section-head { display: none !important; }` add:

```css
    body.printing-binder .ah-passport, body.printing-binder .ah-faq,
    body.printing-binder .ah-ask, body.printing-binder .co-actions { display: none !important; }
```

### 5.3 Render: passport chips + FAQ + ask box inside the closeout section

- [ ] In `renderCloseout`, replace the final return block:

```js
    return '' +
      '<div class="closeout">' +
        '<div class="co-actions">' +
          '<button type="button" class="btn-primary" data-action="print-binder">' + esc(t('closeoutPrint')) + '</button>' +
          '<span class="co-status-pill">' + (c.status === 'sent' ? esc(t('closeoutDelivered')) : esc(t('closeoutFinalized'))) + '</span>' +
        '</div>' +
        '<div class="closeout-printable">' +
          completionLine +
          noteHtml +
          (finishesRows ? '<h3 class="co-h3">' + esc(t('closeoutFinishesTitle')) + '</h3><table class="co-table"><tbody>' + finishesRows + '</tbody></table>' : '') +
          (warrantyRows ? '<h3 class="co-h3">' + esc(t('closeoutWarrantiesTitle')) + '</h3><table class="co-table"><tbody>' + warrantyRows + '</tbody></table>' : '') +
          (maintRows ? '<h3 class="co-h3">' + esc(t('closeoutMaintenanceTitle')) + '</h3><table class="co-table"><tbody>' + maintRows + '</tbody></table>' : '') +
          (contactRows ? '<h3 class="co-h3">' + esc(t('closeoutContactsTitle')) + '</h3><table class="co-table"><tbody>' + contactRows + '</tbody></table>' : '') +
          emergencyHtml +
        '</div>' +
      '</div>';
  }
```
with:
```js
    return '' +
      '<div class="closeout">' +
        '<div class="co-actions">' +
          '<button type="button" class="btn-primary" data-action="print-binder">' + esc(t('closeoutPrint')) + '</button>' +
          '<span class="co-status-pill">' + (c.status === 'sent' ? esc(t('closeoutDelivered')) : esc(t('closeoutFinalized'))) + '</span>' +
        '</div>' +
        renderPassportSummary(c.passport) +
        '<div class="closeout-printable">' +
          completionLine +
          noteHtml +
          (finishesRows ? '<h3 class="co-h3">' + esc(t('closeoutFinishesTitle')) + '</h3><table class="co-table"><tbody>' + finishesRows + '</tbody></table>' : '') +
          (warrantyRows ? '<h3 class="co-h3">' + esc(t('closeoutWarrantiesTitle')) + '</h3><table class="co-table"><tbody>' + warrantyRows + '</tbody></table>' : '') +
          (maintRows ? '<h3 class="co-h3">' + esc(t('closeoutMaintenanceTitle')) + '</h3><table class="co-table"><tbody>' + maintRows + '</tbody></table>' : '') +
          (contactRows ? '<h3 class="co-h3">' + esc(t('closeoutContactsTitle')) + '</h3><table class="co-table"><tbody>' + contactRows + '</tbody></table>' : '') +
          emergencyHtml +
        '</div>' +
        renderPassportFaq(c.faq) +
        renderAskHome(c) +
      '</div>';
  }
```

- [ ] Insert the helper functions + submit handler IMMEDIATELY BEFORE the comment line `// Print handler — toggles a body class so print CSS shows only the binder.`:

```js
  // ───── Home Passport / Ask your home ─────
  // Passport chips + pre-baked FAQ come straight from snapshot v9
  // (closeout.passport / closeout.faq) — instant, zero-cost. The ask box
  // POSTs to the portal-ask-home edge fn with the same ?t= access token the
  // sign/selection RPCs use (see portal-mark-viewed for the call pattern).
  // If the fn isn't deployed yet (404), the box degrades to a calm
  // "not available yet" message — never an error state.
  function renderPassportSummary(p) {
    if (!p) return '';
    var chips = [
      [p.finishes, t('passportChipFinishes')],
      [p.warranties, t('passportChipWarranties')],
      [p.trades, t('passportChipTrades')],
      [p.maintenanceItems, t('passportChipMaintenance')],
      [p.photos, t('passportChipPhotos')]
    ].filter(function (c2) { return (c2[0] || 0) > 0; }).map(function (c2) {
      return '<span class="ah-chip"><strong>' + c2[0] + '</strong> ' + esc(c2[1]) + '</span>';
    }).join('');
    if (!chips) return '';
    return '<div class="ah-passport">' +
      '<div class="ah-eyebrow">' + esc(t('passportEyebrow')) + '</div>' +
      '<div class="ah-chips">' + chips + '</div>' +
    '</div>';
  }

  function renderRefChips(refs) {
    if (!refs || !refs.length) return '';
    var chips = refs.map(function (r) {
      var label = typeof r === 'string' ? r : ((r && r.ref) || '');
      return label ? '<span class="ah-ref">' + esc(label) + '</span>' : '';
    }).join('');
    return chips ? '<div class="ah-refs">' + chips + '</div>' : '';
  }

  function renderPassportFaq(faq) {
    if (!faq || !faq.length) return '';
    var items = faq.map(function (f) {
      if (!f || !f.q || !f.a) return '';
      return '<details class="ah-faq-item">' +
        '<summary>' + esc(f.q) + '</summary>' +
        '<div class="ah-faq-a">' + esc(f.a).replace(/\n+/g, '<br/>') + renderRefChips(f.refs) + '</div>' +
      '</details>';
    }).join('');
    if (!items) return '';
    return '<div class="ah-faq"><h3 class="co-h3">' + esc(t('askHomeFaqTitle')) + '</h3>' + items + '</div>';
  }

  function renderAskHome(c) {
    // The ask box needs the passport index server-side; only show it when a
    // passport was generated (chips or FAQ present).
    if (!c || (!c.passport && !(c.faq && c.faq.length))) return '';
    return '<div class="ah-ask">' +
      '<h3 class="co-h3">' + esc(t('askHomeTitle')) + '</h3>' +
      '<div class="ah-ask-sub">' + esc(t('askHomeSubtitle')) + '</div>' +
      '<div class="ah-ask-row">' +
        '<input type="text" id="ah-input" maxlength="300" placeholder="' + esc(t('askHomePlaceholder')) + '" />' +
        '<button type="button" class="btn-primary" id="ah-send">' + esc(t('askHomeButton')) + '</button>' +
      '</div>' +
      '<div id="ah-answer"></div>' +
    '</div>';
  }

  function findPhotoUrlForRef(refLabel) {
    try {
      var photos = (window.__portalData && window.__portalData.sections && window.__portalData.sections.photos) || [];
      for (var i = 0; i < photos.length; i++) {
        var cap = photos[i] && photos[i].caption;
        if (cap && refLabel.indexOf(cap) !== -1) return photos[i].url || '';
      }
    } catch (e) { /* best-effort only */ }
    return '';
  }

  function renderAskRefs(refs) {
    if (!refs || !refs.length) return '';
    var chips = '';
    var photoHtml = '';
    for (var i = 0; i < refs.length; i++) {
      var r = refs[i] || {};
      var label = typeof r === 'string' ? r : (r.ref || '');
      if (!label) continue;
      chips += '<span class="ah-ref">' + esc(label) + '</span>';
      if (r.kind === 'photo' && !photoHtml) {
        var url = findPhotoUrlForRef(label);
        if (url) photoHtml = '<img class="ah-ref-photo" src="' + esc(url) + '" alt="" loading="lazy"/>';
      }
    }
    if (!chips) return '';
    return '<div class="ah-refs">' + chips + '</div>' + photoHtml;
  }

  function submitAskHome() {
    var input = document.getElementById('ah-input');
    var out = document.getElementById('ah-answer');
    var btn = document.getElementById('ah-send');
    if (!input || !out) return;
    var q = (input.value || '').trim();
    if (!q) return;
    var data = window.__portalData || {};
    var api = data.portalApi || {};
    var token = getPortalToken();
    if (!api.portalId || !token) {
      out.innerHTML = '<div class="ah-status">' + esc(t('askHomeUnavailable')) + '</div>';
      return;
    }
    var base = api.supabaseUrl
      ? api.supabaseUrl.replace(/\/+$/, '')
      : 'https://nteoqhcswappxxjlpvap.supabase.co';
    out.innerHTML = '<div class="ah-status">' + esc(t('askHomeThinking')) + '</div>';
    if (btn) btn.disabled = true;
    fetch(base + '/functions/v1/portal-ask-home', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portalId: api.portalId, accessToken: token, question: q }),
    }).then(function (r) {
      if (r.status === 404) throw { kind: 'unavailable' };
      if (r.status === 429) throw { kind: 'limit' };
      if (!r.ok) throw { kind: 'error' };
      return r.json();
    }).then(function (j) {
      if (btn) btn.disabled = false;
      if (!j || !j.success || !j.answer) { out.innerHTML = '<div class="ah-status">' + esc(t('askHomeError')) + '</div>'; return; }
      out.innerHTML = '<div class="ah-answer-card">' +
        '<div class="ah-q">' + esc(q) + '</div>' +
        '<div class="ah-a">' + esc(j.answer).replace(/\n+/g, '<br/>') + '</div>' +
        renderAskRefs(j.refs) +
      '</div>';
      input.value = '';
    }).catch(function (err) {
      if (btn) btn.disabled = false;
      var key = err && err.kind === 'unavailable' ? 'askHomeUnavailable'
        : err && err.kind === 'limit' ? 'askHomeLimit' : 'askHomeError';
      out.innerHTML = '<div class="ah-status">' + esc(t(key)) + '</div>';
    });
  }

  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest && e.target.closest('#ah-send');
    if (!btn) return;
    e.preventDefault();
    submitAskHome();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target && e.target.id === 'ah-input') {
      e.preventDefault();
      submitAskHome();
    }
  });

```

### 5.4 Verify

- [ ] Static sanity (no build step exists for the portal):

```bash
grep -c "renderPassportSummary\|renderPassportFaq\|renderAskHome\|submitAskHome" marketing/portal/index.html
grep -c "askHomeUnavailable" marketing/portal/index.html
node -e "const s=require('fs').readFileSync('marketing/portal/index.html','utf8');const m=s.match(/<script>([\s\S]*?)<\/script>/);new Function(m[1]);console.log('script parses OK')"
```
Expected: first grep ≥ 6 (definitions + call sites); second ≥ 3 (string def + two uses); node prints `script parses OK` (parse-only — it must not throw a SyntaxError).

- [ ] Visual QA note: Claude cannot auth to the live portal; the owner visually verifies at deploy time (build-free Netlify procedure, owner-gated). The graceful-degradation path (fn 404 → `askHomeUnavailable`) means the HTML can ship before the edge fn deploys, but the SAFE order is still: deploy edge fn first, then portal HTML.

### 5.5 Commit

- [ ] ```bash
git add marketing/portal/index.html
git commit -m "portal: Home Passport card, pre-answered FAQ, and Ask-your-home box in the closeout section

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6 — Full ship-check + branch review

- [ ] Run the full gate:

```bash
bun run ship-check
```
Expected: every validator green including the new `test:home-passport` at the end of the chain; `tsc` + lint clean. Fix anything red before proceeding (never skip, never weaken a check).

- [ ] Self-review sweep against the spec (`docs/superpowers/specs/2026-07-23-home-passport-ask-your-home-design.md`):
  - [ ] Spec coverage: pure engine ✓ (Task 1), FaqInput ~10 ✓, ≤4000-char docs ✓, stable docIds ✓, empty-input totality ✓, prompt prefer-not-found ✓ (Task 2), finalize hook + non-blocking ✓ (Task 3), snapshot faq bake + version bump ✓ (3A), edge fn token/rate-limit/service-role/`{answer, refs}` ✓ (Task 4, NOT deployed), portal card + FAQ + ask box + graceful 404 ✓ (Task 5), tier gate `client_portal` Pro+ ✓ (3B).
  - [ ] Placeholder scan: `grep -rn "TBD\|TODO\|FIXME\|XXX" utils/passport/ supabase/functions/portal-ask-home/ scripts/validate-home-passport.ts` → no hits.
  - [ ] Type consistency: `BakedHomePassport` is the single shape shared by passportStore, portalSnapshot BuildOpts, and closeout-binder; `PassportDoc.docId` prefixes match `kindFromDocId` in the edge fn; `ASK_HOME_NOT_FOUND` identical in utils + edge fn (validator-pinned).
  - [ ] Security: access token never in snapshot, never logged; no anon table reads; edge fn uses service role only server-side; FAQ context restricted to passport docs; ask retrieval filtered to `ALLOWED_SOURCES`.
- [ ] Review the whole branch diff: `git log --oneline main..HEAD && git diff main --stat`. Request a code review per superpowers:requesting-code-review if running under the subagent-driven flow.
- [ ] **Ship boundary (do NOT do these — owner-gated):** merge to main; `eas update` OTA; `supabase functions deploy portal-ask-home`; Netlify portal deploy. Report readiness instead.
