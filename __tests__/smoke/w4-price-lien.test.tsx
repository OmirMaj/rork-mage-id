/**
 * Wave 4 W1 — Price watch + the NY lien-deadline clock. BEHAVIOUR ONLY, no
 * snapshot. The math is executed by scripts/validate-receipt-price-watch.ts
 * and scripts/validate-lien-rights-clock.ts; this proves the cards render it
 * under their sanctioned testIDs and that Reprice writes once, footed.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/contexts/ThemeContext';
import type { LinkedEstimate, MaterialReceipt, Project } from '@/types';
import { addCalendarDays, addCalendarMonths, formatCalendarDay, toCalendarDayString } from '@/utils/calendarDate';
import { LIEN_RULES } from '@/utils/lienRightsClock';

const daysAgo = (n: number) => toCalendarDayString(addCalendarDays(new Date(), -n));

const mockCtx: {
  projects: Project[];
  updateProject: jest.Mock;
  getProject: (id: string) => Project | null;
  getDailyReportsForProject: (id: string) => { projectId: string; date: string }[];
  dailyReportsLoaded: boolean;
} = {
  projects: [],
  updateProject: jest.fn(),
  getProject: () => null,
  getDailyReportsForProject: () => [],
  dailyReportsLoaded: true,
};
jest.mock('@/contexts/ProjectContext', () => ({ useProjects: () => mockCtx }));
let mockReceipts: MaterialReceipt[] = [];
jest.mock('@/hooks/useMaterialReceipts', () => ({ useMaterialReceipts: () => ({ receipts: mockReceipts }) }));

// eslint-disable-next-line import/first
import { PriceWatchCard } from '@/components/priceWatch/PriceWatchCard';
// eslint-disable-next-line import/first
import { LienClockCard } from '@/components/invoice/LienClockCard';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
function Wrapper({ children }: { children: React.ReactNode }) {
  return <SafeAreaProvider initialMetrics={METRICS}><ThemeProvider>{children}</ThemeProvider></SafeAreaProvider>;
}

function receipt(id: string, vendor: string, day: string, description: string, unit: string, quantity: number, unitPrice: number): MaterialReceipt {
  return {
    id, projectId: 'p1', vendor, receiptDate: day, status: 'reviewed', subtotal: 0, total: 0,
    lines: [{ id: `${id}-l1`, description, unit, quantity, unitPrice, lineTotal: quantity * unitPrice }],
    createdAt: `${day}T12:00:00.000Z`, updatedAt: `${day}T12:00:00.000Z`,
  };
}

const estimate: LinkedEstimate = {
  id: 'e1', globalMarkup: 15, createdAt: '2026-09-01',
  items: [
    { materialId: 'stud', name: '2x4x8 SPF Stud', category: 'lumber', unit: 'ea', quantity: 200, unitPrice: 4, bulkPrice: 0, markup: 15, usesBulk: false, lineTotal: 920, supplier: '' },
    { materialId: 'drywall', name: 'Drywall 1/2in', category: 'drywall', unit: 'sheet', quantity: 10, unitPrice: 15, bulkPrice: 0, markup: 10, usesBulk: false, lineTotal: 165, supplier: '' },
  ],
  baseTotal: 950, markupTotal: 135, grandTotal: 1085,
};
const rivera = { id: 'p1', name: 'Rivera kitchen', status: 'estimated', linkedEstimate: estimate, location: 'Brooklyn, NY' } as unknown as Project;

describe('Price watch card', () => {
  beforeEach(() => { mockCtx.updateProject = jest.fn(); });

  it('shows the supplier spread with the right dollars, and Reprice writes once, footed', async () => {
    mockReceipts = [
      receipt('r1', 'Yard A', daysAgo(10), '5/8" Type X board', 'sheet', 100, 18.00),
      receipt('r2', 'Yard B', daysAgo(8), '5/8" type x board', 'sheet', 100, 15.25),
      receipt('r3', 'Yard B', daysAgo(2), '2x4x8 SPF stud', 'ea', 50, 4.40),
    ];
    mockCtx.projects = [rivera];
    render(<PriceWatchCard projectId="p1" />, { wrapper: Wrapper });
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByTestId('pricewatch-card')).toBeTruthy();
    expect(screen.getByText('From receipts you reviewed.')).toBeTruthy();
    // Label = the newest line as printed. 18.00 vs 15.25 → 18% more; 100 × $2.75 = $275 across 1 receipt.
    expect(screen.getByText(/5\/8" type x board · 18% more at Yard A than Yard B in the last 30 days · \$275 across 1 receipt$/)).toBeTruthy();

    // stud 4.00 → 4.40 (+10%) on 200 ea at 15% markup: 920 → 1012 (+$92).
    expect(screen.getByText('Rivera kitchen · 1 line is up 10% on your latest receipts')).toBeTruthy();
    fireEvent.press(screen.getByText('Reprice (+$92)'));
    expect(screen.getByText(/Grand total \$1,085\.00 → \$1,177\.00/)).toBeTruthy();
    expect(mockCtx.updateProject).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('pricewatch-confirm-p1'));
    expect(mockCtx.updateProject).toHaveBeenCalledTimes(1);
    const [id, patch] = mockCtx.updateProject.mock.calls[0] as [string, Partial<Project>];
    expect(id).toBe('p1');
    const next = patch.linkedEstimate!;
    const sumCents = Math.round(next.items.reduce((s, it) => s + it.lineTotal, 0) * 100);
    expect(sumCents).toBe(Math.round(next.grandTotal * 100));
    expect(next.grandTotal).toBe(1177);
    expect(next.items.find(i => i.materialId === 'stud')!.markup).toBe(15);
    expect(patch.estimateVersions?.length).toBe(1);
  });

  it('says what it needs with fewer than two reviewed receipts', () => {
    mockReceipts = [receipt('r1', 'Yard A', daysAgo(1), 'Plywood', 'sheet', 10, 50)];
    mockCtx.projects = [];
    render(<PriceWatchCard projectId="p1" />, { wrapper: Wrapper });
    expect(screen.getByText('Price watch compares your reviewed receipts — it needs the same item from two suppliers.')).toBeTruthy();
  });
});

describe('Lien clock card', () => {
  const nyJob = { id: 'p1', name: 'Rivera kitchen', location: '', structuredAddress: { street: '1 Main St', city: 'Brooklyn', state: 'NY', zip: '11215' } } as unknown as Project;
  beforeEach(() => {
    mockCtx.getProject = (id) => (id === 'p1' ? nyJob : null);
    mockCtx.dailyReportsLoaded = true;
  });

  it('shows both NY dates, the public-job qualifier and the citation from the daily log', () => {
    const last = daysAgo(40);
    mockCtx.getDailyReportsForProject = () => [{ projectId: 'p1', date: last }];
    render(<LienClockCard projectId="p1" />, { wrapper: Wrapper });
    expect(screen.getByTestId('lienclock-card')).toBeTruthy();
    if (LIEN_RULES.NY.verified) {
      const eight = formatCalendarDay(addCalendarMonths(last, 8));
      const four = formatCalendarDay(addCalendarMonths(last, 4));
      expect(screen.getByText(new RegExp(`New York: file by ${eight} — or by ${four} if this is a single-family dwelling`))).toBeTruthy();
      expect(screen.getByText(/A public job \(city, state, school, authority\) has a much shorter deadline/)).toBeTruthy();
      expect(screen.getByText(/N\.Y\. Lien Law § 10/)).toBeTruthy();
    } else {
      expect(screen.getByText(/We couldn't verify New York's lien deadline today/)).toBeTruthy();
      expect(screen.queryByText(/Lien Law/)).toBeNull();
    }
    expect(screen.getByText(/confirm with your attorney/)).toBeTruthy();
  });

  it('says there is no daily report once the log is read', () => {
    mockCtx.getDailyReportsForProject = () => [];
    render(<LienClockCard projectId="p1" />, { wrapper: Wrapper });
    expect(screen.getByText(/No daily report on this job to date the last day of work/)).toBeTruthy();
  });

  it('waits for the daily log instead of claiming there is none', () => {
    mockCtx.dailyReportsLoaded = false;
    mockCtx.getDailyReportsForProject = () => [];
    render(<LienClockCard projectId="p1" />, { wrapper: Wrapper });
    expect(screen.getByText('Reading your daily log…')).toBeTruthy();
    expect(screen.queryByText(/No daily report on this job/)).toBeNull();
  });
});
