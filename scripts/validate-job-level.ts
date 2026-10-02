// validate-job-level.ts — the Level as a project-health instrument (ideas-1, T5).
//
// The Level never shows a reading it cannot back. This holds:
//   A. THE READING TABLE (utils/jobLevel computeJobLevel): drift comes only
//      from a known slip against the baseline (0 → 0 "On plan", 3 → 0.3,
//      25 → 1, ahead → 0, no baseline → no drift and it says so, overdue
//      counts never drift); tint only from margin risk; neither half →
//      'no_data' "Not enough data yet"; one half → 'partial' with the missing
//      half named; subs-only margin says so; the key is stable for equal
//      readings and moves when the drawn reading moves; the copy keeps
//      docs/VOICE.md (sentence case, no "!", no he/his, no developer words).
//   B. THE HEALTH COLUMN BUDGET: with the optional column shown at its
//      hideBelow, Job keeps its 160 px at EVERY table width (the same sweep
//      validate-portfolio-row runs over the spec columns).
//   A+. SITE COUNTS: open punch and RFIs past due are LISTED (singular /
//      plural) after both halves and never move the key, offset, tint, kind or
//      label; zero / negative / NaN add nothing; no data stays no data.
//   A++. THE HUB READING (jobLevelFromPulse): role loading → 'loading'; no
//      money → 'no_access'; streams not read → 'loading'; else the pulse's
//      own risk through marginForLevel; never a 'reading' without a slip.
//   A+++. THE LEGEND: four one-sentence lines; the colour line names no colour
//      word (the accent follows the company's theme preset).
//   C. SOURCE RULES: JobLevel draws with The Level's own geometry + palette and
//      imports nothing else from components/loaders; it eases once on the
//      native driver, jumps under Reduce Motion, never loops; no hex; the tap
//      opens the reason; PortfolioTable's showLevel defaults off and mounts
//      the Level's hooks only when on; the hook reads the same seven cost
//      streams and the same readiness as the Margin risk screen. The sheet
//      renders the legend through t(); the hub card (ProjectLevelCard) draws
//      JobLevel from buildPortfolioRows + jobLevelFromPulse and renders for no
//      data; ProjectHero keeps no second bubble; the hub mounts the card twice
//      with its one pulse.
//
// Mutation testing: JOB_LEVEL_ROOT points every read (and the engine import)
// at a scratch mirror, so a planted defect can be proved red without touching
// the tree.
//
// Run via: bun run scripts/validate-job-level.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  PORTFOLIO_COLUMN_WIDTHS as W, PORTFOLIO_HIDE_BELOW as HIDE, PORTFOLIO_ROW_CHROME,
  type PortfolioSchedule,
} from '../utils/portfolio/portfolioRow';
import { visibleColumnKeys } from '../utils/dataTable';
import { SIDEBAR_FULL, SIDEBAR_RAIL, ACTION_RAIL_MIN_WIDTH } from '../utils/sidebarRail';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = process.env.JOB_LEVEL_ROOT ?? REPO;
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const E = (await import(join(ROOT, 'utils', 'jobLevel.ts'))) as typeof import('../utils/jobLevel');
type Margin = import('../utils/jobLevel').JobLevelMargin;
type Reading = import('../utils/jobLevel').JobLevelReading;

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

const sched = (slipDays: number | null, overdueCount = 0, status: PortfolioSchedule['status'] = 'on_track'): PortfolioSchedule =>
  ({ status, slipDays, overdueCount });
const margin = (band: Margin['band'], over: Partial<Margin> = {}): Margin => ({
  hasBasis: true, band, score: 40, costBasis: 'all_sources',
  topFactors: [{ label: 'Thin bid margin', detail: 'Bid at 8.0% margin' }], ...over,
});
const lvl = (s: PortfolioSchedule | 'undated' | null, m: Margin | null, withheld?: 'loading' | 'no_access') =>
  E.computeJobLevel({ schedule: s, margin: m, ...(withheld ? { marginWithheld: withheld } : {}) });
const all = (r: Reading) => [r.label, r.accessibilityLabel, ...r.reasons].join('\n');

