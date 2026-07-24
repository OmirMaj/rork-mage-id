# Profit Leak Faculty MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Profit Leak faculty MVP — (1) a CO Leak Detector that scans a daily report's text against the project's estimate scope, prices the flagged out-of-scope work from the learned cost book, and drafts the change order in one tap; and (2) a Sub-Bid Reality Check that warns (never blocks) when a saved commitment is suspiciously below or above what the estimate scope it covers should cost.

**Architecture:** A pure engine (`utils/profitLeak/*`): `buildScopeSummary` turns the linked estimate + scope notes + approved COs into deterministic prompt text; `buildLeakPrompt` + `coerceLeakResult` handle the single fast-tier AI call (the AI's ONLY job is reading free text); `priceLeakItems` prices every flag deterministically via `lookupRate` (null when no history — it never invents a number); `checkSubBid` is pure math with zero AI. The scan lives on `app/daily-report.tsx` behind an explicit button, cached by report-id + text hash, and persisted additively on `DailyFieldReport.leakScan`. The sub-bid check hooks the commitment save in `app/job-costing.tsx` as a dismissible banner.

**Tech Stack:** TypeScript (strict), React Native / Expo Router, bun. No jest — one pure-function validator (`scripts/validate-profit-leak.ts`) chained into `ship-check`. AI via the existing `mageAI` relay (`feature: 'profitLeak'`, fast tier, standard daily quota — free tier included).

**Branch:** `claude/profit-leak` (already checked out, off `main`).

**Ship boundary:** Everything here is OTA-safe: pure JS/TS, reuses the existing `ai` edge function (no server change — `profitLeak` is not proOnly, so the relay's per-feature allowlist does not need an entry; `scripts/validate-ai-feature-gating.ts` only requires relay entries for `proOnly` features). **No migration**: `daily_reports` has no `leak_scan` column, so `leakScan` persists via the local store only — do NOT add it to any `supabaseWrite` payload (the offline queue would drop/fail writes against a missing column — the `punch_location` lesson).

---

## File Structure

**Create (pure engine):**
- `utils/profitLeak/scopeSummary.ts` — `buildScopeSummary(project, changeOrders): string` (+ `MAX_SCOPE_CHARS`).
- `utils/profitLeak/leakPrompt.ts` — `buildLeakPrompt`, `coerceLeakResult`, `hashLeakText`, `LEAK_SCHEMA_HINT`, `LeakScanResult`, `LeakReportInput`, `MAX_LEAK_ITEMS`.
- `utils/profitLeak/priceLeakItems.ts` — `priceLeakItems(items, costDb): PricedLeakItem[]`.
- `utils/profitLeak/subBidCheck.ts` — `checkSubBid(commitment, project, costDb): SubBidVerdict` (+ `LOW_BAND`/`HIGH_BAND`).

**Create (validator):**
- `scripts/validate-profit-leak.ts` — ALL four modules tested in this ONE file, built up progressively across Tasks 1–4.

**Modify:**
- `types/index.ts` — `LeakConfidence`/`LeakItem`/`PricedLeakItem`/`LeakScanRecord` domain types (Task 2) + additive `leakScan?: LeakScanRecord` on `DailyFieldReport` (Task 5). Domain types live HERE, not in `utils/profitLeak/` — types/index.ts is the single source of truth for domain types (CLAUDE.md) and putting them in utils would create a `types → utils → types` import cycle once `DailyFieldReport` carries `leakScan`.
- `utils/aiRateLimiterCore.ts` — `'profitLeak'` in the `AIFeature` union + `FEATURE_CONFIG` entry (Task 5).
- `app/daily-report.tsx` — "Scan for unbilled work" action + result card + scanned/flags badge + persistence (Task 6).
- `app/change-order.tsx` — additive `'out_of_scope'` prefill-reason mapping (Task 6; see Grounded reality #7 for why this is required).
- `app/job-costing.tsx` — `checkSubBid` on commitment save + dismissible warning banner (Task 7).
- `package.json` — `"test:profit-leak"` script chained into `ship-check` (Task 1).

**Reference (reuse, unchanged):** `utils/costDatabase.ts` (`buildCostDatabase`, `lookupRate`, `CostDatabase`, `CostBookEntry`), `utils/mageAI.ts` (`mageAI`), `utils/csiMasterFormat.ts` (`csiDivisionLabel`, `classifyToCSIDivision`), `utils/aiRateLimiter.ts` (`checkAILimit`, `recordAIUsage`), `contexts/ProjectContext.tsx` (`updateDailyReport`, `getChangeOrdersForProject`, `projects`, `commitments`).

---

## Grounded reality (verified in code, 2026-07-23)

These are REAL signatures/shapes from the repo. Do not re-derive them — build against these.

### 1. `DailyFieldReport` (`types/index.ts:1374`)

```ts
export interface DailyFieldReport {
  id: string;
  projectId: string;
  date: string;
  weather: DFRWeather;
  manpower: ManpowerEntry[];
  workPerformed: string;
  workProgress?: DFRWorkProgress[];
  materialsDelivered: string[];
  issuesAndDelays: string;
  photos: DFRPhoto[];
  status: DFRStatus;
  incident?: IncidentReport;
  safetyToolboxTalk?: SafetyToolboxTalk;
  homeownerSummary?: string;
  homeownerSummaryGeneratedAt?: string;
  homeownerSummaryPublished?: boolean;
  createdAt: string;
  updatedAt: string;
  portalState?: PortalState;
}
```

The scan reads `workPerformed` + `issuesAndDelays` (free text) and `materialsDelivered` (string[]) as context.

### 2. `LinkedEstimate` / `LinkedEstimateItem` (`types/index.ts:1036/1046`)

```ts
export interface LinkedEstimate {
  id: string;
  items: LinkedEstimateItem[];
  globalMarkup: number;
  baseTotal: number;
  markupTotal: number;
  grandTotal: number;
  createdAt: string;
}
export interface LinkedEstimateItem {
  materialId: string;      // ← the id `Commitment.linkedEstimateItems` references
  name: string;
  category: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  bulkPrice: number;
  markup: number;
  usesBulk: boolean;
  lineTotal: number;
  supplier: string;
  csiDivision?: string;    // 2-digit CSI MasterFormat, e.g. "26" = Electrical
  isAllowance?: boolean;
  firmPricedAt?: string;
  xray?: CostXrayMeta;
}
```

### 3. `ChangeOrder` / `ChangeOrderStatus` (`types/index.ts:1098/1123`)

```ts
export type ChangeOrderStatus = 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected' | 'revised' | 'void';
export interface ChangeOrder {
  id: string;
  number: number;
  projectId: string;
  date: string;
  description: string;
  reason: string;
  lineItems: ChangeOrderLineItem[];
  originalContractValue: number;
  changeAmount: number;
  newContractTotal: number;
  status: ChangeOrderStatus;
  createdAt: string;
  updatedAt: string;
  // + optional: scheduleImpactDays, approvers, auditTrail, revision, portalState…
}
```

### 4. `Commitment` (`types/index.ts:1829`) and `ProjectScope` (`types/index.ts:99`)

```ts
export interface Commitment {
  id: string;
  projectId: string;
  number: string;
  type: CommitmentType;             // 'subcontract' | 'purchase_order'
  subcontractorId?: string;
  vendorName?: string;
  description: string;
  amount: number;                   // original signed amount — the number we sanity-check
  changeAmount?: number;
  paidToDate?: number;
  signedDate: string;
  phase?: string;
  csiDivision?: string;
  linkedEstimateItems?: string[];   // LinkedEstimateItem.materialId[] — basis A
  status: CommitmentStatus;         // 'draft' | 'active' | 'closed'
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
export interface ProjectScope {
  projectType: string;
  sizeSqft: string;
  location: string;
  quality: 'budget' | 'standard' | 'high_end';
  scope: string;                    // free text — feeds the scope summary
  timelineWeeks: string;
  specialRequirements: string;
  targetBudget: string;
  updatedAt: string;
}
```

`Project` carries `scope?: ProjectScope` (`types/index.ts:155`) plus legacy `squareFootage: number`, `quality`, `description`, `linkedEstimate?`.

### 5. Cost database (`utils/costDatabase.ts`)

```ts
export interface CostBookEntry {
  key: string;                      // `${trade.toLowerCase()}|${unit.toLowerCase()}`
  trade: string;
  unit: string;
  sampleCount: number;
  jobCount: number;
  personalRate: number;
  variability: number;
  bidBias: number;
  baseline: number;
  suggestedRate: number;            // ← the learned rate we price with
  confidence: 'low' | 'medium' | 'high';
  totalActual: number;
  lastSeen: string;
  samples: CostSample[];
}
export interface CostDatabase {
  entries: CostBookEntry[];
  jobsAnalyzed: number;
  tradesTracked: number;
  overallBidAccuracy: number | null;
  asOf: string;
}
export function buildCostDatabase(projects: Project[], commitments: Commitment[], receipts: MaterialReceipt[] = []): CostDatabase
export function lookupRate(db: CostDatabase, trade: string, unit: string): CostBookEntry | null {
  const key = `${(trade || '').trim().toLowerCase()}|${(unit || 'unit').trim().toLowerCase()}`;
  return db.entries.find(e => e.key === key) ?? null;
}
```

Client screens build it with `buildCostDatabase(projects, commitments)` (see `app/cost-xray.tsx:127`, `app/area-takeoff.tsx:172`).

### 6. AI feature registration (`utils/aiRateLimiterCore.ts:13/53`)

```ts
export type AIFeature =
  // Fast / cheap — counted toward the daily fast quota
  | 'voiceIntake'
  | 'leadScoring'
  | 'copilot'
  // …
  | 'dailyReport'
  | 'projectReport'
  // Smart / expensive …

export const FEATURE_CONFIG: Record<AIFeature, FeatureConfig> = {
  // Fast features — unlimited within daily quota
  voiceIntake:        { tier: 'fast', displayName: 'Voice intake' },
  leadScoring:        { tier: 'fast', displayName: 'Lead scoring' },
  homeownerSummary:   { tier: 'fast', displayName: 'Homeowner digest' },
  dailyReport:        { tier: 'fast', displayName: 'Daily report' },
  projectReport:      { tier: 'fast', displayName: 'Project report' },
  // …
};
```

`FEATURE_CONFIG` is `Record<AIFeature, FeatureConfig>` — adding to the union without adding a config entry fails `tsc`. No `freeLifetimeCap`, no `proOnly` for `profitLeak` (spec: free tier gets the standard fast quota). Gating helpers (`utils/aiRateLimiter.ts`):

```ts
export async function checkAILimit(subscriptionTier: SubscriptionTierKey, requestTier: RequestTier, feature?: AIFeature): Promise<LimitCheck>
export async function recordAIUsage(requestTier: RequestTier, feature?: AIFeature): Promise<void>
```

### 7. `mageAI` (`utils/mageAI.ts:14-49`)

```ts
interface MageAIParams {
  prompt: string;
  schema?: any;           // Zod — client-side validation only
  schemaHint?: object;    // Plain JSON example — sent to the edge fn (sets jsonMode)
  tier?: "fast" | "smart";
  maxTokens?: number;     // default 1000
  cacheKey?: string;      // AsyncStorage cache, `mage_ai_cache_` prefix
  cacheHours?: number;    // default 2
  timeoutMs?: number;
  feature?: string;       // FEATURE_CONFIG vocabulary; relay gates an explicit allowlist
}
interface MageAIResult {
  success: boolean;
  data: any;              // schema'd/jsonMode structured result arrives here
  raw?: string;
  error?: string;
  cached?: boolean;
  errorKind?: 'timeout' | 'network' | 'http' | 'model' | 'validation' | 'unauthenticated' | 'monthly_cap' | 'unknown';
  finishReason?: string;
  fromCache?: boolean;
}
```

With `schemaHint` (no zod `schema`), `res.data` is the parsed JSON as-is — so we run it through our own pure `coerceLeakResult` before trusting it.

### 8. Change-order prefill (`app/change-order.tsx:85-152`) — **THE TRAP**

```ts
const { projectId, coId, prefillReason, prefillDescription, prefillAmount, prefillScheduleDays } = useLocalSearchParams<{...}>();
// …
const [reason, setReason] = useState(
  existingCO?.reason ?? (
    prefillReason === 'allowance_overage' ? 'Allowance overage'
    : prefillReason === 'client_request' ? 'Client request'
    : ''
  )
);
// …
const seedFromOverage: ChangeOrderLineItem[] | null = !existingCO && prefillAmount && Number(prefillAmount) > 0
  ? [{
      id: 'overage-prefill',
      name: 'Allowance overage',
      description: prefillDescription ?? 'Allowance overage',
      quantity: 1,
      unit: 'ls',
      unitPrice: Number(prefillAmount),
      total: Number(prefillAmount),
      isNew: true,
    }]
  : null;
```

**`prefillReason` is a TOKEN mapped through a whitelist, not free text.** The spec's `prefillReason=Out-of-scope work (…)` would map to `''` and the seed line would be named "Allowance overage". Task 6 therefore adds an additive `'out_of_scope'` token to both the reason mapping and the seed-line name. Existing call-site shape to mirror (`app/selections.tsx:174-182`):

```ts
router.push({
  pathname: '/change-order' as any,
  params: { projectId, prefillReason: 'allowance_overage', prefillDescription: `…`, prefillAmount: String(overage) },
});
```

### 9. Daily-report persistence (`contexts/ProjectContext.tsx:1915`)

```ts
const updateDailyReport = useCallback((id: string, updates: Partial<DailyFieldReport>) => {
  const now = new Date().toISOString();
  const updated = dailyReports.map(dr => dr.id === id ? { ...dr, ...updates, updatedAt: now } : dr);
  setDailyReports(updated);
  saveDailyReportsMutation.mutate(updated);          // ← local store: leakScan persists here
  // …
  if (canSync) {
    void supabaseWrite('daily_reports', 'update', {  // ← EXPLICIT column list — leakScan is
      id, weather: dr.weather, /* … */               //   intentionally NOT in it (no column).
    });                                              //   DO NOT extend this payload.
  }
}, […]);
```

The merge (`{ ...dr, ...updates }`) means `updateDailyReport(id, { leakScan })` is a safe additive write. Cross-device sync won't carry `leakScan` (documented v1 limitation, no migration in scope).

### 10. Daily-report screen idiom (`app/daily-report.tsx`)

- Styles: `const styles = useThemedStyles(makeStyles); const hsStyles = useThemedStyles(makeHsStyles);` — factories at the bottom, `(themeColors: ThemeColors) => StyleSheet.create({...})`. Section cards: `styles.sectionCard` / `styles.sectionHeader` / `styles.sectionTitle`. The Homeowner-update card (`:1349-1437`) is the AI-action pattern to mirror: helper text → `aiBtn` with `MageAIMark` icon + `RefreshCw` while generating → result content → status pill (`publishedPill`) pinned right in the header via `marginLeft: 'auto'`.
- AI gating pattern (`:73-80`): `checkAILimit(tier, 'fast', 'voiceCapture')` → `LimitCheck` state → blocked opens `UpgradeSheet` via `setUpgradeLimit(limit)`.
- `existingReport` (`:104`) is resolved before the field states; save goes through `handleSave` (`:559`) which branches `updateDailyReport(existingReport.id, {...})` vs `addDailyReport(report)` with `stableReportId`.
- `useProjects()` already exposes `projects`, `commitments`, `getChangeOrdersForProject` (destructure more from the same hook).

### 11. Job-costing commitment save (`app/job-costing.tsx:334-345, 484-508`)

```tsx
<CommitmentEditor
  visible={showAdd || !!editingCommitment}
  projectId={projectId ?? ''}
  existing={editingCommitment}
  onClose={() => { setShowAdd(false); setEditingCommitment(null); }}
  onSave={(c, isNew) => {
    if (isNew) addCommitment(c); else updateCommitment(c.id, c);
    setShowAdd(false);
    setEditingCommitment(null);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }}
/>
```

`CommitmentEditor.handleSave` builds the `Commitment` object WITHOUT `csiDivision`/`linkedEstimateItems` keys (they're not editable in that modal), so on edit the hook must merge over `editingCommitment` to keep basis A alive. `updateCommitment` in ProjectContext merges `{ ...c, ...updates }`, so the store keeps those fields. Warning idiom on this screen: `styles.warningSection` / `warningHeader` / `warningTitle` / `warningItem` (the "Over-committed against budget" block, `:258-266`). `Alert.alert` is unreliable on RN-web (the screen uses `confirm()` there) — use a state-driven inline banner instead.

### 12. CSI helpers (`utils/csiMasterFormat.ts`)

```ts
export function csiDivisionLabel(num: string | null | undefined): string   // "Div 26 — Electrical"
export function classifyToCSIDivision(text: string): string | null         // keyword-scored, null when thin
```

### 13. Validator harness + ship-check (`package.json`, `scripts/validate-*.ts`)

Harness (identical across the suite): `let pass = 0, fail = 0;` + `function expect<T>(name, got, want)` comparing `JSON.stringify`, footer `console.log(\`\n${pass} passed, ${fail} failed\`); if (fail > 0) process.exit(1);`. Imports are RELATIVE (`../utils/profitLeak/...`, `../types`). Scripts wire as `"test:profit-leak": "bun run scripts/validate-profit-leak.ts"` and append `&& bun run test:profit-leak` to the `ship-check` chain. Anti-slop (`test:app-slop`) bans emoji-as-icons, purple/pink/violet hex, and the "Inter" font — lucide icons + theme colors only.

---

## Conventions the implementer must follow

- **AI identifies, the engine prices.** No dollar figure may originate from the model. `priceLeakItems` and `checkSubBid` are the only sources of $.
- **Pure functions never throw** on bad input — clamp/default/return-unknown instead.
- **No supabase payload changes.** `leakScan` is local-store-only (Grounded reality #9). No migration, no edge-fn change, no new AsyncStorage keys (so no `LOCAL_USER_CACHE_KEYS` change).
- **Validator imports are RELATIVE** (`../utils/...`); app code uses the `@/` alias.
- **UI:** lucide icons only, `Type.*` font sizes, `Tokens.radius.*`, theme colors via `useThemedStyles` factories — match the daily-report/job-costing idioms quoted above.
- **Commit after each task** with the trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. `git add` only the files the task touched.
- **Gate after each task:** `npx tsc --noEmit` clean; for validator tasks the stated `bun run test:profit-leak` count passes.

---

### Task 1: `buildScopeSummary` + validator scaffold (TDD)

**Files:**
- Create: `utils/profitLeak/scopeSummary.ts`
- Create: `scripts/validate-profit-leak.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test** — create `scripts/validate-profit-leak.ts`:

```ts
// validate-profit-leak.ts — unit tests for the Profit Leak faculty:
// scope summary, leak prompt, deterministic pricing, sub-bid check.
// Run via: bun run test:profit-leak
import { buildScopeSummary, MAX_SCOPE_CHARS } from '../utils/profitLeak/scopeSummary';
import type { ChangeOrder, ChangeOrderStatus, LinkedEstimateItem, Project } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got:  ', JSON.stringify(got), '\n      want: ', JSON.stringify(want)); }
}

// ── Fixtures ──
function li(materialId: string, category: string, name: string, unit: string, quantity: number, lineTotal: number, csiDivision?: string): LinkedEstimateItem {
  return { materialId, name, category, unit, quantity, unitPrice: quantity > 0 ? lineTotal / quantity : lineTotal, bulkPrice: 0, markup: 0, usesBulk: false, lineTotal, supplier: '', csiDivision };
}
function proj(items: LinkedEstimateItem[], over: Record<string, unknown> = {}): Project {
  return {
    id: 'P1', name: 'Henderson Kitchen', type: 'renovation', status: 'in_progress',
    squareFootage: 400, quality: 'standard', description: '',
    linkedEstimate: items.length > 0 ? {
      id: 'e1', items, globalMarkup: 20, baseTotal: 0, markupTotal: 0,
      grandTotal: items.reduce((s, it) => s + it.lineTotal, 0), createdAt: '2026-06-01',
    } : undefined,
    ...over,
  } as unknown as Project;
}
function co(number: number, description: string, status: ChangeOrderStatus): ChangeOrder {
  return {
    id: `co-${number}`, number, projectId: 'P1', date: '2026-07-01', description, reason: 'Field change',
    lineItems: [], originalContractValue: 0, changeAmount: 0, newContractTotal: 0, status,
    createdAt: '2026-07-01', updatedAt: '2026-07-01',
  };
}

const ITEMS = [
  li('m1', 'Electrical', 'Panel upgrade', 'ea', 1, 4200, '26'),
  li('m2', 'Framing', 'Wall framing', 'sf', 400, 4800, '06'),
];

console.log('\nprofitLeak buildScopeSummary:');

const scopeProj = proj(ITEMS, {
  scope: { projectType: 'renovation', sizeSqft: '400', location: '', quality: 'standard', scope: 'Full kitchen remodel per plans', timelineWeeks: '8', specialRequirements: 'Keep fridge circuit live', targetBudget: '', updatedAt: '2026-06-01' },
});
const cos = [co(1, 'Added exterior GFCI outlet', 'approved'), co(2, 'Skylight over island', 'rejected')];
const summary = buildScopeSummary(scopeProj, cos);

expect('names the project', summary.includes('Henderson Kitchen'), true);
expect('groups items under the CSI division label', summary.includes('Div 26 — Electrical'), true);
expect('formats item as category — name (qty unit)', summary.includes('- Electrical — Panel upgrade (1 ea)'), true);
expect('includes the scope free text', summary.includes('Full kitchen remodel per plans'), true);
expect('includes special requirements', summary.includes('Keep fridge circuit live'), true);
expect('includes approved CO as already-approved addition', summary.includes('CO #1: Added exterior GFCI outlet'), true);
expect('excludes rejected CO', summary.includes('Skylight over island'), false);
expect('says so when no line-item estimate exists', buildScopeSummary(proj([]), []).includes('No line-item estimate'), true);

const bigItems = Array.from({ length: 400 }, (_, i) => li(`b${i}`, 'Finishes', `Very long descriptive line item name number ${i} with extra words`, 'sf', 10, 100, '09'));
expect('caps output length', buildScopeSummary(proj(bigItems), []).length <= MAX_SCOPE_CHARS, true);
expect('never throws on a bare project', typeof buildScopeSummary({} as Project, []) === 'string', true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Wire the script + run to verify it fails**

In `package.json` `scripts`, add after `"test:copilot-split-intents"`:

```json
"test:profit-leak": "bun run scripts/validate-profit-leak.ts",
```

and append ` && bun run test:profit-leak` to the END of the `ship-check` chain.

Run: `bun run test:profit-leak`
Expected: FAIL — cannot find module `../utils/profitLeak/scopeSummary`.

- [ ] **Step 3: Implement `buildScopeSummary`**

```ts
// utils/profitLeak/scopeSummary.ts — deterministic scope text for the leak scan.
// Estimate items grouped by CSI division, then the GC's scope notes, then
// prior APPROVED change orders (already-captured additions are not leaks).
// Pure; never throws; capped so the prompt stays cheap on fast tier.
import type { ChangeOrder, LinkedEstimateItem, Project } from '@/types';
import { csiDivisionLabel } from '@/utils/csiMasterFormat';

export const MAX_SCOPE_CHARS = 6000;

export function buildScopeSummary(project: Project, changeOrders: ChangeOrder[]): string {
  try {
    const parts: string[] = [];
    const name = project?.name || 'This project';
    const meta: string[] = [];
    if (project?.type) meta.push(String(project.type));
    if (project?.squareFootage) meta.push(`${project.squareFootage} sf`);
    if (project?.quality) meta.push(String(project.quality));
    parts.push(`PROJECT: ${name}${meta.length ? ` (${meta.join(', ')})` : ''}`);

    const items: LinkedEstimateItem[] = project?.linkedEstimate?.items ?? [];
    if (items.length === 0) {
      parts.push('\nCONTRACTED SCOPE: No line-item estimate on file — judge only against the scope notes below.');
    } else {
      parts.push('\nCONTRACTED SCOPE (estimate line items):');
      const groups = new Map<string, LinkedEstimateItem[]>();
      for (const it of items) {
        const key = it.csiDivision ?? '';
        const bucket = groups.get(key);
        if (bucket) bucket.push(it); else groups.set(key, [it]);
      }
      for (const [division, group] of groups) {
        parts.push(division ? `${csiDivisionLabel(division)}:` : 'Other scope:');
        for (const it of group) {
          parts.push(`- ${it.category} — ${it.name} (${it.quantity} ${it.unit})`);
        }
      }
    }

    const notes = [project?.scope?.scope, project?.scope?.specialRequirements, project?.description]
      .map(s => (s ?? '').trim())
      .filter(Boolean);
    if (notes.length > 0) {
      parts.push('\nSCOPE NOTES:');
      for (const n of notes) parts.push(n);
    }

    const approved = (changeOrders ?? []).filter(c => c?.projectId === project?.id && c?.status === 'approved');
    if (approved.length > 0) {
      parts.push('\nALREADY APPROVED ADDITIONS (in scope — never flag these):');
      for (const c of approved) {
        const lineNames = (c.lineItems ?? []).map(l => l.name).filter(Boolean).join(', ');
        parts.push(`- CO #${c.number}: ${c.description}${lineNames ? ` (${lineNames})` : ''}`);
      }
    }

    const full = parts.join('\n');
    if (full.length <= MAX_SCOPE_CHARS) return full;
    return full.slice(0, MAX_SCOPE_CHARS - 22) + '\n…(scope truncated)';
  } catch {
    return 'PROJECT: (scope unavailable)';
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test:profit-leak`
Expected: `10 passed, 0 failed`.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` — expected clean.

```bash
git add utils/profitLeak/scopeSummary.ts scripts/validate-profit-leak.ts package.json
git commit -m "$(cat <<'EOF'
feat(profit-leak): deterministic scope summary + validator scaffold

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Leak types + `buildLeakPrompt` / `coerceLeakResult` / `hashLeakText` (TDD)

**Files:**
- Modify: `types/index.ts` (insert the new types immediately BEFORE `export interface DailyFieldReport` at ~:1374)
- Create: `utils/profitLeak/leakPrompt.ts`
- Modify: `scripts/validate-profit-leak.ts` (append cases BEFORE the footer)

- [ ] **Step 1: Add the domain types to `types/index.ts`** (before `DailyFieldReport`):

```ts
// ─────────────────────────────────────────────
// Profit Leak — CO leak detector
// ─────────────────────────────────────────────

export type LeakConfidence = 'low' | 'medium' | 'high';

/** One suspected out-of-scope work item the AI flagged in a daily report.
 *  The AI only IDENTIFIES — every dollar figure comes from priceLeakItems. */
export interface LeakItem {
  description: string;
  /** Best-guess trade/category label — keyed against the learned cost book. */
  trade: string;
  /** Best-guess unit ('ls' allowed). */
  unit: string;
  /** Best-guess quantity (1 for lump sum). */
  quantity: number;
  confidence: LeakConfidence;
  /** The exact report phrase that triggered the flag. */
  reportQuote: string;
}

/** LeakItem + deterministic pricing from the learned cost book. */
export interface PricedLeakItem extends LeakItem {
  /** suggestedRate × quantity, rounded. null = no price history — GC prices it. */
  estimatedPrice: number | null;
  rateUsed: number | null;
  rateConfidence: LeakConfidence | null;
  fromHistory: boolean;
}

/** Persisted result of a Profit Leak scan on a daily report.
 *  LOCAL-ONLY: daily_reports has no leak_scan column — never add this to
 *  a supabaseWrite payload. */
export interface LeakScanRecord {
  items: PricedLeakItem[];
  scannedAt: string;
  /** hashLeakText(workPerformed, issuesAndDelays) at scan time — staleness check. */
  textHash: string;
}
```

- [ ] **Step 2: Append the failing tests** to `scripts/validate-profit-leak.ts` (before the `console.log(\`\n${pass} passed…\`)` footer):

```ts
import { buildLeakPrompt, coerceLeakResult, hashLeakText, LEAK_SCHEMA_HINT, MAX_LEAK_ITEMS } from '../utils/profitLeak/leakPrompt';

console.log('\nprofitLeak buildLeakPrompt:');

const report = {
  workPerformed: 'Framed pantry wall. Also trenched 40 lf for the new gas line the owner asked for.',
  issuesAndDelays: 'Inspector wants a second GFCI at the island.',
  materialsDelivered: ['40 lf gas pipe'],
};
const prompt = buildLeakPrompt(summary, report);

expect('prompt embeds the scope summary', prompt.includes('Henderson Kitchen'), true);
expect('prompt embeds work performed', prompt.includes('trenched 40 lf'), true);
expect('prompt embeds issues and delays', prompt.includes('second GFCI'), true);
expect('prompt embeds materials delivered', prompt.includes('40 lf gas pipe'), true);
expect('rule: compare only against provided scope', /ONLY against the scope provided/i.test(prompt), true);
expect('rule: approved additions are in scope', /already approved additions/i.test(prompt), true);
expect('rule: quote the exact report phrase', /exact phrase/i.test(prompt), true);
expect('rule: prefer empty over speculation', /empty items list over speculation/i.test(prompt), true);
expect('schema hint carries the item shape', Object.keys(LEAK_SCHEMA_HINT.items[0]).sort(), ['confidence', 'description', 'quantity', 'reportQuote', 'trade', 'unit']);

console.log('\nprofitLeak hashLeakText:');
expect('stable for identical input', hashLeakText('framed walls', 'none') === hashLeakText('framed walls', 'none'), true);
expect('changes when text changes', hashLeakText('framed walls', 'none') === hashLeakText('framed walls today', 'none'), false);
expect('ignores case and outer whitespace', hashLeakText('  Framed Walls ', 'None') === hashLeakText('framed walls', 'none'), true);

console.log('\nprofitLeak coerceLeakResult:');
const goodItem = { description: 'Gas line trench', trade: 'Plumbing', unit: 'lf', quantity: 40, confidence: 'high', reportQuote: 'trenched 40 lf' };
expect('accepts the {items:[...]} envelope', coerceLeakResult({ items: [goodItem] }).length, 1);
expect('accepts a bare array', coerceLeakResult([goodItem])[0].description, 'Gas line trench');
expect('fills defaults for missing fields', coerceLeakResult({ items: [{ description: 'Extra paint' }] })[0], { description: 'Extra paint', trade: 'General', unit: 'ls', quantity: 1, confidence: 'low', reportQuote: '' });
expect('drops items without a description', coerceLeakResult({ items: [{ trade: 'Electrical' }] }).length, 0);
expect('returns [] for junk input', coerceLeakResult('nope').length, 0);
expect('caps the item count', coerceLeakResult({ items: Array.from({ length: 25 }, (_, i) => ({ description: `x${i}` })) }).length, MAX_LEAK_ITEMS);
```

- [ ] **Step 3: Run to verify the new cases fail**

Run: `bun run test:profit-leak`
Expected: FAIL — cannot find module `../utils/profitLeak/leakPrompt`.

- [ ] **Step 4: Implement `leakPrompt.ts`**

```ts
// utils/profitLeak/leakPrompt.ts — the ONE AI seam of the Profit Leak faculty.
// buildLeakPrompt: grounded prompt (scope + report, strict rules).
// coerceLeakResult: pure, zod-free coercion of the model's JSON into LeakItem[]
//   — one malformed field never tanks the scan.
// hashLeakText: stable hash of the scanned text → cache key + staleness check.
import type { LeakItem } from '@/types';

export interface LeakReportInput {
  workPerformed: string;
  issuesAndDelays: string;
  materialsDelivered: string[];
}

/** AI response envelope — what the model is asked to return. */
export interface LeakScanResult {
  items: LeakItem[];
}

export const MAX_LEAK_ITEMS = 10;

/** Plain-JSON example sent as mageAI schemaHint (sets jsonMode on the relay). */
export const LEAK_SCHEMA_HINT = {
  items: [{
    description: 'Installed 3 extra recessed lights in the hallway',
    trade: 'Electrical',
    unit: 'ea',
    quantity: 3,
    confidence: 'medium',
    reportQuote: 'added three more cans in the hall per the owner',
  }],
};

export function buildLeakPrompt(scopeSummary: string, report: LeakReportInput): string {
  const materials = (report.materialsDelivered ?? []).filter(Boolean);
  return [
    'You are a construction change-order auditor working for the general contractor.',
    "Compare TODAY'S DAILY REPORT against the CONTRACTED SCOPE and identify work that is likely OUT OF SCOPE (extra work the GC should bill as a change order).",
    '',
    'Rules:',
    '- Compare ONLY against the scope provided below. Do not assume any scope that is not written here.',
    '- Work listed under "already approved additions" is in scope — never flag it.',
    '- For every flagged item, set reportQuote to the exact phrase from the report that triggered it.',
    '- Prefer an empty items list over speculation. Only flag work the report clearly describes.',
    '- quantity is your best guess from the report; use unit "ls" and quantity 1 for lump-sum work.',
    '- confidence is how sure you are the item is out of scope: low, medium, or high.',
    '- Respond with JSON only, matching the provided shape.',
    '',
    '=== CONTRACTED SCOPE ===',
    scopeSummary,
    '',
    "=== TODAY'S DAILY REPORT ===",
    `Work performed: ${report.workPerformed?.trim() || '(none)'}`,
    `Issues and delays: ${report.issuesAndDelays?.trim() || '(none)'}`,
    `Materials delivered: ${materials.length ? materials.join('; ') : '(none)'}`,
  ].join('\n');
}

const CONFIDENCES = new Set(['low', 'medium', 'high']);

export function coerceLeakResult(data: unknown): LeakItem[] {
  const rawItems: unknown[] = Array.isArray(data)
    ? data
    : (data && typeof data === 'object' && Array.isArray((data as { items?: unknown[] }).items))
      ? ((data as { items: unknown[] }).items)
      : [];
  const out: LeakItem[] = [];
  for (const raw of rawItems) {
    if (out.length >= MAX_LEAK_ITEMS) break;
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const description = typeof r.description === 'string' ? r.description.trim() : '';
    if (!description) continue;
    const qty = typeof r.quantity === 'number' && Number.isFinite(r.quantity) && r.quantity > 0 ? r.quantity : 1;
    out.push({
      description,
      trade: typeof r.trade === 'string' && r.trade.trim() ? r.trade.trim() : 'General',
      unit: typeof r.unit === 'string' && r.unit.trim() ? r.unit.trim() : 'ls',
      quantity: qty,
      confidence: typeof r.confidence === 'string' && CONFIDENCES.has(r.confidence) ? (r.confidence as LeakItem['confidence']) : 'low',
      reportQuote: typeof r.reportQuote === 'string' ? r.reportQuote.trim() : '',
    });
  }
  return out;
}

/** djb2 over normalized text — stable across sessions, cheap, collision-fine
 *  for a per-report staleness check. */
export function hashLeakText(workPerformed: string, issuesAndDelays: string): string {
  const text = `${(workPerformed ?? '').trim()}\n${(issuesAndDelays ?? '').trim()}`.toLowerCase();
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = (((h << 5) + h) + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run test:profit-leak`
Expected: `28 passed, 0 failed`.

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit` — expected clean.

```bash
git add types/index.ts utils/profitLeak/leakPrompt.ts scripts/validate-profit-leak.ts
git commit -m "$(cat <<'EOF'
feat(profit-leak): leak domain types + grounded prompt, coercion, text hash

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `priceLeakItems` (TDD)

**Files:**
- Create: `utils/profitLeak/priceLeakItems.ts`
- Modify: `scripts/validate-profit-leak.ts` (append cases before the footer)

- [ ] **Step 1: Append the failing tests**:

```ts
import { priceLeakItems } from '../utils/profitLeak/priceLeakItems';
import type { CostBookEntry, CostDatabase } from '../utils/costDatabase';

function entry(trade: string, unit: string, suggestedRate: number, confidence: CostBookEntry['confidence']): CostBookEntry {
  return {
    key: `${trade.toLowerCase()}|${unit.toLowerCase()}`, trade, unit,
    sampleCount: 5, jobCount: 5, personalRate: suggestedRate, variability: 0.1,
    bidBias: 0, baseline: suggestedRate, suggestedRate, confidence,
    totalActual: 1000, lastSeen: '2026-01-01', samples: [],
  };
}
function db(entries: CostBookEntry[]): CostDatabase {
  return { entries, jobsAnalyzed: 5, tradesTracked: entries.length, overallBidAccuracy: 0.9, asOf: '2026-01-01' };
}

console.log('\nprofitLeak priceLeakItems:');

const elecDb = db([entry('Electrical', 'ea', 400, 'high')]);
const priced = priceLeakItems([{ description: 'Extra cans', trade: 'Electrical', unit: 'ea', quantity: 3, confidence: 'medium', reportQuote: 'added 3 cans' }], elecDb);
expect('prices from history: rate × qty, rounded', priced[0].estimatedPrice, 1200);
expect('carries the rate used', priced[0].rateUsed, 400);
expect('carries the cost-book confidence', priced[0].rateConfidence, 'high');
expect('marks fromHistory', priced[0].fromHistory, true);

const noHist = priceLeakItems([{ description: 'Gas trench', trade: 'Plumbing', unit: 'lf', quantity: 40, confidence: 'high', reportQuote: 'trenched' }], elecDb);
expect('no history → null price (never invents a number)', noHist[0].estimatedPrice, null);
expect('no history → null rate confidence', noHist[0].rateConfidence, null);
expect('no history → fromHistory false', noHist[0].fromHistory, false);

const badQty = priceLeakItems([{ description: 'Panel work', trade: 'Electrical', unit: 'ea', quantity: NaN, confidence: 'low', reportQuote: '' }], elecDb);
expect('bad quantity clamps to 1', badQty[0].estimatedPrice, 400);
expect('empty input → empty output', priceLeakItems([], elecDb).length, 0);
```

- [ ] **Step 2: Run to verify the new cases fail**

Run: `bun run test:profit-leak`
Expected: FAIL — cannot find module `../utils/profitLeak/priceLeakItems`.

- [ ] **Step 3: Implement `priceLeakItems`**

```ts
// utils/profitLeak/priceLeakItems.ts — deterministic pricing of AI-flagged
// leak items against the contractor's learned cost book. The engine prices;
// no history → null ("price it yourself"). Never invents a number, never throws.
import { lookupRate, type CostDatabase } from '@/utils/costDatabase';
import type { LeakItem, PricedLeakItem } from '@/types';

export function priceLeakItems(items: LeakItem[], costDb: CostDatabase): PricedLeakItem[] {
  return (items ?? []).map((item) => {
    const qty = Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1;
    const hit = lookupRate(costDb, item.trade, item.unit);
    const fromHistory = !!hit && hit.suggestedRate > 0;
    return {
      ...item,
      quantity: qty,
      estimatedPrice: fromHistory ? Math.round(hit!.suggestedRate * qty) : null,
      rateUsed: fromHistory ? hit!.suggestedRate : null,
      rateConfidence: fromHistory ? hit!.confidence : null,
      fromHistory,
    };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test:profit-leak`
Expected: `37 passed, 0 failed`.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` — expected clean.

```bash
git add utils/profitLeak/priceLeakItems.ts scripts/validate-profit-leak.ts
git commit -m "$(cat <<'EOF'
feat(profit-leak): deterministic leak-item pricing from the learned cost book

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `checkSubBid` (TDD) — pure math, zero AI

**Files:**
- Create: `utils/profitLeak/subBidCheck.ts`
- Modify: `scripts/validate-profit-leak.ts` (append cases before the footer)

- [ ] **Step 1: Append the failing tests**:

```ts
import { checkSubBid, LOW_BAND, HIGH_BAND } from '../utils/profitLeak/subBidCheck';
import type { Commitment } from '../types';

function cmt(over: Partial<Commitment>): Commitment {
  return {
    id: 'c1', projectId: 'P1', number: 'C-1001', type: 'subcontract',
    description: 'Electrical rough-in', amount: 10000, signedDate: '2026-07-01',
    status: 'active', createdAt: '2026-07-01', updatedAt: '2026-07-01', ...over,
  };
}

console.log('\nprofitLeak checkSubBid (basis A — linked items):');

const projA = proj(ITEMS);                        // m1 4200 + m2 4800 = 9000 expected
const costDbA = db([entry('Electrical', 'ea', 4000, 'high')]);
const low = checkSubBid(cmt({ linkedEstimateItems: ['m1', 'm2'], amount: 7000 }), projA, costDbA);
expect('linked items → basis linked_items', low.basis, 'linked_items');
expect('expected = sum of linked lineTotals', low.expected, 9000);
expect('under 0.85× → low', low.verdict, 'low');
expect('gap = amount − expected', low.gap, -2000);
expect('exactly 0.85× → fair (band is strict)', checkSubBid(cmt({ linkedEstimateItems: ['m1', 'm2'], amount: 9000 * LOW_BAND }), projA, costDbA).verdict, 'fair');
expect('in-band → fair', checkSubBid(cmt({ linkedEstimateItems: ['m1', 'm2'], amount: 9000 }), projA, costDbA).verdict, 'fair');
expect('exactly 1.30× → fair (band is strict)', checkSubBid(cmt({ linkedEstimateItems: ['m1', 'm2'], amount: 9000 * HIGH_BAND }), projA, costDbA).verdict, 'fair');
expect('above 1.30× → high', checkSubBid(cmt({ linkedEstimateItems: ['m1', 'm2'], amount: 11701 }), projA, costDbA).verdict, 'high');
expect('low verdict carries a dollar sentence', low.detail.includes('$7,000') && low.detail.includes('$9,000'), true);

console.log('\nprofitLeak checkSubBid (basis B — trade match):');

const projB1 = proj([li('m1', 'Electrical', 'Panel upgrade', 'ea', 1, 4200, '26')]);
const b1 = checkSubBid(cmt({ csiDivision: '26', amount: 3000 }), projB1, costDbA);
expect('csiDivision match → basis trade_match', b1.basis, 'trade_match');
expect('expected uses the learned rate (4000), not lineTotal', b1.expected, 4000);
expect('3000 vs 4000 → low', b1.verdict, 'low');

const projB2 = proj([
  li('m1', 'Electrical', 'Panel upgrade', 'ea', 1, 4200, '26'),
  li('m3', 'Electrical', 'Trenching for service', 'lf', 100, 1500, '26'),
]);
const b2 = checkSubBid(cmt({ csiDivision: '26', amount: 5500 }), projB2, costDbA);
expect('no learned rate for a matched item → falls back to its lineTotal', b2.expected, 5500);
expect('mixed-basis in-band → fair', b2.verdict, 'fair');

const projB3 = proj([li('m4', 'Pool', 'Gunite pool', 'ls', 1, 30000)]);
const b3 = checkSubBid(cmt({ description: 'Pool package for backyard', amount: 20000 }), projB3, db([]));
expect('description keyword match when nothing classifies', b3.basis, 'trade_match');
expect('keyword-matched low bid flags', b3.verdict, 'low');

console.log('\nprofitLeak checkSubBid (unknown / never throws):');
expect('no estimate → unknown', checkSubBid(cmt({ linkedEstimateItems: ['m1'] }), proj([]), costDbA).verdict, 'unknown');
expect('zero amount → unknown', checkSubBid(cmt({ amount: 0 }), projA, costDbA).verdict, 'unknown');
expect('NaN amount → unknown (never throws)', checkSubBid(cmt({ amount: NaN }), projA, costDbA).verdict, 'unknown');
expect('no basis at all → unknown', checkSubBid(cmt({ description: 'Xyz misc package', amount: 5000 }), projB1, costDbA).verdict, 'unknown');
```

- [ ] **Step 2: Run to verify the new cases fail**

Run: `bun run test:profit-leak`
Expected: FAIL — cannot find module `../utils/profitLeak/subBidCheck`.

- [ ] **Step 3: Implement `checkSubBid`**

```ts
// utils/profitLeak/subBidCheck.ts — Sub-Bid Reality Check. PURE MATH, no AI.
// Basis A (preferred): the estimate lines the commitment says it covers.
// Basis B: csiDivision/description → matching estimate items priced at the
//   learned rate where history exists, else at the GC's own budgeted lineTotal.
// No basis → 'unknown' (silent — no noise). Never throws, never blocks a save.
import type { Commitment, LinkedEstimateItem, Project } from '@/types';
import { lookupRate, type CostDatabase } from '@/utils/costDatabase';
import { classifyToCSIDivision } from '@/utils/csiMasterFormat';

export type SubBidBand = 'low' | 'high' | 'fair' | 'unknown';

export interface SubBidVerdict {
  verdict: SubBidBand;
  basis: 'linked_items' | 'trade_match' | null;
  expected: number | null;
  /** amount − expected. Negative = the bid is under the expectation. */
  gap: number | null;
  /** amount / expected − 1. */
  variancePct: number | null;
  /** Ready-to-show sentence ('' when unknown). */
  detail: string;
}

export const LOW_BAND = 0.85;
export const HIGH_BAND = 1.30;

const UNKNOWN: SubBidVerdict = { verdict: 'unknown', basis: null, expected: null, gap: null, variancePct: null, detail: '' };

const fmtUSD = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;

function matchByTrade(commitment: Commitment, items: LinkedEstimateItem[]): LinkedEstimateItem[] {
  const div = commitment.csiDivision
    || classifyToCSIDivision(`${commitment.description} ${commitment.phase ?? ''}`);
  if (div) {
    const matched = items.filter(it =>
      (it.csiDivision ?? classifyToCSIDivision(`${it.category} ${it.name}`)) === div);
    if (matched.length > 0) return matched;
  }
  const hay = `${commitment.description} ${commitment.phase ?? ''}`.toLowerCase();
  return items.filter(it => {
    const cat = (it.category ?? '').trim().toLowerCase();
    return cat.length >= 3 && hay.includes(cat);
  });
}

export function checkSubBid(commitment: Commitment, project: Project, costDb: CostDatabase): SubBidVerdict {
  try {
    const amount = commitment?.amount;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return UNKNOWN;
    const items = project?.linkedEstimate?.items ?? [];
    if (items.length === 0) return UNKNOWN;

    let basis: 'linked_items' | 'trade_match' | null = null;
    let expected = 0;

    const links = (commitment.linkedEstimateItems ?? []).filter(Boolean);
    if (links.length > 0) {
      const byId = new Map(items.map(it => [it.materialId, it]));
      const linked = links.map(id => byId.get(id)).filter((it): it is LinkedEstimateItem => !!it);
      if (linked.length > 0) {
        basis = 'linked_items';
        expected = linked.reduce((sum, it) => sum + (it.lineTotal || 0), 0);
      }
    }

    if (!basis) {
      const matched = matchByTrade(commitment, items);
      if (matched.length > 0) {
        basis = 'trade_match';
        expected = matched.reduce((sum, it) => {
          const hit = lookupRate(costDb, it.category, it.unit);
          const learned = hit && hit.suggestedRate > 0 ? hit.suggestedRate * (it.quantity || 0) : 0;
          return sum + (learned > 0 ? learned : (it.lineTotal || 0));
        }, 0);
      }
    }

    if (!basis || expected <= 0) return UNKNOWN;

    const variancePct = amount / expected - 1;
    const gap = amount - expected;
    const pct = Math.abs(Math.round(variancePct * 100));
    const who = commitment.vendorName?.trim() || commitment.description.trim();
    const basisNoun = basis === 'linked_items' ? 'the estimate lines it covers' : 'the matching estimate scope';

    if (amount < LOW_BAND * expected) {
      return {
        verdict: 'low', basis, expected, gap, variancePct,
        detail: `${who}: ${fmtUSD(amount)} — ${basisNoun} totals ${fmtUSD(expected)} (${pct}% under). Confirm the full scope is included before counting the savings.`,
      };
    }
    if (amount > HIGH_BAND * expected) {
      return {
        verdict: 'high', basis, expected, gap, variancePct,
        detail: `${who}: ${fmtUSD(amount)} is ${pct}% above the ${fmtUSD(expected)} carried in ${basisNoun}. Worth a second look before signing.`,
      };
    }
    return {
      verdict: 'fair', basis, expected, gap, variancePct,
      detail: `${who}: ${fmtUSD(amount)} is in line with the ${fmtUSD(expected)} carried in ${basisNoun}.`,
    };
  } catch {
    return UNKNOWN;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test:profit-leak`
Expected: `57 passed, 0 failed`.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` — expected clean.

```bash
git add utils/profitLeak/subBidCheck.ts scripts/validate-profit-leak.ts
git commit -m "$(cat <<'EOF'
feat(profit-leak): sub-bid reality check — pure banded variance vs estimate scope

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Register `profitLeak` + `DailyFieldReport.leakScan`

**Files:**
- Modify: `utils/aiRateLimiterCore.ts`
- Modify: `types/index.ts`

- [ ] **Step 1: Add to the `AIFeature` union** — after the line `| 'projectReport'` (in the fast group, `utils/aiRateLimiterCore.ts:25`):

```ts
  | 'profitLeak'
```

- [ ] **Step 2: Add the `FEATURE_CONFIG` entry** — after the `projectReport:` line (`:65`), matching the existing fast-feature shape exactly:

```ts
  profitLeak:         { tier: 'fast', displayName: 'Profit Leak scan' },
```

(No `freeLifetimeCap`, no `proOnly` — free tier gets the standard fast daily quota; the wow moment is free, the daily cap prevents abuse. No paywall `AI_LIMITS` change: that table lists caps per tier, and no cap changes.)

- [ ] **Step 3: Add the additive field to `DailyFieldReport`** in `types/index.ts` — after `homeownerSummaryPublished?: boolean;`:

```ts
  /**
   * Profit Leak scan result — AI-flagged out-of-scope work, priced from the
   * learned cost book. Additive/LOCAL-ONLY: the daily_reports table has no
   * leak_scan column, so this persists via the local report store only and
   * must NOT be added to the supabaseWrite payloads in ProjectContext.
   */
  leakScan?: LeakScanRecord;
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && bun run test:gating && bun run test:ai-feature-gating`
Expected: tsc clean (`FEATURE_CONFIG` is `Record<AIFeature, …>`, so a missed entry fails compile); both gating validators pass (`profitLeak` is not proOnly, so the relay allowlist check does not apply to it).

- [ ] **Step 5: Commit**

```bash
git add utils/aiRateLimiterCore.ts types/index.ts
git commit -m "$(cat <<'EOF'
feat(profit-leak): register profitLeak fast feature + additive leakScan on DFR

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Daily-report scan UI + Draft-CO route (+ change-order token)

**Files:**
- Modify: `app/daily-report.tsx`
- Modify: `app/change-order.tsx`

> **Before writing:** re-read the Homeowner-update card (`app/daily-report.tsx:1349-1437`) and `makeHsStyles` (`:1972-2000`) — the new section mirrors that idiom exactly.

- [ ] **Step 1: Imports** in `app/daily-report.tsx`:

Add `ScanSearch` to the existing `lucide-react-native` import list (`:10-15`). Then add below the existing utils imports (`RefreshCw`, `AlertTriangle`, `CheckCircle2`, `Colors`, `MageAIMark`, `checkAILimit`, `recordAIUsage` are already imported):

```ts
import { buildCostDatabase } from '@/utils/costDatabase';
import { buildScopeSummary } from '@/utils/profitLeak/scopeSummary';
import { buildLeakPrompt, coerceLeakResult, hashLeakText, LEAK_SCHEMA_HINT } from '@/utils/profitLeak/leakPrompt';
import { priceLeakItems } from '@/utils/profitLeak/priceLeakItems';
import { mageAI } from '@/utils/mageAI';
```

and add `LeakScanRecord` to the existing `@/types` type import (`:35`).

- [ ] **Step 2: Hook up context + state.** Extend the `useProjects()` destructure (`:61-64`) with `projects, commitments, getChangeOrdersForProject,`. Add a styles hook next to the others (`:57-59`): `const leakStyles = useThemedStyles(makeLeakStyles);`. Add state below the homeowner-summary state block (`:126-128`):

```ts
const [leakScan, setLeakScan] = useState<LeakScanRecord | null>(existingReport?.leakScan ?? null);
const [leakScanning, setLeakScanning] = useState<boolean>(false);
```

- [ ] **Step 3: Handlers** — add after `handleGenerateHomeownerSummary` (`:525`):

```ts
// ─── Profit Leak scan ───
const currentLeakHash = useMemo(() => hashLeakText(workPerformed, issuesAndDelays), [workPerformed, issuesAndDelays]);
const leakIsStale = !!leakScan && leakScan.textHash !== currentLeakHash;

const handleLeakScan = useCallback(async () => {
  if (!project) return;
  if (!project.linkedEstimate?.items?.length) {
    Alert.alert('No estimate to compare against', 'The scan flags work outside your estimate scope. Link an estimate to this project first.');
    return;
  }
  if (!workPerformed.trim() && !issuesAndDelays.trim()) {
    Alert.alert('Nothing to scan yet', "Fill in the work performed (or issues) first — that's the text the scan reads.");
    return;
  }
  const limit = await checkAILimit(tier, 'fast', 'profitLeak');
  if (!limit.allowed) { setUpgradeLimit(limit); return; }

  setLeakScanning(true);
  try {
    const scope = buildScopeSummary(project, getChangeOrdersForProject(project.id));
    const hash = hashLeakText(workPerformed, issuesAndDelays);
    const res = await mageAI({
      prompt: buildLeakPrompt(scope, { workPerformed, issuesAndDelays, materialsDelivered }),
      tier: 'fast',
      maxTokens: 1200,
      feature: 'profitLeak',
      schemaHint: LEAK_SCHEMA_HINT,
      cacheKey: `leak_${stableReportId}_${hash}`,
      cacheHours: 720,   // result also persists on the report; cache is belt + suspenders
    });
    if (!res.success) {
      Alert.alert('Scan failed', res.error ?? 'Try again in a moment.');
      return;
    }
    const items = coerceLeakResult(res.data);
    const costDb = buildCostDatabase(projects, commitments);
    const record: LeakScanRecord = {
      items: priceLeakItems(items, costDb),
      scannedAt: new Date().toISOString(),
      textHash: hash,
    };
    setLeakScan(record);
    if (existingReport) updateDailyReport(existingReport.id, { leakScan: record });
    if (!res.fromCache) void recordAIUsage('fast', 'profitLeak');
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  } finally {
    setLeakScanning(false);
  }
}, [project, workPerformed, issuesAndDelays, materialsDelivered, tier, projects, commitments, getChangeOrdersForProject, existingReport, updateDailyReport, stableReportId]);

const handleDraftLeakCO = useCallback(() => {
  if (!projectId || !leakScan || leakScan.items.length === 0) return;
  const totalPriced = leakScan.items.reduce((s, it) => s + (it.estimatedPrice ?? 0), 0);
  const when = new Date(reportDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const description = `Out-of-scope work from daily report ${when}: ` +
    leakScan.items.map(it => `${it.description}${it.reportQuote ? ` ("${it.reportQuote}")` : ''}`).join('; ');
  router.push({
    pathname: '/change-order' as any,
    params: {
      projectId,
      prefillReason: 'out_of_scope',
      prefillDescription: description,
      prefillAmount: String(totalPriced),
    },
  });
}, [projectId, leakScan, reportDate, router]);
```

- [ ] **Step 4: Persist on save.** In `handleSave` (`:559`), add `leakScan: leakScan ?? undefined,` to BOTH branches — in the `updateDailyReport(existingReport.id, {...})` object after `homeownerSummaryPublished: hsPublished,` and in the new-`report` object after `homeownerSummaryPublished: hsPublished,`. Add `leakScan` to `handleSave`'s dependency array (`:653`).

- [ ] **Step 5: Render the section.** Insert a new section card AFTER the Issues & Delays section card closes (`:1342`, the `</View>` right before the Homeowner-update comment):

```tsx
{/* Profit Leak — scan today's notes against the estimate scope for
    unbilled out-of-scope work. AI identifies; the cost book prices. */}
<View style={styles.sectionCard}>
  <View style={styles.sectionHeader}>
    <ScanSearch size={18} color={themeColors.accent} strokeWidth={1.75} />
    <Text style={styles.sectionTitle}>Profit Leak</Text>
    {leakScan && !leakIsStale && (
      <View style={[leakStyles.badge, leakScan.items.length > 0 ? leakStyles.badgeFlags : leakStyles.badgeClean]}>
        <Text style={[leakStyles.badgeText, leakScan.items.length > 0 ? leakStyles.badgeTextFlags : leakStyles.badgeTextClean]}>
          {leakScan.items.length > 0 ? `${leakScan.items.length} ${leakScan.items.length === 1 ? 'FLAG' : 'FLAGS'}` : 'SCANNED ✓'}
        </Text>
      </View>
    )}
  </View>
  <Text style={leakStyles.helperText}>
    Scans today&apos;s notes against the estimate scope and prior change orders. Flags work you haven&apos;t billed — priced from your own cost history.
  </Text>

  <TouchableOpacity
    style={[leakStyles.scanBtn, leakScanning && leakStyles.scanBtnDisabled]}
    onPress={handleLeakScan}
    disabled={leakScanning}
    testID="leak-scan"
  >
    {leakScanning ? (
      <>
        <RefreshCw size={14} color={themeColors.accent} strokeWidth={1.75} />
        <Text style={leakStyles.scanBtnText}>Reading today&apos;s report…</Text>
      </>
    ) : (
      <>
        <MageAIMark size={14} color={themeColors.accent} />
        <Text style={leakStyles.scanBtnText}>
          {leakScan ? (leakIsStale ? 'Notes changed — re-scan' : 'Re-scan for unbilled work') : 'Scan for unbilled work'}
        </Text>
      </>
    )}
  </TouchableOpacity>

  {leakScan && leakScan.items.length === 0 && (
    <View style={leakStyles.cleanRow}>
      <CheckCircle2 size={16} color={themeColors.success} strokeWidth={1.75} />
      <Text style={leakStyles.cleanText}>Nothing out of scope detected in this report.</Text>
    </View>
  )}

  {leakScan && leakScan.items.length > 0 && (
    <View style={leakStyles.resultBlock}>
      {leakScan.items.map((item, i) => (
        <View key={i} style={leakStyles.itemRow}>
          <AlertTriangle size={14} color={Colors.warning} strokeWidth={1.75} style={{ marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <Text style={leakStyles.itemDesc}>{item.description}</Text>
            {!!item.reportQuote && <Text style={leakStyles.itemQuote}>&ldquo;{item.reportQuote}&rdquo;</Text>}
            <Text style={leakStyles.itemMeta}>
              {item.trade} · {item.estimatedPrice !== null
                ? `~$${item.estimatedPrice.toLocaleString('en-US')} from your cost history`
                : 'No price history — price it yourself'} · {item.confidence} confidence
            </Text>
          </View>
        </View>
      ))}
      <TouchableOpacity style={leakStyles.draftCoBtn} onPress={handleDraftLeakCO} testID="leak-draft-co">
        <Text style={leakStyles.draftCoBtnText}>
          {(() => {
            const t = leakScan.items.reduce((s, it) => s + (it.estimatedPrice ?? 0), 0);
            return t > 0 ? `Draft change order · ~$${t.toLocaleString('en-US')}` : 'Draft change order';
          })()}
        </Text>
      </TouchableOpacity>
    </View>
  )}
</View>
```

- [ ] **Step 6: Styles factory** — add next to `makeHsStyles` (`:1972`):

```ts
const makeLeakStyles = (themeColors: ThemeColors) => StyleSheet.create({
  helperText: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginBottom: 10, lineHeight: 17 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full, marginLeft: 'auto' },
  badgeClean: { backgroundColor: 'rgba(30,142,74,0.12)' },
  badgeFlags: { backgroundColor: 'rgba(233,168,38,0.16)' },
  badgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  badgeTextClean: { color: themeColors.success },
  badgeTextFlags: { color: Colors.warning },
  scanBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 11, borderRadius: 11,
    backgroundColor: themeColors.accent + '0F', borderWidth: 1, borderColor: themeColors.accent + '40',
  },
  scanBtnDisabled: { opacity: 0.7 },
  scanBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: themeColors.accent },
  cleanRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  cleanText: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.text },
  resultBlock: { marginTop: 12, gap: 10 },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  itemDesc: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: themeColors.text },
  itemQuote: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary, fontStyle: 'italic', marginTop: 2 },
  itemMeta: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginTop: 2 },
  draftCoBtn: { marginTop: 4, paddingVertical: 11, borderRadius: 11, alignItems: 'center', backgroundColor: themeColors.accent },
  draftCoBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: '#FFFFFF' },
});
```

- [ ] **Step 7: Teach change-order the `out_of_scope` token** (`app/change-order.tsx`). Two additive edits:

Edit A — the reason mapping (`:126-132`), old:

```ts
      prefillReason === 'allowance_overage' ? 'Allowance overage'
      : prefillReason === 'client_request' ? 'Client request'
      : ''
