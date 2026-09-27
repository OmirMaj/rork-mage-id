/**
 * Smoke — honest long waits (loader lane CONTENT-B). Assertions, no snapshot.
 *
 * THE PROMISES THIS PROVES:
 *  - WorkProgress: a real elapsed clock ("0:14" at 14 s); a determinate rule
 *    ONLY with a real count, drawn as scaleX from the left (12 of 48 → 0.25);
 *    done → the summary holds 600 ms, then onDone; native → The Level at 64,
 *    never the crane; web → the crane at min(width·0.5, 280) from 120 up, the
 *    level at 64 below.
 *  - CodeCheckLoader: a timer-driven `activeStep` never ticks anything (the
 *    list reads "What we check"); a real stepIndex does; native → ONE loop;
 *    web → no Animated loop at all (CSS keyframes); Reduce Motion → a static
 *    sheet.
 */

import React from 'react';
import { Animated, Dimensions, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { act, cleanupAsync, render } from '@testing-library/react-native';
import WorkProgress from '@/components/loaders/WorkProgress';
import CodeCheckLoader from '@/components/CodeCheckLoader';

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
    useTheme: () => value,
  };
});

let mockReduce = false;
jest.mock('@/components/ui/motion', () => {
  const actual = jest.requireActual('@/components/ui/motion');
  return { ...actual, useReducedMotion: () => mockReduce };
});

const STEPS = ['Reading your scope', 'Recalling the codes that apply', 'Matching trades', 'Noting local amendments', 'Writing it up'] as const;

