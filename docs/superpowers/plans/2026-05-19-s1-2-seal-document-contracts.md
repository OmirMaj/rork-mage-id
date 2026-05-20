# S1.2 — Seal Signed Contracts (immutable PDF + SHA-256) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** When a project contract reaches `status='signed'`, let the GC tap one button to produce a tamper-evident immutable PDF: rendered on-device, uploaded to a private Supabase Storage bucket, hash-verified server-side, and recorded on the contract row.

**Architecture:** 1 additive idempotent migration (applied via Supabase MCP at build time) + 1 type-field + mapper-read addition + 1 new `generateContractPDFUri` in `utils/pdfGenerator.ts` + 1 new `utils/contractSealing.ts` orchestrator + 1 new Deno edge fn `seal-document` (hash-verify only — no rendering) + 1 GC-side button wire-in in `app/contract.tsx`. Client-side render mirrors the 5+ existing on-device PDF exporters (`expo-print` precedent at `:1270/:1285/:1262`); the server is hash-verify-only — no CloudConvert dependency. Additive, ungated, contracts-only (CO sealing deferred).

**Tech Stack:** TypeScript strict (NO `any`), `expo-print` + `expo-file-system` + `expo-crypto` + `expo-sharing` (all already project deps; verified `"expo-crypto": "~15.0.8"` in `package.json`), Supabase JS client (`lib/supabase.ts`), Supabase Storage (`secure-contracts` private bucket), Deno edge function (mirroring `convert-pdf-to-images`).

**Spec:** `docs/superpowers/specs/2026-05-19-s1-2-seal-document-contracts-design.md` (@ `1ee3262`). Worktree `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`, branch `claude/p0-launch-on-main` (== `main` @ `e58b91a`). Use `git -C "<that path>"`.

---

## CRITICAL
- Additive only; ungated (NO `useTierAccess` added; `requireTier` server-side accepts ALL tiers — legal-grade primitive, not a paywall lever).
- Do NOT modify: `utils/jobCostEngine.ts`, `utils/earnedValueEngine.ts`, `marketing/portal/index.html` (portal RPC `portal_sign_contract` is unchanged), `app/integrations.tsx`, any line-item type, `setContractStatus()` write path beyond reusing its existing `signedPdfUrl` extra (`utils/contractEngine.ts:306,314`).
- Do NOT touch `change_orders`/CO sealing in v1 (deferred per user-confirmed scope).
- Migration is **applied at build time** (additive idempotent, via Supabase MCP `apply_migration`); edge fn is **authored only at build time** — `supabase functions deploy seal-document --no-verify-jwt --project-ref nteoqhcswappxxjlpvap` is a ship-time controller step.
- Strict TS, NO `any`. `npx tsc --noEmit` clean per task (where applicable).
- Build authors code + commits only. Ship happens AFTER the final opus whole-impl review.

## Verified anchors (@ `e58b91a`)
- `types/index.ts:268-275` `ContractSignature { name; role:'gc'|'homeowner'; signedAt; signaturePaths?: string[]; ipAddress? }` — `signaturePaths` may be undefined when the signature came from the static portal (`portal_sign_contract` RPC stores name+signedAt only, no strokes).
- `types/index.ts:276-...` `ProjectContract` has `signedPdfUrl?: string` (insert `documentHash?: string` immediately after it in Task 2).
- `utils/contractEngine.ts:71` `rowToContract` maps `signedPdfUrl: r.signed_pdf_url ?? undefined` — add the symmetric `documentHash` line in Task 2.
- `utils/pdfGenerator.ts:1-5` imports `Platform`, `* as Print from 'expo-print'`, `* as Sharing from 'expo-sharing'`, types incl. `CompanyBranding,Project,ChangeOrder,...` from `@/types`, and design helpers `pdfShell, pdfHeader, pdfTitle, pdfFooter, pdfTable, pdfStatGrid, escHtml, fmtMoney, fmtDate, PDF_PALETTE, PDF_DISCLAIMERS` from `./pdfDesign`.
- `utils/pdfGenerator.ts:1270-1285` `generateChangeOrderPDFUri` is the canonical mirror: `if (Platform.OS === 'web') return null; try { const html = buildXHtml(...); const { uri } = await Print.printToFileAsync({ html, base64: false }); return uri; } catch (err) { console.error(...); return null; }` — return type **`Promise<string | null>`** (web → null).
- `supabase/functions/convert-pdf-to-images/index.ts` shows the Deno serve + `requireTier` pattern; `_shared/auth.ts:120` `export async function requireTier(req, allowed, feature)` returns `{ ok: true, userId, tier, email }` on success or `{ ok: false, body, status }` on failure.
- `app/contract.tsx:655-678` signed-block (post-FF1-B fragment with banner + "Create first invoice" CTA — Task 6 adds 2 more buttons inside the same Fragment).
- `app/contract.tsx:44 import SignaturePad from '@/components/SignaturePad';` (the strokes capture component).

---

### Task 1: Additive migration — `document_hash` column + `secure-contracts` bucket + owner-RLS

**Files:**
- Create: `supabase/migrations/20260519180000_seal_document.sql`
- Apply via: `mcp__49e7c599-7889-433c-99a3-4551a8479d63__apply_migration` (name `seal_document_v1`, project_id `nteoqhcswappxxjlpvap`)

- [ ] **Step 1: Pre-apply verification — read a sample existing storage.objects RLS policy to confirm the canonical own-row form**

