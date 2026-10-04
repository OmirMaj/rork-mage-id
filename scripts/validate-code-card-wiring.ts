// scripts/validate-code-card-wiring.ts — code cards, lane CCWIRE: the wiring
// of the code-card kit (components/codeCard, utils/codeCard) into the app's
// surfaces, proven on the real functions and the real source.
//
//   1. "Draft a question" widened to New York, New Jersey and Connecticut
//      towns (utils/departmentQuestion.ts): who it is addressed to, that no
//      person is ever named, that an email appears only from the office row,
//      that the prompt makes no filing claim and never names DOB, and which
//      jobs get which variant (askTownKind) — with the reason a blocked Ask
//      town gives.
//   2. Inspection Ready's "Pinned from code cards" group
//      (utils/inspectionPrep.ts): the stage an inspection is, read off its
//      name; which pins show on which inspection; the booked day per stage.
//   3. The wiring's own pure block (`// <pure:codeCardItems>` in
//      components/construction/AskConstructionMode.tsx, shared by Ask, Code
//      Check, Plan Review and the Plan Set Code Sweep) run under bun: a Code
//      Check citation is a card ONLY when the model gave one of the three
//      verdicts (never a default "Required"), a line that reads like code text
//      is WITHHELD (never trimmed, never shown), the section is never
//      invented, the ladder's evidence rides on the card; Plan Review findings
//      get a status that never infers "looks right"; a sweep row is 'ok' ONLY
//      from the server's "look right" list and then never carries a question;
//      ids come from the content, so a pin never lands on another answer's card.
//   3b. THE CODE CHECK WIRE, end to end on the real source: the tab's own
//      `codeCheckSchema` text is evaluated with the real zod, run through
//      utils/mageAI.ts' own deriveHintFromZod (its source, not a copy) and the
//      relay's inferSchema, and a full model row is parsed by it and built into
//      a card. A structured field the schema cannot carry fails here.
//   3c. WHAT A SURFACE OFFERS TO PIN OR SAVE COMES BACK AFTER A RESTART: every
//      builder's output goes through the real pins / saved reducers, JSON, and
//      parsePinsState / parseSavedState.
//   4. Source pins: the no-verbatim sentence in BOTH in-app prompts, the ICC
//      not-affiliated line beside the viewer buttons, recall in neutral grey
//      with the mismatch badge still amber, Ask renders cards only when the
//      answer carries usable requirements (else exactly the old prose) under
//      ONE JurisdictionBlock, every send opens HIS app, nothing calls a send
//      service; the sweep panel renders the cards above its unchanged
//      findings; Save lands in a list he can open and remove from; a pinned
//      card can be seen and unpinned at any time (Ask's pinned list) and from
//      Inspection Ready; every way Checklist / Save is blocked says why (no
//      project, a stand-in card, a card the store would refuse); the cards of
//      an answer are wired to the project that was ASKED for; the Plan Review
//      details toggle exists only while there are cards.
//   4b. THE WITHHOLD RULE COVERS EVERY PLACE THE LINE CAN APPEAR: a sweep
//      over every surface file. A line that reads an AI result's `.requirement`
//      or `.observed` (or the sweep view's `.title`) must run the own-words
//      gate on that line, read it from an object the gate made (`ownWords`, `row`),
//      or be one of the listed lines that print nothing. Code Check's result
//      is gated once where it comes in; Plan Review's findings where they are
//      saved and again where they print; the sweep's rows before the list, the
//      RFI draft and the punch item read them.
//      A bracket read or a destructured read of those keys is never accepted.
//      AN INCH MARK IS NOT A QUOTE: the same gates keep an honest drawing line
//      (36", 2'-8", 7-7/8") as written, on all three screens (section 3).
//      The saved check sheet (outside this lane) joins the sweep once its
//      patch is in; until then it is said out loud (a failure under
//      --require-optin).
//   4c. THE RE-MEASURE BELONGS TO ONE CARD AS IT WAS SHOWN: every read of a
//      re-measure in the hook goes through the kit's remeasureFor, with the
//      hook's own project; nothing is keyed on the card id alone.
//   4d. THE "SAVED" AND "ON … CHECKLIST" MARKS BELONG TO THE CARD AS SHOWN:
//      both go through the kit's keptIsShown (same verdict, trigger and shown
//      number), never the card id alone; a stage he picked is kept per job
//      and is never labelled "AI guess"; the saved lists' sheet stays mounted
//      while one of their cards is open; a stand-in card is never texted.
//   5. The client opt-in: both functions send the code-card rows only when the
//      request asks (`codeCards: true`), and the two request helpers are
//      outside this lane. None of it applied = a loud notice (a failure under
//      --require-optin); any of it applied = all of it must be.
//
// Pure: node:fs plus the pure utils. Run via: bun run scripts/validate-code-card-wiring.ts
// (after the opt-in patch is in: … --require-optin)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  askTownBlockedReason, askTownKind, buildQuestionPrompt, codeCardQuestion, routeOfficeQuestion,
  TOWN_FILING_FACT, TOWN_NAME_ONLY_NOTE, type TownOfficeLike,
} from '../utils/departmentQuestion';
import { DEPARTMENTS, NAME_ONLY_NOTE } from '../utils/permitOffices';
import {
  bookedStageDays, pinnedPrepItems, PINNED_NOTE, stageForInspectionName,
} from '../utils/inspectionPrep';
import { z } from 'zod';
import { codeCardStoreBlockedReason, parseCodeCardItem, parseCodeCardItems, STORED_TEXT_MAX } from '../utils/codeCard/parse';
import { EMPTY_REMEASURES, keptIsShown, recordRemeasure, remeasureFor } from '../utils/codeCard/remeasure';
import { rfiFromSweepFinding, punchFromSweepFinding, sweepFindingView } from '../utils/plans/planSweep';
import { canRecheck, effectiveVerdict, recheckOutcome, stepJobValue } from '../utils/codeCard/verdict';
import { architectMessageFor, shareBlockedReason, shareTextFor, NO_WORDS_SEND } from '../utils/codeCard/shareText';
import { isStandInLine, passesEchoCheck, LINE_NO_TEXT, LINE_WITHHELD } from '../utils/codeCard/echoCheck';
import { saysNumberWithUnit } from '../utils/codeCard/saysWithUnit';
import { evidenceView, sectionIsBacked } from '../utils/codeCard/evidence';
import { EMPTY_PINS, makePin, parsePinsState, pinnedStage, pinsReducer } from '../utils/codeCard/pins';
import { EMPTY_SAVED, isSaved, makeSaved, parseSavedState, savedReducer } from '../utils/codeCard/saved';
import { followUpsZod } from '../utils/codeThread/followUps';
import { inferSchema } from '../supabase/functions/_shared/inferSchema';
import { citationEvidenceFor } from '../utils/codeAmendments';
import { resolveCodeJurisdiction } from '../utils/codeJurisdiction';
import { encodePermitInspectionNotes } from '../utils/permitInspectionHistory';
import type { CodeCardItem, CodePin } from '../utils/codeCard/types';
import type { Permit, Project } from '../types';

declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' }) => { transformSync(code: string): string };
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const read = (rel: string): string => {
  try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; }
};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, extra ? `\n     ${extra}` : ''); }
}

/** The exports of the `// <pure:name>` block in `src`, transpiled and run. */
function loadPure(src: string, name: string, exportNames: string[]): Record<string, unknown> | null {
  const m = src.match(new RegExp(`// <pure:${name}>\\n([\\s\\S]*?)// </pure:${name}>`));
  if (!m) return null;
  const body = m[1].replace(/^export /gm, '');
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(`${body}\nmodule.exports = { ${exportNames.join(', ')} };`);
  const mod: { exports: Record<string, unknown> } = { exports: {} };
  new Function('module', 'exports', js)(mod, mod.exports);
  return mod.exports;
}
/** `src` transpiled and run with `args` in scope; its `name` binding, or null when it does not evaluate. */
function evalSource<T>(src: string, name: string, args: Record<string, unknown>): T | null {
  try {
    const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(`${src}\nmodule.exports = ${name};`);
    const mod: { exports: unknown } = { exports: null };
    new Function('module', ...Object.keys(args), js)(mod, ...Object.values(args));
    return (mod.exports as T) ?? null;
  } catch {
    return null;
  }
}
/** The source between `from` and the first `to` after it ('' when absent). */
function between(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  if (a < 0) return '';
  const b = src.indexOf(to, a + from.length);
  return b < 0 ? '' : src.slice(a, b);
}

const job = (over: Partial<Project>): Project => ({ id: 'p1', name: 'Reyes deck', location: '', ...over } as unknown as Project);

