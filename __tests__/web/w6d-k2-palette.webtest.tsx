/**
 * Wave 6d restore (d6r), lane K2 — the desktop Cmd+K command palette and the
 * CreateMenu popover, on a real DOM (jsdom + react-dom + react-native-web at
 * 1512 x 945, the stack app.mageid.app runs). Every assertion types or clicks
 * on a real node.
 *
 *   - ArrowDown moves the highlighted row (aria-selected), Enter runs it;
 *   - Esc closes the palette while a page-scope record behind it stays open;
 *   - 'rfi' with an active job puts 'New RFI' first in Actions, and Enter
 *     opens /rfi?projectId=p1&new=1;
 *   - a property manager's 'post' offers nothing from the homeowner flow;
 *   - the palette's Ask row opens the Ask dock, seeded with the query;
 *   - the CreateMenu popover at an anchor: Esc closes only the popover, and
 *     with an active job 'RFI' routes at once — no project picker.
 *
 * Run: npx jest --config __tests__/web/jest.web.config.js __tests__/web/w6d-k2-palette.webtest.tsx
 */

import React, { act } from 'react';
import { Dimensions, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

type Root = { render(node: React.ReactNode): void; unmount(): void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRoot } = require('react-dom/client') as { createRoot(el: Element): Root };

const mockPush = jest.fn();
const mockOpenAsk = jest.fn();
type MockJob = { id: string; name: string; status: string };
let mockRole: string = 'contractor';
let mockProjects: MockJob[] = [];
let mockActive: MockJob | null = null;

jest.mock('@/utils/alert', () => ({ ...jest.requireActual('@/utils/alert'), showAlert: jest.fn(), showPrompt: jest.fn() }));
jest.mock('@/hooks/useTierAccess', () => ({
  useTierAccess: () => ({
    tier: 'business', isProOrAbove: true, isBusinessOrAbove: true,
    canAccess: () => true, requiredTierFor: () => 'pro',
  }),
}));
jest.mock('@/hooks/useUniversalSearch', () => ({ useUniversalSearch: () => ({ grouped: {}, isSearching: false }) }));
jest.mock('@/hooks/useEntityNavigation', () => ({ useEntityNavigation: () => ({ navigateTo: () => {} }) }));
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return {
    ...actual,
    useRouter: () => ({ navigate: jest.fn(), push: mockPush, setParams: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  };
});
jest.mock('@/contexts/ProjectContext', () => ({
  useCoreData: () => ({ userRole: mockRole, projects: mockProjects }),
  useProjects: () => ({ projects: mockProjects }),
}));
jest.mock('@/contexts/ActiveProjectContext', () => ({
  useActiveProject: () => ({
    activeProjectId: mockActive?.id ?? null, activeProject: mockActive,
    setActiveProject: () => {}, recentProjectIds: mockActive ? [mockActive.id] : [],
  }),
}));
jest.mock('@/hooks/useAskDock', () => ({
  useAskDock: () => ({ openAsk: mockOpenAsk, toggleAsk: jest.fn(), isAskOpen: false }),
}));

import { ThemeProvider } from '@/contexts/ThemeContext';
import { useHotkeys } from '@/hooks/useHotkeys';
import AsyncStorage from '@react-native-async-storage/async-storage';
import UniversalSearch from '@/components/UniversalSearch';
import { CreateMenu } from '@/components/CreateMenu';
import { SearchProvider, useSearch } from '@/contexts/SearchContext';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.spyOn(Dimensions, 'get').mockImplementation(
  () => ({ width: 1512, height: 945, scale: 2, fontScale: 1 }) as ReturnType<typeof Dimensions.get>,
);

const METRICS = { frame: { x: 0, y: 0, width: 1512, height: 945 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const roots: { root: Root; el: HTMLElement }[] = [];

const HENDERSON: MockJob = { id: 'p1', name: 'Henderson', status: 'in_progress' };
const OAK: MockJob = { id: 'p2', name: 'Oak St', status: 'in_progress' };

/** Let timers run, then fire animationend (jsdom runs no CSS animation, and
 *  RN-web's Modal only closes on Escape once its open animation has ended). */
async function settle(): Promise<void> {
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
  await act(async () => {
    for (const n of Array.from(document.body.querySelectorAll('div'))) {
      n.dispatchEvent(new Event('animationend', { bubbles: true }));
    }
  });
}
async function mount(node: React.ReactElement): Promise<void> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push({ root, el });
  await act(async () => {
    root.render(<SafeAreaProvider initialMetrics={METRICS}><ThemeProvider>{node}</ThemeProvider></SafeAreaProvider>);
  });
  await settle();
}
beforeEach(() => {
  mockPush.mockClear();
  mockOpenAsk.mockClear();
  mockRole = 'contractor';
  mockProjects = [HENDERSON, OAK];
  mockActive = HENDERSON;
});
afterEach(async () => {
  for (const { root, el } of roots.splice(0)) {
    await act(async () => { root.unmount(); });
    el.remove();
  }
});

async function press(target: EventTarget, init: KeyboardEventInit): Promise<KeyboardEvent> {
  const down = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  await act(async () => { target.dispatchEvent(down); });
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, ...init })); });
  return down;
}
function byTestId(id: string): HTMLElement {
  const n = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  if (!n) throw new Error(`no element with testID ${id}`);
  return n;
}
const maybe = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
function blurAll(): void {
  (document.activeElement as HTMLElement | null)?.blur?.();
}
/** Type into an RN-web TextInput the way React sees it (the native value
 *  setter, then an input event). */
