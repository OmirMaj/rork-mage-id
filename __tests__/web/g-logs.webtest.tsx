/**
 * Real-DOM proof for the wave-6c lane-G logs (jsdom + react-dom +
 * react-native-web — the stack app.mageid.app runs).
 *
 *   1. SplitView collapseWhenEmpty: with nothing open the list takes the whole
 *      row (width 100%) and there is no divider and no "pick a row" pane;
 *      opening a record brings the divider (print-hidden) and the record pane
 *      back — and the list's DOM node is the SAME node, never remounted, so
 *      his search / sort / scroll survive.
 *   2. useLogAwareRouter: inside a log's record pane, back() closes the record
 *      and a same-route replace opens that record in place; any other replace
 *      is the real router's. Outside a log it IS useRouter()'s object.
 *   3. RecordContextStrip: an unknown fact reads '—', never 0.
 *
 * Run: npx jest --config __tests__/web/jest.web.config.js __tests__/web/g-logs.webtest.tsx
 */

import React, { act } from 'react';
import { Dimensions, Text } from 'react-native';

type Root = { render(node: React.ReactNode): void; unmount(): void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRoot } = require('react-dom/client') as { createRoot(el: Element): Root };

const mockRouter = { navigate: jest.fn(), push: jest.fn(), replace: jest.fn(), setParams: jest.fn(), back: jest.fn(), canGoBack: () => false };
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return { ...actual, useRouter: () => mockRouter };
});
jest.mock('@/utils/alert', () => ({ showAlert: jest.fn(), showPrompt: jest.fn() }));

import { ThemeProvider } from '@/contexts/ThemeContext';
import { SplitView } from '@/components/desktop/SplitView';
import { LogRecordContext, useLogAwareRouter, type LogRecordHost } from '@/components/logs/LogRecordHost';
import { RecordContextStrip } from '@/components/logs/RecordContextStrip';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.spyOn(Dimensions, 'get').mockImplementation(
  () => ({ width: 1512, height: 945, scale: 2, fontScale: 1 }) as ReturnType<typeof Dimensions.get>,
);

const roots: { root: Root; el: HTMLElement }[] = [];
async function mount(node: React.ReactElement): Promise<{ el: HTMLElement; root: Root }> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push({ root, el });
  await act(async () => { root.render(<ThemeProvider>{node}</ThemeProvider>); });
  return { el, root };
}
afterEach(async () => {
  for (const { root, el } of roots.splice(0)) {
    await act(async () => { root.unmount(); });
    el.remove();
  }
  for (const f of Object.values(mockRouter)) if (typeof f === 'function' && 'mockClear' in f) (f as jest.Mock).mockClear();
});

const byId = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

function split(openId: string | null) {
  return (
    <SplitView
      splitId="g-webtest"
      testID="sv"
      collapseWhenEmpty
      openId={openId}
      onClose={() => {}}
      list={<Text testID="the-list">rows</Text>}
      detail={openId ? <Text testID="the-record">record {openId}</Text> : null}
    />
  );
}

describe('SplitView collapseWhenEmpty (real DOM, 1512)', () => {
  it('nothing open: the list fills the row; no divider, no empty pane', async () => {
    const { el } = await mount(split(null));
    const list = byId(el, 'sv-list');
    expect(list).not.toBeNull();
    expect(list!.style.width).toBe('100%');
    expect(byId(el, 'sv-divider')).toBeNull();
    expect(byId(el, 'sv-detail')).toBeNull();
    expect(el.textContent).not.toMatch(/Pick a row/);
  });

  it('opening a record restores the divider (print-hidden) and the pane — on the SAME list node', async () => {
    const { el, root } = await mount(split(null));
    const before = byId(el, 'the-list');
    await act(async () => { root.render(<ThemeProvider>{split('r1')}</ThemeProvider>); });
    const divider = byId(el, 'sv-divider');
    expect(divider).not.toBeNull();
    expect(divider!.getAttribute('data-print')).toBe('hide');
    expect(byId(el, 'the-record')?.textContent).toBe('record r1');
    expect(byId(el, 'sv-list')!.style.width).not.toBe('100%');
    // Not remounted: the very same DOM node.
    expect(byId(el, 'the-list')).toBe(before);
    // …and closing collapses it again, still the same node.
    await act(async () => { root.render(<ThemeProvider>{split(null)}</ThemeProvider>); });
    expect(byId(el, 'sv-divider')).toBeNull();
    expect(byId(el, 'the-list')).toBe(before);
  });

  it('without collapseWhenEmpty the "pick a row" pane is unchanged (default off)', async () => {
    const { el } = await mount(
      <SplitView splitId="g-webtest-2" testID="sv2" openId={null} onClose={() => {}} list={<Text>rows</Text>} detail={null} />,
    );
    expect(byId(el, 'sv2-divider')).not.toBeNull();
    expect(el.textContent).toMatch(/Pick a row/);
  });
});

describe('useLogAwareRouter (the editor inside a log record pane)', () => {
  let captured: ReturnType<typeof useLogAwareRouter> | null = null;
  function Probe() { captured = useLogAwareRouter(); return null; }

  it('outside a log it IS useRouter()', async () => {
    await mount(<Probe />);
    expect(captured).toBe(mockRouter);
  });

  it('inside a log: back() closes the record, same-route replace opens in place, others are real', async () => {
    const host: LogRecordHost = { kind: 'rfi', close: jest.fn(), replaceRecord: jest.fn(), setDirtyProbe: jest.fn() };
    await mount(<LogRecordContext.Provider value={host}><Probe /></LogRecordContext.Provider>);
    expect(captured).not.toBe(mockRouter);
    captured!.back();
    expect(host.close).toHaveBeenCalledTimes(1);
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(captured!.canGoBack()).toBe(true);
    captured!.replace({ pathname: '/rfi', params: { projectId: 'p', rfiId: 'r9' } });
    expect(host.replaceRecord).toHaveBeenCalledWith('r9');
    expect(mockRouter.replace).not.toHaveBeenCalled();
    captured!.replace({ pathname: '/project-detail', params: { id: 'p' } });
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    // push is still the real router's.
    captured!.push('/rfi');
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
  });
});

describe('RecordContextStrip', () => {
  it("an unknown fact reads '—', never 0", async () => {
    const { el } = await mount(
      <RecordContextStrip testID="strip" status={{ label: 'Open', tone: 'warning' }} facts={[{ label: 'Days open', value: null }, { label: 'Due', value: 'Sep 5' }]} />,
    );
    const text = byId(el, 'strip')!.textContent ?? '';
    expect(text).toContain('Days open—');
    expect(text).toContain('DueSep 5');
    expect(text).not.toMatch(/Days open0/);
  });
});
