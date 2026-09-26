/**
 * Smoke — the loader's platform gate (lane L, "Topping Out").
 *
 * THE PROMISE THIS PROVES: on iOS/Android `CraneSvg` renders ToppingOutMark
 * (plain Views, no SVG); on the web it renders the SVG crane and never the
 * mark; the gate is read at RENDER (Platform.OS flipped at runtime is
 * honoured); `animate={false}` is the static finished tower; Reduce Motion
 * pulses the wrapper and moves nothing; ConstructionLoader 'lg' follows the
 * same gate while 'md' keeps its SVG.
 */

import React from 'react';
import { Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { render } from '@testing-library/react-native';
import Svg from 'react-native-svg';
import { CraneSvg } from '@/components/CraneLoader';
import ConstructionLoader from '@/components/ConstructionLoader';
import ToppingOutMark from '@/components/loaders/ToppingOutMark';

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

let restoreOS: (() => void) | null = null;
afterEach(() => {
  restoreOS?.();
  restoreOS = null;
  mockReduce = false;
});
const asWeb = () => { restoreOS = jest.replaceProperty(Platform, 'OS', 'web').restore; };
// The mark is decorative (hidden from screen readers), so queries must opt in.
const H = { includeHiddenElements: true } as const;
const flat = (s: unknown) => (StyleSheet.flatten(s as StyleProp<ViewStyle>) ?? {}) as Record<string, unknown>;

describe('CraneSvg platform gate', () => {
  it('iOS renders the Topping Out mark and no Svg, in the crane box', () => {
    const r = render(<CraneSvg size={288} />);
    const mark = r.getByTestId('topping-out-mark', H);
    expect(r.UNSAFE_queryAllByType(Svg)).toHaveLength(0);
    const st = flat(mark.props.style);
    expect(st.width).toBe(288);
    expect(st.height).toBeCloseTo((288 * 300) / 340, 6);
    expect(mark.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(mark.props.accessibilityElementsHidden).toBe(true);
    r.unmount();
  });

  it('web (Platform.OS flipped at runtime) renders the Svg crane and no mark', () => {
    asWeb();
    const r = render(<CraneSvg size={288} />);
    expect(r.UNSAFE_queryAllByType(Svg).length).toBeGreaterThan(0);
    expect(r.queryByTestId('topping-out-mark', H)).toBeNull();
    r.unmount();
  });

  it('animate={false} renders the static finished tower (every floor opacity 1, no transform)', () => {
    const r = render(<CraneSvg size={180} animate={false} />);
    const mark = r.getByTestId('topping-out-mark', H);
    const floors = r.getAllByTestId(/^topping-out-mark-floor-/, H);
    expect(floors).toHaveLength(5);
    for (const f of floors) {
      const st = flat(f.props.style);
      expect(st.opacity).toBe(1);
      expect(st.transform).toBeUndefined();
    }
    expect(flat(mark.props.style).opacity).toBeUndefined();
    r.unmount();
  });

  it('animating: every floor carries an animated opacity + translateY only', () => {
    const r = render(<ToppingOutMark size={288} />);
    const floors = r.getAllByTestId(/^topping-out-mark-floor-/, H);
    expect(floors).toHaveLength(5);
    for (const f of floors) {
      const st = flat(f.props.style);
      expect(typeof st.opacity).toBe('number'); // the host sees the current animated value
      expect(Array.isArray(st.transform)).toBe(true);
      expect(Object.keys((st.transform as object[])[0])).toEqual(['translateY']);
    }
    r.unmount();
  });

  it('Reduce Motion: floors are static, only the wrapper opacity pulses', () => {
    mockReduce = true;
    const r = render(<ToppingOutMark size={288} />);
    const mark = r.getByTestId('topping-out-mark', H);
    expect(typeof flat(mark.props.style).opacity).toBe('number');
    const floors = r.getAllByTestId(/^topping-out-mark-floor-/, H);
    for (const f of floors) {
      const st = flat(f.props.style);
      expect(st.opacity).toBe(1);
      expect(st.transform).toBeUndefined();
    }
    r.unmount();
  });
});

describe("ConstructionLoader 'lg'", () => {
  it('native lg renders the mark inside the labelled container', () => {
    const r = render(<ConstructionLoader size="lg" label="Loading bid details..." />);
    expect(r.getByTestId('topping-out-mark', H)).toBeTruthy();
    expect(r.UNSAFE_queryAllByType(Svg)).toHaveLength(0);
    expect(r.getByTestId('construction-loader').props.accessibilityLabel).toBe('Loading bid details...');
    expect(r.getByText('Loading bid details...')).toBeTruthy();
    r.unmount();
  });

  it('native md keeps the SVG house', () => {
    const r = render(<ConstructionLoader size="md" />);
    expect(r.queryByTestId('topping-out-mark', H)).toBeNull();
    expect(r.UNSAFE_queryAllByType(Svg).length).toBeGreaterThan(0);
    r.unmount();
  });

  it('web lg keeps the SVG house', () => {
    asWeb();
    const r = render(<ConstructionLoader size="lg" />);
    expect(r.queryByTestId('topping-out-mark', H)).toBeNull();
    expect(r.UNSAFE_queryAllByType(Svg).length).toBeGreaterThan(0);
    r.unmount();
  });
});