Run via `mcp__49e7c599-7889-433c-99a3-4551a8479d63__execute_sql` (READ-ONLY):
```sql
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname='storage' and tablename='objects'
order by policyname
limit 8;
```
Expected: a handful of owner-row policies on `storage.objects`, with `qual`/`with_check` clauses of shape `(bucket_id = '<name>' AND (storage.foldername(name))[1] = (auth.uid())::text)` (the canonical Supabase Storage RLS idiom). If the live form materially differs (e.g. `auth.uid()::text` cast missing, or a different folder-segment helper), adapt the policy text in Step 2 BEFORE applying. Do NOT apply if you cannot match the live canonical form.

- [ ] **Step 2: Create the migration file**

Create `supabase/migrations/20260519180000_seal_document.sql` with EXACTLY this content (adapt only if Step 1 surfaced a form difference):
```sql
-- S1.2: seal-document v1 — signed contract PDF tamper-evidence.
-- Additive + idempotent. Reverse path documented in the commit message.
--
-- Adds a document_hash column on project_contracts (the signed_pdf_url
-- column already exists), creates a private secure-contracts Storage
-- bucket, and three owner-only RLS policies on storage.objects scoped to
-- that bucket via a path convention <user_id>/<contract_id>.pdf.

-- 1. document_hash column (nullable, additive)
alter table public.project_contracts
  add column if not exists document_hash text;

-- 2. Private bucket. owner-only access via RLS below.
insert into storage.buckets (id, name, public)
values ('secure-contracts', 'secure-contracts', false)
on conflict (id) do nothing;

-- 3. Owner-only RLS scoped to bucket_id='secure-contracts' and the first
-- path segment == auth.uid()::text. No delete policy => effectively
-- write-once for the authenticated user (service role can still delete
-- admin-side).
drop policy if exists secure_contracts_owner_select on storage.objects;
create policy secure_contracts_owner_select on storage.objects
  as permissive for select to authenticated
  using (
    bucket_id = 'secure-contracts'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

drop policy if exists secure_contracts_owner_insert on storage.objects;
create policy secure_contracts_owner_insert on storage.objects
  as permissive for insert to authenticated
  with check (
    bucket_id = 'secure-contracts'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

drop policy if exists secure_contracts_owner_update on storage.objects;
create policy secure_contracts_owner_update on storage.objects
  as permissive for update to authenticated
  using (
    bucket_id = 'secure-contracts'
    and (storage.foldername(name))[1] = (auth.uid())::text
  )
  with check (
    bucket_id = 'secure-contracts'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );
```

- [ ] **Step 3: Apply the migration via Supabase MCP**

Call `mcp__49e7c599-7889-433c-99a3-4551a8479d63__apply_migration` with:
- `project_id`: `nteoqhcswappxxjlpvap`
- `name`: `seal_document_v1`
- `query`: the entire SQL from Step 2.

Expected: `{ success: true }` or equivalent. The migration is idempotent — re-running is a no-op.

- [ ] **Step 4: Verify via `execute_sql` (READ-ONLY)**

```sql
select
  (select count(*) from information_schema.columns
   where table_schema='public' and table_name='project_contracts' and column_name='document_hash') as has_doc_hash_col,
  (select count(*) from storage.buckets where id='secure-contracts') as has_bucket,
  (select count(*) from pg_policies where schemaname='storage' and tablename='objects'
   and policyname in ('secure_contracts_owner_select','secure_contracts_owner_insert','secure_contracts_owner_update')) as owner_policies_count;
```
Expected: `has_doc_hash_col=1, has_bucket=1, owner_policies_count=3`.

- [ ] **Step 5: Commit the migration file**
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add supabase/migrations/20260519180000_seal_document.sql
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(S1.2): additive migration — document_hash + secure-contracts bucket + owner RLS

Reverse path (if ever needed): drop policy secure_contracts_owner_{select,insert,update} on storage.objects; delete from storage.buckets where id='secure-contracts'; alter table public.project_contracts drop column document_hash;"
```

---

### Task 2: Type field + mapper-read

**Files:** Modify `types/index.ts`, `utils/contractEngine.ts`

- [ ] **Step 1: Add `documentHash?: string` to `ProjectContract`**

In `types/index.ts`, find this exact line (inside `interface ProjectContract`, immediately after `signedPdfUrl?: string;` at ~`:299`):
```ts
  signedPdfUrl?: string;
```
Insert IMMEDIATELY AFTER it:
```ts
  /** SHA-256 (hex) of the sealed signed PDF bytes. Written only by the
   *  seal-document edge fn after server-side hash-verify; tamper-evidence
   *  pairs with signedPdfUrl. Unset until the GC seals. */
  documentHash?: string;
```
There is a SECOND `signedPdfUrl?: string;` in this file (around `:332`, on a different interface — `LienWaiver`). Target ONLY the occurrence inside `interface ProjectContract` (the one immediately preceded by the `gcSignature?: ContractSignature; homeownerSignature?: ContractSignature;` block at `:293-294`). If you can't unambiguously identify which occurrence to edit, STOP and report BLOCKED.

- [ ] **Step 2: Add the row-read mapper line in `contractEngine.ts`**

In `utils/contractEngine.ts`, find this exact line (inside `rowToContract` mapper at `:71`):
```ts
    signedPdfUrl: r.signed_pdf_url ?? undefined,
```
Insert IMMEDIATELY AFTER it:
```ts
    documentHash: r.document_hash ?? undefined,
