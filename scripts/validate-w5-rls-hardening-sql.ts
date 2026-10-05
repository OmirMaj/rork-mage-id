// scripts/validate-w5-rls-hardening-sql.ts — wave 5, rls-hardening lane.
//
// Static half of the guard for supabase/migrations/20260923170000_rls_hardening.sql
// and the held key strip (held/20260923171000_portal_token_strip.sql):
//   #82  the homeowner portal key lives in owner-only portal_credentials
//   #85  collaborator rows: ownership frozen (aa_ trigger before wave 4's), a
//        signed T&M ticket sealed on the server with the app's own price rule
//   #179 field seats overwrite project documents only under daily-reports/
//   #181 Hire conversation membership can't be self-granted
//   #61  a job with safety incidents can't be deleted by a signed-in caller
//        (23001, never 23503; the service role passes)
// The executed half (every rule run against production-shaped stubs, twice) is
// the PGlite script named in the migration header, w5rls_pg/w5_rls_hardening.mjs
// in the lane scratchpad.
//
// Run via: bun run scripts/validate-w5-rls-hardening-sql.ts

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEALED_FIELD_TICKET_PRICE_FIELDS } from '../utils/fieldTicketCore';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIG_PATH = 'supabase/migrations/20260923170000_rls_hardening.sql';
const HELD_PATH = 'supabase/migrations/held/20260923171000_portal_token_strip.sql';
let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra ? `\n   ${extra}` : ''); }
}
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** SQL with `--` comments removed (quoted '--' does not occur in these files). */
const stripSql = (s: string) => s.replace(/--[^\n]*/g, '');
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

const rawMig = read(MIG_PATH);
const mig = stripSql(rawMig);
const rawHeld = existsSync(join(ROOT, HELD_PATH)) ? read(HELD_PATH) : '';
const held = stripSql(rawHeld);

/** The body of `create or replace function public.<name>(` … up to its closing dollar tag. */
function fnBody(src: string, name: string): string {
  const start = src.search(new RegExp(`create or replace function public\\.${name}\\(`, 'i'));
  if (start < 0) return '';
  const rest = src.slice(start);
  const tag = /as (\$[a-z_]*\$)/i.exec(rest);
  if (!tag) return '';
  const open = rest.indexOf(tag[1], tag.index) + tag[1].length;
  const close = rest.indexOf(tag[1], open);
  return rest.slice(0, close + tag[1].length);
}
/** A `create policy <name> …;` statement. */
function policy(src: string, name: string): string {
  const m = new RegExp(`create policy ${name}\\b[\\s\\S]*?;`, 'i').exec(src);
  return m ? m[0] : '';
}
/** Balanced-paren contents following `keyword (`. */
function clause(stmt: string, keyword: RegExp): string {
  const m = keyword.exec(stmt);
  if (!m) return '';
  let i = stmt.indexOf('(', m.index + m[0].length - 1);
  let depth = 0; const from = i;
  for (; i < stmt.length; i++) {
    if (stmt[i] === '(') depth++;
    else if (stmt[i] === ')') { depth--; if (depth === 0) return stmt.slice(from + 1, i); }
  }
  return '';
}

console.log('\nfile + test wiring');
ok('migration sits in the rls-hardening slot 2026092317*', /^supabase\/migrations\/2026092317\d{4}_/.test(MIG_PATH) && rawMig.length > 0);
ok('header names the PGlite script that executes it twice', /w5rls_pg\/w5_rls_hardening\.mjs/.test(rawMig) && /twice/i.test(rawMig));
ok('held strip exists under held/ and names the same PGlite script', rawHeld.length > 0 && /w5rls_pg\/w5_rls_hardening\.mjs/.test(rawHeld));
ok('held/README.md lists the strip with its preconditions', /20260923171000_portal_token_strip\.sql/.test(read('supabase/migrations/held/README.md'))
  && /portal_get_owner_token/.test(read('supabase/migrations/held/README.md')));
ok('no notify from SQL here (CONTRACT 8 is not this lane\'s)', !/fire_notify/i.test(mig) && !/fire_notify/i.test(held));
const WAVE4_OBJECTS = ['portal_sign_contract', 'portal_submit_co_approval', 'portal_overlay_live', 'punch_items_guard',
  'trg_portal_state_owner', 'trg_daily_reports_portal_owner', 'enforce_free_tier_project_cap', 'crew_freeze_ownership_columns',
  'projects_freeze_ownership_columns'];
