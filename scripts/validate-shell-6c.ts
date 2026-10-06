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
import { isReservedCombo, parseCombo } from '../hooks/useHotkeys';
// d6r K1 (the keyboard shell's chords — pure, bun-loadable).
import { G_CHORDS, RESERVED_SINGLE_KEYS, chordTarget, chordsFor, type ShellChord } from '../utils/shellChords';
import { jobScopedTarget } from '../utils/activeProject';
import { featureFor } from '../utils/featureRegistry';
import { scheduleDestination } from '../utils/scheduleRoute';

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
    CANVAS_ROUTES.size === 4 && ghost.length === 0 && exempt.length === 0, `ghost ${ghost.join(',')} exempt ${exempt.join(',')}`);
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
    && /accessibilityLabel="Collapse Sidebar"/.test(side) && /<PanelLeftClose\b/.test(side)
    && /accessibilityLabel="Expand Sidebar"/.test(side) && /<PanelLeftOpen\b/.test(side));
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
  // Wave 6d r2: it subscribes to a PRIMITIVE key (width + the pref's two
  // bits), not the store's snapshot object, which setSidebarRoute replaces on
  // every top-level navigation — re-rendering every layout consumer.
  ok('useResponsiveLayout reads the rail store through a primitive key (rail-aware sidebarWidth, 0 below desktop)',
    /function railLayoutKey\(\): string \{\s*const \{ topSegment, pref \} = getSidebarRail\(\);\s*return `\$\{sidebarWidthForRoute\(topSegment, pref\)\}:\$\{pref\.canvas \? 1 : 0\}\$\{pref\.workspace \? 1 : 0\}`;\s*\}/.test(rl)
    && /const railKey = useSyncExternalStore\(subscribeSidebarRail, railLayoutKey, railLayoutKey\);/.test(rl)
    && /sidebarWidth: isDesktop \? railWidth : 0,/.test(rl)
    && /\}, \[width, height, isWeb, railKey\]\);/.test(rl)
    && !/useSyncExternalStore\(subscribeSidebarRail, getSidebarRail/.test(rl));
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
  for (const header of ['Estimate Defaults', 'PDF Naming', 'Your Costs', 'Supplier Marketplace']) {
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
  // d6r K1: the host no longer unmounts on an exempt route (!visible) — the
  // docked content stays MOUNTED (SidePanel keepMounted) and is only not drawn.
  ok('ShellDockHost renders only on desktop WEB (useIsDesktopWeb), keeping docked content mounted',
    /const desktopWeb = useIsDesktopWeb\(\);/.test(dock) && /if \(!desktopWeb \|\| content == null\) return null;/.test(dock)
    && /keepMounted/.test(dock));
  const panel = code(read('components/desktop/SidePanel.tsx'));
  ok("SidePanel: a web landmark (role 'complementary') keeping its accessibilityLabel",
    /role=\{Platform\.OS === 'web' \? 'complementary' : undefined\}/.test(panel) && /accessibilityLabel=\{title\}/.test(panel));
  ok('SidePanel: overlayBelow defaults to SIDE_PANEL_OVERLAY_BELOW and drives the overlay decision',
    /overlayBelow\?: number;/.test(panel) && /overlayBelow = SIDE_PANEL_OVERLAY_BELOW,/.test(panel)
    && /containerWidth < overlayBelow/.test(panel));
  // Wave 6d (C1): the 6c pin here encoded the bug — it required the `when`
  // on GLOBAL-scope panels only, so an Esc typed in any page field closed a
  // page-scope panel (Schedule Pro's pane, with the AI review in it).
  ok("SidePanel: every panel's Esc ignores an Esc typed in a field outside it",
    /const domId = nativeID \?\? \(panelId \? `side-panel-\$\{panelId\}` : autoId\);/.test(panel)
    && /const escWhen = \(ev: \{ target\?: unknown \}\) => !isTypingTarget\(ev\.target\) \|\| \(!!domId && targetWithin\(ev\.target, domId\)\);/.test(panel)
    && /\{ combo: 'escape', label: `Close \$\{title\}`, group: 'Panel', enabled: open, handler: onClose, when: escWhen \}/.test(panel)
    && !/hotkeyScope === 'global'/.test(panel) && /nativeID=\{domId\}/.test(panel));
  ok('SidePanel: a panel with neither nativeID nor panelId still gets a DOM id (side-panel-<n>)',
    /let SIDE_PANEL_SEQ = 0;/.test(panel) && /const autoId = useRef\(`side-panel-\$\{\+\+SIDE_PANEL_SEQ\}`\)\.current;/.test(panel));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nCmd+S never sends, signs, releases or approves (integration review, round 1; wave 6d r2)');
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
    // W2 MOMSIGN: the GC and field ticket signatures are signing ceremonies
    // (the slide is the commit, so those sheets bind no shortcut: pinned
    // below); the paper record's Cmd+Enter plays its slide's hold, never Cmd+S
    // (and not while the paper write holds the sheet: W2 integration).
    ['app/contract.tsx', /useSheetPrimaryHotkey\(visible && method === 'paper' && !paperReason && !busy, \(\) => paperSlideRef\.current\?\.playHoldToCommit\(\), \{ saveKey: false \}\);/],
    // Wave 6d r2 (D5): a crew sign-off is permanent; a retention release
    // reopens settled invoices and restarts their payment clocks.
    ['app/safety-jha.tsx', /useSheetPrimaryHotkey\(signOffFor !== null, handleAddSignOff, \{ saveKey: false \}\);/],
    ['app/retention.tsx', /useSheetPrimaryHotkey\(releaseRow != null && !!plan && plan\.allocations\.length > 0, applyRelease, \{ saveKey: false \}\);/],
  ];
  for (const [file, re] of SEND_OR_SIGN) {
    ok(`${file}: its send/sign sheet binds Cmd+Enter only (${re.source.slice(0, 48)}…)`, re.test(code(read(file))));
  }
  for (const file of ['app/field-ticket.tsx', 'app/contract.tsx']) {
    ok(`${file}: a signing ceremony's sheet binds no shortcut to the signature (the slide is the commit)`,
      !/useSheetPrimaryHotkey\([^;]*onSign\(/.test(code(read(file))) && /<SigningCeremony\b/.test(code(read(file))));
  }
  // Any OTHER primary, anywhere in app/ or components/, whose arguments say
  // it commits must opt out too. Wave 6d r2 (R15): matched by WORDS, not
  // handler NAMES — the 6c name list (send|onSend|…|onRecord) missed
  // handleAddSignOff and applyRelease. Each call's argument text is split into
  // camelCase words; a commit word without the trailing opt-out is flagged.
  const COMMIT_WORDS: ReadonlySet<string> = new Set(['send', 'sign', 'release', 'approve', 'share', 'paid', 'certify', 'dispatch', 'record']);
  const OPT_OUT = /\{\s*saveKey:\s*false\s*\}\s*,?\s*$/;
  const looseCalls = (src: string): string[] => {
    const out: string[] = [];
    for (const m of src.matchAll(/useSheetPrimaryHotkey\(([^;]*)\);/g)) {
      const words = (m[1].match(/[A-Za-z][a-z]*|[A-Z]+(?![a-z])/g) ?? []).map((w) => w.toLowerCase());
      if (words.some((w) => COMMIT_WORDS.has(w)) && !OPT_OUT.test(m[1])) out.push(m[0].replace(/\s+/g, ' ').slice(0, 110));
    }
    return out;
  };
  // Self-test over synthetic sources: the rule, not just today's tree.
  const FLAGGED = [
    'useSheetPrimaryHotkey(open, applyRelease);',
    'useSheetPrimaryHotkey(x !== null, handleAddSignOff);',
    'useSheetPrimaryHotkey(open, () => handleApprove(id));',
  ];
  const PASSES = [
    ...FLAGGED.map((c) => c.replace(/\);$/, ', { saveKey: false });')),
    'useSheetPrimaryHotkey(\n    open,\n    () => onSend(draft),\n    { saveKey: false },\n  );',
    'useSheetPrimaryHotkey(showAddPayment && screenFocused, canAddPayment ? handleAddPayment : null);',
    'useSheetPrimaryHotkey(visible, handleSubmit);',
    'useSheetPrimaryHotkey(open, assignTask);',
  ];
  for (const c of FLAGGED) ok(`Cmd+S scan self-test — flags \`${c}\``, looseCalls(c).length === 1);
  for (const c of PASSES) ok(`Cmd+S scan self-test — passes \`${c.replace(/\s+/g, ' ')}\``, looseCalls(c).length === 0);
  const walkTsx = (dir: string): string[] => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walkTsx(`${dir}/${e.name}`) : e.name.endsWith('.tsx') ? [`${dir}/${e.name}`] : []);
  const loose: string[] = [];
  let calls = 0;
  for (const file of [...walkTsx('app'), ...walkTsx('components')]) {
    const src = code(read(file));
    calls += (src.match(/useSheetPrimaryHotkey\(([^;]*)\);/g) ?? []).length;
    for (const hit of looseCalls(src)) loose.push(`${file}: ${hit}`);
  }
  ok(`no send / sign / release / approve / share / paid / certify / dispatch / record primary still takes Cmd+S (${calls} calls read)`,
    calls > 0 && loose.length === 0, loose.join('\n     '));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nd6r K1 — the Ask dock, the dock API it stands on, and the keyboard shell');
