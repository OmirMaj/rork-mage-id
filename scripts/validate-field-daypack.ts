// validate-field-daypack.ts — the read guarantee, and the claims made about it.
//
// WHAT THIS PROTECTS. MAGE prefetched plan sheets for ONE project — whichever
// detail screen the user happened to open — capped at 12, with no budget shared
// across the sites they are actually visiting, and no record of what landed. A
// super with three jobs got the drawings for whichever one he tapped last, and
// nothing anywhere told him which.
//
// The field day pack fixes the selection AND makes the result visible, which
// means it can now lie in ways the old code could not. Everything below exists
// to stop a specific lie:
//
//   • claiming coverage for bytes whose signed url has expired (the cache is
//     keyed by URL and a plan-sheet url lives 24 h);
//   • claiming a count we asked for rather than one the prefetch confirmed;
//   • claiming a whole pack when the budget cut it short;
//   • showing one contractor the readiness of another contractor's jobs;
//   • starving the sites you are driving to in favour of the one you opened.
//
// Every check here calls utils/fieldDayPackCore directly. The three at the end
// pin the two places with no injection seam: the storage key's prefix, and the
// warm path's refusal to stamp a fresh record over a pack of zero.
//
// Run via: bun run test:field-daypack

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DAY_PACK_EXPIRES_AFTER_MS,
  DAY_PACK_HORIZON_DAYS,
  DAY_PACK_STALE_AFTER_MS,
  MAX_DAY_PACK_PROJECTS,
  MAX_DAY_PACK_SHEETS,
  MAX_SHEETS_PER_PROJECT,
  WARM_MIN_INTERVAL_MS,
  allocateSheetBudget,
  buildDayPackRecord,
  clockLabel,
  dayPackFreshness,
  describeDayPack,
  evictDayPackRecord,
  isPrefetchableSheetUri,
  parseDayPackRecord,
  rankDayPackProjects,
  shouldWarmNow,
  type DayPackCandidate,
  type DayPackRecord,
} from '../utils/fieldDayPackCore';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, why ? `\n      ${why}` : ''); }
}

const sheets = (n: number, prefix = 'https://cdn/s') =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}.png`);

const cand = (id: string, n: number): DayPackCandidate =>
  ({ projectId: id, projectName: `Job ${id}`, sheetUris: sheets(n, `https://cdn/${id}-`) });

const rec = (over: Partial<DayPackRecord> = {}): DayPackRecord => ({
  warmedAt: 1_000_000,
  userId: 'u1',
  projects: [{ projectId: 'p1', projectName: 'Harbor View', sheetsWarmed: 6, sheetsEligible: 6 }],
  sheetsWarmed: 6,
  truncated: false,
  ...over,
});

console.log('\n── 1. the budget is shared fairly, not first-come ──────────────');
{
  // The bug this replaces: the first project takes its fill and the rest get
  // nothing. With a 6-sheet total across three 8-sheet jobs, first-come gives
  // [6,0,0]; fair share gives [2,2,2].
  const plan = allocateSheetBudget([cand('a', 8), cand('b', 8), cand('c', 8)], { maxTotal: 6 });
  const counts = plan.allocations.map((a) => a.uris.length);
  ok('a shared total is split across every job', counts.join(',') === '2,2,2', counts.join(','));
  ok('…and the total is respected exactly',
    counts.reduce((n, c) => n + c, 0) === 6, String(counts.reduce((n, c) => n + c, 0)));
  ok('…and the pack reports itself truncated', plan.truncated === true);

  // Unspent share must flow onward: a 1-sheet job stops taking turns.
  const spare = allocateSheetBudget([cand('a', 1), cand('b', 8)], { maxTotal: 6 });
  const m = new Map(spare.allocations.map((a) => [a.projectId, a.uris.length]));
  ok('a small job does not hold budget it cannot use',
    m.get('a') === 1 && m.get('b') === 5, JSON.stringify([...m]));

  const easy = allocateSheetBudget([cand('a', 2), cand('b', 2)], { maxTotal: 16 });
  ok('a pack that fits is NOT flagged truncated', easy.truncated === false);
  ok('…and takes everything eligible',
    easy.allocations.every((a) => a.uris.length === 2));
}

