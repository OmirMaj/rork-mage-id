// scripts/validate-paste-rows.ts — pure-fn validator for utils/pasteRows.ts.
import { parsePastedRows, MAX_PASTE_ROWS } from '../utils/pasteRows';

let pass = 0, fail = 0;
function eq<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(want)); }
}

// Plain lines → title-only, one row per non-empty line.
eq('two plain lines', parsePastedRows('Excavation\nFootings'), [{ title: 'Excavation' }, { title: 'Footings' }]);
// CRLF (Windows / Excel) splits the same as LF.
eq('CRLF split', parsePastedRows('A\r\nB'), [{ title: 'A' }, { title: 'B' }]);
// Blank / whitespace-only lines are dropped.
eq('blank lines skipped', parsePastedRows('A\n\n   \nB'), [{ title: 'A' }, { title: 'B' }]);
eq('all blank → empty', parsePastedRows('\n  \n\t\n'), []);
eq('empty string → empty', parsePastedRows(''), []);
// Tab columns → Title · Duration · Phase.
eq('tab columns map dur+phase', parsePastedRows('Framing\t5\tRough-in'), [{ title: 'Framing', durationDays: 5, phase: 'Rough-in' }]);
// Duration accepts a trailing unit and decimals; must be > 0.
eq('duration "5d" strips unit', parsePastedRows('X\t5d'), [{ title: 'X', durationDays: 5 }]);
eq('duration "2.5 days"', parsePastedRows('X\t2.5 days'), [{ title: 'X', durationDays: 2.5 }]);
eq('non-numeric duration omitted', parsePastedRows('X\tsoon'), [{ title: 'X' }]);
eq('zero duration omitted', parsePastedRows('X\t0'), [{ title: 'X' }]);
// A tab line whose title col is empty is skipped entirely.
eq('empty title col skipped', parsePastedRows('\t5\tPhase'), []);
// Phase only present when non-empty.
eq('empty phase col omitted', parsePastedRows('X\t3\t'), [{ title: 'X', durationDays: 3 }]);
// Truncates to MAX_PASTE_ROWS.
eq('caps at MAX_PASTE_ROWS', parsePastedRows(Array.from({ length: MAX_PASTE_ROWS + 50 }, (_, i) => `T${i}`).join('\n')).length, MAX_PASTE_ROWS);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
