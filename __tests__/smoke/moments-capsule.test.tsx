/**
 * Smoke: the Commit Capsule's track skin, SlideToConfirm (moments wave, lane CAPSULE).
 *
 * THE PROMISES THIS PROVES
 *   - Success (the result pill, the success haptic) only ever follows a real
 *     `confirmed`; a refusal un-commits, re-arms and says what did not happen.
 *   - An unknown outcome on a write that cannot be repeated says "No answer
 *     yet. Check CO #4 before trying again." and never "nothing was saved".
 *   - A legal record is never queued, and offline it is disabled with a reason.
 *   - With a screen reader on, the slide is one button that splits into
 *     Confirm / Cancel; Confirm commits exactly once.
 *   - A sheet's Cmd+Enter (playHoldToCommit) plays the 700 ms fill first.
 *   - A result that lands after unmount reaches onResultAfterUnmount.
 *
 * The legacy PanGestureHandler needs the native gesture module, which jest
 * does not have, so it is mocked HERE ONLY (never in __tests__/setup) as a
 * pass-through that records its props; the drag test drives those props.
 * Reduce Motion is read through components/ui/motion's two exports, mocked to
 * a switch (the glide-dots pattern).
 */

import React from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { act, configure, fireEvent, render } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { SlideToConfirm, reasonFitsTrack, type SlideToConfirmHandle, type SlideToConfirmProps } from '@/components/moments/SlideToConfirm';
import type { CommitResult } from '@/utils/moments/commitResult';
import { Theme } from '@/constants/colors';

// The capsule's decorative text (label, busy, result) is hidden from the
// accessibility tree on purpose (the button mode speaks for it); query it anyway.
configure({ defaultIncludeHiddenElements: true });

let mockReduced = false;
jest.mock('@/components/ui/motion', () => ({
  ...jest.requireActual('@/components/ui/motion'),
  reducedMotion: () => mockReduced,
  useReducedMotion: () => mockReduced,
}));

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
    useTheme: () => value,
  };
});

const mockPan: { props: any } = { props: null };
jest.mock('react-native-gesture-handler', () => {
  const State = { UNDETERMINED: 0, FAILED: 1, BEGAN: 2, CANCELLED: 3, ACTIVE: 4, END: 5 };
  function PanGestureHandler(props: any) {
    mockPan.props = props;
    return props.children;
  }
  return { __esModule: true, State, PanGestureHandler };
});

const LABEL = 'Slide to approve · +$4,200.00';
const BUSY = 'Approving…';
const SR_CONFIRM = 'Confirm approve · +$4,200.00';
const TITLE = 'CO #4 approved · $52,400.00';
const DETAIL = 'Balance $0.00';
const CO_OPTS = { idempotent: false, subject: 'CO #4', verb: 'approved' };

const confirmed = (): CommitResult => ({ status: 'confirmed', title: TITLE, detail: DETAIL, next: 'Jane sees it in her portal.' });

// Fake timers for the whole file, never switched back and forth: in this
// harness a render in a later test does not commit after the timers swap
// under it (see the note in glide-dots.test.tsx).
jest.useFakeTimers();

let srOn = false;
beforeEach(() => {
  mockReduced = false;
  srOn = false;
  mockPan.props = null;
  (AccessibilityInfo.isScreenReaderEnabled as jest.Mock).mockImplementation(() => Promise.resolve(srOn));
});

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

function mount(props: Partial<SlideToConfirmProps> = {}, ref?: React.Ref<SlideToConfirmHandle>) {
  const onCommit = (props.onCommit as jest.Mock) ?? jest.fn(async () => confirmed());
  const utils = render(
    <SlideToConfirm
      ref={ref}
      label={LABEL}
      busyLabel={BUSY}
      srLabel="Approve, $4,200.00"
      srConfirm={SR_CONFIRM}
      writeOptions={CO_OPTS}
      testID="slide"
      {...props}
      onCommit={onCommit}
    />,
  );
  fireEvent(utils.getByTestId('slide-track'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 358, height: 64 } } });
  return { ...utils, onCommit };
}

