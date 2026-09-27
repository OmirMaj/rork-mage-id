/**
 * Wave 6d restore (d6r), lane Z1 — real-DOM proof for the desktop web header
 * and the print fit (jsdom + react-dom + react-native-web, the stack
 * app.mageid.app runs).
 *
 * 1. HEADER. native-stack on web draws the root Stack's header full width,
 *    outside DesktopPageFrame's centred column; components/desktop/
 *    DesktopStackHeader renders the same elements <Header> with its left and
 *    right containers inset by headerInsetFor(its own width, the route's
 *    Layout.page column). At a 1512 window with the 240 sidebar the header is
 *    1272 wide, so a 'form' route (760) moves in by 256 on each side —
 *    header 496–1256, the column's exact span — and a 'bleed' route by 0.
 *    With the 64 px rail (1448 wide) the form inset is 344.
 *    The header's width here is useContainerWidth's first-paint estimate (the
 *    window minus the sidebar): jsdom has no ResizeObserver, so RN-web never
 *    fires onLayout — the same numbers the measured width gives in a browser.
 *    Known, accepted (utils/desktopHeader): /rfi and /submittal are 'table'
 *    routes, so an open editor's header gets the 1600 inset — 0 up to a 1600
 *    px stack, then 360 at 2560 (a 760 column would get 780).
 *
 * 2. PRINT FIT. hooks/usePrintFit on web: the root carries data-print="fit";
 *    `beforeprint` sets --mage-print-fit from the root's full scroll width and
 *    appends the landscape @page; `afterprint` removes both; a root that is
 *    not rendered (display:none — a screen hidden under the printed one) does
 *    nothing.
 *
 * Run: npx jest --config __tests__/web/jest.web.config.js __tests__/web/desktop-stack-header.webtest.tsx
 */

import React, { act } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaProviderCompat } from '@react-navigation/elements';
import { DefaultTheme, NavigationContext, ThemeProvider } from '@react-navigation/native';
import type { NativeStackHeaderProps } from '@react-navigation/native-stack';
// jest.mock below is hoisted above these imports (babel-jest).
import { renderDesktopStackHeader } from '@/components/desktop/DesktopStackHeader';
import { usePrintFit } from '@/hooks/usePrintFit';
import { PRINT_FIT_VAR, PRINT_PAGE_CSS, PRINT_PAGE_STYLE_ID } from '@/utils/printFit';

