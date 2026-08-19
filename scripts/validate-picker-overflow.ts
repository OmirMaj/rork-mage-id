// validate-picker-overflow.ts — a bounded list must scroll, not clip.
//
// The bug this pins, from the 2026-08 iOS pass:
//
//   app/permits.tsx rendered every drop-down as
//     <View style={styles.pickerOptions}>   // { …, maxHeight: 220 }
//
//   `maxHeight` on a plain View does not mean "scroll past here", it means
//   "stop drawing here". At paddingVertical 10 + a 19px line, a picker row is
//   39px, so 220px shows 5.6 rows and everything past the sixth was
//   unreachable — including `inspection_scheduled` / `inspection_passed` /
//   `inspection_failed`, the three statuses the permit inspection pipeline
//   exists to drive, and every project past the fifth on the project picker.
//
// The arithmetic below is re-derived from the source on every run rather than
// hard-coded, so shrinking `maxHeight`, fattening `pickerRow`, or appending a
// status all keep the check honest. It fails if a picker stops scrolling, and
// it fails if the numbers stop justifying the scroll (i.e. if someone makes
// the box tall enough that this file is no longer needed — at which point
// delete it deliberately rather than let it rot into a no-op).
//
// Run: bun run scripts/validate-picker-overflow.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Type } from '../constants/typography';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

/**
 * Comments are prose and prose lies — and worse, prose QUOTES the very pattern
 * these checks forbid, so a doc-comment explaining the old bug would satisfy a
 * naive grep for it. Every "must not appear" / "count the occurrences" check
 * below runs against code with the comments removed.
 */
function code(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block + JSDoc + {/* jsx */} bodies
    .replace(/^[ \t]*\/\/.*$/gm, '');     // whole-line // comments
}

const permits = src('app/permits.tsx');
const oac = src('app/oac-meeting.tsx');
const pipeline = src('components/StatusPipeline.tsx');
const permitsCode = code(permits);
const oacCode = code(oac);

// ── 1. the arithmetic: the permit pickers really do overflow ────────────────
console.log('\n1. the permit drop-downs are taller than their box:');

function num(re: RegExp, what: string): number {
  const m = permits.match(re);
  if (!m) { fail++; console.log('  ✗ could not read', what, '— this validator is blind, fix the regex'); return NaN; }
  return Number(m[1]);
}

const maxHeight = num(/pickerOptions:\s*\{[^}]*maxHeight:\s*(\d+)/, 'pickerOptions.maxHeight');
const rowPadding = num(/pickerRow:\s*\{[^}]*paddingVertical:\s*(\d+)/, 'pickerRow.paddingVertical');
const rowHeight = rowPadding * 2 + (Type.bodyCompact.lineHeight as number);
const rowsThatFit = Math.floor(maxHeight / rowHeight);

// The static option lists. Lengths are counted from the source so appending a
// status cannot silently invalidate the reasoning.
function listLength(name: string): number {
  const m = permits.match(new RegExp(`const ${name}[^=]*=\\s*\\[([^\\]]*)\\]`));
  if (!m) { fail++; console.log('  ✗ could not find the', name, 'list'); return 0; }
  return m[1].split(',').map(s => s.trim()).filter(Boolean).length;
}
const LISTS = ['PERMIT_STATUSES', 'PERMIT_TYPES', 'SPECIAL_INSPECTION_TYPES'].map(
  name => ({ name, len: listLength(name) }),
);

console.log(`      box ${maxHeight}px / row ${rowHeight}px = ${rowsThatFit} whole rows visible`);
ok('the box is not a whole number of rows (a clipped row is the affordance)',
  Number.isFinite(maxHeight) && maxHeight % rowHeight !== 0,
  `${maxHeight} is an exact multiple of ${rowHeight} — nothing peeks out of the bottom edge`);

for (const { name, len } of LISTS) {
  ok(`${name} (${len}) is longer than the ${rowsThatFit} rows that fit — it must scroll`,
    len > rowsThatFit);
}
const statusList = permits.match(/const PERMIT_STATUSES[^=]*=\s*\[([^\]]*)\]/)?.[1] ?? '';
ok('the status list still reaches the inspection states the pipeline drives',
  ['inspection_scheduled', 'inspection_passed', 'inspection_failed']
    .every(s => statusList.includes(`'${s}'`)),
  `PERMIT_STATUSES = [${statusList}]`);

