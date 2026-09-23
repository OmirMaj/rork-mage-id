// validate-desktop-page-map.ts — every route has a desktop page column, and
// the map names only routes that exist.
//
// WHY (wave 6b). utils/desktopPage.ts is the ONE place that decides how wide a
// route's column is on desktop web (Layout.page[kind], applied by the root
// Stack's DesktopPageFrame). A route the map forgets silently takes a
// fallback, and a name that no longer matches a file is a decision about
// nothing — both are how a "one width source" quietly stops being one. The
// same file also owns DESKTOP_SHELL_EXEMPT, moved out of app/_layout.tsx.
//
// Checks:
//   A. every route file under app/ has an explicit ROUTE_PAGE_TYPE entry, and
//      every entry (and every DESKTOP_SHELL_EXEMPT / SELF_CAPPED name) is a
//      real route file;
//   B. the seeds the two audits decided (form / table / reading / bleed, the
//      four un-exempted tools, Ask + Copilot still exempt) hold;
//   C. the pure lookups behave (fallbacks, pass-through, the tab map);
//   D. the wiring: the root Stack frames through screenLayout, _layout.tsx no
//      longer keeps its own exempt list, (tabs) has no literal width, and
//      useResponsiveLayout's contentMaxWidth reads the same token.
//   E. the web document: the theme boot script, the page ground and the
//      print stylesheet live where the SINGLE-page export actually serves
//      them (public/index.html — Expo ignores app/+html.tsx in that mode),
//      as verbatim copies of components/desktop/webDocument.ts.
//
// Imports utils/desktopPage.ts directly — it is pure (type-only imports), so
// bun can load it; react-native would crash bun.
//
// Run via: bun run test:desktop-page-map

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import {
  DESKTOP_SHELL_EXEMPT,
  ROUTE_PAGE_TYPE,
  SELF_CAPPED_ROUTES,
  TAB_PAGE_TYPE,
  frameKindForRoute,
  pageTypeForRoute,
  pageTypeForTab,
} from '../utils/desktopPage';
import { legacyChrome, Theme } from '../constants/colors';
import {
  PRINT_CSS,
  THEME_BODY_CSS,
  THEME_BOOT_SCRIPT,
  THEME_STORAGE_KEY,
  WEB_DOCUMENT_CSS,
} from '../components/desktop/webDocument';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const APP = join(ROOT, 'app');

let failures = 0;
function ok(name: string, condition: boolean, detail?: string) {
  if (condition) { console.log('  PASS  ' + name); return; }
  failures += 1;
  console.error('  FAIL  ' + name);
  if (detail) console.error('        ' + detail);
}

/** Blank out // and block comments (offsets preserved) so a comment that
 *  quotes a pattern can never satisfy a wiring check. */
function stripComments(src: string): string {
  const out = src.split('');
  let i = 0;
  type Mode = 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl';
  let mode: Mode = 'code';
  const blank = (at: number) => { if (out[at] !== '\n') out[at] = ' '; };
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (mode === 'code') {
      if (two === '//') { mode = 'line'; blank(i); blank(i + 1); i += 2; continue; }
      if (two === '/*') { mode = 'block'; blank(i); blank(i + 1); i += 2; continue; }
      if (src[i] === "'") mode = 'sq';
      else if (src[i] === '"') mode = 'dq';
      else if (src[i] === '`') mode = 'tpl';
      i++; continue;
    }
    if (mode === 'line') { if (src[i] === '\n') mode = 'code'; else blank(i); i++; continue; }
    if (mode === 'block') {
      if (two === '*/') { mode = 'code'; blank(i); blank(i + 1); i += 2; continue; }
      blank(i); i++; continue;
    }
    if (src[i] === '\\') { i += 2; continue; }
    if ((mode === 'sq' && src[i] === "'") || (mode === 'dq' && src[i] === '"') || (mode === 'tpl' && src[i] === '`')) mode = 'code';
    i++;
  }
  return out.join('');
}

