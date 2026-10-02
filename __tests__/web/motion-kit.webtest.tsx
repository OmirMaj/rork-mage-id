/**
 * Web — the motion kit on react-native-web (lane MOTIONKIT, spec D3).
 *
 *  W1 at rest no kit animation class; armed → the registered kitCss class,
 *     its delay a STRING ('35ms'), fill 'backwards'; nothing left after the run.
 *  W2 prefers-reduced-motion: reduce → no kit keyframe class anywhere.
 *  W3 FocusMarker: no marker at rest; an active change mounts ONE marker that
 *     unmounts when its springs end.
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
import { FocusMarker, StaggerList, resetBudget } from '@/components/motion/kit';
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
});