// ─────────────────────────────────────────────────────────────────────────────
// Wave 6d restore, lane K1. Ask MAGE moves into a 440 px dock beside the page
// (components/brain/AskConversation variant 'panel', hooks/useAskDock), the
// dock grows the API that needs (id / hidden / show / toggle / showing /
// canShow, keepMounted, the S4 canvas overlay), and the desktop web app gets
// a keyboard shell ('?' sheet, 13 g-chords, Cmd+J). Pure rules run for real;
// the wiring no pure test can reach is pinned in its own file.

// ── 1. utils/shellChords — the 13 chords ────────────────────────────────────
{
  const combos = G_CHORDS.map((c) => c.combo);
  ok('K1 13 chords, every combo unique', G_CHORDS.length === 13 && new Set(combos).size === 13, combos.join(', '));
  ok('K1 every chord parses as two plain steps, g then a letter, none browser-reserved',
    G_CHORDS.every((c) => {
      const steps = parseCombo(c.combo);
      return steps.length === 2 && steps[0].key === 'g' && steps.every((st) => !st.mod && !st.alt)
        && /^[a-z]$/.test(steps[1].key) && !isReservedCombo(c.combo);
    }));
  ok("K1 'g j' and 'g k' stay unbound (j / k move DataTable rows)", !combos.includes('g j') && !combos.includes('g k'));
  ok('K1 no chord starts with, or uses, a key DataTable owns (j, k, x, /)',
    G_CHORDS.every((c) => parseCombo(c.combo).every((st) => !RESERVED_SINGLE_KEYS.includes(st.key))));
  const expected: Record<string, string> = {
    'g h': 'Projects', 'g b': 'Summary', 'g o': 'Job overview', 'g s': 'Schedule', 'g d': 'Daily reports',
    'g r': 'RFIs', 'g u': 'Submittals', 'g c': 'Change orders', 'g i': 'Invoices', 'g p': 'Punch list',
    'g w': 'Waiting on others', 'g n': 'Inbox', 'g a': 'Action required',
  };
  ok('K1 the chord letters and labels are the approved set (D5)',
    eq(Object.fromEntries(G_CHORDS.map((c) => [c.combo, c.label])), expected));

  // A job tool goes where the sidebar row goes: jobScopedTarget over the
  // registry's projectScoped (DesktopSidebar hrefFor), and the chord's route
  // is the sidebar NAV_ITEMS literal for the same feature.
  const sidebar = read('components/DesktopSidebar.tsx');
  // UX wave D6 moved RFIs and Submittals under the sidebar's DOCUMENTS section;
  // for those two features that row is the one the chord must match.
  const DOCUMENTS_FEATURES = new Set(['rfi', 'submittal']);
  const navRoute = (feature: string): string | null => {
    for (const line of sidebar.split('\n')) {
      if (!new RegExp(`feature: '${feature}'`).test(line)) continue;
      const m = /route: '([^']+)'/.exec(line);
      if (m && (/section: 'THIS JOB'/.test(line) || (DOCUMENTS_FEATURES.has(feature) && /section: 'DOCUMENTS'/.test(line)))) return m[1];
    }
    return null;
  };
  const jobTools = G_CHORDS.filter((c): c is ShellChord & { target: { kind: 'job-tool' } } => c.target.kind === 'job-tool');
  ok('K1 six job-tool chords (daily reports, RFIs, submittals, COs, invoices, punch)', jobTools.length === 6);
  for (const c of jobTools) {
    const t = c.target as { kind: 'job-tool'; feature: Parameters<typeof featureFor>[0]; route: string };
    const want = jobScopedTarget(t.route, { projectScoped: featureFor(t.feature).projectScoped === true, activeProjectId: 'p1' });
    const got = chordTarget(c, { activeProjectId: 'p1', schedule: { canPro: false, proFits: false } });
    ok(`K1 ${c.combo} (${c.label}) with a job = jobScopedTarget over featureFor('${t.feature}').projectScoped`,
      eq(got, want) && eq(got.params, { projectId: 'p1' }), JSON.stringify(got));
    ok(`K1 ${c.combo} route is the sidebar's ${DOCUMENTS_FEATURES.has(t.feature) ? 'DOCUMENTS' : 'THIS JOB'} row for '${t.feature}'`, navRoute(t.feature) === t.route,
      `sidebar ${navRoute(t.feature)} vs chord ${t.route}`);
  }
  const sched = G_CHORDS.find((c) => c.target.kind === 'schedule');
  ok('K1 exactly one schedule chord (g s)', !!sched && sched.combo === 'g s');
  if (sched) {
    for (const canPro of [true, false]) for (const proFits of [true, false]) {
      const want = scheduleDestination({ projectId: 'p1', webDesktop: true, canPro, proFits }, 42);
      const got = chordTarget(sched, { activeProjectId: 'p1', schedule: { canPro, proFits } }, 42);
      ok(`K1 g s = scheduleDestination (canPro ${canPro}, proFits ${proFits}) — C6`,
        got.pathname === want.pathname && eq(got.params, want.params), JSON.stringify(got));
    }
  }
  const overview = G_CHORDS.find((c) => c.target.kind === 'overview');
  ok('K1 g o opens the job\'s overview (/project-detail?id)', !!overview
    && eq(chordTarget(overview, { activeProjectId: 'p1', schedule: { canPro: true, proFits: true } }), { pathname: '/project-detail', params: { id: 'p1' } }));
  const bare = G_CHORDS.map((c) => chordTarget(c, { activeProjectId: null, schedule: { canPro: true, proFits: true } }));
  ok('K1 with no job every chord is a bare route (the screen\'s own picker asks)', bare.every((t) => t.params === undefined),
    JSON.stringify(bare.filter((t) => t.params)));
  ok('K1 with no job g s is the schedule on-ramp and g o is Home',
    !!sched && chordTarget(sched, { activeProjectId: null, schedule: { canPro: true, proFits: true } }).pathname === '/(tabs)/discover/schedule'
    && !!overview && chordTarget(overview, { activeProjectId: null, schedule: { canPro: true, proFits: true } }).pathname === '/(tabs)/(home)');
  ok('K1 a client and a property manager get only Projects and Inbox; a contractor all 13',
    eq(chordsFor('client').map((c) => c.combo), ['g h', 'g n']) && eq(chordsFor('property_manager').map((c) => c.combo), ['g h', 'g n'])
    && chordsFor('contractor').length === 13 && chordsFor(null).length === 13);

  // No page may bind 'g' or '?' on its own (R7): they are the shell's.
  const walkSrc = (dir: string): string[] => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walkSrc(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []);
  const stolen: string[] = [];
  for (const f of [...walkSrc('app'), ...walkSrc('components'), ...walkSrc('hooks')]) {
    if (f === 'components/desktop/ShellHotkeys.tsx') continue;
    const src = code(read(f));
    if (/combo:\s*'(?:g|\?|question)'/.test(src)) stolen.push(f);
  }
  ok("K1 no other file binds a plain 'g' or '?' (the shell's chord lead and sheet key)", stolen.length === 0, stolen.join(', '));
}

