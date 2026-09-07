// validate-location-consent.ts — the iOS location prompt may only be raised by a
// press, and the purpose string it displays must be true of every remaining
// trigger.
//
// WHY THIS EXISTS (runtime audit 2026-09-06 — AI-2, NAV-04, VIS-11).
// utils/location.ts ended with `useEffect(() => { void requestLocation(); }, [])`
// and five list screens call that hook, so opening the MAGE ID Bids tab raised
// the OS location alert. Two things made that a defect rather than a nuisance:
//
//   1. The alert renders app.json's NSLocationWhenInUseUsageDescription, which
//      said location was "only read when you take a photo or stamp a row —
//      never in the background". No photo, no stamp: a bids list. The one
//      sentence a contractor reads before granting GPS access was false in the
//      moment it was shown. It is also a stock App Review 5.1.1 rejection —
//      the stated purpose has to match the observed trigger.
//   2. It was asked for a distance sort inside Browse, which
//      RFP_BROWSE_ENABLED keeps switched off, on a screen (discover/hire)
//      that HIRE_ENABLED keeps switched off too.
//
// In the capture the alert went up at 9:20 and the next eleven routes rendered
// behind it — an unanswered alert is modal over the whole app.
//
// WHAT THIS GUARD PINS
//   A. utils/location.ts never reaches the OS from an effect — useEffect,
//      useLayoutEffect, useInsertionEffect or useFocusEffect. `request()` is
//      the only door.
//   B. Every consuming screen goes through that door from a REAL onPress
//      binding, never from an effect, and never with its own expo-location /
//      navigator.geolocation call. Where the distance feature is behind a
//      launch flag, the control is behind that same flag, so the app cannot
//      prompt for something that cannot run.
//   C. The purpose string is true of EVERY trigger in the app, named by the
//      exact control labels the app renders, and no longer carries the retired
//      photo-or-stamp claim.
//   D. The shared copy never asserts a distance the app does not have — pinned
//      output by output, not by a blocklist of two phrases.
//   E. The trigger inventory is closed. Every file in the app that can reach
//      the OS location stack is declared here against the clause of the purpose
//      string that covers it. A new caller fails the build until the string is
//      widened — which is the hole the 2026-09-06 review found: the guard read
//      words inside the string and never checked them against the code.
//   F. A generated ios/**/Info.plist on disk carries the same string. `ios/` is
//      gitignored and EAS prebuilds from app.json, but a local Xcode build from
//      a stale checkout would show whatever sentence is sitting there.
//
// FIRST-PRINCIPLE FOR ANYONE EDITING THIS FILE: a check that a bug can walk
// around is worse than no check, because it reports "56 passed" over the bug.
// The 2026-09-06 review restored the original defect in a scratch mirror with
// `useFocusEffect(useCallback(() => { void requestLocation(); }, []))` and this
// script still printed all-green. That is why the scans below are structural
// (balanced-delimiter regions) rather than substring probes.
//
// Run via: bun run scripts/validate-location-consent.ts

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    `got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
}

/**
 * Comments describe the bug; code causes it. The header of utils/location.ts
 * quotes the removed `useEffect(() => { void requestLocation(); }, [])` line
 * verbatim, so every check below reads the source with comments removed.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n');
}

/**
 * The source text of every call to `needle`-shaped function, found by matching
 * the opening delimiter. A regex cannot do this — bodies contain both braces
 * and parens — and the whole point of the guard is that nothing location-shaped
 * hides inside one.
 */
function regionsFrom(src: string, starts: number[], open: '(' | '{'): string[] {
  const close = open === '(' ? ')' : '}';
  const out: string[] = [];
  for (const at of starts) {
    const from = src.indexOf(open, at);
    if (from === -1) continue;
    let depth = 0;
    let i = from;
    for (; i < src.length; i++) {
      if (src[i] === open) depth++;
      else if (src[i] === close) { depth--; if (depth === 0) break; }
    }
    out.push(src.slice(at, i + 1));
  }
  return out;
}

function matchStarts(src: string, re: RegExp): number[] {
  const out: number[] = [];
  for (const m of src.matchAll(re)) out.push(m.index ?? 0);
  return out;
}

/**
 * EVERY effect hook, not just `useEffect`. The original guard scanned only
 * `useEffect(`, and `useFocusEffect` — already used in six files in this repo —
 * walked straight past it while re-creating the exact audit bug (an automatic
 * prompt the user never asked for, raised every time the screen is focused).
 */
const EFFECT_HOOK_RE = /\b(?:React\.)?(?:useEffect|useLayoutEffect|useInsertionEffect|useFocusEffect)\s*\(/g;
function effectBlocks(src: string): string[] {
  return regionsFrom(src, matchStarts(src, EFFECT_HOOK_RE), '(');
}

/** The expression inside every `onPress={...}` JSX attribute. */
function onPressValues(src: string): string[] {
  return regionsFrom(src, matchStarts(src, /onPress=\{/g), '{');
}

/** Anything that can reach the OS location stack. */
const OS_LOCATION_CALLS = [
  'requestForegroundPermissionsAsync',
  'getForegroundPermissionsAsync',
  'getCurrentPositionAsync',
  'watchPositionAsync',
  'navigator.geolocation',
  "import('expo-location')",
  "from 'expo-location'",
];

// ── A. the hook itself ──────────────────────────────────────────────────────
console.log('\nA. utils/location.ts never asks the OS from an effect');

const HOOK = 'utils/location.ts';
const hookRaw = read(HOOK);
const hookSrc = stripComments(hookRaw);

const hookEffects = effectBlocks(hookSrc);
ok('the hook still has its unmount-guard effect (and only bookkeeping effects)',
  hookEffects.length >= 1, 'expected at least the alive-ref effect');
for (const [i, block] of hookEffects.entries()) {
  const leaked = OS_LOCATION_CALLS.filter(c => block.includes(c));
  // `request` as a bare identifier would mean the effect calls the one door.
  const callsRequest = /\brequest\s*\(/.test(block) || /\bvoid\s+request\b/.test(block);
  ok(`effect #${i + 1} reaches no location API`, leaked.length === 0, leaked.join(', '));
  ok(`effect #${i + 1} does not call request()`, !callsRequest,
    'This is the exact line the runtime audit removed. Wire request() to an onPress instead.');
}

