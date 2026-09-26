/**
 * GlideDots (slick-3, lane B) — the stretching step indicator.
 *
 *  1. AT REST it renders the same host tree as the inline dots it replaced in
 *     app/onboarding.tsx (compared with styles flattened and handlers dropped,
 *     the golden dump's own rules).
 *  2. Under Reduce Motion an `active` change mounts no pill (the instant swap).
 *  3. Otherwise an `active` change mounts exactly ONE extra absolute child: the
 *     pill, hidden from accessibility and touches.
 *
 * Reduce Motion is read through components/ui/motion's two exports
 * (reducedMotion / useReducedMotion), mocked here to a switch the test flips —
 * the same answer the app-wide store gives when the OS says on or off.
 */

import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { render } from '@testing-library/react-native';
import GlideDots from '@/components/animations/GlideDots';

let mockReduced = false;
jest.mock('@/components/ui/motion', () => ({
  ...jest.requireActual('@/components/ui/motion'),
  reducedMotion: () => mockReduced,
  useReducedMotion: () => mockReduced,
}));

// onboarding.tsx's pip styles, verbatim.
const styles = StyleSheet.create({
  pipRow: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginTop: 14 },
  pip: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(244,239,230,0.22)' },
  pipActive: { backgroundColor: '#F4EFE6', width: 18 },
});
const COUNT = 5;

function Dots({ active }: { active: number }) {
  return (
    <GlideDots
      count={COUNT}
      active={active}
      dotW={6}
      activeW={18}
      height={6}
      gap={6}
      color="rgba(244,239,230,0.22)"
      activeColor="#F4EFE6"
      style={styles.pipRow}
      dotStyle={styles.pip}
      activeStyle={styles.pipActive}
    />
  );
}
/** Today's inline pips (app/onboarding.tsx before lane B). */
function Inline({ active }: { active: number }) {
  return (
    <View style={styles.pipRow}>
      {Array.from({ length: COUNT }, (_, i) => (
        <View key={i} style={[styles.pip, i === active && styles.pipActive]} />
      ))}
    </View>
  );
}

type Node = { type: string; props: Record<string, unknown>; children: Node[] | null };
/** The golden dump's rules: styles flattened, handlers and undefined dropped. */
function norm(node: unknown): unknown {
  if (node == null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(norm);
  const el = node as Node;
  const props: Record<string, unknown> = {};
  for (const k of Object.keys(el.props ?? {}).sort()) {
    const v = el.props[k];
    if (v === undefined || typeof v === 'function') continue;
    props[k] = /style$/i.test(k) ? StyleSheet.flatten(v as StyleProp<ViewStyle>) : v;
  }
  return { type: el.type, props, children: el.children ? el.children.map(norm) : null };
}

// ONE test on purpose: in this harness a second `it` that renders GlideDots
// after the first one's cleanup never commits its first render (the stray
// render then runs after the environment is torn down). Inside one test,
// with each tree unmounted explicitly, every render commits.
describe('GlideDots', () => {
  it('at rest = the inline dots; Reduce Motion = no pill; a change = exactly one pill', () => {
    // 1. At rest: the same host tree as today's inline dots.
    mockReduced = false;
    for (const active of [0, 2, COUNT - 1]) {
      const a = render(<Dots active={active} />);
      const b = render(<Inline active={active} />);
      expect(norm(a.toJSON())).toEqual(norm(b.toJSON()));
      a.unmount();
      b.unmount();
    }

    // 2. Under Reduce Motion a change mounts no pill: the instant swap.
    mockReduced = true;
    const reduced = render(<Dots active={0} />);
    reduced.rerender(<Dots active={1} />);
    expect((reduced.toJSON() as unknown as Node).children).toHaveLength(COUNT);
    const inline1 = render(<Inline active={1} />);
    expect(norm(reduced.toJSON())).toEqual(norm(inline1.toJSON()));
    reduced.unmount();
    inline1.unmount();

    // 3. Otherwise a change mounts exactly ONE extra absolute child: the pill.
    mockReduced = false;
    const r = render(<Dots active={0} />);
    expect((r.toJSON() as unknown as Node).children).toHaveLength(COUNT);
    r.rerender(<Dots active={1} />);
    const row = r.toJSON() as unknown as Node;
    expect(row.children).toHaveLength(COUNT + 1);
    const pill = row.children![COUNT];
    const style = StyleSheet.flatten(pill.props.style as StyleProp<ViewStyle>) as Record<string, unknown>;
    expect(style.position).toBe('absolute');
    expect(style.width).toBe(18);
    expect(style.backgroundColor).toBe('#F4EFE6');
    expect(pill.props.pointerEvents).toBe('none');
    expect(pill.props.importantForAccessibility).toBe('no-hide-descendants');
    // While it flies, every dot paints the inactive colour (the new active dot
    // keeps its width).
    const dots = row.children!.slice(0, COUNT).map((d) => StyleSheet.flatten(d.props.style as StyleProp<ViewStyle>) as Record<string, unknown>);
    expect(dots.every((d) => d.backgroundColor === 'rgba(244,239,230,0.22)')).toBe(true);
    expect(dots[1].width).toBe(18);
    r.unmount();
  });
});
