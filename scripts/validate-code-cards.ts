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
//   D  shareText.ts    sample tail, recall note, confirm line, MAGE sends nothing
//   E  parse.ts        unshowable items dropped, structured numbers only
//   F  pins / saved    reducers, persistence, replay, tenant wipe covers the keys
//   G  summary.ts      headline, tally, groups, bulk labels
//   H  evidence.ts     four bars = four rungs; recall grey, same words
//   I  jurisdiction.ts real NY rows: edition + Oyster Bay office, own sources
//   J  sunlight.ts     persisted under a mageid_ key
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
import { officialTextPlan, officialTextSteps, runOfficialText, OFFICIAL_TEXT_BLOCKED, viewerShortLabel } from '../utils/codeCard/officialText';
import {
  architectMessageFor, confirmLine, shareTextFor, smsUrlFor, mailtoUrlFor, subRecipientsFor, tradeMatches, RECALL_NOTE, SAMPLE_TAIL,
} from '../utils/codeCard/shareText';
import { attachEvidence, parseCodeCardItem, parseCodeCardItems } from '../utils/codeCard/parse';
import { createPinStore, makePin, parsePinsState, pinsByStage, pinsReducer, CODE_PINS_KEY, EMPTY_PINS, isPinned } from '../utils/codeCard/pins';
import { createSavedStore, makeSaved, parseSavedState, savedReducer, CODE_SAVED_KEY, EMPTY_SAVED, isSaved } from '../utils/codeCard/saved';
import {
  addAllLabel, architectButtonLabel, groupByStage, groupByStatus, planHeadline, requirementsCount, tallySquares,
} from '../utils/codeCard/summary';
import { evidenceView, RECALL_LABEL } from '../utils/codeCard/evidence';
import { codeJurisdictionInfoFor, formatCheckedOn, isoDateIn, sourceLine } from '../utils/codeCard/jurisdiction';
import { CODE_SUNLIGHT_KEY, getSunlight, setSunlight, subscribeSunlight, __resetSunlightForTest } from '../utils/codeCard/sunlight';
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

  // ── D ────────────────────────────────────────────────────────────────
  section('D shareText');
  const t1 = shareTextFor(guards, { jobLabel: 'Reyes deck, Massapequa', info, sample: true });
  ok('D1 a sample ends with (Sample)', t1.endsWith(SAMPLE_TAIL), t1);
  ok('D2 a real card does not say Sample', !shareTextFor(guards, { info }).includes('Sample'));
  ok('D3 it names the office with the final word', t1.includes('Confirm with Town of Oyster Bay Building Division.'), t1);
  ok('D4 no office: "Confirm with your building department."', confirmLine(null) === 'Confirm with your building department.');
  ok('D5 a recalled section says so in the text', t1.includes(RECALL_NOTE) && t1.includes('AI recall, confirm'), t1);
  const tGov = shareTextFor({ ...guards, evidence: namedEv }, { info });
  ok('D6 a government rung drops the recall notes', !tGov.includes(RECALL_NOTE) && !tGov.includes('AI recall'), tGov);
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
  ok('E6 forged evidence (index disagrees with rung) is dropped to null', parseCodeCardItem({ ...guards, evidence: { ...recallEv, rung: 'amended', rungIndex: 3 } })?.evidence === null);
  ok('E7 a missing stage flag means the stage is the AI’s guess', parseCodeCardItem({ ...guards, stageIsGuess: undefined })?.stageIsGuess === true);
  const attached = attachEvidence([{ ...guards, evidence: null }], NY);
  ok('E8 attachEvidence uses codeAmendments for this address (edition rung, volume link)', attached[0].evidence?.rung === 'edition' && VOLUME_URL.test(attached[0].evidence?.viewerUrl ?? ''),
    JSON.stringify(attached[0].evidence));
  ok('E9 no jurisdiction: evidence stays null (recall, unresolved)', attachEvidence([{ ...guards, evidence: null }], null)[0].evidence === null);

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
    && [amended, namedEv].every((e) => evidenceView(e).tone === 'government'));
  ok('H3 recall carries the same words in the same place', [recallEv, unresolved, null].every((e) => evidenceView(e).short === RECALL_LABEL));
  ok('H4 badge and detail are codeAmendments’ own', evidenceView(recallEv).badge === recallEv.badge && evidenceView(recallEv).detail === recallEv.detail);

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
