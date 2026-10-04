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
//   3. The construction-ai screen's own pure block (`// <pure:codeCardItems>`)
//      run under bun: every Code Check citation is a card, a line that reads
//      like code text is WITHHELD (never trimmed, never shown), the section is
//      never invented, the ladder's evidence rides on the card; Plan Review
//      findings get a status that never infers "looks right".
//   4. Source pins: the no-verbatim sentence in BOTH in-app prompts, the ICC
//      not-affiliated line beside the viewer buttons, recall in neutral grey
//      with the mismatch badge still amber, Ask renders cards only when the
//      answer carries usable requirements (else exactly the old prose) under
//      ONE JurisdictionBlock, every send opens HIS app, nothing calls a send
//      service.
//
// Pure: node:fs plus the pure utils. Run via: bun run scripts/validate-code-card-wiring.ts

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
import { parseCodeCardItem } from '../utils/codeCard/parse';
import { passesEchoCheck } from '../utils/codeCard/echoCheck';
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
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(`${m[1]}\nmodule.exports = { ${exportNames.join(', ')} };`);
  const mod: { exports: Record<string, unknown> } = { exports: {} };
  new Function('module', 'exports', js)(mod, mod.exports);
  return mod.exports;
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
  ok('blocked reason: no job says link a job', (askTownBlockedReason(null) ?? '').startsWith('Link a job first'));
  ok('blocked reason: Maryland points at its own button', (askTownBlockedReason(job({ location: 'Baltimore, MD 21218' })) ?? '').includes('Maryland'));
  ok('blocked reason: outside NY/NJ/CT says where it works', (askTownBlockedReason(job({ location: 'Portland, OR 97206' })) ?? '').includes('New York, New Jersey and Connecticut'));
  ok('blocked reason: a town job is not blocked', askTownBlockedReason(job({ location: '120 Main St, Massapequa, NY 11758' })) === null);

  const q = codeCardQuestion({ summary: 'Guards on every open side, at least 36 in. high.', section: 'R312.1', citedEdition: '2025 RCNYS' });
  ok('the card question carries our summary, the edition and the section', q.includes('Guards on every open side, at least 36 in. high (2025 RCNYS R312.1).'), q);
  ok('the card question says the section is AI recall and asks to confirm', q.includes('AI recall') && q.includes('confirm the section and edition you enforce'));
  ok('the card question quotes nothing', !/["“”]/.test(q));
  ok('a card with no section still reads cleanly', codeCardQuestion({ summary: 'Light at the top of the stair.', section: '' }).includes('Light at the top of the stair. MAGE'));
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

// ── 3. The screen's pure block ────────────────────────────────────────────
console.log('\n3. Code Check citations and Plan Review findings as cards');
const INDEX = 'app/(tabs)/construction-ai/index.tsx';
const index = read(INDEX);
ok(`${INDEX} is readable`, index.length > 0);
{
  const block = loadPure(index, 'codeCardItems', ['codeCheckCardItem', 'planFindingCardItem', 'CARD_WITHHELD']);
  ok('the screen marks codeCardItems as a pure block', !!block);
  if (block) {
    type CC = (c: Record<string, unknown>, i: number, ev: unknown, parse: typeof parseCodeCardItem, echo: typeof passesEchoCheck) => CodeCardItem;
    type PF = (f: Record<string, unknown>, cite: { citedCode: string; section: string }, ev: unknown, parse: typeof parseCodeCardItem, echo: typeof passesEchoCheck) => CodeCardItem;
    const cc = block.codeCheckCardItem as CC;
    const pf = block.planFindingCardItem as PF;
    const WITHHELD = block.CARD_WITHHELD as string;
    const ny = resolveCodeJurisdiction({ city: 'Massapequa', state: 'NY' });
    const ev = citationEvidenceFor(ny, '2025 RCNYS', 'R312.1');

    const a = cc({ code: '2025 RCNYS', section: 'R312.1', requirement: 'Sample: guards on open sides of a raised deck.' }, 0, ev, parseCodeCardItem, passesEchoCheck);
    ok('a citation is a card with our words, its section and its edition',
      a.id === 'cc-1' && a.summary === 'Sample: guards on open sides of a raised deck.' && a.section === 'R312.1' && a.citedEdition === '2025 RCNYS');
    ok("the ladder's evidence rides on the card", a.evidence === ev);
    ok("no verdict from the model → 'required'", a.verdict === 'required');
    ok('the stage is labelled a guess', a.stageIsGuess === true);

    const noSec = cc({ code: 'IRC', section: '', requirement: 'Sample: a handrail on the stair.' }, 1, null, parseCodeCardItem, passesEchoCheck);
    ok('a citation with no section keeps an EMPTY section (never a placeholder)', noSec.section === '' && noSec.id === 'cc-2');
    const shall = cc({ code: 'IRC', section: 'R312.1', requirement: 'Guards shall be provided where the walking surface is more than 30 inches above grade.' }, 2, null, parseCodeCardItem, passesEchoCheck);
    ok('a line with code phrasing ("shall") is WITHHELD, never shown', shall.summary === WITHHELD);
    const quoted = cc({ code: 'IRC', section: 'R312.1', requirement: 'The code says "guards are required".' }, 3, null, parseCodeCardItem, passesEchoCheck);
    ok('a quoted line is withheld', quoted.summary === WITHHELD);
    const long = cc({ code: 'IRC', section: 'R310.1', requirement: 'Every basement bedroom needs an egress window. The opening must be big enough to climb out of, low enough to reach, and open from inside without a key or tool. A well is needed when the sill is below grade.' }, 4, null, parseCodeCardItem, passesEchoCheck);
    ok('a long plain-English line (over 140, under 400) still shows in full, as this screen always did', long.summary.startsWith('Every basement bedroom'));
    ok('the withheld line names Official text', WITHHELD.includes('Official text') && WITHHELD.includes('read like code text'));

    const rich = cc({
      code: '2025 RCNYS', section: 'R312.1', requirement: 'Guards on every open side.', verdict: 'limit', stage: 'final',
      trigger: { value: 30, unit: 'in', comparison: '>' }, jobValue: { value: 34, unit: 'in', source: 'job', sourceLabel: 'deck height from the scenario' },
      whatToBuild: ['A guard on every open side.', 'Guards shall be 36 in.'], why: 'Your deck is 34 in. up.',
    }, 5, null, parseCodeCardItem, passesEchoCheck);
    ok("the model's verdict is kept when it is one of the three", rich.verdict === 'limit');
    ok('a structured trigger and job value are kept', rich.trigger?.value === 30 && rich.jobValue?.value === 34);
    ok('a what-to-build line with code phrasing is dropped, the rest kept', JSON.stringify(rich.whatToBuild) === JSON.stringify(['A guard on every open side.']));
    ok('the stage is kept and still a guess', rich.stage === 'final' && rich.stageIsGuess === true);
    const junk = cc({ code: 'IRC', section: 'R312.1', requirement: 'Guards.', trigger: { value: 'thirty', unit: 'in', comparison: '>' }, verdict: 'maybe' }, 6, null, parseCodeCardItem, passesEchoCheck);
    ok('an unstructured trigger is dropped (no tape from guessed numbers)', junk.trigger === undefined);
    ok("an unknown verdict falls back to 'required'", junk.verdict === 'required');

    const f1 = pf({ id: 'f1', requirement: 'Sample: baluster spacing.', observed: 'Sample: drawn 4½ in. apart', confidence: 'high', status: 'open' }, { citedCode: 'RCNYS 2025', section: 'R312.1.3' }, ev, parseCodeCardItem, passesEchoCheck);
    ok("a confident finding is 'fix'", f1.status === 'fix' && f1.section === 'R312.1.3' && f1.citedEdition === 'RCNYS 2025');
    ok('what the drawing shows rides as observed', f1.observed === 'Sample: drawn 4½ in. apart');
    const f2 = pf({ id: 'f2', requirement: 'Sample: stair handrail.', confidence: 'low', status: 'open' }, { citedCode: '', section: '' }, null, parseCodeCardItem, passesEchoCheck);
    ok("a low-confidence finding is 'ask' (needs an answer first)", f2.status === 'ask' && f2.citedEdition === undefined && f2.section === '');
    const f3 = pf({ id: 'f3', requirement: 'Sample.', confidence: 'high', status: 'resolved' }, { citedCode: 'IRC', section: '' }, null, parseCodeCardItem, passesEchoCheck);
    ok("a finding he marked resolved is NOT turned into 'ok' (the AI's read is never an approval)", f3.status === 'fix');
    const f4 = pf({ id: 'f4', requirement: 'Sample.', confidence: 'low', cardStatus: 'ok' }, { citedCode: 'IRC', section: '' }, null, parseCodeCardItem, passesEchoCheck);
    ok("a server card status is used as sent", f4.status === 'ok');
  }
}

// ── 4. Source pins ────────────────────────────────────────────────────────
console.log('\n4. The wiring, in the source');
const NO_VERBATIM = 'Write every requirement in your own words. Never quote or reproduce the text of any model code (ICC, NFPA) word for word.';
{
  ok('both in-app prompts (Code Check + drill-in) carry the no-verbatim sentence', index.split(NO_VERBATIM).length - 1 === 2, `found ${index.split(NO_VERBATIM).length - 1}`);
  const main = between(index, 'A contractor is working on the following project and needs a building-code sanity check.', "const cacheKey = `code_check::");
  ok('the Code Check prompt asks for the structured card fields', /verdict \("required", "limit" or "not_required"\)/.test(main) && /stage \(your best guess of the inspection/.test(main) && /trigger \(\{ value, unit/.test(main));
  ok('the Code Check prompt caps the requirement at 140 characters', main.includes('requirement (plain English, one sentence, at most 140 characters)'));
  const drill = between(index, 'A contractor ran a code check and wants to understand ONE specific code citation in depth.', 'const cacheKey = `code_detail::');
  ok('the drill-in prompt carries the sentence too', drill.includes(NO_VERBATIM));

  const viewer = between(index, 'function ViewerLinks(', 'function RungBadge(');
  ok("the ICC line sits inside ViewerLinks, after the buttons", viewer.indexOf('<Text style={styles.viewerLinkNote}>{ICC_VIEWER_NOTE}</Text>') > viewer.indexOf('{links.map('));
  ok('the ICC line is the founder-approved wording', index.includes(`const ICC_VIEWER_NOTE = "Opens ICC's free public viewer. MAGE ID is not affiliated with or endorsed by ICC.";`));
  ok('ViewerLinks still renders nothing with no links (the line never stands alone)', /if \(links\.length === 0\) return null;/.test(viewer));

  ok('recall chip: neutral grey fill and ink', /recallChip: \{[^}]*backgroundColor: themeColors\.neutralSoft/.test(index) && /recallChipText: \{[^}]*color: themeColors\.textSecondary/.test(index));
  ok('recall rung badge: neutral grey', /rungRecall: \{ backgroundColor: themeColors\.neutralSoft \}/.test(index) && /rungRecallText: \{ color: themeColors\.textSecondary \}/.test(index));
  ok('the edition-mismatch badge (a real warning) stays amber, twice', (index.match(/styles\.rungBadge, styles\.rungWarn, styles\.rungMismatchBadge/g) ?? []).length === 2 && /rungWarnText: \{ color: themeColors\.warningLabel \}/.test(index));
  ok('the recall words are unchanged (Code Check and Plan Review)', (index.match(/From model recall — verify with your AHJ before relying on a section number/g) ?? []).length === 2);

  const rm = between(index, 'function ResultModal(', 'function AccordionSection(');
  ok('every citation renders a CodeCard from its own card item', /cards\[i\] \? \(\s*<CodeCard/.test(rm) && /codeCheckCardItem\(c as Record<string, unknown> & typeof c, i, evidence\[i\] \?\? null, parseCodeCardItem, passesEchoCheck\)/.test(rm));
  ok('the drill-in toggle and the rung badge stay with each citation', rm.includes('testID={`code-detail-toggle-${i}`}') && rm.includes('{ev ? <RungBadge ev={ev} testID={`code-check-rung-${i}`} /> : null}'));
  ok("the card's overlay renders inside the result sheet's tree", rm.includes('{cards.length > 0 ? wiring.overlay : null}'));

  const plan = between(index, "mode === 'plan' ? (", "mode === 'ask' ? (");
  ok('Plan Review renders a plan-mode CodeCardList BELOW the recall chip', plan.indexOf('<CodeCardList') > plan.indexOf('testID="plan-review-recall-chip"') && /mode="plan"/.test(plan));
  ok('the architect email opens HIS Mail (mailto), nothing is sent from here', /void Linking\.openURL\(mailtoUrlFor\('', msg\.subject, msg\.body\)\)/.test(index));
  ok('an edition mismatch count shows on the details toggle even when it is shut', plan.includes('edition mismatch'));
  ok('only OPEN findings are carded (resolved / dismissed are handled, never "to fix")', /\.filter\(\(f\) => f\.status === 'open'\)/.test(index));
  ok('with no open finding the per-finding list shows on its own', /\{\(planDetailsOpen \|\| planCards\.length === 0\) && SEVERITY_ORDER\.map/.test(index));

  const ask = read('components/construction/AskConstructionMode.tsx');
  ok('Ask is readable', ask.length > 0);
  ok('Ask parses requirements with parseCodeCardItems and attaches the evidence SENT with the question',
    /attachEvidence\(parseCodeCardItems\(raw\), askedFor\.resolved\)/.test(ask));
  ok('Ask renders the cards ONLY when there is at least one usable requirement', /\{cards\.length > 0 && cardInfo \? \(/.test(ask));
  ok('ONE JurisdictionBlock per answer', (ask.match(/<JurisdictionBlock\b/g) ?? []).length === 1);
  ok('the prose answer is still rendered first, unchanged', ask.indexOf('<Text style={styles.answerText} selectable>{result.answer}</Text>') >= 0
    && ask.indexOf('<Text style={styles.answerText} selectable>{result.answer}</Text>') < ask.indexOf('testID="construction-ask-code-cards"'));
  ok('the jurisdiction is snapshotted at ask time', /setAskedFor\(\{\s*project: linkedProject,/.test(ask));
  ok('a sub is texted from HIS Messages (sms: via Linking)', /const url = smsUrlFor\(recipient\.phone, text, Platform\.OS\);/.test(ask) && /void Linking\.openURL\(url\)/.test(ask));
  ok('a sub with no phone says why', ask.includes("has no phone number in Subs"));
  ok('Checklist pins to the job (pins store), blocked with a reason without a job',
    /pinStore\.dispatch\(\{ type: 'pin', pin: makePin\(projectId, item, new Date\(\), stageOf\(item\)\) \}\)/.test(ask) && /blockedAction\(NO_JOB_CHECKLIST\)/.test(ask));
  ok('Save keeps the card on the job (saved store)', /savedStore\.dispatch\(\{ type: 'save', card: makeSaved\(/.test(ask));
  ok('Ask town opens Draft a question (his own Mail) or says why it cannot', /askTownBlockedReason\(project\)/.test(ask) && /<DraftQuestionButton[\s\S]*?hideTrigger[\s\S]*?initialQuestion=\{ask\.question\}/.test(ask));
  ok('the opened card closes before the town draft opens (one sheet at a time)', /setOpenItem\(null\);\s*setTimeout\(\(\) => openAsk\(item\), SHEET_HANDOFF_MS\);/.test(ask));

  const dq = read('components/buildingRecord/DraftQuestionButton.tsx');
  ok('the town branch routes with routeOfficeQuestion', /routeOfficeQuestion\(office\)/.test(dq));
  ok('the town branch is decided before any hook, by askTownKind', /if \(project && askTownKind\(project\) === 'town'\) \{/.test(between(dq, 'export function DraftQuestionButton(', 'function DraftQuestionInner(')));
  ok('a town that cannot be found says so instead of opening nothing', dq.includes("'Town not found'"));

  const files = [INDEX, 'components/construction/AskConstructionMode.tsx', 'components/buildingRecord/DraftQuestionButton.tsx', 'components/inspectionPrep/InspectionReadySheet.tsx'];
  for (const f of files) {
    const src = read(f);
    ok(`${f}: no send service (functions.invoke send / send-email / emailService)`, !/send-email|emailService|sendEmail/.test(src) && !/functions\.invoke\(['"]send/.test(src));
  }

  const sheet = read('components/inspectionPrep/InspectionReadySheet.tsx');
  ok('Inspection Ready reads the pins through pinnedPrepItems(pinsFor(...))', /pinnedPrepItems\(pinsFor\(pinsState, project\.id\), inspection\)/.test(sheet));
  ok('the pinned group renders only when there are pins (byte-identical otherwise)', /\{pinned\.length > 0 \? \(\s*<View style=\{s\.section\} testID="inspection-prep-pinned">/.test(sheet));
  ok('the pinned group comes after the photo-check group and before "How did it go?"',
    sheet.indexOf('testID="inspection-prep-pinned"') > sheet.indexOf('testID="codelook-prep-extras"') && sheet.indexOf('testID="inspection-prep-pinned"') < sheet.indexOf('testID="inspection-prep-result"'));
}

console.log(`\n${fail === 0 ? '✓' : '✗'} validate-code-card-wiring: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
