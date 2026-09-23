// validate-w5-join-core-refusals.ts — wave 5, lane w5-join-core.
//
// The two `projects` refusals the server now answers with a VERDICT, and the
// one it must never be confused with:
//
//   #1 / CONTRACT 21  enforce_free_tier_project_cap refuses a NEW job past the
//        free plan's one with SQLSTATE 23514 and a message starting 'Free
//        tier is limited to 1 project'. The message has no "violates", so the
//        flush's isTerminalError missed it: the refused job burned all five
//        retries and was then dropped as "the server refused it after several
//        tries" — and the direct path's ledger line read "a value was not
//        accepted". Now: terminal on the first answer, under 'Free plan allows
//        1 project — upgrade, or delete a job first', with its row (Retry).
//   #61 / CONTRACT 22  projects_keep_safety_records refuses a DELETE of a job
//        with OSHA incidents: 23001 'project_has_safety_records'. Terminal, a
//        NOTE (no Retry — the same delete is refused again, and a delete line
//        would keep the job hidden), and the job is put back on the phone.
//   NEVER 23503: isParentMissingRefusal reads it as "the child's job is not on
//        the server yet" and queues the child behind the job (#4). A 23503 on
//        a child row must stay exactly that.
//
// Behavioural where there is a seam (the pure classifier and reasons in
// utils/syncLedger); source pins only for the flush / direct-write branches,
// whose executed behaviour is covered by __tests__/sync/offline-queue.test.ts
// ('wave 5 — known refusals').
//
// Run via: bun run scripts/validate-w5-join-core-refusals.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  knownRefusalOf, knownRefusalOfError, humanWriteReason, humanDropReason, knownRefusalToast, isKnownRefusalReason,
  FREE_PLAN_PROJECT_CAP_REASON, SAFETY_RECORDS_DELETE_REASON, KNOWN_REFUSAL_REASON, labelForTable,
} from '../utils/syncLedger';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let passes = 0;
let failures = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { passes++; console.log('  ✓', label); }
  else { failures++; console.error('  ✗', label, detail ? `\n      ${detail}` : ''); }
}

const CAP_MSG = 'Free tier is limited to 1 project. Upgrade to Pro for unlimited projects.';
const SAFETY_MSG = 'project_has_safety_records';

console.log('\nCONTRACT 21 — the free-plan cap refusal');
ok('a projects INSERT refused 23514 + the cap text is the cap refusal', knownRefusalOf('projects', 'insert', CAP_MSG, '23514') === 'free_plan_project_cap');
ok('…and so is the owner UPSERT (the insert half of INSERT … ON CONFLICT raises)', knownRefusalOf('projects', 'upsert', CAP_MSG, '23514') === 'free_plan_project_cap');
ok('an UPDATE is never it (a rename is pinned silently, 20260923040000)', knownRefusalOf('projects', 'update', CAP_MSG, '23514') === null);
ok('the text alone (no SQLSTATE) is not enough', knownRefusalOf('projects', 'insert', CAP_MSG, undefined) === null);
ok('a generic 23514 check violation is not the cap', knownRefusalOf('projects', 'insert', 'new row for relation "projects" violates check constraint "projects_status_check"', '23514') === null);
ok('the cap text on another table borrows nothing', knownRefusalOf('invoices', 'insert', CAP_MSG, '23514') === null);
ok('humanWriteReason names the cap (it used to say "a value was not accepted")', humanWriteReason(CAP_MSG, '23514') === FREE_PLAN_PROJECT_CAP_REASON);
ok('the reason is the contract sentence', FREE_PLAN_PROJECT_CAP_REASON === 'Free plan allows 1 project — upgrade, or delete a job first');
ok('a generic 23514 still reads "a value was not accepted"', humanWriteReason('violates check constraint "x"', '23514') === 'a value was not accepted');