// ── 1. Draft a question, NY / NJ / CT towns ───────────────────────────────
console.log('\n1. Draft a question reaches NY, NJ and CT towns, and sends nothing');
{
  const verified: TownOfficeLike = {
    title: 'Town of Oyster Bay Building Division', jurisdiction: 'Town of Oyster Bay',
    email: 'building@example.gov', phone: '(516) 624-6200 ext. 1', verification: 'hand-verified',
    sourceLabel: 'oysterbaytown.com, checked 2026-09-26',
  };
  const r = routeOfficeQuestion(verified);
  ok('a town routing names no person', r.toName === null && r.toDetail === null);
  ok("a verified office's own email is used", r.toEmail === 'building@example.gov', String(r.toEmail));
  ok('it is addressed to the office by its title', r.addressedTo === verified.title && r.toFallback === `Address it to the ${verified.title}.`, r.toFallback);
  ok("the why is the row's own source label", r.whyThisChannel === 'From oysterbaytown.com, checked 2026-09-26.', r.whyThisChannel);
  ok('the filing is "not checked", with the fixed line', r.filingState === 'not_checked' && JSON.stringify(r.filingFacts) === JSON.stringify([TOWN_FILING_FACT]));
  ok('no channel is invented', r.channel === null);

  const nameOnly = routeOfficeQuestion({ ...verified, verification: 'name-only', email: 'guess@example.com', sourceLabel: 'US Census geography' });
  ok('a name-only office never carries an email, even a stray one', nameOnly.toEmail === null);
  ok('a name-only office says MAGE has not verified its contacts', nameOnly.toFallback.includes("MAGE hasn't verified this office's contact details"), nameOnly.toFallback);
  ok("the name-only why is permitOffices' own fixed note, verbatim", nameOnly.whyThisChannel === TOWN_NAME_ONLY_NOTE && TOWN_NAME_ONLY_NOTE === NAME_ONLY_NOTE);
  const noTitle = routeOfficeQuestion({ ...verified, title: ' ', jurisdiction: ' ' });
  ok('an office with no title still reads as a sentence', noTitle.toFallback === 'Address it to the building department.' && noTitle.addressedTo === 'the building department', noTitle.toFallback);

  // A real office row out of the lists the app ships.
  const real = Object.values(DEPARTMENTS).find((o) => o.verification === 'state-list' && !!o.email);
  ok('a real state-list office with an email exists in the shipped lists', !!real);
  if (real) {
    const rr = routeOfficeQuestion(real);
    ok('the real office routes to its own listed email', rr.toEmail === real.email, String(rr.toEmail));
  }

  const project = job({ location: '120 Main St, Massapequa, NY 11758' });
  const draft = buildQuestionPrompt({ project, routing: r, question: 'Does the town amend the guard height?', buildingSummary: null });
  ok('the town prompt is addressed to the office', draft.prompt.includes(`The email is addressed to: ${verified.title}`));
  ok('the town prompt carries the not-checked filing line', draft.prompt.includes(TOWN_FILING_FACT));
  ok('the town prompt never names DOB', !/\bDOB\b/.test(draft.prompt));
  ok('the town prompt keeps "Ask; do not assert"', draft.prompt.includes('Ask; do not assert.'));

  ok('askTownKind: a Long Island job is a town', askTownKind(job({ location: '120 Main St, Massapequa, NY 11758' })) === 'town');
  ok('askTownKind: a New Jersey job is a town', askTownKind(job({ location: '10 Elm St, Hoboken, NJ 07030' })) === 'town');
  ok('askTownKind: a Connecticut job is a town', askTownKind(job({ location: '5 Oak Ave, Stamford, CT 06901' })) === 'town');
  ok('askTownKind: a Brooklyn job is NYC (the verified department row)', askTownKind(job({ location: '124 Park Slope, Brooklyn, NY 11215' })) === 'nyc');
  ok('askTownKind: a Maryland job keeps its own flow', askTownKind(job({ location: '620 E 31st St, Baltimore, MD 21218' })) === 'md');
  ok('askTownKind: Portland, OR has none', askTownKind(job({ location: '4218 SE Rex St, Portland, OR 97206' })) === null);
  ok('askTownKind: no job, none', askTownKind(null) === null);
  ok('blocked reason: no project says link a project', (askTownBlockedReason(null) ?? '').startsWith('Link a project first'));
  ok('blocked reason: Maryland points at its own button', (askTownBlockedReason(job({ location: 'Baltimore, MD 21218' })) ?? '').includes('Maryland'));
  ok('blocked reason: outside NY/NJ/CT says where it works', (askTownBlockedReason(job({ location: 'Portland, OR 97206' })) ?? '').includes('New York, New Jersey and Connecticut'));
  ok('blocked reason: a town job is not blocked', askTownBlockedReason(job({ location: '120 Main St, Massapequa, NY 11758' })) === null);

  const q = codeCardQuestion({ summary: 'Guards on every open side, at least 36 in. high.', section: 'R312.1', citedEdition: '2025 RCNYS' });
  ok('the card question carries our summary, the edition and the section', q.includes('Guards on every open side, at least 36 in. high (2025 RCNYS R312.1).'), q);
  ok('the card question says the section is AI recall and asks to confirm', q.includes('MAGE marked the section as AI recall.') && q.endsWith('Can you confirm the section and edition you enforce?'), q);
  ok('the card question quotes nothing', !/["“”]/.test(q));
  ok('a card with no section still reads cleanly', codeCardQuestion({ summary: 'Light at the top of the stair.', section: '' }).includes('Light at the top of the stair. MAGE'));
  const gov = codeCardQuestion({ summary: 'Guards on every open side.', section: 'R312.1', citedEdition: '2025 RCNYS', evidence: { rung: 'named' } });
  ok('a section a government document names is NOT called AI recall', !gov.includes('AI recall') && gov.endsWith('Can you confirm the section and edition you enforce?'), gov);
  ok('…and an amended one neither', !codeCardQuestion({ summary: 'Guards.', section: 'R312.1', evidence: { rung: 'amended' } }).includes('AI recall'));
  ok('…while an edition-only or unresolved one is', codeCardQuestion({ summary: 'Guards.', section: 'R312.1', evidence: { rung: 'edition' } }).includes('AI recall')
    && codeCardQuestion({ summary: 'Guards.', section: 'R312.1', evidence: { rung: 'unresolved' } }).includes('AI recall')
    && codeCardQuestion({ summary: 'Guards.', section: 'R312.1', evidence: null }).includes('AI recall'));
  {
    // A PARENT match is rung 'named' / 'amended' but NOT backing: the card says
    // "Model recall · confirm", so the draft must say AI recall too. Real New
    // York rows: 19 NYCRR 1220.2 names RCNYS P2904; P2904.1 is only its child.
    const nyTown = resolveCodeJurisdiction({ city: 'Oyster Bay', state: 'NY' });
    const exact = citationEvidenceFor(nyTown, '2025 RCNYS', 'P2904');
    const parent = citationEvidenceFor(nyTown, '2025 RCNYS', 'P2904.1');
    ok('fixture: P2904 is named in law, P2904.1 is a parent-only match on the same rung',
      exact.rung === 'named' && exact.parentMatch !== true && parent.rung === 'named' && parent.parentMatch === true && sectionIsBacked(exact) && !sectionIsBacked(parent));
    const parentDraft = codeCardQuestion({ summary: 'Sample: sprinklers in the new dwelling.', section: 'P2904.1', citedEdition: '2025 RCNYS', evidence: parent });
    ok('a PARENT match is still called AI recall in the draft, as it is on the card',
      evidenceView(parent).short === 'Model recall · confirm' && parentDraft.includes('MAGE marked the section as AI recall.'), parentDraft);
    ok('…and so is a parent match on the amended rung', codeCardQuestion({ summary: 'Guards.', section: 'R312.1.3', evidence: { rung: 'amended', parentMatch: true } }).includes('AI recall'));
    ok('…while the section the record itself names is not',
      !codeCardQuestion({ summary: 'Sample: sprinklers in the new dwelling.', section: 'P2904', citedEdition: '2025 RCNYS', evidence: exact }).includes('AI recall'));
    ok('the draft and the card use ONE test (sectionIsBacked), not the rung alone',
      /const government = sectionIsBacked\(item\.evidence\);/.test(read('utils/departmentQuestion.ts')) && !/item\.evidence\?\.rung ===/.test(read('utils/departmentQuestion.ts')));
  }
  const blank = codeCardQuestion({ summary: 'MAGE hid this line because it read like code text. Use Official text to read the section.', section: 'R312.1', citedEdition: '2025 RCNYS' }, { noWords: true });
  ok("a card with no words asks what the section requires, never repeating MAGE's stand-in line",
    blank.startsWith('What does 2025 RCNYS R312.1 require here, and does the town amend it?') && !blank.includes('MAGE hid'), blank);
  ok('…and with no section either, it asks which section covers the work',
    codeCardQuestion({ summary: 'x', section: '' }, { noWords: true }).startsWith('Which code section covers this work here'));
  for (const text of [q, gov, blank, askTownBlockedReason(null) ?? '', askTownBlockedReason(job({ location: 'Baltimore, MD 21218' })) ?? '', askTownBlockedReason(job({ location: 'Portland, OR 97206' })) ?? '']) {
    ok(`copy says project, never job: ${text.slice(0, 40)}…`, !/\bjobs?\b/i.test(text), text);
  }
}

// ── 2. Inspection Ready: pinned from code cards ──────────────────────────
console.log('\n2. Inspection Ready shows the pins for THIS inspection');
{
  ok('"Final inspection" is final', stageForInspectionName('Final inspection') === 'final');
  ok('"Final electrical" is final, not rough', stageForInspectionName('Final electrical') === 'final');
  ok('"Footing inspection" is footing', stageForInspectionName('Footing inspection') === 'footing');
  ok('"Foundation" is foundation', stageForInspectionName('Foundation') === 'foundation');
  ok('"Rough framing" is framing (checked before rough)', stageForInspectionName('Rough framing') === 'framing');
  ok('"Rough electrical" is rough', stageForInspectionName('Rough electrical') === 'rough');
  ok('"Plumbing rough-in" is rough', stageForInspectionName('Plumbing rough-in') === 'rough');
  ok('"Insulation" is insulation', stageForInspectionName('Insulation inspection') === 'insulation');
  ok('"Certificate of occupancy" is final', stageForInspectionName('Certificate of occupancy') === 'final');
  ok('a plain "Inspection" names no stage', stageForInspectionName('Inspection') === null);
  ok('empty / null names no stage', stageForInspectionName('') === null && stageForInspectionName(null) === null);

  const item = (id: string, summary: string, stage?: CodeCardItem['stage']): CodeCardItem => ({
    id, verdict: 'required', summary, section: 'R312.1', citedEdition: '2025 RCNYS', evidence: null, stage, stageIsGuess: true,
  });
  const pin = (id: string, projectId: string, stage: CodePin['stage'], at: string, summary = `Sample ${id}`): CodePin => ({
    id: `${projectId}:${id}`, projectId, stage, item: item(id, summary, stage), pinnedAt: at,
  });
  const pins: CodePin[] = [
    pin('a', 'p1', 'final', '2026-10-01T10:00:00.000Z'),
    pin('b', 'p1', 'framing', '2026-10-01T11:00:00.000Z'),
    pin('c', 'p1', 'other', '2026-10-01T12:00:00.000Z'),
    pin('d', 'p2', 'final', '2026-10-01T13:00:00.000Z'),
    pin('e', 'p1', 'final', '2026-10-02T09:00:00.000Z'),
    pin('f', 'p1', 'final', '2026-10-02T10:00:00.000Z', '   '),
  ];
  const finalItems = pinnedPrepItems(pins, { projectId: 'p1', name: 'Final inspection' });
  ok('a final shows the final pins and the no-stage pin, newest first',
    JSON.stringify(finalItems.map((i) => i.text)) === JSON.stringify(['Sample e', 'Sample c', 'Sample a']), JSON.stringify(finalItems.map((i) => i.text)));
  ok("another job's pin never shows", !finalItems.some((i) => i.text === 'Sample d'));
  ok('a framing pin is not on the final', !finalItems.some((i) => i.text === 'Sample b'));
  ok('a pin with no words is dropped', !finalItems.some((i) => !i.text.trim()));
  ok("every item is in the 'pinned' group", finalItems.every((i) => i.group === 'pinned'));
  ok('the code ref is edition + section', finalItems[0]?.codeRef === '2025 RCNYS R312.1');
  ok("each pinned item carries its card's own id, for Unpin", JSON.stringify(finalItems.map((i) => i.pinItemId)) === JSON.stringify(['e', 'c', 'a']));
  ok('the no-stage pin says it has no stage', finalItems.find((i) => i.text === 'Sample c')?.why === 'Pinned from a code card · no inspection stage set');
  const vague = pinnedPrepItems(pins, { projectId: 'p1', name: 'Inspection' });
  ok('an inspection whose name names no stage shows ONLY the no-stage pins', JSON.stringify(vague.map((i) => i.text)) === JSON.stringify(['Sample c']));
  ok('ids are stable across calls', JSON.stringify(finalItems.map((i) => i.id)) === JSON.stringify(pinnedPrepItems(pins, { projectId: 'p1', name: 'Final inspection' }).map((i) => i.id)));
  ok('the group note says MAGE’s words, AI recall, confirm', PINNED_NOTE.includes('MAGE’s words') && PINNED_NOTE.includes('AI recall') && PINNED_NOTE.includes('Confirm with your building department'));

  const permit = (over: Partial<Permit>): Permit => ({
    id: 'x', projectId: 'p1', projectName: 'Reyes deck', type: 'building', permitNumber: 'B-1', jurisdiction: 'Town',
    status: 'inspection_scheduled', appliedDate: '2026-09-01', fee: 0, ...over,
  } as Permit);
  const days = bookedStageDays([
    permit({ id: '1', phase: 'Final inspection', inspectionDate: '2026-10-20' }),
    permit({ id: '2', phase: 'Final inspection', inspectionDate: '2026-10-12' }),
    permit({ id: '3', phase: 'Footing', inspectionDate: '2026-09-01' }),
    permit({ id: '4', phase: 'Framing', inspectionDate: '2026-10-09', status: 'inspection_passed' }),
    permit({ id: '5', projectId: 'p2', phase: 'Rough electrical', inspectionDate: '2026-10-10' }),
    permit({
      id: '6', phase: 'Inspection', inspectionDate: '',
      inspectionNotes: encodePermitInspectionNotes('', [
        { id: 'r1', name: 'Rough framing', scheduledFor: '2026-10-15', result: 'scheduled', recordedAt: '2026-10-01T00:00:00.000Z' },
        { id: 'r2', name: 'Insulation', scheduledFor: '2026-10-16', result: 'passed', recordedAt: '2026-10-01T00:00:00.000Z' },
      ]),
    }),
  ], 'p1', '2026-10-03');
  ok('the earliest booked final wins', days.final === '2026-10-12', String(days.final));
  ok('a past day is not "booked"', days.footing === undefined);
  ok('a passed head is not booked; a scheduled history row is', days.framing === '2026-10-15', String(days.framing));
  ok('a called history row is not booked', days.insulation === undefined);
  ok("another job's permit never counts", days.rough === undefined);
}

// ── 3. The wiring's pure block ────────────────────────────────────────────
console.log('\n3. Citations, findings and sweep rows as cards; ids from the content');
const INDEX = 'app/(tabs)/construction-ai/index.tsx';
const ASK = 'components/construction/AskConstructionMode.tsx';
const index = read(INDEX);
const askSrc = read(ASK);
ok(`${INDEX} is readable`, index.length > 0);
ok(`${ASK} is readable`, askSrc.length > 0);
{
  const block = loadPure(askSrc, 'codeCardItems', [
    'codeCheckCardItem', 'codeCheckCards', 'codeCheckPlainLine', 'cardVerdictOf', 'planFindingCardItem', 'sweepCardItem', 'withContentIds', 'isCardPlaceholder',
    'cardWithChosenStage', 'codeCheckJobText',
    'ownWordsLine', 'ownWordsObserved', 'codeCheckOwnWords', 'planFindingOwnWords', 'sweepRowOwnWords', 'SWEEP_ROW_WITHHELD',
    'CARD_WITHHELD', 'CARD_NO_TEXT', 'CARD_TEXT_MAX',
  ]);
  ok('the wiring marks codeCardItems as a pure block', !!block);
  ok('the screen no longer keeps a second copy of the block', !index.includes('// <pure:codeCardItems>'));
  if (block) {
    /** The words he gave for the run, with CCKIT's own "did he write it?" test. */
    type JobText = { text: string; says: typeof saysNumberWithUnit };
    const said = (text: string): JobText => ({ text, says: saysNumberWithUnit });
    type CCN = (c: Record<string, unknown>, i: number, ev: unknown, parse: typeof parseCodeCardItem, echo: typeof passesEchoCheck, job?: JobText) => CodeCardItem | null;
    type CC = (c: Record<string, unknown>, i: number, ev: unknown, parse: typeof parseCodeCardItem, echo: typeof passesEchoCheck, job?: JobText) => CodeCardItem;
    type CCS = (rows: Record<string, unknown>[], ev: unknown[], parse: typeof parseCodeCardItem, echo: typeof passesEchoCheck, job?: JobText) => (CodeCardItem | null)[];
    type PF = (f: Record<string, unknown>, cite: { citedCode: string; section: string }, ev: unknown, parse: typeof parseCodeCardItem, echo: typeof passesEchoCheck) => CodeCardItem;
    type SW = (
      f: Record<string, unknown>, words: { question: string; requirement: string; observed: string }, cite: { citedCode: string; section: string },
      ev: unknown, sheet: { id: string; label: string }, index: number, lookRight: boolean, parse: typeof parseCodeCardItem, echo: typeof passesEchoCheck,
    ) => CodeCardItem;
    const ccRaw = block.codeCheckCardItem as CCN;
    // Rows below are Code Check rows the model gave a verdict for (the wire
    // always carries one); the no-verdict row has its own checks.
    const cc: CC = (c, i, e, parse, echo, jobText) => ccRaw({ verdict: 'required', ...c }, i, e, parse, echo, jobText) as CodeCardItem;
    const ccs = block.codeCheckCards as CCS;
    const plainLine = block.codeCheckPlainLine as (t: unknown, echo: typeof passesEchoCheck) => string;
    const verdictOf = block.cardVerdictOf as (v: unknown) => string | null;
    const pf = block.planFindingCardItem as PF;
    const sw = block.sweepCardItem as SW;
    const withIds = block.withContentIds as (prefix: string, items: CodeCardItem[]) => CodeCardItem[];
    const isPlaceholder = block.isCardPlaceholder as (s: string | null | undefined) => boolean;
    const WITHHELD = block.CARD_WITHHELD as string;
    const NO_TEXT = block.CARD_NO_TEXT as string;
    const ny = resolveCodeJurisdiction({ city: 'Massapequa', state: 'NY' });
    const ev = citationEvidenceFor(ny, '2025 RCNYS', 'R312.1');

    const a = cc({ code: '2025 RCNYS', section: 'R312.1', requirement: 'Sample: guards on open sides of a raised deck.' }, 0, ev, parseCodeCardItem, passesEchoCheck);
    ok('a citation is a card with our words, its section and its edition',
      a.id === 'cc-1' && a.summary === 'Sample: guards on open sides of a raised deck.' && a.section === 'R312.1' && a.citedEdition === '2025 RCNYS');
    ok("the ladder's evidence rides on the card", a.evidence === ev);
    ok('the stage is labelled a guess', a.stageIsGuess === true);
    // NEVER a default verdict.
    ok('a row with NO verdict is not a card (null), so nothing shows "Required" by default',
      ccRaw({ code: '2025 RCNYS', section: 'R312.1', requirement: 'Sample: guards on open sides of a raised deck.' }, 0, ev, parseCodeCardItem, passesEchoCheck) === null);
    ok('…nor is a row with an empty or unknown verdict',
      ccRaw({ code: 'IRC', section: 'R312.1', requirement: 'Sample.', verdict: '' }, 0, null, parseCodeCardItem, passesEchoCheck) === null
        && ccRaw({ code: 'IRC', section: 'R312.1', requirement: 'Sample.', verdict: 'maybe' }, 0, null, parseCodeCardItem, passesEchoCheck) === null
        && ccRaw({ code: 'IRC', section: 'R312.1', requirement: 'Sample.', verdict: 7 }, 0, null, parseCodeCardItem, passesEchoCheck) === null);
    ok('the three verdicts are read forgiving case and spacing, and nothing else is',
      verdictOf('required') === 'required' && verdictOf(' Limit ') === 'limit' && verdictOf('Not required') === 'not_required' && verdictOf('not-required') === 'not_required'
        && verdictOf('') === null && verdictOf('applies') === null && verdictOf(undefined) === null && verdictOf(null) === null);
    const mixed = ccs([
      { code: '2025 RCNYS', section: 'R312.1', requirement: 'Sample: guards on open sides of a raised deck.', verdict: 'required' },
      { code: '2025 RCNYS', section: '', requirement: 'Sample: an older row with no verdict.' },
      { code: '2025 RCNYS', section: 'R311.7.8', requirement: 'Sample: a handrail on the deck stair.', verdict: 'limit' },
    ], [ev, null, null], parseCodeCardItem, passesEchoCheck);
    ok('codeCheckCards stays index-aligned with the rows: card, null, card',
      mixed.length === 3 && !!mixed[0] && mixed[1] === null && !!mixed[2] && mixed[2]!.verdict === 'limit' && mixed[0]!.evidence === ev);
    ok('…and the cards carry content ids (cc-<hash>), never the row number', /^cc-[0-9a-z]+$/.test(mixed[0]!.id) && /^cc-[0-9a-z]+$/.test(mixed[2]!.id) && mixed[0]!.id !== mixed[2]!.id);
    ok('the plain line of a row that is not a card passes the same own-words gate',
      plainLine('Sample: an older row with no verdict.', passesEchoCheck) === 'Sample: an older row with no verdict.'
        && plainLine('Guards shall be provided where the walking surface is more than 30 inches above grade.', passesEchoCheck) === block.CARD_WITHHELD
        && plainLine('  ', passesEchoCheck) === block.CARD_NO_TEXT);

    const noSec = cc({ code: 'IRC', section: '', requirement: 'Sample: a handrail on the stair.' }, 1, null, parseCodeCardItem, passesEchoCheck);
    ok('a citation with no section keeps an EMPTY section (never a placeholder)', noSec.section === '' && noSec.id === 'cc-2');
    const shall = cc({ code: 'IRC', section: 'R312.1', requirement: 'Guards shall be provided where the walking surface is more than 30 inches above grade.' }, 2, null, parseCodeCardItem, passesEchoCheck);
    ok('a line with code phrasing ("shall") is WITHHELD, never shown', shall.summary === WITHHELD);
    const quoted = cc({ code: 'IRC', section: 'R312.1', requirement: 'The code says "guards are required".' }, 3, null, parseCodeCardItem, passesEchoCheck);
    ok('a quoted line is withheld', quoted.summary === WITHHELD);
    const long = cc({ code: 'IRC', section: 'R310.1', requirement: 'Every basement bedroom needs an egress window. The opening must be big enough to climb out of, low enough to reach, and open from inside without a key or tool. A well is needed when the sill is below grade.' }, 4, null, parseCodeCardItem, passesEchoCheck);
    ok('a long plain-English line (over 140, under 400) still shows in full, as this screen always did', long.summary.startsWith('Every basement bedroom'));
    const tooLong = cc({ code: 'IRC', section: 'R310.1', requirement: `${'Short plain words here. '.repeat(20)}` }, 4, null, parseCodeCardItem, passesEchoCheck);
    ok('a line over the 400 cap is withheld (a pasted section never fits in one)', tooLong.summary === WITHHELD && block.CARD_TEXT_MAX === 400);
    ok('the withheld line names Official text', WITHHELD.includes('Official text') && WITHHELD.includes('read like code text'));
    const empty = cc({ code: 'IRC', section: 'R312.1', requirement: '   ' }, 5, null, parseCodeCardItem, passesEchoCheck);
    ok('a citation with NO words says the AI gave none (never "it read like code text")', empty.summary === NO_TEXT && NO_TEXT !== WITHHELD && !NO_TEXT.includes('read like code text'));
    ok('both stand-in lines are known placeholders; a real line is not', isPlaceholder(WITHHELD) && isPlaceholder(NO_TEXT) && !isPlaceholder(a.summary) && !isPlaceholder(''));

    const rich = cc({
      code: '2025 RCNYS', section: 'R312.1', requirement: 'Sample: keep the walking surface at least 30 in. up.', verdict: 'limit', stage: 'final',
      triggerValue: 30, triggerUnit: 'in', triggerComparison: '>=',
      jobNumber: 34, jobNumberUnit: 'in', jobNumberLabel: 'deck height from the scenario',
      whatToBuild: ['A guard on every open side.', 'Guards shall be 36 in.'], why: 'Your deck is 34 in. up.', trade: 'framing',
      status: 'ok', observed: 'Drawn 4 in.', location: 'A-2', question: 'Is it drawn?', evidence: { rung: 'amended' }, stageIsGuess: false,
    }, 5, null, parseCodeCardItem, passesEchoCheck, said('Sample: a deck 34 in. above grade, 12 ft wide.'));
    ok("the model's verdict is kept when it is one of the three", rich.verdict === 'limit');
    ok('the flat trigger and job number become the structured pair',
      JSON.stringify(rich.trigger) === JSON.stringify({ value: 30, unit: 'in', comparison: '>=' })
        && JSON.stringify(rich.jobValue) === JSON.stringify({ value: 34, unit: 'in', source: 'job', sourceLabel: 'deck height from the scenario' }));
    ok('why and trade ride', rich.why === 'Your deck is 34 in. up.' && rich.trade === 'framing');
    ok('a what-to-build line with code phrasing is dropped, the rest kept', JSON.stringify(rich.whatToBuild) === JSON.stringify(['A guard on every open side.']));
    ok('the stage is kept and still a guess, whatever the model claimed', rich.stage === 'final' && rich.stageIsGuess === true);
    ok('plan-check fields and evidence never ride on a Code Check citation, whatever the model sent',
      rich.status === undefined && rich.observed === undefined && rich.location === undefined && rich.question === undefined && rich.evidence === null);
    const none = cc({ code: 'IRC', section: 'R312.1', requirement: 'Guards.', triggerValue: -1, triggerUnit: '', triggerComparison: '', jobNumber: -1, jobNumberUnit: '', jobNumberLabel: '', why: '', stage: '', trade: '', whatToBuild: [] }, 6, null, parseCodeCardItem, passesEchoCheck);
    ok('"the model did not say" (empty unit, empty words) makes NO trigger, job number, why, stage, trade or build list',
      none.trigger === undefined && none.jobValue === undefined && none.why === undefined && none.stage === undefined && none.trade === undefined && none.whatToBuild === undefined);
    const junk = cc({ code: 'IRC', section: 'R312.1', requirement: 'Guards.', triggerValue: 'thirty', triggerUnit: 'in', triggerComparison: '>' }, 6, null, parseCodeCardItem, passesEchoCheck);
    ok('an unstructured trigger is dropped (no tape from guessed numbers)', junk.trigger === undefined);
    ok('a caught number (-1) with a unit is dropped too, and so is an unknown unit or comparison',
      cc({ code: 'IRC', requirement: 'Guards.', triggerValue: -1, triggerUnit: 'in', triggerComparison: '>' }, 6, null, parseCodeCardItem, passesEchoCheck).trigger === undefined
        && cc({ code: 'IRC', requirement: 'Guards.', triggerValue: 30, triggerUnit: 'inches', triggerComparison: '>' }, 6, null, parseCodeCardItem, passesEchoCheck).trigger === undefined
        && cc({ code: 'IRC', requirement: 'Guards.', triggerValue: 30, triggerUnit: 'in', triggerComparison: 'over' }, 6, null, parseCodeCardItem, passesEchoCheck).trigger === undefined);
    ok('a job number with no label of where it came from is dropped',
      cc({ code: 'IRC', requirement: 'Guards.', triggerValue: 30, triggerUnit: 'in', triggerComparison: '>', jobNumber: 34, jobNumberUnit: 'in', jobNumberLabel: '' }, 6, null, parseCodeCardItem, passesEchoCheck, said('A deck 34 in. up.')).jobValue === undefined);
    {
      // THE JOB'S OWN NUMBER MUST BE ONE HE WROTE (the Ask server's rule, on
      // the phone): Code Check's prompt is built here, so nothing upstream
      // checks the model's "jobNumber".
      const row = {
        code: '2025 RCNYS', section: 'R312.1', requirement: 'Sample: guards on every open side.', verdict: 'required',
        triggerValue: 30, triggerUnit: 'in', triggerComparison: '>', jobNumber: 34, jobNumberUnit: 'in', jobNumberLabel: 'deck height from the scenario',
      };
      const job = (text?: string) => cc(row, 7, null, parseCodeCardItem, passesEchoCheck, text === undefined ? undefined : said(text)).jobValue;
      ok('a job number he wrote, next to its unit, is kept (scenario: "34 in. above grade")', job('Sample: a deck 34 in. above grade.')?.value === 34 && job('Sample: a deck 34 inches up.')?.value === 34);
      ok('…and one from an answer he gave counts too (the screen joins the scenario and his answers)', job('Sample: a new deck.\nAbout 34 in.')?.value === 34);
      ok('a job number he never wrote is dropped: no tape from the model\u2019s account of his job', job('Sample: a new deck off the kitchen.') === undefined);
      ok('…and so is the same figure next to another unit (34 ft is not 34 in.), or a bare 34', job('Sample: a deck 34 ft long.') === undefined && job('Sample: lot 34, a new deck.') === undefined);
      ok('with no words to check against, there is NO job number (never the model\u2019s on trust)', job() === undefined && job('') === undefined);
      ok('the trigger stays when the job number goes', JSON.stringify(cc(row, 7, null, parseCodeCardItem, passesEchoCheck).trigger) === JSON.stringify({ value: 30, unit: 'in', comparison: '>' }));
      ok('a job number that is not a number is dropped before the test runs',
        cc({ ...row, jobNumber: '34' }, 7, null, parseCodeCardItem, passesEchoCheck, said('A deck 34 in. up.')).jobValue === undefined);
      // The numbers must agree with the verdict (the kit's wire rule) here too.
      const flipped = cc({ ...row, requirement: 'Sample: raise the guard to at least 36 in.', triggerValue: 36, triggerComparison: '>=' }, 7, null, parseCodeCardItem, passesEchoCheck, said('Sample: the guard is 34 in. high.'));
      ok('Code Check: numbers that give the OTHER verdict draw no tape (job number dropped, verdict and trigger kept)',
        flipped.verdict === 'required' && flipped.jobValue === undefined && flipped.trigger?.value === 36);
      const asLimit = cc({ ...row, verdict: 'limit', requirement: 'Sample: raise the guard to at least 36 in.', triggerValue: 36, triggerComparison: '>=' }, 7, null, parseCodeCardItem, passesEchoCheck, said('Sample: the guard is 34 in. high.'));
      ok('…while the same numbers on a LIMIT whose line says the side ("at least 36 in.", sign >=) are kept: a job outside its limit is a real finding, and it reads "outside the limit"',
        asLimit.verdict === 'limit' && asLimit.jobValue?.value === 34 && recheckOutcome(asLimit, asLimit.jobValue!) === 'over_limit');
    }
    {
      // A LIMIT'S OWN LINE MUST SAY THE SIDE (integration round 2). A limit has
      // no verdict to check its numbers against, so a sign pointing the wrong
      // way printed "within the limit" for a 34 in. guard against a 36 in.
      // minimum, on the card and in the text to a sub. The critic's probes,
      // through the real codeCheckCards and the real parser.
      const probe = (scenario: string, row: Record<string, unknown>) =>
        ccs([{ code: '2025 RCNYS', why: '', stage: 'final', trade: '', whatToBuild: [], ...row }], [null], parseCodeCardItem, passesEchoCheck, said(scenario))[0] as CodeCardItem;
      const text = (c: CodeCardItem) => shareTextFor(c, { jobLabel: 'Sample job', sample: true });
      const guardRow = { section: 'R312.1.2', requirement: 'Guard has to be at least 36 in. high.', verdict: 'limit', triggerValue: 36, triggerUnit: 'in', jobNumber: 34, jobNumberUnit: 'in', jobNumberLabel: 'guard height from the scenario' };
      const riserRow = { section: 'R311.7.5.1', requirement: 'Risers can be at most 7.75 in. tall.', verdict: 'limit', triggerValue: 7.75, triggerUnit: 'in', jobNumber: 8, jobNumberUnit: 'in', jobNumberLabel: 'riser height from the scenario' };
      const guardScene = 'Sample: deck guard is 34 in. high on a deck 40 in. above grade.';
      const riserScene = 'Sample: stair risers are 8 in. tall.';
      const p1 = probe(guardScene, { ...guardRow, triggerComparison: '<' });
      ok('PROBE 1: "at least 36 in." with the sign the wrong way (<) and a 34 in. guard he typed: no job number, so no tape and no "within the limit" anywhere',
        p1.verdict === 'limit' && effectiveVerdict(p1) === 'limit' && p1.jobValue === undefined && p1.trigger === undefined
          && !/Job: |Result:|within the limit/.test(text(p1)) && text(p1).includes('Guard has to be at least 36 in. high.'), text(p1));
      const p2 = probe(riserScene, { ...riserRow, triggerComparison: '>' });
      ok('PROBE 2: "at most 7.75 in." with the sign the wrong way (>) and an 8 in. riser he typed: no job number, no "within the limit"',
        p2.verdict === 'limit' && p2.jobValue === undefined && p2.trigger === undefined && !/Job: |Result:|within the limit/.test(text(p2)), text(p2));
      const [p3] = parseCodeCardItems([{ id: 'req-1', verdict: 'limit', summary: 'Risers can be at most 7.75 in. tall.', section: 'R311.7.5.1', citedEdition: '2025 RCNYS',
        trigger: { value: 7.75, unit: 'in', comparison: '>' }, jobValue: { value: 8, unit: 'in', source: 'job', sourceLabel: 'riser height from your question' } }]);
      ok('PROBE 3: the same riser row as an Ask card off the wire: the phone drops the job number whatever the server sent',
        !!p3 && p3.verdict === 'limit' && p3.jobValue === undefined && p3.trigger === undefined && !/Job: |Result:|within the limit/.test(text(p3)), p3 ? text(p3) : 'no card');
      const g = probe(guardScene, { ...guardRow, triggerComparison: '>=' });
      const r = probe(riserScene, { ...riserRow, triggerComparison: '<=' });
      ok('with the sign its own words mean, the typed number is kept and reads the right way: 34 in. against "at least 36 in." and 8 in. against "at most 7.75 in." are both OUTSIDE the limit',
        g.jobValue?.value === 34 && recheckOutcome(g, g.jobValue!) === 'over_limit' && text(g).includes('Job: 34 in. (guard height from the scenario). Limit at or above 36 in. (AI recall, confirm). Result: outside the limit.')
          && r.jobValue?.value === 8 && recheckOutcome(r, r.jobValue!) === 'over_limit' && text(r).includes('Result: outside the limit.'), `${text(g)} | ${text(r)}`);
      const inside = probe('Sample: deck guard is 38 in. high.', { ...guardRow, jobNumber: 38, triggerComparison: '>=' });
      const edge = probe('Sample: deck guard is 36 in. high.', { ...guardRow, jobNumber: 36, triggerComparison: '>=' });
      ok('…a 38 in. guard, and a guard exactly 36 in., read "within the limit"; the strict sign (>) would put 36 in. outside its own line, so it draws no tape',
        recheckOutcome(inside, inside.jobValue!) === 'within_limit' && recheckOutcome(edge, edge.jobValue!) === 'within_limit'
          && probe('Sample: deck guard is 36 in. high.', { ...guardRow, jobNumber: 36, triggerComparison: '>' }).jobValue === undefined
          && probe(riserScene, { ...riserRow, triggerComparison: '<' }).jobValue === undefined);
      ok('a limit whose line has no side word, both kinds, the word at another figure, or words MAGE withheld: no job number, whatever the sign',
        (['>', '>=', '<', '<='] as const).every((c) =>
          probe(guardScene, { ...guardRow, triggerComparison: c, requirement: 'Keep the guard under 36 in. high.' }).jobValue === undefined
          && probe(guardScene, { ...guardRow, triggerComparison: c, requirement: 'Guard at least 36 in. and at most 42 in. high.' }).jobValue === undefined
          && probe(guardScene, { ...guardRow, triggerComparison: c, requirement: 'Guard at least 42 in. high on a deck 36 in. up.' }).jobValue === undefined
          && probe(guardScene, { ...guardRow, triggerComparison: c, requirement: 'Guards shall be at least 36 in. high.' }).jobValue === undefined
          && probe(guardScene, { ...guardRow, triggerComparison: c, requirement: '' }).jobValue === undefined));
      ok('the side is read from the line the card SHOWS, never the stand-in summary the parser is sent, and never a field off the wire',
        /const summary = cardSummary\(c\.requirement, echo\);/.test(askSrc) && /\}, id, summary\);\s+const base: CodeCardItem = parsed \?\?/.test(askSrc)
          && /const item: CodeCardItem = \{ \.\.\.base, id, verdict, summary, section, evidence \};/.test(askSrc)
          && probe(guardScene, { ...guardRow, triggerComparison: '<', shownLine: 'Guard at most 36 in.', summary: 'Guard at most 36 in.' }).jobValue === undefined
          && parseCodeCardItem({ id: 'x', verdict: 'limit', summary: 'Requirement', section: 'none', shownLine: 'Guard has to be at least 36 in. high.',
            trigger: { value: 36, unit: 'in', comparison: '>=' }, jobValue: { value: 34, unit: 'in', source: 'job', sourceLabel: 'x' } }, 'x')?.jobValue === undefined
          && parseCodeCardItem({ id: 'x', verdict: 'limit', summary: 'Requirement', section: 'none',
            trigger: { value: 36, unit: 'in', comparison: '>=' }, jobValue: { value: 34, unit: 'in', source: 'job', sourceLabel: 'x' } }, 'x', 'Guard has to be at least 36 in. high.')?.jobValue?.value === 34);
      const jobTextOf = block.codeCheckJobText as (scenario: string, answers: { answer: string }[]) => string;
      ok('the words a run’s job number is checked against are the scenario and every answer, as sent',
        jobTextOf('A deck.', [{ answer: 'About 34 in.' }, { answer: 'Yes' }]) === 'A deck.\nAbout 34 in.\nYes' && jobTextOf('A deck.', []) === 'A deck.');

      // ── THE RE-MEASURE BELONGS TO ONE CARD AS IT WAS SHOWN (integration
      // round 3). The card id is made from the words only, so two Code Check
      // runs give the same id to the same line. The critic's two cases, through
      // the real codeCheckCards, the real parser and the kit's remeasureFor.
      const deckRow = { section: 'R312.1.1', requirement: 'Sample: a guard is needed once the deck is more than 30 in. up.', triggerValue: 30, triggerUnit: 'in', triggerComparison: '>', jobNumberUnit: 'in', jobNumberLabel: 'deck height from the scenario' };
      const run1 = probe('Sample: a deck 34 in. above grade.', { ...deckRow, verdict: 'required', jobNumber: 34 });
      const run2 = probe('Sample: a deck 40 in. above grade.', { ...deckRow, verdict: 'required', jobNumber: 40 });
      const stepped = recordRemeasure(EMPTY_REMEASURES, run1, 'p1', stepJobValue(run1.jobValue!, -5));
      ok('CASE A, fixture: two runs give the same line the same card id, with their own numbers (34 in. and 40 in.); he steps run 1 down to 29 in., which reads NOT REQUIRED',
        run1.id === run2.id && run1.jobValue?.value === 34 && run2.jobValue?.value === 40 && remeasureFor(run1, 'p1', stepped)?.value === 29
          && effectiveVerdict(run1, remeasureFor(run1, 'p1', stepped)) === 'not_required');
      ok('CASE A: the later run’s card does NOT inherit that re-measure: it shows its own 40 in., stays REQUIRED, and the text to a sub and Save carry 40 in., never 29',
        remeasureFor(run2, 'p1', stepped) === undefined && effectiveVerdict(run2, remeasureFor(run2, 'p1', stepped)) === 'required'
          && shareTextFor(run2, { jobValue: remeasureFor(run2, 'p1', stepped) }).includes('Job: 40 in. (deck height from the scenario).')
          && !/29 in\.|not required/.test(shareTextFor(run2, { jobValue: remeasureFor(run2, 'p1', stepped) }))
          && makeSaved('p1', run2, '2026-10-04T10:00:00.000Z', remeasureFor(run2, 'p1', stepped) ?? null).jobValue === undefined);
      ok('…nor does the same card on another project, or with no project linked',
        remeasureFor(run1, 'p2', stepped) === undefined && remeasureFor(run1, null, stepped) === undefined);
      const good = probe(guardScene, { ...guardRow, triggerComparison: '>=' });
      const steppedLimit = recordRemeasure(EMPTY_REMEASURES, good, 'p1', stepJobValue(good.jobValue!, -1));
      const wrong = probe(guardScene, { ...guardRow, triggerComparison: '<' });
      const savedWrong = makeSaved('p1', wrong, '2026-10-04T10:00:00.000Z', remeasureFor(wrong, 'p1', steppedLimit) ?? null);
      ok('CASE B: a limit with the sign the wrong way, on a run AFTER he re-measured the same line: no trigger, no number, the old re-measure is not used, so no tape and no "within the limit" on the card, in the text or in the saved card',
        good.id === wrong.id && remeasureFor(good, 'p1', steppedLimit)?.value === 33 && wrong.trigger === undefined && wrong.jobValue === undefined
          && remeasureFor(wrong, 'p1', steppedLimit) === undefined && !canRecheck({ jobValue: remeasureFor(wrong, 'p1', steppedLimit), trigger: wrong.trigger })
          && !/Job: |Result:|within the limit|Limit below/.test(shareTextFor(wrong, { jobValue: remeasureFor(wrong, 'p1', steppedLimit) }))
          && savedWrong.jobValue === undefined && savedWrong.item.trigger === undefined
          && parseSavedState(JSON.stringify(savedReducer(EMPTY_SAVED, { type: 'save', card: savedWrong }))).p1?.[0]?.jobValue === undefined);
      ok('a trigger of ZERO (the relay tells the model "use 0 if unknown") or less is "did not say": no trigger, no tape',
        cc({ code: 'IRC', requirement: 'Guards.', triggerValue: 0, triggerUnit: 'in', triggerComparison: '>', jobNumber: 0, jobNumberUnit: 'in', jobNumberLabel: 'x' }, 6, null, parseCodeCardItem, passesEchoCheck, said('Sample: 0 in. of clearance.')).trigger === undefined
          && !canRecheck(cc({ code: 'IRC', requirement: 'Guards.', triggerValue: 0, triggerUnit: 'in', triggerComparison: '>', jobNumber: 0, jobNumberUnit: 'in', jobNumberLabel: 'x' }, 6, null, parseCodeCardItem, passesEchoCheck, said('Sample: 0 in. of clearance.')))
          && cc({ code: 'IRC', requirement: 'Guards.', triggerValue: -3, triggerUnit: 'in', triggerComparison: '>' }, 6, null, parseCodeCardItem, passesEchoCheck).trigger === undefined
          && cc({ code: 'IRC', requirement: 'Guards.', triggerValue: 0.5, triggerUnit: 'in', triggerComparison: '>' }, 6, null, parseCodeCardItem, passesEchoCheck).trigger?.value === 0.5);
    }
    {
      // ── THE WITHHOLD RULE COVERS EVERY PLACE THE LINE CAN APPEAR ──
      const SHALL = 'Guards shall be provided where the walking surface is more than 30 inches above grade.';
      const QUOTED = 'Drawn "4 in." apart';
      const ownLine = block.ownWordsLine as (t: unknown, echo: typeof passesEchoCheck) => string;
      const ownObserved = block.ownWordsObserved as (t: unknown, echo: typeof passesEchoCheck) => string;
      ok('ownWordsLine: own words pass as written, code-shaped or quoted words become the withheld notice (never trimmed), no words stay empty',
        ownLine('  Sample: guards on  open sides. ', passesEchoCheck) === 'Sample: guards on open sides.' && ownLine(SHALL, passesEchoCheck) === WITHHELD
          && ownLine('The code says "guards are required".', passesEchoCheck) === WITHHELD && ownLine(`${'Short plain words here. '.repeat(20)}`, passesEchoCheck) === WITHHELD
          && ownLine('', passesEchoCheck) === '' && ownLine(undefined, passesEchoCheck) === '' && ownLine(7, passesEchoCheck) === ''
          && ownLine(WITHHELD, passesEchoCheck) === WITHHELD);
      ok('ownWordsObserved: what the drawing shows passes as written; a quoted or code-shaped one is dropped (nothing shown)',
        ownObserved('Sample: drawn 4½ in. apart', passesEchoCheck) === 'Sample: drawn 4½ in. apart' && ownObserved(QUOTED, passesEchoCheck) === ''
          && ownObserved(SHALL, passesEchoCheck) === '' && ownObserved('', passesEchoCheck) === '' && ownObserved(null, passesEchoCheck) === '');
      const gateResult = block.codeCheckOwnWords as <R extends { applicableCodes: Record<string, unknown>[] }>(r: R, echo: typeof passesEchoCheck) => R;
      const raw = { summary: 'Sample summary.', permitsRequired: ['Sample permit'], applicableCodes: [
        { code: 'IRC', section: 'R312.1', requirement: SHALL, verdict: 'required', triggerValue: 30 },
        { code: 'IRC', section: 'R311.7.8', requirement: 'Sample: a handrail on the deck stair.', verdict: '' },
        { code: 'IRC', section: '', requirement: '' },
      ] };
      const gated = gateResult(raw, passesEchoCheck);
      ok('Code Check, AT THE DOOR: codeCheckOwnWords gates every row’s requirement once; nothing else in the result changes, and the input is not mutated',
        gated.applicableCodes[0].requirement === WITHHELD && gated.applicableCodes[1].requirement === 'Sample: a handrail on the deck stair.' && gated.applicableCodes[2].requirement === ''
          && gated.applicableCodes[0].section === 'R312.1' && gated.applicableCodes[0].triggerValue === 30 && gated.summary === raw.summary && gated.permitsRequired === raw.permitsRequired
          && raw.applicableCodes[0].requirement === SHALL && !JSON.stringify(gated).includes('shall be provided'));
      const gatedCards = ccs(gated.applicableCodes, [null, null, null], parseCodeCardItem, passesEchoCheck);
      ok('…so the card, the plain row, the saved check and every action built from the gated result carry the notice, never the line',
        gatedCards[0]?.summary === WITHHELD && isPlaceholder(gatedCards[0]?.summary) && plainLine(gated.applicableCodes[0].requirement, passesEchoCheck) === WITHHELD
          && plainLine(gated.applicableCodes[2].requirement, passesEchoCheck) === NO_TEXT);
      const planOwn = block.planFindingOwnWords as (f: Record<string, unknown>, echo: typeof passesEchoCheck) => { requirement: string; observed: string };
      ok('Plan Review: a finding’s two AI lines, as saved and as the list prints them: the requirement or the withheld notice, what the drawing shows or nothing',
        JSON.stringify(planOwn({ requirement: 'Sample: baluster spacing.', observed: 'Sample: drawn 4½ in. apart' }, passesEchoCheck)) === JSON.stringify({ requirement: 'Sample: baluster spacing.', observed: 'Sample: drawn 4½ in. apart' })
          && JSON.stringify(planOwn({ requirement: SHALL, observed: QUOTED }, passesEchoCheck)) === JSON.stringify({ requirement: WITHHELD, observed: '' })
          && JSON.stringify(planOwn({}, passesEchoCheck)) === JSON.stringify({ requirement: '', observed: '' }));
      const quotedFinding = pf({ id: 'fq', requirement: SHALL, observed: QUOTED, confidence: 'high', status: 'open', stage: 'final', stageIsGuess: false }, { citedCode: 'IRC', section: 'R312.1.3' }, null, parseCodeCardItem, passesEchoCheck);
      ok('…and its card agrees: the same line withheld, the quoted observed dropped, and the stage a GUESS whatever the finding claims',
        quotedFinding.summary === WITHHELD && quotedFinding.observed === undefined && quotedFinding.stage === 'final' && quotedFinding.stageIsGuess === true
          && pf({ id: 'fq2', requirement: 'Sample.', observed: 'Sample: drawn 4½ in. apart', confidence: 'high', stageIsGuess: false }, { citedCode: 'IRC', section: '' }, null, parseCodeCardItem, passesEchoCheck).stageIsGuess === true);
      const rowOwn = block.sweepRowOwnWords as <V extends { title: string; requirement: string; observed: string }>(v: V, echo: typeof passesEchoCheck) => V & { withheld: boolean };
      const BLOCKED = block.SWEEP_ROW_WITHHELD as string;
      const sheetP = { id: 'sh1', projectId: 'p1', name: 'Deck plan', sheetNumber: 'A-201' };
      const view = (f: Record<string, unknown>) => sweepFindingView(f as never, sheetP, ny);
      const clean = rowOwn(view({ question: 'Sample: what is the baluster spacing?', requirement: 'Sample: baluster spacing on the guard.', observed: 'Sample: drawn 4½ in. apart' }), passesEchoCheck);
      const reqHidden = rowOwn(view({ question: 'Sample: what is the guard height?', requirement: SHALL, observed: QUOTED }), passesEchoCheck);
      const allHidden = rowOwn(view({ question: '', requirement: SHALL, observed: 'Sample: drawn 34 in.' }), passesEchoCheck);
      ok('the sweep row: own words ride as written, and nothing else in the view changes (rung, where, severity)',
        clean.title === 'Sample: what is the baluster spacing?' && clean.requirement === 'Sample: baluster spacing on the guard.' && clean.observed === 'Sample: drawn 4½ in. apart' && clean.withheld === false
          && JSON.stringify({ ...clean, withheld: undefined }) === JSON.stringify({ ...view({ question: 'Sample: what is the baluster spacing?', requirement: 'Sample: baluster spacing on the guard.', observed: 'Sample: drawn 4½ in. apart' }), withheld: undefined }));
      ok('the sweep row: a code-shaped requirement is the withheld notice and a quoted observed is dropped, while its own question still stands (RFI and punch stay on offer)',
        reqHidden.requirement === WITHHELD && reqHidden.observed === '' && reqHidden.title === 'Sample: what is the guard height?' && reqHidden.withheld === false);
      ok('the sweep row: when the TITLE itself is the code-shaped line ("Confirm: <requirement>"), the row is withheld: the notice as its title, and a reason in place of Draft RFI and Add punch item',
        allHidden.withheld === true && allHidden.title === WITHHELD && allHidden.requirement === WITHHELD && !JSON.stringify(allHidden).includes('shall be provided')
          && BLOCKED.startsWith('No RFI draft or punch item for this row:') && BLOCKED.includes('read like code text'));
      const rfi = rfiFromSweepFinding(sheetP, reqHidden, new Date('2026-10-04T10:00:00.000Z'));
      const punch = punchFromSweepFinding(sheetP, reqHidden, 'punch-1', '2026-10-04T10:00:00.000Z');
      const rawRfi = rfiFromSweepFinding(sheetP, view({ question: 'Sample: what is the guard height?', requirement: SHALL, observed: QUOTED }), new Date('2026-10-04T10:00:00.000Z'));
      ok('…and an RFI draft or a punch item built from the GATED row carries no withheld words (fixture: the ungated view would have put the quoted line in the RFI)',
        !rfi.question.includes('"4 in."') && rfi.question.includes('Observed on the drawing: not described.') && !punch.description.includes('shall') && rawRfi.question.includes('4 in.')
          && rfi.question.includes('Sample: what is the guard height?'));
    }
    {
      // ── AN INCH MARK IS NOT A QUOTE: the gate must not hide an honest drawing line ──
      // Plan Review and the sweep read drawings, and drawings are dimensioned
      // 3'-0". The repo's own demo findings and one feet-and-inches line, on
      // the same functions the three screens call.
      const ownLine = block.ownWordsLine as (t: unknown, echo: typeof passesEchoCheck) => string;
      const planOwn = block.planFindingOwnWords as (f: Record<string, unknown>, echo: typeof passesEchoCheck) => { requirement: string; observed: string };
      const rowOwn = block.sweepRowOwnWords as <V extends { title: string; requirement: string; observed: string }>(v: V, echo: typeof passesEchoCheck) => V & { withheld: boolean };
      const gateResult = block.codeCheckOwnWords as <R extends { applicableCodes: Record<string, unknown>[] }>(r: R, echo: typeof passesEchoCheck) => R;
      const RISER = 'Riser ≤ 7-3/4", tread ≥ 10".';
      const DOOR = "Egress door drawn 2'-8\" wide; the path needs 3'-0\" clear.";
      const NOTE = 'The note on the sheet reads "PROVIDE 36" GUARD".';
      ok('Plan Review: a requirement and an observed line with inch marks are saved and printed as written (no notice, nothing dropped)',
        JSON.stringify(planOwn({ requirement: RISER, observed: 'Riser scales 8" on the section.' }, passesEchoCheck)) === JSON.stringify({ requirement: RISER, observed: 'Riser scales 8" on the section.' })
          && JSON.stringify(planOwn({ requirement: DOOR, observed: 'Drawn 4½" apart' }, passesEchoCheck)) === JSON.stringify({ requirement: DOOR, observed: 'Drawn 4½" apart' })
          && ownLine('Footing 12"x12" under each post.', passesEchoCheck) === 'Footing 12"x12" under each post.');
      ok('…and its card shows the same words (summary and observed), not the stand-in',
        pf({ id: 'fi', requirement: RISER, observed: 'Riser scales 8" on the section.', confidence: 'high', status: 'open' }, { citedCode: 'IRC', section: 'R311.7.5' }, null, parseCodeCardItem, passesEchoCheck).summary === RISER
          && pf({ id: 'fi', requirement: RISER, observed: 'Riser scales 8" on the section.', confidence: 'high', status: 'open' }, { citedCode: 'IRC', section: 'R311.7.5' }, null, parseCodeCardItem, passesEchoCheck).observed === 'Riser scales 8" on the section.');
      ok('…while a line that QUOTES (a drawing note in quotation marks, a section in quotes) is still withheld, and a quoted observed still dropped',
        planOwn({ requirement: 'R312.1 "Guards on open sides', observed: NOTE }, passesEchoCheck).requirement === WITHHELD && planOwn({ requirement: 'x', observed: NOTE }, passesEchoCheck).observed === ''
          && ownLine('"Guards at least 36" high."', passesEchoCheck) === WITHHELD && ownLine('Guards shall be 36" high.', passesEchoCheck) === WITHHELD);
      const sheetI = { id: 'sh1', projectId: 'p1', name: 'Deck plan', sheetNumber: 'A-201' };
      const inchRow = rowOwn(sweepFindingView({ question: 'The guard at the deck scales 34" high. Is it meant to be 36"?', requirement: 'Guard at least 36" high.', observed: 'Scales 34" on the elevation.' } as never, sheetI, ny), passesEchoCheck);
      ok('the sweep row: a question with inch marks keeps its words, so Draft RFI and Add punch item stay on offer',
        inchRow.withheld === false && inchRow.title === 'The guard at the deck scales 34" high. Is it meant to be 36"?' && inchRow.requirement === 'Guard at least 36" high.' && inchRow.observed === 'Scales 34" on the elevation.');
      ok('Code Check, at the door: a requirement with an inch mark is kept as written',
        gateResult({ applicableCodes: [{ code: 'IRC', section: 'R312.1.2', requirement: 'Guard has to be at least 36" high.' }] }, passesEchoCheck).applicableCodes[0].requirement === 'Guard has to be at least 36" high.');
      ok('the wiring’s two stand-in lines ARE the kit’s (the kit blocks a stand-in from a text, an email and a saved check by these exact words)',
        block.CARD_WITHHELD === LINE_WITHHELD && block.CARD_NO_TEXT === LINE_NO_TEXT && isStandInLine(block.CARD_WITHHELD as string) && isStandInLine(block.CARD_NO_TEXT as string)
          && isPlaceholder(LINE_WITHHELD) && isPlaceholder(LINE_NO_TEXT));
      // A stand-in card is not texted to a sub and is never the "To fix" line of the architect email.
      const hiddenFix = pf({ id: 'fh', requirement: 'Guards shall be provided where the walking surface is more than 30 inches above grade.', observed: 'Sample: drawn 34 in.', confidence: 'high', status: 'open' }, { citedCode: 'IRC', section: 'R312.1.1' }, null, parseCodeCardItem, passesEchoCheck);
      const mail = architectMessageFor([hiddenFix], { jobLabel: 'Sample job', sheetLabel: 'A-2' });
      ok('a card whose line is withheld cannot be texted to a sub (blocked, with the reason), and the architect email lists it by its section and place only',
        hiddenFix.summary === WITHHELD && shareBlockedReason(hiddenFix) === NO_WORDS_SEND && !mail.body.includes('MAGE hid') && !mail.body.includes('shall be provided')
          && mail.body.includes('- See R312.1.1, section from AI recall, confirm (Sample: drawn 34 in.).') && mail.fixes === 1 && mail.leftOut === 0
          && architectMessageFor([{ ...hiddenFix, section: '' }], {}).leftOut === 1 && !architectMessageFor([{ ...hiddenFix, section: '' }], {}).body.includes('MAGE hid'));
    }
    ok('a NESTED trigger / jobValue object off the wire is ignored (the wire is flat)',
      cc({ code: 'IRC', requirement: 'Guards.', trigger: { value: 30, unit: 'in', comparison: '>' }, jobValue: { value: 34, unit: 'in', source: 'measured', sourceLabel: 'x' } }, 6, null, parseCodeCardItem, passesEchoCheck).trigger === undefined
        && cc({ code: 'IRC', requirement: 'Guards.', jobValue: { value: 34, unit: 'in', source: 'measured', sourceLabel: 'x' } }, 6, null, parseCodeCardItem, passesEchoCheck).jobValue === undefined);

    const f1 = pf({ id: 'f1', requirement: 'Sample: baluster spacing.', observed: 'Sample: drawn 4½ in. apart', confidence: 'high', status: 'open' }, { citedCode: 'RCNYS 2025', section: 'R312.1.3' }, ev, parseCodeCardItem, passesEchoCheck);
    ok("a confident finding is 'fix'", f1.status === 'fix' && f1.section === 'R312.1.3' && f1.citedEdition === 'RCNYS 2025');
    ok('what the drawing shows rides as observed', f1.observed === 'Sample: drawn 4½ in. apart');
    const f2 = pf({ id: 'f2', requirement: 'Sample: stair handrail.', confidence: 'low', status: 'open' }, { citedCode: '', section: '' }, null, parseCodeCardItem, passesEchoCheck);
    ok("a low-confidence finding is 'ask' (needs an answer first)", f2.status === 'ask' && f2.citedEdition === undefined && f2.section === '');
    const f3 = pf({ id: 'f3', requirement: 'Sample.', confidence: 'high', status: 'resolved' }, { citedCode: 'IRC', section: '' }, null, parseCodeCardItem, passesEchoCheck);
    ok("a finding he marked resolved is NOT turned into 'ok' (the AI's read is never an approval)", f3.status === 'fix');
    const f4 = pf({ id: 'f4', requirement: 'Sample.', confidence: 'high', cardStatus: 'ok', status: 'ok' }, { citedCode: 'IRC', section: '' }, null, parseCodeCardItem, passesEchoCheck);
    ok("nothing on Plan Review is ever 'ok', whatever a field on the finding says", f4.status === 'fix');
    ok('no surface reads a field nothing writes (cardStatus is gone)', !/cardStatus/.test(askSrc) && !/cardStatus/.test(index));

    // Plan Set Code Sweep rows.
    const sheet = { id: 'sw2', label: 'A-201' };
    const cite = { citedCode: 'RCNYS 2025', section: 'R312.1.3' };
    const words = { question: 'Sample: what is the baluster spacing?', requirement: 'Sample: baluster spacing on the guard.', observed: 'Sample: drawn 4½ in. apart' };
    const s1 = sw({ severity: 'high', confidence: 'med', location: { x: 0.2, y: 0.3 } }, words, cite, ev, sheet, 0, false, parseCodeCardItem, passesEchoCheck);
    ok("a sweep finding with no server status is 'ask' (a question for the architect)", s1.status === 'ask');
    ok('it carries our requirement line, what the drawing shows, the sheet and the question',
      s1.summary === words.requirement && s1.observed === words.observed && s1.location === 'A-201' && s1.question === words.question, JSON.stringify(s1));
    ok('…with the section, the edition and the evidence of ITS citation', s1.section === 'R312.1.3' && s1.citedEdition === 'RCNYS 2025' && s1.evidence === ev);
    const s2 = sw({ status: 'fix', stage: 'final' }, words, cite, null, sheet, 1, false, parseCodeCardItem, passesEchoCheck);
    ok("the server's 'fix' is kept, with its stage as a guess", s2.status === 'fix' && s2.stage === 'final' && s2.stageIsGuess === true);
    const s3 = sw({ status: 'ok' }, words, cite, null, sheet, 2, false, parseCodeCardItem, passesEchoCheck);
    ok("a FINDINGS row can never be 'ok', whatever its status says", s3.status === 'ask');
    const s4 = sw({ status: 'fix', question: 'x' }, words, cite, null, sheet, 0, true, parseCodeCardItem, passesEchoCheck);
    ok("only a look-right row is 'ok', whatever its status says", s4.status === 'ok');
    ok('a look-right row NEVER carries a question (it must not become an architect question)', s4.question === undefined);
    ok('a look-right row and a finding at the same index get different ids', s4.id !== sw({}, words, cite, null, sheet, 0, false, parseCodeCardItem, passesEchoCheck).id);
    const s5 = sw({}, { question: 'Sample: is the handrail height shown?', requirement: '', observed: '' }, { citedCode: '', section: '' }, null, sheet, 3, false, parseCodeCardItem, passesEchoCheck);
    ok('a row with no requirement line shows its question as the card line', s5.summary === 'Sample: is the handrail height shown?' && s5.question === s5.summary && s5.observed === undefined);
    const s6 = sw({}, { question: '', requirement: '', observed: '' }, cite, null, sheet, 4, false, parseCodeCardItem, passesEchoCheck);
    ok('a row with no words at all says so', s6.summary === NO_TEXT && s6.question === undefined);
    const s7 = sw({}, { question: 'Is the "guard" shown?', requirement: 'Guards shall be provided.', observed: 'Drawn "4 in."' }, cite, null, sheet, 5, false, parseCodeCardItem, passesEchoCheck);
    ok('sweep words pass the same echo gate: code phrasing withheld, quoted question and observed dropped',
      s7.summary === WITHHELD && s7.question === undefined && s7.observed === undefined);
    const s8 = sw({ location: 'somewhere', observed: 'model text', question: 'model text', evidence: { rung: 'amended' } }, { question: '', requirement: 'Sample.', observed: '' }, cite, null, sheet, 6, false, parseCodeCardItem, passesEchoCheck);
    ok("the row's RAW model fields never reach the card (only the neutralised words do)",
      s8.location === 'A-201' && s8.observed === undefined && s8.question === undefined && s8.evidence === null);

    // Ids from the content.
    const one = withIds('ask', [{ ...a, id: 'req-1' }, { ...noSec, id: 'req-2' }]);
    const other = withIds('ask', [{ ...noSec, id: 'req-1' }, { ...a, id: 'req-2' }]);
    ok('ids come from the content, with the prefix', one.every((c) => /^ask-[0-9a-z]+$/.test(c.id)), one.map((c) => c.id).join(','));
    ok("another answer's FIRST card does not inherit this answer's first card's id (a pin never lands on the wrong card)",
      one[0].id !== other[0].id && one[0].id === other[1].id && one[1].id === other[0].id);
    ok('the same requirement asked again keeps its id (its pin and its save still show)',
      withIds('ask', [{ ...a, id: 'req-9' }])[0].id === one[0].id);
    const dup = withIds('cc', [a, { ...a }, { ...a }]);
    ok('identical cards in one list still get distinct ids', new Set(dup.map((c) => c.id)).size === 3 && dup[1].id === `${dup[0].id}-2` && dup[2].id === `${dup[0].id}-3`);
    ok('a different section, edition, line, observation or sheet is a different card',
      new Set([
        withIds('x', [a])[0].id,
        withIds('x', [{ ...a, section: 'R312.2' }])[0].id,
        withIds('x', [{ ...a, citedEdition: '2020 RCNYS' }])[0].id,
        withIds('x', [{ ...a, summary: 'Sample: other words.' }])[0].id,
        withIds('x', [{ ...a, observed: 'Sample: drawn 5 in.' }])[0].id,
        withIds('x', [{ ...a, location: 'A-3' }])[0].id,
      ]).size === 6);
    ok('nothing but the id changes', JSON.stringify({ ...one[0], id: '' }) === JSON.stringify({ ...a, id: '' }));

    // Plan Review: a re-review reuses the review id and numbers from 0 again.
    const before = withIds('plan', [pf({ id: 'plan-review-sheet1-0', requirement: 'Sample: baluster spacing.', observed: 'Sample: drawn 4½ in. apart', confidence: 'high' }, { citedCode: 'RCNYS 2025', section: 'R312.1.3' }, null, parseCodeCardItem, passesEchoCheck)]);
    const after = withIds('plan', [pf({ id: 'plan-review-sheet1-0', requirement: 'Sample: stair handrail.', observed: 'Sample: no handrail drawn', confidence: 'high' }, { citedCode: 'RCNYS 2025', section: 'R311.7.8' }, null, parseCodeCardItem, passesEchoCheck)]);
    const pinnedBefore = pinsReducer(EMPTY_PINS, { type: 'pin', pin: makePin('p1', before[0], '2026-10-01T10:00:00.000Z') });
    ok('Plan Review: the SAME finding id with different content is a different card', before[0].id !== after[0].id && /^plan-[0-9a-z]+$/.test(before[0].id));
    ok('…so a pin on the old finding never shows on the new one at that index',
      pinnedStage(pinnedBefore, 'p1', before[0].id) !== null && pinnedStage(pinnedBefore, 'p1', after[0].id) === null);
    ok('…and the same finding found again keeps its pin',
      pinnedStage(pinnedBefore, 'p1', withIds('plan', [pf({ id: 'plan-review-sheet1-3', requirement: 'Sample: baluster spacing.', observed: 'Sample: drawn 4½ in. apart', confidence: 'high' }, { citedCode: 'RCNYS 2025', section: 'R312.1.3' }, null, parseCodeCardItem, passesEchoCheck)])[0].id) !== null);

    // ── 3c. What a surface offers to pin or save comes back after a restart ──
    console.log('\n3c. Every builder\u2019s card survives the device stores (pin, save, restart)');
    ok('the longest line a card shows fits the stores (CARD_TEXT_MAX <= STORED_TEXT_MAX)', (block.CARD_TEXT_MAX as number) <= STORED_TEXT_MAX);
    const long213 = cc({ code: 'IRC', section: 'R310.1', requirement: 'Every basement bedroom needs an egress window. The opening must be big enough to climb out of, low enough to reach, and open from inside without a key or tool. A well is needed when the sill is below grade.' }, 4, ev, parseCodeCardItem, passesEchoCheck);
    const offered: [string, CodeCardItem][] = [
      ['Code Check, with a section', a],
      ['Code Check, EMPTY section', noSec],
      ['Code Check, a 213-character line', long213],
      ['Code Check, every structured field', rich],
      ['Plan Review finding', f1],
      ['Plan Review finding, no section, no edition', f2],
      ['sweep finding (question, observed, sheet)', s1],
      ['sweep fix with a stage', s2],
      ['sweep look-right row', s4],
      ['sweep row whose line is its question', s5],
    ];
    for (const [name, raw] of offered) {
      const card = withIds('rt', [raw])[0];
      ok(`${name}: the store accepts it (no blocked reason)`, codeCardStoreBlockedReason(card) === null, JSON.stringify(card));
      const pins1 = pinsReducer(EMPTY_PINS, { type: 'pin', pin: makePin('p1', card, '2026-10-01T10:00:00.000Z', 'final') });
      const pins2 = parsePinsState(JSON.stringify(pins1));
      ok(`${name}: pinned, and still pinned after a restart, unchanged`,
        pinnedStage(pins1, 'p1', card.id) === 'final' && pinnedStage(pins2, 'p1', card.id) === 'final' && JSON.stringify(pins2) === JSON.stringify(pins1));
      const kept = pins2.p1?.[0]?.item;
      ok(`${name}: the pin holds the card's own words, section and edition`,
        !!kept && kept.summary === card.summary && kept.section === card.section && kept.citedEdition === card.citedEdition && kept.observed === card.observed && kept.location === card.location);
      const saved1 = savedReducer(EMPTY_SAVED, { type: 'save', card: makeSaved('p1', card, '2026-10-01T10:00:00.000Z') });
      const saved2 = parseSavedState(JSON.stringify(saved1));
      ok(`${name}: saved, and still saved after a restart, unchanged`,
        isSaved(saved1, 'p1', card.id) && isSaved(saved2, 'p1', card.id) && JSON.stringify(saved2) === JSON.stringify(saved1));
    }
    {
      // A stage HE set is not a guess once saved (makePin does the same for a pin).
      const chosen = block.cardWithChosenStage as (item: CodeCardItem, stage: CodeCardItem['stage']) => CodeCardItem;
      const card = withIds('rt', [a])[0];
      const moved = chosen(card, 'framing');
      ok('fixture: the card\u2019s stage is the AI\u2019s guess, and not framing', card.stageIsGuess === true && card.stage !== 'framing');
      ok('a stage he chose is saved as his, not as the AI\u2019s guess', moved.stage === 'framing' && moved.stageIsGuess === false);
      ok('the AI\u2019s own stage, or none, leaves the card untouched (still a guess)', chosen(card, card.stage) === card && chosen(card, undefined) === card);
      const kept = parseSavedState(JSON.stringify(savedReducer(EMPTY_SAVED, { type: 'save', card: makeSaved('p1', moved, '2026-10-01T10:00:00.000Z') }))).p1?.[0]?.item;
      ok('…and it reopens from Saved after a restart on his stage, with no "AI guess"', !!kept && kept.stage === 'framing' && kept.stageIsGuess === false, JSON.stringify(kept));
      const guess = parseSavedState(JSON.stringify(savedReducer(EMPTY_SAVED, { type: 'save', card: makeSaved('p1', chosen(card, card.stage), '2026-10-01T10:00:00.000Z') }))).p1?.[0]?.item;
      ok('…while a card saved on the AI\u2019s stage reopens as a guess', !!guess && guess.stageIsGuess === true);
    }
    ok('the long line really is over the wire cap (140) — the case the wire parser would drop', long213.summary.length > 140 && long213.summary.length <= 400, String(long213.summary.length));
    const refused = { ...a, id: 'rt-bad', summary: 'Guards shall be provided.' };
    ok('a card the store refuses has a blocked reason, and the reducers leave the state alone (no pin that vanishes later)',
      codeCardStoreBlockedReason(refused) !== null
        && pinsReducer(EMPTY_PINS, { type: 'pin', pin: makePin('p1', refused, '2026-10-01T10:00:00.000Z') }) === EMPTY_PINS
        && savedReducer(EMPTY_SAVED, { type: 'save', card: makeSaved('p1', refused, '2026-10-01T10:00:00.000Z') }) === EMPTY_SAVED);

    // ── 3b. The Code Check wire, on the real source ─────────────────────────
    console.log('\n3b. Code Check: the structured fields survive the real schema, hint and relay rule');
    const schemaSrc = between(index, 'const codeCheckSchema = z.object({', '\ntype CodeCheckResult');
    ok('codeCheckSchema is found in the tab', schemaSrc.startsWith('const codeCheckSchema = z.object({') && schemaSrc.trimEnd().endsWith('});'));
    const mageSrc = read('utils/mageAI.ts');
    const deriveSrc = between(mageSrc, 'function deriveHintFromZod(', '\n/** Peel optional');
    ok('deriveHintFromZod is found in utils/mageAI.ts', deriveSrc.startsWith('function deriveHintFromZod(') && deriveSrc.trimEnd().endsWith('}'));
    type RealSchema = { safeParse: (v: unknown) => { success: boolean; data?: unknown } };
    const schema = evalSource<RealSchema>(schemaSrc, 'codeCheckSchema', { z, followUpsZod });
    const derive = evalSource<(s: unknown) => unknown>(deriveSrc, 'deriveHintFromZod', {});
    ok('the real schema and the real hint derivation evaluate under bun', !!schema && !!derive);
    if (schema && derive) {
      const hint = derive(schema) as { applicableCodes?: Record<string, unknown>[] };
      const row = hint.applicableCodes?.[0] ?? {};
      const WORDS = ['code', 'section', 'requirement', 'verdict', 'why', 'stage', 'trade', 'triggerUnit', 'triggerComparison', 'jobNumberUnit', 'jobNumberLabel'];
      const NUMBERS = ['triggerValue', 'jobNumber'];
      ok('the derived hint has ONE example row carrying every card field',
        Array.isArray(hint.applicableCodes) && hint.applicableCodes.length === 1
          && JSON.stringify(Object.keys(row).sort()) === JSON.stringify([...WORDS, ...NUMBERS, 'whatToBuild'].sort()), JSON.stringify(row));
      ok('every word field hints a string, every number a number (never null: a null hints nothing)',
        WORDS.every((k) => row[k] === '') && NUMBERS.every((k) => row[k] === -1), JSON.stringify(row));
      ok('whatToBuild hints an array (of strings to the relay)', Array.isArray(row.whatToBuild), JSON.stringify(row.whatToBuild));
      const inferred = inferSchema(hint) as { properties?: Record<string, { type: string; items?: { type: string; properties?: Record<string, { type: string; items?: { type: string } }>; required?: string[] } }> };
      const item = inferred.properties?.applicableCodes?.items;
      ok("the relay's schema: applicableCodes is an array of objects", inferred.properties?.applicableCodes?.type === 'array' && item?.type === 'object');
      ok("the relay's schema types every card field: words are strings, the two numbers are numbers, whatToBuild is an array of strings",
        WORDS.every((k) => item?.properties?.[k]?.type === 'string') && NUMBERS.every((k) => item?.properties?.[k]?.type === 'number')
          && item?.properties?.whatToBuild?.type === 'array' && item?.properties?.whatToBuild?.items?.type === 'string', JSON.stringify(item?.properties));
      ok('…and requires every one (so "the model did not say" must have a value: an empty word or unit)',
        [...WORDS, ...NUMBERS, 'whatToBuild'].every((k) => (item?.required ?? []).includes(k)), JSON.stringify(item?.required));
      ok('no nested object in a row (the hint derivation stops six levels down; a nested number would hint as a string)',
        Object.values(item?.properties ?? {}).every((p) => p.type !== 'object'));

      const full = {
        summary: 'Sample summary.',
        applicableCodes: [{
          code: '2025 RCNYS', section: 'R312.1', requirement: 'Sample: guards on every open side of the deck.', verdict: 'not_required',
          why: 'Sample: the deck is 24 in. above grade.', stage: 'final', trade: 'framing', whatToBuild: ['Sample: nothing to add at this height.'],
          triggerValue: 30, triggerUnit: 'in', triggerComparison: '>', jobNumber: 24, jobNumberUnit: 'in', jobNumberLabel: 'deck height from the scenario',
        }],
        permitsRequired: [], inspections: [], commonViolations: [], followUps: [],
      };
      const parsed = schema.safeParse(full);
      const out = (parsed.data as { applicableCodes: Record<string, unknown>[] } | undefined)?.applicableCodes?.[0];
      ok('a full model row parses, and EVERY structured field survives the schema',
        parsed.success && !!out && JSON.stringify(out) === JSON.stringify(full.applicableCodes[0]), JSON.stringify(out));
      const built = out ? ccs([out], [ev], parseCodeCardItem, passesEchoCheck, said('Sample: a deck 24 in. above grade.'))[0] : null;
      ok('…and reaches the card: the verdict the model gave, why, stage, trade, what to build, trigger and job number',
        !!built && built.verdict === 'not_required' && built.why === 'Sample: the deck is 24 in. above grade.' && built.stage === 'final' && built.trade === 'framing'
          && JSON.stringify(built.whatToBuild) === JSON.stringify(['Sample: nothing to add at this height.'])
          && JSON.stringify(built.trigger) === JSON.stringify({ value: 30, unit: 'in', comparison: '>' })
          && built.jobValue?.value === 24 && built.jobValue?.source === 'job', JSON.stringify(built));
      ok('…and the job number only because he wrote it: the same row with other words has none',
        !!out && ccs([out], [ev], parseCodeCardItem, passesEchoCheck, said('Sample: a low deck.'))[0]?.jobValue === undefined
          && ccs([out], [ev], parseCodeCardItem, passesEchoCheck)[0]?.jobValue === undefined);
      const old3 = schema.safeParse({ summary: 'Sample.', applicableCodes: [{ code: 'IRC', section: 'R312.1', requirement: 'Sample: an answer cached before the code cards.' }] });
      const oldRow = (old3.data as { applicableCodes: Record<string, unknown>[] } | undefined)?.applicableCodes?.[0];
      ok('an old three-field row still parses, with "did not say" in every card field',
        old3.success && !!oldRow && oldRow.verdict === '' && oldRow.triggerUnit === '' && oldRow.triggerValue === -1 && oldRow.jobNumberUnit === '' && JSON.stringify(oldRow.whatToBuild) === '[]');
      ok('…and is NOT a card (the plain citation line shows instead)', !!oldRow && ccs([oldRow], [null], parseCodeCardItem, passesEchoCheck)[0] === null);
      const bad = schema.safeParse({ applicableCodes: [{ code: 'IRC', requirement: 'Sample.', verdict: 'required', triggerValue: 'thirty', triggerUnit: 'in', triggerComparison: '>', why: 7, stage: null }] });
      const badRow = (bad.data as { applicableCodes: Record<string, unknown>[] } | undefined)?.applicableCodes?.[0];
      ok('a wrong-typed field never fails the row: it becomes "did not say"', bad.success && !!badRow && badRow.triggerValue === -1 && badRow.why === '' && badRow.stage === '');
      ok('…and a caught number never becomes a trigger', !!badRow && ccs([badRow], [null], parseCodeCardItem, passesEchoCheck)[0]?.trigger === undefined);
    }
  }
}

