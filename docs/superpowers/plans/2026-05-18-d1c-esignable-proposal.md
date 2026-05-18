# D1c — One-Tap E-Signable Proposal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** GC picks a saved `EstimateRevision`, taps "Create proposal", reviews/signs/sends it through the EXISTING contract screen; client e-signs via the EXISTING already-deployed portal contract flow; signed = accepted agreement; immutably linked to the revision.

**Architecture:** A proposal IS a `project_contracts` row generated from an `EstimateRevision`. Reuse `utils/contractEngine.ts` + `app/contract.tsx` + the existing portal sign path 1:1. One small additive idempotent migration adds `proposal_revision_id` + `kind`. **No portal-HTML change** → no H4/Netlify dependency.

**Tech Stack:** RN/Expo, TS strict, Supabase (`project_contracts`), the offline queue (via existing `saveContract`/`setContractStatus`). No unit runner — gate = `npx tsc --noEmit` + manual (spec §6).

**Spec:** `docs/superpowers/specs/2026-05-18-d1c-esignable-proposal-design.md` (@ `0148c23`). Worktree `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`, branch `claude/p0-launch-on-main`. Use `git -C "<that path>"`.

## CRITICAL
- **Build authors code only.** The migration is authored as a `.sql` file; **applying it is a SHIP-TIME controller step via Supabase MCP `apply_migration`** (additive/idempotent, independent of Netlify/H4) — NOT a build step. App code ships via OTA.
- **Zero portal-HTML change, zero estimator change, zero contract-sign-path change.** A proposal rides the existing generic contract card + `portal_sign_contract` RPC (model-agnostic). Do NOT touch `marketing/portal/`, the H4 RPCs, `applyAssembly`, estimate logic, or the existing `buildDraftContract`/`saveContract`/`setContractStatus`/portal behavior — only ADD alongside.
- Per-task gate: `npx tsc --noEmit` clean + the named manual reasoning.

## File Structure
- Create `supabase/migrations/20260518140000_proposal_link.sql` — Task 1 (additive columns).
- Modify `types/index.ts` (`ProjectContract` + 2 optional fields), `utils/contractEngine.ts` (row map + `buildProposalFromRevision`) — Task 2.
- Modify the D1a revision-surfacing UI + `app/contract.tsx` (seed-from-revision) — Task 3.

---

### Task 1: Additive migration (authored only)

**Files:** Create `supabase/migrations/20260518140000_proposal_link.sql`

- [ ] **Step 1** Create the file exactly:
```sql
-- D1c — link a project_contracts row to the EstimateRevision a proposal was
-- generated from, + an informational kind discriminator. Additive, idempotent,
-- no rewrite/NOT NULL/default — safe on the live project_contracts table.
-- Applied via Supabase MCP apply_migration at ship time (independent of the
-- Netlify/H4 block). The portal + portal_sign_contract RPC ignore these
-- columns (model-agnostic); no RLS change (existing contracts_* policies cover
-- proposals — they are project_contracts rows).
alter table public.project_contracts add column if not exists proposal_revision_id uuid;
alter table public.project_contracts add column if not exists kind text;
```
- [ ] **Step 2** Static check: file present; only `add column if not exists` (no NOT NULL, no default, no RLS/DDL beyond these two). `npx tsc --noEmit` clean (SQL-only; confirms repo compiles). **Do NOT apply it.**
- [ ] **Step 3** Commit:
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add supabase/migrations/20260518140000_proposal_link.sql
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(D1c): additive migration — project_contracts.proposal_revision_id + kind"
```

---

### Task 2: Types + contractEngine — proposal generation & round-trip

**Files:** Modify `types/index.ts`, `utils/contractEngine.ts`

- [ ] **Step 1** `types/index.ts`: in `interface ProjectContract` (around :276-296) add two OPTIONAL fields (additive, no existing field changed):
```ts
  proposalRevisionId?: string;
  kind?: 'contract' | 'proposal';
