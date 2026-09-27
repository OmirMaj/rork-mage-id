/**
 * Web — "The Level" and the crane really compile to CSS on react-native-web
 * 0.21 (lane WEB).
 *
 * RN-web's CSS passthrough fails SILENTLY: an inline keyframe is dropped, a
 * bare-number duration becomes px, fill 'both' re-roots fixed UI. So this
 * mounts the real components with react-dom in jsdom and reads the CSS RN-web
 * inserted, per element.
 *
 * Reduce Motion goes through the REAL path: window.matchMedia is installed
 * before the motion store first reads it, and flipped through its 'change'
 * listener (components/ui/motion.ts never uses RN-web's AccessibilityInfo).
 *
 * The theme: a mock whose accent is a marker colour, routed to the REAL
 * useTheme (no provider → undefined, like BrandSplash) for the no-provider block.
 */

import React, { act } from 'react';
import { StyleSheet, View } from 'react-native';

// ── matchMedia: installed before any render (the motion store reads it lazily)
type MqListener = (e: { matches: boolean }) => void;
const mqListeners: MqListener[] = [];
let mqMatches = false;
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (q: string) => ({
    media: q,
    get matches() { return q.includes('prefers-reduced-motion') ? mqMatches : false; },
    addEventListener: (_t: string, fn: MqListener) => { mqListeners.push(fn); },
    removeEventListener: () => {},
    addListener: (fn: MqListener) => { mqListeners.push(fn); },
    removeListener: () => {},
  }),
});
function setReduceMotion(on: boolean) {
  mqMatches = on;
  act(() => { mqListeners.forEach((fn) => fn({ matches: on })); });
}

let mockNoProvider = false;
jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/contexts/ThemeContext');
  const c = jest.requireActual('@/constants/colors');
  // A marker accent (a token VALUE, never a literal in the components).
  const colors = { ...c.Theme.light, ...c.deriveAccentPalette(c.getCustomPrimary(), 'light'), accent: '#1A2B3C' };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return {
    ...actual,
    useTheme: () => (mockNoProvider ? actual.useTheme() : value),
  };
});

// eslint-disable-next-line import/first
import LevelMark from '@/components/loaders/LevelMark';
// eslint-disable-next-line import/first
import { CraneSvg } from '@/components/CraneLoader';

type Root = { render(node: React.ReactNode): void; unmount(): void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRoot } = require('react-dom/client') as { createRoot(el: Element): Root };

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function allRules(): CSSRule[] {
  const out: CSSRule[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try { out.push(...Array.from(sheet.cssRules)); } catch { /* none in jsdom */ }
  }
  return out;
}
/** Every CSS rule RN-web has inserted so far, whitespace-free. */
function insertedCss(): string {
  const out = allRules().map((r) => r.cssText);
  for (const el of Array.from(document.querySelectorAll('style'))) out.push(el.textContent ?? '');
  return out.join('\n').replace(/\s+/g, '');
}
/** The declarations the element's classes carry, plus the @keyframes they name. */
function cssOf(el: Element): string {
  const rules = allRules();
  const classes = Array.from(el.classList);
  const own = rules
    .filter((r) => r instanceof CSSStyleRule && classes.some((c) => (r as CSSStyleRule).selectorText.split(/[\s,]+/).includes(`.${c}`)))
    .map((r) => r.cssText);
  const names = own.flatMap((t) => [...t.matchAll(/animation-name:\s*([\w-]+)/g)].map((m) => m[1]));
  const frames = rules.filter((r) => names.some((n) => r.cssText.includes(`keyframes ${n}`))).map((r) => r.cssText);
  return [...own, ...frames].join('\n').replace(/\s+/g, '');
}
const byId = (host: Element, id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return {
    host,
    rerender: (n: React.ReactNode) => act(() => root.render(n)),
    done: () => { act(() => root.unmount()); host.remove(); },
  };
}

