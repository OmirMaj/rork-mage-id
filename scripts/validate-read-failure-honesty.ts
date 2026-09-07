// scripts/validate-read-failure-honesty.ts — source-text validator for the
// one rule behind the audit's biggest theme (2026-09-07, "THE HONESTY GAP"):
//
//   A FAILED READ IS NEVER RENDERED AS AN EMPTY ONE, AND A WRITE THAT THREW
//   IS NEVER ANNOUNCED AS A SAVE.
//
// Every defect in that class had the same two shapes. Either a queryFn caught
// the error and returned `[]`, so the screen's empty state made an absolute
// claim about data it never received ("You haven't posted anything yet" to a
// homeowner with three live RFPs; "No companies match yet" during a backend
// hiccup; the day-one onboarding empty state to a GC whose whole book of work
// had simply failed to load). Or a success path ran unconditionally, outside
// the try that was supposed to gate it (EstimateComparison alerting "Saved"
// after AsyncStorage threw; a daily report announced as saved by a mail-send
// failure handler that ran BEFORE anything was written).
//
// These are source assertions because the defects are wiring and copy, not
// arithmetic — there is no pure function to test. Each one names the screen
// and the sentence it is pinning, so a rewrite that keeps the honesty passes
// and a rewrite that quietly drops it does not.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
function ok(n: string, cond: boolean) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

/** The body of the first `name = useCallback(` / `function name(` block, to the
 *  matching close. Lets an assertion be scoped to ONE handler instead of the
 *  whole file, so "no unconditional success alert" cannot be satisfied by a
 *  different function's guard three hundred lines away. */
function fnBody(file: string, startMarker: string): string {
  const at = file.indexOf(startMarker);
  if (at < 0) return '';
  let depth = 0, seen = false;
  for (let i = at; i < file.length; i++) {
    const c = file[i];
    if (c === '{') { depth++; seen = true; }
    else if (c === '}') { depth--; if (seen && depth === 0) return file.slice(at, i + 1); }
  }
  return file.slice(at);
}

console.log('\nread-failure honesty');

// ── 1. The signal exists, and it is owned by the layer that swallows ────────
{
  const ctx = src('contexts/ProjectContext.tsx');
  ok('ProjectContext: still swallows failed reads and serves the cache (the reason the flag has to exist)',
    ctx.includes('if (!error && data && data.length > 0)'));
  ok('ProjectContext: carries the reachability probe and publishes it as sourceFailed on CoreData',
    /useMageReachability\(\)/.test(ctx) && /sourceFailed: reachability\.failed/.test(ctx));
  ok('ProjectContext: publishes a retry beside it, so a surface that reports the failure can offer a way out',
    /retryRemoteReads: \(\) => void/.test(ctx) && /const retryRemoteReads = useCallback/.test(ctx));
  // Re-review: the flag being IN the memo is not enough. Drop
  // `reachability.failed` from the dep array and coreData never recomputes
  // when the probe flips — sourceFailed is frozen at its initial `false` and
  // every gate below silently reverts to the bug, with the guard still green.
  ok('ProjectContext: reachability.failed is a dep of the coreData memo (without it the flag is frozen false)',
    /projectsLoaded, reachability\.failed, retryRemoteReads/.test(ctx));

  const hook = src('hooks/useBrainWatch.ts');
  ok('useBrainWatch: forwards ProjectContext\'s sourceFailed rather than re-deriving it (one fact, one owner)',
    /const \{ projects, sourceFailed \} = useCoreData\(\)/.test(hook)
    && /sourceFailed \}/.test(hook)
    && !/useMageReachability/.test(hook));
}

