// scripts/validate-appstore-paywall.ts — the three native purchase screens
// pass App Review (guidelines 3.1.1, 3.1.2, 2.1, 2.3.10).
//
// MAGE ID's first App Store submission (build 18) runs this code on the
// reviewer's first launch. The 2026-10 App Review audit (findings 1, 2, 3, 5,
// 8, 11) found, on the three screens that sell a subscription:
//   components/Paywall.tsx   — the modal every gated screen opens: no Terms,
//                              no Privacy, no Restore, no auto-renew text, a
//                              per-month figure bigger than the amount billed,
//                              an email path for an unsellable plan.
//   app/paywall.tsx          — "Contact us for {plan}" + mailto when a plan has
//                              no store product, "(Android: beta)" rows, an
//                              Enterprise alert that said to email us, and
//                              "Early access" rows for products that do not exist.
//   app/onboarding-paywall.tsx — the per-month figure bigger than the yearly
//                              total, and "Cancel anytime in Settings" where
//                              the store's settings are where you cancel.
// And contexts/SubscriptionContext.tsx once threw a developer setup
// instruction that a screen showed verbatim.
//
// What this pins, per screen, on its NATIVE path (the web branches —
// WebPaywallView, the modal's "Continue on mobile" card — keep their own copy):
//   1. Privacy + Terms links to mageid.app, and a Restore that runs
//      restorePurchases through restoreOutcome.
//   2. The auto-renew sentence, from the one shared autoRenewText().
//   3. None of: mailto:, "Contact us", "by email", "Android", "beta",
//      "Early access", "Priority queue", "Not in the …", "App Store yet".
//   4. No purchase error.message reaches showAlert or a <Text>; a failure is
//      only CLASSIFIED (purchaseFailureKind) and answered with our own copy.
//   5. The "package not configured" developer text is gone from the context;
//      every purchase throw is PLAN_UNAVAILABLE_MESSAGE, which is plain copy.
//   6. The billed amount is the big figure: on annual, the yearly total + "/year".
//   7. A plan with no store package has no card; no package at all is ONE
//      honest state with a Retry that refetches the offerings.
// And it EXECUTES the pure storeOffer block in components/Paywall.tsx.
//
// Run: bun run scripts/validate-appstore-paywall.ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

declare const Bun: { Transpiler: new (o: { loader: 'ts' }) => { transformSync: (c: string) => string } };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** Comments removed (block, JSX block, whole-line and trailing //), so a comment can neither satisfy nor trip a rule. */
const code = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/([;,{}()\]])\s*\/\/.*$/gm, '$1');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, why ? `\n      ${why}` : ''); }
}
function eq<T>(name: string, got: T, want: T) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(name, g === w, `got ${g}, want ${w}`);
}
function between(src: string, start: string, end: string, label: string): string {
  const a = src.indexOf(start);
  const b = a < 0 ? -1 : src.indexOf(end, a + start.length);
  if (a < 0 || b < 0) {
    ok(`${label}: anchor found`, false, `missing ${JSON.stringify(a < 0 ? start : end)}`);
    return '';
  }
  return src.slice(a, b);
}

const MODAL = 'components/Paywall.tsx';
const SCREEN = 'app/paywall.tsx';
const ONBOARD = 'app/onboarding-paywall.tsx';
const CTX = 'contexts/SubscriptionContext.tsx';
const modalSrc = read(MODAL);
const screenSrc = read(SCREEN);
const onboardSrc = read(ONBOARD);
const ctxSrc = read(CTX);

