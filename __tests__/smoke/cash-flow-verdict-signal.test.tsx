/**
 * /cash-flow must never grade a runway it did not measure.
 *
 * THE BUG THIS PINS (rendered audit 2026-09-10). The hero pill read a green
 * "Healthy", with a check mark, beside "Current Balance $0" — on a brand-new
 * account AND on the seeded one carrying a $155,172 job. Identical text in both
 * worlds, which is how you could tell no data was reaching it. The verdict
 * ladder in app/cash-flow.tsx opened on `forecast.length === 0`, and
 * utils/cashFlowEngine.ts `generateForecast` pushes one row per week
 * unconditionally — so on an empty account it returned 12 empty rows, the
 * no-data branch could never fire, `lowestBalance` was 0 (not < 0),
 * `netCashChange` was 0 (not < 0), and control fell through to 'Healthy'.
 * Beside it: "+$0 · 12w" behind a green up-arrow, and a twelve-bar chart whose
 * axis read "+$1 / $0 / −$1" because components/CashFlowChart.tsx clamps
 * `maxNet` to 1 to avoid dividing by zero. Three fabricated positives on the one
 * screen a contractor opens when he is worried about making payroll.
 *
 * WHY IT IS A RENDER TEST. The defect was never in the arithmetic — every
 * number on the screen was correct. It was in what the screen SAID about those
 * numbers, and only a mount can read that. The pure-function guards in
 * scripts/validate-cashflow-honesty.ts were all green while this shipped.
 *
 * THE LOAD-BEARING PAIR. Case 1 asserts the false verdict is gone; case 4
 * asserts a real verdict still appears when money actually moves. Without the
 * second, deleting the pill outright would pass — and a screen that never grades
 * anything is not the fix. Case 3 is the other half of the same trap: the test
 * for "did we measure anything" has to be DOLLARS, not row counts, or a typed
 * expense row with no amount in it buys a "Healthy" all over again.
 *
 * THE SECOND BUG THIS PINS, found reviewing the first fix. Killing the false
 * verdict is not the end of it: whatever replaces it has to be true as well.
 * The first cut printed one fixed sentence to everybody — "Add your bank
 * balance, an unpaid invoice, or a recurring bill and this becomes a real
 * forecast" — and mounting it against seeded devices put that under "Current
 * Balance $48,250", under a listed bill with no amount on it, and beside "Total
 * Pending $26,000 · Sources 1" where the one payment on file was merely dated
 * past the end of the window. It asked for what was already there. And the
 * promise is unkeepable in every state: a starting balance is a LEVEL, never a
 * movement, so no balance anyone types can flip forecastHasCashMovement. The
 * cases below hold each branch of the replacement to something the screen can
 * actually see, and the last three hold the money boxes that manufactured the
 * silence in the first place (`parseFloat('') || 0` → a recorded $0).
 *
 * MUTATION-TESTED, 11 ways, each applied to the real file and reverted from a
 * shasum-checked backup. Ten were caught on the first pass; M11 SAILED THROUGH
 * and the case for it was written afterwards, which is the whole argument for
 * running the mutations rather than reasoning about coverage:
 *   M1  restore `if (forecast.length === 0) → 'Setup'`, the original defect
 *   M2  signal test = `weeks.length > 0`
 *   M3  signal test = item COUNTS rather than dollars
 *   M4  signal test = `> 0` instead of `!== 0` (loses the backcharge)
 *   M5  diagnoseEmptyForecast always answers 'nothing_dated_on_file'
 *   M6  diagnoseEmptyForecast stops counting invoices/payments as on file
 *   M7  the Add Expense button stops being disabled
 *   M8  parseMoneyInput answers 0 for an empty box (the `Number('')` trap)
 *   M9  the AI button stops being gated on movement
 *   M10 the chart is drawn from twelve all-zero weeks again
 *   M11 the Add Payment button stops being disabled — MISSED at first
 *   M12 parseMoneyInput strips commas blindly ("1200,50" → 120050)
 *   M13 the Update Balance button stops being disabled
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { parseMoneyInput } from '@/utils/cashFlowEngine';

/** Every string rendered anywhere in the tree, sheets included. */
function collectText(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => collectText(n, out));
    return out;
  }
  const children = (node as { children?: unknown }).children;
  if (children) collectText(children, out);
  return out;
}

/** Rendered by components/CashFlowChart's legend — present only when the real
 *  chart is drawn, never by the placeholder that replaces it. */
const CHART_MARKER = 'Running Balance';

/**
 * Put a cash-flow setup on the device before the screen mounts.
 *
 * `mage_cashflow_data` is the offline cache utils/cashFlowStorage reads
 * (loadCashFlowSettings falls back to it when Supabase is not configured, which
 * is the case under jest), so this is the same shape a GC who finished the
 * wizard would have. Dates are `now` instants, not calendar-day strings —
 * generateForecast compares them against week boundaries, and a bare
 * 'YYYY-MM-DD' parses as UTC midnight, i.e. the previous evening west of
 * Greenwich, which drops the row out of week 0.
 */
