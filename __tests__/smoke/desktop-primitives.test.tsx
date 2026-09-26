/**
 * Smoke: the wave-6b desktop workspace primitives (lane L4).
 *
 * Two promises, both mounted for real:
 *
 *   1. PHONE IDENTICAL (390 native). A screen that adopts DataTable,
 *      LineItemGrid, SplitView, FormGrid/FormField or NoticeStrip in wave 6c
 *      must keep today's iPhone tree. So at 390 the primitive's rendered tree
 *      is compared, node for node, with the tree of the screen's own nodes
 *      rendered bare. The rest (KpiStrip, SidePanel, ToolbarActions) have no
 *      phone "today" — they must mount and read sensibly.
 *
 *   2. DESKTOP WORKS (1512 web). Every primitive mounts inside a real
 *      expo-router navigator at the founder's MacBook width and does its job:
 *      sort, select, bulk, keyboard, split / single, dock, pager, totals,
 *      overflow, two-column form, Cmd+Enter.
 *
 * The keyboard is driven through the one window listener useHotkeys attaches
 * (a DOM is faked for the web block: `document` + window.addEventListener).
 */

import React, { useState } from 'react';
import { Dimensions, Platform, Pressable, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { DataTable, type DataTableColumn } from '@/components/desktop/DataTable';
import { SplitView } from '@/components/desktop/SplitView';
import { KpiStrip } from '@/components/desktop/KpiStrip';
import { SidePanel } from '@/components/desktop/SidePanel';
import { NoticeStrip, noticeDismissKey } from '@/components/desktop/NoticeStrip';
import { LineItemGrid, type LineItemColumn } from '@/components/desktop/LineItemGrid';
import { ToolbarActions } from '@/components/desktop/ToolbarActions';
import { FormField, FormGrid } from '@/components/desktop/FormGrid';
import { hotkeys, usePrimaryAction } from '@/hooks/useHotkeys';
import { tablePrefsKey } from '@/utils/dataTable';

jest.mock('@/utils/alert', () => ({ showAlert: jest.fn(), showPrompt: jest.fn() }));
const alertMock = jest.requireMock('@/utils/alert') as { showAlert: jest.Mock };

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
function Wrapper({ children }: { children: React.ReactNode }) {
  return <SafeAreaProvider initialMetrics={METRICS}><ThemeProvider>{children}</ThemeProvider></SafeAreaProvider>;
}

// ── viewport ────────────────────────────────────────────────────────────────
const realOS = Platform.OS;
let dimSpy: jest.SpyInstance | null = null;
function viewport(os: 'ios' | 'web', width: number, height: number) {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
  dimSpy?.mockRestore();
  dimSpy = jest.spyOn(Dimensions, 'get').mockImplementation(() => ({ width, height, scale: 2, fontScale: 1 }));
}
function resetViewport() {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => realOS });
  dimSpy?.mockRestore();
  dimSpy = null;
}

// ── a fake DOM for the keyboard ─────────────────────────────────────────────
type KeyHandler = (e: Record<string, unknown>) => void;
const keyHandlers: KeyHandler[] = [];
const g = globalThis as unknown as Record<string, unknown>;
function installDom() {
  g.document = {};
  g.addEventListener = jest.fn((type: string, fn: KeyHandler) => { if (type === 'keydown') keyHandlers.push(fn); });
  g.removeEventListener = jest.fn((type: string, fn: KeyHandler) => {
    const i = keyHandlers.indexOf(fn);
    if (type === 'keydown' && i >= 0) keyHandlers.splice(i, 1);
  });
}
function removeDom() {
  delete g.document;
  delete g.addEventListener;
  delete g.removeEventListener;
  keyHandlers.length = 0;
}
function press(key: string, mods: Record<string, unknown> = {}) {
  act(() => {
    for (const h of [...keyHandlers]) h({ key, preventDefault: () => {}, stopPropagation: () => {}, ...mods });
  });
}
async function flush() {
  await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
}
function layout(testID: string, width: number) {
  fireEvent(screen.getByTestId(testID), 'layout', { nativeEvent: { layout: { width, height: 800, x: 0, y: 0 } } });
}
/** Mount inside a real in-memory expo-router navigator (Link, useRouter). */
function mountDesktop(node: React.ReactElement) {
  const Screen = () => node;
  return renderRouter({ index: Screen }, { initialUrl: '/', wrapper: Wrapper });
}

// ── fixtures ────────────────────────────────────────────────────────────────
type Row = { id: string; title: string; amount: number | null };
const ROWS: Row[] = [
  { id: 'r1', title: 'Drywall', amount: 300 },
  { id: 'r2', title: 'Electrical', amount: null },
  { id: 'r3', title: 'Framing', amount: 100 },
];
const COLUMNS: DataTableColumn<Row>[] = [
  { key: 'title', label: 'Title', flex: 2, sortValue: (r) => r.title },
  { key: 'amount', label: 'Amount', width: 128, numeric: true, sortValue: (r) => r.amount },
];
const card = (r: Row) => (
  <View style={{ padding: 12 }}>
    <Text>{r.title}</Text>
    <Text>{r.amount ?? 'n/a'}</Text>
  </View>
);