// ── The pure block, executed ─────────────────────────────────────────────────
console.log('\nstoreOffer (components/Paywall.tsx), executed:');
const BEGIN = '// --- BEGIN storeOffer';
const END = '// --- END storeOffer ---';
const bFrom = modalSrc.indexOf(BEGIN), bTo = modalSrc.indexOf(END);
if (bFrom < 0 || bTo < 0) {
  console.error(`\n  ✗ could not find the storeOffer sentinels in ${MODAL}. Restore them — the purchase-screen rules would go unpinned.`);
  process.exit(1);
}
type Period = 'monthly' | 'annual';
const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(modalSrc.slice(bFrom, bTo).replace(/^export /gm, ''));
const lib = new Function(`${js}\nreturn { storePlanState, soldPeriod, purchaseFailureKind, storeSafeLabel, plansLoadFailedText, autoRenewText, AUTO_RENEW_IOS };`)() as {
  storePlanState: (o: { loading: boolean; anyPackage: boolean; planPackage: boolean }) => string;
  soldPeriod: (want: Period, monthly: boolean, annual: boolean) => Period | null;
  purchaseFailureKind: (raw: string, planSellable: boolean) => 'unavailable' | 'failed';
  storeSafeLabel: (label: string, os: string) => string;
  plansLoadFailedText: (os: string) => string;
  autoRenewText: (os: string) => string;
  AUTO_RENEW_IOS: string;
};

eq('a plan with its package is ready, even mid-load', lib.storePlanState({ loading: true, anyPackage: true, planPackage: true }), 'ready');
eq('nothing yet, still loading → loading (no invented price)', lib.storePlanState({ loading: true, anyPackage: false, planPackage: false }), 'loading');
eq('loaded, no package anywhere → store-unreachable (one honest state)', lib.storePlanState({ loading: false, anyPackage: false, planPackage: false }), 'store-unreachable');
eq('loaded, others sell, not this plan → plan-unavailable', lib.storePlanState({ loading: false, anyPackage: true, planPackage: false }), 'plan-unavailable');
eq('annual picked and sold → annual', lib.soldPeriod('annual', true, true), 'annual');
eq('annual picked, only monthly sold → monthly (never a buy that must fail)', lib.soldPeriod('annual', true, false), 'monthly');
eq('monthly picked, only annual sold → annual', lib.soldPeriod('monthly', false, true), 'annual');
eq('monthly picked and sold → monthly', lib.soldPeriod('monthly', true, true), 'monthly');
eq('nothing sold → null', lib.soldPeriod('annual', false, false), null);
eq('unsellable plan → unavailable, whatever the store said', lib.purchaseFailureKind('network down', false), 'unavailable');
eq('store says not available → unavailable', lib.purchaseFailureKind('The product is not available for purchase.', true), 'unavailable');
eq('our own copy → unavailable', lib.purchaseFailureKind('This plan isn’t available right now. Try again later.', true), 'unavailable');
eq('a card decline → failed (generic, never echoed)', lib.purchaseFailureKind('Payment declined', true), 'failed');
eq('iOS label drops "(Android: beta)"', lib.storeSafeLabel('Voice-to-report (Android: beta)', 'ios'), 'Voice-to-report');
eq('…mid-label too', lib.storeSafeLabel('Plan viewer · sheet pinning (Android: beta)', 'ios'), 'Plan viewer · sheet pinning');
eq('Android build drops it as well (no "beta" in a store build)', lib.storeSafeLabel('Voice-to-report (Android: beta)', 'android'), 'Voice-to-report');
eq('web keeps its label', lib.storeSafeLabel('Voice-to-report (Android: beta)', 'web'), 'Voice-to-report (Android: beta)');
eq('iOS: the store-unreachable sentence', lib.plansLoadFailedText('ios'), 'Plans couldn’t load from the App Store. Check your connection and try again.');
ok('Android: names Google Play, never the App Store', /Google Play/.test(lib.plansLoadFailedText('android')) && !/App Store/.test(lib.plansLoadFailedText('android')));
const AUTO_RENEW_EXPECTED = 'Subscriptions auto-renew until canceled. Manage or cancel in your App Store account settings at least 24 hours before the renewal date. Payment is charged to your Apple ID on confirmation of purchase.';
eq('iOS auto-renew sentence (Apple 3.1.2 wording, unchanged from app/paywall.tsx)', lib.autoRenewText('ios'), AUTO_RENEW_EXPECTED);
eq('AUTO_RENEW_IOS is that sentence', lib.AUTO_RENEW_IOS, AUTO_RENEW_EXPECTED);
ok('Android auto-renew names Google, not Apple', /Google Play account/.test(lib.autoRenewText('android')) && !/Apple|App Store/.test(lib.autoRenewText('android')));
ok('iOS auto-renew never names Android or Google', !/Android|Google/.test(lib.autoRenewText('ios')));
ok('American spelling: "canceled", never "cancelled"', !/cancelled/i.test(lib.autoRenewText('ios') + lib.autoRenewText('android')));