console.log('\nCONTRACT 22 — the safety-records delete refusal');
ok('a projects DELETE refused 23001 project_has_safety_records is the safety refusal', knownRefusalOf('projects', 'delete', SAFETY_MSG, '23001') === 'project_has_safety_records');
ok('the same answer to an insert is not it', knownRefusalOf('projects', 'insert', SAFETY_MSG, '23001') === null);
ok('23001 with another message is not it', knownRefusalOf('projects', 'delete', 'update or delete on table "x" violates …', '23001') === null);
ok('humanWriteReason names it', humanWriteReason(SAFETY_MSG, '23001') === SAFETY_RECORDS_DELETE_REASON);
ok('the reason is the contract sentence', SAFETY_RECORDS_DELETE_REASON === 'This job has safety records — it was not deleted');

console.log('\nNEVER 23503 — a child whose job is not on the server yet stays parent-missing');
ok('a 23503 on a child row is no known refusal', knownRefusalOfError('insert or update on table "daily_reports" violates foreign key constraint "daily_reports_project_id_fkey"', '23503') === null);
ok('…even with the safety text on it', knownRefusalOf('projects', 'delete', SAFETY_MSG, '23503') === null);
ok('…and it still reads as the parent missing', humanWriteReason('violates foreign key constraint', '23503') === 'the job or record it belongs to is not on the server');

console.log('\nthe sheet and the toast');
ok('a known reason passes through humanDropReason as his words', humanDropReason(FREE_PLAN_PROJECT_CAP_REASON) === FREE_PLAN_PROJECT_CAP_REASON && humanDropReason(SAFETY_RECORDS_DELETE_REASON) === SAFETY_RECORDS_DELETE_REASON);
ok('isKnownRefusalReason knows exactly the two', isKnownRefusalReason(FREE_PLAN_PROJECT_CAP_REASON) && isKnownRefusalReason(SAFETY_RECORDS_DELETE_REASON) && !isKnownRefusalReason('the server refused it'));
ok('the cap toast says what to do (Retry after upgrading or deleting a job)', /Retry once you have upgraded or deleted a job/.test(knownRefusalToast(FREE_PLAN_PROJECT_CAP_REASON) ?? ''));
ok('the safety toast offers Mark Closed', /mark the job Closed instead/.test(knownRefusalToast(SAFETY_RECORDS_DELETE_REASON) ?? ''));
ok('no toast for any other reason', knownRefusalToast('terminal error or retry exhaustion') === null);
ok('both sentences are listed once each', Object.values(KNOWN_REFUSAL_REASON).length === 2);
ok('a public_profiles line reads "Project page" (portfolio)', labelForTable('public_profiles') === 'Project page');