```

- [ ] **Step 3: Gate**

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" && npx tsc --noEmit
```
Expected: clean. The field is optional; no existing consumer breaks. The mapper-read pulls the new column when present.

- [ ] **Step 4: Commit**
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add types/index.ts utils/contractEngine.ts
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(S1.2): ProjectContract.documentHash type + row-read mapper"
```

---

### Task 3: `generateContractPDFUri` in `utils/pdfGenerator.ts`

**Files:** Modify `utils/pdfGenerator.ts`

- [ ] **Step 1: Add the contract type to the existing top-of-file type import**

Find (`utils/pdfGenerator.ts:4`):
```ts
import type { CompanyBranding, Project, ChangeOrder, Invoice, DailyFieldReport, ScheduleTask, RFI, Submittal } from '@/types';
```
Replace with (add `ProjectContract`, alphabetically positioned):
```ts
import type { CompanyBranding, Project, ProjectContract, ChangeOrder, Invoice, DailyFieldReport, ScheduleTask, RFI, Submittal } from '@/types';
```

- [ ] **Step 2: Add the HTML builder + exporter immediately AFTER `generateChangeOrderPDFUri`**

Locate `export async function generateChangeOrderPDFUri(` (~`:1270`). Immediately AFTER its closing brace `}` (and the blank line that follows), insert this block (full HTML builder + exporter; reuses `escHtml`, `fmtDate`, `PDF_PALETTE`, `pdfShell`, `pdfHeader` from the existing `./pdfDesign` import group):
```ts
// ──────────────────────────────────────────────────────────────────────
// Contract — sealed/signed PDF render (used by utils/contractSealing.ts
// to produce the immutable artifact stored in the secure-contracts
// bucket). Mirrors the structure of buildChangeOrderHtml + the
// generateChangeOrderPDFUri shape: HTML builder + thin Print wrapper.
// Signatures: when sig.signaturePaths is present (GC-side capture from
// SignaturePad), render the strokes as inline SVG; when it's absent
// (homeowner-side counter-sign via the portal RPC, which captures only
// a typed name), render the typed name + signedAt timestamp instead.
// Both forms are legal-grade per ESIGN Act intent-to-sign + identity.
// ──────────────────────────────────────────────────────────────────────

