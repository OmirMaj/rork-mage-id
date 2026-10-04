// validate-whoson-integrate — "who is on this project", the pins that span
// lanes, and the proof that the feature ships DARK (INTEGRATE).
//
// WHAT IT PROVES.
//
// A. THE SEAMS. Three lanes built this in three places that never ran together
//    before the merge: a migration (WHOSERVER), a kit (WHOKIT) and the wiring
//    (WHOWIRE). Each lane's own validator passes in its own worktree, so none
//    of them can see:
//      - the server's "has it open" window drifting from the phone's
//        (a dot that outlives the fact, or one that never shows);
//      - a column the server returns that the phone never reads, or one the
//        phone reads that the server does not send (a silently null name);
//      - the client calling a function with an argument name the migration
//        does not declare (PostgREST answers "function not found");
//      - an account that is deleted and leaves its last-seen rows behind;
//      - strings no Spanish translator will ever be handed;
//      - a validator that exists and that the ship gate never runs.
//
// B. DARK. WHOS_ON_ENABLED is false, and that one constant is the whole
//    switch. With it false nothing may be drawn, asked, timed or sent, because
//    the migration may not be applied yet, the privacy paragraph is not
//    published, and nobody has been asked. "Every entry point checks it" is
//    not a list somebody typed: the entry points are DERIVED (the barrel's
//    exports, every file that names the two RPCs or the profile column, every
//    file that starts a timer or a listener, every file outside the kit that
//    imports from it), so an entry point added later without the check is red.
//
// C. GO-LIVE. The day the flag is turned on, this file refuses unless the
//    privacy paragraph and the App Store privacy line are in the repo. While
//    the flag is off they are printed as owed and not counted: the founder
//    owns both pages (GO-LIVE.md in the session's whoson-specs folder has the
//    ready-to-apply text and the ordered checklist).
//
// PLANTED MUTATIONS: MUTATE=1..N edits file text IN MEMORY (nothing on disk
// changes) and every one must turn this file red. Run them all with
//   for i in $(seq 1 N); do MUTATE=$i bun run scripts/validate-whoson-integrate.ts >/dev/null 2>&1 && echo "MUTATION $i SURVIVED"; done
// `MUTATE=list` prints them.
//
// Run: bun run scripts/validate-whoson-integrate.ts
// Pure node:fs + three pure modules; no react-native import (those crash bun).
// fileURLToPath + join because the repo path contains a space.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { WHOSON } from '../utils/whoson/people';
import { WHOS_ON_ENABLED } from '../constants/featureFlags';
import { shouldPersist, PERSIST_ALLOW } from '../utils/queryPersist';
import { EN_SHARDS } from '../i18n/catalog/en';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── the files ────────────────────────────────────────────────────────────────
const FLAGS = 'constants/featureFlags.ts';
const MIGRATION = 'supabase/migrations/20261004120000_project_people.sql';
const PEOPLE = 'utils/whoson/people.ts';
const CLIENT = 'utils/whoson/peopleClient.ts';
const PEOPLE_HOOK = 'hooks/useProjectPeople.ts';
const SHARE_HOOK = 'hooks/useSharePresence.ts';
const COPY_HOOK = 'hooks/useWhosOnCopy.ts';
const BARREL = 'components/whoson/index.ts';
const BEACON = 'components/whoson/ProjectPresenceBeacon.tsx';
const ROSTER = 'components/collaborators/CollaboratorsManager.tsx';
const LAYOUT = 'app/_layout.tsx';
const PROJECT = 'app/project-detail.tsx';
const SETTINGS = 'app/(tabs)/settings/index.tsx';
const DELETE_ACCOUNT = 'supabase/functions/delete-account/index.ts';
const SURFACES = 'i18n/surfaces.ts';
const EN_INDEX = 'i18n/catalog/en/index.ts';
const EN_SHARD = 'i18n/catalog/en/office.whoson.generated.ts';
const PERSIST = 'utils/queryPersist.ts';
const PRIVACY = 'marketing/privacy.html';
const METADATA = 'docs/app-store-metadata.md';

