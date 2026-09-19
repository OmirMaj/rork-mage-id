// scripts/validate-punch-edit-sheet.ts — wave 3, lane punch (#19, #20, #111, #113)
//
// #19  the edit sheet can clear a sub (Unassigned chip, tap the active chip)
//      and take a name that is not a chip (Other…) — pinned in detail by
//      validate-punch-sub-identity; the presence is re-checked here.
// #20  a bare trade word in the sub column reads "Trade: X · no sub assigned",
//      is not offered as a sub filter, and templates no longer write one.
// #111 Delete is allowed for the item's creator or the project owner only —
//      the server's delete policy. Anyone else sees the trash blocked with the
//      reason, and bulk delete leaves those rows out and says how many.
//      Every create path stamps createdByUserId.
// #113 the due date is a DatePickerModal (calendar day, Clear), an unreadable
//      value is refused on save with the reason, and a stored free-text date
//      is shown as "not a date, not tracked".
//
// Run: bun run scripts/validate-punch-edit-sheet.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

const src = read('app', 'punch-list.tsx');

// Lift the three pure module-level helpers and run them.
function liftFn(name: string): string {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) return '';
  let j = src.indexOf('{\n', src.indexOf(')', src.indexOf(')', i)) );
  let depth = 0;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) break; }
  return src.slice(i, j + 1);
}
const tr = new (globalThis as unknown as { Bun: { Transpiler: new (o: { loader: 'ts' }) => { transformSync(code: string): string } } }).Bun.Transpiler({ loader: 'ts' });
const js = tr.transformSync(
  `const SUB_TRADES = ['General','Electrical','Plumbing','HVAC'];\n`
  + `const parseCalendarDay = (v) => /^\\d{4}-\\d{2}-\\d{2}$/.test(v) ? new Date(v) : null;\n`
  + `${liftFn('punchDeleteAllowed')}\n${liftFn('isTradeWordOnly')}\n${liftFn('dueDateUnreadable')}\n`
  + `export const api = { punchDeleteAllowed, isTradeWordOnly, dueDateUnreadable };`,
).replace(/export const api =/, 'return');
// eslint-disable-next-line no-new-func
const api = new Function(js)() as {
  punchDeleteAllowed: (i: { createdByUserId?: string }, u: string | undefined, owns: boolean) => boolean;
  isTradeWordOnly: (n: string | undefined, subs: ReadonlySet<string>) => boolean;
  dueDateUnreadable: (d: string | undefined) => boolean;
};

console.log('#111 who may delete:');
check('the project owner may delete anyone\'s item', api.punchDeleteAllowed({ createdByUserId: 'x' }, 'gc', true));
check('the creator may delete his own', api.punchDeleteAllowed({ createdByUserId: 'fm' }, 'fm', false));
check('a collaborator may NOT delete the GC\'s item', !api.punchDeleteAllowed({ createdByUserId: 'gc' }, 'fm', false));
check('an item with no creator mapped is "not yours" unless you own the job',
  !api.punchDeleteAllowed({}, 'fm', false) && api.punchDeleteAllowed({}, 'gc', true));
check('signed out never deletes a creator-less item', !api.punchDeleteAllowed({}, undefined, false));
check('the row trash is gated and says why when blocked',
  /onPress=\{\(\) => \(canDelete \? actions\.onDelete\(item\) : actions\.onDeleteBlocked\(\)\)\}/.test(src)
  && /onDeleteBlocked: \(\) => showAlert\('Can’t delete this item', PUNCH_DELETE_BLOCKED_REASON\)/.test(src)
  && /const PUNCH_DELETE_BLOCKED_REASON = 'Only the person who added this item or the project owner can delete it\.';/.test(src));
check('bulk delete sends only the deletable rows and explains the rest',
  /const ids = selectedItems\.filter\(canDeleteItem\)\.map\(i => i\.id\);/.test(src)
  && /deletePunchItems\(ids\);/.test(src) && /added by someone else and will stay/.test(src)
  && /if \(n === 0\) \{\s*showAlert\('Can’t delete these items', PUNCH_DELETE_BLOCKED_REASON\);/.test(src));
check('every create path on the list stamps createdByUserId (form, template, photo walk)',
  (src.match(/\.\.\.\(user\?\.id \? \{ createdByUserId: user\.id \} : \{\}\),/g) ?? []).length === 3);

console.log('\n#20 trade words are not subs:');
const subs = new Set(['sparks electric', 'electrical']);
check('a bare trade word with no sub of that name is flagged', api.isTradeWordOnly('General', new Set()));
check('a real sub is not', !api.isTradeWordOnly('Sparks Electric', subs));
check('a sub literally named like a trade is trusted', !api.isTradeWordOnly('Electrical', subs));
check('the row says "Trade: X · no sub assigned"', /Trade: \{item\.assignedSub\} · no sub assigned/.test(src));
check('the sub filter leaves trade words out', /if \(s && !isTradeWordOnly\(s, pickerSubNames\)\) set\.add\(s\);/.test(src));
check('templates save unassigned, not the trade word', !/assignedSub: template\.trade === 'General'/.test(src)
  && /assignedSub: '',\s*dueDate: '',\s*priority: item\.priority,/.test(src));

console.log('\n#113 due date:');
check('unreadable detection', api.dueDateUnreadable('Fri') && api.dueDateUnreadable('9/25') && !api.dueDateUnreadable('2026-09-25')
  && !api.dueDateUnreadable('') && !api.dueDateUnreadable(undefined));
check('the bare YYYY-MM-DD text box is gone', !/placeholder="YYYY-MM-DD"/.test(src));
check('a DatePickerModal stores the calendar day (calendarDayOf), with Clear',
  /<DatePickerModal[\s\S]{0,800}onChange=\{\(iso\) => setDueDate\(calendarDayOf\(iso\) \?\? ''\)\}/.test(src)
  && /onPress=\{\(\) => setDueDate\(''\)\}[^\n]*testID="punch-due-clear"/.test(src));
check('save refuses an unreadable due date with the reason',
  /if \(dueDate\.trim\(\) && !parseCalendarDay\(dueDate\.trim\(\)\.slice\(0, 10\)\)\) \{\s*showAlert\('Due date not understood'/.test(src));
check('a stored free-text date reads "not a date, not tracked"', /not a date, not tracked\. Edit to pick one\./.test(src));

console.log('\n#19 the edit sheet can clear and type a sub:');
check('Unassigned and Other… chips exist', /testID="punch-sub-unassigned"/.test(src) && /testID="punch-sub-other"/.test(src));
check('chips come from the subs this user may assign on this job (#110)', /\{pickerSubs\.map\(s => \{/.test(src)
  && !/\{subcontractors\.length > 0 \? \(/.test(src));

console.log(fail ? `\n✗ validate-punch-edit-sheet: ${fail} failure(s)` : `\nall punch edit-sheet checks passed (${pass})`);
if (fail) process.exit(1);
