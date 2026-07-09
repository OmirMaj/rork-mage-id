# Scan Anything → Auto-File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One capture entry that AI-classifies a document or item, extracts its structured fields, and auto-files it into the right `project-documents` folder plus (for high-value types) the matching domain record — logged in a `scan_records` audit table.

**Architecture:** Client captures 1–N shots (`expo-image-picker`, base64) → a new Deno edge fn `scan-anything` (Gemini) classifies `docType`, extracts type-specific fields, and suggests a destination → a confirm screen (`app/scan.tsx`) → a **pure** `utils/scanRouting.ts` resolves the destination → the app uploads the image via `uploadProjectFile` and creates/updates the domain record, then logs a `ScanRecord`. Government IDs are classified but **never extracted here** — they redirect to the consented crew ID-scan flow.

**Tech Stack:** Expo/React Native, TypeScript strict, Deno edge functions, Gemini (`gemini-2.5-flash`), `expo-image-picker` (already installed). No barcode/native module — OTA-safe.

**Conventions:** bun; `npx tsc --noEmit`; NO jest — pure-fn validators via `scripts/validate-*.ts` in `bun run ship-check`; all Supabase writes via `supabaseWrite`; types in `types/index.ts`; contexts via `createContextHook` under `ProjectProvider`; tier gating via `useTierAccess` + server `requireTier` + `MONTHLY_CAPS`; amber + `lucide-react-native` + `useThemedStyles`. Branch `claude/scheduler-import-scanner` — commit per task; do NOT merge/deploy; **the migration is written, NOT applied.**

---

## File Structure

| File | Responsibility |
|---|---|
| `types/index.ts` | `ScanDocType`, `ScanRecordKind`, `ScanDestination`, `ScanRecord`. |
| `utils/scanRouting.ts` | **Pure** routing: `resolveDestination(docType)`, `defaultTitleFor`. Exhaustive over the union. |
| `scripts/validate-scan-routing.ts` | Pure validator → ship-check. |
| `supabase/functions/scan-anything/index.ts` | Deno edge fn: Gemini classify + type-specific extract + gov-id short-circuit. Business-gated, metered. |
| `supabase/functions/_shared/auth.ts` | Add `scan_anything` to `MONTHLY_CAPS`. |
| `hooks/useTierAccess.ts` | `FeatureKey` `'scan_anything'` → `business`. |
| `supabase/migrations/20260709120000_scan_records.sql` | `scan_records` table + RLS + trigger. **Written, not applied.** |
| `supabase/schema.sql` | Mirror the table. |
| `contexts/ScanContext.tsx` | `createContextHook` — recent scans, hydrate (tenant-safe), `addScan`. |
| `app/_layout.tsx` | Mount `ScanProvider` under `ProjectProvider`; register `scan` route. |
| `app/scan.tsx` | Capture → invoke → confirm → commit (upload + record + log). |
| `app/project-detail.tsx`, `app/(tabs)/discover/tools.tsx` | Scan entry points (FAB + tile). |

**Build order:** pure core (T1–T3) → edge fn (T4) → gating (T5) → migration (T6) → context (T7) → screen (T8) → entry points + route (T9) → gate (T10).

---

## Task 1: Domain types

**Files:** Modify `types/index.ts` (near the other `tertiary_*` domain types).

- [ ] **Step 1: Add types**

```ts
// ─── Scan Anything → auto-file ────────────────────────────────────────────
export type ScanDocType =
  | 'invoice' | 'delivery_ticket' | 'permit' | 'insurance_coi' | 'contract'
  | 'business_card' | 'spec_sheet' | 'equipment_nameplate' | 'material_tag'
  | 'warranty' | 'inspection_notice' | 'plan_sheet' | 'government_id' | 'other';
export type ScanRecordKind = 'cost' | 'contact' | 'sub_compliance' | 'file_only';
export interface ScanDestination { folder: string; recordKind: ScanRecordKind }
export interface ScanRecord {
  id: string; userId: string; projectId: string;
  docType: ScanDocType; title: string;
  fields: Record<string, unknown>;
  filePath: string;
  recordKind: ScanRecordKind; linkedRecordId?: string;
  createdAt: string;
}
```

- [ ] **Step 2:** `npx tsc --noEmit` = 0. **Step 3:** Commit `types(scan): ScanDocType, ScanRecord, ScanDestination`.

---

## Task 2: Pure routing `utils/scanRouting.ts` (validator-first)

