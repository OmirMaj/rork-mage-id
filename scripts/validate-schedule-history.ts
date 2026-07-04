import { emptyHistory, pushHistory, undo, redo, type HistoryState } from '../utils/scheduleHistory';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else    { fail++; console.log('  ✗', name, '\n      got:', got, '\n      want:', want); }
}

console.log('\nschedule history reducer validation:');

let s: HistoryState<string> = emptyHistory('A');
s = pushHistory(s, 'B');
s = pushHistory(s, 'C');
expect('present after two pushes', s.present, 'C');
expect('past holds prior states', s.past, ['A', 'B']);
expect('push clears future', s.future.length, 0);

s = undo(s);
expect('undo restores previous present', s.present, 'B');
expect('undo moves present to future', s.future, ['C']);

s = redo(s);
expect('redo re-applies', s.present, 'C');

s = undo(s);              // present B, future [C]
s = pushHistory(s, 'D');  // new edit
expect('new edit clears future', s.future.length, 0);
expect('present is the new edit', s.present, 'D');

let b: HistoryState<number> = emptyHistory(0);
for (let i = 1; i <= 25; i++) b = pushHistory(b, i, 20);
expect('past bounded to 20', b.past.length, 20);
expect('oldest states dropped', b.past[0], 5);

// redo walks back up through multiple undos
let m: HistoryState<string> = emptyHistory('A');
m = pushHistory(m, 'B');
m = pushHistory(m, 'C');
m = undo(m); m = undo(m);            // two undos → present A, future [B, C]
expect('two undos reach the oldest present', m.present, 'A');
m = redo(m);
expect('redo #1 climbs back to B', m.present, 'B');
m = redo(m);
expect('redo #2 climbs back to C', m.present, 'C');

let e: HistoryState<string> = emptyHistory('only');
const e2 = undo(e);
expect('undo at start is no-op (identity)', e2 === e, true);
const e3 = redo(e);
expect('redo with empty future is no-op (identity)', e3 === e, true);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