async function seedSetup(over: {
  startingBalance: number;
  expenses?: { id: string; name: string; amount: number; startDate?: string }[];
  expectedPayments?: { id: string; description: string; amount: number; expectedDate?: string }[];
}): Promise<void> {
  const now = new Date().toISOString();
  await AsyncStorage.setItem('mage_cashflow_data', JSON.stringify({
    startingBalance: over.startingBalance,
    balanceAsOf: now,
    // Defaults FIRST so a case can pin its own date — the out-of-window and
    // backcharge cases below are entirely about the date.
    expenses: (over.expenses ?? []).map((e) => ({
      frequency: 'monthly', category: 'overhead', startDate: now, ...e,
    })),
    expectedPayments: (over.expectedPayments ?? []).map((p) => ({
      confidence: 'expected', expectedDate: now, ...p,
    })),
    defaultPaymentTerms: 'net_30',
    dailyOverheadCost: 350,
    lastUpdated: now,
  }));
  await AsyncStorage.setItem('mage_cashflow_setup_complete', 'true');
}

describe('cash flow — the verdict is gated on signal, not on forecast rows', () => {
  it('says it has nothing to forecast on an empty account, instead of "Healthy"', async () => {
    await primeWorld('empty');
    const tree = await mountRouteChecked('/cash-flow');
    const text = collectText(tree.toJSON()).join(' | ');

    // The three fabricated positives, all gone.
    expect(text).not.toContain('Healthy');
    expect(text).not.toContain('Watch');
    expect(text).not.toContain('Danger');
    expect(text).not.toContain(CHART_MARKER);

    // …replaced by what is actually true, and by what to do about it.
    expect(text).toContain('No forecast yet');
    expect(text).toContain('nothing to forecast yet');
    expect(text).toContain('No dated cash movements yet');

    // The AI would have narrated the same fabricated verdict — it returns an
    // overallHealth and a /100 score — so its button is blocked and says why.
    expect(tree.getByTestId('ai-analysis-btn').props.accessibilityState?.disabled).toBe(true);
    expect(text).toContain('No forecast to analyze yet');

    // …and it does not send him after an input he has already given, or one
    // that would not have helped. A starting balance is a LEVEL: it never
    // enters totalIncome or totalExpenses, so no balance can turn twelve empty
    // weeks into a forecast, and promising that it would is the same lie as
    // the verdict, one paragraph down.
    expect(text).not.toContain('Add your bank balance, an unpaid invoice');
  });

  it('names the undated commitments as the reason, on an account that has them', async () => {
    // The seeded world's two subcontracts ($42,200) sit on a job with no
    // schedule, so buildCommittedOutflows cannot place them on a week. "Add
    // your bank balance" would be the wrong instruction here: the money is
    // already known, the DATES are what is missing.
    await primeWorld('populated');
    const tree = await mountRouteChecked('/cash-flow');
    const text = collectText(tree.toJSON()).join(' | ');

    expect(text).not.toContain('Healthy');
    expect(text).toContain('No forecast yet');
    expect(text).toContain('has no dates on it');
    expect(text).toContain('put a schedule on those jobs');
  });

  it('does not let a zero-amount expense row buy a verdict', async () => {
    // A row is not a cash movement. This is the case that separates "we
    // measured something" from "the user has typed something", and it is the
    // one a row-count implementation of the gate would get wrong.
    await primeWorld('empty');
    await seedSetup({ startingBalance: 48_250, expenses: [{ id: 'e0', name: 'Truck note', amount: 0 }] });
    const tree = await mountRouteChecked('/cash-flow');
    const text = collectText(tree.toJSON()).join(' | ');

    expect(text).toContain('$48,250');
    expect(text).not.toContain('Healthy');
    expect(text).toContain('No forecast yet');
  });

  it('does not tell a GC to add the bank balance he already recorded', async () => {
    // Rendered, before this was fixed: "Current Balance | $48,250 | No forecast
    // yet | …Add your bank balance, an unpaid invoice, or a recurring bill and
    // this becomes a real forecast." Two of those three were already on file,
    // and the third — the balance — could not have produced a forecast at all.
    await primeWorld('empty');
    await seedSetup({ startingBalance: 48_250 });
    const tree = await mountRouteChecked('/cash-flow');
    const text = collectText(tree.toJSON()).join(' | ');

    expect(text).toContain('$48,250');
    expect(text).toContain('No forecast yet');
    expect(text).not.toContain('Add your bank balance');
    expect(text).not.toContain('bank balance, an unpaid invoice');
    // What it says instead names only things that are genuinely absent.
    expect(text).toContain('Add an unpaid invoice, an expected payment or a recurring bill');
  });

  it('names the blank bill rather than asking for a bill he has already typed', async () => {
    await primeWorld('empty');
    await seedSetup({ startingBalance: 48_250, expenses: [{ id: 'e0', name: 'Truck note', amount: 0 }] });
    const tree = await mountRouteChecked('/cash-flow');
    const text = collectText(tree.toJSON()).join(' | ');

    expect(text).toContain('One bill in your list has no amount on it');
    expect(text).toContain('the forecast can place it');
    expect(text).not.toContain('a recurring bill');
  });

  it('does not ask for an invoice when the money on file is simply dated past the window', async () => {
    // $26,000 expected 200 days out, on a 12-week horizon. The screen renders
    // "Total Pending | $26,000 | Sources | 1" in the same card — telling him to
    // add an unpaid invoice there contradicts the number beside it.
    const far = new Date();
    far.setDate(far.getDate() + 200);
    await primeWorld('empty');
    await seedSetup({
      startingBalance: 48_250,
      expectedPayments: [{
        id: 'p7', description: 'Retainage release', amount: 26_000, expectedDate: far.toISOString(),
      }],
    });
    const tree = await mountRouteChecked('/cash-flow');
    const text = collectText(tree.toJSON()).join(' | ');

    expect(text).toContain('$26,000');
    expect(text).toContain('No forecast yet');
    expect(text).toContain('either unsent or dated outside this window');
    expect(text).not.toContain('Add an unpaid invoice');
  });

  it('reads a NEGATIVE amount as movement, not as silence', async () => {
    // A backcharge against you is money leaving. The signal test is `!== 0`
    // for exactly this: written as `> 0` it would call a week that costs the
    // GC $5,000 "nothing to forecast" — the one direction this screen must
    // never round toward comfort.
    const soon = new Date();
    soon.setDate(soon.getDate() + 10);
    await primeWorld('empty');
    await seedSetup({
      startingBalance: 48_250,
      expectedPayments: [{
        id: 'p6', description: 'Backcharge from GC', amount: -5_000, expectedDate: soon.toISOString(),
      }],
    });
    const tree = await mountRouteChecked('/cash-flow');
    const text = collectText(tree.toJSON()).join(' | ');

    expect(text).not.toContain('No forecast yet');
    expect(text).toContain('Watch');
    expect(text).toContain(CHART_MARKER);
  });

  it('refuses to record a $0 bill typed into an empty amount box', async () => {
    // `parseFloat('') || 0` used to save it, with a success haptic. The row
    // then sat in Monthly Expenses adding nothing to any week — manufacturing
    // the very silence the hero line above has to explain.
    await primeWorld('empty');
    await seedSetup({ startingBalance: 48_250 });
    const tree = await mountRouteChecked('/cash-flow');
    // The "Add Expense" entry point lives inside the collapsed section.
    await act(async () => { fireEvent.press(tree.getByText('Monthly Expenses')); });
    await act(async () => { fireEvent.press(tree.getByText('Add Expense')); });

    // Name typed, amount box left empty: the save is blocked and says why.
    await act(async () => {
      fireEvent.changeText(tree.getByPlaceholderText('e.g. Payroll'), 'Payroll');
    });
    expect(tree.getByTestId('add-expense-btn').props.accessibilityState?.disabled).toBe(true);
    expect(collectText(tree.toJSON()).join(' | ')).toContain('needs a name and an amount above $0');

    // A real number unblocks it. A literal "0" does not — that is the value
    // the old code invented, and it is the one value that must be refused.
    await act(async () => {
      fireEvent.changeText(tree.getAllByPlaceholderText('0')[0], '0');
    });
    expect(tree.getByTestId('add-expense-btn').props.accessibilityState?.disabled).toBe(true);
    // A decimal comma is refused rather than silently read as 320050, and the
    // note changes to say what shape to type — a dead button with the wrong
    // explanation is its own trap.
    await act(async () => {
      fireEvent.changeText(tree.getAllByPlaceholderText('0')[0], '3200,50');
    });
    expect(tree.getByTestId('add-expense-btn').props.accessibilityState?.disabled).toBe(true);
    expect(collectText(tree.toJSON()).join(' | ')).toContain('is not a number this can read');

    await act(async () => {
      fireEvent.changeText(tree.getAllByPlaceholderText('0')[0], '3200');
    });
    expect(tree.getByTestId('add-expense-btn').props.accessibilityState?.disabled).toBe(false);
  });

  it('refuses to record a $0 expected payment either', async () => {
    // Same empty-box trap on the income side, and the same silent success
    // haptic. A negative IS allowed here and the note says so — a backcharge
    // against you is real money leaving in the week it lands.
    await primeWorld('empty');
    await seedSetup({ startingBalance: 48_250 });
    const tree = await mountRouteChecked('/cash-flow');
    await act(async () => { fireEvent.press(tree.getByText('Expected Income')); });
    await act(async () => { fireEvent.press(tree.getByText('Add Expected Payment')); });
    await act(async () => {
      fireEvent.changeText(tree.getByPlaceholderText('e.g. Deposit from River Oak'), 'Harlow draw 2');
    });

    expect(tree.getByTestId('add-payment-btn').props.accessibilityState?.disabled).toBe(true);
    expect(collectText(tree.toJSON()).join(' | ')).toContain('needs a description and an amount');

    await act(async () => { fireEvent.changeText(tree.getAllByPlaceholderText('0')[0], '0'); });
    expect(tree.getByTestId('add-payment-btn').props.accessibilityState?.disabled).toBe(true);

    await act(async () => { fireEvent.changeText(tree.getAllByPlaceholderText('0')[0], '-5000'); });
    expect(tree.getByTestId('add-payment-btn').props.accessibilityState?.disabled).toBe(false);
  });

  it('refuses to overwrite a real bank balance with a cleared box', async () => {
    // `parseFloat('') || 0` wrote $0 over $48,250 — on the number every week of
    // the forecast is built up from, and with no way afterwards to tell it from
    // a GC who really is at zero.
    await primeWorld('empty');
    await seedSetup({ startingBalance: 48_250 });
    const tree = await mountRouteChecked('/cash-flow');
    await act(async () => { fireEvent.press(tree.getByTestId('hero-balance-tap')); });

    expect(tree.getByTestId('update-balance-btn').props.accessibilityState?.disabled).toBe(false);
    await act(async () => { fireEvent.changeText(tree.getByTestId('edit-balance-input'), ''); });
    expect(tree.getByTestId('update-balance-btn').props.accessibilityState?.disabled).toBe(true);
    expect(collectText(tree.toJSON()).join(' | ')).toContain('An empty box used to save as $0');

    // A typed zero is a real answer and is still accepted.
    await act(async () => { fireEvent.changeText(tree.getByTestId('edit-balance-input'), '0'); });
    expect(tree.getByTestId('update-balance-btn').props.accessibilityState?.disabled).toBe(false);
  });

  it('still grades a forecast that has money moving through it', async () => {
    // Cash IN, so the balance holds and grows: the one case 'Healthy' is for.
    // If this stops passing, the fix has become "never say anything", which is
    // its own kind of useless.
    await primeWorld('empty');
    await seedSetup({
      startingBalance: 48_250,
      expectedPayments: [{ id: 'p1', description: 'Harlow draw 2', amount: 26_000 }],
    });
    const tree = await mountRouteChecked('/cash-flow');
    const text = collectText(tree.toJSON()).join(' | ');

    expect(text).toContain('Healthy');
    expect(text).toContain(CHART_MARKER);
    expect(text).not.toContain('No forecast yet');
    expect(tree.getByTestId('ai-analysis-btn').props.accessibilityState?.disabled).toBe(false);
  });

  it('still says Watch when the only movement is money going out', async () => {
    // A recurring bill against a real balance: cash falls over the horizon but
    // never goes negative. The signal gate must not swallow the negative
    // readings — those are the ones worth having.
    await primeWorld('empty');
    await seedSetup({ startingBalance: 48_250, expenses: [{ id: 'e1', name: 'Shop rent', amount: 3_200 }] });
    const tree = await mountRouteChecked('/cash-flow');
    const text = collectText(tree.toJSON()).join(' | ');

    expect(text).toContain('Watch');
    expect(text).not.toContain('Healthy');
    expect(text).not.toContain('No forecast yet');
  });
});

describe('parseMoneyInput — the money box, not a truthiness test', () => {
  it('refuses what nobody typed and keeps what they did', () => {
    // The empty box is the whole point: Number('') is 0, and a recorded $0 is
    // indistinguishable from a deliberate one on this screen.
    expect(parseMoneyInput('')).toBeNull();
    expect(parseMoneyInput('   ')).toBeNull();
    expect(parseMoneyInput('abc')).toBeNull();
    expect(parseMoneyInput('-')).toBeNull();
    expect(parseMoneyInput('0')).toBe(0);
    expect(parseMoneyInput('3200')).toBe(3200);
    expect(parseMoneyInput('$3,200.50')).toBe(3200.5);
    // A backcharge is a real figure on the income side.
    expect(parseMoneyInput('-5000')).toBe(-5000);
    // The dangerous one: a decimal comma. Stripping it would record 120050 —
    // a hundredfold error — so it is refused and retyped instead.
    expect(parseMoneyInput('1200,50')).toBeNull();
  });
});