function buildSignatureBlock(label: string, sig: ContractSignature | undefined): string {
  if (!sig) {
    return `
      <div style="border:1px dashed ${PDF_PALETTE.line};padding:14px;border-radius:8px;color:${PDF_PALETTE.text2};font-size:12px">
        <div style="font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${PDF_PALETTE.text2};margin-bottom:4px">${escHtml(label)}</div>
        <div>Not signed.</div>
      </div>`;
  }
  const sigVisual = (sig.signaturePaths && sig.signaturePaths.length > 0)
    ? `<svg viewBox="0 0 400 120" preserveAspectRatio="xMinYMid meet" style="width:100%;max-width:360px;height:90px;background:#FFF">
         ${sig.signaturePaths.map((d) => `<path d="${escHtml(d)}" stroke="#0B0D10" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round" />`).join('')}
       </svg>`
    : `<div style="font-family:'Caveat',cursive,Georgia,serif;font-size:30px;color:#0B0D10;line-height:1.05;padding:6px 0">${escHtml(sig.name)}</div>`;
  return `
    <div style="border:1px solid ${PDF_PALETTE.line};padding:14px;border-radius:8px">
      <div style="font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${PDF_PALETTE.text2};font-size:11px;margin-bottom:6px">${escHtml(label)}</div>
      ${sigVisual}
      <div style="font-size:12px;color:${PDF_PALETTE.text2};margin-top:6px">${escHtml(sig.name)} · ${escHtml(fmtDate(sig.signedAt))}</div>
    </div>`;
}

function buildContractHtml(contract: ProjectContract, project: Project, branding: CompanyBranding): string {
  const title = `Contract — ${escHtml(project.name)}`;
  const contractNo = contract.number ? `#${escHtml(String(contract.number))}` : '';
  const milestones = Array.isArray(contract.milestones) ? contract.milestones : [];
  const allowances = Array.isArray(contract.allowances) ? contract.allowances : [];
  const scopeText = (contract.scope && contract.scope.trim())
    ? contract.scope
    : (project.scope && typeof project.scope === 'object' && 'summary' in project.scope && typeof (project.scope as { summary?: string }).summary === 'string'
        ? (project.scope as { summary: string }).summary
        : (project.description ?? ''));

  const milestonesHtml = milestones.length === 0 ? '' : `
    <h2 style="font-family:'Fraunces',Georgia,serif;font-size:18px;margin:24px 0 8px">Payment milestones</h2>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:${PDF_PALETTE.tableHead}">
        <th style="text-align:left;padding:8px 10px;border-bottom:1px solid ${PDF_PALETTE.line}">Milestone</th>
        <th style="text-align:right;padding:8px 10px;border-bottom:1px solid ${PDF_PALETTE.line};white-space:nowrap">Amount</th>
        <th style="text-align:right;padding:8px 10px;border-bottom:1px solid ${PDF_PALETTE.line};white-space:nowrap">Due</th>
      </tr></thead>
      <tbody>
        ${milestones.map((m) => `
          <tr>
            <td style="padding:8px 10px;border-bottom:1px solid ${PDF_PALETTE.line}">${escHtml(m.label ?? m.description ?? '')}</td>
            <td style="text-align:right;padding:8px 10px;border-bottom:1px solid ${PDF_PALETTE.line}">${escHtml(fmtMoney(Number(m.amount ?? 0)))}</td>
            <td style="text-align:right;padding:8px 10px;border-bottom:1px solid ${PDF_PALETTE.line}">${escHtml(m.dueOn ? fmtDate(m.dueOn) : '')}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  const allowancesHtml = allowances.length === 0 ? '' : `
    <h2 style="font-family:'Fraunces',Georgia,serif;font-size:18px;margin:24px 0 8px">Allowances</h2>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:${PDF_PALETTE.tableHead}">
        <th style="text-align:left;padding:8px 10px;border-bottom:1px solid ${PDF_PALETTE.line}">Item</th>
        <th style="text-align:right;padding:8px 10px;border-bottom:1px solid ${PDF_PALETTE.line};white-space:nowrap">Allowance</th>
      </tr></thead>
      <tbody>
        ${allowances.map((a) => `
          <tr>
            <td style="padding:8px 10px;border-bottom:1px solid ${PDF_PALETTE.line}">${escHtml(a.label ?? a.description ?? '')}</td>
            <td style="text-align:right;padding:8px 10px;border-bottom:1px solid ${PDF_PALETTE.line}">${escHtml(fmtMoney(Number(a.amount ?? 0)))}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  const warrantyHtml = (contract.warrantyText && contract.warrantyText.trim()) ? `
    <h2 style="font-family:'Fraunces',Georgia,serif;font-size:18px;margin:24px 0 8px">Warranty</h2>
    <div style="font-size:13px;line-height:1.55;color:${PDF_PALETTE.text}">${escHtml(contract.warrantyText)}</div>` : '';

  const sealedAt = fmtDate(new Date().toISOString());

  const body = `
    ${pdfHeader(project, branding)}
    <h1 style="font-family:'Fraunces',Georgia,serif;font-size:26px;margin:6px 0 2px">Construction Contract ${contractNo}</h1>
    <div style="font-size:12px;color:${PDF_PALETTE.text2};margin-bottom:6px">Status: SIGNED · Sealed ${escHtml(sealedAt)}</div>
    ${scopeText ? `
      <h2 style="font-family:'Fraunces',Georgia,serif;font-size:18px;margin:18px 0 8px">Scope</h2>
      <div style="font-size:13px;line-height:1.55;color:${PDF_PALETTE.text};white-space:pre-wrap">${escHtml(scopeText)}</div>` : ''}
    <h2 style="font-family:'Fraunces',Georgia,serif;font-size:18px;margin:18px 0 8px">Contract value</h2>
    <div style="font-size:14px"><strong>${escHtml(fmtMoney(Number(contract.totalValue ?? 0)))}</strong></div>
    ${milestonesHtml}
    ${allowancesHtml}
    ${warrantyHtml}
    <h2 style="font-family:'Fraunces',Georgia,serif;font-size:18px;margin:24px 0 8px">Signatures</h2>
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:260px">${buildSignatureBlock('General contractor', contract.gcSignature)}</div>
      <div style="flex:1;min-width:260px">${buildSignatureBlock('Homeowner', contract.homeownerSignature)}</div>
    </div>
    <div style="margin-top:18px;padding:10px 12px;border:1px solid ${PDF_PALETTE.line};border-radius:6px;background:#FAFAF7;font-size:11px;color:${PDF_PALETTE.text2}">
      This document was electronically signed and sealed via MAGE ID. The cryptographic hash recorded with this contract makes any subsequent byte-level change detectable. Sealed at ${escHtml(sealedAt)}.
    </div>`;

  return pdfShell({ title, body, footer: pdfFooter(branding) });
}

export async function generateContractPDFUri(
  contract: ProjectContract, project: Project, branding: CompanyBranding,
): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const html = buildContractHtml(contract, project, branding);
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    console.log('[PDF] Contract PDF URI:', uri);
    return uri;
  } catch (error) {
    console.error('[PDF] Error generating contract PDF URI:', error);
    return null;
  }
}
```
Note: `ContractSignature` is part of the existing `@/types` re-exports; if tsc reports it's not imported, add it to the type-import group along with `ProjectContract`. Confirm at gate time.

- [ ] **Step 3: Gate**

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" && npx tsc --noEmit
```
Expected: clean. If `ContractSignature` is unresolved, add it to the top type-import line. If `m.dueOn`/`m.label`/`a.label` are not on the actual milestone/allowance shapes in `@/types`, narrow each access via the milestones/allowances real shape (they are `ContractMilestone`/`ContractAllowance`/similar — open `types/index.ts` and adapt the field reads to the real field names; **the only reason to adapt is to satisfy tsc**, not to add features). Strict TS, NO `any`. Reason through: web → null; success → file URI; failure → null + console.error. Identical to the 5 sibling exporters.

- [ ] **Step 4: Commit**
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add utils/pdfGenerator.ts
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(S1.2): generateContractPDFUri — on-device signed-contract render"
```

---

### Task 4: `utils/contractSealing.ts` — orchestrator (new file)

**Files:** Create `utils/contractSealing.ts`

- [ ] **Step 1: Create the file (entire content)**

```ts
// contractSealing.ts — orchestrate the seal-document flow on the GC's
// device. Render contract → upload to secure-contracts → client SHA-256
// → invoke the seal-document edge fn which re-hashes server-side and
// writes signed_pdf_url + document_hash to project_contracts. Returns
// the same fields for the caller to merge into local state.
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProjectContract, Project, CompanyBranding } from '@/types';
import { generateContractPDFUri } from './pdfGenerator';

