// scripts/validate-code-cards.ts — the code-card kit's guard (lane CCKIT).
//
//   bun run scripts/validate-code-cards.ts
//
// Pure logic, EXECUTED (utils/codeCard imports under bun: AsyncStorage,
// clipboard and Linking are required lazily and injected here), plus source
// rules over components/codeCard (text only; those files import react-native,
// which bun cannot load).
//
//   A  verdict.ts      re-check, close-to-the-line band, verdict flip, formatting
//   B  echoCheck.ts    our words only: caps, long runs, quotes, code phrasing
//   C  officialText.ts copy THEN open, volume-level URLs only, blocked says why
//   D  shareText.ts    sample tail, recall notes (a PARENT match is recall; the
//                      trigger number is recall on every rung), confirm line
//   E  parse.ts        unshowable items dropped, structured numbers only, wire
//                      evidence and "not a guess" never trusted; A CARD NEVER
//                      OPENS ON THE OPPOSITE OF THE AI'S VERDICT (numbers that
//                      disagree with it draw no tape); the device-store
//                      reader keeps what a surface showed and is idempotent;
//                      saysWithUnit.ts: a job number counts only when he
//                      wrote it next to its unit
//   F  pins / saved    reducers, persistence, replay, tenant wipe covers the keys
//                      AND the module memory (reset); A STORE READS BACK EXACTLY
//                      WHAT IT ACCEPTED (one gate on the way in and out)
//   G  summary.ts      headline, tally, groups, bulk labels
//   H  evidence.ts     four bars = four rungs; recall grey, same words; a parent
//                      match is recall
//   I  jurisdiction.ts real NY rows: edition + Oyster Bay office, own sources;
//                      an unmarked edition is always a name MAGE holds for a
//                      volume adopted here; a source line sits only under the
//                      jurisdiction's own edition
//   J  sunlight.ts     persisted under a mageid_ key; a read in flight at the
//                      tenant wipe never lands
//   K  component rules amber reserved, no direct ICC opener, Card primitive,
//                      50 pt actions, the closing lines, no code wording
//
// fileURLToPath + join because the repo path contains a space.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CodeCardItem, CodeJobValue, CodeTrigger, CodeJurisdictionInfo } from '../utils/codeCard/types';
import {
  canRecheck, effectiveVerdict, formatJobNumber, recheck, recheckEquation, stepJobValue, stageInspectionLabel,
  CODE_STAGES,
} from '../utils/codeCard/verdict';
import { longestRun, passesEchoCheck, summaryEchoCheck, SUMMARY_MAX } from '../utils/codeCard/echoCheck';
import {
  officialTextPlan, officialTextSteps, officialTextToast, runOfficialText, OFFICIAL_TEXT_BLOCKED, NO_SECTION_TO_COPY, NO_SECTION_TOAST, viewerShortLabel,
} from '../utils/codeCard/officialText';
import {
  architectMessageFor, confirmLine, isGovernmentRung, shareTextFor, smsUrlFor, mailtoUrlFor, subRecipientsFor, tradeMatches,
  NO_SECTION_NOTE, RECALL_NOTE, SAMPLE_TAIL, TRIGGER_RECALL_NOTE,
} from '../utils/codeCard/shareText';
import {
  attachEvidence, codeCardStoreBlockedReason, numbersAgreeWithVerdict, parseCodeCardItem, parseCodeCardItems, parseJobValue, storedCodeCardItem, STORED_TEXT_MAX, STORE_BLOCKED_REASON,
} from '../utils/codeCard/parse';
import { limitSideInLine, saysNumberWithUnit, LIMIT_COMPARISON } from '../utils/codeCard/saysWithUnit';
import {
  codePinStore, createPinStore, makePin, parsePinsState, pinsByStage, pinsFor, pinsReducer, storedPin, CODE_PINS_KEY, EMPTY_PINS, isPinned, __setCodePinStoreForTest,
} from '../utils/codeCard/pins';
import {
  codeSavedStore, createSavedStore, makeSaved, parseSavedState, savedFor, savedReducer, storedSaved, CODE_SAVED_KEY, EMPTY_SAVED, isSaved, __setCodeSavedStoreForTest,
} from '../utils/codeCard/saved';
import { resetCodeCardStores } from '../utils/codeCard/reset';
import {
  addAllLabel, architectButtonLabel, groupByStage, groupByStatus, planHeadline, requirementsCount, tallySquares,
} from '../utils/codeCard/summary';
import { evidenceView, rowEvidenceWord, sectionIsBacked, RECALL_LABEL, RECALL_ROW_WORD } from '../utils/codeCard/evidence';
import {
  adoptedEditionLine, citedEditionLine, codeJurisdictionInfoFor, editionForItem, editionViewFor, formatCheckedOn, isAdoptedVolume, isoDateIn, isVerifiedEdition, sourceLine, AS_CITED_MARK,
} from '../utils/codeCard/jurisdiction';
import { CODE_SUNLIGHT_KEY, getSunlight, resetSunlight, setSunlight, subscribeSunlight, __resetSunlightForTest } from '../utils/codeCard/sunlight';
import type { KVStorage } from '../utils/codeCard/store';
import { citationEvidenceFor, type CitationEvidence } from '../utils/codeAmendments';
import { resolveCodeJurisdiction } from '../utils/codeJurisdiction';
import { permitOfficeFor, type PlaceLookupResult } from '../utils/permitOffices';
import { DEVICE_SCOPED_KEYS, isAppStorageKey, selectTenantKeysToWipe } from '../utils/localCacheKeys';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
let checks = 0;
function ok(name: string, cond: boolean, detail?: string): void {
  checks++;
  if (cond) return;
  failures++;
  console.error(`  FAIL  ${name}`);
  if (detail) console.error(`        ${detail}`);
}
function section(name: string): void {
  console.log(`  ${name}`);
}

const VOLUME_URL = /^https:\/\/codes\.iccsafe\.org\/content\/[A-Z][A-Z0-9]{3,23}$/;

// ── Fixtures (every requirement here is a SAMPLE, in our own words) ──────
const deckJob: CodeJobValue = { value: 34, unit: 'in', source: 'sheet', sourceLabel: 'sheet A-2' };
const guardTrigger: CodeTrigger = { value: 30, unit: 'in', comparison: '>' };
const NY = resolveCodeJurisdiction({ state: 'NY', city: 'Massapequa' });
const recallEv = citationEvidenceFor(NY, '2025 RCNYS', 'R312.1');
const namedEv: CitationEvidence = { ...recallEv, rung: 'named', rungIndex: 2, badge: 'SECTION NAMED IN LAW', sourceLabel: 'Sample register 1.2' };
// REAL New York rows (utils/codeAmendments.ts, 19 NYCRR § 1220.2(a)(6) names
// RCNYS § P2904): the exact section is rung "named"; a CHILD of it is the
// parent-only match, which codeAmendments itself says is NOT backing.
const exactEv = citationEvidenceFor(NY, '2025 RCNYS', 'P2904');
const parentEv = citationEvidenceFor(NY, '2025 RCNYS', 'P2904.2.4');

const guards: CodeCardItem = {
  id: 'guards',
  verdict: 'required',
  summary: 'Guards on every open side, at least 36 in. high.',
  section: 'R312.1',
  citedEdition: '2025 RCNYS',
  evidence: recallEv,
  stage: 'final',
  stageIsGuess: true,
  jobValue: deckJob,
  trigger: guardTrigger,
  trade: 'Framing',
  whatToBuild: ['A guard on every open side, the stair included.'],
};

const PLACE: PlaceLookupResult = {
  state: 'NY',
  county: { name: 'Nassau County', geoid: '36059' },
  town: { name: 'Oyster Bay town', basename: 'Oyster Bay', geoid: '3605956000', kind: 'town' },
  incorporatedPlace: null,
  cdp: { name: 'Massapequa CDP', basename: 'Massapequa', geoid: '3646085', kind: 'cdp' },
  match: 'address',
  matchedAddress: null,
  source: 'US Census Geocoder',
  asOf: '2026-09-28T00:00:00.000Z',
};
const info: CodeJurisdictionInfo = codeJurisdictionInfoFor(NY, permitOfficeFor(PLACE), '2025 RCNYS');

function memStorage(seed: Record<string, string> = {}): KVStorage & { data: Record<string, string>; writes: number } {
  const data: Record<string, string> = { ...seed };
  const s = {
    data,
    writes: 0,
    async getItem(k: string) { return k in data ? data[k] : null; },
    async setItem(k: string, v: string) { data[k] = v; s.writes++; },
  };
  return s;
}
/** What the tenant wipe does to storage: the swept keys are simply gone. */
function wipe(s: { data: Record<string, string> }): void {
  for (const k of Object.keys(s.data)) delete s.data[k];
}
const tick = () => new Promise<void>((r) => setTimeout(r, 2));
/** JSON with sorted keys (and `undefined` gone): equal content, whatever the key order. */
function canon(v: unknown): string {
  return JSON.stringify(v, (_k, val: unknown) => (val && typeof val === 'object' && !Array.isArray(val)
    ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : val));
}
const storedProjects = (s: { data: Record<string, string> }, key: string): string =>
  Object.keys(JSON.parse(s.data[key] ?? '{}') as Record<string, unknown>).sort().join(',');

