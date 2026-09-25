// validate-ui-desktop-primitives.ts — the maths behind the wave-6b desktop
// primitives (components/ui/{TileGrid,SegmentedControl,Sheet,ActionBar,
// ChipRail}.tsx + components/ui/desktop.ts), and the source facts the phone
// guarantee rests on.
//
// WHY. The founder, on a 1512x945 MacBook: "the website app… really isn't
// utilizing the space a computer screen gives you" and "the boxes are so
// stretched out and it looks terrible". The fix is a handful of numbers —
// how many tiles fit, how wide a segment may get, how wide a sheet card is —
// and a number that is wrong by one column is exactly the Forecast-orphan bug
// all over again. So the numbers are pure functions, and this pins them.
//
// It also pins the three source facts the "phone identical" promise leans on,
// which a render test at one width cannot see drifting:
//   - Button's phone wrapper is still the bare `{ transform: [{ scale }] }` and
//     SIZE_MAP still says 36 / touchTarget.comfortable / 56;
//   - FilterChipRow still renders the horizontal ScrollView off desktop;
//   - DesktopSidebar still carries the aria-label the sheets measure, so a
//     rename cannot quietly put every scrim back over the navigation.
//
// bun cannot parse react-native, so it is stubbed (Platform = web, the only
// thing desktop.ts and designTokens.ts read from it at import time).
//
// Run via: bun run test:ui-desktop-primitives

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// bun's types are not installed in this repo (same note as validate-oac-actions.ts);
// only the sliver used below is declared.
type VirtualModule = { exports: Record<string, unknown>; loader: 'object' };
type BunPluginBuilder = { module: (specifier: string, cb: () => VirtualModule) => void };
declare const Bun: {
  plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void;
};

if (typeof Bun === 'undefined') {
  console.error('\nvalidate-ui-desktop-primitives must run under bun (needs Bun.plugin to stub react-native)\n');
  process.exit(1);
}

Bun.plugin({
  name: 'ui-desktop-primitives-stubs',
  setup(build) {
    build.module('react-native', () => ({
      exports: {
        Platform: { OS: 'web', select: (o: Record<string, unknown>) => ('web' in o ? o.web : o.default) },
        Dimensions: { get: () => ({ width: 1512, height: 945 }), addEventListener: () => ({ remove() {} }) },
        StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
      },
      loader: 'object',
    }));
  },
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const React = await import('react');
const D = await import('../components/ui/desktop');
const H = await import('../hooks/useHotkeys');
const { Layout } = await import('../constants/designTokens');

let failures = 0;
let passes = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passes += 1; return; }
  failures += 1;
  console.error('  FAIL  ' + name + (detail ? `\n        ${detail}` : ''));
}
function eq<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

console.log('\nui desktop primitives:');

// ── 1. TileGrid column maths ────────────────────────────────────────────────

// The two numbers the Layout tokens promise in prose: at a 1280 dashboard
// (1232 content after 24 px gutters) a 4-up KPI row is ~300 px a tile and a
// 3-up content row ~400.
eq('kpi @1232 → 4 × 299', D.tileGridForPreset(1232, 'kpi'), { cols: 4, width: 299 });
eq('content @1232 → 3 × 400', D.tileGridForPreset(1232, 'content'), { cols: 3, width: 400 });
eq('action @1232 → 5 × 238', D.tileGridForPreset(1232, 'action'), { cols: 5, width: 238 });
eq('nav @1232 → 3 × 402', D.tileGridForPreset(1232, 'nav'), { cols: 3, width: 402 });
// A 440 side panel gets one nav column, as wide as the panel — the window is
// 1512 but the grid is not.
eq('nav @440 → 1 × 440 (container, not window)', D.tileGridForPreset(440, 'nav'), { cols: 1, width: 440 });
// Narrower than one minimum tile: still one column, never zero, never min.
eq('kpi @150 → 1 × 150', D.tileGridForPreset(150, 'kpi'), { cols: 1, width: 150 });
// Before onLayout the first paint uses the preset minimum, not the column.
eq('unmeasured → 1 × min', D.tileGridForPreset(0, 'action'), { cols: 1, width: Layout.tile.action.min });
eq('NaN → 1 × min', D.tileGridForPreset(Number.NaN, 'kpi'), { cols: 1, width: Layout.tile.kpi.min });
// The clamp: a 2560 monitor must not grow a 7th action column.
eq('action @2560 capped at maxCols 6', D.tileGridForPreset(2560, 'action').cols, 6);