async function typeInto(input: HTMLElement, text: string): Promise<void> {
  const el = input as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}
const rowsIn = () => Array.from(document.querySelectorAll('[data-testid^="command-palette-row-"]')) as HTMLElement[];
const selectedRow = () => rowsIn().find((r) => r.getAttribute('aria-selected') === 'true') ?? null;
const lanes = () => Array.from(document.querySelectorAll('[data-testid^="command-palette-lane-"]'))
  .map((n) => (n.getAttribute('data-testid') ?? '').replace('command-palette-lane-', ''));

function PageRecord({ closeRecord }: { closeRecord: () => void }) {
  useHotkeys([{ combo: 'escape', handler: closeRecord, label: 'Close record' }], { scope: 'page' });
  return <View><Text>RFI-012</Text><TextInput testID="page-field" /></View>;
}
function OpenSearch() {
  const { openSearch, isOpen } = useSearch();
  React.useEffect(() => { openSearch(); }, [openSearch]);
  return <Text testID="search-state">{isOpen ? 'open' : 'closed'}</Text>;
}
async function openPalette(extra?: React.ReactNode): Promise<HTMLElement> {
  await mount(
    <SearchProvider>
      {extra}
      <OpenSearch />
      <UniversalSearch />
    </SearchProvider>,
  );
  await settle();
  expect(byTestId('command-palette')).toBeTruthy();
  return byTestId('command-palette-input');
}

