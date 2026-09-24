// scripts/validate-schedule-desktop-width.ts — Schedule Pro's card views stay
// a readable column on a desktop browser (founder, 2026-09-23: "when doing the
// schedules or picking a subtab the boxes are so stretched out and it looks
// terrible").
//
// MEASURED ON app.mageid.app: Schedule Pro is full-bleed, so its Overview's
// four flex:1 stat tiles and its Board's four columns stretched across the
// whole monitor (~500 px tiles, a single card lost in the middle of a column).
//
// THE RULE (wave 6c: the page widths live in constants/designTokens Layout.page):
// the Overview's scroll content and the Board's row of columns are centred at
// Layout.page.dashboard (1280), `width: 100%` under the cap, so phones, tablets
// and narrow windows are unchanged. Timelines and grids (Gantt, List,
// Workload) keep the full width — their content really is that wide.
//
// Wave 6c dropped two sections this file used to carry: the classic Schedule
// tab (lane DC pins it in its own validator now) and the ContentWidth token
// (the orchestrator removes it and adds the "no ContentWidth anywhere" check
// here at integration).
//
// This is a SOURCE guard: styles are not observable from bun without a
// renderer (the w6c-schedule-canvas smoke test renders them).
//
// Run via: bun run scripts/validate-schedule-desktop-width.ts

import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra: unknown = '') {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra !== '' ? `\n      ${JSON.stringify(extra)}` : ''); }
}
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
/** Comments stripped, so a cap described in a comment never satisfies a check. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');

// designTokens imports react-native (Platform), which bun cannot load — read
// the literal instead.
const tokens = code('constants/designTokens.ts');
const page = /page:\s*\{([^}]*)\}/.exec(tokens)?.[1] ?? '';
const dashboard = Number(/\bdashboard:\s*(\d+)/.exec(page)?.[1] ?? NaN);

console.log('\nthe width:');
ok('Layout.page.dashboard is declared', Number.isFinite(dashboard), page);
ok('the dashboard page is wide enough for four 220 px KPI tiles and inside the 1400 routed content',
  dashboard >= 4 * 220 + 3 * 12 && dashboard <= 1400, dashboard);

console.log('\nSchedule Pro sub-tabs (components/schedule/tabs/*):');
{
  const dash = code('components/schedule/tabs/DashboardTab.tsx');
  ok('Overview: its scroll content (stat tiles, charts, critical list) is centred at Layout.page.dashboard',
    /content:\s*\{[^}]*width:\s*'100%'[^}]*maxWidth:\s*Layout\.page\.dashboard[^}]*alignSelf:\s*'center'/.test(dash)
    && /<ScrollView style=\{styles\.root\} contentContainerStyle=\{styles\.content\}>/.test(dash));
  ok('Overview: no ContentWidth reference', !/ContentWidth/.test(dash));
  ok('Overview: the KPI tiles size from TileGrid (220 px minimum), not flex:1 across the page',
    /<TileGrid preset="kpi" phoneStyle=\{\[styles\.statRow, isPhone && styles\.statRowPhone\]\}>/.test(dash));
  ok('Overview: the critical-path list is a form-width column on desktop only',
    /style=\{\[styles\.cpList, isDesktop && styles\.cpListDesktop\]\}/.test(dash)
    && /cpListDesktop:\s*\{[^}]*maxWidth:\s*Layout\.page\.form/.test(dash));
  ok('Overview: the earned-value placeholder hides only on desktop with no budget',
    /const hideEvPlaceholder = isDesktop && hasBudget === false;/.test(dash));

  const boardTab = code('components/schedule/tabs/BoardTab.tsx');
  ok('Board: the four status columns sit in a centred Layout.page.dashboard row',
    /\broot:\s*\{[^}]*flexDirection:\s*'row'[^}]*width:\s*'100%'[^}]*maxWidth:\s*Layout\.page\.dashboard[^}]*alignSelf:\s*'center'/.test(boardTab));
  ok('Board: no ContentWidth reference', !/ContentWidth/.test(boardTab));

  for (const f of ['GanttTab', 'ListTab', 'WorkloadTab']) {
    const src = code(`components/schedule/tabs/${f}.tsx`);
    ok(`${f} keeps the full width (a timeline / grid, not cards): no page cap`,
      !/ContentWidth/.test(src) && !/Layout\.page\./.test(src));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
