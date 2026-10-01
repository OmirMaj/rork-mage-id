/**
 * Smoke: a slide's result outlives its sheet (moments, P1, 2026-10-01).
 *
 * The founder: "it just slides and no pop up screen comes up to confirm it".
 * The capsule's result pill lives inside the sheet, and the sheet closes after
 * the result hold, so the confirmation went away with it. SlideToConfirm now
 * says every result it hands over in the app-wide toast (sayCommitResult).
 *
 * THE PROMISES THIS PROVES
 *   - A confirmed slide in a sheet leaves a visible toast (the green check,
 *     the confirmed title) after the sheet has closed, with ONE success buzz.
 *   - A queued answer is the neutral clock toast with the slide's words,
 *     never the green check and never a success buzz.
 *   - A refused answer that lands after the slide is gone says the reason in
 *     the error toast; a timeout says its message in the neutral alert toast;
 *     a late confirmed answer after "No answer yet" gets the green check.
 *   - While the write is in flight the approve sheet cannot be dismissed (the
 *     X, the scrim, Android back / Esc), nor the reflow modal (X, Cancel,
 *     back); once a refusal is in, it can again.
 *
 * Every smoke case uses only modules that existed before this change (the
 * slide, the sheet, the toast host), so each one fails on the old code. The
 * sayCommitResult table is required inside its test.
 */
import React, { useState } from 'react';
import { AccessibilityInfo, Alert, Modal, Pressable } from 'react-native';
import { act, configure, fireEvent, render } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { NailItToastHost } from '@/components/animations/NailItToast';
import { SlideToConfirm } from '@/components/moments/SlideToConfirm';
import { COApproveSheet } from '@/components/moments-sites/COApproveSheet';
import { COScheduleReflowPreviewModal } from '@/components/schedule/COScheduleReflowPreviewModal';
import type { CommitResult } from '@/utils/moments/commitResult';
import type { ChangeOrder, ProjectSchedule } from '@/types';

configure({ defaultIncludeHiddenElements: true });

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
function Shell({ children }: { children: React.ReactNode }) {
  return <SafeAreaProvider initialMetrics={METRICS}><ThemeProvider>{children}</ThemeProvider></SafeAreaProvider>;
}

jest.mock('react-native-gesture-handler', () => {
  const actual = jest.requireActual('react-native-gesture-handler');
  return { ...actual, PanGestureHandler: (props: { children: React.ReactNode }) => props.children };
});

// The approve write is the only thing shaped (the sheet and the reflow slide mount bare).
const mockApprove = jest.fn();
jest.mock('@/contexts/ProjectContext', () => {
  const actual = jest.requireActual('@/contexts/ProjectContext');
  const bare = { approveChangeOrder: (...a: unknown[]) => mockApprove(...a) };
  return { ...actual, useProjectCrossActions: () => bare };
});

jest.useFakeTimers();

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  mockApprove.mockReset();
  (Haptics.notificationAsync as jest.Mock).mockClear();
  (AccessibilityInfo.isScreenReaderEnabled as jest.Mock).mockImplementation(() => Promise.resolve(true));
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => { alertSpy.mockRestore(); });

async function advance(ms: number) {
  await act(async () => { await jest.advanceTimersByTimeAsync(ms); });
}

type Q = ReturnType<typeof render>;

/** The slide's screen-reader Confirm: activate the rail, then press Confirm. */
async function srConfirm(u: Q, tid: string) {
  fireEvent(u.getByTestId(`${tid}-track`), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 358, height: 64 } } });
  await advance(20);
  await act(async () => {
    fireEvent(u.getByTestId(`${tid}-rail`), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
  });
  await advance(300);
  fireEvent.press(u.getByTestId(`${tid}-confirm`));
}

/** Steps the clock until `gone()` holds (at most `ms`), so a toast is read the moment its sheet closes. */
async function until(gone: () => boolean, ms = 6000) {
  for (let t = 0; t < ms && !gone(); t += 50) await advance(50);
}