console.log('\n── 2. every cap actually binds ─────────────────────────────────');
{
  const perProject = allocateSheetBudget([cand('a', 50)], { maxPerProject: 3, maxTotal: 99 });
  ok('the per-project cap binds', perProject.allocations[0].uris.length === 3,
    String(perProject.allocations[0].uris.length));
  ok('…and a starved job is truncation', perProject.truncated === true);

  const projectCap = allocateSheetBudget(
    [cand('a', 2), cand('b', 2), cand('c', 2), cand('d', 2), cand('e', 2)],
    { maxProjects: 2, maxTotal: 99 },
  );
  ok('the project cap binds', projectCap.allocations.length === 2, String(projectCap.allocations.length));
  ok('…and dropping a job with sheets is truncation', projectCap.truncated === true);

  // A job dropped by the cap that had NOTHING eligible is not a truncation —
  // nothing was withheld from the user.
  const emptyTail = allocateSheetBudget(
    [cand('a', 2), { projectId: 'z', projectName: 'Z', sheetUris: ['file:///local.png'] }],
    { maxProjects: 1, maxTotal: 99 },
  );
  ok('dropping a job with no fetchable sheets is not truncation', emptyTail.truncated === false);

  ok('the shipped caps are the ones the header argues for',
    MAX_DAY_PACK_PROJECTS === 4 && MAX_SHEETS_PER_PROJECT === 8 && MAX_DAY_PACK_SHEETS === 16
    && DAY_PACK_HORIZON_DAYS === 2 && WARM_MIN_INTERVAL_MS === 3 * 3600_000,
    'a cap moved without its reasoning');
}

console.log('\n── 3. only bytes that are actually elsewhere get fetched ───────');
{
  ok('an https sheet is fetchable', isPrefetchableSheetUri('https://cdn/a.png') === true);
  ok('an http sheet is fetchable', isPrefetchableSheetUri('http://cdn/a.png') === true);
  ok('a device file is not', isPrefetchableSheetUri('file:///var/a.png') === false);
  ok('a data uri is not', isPrefetchableSheetUri('data:image/png;base64,AAA') === false);
  ok('a blob is not', isPrefetchableSheetUri('blob:https://x/y') === false);
  ok('empty is not', isPrefetchableSheetUri('') === false && isPrefetchableSheetUri(null) === false);

  const mixed = allocateSheetBudget([{
    projectId: 'a', projectName: 'A',
    sheetUris: ['file:///1.png', 'https://cdn/2.png', 'data:x', 'https://cdn/3.png'],
  }], { maxTotal: 99 });
  ok('local uris never spend budget',
    mixed.allocations[0].uris.join(',') === 'https://cdn/2.png,https://cdn/3.png',
    mixed.allocations[0].uris.join(','));
  ok('…and eligible counts only the fetchable ones', mixed.allocations[0].eligible === 2);
}

console.log('\n── 4. today outranks tomorrow, and jobs appear once ────────────');
{
  ok('today first, then tomorrow-only',
    rankDayPackProjects(['a', 'b'], ['b', 'c']).join(',') === 'a,b,c',
    rankDayPackProjects(['a', 'b'], ['b', 'c']).join(','));
  ok('a job on both days is not packed twice',
    rankDayPackProjects(['a', 'a'], ['a']).length === 1);
  ok('the project cap applies to the ranking too',
    rankDayPackProjects(['a', 'b', 'c', 'd', 'e'], []).length === MAX_DAY_PACK_PROJECTS);
  ok('an empty day ranks nothing', rankDayPackProjects([], []).length === 0);
}