// ── planted mutations (in memory) ────────────────────────────────────────────
type Mutation = { name: string; file: string; from?: string; to?: string; append?: string };
const GATE = 'if (!WHOS_ON_ENABLED) return null;';
const MUTATIONS: Mutation[] = [
  { name: 'the flag is turned on', file: FLAGS, from: 'export const WHOS_ON_ENABLED = false;', to: 'export const WHOS_ON_ENABLED = true;' },
  { name: 'ProjectPeopleStack loses its flag check', file: 'components/whoson/ProjectPeopleStack.tsx', from: GATE, to: '' },
  { name: 'ProjectPeopleBlock loses its flag check', file: 'components/whoson/ProjectPeopleBlock.tsx', from: GATE, to: '' },
  { name: 'PresenceChoiceCard loses its flag check', file: 'components/whoson/PresenceChoiceCard.tsx', from: GATE, to: '' },
  { name: 'SharePresenceSwitchRow loses its flag check', file: 'components/whoson/SharePresenceSwitchRow.tsx', from: GATE, to: '' },
  { name: 'SharePresenceSettingRow loses its flag check', file: 'components/whoson/SharePresenceSettingRow.tsx', from: GATE, to: '' },
  { name: 'the beacon loses its flag check', file: BEACON, from: GATE, to: '' },
  { name: 'PresenceDot loses its flag check', file: 'components/whoson/PersonAvatar.tsx', from: GATE, to: '' },
  { name: 'PersonAvatar loses its flag check', file: 'components/whoson/PersonAvatar.tsx', from: 'if (!WHOS_ON_ENABLED || !person) return null;', to: 'if (!person) return null;' },
  { name: 'PeopleOverflowChip loses its flag check', file: 'components/whoson/PersonAvatar.tsx', from: 'if (!WHOS_ON_ENABLED || !(count > 0)) return null;', to: 'if (!(count > 0)) return null;' },
  { name: 'PersonRowExtras loses its flag check', file: 'components/whoson/PersonRowExtras.tsx', from: 'if (!WHOS_ON_ENABLED || !person) return null;', to: 'if (!person) return null;' },
  { name: 'the client sends with the flag off', file: CLIENT, from: 'if (!WHOS_ON_ENABLED || !isSupabaseConfigured || !userId || !projectId) return Promise.resolve(DROPPED);', to: 'if (!isSupabaseConfigured || !userId || !projectId) return Promise.resolve(DROPPED);' },
  { name: 'the people read is enabled with the flag off', file: PEOPLE_HOOK, from: 'const on = Boolean(WHOS_ON_ENABLED && isSupabaseConfigured', to: 'const on = Boolean(isSupabaseConfigured' },
  { name: 'the people refetch is not behind `on`', file: PEOPLE_HOOK, from: 'refetch: () => { if (on) void query.refetch(); },', to: 'refetch: () => { void query.refetch(); },' },
  { name: 'the choice read is enabled with the flag off', file: SHARE_HOOK, from: 'const on = Boolean(WHOS_ON_ENABLED && isSupabaseConfigured', to: 'const on = Boolean(isSupabaseConfigured' },
  { name: 'the choice write goes with the flag off', file: SHARE_HOOK, from: "if (!WHOS_ON_ENABLED || !isSupabaseConfigured || !userId) return 'failed';", to: "if (!isSupabaseConfigured || !userId) return 'failed';" },
  { name: 'the roster mounts the people read with the flag off', file: ROSTER, from: 'if (!WHOS_ON_ENABLED || this.state.failed) return children;', to: 'if (this.state.failed) return children;' },
  { name: '"Joined" shows with the flag off', file: ROSTER, from: "(WHOS_ON_ENABLED ? 'Joined' : 'Active')", to: "'Joined'" },
  { name: 'a second file calls the RPC', file: PROJECT, append: "\nvoid supabase.rpc('project_people', { p_project_id: 'x', p_mark: 'none' });\n" },
  { name: 'a screen writes the choice itself', file: SETTINGS, append: "\nvoid supabaseRpcOnline('set_share_presence', { p_on: true });\n" },
  { name: 'the sender is exported past the guard', file: CLIENT, from: 'async function send(userId: string, projectId: string, asked: PeopleMark)', to: 'export async function send(userId: string, projectId: string, asked: PeopleMark)' },
  { name: 'a second caller of the sender, outside callPeople', file: CLIENT, append: "\nexport function leak(u: string, p: string) { return send(u, p, 'open'); }\n" },
  { name: 'a kit component starts its own timer', file: 'components/whoson/ProjectPeopleStack.tsx', append: '\nsetInterval(() => {}, 1000);\n' },
  { name: 'the beacon body is exported past the guard', file: BEACON, from: 'function ProjectPresenceBeaconInner() {', to: 'export function ProjectPresenceBeaconInner() {' },
  { name: 'a screen imports the client directly', file: PROJECT, append: "\nimport { callPeople } from '@/utils/whoson/peopleClient';\n" },
  { name: 'a second screen takes the people hook', file: SETTINGS, append: "\nimport { useProjectPeople } from '@/hooks/useProjectPeople';\n" },
  { name: 'something else assigns the flag', file: LAYOUT, append: '\nconst WHOS_ON_ENABLED = true;\n' },
  { name: 'the server window is not the phone window', file: MIGRATION, from: "interval '150 seconds'", to: "interval '120 seconds'" },
  { name: 'the server renames a column the phone reads', file: MIGRATION, from: 'open_expires_s integer, last_seen_at timestamptz, seen_age_s integer,', to: 'open_expires_s integer, last_seen_at timestamptz, seen_age integer,' },
  { name: 'the phone stops reading a column the server sends', file: PEOPLE, from: 'invitedByViewer: r.invited_by_viewer === true,', to: 'invitedByViewer: false,' },
  { name: 'the phone sends an argument the server does not declare', file: CLIENT, from: "supabaseRpcOnline<unknown>('project_people', { p_project_id: projectId, p_mark: mark })", to: "supabaseRpcOnline<unknown>('project_people', { p_project: projectId, p_mark: mark })" },
  { name: 'the choice write names an argument the server does not declare', file: SHARE_HOOK, from: "{ p_on: value }", to: "{ p_value: value }" },
  { name: 'account deletion forgets the last-seen rows', file: DELETE_ACCOUNT, from: "  'project_presence',\n", to: '' },
  { name: 'the shard is not in EN_SHARDS', file: EN_INDEX, from: "  'office.whoson': EN_OFFICE_WHOSON,\n", to: '' },
  { name: 'the surface is not registered', file: SURFACES, from: "{ id: 'office.whoson',", to: "{ id: 'office.whoson-x'," },
  { name: 'a string is added and the shard is not regenerated', file: COPY_HOOK, append: "\nexport const extra = () => t('office.whoson.stack.brandNew', 'New');\n" },
  { name: 'ship-check drops the wire validator', file: 'package.json', from: ' && bun run test:whoson-wire', to: '' },
  { name: 'ship-check drops this validator', file: 'package.json', from: ' && bun run test:whoson-integrate', to: '' },
  { name: 'the people read is written to the device', file: PERSIST, from: "export const PERSIST_ALLOW: readonly string[] = ['stripeConnectStatus'];", to: "export const PERSIST_ALLOW: readonly string[] = ['stripeConnectStatus', 'project_people'];" },
  { name: 'the purge is not the 90 days the privacy paragraph promises', file: MIGRATION, from: "interval '90 days'", to: "interval '365 days'" },
];

