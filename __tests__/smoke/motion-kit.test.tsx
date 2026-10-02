/**
 * Smoke — the motion kit (lane MOTIONKIT: components/motion/kit).
 *
 * THE PROMISES THIS PROVES (spec D2, T1–T12):
 *   T1  at rest (never armed) a part's tree equals the same children in a
 *       plain View — the golden contract;
 *   T2  every Animated.timing / spring passes useNativeDriver === nativeDriver;
 *   T3  under Reduce Motion nothing translates or scales and every timing is
 *       ≤ 100 ms;
 *   T4–T11 each part's own rule (stagger cap, thinking gate + one clock,
 *       the send glide, real partial sums, real ticks, the range, filing,
 *       the budget);
 *   T12 the gallery renders every part, light and dark;
 *   T13 a later priority change: the old rule fades out (120 ms) and unmounts;
 *       useCheckBeat(status) is the spec's ViewStyle | null.
 *
 * Under this harness a native-driven Animated value never advances (see
 * level-content.test.tsx), so `nativeDriver` is mocked to false here: the
 * kit passes the VARIABLE, so every call must then say false — a literal
 * `true` anywhere would show up in T2.
 */

import React from 'react';
import { Animated, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { act, cleanupAsync, render } from '@testing-library/react-native';

let mockReduced = false;
jest.mock('@/components/ui/motion', () => {
  const actual = jest.requireActual('@/components/ui/motion');
  return { ...actual, nativeDriver: false, reducedMotion: () => mockReduced, useReducedMotion: () => mockReduced };
});

// eslint-disable-next-line import/first
import {
  AccumulateCards, ChatTurn, CheckSync, CornerTags, CountRoll, MatrixFill, PriorityGrid, RangeSettle, StaggerList, ThinkingRow,
  dotClockStats, resetBudget, useCheckBeat, useFileInto, type CheckRow, type CheckStatus,
} from '@/components/motion/kit';
// eslint-disable-next-line import/first
import { KitGallery } from '@/components/motion/kit/__demo__/KitGallery';
// eslint-disable-next-line import/first
import { partialSums } from '@/utils/motion/kit/accumulate';

type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] | null };
const flat = (s: unknown) => (StyleSheet.flatten(s as StyleProp<ViewStyle>) ?? {}) as Record<string, unknown>;

/** The golden dump's rules: styles flattened, handlers / undefined / empty styles dropped. */
function norm(node: unknown): unknown {
  if (node == null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(norm);
  const el = node as Node;
  const props: Record<string, unknown> = {};
  for (const k of Object.keys(el.props ?? {}).sort()) {
    const v = el.props[k];
    if (v === undefined || typeof v === 'function' || k === 'collapsable') continue;
    if (/style$/i.test(k)) {
      const f = flat(v);
      if (Object.keys(f).length) props[k] = f;
      continue;
    }
    props[k] = v;
  }
  return { type: el.type, props, children: el.children ? el.children.map(norm) : null };
}

function nodes(json: unknown, out: Node[] = []): Node[] {
  if (!json || typeof json !== 'object') return out;
  if (Array.isArray(json)) { json.forEach((j) => nodes(j, out)); return out; }
  const n = json as Node;
  out.push(n);
  (n.children ?? []).forEach((c) => nodes(c, out));
  return out;
}
const moving = (n: Node) => {
  const s = flat(n.props.style);
  return (typeof s.opacity === 'number' && s.opacity < 1) || (Array.isArray(s.transform) && s.transform.length > 0);
};
const transformOf = (n: Node) => (flat(n.props.style).transform ?? []) as Record<string, number>[];
const textOf = (n: Node | string): string => (typeof n === 'string' ? n : (n.children ?? []).map(textOf).join(''));

const advance = (ms: number) => { for (let left = ms; left > 0; left -= 16) act(() => { jest.advanceTimersByTime(Math.min(16, left)); }); };

type Cfg = { useNativeDriver?: boolean; duration?: number };
let timings: Cfg[] = [];
let springs: Cfg[] = [];
let delays: number[] = [];
let spies: jest.SpyInstance[] = [];

beforeEach(() => {
  jest.useFakeTimers();
  mockReduced = false;
  resetBudget();
  timings = []; springs = []; delays = [];
  const t = Animated.timing; const s = Animated.spring; const d = Animated.delay;
  spies = [
    jest.spyOn(Animated, 'timing').mockImplementation((v, c) => { timings.push(c as Cfg); return t(v, c); }),
    jest.spyOn(Animated, 'spring').mockImplementation((v, c) => { springs.push(c as Cfg); return s(v, c); }),
    jest.spyOn(Animated, 'delay').mockImplementation((ms) => { delays.push(ms); return d(ms); }),
  ];
});
afterEach(async () => {
  // Only these spies: restoreAllMocks would also strip the harness's own mocks.
  spies.forEach((x) => x.mockRestore());
  jest.useRealTimers();
  await cleanupAsync();
});

const money = (c: number) => `$${(c / 100).toLocaleString('en-US')}`;
const ITEMS = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, t: `Row ${i}` }));

