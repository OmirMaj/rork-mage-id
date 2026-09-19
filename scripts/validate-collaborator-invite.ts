// validate-collaborator-invite.ts — pins the project-role derivation and the
// Pro tier gate for Live Schedule Collaboration Phase 1.
//
// ── WHY THE LAST SECTION EXISTS ─────────────────────────────────────────────
// `expect('schedule_collaboration gates to pro', …)` below was GREEN for the
// whole life of the bug it was supposed to guard. The constant was correct;
// the place the component ASKED about it was not. CollaboratorsManager put
// `if (!canAccess('schedule_collaboration')) router.push('/paywall')` ABOVE the
// role test, so a free-tier GC inviting a sub as role 'field' — free at every
// tier, per utils/seatModel and per supabase/functions/project-invite, which
// seat-checks only billable roles — was bounced to the paywall and could not
// add a single sub. Meanwhile marketing/index.html answers "Do my subs really
// use it for free?" with "Yes."
//
// A constant check could never have caught that, so the last section evaluates
// the SHIPPED gate expression, lifted verbatim out of the component source and
// run against the real isBillableSeat and the real tierMeetsRequirement, for
// every (tier × role) pair. Reordering or widening the gate turns it red.
// Run via: bun run scripts/validate-collaborator-invite.ts
import { readFileSync } from 'node:fs';
import { roleForUser, resolveRoleState, ROLE_PAUSED_NOT_ON_PHONE, ROLE_PAUSED_UNKNOWN } from '../utils/projectRole';
import { REQUIRED_TIER, tierMeetsRequirement } from '../utils/featureTiers';
import { isBillableSeat } from '../utils/seatModel';
import type { SubscriptionTier } from '../types';
import type { ProjectCollaborator } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want)); }
}

const mk = (o: Partial<ProjectCollaborator>): ProjectCollaborator => ({
  id: 'x', email: 'x@x', name: '', role: 'editor', status: 'accepted', invitedAt: '', userId: null, ...o,
});

console.log('\nproject role derivation:');
expect('accepted editor → editor', roleForUser([mk({ role: 'editor', status: 'accepted', userId: 'u1' })], 'u1'), 'editor');
expect('accepted viewer → viewer', roleForUser([mk({ role: 'viewer', status: 'accepted', userId: 'u2' })], 'u2'), 'viewer');
expect('no collaborator rows → owner', roleForUser([], 'owner'), 'owner');
expect('has collaborators but not me → owner', roleForUser([mk({ userId: 'other', status: 'accepted' })], 'owner'), 'owner');
expect('pending row not counted → owner', roleForUser([mk({ role: 'viewer', status: 'pending', userId: 'u3' })], 'u3'), 'owner');
expect('revoked row not counted → owner', roleForUser([mk({ role: 'editor', status: 'revoked', userId: 'u4' })], 'u4'), 'owner');
expect('no uid → null', roleForUser([], null), null);

// #90 (wave 3): the owner is known — a removed collaborator is NOT the owner.
console.log('\nproject role with the owner stamp (#90):');
expect('removed foreman: list empty, owner is the GC → null (was owner)', roleForUser([], 'foreman', 'gc'), null);
expect('revoked row, owner is the GC → null', roleForUser([mk({ role: 'field', status: 'revoked', userId: 'foreman' })], 'foreman', 'gc'), null);
expect('accepted row still gives its role with a known owner', roleForUser([mk({ role: 'field', status: 'accepted', userId: 'foreman' })], 'foreman', 'gc'), 'field');
expect('his own project (owner stamp = him) → owner', roleForUser([], 'gc', 'gc'), 'owner');
expect('owner unknown (legacy cache / his unsynced create) → owner, never locked out', roleForUser([], 'gc', undefined), 'owner');
expect('owner null → owner', roleForUser([], 'gc', null), 'owner');

console.log('\nthe role hook\'s decision (resolveRoleState):');
const rs = (o: Partial<Parameters<typeof resolveRoleState>[0]>) => resolveRoleState({
  projectId: 'p', uid: 'foreman', ownerUserId: 'gc', cachedRole: undefined, collaborators: [],
  isLoading: false, isError: false, isPending: false, ...o,
});
expect('settled, removed → null, NOT loading, NOT error (the gate says why, never spins)', rs({}), { role: null, isLoading: false, isError: false, isPaused: false });
expect('his own job → owner even while the read is paused offline', rs({ uid: 'gc', isPending: true }), { role: 'owner', isLoading: false, isError: false, isPaused: false });
expect('his own job → owner even when the read failed', rs({ uid: 'gc', isError: true }), { role: 'owner', isLoading: false, isError: false, isPaused: false });
expect('read failed on the GC\'s job → null with isError', rs({ isError: true }), { role: null, isLoading: false, isError: true, isPaused: false });
expect('read in flight → loading', rs({ isLoading: true, isPending: true }), { role: null, isLoading: true, isError: false, isPaused: false });
expect('paused offline with his cached field role → field (the last role the device knew)', rs({ isPending: true, cachedRole: 'field' }), { role: 'field', isLoading: false, isError: false, isPaused: true });
expect('paused offline, owner unknown, job IN the cache (his offline create) → owner', rs({ isPending: true, ownerUserId: undefined, inCache: true, fetchPaused: true }), { role: 'owner', isLoading: false, isError: false, isPaused: true });
// Review round 1: a deep link offline to a job this phone never held (or
// already forgot) has no owner stamp either — it must NOT be owner.
expect('REVIEW CASE: paused offline, job NOT in the cache (no hint) → null, settled, with the reason — never owner',
  rs({ isPending: true, ownerUserId: undefined, inCache: false, fetchPaused: true }),
  { role: null, isLoading: false, isError: false, isPaused: true, reason: ROLE_PAUSED_NOT_ON_PHONE });