console.log('\n── 5. freshness: expired is not a politer "stale" ──────────────');
{
  const now = 10_000_000_000;
  ok('no record is "none"', dayPackFreshness(null, now, 'u1') === 'none');
  ok('a pack of zero sheets claims nothing',
    dayPackFreshness(rec({ warmedAt: now, sheetsWarmed: 0, projects: [] }), now, 'u1') === 'none');
  ok('another tenant’s pack is not this user’s readiness',
    dayPackFreshness(rec({ warmedAt: now }), now, 'u2') === 'none');
  ok('no session, no claim', dayPackFreshness(rec({ warmedAt: now }), now, null) === 'none');
  ok('a minute old is fresh', dayPackFreshness(rec({ warmedAt: now - 60_000 }), now, 'u1') === 'fresh');
  ok('one ms before the stale line is still fresh',
    dayPackFreshness(rec({ warmedAt: now - (DAY_PACK_STALE_AFTER_MS - 1) }), now, 'u1') === 'fresh');
  ok('exactly the stale line is stale',
    dayPackFreshness(rec({ warmedAt: now - DAY_PACK_STALE_AFTER_MS }), now, 'u1') === 'stale');
  ok('one ms before the expiry line is still stale, not expired',
    dayPackFreshness(rec({ warmedAt: now - (DAY_PACK_EXPIRES_AFTER_MS - 1) }), now, 'u1') === 'stale');
  ok('at the signed-url TTL the pack is EXPIRED',
    dayPackFreshness(rec({ warmedAt: now - DAY_PACK_EXPIRES_AFTER_MS }), now, 'u1') === 'expired',
    'the cached bytes are keyed by a url nobody will request again');
  ok('the expiry line IS the plan-sheet url TTL', DAY_PACK_EXPIRES_AFTER_MS === 24 * 3600_000);
  ok('a pack stamped in the future is not read as fresh',
    dayPackFreshness(rec({ warmedAt: now + 60_000 }), now, 'u1') === 'stale',
    'a clock that moved backwards must not manufacture coverage');
}

console.log('\n── 6. the copy never overstates the pack ───────────────────────');
{
  const now = 10_000_000_000;
  const fresh = rec({ warmedAt: now - 60_000, sheetsWarmed: 6 });
  const s1 = describeDayPack(fresh, 'fresh');
  ok('a fresh pack states the measured count', s1.includes('6 sheets'), s1);
  ok('…names the jobs it covers', s1.includes('1 job'), s1);
  ok('…and says when', /saved \d+:\d\d (AM|PM)/.test(s1), s1);
  ok('…without a staleness hedge', !/out of date/.test(s1), s1);

  const s2 = describeDayPack(fresh, 'stale');
  ok('a stale pack says so in the same line', /may be out of date/.test(s2), s2);

  const s3 = describeDayPack(rec({ truncated: true }), 'fresh');
  ok('a truncated pack says "Partial"', s3.startsWith('Partial'), s3);
  ok('…and never says the plain "Saved for offline"', !s3.includes('Saved for offline'), s3);

  const s4 = describeDayPack(fresh, 'expired');
  ok('an expired pack claims NO coverage',
    !/Saved for offline|Partial offline copy/.test(s4) && /expired/.test(s4), s4);
  ok('…and tells the user what fixes it', /reconnect/i.test(s4), s4);

  // The 'none' line is read by a contractor who has never uploaded a plan
  // sheet at all — buildDayPackCandidates drops projects with no sheets, so no
  // warm, no record, this branch. It must state the device, not imply that a
  // safeguard failed on plans that exist.
  const s5 = describeDayPack(null, 'none');
  ok('no pack states the device, not a verdict',
    s5 === 'No plan sheets saved on this device.', s5);
  ok('…and does not imply a safeguard that has not run yet',
    !/\byet\b/i.test(s5), s5);

  // THE DENOMINATOR. Reproduced from the review: yesterday's record covered
  // three jobs, today's board is one of them plus a NEW job, the warm fails, so
  // eviction prunes to one and freshness is 'fresh'. "Saved for offline: 4
  // sheets across 1 job" is true and reads as full coverage on a two-job day.
  const oneOfTwo = rec({
    warmedAt: now - 60_000, sheetsWarmed: 4,
    projects: [{ projectId: 'harbor', projectName: 'Harbor', sheetsWarmed: 4, sheetsEligible: 4 }],
  });
  const named = describeDayPack(oneOfTwo, 'fresh', 2);
  ok('a job on today’s board with nothing on the device is NAMED',
    named.includes('1 of today’s 2 jobs not saved'), named);
  ok('…and the covered count is still stated', named.includes('4 sheets across 1 job'), named);
  ok('full coverage adds no shortfall clause',
    !/not saved/.test(describeDayPack(oneOfTwo, 'fresh', 1)),
    describeDayPack(oneOfTwo, 'fresh', 1));
  ok('a pack COVERING MORE than today’s board (tomorrow’s jobs) claims no shortfall',
    !/not saved/.test(describeDayPack(oneOfTwo, 'fresh', 0)),
    describeDayPack(oneOfTwo, 'fresh', 0));
  ok('the shortfall survives the staleness hedge, and precedes it',
    (() => {
      const st = describeDayPack(oneOfTwo, 'stale', 3);
      return st.includes('2 of today’s 3 jobs not saved')
        && st.indexOf('not saved') < st.indexOf('out of date');
    })(), describeDayPack(oneOfTwo, 'stale', 3));

  ok('singular grammar for one sheet',
    describeDayPack(rec({ sheetsWarmed: 1, projects: [{ projectId: 'p1', projectName: 'X', sheetsWarmed: 1, sheetsEligible: 1 }] }), 'fresh')
      .includes('1 sheet across 1 job'));
  // Jobs whose share warmed to zero are not counted as covered jobs.
  const halfDead = rec({
    sheetsWarmed: 3,
    projects: [
      { projectId: 'p1', projectName: 'A', sheetsWarmed: 3, sheetsEligible: 3 },
      { projectId: 'p2', projectName: 'B', sheetsWarmed: 0, sheetsEligible: 4 },
    ],
  });
  ok('a job whose sheets all failed is not counted as covered',
    describeDayPack(halfDead, 'fresh').includes('1 job'), describeDayPack(halfDead, 'fresh'));
}