**Files:** Create `utils/scanRouting.ts`. Reference: `utils/projectFiles.ts` (the six default folders: `plans, contracts, photos, permits, closeout, daily-reports`).

- [ ] **Step 1: Write the routing table (exhaustive)**

```ts
import type { ScanDocType, ScanDestination } from '@/types';

// Exhaustive: `satisfies` forces a compile error if a docType is missing.
const ROUTING = {
  invoice:            { folder: 'financials',    recordKind: 'cost' },
  delivery_ticket:    { folder: 'daily-reports', recordKind: 'file_only' },
  permit:             { folder: 'permits',       recordKind: 'file_only' },
  insurance_coi:      { folder: 'contracts',     recordKind: 'sub_compliance' },
  contract:           { folder: 'contracts',     recordKind: 'file_only' },
  business_card:      { folder: 'photos',        recordKind: 'contact' },
  spec_sheet:         { folder: 'plans',         recordKind: 'file_only' },
  plan_sheet:         { folder: 'plans',         recordKind: 'file_only' },
  equipment_nameplate:{ folder: 'photos',        recordKind: 'file_only' },
  material_tag:       { folder: 'photos',        recordKind: 'file_only' },
  warranty:           { folder: 'closeout',      recordKind: 'file_only' },
  inspection_notice:  { folder: 'photos',        recordKind: 'file_only' },
  government_id:      { folder: 'photos',        recordKind: 'file_only' }, // never reached (redirect)
  other:              { folder: 'photos',        recordKind: 'file_only' },
} satisfies Record<ScanDocType, ScanDestination>;

export function resolveDestination(docType: ScanDocType): ScanDestination {
  return ROUTING[docType] ?? ROUTING.other;
}

export function defaultTitleFor(docType: ScanDocType, fields: Record<string, unknown>): string {
  const s = (k: string) => (typeof fields[k] === 'string' ? (fields[k] as string) : '');
  switch (docType) {
    case 'invoice': return s('vendor') ? `Invoice — ${s('vendor')}` : 'Invoice';
    case 'permit': return s('permitNumber') ? `Permit ${s('permitNumber')}` : 'Permit';
    case 'insurance_coi': return s('insured') ? `COI — ${s('insured')}` : 'Certificate of Insurance';
    case 'business_card': return s('name') || s('company') || 'Business Card';
    case 'delivery_ticket': return s('supplier') ? `Delivery — ${s('supplier')}` : 'Delivery Ticket';
    case 'warranty': return s('product') ? `Warranty — ${s('product')}` : 'Warranty';
    case 'equipment_nameplate': return [s('make'), s('model')].filter(Boolean).join(' ') || 'Equipment';
    case 'material_tag': return s('product') || s('sku') || 'Material';
    default: return docType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
}
```

- [ ] **Step 2:** `npx tsc --noEmit` = 0. **Step 3:** Commit `feat(scan): pure docType→destination routing + title fallback`.

---

## Task 3: Validator `scripts/validate-scan-routing.ts`

**Files:** Create `scripts/validate-scan-routing.ts`; append `bun run scripts/validate-scan-routing.ts` to `ship-check` in `package.json`.

- [ ] **Step 1: Write it**

```ts
import { resolveDestination, defaultTitleFor } from '@/utils/scanRouting';
import type { ScanDocType } from '@/types';
let failed = 0; const assert = (c: boolean, m: string) => { if (!c) { console.error('✗', m); failed++; } };

const ALL: ScanDocType[] = ['invoice','delivery_ticket','permit','insurance_coi','contract','business_card','spec_sheet','equipment_nameplate','material_tag','warranty','inspection_notice','plan_sheet','government_id','other'];
const FOLDERS = new Set(['plans','contracts','photos','permits','closeout','daily-reports','financials']);
const KINDS = new Set(['cost','contact','sub_compliance','file_only']);

for (const dt of ALL) {
  const d = resolveDestination(dt);
  assert(FOLDERS.has(d.folder), `${dt} folder ${d.folder} is known`);
  assert(KINDS.has(d.recordKind), `${dt} recordKind valid`);
  assert(defaultTitleFor(dt, {}).length > 0, `${dt} non-empty title`);
}
assert(resolveDestination('invoice').recordKind === 'cost', 'invoice→cost');
assert(resolveDestination('business_card').recordKind === 'contact', 'card→contact');
assert(resolveDestination('insurance_coi').recordKind === 'sub_compliance', 'coi→sub');
assert(resolveDestination('government_id').recordKind === 'file_only', 'gov id never extracts (file_only fallback)');
assert(defaultTitleFor('invoice', { vendor: 'ABC Supply' }) === 'Invoice — ABC Supply', 'invoice title');

if (failed) { console.error(`\n${failed} scan-routing checks failed`); process.exit(1); }
console.log('✓ scan-routing validator passed');
```

