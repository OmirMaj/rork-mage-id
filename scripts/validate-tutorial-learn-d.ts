// validate-tutorial-learn-d.ts — lane D's three tutorials (contract-from-
// estimate, pay-app-period, closeout-binder) teach the SET-UP of legal and
// money documents and never the legal act, and the three screens refuse
// every outbound control on a sample.
//
// What it pins, in the order it fails:
//
//   1. FIXTURES (executed). The payload builders send nothing he did not do:
//      half a timeline, a cleared line, an unchanged or unreadable PERIOD TO
//      build no payload; cents are integers; the binder's section list is the
//      screen's own preview rows; the legal / outbound rule catches sign,
//      seal, certify, deliver and send ids (and not 'design' / 'assign').
//   2. DEFS. The spec's titles, endings, seconds and groups; the exact look
//      copy for signing, certifying and delivery; NO do / wait step lights or
//      waits on a legal / outbound id (DENY: contract.sign,
//      payApp.certifyExplain, binder.deliver, and any id with seal / certify /
//      deliver / send / sign in it) — those appear only on look steps; no
//      lane D signal is outbound; contract → pay app chain.
//   3. SCREENS (source scan, comments stripped).
//      • the sample fence, on EVERY outbound handler: contract handleSignPress
//        (Sign & send and Sign together), handleSignAndSend, retryDelivery,
//        copyContractLink and saveDeliveryAsk; the pay app's three
//        createPaymentLink call sites (handleSave's mint,
//        remintCertifiedPayLink, makeCertifiedPayLink) and Send to client
//        portal; the binder's handleDeliver — each refuses on isSampleProject
//        BEFORE it can email, publish, mint or copy a link, and the reason is
//        SAMPLE_DOC_NOT_SENT;
//      • the success signals follow the screens' own confirmed saves
//        (saveDraftFrom ok, addAIAPayApp, saveCloseoutBinder → row), and no
//        legal handler (sign, certify, finalize, deliver) emits one;
//      • the pay app's draft save point does not certify (handleSave never
//        calls saveAIAPayAppOnline — the certify slide's online legal write);
//      • the practice pass opens only the URL's sample project;
//      • every <TutorialTarget> renders only while a run is live on the job,
//        so a real job (and every phone golden) renders byte-identical.
//
// MUTATION PLANTS (each must turn this red; restore byte-identical, then cmp):
//   • fixturesD.ts   isLegalOrOutboundTarget drops 'deliver' from LANE_D_LEGAL_WORDS
//                    and LANE_D_LEGAL_TARGETS                       → "legal rule"
//   • payAppPeriod.ts the certify step becomes kind 'do' with an until
//                                                                    → "no do / wait step … legal"
//   • closeout-binder.tsx drops the isSampleProject line in handleDeliver
//                                                                    → "binder: handleDeliver refuses"
//   • aia-pay-app.tsx drops `if (!aiaTutorialRef.current.sampleJob)` above the mint
//                                                                    → "pay app: handleSave mints no link"
//
// Pure node:fs + direct imports of pure modules (no react-native — that
// crashes bun). fileURLToPath + join because the repo path has a space.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BINDER_SECTION_LABELS, LANE_D_LEGAL_TARGETS, binderSectionsFilled, contractTermsSource, contractTimelinePayload,
  isLegalOrOutboundTarget, isPeriodDay, payAppLinePayload, payAppPeriodPayload, toCentsD,
} from '../utils/tutorial/learn/fixturesD';
import { LANE_D_DEFS, LANE_D_SIGNALS, LANE_D_TARGETS } from '../utils/tutorial/learn/laneD';
import { SAMPLE_DOC_NOT_SENT } from '../utils/sampleGuard';
import type { TutorialDef, TutorialStep } from '../utils/tutorial/types';

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

/** `a` occurs, `b` occurs, and the first `a` comes before the first `b`. */
function before(body: string, a: string | RegExp, b: string | RegExp): boolean {
  const ia = typeof a === 'string' ? body.indexOf(a) : body.search(a);
  const ib = typeof b === 'string' ? body.indexOf(b) : body.search(b);
  return ia >= 0 && ib >= 0 && ia < ib;
}

const chainOf = (s: TutorialStep): string[] => (Array.isArray(s.target) ? [...s.target] : s.target ? [s.target as string] : []);

