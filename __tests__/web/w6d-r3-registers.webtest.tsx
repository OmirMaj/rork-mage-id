/**
 * Real-DOM proof for the wave-6d lane-R3 registers (jsdom + react-dom +
 * react-native-web — the stack app.mageid.app runs).
 *
 *   1. Leads list: every row is an <a href="/lead-detail?leadId=…"> (Cmd-click
 *      opens a new tab); before the leads load it says Loading…, never an
 *      empty pipeline.
 *   2. Deliveries: the Late table sits ABOVE the horizon control; the row's
 *      Confirm / Received run the screen's handlers; bulk Confirm confirms
 *      EACH selected load (one per render); bulk Mark received is disabled and
 *      says why; Export CSV carries the job slug and the local day; 'n' adds.
 *   3. Documents: rows are links where each record lives — a COI keeps its
 *      sub (/coi-vault?subId=…), a submittal opens the log's split; the COI
 *      at-risk KPI links to the vault; the Project files rail links each job's
 *      Files; the meta line claims no contracts.
 *
 * Run: npx jest --config __tests__/web/jest.web.config.js __tests__/web/w6d-r3-registers.webtest.tsx
 */

import React, { act } from 'react';
import { Dimensions } from 'react-native';

type Root = { render(node: React.ReactNode): void; unmount(): void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRoot } = require('react-dom/client') as { createRoot(el: Element): Root };

const mockRouter = { navigate: jest.fn(), push: jest.fn(), replace: jest.fn(), setParams: jest.fn(), back: jest.fn(), canGoBack: () => false };
const mockSetOptions = jest.fn();
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  // The registers mount outside a navigator here: no URL params, no header.
  return {
    ...actual,
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({}),
    useNavigation: () => ({ setOptions: mockSetOptions }),
    Stack: { ...actual.Stack, Screen: () => null },
  };
});
jest.mock('@/utils/alert', () => ({ showAlert: jest.fn(), showPrompt: jest.fn() }));
jest.mock('@/utils/platformFile', () => ({ ...jest.requireActual('@/utils/platformFile'), deliverTextFile: jest.fn(() => Promise.resolve()) }));

import { ThemeProvider } from '@/contexts/ThemeContext';
import { LeadsTable } from '@/components/registers/LeadsTable';
import { DeliveriesRegister, DELIVERY_BULK_RECEIVE_REASON } from '@/components/registers/DeliveriesRegister';
import { DocumentsRegister, DOCUMENTS_REGISTER_META, type DocumentStats } from '@/components/registers/DocumentsRegister';
import type { DocumentRegisterRow } from '@/utils/registers/documentRows';
import { buildLookahead, type Delivery } from '@/utils/deliverySchedule';
import type { AccessConflict } from '@/utils/buildingAccess';
import { showAlert } from '@/utils/alert';
import { deliverTextFile } from '@/utils/platformFile';
import type { Lead, LeadStage } from '@/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.spyOn(Dimensions, 'get').mockImplementation(
  () => ({ width: 1512, height: 945, scale: 2, fontScale: 1 }) as ReturnType<typeof Dimensions.get>,
);

const roots: { root: Root; el: HTMLElement }[] = [];
async function mount(node: React.ReactElement): Promise<{ el: HTMLElement; root: Root }> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push({ root, el });
  await act(async () => { root.render(<ThemeProvider>{node}</ThemeProvider>); });
  return { el, root };
}
afterEach(async () => {
  for (const { root, el } of roots.splice(0)) {
    await act(async () => { root.unmount(); });
    el.remove();
  }
});

const byId = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const alertMock = showAlert as jest.Mock;
const lastAlert = () => alertMock.mock.calls[alertMock.mock.calls.length - 1] as [string, string | undefined];
async function click(target: Element): Promise<void> {
  await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); });
}
async function bulkButton(el: HTMLElement, table: string, label: string): Promise<void> {
  const bar = byId(el, `${table}-bulkbar`);
  expect(bar).not.toBeNull();
  const btn = [...bar!.querySelectorAll('[role="button"]')].find((b) => b.textContent === label);
  expect(btn).toBeTruthy();
  await click(btn!);
}
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

