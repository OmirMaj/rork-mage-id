// scripts/validate-backcharges.ts — pins utils/backcharges.ts (wave 4, W2) and
// the honesty lines on its screens.
//
//   parse robustness · integer cents · amountFromHours rounding + bounds ·
//   planDeduction (whole items only, never past the bill, carry oldest first,
//   payCents ≥ 0) · markApplied · the notice text · the mageid_ key ·
//   the sheet saves a picked photo as a job photo (addProjectPhoto) and never
//   stores a picker URI without a photoId · the device-local and
//   never-moves-the-money lines · sub-portal-setup's overage guard untouched.
//
// Run: bun scripts/validate-backcharges.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  BACKCHARGES_KEY, parseBackcharges, openFor, amountFromHours, BackchargeHoursError,
  planDeduction, markApplied, backchargeNotice, invoiceDeduction, sumCents, type Backcharge,
} from '../utils/backcharges';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); }
}
function throwsHours(fn: () => unknown): boolean {
  try { fn(); return false; } catch (e) { return e instanceof BackchargeHoursError && e.message.length > 0; }
}

function bc(p: Partial<Backcharge> & { id: string; amountCents: number; createdAt: string }): Backcharge {
  return {
    projectId: 'p1', subId: 's1', subName: 'Acme Drywall', commitmentId: null,
    reason: `Reason ${p.id}`, basis: 'typed', hours: null, rateCents: null,
    photoUri: null, photoId: null, punchItemId: null, status: 'open',
    appliedInvoiceId: null, appliedAt: null, ...p,
  };
}

console.log('\n§1 parse robustness');
ok('null / empty / junk → []', parseBackcharges(null).length === 0 && parseBackcharges('').length === 0 && parseBackcharges('{nope').length === 0);
ok('an object (not an array) → []', parseBackcharges('{"a":1}').length === 0);
const good = bc({ id: 'a', amountCents: 12345, createdAt: '2026-09-01T10:00:00Z' });
const rows = [
  good,
  { ...good, id: 'frac', amountCents: 12.5 },
  { ...good, id: 'zero', amountCents: 0 },
  { ...good, id: 'neg', amountCents: -100 },
  { ...good, id: 'str', amountCents: '500' },
  { ...good, id: '' },
  { ...good, id: 'noproj', projectId: '' },
  { ...good, id: 'nosub', subId: undefined },
  { ...good, id: 'badstatus', status: 'paid' },
  null, 7, 'x',
];
const parsed = parseBackcharges(JSON.stringify(rows));
ok('drops non-integer / ≤0 cents, missing ids, bad status', parsed.length === 1 && parsed[0].id === 'a', parsed.map(p => p.id));
ok('every parsed amount is an integer > 0', parsed.every(p => Number.isInteger(p.amountCents) && p.amountCents > 0));

console.log('\n§2 amountFromHours');
ok('3.5 h × $62.50 → 21875 cents', amountFromHours(3.5, 6250) === 21875);
ok('rounds half-cents: 1.333 h × 1000 → 1333', amountFromHours(1.333, 1000) === 1333);
ok('0.1 h × 3333 → 333 (Math.round of 333.3)', amountFromHours(0.1, 3333) === 333);
ok('result is an integer', Number.isInteger(amountFromHours(2.7, 4599)));
ok('0 hours throws a typed error with words', throwsHours(() => amountFromHours(0, 5000)));
ok('negative hours throws', throwsHours(() => amountFromHours(-1, 5000)));
ok('200 h is allowed', amountFromHours(200, 100) === 20000);
ok('200.5 h throws', throwsHours(() => amountFromHours(200.5, 100)));
ok('NaN hours throws', throwsHours(() => amountFromHours(Number.NaN, 100)));
ok('no rate throws', throwsHours(() => amountFromHours(2, 0)));