```

- [ ] **Step 2** `utils/contractEngine.ts` — extend the row map (do NOT change existing field handling):
  - In the DB-row interface (the `contract_value`/`scope_text`/`payment_schedule`/`status` shape ~:24-36) add `proposal_revision_id?: string | null;` and `kind?: string | null;`.
  - In `fromRow` (~:54-65) add: `proposalRevisionId: r.proposal_revision_id ?? undefined,` and `kind: (r.kind === 'proposal' ? 'proposal' : r.kind === 'contract' ? 'contract' : undefined),` (defensive — unknown/null → undefined; never throws).
  - In `saveContract`'s row builder (the `contract_value`/`scope_text`/`payment_schedule`/`status` object ~:197-207) add: `proposal_revision_id: c.proposalRevisionId ?? null,` and `kind: c.kind ?? null,`. (Offline-queue write path unchanged; these columns exist post-Task-1 migration. Pre-migration they'd be ignored only if the migration weren't applied — it IS applied at ship before this code reaches devices via OTA; note ordering in Ship section.)

- [ ] **Step 3** Add `buildProposalFromRevision` next to `buildDraftContract` in `utils/contractEngine.ts`, reusing its helpers/terms/`defaultPaymentSchedule`:
```ts
import type { EstimateRevision } from '@/types'; // if not already imported (use the existing import site)

/** One-tap proposal: a contract draft generated from an immutable saved
 *  EstimateRevision. Same shape as buildDraftContract; the priced scope +
 *  total come from the revision snapshot and are frozen into the row. */
export function buildProposalFromRevision(
  project: Project,
  revision: EstimateRevision,
): Omit<ProjectContract, 'id' | 'createdAt' | 'updatedAt' | 'userId'> {
  const value = revision.grandTotal ?? 0;
  const items = revision.snapshot?.items ?? [];
  const lineSummary = items
    .map(i => `• ${i.name}${i.quantity != null ? ` — ${i.quantity} ${i.unit ?? ''}`.trimEnd() : ''}`)
    .join('\n');
  const scopeText =
    `${project.name} — Project Proposal (Estimate Rev ${revision.revNumber})\n\n` +
    `SCOPE OF WORK\n${lineSummary || (project.description ?? 'See attached estimate.')}\n\n` +
    `TOTAL PROPOSED PRICE: $${value.toLocaleString()}\n\n` +
    STANDARD_CONTRACT_TERMS + // reuse the existing exported terms block constant in this file
    `\n\nACCEPTANCE: Signing below accepts this proposal as the binding agreement for the scope and price stated above.`;
  return {
    projectId: project.id,
    title: `${project.name} — Project Proposal`,
    contractValue: value,
    scopeText,
    paymentSchedule: defaultPaymentSchedule(value),
    status: 'draft',
    proposalRevisionId: revision.id,
    kind: 'proposal',
    // ...mirror every other non-optional field exactly as buildDraftContract returns it
    // (gc/homeowner signature defaults, any other fields in the Omit<> shape) —
    // read buildDraftContract's full return and replicate field-for-field, only
    // overriding title/contractValue/scopeText/paymentSchedule/status/kind/proposalRevisionId.
  };
}
```
Read `buildDraftContract`'s real full return object and the real `STANDARD_CONTRACT_TERMS`/terms constant name; replicate every field it sets (so a proposal row is structurally a valid contract draft) — only override the listed ones. If `EstimateRevision`/`LinkedEstimateItem` field names differ (`snapshot.items[].name/quantity/unit`), adapt to the real shape (read `types/index.ts`/`utils/estimateCommit.ts`).

- [ ] **Step 4** Gate: `npx tsc --noEmit` clean. Reason: `ProjectContract` additive (existing contracts unaffected — new fields optional/undefined); `fromRow`/`saveContract` round-trip the 2 columns defensively; `buildProposalFromRevision` returns a valid contract-draft shape with the revision's frozen total/scope. No existing export changed.

- [ ] **Step 5** Commit:
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add types/index.ts utils/contractEngine.ts
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(D1c): ProjectContract proposal fields + buildProposalFromRevision"
```

---

### Task 3: One-tap entry + revision picker → existing contract screen

**Files:** Modify the D1a revision-surfacing screen (locate it) + `app/contract.tsx`

