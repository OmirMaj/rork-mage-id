// validate-whoson-server.ts — lane WHOSERVER, "who is on this project".
//
// Static pins on supabase/migrations/20261004120000_project_people.sql, read
// with its comments stripped. The behavior itself is executed on PGlite by the
// lane's proof script (scratchpad/pgq/project-people.mjs, named in the
// migration header); this guard keeps the TEXT from drifting away from what
// that proof ran, and holds the privacy lines that are easiest to lose in an
// edit:
//
//   [1] the four presence functions: SECURITY DEFINER, search_path pinned,
//       project_people VOLATILE and gated by can_access_project before it reads
//       or writes anything; identity is auth.uid(), never a parameter, and the
//       three ids the function decides by are each assigned exactly once
//   [2] project_presence: row level security on, no policy, no client privilege,
//       the account-deletion guard can read its CREATE TABLE
//   [3] grants: anon and PUBLIC hold nothing; authenticated may call the two
//       callable functions and neither trigger function
//   [4] nothing about a plan, a payment or a contact detail is named; the only
//       profile columns read are the name, the company and the person's own choice
//   [5] a team member never receives another team member (D1), no invite that
//       was not accepted reaches the payload, each account is listed once, and
//       what is shown about a person comes from THIS project's presence row.
//       The list and its joins are compared whole, so nothing can be appended
//   [6] the thirteen result columns, and which of them only the owner receives;
//       the open column is a number or NULL, never a boolean
//   [7] the mark: only after a yes, only on a shared project, only the caller's
//       own row, only the server clock
//   [8] the two erase triggers and the 90-day job (inside its pg_cron guard)
//   [9] the file is idempotent, changes no existing row, and its code is ASCII
//  [10] the two guards: only the server puts a person on a project. A client
//       role can never write the account on a roster row, make a row accepted,
//       move a row to another project, or change who owns a project; both
//       guards run as the INVOKER (they read current_user) and are armed on
//       every write they judge
//
// PLANTED MUTATIONS: MUTATE=1..36 edits the text in memory (the file on disk
// is never touched) and each one must turn this red.
//
// Run: bun run scripts/validate-whoson-server.ts

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = '20261004120000_project_people.sql';
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
const eq = <T,>(name: string, got: T, want: T) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);

const RAW_ON_DISK = readFileSync(join(ROOT, 'supabase', 'migrations', NAME), 'utf8');
let raw = RAW_ON_DISK;

