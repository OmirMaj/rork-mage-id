/**
 * Q4 — client financing, as the homeowner and the GC actually see it.
 *
 * THE FOUNDER: "STRIPE SETUP/CLIENT FINANCING". The investigation found the
 * portal "Finance this project" button could never appear for a homeowner:
 * app/client-view.tsx decided it from `useProjects().settings` — the VIEWER's
 * settings — and a homeowner's settings never carry the GC's financing. The
 * decision now travels in the portal snapshot (`financing`, built from the
 * GC's own settings by utils/financingCore.portalFinancingBlock).
 *
 * GOLDENS. __tests__/fixtures/q4-client-view-goldens.json was recorded from
 * the UNTOUCHED screen (RECORD_Q4_GOLDENS=1 before the change). With financing
 * OFF, both the GC's own preview and the homeowner's snapshot view must render
 * byte-identical to it: this change adds a button, it moves nothing else.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { world } from '@/__tests__/fixtures/world';
import { buildPortalSnapshot, type PortalSnapshot } from '@/utils/portalSnapshot';
import type { AppSettings } from '@/types';

// The homeowner's device resolves the snapshot over the network
// (portal_get_snapshot_v2). Stand in for that one hook — everything else is
// the real app tree.
let mockSnapshot: PortalSnapshot | null = null;
jest.mock('@/hooks/usePortalSnapshot', () => {
  const actual = jest.requireActual('@/hooks/usePortalSnapshot');
  return {
    ...actual,
    usePortalSnapshot: (_id: string | undefined, opts: { enabled: boolean }) => (
      opts.enabled && mockSnapshot
        ? { status: 'ready', snapshot: mockSnapshot, fromHash: false, expiresAt: null, reload: () => {} }
        : { status: 'idle', snapshot: null, fromHash: false, expiresAt: null, reload: () => {} }
    ),
  };
});

const GOLDEN = join(__dirname, '..', 'fixtures', 'q4-client-view-goldens.json');
const RECORD = process.env.RECORD_Q4_GOLDENS === '1';

const SNAP_PORTAL = 'q4-snapshot-portal';
const SNAP_TOKEN = 'q4-homeowner-access-token';

const FINANCING_ON: NonNullable<AppSettings['financing']> = {
  enabled: true,
  partnerName: 'Acme Home Loans',
  prequalBaseUrl: 'https://acme.example/prequal',
  gcRefCode: 'GC-42',
  updatedAt: '2026-09-24T00:00:00.000Z',
};

function collectText(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach(n => collectText(n, out)); return out; }
  const children = (node as { children?: unknown }).children;
  if (children) collectText(children, out);
  return out;
}
const flat = (tree: { toJSON: () => unknown }) => collectText(tree.toJSON()).join('\n');
// The GC preview prints "Last updated <wall-clock time>" — the only part of
// the page that is not a function of the fixture.
const norm = (s: string | undefined) => (s ?? '').replace(/\b\d{1,2}:\d{2}\s?[AP]M\b/g, '<time>');

function snapshotFor(settings: AppSettings): PortalSnapshot {
  const snap = buildPortalSnapshot({
    project: world.project,
    portal: world.project.clientPortal!,
    settings,
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon-key',
  });
  return { ...snap, snapshotAt: '2026-09-24T12:00:00.000Z' };
}

async function mountLocalPreview(financing?: AppSettings['financing']) {
  mockSnapshot = null;
  await primeWorld('populated');
  if (financing) {
    await AsyncStorage.setItem('mageid_settings', JSON.stringify({ ...world.settings, financing }));
  }
  return mountRouteChecked(`/client-view?portalId=${encodeURIComponent(world.portalId)}`);
}

async function mountHomeowner(snapshot: PortalSnapshot) {
  mockSnapshot = snapshot;
  // Signed in as the smoke contractor, but NOT the GC who owns this portal —
  // exactly the case the old code got wrong: the viewer's own settings say
  // nothing about the GC's financing, so they must not decide the button.
  await primeWorld('populated');
  return mountRouteChecked(`/client-view?portalId=${SNAP_PORTAL}&t=${SNAP_TOKEN}`);
}

function goldens(): Record<string, string> {
  return existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')) : {};
}

describe('client portal financing — decided by the GC, shown to the homeowner', () => {
  const recorded: Record<string, string> = {};
  afterAll(() => {
    if (RECORD) writeFileSync(GOLDEN, `${JSON.stringify(recorded, null, 2)}\n`);
  });

  it('financing OFF: the GC preview is byte-identical to the pre-change golden', async () => {
    const tree = await mountLocalPreview();
    const text = flat(tree);
    if (RECORD) { recorded.localOff = text; return; }
    expect(norm(text)).toBe(norm(goldens().localOff));
    expect(text).not.toContain('Check financing options');
  });

  it('financing OFF: the homeowner view is byte-identical to the pre-change golden', async () => {
    const tree = await mountHomeowner(snapshotFor(world.settings));
    const text = flat(tree);
    if (RECORD) { recorded.homeownerOff = text; return; }
    expect(norm(text)).toBe(norm(goldens().homeownerOff));
    expect(text).not.toContain('Check financing options');
  });

  if (RECORD) return;

  it('the GC turned financing on: the homeowner sees the button, from the snapshot, not from his own settings', async () => {
    const snap = snapshotFor({ ...world.settings, financing: FINANCING_ON });
    expect(snap.financing).toEqual({
      partnerName: 'Acme Home Loans',
      disclosure: expect.stringContaining('MAGE ID is not a lender and is not paid for this referral'),
    });
    const tree = await mountHomeowner(snap);
    const text = flat(tree);
    expect(text).toContain('Check financing options');
    expect(text).toContain('Acme Home Loans');
    expect(text).not.toContain('may receive compensation');
    const btn = tree.getByLabelText('Check financing options with Acme Home Loans');
    expect(btn).toBeTruthy();
  });

  it('the snapshot never carries the lender URL or the GC referral code (financing-redirect reads those server-side)', () => {
    const snap = snapshotFor({ ...world.settings, financing: FINANCING_ON });
    const json = JSON.stringify(snap.financing);
    expect(json).not.toContain('acme.example');
    expect(json).not.toContain('GC-42');
  });

  it("the GC's own preview has no access key, so it says why the button is not live instead of drawing a dead one", async () => {
    const tree = await mountLocalPreview(FINANCING_ON);
    const text = flat(tree);
    expect(text).not.toContain('Check financing options\n');
    expect(text).toContain('Your client sees a "Check financing options" button here');
  });
});

describe('Payments screen says what Stripe and the lender actually do', () => {
  if (RECORD) return;
  it('payout timing, card AND bank fees, bring-your-own-lender — no Wisetack, no "funded", no 1–2 days', async () => {
    mockSnapshot = null;
    await primeWorld('populated');
    await AsyncStorage.setItem('mageid_settings', JSON.stringify({ ...world.settings, financing: FINANCING_ON }));
    const tree = await mountRouteChecked('/payments-setup');
    const text = flat(tree).replace(/\n/g, '');
    expect(text).not.toMatch(/1[–-]2 business days/);
    expect(text).toContain('the first payout usually takes about a week');
    expect(text).toContain('bank transfer (ACH) 0.8%, capped at $5');
    expect(text).toContain('cards 2.9% + 30¢');
    expect(text).toContain('Bring your own lender.');
    expect(text).toContain('Offer financing on invoices and your client portal');
    expect(text).not.toMatch(/Wisetack/i);
    // No count that can only read 0; the one mention of "funded" says where
    // that fact lives (the lender's dashboard).
    expect(text).not.toMatch(/\d+ funded/i);
    expect(text).toContain('Financing links: 0 created · 0 clicked');
    expect(text).toContain("Whether your lender approved or funded a loan is in your lender's own dashboard.");
    expect(text).not.toContain('estimates & invoices');
    expect(text).toContain('MAGE ID is not a lender and is not paid for this referral');
  });
});
