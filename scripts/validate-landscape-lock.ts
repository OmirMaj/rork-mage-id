// scripts/validate-landscape-lock.ts
//
// LANDSCAPE-0: the iPhone build allows landscape at the native level, every
// screen stays portrait in JavaScript, and screens are opened one at a time.
//
// WHAT IS TRUE, AND PINNED HERE
//
//   1. THE PLIST. app.json expo.ios.infoPlist.UISupportedInterfaceOrientations
//      is exactly Portrait + LandscapeLeft + LandscapeRight. The top-level
//      "orientation" stays "portrait": Expo's orientation plugin leaves a
//      hand-set plist key alone (checked with `npx expo config --type
//      introspect`), and "portrait" is what keeps the ANDROID manifest at
//      screenOrientation="portrait". ios.supportsTablet stays false.
//
//   2. EVERY NAVIGATOR IS LOCKED. With the plist open, a native-stack screen
//      with no `orientation` option answers AllButUpsideDown
//      (react-native-screens RNSScreen.mm supportedInterfaceOrientations), so
//      anything not locked in JS rotates in the next build. Every <Stack> in
//      every app/**/_layout.tsx carries `orientation: 'portrait_up'` in its
//      screenOptions. A modal / formSheet is its own view controller and is
//      asked on its own, which is why the nested stacks carry the option too
//      and not only the root. The one <Tabs> layout has no native screen of
//      its own: it sits inside the root's "(tabs)" screen and inherits it.
//
//   3. THE ALLOW-LIST. ROTATABLE_ROUTES below is the complete list of screens
//      that may turn. It changes only by editing this file. Each one carries
//      `orientation: ROTATABLE_ORIENTATION` on its root Stack.Screen, and that
//      constant is 'all' on iOS and 'portrait_up' everywhere else (on Android
//      react-native-screens maps 'all' to FULL_SENSOR, which overrides the
//      manifest lock at runtime). Never a landscape-only value: the same
//      JavaScript reaches builds whose plist is still portrait-only, where
//      UIKit finds no common orientation and throws.
//
//   4. REACT NATIVE <Modal>. It is a separate view controller with its own
//      mask; on an iPhone the default is portrait only
//      (RCTModalHostViewComponentView.mm, pinned below by reading it). So no
//      Modal anywhere may set `supportedOrientations`, except the Modals of an
//      opened screen, which take ROTATABLE_MODAL_ORIENTATIONS (portrait +
//      landscape, so a sheet opened sideways is not presented upright).
//
//   5. A NATIVE PHONE IS ALWAYS THE PHONE LAYOUT. A sideways iPhone is up to
//      956 pt wide. Phone-ness comes from utils/nativePhone (the short side),
//      and every window-width breakpoint in the app either goes through it or
//      is listed below with the reason it cannot fire on a native phone.
//
//   6. THE OPENED SCREEN reads the live window (no Dimensions.get), pads the
//      left / right safe area, and its Modals accept landscape.
//
// NOT CLOSED BY ANYTHING HERE (no JavaScript can): the moments before the
// navigator mounts (launch, the boot loader) follow the plist, and system
// sheets the app presents full-screen (Safari, the camera, the share sheet)
// turn on their own.
//
// Each rule is a pure function over a map of file contents, so the planted
// mutations at the bottom run the SAME code on a doctored copy and every rule
// has to catch its own.
//
// Run via: bun run test:landscape-lock

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { NATIVE_PHONE_SHORT_SIDE_MAX, breakpointWidth, isNativePhone } from '../utils/nativePhone';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ─────────────────────────────────────────────────────────────────────────────
// The pinned tables. Editing one of these is the decision.
// ─────────────────────────────────────────────────────────────────────────────

/** Every screen that may leave portrait. Root routes (app/<name>.tsx). */
const ROTATABLE_ROUTES: readonly string[] = ['plan-viewer'];

const PLIST_ORIENTATIONS: readonly string[] = [
  'UIInterfaceOrientationPortrait',
  'UIInterfaceOrientationLandscapeLeft',
  'UIInterfaceOrientationLandscapeRight',
];

/** Every layout file under app/, and the navigator it mounts. */
const LAYOUTS: Readonly<Record<string, 'stack' | 'tabs'>> = {
  'app/_layout.tsx': 'stack',
  'app/(tabs)/_layout.tsx': 'tabs',
  'app/(tabs)/(home)/_layout.tsx': 'stack',
  'app/(tabs)/construction-ai/_layout.tsx': 'stack',
  'app/(tabs)/discover/_layout.tsx': 'stack',
  'app/(tabs)/equipment/_layout.tsx': 'stack',
  'app/(tabs)/estimate/_layout.tsx': 'stack',
  'app/(tabs)/mage-id-bids/_layout.tsx': 'stack',
  'app/(tabs)/marketplace/_layout.tsx': 'stack',
  'app/(tabs)/materials/_layout.tsx': 'stack',
  'app/(tabs)/schedule/_layout.tsx': 'stack',
  'app/(tabs)/settings/_layout.tsx': 'stack',
  'app/(tabs)/subs/_layout.tsx': 'stack',
  'app/(tabs)/summary/_layout.tsx': 'stack',
};
const ROOT_LAYOUT = 'app/_layout.tsx';

/** `orientation:` keys that are not a navigator option, with how many. */
const NON_NAV_ORIENTATION_KEYS: Readonly<Record<string, number>> = {
  'components/schedule/mobile/ExportCenterSheet.tsx': 1, // the printed PDF's page orientation
  'utils/scheduleReportModel.ts': 1,                     // the same, as a type
  'utils/scheduleReportHtml.ts': 1,                      // the same, as a parameter
  'utils/imageMetadataStrip.ts': 2,                      // a photo's EXIF orientation number
};

