// validate-shell-6c.ts — the wave-6c desktop shell: the 64 px sidebar rail,
// the Home-only action rail, the property-manager nav, and the dialog wiring
// the rest of 6c leans on.
//
// WHY. The founder, on a 1512 × 945 MacBook: "the website app... really isn't
// utilizing the space a computer screen gives you" and "the scheduler does not
// work well". Two shell facts cost him the most width: the 240 px sidebar
// stayed full on the canvases (Schedule Pro, the plan viewer), and the 300 px
// "Action Required" rail drew beside EVERY tab. Lane S made the sidebar
// collapse to a 64 px icon rail (canvas routes default to it; Cmd+Backslash,
// remembered per kind of route) and the action rail Home-only.
//
// Two kinds of check:
//   1. the pure rules (utils/sidebarRail), run for real — including the
//      action-rail truth table and the badge expression it replaced;
//   2. source pins for the wiring no pure test can reach (a validator cannot
//      render the sidebar), each naming the file it guards.
//
// Pure: node:fs + utils/sidebarRail + utils/desktopPage (both type-only
// importers). constants/designTokens pulls react-native, so it is read as TEXT.
//
// Run via: bun run test:shell-6c

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACTION_RAIL_MIN_WIDTH,
  CANVAS_ROUTES,
  DEFAULT_RAIL_PREF,
  SIDEBAR_FULL,
  SIDEBAR_RAIL,
  SIDEBAR_RAIL_KEY,
  actionRailVisible,
  attentionBadgeLabel,
  isCanvasRoute,
  parseRailPref,
  railCollapsed,
  sidebarWidthFor,
  sidebarWidthForRoute,
  toggledPref,
  type ActionRailInput,
} from '../utils/sidebarRail';
import { DESKTOP_SHELL_EXEMPT } from '../utils/desktopPage';
import { isAppStorageKey } from '../utils/localCacheKeys';
import { parseCombo } from '../hooks/useHotkeys';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
/** Comments blanked, strings kept (so a pin cannot be satisfied by a
 *  comment). String-aware — a naive regex strips half of app/_layout.tsx at a
 *  '/*' inside a string. Same scanner as validate-desktop-layout.ts. */
function code(src: string): string {
  const out = src.split('');
  type Mode = 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl';
  let mode: Mode = 'code';
  const blank = (at: number) => { if (out[at] !== '\n') out[at] = ' '; };
  for (let i = 0; i < src.length;) {
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

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, detail ? `\n     ${detail}` : ''); }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n1. utils/sidebarRail — the pure rules');
// ─────────────────────────────────────────────────────────────────────────────

for (const bad of [null, undefined, '', '{', 'null', '[]', '42', '{"canvas":1,"workspace":false}', '{"canvas":true}', '{"workspace":"no","canvas":true}']) {
  ok(`parseRailPref(${JSON.stringify(bad)}) is the default`, eq(parseRailPref(bad as string | null), DEFAULT_RAIL_PREF));
}
ok('parseRailPref reads a well-formed pref', eq(parseRailPref('{"canvas":false,"workspace":true}'), { canvas: false, workspace: true }));
ok('the default: canvases collapsed, everything else full', eq(DEFAULT_RAIL_PREF, { canvas: true, workspace: false }));

ok("railCollapsed('schedule-pro', default) is true", railCollapsed('schedule-pro', DEFAULT_RAIL_PREF) === true);
ok("railCollapsed('plan-viewer', default) is true", railCollapsed('plan-viewer', DEFAULT_RAIL_PREF) === true);
ok("railCollapsed('rfi', default) is false", railCollapsed('rfi', DEFAULT_RAIL_PREF) === false);
ok("railCollapsed('(tabs)', default) is false", railCollapsed('(tabs)', DEFAULT_RAIL_PREF) === false);
ok('an unknown / empty top segment is a workspace route', !isCanvasRoute('') && !isCanvasRoute(null) && !isCanvasRoute(undefined));