type Line = { id: string; description: string; qty: string; unit: string };
const LINES: Line[] = [
  { id: 'l1', description: 'Drywall', qty: '10', unit: '4.50' },
  { id: 'l2', description: 'Paint', qty: 'TBD', unit: '30' },
];
const LINE_COLS: LineItemColumn<Line>[] = [
  { key: 'description', label: 'Description', flex: 1 },
  { key: 'qty', label: 'Qty', width: 88, kind: 'number', total: true },
  { key: 'unit', label: 'Unit $', width: 128, kind: 'money' },
  {
    key: 'total', label: 'Total', width: 128, kind: 'money', total: true,
    compute: (l) => { const q = Number(l.qty); const u = Number(l.unit); return Number.isFinite(q) && Number.isFinite(u) ? q * u : null; },
  },
];
const lineCard = (l: Line) => <View><Text>{l.description}</Text><Text>{l.qty}</Text></View>;


// ═════════════════════════════════════════════════════════════════════════════
// ONE render per test: this harness defers every render after the first in a
// test to after teardown (two render() calls in one `it` break the NEXT test —
// probed with a two-test file). So "identical" is proved inside one tree: the
// screen's own nodes under testID "bare", the primitive under testID "prim",
// same parent, and their children must serialise identically.
type JsonNode = { type: string; props: Record<string, unknown>; children: (JsonNode | string)[] | null };
function findByTestId(node: unknown, id: string): JsonNode | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) { const hit = findByTestId(n, id); if (hit) return hit; }
    return null;
  }
  const n = node as JsonNode;
  if (n.props?.testID === id) return n;
  return findByTestId(n.children, id);
}
function expectIdenticalPhoneTree(bare: React.ReactNode, prim: React.ReactNode) {
  const r = render(
    <Wrapper>
      <View testID="bare">{bare}</View>
      <View testID="prim">{prim}</View>
    </Wrapper>,
  );
  const tree = r.toJSON();
  const a = findByTestId(tree, 'bare');
  const b = findByTestId(tree, 'prim');
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  expect(a!.children).not.toBeNull(); // not vacuously equal
  expect(JSON.stringify(b!.children)).toBe(JSON.stringify(a!.children));
}

