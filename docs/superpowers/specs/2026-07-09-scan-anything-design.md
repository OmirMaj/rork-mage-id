# Scan Anything → Auto-File — Design

**Status:** Approved (design), pending spec review.
**Goal:** One camera button, anywhere on a jobsite. Snap a document or an item → AI identifies **what it is** → extracts the structured data for that type → routes it to the right place in MAGE (the correct project-files folder **and**, where one exists, the matching domain record), with a quick confirm step. Turns any jobsite photo into a filed, structured, actionable record.

**Tier:** Business (AI-vision cost; power feature). Metered `scan_anything` monthly cap.

---

## 1. Why this is differentiated

MAGE already has many **siloed** AI extractors (receipts, IDs, plans, spec books, codes, site-photo triage) and a per-project document vault (`project-documents` bucket + `app/project-files.tsx`). What's missing is a **single universal entry point**: today you must know in advance "this is a receipt" and navigate to that flow. Nothing lets you point the camera at *whatever's in your hand* and have MAGE classify, extract, and file it. That "scan anything → it just lands in the right place" loop is the unique, powerful wedge — and it reuses infrastructure that already exists.

## 2. Scope

**In scope (v1):**
- One capture entry (single or multi-shot) via `expo-image-picker` (reuses the existing `utils/photoAnalyzer.ts` encode pipeline).
- New edge fn `scan-anything`: **classify** the `docType`, then **extract** type-specific fields, then **suggest** a destination + title.
- Confirm screen (`app/scan.tsx`): editable fields + suggested destination + the image; user confirms/adjusts.
- On confirm: **file** the image (or assembled PDF) into `project-documents/<projectId>/<folder>` via `uploadProjectFile`, **and** create/update the matching domain record for the high-value types.
- Log every scan in a `scan_records` table (auditable, re-openable).

**v1 routing targets (domain records):** `invoice` → material/cost log; `business_card` → contact; `insurance_coi` → subcontractor compliance doc; `permit` → files (permits folder) + note. Every other recognized type → filed to the right folder + tagged (searchable), no domain record yet.

**Out of scope (deferred):**
- **Barcode / QR scanning** — needs `expo-camera` (native module) = a new build, not OTA. Deferred to a native-build phase. (Nameplate/serial/tag *text* is still readable from a photo via Gemini, OTA-safe.)
- **Equipment / asset register** — the natural next destination; deferred to phase 2.
- **Batch multi-document** dump-and-route (like `analyze-photos` triage but for docs) — phase 2.
- **General OCR** of arbitrary text — not needed; Gemini structured extraction covers the target types.

## 3. The PII boundary (important)

If `scan-anything` classifies an image as a **`government_id`**, it must **NOT** extract or return ID fields. It returns `docType: 'government_id'` with a `redirect: 'crew-id-scan'` hint, and the confirm screen routes the user to the existing consented crew ID-scan flow (`app/crew.tsx` → `scan-credential`), which has the consent gate + extract-then-purge + masked-last-4 discipline. This keeps all government-ID handling inside the one audited, consented path — the universal scanner never becomes a side-door around it. Business cards / COIs contain ordinary business contact + insurance info (not government IDs) and are handled normally.

## 4. Architecture

```
[Scan] entry (project-detail FAB / Tools tile)  →  app/scan.tsx
        │  pick project (if entered globally); capture 1..N shots (expo-image-picker, base64)
        ▼
  supabase.functions.invoke('scan-anything', { images:[{base64,mimeType}], projectId })
        │
   ┌────┴─────────────────────────────────────────────────────────────┐
   │ Deno edge fn: scan-anything  (Business-gated, metered)            │
   │  1. requireTier(['business']) ; validate images ; meter after     │
   │  2. Gemini CLASSIFY → { docType, confidence }                     │
   │  3. if docType==='government_id' → return {docType, redirect}     │
   │     else EXTRACT with the type-specific schema → fields           │
   │  4. suggest title + destination (folder + recordKind)             │
   │  5. return { docType, confidence, fields, title, destination }    │
   └────┬─────────────────────────────────────────────────────────────┘
        ▼
  app/scan.tsx confirm: docType + editable fields + destination + image
        │  user confirms/edits
        ▼
  utils/scanRouting.ts  resolveDestination(docType) → { folder, recordKind }
        │
        ├─► uploadProjectFile(projectId, folder, image/pdf)          (always)
        ├─► create/update domain record by recordKind                (v1: invoice/contact/coi/permit)
        └─► supabaseWrite('scan_records','insert', ScanRecord)        (audit log)
```