// ── 2. The dock API (components/desktop/ShellDock.tsx) ───────────────────────
{
  const dock = code(read('components/desktop/ShellDock.tsx'));
  ok("K1 ShellDock exports ASK_DOCK_ID = 'ask' and ATTENTION_DOCK_ID = 'attention'",
    /export const ASK_DOCK_ID = 'ask';/.test(dock) && /export const ATTENTION_DOCK_ID = 'attention';/.test(dock));
  const api = /export interface ShellDockApi \{([\s\S]*?)\n\}/.exec(dock)?.[1] ?? '';
  ok('K1 ShellDockApi = content, id, hidden, open, close, toggle, show, showing, canShow',
    ['content: React.ReactNode | null;', 'id: string | null;', 'hidden: boolean;', 'open(node: React.ReactNode, opts?: ShellDockOptions): void;',
      'close(): void;', 'toggle(): void;', 'show(): void;', 'showing: boolean;', 'canShow(id: string): boolean;'].every((f) => api.includes(f)), api);
  ok('K1 ShellDockOptions carries an id', /export interface ShellDockOptions \{[\s\S]*?id\?: string;[\s\S]*?\n\}/.test(dock));
  ok('K1 the NOOP default is empty, not hidden, hostless (showing false, canShow false)',
    /const NOOP: ShellDockState = \{\s*content: null, options: \{\}, hidden: false, host: null,/.test(dock));
  ok('K1 useShellDock returns every API field (showing / canShow from the host record)',
    /showing: hostVisible && content != null && !hidden && !\(suppressId != null && id === suppressId\),/.test(dock)
    && /canShow: \(target: string\) => hostVisible && suppressId !== target,/.test(dock)
    && /\bid,\s*\n\s*hidden,\s*\n\s*open,\s*\n\s*close,\s*\n\s*toggle,\s*\n\s*show,/.test(dock));
  ok('K1 the host record travels on a SEPARATE internal context (not on ShellDockApi)',
    /const ShellDockHostContext = createContext</.test(dock) && !/setHost/.test(api));
  const host = /export function ShellDockHost\([\s\S]*$/.exec(dock)?.[0] ?? '';
  const early = host.indexOf('if (!desktopWeb || content == null) return null;');
  ok("K1 ShellDockHost writes the host record in an effect ABOVE its early return, and clears it on unmount",
    early > 0 && host.indexOf('useEffect(() => { setHost({ visible: hostVisible, suppressId }); }') > 0
    && host.indexOf('useEffect(() => { setHost({ visible: hostVisible, suppressId }); }') < early
    && host.indexOf('useEffect(() => () => setHost(null), [setHost]);') > 0 && host.indexOf('useEffect(() => () => setHost(null), [setHost]);') < early
    && /const hostVisible = desktopWeb && visible;/.test(host));
  ok('K1 the provider writes the host record only when it differs (no render loop)',
    /setHostState\(\(prev\) => \(sameHost\(prev, next\) \? prev : next\)\)/.test(dock));
  ok('K1 ShellDockHost keeps docked content mounted: open = visible, not hidden, not suppressed; keepMounted',
    /const suppressedNow = suppressId != null && options\.id === suppressId;/.test(host)
    && /open=\{visible && !hidden && !suppressedNow\}/.test(host) && /\n\s*keepMounted\n/.test(host));
  ok('K1 r3: the host binds its Cmd+J toggle ONLY where the docked content can show (a conditional spread)',
    /\{\.\.\.\(visible && !suppressedNow \? \{ onToggle: toggle \} : null\)\}/.test(host) && !/onToggle=\{toggle\}/.test(host));
  ok('K1 S4: on a canvas route (isCanvasRoute) the dock overlays — overlayBelow = +Infinity, else the default',
    /const segments = useSegments\(\);/.test(host) && /const canvas = isCanvasRoute\(segments\[0\]\);/.test(host)
    && /overlayBelow=\{canvas \? Number\.POSITIVE_INFINITY : undefined\}/.test(host));
}

// ── 3. SidePanel keepMounted (components/desktop/SidePanel.tsx) ──────────────
{
  const panel = code(read('components/desktop/SidePanel.tsx'));
  ok('K1 SidePanel: keepMounted?: boolean (default false)', /keepMounted\?: boolean;/.test(panel) && /keepMounted = false,/.test(panel));
  ok('K1 SidePanel: closed returns null only WITHOUT keepMounted', /if \(!open && !keepMounted\) return null;/.test(panel) && !/if \(!open\) return null;/.test(panel));
  ok('K1 SidePanel: BOTH slide branches end with `!open && styles.hidden` (display none)',
    /\? \[styles\.panel, \{ width \}, overlay \? styles\.overlay : null, style, slide, !open && styles\.hidden\]/.test(panel)
    && /: \[styles\.panel, \{ width \}, overlay \? styles\.overlay : null, style, !open && styles\.hidden\]/.test(panel)
    && /hidden: \{ display: 'none' \},/.test(panel));
  ok('K1 SidePanel: a hidden panel drops its DOM id and hears no Esc (enabled: open)',
    /\{\.\.\.\(open \? null : \{ nativeID: undefined \}\)\}/.test(panel)
    && /\{ combo: 'escape', label: `Close \$\{title\}`, group: 'Panel', enabled: open, handler: onClose, when: escWhen \}/.test(panel));
}

// ── 4. Ask moves into AskConversation; the page is a thin wrapper ────────────
{
  const page = read('app/ask.tsx');
  ok('K1 app/ask.tsx renders <AskConversation variant="page"> and is under 60 lines',
    /<AskConversation\s+variant="page"/.test(code(page)) && page.split('\n').length < 60);
  const ac = code(read('components/brain/AskConversation.tsx'));
  ok('K1 AskConversation exports the component with variant page | panel',
    /export function AskConversation\(props: AskConversationProps\)/.test(ac) && /variant: 'page' \| 'panel';/.test(ac));
  const stackAt = ac.indexOf('<Stack.Screen');
  ok("K1 AskConversation's only <Stack.Screen sits behind variant === 'page'",
    (ac.match(/<Stack\.Screen/g) ?? []).length === 1 && ac.slice(Math.max(0, stackAt - 30), stackAt).includes("props.variant === 'page' && "));
  const panelStart = ac.indexOf('if (panel) {');
  const panelEnd = ac.indexOf('<View style={[styles.container, { paddingTop: insets.top }]}>', panelStart);
  const panelBranch = panelStart > 0 && panelEnd > panelStart ? ac.slice(panelStart, panelEnd) : '';
  ok('K1 the panel branch draws no Stack.Screen, no brand header, no KeyboardAvoidingView, no safe-area padding',
    panelBranch.length > 0 && !/<Stack\.Screen|styles\.header\b|<KeyboardAvoidingView|insets\./.test(panelBranch));
  ok('K1 the panel anchors to the active job; the page to ?projectId',
    /const anchorParam = props\.variant === 'panel' \? activeProjectId : props\.anchorProjectId;/.test(ac));
  ok('K1 the dock\'s Recent list is vertical (no horizontal rail), at most PANEL_RECENT_MAX rows',
    /recentThreads\.slice\(0, PANEL_RECENT_MAX\)/.test(ac) && (ac.match(/showsHorizontalScrollIndicator=\{false\}/g) ?? []).length === 1);
  ok('K1 the composer: Enter sends on desktop web through a SPREAD onKeyPress; Shift+Enter keeps the newline',
    /\{\.\.\.\(isDesktopWeb \? \{ onKeyPress: onComposerKey \} : null\)\}/.test(ac)
    && /if \(ne\.key === 'Enter' && !ne\.shiftKey && !ne\.isComposing\) \{\s*e\.preventDefault\(\);\s*void ask\(draft\);/.test(ac));
  ok("K1 the panel's 'New chat' is the onNewChat prop (shown only when passed)", /\{!empty && props\.onNewChat && \(\s*<TouchableOpacity\s+onPress=\{props\.onNewChat\}/.test(panelBranch));
  ok('K1 AskConversation never imports useAskDock (no require cycle with the hook that docks it)', !/from '@\/hooks\/useAskDock'/.test(ac));
}

// ── 5. hooks/useAskDock ──────────────────────────────────────────────────────
{
  const hook = code(read('hooks/useAskDock.tsx'));
  ok('K1 useAskDock docks only where the host can show Ask; elsewhere the /ask page (typed, no cast)',
    /if \(!isDesktopWeb \|\| !dock\.canShow\(ASK_DOCK_ID\)\) \{/.test(hook) && /router\.push\(\{ pathname: '\/ask', params \}\);/.test(hook)
    && !/as never|as any/.test(hook));
  ok("K1 useAskDock does nothing on /ask itself (the page IS Ask)", /const onAskPage = \(segments\[0\] as string \| undefined\) === 'ask';/.test(hook)
    && /if \(onAskPage\) return;/.test(hook));
  ok('K1 useAskDock re-shows a docked Ask unless a seed or a fresh chat is asked for',
    /if \(dock\.id === ASK_DOCK_ID && !opts\?\.seed && !opts\?\.fresh\) \{\s*dock\.show\(\);/.test(hook));
  ok("K1 useAskDock docks <AskConversation variant=\"panel\"> under ASK_DOCK_ID, 'Ask MAGE', SIDE_PANEL_DEFAULT, keyed per chat",
    /<AskConversation\s+key=\{`ask-\$\{askSeq\}`\}\s+variant="panel"/.test(hook)
    && /onNewChat=\{\(\) => openAskRef\.current\(\{ fresh: true \}\)\}/.test(hook) && /openAskRef\.current = openAsk;/.test(hook)
    && /\{ id: ASK_DOCK_ID, title: 'Ask MAGE', width: SIDE_PANEL_DEFAULT \}/.test(hook));
  ok('K1 isAskOpen = the dock is SHOWING Ask', /const isAskOpen = dock\.showing && dock\.id === ASK_DOCK_ID;/.test(hook));
}

// ── 6. BrainFab ──────────────────────────────────────────────────────────────
{
  const fab = code(read('components/brain/BrainFab.tsx'));
  const press = /const handlePress = useCallback\(\(\) => \{([\s\S]*?)\n\s*\}, \[/.exec(fab)?.[1] ?? '';
  ok('K1 BrainFab: desktop web opens the Ask dock BEFORE the pinned phone push',
    press.indexOf('if (isDesktopWeb) { openAsk({ screen, projectId: projectId ?? undefined }); return; }') > 0
    && press.indexOf('if (isDesktopWeb) { openAsk(') < press.indexOf('router.push('));
  ok('K1 r3: BrainFab hides while a dock is SHOWING (not "while something is docked")',
    /if \(isDesktopWeb && dock\.showing\) return null;/.test(fab) && !/dock\.content != null && !dock\.hidden/.test(fab)
    && fab.indexOf('if (isDesktopWeb && dock.showing) return null;') > fab.indexOf("if (HIDDEN_ROOTS.has("));
  ok("K1 r2: BrainFab's print tag is gated on isDesktopWeb, never Platform.OS === 'web'",
    /\{\.\.\.\(isDesktopWeb \? \(\{ dataSet: \{ print: 'hide' \} \} as object\) : null\)\}/.test(fab)
    && !/Platform\.OS === 'web' \? \(\{ dataSet/.test(fab));
  const coach = fab.indexOf('const coachUp = useTutorialCoachVisible();');
  ok('K1 BrainFab: the new hooks sit above coachUp (the tutorial pin stays adjacent)',
    coach > 0 && fab.indexOf('const isDesktopWeb = useIsDesktopWeb();') < coach && fab.indexOf('const { openAsk } = useAskDock();') < coach
    && /const coachUp = useTutorialCoachVisible\(\);\s*const hidden = fabStateHidden \|\| coachUp;/.test(fab));
}

// ── 7. DesktopActionRail variant 'dock' ──────────────────────────────────────
{
  const rail = code(read('components/DesktopActionRail.tsx'));
  ok("K1 DesktopActionRail: variant?: 'rail' | 'dock' (default rail), RAIL_WIDTH stays 300",
    /variant\?: 'rail' \| 'dock';/.test(rail) && /variant = 'rail' \}: Props\)/.test(rail) && /export const RAIL_WIDTH = 300;/.test(rail));
  ok('K1 the dock variant fills the panel and leads with "Needs you now"; the rail keeps its width and title',
    /style=\{\[styles\.rail, variant === 'dock' \? styles\.railDock : \{ width \}\]\}/.test(rail)
    && /railDock: \{ flex: 1, borderLeftWidth: 0 \},/.test(rail)
    && /variant === 'dock'\s*\? <Text style=\{styles\.dockLead\}>Needs you now<\/Text>\s*: <Text style=\{styles\.headerTitle\}>Action Required<\/Text>/.test(rail));
  ok("K1 every 'See all' closes the dock in the dock variant (spread — the rail's RowLinks are unchanged)",
    /const seeAllPress = docked \? dock\.close : undefined;/.test(rail)
    && (rail.match(/onSeeAll=\{seeAllPress\}/g) ?? []).length === 3
    && /testID="rail-see-all"\s*\{\.\.\.\(seeAllPress \? \{ onPress: seeAllPress \} : null\)\}/.test(rail)
    && /\{\.\.\.\(onSeeAll \? \{ onPress: onSeeAll \} : null\)\}/.test(rail));
}

// ── 8. ShellHotkeys + ShortcutSheet ──────────────────────────────────────────
{
  const keys = code(read('components/desktop/ShellHotkeys.tsx'));
  ok('K1 ShellHotkeys renders null (and runs no hooks) off desktop web',
    /export function ShellHotkeys\(\) \{\s*const isDesktopWeb = useIsDesktopWeb\(\);\s*return isDesktopWeb \? <SignedInGate \/> : null;\s*\}/.test(keys));
  ok('K1 ShellHotkeys runs only once someone is signed in with a role (no chords or ? sheet on /login, /signup, onboarding)',
    /function SignedInGate\(\) \{\s*const \{ userRole \} = useCoreData\(\);\s*return userRole \? <DesktopShellHotkeys \/> : null;\s*\}/.test(keys));
  ok("K1 ShellHotkeys: Cmd+K is LISTED without a handler (the root listener owns it)", /\{ combo: 'mod\+k', label: 'Search', group: 'App' \},/.test(keys));
  ok('K1 r3: Cmd+J opens Ask only on an EMPTY dock the host can show Ask in',
    /when: \(\) => dock\.content == null && dock\.canShow\(ASK_DOCK_ID\),/.test(keys) && /combo: 'mod\+j', label: 'Ask MAGE', group: 'App',/.test(keys));
  ok("K1 ShellHotkeys: '?' opens the sheet; the chords go through chordTarget + routeHref at GLOBAL scope",
    /\{ combo: '\?', label: 'Keyboard shortcuts', group: 'App', handler: openShortcutSheet \}/.test(keys)
    && /router\.push\(routeHref\(t\.pathname, t\.params\)\)/.test(keys) && /useHotkeys\(bindings, \{ scope: 'global' \}\);/.test(keys)
    && /chordsFor\(userRole\)/.test(keys));
  const sheet = code(read('components/desktop/ShortcutSheet.tsx'));
  ok('K1 ShortcutSheet: a <Sheet size="form"> that snapshots hotkeys.list() on open (never a live store)',
    /<Sheet size="form" title="Keyboard shortcuts"/.test(sheet) && /if \(visible\) setRows\(hotkeys\.list\(\)\);/.test(sheet)
    && !/useSyncExternalStore\([^)]*hotkeys/.test(sheet));
  ok('K1 ShortcutSheet: dialog-scope and disabled rows are left out; App, Go to, Navigation lead',
    /if \(r\.scope === 'dialog' \|\| !r\.enabled\) continue;/.test(sheet) && /const GROUP_ORDER = \['App', 'Go to', 'Navigation'\];/.test(sheet));
  ok('K1 ShortcutSheet: the key cap is surfaceAlt (not a counted surface card)', /kbd: \{\s*backgroundColor: t\.surfaceAlt,/.test(sheet));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