export interface SealContractResult {
  signedPdfUrl: string;
  documentHash: string;
  sealedAt: string;
}

export class SealAlreadyExistsError extends Error {
  constructor(message = 'This contract has already been sealed.') {
    super(message);
    this.name = 'SealAlreadyExistsError';
  }
}

function base64ToUint8Array(b64: string): Uint8Array {
  // No new dep. atob is available in Hermes/JSC; fall back via Buffer if
  // the runtime exposes it (Node-compatible polyfills sometimes do).
  const bin = (globalThis as { atob?: (s: string) => string }).atob?.(b64) ?? '';
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i) & 0xff;
  return out;
}

export async function sealSignedContract(input: {
  contract: ProjectContract;
  project: Project;
  branding: CompanyBranding;
  supabase: SupabaseClient;
  userId: string;
}): Promise<SealContractResult> {
  const { contract, project, branding, supabase, userId } = input;

  // Guard: only seal a fully-signed contract that hasn't been sealed yet.
  if (contract.status !== 'signed') throw new Error('Contract is not in signed status.');
  if (!contract.gcSignature || !contract.homeownerSignature) {
    throw new Error('Both GC and homeowner signatures are required to seal.');
  }
  if (contract.signedPdfUrl) throw new SealAlreadyExistsError();

  // 1. Render the PDF on-device.
  const fileUri = await generateContractPDFUri(contract, project, branding);
  if (!fileUri) throw new Error('Web sealing is not supported. Use the mobile app to seal a contract.');

  // 2. Read bytes (base64) + compute client SHA-256.
  const base64 = await FileSystem.readAsStringAsync(fileUri, { encoding: 'base64' });
  const clientHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    base64,
    { encoding: Crypto.CryptoEncoding.HEX },
  );

  // 3. Upload to private bucket. upsert:false → second seal of the same
  //    contract id is rejected by Storage (effective immutability).
  const storagePath = `${userId}/${contract.id}.pdf`;
  const bytes = base64ToUint8Array(base64);
  const { error: upErr } = await supabase
    .storage
    .from('secure-contracts')
    .upload(storagePath, bytes, { contentType: 'application/pdf', upsert: false });
  if (upErr) {
    const msg = (upErr.message ?? '').toLowerCase();
    if (msg.includes('already exists') || msg.includes('duplicate') || msg.includes('conflict')) {
      throw new SealAlreadyExistsError();
    }
    throw new Error(`Failed to upload sealed PDF: ${upErr.message}`);
  }

  // 4. Server-side hash-verify + DB write.
  const { data, error } = await supabase.functions.invoke('seal-document', {
    body: { contract_id: contract.id, storage_path: storagePath, client_hash: clientHash },
  });
  if (error) throw new Error(`seal-document failed: ${error.message}`);
  const payload = data as { signed_pdf_url?: string; document_hash?: string; sealed_at?: string } | null;
  if (!payload || !payload.signed_pdf_url || !payload.document_hash || !payload.sealed_at) {
    throw new Error('seal-document returned an incomplete result.');
  }
  return {
    signedPdfUrl: payload.signed_pdf_url,
    documentHash: payload.document_hash,
    sealedAt: payload.sealed_at,
  };
}

export async function downloadSealedContractPdf(input: {
  contract: ProjectContract;
  userId: string;
  supabase: SupabaseClient;
}): Promise<void> {
  const { contract, userId, supabase } = input;
  if (!contract.signedPdfUrl) throw new Error('No sealed PDF on file for this contract.');

  // signed_pdf_url is the storage path (set by the edge fn). Mint a
  // short-lived signed URL and share.
  const storagePath = contract.signedPdfUrl.startsWith(`${userId}/`)
    ? contract.signedPdfUrl
    : `${userId}/${contract.id}.pdf`;
  const { data, error } = await supabase
    .storage
    .from('secure-contracts')
    .createSignedUrl(storagePath, 60);
  if (error || !data?.signedUrl) {
    throw new Error(`Failed to create a download link: ${error?.message ?? 'unknown error'}`);
  }
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(data.signedUrl, {
      mimeType: 'application/pdf',
      dialogTitle: 'Signed contract PDF',
      UTI: 'com.adobe.pdf',
    });
  }
}
```

- [ ] **Step 2: Gate**

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" && npx tsc --noEmit
```
Expected: clean. If `SupabaseClient` import path differs in this repo (some projects use `@supabase/supabase-js` directly, others a local alias), use the same import path the existing codebase uses elsewhere (grep for `import type { SupabaseClient }`); if the codebase uses an alias, mirror it. Strict TS, NO `any`. Reason through: guards block ineligible seals; the `globalThis.atob` shim is safe in Hermes/Node and falls back to empty-binary if unavailable (which would then fail the server hash-verify cleanly, surfacing the issue rather than corrupting state).