const MUTATE_ARG = process.env.MUTATE || '';
if (MUTATE_ARG === 'list') {
  MUTATIONS.forEach((m, i) => console.log(`${i + 1}. ${m.name} (${m.file})`));
  process.exit(0);
}
const MUTATE = Number(MUTATE_ARG || 0);
const planted: Mutation | null = MUTATE ? MUTATIONS[MUTATE - 1] ?? null : null;
if (MUTATE && !planted) { console.error('unknown MUTATE'); process.exit(2); }

const cache = new Map<string, string>();
function read(rel: string): string {
  const hit = cache.get(rel);
  if (hit !== undefined) return hit;
  let text = readFileSync(join(ROOT, rel), 'utf8');
  if (planted && planted.file === rel) {
    if (planted.append !== undefined) text += planted.append;
    else {
      if (!text.includes(planted.from as string)) { console.error(`MUTATE=${MUTATE}: anchor not found in ${rel}`); process.exit(3); }
      text = text.replace(planted.from as string, planted.to as string);
    }
  }
  cache.set(rel, text);
  return text;
}
if (planted) { read(planted.file); console.log(`(planted mutation ${MUTATE}: ${planted.name})`); }

/** JSX comments go whole, then block comments, then whole-line `//` comments. */
const stripComments = (src: string) => src
  .replace(/\{\s*\/\*(?:(?!\*\/)[\s\S])*\*\/\s*\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const code = (rel: string) => stripComments(read(rel));
const sql = (rel: string) => read(rel).replace(/--[^\n]*/g, '');
const count = (src: string, re: RegExp) => (src.match(re) ?? []).length;

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  PASS  ' + name); return; }
  fail++;
  console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : ''));
}
function section(title: string) { console.log('\n' + title); }

/** The text between a `{` at `open` and its matching `}` (exclusive). */
function braceBody(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  return '';
}
/** The body of `function name(...) {...}` in comment-stripped source ('' when absent). */
function fnBody(src: string, name: string): string {
  const m = new RegExp(`\\bfunction ${name}\\s*\\(`).exec(src);
  if (!m) return '';
  // Walk the parameter list (it may hold destructuring braces) to its `)`.
  let i = m.index + m[0].length;
  let depth = 1;
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') depth--;
  }
  const open = src.indexOf('{', i);
  // A return type with an object literal would start with `{` too; none here,
  // and the check below (`=>`/`;` before the brace) refuses a wrong match.
  if (open < 0 || /[;=]/.test(src.slice(i, open).replace(/:\s*[^;{=]*$/, ''))) return '';
  return braceBody(src, open);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) out.push(...walk(abs));
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(abs);
  }
  return out;
}
const rel = (abs: string) => relative(ROOT, abs).split('\\').join('/');
const SOURCE_DIRS = ['app', 'components', 'hooks', 'utils', 'contexts', 'lib', 'constants', 'backend'];
const ALL_SOURCE = SOURCE_DIRS.flatMap(d => walk(join(ROOT, d))).map(rel);
const isKit = (f: string) => f.startsWith('components/whoson/') || f.startsWith('utils/whoson/')
  || f === PEOPLE_HOOK || f === SHARE_HOOK || f === COPY_HOOK;
const KIT = ALL_SOURCE.filter(isKit);
const OUTSIDE = ALL_SOURCE.filter(f => !isKit(f));

// ═════════════════════════════════════════════════════════════════════════════
section('A. The seams between the three lanes');

const mig = sql(MIGRATION);

// A1. one window, two places.
{
  const win = /v_win\s+constant interval := interval '(\d+) seconds';/.exec(mig);
  const phone = /OPEN_WINDOW_S:\s*(\d+)/.exec(code(PEOPLE));
  ok("the server's open window equals WHOSON.OPEN_WINDOW_S",
    !!win && !!phone && Number(win[1]) === Number(phone[1]) && (planted?.file === PEOPLE || Number(phone[1]) === WHOSON.OPEN_WINDOW_S),
    `migration: ${win ? win[1] : '(not found)'} s, phone: ${phone ? phone[1] : '(not found)'} s`);
  ok('the window is written once in the migration and every dot is cut by it',
    count(mig, /interval '\d+ seconds'/g) === 2 && /interval '10 seconds'/.test(mig) && count(mig, /\bv_win\b/g) >= 3);
}

// A2. the thirteen columns.
const returned = (() => {
  const m = /create or replace function public\.project_people\(([^)]*)\)\s*returns table \(([\s\S]*?)\)\s*language/.exec(mig);
  if (!m) return { args: [] as string[], cols: [] as string[] };
  return {
    args: m[1].split(',').map(a => a.trim().split(/\s+/)[0]).filter(Boolean),
    cols: m[2].split(',').map(c => c.trim().split(/\s+/)[0]).filter(Boolean),
  };
})();
{
  const body = fnBody(code(PEOPLE), 'mapPeopleRow');
  const readCols = Array.from(new Set(Array.from(body.matchAll(/\br\.([a-z_]+)\b/g)).map(m => m[1]))).sort();
  const sent = [...returned.cols].sort();
  ok('project_people returns thirteen columns', returned.cols.length === 13, `found ${returned.cols.length}: ${returned.cols.join(', ')}`);
  ok('every column the server sends is read by mapPeopleRow, and nothing else is',
    sent.length > 0 && sent.join(',') === readCols.join(','),
    `server only: [${sent.filter(c => !readCols.includes(c)).join(', ')}]  phone only: [${readCols.filter(c => !sent.includes(c)).join(', ')}]`);
}

