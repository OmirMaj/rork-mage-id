/**
 * Smoke — the front door's form motion (slick round 3, lane A2:
 * components/auth/authMotion.tsx FieldRing, AuthSubmitButton, usePressSpring).
 *
 * THE PROMISE THIS PROVES: at rest nothing changes. A button whose phase never
 * changed renders exactly the plain TouchableOpacity > Text tree the screens
 * rendered before; a ring renders nothing until its visibility or tone
 * changes. Once armed, the button keeps its label laid out and readable while
 * the spinner / check layers (hidden from accessibility) cross-fade over it.
 * Reduce Motion jumps every value — and the check still shows.
 *
 * jest runs Animated on the (mocked) native driver, so an animation never
 * moves a JS-side value here: the tests pin the STRUCTURE of each state and the
 * seeded values, and read the end values under Reduce Motion, where every
 * value is set directly. Every render is unmounted by its own test.
 */

import React from 'react';
import { StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { render } from '@testing-library/react-native';
import { AuthSubmitButton, FieldRing, type SubmitPhase } from '@/components/auth/authMotion';

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
  return { ...actual, reducedMotion: () => mockReduce, useReducedMotion: () => mockReduce };
});

afterEach(() => {
  mockReduce = false;
});


type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] | null };
const flat = (s: unknown) => (StyleSheet.flatten(s as StyleProp<ViewStyle>) ?? {}) as Record<string, unknown>;

function walk(node: unknown, visit: (n: Node, hiddenAbove: boolean) => void, hidden = false): void {
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((n) => walk(n, visit, hidden)); return; }
  const n = node as Node;
  visit(n, hidden);
  const here = hidden || n.props.accessibilityElementsHidden === true;
  (n.children ?? []).forEach((c) => walk(c, visit, here));
}
const hiddenLayers = (json: unknown) => {
  const out: Node[] = [];
  walk(json, (n) => { if (n.props.accessibilityElementsHidden === true) out.push(n); });
  return out;
};
/** The label Text: its text, and whether any ancestor hides it from a11y. */
function labelOf(json: unknown, label: string) {
  let found: { hidden: boolean } | null = null;
  walk(json, (n, hidden) => {
    if (n.type === 'Text' && (n.children ?? []).join('') === label) found = { hidden };
  });
  return found as { hidden: boolean } | null;
}

const button = (phase: SubmitPhase) => (
  <AuthSubmitButton
    phase={phase}
    label="Sign In"
    trailing={<Text>→</Text>}
    style={{ flexDirection: 'row', gap: 8, paddingVertical: 16, backgroundColor: '#0B0D10' }}
    textStyle={{ color: '#FFFFFF' }}
    spinnerColor="#FFFFFF"
    onPress={() => {}}
    disabled={phase !== 'idle'}
    activeOpacity={0.85}
    testID="auth-btn"
  />
);