- [ ] **Step 3: Commit**
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add utils/contractSealing.ts
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(S1.2): contractSealing orchestrator + download helper"
```

---

### Task 5: Deno edge fn `seal-document` (authored only — deploy is ship-time)

**Files:** Create `supabase/functions/seal-document/index.ts`

- [ ] **Step 1: Create the file (entire content)**

Open `supabase/functions/convert-pdf-to-images/index.ts` (~the top 80 lines) for the exact pattern (CORS headers, `serve`, `json()` helper, `_shared/auth` import). Use the SAME shape — only the body differs. Create `supabase/functions/seal-document/index.ts` with this content (adapt the `_shared/auth` import path and the `createClient` service-role construction to match `convert-pdf-to-images` 1:1):
```ts
// seal-document — hash-verify-only edge fn for the S1.2 sealed-signed-
// contract flow. The GC's app renders the PDF on-device with expo-print,
// uploads it to secure-contracts/<userId>/<contractId>.pdf, computes a
// client-side SHA-256, then calls this fn. We re-download the bytes
// service-role, recompute the hash, and ONLY on match write signed_pdf_url
// + document_hash to project_contracts. This is the tamper-evidence step:
// any later byte-level change to the stored PDF breaks the stored hash.
//
// Deployed at ship time:
//   supabase functions deploy seal-document --no-verify-jwt --project-ref nteoqhcswappxxjlpvap

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { requireTier } from '../_shared/auth.ts';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface SealBody {
  contract_id?: unknown;
  storage_path?: unknown;
  client_hash?: unknown;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
function isHex64(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);

  const t0 = Date.now();
  const log = (step: string, data?: Record<string, unknown>) => {
    console.log(`[seal-document] +${Date.now() - t0}ms ${step}`, data ? JSON.stringify(data) : '');
  };

  try {
    log('boot');

    // All tiers — legal-grade primitive, not a paywall lever.
    const auth = await requireTier(req, ['free', 'pro', 'business', 'enterprise'], 'seal_document');
    if (!auth.ok) return json(auth.body, auth.status);
    log('auth_ok', { userId: auth.userId, tier: auth.tier });

    let body: SealBody;
    try { body = await req.json(); }
    catch { return json({ ok: false, error: 'invalid JSON body' }, 400); }

    const { contract_id, storage_path, client_hash } = body;
    if (!isUuid(contract_id)) return json({ ok: false, error: 'contract_id must be a UUID' }, 400);
    if (typeof storage_path !== 'string' || storage_path.length === 0) {
      return json({ ok: false, error: 'storage_path is required' }, 400);
    }
    if (!isHex64(client_hash)) return json({ ok: false, error: 'client_hash must be 64 hex chars (SHA-256)' }, 400);

    // Defense-in-depth: the storage path must start with the caller's userId/
    // (the bucket RLS also enforces this; we re-check before any service-role
    // download to avoid leaking another user's bytes into a hash comparison).
    if (!storage_path.startsWith(`${auth.userId}/`)) {
      return json({ ok: false, error: 'storage_path is not owned by the caller' }, 403);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceKey) {
      return json({ ok: false, error: 'server is missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY' }, 500);
    }
    const supa = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // 1. Verify ownership of the contract row (auth.userId === project_contracts.user_id).
    const ownRes = await supa
      .from('project_contracts')
      .select('id,user_id')
      .eq('id', contract_id)
      .maybeSingle();
    if (ownRes.error) return json({ ok: false, error: `lookup failed: ${ownRes.error.message}` }, 500);
    if (!ownRes.data) return json({ ok: false, error: 'contract not found' }, 404);
    if (ownRes.data.user_id !== auth.userId) return json({ ok: false, error: 'not your contract' }, 403);
    log('ownership_ok');

    // 2. Download the uploaded bytes (service-role bypasses Storage RLS).
    const dl = await supa.storage.from('secure-contracts').download(storage_path);
    if (dl.error || !dl.data) {
      return json({ ok: false, error: `download failed: ${dl.error?.message ?? 'no data'}` }, 404);
    }
    const bytes = new Uint8Array(await dl.data.arrayBuffer());
    if (bytes.byteLength === 0) return json({ ok: false, error: 'uploaded file is empty' }, 400);
    log('downloaded', { bytes: bytes.byteLength });

    // 3. Server-side hash + compare.
    const serverHash = await sha256Hex(bytes);
    if (serverHash.toLowerCase() !== client_hash.toLowerCase()) {
      return json({ ok: false, error: 'hash mismatch — uploaded bytes do not match client_hash' }, 400);
    }
    log('hash_verified');

    // 4. Persist signed_pdf_url + document_hash on the contract row.
    const sealedAt = new Date().toISOString();
    const upd = await supa
      .from('project_contracts')
      .update({ signed_pdf_url: storage_path, document_hash: serverHash, updated_at: sealedAt })
      .eq('id', contract_id)
      .eq('user_id', auth.userId);
    if (upd.error) return json({ ok: false, error: `update failed: ${upd.error.message}` }, 500);
    log('persisted');

    return json({
      ok: true,
      signed_pdf_url: storage_path,
      document_hash: serverHash,
      sealed_at: sealedAt,
    });
  } catch (err) {
    console.error('[seal-document] unhandled error', err);
    return json({ ok: false, error: 'internal error' }, 500);
  }
});
```

- [ ] **Step 2: Sanity check (no tsc — Deno fns aren't in the app tsconfig; convert-pdf-to-images is the pattern)**

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" && \
echo "any-count must be 0: $(grep -c ': any' supabase/functions/seal-document/index.ts)" && \
echo "shared auth import: $(grep -c \"from '../_shared/auth.ts'\" supabase/functions/seal-document/index.ts)"
```
Expected: any-count=0, shared auth import=1.

Reason through: validates body shapes (uuid, non-empty path, 64-hex hash); enforces storage_path-starts-with-userId before service-role download (defense-in-depth on top of bucket RLS); ownership check on `project_contracts.user_id`; re-hashes the downloaded bytes; rejects on mismatch; writes only on match; never writes without a verified hash; no service-role privilege escalation surface (the WHERE clause pins `id AND user_id`).

