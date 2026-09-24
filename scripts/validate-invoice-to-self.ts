// scripts/validate-invoice-to-self.ts — the invoice screen's half of the
// "Bill the job and see what your client gets" tutorial (wave A, lane L4b),
// plus the Paywall's "Try it free on a sample job first".
//
// WHAT IT PROVES
//   1  utils/invoiceSampleCore — RUN: the amount signal waits for HIS change
//      (never the prefilled default), the blocker covers every layer-less
//      modal, and the sample email fragments say SAMPLE and carry no link.
//   2  utils/emailService.buildInvoiceEmailHtml — RUN (RN modules stubbed): a
//      real invoice renders exactly as with no flag (Pay CTA, "Powered by
//      Stripe", financing); a sample drops any pay link, the CTA and the
//      financing block, and shows the banner + specimen.
//   3  utils/paywallPracticeOffer — RUN: offered only with the pass on, a
//      known practising def, progress loaded, not practised, no live run.
//   4  app/invoice.tsx — source: targets, the blocker sentinel, the scroll
//      anchor, the three signals at the real success / failure points, the
//      assist never presses Send, the practice pass at the route gate, and
//      the sample fences (send locked to self, no mint, no reminder, no
//      portal post, [Sample] subject). AND the real path is untouched: every
//      sample branch is gated on isSampleJob / isSampleProject, and the real
//      Send button, mint call and portal post are still there verbatim.
//   5  components/Paywall.tsx — source: the two optional props, source in
//      PAYWALL_VIEWED, the offer in both branches, onClose before start.
//
// Run: bun run scripts/validate-invoice-to-self.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunState } from '../utils/tutorial/types';

// @types/bun is not installed; only the sliver used here is declared.
type BunLoadResult = { exports: Record<string, unknown>; loader: 'object' };
type BunPluginBuilder = { module: (specifier: string, cb: () => BunLoadResult) => void };
declare const Bun: { plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}

// emailService imports RN-bound modules; buildInvoiceEmailHtml touches none.
Bun.plugin({
  name: 'invoice-to-self-stubs',
  setup(build) {
    build.module('react-native', () => ({ exports: { Platform: { OS: 'ios' } }, loader: 'object' }));
    build.module('expo-mail-composer', () => ({ exports: {}, loader: 'object' }));
    build.module('expo-file-system/legacy', () => ({ exports: {}, loader: 'object' }));
    build.module('@/lib/supabase', () => ({ exports: { supabase: {}, isSupabaseConfigured: false }, loader: 'object' }));
  },
});

const CORE = await import('@/utils/invoiceSampleCore');
const OFFER = await import('@/utils/paywallPracticeOffer');
const EMAIL = await import('@/utils/emailService');
const PAYWALL_SRC = strip(read('components/Paywall.tsx'));
const G = await import('@/utils/sampleGuard');
const { TUTORIAL_DEFS } = await import('@/utils/tutorial/defs');
type Defs = typeof TUTORIAL_DEFS;