**OTA-safe:** capture + Gemini only; no barcode/native module. `expo.version` unchanged.

## 5. Components (files)

### 5.1 `supabase/functions/scan-anything/index.ts` (new, Deno, Gemini)
- `requireTier(req, ['business'], 'scan_anything')`; validate `images` (1–6, size caps like `analyze-photos`); `aiUsageIncrement` + `MONTHLY_CAPS[tier].scan_anything` **after** validation, **before** Gemini.
- **Classify prompt:** returns one `docType` from the taxonomy (§6) + `confidence` (0–100). Low confidence (<50) → `docType: 'other'`.
- **Extract prompt:** switched by `docType`, reusing the field schemas MAGE already knows (invoice mirrors `analyze-photos` `receipt`; COI mirrors `scan-credential` `certification` shape; business_card = name/company/title/phone/email/address). Returns a flat `fields` object.
- **government_id short-circuit:** classify only, no extraction, `redirect: 'crew-id-scan'`.
- `try/catch` the Gemini `json()`; never echo raw model text or PII in error bodies (mirrors `scan-credential`). SSRF `urlGuard` if any image is passed by URL (v1 uses inline base64 → no fetch).
- **Output:** `{ docType, confidence, fields, suggestedTitle, suggestedDestination: { folder, recordKind } , redirect? }`. Server persists nothing.

### 5.2 `types/index.ts` additions
```ts
type ScanDocType =
  | 'invoice' | 'delivery_ticket' | 'permit' | 'insurance_coi' | 'contract'
  | 'business_card' | 'spec_sheet' | 'equipment_nameplate' | 'material_tag'
  | 'warranty' | 'inspection_notice' | 'plan_sheet' | 'government_id' | 'other';
type ScanRecordKind = 'cost' | 'contact' | 'sub_compliance' | 'file_only';
interface ScanDestination { folder: string; recordKind: ScanRecordKind }
interface ScanRecord {
  id: string; userId: string; projectId: string;
  docType: ScanDocType; title: string;
  fields: Record<string, unknown>;         // extracted, user-edited
  filePath: string;                         // project-documents path
  recordKind: ScanRecordKind; linkedRecordId?: string;  // e.g. created contact/cost id
  createdAt: string;
}
```

### 5.3 `utils/scanRouting.ts` (new, PURE — validator-tested)
- `resolveDestination(docType: ScanDocType): ScanDestination` — the single routing table:
  | docType | folder | recordKind |
  |---|---|---|
  | invoice | `financials`† | `cost` |
  | delivery_ticket | `daily-reports` | `file_only` (v1) |
  | permit | `permits` | `file_only` |
  | insurance_coi | `contracts` | `sub_compliance` |
  | contract | `contracts` | `file_only` |
  | business_card | `photos` | `contact` |
  | spec_sheet / plan_sheet | `plans` | `file_only` |
  | equipment_nameplate / material_tag | `photos` | `file_only` (asset record = phase 2) |
  | warranty | `closeout` | `file_only` |
  | inspection_notice / other | `photos` | `file_only` |
  † `financials` is not one of the six default project folders — `project-documents` auto-creates custom folders on first write (per `utils/projectFiles.ts`), so this is intentional. Business cards attach the image to `photos` and create a Contact record (no per-project "contacts" folder needed).
- `defaultTitleFor(docType, fields)` — deterministic title fallback if the AI title is empty.
- Pure + exhaustive over the union (compile-time `satisfies Record<ScanDocType, ...>`), so the validator asserts every type routes somewhere.

### 5.4 `contexts/ScanContext.tsx` (new, `createContextHook`, under `ProjectProvider`)
- Holds recent `ScanRecord[]`; **hydrates from Supabase** (snake→camel + `saveLocal` + `setState`, fall back on error/!canSync), tenant-safe namespaced key `tertiary_scan_records`, **clears on userId change** (matches the data-integrity pattern used across the app).
- `addScan(record)` → optimistic local + `supabaseWrite('scan_records','insert',...)`.
- Surfaces recent scans on the confirm screen's "recent" list and (optionally) a small section in project files.