ok('toggledPref on a canvas flips ONLY canvas', eq(toggledPref('schedule-pro', DEFAULT_RAIL_PREF), { canvas: false, workspace: false }));
ok('toggledPref on a workspace route flips ONLY workspace', eq(toggledPref('rfi', DEFAULT_RAIL_PREF), { canvas: true, workspace: true }));
ok('toggledPref twice is the identity', eq(toggledPref('rfi', toggledPref('rfi', DEFAULT_RAIL_PREF)), DEFAULT_RAIL_PREF));
ok('collapsing on Pro does not collapse the RFI log',
  railCollapsed('rfi', toggledPref('schedule-pro', { canvas: false, workspace: false })) === false);

{
  const tokens = read('constants/designTokens.ts');
  const m = /\bsidebar:\s*\{\s*full:\s*(\d+),\s*rail:\s*(\d+)\s*\}/.exec(tokens);
  ok('designTokens Layout.sidebar = { full, rail } exists', !!m);
  ok('SIDEBAR_FULL / SIDEBAR_RAIL equal the Layout.sidebar literals (240 / 64)',
    !!m && Number(m[1]) === SIDEBAR_FULL && Number(m[2]) === SIDEBAR_RAIL && SIDEBAR_FULL === 240 && SIDEBAR_RAIL === 64,
    m ? `tokens ${m[1]}/${m[2]}, rail module ${SIDEBAR_FULL}/${SIDEBAR_RAIL}` : '');
  ok('sidebarWidthFor: collapsed 64, expanded 240', sidebarWidthFor(true) === 64 && sidebarWidthFor(false) === 240);
  ok('sidebarWidthForRoute: Pro 64, RFI 240 under the default',
    sidebarWidthForRoute('schedule-pro', DEFAULT_RAIL_PREF) === 64 && sidebarWidthForRoute('rfi', DEFAULT_RAIL_PREF) === 240);
}
ok(`SIDEBAR_RAIL_KEY '${SIDEBAR_RAIL_KEY}' is a mageid_ key the sign-out sweep clears`,
  SIDEBAR_RAIL_KEY.startsWith('mageid_') && isAppStorageKey(SIDEBAR_RAIL_KEY));

// ── The Home-only action rail: the truth table ──
{
  const base: ActionRailInput = { isDesktop: true, width: 1512, segments: ['(tabs)', '(home)'], userRole: 'contractor', dockOpen: false };
  const cases: Array<[string, Partial<ActionRailInput>, boolean]> = [
    ['phone', { isDesktop: false, width: 390 }, false],
    ['desktop at 1279', { width: 1279 }, false],
    ['desktop at 1280 on Home', { width: ACTION_RAIL_MIN_WIDTH }, true],
    ['desktop at 1512 on Home', {}, true],
    ['Home index spelled out', { segments: ['(tabs)', '(home)', 'index'] }, true],
    ['/attention (the list IS the page)', { segments: ['(tabs)', '(home)', 'attention'] }, false],
    ['the shell dock holds content', { dockOpen: true }, false],
    ['a property manager', { userRole: 'property_manager' }, false],
    ['a client', { userRole: 'client' }, false],
    ["the 'both' persona keeps it", { userRole: 'both' }, true],
    ['role still loading keeps it (contractor-shaped default)', { userRole: null }, true],
    ['Settings', { segments: ['(tabs)', 'settings'] }, false],
    ['Summary', { segments: ['(tabs)', 'summary'] }, false],
    ['a stack route', { segments: ['rfi'] }, false],
    ['an unmeasured window (NaN)', { width: Number.NaN }, false],
  ];
  for (const [name, patch, want] of cases) {
    ok(`actionRailVisible — ${name}: ${want}`, actionRailVisible({ ...base, ...patch }) === want);
  }
  ok('ACTION_RAIL_MIN_WIDTH is 1280', ACTION_RAIL_MIN_WIDTH === 1280);
}

