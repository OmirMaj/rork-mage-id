// validate-crew-presence.ts — pins who was on site, and what silence means.
//
// WHY THIS EXISTS. This module turns daily-report manpower into an accusation
// ("Acme has not been on site for four days"), and an accusation derived from
// missing data is the fastest way to lose a user's trust in every other number
// the app shows. Two failure modes matter:
//
//   • The GC stops filing reports and every sub is suddenly flagged as absent.
//     The alarm would get LOUDER the less the app knew, which is exactly
//     backwards, and the GC would be chasing subs over their own paperwork gap.
//   • A trade that appeared once — a delivery, a measure-up, a walk-through —
//     is treated as an established crew that then "went quiet".
//
// Pins INTENDED semantics:
//   • absence is counted in REPORTED days, never calendar days
//   • no reports since a trade's last appearance ⇒ zero days since, always
//   • a trade must be established (≥2 reported days) before it can go quiet
//   • a zero-headcount row is not presence and cannot reset the clock
//   • man-hours are headcount × hoursWorked, not hours alone
//   • trade keys are normalized through the same function the cost book uses
//
// Run via: bun run test:crew-presence

import {
  buildCrewPresence, findQuietTrades, summarizeCrewPresence,
  MIN_REPORTED_DAYS_TO_ESTABLISH, WENT_QUIET_AFTER_REPORTED_DAYS,
} from '../utils/crewPresence';
import type { DailyFieldReport } from '../types';

let failures = 0;
function check(label: string, cond: boolean) {
  if (!cond) { console.error(`  FAIL: ${label}`); failures++; }
}

type Crew = { trade: string; company: string; headcount: number; hoursWorked: number };
const rep = (date: string, manpower: Crew[]): DailyFieldReport =>
  ({ id: `r-${date}`, projectId: 'p1', date, manpower } as unknown as DailyFieldReport);

const acme = (headcount = 4, hoursWorked = 8): Crew =>
  ({ trade: 'Drywall', company: 'Acme Drywall', headcount, hoursWorked });
const volt = (headcount = 2, hoursWorked = 8): Crew =>
  ({ trade: 'Electrical', company: 'Volt Electric', headcount, hoursWorked });

// ── basic folding ───────────────────────────────────────────────────────────
{
  const s = buildCrewPresence([
    rep('2026-08-03', [acme(), volt()]),
    rep('2026-08-04', [acme(3)]),
  ]);
  check('two trades folded', s.trades.length === 2);
  check('reported days counted distinctly', s.reportedDays === 2);

  const dry = s.trades.find(t => t.tradeKey === 'drywall');
  check('trade key normalized to the cost book vocabulary', !!dry);
  check('present on both days', dry?.reportedDaysPresent === 2);
  // 4×8 + 3×8 = 56. Not 16 — hours alone would undercount a crew by its size.
  check('man-hours are headcount × hours', dry?.manHours === 56);
  check('peak headcount is the max, not the last', dry?.peakHeadcount === 4);
  check('company captured', dry?.companies[0] === 'Acme Drywall');
  check('firstSeen / lastSeen bracket the range',
    dry?.firstSeen === '2026-08-03' && dry?.lastSeen === '2026-08-04');
  check('asOf is the latest report', s.asOf === '2026-08-04');
  check('total man-hours across trades', s.totalManHours === 56 + 16);
}

// ── THE CENTRAL RULE: absence is measured in REPORTED days ──────────────────
{
  // Acme worked Mon+Tue. Reports continued Wed, Thu, Fri without them.
  const s = buildCrewPresence([
    rep('2026-08-03', [acme()]),
    rep('2026-08-04', [acme()]),
    rep('2026-08-05', [volt()]),
    rep('2026-08-06', [volt()]),
    rep('2026-08-07', [volt()]),
  ]);
  const dry = s.trades.find(t => t.tradeKey === 'drywall');
  check('3 reports since Acme was last seen', dry?.reportedDaysSince === 3);
  check('a trade on the latest report has zero days since',
    s.trades.find(t => t.tradeKey === 'electrical')?.reportedDaysSince === 0);

  const quiet = findQuietTrades(s);
  check('an established trade absent 3 reported days went quiet', quiet.length === 1);
  check('…and it names the company, not the trade key', quiet[0].message.includes('Acme Drywall'));
  check('…and says when they were last seen', quiet[0].message.includes('2026-08-04'));
  check('…the still-present trade is not flagged', !quiet.some(q => q.tradeKey === 'electrical'));
}

// ── the failure this guard exists for: the GC stops filing reports ──────────
{
  // Acme worked three days. Then NOTHING was filed at all — no reports, no
  // evidence. The app has witnessed no absence; it has witnessed nothing.
  const s = buildCrewPresence([
    rep('2026-08-03', [acme()]),
    rep('2026-08-04', [acme()]),
    rep('2026-08-05', [acme()]),
  ]);
  const dry = s.trades.find(t => t.tradeKey === 'drywall');
  check('no reports since ⇒ zero reported days since', dry?.reportedDaysSince === 0);
  check('a reporting gap NEVER produces a quiet-trade accusation',
    findQuietTrades(s).length === 0);
  // The counter must freeze, not grow, as the app learns less.
  check('asOf pins to the last real report, not to today', s.asOf === '2026-08-05');
}

