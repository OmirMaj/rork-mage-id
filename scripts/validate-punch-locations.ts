// scripts/validate-punch-locations.ts — two spellings of one room must never
// become two rooms.
//
// WHY THIS EXISTS. utils/punchLocations.ts is the single source both punch
// screens read for "what locations exist on this project?". Everything it does
// is invisible when it is wrong: a corridor that splits into "Hall 2" and
// "hall  2" still renders two perfectly reasonable-looking chips, and the
// drywaller's handoff is quietly missing half his items. Nobody finds that by
// looking at the screen — they find it when the sub finishes and the punch
// list still has forty items on it.
//
// So the invariants are asserted here, on the pure functions, where they can
// fail the build instead of the walk:
//
//   • dedupe across case AND whitespace, keeping the user's capitalisation
//   • most-recently-used first, because a super says "hall 2" six times in a row
//   • plan rooms after used ones, never instead of them
//   • the no-location group EXISTS and is LAST — items nobody placed are the
//     ones most likely to be lost, so they get a visible home
//   • counts are right, and every input item lands in exactly one section
//   • empty/absent/garbage inputs are safe: no plans is the NORMAL case
//
// Run via: bun run test:punch-locations

import {
  normalizeLocation,
  sameLocation,
  buildPunchLocationOptions,
  groupPunchItemsByLocation,
  mostRecentLocationLabel,
  filterByLocationKey,
  UNPLACED_LOCATION_GROUP,
  UNPLACED_LOCATION_LABEL,
  type PunchLocationItemLike,
} from '../utils/punchLocations';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(label: string, got: T, want: T, why?: string) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(label, g === w, g === w ? undefined : `got  ${g}\n      want ${w}${why ? `\n      ${why}` : ''}`);
}

