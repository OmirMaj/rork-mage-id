// scripts/validate-code-check-honesty.ts — Code Check says what it is.
//
// IR-L4 (2026-09-25). Construction AI's Code Check used to open its prompt
// with "You are a licensed code-compliance advisor", tell the model to cite
// only what it "would stake its license on", let the MODEL write the
// disclaimer under the answer, and give it "IRC 2021" as the example edition
// — which it then echoed on jobs whose jurisdiction adopts something else. The
// relay scored the call as `general`, so its Pro floor never ran.
//
// This guard pins the fixes:
//   1. no licensed-professional persona anywhere a code answer is drafted;
//   2. the disclaimer is a fixed constant, not a model field;
//   3. both Code Check relay calls carry 'ai_code_check' and the relay gates it;
//   4. the example edition is gone from the prompt;
//   5. editionMismatchFor flags a cited edition the verified row does not
//      adopt, and stays silent where the row is silent;
//   6. the onboarding card no longer claims a code "look up";
//   7. Draft a question routes to the applicant of record without inventing
//      an email, quotes the verified channel note verbatim and asks rather
//      than asserts;
//   7b. it names an applicant ONLY for a filing matched to this job's own
//      permit number, and says "not checked" (never "none") when DOB's
//      filings were not read;
//   8. Draft a question sends nothing itself;
//   9. the Roadmap carries the building record in its prompt and cache key,
//      uses the measured review time, and mounts the building card BEFORE
//      the Generate branch.
//
// Pure: node:fs plus the pure utils. Run via: bun run test:code-check-honesty

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { editionMismatchFor } from '../utils/codeAmendments';
import { CODE_CHECK_DISCLAIMER } from '../utils/codeCheckCopy';
import { departmentFor, resolveCodeJurisdiction, type BuildingDepartment } from '../utils/codeJurisdiction';
import { buildQuestionPrompt, jobFilingFor, questionStageFor, routeQuestion, type JobFiling } from '../utils/departmentQuestion';
import type { BuildingRecord, BuildingRecordDataset, BuildingRecordRow } from '../utils/buildingRecord';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const read = (rel: string): string => {
  try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; }
};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, extra ? `\n     ${extra}` : ''); }
}

const INDEX = 'app/(tabs)/construction-ai/index.tsx';
const index = read(INDEX);
ok(`${INDEX} is readable`, index.length > 0);

// ── 1. No licensed persona ────────────────────────────────────────────────
console.log('\n1. No licensed-professional persona');
for (const f of [INDEX, 'utils/permitRoadmap.ts', 'utils/inspectionPrep.ts', 'utils/departmentQuestion.ts']) {
  const src = read(f);
  ok(`${f} carries no licensed persona`, !/licensed code-compliance|stake your license/i.test(src));
}
ok('Code Check prompt says it answers from memory and is not licensed',
  index.includes('You are answering from your memory of the model codes: you cannot look anything up and you are not a licensed professional.'));
ok('drill-in prompt says it explains from memory',
  index.includes('You are explaining from your memory of the model codes; you cannot look anything up.'));

// ── 2. Fixed disclaimer ───────────────────────────────────────────────────
console.log('\n2. The disclaimer is a constant');
ok('the constant is exact',
  CODE_CHECK_DISCLAIMER === 'AI guidance from model recall, not a code lookup and not legal advice. The local Authority Having Jurisdiction (AHJ) governs — verify before work begins.');
ok('index.tsx renders {CODE_CHECK_DISCLAIMER}', index.includes('{CODE_CHECK_DISCLAIMER}'));
ok('index.tsx renders no model-written result.disclaimer', !/result\.disclaimer/.test(index));
ok('the prompt no longer asks the model for a disclaimer', !/- disclaimer:/.test(index));