const ORIENTATION_CONST = 'utils/screenOrientation.ts';
const NATIVE_PHONE = 'utils/nativePhone.ts';
const RN_MODAL = 'node_modules/react-native/React/Fabric/Mounting/ComponentViews/Modal/RCTModalHostViewComponentView.mm';

/**
 * Every file that compares a window-ish width with a layout breakpoint, and
 * why a native phone held sideways cannot cross it.
 *   var     the file's `width` IS useBreakpointWidth() and it reads the window no other way
 *   inline  every comparison names the guard on its own line
 *   exempt  cannot fire on a native phone; the reason is the string, and the
 *           number of comparisons is pinned so a new one has to be looked at
 */
type BreakpointPolicy =
  | { kind: 'var' }
  | { kind: 'inline' }
  | { kind: 'exempt'; hits: number; why: string };
const BREAKPOINT_FILES: Readonly<Record<string, BreakpointPolicy>> = {
  'utils/useResponsiveLayout.ts': { kind: 'exempt', hits: 3, why: 'the breakpoint reader itself: the isNativePhone branch runs first (pinned separately below)' },
  'app/schedule-pro.tsx': { kind: 'var' },
  'app/schedule-wizard.tsx': { kind: 'var' },
  'app/shared-schedule.tsx': { kind: 'var' },
  'app/tutorials.tsx': { kind: 'var' },
  'components/ClientDocumentAskSheet.tsx': { kind: 'var' },
  'app/skills-certificates.tsx': { kind: 'inline' },
  'components/TakeoffPageInspector.tsx': { kind: 'inline' },
  'app/shared-photos.tsx': { kind: 'exempt', hits: 2, why: 'a photo grid choosing 2 / 3 / 4 columns: more columns on a wider window is the point, and it is no desktop layout' },
  'components/takeoff/TakeoffWorkspace.tsx': { kind: 'exempt', hits: 1, why: 'the desktop-web takeoff workspace (1280 rail): only mounted behind the desktop web gate' },
  'components/whoson/ProjectPeopleStack.tsx': { kind: 'exempt', hits: 1, why: 'HEADER_WIDE is 1100: no phone is that wide either way up' },
  'utils/sidebarRail.ts': { kind: 'exempt', hits: 1, why: 'guarded by i.isDesktop on the same line, which a native phone never is' },
  'utils/splitViewLayout.ts': { kind: 'exempt', hits: 1, why: 'a measured CONTAINER width on the desktop money pages (KPI strip wrap), not the window' },
  'utils/punchEditLayout.ts': { kind: 'exempt', hits: 1, why: "returns 'sheet' for every platform but web before it compares" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Reading the repo into a map
// ─────────────────────────────────────────────────────────────────────────────

type Files = Map<string, string>;
const SOURCE_DIRS = ['app', 'components', 'hooks', 'utils', 'contexts', 'lib', 'constants'];

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
  }
}

function loadRepo(): Files {
  const files: Files = new Map();
  for (const d of SOURCE_DIRS) {
    const abs = join(ROOT, d);
    if (!existsSync(abs)) continue;
    const found: string[] = [];
    walk(abs, found);
    for (const f of found) files.set(relative(ROOT, f).split('\\').join('/'), readFileSync(f, 'utf8'));
  }
  for (const f of ['app.json', 'package.json', RN_MODAL]) {
    const abs = join(ROOT, f);
    if (existsSync(abs)) files.set(f, readFileSync(abs, 'utf8'));
  }
  return files;
}