const successBuzzes = () => (Haptics.notificationAsync as jest.Mock).mock.calls
  .filter((c) => c[0] === Haptics.NotificationFeedbackType.Success).length;

const CO = {
  id: 'co-4', number: 4, projectId: 'p1', status: 'submitted', description: 'Add a pantry',
  changeAmount: 4200, lineItems: [], createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z',
} as unknown as ChangeOrder;

/** The approve sheet as a screen hosts it: it closes itself through onClose; the toast host sits at the root. */
function ApproveHost({ onCloseSpy }: { onCloseSpy?: jest.Mock }) {
  const [open, setOpen] = useState(true);
  return (
    <Shell>
      <COApproveSheet
        visible={open}
        changeOrder={CO}
        coNumber={4}
        title="Approve CO #4?"
        moneyLine="This commits $4,200.00 to the contract."
        contractAfterCents={5240000}
        onClose={() => { onCloseSpy?.(); setOpen(false); }}
      />
      <NailItToastHost />
    </Shell>
  );
}

describe('the result outlives the sheet', () => {
  test('confirmed: after the sheet closes, the green check toast says the confirmed title (one success buzz)', async () => {
    mockApprove.mockResolvedValue('synced');
    const u = render(<ApproveHost />);
    await advance(10);
    await srConfirm(u, 'co-approve-slide');
    await until(() => u.queryByTestId('co-approve-slide') === null);
    // The sheet is gone, and the answer is still on screen.
    expect(u.queryByTestId('co-approve-slide')).toBeNull();
    expect(u.getByText('CO #4 approved · contract $52,400.00')).toBeTruthy();
    expect(u.getByTestId('nailit-toast-icon-success')).toBeTruthy();
    // The capsule buzzed success at the check; the toast after the hold is quiet.
    expect(successBuzzes()).toBe(1);
    expect(alertSpy).not.toHaveBeenCalled();
    u.unmount();
  });

  test('queued: the neutral clock toast with the slide\'s words, never the green check', async () => {
    mockApprove.mockResolvedValue('queued');
    const u = render(<ApproveHost />);
    await advance(10);
    await srConfirm(u, 'co-approve-slide');
    await until(() => u.queryByTestId('co-approve-slide') === null);
    expect(u.queryByTestId('co-approve-slide')).toBeNull();
    expect(u.getByText('Approved on this phone · sends when online')).toBeTruthy();
    expect(u.getByTestId('nailit-toast-icon-clock')).toBeTruthy();
    expect(u.queryByTestId('nailit-toast-icon-success')).toBeNull();
    expect(successBuzzes()).toBe(0);
    u.unmount();
  });
});

/** A bare slide whose host can take it off screen mid-write (a screen that navigated away). */
function BareHost({ onCommit, onLateResult }: { onCommit: () => Promise<CommitResult>; onLateResult?: (r: CommitResult) => void }) {
  const [shown, setShown] = useState(true);
  return (
    <Shell>
      {shown ? (
        <SlideToConfirm
          label="Slide to approve · +$4,200.00"
          busyLabel="Approving…"
          srLabel="Approve, $4,200.00"
          srConfirm="Confirm approve · +$4,200.00"
          onCommit={onCommit}
          writeOptions={{ idempotent: false, copy: { refused: 'Not approved. Something went wrong on our side.', timeout: 'No answer yet. Check CO #4 before trying again.' } }}
          onLateResult={onLateResult}
          testID="slide"
        />
      ) : null}
      <Pressable testID="hide" onPress={() => setShown(false)} />
      <NailItToastHost />
    </Shell>
  );
}