// ── A. The reading table ────────────────────────────────────────────────────
console.log('A. the reading table:');
{
  ok('SLIP_FULL_SCALE_DAYS is 10', E.SLIP_FULL_SCALE_DAYS === 10);
  const r0 = lvl(sched(0), margin('low'));
  ok('slip 0 → offset 0, "On plan", a full reading', r0.offset === 0 && r0.kind === 'reading' && r0.label.startsWith('On plan') && r0.hasSchedule, JSON.stringify(r0));
  ok('slip 3 → offset 0.3', near(lvl(sched(3), margin('low')).offset, 0.3), String(lvl(sched(3), margin('low')).offset));
  ok('slip 10 → offset 1', near(lvl(sched(10), null).offset, 1));
  ok('slip 25 → offset 1 (clamped)', near(lvl(sched(25), margin('low')).offset, 1));
  const ahead = lvl(sched(-4), margin('low'));
  ok('ahead (−4) → offset 0, no credit, still "On plan" and says ahead', ahead.offset === 0 && ahead.label.startsWith('On plan')
    && ahead.reasons.some((x) => /4 working days ahead of the baseline finish/.test(x)), JSON.stringify(ahead.reasons));
  const six = lvl(sched(6, 0, 'late'), margin('elevated'));
  ok('slip 6 reason: "6 working days behind the baseline finish."', six.reasons.includes('6 working days behind the baseline finish.'), JSON.stringify(six.reasons));
  ok('slip 6 + elevated reads "Schedule: 6 working days behind. Margin risk: elevated."',
    six.accessibilityLabel === 'Schedule: 6 working days behind. Margin risk: elevated.', six.accessibilityLabel);
  ok('slip 1 is singular ("1 working day behind")', lvl(sched(1), null).reasons[0] === '1 working day behind the baseline finish.');
  ok('behind drifts right (offset > 0)', lvl(sched(5), null).offset > 0);
  let inRange = true;
  for (let s = -50; s <= 50; s++) {
    const o = lvl(sched(s), null).offset;
    if (!(o >= -1 && o <= 1) || (s <= 0 && o !== 0)) inRange = false;
  }
  ok('offset stays in [−1, 1] and is 0 for every slip ≤ 0 (−50…50)', inRange);
  ok('a non-finite slip is no reading', !lvl(sched(Number.NaN), null).hasSchedule);

  const noBase = lvl(sched(null, 5, 'late'), margin('low'));
  ok('slipDays null → no drift, no schedule half, "No baseline yet" reason',
    noBase.offset === 0 && !noBase.hasSchedule && noBase.reasons.includes(E.NO_BASELINE_REASON), JSON.stringify(noBase));
  ok('…overdue tasks are said but never drift, and never "On plan"',
    noBase.reasons.includes('5 tasks are past their deadline.') && !/On plan/.test(all(noBase)));
  ok('1 overdue task is singular', lvl(sched(null, 1, 'late'), null).reasons.includes('1 task is past its deadline.'));
  ok('undated → no drift, the no-start-date reason', !lvl('undated', null).hasSchedule && lvl('undated', margin('low')).reasons.includes(E.UNDATED_REASON));
  ok('no schedule → no drift, the no-schedule reason', lvl(null, margin('low')).reasons.includes(E.NO_SCHEDULE_REASON));

  ok('band low → steady', lvl(sched(0), margin('low')).tint === 'steady');
  ok('band moderate → watch', lvl(sched(0), margin('moderate')).tint === 'watch');
  ok('band elevated → risk', lvl(sched(0), margin('elevated')).tint === 'risk');
  ok('band high → risk', lvl(sched(0), margin('high')).tint === 'risk');
  const noBasis = lvl(sched(2), margin('high', { hasBasis: false }));
  ok('margin hasBasis false → tint none, partial, the margin reason (never a band)',
    noBasis.tint === 'none' && noBasis.kind === 'partial' && noBasis.reasons.includes(E.NO_MARGIN_REASON) && !/Margin risk: high/.test(all(noBasis)), JSON.stringify(noBasis));
  ok('margin null → tint none + the margin reason', lvl(sched(2), null).tint === 'none' && lvl(sched(2), null).reasons.includes(E.NO_MARGIN_REASON));

  const none = lvl(null, null);
  ok('both missing → no_data, "Not enough data yet"', none.kind === 'no_data' && none.label === E.NOT_ENOUGH_DATA && none.label === 'Not enough data yet');
  ok('…and nothing in it says "On plan" or a band', !/On plan|Margin risk:/.test(all(none)));
  ok('no baseline + no margin basis → no_data', lvl(sched(null), margin('low', { hasBasis: false })).kind === 'no_data');
  const schedOnly = lvl(sched(4), null);
  ok('schedule only → partial, names the missing margin', schedOnly.kind === 'partial' && /No margin reading/.test(schedOnly.label) && schedOnly.reasons.includes(E.NO_MARGIN_REASON));
  const marginOnly = lvl(sched(null), margin('moderate'));
  ok('margin only → partial, names the missing slip, never "On plan"', marginOnly.kind === 'partial' && /No slip reading/.test(marginOnly.label)
    && marginOnly.reasons.includes(E.NO_BASELINE_REASON) && !/On plan/.test(all(marginOnly)), marginOnly.label);

  ok('subs-only cost basis → the subs-only reason', lvl(sched(0), margin('low', { costBasis: 'subs_only' })).reasons.includes(E.SUBS_ONLY_REASON));
  ok('absent cost basis reads as subs-only', lvl(sched(0), margin('low', { costBasis: undefined })).reasons.includes(E.SUBS_ONLY_REASON));
  ok('all-sources basis → no subs-only reason', !lvl(sched(0), margin('low')).reasons.includes(E.SUBS_ONLY_REASON));
  ok('the margin reason names the band and the biggest factor',
    six.reasons.some((x) => x === 'Margin risk: elevated. Biggest factor: thin bid margin. Bid at 8.0% margin.'), JSON.stringify(six.reasons));
  ok('an acronym-led factor keeps its capitals', lvl(sched(0), margin('high', { topFactors: [{ label: 'COs unsigned', detail: 'x' }] })).reasons.some((x) => /factor: COs unsigned\./.test(x)));
  ok('no top factor → "No single factor stands out."', lvl(sched(0), margin('low', { topFactors: [] })).reasons.includes('Margin risk: low. No single factor stands out.'));

  const loading = lvl(null, margin('high'), 'loading');
  ok('margin loading → no band, the loading reason, and NOT "Not enough data yet"',
    loading.tint === 'none' && loading.reasons.includes(E.MARGIN_LOADING_REASON) && loading.label !== E.NOT_ENOUGH_DATA && !/Margin risk:/.test(all(loading)), loading.label);
  const hidden = lvl(sched(3), margin('high'), 'no_access');
  ok('money not shown → no band, the hidden reason', hidden.tint === 'none' && hidden.reasons.includes(E.MARGIN_HIDDEN_REASON) && !/Margin risk:/.test(all(hidden)));

  // The key: the ease-once signal.
  ok('key stable across equal inputs (distinct objects)', lvl(sched(3), margin('low')).key === lvl(sched(3), margin('low')).key);
  ok('key ignores reason-only changes (a new factor detail)', lvl(sched(3), margin('low')).key === lvl(sched(3), margin('low', { topFactors: [{ label: 'Open allowances', detail: 'y' }] })).key);
  ok('key changes with the slip', lvl(sched(3), margin('low')).key !== lvl(sched(4), margin('low')).key);
  ok('key changes with the tint', lvl(sched(3), margin('low')).key !== lvl(sched(3), margin('high')).key);
  ok('key changes with the kind (schedule half lost)', lvl(sched(0), margin('low')).key !== lvl(sched(null), margin('low')).key);
  ok('key is equal for two slips past full scale (same drawing)', lvl(sched(12), null).key === lvl(sched(30), null).key);

  // Sort: worst first ascending; no data last.
  const sv = E.jobLevelSortValue;
  ok('sort: risk + behind < on plan + steady; no_data is null',
    (sv(lvl(sched(8), margin('high'))) ?? 0) < (sv(lvl(sched(0), margin('low'))) ?? 0) && sv(none) === null);

  // Copy rules over a matrix of every branch.
  const matrix: Reading[] = [];
  for (const s of [null, 'undated' as const, sched(null, 0), sched(null, 2, 'late'), sched(-3), sched(0), sched(1), sched(6), sched(40)]) {
    for (const m of [null, margin('low'), margin('moderate', { costBasis: 'subs_only' }), margin('high', { hasBasis: false }), margin('elevated', { topFactors: [] })]) {
      matrix.push(lvl(s, m), lvl(s, m, 'loading'), lvl(s, m, 'no_access'));
    }
  }
  const strings = matrix.flatMap((r) => [r.label, r.accessibilityLabel, ...r.reasons]);
  ok('no exclamation marks', strings.every((x) => !x.includes('!')));
  ok('no he / his / she / her', strings.every((x) => !/\b(he|his|him|she|her)\b/i.test(x)));
  ok('no developer words (sync, queue, server, cache, tenant)', strings.every((x) => !/\b(sync|queue|server|cache|tenant)\b/i.test(x)));
  ok('no emoji', strings.every((x) => !/\p{Extended_Pictographic}/u.test(x)));
  ok('sentence case: every string starts with a capital (or a numeral)', strings.every((x) => /^[A-Z0-9]/.test(x)), strings.find((x) => !/^[A-Z0-9]/.test(x)));
  ok('reasons are full sentences (end with a period)', matrix.every((r) => r.reasons.every((x) => x.endsWith('.'))));
  ok('"project", never "job", in the copy', strings.every((x) => !/\bjobs?\b/i.test(x)));
  ok('"On plan" appears only where the slip is known and ≤ 0',
    matrix.every((r) => !/On plan/.test(all(r)) || (r.hasSchedule && r.offset === 0)));
}