type Root = { render(node: React.ReactNode): void; unmount(): void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRoot } = require('react-dom/client') as { createRoot(el: Element): Root };

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no ResizeObserver; elements' FrameSizeProvider (inside
// SafeAreaProviderCompat) subscribes to one. A no-op stand-in: the header's
// width comes from useContainerWidth's estimate here (see the header note).
const g = globalThis as { ResizeObserver?: unknown };
if (typeof g.ResizeObserver === 'undefined') {
  g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

// ── The layout gate: a 1512 desktop web window with a 240 sidebar (or rail) ─
let mockWidth = 1512;
let mockSidebar = 240;
jest.mock('@/utils/useResponsiveLayout', () => ({
  useResponsiveLayout: () => ({
    screenSize: 'desktop',
    isPhone: false,
    isTablet: false,
    isDesktop: true,
    width: mockWidth,
    height: 945,
    contentMaxWidth: 1280,
    sidebarWidth: mockSidebar,
    showSidebar: true,
    ganttRowHeight: 40,
  }),
}));

const roots: { root: Root; el: HTMLElement }[] = [];
async function mount(node: React.ReactElement): Promise<HTMLElement> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push({ root, el });
  await act(async () => { root.render(node); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return el;
}
afterEach(async () => {
  for (const { root, el } of roots.splice(0)) {
    await act(async () => { root.unmount(); });
    el.remove();
  }
  mockWidth = 1512;
  mockSidebar = 240;
});

// ── 1. The header ──────────────────────────────────────────────────────────
function headerProps(routeName: string, goBack: () => void): NativeStackHeaderProps {
  const navigation = { goBack, isFocused: () => true, getState: () => undefined } as unknown as NativeStackHeaderProps['navigation'];
  return {
    back: { title: 'Back', href: undefined },
    options: { headerBackTitle: 'Back', headerRight: () => <Text testID="hdr-right">Right</Text> },
    route: { key: `${routeName}-1`, name: routeName } as NativeStackHeaderProps['route'],
    navigation,
  };
}
async function mountHeader(routeName: string, goBack: () => void = jest.fn()): Promise<HTMLElement> {
  const props = headerProps(routeName, goBack);
  return mount(
    <SafeAreaProviderCompat>
      <ThemeProvider value={DefaultTheme}>
        <NavigationContext.Provider value={props.navigation as unknown as React.ContextType<typeof NavigationContext>}>
          {renderDesktopStackHeader(props)}
        </NavigationContext.Provider>
      </ThemeProvider>
    </SafeAreaProviderCompat>,
  );
}
/** The Back button's container and the right container: the nearest
 *  ancestors of the Back button / the right-hand node that carry an inline
 *  margin style (elements' Header gives both an inline marginStart/End). */
function backButton(host: HTMLElement): HTMLElement {
  const b = host.querySelector<HTMLElement>('[aria-label="Go back"]')
    ?? host.querySelector<HTMLElement>('[role="button"]')
    ?? host.querySelector<HTMLElement>('a');
  if (!b) throw new Error('no Back button rendered');
  return b;
}
function containerOf(node: HTMLElement, side: 'start' | 'end'): HTMLElement {
  const logical = side === 'start' ? 'marginInlineStart' : 'marginInlineEnd';
  const physical = side === 'start' ? 'marginLeft' : 'marginRight';
  let n: HTMLElement | null = node;
  while (n) {
    const s = n.style as unknown as Record<string, string>;
    if ((s[logical] ?? '') !== '' || (s[physical] ?? '') !== '') return n;
    n = n.parentElement;
  }
  throw new Error(`no ${side} container with an inline margin`);
}
function marginOf(node: HTMLElement, side: 'start' | 'end'): string {
  const s = node.style as unknown as Record<string, string>;
  const logical = side === 'start' ? 'marginInlineStart' : 'marginInlineEnd';
  const physical = side === 'start' ? 'marginLeft' : 'marginRight';
  return (s[logical] || s[physical] || '').trim();
}

describe('DesktopStackHeader — the header lines up with the page column', () => {
  it("'notifications-settings' (form 760) at 1512 with the 240 sidebar: 256 px on each side (header 496–1256)", async () => {
    const host = await mountHeader('notifications-settings');
    expect(marginOf(containerOf(backButton(host), 'start'), 'start')).toBe('256px');
    const right = host.querySelector<HTMLElement>('[data-testid="hdr-right"]');
    expect(right).not.toBeNull();
    expect(marginOf(containerOf(right!, 'end'), 'end')).toBe('256px');
  });

  it("'leads' (bleed) gets inset 0: exactly native-stack's own header", async () => {
    const host = await mountHeader('leads');
    expect(marginOf(containerOf(backButton(host), 'start'), 'start')).toBe('0px');
  });

  it("'aia-pay-app' (table 1600) at 1512: the 1272 header is narrower than the column — inset 0", async () => {
    const host = await mountHeader('aia-pay-app');
    expect(marginOf(containerOf(backButton(host), 'start'), 'start')).toBe('0px');
  });

  it('with the 64 px rail (header 1448) a form route moves in by 344', async () => {
    mockSidebar = 64;
    const host = await mountHeader('tutorials');
    expect(marginOf(containerOf(backButton(host), 'start'), 'start')).toBe('344px');
  });

  it('at 2560 a form route moves in by 780 (header 1020–1780, the span 6b measured for the column)', async () => {
    mockWidth = 2560;
    const host = await mountHeader('notifications-settings');
    expect(marginOf(containerOf(backButton(host), 'start'), 'start')).toBe('780px');
  });

  it("a shell-exempt route ('estimate-wizard', form 760) has no sidebar: first paint uses the whole 1512 window — inset 376, not 256", async () => {
    // The 240 sidebar is still mocked on: the exempt estimate must ignore it.
    const host = await mountHeader('estimate-wizard');
    expect(marginOf(containerOf(backButton(host), 'start'), 'start')).toBe('376px');
    const right = host.querySelector<HTMLElement>('[data-testid="hdr-right"]');
    expect(right).not.toBeNull();
    expect(marginOf(containerOf(right!, 'end'), 'end')).toBe('376px');
  });

  it('pressing Back calls navigation.goBack', async () => {
    const goBack = jest.fn();
    const host = await mountHeader('notifications-settings', goBack);
    await act(async () => {
      backButton(host).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    });
    // HeaderBackButton defers onPress by one animation frame.
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it('the title is the route title, rendered once', async () => {
    const props = headerProps('notifications-settings', jest.fn());
    props.options = { ...props.options, title: 'Notifications' };
    const host = await mount(
      <SafeAreaProviderCompat>
        <ThemeProvider value={DefaultTheme}>
          <NavigationContext.Provider value={props.navigation as unknown as React.ContextType<typeof NavigationContext>}>
            {renderDesktopStackHeader(props)}
          </NavigationContext.Provider>
        </ThemeProvider>
      </SafeAreaProviderCompat>,
    );
    const hits = Array.from(host.querySelectorAll('*')).filter((n) => n.childElementCount === 0 && n.textContent === 'Notifications');
    expect(hits.length).toBe(1);
  });
});

// ── 2. The print fit ───────────────────────────────────────────────────────
function Canvas({ enabled, hidden }: { enabled: boolean; hidden?: boolean }) {
  const printFit = usePrintFit(enabled);
  return (
    <View style={hidden ? { display: 'none' } : null}>
      <View ref={printFit.ref} testID="fit-root" {...printFit.printProps}>
        <ScrollView horizontal testID="fit-scroller">
          <View style={{ width: 3000, height: 10 }} />
        </ScrollView>
      </View>
    </View>
  );
}
/** jsdom does no layout: give the root and the scroller the box a browser
 *  would (root 1200 wide; the timeline scroller 1000 wide, 2960 of content). */
function giveLayout(host: HTMLElement): { root: HTMLElement; scroller: HTMLElement } {
  const root = host.querySelector<HTMLElement>('[data-testid="fit-root"]')!;
  const scroller = host.querySelector<HTMLElement>('[data-testid="fit-scroller"]')!;
  const box = (el: HTMLElement, client: number, scroll: number) => {
    Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => client });
    Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => scroll });
  };
  box(root, 1200, 1200);
  box(scroller, 1000, 2960);
  return { root, scroller };
}
const rendered = (el: HTMLElement, yes: boolean) => {
  Object.defineProperty(el, 'getClientRects', {
    configurable: true,
    value: () => (yes ? [{ width: 1, height: 1 }] : []),
  });
};

