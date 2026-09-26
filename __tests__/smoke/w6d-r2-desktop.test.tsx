/**
 * Wave 6d, lane R2 — Subs and the COI Vault as desktop-web REGISTERS, in the
 * real app (the provider stack, the populated fixture world plus three subs
 * and two certificates) at 1512 × 945 with useIsDesktopWeb() forced on.
 *
 * Behaviour, not pixels: the register mounts instead of the phone list, rows
 * are 36 px, a row click writes ?subId= and opens the record beside the list,
 * /coi-vault?subId= (today's deep link) opens beside the list instead of the
 * full-screen detail, the chip counts equal the phone's stat cards and
 * banner, the subs record shows the scorecard ABOVE AI Evaluate, Edit keeps
 * the record open under the form sheet, an unsaved coverage row holds the
 * record behind "Discard changes?", both disabled bulk actions say why, and
 * Export CSV names its file by the local day.
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';


// ── The layout gate: a width + a web flag, exactly like the app's hook ──────
let mockWidth = 390;
let mockHeight = 844;
let mockWeb = false;
jest.mock('@/utils/useResponsiveLayout', () => ({
  useResponsiveLayout: () => {
    const isDesktop = mockWidth >= 1024 || (mockWeb && mockWidth >= 900);
    const isTablet = !isDesktop && mockWidth >= 768;
    return {
      screenSize: isDesktop ? 'desktop' : isTablet ? 'tablet' : 'phone',
      isPhone: !isDesktop && !isTablet,
      isTablet,
      isDesktop,
      width: mockWidth,
      height: mockHeight,
      contentMaxWidth: isDesktop ? 1280 : isTablet ? 900 : mockWidth,
      sidebarWidth: isDesktop ? 240 : 0,
      showSidebar: isDesktop,
      ganttRowHeight: isDesktop ? 40 : isTablet ? 36 : 32,
    };
  },
}));

// useIsDesktopWeb() FORCED on at desktop width. RN-web cannot run a full route
// inside this native harness (app/_layout.tsx reads window.location), so the
// desktop-web cases keep Platform.OS native and force only this switch — the
// g-logs-phone-identical pattern.
jest.mock('@/components/ui/desktop', () => {
  const actual = jest.requireActual('@/components/ui/desktop');
  return { ...actual, useIsDesktopWeb: () => actual.useIsDesktop() };
});

// ── Environment ────────────────────────────────────────────────────────────
let restoreOS: (() => void) | null = null;
// 'web' here is the browser's LAYOUT gate (mockWeb: web >= 900 is desktop),
// with Platform.OS left native: a full route cannot mount on RN-web inside this
// harness (app/_layout.tsx reads window.location). useIsDesktopWeb() is false
// either way below 900, which is exactly what a 390 / 768 browser sees.
function env(os: 'ios' | 'android' | 'web', width: number, height: number) {
  restoreOS?.();
  const platform = os === 'web' ? 'ios' : os;
  restoreOS = platform === Platform.OS ? null : jest.replaceProperty(Platform, 'OS', platform).restore;
  mockWidth = width;
  mockHeight = height;
  mockWeb = os === 'web';
  Dimensions.set({
    window: { width, height, scale: 2, fontScale: 1 },
    screen: { width, height, scale: 2, fontScale: 1 },
  });
}

// Two clocks, both pinned (see w6c-field-phone for why the outer realm's
// Date.now — the one renderRouter's fake timers start from — is pinned too).
const NOW = new Date('2026-08-15T15:00:00.000Z').getTime();
const GOLDEN_CLOCK = new Date('2026-09-25T16:00:00.000Z').getTime();
// eslint-disable-next-line @typescript-eslint/no-require-imports
const outerFs = require('node:fs') as { readFileSync: { constructor: FunctionConstructor } };
const OuterDate = outerFs.readFileSync.constructor('return Date')() as DateConstructor;
let nowSpy: jest.SpyInstance | null = null;
let outerNowSpy: jest.SpyInstance | null = null;
beforeEach(() => {
  jest.useRealTimers();
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
  outerNowSpy = OuterDate === Date ? null : jest.spyOn(OuterDate, 'now').mockReturnValue(GOLDEN_CLOCK);
  allowConsoleErrors();
});
afterEach(() => {
  nowSpy?.mockRestore();
  nowSpy = null;
  outerNowSpy?.mockRestore();
  outerNowSpy = null;
  restoreOS?.();
  restoreOS = null;
});

const flat = (style: unknown): ViewStyle => (StyleSheet.flatten(style as StyleProp<ViewStyle>) ?? {}) as ViewStyle;

async function pump(n = 6) {
  for (let i = 0; i < n; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

// ── The same seeds as the phone golden (w6d-r2-phone) ──────────────────────
const S1 = 'sub-r2-1';
const S2 = 'sub-r2-2';
const S3 = 'sub-r2-3';
const subs = [
  { id: S1, companyName: 'Brightline Electric', contactName: 'Tomas Reyes', phone: '(555) 401-0001', email: 'tomas@brightline.test', address: '9 Volt Way', trade: 'Electrical', licenseNumber: 'EC-4410', licenseExpiry: '2027-06-30', coiExpiry: '2027-03-31', w9OnFile: true, bidHistory: [], assignedProjects: [], notes: 'Pulls permits himself.', createdAt: '2026-07-01T12:00:00.000Z', updatedAt: '2026-08-10T12:00:00.000Z' },
  { id: S2, companyName: 'Cold Front HVAC', contactName: 'Priya Shah', phone: '', email: 'priya@coldfront.test', address: '', trade: 'HVAC', licenseNumber: '', licenseExpiry: '2027-01-15', coiExpiry: '2026-08-25', w9OnFile: false, bidHistory: [], assignedProjects: [], notes: '', createdAt: '2026-07-02T12:00:00.000Z', updatedAt: '2026-08-09T12:00:00.000Z' },
  { id: S3, companyName: 'Stonecut Masonry', contactName: '', phone: '(555) 401-0003', email: '', address: '', trade: 'Concrete', licenseNumber: '', licenseExpiry: '', coiExpiry: '', w9OnFile: false, bidHistory: [], assignedProjects: [], notes: '', createdAt: '2026-07-03T12:00:00.000Z', updatedAt: '2026-08-08T12:00:00.000Z' },
];
const cois = [
  {
    id: 'coi-r2-1', subcontractorId: S1, fileUri: '', uploadedAt: '2026-08-01T12:00:00.000Z',
    validation: {
      validatedAt: '2026-08-01T12:05:00.000Z', overallStatus: 'fail', confidence: 82,
      issues: [
        { code: 'additional_insured_missing', severity: 'critical', message: 'Additional insured endorsement is missing.' },
        { code: 'waiver_subrogation_missing', severity: 'warning', message: 'No waiver of subrogation.' },
      ],
    },
    coverages: [
      { type: 'general_liability', carrierName: 'Harbor Mutual', policyNumber: 'GL-77', effectiveDate: '2026-04-01', expiresAt: '2027-03-31', source: 'manual' },
      { type: 'workers_comp', carrierName: 'Harbor Mutual', policyNumber: 'WC-12', expiresAt: '2027-04-30', source: 'manual' },
    ],
  },
  {
    id: 'coi-r2-2', subcontractorId: S2, fileUri: '', uploadedAt: '2026-07-20T12:00:00.000Z',
    coverages: [{ type: 'general_liability', carrierName: 'Tri-County Ins.', policyNumber: 'P-9', expiresAt: '2026-08-25', source: 'manual' }],
  },
];

async function seed() {
  await AsyncStorage.setItem('mageid_subcontractors', JSON.stringify(subs));
  await AsyncStorage.setItem('mageid_cois', JSON.stringify(cois));
}

async function at(width: number, height: number, url: string) {
  env('ios', width, height);
  await primeWorld('populated');
  await seed();
  const tree = await mountRouteChecked(url);
  await pump();
  return tree;
}
const desk = (url: string) => at(1512, 945, url);

type Btn = { text: string; style?: string; onPress?: () => void };
function alertSpy() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const alertMod = require('@/utils/alert') as typeof import('@/utils/alert');
  return jest.spyOn(alertMod, 'showAlert').mockImplementation(() => undefined);
}
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

type J = { type: string; props: Record<string, unknown>; children: (J | string)[] | null };
function textOf(n: J | string | null | undefined): string {
  if (n == null) return '';
  if (typeof n === 'string') return n;
  return (n.children ?? []).map(textOf).join('');
}
function walk(n: unknown, visit: (j: J) => void): void {
  if (!n) return;
  if (Array.isArray(n)) { n.forEach((x) => walk(x, visit)); return; }
  if (typeof n !== 'object') return;
  const j = n as J;
  visit(j);
  (j.children ?? []).forEach((c) => walk(c, visit));
}
/** The phone stat cards: a View whose two Text children read `<n>` then `<label>`. */
function phoneStatCards(json: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  walk(json, (j) => {
    const kids = (j.children ?? []).filter((c): c is J => typeof c === 'object' && c !== null);
    if (j.type === 'View' && kids.length === 2 && kids.every((k) => k.type === 'Text')) {
      const n = textOf(kids[0]);
      const label = textOf(kids[1]);
      if (/^\d+$/.test(n) && ['Compliant', 'Expiring', 'Expired', 'No docs'].includes(label)) out[label] = Number(n);
    }
  });
  return out;
}
/** Every testID in document order. */
function testIdsInOrder(json: unknown): string[] {
  const ids: string[] = [];
  walk(json, (j) => { if (typeof j.props?.testID === 'string') ids.push(j.props.testID as string); });
  return ids;
}
const chipCount = (id: string): number | null => {
  const t = textOf(screen.getByTestId(id) as unknown as J);
  const m = t.match(/(\d+)$/);
  return m ? Number(m[1]) : null;
};