// ── A+. Site counts: listed, never drawn ────────────────────────────────────
console.log('\nA+. site counts (listed, never drawn):');
{
  const withSite = (s: PortfolioSchedule | 'undated' | null, m: Margin | null, site: { openPunch: number; overdueRfis: number }, withheld?: 'loading' | 'no_access') =>
    E.computeJobLevel({ schedule: s, margin: m, site, ...(withheld ? { marginWithheld: withheld } : {}) });
  const r = withSite(sched(3), margin('moderate'), { openPunch: 4, overdueRfis: 2 });
  ok('plural: "4 punch items are open." and "2 RFIs are past their due date."',
    r.reasons.includes('4 punch items are open.') && r.reasons.includes('2 RFIs are past their due date.'), JSON.stringify(r.reasons));
  const one = withSite(sched(3), margin('moderate'), { openPunch: 1, overdueRfis: 1 });
  ok('singular: "1 punch item is open." and "1 RFI is past its due date."',
    one.reasons.includes('1 punch item is open.') && one.reasons.includes('1 RFI is past its due date.'), JSON.stringify(one.reasons));
  const base = lvl(sched(3), margin('moderate'));
  ok('the site reasons come AFTER the schedule and margin reasons, in order',
    JSON.stringify(r.reasons) === JSON.stringify([...base.reasons, '4 punch items are open.', '2 RFIs are past their due date.']), JSON.stringify(r.reasons));
  // Identity of the DRAWN reading, over a table of every branch.
  const same = (a: Reading, b: Reading) => a.key === b.key && a.offset === b.offset && a.tint === b.tint && a.kind === b.kind
    && a.hasSchedule === b.hasSchedule && a.hasMargin === b.hasMargin && a.label === b.label && a.accessibilityLabel === b.accessibilityLabel;
  const bad: string[] = [];
  for (const s of [null, 'undated' as const, sched(null, 2, 'late'), sched(-3), sched(0), sched(1), sched(6), sched(40)]) {
    for (const m of [null, margin('low'), margin('high'), margin('moderate', { hasBasis: false })]) {
      for (const w of [undefined, 'loading' as const, 'no_access' as const]) {
        for (const site of [{ openPunch: 0, overdueRfis: 0 }, { openPunch: 1, overdueRfis: 0 }, { openPunch: 9, overdueRfis: 7 }, { openPunch: 250, overdueRfis: 40 }]) {
          const a = E.computeJobLevel({ schedule: s, margin: m, ...(w ? { marginWithheld: w } : {}) });
          const b = withSite(s, m, site, w);
          if (!same(a, b)) bad.push(`${JSON.stringify(s)}|${m?.band ?? 'null'}|${w ?? '-'}|${JSON.stringify(site)}: ${a.key} vs ${b.key}`);
        }
      }
    }
  }
  ok('key, offset, tint, kind, halves, label and spoken label are identical with and without site counts (384 rows)', bad.length === 0, bad.slice(0, 4).join(' ; '));
  const zero = withSite(sched(3), margin('low'), { openPunch: 0, overdueRfis: 0 });
  ok('zero counts add nothing', JSON.stringify(zero.reasons) === JSON.stringify(lvl(sched(3), margin('low')).reasons));
  const junk = withSite(sched(3), margin('low'), { openPunch: -2, overdueRfis: Number.NaN });
  ok('negative and NaN counts add nothing', JSON.stringify(junk.reasons) === JSON.stringify(lvl(sched(3), margin('low')).reasons), JSON.stringify(junk.reasons));
  const inf = withSite(sched(3), margin('low'), { openPunch: Number.POSITIVE_INFINITY, overdueRfis: 0 });
  ok('an infinite count adds nothing', JSON.stringify(inf.reasons) === JSON.stringify(lvl(sched(3), margin('low')).reasons));
  const none = withSite(null, null, { openPunch: 5, overdueRfis: 3 });
  ok('no data with counts stays no_data, "Not enough data yet", and still lists the counts',
    none.kind === 'no_data' && none.label === E.NOT_ENOUGH_DATA && none.reasons.includes('5 punch items are open.') && none.reasons.includes('3 RFIs are past their due date.'), JSON.stringify(none));
  const strings = [r, one, none].flatMap((x) => x.reasons);
  ok('site reasons keep the voice (sentence, period, no "!", "project" not "job")',
    strings.every((x) => /^[A-Z0-9]/.test(x) && x.endsWith('.') && !x.includes('!') && !/\bjobs?\b/i.test(x)));
}

