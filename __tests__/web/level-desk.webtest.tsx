/**
 * Web — "The Level" composed for laptops and monitors really renders that way
 * on react-native-web 0.21 (lane LOADERDESK).
 *
 * Mounts the real BrandSplash, BootShell and ScreenLoader with react-dom in
 * jsdom at a set window (documentElement.clientWidth/Height + innerWidth/Height
 * + a resize event, which is what RN-web's Dimensions reads; jsdom's default
 * 1024 is already 'tablet', so every case sets its size) and reads the DOM:
 *   - the launch mark box per tier (1440 laptop, 2560 monitor, 768 tablet);
 *   - the datum: two segments, scaled 0 until the bubble comes alive, pivoting
 *     on their INNER ends; full at once when BootShell adopts a live splash;
 *   - the large wordmark (Barlow 36) on a laptop, the tablet box (34 / 32);
 *   - the web launch is the GREEN brand (no orange anywhere in its CSS), and
 *     follows light / dark: a dark OS (or an in-app dark choice, the theme-boot
 *     data-theme tag) opens on WEB_LAUNCH_DARK, an in-app light choice on a
 *     dark OS stays light;
 *   - ScreenLoader: the level at the launch mark's width (screenLevelW) — 403 px
 *     with a theme datum on a 1440 laptop (light and dark), 167 px and no datum
 *     at 390, 640 px on a 2560 monitor;
 *   - Reduce Motion: the bubble breathes (no drift), the splash datum stays 0.
 */

import React, { act } from 'react';
import { Theme } from '@/constants/colors';

// ── matchMedia: installed before any render (the motion store reads it lazily)
type MqListener = (e: { matches: boolean }) => void;
const mqListeners: MqListener[] = [];
let mqReduce = false;
let mqDark = false;
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  writable: true,
  value: (q: string) => ({
    media: q,
    get matches() {
      if (/prefers-reduced-motion:\s*reduce/.test(q)) return mqReduce;
      if (/prefers-color-scheme:\s*dark/.test(q)) return mqDark;
      return false;
    },
    addEventListener: (_t: string, fn: MqListener) => { mqListeners.push(fn); },
    removeEventListener: () => {},
    addListener: (fn: MqListener) => { mqListeners.push(fn); },
    removeListener: () => {},
  }),
});
function setReduceMotion(on: boolean) {
  mqReduce = on;
  act(() => { mqListeners.forEach((fn) => fn({ matches: on })); });
}

let mockDark = false;
jest.mock('@/contexts/ThemeContext', () => {
  const c = jest.requireActual('@/constants/colors');
  const light = { colors: { ...c.Theme.light, ...c.deriveAccentPalette(c.getCustomPrimary(), 'light') }, resolved: 'light', pref: 'light', setPref: () => {} };
  const dark = { colors: { ...c.Theme.dark, ...c.deriveAccentPalette(c.getCustomPrimary(), 'dark') }, resolved: 'dark', pref: 'dark', setPref: () => {} };
  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
    useTheme: () => (mockDark ? dark : light),
  };
});

/* eslint-disable import/first */
import BrandSplash from '@/components/BrandSplash';
import BootShell from '@/components/loaders/BootShell';
import ScreenLoader from '@/components/loaders/ScreenLoader';
import { __resetLaunchCurtainForTests } from '@/components/launch/launchCurtain';
import { __resetSplashStageForTests, setSplashStage } from '@/components/launch/splashStage';
/* eslint-enable import/first */

type Root = { render(node: React.ReactNode): void; unmount(): void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRoot } = require('react-dom/client') as { createRoot(el: Element): Root };

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setWindow(w: number, h: number) {
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, get: () => w });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, get: () => h });
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: h });
  act(() => { window.dispatchEvent(new Event('resize')); });
}

