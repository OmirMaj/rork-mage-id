/**
 * UX wave, Lane C (C7) — "Date paid" is picked, never typed.
 *
 * RecordPaymentModal's date is now a DatePickerModal: the field opens the
 * picker, the picker refuses a future day, and the workers' comp notice
 * (`notice(paidOn)`) re-reads the day the picker hands back. This replaces
 * sub-pay-wc-warning's "re-reads when the date changes" case, which typed
 * into the old YYYY-MM-DD TextInput (that field no longer exists).
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/contexts/ThemeContext';
import RecordPaymentModal from '@/components/RecordPaymentModal';
import { toCalendarDayString } from '@/utils/calendarDate';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
function Wrapper({ children }: { children: React.ReactNode }) {
  return <SafeAreaProvider initialMetrics={METRICS}><ThemeProvider>{children}</ThemeProvider></SafeAreaProvider>;
}

const WARN = 'The workers’ comp certificate on file does not cover that day. You can still record this payment.';

describe('C7 — Date paid comes from the picker', () => {
  it('has no typed date field, and the notice re-reads the picked day', async () => {
    const today = toCalendarDayString(new Date());
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yesterday = toCalendarDayString(y);
    const onSubmit = jest.fn();
    render(
      <Wrapper>
        <RecordPaymentModal
          visible
          title="Invoice #7"
          initial={{ paidOn: today }}
          onCancel={() => {}}
          onSubmit={onSubmit}
          notice={(d: string) => (d === yesterday ? WARN : null)}
        />
      </Wrapper>,
    );
    await act(async () => { for (let k = 0; k < 10; k++) await Promise.resolve(); });

    expect(screen.queryByPlaceholderText('YYYY-MM-DD')).toBeNull();
    expect(screen.queryByTestId('insaudit-pay-warning')).toBeNull();

    await act(async () => { fireEvent.press(screen.getByTestId('payment-date-input')); });
    await act(async () => { fireEvent.press(screen.getByText('Yesterday')); });
    await act(async () => { fireEvent.press(screen.getByText(/^Use /)); });

    expect(screen.getByTestId('insaudit-pay-warning')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('payment-save')); });
    expect(onSubmit.mock.calls[0][0]).toEqual({ method: 'check', reference: '', paidOn: yesterday });
  });

  it('refuses a future day the wheels can still reach, and keeps paidOn on today', async () => {
    // Without allowFuture the picker only caps the YEAR, so a later month of
    // this year is still on the Month wheel. The modal itself must refuse it.
    const now = new Date();
    const today = toCalendarDayString(now);
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    if (now.getMonth() === 11 && now.getDate() === lastDay) return; // Dec 31: nothing later is pickable
    const onSubmit = jest.fn();
    render(
      <Wrapper>
        <RecordPaymentModal visible title="Invoice #7" initial={{ paidOn: today }} onCancel={() => {}} onSubmit={onSubmit} />
      </Wrapper>,
    );
    await act(async () => { for (let k = 0; k < 10; k++) await Promise.resolve(); });
    expect(screen.queryByTestId('payment-date-future')).toBeNull();

    await act(async () => { fireEvent.press(screen.getByTestId('payment-date-input')); });
    await act(async () => { fireEvent.press(screen.getByText('Today')); });
    if (now.getMonth() < 11) {
      await act(async () => { fireEvent.press(screen.getByText(MONTHS[now.getMonth() + 1])); });
    } else {
      await act(async () => { fireEvent.press(screen.getByText(String(lastDay))); });
    }
    await act(async () => { fireEvent.press(screen.getByText(/^Use /)); });

    expect(screen.getByTestId('payment-date-future')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('payment-save')); });
    expect(onSubmit.mock.calls[0][0]).toEqual({ method: 'check', reference: '', paidOn: today });
  });
});