console.log('\n── 7. clockLabel ──────────────────────────────────────────────');
{
  // Built from local components and read back as local time, so the suite does
  // not depend on the machine's timezone.
  ok('local midnight is 12:00 AM', clockLabel(new Date(2026, 0, 15, 0, 0).getTime()) === '12:00 AM');
  ok('local noon is 12:00 PM', clockLabel(new Date(2026, 0, 15, 12, 0).getTime()) === '12:00 PM');
  ok('a single-digit minute is padded', clockLabel(new Date(2026, 0, 15, 7, 5).getTime()) === '7:05 AM');
  ok('afternoon wraps to 12-hour', clockLabel(new Date(2026, 0, 15, 19, 42).getTime()) === '7:42 PM');
}

console.log('\n── 8. warm spacing ────────────────────────────────────────────');
{
  const now = 10_000_000_000;
  ok('no session, no warm', shouldWarmNow(null, now, null) === false);
  ok('no record, warm', shouldWarmNow(null, now, 'u1') === true);
  ok('another user’s record does not block this user’s warm',
    shouldWarmNow(rec({ warmedAt: now, userId: 'u2' }), now, 'u1') === true);
  ok('inside the interval, no warm',
    shouldWarmNow(rec({ warmedAt: now - 60_000 }), now, 'u1') === false);
  ok('at the interval, warm',
    shouldWarmNow(rec({ warmedAt: now - WARM_MIN_INTERVAL_MS }), now, 'u1') === true);
  ok('a record from the future re-warms rather than locking us out',
    shouldWarmNow(rec({ warmedAt: now + 9_000_000 }), now, 'u1') === true);
}

console.log('\n── 9. eviction retracts the claim, and the parser recomputes ───');
{
  const two = rec({
    projects: [
      { projectId: 'p1', projectName: 'A', sheetsWarmed: 4, sheetsEligible: 4 },
      { projectId: 'p2', projectName: 'B', sheetsWarmed: 5, sheetsEligible: 5 },
    ],
    sheetsWarmed: 9,
  });
  const kept = evictDayPackRecord(two, ['p1'])!;
  ok('a job off the horizon stops being claimed', kept.projects.length === 1);
  ok('…and the headline count drops with it', kept.sheetsWarmed === 4, String(kept.sheetsWarmed));
  ok('an unchanged scope returns the SAME object (no needless write)',
    evictDayPackRecord(two, ['p1', 'p2']) === two);
  ok('evicting everything leaves an empty record, not a lie',
    evictDayPackRecord(two, [])!.sheetsWarmed === 0);
  ok('nothing to evict from null', evictDayPackRecord(null, ['p1']) === null);

  ok('garbage parses to null', parseDayPackRecord('{{{') === null);
  ok('a record with no owner parses to null',
    parseDayPackRecord(JSON.stringify({ warmedAt: 1, projects: [] })) === null);
  ok('a record with no timestamp parses to null',
    parseDayPackRecord(JSON.stringify({ userId: 'u', projects: [] })) === null);
  const lying = parseDayPackRecord(JSON.stringify({
    warmedAt: 1, userId: 'u1', sheetsWarmed: 9999,
    projects: [{ projectId: 'p1', projectName: 'A', sheetsWarmed: 2, sheetsEligible: 2 }],
  }))!;
  ok('the headline count is RECOMPUTED, never trusted from disk',
    lying.sheetsWarmed === 2, String(lying.sheetsWarmed));
  const negative = parseDayPackRecord(JSON.stringify({
    warmedAt: 1, userId: 'u1',
    projects: [{ projectId: 'p1', projectName: 'A', sheetsWarmed: -7, sheetsEligible: 1 }],
  }))!;
  ok('a negative count clamps to zero', negative.sheetsWarmed === 0);
}