// ── planted mutations ────────────────────────────────────────────────────────
const MUTATE = Number(process.env.MUTATE || 0);
const MUTATIONS: [string, string, string][] = [
  ['a team member receives the other team members', '       and (v_is_owner or pc.user_id = v_me)', ''],
  ['the invited email reaches a non-owner', 'case when v_is_owner then s.email end as invited_email', 's.email as invited_email'],
  ['a team member receives last-seen times', 'case when v_is_owner and s.uid <> v_me and s.shares is true then s.seen_at end as last_seen_at', 'case when s.uid <> v_me and s.shares is true then s.seen_at end as last_seen_at'],
  ['the open column answers false', "ceil(extract(epoch from (s.seen_at + v_win - now())))::integer) end as open_expires_s", "ceil(extract(epoch from (s.seen_at + v_win - now())))::integer) else 0 end as open_expires_s"],
  ['project_people declared stable', 'language plpgsql volatile security definer set search_path = public\nas $$\n#variable_conflict use_column', 'language plpgsql stable security definer set search_path = public\nas $$\n#variable_conflict use_column'],
  ['the access gate removed', "  if not public.can_access_project(v_pid, 'viewer') then return; end if;\n", ''],
  ['a policy on project_presence', 'alter table public.project_presence enable row level security;', 'alter table public.project_presence enable row level security;\ncreate policy pp_read on public.project_presence for select to authenticated using (user_id = auth.uid());'],
  ['anon keeps EXECUTE', 'revoke all on function public.project_people(text, text)     from public, anon;', 'revoke all on function public.project_people(text, text)     from public;'],
  ['the plan is joined', '      left join public.profiles pf on pf.id = x.uid\n', '      left join public.profiles pf on pf.id = x.uid\n      left join public.subscriptions sb on sb.user_id = x.uid\n'],
  ['the legal name is read', "left(coalesce(pf.contact_name, ''), 400)", "left(coalesce(pf.contact_name, pf.name, ''), 400)"],
  ['a pending invite is listed', "     where pc.project_id = v_pid and pc.status = 'accepted' and pc.user_id is not null\n", "     where pc.project_id = v_pid and pc.status in ('accepted', 'pending')\n"],
  ['a mark without a yes', '  if not v_yes then\n', '  if false then\n'],
  ['a leave counts as a sighting', 'update public.project_presence pp set is_open = false\n', 'update public.project_presence pp set is_open = false, last_seen_at = clock_timestamp()\n'],
  ['a function takes a user id', 'create or replace function public.set_share_presence(p_on boolean)', 'create or replace function public.set_share_presence(p_on boolean, p_user uuid default null)'],
  ['the cron call leaves its guard', "  if exists (select 1 from pg_extension where extname = 'pg_cron') then\n    perform cron.schedule(", '  if true then\n    perform cron.schedule('],
  ['the roster trigger runs as the invoker', 'create or replace function public.whoson_forget_on_roster() returns trigger\nlanguage plpgsql security definer set search_path = public', 'create or replace function public.whoson_forget_on_roster() returns trigger\nlanguage plpgsql set search_path = public'],
  ['the choice gets a default', '  add column if not exists share_presence    boolean,', '  add column if not exists share_presence    boolean default true,'],
  ['the project is compared as text', 'from public.projects p where p.id = v_pid;', 'from public.projects p where p.id::text = p_project_id;'],
  ['the open window changed without the client', "v_win      constant interval := interval '150 seconds';", "v_win      constant interval := interval '300 seconds';"],
  ['the erase runs in a read-only transaction', "    if current_setting('transaction_read_only') = 'off' then\n", '    if true then\n'],
  ['an invisible character in the code', "'[@\\uFF20\\uFE6B]' then nullif(rtrim(left(s.nm, 80)), '') end as display_name", `'[@${String.fromCharCode(0xff20)}\\uFE6B]' then nullif(rtrim(left(s.nm, 80)), '') end as display_name`],
  ['the D1 predicate is followed by "or true"', '       and (v_is_owner or pc.user_id = v_me)', '       and (v_is_owner or pc.user_id = v_me) or true'],
  ['everyone is treated as the owner', 'v_is_owner := (v_owner = v_me);', 'v_is_owner := true;'],
  ['the owner is overwritten with the caller', 'from public.projects p where p.id = v_pid;', 'from public.projects p where p.id = v_pid; v_owner := v_me;'],
  ['the presence join loses its project filter', 'left join public.project_presence pp on pp.project_id = v_pid and pp.user_id = x.uid', 'left join public.project_presence pp on pp.user_id = x.uid'],
  ['an account with two accepted rows is listed twice', '    (select distinct on (pc.user_id)\n', '    (select\n'],
  ['the roster guard runs as its definer', 'create or replace function public.whoson_guard_roster() returns trigger\nlanguage plpgsql security invoker set search_path = public', 'create or replace function public.whoson_guard_roster() returns trigger\nlanguage plpgsql security definer set search_path = public'],
  ['the roster guard is never armed', 'create trigger zz_whoson_guard_roster\n  before insert or update on public.project_collaborators\n  for each row execute function public.whoson_guard_roster();', ''],
  ['the roster guard lets a client make a row accepted', "     or (new.status = 'accepted' and old.status is distinct from 'accepted') then\n", '     then\n'],
  ['the roster guard only refuses anon', "  if current_user not in ('authenticated', 'anon') then return new; end if;", "  if current_user not in ('anon') then return new; end if;"],
  ['the roster guard is armed on insert only', '  before insert or update on public.project_collaborators\n', '  before insert on public.project_collaborators\n'],
  ['the caller is taken from somewhere else later', "  if v_pid is null then return; end if;\n", "  if v_pid is null then return; end if;\n  v_me := v_pid;\n"],
  ['the owner guard runs as its definer', 'create or replace function public.whoson_guard_project_owner() returns trigger\nlanguage plpgsql security invoker set search_path = public', 'create or replace function public.whoson_guard_project_owner() returns trigger\nlanguage plpgsql security definer set search_path = public'],
  ['the owner guard is never armed', 'create trigger aa_whoson_guard_project_owner\n  before update on public.projects\n  for each row execute function public.whoson_guard_project_owner();', ''],
  ['the owner guard only pins for anon', "  if current_user in ('authenticated', 'anon') then\n    new.user_id := old.user_id;", "  if current_user in ('anon') then\n    new.user_id := old.user_id;"],
  ['the owner guard only fires when the column is named', '  before update on public.projects\n', '  before update of name on public.projects\n'],
];
if (MUTATE) {
  const m = MUTATIONS[MUTATE - 1];
  if (!m) { console.error('unknown MUTATE'); process.exit(2); }
  if (!raw.includes(m[1])) { console.error(`MUTATE=${MUTATE}: anchor not found`); process.exit(3); }
  raw = raw.replace(m[1], () => m[2]);
  console.log(`(planted mutation ${MUTATE}: ${m[0]})`);
}

// ── readers ──────────────────────────────────────────────────────────────────
const sql = raw.replace(/--[^\n]*/g, '');
const flat = sql.replace(/\s+/g, ' ');
const has = (s: string) => flat.includes(s.replace(/\s+/g, ' '));
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