console.log('\n§3 planDeduction');
const A = bc({ id: 'A', amountCents: 30000, createdAt: '2026-09-01T00:00:00Z' });
const B = bc({ id: 'B', amountCents: 50000, createdAt: '2026-09-02T00:00:00Z' });
const C = bc({ id: 'C', amountCents: 10000, createdAt: '2026-09-03T00:00:00Z' });
{
  const p = planDeduction(100000, [C, B, A]);
  ok('all fit: oldest first, deduct = sum', p.applied.map(b => b.id).join() === 'A,B,C' && p.deductCents === 90000 && p.payCents === 10000);
}
{
  const p = planDeduction(60000, [C, B, A]);
  ok('stops before exceeding: A applied; B then C carry, oldest first', p.applied.map(b => b.id).join() === 'A' && p.carried.map(b => b.id).join() === 'B,C', p);
  ok('never exceeds the bill', p.deductCents <= 60000 && p.deductCents === 30000 && p.payCents === 30000);
}
{
  const p = planDeduction(20000, [A, C]);
  ok('oldest bigger than the bill: nothing applied, nothing split', p.applied.length === 0 && p.deductCents === 0 && p.payCents === 20000 && p.carried.map(b => b.id).join() === 'A,C');
}
{
  const p = planDeduction(30000, [A]);
  ok('exactly the bill: applied whole, pay 0', p.deductCents === 30000 && p.payCents === 0);
}
{
  const p = planDeduction(0, [A]);
  ok('a $0 bill: pay 0, never negative', p.payCents === 0 && p.deductCents === 0);
  const q = planDeduction(-500, [A]);
  ok('a negative bill is clamped: pay 0', q.payCents === 0 && q.deductCents === 0);
}
{
  const applied = { ...B, status: 'applied' as const };
  const p = planDeduction(100000, [A, applied]);
  ok('only open items are deducted', p.applied.map(b => b.id).join() === 'A' && p.carried.length === 0);
  ok('every applied item is whole (amount untouched)', p.applied.every(b => b.amountCents === A.amountCents));
}

console.log('\n§4 openFor / markApplied');
{
  const other = bc({ id: 'X', amountCents: 100, createdAt: '2026-08-01T00:00:00Z', subId: 's2' });
  const otherJob = bc({ id: 'Y', amountCents: 100, createdAt: '2026-08-01T00:00:00Z', projectId: 'p2' });
  const list = [C, other, A, otherJob, { ...B, status: 'void' as const }];
  ok('openFor: this sub, this job, open only, oldest first', openFor(list, 'p1', 's1').map(b => b.id).join() === 'A,C');
  const next = markApplied(list, ['A', 'B', 'X'], 'inv-9', '2026-09-26T12:00:00Z');
  const a = next.find(b => b.id === 'A')!;
  ok('markApplied stamps the invoice and time', a.status === 'applied' && a.appliedInvoiceId === 'inv-9' && a.appliedAt === '2026-09-26T12:00:00Z');
  ok('a void item stays void', next.find(b => b.id === 'B')!.status === 'void');
  ok('items not named are untouched', next.find(b => b.id === 'C') === C);
  ok('input not mutated', list.find(b => b.id === 'A')!.status === 'open');
}

console.log('\n§4b invoiceDeduction — one bill never takes more than it is');
{
  // Reviewer repro: $1,500 bill, open $450 (older) + $1,250.50.
  const b1 = bc({ id: 'b1', amountCents: 45000, createdAt: '2026-08-01T00:00:00Z' });
  const b2 = bc({ id: 'b2', amountCents: 125050, createdAt: '2026-08-05T00:00:00Z' });
  const bill = 150000;
  const first = invoiceDeduction([b1, b2], 'p1', 's1', 'inv7', bill);
  ok('before Apply: a plan (deduct $450, pay $1,050)', first.kind === 'plan' && first.plan.deductCents === 45000 && first.plan.payCents === 105000, first);
  const after = markApplied([b1, b2], first.kind === 'plan' ? first.plan.applied.map(b => b.id) : [], 'inv7', '2026-09-26T12:00:00Z');
  const second = invoiceDeduction(after, 'p1', 's1', 'inv7', bill);
  ok('after Apply: the card shows only the recorded deduction (no second plan)', second.kind === 'recorded', second);
  ok('recorded: deduct $450, pay $1,050, b2 still open for the next bill',
    second.kind === 'recorded' && second.deductCents === 45000 && second.payCents === 105000
    && second.appliedHere.map(b => b.id).join() === 'b1' && second.openAfter.map(b => b.id).join() === 'b2', second);
  const appliedToInv7 = sumCents(after.filter(b => b.status === 'applied' && b.appliedInvoiceId === 'inv7'));
  ok('total applied to inv7 ≤ the bill', appliedToInv7 <= bill, appliedToInv7);
  const nextBill = invoiceDeduction(after, 'p1', 's1', 'inv8', 200000);
  ok('the next bill plans the carried item', nextBill.kind === 'plan' && nextBill.plan.applied.map(b => b.id).join() === 'b2', nextBill);
  ok('recorded stays visible even when nothing is open',
    invoiceDeduction(markApplied([b1], ['b1'], 'inv7', 'x'), 'p1', 's1', 'inv7', bill).kind === 'recorded');
  ok('nothing open, nothing recorded → none', invoiceDeduction([], 'p1', 's1', 'inv7', bill).kind === 'none');
  const otherSub = { ...markApplied([b1], ['b1'], 'inv7', 'x')[0], subId: 's2' };
  ok("another sub's deduction on the same invoice id is not this card's", invoiceDeduction([otherSub], 'p1', 's1', 'inv7', bill).kind === 'none');
}