// A3. the two calls, by name and by argument.
{
  const client = code(CLIENT);
  const calls = Array.from(client.matchAll(/'project_people',\s*\{([^}]*)\}/g)).map(m => m[1]);
  const argNames = (s: string) => Array.from(s.matchAll(/\b(p_[a-z_]+)\s*:/g)).map(m => m[1]).sort().join(',');
  ok('the client calls project_people twice, with exactly the arguments the migration declares',
    calls.length === 2 && returned.args.length === 2 && calls.every(c => argNames(c) === [...returned.args].sort().join(',')),
    `declared: ${returned.args.join(', ')}; sent: ${calls.map(argNames).join(' | ')}`);
  ok("the marks the client sends are the ones the server knows ('none', 'open', 'closed')",
    /export type PeopleMark = 'none' \| 'open' \| 'closed';/.test(client)
      && /p_mark text default 'none'/.test(mig) && /p_mark = 'open'/.test(mig) && /p_mark = 'closed'/.test(mig));
  const setFn = /create or replace function public\.set_share_presence\(([^)]*)\)/.exec(mig);
  const setArg = setFn ? setFn[1].trim().split(/\s+/)[0] : '';
  const setCall = /'set_share_presence',\s*\{\s*([a-z_]+)\s*:/.exec(code(SHARE_HOOK));
  ok('set_share_presence is called with the argument the migration declares',
    !!setArg && !!setCall && setCall[1] === setArg, `declared: ${setArg || '(none)'}; sent: ${setCall ? setCall[1] : '(none)'}`);
  ok('the choice is read from the column the migration adds (profiles.share_presence)',
    /add column if not exists share_presence\s+boolean,/.test(mig) && /\.from\('profiles'\)\s*\.select\('share_presence'\)/.test(code(SHARE_HOOK)));
  ok('both functions are taken from public and anon and granted to signed-in accounts',
    /revoke all on function public\.project_people\(text, text\)\s+from public, anon;/.test(mig)
      && /revoke all on function public\.set_share_presence\(boolean\)\s+from public, anon;/.test(mig)
      && /grant execute on function public\.project_people\(text, text\)\s+to authenticated, service_role;/.test(mig)
      && /grant execute on function public\.set_share_presence\(boolean\)\s+to authenticated, service_role;/.test(mig));
}

// A4. account deletion.
{
  const del = code(DELETE_ACCOUNT);
  const list = /const USER_SCOPED_TABLES = \[([\s\S]*?)\];/.exec(del);
  ok("delete-account lists 'project_presence' in USER_SCOPED_TABLES", !!list && /'project_presence'/.test(list[1]));
  const table = /create table if not exists public\.project_presence \(([\s\S]*?)\);/.exec(mig);
  ok('project_presence has the user_id column that list deletes by, with ON DELETE CASCADE as the second net',
    !!table && /user_id\s+uuid not null references auth\.users\(id\)\s+on delete cascade/.test(table[1]));
  ok('rows other people left on a deleted project go with the project',
    !!table && /project_id\s+uuid not null references public\.projects\(id\)\s+on delete cascade/.test(table[1]));
  ok('the purge is the 90 days the privacy paragraph states',
    count(mig, /interval '\d+ days'/g) === 1 && /interval '90 days'/.test(mig));
}