// ── 1. fixtures ─────────────────────────────────────────────────────────────
console.log('lane D tutorials\nfixtures');
{
  ok('timeline: both halves → the payload', JSON.stringify(contractTimelinePayload('2026-10-05', 120)) === JSON.stringify({ startDate: '2026-10-05', durationDays: 120 }));
  ok('timeline: half a timeline (or a nonsense one) builds NOTHING',
    contractTimelinePayload('2026-10-05', undefined) === null && contractTimelinePayload('', 120) === null && contractTimelinePayload(null, 120) === null
      && contractTimelinePayload('2026-10-05', 0) === null && contractTimelinePayload('2026-10-05', 12.5) === null && contractTimelinePayload('10/5/26', 120) === null);
  ok('terms source: record / profile carry through; anything else is a stored schedule',
    contractTermsSource('record') === 'record' && contractTermsSource('profile') === 'profile' && contractTermsSource('not_set') === 'saved' && contractTermsSource(null) === 'saved');
  ok('cents: integer, rounded, non-finite → 0', toCentsD(1234.565) === 123457 && toCentsD(0.1 + 0.2) === 30 && toCentsD(Number.NaN) === 0 && toCentsD(Infinity) === 0);
  ok('line: a line that bills this period → { lineId, thisPeriodCents } in cents',
    JSON.stringify(payAppLinePayload({ id: 'l1', thisPeriod: 4250.5 })) === JSON.stringify({ lineId: 'l1', thisPeriodCents: 425050 }));
  ok('line: a cleared / zero / missing line builds NOTHING (it is not work entered)',
    payAppLinePayload({ id: 'l1', thisPeriod: 0 }) === null && payAppLinePayload({ id: 'l1', thisPeriod: -5 }) === null
      && payAppLinePayload(undefined) === null && payAppLinePayload({ id: '', thisPeriod: 10 }) === null);
  ok('period: a real calendar day only', isPeriodDay('2026-02-28') && !isPeriodDay('2026-02-30') && !isPeriodDay('3/31/26') && !isPeriodDay('') && !isPeriodDay(null));
  ok('period: a new real day → payload; the day it opened with, or an unreadable one → NOTHING',
    JSON.stringify(payAppPeriodPayload('2026-10-31', '2026-10-02')) === JSON.stringify({ periodTo: '2026-10-31' })
      && payAppPeriodPayload('2026-10-02', '2026-10-02') === null && payAppPeriodPayload('2026-1', '2026-10-02') === null
      && JSON.stringify(payAppPeriodPayload('2026-10-31', null)) === JSON.stringify({ periodTo: '2026-10-31' }));
  ok('binder: sections filled counts only the ones with something in them',
    binderSectionsFilled({ selections: 0, trades: 2, warranties: 0, maintenance: 5 }) === 2
      && binderSectionsFilled({ selections: 1, trades: 1, warranties: 1, maintenance: 1 }) === 4
      && binderSectionsFilled({ selections: 0, trades: 0, warranties: 0, maintenance: 0 }) === 0);
  const binder = strip(read('app/closeout-binder.tsx'));
  const rows = [...binder.matchAll(/<PreviewRow label="([^"]+)"/g)].map(m => m[1]);
  ok('binder: the section list is the screen\'s own preview rows, in order (nothing invented)',
    JSON.stringify(rows) === JSON.stringify([...BINDER_SECTION_LABELS]), `screen: ${JSON.stringify(rows)}`);
  const legal = ['contract.sign', 'payApp.certifyExplain', 'binder.deliver', 'contract.seal', 'aia.certifySlide', 'binder.redeliver', 'co.send', 'contract.signTogether', 'x.sendLink'];
  const notLegal = ['contract.sum', 'contract.timeline', 'contract.paymentTerms', 'contract.saveDraft', 'payApp.periodTo', 'payApp.saveDraft', 'binder.saveDraft', 'binder.sections', 'plan.design', 'crew.assign'];
  ok('legal rule: every sign / seal / certify / deliver / send id is legal or outbound',
    legal.every(isLegalOrOutboundTarget), legal.filter(x => !isLegalOrOutboundTarget(x)).join(', '));
  ok('legal rule: the set-up ids are not (and neither is "design" / "assign")',
    notLegal.every(x => !isLegalOrOutboundTarget(x)), notLegal.filter(isLegalOrOutboundTarget).join(', '));
  ok('legal rule: the three named LOOK-ONLY targets are on the list', ['contract.sign', 'payApp.certifyExplain', 'binder.deliver'].every(x => (LANE_D_LEGAL_TARGETS as readonly string[]).includes(x)));
  ok('the sample refusal is the spec\'s sentence', SAMPLE_DOC_NOT_SENT === 'Sample job — contracts, pay applications and binders never go out from a sample.');
}

