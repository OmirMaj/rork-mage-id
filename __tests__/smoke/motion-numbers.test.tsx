/**
 * Smoke — numbers that count and bars that glide (slicker pass, lane B:
 * TapeRollNumber/useCountTo, AnimatedFill, CollapseChevron).
 *
 * THE PROMISE THIS PROVES: at rest nothing changes. The first render shows the
 * real value (no count from 0); a fill and a chevron serialize exactly like the
 * plain leaf / icon they replace until their value changes after mount; a fill
 * pinned at 100% never arms; Reduce Motion makes every change a jump.
 */

import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react-native';

let mockReduced = false;
jest.mock('@/components/ui/motion', () => {
  const actual = jest.requireActual('@/components/ui/motion');
  return {
    ...actual,
    reducedMotion: () => mockReduced,
    useReducedMotion: () => mockReduced,
  };
});
jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
    useTheme: () => value,
  };
});

import TapeRollNumber, { useCountTo, COUNT_MS } from '@/components/animations/TapeRollNumber';
import { AnimatedFill, FILL_MS } from '@/components/animations/AnimatedFill';
import { CollapseChevron } from '@/components/animations/CollapseChevron';

// A hand-driven requestAnimationFrame: each `frame(ms)` runs the queued
// callbacks at the given clock.
let rafQueue: { id: number; cb: (t: number) => void }[] = [];
let rafId = 0;
let now = 0;
const realRaf = global.requestAnimationFrame;
const realCaf = global.cancelAnimationFrame;
function installRaf() {
  rafQueue = [];
  now = 0;
  (global as any).requestAnimationFrame = (cb: (t: number) => void) => {
    rafId += 1;
    rafQueue.push({ id: rafId, cb });
    return rafId;
  };
  (global as any).cancelAnimationFrame = (id: number) => {
    rafQueue = rafQueue.filter((f) => f.id !== id);
  };
}
function frame(at: number) {
  now = at;
  const q = rafQueue;
  rafQueue = [];
  act(() => { q.forEach((f) => f.cb(now)); });
}

// Animated's own frames (RN's jest requestAnimationFrame is a setTimeout) stay
// on fake timers, so nothing renders after a test (or the file) has ended.
beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => {
  act(() => { jest.runOnlyPendingTimers(); });
  jest.useRealTimers();
  mockReduced = false;
  (global as any).requestAnimationFrame = realRaf;
  (global as any).cancelAnimationFrame = realCaf;
});

const pctFmt = (n: number) => String(Math.round(n));
function Probe({ value, format = pctFmt }: { value: number; format?: (n: number) => string }) {
  const shown = useCountTo(value, format);
  return <Text testID="probe">{shown}</Text>;
}
const textOf = (r: ReturnType<typeof render>) => r.getByTestId('probe').props.children as string;

describe('useCountTo', () => {
  it('shows the real value on the first render (no count from 0)', () => {
    installRaf();
    const r = render(<Probe value={62} />);
    expect(textOf(r)).toBe('62');
    expect(rafQueue).toHaveLength(0);
  });

  it('counts from the shown number to the new one, ending exactly on format(value)', () => {
    installRaf();
    const r = render(<Probe value={20} />);
    r.rerender(<Probe value={80} />);
    // The frame that carries the new value still shows the old number.
    expect(textOf(r)).toBe('20');
    frame(1000);                     // t = 0 (start)
    frame(1000 + COUNT_MS / 2);      // midway, ease-out: past half
    const mid = Number(textOf(r));
    expect(mid).toBeGreaterThan(50);
    expect(mid).toBeLessThan(80);
    frame(1000 + COUNT_MS);          // done
    expect(textOf(r)).toBe('80');
    expect(rafQueue).toHaveLength(0);
  });

  it('retargets from the number on screen when the value changes mid-count', () => {
    installRaf();
    const r = render(<Probe value={0} />);
    r.rerender(<Probe value={100} />);
    frame(0);
    frame(COUNT_MS / 2);
    const mid = Number(textOf(r));
    r.rerender(<Probe value={10} />);
    expect(Number(textOf(r))).toBe(mid);
    frame(1000);
    frame(1000 + COUNT_MS);
    expect(textOf(r)).toBe('10');
  });

  it('jumps under Reduce Motion', () => {
    installRaf();
    mockReduced = true;
    const r = render(<Probe value={20} />);
    r.rerender(<Probe value={80} />);
    expect(textOf(r)).toBe('80');
    expect(rafQueue).toHaveLength(0);
  });

  it('jumps when requestAnimationFrame is missing', () => {
    (global as any).requestAnimationFrame = undefined;
    const r = render(<Probe value={20} />);
    r.rerender(<Probe value={80} />);
    expect(textOf(r)).toBe('80');
  });

  it('cancels the frame loop on unmount', () => {
    installRaf();
    const r = render(<Probe value={20} />);
    r.rerender(<Probe value={80} />);
    expect(rafQueue.length).toBeGreaterThan(0);
    r.unmount();
    expect(rafQueue).toHaveLength(0);
  });
});