// ── 4. Source pins ────────────────────────────────────────────────────────
console.log('\n4. The wiring, in the source');
const NO_VERBATIM = 'Write every requirement in your own words. Never quote or reproduce the text of any model code (ICC, NFPA) word for word.';
{
  ok('both in-app prompts (Code Check + drill-in) carry the no-verbatim sentence', index.split(NO_VERBATIM).length - 1 === 2, `found ${index.split(NO_VERBATIM).length - 1}`);
  const main = between(index, 'A contractor is working on the following project and needs a building-code sanity check.', "const cacheKey = `code_check::");
  ok('the Code Check prompt asks for the verdict (each of the three explained), the why, the stage, the trade and what to build',
    /verdict \("required" when it must be built or done on this job, "limit" when it is a maximum or minimum to stay inside, "not_required" when the job falls outside it\)/.test(main)
      && /why \(one short line, at most 160 characters/.test(main) && /stage \(your best guess of the inspection/.test(main)
      && /trade \(the trade that builds it/.test(main) && /whatToBuild \(array of up to 4 short lines in your own words, each at most 100 characters/.test(main));
  ok('…and for the FLAT trigger and job number, each with its "not certain" value (an empty unit)',
    main.includes('triggerValue, triggerUnit and triggerComparison (') && main.includes('ONLY when you are certain of the number; otherwise triggerUnit "" and triggerValue -1)')
      && main.includes('jobNumber, jobNumberUnit and jobNumberLabel (') && main.includes('ONLY when the number is stated above; otherwise jobNumberUnit "" and jobNumber -1)'));
  ok('every field the prompt asks a row for is a key of the schema (a field the schema lacks cannot come back)',
    ['verdict', 'why', 'stage', 'trade', 'whatToBuild', 'triggerValue', 'triggerUnit', 'triggerComparison', 'jobNumber', 'jobNumberUnit', 'jobNumberLabel']
      .every((k) => new RegExp(`\\b${k}\\b`).test(main) && new RegExp(`\\n    ${k}: z\\.`).test(between(index, 'const codeCheckSchema = z.object({', '\ntype CodeCheckResult'))));
  ok('the Code Check prompt caps the requirement at 140 characters, and asks for a limit’s line to say the side right before the number',
    main.includes('requirement (plain English, one sentence, at most 140 characters; for a "limit", say it with "at least" or "at most" right before the number, e.g. "Guard has to be at least 36 in. high.")'));
  ok('the Code Check prompt says which way a comparison points, and that a minimum or a maximum is a "limit" whose sign is the side the job has to stay on (the Ask prompt’s sentence)',
    main.includes('how the job\'s number stands against it when the requirement applies (">", ">=", "<" or "<="): a guard needed once a deck is more than 30 in. up is ">" with 30.')
      && main.includes('A minimum or a maximum the work has to stay within is always verdict "limit", never "required", and its comparison is the side the job has to stay on: a guard at least 36 in. high is ">=" with 36, a gap at most 4 in. wide is "<=" with 4'));
  ok('the Code Check prompt asks for plain sentences with no quotation marks and inches as in. (the gate withholds a quoted line), straight after the no-verbatim sentence, as its last line',
    main.includes(`\n${NO_VERBATIM}\nWrite each requirement as one short plain sentence of under 25 words, with no quotation marks. Write inches as in. and feet as ft (36 in., 6 ft 8 in.), never with the " or ' marks.\`;\n`));
  ok('Inspection Ready’s recall prompt carries the no-verbatim sentence too, as one of its RULES',
    read('utils/inspectionPrep.ts').includes(`'- ${NO_VERBATIM}',\n  ];\n  const prompt = lines.join('\\n');`));
  ok('an answer cached before the limit rule is not replayed (the cache key moved to cards2)',
    /::\$\{answersCacheFragment\(answered\)\}::cards2`;/.test(index) && !index.includes('::cards1'));
  const drill = between(index, 'A contractor ran a code check and wants to understand ONE specific code citation in depth.', 'const cacheKey = `code_detail::');
  ok('the drill-in prompt carries the sentence too', drill.includes(NO_VERBATIM));
  const detailSchema = between(index, 'const codeDetailSchema = z.object({', '\ntype CodeDetail');
  ok('the drill-in asks for NOTHING its schema cannot carry (prose fields only; no card fields)',
    drill.includes(`\n${NO_VERBATIM}\`;\n`) && !/verdict|whatToBuild|\btrigger\b|triggerValue|jobNumber|structured fields/.test(drill)
      && ['plainEnglish', 'appliesBecause', 'inspectorChecks', 'commonFailures', 'ruleOfThumb'].every((k) => drill.includes(`- ${k}:`) && detailSchema.includes(`${k}: z.`)),
    drill.slice(-200));

  const viewer = between(index, 'function ViewerLinks(', 'function RungBadge(');
  ok("the ICC line sits inside ViewerLinks, after the buttons", viewer.indexOf('<Text style={styles.viewerLinkNote}>{ICC_VIEWER_NOTE}</Text>') > viewer.indexOf('{links.map('));
  ok('the ICC line is the founder-approved wording', index.includes(`const ICC_VIEWER_NOTE = "Opens ICC's free public viewer. MAGE ID is not affiliated with or endorsed by ICC.";`));
  ok('ViewerLinks still renders nothing with no links (the line never stands alone)', /if \(links\.length === 0\) return null;/.test(viewer));

  ok('recall chip: neutral grey fill and ink', /recallChip: \{[^}]*backgroundColor: themeColors\.neutralSoft/.test(index) && /recallChipText: \{[^}]*color: themeColors\.textSecondary/.test(index));
  ok('recall rung badge: neutral grey', /rungRecall: \{ backgroundColor: themeColors\.neutralSoft \}/.test(index) && /rungRecallText: \{ color: themeColors\.textSecondary \}/.test(index));
  ok('the edition-mismatch badge (a real warning) stays amber, twice', (index.match(/styles\.rungBadge, styles\.rungWarn, styles\.rungMismatchBadge/g) ?? []).length === 2 && /rungWarnText: \{ color: themeColors\.warningLabel \}/.test(index));
  ok('the recall words are unchanged (Code Check and Plan Review)', (index.match(/From model recall — verify with your AHJ before relying on a section number/g) ?? []).length === 2);

  const rm = between(index, 'function ResultModal(', 'function AccordionSection(');
  ok('every citation with a verdict renders a CodeCard from its own card item (codeCheckCards: index-aligned, content ids)',
    /const card = cards\[i\] \?\? null;/.test(rm) && /\{card \? \(\s*<CodeCard/.test(rm)
      && /codeCheckCards\(result\.applicableCodes, evidence, parseCodeCardItem, passesEchoCheck, \{ text: jobText, says: saysNumberWithUnit \}\)/.test(rm));
  ok('Code Check checks the model\u2019s job number against the words HE gave: the scenario and his answers, with the kit\u2019s own test',
    /setResultJurisdiction\(jurisdiction\);\s+setResultJobText\(codeCheckJobText\(scenario, answered\)\);/.test(index)
      && /export function codeCheckJobText\(scenario: string, answers: readonly \{ answer: string \}\[\]\): string \{\s+return \[scenario, \.\.\.answers\.map\(\(a\) => a\.answer\)\]\.join\('\\n'\);\s+\}/.test(askSrc)
      && index.includes("import { saysNumberWithUnit } from '@/utils/codeCard/saysWithUnit';")
      && !/codeCheckCards\([^)]*passesEchoCheck\)/.test(index));
  ok('…and those words are the RUN’s, snapshotted with the result: "View last result" never checks an old run against the scenario box as it reads now',
    /jurisdiction=\{resultJurisdiction\}\s+jobText=\{resultJobText\}/.test(index) && /setResultJurisdiction\(null\);\s+setResultJobText\(''\);/.test(index)
      && !/\bjobText = /.test(rm) && !/\[scenario, \.\.\.answers/.test(index) && /\[result, evidence, jobText\],/.test(rm));
  ok('a citation with NO verdict renders the plain line through the own-words gate, never a card',
    /\) : \(\s*<View testID=\{`code-check-plain-\$\{i\}`\}>/.test(rm) && rm.includes('<Text style={styles.codeReq}>{codeCheckPlainLine(c.requirement, passesEchoCheck)}</Text>'));
  ok('the Code Check card carries its stage, Checklist, Ask town and More',
    /<CodeCard\s+item=\{wiring\.cardOf\(card\)\}\s+info=\{cardInfo\}\s+jobValue=\{wiring\.jobValueOf\(card\)\}\s+onOpen=\{\(\) => toggleCode\(c\)\}\s+checklist=\{wiring\.checklistFor\(card\)\}\s+askTown=\{wiring\.askTownFor\(card\)\}\s+onMore=\{wiring\.onOpen\}/.test(rm));
  ok('the drill-in toggle and the rung badge stay with each citation', rm.includes('testID={`code-detail-toggle-${i}`}') && rm.includes('{ev ? <RungBadge ev={ev} testID={`code-check-rung-${i}`} /> : null}'));
  ok("the card's overlay renders inside the result sheet's tree", rm.includes('{anyCard ? wiring.overlay : null}') && rm.includes('const anyCard = cards.some((c) => !!c);'));
  ok('Code Check pins and saves go to the project the run was saved to', rm.includes("const wiring = useCodeCardWiring({ project, info: cardInfo, testID: 'code-check-cards' });"));

  const plan = between(index, "mode === 'plan' ? (", "mode === 'ask' ? (");
  ok('Plan Review renders a plan-mode CodeCardList BELOW the recall chip', plan.indexOf('<CodeCardList') > plan.indexOf('testID="plan-review-recall-chip"') && /mode="plan"/.test(plan));
  ok('the architect email opens HIS Mail (mailto), nothing is sent from here', /void Linking\.openURL\(mailtoUrlFor\('', msg\.subject, msg\.body\)\)/.test(index));
  ok('an edition mismatch count shows on the details toggle even when it is shut', plan.includes('edition mismatch'));
  ok('only OPEN findings are carded (resolved / dismissed are handled, never "to fix")', /\.filter\(\(f\) => f\.status === 'open'\)/.test(index));
  ok('with no open finding the per-finding list shows on its own', /\{\(planDetailsOpen \|\| planCards\.length === 0\) && SEVERITY_ORDER\.map/.test(index));
  ok('…and the details toggle renders ONLY while there are cards (a toggle over an always-open list would do nothing)',
    /\{planCards\.length > 0 \? \(\s*<TouchableOpacity\s+onPress=\{\(\) => setPlanDetailsOpen\(\(o\) => !o\)\}/.test(plan)
      && (plan.match(/testID="plan-review-details-toggle"/g) ?? []).length === 1);
  ok('the toggle says this is where a finding is marked resolved or dismissed (the cards have no such button)',
    plan.includes('each finding’s evidence, and mark it resolved or dismissed (${existingReview.findings.length})'));
  ok('Plan Review cards are keyed on their CONTENT (a re-review renumbers its findings)',
    /const planCards = useMemo<CodeCardItem\[\]>\(\(\) => withContentIds\('plan', \(existingReview\?\.findings \?\? \[\]\)\s+\.filter\(\(f\) => f\.status === 'open'\)\s+\.map\(\(f\) => planFindingCardItem\(/.test(index));
  ok('Plan Review cards carry the stage, the opened card, Checklist and Ask town, on the plan\u2019s project',
    /stageOf=\{planWiring\.stageOf\}\s+onOpen=\{planWiring\.onOpen\}\s+checklistFor=\{planWiring\.checklistFor\}\s+askTownFor=\{planWiring\.askTownFor\}/.test(plan)
      && index.includes("const planWiring = useCodeCardWiring({ project: planProject, info: planCardInfo, testID: 'plan-review-cards' });")
      && plan.includes('{planCards.length > 0 ? planWiring.overlay : null}'));
  ok('Plan Review\u2019s two bulk buttons are the shared ones', plan.includes("{ key: 'checklists', icon: 'clip', ...planWiring.checklistAll(planCards) },") && plan.includes("{ key: 'save', label: 'Save', icon: 'save', action: planWiring.saveAllAction(planCards) },"));

  const ask = askSrc;
  ok('Ask parses requirements with parseCodeCardItems, attaches the evidence SENT with the question, and keys the cards on their content',
    /withContentIds\('ask', attachEvidence\(parseCodeCardItems\(raw\), askedFor\.resolved\)\)/.test(ask));
  ok('Ask renders the cards ONLY when there is at least one usable requirement', /\{cards\.length > 0 && cardInfo \? \(/.test(ask));
  ok('ONE JurisdictionBlock per answer', (ask.match(/<JurisdictionBlock\b/g) ?? []).length === 1);
  ok('the prose answer is still rendered first, unchanged', ask.indexOf('<Text style={styles.answerText} selectable>{result.answer}</Text>') >= 0
    && ask.indexOf('<Text style={styles.answerText} selectable>{result.answer}</Text>') < ask.indexOf('testID="construction-ask-code-cards"'));
  ok('the jurisdiction is snapshotted at ask time', /setAskedFor\(\{\s*project: linkedProject,/.test(ask));
  ok('a sub is texted from HIS Messages (sms: via Linking)', /const url = smsUrlFor\(recipient\.phone, text, Platform\.OS\);/.test(ask) && /void Linking\.openURL\(url\)/.test(ask));
  ok('a sub with no phone says why', ask.includes("has no phone number in Subs"));
  // ── The wiring hook: who it pins for, and every way a button is blocked ──
  const hook = between(ask, 'export function useCodeCardWiring(', '/** What a code-card answer was grounded on');
  const fn = (name: string) => between(hook, `const ${name} = useCallback(`, '\n  }, [');
  ok('the hook is found', hook.length > 0 && hook.includes('const projectId = project?.id ?? null;'));
  ok("Ask's cards are wired to the project that was ASKED for, not the one linked now",
    ask.includes("const wiring = useCodeCardWiring({ project: askedFor.project, info: cardInfo, infoFor: cardInfoFor, testID: 'construction-ask-cards' });")
      && ask.includes("const savedWiring = useCodeCardWiring({ project: linkedProject, info: savedInfo, testID: 'construction-ask-saved-cards' });"));
  ok("Ask's list carries the stage, the opened card, Checklist and Ask town",
    /stageOf=\{wiring\.stageOf\}\s+jobValueOf=\{wiring\.jobValueOf\}\s+onOpen=\{wiring\.onOpen\}\s+checklistFor=\{wiring\.checklistFor\}\s+askTownFor=\{wiring\.askTownFor\}/.test(ask));
  // ── 4c. THE RE-MEASURE BELONGS TO ONE CARD AS IT WAS SHOWN ──
  ok('the hook keeps re-measures in the kit’s map and reads EVERY one through remeasureFor with its own project: the list card, the reopened card, Save and Save all',
    /const \[remeasures, setRemeasures\] = useState<RemeasureMap>\(EMPTY_REMEASURES\);/.test(hook)
      && /const jobValueOf = useCallback\(\s+\(item: CodeCardItem\): CodeJobValue \| undefined => remeasureFor\(item, projectId, remeasures\),\s+\[projectId, remeasures\],\s+\);/.test(hook)
      && /jobValue=\{openItem \? jobValueOf\(openItem\) : undefined\}\s+onJobValueChange=\{\(item, jv\) => setRemeasures\(\(m\) => recordRemeasure\(m, item, projectId, jv\)\)\}/.test(hook)
      && /jobValue=\{jobValueOf\?\.\(item\)\}/.test(read('components/codeCard/CodeCardList.tsx')));
  ok('…and nothing in the hook is keyed on the card id alone: remeasureFor and recordRemeasure are each called once, the map is read nowhere else, and the old id-keyed state is gone',
    (hook.match(/remeasureFor\(/g) ?? []).length === 1 && (hook.match(/recordRemeasure\(/g) ?? []).length === 1
      && (hook.match(/\bremeasures\b/g) ?? []).length === 3 && !/jobValues|setJobValues/.test(ask) && !/remeasures\[/.test(ask)
      && ask.includes("import { EMPTY_REMEASURES, keptIsShown, recordRemeasure, remeasureFor, type RemeasureMap } from '@/utils/codeCard/remeasure';"));
  // ── 4d. THE "SAVED" AND "ON … CHECKLIST" MARKS BELONG TO THE CARD AS SHOWN ──
  ok('the hook reads BOTH marks through the kit’s keptIsShown: a pin with this id counts only for this card as shown, and a saved card only with the number now on screen',
    /const pinnedStageOf = useCallback\(\(item: CodeCardItem\): CodeStage \| null => \{\s+const pin = pinsFor\(pins, projectId\)\.find\(\(p\) => p\.item\.id === item\.id\);\s+return pin && keptIsShown\(pin, item\) \? pin\.stage : null;\s+\}, \[pins, projectId\]\);/.test(hook)
      && /const savedShown = useCallback\(\(item: CodeCardItem\): boolean =>\s+keptIsShown\(savedFor\(saved, projectId\)\.find\(\(c\) => c\.item\.id === item\.id\), item, jobValueOf\(item\)\),\s+\[saved, projectId, jobValueOf\]\);/.test(hook)
      && (hook.match(/keptIsShown\(/g) ?? []).length === 2);
  ok('…and nothing in the hook asks the stores by card id alone any more (no pinnedStage(…), isPinned(…) or isSaved(…) anywhere in Ask)',
    !/\bpinnedStage\(|\bisPinned\(|\bisSaved\(/.test(ask) && ask.includes("import { codePinStore, makePin, pinsFor } from '@/utils/codeCard/pins';")
      && ask.includes("import { codeSavedStore, makeSaved, savedFor } from '@/utils/codeCard/saved';"));
  {
    // The critic's case, on the same kit functions the two helpers above call:
    // answer 1 is REQUIRED at 34 in., saved and pinned; answer 2 is the same
    // line (same content id) but NOT REQUIRED at 28 in.
    const mk = (verdict: 'required' | 'not_required', n: number): CodeCardItem => ({
      id: 'ask-same', verdict, summary: 'Sample: a guard is needed once the deck is more than 30 in. up.', section: 'R312.1.1', evidence: null, stage: 'final', stageIsGuess: true,
      trigger: { value: 30, unit: 'in', comparison: '>' }, jobValue: { value: n, unit: 'in', source: 'job', sourceLabel: 'deck height from the question' },
    });
    const a1 = mk('required', 34), a2 = mk('not_required', 28);
    const savedState = savedReducer(EMPTY_SAVED, { type: 'save', card: makeSaved('p1', a1, '2026-10-04T10:00:00.000Z', null) });
    const pinState = pinsReducer(EMPTY_PINS, { type: 'pin', pin: makePin('p1', a1, '2026-10-04T10:00:00.000Z') });
    const savedOf = (item: CodeCardItem, shown?: CodeCardItem['jobValue']) => keptIsShown((savedState.p1 ?? []).find((c) => c.item.id === item.id), item, shown);
    const pinOf = (item: CodeCardItem) => keptIsShown((pinState.p1 ?? []).find((x) => x.item.id === item.id), item);
    ok('a LATER answer with the same line but another verdict or number is neither "Saved" nor "On … checklist" (the id-only lookups say it is: that was the defect)',
      a1.id === a2.id && savedOf(a1) && pinOf(a1) && !savedOf(a2) && !pinOf(a2) && isSaved(savedState, 'p1', a2.id) && pinnedStage(pinState, 'p1', a2.id) === 'final'
        && !savedOf(mk('required', 40)) && !pinOf(mk('required', 40)));
    ok('a − / + step after a save turns the Saved mark off (Save is ready again and keeps the number on screen); the pin, which holds no re-measure, stays',
      !savedOf(a1, { value: 29, unit: 'in', source: 'measured', sourceLabel: 'measured on site' }) && pinOf(a1));
  }
  ok('a stage he picked is kept per JOB and card, never by the card id alone',
    hook.includes("const stageKey = useCallback((item: CodeCardItem) => `${projectId ?? ''}|${item.id}`, [projectId]);")
      && /stageEdits\[stageKey\(item\)\] \?\? pinnedStageOf\(item\) \?\? item\.stage, \[stageEdits, stageKey, pinnedStageOf\]\);/.test(hook)
      && !/stageEdits\[item\.id\]|\[item\.id\]: stage/.test(hook));
  ok('every surface shows the card through cardOf / withChosenStage, so a stage HE chose is never labelled "AI guess": the opened card, the saved rows, the Code Check card and the kit’s list',
    hook.includes('const cardOf = useCallback((item: CodeCardItem): CodeCardItem => cardWithChosenStage(item, stageOf(item)), [stageOf]);')
      && hook.includes('item={openItem ? cardOf(openItem) : null}') && !/\{ \.\.\.openItem, stage:/.test(hook)
      && !/\{ \.\.\.(?:item|card), stage: \w+\.stageOf\(/.test(ask) && !/\{ \.\.\.(?:item|card), stage: \w+\.stageOf\(/.test(index)
      && (read('components/codeCard/CodeCardList.tsx').match(/item=\{stageOf \? withChosenStage\(item, stageOf\(item\)\) : item\}/g) ?? []).length === 2
      && !/\{ \.\.\.item, stage: stageOf\(item\) \}/.test(read('components/codeCard/CodeCardList.tsx')));
  ok('the saved lists’ sheet stays mounted while one of their cards is open: unpinning the LAST card from its own sheet must not unmount it open (the next pin would reopen it)',
    ask.includes('{keptOpen || savedWiring.busy ? savedWiring.overlay : null}') && !ask.includes('{keptOpen ? savedWiring.overlay : null}')
      && hook.includes('overlay, busy: !!openItem || !!ask };'));
  {
    const sheetSrc = read('components/codeCard/CodeCardSheet.tsx');
    ok('the opened card never texts a stand-in line to a sub: Send is blocked with the reason, the preview is not shown, and the press does nothing while blocked',
      sheetSrc.includes('const noWords = shareBlockedReason(item);') && /const sendBlocked = noWords \?\? \(!recipients \|\| recipients\.length === 0/.test(sheetSrc)
        && /\{noWords \? null : \(\s+<View style=\{styles\.msg\}>\s+<Text style=\{styles\.msgText\} testID=\{`\$\{tid\}-share-text`\}>\{text\}<\/Text>/.test(sheetSrc)
        && sheetSrc.includes('onPress={() => { if (!sendBlocked && recipient && onSendToSub) onSendToSub(recipient, text); }}')
        && sheetSrc.includes('disabled={!!sendBlocked}') && sheetSrc.includes('<BlockedNote text={sendBlocked} sunlight={sunlight} testID={`${tid}-send-blocked`} />'));
  }
  ok('the opened card gets the facts for ITS OWN edition (Ask passes infoFor; a surface with one edition passes none)',
    hook.includes('info={openItem && infoFor ? infoFor(openItem) : info}')
      && /const cardInfoFor = useCallback\(\s+\(item: CodeCardItem\) => codeJurisdictionInfoFor\(askedFor\.resolved, permitAnswer, item\.citedEdition \?\? null\),/.test(ask));
  ok('a stage edit on a pinned card is written to the pin (setStage), for THIS project',
    /onStageChange=\{\(item, stage\) => \{\s+setStageEdits\(\(m\) => \(\{ \.\.\.m, \[stageKey\(item\)\]: stage \}\)\);\s+if \(projectId && pinnedStageOf\(item\)\) pinStore\.dispatch\(\{ type: 'setStage', projectId, itemId: item\.id, stage \}\);/.test(hook));
  ok('the permit-office lookup runs only while a surface is active and the job has no verified department row',
    /const query = useMemo\(\(\) => \(project && active && !hasDepartment \? placeQueryForProject\(project\) : null\), \[project, active, hasDepartment\]\);/.test(ask)
      && /const permitAnswer = usePermitOfficeAnswer\(project, visible && anyCard\);/.test(between(index, 'function ResultModal(', 'function AccordionSection('))
      && /usePermitOfficeAnswer\(askedFor\.project, cards\.length > 0\)/.test(ask) && /usePermitOfficeAnswer\(linkedProject, keptOpen\)/.test(ask)
      && /usePermitOfficeAnswer\(planProject, mode === 'plan' && planCards\.length > 0\)/.test(index));
  ok("Ask's opened card and town draft render whenever there are cards", ask.includes('{cards.length > 0 ? wiring.overlay : null}'));
  const checklist = fn('checklistFor');
  ok('Checklist, in order: no project says why; pinned says where; a card that cannot be kept says why; else it pins to THIS project',
    /^const checklistFor = useCallback\(\(item: CodeCardItem\): CodeCardAction => \{\s+if \(!projectId\) return blockedAction\(NO_JOB_CHECKLIST\);\s+const pinned = pinnedStageOf\(item\);\s+if \(pinned\) return doneAction\(`On \$\{stageLabel\(pinned\)\} checklist`\);\s+const cannot = cardKeepBlockedReason\(item, 'checklist'\);\s+if \(cannot\) return blockedAction\(cannot\);\s+return readyAction\(\(\) => \{\s+pinStore\.dispatch\(\{ type: 'pin', pin: makePin\(projectId, item, new Date\(\), stageOf\(item\)\) \}\);/.test(checklist), checklist.slice(0, 300));
  const save = fn('saveFor');
  ok('Save, in order: no project says why; saved says where; a card that cannot be kept says why; else it saves to THIS project',
    /^const saveFor = useCallback\(\(item: CodeCardItem\): CodeCardAction => \{\s+if \(!projectId \|\| !project\) return blockedAction\(NO_JOB_SAVE\);\s+if \(savedShown\(item\)\) return doneAction\(savedWhere\(project\.name\)\);\s+const cannot = cardKeepBlockedReason\(item, 'save'\);\s+if \(cannot\) return blockedAction\(cannot\);\s+return readyAction\(\(\) => \{\s+savedStore\.dispatch\(\{ type: 'save', card: makeSaved\(projectId, /.test(save), save.slice(0, 300));
  ok('a stand-in card (no requirement in words) is never pinned or saved, and says so; anything else the store would refuse gives the store\u2019s reason',
    /export function cardKeepBlockedReason\(item: CodeCardItem, kind: 'checklist' \| 'save'\): string \| null \{\s+if \(isCardPlaceholder\(item\.summary\)\) return kind === 'checklist' \? NO_WORDS_CHECKLIST : NO_WORDS_SAVE;\s+return codeCardStoreBlockedReason\(item\);\s+\}/.test(ask)
      && /NO_WORDS_CHECKLIST = 'This card has no requirement in words, so there is nothing to put on a checklist\. Use Official text to read the section\.'/.test(ask)
      && /NO_WORDS_SAVE = 'This card has no requirement in words, so there is nothing to keep\. Use Official text to read the section\.'/.test(ask));
  const addAll = fn('addAll');
  const saveAll = fn('saveAll');
  ok('Add all pins each keepable card to THIS project on its own stage, skipping what is already pinned',
    /if \(!projectId\) return;/.test(addAll) && /if \(cardKeepBlockedReason\(item, 'checklist'\)\) continue;/.test(addAll)
      && /if \(!pinnedStageOf\(item\)\) pinStore\.dispatch\(\{ type: 'pin', pin: makePin\(projectId, item, now, stageOf\(item\)\) \}\);/.test(addAll));
  ok('Save all keeps each keepable card on THIS project',
    /if \(!projectId\) return;/.test(saveAll) && /if \(cardKeepBlockedReason\(item, 'save'\)\) continue;/.test(saveAll)
      && /if \(!savedShown\(item\)\) savedStore\.dispatch\(\{ type: 'save', card: makeSaved\(projectId, cardWithChosenStage\(item, stageOf\(item\)\), now, jobValueOf\(item\) \?\? null\) \}\);/.test(saveAll));
  ok('Save and Save all keep a stage HE chose as his (never re-labelled "AI guess"), and never spread the stage alone',
    /makeSaved\(projectId, cardWithChosenStage\(item, stageOf\(item\)\), new Date\(\), jobValueOf\(item\) \?\? null\)/.test(save)
      && !/makeSaved\(projectId, \{ \.\.\.item, stage: stageOf\(item\) \}/.test(hook));
  const bulkPin = fn('checklistAll');
  ok('the bulk Checklist button: no project says why; nothing keepable says why; done only when every KEEPABLE card is pinned',
    /const can = items\.filter\(\(c\) => !cardKeepBlockedReason\(c, 'checklist'\)\);/.test(bulkPin)
      && /if \(!projectId\) return \{ label, action: blockedAction\(NO_JOB_CHECKLIST\) \};\s+if \(can\.length === 0\) return \{ label, action: blockedAction\(NO_WORDS_CHECKLIST\) \};\s+if \(can\.every\(\(c\) => !!pinnedStageOf\(c\)\)\) return \{ label, action: doneAction\('On the inspection checklists'\) \};\s+return \{ label, action: readyAction\(\(\) => addAll\(can\)\) \};/.test(bulkPin), bulkPin);
  const bulkSave = fn('saveAllAction');
  ok('the bulk Save button: the same four answers',
    /if \(!projectId \|\| !project\) return blockedAction\(NO_JOB_SAVE\);\s+const can = items\.filter\(\(c\) => !cardKeepBlockedReason\(c, 'save'\)\);\s+if \(can\.length === 0\) return blockedAction\(NO_WORDS_SAVE\);\s+if \(can\.every\(\(c\) => savedShown\(c\)\)\) return doneAction\(`Saved to \$\{project\.name\}`\);\s+return readyAction\(\(\) => saveAll\(can\)\);/.test(bulkSave), bulkSave);
  ok("Ask's two bulk buttons are the shared ones",
    ask.includes("primary={{ key: 'add-all', icon: 'clip', ...wiring.checklistAll(cards) }}") && ask.includes("secondary={[{ key: 'save-all', label: 'Save', icon: 'save', action: wiring.saveAllAction(cards) }]}"));
  // A pin can be seen and taken off at any time (Inspection Ready shows it only 3 days out).
  ok('a pin comes off through the pins store, for THIS project', /if \(projectId\) pinStore\.dispatch\(\{ type: 'unpin', projectId, itemId: item\.id \}\);/.test(fn('unpin')));
  ok('a pinned card is unpinned FROM THE CARD ITSELF: the opened card’s Checklist row, once pinned, says so and a tap takes the pin off (on every surface, not only Ask)',
    /return projectId && pinned \? doneAction\(pinnedWhere\(pinned\), \(\) => unpin\(item\)\) : checklistFor\(item\);/.test(fn('checklistFromSheet'))
      && hook.includes('checklist={openItem ? checklistFromSheet(openItem) : undefined}')
      && ask.includes('return `On ${stageLabel(stage)} checklist. Tap to take it off.`;')
      && /export function doneAction\(label: string, onPress\?: \(\) => void\): CodeCardAction \{/.test(read('components/codeCard/parts.tsx'))
      && /else if \(action\.kind === 'done' && action\.onPress\) \{ setNote\(null\); action\.onPress\(\); \}/.test(read('components/codeCard/CodeCardSheet.tsx')));
  ok('Ask lists the linked project\u2019s pinned cards (only when it has any), each with Unpin',
    /\{linkedProject && pinnedCards\.length > 0 \? \(\s*<View style=\{styles\.savedWrap\} testID="construction-ask-pinned">/.test(ask)
      && /pinsFor\(wiring\.pins, linkedProject\?\.id\)/.test(ask) && /onPress=\{\(\) => savedWiring\.unpin\(p\.item\)\}/.test(ask)
      && ask.includes('{`On inspection checklists for ${linkedProject.name} (${pinnedCards.length})`}'));
  ok('the pinned list says when each one shows and that it lives on this device',
    /PINNED_LIST_NOTE = 'Each one shows in Inspection Ready 3 days before that inspection\. Kept on this device\. Confirm with your building department\.'/.test(ask) && ask.includes('<Text style={styles.savedNote}>{PINNED_LIST_NOTE}</Text>'));
  ok('Save keeps the card on the job (saved store)', /savedStore\.dispatch\(\{ type: 'save', card: makeSaved\(/.test(ask));
  ok('Ask town opens Draft a question (his own Mail) or says why it cannot', /askTownBlockedReason\(project\)/.test(ask) && /<DraftQuestionButton[\s\S]*?hideTrigger[\s\S]*?initialQuestion=\{ask\.question\}/.test(ask));
  ok("the town question never repeats MAGE's stand-in line", /codeCardQuestion\(item, \{ noWords: isCardPlaceholder\(item\.summary\) \}\)/.test(ask));
  ok('Save says where the card can be found again', /doneAction\(savedWhere\(project\.name\)\)/.test(ask) && /Find it in Ask, under Saved code cards/.test(ask));
  ok('the saved list renders only for a linked project that has saved cards', /\{linkedProject && savedCards\.length > 0 \? \(\s*<View style=\{styles\.savedWrap\} testID="construction-ask-saved">/.test(ask));
  ok('the saved rows and the pinned rows check the cited edition against the linked project\u2019s verified one (info={savedInfo}), so a verified edition is not marked "(as cited)"',
    /<CodeCardRow\s+item=\{savedWiring\.cardOf\(item\)\}\s+onPress=\{savedWiring\.onOpen\}\s+edition=\{item\.citedEdition \?\? null\}\s+info=\{savedInfo\}/.test(ask)
      && /<CodeCardRow\s+item=\{\{ \.\.\.p\.item, stage: p\.stage \}\}\s+onPress=\{savedWiring\.onOpen\}\s+edition=\{p\.item\.citedEdition \?\? null\}\s+info=\{savedInfo\}/.test(ask)
      && (ask.match(/<CodeCardRow\b/g) ?? []).length === 2);
  ok('a saved card can be removed (unsave on the saved store)', /savedStore\.dispatch\(\{ type: 'unsave', projectId, itemId: item\.id \}\)/.test(ask) && /onPress=\{\(\) => savedWiring\.unsave\(item\)\}/.test(ask));
  ok('the saved list says it is kept on this device, in our words, section from recall', /SAVED_NOTE = 'Kept on this device\. In MAGE\\u2019s words; section from AI recall unless marked\. Confirm with your building department\.'/.test(ask));
  ok('the no-project reasons say project', /NO_JOB_CHECKLIST = 'Link a project first/.test(ask) && /NO_JOB_SAVE = 'Link a project first/.test(ask));
  ok('the opened card closes before the town draft opens (one sheet at a time)', /setOpenItem\(null\);\s*setTimeout\(\(\) => openAsk\(item\), SHEET_HANDOFF_MS\);/.test(ask));

  const dq = read('components/buildingRecord/DraftQuestionButton.tsx');
  ok('the town branch routes with routeOfficeQuestion', /routeOfficeQuestion\(office\)/.test(dq));
  ok('the town branch is decided before any hook, by askTownKind', /if \(project && askTownKind\(project\) === 'town'\) \{/.test(between(dq, 'export function DraftQuestionButton(', 'function DraftQuestionInner(')));
  ok('a town that cannot be found says so instead of opening nothing', dq.includes("'Town not found'"));

  // Plan Set Code Sweep.
  const sweep = read('components/plans/PlanSweepPanel.tsx');
  ok('the sweep panel is readable', sweep.length > 0);
  ok('the sweep builds its cards from the NEUTRALISED view of each row, findings then look-right rows',
    /const view = sweepFindingView\(f, r\.sheet, jurisdiction\);/.test(sweep)
      && /\{ question: \(f\.question \?\? ''\)\.trim\(\) \? view\.title : '', requirement: view\.requirement, observed: view\.observed \}/.test(sweep)
      && /add\(r\.findings, false\);\s*add\(lookRightRows\(r\), true\);/.test(sweep));
  ok('…and keys them on their content', /return withContentIds\('sweep', out\);/.test(sweep));
  ok('the card list sits ABOVE the per-sheet findings, which are unchanged',
    sweep.indexOf('testID="plansweep-card-list"') > 0 && sweep.indexOf('testID="plansweep-card-list"') < sweep.indexOf('testID="plansweep-approx-note"')
      && sweep.includes('testID={`plansweep-draft-${key}`}') && sweep.includes('testID={`plansweep-punch-${key}`}') && sweep.includes('testID={`plansweep-rung-${key}`}'));
  ok('a look-right row never reaches the RFI / punch rows (they map r.findings only)', /r\.findings\.map\(\(f, i\) => \{\s*const key = `\$\{r\.sheet\.id\}#\$\{i\}`;/.test(sweep) && (sweep.match(/lookRightRows\(/g) ?? []).length === 2);
  ok("the sweep's architect email opens HIS Mail (mailto)", /void Linking\.openURL\(mailtoUrlFor\('', msg\.subject, msg\.body\)\)/.test(sweep));
  ok('the opened card and the town draft render inside the panel (it sits in a sheet)', sweep.includes('{sweepCards.length > 0 ? wiring.overlay : null}'));
  ok('the sweep cards carry the stage, the opened card, Checklist and Ask town, on the panel\u2019s project',
    /stageOf=\{wiring\.stageOf\}\s+onOpen=\{wiring\.onOpen\}\s+checklistFor=\{wiring\.checklistFor\}\s+askTownFor=\{wiring\.askTownFor\}/.test(sweep)
      && sweep.includes("const wiring = useCodeCardWiring({ project, info: cardInfo, testID: 'plansweep-cards' });"));
  ok('the sweep\u2019s two bulk buttons are the shared ones', sweep.includes("{ key: 'checklists', icon: 'clip', ...wiring.checklistAll(sweepCards) },") && sweep.includes("{ key: 'save', label: 'Save', icon: 'save', action: wiring.saveAllAction(sweepCards) },"));
  ok('sweep recall is neutral grey; the edition mismatch keeps amber',
    /recallChip: \{[^}]*backgroundColor: t\.neutralSoft/.test(sweep) && /recallChipText: \{[^}]*color: t\.textSecondary/.test(sweep)
      && /badgeRecall: \{ backgroundColor: t\.neutralSoft \}/.test(sweep) && /badgeRecallText: \{ color: t\.textSecondary \}/.test(sweep)
      && /styles\.badge, styles\.badgeWarn\]\} testID=\{`plansweep-mismatch-\$\{key\}`\}/.test(sweep) && /badgeWarnText: \{ color: t\.warningLabel \}/.test(sweep));
  ok('the sweep recall words are unchanged', sweep.includes('<Text style={styles.recallChipText}>{sweepCopy.recallLine}</Text>'));
  ok('nothing looks up the permit office before there are cards', /usePermitOfficeAnswer\(project, sweepCards\.length > 0\)/.test(sweep));

  const files = [INDEX, 'components/construction/AskConstructionMode.tsx', 'components/buildingRecord/DraftQuestionButton.tsx', 'components/inspectionPrep/InspectionReadySheet.tsx', 'components/plans/PlanSweepPanel.tsx'];
  for (const f of files) {
    const src = read(f);
    ok(`${f}: no send service (functions.invoke send / send-email / emailService)`, !/send-email|emailService|sendEmail/.test(src) && !/functions\.invoke\(['"]send/.test(src));
  }

  const sheet = read('components/inspectionPrep/InspectionReadySheet.tsx');
  ok('Inspection Ready reads the pins through pinnedPrepItems(pinsFor(...))', /pinnedPrepItems\(pinsFor\(pinsState, project\.id\), inspection\)/.test(sheet));
  ok('the pinned group renders only when there are pins (byte-identical otherwise)', /\{pinned\.length > 0 \? \(\s*<View style=\{s\.section\} testID="inspection-prep-pinned">/.test(sheet));
  ok('a pinned item can be unpinned from the sheet', /codePinStore\(\)\.dispatch\(\{ type: 'unpin', projectId: project\.id, itemId \}\)/.test(sheet)
    && /item\.group === 'pinned' && item\.pinItemId \? \(/.test(sheet));
  ok('the pinned group comes after the photo-check group and before "How did it go?"',
    sheet.indexOf('testID="inspection-prep-pinned"') > sheet.indexOf('testID="codelook-prep-extras"') && sheet.indexOf('testID="inspection-prep-pinned"') < sheet.indexOf('testID="inspection-prep-result"'));
}

// ── 4b. The withhold rule covers every place the line can appear ─────────
//
// COPYRIGHT. A line the card withholds ("MAGE hid this line because it read
// like code text") must be withheld everywhere else it could print: the list
// one tap below the card, the saved check, an RFI draft, a punch item, a
// permit, a message. THE SWEEP: in every surface file, each read of an AI
// result's `.requirement` or `.observed` (or of the sweep view's `.title`) is
// allowed only when
//   (a) it is the argument of an own-words gate on that line, or
//   (b) it is read from an object the gate made (`ownWords`, `row`; pinned below to
//       be assigned from the gate and nothing else), or from `sweepCopy` (a
//       label, not an AI line), or
//   (c) the whole line is one of NOT_SHOWN: a line that prints nothing, listed
//       here word for word with its reason, so any edit to it fails the sweep.
// A read is a dotted read (`f.requirement`), a BRACKET read (`f['requirement']`)
// or a DESTRUCTURED read (`const { requirement } = f`, `({ observed }) =>`,
// `function x({ requirement })`, on one line or over several). A bracket or a
// destructured read is never a gated read: there is no way to write one that
// the sweep accepts, so the only way through is a gate call on a dotted read.
// The pure block in AskConstructionMode.tsx is left out: it IS the gates, and
// section 3 runs it.
/** The integrator's patch for the saved check sheet (a file outside this lane). */
const SAVED_SHEET_PATCH = '/Users/omirmajeed/.claude/projects/-Users-omirmajeed-Desktop-MAGE-ID---CLAUDE/f24f1ad8-bdb7-4740-9485-fd4d5f3a532b/codecard-specs/patches/CCFIX-saved-check-sheet.diff';
let savedSheetNotice = '';
console.log('\n4b. The withhold rule covers every place the line can appear');
{
  const SWEEP_PANEL = 'components/plans/PlanSweepPanel.tsx';
  const SAVED_SHEET = 'components/codeThread/SavedCodeCheckSheet.tsx';
  const savedSheet = read(SAVED_SHEET);
  const savedSheetGated = /savedRequirementWords/.test(savedSheet);
  const GATE_ARG = /(?:codeCheckPlainLine|ownWordsLine|ownWordsObserved|isCardPlaceholder|savedRequirementWords)\(\s*$/;
  const GATED_OBJECTS = ['ownWords', 'row', 'sweepCopy'];
  const NOT_SHOWN: Record<string, [string, string][]> = {
    [INDEX]: [
      ["applicableCodes: data.applicableCodes.map((c) => ({ code: c.code, section: c.section ?? '', requirement: c.requirement })),",
        'the check saved to the job: `data` is the gated result (pinned below)'],
      ["Summary requirement given: ${isCardPlaceholder(c.requirement) ? 'none' : c.requirement}",
        'the drill-in PROMPT (sent to the AI, not shown); `c` is a row of the gated result, and a stand-in line is never sent as a requirement'],
      ["const cacheKey = `code_detail::${grounding?.cacheKey ?? 'none'}::${location.trim().toLowerCase()}::${label.toLowerCase()}::${c.requirement.toLowerCase().slice(0, 80)}`;",
        'a cache key, never shown'],
      ['<CodeThreadActions key={`codes-${i}-${c.requirement}`} record={savedRecord} project={project} section="codes" index={i} text={codeCheckPlainLine(c.requirement, passesEchoCheck)} onBeforeNavigate={onClose} />',
        'a React key (never shown); the text the permit / punch item / RFI is built from is the gated line'],
    ],
    // Only once the saved-sheet patch is in (see the end of this section).
    ...(savedSheetGated ? { [SAVED_SHEET]: [
      ["actionTexts: codes.map((c) => c.requirement ?? '').map(savedRequirementWords),",
        'what a permit / punch item / RFI is built from: every line is mapped straight through the gate in the same expression (validate-code-thread pins its first half)'] as [string, string],
    ] } : {}),
    [SWEEP_PANEL]: [
      ["{ question: (f.question ?? '').trim() ? view.title : '', requirement: view.requirement, observed: view.observed },",
        'the words handed to sweepCardItem, which gates each one (section 3)'],
      ["kind: 'rfi', label: view.title, linkedRfiId: rfi.id,",
        'the RFI pin label inside onDraft: its `view` is the gated row it is called with (pinned below)'],
      ["kind: 'punch', label: view.title, linkedPunchItemId: punch.id,",
        'the punch pin label inside onPunch: its `view` is the gated row it is called with (pinned below)'],
    ],
  };
  // Any receiver: a name (`f.requirement`), or the end of a longer expression
  // (`findings[0]?.requirement`, `call().observed`), which is never a gated object.
  const AI_READ = /(?:\b([A-Za-z_$][\w$]*)|[\])])\??\.(?:requirement|observed)\b|\b(view)\.title\b/g;
  const BRACKET_READ = /\[\s*(['"`])(?:requirement|observed)\1\s*\]/g;
  const KEYS = '[^{}]*\\b(?:requirement|observed)\\b[^{}]*';
  const DESTRUCTURED_READ = new RegExp(
    `\\b(?:const|let|var)\\s*\\{${KEYS}\\}\\s*=(?!=)`                                   // const { requirement } = f
    + `|[(,]\\s*\\{${KEYS}\\}\\s*(?::[^(),=]*)?(?:,[^()]*)?\\)\\s*(?::[^=()]*)?=>`    // ({ requirement }) =>   (a, { observed }: T) =>
    + `|\\bfunction\\b[^(]*\\(\\s*\\{${KEYS}\\}`,                                      // function x({ requirement })
    'g');
  /** Comments blanked (line count kept), so a commented-out line cannot hide a read. */
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, '')).replace(/^\s*\/\/.*$/gm, '');
  /** Every read in `src` that is not gated, as "line N: text". */
  const ungated = (file: string, src: string): string[] => {
    const bad: string[] = [];
    const allowed = new Set((NOT_SHOWN[file] ?? []).map(([line]) => line));
    code(src).split('\n').forEach((line, n) => {
      const t = line.trim();
      if (!t || allowed.has(t)) return;
      AI_READ.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = AI_READ.exec(line)) !== null) {
        const receiver = m[1] ?? m[2] ?? '';
        // `x.ownWords.requirement` is not the gated object: the name must stand alone.
        const standsAlone = !/[.\])]\??$/.test(line.slice(0, m.index));
        if (standsAlone && GATED_OBJECTS.includes(receiver)) continue;
        if (GATE_ARG.test(line.slice(0, m.index))) continue;
        bad.push(`line ${n + 1}: ${t.slice(0, 140)}`);
      }
      BRACKET_READ.lastIndex = 0;
      if (BRACKET_READ.test(line)) bad.push(`line ${n + 1} (bracket read): ${t.slice(0, 140)}`);
    });
    // Destructured reads, over the whole file (a pattern can span lines).
    const whole = code(src);
    DESTRUCTURED_READ.lastIndex = 0;
    let d: RegExpExecArray | null;
    while ((d = DESTRUCTURED_READ.exec(whole)) !== null) {
      const n = whole.slice(0, d.index).split('\n').length;
      bad.push(`line ${n} (destructured read): ${d[0].replace(/\s+/g, ' ').slice(0, 140)}`);
    }
    return bad;
  };
  const sweepPanel = read(SWEEP_PANEL);
  const askOutsidePure = askSrc.replace(/\/\/ <pure:codeCardItems>\n[\s\S]*?\/\/ <\/pure:codeCardItems>/, '');
  const surfaces: [string, string][] = [
    [INDEX, index],
    [ASK, askOutsidePure],
    [SWEEP_PANEL, sweepPanel],
    ['components/inspectionPrep/InspectionReadySheet.tsx', read('components/inspectionPrep/InspectionReadySheet.tsx')],
    ['components/buildingRecord/DraftQuestionButton.tsx', read('components/buildingRecord/DraftQuestionButton.tsx')],
    ['utils/inspectionPrep.ts', read('utils/inspectionPrep.ts')],
    ['utils/departmentQuestion.ts', read('utils/departmentQuestion.ts')],
  ];
  ok('fixture: the sweep finds an ungated read (a bare {f.requirement}, {`Observed: ${f.observed}`}, a view.title) and passes a gated one',
    ungated('x', '<Text>{f.requirement}</Text>').length === 1 && ungated('x', '<Text>{`Observed: ${f.observed}`}</Text>').length === 1
      && ungated('x', '<Text>{view.title}</Text>').length === 1 && ungated('x', 'const t = finding?.requirement;').length === 1
      && ungated('x', 'log(review?.findings[0]?.requirement);').length === 1 && ungated('x', 'log(pick().observed);').length === 1
      && ungated('x', '<Text>{a.row.requirement}</Text>').length === 1 && ungated('x', '<Text>{codeCheckPlainLine(a.b.requirement, echo)}</Text>').length === 1
      && ungated('x', '<Text>{isCardPlaceholder(x) ? f.requirement : null}</Text>').length === 1
      && ungated('x', '<Text>{codeCheckPlainLine(c.requirement, passesEchoCheck)}</Text>').length === 0
      && ungated('x', '<Text>{ownWords.requirement}</Text>\n<Text>{row.observed}</Text>').length === 0 && ungated('x', '<Text>{own.requirement}</Text>').length === 1
      && ungated('x', '// <Text>{f.requirement}</Text>\n{/* {f.observed} */}').length === 0
      // bracket and destructured reads: never accepted, gate call or not
      && ungated('x', "<Text>{f['requirement']}</Text>").length === 1 && ungated('x', '<Text>{f["observed"]}</Text>').length === 1 && ungated('x', '<Text>{f?.[`requirement`]}</Text>').length === 1
      && ungated('x', "<Text>{ownWordsLine(f['requirement'], echo)}</Text>").length === 1
      && ungated('x', 'const { requirement: rawReq, observed: rawObs } = f;').length === 1 && ungated('x', 'const {\n  observed,\n} = finding;').length === 1
      && ungated('x', '<Text>{(({ requirement }) => requirement)(f)}</Text>').length === 1 && ungated('x', 'rows.map((r, { observed }: Row) => observed)').length === 1
      && ungated('x', 'function show({ requirement }: Finding) { return requirement; }').length === 1
      // …while an object LITERAL with those keys, a type literal and an equality test are not reads
      && ungated('x', 'save({ requirement: ownWords.requirement, observed: ownWords.observed });').length === 0
      && ungated('x', 'function g(f: { requirement?: unknown; observed?: unknown }) { return 1; }').length === 0
      && ungated('x', "if (key === 'requirement') { skip(); }").length === 0
      && ungated(INDEX, `  ${NOT_SHOWN[INDEX][0][0]}  `).length === 0 && ungated(INDEX, NOT_SHOWN[INDEX][0][0].replace('data.', 'raw.')).length === 1);
  for (const [file, src] of surfaces) {
    const bad = ungated(file, src);
    ok(`${file}: every requirement / observed line from an AI result passes the own-words gate before it is shown, saved or filed`, src.length > 0 && bad.length === 0, bad.join(' | '));
  }
  // THE SAVED CHECK SHEET (components/codeThread, outside this lane). It prints
  // and files the requirement line of a saved Code Check: the raw line for a
  // check saved before the gate, MAGE's stand-in notice for a row withheld
  // since. Its gate is a patch for the integrator (SAVED_SHEET_PATCH). Not
  // applied: said out loud below, and a FAILURE under --require-optin. Applied:
  // the file is one more surface of this sweep, and its rules are pinned.
  {
    if (!savedSheetGated) {
      savedSheetNotice = `NOT APPLIED: ${SAVED_SHEET} still prints and files a saved check's requirement line with no own-words gate.\n`
        + `  Apply ${SAVED_SHEET_PATCH}, then run this with --require-optin.`;
      if (process.argv.includes('--require-optin')) ok(`${SAVED_SHEET}: the saved check's requirement line passes the own-words gate (patch not applied)`, false, SAVED_SHEET_PATCH);
      else console.log(`  ! saved check sheet ${savedSheetNotice}`);
    } else {
      const bad = ungated(SAVED_SHEET, savedSheet);
      ok(`${SAVED_SHEET}: every requirement line of a saved check passes the own-words gate before it is shown or filed`, bad.length === 0, bad.join(' | '));
      ok('…through the kit’s gate at the card’s cap, and never a stand-in: words that pass print and file; anything else is the citation alone',
        savedSheet.includes("import { isStandInLine, passesEchoCheck } from '@/utils/codeCard/echoCheck';")
          && savedSheet.includes("return line.trim() && !isStandInLine(line.trim()) && passesEchoCheck(line, 400) ? line : '';")
          && savedSheet.includes('const words = savedRequirementWords(c.requirement);')
          && savedSheet.includes("return [c.code, c.section].filter(Boolean).join(' ') + (words ? `: ${words}` : '');")
          && (savedSheet.match(/\.requirement\b/g) ?? []).length === 2 && (savedSheet.match(/savedRequirementWords\b/g) ?? []).length === 3);
      ok('…and a row with no requirement in words offers no Permits / Punch / RFI buttons and says why, in the result screen’s own words',
        /\{s\.section === 'codes' && !s\.actionTexts\[i\] \? \(\s*<Text style=\{styles\.fine\} testID=\{`codethread-saved-no-actions-\$\{i\}`\}>\{SAVED_ROW_NO_ACTIONS\}<\/Text>\s*\) : \(\s*<CodeThreadActions/.test(savedSheet)
          && savedSheet.includes("export const SAVED_ROW_NO_ACTIONS = 'No actions for this line: it has no requirement in words to put in a permit, a punch item or an RFI.';"));
    }
  }
  ok('every NOT_SHOWN line is really in its file, once (a stale allow-list entry is a hole)',
    Object.entries(NOT_SHOWN).every(([file, lines]) => lines.every(([line]) => code(read(file)).split('\n').filter((l) => l.trim() === line).length === 1)),
    Object.entries(NOT_SHOWN).flatMap(([file, lines]) => lines.filter(([line]) => code(read(file)).split('\n').filter((l) => l.trim() === line).length !== 1).map(([line]) => `${file}: ${line.slice(0, 80)}`)).join(' | '));

  // The objects the sweep trusts are made by the gate and by nothing else.
  ok('`ownWords` (Plan Review list) is only ever the gate’s output for that finding',
    (index.match(/\bownWords = /g) ?? []).length === 1 && index.includes('const ownWords = planFindingOwnWords(f, passesEchoCheck);') && !/\blet ownWords\b|\bownWords\.\w+ = /.test(index)
      && !/\bownWords\b/.test(sweepPanel) && !/\bownWords\b/.test(askOutsidePure));
  ok('`row` (sweep rows) is only ever the gated view, and the RFI draft and the punch item are built from that same gated row',
    (sweepPanel.match(/\bconst row = /g) ?? []).length === 1
      && sweepPanel.includes('const row = sweepRowOwnWords(sweepFindingView(f, r.sheet, jurisdiction), passesEchoCheck);')
      && (sweepPanel.match(/\bonDraft\(/g) ?? []).length === 1 && sweepPanel.includes('onPress={() => onDraft(r.sheet, row, key)}')
      && (sweepPanel.match(/\bonPunch\(/g) ?? []).length === 1 && sweepPanel.includes('onPress={() => onPunch(r.sheet, row, key)}')
      && sweepPanel.includes('const onDraft = useCallback((sheet: PlanSheet, view: SweepFindingView, key: string) => {')
      && sweepPanel.includes('const onPunch = useCallback((sheet: PlanSheet, view: SweepFindingView, key: string) => {')
      && sweepPanel.includes('const rfi = addRFI(rfiFromSweepFinding(sheet, view, new Date(), sheetAttachmentFor(sheet)));')
      && sweepPanel.includes('const punch = punchFromSweepFinding(sheet, view, generateUUID(), new Date().toISOString());')
      && (sweepPanel.match(/rfiFromSweepFinding\(/g) ?? []).length === 1 && (sweepPanel.match(/punchFromSweepFinding\(/g) ?? []).length === 1
      && (sweepPanel.match(/sweepFindingView\(/g) ?? []).length === 2 && !/\brow\.\w+ = /.test(sweepPanel)
      && !/\brow\.(?:requirement|observed)\b/.test(index) && !/\brow\.(?:requirement|observed)\b/.test(askOutsidePure));
  ok('a sweep row whose own title is withheld offers no RFI draft and no punch item, and says why in their place',
    /\{row\.withheld \? \(\s*<Text style=\{styles\.blockedText\} testID=\{`plansweep-row-withheld-\$\{key\}`\}>\{SWEEP_ROW_WITHHELD\}<\/Text>\s*\) : done \? \(/.test(sweepPanel)
      && /\{row\.withheld \? null : punchDone \? \(/.test(sweepPanel)
      && sweepPanel.includes('{isCardPlaceholder(row.requirement) ? row.requirement : `${row.requirementLabel}: ${row.requirement}`}'));

  // Code Check: gated ONCE, at the door.
  ok('Code Check gates the AI’s result where it comes in: the ONLY result the screen ever holds is codeCheckOwnWords(…), and the saved check is built from it',
    /const data = codeCheckOwnWords\(res\.data as CodeCheckResult, passesEchoCheck\);\s+setResult\(data\);/.test(index)
      && (index.match(/res\.data as CodeCheckResult/g) ?? []).length === 1
      && (index.match(/\bsetResult\(/g) ?? []).every((_, i, all) => all.length === 2) && /\bsetResult\(null\);/.test(index) && !/\bsetResult\((?!null\)|data\))/.test(index)
      && between(index, 'const resultSnapshot: CodeCheckResultSnapshot = {', '};').includes('applicableCodes: data.applicableCodes.map('));
  const rm2 = between(index, 'function ResultModal(', 'function AccordionSection(');
  ok('a Code Check row with no requirement in words gets no Permits / Punch / RFI buttons, and the row says why; any other row hands them the GATED line',
    /\{savedRecord && project \? \(\s*isCardPlaceholder\(codeCheckPlainLine\(c\.requirement, passesEchoCheck\)\) \? \(\s*<Text style=\{styles\.codeTapHint\} testID=\{`code-check-no-actions-\$\{i\}`\}>\{CODE_ROW_NO_ACTIONS\}<\/Text>\s*\) : \(\s*<CodeThreadActions key=\{`codes-\$\{i\}-\$\{c\.requirement\}`\}/.test(rm2)
      && index.includes("const CODE_ROW_NO_ACTIONS = 'No actions for this line: it has no requirement in words to put in a permit, a punch item or an RFI.';")
      && (rm2.match(/text=\{c\.requirement\}/g) ?? []).length === 0);
  ok('the drill-in prompt never sends MAGE’s stand-in line as the requirement', rm2.includes("Summary requirement given: ${isCardPlaceholder(c.requirement) ? 'none' : c.requirement}\n"));
  ok('the hint above the Code Check rows promises only what a tap does: a card opens its detail; a plain row has the "What the inspector checks" toggle',
    rm2.includes("{anyCard ? 'Tap a card for what it requires and what the inspector checks.' : 'Tap What the inspector checks under a code for what it requires.'}")
      && !index.includes('Tap a code for') && rm2.includes("{isOpen ? 'Hide what the inspector checks' : 'What the inspector checks'}"));

  // Plan Review: gated where a review is saved, and again where the list prints.
  const runPlan = between(index, 'const runPlanReview = useCallback(async () => {', 'savePlanReview({ id: reviewId');
  ok('Plan Review saves a new review’s two AI lines through the gate (never the raw strings)',
    /\.\.\.planFindingOwnWords\(f, passesEchoCheck\),\s+severity: normalizeLevel\(f\.severity\),/.test(runPlan) && !/requirement: \(f\.requirement|observed: \(f\.observed/.test(index));
  const planList = between(index, '{(planDetailsOpen || planCards.length === 0) && SEVERITY_ORDER.map', '{/* UX wave B7');
  ok('…and the per-finding list prints the gated lines (a review saved before the gate holds the raw ones)',
    /\{group\.map\(\(f\) => \{[\s\S]{0,400}?const ownWords = planFindingOwnWords\(f, passesEchoCheck\);/.test(planList)
      && /\{ownWords\.requirement \? \(\s*<Text style=\{styles\.findingRequirement\}>\{ownWords\.requirement\}<\/Text>/.test(planList)
      && /\{ownWords\.observed \? \(\s*<Text style=\{styles\.findingObserved\}>\{`Observed: \$\{ownWords\.observed\}`\}<\/Text>/.test(planList)
      && !/\{f\.requirement\}|\$\{f\.observed\}/.test(index));
}

// ── 5. The client opt-in (four files this lane does NOT own) ──────────────
//
// Both functions send the code-card rows ONLY when the request asks for them
// (lane CCSERVER: `codeCards: true`), so that an old app build gets exactly
// what it always got. The two request helpers and their types are outside this
// lane, so the change is a patch for the integrator (OPTIN_PATCH below: the
// canonical copy in the session's codecard-specs/patches folder). THE RULE HERE:
//   - none of it applied: the surfaces still work (Ask shows prose, the sweep
//     shows every finding as "needs an answer"), but no Ask card and no
//     look-right row can ever appear. That is said out loud below, and it is a
//     FAILURE under --require-optin (the mode to register in ship-check once
//     the patch is in);
//   - any of it applied: ALL of it must be (a half-applied patch sends the
//     flag and drops the rows, or the reverse).
console.log('\n5. The client asks for the code-card rows (files outside this lane)');
/** The ONE canonical opt-in patch (the optional-lookRight version). An older copy under /private/tmp also applies cleanly: do not use it. */
const OPTIN_PATCH = '/Users/omirmajeed/.claude/projects/-Users-omirmajeed-Desktop-MAGE-ID---CLAUDE/f24f1ad8-bdb7-4740-9485-fd4d5f3a532b/codecard-specs/patches/CCWIRE-client-optin.diff';
let optInNotice = '';
{
  const requireOptIn = process.argv.includes('--require-optin');
  const answerSrc = read('utils/constructionAnswer.ts');
  const answerTypes = read('types/constructionAnswer.ts');
  const reviewer = read('utils/planCodeReviewer.ts');
  const run = read('utils/plans/planSweepRun.ts');
  // The same capture validate-code-check-honesty and validate-baltimore-ai pin
  // the request body with: a parenthesis inside the body would cut it short.
  const body = answerSrc.match(/body: JSON\.stringify\(([^)]*)\)/)?.[1] ?? '';
  const planReviewCall = between(index, 'await reviewPlanCode({', '});');
  const marks: [string, boolean][] = [
    ['Ask sends codeCards: true with the question (utils/constructionAnswer.ts)', /\bcodeCards: true,/.test(body)],
    ['…and the whole body is still one parenthesis-free object (the honesty validators capture it with [^)]*)',
      /question: req\.question/.test(body) && /jurisdiction: req\.jurisdiction \?\? null/.test(body) && /buildingRecord: req\.buildingRecord \?\? null/.test(body) && body.trim().endsWith('}')],
    ['the answer type carries the RAW rows: requirements?: unknown[] (types/constructionAnswer.ts)', /\brequirements\?: unknown\[\];/.test(answerTypes)],
    ['the sweep asks for the rows: sweep.codeCards: true (utils/plans/planSweepRun.ts)', /sweep: \{ scopeTargets: reasons\.map\(r => r\.topic\), codeCards: true \}/.test(run)],
    ["the run carries each sheet's look-right rows apart from its findings (planSweepRun.ts)", /reviewed\.push\(\{ sheet, reasons, findings: res\.findings, lookRight: res\.lookRight \?\? \[\] \}\)/.test(run)],
    ['reviewPlanCode returns the look-right rows (utils/planCodeReviewer.ts)', /lookRight: Array\.isArray\(data\.data\.lookRight\) \? data\.data\.lookRight : \[\]/.test(reviewer)],
    ['Plan Review (one sheet, in the tab) sends no sweep and no flag: its request is what it always was', !!planReviewCall && !/sweep|codeCards/.test(planReviewCall)],
  ];
  // The patch's validator pin: validate-plan-sweep hashes the Plan Review
  // prompt, and that prompt gained one line this round (short plain sentences,
  // no quotation marks, inches as in.). Until the patch is in, validate-plan-sweep
  // is red on those two hashes; with it, they are the two below.
  const planSweepPins = read('scripts/validate-plan-sweep.ts');
  const PLAN_PROMPT_SHA = ['742c854b31cc314bec0482bd56b38e49b0760772172935e095b12cb6b03e6efe', '0ac123f2d4a4ebfd85c9c1e3e109a8f9dc7f8e889b397be5217410ad158199e9'];
  const planPinsMoved = PLAN_PROMPT_SHA.every((h) => planSweepPins.includes(`'${h}',`));
  // The two checks that hold with or without the patch are not "applied" marks.
  const applied = [marks[0], marks[2], marks[3], marks[4], marks[5]].filter(([, on]) => on).length;
  if (applied === 0 && !requireOptIn) {
    ok(marks[1][0], marks[1][1]);
    ok(marks[6][0], marks[6][1]);
    optInNotice = 'NOT APPLIED: the app never asks either function for code-card rows, so Ask shows no cards and the sweep shows no "look right" rows in production.\n'
      + `  Apply ${OPTIN_PATCH} (4 client files + validate-plan-sweep's pins), then run this with --require-optin.`
      + (planPinsMoved ? '' : '\n  Until then validate-plan-sweep is red on its two Plan Review prompt hashes: the prompt gained one line this round, and the patch re-records them.');
    console.log(`  ! ${optInNotice}`);
  } else {
    for (const [name, on] of marks) ok(name, on);
    ok('validate-plan-sweep pins the Plan Review prompt WITH this round’s plain-sentence line (the patch re-records its two hashes)', planPinsMoved);
  }
}

if (optInNotice) console.log(`\n! client opt-in ${optInNotice}`);
if (savedSheetNotice) console.log(`\n! saved check sheet ${savedSheetNotice}`);
console.log(`\n${fail === 0 ? '✓' : '✗'} validate-code-card-wiring: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