// ── 2. defs ─────────────────────────────────────────────────────────────────
console.log('defs');
{
  const byId = new Map<string, TutorialDef>(LANE_D_DEFS.map(d => [d.id, d]));
  const spec: [string, string, string, number, string][] = [
    ['contract-from-estimate', 'Set Up a Contract from the Estimate', 'Start date and payment terms set, ready to sign', 45, 'client'],
    ['pay-app-period', 'Fill in a pay application period', 'A draft pay application for this period', 45, 'money'],
    ['closeout-binder', 'Build a closeout binder', 'A draft binder with every section in one place', 35, 'client'],
  ];
  for (const [id, title, endsWith, seconds, group] of spec) {
    const d = byId.get(id);
    ok(`${id}: title, ending, seconds, group, sandbox`,
      !!d && d.title === title && d.endsWith === endsWith && d.seconds === seconds && d.group === group && d.sandbox === 'sarahs-place',
      d ? JSON.stringify({ title: d.title, endsWith: d.endsWith, seconds: d.seconds, group: d.group }) : 'missing');
  }
  ok('LANE_D_DEFS is exactly the three, in order', LANE_D_DEFS.map(d => d.id).join(',') === 'contract-from-estimate,pay-app-period,closeout-binder');
  ok('practice pass: the contract asks client_portal, the pay app aia_pay_app, the (ungated) binder nothing',
    JSON.stringify(byId.get('contract-from-estimate')?.practiceFeatures) === '["client_portal"]'
      && JSON.stringify(byId.get('pay-app-period')?.practiceFeatures) === '["aia_pay_app"]'
      && JSON.stringify(byId.get('closeout-binder')?.practiceFeatures) === '[]');

  const lookText = (id: string, target: string) => {
    const s = byId.get(id)?.steps.find(x => chainOf(x)[0] === target);
    return s && s.kind === 'look' && typeof s.text === 'string' ? s.text : null;
  };
  ok('the sign step is a LOOK that says signing happens on a real job', lookText('contract-from-estimate', 'contract.sign') === 'Signing happens with your client on a real job.');
  ok('the certify step is a LOOK that says the architect certifies on a real job', lookText('pay-app-period', 'payApp.certifyExplain') === 'The architect certifies on a real job.');
  ok('the deliver step is a LOOK that says delivery happens on a real job', lookText('closeout-binder', 'binder.deliver') === 'Delivery to the owner happens on a real job.');

  const bad: string[] = [];
  const lookLegal: string[] = [];
  for (const d of LANE_D_DEFS) {
    for (const s of d.steps) {
      const ids = [...chainOf(s), ...(s.until && 'mounted' in s.until ? [s.until.mounted as string] : [])];
      const hits = ids.filter(isLegalOrOutboundTarget);
      if (hits.length && s.kind !== 'look') bad.push(`${d.id}/${s.id} (${s.kind}): ${hits.join(', ')}`);
      if (hits.length && s.kind === 'look') lookLegal.push(...hits);
    }
  }
  ok('no do / wait step lights or waits on a legal / outbound id (sign, seal, certify, deliver, send)', bad.length === 0, bad.join('; '));
  ok('…the three legal controls ARE lit — as look steps only', ['contract.sign', 'payApp.certifyExplain', 'binder.deliver'].every(x => lookLegal.includes(x)), lookLegal.join(', '));
  ok('…and the registry notes them LOOK ONLY', ['contract.sign', 'payApp.certifyExplain', 'binder.deliver', 'binder.finalize'].every(x => /LOOK ONLY/.test((LANE_D_TARGETS as Record<string, { note: string }>)[x]?.note ?? '')));
  ok('no lane D signal is outbound', Object.values(LANE_D_SIGNALS).every(s => s.outbound === false));
  ok('every success stamp waits on a SAVE signal (terms.set, payApp.saved, binder.saved)',
    LANE_D_DEFS.flatMap(d => d.steps.filter(s => s.success)).every(s => s.until && 'signal' in s.until && ['contract.terms.set', 'payApp.saved', 'binder.saved'].includes(s.until.signal))
      && LANE_D_DEFS.every(d => d.steps.some(s => s.success)));
  const c = byId.get('contract-from-estimate');
  ok('contract → pay app chain ("Next: bill the first period")', c?.chainNext?.tutorialId === 'pay-app-period' && /^Next: bill the first period/.test(c.chainNext.label));
}

