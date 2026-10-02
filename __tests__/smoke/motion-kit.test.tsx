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
 *       useCheckBeat(status) is the spec's ViewStyle | null;
 *   G0  (lane KITFIX) the default-behaviour golden of the three parts KITFIX
 *       touched, recorded on the untouched kit (KITFIX_GOLDEN=<file>);
 *   T14 (KG1) FileInto under a header (top 88) and inside a <Sheet>: the flyer
 *       starts at source − layer origin and lands on target − layer origin;
 *   T15 (KG3) useFocusPush ruleAxis 'y' draws on scaleY from the top.
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

// <Sheet> (T14) reads the theme; the kit itself never does.
jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return { ThemeProvider: ({ children }: { children: React.ReactNode }) => children, useTheme: () => value };
});

// eslint-disable-next-line import/first
import { SafeAreaProvider } from 'react-native-safe-area-context';
// eslint-disable-next-line import/first
import { Sheet } from '@/components/ui/Sheet';
// eslint-disable-next-line import/first
import { flyerGeometry, flyerLanding } from '@/utils/motion/kit/plans';
// eslint-disable-next-line import/first
import {
  AccumulateCards, ChatTurn, CheckSync, CornerTags, CountRoll, MatrixFill, PriorityGrid, RangeSettle, StaggerList, ThinkingRow,
  dotClockStats, resetBudget, useCheckBeat, useFileInto, useFocusPush, type CheckRow, type CheckStatus,
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
  // G0 — the default-behaviour golden (lane KITFIX). Renders the three parts
  // KITFIX touches with their DEFAULT options through a run and dumps every
  // frame; recorded on the untouched kit, then compared byte-for-byte after.
  // Set KITFIX_GOLDEN=<file> to write the dump; otherwise it only renders.
  step('G0 default-behaviour golden: AccumulateCards, useFocusPush, useFileInto with default options', async () => {
    const frames: Record<string, unknown> = {};
    const items = [140000, 82000, 61000].map((c, i) => ({ key: `k${i}`, cents: c, render: (s: ViewStyle | null) => <Animated.View testID={`card-${i}`} style={s}><Text>{`card ${i}`}</Text></Animated.View> }));
    for (const armed of [false, true]) {
      resetBudget();
      const r = render(<AccumulateCards items={items} armed={armed} format={money} renderTotal={(n) => <View testID="tot">{n}</View>} badge={<Text>badge</Text>} style={{ padding: 4 }} testID="acc" />);
      for (const t of [0, 100, 300, 1200]) { frames[`acc-${armed}-${t}`] = norm(r.toJSON()); advance(t === 0 ? 100 : t === 100 ? 200 : t === 300 ? 900 : 0); }
      r.unmount();
    }
    const scrolls: unknown[] = [];
    let push: ReturnType<typeof useFocusPush> | null = null;
    function PushHost() {
      const ref = React.useRef({ scrollTo: (o: unknown) => { scrolls.push(o); } });
      push = useFocusPush(ref);
      return <View><Animated.View testID="rule-a" style={push.styleFor('a')} /><Animated.View testID="rule-b" style={push.styleFor('b')} /></View>;
    }
    const p = render(<PushHost />);
    act(() => { push!('a', { x: 10, y: 300, w: 200, h: 40 }); });
    for (const t of [0, 200, 400, 1000]) { frames[`push-${t}`] = norm(p.toJSON()); advance(t === 0 ? 200 : t === 200 ? 200 : t === 400 ? 600 : 0); }
    frames.pushScrolls = scrolls;
    frames.pushTimings = timings.map((c) => ({ ...c, easing: undefined }));
    p.unmount();
    let api: ReturnType<typeof useFileInto> | null = null;
    function FileHost() { api = useFileInto(); return <View>{api.layer}</View>; }
    const f = render(<FileHost />);
    const at = (x: number, y: number) => ({ current: { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(x, y, 60, 80) } });
    await act(async () => { await api!.fileInto({ sources: [at(20, 500), at(90, 500)], target: at(300, 120), thumbs: [<Text key="a">a</Text>, <Text key="b">b</Text>] }); });
    frames['file-0'] = norm(f.toJSON());
    advance(1200);
    frames['file-end'] = norm(f.toJSON());
    f.unmount();
    const out = process.env.KITFIX_GOLDEN;
    if (out) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('fs').writeFileSync(out, JSON.stringify(frames, null, 1));
    }
    expect(Object.keys(frames).length).toBeGreaterThan(10);
  });

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

  step('T14 FileInto (KG1): under a header (top 88) and inside a <Sheet>, the flyer starts at source − layer origin and lands on target − layer origin', async () => {
    const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
    const at = (x: number, y: number, w: number, h: number) => ({ current: { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(x, y, w, h) } });
    type Inst = { props: Record<string, unknown>; type: unknown; instance: { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null };
    const SRC = { x: 40, y: 600, w: 60, h: 80 };
    const TGT = { x: 220, y: 180, w: 120, h: 90 };
    const placements: [string, { x: number; y: number }, (n: React.ReactNode) => React.ReactElement][] = [
      ['under a header (top 88)', { x: 0, y: 88 }, (n) => <View><View style={{ height: 88 }} /><View style={{ flex: 1 }}>{n}</View></View>],
      ['inside a <Sheet>', { x: 16, y: 312 }, (n) => (
        <SafeAreaProvider initialMetrics={METRICS}><Sheet visible onClose={() => {}} title="Scan">{n}</Sheet></SafeAreaProvider>
      )],
    ];
    for (const [name, origin, wrap] of placements) {
      resetBudget();
      let api: ReturnType<typeof useFileInto> | null = null;
      function Host() { api = useFileInto(); return <View style={{ flex: 1 }}>{api.layer}</View>; }
      const r = render(wrap(<Host />));
      // The test renderer's View never answers measureInWindow: this layer answers
      // with its window origin, the way the native view under the header / in the sheet does.
      const layer = (r.UNSAFE_root.findAll((n: Inst) => n.props.testID === 'file-into-layer' && typeof n.type !== 'string') as unknown as Inst[])
        .find((n) => n.instance && typeof n.instance.measureInWindow === 'function');
      expect(layer).toBeTruthy();
      layer!.instance!.measureInWindow = (cb) => cb(origin.x, origin.y, 390, 600);
      let flew: boolean | null = null;
      await act(async () => { flew = await api!.fileInto({ sources: [at(SRC.x, SRC.y, SRC.w, SRC.h)], target: at(TGT.x, TGT.y, TGT.w, TGT.h), thumbs: [<Text key="p">p</Text>] }); });
      expect([name, flew]).toEqual([name, true]);
      const box = flat(r.getByTestId('file-into-flyer-0').props.style);
      expect([name, box.left, box.top]).toEqual([name, SRC.x - origin.x, SRC.y - origin.y]);
      // The pure maths: the landing (box centre + full travel) is target − origin.
      const g = flyerGeometry(SRC, TGT, origin);
      expect(flyerLanding(g)).toEqual({ x: TGT.x + TGT.w / 2 - origin.x, y: TGT.y + TGT.h / 2 - origin.y });
      // The rendered landing: the last frame of the flight puts the flyer's centre on target − origin.
      let last: Record<string, number> | null = null;
      for (let t = 0; t < 1200 && r.queryByTestId('file-into-flyer-0'); t += 16) {
        const st = flat(r.getByTestId('file-into-flyer-0').props.style);
        const tr = Object.assign({}, ...((st.transform ?? []) as Record<string, number>[])) as Record<string, number>;
        last = { left: st.left as number, top: st.top as number, w: st.width as number, h: st.height as number, tx: tr.translateX, ty: tr.translateY };
        advance(16);
      }
      expect(last).not.toBeNull();
      expect(last!.left + last!.w / 2 + last!.tx).toBeCloseTo(TGT.x + TGT.w / 2 - origin.x, 0);
      expect(last!.top + last!.h / 2 + last!.ty).toBeCloseTo(TGT.y + TGT.h / 2 - origin.y, 0);
      r.unmount();
    }
  });

  step("T15 useFocusPush ruleAxis (KG3): 'y' draws the rule on scaleY from the top; the default stays scaleX from the left", () => {
    const scrolls: unknown[] = [];
    const ref = { current: { scrollTo: (o: unknown) => { scrolls.push(o); } } };
    let push: ReturnType<typeof useFocusPush> | null = null;
    function Host({ ruleAxis }: { ruleAxis?: 'x' | 'y' }) {
      push = useFocusPush(ref, ruleAxis ? { axis: 'x', ruleAxis } : { axis: 'x' });
      return <Animated.View testID="rule" style={push.styleFor('today')} />;
    }
    for (const ruleAxis of ['y', undefined] as const) {
      const r = render(<Host ruleAxis={ruleAxis} />);
      act(() => { push!('today', { x: 500, y: 0, w: 2, h: 400 }); });
      const st = flat(r.getByTestId('rule').props.style);
      const keys = ((st.transform ?? []) as Record<string, number>[]).flatMap((x) => Object.keys(x));
      if (ruleAxis === 'y') {
        expect(keys).toEqual(['scaleY']);
        expect(st.transformOrigin).toBe('top');
      } else {
        expect(keys).toEqual(['scaleX']);
        expect(st.transformOrigin).toBe('left');
      }
      advance(400);
      const mid = Object.assign({}, ...((flat(r.getByTestId('rule').props.style).transform ?? []) as Record<string, number>[])) as Record<string, number>;
      const v = ruleAxis === 'y' ? mid.scaleY : mid.scaleX;
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
      r.unmount();
    }
    // The scroll axis is still `axis` ('x' here): the rule axis never moves the scroll.
    expect(scrolls).toEqual([{ x: 484, animated: true }, { x: 484, animated: true }]);
    // Reduce Motion: the vertical rule is simply there (no style), the scroll jumps.
    mockReduced = true;
    const red = render(<Host ruleAxis="y" />);
    act(() => { push!('today', { x: 500, y: 0, w: 2, h: 400 }); });
    expect(red.getByTestId('rule').props.style ?? null).toBeNull();
    expect(scrolls[scrolls.length - 1]).toEqual({ x: 484, animated: false });
    red.unmount();
  });

  it("G0, T1–T15: the default golden, at rest, native driver, Reduce Motion, and each part's own rule", async () => {
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
