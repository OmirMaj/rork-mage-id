// validate-tutorial-learn-a.ts — lane A's three tutorials (estimate-first,
// change-order-draft, field-ticket-log) are honest, and their fixtures foot.
//
// What it pins, in the order it fails:
//
//   1. FIXTURES (executed). The sample scope normalizes equal to itself and
//      to a re-cased / re-spaced copy, and NOT to an edit; the bundled wizard
//      answer is the sample job's own 8 lines at cost, in integer cents, and
//      every total is the sum of its lines; priced at the sample's 25 % markup
//      it is exactly the seeded $422,400; it passes the wizard's own zod
//      schema; the seeded answers clear the wizard's required steps and stop
//      at the scope; the change-order line is whole cents; the ticket sample
//      uses a real reason chip and trade, and makes a ticket the screen's own
//      readiness rule accepts.
//   2. DEFS. The three defs exist with the spec's titles, endings, groups,
//      practice features and the exact save-step copy; no signal is outbound.
//   3. SCREENS (source scan, comments stripped).
//      • estimate-wizard: on a sample during a run the AI call site is
//        UNREACHABLE — generate() returns into the fixture BEFORE checkAILimit
//        and mageAISmart; the fixture path calls no AI, no meter and writes
//        nothing; the sample run needs the run's sandbox AND a sample; the save
//        writes only estimateVersions when the job has an estimate (never over
//        the seeded one) and signals AFTER the write; a fixture result is never
//        offered to another project and is never guarded as unsaved work.
//      • change-order / field-ticket: the practice pass opens only a NEW
//        record or one whose own project is the sample; the success signals
//        follow the real local write; the voice fill and AI impact step aside
//        during a run; no handler a signature runs through emits a signal.
//      • every <TutorialTarget> in the three screens is conditional on the run
//        being live on that job (so a real job, and every phone golden,
//        renders byte-identical), and none wraps a send or signature control.
//
// MUTATION PLANTS (each must turn this red; restore byte-identical, then cmp):
//   • fixturesA.ts  SAMPLE_WIZARD_CONTINGENCY_CENTS = 0 → 100      → "totals foot"
//   • fixturesA.ts  normalizeScope drops .toLowerCase()            → "re-cased copy"
//   • estimate-wizard.tsx moves `if (sampleRunRef.current) { … }` below
//     checkAILimit                                                  → "AI call site is unreachable"
//   • field-ticket.tsx drops `pickedProjectId == null &&`            → "practice pass … ticket"
//
// Pure node:fs + direct imports of pure modules (no react-native — that
// crashes bun). fileURLToPath + join because the repo path has a space.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CO_SAMPLE, CO_SAMPLE_LINE_COST_CENTS, SAMPLE_SCOPE, SAMPLE_SCOPE_STEP_ID, SAMPLE_WIZARD_ANSWERS,
  SAMPLE_WIZARD_CONTINGENCY_CENTS, SAMPLE_WIZARD_LINES_CENTS, SAMPLE_WIZARD_PERMITS_CENTS,
  SAMPLE_WIZARD_SUBTOTAL_CENTS, SAMPLE_WIZARD_TOTAL_CENTS, TICKET_SAMPLE,
  isSampleScope, normalizeScope, sampleWizardResult, toCents,
} from '../utils/tutorial/learn/fixturesA';
import { LANE_A_DEFS, LANE_A_SIGNALS, LANE_A_TARGETS } from '../utils/tutorial/learn/laneA';
import { SAMPLE_ESTIMATE_LINES, SAMPLE_ESTIMATE_TOTAL } from '../utils/tutorial/fixtures';
import { PROJECT_TYPES, SCOPE_STEPS, estimateSchema, stepCanAdvance, type WizardAnswers } from '../utils/scopeQuestions';
import { priceCostBreakdown } from '../utils/estimateMarkup';
import { checkFieldTicketReadiness } from '../utils/fieldTicketCore';
import type { FieldTicket } from '../types';
import type { TutorialDef } from '../utils/tutorial/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
// Block comments, JSX comments and whole-line // comments.
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}

