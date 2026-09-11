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
import { roleForUser } from '../utils/projectRole';
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