const read = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'));

/**
 * The route names the ROOT Stack registers: every screen file under app/ as
 * its path without the extension — except layouts, the (tabs) group (one
 * route, '(tabs)') and the Expo special files that are not screens (+html,
 * +native-intent). +not-found IS a screen.
 */
function rootRouteNames(): string[] {
  const out: string[] = ['(tabs)'];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (dir === APP && name === '(tabs)') continue;
        walk(full);
        continue;
      }
      if (!/\.(tsx|ts)$/.test(name)) continue;
      if (name.startsWith('_layout.')) continue;
      if (name === '+html.tsx' || name === '+native-intent.tsx' || name === '+native-intent.ts') continue;
      out.push(relative(APP, full).split(sep).join('/').replace(/\.(tsx|ts)$/, ''));
    }
  };
  walk(APP);
  return out.sort();
}

const routes = rootRouteNames();
const routeSet = new Set(routes);
const mapKeys = Object.keys(ROUTE_PAGE_TYPE);

console.log('\ndesktop page map — coverage:');
ok(`the scan found the route tree (${routes.length} root routes)`, routes.length > 150 && routeSet.has('project-detail') && routeSet.has('integrations/qbo/callback'),
  'A scanner that has stopped scanning passes every check below.');
const unmapped = routes.filter(r => !(r in ROUTE_PAGE_TYPE));
ok('every route file has an explicit page type', unmapped.length === 0,
  `Add these to utils/desktopPage.ts ROUTE_PAGE_TYPE (auth/form/reading/dashboard/table/bleed): ${unmapped.join(', ')}`);
const stale = mapKeys.filter(k => !routeSet.has(k));
ok('every ROUTE_PAGE_TYPE key is a real route file', stale.length === 0, `No file for: ${stale.join(', ')}`);
const staleExempt = [...DESKTOP_SHELL_EXEMPT].filter(k => !routeSet.has(k));
ok('every DESKTOP_SHELL_EXEMPT name is a real route file', staleExempt.length === 0, `No file for: ${staleExempt.join(', ')}`);
const staleSelf = [...SELF_CAPPED_ROUTES].filter(k => !routeSet.has(k));
ok('every SELF_CAPPED_ROUTES name is a real route file', staleSelf.length === 0, `No file for: ${staleSelf.join(', ')}`);
const selfBleed = [...SELF_CAPPED_ROUTES].filter(k => ROUTE_PAGE_TYPE[k] === 'bleed');
ok('no self-capped route is typed bleed (its type is the token 6c swaps its literal for)', selfBleed.length === 0, selfBleed.join(', '));
const tabDirs = new Set(readdirSync(join(APP, '(tabs)')).filter(n => statSync(join(APP, '(tabs)', n)).isDirectory()));
const staleTabs = Object.keys(TAB_PAGE_TYPE).filter(k => !tabDirs.has(k));
ok('every TAB_PAGE_TYPE key is a real tab', staleTabs.length === 0, staleTabs.join(', '));

console.log('\ndesktop page map — the audit seeds:');
const expectKind = (kind: string, names: string[]) => {
  const wrong = names.filter(n => ROUTE_PAGE_TYPE[n] !== kind);
  ok(`${kind}: ${names.length} seeded routes`, wrong.length === 0, `Not ${kind}: ${wrong.map(n => `${n}=${ROUTE_PAGE_TYPE[n]}`).join(', ')}`);
};
expectKind('form', ['rfi', 'contract', 'company-profile', 'field-ticket', 'submittal', 'lead-detail', 'post-bid',
  'post-job', 'equipment-detail', 'managed-property', 'client-update', 'material-receipt', 'oac-meeting',
  'generative-setup', 'schedule-builder', 'schedule-import', 'copilot', 'copilot-hub', 'ask', 'quick-quote',
  'post-rfp', 'submit-bid-response', 'import-pipeline']);
