/**
 * Easier Pay Applications, Phase 1 (lane PAYAPP-1). BEHAVIOUR ONLY, no
 * snapshot. The arithmetic and every rule are executed by
 * scripts/validate-pay-app-easy.ts; this proves the screens draw it and that
 * the two promises hold in a mounted tree:
 *   - a suggestion is not in any total until Accept is pressed;
 *   - the Rejection Check always offers Continue Anyway, and Continue saves
 *     the period through addInvoice and addAIAPayApp, once each.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/contexts/ThemeContext';
import type { Invoice, Project, SavedAIAPayApp } from '@/types';

const mockCtx = {
  invoices: [] as Invoice[],
  addInvoice: jest.fn(),
  addAIAPayApp: jest.fn(),
  settings: { taxRate: 0 },
  getChangeOrdersForProject: () => [],
  getDailyReportsForProject: () => [],
};
jest.mock('@/contexts/ProjectContext', () => ({ useProjects: () => mockCtx }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'someone@example.com' } }) }));
jest.mock('@/hooks/useProjectRole', () => ({
  useProjectRoleState: () => ({ role: 'owner', isLoading: false, isError: false, isPaused: false, refetch: () => {} }),
  useProjectRole: () => 'owner',
}));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));

// eslint-disable-next-line import/first
import { BillThisMonth } from '@/components/payApp/BillThisMonth';
// eslint-disable-next-line import/first
import { RejectionCheckSheet } from '@/components/payApp/RejectionCheckSheet';
// eslint-disable-next-line import/first
import { runRejectionCheck } from '@/utils/payApp/rejectionCheck';
// eslint-disable-next-line import/first
import { rollForwardNextApplication } from '@/utils/payApp/rollForward';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
function Wrapper({ children }: { children: React.ReactNode }) {
  return <SafeAreaProvider initialMetrics={METRICS}><ThemeProvider>{children}</ThemeProvider></SafeAreaProvider>;
}

const prior: SavedAIAPayApp = {
  id: 'rec-3', projectId: 'p1', invoiceId: 'inv-3', applicationNumber: 3,
  applicationDate: '2026-09-30', periodTo: '2026-09-30',
  ownerName: 'Harbor Street LLC', contractorName: 'Smith Builders', projectName: 'Harbor Street Renovation',
  originalContractSum: 3000, netChangeByCO: 0, contractSumToDate: 3000,
  retainagePercent: 10, lessPreviousCertificates: 0,
  lines: [
    { id: 'sov_m1', itemNo: '1', description: 'Framing', scheduledValue: 1000, fromPreviousApp: 200, thisPeriod: 400, materialsPresentlyStored: 0, retainagePercent: 10 },
    { id: 'sov_m2', itemNo: '2', description: 'Drywall', scheduledValue: 2000, fromPreviousApp: 0, thisPeriod: 0, materialsPresentlyStored: 0, retainagePercent: 10 },
  ],
  totals: { totalScheduledValue: 3000, totalCompletedAndStored: 600, totalRetainage: 60, totalEarnedLessRetainage: 540, currentPaymentDue: 540, balanceToFinish: 2460, percentComplete: 20 },
  savedAt: '2026-09-30T12:00:00.000Z',
};
const project = {
  id: 'p1', name: 'Harbor Street Renovation', ownerUserId: 'u1',
  schedule: { tasks: [{ id: 't1', title: 'Framing', phase: '', durationDays: 5, startDay: 0, progress: 85, crew: '', dependencies: [], linkedEstimateItems: ['m1'] }] },
} as unknown as Project;

describe('Bill This Month', () => {
  beforeEach(() => { mockCtx.addInvoice = jest.fn(); mockCtx.addAIAPayApp = jest.fn(); mockCtx.invoices = []; });

  it('rolls the last application forward, suggests with a source, and counts nothing until Accept', () => {
    const onSaved = jest.fn();
    render(<BillThisMonth project={project} saved={[prior]} contract={null} onClose={() => {}} onSaved={onSaved} />, { wrapper: Wrapper });

    expect(screen.getByTestId('bill-this-month')).toBeTruthy();
    expect(screen.getByTestId('btm-period-line').props.children).toBe('Pay Application 4, Oct 1 to Oct 31');
    expect(screen.getByText('Carried Forward from Application 3')).toBeTruthy();
    // The linked line: a suggestion with where it came from. 85% of $1,000 less $600 billed.
    expect(screen.getByText('Schedule: Framing is marked 85%.')).toBeTruthy();
    expect(screen.getByText('85%  $250.00')).toBeTruthy();
    // The line with no linked task: no suggestion, and why. Not the project average.
    expect(screen.getByText('No suggestion. No schedule task is linked to this line.')).toBeTruthy();
    // Nothing is in the total yet, and the footer says so.
    expect(screen.getByTestId('btm-work-total').props.children).toBe('$0.00');
    expect(screen.getByTestId('btm-amount-sov_m1').props.children).toBe('$0.00');
    expect(screen.getByTestId('btm-not-accepted').props.children).toBe('1 suggestion is not accepted and not in the total.');

    fireEvent.press(screen.getByTestId('btm-suggest-sov_m1-accept'));
    expect(screen.getByTestId('btm-work-total').props.children).toBe('$250.00');
    expect(screen.getByTestId('btm-payment-due').props.children).toBe('$225.00');
    expect(screen.queryByTestId('btm-not-accepted')).toBeNull();
    expect(screen.getByTestId('btm-suggest-sov_m1-accepted')).toBeTruthy();

    // The check never blocks: Continue Anyway saves the period as a draft.
    fireEvent.press(screen.getByTestId('btm-next'));
    expect(screen.getByText('Things a Reviewer May Question')).toBeTruthy();
    expect(screen.getByTestId('btm-check-lead')).toBeTruthy();
    expect(screen.getByTestId('btm-check-not-checked')).toBeTruthy();
    expect(mockCtx.addInvoice).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('btm-check-continue'));
    expect(mockCtx.addInvoice).toHaveBeenCalledTimes(1);
    expect(mockCtx.addAIAPayApp).toHaveBeenCalledTimes(1);
    const invoice = mockCtx.addInvoice.mock.calls[0][0] as Invoice;
    const record = mockCtx.addAIAPayApp.mock.calls[0][0] as SavedAIAPayApp;
    expect(invoice.type).toBe('progress');
    expect(invoice.status).toBe('draft');
    expect(invoice.subtotal).toBe(250);
    expect(invoice.lineItems).toHaveLength(1);
    expect(record.invoiceId).toBe(invoice.id);
    expect(record.applicationNumber).toBe(4);
    expect(record.totals.currentPaymentDue).toBe(225);
    expect(record.payLinkUrl).toBeUndefined();
    expect(record.sentLockedAt).toBeUndefined();
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: invoice.id }));
  });

  it('says so when there is no earlier application to start from', () => {
    render(<BillThisMonth project={project} saved={[]} contract={null} onClose={() => {}} onSaved={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByTestId('btm-none')).toBeTruthy();
    expect(screen.getByText('No Earlier Application On This Project')).toBeTruthy();
  });
});

describe('Rejection Check sheet', () => {
  it('draws the lead, a finding, Nothing flagged rows and the Not Checked block, with Continue Anyway enabled', () => {
    const roll = rollForwardNextApplication({ project, saved: [prior], changeOrders: [], contract: null, today: '2026-10-09' })!;
    const app = { ...roll.app, lines: roll.app.lines.map(l => (l.id === 'sov_m1' ? { ...l, thisPeriod: 900 } : l)) };
    const result = runRejectionCheck({ app, prior, saved: [prior], changeOrders: [] });
    const onContinue = jest.fn();
    render(<RejectionCheckSheet visible result={result} onClose={() => {}} onGoToLine={() => {}} onContinue={onContinue} />, { wrapper: Wrapper });

    expect(screen.getByText('Sums and comparisons run on your own numbers. They do not say this application is correct or that it will be accepted.')).toBeTruthy();
    expect(screen.getByText('Line 1, Framing, is billed past its scheduled value')).toBeTruthy();
    expect(screen.getByText('Billed to date $1,500.00 against $1,000.00. Over by $500.00.')).toBeTruthy();
    expect(screen.getAllByText('Nothing flagged').length).toBeGreaterThan(5);
    expect(screen.getByText('Not checked by MAGE ID:')).toBeTruthy();
    expect(screen.getByText('Fix Line 1')).toBeTruthy();
    fireEvent.press(screen.getByTestId('rejection-check-continue'));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/compliant|verified|passed|ready to submit/i)).toBeNull();
  });
});
