/**
 * Smoke — the Pay Period Record (lane PROOFPACK): the entry row
 * (components/proofPack/ProofPackEntryRow), the route (app/proof-pack) and the
 * review screen (components/proofPack/ProofPackReview).
 *
 * Fixtures only, no network: the project context is a fixture, the share step
 * (utils/proofPack/share createAndShareProofPack), the saved-document store and
 * the five server facts (utils/proofPack/store readProofServerFacts) are
 * jest.fn. The pure rules (strength classes, period, linking, fingerprint,
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
 *  11  a saved document can be checked again and the answer is shown
 *  12  LABELS COME FROM THE SERVER: a stamped, equal pay application is Locked;
 *      a pay link with no stamp, a stamp with other figures and an unread server
 *      are Recorded; an approval the contractor's account wrote is Recorded
 *  13  the facts are read AGAIN inside the tap, and the document is built from
 *      that read
 *  14  what was left out is counted under each label
 *  15  photo coordinates are out unless switched on
 *  16  the Notice to Recipients and the exact privacy wording are on the screen
 */
import React from 'react';
import { act, cleanupAsync, fireEvent, render, screen, within } from '@testing-library/react-native';

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
/** The aia_pay_apps row the server holds for mockPayApp: the same figures, stamped or not. */
const mockServerRow = (lockedAt: string | null, over: Record<string, unknown> = {}) => ({
  id: 'app3', lockedAt, applicationNumber: 3, periodTo: '2026-09-30', periodFrom: '2026-09-01',
  originalContractSum: 180000, netChangeByCO: 0, contractSumToDate: 180000, lessPreviousCertificates: 0,
  totals: { totalCompletedAndStored: 12000, totalRetainage: 1200, totalEarnedLessRetainage: 10800, currentPaymentDue: 10800, balanceToFinish: 169200 },
  lines: [{ id: 'l1', itemNo: '1.0', description: 'Framing', scheduledValue: 40000, thisPeriod: 12000, materialsPresentlyStored: 0 }],
  ...over,
});
const mockNoFacts = () => ({ payAppServer: mockServerRow(null), coSignatures: [], punchSeal: null, waiverSignedVia: {}, fieldTicketServer: {} });
const mockReadFacts = jest.fn(async (_projectId: string, _payRef: unknown): Promise<Record<string, unknown>> => mockNoFacts());
jest.mock('@/utils/proofPack/store', () => ({
  readSavedProofPacks: (id: string) => mockReadSaved(id),
  readProofServerFacts: (id: string, payRef: unknown) => mockReadFacts(id, payRef),
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
const NOTICE = 'This record was prepared by the contractor named above using MAGE ID. MAGE ID did not inspect the work and makes no statement to the reader about the work, the amounts or the people named. Do not rely on this record as an inspection, an appraisal or a certification.';
/** What the real share step does first: build the record from the function the screen hands it. */
type ShareArgs = { pack: ProofPack | (() => Promise<ProofPack>); lang: string; photoSources: { id: string }[] };
const built: ProofPack[] = [];
const shareResult = (over: Record<string, unknown> = {}, keptOnDevice = true) => async (args: ShareArgs) => {
  const pack = typeof args.pack === 'function' ? await args.pack() : args.pack;
  built.push(pack);
  return { how: 'shared', keptOnDevice, saved: { pack, lang: args.lang, fingerprint: { hash: 'ab'.repeat(32), code: 'ABCDE-FGHJK' }, serverId: 'id1', serverCreatedAt: at('2026-10-02'), pdfHash: null, ...over } };
};

beforeEach(() => {
  mockPush.mockClear();
  mockCreate.mockReset();
  mockCheckFile.mockReset();
  mockRecheck.mockReset();
  mockReadSaved.mockReset();
  mockReadSaved.mockImplementation(async () => []);
  mockReadFacts.mockReset();
  mockReadFacts.mockImplementation(async () => mockNoFacts());
  built.length = 0;
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
    expect(mockReadFacts).not.toHaveBeenCalled();
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
    expect(screen.getByText(/No worker’s name, phone number, ID or pay rate is taken from a worker field/)).toBeTruthy();
    expect(screen.getByText(/Nothing is sent to an AI model/)).toBeTruthy();
  });

  it('7  a switch leaves a record out and says it will be disclosed', async () => {
    await mount();
    expect(screen.getByTestId('proof-pack-left-out').props.children).toMatch(/Everything is included/);
    await act(async () => { fireEvent(screen.getByTestId('proof-switch-photo:ph2'), 'valueChange', false); });
    expect(screen.getByTestId('proof-switch-photo:ph2').props.value).toBe(false);
    expect(screen.getByTestId('proof-pack-left-out').props.children).toBe('You left 1 item out. The document will say 1 item was left out by the contractor, under its label and by kind.');
    expect(screen.getByTestId('proof-count-recorded').props.children).toBe(2);
    // The record stays on the list, so it can be switched back on.
    expect(screen.getByTestId('proof-item-photo:ph2')).toBeTruthy();
    await act(async () => { fireEvent(screen.getByTestId('proof-switch-photo:ph2'), 'valueChange', true); });
    expect(screen.getByTestId('proof-count-recorded').props.children).toBe(3);
  });

  it('8  nothing is made until the tap; one tap makes one package with the left-out count in it', async () => {
    mockCreate.mockImplementation(shareResult());
    await mount();
    expect(mockCreate).not.toHaveBeenCalled();
    await act(async () => { fireEvent(screen.getByTestId('proof-switch-change_order:co14'), 'valueChange', false); });
    expect(mockCreate).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(screen.getByTestId('proof-pack-create')); });
    await settle();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const args = mockCreate.mock.calls[0][0] as ShareArgs;
    expect(args.lang).toBe('en');
    expect(built).toHaveLength(1);
    const pack = built[0];
    expect(pack.leftOut.total).toBe(1);
    expect(pack.leftOut.byKind.change_order).toBe(1);
    expect(pack.leftOut.byStrength.stated).toBe(1);
    expect(pack.items.map((i) => i.key).sort()).toEqual(['daily_report:d1', 'photo:ph1', 'photo:ph2']);
    expect(pack.openItems.some((o) => o.code === 'items_left_out' && o.n === 1)).toBe(true);
    expect(pack.pay.kind === 'pay_app' && pack.pay.currentPaymentDueCents).toBe(1080000);
    expect(pack.company.name).toBe('Example Builders');
    expect(typeof pack.generatedAt).toBe('string');
    expect(pack.generatedAt.length).toBeGreaterThan(10);
    expect(args.photoSources.map((p) => p.id).sort()).toEqual(['ph1', 'ph2']);
    expect(JSON.stringify(pack)).not.toMatch(/Private Framing/);
    expect(screen.getByTestId('proof-pack-made')).toBeTruthy();
    expect(screen.getByText('Document made. Its fingerprint is on file. Check code ABCDE-FGHJK.')).toBeTruthy();
  });

  it('8b the document language is the contractor’s choice', async () => {
    mockCreate.mockImplementation(shareResult({ serverId: null, serverCreatedAt: null }));
    await mount();
    await act(async () => { fireEvent.press(screen.getByTestId('proof-lang-es')); });
    await act(async () => { fireEvent.press(screen.getByTestId('proof-pack-create')); });
    await settle();
    expect((mockCreate.mock.calls[0][0] as { lang: string }).lang).toBe('es');
  });

  it('9  a package whose fingerprint is not on file says so, and a failure says nothing was sent', async () => {
    mockCreate.mockImplementationOnce(shareResult({ serverId: null, serverCreatedAt: null }, false));
    await mount();
    await act(async () => { fireEvent.press(screen.getByTestId('proof-pack-create')); });
    await settle();
    expect(screen.getByText(/its fingerprint could not be put on file/)).toBeTruthy();
    expect(screen.getByText(/could not be kept on this device/)).toBeTruthy();
    mockCreate.mockImplementationOnce(async () => { throw new Error('print failed'); });
    await act(async () => { fireEvent.press(screen.getByTestId('proof-pack-create')); });
    await settle();
    expect(screen.getByTestId('proof-pack-failed')).toBeTruthy();
    expect(screen.getByText('The document could not be made. Try again.')).toBeTruthy();
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
    // The screen says what a match does and does not show.
    expect(screen.getByText('The check code is a short name for the fingerprint. Compare the full fingerprint.')).toBeTruthy();
    expect(screen.getByText(/It does not show that the records in it are true or that they match MAGE ID’s database\./)).toBeTruthy();
  });

  const payChip = (label: string) => within(screen.getByTestId('proof-pack-pay')).queryByTestId(`proof-chip-${label}`);
  const STAMP = at('2026-09-30', '18:00');

  it('12 the pay application is Locked only when the server holds the stamp and equal figures', async () => {
    await mount();
    expect(payChip('recorded')).toBeTruthy();
    expect(payChip('locked')).toBeNull();
    await cleanupAsync();
    mockReadFacts.mockImplementation(async () => ({ ...mockNoFacts(), payAppServer: mockServerRow(STAMP) }));
    await mount();
    expect(payChip('locked')).toBeTruthy();
    await cleanupAsync();
    // A stamp on the server, and a total on this device that is one cent off.
    mockReadFacts.mockImplementation(async () => ({ ...mockNoFacts(), payAppServer: mockServerRow(STAMP, { totals: { ...mockServerRow(null).totals, currentPaymentDue: 10800.01 } }) }));
    await mount();
    expect(payChip('locked')).toBeNull();
    expect(payChip('recorded')).toBeTruthy();
    await cleanupAsync();
    // The server could not be read: nothing is assumed, and the screen says so.
    mockReadFacts.mockImplementation(async () => ({ payAppServer: undefined, coSignatures: undefined, punchSeal: undefined, waiverSignedVia: undefined, fieldTicketServer: undefined }));
    await mount();
    expect(payChip('locked')).toBeNull();
    expect(screen.getByTestId('proof-pack-server-unread')).toBeTruthy();
    expect(screen.getByText(/A record that needs a server check is listed as Recorded/)).toBeTruthy();
  });

  it('12b an approval the contractor’s account wrote is Recorded; the portal function’s is Signed', async () => {
    const row = (recordedVia: string | null) => ({
      changeOrderId: 'co14', decision: 'approved', signerName: 'Dana Client', serverCreatedAt: at('2026-09-05', '12:05'), documentHash: 'fe'.repeat(32), hasSignature: true,
      recordedVia, signedTerms: { changeOrderNumber: 14, scope: 'Door swap', amountCents: 30000 },
    });
    const chip = (label: string) => within(screen.getByTestId('proof-item-change_order:co14')).queryByTestId(`proof-chip-${label}`);
    for (const via of ['contractor_account', null]) {
      mockReadFacts.mockImplementation(async () => ({ ...mockNoFacts(), coSignatures: [row(via)] }));
      await mount();
      expect(chip('recorded')).toBeTruthy();
      expect(chip('signed')).toBeNull();
      expect(screen.getByTestId('proof-count-signed').props.children).toBe(0);
      await cleanupAsync();
    }
    mockReadFacts.mockImplementation(async () => ({ ...mockNoFacts(), coSignatures: [row('portal_function')] }));
    await mount();
    expect(chip('signed')).toBeTruthy();
    expect(screen.getByTestId('proof-count-signed').props.children).toBe(1);
  });

  it('13 the server is read again inside the tap, and the document is built from that read', async () => {
    mockCreate.mockImplementation(shareResult());
    mockReadFacts.mockImplementationOnce(async () => ({ ...mockNoFacts(), payAppServer: mockServerRow(STAMP) }));
    await mount();
    expect(mockReadFacts).toHaveBeenCalledTimes(1);
    expect(mockReadFacts).toHaveBeenLastCalledWith('p1', { kind: 'pay_app', id: 'app3' });
    expect(payChip('locked')).toBeTruthy();
    // Between the screen opening and the tap, the lock is gone from the server.
    await act(async () => { fireEvent.press(screen.getByTestId('proof-pack-create')); });
    await settle();
    expect(mockReadFacts).toHaveBeenCalledTimes(2);
    expect(built).toHaveLength(1);
    expect(built[0].pay.strength).toBe('recorded');
    expect(built[0].pay.kind === 'pay_app' && built[0].pay.lockedAt).toBeNull();
    expect(payChip('locked')).toBeNull();
  });

  it('13b Create and Share waits for the first read of the server', async () => {
    let release: (v: Record<string, unknown>) => void = () => {};
    mockReadFacts.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    await mount();
    expect(screen.getByTestId('proof-pack-checking')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('proof-pack-create')); });
    await settle();
    expect(mockCreate).not.toHaveBeenCalled();
    await act(async () => { release(mockNoFacts()); });
    await settle();
    expect(screen.queryByTestId('proof-pack-checking')).toBeNull();
  });

  it('14 what was left out is counted under each label', async () => {
    await mount();
    for (const s of ['sealed', 'signed', 'locked', 'recorded', 'stated']) expect(screen.getByTestId(`proof-left-out-${s}`).props.children).toBe('0 Left Out');
    await act(async () => { fireEvent(screen.getByTestId('proof-switch-photo:ph2'), 'valueChange', false); });
    await act(async () => { fireEvent(screen.getByTestId('proof-switch-change_order:co14'), 'valueChange', false); });
    expect(screen.getByTestId('proof-left-out-recorded').props.children).toBe('1 Left Out');
    expect(screen.getByTestId('proof-left-out-stated').props.children).toBe('1 Left Out');
    expect(screen.getByTestId('proof-left-out-sealed').props.children).toBe('0 Left Out');
    expect(screen.getByTestId('proof-count-stated').props.children).toBe(0);
  });

  it('15 photo coordinates are out unless switched on', async () => {
    mockCreate.mockImplementation(shareResult());
    await mount();
    expect(screen.getByTestId('proof-pack-coords').props.value).toBe(false);
    await act(async () => { fireEvent.press(screen.getByTestId('proof-pack-create')); });
    await settle();
    expect(built[0].photoCoordinates).toBe('left_out');
    expect(JSON.stringify(built[0])).not.toMatch(/39\.29|76\.61/);
    expect(built[0].openItems.some((o) => o.code === 'photo_coordinates_left_out')).toBe(true);
    await act(async () => { fireEvent(screen.getByTestId('proof-pack-coords'), 'valueChange', true); });
    await act(async () => { fireEvent.press(screen.getByTestId('proof-pack-create')); });
    await settle();
    expect(built[1].photoCoordinates).toBe('printed');
    expect(JSON.stringify(built[1])).toMatch(/39\.29/);
  });

  it('16 the notice and the exact privacy wording are on the screen', async () => {
    await mount();
    expect(screen.getByText('Notice to Recipients')).toBeTruthy();
    expect(screen.getByText(NOTICE)).toBeTruthy();
    expect(screen.getByTestId('proof-pack-server-gets').props.children).toMatch(/the first letter of the project name, the city, how many records are listed and how many were left out, and the fingerprint/);
    expect(screen.getByTestId('proof-pack-free-text').props.children).toMatch(/they may name people\. Read them before you share\.$/);
    expect(screen.getByText(/A lien waiver names the subcontractor or supplier that gave it\./)).toBeTruthy();
    expect(screen.getAllByText('Pay Period Record').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Proof of Work|[Pp]ackage/)).toBeNull();
  });
});
