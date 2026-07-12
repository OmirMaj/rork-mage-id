// scripts/validate-outline-ops.ts — pure-fn validator for utils/outlineOps.ts.
import { indentTask, outdentTask, moveTask } from '../utils/outlineOps';
import type { ScheduleTask } from '../types';

let pass = 0, fail = 0;
function eq<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, '\n   got ', got, '\n   want', want); }
}
const T = (id: string, over: Partial<ScheduleTask> = {}): ScheduleTask => ({ id, title: id, startDay: 1, durationDays: 1, dependencies: [], ...over } as ScheduleTask);

// indent: task adopts the previous sibling as parent, outlineLevel +1.
const list = [T('a'), T('b'), T('c')];
const indented = indentTask(list, 'b');
eq('indent sets parentId to previous row', indented.find(t => t.id === 'b')?.parentId, 'a');
eq('indent sets outlineLevel 1', indented.find(t => t.id === 'b')?.outlineLevel, 1);
eq('indent first row is a no-op (no prior sibling)', indentTask(list, 'a'), list);

// outdent: clears one level of parent.
const out = outdentTask(indented, 'b');
eq('outdent clears parentId', out.find(t => t.id === 'b')?.parentId, undefined);
eq('outdent sets outlineLevel 0', out.find(t => t.id === 'b')?.outlineLevel, 0);
// outdent at level 0 is a no-op (same reference so the undo guard skips it).
eq('outdent top-level is a same-ref no-op', outdentTask(list, 'a') === list, true);
// outdent level 2 → level 1 reparents to the grandparent, not the old parent.
const deep = [T('a'), T('b', { parentId: 'a', outlineLevel: 1 }), T('c', { parentId: 'b', outlineLevel: 2 })];
const shallower = outdentTask(deep, 'c');
eq('outdent level 2 sets outlineLevel 1', shallower.find(t => t.id === 'c')?.outlineLevel, 1);
eq('outdent level 2 reparents to grandparent', shallower.find(t => t.id === 'c')?.parentId, 'a');

// move: swaps array position by delta, clamped.
const moved = moveTask(list, 'c', -1);
eq('move up swaps positions', moved.map(t => t.id), ['a', 'c', 'b']);
eq('move down at end is a no-op', moveTask(list, 'c', 1).map(t => t.id), ['a', 'b', 'c']);
eq('move up at top is a no-op', moveTask(list, 'a', -1).map(t => t.id), ['a', 'b', 'c']);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
