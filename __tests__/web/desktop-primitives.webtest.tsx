/**
 * Real-DOM proof for the wave-6b desktop primitives (lane L4) — jsdom +
 * react-dom + react-native-web, the stack app.mageid.app actually runs.
 *
 * The native smoke suite (__tests__/smoke/desktop-primitives.test.tsx) mounts
 * these at 1512 with Platform.OS patched, but on React Native's renderer: no
 * <a>, no DOM click, no react-native-web TextInput. Two bugs lived exactly in
 * that gap (review of 2026-09-23):
 *
 *   1. A DataTable row / KpiStrip cell with an href hard-reloaded the whole
 *      app on a plain click. expo-router's Link spreads a caller's `onPress`
 *      over its own navigation handler, and react-native-web's Pressable
 *      drops the onClick copy — so nothing called preventDefault and the
 *      browser followed the <a href>.
 *   2. Cmd+Enter / Cmd+S / Esc typed inside a field never reached the
 *      shortcut registry: react-native-web's TextInput stops keydown
 *      propagation, and the registry listened on window in the bubble phase.
 *   4. (third review) in SplitView SINGLE mode (container < 1100) the list is
 *      kept mounted behind display:none while the record fills the pane,
 *      and that invisible table kept every key: Esc cleared a search he
 *      could not see (Esc looked broken), '/' focused an invisible box,
 *      Cmd+A ticked invisible rows. And ↑/↓ stepped records instead of
 *      scrolling the one he was reading.
 *   5. (fourth review) the same hidden-keys bug one level up: expo-router's
 *      Stack keeps the screen UNDER a pushed detail route mounted behind
 *      display:none, and its table / primary action kept their keys — '/'
 *      typed into an invisible search box, Enter opened a row of the hidden
 *      list, Cmd+S saved the screen underneath. And crossing 1100 px (the AI
 *      dock opening) remounted a SplitView's list, wiping his search.
 *   3. (second review) j/k inside a SplitView stepped the screen's RAW row
 *      order while the table showed a sorted / searched order: j opened the
 *      row above, or one the search had hidden. And Esc's meaning (clear the
 *      search vs close the record) depended on which binding re-registered
 *      last.
 *
 * Every assertion below clicks or types on a real DOM node.
 *
 * Run: npx jest --config __tests__/web/jest.web.config.js
 */

import React, { act, useState } from 'react';
import { Dimensions, Text, TextInput } from 'react-native';

// The repo has no @types/react-dom (the app never imports react-dom itself —
// react-native-web does), so type the two calls this harness needs.
type Root = { render(node: React.ReactNode): void; unmount(): void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRoot } = require('react-dom/client') as { createRoot(el: Element): Root };

// expo-router's Link navigates through routing.linkTo — observe it without a
// mounted navigator.
const mockLinkTo = jest.fn();
jest.mock('expo-router/build/global-state/routing', () => {
  const actual = jest.requireActual('expo-router/build/global-state/routing');
  return { ...actual, linkTo: (...a: unknown[]) => mockLinkTo(...a) };
});
const mockNavigate = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return {
    ...actual,
    useRouter: () => ({ navigate: mockNavigate, push: mockPush, setParams: jest.fn(), back: jest.fn() }),
  };
});
jest.mock('@/utils/alert', () => ({ showAlert: jest.fn(), showPrompt: jest.fn() }));

import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { DataTable } from '@/components/desktop/DataTable';
import { SplitView } from '@/components/desktop/SplitView';
import { KpiStrip } from '@/components/desktop/KpiStrip';
import { hotkeys, useHotkeys, usePrimaryAction } from '@/hooks/useHotkeys';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let viewportWidth = 1512;
jest.spyOn(Dimensions, 'get').mockImplementation(
  () => ({ width: viewportWidth, height: 945, scale: 2, fontScale: 1 }) as ReturnType<typeof Dimensions.get>,
);

