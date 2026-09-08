// scripts/validate-ai-failure-copy.ts — the three ways an AI panel lies to a
// contractor, pinned so they cannot come back.
//
// WHY THIS EXISTS. The 2026-09-07 app-experience audit found the same shape
// repeated across the AI surfaces, and all three instances were invisible from
// the outside — nothing crashed, nothing logged, the screen just said
// something untrue or nothing at all:
//
//   (1) AN INVENTED NUMBER. utils/aiService.ts computed the briefing's
//       "overdue" count as `t.startDay + t.durationDays < totalDurationDays` —
//       a task's finish DAY NUMBER against the schedule's TOTAL duration — so
//       on a healthy job every incomplete task except the last one counted as
//       overdue and the model was handed a dozen of them to be "specific with
//       names and numbers" about. Today's date never entered. On Home that
//       fabricated count renders inches above MorningBriefCard, the
//       deterministic brief that correctly says nothing needs attention.
//
//   (2) A SILENT SPEND. AIHomeBriefing and AIScheduleRisk each ran their
//       analysis from a bare mount effect. Opening Home, or the Schedule tab,
//       spent a metered AI call the GC never asked for — and AIScheduleRisk's
//       own "Tap to run AI Risk Analysis" card was unreachable dead UI. A Pro
//       GC with three jobs burned his allowance browsing.
//
//   (3) A SILENT FAILURE. Six generate buttons caught to `console` and
//       returned. The button spun, went back to normal, and produced nothing —
//       the super on site could not tell a dropped signal from a tier cap from
//       a broken feature.
//
// And one specific instance of the standing "an invented fact is worse than an
// absent one" rule: the sub evaluator printed model-recalled
// journeyman/master/apprentice wage rates as a "Typical Rates" grid, with no
// city and no market anywhere in the payload, on the screen where the award is
// decided.
//
// Run via: bun run test:ai-failure-copy

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveScheduleAnchor, scheduleDayNumberFor } from '../utils/scheduleOps';
// measuredUsage is sliced out of the component and RUN below, so every helper
// it calls has to be handed to `new Function` explicitly — the slice has no
// imports of its own. It moved from a bare `new Date(u.date)` to the calendar
// helper on 2026-09-07 (validate-calendar-date), which is what made this
// injection necessary; the same pattern as resolveScheduleAnchor above.
import { parseCalendarDay } from '../utils/calendarDate';

// These validators run under bun (`bun run scripts/...`), but tsc type-checks
// them against the app's react-native lib set — which has no Bun global. The
// one API used here is declared rather than pulling in @types/bun.
declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' }) => { transformSync(code: string): string };
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n, extra ? `\n     ${extra}` : ''); }
}
function note(n: string) { console.log('  ·', n); }