// Invariants over every width 1..3000 for every preset.
{
  const bad: string[] = [];
  for (const preset of Object.keys(Layout.tile) as (keyof typeof Layout.tile)[]) {
    const spec = Layout.tile[preset];
    for (let W = 1; W <= 3000; W++) {
      const { cols, width } = D.tileGridForPreset(W, preset);
      const used = cols * width + (cols - 1) * spec.gap;
      if (cols < 1 || cols > spec.maxCols) bad.push(`${preset}@${W}: cols ${cols}`);
      else if (used > W) bad.push(`${preset}@${W}: ${cols}×${width} overflows (${used})`);
      else if (W >= spec.min && width < spec.min) bad.push(`${preset}@${W}: width ${width} < min ${spec.min}`);
      // Maximal: one more column at the minimum would not have fitted.
      else if (cols < spec.maxCols && (cols + 1) * spec.min + cols * spec.gap <= W) bad.push(`${preset}@${W}: ${cols} cols but ${cols + 1} fit`);
      // Floor, not round: the slack left is less than one px per column.
      else if (W - used >= cols) bad.push(`${preset}@${W}: ${W - used}px unused`);
      if (bad.length > 5) break;
    }
  }
  ok('tile maths: in range, never overflows, maximal, tight — every preset, 1..3000', bad.length === 0, bad.slice(0, 5).join('; '));
}

// ── 2. Segment sizing ───────────────────────────────────────────────────────

eq('6 options stay pills', D.resolveSegmentedVariant(6), 'pill');
eq('7 options become underline tabs', D.resolveSegmentedVariant(7), 'underline');
eq('explicit variant wins over count', D.resolveSegmentedVariant(9, 'pill'), 'pill');
eq('numeric stays numeric', D.resolveSegmentedVariant(5, 'numeric'), 'numeric');
eq('text segment box 88..200', D.segmentBox('text'), { minWidth: 88, maxWidth: 200 });
eq('numeric segment is a fixed 56', D.segmentBox('numeric'), { width: 56 });
// Punch | Crew list: measured 881 px PER SEGMENT live. Now ≤ 408 for the pair.
eq('2-segment switch ≤ 408', D.segmentedMaxWidth(2), 2 * 200 + 2 + 6);
eq('4+ segments hit the 640 cap', D.segmentedMaxWidth(4), 640);
eq('5 numeric quick-picks = 294', D.segmentedMaxWidth(5, 'numeric'), 5 * 56 + 4 * 2 + 6);
eq('0 segments = 0', D.segmentedMaxWidth(0), 0);
for (let n = 1; n <= 12; n++) {
  ok(`segmented control of ${n} never exceeds controlMax`, D.segmentedMaxWidth(n) <= Layout.segment.controlMax);
}

// ── 3. Sheet size → width ───────────────────────────────────────────────────

// The web-PM audit's widths, as content columns (window − the 240 sidebar).
// 390 and 899 are below the desktop gate, where useSheetFrame returns null and
// the phone sheet renders unchanged — that half is proved by the jest smoke
// (__tests__/smoke/ui-desktop-primitives.test.tsx), not here.
const columnAt = (win: number) => (win >= 900 ? win - 240 : win);
eq('form @1512 → 560', D.sheetCardWidth('form', columnAt(1512)), 560);
eq('form @2560 → 560', D.sheetCardWidth('form', columnAt(2560)), 560);
eq('wide @900 → 596 (column 660 − 64)', D.sheetCardWidth('wide', columnAt(900)), 596);
eq('dialog @900 → 440', D.sheetCardWidth('dialog', columnAt(900)), 440);
eq('panel @1512 → 880', D.sheetCardWidth('panel', columnAt(1512)), 880);
eq('panel @900 → flush 660 (no gutter)', D.sheetCardWidth('panel', columnAt(900)), 660);
eq('tiny column → 0, never negative', D.sheetCardWidth('form', 20), 0);
for (const size of Object.keys(Layout.sheet) as (keyof typeof Layout.sheet)[]) {
  ok(`sheet ${size} never wider than Layout.sheet.${size}`, D.sheetCardWidth(size, 5000) === Layout.sheet[size]);
}

