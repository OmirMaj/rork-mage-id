// scripts/validate-permit-path-ask.ts — "We don't know yet, so let's ask"
// (lane PPASK): the department question generator and saved answers.
//
// Pins:
//   1-4. Recipients: a name-only office never gets an email; a hand-verified
//        office with no email gets none; a state-list office with an email
//        gets that email; an NYC filing question names nobody, with
//        noRecipientLine verbatim (the applicant-of-record rule).
//   5.   The email body and the call script ask; they never assert ("requires",
//        "must", "code says", "$", "approved", "file for you", "!", "Please").
//   6.   More than 8 questions: 8 asked, the rest counted; order follows
//        STATION_ORDER.
//   7.   answersFor never returns another jurisdiction's answers.
//   8.   isStale at 365 / 366 days on a pinned clock.
//   9.   toRow refuses http links, bad keys, no question ids, future dates; the
//        zod mirror agrees with the SQL CHECKs on ONE case table (this file runs
//        the zod side; `--cases-json` prints the table for the PGlite proof,
//        which runs the same cases against the migration).
//   10.  No direct insert/update/delete of jurisdiction_answers outside
//        utils/offlineQueue.ts: writes go through supabaseWrite.
//   11.  The hook, the sheets and the migration keep their honesty lines.
//
// Pure: imports the PPASK modules (no React Native) and reads the rest as text.
// Run: bun run scripts/validate-permit-path-ask.ts

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAsk, MAX_QUESTIONS_PER_ASK, type AskInput } from '../utils/permitPath/askDepartment';
import {
  answersFor, fromRow, isStale, saidByLabel, toRow, rowSchema, toEngineAnswers, questionTextFor,
  JURISDICTION_KEY_RE, type SavedDeptAnswer, type DeptAnswerInput,
} from '../utils/permitPath/deptAnswers';
import { STATION_ORDER, type DeptQuestion, type StationId } from '../utils/permitPath/types';
import { DEPARTMENTS, NAME_ONLY_NOTE, nameOnlyOffice, type PermitOffice } from '../utils/permitOffices';
import { departmentFor, resolveCodeJurisdiction } from '../utils/codeJurisdiction';
import { noRecipientLine, routeQuestion } from '../utils/departmentQuestion';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TODAY = '2026-10-02';