// ── The native paths ─────────────────────────────────────────────────────────
// Modal: everything but its web branch (the "Continue on mobile" card).
const modalCode = code(modalSrc);
// The storeOffer block is executed above; its regex names the note it strips.
const modalCodeNoBlock = code(modalSrc.slice(0, bFrom) + modalSrc.slice(bTo));
const modalWebBranch = between(modalCode, "if (Platform.OS === 'web') {\n    return (", '\n  return (\n    <Modal visible={visible} animationType="slide"', 'modal web branch');
const modalNative = modalCodeNoBlock.replace(modalWebBranch, '').replace(/^const (IOS|ANDROID)_APP_URL = .*$/gm, '');
const modalNativeJsx = between(modalCode, '\n  return (\n    <Modal visible={visible} animationType="slide"', '\nconst makeStyles', 'modal native JSX');
// Screen: everything but WebPaywallView, the web branch, and the label table
// (its labels render through storeSafeLabel — executed below).
const screenCode = code(screenSrc);
const screenWebBranch = between(screenCode, "if (Platform.OS === 'web') {\n    return (\n      <WebPaywallView", '\n  return (\n    <View style={[styles.container', 'screen web branch');
const screenWebView = between(screenCode, 'function WebPaywallView(', '\nconst makeStyles', 'WebPaywallView');
const featureSpecs = between(screenCode, 'const FEATURE_SPECS: FeatureRowSpec[] = [', '\n];', 'FEATURE_SPECS');
const screenNative = screenCode.replace(screenWebBranch, '').replace(screenWebView, '').replace(featureSpecs, '');
const screenNativeJsx = between(screenCode, '\n  return (\n    <View style={[styles.container', '\nfunction WebPaywallView(', 'screen native JSX');
// Onboarding: one tree for every platform; all of it is a native path.
const onboardCode = code(onboardSrc);
const onboardNative = onboardCode;
const onboardJsx = between(onboardCode, '\n  return (\n    <View style={[styles.root', '\ninterface PlanCardProps', 'onboarding JSX');

const NATIVE: { f: string; all: string; jsx: string }[] = [
  { f: MODAL, all: modalNative, jsx: modalNativeJsx },
  { f: SCREEN, all: screenNative, jsx: screenNativeJsx },
  { f: ONBOARD, all: onboardNative, jsx: onboardJsx },
];

console.log('\n1-2. Terms, Privacy, Restore and the auto-renew sentence on each native path:');
for (const { f, all, jsx } of NATIVE) {
  ok(`${f}: Privacy opens https://mageid.app/privacy`, /'https:\/\/mageid\.app\/privacy'/.test(all) && /onPress=\{\(\) => openLegal\('privacy'\)\}/.test(jsx));
  ok(`${f}: Terms opens https://mageid.app/terms`, /'https:\/\/mageid\.app\/terms'/.test(all) && /onPress=\{\(\) => openLegal\('terms'\)\}/.test(jsx));
  ok(`${f}: a Restore control runs handleRestore`, /onPress=\{handleRestore\}[^>]*>\s*<Text[^>]*>Restore<\/Text>/.test(jsx));
  ok(`${f}: handleRestore calls restorePurchases and answers through restoreOutcome`,
    /const handleRestore = useCallback\(async \(\) => \{[\s\S]{0,700}await restorePurchases\(\)[\s\S]{0,400}const outcome = restoreOutcome\(result, store\);\s*showAlert\(outcome\.title, outcome\.body\);/.test(all));
  ok(`${f}: renders the shared auto-renew sentence`, /(?:\{|: )autoRenewText\(Platform\.OS\)\}/.test(jsx));
}
ok(`${SCREEN}: the auto-renew sentence comes from components/Paywall (one wording)`, /import \{[^}]*\bautoRenewText\b[^}]*\} from '@\/components\/Paywall'/.test(screenCode));
ok(`${ONBOARD}: the auto-renew sentence comes from components/Paywall (one wording)`, /import \{[^}]*\bautoRenewText\b[^}]*\} from '@\/components\/Paywall'/.test(onboardCode));
ok(`${ONBOARD}: "Cancel anytime in Settings" is gone from the native tree`,
  !/Cancel anytime in Settings/.test(onboardCode.replace(/Platform\.OS === 'web'\s*\?\s*'Cancel anytime in Settings\. No hidden fees\.'/, '')));