// ── a one-day appearance is not an established crew ─────────────────────────
{
  // A delivery driver, a measure-up, a walk-through — one day then gone.
  const s = buildCrewPresence([
    rep('2026-08-03', [{ trade: 'Glazing', company: 'Clearview', headcount: 1, hoursWorked: 2 }]),
    rep('2026-08-04', [volt()]),
    rep('2026-08-05', [volt()]),
    rep('2026-08-06', [volt()]),
    rep('2026-08-07', [volt()]),
  ]);
  const glaze = s.trades.find(t => t.tradeKey === 'glazing');
  check('the one-day trade is still recorded', glaze?.reportedDaysPresent === 1);
  check('…but is NOT flagged as having gone quiet',
    !findQuietTrades(s).some(q => q.tradeKey === 'glazing'));
  check('establishing threshold is what excludes it', MIN_REPORTED_DAYS_TO_ESTABLISH === 2);
}

// ── an empty row is not presence ────────────────────────────────────────────
{
  // A manpower row logged with nobody on it must not reset the absence clock —
  // otherwise a paperwork artifact silences a real alarm.
  const s = buildCrewPresence([
    rep('2026-08-03', [acme()]),
    rep('2026-08-04', [acme()]),
    rep('2026-08-05', [volt()]),
    rep('2026-08-06', [volt()]),
    rep('2026-08-07', [{ trade: 'Drywall', company: 'Acme Drywall', headcount: 0, hoursWorked: 0 }, volt()]),
  ]);
  const dry = s.trades.find(t => t.tradeKey === 'drywall');
  check('a zero-headcount row does not count as a day present', dry?.reportedDaysPresent === 2);
  check('…and does not reset the absence clock', dry?.reportedDaysSince === 3);
  check('…so the quiet flag survives the empty row', findQuietTrades(s).length === 1);
}

// ── threshold behaviour ─────────────────────────────────────────────────────
{
  const mk = (gap: number) => {
    const reports = [rep('2026-08-03', [acme()]), rep('2026-08-04', [acme()])];
    for (let i = 0; i < gap; i++) reports.push(rep(`2026-08-${String(5 + i).padStart(2, '0')}`, [volt()]));
    return buildCrewPresence(reports);
  };
  check('one reported day of absence is not yet quiet', findQuietTrades(mk(1)).length === 0);
  check('two is not yet quiet', findQuietTrades(mk(2)).length === 0);
  check('the threshold is exactly 3 reported days',
    findQuietTrades(mk(3)).length === 1 && WENT_QUIET_AFTER_REPORTED_DAYS === 3);
  check('the threshold is overridable', findQuietTrades(mk(1), { quietAfter: 1 }).length === 1);
}

// ── multiple companies on one trade ─────────────────────────────────────────
{
  const s = buildCrewPresence([
    rep('2026-08-03', [{ trade: 'Drywall', company: 'Acme', headcount: 3, hoursWorked: 8 }]),
    rep('2026-08-04', [{ trade: 'Drywall', company: 'Second Coat', headcount: 2, hoursWorked: 8 }]),
    rep('2026-08-05', [volt()]), rep('2026-08-06', [volt()]), rep('2026-08-07', [volt()]),
  ]);
  const dry = s.trades.find(t => t.tradeKey === 'drywall');
  check('both companies recorded against the trade', dry?.companies.length === 2);
  // Naming one of two would be a guess about which crew is missing.
  check('with two companies the message falls back to the trade',
    findQuietTrades(s)[0]?.message.startsWith('drywall'));
}

// ── ordering + summary ──────────────────────────────────────────────────────
{
  const s = buildCrewPresence([
    rep('2026-08-03', [acme()]),
    rep('2026-08-07', [volt()]),
  ]);
  check('most recently on site leads', s.trades[0].tradeKey === 'electrical');
  const line = summarizeCrewPresence(s);
  check('summary counts only trades on the latest report', !!line?.startsWith('1 trade on site'));
  check('…and reports man-hours', !!line?.includes('man-hours'));
}

// ── empty and malformed input ───────────────────────────────────────────────
{
  const empty = buildCrewPresence([]);
  check('no reports: no trades', empty.trades.length === 0);
  check('no reports: asOf is empty, not today', empty.asOf === '');
  check('no reports: no summary line', summarizeCrewPresence(empty) === null);
  check('no reports: no accusations', findQuietTrades(empty).length === 0);

  const junk = buildCrewPresence([
    rep('not-a-date', [acme()]),
    ({ id: 'r2', projectId: 'p1', date: '2026-08-04' } as unknown as DailyFieldReport), // no manpower
  ]);
  check('an unparseable date is skipped, not crashed on', junk.reportedDays === 1);
  check('a report with no manpower array is safe', junk.trades.length === 0);
}

if (failures > 0) {
  console.error(`\n✗ validate-crew-presence: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('✓ validate-crew-presence: all checks passed');
