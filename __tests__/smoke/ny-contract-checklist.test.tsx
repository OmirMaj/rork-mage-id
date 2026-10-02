/**
 * The New York home improvement contract checklist (lane NYCHECK).
 *
 * THE PROMISES THIS PROVES
 *   Goldens (the card alone, phone layout):
 *     1. a default draft in Brooklyn: open, "4 missing · 2 to check", the
 *        lien / escrow / three-day cancel / contingencies rows missing and the
 *        insurance and materials rows "check it", counsel marks on seven rows;
 *     2. 'maybe': no state on the jobsite, a New York contractor, so the card
 *        says why before the list;
 *     3. everything found or "check it": collapsed to its summary line, the
 *        disclaimer still visible, a tap opens the list.
 *     A New Jersey jobsite renders nothing.
 *   The real /contract screen (the populated fixture world, phone):
 *     - a New York draft shows the card above the action bar; Sign together
 *       now with items missing raises the warning instead of the pad;
 *       "Review the list" signs nothing; "Continue" opens the pad (the same
 *       press, same mode), and a second press is not warned again;
 *     - Sign & send warns the same way;
 *     - the fixture's Portland draft never shows the card or the warning.
 */

import React from 'react';
import { Alert, Dimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, type RenderAPI } from '@testing-library/react-native';
import type { AlertButton } from 'react-native';
import type { CompanyBranding, Project, ProjectContract } from '@/types';
import { NyContractChecklist } from '@/components/contract/NyContractChecklist';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID, world } from '@/__tests__/fixtures/world';
import { contractWarrantyText } from '@/utils/paymentTerms';

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
    useTheme: () => value,
  };
});
let mockDesktop = false;
jest.mock('@/utils/useResponsiveLayout', () => ({
  useResponsiveLayout: () => ({
    screenSize: mockDesktop ? 'desktop' : 'phone', isPhone: !mockDesktop, isTablet: false, isDesktop: mockDesktop,
    width: mockDesktop ? 1512 : 390, height: mockDesktop ? 945 : 844, contentMaxWidth: mockDesktop ? 1200 : 390,
    sidebarWidth: 0, showSidebar: false, ganttRowHeight: 32,
  }),
}));
jest.mock('@/components/moments/core/useScreenReaderMode', () => ({ useScreenReaderMode: () => true }));
jest.mock('@/utils/moments/haptics', () => ({ momentHaptic: jest.fn(), announce: jest.fn() }));

// The screen reads its contract from the server; serve the one each test names.
let mockActive: ProjectContract | null = null;
jest.mock('@/utils/contractEngine', () => {
  const actual = jest.requireActual('@/utils/contractEngine');
  return { ...actual, loadActiveContract: jest.fn(async () => ({ ok: true, contract: mockActive })) };
});
const { buildDraftContract } = jest.requireActual('@/utils/contractEngine') as typeof import('@/utils/contractEngine');

const BRANDING: CompanyBranding = {
  companyName: 'Park Slope Builders', contactName: 'Dana Ruiz', email: 'dana@example.test',
  phone: '(718) 555-0100', address: '55 Water St, Brooklyn, NY 11201', licenseNumber: 'DCWP 2091234',
} as CompanyBranding;
const BROOKLYN = { id: 'p-ny', name: 'Kitchen remodel', type: 'renovation', location: '124 Park Pl, Brooklyn, NY 11217' } as Project;

function nyDraft(over: Partial<ProjectContract> = {}): ProjectContract {
  const base = buildDraftContract({ project: { ...world.project, location: BROOKLYN.location }, terms: { split: null, warrantyMonths: 12 } as never });
  return {
    ...base,
    id: 'contract-ny', userId: world.user.id, projectId: PROJECT_ID,
    contractValue: 48500, startDate: '2026-11-02', durationDays: 45,
    scopeText: 'Gut and rebuild the kitchen: cabinets, counters, tile, electrical and plumbing rough-in.',
    warrantyText: contractWarrantyText(12),
    paymentSchedule: [
      { id: 'm1', label: 'Deposit', trigger: 'on_signing', amount: 4850, status: 'pending' },
      { id: 'm2', label: 'Rough-in', trigger: 'on_milestone', amount: 24250, status: 'pending' },
      { id: 'm3', label: 'Completion', trigger: 'on_final', amount: 19400, status: 'pending' },
    ],
    allowances: [], status: 'draft',
    createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z',
    ...over,
  } as ProjectContract;
}
const LOADED_TERMS = (t: string) => `${t}
11. LIEN NOTICE. Subcontractors and material suppliers who are not paid may file a mechanic's lien.
12. ESCROW. Payments received before substantial completion are held in an escrow account.
13. CANCELLATION. The Owner may cancel this contract until midnight of the third business day after signing.
14. DELAYS. Completion may be delayed by weather or unforeseen conditions.`;