// A5. i18n.
{
  ok('i18n/surfaces.ts registers the office.whoson surface on the one copy hook',
    /\{ id: 'office\.whoson', phase: 2, state: 'pending', keyPrefixes: \['office\.whoson\.'\], files: \['hooks\/useWhosOnCopy\.ts'\], lane: 'WHOKIT' \}/.test(code(SURFACES)));
  ok('the generated shard exists', existsSync(join(ROOT, EN_SHARD)));
  const index = code(EN_INDEX);
  ok("EN_SHARDS has 'office.whoson'",
    /import \{ EN as EN_OFFICE_WHOSON \} from '\.\/office\.whoson\.generated';/.test(index) && /'office\.whoson': EN_OFFICE_WHOSON,/.test(index)
      && (planted?.file === EN_INDEX || !!EN_SHARDS['office.whoson']));
  const used = Array.from(new Set(Array.from(code(COPY_HOOK).matchAll(/\bt[n]?\(\s*'(office\.whoson\.[A-Za-z0-9_.]+)'/g)).map(m => m[1]))).sort();
  const shard = existsSync(join(ROOT, EN_SHARD))
    ? Array.from(read(EN_SHARD).matchAll(/^\s*"(office\.whoson\.[A-Za-z0-9_.]+)":/gm)).map(m => m[1]).sort() : [];
  ok('the shard holds exactly the keys the copy hook uses (31)',
    used.length === 31 && used.join(',') === shard.join(','),
    `hook: ${used.length}, shard: ${shard.length}; not in shard: [${used.filter(k => !shard.includes(k)).join(', ')}]; not in hook: [${shard.filter(k => !used.includes(k)).join(', ')}]`);
  const strays = OUTSIDE.filter(f => /'office\.whoson\./.test(code(f)));
  ok('no file but the copy hook holds a string of the feature', strays.length === 0, strays.join(', '));
}

// A6. the gate runs all four.
{
  const scripts = (JSON.parse(read('package.json')).scripts ?? {}) as Record<string, string>;
  const want: Record<string, string> = {
    'test:whoson': 'bun run scripts/validate-whoson.ts',
    'test:whoson-wire': 'bun run scripts/validate-whoson-wire.ts',
    'test:whoson-server': 'bun run scripts/validate-whoson-server.ts',
    'test:whoson-integrate': 'bun run scripts/validate-whoson-integrate.ts',
  };
  const links = (scripts['ship-check'] ?? '').split('&&').map(x => x.trim());
  for (const [name, cmd] of Object.entries(want)) {
    ok(`package.json has ${name} and ship-check runs it`, scripts[name] === cmd && links.includes(`bun run ${name}`));
  }
  ok('the two screen suites sit where test:smoke finds them',
    existsSync(join(ROOT, '__tests__/smoke/whoson-kit.test.tsx')) && existsSync(join(ROOT, '__tests__/smoke/whoson-wire.test.tsx')));
}

// A7. nothing of it reaches the device's disk.
{
  const allow = /export const PERSIST_ALLOW: readonly string\[\] = \[([^\]]*)\];/.exec(code(PERSIST));
  ok('neither read is on the query-cache persist allow-list',
    !!allow && !/project_people|whoson_choice/.test(allow[1])
      && !PERSIST_ALLOW.includes('project_people') && !PERSIST_ALLOW.includes('whoson_choice')
      && shouldPersist({ queryKey: ['project_people', 'u1', 'p1'], state: { status: 'success' } } as never, 'u1') === false
      && shouldPersist({ queryKey: ['whoson_choice', 'u1'], state: { status: 'success' } } as never, 'u1') === false);
  const stores = KIT.filter(f => /AsyncStorage|localStorage|SecureStore/.test(code(f)));
  ok('no kit file touches AsyncStorage, localStorage or SecureStore', stores.length === 0, stores.join(', '));
}

// ═════════════════════════════════════════════════════════════════════════════
section('B. Dark: WHOS_ON_ENABLED is false and every entry point checks it');

const flagsSrc = code(FLAGS);
const flagOff = /^export const WHOS_ON_ENABLED = false;$/m.test(flagsSrc);
{
  ok('WHOS_ON_ENABLED is false', flagOff && (planted?.file === FLAGS || WHOS_ON_ENABLED === false));
  ok('it is a literal, declared once', count(flagsSrc, /\bWHOS_ON_ENABLED\b/g) === 1 && !/WHOS_ON_ENABLED\s*=(?!\s*false;)/.test(flagsSrc));
  // Nothing may shadow, reassign or re-derive it: every other mention is an import or a read.
  const writers = ALL_SOURCE.filter(f => f !== FLAGS && /(?:const|let|var)\s+WHOS_ON_ENABLED\b|\bWHOS_ON_ENABLED\s*=(?!=)|WHOS_ON_ENABLED\s*:\s*(?:true|false)/.test(code(f)));
  ok('no other file declares or assigns a WHOS_ON_ENABLED of its own', writers.length === 0, writers.join(', '));
  const readers = ALL_SOURCE.filter(f => f !== FLAGS && /\bWHOS_ON_ENABLED\b/.test(code(f)));
  const badImport = readers.filter(f => !/import \{[^}]*\bWHOS_ON_ENABLED\b[^}]*\} from '@\/constants\/featureFlags';/.test(code(f)));
  ok('every file that reads it imports it from constants/featureFlags', badImport.length === 0, badImport.join(', '));
}