describe('a result that lands after the slide is gone', () => {
  test('refused: the error toast says the reason', async () => {
    let answer: (r: CommitResult) => void = () => {};
    const u = render(<BareHost onCommit={() => new Promise<CommitResult>((res) => { answer = res; })} />);
    await advance(10);
    await srConfirm(u, 'slide');
    await advance(200);
    fireEvent.press(u.getByTestId('hide'));
    await advance(10);
    expect(u.queryByTestId('slide')).toBeNull();
    await act(async () => { answer({ status: 'refused', reason: 'Not approved. The client already declined CO #4.' }); });
    await advance(50);
    expect(u.getByText('Not approved. The client already declined CO #4.')).toBeTruthy();
    expect(u.getByTestId('nailit-toast-icon-error')).toBeTruthy();
    u.unmount();
  });

  test('timeout: the neutral alert toast says "No answer yet", never green', async () => {
    const u = render(<BareHost onCommit={() => new Promise<CommitResult>(() => {})} />);
    await advance(10);
    await srConfirm(u, 'slide');
    await advance(200);
    fireEvent.press(u.getByTestId('hide'));
    await advance(21000);
    expect(u.getByText('No answer yet. Check CO #4 before trying again.')).toBeTruthy();
    expect(u.getByTestId('nailit-toast-icon-alert')).toBeTruthy();
    expect(u.queryByTestId('nailit-toast-icon-success')).toBeNull();
    u.unmount();
  });

  test('a late confirmed answer after "No answer yet": the host hears it first, then the green check', async () => {
    let answer: (r: CommitResult) => void = () => {};
    const order: string[] = [];
    const u = render(
      <BareHost
        onCommit={() => new Promise<CommitResult>((res) => { answer = res; })}
        onLateResult={() => { order.push(u.queryByText('CO #4 approved · contract $52,400.00') ? 'toast' : 'host'); }}
      />,
    );
    await advance(10);
    await srConfirm(u, 'slide');
    await advance(22000);
    expect(u.getByTestId('slide-reason').props.children).toBe('No answer yet. Check CO #4 before trying again.');
    await act(async () => { answer({ status: 'confirmed', title: 'CO #4 approved · contract $52,400.00' }); });
    await advance(50);
    expect(order).toEqual(['host']);
    expect(u.getByText('CO #4 approved · contract $52,400.00')).toBeTruthy();
    expect(u.getByTestId('nailit-toast-icon-success')).toBeTruthy();
    u.unmount();
  });
});

