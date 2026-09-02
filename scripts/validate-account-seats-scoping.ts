// validate-account-seats-scoping.ts — the seat count must be scoped by the
// caller's OWN projects, not by RLS.
//
// WHY THIS EXISTS. hooks/useAccountSeats decides the number a GC reads on the
// team screen ("1/2 team seats used") and whether the invite sheet warns that
// the next teammate costs $15/mo. Until 2026-09-02 it selected
// project_collaborators with NO filter, carrying a comment asserting that
// `pc_owner_all` was the policy doing the scoping.
//
// That assertion was wrong, and wrong in the direction that overcharges.
// project_collaborators has TWO permissive policies that apply to SELECT, and
// permissive policies OR together:
//
//   pc_owner_all    FOR ALL     EXISTS (projects p WHERE p.id = project_id
//                                       AND p.user_id = auth.uid())
//   pc_invitee_read FOR SELECT  user_id = auth.uid()
//                               OR lower(invited_email) = lower(auth.jwt()->>'email')
//
// So the unfiltered select also returned every invite anyone else had ever sent
// to the caller's email. utils/seatModel countSeats drops only status 'revoked'
// and role 'owner', so a foreign 'editor' row was counted as a billable admin
// seat belonging to the caller. On Pro (2 included seats) one such row consumed
// half the allowance of an account that had invited nobody, and previewSeat
// then refused the first real invite with an upgrade prompt the server's
// seatCheck() would never have produced — the exact client/server divergence
// utils/seatModel's own header warns about.
//
// THE RULE: the seat query fetches the caller's owned project ids and filters
// `project_id` on them, mirroring seatCheck() in
// supabase/functions/project-invite/index.ts. Never rely on RLS for a number
// that is used to bill someone.
//
// Static + schema analysis only: no network, no bundler, no react-native
// import (those crash bun). Reads supabase/schema.sql, which mirrors production
// as of 2026-08-31.
//
// Run via: bun run test:account-seats-scoping

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countSeats, seatStatus, previewSeat, type SeatOccupant } from '../utils/seatModel';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOOK_REL = 'hooks/useAccountSeats.ts';
const SERVER_REL = 'supabase/functions/project-invite/index.ts';

const hook = readFileSync(join(ROOT, HOOK_REL), 'utf8');
const server = readFileSync(join(ROOT, SERVER_REL), 'utf8');
const schema = readFileSync(join(ROOT, 'supabase', 'schema.sql'), 'utf8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  PASS ', name); }
  else { fail++; console.log('  FAIL ', name, why ? `\n        ${why}` : ''); }
}

console.log('\naccount seat scoping (a billing number must not trust RLS):');

// ── 1. the premise: RLS genuinely cannot scope this table ───────────────────
const pcPolicies = [...schema.matchAll(
  /CREATE POLICY\s+(\S+)\s+ON\s+public\.project_collaborators\s+AS\s+(\S+)\s+FOR\s+(\S+)/gi,
)].map(m => ({ name: m[1], permissive: m[2].toUpperCase(), cmd: m[3].toUpperCase() }));

ok('project_collaborators policies parsed from schema.sql', pcPolicies.length > 0,
  'Found none — the schema dump shape changed, so every check below is vacuous. Re-read this guard.');

const readable = pcPolicies.filter(
  p => p.permissive === 'PERMISSIVE' && (p.cmd === 'SELECT' || p.cmd === 'ALL'),
);
ok(
  'more than one PERMISSIVE policy grants SELECT on project_collaborators',
  readable.length > 1,
  `Only ${readable.length} (${readable.map(p => p.name).join(', ') || 'none'}). If pc_invitee_read was ` +
  'deliberately removed, the database-side leak is closed and this guard\'s premise is gone — the ' +
  'explicit filter in the hook is still correct as defence in depth, so update this check rather than ' +
  'deleting the filter.',
);
ok(
  'pc_invitee_read still matches on the caller\'s email, not on project ownership',
  /CREATE POLICY\s+pc_invitee_read[\s\S]{0,400}?invited_email[\s\S]{0,200}?auth\.jwt\(\)/i.test(schema),
  'The policy that makes an unfiltered select cross-account no longer looks like it did. Re-verify ' +
  'against production before trusting the shape of this guard.',
);

// ── 2. the hook filters by owned project ids ────────────────────────────────
ok(
  `${HOOK_REL} reads the caller's own projects`,
  /\.from\(\s*['"]projects['"]\s*\)/.test(hook) && /\.eq\(\s*['"]user_id['"]\s*,\s*userId\s*\)/.test(hook),
  "Expected supabase.from('projects').select('id').eq('user_id', userId) — the seat scope has to come " +
  'from somewhere other than RLS.',
);
ok(
  `${HOOK_REL} constrains project_collaborators on project_id`,
  /\.in\(\s*['"]project_id['"]\s*,\s*ownedIds\s*\)/.test(hook),
  "The project_collaborators select is unfiltered again. pc_invitee_read ORs in every invite sent to " +
  "the caller's own email address, and each one is counted as a billable admin seat.",
);
ok(
  `${HOOK_REL} no longer claims RLS does the scoping`,
  !/RLS does the scoping/i.test(hook),
  'The false header comment is back. It is the reason the bug shipped: it told the next reader the ' +
  'unfiltered select was deliberate.',
);
ok(
  `${HOOK_REL} names pc_invitee_read so the next reader knows why the filter is there`,
  /pc_invitee_read/.test(hook),
  'Without the reason recorded, the filter looks redundant and gets deleted.',
);

// ── 3. client and server compute the same number ────────────────────────────
ok(
  `${SERVER_REL} seatCheck still filters collaborators by owned project ids`,
  /project_collaborators\?project_id=in\.\(/.test(server),
  'The server stopped scoping by project_id. Whatever the client does now, the two gates disagree.',
);

// ── 4. what the leak was worth, in the numbers the GC actually sees ─────────
// Not a test of the hook (it is a network hook); a pin on the user-visible
// consequence of one foreign row reaching countSeats, so the cost of removing
// the filter is written down in the same place as the rule.
{
  const foreign: SeatOccupant = { email: 'gc@self.com', role: 'editor', status: 'pending' };
  const leaked = seatStatus('pro', countSeats([foreign]));
  const clean = seatStatus('pro', countSeats([]));
  ok('one leaked invite reads as 1/2 seats used on Pro', leaked.used === 1 && leaked.included === 2);
  ok('…where the correctly-scoped count is 0/2', clean.used === 0 && clean.included === 2);
  ok('…and it halves the remaining allowance', leaked.remaining === 1 && clean.remaining === 2);

  // Two leaked rows are enough to lock a Pro account out of inviting anybody.
  const twoLeaked = countSeats([
    foreign,
    { email: 'other@self.com', role: 'viewer', status: 'accepted' },
  ]);
  const blocked = previewSeat('pro', twoLeaked, 'editor', 'realteammate@x.com');
  ok('two leaked invites would block the first real invite entirely', !blocked.allowed);
  ok('…with an upgrade prompt the server would never send', /upgrade/i.test(blocked.message));
}

if (fail > 0) {
  console.error(`\nvalidate-account-seats-scoping: ${fail} failed, ${pass} passed`);
  console.error('  A seat count is a billing number. Scope it explicitly.\n');
  process.exit(1);
}
console.log(`\nvalidate-account-seats-scoping: ${pass} passed, 0 failed\n`);
