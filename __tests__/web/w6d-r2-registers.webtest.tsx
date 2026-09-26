/**
 * Real-DOM proof for the wave-6d lane-R2 registers (jsdom + react-dom +
 * react-native-web — the stack app.mageid.app runs).
 *
 *   1. COI Vault: every row is an <a href="/coi-vault?subId=…"> (Cmd-click /
 *      right-click → a new tab), sorted by days left (soonest first, unknown
 *      last); a plain click opens the record beside the list.
 *   2. The guard on j/k: with a certificate card reporting unsaved coverage
 *      rows (useRegisterRecordDirty), j asks "Discard changes?" and opens
 *      nothing until he says Discard; with a clean record, j opens the next row.
 *   3. The chips count what the phone banner counts (coiSummary); bulk Request
 *      renewal is disabled and says why; Export CSV names the file by the
 *      LOCAL day.
 *   4. Subs: rows link to ?subId=; the chips equal the phone's stat cards
 *      (subStatusCounts); bulk Delete is disabled and says why; the toolbar
 *      holds six actions and no launcher banners; 'n' outside a field opens New.
 *
 * Run: npx jest --config __tests__/web/jest.web.config.js __tests__/web/w6d-r2-registers.webtest.tsx
 */

import React, { act } from 'react';
import { Dimensions, Text } from 'react-native';

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
import type { SplitRecord } from '@/components/desktop/SplitView';
import { CoiVaultRegister, COI_RENEWAL_REASON } from '@/components/registers/CoiVaultRegister';
import { SubsRegister, SUBS_BULK_DELETE_REASON } from '@/components/registers/SubsRegister';
import { useRegisterRecordDirty } from '@/components/registers/RegisterRecordHost';
import { coiRegisterRow, coiSummary } from '@/utils/registers/coiRows';
import { subStatusCounts } from '@/utils/registers/subRows';
import { showAlert } from '@/utils/alert';
import { deliverTextFile } from '@/utils/platformFile';
import type { CertificateOfInsurance, Subcontractor } from '@/types';

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
type Btn = { text: string; style?: string; onPress?: () => void };
const lastAlert = () => alertMock.mock.calls[alertMock.mock.calls.length - 1] as [string, string | undefined, Btn[] | undefined];
async function click(target: Element): Promise<void> {
  await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); });
}
async function keydown(target: EventTarget, init: KeyboardEventInit): Promise<void> {
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })); });
}
async function bulkButton(el: HTMLElement, table: string, label: string): Promise<void> {
  const bar = byId(el, `${table}-bulkbar`);
  expect(bar).not.toBeNull();
  const btn = [...bar!.querySelectorAll('[role="button"]')].find((b) => b.textContent === label);
  expect(btn).toBeTruthy();
  await click(btn!);
}
const chipCount = (el: HTMLElement, id: string): number | null => {
  const m = (byId(el, id)?.textContent ?? '').match(/(\d+)$/);
  return m ? Number(m[1]) : null;
};
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayFromNow = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return localDay(d); };

const sub = (id: string, name: string, extra: Partial<Subcontractor> = {}): Subcontractor => ({
  id, companyName: name, contactName: '', phone: '', email: '', address: '', trade: 'General', licenseNumber: '',
  licenseExpiry: '', coiExpiry: '', w9OnFile: false, bidHistory: [], assignedProjects: [], notes: '',
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', ...extra,
});
// s1: a certificate a year out; s2: one lapsing in 10 days; s3: none on file; s4: a certificate that lapsed.
const SUBS: Subcontractor[] = [
  sub('s1', 'Brightline Electric', { trade: 'Electrical', licenseExpiry: dayFromNow(400), coiExpiry: dayFromNow(365), updatedAt: '2026-09-03T00:00:00.000Z' }),
  sub('s2', 'Cold Front HVAC', { trade: 'HVAC', licenseExpiry: dayFromNow(300), coiExpiry: dayFromNow(10), updatedAt: '2026-09-04T00:00:00.000Z' }),
  sub('s3', 'Stonecut Masonry', { trade: 'Concrete' }),
  sub('s4', 'Delta Roof', { trade: 'Roofing', licenseExpiry: dayFromNow(200), coiExpiry: dayFromNow(-5), updatedAt: '2026-09-02T00:00:00.000Z' }),
];
const COIS: CertificateOfInsurance[] = [
  { id: 'c1', subcontractorId: 's1', fileUri: '', uploadedAt: '2026-08-01T12:00:00.000Z', validation: { validatedAt: '2026-08-01', overallStatus: 'fail', issues: [{ code: 'ai', severity: 'critical', message: 'No additional insured.' }] }, coverages: [{ type: 'general_liability', expiresAt: dayFromNow(365) }] },
  { id: 'c2', subcontractorId: 's2', fileUri: '', uploadedAt: '2026-08-02T12:00:00.000Z', coverages: [{ type: 'general_liability', expiresAt: dayFromNow(10) }] },
  { id: 'c4', subcontractorId: 's4', fileUri: '', uploadedAt: '2026-08-03T12:00:00.000Z', coverages: [{ type: 'auto', expiresAt: dayFromNow(-5) }] },
];