// ── The Home badge: attentionBadgeLabel IS the expression it replaced ──
{
  // The (tabs)/_layout expression before wave 6c, verbatim.
  const before = (attentionCount: number, sourceFailed: boolean) => (sourceFailed
    ? '!'
    : attentionCount > 0
      ? (attentionCount > 99 ? '99+' : String(attentionCount))
      : undefined);
  const drift: string[] = [];
  for (const n of [0, 1, 5, 99, 100, 150]) {
    for (const failed of [false, true]) {
      if (attentionBadgeLabel(n, failed) !== before(n, failed)) drift.push(`${n}/${failed}`);
    }
  }
  ok('attentionBadgeLabel equals the old tab-layout expression (0 / 5 / 150 / sourceFailed …)', drift.length === 0, drift.join(', '));
  ok('attentionBadgeLabel spot values', attentionBadgeLabel(0, false) === undefined && attentionBadgeLabel(5, false) === '5'
    && attentionBadgeLabel(150, false) === '99+' && attentionBadgeLabel(0, true) === '!');
}

{
  const steps = parseCombo('mod+backslash');
  ok("the rail chord parses as Cmd/Ctrl + '\\\\' (one step, no Alt)",
    steps.length === 1 && steps[0].key === '\\' && steps[0].mod === true && steps[0].alt === false);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2. the route map');
// ─────────────────────────────────────────────────────────────────────────────

ok("'schedule-pro' is not in DESKTOP_SHELL_EXEMPT (Pro has the sidebar again)", !DESKTOP_SHELL_EXEMPT.has('schedule-pro'));
{
  const ghost = [...CANVAS_ROUTES].filter((r) => !existsSync(join(ROOT, 'app', `${r}.tsx`)));
  const exempt = [...CANVAS_ROUTES].filter((r) => DESKTOP_SHELL_EXEMPT.has(r));
  ok(`CANVAS_ROUTES are real route files that show the sidebar (${[...CANVAS_ROUTES].join(', ')})`,
    CANVAS_ROUTES.size === 2 && ghost.length === 0 && exempt.length === 0, `ghost ${ghost.join(',')} exempt ${exempt.join(',')}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3. source pins');
// ─────────────────────────────────────────────────────────────────────────────

{
  const tabs = code(read('app/(tabs)/_layout.tsx'));
  ok('(tabs)/_layout decides the rail with actionRailVisible(…)', /actionRailVisible\(\{/.test(tabs));
  ok('(tabs)/_layout has no `width >= 1280` of its own', !/width\s*>=\s*1280/.test(tabs));
  ok('(tabs)/_layout renders the rail through the desktop-only DesktopHomeRail',
    /<DesktopHomeRail userRole=\{userRole\} \/>/.test(tabs) && !/showActionRail/.test(tabs));
  ok("DesktopHomeRail passes the dock's content as dockOpen", /dockOpen:\s*dock\.content != null/.test(tabs));
  ok('the Home badge is attentionBadgeLabel, and a property manager gets none',
    /attentionBadgeLabel\(attentionCount,/.test(tabs) && /const isPropertyManager = userRole === 'property_manager';/.test(tabs)
    && /const attentionBadge = sourceFailed && !isPropertyManager\s*\?\s*'!'\s*:\s*!isPropertyManager\s*\?\s*attentionBadgeLabel\(attentionCount, false\)\s*:\s*undefined;/.test(tabs));
  ok("the \", couldn't reach MAGE\" suffix is dropped for a property manager only",
    /\(sourceFailed && !isPropertyManager \? ", couldn't reach MAGE" : ''\)/.test(tabs));
  ok('the tab column keeps no numeric maxWidth / contentMaxWidth (6b pin)',
    !/maxWidth:\s*\d/.test(tabs) && !/contentMaxWidth/.test(tabs));
}

{
  const raw = read('components/DesktopSidebar.tsx');
  const side = code(raw);
  ok('DesktopSidebar keeps accessibilityLabel="Primary navigation" in BOTH modes (SIDEBAR_DOM_SELECTOR)',
    (side.match(/accessibilityLabel="Primary navigation"/g) ?? []).length === 2);
  ok('DesktopSidebar keeps `const jobId = isMinimalPersona ? null : activeProjectId;`',
    /const jobId = isMinimalPersona \? null : activeProjectId;/.test(side));
  ok('the Schedule row targets /schedule-pro when the plan has schedule_gantt_pdf and there is a job',
    /const SCHEDULE_PRO_ROUTE: Route = '\/schedule-pro';/.test(side)
    && /const jobAccess = useProjectAccess\(jobId \?\? undefined\);\s*const proSchedule = jobAccess\.canAccess\('schedule_gantt_pdf'\);/.test(side)
    && /if \(item\.key === 'schedule' && jobId && proSchedule\) \{\s*return routeHref\(SCHEDULE_PRO_ROUTE, \{ projectId: jobId \}\);/.test(side)
    && /\}, \[jobId, proSchedule\]\);/.test(side));
  ok('the Schedule row is also active on /schedule-pro',
    /item\.key === 'schedule' && \(pathname === SCHEDULE_PRO_ROUTE \|\| pathname\.startsWith\(SCHEDULE_PRO_ROUTE \+ '\/'\)\)/.test(side));
  ok('JOB_TOOL_ROUTES keeps a job switch on Pro', /\['\/schedule-pro', SCHEDULE_PRO_ROUTE\],\s*\]\);/.test(side));
  ok('PM_NAV_ITEMS: Portfolio + Contacts under PROPERTY MANAGER, then the account rows',
    /const PM_NAV_ITEMS: NavItem\[\] = \[/.test(side)
    && /\{ key: 'home',\s+label: 'Portfolio',\s+icon: Building2,\s+route: '\/\(tabs\)\/\(home\)', section: 'PROPERTY MANAGER', feature: 'projects' \}/.test(side)
    && /\{ key: 'contacts',\s+label: 'Contacts',\s+icon: Users,\s+route: '\/contacts',\s+section: 'PROPERTY MANAGER', feature: 'contacts' \}/.test(side)
    && /const PM_SECTIONS = \['PROPERTY MANAGER'\];/.test(side));
  ok('a property manager gets PM_NAV_ITEMS, a client CLIENT_NAV_ITEMS',
    /isMinimalPersona \? \(userRole === 'property_manager' \? PM_NAV_ITEMS : CLIENT_NAV_ITEMS\) : NAV_ITEMS/.test(side)
    && /const minimalSections = isPropertyManager \? PM_SECTIONS : CLIENT_SECTIONS;/.test(side));
  ok('Construction News sits under SETUP & TOOLS',
    /\{ key: 'construction-news', label: 'Construction News', icon: Newspaper,\s+route: '\/construction-news', section: 'SETUP & TOOLS', feature: 'construction-news' \}/.test(side));
  {
    const navBlock = side.slice(side.indexOf('const NAV_ITEMS'), side.indexOf('const JOB_SECTION'));
    const workspace = (navBlock.match(/section: 'WORKSPACE'/g) ?? []).length;
    ok(`WORKSPACE is six rows (${workspace})`, workspace === 6);
  }
  {
    const onPress = /const renderToggle = [\s\S]*?accessibilityRole="button"/.exec(side)?.[0] ?? '';
    ok('the group holding the current page toggles through an UNSAVED session override',
      /const \[forced, setForced\] = useState<Record<string, boolean>>\(\{\}\);/.test(side)
      && /forced\[toggle\] \?\? \(!!savedOpen\[toggle\] \|\|/.test(side)
      && /setForced\(f => \(\{ \.\.\.f, \[toggle\]: !isOpen\(toggle, members\) \}\)\);/.test(onPress)
      && !/AsyncStorage|SIDEBAR_SECTIONS_KEY/.test(onPress)
      && /useEffect\(\(\) => \{ setForced\(\{\}\); \}, \[activeSection\]\);/.test(side));
  }
  ok('collapsed mode: driven by useSidebarRail(), with a Collapse button and an Expand chevron',
    /const \{ collapsed, toggle: toggleRail \} = useSidebarRail\(\);/.test(side) && /if \(collapsed\) \{/.test(side)
    && /accessibilityLabel="Collapse sidebar"/.test(side) && /<PanelLeftClose\b/.test(side)
    && /accessibilityLabel="Expand sidebar"/.test(side) && /<PanelLeftOpen\b/.test(side));
  {
    const rail = side.slice(side.indexOf('if (collapsed) {'), side.indexOf('\n  return (\n', side.indexOf('if (collapsed) {')));
    ok('the collapsed rail hides JobSwitcher, RECENT, More-for-this-job and the collapsible groups',
      rail.length > 0 && !/<JobSwitcher\b/.test(rail) && !/RECENT/.test(rail) && !/MORE_TOGGLE|MORE_JOB_SECTIONS/.test(rail)
      && !/COLLAPSIBLE_SECTIONS/.test(rail));
    ok('the collapsed rail keeps Search, + New, THIS JOB, WORKSPACE and Settings',
      /openSearch/.test(rail) && /setCreateOpen\(true\)/.test(rail) && /itemsIn\(JOB_SECTION\)/.test(rail)
      && /itemsIn\(WORKSPACE_SECTION\)/.test(rail) && /item\.key === 'settings'/.test(rail));
    ok('rail squares are Layout.control.md (40) and the rail width is Layout.sidebar.rail',
      /width: Layout\.control\.md,\s*height: Layout\.control\.md,/.test(side)
      && /paddingHorizontal: \(Layout\.sidebar\.rail - Layout\.control\.md\) \/ 2,/.test(side));
  }
  ok('the 32 px row height stays (validate-nav-coverage C3)', /const ROW_HEIGHT = 32;/.test(side));
}

{
  const rl = code(read('utils/useResponsiveLayout.ts'));
  ok('useResponsiveLayout reads the rail store (rail-aware sidebarWidth, 0 below desktop)',
    /useSyncExternalStore\(subscribeSidebarRail, getSidebarRail, getSidebarRail\)/.test(rl)
    && /sidebarWidth: isDesktop \? sidebarWidthForRoute\(rail\.topSegment, rail\.pref\) : 0,/.test(rl));
}
{
  const hook = code(read('hooks/useSidebarRail.ts'));
  ok('useSidebarRailRouteSync reports the top segment on desktop and binds mod+backslash on desktop WEB only',
    /useLayoutEffect\(\(\) => \{\s*if \(isDesktop\) setSidebarRoute\(top\);\s*\}, \[isDesktop, top\]\);/.test(hook)
    && /SIDEBAR_RAIL_COMBO = 'mod\+backslash'/.test(hook)
    && /useHotkeys\(RAIL_BINDINGS, \{ scope: 'global', enabled: desktopWeb \}\)/.test(hook)
    && /const desktopWeb = useIsDesktopWeb\(\);/.test(hook));
  const root = code(read('app/_layout.tsx'));
  ok('app/_layout calls useSidebarRailRouteSync() exactly once and keeps width={layout.sidebarWidth}',
    (root.match(/useSidebarRailRouteSync\(\);/g) ?? []).length === 1 && /width=\{layout\.sidebarWidth\}/.test(root));
  const store = code(read('utils/sidebarRailStore.ts'));
  ok('the store loads the pref lazily (first setSidebarRoute) and saves under SIDEBAR_RAIL_KEY in try/catch',
    /function loadOnce\(\)/.test(store) && /export function setSidebarRoute\(top: string\): void \{\s*loadOnce\(\);/.test(store)
    && /s\.setItem\(SIDEBAR_RAIL_KEY, JSON\.stringify\(pref\)\)/.test(store) && /require\('@react-native-async-storage\/async-storage'\)/.test(store)
    && !/^import .*async-storage/m.test(store));
}

{
  const cm = code(read('components/CreateMenu.tsx'));
  const set = /const LIST_FIRST_HREFS: ReadonlySet<string> = new Set\(\[([^\]]*)\]\);/.exec(cm)?.[1] ?? '';
  ok('CreateMenu: new=1 only for the five list-first routes',
    eq(set.split(',').map((x) => x.trim().replace(/'/g, '')).sort(), ['/change-order', '/daily-report', '/invoice', '/rfi', '/submittal']), set);
  ok('CreateMenu: new=1 only under useIsDesktopWeb()',
    /const desktopWeb = useIsDesktopWeb\(\);/.test(cm)
    && /const opensCreate = desktopWeb && LIST_FIRST_HREFS\.has\(opt\.href\);/.test(cm)
    && /\.\.\.\(opensCreate \? \{ new: '1' \} : \{\}\)/.test(cm)
    && (cm.match(/new: '1'/g) ?? []).length === 1);
}

{
  const settings = read('app/(tabs)/settings/index.tsx');
  const OPEN = "{userRole !== 'property_manager' && (<>";
  const CLOSE = '</>)}';
  for (const header of ['ESTIMATE DEFAULTS', 'PDF NAMING', 'YOUR COSTS', 'SUPPLIER MARKETPLACE']) {
    const at = settings.indexOf(`<Text style={styles.sectionHeader}>${header}</Text>`);
    const open = settings.lastIndexOf(OPEN, at);
    const closeBefore = settings.lastIndexOf(CLOSE, at);
    const closeAfter = settings.indexOf(CLOSE, at);
    const nextHeader = settings.indexOf('<Text style={styles.sectionHeader}>', at + 1);
    ok(`Settings: ${header} is hidden from a property manager (header to last row)`,
      at > 0 && open > 0 && open > closeBefore && closeAfter > at && closeAfter < nextHeader);
  }
  const tut = settings.indexOf('testID="show-tutorial"');
  ok("Settings: the 'Tutorials' row (show-tutorial) is not behind the persona gate",
    tut > 0 && settings.lastIndexOf(OPEN, tut) < settings.lastIndexOf(CLOSE, tut));
  ok('Settings: exactly four persona-gated blocks', (settings.match(/\{userRole !== 'property_manager' && \(<>/g) ?? []).length === 4
    && (settings.match(/<\/>\)\}/g) ?? []).length >= 4);
}

{
  const alertHost = code(read('components/AlertHost.tsx'));
  ok('AlertHost: useSheetDialogScope(current !== null) before its early return',
    alertHost.indexOf('useSheetDialogScope(current !== null);') > 0
    && alertHost.indexOf('useSheetDialogScope(current !== null);') < alertHost.indexOf('if (!current) return null;'));
  const search = code(read('components/UniversalSearch.tsx'));
  ok('UniversalSearch: useSheetDialogScope(isOpen) with its other hooks',
    /const \{ isOpen, closeSearch, openVoice, openHelp \} = useSearch\(\);/.test(search) && /useSheetDialogScope\(isOpen\);/.test(search));
  const dock = code(read('components/desktop/ShellDock.tsx'));
  ok('ShellDockHost renders only on desktop WEB (useIsDesktopWeb)',
    /const desktopWeb = useIsDesktopWeb\(\);/.test(dock) && /if \(!desktopWeb \|\| !visible \|\| content == null\) return null;/.test(dock));
  const panel = code(read('components/desktop/SidePanel.tsx'));
  ok("SidePanel: a web landmark (role 'complementary') keeping its accessibilityLabel",
    /role=\{Platform\.OS === 'web' \? 'complementary' : undefined\}/.test(panel) && /accessibilityLabel=\{title\}/.test(panel));
  ok('SidePanel: overlayBelow defaults to SIDE_PANEL_OVERLAY_BELOW and drives the overlay decision',
    /overlayBelow\?: number;/.test(panel) && /overlayBelow = SIDE_PANEL_OVERLAY_BELOW,/.test(panel)
    && /containerWidth < overlayBelow/.test(panel));
  ok("SidePanel: the Esc `when` applies to a GLOBAL-scope panel only",
    /const escWhen = hotkeyScope === 'global'\s*\?/.test(panel) && /targetWithin\(ev\.target, nativeID\)/.test(panel)
    && /\.\.\.\(escWhen \? \{ when: escWhen \} : \{\}\)/.test(panel));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nCmd+S never sends or signs (integration review, round 1)');
// ─────────────────────────────────────────────────────────────────────────────
// useSheetPrimaryHotkey binds Cmd+S as well as Cmd+Enter, so a sheet whose
// primary emails someone or signs a document must opt out of Cmd+S: pressed
// out of habit to "save", it would send the daily report or the sub's invite.
{
  const sheet = code(read('components/ui/Sheet.tsx'));
  const at = sheet.indexOf('export function useSheetPrimaryHotkey(');
  const body = sheet.slice(at, sheet.indexOf('\n}\n', at));
  ok('useSheetPrimaryHotkey takes opts.saveKey (default on) and gates ONLY its mod+s on it',
    /opts\?: \{ saveKey\?: boolean \}/.test(body)
    && /const saveKey = opts\?\.saveKey !== false;/.test(body)
    && /\{ combo: 'mod\+s', handler: \(\) => ref\.current\?\.\(\), enabled: !!onPrimary && saveKey, priority: 1 \}/.test(body)
    && /\{ combo: 'mod\+enter', handler: \(\) => ref\.current\?\.\(\), enabled: !!onPrimary, priority: 1 \}/.test(body), body.slice(0, 400));
  const SEND_OR_SIGN: readonly [string, RegExp][] = [
    ['app/daily-report.tsx', /useSheetPrimaryHotkey\(showSendRecipient, handleConfirmSend, \{ saveKey: false \}\);/],
    ['app/prequal-manager.tsx', /useSheetPrimaryHotkey\(!!sub, send, \{ saveKey: false \}\);/],
    ['app/field-ticket.tsx', /useSheetPrimaryHotkey\([^;]*onSign\(name, title, role, paths\), \{ saveKey: false \}\);/],
    ['app/contract.tsx', /useSheetPrimaryHotkey\([^;]*onSign\(paths, typedName\), \{ saveKey: false \}\);/],
    ['app/contract.tsx', /useSheetPrimaryHotkey\([^;]*onRecord\(draft, [^;]*\), \{ saveKey: false \}\);/],
  ];
  for (const [file, re] of SEND_OR_SIGN) {
    ok(`${file}: its send/sign sheet binds Cmd+Enter only (${re.source.slice(0, 48)}…)`, re.test(code(read(file))));
  }
  // Any OTHER primary, anywhere in app/ or components/, whose handler name
  // says send/sign must opt out too.
  const walkTsx = (dir: string): string[] => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walkTsx(`${dir}/${e.name}`) : e.name.endsWith('.tsx') ? [`${dir}/${e.name}`] : []);
  const loose: string[] = [];
  for (const file of [...walkTsx('app'), ...walkTsx('components')]) {
    for (const m of code(read(file)).matchAll(/useSheetPrimaryHotkey\(([^;]*)\);/g)) {
      if (/\b(send|onSend|handleConfirmSend|onSign|onRecord)\b/.test(m[1]) && !/\{ saveKey: false \}$/.test(m[1])) loose.push(`${file}: ${m[0].slice(0, 90)}`);
    }
  }
  ok('no send/sign primary in those files still takes Cmd+S', loose.length === 0, loose.join('\n     '));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