/** Code only: the files explain what they replaced, and quote it. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const at = line.search(/(^|[^:'"`\\])\/\//);
      if (at === -1) return line;
      return line.slice(0, line.indexOf('//', at));
    })
    .join('\n');
}
const codeCache = new Map<string, string>();
function code(files: Files, path: string): string {
  const src = files.get(path);
  if (src === undefined) return '';
  const hit = codeCache.get(src);
  if (hit !== undefined) return hit;
  const c = stripComments(src);
  codeCache.set(src, c);
  return c;
}
const isSource = (p: string) => SOURCE_DIRS.some((d) => p.startsWith(`${d}/`));
const count = (s: string, re: RegExp) => s.match(re)?.length ?? 0;

// ─────────────────────────────────────────────────────────────────────────────
// The rules. Each returns the failures it found (empty = holds).
// ─────────────────────────────────────────────────────────────────────────────

type Rule = 'plist' | 'layouts' | 'allowlist' | 'modal' | 'guard' | 'breakpoints' | 'viewer';
type Failures = Record<Rule, string[]>;

// 1 ── the plist ──────────────────────────────────────────────────────────────
function rulePlist(files: Files): string[] {
  const out: string[] = [];
  let expo: any;
  let pkg: any;
  try {
    const j = JSON.parse(files.get('app.json') ?? '{}');
    expo = j.expo ?? j;
    pkg = JSON.parse(files.get('package.json') ?? '{}');
  } catch {
    return ['app.json or package.json does not parse'];
  }
  const got: unknown = expo?.ios?.infoPlist?.UISupportedInterfaceOrientations;
  if (!Array.isArray(got)) {
    out.push('app.json expo.ios.infoPlist.UISupportedInterfaceOrientations is missing: the plist falls back to what "orientation": "portrait" writes (portrait + upside down) and no screen can ever turn');
  } else {
    const a = [...got].map(String).sort().join(',');
    const b = [...PLIST_ORIENTATIONS].sort().join(',');
    if (a !== b || got.length !== PLIST_ORIENTATIONS.length) {
      out.push(`UISupportedInterfaceOrientations must be exactly ${PLIST_ORIENTATIONS.join(' + ')}; read ${JSON.stringify(got)}`);
    }
  }
  if (expo?.ios?.infoPlist && 'UISupportedInterfaceOrientations~ipad' in expo.ios.infoPlist) {
    out.push('an ~ipad orientation list appeared: iPad is not a target (ios.supportsTablet is false)');
  }
  if (expo?.orientation !== 'portrait') {
    out.push(`app.json "orientation" must stay "portrait" (read ${JSON.stringify(expo?.orientation)}): it is what keeps the Android manifest at screenOrientation="portrait"; iOS landscape comes from the infoPlist key`);
  }
  if (expo?.ios?.supportsTablet !== false) {
    out.push('ios.supportsTablet must stay false: utils/nativePhone calls a native window a phone by its short side, and an iPad is not one');
  }
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  if ('expo-screen-orientation' in deps) {
    out.push('expo-screen-orientation is a dependency: it is a NEW NATIVE MODULE that no shipped build contains. Per-screen control is the react-native-screens `orientation` option');
  }
  return out;
}

// 2 ── every navigator is locked ──────────────────────────────────────────────
const STACK_OPEN = /<Stack(?=[\s>/])/g;
const NAVIGATOR_ANYWHERE = /<(?:Stack|Tabs|Drawer|NavigationContainer)(?=[\s>/])|\bcreate(?:NativeStack|BottomTab|Stack|Drawer|MaterialTopTab)Navigator\b|\bwithLayoutContext\b/;

function ruleLayouts(files: Files): string[] {
  const out: string[] = [];
  const onDisk = [...files.keys()].filter((p) => /^app\/(.*\/)?_layout\.tsx$/.test(p)).sort();
  const pinned = Object.keys(LAYOUTS).sort();
  for (const p of onDisk) if (!(p in LAYOUTS)) out.push(`${p} is a layout this validator has never seen: add it to LAYOUTS and lock its navigator`);
  for (const p of pinned) if (!files.has(p)) out.push(`${p} is pinned in LAYOUTS but is gone`);

  for (const [path, kind] of Object.entries(LAYOUTS)) {
    const c = code(files, path);
    if (!c) continue;
    const stacks = [...c.matchAll(STACK_OPEN)];
    if (kind === 'tabs') {
      if (stacks.length > 0) out.push(`${path} is pinned as a <Tabs> layout but mounts a <Stack>: lock it and re-pin it as 'stack'`);
      if (!/<Tabs(?=[\s>/])/.test(c)) out.push(`${path} is pinned as a <Tabs> layout but mounts no <Tabs>`);
      continue;
    }
    if (stacks.length === 0) { out.push(`${path} is pinned as a <Stack> layout but mounts no <Stack>`); continue; }
    for (const m of stacks) {
      const tag = /^<Stack\s+screenOptions=\{\{([^{}]*)\}\}/.exec(c.slice(m.index));
      if (!tag) { out.push(`${path}: a <Stack> has no literal screenOptions={{ … }} as its first prop, so its default orientation cannot be read`); continue; }
      const keys = [...tag[1].matchAll(/\borientation\s*:\s*([^,}]+)/g)].map((k) => k[1].trim());
      if (keys.length !== 1 || keys[0] !== "'portrait_up'") {
        out.push(`${path}: <Stack screenOptions> must carry exactly orientation: 'portrait_up' (read ${keys.length ? keys.join(' / ') : 'none'}). Without it every screen and modal in this navigator rotates in the next native build`);
      }
    }
  }
  // The <Tabs> layout is only locked because the root screen holding it is.
  if (!/<Stack\.Screen\s+name="\(tabs\)"/.test(code(files, ROOT_LAYOUT))) {
    out.push(`${ROOT_LAYOUT} no longer declares <Stack.Screen name="(tabs)">: the tab navigator inherits its lock from that screen`);
  }
  for (const p of files.keys()) {
    if (!isSource(p) || p in LAYOUTS) continue;
    if (NAVIGATOR_ANYWHERE.test(code(files, p))) {
      out.push(`${p} mounts a navigator outside app/**/_layout.tsx: it has no default orientation and this validator cannot see its screens`);
    }
  }
  return out;
}

// 3 ── the allow-list ─────────────────────────────────────────────────────────
function ruleAllowlist(files: Files): string[] {
  const out: string[] = [];
  const root = code(files, ROOT_LAYOUT);

  // Which root screens carry the rotatable value.
  const opened: string[] = [];
  for (const m of root.matchAll(/<Stack\.Screen\s+name="([^"]+)"\s+options=\{\{([^{}]*)\}\}/g)) {
    if (/\borientation\s*:/.test(m[2])) {
      if (/\borientation\s*:\s*ROTATABLE_ORIENTATION\b/.test(m[2])) opened.push(m[1]);
      else out.push(`${ROOT_LAYOUT}: screen "${m[1]}" sets its own orientation to something other than ROTATABLE_ORIENTATION`);
    }
  }
  const want = [...ROTATABLE_ROUTES].sort().join(', ');
  const got = [...opened].sort().join(', ');
  if (want !== got) out.push(`the screens opened to landscape are [${got}] but the allow-list is [${want}]. The list changes only by editing ROTATABLE_ROUTES in scripts/validate-landscape-lock.ts`);

  // Every `orientation:` key in the source is accounted for.
  for (const p of files.keys()) {
    if (!isSource(p)) continue;
    const n = count(code(files, p), /\borientation\s*:/g);
    const allowed = p === ROOT_LAYOUT ? 1 + ROTATABLE_ROUTES.length
      : LAYOUTS[p] === 'stack' ? 1
        : NON_NAV_ORIENTATION_KEYS[p] ?? 0;
    if (n !== allowed) out.push(`${p} has ${n} \`orientation:\` key(s), expected ${allowed}: a screen option here (options, screenOptions, navigation.setOptions) would unlock a screen outside the allow-list`);
  }

  // The rotatable value is used in exactly one place per opened screen.
  for (const p of files.keys()) {
    if (!isSource(p) || p === ORIENTATION_CONST) continue;
    const n = count(code(files, p), /\bROTATABLE_ORIENTATION\b/g);
    const allowed = p === ROOT_LAYOUT ? 1 + ROTATABLE_ROUTES.length : 0; // the import + one per route
    if (n !== allowed) out.push(`${p} names ROTATABLE_ORIENTATION ${n} time(s), expected ${allowed}`);
  }

  // What the value is.
  const k = code(files, ORIENTATION_CONST);
  if (!/export const ROTATABLE_ORIENTATION: 'all' \| 'portrait_up' = Platform\.OS === 'ios' \? 'all' : 'portrait_up';/.test(k)) {
    out.push(`${ORIENTATION_CONST}: ROTATABLE_ORIENTATION must be exactly \`Platform.OS === 'ios' ? 'all' : 'portrait_up'\`. 'all' on Android overrides the manifest's portrait lock; a landscape-only value throws on a build whose plist is still portrait-only`);
  }
  if (!/export const ROTATABLE_MODAL_ORIENTATIONS: \('portrait' \| 'landscape'\)\[\] = \['portrait', 'landscape'\];/.test(k)) {
    out.push(`${ORIENTATION_CONST}: ROTATABLE_MODAL_ORIENTATIONS must be exactly ['portrait', 'landscape'] (a Modal without portrait crashes a portrait-only build)`);
  }

  // No other way to turn the screen.
  for (const p of files.keys()) {
    if (!isSource(p)) continue;
    if (/expo-screen-orientation|\bScreenOrientation\b|\bscreenOrientation\s*[=:]|\b(?:lockAsync|unlockAsync|lockToPortrait|lockToLandscape|unlockAllOrientations)\b/.test(code(files, p))) {
      out.push(`${p} reaches for a runtime orientation API: the only mechanism is the native-stack \`orientation\` option, through the allow-list`);
    }
  }
  return out;
}