function allRules(): CSSRule[] {
  const out: CSSRule[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try { out.push(...Array.from(sheet.cssRules)); } catch { /* none in jsdom */ }
  }
  return out;
}
/** The declarations the element's classes carry, plus its inline style, whitespace-free. */
function cssOf(el: Element): string {
  const classes = Array.from(el.classList);
  const own = allRules()
    .filter((r) => r instanceof CSSStyleRule && classes.some((c) => (r as CSSStyleRule).selectorText.split(/[\s,]+/).includes(`.${c}`)))
    .map((r) => r.cssText);
  return [...own, el.getAttribute('style') ?? ''].join('\n').replace(/\s+/g, '');
}
/** Every element's CSS under a host. */
function cssTree(host: Element): string {
  return [host, ...Array.from(host.querySelectorAll('*'))].map(cssOf).join('\n');
}
const byId = (host: Element, id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const px = (v: string) => Number.parseFloat(v);
/** r, g, b, a of a CSS colour string (rgb / rgba / #RRGGBB). */
function rgba(c: string): number[] {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c.trim());
  if (hex) return [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16), 1];
  const n = (c.match(/[\d.]+/g) ?? []).map(Number);
  return [n[0], n[1], n[2], n.length > 3 ? n[3] : 1];
}
const sameColour = (a: string, b: string) => {
  const x = rgba(a);
  const y = rgba(b);
  return x.every((v, i) => Math.abs(v - y[i]) < (i === 3 ? 0.011 : 0.5));
};

function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, done: () => { act(() => root.unmount()); host.remove(); } };
}
/** Let BrandSplash's reduce-motion probe resolve. */
async function flush() {
  await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
}

function expectBox(el: HTMLElement | null, left: number, top: number, w: number, h: number) {
  expect(el).not.toBeNull();
  const s = el!.style;
  expect(Math.abs(px(s.left) - left)).toBeLessThan(0.5);
  expect(Math.abs(px(s.top) - top)).toBeLessThan(0.5);
  expect(Math.abs(px(s.width) - w)).toBeLessThan(0.5);
  expect(Math.abs(px(s.height) - h)).toBeLessThan(0.5);
}

const ORANGE = /255,106,26|#ff6a1a/i;
const INK_GROUND = /11,13,16|#0b0d10/i;

beforeEach(() => {
  jest.useFakeTimers();
  __resetLaunchCurtainForTests();
  __resetSplashStageForTests();
});
afterEach(() => {
  if (mqReduce) setReduceMotion(false);
  mockDark = false;
  mqDark = false;
  document.documentElement.removeAttribute('data-theme');
  act(() => { jest.runOnlyPendingTimers(); });
  jest.useRealTimers();
  __resetLaunchCurtainForTests();
  __resetSplashStageForTests();
});

describe('the launch on a laptop (1440 × 900)', () => {
  it('BrandSplash frame 0: the 403.2 × 27.62 mark at 518.4 / 436.19, the datum at scale 0 pivoting on its inner ends, no wordmark, green', async () => {
    setWindow(1440, 900);
    const m = mount(<BrandSplash onDone={() => {}} live={false} />);
    await flush();
    expectBox(byId(m.host, 'brand-splash-mark'), 518.4, 436.19, 403.2, 27.62);
    const l = byId(m.host, 'brand-splash-datum-l')!;
    const r = byId(m.host, 'brand-splash-datum-r')!;
    expect(l).not.toBeNull();
    expect(r).not.toBeNull();
    expect(l.style.transform).toBe('scaleX(0)');
    expect(r.style.transform).toBe('scaleX(0)');
    expect(cssOf(l)).toContain('transform-origin:rightcenter');
    expect(cssOf(r)).toContain('transform-origin:leftcenter');
    // The datum: from the 86 px gutter to 24 px short of the level, on the centre line.
    expectBox(l, 86, 445.5, 408.4, 9);
    expectBox(r, 945.6, 445.5, 408.4, 9);
    expect(byId(m.host, 'brand-splash-wordmark')).toBeNull();
    const css = cssTree(m.host);
    expect(css).not.toMatch(ORANGE);
    expect(css).not.toMatch(INK_GROUND);
    const bubble = byId(m.host, 'level-mark-bubble')!;
    expect(sameColour(bubble.style.backgroundColor, Theme.light.bg)).toBe(false);
    expect(sameColour(bubble.style.backgroundColor, '#2F6B3A')).toBe(true);
    m.done();
  });

  it('BootShell: the same mark box; adopting a live splash puts the datum at full at once and the wordmark at rest in Barlow 36', () => {
    setWindow(1440, 900);
    const m = mount(<BootShell />);
    expectBox(byId(m.host, 'boot-shell-mark'), 518.4, 436.19, 403.2, 27.62);
    expect(byId(m.host, 'boot-shell-datum-l')!.style.transform).toBe('scaleX(0)');
    expect(byId(m.host, 'boot-shell-wordmark')).toBeNull();
    act(() => { setSplashStage({ alive: true, wordmark: true, finished: true }); });
    expect(byId(m.host, 'boot-shell-datum-l')!.style.transform).toBe('scaleX(1)');
    expect(byId(m.host, 'boot-shell-datum-r')!.style.transform).toBe('scaleX(1)');
    const wm = byId(m.host, 'boot-shell-wordmark')!;
    expect(wm).not.toBeNull();
    // Laptop: a 42 px box whose bottom edge is 40 px above the level's centre line.
    expect(px(wm.style.top)).toBeCloseTo(450 - 40 - 42, 3);
    expect(px(wm.style.height)).toBe(42);
    const text = wm.querySelector('[dir], div, span') as HTMLElement;
    const t = cssOf(text) + cssTree(wm);
    expect(t).toContain('font-size:36px');
    expect(t).toContain('Barlow_600SemiBold');
    expect(cssTree(m.host)).not.toMatch(ORANGE);
    m.done();
  });
});