// B1. every component the barrel exports returns null before anything else.
const barrelNames = (() => {
  const names: { name: string; file: string }[] = [];
  for (const m of code(BARREL).matchAll(/export \{([^}]*)\} from '\.\/([A-Za-z]+)';/g)) {
    for (const part of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
      if (part.startsWith('type ')) continue;
      names.push({ name: part, file: `components/whoson/${m[2]}.tsx` });
    }
  }
  return names;
})();
const GATED_COMPONENTS = barrelNames.filter(n => n.name !== 'WhosOnBoundary');
{
  ok('the barrel exports ten components and the boundary',
    GATED_COMPONENTS.length === 10 && barrelNames.some(n => n.name === 'WhosOnBoundary'),
    barrelNames.map(n => n.name).join(', '));
  const files = walk(join(ROOT, 'components', 'whoson')).map(rel).filter(f => f !== BARREL).sort();
  const barrelFiles = Array.from(new Set(barrelNames.map(n => n.file))).sort();
  ok('every file in components/whoson is reached through the barrel (no unlisted entry point)',
    files.join(',') === barrelFiles.join(','), `on disk: ${files.join(', ')}`);
  for (const { name, file } of GATED_COMPONENTS) {
    const src = code(file);
    const body = fnBody(src, name);
    // The first `return` of the body is the flag's. Only the theme hook may
    // run before it (a hook cannot sit behind an early return).
    const firstReturn = body.indexOf('return');
    const gate = /if \(!WHOS_ON_ENABLED\b[^\n]*\) return null;/.exec(body);
    const before = gate ? body.slice(0, gate.index) : body;
    const hooksBefore = Array.from(before.matchAll(/\buse[A-Z]\w*\(/g)).map(m => m[0]);
    ok(`${name} returns null on the flag before it draws, reads or asks anything`,
      body.length > 0 && !!gate && firstReturn === gate.index + gate[0].indexOf('return')
        && hooksBefore.every(h => h === 'useThemedStyles(') && !/</.test(before.replace(/useThemedStyles\(makeStyles\)/, '')),
      gate ? `before the gate: ${before.trim().slice(0, 120)}` : 'no flag check in the body');
    // Exported once, as that function: no second export under the same name slips past.
    ok(`${name} is exported as that one function`,
      count(src, new RegExp(`export function ${name}\\(`, 'g')) === 1 && !new RegExp(`export const ${name}\\b`).test(src));
  }
  // The un-gated bodies (`…Inner`) are private and mounted once, by their gated wrapper.
  for (const file of barrelFiles) {
    const src = code(file);
    for (const m of src.matchAll(/^(export )?function ([A-Z]\w*Inner)\(/gm)) {
      const inner = m[2];
      const wrapper = inner.replace(/Inner$/, '');
      const uses = ALL_SOURCE.filter(f => new RegExp(`\\b${inner}\\b`).test(code(f)));
      ok(`${inner} is private and mounted only by ${wrapper}, after its flag check`,
        !m[1] && uses.length === 1 && uses[0] === file
          && count(src, new RegExp(`<${inner}\\b`, 'g')) === 1 && new RegExp(`<${inner}\\b`).test(fnBody(src, wrapper))
          && !new RegExp(`export \\{[^}]*\\b${inner}\\b`).test(src));
    }
  }
  ok('the boundary draws only what it is handed (it is not an entry point)',
    /return this\.state\.failed \? null : this\.props\.children;/.test(code('components/whoson/WhosOnBoundary.tsx'))
      && !/use[A-Z]\w*\(|supabase|setTimeout|setInterval/.test(code('components/whoson/WhosOnBoundary.tsx')));
}

// B2. the two RPCs and the profile column: who can name them, and behind what.
{
  const namesPeopleRpc = (src: string) => /(?:\.rpc|supabaseRpcOnline(?:<[^>]*>)?)\(\s*['"`]project_people['"`]/.test(src);
  const rpcFiles = ALL_SOURCE.filter(f => namesPeopleRpc(code(f)));
  ok('project_people is called from utils/whoson/peopleClient.ts and nowhere else',
    rpcFiles.length === 1 && rpcFiles[0] === CLIENT, rpcFiles.join(', '));
  const markFiles = ALL_SOURCE.filter(f => /\bp_mark\b/.test(code(f)));
  ok('p_mark appears in the client and nowhere else', markFiles.length === 1 && markFiles[0] === CLIENT, markFiles.join(', '));
  const setFiles = ALL_SOURCE.filter(f => /set_share_presence/.test(code(f)));
  ok('set_share_presence is called from hooks/useSharePresence.ts and nowhere else',
    setFiles.length === 1 && setFiles[0] === SHARE_HOOK, setFiles.join(', '));
  const colFiles = ALL_SOURCE.filter(f => /\bshare_presence\b/.test(code(f).replace(/set_share_presence/g, '')));
  ok('profiles.share_presence is read from hooks/useSharePresence.ts and nowhere else',
    colFiles.length === 1 && colFiles[0] === SHARE_HOOK, colFiles.join(', '));
  const tableFiles = ALL_SOURCE.filter(f => /\bproject_presence\b/.test(code(f)));
  ok('no client file names the project_presence table', tableFiles.length === 0, tableFiles.join(', '));

  // The client: both wire calls sit in private functions that only `send`
  // calls, `send` is private and only `callPeople` calls it, and the first
  // statement of `callPeople` is the flag.
  const client = code(CLIENT);
  const exported = Array.from(client.matchAll(/^export (?:async )?function (\w+)\(/gm)).map(m => m[1]);
  const wire = /supabase\.rpc\(|supabaseRpcOnline(?:<[^>]*>)?\(|\.from\(|\bfetch\(/;
  ok('the two wire calls are in sendRead and sendMark',
    count(client, /supabase\.rpc\(/g) === 1 && count(client, /supabaseRpcOnline(?:<[^>]*>)?\(/g) === 1 && !/\.from\(|\bfetch\(/.test(client)
      && /supabase\.rpc\('project_people'/.test(fnBody(client, 'sendRead')) && /supabaseRpcOnline<unknown>\('project_people'/.test(fnBody(client, 'sendMark')));
  ok('sendRead, sendMark and send are private',
    !exported.some(n => ['sendRead', 'sendMark', 'send'].includes(n)) && !/export \{[^}]*\b(?:sendRead|sendMark|send)\b/.test(client)
      && !/export (?:const|let|default)[^\n]*\b(?:sendRead|sendMark|send)\b/.test(client));
  const sendBody = fnBody(client, 'send');
  ok('only send calls sendRead and sendMark',
    count(client, /\bsendRead\(/g) === 2 && count(client, /\bsendMark\(/g) === 2 && /\bsendRead\(/.test(sendBody) && /\bsendMark\(/.test(sendBody));
  const callBody = fnBody(client, 'callPeople');
  ok('only callPeople calls send',
    count(client, /(?<![.\w])send\(/g) === 3 && count(callBody, /(?<![.\w])send\(/g) === 2);
  ok('the first statement of callPeople is the flag: nothing is sent while it is off',
    /^\s*if \(!WHOS_ON_ENABLED \|\|[^\n]*\) return Promise\.resolve\(DROPPED\);/.test(callBody));
  const leaky = exported.filter(n => n !== 'callPeople' && (wire.test(fnBody(client, n)) || /(?<![.\w])(?:send|sendRead|sendMark)\(/.test(fnBody(client, n))));
  ok('no other export of the client can reach the wire', leaky.length === 0, leaky.join(', '));

  // The two hooks.
  const people = code(PEOPLE_HOOK);
  ok('useProjectPeople is disabled while the flag is off, and so is its refetch',
    /const on = Boolean\(WHOS_ON_ENABLED && /.test(people) && count(people, /\buseQuery\(/g) === 1 && /enabled: on,/.test(people)
      && /refetch: \(\) => \{ if \(on\) void query\.refetch\(\); \},/.test(people) && count(people, /\.refetch\(/g) === 1
      && !/refetchInterval|fetchQuery|prefetchQuery|ensureQueryData/.test(people) && !wire.test(people));
  const share = code(SHARE_HOOK);
  const setBody = braceBody(share, share.indexOf('{', share.indexOf('const setChoice = useCallback(async')));
  ok('useSharePresence reads nothing while the flag is off',
    /const on = Boolean\(WHOS_ON_ENABLED && /.test(share) && count(share, /\buseQuery\(/g) === 1 && /enabled: on,/.test(share)
      && count(share, /\.from\(/g) === 1 && !/\.refetch\(|refetchInterval|fetchQuery|prefetchQuery|ensureQueryData/.test(share));
  ok('useSharePresence writes nothing while the flag is off (the flag is checked before the door is reached)',
    count(share, /supabaseRpcOnline(?:<[^>]*>)?\(/g) === 1 && /^\s*if \(!WHOS_ON_ENABLED \|\|[^\n]*\) return 'failed';/.test(setBody)
      && /supabaseRpcOnline<boolean>\('set_share_presence'/.test(setBody));
}

// B3. timers and listeners: every one is counted, and every one is behind the flag.
{
  const inventory = (src: string) => ({
    timeout: count(src, /\bsetTimeout\(/g),
    interval: count(src, /\bsetInterval\(/g),
    listener: count(src, /\.addEventListener\(/g),
    raf: count(src, /requestAnimationFrame\(|InteractionManager|setImmediate\(/g),
  });
  const EXPECT: Record<string, { timeout: number; interval: number; listener: number }> = {
    [BEACON]: { timeout: 2, interval: 0, listener: 2 },
    [CLIENT]: { timeout: 1, interval: 0, listener: 0 },
    [PEOPLE_HOOK]: { timeout: 0, interval: 1, listener: 0 },
    [SHARE_HOOK]: { timeout: 1, interval: 0, listener: 0 },
  };
  const wrong: string[] = [];
  for (const f of KIT) {
    const got = inventory(code(f));
    const want = EXPECT[f] ?? { timeout: 0, interval: 0, listener: 0 };
    if (got.timeout !== want.timeout || got.interval !== want.interval || got.listener !== want.listener || got.raf !== 0) {
      wrong.push(`${f}: ${JSON.stringify(got)}`);
    }
  }
  ok('the kit starts five timers and two listeners in four files, and no other', wrong.length === 0, wrong.join('; '));

  const beacon = code(BEACON);
  const engine = fnBody(beacon, 'createEngine');
  const inner = fnBody(beacon, 'ProjectPresenceBeaconInner');
  ok("the beacon's timer lives in createEngine and its listeners in the inner component",
    count(engine, /\bsetTimeout\(/g) === 2 && count(inner, /\.addEventListener\(/g) === 2 && count(inner, /\bsetTimeout\(|\bsetInterval\(/g) === 0);
  ok('createEngine is private and built only by the inner component',
    !/export (?:async )?function createEngine|export \{[^}]*\bcreateEngine\b/.test(beacon)
      && count(beacon, /\bcreateEngine\(/g) === 2 && /\bcreateEngine\(queryClient\)/.test(inner));
  ok('the first statement of ProjectPresenceBeacon is the flag: no listener, no timer, no router hook',
    /^\s*if \(!WHOS_ON_ENABLED\) return null;/.test(fnBody(beacon, 'ProjectPresenceBeacon'))
      && !/use[A-Z]\w*\(/.test(fnBody(beacon, 'ProjectPresenceBeacon')));
  ok('nothing in the beacon runs at import (no module-scope call to the engine, a timer or a listener)',
    (() => {
      // Remove every function body; what is left is module scope.
      let top = beacon;
      for (const name of ['createEngine', 'ProjectPresenceBeaconInner', 'ProjectPresenceBeacon', 'logOnce', 'isWeb']) {
        const body = fnBody(top, name);
        if (body) top = top.replace(body, '');
      }
      return !/(?<!function )createEngine\(|setTimeout\(|setInterval\(|addEventListener\(|callPeople\(/.test(top);
    })());
  const people = code(PEOPLE_HOOK);
  ok("the people hook's clock tick runs only while `on`",
    /const ticking = on && needsClock\(/.test(people) && /if \(!ticking\) return;\s*const id = setInterval\(bump, WHOSON\.RERENDER_MS\);/.test(people));
  ok("the client's timer is inside sendRead and the choice hook's inside its disabled query",
    /\bsetTimeout\(/.test(fnBody(code(CLIENT), 'sendRead'))
      && (() => { const s = code(SHARE_HOOK); const q = s.indexOf('queryFn:'); const t = s.indexOf('setTimeout('); const end = s.indexOf('const setChoice'); return q > 0 && t > q && t < end; })());
}

// B4. the wiring: who outside the kit takes anything from it, and what.
{
  const importRe = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"](@\/components\/whoson(?:\/[\w./-]+)?|@\/hooks\/use(?:ProjectPeople|SharePresence|WhosOnCopy)|@\/utils\/whoson\/[\w./-]+)['"];/g;
  const taken: Record<string, string[]> = {};
  const loose: string[] = [];
  for (const f of OUTSIDE) {
    const src = code(f);
    for (const m of src.matchAll(importRe)) {
      const names = m[1].split(',').map(s => s.trim().replace(/^type\s+/, '')).filter(Boolean);
      (taken[f] ??= []).push(...names.map(n => `${n}<${m[2]}`));
    }
    // Any other way in (default import, namespace, require, relative path, dynamic import).
    const any = count(src, /['"](?:@\/components\/whoson|@\/hooks\/use(?:ProjectPeople|SharePresence|WhosOnCopy)|@\/utils\/whoson|(?:\.\.?\/)+(?:[\w-]+\/)*whoson)[\w./-]*['"]/g);
    const named = count(src, importRe);
    if (any !== named) loose.push(f);
  }
  ok('nothing outside the kit reaches into it except through a named import', loose.length === 0, loose.join(', '));
  const WANT: Record<string, string[]> = {
    [LAYOUT]: ['ProjectPresenceBeacon<@/components/whoson'],
    [PROJECT]: ['ProjectPeopleBlock<@/components/whoson', 'ProjectPeopleStack<@/components/whoson'],
    [SETTINGS]: ['SharePresenceSettingRow<@/components/whoson'],
    [ROSTER]: ['useProjectPeople<@/hooks/useProjectPeople', 'PersonAvatar<@/components/whoson', 'PersonRowExtras<@/components/whoson', 'WhosOnBoundary<@/components/whoson'],
  };
  const show = (o: Record<string, string[]>) => Object.keys(o).sort().map(k => `${k}: ${[...o[k]].sort().join(' ')}`).join('\n        ');
  ok('four files take from the kit, and only gated components, the boundary and the people hook', show(taken) === show(WANT), show(taken));

  // What each of the four does with it.
  const layout = code(LAYOUT);
  ok('the root layout mounts the beacon once and nothing else of the feature',
    count(layout, /<ProjectPresenceBeacon \/>/g) === 1 && count(layout, /\bProjectPresenceBeacon\b/g) === 2
      && !/project_people|whoson_choice|WHOS_ON_ENABLED/.test(layout));
  const project = code(PROJECT);
  ok('the project page mounts the stack twice (hero, header slot) and the block once, and nothing else of the feature',
    count(project, /<ProjectPeopleStack\b/g) === 2 && count(project, /<ProjectPeopleBlock\b/g) === 1
      && count(project, /\bProjectPeopleStack\b/g) === 3 && count(project, /\bProjectPeopleBlock\b/g) === 2
      && count(project, /project_people/g) === 1 && /invalidateQueries\(\{ queryKey: \['project_people'\] \}\)/.test(project));
  const settings = code(SETTINGS);
  ok('Settings mounts the one row and nothing else of the feature',
    count(settings, /<SharePresenceSettingRow \/>/g) === 1 && count(settings, /\bSharePresenceSettingRow\b/g) === 2
      && !/project_people|whoson_choice|share_presence/.test(settings));
  const roster = code(ROSTER);
  const scope = roster.slice(roster.indexOf('class RosterPeopleScope'), roster.indexOf('function RosterRowAvatar'));
  ok('the roster calls the people hook once, in a component only the flag-checked scope mounts',
    count(roster, /\buseProjectPeople\(/g) === 1 && /\buseProjectPeople\(projectId\)/.test(fnBody(roster, 'RosterPeopleRead'))
      && count(roster, /<RosterPeopleRead\b/g) === 1
      && /if \(!WHOS_ON_ENABLED \|\| this\.state\.failed\) return children;\s*return <RosterPeopleRead \{\.\.\.read\}>\{children\}<\/RosterPeopleRead>;/.test(scope)
      && !/export (?:default )?(?:function|class|const) RosterPeopleRead|export \{[^}]*\bRosterPeopleRead\b/.test(roster));
  ok('the roster says "Joined" only with the flag on',
    count(roster, /'Joined'/g) === 1 && /\(WHOS_ON_ENABLED \? 'Joined' : 'Active'\)/.test(roster));
  // The only other mentions outside the kit are cache invalidations, which
  // fetch nothing for a query nobody has enabled.
  const keyFiles = OUTSIDE.filter(f => /project_people|whoson_choice/.test(code(f))).sort();
  ok("the query key is named outside the kit only to invalidate it (project page, roster hook)",
    keyFiles.join(',') === [PROJECT, 'hooks/useProjectCollaborators.ts'].sort().join(',')
      && keyFiles.every(f => count(code(f), /project_people|whoson_choice/g) === count(code(f), /invalidateQueries\(\{ queryKey: \['project_people'\] \}\)/g)),
    keyFiles.join(', '));
}

// B5. the two screen suites prove the same thing on a rendered tree.
{
  const kit = read('__tests__/smoke/whoson-kit.test.tsx');
  const wire = read('__tests__/smoke/whoson-wire.test.tsx');
  ok('the kit suite still has a group that runs with the real flag',
    /the real flag is false/.test(kit));
  ok('the wire suite still renders the project page, Settings and the roster with the flag off',
    /flag off/i.test(wire) && /toMatchSnapshot\(/.test(wire));
}

// ═════════════════════════════════════════════════════════════════════════════
section('C. Go-live: what must be in the repo before the flag is true');
{
  const privacy = existsSync(join(ROOT, PRIVACY)) ? read(PRIVACY) : '';
  const meta = existsSync(join(ROOT, METADATA)) ? read(METADATA) : '';
  const usageRow = /^\| Usage Data → Product Interaction \|[^\n]*$/m.exec(meta);
  const owed: [string, boolean][] = [
    ['marketing/privacy.html has the "Team activity" paragraph', /Team activity/.test(privacy)],
    ['that paragraph states the 90 days and the Settings switch', /Team activity[\s\S]{0,900}turn it off in Settings[\s\S]{0,400}90 days/.test(privacy)],
    ['docs/app-store-metadata.md names App Functionality on the Usage Data row', !!usageRow && /App Functionality/i.test(usageRow[0])],
  ];
  for (const [name, held] of owed) {
    if (flagOff) console.log(`  ${held ? 'HELD' : 'OWED'}  ${name}${held ? '' : ' (not counted while the flag is off)'}`);
    else ok(`the flag is on, so: ${name}`, held);
  }
  ok('the flag comment names what must hold before it is turned on',
    /Flip it to true only when ALL of these hold/.test(read(FLAGS)) && /two-account test/.test(read(FLAGS)) && /20261004120000_project_people\.sql/.test(read(FLAGS)));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('\n✗ validate-whoson-integrate: the lanes do not meet, or the feature is not dark.\n');
  process.exit(1);
}
console.log('\n✓ validate-whoson-integrate: the lanes meet and "who is on this project" is dark.\n');