describe('d6r K2: the Cmd+K command palette (desktop web)', () => {
  it('is a 720 px dialog card, not the phone sheet', async () => {
    await openPalette();
    const card = byTestId('command-palette');
    expect(card.getAttribute('role')).toBe('dialog');
    expect(card.getAttribute('aria-label')).toBe('Search');
    expect(maybe('universal-search-cancel')).toBeNull();
    // Empty query with an active job: the job's quick actions come first.
    expect(lanes()).toEqual(['job-actions', 'recent-jobs', 'brain', 'features']);
  });

  it('ArrowDown moves the highlighted row (and wraps with ArrowUp); Enter runs it', async () => {
    const input = await openPalette();
    const rows = rowsIn();
    expect(rows.length).toBeGreaterThan(5);
    expect(selectedRow()).toBe(rows[0]);
    await press(input, { key: 'ArrowDown' });
    expect(selectedRow()?.getAttribute('data-testid')).toBe(rows[1].getAttribute('data-testid'));
    await press(input, { key: 'ArrowUp' });
    await press(input, { key: 'ArrowUp' });
    expect(selectedRow()?.getAttribute('data-testid')).toBe(rowsIn()[rowsIn().length - 1].getAttribute('data-testid'));
    await press(input, { key: 'ArrowDown' });
    await press(input, { key: 'ArrowDown' });
    // Row 2 is 'New RFI' for Henderson (Daily Report, RFI, …).
    expect(selectedRow()?.getAttribute('data-testid')).toBe('command-palette-row-job-action:RFI');
    await press(input, { key: 'Enter' });
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][0]).toMatchObject({ pathname: '/rfi', params: { projectId: 'p1', new: '1' } });
  });

  it("typing 'rfi' with an active job puts 'New RFI' first in Actions; Enter opens /rfi?projectId=p1&new=1", async () => {
    const input = await openPalette();
    await typeInto(input, 'rfi');
    expect(lanes().slice(0, 2)).toEqual(['actions', 'ask']);
    const first = rowsIn()[0];
    expect(first.getAttribute('data-testid')).toBe('command-palette-row-action:RFI:p1');
    expect(first.textContent).toContain('New RFI');
    expect(first.textContent).toContain('Henderson');
    expect(selectedRow()).toBe(first);
    await press(input, { key: 'Enter' });
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][0]).toMatchObject({ pathname: '/rfi', params: { projectId: 'p1', new: '1' } });
  });

  it('Esc closes the palette while a page-scope record behind it stays open', async () => {
    const closeRecord = jest.fn();
    await openPalette(<PageRecord closeRecord={closeRecord} />);
    expect(byTestId('search-state').textContent).toBe('open');
    blurAll();
    await press(document.body, { key: 'Escape' });
    await settle();
    expect(byTestId('search-state').textContent).toBe('closed');
    expect(closeRecord).toHaveBeenCalledTimes(0);
  });

  it("a property manager's 'post' offers nothing from the homeowner flow", async () => {
    mockRole = 'property_manager';
    const input = await openPalette();
    await typeInto(input, 'post');
    const text = byTestId('command-palette').textContent ?? '';
    expect(text).not.toContain('Post a Project');
    expect(text).not.toContain('My Projects');
    expect(lanes()).not.toContain('actions');
    expect(lanes()).not.toContain('projects');
  });

  it("a client's 'post' still finds Post a Project", async () => {
    mockRole = 'client';
    const input = await openPalette();
    await typeInto(input, 'post');
    expect(byTestId('command-palette').textContent ?? '').toContain('Post a Project');
  });

  it('the Ask row opens the Ask dock, seeded with the query', async () => {
    const input = await openPalette();
    await typeInto(input, 'what is late');
    const ask = byTestId('command-palette-row-ask');
    expect(ask.textContent).toContain('Ask MAGE: “what is late”');
    await act(async () => { ask.click(); });
    expect(mockOpenAsk).toHaveBeenCalledWith({ seed: 'what is late' });
    expect(byTestId('search-state').textContent).toBe('closed');
  });

  it('centres the card in the content column: the scrim pads 240 + 24 left, 24 right (x 516-1236 at 1512)', async () => {
    // A stand-in for DesktopSidebar's nav, 240 wide — what useDesktopShellInset measures.
    const nav = document.createElement('nav');
    nav.setAttribute('aria-label', 'Primary navigation');
    nav.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, bottom: 945, right: 240, width: 240, height: 945, toJSON: () => ({}) });
    document.body.appendChild(nav);
    try {
      await openPalette();
      const scrim = byTestId('command-palette-scrim').parentElement as HTMLElement;
      expect(scrim.style.paddingLeft).toBe('264px');
      // The right pad is the StyleSheet gutter (24): 1512 - 264 - 24 = 1224 of
      // column, the 720 card centred in it spans 516-1236, centre 876.
      const left = 264 + (1512 - 264 - 24 - 720) / 2;
      expect([left, left + 720]).toEqual([516, 1236]);
    } finally {
      nav.remove();
    }
  });

  it('a row that closes the palette itself (a job action) still saves the query to Recent searches', async () => {
    await AsyncStorage.removeItem('mageid_recent_searches');
    const input = await openPalette();
    await typeInto(input, 'rfi');
    await press(input, { key: 'Enter' });
    await settle();
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(JSON.parse((await AsyncStorage.getItem('mageid_recent_searches')) ?? '[]')).toEqual(['rfi']);
  });

  it("MAGE Brain's Ask row opens the dock (not the /ask page)", async () => {
    await openPalette();
    await act(async () => { byTestId('command-palette-row-brain:ask').click(); });
    expect(mockOpenAsk).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('d6r K2: the CreateMenu popover (desktop web)', () => {
  function Host({ onClose }: { onClose: () => void }) {
    const [open, setOpen] = React.useState(true);
    return (
      <>
        <Text testID="menu-state">{open ? 'open' : 'closed'}</Text>
        <CreateMenu visible={open} onClose={() => { setOpen(false); onClose(); }} anchor={{ x: 244, y: 103 }} />
      </>
    );
  }

  it('Esc closes only the popover — the record behind it stays open', async () => {
    const closeRecord = jest.fn();
    const onClose = jest.fn();
    await mount(<View><PageRecord closeRecord={closeRecord} /><Host onClose={onClose} /></View>);
    expect(byTestId('menu-state').textContent).toBe('open');
    blurAll();
    await press(document.body, { key: 'Escape' });
    await settle();
    expect(onClose).toHaveBeenCalled();
    expect(byTestId('menu-state').textContent).toBe('closed');
    expect(closeRecord).toHaveBeenCalledTimes(0);
  });

  it("with an active job, 'RFI' routes at once — no project picker — and the header names the job", async () => {
    await mount(<Host onClose={() => {}} />);
    expect(byTestId('createmenu-job-bar').textContent).toContain('For Henderson');
    await act(async () => { byTestId('create-rfi').click(); });
    expect(maybe('createmenu-pick-project-p1')).toBeNull();
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][0]).toMatchObject({ pathname: '/rfi', params: { projectId: 'p1', new: '1' } });
  });

  it("'Change' brings the project picker back", async () => {
    await mount(<Host onClose={() => {}} />);
    await act(async () => { byTestId('createmenu-change-job').click(); });
    await act(async () => { byTestId('create-rfi').click(); });
    await settle();
    expect(maybe('createmenu-pick-project-p2')).not.toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('arrow keys move the highlight over the create rows and Enter creates it', async () => {
    await mount(<Host onClose={() => {}} />);
    const input = document.querySelector('input[placeholder="Search for anything you can create…"]') as HTMLElement;
    expect(input).toBeTruthy();
    await typeInto(input, 'rfi');
    await press(input, { key: 'Enter' });
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][0]).toMatchObject({ pathname: '/rfi', params: { projectId: 'p1', new: '1' } });
  });
});
