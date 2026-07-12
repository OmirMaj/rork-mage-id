// scripts/validate-gantt-arrow.ts — pure-fn validator for utils/ganttArrowPath.ts.
// Run via `bun run scripts/validate-gantt-arrow.ts`. No jest in this repo.
import { orthogonalArrowPath, CLEARANCE, ARROW_LANDING_GAP } from '../utils/ganttArrowPath';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); }
}

// Clearance stepped up for a crisper, MS-Project-like routing.
ok('CLEARANCE widened to >= 10', CLEARANCE >= 10);
ok('landing gap exposed and > 0', ARROW_LANDING_GAP > 0);

// Standard case (successor to the right): path starts at pred, steps out by
// CLEARANCE, and lands a landing-gap short of the successor's left edge.
const std = orthogonalArrowPath({ x: 100, y: 10 }, { x: 400, y: 40 });
ok('standard path starts at pred', std.startsWith('M 100 10'));
ok('standard path steps out by CLEARANCE', std.includes(`L ${100 + CLEARANCE} 10`));
ok('standard path lands short of succ edge', std.trim().endsWith(`${400 - ARROW_LANDING_GAP} 40`));

// Overlap case (successor at/left of predecessor) still routes around via a mid gutter.
const ov = orthogonalArrowPath({ x: 400, y: 10 }, { x: 120, y: 40 });
ok('overlap path starts at pred', ov.startsWith('M 400 10'));
ok('overlap path lands short of succ edge', ov.trim().endsWith(`${120 - ARROW_LANDING_GAP} 40`));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
