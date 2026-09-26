// validate-nyc-permits.ts — pins the NYC building-record UI (lane L2):
// the measured review-time tier, the building-record client, the card, the
// hooks, and the Permits / project-detail mounts.
//
// WHAT IT PROTECTS
//   • The measured tier is a MEASUREMENT: it fires only at or above
//     MEASURED_LEAD_FLOOR filings, only for a permit type it describes, never
//     over the contractor's own learned record, and its chip always says
//     "approved filings only" (the benchmark omits filings still in review).
//   • The client passes the literal 'building-record' to functions.invoke (the
//     CORS guard can only discover it that way) and never hands raw error text
//     to the screen.
//   • NYC FIRST: the card returns null before drawing anything for a non-NYC
//     job, and every react-query read is gated on `supported`.
//   • "Check with DOB" only ever SUGGESTS a status into the form (setForm); it
//     never writes the permit. The contractor taps Save.
//   • The Permits screen still reads the unscoped `permits` exactly once.
//
// Run: bun run scripts/validate-nyc-permits.ts

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  resolvePermitReviewLead,
  measuredLeadFromBenchmark,
  MEASURED_LEAD_FLOOR,
  STANDARD_PLAN_EXAM_GROUP,
  type MeasuredReviewLead,
} from '../utils/automation/learnedLeadTime';
import { buildingConfirmKey, buildingRecordCacheKey, type ReviewBenchmark } from '../utils/buildingRecord';
import type { Permit, PermitType } from '../types';

const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(name: string, actual: T, expected: T) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  ok(name, a === b, `got ${a}, want ${b}`);
}

const NYC = 'NYC Department of Buildings';
let seq = 0;
function reviewed(days: number, type: PermitType = 'building'): Permit {
  seq += 1;
  const applied = new Date(Date.UTC(2026, 0, 5));
  const approved = new Date(applied.getTime() + days * 86400000);
  return {
    id: `p${seq}`,
    projectId: 'proj',
    type,
    jurisdiction: NYC,
    status: 'approved',
    appliedDate: applied.toISOString().slice(0, 10),
    approvedDate: approved.toISOString().slice(0, 10),
  } as unknown as Permit;
}