console.log('\n── 10. the warm counts what LANDED, driven with a failing fetcher ─');
{
  // THE MUTATION THIS REPLACES. This section used to grep planPrefetch.ts for
  // `results.filter(Boolean).length`, `mapLimit(a.uris` and `missedAllocation`.
  // Changing warmOne to `return true` — every allocated sheet recorded as
  // confirmed no matter what the network did — left all three tokens in place
  // and the suite green, while the card read "Saved for offline: 16 sheets
  // across 4 jobs" for a pack in which nothing arrived. The loop now lives in
  // the pure core and is DRIVEN here.
  const plan = allocateSheetBudget([cand('a', 8)], { maxPerProject: 8, maxTotal: 8 });
  const dead = new Set(['https://cdn/a-1.png', 'https://cdn/a-4.png', 'https://cdn/a-6.png']);
  const asked: string[] = [];
  const flaky = async (uri: string) => { asked.push(uri); return !dead.has(uri); };

  const r = (await buildDayPackRecord('u1', plan, flaky, { now: 5_000 }))!;
  ok('every allocated url is fetched individually, not as one batch',
    asked.length === 8 && new Set(asked).size === 8, `asked ${asked.length}`);
  ok('the record counts ONLY what the fetcher confirmed', r.sheetsWarmed === 5, String(r.sheetsWarmed));
  ok('…per job, too', r.projects[0].sheetsWarmed === 5, String(r.projects[0].sheetsWarmed));
  ok('…while eligible still records what the job HAD', r.projects[0].sheetsEligible === 8);
  ok('a sheet the network dropped makes the pack "partial"', r.truncated === true,
    'the budget fit, so only the failures can have set this');
  ok('…and the copy says Partial, with the measured number',
    describeDayPack(r, 'fresh').startsWith('Partial offline copy: 5 sheets'),
    describeDayPack(r, 'fresh'));

  const allGood = (await buildDayPackRecord('u1', plan, async () => true, { now: 5_000 }))!;
  ok('a warm that fully lands is not "partial"',
    allGood.sheetsWarmed === 8 && allGood.truncated === false);

  ok('a warm that landed NOTHING writes no record at all',
    (await buildDayPackRecord('u1', plan, async () => false)) === null,
    'an offline warm would otherwise stamp a fresh pack of zero and block the next try for 3 h');
  ok('…and a fetcher that THROWS is the same fact as one that returns false',
    (await buildDayPackRecord('u1', plan, async () => { throw new Error('offline'); })) === null);
  ok('…and an ambiguous answer is not a measurement',
    (await buildDayPackRecord('u1', plan, async () => undefined)) === null,
    'only an explicit true may be counted as bytes on the device');

  const partialThrow = (await buildDayPackRecord('u1', plan, async (uri: string) => {
    if (dead.has(uri)) throw new Error('timeout');
    return true;
  }, { now: 5_000 }))!;
  ok('a mix of throws and successes counts the successes only',
    partialThrow.sheetsWarmed === 5 && partialThrow.truncated === true,
    String(partialThrow.sheetsWarmed));

  ok('no session, no record', (await buildDayPackRecord('', plan, async () => true)) === null);
  ok('nothing allocated, no record',
    (await buildDayPackRecord('u1', { allocations: [], truncated: false }, async () => true)) === null);

  // Two jobs, one of which the network refuses entirely: the failed job must
  // not be counted as a covered job by the copy.
  const twoJobs = allocateSheetBudget([cand('a', 2), cand('b', 2)], { maxTotal: 16 });
  const oneJobDead = (await buildDayPackRecord('u1', twoJobs,
    async (uri: string) => !uri.includes('/b-'), { now: 5_000 }))!;
  ok('a job whose every sheet failed is recorded at zero',
    oneJobDead.projects.find((x) => x.projectId === 'b')!.sheetsWarmed === 0);
  ok('…and the copy counts one job, not two',
    describeDayPack(oneJobDead, 'fresh').includes('across 1 job'),
    describeDayPack(oneJobDead, 'fresh'));
}