// ── 2. …so the container is a ScrollView, in every picker ───────────────────
console.log('\n2. every picker body scrolls:');

ok('no picker body is a plain <View> bounded by maxHeight',
  !/<View style=\{styles\.pickerOptions\}/.test(permitsCode),
  'a maxHeight View clips its overflow and the clipped rows are untappable');

ok('styles.pickerOptions is applied in exactly one place — the PickerOptions component',
  (permitsCode.match(/style=\{styles\.pickerOptions\}/g) ?? []).length === 1);

const pickerComponent = permits.match(/function PickerOptions\([\s\S]*?\n}/)?.[0] ?? '';
ok('PickerOptions renders a ScrollView', /<ScrollView/.test(pickerComponent));
ok('…that scrolls when nested inside the form ScrollView (Android)',
  /nestedScrollEnabled/.test(pickerComponent));
ok('…and does not swallow the first tap while the keyboard is up',
  /keyboardShouldPersistTaps="handled"/.test(pickerComponent));

// Every `pickerOpen === 'x' && (` branch must open a PickerOptions. Counting
// both sides catches a new picker added as a bare View.
const branches = (permitsCode.match(/pickerOpen === '(\w+)' && \(/g) ?? []).length;
const bodies = (permitsCode.match(/<PickerOptions\b/g) ?? []).length;
ok(`all ${branches} picker branches render through <PickerOptions> (found ${bodies})`,
  branches > 0 && branches === bodies);

// ── 3. StatusPipeline: the labels are never the thing that gives way ────────
// The rendered-tree assertions live in __tests__/smoke/pipeline-and-agenda.test.tsx.
// This one guards the shape of the stylesheet those assertions read.
console.log('\n3. StatusPipeline stage labels:');

const stageStyle = pipeline.match(/\n  stage:\s*\{([^}]*)\}/)?.[1] ?? '';
const connectorStyle = pipeline.match(/\n  connector:\s*\{([^}]*)\}/)?.[1] ?? '';
ok('the stage (which holds the label) never shrinks', /flexShrink:\s*0/.test(stageStyle),
  'stage: ' + stageStyle.replace(/\s+/g, ' ').trim());
ok('the connector never shrinks a label to grow itself', /flexShrink:\s*0/.test(connectorStyle));
ok('the connector has a non-zero basis, not `flex: 1`',
  /flexBasis:\s*([1-9]\d*)/.test(connectorStyle) && !/^\s*flex:\s*1\b/m.test(connectorStyle));
ok('the pipeline row overflows into a horizontal scroll', /<ScrollView\s+horizontal/.test(pipeline));

// ── 4. oac-meeting: nothing dropped, nothing miscounted, nothing "1 attendees" ─
console.log('\n4. app/oac-meeting.tsx:');

ok('the agenda is bucketed through groupAgendaBySection',
  /agendaBuckets\.map\(/.test(oac) && /groupAgendaBySection\(/.test(oac));
ok('…which has an "Other" fallback rather than a silent drop',
  /label: 'Other'/.test(oac));
ok('no section-keyed filter renders the agenda any more',
  !/Object\.keys\(SECTION_LABELS\)\.map\(sec/.test(oacCode),
  'that pattern drops every item whose section is not one of the ten known keys');
ok('the covered counter counts the items it just rendered',
  /agendaShown\.filter\(a => a\.covered\)\.length\} of \{agendaShown\.length\} covered/.test(oac),
  'counting active.agenda while rendering a filtered subset is how "0 of 2 covered" appeared over an empty list');

// Plurals. Bare `${n} <noun>s` is the failure; the house pattern is
// `<noun>{n === 1 ? '' : 's'}`.
for (const noun of ['attendee', 'meeting', 'char']) {
  const bare = new RegExp(`\\.length\\}? ${noun}s\\b`);
  ok(`"${noun}s" is pluralised on the count, never bare`, !bare.test(oacCode),
    (oacCode.split('\n').find(l => bare.test(l)) ?? '').trim());
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