{
  const f = D.desktopSheetFrame('form', 'LINE', 240);
  eq('form card maxWidth = Layout.sheet.form', f.card?.maxWidth, Layout.sheet.form);
  eq('form card maxHeight 85%', f.card?.maxHeight, '85%');
  ok('form card rounds ALL FOUR corners (callers set top-only radii)',
    [f.card?.borderTopLeftRadius, f.card?.borderTopRightRadius, f.card?.borderBottomLeftRadius, f.card?.borderBottomRightRadius].every((r) => r === 18));
  eq('form overlay centres', [f.overlay?.justifyContent, f.overlay?.alignItems], ['center', 'center']);
  // Wave 6c (X0.1, the dead zone): the scrim covers the FULL window — the
  // sidebar too, so a click there dismisses instead of navigating under the
  // portaled Modal — and only the CARD is pushed into the content column:
  // paddingLeft = 32 gutter + the 240 sidebar, and no marginLeft.
  eq('form overlay pads the card into the column (paddingLeft 32 + 240)', f.overlay?.paddingLeft, 272);
  eq('form overlay has NO marginLeft (the scrim covers the sidebar)', f.overlay?.marginLeft, undefined);
  eq('form scrollContent carries the same inset (a scroll-wrapped sheet centres in the column)',
    [f.scrollContent?.paddingLeft, f.scrollContent?.marginLeft], [272, undefined]);
  eq('form backdrop is absoluteFill (a flex:1 filler becomes the full-window scrim)',
    f.backdrop, { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 });
  // Appended AFTER a phone sheet: every padding longhand must be set, or the
  // phone's paddingHorizontal/paddingBottom wins over a bare `padding`.
  ok('card pads 24 on every longhand (beats the phone sheet it is appended to)',
    ['padding', 'paddingHorizontal', 'paddingVertical', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight']
      .every((k) => (f.card as Record<string, unknown>)?.[k] === 24));
  ok('card un-pins an absolute / marginTop:auto phone sheet so it centres',
    f.card?.position === 'relative' && f.card?.marginTop === 0 && f.card?.marginBottom === 0);
  eq('footer right-aligned', f.footer?.justifyContent, 'flex-end');
  eq('footer button min 104 × 40', [f.footerButton?.minWidth, f.footerButton?.height], [104, 40]);
  const p = D.desktopSheetFrame('panel', 'LINE', 0);
  eq('panel docks right', p.overlay?.alignItems, 'flex-end');
  // The panel is the project-detail sections' frame: its scrim, too, must
  // start at the sidebar's right edge, not grey the navigation (mutant B1).
  {
    const p240 = D.desktopSheetFrame('panel', 'LINE', 240);
    eq('panel overlay pads to the sidebar edge (paddingLeft 240, no marginLeft)',
      [p240.overlay?.paddingLeft, p240.overlay?.marginLeft], [240, undefined]);
    eq('panel scrollContent pads to the sidebar edge', p240.scrollContent?.paddingLeft, 240);
    eq('panel backdrop is absoluteFill', p240.backdrop, { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 });
  }
  eq('panel full height, 880 max', [p.card?.height, p.card?.maxWidth], ['100%', 880]);
  eq('panel square corners + left hairline in the theme line colour', [p.card?.borderTopLeftRadius, p.card?.borderLeftWidth, p.card?.borderLeftColor], [0, 1, 'LINE']);
}

// ── 4. Cmd/Ctrl+Enter ───────────────────────────────────────────────────────
// Wave 6c: desktop.ts's isPrimaryHotkey is gone — the sheet's primary key is
// the registry binding 'mod+enter' (components/ui/Sheet useSheetPrimaryHotkey),
// so the same five cases now read hooks/useHotkeys, the one definition.

{
  const primary = H.parseCombo('mod+enter')[0];
  const fires = (ev: Parameters<typeof H.stepMatches>[1]) => H.stepMatches(primary, ev);
  ok('Cmd+Enter fires', fires({ key: 'Enter', metaKey: true }));
  ok('Ctrl+Enter fires', fires({ key: 'Enter', ctrlKey: true }));
  ok('plain Enter does NOT (it belongs to the field)', !fires({ key: 'Enter' }));
  ok('Cmd+Shift+Enter does not', !fires({ key: 'Enter', metaKey: true, shiftKey: true }));
  ok('Cmd+S does not', !fires({ key: 's', metaKey: true }));
  ok('desktop.ts no longer exports isPrimaryHotkey (one definition, in the registry)', !('isPrimaryHotkey' in D));
}

// ── 5. Sidebar inset ────────────────────────────────────────────────────────

eq('no sidebar → 0', D.shellInsetFromRect(null), 0);
eq('display:none sidebar (width 0) → 0', D.shellInsetFromRect({ right: 0, width: 0 }), 0);
eq('240 sidebar → 240', D.shellInsetFromRect({ right: 240, width: 240 }), 240);
eq('fractional edge rounds', D.shellInsetFromRect({ right: 239.6, width: 239.6 }), 240);
{
  const sidebar = read('components/DesktopSidebar.tsx');
  ok('DesktopSidebar still carries accessibilityLabel="Primary navigation" (what the sheets measure)',
    /accessibilityLabel="Primary navigation"/.test(sidebar) && D.SIDEBAR_DOM_SELECTOR.includes('Primary navigation'),
    'If the sidebar label changes, change SIDEBAR_DOM_SELECTOR in components/ui/desktop.ts with it.');
}

// ── 6. Field helpers ────────────────────────────────────────────────────────

eq('number-pad → xs', D.fieldSizeForKeyboard('number-pad'), 'xs');
eq('numeric → xs', D.fieldSizeForKeyboard('numeric'), 'xs');
eq('decimal-pad → sm', D.fieldSizeForKeyboard('decimal-pad'), 'sm');
eq('default → no implied size', D.fieldSizeForKeyboard('default'), null);
eq('desktopField(md) = 360, left-aligned', D.desktopField('md'), { maxWidth: 360, alignSelf: 'flex-start' });
eq('desktopField(search) = 480', D.desktopField('search').maxWidth, 480);
eq('desktopCta height = Layout.control.md', D.desktopCta.height, Layout.control.md);
eq('desktopProse = Layout.prose', D.desktopProse.maxWidth, Layout.prose);

// ── 7. Layout-only: no colour in the helper objects ─────────────────────────

{
  const objs = { desktopCta: D.desktopCta, desktopAddRow: D.desktopAddRow, desktopToggle: D.desktopToggle, desktopInlineEmpty: D.desktopInlineEmpty, desktopLauncher: D.desktopLauncher };
  const coloured = Object.entries(objs).flatMap(([k, o]) =>
    Object.entries(o).filter(([p, v]) => /color/i.test(p) && v !== 'transparent').map(([p]) => `${k}.${p}`));
  ok('desktop helper objects carry no colour (they must survive the rebrand)', coloured.length === 0, coloured.join(', '));
}

// ── 8. flattenElements (ActionBar / TileGrid clone every real child) ───────

{
  const h = React.createElement;
  const kids = D.flattenElements([
    h('a', { key: 'x' }),
    null,
    false,
    h(React.Fragment, { key: 'f1' }, h('b'), h('c')),
    h(React.Fragment, { key: 'f2' }, h('d')),
  ]);
  eq('fragments unwrapped, holes dropped', kids.length, 4);
  const keys = kids.map((k) => (React.isValidElement(k) ? String(k.key) : '?'));
  ok('every flattened child has a unique key', new Set(keys).size === keys.length, keys.join(','));
}

// ── 9. Phone-identical source facts ─────────────────────────────────────────

{
  const btn = read('components/ui/Button.tsx');
  ok('Button SIZE_MAP unchanged (sm 36 / md touchTarget.comfortable / lg 56)',
    /sm:\s*\{\s*height:\s*36,\s*px:\s*16,\s*fontSize:\s*13\s*\}/.test(btn)
    && /md:\s*\{\s*height:\s*Tokens\.touchTarget\.comfortable,\s*px:\s*24,\s*fontSize:\s*14\s*\}/.test(btn)
    && /lg:\s*\{\s*height:\s*56,\s*px:\s*28,\s*fontSize:\s*15\s*\}/.test(btn));
  ok("Button's phone wrapper is still the bare transform object",
    /const scaleStyle = \{ transform: \[\{ scale \}\] \};/.test(btn) && /:\s*scaleStyle;/.test(btn));
  ok('Button desktop rules sit behind useIsDesktopWeb()', /const desktop = useIsDesktopWeb\(\);/.test(btn));
  ok('fullWidth on desktop caps at Layout.button.fullWidthMax', /maxWidth:\s*Layout\.button\.fullWidthMax/.test(btn));

  const chips = read('components/FilterChipRow.tsx');
  ok('FilterChipRow keeps the horizontal ScrollView for the phone', /<ScrollView\s+horizontal/.test(chips));
  ok('FilterChipRow desktop branch is gated on useIsDesktop()', /if \(isDesktop\) \{/.test(chips) && /useIsDesktop\(\)/.test(chips));

  const actionBar = read('components/ui/ActionBar.tsx');
  ok('ActionBar phone path is <View style={style}> with the children untouched',
    /if \(!isDesktop\) \{\s*return \(\s*<View style=\{style\} testID=\{testID\} onLayout=\{onLayout\}>\s*\{children\}/.test(actionBar));

  const tile = read('components/ui/TileGrid.tsx');
  ok('TileGrid phone path is <View style={phoneStyle}> with the children untouched',
    /if \(!isDesktop\) \{\s*return \(\s*<View style=\{phoneStyle\} testID=\{testID\}>\s*\{children\}/.test(tile));
}

// ── 10. every new primitive is reachable from the barrel ────────────────────

{
  const barrel = read('components/ui/index.ts');
  for (const m of ['SegmentedControl', 'Sheet', 'ActionBar', 'TileGrid', 'ChipRail', 'desktop']) {
    ok(`components/ui/index.ts re-exports ./${m}`, new RegExp(`from '\\./${m}'`).test(barrel));
  }
}

console.log(`  ${passes} passed, ${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