const IDS = ['a-name', 'a-address', 'a-phone', 'a-licence', 'b-dates', 'b-contingencies', 'c-scope', 'c-materials', 'c-price', 'd-lien', 'e-escrow', 'f-schedule', 'h-cancel', 'i-insurance'];
const textOf = (r: RenderAPI, id: string) => {
  const el = r.queryByTestId(id);
  if (!el) return null;
  const parts: string[] = [];
  const walk = (n: unknown) => {
    if (typeof n === 'string') parts.push(n);
    else if (n && typeof n === 'object' && 'children' in (n as object)) ((n as { children: unknown[] }).children ?? []).forEach(walk);
  };
  walk(el);
  return parts.join(' | ');
};
/** The golden dump: summary, maybe line, every row's words, the disclaimer. */
function dump(r: RenderAPI): string[] {
  const out = [`summary: ${textOf(r, 'contract-ny-summary')}`];
  const maybe = textOf(r, 'contract-ny-maybe');
  if (maybe) out.push(`maybe: ${maybe}`);
  for (const id of IDS) { const row = textOf(r, `contract-ny-item-${id}`); if (row) out.push(`${id}: ${row}`); }
  out.push(`disclaimer: ${textOf(r, 'contract-ny-disclaimer')}`);
  return out;
}

const C = 'To be confirmed by counsel';
const P = 'Printed from your company profile.';
const GOLDEN_BROOKLYN = [
  'summary: 4 missing · 2 to check',
  `a-name: Your company name | Found | ${P} | GBL § 771(1)(a)`,
  `a-address: Your business address | Found | ${P} | GBL § 771(1)(a)`,
  `a-phone: Your phone number | Found | ${P} | GBL § 771(1)(a)`,
  `a-licence: Your license number, if one is required | Found | New York City and some counties license home improvement contractors. | ${C} | GBL § 771(1)(a)`,
  'b-dates: Start date and substantial completion date | Found | Set a start date and a duration on this contract. | GBL § 771(1)(b)',
  `b-contingencies: What could change the completion date | Missing | Say what could delay the work. | ${C} | GBL § 771(1)(b)`,
  'c-scope: A description of the work | Found | Write the scope above. | GBL § 771(1)(c)',
  `c-materials: Materials, with make and model | Found wording, check it | Name the make and model of materials you supply. | ${C} | GBL § 771(1)(c)`,
  'c-price: The agreed price | Found | Set the contract value. | GBL § 771(1)(c)',
  `d-lien: Mechanic’s lien notice | Missing | A notice to the owner about liens if subs or suppliers go unpaid. Add this notice in your contract terms. | ${C} | GBL § 771(1)(d)`,
  `e-escrow: Escrow notice for payments before completion | Missing | How payments received before the work is done are held. Add this notice in your contract terms. | ${C} | GBL § 771(1)(e)`,
  'f-schedule: Progress payment schedule | Found | Amounts tied to stages of the work. | GBL § 771(1)(f)',
  `h-cancel: Three-day right to cancel | Missing | The owner may cancel until midnight of the third business day after signing. Add this notice in your contract terms. | ${C} | GBL § 771(1)(h)`,
  `i-insurance: Insurance disclosure | Found wording, check it | Your insurance details, as the law asks. Found wording. Check it with your counsel. | ${C} | GBL § 771(1)(i)`,
  'disclaimer: This is a checklist, not legal advice.',
];

async function pump(n = 4) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      try { jest.advanceTimersByTime(250); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}
const NY_TITLE = 'Some New York items are missing';
const nyCalls = (spy: jest.SpyInstance) => spy.mock.calls.filter((c) => c[0] === NY_TITLE);
const buttonsOf = (call: unknown[]) => call[2] as AlertButton[];

