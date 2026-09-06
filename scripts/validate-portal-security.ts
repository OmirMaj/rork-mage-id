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

// ── Edge functions authorise through the choke point (AUTH-F7) ────────────────
// portal_project_for_token is the ONE place that knows what a valid portal link
// is (token + enabled, and expiry once 20260904100800 is applied). Until the
// 2026-09-05 review portal-ask-home and portal-mark-viewed read
// projects.client_portal and compared the token themselves, so an expired link
// still got AI answers and could stamp viewedAt. Comments are stripped first so
// prose about the old compare cannot satisfy or trip a check.
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const askHome = stripComments(read('supabase/functions/portal-ask-home/index.ts'));
const markViewed = stripComments(read('supabase/functions/portal-mark-viewed/index.ts'));
const inFileTokenCompare = /constantTimeEqual|client_portal\??\.accessToken|portal\??\.accessToken|select=[^`'"]*client_portal|select\(\s*["'][^"']*client_portal/;
ok('portal-ask-home loaded', askHome.length > 0);
ok('portal-ask-home authorises through /rpc/portal_project_for_token with the submitted token',
  askHome.includes('/rest/v1/rpc/portal_project_for_token') && /p_access_token:\s*accessToken\b/.test(askHome));
ok('portal-ask-home no longer compares client_portal.accessToken itself', !inFileTokenCompare.test(askHome),
  'an in-file compare ignores the expiry clause the choke point carries — expired links keep getting AI answers');
ok('portal-mark-viewed loaded', markViewed.length > 0);
ok('portal-mark-viewed authorises through rpc("portal_project_for_token") with the submitted token',
  /\.rpc\(\s*["']portal_project_for_token["']/.test(markViewed) && /p_access_token:\s*body\.accessToken\b/.test(markViewed));
ok('portal-mark-viewed no longer compares client_portal.accessToken itself', !inFileTokenCompare.test(markViewed),
  'an in-file compare ignores the expiry clause the choke point carries — expired links can still stamp viewedAt');
const expiry = read('supabase/migrations/20260904100800_portal_token_expiry_and_rotation.sql');
ok('the choke point carries the expiry clause (20260904100800)',
  /create or replace function public\.portal_project_for_token\(p_portal_id text, p_access_token text\)[\s\S]*?expires_at <= now\(\)/.test(expiry));

// ── Portal ids: unique and frozen (20260904100950) ───────────────────────────
// A portalId is client-written (projects.client_portal, the owner upsert) and
// sits in every homeowner link. With no uniqueness and a freeze trigger that
// pinned user_id only, a second project could carry a victim's id — the third-
// round finding: delete-account keyed its portal deletes on it. The migration
// must (1) refuse to build over duplicates and say only how many, (2) make the
// id unique across projects, (3) pin it against non-owners while leaving the
// owner's first enable and the 100800 rotation path alone, and (4) prove (3)
// on a temp table before its post-conditions. `--` comment lines are stripped
// so the header's prose cannot satisfy a check.
const uniqRaw = read('supabase/migrations/20260904100950_portal_id_unique_and_frozen.sql');
const uniq = uniqRaw.replace(/^[ \t]*--.*$/gm, '');
ok('20260904100950_portal_id_unique_and_frozen.sql present', uniqRaw.length > 0);
ok("it builds the UNIQUE partial index on (client_portal->>'portalId'), excluding NULL and the '' placeholder",
  /create unique index if not exists projects_client_portal_portal_id_uidx\s+on public\.projects \(\(client_portal->>'portalId'\)\)\s+where nullif\(client_portal->>'portalId', ''\) is not null;/.test(uniq),
  "'' is DEFAULT_PORTAL's placeholder (app/client-portal-setup.tsx); two projects holding it must not collide");
ok('it refuses to build over duplicates and reports a COUNT, never the ids',
  /having count\(\*\) > 1/.test(uniq)
  && /raise exception '\[100950\] % portalId value\(s\) are shared by % projects/.test(uniq)
  && !/string_agg|array_agg/.test(uniq),
  "Postgres's own 23505 message would print a victim's link id into the migration log");
ok('the freeze trigger keeps the user_id reset', /new\.user_id := old\.user_id;/.test(uniq));
ok('a non-owner change of portalId is reset to the old value, and a minted one is stripped',
  /jsonb_build_object\('portalId', old\.client_portal->>'portalId'\)/.test(uniq) && /new\.client_portal - 'portalId'/.test(uniq));
ok('the portalId freeze sits under the non-owner guard only (owner first-enable and token rotation untouched)',
  /if auth\.uid\(\) is not null and auth\.uid\(\) is distinct from old\.user_id then\s+new\.user_id := old\.user_id;\s+if \(new\.client_portal->>'portalId'\) is distinct from \(old\.client_portal->>'portalId'\) then/.test(uniq),
  'a reset that fires for the owner would break first enable; one outside the guard would break service-role writes');
ok('the migration self-tests the trigger on a TEMP table before its post-conditions',
  /create temp table projects_freeze_probe/.test(uniq)
  && uniq.indexOf('create temp table projects_freeze_probe') < uniq.indexOf("pg_get_functiondef('public.projects_freeze_ownership_columns()'"),
  'catalog checks prove the body was replaced, not that it behaves');
ok('the self-test covers owner-may-set, non-owner cannot change / free / mint, user_id still frozen, service role untouched',
  ['self-test (a)', 'self-test (b)', 'self-test (c)', 'self-test (d)', 'self-test (e)', 'self-test (f)'].every(k => uniq.includes(k)));
ok('the file leaves the token trigger and the choke point alone (100800 owns them)',
  !/function public\.portal_set_access_token/.test(uniq) && !/function public\.portal_project_for_token/.test(uniq));
ok('it asserts the freeze fires before trg_portal_access_token (same-event triggers fire in name order)',
  /order by tgname/.test(uniq) && /trg_portal_access_token/.test(uniq),
  "a stripped id must never reach the token trigger's mint branch");

// ── Passcode brute-force limiter ──────────────────────────────────────────────
const passcode = read('supabase/functions/validate-portal-passcode/index.ts');
ok('validate-portal-passcode rate-limits attempts', /rateLimitCount\(`passcode:portal:/.test(passcode) && /rateLimitCount\(`passcode:ip:/.test(passcode));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
