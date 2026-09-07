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
};

// Panels whose mount effect still spends. Each entry is a live audit finding,
// not an exemption — delete the line when the panel is fixed.
const MOUNT_WAIVED: Record<string, string> = {
  'components/AIInvoicePredictor.tsx|fetchPrediction':
    'audit 2026-09-07 ai-features: auto-runs on every unpaid invoice open; fix is the tap-to-run pattern (file not owned by wave F)',
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
  const declRe = /(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*(?:(?:React\.)?useCallback\s*\(|(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_]+)\s*=>\s*\{)|(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g;
  for (let m = declRe.exec(b); m; m = declRe.exec(b)) {
    const name = m[1] ?? m[2];
    const range = /useCallback\s*\($/.test(m[0])
      ? parenBlock(b, m.index + m[0].length - 1)
      : braceBlock(b, m.index + m[0].length - 1);
    if (!range) continue;
    if (meters.some(o => o > range[0] && o < range[1])) spenders.add(name);
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
    }
  }
}

// ─── 3) A failed generate says what failed ──────────────────────────────────
console.log('\nevery AI catch block tells the user something:');

// Still console-only. Each is the same audit finding; delete the line when fixed.
const SILENT_WAIVED: Record<string, string> = {
  'components/AIDFRFromPhotos.tsx': 'audit 2026-09-07 ai-features: silent catch at the photo-DFR generate (file not owned by wave F)',
  'components/AIInvoicePredictor.tsx': 'audit 2026-09-07 ai-features: auto-run card renders nothing on failure (file not owned by wave F)',
  'components/AIWeeklySummary.tsx': 'audit 2026-09-07 ai-features: silent catch on Full Analysis (file not owned by wave F)',
};
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

// Same finding, in a file wave F does not own. Delete the line when it moves.
const TINT_WAIVED: Record<string, string> = {
  'components/AIInvoicePredictor.tsx':
    'audit 2026-09-07 polish-delight: tipRow paints t.info ink on the static Colors.infoLight; fix is t.info over a themed ground (file not owned by wave F)',
};

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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