- [ ] **Step 3: Commit (authored — NOT deployed)**
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add supabase/functions/seal-document/index.ts
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(S1.2): seal-document edge fn — server-side hash-verify + DB write"
```

---

### Task 6: GC-side button wire-in in `app/contract.tsx`

**Files:** Modify `app/contract.tsx`

- [ ] **Step 1: Add imports**

Find this exact line (around `:44`):
```tsx
import SignaturePad from '@/components/SignaturePad';
```
Insert IMMEDIATELY AFTER it:
```tsx
import { supabase } from '@/lib/supabase';
import { sealSignedContract, downloadSealedContractPdf, SealAlreadyExistsError } from '@/utils/contractSealing';
```

If the existing imports do not include `useAuth`, find the existing auth-context import (likely `import { useAuth } from '@/contexts/AuthContext';` somewhere near the top). If absent, add it. (Most likely already present — confirm via grep before adding.) Also confirm `Lock` from `lucide-react-native` isn't needed (the picker isn't using it — this task only adds 2 buttons that reuse existing styles).

- [ ] **Step 2: Add the two `useCallback` handlers**

Locate where the file's existing handlers are defined (above the returned JSX — e.g. `handleSignAndSend` at `:213`). After the last handler `useCallback(...)` block in that region, insert:
```tsx
  const handleSealSignedContract = useCallback(async () => {
    if (!project || !contract || !user?.id) return;
    try {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const result = await sealSignedContract({
        contract,
        project,
        branding: settings?.branding ?? {},
        supabase,
        userId: user.id,
      });
      // Reflect into local state immediately so the UI flips to Download.
      setContract({
        ...contract,
        signedPdfUrl: result.signedPdfUrl,
        documentHash: result.documentHash,
      });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      nailIt(`Sealed · ${result.documentHash.slice(0, 12)}…`);
    } catch (err) {
      if (err instanceof SealAlreadyExistsError) {
        Alert.alert('Already sealed', 'This contract has already been sealed.');
        return;
      }
      console.error('[Contract] Seal error:', err);
      Alert.alert('Seal failed', err instanceof Error ? err.message : 'Could not seal the contract. Please try again.');
    }
  }, [project, contract, user?.id, settings?.branding]);

  const handleDownloadSealedPdf = useCallback(async () => {
    if (!contract || !user?.id) return;
    try {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await downloadSealedContractPdf({ contract, userId: user.id, supabase });
    } catch (err) {
      console.error('[Contract] Download sealed PDF error:', err);
      Alert.alert('Download failed', err instanceof Error ? err.message : 'Could not download the sealed PDF.');
    }
  }, [contract, user?.id]);
```
Adapt the `setContract(...)` call to whatever local setter the file uses for the active contract (e.g. `setContract`, `setActiveContract`, etc. — grep the file). If `settings?.branding` isn't the right path for `CompanyBranding`, use whatever the file's existing handlers (e.g. `handleSignAndSend`) reference for branding (grep for `branding` usage in the file). Adapt to the verified-real symbols only — do not change behavior beyond the seal/download intent.

- [ ] **Step 3: Add the buttons inside the signed-block Fragment**

Find this exact block (`:655-678`):
```tsx
        {contract.status === 'signed' && (
          <>
            <View style={[styles.statusBanner, { backgroundColor: themeColors.success + '0D', borderColor: themeColors.success + '30' }]}>
              <CheckCircle2 size={16} color={themeColors.success} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.statusBannerTitle, { color: themeColors.success }]}>Signed by both parties</Text>
                <Text style={styles.statusBannerBody}>
                  Binding agreement on file. Invoices on this project should reference it.
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.primaryBtn, { flex: 0, alignSelf: 'stretch', marginTop: 10 }]}
              onPress={() => router.push({ pathname: '/bill-from-estimate', params: { projectId } } as any)}
              accessibilityRole="button"
              accessibilityLabel="Create first invoice"
            >
              <Plus size={16} color="#FFF" />
              <Text style={styles.primaryBtnText}>Create first invoice</Text>
            </TouchableOpacity>
          </>
        )}
```
Replace it ENTIRELY with (banner + invoice CTA byte-identical; insert the seal/download buttons between the banner and the invoice CTA):
```tsx
        {contract.status === 'signed' && (
          <>
            <View style={[styles.statusBanner, { backgroundColor: themeColors.success + '0D', borderColor: themeColors.success + '30' }]}>
              <CheckCircle2 size={16} color={themeColors.success} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.statusBannerTitle, { color: themeColors.success }]}>Signed by both parties</Text>
                <Text style={styles.statusBannerBody}>
                  Binding agreement on file. Invoices on this project should reference it.
                </Text>
              </View>
            </View>
            {!contract.signedPdfUrl && (
              <TouchableOpacity
                style={[styles.primaryBtn, { flex: 0, alignSelf: 'stretch', marginTop: 10 }]}
                onPress={() => { void handleSealSignedContract(); }}
                accessibilityRole="button"
                accessibilityLabel="Seal and save signed PDF"
                testID="contract-seal-btn"
              >
                <FileText size={16} color="#FFF" />
                <Text style={styles.primaryBtnText}>Seal &amp; save signed PDF</Text>
              </TouchableOpacity>
            )}
            {contract.signedPdfUrl && (
              <TouchableOpacity
                style={[styles.primaryBtn, { flex: 0, alignSelf: 'stretch', marginTop: 10 }]}
                onPress={() => { void handleDownloadSealedPdf(); }}
                accessibilityRole="button"
                accessibilityLabel="Download sealed signed PDF"
                testID="contract-download-sealed-btn"
              >
                <FileText size={16} color="#FFF" />
                <Text style={styles.primaryBtnText}>Download signed PDF</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.primaryBtn, { flex: 0, alignSelf: 'stretch', marginTop: 10 }]}
              onPress={() => router.push({ pathname: '/bill-from-estimate', params: { projectId } } as any)}
              accessibilityRole="button"
              accessibilityLabel="Create first invoice"
            >
              <Plus size={16} color="#FFF" />
              <Text style={styles.primaryBtnText}>Create first invoice</Text>
            </TouchableOpacity>
          </>
        )}
