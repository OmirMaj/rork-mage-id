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

import { readFileSync, existsSync } from 'node:fs';
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