describe('lane R2 — Subs register, desktop web 1512', () => {
  jest.setTimeout(120000);

  it('mounts the register (no phone banners, stats or search), rows are 36 px, six toolbar actions', async () => {
    await desk('/subs');
    expect(screen.getByTestId('subs-register')).toBeTruthy();
    expect(screen.getByTestId('subs-register-table')).toBeTruthy();
    expect(screen.queryByTestId('subs-search')).toBeNull();
    expect(screen.queryByTestId('open-prequal-manager')).toBeNull();
    expect(screen.queryByTestId('open-coi-vault')).toBeNull();
    expect(flat(screen.getByTestId(`subs-register-table-row-${S1}`).props.style).minHeight).toBe(36);
    for (const id of ['subs-register-new', 'subs-register-invite', 'subs-register-prequal', 'subs-register-portals', 'subs-register-coi', 'subs-register-csv']) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    expect(screen.getAllByText('Prequal (0 approved · 0 pending)').length).toBeGreaterThan(0);
  });

  // Read on the phone first (one mount per test), then compared on desktop.
  let cards: Record<string, number> = {};
  it("the phone's stat cards (390, the same seeds)", async () => {
    const phone = await at(390, 844, '/subs');
    cards = phoneStatCards(phone.toJSON());
    // Whatever day the app's clock reads, the four cards are all there (the
    // seeds cover a clear, a dated and an undated sub).
    expect(Object.keys(cards).sort()).toEqual(['Compliant', 'Expired', 'Expiring', 'No docs']);
    expect(cards.Compliant + cards.Expiring + cards.Expired + cards['No docs']).toBe(3);
  });

  it("the chip counts equal the phone's stat cards", async () => {
    expect(Object.keys(cards)).toHaveLength(4);
    await desk('/subs');
    expect(chipCount('subs-register-chip-all')).toBe(3);
    expect(chipCount('subs-register-chip-compliant')).toBe(cards.Compliant);
    expect(chipCount('subs-register-chip-expiring')).toBe(cards.Expiring);
    expect(chipCount('subs-register-chip-expired')).toBe(cards.Expired);
    expect(chipCount('subs-register-chip-unknown')).toBe(cards['No docs']);
    expect(chipCount('subs-register-chip-trade:Electrical')).toBe(1);
  });

  it('a row click writes ?subId= and opens the record beside the list — scorecard ABOVE AI Evaluate', async () => {
    const tree = await desk('/subs');
    await act(async () => { fireEvent.press(screen.getByTestId(`subs-register-table-row-${S1}`)); });
    await pump(3);
    expect(tree.getSearchParams()).toMatchObject({ subId: S1 });
    expect(screen.getByTestId('subs-register-record')).toBeTruthy();
    // Exactly one detail body: the pane's (the sheet never opens on desktop web).
    expect(screen.getAllByTestId('sub-detail-scorecard')).toHaveLength(1);
    // Document order: the scorecard row, then the AI panel's trigger.
    const marks: string[] = [];
    walk(tree.toJSON(), (j) => {
      if (j.props?.testID === 'sub-detail-scorecard') marks.push('scorecard');
      if (j.type === 'Text' && textOf(j) === 'AI Evaluate Sub') marks.push('ai');
    });
    expect(marks).toEqual(['scorecard', 'ai']);
  });

  it('?subId= opens that sub on arrival', async () => {
    await desk(`/subs?subId=${S2}`);
    expect(screen.getByTestId('subs-register-record')).toBeTruthy();
    expect(screen.getAllByText('priya@coldfront.test').length).toBeGreaterThan(0);
  });

  it('Edit opens the form sheet with the record still open under it', async () => {
    const tree = await desk(`/subs?subId=${S1}`);
    await act(async () => { fireEvent.press(screen.getByText('Edit')); });
    await pump(3);
    expect(screen.getByTestId('save-sub')).toBeTruthy();
    expect(screen.getByDisplayValue('Brightline Electric')).toBeTruthy();
    expect(tree.getSearchParams()).toMatchObject({ subId: S1 });
    expect(screen.getByTestId('subs-register-record')).toBeTruthy();
  });

  it('bulk Delete is disabled and says why', async () => {
    const spy = alertSpy();
    try {
      await desk('/subs');
      await act(async () => { fireEvent.press(screen.getByTestId(`subs-register-table-row-${S1}-check`)); });
      await pump(2);
      await act(async () => { fireEvent.press(screen.getByText('Delete')); });
      expect(spy).toHaveBeenCalledWith('Delete', 'Delete subs one at a time — each is checked for payments on record so the 1099 export keeps his TIN and address.');
      expect(screen.getByTestId(`subs-register-table-row-${S1}`)).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });

  it('Export CSV names the file subs-YYYY-MM-DD.csv on the local day', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pf = require('@/utils/platformFile') as typeof import('@/utils/platformFile');
    const spy = jest.spyOn(pf, 'deliverTextFile').mockResolvedValue(undefined as never);
    try {
      await desk('/subs');
      await act(async () => { fireEvent.press(screen.getByTestId('subs-register-csv')); });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toBe(`subs-${localDay(new Date())}.csv`);
      expect(String(spy.mock.calls[0][1]).split(/\r?\n/)[0]).toContain('Company,Trade,Compliance,COI expiry');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('lane R2 — COI Vault register, desktop web 1512', () => {
  jest.setTimeout(120000);

  it('mounts the register (no FeatureHeader or banner), rows are 36 px, sorted by days left', async () => {
    const tree = await desk('/coi-vault');
    expect(screen.getByTestId('coi-vault-register')).toBeTruthy();
    expect(screen.queryByTestId(`coi-sub-${S1}`)).toBeNull();
    expect(screen.queryByText('Make sure your subs are insured')).toBeNull();
    expect(flat(screen.getByTestId(`coi-vault-register-table-row-${S1}`).props.style).minHeight).toBe(36);
    // S2 (10 days) before S1 (2027), and S3 (no expiry) last.
    const rows = testIdsInOrder(tree.toJSON()).filter((id) => /^coi-vault-register-table-row-sub-r2-\d$/.test(id));
    expect(rows).toEqual([S2, S1, S3].map((id) => `coi-vault-register-table-row-${id}`));
  });

  // Read on the phone first (one mount per test), then compared on desktop.
  let banner = { expired: -1, expiring: -1, missing: -1 };
  it("the phone's banner (390, the same seeds)", async () => {
    await at(390, 844, '/coi-vault');
    // The phone banner's pills ("N expired", "N expiring <30d", "N no COI on
    // file"); a pill that is not shown is 0.
    const pill = (re: RegExp): number => {
      const hit = screen.queryAllByText(re)[0];
      return hit ? Number(textOf(hit as unknown as J).match(/^(\d+)/)![1]) : 0;
    };
    banner = { expired: pill(/^\d+ expired$/), expiring: pill(/^\d+ expiring <30d$/), missing: pill(/^\d+ no COI on file$/) };
    expect(banner.missing).toBe(1);
    expect(banner.expired + banner.expiring).toBe(1);
  });

  it("the chip counts equal the phone's banner", async () => {
    expect(banner.missing).toBe(1);
    await desk('/coi-vault');
    expect(chipCount('coi-vault-register-chip-all')).toBe(3);
    expect(chipCount('coi-vault-register-chip-expiring')).toBe(banner.expiring);
    expect(chipCount('coi-vault-register-chip-missing')).toBe(banner.missing);
    expect(chipCount('coi-vault-register-chip-expired')).toBe(banner.expired);
  });

  it('/coi-vault?subId= opens beside the list (not the full-screen detail)', async () => {
    await desk(`/coi-vault?subId=${S1}`);
    expect(screen.getByTestId('coi-vault-register-record')).toBeTruthy();
    expect(screen.getByTestId('coi-vault-record-strip')).toBeTruthy();
    expect(screen.getAllByTestId('coi-upload')).toHaveLength(1);
    expect(screen.getAllByTestId('coi-coverages')).toHaveLength(1);
    expect(screen.queryByText('All subs')).toBeNull();
    expect(screen.getAllByText('Action required').length).toBeGreaterThan(0);
  });

  it('an unsaved coverage row holds the record: another row asks "Discard changes?" first', async () => {
    const spy = alertSpy();
    try {
      const tree = await desk(`/coi-vault?subId=${S1}`);
      await act(async () => { fireEvent.changeText(screen.getByDisplayValue('GL-77'), 'GL-78'); });
      await pump(2);
      await act(async () => { fireEvent.press(screen.getByTestId(`coi-vault-register-table-row-${S2}`)); });
      await pump(2);
      const asks = spy.mock.calls.filter((c) => c[0] === 'Discard changes?');
      expect(asks).toHaveLength(1);
      expect(tree.getSearchParams()).toMatchObject({ subId: S1 });
      await act(async () => { (asks[0][2] as Btn[])[1].onPress?.(); });
      await pump(3);
      expect(tree.getSearchParams()).toMatchObject({ subId: S2 });
    } finally {
      spy.mockRestore();
    }
  });

  it('a clean record opens the next row with no question', async () => {
    const spy = alertSpy();
    try {
      const tree = await desk(`/coi-vault?subId=${S1}`);
      await act(async () => { fireEvent.press(screen.getByTestId(`coi-vault-register-table-row-${S2}`)); });
      await pump(2);
      expect(spy.mock.calls.filter((c) => c[0] === 'Discard changes?')).toHaveLength(0);
      expect(tree.getSearchParams()).toMatchObject({ subId: S2 });
    } finally {
      spy.mockRestore();
    }
  });

  it('bulk Request renewal is disabled and says why', async () => {
    const spy = alertSpy();
    try {
      await desk('/coi-vault');
      await act(async () => { fireEvent.press(screen.getByTestId(`coi-vault-register-table-row-${S1}-check`)); });
      await pump(2);
      await act(async () => { fireEvent.press(screen.getByText('Request renewal')); });
      expect(spy).toHaveBeenCalledWith('Request renewal', 'MAGE ID can’t send a renewal request to a sub yet — you get an email 30, 14 and 7 days before a COI lapses, and on the day it does. Call or email the sub from Subs.');
    } finally {
      spy.mockRestore();
    }
  });

  it('Export CSV names the file coi-vault-YYYY-MM-DD.csv on the local day', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pf = require('@/utils/platformFile') as typeof import('@/utils/platformFile');
    const spy = jest.spyOn(pf, 'deliverTextFile').mockResolvedValue(undefined as never);
    try {
      await desk('/coi-vault');
      await act(async () => { fireEvent.press(screen.getByTestId('coi-vault-register-csv')); });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toBe(`coi-vault-${localDay(new Date())}.csv`);
    } finally {
      spy.mockRestore();
    }
  });
});