- [ ] **Step 1** Locate where saved revisions are shown: `grep -rn "estimateVersions\|revNumber\|EstimateRevision" app/ components/` (D1a's revision-history UI — likely in the estimate/versioning screen, project-detail, or a RevisionHistory component). Read it + `app/contract.tsx`'s seed logic (`useLocalSearchParams<{ projectId }>()` ~:69; `buildDraftContract({ project })` seed ~:90).

- [ ] **Step 2** In `app/contract.tsx`: extend the route params to `useLocalSearchParams<{ projectId: string; fromRevision?: string }>()`. In the seed branch (where it currently does `buildDraftContract({ project })` when no active contract exists), if `fromRevision` is set AND there is no existing active (non-draft) contract, find `const rev = project.estimateVersions?.find(v => v.id === fromRevision)` and seed with `buildProposalFromRevision(project, rev)` instead of `buildDraftContract({ project })` (fall back to `buildDraftContract` if `rev` not found). Change NOTHING else in the screen — the existing draft→review→`handleSignAndSend` (GC signs, status='sent') path is reused verbatim for proposals. (A proposal is just a seeded draft with kind='proposal'.)

- [ ] **Step 3** In the revision UI (Step 1 location): add a **"Create proposal from estimate"** affordance. If multiple revisions, a lightweight picker (list `project.estimateVersions` newest-first: `Rev {revNumber} · ${grandTotal.toLocaleString()} · {date}{note?}`); on select → `router.push({ pathname: '/contract', params: { projectId: project.id, fromRevision: rev.id } })` (match the repo's existing typed-route push pattern for the contract screen). If the screen already shows a single current revision, the action can default to it. Disable/hide the action when `(project.estimateVersions ?? []).length === 0` with an inline hint ("Save an estimate revision first"). Reuse existing buttons/list styles — no new design system. Do NOT alter existing revision-history behavior; only ADD the entry.

- [ ] **Step 4** Gate: `npx tsc --noEmit` clean. Manual reasoning (+ `bun run start` if quick): with a saved revision, the action navigates to the contract screen seeded from that revision (title "… — Project Proposal", value = rev.grandTotal, scope = generated body, kind='proposal'); GC sign & send → status='sent' exactly like a contract; no-revisions → action disabled. Existing contract creation (no `fromRevision`) byte-identical. No portal/estimator change.

- [ ] **Step 5** Commit:
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add app/
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(D1c): create-proposal-from-revision entry → existing contract sign flow"
```

---

## Ship (controller, after final whole-impl review — NOT build)
1. FF-merge `claude/p0-launch-on-main` → `main`, push.
2. Apply the migration via Supabase MCP `apply_migration` (name `proposal_link`, the Task-1 SQL) — additive/idempotent, independent of Netlify/H4. **Apply BEFORE the OTA reaches devices** (sequence: apply migration → then `eas update`) so `saveContract` writing `proposal_revision_id`/`kind` always hits a table that has the columns. (Even if reversed: pre-migration writes including the new keys would 400 like any unknown column — so order matters; apply migration first.)
3. `eas update --branch production --message "D1c e-signable proposal"`.
(Independent of H4's Netlify block — no portal-HTML change.)

## Self-Review
**Spec coverage:** §4.1 entity model+migration → Task 1 + Task 2 round-trip. §4.2 generation → Task 2 `buildProposalFromRevision`. §4.3 GC flow/one-tap → Task 3. §4.4 client e-sign (existing, unchanged) → no task needed (reused as-is; verified in §6 manual). §4.5 accepted=contract → inherent (it's a project_contracts row; `kind` cosmetic — no task). §5 error handling → Task 2 defensive fromRow + empty-versions guard Task 3. §3 no-Netlify-dependency → enforced (no `marketing/` file in any task). Decomposition: D1b-2 not in scope. No gaps.
**Placeholder scan:** Migration SQL + type fields + fromRow/saveContract maps given verbatim. `buildProposalFromRevision` body is concrete; the "replicate buildDraftContract's other fields field-for-field" + "use the real terms constant name / EstimateRevision shape" are precise in-situ directives against named anchors (reproducing buildDraftContract's full return in the plan risks drift vs the live source — read+replicate is correct). Task 3's "locate the D1a revision UI" is a precise grep-directed anchor. No vague TODOs.
**Type/name consistency:** `proposalRevisionId`/`kind` (ProjectContract) ↔ `proposal_revision_id`/`kind` (row) consistent across Tasks 1-2. `buildProposalFromRevision(project, revision)` signature consistent Tasks 2-3. `fromRevision` route param consistent Task 3 (UI push ↔ contract.tsx read). Reuses real existing symbols: `buildDraftContract`, `defaultPaymentSchedule`, `saveContract`, `setContractStatus`, `EstimateRevision`, `project.estimateVersions` (D1a). Migration filename timestamp `20260518140000` sorts after the H4/D-series migrations.
