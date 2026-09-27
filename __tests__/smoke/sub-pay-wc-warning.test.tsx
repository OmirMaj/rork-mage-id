/**
 * List-3 lane FA — the workers' comp heads-up in the sub pay sheet.
 *
 * RecordPaymentModal takes an optional `notice(paidOn)`. When it returns text
 * for the date on screen, a warning block ('insaudit-pay-warning', an alert)
 * sits above the buttons — and the payment still records exactly as before.
 * It re-reads as the date is edited. No notice prop, or a notice returning
 * null, renders no block at all.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/contexts/ThemeContext';
import RecordPaymentModal from '@/components/RecordPaymentModal';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
function Wrapper({ children }: { children: React.ReactNode }) {
  return <SafeAreaProvider initialMetrics={METRICS}><ThemeProvider>{children}</ThemeProvider></SafeAreaProvider>;
}

const WARN = 'Acme Framing’s workers’ comp certificate on file doesn’t cover Jul 1, 2026. You can still record this payment.';

async function mount(props: Partial<React.ComponentProps<typeof RecordPaymentModal>>) {
  const onSubmit = jest.fn();
  const onSkip = jest.fn();
  render(
    <Wrapper>
      <RecordPaymentModal visible title="Invoice #7" amountLabel="$1,200.00" initial={{ paidOn: '2026-07-01' }} onCancel={() => {}} onSubmit={onSubmit} onSkip={onSkip} {...props} />
    </Wrapper>,
  );
  await act(async () => { for (let k = 0; k < 10; k++) await Promise.resolve(); });
  return { onSubmit, onSkip };
}

describe('sub pay sheet — workers’ comp warning', () => {
  it('shows the notice for the date on screen, and the payment still records', async () => {
    const notice = jest.fn((d: string) => (d === '2026-07-01' ? WARN : null));
    const { onSubmit, onSkip } = await mount({ notice });
    const block = screen.getByTestId('insaudit-pay-warning');
    expect(block.props.accessibilityRole).toBe('alert');
    expect(screen.getByText(WARN)).toBeTruthy();
    expect(notice).toHaveBeenCalledWith('2026-07-01');

    await act(async () => { fireEvent.press(screen.getByTestId('payment-save')); });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual({ method: 'check', reference: '', paidOn: '2026-07-01' });

    await act(async () => { fireEvent.press(screen.getByTestId('payment-skip')); });
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  // 're-reads when the date changes' moved to ux-lane-c-pay-date case 1: UX
  // wave C7 replaced the typed date field with a picker, and the re-read is
  // proven through the picker there.

  it('a notice returning null draws nothing', async () => {
    const { onSubmit } = await mount({ notice: () => null });
    expect(screen.queryByTestId('insaudit-pay-warning')).toBeNull();
    await act(async () => { fireEvent.press(screen.getByTestId('payment-save')); });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('no notice prop draws nothing', async () => {
    await mount({});
    expect(screen.queryByTestId('insaudit-pay-warning')).toBeNull();
  });
});
