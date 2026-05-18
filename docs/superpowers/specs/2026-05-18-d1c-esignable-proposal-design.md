# D1c — One-Tap E-Signable Proposal (from a saved EstimateRevision) — Design

Source: `docs/superpowers/audits/2026-05-17-feature-depth-audit.md` item **D1** ("one-tap branded proposal the client e-signs"). D1a (estimate versioning) + D1b-1 (GC-authored assemblies) shipped.

Build target: p0-on-main worktree, branch `claude/p0-launch-on-main`, HEAD `ef85334`. Code + ONE small additive idempotent migration (applied via Supabase MCP — NOT Netlify). **Deliberately NO portal-HTML change** (see §3) so D1c does NOT inherit H4's Netlify block.

## 1. Problem

The estimator + versioning is deep, but the GC's output to the client is "a number," not a signable proposal. The market's loved flow (JobTread/Houzz) is: pick a priced revision → send a branded proposal → client e-signs → it's the agreement. MAGE already has every primitive:
- **Versioning (D1a):** `project.estimateVersions: EstimateRevision[]` (`utils/estimateCommit.ts`): `{ id, revNumber, snapshot: LinkedEstimate, grandTotal, reason, note?, createdAt }` — immutable priced snapshots.
- **Contract e-sign machinery:** `utils/contractEngine.ts` (`buildDraftContract({project, contractValue?, scopeText?})` → `project_contracts` row; `defaultPaymentSchedule`; `saveContract`; `setContractStatus`), `app/contract.tsx` (GC builds → `handleSignAndSend` GC-signs + `status='sent'`), portal renders any `project_contracts` row `status≥sent` via `contracts_client_select` (anon) and the client e-signs (H4-hardened `portal_sign_contract` SECURITY DEFINER RPC; currently in safe-holding so the *live* pre-H4 portal still signs via its existing path). Signed → signed-PDF.

D1c connects these: a **proposal is a `project_contracts` row whose content is generated from a chosen saved `EstimateRevision`**, sent for client e-signature via the **existing, already-deployed** contract→portal→sign flow.

## 2. Goal / Non-goals

**Goal:** From a project with ≥1 saved `EstimateRevision`, the GC taps "Create proposal from estimate", picks a revision, and gets a generated, GC-branded proposal (scope + priced total + payment schedule) they sign & send in one flow. The client e-signs it in the portal (the existing contract card). A signed proposal IS the executed agreement. The proposal is immutably linked to the exact `EstimateRevision` it was built from.

**Non-goals (YAGNI / risk / un-blocking):**
- **No portal-HTML change.** The proposal must render + sign on the *existing already-deployed* portal contract card (title conveys "Proposal"). A bespoke branded portal proposal layout would require a portal-HTML deploy = the SAME Netlify pipeline blocking H4 → explicitly out of scope (logged §7). v1 reuses the contract card verbatim.
- No new e-sign path (reuse the H4-hardened contract sign path 1:1).
- No separate "convert proposal → contract" machinery — a signed proposal already IS a `project_contracts` row = the binding agreement (a `kind` flag is informational only).
- No new branding system — reuse whatever GC company/profile branding the existing contract PDF already uses.
- No multi-proposal negotiation/versioning UI beyond "supersede by sending a new one" (each send is its own row; the revision link gives the audit trail).
- Not the per-project cost-book (D1b-2) — unrelated.

## 3. Why this does NOT inherit H4's Netlify block

H4 is in safe-holding: the live portal HTML is the pre-H4 version (renders `project_contracts` `status≥sent` and signs via its existing path; the RLS policy-drop is held). A proposal modeled as a `project_contracts` row therefore surfaces on the **already-live** portal contract card and is e-signable **today**, with **zero portal-HTML change**. D1c's only backend change is a small **additive** migration applied via Supabase MCP `apply_migration` (the H4-independent path) + app-side code (OTA). Nothing in D1c depends on the blocked Netlify marketing deploy. (When H4's portal HTML eventually redeploys, proposals keep working — the contract card + `portal_sign_contract` RPC handle them identically; the RPC already gates by status='sent' + portal token, model-agnostic to "contract" vs "proposal".)

## 4. Architecture

### 4.1 Entity model — reuse `project_contracts` + a tiny additive link