describe('usePrintFit — Cmd+P zooms a wide canvas onto the sheet', () => {
  it('tags the root data-print="fit"; beforeprint sets the zoom and a landscape page; afterprint removes both', async () => {
    const host = await mount(<Canvas enabled />);
    const { root } = giveLayout(host);
    rendered(root, true);
    expect(root.getAttribute('data-print')).toBe('fit');
    expect(window.getComputedStyle(host.querySelector('[data-testid="fit-scroller"]')!).overflowX).toMatch(/auto|scroll/);

    await act(async () => { window.dispatchEvent(new Event('beforeprint')); });
    // need = 1200 + (2960 − 1000) = 3160 → 980 / 3160
    expect(Number(root.style.getPropertyValue(PRINT_FIT_VAR))).toBeCloseTo(980 / 3160, 6);
    const page = document.getElementById(PRINT_PAGE_STYLE_ID);
    expect(page?.textContent).toBe(PRINT_PAGE_CSS);

    await act(async () => { window.dispatchEvent(new Event('afterprint')); });
    expect(root.style.getPropertyValue(PRINT_FIT_VAR)).toBe('');
    expect(document.getElementById(PRINT_PAGE_STYLE_ID)).toBeNull();
  });

  it('unmounting mid-print removes the zoom and the page style', async () => {
    const host = await mount(<Canvas enabled />);
    const { root } = giveLayout(host);
    rendered(root, true);
    await act(async () => { window.dispatchEvent(new Event('beforeprint')); });
    expect(document.getElementById(PRINT_PAGE_STYLE_ID)).not.toBeNull();
    const { root: r, el } = roots.pop()!;
    await act(async () => { r.unmount(); });
    el.remove();
    expect(document.getElementById(PRINT_PAGE_STYLE_ID)).toBeNull();
  });

  it('a root that is not rendered (display:none) sets nothing', async () => {
    const host = await mount(<Canvas enabled hidden />);
    const { root } = giveLayout(host);
    rendered(root, false);
    await act(async () => { window.dispatchEvent(new Event('beforeprint')); });
    expect(root.style.getPropertyValue(PRINT_FIT_VAR)).toBe('');
    expect(document.getElementById(PRINT_PAGE_STYLE_ID)).toBeNull();
  });

  it('disabled (a phone-width window): no data-print tag and no listener', async () => {
    const host = await mount(<Canvas enabled={false} />);
    const { root } = giveLayout(host);
    rendered(root, true);
    expect(root.getAttribute('data-print')).toBeNull();
    await act(async () => { window.dispatchEvent(new Event('beforeprint')); });
    expect(root.style.getPropertyValue(PRINT_FIT_VAR)).toBe('');
    expect(document.getElementById(PRINT_PAGE_STYLE_ID)).toBeNull();
  });
});
