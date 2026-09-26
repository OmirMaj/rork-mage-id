/**
 * List-2 lane I — the insurance audit pack, mounted in the real app.
 *
 * Seeds two subs and their certificates, serves paid sub-portal invoices from
 * the stubbed `sub_submitted_invoices` SELECT (the same read tax-1099-export
 * does), and checks: the headline numbers, the per-sub rows, the exemption
 * note, export disabled on a load error, the request message opening the
 * share sheet only on tap, and the door on /coi-vault. The golden (recorded on
 * the first run) is the visible TEXT of the summary and the two sub cards,
 * with the calendar year masked so it survives New Year.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';

const mockShare = jest.fn(async (_opts: { message: string }) => 'shared' as const);
jest.mock('@/utils/shareText', () => ({
  shareText: (opts: { message: string }) => mockShare(opts),
  canShare: () => true,
}));

const Y = new Date().getFullYear();
const A = 'sub-ia-1';
const B = 'sub-ia-2';
const subs = [
  { id: A, companyName: 'Acme Framing', contactName: 'Al', phone: '(555) 700-0001', email: '', address: '', trade: 'Framing', licenseNumber: '', licenseExpiry: '', coiExpiry: '', w9OnFile: true, bidHistory: [], assignedProjects: [], notes: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: B, companyName: 'Bolt Electric', contactName: '', phone: '', email: '', address: '', trade: 'Electrical', licenseNumber: '', licenseExpiry: '', coiExpiry: '', w9OnFile: false, bidHistory: [], assignedProjects: [], notes: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
];
const cois = [
  {
    id: 'coi-ia-1', subcontractorId: A, fileUri: '', uploadedAt: `${Y}-01-02T12:00:00.000Z`,
    coverages: [
      { type: 'workers_comp', carrierName: 'Harbor Mutual', policyNumber: 'WC-12', effectiveDate: `${Y}-01-01`, expiresAt: `${Y}-06-30`, source: 'manual' },
      { type: 'general_liability', carrierName: 'Harbor Mutual', policyNumber: 'GL-7', effectiveDate: `${Y}-01-01`, expiresAt: `${Y}-12-31`, source: 'manual' },
    ],
  },
];
const invoiceRows = [
  { id: 'inv-ia-1', sub_portal_id: 'sp', project_id: null, subcontractor_id: A, commitment_id: null, invoice_number: 'A-101', amount: 12000, retention_amount: null, status: 'paid', created_at: `${Y}-03-01T12:00:00Z`, reviewed_at: null, paid_at: null, paid_on: `${Y}-03-02`, payment_method: 'check', submitted_by_name: null, submitted_by_email: null },
  { id: 'inv-ia-2', sub_portal_id: 'sp', project_id: null, subcontractor_id: A, commitment_id: null, invoice_number: 'A-102', amount: 8000, retention_amount: null, status: 'paid', created_at: `${Y}-07-01T12:00:00Z`, reviewed_at: null, paid_at: null, paid_on: `${Y}-07-15`, payment_method: 'check', submitted_by_name: null, submitted_by_email: null },
  { id: 'inv-ia-3', sub_portal_id: 'sp', project_id: null, subcontractor_id: B, commitment_id: null, invoice_number: 'B-1', amount: 5000.5, retention_amount: null, status: 'paid', created_at: `${Y}-04-01T12:00:00Z`, reviewed_at: null, paid_at: null, paid_on: `${Y}-04-02`, payment_method: 'ach', submitted_by_name: null, submitted_by_email: null },
];

let fromSpy: jest.SpyInstance | null = null;
function serveInvoices(mode: 'rows' | 'error') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sb = require('@/lib/supabase') as { supabase: { from: (t?: string) => unknown } };
  const orig = sb.supabase.from;
  fromSpy = jest.spyOn(sb.supabase, 'from').mockImplementation((table?: string) => {
    if (table !== 'sub_submitted_invoices') return orig(table);
    const target: Record<string, unknown> = {
      then(ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) {
        const res = mode === 'error'
          ? { data: null, error: { message: 'offline' }, count: 0, status: 0, statusText: '' }
          : { data: invoiceRows, error: null, count: invoiceRows.length, status: 200, statusText: 'OK' };
        return Promise.resolve(res).then(ok, bad);
      },
    };
    const proxy: unknown = new Proxy(target, {
      get(t, prop: string) {
        if (prop in t) return t[prop];
        if (typeof prop === 'symbol') return undefined;
        return () => proxy;
      },
    });
    return proxy;
  });
}

async function mount(mode: 'rows' | 'error') {
  await primeWorld('empty');
  await AsyncStorage.setItem('mageid_subcontractors', JSON.stringify(subs));
  await AsyncStorage.setItem('mageid_cois', JSON.stringify(cois));
  serveInvoices(mode);
  const tree = await mountRouteChecked('/insurance-audit');
  for (let i = 0; i < 4; i++) {
    await act(async () => { try { jest.advanceTimersByTime(300); } catch { /* real timers */ } for (let k = 0; k < 20; k++) await Promise.resolve(); });
  }
  return tree;
}

