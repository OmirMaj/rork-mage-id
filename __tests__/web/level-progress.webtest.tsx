/**
 * Web — the code-check laser really compiles to CSS in react-native-web 0.21
 * (loader lane CONTENT-B).
 *
 * On the web CodeCheckLoader starts NO Animated loop (RN-web would run it as a
 * JS rAF loop that freezes while the Construction AI screen is busy); the
 * laser and the review marks are CSS keyframes registered through
 * StyleSheet.create (components/loaders/css/codeCheckCss.ts). This mounts it in
 * a real DOM and reads what RN-web inserted: @keyframes with translateY, a
 * 3000ms string duration, fill mode backwards (never both) — and under
 * prefers-reduced-motion: reduce, no laser at all.
 */

import React, { act } from 'react';
import { Dimensions } from 'react-native';
import CodeCheckLoader from '@/components/CodeCheckLoader';
import { codeCheckLaserFrames } from '@/components/loaders/progressMath';

type Root = { render(node: React.ReactNode): void; unmount(): void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRoot } = require('react-dom/client') as { createRoot(el: Element): Root };

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
    useTheme: () => value,
  };
});

// A controllable prefers-reduced-motion. components/ui/motion reads it on the
// first useReducedMotion() call and then listens for changes.
let reduceMatches = true;
const reduceListeners = new Set<(e: { matches: boolean }) => void>();
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  writable: true,
  value: (q: string) => ({
    media: q,
    get matches() { return /prefers-reduced-motion:\s*reduce/.test(q) ? reduceMatches : false; },
    addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => { reduceListeners.add(fn); },
    removeEventListener: (_: string, fn: (e: { matches: boolean }) => void) => { reduceListeners.delete(fn); },
    addListener: (fn: (e: { matches: boolean }) => void) => { reduceListeners.add(fn); },
    removeListener: (fn: (e: { matches: boolean }) => void) => { reduceListeners.delete(fn); },
  }),
});

/** Every CSS rule RN-web has inserted into the document so far. */
function insertedCss(): string {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) out.push(rule.cssText);
    } catch { /* cross-origin sheets: none in jsdom */ }
  }
  for (const el of Array.from(document.querySelectorAll('style'))) out.push(el.textContent ?? '');
  return out.join('\n').replace(/\s+/g, '');
}

function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, done: () => { act(() => root.unmount()); host.remove(); } };
}

/** CodeCheckLoader's own sheet height for the current window. */
function sheetHeight(): number {
  const { width, height } = Dimensions.get('window');
  const sheetW = Math.max(0, Math.min(width - 72, 320));
  return Math.max(0, Math.min(Math.round(sheetW * 1.28), Math.round(height * 0.42)));
}

// jsdom lays nothing out, so RN-web's Dimensions reads a 0 × 0 window (a
// degenerate 0-px sheet whose laser never moves). Give it a desktop window.
beforeAll(() => {
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, get: () => 1280 });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, get: () => 800 });
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1280 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 800 });
  act(() => { window.dispatchEvent(new Event('resize')); });
  expect(sheetHeight()).toBeGreaterThan(100);
});

const STEPS = ['Reading your scope', 'Recalling the codes that apply', 'Writing it up'];

describe('CodeCheckLoader on the web (react-native-web)', () => {
  // ORDER MATTERS: RN-web's style sheet is per document, so the Reduce Motion
  // case runs first, before any laser class has ever been registered.
  it('prefers-reduced-motion: reduce → a static sheet: no laser element, no laser keyframes', () => {
    reduceMatches = true;
    const lastFrame = codeCheckLaserFrames(sheetHeight()).slice(-1)[0].transform!;
    const m = mount(<CodeCheckLoader steps={STEPS} activeStep={1} />);
    expect(m.host.querySelector('[data-testid="code-check-laser"]')).toBeNull();
    expect(m.host.querySelector('[data-testid="code-check-mark-0"]')).toBeNull();
    expect(insertedCss()).not.toContain(lastFrame.replace(/\s+/g, ''));
    expect(m.host.textContent).toContain('What MAGE checks');
    m.done();
  });

  it('motion allowed → @keyframes with translateY, animation-duration 3000ms, fill-mode backwards (never both)', () => {
    act(() => {
      reduceMatches = false;
      reduceListeners.forEach((fn) => fn({ matches: false }));
    });
    const frames = codeCheckLaserFrames(sheetHeight());
    const m = mount(<CodeCheckLoader steps={STEPS} activeStep={1} />);
    const laser = m.host.querySelector('[data-testid="code-check-laser"]') as HTMLElement | null;
    expect(laser).not.toBeNull();
    expect(laser!.className).not.toBe('');
    const css = insertedCss();
    expect(css).toMatch(/@(-webkit-)?keyframes/);
    expect(css).toContain('translateY(');
    expect(css).toContain(frames.slice(-1)[0].transform!.replace(/\s+/g, ''));
    expect(css).toContain('animation-duration:3000ms');
    expect(css).toContain('animation-fill-mode:backwards');
    expect(css).not.toContain('animation-fill-mode:both');
    expect(css).toContain('animation-iteration-count:infinite');
    expect(css).toContain('animation-timing-function:linear');
    // The five review marks are CSS too.
    for (let i = 0; i < 5; i++) {
      const mark = m.host.querySelector(`[data-testid="code-check-mark-${i}"]`) as HTMLElement | null;
      expect(mark).not.toBeNull();
      expect(mark!.className).not.toBe('');
    }
    m.done();
  });
});