console.log('\n§5 notice');
{
  const n = backchargeNotice({ subName: 'Joe', projectName: 'Henderson', companyName: 'Majeed GC', items: [A, C] });
  ok('names each reason with its $', n.includes(`${A.reason}: $300`) && n.includes(`${C.reason}: $100`));
  ok('contains the total', n.includes('Total: $400'));
  ok('says it comes off the next payment on the project', n.includes('This will be deducted from your next payment on Henderson. Photos available on request.'));
  ok('never claims an automatic charge', !/charged automatically|will be charged automatically|auto-?debit/i.test(n));
  const cents = backchargeNotice({ subName: 'Joe', projectName: 'H', companyName: '', items: [bc({ id: 'c', amountCents: 12345, createdAt: 'x' })] });
  ok('cents render as dollars and cents', cents.includes('$123.45'));
}

console.log('\n§6 storage + sources');
ok("storage key is under the swept 'mageid_' prefix", BACKCHARGES_KEY.startsWith('mageid_'));
const sheet = read('components/backcharge/BackchargeSheet.tsx');
const section = read('components/backcharge/BackchargeSection.tsx');
const card = read('components/backcharge/BackchargeDeductionCard.tsx');
const hook = read('hooks/useBackcharges.ts');
ok('the sheet saves a picked photo through addProjectPhoto', /addProjectPhoto\(saved\)/.test(sheet));
ok('the picked photo keeps its photoId', /setPhoto\(\{ uri: saved\.uri, photoId: saved\.id/.test(sheet));
{
  // Every setPhoto that stores a URI with no photoId must be a punch item's
  // (already durable) photo — never the picker's.
  const calls = sheet.match(/setPhoto\(\{[^}]*\}\)/g) ?? [];
  const bare = calls.filter(c => /photoId: null/.test(c));
  ok('a URI without a photoId only ever comes from a punch item', calls.length >= 2 && bare.every(c => /punchItemId: p\.id/.test(c) && /p\.photoUri/.test(c)), calls);
  ok('the picker URI never reaches setPhoto directly', !/setPhoto\(\{ uri(,|: uri)/.test(sheet));
}
ok('the sheet is dialog-scoped only while open (section mounts it conditionally)', /\{sheetOpen \? \(\s*<BackchargeSheet/.test(section));
ok('the section says "Saved on this device until you sign out"', section.includes('Saved on this device until you sign out'));
ok('the deduction card says "Saved on this device until you sign out"', card.includes('Saved on this device until you sign out'));
ok('the deduction card says "MAGE never moves the money"', card.includes('MAGE never moves the money'));
ok('the hook reads/writes BACKCHARGES_KEY in try/catch', hook.includes('BACKCHARGES_KEY') && (hook.match(/try \{/g) ?? []).length >= 2);
ok('the section root is a sanctioned backcharge- host', /<View style=\{styles\.section\} testID="backcharge-section">/.test(section));
ok('the card root is a sanctioned backcharge- host', /testID=\{`backcharge-deduct-\$\{invoice\.id\}`\}/.test(card));
ok('notices are shared only on a tap (no share call at render/effect)', !/useEffect\([^)]*shareText/.test(section + card));

const portal = read('app/sub-portal-setup.tsx');
ok('sub-portal-setup keeps the overage guard text "Overage:"', portal.includes('`Overage: ${formatMoney(guard.overage)}\\n\\n` +'));
ok('the section sits directly above the Submitted invoices anchor', /<BackchargeSection [^\n]*\/> : null\}\n\n\s*\{\/\* Submitted invoices \*\/\}/.test(portal));
ok('the deduction card follows PayWhatsEarnedCard under the same condition', /<PayWhatsEarnedCard[^\n]*\n\s*\{inv\.status === 'submitted' && project && sub \? \(<BackchargeDeductionCard invoice=\{inv\} project=\{project\} sub=\{sub\} \/>\) : null\}/.test(portal));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