ok('requestForegroundPermissionsAsync is called exactly once, inside request()',
  (hookSrc.match(/requestForegroundPermissionsAsync/g) ?? []).length === 1);
ok('there is no silent permission pre-check on mount',
  !hookSrc.includes('getForegroundPermissionsAsync'),
  'A non-prompting read on mount is still "the app took a fix because you opened a screen".');
ok('the hook exposes status + request', hookSrc.includes('status,') && hookSrc.includes('    request,'));

// A browser PERMISSION_DENIED is a denial, not a broken device. Collapsing it
// into 'unavailable' told a user who pressed Block "this device could not
// return a location" — the wrong cause, and no route back.
ok('a web PERMISSION_DENIED is reported as denied, not as an unavailable device',
  /code === 1/.test(hookSrc) && /setStatus\(blockedByBrowser \? 'denied' : 'unavailable'\)/.test(hookSrc),
  'GeolocationPositionError.code === 1 must map to status "denied".');

// ── B. the consuming screens ────────────────────────────────────────────────
console.log('\nB. every consumer goes through the one door, on a press');

/**
 * `gate` names the launch flag that switches the screen's distance feature off,
 * and the source marker that proves the control sits behind it. When a feature
 * cannot run, it does not get to ask for a permission — so the guard checks the
 * gating rather than crediting a button the user can never reach (which is what
 * it did for mage-id-bids and discover/hire before the 2026-09-06 review).
 */
interface Consumer {
  file: string;
  requestIdent: string;
  controlTestId: string;
  mustDisclose: boolean;
  gate?: { flag: string; marker: string; kind: 'brace' | 'earlyReturn' };
}

const CONSUMERS: Consumer[] = [
  {
    file: 'app/(tabs)/mage-id-bids/index.tsx',
    requestIdent: 'requestLocation',
    controlTestId: 'mageid-bids-use-location',
    mustDisclose: false,
    gate: { flag: 'RFP_BROWSE_ENABLED', marker: "{mode === 'browse' && (", kind: 'brace' },
  },
  {
    file: 'app/nearby-rfps.tsx',
    requestIdent: 'requestLocation',
    controlTestId: 'nearby-rfps-use-location',
    mustDisclose: true,
    gate: { flag: 'RFP_BROWSE_ENABLED', marker: '{RFP_BROWSE_ENABLED && (', kind: 'brace' },
  },
  { file: 'app/(tabs)/discover/bids.tsx', requestIdent: 'requestLocation', controlTestId: 'bids-use-location', mustDisclose: true },
  {
    file: 'app/(tabs)/discover/hire.tsx',
    requestIdent: 'requestLocation',
    controlTestId: 'hire-use-location',
    mustDisclose: true,
    gate: { flag: 'HIRE_ENABLED', marker: 'if (!HIRE_ENABLED) {', kind: 'earlyReturn' },
  },
  { file: 'app/(tabs)/discover/companies.tsx', requestIdent: 'requestLocation', controlTestId: 'companies-use-location', mustDisclose: true },
];