expectKind('table', ['wip-report', 'bid-leveling', 'buyout-package', 'aia-pay-app']);
// construction-news was seeded 'reading', but its desktop layout is a two-up
// card grid self-capped at 1100; a 760 column squeezed the cards (integration
// round 1). It takes 'dashboard' so the screen's own cap governs.
expectKind('dashboard', ['construction-news']);
expectKind('auth', ['login', 'signup', 'reset-password', 'accept-invite']);
expectKind('bleed', ['schedule-pro', 'plan-viewer', 'takeoff', 'area-takeoff', 'drawing-analyzer', 'punch-pin',
  'photo-annotator', 'leads', 'onboarding', 'persona-select', 'client-view', 'shared-schedule', 'shared-photos',
  'shared-estimate', 'shared-plan', 'prequal-form', 'claim-crew', 'integrations/qbo/callback']);
const unexempted = ['cost-xray', 'scan', 'judges', 'quick-quote'].filter(r => DESKTOP_SHELL_EXEMPT.has(r));
ok('cost-xray, scan, judges and quick-quote have the sidebar back (not shell-exempt)', unexempted.length === 0, unexempted.join(', '));
ok('Ask and Copilot stay shell-exempt until the dock hosts them',
  DESKTOP_SHELL_EXEMPT.has('ask') && DESKTOP_SHELL_EXEMPT.has('copilot') && DESKTOP_SHELL_EXEMPT.has('copilot-hub'));
ok('schedule-pro stays shell-exempt (its breakpoints assume the full window)', DESKTOP_SHELL_EXEMPT.has('schedule-pro'));
// The owner's workspace sidebar must never draw on a page a stranger opens
// (a homeowner's client-view, a sub's prequal form, a shared plan link) or on
// the signed-out / first-run pages. Moving the set out of app/_layout.tsx left
// validate-plan-share's regex matching a comment, so the membership is pinned
// here, against the set itself.
const MUST_STAY_EXEMPT = [
  'login', 'signup', 'reset-password', 'onboarding', 'persona-select', 'onboarding-paywall',
  'client-view', 'prequal-form', 'claim-crew', ...routes.filter(r => r.startsWith('shared-')),
];
const leaked = MUST_STAY_EXEMPT.filter(r => !DESKTOP_SHELL_EXEMPT.has(r));
ok(`auth, first-run and external-viewer routes stay shell-exempt (${MUST_STAY_EXEMPT.length}, incl. every shared-* file)`,
  leaked.length === 0 && MUST_STAY_EXEMPT.includes('shared-plan') && MUST_STAY_EXEMPT.includes('shared-estimate'),
  `The owner's sidebar would draw on: ${leaked.join(', ')}`);
const unframedUnexempted = ['cost-xray', 'scan', 'quick-quote'].filter(r => frameKindForRoute(r) === null);
ok('the un-exempted tools render framed (judges caps itself)', unframedUnexempted.length === 0 && SELF_CAPPED_ROUTES.has('judges'),
  unframedUnexempted.join(', '));

console.log('\ndesktop page map — lookups:');
ok("an unmapped shell-exempt name falls back to 'bleed'", pageTypeForRoute('shared-plan/some-future-child') === 'bleed');
ok("an unmapped ordinary name falls back to 'dashboard'", pageTypeForRoute('no-such-route') === 'dashboard');
ok("'(tabs)' passes through (the tab navigator frames itself)", frameKindForRoute('(tabs)') === null);
ok('a bleed route passes through', frameKindForRoute('schedule-pro') === null && frameKindForRoute('leads') === null);
ok('a self-capped route passes through', frameKindForRoute('project-detail') === null && frameKindForRoute('login') === null);
ok('a form route is framed as form', frameKindForRoute('rfi') === 'form' && frameKindForRoute('copilot-hub') === 'form');
ok('a table route is framed as table', frameKindForRoute('wip-report') === 'table');
ok("the estimate tab is a table, every other tab a dashboard",
  pageTypeForTab('estimate') === 'table' && pageTypeForTab('(home)') === 'dashboard'
  && pageTypeForTab('schedule') === 'dashboard' && pageTypeForTab(undefined) === 'dashboard');