function makeSplit(openId: string | null = null): SplitRecord {
  return { openId, open: jest.fn(), close: jest.fn(), inPlace: true };
}

function DirtyCard() {
  useRegisterRecordDirty(() => true);
  return <Text testID="dirty-card">GL-78 (unsaved)</Text>;
}

beforeEach(() => {
  alertMock.mockClear();
  (deliverTextFile as jest.Mock).mockClear();
  mockRouter.push.mockClear();
});

describe('COI Vault register (real DOM, 1512)', () => {
  function vault(props: Partial<React.ComponentProps<typeof CoiVaultRegister>> = {}) {
    return (
      <CoiVaultRegister
        subcontractors={SUBS}
        cois={COIS}
        split={makeSplit()}
        uploadButton={<Text testID="upload">Upload COI</Text>}
        detailBody={null}
        {...props}
      />
    );
  }

  it('rows are links to /coi-vault?subId=…, sorted by days left (soonest first, unknown last)', async () => {
    const { el } = await mount(vault());
    expect(byId(el, 'coi-vault-register')).not.toBeNull();
    expect(el.querySelector('a[href="/coi-vault?subId=s2"]')).not.toBeNull();
    const order = [...el.querySelectorAll('a[href^="/coi-vault?subId="]')].map((a) => a.getAttribute('href')!.split('=')[1]);
    expect(order).toEqual(['s4', 's2', 's1', 's3']);
  });

  it('a plain click opens the record beside the list (no page load)', async () => {
    const split = makeSplit();
    const { el } = await mount(vault({ split }));
    await click(byId(el, 'coi-vault-register-table-row-s2')!);
    expect(split.open).toHaveBeenCalledWith('s2');
    expect(alertMock.mock.calls.filter((c) => c[0] === 'Discard changes?')).toHaveLength(0);
  });

  it('the record pane: the check, the upload button and the certificates', async () => {
    const { el } = await mount(vault({ split: makeSplit('s1'), detailBody: <Text testID="certs">certs</Text> }));
    const strip = byId(el, 'coi-vault-record-strip');
    expect(strip?.textContent).toMatch(/Action required/i);
    expect(strip?.textContent).toContain('Certificates1');
    expect(byId(el, 'upload')).not.toBeNull();
    expect(byId(el, 'certs')).not.toBeNull();
  });

  it('j with an unsaved coverage row asks "Discard changes?" and opens nothing until Discard', async () => {
    const split = makeSplit('s2');
    const { el } = await mount(vault({ split, detailBody: <DirtyCard /> }));
    expect(byId(el, 'dirty-card')).not.toBeNull();
    await keydown(document.body, { key: 'j' });
    expect(split.open).not.toHaveBeenCalled();
    const [title, , buttons] = lastAlert();
    expect(title).toBe('Discard changes?');
    expect(buttons!.map((b) => b.text)).toEqual(['Keep editing', 'Discard']);
    await act(async () => { buttons![1].onPress?.(); });
    expect(split.open).toHaveBeenCalledWith('s1');
  });

  it('j with a clean record opens the next row in the order he sees', async () => {
    const split = makeSplit('s2');
    await mount(vault({ split, detailBody: <Text>clean</Text> }));
    await keydown(document.body, { key: 'j' });
    expect(alertMock.mock.calls.filter((c) => c[0] === 'Discard changes?')).toHaveLength(0);
    expect(split.open).toHaveBeenCalledWith('s1');
  });

  it("the chips count what the phone banner counts (coiSummary)", async () => {
    const { el } = await mount(vault());
    const sum = coiSummary(SUBS.map((s) => coiRegisterRow(s, COIS, new Date())));
    expect(sum).toEqual({ expired: 1, expiringSoon: 1, missing: 1 });
    expect(chipCount(el, 'coi-vault-register-chip-all')).toBe(4);
    expect(chipCount(el, 'coi-vault-register-chip-expired')).toBe(sum.expired);
    expect(chipCount(el, 'coi-vault-register-chip-expiring')).toBe(sum.expiringSoon);
    expect(chipCount(el, 'coi-vault-register-chip-missing')).toBe(sum.missing);
  });

  it('bulk Request renewal is disabled and says why', async () => {
    const { el } = await mount(vault());
    await click(byId(el, 'coi-vault-register-table-row-s2-check')!);
    await bulkButton(el, 'coi-vault-register-table', 'Request renewal');
    const [title, message] = lastAlert();
    expect(title).toBe('Request renewal');
    expect(message).toBe(COI_RENEWAL_REASON);
  });

  it('Export CSV names the file coi-vault-YYYY-MM-DD.csv (local day); unknown cells are empty', async () => {
    const { el } = await mount(vault());
    await click(byId(el, 'coi-vault-register-csv')!);
    const call = (deliverTextFile as jest.Mock).mock.calls[0];
    expect(call[0]).toBe(`coi-vault-${localDay(new Date())}.csv`);
    const lines = String(call[1]).split(/\r?\n/);
    expect(lines[0]).toContain('Sub,Trade,Check,Earliest expiry');
    expect(lines.join('\n')).not.toContain('—');
  });
});

