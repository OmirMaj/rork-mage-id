// validate-account-deletion-handover.ts — a departing collaborator's field work
// on SOMEONE ELSE'S job stays with that job.
//
// WHY THIS EXISTS (audit round 2 #26, 2026-09-17). Rows a foreman logs on the
// GC's project carry the FOREMAN'S uid: every field-table INSERT policy is
// `auth.uid() = user_id AND can_access_project(project_id, 'field')`
// (20260826130000_field_role.sql). supabase/functions/delete-account then ran
// `delete().eq('user_id', caller)` over its table list with no look at who
// owned the project, and step 4's auth delete cascaded the rest
// (daily_reports / field_tickets / time_entries are ON DELETE CASCADE to
// auth.users). One foreman closing his account wiped the GC's daily reports,
// photos and signed T&M tickets — the evidence for a delay claim or a
// backcharge — on a job he did not own.
//
// The function now hands those rows to the project owner (step 2-0) before
// anything is deleted. What this guard pins, so it cannot quietly regress:
//   1. every table a collaborator can WRITE (a `<table>_collab_insert` policy
//      in supabase/schema.sql, and every name in field_role.sql's
//      field_tables array) is in COLLABORATOR_FIELD_TABLES — a table added
//      later without a handover path would bring the bug back for that table;
//   2. the handover UPDATE runs before the first row delete and before
//      auth.admin.deleteUser (the cascade is the half a "skip the delete" fix
//      would miss);
//   3. a failed handover returns BEFORE any delete (otherwise the rows that
//      failed to move fall straight into step 2c);
//   4. the rows are moved to the PROJECT OWNER read from projects.user_id,
//      the candidate projects come from the caller's project_collaborators
//      rows (an invite proves the owner let him in), and the caller's own
//      projects are never handed to himself;
//   5. the photo objects of handed-over projects are skipped by the storage
//      sweep.
//   6. what the USER READS about deleting says the same thing (#26, round 3):
//      the settings confirm, the Android final confirm, the success alert,
//      marketing/privacy.html and marketing/do-not-sell.html each carry the
//      "stays with those jobs" sentence, that sentence names every kind of row
//      COLLABORATOR_FIELD_TABLES hands over, and the old absolute promises
//      ("every project, and all uploaded files", "all data have been removed",
//      "all associated project data") are gone. It runs both ways: the copy may
//      only claim the handover while the function still performs it.
//
// Run via: bun run scripts/validate-account-deletion-handover.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fn = readFileSync(join(ROOT, 'supabase', 'functions', 'delete-account', 'index.ts'), 'utf8');
// Comments stripped, so prose that NAMES a call can never satisfy a check.
const code = fn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/[^\n'"`]*$/gm, '');
const schema = readFileSync(join(ROOT, 'supabase', 'schema.sql'), 'utf8');
const fieldRole = readFileSync(join(ROOT, 'supabase', 'migrations', '20260826130000_field_role.sql'), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, why ? `\n      ${why}` : ''); }
}

console.log('\naccount deletion hands collaborator field work to the project owner (#26):');

// ── 1. coverage ─────────────────────────────────────────────────────────────
const listBlock = code.match(/COLLABORATOR_FIELD_TABLES\s*=\s*\[([\s\S]*?)\];/);
const handoverTables = new Set(listBlock ? [...listBlock[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]) : []);
ok('COLLABORATOR_FIELD_TABLES was parsed out of delete-account', handoverTables.size >= 12,
  `parsed ${handoverTables.size} — the list is missing or changed shape`);

const migBlock = fieldRole.match(/field_tables\s+text\[\]\s*:=\s*array\[([\s\S]*?)\];/);
const migTables = migBlock ? [...migBlock[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]) : [];
ok("field_role.sql's field_tables array was parsed", migTables.length >= 12);
const missingMig = migTables.filter(t => !handoverTables.has(t));
ok('every field_tables entry has a handover path', missingMig.length === 0,
  `not handed over (a collaborator's rows here die with his account): ${missingMig.join(', ')}`);