// ── A++. The hub reading from the pulse ─────────────────────────────────────
console.log('\nA++. jobLevelFromPulse (the hub):');
{
  type Facts = import('../utils/jobLevel').JobLevelPulseFacts;
  const risk = (band: Margin['band'], over: Partial<Margin> = {}) => ({ ...margin(band), ...over });
  const facts = (over: Partial<Facts> = {}): Facts => ({
    canSeeMoney: true, roleLoading: false, costSourcesReady: true, risk: risk('moderate'), openPunch: 0, overdueRfis: 0, ...over,
  });
  const P = E.jobLevelFromPulse;
  const loadingRole = P(sched(2), facts({ canSeeMoney: false, roleLoading: true }));
  ok('role still resolving → margin withheld as loading (no band, the loading reason)',
    loadingRole.tint === 'none' && !loadingRole.hasMargin && loadingRole.reasons.includes(E.MARGIN_LOADING_REASON) && !/Margin risk:/.test(all(loadingRole)), JSON.stringify(loadingRole.reasons));
  const field = P(sched(2), facts({ canSeeMoney: false, roleLoading: false }));
  ok('a role that resolved to field (no money) → withheld as no_access ("Margin is not shown for this project.")',
    field.tint === 'none' && field.reasons.includes(E.MARGIN_HIDDEN_REASON) && !/Margin risk:/.test(all(field)), JSON.stringify(field.reasons));
  const streams = P(sched(2), facts({ costSourcesReady: false }));
  ok('cost streams not read yet → withheld as loading (no score from empty streams)',
    streams.tint === 'none' && streams.reasons.includes(E.MARGIN_LOADING_REASON) && !/Margin risk:/.test(all(streams)));
  const noRisk = P(null, facts({ costSourcesReady: false, risk: null }));
  ok('no schedule + streams loading → no_data labelled "Loading margin…" (not "Not enough data yet")', noRisk.kind === 'no_data' && noRisk.label === 'Loading margin…', noRisk.label);
  for (const [band, tint] of [['low', 'steady'], ['moderate', 'watch'], ['elevated', 'risk'], ['high', 'risk']] as const) {
    const r = P(sched(0), facts({ risk: risk(band) }));
    ok(`money visible: band ${band} → tint ${tint} (through marginForLevel)`, r.tint === tint && r.hasMargin && r.kind === 'reading', `${r.tint} ${r.kind}`);
  }
  ok('the margin half equals computeJobLevel on marginForLevel(risk) — the same object the hero prints',
    P(sched(4), facts({ risk: risk('elevated', { costBasis: 'subs_only' }) })).reasons.join('|')
      === E.computeJobLevel({ schedule: sched(4), margin: E.marginForLevel(risk('elevated', { costBasis: 'subs_only' })) }).reasons.join('|'));
  ok('no margin basis → partial with the no-margin reason', (() => { const r = P(sched(1), facts({ risk: risk('high', { hasBasis: false }) })); return r.kind === 'partial' && r.tint === 'none' && r.reasons.includes(E.NO_MARGIN_REASON); })());
  ok('risk null → the no-margin reason', P(sched(1), facts({ risk: null })).reasons.includes(E.NO_MARGIN_REASON));
  const cnt = P(sched(2), facts({ openPunch: 3, overdueRfis: 1 }));
  ok('the pulse counts are listed', cnt.reasons.includes('3 punch items are open.') && cnt.reasons.includes('1 RFI is past its due date.'));
  ok('…and change nothing drawn', cnt.key === P(sched(2), facts()).key && cnt.offset === P(sched(2), facts()).offset);
  // Never a reading without a slip: every branch × every schedule with no slip.
  const noSlip: (PortfolioSchedule | 'undated' | null)[] = [null, 'undated', sched(null), sched(null, 4, 'late'), sched(Number.NaN)];
  const branches: Partial<Facts>[] = [
    {}, { canSeeMoney: false, roleLoading: true }, { canSeeMoney: false }, { costSourcesReady: false },
    { risk: risk('high') }, { risk: null }, { openPunch: 8, overdueRfis: 8 },
  ];
  const leaks = noSlip.flatMap((s) => branches.map((b) => P(s, facts(b))).filter((r) => r.kind === 'reading' || r.hasSchedule || r.offset !== 0 || /On plan/.test(all(r))));
  ok('never \'reading\', never a slip, never "On plan" without a known slip (35 rows)', leaks.length === 0, JSON.stringify(leaks[0]));
  const hollow = P(null, facts({ canSeeMoney: false, roleLoading: false }));
  ok('a field role on a project with no schedule → no_data, "Not enough data yet"', hollow.kind === 'no_data' && hollow.label === E.NOT_ENOUGH_DATA);
}