```

new:

```ts
      prefillReason === 'allowance_overage' ? 'Allowance overage'
      : prefillReason === 'client_request' ? 'Client request'
      : prefillReason === 'out_of_scope' ? 'Out-of-scope work (from daily report)'
      : ''
```

Edit B — the seed line name (`:142`), old:

```ts
        name: 'Allowance overage',
```

new:

```ts
        name: prefillReason === 'out_of_scope' ? 'Out-of-scope work' : 'Allowance overage',
```

- [ ] **Step 8: Verify**

Run: `npx tsc --noEmit && bun run lint && bun run test:app-slop`
Expected: all clean (`ScanSearch` exists in lucide-react-native; no emoji icons, no banned hex).

- [ ] **Step 9: Commit**

```bash
git add app/daily-report.tsx app/change-order.tsx
git commit -m "$(cat <<'EOF'
feat(profit-leak): scan-for-unbilled-work on daily report + draft-CO prefill route

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Sub-bid check on commitment save (job-costing)

**Files:**
- Modify: `app/job-costing.tsx`

- [ ] **Step 1: Imports + wiring.** Add:

```ts
import { checkSubBid, type SubBidVerdict } from '@/utils/profitLeak/subBidCheck';
import { buildCostDatabase } from '@/utils/costDatabase';
```