// ── 3. The relay tag and the gate ─────────────────────────────────────────
console.log('\n3. Code Check is tagged and gated');
const checkCalls = [...index.matchAll(/mageAISmart\(([^;]*?(?:codeCheckSchema|codeDetailSchema)[^;]*?)\)/g)].map((m) => m[1]);
ok('two relay calls use codeCheckSchema / codeDetailSchema', checkCalls.length === 2, `found ${checkCalls.length}`);
ok('every one carries \'ai_code_check\'', checkCalls.length > 0 && checkCalls.every((a) => /['"]ai_code_check['"]/.test(a)),
  checkCalls.join(' | '));
const relay = read('supabase/functions/ai/index.ts');
const rankMap = relay.match(/FEATURE_MIN_RANK\s*:\s*Record<string,\s*number>\s*=\s*\{([\s\S]*?)\}/);
ok('the relay gates ai_code_check at rank 1 (pro)', !!rankMap && /\bai_code_check\s*:\s*1\b/.test(rankMap[1]));

// ── 4. No example edition ─────────────────────────────────────────────────
console.log('\n4. No example edition in the prompt');
ok('the prompt no longer seeds "IRC 2021", "NYC BC 2022"', !index.includes('"IRC 2021", "NYC BC 2022"'));
ok('the prompt tells the model to use the jurisdiction block edition',
  index.includes('the family and edition exactly as named in the jurisdiction block above'));
ok('"stake your license" is replaced by "certain of it"', index.includes('so cite a section only when you are certain of it.'));

// ── 5. editionMismatchFor ─────────────────────────────────────────────────
console.log('\n5. editionMismatchFor');
const pa = resolveCodeJurisdiction({ city: 'Harrisburg', state: 'PA' });
const philly = resolveCodeJurisdiction({ city: 'Philadelphia', state: 'PA' });
const nyc = resolveCodeJurisdiction({ city: 'Brooklyn', state: 'NY' });
const wa = resolveCodeJurisdiction({ city: 'Spokane', state: 'WA' });
const unknown = resolveCodeJurisdiction({ city: '', state: '' });
ok('fixtures resolve (PA state, Philadelphia city, NYC city, WA state, unknown)',
  pa.kind === 'state' && philly.kind === 'city' && nyc.kind === 'city' && wa.kind === 'state' && unknown.kind === 'unknown',
  `${pa.kind} ${philly.kind} ${nyc.kind} ${wa.kind} ${unknown.kind}`);
const paMis = editionMismatchFor(pa, 'IRC 2018');
ok('PA + IRC 2018 → mismatch, adopts 2021',
  !!paMis && paMis.family === 'IRC' && paMis.citedYear === '2018' && JSON.stringify(paMis.adoptedYears) === '["2021"]');
ok('the label names the cited and adopted editions and the authority',
  !!paMis && paMis.label.startsWith("Edition doesn't match: cited IRC 2018; ") && paMis.label.endsWith('adopts IRC 2021'),
  paMis?.label ?? '');
const phMis = editionMismatchFor(philly, 'IRC 2018');
ok('Philadelphia + IRC 2018 → mismatch, adopts 2021', !!phMis && JSON.stringify(phMis.adoptedYears) === '["2021"]');
ok('Philadelphia + "2021 International Residential Code" → null', editionMismatchFor(philly, '2021 International Residential Code') === null);
ok('PA + IRC 2021 → null', editionMismatchFor(pa, 'IRC 2021') === null);
ok('PA + IRC (no year) → null', editionMismatchFor(pa, 'IRC') === null);
ok('PA + NEC 2017 → null (no NEC on the row is not a mismatch)', editionMismatchFor(pa, 'NEC 2017') === null);
ok('unknown + IRC 2018 → null', editionMismatchFor(unknown, 'IRC 2018') === null);
ok('NYC + IRC 2021 → null (no IRC on the row)', editionMismatchFor(nyc, 'IRC 2021') === null);
const waMis = editionMismatchFor(wa, 'NEC 2020');
ok('WA + NEC 2020 → mismatch, adopts 2023', !!waMis && JSON.stringify(waMis.adoptedYears) === '["2023"]');
ok('WA + NFPA 70 2023 → null', editionMismatchFor(wa, 'NFPA 70 2023') === null);
ok('an unparseable family → null', editionMismatchFor(pa, 'Local ordinance 2018') === null);
ok('ResultModal renders the mismatch badge under the rung badge',
  /\{ev \? <RungBadge ev=\{ev\} testID=\{`code-check-rung-\$\{i\}`\} \/> : null\}\s*\{mismatches\[i\] \?/.test(index)
  && index.includes('testID={`code-check-edition-mismatch-${i}`}'));
ok('the recall chip and rung badge are still there',
  index.includes('<RungBadge ev={ev}') && /Recalling/.test(index));

// ── 6. Onboarding copy ────────────────────────────────────────────────────
console.log('\n6. Onboarding copy');
const onboarding = read('app/onboarding-paywall.tsx');
ok('onboarding-paywall no longer claims "Look up building codes"', onboarding.length > 0 && !onboarding.includes('Look up building codes'));
ok('onboarding-paywall says what it is',
  onboarding.includes("Code guidance for your jurisdiction's adopted edition, permit roadmaps and inspection prep."));

// ── 7. departmentQuestion ─────────────────────────────────────────────────
console.log('\n7. departmentQuestion');
const row = (status: string | null, extra: Partial<BuildingRecordRow> = {}): BuildingRecordRow => ({
  primary: 'B00123456-I1', date: '2026-08-01', status, detail: null, amount: null,
  jobFilingNumber: 'B00123456-I1', applicantName: 'Jane Architect', applicantLicense: '012345',
  applicantTitle: 'RA', ...extra,
});
const stages: [BuildingRecordRow | null, string][] = [
  [null, 'pre_filing'],
  [row('Pending Plan Examiner Approval'), 'in_review'],
  [row('Plan Examiner Review'), 'in_review'],
  [row('Objections'), 'objection'],
  [row('Approved with Objections'), 'objection'],
  [row('Permit Issued'), 'inspection'],
  [row('Permit Entire'), 'inspection'],
  [row('Approved'), 'inspection'],
  [row('Not Approved'), 'general'],
  [row('Disapproved'), 'general'],
  [row('Filed'), 'general'],
  [row(null), 'general'],
];
for (const [f, want] of stages) {
  ok(`questionStageFor(${f ? JSON.stringify(f.status) : 'no filing'}) = ${want}`, questionStageFor(f) === want, `got ${questionStageFor(f)}`);
}

const nycDept = departmentFor(nyc);
ok('the NYC row carries a verified department', !!nycDept);
const synthetic: BuildingDepartment = {
  portalUrl: 'https://example.invalid/portal',
  email: 'desk@example.invalid',
  questionChannels: [
    { stage: 'in_review', label: 'Plan exam', note: 'IN REVIEW NOTE, verbatim.' },
    { stage: 'general', label: 'Help desk', note: 'GENERAL NOTE, verbatim.' },
  ],
  applicantOfRecordNote: 'APPLICANT NOTE.',
  sourceUrl: 'https://example.invalid',
  checkedOn: '2026-09-25',
};
const matched = (f: BuildingRecordRow): JobFiling => ({ state: 'matched', filing: f, asOf: '2026-09-20' });
const NOJOB: JobFiling = { state: 'not_checked', filing: null, asOf: null };
for (const [label, dept] of [['NYC row', nycDept], ['synthetic row', synthetic]] as const) {
  if (!dept) continue;
  const filing = row('Pending Plan Examiner Approval');
  const r = routeQuestion({ department: dept, job: matched(filing), nyc: true });
  const inReview = dept.questionChannels.find((c) => c.stage === 'in_review');
  ok(`${label}: NYC toName is the filing's applicant of record`, r.toName === 'Jane Architect');
  ok(`${label}: toDetail names title, license and filing number`, r.toDetail === 'RA · license 012345 on B00123456-I1', r.toDetail ?? '');
  ok(`${label}: NYC toEmail is null (the dataset has none) even when the row has one`, r.toEmail === null);
  ok(`${label}: the channel is the in-review one`, !!inReview && r.channel === inReview);
  ok(`${label}: whyThisChannel carries the channel note verbatim`, !!inReview && r.whyThisChannel.includes(inReview.note));
  ok(`${label}: whyThisChannel carries the applicant-of-record note`,
    !dept.applicantOfRecordNote || r.whyThisChannel.includes(dept.applicantOfRecordNote));
  const none = routeQuestion({ department: dept, job: NOJOB, nyc: true });
  ok(`${label}: no filing → no name, no email`, none.toName === null && none.toDetail === null && none.toEmail === null);
}
const noTitle = routeQuestion({ department: synthetic, job: matched(row('Filed', { applicantTitle: null, applicantLicense: null })), nyc: true });
ok('a missing title reads "Applicant of record", no license clause', noTitle.toDetail === 'Applicant of record on B00123456-I1', noTitle.toDetail ?? '');
ok('the general channel answers a stage with no channel of its own', noTitle.channel?.label === 'Help desk');
const outside = routeQuestion({ department: synthetic, job: NOJOB, nyc: false });
ok('outside NYC: toEmail is the row email when set', outside.toEmail === 'desk@example.invalid');
ok('outside NYC: no email on the row → null', routeQuestion({ department: { ...synthetic, email: undefined }, job: NOJOB, nyc: false }).toEmail === null);

const { prompt, cacheKey } = buildQuestionPrompt({
  project: { id: 'p1', name: 'Park Slope Reno', location: 'Brooklyn, NY', structuredAddress: { street: '124 Park Pl', city: 'Brooklyn', state: 'NY', zip: '11217' } } as never,
  routing: routeQuestion({ department: synthetic, job: matched(row('Pending Plan Examiner Approval')), nyc: true }),
  question: 'Do we need a separate plumbing filing?',
  buildingSummary: { kind: 'attention', headline: 'H', lines: [], promptBlock: 'BUILDING RECORD BLOCK', chipLabel: '', cacheKey: 'br:x' },
  bin: '3012345',
});
ok('the prompt has no persona', !/\byou are\b/i.test(prompt) && !/licensed/i.test(prompt));
ok("the prompt says 'Ask; do not assert'", prompt.includes('Ask; do not assert'));
ok('the prompt forbids code requirements, fees and legal consequences',
  prompt.includes('Do not state code requirements, fees or legal consequences.'));
ok('the prompt carries the filing number and status verbatim',
  prompt.includes('B00123456-I1') && prompt.includes('Pending Plan Examiner Approval'));
ok('the prompt carries the BIN, the address and the building block',
  prompt.includes('3012345') && prompt.includes('124 Park Pl') && prompt.includes('BUILDING RECORD BLOCK'));
ok('the model writes only subject and body', /- subject:/.test(prompt) && /- body:/.test(prompt) && !/- to:/i.test(prompt));
ok('the cache key moves with the prompt', cacheKey !== buildQuestionPrompt({
  project: null, routing: outside, question: 'Other question', buildingSummary: null,
}).cacheKey);

// ── 7b. Filing state: matched only, and "not checked" is never "none" ────────
console.log('\n7b. Filing state');
const ds = (over: Partial<BuildingRecordDataset>): BuildingRecordDataset => ({
  id: 'w9ak-ipjd', name: 'DOB NOW: Build – Job Application Filings', url: 'https://example.invalid', asOf: '2026-09-20',
  status: 'ok', activeCount: null, returned: 0, limit: 25, truncated: false, flags: [], rows: [], ...over,
});
const rec = (d: BuildingRecordDataset | null): BuildingRecord => ({
  jurisdiction: 'nyc', bin: '1000000', bbl: '1000000000', label: 'x', borough: 'MANHATTAN', fetchedAt: '2026-09-20',
  parcel: { status: 'ok', asOf: null, zoning: [], overlays: [], specialDistricts: [], landmark: null, historicDistrict: null, floodZone2015: null, eDesignation: null, yearBuilt: null, numFloors: null, bldgClass: null, plutoVersion: null },
  datasets: d ? [d] : [], ecbBalanceDue: null, ecbBalanceIsPartial: false,
  links: { bis: '', zola: '', dobNowPortal: '' }, notChecked: [],
});
// Two tenants in one building: the newest OPEN filing is someone else's.
const other = row('Pending Plan Examiner Approval', { primary: 'M01111111-I1', jobFilingNumber: 'M01111111-I1', applicantName: 'Other Tenant Architect' });
const ours = row('Permit Issued', { primary: 'M02222222-I1', jobFilingNumber: 'M02222222-I1', applicantName: 'Our RA' });
const twoTenants = rec(ds({ returned: 2, rows: [other, ours] }));
const draftFor = (job: JobFiling) => {
  const routing = routeQuestion({ department: synthetic, job, nyc: true });
  return { routing, prompt: buildQuestionPrompt({ project: null, routing, question: 'Q?', buildingSummary: null }).prompt };
};
const NONE_WORDS = /none on record|no filing on record|none listed|: none/i;

const nc1 = jobFilingFor(null, ['M02222222-I1']);
ok('no building record → not_checked', nc1.state === 'not_checked' && nc1.filing === null);
for (const st of ['failed', 'timeout'] as const) {
  const j = jobFilingFor(rec(ds({ status: st, rows: [ours] })), ['M02222222-I1']);
  ok(`filings dataset ${st} → not_checked, even with a matching row`, j.state === 'not_checked' && j.filing === null);
}
ok('filings dataset missing → not_checked', jobFilingFor(rec(null), ['M02222222-I1']).state === 'not_checked');
ok('a truncated page with no rows → not_checked, never none', jobFilingFor(rec(ds({ truncated: true })), []).state === 'not_checked');
{
  const { routing, prompt } = draftFor(nc1);
  ok('not_checked: the card says "DOB filings not checked"', routing.toName === null && routing.toFallback.startsWith('DOB filings not checked'), routing.toFallback);
  ok('not_checked: the prompt fact is "not checked", never none', prompt.includes('- Filing: not checked.') && !NONE_WORDS.test(prompt), prompt);
  ok('not_checked: routes to the general channel, not pre-filing', routing.channel?.label === 'Help desk');
}
const n0 = jobFilingFor(rec(ds({})), ['M02222222-I1']);
ok('a clean read with zero rows → none', n0.state === 'none' && n0.asOf === '2026-09-20');
{
  const { routing, prompt } = draftFor(n0);
  ok('none: the card says no DOB NOW filing is listed for the building', routing.toFallback.startsWith('No DOB NOW filing listed for this building'), routing.toFallback);
  ok('none: the prompt scopes it to DOB NOW, as of the read, and names BIS', prompt.includes('- DOB NOW filings listed for this building: none (as of 2026-09-20). Older BIS jobs are not in that list.'));
  ok('none: the prompt never says "none on record for this job"', !/none on record for this job/i.test(prompt));
}
const un = jobFilingFor(twoTenants, []);
ok('two tenants, no job permit number → unmatched (not the other tenant\'s open filing)', un.state === 'unmatched' && un.filing === null);
const un2 = jobFilingFor(twoTenants, ['M09999999-I1', '', null]);
ok('two tenants, a job permit that matches nothing → unmatched', un2.state === 'unmatched' && un2.filing === null);
ok('complete page + a real job number that matches nothing → reason complete', un2.reason === 'complete', String(un2.reason));
// "None matches" is a negative claim: it is allowed ONLY over a complete page AND a real job number.
const NONE_MATCHES = /none matches|matches this job's permit number/i;
const busy = rec(ds({ returned: 25, truncated: true, rows: [other, ours] }));
const partial = jobFilingFor(busy, ['M09999999-I1']);
ok('truncated page with rows, no match → unmatched/partial', partial.state === 'unmatched' && partial.reason === 'partial' && partial.filing === null, String(partial.reason));
ok('truncated page with rows, and a match → still matched', jobFilingFor(busy, ['M02222222-I1']).filing === ours);
// The server keeps only the newest rows: an untruncated page of 12 with 5 rows
// in hand is NOT the whole list, so a miss is 'partial', never "none matches".
{
  const trimmed = rec(ds({ returned: 12, truncated: false, rows: [other, other, other, other, other] }));
  const tj = jobFilingFor(trimmed, ['M02222222-I1']);
  ok('untruncated page, 12 returned but 5 rows kept, no match → unmatched/partial', tj.state === 'unmatched' && tj.reason === 'partial', String(tj.reason));
  const { routing, prompt } = draftFor(tj);
  ok('rows trimmed by the server: neither the card nor the prompt says "matches this job\'s permit number"',
    !NONE_MATCHES.test(routing.toFallback) && !NONE_MATCHES.test(prompt), `${routing.toFallback} | ${prompt}`);
  ok('returned unknown (null), untruncated, no match → partial, never complete',
    jobFilingFor(rec(ds({ returned: null, rows: [other] })), ['M02222222-I1']).reason === 'partial');
}
for (const nums of [[], [null], ['', '  '], ['M'], ['M0222']] as ReadonlyArray<string | null>[]) {
  for (const page of [twoTenants, busy]) {
    const j = jobFilingFor(page, nums);
    ok(`no plausible job number ${JSON.stringify(nums)} (${page === busy ? 'truncated' : 'complete'}) → unmatched/no_numbers`, j.state === 'unmatched' && j.reason === 'no_numbers', String(j.reason));
  }
}
{
  const { routing, prompt } = draftFor(partial);
  ok('partial: the card says MAGE read only the latest filings, never "none matches"',
    routing.toFallback.startsWith("MAGE read only DOB's latest filings on this building; none of those is this job's") && !/matches this job's permit number/.test(routing.toFallback), routing.toFallback);
  ok('partial: the prompt says not identified, read only the latest, and not to say whether anything was filed',
    prompt.includes('- Filing: not identified.') && prompt.includes("MAGE read only DOB's latest filings") && prompt.includes('do not say whether anything has been filed') && !NONE_MATCHES.test(prompt), prompt);
  ok('partial: nobody is named', routing.toName === null && routing.filing === null && !prompt.includes('Other Tenant Architect') && !prompt.includes('Our RA'));
}
for (const nn of [un, jobFilingFor(busy, [])]) {
  const { routing, prompt } = draftFor(nn);
  ok('no_numbers: the card says the job has no permit number in MAGE, never "this job\'s permit number"',
    routing.toFallback.startsWith('This job has no permit number in MAGE to match to a DOB filing') && !NONE_MATCHES.test(routing.toFallback), routing.toFallback);
  ok('no_numbers: the prompt says so and never claims "none matches"',
    prompt.includes('This job has no permit number in MAGE') && prompt.includes('do not say whether anything has been filed') && !NONE_MATCHES.test(prompt), prompt);
}
ok('a JobFiling with no reason is never worded "none matches" (defaults to the partial wording)',
  !NONE_MATCHES.test(routeQuestion({ department: synthetic, job: { state: 'unmatched', filing: null, asOf: null }, nyc: true }).toFallback));
{
  const { routing, prompt } = draftFor(un2);
  ok('unmatched: nobody is named', routing.toName === null && routing.toDetail === null && routing.filing === null);
  ok("unmatched: the card says no filing matches this job's permit number", routing.toFallback.startsWith("No DOB NOW filing on this building matches this job's permit number"), routing.toFallback);
  ok('unmatched: the prompt names neither tenant nor either filing',
    !prompt.includes('Other Tenant Architect') && !prompt.includes('Our RA') && !prompt.includes('M01111111') && !prompt.includes('M02222222'), prompt);
  ok('unmatched: the prompt says the filing is not identified', prompt.includes('- Filing: not identified.'));
}
for (const st of ['not_checked', 'none', 'unmatched'] as const) {
  const r = routeQuestion({ department: synthetic, job: { state: st, filing: other, asOf: null }, nyc: true });
  ok(`${st}: a stray filing on the input still names nobody`, r.toName === null && r.filing === null);
}
const m = jobFilingFor(twoTenants, [null, 'm02222222-i1-pl']);
ok('a job permit with work-type suffix matches its own filing, case-insensitive', m.state === 'matched' && m.filing === ours);
ok('a bare job number matches its -I1 filing', jobFilingFor(twoTenants, ['M02222222']).filing === ours);
{
  const { routing, prompt } = draftFor(m);
  ok('matched: names OUR applicant, never the other tenant', routing.toName === 'Our RA' && !prompt.includes('Other Tenant Architect'));
  ok('matched: a Permit Issued filing reaches the inspection stage (general fallback on this row)',
    questionStageFor(routing.filing) === 'inspection' && routing.channel?.label === 'Help desk');
  ok('matched: the prompt carries our filing number and status verbatim', prompt.includes('- Filing number: M02222222-I1') && prompt.includes('Permit Issued'));
}
const nycInspect = nycDept?.questionChannels.find((c) => c.stage === 'inspection');
if (nycDept && nycInspect) {
  ok('NYC row: a matched Permit Issued filing routes to the inspection channel',
    routeQuestion({ department: nycDept, job: m, nyc: true }).channel === nycInspect);
}
const nycPre = nycDept?.questionChannels.find((c) => c.stage === 'pre_filing');
if (nycDept && nycPre) {
  ok('NYC row: only a clean "none" routes to pre-filing', routeQuestion({ department: nycDept, job: n0, nyc: true }).channel === nycPre
    && routeQuestion({ department: nycDept, job: nc1, nyc: true }).channel !== nycPre
    && routeQuestion({ department: nycDept, job: un, nyc: true }).channel !== nycPre);
}
ok('the prompt forbids saying whether the job was filed without a filing number',
  draftFor(nc1).prompt.includes('Do not say whether the job has been filed unless a filing number is given above.'));

// ── 8. Draft a question sends nothing ─────────────────────────────────────
console.log('\n8. DraftQuestionButton sends nothing');
const dq = read('components/buildingRecord/DraftQuestionButton.tsx');
ok('DraftQuestionButton source is readable', dq.length > 0);
ok('no supabase.functions.invoke', !/functions\.invoke/.test(dq));
ok("no 'send-email'", !dq.includes('send-email'));
ok('no emailService send path', !/emailService|sendEmail/.test(dq));
ok('the card never hard-codes "No filing on record"', !/No filing on record/.test(dq));
ok('the card resolves the filing through jobFilingFor, not the any-open-filing fallback', /jobFilingFor\(/.test(dq) && !/filingForPermit/.test(dq));
ok('returns null before any hook when there is no verified department',
  /const department = departmentFor\([\s\S]*?\);\s*if \(!department[^)]*\) return null;/.test(dq));

// ── 9. Roadmap wiring ─────────────────────────────────────────────────────
console.log('\n9. Roadmap wiring');
ok('roadmapGroundingBlocks gets summary.promptBlock', /roadmapGroundingBlocks\.push\(roadmapBuilding\.summary\.promptBlock\)/.test(index));
ok('the grounding key carries summary.cacheKey', /key: `[^`]*\$\{roadmapBuilding\.summary\.cacheKey\}`/.test(index));
ok('resolvePermitReviewLead gets measured:', /resolvePermitReviewLead\(\{[\s\S]*?measured: roadmapBenchmark[\s\S]*?\}\)/.test(index));
const cardAt = index.indexOf('testID="roadmap-building-record"');
const generateAt = index.indexOf('{roadmapProject && !roadmap ? (');
const permitsAt = index.indexOf('{/* Permits section */}');
ok('the building card mounts once', cardAt >= 0 && index.indexOf('testID="roadmap-building-record"', cardAt + 1) === -1);
ok('the building card comes BEFORE the Generate branch', cardAt >= 0 && generateAt >= 0 && cardAt < generateAt);
ok('the building card is not mounted after the Permits section', permitsAt >= 0 && index.indexOf('roadmap-building-record', permitsAt) === -1);
ok('the department card sits with it', index.indexOf('testID="roadmap-department"') > cardAt && index.indexOf('testID="roadmap-department"') < generateAt);
ok('Draft a question mounts inside the roadmap branch, before Inspections',
  (() => {
    const at = index.indexOf('testID="roadmap-draft-question"');
    return at > permitsAt && at < index.indexOf('{/* Inspections section */}');
  })());
ok("the Roadmap hands Draft a question this job's own permit numbers",
  /<DraftQuestionButton[\s\S]*?permitNumbers=\{permits\.filter\(\(x\) => x\.projectId === roadmapProject\.id\)[\s\S]*?testID="roadmap-draft-question"/.test(index));
ok("an 'attention' building asks before adding a permit",
  /showAlert\(\s*'Before you add this permit'/.test(index) && index.includes("{ text: 'Add anyway', onPress: () => addRoadmapPermit(p) }"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