- [ ] **Step 2:** `bun run scripts/validate-scan-routing.ts` → passes. **Step 3:** wire into ship-check; `bun run ship-check` = ALL PASS. **Step 4:** Commit `test(scan): routing validator wired into ship-check`.

---

## Task 4: Edge function `scan-anything`

**Files:** Create `supabase/functions/scan-anything/index.ts`. Reference: `analyze-photos/index.ts` (CORS, `requireTier`, meter, Gemini multi-image call, size guards) and `scan-credential/index.ts` (never echo raw PII in errors).

**Contract:** input `{ images: {base64:string, mimeType?:string}[], projectId: string }`; output `{ docType, confidence, fields, suggestedTitle, suggestedDestination:{folder,recordKind}, redirect? }`.

- [ ] **Step 1** Scaffold + `requireTier(req, ['business'], 'scan_anything')` + validate `images` (1–6, per-image + total size caps mirroring `analyze-photos`).
- [ ] **Step 2** Meter after validation, before Gemini: `aiUsageIncrement(userId,'scan_anything')` vs `MONTHLY_CAPS[tier].scan_anything` → 429 if over.
- [ ] **Step 3** **Classify** call — Gemini returns `{ docType, confidence }` constrained to the `ScanDocType` union; `<50` confidence → `docType:'other'`.
- [ ] **Step 4** **Gov-ID short-circuit** — if `docType === 'government_id'`: return `{ docType:'government_id', confidence, fields:{}, suggestedTitle:'Government ID', suggestedDestination:{folder:'photos',recordKind:'file_only'}, redirect:'crew-id-scan' }` — NO extraction.
- [ ] **Step 5** **Extract** call — switch prompt by `docType` using the field schemas in the spec §6; try/catch `JSON.parse`; on failure return empty `fields:{}` (never raw text). Compute `suggestedTitle` server-side is optional — the client's `defaultTitleFor` covers it; return the AI title if present.
- [ ] **Step 6** Return the contract object. **Step 7** Commit `feat(scan): scan-anything edge fn (classify + extract + gov-id redirect)`.

---

## Task 5: Tier gating + caps

**Files:** `hooks/useTierAccess.ts` (`'scan_anything'` → `business`); `_shared/auth.ts` `MONTHLY_CAPS` (`scan_anything`: `free:0, pro:0, business:120, enterprise:300`).

- [ ] **Step 1** FeatureKey. **Step 2** caps. **Step 3** `npx tsc --noEmit` = 0. **Step 4** Commit `feat(scan): Business-tier gate + monthly caps`.

---

## Task 6: Migration `scan_records` (WRITTEN, NOT APPLIED)

**Files:** Create `supabase/migrations/20260709120000_scan_records.sql`; mirror in `supabase/schema.sql`. Reference the `wip_periods` migration for the RLS + `update_updated_at_column` trigger pattern.

- [ ] **Step 1: Write the migration**

```sql
-- scan_records: audit log of Scan-Anything captures. Additive, owner-scoped.
CREATE TABLE IF NOT EXISTS public.scan_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  file_path TEXT NOT NULL DEFAULT '',
  record_kind TEXT NOT NULL DEFAULT 'file_only',
  linked_record_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scan_records_user ON public.scan_records(user_id);
CREATE INDEX IF NOT EXISTS idx_scan_records_project ON public.scan_records(project_id);
ALTER TABLE public.scan_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scan_records_select_own" ON public.scan_records FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "scan_records_insert_own" ON public.scan_records FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "scan_records_update_own" ON public.scan_records FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "scan_records_delete_own" ON public.scan_records FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER scan_records_updated_at BEFORE UPDATE ON public.scan_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
```

- [ ] **Step 2** Mirror in `schema.sql`. **Step 3** Do NOT apply. **Step 4** Commit `feat(scan): scan_records migration + schema mirror (apply is an owner step)`.

---

## Task 7: `ScanContext`

**Files:** Create `contexts/ScanContext.tsx`; mount `<ScanProvider>` under `ProjectProvider` in `app/_layout.tsx`. Reference `contexts/WipContext.tsx` (hydrate-from-Supabase + tenant-safe key + clear-on-userId-change pattern).

