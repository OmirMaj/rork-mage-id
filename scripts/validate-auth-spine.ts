// scripts/validate-auth-spine.ts — the auth spine ("Take D") on welcome, login and sign-up.
//
// What it proves:
//   1. THE PLAN (utils/auth/spineSequence.ts, pure). The line reaches the five
//      stops in order (Ask → Estimate → Contract → Schedule → Paid); each line
//      segment leaves a card after that card began to arrive; the signature
//      writes inside the contract's turn; the schedule's bars grow one after
//      another, then Today, then On track; Paid flips after the last segment;
//      the whole welcome sequence ends by SPINE_MAX_MS (7 s) and the mini spine
//      by MINI_MAX_MS. Reduce Motion = the final state: every beat at 0 with no
//      duration, and the runtime clock (components/auth/spineClock.ts) starts at
//      SPINE_FINAL_CLOCK, past every beat of both plans. ramp() bakes the curve
//      into strictly rising points that start at `from` and land on `to`. The
//      signature's five strokes are in pen order and lift before the next.
//   2. THE SCREENS. No hard-hat brand mark in login / signup / onboarding (no
//      HardHat import or element); the monogram asset is referenced and both
//      PNGs exist; every auth testID that origin/main had (195b7361) is still
//      present; the spine cards carry "Sample" and the building-department line.
//   3. NO NATIVE MOTION ON SVG. The only JS-driven animation is the signature's
//      strokeDashoffset (SVG_PROP_DRIVER); every other timing in components/auth/spine* runs on
//      `nativeDriver`, and nothing there loops.
//
// --self-test plants mutations (a reordered stop, a 7.5 s sequence, a reduced
// plan with a live beat, a dropped testID, a hard-hat import) and requires each
// to be caught. Pure: node:fs + the pure plan module; no react-native import.
// Run: bun scripts/validate-auth-spine.ts [--self-test]
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  MINI_MAX_MS, SIGNATURE_STROKES, SPINE_FINAL_CLOCK, SPINE_MAX_MS, curveAt, miniPlan, pathLength, planTotal, ramp,
  signatureSpan, welcomePlan, type Beat, type MiniPlan, type WelcomePlan,
} from '../utils/auth/spineSequence';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

type Check = { name: string; ok: boolean; detail?: string };