/** Terse item builder. `t` is a day number so the ordering intent reads plainly. */
function item(
  location: string,
  t: number | null,
  status: PunchLocationItemLike['status'] = 'open',
): PunchLocationItemLike {
  return {
    location,
    status,
    createdAt: t === null ? null : `2026-09-${String(t).padStart(2, '0')}T08:00:00.000Z`,
  };
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\nnormalisation — the comparison both screens must share');
// ───────────────────────────────────────────────────────────────────────────
eq('case folds', normalizeLocation('Hall 2'), 'hall 2');
eq('inner whitespace collapses', normalizeLocation('hall  2'), 'hall 2');
eq('tabs and newlines collapse too', normalizeLocation('hall\t\n2'), 'hall 2');
eq('outer whitespace trims', normalizeLocation('  Hall 2  '), 'hall 2');
eq('whitespace-only means no location', normalizeLocation('   '), '');
eq('empty string means no location', normalizeLocation(''), '');
eq('null is safe', normalizeLocation(null), '');
eq('undefined is safe', normalizeLocation(undefined), '');
eq('a non-string is safe', normalizeLocation(42 as unknown as string), '');
// Invisible characters ride in on voice transcripts and pasted text. An
// invisible difference that splits a room is the worst kind there is.
eq('control characters are stripped', normalizeLocation('Hall\u00002'), 'hall 2');
eq('a zero-width-free NFKC fold matches the typed spelling',
  normalizeLocation('Ｈａｌｌ 2'), 'hall 2');
// ...and the deliberate NON-folding: punctuation stays, because a wrong merge
// HIDES items inside the wrong room, while two chips is visible and fixable.
ok('"Hall-2" and "Hall 2" stay distinct',
  normalizeLocation('Hall-2') !== normalizeLocation('Hall 2'),
  'folding punctuation would be a guess, and a wrong merge hides items');

ok('sameLocation matches across case and spacing', sameLocation('Hall 2', 'hall  2'));
ok('sameLocation is false for two blanks', !sameLocation('', '   '),
  'two items with no location are not "in the same room" — they are unplaced');

// ───────────────────────────────────────────────────────────────────────────
console.log('\ndedupe + recency ordering (the used source)');
// ───────────────────────────────────────────────────────────────────────────
{
  const items = [
    item('Hall 2', 1),
    item('hall  2', 3),      // same room, later, different spelling
    item('Kitchen', 2),
    item('  HALL 2 ', 5),    // same room again, latest
    item('Unit 4B — master bath', 4),
  ];
  const opts = buildPunchLocationOptions(items);

  eq('five items over three distinct rooms', opts.length, 3);
  eq('most recent room is first', opts[0].key, 'hall 2');
  eq('then the next most recent', opts[1].key, 'unit 4b — master bath');
  eq('then the oldest', opts[2].key, 'kitchen');
  eq('the count is the whole room, not one spelling', opts[0].count, 3);
  eq('the label keeps the user\'s own capitalisation', opts[0].label, 'HALL 2',
    'the most recent spelling wins — if he has started writing it differently, follow him');
  ok('the label is never the normalised key', opts[0].label !== opts[0].key);
  eq('lastUsedAt is the newest item in the room', opts[0].lastUsedAt, '2026-09-05T08:00:00.000Z');
  eq('every entry from items is sourced "used"', opts.every(o => o.source === 'used'), true);
  eq('nothing claims to be on the plans when no plans were passed',
    opts.every(o => o.onPlan === false), true);
}

{
  // Recency must follow WHEN THE ITEM WAS CAPTURED, not when it was touched.
  // Closing an item from the office weeks later must not hoist a finished room
  // to the top of the picker while he is walking a different floor.
  const items: PunchLocationItemLike[] = [
    { location: 'Roof', status: 'closed', createdAt: '2026-09-01T08:00:00.000Z', updatedAt: '2026-09-30T08:00:00.000Z' },
    { location: 'Lobby', status: 'open', createdAt: '2026-09-10T08:00:00.000Z', updatedAt: '2026-09-10T08:00:00.000Z' },
  ];
  eq('createdAt drives recency, not updatedAt', buildPunchLocationOptions(items)[0].key, 'lobby');
  // ...and a caller who genuinely wants "recently touched" can say so.
  eq('the recency accessor is injectable',
    buildPunchLocationOptions(items, null, { recencyOf: i => i.updatedAt })[0].key, 'roof');
}

{
  // A location with no usable timestamp is still a real room he stood in.
  const items = [item('Basement', null), item('Attic', 2), item('Basement', null)];
  const opts = buildPunchLocationOptions(items);
  eq('undated locations are kept, not dropped', opts.length, 2);
  eq('a dated room outranks an undated one', opts[0].key, 'attic');
  eq('the undated room still carries its count', opts[1].count, 2);
  eq('an undated room reports no lastUsedAt rather than inventing one', opts[1].lastUsedAt, null);
  // Ties must not shuffle between runs, or the chips move under his thumb.
  const twice = JSON.stringify(buildPunchLocationOptions(items));
  eq('ordering is stable across calls', JSON.stringify(buildPunchLocationOptions(items)), twice);
}

{
  const items = [item('Hall 2', 1), item('Hall 2', 2, 'closed'), item('Hall 2', 3, 'ready_for_review')];
  const opts = buildPunchLocationOptions(items);
  eq('count includes closed items', opts[0].count, 3);
  eq('openCount excludes only closed', opts[0].openCount, 2,
    'in_progress and ready_for_review are still somebody\'s outstanding work');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\nplan rooms — a bonus source, never a replacement');
// ───────────────────────────────────────────────────────────────────────────
{
  const items = [item('Kitchen', 1), item('hall 2', 2)];
  const rooms = [{ name: 'Primary Bath' }, { name: 'KITCHEN' }, { name: 'Garage' }];
  const opts = buildPunchLocationOptions(items, rooms);

  eq('used rooms come first', opts.slice(0, 2).map(o => o.source), ['used', 'used']);
  eq('plan rooms follow them', opts.slice(2).map(o => o.source), ['plan', 'plan']);
  eq('a plan room that is already used is NOT duplicated',
    opts.filter(o => o.key === 'kitchen').length, 1);
  eq('...and it keeps the used entry, with its count', opts.find(o => o.key === 'kitchen')?.count, 1);
  eq('...and it is flagged as also being on the plans',
    opts.find(o => o.key === 'kitchen')?.onPlan, true);
  eq('...while a used room absent from the plans is not',
    opts.find(o => o.key === 'hall 2')?.onPlan, false);
  eq('an unused plan room counts zero, honestly',
    opts.filter(o => o.source === 'plan').map(o => o.count), [0, 0]);
  eq('an unused plan room has no lastUsedAt',
    opts.filter(o => o.source === 'plan').every(o => o.lastUsedAt === null), true);
  eq('plan rooms keep the plan\'s own order',
    opts.filter(o => o.source === 'plan').map(o => o.label), ['Primary Bath', 'Garage'],
    'the analysis returns them roughly as they read across the sheet');
}

{
  const rooms = [{ name: 'Bath' }, { name: ' bath ' }, { name: '' }, { name: '   ' }];
  const opts = buildPunchLocationOptions([], rooms);
  eq('plan rooms dedupe among themselves', opts.length, 1);
  eq('blank plan-room names are dropped rather than becoming a ghost chip',
    opts.map(o => o.label), ['Bath']);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\nempty and absent inputs — no plans is the NORMAL case');
// ───────────────────────────────────────────────────────────────────────────
eq('no items, no plans', buildPunchLocationOptions([]), []);
eq('null items', buildPunchLocationOptions(null), []);
eq('undefined items', buildPunchLocationOptions(undefined), []);
eq('null plan rooms', buildPunchLocationOptions([item('Hall', 1)], null).length, 1);
eq('undefined plan rooms', buildPunchLocationOptions([item('Hall', 1)], undefined).length, 1);
eq('empty plan rooms', buildPunchLocationOptions([item('Hall', 1)], []).length, 1);
eq('items with no location produce no options',
  buildPunchLocationOptions([item('', 1), item('   ', 2)]), []);
eq('a hole in the array does not throw',
  buildPunchLocationOptions([null as unknown as PunchLocationItemLike, item('Hall', 1)]).length, 1);
eq('mostRecentLocationLabel on an empty list', mostRecentLocationLabel([]), null);
eq('mostRecentLocationLabel carries the spelling forward',
  mostRecentLocationLabel([item('kitchen', 1), item('Unit 4B', 4)]), 'Unit 4B');

// ───────────────────────────────────────────────────────────────────────────
console.log('\ngrouping — every item lands in exactly one section');
// ───────────────────────────────────────────────────────────────────────────
{
  const items = [
    item('Hall 2', 1),
    item('', 2),
    item('hall  2', 3, 'closed'),
    item('Kitchen', 4),
    item('   ', 5, 'closed'),
    item('Kitchen', 6, 'in_progress'),
  ];
  const sections = groupPunchItemsByLocation(items);

  eq('three sections: two rooms plus the unplaced bucket', sections.length, 3);
  eq('the no-location group is LAST', sections[sections.length - 1].key, UNPLACED_LOCATION_GROUP);
  eq('...and says what it is', sections[sections.length - 1].label, UNPLACED_LOCATION_LABEL);
  eq('...and is flagged', sections[sections.length - 1].isUnplaced, true);
  eq('...and holds BOTH unplaced items — nothing is dropped',
    sections[sections.length - 1].total, 2);
  eq('no located section is flagged unplaced',
    sections.slice(0, -1).every(s => s.isUnplaced === false), true);

  eq('sections are recency-ordered like the picker', sections.map(s => s.key),
    ['kitchen', 'hall 2', UNPLACED_LOCATION_GROUP]);
  eq('the two spellings of one room are one section',
    sections.find(s => s.key === 'hall 2')?.total, 2);
  eq('open/closed split is right for a room',
    [sections[1].openCount, sections[1].closedCount], [1, 1]);
  eq('open/closed split is right for the unplaced bucket',
    [sections[2].openCount, sections[2].closedCount], [1, 1]);
  eq('total always equals open + closed',
    sections.every(s => s.total === s.openCount + s.closedCount), true);

  // The invariant that matters most on a 100+ item walk.
  const regrouped = sections.reduce((n, s) => n + s.items.length, 0);
  eq('every input item appears exactly once across all sections', regrouped, items.length);
  eq('...and the caller\'s own ordering inside a room is preserved',
    sections.find(s => s.key === 'kitchen')?.items.map(i => i.createdAt),
    ['2026-09-04T08:00:00.000Z', '2026-09-06T08:00:00.000Z']);
}

{
  // The unplaced group must not appear when there is nothing unplaced — an
  // empty "No location given" header is noise on a phone screen.
  const sections = groupPunchItemsByLocation([item('Hall', 1)]);
  eq('no unplaced section when every item has a location', sections.length, 1);
  ok('...and it is not the unplaced one', sections[0].key !== UNPLACED_LOCATION_GROUP);
}

{
  // A walk where NOTHING got a location: the bucket is the whole list, and it
  // is still last (of one) rather than an empty screen.
  const sections = groupPunchItemsByLocation([item('', 1), item(null as unknown as string, 2)]);
  eq('an all-unplaced list is one section', sections.length, 1);
  eq('...the unplaced one', sections[0].key, UNPLACED_LOCATION_GROUP);
  eq('...holding everything', sections[0].total, 2);
}

eq('grouping an empty list', groupPunchItemsByLocation([]), []);
eq('grouping null', groupPunchItemsByLocation(null), []);
eq('grouping undefined', groupPunchItemsByLocation(undefined), []);

{
  // Alphabetical order is for the printed/shared list a sub walks in door
  // order. "Hall 2" must come before "Hall 10" — a plain string sort gets this
  // exactly backwards, and room numbers are how commercial jobs are named.
  const items = [item('Hall 10', 5), item('Hall 2', 4), item('Hall 1', 3), item('Atrium', 2), item('', 1)];
  const alpha = groupPunchItemsByLocation(items, { order: 'alpha' });
  eq('natural ordering puts Hall 2 before Hall 10', alpha.map(s => s.key),
    ['atrium', 'hall 1', 'hall 2', 'hall 10', UNPLACED_LOCATION_GROUP]);
  eq('the unplaced group is still last under alpha ordering',
    alpha[alpha.length - 1].key, UNPLACED_LOCATION_GROUP);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\nexact-match filtering — the substring bug this replaces');
// ───────────────────────────────────────────────────────────────────────────
{
  const items = [item('Hall', 1), item('Hall bath', 2), item('Great hall', 3), item('', 4)];
  eq('"hall" returns ONLY the hall', filterByLocationKey(items, 'hall').length, 1,
    'the old `.includes()` filter returned three of these and handed the sub the wrong rooms');
  eq('the filter is case/space insensitive', filterByLocationKey(items, '  HALL ').length, 1);
  eq('the unplaced key selects the unplaced items',
    filterByLocationKey(items, UNPLACED_LOCATION_GROUP).length, 1);
  eq('no key means no filter', filterByLocationKey(items, null).length, items.length);
  eq('an empty key means no filter', filterByLocationKey(items, '').length, items.length);
  eq('filtering null items is safe', filterByLocationKey(null, 'hall'), []);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\nthe module stays pure — it is read on a jobsite with no signal');
// ───────────────────────────────────────────────────────────────────────────
{
  const src = readFileSync('utils/punchLocations.ts', 'utf-8');
  const code = src
    .split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))   // comments explain the bans; they are not violations
    .join('\n');
  ok('no React import', !/from '(react|react-native)'/.test(code),
    'this module is imported by pure scripts; a React import drags in a renderer');
  ok('no AsyncStorage', !/AsyncStorage/.test(code),
    'persistence belongs to the callers — hooks/usePlanRooms.ts owns the plan session');
  ok('no supabase', !/supabase/i.test(code),
    'every write in this app goes through utils/offlineQueue; this module writes nothing');
  ok('no ambient clock', !/new Date\(\)|Date\.now\(\)/.test(code),
    'recency comes from the timestamps on the items, so the same inputs always give the same output');
  ok('the no-location sentinel cannot be typed by a user',
    normalizeLocation(UNPLACED_LOCATION_GROUP) !== UNPLACED_LOCATION_GROUP,
    'a super who types the bucket\'s own name must get his own room, not the bucket');
  // Renaming it to *_KEY makes validate-storage-hygiene.ts read it as an
  // AsyncStorage key the tenant-switch sweep does not cover, and fail the build
  // several files away from the cause. Caught here, with the reason attached.
  ok('no exported const in this module is named *_KEY',
    !/export const [A-Z0-9_]*KEY[A-Z0-9_]*\s*=/.test(code),
    'scripts/validate-storage-hygiene.ts treats a *_KEY const as a storage key; ' +
    'this module writes nothing to storage, so nothing here may be named that');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('\n✗ validate-punch-locations: the shared location source is wrong — ' +
    'two spellings of one room split the handoff, and nothing on screen says so.\n');
  process.exit(1);
}
console.log('✓ validate-punch-locations: one room is one room.\n');