- [ ] **Step 1** `createContextHook` exposing `{ scans: ScanRecord[], addScan(r), refresh() }`. Hydrate from `scan_records` (snake→camel + `saveLocal` + `setState`; fall back to AsyncStorage on error/!canSync). Namespaced key `tertiary_scan_records`. Clear on `userId` change. `addScan` → optimistic local + `supabaseWrite('scan_records','insert', toRow(record))`.
- [ ] **Step 2** `npx tsc --noEmit` = 0. **Step 3** Commit `feat(scan): ScanContext (hydrated, tenant-safe) + provider wiring`.

---

## Task 8: Scan screen `app/scan.tsx`

**Files:** Create `app/scan.tsx`. Reference `app/crew.tsx` (image-picker capture + base64), `app/material-receipt.tsx` (receipt capture flow), `utils/projectFiles.ts` (`uploadProjectFile`), `utils/scanRouting.ts`, `contexts/ScanContext.tsx`, `hooks/useTierAccess.ts`.

- [ ] **Step 1** Gate with `useTierAccess('scan_anything')` → Paywall if not Business.
- [ ] **Step 2** Flow: optional project picker (if entered globally) → capture 1–N shots (`ImagePicker.launchCameraAsync`/`launchImageLibraryAsync`, `base64:true`) → `invoke('scan-anything', { images, projectId })` (loading).
- [ ] **Step 3** Confirm card: big `docType` label + confidence; **editable** extracted `fields`; the resolved destination via `resolveDestination(docType)` ("Files to *Permits* · creates a *Contact*"); image thumbnails. If `redirect === 'crew-id-scan'`: show a redirect card ("This looks like an ID — use the crew ID scan, which asks consent and never stores the number") with a button to `router.push('/crew')`; no save.
- [ ] **Step 4** **Save** → `uploadProjectFile(projectId, destination.folder, blob, filename)` → then by `recordKind`: `cost` → create a material/cost entry (reference `app/material-receipt.tsx`'s save path); `contact` → create a Contact (reference the contacts create path); `sub_compliance` → attach to the sub-documents/compliance path; `file_only` → nothing extra. Then `addScan({...ScanRecord, filePath, recordKind, linkedRecordId})`. If upload fails, still `addScan` with `filePath:''` and skip the domain record. Toast + "Scan another" / done.
- [ ] **Step 5** `npx tsc --noEmit` = 0; `bun run lint` = 0. **Step 6** Commit `feat(scan): scan capture + confirm + auto-file screen`.

---

## Task 9: Entry points + route

**Files:** `app/_layout.tsx` (register `<Stack.Screen name="scan" options={{ presentation:'modal', title:'Scan' }} />`); `app/project-detail.tsx` (a Scan FAB/tile → `/scan?projectId=`); `app/(tabs)/discover/tools.tsx` (a Business-gated "Scan Anything" tile → `/scan`).

- [ ] **Step 1** Route. **Step 2** FAB/tile on project-detail. **Step 3** Tools tile (lucide `ScanLine`, amber, `tone:'warning'`, `testID="tools-scan"`). **Step 4** `npx tsc --noEmit` = 0. **Step 5** Commit `feat(scan): entry points (project FAB + Tools tile) + route`.

---

## Task 10: Final gate

- [ ] **Step 1** `npx tsc --noEmit` = 0. **Step 2** `bun run lint` = 0. **Step 3** `bun run ship-check` = ALL PASS. **Step 4** Simulator screenshots: capture step, confirm card (invoice + business card + a gov-id redirect), and a destination folder showing the filed doc. **Step 5** Commit `chore(scan): final gate green`.

---

## Self-Review notes (author)
- **Spec coverage:** edge fn (T4), types (T1), routing (T2/T3), context (T7), screen (T8), migration (T6), gating (T5), entry+route (T9), PII gov-id boundary (T4 §4 + T8 §3). All spec §5 components mapped.
- **Type consistency:** `ScanDocType`/`ScanRecordKind`/`ScanDestination`/`ScanRecord` defined T1, consumed identically T2/T4/T7/T8. `resolveDestination` signature stable T2→T3→T8.
- **PII boundary enforced twice:** edge fn refuses to extract `government_id` (T4 §4) and the screen shows a redirect card (T8 §3).
- **Deferred (per spec):** asset register, barcode/QR (native), batch multi-doc, delivery→DFR auto-append.
- **Verify at build time:** exact contacts / material-cost / sub-compliance create functions (T8 §4) — read the live screens and reuse their save paths; the six default folder names (T2) — confirm against `utils/projectFiles.ts`.
```