describe('honest long waits', () => {
  // Several renders per test: drain RNTL's unmount queue sequentially (see
  // loader-platform.test.tsx for why the harness's sync cleanup is not enough).
  let restoreOS: (() => void) | null = null;
  let savedDims: { window: ReturnType<typeof Dimensions.get>; screen: ReturnType<typeof Dimensions.get> } | null = null;
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(async () => {
    restoreOS?.();
    restoreOS = null;
    mockReduce = false;
    if (savedDims) (Dimensions as unknown as { set: (x: object) => void }).set(savedDims);
    savedDims = null;
    jest.restoreAllMocks();
    jest.useRealTimers();
    await cleanupAsync();
  });
  const asWeb = () => { restoreOS = jest.replaceProperty(Platform, 'OS', 'web').restore; };
  const windowOf = (width: number, height = 800) => {
    savedDims = savedDims ?? { window: Dimensions.get('window'), screen: Dimensions.get('screen') };
    const d = { width, height, scale: 2, fontScale: 1 };
    act(() => { (Dimensions as unknown as { set: (x: object) => void }).set({ window: d, screen: d }); });
  };
  const H = { includeHiddenElements: true } as const;
  const flat = (s: unknown) => (StyleSheet.flatten(s as StyleProp<ViewStyle>) ?? {}) as Record<string, unknown>;
  const advance = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });

  describe('WorkProgress', () => {
    it('a real elapsed clock: "0:14 · usually 60–90 s" at 14 s; the title never rotates', () => {
      const r = render(<WorkProgress title="Reading the spec book" typical="usually 60–90 s" facts={['a', 'b', 'c']} />);
      expect(r.getByTestId('work-progress-elapsed').props.children).toBe('0:00 · usually 60–90 s');
      advance(14000);
      expect(r.getByTestId('work-progress-elapsed').props.children).toBe('0:14 · usually 60–90 s');
      expect(r.getByTestId('work-progress-title').props.children).toBe('Reading the spec book');
      advance(60000);
      expect(r.getByTestId('work-progress-title').props.children).toBe('Reading the spec book');
      expect(r.getByTestId('work-progress-elapsed').props.children).toBe('1:14 · usually 60–90 s');
      r.unmount();
    });

    it('no count → no rule; count 12 of 48 → a scaleX 0.25 fill from the left, "12 of 48 pages"', () => {
      const a = render(<WorkProgress title="Rendering pages" />);
      expect(a.queryByTestId('work-progress-fill')).toBeNull();
      expect(a.queryByText(/ of /)).toBeNull();
      a.unmount();
      const b = render(<WorkProgress title="Rendering pages" count={{ done: 12, total: 48, unit: 'pages' }} />);
      const st = flat(b.getByTestId('work-progress-fill').props.style);
      expect(st.transform).toEqual([{ scaleX: 0.25 }]);
      expect(st.transformOrigin).toBe('left');
      expect(st.width).toBeUndefined();
      expect(b.getByText('12 of 48 pages')).toBeTruthy();
      const bar = b.getByRole('progressbar');
      expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 48, now: 12 });
      b.unmount();
    });

    it('done → the summary replaces the title, holds 600 ms, then onDone (once)', () => {
      const onDone = jest.fn();
      const r = render(<WorkProgress title="Reading the spec book" summary="Read 48 pages in 1:12" onDone={onDone} />);
      advance(5000);
      r.rerender(<WorkProgress title="Reading the spec book" summary="Read 48 pages in 1:12" onDone={onDone} done />);
      expect(r.getByTestId('work-progress-title').props.children).toBe('Read 48 pages in 1:12');
      advance(599);
      expect(onDone).not.toHaveBeenCalled();
      advance(1);
      expect(onDone).toHaveBeenCalledTimes(1);
      advance(5000);
      expect(onDone).toHaveBeenCalledTimes(1);
      // The elapsed clock froze at done.
      expect(r.getByTestId('work-progress-elapsed').props.children).toBe('0:05');
      r.unmount();
    });

    it('Cancel and the background link render only when passed', () => {
      const a = render(<WorkProgress title="Comparing sheets" />);
      expect(a.queryByTestId('work-progress-cancel')).toBeNull();
      expect(a.queryByTestId('work-progress-background')).toBeNull();
      a.unmount();
      const b = render(<WorkProgress title="Comparing sheets" onCancel={() => {}} onBackground={() => {}} />);
      expect(b.getByTestId('work-progress-cancel')).toBeTruthy();
      expect(b.getByTestId('work-progress-background')).toBeTruthy();
      b.unmount();
    });

    it('real steps: done ticks with a duration, one current level, next rings', () => {
      const r = render(
        <WorkProgress
          title="Reading spec sections"
          steps={[
            { label: 'Rendering pages', state: 'done', tookMs: 1200 },
            { label: 'Reading spec sections', state: 'current' },
            { label: 'Drafting the log', state: 'next' },
          ]}
        />,
      );
      expect(r.getAllByTestId('progress-step-tick', H)).toHaveLength(1);
      expect(r.getByText('1.2 s')).toBeTruthy();
      expect(r.getAllByTestId('progress-step-current', H)).toHaveLength(1);
      expect(r.getAllByTestId('progress-step-next', H)).toHaveLength(1);
      r.unmount();
    });

    it('native: a 64-wide level and never the crane', () => {
      windowOf(1280);
      const r = render(<WorkProgress title="Reading the spec book" />);
      const mark = r.getByTestId('level-mark', H);
      expect(flat(mark.props.style).width).toBe(64);
      expect(r.queryByTestId('crane-svg', H)).toBeNull();
      expect(r.queryByTestId('crane-mark-web', H)).toBeNull();
      r.unmount();
    });

    it('web 1280 wide: the crane in a 280 × 247.1 box and no 64 level; 200 wide: the level at 64, no crane', () => {
      asWeb();
      windowOf(1280);
      const a = render(<WorkProgress title="Reading the spec book" />);
      const crane = a.getByTestId('crane-mark-web', H);
      // The box, whether CraneMarkWeb draws an Svg (width/height props) or the
      // WEB lane's composited divs (a width/height style).
      const box = { ...flat(crane.props.style), ...(crane.props.width != null ? { width: crane.props.width, height: crane.props.height } : null) };
      expect(box.width).toBe(280);
      expect(box.height as number).toBeCloseTo((280 * 300) / 340, 1);
      expect(a.queryAllByTestId('level-mark', H).filter((n) => flat(n.props.style).width === 64)).toHaveLength(0);
      a.unmount();
      windowOf(200);
      const b = render(<WorkProgress title="Reading the spec book" />);
      expect(b.queryByTestId('crane-mark-web', H)).toBeNull();
      expect(b.queryByTestId('crane-svg', H)).toBeNull();
      expect(flat(b.getByTestId('level-mark', H).props.style).width).toBe(64);
      b.unmount();
    });
  });

  describe('CodeCheckLoader', () => {
    it('a timer-driven activeStep never ticks anything; the list reads "What we check"', () => {
      const r = render(<CodeCheckLoader steps={STEPS} activeStep={0} />);
      for (let s = 0; s <= 5; s++) {
        r.rerender(<CodeCheckLoader steps={STEPS} activeStep={s} />);
        expect(r.queryAllByTestId('progress-step-tick', H)).toHaveLength(0);
        expect(r.queryAllByTestId('progress-step-current', H)).toHaveLength(0);
        expect(r.getAllByTestId('progress-step-neutral', H)).toHaveLength(STEPS.length);
        expect(r.getByTestId('code-check-steps-header').props.children).toBe('What we check');
      }
      expect(r.getByText('Recalling the code that likely governs this job')).toBeTruthy();
      r.unmount();
    });

    it('elapsed under the headline: "0:07 · usually 5–20 s"', () => {
      const r = render(<CodeCheckLoader steps={STEPS} activeStep={0} />);
      advance(7000);
      expect(r.getByTestId('code-check-elapsed').props.children).toBe('0:07 · usually 5–20 s');
      r.unmount();
    });

    it('a real stepIndex 2 → two ticks, one current row, the rest next; no neutral header', () => {
      const r = render(<CodeCheckLoader steps={STEPS} activeStep={4} stepIndex={2} />);
      expect(r.getAllByTestId('progress-step-tick', H)).toHaveLength(2);
      expect(r.getAllByTestId('progress-step-current', H)).toHaveLength(1);
      expect(r.getAllByTestId('progress-step-next', H)).toHaveLength(2);
      expect(r.queryByTestId('code-check-steps-header')).toBeNull();
      r.unmount();
    });

    it('native: exactly one loop starts (the laser), marks and laser render', () => {
      const loop = jest.spyOn(Animated, 'loop');
      const r = render(<CodeCheckLoader steps={STEPS} activeStep={0} />);
      expect(loop).toHaveBeenCalledTimes(1);
      expect(r.getByTestId('code-check-laser', H)).toBeTruthy();
      expect(r.getAllByTestId(/^code-check-mark-/, H)).toHaveLength(5);
      // Every mark and the laser start dark (t = 0 is the seam).
      for (const m of r.getAllByTestId(/^code-check-mark-/, H)) expect(flat(m.props.style).opacity).toBe(0);
      expect(flat(r.getByTestId('code-check-laser', H).props.style).opacity).toBe(0);
      r.unmount();
    });

    it('web: no Animated loop at all — the laser and marks are CSS classes', () => {
      asWeb();
      const loop = jest.spyOn(Animated, 'loop');
      const r = render(<CodeCheckLoader steps={STEPS} activeStep={0} />);
      expect(loop).not.toHaveBeenCalled();
      const laser = flat(r.getByTestId('code-check-laser', H).props.style) as Record<string, unknown>;
      expect(laser.animationDuration).toBe('3000ms');
      expect(laser.animationFillMode).toBe('backwards');
      expect(laser.opacity).toBeUndefined();
      r.unmount();
    });

    it('Reduce Motion: a static sheet — no loop, no laser, no marks', () => {
      mockReduce = true;
      const loop = jest.spyOn(Animated, 'loop');
      const r = render(<CodeCheckLoader steps={STEPS} activeStep={0} />);
      expect(loop).not.toHaveBeenCalled();
      expect(r.queryByTestId('code-check-laser', H)).toBeNull();
      expect(r.queryAllByTestId(/^code-check-mark-/, H)).toHaveLength(0);
      r.unmount();
    });
  });
});