// 4 ── React Native <Modal> ───────────────────────────────────────────────────
const rotatableFiles = () => ROTATABLE_ROUTES.map((r) => `app/${r}.tsx`);

function ruleModal(files: Files): string[] {
  const out: string[] = [];
  const opened = new Set(rotatableFiles());
  for (const p of files.keys()) {
    if (!isSource(p) || p === ORIENTATION_CONST) continue;
    const c = code(files, p);
    const all = count(c, /\bsupportedOrientations\b/g);
    if (all === 0) continue;
    if (!opened.has(p)) {
      out.push(`${p} sets supportedOrientations on a Modal, and it is not an opened screen: a Modal is its own view controller, so this turns a locked screen's sheet`);
      continue;
    }
    const good = count(c, /\bsupportedOrientations=\{ROTATABLE_MODAL_ORIENTATIONS\}/g);
    if (good !== all) out.push(`${p}: every supportedOrientations must be {ROTATABLE_MODAL_ORIENTATIONS} (${good} of ${all} are)`);
  }
  // The default every other Modal relies on.
  const rn = files.get(RN_MODAL);
  if (rn === undefined) {
    out.push(`${RN_MODAL} is not where it was: re-read how React Native picks a Modal's default orientations before trusting "portrait only"`);
  } else if (!/if \(supportedOrientations == 0\) \{\s*if \(\[\[UIDevice currentDevice\] userInterfaceIdiom\] == UIUserInterfaceIdiomPad\) \{\s*return UIInterfaceOrientationMaskAll;\s*\} else \{\s*return UIInterfaceOrientationMaskPortrait;\s*\}\s*\}/.test(rn)) {
    out.push('React Native no longer defaults an iPhone <Modal> with no supportedOrientations to portrait only: every sheet in the app (270+) relies on that default');
  }
  return out;
}

// 5 ── a native phone is always the phone layout ──────────────────────────────

/** [name, width, height] of every iPhone window, upright. Sideways is the swap. */
const IPHONES: readonly [string, number, number][] = [
  ['SE', 375, 667], ['mini', 375, 812], ['12-14', 390, 844], ['14 Pro-16', 393, 852], ['16 Pro / 17', 402, 874],
  ['Air', 420, 912], ['Plus', 428, 926], ['Pro Max', 430, 932], ['16-17 Pro Max', 440, 956],
];

type PhoneFn = (platform: string, w: number, h: number) => boolean;
type WidthFn = (platform: string, w: number, h: number) => number;

function guardBehaviour(isPhone: PhoneFn, bpWidth: WidthFn): string[] {
  const out: string[] = [];
  for (const [name, w, h] of IPHONES) {
    for (const os of ['ios', 'android']) {
      if (!isPhone(os, w, h)) out.push(`${os} ${name} upright (${w}×${h}) is not a phone`);
      if (!isPhone(os, h, w)) out.push(`${os} ${name} sideways (${h}×${w}) is not a phone: it would cross the 768 / 900 lines`);
      if (bpWidth(os, w, h) !== w) out.push(`${os} ${name} upright: breakpoint width ${bpWidth(os, w, h)}, want ${w} (portrait must not change)`);
      if (bpWidth(os, h, w) !== w) out.push(`${os} ${name} sideways: breakpoint width ${bpWidth(os, h, w)}, want its portrait width ${w}`);
    }
    if (isPhone('web', w, h) || isPhone('web', h, w)) out.push(`web at ${name} size is called a native phone: the browser must be untouched`);
    if (bpWidth('web', h, w) !== h) out.push(`web ${h}×${w}: breakpoint width must be the window width`);
  }
  // What the rule deliberately leaves alone (wave 6c: a native window that is
  // not a phone keeps the by-width rules; the smoke suites mount these sizes).
  for (const [os, w, h] of [['android', 1000, 700], ['android', 1100, 800], ['ios', 1512, 945], ['ios', 1100, 800], ['ios', 1366, 1024]] as const) {
    if (isPhone(os, w, h)) out.push(`${os} ${w}×${h} (short side ${Math.min(w, h)}) is called a phone: it is a tablet-sized window`);
    if (bpWidth(os, w, h) !== w) out.push(`${os} ${w}×${h}: breakpoint width must stay ${w}`);
  }
  for (const w of [390, 899, 900, 1023, 1024, 1512]) if (isPhone('web', w, 800)) out.push(`web ${w} is called a native phone`);
  // Unmeasured axes never throw and never make a phone a tablet.
  if (!isPhone('ios', 393, 0) || !isPhone('ios', 0, 393) || !isPhone('ios', 0, 0)) out.push('an unmeasured window on iOS must read as a phone');
  if (!isPhone('ios', NaN, 393)) out.push('a NaN width must not turn a phone into a tablet');
  return out;
}