ok('redefines no wave-4 / other-lane object', WAVE4_OBJECTS.every(n => !new RegExp(`function public\\.${n}\\b`, 'i').test(mig + held)));
const definers = [...mig.matchAll(/create or replace function public\.(\w+)\([^]*?\bas \$/gi)].map(m => m[0]);
ok('every SECURITY DEFINER function pins its search_path',
  definers.filter(d => /security definer/i.test(d)).every(d => /set search_path/i.test(d)) && definers.some(d => /security definer/i.test(d)));

// ── #82 ─────────────────────────────────────────────────────────────────────
console.log('\n#82 portal key');
const tbl = /create table if not exists public\.portal_credentials \(([\s\S]*?)\n\);/i.exec(mig)?.[1] ?? '';
ok('portal_credentials(project_id uuid pk → projects on delete cascade, portal_id unique, access_token not null, passcode, rotated_at) — CONTRACT 13',
  /project_id\s+uuid primary key references public\.projects\(id\) on delete cascade/i.test(tbl)
  && /portal_id\s+text unique/i.test(tbl) && /access_token text not null/i.test(tbl)
  && /passcode\s+text/i.test(tbl) && /rotated_at\s+timestamptz/i.test(tbl), tbl);
ok('the FK is deferred (the token trigger writes it BEFORE INSERT of a new project)', /deferrable initially deferred/i.test(tbl));
ok('RLS on; anon / authenticated stripped; authenticated gets SELECT only',
  /alter table public\.portal_credentials enable row level security/i.test(mig)
  && /revoke all on public\.portal_credentials from public, anon, authenticated/i.test(mig)
  && /grant select on public\.portal_credentials to authenticated;/i.test(mig)
  && !/grant (insert|update|delete|all)[^;]*on public\.portal_credentials to [^;]*\b(anon|authenticated)\b/i.test(mig));
const credPol = policy(mig, 'portal_credentials_owner_select');
ok('SELECT policy is owner-only (projects.user_id = auth.uid())',
  /for select to authenticated/i.test(credPol) && /p\.user_id = auth\.uid\(\)/.test(credPol) && !/can_access_project|is_project_collaborator/.test(credPol));
ok('no column REVOKE on projects.client_portal (select * would fail for everyone)',
  !/revoke\s+select\s*\(/i.test(mig) && !/revoke[^;]*client_portal/i.test(mig));
ok('backfill from client_portal accessToken / passcode', /insert into public\.portal_credentials[\s\S]*?client_portal->>'accessToken'[\s\S]*?client_portal->>'passcode'/i.test(mig));

const keep = fnBody(mig, 'projects_keep_owner_client_portal');
ok('non-owner client_portal write keeps OLD, silently',
  /auth\.uid\(\) is not null and auth\.uid\(\) is distinct from old\.user_id/i.test(keep)
  && /new\.client_portal := old\.client_portal/i.test(keep) && !/raise/i.test(keep));
ok('it is a BEFORE UPDATE trigger on projects', /create trigger projects_keep_owner_client_portal\s+before update on public\.projects/i.test(mig));
ok('fires after projects_freeze_ownership and before trg_portal_access_token (name order)',
  'projects_freeze_ownership' < 'projects_keep_owner_client_portal' && 'projects_keep_owner_client_portal' < 'trg_portal_access_token');

const setTok = fnBody(mig, 'portal_set_access_token');
ok('token trigger is SECURITY DEFINER with its live search_path kept',
  /security definer/i.test(setTok) && /set search_path to 'pg_catalog', 'public'/i.test(setTok));
ok('only the owner (as stored) or the service role writes the credentials row',
  /v_may_write := v_caller is null or v_caller = v_owner/i.test(setTok)
  && /if tg_op = 'UPDATE' then\s+v_owner := old\.user_id/i.test(setTok)
  && /select p\.user_id into v_owner from public\.projects p where p\.id = new\.id/i.test(setTok));
ok('credentials row is authoritative for the same portal id; mints into portal_credentials',
  /case when v_cred_pid is not distinct from v_pid then nullif\(v_cred_tok, ''\) end/i.test(setTok)
  && /insert into public\.portal_credentials/i.test(setTok));
ok('a non-owner write never pulls the stored key into NEW nor mints',
  /else\s+v_tok := coalesce\(\s*nullif\(new\.client_portal->>'accessToken', ''\),\s*case when tg_op = 'UPDATE' then nullif\(old\.client_portal->>'accessToken', ''\) end\);/i.test(setTok));
ok('transition: the key is still mirrored for pre-OTA builds', /new\.client_portal := new\.client_portal \|\| jsonb_build_object\('accessToken', v_tok\)/i.test(setTok));

const pft = fnBody(mig, 'portal_project_for_token');
const pfa = fnBody(mig, 'portal_project_for_token_any');
ok('portal_project_for_token keeps its signature / STABLE SQL / expiry rule and reads portal_credentials first',
  /portal_project_for_token\(p_portal_id text, p_access_token text\)\s+returns uuid\s+language sql\s+stable security definer\s+set search_path to 'public'/i.test(pft)
  && /portal_credentials pc/i.test(pft) && /coalesce\(nullif\(pc\.access_token, ''\), p\.client_portal->>'accessToken'\) = p_access_token/i.test(pft)
  && /ps\.expires_at <= now\(\)/i.test(pft));
ok('portal_project_for_token_any the same, without the expiry rule',
  /portal_project_for_token_any\(p_portal_id text, p_access_token text\)\s+returns uuid/i.test(pfa)
  && /portal_credentials pc/i.test(pfa) && !/expires_at/i.test(pfa));
const rot = fnBody(mig, 'portal_rotate_access_token');
ok('rotation writes portal_credentials BEFORE the mirror, verifies both, stays owner-only',
  rot.search(/insert into public\.portal_credentials/i) > 0
  && rot.search(/insert into public\.portal_credentials/i) < rot.search(/update public\.projects/i)
  && /v_stored is distinct from v_new or v_mirror is distinct from v_new/i.test(rot)
  && /v_owner <> auth\.uid\(\)/i.test(rot));
const getter = fnBody(mig, 'portal_get_owner_token');
ok('portal_get_owner_token(p_project_id uuid) → text, owner-only (42501)',
  /portal_get_owner_token\(p_project_id uuid\)\s+returns text/i.test(getter) && /security definer/i.test(getter)
  && /v_owner is null or v_owner <> auth\.uid\(\)/i.test(getter) && /errcode = '42501'/i.test(getter));
ok('getter: anon cannot execute, authenticated can',
  /revoke all on function public\.portal_get_owner_token\(uuid\) from public, anon;/i.test(mig)
  && /grant execute on function public\.portal_get_owner_token\(uuid\) to authenticated/i.test(mig));

console.log('\n#82 held strip');
const hSet = fnBody(held, 'portal_set_access_token');
ok('held trigger strips accessToken / passcode from every write and no longer mirrors',
  /new\.client_portal := new\.client_portal - 'accessToken' - 'passcode'/i.test(hSet) && !/jsonb_build_object\('accessToken'/i.test(held));
ok('held trigger captures an old build\'s passcode, keeps the stored one otherwise',
  /case when new\.client_portal \? 'passcode'\s+then nullif\(new\.client_portal->>'passcode', ''\)\s+else v_cred_pass end/i.test(hSet));
ok('held readers use portal_credentials only (inner join, no blob fallback)',
  /join public\.portal_credentials pc/i.test(fnBody(held, 'portal_project_for_token'))
  && !/left join/i.test(fnBody(held, 'portal_project_for_token')) && !/client_portal->>'accessToken'/i.test(fnBody(held, 'portal_project_for_token'))
  && !/client_portal->>'accessToken'/i.test(fnBody(held, 'portal_project_for_token_any'))
  && !/client_portal->>'accessToken'/i.test(fnBody(held, 'portal_get_owner_token')));
ok('held rotation touches portal_credentials only', !/update public\.projects/i.test(fnBody(held, 'portal_rotate_access_token')));
ok('held strips every row, rotates each live key once, and asserts none is left',
  /set client_portal = client_portal - 'accessToken' - 'passcode'/i.test(held)
  && /'held\/20260923171000'/.test(held) && /still carry accessToken \/ passcode/i.test(held));
ok('held rotates each key that sat on the readable row (new random token into portal_credentials)',
  /v_new := encode\(extensions\.gen_random_bytes\(24\), 'hex'\);\s+update public\.portal_credentials\s+set access_token = v_new, rotated_at = now\(\)\s+where project_id = r\.project_id;/i.test(held));

// ── #82 strip (20261005100000) — the file that is applied ───────────────────
// The held file above stays where it is and is never applied; these pins are on
// the migration that supersedes it. What they hold in place: the client's
// portal key can never again rest on projects.client_portal, which every
// accepted collaborator can read. Behaviour is proven in PGlite
// (tools/pgq/portal-token-strip.mjs, 14 planted mutations); this is the static
// half, and it fails the build if a later migration puts the mirror back.
console.log('\n#82 strip (20261005100000)');
{
  const STRIP_FILE = '20261005100000_portal_token_strip.sql';
  const MIG_DIR = join(ROOT, 'supabase/migrations');
  const rawStrip = existsSync(join(MIG_DIR, STRIP_FILE)) ? read(`supabase/migrations/${STRIP_FILE}`) : '';
  const strip = stripSql(rawStrip);
  ok('the strip migration exists at the top level and names its PGlite proof', rawStrip.length > 0 && /tools\/pgq\/portal-token-strip\.mjs/.test(rawStrip));
  ok('held/README.md says the held file is superseded by it', /20260923171000_portal_token_strip\.sql[^\n]*SUPERSEDED by `\.\.\/20261005100000_portal_token_strip\.sql`/.test(read('supabase/migrations/held/README.md')));
  ok('it is gated: refuses without mageid.portal_key_fix_ready, and without portal_credentials',
    /current_setting\('mageid\.portal_key_fix_ready', true\)/.test(strip) && /raise exception '\[portal-key\] held:/.test(strip)
    && /to_regclass\('public\.portal_credentials'\) is null/.test(strip)
    && strip.indexOf("raise exception '[portal-key] held:") < strip.indexOf('create or replace function'));
  const sSet = fnBody(strip, 'portal_set_access_token');
  ok('trigger: SECURITY DEFINER, pinned search_path, strips accessToken as its last act on every object write',
    /security definer/i.test(sSet) && /set search_path to 'pg_catalog', 'public'/i.test(sSet)
    && /new\.client_portal := new\.client_portal - 'accessToken';\s+return new;\s+end;/i.test(sSet));
  ok('trigger: never mirrors the key onto the row and never reads one from the write',
    !/jsonb_build_object\('accessToken'/i.test(sSet) && !/client_portal->>'accessToken'/i.test(sSet) && !/\|\|\s*jsonb_build_object/i.test(sSet));
  ok('trigger: the key is the stored one for this portal id, else minted — nothing else',
    /v_tok := coalesce\(\s*case when v_cred_pid is not distinct from v_pid then nullif\(v_cred_tok, ''\) end,\s*encode\(extensions\.gen_random_bytes\(24\), 'hex'\)\);/i.test(sSet));
  ok('trigger: only the stored owner or the service role writes the credentials row',
    /v_may_write := v_caller is null or v_caller = v_owner;/i.test(sSet) && /select p\.user_id into v_owner from public\.projects p where p\.id = new\.id;/i.test(sSet)
    && sSet.indexOf('if v_may_write then') > 0 && sSet.indexOf('if v_may_write then') < sSet.indexOf('insert into public.portal_credentials'));
  ok('trigger: the PASSCODE is left on the row (validate-portal-passcode and portal_sign_contract read it there)',
    !/-\s*'passcode'/i.test(strip) && /nullif\(new\.client_portal->>'passcode', ''\)/i.test(sSet));
  const sRot = fnBody(strip, 'portal_rotate_access_token');
  ok('Reset link: owner-only (42501), writes portal_credentials only, same signature',
    /portal_rotate_access_token\(p_project_id uuid\)\s+returns text/i.test(sRot) && /v_owner is null or v_owner <> auth\.uid\(\)/i.test(sRot)
    && /errcode = '42501'/i.test(sRot) && !/update public\.projects/i.test(sRot) && !/accessToken/.test(sRot));
  for (const n of ['portal_project_for_token', 'portal_project_for_token_any', 'portal_get_owner_token']) {
    const b = fnBody(strip, n);
    ok(`${n}: reads portal_credentials only (no left join, no fallback to the row)`,
      b.length > 0 && /public\.portal_credentials pc/i.test(b) && !/left join/i.test(b) && !/accessToken/.test(b));
  }
  ok('the gate still compares the key and still refuses an ended link',
    /and pc\.access_token = p_access_token\s+and not exists \(\s*select 1 from public\.portal_snapshots ps/i.test(fnBody(strip, 'portal_project_for_token')));
  ok('getter: owner-only (42501); anon cannot execute it or Reset link; no client role calls the gate functions',
    /v_owner is null or v_owner <> auth\.uid\(\)/i.test(fnBody(strip, 'portal_get_owner_token'))
    && /revoke all on function public\.portal_get_owner_token\(uuid\) from public, anon;/i.test(strip)
    && /revoke execute on function public\.portal_rotate_access_token\(uuid\) from public, anon;/i.test(strip)
    && /revoke execute on function public\.portal_project_for_token\(text, text\)\s+from public, anon, authenticated;/i.test(strip)
    && /revoke execute on function public\.portal_project_for_token_any\(text, text\) from public, anon, authenticated;/i.test(strip));
  ok('every key found on a row is replaced by a new random one and audited; then every row is stripped',
    /nullif\(p\.client_portal->>'accessToken', ''\) is not null/i.test(strip)
    && /v_new := encode\(extensions\.gen_random_bytes\(24\), 'hex'\);/i.test(strip)
    && /jsonb_build_object\('by', '20261005100000'/i.test(strip)
    && /set client_portal = client_portal - 'accessToken'\s+where jsonb_typeof\(client_portal\) = 'object'\s+and client_portal \? 'accessToken';/i.test(strip)
    && strip.indexOf("jsonb_build_object('by', '20261005100000'") < strip.indexOf("set client_portal = client_portal - 'accessToken'"));
  ok('no key is copied from a row into portal_credentials (a key that was readable is never kept)',
    // the only read of a row's key is the WHERE that finds the rows to rotate
    !/->>\s*'accessToken'/i.test(strip.replace(/nullif\(p\.client_portal->>'accessToken', ''\) is not null/g, ''))
    && (strip.match(/nullif\(p\.client_portal->>'accessToken', ''\) is not null/g) ?? []).length === 1
    && !/access_token\s*=\s*[a-z_.]*client_portal/i.test(strip));
  ok('self-check: no row carries a key, every enabled portal has one stored, grants and policy as they must be',
    /verify: % projects row\(s\) still carry accessToken/.test(strip) && /verify: % enabled portal\(s\) have no portal_credentials row/.test(strip)
    && /verify: portal_set_access_token must strip accessToken on every write/.test(strip)
    && /verify: portal_credentials must not be readable by anon nor writable by anon \/ authenticated/.test(strip)
    && /verify: portal_credentials must carry exactly one policy, the owner-only SELECT/.test(strip)
    && /verify: anon must not call the owner RPCs/.test(strip));

  // THE PIN. In apply order (every top-level migration, by name), the newest
  // definition of each key function must be the strip's or a later one that
  // still keeps the key off the row.
  const files = readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).sort();
  const STRIP_LINE = /new\.client_portal := new\.client_portal - 'accessToken';/g;
  const newest = (name: string): { file: string; body: string } => {
    let out = { file: '', body: '' };
    for (const f of files) {
      const src = stripSql(read(`supabase/migrations/${f}`));
      const re = new RegExp(`create or replace function public\\.${name}\\(`, 'gi');
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) out = { file: f, body: fnBody(src.slice(m.index), name) };
    }
    return out;
  };
  const KEY_FNS = ['portal_set_access_token', 'portal_rotate_access_token', 'portal_project_for_token', 'portal_project_for_token_any', 'portal_get_owner_token'];
  const late = KEY_FNS.map(newest);
  ok('in apply order, the newest definition of each of the five key functions is the strip or a later dated file',
    late.every(d => d.file >= STRIP_FILE && /^\d{14}_/.test(d.file)), late.map(d => d.file).join(', '));
  const dirty = late.filter(d => d.body.length === 0 || /accessToken/.test(d.body.replace(STRIP_LINE, '')));
  ok('and none of those newest definitions writes or reads an accessToken on client_portal (the strip line aside)',
    dirty.length === 0, dirty.map(d => d.file).join(', '));
  ok('the newest trigger function still ends by stripping the key', STRIP_LINE.test(late[0].body));
  const laterFiles = files.filter(f => f > STRIP_FILE && /^\d{14}_/.test(f));
  const mirrors = laterFiles.filter(f => /jsonb_build_object\(\s*'accessToken'|client_portal\s*\|\|[^;]*accessToken|'\{accessToken\}'/i.test(stripSql(read(`supabase/migrations/${f}`))));
  ok('no migration after the strip writes an accessToken into client_portal', mirrors.length === 0, mirrors.join(', '));
  const opened = laterFiles.filter(f => /grant[^;]*on (table )?public\.portal_credentials[^;]*to[^;]*\b(anon|public)\b|grant (all|insert|update|delete)[^;]*on (table )?public\.portal_credentials[^;]*to[^;]*authenticated|create policy[^;]*on public\.portal_credentials/i.test(stripSql(read(`supabase/migrations/${f}`))));
  ok('no migration after the strip opens portal_credentials (a grant to anon, a write grant, another policy)', opened.length === 0, opened.join(', '));
}

// ── #82 · the app and the e-mail functions read the key from portal_credentials ──
console.log('\n#82 readers of the key');
{
  const links = read('supabase/functions/_shared/portalLinks.ts');
  ok('edge: storedPortalKey reads portal_credentials with the service role, by project id, and matches the portal id',
    /export async function storedPortalKey\(projectId: unknown, clientPortal: unknown\): Promise<string \| null>/.test(links)
    && /portal_credentials\?project_id=eq\.\$\{encodeURIComponent\(pid\)\}&select=portal_id,access_token&limit=1/.test(links)
    && /if \(!row \|\| row\.portal_id !== portalId\) return null;/.test(links));
  ok('edge: _shared/portalLinks.ts never logs', !/console\./.test(links));
  ok('edge: portalUrlFor takes the stored key first, the row\'s copy only as the fallback',
    /export function portalUrlFor\(clientPortal: unknown, storedKey\?: string \| null\): string \| null/.test(links)
    && /const token = stored \|\| \(typeof cp\.accessToken === 'string' \? cp\.accessToken\.trim\(\) : ''\);/.test(links));
  const callers: [string, RegExp][] = [
    ['homeowner-weekly-digest', /const portalKey = portalUnpublished \? null : await storedPortalKey\(project\.id, portal\);/],
    ['invoice-dunning', /portalUrlFor\(project\.client_portal, await storedPortalKey\(project\.id, project\.client_portal\)\)/],
    ['notify', /portalUrlFor\(projectCtx\.client_portal, await storedPortalKey\(projectCtx\.id, projectCtx\.client_portal\)\)/],
    ['portal-link-expiry-notice', /portalUrlFor\(proj\.client_portal, await storedPortalKey\(p\.project_id, proj\.client_portal\)\)/],
  ];
  for (const [fn, re] of callers) {
    const src = read(`supabase/functions/${fn}/index.ts`);
    const calls = (src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').match(/\bportalUrlFor\(/g) ?? []).length;
    ok(`edge: ${fn} builds its portal link with the stored key (its only portalUrlFor call)`, re.test(src) && calls === 1, `calls: ${calls}`);
  }
  // No edge function may read the key off the projects row any other way.
  const fnRoot = join(ROOT, 'supabase/functions');
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.name.endsWith('.ts') || full.endsWith('_shared/portalLinks.ts')) continue;
      const code = readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      if (/client_portal\??\.accessToken|client_portal->>accessToken|clientPortal\??\.accessToken|\bcp\.accessToken|\bportal\??\.accessToken/.test(code)) offenders.push(full.slice(fnRoot.length + 1));
    }
  };
  walk(fnRoot);
  ok('edge: no function reads accessToken off a client_portal blob (only _shared/portalLinks.ts, as the fallback)', offenders.length === 0, offenders.join(', '));

  const ctx = read('contexts/ProjectContext.tsx');
  ok('app: the project loader reads the OWNER\'s keys from portal_credentials and lays them over the row for owned jobs only',
    /\.from\('portal_credentials'\)\s*\.select\('project_id, portal_id, access_token'\)/.test(ctx)
    && /clientPortal: \(owned\s*\? ownerClientPortalAfterLoad\(r\.client_portal as Project\['clientPortal'\] \| null, portalKeyById\.get\(rid\), portalKeysReadOk, cached\?\.clientPortal\)\s*: stripPortalCredentials\(r\.client_portal as Project\['clientPortal'\] \| null\)\)/.test(ctx));
  ok('app: the loader never logs a key', !/console\.log\([^)]*(keyRows|access_token|portalKeyById)/.test(ctx));
  ok('app: the owner upsert still never sends the key', /client_portal: ownerClientPortalForWrite\(project\.clientPortal\) as unknown,/.test(ctx));
  const setup = read('app/client-portal-setup.tsx');
  ok('app: Client portal setup checks the key it holds against the server\'s once per visit and adopts a different one',
    /if \(readBack\.ok && readBack\.token && readBack\.token !== heldKey\) adoptRotatedRef\.current\(readBack\.token\);/.test(setup)
    && /if \(!id \|\| sampleJob \|\| localOwnership !== 'owner' \|\| !persistedPortalEnabled \|\| !heldKey\) return;/.test(setup));
}

// ── #85 ─────────────────────────────────────────────────────────────────────
console.log('\n#85 ownership freeze');
const freeze = fnBody(mig, 'collab_freeze_ownership');
ok('freeze: SECURITY DEFINER, pinned search_path, service role passes',
  /security definer/i.test(freeze) && /set search_path to 'pg_catalog', 'public'/i.test(freeze)
  && /if auth\.uid\(\) is null then\s+return new;/i.test(freeze));
ok('freeze decides the owner from OLD.project_id, never NEW',
  /v_pid := \(old\.project_id\)::text::uuid/i.test(freeze) && !/new\.project_id\)?::/i.test(freeze)
  && /select p\.user_id into v_owner from public\.projects p where p\.id = v_pid/i.test(freeze));
ok('freeze pins user_id, project_id and created_at from OLD, silently',
  /new\.user_id\s*:= old\.user_id/i.test(freeze) && /new\.project_id\s*:= old\.project_id/i.test(freeze)
  && /new\.created_at\s*:= old\.created_at/i.test(freeze) && !/raise/i.test(freeze));
// punch_items is NOT excluded (integration round 1, data-security): wave 4's
// punch_items_guard pins user_id but never project_id, so without the freeze a
// field seat moves the GC's item into a job he owns and deletes it through the
// owner branch of punch_items_collab_delete. The freeze is a separate trigger
// beside the guard; the guard itself is not redefined (WAVE4_OBJECTS above).
ok('attached as aa_collab_freeze_ownership to every *_collab_update table, punch_items included',
  /policyname like '%\\_collab\\_update'/.test(mig) && !/tablename <> 'punch_items'/.test(mig)
  && /create trigger aa_collab_freeze_ownership before update on public\.%I/.test(mig));
const EXPECTED = ['access_reservations', 'building_access_rules', 'daily_reports', 'deliveries', 'drawing_pins', 'field_tickets',
  'permits', 'photos', 'plan_calibrations', 'plan_markups', 'plan_sheets', 'punch_items', 'rfis', 'submittals', 'time_entries'];
const postCond = mig.slice(mig.indexOf('v_expected text[]'));
ok('post-condition names the fifteen production collab tables (punch_items included)',
  EXPECTED.every(t => new RegExp(`'${t}'`).test(postCond.slice(0, postCond.indexOf('];')))));
ok('post-condition checks wave 4\'s punch_items_guard is still attached beside the freeze',
  /tg\.tgname = 'punch_items_guard'/.test(postCond)
  && !/punch_items must stay with wave 4/.test(mig));
ok('aa_collab_freeze_ownership sorts before punch_items_guard (project_id is back on OLD first)',
  'aa_collab_freeze_ownership' < 'punch_items_guard');
const LATER_BEFORE_TRIGGERS = ['daily_reports_portal_owner', 'photos_portal_owner', 'rfis_portal_owner', 'rfis_answer_guard',
  'submittals_answer_guard', 'daily_reports_updated_at', 'field_tickets_updated_at', 'time_entries_updated_at'];
ok('aa_collab_freeze_ownership sorts before wave 4\'s portal-owner triggers and the answer guards',
  LATER_BEFORE_TRIGGERS.every(t => 'aa_collab_freeze_ownership' < t));

console.log('\n#85 field ticket seal');
const seal = fnBody(mig, 'field_tickets_seal');
ok('seal: every signed-in caller (owner included) once status <> draft; service role passes',
  /if auth\.uid\(\) is null then\s+return new;/i.test(seal) && /if old\.status is null or old\.status = 'draft' then\s+return new;/i.test(seal)
  && !/v_owner|projects p/i.test(seal));
ok('seal keeps work_description, reason_extra, date, markup_percent, authorization from OLD',
  ['work_description', 'reason_extra', 'date', 'markup_percent', '"authorization"'].every(c =>
    new RegExp(`new\\.${c.replace(/"/g, '"')}\\s*:= old\\.${c.replace(/"/g, '"')};`, 'i').test(seal)));
const PRICE = SEALED_FIELD_TICKET_PRICE_FIELDS;
ok('labor / materials / equipment: price-only moves by owner or editor, keyed on the app\'s own price fields',
  new RegExp(`field_ticket_rows_same_except\\(old\\.labor, new\\.labor, array\\['${PRICE.labor}'\\]\\)`).test(seal)
  && new RegExp(`field_ticket_rows_same_except\\(old\\.materials, new\\.materials, array\\['${PRICE.materials}'\\]\\)`).test(seal)
  && new RegExp(`field_ticket_rows_same_except\\(old\\.equipment, new\\.equipment, array\\['${PRICE.equipment}'\\]\\)`).test(seal)
  && /v_can_price := public\.can_access_project\(old\.project_id, 'editor'\)/i.test(seal), JSON.stringify(PRICE));
ok('photos: only the upload backfill (uri / storagePath / localUri) moves',
  /field_ticket_rows_same_except\(old\.photos, new\.photos, array\['uri', 'storagePath', 'localUri'\]\)/.test(seal));
ok('status never returns to draft; seal never raises',
  /if new\.status is null or new\.status = 'draft' then\s+new\.status := old\.status;/i.test(seal) && !/raise/i.test(seal));
const same = fnBody(mig, 'field_ticket_rows_same_except');
ok('row comparison: same length, same order, equal except the listed keys',
  /jsonb_array_length\(p_old\) <> jsonb_array_length\(p_new\) then false/i.test(same) && /with ordinality/i.test(same) && /o\.v - p_keys/i.test(same));
ok('aa_field_tickets_seal runs right after the freeze, before field_tickets_updated_at',
  /create trigger aa_field_tickets_seal\s+before update on public\.field_tickets/i.test(mig)
  && 'aa_collab_freeze_ownership' < 'aa_field_tickets_seal' && 'aa_field_tickets_seal' < 'field_tickets_updated_at');
ok('no time_entries edit rule (foremen close each other\'s shifts)', !/policy time_entries_collab_update/i.test(mig));

// ── #179 ────────────────────────────────────────────────────────────────────
console.log('\n#179 project documents');
const docs = policy(mig, 'project_docs_update');
const using = norm(clause(docs, /\busing\s*\(/i));
const check = norm(clause(docs, /\bwith check\s*\(/i));
ok('project_docs_update: USING and WITH CHECK are the same rule', using.length > 0 && using === check, `${using}\n   ${check}`);
ok('...editor anywhere, field only under daily-reports/',
  using.includes("public.can_access_project((storage.foldername(name))[1], 'editor')")
  && using.includes("(storage.foldername(name))[2] = 'daily-reports' and public.can_access_project((storage.foldername(name))[1], 'field')")
  && using.includes("bucket_id = 'project-documents'"));
ok('...and field is never granted outside the daily-reports conjunct',
  (using.match(/'field'/g) ?? []).length === 1);
ok('INSERT policy untouched (still field)', !/create policy project_docs_insert/i.test(mig));

// ── #181 ────────────────────────────────────────────────────────────────────
console.log('\n#181 Hire conversations');
ok('cp_insert_self, convo_select_participant, convo_update_participant dropped',
  ['cp_insert_self', 'convo_select_participant', 'convo_update_participant'].every(p =>
    new RegExp(`drop policy if exists ${p} on`, 'i').test(mig) && !new RegExp(`create policy ${p}\\b`, 'i').test(mig)));
const cpIns = policy(mig, 'cp_insert_participant');
ok('a participants row only when the caller AND the row\'s user are already participants',
  /for insert to authenticated/i.test(cpIns)
  && /\(auth\.uid\(\)\)::text in \(select jsonb_array_elements_text\(c\.participant_ids\)\)/i.test(cpIns)
  && /\(conversation_participants\.user_id\)::text in \(select jsonb_array_elements_text\(c\.participant_ids\)\)/i.test(cpIns));
const cu = policy(mig, 'conversations_update');
ok('conversations_update has a WITH CHECK and is scoped to authenticated', /to authenticated/i.test(cu) && /with check/i.test(cu));
const cfz = fnBody(mig, 'conversations_freeze_participants');
ok('participant_ids frozen for any signed-in caller (raise), names pinned, service role passes',
  /if auth\.uid\(\) is null then\s+return new;/i.test(cfz)
  && /new\.participant_ids is distinct from old\.participant_ids then\s+raise exception/i.test(cfz)
  && /new\.participant_names := old\.participant_names/i.test(cfz)
  && /create trigger conversations_freeze_participants\s+before update on public\.conversations/i.test(mig));
const mi = policy(mig, 'messages_insert');
ok('messages_insert: TO authenticated, sender is the caller AND a participant',
  /for insert to authenticated/i.test(mi) && /auth\.uid\(\) = sender_id/i.test(mi) && /participant_ids/i.test(mi));
const hire = read('contexts/HireContext.tsx');
ok('HireContext still inserts one participants row per listed participant (the new policy admits them)',
  /for \(const pid of participantIds\)[\s\S]{0,120}supabaseWrite\('conversation_participants', 'insert', \{ conversation_id: convoId, user_id: pid \}\)/.test(hire));
ok('HireContext never writes participant_ids on an update (the freeze would refuse it)',
  !/supabaseWrite\('conversations', 'update', \{[^}]*participant_ids/.test(hire));

// ── #61 ─────────────────────────────────────────────────────────────────────
console.log('\n#61 job delete keeps OSHA records');
const keepSafety = fnBody(mig, 'projects_keep_safety_records');
ok('BEFORE DELETE on projects', /create trigger projects_keep_safety_records\s+before delete on public\.projects/i.test(mig));
ok('auth.uid() IS NULL passes (service role, delete-account, the auth.users cascade)',
  /if auth\.uid\(\) is null then\s+return old;/i.test(keepSafety));
ok('refuses with 23001 project_has_safety_records (CONTRACT 22), never 23503',
  /raise exception 'project_has_safety_records'\s+using errcode = '23001'/i.test(keepSafety) && !/23503/.test(keepSafety));
ok('counts safety_incidents for OLD.id, DETAIL incidents=<n>',
  /from public\.safety_incidents si where si\.project_id = old\.id/i.test(keepSafety) && /format\('incidents=%s', v_n\)/.test(keepSafety));
ok('SECURITY DEFINER with a pinned search_path', /security definer/i.test(keepSafety) && /set search_path to 'pg_catalog', 'public'/i.test(keepSafety));
ok('the safety_incidents FK is left alone (RESTRICT would refuse account deletion)', !/safety_incidents_project_id_fkey/i.test(mig));

// ── guard allow-lists (20261005110000_guard_allowlists.sql) ─────────────────
// Five column guards used to act on "a client" spelled as two role names
// (current_user in ('authenticated', 'anon')): a role added later passed them.
// They now name who MAY write. This section holds that shut three ways:
//   1. the LATEST definition of each of the five, across every migration, is
//      the allow-list, and is the old body with ONLY the role test swapped;
//   2. no function anywhere whose latest definition tests current_user against
//      a client role, bar the two listed below (not this lane's; the list may
//      only shrink), and no migration from this one on does it at all;
//   3. planted mutations (in memory; the files are never touched) each turn
//      the same checks red, so the checks themselves cannot go vacuous.
// The executed half is the PGlite script named in the migration's header.
console.log('\nguard allow-lists: no trigger decides by naming the two client roles');
const GA_NAME = '20261005110000_guard_allowlists.sql';
const GA_GUARDS: { fn: string; from: string; server: string }[] = [
  { fn: 'invoices_ledger_guard', from: '20260920020000_invoice_payment_ledger.sql', server: 'public.invoice_append_payment(uuid,jsonb)' },
  { fn: 'aia_pay_apps_pending_guard', from: '20260920020000_invoice_payment_ledger.sql', server: 'public.invoice_append_payment(uuid,jsonb)' },
  { fn: 'change_orders_keep_number_fn', from: '20260920050000_change_order_numbers.sql', server: 'public.change_orders_assign_number_fn()' },
  { fn: 'punch_items_guard', from: '20260920120000_punch_sub_portal_v2.sql', server: 'public.sub_portal_mark_punch_ready(text,text,text,text)' },
  { fn: 'punch_items_seal_pin', from: '20261002150000_punch_seals.sql', server: 'public.sub_portal_mark_punch_ready(text,text,text,text)' },
];
// One-role deny-lists that are still live (20260923130000_lien_prequal_hardening.sql). Reported, not
// converted here. A name may leave this list; none may join it.
const GA_KNOWN_DENY = ['lien_waivers_protect_signature', 'prequal_packets_protect_submission'];
const GA_DENY = /current_user\s+(not\s+)?in\s*\(\s*'(authenticated|anon)'|current_user\s*(=|<>|!=)\s*'(authenticated|anon)'/i;
type GaFiles = Record<string, string>;
type GaDef = { file: string; name: string; head: string; body: string };

function gaFilesOnDisk(): GaFiles {
  const dir = join(ROOT, 'supabase', 'migrations');
  const out: GaFiles = {};
  for (const f of readdirSync(dir).filter(x => /^\d{14}_.*\.sql$/.test(x)).sort()) out[f] = readFileSync(join(dir, f), 'utf8');
  return out;
}
/** Every `create or replace function public.<name>(` in one file, as written (comments kept in the body: that is prosrc). */
function gaDefs(file: string, src: string): GaDef[] {
  const starts = [...src.matchAll(/create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(/gi)];
  const out: GaDef[] = [];
  starts.forEach((m, i) => {
    const rest = src.slice(m.index!, i + 1 < starts.length ? starts[i + 1].index! : src.length);
    const tag = /\bas\s+(\$[A-Za-z_]*\$)/.exec(rest);
    if (!tag) return;
    const open = rest.indexOf(tag[1], tag.index) + tag[1].length;
    const close = rest.indexOf(tag[1], open);
    if (close < 0) return;
    out.push({ file, name: m[1].toLowerCase(), head: rest.slice(0, tag.index), body: rest.slice(open, close) });
  });
  return out;
}
/** name → the definitions in the LAST file that defines it (what the database runs after every migration). */
function gaLive(files: GaFiles): Map<string, GaDef[]> {
  const live = new Map<string, GaDef[]>();
  for (const f of Object.keys(files).sort()) {
    const byName = new Map<string, GaDef[]>();
    for (const d of gaDefs(f, files[f])) byName.set(d.name, [...(byName.get(d.name) ?? []), d]);
    for (const [n, ds] of byName) live.set(n, ds);
  }
  return live;
}
const gaNorm = (sql: string) => norm(stripSql(sql));
const GA_PREAMBLE = (server: string) => gaNorm(`
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    v_server := true;
  else
    begin
      select ro.rolname into v_owner
        from pg_catalog.pg_proc fn
        join pg_catalog.pg_roles ro on ro.oid = fn.proowner
       where fn.oid = pg_catalog.to_regprocedure('${server}');
    exception when others then
      v_owner := null;
    end;
    if v_owner is not null and current_user = v_owner then
      v_server := true;
    end if;
  end if;`);
const gaMd5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex');

/** Everything that is wrong, in words. Empty = the guards are allow-lists and nothing else moved. */
function gaProblems(files: GaFiles): string[] {
  const bad: string[] = [];
  const mig = files[GA_NAME] ?? '';
  if (!mig) return [`${GA_NAME} is missing`];
  const live = gaLive(files);
  for (const g of GA_GUARDS) {
    const defs = live.get(g.fn) ?? [];
    if (defs.length !== 1) { bad.push(`${g.fn}: ${defs.length} live definitions, expected 1`); continue; }
    const d = defs[0];
    if (d.file < GA_NAME) { bad.push(`${g.fn}: its latest definition is in ${d.file}, before the allow-list migration`); continue; }
    const head = gaNorm(d.head), body = gaNorm(d.body), pre = GA_PREAMBLE(g.server);
    if (/security definer/.test(head)) bad.push(`${g.fn}: SECURITY DEFINER (current_user would be its owner; it would guard nothing)`);
    if (!body.includes(pre)) bad.push(`${g.fn}: does not open with the allow-list (service_role, postgres, supabase_admin, then the owner of ${g.server} looked up inside a block that cannot raise)`);
    if (/'authenticated'|'anon'|'authenticator'/.test(body)) bad.push(`${g.fn}: names a client role`);
    if (GA_DENY.test(body) || /current_user\s+not\s+in|current_user\s*(<>|!=)/.test(body)) bad.push(`${g.fn}: a deny-list test on current_user`);
    if ((body.match(/current_user/g) ?? []).length !== 2) bad.push(`${g.fn}: current_user is read ${(body.match(/current_user/g) ?? []).length} times, expected 2 (the named roles, the looked-up owner)`);
    if ((body.match(/v_server\s*:=/g) ?? []).length !== 2 || (body.match(/v_server := true;/g) ?? []).length !== 2) bad.push(`${g.fn}: v_server is set somewhere other than the allow-list`);
    // Nothing else moved: the old statement with ONLY the role test swapped equals the new one minus the allow-list.
    const old = gaDefs(g.from, files[g.from] ?? '').find(x => x.name === g.fn);
    if (!old) { bad.push(`${g.fn}: its first definition is no longer in ${g.from}`); continue; }
    const want = gaNorm(old.head + ' as $ ' + old.body)
      .split("current_user not in ('authenticated', 'anon')").join('v_server')
      .split("current_user in ('authenticated', 'anon')").join('not v_server');
    const got = gaNorm(d.head + ' as $ ' + d.body)
      .replace(pre + ' ', '')
      .replace('v_server boolean := false; v_owner name; ', '')
      .replace(' as $ declare begin ', ' as $ begin ');
    if (want !== got) bad.push(`${g.fn}: the body is not the ${g.from} body with only the role test swapped`);
    if (GA_DENY.test(want)) bad.push(`${g.fn}: the old body has a role test this check does not know how to swap`);
    // The header's md5(prosrc) values (read production BEFORE, verify AFTER) are these two bodies'.
    const listed = [...mig.matchAll(new RegExp(`^--\\s+--\\s+${g.fn}\\s+([0-9a-f]{32})\\s*$`, 'gm'))].map(m => m[1]);
    if (listed.length !== 2 || listed[0] !== gaMd5(old.body) || listed[1] !== gaMd5(d.body)) {
      bad.push(`${g.fn}: the header must list md5(prosrc) before (${gaMd5(old.body)}) and after (${gaMd5(d.body)}); it lists ${listed.join(', ') || 'none'}`);
    }
  }
  // No live function tests current_user against a client role, bar the known two.
  for (const [name, defs] of live) {
    for (const d of defs) {
      if (GA_DENY.test(stripSql(d.body)) && !GA_KNOWN_DENY.includes(name)) bad.push(`${name} (${d.file}): decides by naming a client role (a deny-list); name who MAY write instead`);
    }
  }
  // …and from this migration on, no file does it anywhere (a DO block, a policy, a trigger WHEN clause).
  for (const f of Object.keys(files).filter(x => x >= GA_NAME)) {
    if (GA_DENY.test(stripSql(files[f]))) bad.push(`${f}: tests current_user against a client role`);
  }
  // The migration refuses before it replaces, checks after, and says what to read in production first.
  const code = stripSql(mig);
  const firstFn = code.search(/create or replace function/i);
  const pre = code.slice(0, firstFn), post = code.slice(code.lastIndexOf('do $$'));
  if (!/\[guard-allowlists\] apply 20260920020000/.test(pre)) bad.push('preflight: does not refuse a database without the four migrations');
  if (!/if v_owner in \('authenticated', 'anon', 'authenticator'\) then\s+raise exception/.test(pre)) bad.push('preflight: does not refuse a looked-up function owned by a role a request can run as');
  if (!/c\.oid = g\.tbl::regclass\s+and r\.rolname not in \('service_role', 'postgres', 'supabase_admin', v_owner\)/.test(pre)) bad.push('preflight: does not refuse a table owned by a role the guard would call a client');
  if (!/p\.prosecdef\s+and p\.prosrc ~\* \('\\m' \|\| g\.tbl_name \|\| '\\M'\)\s+and r\.rolname not in \('service_role', 'postgres', 'supabase_admin', v_owner\)/.test(pre)) bad.push('preflight: does not refuse a definer function, naming the table, owned by a role the guard would call a client');
  if (!/position\('''authenticated''' in v_src\) > 0\s+or position\('''anon''' in v_src\) > 0/.test(post)
      || !/position\('current_user in \(''service_role'', ''postgres'', ''supabase_admin''\)' in v_src\) = 0/.test(post)
      || !/raise exception '\[guard-allowlists\] verify: % must be the allow-list/.test(post)) bad.push('self-check: does not fail the apply when a guard still names the deny-list');
  for (const g of GA_GUARDS) {
    if ((code.match(new RegExp(`\\('public\\.${g.fn}\\(\\)',[^\\n]*'${g.server.replace(/[().]/g, '\\$&')}'\\)`, 'g')) ?? []).length !== 2) bad.push(`${g.fn}: not in both the preflight list and the self-check list with ${g.server}`);
  }
  if (/\b(drop|create)\s+trigger\b|\bgrant\b|\brevoke\b|\balter\s+(table|function)\b/i.test(code)) bad.push('the migration touches a trigger, a grant or an owner; it must only replace the five bodies');
  for (const needle of ['BEFORE APPLYING, read production', 'information_schema.role_table_grants', 'from cron.job', 'c.relowner', 'p.prosecdef', 'REVERSE PATH', 'DEPLOY ORDER', 'VERIFY AFTER', 'WHO PASSES, PER GUARD', 'THE RISK OF APPLYING', 'pgq/guard-allowlists.mjs']) {
    if (!mig.includes(needle)) bad.push(`header: "${needle}" is missing`);
  }
  return bad;
}

const gaDisk = gaFilesOnDisk();
const gaNow = gaProblems(gaDisk);
ok('the five guards are allow-lists in their latest definition, each the old body with only the role test swapped; the header lists both md5s; no live function names a client role (bar the two known); the migration refuses before it replaces and checks after',
  gaNow.length === 0, gaNow.join('\n   '));
ok('the five are still first defined where this check reads the old body from', GA_GUARDS.every(g => gaDefs(g.from, gaDisk[g.from] ?? '').some(d => d.name === g.fn && GA_DENY.test(d.body))));
ok('the two known one-role deny-lists are still exactly the known two (remove a name here when it is converted)',
  GA_KNOWN_DENY.every(n => (gaLive(gaDisk).get(n) ?? []).some(d => GA_DENY.test(stripSql(d.body)))));

// Planted mutations: each returns a changed copy of the file map and must be reported.
const gaGuardSeg = (src: string, fn: string, edit: (seg: string) => string) => {
  const a = src.indexOf(`create or replace function public.${fn}()`);
  const b = src.indexOf('$;\n', src.indexOf(' then\n', a));
  const end = src.indexOf('\n\n-- ──', a);
  if (a < 0 || b < 0 || end < 0) throw new Error(`mutation anchor: ${fn}`);
  return src.slice(0, a) + edit(src.slice(a, end)) + src.slice(end);
};
const gaSwap = (seg: string, from: string, to: string) => { if (!seg.includes(from)) throw new Error(`mutation anchor: ${from.slice(0, 60)}`); return seg.replace(from, () => to); };
const GA_OWNER_PASS = "    if v_owner is not null and current_user = v_owner then\n      v_server := true;\n    end if;\n  end if;\n";
const gaNew = (edit: (src: string) => string) => (f: GaFiles): GaFiles => ({ ...f, [GA_NAME]: edit(f[GA_NAME]) });
const gaOld = (fn: string) => { const g = GA_GUARDS.find(x => x.fn === fn)!; const d = gaDefs(g.from, gaDisk[g.from]).find(x => x.name === fn)!; return `${d.head}as $f$${d.body}$f$;\n`; };
const GA_MUTATIONS: [string, (f: GaFiles) => GaFiles][] = [
  ...GA_GUARDS.map(g => [`THE DENY-LIST RESTORED in ${g.fn} (every role but the two named passes again)`,
    gaNew(s => gaGuardSeg(s, g.fn, seg => gaSwap(seg, GA_OWNER_PASS, `${GA_OWNER_PASS}  v_server := current_user not in ('authenticated', 'anon');\n`)))] as [string, (f: GaFiles) => GaFiles]),
  ['a LATER migration puts the old punch_items_guard back', f => ({ ...f, '20270101000000_oops.sql': gaOld('punch_items_guard') })],
  ['a LATER migration puts the old invoices_ledger_guard back', f => ({ ...f, '20270101000000_oops.sql': gaOld('invoices_ledger_guard') })],
  ['a LATER migration adds a new guard written as a two-role deny-list', f => ({ ...f, '20270101000000_new_guard.sql':
    "create or replace function public.rfis_keep_number() returns trigger language plpgsql as $$\nbegin\n  if current_user in ('authenticated', 'anon') then new.number := old.number; end if;\n  return new;\nend $$;\n" })],
  ['a LATER migration adds a new guard written as a one-role deny-list', f => ({ ...f, '20270101000000_new_guard.sql':
    "create or replace function public.rfis_keep_number() returns trigger language plpgsql as $$\nbegin\n  if current_user <> 'authenticated' then return new; end if;\n  new.number := old.number;\n  return new;\nend $$;\n" })],
  ['service_role dropped from invoices_ledger_guard', gaNew(s => gaGuardSeg(s, 'invoices_ledger_guard', seg => gaSwap(seg, "in ('service_role', 'postgres', 'supabase_admin') then", "in ('postgres', 'supabase_admin') then")))],
  ['a client role added to the allow-list of aia_pay_apps_pending_guard', gaNew(s => gaGuardSeg(s, 'aia_pay_apps_pending_guard', seg => gaSwap(seg, "in ('service_role', 'postgres', 'supabase_admin') then", "in ('service_role', 'postgres', 'supabase_admin', 'authenticator') then")))],
  ['the function-owner exception dropped from punch_items_guard', gaNew(s => gaGuardSeg(s, 'punch_items_guard', seg => gaSwap(seg, GA_OWNER_PASS, '  end if;\n')))],
  ['the owner lookup of punch_items_seal_pin can raise (its handler is gone)', gaNew(s => gaGuardSeg(s, 'punch_items_seal_pin', seg => gaSwap(seg, "    exception when others then\n      v_owner := null;\n", '')))],
  ['the owner lookup of punch_items_guard casts instead of asking', gaNew(s => gaGuardSeg(s, 'punch_items_guard', seg => gaSwap(seg, "pg_catalog.to_regprocedure('public.sub_portal_mark_punch_ready(text,text,text,text)')", "'public.sub_portal_mark_punch_ready(text,text,text,text)'::regprocedure")))],
  ['change_orders_keep_number_fn looks up the owner of another function', gaNew(s => gaGuardSeg(s, 'change_orders_keep_number_fn', seg => gaSwap(seg, "'public.change_orders_assign_number_fn()'", "'public.invoice_ledger_sum(jsonb)'")))],
  ['change_orders_keep_number_fn runs as its definer', gaNew(s => gaGuardSeg(s, 'change_orders_keep_number_fn', seg => gaSwap(seg, 'security invoker', 'security definer')))],
  ['punch_items_guard passes everybody', gaNew(s => gaGuardSeg(s, 'punch_items_guard', seg => gaSwap(seg, GA_OWNER_PASS, `${GA_OWNER_PASS}  v_server := true;\n`)))],
  ['a pin is lost on the way: punch_items_guard no longer keeps sub_note', gaNew(s => gaGuardSeg(s, 'punch_items_guard', seg => gaSwap(seg, '    new.sub_note := old.sub_note;\n', '')))],
  ['a pin is lost on the way: the seal pin no longer skips a client DELETE of a sealed row', gaNew(s => gaGuardSeg(s, 'punch_items_seal_pin', seg => gaSwap(seg, '    if old.seal_id is not null and not v_server then\n      return null;\n    end if;\n', '')))],
  ['the ledger guard treats the server as the client (the test is inverted)', gaNew(s => gaGuardSeg(s, 'invoices_ledger_guard', seg => gaSwap(seg, '  if v_server then\n    return new;', '  if not v_server then\n    return new;')))],
  ['the self-check no longer refuses a guard that names a client role', gaNew(s => gaSwap(s, "       or position('''authenticated''' in v_src) > 0\n       or position('''anon''' in v_src) > 0\n", ''))],
  ['the preflight no longer refuses a definer function owned by a role the guard would call a client', gaNew(s => gaSwap(s, "       and p.prosrc ~* ('\\m' || g.tbl_name || '\\M')\n", "       and false\n"))],
  ['the preflight no longer refuses a table owned by such a role', gaNew(s => gaSwap(s, "     where c.oid = g.tbl::regclass\n       and r.rolname not in", "     where false and r.rolname not in"))],
  ['the migration quietly re-grants EXECUTE on a guard', gaNew(s => s + '\ngrant execute on function public.punch_items_guard() to authenticated;\n')],
  ['the header loses the read-only checks to run before applying', gaNew(s => gaSwap(s, 'BEFORE APPLYING, read production', 'Apply it'))],
  ['a body changes and the header md5 does not', gaNew(s => gaGuardSeg(s, 'aia_pay_apps_pending_guard', seg => gaSwap(seg, '  return new;\nend\n', '  return new;  \nend\n')))],
];
const gaMissed: string[] = [];
GA_MUTATIONS.forEach(([what, plant], i) => {
  let found: string[] = [];
  try { found = gaProblems(plant(gaDisk)); } catch (e) { found = []; gaMissed.push(`${i + 1} ${what}: ${(e as Error).message}`); return; }
  if (found.length === 0) gaMissed.push(`${i + 1} ${what}: NOT CAUGHT`);
});
ok(`all ${GA_MUTATIONS.length} planted mutations turn the allow-list check red (5 restore a deny-list in place, 4 bring one back in a later migration)`,
  GA_MUTATIONS.length === 26 && gaMissed.length === 0, gaMissed.join('\n   '));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