// ── 2. Summary: the tab that says "all clear" for a living ──────────────────
{
  const summary = src('app/(tabs)/summary/index.tsx');
  ok('summary: reads sourceFailed (it was destructured away — the whole tab dropped the flag)',
    /useCoreData\(\)/.test(summary) && /sourceFailed/.test(summary));
  ok('summary: "No projects yet" is unreachable while the source is failing',
    /projects\.length === 0 && sourceFailed/.test(summary)
    && summary.indexOf('projects.length === 0 && sourceFailed') < summary.indexOf('title="No projects yet"'));
  ok('summary: the failed-read state says what happened and offers the retry, not onboarding copy',
    /Couldn't reach MAGE/.test(summary) && /onAction=\{retryRemoteReads\}/.test(summary));
  ok('summary: a partial failure (cached projects, failing reads) is disclosed above the briefing',
    /testID="summary-unreachable"/.test(summary));
}

// ── 3. Daily report: the day's work outlives the mail composer ─────────────
{
  const dfr = src('app/daily-report.tsx');
  const send = fnBody(dfr, 'const handleConfirmSend = useCallback');
  ok('daily report: handleConfirmSend was found (the assertions below are scoped to it)', send.length > 400);
  ok('daily report: the record is written BEFORE any delivery is attempted',
    send.indexOf("handleSave('draft'") > 0
    && send.indexOf("handleSave('draft'") < send.indexOf('await sendEmail('));
  ok('daily report: that first write is silent — a non-silent one navigates back mid-send',
    /handleSave\('draft'[^)]*silent: true/.test(send));
  ok('daily report: the old lie is gone — nothing claims "Report saved" from a path that saved nothing',
    !/Report saved but email could not be sent/.test(send) && !/showAlert\('Email Notice'/.test(dfr));
  ok('daily report: a cancelled composer no longer returns silently — it says where the report went',
    /Saved as a draft/.test(send) && /result\.error === 'cancelled'/.test(send));
  ok('daily report: the record is only stamped "sent" once something actually left the device',
    /let delivered = wantsEmail/.test(send) && /if \(!delivered\)/.test(send) && /setSentFlip\(/.test(send));
  ok('daily report: the status flip runs from an effect, never from the send closure (a stale updateDailyReport would write back a list without the new row)',
    /const \[sentFlip, setSentFlip\]/.test(dfr)
    && !/updateDailyReport\(/.test(send));
  ok('daily report: the flip writes only if the list it maps over carries the row (otherwise the stamp deletes the report)',
    /existingReports\.some\(r => r\.id === sentFlip\.reportId\)[\s\S]{0,120}?updateDailyReport\(sentFlip\.reportId/.test(dfr));
}

// ── 4. A failed read of the user's own data is not "you have nothing" ───────
{
  const mine = src('app/(tabs)/mage-id-bids/index.tsx');
  ok('mage-id-bids: the error is no longer folded into the zero-rows branch',
    !/if \(error \|\| !rfps \|\| rfps\.length === 0\) return \[\]/.test(mine)
    && /if \(error\) throw new Error/.test(mine));
  ok('mage-id-bids: "You haven\'t posted anything yet" requires the read to have succeeded',
    /!mineQ\.error && \(mineQ\.data \?\? \[\]\)\.length === 0/.test(mine));
  ok('mage-id-bids: the failure branch says nothing was deleted and offers a retry',
    /Couldn't load your posts/.test(mine) && /testID="mageid-bids-retry"/.test(mine));

  for (const [rel, label, empty] of [
    ['app/(tabs)/discover/companies.tsx', 'companies', 'No companies match yet'],
    ['app/(tabs)/discover/hire.tsx', 'hire', 'No jobs posted yet'],
  ] as const) {
    const file = src(rel);
    ok(`discover/${label}: the query error is kept, not underscore-prefixed away`,
      !/error: _\w+QueryError/.test(file) && /error: \w+QueryError/.test(file));
    // Scoped to the queryFn body, and phrased as "no `return []` anywhere in
    // it" rather than pinned to the old console.log wording — re-review found
    // that restoring `return [];` under a NEW log line sailed past the
    // original assertion, which is the whole defect coming back.
    const qfn = fnBody(file, 'queryFn: async () => {');
    ok(`discover/${label}: the queryFn body was found (the assertion below is scoped to it)`, qfn.length > 200);
    ok(`discover/${label}: the queryFn throws on failure instead of returning an empty marketplace`,
      !/return \[\];/.test(qfn) && /throw/.test(qfn));
    ok(`discover/${label}: the error branch is rendered AHEAD of the skeleton and "${empty}"`,
      /QueryError \? \(/.test(file)
      && file.indexOf('QueryError ? (') < file.indexOf(empty)
      && /styles\.retryButton/.test(file));
  }
}

// ── 5. A write that threw is never announced as a save ─────────────────────
{
  const cmp = src('components/EstimateComparison.tsx');
  const save = fnBody(cmp, 'const handleSaveCurrentVersion = useCallback');
  ok('EstimateComparison: handleSaveCurrentVersion was found', save.length > 300);
  ok('EstimateComparison: the failed write bails instead of falling through to the success alert',
    /Failed to save version[\s\S]{0,400}?return;/.test(save));
  ok('EstimateComparison: "Saved" is announced after the setItem resolved, not before the try',
    save.indexOf('AsyncStorage.setItem') < save.indexOf("showAlert('Saved'")
    && save.indexOf('AsyncStorage.setItem') < save.indexOf('Haptics.notificationAsync'));
  // The delete path had this assertion from the start; the save path did not,
  // and a re-review mutation put `setSavedVersions(updated)` back above the
  // try — a version sitting on screen looking saved after the write threw —
  // with the guard still green.
  ok('EstimateComparison: the saved-versions list is updated only after the write landed',
    save.indexOf('AsyncStorage.setItem') < save.indexOf('setSavedVersions(updated)'));
  const del = fnBody(cmp, 'const handleDeleteVersion = useCallback');
  ok('EstimateComparison: a failed delete keeps the row instead of hiding it until the next open',
    /Failed to delete version[\s\S]{0,400}?return;/.test(del)
    && del.indexOf('AsyncStorage.setItem') < del.indexOf('setSavedVersions(updated)'));
}

// ── 6. A hub with nothing in it still teaches the way in ───────────────────
{
  const docs = src('app/documents.tsx');
  ok('documents: the title-only dead end is gone — the shared EmptyState carries it now',
    !/<Text style=\{styles\.emptyTitle\}>No documents found<\/Text>/.test(docs)
    && /import EmptyState from '@\/components\/EmptyState'/.test(docs));
  ok('documents: the empty state names the create homes this read-only aggregator collects from',
    /COI Vault/.test(docs) && /Permits/.test(docs) && /actionLabel=/.test(docs));
  ok('documents: an empty FILTER is told apart from an empty account',
    /documents\.length === 0 \? 'Nothing filed yet' : 'Nothing under this filter'/.test(docs));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
