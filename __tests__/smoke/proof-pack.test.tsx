/**
 * Smoke — the Pay Period Record (lane PROOFPACK): the entry row
 * (components/proofPack/ProofPackEntryRow), the route (app/proof-pack) and the
 * review screen (components/proofPack/ProofPackReview).
 *
 * Fixtures only, no network: the project context is a fixture, the share step
 * (utils/proofPack/share createAndShareProofPack) and the saved-package store
 * are jest.fn. The pure rules (strength classes, period, linking, fingerprint,
 * wording) run under bun in scripts/validate-proof-pack.ts; this file proves
 * what the SCREENS do with them.
 *
 * THE FLAG is NOT mocked: constants/featureFlags.ts PROOF_PACK_ENABLED is
 * false, as shipped. Everything a non-owner sees is therefore the real dark
 * state, and the owner's account is the only way in.
 *
 *   1  flag off, not the owner: the row renders nothing and the route redirects
 *   2  the owner on a project he owns: one row; a tap goes to /proof-pack
 *   3  the owner's account on an editor seat: no row; the route says why
 *   3b a seat that could not be read says so and offers another try
 *   4  no saved pay document: no row
 *   5  the review opens with the two "what this is and is not" sentences
 *   6  every listed record shows its strength; the counts are the package's
 *   7  a switch leaves a record out, and the screen says it will be disclosed
 *   8  nothing is made until Create and Share is tapped; one tap, one package,
 *      with the left-out count inside it
 *   9  a package whose fingerprint is not on file says so
 *  10  a pay document that is not on the device says so and offers no button
 *  11  a saved package can be checked again and the answer is shown
 */
import React from 'react';
import { act, cleanupAsync, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return { ThemeProvider: ({ children }: { children: React.ReactNode }) => children, useTheme: () => value };
});

const mockPush = jest.fn();
let mockParams: Record<string, string | undefined> = { projectId: 'p1', kind: 'pay_app', payId: 'app3' };
jest.mock('expo-router', () => {
  const R = jest.requireActual('react');
  return {
    useRouter: () => ({ push: mockPush, back: () => {}, replace: () => {} }),
    useLocalSearchParams: () => mockParams,
    Redirect: ({ href }: { href: string }) => R.createElement('Redirect', { href, testID: 'redirect' }),
    Stack: { Screen: () => null },
  };
});

const OWNER = 'omirmajeed2000@gmail.com';
let mockUser: { id: string; email?: string } | null = { id: 'user-1', email: 'someone@example.com' };
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));

let mockRole: string | null = 'owner';
let mockRoleError = false;
const mockRefetch = jest.fn();
jest.mock('@/hooks/useProjectRole', () => ({
  useProjectRole: () => mockRole,
  useProjectRoleState: () => ({ role: mockRoleError ? null : mockRole, isLoading: false, isError: mockRoleError, refetch: mockRefetch }),
}));
jest.mock('@/hooks/usePunchSeal', () => ({ usePunchSeal: () => ({ status: 'ready', seal: null, serverItems: [], refetch: async () => {} }) }));
jest.mock('@/utils/lienWaiverEngine', () => ({ loadLienWaiversChecked: async () => ({ ok: true, waivers: [] }) }));

