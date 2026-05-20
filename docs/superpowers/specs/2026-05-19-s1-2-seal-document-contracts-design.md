# S1.2 — Seal Signed Contracts (immutable PDF + SHA-256) — Design

Sub-project **4 of 5** from the 2026-05-19 brief, **user-confirmed scope**: contracts only (COs deferred), client-side render via `expo-print` (parity with the 5+ on-device exporters in `utils/pdfGenerator.ts`), with a small server-side `seal-document` edge fn for hash-verify before writing the DB row. The audit's "e-sign is a cosmetic stroke string, no rendered PDF" gap is genuine — `app/contract.tsx handleSignAndSend` (`:213`) stores `gcSignature` stroke + name only; there is no `generateContractPDFUri` in `utils/pdfGenerator.ts` (5 other exporters exist).

Build target: p0-on-main worktree (`/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`), branch `claude/p0-launch-on-main` (== `main` @ `e58b91a`). **App + one small additive idempotent migration (via Supabase MCP at build time — Netlify-independent, like prior session migrations) + one new edge fn (Deno, deployed via `supabase functions deploy seal-document --no-verify-jwt --project-ref nteoqhcswappxxjlpvap` at ship time).**

## 1. Reality-check vs the pasted brief

Verified against live prod schema + worktree:

- ✅ **Genuine gap.** No `generateContractPDFUri` exists (`utils/pdfGenerator.ts` has 5+ others: estimate, quick-estimate, CO, invoice, RFI; contract render is the missing one). `app/contract.tsx handleSignAndSend` stores a stroke-string only.
- ⚠️ **Partly already-provisioned.** `project_contracts.signed_pdf_url text` **already exists** as a column (verified via `information_schema.columns`); `setContractStatus()` already accepts/writes `signedPdfUrl`; the type already has `signedPdfUrl?: string`. So the brief's "storage_path" is **this existing column** — reuse, don't add a parallel.
- ❌ **Missing.** `project_contracts.document_hash` does NOT exist. The 9 existing storage buckets do NOT include `secure-contracts` (or similar private contract bucket). The brief's column + bucket are real additions.
- 🚫 **Out of scope per user.** `change_orders` table is also missing `signed_pdf_url`/`document_hash` — left untouched in v1. COs deferred.
- 📋 **Reusable patterns.** `convert-pdf-to-images` edge fn (`:78,143-146`) shows the established Deno/secrets/auth pattern (CloudConvert is not used here — we're hash-verify-only). `utils/storage.ts` wraps `supabase.storage.from(...).upload/createSignedUrl`. `_shared/auth.ts requireTier(req,allowed,feature)` is the standard auth helper.

## 2. Problem

When the GC and homeowner both sign a contract today, `project_contracts.status='signed'` and the two signature jsonb blobs are stored — but **no immutable PDF representation is produced**. The audit calls this a "cosmetic stroke string." There is no tamper-evidence (no hash), no shareable signed PDF (no rendered document), no bucket of record. A GC sending the contract to their lender, insurer, or attorney has nothing legal-grade to hand over.

## 3. Goal / Non-goals

**Goal:** When a contract reaches `status='signed'` (both signatures present), produce an **immutable, hash-evidenced PDF** of the signed contract, stored privately, with the URL + hash recorded on the contract row. Triggered by an explicit GC action (button in `app/contract.tsx` when status='signed' && !signedPdfUrl) — explicit because legal-grade artifacts deserve an explicit "I sealed this" act, not a magic auto-fire.

**Non-goals (YAGNI / scope / honesty):**
- NOT sealing change orders / lien waivers / invoices / submittals (deferred; `lienWaiverEngine.ts` already has its own `signed_pdf_url` field — that's a parallel future follow-up using the same util).
- NOT a new Storage bucket for general document sealing — only `secure-contracts` (singular purpose, owner-only RLS, private).
- NOT a server-side render path (CloudConvert HTML→PDF) — client-side `expo-print` matches the 5+ existing on-device PDF exporters; codebase-consistent, no new dependency.
- NOT auto-firing on status='signed' — explicit GC tap (legal grade ⇒ deliberate act; also avoids retry/race complexity).
- NOT touching `setContractStatus()` / `contractEngine.ts` write path beyond reusing the existing `signedPdfUrl` extra (already supported at `:306,314`).
- NO change to portal HTML (`marketing/portal/index.html`) — the homeowner counter-signs via the existing `portal_sign_contract` RPC; sealing happens GC-side afterwards. Netlify-independent.

## 4. Architecture

Four-piece v1: **(1)** additive prod migration (1 column + 1 bucket + RLS), **(2)** new on-device PDF render + sealing orchestrator, **(3)** new Deno edge fn `seal-document` (hash-verify only — no rendering), **(4)** GC-side button wire-in.

### 4.1 Migration (additive, idempotent — via Supabase MCP at build)
One migration `supabase/migrations/<ts>_seal_document.sql`:
```sql
-- Additive: document_hash column for the seal-document tamper-evidence.
alter table public.project_contracts
  add column if not exists document_hash text;

-- Private bucket for the sealed PDFs. owner-only RLS.
insert into storage.buckets (id, name, public)
values ('secure-contracts', 'secure-contracts', false)
on conflict (id) do nothing;

-- Owner-only access on storage.objects scoped to this bucket.
-- Path convention: <user_id>/<contract_id>.pdf — first path segment must equal auth.uid().
drop policy if exists secure_contracts_owner_select on storage.objects;
create policy secure_contracts_owner_select on storage.objects
  as permissive for select to authenticated
  using (bucket_id = 'secure-contracts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists secure_contracts_owner_insert on storage.objects;
create policy secure_contracts_owner_insert on storage.objects
  as permissive for insert to authenticated
  with check (bucket_id = 'secure-contracts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists secure_contracts_owner_update on storage.objects;
create policy secure_contracts_owner_update on storage.objects
  as permissive for update to authenticated
  using (bucket_id = 'secure-contracts' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'secure-contracts' and (storage.foldername(name))[1] = auth.uid()::text);
-- No delete policy (immutability). The service role can still delete admin-side.
```
Idempotent: `add column if not exists`, `insert ... on conflict`, `drop policy if exists`/`create`. Verify canonical own-RLS form against a sample live policy at plan time (read-only) before finalizing.

### 4.2 Client: PDF render + sealing orchestrator
Add to `utils/pdfGenerator.ts`: `generateContractPDFUri(contract: ProjectContract, project: Project, branding: BrandingSettings, opts?: { embedSignaturesAsSVG?: boolean }): Promise<string>` — renders an HTML representation of the signed contract (the existing CO/Invoice exporters in this file are the mirror; they build an HTML string + `await Print.printToFileAsync({ html })`). The contract HTML includes: header (project + GC branding + contract number/version), scope/payment-milestones/allowances/warranty sections, **rendered signatures** (inline SVG path strokes via `stroke` paths from `gcSignature.strokes`/`homeownerSignature.strokes` + the typed names + signedAt timestamps), and a footer "This PDF was sealed on <date>". Returns the file URI.

New `utils/contractSealing.ts`:
```ts
export interface SealContractResult { signedPdfUrl: string; documentHash: string; sealedAt: string; }
export async function sealSignedContract(input: {
  contract: ProjectContract; project: Project; branding: BrandingSettings;
  supabase: SupabaseClient; userId: string;
}): Promise<SealContractResult>;
```
Orchestration:
1. Guard: `contract.status === 'signed'` AND `contract.gcSignature && contract.homeownerSignature` AND `!contract.signedPdfUrl` — else throw a guarded error.
2. `const fileUri = await generateContractPDFUri(contract, project, branding);` (file:// URI on device).
3. Read bytes: `const base64 = await FileSystem.readAsStringAsync(fileUri, { encoding: 'base64' });`.
4. Client-side SHA-256: `const clientHash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64, { encoding: Crypto.CryptoEncoding.HEX });` (via `expo-crypto`; confirm dep at plan time).
5. Upload to Storage: path `${userId}/${contract.id}.pdf`; `supabase.storage.from('secure-contracts').upload(path, decode(base64), { contentType:'application/pdf', upsert:false });` — `upsert:false` enforces immutability (any second seal of the same contract id rejects).
6. Invoke edge fn: `const { data, error } = await supabase.functions.invoke('seal-document', { body: { contract_id: contract.id, storage_path: path, client_hash: clientHash } });` — the edge fn re-hashes server-side, writes `signed_pdf_url` + `document_hash` to `project_contracts`.
7. Return `{ signedPdfUrl: data.signed_pdf_url, documentHash: data.document_hash, sealedAt: data.sealed_at }`.

### 4.3 Edge fn `seal-document` (Deno, server-side hash-verify only)
`supabase/functions/seal-document/index.ts`:
- Auth: `_shared/auth.ts requireTier(req, ['free','pro','business','enterprise'], 'seal_document')` (all tiers can seal — it's a basic legal-correctness feature, not a paywall lever).
- Body: `{ contract_id: uuid, storage_path: string, client_hash: string }` — validate shapes.
- Service-role read `project_contracts.user_id` for `contract_id`; reject if `user_id !== auth.userId` (ownership).
- Reject if `storage_path` doesn't start with `<auth.userId>/` (defense-in-depth; matches the bucket RLS).
- Download bytes from `secure-contracts/<storage_path>` via service-role storage client.
- Compute server SHA-256 over those bytes (Deno: `crypto.subtle.digest('SHA-256', bytes)` → hex).
- If server hash !== client hash → 400 with reason (proof the client didn't upload what it hashed, or someone substituted).
- Else: service-role UPDATE `project_contracts` SET `signed_pdf_url = <bucket path>`, `document_hash = <hash>`, `updated_at = now()` WHERE id = contract_id AND user_id = auth.userId.
- Return `{ signed_pdf_url, document_hash, sealed_at: new Date().toISOString() }`.
- Fail-closed (no service-role write without hash match). Mirror the existing edge-fn error/log conventions (see `convert-pdf-to-images`).

### 4.4 GC-side button wire-in
In `app/contract.tsx`, where the signed-banner already renders (~`:655-680`, the same block FF1-B added a "Create first invoice" CTA to): when `contract.status === 'signed' && !contract.signedPdfUrl`, show a "Seal & save signed PDF" button → calls `sealSignedContract(...)` → on success, `setContractStatus(contract.id, 'signed', { signedPdfUrl: data.signed_pdf_url })` to reflect locally + `nailIt(...)` success toast + a haptic. When `contract.signedPdfUrl` IS set, show a smaller "Download signed PDF" affordance instead (generates a signed Storage URL via existing `utils/storage.ts createSignedUrl` and `Sharing.shareAsync`s it). Try/catch → existing `Alert.alert('Error', …)`.

## 5. Error handling / correctness

- **Idempotency:** Storage `upsert:false` rejects a second seal of the same `<userId>/<contract.id>.pdf` (returns conflict). The orchestrator catches the conflict and returns a friendly "Already sealed" rather than overwriting. The DB UPDATE is also a no-op when `signed_pdf_url` is already set (guarded by the GC button visibility).
- **Hash mismatch:** edge fn rejects + returns 400; orchestrator surfaces the alert. The Storage object is left in place for inspection.
- **Network / partial:** if upload succeeds but the edge fn invoke fails, the Storage object exists without DB metadata. On retry the upload fails (upsert:false), but the orchestrator can detect this and re-invoke the edge fn with the same `storage_path` to recover (idempotent — server re-hashes the existing object).
- **Bucket RLS:** owner-only by path segment; service-role bypasses for the edge fn's read. No public access.
- **Strict TS, no `any`.** `tsc --noEmit` clean. No new dep beyond `expo-crypto` if not already present (confirm at plan time — `expo-print`, `expo-file-system` already used in `utils/pdfGenerator.ts`).
- **Read-only for the user's existing data:** no change to `setContractStatus()` write path beyond the existing `signedPdfUrl` extra. The new `document_hash` column is written ONLY by the edge fn (service-role). Engine flows (jobCost/EVM/AIA) untouched.

## 6. Verification (no unit runner)

Per-task `npx tsc --noEmit` clean + manual reasoning:
- Migration applies idempotently (`apply_migration` succeeds; re-run no-op); read-only verify the column + bucket + 3 policies exist live.
- A signed contract → tap "Seal & save signed PDF" → on-device PDF generated (preview-able via the existing on-device PDF idiom), uploaded to `secure-contracts/<userId>/<contractId>.pdf`, hash computed; edge fn hash-verifies, writes `signed_pdf_url` + `document_hash`; UI flips to "Download signed PDF". A second tap on the same contract surfaces "Already sealed."
- Hash mismatch (simulate by tampering with bytes between upload and invoke) → edge fn 400, button stays available, no DB row update.
- Status not `'signed'` or `signedPdfUrl` already set → button hidden (no double-seal possible).
- Every other contract behavior (draft/sent/void branches, sign-and-send, CCD G714, FF1-B "Create first invoice" CTA) byte-unchanged.
- Final whole-impl review (opus) — confirm: 1 migration + 1 edge fn + 2 new utils + 1 wire-in; additive only; ungated; the seal flow is the only write of `document_hash` (service-role); RLS owner-only enforced.

## 7. Out of scope / future

- Sealing change orders, lien waivers (separate sub-projects reusing the same util + edge fn).
- Multi-signature workflows (architect / lender countersignature) — beyond v1.
- Long-term archival / WORM (write-once-read-many) compliance, e-IDAS / ESIGN Act statutory metadata, qualified e-signature integration (DocuSign, Adobe Sign) — future.
- S3 (sub onboarding wizard) StepTwoSign uses this same `sealSignedContract` for the sub-contract case (one more line-item wire-in; planned in S3, not in S1.2).
