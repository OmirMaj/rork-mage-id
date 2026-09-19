// validate-dfr-field-sources.ts — the daily report is filled from what the app
// already witnessed, not retyped.
//
// Pins three audit-round-2 fixes on app/daily-report.tsx:
//
//   #10 CREW FROM THE TIME CLOCK. The roster came only from the schedule PLAN
//       (crewSize × a hardcoded 8 h) while the time clock had already recorded
//       who was on this job and for how long — two contradicting records from
//       one app. Now: clocked shifts first (same filter the cost book uses),
//       matched on the LOCAL day of clockIn, company = the GC's own name, sub
//       crews still from the plan, and the chip says which source it is.
//   #11 RECEIPTS INTO MATERIALS. A load signed for on Deliveries (damage noted
//       at the tailgate, who signed) never reached the report or its PDF. Now:
//       the report's calendar day pulls that day's receipts, a damaged one also
//       lands in Issues & Delays, and "copy from yesterday" does not carry
//       yesterday's loads in as today's.
//   Safety handoff: the live OSHA verdict reads the restricted-day count.
//
// Behaviour is exercised on the real pure modules; the screen wiring (which
// cannot be imported outside Metro) is pinned by source shape.
//
// Run: bun run scripts/validate-dfr-field-sources.ts

// Pin a US timezone BEFORE any Date is built: the evening-shift and
// evening-receipt cases only mean something west of Greenwich.
process.env.TZ = 'America/Los_Angeles';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { TimeEntry, DailyFieldReport } from '../types';
import { addClockRowsToRoster, carryForwardManpower, clockCrewForDay, clockCrewSourceLine, clockInLocalDay, clockRosterGapLine, clockRowsMissingFromRoster, liveClockHoursWarning, OWN_CREW_FALLBACK_COMPANY, seedRowIds } from '../utils/dfrClockCrew';
import { receiptLinesForDay, mergeReceiptLines, receiptMaterialLine, carryIssuesText, type Delivery, type DeliveryReceipt } from '../utils/deliverySchedule';
import { calendarDayOf } from '../utils/calendarDate';
import { buildCrewPresence } from '../utils/crewPresence';
import { describeRecordability } from '../utils/safety/osha';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DFR = readFileSync(join(ROOT, 'app', 'daily-report.tsx'), 'utf8');

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`); }
}

const P = 'proj-1';
const shift = (o: Partial<TimeEntry> & { workerId: string; clockIn: string }): TimeEntry => ({
  id: `te-${o.workerId}-${o.clockIn}`,
  projectId: P,
  projectName: 'Henderson',
  workerName: o.workerId,
  trade: 'Framing',
  breakMinutes: 30,
  totalHours: 9,
  overtimeHours: 1,
  status: 'clocked_out',
  date: o.clockIn.slice(0, 10),
  ...o,
});

console.log('\n#10 crew roster from the time clock:');
{
  // REPRO: schedule says Framing × 4; the foreman clocked 3 framers and 1
  // laborer 6:30–16:00 with a 30-minute break (9 h net, 1 h over 8).
  const inAt = '2026-09-17T13:30:00.000Z'; // 06:30 PDT
  const outAt = '2026-09-17T23:00:00.000Z'; // 16:00 PDT
  const entries: TimeEntry[] = [
    shift({ workerId: 'w1', clockIn: inAt, clockOut: outAt }),
    shift({ workerId: 'w2', clockIn: inAt, clockOut: outAt }),
    shift({ workerId: 'w3', clockIn: inAt, clockOut: outAt }),
    shift({ workerId: 'w4', clockIn: inAt, clockOut: outAt, trade: 'Crew' }),
    // Not this job / no job.
    shift({ workerId: 'w5', clockIn: inAt, clockOut: outAt, projectId: 'other' }),
    shift({ workerId: 'w6', clockIn: inAt, clockOut: outAt, projectId: 'unassigned' }),
  ];
  const crew = clockCrewForDay(entries, P, '2026-09-17', 'Ortiz Builders');
  const framing = crew?.rows.find(r => r.trade === 'Framing');
  const labor = crew?.rows.find(r => r.trade === 'General labor');
  ok('REPRO: 3 framers at 9 h, not the plan\'s 4 × 8', framing?.headcount === 3 && framing.hoursWorked === 9, JSON.stringify(framing));
  ok('REPRO: the laborer is on the report', labor?.headcount === 1 && labor.hoursWorked === 9, JSON.stringify(crew?.rows));
  ok('4 people, 36 h, no overtime under the federal weekly rule (one 9 h day is not OT, #65); other projects and unassigned excluded',
    crew?.people === 4 && crew.totalHours === 36 && crew.overtimeHours === 0, JSON.stringify(crew));
  ok('rows carry the GC\'s company, so crewPresence never folds them into a sub\'s row',
    !!crew && crew.rows.every(r => r.company === 'Ortiz Builders'));
  ok('no company name set → a labelled fallback, never empty',
    clockCrewForDay(entries, P, '2026-09-17', '  ')?.rows.every(r => r.company === OWN_CREW_FALLBACK_COMPANY) === true);
  ok('the chip names the clock, people and hours (no overtime under the weekly rule)',
    !!crew && /^From the time clock: 4 people, 36 h\. Tap a row/.test(clockCrewSourceLine(crew, 0)),
    crew ? clockCrewSourceLine(crew, 0) : 'null');
  // #65 · The GC's optional daily >8 rule: each 9 h day carries 1 h of OT.
  const d8 = clockCrewForDay(entries, P, '2026-09-17', 'Ortiz Builders', undefined, { weeklyThreshold: 40, dailyThreshold: 8, weekStartsOn: 1 });
  ok('under a daily >8 rule the same crew carries 4 h of overtime',
    d8?.overtimeHours === 4 && /36 h \(4 h overtime\)/.test(clockCrewSourceLine(d8, 0)),
    d8 ? `${d8.overtimeHours} / ${clockCrewSourceLine(d8, 0)}` : 'null');
  ok('nobody clocked in → null (the screen falls back to the plan)', clockCrewForDay(entries, P, '2026-09-16', 'X') === null);
  ok('an unassigned report never collects the unassigned clock-ins', clockCrewForDay(entries, 'unassigned', '2026-09-17', 'X') === null);

  // Evening shift: 19:30 PDT on the 17th is 02:30Z on the 18th, and
  // TimeEntry.date was written as the UTC day.
  const evening = shift({ workerId: 'w7', clockIn: '2026-09-18T02:30:00.000Z', clockOut: '2026-09-18T06:30:00.000Z', date: '2026-09-18', totalHours: 3.5, overtimeHours: 0 });
  ok('the day comes from clockIn in local time, not the UTC TimeEntry.date', clockInLocalDay(evening) === '2026-09-17');
  ok('an evening shift lands on tonight\'s report', clockCrewForDay([evening], P, '2026-09-17', 'X')?.people === 1);
  ok('...and not on tomorrow\'s', clockCrewForDay([evening], P, '2026-09-18', 'X') === null);

  // Live shift: on site, hours so far, flagged.
  const now = Date.parse('2026-09-17T18:30:00.000Z'); // 11:30 PDT, 5 h in
  const live = shift({ workerId: 'w8', clockIn: inAt, status: 'clocked_in', totalHours: 0, overtimeHours: 0, breakMinutes: 0 });
  const liveCrew = clockCrewForDay([live], P, '2026-09-17', 'X', now);
  ok('a shift still running counts with its hours so far', liveCrew?.people === 1 && liveCrew.rows[0].hoursWorked === 5 && liveCrew.liveCount === 1, JSON.stringify(liveCrew));
  // Same shifts as the cost book: only a FINISHED shift's stored totalHours is
  // trusted (laborSamples.isEligibleLaborEntry). An open shift carrying a stale
  // stored total (a sync from an earlier break) is timed from clockIn instead.
  const staleLive = shift({ workerId: 'w8', clockIn: inAt, status: 'clocked_in', totalHours: 2, overtimeHours: 0, breakMinutes: 0 });
  ok('an open shift is timed so far, not from a stale stored total',
    clockCrewForDay([staleLive], P, '2026-09-17', 'X', now)?.rows[0].hoursWorked === 5);
  ok('...and the chip says those hours are so far', !!liveCrew && /1 still on the clock, hours so far/.test(clockCrewSourceLine(liveCrew, 2)) && /sub crews from today's schedule plan/.test(clockCrewSourceLine(liveCrew, 2)));
  // Hours so far must not save silently as the day's hours: the chip vanishes
  // on the first edit and never reaches the PDF, so the warning is its own.
  const liveRow = liveCrew!.rows[0];
  const liveWarn = liveClockHoursWarning(liveCrew, [{ trade: liveRow.trade, company: 'X' }]);
  ok('an open shift on the roster raises the hours-so-far warning', !!liveWarn && /^1 person is still on the clock/.test(liveWarn), String(liveWarn));
  ok('...still raised after he edited the row (only trade + company matter)',
    !!liveClockHoursWarning(liveCrew, [{ trade: liveRow.trade, company: 'x ' }]));
  ok('...not raised when the roster holds none of the clock\'s rows', liveClockHoursWarning(liveCrew, [{ trade: 'Framing', company: 'Acme Framing' }]) === null);
  ok('...not raised once everyone clocked out', liveClockHoursWarning(crew, [{ trade: 'Framing', company: 'Ortiz Builders' }]) === null);
  ok('the screen shows the warning on the roster, after save, and before send',
    /const liveHoursWarning = useMemo\(\(\) => liveClockHoursWarning\(clockCrew, manpower\), \[clockCrew, manpower\]\);/.test(DFR)
    && /testID="dfr-live-hours-warning"/.test(DFR)
    && /if \(!silent && liveHoursWarning\) showAlert\('Saved with hours so far', liveHoursWarning\);/.test(DFR)
    && /if \(liveHoursWarning\) \{\s*showAlert\('Crew still on the clock'/.test(DFR));
  ok('open-shift hours keep counting while the screen is open',
    /clockCrewForDay\(timeEntries, project\.id, reportCalendarDay, settings\?\.branding\?\.companyName, liveNowMs, overtimeRule\)/.test(DFR)
    && /setInterval\(\(\) => setLiveNowMs\(Date\.now\(\)\), 60_000\)/.test(DFR));
  ok('a finished shift with zero hours is not evidence of anyone',
    clockCrewForDay([shift({ workerId: 'w9', clockIn: inAt, clockOut: inAt, totalHours: 0, overtimeHours: 0 })], P, '2026-09-17', 'X') === null);
  // Manual / voice logs are all workerId 'self' — two names are two people.
  const selfA = shift({ workerId: 'self', workerName: 'Luis', clockIn: inAt, clockOut: outAt });
  const selfB = shift({ workerId: 'self', workerName: 'Dana', clockIn: inAt, clockOut: outAt });
  ok("'self' entries are told apart by name", clockCrewForDay([selfA, selfB], P, '2026-09-17', 'X')?.people === 2);
  ok('stored per-shift overtime is not trusted (#65): OT comes from the rule, not the row',
    clockCrewForDay([shift({ workerId: 'wx', clockIn: inAt, clockOut: outAt, totalHours: 2, overtimeHours: 9 })], P, '2026-09-17', 'X')?.overtimeHours === 0);

  // crewPresence sees GC framers and a sub's framers as two companies on one trade.
  const presence = buildCrewPresence([{
    id: 'r1', projectId: P, date: '2026-09-17',
    manpower: [
      { id: 'a', trade: 'Framing', company: 'Ortiz Builders', headcount: 3, hoursWorked: 9 },
      { id: 'b', trade: 'Framing', company: 'Acme Framing', headcount: 2, hoursWorked: 8 },
    ],
  } as unknown as DailyFieldReport]);
  const fr = presence.trades.find(t => t.tradeKey === 'framing');
  ok('crewPresence keeps GC and sub framing crews apart by company', JSON.stringify(fr?.companies) === '["Ortiz Builders","Acme Framing"]' && fr?.manHours === 43, JSON.stringify(fr));

  // Screen wiring.
  ok('the screen reads the ONE time-entry store', /const \{ entries: ownTimeEntries, teamEntries, refresh: refreshTimeEntries \} = useTimeEntries\(\);/.test(DFR));
  // #28 × #10: the crew a foreman clocked in lives in teamEntries. Reading only
  // the GC's own entries sent the roster to the schedule plan's 8-hour guess.
  ok('…and the roster counts the crew\'s shifts, not only the signed-in user\'s',
    /const timeEntries = useMemo\(\(\) => mergeTimeEntriesMirror\(ownTimeEntries, teamEntries\), \[ownTimeEntries, teamEntries\]\);/.test(DFR));
  ok('the roster is built from clockCrewForDay on the report\'s calendar day',
    /clockCrewForDay\(timeEntries, project\.id, reportCalendarDay, settings\?\.branding\?\.companyName, liveNowMs, overtimeRule\)/.test(DFR));
  ok('clock rows keep their measured hours (no hardcoded 8 on them)',
    /clockCrew\.rows\.map\(\(r, i\) => \(\{\s*id: clockIds\[i\], trade: r\.trade, company: r\.company, headcount: r\.headcount, hoursWorked: r\.hoursWorked,/.test(DFR));
  ok('only the plan\'s SUB rows (a company other than the GC) join the clocked crew',
    /const subRows = planned\.filter\(g => g\.company && g\.company\.toLowerCase\(\) !== own\);/.test(DFR));
  ok('the seed re-runs when the clocked crew changes, not only on a date change', /\}, \[reportDate, clockCrewSig\]\);/.test(DFR));
  ok('the chip shows the source line', /\{crewSource\?\.line \?\?/.test(DFR));
}

console.log('\n#11 receipts into the daily report:');
{
  const deliveries: Delivery[] = [{
    id: 'd1', projectId: P, description: 'roof trusses', supplier: 'ABC Lumber', poNumber: 'PO-7', expectedDate: '2026-09-17',
    status: 'delivered', createdAt: '', updatedAt: '',
  }];
  const receipt = (o: Partial<DeliveryReceipt>): DeliveryReceipt => ({
    id: 'r', projectId: P, deliveryId: 'd1', date: '2026-09-17', supplier: 'ABC Lumber', poNumber: 'PO-7', items: [],
    hasDamage: false, receivedAt: '2026-09-17T16:00:00.000Z', receivedBy: 'Mike', createdAt: '', updatedAt: '', ...o,
  });
  const damaged = receipt({ id: 'r1', hasDamage: true, damageNotes: '2 trusses cracked at top chord' });
  const lines = receiptLinesForDay([damaged], deliveries, P, '2026-09-17');
  ok('REPRO: the damaged truss load is in Materials delivered, with PO, signer and damage',
    lines.materials[0] === 'roof trusses — ABC Lumber (PO PO-7), received by Mike — DAMAGED: 2 trusses cracked at top chord', lines.materials[0]);
  ok('REPRO: ...and in Issues & Delays', lines.damage.length === 1 && /Damaged delivery: roof trusses from ABC Lumber — 2 trusses cracked at top chord \(received by Mike\)/.test(lines.damage[0]), lines.damage[0]);
  ok('an undamaged load is not an issue', receiptLinesForDay([receipt({ id: 'r2' })], deliveries, P, '2026-09-17').damage.length === 0);
  ok('a receipt with no scheduled delivery names the supplier', receiptMaterialLine(receipt({ deliveryId: undefined, poNumber: undefined }), undefined) === 'ABC Lumber, received by Mike');
  ok('damage with no notes still says damage was noted', /DAMAGED: damage noted at receiving/.test(receiptMaterialLine(receipt({ hasDamage: true }), deliveries[0])));
  ok('another day\'s and another project\'s receipts stay off',
    receiptLinesForDay([receipt({ date: '2026-09-16' }), receipt({ projectId: 'other' })], deliveries, P, '2026-09-17').materials.length === 0);
  // A Friday report filled in on Monday; and an evening report whose instant is tomorrow in UTC.
  const eveningReportInstant = '2026-09-18T03:15:00.000Z'; // 20:15 PDT on the 17th
  ok('the report\'s instant becomes its LOCAL day before matching', calendarDayOf(eveningReportInstant) === '2026-09-17'
    && receiptLinesForDay([damaged], deliveries, P, calendarDayOf(eveningReportInstant)).materials.length === 1);
  ok('merge adds only missing lines', JSON.stringify(mergeReceiptLines(['2x4s', lines.materials[0]], lines.materials)) === JSON.stringify(['2x4s', lines.materials[0]]));
  ok('copy-from-yesterday drops yesterday\'s receipt lines and adds today\'s',
    JSON.stringify(mergeReceiptLines(['yesterday load', 'rebar (typed)'], ['today load'], ['yesterday load'])) === JSON.stringify(['rebar (typed)', 'today load']));

  // Yesterday's damaged load must not reappear as an issue on today's record.
  const yDamage = 'Damaged delivery: roof trusses from ABC Lumber — cracked (received by Mike).';
  const tDamage = 'Damaged delivery: windows from XYZ Glass — chipped.';
  const carried = carryIssuesText(`Rain held up framing.\n${yDamage}`, [tDamage], [yDamage]);
  ok('copy-from-yesterday drops yesterday\'s damage lines and keeps the carried delay',
    carried === `Rain held up framing.\n${tDamage}`, JSON.stringify(carried));
  ok('...adds today\'s damage only once', carryIssuesText(`x\n${tDamage}`, [tDamage], []) === `x\n${tDamage}`);
  ok('...leaves a typed issue that is not a receipt line', carryIssuesText('Inspector no-show', [], [yDamage]) === 'Inspector no-show');
  // The carried note is set first (validate-delay-rfi pins that line), then
  // filtered in the same batch through carryIssuesText.
  ok('the screen carries issues through carryIssuesText with yesterday\'s damage as drop lines',
    /setIssuesAndDelays\(lastReport\.issuesAndDelays\);\s*(?:\/\/[^\n]*\n\s*)*setIssuesAndDelays\(prev => carryIssuesText\(prev, receiptLines\.damage, lastDayReceipts\.damage\)\);/.test(DFR)
    && !/const missingDamage = receiptLines\.damage\.filter/.test(DFR));
  ok('the screen matches on the report\'s calendar day',
    /receiptLinesForDay\(deliveryReceipts, deliveries, projectId \?\? '', reportCalendarDay\)/.test(DFR)
    && /const reportCalendarDay = useMemo\(\(\) => calendarDayOf\(reportDate\), \[reportDate\]\);/.test(DFR));
  ok('copy-from-yesterday re-merges today\'s receipts over yesterday\'s',
    /mergeReceiptLines\(lastReport\.materialsDelivered \?\? \[\], receiptLines\.materials, lastDayReceipts\.materials\)/.test(DFR));
  ok('a fill only replaces an empty or untouched materials list',
    /materialsDelivered\.length === 0 \|\| JSON\.stringify\(materialsDelivered\) === materialsSeedRef\.current/.test(DFR));
  ok('the fill reaches the unsaved-work baseline (DFR-DIRTY-AUTOFILL)',
    /materialsDelivered: existingReport\?\.materialsDelivered \?\? autoFilled\.materialsDelivered \?\? \[\]/.test(DFR)
    && /issuesAndDelays: existingReport\?\.issuesAndDelays \?\? autoFilled\.issuesAndDelays \?\? ''/.test(DFR));
  ok('a saved report can pull loads it is missing', /testID="dfr-add-receipt-lines"/.test(DFR));
}

console.log('\nsafety handoff — the DFR verdict reads the restricted-day count:');
{
  // Scoped to the incidentClassInput memo: the save path further down builds
  // its own input with the same line, so a file-wide match would stay green
  // with the live verdict still ignoring the count.
  const classInputMemo = /const incidentClassInput = useMemo<IncidentClassInput>\(\(\) => \(\{([\s\S]*?)\}\), \[incidentClass\]\);/.exec(DFR)?.[1] ?? '';
  ok('incidentClassInput carries daysRestricted',
    /daysRestricted: Math\.max\(0, parseInt\(incidentClass\.daysRestricted, 10\) \|\| 0\),/.test(classInputMemo), classInputMemo ? '' : 'memo not found');
  const v = describeRecordability({ type: 'injury', treatment: 'first_aid', daysAway: 0, daysRestricted: 5, restrictedDuty: false, lostConsciousness: false, fatality: false } as never);
  ok('5 restricted days with the box off is recordable', v.recordable === true, JSON.stringify(v));
  ok('the box shows on while days are counted, and unticking is refused with the reason',
    /const restrictedShownOn = hasRestriction\(incidentClassInput\);/.test(DFR)
    && /onPress=\{toggleRestrictedDuty\}/.test(DFR)
    && /'Restricted days are counted'/.test(DFR));
}

// The roster re-seeds every minute while someone is on the clock. Ids must be
// a function of the row, not of the moment, or the Edit Crew modal's held id
// stops matching and the super's correction is dropped on Save.
{
  const rows = [
    { trade: 'Framing', company: 'Acme Builders' },
    { trade: 'Electrical', company: 'Sparks LLC' },
    { trade: 'framing ', company: 'acme builders' }, // same key again
  ];
  const a = seedRowIds('clock', rows);
  const b = seedRowIds('clock', rows.map(r => ({ ...r })));
  ok('two seeds of the same crew produce identical row ids', JSON.stringify(a) === JSON.stringify(b), JSON.stringify([a, b]));
  ok('…and the ids are unique within a roster', new Set(a).size === a.length, JSON.stringify(a));
  ok('…and a clock row and a plan row for the same trade do not collide',
    seedRowIds('clock', rows.slice(0, 1))[0] !== seedRowIds('plan', rows.slice(0, 1))[0]);
  const seedEffect = DFR.slice(DFR.indexOf('let seeded: ManpowerEntry[];'), DFR.indexOf('setCrewSource(source);'));
  ok('daily-report builds every seeded row id with seedRowIds, never from Date.now()',
    seedEffect.length > 0 && !/Date\.now\(\)/.test(seedEffect) && !/\$\{stamp\}/.test(seedEffect)
      && (seedEffect.match(/seedRowIds\('(clock|sub|plan)'/g) ?? []).length === 3);
}

// #10 — "Copy from yesterday" replaced today's time-clock roster with
// yesterday's crew and yesterday's hours.
{
  const [clockId] = seedRowIds('clock', [{ trade: 'Framing', company: 'Acme' }]);
  const [subId] = seedRowIds('sub', [{ trade: 'Electrical', company: 'Sparks' }]);
  const today = [{ id: clockId, trade: 'Framing', company: 'Acme', headcount: 4, hoursWorked: 7.5 }];
  const yesterday = [
    { id: clockId, trade: 'Framing', company: 'Acme', headcount: 6, hoursWorked: 9 }, // yesterday's clock
    { id: subId, trade: 'Electrical', company: 'Sparks', headcount: 2, hoursWorked: 8 },
    { id: 'mp-typed-1', trade: 'Cleanup', company: 'Acme', headcount: 1, hoursWorked: 4 },
  ];
  const out = carryForwardManpower(yesterday, today);
  ok("copy keeps TODAY's clock row and its hours (4 × 7.5), not yesterday's (6 × 9)",
    out.filter(r => r.id === clockId).length === 1 && out.find(r => r.id === clockId)?.headcount === 4
      && out.find(r => r.id === clockId)?.hoursWorked === 7.5, JSON.stringify(out));
  ok("…and carries yesterday's sub and typed rows", out.some(r => r.id === subId) && out.some(r => r.id === 'mp-typed-1'));
  // A morning tap, before anyone has clocked in: yesterday's clock row and its
  // measured hours must not ride along — the roster would stop matching the
  // auto-seed and today's clock could never replace them.
  const [planId] = seedRowIds('plan', [{ trade: 'Framing', company: 'Acme' }]);
  const morning = carryForwardManpower(yesterday, [{ id: planId, trade: 'Framing', company: 'Acme', headcount: 3, hoursWorked: 8 }]);
  ok("a copy before anyone clocks in drops yesterday's clock row and its hours",
    !morning.some(r => r.id === clockId) && !morning.some(r => r.hoursWorked === 9), JSON.stringify(morning));
  ok("…keeps today's plan row for the self-perform crew and carries the sub and typed rows",
    morning.some(r => r.id === planId) && morning.some(r => r.id === subId) && morning.some(r => r.id === 'mp-typed-1'));
  ok('with no clock rows on either day it is a plain copy',
    JSON.stringify(carryForwardManpower(yesterday.slice(1), [])) === JSON.stringify(yesterday.slice(1)));
  ok('daily-report copies through carryForwardManpower, never a bare setManpower(lastReport.manpower)',
    /setManpower\(prev => carryForwardManpower\(lastReport\.manpower \?\? \[\], prev\)\);/.test(DFR)
      && !/setManpower\(lastReport\.manpower/.test(DFR));
}

console.log('\nthe clock crew a touched roster does not carry (integration round 1):');
{
  // Morning: "Copy from yesterday" — yesterday's sub row + today's plan guess
  // for the self-perform crew. Then two framers clock in.
  const crew = clockCrewForDay([
    shift({ workerId: 'a', clockIn: '2026-09-17T14:00:00.000Z' }),
    shift({ workerId: 'b', clockIn: '2026-09-17T14:05:00.000Z' }),
  ], P, '2026-09-17', 'Acme')!;
  const [planId] = seedRowIds('plan', [{ trade: 'Framing', company: '' }]);
  const roster = [
    { id: 'sub-1', trade: 'Electrical', company: 'Sparks LLC', headcount: 2, hoursWorked: 8 },
    { id: planId, trade: 'Framing', company: '', headcount: 4, hoursWorked: 8 },
  ];
  const missing = clockRowsMissingFromRoster(crew, roster);
  ok('the clocked framers are found missing from the carried roster', missing.length === 1 && missing[0].headcount === 2, JSON.stringify(missing));
  ok('...and the line says how many, as what the clock holds', clockRosterGapLine(missing) === 'The time clock has 2 people on this job for this day who are not on this roster.', String(clockRosterGapLine(missing)));
  const added = addClockRowsToRoster(roster, crew, 'Acme', r => r);
  ok('"Add them" puts the clock rows on, drops the plan\'s self-perform guess, keeps the sub',
    added.map(r => r.id).join() === `sub-1,${seedRowIds('clock', crew.rows)[0]}` && added[1].headcount === 2, JSON.stringify(added));
  ok('...after which nothing is missing', clockRowsMissingFromRoster(crew, added).length === 0 && clockRosterGapLine([]) === null);
  ok('a typed row for the same crew counts as carried (no nag over his own count)',
    clockRowsMissingFromRoster(crew, [{ trade: 'framing', company: 'ACME' }]).length === 0);
  ok('the screen shows the line on a touched roster with a one-tap add, and never adds by itself',
    /const clockGapLine = useMemo\(\(\) => clockRosterGapLine\(clockRowsMissingFromRoster\(clockCrew, manpower\)\), \[clockCrew, manpower\]\);/.test(DFR)
      && /\{clockGapLine && !isLocked && !manpowerIsUntouchedSeed && \(/.test(DFR)
      && /onPress=\{addMissingClockRows\}/.test(DFR)
      && (DFR.match(/addClockRowsToRoster\(/g) ?? []).length === 1);
  ok('the plan fallback says what the PHONE knows, not that nobody clocked in',
    DFR.includes('no clock-ins for this job and day have reached this phone') && !DFR.includes('nobody clocked in on this job for this day'));
  ok('the report pulls the crew\'s clock-ins when it opens',
    /useEffect\(\(\) => \{ refreshTimeEntries\(\); \}, \[projectId, refreshTimeEntries\]\);/.test(DFR));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