// ONE jest test on purpose (glide-dots.test.tsx learned it): in this harness a
// second `it` that renders after the first one's cleanup never commits its
// first render. Each step below unmounts its own trees; every step runs, and
// the test fails with every failing step's name.
const steps: [string, () => void | Promise<void>][] = [];
const step = (name: string, fn: () => void | Promise<void>) => { steps.push([name, fn]); };

describe('motion kit', () => {
  step('T1 at rest every wrapper part equals the same children in a plain View', () => {
    const chat = render(<ChatTurn role="user" live={false} variant="page" testID="t"><Text>Which RFIs are late?</Text></ChatTurn>);
    const plain = render(<View testID="t"><Text>Which RFIs are late?</Text></View>);
    expect(norm(chat.toJSON())).toEqual(norm(plain.toJSON()));
    chat.unmount(); plain.unmount();

    const row = (t: { id: string; t: string }, _i: number, s: ViewStyle | null) => <Animated.View key={t.id} style={s}><Text>{t.t}</Text></Animated.View>;
    const list = render(<StaggerList items={ITEMS.slice(0, 5)} keyOf={(t) => t.id} armed={false} renderItem={row} testID="l" />);
    const plainList = render(<View testID="l">{ITEMS.slice(0, 5).map((t, i) => row(t, i, null))}</View>);
    expect(norm(list.toJSON())).toEqual(norm(plainList.toJSON()));
    list.unmount(); plainList.unmount();

    const roll = render(<CountRoll steps={[100, 300]} format={money} armed={false} testID="c" />);
    const plainRoll = render(<Text testID="c">{money(300)}</Text>);
    expect(norm(roll.toJSON())).toEqual(norm(plainRoll.toJSON()));
    roll.unmount(); plainRoll.unmount();

    // Every other part at rest: no node carries a kit motion style.
    const others = render(
      <View>
        <CheckSync rows={[{ key: 'a', status: 'done', render: () => <Text>A</Text> }]} renderCheck={() => <View />} />
        <AccumulateCards items={[{ key: 'x', cents: 100, render: (s) => <Animated.View style={s}><Text>x</Text></Animated.View> }]} armed={false} format={money} renderTotal={(n) => n} />
        <CornerTags armed={false} center={<Text>C</Text>} tags={{ tl: <Text>tl</Text>, br: <Text>br</Text> }} />
        <MatrixFill armed={false} rows={[{ key: 'm', label: <Text>L</Text>, evidence: [<Text key="e">E</Text>] }]} />
        <RangeSettle low={100} high={200} expected={150} format={money} armed={false} />
        <ThinkingRow visible={false} label="Reading your records" stillLabel="Still working on it" a11yLabel="Reading your records" />
      </View>,
    );
    expect(nodes(others.toJSON()).filter(moving)).toHaveLength(0);
    others.unmount();
  });

  step('T2 every timing / spring passes useNativeDriver === nativeDriver; T12 the gallery renders light and dark', () => {
    for (const mode of ['light', 'dark'] as const) {
      for (const armed of [false, true]) {
        const g = render(<KitGallery mode={mode} armed={armed} />);
        expect(g.getByTestId('kit-gallery')).toBeTruthy();
        advance(1200);
        g.unmount();
      }
    }
    expect(timings.length + springs.length).toBeGreaterThan(10);
    for (const c of [...timings, ...springs]) expect(c.useNativeDriver).toBe(false);
  });

  step('T3 under Reduce Motion nothing translates or scales, and every timing is ≤ 100 ms', () => {
    mockReduced = true;
    const g = render(<KitGallery mode="light" armed />);
    for (let t = 0; t < 600; t += 50) {
      expect(nodes(g.toJSON()).filter((n) => transformOf(n).length > 0)).toHaveLength(0);
      advance(50);
    }
    expect(timings.every((c) => (c.duration ?? 0) <= 100)).toBe(true);
    expect(springs).toHaveLength(0);
    g.unmount();
  });

  step('T4 StaggerList: exactly rows 0–7 carry motion; after the run every style is null', () => {
    const row = (t: { id: string; t: string }, _i: number, s: ViewStyle | null) => <Animated.View testID={`row-${t.id}`} style={s}><Text>{t.t}</Text></Animated.View>;
    const ui = (armed: boolean) => <StaggerList items={ITEMS} keyOf={(t) => t.id} armed={armed} renderItem={row} />;
    const r = render(ui(true));
    const styled = ITEMS.map((t) => Object.keys(flat(r.getByTestId(`row-${t.id}`).props.style)).length > 0);
    expect(styled.slice(0, 8).every(Boolean)).toBe(true);
    expect(styled.slice(8).some(Boolean)).toBe(false);
    advance(800);
    r.rerender(ui(true));
    expect(ITEMS.every((t) => Object.keys(flat(r.getByTestId(`row-${t.id}`).props.style)).length === 0)).toBe(true);
    r.unmount();
  });

  step('T5 ThinkingRow: the 140 ms gate, ONE clock, the 10 s label, the overlay exit', () => {
    const before = dotClockStats();
    const ui = (v: boolean) => (
      <View>
        <ThinkingRow visible={v} label="Reading your records" stillLabel="Still working on it" a11yLabel="Reading your records" testID="think-a" />
        <ThinkingRow visible={v} label="Reading your records" stillLabel="Still working on it" a11yLabel="Reading your records" testID="think-b" />
      </View>
    );
    const r = render(ui(true));
    advance(120);
    expect(r.queryByTestId('think-a')).toBeNull();
    advance(40);
    expect(r.getByTestId('think-a')).toBeTruthy();
    expect(r.getByTestId('think-a').props.accessibilityLiveRegion).toBe('polite');
    // Two rows on screen: two subscribers, ONE loop started.
    expect(dotClockStats().count).toBe(before.count + 2);
    expect(dotClockStats().starts).toBe(before.starts + 1);
    advance(10000);
    expect(textOf(r.getByTestId('think-a') as unknown as Node)).toContain('Still working on it');
    r.rerender(ui(false));
    expect(flat(r.getByTestId('think-a').props.style).position).toBe('absolute');
    advance(200);
    expect(r.queryByTestId('think-a')).toBeNull();
    expect(dotClockStats().count).toBe(before.count);
    expect(dotClockStats().stops).toBe(before.stops + 1);
    r.unmount();

    // A fast answer (true → false inside 140 ms) never renders the row.
    const fast = render(<ThinkingRow visible label="x" stillLabel="y" a11yLabel="x" testID="fast" />);
    advance(80);
    fast.rerender(<ThinkingRow visible={false} label="x" stillLabel="y" a11yLabel="x" testID="fast" />);
    advance(400);
    expect(fast.queryByTestId('fast')).toBeNull();
    fast.unmount();
  });

  step('T6 ChatTurn: a live user turn starts 56 pt (page) / 44 pt (panel) low at 0.98; onEntered once; never re-runs', () => {
    for (const [variant, y] of [['page', 56], ['panel', 44]] as const) {
      resetBudget();
      const onEntered = jest.fn();
      const ui = (live: boolean) => <ChatTurn role="user" live={live} variant={variant} onEntered={onEntered} testID="u"><Text>hi</Text></ChatTurn>;
      const r = render(ui(true));
      const t = transformOf(r.getByTestId('u') as unknown as Node);
      expect(t.find((x) => 'translateY' in x)?.translateY).toBe(y);
      expect(t.find((x) => 'scale' in x)?.scale).toBeCloseTo(0.98, 5);
      advance(1500);
      expect(onEntered).toHaveBeenCalledTimes(1);
      const calls = timings.length + springs.length;
      r.rerender(ui(false));
      r.rerender(ui(true));
      advance(400);
      expect(timings.length + springs.length).toBe(calls);
      expect(onEntered).toHaveBeenCalledTimes(1);
      r.unmount();
    }
  });

  step('T7 CountRoll steps through the real partial sums and ends on the total; the label is the total throughout', () => {
    const parts = [140000, 82000, 61000];
    const sums = partialSums(parts);
    const r = render(<CountRoll steps={sums} format={money} armed testID="roll" />);
    const seen: string[] = [];
    for (let t = 0; t < 800; t += 10) {
      const root = r.getByTestId('roll');
      expect(root.props.accessibilityLabel).toBe(money(sums[sums.length - 1]));
      const layers = nodes(r.toJSON()).filter((n) => n.type === 'Text' && flat(n.props.style).position === 'absolute' && flat(n.props.style).opacity !== 0);
      const top = layers.length ? textOf(layers[layers.length - 1]) : '';
      if (top && seen[seen.length - 1] !== top) seen.push(top);
      advance(10);
    }
    expect(seen).toEqual(sums.map(money));
    expect(seen.length).toBeLessThanOrEqual(6);
    r.unmount();
  });

  step('T8 CheckSync: no tick without a change; three completions tick ≥ 120 ms apart; failed never shows the check', () => {
    const rows = (st: CheckStatus[]): CheckRow[] => st.map((s, i) => ({ key: `k${i}`, status: s, render: () => <Text>{`row ${i}`}</Text> }));
    const check = (s: CheckStatus) => (s === 'done' ? <View testID="check-glyph" /> : <View />);
    const r = render(<CheckSync rows={rows(['pending', 'pending', 'pending', 'active'])} renderCheck={check} />);
    r.rerender(<CheckSync rows={rows(['pending', 'pending', 'pending', 'active'])} renderCheck={check} />);
    expect(springs).toHaveLength(0);
    r.rerender(<CheckSync rows={rows(['done', 'done', 'done', 'failed'])} renderCheck={check} />);
    expect(springs.length).toBe(3);
    expect([...delays].sort((a, b) => a - b)).toEqual([0, 120, 240]);
    expect(r.getAllByTestId('check-glyph')).toHaveLength(3);
    r.unmount();
  });

  step('T9 RangeSettle: one value → no track motion; expected is clamped; labels never scale', () => {
    const layout = (r: ReturnType<typeof render>, w: number) => {
      type Inst = { props: Record<string, (e: unknown) => void>; type: unknown };
      const all = (r.UNSAFE_root.findAll((n: Inst) => typeof n.props.onLayout === 'function' && typeof n.type !== 'string') as unknown as Inst[]);
      act(() => { all.forEach((n: Inst, i: number) => n.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: i === 0 ? w : 60, height: 20 } } })); });
    };
    const single = render(<RangeSettle low={500} high={500} format={money} armed testID="rs" />);
    layout(single, 320);
    expect(nodes(single.toJSON()).filter((n) => transformOf(n).some((x) => 'scaleX' in x))).toHaveLength(0);
    single.unmount();

    const r = render(<RangeSettle low={100000} high={200000} expected={900000} format={money} armed testID="rr" />);
    layout(r, 320);
    const all = nodes(r.toJSON());
    const bubble = all.find((n) => flat(n.props.style).width === 10 && flat(n.props.style).height === 10);
    expect(flat(bubble?.props.style).left).toBe(320 - 5);
    const labels = all.filter((n) => n.children?.some((c) => typeof c !== 'string' && c.type === 'Text'));
    for (const l of labels) expect(transformOf(l).some((x) => 'scale' in x || 'scaleX' in x || 'scaleY' in x)).toBe(false);
    advance(800);
    r.unmount();
  });

  step('T10 FileInto: a failed measure flies nothing; 5 sources → 3 flyers + a "+2" chip', async () => {
    let api: ReturnType<typeof useFileInto> | null = null;
    function Host() { api = useFileInto(); return <View>{api.layer}</View>; }
    const r = render(<Host />);
    const ok = (x: number) => ({ current: { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(x, 400, 60, 60) } });
    const bad = { current: null };
    let flew: boolean | null = null;
    await act(async () => { flew = await api!.fileInto({ sources: [bad], target: ok(300), thumbs: [<Text key="t">p</Text>] }); });
    expect(flew).toBe(false);
    expect(r.queryAllByTestId(/file-into-flyer/)).toHaveLength(0);
    await act(async () => {
      flew = await api!.fileInto({ sources: [ok(0), ok(70), ok(140), ok(210), ok(280)], target: ok(500), thumbs: [1, 2, 3, 4, 5].map((i) => <Text key={i}>{`p${i}`}</Text>) });
    });
    expect(flew).toBe(true);
    expect(r.queryAllByTestId(/file-into-flyer-/)).toHaveLength(3);
    expect(textOf(r.getByTestId('file-into-chip') as unknown as Node)).toBe('+2');
    advance(1200);
    expect(r.queryAllByTestId(/file-into-flyer-/)).toHaveLength(0);
    r.unmount();
  });

  step('T11 the budget: 30 arms at once → 24 animate, 6 render their end state at once', () => {
    const r = render(
      <View>
        {Array.from({ length: 30 }, (_, i) => (
          <ChatTurn key={i} role="assistant" live variant="page" testID={`turn-${i}`}><Text>{`a${i}`}</Text></ChatTurn>
        ))}
      </View>,
    );
    const animating = Array.from({ length: 30 }, (_, i) => Object.keys(flat(r.getByTestId(`turn-${i}`).props.style)).length > 0);
    expect(animating.filter(Boolean)).toHaveLength(24);
    r.unmount();
  });

  step('T13 PriorityGrid: the old rule fades out over 120 ms and unmounts; useCheckBeat returns a style or null', () => {
    const cells = ['a', 'b', 'c'].map((k) => ({ key: k, render: () => <Text>{`cell ${k}`}</Text> }));
    const rules = (r: ReturnType<typeof render>) => nodes(r.toJSON()).filter((n) => flat(n.props.style).backgroundColor === 'tomato');
    const r = render(<PriorityGrid cells={cells} priorityKey="a" armed={false} columns={3} ruleColor="tomato" />);
    expect(rules(r)).toHaveLength(1);
    expect(timings).toHaveLength(0);
    r.rerender(<PriorityGrid cells={cells} priorityKey="b" armed={false} columns={3} ruleColor="tomato" />);
    expect(rules(r)).toHaveLength(2);
    expect(timings.some((c) => c.duration === 120 && (c as { toValue?: number }).toValue === 0)).toBe(true);
    advance(1500);
    expect(rules(r)).toHaveLength(1);
    for (const n of nodes(r.toJSON())) expect(transformOf(n).filter((x) => Object.values(x).some((v) => v !== 0 && v !== 1))).toHaveLength(0);
    r.unmount();

    function Beat({ status }: { status: CheckStatus }) {
      const st = useCheckBeat(status);
      return <Animated.View testID="beat" style={st} />;
    }
    const b = render(<Beat status="pending" />);
    expect(b.getByTestId('beat').props.style ?? null).toBeNull();
    b.rerender(<Beat status="done" />);
    expect(flat(b.getByTestId('beat').props.style).opacity).toBeDefined();
    b.unmount();
  });

  it("T1–T13: at rest, native driver, Reduce Motion, and each part's own rule", async () => {
    const errors: string[] = [];
    for (const [name, fn] of steps) {
      timings = []; springs = []; delays = [];
      mockReduced = false;
      resetBudget();
      try { await fn(); } catch (e) { errors.push(`${name}: ${(e as Error).message.split('\n').slice(0, 6).join(' | ')}`); }
    }
    expect(errors).toEqual([]);
  });
});
