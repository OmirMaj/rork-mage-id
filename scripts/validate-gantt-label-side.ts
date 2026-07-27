// scripts/validate-gantt-label-side.ts — pure-fn validator for
// outsideLabelSide (utils/ganttLabelSide.ts). PINS the right-edge flip: a
// narrow bar's outside label renders to the RIGHT when there's room, and
// flips to the LEFT when the right-side label would overflow the chart content
// and get clipped by the horizontal ScrollView. Regression guard for tribunal
// finding #7 (unlabeled right-edge 1d square).
import { outsideLabelSide, OUTSIDE_LABEL_MAX_W } from '../utils/ganttLabelSide';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

console.log('\noutsideLabelSide validation:');

const CHART_W = 1000;

// Bar far from the right edge → label sits to the RIGHT.
ok('mid-chart bar → right', outsideLabelSide(100, 26, CHART_W) === 'right');

// Bar whose right side has EXACTLY the label width of room → still right (>=).
ok('exactly labelMaxW of room → right', outsideLabelSide(CHART_W - OUTSIDE_LABEL_MAX_W - 26, 26, CHART_W) === 'right');

// Short bar near the right edge → not enough room → FLIP to left.
ok('right-edge short bar → left (flip)', outsideLabelSide(CHART_W - 30, 26, CHART_W) === 'left');

// Bar ending exactly at the chart edge → no right room at all → left.
ok('bar at chart edge → left', outsideLabelSide(CHART_W - 26, 26, CHART_W) === 'left');

// One px short of enough room → flip.
ok('one px short of room → left', outsideLabelSide(CHART_W - OUTSIDE_LABEL_MAX_W - 26 + 1, 26, CHART_W) === 'left');

// Custom label width is honored.
ok('custom labelMaxW respected (fits)', outsideLabelSide(800, 20, CHART_W, 150) === 'right');
ok('custom labelMaxW respected (overflow)', outsideLabelSide(900, 20, CHART_W, 150) === 'left');

// Defensive: zero-width bar at origin has full room → right.
ok('zero bar at origin → right', outsideLabelSide(0, 0, CHART_W) === 'right');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
