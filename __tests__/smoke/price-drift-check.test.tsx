/**
 * Ideas-1 lane TRUST (roadmap T2) — the stale-price check at send and sign.
 * BEHAVIOUR ONLY, no snapshot. The arithmetic and the copy are executed by
 * scripts/validate-price-drift-gate.ts; this proves PriceDriftCheck renders
 * them in both presentations under its sanctioned pricewatch- testIDs, that
 * Reprice makes the receipt card's exact write once, that Keep is remembered,
 * that continue only calls back, and that nothing renders while unread.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeProvider } from '@/contexts/ThemeContext';
import type { LinkedEstimate, MaterialReceipt, Project } from '@/types';

const mockCtx: { projects: Project[]; projectsLoaded: boolean; updateProject: jest.Mock } = {
  projects: [],
  projectsLoaded: true,
  updateProject: jest.fn(),
};
jest.mock('@/contexts/ProjectContext', () => ({ useProjects: () => mockCtx }));
let mockReceipts: MaterialReceipt[] = [];
let mockReceiptsLoading = false;
jest.mock('@/hooks/useMaterialReceipts', () => ({
  useMaterialReceipts: () => ({ receipts: mockReceipts, isLoading: mockReceiptsLoading }),
}));

// eslint-disable-next-line import/first
import { PriceDriftCheck } from '@/components/priceWatch/PriceDriftCheck';
// eslint-disable-next-line import/first
import { PRICE_WATCH_KEPT_KEY } from '@/utils/receiptPriceWatch';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
function Wrapper({ children }: { children: React.ReactNode }) {
  return <SafeAreaProvider initialMetrics={METRICS}><ThemeProvider>{children}</ThemeProvider></SafeAreaProvider>;
}

// Copper pipe priced $4.10/lf on 600 lf at 20% markup: 600 × 4.10 × 1.2 = $2,952.00.
// PVC at $2.00 with no receipt stays put: 100 × 2 × 1.1 = $220.00. Grand $3,172.00.
const estimate: LinkedEstimate = {
  id: 'e1', globalMarkup: 15, createdAt: '2026-09-01',
  items: [
    { materialId: 'cu', name: 'Copper pipe', category: 'plumbing', unit: 'lf', quantity: 600, unitPrice: 4.10, bulkPrice: 0, markup: 20, usesBulk: false, lineTotal: 2952, supplier: '' },
    { materialId: 'pvc', name: 'PVC fitting', category: 'plumbing', unit: 'ea', quantity: 100, unitPrice: 2, bulkPrice: 0, markup: 10, usesBulk: false, lineTotal: 220, supplier: '' },
  ],
  baseTotal: 2660, markupTotal: 512, grandTotal: 3172,
};
// Signing: the project has already moved past 'estimated'.
const rivera = { id: 'p1', name: 'Rivera kitchen', status: 'in_progress', linkedEstimate: estimate } as unknown as Project;
const ferguson: MaterialReceipt = {
  id: 'r1', projectId: 'p1', vendor: 'Ferguson', receiptDate: '2026-09-20', status: 'reviewed', subtotal: 0, total: 0,
  lines: [{ id: 'r1-l1', description: 'Copper pipe', unit: 'LF', quantity: 100, unitPrice: 4.62, lineTotal: 462 }],
  createdAt: '2026-09-20T12:00:00.000Z', updatedAt: '2026-09-20T12:00:00.000Z',
};
const LINE = 'Copper pipe: priced $4.10/ft, your 9/20 receipt from Ferguson says $4.62 (+12.7%), +$312.00 cost.';

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe('PriceDriftCheck', () => {
  beforeEach(async () => {
    mockCtx.updateProject = jest.fn();
    mockCtx.projects = [rivera];
    mockCtx.projectsLoaded = true;
    mockReceipts = [ferguson];
    mockReceiptsLoading = false;
    await AsyncStorage.removeItem(PRICE_WATCH_KEPT_KEY);
  });

  it('card: shows the drifted line, the summary and the three answers; Reprice writes the repriced estimate once', async () => {
    const onReprice = jest.fn();
    const onContinue = jest.fn();
    render(<PriceDriftCheck project={rivera} action="sign" onReprice={onReprice} onContinue={onContinue} />, { wrapper: Wrapper });
    await settle();

    expect(screen.getByTestId('pricewatch-drift-card')).toBeTruthy();
    expect(screen.getByText(LINE)).toBeTruthy();
    expect(screen.getByText("1 price on this estimate is older than your latest receipt. +$312.00 cost at today's prices.")).toBeTruthy();
    // 600 × 4.62 × 1.2 = 3,326.40 → grand 3,172.00 + 374.40 = 3,546.40.
    expect(screen.getByText(/Reprice sets the estimate total to \$3,546\.40 \(now \$3,172\.00\)/)).toBeTruthy();
    expect(screen.getByTestId('pricewatch-drift-reprice')).toBeTruthy();
    expect(screen.getByTestId('pricewatch-drift-keep')).toBeTruthy();
    expect(screen.getByTestId('pricewatch-drift-continue')).toBeTruthy();
    expect(screen.getByText("Reprice to Today's Receipts")).toBeTruthy();
    expect(screen.getByText('Keep These Prices')).toBeTruthy();
    expect(screen.getByText('Sign at These Prices')).toBeTruthy();

    expect(mockCtx.updateProject).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('pricewatch-drift-reprice'));
    expect(mockCtx.updateProject).toHaveBeenCalledTimes(1);
    const [id, patch] = mockCtx.updateProject.mock.calls[0] as [string, Partial<Project>];
    expect(id).toBe('p1');
    const next = patch.linkedEstimate!;
    const cu = next.items.find(i => i.materialId === 'cu')!;
    expect(cu.unitPrice).toBe(4.62);
    expect(cu.markup).toBe(20);
    expect(cu.lineTotal).toBe(3326.4);
    expect(next.items.find(i => i.materialId === 'pvc')).toEqual(estimate.items[1]);
    expect(next.grandTotal).toBe(3546.4);
    expect(Math.round(next.items.reduce((s, it) => s + it.lineTotal, 0) * 100)).toBe(Math.round(next.grandTotal * 100));
    expect(patch.estimateVersions?.length).toBe(1);
    expect(patch.estimateVersions?.[0]?.note).toBe('Repriced from your receipts');
    expect(onReprice).toHaveBeenCalledTimes(1);
    expect(onReprice.mock.calls[0][0].grandAfterCents).toBe(354640);
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByText(/The estimate total is now \$3,546\.40 \(was \$3,172\.00\)/)).toBeTruthy();
  });

  it('sheet: same line and buttons; the continue button names sending and only calls back', async () => {
    const onContinue = jest.fn();
    const onCancel = jest.fn();
    render(<PriceDriftCheck project={rivera} presentation="sheet" action="send" onContinue={onContinue} onCancel={onCancel} />, { wrapper: Wrapper });
    await settle();

    expect(screen.getByTestId('pricewatch-drift-sheet')).toBeTruthy();
    expect(screen.getByText('Check Prices Before You Send')).toBeTruthy();
    expect(screen.getByText(LINE)).toBeTruthy();
    expect(screen.getByTestId('pricewatch-drift-reprice')).toBeTruthy();
    expect(screen.getByTestId('pricewatch-drift-keep')).toBeTruthy();
    expect(screen.getByText('Send Anyway')).toBeTruthy();
    fireEvent.press(screen.getByTestId('pricewatch-drift-continue'));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(mockCtx.updateProject).not.toHaveBeenCalled();
  });

  it('Keep remembers the line on this device and hides it', async () => {
    const onKeep = jest.fn();
    render(<PriceDriftCheck project={rivera} action="send" onKeep={onKeep} onContinue={jest.fn()} />, { wrapper: Wrapper });
    await settle();
    fireEvent.press(screen.getByTestId('pricewatch-drift-keep'));
    await settle();
    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(mockCtx.updateProject).not.toHaveBeenCalled();
    expect(screen.queryByTestId('pricewatch-drift-card')).toBeNull();
    const saved = JSON.parse((await AsyncStorage.getItem(PRICE_WATCH_KEPT_KEY)) ?? '[]');
    expect(saved).toEqual(['p1|cu|r1-l1']);
  });

  it('renders nothing while projects or receipts are unread, and nothing when no price moved', async () => {
    mockCtx.projectsLoaded = false;
    const a = render(<PriceDriftCheck project={rivera} action="sign" onContinue={jest.fn()} />, { wrapper: Wrapper });
    await settle();
    expect(screen.queryByTestId('pricewatch-drift-card')).toBeNull();
    a.unmount();

    mockCtx.projectsLoaded = true;
    mockReceiptsLoading = true;
    const b = render(<PriceDriftCheck project={rivera} action="sign" onContinue={jest.fn()} />, { wrapper: Wrapper });
    await settle();
    expect(screen.queryByTestId('pricewatch-drift-card')).toBeNull();
    b.unmount();

    mockReceiptsLoading = false;
    mockReceipts = [];
    render(<PriceDriftCheck project={rivera} action="sign" onContinue={jest.fn()} />, { wrapper: Wrapper });
    await settle();
    expect(screen.queryByTestId('pricewatch-drift-card')).toBeNull();
  });
});