console.log('\nthe queue — flush and live path (source; executed in __tests__/sync/offline-queue.test.ts)');
{
  const q = read('utils/offlineQueue.ts');
  const flushBranch = q.indexOf('const known = knownRefusal(mutation.table, mutation.operation, msg, code);');
  const terminalBranch = q.indexOf("if (isTerminalError(msg) || code === '42501') {");
  ok('the flush classifies a known refusal BEFORE the text-based terminal branch (and its bearer check)', flushBranch > 0 && terminalBranch > flushBranch);
  const branch = q.slice(flushBranch, terminalBranch);
  ok('…drops the record\'s writes under the sentence, on the first answer (no retryCount++)',
    /for \(const m of lost\) gReasons\.set\(m\.id, reason\);/.test(branch) && !/retryCount\+\+/.test(branch) && /break;/.test(branch));
  ok('…records the safety refusal as NOTES and announces the job for restoring',
    /known === 'project_has_safety_records'/.test(branch) && /gNotes\.add\(m\.id\)/.test(branch) && /refusedDeletes\.push\(/.test(branch));
  ok('…and a refused create dooms its queued children (recorded with their rows)', /else if \(mutation\.table === 'projects'\) \{\s*gDoomsChildren = true;/.test(branch));
  ok('the per-reason lines are written in the group\'s slot (recordGroupDrops) — notes as notes',
    /await recordDropsInLedger\(entries\.filter\(\(m\) => !notes\.has\(m\.id\)\), reason\);/.test(q)
      && /await recordDropsInLedger\(entries\.filter\(\(m\) => notes\.has\(m\.id\)\), reason, true\);/.test(q));
  ok('the job is announced only after the flush has written everything back',
    q.indexOf('for (const r of refusedDeletes) notifyProjectDeleteRefused(r.id, r.reason);') > q.indexOf('notifyFlushed(processedTables);'));
  const fail = q.slice(q.indexOf('async function failDirectWrite('), q.indexOf('/** The toast for a write parked behind'));
  ok('the live path writes the safety refusal as a note (no table / row) and puts the job back',
    /const asNote = known === 'project_has_safety_records';/.test(fail)
      && /\? \{ id: lineId, kind: 'write', label, reason: why, at: now, \.\.\.\(writerId \? \{ userId: writerId \} : \{\}\) \}/.test(fail)
      && /if \(asNote && !foreignSession\) notifyProjectDeleteRefused\(m\.data\?\.id, why\);/.test(fail));
  const parent = q.slice(q.indexOf('function isParentMissingRefusal('), q.indexOf('function isParentMissingRefusal(') + 400);
  ok('isParentMissingRefusal still keys on 23503 (unchanged)', /code === '23503'/.test(parent));
  ok('onProjectDeleteRefused is exported for ProjectContext', /export function onProjectDeleteRefused\(/.test(q));
}

console.log('\nProjectContext puts a refused job back');
{
  const pc = read('contexts/ProjectContext.tsx');
  const listen = pc.slice(pc.indexOf('useEffect(() => onProjectDeleteRefused('), pc.indexOf('useEffect(() => onProjectDeleteRefused(') + 1400);
  ok('it listens, and re-reads everything (the foreground pass + the lists it does not cover + plans)',
    listen.length > 100 && /refetchAllOnForeground\(\)/.test(listen) && /'commitments', 'fieldTickets'/.test(listen) && /refetchPlansRef\.current\(\)/.test(listen));
}

console.log('\n…and SafetyContext puts back the OSHA lists it pruned on the local delete');
{
  // Fix round 1: forgetProjectsLocally fired projectDeletion and SafetyContext
  // pruned the job's incidents / JHAs / talks / hazards / inspections. The
  // refusal names those tables on the flush channel, which SafetyContext
  // already re-reads (onQueueFlushed → rereadTables). Executed in
  // __tests__/sync/offline-queue.test.ts (both paths).
  const q = read('utils/offlineQueue.ts');
  const fn = q.slice(q.indexOf('function notifyProjectDeleteRefused('), q.indexOf('function notifyProjectDeleteRefused(') + 500);
  ok('the refusal announces the five project-scoped safety tables on the flush channel',
    /const PROJECT_SAFETY_TABLES = \['safety_incidents', 'jhas', 'toolbox_talks', 'hazards', 'safety_inspections'\] as const;/.test(q)
      && /notifyFlushed\(new Set<string>\(PROJECT_SAFETY_TABLES\)\);/.test(fn));
  const sc = read('contexts/SafetyContext.tsx');
  const names = ['JHAS_TABLE', 'TOOLBOX_TABLE', 'INCIDENTS_TABLE', 'HAZARDS_TABLE', 'INSPECTIONS_TABLE']
    .map(c => (sc.match(new RegExp(`const ${c} = '([a-z_]+)';`)) ?? [])[1]).filter(Boolean).sort();
  ok('…those are exactly SafetyContext\'s project-scoped tables',
    JSON.stringify(names) === JSON.stringify(['hazards', 'jhas', 'safety_incidents', 'safety_inspections', 'toolbox_talks']), names.join());
  ok('…and SafetyContext re-reads a table named on that channel',
    /onQueueFlushed\(\(tables\) => \{ void rereadTables\(tables\); \}\)/.test(sc));
}

console.log(`\n${failures === 0 ? '✓' : '✗'} validate-w5-join-core-refusals: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