ok(`${MODAL}: the "Cancel anytime" footer is gone`, !/Cancel anytime/i.test(modalNativeJsx));
ok(`${SCREEN}: …and from the plans screen's native footer`, !/Cancel anytime/i.test(screenNativeJsx));

console.log('\n3. Nothing on a native path names email, Android, a beta, or a feature that does not exist:');
const FORBIDDEN: { re: RegExp; why: string }[] = [
  { re: /mailto:/i, why: 'an email path (3.1.1: purchases go through the store)' },
  { re: /Contact us/i, why: 'a "Contact us" path for a plan' },
  { re: /by email/i, why: '"we set it up by email"' },
  { re: /support@mageid\.app/, why: 'an email address in a purchase path' },
  { re: /Android/, why: 'another platform named (2.3.10)' },
  { re: /\bbeta\b/i, why: 'a beta reference (2.3.10 / 2.2)' },
  { re: /Early access/i, why: 'a product that does not exist (2.1)' },
  { re: /Priority queue/i, why: 'a feature that does not exist (2.1)' },
  { re: /Not in the \$\{|Not in the (App|Play) Store/, why: '"Not in the App Store yet"' },
  { re: /App Store yet|still being set up/i, why: 'a setup state shown to a buyer' },
];
for (const { f, all } of NATIVE) {
  for (const { re, why } of FORBIDDEN) {
    const m = re.exec(all);
    ok(`${f}: no ${re.source}`, !m, m ? `${why}: …${all.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\s+/g, ' ')}…` : undefined);
  }
}
// The label table renders through storeSafeLabel, and no label survives it with a platform note.
const labels = [...featureSpecs.matchAll(/label: '([^']*)'/g)].map(m => m[1]);
ok(`${SCREEN}: FEATURE_SPECS read (${labels.length} labels)`, labels.length >= 10);
const leaked = labels.map(l => lib.storeSafeLabel(l, 'ios')).filter(l => /Android|\bbeta\b/i.test(l));
ok(`${SCREEN}: no FEATURE_SPECS label names Android or a beta on iOS`, leaked.length === 0, leaked.join(' | '));
ok(`${SCREEN}: the native compare table prints storeSafeLabel(f.label, Platform.OS)`,
  /\{FEATURES\.map\(\(f\) => \([\s\S]{0,300}\{storeSafeLabel\(f\.label, Platform\.OS\)\}/.test(screenNativeJsx) && !/\{f\.label\}<\/Text>/.test(screenNativeJsx));

console.log('\n4. No purchase error text reaches the customer:');
for (const { f, all } of NATIVE) {
  const echoes = all.match(/showAlert\([^;]*?\b(?:err|error|e|rawMsg|msg|message)\b(?:\.message)?\s*[,)]/g) ?? [];
  ok(`${f}: showAlert is never handed an error or its message`, echoes.length === 0, echoes.join(' | '));
  ok(`${f}: no <Text> renders an error's message`, !/\{\s*(?:err|error|e)\??\.message\s*\}/.test(all));
}
ok(`${MODAL}: the raw message is only classified (purchaseFailureKind), never shown`,
  /purchaseFailureKind\(rawMsg, tierPackageAvailable\)/.test(modalNative) && (modalNative.match(/\brawMsg\b/g) ?? []).length === 2);

console.log('\n5. The developer setup text is gone from the purchase functions:');
const ctxCode = code(ctxSrc);
// Any string literal (console lines excepted: they never reach a screen).
const ctxStrings = (ctxCode.replace(/console\.(?:log|warn|error)\([^\n]*\n/g, '\n').match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) ?? []);
const setupText = ctxStrings.filter(t => /not configured|Set up the product|App Store Connect|Play Console/i.test(t));
ok(`${CTX}: no "package not configured" / setup instruction in any string`, setupText.length === 0, setupText.join(' | '));
const msg = /export const PLAN_UNAVAILABLE_MESSAGE = '([^']*)';/.exec(ctxCode)?.[1] ?? '';
eq(`${CTX}: PLAN_UNAVAILABLE_MESSAGE is plain customer copy`, msg, 'This plan isn’t available right now. Try again later.');
ok(`${CTX}: …and names no store console, package or SDK`, msg !== '' && !/RevenueCat|App Store Connect|Play Console|package|configur|product/i.test(msg));
const throws = ctxCode.match(/throw new Error\([^)]*\)/g) ?? [];
const purchaseFns = between(ctxCode, 'const purchasePro = useCallback(', 'const restorePurchases = useCallback(', 'purchase functions');
const purchaseThrows = purchaseFns.match(/throw new Error\([^)]*\)/g) ?? [];
ok(`${CTX}: all three purchase throws are PLAN_UNAVAILABLE_MESSAGE`, purchaseThrows.length === 3 && purchaseThrows.every(t => t === 'throw new Error(PLAN_UNAVAILABLE_MESSAGE)'), purchaseThrows.join(' | '));
ok(`${CTX}: no other Error in the file carries setup text`, !throws.some(t => /configur|App Store Connect|RevenueCat first/i.test(t)), throws.join(' | '));