const collabInsert = [...new Set([...schema.matchAll(/CREATE POLICY (\w+)_collab_insert ON public\.(\w+)/g)].map(m => m[2]))];
ok('collaborator INSERT policies were found in schema.sql', collabInsert.length >= 12);
const missingSchema = collabInsert.filter(t => !handoverTables.has(t));
ok('every table a collaborator can write (a _collab_insert policy) has a handover path',
  missingSchema.length === 0, `missing: ${missingSchema.join(', ')}`);

// Each handover table must actually carry the two columns the UPDATE filters on.
const cols = (t: string) => {
  const m = schema.match(new RegExp(`^CREATE TABLE public\\.${t} \\(\\n([\\s\\S]*?)\\n\\);`, 'm'));
  return m ? m[1] : '';
};
const noCols = [...handoverTables].filter(t => !/^\s+user_id\s/m.test(cols(t)) || !/^\s+project_id\s/m.test(cols(t)));
ok('every handover table has user_id AND project_id (the update would 42703 otherwise)', noCols.length === 0,
  `missing a column: ${noCols.join(', ')}`);

// ── 2. ordering ─────────────────────────────────────────────────────────────
const updAt = code.search(/\.update\(\{\s*user_id:\s*ownerId\s*\}\)/);
const firstDeleteAt = code.search(/\.delete\(\)/);
const authAt = code.indexOf('auth.admin.deleteUser');
ok('the handover sets user_id to the owner', updAt !== -1);
ok('the handover runs before the FIRST row delete', updAt !== -1 && firstDeleteAt !== -1 && updAt < firstDeleteAt,
  `update at ${updAt}, first .delete() at ${firstDeleteAt}`);
ok('the handover runs before auth.admin.deleteUser (the auth.users cascade)', updAt !== -1 && updAt < authAt);

const handoverBody = updAt === -1 ? '' : code.slice(code.lastIndexOf('for (const { projectId, ownerId } of handedOver)', updAt), firstDeleteAt);
ok("the update is scoped to the caller's rows on THAT project",
  /\.eq\('user_id', userId\)\s*\.eq\('project_id', projectId\)/.test(handoverBody),
  'without both filters the service role would re-own other people\'s rows');
ok('the loop runs every COLLABORATOR_FIELD_TABLES entry', /for \(const table of COLLABORATOR_FIELD_TABLES\)/.test(handoverBody));

