// validate-static-header-hidden.ts — a screen that always hides its native
// header must say so in the root Stack too.
//
// THE BUG THIS GUARDS (Sentry REACT-NATIVE-M, 2026-09-07 + 2026-09-24,
// ClientViewScreen and WinOptimizerScreen): a route declared with the header
// SHOWN (a bare title, or not declared at all) whose screen renders
// <Stack.Screen options={{ headerShown: false }} /> in every branch. Pushed on
// top of a modal, iOS treats it as modal too, and react-native-screens draws a
// shown header in a modal through a nested ScreenStack
// (ScreenStackItem isHeaderInModal). The screen's setOptions flips the header
// off, the tree changes shape, the whole screen remounts ("Dynamically
// changing header's visibility in modals will result in remounting the
// screen"), and the remount's setOptions runs again from a layout effect until
// React stops it with "Maximum update depth exceeded" — the route's error
// screen, typed input lost.
//
// THE RULE. For every root route file under app/ (not the tabs group), if
// EVERY <Stack.Screen ...> it renders carries headerShown: false, app/_layout.tsx
// must declare that route with headerShown: false as well, so the header is
// hidden from the first frame and nothing flips. Files that show the header in
// some branch and hide it in another are not covered here (that is a design
// call per screen).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const APP = join(ROOT, 'app');

// Routes this rule does not apply to, with the reason.
const EXEMPT: Record<string, string> = {
  // Share-link pages: opened cold from a link in a browser or Mail, never
  // pushed over an in-app modal, and registering them in the root Stack makes
  // validate-nav-coverage demand an in-app door they deliberately lack.
  'shared-photos': 'share-link page, opened cold (see validate-nav-coverage)',
  'shared-plan': 'share-link page, opened cold (see validate-nav-coverage)',
};

let failures = 0;
let passes = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passes += 1; console.log(`  PASS  ${name}`); }
  else { failures += 1; console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name.startsWith('(')) continue; // route groups (tabs) have their own layouts
      walk(p, out);
    } else if (name.endsWith('.tsx') && !name.startsWith('_') && !name.startsWith('+')) {
      out.push(p);
    }
  }
  return out;
}

const layout = readFileSync(join(APP, '_layout.tsx'), 'utf8');
const declared = new Map<string, string>();
for (const m of layout.matchAll(/<Stack\.Screen\s+name=["']([^"']+)["']([\s\S]*?)\/>/g)) {
  declared.set(m[1], m[2]);
}

const HIDDEN = /headerShown:\s*false/;
const offenders: string[] = [];
let covered = 0;
for (const file of walk(APP)) {
  const src = readFileSync(file, 'utf8');
  const screens = [...src.matchAll(/<Stack\.Screen\b(?![^>]*\bname=)([\s\S]*?)\/>/g)].map(m => m[1]);
  if (screens.length === 0 || !screens.every(s => HIDDEN.test(s))) continue;
  let route = relative(APP, file).replace(/\\/g, '/').replace(/\.tsx$/, '');
  if (route.endsWith('/index')) route = route.slice(0, -'/index'.length);
  if (EXEMPT[route]) continue;
  covered += 1;
  const decl = declared.get(route);
  if (!decl || !HIDDEN.test(decl)) {
    offenders.push(`${route} (${decl === undefined ? 'not declared in app/_layout.tsx' : 'declared with the header shown'})`);
  }
}

console.log('static-header-hidden validation:');
ok(`the scan found self-headed screens to check (${covered})`, covered >= 10,
  'the file walk or the <Stack.Screen> pattern broke — fewer than 10 always-hidden screens found');
ok('every always-hidden screen is declared headerShown:false in app/_layout.tsx',
  offenders.length === 0,
  `${offenders.join(', ')}\n        Add headerShown: false to its <Stack.Screen name=...> in app/_layout.tsx (keep its title), or add it to EXEMPT with the reason.`);
ok('win-optimizer (REACT-NATIVE-M) is hidden from the first frame',
  HIDDEN.test(declared.get('win-optimizer') ?? ''));
ok('client-view (REACT-NATIVE-M) is hidden from the first frame',
  HIDDEN.test(declared.get('client-view') ?? ''));

// Negative control: the matcher must flag a declaration that shows the header.
const probe = `<Stack.Screen name="probe" options={{ title: 'Probe' }} />`;
const probeDecl = [...probe.matchAll(/<Stack\.Screen\s+name=["']([^"']+)["']([\s\S]*?)\/>/g)][0]?.[2] ?? '';
ok('NEGATIVE: a title-only declaration reads as header shown', !HIDDEN.test(probeDecl));

console.log(`\n${failures === 0 ? '✓' : '✗'} validate-static-header-hidden: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