A proposal IS a `project_contracts` row. One small **additive, idempotent** migration (`supabase/migrations/<ts>_proposal_link.sql`, applied via MCP):
- `alter table public.project_contracts add column if not exists proposal_revision_id uuid;`  — the immutable link to the `EstimateRevision.id` the proposal was generated from (NULL for ordinary contracts).
- `alter table public.project_contracts add column if not exists kind text;`  — informational discriminator: `'proposal'` for proposal-originated rows, NULL/`'contract'` otherwise. Used by the GC app to label/list; the portal + RPC ignore it (model-agnostic). No NOT NULL/no default rewrite (safe on the live table).
- No RLS change: existing `contracts_client_select` (anon read when portal enabled) + `contracts_gc_*` (auth.uid()=user_id) + the H4 `portal_sign_contract` RPC already cover proposals (they're project_contracts rows). Confirm via read-only `pg_policies` during planning; do not alter.

### 4.2 Proposal generation (app-side, the "one tap")

Extend the contract-engine path (do not fork it): a `buildProposalFromRevision(project, revision: EstimateRevision, gcProfile)` in `utils/contractEngine.ts` (co-located with `buildDraftContract`, reusing its helpers) returning the same `Omit<ProjectContract,...>` shape with:
- `contractValue` = `revision.grandTotal`
- `title` = `"${project.name} — Project Proposal"` (conveys "proposal" on the existing portal card with no portal change)
- `scopeText` = a generated proposal body: GC/company header (from existing profile/branding the contract PDF already uses) + project + a readable scope/line-item summary derived from `revision.snapshot` (LinkedEstimate items grouped, with the priced total) + standard proposal terms (reuse the existing contract terms block; acceptance = signature).
- `paymentSchedule` = `defaultPaymentSchedule(revision.grandTotal)` (existing helper)
- `proposalRevisionId` = `revision.id`; `kind` = `'proposal'`
The `contractEngine` row mapper (`toRow`/`fromRow`) extends to (de)serialize `proposal_revision_id`↔`proposalRevisionId`, `kind`↔`kind` (additive, mirrors the existing field-map). `ProjectContract` type (types/index.ts) gains optional `proposalRevisionId?: string; kind?: 'contract' | 'proposal'`.

### 4.3 GC flow (reuse `app/contract.tsx` + a one-tap entry)

- Entry point: where saved revisions are visible (estimate/versioning UI and/or `app/contract.tsx` / project-detail) add **"Create proposal from estimate"** → a revision picker (list `project.estimateVersions` newest-first: revNumber, grandTotal, date, note) → on pick, `buildProposalFromRevision(...)` seeds the contract screen (reuse `app/contract.tsx`'s existing draft → review → `handleSignAndSend` exactly: GC signs, `status='sent'`). One tap to pick + one to sign & send. No new screen — the proposal is reviewed/sent through the existing contract screen (which already renders title/value/scope/payment/sign).
- "Sent" state: identical to a sent contract (the existing status banner). The proposal now visible to the client in the portal.

### 4.4 Client e-sign (existing, unchanged)

The portal already renders `project_contracts` `status≥sent` (`contracts_client_select` anon read) on the existing contract card and lets the client e-sign (live pre-H4 path today; H4 RPC after its eventual redeploy — both work, status/portal-token gated, model-agnostic). Signed ⇒ `status='signed'` + the existing signed-PDF path ⇒ **accepted proposal = executed agreement**. Zero portal/RPC change.

### 4.5 Accepted → it IS the contract

A signed proposal is already a `project_contracts` row with both signatures = the binding agreement. No conversion. The GC app, seeing `kind='proposal'` + `status='signed'`, labels it "Accepted proposal" and it functions as the project's contract (the existing contract screen already reads the active `project_contracts` row; `kind` is cosmetic). `proposal_revision_id` preserves which priced revision the client accepted (audit trail; ties to D1a versioning).

## 5. Error handling / correctness

- Generation is pure (`buildProposalFromRevision` from an immutable `EstimateRevision.snapshot`); persistence reuses `saveContract`/`setContractStatus` → the offline queue (H6b-hardened). No new write path.
- Guard: "Create proposal" disabled if `project.estimateVersions` is empty (nothing to propose) — inline hint to save a revision first.
- Immutability: the proposal snapshots the revision's totals/scope into `scopeText`/`contractValue` at generation time; later estimate edits do NOT mutate a sent proposal (it's a frozen `project_contracts` row, like a sent contract). `proposal_revision_id` records provenance.
- Migration is additive/idempotent (`add column if not exists`) — safe on the live `project_contracts` table, no rewrite, reversible (drop column) — within the autonomous-ship envelope; applied via MCP `apply_migration`, independent of the Netlify/H4 block.
- A pre-H4 vs post-H4 portal both sign it correctly (status='sent' + portal scope is all either path needs; `kind`/`proposal_revision_id` are inert to the portal/RPC).

## 6. Verification (no unit runner)

`npx tsc --noEmit` clean + manual walkthrough:
- Save an estimate revision (D1a) → "Create proposal from estimate" → pick it → contract screen seeded with the revision's total/scope/payment, title "… — Project Proposal", `kind='proposal'`, `proposalRevisionId` set → GC sign & send → `status='sent'`.
- Portal (existing): the proposal renders on the contract card; client e-signs; `status='signed'`; signed PDF generated — exactly like a contract, no portal change.
- GC app shows it as an accepted proposal; it functions as the project's contract; `proposal_revision_id` ties to the accepted revision.
- Editing the estimate after sending does NOT alter the sent/signed proposal. Empty-versions project → entry disabled with hint.
- Existing ordinary contracts (no `kind`/`proposal_revision_id`) behave byte-identically (regression check).
- Migration `apply_migration` succeeds; re-running is a no-op (idempotent).
- Final whole-impl review (opus).

## 7. Out of scope / future

- Bespoke branded portal **proposal layout** (distinct from the contract card) — requires a portal-HTML deploy = the Netlify pipeline currently blocking H4; deferred until that's unblocked, own spec.
- Proposal negotiation/counter-offer threads, multiple concurrent live proposals UI, proposal analytics (viewed/opened) — future.
- D1b-2 per-project cost-book — unrelated, separately queued.