// ════════════════════════════════════════════════════════════════════════════
console.log('\n1. utils/invoiceSampleCore');
{
  const R = CORE.invoiceAmountSignalReady;
  ok('the prefilled percentage alone never completes "Bill 15%" (untouched)', !R({ touched: false, isProgress: true, percent: 30, total: 126_720 }));
  ok('his change does', R({ touched: true, isProgress: true, percent: 15, total: 63_360 }));
  ok('not on a full (non-progress) invoice', !R({ touched: true, isProgress: false, percent: 15, total: 63_360 }));
  ok('not at 0 %, 0 due, or NaN', !R({ touched: true, isProgress: true, percent: 0, total: 1 })
    && !R({ touched: true, isProgress: true, percent: 15, total: 0 }) && !R({ touched: true, isProgress: true, percent: NaN, total: 1 })
    && !R({ touched: true, isProgress: true, percent: 15, total: NaN }));
  ok('debounced long enough to skip the "1" of "15"', CORE.INVOICE_AMOUNT_SIGNAL_DEBOUNCE_MS >= 400);

  const none = { sendSheet: false, retainageAsk: false, retention: false, payment: false, contactPicker: false, pdfPreSend: false, receivedDatePicker: false, sendInFlight: false };
  ok('no modal → the coach may draw', !CORE.invoiceModalUp(none));
  const keys = Object.keys(none) as (keyof typeof none)[];
  const missed = keys.filter(k => !CORE.invoiceModalUp({ ...none, [k]: true }));
  ok('EVERY layer-less modal (and the send in flight) blocks the coach', missed.length === 0, `not blocking: ${missed.join(', ')}`);

  const banner = CORE.sampleInvoiceBannerHtml();
  ok('the banner says SAMPLE and that it went to him only', banner.includes(CORE.SAMPLE_EMAIL_BANNER_WORD) && /sent to you only/.test(banner) && /no client received it/.test(banner));
  const spec = CORE.samplePaySpecimenHtml(63_360);
  ok('the Pay specimen is not a link (no <a, no href)', !/<a[\s>]/i.test(spec) && !/href/i.test(spec));
  ok('…it names the amount and says it goes live with Stripe', spec.includes('$63,360.00') && spec.includes(G.SAMPLE_PAY_SPECIMEN_NOTE));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n2. buildInvoiceEmailHtml (run)');
{
  const base = {
    companyName: 'Oak & Iron Builders', recipientName: 'Sarah', projectName: "Maple St", invoiceNumber: 3,
    totalDue: 63_360, dueDate: '2026-10-23T12:00:00.000Z', paymentTerms: 'net_30',
    payLinkUrl: 'https://buy.stripe.com/test_live_link', financingHtml: '<div id="fin">financing</div>',
  };
  const real = EMAIL.buildInvoiceEmailHtml(base);
  ok('a real invoice: the Pay CTA links the minted URL', real.includes('https://buy.stripe.com/test_live_link') && /Pay securely/.test(real));
  ok('…with "Powered by Stripe" and the financing block, and no SAMPLE banner',
    real.includes('Powered by Stripe') && real.includes('id="fin"') && !real.includes(CORE.sampleInvoiceBannerHtml()));
  ok('a real invoice renders byte-identically with sample:false and with no flag', EMAIL.buildInvoiceEmailHtml({ ...base, sample: false }) === real);
  const noLink = EMAIL.buildInvoiceEmailHtml({ ...base, payLinkUrl: undefined, financingHtml: '' });
  ok('a real invoice with no link still says how to pay', /Pay by check, ACH/.test(noLink) && !noLink.includes('SAMPLE'));

  const sample = EMAIL.buildInvoiceEmailHtml({ ...base, sample: true });
  ok('a sample drops ANY pay link a caller passed', !sample.includes('buy.stripe.com') && !/href="https:\/\/buy/.test(sample));
  ok('…and the financing block (no lender lead from a sample)', !sample.includes('id="fin"'));
  ok('…and shows the SAMPLE banner and the Pay specimen', sample.includes(CORE.sampleInvoiceBannerHtml()) && sample.includes(G.SAMPLE_PAY_SPECIMEN_NOTE));
  ok('…with the amount and invoice number the client would see', sample.includes('$63,360.00') && sample.includes('Invoice #3'));
  ok('…and its preview line / eyebrow say Sample', /SAMPLE — sent to you only/.test(sample) && /Sample · Invoice #3/.test(sample));
  ok('the [Sample] subject helper is idempotent', G.sampleEmailSubject('Invoice #3: $63,360.00 due · X') === '[Sample] Invoice #3: $63,360.00 due · X'
    && G.sampleEmailSubject('[Sample] Invoice #3') === '[Sample] Invoice #3');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n3. utils/paywallPracticeOffer (run)');
{
  const empty = { v: 1 as const, byId: {}, chips: {} };
  const practised = { v: 1 as const, byId: { 'invoice-to-self': { status: 'practised' as const, version: 1 } }, chips: {} };
  const exited = { v: 1 as const, byId: { 'invoice-to-self': { status: 'exited' as const, version: 1 } }, chips: {} };
  const P = (o: Partial<Parameters<typeof OFFER.paywallPracticeOffer>[0]>) => OFFER.paywallPracticeOffer({
    tutorialId: 'invoice-to-self', progress: empty, progressLoaded: true, runActive: false, passOn: true, ...o,
  });
  const inv = P({});
  ok('offered for invoicing, with its measured duration', inv?.tutorialId === 'invoice-to-self' && inv.label === 'Try it free on a sample job first · 40 s', JSON.stringify(inv));
  ok('…and for punch walk (45 s)', P({ tutorialId: 'punch-walk' })?.label === 'Try it free on a sample job first · 45 s');
  // Honest scope: the invoice tutorial DOES send — to him. So the promise is
  // about clients and subs, never "nothing is sent" (brain-center honesty).
  ok('…its sub-line promises nothing reaches a client or a sub (not "nothing is sent")',
    /nothing goes to a client or a sub/.test(inv?.sub ?? '') && !/nothing is sent/i.test(inv?.sub ?? ''));
  ok('the pass switched off → the paywall is what it was', P({ passOn: false }) === null);
  ok('the default follows TUTORIAL_PRACTICE_PASS (ON)', OFFER.paywallPracticeOffer({ tutorialId: 'invoice-to-self', progress: empty, progressLoaded: true, runActive: false }) !== null);
  ok('no tutorial named → nothing', P({ tutorialId: null }) === null && P({ tutorialId: undefined }) === null);
  ok('already practised → an honest price question, no offer', P({ progress: practised }) === null);
  ok('walked out once → still offered (the chip rule is stricter; the wall is where he is stuck)', P({ progress: exited }) !== null);
  ok('progress not loaded yet → nothing (never offer then retract)', P({ progressLoaded: false }) === null && P({ progress: null }) === null);
  ok('a live run → nothing (a wall met mid-run must not end it)', P({ runActive: true }) === null);
  // Integration review round 2: a RESTORED run holds no pass, so a web reload
  // of the sample's gated screen shows this wall — its offer must stay, and
  // say Resume when it is the same tutorial.
  const RS = (paused: false | { reason: string; at: number }, tutorialId = 'invoice-to-self') =>
    ({ status: 'running', tutorialId, paused, phase: 'step' }) as unknown as RunState;
  ok('runBlocksPaywallOffer: running, or paused off-route / backgrounded → blocks',
    OFFER.runBlocksPaywallOffer(RS(false)) && OFFER.runBlocksPaywallOffer(RS({ reason: 'offroute', at: 1 })) && OFFER.runBlocksPaywallOffer(RS({ reason: 'background', at: 1 })));
  ok('…a restored run, idle, finished → does not block',
    !OFFER.runBlocksPaywallOffer(RS({ reason: 'restored', at: 1 })) && !OFFER.runBlocksPaywallOffer({ status: 'idle' } as RunState)
      && !OFFER.runBlocksPaywallOffer({ status: 'finished' } as unknown as RunState));
  ok('restoredRunId names only a restored run', OFFER.restoredRunId(RS({ reason: 'restored', at: 1 })) === 'invoice-to-self'
    && OFFER.restoredRunId(RS({ reason: 'offroute', at: 1 })) === null && OFFER.restoredRunId(RS(false)) === null);
  ok('a restored run of THIS tutorial → the offer says Resume', P({ restoredTutorialId: 'invoice-to-self' })?.label === OFFER.PAYWALL_RESUME_LABEL);
  ok('…of another tutorial → the normal offer', P({ restoredTutorialId: 'punch-walk' })?.label === 'Try it free on a sample job first · 40 s');
  ok('Paywall reads the run through these two selectors',
    /const selectRunActive = runBlocksPaywallOffer;/.test(PAYWALL_SRC) && /const selectRestoredId = restoredRunId;/.test(PAYWALL_SRC)
      && /restoredTutorialId,\n/.test(PAYWALL_SRC));
  {
    const h = PAYWALL_SRC.slice(PAYWALL_SRC.indexOf('const handlePracticeFirst = useCallback('), PAYWALL_SRC.indexOf('const practiceBlock ='));
    // One rule (round 3): resume in place only when the host's resume will
    // not navigate (resumeTarget() null: this wall IS the checkpoint screen);
    // otherwise pop the wall first, or its <Modal visible> stays presented
    // under the pushed sample screens.
    ok('…resuming a restored run: in place ONLY when resumeTarget() is null, read from the live store and the real defs',
      /if \(restoredTutorialId === practiceOffer\.tutorialId\) \{\s*const inPlace = resumeTarget\(getTutorialState\(\), TUTORIAL_DEFS, RESUME_PROBE_CTX\) === null;/.test(h));
    ok('…restored and not in place: onClose before startTutorial, then return (no returnTo: the run keeps its own)',
      /const inPlace = [^;]+;\s*if \(!inPlace\) onClose\(\);\s*void startTutorial\(practiceOffer\.tutorialId, \{ entry: 'paywall' \}\);\s*return;\s*\}/.test(h));
    ok('…the fresh-start path still pops before starting',
      /onClose\(\);\s*void startTutorial\(practiceOffer\.tutorialId, \{ entry: 'paywall', returnTo \}\);/.test(h));
  }
  {
    // The rule's input, on the REAL reducer: a restored run whose last route is
    // the checkpoint → null (resume in place); a real job's wall → a target
    // (pop first, the host pushes the sample).
    const { reduceTutorial, resumeTarget } = await import('@/utils/tutorial/machine');
    const now = Date.now();
    const ctx = { today: '1970-01-01', reportDay: '1970-01-01' };
    const at = (id: 'invoice-to-self' | 'punch-walk', route: { pathname: string; params: Record<string, string> }) => {
      const restored = reduceTutorial({ status: 'idle' } as RunState, {
        type: 'RESTORE',
        saved: { tutorialId: id, version: TUTORIAL_DEFS[id]?.version ?? 1, stepIndex: 0, sandboxProjectId: 'S', entry: 'hub', returnTo: null, savedAt: now - 60_000 },
        sampleExists: true, now,
      } as never, TUTORIAL_DEFS);
      return resumeTarget(reduceTutorial(restored, { type: 'ROUTE', ...route, now } as never, TUTORIAL_DEFS), TUTORIAL_DEFS, ctx);
    };
    ok('resumeTarget: restored invoice run ON the sample /invoice → null (resume in place)',
      at('invoice-to-self', { pathname: '/invoice', params: { projectId: 'S', type: 'progress' } }) === null);
    ok('resumeTarget: restored invoice run on a REAL job /invoice → the sample /invoice (pop first)',
      at('invoice-to-self', { pathname: '/invoice', params: { projectId: 'R' } })?.params.projectId === 'S');
    ok('resumeTarget: restored punch run on /punch-list (never a checkpoint) → the sample /punch-walk (pop first)',
      at('punch-walk', { pathname: '/punch-list', params: { projectId: 'S' } })?.pathname === '/punch-walk');
  }
  ok('a def that practises no gated feature (daily report) → nothing', P({ tutorialId: 'daily-report-voice' }) === null);
  const coach = { ...TUTORIAL_DEFS['invoice-to-self'], id: 'first-bid-coach' as const, sandbox: 'current-real' as const };
  const withCoach = { ...TUTORIAL_DEFS, 'first-bid-coach': coach } as Defs;
  ok('a current-real def (the first-bid coach) → nothing', P({ tutorialId: 'first-bid-coach', defs: withCoach }) === null);
  ok('an unknown def → nothing', P({ tutorialId: 'schedule-say-it' }) === null);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n4. app/invoice.tsx (source)');
const INV = strip(read('app/invoice.tsx'));
const region = (src: string, decl: string) => {
  const i = src.indexOf(decl);
  if (i < 0) return '';
  const rest = src.slice(i);
  const end = /\n {2}\}, \[[^\n]*\]\);/.exec(rest);
  return end ? rest.slice(0, end.index) : rest.slice(0, 4000);
};
{
  ok('invoice.percent wraps the progress row (input + "% of")', /<TutorialTarget id="invoice\.percent">\s*<View style=\{styles\.progressRow\}>[\s\S]{0,400}testID="progress-percent-input"/.test(INV));
  ok('invoice.totals wraps the totals card, the card margins moved onto the wrapper',
    /<TutorialTarget id="invoice\.totals" style=\{styles\.totalsTarget\}>\s*<View style=\{\[styles\.totalsCard, styles\.totalsCardInTarget\]\}>/.test(INV)
      && /totalsTarget: \{ marginHorizontal: 20, marginTop: 16 \}/.test(INV) && /totalsCardInTarget: \{ marginHorizontal: 0, marginTop: 0 \}/.test(INV));
  // [^>]* allows the join's web-desktop width style on the wrapper (the ui
  // Button's fullWidth sizing sits on its own outer view, so the wrapper must
  // carry it or the bar's flex item shrinks to content).
  ok('invoice.send wraps send-invoice-btn (both labels)', /<TutorialTarget id="invoice\.send"[^>]*>[\s\S]{0,1400}testID="send-invoice-btn"[\s\S]{0,700}<\/TutorialTarget>/.test(INV));
  // Desktop web: ui/Button's fullWidth caps at Layout.button.fullWidthMax
  // under useIsDesktopWeb() (wave 6b). Wrapped in a content-width
  // TutorialTarget, Send shrank to 116 px beside a 400 px Save (round-3
  // measurement). The wrapper must carry the same width contract, gated the
  // way Button gates it (isDesktop && web). Enforced once the tokens exist:
  // the pre-join branch has no Layout.button.fullWidthMax to point at.
  if (/fullWidthMax/.test(read('constants/designTokens.ts'))) {
    ok('desktop web: the invoice.send wrapper takes sendTargetDesktop, gated like Button (isDesktop && web)',
      /<TutorialTarget id="invoice\.send" style=\{isDesktop && Platform\.OS === 'web' \? styles\.sendTargetDesktop : undefined\}>/.test(INV));
    ok('…and makeStyles defines it as Button\'s own full-width contract',
      /sendTargetDesktop: \{ width: '100%', maxWidth: Layout\.button\.fullWidthMax, flexShrink: 1 \},/.test(INV));
  } else {
    console.log('  - desktop Send width pin: skipped (no Layout.button.fullWidthMax on this tree; the join adds both)');
  }
  ok('the sample label is "Send to me"; the real one is still "Send & Save"',
    /label=\{sendInFlight \? 'Sending…' : SAMPLE_SEND_TO_ME_LABEL\}/.test(INV) && /label=\{sendInFlight \? 'Sending…' : 'Send & Save'\}/.test(INV)
      && /\{isSampleJob \? \(\s*<Button\s+label=\{sendInFlight \? 'Sending…' : SAMPLE_SEND_TO_ME_LABEL\}/.test(INV));
  const sentinel = /\{invoiceModalUp\(\{([\s\S]*?)\}\) \? <TutorialTarget id="invoice\.modalUp" \/> : null\}/.exec(INV);
  const flags = sentinel?.[1] ?? '';
  ok('the invoice.modalUp sentinel is childless and fed every modal + the send in flight',
    !!sentinel && ['showSendRecipient', 'showRetainageAsk', 'showRetentionModal', 'showPaymentModal', 'showContactPicker', 'showPDFPreSend', 'showReceivedDatePicker', 'sendInFlight'].every(f => flags.includes(f)), flags);
  ok('…mounted OUTSIDE the modals (before the first <Modal)', !!sentinel && INV.indexOf('<TutorialTarget id="invoice.modalUp" />') < INV.indexOf('<Modal visible={showPaymentModal}'));
  ok('the ScrollView content sits in a TutorialScrollAnchor on its own ref',
    /<ScrollView\s+ref=\{invoiceScrollRef\}/.test(INV) && /<TutorialScrollAnchor scrollRef=\{invoiceScrollRef\}>/.test(INV) && /<\/TutorialScrollAnchor>\s*<\/ScrollView>/.test(INV));

  const run = region(INV, 'const runConfirmSend = useCallback(');
  const okAt = run.indexOf("console.log('[Invoice] Email sent successfully');");
  const sentAt = run.indexOf("tutorialSignal('invoice.sent'");
  const flipAt = run.indexOf("updateInvoice(workingInvoice.id, { status: 'sent', dueDate, ...billTo });");
  const backAfter = run.indexOf('router.back();', okAt);
  ok('invoice.sent fires AFTER the email went and the invoice flipped to sent', okAt > 0 && flipAt > okAt && sentAt > flipAt, `${okAt} ${flipAt} ${sentAt}`);
  ok('…and BEFORE the screen pops (no paused-coach flash)', sentAt > 0 && backAfter > sentAt);
  ok('…with the real number, the balance the email names, and the address it went to',
    /tutorialSignal\('invoice\.sent', \{\s*projectId: workingInvoice\.projectId,\s*invoiceId: workingInvoice\.id,\s*number: workingInvoice\.number,\s*total: amountDueNow,\s*to: sendRecipientEmail\.trim\(\),\s*\}\);/.test(run));
  const failedFires = (run.match(/tutorialSignal\('invoice\.send\.failed'/g) ?? []).length;
  ok('invoice.send.failed on the sample refusal, a refused/unsaved insert and a failed email', failedFires === 3, `${failedFires}`);
  const cancelledAt = run.indexOf("if (result.error === 'cancelled') return;");
  const emailFailAt = run.indexOf("tutorialSignal('invoice.send.failed'", cancelledAt);
  ok('…a cancelled composer is NOT a failure (he backed out)', cancelledAt > 0 && emailFailAt > cancelledAt);
  ok('…and never a success signal on a failed path (sent only after the failure branch returns)', sentAt > run.indexOf('if (!result.success) {'));

  const amt = INV.slice(INV.indexOf("const [percentTouched, setPercentTouched] = useState(false);"), INV.indexOf("useTutorialAssist('invoice.fillPercent'"));
  ok('invoice.amount.set only via invoiceAmountSignalReady with HIS touch, debounced',
    /invoiceAmountSignalReady\(\{ touched: percentTouched,/.test(amt) && /setTimeout\(\(\) => tutorialSignal\('invoice\.amount\.set', \{ projectId, total: balanceDue \}\), INVOICE_AMOUNT_SIGNAL_DEBOUNCE_MS\)/.test(amt) && /clearTimeout/.test(amt));
  ok('the % field marks the touch (onProgressPercentChange)', /onChangeText=\{onProgressPercentChange\}/.test(INV) && /setPercentTouched\(true\);\s*setProgressPercent\(v\);/.test(INV));
  const assist = INV.slice(INV.indexOf("useTutorialAssist('invoice.fillPercent'"), INV.indexOf("useTutorialAssist('invoice.fillPercent'") + 400);
  ok("the assist fills 15 on a sample only, and never presses Send",
    /if \(!isSampleProject\(projectNameRef\.current\)\) return;/.test(assist) && /setProgressPercent\(String\(SAMPLE_PROGRESS_PCT\)\)/.test(assist)
      && !/handleSendPress|handleConfirmSend|runConfirmSend|handleSave\(/.test(assist.slice(0, assist.indexOf('});') + 3)));

  const gate = INV.slice(INV.indexOf('export default function InvoiceScreen'), INV.indexOf('function InvoiceRoleBlocked'));
  ok('practice pass: read for the URL job, OR-ed in INSIDE the unchanged tier check',
    /const practice = useTutorialPractice\(paramProjectId \|\| undefined\);/.test(gate)
      && /if \(!canAccess\('change_orders_invoicing'\)\) \{\s*if \(practice\.has\('change_orders_invoicing'\)\) return <InvoiceInner \/>;/.test(gate));
  ok('…the hook runs before any early return (hook order)', gate.indexOf('useTutorialPractice(') < gate.indexOf('return <InvoiceRoleBlocked'));
  // The practice-pass escape (integration review): an invoice-only link fell
  // back to the named invoice's project for the pass, then the editor's picker
  // opened a REAL job with the full Pro editor. The route pass is keyed to the
  // URL's project, and the editor re-checks the job it writes to.
  ok('…the route pass never borrows the invoice-derived project', !/useTutorialPractice\(gateProjectId/.test(gate));
  const inner = INV.slice(INV.indexOf('function InvoiceInner()'));
  ok('InvoiceInner re-checks the tier on the job it writes to (plan OR the pass for THAT project)',
    /const innerPractice = useTutorialPractice\(projectId \|\| undefined\);/.test(inner)
      && /const innerTierOpen = innerCanAccess\('change_orders_invoicing'\) \|\| innerPractice\.has\('change_orders_invoicing'\);/.test(inner));
  const innerRender = inner.slice(inner.indexOf('if (!project) {'));
  ok('…and the editor cannot render past it (Paywall before the main return)',
    /if \(!innerTierOpen\) \{\s*return \(\s*<Paywall/.test(innerRender)
      && innerRender.indexOf('if (!innerTierOpen)') < innerRender.indexOf("title: existingInvoice ? `Invoice #"));
  ok('the Invoicing paywall offers the sample first', /feature="Invoicing"[\s\S]{0,120}practiceTutorialId="invoice-to-self"/.test(gate));

  // ── the sample fences ──
  ok('the sample plan comes from utils/sampleGuard (one rule)', /const samplePlan = useMemo\(\(\) => sampleSendPlan\(project \?\? null, user\?\.email\), \[project, user\?\.email\]\);/.test(INV)
    && /const isSampleJob = samplePlan\.sample;/.test(INV));
  ok('runConfirmSend refuses any recipient but his own on a sample, BEFORE creating anything',
    run.indexOf('sampleSendAllowed(project, sendRecipientEmail, userEmailRef.current)') > 0
      && run.indexOf('sampleSendAllowed(project, sendRecipientEmail, userEmailRef.current)') < run.indexOf('buildNewInvoice('));
  const mint = region(INV, 'const mintPayLinkFor = useCallback(');
  const mintGuardAt = mint.indexOf('if (isSampleProject(project?.name ?? null)) return { ok: false, reason: SAMPLE_PAY_LINK_REFUSAL');
  ok('mintPayLinkFor refuses a sample as its FIRST check, before Stripe is asked', mintGuardAt > 0 && mintGuardAt < mint.indexOf('resolveStripeAccountId()') && mintGuardAt < mint.indexOf('if (amount <= 0)'));
  ok('…both send paths treat that refusal as "no Pay button by design", not a failure',
    (INV.match(/\} else if \(minted\.reason === SAMPLE_PAY_LINK_REFUSAL\) \{/g) ?? []).length === 2);
  ok('the email is built in sample mode on a sample (both send paths)', (INV.match(/sample: isSampleProject\(project\),/g) ?? []).length === 2);
  ok('…with a [Sample] subject on both paths', (INV.match(/\.\.\.\(isSampleProject\(project\) \? \{ subject: sampleEmailSubject\(/g) ?? []).length === 2);
  ok('no financing referral (a lender lead) from a sample', /if \(isFinancingAvailable\(settings\) && projectId && !isSampleProject\(project\)\) \{/.test(run));
  const sheetFx = INV.slice(INV.indexOf('if (!samplePlan.sample) return;'), INV.indexOf('}, [samplePlan, showSendRecipient]);'));
  ok('the sheet opens locked to HIS email, name cleared, portal post off',
    /setPostToPortal\(false\);/.test(sheetFx) && /setSendRecipientEmail\(samplePlan\.to \?\? ''\);/.test(sheetFx) && /setContactPicked\(false\);/.test(sheetFx));
  ok('…declared AFTER the #47 client prefill, so it wins', INV.indexOf('if (!samplePlan.sample) return;') > INV.indexOf('const sendSheetWasOpen = useRef(false);'));
  ok('the sheet shows the locked recipient + the sample note instead of editable fields',
    /\{isSampleJob \? \(\s*<View testID="send-sample-locked">/.test(INV) && /\) : contactPicked \? \(/.test(INV) && /testID="send-sample-note"/.test(INV));
  ok('"Also post to client portal" is hidden on a sample', /\{!isSampleJob && \(\s*<TouchableOpacity\s+style=\{\[styles\.portalPostRow/.test(INV));
  ok('Send to Client (portal) is hidden on a sample', /\{existingInvoice && !isSampleJob && \(\s*<SendToClientButton/.test(INV));
  ok('Send reminder refuses a sample (and says why on screen)',
    /if \(isSampleProject\(projectNameRef\.current\)\) \{\s*showAlert\('Sample job', SAMPLE_NOTHING_SENT\);/.test(region(INV, 'const handleSendReminder = useCallback('))
      && /testID="reminder-sample-note"/.test(INV) && /sendingReminder \|\| isSampleJob\}/.test(INV));
  ok('Generate payment link refuses a sample (and says why on screen)',
    /if \(isSampleProject\(project\)\) \{\s*showAlert\('Sample job', SAMPLE_NOTHING_SENT\);/.test(region(INV, 'const handleGeneratePayLink = useCallback(')) && /testID="pay-link-sample-note"/.test(INV));
  const pdf = INV.slice(INV.indexOf('const handleSendPDF = useCallback('), INV.indexOf('const handleSendPDF = useCallback(') + 700);
  ok('the PDF email path is locked to him too, and opens on his address',
    /options\.method === 'email' && !sampleSendAllowed\(project, options\.recipient, userEmailRef\.current\)/.test(pdf)
      && /const pdfDefaultRecipient = samplePlan\.sample \? \(samplePlan\.to \?\? ''\) : clientPdfRecipient;/.test(INV));

  // ── the REAL path is untouched ──
  ok('REAL: the Send & Save button is still the pinned one', /label=\{sendInFlight \? 'Sending…' : 'Send & Save'\}\s*onPress=\{handleSendPress\}\s*disabled=\{sendInFlight\}/.test(INV));
  ok('REAL: the mint is still called for the balance and the recipient', run.includes('const minted = await mintPayLinkFor(workingInvoice, balanceDue, sendRecipientEmail.trim());'));
  ok('REAL: the portal post is still gated on the tick AND a live portal only', /if \(postToPortal && portalEnabled\)/.test(run));
  ok('REAL: the email goes to the typed recipient', /const result = await sendEmail\(\{\s*to: sendRecipientEmail\.trim\(\),/.test(run));
  ok('REAL: the Stripe-not-connected branch is intact', /\} else if \(minted\.reason === 'not_connected'\) \{\s*console\.log\('\[Invoice\] Skipping payment link/.test(run));
  ok('REAL: every sample override is conditional (spread / ternary / guard), never unconditional',
    !/\bsubject: sampleEmailSubject\(/.test(INV.replace(/\.\.\.\(isSampleProject\(project\) \? \{ subject: sampleEmailSubject\(/g, '')) && !/sample: true/.test(INV));
  ok('REAL: a real job gets { sample: false } and passes the send guard with a client address',
    G.sampleSendPlan({ name: 'Maple St' }, 'gc@example.com').sample === false && G.sampleSendAllowed({ name: 'Maple St' }, 'client@example.com', 'gc@example.com'));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n5. components/Paywall.tsx (source)');
{
  const PW = strip(read('components/Paywall.tsx'));
  ok('two optional props: practiceTutorialId, source', /practiceTutorialId\?: TutorialId;/.test(PW) && /source\?: string;/.test(PW)
    && /export default function Paywall\(\{ visible, onClose, feature, requiredTier, practiceTutorialId, source \}: PaywallProps\)/.test(PW));
  ok('PAYWALL_VIEWED carries source when given (and nothing extra when not)',
    /track\(AnalyticsEvents\.PAYWALL_VIEWED, \{ feature, tier_blocked: requiredTier, \.\.\.\(source \? \{ source \} : \{\}\) \}\);/.test(PW) && /\}, \[visible, feature, requiredTier, source\]\);/.test(PW));
  ok('the offer is decided by paywallPracticeOffer (pass, practised, live run)', /paywallPracticeOffer\(\{\s*tutorialId: practiceTutorialId,/.test(PW) && /runActive: tutorialRunActive/.test(PW));
  ok('shown in BOTH the native and the web paywall', (PW.match(/\{practiceBlock\}/g) ?? []).length === 2);
  ok('…under the plans: after the Upgrade / store buttons, before "Not now"',
    PW.indexOf('{practiceBlock}') > PW.indexOf('testID="paywall-open-play-store"') && PW.lastIndexOf('{practiceBlock}') > PW.indexOf('testID="paywall-upgrade-btn"')
      && PW.lastIndexOf('{practiceBlock}') < PW.indexOf('testID="paywall-not-now"'));
  const h = PW.slice(PW.indexOf('const handlePracticeFirst = useCallback('), PW.indexOf('const practiceBlock'));
  ok("tap: the caller's onClose first, THEN startTutorial(entry 'paywall', returnTo the gated screen)",
    h.indexOf('onClose();') > 0 && h.indexOf("startTutorial(practiceOffer.tutorialId, { entry: 'paywall', returnTo })") > h.indexOf('onClose();')
      && /const returnTo = chipReturnTo\(pathname, routeParams/.test(h));
  ok('the offer fires tutorial_offered {entry: paywall} when shown', /track\(AnalyticsEvents\.TUTORIAL_OFFERED, \{ tutorial_id: offeredTutorialId, entry: 'paywall' \}\);/.test(PW));
  ok('the offer is a secondary (outlined) action — the accent stays on Upgrade', /practiceBtn: \{[\s\S]*?borderColor: t\.line,[\s\S]*?backgroundColor: t\.surface,/.test(PW));
  ok('its hit target is at least the comfortable 48', /minHeight: Tokens\.touchTarget\.comfortable/.test(PW));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\nR. the sample never opens on the retainage ask');
// Integration review: the seed recorded no retainage (no invoice rate, no
// project term, no pay apps), so /invoice on a fresh sample opened "Retainage
// on this job" on mount and the invoice.modalUp blocker hid step 1's coach.
{
  const RS = await import('@/utils/retainageSource');
  const FX = await import('@/utils/tutorial/fixtures');
  const seededInvoices = [
    { id: 'i1', number: 1, status: 'paid' as const, createdAt: '2026-08-01' },
    { id: 'i2', number: 2, status: 'sent' as const, createdAt: '2026-08-20' },
  ];
  const r = RS.resolveRetainagePercent({ invoice: null, priorInvoices: seededInvoices as never, project: { ...FX.SAMPLE_RETAINAGE }, payApps: [] });
  ok('the sample term resolves without an ask (needsAsk false, 0 %)', r.needsAsk === false && r.percent === 0);
  const bare = RS.resolveRetainagePercent({ invoice: null, priorInvoices: seededInvoices as never, project: {}, payApps: [] });
  ok('…control: with no term the screen WOULD ask (so the term is what fixes it)', bare.needsAsk === true);
  const SEED = strip(read('utils/demoSeed.ts'));
  const small = SEED.slice(SEED.indexOf('async function seedSmall('), SEED.indexOf('async function seedSmall(') + 2500);
  ok('seedSmall records the term on the new sample', /\.\.\.SAMPLE_RETAINAGE,/.test(small));
  const SBX = strip(read('utils/tutorial/sandbox.ts'));
  ok('older samples get it patched on with the estimate lines (never over a recorded rate)',
    /patchEstimateLines\(existing, deps\);\s*patchRetainage\(existing, deps\);/.test(SBX)
      && /if \(!needsRetainage\(p\) \|\| retainagePatched\.has\(p\.id\)\) return;/.test(SBX));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