describe('AuthSubmitButton', () => {
  it('mounted idle and never changed: the plain TouchableOpacity > Text tree, no layers', () => {
    const r = render(button('idle'));
    const json = r.toJSON() as unknown as Node;
    expect(hiddenLayers(json)).toHaveLength(0);
    expect(json.props.testID).toBe('auth-btn');
    // Exactly today's two children: the label Text and the trailing icon.
    const kids = (json.children ?? []) as Node[];
    expect(kids).toHaveLength(2);
    expect(kids[0].type).toBe('Text');
    expect(kids[0].children).toEqual(['Sign In']);
    r.rerender(button('idle'));
    expect(hiddenLayers(r.toJSON())).toHaveLength(0);
    r.unmount();
  });

  it('mounted loading and never changed: today\'s bare spinner', () => {
    const r = render(button('loading'));
    const json = r.toJSON() as unknown as Node;
    expect(hiddenLayers(json)).toHaveLength(0);
    expect(labelOf(json, 'Sign In')).toBeNull();
    expect(((json.children ?? []) as Node[]).map((c) => c.type)).toEqual(['ActivityIndicator']);
    r.unmount();
  });

  it('after idle → loading the layers exist and the label is still laid out and accessible', () => {
    const r = render(button('idle'));
    r.rerender(button('loading'));
    const json = r.toJSON();
    const layers = hiddenLayers(json);
    expect(layers).toHaveLength(2);
    layers.forEach((l) => {
      expect(l.props.importantForAccessibility).toBe('no-hide-descendants');
      expect(l.props.pointerEvents).toBe('none');
    });
    expect(labelOf(json, 'Sign In')).toEqual({ hidden: false });
    // The label row keeps the button's gap, so the width never moves.
    let rowGap: unknown;
    walk(json, (n) => { if ((n.children ?? []).some((c) => typeof c === 'object' && (c as Node).type === 'Text')) rowGap = flat(n.props.style).gap; });
    expect(rowGap).toBe(8);
    // Seeded from the phase being LEFT (idle), so the first armed frame is the
    // frame before it: the spinner and the check start invisible.
    const [spin, check] = layers;
    expect(flat(spin.props.style).opacity).toBe(0);
    expect(flat(check.props.style).opacity).toBe(0);
    expect(flat(check.props.style).transform).toEqual([{ scale: 0.6 }]);
    r.unmount();
  });

  it('loading → done: the check layer holds the check icon; the label stays in the tree', () => {
    const r = render(button('idle'));
    r.rerender(button('loading'));
    r.rerender(button('done'));
    const json = r.toJSON();
    const layers = hiddenLayers(json);
    expect(layers).toHaveLength(2);
    const [spin, check] = layers;
    // The spinner stops spinning once it is not loading; the check is an svg.
    const spinner = (spin.children ?? [])[0] as Node;
    expect(spinner.type).toBe('ActivityIndicator');
    expect(spinner.props.animating).toBe(false);
    let svg = false;
    walk(check, (n) => { if (/Svg/i.test(n.type)) svg = true; });
    expect(svg).toBe(true);
    expect(labelOf(json, 'Sign In')).toEqual({ hidden: false });
    r.unmount();
  });

  it('Reduce Motion: every value jumps on the change itself, and the check still shows', () => {
    mockReduce = true;
    const r = render(button('idle'));
    r.rerender(button('loading'));
    let [spin, check] = hiddenLayers(r.toJSON());
    expect(flat(spin.props.style).opacity).toBe(1);
    expect(flat(check.props.style).opacity).toBe(0);
    r.rerender(button('done'));
    [spin, check] = hiddenLayers(r.toJSON());
    expect(flat(spin.props.style).opacity).toBe(0);
    expect(flat(check.props.style).opacity).toBe(1);
    expect(flat(check.props.style).transform).toEqual([{ scale: 1 }]);
    r.unmount();
  });
});

describe('FieldRing', () => {
  const ring = (visible: boolean, tone: 'accent' | 'danger' = 'accent') => (
    <FieldRing visible={visible} tone={tone} radius={12} />
  );

  it('renders nothing at mount, and nothing after a rerender with the same props', () => {
    const r = render(ring(false));
    expect(r.toJSON()).toBeNull();
    r.rerender(ring(false));
    expect(r.toJSON()).toBeNull();
    r.unmount();
  });

  it('renders the ring once `visible` flips, seeded where it was (invisible)', () => {
    const r = render(ring(false));
    r.rerender(ring(true));
    const node = r.toJSON() as unknown as Node;
    expect(node).not.toBeNull();
    expect(node.props.pointerEvents).toBe('none');
    const s = flat(node.props.style);
    expect(s.position).toBe('absolute');
    expect(s.top).toBe(-1);
    expect(s.borderWidth).toBe(1.5);
    expect(s.borderRadius).toBe(13);
    expect(s.opacity).toBe(0);
    expect(node.props.accessibilityElementsHidden).toBe(true);
    // Once armed it stays mounted (so it can fade out), whatever `visible` is.
    r.rerender(ring(false));
    expect(r.toJSON()).not.toBeNull();
    r.unmount();
  });

  it('danger and accent are different colours, and the tone swaps at once', () => {
    const r = render(ring(false, 'accent'));
    r.rerender(ring(true, 'accent'));
    const accent = flat((r.toJSON() as unknown as Node).props.style).borderColor;
    r.rerender(ring(true, 'danger'));
    const danger = flat((r.toJSON() as unknown as Node).props.style).borderColor;
    expect(accent).toBeTruthy();
    expect(danger).toBeTruthy();
    expect(danger).not.toBe(accent);
    r.unmount();
  });

  it('a tone change alone (still not visible) arms it too', () => {
    // One root per test: a second render() in the same test left React's act
    // queue holding a mount that flushed after the environment was torn down.
    const r = render(ring(false, 'accent'));
    r.rerender(ring(false, 'danger'));
    expect(r.toJSON()).not.toBeNull();
    expect(flat((r.toJSON() as unknown as Node).props.style).opacity).toBe(0);
    r.unmount();
  });

  it('Reduce Motion: the opacity jumps both ways', () => {
    mockReduce = true;
    const r = render(ring(false));
    r.rerender(ring(true));
    expect(flat((r.toJSON() as unknown as Node).props.style).opacity).toBe(1);
    r.rerender(ring(false));
    expect(flat((r.toJSON() as unknown as Node).props.style).opacity).toBe(0);
    r.unmount();
  });
});