function benchmark(n: number, median: number | null = 41, borough = 'BROOKLYN'): ReviewBenchmark {
  return {
    borough,
    jobType: 'A2',
    windowDays: 365,
    windowStart: '2025-09-26',
    windowEnd: '2026-09-26',
    asOf: '2026-09-25',
    datasetId: 'w9ak-ipjd',
    groups: [
      { reviewType: STANDARD_PLAN_EXAM_GROUP, n, medianDays: median, p75Days: 77, p90Days: 120 },
      { reviewType: 'Professional Certification', n: 40000, medianDays: 2, p75Days: 5, p90Days: 9 },
    ],
    truncated: false,
    note: '',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe measured tier:');
{
  const m = measuredLeadFromBenchmark(benchmark(8851));
  ok('a Brooklyn benchmark at n=8,851 converts', !!m);
  const lead = m as MeasuredReviewLead;
  eq('...books the standard-plan-exam median, not the pro-cert one', lead.days, 41);
  eq('...applies to building permits only', lead.appliesTo, ['building']);
  eq('...the detail is the whole provenance clause', lead.detail,
    'median 41d · p75 77d · n=8,851 · Brooklyn standard-plan-exam alteration filings approved in the last 12 mo · NYC Open Data w9ak-ipjd · approved filings only');
  eq('below the floor (n=29) → null', measuredLeadFromBenchmark(benchmark(MEASURED_LEAD_FLOOR - 1)), null);
  eq('no median → null', measuredLeadFromBenchmark(benchmark(500, null)), null);
  eq('a same-day median books 1 day, never 0', measuredLeadFromBenchmark(benchmark(500, 0))?.days, 1);
  eq('no benchmark → null', measuredLeadFromBenchmark(null), null);

  const r = resolvePermitReviewLead({ permits: [], authority: NYC, permitType: 'building', authoredDays: 90, measured: lead });
  eq('measured n=8851 + building → source jurisdiction', r.lead.source, 'jurisdiction');
  eq('...hardDate true', r.hardDate, true);
  ok('...chip contains n=8,851', r.chipLabel.includes('n=8,851'), r.chipLabel);
  ok('...chip contains "approved filings only"', r.chipLabel.includes('approved filings only'), r.chipLabel);
  eq('...sourceLabel', r.sourceLabel, 'measured from NYC DOB filings');

  const thin: MeasuredReviewLead = { ...lead, n: 29 };
  eq('n=29 is ignored', resolvePermitReviewLead({ permits: [], authority: NYC, permitType: 'building', authoredDays: 90, measured: thin }).lead.source, 'ai_estimate');
  const own = [reviewed(18), reviewed(25), reviewed(34)];
  eq('learned (>= 3 own permits) beats measured', resolvePermitReviewLead({ permits: own, authority: NYC, permitType: 'building', measured: lead }).lead.source, 'learned');
  eq('type electrical ignores measured', resolvePermitReviewLead({ permits: [], authority: NYC, permitType: 'electrical', authoredDays: 90, measured: lead }).lead.source, 'ai_estimate');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nstorage keys:');
{
  ok('the confirm key is under mageid_', buildingConfirmKey('abc').startsWith('mageid_'), buildingConfirmKey('abc'));
  ok('the record cache key is under mageid_', buildingRecordCacheKey('1001026', '1000477501').startsWith('mageid_'));
  for (const f of ['hooks/useBuildingRecord.ts', 'hooks/useReviewBenchmark.ts', 'utils/buildingRecordClient.ts', 'components/buildingRecord/BuildingRecordCard.tsx']) {
    const src = read(f);
    const lits = [...src.matchAll(/AsyncStorage\.\w+\(\s*['"`]([^'"`]*)/g)].map(m => m[1]);
    ok(`${f}: every AsyncStorage key literal starts with mageid_`, lits.every(l => l.startsWith('mageid_')), lits.join(', '));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe client:');
{
  const src = read('utils/buildingRecordClient.ts');
  ok("invokes the LITERAL functions.invoke('building-record'", /functions\.invoke\(\s*'building-record'/.test(src));
  ok('never reads .message (no raw error text returned)', !/\.message\b/.test(src));
  ok('every failure is the fixed network sentence', /code: 'network'/.test(src) && /nothing was checked/.test(src));
  ok('parses through parseBuildingRecordResponse', /parseBuildingRecordResponse\(data\)/.test(src));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nNYC first:');
{
  const card = read('components/buildingRecord/BuildingRecordCard.tsx');
  const fn = card.slice(card.indexOf('export function BuildingRecordCard('));
  const early = fn.search(/if \(!br\.supported[^\n]*\) return null;/);
  const firstJsx = fn.search(/<(Card|View|Text)\b/);
  ok('the card has an early `return null` for a non-NYC job', early > 0 && early < firstJsx, `${early} vs ${firstJsx}`);
  ok('the card renders the summary lines exactly (no rewording)', /summary\.lines/.test(fn) && /\{line\}/.test(fn));

  const hook = read('hooks/useBuildingRecord.ts');
  const enables = [...hook.matchAll(/^\s+enabled:\s*([^\n,]+),$/gm)].map(m => m[1]);
  ok('every react-query read in useBuildingRecord is gated on supported', enables.length >= 2 && enables.every(e => /^supported &&/.test(e.trim())), enables.join(' | '));
  ok('the record query key is [building-record, bin, bbl]', /queryKey: \['building-record', bin, bbl\]/.test(hook));
  ok('the record is stale after 12 h', /BUILDING_RECORD_STALE_MS = 12 \* HOUR_MS/.test(hook));
  ok('the first lookup is a tap (resolve only inside lookup())', (hook.match(/mode: 'resolve'/g) ?? []).length === 1 && /const lookup = useCallback\(\(\) => \{[\s\S]*?mode: 'resolve'/.test(hook));
  const effects = hook.split('useEffect(').slice(1).map(b => b.slice(0, 80));
  ok('every effect early-outs on !supported', effects.length > 0 && effects.every(b => /if \(!supported/.test(b)), effects.join(' || '));

  const bench = read('hooks/useReviewBenchmark.ts');
  ok('the benchmark read is gated on supported and a confirmed borough', /enabled: supported && !!borough/.test(bench));
  ok('the benchmark is stale after 7 days', /REVIEW_BENCHMARK_STALE_MS = 7 \* DAY_MS/.test(bench));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\napp/permits.tsx:');
{
  const pm = read('app/permits.tsx');
  const a = pm.indexOf('testID="permit-dob-block"');
  const b = pm.indexOf('testID="permit-draft-question"');
  const region = a > 0 && b > a ? pm.slice(a, b) : '';
  ok('the DOB block exists and ends at the draft-question button', region.length > 0);
  ok('the suggest button exists', region.includes('testID="permit-dob-suggest"'));
  const sug = region.slice(region.lastIndexOf('<Button', region.indexOf('permit-dob-suggest')), region.indexOf('permit-dob-suggest'));
  ok('...its onPress ONLY calls setForm', /onPress=\{\(\) => setForm\(f => \(\{ \.\.\.f, status: suggested \}\)\)\}/.test(sug), sug);
  ok('the DOB path never calls updatePermit or addPermit', !/updatePermit|addPermit/.test(region));
  ok('the DOB block renders only for an NYC job with a number',
    /\{formProject && formIsNyc && form\.permitNumber\.trim\(\) \? \(\(\) => \{/.test(pm));
  ok('a failed dataset reads "not checked"', /`\$\{name\}: not checked`/.test(region));
  ok('each match is printed verbatim with its as-of day', /\$\{m\.datasetName\} \(as of \$\{/.test(region) && /'\$\{m\.statusText\}'/.test(region));
  ok('objections name the applicant of record', region.includes('DOB shows objections issued — your applicant of record answers them.'));
  const runDob = pm.slice(pm.indexOf('const runDobCheck = useCallback('), pm.indexOf('const handleSave = useCallback('));
  ok('runDobCheck only looks up (no permit write)', runDobCheck(runDob));

  const inner = pm.slice(pm.indexOf('function PermitsScreenInner('));
  const raw = inner.match(/\bpermits\.(filter|reduce|forEach|length|map)\b/g) ?? [];
  eq('PermitsScreenInner still reads the unscoped `permits` exactly once', raw.length, 1);
  ok('the scopedProjectId form default is byte-identical',
    /projectId: scopedProjectId\s*\? \(projects\.some\(p => p\.id === scopedProjectId\) \? scopedProjectId : ''\)/.test(pm));
  ok('a new permit defaults its jurisdiction from the scoped job',
    /jurisdiction: \(\(\) => \{ const sp = scopedProjectId \? projects\.find\(p => p\.id === scopedProjectId\) : undefined; return sp \? \(issuingAuthorityForAddress\(jobsiteAddressForProject\(sp\)\) \?\? ''\) : ''; \}\)\(\),/.test(pm));
  ok('the scoped job shows the building record and the department',
    /<BuildingRecordCard project=\{scopedProject\} variant="compact" testID="permits-building-record" \/><DepartmentCard project=\{scopedProject\} testID="permits-department" \/>/.test(pm));
  ok('the form shows the department under the jurisdiction field', /<DepartmentCard project=\{formProject\} testID="permit-form-department" \/>/.test(pm));
}
function runDobCheck(src: string): boolean {
  return /checkDobPermit\(/.test(src) && !/updatePermit|addPermit/.test(src);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\napp/project-detail.tsx:');
{
  const pd = read('app/project-detail.tsx');
  ok('reads the prep param', /prep: prepParam/.test(pd) && /prep\?: string/.test(pd));
  eq('InspectionReadyCard mounts in both branches', (pd.match(/<InspectionReadyCard project=\{project\} openKey=\{prepParam \?\? null\} \/>/g) ?? []).length, 2);
  eq('BuildingRecordCard mounts in both branches', (pd.match(/<BuildingRecordCard project=\{project\} testID="project-building-record" \/>/g) ?? []).length, 2);
  ok('phone: right after </BlueprintReveal>', /<\/BlueprintReveal>\s*<InspectionReadyCard/.test(pd));
  ok('desktop: right after the KPI strip, before the quick actions',
    /onOpenSection=\{openSection\}\s*\/>\s*<InspectionReadyCard[^\n]*\n\s*<BuildingRecordCard[^\n]*\n(?:\s*<ProjectCodeChecksCard project=\{project\} \/>\n)?\s*\{\/\* One row of quick actions/.test(pd));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