// ── 3. screens ──────────────────────────────────────────────────────────────
console.log('screens');
const CT = strip(read('app/contract.tsx'));
const PA = strip(read('app/aia-pay-app.tsx'));
const BD = strip(read('app/closeout-binder.tsx'));
{
  for (const [file, src] of [['app/contract.tsx', CT], ['app/aia-pay-app.tsx', PA], ['app/closeout-binder.tsx', BD]] as const) {
    ok(`${file}: imports the sample guard and its refusal`, /import \{ isSampleProject, SAMPLE_DOC_NOT_SENT \} from '@\/utils\/sampleGuard';/.test(src));
  }

  // ── contract: the outbound fence ──
  const press = callbackBody(CT, 'handleSignPress');
  ok('contract: handleSignPress (Sign & send AND Sign together) refuses a sample before anything opens',
    /if \(sampleJobRef\.current\) \{ showAlert\('Sample Job', SAMPLE_DOC_NOT_SENT\); return; \}/.test(press)
      && before(press, 'sampleJobRef.current', 'askContractTerms(') && before(press, 'sampleJobRef.current', 'setSignatureModal(true)')
      && before(press, 'sampleJobRef.current', 'setDeliveryAsk('));
  ok('contract: sampleJobRef is the render\'s isSampleProject(project)', /const sampleJob = isSampleProject\(project\);\s*const sampleJobRef = useRef\(sampleJob\);\s*sampleJobRef\.current = sampleJob;/.test(CT));
  const signSend = callbackBody(CT, 'handleSignAndSend');
  ok('contract: the signing write refuses a sample before it saves, flips or emails',
    /if \(sampleJobRef\.current\) return \{ status: 'refused', reason: SAMPLE_DOC_NOT_SENT \};/.test(signSend)
      && before(signSend, 'sampleJobRef.current', 'saveContractDetailed(') && before(signSend, 'sampleJobRef.current', 'emailContractLink('));
  const retry = callbackBody(CT, 'retryDelivery');
  ok('contract: retryDelivery refuses a sample before it emails', /if \(isSampleProject\(p\)\) \{ showAlert\('Sample Job', SAMPLE_DOC_NOT_SENT\); return; \}/.test(retry) && before(retry, 'isSampleProject(p)', 'emailContractLink('));
  const copy = callbackBody(CT, 'copyContractLink');
  ok('contract: copyContractLink refuses a sample before it copies the signing link', before(copy, /if \(isSampleProject\(projectRef\.current\)\) \{ showAlert\('Sample Job', SAMPLE_DOC_NOT_SENT\); return; \}/, 'copyToClipboard('));
  const ask = callbackBody(CT, 'saveDeliveryAsk');
  ok('contract: the delivery ask refuses a sample before it writes the client or turns on the portal',
    before(ask, /if \(isSampleProject\(p\)\) \{ setDeliveryAsk\(null\); showAlert\('Sample Job', SAMPLE_DOC_NOT_SENT\); return; \}/, 'seedClientEverywhere(') && before(ask, 'isSampleProject(p)', 'continueAfterAsk('));
  ok('contract: Sign together is disabled on a sample, and the reason prints under the row',
    /onPress=\{handleSignTogetherPress\}\s*disabled=\{\(contract\.paymentSchedule\.length > 0 && !scheduleMatchesValue\) \|\| saving \|\| sampleJob\}/.test(CT)
      && /\{contract\.status === 'draft' && sampleJob && \(\s*<Text[^>]*testID="contract-sample-note">\{SAMPLE_DOC_NOT_SENT\}<\/Text>/.test(CT));
  const saveDraft = callbackBody(CT, 'saveDraftFrom');
  ok('contract: contract.terms.set follows the confirmed draft write (saved.ok), on the SAVED row, schedule non-empty',
    before(saveDraft, 'if (saved.ok) {', "tutorialSignal('contract.terms.set'") && before(saveDraft, 'setContract(saved.contract);', "tutorialSignal('contract.terms.set'")
      && /if \(tut\.runOnThis && row\.paymentSchedule\.length > 0\)/.test(saveDraft) && saveDraft.indexOf("tutorialSignal('contract.terms.set'") < saveDraft.indexOf("saved.reason === 'duplicate'"));
  ok('contract: contract.terms.set is emitted from saveDraftFrom only', (CT.match(/tutorialSignal\('contract\.terms\.set'/g) ?? []).length === 1);
  ok('contract: no signing / delivery handler emits a tutorial signal',
    ['handleSignPress', 'handleSignAndSend', 'handleSignTogetherPress', 'retryDelivery', 'saveDeliveryAsk', 'recordInPerson', 'recordPaper', 'handleSealSignedContract'].every(n => !/tutorialSignal\(/.test(callbackBody(CT, n))));

  // ── pay app: the outbound fence + the draft save point ──
  const save = callbackBody(PA, 'handleSave');
  ok('pay app: handleSave mints no link on a sample (the fence sits directly above the mint)',
    /if \(!aiaTutorialRef\.current\.sampleJob\)\s*if \(!pendingBankPayment\)\s*if \(!payLinkUrl && due > 0 && !savedPaidAt && !sourceInvoiceSettled && user\?\.id\) \{/.test(save)
      && before(save, 'aiaTutorialRef.current.sampleJob', 'createPaymentLink('));
  ok('pay app: aiaTutorialRef.sampleJob is the render\'s isSampleProject(project)', /const sampleJob = isSampleProject\(project\);\s*const aiaTutorialRef = useRef\(\{ runOnThis, sampleJob \}\);\s*aiaTutorialRef\.current = \{ runOnThis, sampleJob \};/.test(PA));
  const remint = callbackBody(PA, 'remintCertifiedPayLink');
  ok('pay app: the certified re-mint refuses a sample before Stripe', before(remint, /if \(aiaTutorialRef\.current\.sampleJob\) return;/, 'createPaymentLink('));
  const certLink = callbackBody(PA, 'makeCertifiedPayLink');
  ok('pay app: the certify slide\'s pay link refuses a sample before Stripe', before(certLink, /if \(aiaTutorialRef\.current\.sampleJob\) return \{ kind: 'skipped' \};/, 'createPaymentLink('));
  ok('pay app: those are the screen\'s ONLY createPaymentLink call sites', (PA.match(/createPaymentLink\(\{/g) ?? []).length === 3
    && [save, remint, certLink].every(b => (b.match(/createPaymentLink\(\{/g) ?? []).length === 1));
  ok('pay app: Send to client portal is off on a sample, with the reason',
    /canSend=\{app\.lines\.length > 0 && !sampleJob\}/.test(PA) && /canSendReason=\{sampleJob \? SAMPLE_DOC_NOT_SENT :/.test(PA));
  ok('pay app: the draft save point does NOT certify (handleSave never calls the online legal write)',
    save.length > 0 && !/saveAIAPayAppOnline\(/.test(save) && /saveAIAPayAppOnline\(rec\)/.test(callbackBody(PA, 'certify')));
  ok('pay app: payApp.saved follows addAIAPayApp in handleSave, and nowhere else',
    before(save, 'addAIAPayApp({ ...rec, payLinkUrl', "tutorialSignal('payApp.saved'") && (PA.match(/tutorialSignal\('payApp\.saved'/g) ?? []).length === 1);
  ok('pay app: the certify / certification paths emit no tutorial signal',
    ['certify', 'handleSaveCertification', 'handleGenerate', 'remintCertifiedPayLink', 'makeCertifiedPayLink'].every(n => !/tutorialSignal\(/.test(callbackBody(PA, n))));
  ok('pay app: a line counts as touched only through his own edits (updateLine with thisPeriod, applyPercentToLine)',
    /if \('thisPeriod' in patch\) touchedLineRef\.current = lineId;/.test(callbackBody(PA, 'updateLine'))
      && /touchedLineRef\.current = lineId;/.test(callbackBody(PA, 'applyPercentToLine'))
      && (PA.match(/touchedLineRef\.current = /g) ?? []).length === 2);
  ok('pay app: the period assist fills a sample only, through setPeriodTo', /useTutorialAssist\('payApp\.usePeriodToday', \(\) => \{\s*if \(!aiaTutorialRef\.current\.runOnThis \|\| !aiaTutorialRef\.current\.sampleJob\) return;\s*periodAssistRef\.current = true;\s*setPeriodTo\(todayCalendarDay\(\)\);/.test(PA));
  ok('pay app / contract: the fill signals fire only while their own step is live (a replay never skips the look before them)',
    /const periodStepLive = useTutorialStepActive\('pay-period-to'\);/.test(PA) && /runOnThis && periodStepLive && app && !isReadOnly/.test(PA)
      && /const timelineStepLive = useTutorialStepActive\('contract-timeline'\);/.test(CT) && /runOnThis && timelineStepLive \? contractTimelinePayload/.test(CT));

  // ── binder: the outbound fence + the save ──
  const deliver = callbackBody(BD, 'handleDeliver');
  ok('binder: handleDeliver refuses a sample before it writes, publishes or notifies',
    before(deliver, /if \(isSampleProject\(project\)\) \{ showAlert\('Sample job', SAMPLE_DOC_NOT_SENT\); return; \}/, 'persistBinder(') && before(deliver, 'isSampleProject(project)', 'notifyEvent('));
  ok('binder: Deliver and Re-deliver are disabled on a sample, with the reason above the bar',
    (BD.match(/disabled=\{delivering \|\| sampleJob\}/g) ?? []).length === 2 && /testID="binder-sample-note">\{SAMPLE_DOC_NOT_SENT\}/.test(BD));
  const bsave = callbackBody(BD, 'handleSave');
  ok('binder: binder.saved follows saveCloseoutBinder returning a DRAFT row', before(bsave, 'if (saved) {', "tutorialSignal('binder.saved'") && /if \(tut\.runOnThis && saved\.status === 'draft'\)/.test(bsave));
  ok('binder: finalize and deliver emit no tutorial signal', ['commitFinalize', 'onFinalizeDone', 'handleDeliver'].every(n => !/tutorialSignal\(/.test(callbackBody(BD, n))));

  // ── the practice pass: the URL's sample only ──
  ok('contract: the route gate reads the pass for the URL project; the inner screen refuses any other',
    /const practice = useTutorialPractice\(practiceParam \|\| undefined\);/.test(CT) && /if \(!paid && !practice\.has\('client_portal'\)\)/.test(CT)
      && /<ContractScreenInner practiceProjectId=\{paid \? undefined : practiceParam\} \/>/.test(CT)
      && before(CT, /if \(practiceProjectId && project\?\.id !== practiceProjectId\) \{\s*return <Paywall/, '<ToolProjectPicker'));
  ok('pay app: the route gate reads the pass for the URL project; the inner screen refuses Different project and any other job\'s invoice',
    /const practice = useTutorialPractice\(practiceParam \|\| undefined\);/.test(PA) && /if \(!paid && !practice\.has\('aia_pay_app'\)\)/.test(PA)
      && /<AIAPayAppScreenInner practiceProjectId=\{paid \? undefined : practiceParam\} \/>/.test(PA)
      && before(PA, /if \(practiceProjectId && \(forceProjectPick \|\| project\?\.id !== practiceProjectId\)\) \{\s*return <Paywall/, '<ToolProjectPicker'));
  ok('binder: reads no practice pass (it has no plan gate)', !/useTutorialPractice\(/.test(BD));

  // ── every wrapper is conditional on the run ──
  for (const [file, src] of [['app/contract.tsx', CT], ['app/aia-pay-app.tsx', PA], ['app/closeout-binder.tsx', BD]] as const) {
    ok(`${file}: the wrapper renders its children with no host View when off`,
      /function TutorialWrap\(\{ on, wrap, children \}[^)]*\) \{\s*return on \? React\.cloneElement\(wrap, undefined, children\) : <>\{children\}<\/>;/.test(src)
        && /return on \? <TutorialScrollAnchor scrollRef=\{scrollRef\}>\{children\}<\/TutorialScrollAnchor> : <>\{children\}<\/>;/.test(src));
    const bad: string[] = [];
    const re = /<TutorialTarget\b[^>]*\bid="([^"]+)"/g;
    let m: RegExpExecArray | null;
    let n = 0;
    while ((m = re.exec(src))) {
      n++;
      const lead = src.slice(Math.max(0, m.index - 260), m.index);
      const wrapped = /<TutorialWrap\b[^>]*\bon=\{runOnThis(?: && lineIdx === 0)?\} wrap=\{$/.test(lead);
      const sentinel = /runOnThis && \([^]*\) \? $/.test(lead) || /runOnThis && aiaModal \? $/.test(lead);
      if (!wrapped && !sentinel) bad.push(m[1]);
    }
    ok(`${file}: every TutorialTarget (${n}) renders only while a run is live on this job`, n > 0 && bad.length === 0, bad.join(', '));
    ok(`${file}: runOnThis means a run is live on THIS project`, /const runOnThis = !!(projectId|project) && tutorialSandboxId === (projectId|project\.id);/.test(src));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
