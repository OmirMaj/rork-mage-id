// scripts/validate-portal-security.ts — drift guard for the 2026-07-13 portal
// token-gating. The portal/sub-portal pages are static HTML (not typechecked), so
// this asserts they read/write ONLY through the accessToken-gated RPCs and never
// via direct PostgREST table access — the exact regression that caused the
// cross-tenant leak. It also checks the migration created the RPCs + dropped the
// anon table policies. Fails ship-check if any of these are undone.
//
// Path relative to repo root (ship-check runs validators from there).
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra ? `\n   ${extra}` : ''); }
}
const read = (p: string): string => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };

// ── Client portal HTML ────────────────────────────────────────────────────────
const portal = read('marketing/portal/index.html');
ok('portal/index.html loaded', portal.length > 0);
ok('portal defines getPortalToken() from ?t=', /function getPortalToken\(\)/.test(portal) && /URLSearchParams\(window\.location\.search\)\.get\('t'\)/.test(portal));
for (const rpc of ['portal_get_snapshot', 'portal_get_messages', 'portal_post_message', 'portal_submit_co_approval', 'portal_submit_budget_proposal']) {
  ok(`portal calls /rpc/${rpc}`, portal.includes('/rest/v1/rpc/' + rpc));
}
ok('portal passes p_access_token on every portal RPC', (portal.match(/p_access_token:\s*(getPortalToken\(\)|token\b)/g) ?? []).length >= 5);
// Must NOT hit the sensitive tables via direct PostgREST anymore.
ok('portal has NO direct portal_snapshots REST read', !/\/rest\/v1\/portal_snapshots\?/.test(portal),
  'reads must go through the portal_get_snapshot RPC, not GET /rest/v1/portal_snapshots');
ok('portal has NO direct portal_messages REST access', !/\/rest\/v1\/portal_messages(\?|['"])/.test(portal));
ok('portal has NO direct change_order_approvals REST insert', !/\/rest\/v1\/change_order_approvals/.test(portal));
ok('portal has NO direct portal_budget_proposals REST insert', !/\/rest\/v1\/portal_budget_proposals/.test(portal));

// ── Sub-portal HTML ───────────────────────────────────────────────────────────
const sub = read('marketing/sub-portal/index.html');
ok('sub-portal/index.html loaded', sub.length > 0);
ok('sub-portal defines getSubToken() from ?t=', /function getSubToken\(\)/.test(sub));
ok('sub-portal calls /rpc/sub_portal_get_snapshot', sub.includes('/rest/v1/rpc/sub_portal_get_snapshot'));
ok('sub-portal calls /rpc/sub_portal_submit_invoice', sub.includes('/rest/v1/rpc/sub_portal_submit_invoice'));
ok('sub-portal has NO direct sub_portal_snapshots REST read', !/\/rest\/v1\/sub_portal_snapshots\?/.test(sub));
ok('sub-portal has NO direct sub_submitted_invoices REST insert', !/\/rest\/v1\/sub_submitted_invoices(\?|['"])/.test(sub));

// ── Migrations (split: PART 1 additive RPCs, PART 2 breaking drops) ────────────
const rpcs = read('supabase/migrations/20260713150000_portal_token_rpcs.sql');
const lock = read('supabase/migrations/20260713150001_portal_lock_direct_access.sql');
ok('portal RPC migration (part 1) present', rpcs.length > 0);
ok('portal lock migration (part 2) present', lock.length > 0);
ok('migration validates the accessToken', /client_portal->>'accessToken' = p_access_token/.test(rpcs));
for (const rpc of ['portal_get_snapshot', 'portal_post_message', 'portal_submit_co_approval', 'portal_submit_budget_proposal', 'sub_portal_get_snapshot', 'sub_portal_submit_invoice']) {
  ok(`migration creates ${rpc}`, new RegExp(`create or replace function public\\.${rpc}\\(`).test(rpcs));
}
ok('migration drops the anon USING(true) snapshot reads', /drop policy if exists portal_snapshots_anon_read/.test(lock) && /drop policy if exists sub_portal_snapshots_anon_read/.test(lock));
ok('migration drops the anon write-forgery policies', /drop policy if exists "client submits CO approvals"/.test(lock) && /drop policy if exists "portal can submit proposals"/.test(lock));
ok('migration revokes anon SELECT on snapshot tables', /revoke select on public\.portal_snapshots\s+from anon/.test(lock));

// ── Passcode brute-force limiter ──────────────────────────────────────────────
const passcode = read('supabase/functions/validate-portal-passcode/index.ts');
ok('validate-portal-passcode rate-limits attempts', /rateLimitCount\(`passcode:portal:/.test(passcode) && /rateLimitCount\(`passcode:ip:/.test(passcode));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