const roots: { root: Root; el: HTMLElement }[] = [];
async function mount(node: React.ReactElement): Promise<HTMLElement> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push({ root, el });
  await act(async () => { root.render(<ThemeProvider>{node}</ThemeProvider>); });
  return el;
}
afterEach(async () => {
  for (const { root, el } of roots.splice(0)) {
    await act(async () => { root.unmount(); });
    el.remove();
  }
  viewportWidth = 1512;
  mockLinkTo.mockClear();
  mockNavigate.mockClear();
  mockPush.mockClear();
});

async function click(target: Element, init: MouseEventInit = {}): Promise<MouseEvent> {
  const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  await act(async () => { target.dispatchEvent(ev); });
  return ev;
}
async function keydown(target: EventTarget, init: KeyboardEventInit): Promise<KeyboardEvent> {
  const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  await act(async () => { target.dispatchEvent(ev); });
  return ev;
}

type Row = { id: string; title: string };
const ROWS: Row[] = [{ id: 'a', title: 'Alpha' }, { id: 'b', title: 'Bravo' }];
function table(onRowOpen?: (r: Row) => void) {
  return (
    <DataTable<Row>
      tableId="webtest"
      testID="tbl"
      columns={[{ key: 'title', label: 'Title' }]}
      rows={ROWS}
      rowKey={(r) => r.id}
      getRowHref={(r) => ({ pathname: '/rfi', params: { rfiId: r.id } })}
      onRowOpen={onRowOpen}
      renderCard={(r) => <Text>{r.title}</Text>}
    />
  );
}

