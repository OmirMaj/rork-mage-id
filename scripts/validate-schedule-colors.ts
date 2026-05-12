// validate-schedule-colors.ts — unit tests for scheduleColors utility.
// Run via: bun run scripts/validate-schedule-colors.ts
//
// Bun executes TypeScript natively — we can import the module and
// exercise the pure functions directly. No mocking needed since
// scheduleColors has no React Native dependencies.

import { inferTradeFromName, tradeKeyForTask, colorForTask, TRADE_KEYS, tradeLabel } from '../utils/scheduleColors';
import { Colors } from '../constants/colors';
import type { ScheduleTask } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else    { fail++; console.log('  ✗', name, '\n      got:  ', got, '\n      want: ', want); }
}

console.log('\nscheduleColors validation:');

// Name inference — positive matches
expect('Foundation Pour → concrete', inferTradeFromName('Foundation Pour'), 'concrete');
expect('Set Foundation → concrete', inferTradeFromName('Set Foundation'), 'concrete');
expect('Install Conduit → electrical', inferTradeFromName('Install Conduit'), 'electrical');
expect('Roof Shingles → roofing', inferTradeFromName('Roof Shingles'), 'roofing');
expect('HVAC Rough-in → hvac', inferTradeFromName('HVAC Rough-in'), 'hvac');
expect('Plumbing Rough-in → plumbing', inferTradeFromName('Plumbing Rough-in'), 'plumbing');
expect('Frame Walls → framing', inferTradeFromName('Frame Walls'), 'framing');
expect('Drywall and Paint → finish', inferTradeFromName('Drywall and Paint'), 'finish');
expect('Demo existing → demo', inferTradeFromName('Demo existing'), 'demo');
expect('Final Punchlist → closeout', inferTradeFromName('Final Punchlist'), 'closeout');
expect('Sod Installation → landscaping', inferTradeFromName('Sod Installation'), 'landscaping');

// Name inference — defaults
expect('Empty string → general', inferTradeFromName(''), 'general');
expect('null → general', inferTradeFromName(null), 'general');
expect('undefined → general', inferTradeFromName(undefined), 'general');
expect('Random word → general', inferTradeFromName('Procure widgets'), 'general');

// tradeKeyForTask honors explicit override
const task1 = { id: 't1', title: 'Foundation Pour', tradeKey: 'finish', startDay: 0, durationDays: 5, progress: 0, status: 'not_started' } as unknown as ScheduleTask;
expect('Explicit tradeKey overrides inference', tradeKeyForTask(task1), 'finish');

const task2 = { id: 't2', title: 'Foundation Pour', startDay: 0, durationDays: 5, progress: 0, status: 'not_started' } as unknown as ScheduleTask;
expect('No tradeKey → infer from name', tradeKeyForTask(task2), 'concrete');

// colorForTask returns a hex string from the palette
expect('colorForTask → palette hex', colorForTask(task2), Colors.tradeColors.concrete);

// All TRADE_KEYS have entries in palette + labels
for (const k of TRADE_KEYS) {
  expect(`Colors.tradeColors.${k} is defined`, typeof Colors.tradeColors[k] === 'string', true);
  expect(`tradeLabel(${k}) returns non-empty`, tradeLabel(k).length > 0, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