describe('LevelMark on the web (CSS)', () => {
  afterEach(() => {
    if (mqMatches) setReduceMotion(false);
    mockNoProvider = false;
  });

  it.each([20, 64, 120])('%i px: drift keyframes, 700ms, infinite, alternate, fill backwards; the reveal delay is the prop', (size) => {
    const m = mount(<LevelMark size={size} revealDelayMs={150} />);
    const drift = byId(m.host, 'level-mark-drift')!;
    const bubble = byId(m.host, 'level-mark-bubble')!;
    const box = byId(m.host, 'level-mark')!;
    const d = cssOf(drift);
    expect(d).toMatch(/@(-webkit-)?keyframes/);
    expect(d).toMatch(/translateX\(-?[\d.]+px\)/);
    expect(d).toContain('animation-duration:700ms');
    expect(d).toContain('animation-iteration-count:infinite');
    expect(d).toContain('animation-direction:alternate');
    expect(d).toContain('animation-delay:-350ms');
    expect(d).toContain('animation-fill-mode:backwards');
    expect(cssOf(bubble)).toMatch(/scale\([\d.]+,[\d.]+\)/);
    expect(cssOf(box)).toContain('animation-delay:150ms');
    expect(cssOf(box)).toContain('animation-duration:170ms');
    expect(insertedCss()).not.toContain('animation-fill-mode:both');
    m.done();
  });

  it('revealDelayMs 0 → no reveal animation on the container', () => {
    const m = mount(<LevelMark size={64} revealDelayMs={0} />);
    expect(cssOf(byId(m.host, 'level-mark')!)).not.toContain('animation-name');
    m.done();
  });

  it('the graduation glint only from 96 px', () => {
    const a = mount(<LevelMark size={120} />);
    expect(insertedCss()).toMatch(/opacity:0\.8/);
    a.done();
  });

  it('animate={false}: a still level, no classes that animate', () => {
    const m = mount(<LevelMark size={64} animate={false} />);
    for (const el of Array.from(m.host.querySelectorAll('*'))) expect(cssOf(el)).not.toContain('animation-name');
    m.done();
  });

  it("Reduce Motion (matchMedia '(prefers-reduced-motion: reduce)'): no translateX keyframe on the level, an opacity breath instead", () => {
    setReduceMotion(true);
    const m = mount(<LevelMark size={64} />);
    const drift = byId(m.host, 'level-mark-drift')!;
    const bubble = byId(m.host, 'level-mark-bubble')!;
    expect(cssOf(drift)).not.toContain('animation-name');
    expect(cssOf(drift)).not.toContain('translateX');
    const b = cssOf(bubble);
    expect(b).toContain('animation-duration:1120ms');
    expect(b).toMatch(/opacity:0\.5/);
    expect(b).not.toContain('translateX');
    expect(b).not.toContain('scale(');
    m.done();
  });

  describe('done → onSettled', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    it('the container opacity transitionend settles it once; the backstop does not call again', () => {
      const onSettled = jest.fn();
      const m = mount(<LevelMark size={64} onSettled={onSettled} />);
      m.rerender(<LevelMark size={64} onSettled={onSettled} done />);
      const box = byId(m.host, 'level-mark')!;
      // (b)+(c): the drift is pinned and glides to centre; (e) the mark fades.
      const drift = byId(m.host, 'level-mark-drift')!;
      expect(drift.style.transform).toBe('translateX(0px)');
      expect(drift.style.transition).toContain('280ms');
      expect(box.style.opacity).toBe('0');
      expect(box.style.transition).toContain('140ms');
      expect(onSettled).not.toHaveBeenCalled();
      // A child's transition bubbling up does not count.
      const child = new Event('transitionend', { bubbles: true });
      Object.defineProperty(child, 'propertyName', { value: 'transform' });
      act(() => { drift.dispatchEvent(child); });
      expect(onSettled).not.toHaveBeenCalled();
      const ev = new Event('transitionend', { bubbles: true });
      Object.defineProperty(ev, 'propertyName', { value: 'opacity' });
      act(() => { box.dispatchEvent(ev); });
      expect(onSettled).toHaveBeenCalledTimes(1);
      act(() => { jest.advanceTimersByTime(2000); });
      act(() => { box.dispatchEvent(ev); });
      expect(onSettled).toHaveBeenCalledTimes(1);
      m.done();
    });

    it('with no transitionend, the backstop settles it at 340 + 150 ms', () => {
      const onSettled = jest.fn();
      const m = mount(<LevelMark size={64} onSettled={onSettled} />);
      m.rerender(<LevelMark size={64} onSettled={onSettled} done />);
      act(() => { jest.advanceTimersByTime(489); });
      expect(onSettled).not.toHaveBeenCalled();
      act(() => { jest.advanceTimersByTime(1); });
      expect(onSettled).toHaveBeenCalledTimes(1);
      m.done();
    });

    it("'fade' (< 28 px): 120 ms, backstop at 270", () => {
      const onSettled = jest.fn();
      const m = mount(<LevelMark size={20} onSettled={onSettled} />);
      m.rerender(<LevelMark size={20} onSettled={onSettled} done />);
      expect(byId(m.host, 'level-mark')!.style.transition).toContain('120ms');
      expect(byId(m.host, 'level-mark-drift')!.style.transform).toBe('');
      act(() => { jest.advanceTimersByTime(270); });
      expect(onSettled).toHaveBeenCalledTimes(1);
      m.done();
    });

    it('a restart (done true → false) swaps the drift to its byte-different twin and clears the pins', () => {
      const m = mount(<LevelMark size={64} />);
      const drift = byId(m.host, 'level-mark-drift')!;
      const before = cssOf(drift);
      m.rerender(<LevelMark size={64} done />);
      expect(drift.style.animation).toBe('none');
      m.rerender(<LevelMark size={64} done={false} />);
      expect(drift.style.animation).toBe('');
      expect(drift.style.transform).toBe('');
      const after = cssOf(drift);
      const name = (s: string) => /animation-name:([\w-]+)/.exec(s)?.[1];
      expect(name(after)).toBeTruthy();
      expect(name(after)).not.toBe(name(before));
      expect(after).toContain('animation-duration:700ms');
      expect(byId(m.host, 'level-mark')!.style.opacity).toBe('1');
      m.done();
    });
  });
});