async function main(): Promise<void> {
  console.log('\ncode cards (lane CCKIT):');

  // ── A ────────────────────────────────────────────────────────────────
  section('A verdict');
  const jv = (value: number, unit: CodeTrigger['unit'] = 'in'): CodeJobValue => ({ value, unit, source: 'measured', sourceLabel: 'site' });
  ok('A1 34 in. > 30 in. is met and not close', JSON.stringify(recheck(jv(34), guardTrigger)) === '{"met":true,"closeToLine":false}');
  ok('A2 31 in. is met and close (within 2 in.)', JSON.stringify(recheck(jv(31), guardTrigger)) === '{"met":true,"closeToLine":true}');
  ok('A3 29 in. is not met and close', JSON.stringify(recheck(jv(29), guardTrigger)) === '{"met":false,"closeToLine":true}');
  ok('A4 32 in. is close: the 2 in. band is inclusive', recheck(jv(32), guardTrigger).closeToLine === true);
  ok('A5 32.5 in. is not close', recheck(jv(32.5), guardTrigger).closeToLine === false);
  ok('A6 30 in. is not met for ">" but is for ">="', !recheck(jv(30), guardTrigger).met && recheck(jv(30), { ...guardTrigger, comparison: '>=' }).met);
  ok('A7 "<" and "<=" on the boundary', !recheck(jv(4), { value: 4, unit: 'in', comparison: '<' }).met && recheck(jv(4), { value: 4, unit: 'in', comparison: '<=' }).met);
  ok('A8 feet use 2/12 ft as the band', recheck(jv(3 + 2 / 12, 'ft'), { value: 3, unit: 'ft', comparison: '>' }).closeToLine
    && !recheck(jv(3.25, 'ft'), { value: 3, unit: 'ft', comparison: '>' }).closeToLine);
  ok('A9 psf, degrees and counts are never "close"', !recheck(jv(41, 'psf'), { value: 40, unit: 'psf', comparison: '>' }).closeToLine
    && !recheck(jv(4, 'count'), { value: 4, unit: 'count', comparison: '>=' }).closeToLine);
  ok('A10 a unit mismatch is refused, not converted', JSON.stringify(recheck(jv(3, 'ft'), guardTrigger)) === '{"met":false,"closeToLine":false}'
    && !canRecheck({ jobValue: jv(3, 'ft'), trigger: guardTrigger }));
  ok('A11 canRecheck needs BOTH structured numbers', canRecheck(guards) && !canRecheck({ jobValue: deckJob }) && !canRecheck({ trigger: guardTrigger })
    && !canRecheck({ jobValue: { ...deckJob, value: Number.NaN }, trigger: guardTrigger }));
  ok('A12 re-measuring below the trigger flips Required to Not required', effectiveVerdict(guards, jv(29)) === 'not_required' && effectiveVerdict(guards) === 'required');
  ok('A13 a limit stays a limit', effectiveVerdict({ ...guards, verdict: 'limit' }, jv(29)) === 'limit');
  ok('A14 no structured numbers: the AI verdict stands', effectiveVerdict({ verdict: 'limit' }) === 'limit');
  const minLimit = { verdict: 'limit' as const, trigger: { value: 36, unit: 'in' as const, comparison: '>=' as const } };
  ok('A14b a job UNDER a minimum reads "outside the limit", never "over the limit"; inside it reads "within the limit"',
    recheckEquation(minLimit, jv(34))?.words === 'outside the limit' && recheckEquation(minLimit, jv(36))?.words === 'within the limit'
    && recheckEquation({ verdict: 'limit', trigger: { value: 4, unit: 'in', comparison: '<' } }, jv(4.5))?.words === 'outside the limit');
  const eq34 = recheckEquation(guards, deckJob);
  const eq29 = recheckEquation(guards, jv(29));
  ok('A15 the equation reads 34 in. > 30 in. → required', !!eq34 && eq34.left === '34 in.' && eq34.op === '>' && eq34.right === '30 in.' && eq34.words === 'required', JSON.stringify(eq34));
  ok('A16 below the line the operator is negated (≤) and the words follow', !!eq29 && eq29.op === '≤' && eq29.words === 'not required', JSON.stringify(eq29));
  ok('A17 numbers: 4½ in., ¾ in., 12 ft, 30°, 5', formatJobNumber(4.5, 'in') === '4½ in.' && formatJobNumber(0.75, 'in') === '¾ in.'
    && formatJobNumber(12, 'ft') === '12 ft' && formatJobNumber(30, 'deg') === '30°' && formatJobNumber(5, 'count') === '5',
    [formatJobNumber(4.5, 'in'), formatJobNumber(0.75, 'in'), formatJobNumber(12, 'ft'), formatJobNumber(30, 'deg')].join(' | '));
  const stepped = stepJobValue(deckJob, -3);
  ok('A18 − / + marks the number as measured on site and never goes below zero', stepped.value === 31 && stepped.source === 'measured'
    && stepJobValue(jv(1), -5).value === 0 && stepJobValue(deckJob, 0) === deckJob);
  ok('A19 stage label says inspection, and an unset stage says so', stageInspectionLabel('final') === 'Final inspection' && stageInspectionLabel(undefined) === 'Inspection not set');

  // ── B ────────────────────────────────────────────────────────────────
  section('B echoCheck');
  const ours = [
    'Guards on every open side, at least 36 in. high.',
    'Balusters close enough that a 4 in. ball can’t pass between them.',
    'Handrail on the stair, top of rail 34–38 in. high.',
    "Ledger bolts aren't shown on A-2.",
  ];
  ok('B1 our own summaries pass', ours.every((s) => passesEchoCheck(s)), ours.filter((s) => !passesEchoCheck(s)).join(' | '));
  ok('B2 "shall" is code phrasing', summaryEchoCheck('Guards shall be provided on open sides.').reasons.includes('code_phrasing'));
  ok('B3 "in accordance with" / "Exception:" / "comply with Section" are code phrasing',
    !passesEchoCheck('Build it in accordance with the plans.') && !passesEchoCheck('Exception: decks under 30 in.') && !passesEchoCheck('Rails must comply with Section R312.'));
  ok('B4 straight and curly double quotes are refused, apostrophes are not',
    !passesEchoCheck('Guards "at least 36 in." high.') && !passesEchoCheck('Guards “at least” 36 in.') && passesEchoCheck('Don’t skip the stair side.'));
  ok('B5 over the cap is refused (140 summary; caller caps for why / build lines)',
    !passesEchoCheck('a '.repeat(80).trim() + '.') && !passesEchoCheck('Short line, but over a tiny cap.', 10) && SUMMARY_MAX === 140);
  const run26 = Array.from({ length: 26 }, (_, i) => `w${i}`).join(' ');
  const run25 = Array.from({ length: 25 }, (_, i) => `w${i}`).join(' ');
  ok('B6 a run of 26 words is refused; 25 is allowed', summaryEchoCheck(run26).reasons.includes('long_run') && !summaryEchoCheck(run25).reasons.includes('long_run'));
  ok('B7 a sentence break resets the run', longestRun(`${run25}. ${run25}`) === 25);
  ok('B8 empty is refused', summaryEchoCheck('   ').reasons[0] === 'empty');

  // ── C ────────────────────────────────────────────────────────────────
  section('C officialText');
  const p1 = officialTextPlan(guards, info);
  ok('C1 the plan copies the section and opens a VOLUME url', p1.available && p1.copyText === 'R312.1' && VOLUME_URL.test(p1.viewerUrl ?? ''), JSON.stringify(p1));
  ok('C2 the short name comes from ICC’s own parenthetical', viewerShortLabel('2025 Residential Code of New York State (2025 RCNYS)') === '2025 RCNYS');
  const sectionUrl = { ...guards, evidence: { ...recallEv, viewerUrl: 'https://codes.iccsafe.org/content/NYSRC2025P1/chapter-3-building-planning' } };
  const p2 = officialTextPlan(sectionUrl, { viewerUrl: null, viewerLabel: null });
  ok('C3 a section-level link is refused (viewerUrlToOpen), never opened', !p2.available && p2.viewerUrl === null && p2.blockedReason === OFFICIAL_TEXT_BLOCKED);
  const p3 = officialTextPlan(sectionUrl, info);
  ok('C4 a refused item link falls back to the jurisdiction volume', p3.available && VOLUME_URL.test(p3.viewerUrl ?? ''));
  const fuzz = ['https://codes.iccsafe.org/content/NYSRC2025P1?q=R312', 'https://codes.iccsafe.org/content/NYSRC2025P1#R312.1', 'http://codes.iccsafe.org/content/NYSRC2025P1',
    'https://evil.example/content/NYSRC2025P1', 'https://codes.iccsafe.org/lookup/NYSRC2025P1', ' https://codes.iccsafe.org/content/nysrc2025p1'];
  ok('C5 query / fragment / http / other host / lookup / lower case are all refused',
    fuzz.every((u) => !officialTextPlan({ section: 'R312.1', evidence: { ...recallEv, viewerUrl: u } }, null).available));
  const order: string[] = [];
  const r1 = await runOfficialText(p1, {
    copy: async (t) => { order.push(`copy:${t}`); await new Promise((res) => setTimeout(res, 5)); order.push('copied'); return true; },
    open: async (u) => { order.push(`open:${u}`); },
  });
  ok('C6 copy runs FIRST and finishes before the volume opens', order[0] === 'copy:R312.1' && order[1] === 'copied' && order[2] === `open:${p1.viewerUrl}` && r1.copied && r1.opened, order.join(' > '));
  const order2: string[] = [];
  const r2 = await runOfficialText(p1, { copy: async () => { throw new Error('denied'); }, open: async (u) => { order2.push(u); } });
  ok('C7 a failed copy still opens the volume and reports copied=false', !r2.copied && r2.opened && order2.length === 1);
  let touched = false;
  const r3 = await runOfficialText(p2, { copy: async () => { touched = true; return true; }, open: async () => { touched = true; } });
  ok('C8 a blocked plan touches neither the clipboard nor the browser', !touched && !r3.copied && !r3.opened);
  const tampered = { ...p1, viewerUrl: `${p1.viewerUrl}/chapter-3` };
  const opened: string[] = [];
  await runOfficialText(tampered, { copy: async () => true, open: async (u) => { opened.push(u); } });
  ok('C9 a path appended to the plan after planning is still refused at the opener', opened.length === 0);
  const steps = officialTextSteps(p1);
  ok('C10 the three steps: copies the number, opens the volume, paste', steps.copies.includes('R312.1') && steps.opens.includes('free viewer') && steps.paste === 'Into its search');
  const pNoSec = officialTextPlan({ section: '  ', evidence: recallEv }, info);
  let copyCalls = 0;
  const rNoSec = await runOfficialText(pNoSec, { copy: async () => { copyCalls++; return true; }, open: async () => {} });
  ok('C11 a card with no section copies nothing, still opens the volume, and never says "copied"',
    pNoSec.available && pNoSec.copyText === '' && copyCalls === 0 && !rNoSec.copied && rNoSec.opened
    && officialTextSteps(pNoSec).copies === NO_SECTION_TO_COPY && officialTextToast(pNoSec, rNoSec) === NO_SECTION_TOAST
    && !/copied|Copy did not work/i.test(officialTextToast(pNoSec, rNoSec)), officialTextToast(pNoSec, rNoSec));

  const SECTION_LEVEL = 'https://codes.iccsafe.org/content/NYSRC2025P1/chapter-3-building-planning';
  const pInfoBad = officialTextPlan({ section: 'R312.1', evidence: null }, { viewerUrl: SECTION_LEVEL, viewerLabel: 'x' });
  ok('C12 a section-level link is refused on the jurisdiction path too (the plan itself is unavailable, with the reason)',
    !pInfoBad.available && pInfoBad.viewerUrl === null && pInfoBad.blockedReason === OFFICIAL_TEXT_BLOCKED
    && fuzz.every((u) => !officialTextPlan({ section: 'R312.1', evidence: null }, { viewerUrl: u, viewerLabel: 'x' }).available), JSON.stringify(pInfoBad));

  // ── D ────────────────────────────────────────────────────────────────
  section('D shareText');
  const t1 = shareTextFor(guards, { jobLabel: 'Reyes deck, Massapequa', info, sample: true });
  ok('D1 a sample ends with (Sample)', t1.endsWith(SAMPLE_TAIL), t1);
  ok('D2 a real card does not say Sample', !shareTextFor(guards, { info }).includes('Sample'));
  ok('D3 it names the office with the final word', t1.includes('Confirm with Town of Oyster Bay Building Division.'), t1);
  ok('D4 no office: "Confirm with your building department."', confirmLine(null) === 'Confirm with your building department.');
  // RECALL_NOTE contains TRIGGER_RECALL_NOTE as a substring, so each note is
  // asserted in its own sentence: neither check can pass on the other's words.
  ok('D5 a recalled section says so in the text', t1.includes(`Ref: 2025 RCNYS R312.1 (${RECALL_NOTE}).`), t1);
  ok('D5b the trigger number says it is AI recall, in its own sentence', t1.includes(`Applies above 30 in. (${TRIGGER_RECALL_NOTE}).`) && TRIGGER_RECALL_NOTE === 'AI recall, confirm', t1);
  const tGov = shareTextFor({ ...guards, evidence: namedEv }, { info });
  ok('D6 a section a government document names drops the SECTION recall note', !tGov.includes(RECALL_NOTE) && tGov.includes('Ref: 2025 RCNYS R312.1. '), tGov);
  ok('D6b …but the trigger number stays AI recall on every rung (no record supplies it)',
    [namedEv, exactEv, { ...namedEv, rung: 'amended' as const, rungIndex: 1 as const }, recallEv, parentEv, null]
      .every((e) => shareTextFor({ ...guards, evidence: e }, { info }).includes(`Applies above 30 in. (${TRIGGER_RECALL_NOTE}).`)), tGov);
  const t29 = shareTextFor(guards, { info, jobValue: stepJobValue(deckJob, -5) });
  ok('D7 re-measuring re-runs the text: job line and result change', t29.includes('Job: 29 in. (measured on site)') && t29.includes('Result: not required.')
    && t1.includes('Job: 34 in. (sheet A-2)') && t1.includes('Result: required.'), t29);
  ok('D8 the text carries our summary and the section, and no quotes', t1.includes(guards.summary) && t1.includes('2025 RCNYS R312.1') && !/["“”]/.test(t1));
  ok('D9 sms: iOS uses &body=, Android ?body=, an undialable number is null',
    smsUrlFor('(516) 555-0100', 'hi there', 'ios') === 'sms:5165550100&body=hi%20there'
    && smsUrlFor('516-555-0100', 'x', 'android') === 'sms:5165550100?body=x' && smsUrlFor('12', 'x', 'ios') === null);
  ok('D10 mailto keeps the @ and encodes the rest', mailtoUrlFor('arch@example.com', 'A-2 check', 'Line 1\nLine 2') === 'mailto:arch@example.com?subject=A-2%20check&body=Line%201%0ALine%202');
  const planItems: CodeCardItem[] = [
    { ...guards, id: 'f1', status: 'fix', observed: 'Drawn 4½ in.', location: 'Detail 3/A-2', summary: 'Balusters drawn too far apart.' },
    { ...guards, id: 'a1', status: 'ask', question: 'Can you detail the hold-down at the ledger?', summary: 'Hold-down at the ledger is not detailed.' },
    { ...guards, id: 'a2', status: 'ask', summary: 'Confirm the town frost depth.' },
    { ...guards, id: 'o1', status: 'ok', summary: 'Guards drawn 36 in. high.' },
  ];
  const arch = architectMessageFor(planItems, { jobLabel: 'Reyes deck', sheetLabel: 'A-2', info, sample: true });
  ok('D11 the architect email carries every fix and every ask WITH a question', arch.fixes === 1 && arch.questions === 1
    && arch.body.includes('Detail 3/A-2') && arch.body.includes('hold-down') && !arch.body.includes('frost depth') && arch.body.endsWith(SAMPLE_TAIL), arch.body);
  ok('D12 the architect email says it is not plan review', arch.body.includes('not plan review'));
  const subs = [
    { id: 's1', contactName: 'Luis Martinez', trade: 'General', phone: '5165550101' },
    { id: 's2', contactName: 'Dave Reyes', trade: 'Framing', phone: '5165550102' },
  ];
  const picks = subRecipientsFor(subs, 'framing');
  ok('D13 the sub picker puts trade matches first and shortens names', picks[0].id === 's2' && picks[0].name === 'Dave R.' && picks[0].matches && !picks[1].matches);
  // A PARENT MATCH IS NOT BACKING (codeAmendments). Real NY row.
  const sprinkler: CodeCardItem = { ...guards, id: 'spr', summary: 'Sprinkler heads within reach of every room.', section: 'P2904.2.4', evidence: parentEv };
  const tParent = shareTextFor(sprinkler, { info });
  ok('D15 the real NY rows: P2904 is named exactly, P2904.2.4 only by its parent', exactEv.rung === 'named' && exactEv.parentMatch === false
    && parentEv.rung === 'named' && parentEv.parentMatch === true && /did NOT verify/.test(parentEv.detail), JSON.stringify(parentEv));
  ok('D16 a parent match keeps BOTH recall notes in the sub text', !isGovernmentRung(parentEv) && isGovernmentRung(exactEv)
    && tParent.includes(`Ref: 2025 RCNYS P2904.2.4 (${RECALL_NOTE}).`) && tParent.includes(`(${TRIGGER_RECALL_NOTE}).`), tParent);
  ok('D17 an amended PARENT is recall too', !isGovernmentRung({ ...parentEv, rung: 'amended', rungIndex: 1 })
    && shareTextFor({ ...sprinkler, evidence: { ...parentEv, rung: 'amended', rungIndex: 1 } }, { info }).includes(RECALL_NOTE));
  const archParent = architectMessageFor([{ ...sprinkler, status: 'fix' }, { ...sprinkler, id: 'x2', status: 'fix', section: 'P2904', evidence: exactEv }], { info });
  ok('D18 the architect email keeps the recall note on a parent match and drops it only on the exact one',
    archParent.body.includes(`Ref: P2904.2.4, ${RECALL_NOTE}.`) && archParent.body.includes('Ref: P2904.\n'), archParent.body);
  const units: [CodeTrigger['unit'], number][] = [['in', 30], ['ft', 12], ['psf', 40], ['deg', 30], ['count', 4]];
  const everyText = units.flatMap(([unit, value]) => [recallEv, exactEv, parentEv, null].flatMap((e) => ['sheet A-2', ''].map((label) => shareTextFor(
    { ...guards, evidence: e, trigger: { value, unit, comparison: '>' }, jobValue: { value: value + 4, unit, source: 'job', sourceLabel: label } }, { info, sample: true }))));
  ok('D19 no sentence ever ends in two periods (inches end in "in.")', everyText.length === 40 && everyText.every((t) => !t.includes('..')),
    everyText.find((t) => t.includes('..')));
  const tNoSec = shareTextFor({ ...guards, section: '', jobValue: undefined, trigger: undefined }, { info });
  ok('D20 a card with no section says so; it never prints an empty reference', tNoSec.includes(`Ref: 2025 RCNYS, ${NO_SECTION_NOTE}.`) && !tNoSec.includes(RECALL_NOTE)
    && architectMessageFor([{ ...guards, status: 'fix', section: '' }], { info }).body.includes(`Ref: ${NO_SECTION_NOTE}.`), tNoSec);
  const noSecOld = { ...guards, section: '', citedEdition: '2020 RCNYS', jobValue: undefined, trigger: undefined };
  ok('D21 with no section (so no recall note on the line) an edition that is not the verified one is marked "(as cited)"',
    shareTextFor(noSecOld, { info }).includes(`Ref: 2020 RCNYS ${AS_CITED_MARK}, ${NO_SECTION_NOTE}.`)
    && shareTextFor(noSecOld, {}).includes(`Ref: 2020 RCNYS ${AS_CITED_MARK}, ${NO_SECTION_NOTE}.`)
    && !tNoSec.includes(AS_CITED_MARK) && !t1.includes(AS_CITED_MARK)
    && shareTextFor({ ...noSecOld, citedEdition: '2025 RCNYS', evidence: recallEv }, {}).includes(`Ref: 2025 RCNYS, ${NO_SECTION_NOTE}.`), shareTextFor(noSecOld, { info }));
  ok('D14 trade matching is word overlap, never a blank match', !tradeMatches('Electrical', 'Framing') && tradeMatches('Fire Protection', 'fire protection') && tradeMatches('Framing', 'framing') && !tradeMatches('', 'Framing'));

  // ── E ────────────────────────────────────────────────────────────────
  section('E parse');
  ok('E1 an item whose summary is code-shaped is dropped whole', parseCodeCardItem({ ...guards, summary: 'Guards shall be not less than 36 in.' }) === null);
  const keepCard = parseCodeCardItem({ ...guards, why: 'The code "says" so.', whatToBuild: ['Fine line.', 'Rails shall be continuous.'] });
  ok('E2 a code-shaped why or build line is dropped; the card stays', !!keepCard && keepCard.why === undefined && keepCard.whatToBuild?.length === 1);
  const loose = parseCodeCardItem({ ...guards, jobValue: { value: 34, unit: 'in' }, trigger: { value: '30', unit: 'in', comparison: '>' } });
  ok('E3 half-structured numbers are dropped, so no tape is drawn', !!loose && !loose.jobValue && !loose.trigger && !canRecheck(loose));
  ok('E4 a bad verdict / no section / no summary is dropped', parseCodeCardItem({ ...guards, verdict: 'maybe' }) === null
    && parseCodeCardItem({ ...guards, section: '' }) === null && parseCodeCardItem({ ...guards, summary: undefined }) === null);
  const many = parseCodeCardItems([{ ...guards, id: 'x' }, { ...guards, id: 'x' }, { ...guards, id: undefined }, 'junk', null]);
  ok('E5 ids are made unique and missing ids are filled', many.length === 3 && new Set(many.map((m) => m.id)).size === 3 && many[2].id === 'req-3', many.map((m) => m.id).join(','));
  ok('E6 forged evidence (index disagrees with rung) is dropped to null even from a device store',
    storedCodeCardItem({ ...guards, evidence: { ...recallEv, rung: 'amended', rungIndex: 3 } })?.evidence === null);
  ok('E7 a missing stage flag means the stage is the AI’s guess', parseCodeCardItem({ ...guards, stageIsGuess: undefined })?.stageIsGuess === true);
  const attached = attachEvidence([{ ...guards, evidence: null }], NY);
  ok('E8 attachEvidence uses codeAmendments for this address (edition rung, volume link)', attached[0].evidence?.rung === 'edition' && VOLUME_URL.test(attached[0].evidence?.viewerUrl ?? ''),
    JSON.stringify(attached[0].evidence));
  ok('E9 no jurisdiction: evidence stays null (recall, unresolved)', attachEvidence([{ ...guards, evidence: null }], null)[0].evidence === null);
  // The wire never decides the rung. A server (or the model) sending a
  // well-shaped "named" evidence must not outrank the client's own lookup.
  const forged = { rung: 'named', rungIndex: 2, badge: 'SECTION NAMED IN LAW', detail: 'made up', sourceLabel: 'Fake Law 1', sourceUrl: null, quote: null, quoteComplete: true, parentMatch: false, viewerUrl: null, viewerLabel: null };
  const wire = parseCodeCardItems([{ ...guards, evidence: forged, stageIsGuess: false }]);
  ok('E10 wire evidence is dropped by default, however well-shaped', wire.length === 1 && wire[0].evidence === null
    && parseCodeCardItem({ ...guards, evidence: forged })?.evidence === null, JSON.stringify(wire[0]?.evidence));
  const wired = attachEvidence(wire, NY);
  ok('E11 …so attachEvidence supplies MAGE’s own rung and the recall label stays', wired[0].evidence?.rung === 'edition' && wired[0].evidence?.sourceLabel !== 'Fake Law 1'
    && evidenceView(wired[0].evidence).short === RECALL_LABEL && shareTextFor(wired[0], { info }).includes(RECALL_NOTE), JSON.stringify(wired[0].evidence));
  ok('E12 "stageIsGuess: false" off the wire is ignored: only the contractor ends the guess', wire[0].stageIsGuess === true);
  const local = storedCodeCardItem({ ...guards, evidence: exactEv, stageIsGuess: false });
  ok('E13 a card this device stored keeps its evidence and his stage edit', local?.evidence?.rung === 'named' && local?.evidence?.sourceLabel === exactEv.sourceLabel && local?.stageIsGuess === false);
  ok('E13b …and ONLY the device-store reader does: the wire reader takes no option that keeps them (its third argument is the line a surface shows, read for a limit’s side and nothing else)',
    parseCodeCardItem.length === 3 && parseCodeCardItems.length === 1
    && (parseCodeCardItem as (...a: unknown[]) => CodeCardItem | null)({ ...guards, evidence: exactEv, stageIsGuess: false }, undefined, { trustEvidence: true, stored: true })?.evidence === null
    && parseCodeCardItem({ ...guards, evidence: exactEv, stageIsGuess: false }, undefined, 'stored')?.evidence === null
    && parseCodeCardItem({ ...guards, evidence: exactEv, stageIsGuess: false }, undefined, 'stored')?.stageIsGuess === true
    && parseCodeCardItem({ ...guards }, undefined, 'Another line.')?.summary === guards.summary);

  // THE DEVICE-STORE READER keeps what a card surface showed. Code Check, plan
  // check and the sweep show cards with NO section and lines up to 400
  // characters (CARD_TEXT_MAX); a store that dropped those lost the pin at the
  // next launch.
  const sentence40 = 'Sample: a guard on every open side here. ';           // 41 chars, 8 words
  const sum400 = `${sentence40.repeat(9)}Sample${'x'.repeat(60)}`.slice(0, 399) + '.';   // exactly 400, short sentences
  const sec40 = 'R507.9.1.3 and Table R507.9.1.3(1), (2).';
  const noSection: CodeCardItem = { ...guards, id: 'nosec', section: '', evidence: null, jobValue: undefined, trigger: undefined };
  const longLine: CodeCardItem = { ...guards, id: 'long400', summary: sum400 };
  const longSec: CodeCardItem = { ...guards, id: 'longsec', section: sec40 };
  const planRow: CodeCardItem = {
    ...guards, id: 'sheet-1#3', status: 'ask', evidence: parentEv, citedEdition: 'RCNYS 2025', stage: undefined,
    observed: `Sample: ${'drawn 4½ in. apart at the stair. '.repeat(5)}`.slice(0, 119).trimEnd().padEnd(119, 'x') + '.',
    question: `Sample: ${'can you confirm the spacing at the stair guard? '.repeat(6)}`.slice(0, 239).trimEnd().padEnd(239, 'x') + '?',
    location: 'A-201 Second floor framing plan and details, revision 3, issued for permit',
  };
  const tooLong: CodeCardItem = { ...guards, id: 'over', summary: sum400 + ' More.' };
  const oneLongRun: CodeCardItem = { ...guards, id: 'run', summary: Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ') };
  const storable = [guards, noSection, longLine, longSec, planRow, { ...guards, id: 'exact', evidence: exactEv, stage: 'framing' as const, stageIsGuess: false }];
  const unstorable: unknown[] = [tooLong, oneLongRun, { ...guards, summary: 'Rails shall be 36 in.' }, { ...guards, verdict: 'maybe' }, { ...guards, summary: '' },
    { ...guards, section: undefined }, { ...guards, section: 12 }, { ...guards, section: 's'.repeat(401) }, { ...guards, id: '' }, { ...guards, id: undefined }, null, 'x'];
  ok('E14 fixtures: a 400-character line, a 40-character section, a 120-character observed and a 240-character question',
    sum400.length === 400 && passesEchoCheck(sum400, 400) && sec40.length === 40 && planRow.observed?.length === 120 && planRow.question?.length === 240
    && passesEchoCheck(planRow.observed ?? '', 120) && passesEchoCheck(planRow.question ?? '', 240), `${sum400.length} ${sec40.length} ${planRow.observed?.length} ${planRow.question?.length}`);
  ok('E15 the device-store reader keeps a card with no section, a 400-character line, a long section and long plan-check fields, UNCHANGED',
    storable.every((c) => canon(storedCodeCardItem(c)) === canon(c)), storable.filter((c) => canon(storedCodeCardItem(c)) !== canon(c)).map((c) => c.id).join(','));
  ok('E16 …the wire reader still refuses every one of those (tight caps, a section required)',
    [noSection, longLine, longSec].every((c) => parseCodeCardItem(c) === null) && parseCodeCardItem(planRow)?.observed === undefined && parseCodeCardItem(planRow)?.question === undefined
    && parseCodeCardItem(planRow)?.location === undefined);
  ok('E17 the device-store reader still refuses: over 400, one long run, code phrasing, a bad verdict, no summary, a section that is not text or is over the cap, no id',
    unstorable.every((c) => storedCodeCardItem(c) === null), unstorable.map((c, i) => (storedCodeCardItem(c) ? i : '')).join(''));
  const messy = { ...planRow, summary: `  ${planRow.summary}  `, section: ' R312.1  ', extra: 'dropped', why: 'x'.repeat(401), calc: { expression: '34 ÷ 7¾', value: 5 }, whatToBuild: ['One.', 3, 'Rails shall be continuous.'] };
  const once = storedCodeCardItem(messy);
  ok('E18 the device-store reader is idempotent, and its output survives JSON unchanged',
    !!once && once.section === 'R312.1' && once.why === undefined && once.calc?.value === '5' && once.whatToBuild?.length === 1 && !('extra' in once)
    && JSON.stringify(storedCodeCardItem(once)) === JSON.stringify(once)
    && JSON.stringify(storedCodeCardItem(JSON.parse(JSON.stringify(once)))) === JSON.stringify(once), JSON.stringify(once));
  const wiringSrc = readFileSync(join(ROOT, 'components', 'construction', 'AskConstructionMode.tsx'), 'utf8');
  const surfaceMax = Number((/export const CARD_TEXT_MAX = (\d+);/.exec(wiringSrc) ?? [])[1]);
  const surfaceCaps = [...wiringSrc.matchAll(/\becho\(\w+, (\d+|CARD_TEXT_MAX)\)/g)].map((m) => (m[1] === 'CARD_TEXT_MAX' ? surfaceMax : Number(m[1])));
  ok('E19 the stored cap is at least the longest line any card surface shows (CARD_TEXT_MAX and every echo cap in the wiring)',
    STORED_TEXT_MAX === 400 && Number.isFinite(surfaceMax) && surfaceMax <= STORED_TEXT_MAX && surfaceCaps.length >= 1 && surfaceCaps.every((n) => n <= STORED_TEXT_MAX),
    `stored ${STORED_TEXT_MAX}, surface ${surfaceMax}, caps ${surfaceCaps.join(',')}`);
  ok('E20 a card the stores cannot keep has a plain reason; one they can has none',
    storable.every((c) => codeCardStoreBlockedReason(c) === null) && unstorable.every((c) => codeCardStoreBlockedReason(c) === STORE_BLOCKED_REASON)
    && /own-words check/.test(STORE_BLOCKED_REASON) && /too long/.test(STORE_BLOCKED_REASON));
  ok('E21 a job value keeps a long source label only in a device store', parseJobValue({ ...deckJob, sourceLabel: 'x'.repeat(61) }) === undefined
    && parseJobValue({ ...deckJob, sourceLabel: 'x'.repeat(61) }, STORED_TEXT_MAX)?.sourceLabel.length === 61);

  // THE NUMBERS MUST AGREE WITH THE VERDICT (wire only). The two cases are the
  // integration critic's, word for word: the AI's verdict and summary say one
  // thing, its two numbers the other, and the card used to open on the numbers.
  const raiseGuard = {
    verdict: 'required', summary: 'Raise the guard: it has to be at least 36 in. high.', why: 'Your guard is 34 in.', section: 'R312.1.2', citedEdition: '2025 RCNYS',
    trigger: { value: 36, unit: 'in', comparison: '>=' }, jobValue: { value: 34, unit: 'in', source: 'job', sourceLabel: 'guard height from your question' },
  };
  const noGuard = {
    verdict: 'not_required', summary: 'No guard needed: the deck is under 30 in. above grade.', why: 'Your deck is 24 in. up.', section: 'R312.1.1', citedEdition: '2025 RCNYS',
    trigger: { value: 30, unit: 'in', comparison: '<' }, jobValue: { value: 24, unit: 'in', source: 'job', sourceLabel: 'deck height from your question' },
  };
  const [raised] = parseCodeCardItems([raiseGuard]);
  const [low] = parseCodeCardItems([noGuard]);
  const raisedShare = raised ? shareTextFor(raised, { jobLabel: 'Sample job', jobValue: raised.jobValue, info: null, sample: true }) : '';
  ok('E22 "required" whose numbers say not required (34 in. against >= 36 in.): the card opens REQUIRED, with no job number and so no tape',
    !!raised && raised.verdict === 'required' && effectiveVerdict(raised) === 'required' && raised.jobValue === undefined && !canRecheck(raised)
    && JSON.stringify(raised.trigger) === '{"value":36,"unit":"in","comparison":">="}' && raised.summary === raiseGuard.summary, JSON.stringify(raised));
  ok('E23 …and the text for a sub carries no "Job:", no "Result:" and never "not required"',
    raisedShare.includes('Raise the guard: it has to be at least 36 in. high.') && !/Job: |Result:|Applies/.test(raisedShare) && !/not required/i.test(raisedShare) && raisedShare.endsWith(SAMPLE_TAIL), raisedShare);
  ok('E24 "not_required" whose numbers say required (24 in. against < 30 in.): the card opens NOT REQUIRED, with no job number',
    !!low && low.verdict === 'not_required' && effectiveVerdict(low) === 'not_required' && low.jobValue === undefined && low.trigger?.value === 30, JSON.stringify(low));
  const agree = (verdict: string, value: number, comparison: string, trig: number) =>
    parseCodeCardItem({ ...raiseGuard, verdict, trigger: { value: trig, unit: 'in', comparison }, jobValue: { ...raiseGuard.jobValue, value } }, 'req-1')?.jobValue?.value;
  ok('E25 numbers that give the card\u2019s own verdict are kept, exactly on the boundary too',
    agree('required', 34, '>', 30) === 34 && agree('not_required', 24, '>', 30) === 24
    && agree('required', 30, '>=', 30) === 30 && agree('required', 30, '>', 30) === undefined
    && agree('not_required', 30, '>', 30) === 30 && agree('not_required', 30, '>=', 30) === undefined
    && agree('required', 3, '<=', 4) === 3 && agree('not_required', 3, '<=', 4) === undefined);
  ok('E26 a LIMIT whose own line says the side ("at least 36 in.", sign >=) keeps its job number inside and outside the limit (a job outside its limit is a real finding)',
    agree('limit', 34, '>=', 36) === 34 && agree('limit', 38, '>=', 36) === 38
    && effectiveVerdict(parseCodeCardItem({ ...raiseGuard, verdict: 'limit' }, 'req-1') ?? { verdict: 'required' as const }) === 'limit');
  {
    // A LIMIT'S OWN LINE MUST SAY THE SIDE (integration round 2). A limit has
    // no verdict to check its numbers against: only the AI's comparison sign
    // says which way the job has to stand, and a sign pointing the wrong way
    // printed "within the limit" for a job that is outside it, on the card and
    // in the text to a sub.
    const limit = (summary: string, trig: number, comparison: string, value: number, shownLine?: string) => parseCodeCardItem({
      id: 'req-1', verdict: 'limit', summary, section: 'R312.1.2', citedEdition: '2025 RCNYS',
      trigger: { value: trig, unit: 'in', comparison }, jobValue: { value, unit: 'in', source: 'job', sourceLabel: 'from the scenario' },
    }, 'req-1', shownLine);
    const textOf = (c: CodeCardItem | null) => (c ? shareTextFor(c, { jobLabel: 'Sample job', sample: true }) : '');
    const GUARD = 'Guard has to be at least 36 in. high.';
    const RISER = 'Risers can be at most 7.75 in. tall.';
    const p1 = limit(GUARD, 36, '<', 34);
    ok('E30 PROBE 1: "at least 36 in." with the sign the wrong way (<) and a 34 in. guard: the card stays a LIMIT with its trigger and NO job number, so no tape',
      !!p1 && p1.verdict === 'limit' && effectiveVerdict(p1) === 'limit' && p1.jobValue === undefined && !canRecheck(p1) && JSON.stringify(p1.trigger) === '{"value":36,"unit":"in","comparison":"<"}');
    ok('E31 …and the text for a sub says nothing MAGE computed: no "Job:", no "Result:", never "within the limit"; the AI’s line stands',
      textOf(p1).includes(GUARD) && !/Job: |Result:|Limit below|within the limit/.test(textOf(p1)), textOf(p1));
    const p2 = limit(RISER, 7.75, '>', 8);
    ok('E32 PROBE 2: "at most 7.75 in." with the sign the wrong way (>) and an 8 in. riser: no job number, no "within the limit"',
      !!p2 && p2.verdict === 'limit' && p2.jobValue === undefined && p2.trigger?.value === 7.75 && !/Job: |Result:|within the limit/.test(textOf(p2)), textOf(p2));
    const [p3] = parseCodeCardItems([{ id: 'req-1', verdict: 'limit', summary: RISER, section: 'R311.7.5.1', citedEdition: '2025 RCNYS', stage: 'final',
      trigger: { value: 7.75, unit: 'in', comparison: '>' }, jobValue: { value: 8, unit: 'in', source: 'job', sourceLabel: 'riser height from your question' } }]);
    ok('E33 PROBE 3: the same riser card as the Ask server would send it (a whole requirements[]): the phone drops the job number',
      !!p3 && p3.jobValue === undefined && p3.trigger?.comparison === '>' && !/Job: |Result:|within the limit/.test(textOf(p3)), textOf(p3));
    const g = limit(GUARD, 36, '>=', 34);
    const r = limit(RISER, 7.75, '<=', 8);
    ok('E34 with the sign its own words mean, the job number is kept and reads the right way: 34 in. against "at least 36 in." and 8 in. against "at most 7.75 in." are OUTSIDE the limit',
      g?.jobValue?.value === 34 && recheckEquation(g, g.jobValue)?.words === 'outside the limit' && textOf(g).includes('Job: 34 in. (from the scenario). Limit at or above 36 in. (AI recall, confirm). Result: outside the limit.')
      && r?.jobValue?.value === 8 && recheckEquation(r, r.jobValue)?.words === 'outside the limit' && textOf(r).includes('Result: outside the limit.'), `${textOf(g)} | ${textOf(r)}`);
    const at = (c: CodeCardItem | null) => (c?.jobValue ? recheckEquation(c, c.jobValue)?.words : undefined);
    ok('E35 inside reads "within the limit", and the figure itself is inside (every side word includes it): 38 in. and 36 in. against "at least 36 in.", 7.75 in. against "at most 7.75 in."',
      at(limit(GUARD, 36, '>=', 38)) === 'within the limit' && at(limit(GUARD, 36, '>=', 36)) === 'within the limit' && at(limit(RISER, 7.75, '<=', 7.75)) === 'within the limit');
    ok('E36 so the sign must be EXACTLY the one the words mean: > with "at least" (it would put a 36 in. guard outside its own line) and < with "at most" draw no tape',
      limit(GUARD, 36, '>', 36)?.jobValue === undefined && limit(GUARD, 36, '>', 38)?.jobValue === undefined && limit(RISER, 7.75, '<', 7.75)?.jobValue === undefined
      && LIMIT_COMPARISON.min === '>=' && LIMIT_COMPARISON.max === '<=');
    const SIGNS = ['>', '>=', '<', '<='] as const;
    ok('E37 a line with no side word, with both kinds, with the word at another figure, or without the trigger’s figure: no job number, whatever the sign',
      SIGNS.every((c) => limit('Keep the guard under 36 in. high.', 36, c, 34)?.jobValue === undefined
        && limit('Guard at least 36 in. and at most 42 in. high.', 36, c, 34)?.jobValue === undefined
        && limit('Guard at least 42 in. high on a deck 36 in. up.', 36, c, 34)?.jobValue === undefined
        && limit('Guard has to be at least 3 ft high.', 36, c, 34)?.jobValue === undefined
        && limit('Minimum guard height is 36 in.', 36, c, 34)?.jobValue === undefined));
    ok('E38 limitSideInLine: the side word sits right at the trigger’s figure, before it or straight after its unit; fractions and counts read too',
      limitSideInLine(GUARD, 36, 'in') === 'min' && limitSideInLine('Guard height: 36 in. minimum.', 36, 'in') === 'min' && limitSideInLine('Keep a minimum of 36 in. clear.', 36, 'in') === 'min'
      && limitSideInLine('Leave 36 inches or more.', 36, 'in') === 'min' && limitSideInLine(RISER, 7.75, 'in') === 'max' && limitSideInLine('Risers up to 7¾ in.', 7.75, 'in') === 'max'
      && limitSideInLine('Keep gaps 4 in. or less.', 4, 'in') === 'max' && limitSideInLine('No more than 40 psf.', 40, 'psf') === 'max' && limitSideInLine('Height: 36 in. maximum.', 36, 'in') === 'max'
      && limitSideInLine('At least 3 risers.', 3, 'count') === 'min' && limitSideInLine('at least 4 1/2 in.', 4.5, 'in') === 'min');
    ok('E39 limitSideInLine: no side for another figure, another unit, a word that only looks like one, or input that is not a line, a number and a unit',
      limitSideInLine(GUARD, 34, 'in') === null && limitSideInLine(GUARD, 36, 'ft') === null && limitSideInLine('At least 3 ft wide.', 3, 'count') === null
      && limitSideInLine('at leastwise 36 in.', 36, 'in') === null && limitSideInLine('36 in. minimums vary', 36, 'in') === null
      && limitSideInLine(null, 36, 'in') === null && limitSideInLine(GUARD, '36', 'in') === null && limitSideInLine(GUARD, NaN, 'in') === null && limitSideInLine(GUARD, 36, 'mm') === null);
    {
      // Every limit card off the wire that keeps a job number, checked against
      // the words on its own line by a rule written out again here.
      const lines: [string, 'min' | 'max'][] = [
        [GUARD, 'min'], ['Guard height: 36 in. minimum.', 'min'], ['Keep a minimum of 36 in. clear.', 'min'], ['Leave 36 in. or more.', 'min'],
        ['Keep it at most 36 in. high.', 'max'], ['No more than 36 in. apart.', 'max'], ['Space them up to 36 in. apart.', 'max'], ['Keep it 36 in. or less.', 'max'], ['Height: 36 in. maximum.', 'max'],
      ];
      const wrong: string[] = [];
      let kept = 0;
      for (const [line, side] of lines) for (const c of SIGNS) for (const n of [30, 34, 36, 38]) {
        const card = limit(line, 36, c, n);
        if (!card || effectiveVerdict(card) !== 'limit' || card.trigger?.value !== 36) { wrong.push(`${line} ${n} ${c}: not a limit card`); continue; }
        if (!!card.jobValue !== (c === (side === 'min' ? '>=' : '<='))) { wrong.push(`${line} ${n} ${c}: job number ${card.jobValue ? 'kept' : 'dropped'}`); continue; }
        if (!card.jobValue) continue;
        kept++;
        const inside = side === 'min' ? n >= 36 : n <= 36;
        if ((at(card) === 'within the limit') !== inside || (at(card) === 'outside the limit') === inside) wrong.push(`${line} ${n} ${c}: reads the wrong way`);
      }
      ok(`E40 ${lines.length * 16} limit cards: a job number rides only on the sign the line’s own words mean, and "within the limit" is printed exactly when the job is on the side the line says (${kept} kept)`,
        wrong.length === 0 && kept === lines.length * 4, wrong.slice(0, 5).join('; '));
    }
    ok('E41 a surface that shows its own line (Code Check sends a stand-in summary) passes THE LINE IT SHOWS: the side is read from that line, and never from a field off the wire',
      limit('Requirement', 36, '>=', 34, GUARD)?.jobValue?.value === 34 && limit('Requirement', 36, '>=', 34)?.jobValue === undefined
      && limit(GUARD, 36, '>=', 34, 'MAGE hid this line because it read like code text.')?.jobValue === undefined
      && parseCodeCardItem({ id: 'x', verdict: 'limit', summary: 'Requirement', section: 'R312.1.2', shownLine: GUARD,
        trigger: { value: 36, unit: 'in', comparison: '>=' }, jobValue: { value: 34, unit: 'in', source: 'job', sourceLabel: 'x' } }, 'x')?.jobValue === undefined);
    ok('E42 numbersAgreeWithVerdict for a limit: true only when the line says the side the sign points to; a limit with a pair and no line is false; with no pair there is nothing to disagree',
      numbersAgreeWithVerdict({ verdict: 'limit', summary: GUARD, jobValue: { ...deckJob, value: 34 }, trigger: { value: 36, unit: 'in', comparison: '>=' } })
      && !numbersAgreeWithVerdict({ verdict: 'limit', summary: GUARD, jobValue: { ...deckJob, value: 34 }, trigger: { value: 36, unit: 'in', comparison: '<' } })
      && !numbersAgreeWithVerdict({ verdict: 'limit', jobValue: { ...deckJob, value: 34 }, trigger: { value: 36, unit: 'in', comparison: '>=' } })
      && numbersAgreeWithVerdict({ verdict: 'limit', summary: 'No words.', trigger: { value: 36, unit: 'in', comparison: '<' } }) && numbersAgreeWithVerdict({ verdict: 'limit' }));
    const kept = storedCodeCardItem({ id: 'cc-1', verdict: 'limit', summary: GUARD, section: 'R312.1.2', trigger: { value: 36, unit: 'in', comparison: '<' },
      jobValue: { value: 34, unit: 'in', source: 'measured', sourceLabel: 'measured on site' } });
    ok('E43 the device stores are NOT touched: a stored limit reads back with the number it was saved with, whatever its sign',
      kept?.jobValue?.value === 34 && kept.trigger?.comparison === '<' && storedCodeCardItem({ ...kept })?.jobValue?.value === 34);
  }
  ok('E27 no card off the wire ever opens on a verdict other than the AI\u2019s: every verdict, comparison and side of the line',
    (['required', 'limit', 'not_required'] as const).every((v) => (['>', '>=', '<', '<='] as const).every((c) => [28, 30, 32].every((n) => {
      const card = parseCodeCardItem({ ...raiseGuard, verdict: v, trigger: { value: 30, unit: 'in', comparison: c }, jobValue: { ...raiseGuard.jobValue, value: n } }, 'req-1');
      return !!card && effectiveVerdict(card) === v && numbersAgreeWithVerdict(card) && card.trigger?.value === 30;
    }))));
  ok('E28 numbersAgreeWithVerdict: nothing to disagree with one number missing or the units apart',
    numbersAgreeWithVerdict({ verdict: 'required' }) && numbersAgreeWithVerdict({ verdict: 'required', trigger: guardTrigger })
    && numbersAgreeWithVerdict({ verdict: 'required', jobValue: { ...deckJob, unit: 'ft', value: 1 }, trigger: guardTrigger })
    && !numbersAgreeWithVerdict({ verdict: 'required', jobValue: { ...deckJob, value: 29 }, trigger: guardTrigger })
    && !numbersAgreeWithVerdict({ verdict: 'not_required', jobValue: deckJob, trigger: guardTrigger }));
  const remeasured = storedCodeCardItem({ ...guards, jobValue: { value: 29, unit: 'in', source: 'measured', sourceLabel: 'measured on site' } });
  ok('E29 the device stores are NOT touched: a number he re-measured that flips the verdict is kept, and the − / + still flips it',
    remeasured?.jobValue?.value === 29 && remeasured.verdict === 'required' && effectiveVerdict(remeasured) === 'not_required'
    && effectiveVerdict(guards, stepJobValue(deckJob, -5)) === 'not_required' && effectiveVerdict(guards, stepJobValue(deckJob, -3)) === 'required');

  // saysWithUnit.ts: did HE write this figure next to this unit? (Code Check's
  // job number; scripts/validate-code-card-server.ts holds it to the server's.)
  ok('E30 a figure next to its unit is found: in. / inches / an inch mark, ft, psf, degrees, fractions, a count',
    saysNumberWithUnit('a deck 34 in. above grade', 34, 'in') && saysNumberWithUnit('34 inches up', 34, 'in') && saysNumberWithUnit('a 36" guard', 36, 'in')
    && saysNumberWithUnit('a 36-inch guard', 36, 'in') && saysNumberWithUnit('12 ft wide', 12, 'ft') && saysNumberWithUnit("a 12' deck", 12, 'ft')
    && saysNumberWithUnit('40 psf live load', 40, 'psf') && saysNumberWithUnit('a 30° slope', 30, 'deg') && saysNumberWithUnit('gaps of 4½ in.', 4.5, 'in')
    && saysNumberWithUnit('gaps of 4 1/2 in.', 4.5, 'in') && saysNumberWithUnit('2 exits', 2, 'count'));
  ok('E31 …and nothing else is: another figure, another unit, a place name, part of a mixed number, a negative, an unknown unit, not a number, not text',
    !saysNumberWithUnit('a deck 34 in. above grade', 30, 'in') && !saysNumberWithUnit('12 ft wide', 12, 'in') && !saysNumberWithUnit('a deck 31 in Oyster Bay', 31, 'in')
    && !saysNumberWithUnit('gaps of 4 1/2 in.', 4, 'in') && !saysNumberWithUnit('-34 in.', -34, 'in') && !saysNumberWithUnit('2 ft', 2, 'count')
    && !saysNumberWithUnit('34 in.', 34, 'inches') && !saysNumberWithUnit('34 in.', '34', 'in') && !saysNumberWithUnit(null, 34, 'in') && !saysNumberWithUnit('', 34, 'in')
    && !saysNumberWithUnit('34 in.', Number.NaN, 'in'));

  // ── F ────────────────────────────────────────────────────────────────
  section('F pins / saved');
  const now = '2026-10-03T12:00:00.000Z';
  let ps = pinsReducer(EMPTY_PINS, { type: 'pin', pin: makePin('p1', guards, now) });
  ps = pinsReducer(ps, { type: 'pin', pin: makePin('p1', guards, now) });
  ok('F1 pinning twice keeps one pin', ps.p1.length === 1 && ps.p1[0].stage === 'final');
  ps = pinsReducer(ps, { type: 'setStage', projectId: 'p1', itemId: 'guards', stage: 'framing' });
  ok('F2 moving the stage ends the guess', ps.p1[0].stage === 'framing' && ps.p1[0].item.stageIsGuess === false);
  ok('F3 pins group by inspection in order', JSON.stringify(pinsByStage(ps, 'p1').map((g) => g.stage)) === '["framing"]');
  const ps2 = pinsReducer(ps, { type: 'unpin', projectId: 'p1', itemId: 'guards' });
  ok('F4 unpinning the last pin removes the job key', !('p1' in ps2) && !isPinned(ps2, 'p1', 'guards'));
  ok('F5 a no-op returns the same state object', pinsReducer(ps2, { type: 'unpin', projectId: 'p1', itemId: 'nope' }) === ps2);
  ok('F6 no stage at all files under "other"', makePin('p1', { ...guards, stage: undefined }, now).stage === 'other');
  const mem = memStorage();
  const store = createPinStore(mem);
  store.dispatch({ type: 'pin', pin: makePin('p1', guards, now) });
  await store.load();
  ok('F7 a pin made before storage answered survives the load and is written', isPinned(store.getState(), 'p1', 'guards') && !!mem.data[CODE_PINS_KEY]);
  const reread = createPinStore(memStorage({ [CODE_PINS_KEY]: mem.data[CODE_PINS_KEY] }));
  await reread.load();
  ok('F8 pins read back from storage', isPinned(reread.getState(), 'p1', 'guards'));
  let heard = 0;
  const off = store.subscribe(() => { heard++; });
  store.dispatch({ type: 'unpin', projectId: 'p1', itemId: 'guards' });
  off();
  ok('F9 subscribers hear a change', heard === 1);
  const junk = parsePinsState(JSON.stringify({ p1: [{ projectId: 'p1', stage: 'final', pinnedAt: now, item: { ...guards, summary: 'Rails shall be 36 in.' } }, { projectId: 'p2', stage: 'final', pinnedAt: now, item: guards }, 'x'], p3: 'nope' }));
  ok('F10 malformed or code-shaped stored pins are dropped', JSON.stringify(junk) === '{}', JSON.stringify(junk));
  ok('F11 unreadable storage reads as empty', parsePinsState('{not json') === EMPTY_PINS || Object.keys(parsePinsState('{not json')).length === 0);
  let sv = savedReducer(EMPTY_SAVED, { type: 'save', card: makeSaved('p1', guards, now, stepJobValue(deckJob, -3)) });
  ok('F12 a saved card keeps the re-measured number', isSaved(sv, 'p1', 'guards') && sv.p1[0].jobValue?.value === 31);
  ok('F13 an unchanged number is not stored twice', makeSaved('p1', guards, now, deckJob).jobValue === undefined);
  sv = savedReducer(sv, { type: 'unsave', projectId: 'p1', itemId: 'guards' });
  ok('F14 unsave removes it', !isSaved(sv, 'p1', 'guards'));
  const smem = memStorage();
  const sstore = createSavedStore(smem);
  await sstore.load();
  sstore.dispatch({ type: 'save', card: makeSaved('p1', guards, now) });
  const back = parseSavedState(smem.data[CODE_SAVED_KEY] ?? null);
  ok('F15 saved cards persist and read back', isSaved(back, 'p1', 'guards'));
  const movedPin = makePin('p1', { ...guards, evidence: exactEv }, now, 'framing');
  const kept = parsePinsState(JSON.stringify(pinsReducer(EMPTY_PINS, { type: 'pin', pin: movedPin })));
  ok('F15b a stored pin reads back with its evidence and his stage edit', kept.p1?.[0].item.evidence?.rung === 'named' && kept.p1?.[0].item.stageIsGuess === false && kept.p1?.[0].stage === 'framing');
  const keptSaved = parseSavedState(JSON.stringify(savedReducer(EMPTY_SAVED, { type: 'save', card: makeSaved('p1', { ...guards, evidence: exactEv, stage: 'framing', stageIsGuess: false }, now) })));
  ok('F15c a stored SAVED card reads back with its evidence and his stage edit too', keptSaved.p1?.[0].item.evidence?.rung === 'named'
    && keptSaved.p1?.[0].item.evidence?.sourceLabel === exactEv.sourceLabel && keptSaved.p1?.[0].item.stageIsGuess === false && keptSaved.p1?.[0].item.stage === 'framing');

  // A STORE READS BACK EXACTLY WHAT IT ACCEPTED. The reducer and the reader run
  // the SAME gate (storedPin / storedSaved), so nothing that showed "On Final
  // checklist" can be gone after a restart, and what the gate refuses was
  // never pinned.
  const handed: CodeCardItem[] = [...storable, tooLong, oneLongRun];
  const rtMem = memStorage();
  const rtA = createPinStore(rtMem);
  await rtA.load();
  for (const c of handed) rtA.dispatch({ type: 'pin', pin: makePin('p1', c, now, c.id === 'longsec' ? 'rough' : undefined) });
  rtA.dispatch({ type: 'setStage', projectId: 'p1', itemId: 'nosec', stage: 'insulation' });
  rtA.dispatch({ type: 'setStage', projectId: 'p1', itemId: 'sheet-1#3', stage: 'rough' });
  await tick();
  const rtB = createPinStore(rtMem);
  await rtB.load();
  const idsOf = (st: ReturnType<typeof rtA.getState>) => pinsFor(st, 'p1').map((p) => p.item.id).join(',');
  const wantIds = storable.map((c) => c.id).join(',');
  ok('F27 pins: every card the store accepted is there after a restart (no section, 400-character line, long section, plan-check row)',
    idsOf(rtA.getState()) === wantIds && idsOf(rtB.getState()) === wantIds, `memory [${idsOf(rtA.getState())}] restart [${idsOf(rtB.getState())}] want [${wantIds}]`);
  ok('F28 …byte for byte: the restarted store holds exactly the state the first one held (the moved stages included)',
    JSON.stringify(rtB.getState()) === JSON.stringify(rtA.getState()) && rtMem.data[CODE_PINS_KEY] === JSON.stringify(rtA.getState())
    && JSON.stringify(parsePinsState(JSON.stringify(rtA.getState()))) === JSON.stringify(rtA.getState())
    && pinsFor(rtB.getState(), 'p1').find((p) => p.item.id === 'nosec')?.stage === 'insulation'
    && pinsFor(rtB.getState(), 'p1').find((p) => p.item.id === 'nosec')?.item.stageIsGuess === false
    && pinsFor(rtB.getState(), 'p1').find((p) => p.item.id === 'longsec')?.item.section === sec40
    && pinsFor(rtB.getState(), 'p1').find((p) => p.item.id === 'long400')?.item.summary === sum400);
  const before = rtA.getState();
  rtA.dispatch({ type: 'pin', pin: makePin('p1', tooLong, now) });
  ok('F29 a card the gate refuses is NOT pinned: the state object does not change, and the card has a reason to show',
    rtA.getState() === before && pinsReducer(before, { type: 'pin', pin: makePin('p1', oneLongRun, now) }) === before
    && !isPinned(before, 'p1', 'over') && !isPinned(before, 'p1', 'run') && codeCardStoreBlockedReason(tooLong) !== null);
  ok('F30 the reducer and the reader are the same gate: storedPin of an accepted pin is that pin; of junk, null',
    pinsFor(before, 'p1').every((p) => JSON.stringify(storedPin(p, 'p1')) === JSON.stringify(p))
    && storedPin(makePin('p1', guards, now), 'p2') === null && storedPin({ ...makePin('p1', guards, now), stage: 'attic' }, 'p1') === null
    && storedPin({ ...makePin('p1', guards, now), pinnedAt: 5 }, 'p1') === null && storedPin(null, 'p1') === null
    && pinsReducer(before, { type: 'setStage', projectId: 'p1', itemId: 'nosec', stage: 'attic' as never }) === before);
  const rsMem = memStorage();
  const rsA = createSavedStore(rsMem);
  await rsA.load();
  const longLabel: CodeJobValue = { value: 33, unit: 'in', source: 'job', sourceLabel: `Sample: ${'the site walk with the framer '.repeat(3)}`.trim() };
  for (const c of handed) {
    rsA.dispatch({ type: 'save', card: makeSaved('p1', c, now, c.id === 'guards' ? stepJobValue(deckJob, -3) : c.id === 'longsec' ? longLabel : null) });
  }
  await tick();
  const rsB = createSavedStore(rsMem);
  await rsB.load();
  const savedIds = (st: ReturnType<typeof rsA.getState>) => savedFor(st, 'p1').map((c) => c.item.id).join(',');
  ok('F31 saved cards: the same rule. Accepted = read back, byte for byte, the re-measured number included',
    savedIds(rsA.getState()) === wantIds && savedIds(rsB.getState()) === wantIds && JSON.stringify(rsB.getState()) === JSON.stringify(rsA.getState())
    && JSON.stringify(parseSavedState(JSON.stringify(rsA.getState()))) === JSON.stringify(rsA.getState())
    && savedFor(rsB.getState(), 'p1')[0].jobValue?.value === 31
    && longLabel.sourceLabel.length > 60 && savedFor(rsB.getState(), 'p1').find((c) => c.item.id === 'longsec')?.jobValue?.sourceLabel === longLabel.sourceLabel
    && savedFor(rsA.getState(), 'p1').every((c) => JSON.stringify(storedSaved(c, 'p1')) === JSON.stringify(c))
    && storedSaved(makeSaved('p1', tooLong, now), 'p1') === null && storedSaved({ ...makeSaved('p1', guards, now), savedAt: null }, 'p1') === null,
    `memory [${savedIds(rsA.getState())}] restart [${savedIds(rsB.getState())}]`);

  // TENANT WIPE. The sweep removes the keys; the stores' MEMORY has to go too,
  // or the next user's first pin writes the previous user's pins straight back.
  const wmem = memStorage();
  const wstore = createPinStore(wmem);
  await wstore.load();
  wstore.dispatch({ type: 'pin', pin: makePin('projA', guards, now) });
  await tick();
  let resetHeard = 0;
  const offReset = wstore.subscribe(() => { resetHeard++; });
  wstore.reset();
  offReset();
  wipe(wmem);
  ok('F18 reset empties the memory, tells subscribers, and writes nothing', !isPinned(wstore.getState(), 'projA', 'guards') && wstore.getState() === EMPTY_PINS
    && resetHeard === 1 && !(CODE_PINS_KEY in wmem.data));
  wstore.dispatch({ type: 'pin', pin: makePin('projB', guards, now) });
  await tick();
  ok('F19 after a wipe + reset, the next user’s pin persists ONLY his own', storedProjects(wmem, CODE_PINS_KEY) === 'projB', wmem.data[CODE_PINS_KEY]);
  const lmem = memStorage({ [CODE_PINS_KEY]: JSON.stringify(pinsReducer(EMPTY_PINS, { type: 'pin', pin: makePin('projA', guards, now) })) });
  const lstore = createPinStore(lmem);
  const inFlight = lstore.load();
  lstore.reset();
  await inFlight;
  await tick();
  ok('F20 a load still in flight when the reset ran is dropped when it lands', lstore.getState() === EMPTY_PINS && lstore.isLoaded());
  lstore.dispatch({ type: 'pin', pin: makePin('projB', guards, now) });
  await tick();
  ok('F21 …and the next write replaces the whole key, even if the sweep had not removed it', storedProjects(lmem, CODE_PINS_KEY) === 'projB', lmem.data[CODE_PINS_KEY]);
  const pmem = memStorage();
  const pstore = createPinStore(pmem);
  pstore.dispatch({ type: 'pin', pin: makePin('projA', guards, now) });
  pstore.reset();
  await pstore.load();
  await tick();
  ok('F22 a tap made before storage answered does not survive the reset', pstore.getState() === EMPTY_PINS && !(CODE_PINS_KEY in pmem.data));
  // The app's SHARED stores, through the one function the wipe calls.
  const shPins = memStorage();
  const shSaved = memStorage();
  __setCodePinStoreForTest(createPinStore(shPins));
  __setCodeSavedStoreForTest(createSavedStore(shSaved));
  await codePinStore().load();
  await codeSavedStore().load();
  codePinStore().dispatch({ type: 'pin', pin: makePin('projA', guards, now) });
  codeSavedStore().dispatch({ type: 'save', card: makeSaved('projA', guards, now) });
  const shSun = memStorage();
  __resetSunlightForTest(shSun);
  setSunlight(true);
  await tick();
  resetCodeCardStores();
  wipe(shPins); wipe(shSaved); wipe(shSun);
  ok('F23 resetCodeCardStores empties the shared pin store, the shared saved store and Sunlight',
    codePinStore().getState() === EMPTY_PINS && codeSavedStore().getState() === EMPTY_SAVED && getSunlight() === false);
  codePinStore().dispatch({ type: 'pin', pin: makePin('projB', guards, now) });
  codeSavedStore().dispatch({ type: 'save', card: makeSaved('projB', guards, now) });
  await tick();
  ok('F24 the next user’s first pin and first save carry nothing of the last user’s',
    storedProjects(shPins, CODE_PINS_KEY) === 'projB' && storedProjects(shSaved, CODE_SAVED_KEY) === 'projB', `${shPins.data[CODE_PINS_KEY]} | ${shSaved.data[CODE_SAVED_KEY]}`);
  __setCodePinStoreForTest(null);
  __setCodeSavedStoreForTest(null);
  __resetSunlightForTest(null);
  let threw = false;
  try { resetCodeCardStores(); } catch { threw = true; }
  ok('F25 with no store ever created the reset is a no-op (it never creates one)', !threw);
  const resetSrc = readFileSync(join(ROOT, 'utils', 'codeCard', 'reset.ts'), 'utf8');
  ok('F26 the reset reads and writes no storage itself (removing keys stays the sweep’s job)', !/getItem|setItem|removeItem|async-storage|multiRemove/.test(resetSrc.replace(/^\s*\/\/.*$/gm, '')));

  const keys = [CODE_PINS_KEY, CODE_SAVED_KEY, CODE_SUNLIGHT_KEY];
  ok('F16 every key is app-owned (prefix sweep sees it)', keys.every(isAppStorageKey));
  ok('F17 the tenant wipe removes all three on sign-out', JSON.stringify(selectTenantKeysToWipe(keys)) === JSON.stringify(keys) && keys.every((k) => !DEVICE_SCOPED_KEYS.includes(k)));

  // ── G ────────────────────────────────────────────────────────────────
  section('G summary');
  const ten: CodeCardItem[] = [
    ...['f1', 'f2', 'f3'].map((id) => ({ ...guards, id, status: 'fix' as const })),
    ...['a1', 'a2'].map((id, i) => ({ ...guards, id, status: 'ask' as const, stage: i === 0 ? 'footing' as const : 'framing' as const })),
    ...['o1', 'o2', 'o3', 'o4', 'o5'].map((id) => ({ ...guards, id, status: 'ok' as const, stage: undefined })),
  ];
  const h = planHeadline(ten);
  ok('G1 headline: 3 things to fix; 2 need an answer; 5 look right', h.headline === '3 things to fix before you submit.' && h.subline === '2 need an answer first. 5 look right on the drawing.', JSON.stringify(h));
  ok('G2 one of each is singular', planHeadline([{ ...guards, status: 'fix' }, { ...guards, id: 'b', status: 'ask' }, { ...guards, id: 'c', status: 'ok' }]).subline === '1 needs an answer first. 1 looks right on the drawing.');
  ok('G3 nothing to fix says so', planHeadline([{ ...guards, status: 'ok' }]).headline === 'Nothing to fix on the drawing.');
  ok('G4 the tally squares run fix, ask, ok', tallySquares([...ten].reverse()).join(',') === 'fix,fix,fix,ask,ask,ok,ok,ok,ok,ok');
  ok('G5 By status groups in order and drops empties', groupByStatus(ten).map((g) => `${g.key}:${g.items.length}`).join(',') === 'fix:3,ask:2,ok:5');
  ok('G6 By inspection follows the stage order, fixes first, unset last', groupByStage(ten).map((g) => `${g.key}:${g.items.length}`).join(',') === 'footing:1,framing:1,final:3,unset:5'
    && CODE_STAGES[0] === 'footing');
  ok('G7 By inspection takes the contractor’s edits', groupByStage(ten, () => 'rough').map((g) => g.key).join(',') === 'rough');
  ok('G8 bulk labels', addAllLabel([guards, { ...guards, id: 'b' }, { ...guards, id: 'c' }]) === 'Add all 3 to Final inspection'
    && addAllLabel([guards, { ...guards, id: 'b', stage: 'framing' }]) === 'Add all 2 to their inspections'
    && architectButtonLabel(planItems) === 'Send 1 fix + 1 question to architect'
    && architectButtonLabel([{ ...guards, status: 'ok' }]) === null && requirementsCount([guards]) === '1 requirement');

  // ── H ────────────────────────────────────────────────────────────────
  section('H evidence');
  const amended: CitationEvidence = { ...recallEv, rung: 'amended', rungIndex: 1, badge: 'STATE AMENDMENT' };
  const unresolved: CitationEvidence = { ...recallEv, rung: 'unresolved', rungIndex: 4, badge: 'MODEL RECALL · NO JURISDICTION' };
  ok('H1 four bars = four rungs (amended 4 … unresolved 1, null 1)',
    [amended, namedEv, recallEv, unresolved, null].map((e) => evidenceView(e).bars).join('') === '43211');
  ok('H2 recall is never painted as government evidence', [recallEv, unresolved, null].every((e) => evidenceView(e).tone === 'recall')
    && [amended, namedEv, exactEv].every((e) => evidenceView(e).tone === 'government'));
  ok('H3 recall carries the same words in the same place', [recallEv, unresolved, null].every((e) => evidenceView(e).short === RECALL_LABEL)
    && RECALL_LABEL === 'Model recall · confirm', RECALL_LABEL);
  ok('H4 badge and detail are codeAmendments’ own', evidenceView(recallEv).badge === recallEv.badge && evidenceView(recallEv).detail === recallEv.detail);
  const pv = evidenceView(parentEv);
  const pvAmended = evidenceView({ ...parentEv, rung: 'amended', rungIndex: 1, badge: 'PARENT SECTION AMENDED' });
  ok('H5 a PARENT match is recall: grey, 2 bars like "edition known", the same recall words in the same place',
    [pv, pvAmended].every((v) => v.tone === 'recall' && v.bars === 2 && v.short === RECALL_LABEL && v.parent === true), JSON.stringify(pv));
  ok('H6 …and the parent badge and the "did NOT verify" sentence still show, verbatim', pv.badge === 'PARENT SECTION NAMED IN LAW' && pv.detail === parentEv.detail && /did NOT verify/.test(pv.detail));
  ok('H7 sectionIsBacked: only an exact amended / named section', sectionIsBacked(exactEv) && sectionIsBacked(amended) && sectionIsBacked(namedEv)
    && ![parentEv, { ...parentEv, rung: 'amended' as const, rungIndex: 1 as const }, recallEv, unresolved, null, undefined].some((e) => sectionIsBacked(e)));

  ok('H8 the compact row says "Recall" for every recalled section (a parent match included) and the government label only for a backed one',
    RECALL_ROW_WORD === 'Recall' && [recallEv, unresolved, null, undefined, parentEv, { ...parentEv, rung: 'amended' as const, rungIndex: 1 as const }].every((e) => rowEvidenceWord(e) === 'Recall')
    && rowEvidenceWord(exactEv) === 'Named in law' && rowEvidenceWord(amended) === 'State amendment');

  // ── I ────────────────────────────────────────────────────────────────
  section('I jurisdiction');
  ok('I1 the edition is the RCNYS volume, from its government source and date', /Residential Code of New York State/.test(info.editionLabel ?? '')
    && !!info.editionSourceUrl && /^\d{4}-\d{2}-\d{2}$/.test(info.editionCheckedOn ?? ''), JSON.stringify(info));
  ok('I2 the permit office is the verified Oyster Bay row with ITS OWN source and date', info.permitOfficeTitle === 'Town of Oyster Bay Building Division'
    && (info.permitOfficeSourceUrl ?? '').startsWith('https://oysterbaytown.com/') && info.permitOfficeCheckedOn === '2026-09-26', JSON.stringify(info));
  ok('I3 the viewer link is volume-level', VOLUME_URL.test(info.viewerUrl ?? ''));
  const unknown = codeJurisdictionInfoFor(resolveCodeJurisdiction({ state: 'ZZ', city: 'Nowhere' }), null);
  ok('I4 an unknown address fills nothing', unknown.editionLabel === null && unknown.viewerUrl === null && unknown.permitOfficeTitle === null);
  const nameOnly = codeJurisdictionInfoFor(NY, permitOfficeFor({ ...PLACE, town: { name: 'X town', basename: 'Xtown', geoid: '3605999999', kind: 'town' } }));
  ok('I5 a name-only office carries no borrowed source', !!nameOnly.permitOfficeTitle && nameOnly.permitOfficeSourceUrl === null && nameOnly.permitOfficeCheckedOn === null, JSON.stringify(nameOnly));
  ok('I6 source line: host + "checked Sep 12, 2026"', sourceLine('https://www.dos.ny.gov/x', '2026-09-12') === 'dos.ny.gov · checked Sep 12, 2026'
    && formatCheckedOn('2026-09-26') === 'Sep 26, 2026' && isoDateIn('NJ DCA roster, as of 2026-09-02') === '2026-09-02');

  // AN EDITION PRINTED WITHOUT A RECALL MARK IS ALWAYS A NAME MAGE HOLDS FOR A
  // VOLUME ADOPTED HERE. The real NY rows: the answer's edition is the 2025
  // RCNYS; an answer citing anything MAGE holds no record of is recall and is
  // never printed over the state's adoption record.
  const others = ['2020 RCNYS', 'IRC 2021', '2017 NEC', 'IRC', 'RCNYS', '2025', 'New York State Residential Code'];
  const same = ['2025 RCNYS', 'RCNYS 2025', 'rcnys, 2025', '2025 Residential Code of New York State', '2025 Residential Code of New York State (2025 RCNYS)'];
  const evFor = (cited: string) => citationEvidenceFor(NY, cited, 'R312.1');
  ok('I7 the cited edition is the answer’s verified one only when it is, word for word, one of its own names',
    same.every((c) => isVerifiedEdition(c, info)) && [...others, '2025 ECCCNYS'].every((c) => !isVerifiedEdition(c, info)) && !isVerifiedEdition('', info) && !isVerifiedEdition(undefined, info),
    [...same.filter((c) => !isVerifiedEdition(c, info)), ...others.filter((c) => isVerifiedEdition(c, info))].join(' | '));
  ok('I8 with no verified edition nothing a model cites is the "same" edition', [null, undefined, unknown, { ...info, editionLabel: null }].every((i) => !isVerifiedEdition('2025 RCNYS', i)));
  const vOther = editionViewFor({ citedEdition: '2020 RCNYS', evidence: evFor('2020 RCNYS') }, info);
  const vSame = editionViewFor({ citedEdition: '2025 RCNYS', evidence: evFor('2025 RCNYS') }, info);
  ok('I9 an edition MAGE holds no record of is recall: marked on the card, set apart on the opened card; the verified label stays the jurisdiction’s own',
    vOther.verified === info.editionLabel && vOther.kind === 'recall' && vOther.cited === '2020 RCNYS' && vOther.meta === `2020 RCNYS ${AS_CITED_MARK}` && AS_CITED_MARK === '(as cited)'
    && vOther.citedLine === 'The AI cited: 2020 RCNYS (model recall)' && citedEditionLine(' 2020 RCNYS ') === vOther.citedLine, JSON.stringify(vOther));
  ok('I10 the verified edition prints bare, as cited or as the jurisdiction names it, and gets no second line', vSame.kind === 'same' && vSame.citedLine === null && vSame.meta === '2025 RCNYS'
    && editionViewFor({}, info).meta === info.editionLabel && editionViewFor({}, info).kind === null && editionViewFor({}, info).citedLine === null
    && editionForItem({ citedEdition: '2025 RCNYS' }, info) === '2025 RCNYS');
  ok('I11 no verified edition and no record: a cited one is marked, none at all is null ("Edition not confirmed")',
    editionViewFor({ citedEdition: 'IRC 2021' }, null).meta === `IRC 2021 ${AS_CITED_MARK}` && editionViewFor({ citedEdition: 'IRC 2021' }, null).verified === null
    && editionViewFor({ citedEdition: 'IRC 2021', evidence: null }, null).kind === 'recall' && editionViewFor({}, null).meta === null && editionForItem({ citedEdition: ' ' }, unknown) === null);
  ok('I12 every edition the reviewer probed is recall, whatever MAGE’s lookup resolved the citation to (a bare "RCNYS" resolves to a volume and is still not its name)',
    others.every((c) => {
      const v = editionViewFor({ citedEdition: c, evidence: evFor(c) }, info);
      return v.kind === 'recall' && v.meta === `${c} ${AS_CITED_MARK}` && v.citedLine === citedEditionLine(c) && v.verified === info.editionLabel;
    }) && !!evFor('RCNYS').viewerLabel && !isAdoptedVolume('RCNYS', evFor('RCNYS')));
  // Code Check, plan check and the sweep build the answer's edition with NO
  // cited code, so in New York it is the list of every adopted code. A card
  // citing one of them by name is not recall.
  const infoAll = codeJurisdictionInfoFor(NY, null, null);
  const vAdopted = editionViewFor({ citedEdition: '2025 RCNYS', evidence: evFor('2025 RCNYS') }, infoAll);
  const vEnergy = editionViewFor({ citedEdition: 'ECCCNYS 2025', evidence: evFor('ECCCNYS 2025') }, info);
  ok('I13 another volume MAGE’s own lookup resolved this citation to is "adopted": bare on the card, its own line (no recall mark, no source) on the opened card',
    infoAll.viewerLabel === null && /Energy Conservation/.test(infoAll.editionLabel ?? '') && !isVerifiedEdition('2025 RCNYS', infoAll)
    && vAdopted.kind === 'adopted' && vAdopted.meta === '2025 RCNYS' && vAdopted.citedLine === 'Cited on this card: 2025 RCNYS' && vAdopted.verified === infoAll.editionLabel
    && vEnergy.kind === 'adopted' && vEnergy.meta === 'ECCCNYS 2025' && vEnergy.citedLine === adoptedEditionLine('ECCCNYS 2025') && vEnergy.verified === info.editionLabel,
    `${JSON.stringify(vAdopted)} ${JSON.stringify(vEnergy)}`);
  ok('I14 "adopted" needs MAGE’s own lookup AND the volume’s exact name: no evidence, an unresolved lookup or a different year is recall',
    editionViewFor({ citedEdition: '2025 RCNYS' }, infoAll).kind === 'recall' && editionViewFor({ citedEdition: '2025 RCNYS', evidence: null }, infoAll).kind === 'recall'
    && editionViewFor({ citedEdition: '2020 RCNYS', evidence: evFor('2025 RCNYS') }, infoAll).kind === 'recall'
    && isAdoptedVolume('2025 RCNYS', evFor('2025 RCNYS')) && !isAdoptedVolume('2025 RCNYS', { viewerLabel: null }) && !isAdoptedVolume('', evFor('2025 RCNYS'))
    && evFor('2020 RCNYS').viewerLabel === null);
  ok('I15 no line of any edition view carries a source: the source line is built only from the jurisdiction’s own record',
    [vOther, vSame, vAdopted, vEnergy].every((v) => !/dos\.ny\.gov|checked/.test(`${v.meta} ${v.citedLine}`)));

  // ── J ────────────────────────────────────────────────────────────────
  section('J sunlight');
  const sun = memStorage();
  __resetSunlightForTest(sun);
  let sunHeard = 0;
  const unsub = subscribeSunlight(() => { sunHeard++; });
  setSunlight(true);
  ok('J1 Sunlight turns on, is heard and is kept under its mageid_ key', getSunlight() && sunHeard === 1 && sun.data[CODE_SUNLIGHT_KEY] === '1');
  unsub();
  const sun2 = memStorage({ [CODE_SUNLIGHT_KEY]: '1' });
  __resetSunlightForTest(sun2);
  const unsub2 = subscribeSunlight(() => {});
  await new Promise((r) => setTimeout(r, 5));
  ok('J2 the stored preference loads on first subscribe', getSunlight() === true);
  unsub2();
  const sun3 = memStorage({ [CODE_SUNLIGHT_KEY]: '1' });
  __resetSunlightForTest(sun3);
  let lateHeard = 0;
  const unsub3 = subscribeSunlight(() => { lateHeard++; });   // starts the read
  resetSunlight();                                            // the tenant wipe, before storage answers
  await new Promise((r) => setTimeout(r, 5));
  ok('J3 a preference read still in flight at the tenant wipe never lands for the next user', getSunlight() === false && lateHeard === 0);
  unsub3();
  __resetSunlightForTest(null);

  // ── K ────────────────────────────────────────────────────────────────
  section('K component rules');
  const dir = join(ROOT, 'components', 'codeCard');
  const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f));
  const src = (f: string) => readFileSync(join(dir, f), 'utf8');
  const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const need = ['CodeCard.tsx', 'CodeCardRow.tsx', 'CodeCardList.tsx', 'CodeCardSheet.tsx', 'JurisdictionBlock.tsx', 'EvidenceMeter.tsx', 'ThresholdTape.tsx', 'VerdictTag.tsx', 'index.ts'];
  ok('K1 every kit component exists', need.every((f) => files.includes(f)), need.filter((f) => !files.includes(f)).join(', '));
  const AMBER_OK = new Set(['CodeCard.tsx', 'CodeCardRow.tsx', 'CodeCardList.tsx', 'CodeCardSheet.tsx', 'palette.ts']);
  const amberLeaks = files.filter((f) => !AMBER_OK.has(f) && /\bwarn(?:Label|Soft)\b|warningLabel|warningSoft/.test(code(f)));
  ok('K2 amber is reserved: never in the evidence meter, verdict tag, tape or jurisdiction block', amberLeaks.length === 0, amberLeaks.join(', '));
  ok('K3 the evidence meter never uses the warning triangle', !/TriangleAlert|AlertTriangle/.test(code('EvidenceMeter.tsx')));
  const openers = files.filter((f) => /Linking\.openURL\([^)]*(?:viewer|icc)/i.test(code(f)) || /codes\.iccsafe\.org/.test(code(f)));
  ok('K4 no component opens or builds an ICC link itself (officialText.ts does, through viewerUrlToOpen)', openers.length === 0, openers.join(', '));
  const storage = files.filter((f) => /async-storage/.test(code(f)));
  ok('K5 components never touch AsyncStorage directly', storage.length === 0, storage.join(', '));
  ok('K6 surfaces are the Card primitive, not hand-rolled', ['CodeCard.tsx', 'CodeCardList.tsx', 'JurisdictionBlock.tsx'].every((f) => /<Card\b/.test(code(f)))
    && files.every((f) => !/backgroundColor:\s*(?:t|themeColors|colors)\.surface\b/.test(code(f))));
  ok('K7 card actions are 50 pt; bulk primary is the 56 pt button; stepper 60 pt',
    /act:\s*\{[^}]*height:\s*50/.test(code('CodeCard.tsx')) && /size=\{size\}/.test(code('CodeCardList.tsx')) && /'lg'/.test(code('CodeCardList.tsx'))
    && /stepBtn:\s*\{[^}]*width:\s*60,\s*height:\s*60/.test(code('CodeCardSheet.tsx')));
  ok('K8 the list and the sheet end with the confirm block and the not-affiliated line',
    ['CodeCardList.tsx', 'CodeCardSheet.tsx'].every((f) => /<ConfirmBlock/.test(code(f)) && /NOT_AFFILIATED/.test(code(f)))
    && /Confirm with your building department\./.test(code('parts.tsx')) && /MAGE ID is not affiliated with ICC\./.test(code('parts.tsx')));
  ok('K9 the sheet re-runs the verdict, the equation and the sub text from the stepped number',
    /stepJobValue\(baseJv, taps\)/.test(code('CodeCardSheet.tsx')) && /effectiveVerdict\(item, jv\)/.test(code('CodeCardSheet.tsx'))
    && /recheckEquation\(item, jv\)/.test(code('CodeCardSheet.tsx')) && /shareTextFor\(shown, \{[^}]*jobValue: jv/.test(code('CodeCardSheet.tsx')));
  ok('K10 the tape only renders behind canRecheck', /canRecheck\(\{ jobValue, trigger \}\)\) return null/.test(code('ThresholdTape.tsx')));
  const shall = files.filter((f) => /['"`][^'"`\n]*\bshall\b[^'"`\n]*['"`]/i.test(code(f)));
  ok('K11 no component string carries code phrasing', shall.length === 0, shall.join(', '));
  ok('K12 the sheet hands the text to the caller; it never sends', !/fetch\(|supabase|sendSms|MailComposer/.test(code('CodeCardSheet.tsx')) && /onSendToSub\(recipient, text\)/.test(code('CodeCardSheet.tsx')));
  ok('K13 the stage is labelled as the AI’s guess and is editable', /AI guess/.test(code('CodeCard.tsx')) && /AI guess/.test(code('CodeCardSheet.tsx')) && /onStageChange\?\.\(item, s\)/.test(code('CodeCardSheet.tsx')));
  ok('K14 the sample mark is "Sample"', /Sample/.test(code('VerdictTag.tsx')));
  const tape = code('ThresholdTape.tsx');
  ok('K15 the tape is never handed the citation’s evidence, so it cannot credit the trigger to a source',
    !/\bevidence\b/.test(tape) && !/isGovernmentRung|sectionIsBacked|a government record/.test(tape));
  ok('K16 the tape always labels the trigger as model recall (source line and screen-reader label)',
    /TRIGGER_RECALL_TAIL = 'trigger is model recall'/.test(tape)
    && /const trigNote = `\$\{formatJobNumber\(trigger\.value, trigger\.unit\)\} \$\{TRIGGER_RECALL_TAIL\}`;/.test(tape)
    && /\{`\$\{jobText\} from \$\{jobValue\.sourceLabel\} · \$\{trigNote\}`\}/.test(tape)
    && /accessibilityLabel=\{`Job \$\{jobText\}\. \$\{trigText\}\. The trigger is model recall\.`\}/.test(tape));
  const sheet = code('CodeCardSheet.tsx');
  ok('K17 the opened card says the trigger number is model recall on EVERY rung (no condition around it)',
    /TRIGGER_RECALL_LINE = 'The trigger number is model recall\. Confirm it in the official text\.'/.test(sheet)
    && /<\/Text>\s*\) : null\}\s*\{\/\*[^*]*\*\/\}\s*<Text style=\{styles\.recallNote\}[^>]*>\{TRIGGER_RECALL_LINE\}<\/Text>/.test(src('CodeCardSheet.tsx'))
    && (sheet.match(/TRIGGER_RECALL_LINE/g) ?? []).length === 2);
  const rungDeciders = files.filter((f) => /\.rung\b|amended\|named|parentMatch/.test(code(f)));
  ok('K18 no component decides "government-backed" itself (evidence.ts sectionIsBacked / evidenceView do)', rungDeciders.length === 0, rungDeciders.join(', '));
  ok('K19 the card and the opened card render the Sample tag behind `sample`',
    ['CodeCard.tsx', 'CodeCardSheet.tsx'].every((f) => /\{sample \? <SampleTag sunlight=\{sunlight\} \/> : null\}/.test(code(f))));
  ok('K20 the opened card’s Sunlight switch shows the value that drives its palette, and writes the stored preference unless pinned',
    /const sunlight: boolean = sunPinned \? \(localSun \?\? !!sunlightProp\) : storedSun;/.test(sheet)
    && /const P = useCodeCardPalette\(sunlight\);/.test(sheet)
    && /<SunlightToggle value=\{sunlight\} onChange=\{sunPinned \? setLocalSun : setSunlight\}/.test(sheet));
  ok('K21 the opened card starts from the saved number when given one, fixed at open',
    /jobValue\?: CodeJobValue;/.test(sheet) && /const \[baseJv\] = useState<CodeJobValue \| undefined>\(\(\) => jobValueProp \?\? item\.jobValue\);/.test(sheet));
  ok('K22 a card with no section says "No section given" on the card, the row and the opened card',
    /NO_SECTION_GIVEN = 'No section given'/.test(code('CodeCard.tsx')) && ['CodeCard.tsx', 'CodeCardRow.tsx', 'CodeCardSheet.tsx'].every((f) => /\{NO_SECTION_GIVEN\}/.test(code(f))));

  const row = code('CodeCardRow.tsx');
  const card = code('CodeCard.tsx');
  const list = code('CodeCardList.tsx');
  ok('K23 the row prints the evidence word from evidence.ts and holds no government label of its own',
    /<Text style=\{styles\.mText\}>\{rowEvidenceWord\(item\.evidence\)\}<\/Text>/.test(row) && !/Named in law|State amendment|evidenceView/.test(row));
  ok('K24 on the opened card a government source line sits ONLY under the verified edition; what the card cites goes on its own line under it',
    /<Text style=\{styles\.rrText\}>\{info\.editionLabel\}<\/Text>\s*<Text style=\{styles\.rrSmall\}>\{sourceLine\(info\.editionSourceUrl, info\.editionCheckedOn\) \?\? 'Source not on file'\}<\/Text>\s*\{edition\.citedLine \? <Text style=\{styles\.rrSmall\} testID=\{`\$\{tid\}-cited`\}>\{edition\.citedLine\}<\/Text> : null\}/.test(sheet)
    && (sheet.match(/info\.editionSourceUrl/g) ?? []).length === 1
    && /<Text style=\{styles\.rrText\}>\{edition\.citedLine \?\? EDITION_NOT_CONFIRMED\}<\/Text>\s*<Text style=\{styles\.rrSmall\}>No verified adoption record for this address\.<\/Text>/.test(sheet)
    && (sheet.match(/sourceLine\(/g) ?? []).length === 2 && !/edition\.(?:meta|cited)\b/.test(sheet)
    && /const edition = editionViewFor\(item, info\);/.test(sheet));
  const citedReaders = files.filter((f) => /\bcitedEdition\b/.test(code(f)));
  ok('K25 no component reads the cited edition itself: the card, the row and the list all print editionForItem (marked when not verified)',
    citedReaders.length === 0 && /const edition = editionForItem\(item, info\);/.test(card) && /\{edition \?\? EDITION_NOT_CONFIRMED\}/.test(card)
    && /const editionText = edition \? editionForItem\(item, info\) : null;/.test(row) && /\{editionText \? <Text style=\{styles\.mText\}>\{editionText\}<\/Text> : null\}/.test(row)
    && !/\{edition\}/.test(row) && /edition=\{mode === 'answer' \? editionForItem\(item, info\) : null\}\s*info=\{info\}/.test(list), citedReaders.join(', '));
  ok('K26 a button with no action, or a blocked one, is never silent: the card and the opened card both say why',
    /onPress=\{press\(label, action \?\? \{ kind: 'blocked', reason: 'Not available here\.' \}\)\}/.test(card)
    && /else if \(action\.kind === 'blocked'\) setNote\(`\$\{label\}: \$\{action\.reason\}`\);/.test(card)
    && /if \(!action\) \{ setNote\(`\$\{label\}: not available here\.`\); return; \}/.test(sheet)
    && /else if \(action\.kind === 'blocked'\) setNote\(`\$\{label\}: \$\{action\.reason\}`\);/.test(sheet)
    && /\{blockedReasons\.length \? <BlockedNote text=\{blockedReasons\.join\(' '\)\}/.test(list));
  const parts = code('parts.tsx');
  ok('K27 Checklist and Save are blocked, with the reason, for a card the stores cannot keep (never a live tap that does nothing)',
    /export function storeGated\(action: CodeCardAction \| undefined, item: unknown\): CodeCardAction \| undefined \{\s*if \(!action \|\| action\.kind !== 'ready'\) return action;\s*const reason = codeCardStoreBlockedReason\(item\);\s*return reason \? blockedAction\(reason\) : action;\s*\}/.test(parts)
    && /cell\('checklist', 'Checklist', ClipboardCheck, storeGated\(checklist, item\)\)/.test(card)
    && /ClipboardCheck, storeGated\(checklist, shown\), false\)/.test(sheet) && /Bookmark, storeGated\(save, shown\), true\)/.test(sheet));
  ok('K28 the opened card reports EVERY − / + tap with the number it is about to show (the step back to the start included)',
    /tapsRef\.current \+= d;\s*setTaps\(tapsRef\.current\);\s*onJobValueChange\?\.\(item, stepJobValue\(baseJv, tapsRef\.current\)\);/.test(sheet)
    && (sheet.match(/onJobValueChange\?\.\(/g) ?? []).length === 1 && !/taps !== 0/.test(sheet) && !/useEffect/.test(sheet));
  ok('K29 the plan list’s sources key says section numbers are model recall; recall bars are grey, never amber; a parent badge sits under the recall label',
    /\{': model recall\. Confirm before you rely on one\.'\}/.test(list) && /barOn: t\.textSecondary,/.test(code('palette.ts')) && !/barOn: t\.warn/.test(code('palette.ts'))
    && /<Text style=\{styles\.badge\}>\{v\.parent \? v\.short : badgeSentence\(v\.badge\)\}<\/Text>/.test(code('EvidenceMeter.tsx')));

  console.log(`\n  ${checks - failures}/${checks} passed`);
  if (failures) {
    console.error(`  ${failures} FAILED\n`);
    process.exit(1);
  }
  console.log('  PASS\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