### 5.5 `app/scan.tsx` (new screen)
- Entry: a **Scan** FAB on `app/project-detail.tsx` and a **Scan** tile in the Tools screen (`app/(tabs)/discover/tools.tsx`). If entered globally (no project), first step is a project picker.
- Flow: capture (single/multi) → `invoke('scan-anything')` (loading) → confirm card: big `docType` label + confidence, **editable extracted fields**, suggested destination (folder + "will also create a Contact/Cost entry"), and the image thumbnail(s). Government-ID → a redirect card ("This looks like an ID — use the crew ID scan, which asks consent and never stores the number"). → **Save** commits (upload + record + scan log) → toast + option to "Scan another".
- `useThemedStyles`/amber/lucide; modal-in-screen back pattern.

### 5.6 `supabase/migrations/2026...scan_records.sql` (new — WRITTEN, NOT APPLIED overnight)
- `scan_records` table: `id uuid pk, user_id uuid → auth.users, project_id text, doc_type text, title text, fields jsonb, file_path text, record_kind text, linked_record_id text, created_at timestamptz`. RLS owner-scoped (`auth.uid() = user_id`), `updated_at` trigger. Mirror in `supabase/schema.sql`. **Apply is an owner morning step** (PGRST204-before-OTA gate — same discipline as prior features; the shipped offline-queue schema-cache tolerance covers the race but migrations still go first).

### 5.7 Gating + metering
- `hooks/useTierAccess.ts`: `FeatureKey` `'scan_anything'` → `business`.
- `_shared/auth.ts` `MONTHLY_CAPS`: `scan_anything` — `free: 0, pro: 0, business: 120, enterprise: 300` (aligned with the vision-cost model; keep in sync with `app/paywall.tsx` if surfaced).

### 5.8 `scripts/validate-scan-routing.ts` (new, pure → ship-check)
Cases: every `ScanDocType` resolves to a valid folder + recordKind (exhaustive); `government_id` never routes to extraction; `defaultTitleFor` non-empty for each type; folder names are all real `project-documents` folders; low-confidence → `other` → `file_only`.

## 6. docType taxonomy + extraction (per type)
| docType | extracted fields (v1) |
|---|---|
| invoice | vendor, date, docNumber, lines[]{description,qty,unit,unitPrice,lineTotal}, subtotal, tax, total *(mirrors `analyze-photos` receipt)* |
| delivery_ticket | supplier, date, ticketNumber, items[], deliveredTo, poNumber |
| permit | jurisdiction, permitNumber, type, issuedDate, expiresDate, address |
| insurance_coi | insured, carrier, policyNumber, coverageType, effectiveDate, expiresDate, limits |
| contract | parties, title, effectiveDate, amount |
| business_card | name, company, title, phone, email, address, website |
| spec_sheet | manufacturer, product, model, spec section |
| equipment_nameplate | make, model, serial, voltage/rating, manufactureDate |
| material_tag | vendor, product, sku/partNumber, grade/size |
| warranty | product, provider, term, startDate, endDate |
| inspection_notice | authority, result, date, itemsNoted |
| government_id | *(none — redirect to crew ID scan)* |
| plan_sheet / other | *(none — file only, title = filename/date)* |

## 7. Error handling
- **Classify low-confidence / unrecognized** → `other` → file-only (never lost; user can re-tag).
- **Extract fails / non-JSON** → keep classification, present empty editable fields (user fills in), still files the image.
- **No project selected** (global entry) → project picker gates the flow.
- **Upload fails** → the scan is still logged with `filePath: ''` + a retry; domain-record creation is skipped until the file lands (no orphan record pointing at a missing file).
- **Offline** → classify/extract need connectivity; show "Scanning needs a connection." The final writes (`uploadProjectFile`, record, `scan_records`) go through `supabaseWrite`/storage and queue where supported.
- **government_id** → no extraction; redirect card only.

## 8. Testing
- Pure `scripts/validate-scan-routing.ts` (§5.8) → ship-check.
- `npx tsc --noEmit` + `bun run lint` clean.
- Manual on the **open simulator**: scan a sample invoice, business card, permit, COI → confirm each lands in the right folder + creates the right record; scan an ID → confirm the redirect (no extraction). Capture **simulator screenshots** of the capture, confirm card, and each destination for the owner's review.

## 9. Phasing
- **v1 (this build):** classify + extract + file + route to cost/contact/sub_compliance/file_only; scan log; Business-gated.
- **Phase 2:** equipment/asset register as a destination; batch multi-doc triage; barcode/QR (native build).

## 10. Open decisions (for owner)
1. Confirm **Business** tier (vs Pro).
2. v1 domain-record targets — the four chosen (cost/contact/sub/permit-file) — add/drop any?
3. Whether `delivery_ticket` should auto-append to the day's Daily Report in v1 (spec: file-only in v1, DFR link in phase 2).