/** The body of `const name = useCallback(…)` (balanced parens from its open). */
function callbackBody(src: string, name: string): string {
  const at = src.indexOf(`const ${name} = useCallback(`);
  if (at < 0) return '';
  let depth = 0;
  for (let i = src.indexOf('(', at); i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  return '';
}

// ── 1. fixtures ─────────────────────────────────────────────────────────────
console.log('lane A tutorials\nfixtures');
{
  ok('the sample scope normalizes equal to itself', isSampleScope(SAMPLE_SCOPE) && normalizeScope(SAMPLE_SCOPE) === normalizeScope(SAMPLE_SCOPE));
  ok('…and to a re-cased, re-spaced, re-punctuated copy',
    isSampleScope(`  ${SAMPLE_SCOPE.toUpperCase().replace(/\. /g, ' — ')}  `) && isSampleScope(SAMPLE_SCOPE.toLowerCase().replace(/\s+/g, '   ')));
  ok('…and NOT to an edit (his own words run the refusal, never the fixture)',
    !isSampleScope(SAMPLE_SCOPE.replace('two hall baths', 'one hall bath')) && !isSampleScope(`${SAMPLE_SCOPE} Add a deck.`) && !isSampleScope('') && !isSampleScope('Gut the kitchen'));

  const lines = SAMPLE_WIZARD_LINES_CENTS;
  ok('the wizard answer is the sample job\'s 8 lines, by name and category',
    lines.length === 8 && lines.every((l, i) => l.description === SAMPLE_ESTIMATE_LINES[i].name && l.category === SAMPLE_ESTIMATE_LINES[i].category));
  ok('every line is integer cents and total = quantity × unit cost',
    lines.every(l => Number.isInteger(l.unitCostCents) && Number.isInteger(l.totalCents) && l.totalCents === l.unitCostCents * l.quantity && l.totalCents > 0));
  const sum = lines.reduce((s, l) => s + l.totalCents, 0);
  ok('totals foot: lines → subtotal → subtotal + contingency + permits = total',
    sum === SAMPLE_WIZARD_SUBTOTAL_CENTS
      && SAMPLE_WIZARD_TOTAL_CENTS === SAMPLE_WIZARD_SUBTOTAL_CENTS + SAMPLE_WIZARD_CONTINGENCY_CENTS + SAMPLE_WIZARD_PERMITS_CENTS
      && SAMPLE_WIZARD_CONTINGENCY_CENTS === 0 && SAMPLE_WIZARD_PERMITS_CENTS === 0,
    `lines ${sum}, subtotal ${SAMPLE_WIZARD_SUBTOTAL_CENTS}, total ${SAMPLE_WIZARD_TOTAL_CENTS}, contingency ${SAMPLE_WIZARD_CONTINGENCY_CENTS}, permits ${SAMPLE_WIZARD_PERMITS_CENTS}`);
  ok('it is the job at COST: $337,920.00 (the seeded $422,400 before its 25 % markup)', SAMPLE_WIZARD_TOTAL_CENTS === 33_792_000, String(SAMPLE_WIZARD_TOTAL_CENTS));

  const r = sampleWizardResult();
  const rLineCents = r.lineItems.reduce((s, l) => s + toCents(l.total), 0);
  ok('sampleWizardResult(): the same lines in dollars, footing to the cent',
    r.lineItems.length === 8 && rLineCents === SAMPLE_WIZARD_SUBTOTAL_CENTS && toCents(r.subtotal) === SAMPLE_WIZARD_SUBTOTAL_CENTS
      && toCents(r.total) === toCents(r.subtotal) + toCents(r.contingency) + toCents(r.permits)
      && r.lineItems.every(l => toCents(l.total) === toCents(l.unitCost) * l.quantity));
  ok('…invents no confidence and no AI refine questions, and is a fresh object per call',
    r.confidence === undefined && r.refineWith.length === 0 && sampleWizardResult() !== r && sampleWizardResult().lineItems !== r.lineItems);
  const parsed = estimateSchema.safeParse(r);
  ok('…passes the wizard\'s own result schema unchanged', parsed.success && toCents(parsed.data.total) === SAMPLE_WIZARD_TOTAL_CENTS);
  const priced = priceCostBreakdown(r, 25);
  ok('priced at the sample\'s 25 % markup it is exactly the seeded $422,400', toCents(priced.total) === SAMPLE_ESTIMATE_TOTAL * 100, String(toCents(priced.total)));
  ok('priced with no markup decided it is the cost, unchanged', toCents(priceCostBreakdown(r, null).total) === SAMPLE_WIZARD_TOTAL_CENTS);

  const scopeIdx = SCOPE_STEPS.findIndex(s => s.key === SAMPLE_SCOPE_STEP_ID);
  const seeded: WizardAnswers = { ...SAMPLE_WIZARD_ANSWERS, scope: '' };
  ok('the seeded answers clear every required step before the scope, and stop AT the scope',
    scopeIdx > 0 && Array.from({ length: scopeIdx }, (_, i) => i).every(i => stepCanAdvance(i, seeded)) && !stepCanAdvance(scopeIdx, seeded)
      && stepCanAdvance(scopeIdx, { ...seeded, scope: SAMPLE_SCOPE }));
  ok('the seeded type is a real chip and the location is a market, never a street address',
    (PROJECT_TYPES as readonly string[]).includes(SAMPLE_WIZARD_ANSWERS.projectType) && !/\d/.test(SAMPLE_WIZARD_ANSWERS.location));

  ok('the change-order line is whole cents: quantity × unit cost = $425.00',
    Number.isInteger(CO_SAMPLE.line.unitCostCents) && CO_SAMPLE_LINE_COST_CENTS === CO_SAMPLE.line.quantity * CO_SAMPLE.line.unitCostCents && CO_SAMPLE_LINE_COST_CENTS === 42_500);
  ok('the change-order description is the spec\'s sentence', CO_SAMPLE.description === 'Add a recessed light over the island');

  const ft = read('app/field-ticket.tsx');
  const chips = (re: RegExp) => (re.exec(ft)?.[1] ?? '').match(/'([^']+)'/g)?.map(x => x.slice(1, -1)) ?? [];
  ok('the ticket reason is one of the screen\'s REASON_CHIPS (saved verbatim)', chips(/const REASON_CHIPS = \[([\s\S]*?)\] as const;/).includes(TICKET_SAMPLE.reason));
  ok('the ticket labor trade is one of the screen\'s TRADE_CHIPS', chips(/const TRADE_CHIPS = \[([\s\S]*?)\] as const;/).includes(TICKET_SAMPLE.labor.trade));
  const draft = {
    id: 'pending', number: 1, projectId: 'sample', date: '2026-10-01',
    workDescription: TICKET_SAMPLE.work, reasonExtra: TICKET_SAMPLE.reason,
    labor: [{ id: 'l1', workerName: '', trade: TICKET_SAMPLE.labor.trade, hours: TICKET_SAMPLE.labor.hours }],
    materials: [], equipment: [], photos: [], markupPercent: 0, status: 'draft', createdAt: '', updatedAt: '',
  } as unknown as FieldTicket;
  const ready = checkFieldTicketReadiness(draft);
  ok('the ticket sample (work + reason + its one labor row) is a ticket the screen can Save', ready.ready, ready.missing.join(', '));
  ok('…and without the labor row it is not (the assist adds it for a reason)', !checkFieldTicketReadiness({ ...draft, labor: [] }).ready);
}