describe('the sign gate on the real contract screen', () => {
  jest.setTimeout(120000);
  let alertSpy: jest.SpyInstance;
  beforeEach(() => {
    jest.useRealTimers();
    allowConsoleErrors();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    Dimensions.set({ window: { width: 390, height: 844, scale: 2, fontScale: 1 }, screen: { width: 390, height: 844, scale: 2, fontScale: 1 } });
  });
  afterEach(() => { alertSpy.mockRestore(); mockActive = null; mockDesktop = false; });

  it('a New York draft warns once, "Review the list" signs nothing, "Continue" opens the pad; Portland never warns; the card renders its three goldens', async () => {
    // ── New York ──
    await primeWorld('populated');
    await AsyncStorage.setItem('mageid_projects', JSON.stringify([{ ...world.project, location: '124 Park Pl, Brooklyn, NY 11217' }]));
    mockActive = nyDraft();
    const ny = await mountRouteChecked(`/contract?projectId=${PROJECT_ID}`);
    for (let i = 0; i < 40 && !screen.queryByTestId('contract-sign-together'); i++) await pump(1);
    expect(screen.getByTestId('contract-ny-checklist')).toBeTruthy();
    expect(screen.getByTestId('contract-ny-disclaimer')).toBeTruthy();
    // Portland branding: name, address, phone, licence found; the four notices + contingencies read as before.
    expect(textOf(ny as unknown as RenderAPI, 'contract-ny-summary')).toBe('4 missing · 2 to check');

    // Sign together now → the warning, not the pad.
    await act(async () => { fireEvent.press(screen.getByTestId('contract-sign-together')); });
    await pump(2);
    expect(nyCalls(alertSpy)).toHaveLength(1);
    const first = nyCalls(alertSpy)[0];
    expect(first[1]).toBe('4 items on the New York checklist are missing. You can still send it.');
    expect(buttonsOf(first).map((b) => b.text)).toEqual(['Review the list', 'Continue']);
    expect(screen.queryByTestId('contract-sign-sheet')).toBeNull();

    // "Review the list": nothing signs, the card stays open.
    await act(async () => { buttonsOf(first)[0].onPress?.(); });
    await pump(2);
    expect(screen.queryByTestId('contract-sign-sheet')).toBeNull();
    expect(screen.getByTestId('contract-ny-item-d-lien')).toBeTruthy();

    // Press again, "Continue": the pad opens, the same press.
    await act(async () => { fireEvent.press(screen.getByTestId('contract-sign-together')); });
    await pump(2);
    expect(nyCalls(alertSpy)).toHaveLength(2);
    await act(async () => { buttonsOf(nyCalls(alertSpy)[1])[1].onPress?.(); });
    for (let i = 0; i < 10 && !screen.queryByTestId('contract-sign-sheet'); i++) await pump(1);
    expect(screen.getByTestId('contract-sign-sheet')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('contract-sign-cancel')); });
    await pump(2);

    // Acknowledged for this contract: Sign & send is not warned again.
    alertSpy.mockClear();
    await act(async () => { fireEvent.press(screen.getByText('Sign & send')); });
    await pump(2);
    expect(nyCalls(alertSpy)).toHaveLength(0);
    ny.unmount();

    // ── Sign & send on a fresh mount warns the same way ──
    alertSpy.mockClear();
    await primeWorld('populated');
    await AsyncStorage.setItem('mageid_projects', JSON.stringify([{ ...world.project, location: '124 Park Pl, Brooklyn, NY 11217' }]));
    mockActive = nyDraft();
    const ny2 = await mountRouteChecked(`/contract?projectId=${PROJECT_ID}`);
    for (let i = 0; i < 40 && !screen.queryByTestId('contract-sign-together'); i++) await pump(1);
    await act(async () => { fireEvent.press(screen.getByText('Sign & send')); });
    await pump(2);
    expect(nyCalls(alertSpy)).toHaveLength(1);
    expect(screen.queryByTestId('contract-sign-sheet')).toBeNull();
    ny2.unmount();

    // ── Portland (the fixture as it is): no card, no warning, the pad opens ──
    alertSpy.mockClear();
    await primeWorld('populated');
    mockActive = nyDraft();
    const pdx = await mountRouteChecked(`/contract?projectId=${PROJECT_ID}`);
    for (let i = 0; i < 40 && !screen.queryByTestId('contract-sign-together'); i++) await pump(1);
    expect(screen.queryByTestId('contract-ny-checklist')).toBeNull();
    await act(async () => { fireEvent.press(screen.getByTestId('contract-sign-together')); });
    for (let i = 0; i < 10 && !screen.queryByTestId('contract-sign-sheet'); i++) await pump(1);
    expect(nyCalls(alertSpy)).toHaveLength(0);
    expect(screen.getByTestId('contract-sign-sheet')).toBeTruthy();
    pdx.unmount();

    // ── The card alone: the three goldens ──
    // ONE test on purpose (as in moments-sites-signing.test.tsx): a second
    // \`it\` after the first one's cleanup never commits its first render here.
    goldens();
  });
});