describe('the launch on a monitor and a tablet', () => {
  it('2560 × 1440: a 640 px mark at 960 / 698.08', async () => {
    setWindow(2560, 1440);
    const m = mount(<BrandSplash onDone={() => {}} live={false} />);
    await flush();
    expectBox(byId(m.host, 'brand-splash-mark'), 960, 698.08, 640, 43.84);
    m.done();
  });

  it('768 × 1024: a 240 px mark and the tablet wordmark box (34 tall, 32 above the centre line)', () => {
    setWindow(768, 1024);
    const m = mount(<BootShell />);
    expectBox(byId(m.host, 'boot-shell-mark'), 264, 503.78, 240, 16.44);
    act(() => { setSplashStage({ alive: true, wordmark: true, finished: true }); });
    const wm = byId(m.host, 'boot-shell-wordmark')!;
    expect(px(wm.style.top)).toBeCloseTo(512 - 32 - 34, 3);
    expect(px(wm.style.height)).toBe(34);
    expect(cssTree(wm)).toContain('font-size:28px');
    m.done();
  });

  it('390 × 844 (the web phone): no datum, the phone rect — and still the green launch', async () => {
    setWindow(390, 844);
    const m = mount(<BrandSplash onDone={() => {}} live={false} />);
    await flush();
    expect(byId(m.host, 'brand-splash-datum-l')).toBeNull();
    const w = (438 * 390) / 1024;
    expectBox(byId(m.host, 'brand-splash-mark'), 195 - w / 2, 422 - (w * 30) / 438 / 2, w, (w * 30) / 438);
    expect(cssTree(m.host)).not.toMatch(ORANGE);
    m.done();
  });
});

describe('the web launch follows light / dark (no light flash before the dark app)', () => {
  const DARK_GROUND = /21,24,22|#151816/i;
  const LIGHT_GROUND = /236,237,233|#ecede9/i;
  const DARK_INK = /244,239,230|#f4efe6/i;

  it('a dark OS, no tag: BrandSplash on a laptop paints WEB_LAUNCH_DARK — green-black ground, on-dark green bubble, dark-ink datum', async () => {
    mqDark = true;
    setWindow(1440, 900);
    const m = mount(<BrandSplash onDone={() => {}} live={false} />);
    await flush();
    const css = cssTree(m.host);
    expect(css).toMatch(DARK_GROUND);
    expect(css).not.toMatch(LIGHT_GROUND);
    expect(css).not.toMatch(ORANGE);
    expect(sameColour(byId(m.host, 'level-mark-bubble')!.style.backgroundColor, '#5DB36E')).toBe(true);
    for (const id of ['brand-splash-datum-l', 'brand-splash-datum-r']) {
      const line = byId(m.host, id)!.firstElementChild as HTMLElement;
      expect(sameColour(line.style.backgroundColor, Theme.dark.text)).toBe(true);
    }
    m.done();
  });

  it('a dark OS, no tag: BootShell on the web phone has the dark ground and, adopted, the dark-ink wordmark', () => {
    mqDark = true;
    setWindow(390, 844);
    const m = mount(<BootShell />);
    expect(cssTree(m.host)).toMatch(DARK_GROUND);
    expect(cssTree(m.host)).not.toMatch(LIGHT_GROUND);
    expect(sameColour(byId(m.host, 'level-mark-bubble')!.style.backgroundColor, '#5DB36E')).toBe(true);
    act(() => { setSplashStage({ alive: true, wordmark: true, finished: true }); });
    expect(cssTree(byId(m.host, 'boot-shell-wordmark')!)).toMatch(DARK_INK);
    m.done();
  });

  it("an in-app LIGHT choice on a dark OS (data-theme='light') keeps the light launch", async () => {
    mqDark = true;
    document.documentElement.setAttribute('data-theme', 'light');
    setWindow(1440, 900);
    const m = mount(<BrandSplash onDone={() => {}} live={false} />);
    await flush();
    expect(cssTree(m.host)).toMatch(LIGHT_GROUND);
    expect(cssTree(m.host)).not.toMatch(DARK_GROUND);
    expect(sameColour(byId(m.host, 'level-mark-bubble')!.style.backgroundColor, '#2F6B3A')).toBe(true);
    m.done();
  });

  it("an in-app DARK choice on a light OS (data-theme='dark') opens dark", () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    setWindow(1440, 900);
    const m = mount(<BootShell />);
    expect(cssTree(m.host)).toMatch(DARK_GROUND);
    expect(sameColour(byId(m.host, 'level-mark-bubble')!.style.backgroundColor, '#5DB36E')).toBe(true);
    const line = byId(m.host, 'boot-shell-datum-l')!.firstElementChild as HTMLElement;
    expect(sameColour(line.style.backgroundColor, Theme.dark.text)).toBe(true);
    m.done();
  });
});