console.log('\n6. The billed amount is the big figure:');
{
  const box = between(modalNativeJsx, '<View style={styles.priceBox}>', '\n          </View>\n', 'modal price box');
  ok(`${MODAL}: annual's big figure is the yearly total + "/year"`, /<Text style=\{styles\.priceBig\}>\{pricing\.annualPrice\}\/year<\/Text>/.test(box));
  ok(`${MODAL}: the per-month equivalent is the small line`, /<Text style=\{styles\.priceSub\}>\{`That’s \$\{pricing\.monthlyEquivalent\}\/mo/.test(box));
  ok(`${MODAL}: the per-month figure is never the big one`, !/priceBig\}>\{pricing\.monthlyEquivalent\}/.test(box));
  ok(`${MODAL}: the price shown is the period actually sold`, /shownPeriod === 'monthly'/.test(box));
  ok(`${ONBOARD}: annual card's big figure is the yearly total`,
    /priceTop=\{\s*proPeriod === 'annual' \? pricing\.proAnnualTotal : pricing\.proMonthly\s*\}/.test(onboardJsx)
    && /priceTop=\{\s*businessPeriod === 'annual'\s*\? pricing\.businessAnnualTotal\s*: pricing\.businessMonthly\s*\}/.test(onboardJsx));
  ok(`${ONBOARD}: …with "/year" as its unit, "/mo" only on monthly`,
    /priceUnit=\{proPeriod === 'annual' \? '\/year' : '\/mo'\}/.test(onboardJsx)
    && /priceUnit=\{businessPeriod === 'annual' \? '\/year' : '\/mo'\}/.test(onboardJsx)
    && /<Text style=\{styles\.planPriceUnit\}>\{priceUnit\}<\/Text>/.test(onboardCode));
  ok(`${ONBOARD}: a card shows the period the store sells for that plan (soldPeriod)`,
    /const proPeriod: Period = \(nativeStore \? soldPeriod\(selectedPeriod, !!proPackage, !!proAnnualPackage\) : null\) \?\? selectedPeriod;/.test(onboardCode)
    && /await purchasePro\(activePeriod\)/.test(onboardCode) && /await purchaseBusiness\(activePeriod\)/.test(onboardCode));
  ok(`${ONBOARD}: the per-month equivalent sits in the small line`, /`That’s \$\{pricing\.proAnnualPerMonth\}\/mo`/.test(onboardJsx) && /`That’s \$\{pricing\.businessAnnualPerMonth\}\/mo`/.test(onboardJsx));
  ok(`${ONBOARD}: the footnote leads with the yearly total`, /`\$\{total\}\/year · billed annually/.test(onboardCode));
}

console.log('\n7. No card without a store package; no packages at all is one honest state with a Retry:');
for (const t of ['pro', 'business', 'enterprise'] as const) {
  ok(`${SCREEN}: the ${t} card is not rendered when its package is missing`, new RegExp(`\\{!unavailable\\.${t} && \\(`).test(screenNativeJsx));
}
ok(`${SCREEN}: the store-unreachable state replaces the fallback list-price cards`,
  /\{isFallbackPricing \? \(\s*<StorePlansUnavailable/.test(screenNativeJsx) && !/Can't reach the \$\{storeName\}/.test(screenNativeJsx));
ok(`${MODAL}: plan-unavailable and store-unreachable render StorePlansUnavailable, not a price or a buy button`,
  /planState === 'ready' \?[\s\S]*testID="paywall-upgrade-btn"[\s\S]*: planState === 'loading' \?[\s\S]*: \(\s*<StorePlansUnavailable/.test(modalNativeJsx));
ok(`${ONBOARD}: a plan with no package has no card on native`, /\{showPro && \(\s*<PlanCard/.test(onboardJsx) && /\{showBusiness && \(\s*<PlanCard/.test(onboardJsx));
ok(`${ONBOARD}: no packages at all → StorePlansUnavailable instead of the cards and the buy button`,
  /\{storeUnreachable \? \(\s*<StorePlansUnavailable/.test(onboardJsx));
ok(`${ONBOARD}: the web keeps every card (the gate is native-only)`, /const nativeStore = Platform\.OS !== 'web';/.test(onboardCode));
ok(`${MODAL}: Retry refetches the offerings`, /refetchQueries\(\{ queryKey: \['rc-offerings'\] \}\)/.test(modalCode));
ok(`${CTX}: …the same query key the context loads offerings under`, /queryKey: \['rc-offerings'\]/.test(ctxCode));
for (const { f, jsx } of NATIVE) {
  ok(`${f}: the honest state gets a Retry`, /<StorePlansUnavailable[\s\S]{0,300}onRetry=\{retryPlans\}/.test(jsx));
}
ok(`${MODAL}: StorePlansUnavailable prints the message and a Retry button`,
  /function StorePlansUnavailable\([\s\S]{0,900}\{message\}[\s\S]{0,400}label="Retry"/.test(modalCode));
ok(`${MODAL}: the honest state is drawn in warning tokens`, /storeUnavailableBox: \{[^}]*backgroundColor: t\.warningSoft/.test(modalCode) && /storeUnavailableText: \{[^}]*color: t\.warningLabel/.test(modalCode));

// ── 8. "AIA-style", never an AIA document ───────────────────────────────────
// MAGE's pay app is styled after the AIA G702/G703 forms; it is not an AIA
// document, and a purchase screen is the last place to imply one. Every
// G702/G703 a buyer READS on the three screens says "AIA-style". The one
// allowed bare form is a lookup KEY: components/Paywall.tsx keys FEATURE_PITCH /
// FEATURE_TITLE on the `feature` string app/aia-pay-app.tsx passes
// ('AIA G702/G703 Pay Applications'), and FEATURE_TITLE gives it the words shown.
const AIA_KEY = "'AIA G702/G703 Pay Applications':";
for (const { f, c } of [{ f: MODAL, c: modalCode }, { f: SCREEN, c: screenCode }, { f: ONBOARD, c: onboardCode }]) {
  const shown = c.split(AIA_KEY).join('');
  const bare = [...shown.matchAll(/G70[23]/g)].filter((m) => {
    const before = shown.slice(Math.max(0, (m.index ?? 0) - 16), m.index ?? 0);
    return !/AIA-style (G702\/)?$/.test(before);
  });
  ok(`${f}: every G702/G703 a buyer reads says "AIA-style"`, bare.length === 0,
    bare.map((m) => shown.slice(Math.max(0, (m.index ?? 0) - 30), (m.index ?? 0) + 30).replace(/\s+/g, ' ')).join(' | '));
}
ok(`${MODAL}: the pay-app feature KEY has a display title that says "AIA-style"`,
  new RegExp(`${AIA_KEY.replace(/[/]/g, '\\/')}\\s*'AIA-style G702\\/G703 pay apps'`).test(modalCode));
ok(`${MODAL}: the heading prints the display title, not the raw key`, /const featureTitle = FEATURE_TITLE\[feature\] \?\? feature;/.test(modalCode));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