function ruleGuard(files: Files): string[] {
  const out = guardBehaviour(isNativePhone, breakpointWidth);
  if (NATIVE_PHONE_SHORT_SIDE_MAX !== 600) out.push(`NATIVE_PHONE_SHORT_SIDE_MAX is ${NATIVE_PHONE_SHORT_SIDE_MAX}: it must clear the widest iPhone short side (440) and stay under a tablet's (600, Android sw600dp)`);

  const np = code(files, NATIVE_PHONE);
  if (/from 'react-native'/.test(np)) out.push(`${NATIVE_PHONE} must stay pure (no react-native import): this validator executes it`);

  const rl = code(files, 'utils/useResponsiveLayout.ts');
  if (!/let screenSize: ScreenSize = 'phone';\s*if \(isNativePhone\(Platform\.OS, width, height\)\) \{\s*screenSize = 'phone';\s*\} else if \(width >= 1024 \|\| \(isWeb && width >= 900\)\) \{\s*screenSize = 'desktop';\s*\} else if \(width >= 768\) \{\s*screenSize = 'tablet';\s*\}/.test(rl)) {
    out.push("utils/useResponsiveLayout.ts: the isNativePhone branch must run BEFORE the 1024 / 900 / 768 comparisons. Without it a sideways iPhone is a 'tablet': the Schedule tab swaps the phone schedule for the classic one (and loses its state), Home goes to dense rows");
  }
  if (count(rl, /\bscreenSize = '/g) !== 3) out.push("utils/useResponsiveLayout.ts assigns screenSize somewhere new: a later assignment can undo the native-phone branch");

  const r = code(files, 'utils/useResponsive.ts');
  if (!/const \{ width, height \} = useWindowDimensions\(\);\s*const bw = breakpointWidth\(Platform\.OS, width, height\);\s*const bp: Breakpoint = bw < 600 \? 'phone' : bw < 900 \? 'tablet' : 'desktop';/.test(r)) {
    out.push("utils/useResponsive.ts: the scheduler breakpoint must compare breakpointWidth(Platform.OS, width, height). On the raw width a sideways Pro Max is 'desktop' and gets the full split panes");
  }

  const hook = code(files, 'utils/useBreakpointWidth.ts');
  if (!/const \{ width, height \} = useWindowDimensions\(\);\s*return breakpointWidth\(Platform\.OS, width, height\);/.test(hook)) {
    out.push('utils/useBreakpointWidth.ts must return breakpointWidth(Platform.OS, width, height) of the live window');
  }
  return out;
}

// 5b ── no raw width breakpoint ───────────────────────────────────────────────
const WIDTHISH = String.raw`(?:[\w$.]*(?:[wW]idth|winW|screenW|frameW|SCREEN_WIDTH|SCREEN_W)|useBreakpointWidth\(\)|breakpointWidth\([^()]*\))`;
const BREAKPOINT_RE = new RegExp(String.raw`(${WIDTHISH})\s*(>=|<=|>|<)\s*(\d{3,4}|[A-Z][A-Z0-9_]*)\b`, 'g');
const CONST_IS_BREAKPOINT = /BREAKPOINT|WIDE|MIN_WIDTH|WRAP_|_BP$/;

function breakpointHits(c: string): { left: string; text: string; line: string }[] {
  const hits: { left: string; text: string; line: string }[] = [];
  for (const line of c.split('\n')) {
    for (const m of line.matchAll(BREAKPOINT_RE)) {
      const rhs = m[3];
      if (/^\d+$/.test(rhs)) {
        const n = Number(rhs);
        if (n < 600 || n > 1599) continue; // not a layout line
      } else if (!CONST_IS_BREAKPOINT.test(rhs)) continue;
      // `maxWidth < 900`-style STYLE values are not window reads.
      if (/(?:^|\.)(?:max|min)Width$/i.test(m[1]) || /(?:border|stroke|line)Width$/i.test(m[1])) continue;
      hits.push({ left: m[1], text: m[0], line: line.trim() });
    }
  }
  return hits;
}

function ruleBreakpoints(files: Files): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of files.keys()) {
    if (!isSource(p)) continue;
    const c = code(files, p);
    const hits = breakpointHits(c);
    if (hits.length === 0) continue;
    seen.add(p);
    const policy = BREAKPOINT_FILES[p];
    if (!policy) {
      out.push(`${p} compares a window width with a layout breakpoint (${hits.map((h) => h.text).join('; ')}) and is not in BREAKPOINT_FILES. Read the width through useBreakpointWidth() / breakpointWidth(), or list the file with the reason a sideways phone cannot cross the line`);
      continue;
    }
    if (policy.kind === 'var') {
      if (!/const width = useBreakpointWidth\(\);/.test(c)) out.push(`${p}: \`width\` must be useBreakpointWidth() (it decides ${hits.map((h) => h.text).join('; ')})`);
      if (/\buseWindowDimensions\(|\bDimensions\.get\(/.test(c)) out.push(`${p} reads the raw window as well as useBreakpointWidth(): a breakpoint on the raw width is back within reach`);
      for (const h of hits) {
        if (!/^(?:width|contentWidth|useBreakpointWidth\(\))$/.test(h.left)) out.push(`${p}: \`${h.text}\` compares ${h.left}, which is not the guarded width`);
      }
    } else if (policy.kind === 'inline') {
      for (const h of hits) {
        if (!/useBreakpointWidth\(\)|breakpointWidth\(/.test(h.line)) out.push(`${p}: \`${h.text}\` is a raw width breakpoint (the guard must be on the same line)`);
      }
    } else if (hits.length !== policy.hits) {
      out.push(`${p} is exempt for ${policy.hits} comparison(s) (${policy.why}) but now has ${hits.length}: ${hits.map((h) => h.text).join('; ')}`);
    }
  }
  for (const p of Object.keys(BREAKPOINT_FILES)) {
    if (!seen.has(p)) out.push(`${p} is in BREAKPOINT_FILES but no longer compares a width with a breakpoint: remove the entry (or the scan stopped seeing it)`);
  }
  return out;
}

// 6 ── the opened screen ──────────────────────────────────────────────────────
function ruleViewer(files: Files): string[] {
  const out: string[] = [];
  for (const p of rotatableFiles()) {
    const c = code(files, p);
    if (!c) { out.push(`${p} is on the allow-list and does not exist`); continue; }
    if (/\bDimensions\s*\.\s*get\s*\(/.test(c) || /\bDimensions\b/.test(c)) {
      out.push(`${p} uses Dimensions: a size read once (at module load or at one render) is stale the moment the phone turns. Use useWindowDimensions() or onLayout`);
    }
    if (!/\buseWindowDimensions\(\)/.test(c)) out.push(`${p} must read the live window with useWindowDimensions()`);
    if (!/\binsets\.left\b/.test(c) || !/\binsets\.right\b/.test(c)) {
      out.push(`${p} does not pad insets.left / insets.right: sideways, its controls sit under the notch / Dynamic Island and the rounded corners`);
    }
    const modals = count(c, /<Modal(?=[\s>/])/g);
    const turned = count(c, /\bsupportedOrientations=\{ROTATABLE_MODAL_ORIENTATIONS\}/g);
    if (modals !== turned) out.push(`${p} has ${modals} <Modal> and ${turned} with supportedOrientations={ROTATABLE_MODAL_ORIENTATIONS}: a sheet without it is presented upright over a sideways screen`);
    if (!/isNativePhone\(Platform\.OS, winW, winH\) && winW > winH/.test(c)) {
      out.push(`${p}: the landscape branch must be \`isNativePhone(Platform.OS, winW, winH) && winW > winH\` (a phone only, never web, never a tablet)`);
    }
  }
  return out;
}

function audit(files: Files): Failures {
  return {
    plist: rulePlist(files),
    layouts: ruleLayouts(files),
    allowlist: ruleAllowlist(files),
    modal: ruleModal(files),
    guard: ruleGuard(files),
    breakpoints: ruleBreakpoints(files),
    viewer: ruleViewer(files),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

const repo = loadRepo();
const real = audit(repo);

const TITLES: Record<Rule, string> = {
  plist: 'the Info.plist allows portrait + both landscapes; Android and iPad are untouched',
  layouts: `all ${Object.keys(LAYOUTS).length} layouts: every <Stack> defaults to orientation 'portrait_up'`,
  allowlist: `only [${ROTATABLE_ROUTES.join(', ')}] may rotate, through ROTATABLE_ORIENTATION (iOS only)`,
  modal: 'no <Modal> sets supportedOrientations outside an opened screen; the iPhone default is still portrait only',
  guard: 'a native phone is a phone at every width (utils/nativePhone, both breakpoint hooks)',
  breakpoints: `no raw window-width breakpoint: ${Object.keys(BREAKPOINT_FILES).length} files accounted for`,
  viewer: 'the opened screen reads the live window, pads the side insets, and its sheets accept landscape',
};

console.log('\nLandscape lock (LANDSCAPE-0):');
for (const rule of Object.keys(TITLES) as Rule[]) {
  ok(TITLES[rule], real[rule].length === 0, real[rule].join('\n      '));
}
ok(`${IPHONES.length} iPhone sizes × upright / sideways × iOS / Android are all 'phone'`, guardBehaviour(isNativePhone, breakpointWidth).length === 0);

// ── planted mutations: each rule must catch its own ──────────────────────────
console.log('\nPlanted mutations (each must be caught by the named rule):');

function edit(path: string, fn: (src: string) => string): Files {
  const src = repo.get(path);
  if (src === undefined) throw new Error(`mutation target missing: ${path}`);
  const next = fn(src);
  if (next === src) throw new Error(`mutation did not change ${path}`);
  const copy = new Map(repo);
  copy.set(path, next);
  return copy;
}
function editJson(path: string, fn: (j: any) => void): Files {
  return edit(path, (src) => { const j = JSON.parse(src); fn(j); return JSON.stringify(j, null, 2); });
}
function add(path: string, src: string): Files {
  if (repo.has(path)) throw new Error(`mutation would overwrite ${path}`);
  const copy = new Map(repo);
  copy.set(path, src);
  return copy;
}
/** Replace exactly one occurrence, or the mutation is not the one intended. */
function swap(src: string, from: string, to: string): string {
  if (src.split(from).length !== 2) throw new Error(`expected exactly one ${JSON.stringify(from.slice(0, 60))}`);
  return src.replace(from, to);
}
function caught(name: string, rule: Rule, files: Files) {
  const got = audit(files)[rule];
  ok(`${rule}: ${name}`, got.length > 0, 'NOT CAUGHT');
}

// plist
caught('the infoPlist key is removed', 'plist', editJson('app.json', (j) => { delete j.expo.ios.infoPlist.UISupportedInterfaceOrientations; }));
caught('LandscapeRight is dropped', 'plist', editJson('app.json', (j) => { j.expo.ios.infoPlist.UISupportedInterfaceOrientations.pop(); }));
caught('PortraitUpsideDown is added', 'plist', editJson('app.json', (j) => { j.expo.ios.infoPlist.UISupportedInterfaceOrientations.push('UIInterfaceOrientationPortraitUpsideDown'); }));
caught('portrait is dropped (landscape only)', 'plist', editJson('app.json', (j) => { j.expo.ios.infoPlist.UISupportedInterfaceOrientations.shift(); }));
caught('"orientation" becomes "default" (Android unlocks)', 'plist', editJson('app.json', (j) => { j.expo.orientation = 'default'; }));
caught('ios.supportsTablet is turned on', 'plist', editJson('app.json', (j) => { j.expo.ios.supportsTablet = true; }));
caught('expo-screen-orientation is installed', 'plist', editJson('package.json', (j) => { j.dependencies['expo-screen-orientation'] = '~9.0.0'; }));

// layouts
caught('the root Stack loses its default', 'layouts', edit(ROOT_LAYOUT, (s) => swap(s, "<Stack screenOptions={{ orientation: 'portrait_up', ", '<Stack screenOptions={{ ')));
caught("the root Stack default becomes 'all'", 'layouts', edit(ROOT_LAYOUT, (s) => swap(s, "<Stack screenOptions={{ orientation: 'portrait_up', ", "<Stack screenOptions={{ orientation: 'all', ")));
caught('the Schedule tab stack loses its default', 'layouts', edit('app/(tabs)/schedule/_layout.tsx', (s) => swap(s, ", orientation: 'portrait_up'", '')));
caught("the Settings tab stack becomes 'default'", 'layouts', edit('app/(tabs)/settings/_layout.tsx', (s) => swap(s, "orientation: 'portrait_up'", "orientation: 'default'")));
caught('a nested stack moves its options into a variable', 'layouts', edit('app/(tabs)/subs/_layout.tsx', (s) => swap(s, "screenOptions={{ headerShown: false, orientation: 'portrait_up' }}", 'screenOptions={opts}')));
caught('a new layout file appears', 'layouts', add('app/(tabs)/reports/_layout.tsx', "import { Stack } from 'expo-router';\nexport default function L() { return <Stack screenOptions={{ headerShown: false }} />; }\n"));
caught('a navigator is mounted outside a layout', 'layouts', add('components/InnerNav.tsx', "import { Stack } from 'expo-router';\nexport default function N() { return <Stack />; }\n"));
caught('the tabs layout starts mounting a Stack', 'layouts', edit('app/(tabs)/_layout.tsx', (s) => `${s}\nexport function Extra() { return <Stack screenOptions={{ headerShown: false }} />; }\n`));

// allow-list
caught('punch-pin is opened without touching the allow-list', 'allowlist', edit(ROOT_LAYOUT, (s) => swap(s, '<Stack.Screen name="punch-pin" options={{ headerShown: false }} />', '<Stack.Screen name="punch-pin" options={{ headerShown: false, orientation: ROTATABLE_ORIENTATION }} />')));
caught("a screen is given a raw orientation: 'all'", 'allowlist', edit(ROOT_LAYOUT, (s) => swap(s, '<Stack.Screen name="punch-pin" options={{ headerShown: false }} />', "<Stack.Screen name=\"punch-pin\" options={{ headerShown: false, orientation: 'all' }} />")));
caught('the plan viewer is locked again while still on the list', 'allowlist', edit(ROOT_LAYOUT, (s) => swap(s, 'options={{ headerShown: false, orientation: ROTATABLE_ORIENTATION }}', 'options={{ headerShown: false }}')));
caught('a screen file unlocks itself with <Stack.Screen options>', 'allowlist', edit('app/punch-pin.tsx', (s) => `${s}\nexport const o = { orientation: 'all' };\n`));
caught("the rotatable value becomes 'all' on every platform (Android rotates)", 'allowlist', edit(ORIENTATION_CONST, (s) => swap(s, "Platform.OS === 'ios' ? 'all' : 'portrait_up';", "'all';")));
caught('the rotatable value becomes landscape-only (throws on a portrait-only build)', 'allowlist', edit(ORIENTATION_CONST, (s) => swap(s, "Platform.OS === 'ios' ? 'all' : 'portrait_up';", "Platform.OS === 'ios' ? 'landscape' : 'portrait_up';")));
caught('the modal list loses portrait', 'allowlist', edit(ORIENTATION_CONST, (s) => swap(s, "= ['portrait', 'landscape'];", "= ['landscape'];")));
caught('a screen imports expo-screen-orientation', 'allowlist', edit('app/punch-pin.tsx', (s) => `import * as ScreenOrientation from 'expo-screen-orientation';\n${s}`));
caught('ROTATABLE_ORIENTATION is used from a screen file', 'allowlist', edit('app/punch-pin.tsx', (s) => `${s}\nexport const r = ROTATABLE_ORIENTATION;\n`));

// modal
caught('a sheet on a locked screen sets supportedOrientations', 'modal', edit('app/punch-pin.tsx', (s) => `${s}\nexport const M = () => <Modal supportedOrientations={['portrait', 'landscape']} />;\n`));
caught('an opened screen passes a hand-written list', 'modal', edit('app/plan-viewer.tsx', (s) => s.replace('supportedOrientations={ROTATABLE_MODAL_ORIENTATIONS}', "supportedOrientations={['landscape']}")));
caught('React Native changes the iPhone Modal default', 'modal', edit(RN_MODAL, (s) => swap(s, 'return UIInterfaceOrientationMaskPortrait;', 'return UIInterfaceOrientationMaskAll;')));
caught('the React Native Modal source moves', 'modal', (() => { const c = new Map(repo); c.delete(RN_MODAL); return c; })());

// guard (source)
caught('useResponsiveLayout drops the native-phone branch', 'guard', edit('utils/useResponsiveLayout.ts', (s) => swap(s, "if (isNativePhone(Platform.OS, width, height)) {\n      screenSize = 'phone';\n    } else if (width >= 1024", 'if (width >= 1024')));
caught('useResponsiveLayout checks the width first', 'guard', edit('utils/useResponsiveLayout.ts', (s) => swap(s, 'if (isNativePhone(Platform.OS, width, height)) {', 'if (width < 768 && isNativePhone(Platform.OS, width, height)) {')));
caught('useResponsive goes back to the raw width', 'guard', edit('utils/useResponsive.ts', (s) => swap(s, "bw < 600 ? 'phone' : bw < 900", "width < 600 ? 'phone' : width < 900")));
caught('useBreakpointWidth returns the raw width', 'guard', edit('utils/useBreakpointWidth.ts', (s) => swap(s, 'return breakpointWidth(Platform.OS, width, height);', 'return width;')));
caught('nativePhone imports react-native', 'guard', edit(NATIVE_PHONE, (s) => `import { Platform } from 'react-native';\n${s}`));

// guard (behaviour): broken helpers
function behaviourCaught(name: string, isPhone: PhoneFn, bpWidth: WidthFn = (p, w, h) => (isPhone(p, w, h) ? Math.min(w, h) : w)) {
  ok(`guard: ${name}`, guardBehaviour(isPhone, bpWidth).length > 0, 'NOT CAUGHT');
}
behaviourCaught('a helper that decides by width (< 768)', (p, w) => p !== 'web' && w < 768);
behaviourCaught('a helper that is iOS only', (p, w, h) => p === 'ios' && Math.min(w, h) < 600);
behaviourCaught('a helper that calls every native window a phone', (p) => p !== 'web');
behaviourCaught('a helper that also fires on web', (_p, w, h) => Math.min(w, h) < 600);
behaviourCaught('a short-side line of 400 (misses the Air, Plus and Pro Max)', (p, w, h) => p !== 'web' && Math.min(w, h) < 400);
behaviourCaught('a short-side line of 768 (an Android tablet becomes a phone)', (p, w, h) => p !== 'web' && Math.min(w, h) < 768);
behaviourCaught('a breakpoint width that stays the raw width sideways', isNativePhone, (_p, w) => w);
behaviourCaught('a breakpoint width that is the long side', isNativePhone, (p, w, h) => (isNativePhone(p, w, h) ? Math.max(w, h) : w));

// breakpoints
caught('schedule-pro reads useWindowDimensions again', 'breakpoints', edit('app/schedule-pro.tsx', (s) => swap(s, 'const width = useBreakpointWidth();', 'const { width } = useWindowDimensions();')));
caught('the wizard keeps the guard and adds a raw read beside it', 'breakpoints', edit('app/schedule-wizard.tsx', (s) => `${s}\nexport function useRaw() { return useWindowDimensions().width; }\n`));
caught('a new file adds a raw `width >= 900`', 'breakpoints', add('components/NewWide.tsx', "import { useWindowDimensions } from 'react-native';\nexport function useWide() { const { width } = useWindowDimensions(); return width >= 900; }\n"));
caught('a new file adds a raw named breakpoint', 'breakpoints', add('components/NewWide2.tsx', 'const WIDE_BREAKPOINT = 820;\nexport const wide = (windowWidth: number) => windowWidth >= WIDE_BREAKPOINT;\n'));
caught('an inline-guarded file goes raw', 'breakpoints', edit('app/skills-certificates.tsx', (s) => swap(s, 'const twoUp = useBreakpointWidth() >= 768;', 'const twoUp = width >= 768;')));
caught('the takeoff inspector goes raw', 'breakpoints', edit('components/TakeoffPageInspector.tsx', (s) => swap(s, 'breakpointWidth(Platform.OS, frameW, screenH) >= 760', 'frameW >= 760')));
caught('an exempt file gains a second comparison', 'breakpoints', edit('app/shared-photos.tsx', (s) => `${s}\nexport const big = (width: number) => width >= 900;\n`));

// viewer
caught("a module-scope Dimensions.get('window')", 'viewer', edit('app/plan-viewer.tsx', (s) => swap(s, "type Mode = 'pin' | 'draw' | 'measure' | 'calibrate';", "const SCREEN_W = Dimensions.get('window').width;\ntype Mode = 'pin' | 'draw' | 'measure' | 'calibrate';")));
caught('the side insets are dropped', 'viewer', edit('app/plan-viewer.tsx', (s) => s.split('insets.right').join('0')));
caught('one sheet loses supportedOrientations', 'viewer', edit('app/plan-viewer.tsx', (s) => s.replace(' supportedOrientations={ROTATABLE_MODAL_ORIENTATIONS}', '')));
caught('the landscape branch stops checking for a phone (an Android tablet gets the column)', 'viewer', edit('app/plan-viewer.tsx', (s) => swap(s, 'isNativePhone(Platform.OS, winW, winH) && winW > winH', "Platform.OS !== 'web' && winW > winH")));
caught('the screen stops reading the live window', 'viewer', edit('app/plan-viewer.tsx', (s) => swap(s, 'const { width: winW, height: winH } = useWindowDimensions();', 'const winW = 390; const winH = 844;')));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