for (const c of CONSUMERS) {
  const src = stripComments(read(c.file));
  const label = c.file.replace('app/', '');

  ok(`${label} consumes the hook`, src.includes('useUserLocation('));
  ok(`${label} destructures request as ${c.requestIdent}`,
    src.includes(`request: ${c.requestIdent}`));

  // No screen may reach expo-location itself — one choke point or the guard
  // above protects nothing.
  const bypass = OS_LOCATION_CALLS.filter(x => src.includes(x));
  ok(`${label} does not touch the OS location API directly`, bypass.length === 0, bypass.join(', '));

  // A REAL press binding. The previous version of this check accepted any bare
  // `requestLocation()` anywhere in the file, so deleting the button entirely
  // still passed. It has to be inside an onPress attribute value.
  const presses = onPressValues(src);
  const callRe = new RegExp(`\\b${c.requestIdent}\\s*\\(`);
  ok(`${label} wires ${c.requestIdent} to a real onPress`,
    presses.some(p => callRe.test(p)),
    `no onPress={...} in this file contains ${c.requestIdent}(). The only legitimate caller is a press handler.`);

  // …and it must not be reachable from any effect hook.
  for (const [i, block] of effectBlocks(src).entries()) {
    ok(`${label} effect #${i + 1} does not call ${c.requestIdent}`,
      !callRe.test(block),
      'Auto-requesting on mount or on focus is the audit bug.');
  }

  // The control the press lives on must exist by the testID the guard names,
  // so "wired to an onPress" cannot be satisfied by an onPress on some other
  // widget while the location button is gone.
  ok(`${label} renders the control (testID ${c.controlTestId})`,
    src.includes(`testID="${c.controlTestId}"`));

  if (c.gate) {
    const gateOk = c.gate.kind === 'brace'
      ? regionsFrom(src, matchStarts(src, new RegExp(c.gate.marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')), '{')
        .some(region => region.includes(`testID="${c.controlTestId}"`))
      : (() => {
        const at = src.indexOf(c.gate!.marker);
        const ret = src.indexOf('return (', at);
        const ctl = src.indexOf(`testID="${c.controlTestId}"`);
        return at !== -1 && ret !== -1 && ctl > ret;
      })();
    ok(`${label} keeps the location control behind ${c.gate.flag}`, gateOk,
      `While ${c.gate.flag} is false this screen must not be able to prompt: nothing it would sort is ever fetched.`);
  }

  // Asking for a location must never take the rows away. Every one of these
  // screens used `const loading = isLoading || locationLoading` — harmless-ish
  // while the hook auto-requested on mount, actively worse once it became a
  // button: pressing "Use my location" over a populated list replaced it with
  // five skeletons and held them there for as long as the iOS alert stood
  // (minutes, in the audit capture). The hook's `loading` has no business
  // gating content, so no consumer may take it at all.
  const callAt = src.search(/=\s*useUserLocation\s*\(/);
  const open = callAt === -1 ? -1 : src.lastIndexOf('{', callAt);
  const destructure = open === -1 ? '' : src.slice(open, callAt);
  ok(`${label} does not gate content on the hook's loading flag`,
    callAt !== -1 && !/\bloading\b/.test(destructure),
    `destructured: ${destructure.trim()} — use status for copy; never let a permission alert blank the list.`);

  if (c.mustDisclose) {
    ok(`${label} discloses when it has no location`, src.includes('locationDistanceNotice('),
      'A radius chip / "Near me" / "Nearest" with no fix behind it must say so.');
  }
}

// mage-id-bids' Browse mode is the gate for its control; prove the mode itself
// cannot be entered while the flag is off.
{
  const src = stripComments(read('app/(tabs)/mage-id-bids/index.tsx'));
  ok("mage-id-bids never starts in browse mode while RFP_BROWSE_ENABLED is false",
    src.includes("useState<Mode>(RFP_BROWSE_ENABLED ? 'browse' : 'mine')"));
  const setters = (src.match(/setMode\('browse'\)/g) ?? []).length;
  const gated = regionsFrom(src, matchStarts(src, /\{RFP_BROWSE_ENABLED \? \(/g), '{')
    .filter(r => r.includes("setMode('browse')")).length;
  ok("the only setMode('browse') is inside the RFP_BROWSE_ENABLED branch",
    setters === 1 && gated === 1, `${setters} setter(s), ${gated} inside the gate`);
}

// ── C. the purpose string ───────────────────────────────────────────────────
console.log('\nC. NSLocationWhenInUseUsageDescription is true of every trigger');

const appJson = JSON.parse(read('app.json')) as {
  expo: { ios: { infoPlist: Record<string, string> } };
};
const purpose = appJson.expo.ios.infoPlist.NSLocationWhenInUseUsageDescription ?? '';

ok('the string exists', purpose.length > 0);
ok('the retired photo-or-stamp-only claim is gone',
  !/only read when you take a photo or stamp a row/i.test(purpose),
  'That sentence was false the moment the bids list showed it.');
ok('it does not promise a closed list of three triggers',
  !/only three ways/i.test(purpose),
  'There are more than three. Enumerating a count invites the next one to make it false.');
ok('it says location is only used on a deliberate action', /only in response to something you tap/i.test(purpose));
ok('it separates reading a position from merely asking for the permission',
  /reads a position when/i.test(purpose) && /also asks for this permission when/i.test(purpose),
  'app/post-rfp.tsx raises the alert without ever reading a fix; the string must not claim otherwise.');
ok('it still promises no background reads', /never .*background/i.test(purpose));

// ── D. the shared copy, executed ────────────────────────────────────────────
console.log('\nD. the copy never asserts a distance the app does not have');

const BEGIN = '// --- BEGIN location consent copy ---';
const END = '// --- END location consent copy ---';
const from = hookRaw.indexOf(BEGIN);
const to = hookRaw.indexOf(END);
if (from < 0 || to < 0) {
  console.error(`\n  ✗ could not find the copy sentinels in ${HOOK}.`);
  console.error('    Restore them, or the distance disclosure goes unpinned.');
  process.exit(1);
}
// `Bun` is a runtime global with no ambient types here (@types/bun is not a
// dependency), so reach it through globalThis — same technique as
// validate-email-honesty.ts.
const { Transpiler } = (globalThis as unknown as {
  Bun: { Transpiler: new (o: { loader: string }) => { transformSync(src: string): string } };
}).Bun;
const js = new Transpiler({ loader: 'ts' })
  .transformSync(hookRaw.slice(from, to))
  .replace(/\bexport\s+function\b/g, 'function');
const copy = new Function(
  `${js}; return { locationControlLabel, locationControlAction, locationDistanceNotice };`,
)() as {
  locationControlLabel: (s: string, has: boolean, p?: string) => string;
  locationControlAction: (s: string, p?: string) => string;
  locationDistanceNotice: (s: string, has: boolean, p?: string) => string | null;
};

const STATUSES = ['idle', 'requesting', 'granted', 'denied', 'unavailable'] as const;
const PLATFORMS = ['native', 'web'] as const;

eq('with a fix, there is nothing to disclose (every status, every platform)',
  PLATFORMS.flatMap(p => STATUSES.map(s => copy.locationDistanceNotice(s, true, p))),
  PLATFORMS.flatMap(() => STATUSES.map(() => null)));

/**
 * The notice is PINNED OUTPUT BY OUTPUT, not screened by a blocklist.
 *
 * The screen version of this check rejected the two literals "miles away" and
 * "sorted by distance", so swapping the honest notice for "Showing the closest
 * results we could estimate." passed all 56 checks — a fabricated distance
 * claim waved through by the guard that exists to stop exactly that. Changing
 * any of these sentences now requires editing this table, which is the moment
 * to ask whether the new sentence claims something the app has not measured.
 */
const EXPECTED_NOTICE: Record<string, Record<string, string>> = {
  native: {
    idle: 'Distances are off. Tap Use my location to sort and filter by how far away things are.',
    requesting: 'Getting your location…',
    granted: 'Distances are off. Tap Use my location to sort and filter by how far away things are.',
    denied: 'Location is off for MAGE ID, so nothing here is sorted or filtered by distance. Turn it on in Settings to use distance.',
    unavailable: 'This device could not return a location, so nothing here is sorted or filtered by distance.',
  },
  web: {
    idle: 'Distances are off. Tap Use my location to sort and filter by how far away things are.',
    requesting: 'Getting your location…',
    granted: 'Distances are off. Tap Use my location to sort and filter by how far away things are.',
    denied: 'Location is blocked for this site, so nothing here is sorted or filtered by distance. Allow it in your browser to use distance.',
    unavailable: 'This device could not return a location, so nothing here is sorted or filtered by distance.',
  },
};

const EXPECTED_LABEL: Record<string, Record<string, string>> = {
  native: {
    idle: 'Use my location',
    requesting: 'Getting location…',
    granted: 'Use my location',
    denied: 'Location off — open Settings',
    unavailable: 'Location unavailable',
  },
  web: {
    idle: 'Use my location',
    requesting: 'Getting location…',
    granted: 'Use my location',
    denied: 'Location blocked — allow it in your browser',
    unavailable: 'Location unavailable',
  },
};

for (const p of PLATFORMS) {
  for (const s of STATUSES) {
    eq(`[${p}/${s}] notice without a fix is exactly the sentence we reviewed`,
      copy.locationDistanceNotice(s, false, p), EXPECTED_NOTICE[p][s]);
    eq(`[${p}/${s}] control label without a fix`,
      copy.locationControlLabel(s, false, p), EXPECTED_LABEL[p][s]);
  }
}

// A second, independent net: any word that would let a list read as measured.
// Belt and braces — the table above is the real check, but a future edit that
// updates the table without thinking still trips on this.
const DISTANCE_CLAIM = /\b(?:miles? away|sorted by distance|nearest|closest|nearby to you|within \d+)\b/i;
for (const p of PLATFORMS) {
  for (const s of STATUSES) {
    const notice = copy.locationDistanceNotice(s, false, p) ?? '';
    ok(`[${p}/${s}] the no-fix notice never claims a measured distance`,
      !DISTANCE_CLAIM.test(notice), notice);
  }
}

eq('a granted fix reads as set', copy.locationControlLabel('granted', true), 'Location set');
ok('a hard native denial points at Settings rather than re-prompting',
  copy.locationControlAction('denied', 'native') === 'openSettings');
ok('a web denial stays a request — openLocationSettings() cannot reach a browser',
  copy.locationControlAction('denied', 'web') === 'request',
  'Linking.openSettings() is a no-op on web; sending a blocked browser user there is a dead button.');
for (const s of STATUSES.filter(x => x !== 'denied')) {
  ok(`"${s}" presses ask for a location`, copy.locationControlAction(s, 'native') === 'request');
}

// The Info.plist promise names controls. They have to exist, spelled that way.
const RENDERED_LABELS: { quoted: string; renderedIn: string; needle: string }[] = [
  { quoted: copy.locationControlLabel('idle', false), renderedIn: HOOK, needle: "return 'Use my location';" },
  { quoted: 'Near me', renderedIn: 'app/(tabs)/discover/bids.tsx', needle: '>Near me<' },
  // The button reads "Verify", not "Verify Address" — the string used to quote
  // a label nothing renders.
  { quoted: 'Verify', renderedIn: 'app/post-rfp.tsx', needle: '>Verify</Text>' },
];
for (const l of RENDERED_LABELS) {
  ok(`the purpose string quotes "${l.quoted}", and ${l.renderedIn.replace('app/', '')} renders it`,
    purpose.includes(l.quoted) && stripComments(read(l.renderedIn)).includes(l.needle),
    `app.json names a control that ${l.renderedIn} must actually render (${l.needle}).`);
}

// ── E. the trigger inventory is closed ──────────────────────────────────────
console.log('\nE. every OS-location call site in the app is declared and disclosed');

/**
 * Every file that can raise the location alert, mapped to the clause of the
 * purpose string that covers it.
 *
 * This is the check that was missing. The old guard regex-matched words INSIDE
 * the string and never looked at the code, so app/field-ticket.tsx's signature
 * stamp — a fourth trigger, added while the string promised "only three ways" —
 * was invisible to it. Add a call site and this fails until the sentence a
 * contractor reads covers what the app is about to do.
 */
const DECLARED_TRIGGERS: { file: string; why: string; covers: string }[] = [
  { file: 'utils/location.ts', why: 'the distance hook behind "Use my location" / "Near me"', covers: 'Use my location' },
  { file: 'utils/photoGeoStamp.ts', why: 'the shared GPS stamper (photos + the field-ticket signature)', covers: 'jobsite photo' },
  { file: 'app/daily-report.tsx', why: 'daily-report photo stamp', covers: 'jobsite photo' },
  { file: 'app/project-detail.tsx', why: 'project gallery photo stamp — camera AND library', covers: 'add a jobsite photo' },
  { file: 'app/punch-walk.tsx', why: 'punch-walk photo stamp', covers: 'jobsite photo' },
  { file: 'app/ai-punch.tsx', why: 'AI punch photo stamp', covers: 'jobsite photo' },
  { file: 'app/plan-viewer.tsx', why: 'plan-pin photo stamp', covers: 'jobsite photo' },
  { file: 'app/field-ticket.tsx', why: 'ticket photo stamp AND the signature stamp in handleSign', covers: 'sign a field ticket' },
  { file: 'components/TakeoffFieldVerifyButton.tsx', why: 'field-verifying a takeoff row', covers: 'field-verify a takeoff row' },
  // The one trigger that ASKS without READING: verifyAddress requests the
  // permission and then calls geocodeAsync, which needs it on Android only and
  // never returns where the user is. The alert still goes up on iOS, so the
  // string has to explain the tap — but claiming it "reads a position" would be
  // a stated fact the code does not perform, so the string separates the two.
  { file: 'app/post-rfp.tsx', why: 'the address Verify button — asks, does not read', covers: 'looks the address up rather than reading where you are' },
];

const SOURCE_DIRS = ['app', 'components', 'utils', 'hooks', 'contexts', 'lib'];
const found = new Set<string>();
for (const dir of SOURCE_DIRS) {
  for (const rel of readdirSync(join(ROOT, dir), { recursive: true, encoding: 'utf8' })) {
    const p = `${dir}/${rel}`.replace(/\\/g, '/');
    if (!/\.tsx?$/.test(p)) continue;
    const src = stripComments(read(p));
    const reaches = OS_LOCATION_CALLS.some(x => src.includes(x)) || /\bstampPhotoLocation\s*\(/.test(src);
    if (reaches) found.add(p);
  }
}

const declared = new Set(DECLARED_TRIGGERS.map(t => t.file));
const undeclared = [...found].filter(f => !declared.has(f)).sort();
const stale = [...declared].filter(f => !found.has(f)).sort();

ok('no undeclared location trigger exists in the app', undeclared.length === 0,
  `${undeclared.join(', ')}\n      Add it to DECLARED_TRIGGERS and widen NSLocationWhenInUseUsageDescription to cover it.`);
ok('no declared trigger has gone away (the string would be over-disclosing)',
  stale.length === 0, stale.join(', '));

for (const t of DECLARED_TRIGGERS) {
  ok(`the purpose string covers ${t.file} (${t.why})`,
    purpose.includes(t.covers), `expected the string to contain "${t.covers}"`);
}

// ── F. the generated Info.plist on disk ─────────────────────────────────────
console.log('\nF. a generated Info.plist on disk carries the same sentence');

// `ios/` is gitignored and EAS prebuilds from app.json, so the SHIPPED string is
// always app.json's. But `expo run:ios` / Xcode from this checkout uses whatever
// is sitting in ios/, and that file kept the retired photo-or-stamp sentence for
// the whole of the 2026-09-06 fix wave.
const PLIST = 'ios/MAGEID/Info.plist';
if (!existsSync(join(ROOT, PLIST))) {
  ok(`${PLIST} is not prebuilt here — nothing to drift`, true);
} else {
  const plist = read(PLIST);
  const m = plist.match(/<key>NSLocationWhenInUseUsageDescription<\/key>\s*<string>([\s\S]*?)<\/string>/);
  ok(`${PLIST} declares the key`, !!m);
  const onDisk = (m?.[1] ?? '').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
  ok('the retired photo-or-stamp claim is gone from the generated plist',
    !/only read when you take a photo or stamp a row/i.test(onDisk),
    'Run `expo prebuild --clean`, or a local Xcode build shows the false string.');
  eq('the generated plist matches app.json', onDisk, purpose);
}

console.log(`\n${fail === 0 ? `location consent: ${pass} checks passed` : `${fail} of ${pass + fail} checks FAILED`}\n`);
process.exit(fail === 0 ? 0 : 1);
