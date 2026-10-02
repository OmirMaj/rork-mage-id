/**
 * Web — the motion kit on react-native-web (lane MOTIONKIT, spec D3).
 *
 *  W1 at rest no kit animation class; armed → the registered kitCss class,
 *     its delay a STRING ('35ms'), fill 'backwards'; nothing left after the run.
 *  W2 prefers-reduced-motion: reduce → no kit keyframe class anywhere.
 *  W3 FocusMarker: no marker at rest; an active change mounts ONE marker that
 *     unmounts when its springs end.
 *  W4 (lane KITFIX, KG2) AccumulateCards in a desktop 3-up TileGrid: the
 *     wrapper-free paths (useAccumulate, asChild) keep every card a direct
 *     child of the grid at the column width, entrance class kept; the shipped
 *     wrapper path still collapses (the reason the adopters dropped the row).
 *  W5 (KG3) useFocusPush ruleAxis 'y' draws with the drawT keyframe; the
 *     default stays drawL.
 */

import React, { act } from 'react';
import { Animated, Text, View, type ViewStyle } from 'react-native';

type Root = { render(node: React.ReactNode): void; unmount(): void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRoot } = require('react-dom/client') as { createRoot(el: Element): Root };
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// One reduce media query for the whole file; flipped through its change listener.
let mockReduce = false;
const listeners: ((e: { matches: boolean }) => void)[] = [];
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (q: string) => ({
    get matches() { return q.includes('reduce') ? mockReduce : false; },
    media: q,
    addEventListener: (_t: string, fn: (e: { matches: boolean }) => void) => { if (q.includes('reduce')) listeners.push(fn); },
    removeEventListener: () => {},
    addListener: (fn: (e: { matches: boolean }) => void) => { if (q.includes('reduce')) listeners.push(fn); },
    removeListener: () => {},
  }),
});
const setReduce = (on: boolean) => { mockReduce = on; act(() => { listeners.forEach((fn) => fn({ matches: on })); }); };

// The desktop gate: jsdom reports a 0×0 window to react-native-web, so the
// layout hook answers "desktop" here (the w6d webtests do the same).
jest.mock('@/utils/useResponsiveLayout', () => ({
  useResponsiveLayout: () => ({
    screenSize: 'desktop', isPhone: false, isTablet: false, isDesktop: true, width: 1512, height: 945,
    contentMaxWidth: 1400, sidebarWidth: 240, showSidebar: true, ganttRowHeight: 32,
  }),
}));

// eslint-disable-next-line import/first
import { AccumulateCards, FocusMarker, StaggerList, kitWebStyle, resetBudget, useAccumulate, useFocusPush, type AccumulateItem } from '@/components/motion/kit';
// eslint-disable-next-line import/first
import { TileGrid } from '@/components/ui/TileGrid';
// eslint-disable-next-line import/first
import { reducedMotion } from '@/components/ui/motion';

function insertedCss(): string {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try { for (const rule of Array.from(sheet.cssRules)) out.push(rule.cssText); } catch { /* none in jsdom */ }
  }
  for (const el of Array.from(document.querySelectorAll('style'))) out.push(el.textContent ?? '');
  return out.join('\n').replace(/\s+/g, '');
}
function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, root, done: () => { act(() => root.unmount()); host.remove(); } };
}

const ITEMS = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, t: `Daily report ${i + 1}` }));
const row = (t: { id: string; t: string }, _i: number, s: ViewStyle | null) => (
  <Animated.View key={t.id} testID={`row-${t.id}`} style={s}><Text>{t.t}</Text></Animated.View>
);
const List = ({ armed }: { armed: boolean }) => <StaggerList items={ITEMS} keyOf={(t) => t.id} armed={armed} renderItem={row} />;
const cls = (host: HTMLElement, id: string) => (host.querySelector(`[data-testid="row-${id}"]`) as HTMLElement).className;

