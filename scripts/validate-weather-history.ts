// Validator: computeWeatherHistory contract — pins the CORRECTED counting
// rules from the 2026-07 tribunal findings:
//   • conditions ALONE never counts (API-autofilled "Light rain" with a full
//     crew working is not a lost day)
//   • loss evidence lives in issuesAndDelays (non-negated) or an explicit
//     stoppage phrase in either field
//   • negations never count ("no rain today", "No weather delays")
//   • month comes from the ISO string, not new Date() (US-timezone
//     off-by-one on the 1st of the month)
//   • per-month values are averages across observed (year, month) buckets —
//     two years of 4-lost-day Januaries → ~4/January, not 8
import { computeWeatherHistory, weatherHistoryFactLine } from '../utils/weatherHistory';
import type { DailyFieldReport } from '../types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); }
}

const makeReport = (date: string, conditions: string, issues = ''): DailyFieldReport => ({
  id: 'dfr-' + date + '-' + Math.random().toString(36).slice(2, 6), projectId: 'p1', date,
  weather: { temperature: '45', conditions, wind: '10mph', isManual: false },
  manpower: [], workPerformed: '', materialsDelivered: [],
  issuesAndDelays: issues, photos: [], status: 'draft',
  createdAt: date + 'T00:00:00Z', updatedAt: date + 'T00:00:00Z',
});

// 1. empty → empty record
console.log('\n[1] Empty input');
ok('empty reports → no entries', Object.keys(computeWeatherHistory([])).length === 0);

// 2. sunny day → not counted
console.log('\n[2] Benign days');
ok('sunny day not counted', Object.keys(computeWeatherHistory([makeReport('2026-07-01', 'Sunny')])).length === 0);

// 3. API-autofilled rainy conditions with NO delay recorded → NOT counted.
//    (Corrected: pre-fix, every rainy-forecast day with a full crew working
//    counted as a lost day.)
ok('conditions "Light rain" alone not counted',
  Object.keys(computeWeatherHistory([makeReport('2026-07-15', 'Light rain')])).length === 0);
ok('conditions "Patchy rain possible" alone not counted',
  Object.keys(computeWeatherHistory([makeReport('2026-11-03', 'Patchy rain possible')])).length === 0);

// 4. Negations → NOT counted (corrected: "no rain" used to count as lost)
console.log('\n[3] Negations');
ok("'Sunny, no rain' in issues → 0",
  Object.keys(computeWeatherHistory([makeReport('2026-07-10', 'Sunny', 'Sunny, no rain')])).length === 0);
ok("'No weather delays today' → 0",
  Object.keys(computeWeatherHistory([makeReport('2026-07-11', 'Cloudy', 'No weather delays today')])).length === 0);
ok("'no rain today, clear skies' → 0",
  Object.keys(computeWeatherHistory([makeReport('2026-03-04', 'Clear', 'no rain today, clear skies')])).length === 0);

// 5. Real losses ARE counted
console.log('\n[4] Evidenced losses');
{
  const r = computeWeatherHistory([makeReport('2026-07-15', 'Rain', 'Rain delay — crews sent home at noon')]);
  ok('rain delay in issuesAndDelays counts for July (month 6)', r[6] === 1);
}
{
  const r = computeWeatherHistory([makeReport('2026-01-10', 'Snow', 'Heavy snow, site closed')]);
  ok('snow stoppage in issues counts for January (month 0)', r[0] === 1);
}
{
  // Explicit stoppage phrase in the conditions field still counts.
  const r = computeWeatherHistory([makeReport('2026-04-02', 'Rained out', '')]);
  ok("conditions 'Rained out' (explicit stoppage) counts", r[3] === 1);
}
{
  // "no work due to rain" contains a negation token but IS a stoppage.
  const r = computeWeatherHistory([makeReport('2026-05-06', 'Rain', 'No work due to rain')]);
  ok("'No work due to rain' counts (stoppage beats negation guard)", r[4] === 1);
}

// 6. Month attribution from the ISO string — the 1st of a month must land in
//    THAT month in every timezone (new Date('YYYY-MM-DD').getMonth() shifts
//    it to the previous month anywhere west of UTC).
console.log('\n[5] Month attribution');
{
  const r = computeWeatherHistory([makeReport('2026-07-01', 'Rain', 'rain delay all morning')]);
  ok('2026-07-01 attributes to July (month 6), not June', r[6] === 1 && r[5] === undefined);
}

// 7. Multi-year normalization: totals are averaged per observed (year, month)
console.log('\n[6] Multi-year normalization');
{
  const reports = [
    // Jan 2025: 4 lost days
    makeReport('2025-01-05', 'Snow', 'snow delay'),
    makeReport('2025-01-06', 'Snow', 'snow delay'),
    makeReport('2025-01-07', 'Snow', 'snow delay'),
    makeReport('2025-01-08', 'Snow', 'snow delay'),
    // Jan 2026: 4 lost days
    makeReport('2026-01-05', 'Snow', 'snow delay'),
    makeReport('2026-01-06', 'Snow', 'snow delay'),
    makeReport('2026-01-07', 'Snow', 'snow delay'),
    makeReport('2026-01-08', 'Snow', 'snow delay'),
  ];
  const r = computeWeatherHistory(reports);
  ok('two 4-lost-day Januaries → ~4/month, not 8', r[0] === 4);
}
{
  // A dry observed January halves the average: 4 lost in 2025, 0 in 2026.
  const reports = [
    makeReport('2025-01-05', 'Snow', 'snow delay'),
    makeReport('2025-01-06', 'Snow', 'snow delay'),
    makeReport('2025-01-07', 'Snow', 'snow delay'),
    makeReport('2025-01-08', 'Snow', 'snow delay'),
    makeReport('2026-01-05', 'Sunny', ''), // observed, no loss
  ];
  const r = computeWeatherHistory(reports);
  ok('lossy year + dry observed year averages (4+0)/2 = 2', r[0] === 2);
}

// 8. Fact line
console.log('\n[7] Fact line');
{
  const factLine = weatherHistoryFactLine({ 6: 4, 7: 3 }, 6);
  ok('fact line non-null with data', factLine !== null);
  ok('fact line is a string', typeof factLine === 'string' && factLine.length > 0);
  ok('fact line rounds to ~4', !!factLine && factLine.includes('~4'));
  ok('empty history → null fact line', weatherHistoryFactLine({}, 6) === null);
  ok('sub-1 average rounds to 0 → suppressed (no "~0 days" noise)',
    weatherHistoryFactLine({ 6: 0.3 }, 6) === null);
}

console.log(`\n${'─'.repeat(40)}`);
console.log(`weather-history: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