const at = (day: string, hh = '12:00') => `${day}T${hh}:00Z`;
const mockPayApp = {
  id: 'app3', projectId: 'p1', applicationNumber: 3, applicationDate: '2026-09-30', periodTo: '2026-09-30', periodFrom: '2026-09-01',
  ownerName: 'Dana Client', contractorName: 'Example Builders', projectName: 'Alder Street Renovation',
  originalContractSum: 180000, netChangeByCO: 0, contractSumToDate: 180000, retainagePercent: 10, lessPreviousCertificates: 0,
  lines: [{ id: 'l1', itemNo: '1.0', description: 'Framing', scheduledValue: 40000, fromPreviousApp: 0, thisPeriod: 12000, materialsPresentlyStored: 0, retainagePercent: 10, linkedTaskId: 't1' }],
  totals: { totalScheduledValue: 40000, totalCompletedAndStored: 12000, totalRetainage: 1200, totalEarnedLessRetainage: 10800, currentPaymentDue: 10800, balanceToFinish: 169200, percentComplete: 30 },
  savedAt: at('2026-09-30'),
};
const mockCtx = {
  projects: [{ id: 'p1', name: 'Alder Street Renovation', location: '14 Alder Street, Baltimore, MD 21201' }],
  settings: { branding: { companyName: 'Example Builders', contactName: '', email: '', phone: '', address: '', licenseNumber: '' } },
  dailyReportsLoaded: true,
  photosLoaded: true,
  getAIAPayAppsForProject: () => [mockPayApp],
  getInvoicesForProject: () => [],
  getDailyReportsForProject: () => [
    { id: 'd1', projectId: 'p1', date: '2026-09-10', status: 'sent', weather: { temperature: '70', conditions: 'Clear', wind: '', isManual: true },
      manpower: [{ id: 'm1', trade: 'Carpenter', company: 'Private Framing', headcount: 4, hoursWorked: 8 }], workPerformed: 'Framed the second floor walls',
      workProgress: [{ taskId: 't1', taskName: 'Framing', phase: 'Structure', pct: 60 }], issuesAndDelays: '', materialsDelivered: [], photos: [],
      createdAt: at('2026-09-10'), updatedAt: at('2026-09-10') },
  ],
  getPhotosForProject: () => [
    { id: 'ph1', projectId: 'p1', uri: 'file://ph1.jpg', storagePath: 'u/p1/ph1.jpg', timestamp: at('2026-09-10'), createdAt: at('2026-09-10'), latitude: 39.29, longitude: -76.61, linkedTaskId: 't1' },
    { id: 'ph2', projectId: 'p1', uri: 'file://ph2.jpg', timestamp: at('2026-09-12'), createdAt: at('2026-09-12') },
  ],
  getChangeOrdersForProject: () => [
    { id: 'co14', number: 14, projectId: 'p1', date: '2026-09-05', description: 'Door swap', reason: '', lineItems: [], originalContractValue: 0, changeAmount: 300, newContractTotal: 0, status: 'approved',
      auditTrail: [{ id: 'a', action: 'marked_approved', actor: 'Sam GC', timestamp: at('2026-09-05') }], createdAt: at('2026-09-05'), updatedAt: at('2026-09-05') },
  ],
  getPunchItemsForProject: () => [],
  getPermitsForProject: () => [],
  getFieldTicketsForProject: () => [],
};
jest.mock('@/contexts/ProjectContext', () => ({ useProjects: () => mockCtx }));

const mockCreate = jest.fn();
const mockCheckFile = jest.fn();
jest.mock('@/utils/proofPack/share', () => ({
  createAndShareProofPack: (args: unknown) => mockCreate(args),
  checkFileAgainst: (uri: string, hash: unknown) => mockCheckFile(uri, hash),
}));
const mockReadSaved = jest.fn(async (_projectId: string): Promise<unknown[]> => []);
const mockRecheck = jest.fn();
jest.mock('@/utils/proofPack/store', () => ({
  readSavedProofPacks: (id: string) => mockReadSaved(id),
  readCoSignatureRecords: async () => [],
  recheckSavedProofPack: (s: unknown) => mockRecheck(s),
}));

import { SafeAreaProvider } from 'react-native-safe-area-context';
import ProofPackRoute from '@/app/proof-pack';
import { ProofPackEntryRow } from '@/components/proofPack/ProofPackEntryRow';
import { ProofPackReview } from '@/components/proofPack/ProofPackReview';
import { PROOF_PACK_ENABLED } from '@/constants/featureFlags';
import type { ProofPack } from '@/utils/proofPack/core';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const Wrap = ({ children }: { children: React.ReactNode }) => <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>;
const settle = async () => { await act(async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); }); };
const IS = 'This is a record of what MAGE ID holds for this pay period.';
const IS_NOT = 'It is not an inspection, an appraisal or a certification of the work.';

beforeEach(() => {
  mockPush.mockClear();
  mockCreate.mockReset();
  mockCheckFile.mockReset();
  mockRecheck.mockReset();
  mockReadSaved.mockReset();
  mockReadSaved.mockImplementation(async () => []);
  mockUser = { id: 'user-1', email: 'someone@example.com' };
  mockRole = 'owner';
  mockRoleError = false;
  mockRefetch.mockClear();
  mockParams = { projectId: 'p1', kind: 'pay_app', payId: 'app3' };
});