beforeEach(() => {
  alertMock.mockClear();
  mockRouter.push.mockClear();
  (deliverTextFile as jest.Mock).mockClear();
});

// ── 1. Leads list ──────────────────────────────────────────────────────────
const STAGE_COLORS: Record<LeadStage, string> = { new: '#FF6A1A', qualified: '#1A6B3C', proposal: '#0D6CB1', won: '#16A34A', lost: '#9CA3AF' };
const lead = (id: string, name: string, stage: LeadStage, extra: Partial<Lead> = {}): Lead => ({
  id, name, stage, source: 'referral', receivedAt: '2026-09-20T12:00:00.000Z', touches: [],
  createdAt: '2026-09-20T12:00:00.000Z', updatedAt: '2026-09-20T12:00:00.000Z', ...extra,
});
const GROUPED: Record<LeadStage, Lead[]> = {
  new: [lead('l1', 'Rosa Whitfield', 'new', { budgetMax: 80000 })],
  qualified: [lead('l2', 'Omar Beck', 'qualified', { firstRespondedAt: '2026-09-20T14:00:00.000Z' })],
  proposal: [],
  won: [lead('l3', 'Hal Moreno', 'won')],
  lost: [],
};

describe('Leads list (real DOM, 1512)', () => {
  it('each row is a link to /lead-detail?leadId=…, in the board\'s order', async () => {
    const { el } = await mount(<LeadsTable grouped={GROUPED} loaded stageColors={STAGE_COLORS} onNew={jest.fn()} />);
    expect(byId(el, 'leads-register-table')).not.toBeNull();
    const a = el.querySelector('a[href="/lead-detail?leadId=l2"]');
    expect(a).not.toBeNull();
    const rows = [...el.querySelectorAll('[data-testid^="leads-register-table-row-"]')]
      .map((n) => n.getAttribute('data-testid'))
      .filter((id) => id && !id.endsWith('-check'));
    expect(rows).toEqual(['leads-register-table-row-l1', 'leads-register-table-row-l2', 'leads-register-table-row-l3']);
    expect(el.textContent).toContain('$80,000.00');
  });

  it('before the leads load it says Loading…, never an empty pipeline', async () => {
    const { el } = await mount(<LeadsTable grouped={GROUPED} loaded={false} stageColors={STAGE_COLORS} onNew={jest.fn()} />);
    expect(el.textContent).toContain('Loading…');
    expect(el.textContent).not.toMatch(/No leads in the pipeline yet/);
    expect(el.querySelector('a[href^="/lead-detail"]')).toBeNull();
  });
});

// ── 2. Deliveries ──────────────────────────────────────────────────────────
const NOW = new Date(2026, 8, 25, 10).getTime();
const dayOffset = (n: number) => localDay(new Date(NOW + n * 86_400_000));
const delivery = (id: string, what: string, offset: number, extra: Partial<Delivery> = {}): Delivery => ({
  id, projectId: 'p1', description: what, supplier: 'Supply Co', expectedDate: dayOffset(offset), status: 'scheduled',
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', ...extra,
});
const LOADS = [
  delivery('d-late', '14 windows', -3, { poNumber: 'PO-1182' }),
  delivery('d-soon', 'Roof trusses', 2),
  delivery('d-soon2', 'Drywall', 3),
  delivery('d-conf', 'Tile', 4, { status: 'confirmed' }),
];