Extend the `useProjects()` destructure (`:74-77`) with `projects,`. In `JobCostingInner`, add below the `projectCommitments` memo (`:87-90`):

```ts
const costDb = useMemo(() => buildCostDatabase(projects, commitments), [projects, commitments]);
const [bidCheck, setBidCheck] = useState<SubBidVerdict | null>(null);
```

(`AlertTriangle` and `X` are already imported for the over-committed warning and modal close; verify, add if missing.)

- [ ] **Step 2: Hook the save.** Replace the `onSave` prop of `<CommitmentEditor>` (`:339-344`), old:

```tsx
        onSave={(c, isNew) => {
          if (isNew) addCommitment(c); else updateCommitment(c.id, c);
          setShowAdd(false);
          setEditingCommitment(null);
          if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }}
```

new:

```tsx
        onSave={(c, isNew) => {
          if (isNew) addCommitment(c); else updateCommitment(c.id, c);
          // Sub-bid reality check — pure math, never blocks the save (it already
          // happened). Merge over the pre-edit record: the editor modal doesn't
          // carry csiDivision/linkedEstimateItems, but the store keeps them.
          const merged: Commitment = editingCommitment ? { ...editingCommitment, ...c } : c;
          const verdict = checkSubBid(merged, project, costDb);
          const flagged = verdict.verdict === 'low' || verdict.verdict === 'high';
          setBidCheck(flagged ? verdict : null);
          setShowAdd(false);
          setEditingCommitment(null);
          if (Platform.OS !== 'web') {
            void Haptics.notificationAsync(
              flagged ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success,
            );
          }
        }}
```