afterEach(async () => { await cleanupAsync(); });

describe('the gate, as shipped', () => {
  it('the flag is off', () => {
    expect(PROOF_PACK_ENABLED).toBe(false);
  });

  it('1  not the owner: no row, and the route redirects', async () => {
    render(<Wrap><ProofPackEntryRow projectId="p1" kind="pay_app" payId="app3" /></Wrap>);
    expect(screen.queryByTestId('proof-pack-entry')).toBeNull();
    await cleanupAsync();
    render(<Wrap><ProofPackRoute /></Wrap>);
    await settle();
    expect(screen.getByTestId('redirect').props.href).toBe('/(tabs)/(home)');
    expect(screen.queryByTestId('proof-pack-review')).toBeNull();
    expect(mockReadSaved).not.toHaveBeenCalled();
  });

  it('1b signed out: no row, and the route redirects', () => {
    mockUser = null;
    render(<Wrap><ProofPackEntryRow projectId="p1" kind="pay_app" payId="app3" /><ProofPackRoute /></Wrap>);
    expect(screen.queryByTestId('proof-pack-entry')).toBeNull();
    expect(screen.getByTestId('redirect')).toBeTruthy();
  });

  it('2  the owner on a project he owns: one row, and a tap goes to the route', () => {
    mockUser = { id: 'user-1', email: OWNER };
    render(<Wrap><ProofPackEntryRow projectId="p1" kind="invoice" payId="inv2" /></Wrap>);
    expect(screen.getByText('Build Pay Period Record')).toBeTruthy();
    expect(screen.getByText('Owner Preview')).toBeTruthy();
    fireEvent.press(screen.getByTestId('proof-pack-entry'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/proof-pack', params: { projectId: 'p1', kind: 'invoice', payId: 'inv2' } });
  });

  it('3  the owner account on an editor seat: no row, and the route says why', async () => {
    mockUser = { id: 'user-1', email: OWNER };
    mockRole = 'editor';
    render(<Wrap><ProofPackEntryRow projectId="p1" kind="pay_app" payId="app3" /><ProofPackRoute /></Wrap>);
    await settle();
    expect(screen.queryByTestId('proof-pack-entry')).toBeNull();
    expect(screen.getByTestId('proof-pack-seat')).toBeTruthy();
    expect(screen.getByText(/Only the project owner can make a Pay Period Record/)).toBeTruthy();
    expect(screen.queryByTestId('proof-pack-review')).toBeNull();
  });

  it('3b a seat that could not be read says so and offers another try, never "no access"', async () => {
    mockUser = { id: 'user-1', email: OWNER };
    mockRoleError = true;
    render(<Wrap><ProofPackRoute /></Wrap>);
    await settle();
    expect(screen.getByTestId('proof-pack-role-error')).toBeTruthy();
    expect(screen.queryByTestId('proof-pack-seat')).toBeNull();
    expect(screen.queryByTestId('proof-pack-review')).toBeNull();
    fireEvent.press(screen.getByTestId('proof-pack-role-retry'));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('4  no saved pay document: no row', () => {
    mockUser = { id: 'user-1', email: OWNER };
    render(<Wrap><ProofPackEntryRow projectId="p1" kind="pay_app" payId={undefined} /><ProofPackEntryRow projectId={null} kind="invoice" payId="x" /></Wrap>);
    expect(screen.queryByTestId('proof-pack-entry')).toBeNull();
  });

  it('a route with a kind it does not know redirects', () => {
    mockUser = { id: 'user-1', email: OWNER };
    mockParams = { projectId: 'p1', kind: 'estimate', payId: 'x' };
    render(<Wrap><ProofPackRoute /></Wrap>);
    expect(screen.getByTestId('redirect')).toBeTruthy();
  });
});

describe('the review screen', () => {
  const mount = async () => {
    render(<Wrap><ProofPackReview projectId="p1" payRef={{ kind: 'pay_app', id: 'app3' }} onBack={() => {}} /></Wrap>);
    await settle();
  };

  it('5  opens with what this is and is not', async () => {
    await mount();
    expect(screen.getByText(IS)).toBeTruthy();
    expect(screen.getByText(IS_NOT)).toBeTruthy();
    expect(screen.getByTestId('proof-pack-billed').props.children).toBe('$10,800.00');
    expect(screen.getByText('Pay Application 3')).toBeTruthy();
    expect(screen.getByText('Sep 1, 2026 to Sep 30, 2026')).toBeTruthy();
  });

  it('6  every record shows its strength, and the counts are the package’s', async () => {
    await mount();
    for (const key of ['daily_report:d1', 'photo:ph1', 'photo:ph2', 'change_order:co14']) {
      expect(screen.getByTestId(`proof-item-${key}`)).toBeTruthy();
      expect(screen.getByTestId(`proof-switch-${key}`).props.value).toBe(true);
    }
    expect(screen.getByTestId('proof-count-recorded').props.children).toBe(3);
    expect(screen.getByTestId('proof-count-stated').props.children).toBe(1);
    expect(screen.getByTestId('proof-count-sealed').props.children).toBe(0);
    // A photo with coordinates still says only where its stamp came from.
    expect(screen.getByText('Time from the phone’s clock, place from the phone’s GPS.')).toBeTruthy();
    expect(screen.getByText('Time from the phone’s clock, no place recorded.')).toBeTruthy();
    // No worker or company name reaches the screen.
    expect(screen.queryByText(/Private Framing/)).toBeNull();
    expect(screen.getByText(/No worker’s name, phone number, ID or pay rate is in the package/)).toBeTruthy();
    expect(screen.getByText(/Nothing is sent to an AI model/)).toBeTruthy();
  });

  it('7  a switch leaves a record out and says it will be disclosed', async () => {
    await mount();
    expect(screen.getByTestId('proof-pack-left-out').props.children).toMatch(/Everything is included/);
    await act(async () => { fireEvent(screen.getByTestId('proof-switch-photo:ph2'), 'valueChange', false); });
    expect(screen.getByTestId('proof-switch-photo:ph2').props.value).toBe(false);
    expect(screen.getByTestId('proof-pack-left-out').props.children).toBe('You left 1 item out. The package will say 1 item was left out by the contractor.');
    expect(screen.getByTestId('proof-count-recorded').props.children).toBe(2);
    // The record stays on the list, so it can be switched back on.
    expect(screen.getByTestId('proof-item-photo:ph2')).toBeTruthy();
    await act(async () => { fireEvent(screen.getByTestId('proof-switch-photo:ph2'), 'valueChange', true); });
    expect(screen.getByTestId('proof-count-recorded').props.children).toBe(3);
  });

  it('8  nothing is made until the tap; one tap makes one package with the left-out count in it', async () => {
    mockCreate.mockImplementation(async (args: { pack: ProofPack }) => ({
      how: 'shared', keptOnDevice: true,
      saved: { pack: args.pack, lang: 'en', fingerprint: { hash: 'ab'.repeat(32), code: 'ABCDE-FGHJK' }, serverId: 'id1', serverCreatedAt: at('2026-10-02'), pdfHash: null },
    }));
    await mount();
    expect(mockCreate).not.toHaveBeenCalled();
    await act(async () => { fireEvent(screen.getByTestId('proof-switch-change_order:co14'), 'valueChange', false); });
    expect(mockCreate).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(screen.getByTestId('proof-pack-create')); });
    await settle();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const args = mockCreate.mock.calls[0][0] as { pack: ProofPack; lang: string; photoSources: { id: string }[] };
    expect(args.lang).toBe('en');
    expect(args.pack.leftOut.total).toBe(1);
    expect(args.pack.leftOut.byKind.change_order).toBe(1);
    expect(args.pack.items.map((i) => i.key).sort()).toEqual(['daily_report:d1', 'photo:ph1', 'photo:ph2']);
    expect(args.pack.openItems.some((o) => o.code === 'items_left_out' && o.n === 1)).toBe(true);
    expect(args.pack.pay.kind === 'pay_app' && args.pack.pay.currentPaymentDueCents).toBe(1080000);
    expect(typeof args.pack.generatedAt).toBe('string');
    expect(args.pack.generatedAt.length).toBeGreaterThan(10);
    expect(args.photoSources.map((p) => p.id).sort()).toEqual(['ph1', 'ph2']);
    expect(JSON.stringify(args.pack)).not.toMatch(/Private Framing/);
    expect(screen.getByTestId('proof-pack-made')).toBeTruthy();
    expect(screen.getByText('Package made. Its fingerprint is on file. Check code ABCDE-FGHJK.')).toBeTruthy();
  });

  it('8b the document language is the contractor’s choice', async () => {
    mockCreate.mockImplementation(async (args: { pack: ProofPack }) => ({
      how: 'shared', keptOnDevice: true,
      saved: { pack: args.pack, lang: 'es', fingerprint: { hash: 'ab'.repeat(32), code: 'ABCDE-FGHJK' }, serverId: null, serverCreatedAt: null, pdfHash: null },
    }));
    await mount();
    await act(async () => { fireEvent.press(screen.getByTestId('proof-lang-es')); });
    await act(async () => { fireEvent.press(screen.getByTestId('proof-pack-create')); });
    await settle();
    expect((mockCreate.mock.calls[0][0] as { lang: string }).lang).toBe('es');
  });

  it('9  a package whose fingerprint is not on file says so, and a failure says nothing was sent', async () => {
    mockCreate.mockImplementationOnce(async (args: { pack: ProofPack }) => ({
      how: 'shared', keptOnDevice: false,
      saved: { pack: args.pack, lang: 'en', fingerprint: { hash: 'ab'.repeat(32), code: 'ABCDE-FGHJK' }, serverId: null, serverCreatedAt: null, pdfHash: null },
    }));
    await mount();
    await act(async () => { fireEvent.press(screen.getByTestId('proof-pack-create')); });
    await settle();
    expect(screen.getByText(/its fingerprint could not be put on file/)).toBeTruthy();
    expect(screen.getByText(/could not be kept on this device/)).toBeTruthy();
    mockCreate.mockImplementationOnce(async () => { throw new Error('print failed'); });
    await act(async () => { fireEvent.press(screen.getByTestId('proof-pack-create')); });
    await settle();
    expect(screen.getByTestId('proof-pack-failed')).toBeTruthy();
    expect(screen.getByText('The package could not be made. Nothing was sent. Try again.')).toBeTruthy();
  });

  it('10 a pay document that is not on the device says so and offers no button', async () => {
    render(<Wrap><ProofPackReview projectId="p1" payRef={{ kind: 'pay_app', id: 'gone' }} onBack={() => {}} /></Wrap>);
    await settle();
    expect(screen.getByTestId('proof-pack-missing')).toBeTruthy();
    expect(screen.queryByTestId('proof-pack-create')).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('11 a saved package can be checked again', async () => {
    const saved = {
      pack: { project: { id: 'p1' }, pay: { kind: 'pay_app', applicationNumber: 3 } }, lang: 'en',
      fingerprint: { hash: 'cd'.repeat(32), code: 'QRSTV-WXYZ0' }, serverId: 'id1', serverCreatedAt: at('2026-10-02'), pdfHash: null,
    };
    mockReadSaved.mockImplementation(async () => [saved]);
    mockRecheck.mockImplementationOnce(async () => ({ check: 'match', recomputed: saved.fingerprint, onFile: { hash: saved.fingerprint.hash, createdAt: at('2026-10-02'), pdfHash: null } }));
    await mount();
    expect(screen.getByTestId('proof-saved-QRSTV-WXYZ0')).toBeTruthy();
    expect(screen.getByText('cd'.repeat(32))).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('proof-check-QRSTV-WXYZ0')); });
    await settle();
    expect(mockRecheck).toHaveBeenCalledTimes(1);
    expect(screen.getByText('The copy on this device gives the same fingerprint the server has on file.')).toBeTruthy();
    mockRecheck.mockImplementationOnce(async () => ({ check: 'changed', recomputed: saved.fingerprint, onFile: { hash: 'ee'.repeat(32), createdAt: at('2026-10-02'), pdfHash: null } }));
    await act(async () => { fireEvent.press(screen.getByTestId('proof-check-QRSTV-WXYZ0')); });
    await settle();
    expect(screen.getByText(/gives a different fingerprint from the one on file/)).toBeTruthy();
  });
});