// ─── Source scanning ────────────────────────────────────────────────────────
// Comments in this codebase QUOTE the buggy expression they replaced, and the
// fix comments below name `setError` and `totalDurationDays` explicitly — so
// every structural scan runs over a copy with comments and string bodies
// blanked to spaces. Offsets are preserved, so a slice of the blanked source
// and the same slice of the real source line up.
function blank(source: string): string {
  const out = source.split('');
  const n = source.length;
  let i = 0;
  // Template-literal `${ }` interpolations hold real code, so they are tracked
  // as a stack rather than blanked wholesale.
  const tplDepth: number[] = [];
  while (i < n) {
    const c = source[i], d = source[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && source[i] !== '\n') { out[i] = ' '; i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] !== '\n') out[i] = ' ';
        i++;
      }
      out[i] = ' '; out[i + 1] = ' '; i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') { out[i] = ' '; i++; }
        if (i < n && source[i] !== '\n') out[i] = ' ';
        i++;
      }
      i++;
      continue;
    }
    if (c === '`') {
      i++;
      while (i < n) {
        if (source[i] === '\\') { out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
        if (source[i] === '`') { i++; break; }
        if (source[i] === '$' && source[i + 1] === '{') { tplDepth.push(1); i += 2; break; }
        if (source[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (tplDepth.length > 0) {
        // Fall back into normal scanning until the interpolation closes.
        let depth = tplDepth.pop() as number;
        while (i < n && depth > 0) {
          if (source[i] === '{') depth++;
          else if (source[i] === '}') depth--;
          if (depth === 0) { i++; break; }
          i++;
        }
        // Resume the template body after the interpolation.
        while (i < n) {
          if (source[i] === '\\') { out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
          if (source[i] === '`') { i++; break; }
          if (source[i] !== '\n') out[i] = ' ';
          i++;
        }
      }
      continue;
    }
    i++;
  }
  return out.join('');
}

/** The `{ … }` block that starts at or after `from`, as [start, end) offsets. */
function braceBlock(blanked: string, from: number): [number, number] | null {
  const open = blanked.indexOf('{', from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < blanked.length; i++) {
    if (blanked[i] === '{') depth++;
    else if (blanked[i] === '}') { depth--; if (depth === 0) return [open, i + 1]; }
  }
  return null;
}

/** The `( … )` argument list that starts at or after `from`. */
function parenBlock(blanked: string, from: number): [number, number] | null {
  const open = blanked.indexOf('(', from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < blanked.length; i++) {
    if (blanked[i] === '(') depth++;
    else if (blanked[i] === ')') { depth--; if (depth === 0) return [open, i + 1]; }
  }
  return null;
}

// ─── 1) The overdue rule, RUN ───────────────────────────────────────────────
// utils/aiService.ts cannot be imported here (it pulls react-native through
// mageAI/AsyncStorage, which crashes bun — see scripts/validate-app-slop.ts).
// So the shipped `overdueTaskCount` is lifted out of the file verbatim,
// transpiled and executed against the REAL scheduleOps helpers. This runs the
// actual code rather than a copy of the rule: an edit to that function changes
// what these fixtures return.
console.log('\noverdue count is planned-finish-vs-today, not a day-number heuristic:');

const aiServiceSrc = src('utils/aiService.ts');
const aiServiceBlank = blank(aiServiceSrc);
const fnAt = aiServiceBlank.indexOf('function overdueTaskCount(');
ok('utils/aiService.ts still defines overdueTaskCount', fnAt >= 0);

type TaskFixture = { id: string; startDay: number; durationDays: number; status: string; progress: number };
type OverdueFn = (
  schedule: { tasks: TaskFixture[]; startDate?: string; workingDaysPerWeek?: number; nonWorkingDates?: string[]; totalDurationDays?: number } | null,
  now: Date,
) => number | null;

let overdueTaskCount: OverdueFn | null = null;
if (fnAt >= 0) {
  const block = braceBlock(aiServiceBlank, fnAt);
  const body = block ? aiServiceSrc.slice(fnAt, block[1]) : '';
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    `${body}\nmodule.exports = { overdueTaskCount };`,
  );
  const mod: { exports: Record<string, unknown> } = { exports: {} };
  new Function('module', 'exports', 'resolveScheduleAnchor', 'scheduleDayNumberFor', js)(
    mod, mod.exports, resolveScheduleAnchor, scheduleDayNumberFor,
  );
  overdueTaskCount = mod.exports.overdueTaskCount as OverdueFn;
}

const task = (id: string, startDay: number, durationDays: number, over: Partial<TaskFixture> = {}): TaskFixture =>
  ({ id, startDay, durationDays, status: 'not_started', progress: 0, ...over });

// Anchor Mon 2026-08-24; "today" Mon 2026-09-07 ⇒ working day 11.
const MONDAY_NOW = new Date(2026, 8, 7);
const anchored = {
  startDate: '2026-08-24',
  workingDaysPerWeek: 5,
  // Deliberately far larger than any task's finish day: under the old rule
  // every unfinished task cleared this bar and counted as overdue.
  totalDurationDays: 60,
  tasks: [
    task('a', 1, 3),                                  // finish day 3  → past
    task('b', 4, 7),                                  // finish day 10 → past
    task('c', 8, 6),                                  // finish day 13 → still running
    task('d', 1, 2, { status: 'done', progress: 100 }),  // finished work
    task('e', 2, 2, { progress: 100 }),               // 100% but not marked done
    task('f', 40, 5),                                 // not started yet
  ],
};

ok('the anchor really is working day 11 today (fixture sanity)',
  scheduleDayNumberFor(new Date(2026, 7, 24), MONDAY_NOW, 5) === 11);
ok('counts only the two tasks whose planned finish is already past',
  overdueTaskCount?.(anchored, MONDAY_NOW) === 2,
  `got ${String(overdueTaskCount?.(anchored, MONDAY_NOW))}`);
ok('a schedule that starts TODAY has nothing overdue (the reported bug: this returned 5)',
  overdueTaskCount?.({
    startDate: '2026-09-07', workingDaysPerWeek: 5, totalDurationDays: 30,
    tasks: [task('a', 1, 3), task('b', 4, 3), task('c', 7, 3), task('d', 10, 3), task('e', 13, 3), task('f', 16, 3)],
  }, MONDAY_NOW) === 0);
ok('an UNDATED schedule returns null — no calendar position, so no overdue line at all',
  overdueTaskCount?.({ workingDaysPerWeek: 5, totalDurationDays: 60, tasks: anchored.tasks }, MONDAY_NOW) === null);
// The anchor decides, not the task list: a DATED schedule with no tasks yet
// really does have zero overdue, and answering null for it makes the caller
// tell the model "this schedule has no start date" about one that has a date.
ok('a dated schedule with no tasks yet is 0, not "undated"',
  overdueTaskCount?.({ startDate: '2026-08-24', workingDaysPerWeek: 5, totalDurationDays: 0, tasks: [] }, MONDAY_NOW) === 0);
ok('an undated schedule with no tasks is still null',
  overdueTaskCount?.({ workingDaysPerWeek: 5, totalDurationDays: 0, tasks: [] }, MONDAY_NOW) === null);
ok('null schedule returns null', overdueTaskCount?.(null, MONDAY_NOW) === null);
ok('asked on a Saturday it still answers off the last working day (day 10)',
  overdueTaskCount?.(anchored, new Date(2026, 8, 5)) === 1,
  `got ${String(overdueTaskCount?.(anchored, new Date(2026, 8, 5)))}`);
ok('site closures shift the day count, so a closed week is not overdue time',
  overdueTaskCount?.({ ...anchored, nonWorkingDates: ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'] }, MONDAY_NOW) === 1);

console.log('\nthe briefing prompt says only what the schedule can support:');
const briefingStart = aiServiceBlank.indexOf('export async function generateHomeBriefing(');
const briefingEnd = aiServiceBlank.indexOf('export const invoicePredictionSchema', briefingStart);
const briefingBlank = briefingStart >= 0 ? aiServiceBlank.slice(briefingStart, briefingEnd) : '';
const briefingReal = briefingStart >= 0 ? aiServiceSrc.slice(briefingStart, briefingEnd) : '';
ok('generateHomeBriefing no longer reads totalDurationDays', briefingStart >= 0 && !briefingBlank.includes('totalDurationDays'));
ok('it calls overdueTaskCount', briefingBlank.includes('overdueTaskCount('));
ok('an undated schedule is told to the model as "no start date", with no count',
  /no start date/i.test(briefingReal) && /NOTHING on it is overdue/i.test(briefingReal));
ok('overdueTaskCount resolves the anchor through scheduleOps, not a fallback date',
  aiServiceSrc.includes("from '@/utils/scheduleOps'")
  && aiServiceBlank.slice(fnAt, fnAt + 1200).includes('resolveScheduleAnchor(')
  && aiServiceBlank.slice(fnAt, fnAt + 1200).includes('scheduleDayNumberFor('));

// ─── 2) No AI panel spends a metered call without a gesture ──────────────────
console.log('\nno AI panel spends a metered call from a mount effect:');

// A useEffect may call a spender ONLY in a form that reads the cache and stops.
const MOUNT_CACHE_ONLY: Record<string, RegExp> = {
  'components/AIHomeBriefing.tsx|fetchBriefing': /fetchBriefing\(\s*true\s*\)/,
  'components/AIScheduleRisk.tsx|loadOrAnalyze': /loadOrAnalyze\(\s*false\s*,\s*true\s*\)/,
  'components/AIInvoicePredictor.tsx|fetchPrediction': /fetchPrediction\(\s*true\s*\)/,
};

// …and the flag it passes has to actually STOP the spend. The call-site regex
// above proves only that the effect passed something: verified by mutation on
// 2026-09-07, deleting `if (cacheOnly) return;` from fetchPrediction's body put
// the metered call back on every invoice open and this suite still reported
// "0 failed". So the gate is checked where it lives — it must short-circuit
// BEFORE the meter runs.
const MOUNT_CACHE_ONLY_GATE: Record<string, string> = {
  'components/AIHomeBriefing.tsx|fetchBriefing': 'cacheOnly',
  'components/AIScheduleRisk.tsx|loadOrAnalyze': 'cacheOnly',
  'components/AIInvoicePredictor.tsx|fetchPrediction': 'cacheOnly',
};

// Panels whose mount effect still spends. Each entry is a live audit finding,
// not an exemption — delete the line when the panel is fixed.
const MOUNT_WAIVED: Record<string, string> = {
  'components/AIWeeklySummary.tsx|handleGenerate':
    'gated on `visible` — the effect fires when the GC opens Full Analysis, which IS the gesture',
};

const AI_COMPONENTS = [
  'AIAutoScheduleButton', 'AIBidScorecard', 'AIBidScorer', 'AIChangeOrderImpact',
  'AIDFRFromPhotos', 'AIDailyReportGen', 'AIEquipmentAdvice', 'AIEstimateValidator',
  'AIHomeBriefing', 'AIInvoicePredictor', 'AIProjectReport', 'AIQuickEstimate',
  'AIScheduleRisk', 'AISubEvaluator', 'AIWeeklySummary',
].map(n => `components/${n}.tsx`);

for (const rel of AI_COMPONENTS) {
  const real = src(rel);
  const b = blank(real);

  // Which local functions actually spend? (`recordAIUsage` is the meter.)
  //
  // Resolved by RANGE rather than by declaration shape. Matching only
  // `useCallback(` was a hole: dropping the wrapper — `const fetchBriefing =
  // async () => {` — emptied this set, and an effect that auto-spent then
  // produced NO assertion at all rather than a failure. Verified by mutation
  // on 2026-09-07: the suite still reported "0 failed".
  const meters = [...b.matchAll(/recordAIUsage\s*\(/g)].map(m => m.index);
  const spenders = new Set<string>();
  const spenderBody = new Map<string, [number, number]>();
  const declRe = /(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*(?:(?:React\.)?useCallback\s*\(|(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_]+)\s*=>\s*\{)|(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g;
  for (let m = declRe.exec(b); m; m = declRe.exec(b)) {
    const name = m[1] ?? m[2];
    const range = /useCallback\s*\($/.test(m[0])
      ? parenBlock(b, m.index + m[0].length - 1)
      : braceBlock(b, m.index + m[0].length - 1);
    if (!range) continue;
    if (meters.some(o => o > range[0] && o < range[1])) {
      spenders.add(name);
      spenderBody.set(name, range);
    }
  }
  // The floor that keeps the check from silently disappearing: if the file
  // meters anything, this scan has to have found the function that does it.
  ok(`${rel}: the AI spend sits in a function this check can resolve`,
    meters.length === 0 || spenders.size > 0,
    'recordAIUsage() is not inside a named const/function declaration — the mount-effect check cannot see it');

  const effectRe = /(?:React\.)?useEffect\s*\(/g;
  for (let m = effectRe.exec(b); m; m = effectRe.exec(b)) {
    const args = parenBlock(b, m.index + m[0].length - 1);
    if (!args) continue;
    effectRe.lastIndex = args[1];
    const effectReal = real.slice(args[0], args[1]);
    const effectBlank = b.slice(args[0], args[1]);
    for (const fn of spenders) {
      if (!new RegExp(`\\b${fn}\\s*\\(`).test(effectBlank)) continue;
      const key = `${rel}|${fn}`;
      if (MOUNT_WAIVED[key]) { note(`${rel}: ${fn} in a mount effect — waived (${MOUNT_WAIVED[key]})`); continue; }
      const shape = MOUNT_CACHE_ONLY[key];
      ok(`${rel}: ${fn} runs cache-only from its effect`,
        !!shape && shape.test(effectReal),
        shape ? 'the effect must pass the cache-only argument' : `no cache-only shape declared for ${key}`);

      const flag = MOUNT_CACHE_ONLY_GATE[key];
      const body = spenderBody.get(fn);
      const slice = flag && body ? b.slice(body[0], body[1]) : '';
      const gateAt = slice ? slice.search(new RegExp(`if\\s*\\(\\s*${flag}\\s*\\)\\s*return`)) : -1;
      const meterAt = slice ? slice.search(/recordAIUsage\s*\(/) : -1;
      ok(`${rel}: ${fn}'s cache-only flag returns before the meter`,
        !!flag && gateAt >= 0 && meterAt >= 0 && gateAt < meterAt,
        flag
          ? `\`if (${flag}) return\` must sit above recordAIUsage — passing the flag is not the same as honouring it`
          : `no cache-only gate declared for ${key}`);
    }
  }
}

// ─── 2b) A cap that blocks a control says so ────────────────────────────────
// `if (!limit.allowed) return;` is the same silence as an empty catch: the
// panel simply never appears and the GC cannot tell a cap from a feature that
// does not exist. showAILimitAlert is the shared sheet (it is the only thing
// that routes to /paywall); setError / setPaywallReason are what stays on the
// card after it is dismissed. Either satisfies this — a bare return does not.
console.log('\nno AI panel goes silent when a tier cap blocks it:');

const CAP_SAYS_SOMETHING = /\bsetError\s*\(|\bsetPaywallReason\s*\(|\bshowAlert\s*\(|\bshowAILimitAlert\s*\(/;

for (const rel of AI_COMPONENTS) {
  const b = blank(src(rel));
  const capRe = /if\s*\(\s*!\s*limit\.allowed\s*\)/g;
  for (let m = capRe.exec(b); m; m = capRe.exec(b)) {
    const block = braceBlock(b, m.index + m[0].length - 1);
    if (!block) continue;
    capRe.lastIndex = block[1];
    ok(`${rel}: the tier cap names itself instead of returning silently`,
      CAP_SAYS_SOMETHING.test(b.slice(block[0], block[1])),
      'a blocked control must say why — showAILimitAlert({ limit, router }) and/or setError(limit.message)');
  }
}

// ─── 2c) The one panel that legitimately auto-spends cannot loop ────────────
// AIWeeklySummary is MOUNT_WAIVED above because its effect is gated on
// `visible`, and opening Full Analysis IS the gesture. That waiver holds only
// while the effect stops after a failure: without `!error` in the condition,
// the run re-enters the instant setIsLoading(false) lands and the sheet retries
// forever, one smart-tier call per pass. And `!error` is only safe if the error
// is dropped on dismiss — Home mounts this component unconditionally and merely
// toggles `visible`, so a stale error would otherwise make the gate permanent
// and the sheet would show "Analysis didn't run" for the rest of the session.
// Both halves verified by mutation on 2026-09-07 (removing `!error` left the
// suite green before this section existed).
console.log('\nthe auto-running summary stops after a failure, and forgets it on dismiss:');
{
  const b = blank(src('components/AIWeeklySummary.tsx'));
  const effectRe = /(?:React\.)?useEffect\s*\(/g;
  let autoRun: string | null = null;
  let clearsOnDismiss = false;
  for (let m = effectRe.exec(b); m; m = effectRe.exec(b)) {
    const args = parenBlock(b, m.index + m[0].length - 1);
    if (!args) continue;
    effectRe.lastIndex = args[1];
    const body = b.slice(args[0], args[1]);
    if (/\bhandleGenerate\s*\(/.test(body) && /\bvisible\b/.test(body)) autoRun = body;
    if (/if\s*\(\s*!\s*visible\s*\)\s*setError\s*\(\s*null\s*\)/.test(body)) clearsOnDismiss = true;
  }
  ok('the auto-run effect is still findable', !!autoRun);
  ok('it does not re-enter on its own error',
    !!autoRun && /!\s*error\b/.test(autoRun),
    'a failed run with no `!error` gate retries forever, spending a smart-tier call each pass');
  ok('dismissing the sheet clears the error so reopening retries',
    clearsOnDismiss,
    'without this the `!error` gate is permanent and Full Analysis never runs again this session');
}

// ─── 3) A failed generate says what failed ──────────────────────────────────
console.log('\nevery AI catch block tells the user something:');

// Still console-only. Each is the same audit finding; delete the line when
// fixed. Empty as of 2026-09-07: every AI panel now names its own failure.
const SILENT_WAIVED: Record<string, string> = {};
const SAYS_SOMETHING = /\bsetError\s*\(|\bshowAlert\s*\(|\bshowAILimitAlert\s*\(/;

/** True for a `try { … } catch (…)`, false for a promise's `.catch(…)`. */
function isTryCatch(blanked: string, at: number): boolean {
  let i = at - 1;
  while (i >= 0 && /\s/.test(blanked[i])) i--;
  return blanked[i] === '}';
}

// Both catch forms. `/catch\s*\(/` alone was a hole: rewriting a silenced
// catch as `catch {` (the optional binding — exactly what you reach for when
// you delete the `err` you no longer use) made it invisible and the suite
// still reported "0 failed". Verified by mutation on 2026-09-07.
const CATCH_RE = /\bcatch\s*(\(|\{)/g;
/** The catch BODY block for a match of CATCH_RE, or null. */
function catchBody(blanked: string, m: RegExpMatchArray): [number, number] | null {
  const at = (m.index as number) + m[0].length - 1;
  if (m[1] === '{') return braceBlock(blanked, at);
  const args = parenBlock(blanked, at);
  return args ? braceBlock(blanked, args[1]) : null;
}

/** The `{ … }` block whose closing brace is at `close`. */
function braceBlockEndingAt(blanked: string, close: number): [number, number] | null {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (blanked[i] === '}') depth++;
    else if (blanked[i] === '{') { depth--; if (depth === 0) return [i, close + 1]; }
  }
  return null;
}

type CatchSite = { at: number; tryBody: [number, number]; body: [number, number]; speaks: boolean };

/** Every statement-level `try { … } catch { … }` in a file, in source order. */
function catchSites(blanked: string): CatchSite[] {
  const sites: CatchSite[] = [];
  const re = new RegExp(CATCH_RE.source, 'g');
  for (let m = re.exec(blanked); m; m = re.exec(blanked)) {
    const body = catchBody(blanked, m);
    if (!body) continue;
    re.lastIndex = body[1];
    if (!isTryCatch(blanked, m.index)) continue;
    let j = m.index - 1;
    while (j >= 0 && /\s/.test(blanked[j])) j--;
    const tryBody = braceBlockEndingAt(blanked, j);
    if (!tryBody) continue;
    sites.push({ at: m.index, tryBody, body, speaks: SAYS_SOMETHING.test(blanked.slice(body[0], body[1])) });
  }
  return sites;
}

// A catch nested inside an OUTER try whose own catch speaks is already
// covered: the outer handler is what the user sees. The real instance is
// AIBidScorecard's comment-only catch around a fire-and-forget
// recordPrediction() — the scoring failure it sits inside sets an error
// message two lines below. Without this, the honest rule would need a by-name
// waiver on a file that has nothing wrong with it.
function coveredByOuter(sites: CatchSite[], site: CatchSite): boolean {
  return sites.some(o => o !== site && o.speaks && site.at > o.tryBody[0] && site.at < o.tryBody[1]);
}

for (const rel of AI_COMPONENTS) {
  const sites = catchSites(blank(src(rel)));
  sites.forEach((site, i) => {
    if (site.speaks || coveredByOuter(sites, site)) {
      ok(`${rel} catch #${i + 1} surfaces the failure`, true);
      return;
    }
    if (SILENT_WAIVED[rel]) {
      note(`${rel} catch #${i + 1} is silent — waived (${SILENT_WAIVED[rel]})`);
      return;
    }
    ok(`${rel} catch #${i + 1} surfaces the failure`, false,
      'add setError(...) or showAlert(...) — a console.log is not a user-visible failure');
  });
}
for (const [rel, why] of Object.entries(SILENT_WAIVED)) {
  const sites = catchSites(blank(src(rel)));
  if (sites.every(s => s.speaks || coveredByOuter(sites, s))) {
    note(`WAIVER NO LONGER NEEDED: ${rel} now surfaces every failure — drop it from SILENT_WAIVED (${why})`);
  }
}

// ─── 4) The sub evaluator prints no invented wage rates ─────────────────────
console.log('\nthe sub evaluator quotes the GC\'s own rate or no rate at all:');
const subSchemaStart = aiServiceBlank.indexOf('export const subEvaluationSchema');
const subFnEnd = aiServiceBlank.indexOf('export const equipmentAdviceSchema', subSchemaStart);
const subBlank = subSchemaStart >= 0 ? aiServiceBlank.slice(subSchemaStart, subFnEnd) : '';
const subReal = subSchemaStart >= 0 ? aiServiceSrc.slice(subSchemaStart, subFnEnd) : '';
ok('subEvaluationSchema carries no typicalRates field', subSchemaStart >= 0 && !subBlank.includes('typicalRates'));
ok('no journeyman/master/apprentice wage fields', !/journeyman|apprentice/i.test(subBlank));
ok('the prompt no longer asks for "typical rates for their trade"', !/typical rates/i.test(subReal));
ok('the prompt forbids dollar figures outright', /Do NOT state wage rates/i.test(subReal));

const subEvalBlank = blank(src('components/AISubEvaluator.tsx'));
const subEvalReal = src('components/AISubEvaluator.tsx');
ok('AISubEvaluator renders no model-supplied rate grid', !subEvalBlank.includes('typicalRates'));
ok('it reads the GC\'s own configured rate for the trade',
  subEvalBlank.includes('useLaborRates(') && subEvalBlank.includes('normalizeTradeKey('));
ok('with no rate set it says so rather than showing a number',
  /MAGE won&apos;t invent one|MAGE won't invent one/.test(subEvalReal));

// ─── 5) No AI panel bakes a light-theme colour into its stylesheet ──────────
// `Colors.surface` / `Colors.text` and friends are theme-aware GETTERS, but a
// module-scope StyleSheet.create() reads them once at import — so the sheet
// keeps whatever theme was current when the bundle loaded. AIBidScorer's
// profile sheet did exactly that while theming its own container inline, so in
// dark mode it painted near-black ink on a dark ground (audit 2026-09-07,
// polish-delight). The fix is the useThemedStyles factory every other AI panel
// already uses.
console.log('\nno AI panel bakes theme colours into a module-scope stylesheet:');

const BAKED_WAIVED: Record<string, string> = {
  'components/AIQuickEstimate.tsx':
    'audit 2026-09-07 polish-delight: one of the 24 baked stylesheets; file not owned by wave F',
};
const THEME_GETTER = /\bColors\.(surface|surfaceAlt|surfaceElevated|text|textSecondary|textMuted|background|border|borderLight|card|fill|fillSecondary)\b/;

for (const rel of AI_COMPONENTS) {
  const b = blank(src(rel));
  const createRe = /StyleSheet\.create\s*\(/g;
  for (let m = createRe.exec(b); m; m = createRe.exec(b)) {
    const body = braceBlock(b, m.index + m[0].length - 1);
    if (!body) continue;
    createRe.lastIndex = body[1];
    // A factory (`(t: ThemeColors) => StyleSheet.create({…})`) re-runs per
    // theme, so only a bare module-scope call is a problem.
    const isFactory = /=>\s*$/.test(b.slice(Math.max(0, m.index - 40), m.index).trimEnd() + ' ')
      || /=>\s*StyleSheet\.create\s*\($/.test(b.slice(Math.max(0, m.index - 40), m.index + m[0].length));
    if (isFactory) continue;
    const bad = THEME_GETTER.test(b.slice(body[0], body[1]));
    if (BAKED_WAIVED[rel] && bad) { note(`${rel} bakes theme colours — waived (${BAKED_WAIVED[rel]})`); continue; }
    ok(`${rel} module-scope stylesheet holds no theme-aware colour`, !bad,
      'move it into a (t: ThemeColors) => StyleSheet.create factory and read it through useThemedStyles');
  }
}

// ─── 6) A themed stylesheet uses themed grounds ─────────────────────────────
// The mirror image of (5), and the way the fix for (3) first shipped. The
// `*Light` tints (`Colors.errorLight` #FFF0EF and friends) are STATIC
// light-theme values; the label inks beside them (`Colors.dangerLabel`,
// `t.dangerLabel`) are theme-aware. Inside a `(t) => StyleSheet.create`
// factory the ink flips to its dark value and the ground does not, so the new
// AI failure rows drew #FF5A51 on pale pink at 2.78:1 — below AA, on the one
// row whose whole job is to be read. The theme carries the matching pair
// (`dangerSoft`/`dangerLabel`, `successSoft`/`successLabel`, …), measured in
// constants/colors.ts at 4.7–7.4:1 in both themes.
console.log('\nno themed AI stylesheet paints on a baked light-theme tint:');

const BAKED_TINT = /\bColors\.(errorLight|successLight|warningLight|infoLight)\b/;

// Empty as of 2026-09-07. AIQuickEstimate.tsx was waived here for one review
// cycle on the grounds that another wave owned it — it did not; the file was in
// the same wave that turned its module-scope sheet into a `(t) =>` factory and
// so created the regression. Four grounds now use the *Soft tokens.
const TINT_WAIVED: Record<string, string> = {};

for (const rel of AI_COMPONENTS) {
  const b = blank(src(rel));
  const createRe = /StyleSheet\.create\s*\(/g;
  for (let m = createRe.exec(b); m; m = createRe.exec(b)) {
    const body = braceBlock(b, m.index + m[0].length - 1);
    if (!body) continue;
    createRe.lastIndex = body[1];
    // Only THEMED sheets: a module-scope sheet bakes everything together and
    // is section 5's problem, not this one.
    const isFactory = /=>\s*$/.test(b.slice(Math.max(0, m.index - 40), m.index).trimEnd() + ' ')
      || /=>\s*StyleSheet\.create\s*\($/.test(b.slice(Math.max(0, m.index - 40), m.index + m[0].length));
    if (!isFactory) continue;
    const bad = BAKED_TINT.test(b.slice(body[0], body[1]));
    if (TINT_WAIVED[rel]) {
      if (bad) note(`${rel} paints on a baked tint — waived (${TINT_WAIVED[rel]})`);
      else note(`WAIVER NO LONGER NEEDED: ${rel} uses themed grounds — drop it from TINT_WAIVED`);
      continue;
    }
    ok(`${rel} themed stylesheet uses themed grounds`, !bad,
      'swap the static *Light tint for the theme pair (t.dangerSoft/t.dangerLabel, t.successSoft/t.successLabel)');
  }
}

// ─── 7) No fabricated supplier, store or benchmark reaches a rendered field ──
// The same defect shape as (1), one layer down: not a number the app computed
// wrong, but a number or a NAME the model was invited to make up and the UI
// then printed as fact. The supplier case is the worst of them because it does
// not stop at the screen — `supplier` rides the row into the cart, the estimate
// line items (app/(tabs)/estimate/review.tsx:185) and out onto the bid PDF the
// GC signs, so the client reads a store nobody ever called
// (audit 2026-09-07, money-trust).
console.log('\nno invented supplier, store or dollar benchmark is rendered as fact:');

const finder = src('utils/materialFinder.ts');
const finderBlank = blank(finder);
// The prompt lives in a template literal, which `blank` erases — so this one
// assertion reads the REAL text, sliced to the literal so the file's own
// comments (which quote the removed clause verbatim) cannot satisfy it.
const promptOpen = finder.indexOf('prompt: `');
const promptClose = finder.indexOf('`,', promptOpen);
const finderPrompt = promptOpen >= 0 && promptClose > promptOpen ? finder.slice(promptOpen, promptClose) : '';
ok('findMaterials still has a prompt this check can read', finderPrompt.length > 200);
ok('the prompt names no store or price book',
  !/home ?depot|lowe'?s|menards|ace hardware|rsmeans|grainger|ferguson/i.test(finderPrompt),
  'a named supplier in the prompt becomes a named supplier on the bid PDF');
ok('the false "access to current US construction supply pricing" premise is gone',
  !/access to current/i.test(finderPrompt));
ok('the prompt tells the model it has no feed and forbids naming one',
  /NO price feed/i.test(finderPrompt) && /Do not name a store/i.test(finderPrompt));
ok('the schema has no model-filled priceSource field',
  !/priceSource\s*:\s*z\./.test(finderBlank),
  'a field the model fills is a field the model can put a store name in');
ok('priceSource is stamped from a constant instead',
  /priceSource:\s*AI_PRICE_SOURCE/.test(finderBlank) && /AI_PRICE_SOURCE\s*=/.test(finderBlank));
ok('the two dead fabrication functions are gone with it',
  !finderBlank.includes('getPriceComparison')
  && !finderBlank.includes('suggestMaterialsForPhase')
  && !/homeDepotPrice|lowesPrice|rsmeansPrice/.test(finderBlank),
  'getPriceComparison / suggestMaterialsForPhase fabricated named-source pricing and had zero callers');

// Every screen that turns an AI material into a cart row. A model-supplied
// value in `supplier` is the defect; a constant is the fix.
// Empty as of 2026-09-07. AIQuickEstimate.tsx was waived here for one review
// cycle as "not owned by wave 5" — it was in fact in scope, and the waiver left
// the headline defect live on the second of the two paths to the bid PDF:
// `aiQuickEstimateSchema.supplier` DEFAULTS to 'Home Depot'
// (utils/aiService.ts:1113), so the store reached the cart even when the model
// said nothing at all.
const SUPPLIER_WAIVED: Record<string, string> = {};
// `aiMat` is the AI material row in both screens. Deliberately NOT a looser
// pattern: full.tsx:998 legitimately carries an already-set `item.material.
// supplier` into a linked estimate, and flagging that would train the next
// reader to widen the waiver list instead of fixing the defect.
for (const rel of ['app/(tabs)/estimate/full.tsx', 'components/AIQuickEstimate.tsx']) {
  const b = blank(src(rel));
  const bad = /supplier:\s*aiMat\./.test(b);
  if (SUPPLIER_WAIVED[rel]) {
    if (bad) note(`${rel} reads a model value into supplier — waived (${SUPPLIER_WAIVED[rel]})`);
    else note(`WAIVER NO LONGER NEEDED: ${rel} sets a constant supplier — drop it from SUPPLIER_WAIVED`);
    continue;
  }
  ok(`${rel}: supplier is a constant, never a model value`, !bad,
    "set supplier to a literal and let sourceLabel carry the provenance");
}
ok('the estimator sets the constant it should', /supplier: 'AI estimate'/.test(src('app/(tabs)/estimate/full.tsx')));
ok('… and so does Quick Estimate', /supplier: 'AI estimate'/.test(src('components/AIQuickEstimate.tsx')));

// Stopping it at the cart is not enough: the Quick Estimate result list printed
// `{m.supplier}` straight off the parsed response, one line under each material
// name, so the GC read "Home Depot" on screen before anything was applied. A
// rendered field is a claim.
const qeReal = src('components/AIQuickEstimate.tsx');
ok('no AI material row RENDERS a model-supplied supplier',
  !/\{\s*m\.supplier\s*\}/.test(qeReal) && !/\{\s*aiMat\.supplier\s*\}/.test(qeReal),
  'the row shows the unit price instead — a figure the estimate is actually built from');
// mageAI has no browsing tool, no cost book and no supplier feed, so "based on
// current market data" is the same false premise findMaterials' prompt shed.
ok('the Quick Estimate disclaimer claims no market feed',
  !/current market data/i.test(qeReal) && /recall, not a quote or a market feed/.test(qeReal));

// The rent-vs-buy panel restated arithmetic the prompt had already handed it
// (so the tile could disagree with its own basis), priced a machine it has no
// catalog for, and rendered `breakEvenProjects`' zero default as
// "0+ projects/yr".
const equipReal = src('components/AIEquipmentAdvice.tsx');
const equipBlank = blank(equipReal);
ok('the rent-vs-buy tiles render no model-supplied dollar figure',
  !/result\.annualRentalCost/.test(equipBlank)
  && !/result\.purchasePrice/.test(equipBlank)
  && !/result\.breakEvenProjects/.test(equipBlank));
ok('they read the measured utilization log instead',
  /measuredUsage\(/.test(equipBlank) && /usage\.costAtDayRate/.test(equipBlank) && /usage\.daysUsed/.test(equipBlank));
ok('the run is blocked, not floored, when the log cannot answer',
  /if \(isLoading \|\| !usage\.ok\) return;/.test(equipBlank) && /styles\.blockedText/.test(equipBlank));
// The tile prints the NAMED job count. `jobs` below floors at 1 for the model
// only, because a machine with logged hours ran on at least one job — the tile
// must not repeat that lower bound as if it were a measurement.
ok('the job tile prints "Not logged" rather than the model\'s lower bound',
  /usage\.jobsNamed \? usage\.projects : 'Not logged'/.test(equipReal));
ok('the money tile is labelled by ownership — an owner is never told they paid rent',
  /equipment\.type === 'rented' \? 'Rent paid' : 'At your day rate'/.test(equipReal));

// ─── 7b) measuredUsage, RUN ─────────────────────────────────────────────────
// Regexes police the SPELLING of a floor; the defect is its SHAPE. Verified by
// mutation on 2026-09-07: `Math.max(uniqueProjects, 2)` was replaced by
// `Math.max(projects, 1)` inside measuredUsage and the assertion that claimed
// to forbid floors — `!/Math\.max\(uniqueProjects/` — stayed green. So the
// shipped function is lifted and executed, the same way (1) and (8) do it.
console.log('\nthe rent-vs-buy panel measures the log or refuses, and never fills a gap:');

const usageAt = equipBlank.indexOf('function measuredUsage(');
const usageBlock = usageAt >= 0 ? braceBlock(equipBlank, usageAt) : null;
ok('components/AIEquipmentAdvice.tsx still declares measuredUsage', usageAt >= 0 && !!usageBlock);

type UtilFixture = { projectId: string; date: string; hoursUsed: number };
type EquipFixture = { type: string; dailyRate: number; utilizationLog: UtilFixture[] };
type UsageOut =
  | { ok: true; projects: number; jobsNamed: boolean; daysUsed: number; spanDays: number; costAtDayRate: number }
  | { ok: false; reason: string };

let measuredUsage: ((e: EquipFixture) => UsageOut) | null = null;
if (usageAt >= 0 && usageBlock) {
  // The reason sentences are string literals, which `blank` erases — so the
  // REAL source is sliced at offsets taken from the blanked copy.
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    `${equipReal.slice(usageAt, usageBlock[1])}\nmodule.exports = { measuredUsage };`,
  );
  const mod: { exports: Record<string, unknown> } = { exports: {} };
  new Function('module', 'exports', 'parseCalendarDay', js)(mod, mod.exports, parseCalendarDay);
  measuredUsage = mod.exports.measuredUsage as (e: EquipFixture) => UsageOut;
}

const entry = (projectId: string, date: string, hoursUsed: number): UtilFixture => ({ projectId, date, hoursUsed });
const rented = (log: UtilFixture[], dailyRate = 350): EquipFixture => ({ type: 'rented', dailyRate, utilizationLog: log });
const owned = (log: UtilFixture[], dailyRate = 350): EquipFixture => ({ type: 'owned', dailyRate, utilizationLog: log });

const empty = measuredUsage?.(rented([]));
ok('an empty log refuses instead of answering', empty?.ok === false);
ok('… and the refusal says what is missing and what it turns on',
  empty?.ok === false && /Log some usage/.test(empty.reason) && /won't guess them/.test(empty.reason));
// An owner told to "keep renting" a machine they own is the same class of
// defect as copy pointing at a control that does not exist. 'owned' is the
// default the add form starts on (app/(tabs)/equipment/index.tsx:70).
ok('the refusal is written for THIS machine — an owner is not told to keep renting',
  measuredUsage?.(owned([])).ok === false
  && /owning it still pays/.test((measuredUsage?.(owned([])) as { reason: string }).reason)
  && !/keep renting/.test((measuredUsage?.(owned([])) as { reason: string }).reason));

// The add form takes `parseFloat(newDailyRate) || 0`, so a machine with no rate
// is ordinary. Pricing 12 logged days at $0 and printing "$0" as a measured
// figure is a fabricated number wearing a measurement's clothes.
const noRate = measuredUsage?.(rented([entry('p1', '2026-08-01', 96)], 0));
ok('a $0 day rate refuses rather than pricing the log at zero', noRate?.ok === false);
ok('… and it names the field that fixes it',
  noRate?.ok === false && /Daily Rate/.test(noRate.reason));

const twoJobs = measuredUsage?.(rented([
  entry('p1', '2026-08-01', 8),
  entry('p1', '2026-08-05', 8),
  entry('p2', '2026-08-10', 16),
]));
ok('days are hours ÷ 8 over the whole log', twoJobs?.ok === true && twoJobs.daysUsed === 4);
ok('cost is those days at the GC\'s own rate, nothing else',
  twoJobs?.ok === true && twoJobs.costAtDayRate === 4 * 350);
ok('the calendar window is first entry to last, inclusive',
  twoJobs?.ok === true && twoJobs.spanDays === 10);
ok('distinct named jobs are counted', twoJobs?.ok === true && twoJobs.projects === 2 && twoJobs.jobsNamed);

// The Log Usage sheet has NO project picker (app/equipment-detail.tsx:299) —
// it stamps `editProjectId || ''` — so an unassigned machine records every
// entry with an empty projectId. That is 0 known jobs, and 0 is what has to
// come back: a floor here is how "Projects: 1" got printed for a machine MAGE
// had never seen on a job.
const unnamed = measuredUsage?.(rented([entry('', '2026-08-01', 40), entry('', '2026-08-09', 40)]));
ok('an unassigned machine reports 0 known jobs, NOT a floor of 1',
  unnamed?.ok === true && unnamed.projects === 0 && unnamed.jobsNamed === false);
ok('… while its days and cost are still real',
  unnamed?.ok === true && unnamed.daysUsed === 10 && unnamed.costAtDayRate === 3500);
ok('a log of zero-hour entries refuses too — there is nothing to measure',
  measuredUsage?.(rented([entry('p1', '2026-08-01', 0)])).ok === false);
ok('an unparseable date does not poison the window',
  measuredUsage?.(rented([entry('p1', 'not-a-date', 8)]))?.ok === true);

// The invoice predictor averaged EVERY paid invoice in the account and handed
// the scalar to the relay under the heading "CLIENT HISTORY".
const predBlank = blank(src('components/AIInvoicePredictor.tsx'));
ok('the invoice predictor scopes payment history to this invoice\'s own project',
  /paymentHistoryForInvoice\(invoice,\s*allInvoices\)/.test(predBlank)
  && !/allInvoices\.filter\(/.test(predBlank),
  'the per-project filter lives in utils/paymentPrediction.ts — do not re-derive it here');
ok('the chip and the payload read the SAME history object',
  /totalInvoices: history\.paidInvoices/.test(predBlank) && /history\.summary/.test(predBlank),
  'a chip computed separately from the payload can claim a record the prompt never saw');

// ─── 8) The per-project payment history, RUN ────────────────────────────────
// Same technique as (1): utils/paymentPrediction.ts cannot be imported here
// (mageAI pulls react-native), so the shipped function is lifted out verbatim,
// transpiled and executed. An edit to it changes what these fixtures return.
console.log('\npayment history is this project\'s record, and says so when there is none:');

const ppSrc = src('utils/paymentPrediction.ts');
const ppBlank = blank(ppSrc);
const histAt = ppBlank.indexOf('export function paymentHistoryForInvoice(');
const daysAt = ppBlank.indexOf('function daysBetween(');
ok('utils/paymentPrediction.ts still exports paymentHistoryForInvoice', histAt >= 0 && daysAt >= 0);

type InvFixture = {
  id: string; projectId: string; status: string; dueDate: string;
  payments: { date: string }[];
};
type HistFn = (inv: InvFixture, all: InvFixture[]) =>
  { paidInvoices: number; avgDaysLate: number | null; summary: string };

let paymentHistoryForInvoice: HistFn | null = null;
if (histAt >= 0 && daysAt >= 0) {
  const histBlock = braceBlock(ppBlank, histAt);
  const daysBlock = braceBlock(ppBlank, daysAt);
  // `export` is stripped: the lifted text is fed to `new Function`, which is
  // script scope, not a module.
  const body = `${ppSrc.slice(daysAt, daysBlock?.[1] ?? daysAt)}\n${ppSrc.slice(histAt, histBlock?.[1] ?? histAt)}`
    .replace(/^export\s+/gm, '');
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    `${body}\nmodule.exports = { paymentHistoryForInvoice };`,
  );
  const mod: { exports: Record<string, unknown> } = { exports: {} };
  new Function('module', 'exports', js)(mod, mod.exports);
  paymentHistoryForInvoice = mod.exports.paymentHistoryForInvoice as HistFn;
}

const inv = (id: string, projectId: string, over: Partial<InvFixture> = {}): InvFixture =>
  ({ id, projectId, status: 'paid', dueDate: '2026-08-01', payments: [{ date: '2026-08-01' }], ...over });

const target = inv('target', 'p1', { status: 'sent', payments: [] });
// p1 is the job being invoiced; p2 is a different client who pays on time.
const book = [
  target,
  inv('a', 'p1', { dueDate: '2026-06-01', payments: [{ date: '2026-06-21' }] }), // 20 days late
  inv('b', 'p1', { dueDate: '2026-07-01', payments: [{ date: '2026-07-11' }] }), // 10 days late
  inv('c', 'p2', { dueDate: '2026-07-01', payments: [{ date: '2026-07-01' }] }), // another client, on time
  inv('d', 'p2', { dueDate: '2026-07-01', payments: [{ date: '2026-07-01' }] }),
  inv('e', 'p1', { status: 'sent', payments: [] }),                              // unpaid, proves nothing
  inv('f', 'p1', { status: 'paid', payments: [] }),                              // paid flag, no payment row
];
ok('only this project\'s prior PAID invoices count — the other client is not averaged in',
  paymentHistoryForInvoice?.(target, book).paidInvoices === 2,
  `got ${String(paymentHistoryForInvoice?.(target, book).paidInvoices)}`);
ok('the average is 15 days late, not the 7.5 the whole-account average gave',
  paymentHistoryForInvoice?.(target, book).avgDaysLate === 15,
  `got ${String(paymentHistoryForInvoice?.(target, book).avgDaysLate)}`);
ok('the summary quotes that count and that number',
  /2 prior paid invoices on this project/.test(paymentHistoryForInvoice?.(target, book).summary ?? '')
  && /15 days past the due date/.test(paymentHistoryForInvoice?.(target, book).summary ?? ''));
ok('the invoice never counts itself',
  paymentHistoryForInvoice?.(
    inv('self', 'p1', { dueDate: '2026-06-01', payments: [{ date: '2026-06-21' }] }),
    [inv('self', 'p1', { dueDate: '2026-06-01', payments: [{ date: '2026-06-21' }] })],
  ).paidInvoices === 0);
ok('no record ⇒ avgDaysLate is null, NOT 0 — "never been paid" is not "always on time"',
  paymentHistoryForInvoice?.(target, [target, inv('c', 'p2')]).avgDaysLate === null);
ok('… and the sentence carries no number at all',
  /No prior paid invoices on this project/.test(paymentHistoryForInvoice?.(target, [target]).summary ?? '')
  && !/\d/.test(paymentHistoryForInvoice?.(target, [target]).summary ?? ''));
ok('early payment is not negative lateness — it floors at 0 and reads as on time',
  (() => {
    const early = [target, inv('a', 'p1', { dueDate: '2026-07-01', payments: [{ date: '2026-06-20' }] })];
    const h = paymentHistoryForInvoice?.(target, early);
    return h?.avgDaysLate === 0 && /all paid by the due date/.test(h.summary);
  })());
ok('singular reads "1 prior paid invoice"',
  /1 prior paid invoice on this project/.test(
    paymentHistoryForInvoice?.(target, [target, inv('a', 'p1', { dueDate: '2026-07-01', payments: [{ date: '2026-07-02' }] })]).summary ?? '',
  ));

// ─── 9) The DFR haptics shim is not a component ─────────────────────────────
// `Platform_isMobile` in AIDFRFromPhotos is called from event handlers. The
// theme migration dropped a useTheme() + useThemedStyles() pair into it along
// with every real component's, so `useMemo` ran with a null dispatcher: every
// photo tap and every Generate press threw "Invalid hook call" BEFORE reaching
// the try/catch this file's error copy sits in (found 2026-09-07 while fixing
// that catch — the silent failure was hiding a hard throw).
console.log('\nthe DFR haptics shim calls no hooks:');
const dfrBlank = blank(src('components/AIDFRFromPhotos.tsx'));
const shimAt = dfrBlank.indexOf('function Platform_isMobile(');
const shimBody = shimAt >= 0 ? braceBlock(dfrBlank, shimAt) : null;
ok('the shim is still there to check', shimAt >= 0 && !!shimBody);
ok('its body calls nothing that looks like a hook',
  !!shimBody && !/\buse[A-Z]/.test(dfrBlank.slice(shimBody[0], shimBody[1])),
  'a hook called outside render throws — this function runs from onPress');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