expect('...an unknown-cache caller (inCache absent) is not owner either', rs({ isPending: true, ownerUserId: undefined, fetchPaused: true }).role, null);
expect('paused offline, someone else\'s job, no cached role → null with the reason, not an endless spinner',
  rs({ isPending: true, inCache: true, fetchPaused: true }), { role: null, isLoading: false, isError: false, isPaused: true, reason: ROLE_PAUSED_UNKNOWN });
expect('pending but not yet fetching (about to start) → loading, not paused, never owner', rs({ isPending: true, inCache: true, fetchPaused: false }),
  { role: null, isLoading: true, isError: false, isPaused: false });
expect('...legacy caller without fetchPaused → loading + paused, never owner', rs({ isPending: true }), { role: null, isLoading: true, isError: false, isPaused: true });
expect('answered with his accepted editor row → editor', rs({ collaborators: [mk({ role: 'editor', status: 'accepted', userId: 'foreman' })] }), { role: 'editor', isLoading: false, isError: false, isPaused: false });
expect('no project → null, settled', rs({ projectId: undefined }), { role: null, isLoading: false, isError: false, isPaused: false });
{
  const hook = readFileSync('hooks/useProjectRole.ts', 'utf8');
  expect('useProjectRoleState passes the cached owner stamp and role into resolveRoleState',
    /ownerUserId: hint\?\.ownerUserId,/.test(hook) && /cachedRole: hint\?\.myRole,/.test(hook) && /isPending: !!projectId && \(status === undefined \|\| status === 'pending'\)/.test(hook)
      && /inCache: !!hint,/.test(hook) && /fetchPaused: queryState\?\.fetchStatus === 'paused',/.test(hook), true);
  expect('the two public call shapes are unchanged',
    /export function useProjectRoleState\(projectId: string \| undefined\): ProjectRoleState \{/.test(hook)
      && /export function useProjectRole\(projectId: string \| undefined\): ProjectRole \{/.test(hook), true);
}

console.log('\ntier gate:');
expect('schedule_collaboration gates to pro', REQUIRED_TIER['schedule_collaboration'], 'pro');

// ── The shipped paywall gate, evaluated ─────────────────────────────────────
console.log('\nthe paywall gate as CollaboratorsManager actually writes it:');
{
  const src = readFileSync('components/collaborators/CollaboratorsManager.tsx', 'utf8');

  // COUNT, don't just find. The first version of this section used a
  // non-global `exec` and asserted `!!m` — a presence test wearing the word
  // "exactly". Re-adding the original tier-first gate as a SECOND line below
  // the fixed one left this whole section green while free-tier field invites
  // were paywalled again, because `exec` only ever saw the first match.
  const gates = [...src.matchAll(/\n\s*if \(([^\n]*?)\) \{ router\.push\('\/paywall'\); return; \}/g)];
  expect('exactly one paywall-routing gate in onInvite', gates.length, 1);

  // Catch-all for the forms the line regex cannot see (a multi-line `if`, a
  // ternary, a different quote style). Two `/paywall` pushes exist in this
  // file by design: the gate, and the "See plans" button in the out-of-seats
  // alert. A third means someone added routing this guard is not evaluating —
  // fail, and make them come here and teach it the new shape.
  const allPushes = [...src.matchAll(/router\.push\(['"]\/paywall['"]\)/g)];
  expect('exactly two /paywall pushes in the file (the gate + the alert button)', allPushes.length, 2);

  if (gates.length === 0) {
    console.log('\n  the gate could not be located — the assertions below cannot run');
    console.log(`\n${pass} passed, ${fail + 1} failed`);
    process.exit(1);
  }
  gates.forEach((g, i) => console.log(`   gate source[${i}]:`, g[1]));

  // Evaluate the real expression(s) with the real collaborators bound in.
  // Nothing here re-implements the rule; it runs the one the component ships.
  // Every gate found is ORed, because in the component they run in sequence:
  // if ANY of them fires, the user lands on the paywall.
  const compiled = gates.map((g) => new Function(
    'isBillableSeat', 'canAccess', 'inviteRole',
    `return !!(${g[1]});`,
  ) as (
    isBillable: (r: string) => boolean,
    canAccess: (f: 'schedule_collaboration') => boolean,
    inviteRole: string,
  ) => boolean);

  const paywalls = (tier: SubscriptionTier, role: string) =>
    compiled.some((gate) =>
      gate(isBillableSeat, (f) => tierMeetsRequirement(tier, REQUIRED_TIER[f]), role));

  // Field is free at EVERY tier — this is the assertion the old guard could not make.
  for (const tier of ['free', 'pro', 'business', 'enterprise'] as const) {
    expect(`${tier}: inviting a FIELD collaborator is never paywalled`, paywalls(tier, 'field'), false);
  }
  // Admin roles still cost Pro, in both directions.
  for (const role of ['editor', 'viewer'] as const) {
    expect(`free: inviting an ${role} still hits the paywall`, paywalls('free', role), true);
    for (const tier of ['pro', 'business', 'enterprise'] as const) {
      expect(`${tier}: inviting an ${role} is allowed through`, paywalls(tier, role), false);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
