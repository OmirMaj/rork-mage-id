/**
 * Wave 4 lane W2 — backcharges and the cost of owner delay. BEHAVIOUR ONLY,
 * no snapshot.
 *
 *  1. Two open backcharges seeded under mageid_backcharges for the fixture
 *     sub → the section lists both; the deduction card on a submitted invoice
 *     shows deduct/pay in dollars that match planDeduction; "Apply to this
 *     bill" marks them applied (in the section and on disk).
 *  2. /waiting-on with a submitted CO anchored to a task whose start has
 *     passed → the 'ownerdelay-' consequence; with no General Conditions line
 *     it says "No daily site cost on file" and carries no '$'.
 *
 * The math is executed by scripts/validate-backcharges.ts and
 * scripts/validate-owner-delay-cost.ts; this proves the screens render it.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/contexts/ThemeContext';
import type { ChangeOrder, Project, Subcontractor, SubSubmittedInvoice } from '@/types';
import { BACKCHARGES_KEY, planDeduction, parseBackcharges, formatCents, type Backcharge } from '@/utils/backcharges';

// ── Real-clock fixture for the owner-delay half ────────────────────────────
const DAY = 86_400_000;
const localDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const NOW = Date.now();
const mockDelayProject = {
  id: 'p1', name: 'Oak St', status: 'in_progress',
  schedule: {
    id: 's', name: 'S', projectId: 'p1', startDate: localDay(NOW - 30 * DAY), workingDaysPerWeek: 5, bufferDays: 0,
    totalDurationDays: 0, criticalPathDays: 0, laborAlignmentScore: 0, riskItems: [],
    tasks: [{ id: 't1', title: 'Kitchen framing', phase: '', durationDays: 5, startDay: 1, progress: 0, crew: '', dependencies: [], notes: '', status: 'not_started' }],
  },
} as unknown as Project;
const mockCO = {
  id: 'co1', projectId: 'p1', number: 4, description: 'Move the kitchen wall', status: 'submitted',
  date: localDay(NOW - 10 * DAY), scheduleAnchorTaskId: 't1',
} as unknown as ChangeOrder;

jest.mock('@/contexts/ProjectContext', () => ({
  useProjects: () => ({
    settings: { branding: { companyName: 'Majeed GC' } },
    getPhotosForProject: () => [],
    getPunchItemsForProject: () => [],
    addProjectPhoto: () => {},
  }),
  useCoreData: () => ({ projects: [mockDelayProject], projectsLoaded: true, sourceFailed: false }),
  useDocsData: () => ({ rfis: [], submittals: [] }),
  useFieldData: () => ({ dailyReports: [] }),
  useFinancialsData: () => ({ changeOrders: [mockCO], deliveries: [], commitments: [] }),
  usePreconData: () => ({ subcontractors: [] }),
}));
jest.mock('@/hooks/useLaborRates', () => ({ useLaborRates: () => ({ rates: {} }) }));
jest.mock('@/hooks/useOpenProposals', () => ({ useOpenProposals: () => ({ status: 'ok', rows: [] }) }));
jest.mock('@/hooks/useEntityNavigation', () => ({ useEntityNavigation: () => ({ navigateTo: () => {} }) }));
jest.mock('@/utils/selectionsEngine', () => ({ loadSelectionsChecked: async () => ({ ok: true, value: [] }) }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: () => {}, back: () => {}, replace: () => {} }),
  useFocusEffect: () => {},
  Stack: { Screen: () => null },
}));

// eslint-disable-next-line import/first
import { BackchargeSection } from '@/components/backcharge/BackchargeSection';
// eslint-disable-next-line import/first
import { BackchargeDeductionCard } from '@/components/backcharge/BackchargeDeductionCard';
// eslint-disable-next-line import/first
import WaitingOnScreen from '@/app/waiting-on';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
function Wrapper({ children }: { children: React.ReactNode }) {
  return <SafeAreaProvider initialMetrics={METRICS}><ThemeProvider>{children}</ThemeProvider></SafeAreaProvider>;
}

const project = { id: 'p1', name: 'Oak St' } as unknown as Project;
const sub = { id: 'sub1', companyName: 'Acme Drywall', contactName: 'Joe Acme' } as unknown as Subcontractor;
const bc = (o: Partial<Backcharge> & { id: string; amountCents: number; createdAt: string }): Backcharge => ({
  projectId: 'p1', subId: 'sub1', subName: 'Acme Drywall', commitmentId: null, reason: `Reason ${o.id}`,
  basis: 'typed', hours: null, rateCents: null, photoUri: null, photoId: null, punchItemId: null,
  status: 'open', appliedInvoiceId: null, appliedAt: null, ...o,
});
const SEEDED = [
  bc({ id: 'b1', amountCents: 45000, createdAt: '2026-09-01T10:00:00Z', reason: 'Dumpster for their debris' }),
  bc({ id: 'b2', amountCents: 125050, createdAt: '2026-09-05T10:00:00Z', reason: 'Patch the damaged stair' }),
];
const invoice = {
  id: 'inv7', subPortalId: 'sp1', invoiceNumber: '7', amount: 1500, status: 'submitted', createdAt: '2026-09-20T12:00:00Z',
} as unknown as SubSubmittedInvoice;

describe('backcharges', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem(BACKCHARGES_KEY, JSON.stringify(SEEDED));
  });

  it('lists the open items, deducts what fits whole, and Apply marks them applied', async () => {
    render(
      <>
        <BackchargeSection project={project} sub={sub} commitments={[]} invoices={[invoice]} />
        <BackchargeDeductionCard invoice={invoice} project={project} sub={sub} />
      </>,
      { wrapper: Wrapper },
    );
    expect(screen.getByTestId('backcharge-section')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('backcharge-row-b1')).toBeTruthy());
    expect(screen.getByTestId('backcharge-row-b2')).toBeTruthy();
    expect(screen.getByText('Dumpster for their debris')).toBeTruthy();
    expect(screen.getAllByText(/Saved on this device until you sign out/).length).toBe(2); // section + card

    // $1,500 bill: the $450 one fits, the $1,250.50 one would exceed → carries.
    const plan = planDeduction(150000, SEEDED);
    expect(plan.deductCents).toBe(45000);
    expect(plan.payCents).toBe(105000);
    const line = screen.getByTestId('backcharge-deduct-line-inv7');
    const text = [line.props.children].flat(3).join('');
    expect(text).toBe(`Backcharges open: ${formatCents(170050)} · Deduct ${formatCents(plan.deductCents)} on this bill → pay ${formatCents(plan.payCents)}`);
    expect(text).toBe('Backcharges open: $1,700.50 · Deduct $450 on this bill → pay $1,050');
    expect(screen.getByText(/\$1,250\.50 carries to the next bill/)).toBeTruthy();
    expect(screen.getByText(/MAGE never moves the money/)).toBeTruthy();

    await act(async () => { fireEvent.press(screen.getByTestId('backcharge-apply-inv7')); });
    await waitFor(() => expect(screen.getByTestId('backcharge-applied-b1')).toBeTruthy());
    expect(screen.queryByTestId('backcharge-row-b1')).toBeNull();
    expect(screen.getByTestId('backcharge-row-b2')).toBeTruthy();
    expect(screen.getByText(/Taken off invoice #7/)).toBeTruthy();
    // The card now shows only the recorded deduction: no second Apply on inv7.
    await waitFor(() => {
      const after = [screen.getByTestId('backcharge-deduct-line-inv7').props.children].flat(3).join('');
      expect(after).toBe('Deducted $450 on this bill → pay $1,050');
    });
    expect(screen.queryByTestId('backcharge-apply-inv7')).toBeNull();
    expect(screen.getByText(/\$1,250\.50 carries to the next bill/)).toBeTruthy();
    expect(screen.getByTestId('backcharge-note-inv7')).toBeTruthy();
    await waitFor(async () => {
      const onDisk = parseBackcharges(await AsyncStorage.getItem(BACKCHARGES_KEY));
      const b1 = onDisk.find(b => b.id === 'b1');
      expect(b1?.status).toBe('applied');
      expect(b1?.appliedInvoiceId).toBe('inv7');
      expect(onDisk.find(b => b.id === 'b2')?.status).toBe('open');
    });
  });

  it('the deduction card renders nothing when the sub has no open backcharge', async () => {
    await AsyncStorage.setItem(BACKCHARGES_KEY, '[]');
    render(<BackchargeDeductionCard invoice={invoice} project={project} sub={sub} />, { wrapper: Wrapper });
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('backcharge-deduct-inv7')).toBeNull();
  });
});

describe('cost of owner delay on /waiting-on', () => {
  it('names what the late CO holds up, and says there is no site cost on file (no $)', async () => {
    await AsyncStorage.clear();
    render(<WaitingOnScreen />, { wrapper: Wrapper });
    const node = await screen.findByTestId('ownerdelay-co1');
    const text = [node.props.children].flat(3).map((c: unknown) => {
      const el = c as { props?: { children?: unknown } };
      return el?.props ? [el.props.children].flat(3).join('') : String(c ?? '');
    }).join('');
    expect(text).toMatch(/^Kitchen framing is on the critical path: finish moves \d+ working days? · No daily site cost on file — add a General Conditions line to see dollars\.$/);
    expect(text).not.toContain('$');
  });
});