(`project` is non-null here — the `if (!project)` early return at `:108` narrows it for the rest of the component.)

- [ ] **Step 3: Render the banner** — insert directly AFTER the projection banner block (the `View` with `styles.banner`, closes around `:196`), so the warning is the first thing visible post-save:

```tsx
{/* Sub-bid reality check — non-blocking, dismissible. 'fair'/'unknown' stay silent. */}
{bidCheck && (
  <View style={[styles.section, styles.warningSection]} testID="sub-bid-check-banner">
    <View style={styles.warningHeader}>
      <AlertTriangle size={14} color={bidCheck.verdict === 'low' ? themeColors.danger : Colors.warning} strokeWidth={1.75} />
      <Text style={styles.warningTitle}>
        {bidCheck.verdict === 'low' ? 'Bid looks low — check the scope' : 'Bid looks high'}
      </Text>
      <TouchableOpacity onPress={() => setBidCheck(null)} hitSlop={8} style={{ marginLeft: 'auto' }} accessibilityRole="button" accessibilityLabel="Dismiss">
        <X size={14} color={themeColors.textMuted} strokeWidth={1.75} />
      </TouchableOpacity>
    </View>
    <Text style={styles.warningItem}>{bidCheck.detail}</Text>
  </View>
)}
```

(Reuses the existing `warningSection`/`warningHeader`/`warningTitle`/`warningItem` styles — no new styles needed. State-driven banner, not `Alert.alert`, because RN-web's `Alert.alert` is a no-op — this screen already uses `confirm()` there for the same reason.)

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && bun run lint && bun run test:app-slop`
Expected: all clean. (`Commitment` type is already imported in this file for `CommitmentEditor`; if the type import is missing at the top, add it to the existing `@/types` import.)

- [ ] **Step 5: Commit**

```bash
git add app/job-costing.tsx
git commit -m "$(cat <<'EOF'
feat(profit-leak): sub-bid reality check banner on commitment save

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Full ship-check + review

- [ ] **Step 1: Run the full gate**

Run: `bun run ship-check`
Expected: EXIT 0 — typecheck + lint + the whole validator suite including `test:profit-leak` (`57 passed, 0 failed`).

- [ ] **Step 2: Review checklist** (fix + commit anything found):

- `git grep -n "leak_scan" contexts/ utils/offlineQueue.ts` → MUST return nothing (no supabase column writes).
- `git grep -n "leakScan" contexts/` → MUST return nothing (persistence rides the generic `Partial<DailyFieldReport>` merge; no context change needed).
- In `app/daily-report.tsx`: `handleSave` deps include `leakScan`; both save branches carry `leakScan: leakScan ?? undefined`.
- Every dollar in the UI traces to `priceLeakItems`/`checkSubBid` output — no model-originated number rendered anywhere.
- `coerceLeakResult` is applied to `res.data` before pricing (never trust raw model JSON).
- Change-order deep link: from a scan result, "Draft change order" lands with reason "Out-of-scope work (from daily report)", the description, and a seeded `Out-of-scope work` line at the priced total (manually trace the params against `app/change-order.tsx:123-152`).

- [ ] **Step 3:** Branch is ready for the adversarial-review workflow (money-math + prompt-grounding verification) before merge. Deploy (merge + OTA) stays owner-gated.

---

## Self-Review

**Spec coverage:** scope summary w/ grouping + CO inclusion + cap → Task 1. Prompt + LeakScanResult/LeakItem + schemaHint + grounding rules → Task 2 (types placed in `types/index.ts` — see File Structure note). Deterministic pricing, null-when-no-history → Task 3. checkSubBid basis A/B, 0.85/1.30 bands, unknown fallback, never-throws → Task 4. `profitLeak` registration + additive `leakScan?` → Task 5. On-demand scan button, 1 fast call, cacheKey `leak_<reportId>_<hash>`, result card with quote + $-or-no-history + Draft CO prefill route, persisted record + scanned/flags badge → Task 6. Save-time check, non-blocking banner, silent on fair/unknown → Task 7. Single validator in ship-check + tsc + anti-slop → Tasks 1–4, 8. Out-of-scope items (vision, batch, auto-scan, Brain Watch, programmatic CO) untouched. **No gaps.**

**Placeholder scan:** every code step contains complete, real code; commands carry exact expected outputs (validator counts 10/28/37/57 match the `expect()` calls per task).

**Type consistency:** `LeakItem`/`PricedLeakItem`/`LeakScanRecord`/`LeakConfidence` defined once in Task 2 and consumed identically in Tasks 3, 5, 6. `SubBidVerdict`/`LOW_BAND`/`HIGH_BAND` defined in Task 4, consumed in Task 7. `LEAK_SCHEMA_HINT` keys = `LeakItem` fields = `coerceLeakResult` output keys (same order for the JSON-equality test). `prefillReason: 'out_of_scope'` token matches both edits in Task 6 Step 7. `hashLeakText` signature identical in Tasks 2 and 6.