describe('390 native — phone identical', () => {
  beforeEach(() => viewport('ios', 390, 844));
  afterEach(resetViewport);

  it('DataTable renders exactly the phone cards', () => {
    expectIdenticalPhoneTree(
      <>{ROWS.map((r) => <React.Fragment key={r.id}>{card(r)}</React.Fragment>)}</>,
      <DataTable tableId="t" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} renderCard={card} selectable searchText={(r) => r.title} />,
    );
    expect(screen.queryByText('Title')).toBeNull(); // no table header on the phone
  });

  it('LineItemGrid renders exactly the phone line cards', () => {
    expectIdenticalPhoneTree(
      <>{LINES.map((l) => <React.Fragment key={l.id}>{lineCard(l)}</React.Fragment>)}</>,
      <LineItemGrid rows={LINES} rowKey={(l) => l.id} columns={LINE_COLS} renderCard={lineCard}
        onChangeCell={() => {}} onAddRow={() => {}} onDeleteRow={() => {}} />,
    );
  });

  it('FormGrid + FormField render exactly the screen\'s own label and input', () => {
    expectIdenticalPhoneTree(
      <>
        <Text>Subject</Text>
        <TextInput value="Door hardware" />
        <Text>Question</Text>
        <TextInput value="Which spec?" multiline />
      </>,
      <FormGrid>
        <FormField size="lg"><Text>Subject</Text><TextInput value="Door hardware" /></FormField>
        <FormField span="full"><Text>Question</Text><TextInput value="Which spec?" multiline /></FormField>
      </FormGrid>,
    );
  });

  it('SplitView renders only the list (push navigation stays the screen\'s)', () => {
    const list = <View><Text>RFI-001</Text><Text>RFI-002</Text></View>;
    expectIdenticalPhoneTree(
      list,
      <SplitView splitId="rfis" list={list} detail={<Text>Detail pane</Text>} openId="rfi-1" onClose={() => {}} />,
    );
    expect(screen.queryByText('Detail pane')).toBeNull();
  });

  it('NoticeStrip renders each notice\'s own banner card, in the order given', () => {
    const cardA = () => <View><Text>Invite pending</Text></View>;
    const cardB = () => <View><Text>Connect Stripe</Text></View>;
    expectIdenticalPhoneTree(
      <>{cardA()}{cardB()}</>,
      <NoticeStrip notices={[
        { id: 'a', message: 'Invite pending', priority: 1, renderCard: cardA },
        { id: 'hidden', message: 'Gate is off', visible: false, renderCard: () => <Text>should not show</Text> },
        { id: 'b', message: 'Connect Stripe', priority: 9, renderCard: cardB },
      ]} />,
    );
  });

  it('KpiStrip: phone fallback reads sensibly (two columns, — with its reason)', () => {
    render(
      <Wrapper>
        <KpiStrip testID="kpi" cells={[
          { key: 'margin', label: 'Margin', value: '18%', financial: true },
          { key: 'owed', label: 'Owed', value: null, blockedReason: 'No invoices yet', financial: true },
          { key: 'done', label: '% complete', value: '42%' },
          { key: 'rfis', label: 'Open RFIs', value: 3 },
        ]} />
      </Wrapper>,
    );
    expect(screen.getByText('18%')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('No invoices yet')).toBeTruthy();
    const w = (screen.getByTestId('kpi-done').props.style as unknown[]).flat(3).filter(Boolean)
      .map((x) => (x as Record<string, unknown>).width).find((x) => typeof x === 'number');
    expect(w).toBe(Math.floor((390 - 8) / 2)); // two per row on a phone
  });

  it('SidePanel: phone fallback is a page sheet with the same header', () => {
    const onClose = jest.fn();
    render(<Wrapper><SidePanel open title="Ask MAGE" onClose={onClose} testID="panel"><Text>Body</Text></SidePanel></Wrapper>);
    expect(screen.getByText('Ask MAGE')).toBeTruthy();
    expect(screen.getByText('Body')).toBeTruthy();
    fireEvent.press(screen.getByTestId('panel-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('ToolbarActions: phone fallback is icon buttons + ⋯, no breadcrumbs', () => {
    const Icon = () => null;
    render(
      <Wrapper>
        <ToolbarActions testID="tb" breadcrumbs={[{ label: 'Henderson' }, { label: 'RFIs' }]} actions={[
          { key: 'a', label: 'Share', icon: Icon, onPress: jest.fn(), testID: 'p-a' },
          { key: 'b', label: 'Export', icon: Icon, onPress: jest.fn(), testID: 'p-b' },
          { key: 'c', label: 'Print', icon: Icon, onPress: jest.fn(), testID: 'p-c' },
          { key: 'd', label: 'Duplicate', icon: Icon, onPress: jest.fn(), testID: 'p-d' },
        ]} />
      </Wrapper>,
    );
    expect(screen.queryByText('Henderson')).toBeNull();
    expect(screen.getByTestId('p-a')).toBeTruthy();
    expect(screen.queryByText('Share')).toBeNull(); // icon-only on the phone
    expect(screen.queryByTestId('p-d')).toBeNull(); // the 4th is in ⋯
    expect(screen.getByTestId('tb-more')).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('1512 web — desktop', () => {
  beforeEach(async () => {
    viewport('web', 1512, 945);
    installDom();
    alertMock.showAlert.mockClear();
    await AsyncStorage.clear();
  });
  afterEach(() => {
    // Unmount while the fake DOM still exists, so the hotkeys listener detaches
    // from the window it attached to.
    cleanup();
    removeDom();
    resetViewport();
  });

  it('DataTable: header, sort cycle, unknown as —, select + bulk, keyboard, prefs saved', async () => {
    const onOpen = jest.fn();
    const run = jest.fn();
    mountDesktop(
      <DataTable
        tableId="smoke-rfis"
        testID="tbl"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        renderCard={card}
        onRowOpen={onOpen}
        selectable
        searchText={(r) => r.title}
        bulkActions={[
          { label: 'Close', run },
          { label: 'Send', run: jest.fn(), disabledReason: 'Pick a recipient first.' },
        ]}
        footerTotals={{ amount: '$400' }}
      />,
    );
    await flush();
    layout('tbl', 1270);
    expect(screen.getByText('Title')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy(); // Electrical's unknown amount — never 0
    expect(screen.queryByText('Electrical')).toBeTruthy();
    expect(screen.getByText('$400')).toBeTruthy(); // footer total

    const order = () => screen.getAllByTestId(/^tbl-row-r\d$/).map((n) => n.props.testID as string);
    expect(order()).toEqual(['tbl-row-r1', 'tbl-row-r2', 'tbl-row-r3']);
    fireEvent.press(screen.getByTestId('tbl-sort-amount'));
    expect(order()).toEqual(['tbl-row-r3', 'tbl-row-r1', 'tbl-row-r2']); // asc, unknown last
    fireEvent.press(screen.getByTestId('tbl-sort-amount'));
    expect(order()).toEqual(['tbl-row-r1', 'tbl-row-r3', 'tbl-row-r2']); // desc, unknown STILL last
    await flush();
    expect(JSON.parse((await AsyncStorage.getItem(tablePrefsKey('smoke-rfis')))!)).toEqual({ sort: { key: 'amount', dir: 'desc' }, hidden: [] });
    fireEvent.press(screen.getByTestId('tbl-sort-amount'));
    expect(order()).toEqual(['tbl-row-r1', 'tbl-row-r2', 'tbl-row-r3']); // off

    // Select: click r1, shift-click r3 → range r1..r3.
    fireEvent.press(screen.getByTestId('tbl-row-r1-check'), { nativeEvent: {} });
    fireEvent.press(screen.getByTestId('tbl-row-r3-check'), { nativeEvent: { shiftKey: true } });
    expect(screen.getByTestId('tbl-bulkbar')).toBeTruthy();
    expect(screen.getByText('3 selected')).toBeTruthy();
    fireEvent.press(screen.getByText('Close'));
    expect(run).toHaveBeenCalledWith(['r1', 'r2', 'r3']);
    fireEvent.press(screen.getByText('Send'));
    expect(alertMock.showAlert).toHaveBeenCalledWith('Send', 'Pick a recipient first.');

    // Keyboard: Esc clears the selection; j j Enter opens row 2.
    press('Escape');
    expect(screen.queryByTestId('tbl-bulkbar')).toBeNull();
    press('j');
    press('j');
    press('Enter');
    expect(onOpen).toHaveBeenCalledWith(ROWS[1]);
    press('x');
    expect(screen.getByText('1 selected')).toBeTruthy();
    // Typing j in the search box is typing, not a shortcut.
    onOpen.mockClear();
    press('Enter', { target: { tagName: 'INPUT', type: 'text' } });
    expect(onOpen).not.toHaveBeenCalled();

    // Search narrows the rows and drops the selection it hid.
    fireEvent.changeText(screen.getByTestId('tbl-search'), 'fram');
    expect(order()).toEqual(['tbl-row-r3']);
    expect(screen.queryByTestId('tbl-bulkbar')).toBeNull();
    fireEvent.changeText(screen.getByTestId('tbl-search'), 'zzz');
    expect(screen.getByText('No rows match “zzz”.')).toBeTruthy();
    expect(screen.queryByText('$400')).toBeNull(); // no footer under an empty result
  });

  it('DataTable: rows with an href are links; a plain click opens in place', async () => {
    const onOpen = jest.fn();
    mountDesktop(
      <DataTable tableId="links" testID="lt" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} renderCard={card}
        getRowHref={(r) => ({ pathname: '/rfi', params: { rfiId: r.id } })} onRowOpen={onOpen} />,
    );
    await flush();
    const row = screen.getByTestId('lt-row-r1');
    expect(row.props.accessibilityRole ?? row.props.role).toBe('link');
    expect(String(row.props.href)).toContain('/rfi');
    // A DOM-shaped click: expo-router's Link reads defaultPrevented / button /
    // currentTarget.target to decide whether IT navigates.
    const click = (mods: Record<string, unknown> = {}) => {
      const ev: Record<string, unknown> = { defaultPrevented: false, button: 0, currentTarget: { target: '' }, ...mods };
      ev.preventDefault = () => { ev.defaultPrevented = true; };
      return ev;
    };
    const cmdClick = click({ metaKey: true });
    fireEvent.press(row, cmdClick);
    expect(onOpen).not.toHaveBeenCalled(); // Cmd-click belongs to the browser (new tab)
    expect(cmdClick.defaultPrevented).toBe(false);
    const plain = click();
    fireEvent.press(row, plain);
    expect(onOpen).toHaveBeenCalledWith(ROWS[0]); // plain click opens in place…
    expect(plain.defaultPrevented).toBe(true); // …and the Link does not also navigate
  });

  it('DataTable inside a SplitView: j/k step the open record in the order he SEES; Enter stands down', async () => {
    const opened: string[] = [];
    function Harness() {
      const [active, setActive] = useState<string | null>('r2');
      return (
        <View>
          <Pressable testID="close-record" onPress={() => setActive(null)}><Text>close</Text></Pressable>
          <DataTable tableId="split-visible-order" testID="so" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} renderCard={card}
            defaultSort={{ key: 'title', dir: 'desc' }}
            onRowOpen={(r) => { opened.push(r.id); setActive(r.id); }} activeKey={active} />
        </View>
      );
    }
    mountDesktop(<Harness />);
    await flush();
    // Sorted title DESC he sees Framing (r3), Electrical (r2), Drywall (r1).
    press('j');
    expect(opened).toEqual(['r1']); // the row BELOW Electrical on screen — not r3 (source order)
    press('j');
    expect(opened).toEqual(['r1']); // bottom row: stays
    press('k');
    press('k');
    expect(opened).toEqual(['r1', 'r2', 'r3']);
    press('Enter');
    expect(opened).toEqual(['r1', 'r2', 'r3']); // the open record is already open
    // Record closed: j/k move the cursor again, starting FROM the row that was open (r3, top).
    fireEvent.press(screen.getByTestId('close-record'));
    await flush();
    press('j');
    press('Enter');
    expect(opened).toEqual(['r1', 'r2', 'r3', 'r2']);
  });

  it.each(['search-then-open', 'open-then-search'] as const)('Esc precedence inside a SplitView (%s): the table clears its search first, then the record closes', async (order) => {
    const onClose = jest.fn();
    function Harness() {
      const [openId, setOpenId] = useState<string | null>(order === 'open-then-search' ? 'r1' : null);
      return (
        <View>
          <Pressable testID="open-r1" onPress={() => setOpenId('r1')}><Text>open</Text></Pressable>
          <SplitView splitId={`esc-${order}`} openId={openId} onClose={() => { onClose(); setOpenId(null); }}
            detail={openId ? <Text>Detail {openId}</Text> : null}
            list={(
              <DataTable tableId={`esc-${order}`} testID="esc" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} renderCard={card}
                searchText={(r) => r.title} onRowOpen={(r) => setOpenId(r.id)} activeKey={openId} />
            )} />
        </View>
      );
    }
    mountDesktop(<Harness />);
    await flush();
    if (order === 'search-then-open') {
      fireEvent.changeText(screen.getByTestId('esc-search'), 'dry');
      fireEvent.press(screen.getByTestId('open-r1'));
    } else {
      fireEvent.changeText(screen.getByTestId('esc-search'), 'dry');
    }
    await flush();
    expect(screen.getByText('Detail r1')).toBeTruthy();
    press('Escape');
    expect(onClose).not.toHaveBeenCalled(); // first Esc: the search clears…
    expect(screen.getByTestId('esc-search').props.value).toBe('');
    expect(screen.getByText('Detail r1')).toBeTruthy(); // …and the record stays open
    press('Escape');
    expect(onClose).toHaveBeenCalledTimes(1); // nothing left to clear: now it closes
  });

  it('SplitView SINGLE mode (< 1100): the hidden list gets no Esc, so ONE Esc closes the record; his search survives', async () => {
    const onClose = jest.fn();
    function Harness() {
      const [openId, setOpenId] = useState<string | null>(null);
      return (
        <View>
          <Pressable testID="open-r1" onPress={() => setOpenId('r1')}><Text>open</Text></Pressable>
          <SplitView splitId="esc-single" testID="svs" openId={openId} onClose={() => { onClose(); setOpenId(null); }}
            detail={openId ? <Text>Detail {openId}</Text> : null}
            list={(
              <DataTable tableId="esc-single" testID="escs" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} renderCard={card}
                searchText={(r) => r.title} onRowOpen={(r) => setOpenId(r.id)} activeKey={openId} />
            )} />
        </View>
      );
    }
    mountDesktop(<Harness />);
    await flush();
    layout('svs', 1000);
    fireEvent.changeText(screen.getByTestId('escs-search'), 'dry');
    fireEvent.press(screen.getByTestId('open-r1'));
    await flush();
    expect(screen.queryByTestId('svs-list')).toBeNull(); // single mode, list hidden
    expect(screen.getByText('Detail r1')).toBeTruthy();
    press('Escape');
    expect(onClose).toHaveBeenCalledTimes(1); // the FIRST Esc closes what he sees
    expect(screen.queryByText('Detail r1')).toBeNull();
    expect(screen.getByTestId('escs-search').props.value).toBe('dry'); // …and his search survived
  });

  it('SplitView: crossing 1100 (the AI dock opening) restyles the list, never remounts it: his search survives', async () => {
    function Harness() {
      const [openId, setOpenId] = useState<string | null>(null);
      return (
        <SplitView splitId="mode-switch" testID="svm" openId={openId} onClose={() => setOpenId(null)}
          detail={openId ? <Text>Detail {openId}</Text> : null}
          list={(
            <DataTable tableId="mode-switch" testID="msw" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} renderCard={card}
              searchText={(r) => r.title} onRowOpen={(r) => setOpenId(r.id)} activeKey={openId} />
          )} />
      );
    }
    mountDesktop(<Harness />);
    await flush();
    layout('svm', 1270);
    expect(screen.getByTestId('svm-list')).toBeTruthy(); // split
    fireEvent.changeText(screen.getByTestId('msw-search'), 'dry');
    layout('svm', 1000);
    expect(screen.queryByTestId('svm-list')).toBeNull();
    expect(screen.getByTestId('svm-single-list')).toBeTruthy(); // single
    expect(screen.getByTestId('msw-search').props.value).toBe('dry');
    layout('svm', 1270);
    expect(screen.getByTestId('svm-list')).toBeTruthy(); // split again
    expect(screen.getByTestId('msw-search').props.value).toBe('dry');
  });

  it('SplitView: side by side at 1270, one pane with a back link under 1100, Esc closes', async () => {
    const onClose = jest.fn();
    const r = mountDesktop(
      <SplitView splitId="smoke" testID="sv" list={<Text>The list</Text>} detail={<Text>RFI-002 detail</Text>}
        openId="rfi-2" onClose={onClose} />,
    );
    await flush();
    layout('sv', 1270);
    expect(screen.getByTestId('sv-list')).toBeTruthy();
    expect(screen.getByTestId('sv-detail')).toBeTruthy();
    expect(screen.getByText('The list')).toBeTruthy();
    expect(screen.getByText('RFI-002 detail')).toBeTruthy();
    const listWidth = (screen.getByTestId('sv-list').props.style as Record<string, unknown>[])
      .flat().find((s) => s && typeof s.width === 'number')?.width;
    expect(listWidth).toBe(533); // 42 % of 1270
    press('j'); // SplitView binds no j/k (the list owns the visible order)
    expect(onClose).not.toHaveBeenCalled();
    press('Escape');
    expect(onClose).toHaveBeenCalled();

    layout('sv', 1000);
    expect(screen.queryByTestId('sv-list')).toBeNull();
    expect(screen.getByText('RFI-002 detail')).toBeTruthy();
    // The list is hidden, not unmounted: his search / scroll survive "Back to list".
    // (display:none takes it out of the accessible tree — hence includeHiddenElements.)
    const hiddenList = screen.getByTestId('sv-single-list', { includeHiddenElements: true });
    expect((hiddenList.props.style as Record<string, unknown>[]).flat().some((st) => st && st.display === 'none')).toBe(true);
    expect(screen.queryByText('The list')).toBeNull(); // not visible…
    expect(screen.getByText('The list', { includeHiddenElements: true })).toBeTruthy(); // …but still mounted
    fireEvent.press(screen.getByTestId('sv-back'));
    expect(onClose).toHaveBeenCalledTimes(2);
    r.unmount();
  });

  it('KpiStrip: one row, missing = — with its reason, a financial cell left out for a field role', async () => {
    const cells = [
      { key: 'margin', label: 'Margin', value: '18%', financial: true },
      { key: 'owed', label: 'Owed', value: null, blockedReason: 'No invoices yet', financial: true },
      { key: 'done', label: '% complete', value: '42%' },
      { key: 'rfis', label: 'Open RFIs', value: 0 },
    ];
    const { rerender } = render(<Wrapper><KpiStrip cells={cells} testID="kpi" /></Wrapper>);
    layout('kpi', 1270);
    expect(screen.getByText('18%')).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy(); // a real 0 stays 0
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('No invoices yet')).toBeTruthy();
    const w = (screen.getByTestId('kpi-done').props.style as Record<string, unknown>[]).flat().find((s) => s && typeof s.width === 'number')?.width;
    expect(w).toBe(Math.floor((1270 - 12 * 3) / 4)); // four equal cells in one row
    rerender(<Wrapper><KpiStrip cells={cells} canViewFinancials={false} testID="kpi" /></Wrapper>);
    expect(screen.queryByText('Margin')).toBeNull();
    expect(screen.queryByText('Owed')).toBeNull();
    expect(screen.getByText('% complete')).toBeTruthy();
  });

  it('SidePanel: docked beside the page, overlay under 1200, Esc closes, Cmd+J toggles', async () => {
    const onClose = jest.fn();
    const onToggle = jest.fn();
    const { rerender } = render(
      <Wrapper>
        <SidePanel open title="Ask MAGE" onClose={onClose} onToggle={onToggle} testID="sp"
          tabs={[{ key: 'ask', label: 'Ask' }, { key: 'task', label: 'Task' }]} activeTab="ask" containerWidth={1270}>
          <Text>Chat</Text>
        </SidePanel>
      </Wrapper>,
    );
    await flush();
    const flat = () => (screen.getByTestId('sp').props.style as unknown[]).flat(3).filter(Boolean) as Record<string, unknown>[];
    expect(flat().some((s) => s.width === 440)).toBe(true);
    expect(flat().some((s) => s.position === 'absolute')).toBe(false);
    press('Escape');
    expect(onClose).toHaveBeenCalled();
    press('j', { metaKey: true });
    expect(onToggle).toHaveBeenCalled();
    rerender(
      <Wrapper>
        <SidePanel open title="Ask MAGE" onClose={onClose} testID="sp" containerWidth={1100}><Text>Chat</Text></SidePanel>
      </Wrapper>,
    );
    expect(flat().some((s) => s.position === 'absolute')).toBe(true);
    rerender(<Wrapper><SidePanel open={false} title="Ask MAGE" onClose={onClose} testID="sp"><Text>Chat</Text></SidePanel></Wrapper>);
    expect(screen.queryByTestId('sp')).toBeNull();
  });

  it('NoticeStrip: highest priority first, 1 of N pager, dismissal persisted under mageid_', async () => {
    render(
      <Wrapper>
        <NoticeStrip testID="ns" notices={[
          { id: 'invite', message: 'Invite pending', priority: 1 },
          { id: 'stripe', message: 'Connect Stripe to get paid', priority: 9, dismissKey: 'stripe-connect' },
          { id: 'off', message: 'gated off', priority: 99, visible: false },
          { id: 'brief', message: 'Morning brief ready', priority: 5 },
        ]} />
      </Wrapper>,
    );
    await flush();
    expect(screen.getByText('Connect Stripe to get paid')).toBeTruthy();
    expect(screen.getByText('1 of 3')).toBeTruthy();
    expect(screen.queryByText('gated off')).toBeNull();
    fireEvent.press(screen.getByTestId('ns-next'));
    expect(screen.getByText('Morning brief ready')).toBeTruthy();
    fireEvent.press(screen.getByTestId('ns-prev'));
    fireEvent.press(screen.getByTestId('ns-dismiss'));
    await flush();
    expect(await AsyncStorage.getItem(noticeDismissKey('stripe-connect'))).toBeTruthy();
    expect(screen.getByText('Morning brief ready')).toBeTruthy();
    expect(screen.getByText('1 of 2')).toBeTruthy();
  });

  it('LineItemGrid: cells, computed totals, "not counted" instead of $0, Enter adds a line', async () => {
    const onAdd = jest.fn();
    const onChange = jest.fn();
    render(
      <Wrapper>
        <LineItemGrid testID="lg" rows={LINES} rowKey={(l) => l.id} columns={LINE_COLS} renderCard={lineCard}
          onChangeCell={onChange} onAddRow={onAdd} onDeleteRow={() => {}}
          rowWarning={(l) => (l.id === 'l2' ? 'Billed past the scheduled value' : null)} />
      </Wrapper>,
    );
    expect(screen.getByTestId('lg-cell-l1-qty').props.value).toBe('10');
    expect(screen.getAllByText('$45.00')).toHaveLength(2); // 10 × 4.50 on the line, and the total (the TBD line is not counted)
    expect(screen.getAllByText('—').length).toBeGreaterThan(0); // TBD × 30 is unknown, not $0
    expect(screen.getByText('1 line not counted')).toBeTruthy();
    expect(screen.getByText('Billed past the scheduled value')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('lg-cell-l1-qty'), '12');
    expect(onChange).toHaveBeenCalledWith('l1', 'qty', '12');
    fireEvent(screen.getByTestId('lg-cell-l1-description'), 'submitEditing');
    expect(onAdd).toHaveBeenCalledWith('l1');
  });

  it('ToolbarActions: 6 visible, the rest and every destructive in ⋯, blocked says why', async () => {
    const onDelete = jest.fn();
    const actions = Array.from({ length: 7 }, (_, i) => ({ key: `a${i}`, label: `Action ${i}`, onPress: jest.fn(), testID: `act-${i}` }));
    mountDesktop(
      <ToolbarActions testID="tb"
        breadcrumbs={[{ label: 'Henderson', href: '/' }, { label: 'RFIs' }]}
        actions={[
          ...actions.slice(0, 2),
          { key: 'blocked', label: 'Send', onPress: jest.fn(), disabled: true, disabledReason: 'Add a recipient first.', testID: 'act-send' },
          { key: 'del', label: 'Delete', onPress: onDelete, destructive: true, testID: 'act-del' },
          ...actions.slice(2),
        ]}
      />,
    );
    await flush();
    expect(screen.getByText('Henderson')).toBeTruthy();
    expect(screen.getByTestId('act-send')).toBeTruthy();
    fireEvent.press(screen.getByTestId('act-send'));
    expect(alertMock.showAlert).toHaveBeenCalledWith('Send', 'Add a recipient first.');
    // 6 visible: a0, a1, send, a2, a3, a4 — a5, a6 and Delete overflow.
    expect(screen.queryByTestId('act-5')).toBeNull();
    expect(screen.queryByTestId('act-del')).toBeNull();
    fireEvent.press(screen.getByTestId('tb-more'));
    expect(screen.getByTestId('act-del')).toBeTruthy();
    expect(screen.getByTestId('act-6')).toBeTruthy();
  });

  it('FormGrid: two columns at ≥ 1100, one below; fields capped at their size', async () => {
    render(
      <Wrapper>
        <FormGrid testID="fg">
          <FormField size="sm" testID="f-amount"><TextInput value="1200" /></FormField>
          <FormField testID="f-subject"><TextInput value="Door hardware" /></FormField>
          <FormField span="full" testID="f-notes"><TextInput value="Notes" multiline /></FormField>
        </FormGrid>
      </Wrapper>,
    );
    layout('fg', 1200);
    const styleOf = (id: string) => (screen.getByTestId(id).props.style as unknown[]).flat(3).filter(Boolean) as Record<string, unknown>[];
    expect(styleOf('f-amount').some((s) => s.width === (1200 - 24) / 2)).toBe(true);
    expect(styleOf('f-notes').some((s) => s.width === '100%')).toBe(true);
    const cap = (id: string) => (screen.getByTestId(id).children[0] as unknown as { props: { style: Record<string, unknown> } }).props.style.maxWidth;
    expect(cap('f-amount')).toBe(200);
    expect(cap('f-subject')).toBe(480);
    layout('fg', 900);
    expect(styleOf('f-amount').some((s) => s.width === '100%')).toBe(true);
  });

  it('usePrimaryAction: Cmd+Enter / Cmd+S run it; blocked explains the reason', async () => {
    const save = jest.fn();
    function Editor({ disabled }: { disabled: boolean }) {
      usePrimaryAction(save, { label: 'Save RFI', disabled, reason: 'Add a question first.' });
      return <Text>editor</Text>;
    }
    const { rerender, unmount } = render(<Editor disabled={false} />);
    press('Enter', { metaKey: true });
    press('s', { ctrlKey: true });
    expect(save).toHaveBeenCalledTimes(2);
    rerender(<Editor disabled />);
    press('Enter', { metaKey: true });
    expect(save).toHaveBeenCalledTimes(2);
    expect(alertMock.showAlert).toHaveBeenCalledWith('Save RFI', 'Add a question first.');
    unmount();
    expect(hotkeys.list().some((h) => h.label === 'Save RFI')).toBe(false);
  });
});