// ── A+++. The legend ────────────────────────────────────────────────────────
console.log('\nA+++. the legend:');
const LEGEND_KEY = (id: string) => `office.projectHealth.legend.${id}`;
{
  const L = E.JOB_LEVEL_LEGEND;
  ok('four lines, ids bubble / colour / listed / empty in that order', L.map((x) => x.id).join(',') === 'bubble,colour,listed,empty', L.map((x) => x.id).join(','));
  ok('each is ONE sentence (one terminal period, none inside)', L.every((x) => x.text.endsWith('.') && (x.text.match(/\.(\s|$)/g) ?? []).length === 1), L.map((x) => x.text).join(' | '));
  ok('sentence case (a capital first, no Title Case words after)', L.every((x) => /^[A-Z]/.test(x.text) && !/\s(The|A|Is|Of|And|When)\b/.test(x.text.slice(1))));
  ok('no he / his / she / her, no "!", no emoji', L.every((x) => !/\b(he|his|him|she|her)\b/i.test(x.text) && !x.text.includes('!') && !/\p{Extended_Pictographic}/u.test(x.text)));
  ok('the bubble line says right = the finish slipping past the baseline', /moves right/.test(L[0].text) && /baseline/.test(L[0].text));
  ok('the colour line names margin risk and NO colour word (the accent follows the theme preset)',
    /margin risk/.test(L[1].text) && !/\b(green|amber|orange|red|yellow|blue)\b/i.test(L[1].text), L[1].text);
  ok('the listed line names punch, RFIs and tasks as listed, not drawn', /punch/.test(L[2].text) && /RFIs/.test(L[2].text) && /tasks/.test(L[2].text) && /not drawn/.test(L[2].text));
  ok('the empty line names the grey, hollow level and not enough data', /grey, hollow/.test(L[3].text) && /not enough data/.test(L[3].text));
}

// ── B. The Health column budget ─────────────────────────────────────────────
console.log('\nB. the Health column budget:');
{
  ok('width 64, key health', E.JOB_LEVEL_COLUMN_WIDTH === 64 && E.JOB_LEVEL_COLUMN_ID === 'health');
  ok('hideBelow = the % threshold + its own width', E.JOB_LEVEL_COLUMN_HIDE_BELOW === HIDE.pct + E.JOB_LEVEL_COLUMN_WIDTH, String(E.JOB_LEVEL_COLUMN_HIDE_BELOW));
  ok('the row Level fits the column (inner 44 px)', E.JOB_LEVEL_ROW_SIZE <= E.JOB_LEVEL_COLUMN_WIDTH - 20);
  ok('"Health" fits the header (≈ 7 px a character)', 'Health'.length * 7 <= E.JOB_LEVEL_COLUMN_WIDTH - 20);
  type Col = { key: string; width: number; hideBelow?: number };
  const cols: Col[] = [
    { key: 'job', width: 0 },
    { key: 'stage', width: W.stage },
    { key: 'pct', width: W.pct, hideBelow: HIDE.pct },
    { key: 'schedule', width: W.schedule },
    { key: 'health', width: E.JOB_LEVEL_COLUMN_WIDTH, hideBelow: E.JOB_LEVEL_COLUMN_HIDE_BELOW },
    { key: 'finish', width: W.finish },
    { key: 'contract', width: W.contract, hideBelow: HIDE.contract },
    { key: 'billed', width: W.billed, hideBelow: HIDE.billed },
    { key: 'ar', width: W.ar },
    { key: 'open', width: W.open, hideBelow: HIDE.open },
    { key: 'milestone', width: W.milestone, hideBelow: HIDE.milestone },
    { key: 'activity', width: W.activity, hideBelow: HIDE.activity },
    { key: 'actions', width: W.actions },
  ];
  const jobFor = (outer: number) => {
    const shown = new Set(visibleColumnKeys(cols, outer, []));
    return { shown, job: outer - PORTFOLIO_ROW_CHROME - cols.filter((c) => c.key !== 'job' && shown.has(c.key)).reduce((a, c) => a + c.width, 0) };
  };
  const neverHide = W.jobMin + PORTFOLIO_ROW_CHROME + cols.filter((c) => c.key !== 'job' && c.hideBelow === undefined).reduce((a, c) => a + c.width, 0);
  const bad: string[] = [];
  for (let outer = neverHide; outer <= 2600; outer++) {
    const { job } = jobFor(outer);
    if (job < W.jobMin) bad.push(`${outer}→${job}`);
  }
  ok(`with Health, every table width ${neverHide}–2600 leaves Job ≥ ${W.jobMin}`, bad.length === 0, bad.slice(0, 8).join(', '));
  ok('Health shows on a wide table (1320)', jobFor(1320).shown.has('health'));
  // Where the founder works: a 1512 window. The table is min(win − scrollbar −
  // sidebar − rail, 1600) − 2 × 24 (validate-portfolio-row's own formula).
  const RAIL = 300;
  const at = (sidebar: number, rail: number) => Math.min(1512 - 15 - sidebar - rail, 1600) - 48;
  const shownAt = [SIDEBAR_FULL, SIDEBAR_RAIL].flatMap((sb) => (1512 >= ACTION_RAIL_MIN_WIDTH ? [0, RAIL] : [0]).map((r) => `${sb}/${r}: ${at(sb, r)} ${jobFor(at(sb, r)).shown.has('health') ? 'shown' : 'hidden'}`));
  console.log(`    (1512 window — sidebar/rail: table px → Health) ${shownAt.join(' · ')}`);
  ok('at 1512 with no action rail open, Health shows (full or rail sidebar)', jobFor(at(SIDEBAR_FULL, 0)).shown.has('health') && jobFor(at(SIDEBAR_RAIL, 0)).shown.has('health'));
}