describe('ScreenLoader (the full-screen gate)', () => {
  const muted = { light: Theme.light.textMuted, dark: Theme.dark.textMuted };

  it.each([['light', false], ['dark', true]] as const)('1440 laptop, %s: a 403 px level (the launch mark\'s width) on a theme datum (textMuted × 0.3)', (name, dark) => {
    mockDark = dark;
    setWindow(1440, 900);
    const m = mount(<ScreenLoader caption="Loading" />);
    const mark = byId(m.host, 'level-mark')!;
    expect(px(mark.style.width)).toBe(403);
    for (const id of ['screen-loader-datum-l', 'screen-loader-datum-r']) {
      const seg = byId(m.host, id)!;
      expect(seg).not.toBeNull();
      expect(seg.style.opacity).toBe('0.3');
      const line = seg.firstElementChild as HTMLElement;
      expect(sameColour(line.style.backgroundColor, muted[name])).toBe(true);
    }
    // The laptop caption: Type.headline 17 / 22.
    expect(cssTree(byId(m.host, 'screen-loader')!)).toContain('font-size:17px');
    m.done();
  });

  it('390 web phone: a 167 px level (the launch mark\'s width, not the old 64), no datum', () => {
    setWindow(390, 844);
    const m = mount(<ScreenLoader />);
    expect(px(byId(m.host, 'level-mark')!.style.width)).toBe(167);
    expect(byId(m.host, 'screen-loader-datum-l')).toBeNull();
    expect(byId(m.host, 'screen-loader-datum-r')).toBeNull();
    m.done();
  });

  it('2560 monitor: a 640 px level', () => {
    setWindow(2560, 1440);
    const m = mount(<ScreenLoader />);
    expect(px(byId(m.host, 'level-mark')!.style.width)).toBe(640);
    m.done();
  });
});

describe('Reduce Motion', () => {
  it('ScreenLoader on a laptop: the bubble breathes (1120 ms), no drift class; the datum is still and visible', () => {
    setReduceMotion(true);
    setWindow(1440, 900);
    const m = mount(<ScreenLoader />);
    expect(cssOf(byId(m.host, 'level-mark-bubble')!)).toContain('animation-duration:1120ms');
    expect(cssOf(byId(m.host, 'level-mark-drift')!)).not.toContain('animation-name');
    const seg = byId(m.host, 'screen-loader-datum-l')!;
    expect(seg.style.transform).toBe('');
    expect(seg.style.opacity).toBe('0.3');
    m.done();
  });

  it('BrandSplash on a laptop: a still level (no drift class anywhere) and the datum stays at scale 0', async () => {
    setReduceMotion(true);
    setWindow(1440, 900);
    const m = mount(<BrandSplash onDone={() => {}} />);
    await flush();
    act(() => { jest.advanceTimersByTime(1200); });
    expect(byId(m.host, 'level-mark-drift')).toBeNull();
    expect(cssTree(byId(m.host, 'brand-splash-mark')!)).not.toContain('animation-name');
    expect(byId(m.host, 'brand-splash-datum-l')!.style.transform).toBe('scaleX(0)');
    m.done();
  });
});