function texts(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (Array.isArray(node)) { for (const n of node) texts(n, out); return out; }
  if (typeof node === 'string') { out.push(node.split(String(Y)).join('<Y>')); return out; }
  if (typeof node === 'object') texts((node as { children?: unknown }).children, out);
  return out;
}

beforeEach(() => { mockShare.mockClear(); allowConsoleErrors(); });
afterEach(() => { fromSpy?.mockRestore(); fromSpy = null; });

describe('insurance audit pack', () => {
  jest.setTimeout(120000);

  it('states the payments against the certificates (golden)', async () => {
    const tree = await mount('rows');
    const headline = screen.getByTestId('insaudit-headline');
    // $12,000 covered (Mar 2), $8,000 after the WC expiry (Jul 15), $5,000.50 to a sub with no certificate.
    expect(headline.props.children).toContain('$25,000.50 paid to 2 subs.');
    expect(headline.props.children).toContain("$13,000.50 went to 2 subs with no workers' comp certificate covering the payment date.");
    expect(screen.getByTestId('insaudit-exemption-note')).toBeTruthy();
    expect(screen.getByTestId(`insaudit-sub-${A}`)).toBeTruthy();
    expect(screen.getByTestId(`insaudit-sub-${B}`)).toBeTruthy();
    expect(screen.getByTestId('insaudit-export-csv').props.accessibilityState?.disabled ?? false).toBe(false);
    const json = tree.toJSON();
    void json;
    expect({
      summary: texts(screen.getByTestId('insaudit-summary')),
      a: texts(screen.getByTestId(`insaudit-sub-${A}`)),
      b: texts(screen.getByTestId(`insaudit-sub-${B}`)),
    }).toMatchSnapshot();
  });

  it('opens the request in the share sheet only on tap', async () => {
    await mount('rows');
    fireEvent.press(screen.getByTestId(`insaudit-ask-${B}`));
    await act(async () => { await Promise.resolve(); });
    expect(mockShare).not.toHaveBeenCalled();
    const draft = screen.getByTestId(`insaudit-draft-${B}`);
    expect(draft.props.value).toMatch(/^Hi Bolt Electric, our insurance auditor needs your workers' comp certificate covering/);
    expect(within(screen.getByTestId(`insaudit-sub-${B}`)).getByText(/No phone or email on file/)).toBeTruthy();
    fireEvent.changeText(draft, 'Edited before sending');
    await act(async () => { fireEvent.press(screen.getByTestId(`insaudit-send-${B}`)); });
    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(mockShare.mock.calls[0][0].message).toBe('Edited before sending');
  });

  it('a failed portal read says so and disables both exports', async () => {
    await mount('error');
    expect(screen.getByTestId('insaudit-load-error')).toBeTruthy();
    expect(screen.getByTestId('insaudit-headline').props.children).toMatch(/^Portal payments couldn't be loaded — totals below leave them out\./);
    expect(screen.getByTestId('insaudit-export-blocked').props.children).toMatch(/Export needs the sub-portal payments/);
    for (const id of ['insaudit-export-csv', 'insaudit-export-pdf']) {
      const btn = screen.getByTestId(id);
      expect(btn.props.accessibilityState?.disabled).toBe(true);
    }
  });

  it('/coi-vault carries the door to the pack', async () => {
    await primeWorld('empty');
    await AsyncStorage.setItem('mageid_subcontractors', JSON.stringify(subs));
    await mountRouteChecked('/coi-vault');
    expect(screen.getByTestId('insaudit-link')).toBeTruthy();
    expect(screen.getByText('Insurance audit pack — payments vs certificates')).toBeTruthy();
  });
});