console.log('\ndesktop page map — wiring:');
const layout = read('app/_layout.tsx');
ok('app/_layout.tsx no longer keeps its own DESKTOP_SHELL_EXEMPT', !/const\s+DESKTOP_SHELL_EXEMPT\b/.test(layout)
  && /import\s*\{[^}]*\bDESKTOP_SHELL_EXEMPT\b[^}]*\}\s*from\s*'@\/utils\/desktopPage'/.test(layout));
ok('the root Stack frames every route through screenLayout',
  /<Stack\b[^>]*\bscreenLayout=\{renderDesktopPageFrame\}/.test(layout)
  && /import\s*\{[^}]*\brenderDesktopPageFrame\b[^}]*\}\s*from\s*'@\/components\/desktop\/DesktopPageFrame'/.test(layout));
const stackNames = [...layout.matchAll(/<Stack\.Screen\s+name="([^"]+)"/g)].map(m => m[1]);
const ghostScreens = stackNames.filter(n => !routeSet.has(n));
ok(`every <Stack.Screen name> in app/_layout.tsx is a route file (${stackNames.length})`, stackNames.length > 100 && ghostScreens.length === 0,
  ghostScreens.join(', '));
ok('the native header is built at render (no module-load NATIVE_HEADER_TITLE)',
  !/const\s+NATIVE_HEADER_TITLE\s*=/.test(layout) && !/headerStyle:\s*\{\s*backgroundColor:\s*Colors\.background/.test(layout));
ok('the navigator theme follows the resolved theme', /<NavThemeProvider\s+value=\{navTheme\}>/.test(layout));
// The header's legacy colours are a pure function (legacyChrome) so they can
// follow the RESOLVED theme; the Colors getters keep their literal form for
// validate-contrast. They must never disagree, or the phone header drifts.
const colorsSrc = read('constants/colors.ts');
const getter = (name: string) => {
  const m = new RegExp(`get\\s+${name}\\(\\)\\s*\\{\\s*return\\s+_currentTheme === 'dark'\\s*\\?\\s*'([^']+)'\\s*:\\s*'([^']+)'`).exec(colorsSrc);
  return m ? { dark: m[1], light: m[2] } : null;
};
const bgGetter = getter('background');
const textGetter = getter('text');
ok('legacyChrome equals the Colors.background / Colors.text getters in both themes',
  !!bgGetter && !!textGetter
  && legacyChrome('light').background === bgGetter.light && legacyChrome('dark').background === bgGetter.dark
  && legacyChrome('light').text === textGetter.light && legacyChrome('dark').text === textGetter.dark,
  `getters ${JSON.stringify({ bgGetter, textGetter })} vs legacyChrome ${JSON.stringify({ light: legacyChrome('light'), dark: legacyChrome('dark') })}`);
ok('the shell mounts the dock host and its provider', /<ShellDockHost\b/.test(layout) && /<ShellDockProvider\b/.test(layout));
const tabs = read('app/(tabs)/_layout.tsx');
ok('(tabs) has no literal page width (one width source)',
  !/maxWidth:\s*\d{3,}/.test(tabs) && !/contentMaxWidth/.test(tabs) && /pageTypeForTab\(/.test(tabs) && /Layout\.page\[/.test(tabs));
const rl = read('utils/useResponsiveLayout.ts');
ok('useResponsiveLayout.contentMaxWidth reads Layout.page.dashboard on desktop',
  /contentMaxWidth:\s*isDesktop\s*\?\s*Layout\.page\.dashboard\b/.test(rl));

console.log('\ndesktop page map — web document (public/index.html):');
{
  // app.json expo.web.output: absent/"single" = SPA export, which serves
  // public/index.html (or Expo's bare default) and never renders +html.
  const appJson = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8'));
  const output = appJson?.expo?.web?.output ?? 'single';
  const indexPath = join(ROOT, 'public', 'index.html');
  let indexHtml = '';
  try { indexHtml = readFileSync(indexPath, 'utf8'); } catch { /* reported below */ }
  const spa = output !== 'static' && output !== 'server';
  ok(`the web build serves public/index.html (web.output="${output}")`, !spa || indexHtml.length > 0,
    'The SPA export ignores app/+html.tsx; without public/index.html the theme boot script and print CSS never reach a browser.');
  ok('public/index.html keeps Expo\'s template contract (placeholders, expo-reset, #root)',
    indexHtml.includes('%LANG_ISO_CODE%') && indexHtml.includes('%WEB_TITLE%')
    && /<style id="expo-reset">/.test(indexHtml) && /<div id="root"><\/div>/.test(indexHtml)
    && /<\/head>/.test(indexHtml) && /<\/body>/.test(indexHtml));
  ok('public/index.html carries THEME_BOOT_SCRIPT verbatim', indexHtml.includes(THEME_BOOT_SCRIPT),
    'Paste components/desktop/webDocument.ts THEME_BOOT_SCRIPT into the mage-theme-boot <script>.');
  ok('public/index.html carries WEB_DOCUMENT_CSS verbatim (page ground + print)', indexHtml.includes(WEB_DOCUMENT_CSS),
    'Paste components/desktop/webDocument.ts WEB_DOCUMENT_CSS into the mage-document <style>.');
  const bootAt = indexHtml.indexOf(THEME_BOOT_SCRIPT);
  const headEnd = indexHtml.indexOf('</head>');
  ok('the boot script runs in <head>, before the app bundle and first paint', bootAt > 0 && bootAt < headEnd);
  ok('the boot script reads the key ThemeContext writes',
    THEME_BOOT_SCRIPT.includes(`getItem('${THEME_STORAGE_KEY}')`)
    && new RegExp(`STORAGE_KEY\\s*=\\s*'${THEME_STORAGE_KEY}'`).test(read('contexts/ThemeContext.tsx')));
  ok('the page ground is the theme tokens in both themes (t.bg)',
    THEME_BODY_CSS.includes(`html[data-theme='dark'] body { background-color: ${Theme.dark.bg}; }`)
    && THEME_BODY_CSS.includes(`html[data-theme='light'] body { background-color: ${Theme.light.bg}; }`));
  const sidebar = read('components/DesktopSidebar.tsx');
  const dock = read('components/desktop/ShellDock.tsx');
  ok('print hides the sidebar, and the selector still matches DesktopSidebar',
    PRINT_CSS.includes("nav[aria-label='Primary navigation']")
    && /'navigation'/.test(sidebar) && /accessibilityLabel="Primary navigation"/.test(sidebar));
  ok('print hides the dock and the sync pill, and their ids still exist',
    PRINT_CSS.includes('#mage-shell-dock') && /nativeID="mage-shell-dock"/.test(dock)
    && PRINT_CSS.includes('#mage-sync-pill') && /nativeID:\s*'mage-sync-pill'/.test(layout));
  ok('the sync pill id is web-only (the native tree gains no prop)',
    !/nativeID="mage-sync-pill"/.test(layout)
    && /Platform\.OS === 'web' \? \{ nativeID: 'mage-sync-pill' \} : null/.test(layout));
  const html = read('app/+html.tsx');
  ok('+html renders the same strings (no second copy to drift)',
    /__html:\s*THEME_BOOT_SCRIPT\b/.test(html) && /__html:\s*WEB_DOCUMENT_CSS\b/.test(html)
    && !/@media print/.test(html) && !/data-theme/.test(html));
}

if (failures > 0) {
  console.error(`\n✗ validate-desktop-page-map: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\n✓ validate-desktop-page-map: every route has a desktop page column');
