/**
 * Pay what's earned (step 3, lane L2) — BEHAVIOUR ONLY, no snapshot.
 *
 * A $48,000 commitment, $13,000 already approved/paid, a $16,760 bill on
 * tasks that are 35% done: the card must render under its sanctioned
 * testID with the approve/hold suggestion; an in-line bill renders the one
 * muted line and no suggestion. The math is executed by
 * scripts/validate-pay-earned.ts; this proves the card renders it.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/contexts/ThemeContext';
import type { Commitment, Project, Subcontractor, SubSubmittedInvoice } from '@/types';

const mockReports = [
  { id: 'd1', projectId: 'p1', date: '2026-09-01', manpower: [{ id: 'm1', trade: 'Electrical', company: 'Acme Electric LLC', headcount: 3, hoursWorked: 8 }] },
  { id: 'd2', projectId: 'p1', date: '2026-09-02', manpower: [{ id: 'm2', trade: 'Electrical', company: 'Bolt Electric', headcount: 3, hoursWorked: 8 }] },
];
jest.mock('@/contexts/ProjectContext', () => ({
  useProjects: () => ({
    getDailyReportsForProject: () => mockReports,
    getPunchItemsForProject: () => [],
  }),
}));

// eslint-disable-next-line import/first
import { PayWhatsEarnedCard } from '@/components/subInvoice/PayWhatsEarnedCard';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
function Wrapper({ children }: { children: React.ReactNode }) {
  return <SafeAreaProvider initialMetrics={METRICS}><ThemeProvider>{children}</ThemeProvider></SafeAreaProvider>;
}

const inv = (o: Partial<SubSubmittedInvoice>): SubSubmittedInvoice => ({
  id: 'inv3', subPortalId: 'sp1', commitmentId: 'c1', invoiceNumber: '3', amount: 16760,
  status: 'submitted', createdAt: '2026-09-20T12:00:00Z', ...o,
} as SubSubmittedInvoice);

const siblings = [
  inv({ id: 'inv1', amount: 8000, status: 'approved' }),
  inv({ id: 'inv2', amount: 5000, status: 'paid' }),
];
const commitment = { id: 'c1', amount: 45000, changeAmount: 3000 } as unknown as Commitment;
const sub = { id: 'sub1', companyName: 'Acme Electric LLC' } as unknown as Subcontractor;
const project = (progress: number) => ({
  id: 'p1', name: 'Oak St',
  schedule: { tasks: [
    { id: 't1', title: 'Rough electrical', progress, durationDays: 10, assignedSubId: 'sub1' },
    { id: 't2', title: 'Trim out', progress, durationDays: 20, assignedSubId: 'sub1' },
  ] },
}) as unknown as Project;

describe("Pay what's earned card", () => {
  it('renders the approve/hold suggestion under payearned-<id> when the bill runs ahead of the work', () => {
    const invoice = inv({});
    render(
      <PayWhatsEarnedCard invoice={invoice} siblings={[...siblings, invoice]} commitment={commitment} project={project(35)} sub={sub} />,
      { wrapper: Wrapper },
    );
    expect(screen.getByTestId('payearned-inv3')).toBeTruthy();
    expect(screen.getByText('Suggest approving $3,800 now and holding $12,960 until the work catches up.')).toBeTruthy();
    expect(screen.getByText(/MAGE can’t approve part of an invoice/)).toBeTruthy();
    expect(screen.getByTestId('payearned-copy-inv3')).toBeTruthy();
    expect(screen.getByText(/your daily reports list them on site on 1 day\(s\)/)).toBeTruthy();
  });

  it('renders one muted line and no suggestion when billing is in line', () => {
    const invoice = inv({ amount: 6200 });
    render(
      <PayWhatsEarnedCard invoice={invoice} siblings={[...siblings, invoice]} commitment={commitment} project={project(36)} sub={sub} />,
      { wrapper: Wrapper },
    );
    expect(screen.getByTestId('payearned-inv3')).toBeTruthy();
    expect(screen.getByText('Billing is in line with work in place (40% billed, 36% done).')).toBeTruthy();
    expect(screen.queryByText(/Suggest approving/)).toBeNull();
  });
});