/** Comments out, so a quoted rule in a comment never passes for code. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
}

const end = (x: Beat) => x.at + x.dur;

// ── 1. the plan ──────────────────────────────────────────────────────────────
export function checkWelcome(p: WelcomePlan, reduced: WelcomePlan): Check[] {
  const out: Check[] = [];
  const cards = [p.askCard, p.estimateCard, p.contractCard, p.scheduleCard, p.paidCard];
  const lines = [p.line0, p.line1, p.line2, p.line3];
  out.push({ name: 'the five cards arrive in stop order (Ask → Estimate → Contract → Schedule → Paid)',
    ok: cards.every((c, i) => i === 0 || c.at > cards[i - 1].at), detail: cards.map((c) => c.at).join(' < ') });
  out.push({ name: 'each line segment leaves a card after it began to arrive, and the next card comes after the segment starts',
    ok: lines.every((l, i) => l.at > cards[i].at && (i === 3 || cards[i + 1].at >= l.at)),
    detail: lines.map((l, i) => `${cards[i].at}<${l.at}`).join(' ') });
  out.push({ name: 'the line runs downward without overlap (segment k ends before segment k+1 starts)',
    ok: lines.every((l, i) => i === 0 || l.at >= end(lines[i - 1])) });
  out.push({ name: 'the address types after the Ask card arrives; the answer resolves after it, segment by segment',
    ok: p.askType.at >= p.askCard.at && p.ans0.at >= end(p.askType) && p.ans1.at > p.ans0.at && p.ans2.at > p.ans1.at && p.ansTag.at > p.ans2.at });
  out.push({ name: 'the signature writes during the contract’s turn (after it arrives, before the schedule)',
    ok: p.signature.at > p.contractCard.at && p.signature.at < p.scheduleCard.at && p.signature.dur >= signatureSpan()
      && p.signedBy.at >= p.signature.at + signatureSpan() - 20 });
  const bars = [p.bar0, p.bar1, p.bar2, p.bar3];
  out.push({ name: 'the schedule: bars grow one after another, then Today, then On track',
    ok: bars.every((x, i) => x.at >= p.scheduleCard.at && (i === 0 || x.at > bars[i - 1].at))
      && p.today.at > p.bar3.at && p.onTrack.at >= p.today.at && p.todayLabel.at >= p.today.at });
  out.push({ name: 'Paid flips last: after the final segment ends and after the invoice card arrives',
    ok: p.sentOut.at >= end(p.line3) && p.sentOut.at > p.paidCard.at && p.paidIn.at > p.sentOut.at && p.paidNode.at >= end(p.line3) });
  out.push({ name: 'the cards dim as the line leaves them (dim k starts with segment k)',
    ok: [p.dimAsk, p.dimEstimate, p.dimContract, p.dimSchedule].every((d, i) => d.at === lines[i].at) });
  const total = planTotal(p);
  out.push({ name: `the welcome sequence ends by ${SPINE_MAX_MS} ms`, ok: total <= SPINE_MAX_MS && total >= 5000, detail: `${total} ms` });
  out.push({ name: 'Reduce Motion: every welcome beat is the final state (at 0, no duration)',
    ok: Object.values(reduced).every((x) => x.at === 0 && x.dur === 0) && Object.keys(reduced).length === Object.keys(p).length });
  return out;
}

export function checkMini(p: MiniPlan, reduced: MiniPlan): Check[] {
  const chips = [p.chip0, p.chip1, p.chip2, p.chip3, p.chip4];
  const dims = [p.dim0, p.dim1, p.dim2, p.dim3];
  return [
    { name: 'mini spine: the five chips arrive in stop order', ok: chips.every((c, i) => i === 0 || c.at > end(chips[i - 1]) - 1) },
    { name: 'mini spine: a chip dims only after it has landed', ok: dims.every((d, i) => d.at >= end(chips[i])) },
    { name: 'mini spine: Paid flips after the last segment and the last chip',
      ok: p.sentOut.at >= end(p.line3) && p.sentOut.at >= p.chip4.at },
    { name: `mini spine ends by ${MINI_MAX_MS} ms`, ok: planTotal(p) <= MINI_MAX_MS, detail: `${planTotal(p)} ms` },
    { name: 'mini spine Reduce Motion: every beat is the final state',
      ok: Object.values(reduced).every((x) => x.at === 0 && x.dur === 0) },
  ];
}

export function checkMath(): Check[] {
  const out: Check[] = [];
  const r = ramp({ at: 100, dur: 400 }, 40, 0, 'out');
  const rising = r.inputRange.every((v, i) => i === 0 || v > r.inputRange[i - 1]);
  out.push({ name: 'ramp(): strictly rising input from at to at+dur, output from → to',
    ok: rising && r.inputRange[0] === 100 && r.inputRange[r.inputRange.length - 1] === 500
      && r.outputRange[0] === 40 && r.outputRange[r.outputRange.length - 1] === 0 });
  const z = ramp({ at: 0, dur: 0 }, 0, 1);
  out.push({ name: 'ramp() of a reduced beat still rises (0 → 1 ms) and lands on `to`',
    ok: z.inputRange[1] > z.inputRange[0] && z.outputRange[1] === 1 });
  out.push({ name: 'curves: out and sine run 0 → 1, out is ahead of linear at the midpoint',
    ok: curveAt('out', 0) === 0 && curveAt('out', 1) === 1 && curveAt('sine', 1) === 1 && curveAt('out', 0.5) > 0.5 });
  out.push({ name: 'SPINE_FINAL_CLOCK lies past every beat of both plans',
    ok: SPINE_FINAL_CLOCK > planTotal(welcomePlan()) && SPINE_FINAL_CLOCK > planTotal(miniPlan()) });
  const lens = SIGNATURE_STROKES.map(([d]) => pathLength(d));
  // The strokes were timed at about one path unit per millisecond: the three
  // long ones (D, ana, R+uiz) must measure within 15 % of their durations.
  out.push({ name: 'pathLength(): a straight cubic of 10 units measures 10; the long strokes run ~1 unit per ms',
    ok: Math.abs(pathLength('M0 0C0 0 10 0 10 0') - 10) < 0.01 && lens.every((l) => l > 2)
      && [0, 1, 3].every((i) => Math.abs(lens[i] - SIGNATURE_STROKES[i][2]) / SIGNATURE_STROKES[i][2] < 0.15),
    detail: lens.map((l) => l.toFixed(0)).join(',') });
  out.push({ name: 'the signature: five strokes in pen order, each lifting before the next; ~0.9 s in all',
    ok: SIGNATURE_STROKES.length === 5 && SIGNATURE_STROKES.every(([, so, sd], i) => i === 0 || so >= SIGNATURE_STROKES[i - 1][1] + SIGNATURE_STROKES[i - 1][2])
      && signatureSpan() >= 800 && signatureSpan() <= 1000 });
  return out;
}

// ── 2. the screens ───────────────────────────────────────────────────────────
/** Every auth testID origin/main (195b7361) carried. New ones may be added; none may go. */
export const BASE_TEST_IDS: Record<string, string[]> = {
  'app/login.tsx': [
    'login-apple', 'login-biometric', 'login-email', 'login-forgot', 'login-go-signup', 'login-google',
    'login-invite-opened-elsewhere', 'login-magic-link', 'login-password', 'login-remember', 'login-show-password-mode', 'login-submit',
  ],
  'app/signup.tsx': [
    'signup-apple-top', 'signup-email', 'signup-go-login', 'signup-google-top', 'signup-name', 'signup-password',
    // WEBCANCEL: the older sentence under Create Account (signup-terms-link,
    // signup-privacy-link) is gone; the shared notice above the buttons stays.
    'signup-agreement', 'signup-submit',
  ],
  'app/onboarding.tsx': [
    'onboarding-company-name', 'onboarding-cta', 'onboarding-preview-next', 'onboarding-rates-blob', 'onboarding-rates-commit',
    'onboarding-rates-review', 'onboarding-rates-skip', 'onboarding-skip', 'onboarding-tour-sample', 'onboarding-preview-card-${cardIndex}',
  ],
};
/** Accessibility labels of the auth controls on origin/main, kept verbatim. */
const BASE_LABELS: Record<string, string[]> = {
  'app/signup.tsx': ['accessibilityLabel="Back"'],
  'app/onboarding.tsx': ['accessibilityLabel="Get Started with MAGE ID"', 'accessibilityLabel="Try It on a Sample Project"'],
};