describe('Subs register (real DOM, 1512)', () => {
  function subsReg(props: Partial<React.ComponentProps<typeof SubsRegister>> = {}) {
    return (
      <SubsRegister
        subcontractors={SUBS}
        commitments={[]}
        changeOrders={[]}
        punchItems={[]}
        projects={[]}
        rfis={[]}
        split={makeSplit()}
        detail={null}
        prequal={{ approved: 2, pending: 1 }}
        onNew={jest.fn()}
        onInvite={jest.fn()}
        {...props}
      />
    );
  }

  it('rows link to the sub (?subId=…) and a plain click opens it beside the list', async () => {
    const split = makeSplit();
    const { el } = await mount(subsReg({ split }));
    expect(el.querySelector('a[href*="subId=s2"]')).not.toBeNull();
    await click(byId(el, 'subs-register-table-row-s2')!);
    expect(split.open).toHaveBeenCalledWith('s2');
  });

  it("the chips equal the phone's stat cards (subStatusCounts)", async () => {
    const { el } = await mount(subsReg());
    const c = subStatusCounts(SUBS, Date.now());
    expect(chipCount(el, 'subs-register-chip-all')).toBe(SUBS.length);
    expect(chipCount(el, 'subs-register-chip-compliant')).toBe(c.compliant);
    expect(chipCount(el, 'subs-register-chip-expiring')).toBe(c.expiring);
    expect(chipCount(el, 'subs-register-chip-expired')).toBe(c.expired);
    expect(chipCount(el, 'subs-register-chip-unknown')).toBe(c.unknown);
    expect(c).toMatchObject({ compliant: 1, expiring: 1, expired: 1, unknown: 1 });
  });

  it('six toolbar actions, no launcher banners; Prequal names its numbers and routes', async () => {
    const { el } = await mount(subsReg());
    for (const id of ['subs-register-new', 'subs-register-invite', 'subs-register-prequal', 'subs-register-portals', 'subs-register-coi', 'subs-register-csv']) {
      expect(byId(el, id)).not.toBeNull();
    }
    expect(byId(el, 'subs-register-prequal')?.textContent).toContain('Prequal (2 approved · 1 pending)');
    expect(byId(el, 'open-prequal-manager')).toBeNull();
    await click(byId(el, 'subs-register-coi')!);
    expect(mockRouter.push).toHaveBeenCalledWith('/coi-vault');
  });

  it('bulk Delete is disabled and says why', async () => {
    const { el } = await mount(subsReg());
    await click(byId(el, 'subs-register-table-row-s1-check')!);
    await bulkButton(el, 'subs-register-table', 'Delete');
    const [title, message] = lastAlert();
    expect(title).toBe('Delete');
    expect(message).toBe(SUBS_BULK_DELETE_REASON);
  });

  it("'n' outside a field opens New", async () => {
    const onNew = jest.fn();
    await mount(subsReg({ onNew }));
    await keydown(document.body, { key: 'n' });
    expect(onNew).toHaveBeenCalledTimes(1);
  });
});