function goldens(): void {
  {
    // (1) the default draft in Brooklyn: missing + check rows, open.
    const g1 = render(<NyContractChecklist project={BROOKLYN} contract={nyDraft()} branding={BRANDING} />);
    expect(g1.getByTestId('contract-ny-checklist')).toBeTruthy();
    expect(dump(g1)).toEqual(GOLDEN_BROOKLYN);
    expect(g1.getByText('Give the owner a signed copy before work starts.')).toBeTruthy();
    // Every citation chip opens the § 771 page.
    expect(g1.getAllByText(/^GBL § 771\(1\)\([a-i]\)$/)).toHaveLength(14);
    g1.unmount();

    // A missing profile item offers the company profile.
    const onOpenProfile = jest.fn();
    const g1b = render(<NyContractChecklist project={BROOKLYN} contract={nyDraft()} branding={{ ...BRANDING, phone: '' }} onOpenProfile={onOpenProfile} />);
    expect(textOf(g1b, 'contract-ny-item-a-phone')).toBe('Your phone number | Missing | Add it in your company profile. | Open company profile | GBL § 771(1)(a)');
    fireEvent.press(g1b.getByTestId('contract-ny-profile-a-phone'));
    expect(onOpenProfile).toHaveBeenCalledTimes(1);
    g1b.unmount();

    // (2) 'maybe': no state on the jobsite, a New York contractor.
    const g2 = render(<NyContractChecklist project={{ ...BROOKLYN, location: 'Kitchen job' }} contract={nyDraft()} branding={{ ...BRANDING, licenseState: 'NY' }} />);
    expect(dump(g2).slice(0, 2)).toEqual([
      'summary: 4 missing · 2 to check',
      "maybe: The jobsite address has no state. If the jobsite is in New York, this list applies.",
    ]);
    g2.unmount();
    const g2b = render(<NyContractChecklist project={{ ...BROOKLYN, type: 'new_build' }} contract={nyDraft()} branding={BRANDING} />);
    expect(textOf(g2b, 'contract-ny-maybe')).toBe('New York’s rule covers work on existing homes. It may not apply to building a new home.');
    g2b.unmount();
    const g2c = render(<NyContractChecklist project={BROOKLYN} contract={nyDraft({ contractValue: 500 })} branding={BRANDING} />);
    expect(textOf(g2c, 'contract-ny-maybe')).toBe('New York’s rule covers contracts over $500 with the same owner. Check whether this project counts.');
    g2c.unmount();

    // (3) everything found or "check it": collapsed, disclaimer still there.
    const loaded = nyDraft();
    const g3 = render(<NyContractChecklist project={BROOKLYN} contract={{ ...loaded, termsText: LOADED_TERMS(loaded.termsText) }} branding={BRANDING} />);
    expect(dump(g3)).toEqual([
      'summary: Nothing missing. Check the flagged items with your counsel.',
      'disclaimer: This is a checklist, not legal advice.',
    ]);
    fireEvent.press(g3.getByTestId('contract-ny-toggle'));
    const open = dump(g3);
    expect(open).toHaveLength(16);
    expect(open.filter((l) => / \| Missing \| /.test(l))).toEqual([]);
    expect(open.find((l) => l.startsWith('d-lien:'))).toContain('| Found wording, check it |');
    g3.unmount();

    // Desktop: the same rows, the chip on the row's right (still one per row).
    mockDesktop = true;
    const gd = render(<NyContractChecklist project={BROOKLYN} contract={nyDraft()} branding={BRANDING} />);
    expect(dump(gd)).toEqual(GOLDEN_BROOKLYN);
    gd.unmount();
    mockDesktop = false;

    // Outside New York: nothing at all.
    const nj = render(<NyContractChecklist project={{ ...BROOKLYN, location: '12 Main St, Montclair, NJ 07042' }} contract={nyDraft()} branding={BRANDING} />);
    expect(nj.queryByTestId('contract-ny-checklist')).toBeNull();
    nj.unmount();
    const commercial = render(<NyContractChecklist project={{ ...BROOKLYN, type: 'commercial' }} contract={nyDraft()} branding={BRANDING} />);
    expect(commercial.queryByTestId('contract-ny-checklist')).toBeNull();
    commercial.unmount();
  }
}