describe('CraneSvg on the web', () => {
  it('288 → the composited crane: a 288 × 254.1 box, one 6000ms cycle, no svg', () => {
    const m = mount(<CraneSvg size={288} />);
    const crane = byId(m.host, 'crane-mark-web')!;
    expect(crane).not.toBeNull();
    expect(parseFloat(crane.style.width)).toBe(288);
    expect(parseFloat(crane.style.height)).toBeCloseTo(254.1, 1);
    expect(m.host.querySelector('svg')).toBeNull();
    expect(byId(m.host, 'level-mark')).toBeNull();
    for (const id of ['crane-trolley', 'crane-pendulum', 'crane-cable', 'crane-hook', 'crane-beam', 'crane-new-slab', 'crane-new-cols', 'crane-tower']) {
      const c = cssOf(byId(m.host, id)!);
      expect(c).toContain('animation-duration:6000ms');
      expect(c).toContain('animation-timing-function:linear');
      expect(c).toContain('animation-fill-mode:backwards');
    }
    expect(cssOf(byId(m.host, 'crane-trolley')!)).toMatch(/translateX\(/);
    expect(cssOf(byId(m.host, 'crane-pendulum')!)).toMatch(/rotate\(/);
    expect(cssOf(byId(m.host, 'crane-cable')!)).toMatch(/scaleY\(/);
    expect(insertedCss()).not.toContain('animation-fill-mode:both');
    m.done();
  });

  it('28 → the level, no crane', () => {
    const m = mount(<CraneSvg size={28} />);
    expect(byId(m.host, 'level-mark')).not.toBeNull();
    expect(byId(m.host, 'crane-mark-web')).toBeNull();
    m.done();
  });

  it("the beam's colour is the theme accent (a token, never a literal)", () => {
    const m = mount(<CraneSvg size={288} />);
    const beam = byId(m.host, 'crane-beam')!;
    expect((beam.getAttribute('style') ?? '').replace(/\s+/g, '')).toMatch(/26,43,60/);
    m.done();
  });

  it('Reduce Motion: a still crane — no animation classes on the rig', () => {
    setReduceMotion(true);
    const m = mount(<CraneSvg size={288} />);
    for (const id of ['crane-trolley', 'crane-pendulum', 'crane-hook', 'crane-beam', 'crane-tower']) {
      expect(cssOf(byId(m.host, id)!)).not.toContain('animation-name');
    }
    expect(byId(m.host, 'crane-trolley')!.getAttribute('style') ?? '').toMatch(/translateX/);
    m.done();
    setReduceMotion(false);
  });

  it('RN-web 0.21 emits a repeating-linear-gradient background (the lattice uses thin Views regardless)', () => {
    const s = StyleSheet.create({ p: { backgroundImage: 'repeating-linear-gradient(45deg, red 0px, red 1px, transparent 1px, transparent 4px)' } as object });
    const m = mount(<View testID="lattice-probe" style={s.p} />);
    const el = byId(m.host, 'lattice-probe')!;
    const all = cssOf(el) + (el.getAttribute('style') ?? '').replace(/\s+/g, '');
    expect(all).toContain('repeating-linear-gradient');
    m.done();
  });
});

describe('no ThemeProvider (BrandSplash renders outside it)', () => {
  beforeEach(() => { mockNoProvider = true; });
  afterEach(() => { mockNoProvider = false; });

  it("tone 'splash' and a token tone render without throwing", () => {
    const a = mount(<LevelMark tone="splash" size={168} revealDelayMs={0} exit="none" />);
    expect(byId(a.host, 'level-mark')).not.toBeNull();
    a.done();
    const b = mount(<LevelMark size={36} />);
    expect(byId(b.host, 'level-mark')).not.toBeNull();
    b.done();
  });

  it('the crane renders without throwing', () => {
    const m = mount(<CraneSvg size={180} />);
    expect(byId(m.host, 'crane-mark-web')).not.toBeNull();
    m.done();
  });
});
