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
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
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
// His cash-flow setup has no payment terms: nothing is confirmed.
jest.mock('@/utils/cashFlowStorage', () => ({ loadCashFlowSettings: jest.fn(async () => ({ source: 'default' })) }));

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

  it('rolls the last application forward, suggests with a source, and counts nothing until Accept', async () => {
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
    // The footer adds up: completed to date less retainage less earlier certificates is the payment due.
    expect(screen.getByTestId('btm-completed-to-date').props.children).toBe('$850.00');
    expect(screen.getByTestId('btm-retainage-to-date').props.children).toBe('-$85.00');
    expect(screen.getByTestId('btm-less-retainage').props.children).toBe('$765.00');
    expect(screen.getByTestId('btm-less-previous').props.children).toBe('-$540.00');
    // The draft invoice is named before he saves, with its total, and the terms are not stamped silently.
    const invoiceLine = JSON.stringify(screen.getByTestId('btm-invoice-line').props.children);
    expect(invoiceLine).toContain('Saving makes a draft invoice for this period: $250.00. No tax is set.');
    await waitFor(() => expect(JSON.stringify(screen.getByTestId('btm-invoice-line').props.children)).toContain('No payment terms are set yet'));

    // The check never blocks: Continue Anyway saves the period as a draft.
    fireEvent.press(screen.getByTestId('btm-next'));
    expect(screen.getByText('Things a Reviewer May Question')).toBeTruthy();
    expect(screen.getByTestId('btm-check-lead')).toBeTruthy();
    expect(screen.getByTestId('btm-check-not-checked')).toBeTruthy();
    expect(mockCtx.addInvoice).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('btm-check-continue'));
    await waitFor(() => expect(mockCtx.addInvoice).toHaveBeenCalledTimes(1));
    expect(mockCtx.addAIAPayApp).toHaveBeenCalledTimes(1);
    const invoice = mockCtx.addInvoice.mock.calls[0][0] as Invoice;
    const record = mockCtx.addAIAPayApp.mock.calls[0][0] as SavedAIAPayApp;
    expect(invoice.type).toBe('progress');
    expect(invoice.status).toBe('draft');
    expect(invoice.subtotal).toBe(250);
    // The invoice holds what the pay application holds for the period, and no due date nobody confirmed.
    expect(invoice.retentionAmount).toBe(25);
    expect(invoice.dueDate).toBe('');
    expect(invoice.lineItems).toHaveLength(1);
    expect(record.invoiceId).toBe(invoice.id);
    expect(record.applicationNumber).toBe(4);
    expect(record.totals.currentPaymentDue).toBe(225);
    expect(record.payLinkUrl).toBeUndefined();
    expect(record.sentLockedAt).toBeUndefined();
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: invoice.id }));
  });

  it('enters a typed percent as it is typed, and says why a value is refused', () => {
    render(<BillThisMonth project={project} saved={[prior]} contract={null} onClose={() => {}} onSaved={() => {}} />, { wrapper: Wrapper });
    const field = screen.getByTestId('btm-pct-sov_m1');
    fireEvent(field, 'focus');
    // No blur: the figure is on the line the moment it is typed.
    fireEvent.changeText(field, '90');
    expect(screen.getByTestId('btm-amount-sov_m1').props.children).toBe('$300.00');
    expect(screen.getByTestId('btm-work-total').props.children).toBe('$300.00');
    fireEvent(field, 'blur');
    // Over 100: refused with the reason, and the line goes back to what it held before this visit to the field.
    fireEvent(field, 'focus');
    fireEvent.changeText(field, '15');
    fireEvent.changeText(field, '150');
    expect(screen.getByTestId('btm-pct-refused-sov_m1').props.children).toBe('150 is over 100, so it was not entered. The line is back to where it was.');
    expect(screen.getByTestId('btm-amount-sov_m1').props.children).toBe('$300.00');
  });

  it('says when the application it starts from has no record of being sent', () => {
    const onClose = jest.fn();
    render(<BillThisMonth project={project} saved={[prior]} contract={null} onClose={onClose} onSaved={() => {}} />, { wrapper: Wrapper });
    fireEvent.press(screen.getByTestId('btm-suggest-sov_m1-accept'));
    expect(screen.getByTestId('btm-prior-not-sent')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('says it cannot start here when there is no earlier application and the job has no linked estimate', () => {
    render(<BillThisMonth project={project} saved={[]} contract={null} onClose={() => {}} onSaved={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByTestId('btm-none')).toBeTruthy();
    expect(screen.getByText('Cannot Start Here')).toBeTruthy();
  });
});

describe('Bill This Month, the first application on a job (Phase 1b)', () => {
  const item = (id: string, name: string, lineTotal: number) => ({ materialId: id, name, category: 'general', unit: 'LS', quantity: 1, unitPrice: lineTotal, markup: 0, lineTotal, bulkPrice: lineTotal, usesBulk: false, supplier: '' });
  const fresh = {
    id: 'p9', name: 'Alder Street Kitchen', ownerUserId: 'u1', retainagePercent: 10,
    linkedEstimate: { id: 'e9', items: [item('demo', 'Demolition', 4000), item('frame', 'Framing', 6000)], grandTotal: 10000 },
  } as unknown as Project;
  const withBranding = { taxRate: 0, branding: { companyName: 'Example Builders' } };

  beforeEach(() => { mockCtx.addInvoice = jest.fn(); mockCtx.addAIAPayApp = jest.fn(); mockCtx.invoices = []; (mockCtx as { settings: unknown }).settings = withBranding; });
  afterEach(() => { (mockCtx as { settings: unknown }).settings = { taxRate: 0 }; });

  it('starts from the linked estimate with this period at zero, says where the retainage rate came from, and saves application 1 once', async () => {
    const onSaved = jest.fn();
    render(<BillThisMonth project={fresh} saved={[]} contract={null} onClose={() => {}} onSaved={onSaved} />, { wrapper: Wrapper });

    expect(screen.getByTestId('btm-first')).toBeTruthy();
    expect(screen.getByText('2 Lines from the Linked Estimate')).toBeTruthy();
    expect(screen.getByTestId('btm-retainage-record').props.children).toBe('Retainage opens at 10%, from your contract.');
    // Nothing is billed by starting.
    expect(screen.getByTestId('btm-work-total').props.children).toBe('$0.00');
    expect(screen.getByTestId('btm-payment-due').props.children).toBe('$0.00');
    expect(screen.getByTestId('btm-less-previous').props.children).toBe('$0.00');

    // He types 50 percent on the first line: $2,000 of work, $200 held, $1,800 due.
    fireEvent.changeText(screen.getByTestId('btm-pct-sov_demo'), '50');
    expect(screen.getByTestId('btm-work-total').props.children).toBe('$2,000.00');
    expect(screen.getByTestId('btm-payment-due').props.children).toBe('$1,800.00');

    fireEvent.press(screen.getByTestId('btm-next'));
    fireEvent.press(await screen.findByText('Continue Anyway'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mockCtx.addInvoice).toHaveBeenCalledTimes(1);
    expect(mockCtx.addAIAPayApp).toHaveBeenCalledTimes(1);
    const savedApp = mockCtx.addAIAPayApp.mock.calls[0][0];
    const savedInvoice = mockCtx.addInvoice.mock.calls[0][0];
    expect(savedApp.applicationNumber).toBe(1);
    expect(savedApp.invoiceId).toBe(savedInvoice.id);
    expect(savedInvoice.subtotal).toBe(2000);
    expect(savedInvoice.lineItems).toHaveLength(1);
  });

  it('does not start at zero on a job that already has an invoice', () => {
    mockCtx.invoices = [{ id: 'inv-old', projectId: 'p9', number: 1 } as unknown as Invoice];
    render(<BillThisMonth project={fresh} saved={[]} contract={null} onClose={() => {}} onSaved={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByTestId('btm-none')).toBeTruthy();
    expect(screen.getByText('Cannot Start Here')).toBeTruthy();
    expect(screen.queryByTestId('btm-first')).toBeNull();
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
    expect(screen.getAllByText('Go to Line 1').length).toBe(2);
    expect(screen.queryByText(/Fix Line/)).toBeNull();
    fireEvent.press(screen.getByTestId('rejection-check-continue'));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/compliant|verified|passed|ready to submit/i)).toBeNull();
  });
});