// ── 2. defs ─────────────────────────────────────────────────────────────────
console.log('defs');
{
  const byId = new Map<string, TutorialDef>(LANE_A_DEFS.map(d => [d.id, d]));
  const spec: [string, string, string, number, string, string[]][] = [
    ['estimate-first', 'Price a job from a scope', 'A priced estimate saved on the sample job', 45, 'bid', []],
    ['change-order-draft', 'Write a change order', 'A draft change order with its price and days', 40, 'money', ['change_orders_invoicing']],
    ['field-ticket-log', 'Log extra work on a field ticket', 'An unsigned ticket you can price or sign later', 35, 'site', ['change_orders_invoicing']],
  ];
  for (const [id, title, endsWith, seconds, group, practice] of spec) {
    const d = byId.get(id);
    ok(`${id}: title, ending, seconds, group, sandbox, practice features`,
      !!d && d.title === title && d.endsWith === endsWith && d.seconds === seconds && d.group === group && d.sandbox === 'sarahs-place'
        && JSON.stringify([...d.practiceFeatures]) === JSON.stringify(practice) && d.needs.length === 0,
      d ? JSON.stringify({ title: d.title, endsWith: d.endsWith, seconds: d.seconds, group: d.group, practice: d.practiceFeatures }) : 'missing');
  }
  ok('LANE_A_DEFS is exactly the three, in order', LANE_A_DEFS.map(d => d.id).join(',') === 'estimate-first,change-order-draft,field-ticket-log');
  const detailOf = (id: string, step: string) => {
    const s = byId.get(id)?.steps.find(x => x.id === step);
    return typeof s?.detail === 'string' ? s.detail : null;
  };
  ok('the change-order save step says sending is the real-job step', detailOf('change-order-draft', 'co-save') === 'Saved as a draft. Sending to a client happens on a real job.');
  ok('the ticket save step says it is saved unsigned', detailOf('field-ticket-log', 'ticket-save') === 'Saved unsigned. Get it signed on site when the work is done.');
  ok('no lane A signal is outbound', Object.values(LANE_A_SIGNALS).every(s => s.outbound === false));
  ok('the ticket-saved signal is never a signature (signed is part of its payload, always false at the emit)',
    /tutorialSignal\('ticket\.saved', \{[^}]*signed: false/.test(strip(read('app/field-ticket.tsx'))));
  const lit = LANE_A_DEFS.flatMap(d => d.steps.flatMap(s => (Array.isArray(s.target) ? s.target : s.target ? [s.target] : []) as string[]));
  // Every lit id's registry note names the control it wraps first; none of
  // them may be a send, a share or a signature control.
  const litBad = lit.filter(t => /\.(send|sign|getSignature|share)/i.test(t)
    || /^(send-co-btn|ticket-get-signature|ticket-sign|wizard-share)\b/.test((LANE_A_TARGETS as Record<string, { note: string } | undefined>)[t]?.note ?? ''));
  ok('no step lights a send or signature control', lit.length > 0 && litBad.length === 0, litBad.join(', '));
}

// ── 3. screens ──────────────────────────────────────────────────────────────
console.log('screens');
const EW = strip(read('app/estimate-wizard.tsx'));
const CO = strip(read('app/change-order.tsx'));
const FT = strip(read('app/field-ticket.tsx'));
{
  const gen = callbackBody(EW, 'generate');
  const early = gen.indexOf('if (sampleRunRef.current) { runSampleFixture(answersOverride ?? answers); return; }');
  ok('estimate-wizard: on a sample during a run the AI call site is unreachable (the fixture return comes BEFORE checkAILimit and mageAISmart)',
    gen.length > 0 && early > 0 && early < gen.indexOf('checkAILimit(') && early < gen.indexOf('mageAISmart('),
    `early ${early}, checkAILimit ${gen.indexOf('checkAILimit(')}, mageAISmart ${gen.indexOf('mageAISmart(')}`);
  ok('…and generate() is the screen\'s ONLY AI call site', (EW.match(/mageAISmart\(/g) ?? []).length === 1 && (EW.match(/checkAILimit\(/g) ?? []).length === 1);
  const fixture = callbackBody(EW, 'runSampleFixture');
  ok('…the fixture path calls no AI, spends no meter and writes nothing',
    fixture.length > 0 && !/mageAI|checkAILimit|recordAIUsage|commitAutoLink|updateProject|addProject/.test(fixture) && /sampleWizardResult\(\)/.test(fixture) && /isSampleScope\(a\.scope\)/.test(fixture));
  ok('…a scope that is not the sample sentence is refused with the reason (a literal t() key)',
    fixture.includes("t('common.tutorial.estimateSampleScopeOnly', 'On the sample, use the sample scope. Your own scopes build on a real job.')"));
  ok('…the sample run needs the run\'s sandbox to BE this project AND a sample job',
    /const runOnThis = !!projectId && tutorialSandboxId === projectId;/.test(EW) && /const sampleRun = runOnThis && !!scopedProject && isSampleProject\(scopedProject\);/.test(EW));
  ok('…the generated signal is the fixture\'s only (source sample)', (EW.match(/tutorialSignal\('estimate\.generated'/g) ?? []).length === 1 && /tutorialSignal\('estimate\.generated'/.test(fixture));
  const save = callbackBody(EW, 'saveSampleEstimate');
  ok('estimate-wizard: the save is sample-only and never over the seeded estimate (only estimateVersions written when one exists)',
    /if \(!target \|\| !isSampleProject\(target\)\) return;/.test(save) && /if \(!costResult \|\| !fixtureRun \|\| !projectId\) return;/.test(save)
      && /\? \{ estimateVersions: commitEstimatePatch\(\{ \.\.\.target, linkedEstimate: practice \}, target\.linkedEstimate, opts\)\.estimateVersions \}/.test(save));
  ok('…and signals only AFTER the write', save.indexOf('updateProject(projectId, patch)') > 0 && save.indexOf("tutorialSignal('estimate.saved'") > save.indexOf('updateProject(projectId, patch)'));
  ok('…a fixture result is never offered to another project and never guarded as unsaved work',
    /\{fixtureRun \? \(\(\) => \{/.test(EW) && EW.indexOf('{fixtureRun ? (() => {') < EW.indexOf('testID="wizard-save-to-project"')
      && /unsavedRef\.current = !!costResult && !attachedIdRef\.current && !fixtureRun;/.test(EW));
  ok('…the fixture result carries the honesty chip, not a grounding claim', /ground=\{fixtureRun\s*\? SAMPLE_NO_CREDITS_LABEL/.test(EW));
  ok('…a sample run replaces nothing, so it asks no "Replace" confirm and names no free runs',
    /existingEstimateTotal == null \|\| costResult \|\| sampleRunRef\.current/.test(EW) && (EW.match(/!sampleRun && freeRunsLabel\(freeRunsLeft\) \? ` · \$\{freeRunsLabel\(freeRunsLeft\)\}` : ''/g) ?? []).length === 3
      && !/\brunsLabel\b/.test(EW));

  ok('change-order: the practice pass opens only a NEW change order or one of the sample\'s own',
    /const practice = useTutorialPractice\(paramProjectId \|\| undefined\);/.test(CO)
      && /const practiceOpen = practice\.has\('change_orders_invoicing'\)\s*&& \(!coId \|\| changeOrders\.find\(c => c\.id === coId\)\?\.projectId === paramProjectId\);/.test(CO)
      && /return practiceOpen \? <ChangeOrderGate \/> : \(\s*<Paywall/.test(CO));
  const coSave = callbackBody(CO, 'handleSave');
  ok('change-order: co.saved follows the real local write and comes before the back',
    coSave.indexOf('if (!saved) return;') > 0 && coSave.indexOf("tutorialSignal('co.saved'") > coSave.indexOf('if (!saved) return;') && coSave.indexOf("tutorialSignal('co.saved'") < coSave.indexOf('goBack();'));
  ok('change-order: the voice fill and the AI impact analysis step aside during a run',
    /\{runOnThis \? null : \(\s*<InlineVoiceFill/.test(CO) && /\{runOnThis \? null : \(\s*<View style=\{\{ paddingHorizontal: 16 \}\}>\s*<AIChangeOrderImpact/.test(CO));
  ok('change-order: the assists fill a sample only', (CO.match(/if \(!sampleRunRef\.current\) return;/g) ?? []).length === 2);

  ok('field-ticket: the practice pass opens only the sample\'s own tickets, never after a pick',
    /const practice = useTutorialPractice\(paramProjectId \|\| undefined\);/.test(FT)
      && /const practiceOpen = practice\.has\('change_orders_invoicing'\) && pickedProjectId == null\s*&& \(!ticketId \|\| fieldTickets\.find\(x => x\.id === ticketId\)\?\.projectId === paramProjectId\);/.test(FT)
      && /if \(practiceOpen\) \{\s*\} else\s*if \(!canAccess\('change_orders_invoicing'\)\) \{\s*return \(\s*<FieldTicketAccessView/.test(FT));
  const ftSave = callbackBody(FT, 'handleSaveUnsigned');
  ok('field-ticket: ticket.saved follows addFieldTicket', ftSave.indexOf('addFieldTicket(ticket)') > 0 && ftSave.indexOf("tutorialSignal('ticket.saved'") > ftSave.indexOf('addFieldTicket(ticket)'));
  ok('field-ticket: no signature path emits a tutorial signal', !/tutorialSignal\(/.test(callbackBody(FT, 'handleSign')) && !/tutorialSignal\(/.test(callbackBody(FT, 'onSignDone')));
  ok('field-ticket: the assists fill a sample only', (FT.match(/if \(!ticketTutorialRef\.current\.sample\) return;/g) ?? []).length === 2);

  // Every wrapper is conditional on the run, and none wraps send / sign.
  for (const [file, src] of [['app/estimate-wizard.tsx', EW], ['app/change-order.tsx', CO], ['app/field-ticket.tsx', FT]] as const) {
    const bad: string[] = [];
    const wrapsBad: string[] = [];
    const re = /<TutorialTarget\b[^>]*\bid="([^"]+)"/g;
    let m: RegExpExecArray | null;
    let n = 0;
    while ((m = re.exec(src))) {
      n++;
      const before = src.slice(Math.max(0, m.index - 420), m.index);
      if (!/runOnThis/.test(before)) bad.push(m[1]);
      const close = src.indexOf('</TutorialTarget>', m.index);
      const selfClosing = /\/>$/.test(src.slice(m.index, src.indexOf('>', m.index) + 1));
      const inner = selfClosing || close < 0 ? '' : src.slice(m.index, close);
      // A wrapper around a const (`{btn}`) is checked through the const itself.
      const ref = /^\s*\{(\w+)(\(\w*\))?\}\s*$/.exec(inner.slice(inner.indexOf('>') + 1));
      const body = ref ? (new RegExp(`const ${ref[1]} = [\\s\\S]*?\\n\\s*\\);`).exec(src.slice(Math.max(0, m.index - 4000), m.index))?.[0] ?? '') : inner;
      if (/testID="(send-co-btn|ticket-get-signature|ticket-sign|ticket-sign-existing|wizard-share|invoice-send)"/.test(body)) wrapsBad.push(m[1]);
    }
    ok(`${file}: every TutorialTarget (${n}) renders only while a run is live on this job`, n > 0 && bad.length === 0, bad.join(', '));
    ok(`${file}: no TutorialTarget wraps a send or signature control`, wrapsBad.length === 0, wrapsBad.join(', '));
  }
  ok('estimate-wizard: its spotlight layer is mounted inside the modal, during a run only', (EW.match(/\{runOnThis \? <TutorialLayer host="estimateWizard" \/> : null\}/g) ?? []).length === 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