describe('native keyboard is a no-op', () => {
  beforeEach(() => viewport('ios', 390, 844));
  afterEach(resetViewport);
  it('no DOM → nothing registers, nothing listens', () => {
    const before = hotkeys.size();
    function Editor() {
      usePrimaryAction(() => {}, { label: 'Save' });
      return <Text>editor</Text>;
    }
    const r = render(<Editor />);
    expect(hotkeys.size()).toBe(before);
    r.unmount();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Wave 6d, lane M1 — LineItemGrid's additive props (readOnly, rowsEditable,
// isCellEditable, onCellBlur, footerTotals, footerLabel). Every default is the
// behaviour above; the phone branch is still today's cards.
describe('LineItemGrid — wave 6d additive props', () => {
  /** The TextInput mock shares one focus jest.fn on its prototype; its
   *  recorded `this` says WHICH cell got focus. */
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const focusFn = (require('react-native') as { TextInput: { prototype: { focus: jest.Mock } } }).TextInput.prototype.focus;
  const lastFocused = (): string | undefined => {
    const ctx = focusFn.mock.contexts[focusFn.mock.contexts.length - 1] as { props?: { testID?: string } } | undefined;
    return ctx?.props?.testID;
  };
  const keyPress = (testID: string, key: string, mods: Record<string, unknown> = {}) => {
    fireEvent(screen.getByTestId(testID), 'keyPress', { nativeEvent: { key, ...mods }, preventDefault: () => {} });
  };
  const noop = () => {};

  describe('390 native — phone identical', () => {
    beforeEach(() => viewport('ios', 390, 844));
    afterEach(resetViewport);
    it('with every new prop set, the phone still renders exactly the line cards', () => {
      expectIdenticalPhoneTree(
        <>{LINES.map((l) => <React.Fragment key={l.id}>{lineCard(l)}</React.Fragment>)}</>,
        <LineItemGrid rows={LINES} rowKey={(l) => l.id} columns={LINE_COLS} renderCard={lineCard}
          onChangeCell={noop} onAddRow={noop} onDeleteRow={noop}
          readOnly rowsEditable={false} isCellEditable={() => false} onCellBlur={noop}
          footerTotals={{ total: 999 }} footerLabel="Grand total" />,
      );
    });
  });

  describe('1512 web — desktop', () => {
    beforeEach(() => {
      viewport('web', 1512, 945);
      focusFn.mockClear();
    });
    afterEach(() => {
      cleanup();
      resetViewport();
    });

    it('readOnly: display text only — no TextInput, no add row, no delete column', () => {
      render(
        <Wrapper>
          <LineItemGrid testID="ro" rows={LINES} rowKey={(l) => l.id} columns={LINE_COLS} renderCard={lineCard}
            onChangeCell={noop} onAddRow={noop} onDeleteRow={noop} readOnly />
        </Wrapper>,
      );
      expect(screen.UNSAFE_queryAllByType(TextInput)).toHaveLength(0);
      expect(screen.queryByTestId('ro-add')).toBeNull();
      expect(screen.queryAllByTestId(/^ro-delete-/)).toHaveLength(0);
      expect(screen.getByTestId('ro-text-l1-description')).toBeTruthy();
      expect(screen.getByText('Drywall')).toBeTruthy(); // text as typed
      expect(screen.getByText('$4.50')).toBeTruthy(); // money through format
    });

    it('rowsEditable=false: Enter moves to the same column on the next line and never adds one; no delete, no add row', () => {
      const onAdd = jest.fn();
      const onDelete = jest.fn();
      render(
        <Wrapper>
          <LineItemGrid testID="fx" rows={LINES} rowKey={(l) => l.id} columns={LINE_COLS} renderCard={lineCard}
            onChangeCell={noop} onAddRow={onAdd} onDeleteRow={onDelete} rowsEditable={false} />
        </Wrapper>,
      );
      fireEvent(screen.getByTestId('fx-cell-l1-qty'), 'submitEditing');
      expect(onAdd).not.toHaveBeenCalled();
      expect(lastFocused()).toBe('fx-cell-l2-qty');
      focusFn.mockClear();
      fireEvent(screen.getByTestId('fx-cell-l2-qty'), 'submitEditing'); // the last line: nothing
      expect(onAdd).not.toHaveBeenCalled();
      expect(focusFn).not.toHaveBeenCalled();
      keyPress('fx-cell-l1-qty', 'Backspace', { metaKey: true });
      expect(onDelete).not.toHaveBeenCalled();
      expect(screen.queryByTestId('fx-add')).toBeNull();
      expect(screen.queryAllByTestId(/^fx-delete-/)).toHaveLength(0);
    });

    it('isCellEditable false: that cell is text, and Tab skips it', () => {
      render(
        <Wrapper>
          <LineItemGrid testID="ce" rows={LINES} rowKey={(l) => l.id} columns={LINE_COLS} renderCard={lineCard}
            onChangeCell={noop} onAddRow={noop} onDeleteRow={noop}
            isCellEditable={(l, k) => !(l.id === 'l1' && k === 'qty')} />
        </Wrapper>,
      );
      expect(screen.queryByTestId('ce-cell-l1-qty')).toBeNull();
      expect(screen.getByTestId('ce-text-l1-qty')).toBeTruthy();
      expect(screen.getByTestId('ce-cell-l2-qty')).toBeTruthy(); // only l1's is locked
      keyPress('ce-cell-l1-description', 'Tab');
      expect(lastFocused()).toBe('ce-cell-l1-unit'); // past the locked Qty
      keyPress('ce-cell-l1-unit', 'Tab', { shiftKey: true });
      expect(lastFocused()).toBe('ce-cell-l1-description'); // and back over it
    });

    it('onCellBlur reports the row and column that lost focus', () => {
      const onBlur = jest.fn();
      render(
        <Wrapper>
          <LineItemGrid testID="bl" rows={LINES} rowKey={(l) => l.id} columns={LINE_COLS} renderCard={lineCard}
            onChangeCell={noop} onAddRow={noop} onDeleteRow={noop} onCellBlur={onBlur} />
        </Wrapper>,
      );
      fireEvent(screen.getByTestId('bl-cell-l2-unit'), 'blur');
      expect(onBlur).toHaveBeenCalledWith('l2', 'unit');
    });

    it('footerTotals REPLACES the column sum (null → —, no "not counted"); footerLabel names the row', () => {
      render(
        <Wrapper>
          <LineItemGrid testID="ft" rows={LINES} rowKey={(l) => l.id} columns={LINE_COLS} renderCard={lineCard}
            onChangeCell={noop} onAddRow={noop} onDeleteRow={noop}
            footerTotals={{ total: 1234.5, qty: null }} footerLabel="Grand total" />
        </Wrapper>,
      );
      expect(screen.getByText('$1,234.50')).toBeTruthy(); // the override…
      expect(screen.getAllByText('$45.00')).toHaveLength(1); // …not the sum (only the line's own cell)
      expect(screen.queryByText(/not counted/)).toBeNull(); // Qty's TBD line: no note under an override
      expect(screen.getByText('Grand total')).toBeTruthy();
      expect(screen.getAllByText('Total')).toHaveLength(1); // the column header only
    });

    it('defaults are today: "Total" label, the summed footer, delete column and add row', () => {
      render(
        <Wrapper>
          <LineItemGrid testID="df" rows={LINES} rowKey={(l) => l.id} columns={LINE_COLS} renderCard={lineCard}
            onChangeCell={noop} onAddRow={noop} onDeleteRow={noop} />
        </Wrapper>,
      );
      expect(screen.getAllByText('Total')).toHaveLength(2); // the column header and the footer label
      expect(screen.getAllByText('$45.00')).toHaveLength(2);
      expect(screen.getByTestId('df-add')).toBeTruthy();
      expect(screen.getAllByTestId(/^df-delete-/)).toHaveLength(2);
    });
  });
});
