// validate-ap-reconciliation.ts — pins AP payment reconciliation.
//
// WHY THIS EXISTS. "Mark paid" used to be a bare status flip: the invoice closed
// in MAGE while the actual check lived only in the GC's bank. Nothing tied the
// two together, so paid-vs-owed couldn't be reconciled against a statement and
// "which check paid this?" had no answer at 1099 time.
//
// MAGE deliberately does NOT move money (founder decision: reconciliation-only,
// not a payment processor — docs/audits/2026-08-26-moat-fixes.md #5). So the
// job of this module is to record the payment made ELSEWHERE and be honest
// about how complete that record is.
//
// Pins INTENDED semantics:
//   • an unpaid invoice is 'not_applicable' — never nagged
//   • a paid invoice with no method is 'unreconciled' (the bug this fixes)
//   • a method without a date, or without the reference that method implies,
//     is 'partial'
//   • cash/other may legitimately have no reference — don't nag for one
//   • a full record is 'reconciled'
//   • paymentSummary reads like a bank line ("Check · #1042 · Mar 3, 2026")
//   • a garbage method string does NOT count as recorded
//
// Run via: bun run test:ap-reconciliation

import {
  reconciliationState,
  needsReconciliation,
  reconciliationLabel,
  paymentSummary,
  countNeedingReconciliation,
  isPaymentMethod,
  PAYMENT_METHODS,
} from '../utils/apReconciliation';

let failures = 0;
function check(label: string, cond: boolean) {
  if (!cond) {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

// --- not applicable until paid ----------------------------------------------
check('submitted invoice is not_applicable', reconciliationState({ status: 'submitted' }) === 'not_applicable');
check('approved invoice is not_applicable', reconciliationState({ status: 'approved' }) === 'not_applicable');
check('unpaid never needs reconciliation', !needsReconciliation({ status: 'approved' }));
check('unpaid has no label', reconciliationLabel({ status: 'submitted' }) === null);

// --- the bug this fixes: paid with nothing recorded -------------------------
check('paid with no detail is unreconciled', reconciliationState({ status: 'paid' }) === 'unreconciled');
check('paid with no detail needs reconciliation', needsReconciliation({ status: 'paid' }));
check('unreconciled label is honest', reconciliationLabel({ status: 'paid' }) === 'No payment detail');

// --- partial records --------------------------------------------------------
check('check with no date is partial',
  reconciliationState({ status: 'paid', paymentMethod: 'check', paymentReference: '1042' }) === 'partial');
check('check with no number is partial',
  reconciliationState({ status: 'paid', paymentMethod: 'check', paidOn: '2026-03-03' }) === 'partial');
check('ach with no trace is partial',
  reconciliationState({ status: 'paid', paymentMethod: 'ach', paidOn: '2026-03-03' }) === 'partial');
check('partial label reads "Missing detail"',
  reconciliationLabel({ status: 'paid', paymentMethod: 'check', paidOn: '2026-03-03' }) === 'Missing detail');
check('whitespace-only reference does not count',
  reconciliationState({ status: 'paid', paymentMethod: 'check', paymentReference: '   ', paidOn: '2026-03-03' }) === 'partial');

// --- cash/other need no reference -------------------------------------------
check('cash with a date alone is reconciled',
  reconciliationState({ status: 'paid', paymentMethod: 'cash', paidOn: '2026-03-03' }) === 'reconciled');
check('other with a date alone is reconciled',
  reconciliationState({ status: 'paid', paymentMethod: 'other', paidOn: '2026-03-03' }) === 'reconciled');
check('cash still needs a DATE',
  reconciliationState({ status: 'paid', paymentMethod: 'cash' }) === 'partial');

// --- fully reconciled -------------------------------------------------------
const full = { status: 'paid', paymentMethod: 'check', paymentReference: '1042', paidOn: '2026-03-03' };
check('complete check record is reconciled', reconciliationState(full) === 'reconciled');
check('reconciled does not need attention', !needsReconciliation(full));
check('reconciled label', reconciliationLabel(full) === 'Reconciled');

// --- a bogus method is not a record -----------------------------------------
check('unknown method string is unreconciled',
  reconciliationState({ status: 'paid', paymentMethod: 'venmo-ish', paidOn: '2026-03-03' }) === 'unreconciled');
check('isPaymentMethod rejects junk', !isPaymentMethod('venmo-ish'));
check('isPaymentMethod accepts every declared method', PAYMENT_METHODS.every(isPaymentMethod));

// --- summary reads like a bank line -----------------------------------------
const sum = paymentSummary(full);
check('summary names the method', !!sum && sum.includes('Check'));
check('summary carries the check number with a #', !!sum && sum.includes('#1042'));
check('summary carries a human date', !!sum && sum.includes('Mar 3, 2026'));
check('summary does not double the # when the GC typed one',
  paymentSummary({ status: 'paid', paymentMethod: 'check', paymentReference: '#77', paidOn: '2026-03-03' })?.includes('##') === false);
check('no method → no summary', paymentSummary({ status: 'paid' }) === null);
// A date-only local string must not shift a day via UTC parsing.
check('date is not UTC-shifted', paymentSummary({ status: 'paid', paymentMethod: 'cash', paidOn: '2026-01-01' })?.includes('Jan 1, 2026') === true);

// --- the roll-up nudge ------------------------------------------------------
check('counts only paid-and-incomplete', countNeedingReconciliation([
  { status: 'paid' },                                    // unreconciled
  { status: 'paid', paymentMethod: 'check', paidOn: '2026-03-03' }, // partial
  full,                                                  // reconciled
  { status: 'approved' },                                // n/a
]) === 2);
check('empty list counts zero', countNeedingReconciliation([]) === 0);

if (failures > 0) {
  console.error(`\n✗ validate-ap-reconciliation: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('✓ validate-ap-reconciliation: all checks passed');