```
(`FileText` is already imported in `app/contract.tsx` — confirm via grep; if not, add it to the `lucide-react-native` import group alongside `Plus`/`ChevronLeft`.)

- [ ] **Step 4: Gate**

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" && npx tsc --noEmit
```
Expected: clean. Reason through (report): a signed contract WITHOUT a sealed PDF now shows a "Seal & save signed PDF" button below the banner; tap → handler → orchestrator → render+upload+hash+invoke → on success the local contract gets `signedPdfUrl` + `documentHash` + the button flips to "Download signed PDF". A second tap on "Seal" while still in pre-sealed state can race with the upload; the orchestrator's `upsert:false` guards. `SealAlreadyExistsError` surfaces a friendly Alert. The banner + "Create first invoice" CTA (FF1-B) are byte-identical. No CO / non-signed-status branch touched.

- [ ] **Step 5: Commit**
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add app/contract.tsx
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(S1.2): contract.tsx Seal/Download buttons + handlers"
```

---

## Final combined gate (after all 6 tasks)
```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" && \
npx tsc --noEmit && \
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" diff --stat e58b91a HEAD
```
Expected: tsc clean; `git diff --stat` lists EXACTLY: `types/index.ts`, `utils/contractEngine.ts`, `utils/pdfGenerator.ts`, `utils/contractSealing.ts`, `supabase/functions/seal-document/index.ts`, `supabase/migrations/20260519180000_seal_document.sql`, `app/contract.tsx`, + the S1.2 spec/plan `.md` docs. No other source file.

Then verify (READ-ONLY MCP) the migration is applied + the bucket+policies are live:
```sql
select
  (select count(*) from information_schema.columns where table_schema='public' and table_name='project_contracts' and column_name='document_hash') as has_doc_hash_col,
  (select count(*) from storage.buckets where id='secure-contracts') as has_bucket,
  (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'secure_contracts_%') as owner_policies_count;
```
Expected: `1, 1, 3`.

## Ship (controller, AFTER final opus whole-impl review — NOT build)
After the final opus review passes:
1. FF-merge `claude/p0-launch-on-main` → `main` (FF if possible; else clean safe merge — never force), push.
2. Deploy the edge fn:
   ```bash
   supabase functions deploy seal-document --no-verify-jwt --project-ref nteoqhcswappxxjlpvap
   ```
3. Publish the app OTA:
   ```bash
   eas update --branch production --message "S1.2 sealed signed contracts (immutable PDF + SHA-256 hash)"
   ```
The migration was already applied at build time (Task 1). Order matters: edge fn deploy MUST precede the OTA (the app calls the fn; until it's deployed, the seal button will fail on tap).

## Self-Review
**Spec coverage:** §4.1 migration → Task 1; §4.2 PDF render + sealing orchestrator → Tasks 3 + 4; §4.3 edge fn hash-verify + DB write → Task 5; §4.4 GC-side button + handlers → Task 6; type/mapper field → Task 2. §3 non-goals (no engine/portal/CO/integrations change; ungated; no NOT-NULL/backfill) → CRITICAL + scope confined; §5 error handling (idempotency upsert:false, hash mismatch 400, ownership 403, all-tier auth, no service-role write without hash match) → Task 4 + Task 5; §6 verification → per-task gates + final combined gate. No gaps.
**Placeholder scan:** No TBD/TODO. Task 1 = full migration SQL. Task 3 = entire HTML builder + exporter verbatim. Task 4 = entire new util file verbatim. Task 5 = entire edge fn file verbatim. Task 2 = exact 1-line type + 1-line mapper inserts. Task 6 = exact 2-handler insert + the full JSX replacement of the signed-block. The "adapt at gate time" directives (Task 3: milestone/allowance field names; Task 4: SupabaseClient import path; Task 6: setContract setter name + branding source) are precise named verifications against the real file — not vague TODOs.
**Type/name consistency:** `ProjectContract.signedPdfUrl?` / `documentHash?` consistent across Tasks 2-6; `SealContractResult{ signedPdfUrl, documentHash, sealedAt }` ↔ edge fn response `{ signed_pdf_url, document_hash, sealed_at }` ↔ Task 6 handler `result.signedPdfUrl/documentHash`. `sealSignedContract` / `downloadSealedContractPdf` / `SealAlreadyExistsError` named identically Tasks 4↔6. `generateContractPDFUri(contract,project,branding):Promise<string|null>` Task 3 ↔ Task 4 usage. `seal-document` body schema `{ contract_id, storage_path, client_hash }` Task 4 ↔ Task 5. Storage path convention `${userId}/${contract.id}.pdf` consistent Task 4 ↔ Task 5 (RLS check) ↔ Task 1 (policy `(storage.foldername(name))[1] = auth.uid()::text`). 6 tasks, dependencies flow forward only (Task N+1 only imports from ≤N).