export function hasTestId(src: string, id: string): boolean {
  return id.includes('${') ? src.includes('testID={`' + id + '`}') : src.includes(`testID="${id}"`);
}

export function checkScreens(files: Record<string, string>): Check[] {
  const out: Check[] = [];
  for (const f of ['app/login.tsx', 'app/signup.tsx', 'app/onboarding.tsx']) {
    const c = code(files[f]);
    out.push({ name: `${f}: no hard-hat brand mark (no HardHat import or element)`, ok: !/\bHardHat\b/.test(c) });
    const missing = BASE_TEST_IDS[f].filter((id) => !hasTestId(c, id));
    out.push({ name: `${f}: every origin/main testID is still present (${BASE_TEST_IDS[f].length})`, ok: missing.length === 0, detail: missing.join(', ') });
    const lost = (BASE_LABELS[f] ?? []).filter((l) => !c.includes(l));
    out.push({ name: `${f}: the auth controls keep their accessibility labels`, ok: lost.length === 0, detail: lost.join(', ') });
  }
  const login = code(files['app/login.tsx']);
  const signup = code(files['app/signup.tsx']);
  const onboarding = code(files['app/onboarding.tsx']);
  out.push({ name: 'login + signup show the mini spine on phone and the full spine on desktop web',
    ok: [login, signup].every((s) => /<MiniSpine\b/.test(s) && /<SpineHero\b/.test(s) && /useIsDesktopWeb\(\)/.test(s)) });
  // The welcome step only reaches accounts that are ALREADY signed in (the _layout
  // gate sends signed-out visitors to /login), so an "I already have an account"
  // button there is misleading — and Skip already takes the same exit.
  out.push({ name: 'onboarding’s welcome step shows the spine, Get started and Skip — and no "I already have an account" button',
    ok: /<SpineHero\b/.test(onboarding) && /testID="onboarding-cta"/.test(onboarding) && /testID="onboarding-skip"/.test(onboarding)
      && !/onboarding-have-account/.test(onboarding) && !/I already have an account/i.test(onboarding) });
  out.push({ name: 'the three screens paint the night ground and the monogram',
    ok: [login, signup, onboarding].every((s) => /<AuthGround\b/.test(s) && /<MonogramMark\b/.test(s)) });
  const ground = code(files['components/auth/AuthGround.tsx']);
  out.push({ name: 'the monogram assets are referenced (on dark, on light) and exist',
    ok: /require\('@\/assets\/images\/brand\/mage-mark-on-dark\.png'\)/.test(ground)
      && /require\('@\/assets\/images\/brand\/mage-mark-on-light\.png'\)/.test(ground)
      && existsSync(join(ROOT, 'assets/images/brand/mage-mark-on-dark.png')) && existsSync(join(ROOT, 'assets/images/brand/mage-mark-on-light.png')) });
  const hero = code(files['components/auth/SpineHero.tsx']);
  const mini = code(files['components/auth/MiniSpine.tsx']);
  const tags = (hero.match(/<SampleTag\b/g) ?? []).length;
  out.push({ name: 'every welcome card says Sample (5 cards, a Sample tag on each)', ok: tags >= 5, detail: `${tags} tags` });
  out.push({ name: 'the building-department line sits under the spine',
    ok: />\s*Sample\. Confirm requirements with your building department\.\s*<\/Animated\.Text>/.test(hero) });
  out.push({ name: 'the mini spine and its screens are labelled a sample project',
    ok: /Sample project/.test(mini) && [login, signup].every((s) => /<SamplePill\b/.test(s)) });
  out.push({ name: 'the spine is decoration: pointerEvents="none" on both rigs (no animation blocks a touch)',
    ok: /pointerEvents="none"/.test(hero) && /pointerEvents="none"/.test(mini) });
  return out;
}