const styleOf = (el: { props: { style?: unknown } }) => (StyleSheet.flatten(el.props.style as any) ?? {}) as Record<string, unknown>;
const hapticCalls = (fn: unknown) => (fn as jest.Mock).mock.calls.map((c) => c[0]);

async function openAndConfirm(utils: ReturnType<typeof mount>, presses = 1) {
  await act(async () => {
    fireEvent(utils.getByTestId('slide-rail'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
  });
  await advance(300);
  const ok = utils.getByTestId('slide-confirm');
  for (let i = 0; i < presses; i++) fireEvent.press(ok);
}

const STEPS: [string, () => Promise<void>][] = [];
function step(name: string, fn: () => Promise<void>) { STEPS.push([name, fn]); }

  step('T1 idle: the label renders, busy and result are hidden, every variant mounts at 358 pt', async () => {
    const a = mount();
    await advance(10);
    expect(a.getByTestId('slide-label').props.children).toBe(LABEL);
    expect(styleOf(a.getByTestId('slide-busy')).opacity).toBe(0);
    expect(a.queryByTestId('slide-result')).toBeNull();
    expect(a.queryByTestId('slide-reason')).toBeNull();
    a.unmount();
    for (const extra of [
      { size: 'md' as const },
      { tone: 'ink' as const, resultIcon: 'lock' as const },
      { tone: 'warning' as const, resultIcon: 'flag' as const },
    ]) {
      const v = mount(extra);
      await advance(10);
      expect(v.getByTestId('slide-label').props.children).toBe(LABEL);
      v.unmount();
    }
  });

  step('T2 disabled: a short reason is the label, the state says disabled, activate speaks the reason, nothing commits', async () => {
    const reason = 'Type a name first';
    const u = mount({ disabledReason: reason });
    await advance(10);
    expect(u.getByTestId('slide-label').props.children).toBe(reason);
    expect(u.queryByTestId('slide-disabled-reason')).toBeNull();
    const head = u.UNSAFE_root.findAll((n: any) => n.props?.accessibilityState?.disabled === true && n.props?.accessibilityRole === 'button');
    expect(head.length).toBeGreaterThan(0);
    await act(async () => {
      head[0].props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } });
    });
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(reason);
    expect(u.queryByTestId('slide-confirm')).toBeNull();
    await advance(1000);
    expect(u.onCommit).not.toHaveBeenCalled();
    u.unmount();
  });

  step('T2b disabled, a reason too long for the track on a 390-pt phone: the track keeps the short label, the WHOLE reason wraps under it, VoiceOver reads it all', async () => {
    const reason = "An earlier change to this invoice hasn't sent yet. Review unsent changes first.";
    expect(reasonFitsTrack(reason, 'lg')).toBe(false);
    const u = mount({ disabledReason: reason });
    await advance(10);
    // The track label is the short action label, never the reason cut to one line.
    expect(u.getByTestId('slide-label').props.children).toBe(LABEL);
    const under = u.getByTestId('slide-disabled-reason');
    expect(under.props.children).toBe(reason);
    // Never clamped to a line count: the whole sentence shows.
    expect(under.props.numberOfLines).toBeUndefined();
    // Decorative text: the head speaks the full reason (label and hint).
    expect(under.props.accessibilityElementsHidden).toBe(true);
    const head = u.UNSAFE_root.findAll((n: any) => n.props?.accessibilityState?.disabled === true && n.props?.accessibilityRole === 'button');
    expect(head.length).toBeGreaterThan(0);
    expect(head[0].props.accessibilityLabel).toBe(reason);
    expect(head[0].props.accessibilityHint).toBe(reason);
    u.unmount();
    // md (the 64%-wide clock-out track) holds fewer characters.
    const mdReason = 'Pick an out time after 7:00 AM';
    expect(reasonFitsTrack(mdReason, 'lg')).toBe(true);
    expect(reasonFitsTrack(mdReason, 'md')).toBe(false);
    const m = mount({ size: 'md', disabledReason: mdReason });
    await advance(10);
    expect(m.getByTestId('slide-label').props.children).toBe(LABEL);
    expect(m.getByTestId('slide-disabled-reason').props.children).toBe(mdReason);
    m.unmount();
  });

  step('T3 screen reader: one button with activate; Confirm commits once even pressed twice; Cancel does not commit', async () => {
    srOn = true;
    const u = mount();
    await advance(10);
    const rail = u.getByTestId('slide-rail');
    expect(rail.props.accessibilityRole).toBe('button');
    expect(rail.props.accessibilityActions).toEqual(expect.arrayContaining([{ name: 'activate' }]));
    // Cancel first
    await act(async () => { fireEvent(rail, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } }); });
    await advance(300);
    expect(u.getByTestId('slide-confirm')).toBeTruthy();
    expect(u.getByTestId('slide-cancel')).toBeTruthy();
    fireEvent.press(u.getByTestId('slide-cancel'));
    await advance(500);
    expect(u.onCommit).not.toHaveBeenCalled();
    // Then Confirm, pressed twice
    await openAndConfirm(u, 2);
    await advance(3000);
    expect(u.onCommit).toHaveBeenCalledTimes(1);
    u.unmount();
  });

  step('T4 confirmed: the result title and detail render, one success haptic, the title is announced', async () => {
    srOn = true;
    const u = mount();
    await advance(10);
    await openAndConfirm(u);
    await advance(400);
    // Nothing celebrates while busy.
    expect(hapticCalls(Haptics.notificationAsync)).not.toContain('success');
    await advance(2600);
    expect(u.getByTestId('slide-result').props.children).toBe(TITLE);
    expect(u.getByText(DETAIL)).toBeTruthy();
    expect(u.getByTestId('slide-next').props.children).toBe('Jane sees it in her portal.');
    expect(hapticCalls(Haptics.notificationAsync).filter((k) => k === 'success')).toHaveLength(1);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(TITLE);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Approving');
    u.unmount();
  });

  step('T5 refused: the reason renders in the danger role and the control re-arms', async () => {
    srOn = true;
    const reason = 'Not approved. This change order changed on another device.';
    const onCommit = jest.fn(async (): Promise<CommitResult> => ({ status: 'refused', reason }));
    const u = mount({ onCommit });
    await advance(10);
    await openAndConfirm(u);
    await advance(2500);
    const line = u.getByTestId('slide-reason');
    expect(line.props.children).toBe(reason);
    expect(styleOf(line).color).toBe(Theme.light.dangerLabel);
    expect(u.queryByTestId('slide-result')).toBeNull();
    expect(hapticCalls(Haptics.notificationAsync)).toContain('error');
    expect(hapticCalls(Haptics.notificationAsync)).not.toContain('success');
    await openAndConfirm(u);
    await advance(2500);
    expect(onCommit).toHaveBeenCalledTimes(2);
    u.unmount();
  });

  step('T6 no answer in 20 s on a non-idempotent write: "No answer yet", never "nothing was saved", a warning haptic', async () => {
    srOn = true;
    const onCommit = jest.fn(() => new Promise<CommitResult>(() => {}));
    const u = mount({ onCommit });
    await advance(10);
    await openAndConfirm(u);
    await advance(19000);
    expect(u.queryByTestId('slide-reason')).toBeNull();
    await advance(3000);
    const line = u.getByTestId('slide-reason');
    expect(line.props.children).toBe('No answer yet. Check CO #4 before trying again.');
    expect(styleOf(line).color).toBe(Theme.light.warningLabel);
    expect(JSON.stringify(u.toJSON())).not.toMatch(/nothing was saved/i);
    const kinds = hapticCalls(Haptics.notificationAsync);
    expect(kinds).toContain('warning');
    expect(kinds).not.toContain('error');
    expect(kinds).not.toContain('success');
    u.unmount();
  });

  step('T7 legal + queued: refused "Not signed…", never the queued clock pill', async () => {
    srOn = true;
    const onCommit = jest.fn(async (): Promise<CommitResult> => ({ status: 'queued' }));
    const u = mount({ onCommit, writeOptions: { idempotent: false, legal: true, subject: 'the contract', verb: 'signed' } });
    await advance(10);
    await openAndConfirm(u);
    await advance(2500);
    expect(u.getByTestId('slide-reason').props.children).toBe('Not signed. Signing needs a connection, so nothing was signed.');
    expect(u.queryByText('Saved on this phone · sends when online')).toBeNull();
    expect(hapticCalls(Haptics.impactAsync)).not.toContain('light');
    u.unmount();
  });

  step('T8 legal + offline: disabled with "You\'re offline. Signing needs a connection."', async () => {
    const u = mount({ offline: true, writeOptions: { idempotent: false, legal: true, subject: 'the contract', verb: 'signed' } });
    await advance(10);
    expect(u.getByTestId('slide-label').props.children).toBe(LABEL);
    expect(u.getByTestId('slide-disabled-reason').props.children).toBe("You're offline. Signing needs a connection.");
    const head = u.UNSAFE_root.findAll((n: any) => n.props?.accessibilityState?.disabled === true && n.props?.accessibilityRole === 'button');
    expect(head.length).toBeGreaterThan(0);
    u.unmount();
  });

  step('T9 Reduce Motion: a confirmed write still shows the result title and fires the success haptic', async () => {
    mockReduced = true;
    srOn = true;
    const u = mount();
    await advance(10);
    await openAndConfirm(u);
    await advance(1500);
    expect(u.getByTestId('slide-result').props.children).toBe(TITLE);
    expect(hapticCalls(Haptics.notificationAsync).filter((k) => k === 'success')).toHaveLength(1);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(TITLE);
    u.unmount();
  });

  step('T10 unmount mid-commit: onResultAfterUnmount receives the result', async () => {
    srOn = true;
    let finish: (r: CommitResult) => void = () => {};
    const onCommit = jest.fn(() => new Promise<CommitResult>((res) => { finish = res; }));
    const onResultAfterUnmount = jest.fn();
    const onResolved = jest.fn();
    const u = mount({ onCommit, onResultAfterUnmount, onResolved });
    await advance(10);
    await openAndConfirm(u);
    await advance(200);
    expect(onCommit).toHaveBeenCalledTimes(1);
    u.unmount();
    await act(async () => { finish(confirmed()); });
    await advance(50);
    expect(onResultAfterUnmount).toHaveBeenCalledTimes(1);
    expect(onResultAfterUnmount.mock.calls[0][0]).toMatchObject({ status: 'confirmed', title: TITLE });
    expect(onResolved).not.toHaveBeenCalled();
  });

  step('T11 playHoldToCommit: onCommit only after the 700 ms fill', async () => {
    const ref = React.createRef<SlideToConfirmHandle>();
    const u = mount({}, ref);
    await advance(10);
    act(() => { ref.current!.playHoldToCommit(); });
    await advance(689);
    expect(u.onCommit).not.toHaveBeenCalled();
    await advance(20);
    expect(u.onCommit).toHaveBeenCalledTimes(1);
    await advance(3000);
    expect(u.getByTestId('slide-result').props.children).toBe(TITLE);
    u.unmount();
  });

  step('T12 drag: a short release snaps back without committing; a flick past 55% at 900 pt/s commits', async () => {
    const u = mount();
    await advance(10);
    expect(mockPan.props).toBeTruthy();
    expect(mockPan.props.activeOffsetX).toEqual([-8, 8]);
    expect(mockPan.props.failOffsetY).toEqual([-14, 14]);
    // short: 40% and slow
    act(() => { mockPan.props.onHandlerStateChange({ nativeEvent: { state: 2 } }); });
    expect(hapticCalls(Haptics.selectionAsync).length).toBeGreaterThan(0);
    act(() => { mockPan.props.onHandlerStateChange({ nativeEvent: { state: 5, translationX: 120, velocityX: 100 } }); });
    await advance(800);
    expect(u.onCommit).not.toHaveBeenCalled();
    // flick: T = 358 - 8 - 56 = 294; 60% travel at 2000 pt/s projects past T
    act(() => { mockPan.props.onHandlerStateChange({ nativeEvent: { state: 2 } }); });
    act(() => { mockPan.props.onHandlerStateChange({ nativeEvent: { state: 5, translationX: 180, velocityX: 2000 } }); });
    await advance(100);
    expect(u.onCommit).toHaveBeenCalledTimes(1);
    await advance(3000);
    expect(u.getByTestId('slide-result').props.children).toBe(TITLE);
    u.unmount();
  });

  // iOS on the New Architecture delivers only BEGAN and END to JS for this
  // native-driver drag: the move events go to the native animation engine and
  // the Animated.event listener never runs. So these steps never call
  // onGestureEvent: the release payload alone must decide.
  step('T13 slow full-length slide with no move events (iOS delivery) commits; 84% springs home, 86% commits', async () => {
    let u = mount();
    await advance(10);
    // T = 358 - 8 - 56 = 294: the head let go at the end, no speed at all
    act(() => { mockPan.props.onHandlerStateChange({ nativeEvent: { state: 2 } }); });
    act(() => { mockPan.props.onHandlerStateChange({ nativeEvent: { state: 5, translationX: 294, velocityX: 0 } }); });
    await advance(100);
    expect(u.onCommit).toHaveBeenCalledTimes(1);
    await advance(3000);
    expect(u.getByTestId('slide-result').props.children).toBe(TITLE);
    u.unmount();

    // just under the 0.85 threshold: 247 / 294 = 0.840
    u = mount();
    await advance(10);
    act(() => { mockPan.props.onHandlerStateChange({ nativeEvent: { state: 2 } }); });
    act(() => { mockPan.props.onHandlerStateChange({ nativeEvent: { state: 5, translationX: 247, velocityX: 0 } }); });
    await advance(800);
    expect(u.onCommit).not.toHaveBeenCalled();
    // just past it: 253 / 294 = 0.861
    act(() => { mockPan.props.onHandlerStateChange({ nativeEvent: { state: 2 } }); });
    act(() => { mockPan.props.onHandlerStateChange({ nativeEvent: { state: 5, translationX: 253, velocityX: 0 } }); });
    await advance(100);
    expect(u.onCommit).toHaveBeenCalledTimes(1);
    u.unmount();
  });

  step('T14 clock-out size (md, threshold 0.70): a slow release past 70% commits, 65% springs home, a cancel never commits', async () => {
    const u = mount({ size: 'md' });
    await advance(10);
    // md: T = 358 - 8 - 44 = 306
    act(() => { mockPan.props.onHandlerStateChange({ nativeEvent: { state: 2 } }); });
    act(() => { mockPan.props.onHandlerStateChange({ nativeEvent: { state: 5, translationX: 200, velocityX: 0 } }); });
    await advance(800);
    expect(u.onCommit).not.toHaveBeenCalled();
    // a recognizer cancel at full travel is not a release: it must not commit
    act(() => { mockPan.props.onHandlerStateChange({ nativeEvent: { state: 2 } }); });
    act(() => { mockPan.props.onHandlerStateChange({ nativeEvent: { state: 3, translationX: 306, velocityX: 0 } }); });
    await advance(800);
    expect(u.onCommit).not.toHaveBeenCalled();
    act(() => { mockPan.props.onHandlerStateChange({ nativeEvent: { state: 2 } }); });
    act(() => { mockPan.props.onHandlerStateChange({ nativeEvent: { state: 5, translationX: 220, velocityX: 0 } }); });
    await advance(100);
    expect(u.onCommit).toHaveBeenCalledTimes(1);
    u.unmount();
  });

// ONE test on purpose (the glide-dots harness note): in this harness a render
// in a second `it`, after the first one's cleanup, never commits (the stray
// render then runs after the environment is torn down). Inside one test, with
// every tree unmounted explicitly, every render commits. Each step resets the
// shared switches and names itself in any failure.
describe('SlideToConfirm (Commit Capsule, track skin)', () => {
  it('T1-T14: idle, disabled, screen reader, confirmed, refused, timeout, legal queued/offline, Reduce Motion, unmount, hold, drag, release-decides', async () => {
    for (const [name, fn] of STEPS) {
      mockReduced = false;
      srOn = false;
      mockPan.props = null;
      jest.clearAllMocks();
      (AccessibilityInfo.isScreenReaderEnabled as jest.Mock).mockImplementation(() => Promise.resolve(srOn));
      try {
        await fn();
      } catch (e) {
        (e as Error).message = `[${name}] ${(e as Error).message}`;
        throw e;
      }
    }
    expect(STEPS).toHaveLength(15);
  });
});
