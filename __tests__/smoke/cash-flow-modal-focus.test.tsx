/**
 * MISS-07 — the Cash Flow sheets must not survive the screen losing focus.
 *
 * THE BUG THIS PINS. app/cash-flow.tsx auto-opens `CashFlowSetup` on mount
 * whenever `isSetupComplete()` is false, and that wizard is a React Native
 * `<Modal presentationStyle="pageSheet">` (components/CashFlowSetup.tsx:271).
 * On iOS a Modal is presented as its own view controller OVER THE WINDOW — it
 * is not a child of the screen's view — while Expo Router's native stack keeps
 * /cash-flow MOUNTED underneath everything pushed on top of it. So the sheet
 * stayed up over every subsequent route. In the 2026-09-06 Release capture on
 * the founder's account, nine consecutive screens (/cash-flow,
 * /budget-dashboard, /job-costing, /wip-report, /reports, /tax-1099-export,
 * /aia-pay-app, /change-order, /payment-predictions) all rendered the identical
 * "Cash Flow Setup 1/4" sheet: eight money screens the user never saw, and
 * eight the audit could not inspect.
 *
 * WHY IT IS A ROUTER TEST AND NOT A UNIT TEST. Nothing about the wizard's own
 * code is wrong. The defect only exists in the relationship between a native
 * modal and a stack that does not unmount what it pushes past — which means
 * the only honest test is one that mounts the real screen in the real router
 * and then navigates away from it.
 *
 * The load-bearing assertion is the PAIR in the second case: after the push,
 * the cash-flow screen is still mounted (its own copy is still in the tree)
 * and the sheet is nevertheless gone, and the pushed screen's own copy is
 * there. Without that pair the test would also pass if react-navigation simply
 * unmounted the screen under test, which is exactly the thing it does not do
 * on device.
 *
 * DO NOT WRAP `testRouter.push` / `testRouter.back` IN `act`. They already
 * call `act` internally and then assert the resulting pathname. Nesting them
 * inside another `act` defers the effect that drains expo-router's
 * `routingQueue` (imperative-api.tsx `useImperativeApiEmitter`) until the
 * OUTER act exits — so the navigation has not happened yet when the inner
 * assertion runs. The first version of this file did exactly that and failed
 * with `Expected: "/budget-dashboard" / Received: "/cash-flow"`; worse, the
 * un-drained action then leaked into the NEXT test's fresh navigation
 * container and blew it up with "The action 'PUSH' … was not handled by any
 * navigator" from inside `renderRouter`, which reads like a missing route and
 * is not one. /budget-dashboard is a real route (app/budget-dashboard.tsx,
 * registered at app/_layout.tsx:864).
 */

import { testRouter } from 'expo-router/testing-library';
import { fireEvent } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';

/** Every string rendered anywhere in the tree, sheet included. */
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

/** Rendered by CashFlowSetup's header — present only while the sheet is up. */
const SHEET_MARKER = 'Cash Flow Setup';
/** Rendered by the cash-flow screen's own FeatureHeader — present while the
 *  screen is mounted, whether or not it is the screen on top. */
const SCREEN_MARKER = 'When will money come in?';
/** Rendered by /budget-dashboard's own body (app/budget-dashboard.tsx:204) —
 *  the screen the capture shows being pushed under the sheet. Pushed without a
 *  projectId, so what it shows is its project picker; that is still its own
 *  copy and nothing else in the tree renders it. */
const PUSHED_MARKER = 'Budget Dashboard tracks earned value (CPI / SPI) for one project at a time.';
/** CashFlowSetup step titles. Step 0 is what a fresh open shows; step 1 is
 *  where the round-trip below leaves the wizard. */
const STEP_0_TITLE = 'Current Bank Balance';
const STEP_1_TITLE = 'Recurring Expenses';

describe('cash flow — a native sheet is dismissed when the screen is not the one on top', () => {
  it('auto-opens the setup wizard on a fresh account (the premise of the bug)', async () => {
    // Neither world state seeds `mage_cashflow_setup_complete`
    // (utils/cashFlowStorage.ts:5), so `isSetupComplete()` is false and the
    // wizard auto-opens — the same state the 2026-09-06 capture was taken in,
    // where Summary's CASH · 4WK tile rendered "—".
    await primeWorld('populated');
    const tree = await mountRouteChecked('/cash-flow');
    const text = collectText(tree.toJSON()).join(' ');
    expect(text).toContain(SCREEN_MARKER);
    expect(text).toContain(SHEET_MARKER);
  });

  it('drops the sheet when another route is pushed on top, with the screen still mounted', async () => {
    await primeWorld('populated');
    const tree = await mountRouteChecked('/cash-flow');
    expect(collectText(tree.toJSON()).join(' ')).toContain(SHEET_MARKER);

    // A push, not a replace: this is the notification-tap / deep-link shape
    // that reaches a mounted screen from underneath, and the one the capture
    // hit. /budget-dashboard is the screenshot that followed /cash-flow.
    testRouter.push('/budget-dashboard');
    await settle();

    const after = collectText(tree.toJSON()).join(' ');
    // The screen underneath is still mounted — so this is really testing the
    // focus gate and not an unmount.
    expect(after).toContain(SCREEN_MARKER);
    // The pushed screen did render — it is the thing the sheet was hiding.
    expect(after).toContain(PUSHED_MARKER);
    // …and the sheet is gone, so what was pushed is actually visible.
    expect(after).not.toContain(SHEET_MARKER);
  });

  it('re-presents the sheet when the user comes back, at the step and with the numbers they left', async () => {
    await primeWorld('populated');
    const tree = await mountRouteChecked('/cash-flow');

    // Get the wizard off its first step and put a number in it, so that
    // "preserved" means something. Asserting "1/4" after a round-trip would
    // pass just as well if the wizard had remounted from scratch — it opens on
    // 1/4 — which is not the claim being made.
    fireEvent.changeText(tree.getByTestId('starting-balance-input'), '48250');
    fireEvent.press(tree.getByText('Continue'));
    await settle();
    const midway = collectText(tree.toJSON()).join(' ');
    expect(midway).toContain(STEP_1_TITLE);
    expect(midway).not.toContain(STEP_0_TITLE);

    testRouter.push('/budget-dashboard');
    await settle();
    expect(collectText(tree.toJSON()).join(' ')).not.toContain(SHEET_MARKER);

    testRouter.back();
    await settle();

    const back = collectText(tree.toJSON()).join(' ');
    expect(back).toContain(SHEET_MARKER);
    // The step survived: focus flips `visible`, it does not unmount the wizard
    // or clear `showSetup`, so a user mid-onboarding does not restart.
    expect(back).toContain(STEP_1_TITLE);
    expect(back).not.toContain(STEP_0_TITLE);

    // …and so did what they typed. Step back inside the wizard to read it.
    fireEvent.press(tree.getByText('Back'));
    await settle();
    expect(tree.getByTestId('starting-balance-input').props.value).toBe('48250');
  });
});