describe('Deliveries register (real DOM, 1512)', () => {
  function deliveries(props: Partial<React.ComponentProps<typeof DeliveriesRegister>> = {}) {
    const look = buildLookahead(LOADS, 7, NOW);
    const conflicts: AccessConflict[] = [
      { kind: 'coi_not_on_file', severity: 'blocking', message: 'The building has no COI on file', action: 'Send the COI' },
    ];
    return (
      <DeliveriesRegister
        projectId="p1"
        projectName="Henderson Remodel"
        look={look}
        horizon={7}
        onHorizon={jest.fn()}
        conflicts={conflicts}
        projectConflicts={conflicts}
        hasAccessRules
        onConfirm={jest.fn()}
        onReceive={jest.fn()}
        onAdd={jest.fn()}
        onOpenBuildingAccess={jest.fn()}
        {...props}
      />
    );
  }

  it('the Late table sits above the horizon control; the breadcrumb is the job', async () => {
    const { el } = await mount(deliveries());
    const late = byId(el, 'deliveries-register-late');
    const horizon = byId(el, 'deliveries-register-horizon');
    const upcoming = byId(el, 'deliveries-register-table');
    expect(late && horizon && upcoming).toBeTruthy();
    // DOM order: late, then the horizon, then the look-ahead.
    expect(late!.compareDocumentPosition(horizon!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(horizon!.compareDocumentPosition(upcoming!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // ...and all three live in the scrolling body, not the shell's fixed slot.
    const body = byId(el, 'deliveries-register-body');
    expect(body && body.contains(late!) && body.contains(horizon!) && body.contains(upcoming!)).toBe(true);
    expect(byId(el, 'deliveries-register-late-row-d-late')).not.toBeNull();
    expect(el.textContent).toContain('3 days late');
    expect(el.textContent).toContain('Henderson Remodel');
    expect(el.textContent).toContain('The building has no COI on file');
  });

  it("a row's Confirm and Received run the screen's handlers; a confirmed load offers no Confirm", async () => {
    const onConfirm = jest.fn();
    const onReceive = jest.fn();
    const { el } = await mount(deliveries({ onConfirm, onReceive }));
    await click(byId(el, 'confirm-d-soon')!);
    expect(onConfirm.mock.calls.map((c) => (c[0] as Delivery).id)).toEqual(['d-soon']);
    await click(byId(el, 'receive-d-late')!);
    expect(onReceive.mock.calls.map((c) => (c[0] as Delivery).id)).toEqual(['d-late']);
    expect(byId(el, 'confirm-d-conf')).toBeNull();
    expect(byId(el, 'receive-d-conf')).not.toBeNull();
  });

  it('bulk Confirm confirms each selected load', async () => {
    const onConfirm = jest.fn();
    const { el } = await mount(deliveries({ onConfirm }));
    await click(byId(el, 'deliveries-register-table-row-d-soon-check')!);
    await click(byId(el, 'deliveries-register-table-row-d-soon2-check')!);
    await bulkButton(el, 'deliveries-register-table', 'Confirm');
    await act(async () => { await Promise.resolve(); });
    expect(onConfirm.mock.calls.map((c) => (c[0] as Delivery).id).sort()).toEqual(['d-soon', 'd-soon2']);
  });

  it('bulk Mark received is disabled and says why', async () => {
    const onReceive = jest.fn();
    const { el } = await mount(deliveries({ onReceive }));
    await click(byId(el, 'deliveries-register-table-row-d-soon-check')!);
    await bulkButton(el, 'deliveries-register-table', 'Mark received');
    const [title, message] = lastAlert();
    expect(title).toBe('Mark received');
    expect(message).toBe(DELIVERY_BULK_RECEIVE_REASON);
    expect(onReceive).not.toHaveBeenCalled();
  });

  it('Export CSV carries the job slug and the local day', async () => {
    const { el } = await mount(deliveries());
    await click(byId(el, 'deliveries-register-csv')!);
    const call = (deliverTextFile as jest.Mock).mock.calls[0];
    expect(call[0]).toBe(`deliveries-henderson-remodel-${localDay(new Date())}.csv`);
    const lines = String(call[1]).split('\r\n');
    expect(lines[0]).toBe('Flag,What,Promised,Supplier,Window,PO,Confirmed,Building access');
    expect(lines).toHaveLength(1 + 4);
  });

  it("'n' outside a field adds a delivery", async () => {
    const onAdd = jest.fn();
    await mount(deliveries({ onAdd }));
    await act(async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true, cancelable: true })); });
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('with nothing scheduled the table shows the phone\'s empty copy', async () => {
    const { el } = await mount(deliveries({ look: buildLookahead([], 7, NOW), conflicts: [], projectConflicts: [] }));
    expect(el.textContent).toContain('Nothing scheduled yet');
    expect(byId(el, 'deliveries-register-late')).toBeNull();
  });
});

// ── 3. Documents ───────────────────────────────────────────────────────────
const doc = (id: string, type: DocumentRegisterRow['type'], title: string, status: DocumentRegisterRow['status'], extra: Partial<DocumentRegisterRow> = {}): DocumentRegisterRow => ({
  id, projectId: 'p1', projectName: 'Henderson Remodel', type, title, status, createdAt: '2026-09-10T12:00:00.000Z', ...extra,
});
const DOCS: DocumentRegisterRow[] = [
  doc('coi-c1', 'coi', 'COI · Harbor Electric', { bucket: 'at_risk', label: 'Failed check', tone: 'danger' }),
  doc('permit-1', 'permit', 'Permit · building', { bucket: 'done', label: 'Approved', tone: 'success' }),
  doc('submittal-s5', 'other', 'Submittal #5 · Doors', { bucket: 'awaiting', label: 'In review', tone: 'warning' }),
  doc('aia-a1', 'aia_billing', 'AIA G702 · App #2', { bucket: 'draft', label: 'Saved', tone: 'neutral' }),
];
const STATS: DocumentStats = { total: 4, pending: 1, done: 1, expired: 0, coiFailed: 1, coiReview: 0, expiringSoon: 0 };

describe('Documents register (real DOM, 1512)', () => {
  function documents(props: Partial<React.ComponentProps<typeof DocumentsRegister>> = {}) {
    return (
      <DocumentsRegister
        documents={DOCS}
        stats={STATS}
        selectedFilter="all"
        setSelectedFilter={jest.fn()}
        fileProjects={[{ id: 'p1', name: 'Henderson Remodel' }]}
        cois={[{ id: 'c1', subcontractorId: 'sub-9' }]}
        aiaPayApps={[{ id: 'a1', invoiceId: 'inv-7' }]}
        {...props}
      />
    );
  }

  it('rows are links where each record lives (a COI keeps its sub)', async () => {
    const { el } = await mount(documents());
    expect(el.querySelector('a[href="/coi-vault?subId=sub-9"]')).not.toBeNull();
    expect(el.querySelector('a[href="/submittal?projectId=p1&submittalId=s5"]')).not.toBeNull();
    expect(el.querySelector('a[href="/aia-pay-app?invoiceId=inv-7"]')).not.toBeNull();
    expect(el.querySelector('a[href="/permits"]')).not.toBeNull();
  });

  it('the COI-at-risk KPI links to the vault; the Files rail links each job', async () => {
    const { el } = await mount(documents());
    expect(byId(el, 'documents-register-kpis')).not.toBeNull();
    expect(el.textContent).toContain('COI at risk');
    expect(el.querySelector('a[href="/coi-vault"]')).not.toBeNull();
    expect(el.querySelector('a[href="/project-files?projectId=p1"]')).not.toBeNull();
  });

  it('no COI at risk → no COI KPI; the meta line claims no contracts', async () => {
    const { el } = await mount(documents({ stats: { ...STATS, coiFailed: 0 } }));
    expect(el.textContent).not.toContain('COI at risk');
    expect(el.textContent).toContain(DOCUMENTS_REGISTER_META);
    expect(DOCUMENTS_REGISTER_META).not.toMatch(/contract/i);
  });

  it('a chip filters to its bucket; an empty bucket says it is the filter, not the feed', async () => {
    const { el } = await mount(documents({ selectedFilter: 'expired' }));
    expect(el.textContent).toContain('Nothing under this filter');
    expect(el.textContent).toContain('this is the filter, not the feed');
    const done = await mount(documents({ selectedFilter: 'done' }));
    expect(done.el.querySelector('a[href="/permits"]')).not.toBeNull();
    expect(done.el.querySelector('a[href="/coi-vault?subId=sub-9"]')).toBeNull();
  });

  it('Export CSV names the file documents-YYYY-MM-DD.csv', async () => {
    const { el } = await mount(documents());
    await click(byId(el, 'documents-register-csv')!);
    const call = (deliverTextFile as jest.Mock).mock.calls[0];
    expect(call[0]).toBe(`documents-${localDay(new Date())}.csv`);
    expect(String(call[1]).split('\r\n')[0]).toBe('Type,Title,Status,Date,Expires,Project,Notes');
  });
});