// ── 9. The shared case table (zod here, SQL in the PGlite proof) ────────────
const BASE_ROW = {
  jurisdiction_key: 'NY:3605934000',
  jurisdiction_name: 'Town of Hempstead',
  question_ids: ['li.survey'],
  question_text: '1. Do you want a survey with the application?',
  answer_text: 'Yes, a survey under a year old.',
  answered_on: '2026-09-14',
  said_by_name: 'J. Smith',
  said_by_role: 'plans examiner',
  channel: 'phone',
  source_url: null as string | null,
  project_id: null as string | null,
};
type CaseRow = typeof BASE_ROW & { id: string };
interface Case { name: string; row: Partial<Record<keyof CaseRow, unknown>>; ok: boolean }
const RAW_CASES: Case[] = [
  { name: 'base row', row: {}, ok: true },
  { name: 'http link refused', row: { source_url: 'http://hempsteadny.gov/191' }, ok: false },
  { name: 'https link accepted', row: { source_url: 'https://hempsteadny.gov/191/Building-Department' }, ok: true },
  { name: 'HTTPS in capitals refused (the SQL prefix is case-sensitive)', row: { source_url: 'HTTPS://hempsteadny.gov' }, ok: false },
  { name: 'link over 2000 characters refused', row: { source_url: 'https://' + 'a'.repeat(1993) }, ok: false },
  { name: 'key NYC', row: { jurisdiction_key: 'NYC' }, ok: true },
  { name: 'key NJ 4-digit', row: { jurisdiction_key: 'NJ:0714' }, ok: true },
  { name: 'key CT id', row: { jurisdiction_key: 'CT:groton-long-point' }, ok: true },
  { name: 'key MD county', row: { jurisdiction_key: 'MD:24510' }, ok: true },
  { name: 'key NY 7-digit place', row: { jurisdiction_key: 'NY:3611000' }, ok: true },
  { name: 'key UNRESOLVED refused', row: { jurisdiction_key: 'UNRESOLVED' }, ok: false },
  { name: 'key NY too short refused', row: { jurisdiction_key: 'NY:123' }, ok: false },
  { name: 'key NJ 5-digit refused', row: { jurisdiction_key: 'NJ:12345' }, ok: false },
  { name: 'key lower-case refused', row: { jurisdiction_key: 'ny:3605934000' }, ok: false },
  { name: 'key with a trailing space refused', row: { jurisdiction_key: 'NYC ' }, ok: false },
  { name: 'empty question_ids refused', row: { question_ids: [] }, ok: false },
  { name: '20 question ids accepted', row: { question_ids: Array.from({ length: 20 }, (_, i) => `li.q${i}`) }, ok: true },
  { name: '21 question ids refused', row: { question_ids: Array.from({ length: 21 }, (_, i) => `li.q${i}`) }, ok: false },
  { name: 'a question id with a space refused', row: { question_ids: ['li survey'] }, ok: false },
  { name: 'an empty question id refused', row: { question_ids: [''] }, ok: false },
  { name: 'future date refused', row: { answered_on: '2999-01-01' }, ok: false },
  { name: 'not a calendar day refused', row: { answered_on: '2026-02-30' }, ok: false },
  { name: 'an old date accepted', row: { answered_on: '2020-01-01' }, ok: true },
  { name: 'empty answer refused', row: { answer_text: '' }, ok: false },
  { name: '4000-character answer accepted', row: { answer_text: 'a'.repeat(4000) }, ok: true },
  { name: '4001-character answer refused', row: { answer_text: 'a'.repeat(4001) }, ok: false },
  { name: '4000 emoji accepted (characters, not UTF-16 units)', row: { answer_text: '😀'.repeat(4000) }, ok: true },
  { name: 'name of 120 accepted', row: { said_by_name: 'n'.repeat(120) }, ok: true },
  { name: 'name of 121 refused', row: { said_by_name: 'n'.repeat(121) }, ok: false },
  { name: 'title of 121 refused', row: { said_by_role: 'r'.repeat(121) }, ok: false },
  { name: 'no name or title accepted', row: { said_by_name: null, said_by_role: null }, ok: true },
  { name: 'channel fax refused', row: { channel: 'fax' }, ok: false },
  { name: 'channel counter accepted', row: { channel: 'counter' }, ok: true },
  { name: 'empty jurisdiction name refused', row: { jurisdiction_name: '' }, ok: false },
  { name: 'jurisdiction name of 201 refused', row: { jurisdiction_name: 'x'.repeat(201) }, ok: false },
  { name: 'empty question text refused', row: { question_text: '' }, ok: false },
  { name: 'question text of 2001 refused', row: { question_text: 'q'.repeat(2001) }, ok: false },
];
export const CASES: (Case & { row: CaseRow })[] = RAW_CASES.map((c, i) => ({
  ...c,
  row: { ...BASE_ROW, ...c.row, id: `20000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}` } as CaseRow,
}));