// ── 3. motion rules ──────────────────────────────────────────────────────────
export function checkMotion(files: Record<string, string>): Check[] {
  const clock = code(files['components/auth/spineClock.ts']);
  const all = ['components/auth/spineClock.ts', 'components/auth/SpineHero.tsx', 'components/auth/MiniSpine.tsx',
    'components/auth/SpineParts.tsx', 'components/auth/SignatureStroke.tsx', 'components/auth/AuthGround.tsx'].map((f) => code(files[f])).join('\n');
  const drivers = [...all.matchAll(/useNativeDriver:\s*([\w.]+)/g)].map((m) => m[1]);
  return [
    { name: 'one clock on `nativeDriver`; the signature (SVG_PROP_DRIVER = false) is the only JS-driven value',
      ok: /useNativeDriver: nativeDriver/.test(clock) && /export const SVG_PROP_DRIVER = false;/.test(clock)
        && drivers.filter((d) => d !== 'nativeDriver').length === 1 && drivers.filter((d) => d === 'SVG_PROP_DRIVER').length === 1,
      detail: drivers.join(',') },
    { name: 'no `useNativeDriver: true` literal, no loop, no reanimated', ok: !/useNativeDriver:\s*true/.test(all) && !/Animated\.loop|iterations/.test(all) && !/react-native-reanimated|from 'moti'/.test(all) },
    { name: 'Reduce Motion decides at mount: the clock starts at SPINE_FINAL_CLOCK when it will not play',
      ok: /reducedMotion\(\)/.test(clock) && /new Animated\.Value\(playing \? 0 : SPINE_FINAL_CLOCK\)/.test(clock)
        && /if \(!playing\) return undefined;/.test(clock) },
  ];
}