describe('the sheet holds while the write is in flight', () => {
  test('the approve sheet: no X, no scrim, no back while busy; a refusal lets it go again', async () => {
    let answer: (o: 'synced' | 'queued' | 'failed') => void = () => {};
    mockApprove.mockImplementation(() => new Promise((res) => { answer = res; }));
    const onClose = jest.fn();
    const u = render(<ApproveHost onCloseSpy={onClose} />);
    await advance(10);
    await srConfirm(u, 'co-approve-slide');
    await advance(200);
    expect(mockApprove).toHaveBeenCalledTimes(1);
    fireEvent.press(u.getByTestId('co-approve-sheet-close'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.press(u.getByTestId('co-approve-sheet-backdrop'));
    expect(onClose).not.toHaveBeenCalled();
    act(() => { u.UNSAFE_getByType(Modal).props.onRequestClose(); });
    expect(onClose).not.toHaveBeenCalled();
    expect(u.getByTestId('co-approve-slide')).toBeTruthy();
    // The answer is a refusal: the reason line, and the sheet can be closed again.
    await act(async () => { answer('failed'); });
    await advance(2000);
    expect(u.getByTestId('co-approve-slide-reason').props.children).toBe('Not approved. Something went wrong on our side.');
    fireEvent.press(u.getByTestId('co-approve-sheet-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    u.unmount();
  });

  test('the reflow modal: the X, Cancel and back do nothing while its slide\'s write runs', async () => {
    let answer: (o: 'synced' | 'queued' | 'failed') => void = () => {};
    mockApprove.mockImplementation(() => new Promise((res) => { answer = res; }));
    const onClose = jest.fn();
    const co = { ...CO, scheduleImpactDays: 3, scheduleImpactTaskIds: ['a'] } as ChangeOrder;
    const u = render(
      <Shell>
        <COScheduleReflowPreviewModal
          visible changeOrder={co} schedule={SCHEDULE} onConfirm={jest.fn()} onClose={onClose}
          approveSlide={{ coNumber: 4, contractAfterCents: 5240000 }}
        />
      </Shell>,
    );
    await advance(10);
    await srConfirm(u, 'co-reflow-slide');
    await advance(200);
    expect(mockApprove).toHaveBeenCalledTimes(1);
    fireEvent.press(u.getByTestId('co-reflow-cancel'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.press(u.getByLabelText('Close'));
    expect(onClose).not.toHaveBeenCalled();
    act(() => { u.UNSAFE_getByType(Modal).props.onRequestClose(); });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { answer('failed'); });
    await advance(2000);
    fireEvent.press(u.getByTestId('co-reflow-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    u.unmount();
  });
});

describe('sayCommitResult', () => {
  test('confirmed is the only green check; queued and timeout are neutral; refused says the reason; quiet plays no buzz', async () => {
    // Required here: the module is new, and the smoke cases above must run (and fail) without it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sayCommitResult } = require('@/utils/moments/sayResult') as typeof import('@/utils/moments/sayResult');
    const u = render(<Shell><NailItToastHost /></Shell>);
    await advance(10);
    const say = async (r: CommitResult, quiet = false) => {
      (Haptics.notificationAsync as jest.Mock).mockClear();
      await act(async () => { sayCommitResult(r, { quiet }); });
      await advance(20);
    };
    await say({ status: 'confirmed', title: 'Paid in full · Balance $0.00' });
    expect(u.getByText('Paid in full · Balance $0.00')).toBeTruthy();
    expect(u.getByTestId('nailit-toast-icon-success')).toBeTruthy();
    await advance(500); // outside the 400 ms de-dupe window
    await say({ status: 'confirmed', title: 'Clocked out · 8 h 12 min' }, true);
    expect(u.getByText('Clocked out · 8 h 12 min')).toBeTruthy();
    expect(successBuzzes()).toBe(0);
    await say({ status: 'queued' });
    expect(u.getByText('Saved on this phone · sends when online')).toBeTruthy();
    expect(u.getByTestId('nailit-toast-icon-clock')).toBeTruthy();
    expect(u.queryByTestId('nailit-toast-icon-success')).toBeNull();
    await say({ status: 'refused', reason: 'Not recorded. Something went wrong on our side.' });
    expect(u.getByText('Not recorded. Something went wrong on our side.')).toBeTruthy();
    expect(u.getByTestId('nailit-toast-icon-error')).toBeTruthy();
    await say({ status: 'timeout', message: 'No answer yet. Check invoice #12 before trying again.' });
    expect(u.getByText('No answer yet. Check invoice #12 before trying again.')).toBeTruthy();
    expect(u.getByTestId('nailit-toast-icon-alert')).toBeTruthy();
    expect(successBuzzes()).toBe(0);
    u.unmount();
  });
});

const SCHEDULE = {
  id: 's1', name: 'Pantry schedule', projectId: 'p1', startDate: '2026-09-14', workingDaysPerWeek: 7, bufferDays: 0,
  tasks: [
    { id: 'a', title: 'Frame pantry', phase: 'Framing', startDay: 1, durationDays: 5, dependencies: [], progress: 0, crew: '', notes: '', status: 'not_started' },
    { id: 'b', title: 'Drywall', phase: 'Finishes', startDay: 6, durationDays: 4, dependencies: ['a'], progress: 0, crew: '', notes: '', status: 'not_started' },
  ],
  totalDurationDays: 9, criticalPathDays: 9, laborAlignmentScore: 0, riskItems: [],
} as unknown as ProjectSchedule;
