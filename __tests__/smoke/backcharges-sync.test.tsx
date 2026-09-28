/**
 * Lane HEALTH (H1) — backcharges saved to the account. BEHAVIOUR ONLY, no
 * snapshot.
 *
 * The offline queue, the Not-saved ledger, the account read and the signed-in
 * user are mocked at their module edges; the hook, the row mapper, the merge,
 * the copy and the section run for real.
 *
 *  1. add() writes the device list AND sends supabaseWriteDetailed('backcharges',
 *     'upsert', toRow(b)) — no user_id, no device photo path on the wire.
 *  2. The account read merges into the section, and a row the account returned
 *     reads "Saved to your account."
 *  3. A write that waits in the queue reads "Saved on this device. It goes to
 *     your account when you're back online."
 *  4. A refused write reads "Not saved to your account. Tap to retry." and the
 *     tap resends it through the ledger's Retry.
 *  5. Signed out: device only, today's line, nothing sent.
 *  6. (round 2) Signed in with the account read still pending, or failed:
 *     `complete` is false, so the scorecard gets undefined (the factor is not
 *     counted) — never [] (a false clean record). And a row the account has
 *     not confirmed, with no queued write, reads "Not yet confirmed on your
 *     account.", not the back-online line.
 */
import React, { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/contexts/ThemeContext';
import type { Project, Subcontractor } from '@/types';
import { BACKCHARGES_KEY, parseBackcharges, type Backcharge } from '@/utils/backcharges';

let mockUser: { id: string } | null = { id: 'user-1' };
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

const mockWrite = jest.fn(async (..._args: unknown[]): Promise<'synced' | 'queued' | 'failed'> => 'synced');
let mockQueued: { table: string; data: Record<string, unknown> }[] = [];
jest.mock('@/utils/offlineQueue', () => ({
  supabaseWriteDetailed: (...args: unknown[]) => mockWrite(...args),
  getOwnOfflineQueueDetailed: async () => ({ entries: mockQueued, readFailed: false }),
  recordIdOf: (_t: string, d: Record<string, unknown> | undefined) => (typeof d?.id === 'string' ? d.id : null),
  onQueueChanged: () => () => {},
  onQueueFlushed: () => () => {},
}));

let mockUnsaved = new Set<string>();
const mockRetry = jest.fn(async (_id: string) => 'synced' as const);
jest.mock('@/utils/syncLedger', () => ({
  unsavedWriteIds: async () => new Set(mockUnsaved),
  onSyncLedgerChanged: () => () => {},
  ownUnsavedWrites: async () => [...mockUnsaved].map(id => ({ id: `fail-${id}`, kind: 'write', table: 'backcharges', recordId: id, label: 'backcharges', reason: 'refused', at: 1 })),
  retryUnsavedWrite: (id: string) => mockRetry(id),
}));

let mockServer: Record<string, unknown>[] | null = [];
/** When set, the account read waits on it (a read still in flight). */
let mockFetchGate: Promise<void> | null = null;
jest.mock('@/utils/backchargeRows', () => {
  const actual = jest.requireActual('@/utils/backchargeRows');
  return {
    ...actual,
    fetchAccountBackcharges: async () => {
      if (mockFetchGate) await mockFetchGate;
      return mockServer ? actual.fromRows(mockServer) : null;
    },
  };
});

jest.mock('@/contexts/ProjectContext', () => ({
  useProjects: () => ({
    settings: { branding: { companyName: 'Majeed GC' } },
    getPhotosForProject: () => [],
    getPunchItemsForProject: () => [],
    addProjectPhoto: () => {},
  }),
}));
jest.mock('@/hooks/useLaborRates', () => ({ useLaborRates: () => ({ rates: {} }) }));

// eslint-disable-next-line import/first
import { useBackcharges } from '@/hooks/useBackcharges';
// eslint-disable-next-line import/first
import { BackchargeSection } from '@/components/backcharge/BackchargeSection';
// eslint-disable-next-line import/first
import { toRow, backchargesForScorecard } from '@/utils/backchargeRows';
// eslint-disable-next-line import/first
import { computeSubScorecards } from '@/utils/subScorecard';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
let client: QueryClient;
function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <SafeAreaProvider initialMetrics={METRICS}><ThemeProvider>{children}</ThemeProvider></SafeAreaProvider>
    </QueryClientProvider>
  );
}

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const project = { id: PROJECT_ID, name: 'Oak St' } as unknown as Project;
const sub = { id: 'sub1', companyName: 'Acme Drywall', contactName: 'Joe Acme' } as unknown as Subcontractor;
const bc = (o: Partial<Backcharge> & { id: string }): Backcharge => ({
  projectId: PROJECT_ID, subId: 'sub1', subName: 'Acme Drywall', commitmentId: null, reason: `Reason ${o.id}`,
  amountCents: 45000, basis: 'typed', hours: null, rateCents: null, photoUri: null, photoId: null, punchItemId: null,
  status: 'open', appliedInvoiceId: null, appliedAt: null, createdAt: '2026-09-28T10:00:00.000Z', ...o,
});