type Fn = { name: string; args: string; head: string; body: string };
const fns: Fn[] = [...sql.matchAll(/create or replace function public\.(\w+)\(([^)]*)\)([\s\S]*?)\bas \$\$([\s\S]*?)\$\$;/g)]
  .map(m => ({ name: m[1], args: m[2].trim(), head: m[3].replace(/\s+/g, ' ').trim(), body: m[4] }));
const fn = (n: string): Fn => fns.find(f => f.name === n) ?? { name: n, args: '', head: '', body: '' };
const people = fn('project_people');
const choice = fn('set_share_presence');
const onChoice = fn('whoson_forget_on_choice');
const onRoster = fn('whoson_forget_on_roster');
const guard = fn('whoson_guard_roster');
const ownerGuard = fn('whoson_guard_project_owner');
const pBody = people.body.replace(/\s+/g, ' ');
const at = (s: string) => pBody.indexOf(s.replace(/\s+/g, ' '));

// ── [1] the four functions ───────────────────────────────────────────────────
console.log('\n[1] functions');
eq('the file creates exactly six functions', fns.map(f => f.name).sort(),
  ['project_people', 'set_share_presence', 'whoson_forget_on_choice', 'whoson_forget_on_roster', 'whoson_guard_project_owner', 'whoson_guard_roster']);
for (const f of [people, choice, onChoice, onRoster]) {
  ok(`${f.name} is SECURITY DEFINER with search_path = public`,
    /\bsecurity definer\b/.test(f.head) && /\bset search_path = public\b/.test(f.head) && !/security invoker/.test(f.head), f.head);
}
ok('project_people is VOLATILE (PostgREST runs a stable function read-only, and the mark would fail)',
  /\bvolatile\b/.test(people.head) && !/\b(stable|immutable)\b/.test(people.head), people.head);
ok('set_share_presence is VOLATILE', /\bvolatile\b/.test(choice.head) && !/\b(stable|immutable)\b/.test(choice.head), choice.head);
eq('project_people takes the project id and the mark, nothing else', people.args.replace(/\s+/g, ' '), "p_project_id text, p_mark text default 'none'");
eq('set_share_presence takes the answer, nothing else', choice.args, 'p_on boolean');
ok('no function takes a user id: no uuid argument, no argument named after a person',
  fns.every(f => !/\buuid\b/i.test(f.args) && !/user|uid|owner|member|person/i.test(f.args)), fns.map(f => `${f.name}(${f.args})`).join(' | '));
ok('project_people takes identity from auth.uid() and returns nothing without one',
  at('v_me uuid := auth.uid();') >= 0 && at('if v_me is null then return; end if;') >= 0);
