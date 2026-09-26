// scripts/validate-lien-rights-clock.ts
//
// Wave 4 W1: THE NY LIEN-DEADLINE CLOCK (utils/lienRightsClock) and its card.
// The source row (official nysenate.gov page, checkedOn, ≤ 25-word quote),
// the 8- and 4-month dates, month-end clamping, last work = the latest daily
// report on the SAME project, the state parse, the honest reasons, and the
// card's required sentences. Pure — exits non-zero on failure.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LIEN_RULES, lienClockFor, NO_LAST_WORK_REASON, STATE_UNKNOWN_REASON, unsupportedReason,
} from '../utils/lienRightsClock';
import type { Project } from '../types';

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) { console.log(`  PASS ${label}`); passed++; } else { console.error(`  FAIL ${label}`); failed++; }
}
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

type P = Pick<Project, 'id' | 'structuredAddress' | 'location'>;
const sa = (state: string) => ({ street: '1 Main St', city: 'Brooklyn', state, zip: '11215' });
const nyJob: P = { id: 'p1', location: '', structuredAddress: sa('NY') };

console.log('\n── the source row');
{
  const r = LIEN_RULES.NY;
  assert(/^https:\/\/www\.nysenate\.gov\//.test(r.url), `url is on nysenate.gov (${r.url})`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(r.checkedOn), `checkedOn is an ISO day (${r.checkedOn})`);
  const words = r.quote.trim().split(/\s+/).length;
  assert(words > 0 && words <= 25, `quote is ≤ 25 words (${words})`);
  assert(r.statute === 'N.Y. Lien Law § 10' && r.months === 8 && r.monthsSingleFamily === 4, '§ 10: 8 months, 4 for a single-family dwelling');
  assert(/eight months/.test(r.quote), 'the quote carries the eight-month words');
}

console.log('\n── the dates');
{
  const c = lienClockFor({ project: nyJob, dailyReports: [{ projectId: 'p1', date: '2026-06-03' }], today: '2026-09-26' });
  assert(c.kind === 'ny', `NY job with a DFR → ny (${c.kind})`);
  if (c.kind === 'ny') {
    assert(c.lastWorkDay === '2026-06-03' && c.lastWorkSource === 'daily_report', 'last work = the DFR day');
    assert(c.deadline === '2027-02-03', `Jun 3 + 8 → Feb 3 (${c.deadline})`);
    assert(c.deadlineSingleFamily === '2026-10-03', `Jun 3 + 4 → Oct 3 (${c.deadlineSingleFamily})`);
    assert(c.daysLeftSingleFamily === 7, `7 days to Oct 3 from Sep 26 (${c.daysLeftSingleFamily})`);
    assert(c.daysLeft === 130, `130 days to Feb 3 (${c.daysLeft})`);
  }
  const clamp = lienClockFor({ project: nyJob, dailyReports: [{ projectId: 'p1', date: '2026-06-30' }], today: '2026-07-01' });
  assert(clamp.kind === 'ny' && clamp.deadline === '2027-02-28', `month-end clamps: Jun 30 + 8 → Feb 28 (${clamp.kind === 'ny' ? clamp.deadline : clamp.kind})`);
  const leap = lienClockFor({ project: nyJob, dailyReports: [{ projectId: 'p1', date: '2027-10-31' }], today: '2027-11-01' });
  assert(leap.kind === 'ny' && leap.deadlineSingleFamily === '2028-02-29' && leap.deadline === '2028-06-30', `Oct 31 + 4 → Feb 29 (leap), + 8 → Jun 30 (${leap.kind === 'ny' ? `${leap.deadlineSingleFamily} ${leap.deadline}` : leap.kind})`);
  const passed4 = lienClockFor({ project: nyJob, dailyReports: [{ projectId: 'p1', date: '2026-03-01' }], today: '2026-09-26' });
  assert(passed4.kind === 'ny' && passed4.daysLeftSingleFamily < 0 && passed4.daysLeft > 0, 'a past 4-month date reads negative');
}

console.log('\n── last work = the latest DFR on THIS project');
{
  const reports = [
    { projectId: 'p1', date: '2026-05-01' },
    { projectId: 'p1', date: '2026-06-03T14:00:00' },
    { projectId: 'other', date: '2026-09-01' },
    { projectId: 'p1', date: '2026-12-01' }, // after today: a plan, not work
    { projectId: 'p1', date: 'not a date' },
  ];
  const c = lienClockFor({ project: nyJob, dailyReports: reports, today: '2026-09-26' });
  assert(c.kind === 'ny' && c.lastWorkDay === '2026-06-03', `latest same-project, past-dated DFR wins (${c.kind === 'ny' ? c.lastWorkDay : c.kind})`);
  const none = lienClockFor({ project: nyJob, dailyReports: [{ projectId: 'other', date: '2026-09-01' }], today: '2026-09-26' });
  assert(none.kind === 'no_last_work' && none.reason === NO_LAST_WORK_REASON, "another job's DFR never dates this one → no_last_work");
  assert(/last day you furnished work or materials/.test(NO_LAST_WORK_REASON), 'the no_last_work reason says what the clock runs from');
}

console.log('\n── the state');
{
  const dfr = [{ projectId: 'p1', date: '2026-06-03' }];
  for (const s of ['NY', 'New York', 'ny', ' new  york ']) {
    assert(lienClockFor({ project: { ...nyJob, structuredAddress: sa(s) }, dailyReports: dfr, today: '2026-09-26' }).kind === 'ny', `state '${s}' → NY`);
  }
  const free = lienClockFor({ project: { id: 'p1', location: '124 Park Slope, Brooklyn NY 11215' }, dailyReports: dfr, today: '2026-09-26' });
  assert(free.kind === 'ny', `free-text location '…, Brooklyn NY 11215' → NY (${free.kind})`);
  const unknown = lienClockFor({ project: { id: 'p1', location: 'Brooklyn' }, dailyReports: dfr, today: '2026-09-26' });
  assert(unknown.kind === 'state_unknown' && unknown.reason === STATE_UNKNOWN_REASON, 'a city with no state is state_unknown (never guessed)');
  const ct = lienClockFor({ project: { ...nyJob, structuredAddress: sa('CT') }, dailyReports: dfr, today: '2026-09-26' });
  assert(ct.kind === 'unsupported' && ct.state === 'CT' && ct.reason === unsupportedReason('CT') && /No lien-deadline table for CT yet — ask your attorney\./.test(ct.reason), 'CT → unsupported with its reason');
}

console.log('\n── unverified → no dates');
{
  const rule = LIEN_RULES.NY as { verified: boolean };
  const was = rule.verified;
  let c;
  try {
    Object.defineProperty(LIEN_RULES.NY, 'verified', { value: false });
    c = lienClockFor({ project: nyJob, dailyReports: [{ projectId: 'p1', date: '2026-06-03' }], today: '2026-09-26' });
  } catch {
    // Frozen row: prove it by source instead.
    c = null;
  }
  if (c) {
    assert(c.kind === 'ny_unverified' && !('deadline' in c), 'an unverified row yields ny_unverified with no dates');
    Object.defineProperty(LIEN_RULES.NY, 'verified', { value: was });
  } else {
    const src = read('utils/lienRightsClock.ts');
    assert(/if \(!rule\.verified\) return \{ kind: 'ny_unverified' \};/.test(src), 'an unverified row returns ny_unverified before any date is computed');
  }
}

console.log('\n── the card and the module source');
{
  const card = read('components/invoice/LienClockCard.tsx');
  assert(/confirm with your attorney/.test(card), 'card says "confirm with your attorney"');
  assert(/A public job/.test(card), 'card carries the public-job qualifier');
  assert(/dailyReportsLoaded/.test(card) && /Reading your daily log/.test(card), 'card waits for dailyReportsLoaded');
  assert(!/you are entitled|guaranteed/i.test(card), 'card never says "you are entitled" / "guaranteed"');
  assert(/testID="lienclock-card"/.test(card), "card root testID 'lienclock-card'");
  const lib = read('utils/lienRightsClock.ts');
  assert(!/Date\.now\(|new Date\(\)/.test(lib), 'lienClockFor never reads the clock (no Date.now / new Date())');
  assert(!/you are entitled|guaranteed/i.test(lib), 'module never says "you are entitled" / "guaranteed"');
  const screen = read('app/invoice.tsx');
  assert(/existingInvoice && effectiveStatus === 'overdue' && daysPastDue >= 30[\s\S]{0,120}<LienClockCard[\s\S]{0,200}\{\/\* Payment reminders\. Two jobs:/.test(screen), 'invoice mounts LienClockCard for a 30+-day-overdue invoice, directly above Payment reminders');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