if (process.argv.includes('--cases-json')) {
  console.log(JSON.stringify(CASES));
  process.exit(0);
}

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function section(s: string) { console.log(`\n${s}`); }
/** Source with comments removed. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
}
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

// ── Fixtures ────────────────────────────────────────────────────────────────
const q = (id: string, station: StationId, text: string): DeptQuestion => ({ id, station, text, askIf: null });
const LI_QS: DeptQuestion[] = [
  q('li.survey', 'drawings', 'Do you want a survey with the application for <scope>?'),
  q('li.sealed', 'drawings', 'Do the drawings for <scope> need an architect’s or engineer’s seal?'),
  q('li.co_search', 'checks', 'Do you want a certificate of occupancy search before we file?'),
];
const HEMPSTEAD = DEPARTMENTS['NY:3605934000'];
const NAME_ONLY = nameOnlyOffice('NY', 'Village of Garden City', '3628178');
const CT_WITH_EMAIL = Object.values(DEPARTMENTS).find((o) => o.verification === 'state-list' && !!o.email) ?? null;
const routeFor = (family: 'nyc' | 'ny_town' | 'ny_village', key: string, name: string, officeTitle: string | null) => ({
  jurisdiction: { key, family, name, officeTitle, headline: null, cautions: [], countyFips: null },
});
const base = (over: Partial<AskInput>): AskInput => ({
  route: routeFor('ny_town', 'NY:3605934000', 'Town of Hempstead', 'Town of Hempstead Department of Buildings'),
  questions: LI_QS,
  office: HEMPSTEAD,
  nycDepartment: null,
  nycRouting: null,
  address: '12 Elm St, Hempstead, NY 11550',
  company: 'Majeed Builders',
  scopeLine: 'a kitchen and bath renovation',
  today: TODAY,
  ...over,
});

// ── 1-4. Recipients ─────────────────────────────────────────────────────────
section('1-4. Recipients come from the office’s own source, never invented');
ok('fixtures: Hempstead is a hand-verified office with no email', !!HEMPSTEAD && HEMPSTEAD.verification === 'hand-verified' && HEMPSTEAD.email === null);
ok('fixtures: a state-list office with an email exists', !!CT_WITH_EMAIL, 'no state-list office carries an email');
{
  // A name-only office with an email planted on it: still never used.
  const planted: PermitOffice = { ...NAME_ONLY, email: 'clerk@example.gov', phone: '516-555-0100' };
  const d = buildAsk(base({ office: planted, route: routeFor('ny_village', planted.key, planted.jurisdiction, null) }));
  ok('1. a name-only office gives to === null (even with an email planted on the row)', d.to === null, `to=${d.to}`);
  ok('1. its toNote names the office', d.toNote.includes(planted.title), d.toNote);
  ok('1. a name-only office dials nothing (no verified phone)', d.call.tel === null && d.call.phoneLabel === null, JSON.stringify(d.call.tel));
  ok('1. its source line is NAME_ONLY_NOTE and the draft says nameOnly', d.sourceLine === NAME_ONLY_NOTE && d.nameOnly === true);
}
{
  const d = buildAsk(base({}));
  ok('2. a hand-verified office with no email gives to === null', d.to === null, `to=${d.to}`);
  ok('2. toNote says there is no email on file for the office', d.toNote === `No email on file for ${HEMPSTEAD.title}. Call them, or look up their email on their site.`, d.toNote);
  ok('2. the call dials the main number only (tel:5165388500)', d.call.tel === 'tel:5165388500' && d.call.phoneLabel === HEMPSTEAD.phone, String(d.call.tel));
  ok('2. hours and source come from the office row', d.call.hours === HEMPSTEAD.hours && d.sourceLine === HEMPSTEAD.sourceLabel && d.nameOnly === false);
  ok('2. subject is "Permit question · <address> · <office>"', d.subject === `Permit question · 12 Elm St, Hempstead, NY 11550 · ${HEMPSTEAD.title}`, d.subject);
}
if (CT_WITH_EMAIL) {
  const d = buildAsk(base({ office: CT_WITH_EMAIL, route: routeFor('ny_town', CT_WITH_EMAIL.key, CT_WITH_EMAIL.jurisdiction, null) }));
  ok('3. a state-list office with an email gives that email', d.to === CT_WITH_EMAIL.email, `to=${d.to}`);
  ok('3. toNote says where the email came from', d.toNote.includes(CT_WITH_EMAIL.sourceLabel), d.toNote);
}
const NYC_DEPT = departmentFor(resolveCodeJurisdiction({ city: 'Brooklyn', state: 'NY' }));
ok('fixtures: the NYC department row resolves', !!NYC_DEPT);
if (NYC_DEPT) {
  const nycRoute = routeFor('nyc', 'NYC', 'New York City', 'NYC Department of Buildings');
  const filingQ = [q('nyc.job_type_q', 'filing', 'Is this an Alteration or an Alteration-CO filing?')];
  for (const state of ['none', 'not_checked'] as const) {
    const routing = routeQuestion({ department: NYC_DEPT, job: { state, filing: null, asOf: null }, nyc: true });
    const d = buildAsk(base({ office: null, route: nycRoute, nycDepartment: NYC_DEPT, nycRouting: routing, questions: filingQ }));
    ok(`4. NYC filing question (filings ${state}): to === null`, d.to === null, `to=${d.to}`);
    ok(`4. … with noRecipientLine('${state}', true) verbatim`, d.toNote === noRecipientLine(state, true), d.toNote);
  }
  {
    const d = buildAsk(base({ office: null, route: nycRoute, nycDepartment: NYC_DEPT, nycRouting: null, questions: filingQ }));
    ok('4. NYC filing question with no routing: to === null with noRecipientLine(not_checked)', d.to === null && d.toNote === noRecipientLine('not_checked', true), d.toNote);
  }
  {
    // A mixed draft (a filing question among others) still names nobody.
    const routing = routeQuestion({ department: NYC_DEPT, job: { state: 'none', filing: null, asOf: null }, nyc: true });
    const d = buildAsk(base({ office: null, route: nycRoute, nycDepartment: NYC_DEPT, nycRouting: routing, questions: [...LI_QS, ...filingQ] }));
    ok('4. a draft that includes a filing question names nobody', d.to === null && d.toNote === noRecipientLine('none', true), d.toNote);
    const plain = buildAsk(base({ office: null, route: nycRoute, nycDepartment: NYC_DEPT, nycRouting: routing, questions: LI_QS }));
    const chEmail = routing.channel?.email ?? null;
    ok('4. a non-filing NYC draft uses the routed channel’s own email, or none', plain.to === chEmail, `to=${plain.to} channel=${chEmail}`);
    ok('4. NYC source line is the department row’s', plain.sourceLine.includes(NYC_DEPT.checkedOn), plain.sourceLine);
  }
}
{
  const d = buildAsk(base({ office: null, route: null }));
  ok('no office and no department: to === null, a call with no number', d.to === null && d.call.tel === null && d.call.phoneLabel === null);
}

// ── 5. The text asks; it never asserts ─────────────────────────────────────
section('5. Body and call text ask; they never assert');
const BANNED = [/requires/i, /\bmust\b/i, /code says/i, /\$/, /approved/i, /file for you/i, /!/, /please/i];
const drafts = [
  buildAsk(base({})),
  buildAsk(base({ office: NAME_ONLY })),
  ...(CT_WITH_EMAIL ? [buildAsk(base({ office: CT_WITH_EMAIL }))] : []),
  ...(NYC_DEPT ? [buildAsk(base({ office: null, nycDepartment: NYC_DEPT, route: routeFor('nyc', 'NYC', 'New York City', null) }))] : []),
  buildAsk(base({ company: '', scopeLine: '', address: '' })),
];
for (const [i, d] of drafts.entries()) {
  const text = [d.subject, d.body, d.call.opener, ...d.call.numbered, ...d.call.capture].join('\n');
  const hits = BANNED.filter((re) => re.test(text)).map(String);
  ok(`draft ${i + 1}: no banned word in subject, body or call`, hits.length === 0, hits.join(', '));
}
{
  const d = buildAsk(base({}));
  ok('the body greets, gives the address and scope in one line, numbers the questions, and signs off', /^Hello,\n\nI have a few questions about a job at 12 Elm St, Hempstead, NY 11550: a kitchen and bath renovation\.\n\n1\. /.test(d.body) && /\n\nThank you,\nMajeed Builders$/.test(d.body), d.body);
  ok('<scope> is filled in every question', !d.body.includes('<scope>') && d.body.includes('application for a kitchen and bath renovation?'));
  ok('the call opener names the company and the address', d.call.opener === 'Hi, I\'m Majeed Builders, a contractor. I have a few questions about a job at 12 Elm St, Hempstead, NY 11550.', d.call.opener);
  ok('the call capture list', JSON.stringify(d.call.capture) === JSON.stringify(['Their name', 'Their title', 'Today’s date', 'What they said, in their words']));
  ok('call questions equal the email questions, without numbers', d.call.numbered.length === 3 && d.call.numbered.every((t, i) => d.body.includes(`${i + 1}. ${t}`)));
}

// ── 6. Grouping ─────────────────────────────────────────────────────────────
section('6. At most 8 per draft, in station order');
{
  const shuffled: DeptQuestion[] = [
    q('s1', 'signoff', 'Signoff one?'), q('w1', 'work', 'Work one?'), q('f1', 'filing', 'Filing one?'),
    q('c1', 'checks', 'Checks one?'), q('d1', 'drawings', 'Drawings one?'), q('r1', 'review', 'Review one?'),
    q('c2', 'checks', 'Checks two?'), q('sc1', 'scope', 'Scope one?'), q('i1', 'issued', 'Issued one?'),
    q('f2', 'filing', 'Filing two?'), q('c1', 'checks', 'Checks one again (duplicate id)?'),
  ];
  const d = buildAsk(base({ questions: shuffled }));
  const rank = (id: string) => STATION_ORDER.indexOf(shuffled.find((x) => x.id === id)!.station);
  const all = [...d.questionIds, ...d.remainingIds];
  ok('8 asked, the rest counted (10 unique → remaining 2)', d.questionIds.length === MAX_QUESTIONS_PER_ASK && d.remaining === 2 && d.remainingIds.length === 2, JSON.stringify([d.questionIds, d.remainingIds]));
  ok('every id once (duplicates collapse)', new Set(all).size === all.length && all.length === 10);
  ok('order follows STATION_ORDER', all.every((id, i) => i === 0 || rank(all[i - 1]) <= rank(id)), all.join(','));
  ok('within a station, the input order stands (c1 before c2, f1 before f2)', all.indexOf('c1') < all.indexOf('c2') && all.indexOf('f1') < all.indexOf('f2'));
  ok('the body numbers exactly the 8 asked', /\n8\. /.test(d.body) && !/\n9\. /.test(d.body));
  const next = buildAsk(base({ questions: shuffled.filter((x) => d.remainingIds.includes(x.id)) }));
  ok('"Ask the next 2" builds a draft of the rest', next.questionIds.join() === d.remainingIds.join() && next.remaining === 0);
}

// ── 7. answersFor ───────────────────────────────────────────────────────────
section('7. Saved answers never cross jurisdictions');
const row = (over: Record<string, unknown>) => fromRow({ ...BASE_ROW, id: '30000000-0000-4000-8000-000000000001', created_at: '2026-09-14T15:00:00Z', ...over }) as SavedDeptAnswer;
const ROWS: SavedDeptAnswer[] = [
  row({ id: '30000000-0000-4000-8000-000000000001', jurisdiction_key: 'NY:3605934000', answered_on: '2026-09-01' }),
  row({ id: '30000000-0000-4000-8000-000000000002', jurisdiction_key: 'NY:3605953000' }),
  row({ id: '30000000-0000-4000-8000-000000000003', jurisdiction_key: 'NY:3605934000', answered_on: '2026-09-20' }),
  row({ id: '30000000-0000-4000-8000-000000000004', jurisdiction_key: 'NY:36059340001' }),
  row({ id: '30000000-0000-4000-8000-000000000005', jurisdiction_key: 'NYC' }),
];
{
  const got = answersFor(ROWS, 'NY:3605934000');
  ok('answersFor returns only the exact key', got.length === 2 && got.every((a) => a.jurisdictionKey === 'NY:3605934000'), got.map((a) => a.jurisdictionKey).join(','));
  ok('a key that is a prefix of another never matches it', answersFor(ROWS, 'NY:36059340001').length === 1 && answersFor(ROWS, 'NY:360593400').length === 0);
  ok('newest answer first', got[0]?.answeredOn === '2026-09-20');
  ok('a null key returns nothing', answersFor(ROWS, null).length === 0 && answersFor(ROWS, '').length === 0);
  const eng = toEngineAnswers([row({ question_ids: ['li.survey', 'li.sealed'] })]);
  ok('toEngineAnswers: one engine element per question id, same answer id and key', eng.length === 2 && eng[0].questionId === 'li.survey' && eng[1].questionId === 'li.sealed' && eng.every((e) => e.id === '30000000-0000-4000-8000-000000000001' && e.jurisdictionKey === 'NY:3605934000'));
  const one = row({});
  ok('fromRow: saidBy is "name · role"', one.saidBy === 'J. Smith · plans examiner', String(one.saidBy));
  ok('fromRow: saidBy null with neither', row({ said_by_name: null, said_by_role: '' }).saidBy === null);
  ok('fromRow drops a malformed row (no question ids / bad channel / bad date)',
    fromRow({ ...BASE_ROW, id: 'x', question_ids: [] }) === null
    && fromRow({ ...BASE_ROW, id: 'x', channel: 'fax' }) === null
    && fromRow({ ...BASE_ROW, id: 'x', answered_on: 'soon' }) === null);
  ok('fromRow never shows a non-https link', row({ source_url: 'http://x.gov' }).sourceUrl === null);
  ok('saidByLabel: "J. Smith, plans examiner"', saidByLabel(one) === 'J. Smith, plans examiner');
  ok('saidByLabel: nobody named → "Building department"', saidByLabel({ saidByName: null, saidByRole: ' ' }) === 'Building department');
  ok('saidByLabel: role only is capitalised', saidByLabel({ saidByName: null, saidByRole: 'plans examiner' }) === 'Plans examiner');
}

// ── 8. isStale ──────────────────────────────────────────────────────────────
section('8. Stale after 365 days (pinned clock)');
ok('365 days old is not stale', isStale({ answeredOn: '2025-10-02' }, TODAY) === false);
ok('366 days old is stale', isStale({ answeredOn: '2025-10-01' }, TODAY) === true);
ok('across a leap day: 2024-02-28 → 2025-02-28 is 366 days, stale', isStale({ answeredOn: '2024-02-28' }, '2025-02-28') === true);
ok('a custom window', isStale({ answeredOn: '2026-09-01' }, TODAY, 30) === true && isStale({ answeredOn: '2026-09-02' }, TODAY, 30) === false);
ok('an unparseable date is never called stale (and never fresh-labelled by this)', isStale({ answeredOn: 'soon' }, TODAY) === false);

// ── 9. toRow and the shared case table ──────────────────────────────────────
section('9. toRow, and the zod mirror of the SQL checks');
const INPUT: DeptAnswerInput = {
  id: '40000000-0000-4000-8000-000000000001',
  jurisdictionKey: 'NY:3605934000',
  jurisdictionName: 'Town of Hempstead',
  questionIds: ['li.survey', 'li.survey', 'li.sealed'],
  questionText: questionTextFor(['Do you want a survey?', 'Do the drawings need a seal?']),
  answerText: '  Yes, a survey under a year old.  ',
  answeredOn: '2026-09-14',
  saidByName: ' ',
  saidByRole: 'plans examiner',
  channel: 'phone',
  sourceUrl: '',
  projectId: null,
};
{
  const r = toRow(INPUT, { today: TODAY });
  ok('a good input becomes a row', r.ok);
  if (r.ok) {
    ok('the row never carries user_id', !('user_id' in r.row));
    ok('text trimmed, blanks become null, duplicate ids collapse', r.row.answer_text === 'Yes, a survey under a year old.' && r.row.said_by_name === null && r.row.source_url === null && r.row.question_ids.join() === 'li.survey,li.sealed');
  }
  const bad = (over: Partial<DeptAnswerInput>) => toRow({ ...INPUT, ...over }, { today: TODAY });
  const http = bad({ sourceUrl: 'http://hempsteadny.gov' });
  ok('refuses an http link, with the reason', !http.ok && http.reason === 'Links start with https://');
  ok('refuses a key that fails the regex', !bad({ jurisdictionKey: 'UNRESOLVED' }).ok && !bad({ jurisdictionKey: 'NY:12' }).ok);
  const none = bad({ questionIds: [] });
  ok('refuses an empty question list', !none.ok && none.reason === 'Tick the questions this answers');
  ok('refuses a future date (two days ahead)', !bad({ answeredOn: '2026-10-04' }).ok);
  ok('accepts tomorrow (the SQL allows New York’s day + 1)', bad({ answeredOn: '2026-10-03' }).ok);
  const empty = bad({ answerText: '   ' });
  ok('a blank answer is blocked with "Add what they said"', !empty.ok && empty.reason === 'Add what they said');
  ok('questionTextFor caps at 2000 characters', [...questionTextFor(['x'.repeat(3000)])].length === 2000);
}
{
  const schema = rowSchema(TODAY);
  const disagree = CASES.filter((c) => schema.safeParse(c.row).success !== c.ok);
  ok(`the zod mirror agrees with the expected outcome on all ${CASES.length} shared cases`, disagree.length === 0, disagree.map((c) => c.name).join('; '));
  ok('the case table covers http, key, empty ids and future date', ['http link refused', 'key UNRESOLVED refused', 'empty question_ids refused', 'future date refused'].every((n) => CASES.some((c) => c.name === n)));
  ok('JURISDICTION_KEY_RE matches every PermitOffice key in DEPARTMENTS', Object.keys(DEPARTMENTS).every((k) => JURISDICTION_KEY_RE.test(k)), Object.keys(DEPARTMENTS).filter((k) => !JURISDICTION_KEY_RE.test(k)).slice(0, 5).join(','));
  const mig = read('supabase/migrations/20261002170000_jurisdiction_answers.sql');
  ok('the migration carries the same key regex', mig.includes(`'${JURISDICTION_KEY_RE.source}'`));
  ok('the migration carries the same channel list', mig.includes(`channel in ('phone','email','counter','website','letter','other')`));
}

// ── 10. Writes only through the offline queue ───────────────────────────────
section('10. jurisdiction_answers is written only through supabaseWrite');
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(e)) out.push(full);
  }
  return out;
}
{
  const files = ['app', 'components', 'hooks', 'contexts', 'utils', 'lib'].flatMap((d) => walk(join(ROOT, d)));
  const direct = /\.from\(\s*(?:['"`]jurisdiction_answers['"`]|JURISDICTION_ANSWERS_TABLE)\s*\)[\s\S]{0,200}?\.(insert|update|upsert|delete)\(/;
  const offenders = files.filter((f) => !f.endsWith(join('utils', 'offlineQueue.ts')) && direct.test(code(readFileSync(f, 'utf8'))));
  ok('no direct insert/update/upsert/delete outside utils/offlineQueue.ts', offenders.length === 0, offenders.map((f) => relative(ROOT, f)).join(', '));
  const hook = code(read('hooks/useJurisdictionAnswers.ts'));
  ok('the hook writes through supabaseWriteDetailed insert and delete', /supabaseWriteDetailed\(\s*JURISDICTION_ANSWERS_TABLE,\s*'insert'/.test(hook) && /supabaseWriteDetailed\(\s*JURISDICTION_ANSWERS_TABLE,\s*'delete'/.test(hook));
  ok('the hook reads named columns, filtered by the exact key', /\.select\(ANSWER_COLUMNS\)/.test(hook) && /\.eq\('jurisdiction_key', key\)/.test(hook));
  ok('the hook uses the query key [\'jurisdiction-answers\', key]', /\['jurisdiction-answers', key\]/.test(hook));
  ok('the hook re-filters what it shows by the exact key (answersFor)', /answersFor\(/.test(hook));
  ok('the hook keeps no AsyncStorage key of its own', !/AsyncStorage/.test(hook));
  ok('the offline toast copy', hook.includes('Saved offline. It sends when you’re back online.') && hook.includes('Answer saved'));
}

// ── 11. The sheets and the migration keep their honesty lines ───────────────
section('11. Sheets and migration');
{
  const ask = code(read('components/permitPath/AskDepartmentSheet.tsx'));
  ok('the ask sheet opens the GC’s own mail app (MailComposer, mailto fallback) and copies; it sends nothing itself', /MailComposer\.composeAsync/.test(ask) && /mailto:/.test(ask) && /copyToClipboard/.test(ask) && !/supabase|fetch\(|functions\.invoke/.test(ask));
  ok('recipients come from draft.to only', /draft\.to \? \[draft\.to\] : \[\]/.test(ask));
  ok('the call button dials draft.call.tel only', /Linking\.openURL\(draft\.call\.tel\)/.test(ask));
  ok('the footer shows the source line and NAME_ONLY_BADGE for a name-only office', /draft\.sourceLine/.test(ask) && /draft\.nameOnly \?[\s\S]{0,200}NAME_ONLY_BADGE/.test(ask));
  const save = code(read('components/permitPath/SaveAnswerSheet.tsx'));
  ok('the save sheet uses DatePickerModal and formatCalendarDay (no hand-formatted dates)', /DatePickerModal/.test(save) && /formatCalendarDay\(/.test(save) && !/toLocaleDateString|toISOString\(\)\.slice/.test(save));
  ok('save is blocked with a reason until valid', /disabledReason/.test(save) && /toRow\(/.test(save));
  ok('one row per save, every ticked id', /questionIds: picked/.test(save));
  ok('the private note', save.includes('Only you can see saved answers.'));
  const mig = read('supabase/migrations/20261002170000_jurisdiction_answers.sql');
  ok('migration: RLS on, four own-row policies, no share column', /enable row level security/.test(mig)
    && ['select', 'insert', 'update', 'delete'].every((c) => new RegExp(`create policy jurisdiction_answers_${c}_own`).test(mig))
    && !/\b(shared|share_with|is_public|visibility)\b\s+(boolean|text)/i.test(mig));
  ok('migration: insert and update check the project is his', (mig.match(/exists \(select 1 from public\.projects p where p\.id = project_id and p\.user_id = auth\.uid\(\)\)/g) ?? []).length === 2);
  ok('migration: anon gets nothing; user_id is not client-writable', /revoke all on public\.jurisdiction_answers from anon, public;/.test(mig) && !/grant insert \([^)]*user_id/.test(mig) && !/grant update \([^)]*user_id/.test(mig));
  ok('migration: the trigger refuses an owner or jurisdiction change', /new\.user_id is distinct from old\.user_id then\s+raise exception/.test(mig) && /new\.jurisdiction_key is distinct from old\.jurisdiction_key then\s+raise exception/.test(mig));
  ok('migration: header carries WHO WRITES, WHO READS, WHY NO SHARE COLUMN, VERIFY AFTER', ['WHO WRITES', 'WHO READS', 'WHY NO SHARE COLUMN', 'VERIFY AFTER'].every((h) => mig.includes(h)));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
