import { useBarLabel } from '../utils/useBarLabel';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else    { fail++; console.log('  ✗', name, '\n      got:', got, '\n      want:', want); }
}

console.log('\nuseBarLabel validation:');

const task = { id: 't-uuid', title: 'Foundation', progress: 80, displayId: 'T4' };

// Wide (≥110)
expect('Width 150 → full mode', useBarLabel(150, task).mode, 'full');
expect('Width 150 → showPercent true', useBarLabel(150, task).showPercent, true);
expect('Width 150 → insideText', useBarLabel(150, task).insideText, 'T4 Foundation');
expect('Width 150 → no outsideText', useBarLabel(150, task).outsideText, '');

// Medium (70-109)
expect('Width 90 → name mode', useBarLabel(90, task).mode, 'name');
expect('Width 90 → showPercent false', useBarLabel(90, task).showPercent, false);
expect('Width 90 → no outsideText', useBarLabel(90, task).outsideText, '');

// Narrow (40-69)
expect('Width 56 → id mode', useBarLabel(56, task).mode, 'id');
expect('Width 56 → insideText is just id', useBarLabel(56, task).insideText, 'T4');
expect('Width 56 → outsideText is name', useBarLabel(56, task).outsideText, 'Foundation');

// Tiny (<40)
expect('Width 30 → empty mode', useBarLabel(30, task).mode, 'empty');
expect('Width 30 → insideText empty', useBarLabel(30, task).insideText, '');
expect('Width 30 → outsideText empty', useBarLabel(30, task).outsideText, '');

// Boundaries (exact threshold values)
expect('Width 110 → full (boundary ≥110)', useBarLabel(110, task).mode, 'full');
expect('Width 109 → name (boundary)', useBarLabel(109, task).mode, 'name');
expect('Width 70 → name (boundary ≥70)', useBarLabel(70, task).mode, 'name');
expect('Width 69 → id (boundary)', useBarLabel(69, task).mode, 'id');
expect('Width 40 → id (boundary ≥40)', useBarLabel(40, task).mode, 'id');
expect('Width 39 → empty (boundary)', useBarLabel(39, task).mode, 'empty');

// Edge cases
expect('Width 0 → empty', useBarLabel(0, task).mode, 'empty');
expect('Width -5 → empty (defensive)', useBarLabel(-5, task).mode, 'empty');

// No displayId — falls back to formatted UUID
const taskNoDisplayId = { id: 'abc123def', title: 'X', progress: 0 };
expect('No displayId → formatted from UUID', useBarLabel(150, taskNoDisplayId).insideText, 'Tabc1 X');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
