/**
 * validate-portal-snapshot-fallback.ts — pins the homeowner portal fallback.
 *
 * Run: bun run test:portal-snapshot-fallback
 *
 * THE BUG THIS GUARDS. app/client-view.tsx resolved its project only out of the
 * local ProjectContext. A homeowner opening a share link has no session, so
 * `projects` was empty, so the screen rendered "Portal Not Found — This portal
 * link may be expired or invalid" for every single visitor. Two failures in
 * one: the fallback read of portal_snapshots documented in utils/portalSnapshot
 * was never implemented in the RN screen, and the copy blamed an expiry that
 * had almost never happened.
 *
 * The hydrator is pure (its only imports are type-only), so the data half runs
 * here directly. The screen half is asserted against source text, the same way
 * scripts/validate-portal-owner.ts does it.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { hydratePortalSnapshot } from '../utils/portalSnapshotHydrate';
import type { PortalSnapshot } from '../utils/portalSnapshot';

let passed = 0;
let failed = 0;

function check(description: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failed++;
  console.error(`FAIL [${description}]`);
  console.error(`  expected: ${JSON.stringify(expected)}`);
  console.error(`  got:      ${JSON.stringify(actual)}`);
}

function ok(description: string, condition: boolean): void {
  if (condition) { passed++; return; }
  failed++;
  console.error(`FAIL [${description}]`);
}

const read = (rel: string): string => readFileSync(join(__dirname, '..', rel), 'utf-8');

// ── Fixture — a snapshot with every section the screen renders ───────────────
const SNAPSHOT: PortalSnapshot = {
  v: 10,
  snapshotAt: '2026-08-20T15:00:00.000Z',
  requirePasscode: true,
  welcomeMessage: 'Welcome to your build.',
  coApprovalEnabled: true,
  messages: [
    { id: 'm1', authorType: 'gc', authorName: 'Dana', body: 'Framing starts Monday.', createdAt: '2026-08-19T12:00:00.000Z' },
  ],
  company: { name: 'Ridgeline Builders' },
  project: {
    id: 'proj-uuid-1',
    name: 'Oak Street Remodel',
    type: 'remodel',
    address: '12 Oak St',
    status: 'in_progress',
  },
  sections: {
    schedule: {
      startDate: '2026-06-01',
      workingDaysPerWeek: 5,
      totalDurationDays: 60,
      tasks: [
        { id: 't1', title: 'Demo', phase: 'Sitework', progress: 100, status: 'done', durationDays: 5, startDay: 1 },
        // A status the union does not contain — a v11 payload read by a v10 app.
        { id: 't2', title: 'Framing', phase: 'Structure', progress: 40, status: 'blocked_by_weather', durationDays: 12, startDay: 6 },
      ],
    },
    // 210_000 revised = 200_000 base + a 10_000 approved change order.
    budget: { contractValue: 210_000, paidToDate: 50_000, outstanding: 160_000, pctComplete: 24 },
    changeOrders: [
      { id: 'co1', number: 1, description: 'Upgrade windows', changeAmount: 10_000, status: 'approved', dateSubmitted: '2026-07-01', newContractTotal: 210_000 },
      { id: 'co2', number: 2, description: 'Add skylight', changeAmount: 4_000, status: 'submitted' },
    ],
    invoices: [
      { id: 'i1', number: 1, total: 60_000, status: 'partially_paid', dueDate: '2026-08-01', balance: 10_000 },
      { id: 'i2', number: 2, total: 20_000, status: 'sent' },
    ],
    photos: [
      { url: 'https://example.test/a.jpg', caption: 'Framing' },
      { url: 'https://example.test/b.jpg' },
    ],
    punchList: [{ id: 'p1', title: 'Touch up paint', status: 'open', location: 'Hall' }],
    rfis: [{ id: 'r1', number: 7, subject: 'Beam size', status: 'open' }],
    dailyReports: [{ id: 'd1', date: '2026-08-18', weather: 'Sunny 78F', workPerformed: 'Framed north wall' }],
    documents: [{ name: 'Construction Agreement', dateSent: '2026-06-01' }],
  },
};

const h = hydratePortalSnapshot(SNAPSHOT, 'portal-abc123');

// ── The money. Getting this wrong double-counts every approved change order ──
// sections.budget.contractValue is ALREADY revised (base + approved COs), and
// client-view re-adds the CO total itself. The hydrator must back the base out.
check('base contract is backed out of the revised total', h.project.linkedEstimate?.grandTotal, 200_000);
check('approved CO total is preserved', h.changeOrders.filter(c => c.status === 'approved').reduce((s, c) => s + c.changeAmount, 0), 10_000);
check('originalContractValue is derived, not zeroed', h.changeOrders[0].originalContractValue, 200_000);
check('amountPaid is derived from the balance when absent', h.invoices[0].amountPaid, 50_000);
check('an invoice with no balance reads as unpaid', h.invoices[1].amountPaid, 0);

// ── Visibility. Section presence IS the GC's toggle; nothing else carries it ──
check('showSchedule follows the schedule section', h.portal.showSchedule, true);
check('showBudgetSummary follows the budget section', h.portal.showBudgetSummary, true);
check('showDailyReports follows the dailyReports section', h.portal.showDailyReports, true);
ok('a missing section switches its toggle off', (() => {
  const bare = hydratePortalSnapshot(
    { ...SNAPSHOT, sections: { schedule: SNAPSHOT.sections.schedule } },
    'portal-abc123',
  );
  return bare.portal.showInvoices === false
    && bare.portal.showPhotos === false
    && bare.portal.showDocuments === false
    && bare.portal.showSchedule === true;
})());

// ── Security. The passcode must never survive into a client-held payload ─────
check('requirePasscode survives', h.portal.requirePasscode, true);
check('passcode is never hydrated', h.portal.passcode, undefined);
ok('the snapshot type carries no passcode field',
  !('passcode' in (SNAPSHOT as unknown as Record<string, unknown>)));

// ── Honesty about what the snapshot does not carry ────────────────────────────
check('healthScore stays unknown rather than 0', h.project.schedule?.healthScore, undefined);
check('assignedSub is blank, not invented', h.punchItems[0].assignedSub, '');
check('an RFI with no deadline gets no date', h.rfis[0].dateRequired, '');
check('a CO with no submit date gets no date', h.changeOrders[1].date, '');
check('the estimate itself is never reconstructed', h.project.estimate, null);
check('weather stays in conditions, temperature is not guessed', h.dailyReports[0].weather, {
  temperature: '', conditions: 'Sunny 78F', wind: '', isManual: false,
});

// ── Untrusted unions. A newer payload must not produce an invalid domain value ─
check('an unknown task status falls back inside the union', h.project.schedule?.tasks[1].status, 'not_started');
check('a known task status is preserved', h.project.schedule?.tasks[0].status, 'done');
ok('photos get stable, distinct keys',
  h.photos[0].id !== h.photos[1].id && h.photos.every(p => !!p.id));
check('messages keep their author side', h.messages[0].authorType, 'gc');

// ── An empty snapshot must not throw ─────────────────────────────────────────
ok('a sections-less snapshot hydrates without throwing', (() => {
  try {
    const bare = hydratePortalSnapshot(
      { v: 10, snapshotAt: '', company: { name: '' }, project: { id: 'p', name: '' }, sections: {} },
      'portal-x',
    );
    return bare.changeOrders.length === 0 && bare.project.schedule === null;
  } catch { return false; }
})());

// ── The screen ───────────────────────────────────────────────────────────────
const cv = read('app/client-view.tsx');

ok('client-view no longer blames expiry for a missing portal',
  !/expired or invalid/i.test(cv));
ok('client-view falls back to the published snapshot', /usePortalSnapshot\(/.test(cv));
ok('client-view renders from the hydrated snapshot', /hydratePortalSnapshot\(/.test(cv));
ok('client-view still prefers the local project', /const localProject =/.test(cv));
ok('client-view accepts the #d= fragment payload', /decodeHashSnapshot/.test(read('hooks/usePortalSnapshot.ts')));
// The loading branch must return BEFORE any failure is classified — a
// "not found" that flashes while data is still in flight is the bug.
ok('client-view shows a loading state before any failure',
  /const resolving =/.test(cv)
  && cv.indexOf('const resolving =') < cv.indexOf('const failure:')
  && /if \(resolving\) \{/.test(cv));
ok('a genuinely expired link says so', /This link has expired/.test(cv));
ok('a missing portal does NOT say expired',
  /We could not find this portal/.test(cv));
ok('a truncated link gets its own message', /This link is incomplete/.test(cv));
ok('every failure points back at the contractor',
  (cv.match(/contractor/g) ?? []).length >= 4);
ok('snapshot mode is read-only (no CO signing without a session)',
  /const awaitingClient = !isSnapshotMode/.test(cv));

// ── The route must be reachable without a session ────────────────────────────
const layout = read('app/_layout.tsx');
ok('client-view is on the unauthenticated allow-list',
  /=== 'client-view'/.test(layout));
ok('the signed-out smoke suite covers client-view',
  /'\/client-view'/.test(read('__tests__/smoke/signed-out.test.tsx')));

// ── The read boundary must actually enforce expiry ───────────────────────────
const rpc = read('supabase/migrations/20260826190000_portal_get_snapshot_expiry_aware.sql');
// Body only — the header comment mentions expires_at long before the code does.
const rpcBody = rpc.slice(rpc.indexOf('create or replace function'));
ok('the expiry-aware RPC checks the token before it touches the row',
  rpcBody.indexOf('portal_project_for_token') < rpcBody.indexOf('from public.portal_snapshots'));
ok('an expired link is withheld, not just labelled',
  /'status', 'expired'/.test(rpc) && !/'snapshot', v_snapshot,\s*\n\s*'expiresAt'[\s\S]*expired/.test(rpc));
ok('NULL expires_at still means never expires',
  /v_expires_at is not null and v_expires_at <= now\(\)/.test(rpc));
ok('the migration is additive — v1 is left alone',
  !/drop function[\s\S]*portal_get_snapshot\(/.test(rpc));

console.log(`portalSnapshotFallback: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
