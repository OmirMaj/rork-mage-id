/**
 * Web — the motion registry really compiles in react-native-web 0.21 (lane 1
 * of the smoothness pass).
 *
 * An inline style object with `animationKeyframes` is silently dropped by
 * RN-web, and a numeric duration becomes px; neither fails loudly. This mounts
 * the registered styles into a real DOM and reads the CSS RN-web inserted, so
 * a regression in either shows up here rather than as a page that just stops
 * moving.
 */

import React, { act } from 'react';
import { View } from 'react-native';
import { registerWithMotion, webMotion } from '@/components/ui/motion';

type Root = { render(node: React.ReactNode): void; unmount(): void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRoot } = require('react-dom/client') as { createRoot(el: Element): Root };

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

describe('web motion registry (react-native-web)', () => {
  it('a keyframe entry compiles to @keyframes + a class with string durations', () => {
    const style = webMotion('popIn');
    expect(style).not.toBeNull();
    const m = mount(<View testID="pop" style={style} />);
    const css = insertedCss();
    expect(css).toMatch(/@(-webkit-)?keyframes/);
    expect(css).toContain('translateY(6px)scale(0.98)');
    expect(css).toContain('animation-duration:180ms');
    expect(css).toContain('animation-fill-mode:backwards');
    expect(css).not.toContain('animation-fill-mode:both');
    const el = m.host.querySelector('[data-testid="pop"]') as HTMLElement;
    expect(el.className).not.toBe('');
    m.done();
  });

  it('a glide compiles to a 120 ms colour-only transition', () => {
    const m = mount(<View style={webMotion('bgGlide')} />);
    const css = insertedCss();
    expect(css).toContain('transition-duration:120ms');
    expect(css).toContain('transition-property:background-color,border-color,box-shadow,filter');
    m.done();
  });

  it('registerWithMotion keeps the base and adds the entry in one registered style', () => {
    const style = registerWithMotion({ maxWidth: 560, borderRadius: 18 }, 'slideInRight');
    const m = mount(<View testID="card" style={style} />);
    const css = insertedCss();
    expect(css).toContain('translateX(16px)');
    expect(css).toContain('animation-duration:200ms');
    const el = m.host.querySelector('[data-testid="card"]') as HTMLElement;
    const all = insertedCss() + (el.getAttribute('style') ?? '');
    expect(all).toMatch(/max-width:560px/);
    m.done();
  });
});