describe('motion kit on react-native-web', () => {
  beforeEach(() => { jest.useFakeTimers(); resetBudget(); reducedMotion(); });
  afterEach(() => { jest.useRealTimers(); });

  it('W1 at rest no kit class; armed → the registered keyframe class with a string delay and fill backwards; nothing after the run', () => {
    const rest = mount(<List armed={false} />);
    const restClass = cls(rest.host, 'r1');
    rest.done();

    const m = mount(<List armed />);
    const armedClass = cls(m.host, 'r1');
    expect(armedClass).not.toBe(restClass);
    const css = insertedCss();
    expect(css).toMatch(/@(-webkit-)?keyframes/);
    expect(css).toContain('animation-delay:35ms');
    expect(css).toContain('animation-duration:220ms');
    expect(css).toContain('animation-fill-mode:backwards');
    expect(css).not.toMatch(/animation-fill-mode:(both|forwards)/);
    expect(css).not.toMatch(/animation-delay:\d+px/);
    // Row 9 (past the cap) carries nothing.
    expect(cls(m.host, 'r8')).toBe(restClass);
    // After the run (465 ms) a re-render leaves nothing on any row.
    act(() => { jest.advanceTimersByTime(600); });
    act(() => m.root.render(<List armed />));
    for (const t of ITEMS) {
      expect(cls(m.host, t.id)).toBe(restClass);
      expect((m.host.querySelector(`[data-testid="row-${t.id}"]`) as HTMLElement).getAttribute('style') ?? '').not.toMatch(/animation/);
    }
    m.done();
  });

  it('W2 prefers-reduced-motion: reduce → no kit keyframe class anywhere', () => {
    const rest = mount(<List armed={false} />);
    const restClass = cls(rest.host, 'r0');
    rest.done();
    setReduce(true);
    const m = mount(<List armed />);
    for (const t of ITEMS) expect(cls(m.host, t.id)).toBe(restClass);
    m.done();
    setReduce(false);
    // Control: the same mount with motion on does carry the class.
    resetBudget();
    const on = mount(<List armed />);
    expect(cls(on.host, 'r0')).not.toBe(restClass);
    on.done();
  });

  it('W3 FocusMarker: no marker at rest; a change mounts ONE marker that unmounts at the spring end', () => {
    const rects = { a: { x: 0, y: 0, w: 120, h: 32 }, b: { x: 0, y: 40, w: 120, h: 32 }, c: { x: 0, y: 80, w: 120, h: 32 } };
    const flights: boolean[] = [];
    const ui = (k: string) => <View><FocusMarker axis="y" activeKey={k} rects={rects} testID="marker" style={{ width: 2 }} onFlight={(f) => flights.push(f)} /></View>;
    const m = mount(ui('a'));
    expect(m.host.querySelectorAll('[data-testid="marker"]')).toHaveLength(0);
    // In jest react-native-web swaps in AnimatedMock (Platform.isTesting), where
    // every animation ends at once; hold the glide's completion so the frame
    // with the marker commits, then end it the way the springs would.
    let finish: ((r: { finished: boolean }) => void) | null = null;
    const parallel = jest.spyOn(Animated, 'parallel').mockImplementation(() => ({
      start: (cb?: (r: { finished: boolean }) => void) => { finish = cb ?? null; },
      stop: () => {},
      reset: () => {},
    }) as unknown as Animated.CompositeAnimation);
    act(() => m.root.render(ui('c')));
    expect(m.host.querySelectorAll('[data-testid="marker"]')).toHaveLength(1);
    expect(flights).toEqual([true]);
    act(() => { finish?.({ finished: true }); });
    parallel.mockRestore();
    expect(m.host.querySelectorAll('[data-testid="marker"]')).toHaveLength(0);
    expect(flights).toEqual([true, false]);
    // Reduce Motion: the instant swap, no marker at all.
    setReduce(true);
    act(() => m.root.render(ui('b')));
    expect(m.host.querySelectorAll('[data-testid="marker"]')).toHaveLength(0);
    expect(flights).toEqual([true, false]);
    setReduce(false);
    m.done();
  });

  // ── lane KITFIX ────────────────────────────────────────────────────────────
  const CARDS: AccumulateItem[] = [140000, 82000, 61000].map((c, i) => ({
    key: `k${i}`,
    cents: c,
    render: (st: ViewStyle | null) => <Animated.View testID={`card-${i}`} style={[{ padding: 12 }, st]}><Text>{`Hidden condition ${i + 1}`}</Text></Animated.View>,
  }));
  const money = (c: number) => `$${(c / 100).toLocaleString('en-US')}`;
  /** Give the grid a measured width the way react-native-web's ResizeObserver would (jsdom has none). */
  const layoutGrid = (host: HTMLElement, width: number) => {
    const grid = host.querySelector('[data-testid="grid"]') as HTMLElement & { __reactLayoutHandler?: (e: unknown) => void };
    expect(typeof grid.__reactLayoutHandler).toBe('function');
    act(() => { grid.__reactLayoutHandler!({ nativeEvent: { layout: { x: 0, y: 0, width, height: 400, left: 0, top: 0 } }, timeStamp: 0 }); });
    return grid;
  };
  // Layout.tile.content = { min 380, maxCols 3, gap 16 }: 1240 → 3 columns of floor((1240 − 32) / 3) = 402.
  const COL = 402;

  it('W4 AccumulateCards in a 3-up TileGrid: useAccumulate / asChild keep the column widths; the shipped wrapper collapses', () => {
    function HookGrid() {
      const acc = useAccumulate({ items: CARDS, armed: true, format: money });
      return <View><TileGrid preset="content" testID="grid">{acc.cards}</TileGrid><View testID="total">{acc.total}</View></View>;
    }
    const restClass = (() => {
      const m = mount(<TileGrid preset="content" testID="grid"><AccumulateCards asChild items={CARDS} armed={false} format={money} renderTotal={() => null} /></TileGrid>);
      const c = (m.host.querySelector('[data-testid="card-0"]') as HTMLElement).className;
      m.done();
      return c;
    })();
    for (const [name, ui] of [
      ['useAccumulate', <HookGrid key="h" />],
      ['asChild', <TileGrid key="a" preset="content" testID="grid"><AccumulateCards asChild items={CARDS} armed format={money} renderTotal={() => null} /></TileGrid>],
    ] as const) {
      resetBudget();
      const m = mount(ui);
      const grid = layoutGrid(m.host, 1240);
      const cards = [0, 1, 2].map((i) => m.host.querySelector(`[data-testid="card-${i}"]`) as HTMLElement);
      for (const c of cards) {
        expect([name, c.parentElement === grid]).toEqual([name, true]);
        expect([name, c.style.width]).toEqual([name, `${COL}px`]);
        expect([name, c.style.maxWidth]).toEqual([name, `${COL}px`]);
        // The entrance survives the grid's clone: the card still carries its kit class.
        expect([name, c.className === restClass]).toEqual([name, false]);
      }
      expect(3 * COL + 2 * 16).toBeLessThanOrEqual(1240);
      if (name === 'useAccumulate') expect(m.host.querySelector('[data-testid="total"]')?.textContent).toBe(money(283000));
      m.done();
    }
    // The shipped wrapper path (no asChild) is unchanged — and it is why the row was dropped:
    // the grid sizes the ONE wrapper to a column and the cards inside get no width at all.
    resetBudget();
    const w = mount(<TileGrid preset="content" testID="grid"><AccumulateCards items={CARDS} armed={false} format={money} renderTotal={(n) => n} testID="acc" /></TileGrid>);
    const grid = layoutGrid(w.host, 1240);
    const wrapper = w.host.querySelector('[data-testid="acc"]') as HTMLElement;
    expect(wrapper.parentElement).toBe(grid);
    expect(wrapper.style.width).toBe(`${COL}px`);
    for (const i of [0, 1, 2]) {
      const c = w.host.querySelector(`[data-testid="card-${i}"]`) as HTMLElement;
      expect(c.parentElement).toBe(wrapper);
      expect(c.style.width).toBe('');
    }
    w.done();
  });

  it("W5 useFocusPush ruleAxis 'y' draws with drawT (scaleY from the top); the default stays drawL", () => {
    const ref = { current: { scrollTo: () => {} } };
    let push: ReturnType<typeof useFocusPush> | null = null;
    function Host({ ruleAxis }: { ruleAxis?: 'x' | 'y' }) {
      push = useFocusPush(ref, ruleAxis ? { ruleAxis } : {});
      return <View><Animated.View testID="rule" style={push.styleFor('today')} /><View testID="drawT" style={kitWebStyle('drawT', 320)} /><View testID="drawL" style={kitWebStyle('drawL', 320)} /></View>;
    }
    const classOf = (host: HTMLElement, id: string) => (host.querySelector(`[data-testid="${id}"]`) as HTMLElement).className;
    for (const ruleAxis of ['y', undefined] as const) {
      const m = mount(<Host ruleAxis={ruleAxis} />);
      const rest = classOf(m.host, 'rule');
      act(() => { push!('today', { x: 0, y: 300, w: 2, h: 400 }); });
      const drawn = classOf(m.host, 'rule');
      expect(drawn).not.toBe(rest);
      expect(drawn).toBe(classOf(m.host, ruleAxis === 'y' ? 'drawT' : 'drawL'));
      expect(drawn).not.toBe(classOf(m.host, ruleAxis === 'y' ? 'drawL' : 'drawT'));
      m.done();
    }
    const css = insertedCss();
    expect(css).toContain('scaleY(0)');
    expect(css).toMatch(/transform-origin:top/);
  });
});
