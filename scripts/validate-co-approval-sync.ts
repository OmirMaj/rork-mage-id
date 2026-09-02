// validate-co-approval-sync.ts — a write nobody is allowed to make, awaited
// as if it succeeded.
//
// WHY THIS EXISTS. change_order_approvals had RLS enabled and exactly two
// policies — SELECT and INSERT, both TO authenticated — and no UPDATE policy at
// all. Confirmed against production pg_policies on 2026-09-02. RLS is
// deny-by-default, so the portal approval reconciler's
//
//   await supabase.from('change_order_approvals')
//     .update({ synced_to_co_at: ... }).eq('id', row.id)
//
// matched zero rows on every account, forever. PostgREST does not treat that as
// an error: it returns 200 with an empty body. The await resolved, the catch
// never fired, nothing was logged, and synced_to_co_at was never written.
//
// The user-visible consequence came from the reconciler's own query, which is
// `.is('synced_to_co_at', null).order(created_at asc).limit(50)`. With the
// stamp permanently failing, the same 50 oldest approvals occupied that window
// for the life of the account. Past a contractor's 50th lifetime portal
// decision, approval #51 onward was never reconciled — the homeowner e-signed
// the change order, the money was committed, and the CO sat at 'pending' in the
// contractor's app with no indication anything had happened. Below that
// threshold the failure inverted: every unsynced row was re-applied on every
// 90-second poll, so a GC who deliberately reverted a client-approved CO had it
// silently re-flipped to 'approved' with a duplicate audit entry appended each
// time, and could not undo a portal approval at all.
//
// THREE INVARIANTS, and all three are needed:
//
//   1. The UPDATE policy exists, and its WITH CHECK carries the same ownership
//      predicate as its USING. (USING guards the OLD row, WITH CHECK the NEW
//      one — see scripts/validate-rls-write-leaks.ts.)
//   2. The evidence columns are frozen by trigger. The policy grants the whole
//      row, and this table is the E-SIGN/UETA record: signature_data,
//      signature_hash, consent_record, document_hash, sealed_at and `decision`
//      are all written by a SECURITY DEFINER RPC that verifies the hash itself.
//      A signed record the counterparty can edit afterwards is not evidence.
//   3. The client asserts on the row count. A policy can be dropped, a project
//      can be restored from an older schema, and the whole failure mode above
//      was invisible precisely because a denied write looks like a successful
//      one. `.select()` on the update is the only thing that makes it visible.
//
// Static checks against the migration and the hook, so this runs offline and in
// CI with no database credentials.
//
// Run via: bun run test:co-approval-sync

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIG = join(ROOT, 'supabase', 'migrations', '20260902140000_co_approval_update_policy.sql');
const HOOK = join(ROOT, 'hooks', 'usePortalApprovalReconciler.ts');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, why ? `\n      ${why}` : ''); }
}

console.log('\nportal CO approval sync (the stamp has to actually land):');

// ── the migration ───────────────────────────────────────────────────────────
ok('the closing migration is present', existsSync(MIG),
  `expected ${MIG} — without an UPDATE policy the reconciler stalls silently`);

if (existsSync(MIG)) {
  const mig = readFileSync(MIG, 'utf8');

  ok('change_order_approvals has an UPDATE policy',
    /create policy\s+"gc stamps own CO approvals"[\s\S]{0,200}?on public\.change_order_approvals[\s\S]{0,120}?for update/i.test(mig),
    'RLS is deny-by-default: with no UPDATE policy every stamp matches zero rows');

  const policy = /create policy\s+"gc stamps own CO approvals"([\s\S]*?);/i.exec(mig)?.[1] ?? '';
  const using = /using\s*\(([\s\S]*?)\)\s*with check/i.exec(policy)?.[1] ?? '';
  const check = /with check\s*\(([\s\S]*)\)/i.exec(policy)?.[1] ?? '';

  ok('...whose USING scopes to projects the caller owns',
    /projects/.test(using) && /auth\.uid\(\)/.test(using),
    'the predicate must match "gc reads own CO approvals" so write scope ' +
    'cannot drift from read scope');

  ok('...and whose WITH CHECK repeats the ownership test',
    /projects/.test(check) && /auth\.uid\(\)/.test(check),
    'WITH CHECK is evaluated against the NEW row; omitting ownership there is ' +
    'how a row gets re-pointed at another tenant (see validate-rls-write-leaks)');

  ok('the e-signature evidence columns are frozen by trigger',
    /change_order_approvals_freeze_evidence/.test(mig)
      && /new\.signature_data\s*:=\s*old\.signature_data/.test(mig)
      && /new\.decision\s*:=\s*old\.decision/.test(mig)
      && /new\.document_hash\s*:=\s*old\.document_hash/.test(mig)
      && /new\.consent_record\s*:=\s*old\.consent_record/.test(mig),
    'the UPDATE policy grants the whole row — without the freeze a contractor ' +
    'could rewrite decision from declined to approved, or swap the client\'s ' +
    'signature, and the row would still carry a valid-looking seal');

  ok('...but synced_to_co_at is NOT frozen',
    !/new\.synced_to_co_at\s*:=\s*old\.synced_to_co_at/.test(mig),
    'pinning the one column the reconciler writes would re-create the original ' +
    'stall with a trigger instead of a policy');
}

// ── the client ──────────────────────────────────────────────────────────────
const hook = readFileSync(HOOK, 'utf8');

// The update must carry a returning clause. Anchored on the update call itself
// so an unrelated `.select(` elsewhere in the file cannot satisfy it.
const stamp = /\.update\(\{\s*synced_to_co_at[\s\S]{0,240}?;/.exec(hook)?.[0] ?? '';
ok('the stamp asks PostgREST for the affected rows',
  /\.select\(/.test(stamp),
  'without a returning clause an RLS-denied UPDATE is a 200 with an empty ' +
  'body, indistinguishable from success — this is the exact shape that hid ' +
  'the stall for the life of the feature');

ok('...and a zero-row result is treated as a failure',
  /data\.length === 0/.test(hook) && /RLS/.test(hook),
  'error === null is not enough; the reconciler has to notice that it wrote ' +
  'nothing, or the 50-row window jams and change orders never leave pending');

ok('re-application is gated on the audit trail, not on the stamp',
  /alreadyApplied/.test(hook) && /trail\.some\(/.test(hook),
  'if the stamp fails the row returns on the next poll. Without an idempotence ' +
  'key derived from the approval row, a GC who reverts a client-approved CO ' +
  'has it re-flipped within 90 seconds with a duplicate audit entry');

ok('the audit entry id has exactly one definition',
  (hook.match(/`audit-portal-\$\{/g) ?? []).length === 1,
  'the entry id is also the idempotence key — a second literal is a second ' +
  'chance for the writer and the reader to disagree');

if (fail > 0) {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`\n${pass} passed, 0 failed\n`);