ok('project_people keeps #variable_conflict use_column (its result columns share names with table columns)',
  /^\s*#variable_conflict use_column\s*$/m.test(people.body));
{
  const gate = at("if not public.can_access_project(v_pid, 'viewer') then return; end if;");
  const firsts = ['insert into', 'update public.', 'delete from', 'return query', 'from public.projects', 'from public.profiles', 'from public.project_collaborators']
    .map(s => at(s)).filter(i => i >= 0);
  ok('the can_access_project gate comes before every read and every write in project_people',
    gate >= 0 && firsts.length === 7 && firsts.every(i => i > gate), `gate at ${gate}, first statements at ${firsts.join(', ')}`);
}
{
  // Who the caller is, which project, who owns it and whether the caller is that
  // owner are each decided ONCE. A second assignment anywhere would change every
  // line below it without touching a line this file pins.
  eq('project_people assigns four variables in its body, each exactly once, in this order',
    [...pBody.matchAll(/\b(v_\w+)\s*:=/g)].map(m => m[1]), ['v_pid', 'v_is_owner', 'v_yes', 'v_shared']);
  eq('...and selects into exactly one: the owner', [...pBody.matchAll(/\binto\s+(v_\w+)/g)].map(m => m[1]), ['v_owner']);
  ok('the owner is the user_id of the project row found by its primary key',
    at('select p.user_id into v_owner from public.projects p where p.id = v_pid; if v_owner is null then return; end if;') >= 0);
  ok('the caller is the owner only when the two ids are equal', at('v_is_owner := (v_owner = v_me);') >= 0);
}
ok('a junk project id returns zero rows instead of throwing',
  at('begin v_pid := p_project_id::uuid; exception when others then return; end;') >= 0 && at('if v_pid is null then return; end if;') >= 0);
ok('the project is found by its uuid primary key, never by a text cast',
  at('from public.projects p where p.id = v_pid;') >= 0 && !/\bid::text\b/.test(sql) && !/project_id::text/.test(sql));
{
  const c = choice.body.replace(/\s+/g, ' ');
  ok('set_share_presence refuses no user and a NULL answer, writes only the caller\'s row, and returns what is stored',
    c.includes("if v_me is null or p_on is null then raise exception 'not allowed' using errcode = '42501';")
    && c.includes('v_me uuid := auth.uid();') && c.includes('where f.id = v_me returning f.share_presence into v_stored;')
    && c.includes('if not found then') && c.includes('return v_stored;'));
}

// ── [2] the table ────────────────────────────────────────────────────────────
console.log('\n[2] project_presence');
ok('row level security is enabled', has('alter table public.project_presence enable row level security;') && !/disable row level security/.test(flat));
ok('no policy is created anywhere in the file (no client reads or writes the table)', !/\bcreate policy\b/i.test(sql));
ok('every client privilege is revoked', has('revoke all on public.project_presence from public, anon, authenticated;'));
{
  const grants = [...flat.matchAll(/grant ([^;]*?) on public\.project_presence to ([^;]*);/g)].map(m => m[2].trim());
  eq('the only table grant is to service_role', grants, ['service_role']);
}
{
  // The same regex scripts/validate-account-deletion.ts uses to accept a table a
  // migration creates before schema.sql is regenerated.
  const cols = new Map<string, Set<string>>();
  for (const m of sql.matchAll(/create table (?:if not exists )?public\.(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
    const set = new Set<string>();
    for (const line of m[2].split('\n')) {
      if (/^\s*(constraint|primary|unique|check|foreign)\b/i.test(line)) continue;
      const cm = line.match(/^\s+"?(\w+)"?\s+\S/);
      if (cm) set.add(cm[1]);
    }
    cols.set(m[1], set);
  }
  eq('the account-deletion guard can read the CREATE TABLE: one table, four columns', [...cols.keys()], ['project_presence']);
  eq('...with a user_id column', [...(cols.get('project_presence') ?? [])].sort(), ['is_open', 'last_seen_at', 'project_id', 'user_id']);
}
ok('both foreign keys cascade (the rows go with the login and with the project)',
  has('project_id uuid not null references public.projects(id) on delete cascade,') && has('user_id uuid not null references auth.users(id) on delete cascade,'));
ok('the primary key is named (the upsert names the constraint, not its columns)',
  has('constraint project_presence_pkey primary key (project_id, user_id)') && at('on conflict on constraint project_presence_pkey do update') >= 0);
ok('no index on last_seen_at (it changes on every mark)', !/create index[^;]*\(\s*last_seen_at/.test(flat));
ok('the choice columns are nullable with no default and no backfill',
  has('alter table public.profiles add column if not exists share_presence boolean, add column if not exists share_presence_at timestamptz;')
  && count(flat, 'set share_presence = ') === 1 && choice.body.includes('set share_presence = p_on'));

// ── [3] grants ───────────────────────────────────────────────────────────────
console.log('\n[3] grants');
ok('project_people: revoked from public and anon', has('revoke all on function public.project_people(text, text) from public, anon;'));
ok('set_share_presence: revoked from public and anon', has('revoke all on function public.set_share_presence(boolean) from public, anon;'));
ok('project_people: granted to authenticated', has('grant execute on function public.project_people(text, text) to authenticated, service_role;'));
ok('set_share_presence: granted to authenticated', has('grant execute on function public.set_share_presence(boolean) to authenticated, service_role;'));
ok('neither trigger function is callable by a client',
  has('revoke all on function public.whoson_forget_on_choice() from public, anon, authenticated;')
  && has('revoke all on function public.whoson_forget_on_roster() from public, anon, authenticated;'));
{
  const toClient = [...flat.matchAll(/\bgrant\b([^;]*?)\bto\b([^;]*);/g)].filter(m => /\b(anon|public)\b/.test(m[2])).map(m => m[0]);
  eq('nothing in the file is granted to anon or PUBLIC', toClient, []);
}
ok('the apply checks itself: a self-check block raises on a missing lock',
  count(sql, "raise exception '[whoson] verify:") === 11
  && has("if has_function_privilege('anon', 'public.project_people(text, text)', 'execute')")
  && has("if not (select relrowsecurity from pg_class where oid = 'public.project_presence'::regclass) then"));

// ── [4] what is never named ──────────────────────────────────────────────────
console.log('\n[4] nothing about a plan, a payment or a contact detail');
{
  const banned = ['subscriptions', 'tier', 'stripe', 'push_token', 'phone', 'address', 'license_number', 'signature_data', 'invite_token', 'avatar_url', 'logo_uri', 'pending', 'raw_user_meta', 'entitlement', 'revenuecat'];
  const hits = banned.filter(w => sql.toLowerCase().includes(w));
  eq(`none of ${banned.length} banned words appears outside a comment`, hits, []);
}
ok('profiles.name and profiles.email are never read', !/\b(pf|f|profiles)\.(name|email)\b/.test(sql), (sql.match(/\b(pf|f|profiles)\.(name|email)\b/g) ?? []).join(', '));
eq('the only profile columns read through pf are the name, the company and the choice',
  [...new Set([...sql.matchAll(/\bpf\.(\w+)/g)].map(m => m[1]))].sort(), ['company_name', 'contact_name', 'id', 'share_presence']);
eq('the only profile columns touched through f are the id and the choice',
  [...new Set([...sql.matchAll(/\bf\.(\w+)/g)].map(m => m[1]))].sort(), ['id', 'share_presence']);
ok('no function reads the JWT beyond auth.uid()', !/auth\.jwt|auth\.email|request\.jwt/.test(sql));

// ── [5] D1 ───────────────────────────────────────────────────────────────────
console.log('\n[5] team members do not see each other');
{
  // Compared WHOLE, never with includes(): "... or true" after the last predicate
  // would pass an includes() and hand every team member the whole team.
  const m = pBody.match(/with ppl as \(([\s\S]*?)\), shown as \(/);
  const ppl = (m?.[1] ?? '').trim();
  const OWNER = "select v_owner as uid, 'owner'::text as kind, 'owner'::text as role, null::text as email, null::timestamptz as joined_at, null::uuid as invited_by";
  const SELECT = "select distinct on (pc.user_id) pc.user_id, 'member'::text, pc.role, pc.invited_email, pc.accepted_at, pc.invited_by from public.project_collaborators pc";
  const WHERE = "pc.project_id = v_pid and pc.status = 'accepted' and pc.user_id is not null and pc.user_id <> v_owner and (v_is_owner or pc.user_id = v_me)";
  const ORDER = 'pc.user_id, pc.accepted_at desc nulls last, pc.id';
  ok('the people list was found', ppl.length > 0);
  eq('the people list is the owner row plus one member branch, and nothing else', ppl, `${OWNER} union all (${SELECT} where ${WHERE} order by ${ORDER})`);
  const w = ppl.match(/ where ([\s\S]*?) order by /)?.[1] ?? '';
  eq("the member branch's whole WHERE: this project, accepted, a real account, not the owner again, and (D1) the owner sees everyone while a team member sees only themself", w, WHERE);
  ok('...with no OR outside the one D1 pair', count(w, ' or ') === 1 && w.endsWith('and (v_is_owner or pc.user_id = v_me)'), w);
  ok('each account is listed once, by its most recent acceptance', ppl.includes('select distinct on (pc.user_id) pc.user_id,') && ppl.endsWith(`order by ${ORDER})`), ppl);
  eq('the profile and the presence row are joined once each, the presence row by THIS project and that person, with nothing after',
    pBody.match(/ from ppl x ([\s\S]*?) \) select s\.uid as user_id/)?.[1] ?? '',
    'left join public.profiles pf on pf.id = x.uid left join public.project_presence pp on pp.project_id = v_pid and pp.user_id = x.uid');
  ok('...and no other join exists in the function', count(pBody, ' join ') === 2 && count(pBody, 'public.project_presence pp on ') === 1);
  ok('the result is read from that list only, ordered owner first',
    at("from shown s order by (s.kind = 'owner') desc, s.joined_at nulls last, s.uid; end") >= 0 && count(pBody, ' from shown ') === 1 && count(pBody, ' from ppl ') === 1);
}
{
  const refs = [...pBody.matchAll(/from public\.project_collaborators pc where ([^;)]*)/g)].map(m => m[1]);
  ok('every read of the roster in project_people is filtered to accepted', refs.length === 2 && refs.every(r => r.includes("pc.status = 'accepted'")), JSON.stringify(refs));
}
ok('the payload carries no count and no aggregate', !/\b(count|sum|array_agg|json_agg|jsonb_agg|string_agg)\s*\(/.test(people.body));

// ── [6] the result ───────────────────────────────────────────────────────────
console.log('\n[6] the thirteen columns');
const COLUMNS: [string, string][] = [
  ['user_id', 'uuid'], ['kind', 'text'], ['role', 'text'], ['display_name', 'text'], ['company_name', 'text'],
  ['is_self', 'boolean'], ['invited_by_viewer', 'boolean'], ['invited_email', 'text'], ['joined_at', 'timestamptz'],
  ['open_expires_s', 'integer'], ['last_seen_at', 'timestamptz'], ['seen_age_s', 'integer'], ['shares_presence', 'boolean'],
];
{
  const m = people.head.match(/returns table \(([^)]*)\)/);
  const got = (m?.[1] ?? '').split(',').map(s => s.trim().split(/\s+/));
  eq('returns table lists exactly the thirteen names and types of the spec, in order', got, COLUMNS);
}
const exprs = new Map<string, string>();
{
  const start = at(') select s.uid as user_id');
  const end = at('from shown s order by');
  const list = start >= 0 && end > start ? pBody.slice(start + ') select '.length, end) : '';
  let rest = list;
  const order: string[] = [];
  for (const [name] of COLUMNS) {
    const i = rest.indexOf(` as ${name}`);
    if (i < 0) break;
    exprs.set(name, rest.slice(0, i).replace(/^[\s,]+/, '').trim());
    order.push(name);
    rest = rest.slice(i + ` as ${name}`.length);
  }
  eq('the final select names the same thirteen columns in the same order', order, COLUMNS.map(c => c[0]));
  ok('...and nothing after the thirteenth', rest.trim() === '', rest);
}
const ex = (n: string) => exprs.get(n) ?? '';
eq('invited_email reaches the result only for the owner', ex('invited_email'), 'case when v_is_owner then s.email end');
eq('last_seen_at reaches the result only for the owner, about other people, who said yes',
  ex('last_seen_at'), 'case when v_is_owner and s.uid <> v_me and s.shares is true then s.seen_at end');
ok('seen_age_s likewise, and only when there is a time to age',
  ex('seen_age_s').startsWith('case when v_is_owner and s.uid <> v_me and s.shares is true and s.seen_at is not null then ')
  && ex('seen_age_s').endsWith(' end') && !/\belse\b/.test(ex('seen_age_s')), ex('seen_age_s'));
{
  const o = ex('open_expires_s');
  ok('open_expires_s needs a yes, another person, an open row and the window',
    o.startsWith('case when s.shares is true and s.uid <> v_me and s.is_open and s.seen_at > now() - v_win then greatest(1, ') && o.endsWith('::integer) end'), o);
  ok('...and is a number or NULL on every path: no else, no boolean, no zero', !/\belse\b|\bfalse\b|\btrue\b(?! and)|coalesce|, 0\b/.test(o.replace('s.shares is true', '')), o);
}
eq('shares_presence is the viewer\'s own choice only', ex('shares_presence'), 'case when s.uid = v_me then s.shares end');
ok('names drop any value with an at sign and stop at 80 characters',
  ['display_name', 'company_name'].every(n => /^case when s\.(nm|co) !~ '\[@\\uFF20\\uFE6B\]' then nullif\(rtrim\(left\(s\.(nm|co), 80\)\), ''\) end$/.test(ex(n))),
  `${ex('display_name')} | ${ex('company_name')}`);
{
  const owned: Record<string, string[]> = { 's.email': ['invited_email'], 's.seen_at': ['open_expires_s', 'last_seen_at', 'seen_age_s'], 's.is_open': ['open_expires_s'], 's.shares': ['open_expires_s', 'last_seen_at', 'seen_age_s', 'shares_presence'] };
  const leaks: string[] = [];
  for (const [token, allowed] of Object.entries(owned)) for (const [name, e] of exprs) if (e.includes(token) && !allowed.includes(name)) leaks.push(`${token} in ${name}`);
  eq('the email, the time, the open flag and the choice appear in no other column', leaks, []);
}
ok('names are read from at most 400 characters and stripped of control and invisible characters',
  count(pBody, "left(coalesce(pf.contact_name, ''), 400)") === 1 && count(pBody, "left(coalesce(pf.company_name, ''), 400)") === 1
  && count(pBody, 'v_strip') === 3 && people.body.includes("'[[:cntrl:]\\u007F-\\u009F\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2069\\uFEFF]'"));
eq('the window is 150 seconds, written once', [...sql.matchAll(/interval '(\d+) seconds'/g)].map(m => Number(m[1])).sort((a, b) => a - b), [10, 150]);

// ── [7] the mark ─────────────────────────────────────────────────────────────
console.log('\n[7] the mark');
{
  const yes = at('v_yes := exists (select 1 from public.profiles f where f.id = v_me and f.share_presence is true);');
  const notYes = at('if not v_yes then');
  const heal = at("if current_setting('transaction_read_only') = 'off' then delete from public.project_presence pp where pp.project_id = v_pid and pp.user_id = v_me; end if;");
  const open = at("elsif p_mark = 'open' then");
  const shared = at('if v_shared then');
  const ins = at('insert into public.project_presence as pp (project_id, user_id, last_seen_at, is_open) values (v_pid, v_me, now(), true)');
  const closed = at("elsif p_mark = 'closed' then");
  const upd = at('update public.project_presence pp set is_open = false where pp.project_id = v_pid and pp.user_id = v_me and pp.is_open;');
  const ret = at('return query');
  const seq = [yes, notYes, heal, open, shared, ins, closed, upd, ret];
  ok('order: the yes test, the erase for a not-yes caller (skipped in a read-only transaction), then open (shared only), then closed, then the read',
    seq.every(i => i >= 0) && seq.every((v, i) => i === 0 || v > seq[i - 1]), seq.join(' < '));
  ok('a project counts as shared for a non-owner, or when an accepted person other than the owner is on it',
    at("v_shared := (not v_is_owner) or exists ( select 1 from public.project_collaborators pc where pc.project_id = v_pid and pc.status = 'accepted' and pc.user_id is not null and pc.user_id <> v_owner);") >= 0);
  ok('a looping client writes at most once per 10 seconds',
    at("where pp.is_open is false or pp.last_seen_at < now() - interval '10 seconds';") > ins);
  eq('project_people writes project_presence in exactly three statements (the upsert, the leave, the erase)',
    (pBody.match(/\b(insert into|update|delete from) public\.\w+/g) ?? []).sort(),
    ['delete from public.project_presence', 'insert into public.project_presence', 'update public.project_presence']);
}
{
  const sets = [...flat.matchAll(/last_seen_at\s*=\s*([^,;\s]+)/g)].map(m => m[1]);
  eq('last_seen_at is only ever set from now()', sets, ['now()']);
  ok('...and defaults to now()', has('last_seen_at timestamptz not null default now(),'));
  ok('no other clock is used', !/clock_timestamp|statement_timestamp|timeofday|current_timestamp/.test(sql));
}

// ── [8] erase ────────────────────────────────────────────────────────────────
console.log('\n[8] erase');
ok('the choice trigger fires on any change of the answer, in both directions',
  has('drop trigger if exists whoson_forget_on_choice on public.profiles; create trigger whoson_forget_on_choice after update of share_presence on public.profiles for each row when (old.share_presence is distinct from new.share_presence) execute function public.whoson_forget_on_choice();'));
ok('...and deletes every row of that person', onChoice.body.replace(/\s+/g, ' ').includes('delete from public.project_presence pp where pp.user_id = new.id;'));
ok('the roster trigger fires on a status or user change and on delete',
  has('drop trigger if exists whoson_forget_on_roster on public.project_collaborators; create trigger whoson_forget_on_roster after update of status, user_id or delete on public.project_collaborators for each row execute function public.whoson_forget_on_roster();'));
{
  const b = onRoster.body.replace(/\s+/g, ' ');
  ok('...never reads NEW (one body for UPDATE and DELETE), and skips an invite nobody accepted',
    !/\bnew\./i.test(b) && b.includes('if old.user_id is null then return null; end if;'));
  ok('...and keeps a row only for a person a mark would be accepted from: the owner while someone else is on, anyone else while accepted',
    b.includes('delete from public.project_presence pp where pp.project_id = old.project_id and not (case when exists (select 1 from public.projects p where p.id = pp.project_id and p.user_id = pp.user_id)')
    && b.includes("then exists (select 1 from public.project_collaborators pc where pc.project_id = pp.project_id and pc.status = 'accepted' and pc.user_id is not null and pc.user_id <> pp.user_id)")
    && b.includes("else exists (select 1 from public.project_collaborators pc where pc.project_id = pp.project_id and pc.status = 'accepted' and pc.user_id = pp.user_id) end);"));
}
{
  const guard = flat.match(/do \$\$ begin if exists \(select 1 from pg_extension where extname = 'pg_cron'\) then perform cron\.schedule\('whoson-presence-purge', '17 8 \* \* \*', \$j\$ ([\s\S]*?) \$j\$\); end if; end \$\$;/);
  ok('the cron call sits inside an "if exists (... pg_extension ...)" guard, and is the only one', !!guard && count(flat, 'cron.schedule(') === 1);
  const job = guard?.[1] ?? '';
  ok('the job deletes rows older than 90 days, and any row whose person\'s answer is not yes',
    job.startsWith('delete from public.project_presence pp where') && job.includes("pp.last_seen_at < now() - interval '90 days'")
    && job.includes('or not exists (select 1 from public.profiles f where f.id = pp.user_id and f.share_presence is true)'), job);
  ok('the job is plain SQL: no HTTP call, no secret', !/net\.http|vault|secret|http_post/i.test(sql));
}

// ── [10] the roster guard ────────────────────────────────────────────────────
console.log('\n[10] only the server puts a person on a project');
ok('the guard runs as the INVOKER (it reads current_user; as a definer it would see its owner and refuse nobody), search_path pinned',
  /\bsecurity invoker\b/.test(guard.head) && !/security definer/.test(guard.head) && /\bset search_path = public\b/.test(guard.head), guard.head);
eq('the guard is exactly the rule: a client role never writes the account on a row, never makes a row accepted, never moves a row to another project',
  guard.body.replace(/\s+/g, ' ').trim(),
  "begin if current_user not in ('authenticated', 'anon') then return new; end if;"
  + " if tg_op = 'INSERT' then if new.user_id is not null or new.status = 'accepted' then raise exception 'only the server can put a person on a project' using errcode = '42501'; end if;"
  + " elsif new.user_id is distinct from old.user_id or new.project_id is distinct from old.project_id or (new.status = 'accepted' and old.status is distinct from 'accepted')"
  + " then raise exception 'only the server can put a person on a project' using errcode = '42501'; end if; return new; end");
ok('it is armed BEFORE every insert and every update of a roster row (no column list), for each row, and named to fire last',
  has('drop trigger if exists zz_whoson_guard_roster on public.project_collaborators; create trigger zz_whoson_guard_roster before insert or update on public.project_collaborators for each row execute function public.whoson_guard_roster();'));
ok('the owner guard runs as the INVOKER too, search_path pinned',
  /\bsecurity invoker\b/.test(ownerGuard.head) && !/security definer/.test(ownerGuard.head) && /\bset search_path = public\b/.test(ownerGuard.head), ownerGuard.head);
eq('the owner guard is exactly the rule: a client role never changes who owns a project (the value is put back; nothing is raised, no other column is touched)',
  ownerGuard.body.replace(/\s+/g, ' ').trim(),
  "begin if current_user in ('authenticated', 'anon') then new.user_id := old.user_id; end if; return new; end");
ok('it is armed BEFORE every update of a project (no column list), for each row, and named to fire first',
  has('drop trigger if exists aa_whoson_guard_project_owner on public.projects; create trigger aa_whoson_guard_project_owner before update on public.projects for each row execute function public.whoson_guard_project_owner();'));
ok('no client role can call either guard',
  has('revoke all on function public.whoson_guard_roster() from public, anon, authenticated;')
  && has('revoke all on function public.whoson_guard_project_owner() from public, anon, authenticated;'));
ok('the apply fails if a guard is a definer or is not armed on every write it judges',
  has("if (select prosecdef from pg_proc where oid = 'public.whoson_guard_roster()'::regprocedure) or (select prosecdef from pg_proc where oid = 'public.whoson_guard_project_owner()'::regprocedure) then raise exception '[whoson] verify:")
  && has("if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.project_collaborators'::regclass and t.tgname = 'zz_whoson_guard_roster' and not t.tgisinternal and t.tgenabled <> 'D' and t.tgfoid = 'public.whoson_guard_roster()'::regprocedure and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4 and (t.tgtype & 16) = 16 and t.tgattr = ''::int2vector) then raise exception '[whoson] verify:")
  && has("if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.projects'::regclass and t.tgname = 'aa_whoson_guard_project_owner' and not t.tgisinternal and t.tgenabled <> 'D' and t.tgfoid = 'public.whoson_guard_project_owner()'::regprocedure and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16 and t.tgattr = ''::int2vector) then raise exception '[whoson] verify:"));
ok('the file changes no policy and alters neither the roster table nor the projects table',
  !/\b(create|drop|alter) policy\b/i.test(sql) && !/alter table public\.(project_collaborators|projects)\b/.test(flat));
eq('the only triggers created are the two erase triggers and the two guards, each on its own table',
  [...flat.matchAll(/create trigger (\w+) (before|after) ([\w ,]+?) on public\.(\w+) for each row/g)].map(m => `${m[1]} ${m[2]} ${m[3]} on ${m[4]}`),
  ['whoson_forget_on_choice after update of share_presence on profiles',
    'whoson_forget_on_roster after update of status, user_id or delete on project_collaborators',
    'zz_whoson_guard_roster before insert or update on project_collaborators',
    'aa_whoson_guard_project_owner before update on projects']);

// ── [9] the file ─────────────────────────────────────────────────────────────
console.log('\n[9] the file');
{
  const top = sql.replace(/create or replace function[\s\S]*?\$\$;/g, '').replace(/do \$\$[\s\S]*?\$\$;/g, '');
  ok('outside the functions and DO blocks the file changes no row', !/\b(insert into|update|delete from|truncate)\b/i.test(top.replace(/after update of/g, '').replace(/before insert or update on/g, '').replace(/before update on/g, '').replace(/select, insert, update, delete/g, '')),
    (top.match(/\b(insert into|update|delete from|truncate)\b[^\n]*/gi) ?? []).join(' | '));
  ok('nothing is dropped but the four triggers it recreates', (flat.match(/\bdrop \w+/g) ?? []).join(',') === 'drop trigger,drop trigger,drop trigger,drop trigger' && count(flat, 'create trigger ') === 4);
  ok('idempotent forms only: if not exists / or replace',
    has('create table if not exists public.project_presence (') && count(flat, 'add column if not exists') === 2
    && count(flat, 'create or replace function') === 6 && count(flat, 'create function') === 0
    && (flat.match(/create index(?! if not exists)/g) ?? []).length === 0);
}
ok('PostgREST is told to reload the schema, last', /notify pgrst, 'reload schema';\s*$/.test(sql));
{
  const bad = sql.split('\n').map((l, i) => [i + 1, l] as const).filter(([, l]) => /[^\x09\x20-\x7E]/.test(l)).map(([n]) => n);
  eq('the code is plain ASCII: invisible characters are written as \\u escapes, never pasted', bad, []);
}
ok('the header names the PGlite proof script', RAW_ON_DISK.includes('project-people.mjs') && RAW_ON_DISK.includes('VERIFY AFTER') && RAW_ON_DISK.includes('DEPLOY ORDER'));
{
  const all = readdirSync(join(ROOT, 'supabase', 'migrations')).filter(f => /^\d{14}_[\w-]+\.sql$/.test(f)).sort();
  ok('the migration sorts after the newest one on the branch it was cut from (20261003090000_content_rights.sql)',
    all.includes(NAME) && NAME > '20261003090000_content_rights.sql' && all.filter(f => f.slice(0, 14) === NAME.slice(0, 14)).length === 1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILED'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