// ── C. Source rules ─────────────────────────────────────────────────────────
console.log('\nC. source rules:');
{
  const comp = read('components/level/JobLevel.tsx');
  const reason = read('components/level/JobLevelReason.tsx');
  const code = stripComments(comp);
  const loaderImports = [...code.matchAll(/import\s+([^;]*?)\s+from\s+'@\/components\/loaders\/([^']+)'/g)];
  ok('JobLevel imports from components/loaders only the palette helper (themeFallback levelPalette)',
    loaderImports.length === 1 && loaderImports[0][2] === 'themeFallback' && /^\{\s*levelPalette\s*\}$/.test(loaderImports[0][1].trim()),
    loaderImports.map((m) => m[0]).join(' | '));
  ok('…and never LevelMark / levelClock (no loader motion)', !/LevelMark|levelClock|useLevelClock/.test(code));
  ok('the geometry is The Level\'s own (levelParts from utils/levelTimeline)', /import \{[^}]*\blevelParts\b[^}]*\} from '@\/utils\/levelTimeline'/.test(code) && /levelParts\(width, 'accent'\)/.test(code));
  ok('the ease is easeOutCubic from utils/levelTimeline', /import \{[^}]*\beaseOutCubic\b[^}]*\} from '@\/utils\/levelTimeline'/.test(code) && /easing: easeOutCubic/.test(code));
  ok('the ease is Animated.timing on the native driver, JOB_LEVEL_EASE_MS long',
    /Animated\.timing\(x, \{[^}]*duration: JOB_LEVEL_EASE_MS,[^}]*useNativeDriver: nativeDriver,/.test(code) && E.JOB_LEVEL_EASE_MS === 450);
  ok('it imports nativeDriver + useReducedMotion from components/ui/motion', /import \{ nativeDriver, useReducedMotion \} from '@\/components\/ui\/motion'/.test(code));
  ok('Reduce Motion (or no change) jumps: setValue, no timing', /if \(from === target \|\| reduce\) \{\s*x\.setValue\(target \* parts\.amp\);\s*return;/.test(code));
  ok('it eases only when the reading key changes', /\}, \[reading\.key, parts\.amp, reduce, projectId\]\);/.test(code));
  ok('the last drawn position is remembered per project (module map) and a remount starts there',
    /^const lastShown = new Map<string, number>\(\);/m.test(code) && /lastShown\.get\(projectId\) \?\? target/.test(code) && /lastShown\.set\(projectId, target\)/.test(code));
  ok('it never loops or seeks (no Animated.loop, setInterval, requestAnimationFrame, clock)',
    !/Animated\.loop|setInterval|requestAnimationFrame|Animated\.sequence|useLevelClock/.test(code));
  for (const [name, src] of [['JobLevel.tsx', comp], ['JobLevelReason.tsx', reason]] as const) {
    ok(`${name}: no hex colour literal`, !/#[0-9a-fA-F]{3,8}\b/.test(stripComments(src)));
    ok(`${name}: no rgba/rgb literal`, !/\brgba?\(/.test(stripComments(src)));
  }
  ok('tints are theme tokens: accent / warningLabel / danger / textMuted',
    /case 'steady': return c\.accent;/.test(code) && /case 'watch': return c\.warningLabel;/.test(code)
      && /case 'risk': return c\.danger;/.test(code) && /default: return c\.textMuted;/.test(code));
  ok('no slip reading draws a HOLLOW bubble (never a solid centred one)', /const hollow = !reading\.hasSchedule;/.test(code) && /hollow \? 'transparent' : pal\.bubble/.test(code));
  ok('no_data draws the muted vial', /levelPalette\(empty \? 'muted' : 'accent'/.test(code));
  ok('the Level is a button that reads its label', /accessibilityRole="button"/.test(code) && /accessibilityLabel=\{reading\.accessibilityLabel\}/.test(code));
  ok('testIDs: joblevel-<projectId> and joblevel-reason', /`joblevel-\$\{projectId\}`/.test(code) && /testID="joblevel-reason"/.test(stripComments(reason)));
  ok('the press is the Level\'s own (stops the row link / card press)', /ev\?\.preventDefault\?\.\(\);\s*ev\?\.stopPropagation\?\.\(\);\s*setOpen\(true\);/.test(code));
  ok('the reason uses the Sheet primitive', /import \{ Sheet \} from '@\/components\/ui\/Sheet'/.test(reason));
  ok('the sheet mounts only when open', /\{open \? \(/.test(code));
  ok('no data says "Not enough data yet" beside the vial by default', /const withLabel = showLabel \?\? \(size === 'detail' \|\| reading\.kind === 'no_data'\);/.test(code));

  // The sheet renders the whole legend, each line through t() with its fixed
  // key and the engine's English as the literal fallback (i18n-extract needs
  // both literal).
  const reasonCode = stripComments(reason);
  const tLine = (id: string, text: string) => `t('${LEGEND_KEY(id)}', '${text.replace(/'/g, "\\'")}')`;
  ok('JobLevelReason: renders all four legend lines through t() with the engine\'s English',
    E.JOB_LEVEL_LEGEND.every((x) => reasonCode.includes(tLine(x.id, x.text))), E.JOB_LEVEL_LEGEND.filter((x) => !reasonCode.includes(tLine(x.id, x.text))).map((x) => x.id).join(','));
  ok('JobLevelReason: the legend sits UNDER the reasons, in textSecondary',
    /reading\.reasons\.map[\s\S]*testID="joblevel-legend"/.test(reasonCode) && /legendLine: \{[^}]*color: t\.textSecondary/.test(reasonCode));
  ok('JobLevelReason: the title is "Project health" through t()', /t\('office\.projectHealth\.title', 'Project health'\)/.test(reasonCode));

  // ── C+. The hub card ──
  const card = read('components/level/ProjectLevelCard.tsx');
  const cardCode = stripComments(card);
  ok('ProjectLevelCard: draws JobLevel (never the loader: no LevelMark / levelClock)',
    /import \{ JobLevel \} from '\.\/JobLevel'/.test(cardCode) && /<JobLevel [^>]*size="detail"[^>]*showLabel[^>]*testID="project-level"/.test(cardCode) && !/LevelMark|levelClock|useLevelClock|components\/loaders/.test(cardCode));
  ok('ProjectLevelCard: the schedule half from buildPortfolioRows (one project, empty lists — useJobLevel\'s way)',
    /buildPortfolioRows\(\{\s*projects: \[project\], invoices: \[\], changeOrders: \[\], rfis: \[\], punchItems: \[\],/.test(cardCode) && /\}\)\[0\]\?\.schedule \?\? null/.test(cardCode));
  ok('ProjectLevelCard: the reading is jobLevelFromPulse over the pulse (open punch = open + in progress + ready for review)',
    /jobLevelFromPulse\(schedule, \{ canSeeMoney, roleLoading, costSourcesReady, risk, openPunch, overdueRfis \}\)/.test(cardCode)
      && /const openPunch = punch\.open \+ punch\.inProgress \+ punch\.readyForReview;/.test(cardCode));
  ok('ProjectLevelCard: never computes its own margin or reads the pulse again', !/computeMarginRisk|useProjectPulse|useJobLevels?\b|computeJobLevel\(/.test(cardCode));
  ok('ProjectLevelCard: no hex / rgba colour literal', !/#[0-9a-fA-F]{3,8}\b/.test(cardCode) && !/\brgba?\(/.test(cardCode));
  ok('ProjectLevelCard: no storage, no writes', !/supabase|AsyncStorage|\.insert\(|\.upsert\(|supabaseWrite|fetch\(/.test(cardCode));
  const returnsNull = [...cardCode.matchAll(/return null;?/g)].length;
  ok('ProjectLevelCard: renders for no data — the ONLY early return is a null project (no return on kind)',
    returnsNull === 1 && /if \(!pulse\.hasProject\) return null;/.test(cardCode) && !/reading\.kind/.test(cardCode));
  ok('ProjectLevelCard: testIDs project-level-card (default), project-level, project-level-legend',
    /testID = 'project-level-card'/.test(cardCode) && /testID="project-level-legend"/.test(cardCode));
  ok('ProjectLevelCard: the title is a header ("Project health" through t())', /accessibilityRole="header">\{t\('office\.projectHealth\.title', 'Project health'\)\}/.test(cardCode));
  ok('ProjectLevelCard: the compact legend is the bubble + colour lines, through t() with the engine\'s English',
    ['bubble', 'colour'].every((id) => cardCode.includes(tLine(id, E.JOB_LEVEL_LEGEND.find((x) => x.id === id)!.text))));
  ok('ProjectLevelCard: the surface is the Card primitive (no hand-rolled surface recipe)', /<Card /.test(cardCode) && !/backgroundColor: t\.surface/.test(cardCode));

  // ── C++. ProjectHero keeps one meaning for a bubble ──
  const hero = stripComments(read('components/ProjectHero.tsx'));
  ok('ProjectHero: no spring and no bubble remain (the Level lives in ProjectLevelCard)', !/Animated\.spring/.test(hero) && !/\bbubble\w*\b/i.test(hero), (hero.match(/Animated\.spring|\bbubble\w*\b/i) ?? [''])[0]);
  ok('ProjectHero: the "Margin risk" words + band row stays', />Margin risk<\/Text>/.test(hero) && /\{riskBandLabel\(risk\.band\)\}/.test(hero));
  ok('ProjectHero: no private vial / centre marks', !/styles\.(vial|centerMark)/.test(hero));

  // ── The hub mounts it twice, with the page's one pulse ──
  const hub = stripComments(read('app/project-detail.tsx'));
  const mounts = [...hub.matchAll(/<ProjectLevelCard project=\{project\} pulse=\{pulse\} \/>/g)].length;
  ok('project-detail: ProjectLevelCard mounted twice (desktop + phone) with the page\'s pulse', mounts === 2 && /import \{ ProjectLevelCard \} from '@\/components\/level\/ProjectLevelCard';/.test(hub), String(mounts));
  ok('project-detail: desktop — directly after the KPI strip', /<ProjectKpiStrip[^>]*\/>\s*<ProjectLevelCard project=\{project\} pulse=\{pulse\} \/>/.test(hub));
  ok('project-detail: phone — after the live-job ProjectHero, before the blueprint hero card',
    /\? <ProjectHero project=\{project\} pulse=\{pulse\} \/> : null\}\s*<ProjectLevelCard project=\{project\} pulse=\{pulse\} \/>\s*(?:\{\s*\}\s*)?<BlueprintReveal>/.test(hub));
  ok('project-detail: the pulse is still read ONCE', (hub.match(/useProjectPulse\(/g) ?? []).length === 1);

  const eng = stripComments(read('utils/jobLevel.ts'));
  ok('utils/jobLevel.ts is pure (no react / react-native import)', !/from 'react(-native)?'/.test(eng));

  const table = stripComments(read('components/portfolio/PortfolioTable.tsx'));
  ok('PortfolioTable: showLevel is optional', /showLevel\?: boolean;/.test(table));
  ok('PortfolioTable: showLevel defaults off (only a true prop mounts the Level)', /if \(props\.showLevel\) return <PortfolioTableWithLevel \{\.\.\.props\} \/>;\s*return <PortfolioTableBase \{\.\.\.props\} levels=\{null\} \/>;/.test(table)
    && !/showLevel = true/.test(table));
  ok('PortfolioTable: the Level hooks live only in the showLevel wrapper', (table.match(/useJobLevels\(/g) ?? []).length === 1
    && /function PortfolioTableWithLevel[\s\S]*?useJobLevels\(/.test(table));
  ok('PortfolioTable: no Health column without readings', /levels \? \[\{[\s\S]*?\}\] : \[\]/.test(table));
  ok('PortfolioTable: the Health column is sized and hidden by utils/jobLevel',
    /width: JOB_LEVEL_COLUMN_WIDTH,/.test(table) && /hideBelow: JOB_LEVEL_COLUMN_HIDE_BELOW,/.test(table) && /label: 'Health',/.test(table));
  ok('PortfolioTable: the Level reads the row\'s own schedule verdict', /new Map\(rows\.map\(\(r\) => \[r\.id, r\.schedule\] as const\)\)/.test(table)
    && /marginVisible: burnByProject/.test(table));

  const hook = stripComments(read('hooks/useJobLevel.ts'));
  const STREAMS = ['receipts', 'timeEntries', 'laborRates', 'overtimeMultiplier', 'overtimeRule', 'equipment', 'permits', 'subcontractors'];
  const memo = /const costSources = useMemo<JobCostActualSources>\(\(\) => \(\{([^}]*)\}\)/.exec(hook);
  const fields = new Set((memo?.[1] ?? '').split(',').map((f) => f.trim().split(':')[0].trim()).filter(Boolean));
  ok('useJobLevel: the costSources bundle carries all seven streams', !!memo && STREAMS.every((f) => fields.has(f)), [...fields].join(','));
  ok('useJobLevel: readiness covers receipts, rates AND the time-entry mirror, by the exported key',
    /const costSourcesReady = !receiptsLoading && !ratesLoading && mirrorLoaded;/.test(hook)
      && /const mirrorLoaded = queryClient\.getQueryState\(TIME_ENTRIES_MIRROR_QUERY_KEY\)\?\.data !== undefined;/.test(hook));
  ok('useJobLevel: computeMarginRisk forwards costSources', /computeMarginRisk\(\{ project, changeOrders, commitments, invoices, costSources \}\)/.test(hook));
  ok('useJobLevel: no score before the streams load (withheld as loading)', /if \(!costSourcesReady\) \{\s*out\.set\(project\.id, computeJobLevel\(\{ schedule, margin: null, marginWithheld: 'loading' \}\)\);/.test(hook));
  ok('useJobLevel: the margin half obeys the caller\'s visibility', /if \(!marginVisible\.has\(project\.id\)\) \{\s*out\.set\(project\.id, computeJobLevel\(\{ schedule, margin: null, marginWithheld: 'no_access' \}\)\);/.test(hook));
  ok('useJobLevel: the schedule half comes from portfolioRow\'s own builder', /buildPortfolioRows\(\{/.test(hook));
  for (const [name, src] of [['hooks/useJobLevel.ts', hook], ['components/level/JobLevel.tsx', code], ['utils/jobLevel.ts', eng]] as const) {
    ok(`${name}: no direct write and no storage`, !/supabase\.from|AsyncStorage|\.insert\(|\.upsert\(/.test(src));
  }
}

console.log(`\nvalidate-job-level: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