console.log('\n── 11. source pins (no injection seam) ────────────────────────');
{
  const pf = read('utils', 'planPrefetch.ts');
  ok('the day-pack record key carries the mageid_ prefix the tenant sweep matches',
    /DAY_PACK_KEY = 'mageid_/.test(pf));
  // The seam itself: the shipped path must go through the counted loop above,
  // not re-roll one. Scoped to the function body — `buildDayPackRecord` also
  // appears in the import block, so a whole-file grep stays green after the
  // call is removed.
  const warmFn = pf.slice(pf.indexOf('export async function warmFieldDayPack'));
  const shippedWarm = warmFn.slice(0, warmFn.indexOf('\n}\n'));
  ok('the shipped warm counts through the pure, driven loop',
    /buildDayPackRecord\(userId, plan, warmOne/.test(shippedWarm),
    'the warm is counting its sheets somewhere no validator can drive');
  ok('…and writes a record only when that loop returned one',
    shippedWarm.indexOf('if (!record)') < shippedWarm.indexOf('setItem(DAY_PACK_KEY'),
    'a null record must not be stamped to disk');
  ok('the single-project fire-and-forget path is still exported for project-detail',
    /export function prefetchProjectPlans\(sheets: PlanSheet\[\] \| null \| undefined\): void/.test(pf));
  ok('…and app/project-detail.tsx still calls it that way',
    /prefetchProjectPlans\(projectPlans\)/.test(read('app', 'project-detail.tsx')));

  const hook = read('hooks', 'useFieldDayPack.ts');
  // Scoped to the function bodies. Every name checked here also appears in the
  // import block at the top of the file, so a whole-file grep — or an
  // indexOf comparison against the file — stays green after the call itself is
  // removed or moved. Both mistakes were made writing this guard and both were
  // caught by mutating the source.
  const selector = hook.slice(hook.indexOf('export function dayPackProjectIds'));
  const selectorBody = selector.slice(0, selector.indexOf('\n}\n'));
  ok('the pack uses the SAME day math as the TODAY ON SITE card',
    /computeTodayTasks\(projects, at\)/.test(selectorBody),
    'a second idea of "today" would cover the wrong jobs');
  ok('the horizon is walked, not hard-coded to one day',
    /d < DAY_PACK_HORIZON_DAYS/.test(selectorBody));

  const warm = hook.slice(hook.indexOf('const maybeWarm'));
  const warmBody = warm.slice(0, warm.indexOf('}, []);'));
  ok('coverage is retracted BEFORE the spacing check',
    warmBody.includes('pruneDayPackRecord')
    && warmBody.indexOf('pruneDayPackRecord') < warmBody.indexOf('shouldWarmNow'),
    'yesterday’s record would otherwise suppress today’s warm');
  ok('…and the spacing check reads the PRUNED record, not the raw one',
    /shouldWarmNow\(pruned,/.test(warmBody));

  ok('the warmer is mounted exactly once, where the data lives',
    /useFieldDayPackWarmer\(projects, planSheets\)/.test(read('contexts', 'ProjectContext.tsx')));
  const card = read('components', 'summary', 'TodayOnSite.tsx');
  ok('the day’s card states its own offline readiness, WITH the day’s job count',
    /useFieldDayPack\(jobCount\)/.test(card),
    'without the denominator the line reads as full coverage on a multi-job day');
  ok('…and renders nothing while the hook has nothing true to say',
    /dayPack\.summary\.length > 0/.test(card),
    'an empty summary means "not read yet" or "web"; a placeholder there is a false alarm');

  const packHook = read('hooks', 'useFieldDayPack.ts');
  const warmer = packHook.slice(packHook.indexOf('const maybeWarm'));
  ok('the warm does not run on web, where there is no disk guarantee to claim',
    /DAY_PACK_PLATFORM_SUPPORTED = Platform\.OS !== 'web'/.test(packHook)
    && /if \(!DAY_PACK_PLATFORM_SUPPORTED\) return;/.test(warmer.slice(0, warmer.indexOf('}, []);'))),
    'expo-image’s web prefetch only builds an <img> and leans on the browser HTTP cache');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