let api: ReturnType<typeof useBackcharges> | null = null;
function Probe() {
  const h = useBackcharges();
  useEffect(() => { api = h; });
  return null;
}

async function flush(n = 8) {
  for (let i = 0; i < n; i++) {
    await act(async () => { for (let k = 0; k < 20; k++) await Promise.resolve(); });
  }
}

describe('backcharges saved to the account', () => {
  beforeEach(async () => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await AsyncStorage.clear();
    mockUser = { id: 'user-1' };
    mockWrite.mockClear();
    mockWrite.mockImplementation(async () => 'synced');
    mockRetry.mockClear();
    mockQueued = [];
    mockUnsaved = new Set();
    mockServer = [];
    mockFetchGate = null;
    api = null;
  });

  it('add() writes the device list AND sends the mapped row through the queue', async () => {
    render(<Probe />, { wrapper: Wrapper });
    await flush();
    const b = bc({ id: 'a1', photoUri: 'file:///var/mobile/tmp/IMG_1.jpg', photoId: 'photo-1', punchItemId: 'punch-1' });
    await act(async () => { api!.add(b); });
    await flush();
    const onDisk = parseBackcharges(await AsyncStorage.getItem(BACKCHARGES_KEY));
    expect(onDisk.map(x => x.id)).toEqual(['a1']);
    expect(onDisk[0].photoUri).toBe('file:///var/mobile/tmp/IMG_1.jpg');
    expect(mockWrite).toHaveBeenCalledWith('backcharges', 'upsert', toRow(b));
    const sent = mockWrite.mock.calls.find(c => (c[2] as { id: string }).id === 'a1')![2] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('user_id');
    expect(JSON.stringify(sent)).not.toContain('IMG_1.jpg');
    expect(sent.amount_cents).toBe(45000);
    await waitFor(() => expect(api!.statusOf('a1')).toBe('saved'));
  });

  it('the account read merges into the section, and a returned row reads "Saved to your account."', async () => {
    mockServer = [toRow(bc({ id: 's1', reason: 'Dumpster for their debris' })) as unknown as Record<string, unknown>];
    render(<BackchargeSection project={project} sub={sub} commitments={[]} />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('backcharge-row-s1')).toBeTruthy());
    expect(screen.getByText('Dumpster for their debris')).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/Saved to your account\./)).toBeTruthy());
    expect(screen.queryByText(/Saved on this device until you sign out/)).toBeNull();
    // A server row is not sent back up.
    expect(mockWrite.mock.calls.some(c => (c[2] as { id: string }).id === 's1')).toBe(false);
    const onDisk = parseBackcharges(await AsyncStorage.getItem(BACKCHARGES_KEY));
    expect(onDisk.map(x => x.id)).toContain('s1');
  });

  it('a device row made before this update is sent up once', async () => {
    await AsyncStorage.setItem(BACKCHARGES_KEY, JSON.stringify([bc({ id: 'old1' })]));
    render(<BackchargeSection project={project} sub={sub} commitments={[]} />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('backcharge-row-old1')).toBeTruthy());
    await waitFor(() => expect(mockWrite.mock.calls.filter(c => (c[2] as { id: string }).id === 'old1')).toHaveLength(1));
  });

  it('a write waiting in the queue reads the back-online line', async () => {
    mockWrite.mockImplementation(async (...args: unknown[]) => {
      mockQueued = [{ table: 'backcharges', data: args[2] as Record<string, unknown> }];
      return 'queued';
    });
    render(<><Probe /><BackchargeSection project={project} sub={sub} commitments={[]} /></>, { wrapper: Wrapper });
    await flush();
    await act(async () => { api!.add(bc({ id: 'q1' })); });
    await flush();
    await waitFor(() => expect(screen.getByText(/Saved on this device\. It goes to your account when you're back online\./)).toBeTruthy());
    expect(api!.statusOf('q1')).toBe('waiting');
  });

  it('a refused write reads "Not saved to your account. Tap to retry." and the tap resends it', async () => {
    await AsyncStorage.setItem(BACKCHARGES_KEY, JSON.stringify([bc({ id: 'r1' })]));
    mockUnsaved = new Set(['r1']);
    render(<BackchargeSection project={project} sub={sub} commitments={[]} />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('backcharge-storage-retry')).toBeTruthy());
    expect(screen.getByText('Not saved to your account. Tap to retry.')).toBeTruthy();
    // Refused: kept on the device, never re-sent on its own.
    expect(mockWrite.mock.calls.some(c => (c[2] as { id: string }).id === 'r1')).toBe(false);
    await act(async () => { fireEvent.press(screen.getByTestId('backcharge-storage-retry')); });
    await flush();
    expect(mockRetry).toHaveBeenCalledWith('fail-r1');
  });

  it('signed out: device only, today\'s line, nothing sent', async () => {
    mockUser = null;
    render(<><Probe /><BackchargeSection project={project} sub={sub} commitments={[]} /></>, { wrapper: Wrapper });
    await flush();
    await act(async () => { api!.add(bc({ id: 'd1' })); });
    await flush();
    expect(screen.getByText(/Saved on this device until you sign out\./)).toBeTruthy();
    expect(mockWrite).not.toHaveBeenCalled();
    expect(api!.statusOf('d1')).toBe('device');
    expect(parseBackcharges(await AsyncStorage.getItem(BACKCHARGES_KEY)).map(x => x.id)).toEqual(['d1']);
  });

  it('signed in, account read still pending: not complete, so the scorecard factor is not counted', async () => {
    // A user no earlier test has read for (the hook's list is module state).
    mockUser = { id: 'user-pending' };
    let open: () => void = () => {};
    mockFetchGate = new Promise<void>(r => { open = r; });
    mockServer = [toRow(bc({ id: 'k1', amountCents: 800000 })) as unknown as Record<string, unknown>];
    render(<Probe />, { wrapper: Wrapper });
    await flush();
    expect(api!.loaded).toBe(true);
    expect(api!.complete).toBe(false);
    const pending = backchargesForScorecard(api!.list, api!.complete);
    expect(pending).toBeUndefined();
    // A sub on 3 projects: with the read pending the factor is NOT applicable —
    // never "No backcharges on 3 projects" at full marks.
    const sub = { id: 'sub1', companyName: 'Acme Drywall', trade: 'Drywall' } as unknown as Subcontractor;
    const commitments = [1, 2, 3].map(i => ({
      id: `c${i}`, projectId: `p${i}`, subcontractorId: 'sub1', vendorName: 'Acme Drywall', amount: 50000, changeAmount: 0,
      status: 'signed', type: 'subcontract', createdAt: '2026-01-01T00:00:00.000Z',
    })) as never[];
    const card = (backcharges: ReturnType<typeof backchargesForScorecard>) => computeSubScorecards({
      subcontractors: [sub], commitments, changeOrders: [], punchItems: [], projects: [], rfis: [], backcharges,
    }).cards[0];
    const factorWhilePending = card(pending)?.factors.find(f => f.key === 'backcharges');
    expect(factorWhilePending?.applicable).toBe(false);
    expect(JSON.stringify(factorWhilePending)).not.toMatch(/No backcharges/);
    // The read lands: complete, and the account's row counts.
    await act(async () => { open(); });
    await waitFor(() => expect(api!.complete).toBe(true));
    const read = backchargesForScorecard(api!.list, api!.complete);
    expect(read?.map(b => b.id)).toEqual(['k1']);
  });

  it('a failed account read stays not complete, and an unconfirmed row never claims "back online"', async () => {
    mockUser = { id: 'user-offline' };
    mockServer = null; // the read fails (offline, or the table not there yet)
    await AsyncStorage.setItem(BACKCHARGES_KEY, JSON.stringify([bc({ id: 'o1' })]));
    render(<><Probe /><BackchargeSection project={project} sub={sub} commitments={[]} /></>, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('backcharge-row-o1')).toBeTruthy());
    await flush();
    expect(api!.complete).toBe(false);
    expect(backchargesForScorecard(api!.list, api!.complete)).toBeUndefined();
    expect(api!.statusOf('o1')).toBe('unconfirmed');
    expect(screen.getByText(/Saved on this device\. Not yet confirmed on your account\./)).toBeTruthy();
    expect(screen.queryByText(/back online/)).toBeNull();
  });
});
