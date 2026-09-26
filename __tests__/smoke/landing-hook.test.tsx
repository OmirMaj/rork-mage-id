/**
 * Slick round 3, lane C — useLanding / LandingSlot (components/animations/Landing.tsx).
 *
 * The clock here is a STEPPED spy (never a constant): each case moves Date.now
 * by hand to put the loading phase under or over LANDING_MIN_LOADING_MS.
 * Reduce Motion is driven through the OS listener motion.ts registers.
 */

import React from 'react';
import { AccessibilityInfo, Platform, StyleSheet, Text, type ViewStyle } from 'react-native';
import { act, render, renderHook } from '@testing-library/react-native';
import {
  LandingSlot,
  LANDING_MIN_LOADING_MS,
  LANDING_WINDOW_MS,
  useLanding,
} from '@/components/animations/Landing';
import { reducedMotion } from '@/components/ui/motion';

let reduceListener: ((v: boolean) => void) | null = null;
jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(false));
jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((event: string, fn: (v: boolean) => void) => {
  if (event === 'reduceMotionChanged') reduceListener = fn;
  return { remove() {} };
}) as unknown as typeof AccessibilityInfo.addEventListener);

let now = 1_000_000;
let nowSpy: jest.SpyInstance;
beforeEach(() => {
  now = 1_000_000;
  nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => {
  nowSpy.mockRestore();
});

async function flush() {
  await act(async () => { for (let k = 0; k < 10; k++) await Promise.resolve(); });
}

function mount(loading: boolean) {
  return renderHook(({ l }: { l: boolean }) => useLanding(l), { initialProps: { l: loading } });
}

/** loading true → (ms) → false. */
function handOver(ms: number) {
  const h = mount(true);
  now += ms;
  h.rerender({ l: false });
  return h;
}

describe('useLanding', () => {
  it('mounted with loading=false: nothing, ever', () => {
    const h = mount(false);
    expect(h.result.current.fade).toBeNull();
    expect(h.result.current.row(0)).toBeNull();
    h.unmount();
  });

  it('a loading phase under the threshold stays unarmed', () => {
    const h = handOver(50);
    expect(h.result.current.fade).toBeNull();
    expect(h.result.current.row(0)).toBeNull();
    h.unmount();
  });

  it('a loading phase over the threshold arms once: fade, six rows, stable objects', () => {
    const h = handOver(200);
    const { fade, row } = h.result.current;
    expect(fade).not.toBeNull();
    expect(StyleSheet.flatten(fade as ViewStyle)).toHaveProperty('opacity');
    const rows = [0, 1, 2, 3, 4, 5].map((i) => row(i));
    rows.forEach((r) => expect(r).not.toBeNull());
    expect(row(6)).toBeNull();
    // Native: each row rises as well as fades.
    expect((rows[0] as { transform?: unknown }).transform).toBeDefined();

    h.rerender({ l: false });
    expect(h.result.current.row).toBe(row);
    expect(h.result.current.row(0)).toBe(rows[0]);
    expect(h.result.current.fade).toBe(fade);

    // A refetch flips loading again: no replay, the same objects come back.
    h.rerender({ l: true });
    now += 500;
    h.rerender({ l: false });
    expect(h.result.current.fade).toBe(fade);
    expect(h.result.current.row(0)).toBe(rows[0]);
    expect(h.result.current.row(5)).toBe(rows[5]);
    expect(h.result.current.row(6)).toBeNull();
    h.unmount();
  });

  it('exactly the threshold arms', () => {
    const h = handOver(LANDING_MIN_LOADING_MS);
    expect(h.result.current.fade).not.toBeNull();
    h.unmount();
  });

  it('one millisecond under the threshold does not', () => {
    const h = handOver(LANDING_MIN_LOADING_MS - 1);
    expect(h.result.current.fade).toBeNull();
    h.unmount();
  });

  it('a row first asked for after the landing window never animates', () => {
    const h = handOver(200);
    expect(h.result.current.row(0)).not.toBeNull();
    now += LANDING_WINDOW_MS + 1;
    expect(h.result.current.row(1)).toBeNull();
    expect(h.result.current.row(1)).toBeNull();
    h.unmount();
  });

  it('a row already on screen before the hand-off never animates', () => {
    const h = mount(true);
    expect(h.result.current.row(0)).toBeNull();
    now += 200;
    h.rerender({ l: false });
    expect(h.result.current.fade).not.toBeNull();
    expect(h.result.current.row(0)).toBeNull();
    expect(h.result.current.row(1)).not.toBeNull();
    h.unmount();
  });

  it('web rows fade only: no transform', () => {
    const restore = jest.replaceProperty(Platform, 'OS', 'web').restore;
    try {
      const h = handOver(200);
      const r = h.result.current.row(0) as { opacity?: unknown; transform?: unknown };
      expect(r).not.toBeNull();
      expect(r.opacity).toBeDefined();
      expect(r.transform).toBeUndefined();
      h.unmount();
    } finally {
      restore();
    }
  });

  it('Reduce Motion: the same sequence stays unarmed', async () => {
    expect(reducedMotion()).toBe(false);
    expect(reduceListener).not.toBeNull();
    await act(async () => { reduceListener?.(true); });
    await flush();
    expect(reducedMotion()).toBe(true);
    try {
      const h = handOver(200);
      expect(h.result.current.fade).toBeNull();
      expect(h.result.current.row(0)).toBeNull();
      h.unmount();
    } finally {
      await act(async () => { reduceListener?.(false); });
    }
    expect(reducedMotion()).toBe(false);
  });
});

function Probe({ loading }: { loading: boolean }) {
  const { fade, row } = useLanding(loading);
  return (
    <LandingSlot style={fade} fill>
      <Text>root</Text>
      {/* Like the real lists: rows exist only once loading is over. */}
      {!loading && <LandingSlot style={row(0)}><Text>row</Text></LandingSlot>}
    </LandingSlot>
  );
}

describe('LandingSlot', () => {
  it('unarmed: the children alone, no wrapper', () => {
    const r = render(<Probe loading={false} />);
    const json = r.toJSON() as { type: string }[];
    // Two bare Text hosts: neither slot added a node.
    expect(Array.isArray(json)).toBe(true);
    expect(json.map((n) => n.type)).toEqual(['Text', 'Text']);
    r.unmount();
  });

  it('armed: the root wrapper fills (flex: 1), the row wrapper does not', () => {
    const r = render(<Probe loading />);
    now += 200;
    r.rerender(<Probe loading={false} />);
    const root = r.toJSON() as { type: string; props: { style: unknown }; children: { type: string; props: { style: unknown } }[] };
    expect(root.type).toBe('View');
    expect(StyleSheet.flatten(root.props.style as ViewStyle)).toMatchObject({ flex: 1 });
    const rowWrap = root.children[1];
    expect(rowWrap.type).toBe('View');
    expect(StyleSheet.flatten(rowWrap.props.style as ViewStyle)).not.toHaveProperty('flex');
    r.unmount();
  });
});