function report(group: string, checks: Check[]): number {
  console.log(`\n${group}`);
  let bad = 0;
  for (const c of checks) {
    console.log(`  ${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}${c.detail ? `  [${c.detail}]` : ''}`);
    if (!c.ok) bad++;
  }
  return bad;
}

const FILES = [
  'app/login.tsx', 'app/signup.tsx', 'app/onboarding.tsx',
  'components/auth/AuthGround.tsx', 'components/auth/SpineHero.tsx', 'components/auth/MiniSpine.tsx',
  'components/auth/SpineParts.tsx', 'components/auth/SignatureStroke.tsx', 'components/auth/spineClock.ts',
];

function loadFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of FILES) out[f] = read(f);
  return out;
}

function selfTest(files: Record<string, string>): number {
  const W = welcomePlan();
  const caught = (checks: Check[]) => checks.some((c) => !c.ok);
  const mutations: [string, boolean][] = [
    ['schedule card before the contract', caught(checkWelcome({ ...W, scheduleCard: { at: 3700, dur: 680 } }, welcomePlan(true)))],
    ['a 7.5 s sequence', caught(checkWelcome({ ...W, glow: { at: 7100, dur: 400 } }, welcomePlan(true)))],
    ['a reduced plan with one live beat', caught(checkWelcome(W, { ...welcomePlan(true), paidIn: { at: 6640, dur: 340 } }))],
    ['Paid flipping before the last segment', caught(checkWelcome({ ...W, sentOut: { at: 6200, dur: 260 } }, welcomePlan(true)))],
    ['bars growing out of order', caught(checkWelcome({ ...W, bar2: { at: 5300, dur: 440 } }, welcomePlan(true)))],
    ['a mini chip dimming before it lands', caught(checkMini({ ...miniPlan(), dim1: { at: 300, dur: 1600 } }, miniPlan(true)))],
    ['a dropped login testID', caught(checkScreens({ ...files, 'app/login.tsx': files['app/login.tsx'].replace('testID="login-forgot"', 'testID="login-forgot-x"') }))],
    ['a hard-hat import back on signup', caught(checkScreens({ ...files, 'app/signup.tsx': `import { HardHat } from 'lucide-react-native';\n${files['app/signup.tsx']}` }))],
    ['"I already have an account" back on the welcome step', caught(checkScreens({ ...files, 'app/onboarding.tsx': files['app/onboarding.tsx'].replace('testID="onboarding-cta"', 'testID="onboarding-cta"\n            />\n            <TouchableOpacity testID="onboarding-have-account"><Text>I already have an account</Text></TouchableOpacity>\n            <View') }))],
    ['a card without its Sample tag',caught(checkScreens({ ...files, 'components/auth/SpineHero.tsx': files['components/auth/SpineHero.tsx'].replace(/<SampleTag \/>/g, '<View />') }))],
    ['a second JS-driven animation', caught(checkMotion({ ...files, 'components/auth/SpineParts.tsx': `${files['components/auth/SpineParts.tsx']}\nAnimated.timing(v, { useNativeDriver: false });` }))],
    ['the signature moved onto the native driver', caught(checkMotion({ ...files, 'components/auth/spineClock.ts': files['components/auth/spineClock.ts'].replace('useNativeDriver: SVG_PROP_DRIVER', 'useNativeDriver: nativeDriver') }))],
  ];
  console.log('\nself-test (each planted mutation must be caught)');
  let bad = 0;
  for (const [name, ok] of mutations) {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  caught: ${name}`);
    if (!ok) bad++;
  }
  return bad;
}

const files = loadFiles();
let failed = 0;
console.log('validate-auth-spine');
failed += report('the plan: welcome', checkWelcome(welcomePlan(), welcomePlan(true)));
failed += report('the plan: mini spine', checkMini(miniPlan(), miniPlan(true)));
failed += report('the plan: math', checkMath());
failed += report('the screens', checkScreens(files));
failed += report('motion rules', checkMotion(files));
if (process.argv.includes('--self-test')) failed += selfTest(files);
console.log(`\n${failed === 0 ? 'PASS' : `FAIL (${failed})`}`);
if (failed > 0) process.exit(1);