describe('TapeRollNumber', () => {
  it('mounts on the real formatted value', () => {
    installRaf();
    const r = render(<TapeRollNumber value={1234} prefix="$" testID="tape" />);
    expect(r.getByText('$1,234')).toBeTruthy();
    expect(r.queryByText('$0')).toBeNull();
  });

  it('names the final number for a screen reader while counting', () => {
    installRaf();
    const fmt = (n: number) => `$${Math.round(n)}`;
    const r = render(<TapeRollNumber value={100} formatter={fmt} />);
    expect(r.getByText('$100').props.accessibilityLabel).toBeUndefined();
    r.rerender(<TapeRollNumber value={500} formatter={fmt} />);
    expect(r.getByText('$100').props.accessibilityLabel).toBe('$500');
    frame(0);
    frame(COUNT_MS);
    expect(r.getByText('$500').props.accessibilityLabel).toBeUndefined();
  });
});

const s = StyleSheet.create({ fill: { height: 6, backgroundColor: '#123', borderRadius: 3 } });
const hasTransform = (json: unknown) => JSON.stringify(json).includes('scaleX');

// The fill and chevron cases compare several trees per test. RNTL's render()
// queues an un-awaited async unmount per tree for cleanup(), and several of
// those overlap and leave React's act scope open for the rest of the file, so
// these trees go straight through react-test-renderer, each unmounted at once.
// react-test-renderer ships no types here; this is the slice the tests use.
type RawRenderer = { update: (el: React.ReactElement) => void; toJSON: () => unknown; unmount: () => void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require('react-test-renderer') as { create: (el: React.ReactElement) => RawRenderer };
type Tree = { update: (el: React.ReactElement) => void; json: () => unknown; unmount: () => void };
function mount(el: React.ReactElement): Tree {
  let r: RawRenderer | undefined;
  act(() => { r = TestRenderer.create(el); });
  const t = r!;
  return {
    update: (next) => act(() => { t.update(next); }),
    json: () => t.toJSON(),
    unmount: () => act(() => { t.unmount(); }),
  };
}
function once(el: React.ReactElement): unknown {
  const t = mount(el);
  const j = t.json();
  t.unmount();
  return j;
}

describe('AnimatedFill', () => {
  it('serializes identically to the plain leaf at rest', () => {
    expect(once(<AnimatedFill value={40} style={[s.fill, { width: '40%' }]} testID="f" />))
      .toEqual(once(<View style={[s.fill, { width: '40%' }]} testID="f" />));
    expect(once(<AnimatedFill value={40} style={{ width: '40%', height: 6 }} />))
      .toEqual(once(<View style={{ width: '40%', height: 6 }} />));
  });

  it('arms a scaleX glide on a change after mount', () => {
    const t = mount(<AnimatedFill value={40} style={[s.fill, { width: '40%' }]} />);
    expect(hasTransform(t.json())).toBe(false);
    t.update(<AnimatedFill value={80} style={[s.fill, { width: '80%' }]} />);
    const json = JSON.stringify(t.json());
    expect(json).toContain('scaleX');
    expect(json).toContain('"transformOrigin":"left"');
    expect(FILL_MS).toBeLessThanOrEqual(360);
    t.unmount();
  });

  it('does not arm when the clamped value is unchanged (120 → 150)', () => {
    const t = mount(<AnimatedFill value={120} style={[s.fill, { width: '100%' }]} />);
    t.update(<AnimatedFill value={150} style={[s.fill, { width: '100%' }]} />);
    expect(hasTransform(t.json())).toBe(false);
    t.unmount();
  });

  it('does not arm on a change to 0, nor under Reduce Motion', () => {
    const t = mount(<AnimatedFill value={40} style={[s.fill, { width: '40%' }]} />);
    t.update(<AnimatedFill value={0} style={[s.fill, { width: '0%' }]} />);
    expect(hasTransform(t.json())).toBe(false);
    t.unmount();
    mockReduced = true;
    const q = mount(<AnimatedFill value={40} style={[s.fill, { width: '40%' }]} />);
    q.update(<AnimatedFill value={80} style={[s.fill, { width: '80%' }]} />);
    expect(hasTransform(q.json())).toBe(false);
    q.unmount();
  });
});

describe('CollapseChevron', () => {
  const props = { size: 16, color: '#555', strokeWidth: 1.75 };
  it('serializes identically to the icon swap at rest', () => {
    expect(once(<CollapseChevron open {...props} />)).toEqual(once(<ChevronDown {...props} />));
    expect(once(<CollapseChevron open={false} {...props} />)).toEqual(once(<ChevronRight {...props} />));
    expect(once(<CollapseChevron pair="downUp" open {...props} />)).toEqual(once(<ChevronUp {...props} />));
    expect(once(<CollapseChevron pair="downUp" open={false} {...props} />)).toEqual(once(<ChevronDown {...props} />));
    // strokeWidth is passed only when given.
    expect(once(<CollapseChevron open size={14} color="#555" />)).toEqual(once(<ChevronDown size={14} color="#555" />));
  });

  it('rotates one chevron after the first toggle', () => {
    const t = mount(<CollapseChevron open {...props} />);
    t.update(<CollapseChevron open={false} {...props} />);
    expect(JSON.stringify(t.json())).toContain('rotate');
    // Still one chevron: the rotated ChevronDown, not a swapped icon.
    t.unmount();
  });

  it('keeps the icon swap under Reduce Motion', () => {
    mockReduced = true;
    const t = mount(<CollapseChevron open {...props} />);
    t.update(<CollapseChevron open={false} {...props} />);
    const j = t.json();
    t.unmount();
    expect(j).toEqual(once(<ChevronRight {...props} />));
  });
});