describe('DataTable rows are real links that never reload the app', () => {
  it('no onRowOpen: a plain click routes in-app (linkTo) and cancels the browser navigation', async () => {
    const el = await mount(table());
    const a = el.querySelector('a[href*="/rfi"]');
    expect(a).not.toBeNull();
    const ev = await click(a!);
    expect(mockLinkTo).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true); // false = full page reload
  });

  it('no onRowOpen: Cmd-click is left to the browser (new tab), the app does not route', async () => {
    const el = await mount(table());
    const ev = await click(el.querySelector('a')!, { metaKey: true });
    expect(mockLinkTo).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it('onRowOpen (SplitView): a plain click opens in place — no route, no reload; Cmd-click → new tab', async () => {
    const open = jest.fn();
    const el = await mount(table(open));
    const plain = await click(el.querySelector('a')!);
    expect(open).toHaveBeenCalledWith(ROWS[0]);
    expect(mockLinkTo).not.toHaveBeenCalled();
    expect(plain.defaultPrevented).toBe(true);
    const cmd = await click(el.querySelector('a')!, { metaKey: true });
    expect(open).toHaveBeenCalledTimes(1);
    expect(cmd.defaultPrevented).toBe(false);
  });
});

describe('KpiStrip cells with an href never reload the app', () => {
  const cells = (onPress?: () => void) => [
    { key: 'rfis', label: 'Open RFIs', value: 3, href: '/rfi' as const },
    { key: 'owed', label: 'Owed', value: '$1,200', href: '/invoice' as const, onPress },
    { key: 'x', label: 'x', value: 1 },
    { key: 'y', label: 'y', value: 2 },
  ];

  it('href only: plain click routes in-app and cancels the browser navigation', async () => {
    const el = await mount(<KpiStrip cells={cells()} />);
    const ev = await click(el.querySelector('a[href="/rfi"]')!);
    expect(mockLinkTo).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('href + onPress: runs onPress, then navigates in-app exactly once; Cmd-click runs onPress, browser opens the tab', async () => {
    const onPress = jest.fn();
    const el = await mount(<KpiStrip cells={cells(onPress)} />);
    const a = el.querySelector('a[href="/invoice"]')!;
    const ev = await click(a);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/invoice');
    expect(mockNavigate.mock.calls.length + mockLinkTo.mock.calls.length).toBe(1);
    expect(ev.defaultPrevented).toBe(true);
    const cmd = await click(a, { metaKey: true });
    expect(onPress).toHaveBeenCalledTimes(2);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(cmd.defaultPrevented).toBe(false);
  });
});

describe('useHotkeys hears keys typed in a react-native-web TextInput', () => {
  const save = jest.fn();
  const esc = jest.fn();
  const j = jest.fn();
  function Editor() {
    usePrimaryAction(save, { label: 'Save RFI' });
    useHotkeys([{ combo: 'escape', handler: esc }, { combo: 'j', handler: j }]);
    return <TextInput testID="question" />;
  }
  beforeEach(() => { save.mockClear(); esc.mockClear(); j.mockClear(); });

  it('Cmd+Enter, Cmd+S and Esc from inside the field reach the registry, each exactly once', async () => {
    const el = await mount(<Editor />);
    const input = el.querySelector('input')!;
    input.focus();
    const enter = await keydown(input, { key: 'Enter', metaKey: true });
    const s = await keydown(input, { key: 's', ctrlKey: true });
    await keydown(input, { key: 'Escape' });
    expect(save).toHaveBeenCalledTimes(2);
    expect(esc).toHaveBeenCalledTimes(1);
    expect(enter.defaultPrevented).toBe(true);
    expect(s.defaultPrevented).toBe(true); // no "Save page as…" over the RFI
  });

  it('plain keys typed in the field stay the field\'s (j types a j)', async () => {
    const el = await mount(<Editor />);
    const input = el.querySelector('input')!;
    const ev = await keydown(input, { key: 'j' });
    expect(j).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it('outside a field the same keys fire once (bubble phase, no double handling)', async () => {
    await mount(<Editor />);
    await keydown(document.body, { key: 'j' });
    await keydown(document.body, { key: 'Enter', metaKey: true });
    expect(j).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('a plain DOM <input> (one that does NOT stop propagation) still fires exactly once', async () => {
    // Web-only widgets and third-party fields let keydown bubble to window.
    // Capture reads their typing keys; the bubble listener must then skip them.
    await mount(<Editor />);
    const raw = document.createElement('input');
    document.body.appendChild(raw);
    await keydown(raw, { key: 'Enter', metaKey: true });
    await keydown(raw, { key: 'Escape' });
    raw.remove();
    expect(save).toHaveBeenCalledTimes(1);
    expect(esc).toHaveBeenCalledTimes(1);
  });

  it('mobile web (390 px): nothing registers — the browser keeps its keys', async () => {
    viewportWidth = 390;
    const before = hotkeys.size();
    const el = await mount(<Editor />);
    expect(hotkeys.size()).toBe(before);
    const ev = await keydown(el.querySelector('input')!, { key: 's', metaKey: true });
    expect(save).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });
});

describe('DataTable inside a SplitView: j/k follow the rows he SEES; Esc has one meaning', () => {
  // The reviewer's fixture: source order Drywall, Electrical, Framing.
  type Rec = { id: string; title: string };
  const RECS: Rec[] = [{ id: 'r1', title: 'Drywall' }, { id: 'r2', title: 'Electrical' }, { id: 'r3', title: 'Framing' }];
  const opened: string[] = [];
  const closed = jest.fn();
  function Screen({ search, selectable }: { search?: boolean; selectable?: boolean }) {
    const [openId, setOpenId] = useState<string | null>(null);
    const open = (id: string) => { opened.push(id); setOpenId(id); };
    return (
      <SplitView
        splitId="webtest-split"
        testID="sv"
        openId={openId}
        onClose={() => { closed(); setOpenId(null); }}
        detail={openId ? <Text testID="detail">{`DETAIL ${openId}`}</Text> : null}
        list={(
          <DataTable<Rec>
            tableId={search ? 'webtest-split-search' : 'webtest-split-sort'}
            rows={RECS}
            rowKey={(r) => r.id}
            columns={[{ key: 'title', label: 'Title', sortValue: (r) => r.title }]}
            defaultSort={{ key: 'title', dir: 'desc' }}
            searchText={search ? (r) => r.title : undefined}
            selectable={selectable}
            getRowHref={(r) => ({ pathname: '/rfi', params: { rfiId: r.id } })}
            onRowOpen={(r) => open(r.id)}
            activeKey={openId}
            renderCard={(r) => <Text>{r.title}</Text>}
          />
        )}
      />
    );
  }
  const anchors = (el: HTMLElement) => Array.from(el.querySelectorAll('a')).map((a) => a.textContent);
  const detail = (el: HTMLElement) => el.querySelector('[data-testid="detail"]')?.textContent ?? null;
  async function typeSearch(el: HTMLElement, text: string) {
    const input = el.querySelector('input')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); });
  }
  beforeEach(() => { opened.length = 0; closed.mockClear(); });

  it('sorted DESC: j from Electrical opens Drywall (the row below on screen), k walks back up', async () => {
    const el = await mount(<Screen />);
    expect(anchors(el)).toEqual(['Framing', 'Electrical', 'Drywall']);
    await click(Array.from(el.querySelectorAll('a')).find((a) => a.textContent === 'Electrical')!);
    await keydown(document.body, { key: 'j' });
    expect(opened).toEqual(['r2', 'r1']);
    expect(detail(el)).toBe('DETAIL r1');
    await keydown(document.body, { key: 'k' });
    await keydown(document.body, { key: 'k' });
    expect(opened).toEqual(['r2', 'r1', 'r2', 'r3']);
    expect(detail(el)).toBe('DETAIL r3');
    expect(mockLinkTo).not.toHaveBeenCalled(); // stepping never routes / reloads
  });

  it('searched: j never opens a row the search hides', async () => {
    const el = await mount(<Screen search />);
    await typeSearch(el, 'l'); // Electrical, Drywall match; Framing does not
    expect(anchors(el)).toEqual(['Electrical', 'Drywall']);
    await click(el.querySelector('a')!); // Electrical
    await keydown(document.body, { key: 'j' });
    await keydown(document.body, { key: 'j' });
    await keydown(document.body, { key: 'k' });
    await keydown(document.body, { key: 'k' });
    expect(opened).toEqual(['r2', 'r1', 'r2']);
    expect(opened).not.toContain('r3');
  });

  it('Esc: the search clears first and the record stays; the next Esc closes it (search typed AFTER opening)', async () => {
    const el = await mount(<Screen search />);
    await click(el.querySelector('a')!);
    await typeSearch(el, 'dry');
    const input = el.querySelector('input')!;
    await keydown(input, { key: 'Escape' }); // typed in the search box → capture phase
    expect(closed).not.toHaveBeenCalled();
    expect(input.value).toBe('');
    expect(detail(el)).not.toBeNull();
    await keydown(document.body, { key: 'Escape' });
    expect(closed).toHaveBeenCalledTimes(1);
    expect(detail(el)).toBeNull();
  });

  it('Esc: same result when the search was typed BEFORE opening the record', async () => {
    const el = await mount(<Screen search />);
    await typeSearch(el, 'dry');
    await click(el.querySelector('a')!);
    await keydown(document.body, { key: 'Escape' });
    expect(closed).not.toHaveBeenCalled();
    expect(el.querySelector('input')!.value).toBe('');
    expect(detail(el)).not.toBeNull();
    await keydown(document.body, { key: 'Escape' });
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('an Esc that ends an IME composition in a field does not close the record', async () => {
    const el = await mount(<Screen search />);
    await click(el.querySelector('a')!);
    const ev = await keydown(el.querySelector('input')!, { key: 'Escape', isComposing: true });
    expect(closed).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
    expect(detail(el)).not.toBeNull();
  });
  it('with a record open, ↑/↓ scroll the record (browser default) — only j/k step', async () => {
    const el = await mount(<Screen />);
    await click(Array.from(el.querySelectorAll('a')).find((a) => a.textContent === 'Electrical')!);
    const down = await keydown(document.body, { key: 'ArrowDown' });
    const up = await keydown(document.body, { key: 'ArrowUp' });
    expect(down.defaultPrevented).toBe(false);
    expect(up.defaultPrevented).toBe(false);
    expect(opened).toEqual(['r2']);
    expect(detail(el)).toBe('DETAIL r2');
  });

  describe('SINGLE mode (container < 1100): the hidden list gets record stepping and nothing else', () => {
    // 1150 viewport → react-native-web's first-layout estimate is < 1100 →
    // one pane (the founder's MacBook with the 440 px dock open is here).
    beforeEach(() => { viewportWidth = 1150; });
    const hiddenList = (el: HTMLElement) => el.querySelector('[data-testid="sv-single-list"]') as HTMLElement | null;
    // The bulk bar's "N selected" (in the DOM even while the list is hidden).
    const selectedCount = (el: HTMLElement) => {
      const node = Array.from(el.querySelectorAll('div')).find((d) => /^\d+ selected$/.test(d.textContent ?? ''));
      return node ? Number(/^(\d+)/.exec(node.textContent ?? '')![1]) : 0;
    };
    function SingleScreen() {
      return <Screen search selectable />;
    }

    it('one Esc closes the record even with an invisible search AND selection; / and Cmd+A stay the page\'s', async () => {
      const el = await mount(<SingleScreen />);
      expect(el.querySelector('[data-testid="sv-list"]')).toBeNull(); // not split mode
      const input = el.querySelector('input')!;
      await act(async () => { input.focus(); });
      await typeSearch(el, 'dry');
      // Select the visible row with Cmd+A from the body (list still visible).
      await act(async () => { input.blur(); });
      const selAll = await keydown(document.body, { key: 'a', metaKey: true });
      expect(selAll.defaultPrevented).toBe(true);
      const checked = selectedCount(el);
      expect(checked).toBe(1); // 'dry' leaves Drywall
      // He was typing in the search box when he opened the record.
      await act(async () => { input.focus(); });
      await click(Array.from(el.querySelectorAll('a')).find((a) => a.textContent === 'Drywall')!);
      expect(detail(el)).toBe('DETAIL r1');
      expect(hiddenList(el)).not.toBeNull();
      expect(getComputedStyle(hiddenList(el)!).display).toBe('none');
      // …the hidden box gave up focus, so his next keys are not typed into it.
      expect(document.activeElement).not.toBe(input);
      // '/' does not drop focus into the invisible search box.
      const slash = await keydown(document.body, { key: '/' });
      expect(slash.defaultPrevented).toBe(false);
      expect(document.activeElement).not.toBe(input);
      // Cmd+A is the browser's (select page text), not "tick hidden rows".
      const cmdA = await keydown(document.body, { key: 'a', metaKey: true });
      expect(cmdA.defaultPrevented).toBe(false);
      // x does nothing to the hidden rows.
      await keydown(document.body, { key: 'x' });
      expect(selectedCount(el)).toBe(checked);
      // The FIRST Esc closes the record he is looking at.
      await keydown(document.body, { key: 'Escape' });
      expect(closed).toHaveBeenCalledTimes(1);
      expect(detail(el)).toBeNull();
      // Back on the list: his search and selection survived the round trip.
      expect(input.value).toBe('dry');
      expect(selectedCount(el)).toBe(checked);
      // And now the list is visible, Esc is the table's again (clear selection).
      await keydown(document.body, { key: 'Escape' });
      expect(selectedCount(el)).toBe(0);
      expect(closed).toHaveBeenCalledTimes(1);
    });

    it('j/k still step the open record through the hidden list, in the order he sees', async () => {
      const el = await mount(<SingleScreen />);
      expect(anchors(el)).toEqual(['Framing', 'Electrical', 'Drywall']);
      await click(Array.from(el.querySelectorAll('a')).find((a) => a.textContent === 'Electrical')!);
      expect(getComputedStyle(hiddenList(el)!).display).toBe('none');
      await keydown(document.body, { key: 'j' });
      expect(detail(el)).toBe('DETAIL r1');
      await keydown(document.body, { key: 'k' });
      await keydown(document.body, { key: 'k' });
      expect(opened).toEqual(['r2', 'r1', 'r2', 'r3']);
      expect(detail(el)).toBe('DETAIL r3');
    });
  });
});

describe('SplitView: crossing 1100 px restyles the list, never remounts it', () => {
  // The founder's 1512 MacBook: opening the 440 px AI dock (or dragging the
  // window narrower) drops the container under 1100 and SplitView goes from
  // side-by-side to one pane. His search must still be there.
  type Rec = { id: string; title: string };
  const RECS: Rec[] = [{ id: 'r1', title: 'Drywall' }, { id: 'r2', title: 'Electrical' }, { id: 'r3', title: 'Framing' }];
  // react-native-web's Dimensions re-reads the document on 'resize'.
  let clientSpy: jest.SpyInstance | null = null;
  beforeEach(() => {
    clientSpy = jest.spyOn(document.documentElement, 'clientWidth', 'get').mockImplementation(() => viewportWidth);
  });
  afterEach(() => { clientSpy?.mockRestore(); clientSpy = null; });
  async function resizeTo(w: number) {
    viewportWidth = w;
    await act(async () => { window.dispatchEvent(new Event('resize')); });
  }
  function ModeScreen({ openFirst }: { openFirst?: boolean }) {
    const [openId, setOpenId] = useState<string | null>(openFirst ? 'r2' : null);
    return (
      <SplitView splitId="webtest-mode" testID="sv" openId={openId} onClose={() => setOpenId(null)}
        detail={openId ? <TextInput testID="detail-note" defaultValue="" /> : null}
        list={(
          <DataTable<Rec> tableId="webtest-mode" rows={RECS} rowKey={(r) => r.id}
            columns={[{ key: 'title', label: 'Title', sortValue: (r) => r.title }]}
            searchText={(r) => r.title} selectable onRowOpen={(r) => setOpenId(r.id)} activeKey={openId}
            renderCard={(r) => <Text>{r.title}</Text>} />
        )} />
    );
  }
  const searchBox = (el: HTMLElement) => el.querySelector('[data-testid="sv-list"] input, [data-testid="sv-single-list"] input') as HTMLInputElement;

  it('split → single → split: same search node, his search survives both ways', async () => {
    const el = await mount(<ModeScreen />);
    expect(el.querySelector('[data-testid="sv-list"]')).not.toBeNull(); // split at 1512
    const input = searchBox(el);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(input, 'dry'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(input.value).toBe('dry');
    await resizeTo(1150);
    expect(el.querySelector('[data-testid="sv-list"]')).toBeNull();
    expect(el.querySelector('[data-testid="sv-single-list"]')).not.toBeNull(); // now single
    expect(searchBox(el)).toBe(input); // the SAME DOM node: not remounted
    expect(input.value).toBe('dry');
    await resizeTo(1512);
    expect(el.querySelector('[data-testid="sv-list"]')).not.toBeNull(); // split again
    expect(searchBox(el)).toBe(input);
    expect(input.value).toBe('dry');
  });

  it('an open record keeps its own state across the switch too', async () => {
    const el = await mount(<ModeScreen openFirst />);
    const note = el.querySelector('[data-testid="detail-note"]') as HTMLInputElement;
    expect(note).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(note, 'half-typed'); note.dispatchEvent(new Event('input', { bubbles: true })); });
    await resizeTo(1150);
    expect(el.querySelector('[data-testid="sv-back"]')).not.toBeNull(); // single, record open
    expect(el.querySelector('[data-testid="detail-note"]')).toBe(note);
    expect(note.value).toBe('half-typed');
  });
});

describe('a screen UNDER a pushed route gets no keys (navigator focus)', () => {
  // expo-router's Stack on web = react-navigation native-stack: every screen
  // below the top stays mounted behind display:none. Its bindings must be off.
  type Rec = { id: string; title: string };
  const RECS: Rec[] = [{ id: 'r1', title: 'Drywall' }, { id: 'r2', title: 'Electrical' }];
  const opened: string[] = [];
  const saved: string[] = [];
  function ListScreen() {
    usePrimaryAction(() => saved.push('LIST SAVE'), { label: 'Save list' });
    return (
      <DataTable<Rec> tableId="webtest-stack" testID="stk" rows={RECS} rowKey={(r) => r.id}
        columns={[{ key: 'title', label: 'Title' }]} searchText={(r) => r.title} selectable
        onRowOpen={(r) => opened.push(r.id)} renderCard={(r) => <Text>{r.title}</Text>} />
    );
  }
  function DetailScreen() { return <Text testID="rfi-detail">RFI DETAIL</Text>; }
  // react-navigation's web header measures itself; jsdom has no ResizeObserver.
  beforeAll(() => {
    const g = globalThis as { ResizeObserver?: unknown };
    if (!g.ResizeObserver) g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  });
  const Stack = createNativeStackNavigator();
  const selected = (el: HTMLElement) => {
    const node = Array.from(el.querySelectorAll('div')).find((d) => /^\d+ selected$/.test(d.textContent ?? ''));
    return node ? Number(/^(\d+)/.exec(node.textContent ?? '')![1]) : 0;
  };

  it("after pushing Detail: '/', Cmd+A, Enter, Cmd+S do nothing; after goBack they work again", async () => {
    opened.length = 0; saved.length = 0;
    const nav = createNavigationContainerRef<Record<string, undefined>>();
    const el = await mount(
      <NavigationContainer ref={nav}>
        <Stack.Navigator>
          <Stack.Screen name="List" component={ListScreen} />
          <Stack.Screen name="Detail" component={DetailScreen} />
        </Stack.Navigator>
      </NavigationContainer>,
    );
    await keydown(document.body, { key: 'j' }); // cursor on Drywall while the list is on top
    await act(async () => { nav.navigate('Detail'); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(nav.getCurrentRoute()?.name).toBe('Detail');
    expect(el.querySelector('[data-testid="rfi-detail"]')).not.toBeNull();
    // The list screen is still MOUNTED (hidden) — that is the whole point.
    const input = el.querySelector('[data-testid="stk"] input') as HTMLInputElement;
    expect(input).not.toBeNull();
    let p: HTMLElement | null = el.querySelector('[data-testid="stk"]');
    let hidden = false;
    while (p) { if (getComputedStyle(p).display === 'none') hidden = true; p = p.parentElement; }
    expect(hidden).toBe(true);

    const slash = await keydown(document.body, { key: '/' });
    expect(slash.defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(input);
    const cmdA = await keydown(document.body, { key: 'a', metaKey: true });
    expect(cmdA.defaultPrevented).toBe(false);
    expect(selected(el)).toBe(0);
    const enter = await keydown(document.body, { key: 'Enter' });
    expect(enter.defaultPrevented).toBe(false);
    expect(opened).toEqual([]);
    const cmdS = await keydown(document.body, { key: 's', metaKey: true });
    expect(cmdS.defaultPrevented).toBe(false);
    expect(saved).toEqual([]);

    await act(async () => { nav.goBack(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(nav.getCurrentRoute()?.name).toBe('List');
    const enter2 = await keydown(document.body, { key: 'Enter' });
    expect(enter2.defaultPrevented).toBe(true);
    expect(opened).toEqual(['r1']); // his cursor survived the round trip
    const cmdS2 = await keydown(document.body, { key: 's', metaKey: true });
    expect(cmdS2.defaultPrevented).toBe(true);
    expect(saved).toEqual(['LIST SAVE']);
    const cmdA2 = await keydown(document.body, { key: 'a', metaKey: true });
    expect(cmdA2.defaultPrevented).toBe(true);
    expect(selected(el)).toBe(2);
    const slash2 = await keydown(document.body, { key: '/' });
    expect(slash2.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
  });
});
