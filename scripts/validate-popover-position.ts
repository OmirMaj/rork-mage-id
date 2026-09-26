// validate-popover-position.ts — where a pointer-anchored popover menu goes
// (utils/popoverPosition; wave 6d, lane B1: the Home ⋯ / row-action popover in
// components/EntityActionSheet).
//
// The menu opens at the pointer, is pulled back inside the window at the right
// edge, FLIPS above the pointer near the bottom edge instead of being pushed up
// over it, never leaves an 8 px margin, and a missing pointer (NaN — a
// keyboard-opened menu with no coordinates) lands at the top-left margin
// rather than at NaN, which would drop the menu off the page.
//
// Run via: bun run test:popover-position

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MENU_MAX_WIDTH, MENU_OFFSET, POPOVER_EDGE, popoverPosition } from '../utils/popoverPosition';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (same) { pass++; console.log('  PASS ', name); }
  else { fail++; console.log('  FAIL ', name, `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
}
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  PASS ', name); }
  else { fail++; console.log('  FAIL ', name, detail ? `\n        ${detail}` : ''); }
}

const VP = { width: 1512, height: 945 };
const MENU = { height: 200 };

console.log('popoverPosition:');
eq('the constants: 8 px edge, 280 max width, 4 px offset', [POPOVER_EDGE, MENU_MAX_WIDTH, MENU_OFFSET], [8, 280, 4]);
eq('an interior point opens just below the pointer',
  popoverPosition({ x: 600, y: 300 }, MENU, VP), { left: 600, top: 304, flippedUp: false });
eq('the right edge: left clamps to viewport − 280 − 8',
  popoverPosition({ x: 1500, y: 300 }, MENU, VP), { left: 1512 - 280 - 8, top: 304, flippedUp: false });
eq('a measured narrower menu clamps to its own width',
  popoverPosition({ x: 1500, y: 300 }, { width: 220, height: 200 }, VP), { left: 1512 - 220 - 8, top: 304, flippedUp: false });
eq('the bottom edge: the menu flips ABOVE the pointer',
  popoverPosition({ x: 600, y: 900 }, MENU, VP), { left: 600, top: 900 - 4 - 200, flippedUp: true });
eq('exactly fitting below does not flip (304 + 200 + 8 = 512)',
  popoverPosition({ x: 600, y: 300 }, MENU, { width: 1512, height: 512 }), { left: 600, top: 304, flippedUp: false });
eq('one pixel short flips',
  popoverPosition({ x: 600, y: 300 }, MENU, { width: 1512, height: 511 }), { left: 600, top: 96, flippedUp: true });
eq('a tiny viewport clamps both axes to the 8 px margin',
  popoverPosition({ x: 100, y: 50 }, MENU, { width: 200, height: 120 }), { left: 8, top: 8, flippedUp: true });
eq('the left edge never goes under 8',
  popoverPosition({ x: -40, y: 300 }, MENU, VP), { left: 8, top: 304, flippedUp: false });
eq('a NaN anchor lands at the margin, not at NaN',
  popoverPosition({ x: NaN, y: 300 }, MENU, VP), { left: 8, top: 8, flippedUp: false });
eq('an Infinity anchor lands at the margin',
  popoverPosition({ x: 300, y: Infinity }, MENU, VP), { left: 8, top: 8, flippedUp: false });

console.log('components/EntityActionSheet.tsx wiring (source-level):');
{
  const src = readFileSync(join(ROOT, 'components/EntityActionSheet.tsx'), 'utf8');
  ok('declares the optional anchor prop', /anchor\?:\s*\{\s*x:\s*number;\s*y:\s*number\s*\}\s*\|\s*null/.test(src));
  ok('places the popover through popoverPosition(anchor, …, windowViewport())',
    /popoverPosition\(anchor,[\s\S]{0,120}windowViewport\(\)\)/.test(src));
  ok('the popover is desktop-web only (isDesktopWeb && anchor)', /isDesktopWeb && anchor\s*\?\s*popoverPosition/.test(src));
  ok("the popover carries testID 'entity-action-popover' and role menu, spread only when placed",
    /\.\.\.\(pop \? \{[^}]*accessibilityRole: 'menu'[^}]*testID: 'entity-action-popover'/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('✗ validate-popover-position'); process.exit(1); }
console.log('✓ validate-popover-position: at the pointer, clamped at the right, flipped at the bottom, 8 px clear, NaN-safe');