// ── 3. a failed handover stops before anything is deleted ───────────────────
const abortAt = code.search(/if \(handoverErrors\.length > 0\)\s*\{[\s\S]*?return json\(/);
ok('a failed handover returns before the first delete', abortAt !== -1 && abortAt < firstDeleteAt,
  'carrying on would delete the rows that failed to move in step 2c');

// ── 4. who the rows go to, and from which projects ─────────────────────────
const collect = code.slice(code.indexOf('const collectTenantKeys'), code.indexOf('let collected'));
ok("candidate projects come from the caller's project_collaborators rows",
  /selectAllByUser\('project_collaborators', 'project_id'\)/.test(collect));
ok("the caller's own projects are excluded", /filter\(id => !ownProjects\.has\(id\)\)/.test(collect));
ok('the new owner is projects.user_id, and never the caller himself',
  /from\('projects'\)\.select\('id, user_id'\)/.test(collect) && /ownerId !== userId/.test(collect));
ok('the collaborator rows are read in step 1, before step 2e clears them',
  code.indexOf("selectAllByUser('project_collaborators'") < code.indexOf(".from('project_collaborators').delete()"));

// ── 5. the photo bytes stay with the job ────────────────────────────────────
ok('the project-photos sweep skips <uid>/<handed-over project>/',
  /keptPhotoPrefixes\s*=\s*handedOver\.map\(h => `\$\{userId\}\/\$\{h\.projectId\}\/`\)/.test(code)
  && /bucket === 'project-photos'[\s\S]{0,120}paths\.filter\(p => !keptPhotoPrefixes\.some/.test(code));

// ── 6. the copy says what the function does ────────────────────────────────
console.log('\nthe deletion copy matches what delete-account keeps:');
const settingsSrc = readFileSync(join(ROOT, 'app', '(tabs)', 'settings', 'index.tsx'), 'utf8');
const privacy = readFileSync(join(ROOT, 'marketing', 'privacy.html'), 'utf8');
const doNotSell = readFileSync(join(ROOT, 'marketing', 'do-not-sell.html'), 'utf8');

// Each handed-over table, and the words the reader must see for it. Pins and
// calibrations are marks ON a plan sheet, so "markups" covers them. A table
// added to COLLABORATOR_FIELD_TABLES without an entry here fails below: the
// copy has to learn about it before the function ships.
const TABLE_WORDS: Record<string, RegExp> = {
  daily_reports: /daily reports/i,
  photos: /photos/i,
  punch_items: /punch items/i,
  rfis: /RFIs/,
  submittals: /submittals/i,
  permits: /permits/i,
  plan_sheets: /plan sheets/i,
  drawing_pins: /markups/i,
  plan_markups: /markups/i,
  plan_calibrations: /markups/i,
  time_entries: /time entries/i,
  field_tickets: /T&(?:amp;)?M tickets/,
  deliveries: /deliver/i,
  building_access_rules: /site-access/i,
  access_reservations: /site-access/i,
};
const unmapped = [...handoverTables].filter(t => !TABLE_WORDS[t]);
ok('every handed-over table has reader-facing words', unmapped.length === 0,
  `no copy for: ${unmapped.join(', ')} — add it to ACCOUNT_DELETE_HANDOVER_NOTE, both marketing pages and TABLE_WORDS`);

const noteMatch = settingsSrc.match(/const ACCOUNT_DELETE_HANDOVER_NOTE\s*=\s*'((?:[^'\\]|\\.)*)'/);
const note = noteMatch ? noteMatch[1].replace(/\\u2019/g, '\u2019') : '';
const pageNote = (html: string) => (html.match(/<p>[^<]*stay with those jobs[^<]*<\/p>/) ?? [''])[0];
const copies: Array<[string, string]> = [
  ['settings ACCOUNT_DELETE_HANDOVER_NOTE', note],
  ['marketing/privacy.html', pageNote(privacy)],
  ['marketing/do-not-sell.html', pageNote(doNotSell)],
];
const handoverPerformed = /\.update\(\{ user_id: ownerId \}\)/.test(code) && handoverTables.size > 0;
for (const [where, text] of copies) {
  ok(`${where} carries the "stay with those jobs" sentence`, /stay with those jobs/.test(text),
    'the reader is told everything is erased while the function keeps his field work on other owners\' jobs');
  const missing = [...handoverTables].filter(t => TABLE_WORDS[t] && !TABLE_WORDS[t].test(text));
  ok(`${where} names every kind of row that is kept`, text !== '' && missing.length === 0,
    `not mentioned: ${missing.join(', ')}`);
  ok(`${where} only claims a handover the function performs`, !text || handoverPerformed,
    'the copy says the rows stay, but delete-account no longer moves them to the owner');
}

// The three alerts the deleting user reads must each interpolate the note.
const confirmBody = settingsSrc.slice(settingsSrc.indexOf('const handleDeleteAccount'), settingsSrc.indexOf('const runDeleteAccount'));
const successBody = settingsSrc.slice(settingsSrc.indexOf('const runDeleteAccount'), settingsSrc.indexOf('const handleToggleUnits'));
const interp = (s: string) => (s.match(/\$\{ACCOUNT_DELETE_HANDOVER_NOTE\}/g) ?? []).length;
ok('the first confirm AND the Android final confirm show the note', interp(confirmBody) >= 2,
  `found ${interp(confirmBody)} of 2 in handleDeleteAccount`);
ok('the success alert shows the note', interp(successBody) >= 1);

// The absolute promises this round removed.
const settingsCode = settingsSrc.replace(/^\s*\/\/.*$/gm, '');
const FALSE_PROMISES: Array<[string, RegExp]> = [
  ['"every project, and all uploaded files"', /every project, and all uploaded files/i],
  ['"deletes everything"', /This deletes everything/i],
  ['"all data have been removed"', /all data ha(?:ve|s) been removed/i],
  ['"projects, and all data"', /projects, and all data/i],
];
for (const [label, re] of FALSE_PROMISES) ok(`settings no longer promises ${label}`, !re.test(settingsCode));
ok('privacy.html no longer promises "all associated project data is permanently removed"',
  !/all associated project data is permanently removed/i.test(privacy));
ok('do-not-sell.html no longer promises "account and project data" are all removed',
  !/removes your account and project data/i.test(doNotSell));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
