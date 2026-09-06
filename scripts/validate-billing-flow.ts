// validate-billing-flow.ts — pins the two rules that stand between "work done"
// and "money received", both of which fail silently and expensively.
//
// 1. CONTRACT MILESTONE → INVOICE. The payment schedule used to be completely
//    disconnected from invoicing: the GC read the milestone, opened the invoice
//    screen, and retyped the amount by hand — hoping not to bill it twice. The
//    one-tap hand-off removes the retyping; these cases remove the hoping.
//    A percentage milestone must resolve against the CONTRACT VALUE (not the
//    cached whole-dollar `amount`, which goes stale), and a milestone that has
//    already produced an invoice must be un-billable from EITHER side of the
//    link — because the milestone's status flip is a separate write that can
//    fail after the invoice already exists.
//
// 2. INVOICE REMINDERS. The dunning cron dedupes purely by "only ever advance
//    to a higher stage". Adding a manual "send reminder now" button on top of
//    that is exactly how you get a client receiving two FINAL NOTICES in one
//    afternoon, or a cadence that silently skips from friendly to final. The
//    manual path relaxes one guard (re-send at the CURRENT stage) and pays for
//    it with a 24h window; everything else — unsubscribes, paid, not-yet-due,
//    never-skip-a-stage — still holds.
//
// The Deno edge function cannot import the app's `@/utils` alias, so the rules
// exist in two copies. The source-level pins at the bottom are what stop those
// two copies drifting apart unnoticed.
//
// Run: bun run scripts/validate-billing-flow.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  milestoneBillableAmount,
  milestoneBillability,
  milestoneBlockMessage,
  deriveMilestoneInvoiceLine,
  milestoneInvoiceNote,
  targetDunningStage,
  nextDunningStage,
  reminderEligibility,
  reminderSentLabel,
  dunningStageLabel,
  MANUAL_REMINDER_MIN_INTERVAL_MS,
  type MilestoneLike,
} from '../utils/billingFlowCore';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 20, 12, 0, 0); // fixed clock — no flaky tests
const ms = (m: Partial<MilestoneLike> = {}): MilestoneLike => ({
  id: 'm1', label: 'Rough-in complete', status: 'pending', trigger: 'on_milestone', ...m,
});

// ── 1. Milestone amounts: percentage AND fixed ───────────────────────
console.log('\nmilestone → invoice amounts:');
{
  ok('fixed-dollar milestone bills its stored amount',
    near(milestoneBillableAmount(ms({ amount: 25_000 }), 100_000), 25_000));

  ok('percentage milestone bills % of the contract value',
    near(milestoneBillableAmount(ms({ percent: 25 }), 100_000), 25_000));

  // The contract editor caches amount = round(contractValue * pct) and only
  // refreshes it inside handleValueChange. A schedule whose contract value
  // moved through any other path carries a stale cache; billing it would
  // under/over-charge against a contract signed as a percentage.
  ok('percentage WINS over a stale cached amount',
    near(milestoneBillableAmount(ms({ percent: 25, amount: 30_000 }), 100_000), 25_000),
    'a stale cached `amount` must never out-rank the signed percentage');

  // 7.5% of $12,345 = $925.875. The contract row caches 926 (whole dollars);
  // the invoice must carry cents.
  ok('percentage resolves to cents, not whole dollars',
    near(milestoneBillableAmount(ms({ percent: 7.5 }), 12_345), 925.88));

  // A $0 contract value is a data gap, not an instruction to bill nothing.
  ok('percentage on a $0 contract falls back to the stored amount',
    near(milestoneBillableAmount(ms({ percent: 25, amount: 5_000 }), 0), 5_000));

  ok('missing amount and percent bills $0 (never NaN)',
    near(milestoneBillableAmount(ms(), 100_000), 0));

  ok('negative stored amount clamps to $0',
    near(milestoneBillableAmount(ms({ amount: -500 }), 100_000), 0));

  // quantity × unitPrice must equal total or the printed PDF row doesn't foot.
  const line = deriveMilestoneInvoiceLine(ms({ percent: 25, label: 'Deposit' }), 100_000);
  ok('derived line foots (qty × unitPrice === total)',
    near(line.quantity * line.unitPrice, line.total) && near(line.total, 25_000),
    JSON.stringify(line));
  ok('derived line is lump-sum quantity 1', line.quantity === 1 && line.unit === 'lump');
  ok('derived line names the milestone', line.name === 'Deposit');
  ok('derived line explains the % basis to the client',
    /25% of contract/.test(line.description), line.description);

  const fixedLine = deriveMilestoneInvoiceLine(ms({ amount: 8_000, trigger: 'on_signing' }), 100_000);
  ok('fixed milestone line carries no phantom % note',
    !/% of contract/.test(fixedLine.description) && near(fixedLine.total, 8_000),
    fixedLine.description);

  // deriveMilestoneInvoiceLine must NOT set billedPercent: that field means
  // "already scaled by bill-from-estimate" and would trip progressSubtotal's
  // anyPreScaled gate on an invoice that has nothing to do with progress.
  ok('derived line does not masquerade as a pre-scaled estimate line',
    !('billedPercent' in line));

  ok('invoice note names the milestone and the contract',
    milestoneInvoiceNote(ms({ label: 'Deposit' }), 'Smith Reno — Agreement')
      .includes('Deposit') &&
    milestoneInvoiceNote(ms({ label: 'Deposit' }), 'Smith Reno — Agreement')
      .includes('Smith Reno'));
}

// ── 2. Double-bill prevention ────────────────────────────────────────
console.log('\ndouble-bill prevention:');
{
  const base = { contractValue: 100_000, contractStatus: 'signed' };

  const fresh = milestoneBillability({ milestone: ms({ percent: 25 }), ...base });
  ok('an untouched pending milestone IS billable', fresh.billable && near(fresh.amount, 25_000));

  const invoiced = milestoneBillability({ milestone: ms({ percent: 25, status: 'invoiced', invoiceId: 'inv-1' }), ...base });
  ok('an already-invoiced milestone cannot be billed again',
    !invoiced.billable && invoiced.reason === 'already_invoiced', JSON.stringify(invoiced));
  ok('...and it points at the invoice that already covers it',
    invoiced.existingInvoiceId === 'inv-1');

  const paid = milestoneBillability({ milestone: ms({ percent: 25, status: 'paid', invoiceId: 'inv-1' }), ...base });
  ok('a paid milestone cannot be billed again', !paid.billable && paid.reason === 'already_paid');

  const skipped = milestoneBillability({ milestone: ms({ percent: 25, status: 'skipped' }), ...base });
  ok('a skipped milestone cannot be billed', !skipped.billable && skipped.reason === 'skipped');

  // THE failure mode this guard exists for: the invoice was created, but the
  // milestone's flip to 'invoiced' never reached project_contracts (offline,
  // RLS, app killed). The milestone row still says pending — and without the
  // invoice-side link the GC would happily bill the same work twice.
  const lostFlip = milestoneBillability({
    milestone: ms({ percent: 25, status: 'pending' }),
    ...base,
    linkedInvoiceIds: ['inv-9'],
  });
  ok('a lost status flip still blocks re-billing (invoice-side link wins)',
    !lostFlip.billable && lostFlip.reason === 'invoice_exists' && lostFlip.existingInvoiceId === 'inv-9',
    JSON.stringify(lostFlip));

  // Half-finished flip in the other direction: invoiceId written, status not.
  const halfFlip = milestoneBillability({ milestone: ms({ percent: 25, status: 'pending', invoiceId: 'inv-4' }), ...base });
  ok('a pending milestone that already carries an invoiceId is treated as billed',
    !halfFlip.billable && halfFlip.reason === 'already_invoiced');

  const unsigned = milestoneBillability({ milestone: ms({ percent: 25 }), contractValue: 100_000, contractStatus: 'sent' });
  ok('an unsigned contract cannot be invoiced against',
    !unsigned.billable && unsigned.reason === 'contract_not_signed');

  const zero = milestoneBillability({ milestone: ms({ amount: 0 }), ...base });
  ok('a $0 milestone is not billable', !zero.billable && zero.reason === 'zero_amount');

  // Conflict beats arithmetic: a $0 AND already-invoiced milestone must report
  // the billing conflict, because that's the one that costs the client money.
  const zeroAndBilled = milestoneBillability({ milestone: ms({ amount: 0, status: 'invoiced', invoiceId: 'inv-2' }), ...base });
  ok('an already-billed $0 milestone reports the conflict, not the amount',
    zeroAndBilled.reason === 'already_invoiced');

  const reasons = ['already_invoiced', 'already_paid', 'skipped', 'zero_amount', 'invoice_exists', 'contract_not_signed'] as const;
  ok('every block reason has GC-readable copy',
    reasons.every(r => (milestoneBlockMessage(r) ?? '').length > 20));
}

// ── 3. Backing out of invoice creation leaves the milestone pending ──
console.log('\nbacking out of invoice creation:');
{
  // Behaviour: opening the editor changes nothing about the milestone, so the
  // exact same input is still billable afterwards.
  const before = milestoneBillability({ milestone: ms({ percent: 25 }), contractValue: 100_000, contractStatus: 'signed' });
  const after = milestoneBillability({ milestone: ms({ percent: 25 }), contractValue: 100_000, contractStatus: 'signed' });
  ok('a milestone whose invoice was abandoned is still billable',
    before.billable && after.billable && near(before.amount, after.amount));

  // Structure: the flip must be wired to invoice CREATION, not to navigation.
  const contractSrc = read('app/contract.tsx');
  const invoiceSrc = read('app/invoice.tsx');

  ok('the contract screen never flips a milestone when opening the editor',
    !/markMilestoneInvoiced\(/.test(contractSrc),
    'contract.tsx must navigate only — flipping there would bill a GC who backs out');
  ok('the contract screen does not pre-set status:\'invoiced\' on navigate',
    !/updateMilestone\([^)]*status:\s*'invoiced'/.test(contractSrc));

  ok('the invoice screen owns the flip',
    /markMilestoneInvoiced\(/.test(invoiceSrc));
  // Every linkMilestone() call must sit immediately after an addInvoice() —
  // i.e. the invoice provably exists before the milestone is marked billed.
  // Two creation paths exist: "Save to Project" and "Send & Save".
  const linkCalls = [...invoiceSrc.matchAll(/linkMilestone\(/g)].length;
  const linkAfterAdd = [...invoiceSrc.matchAll(/addInvoice\([^)]*\);[\s\S]{0,400}?linkMilestone\(/g)].length;
  ok('every milestone flip follows a real addInvoice()',
    linkCalls >= 2 && linkCalls === linkAfterAdd,
    `linkMilestone call sites: ${linkCalls}, of which preceded by addInvoice: ${linkAfterAdd}`);
  ok('the invoice stamps its source milestone (invoice-side double-bill guard)',
    /sourceMilestoneId:\s*milestoneId/.test(invoiceSrc));

  const ctxSrc = read('contexts/ProjectContext.tsx');
  ok('source_milestone_id is persisted on insert, not local-only',
    /source_milestone_id:\s*finalInvoice\.sourceMilestoneId/.test(ctxSrc),
    'a local-only link evaporates on the next refetch and the guard dies with it');
  ok('source_milestone_id is hydrated back on refetch',
    /sourceMilestoneId:\s*\(r\.source_milestone_id/.test(ctxSrc));

  const engineSrc = read('utils/contractEngine.ts');
  ok('markMilestoneInvoiced re-reads the live row before writing',
    /markMilestoneInvoiced[\s\S]{0,900}from\('project_contracts'\)[\s\S]{0,200}select\(/.test(engineSrc),
    'blind-writing the caller\'s stale paymentSchedule would clobber other milestones');
  ok('markMilestoneInvoiced refuses to relink an already-billed milestone',
    /return target\.invoiceId === invoiceId \? 'flipped' : 'already'/.test(engineSrc));
}

// ── 4. Reminder eligibility ──────────────────────────────────────────
console.log('\nreminder eligibility:');
{
  const inv = (o: Partial<Parameters<typeof reminderEligibility>[0]> = {}) => reminderEligibility({
    status: 'sent', totalDue: 10_000, amountPaid: 0,
    dueMs: NOW - 3 * DAY, dunningStage: 0, lastSentMs: null, nowMs: NOW, ...o,
  });

  // Stage thresholds — must match the edge function exactly.
  ok('stage thresholds: 0d→0, 1d→1, 6d→1, 7d→2, 13d→2, 14d→3, 99d→3',
    targetDunningStage(0) === 0 && targetDunningStage(1) === 1 && targetDunningStage(6) === 1 &&
    targetDunningStage(7) === 2 && targetDunningStage(13) === 2 && targetDunningStage(14) === 3 &&
    targetDunningStage(99) === 3);

  ok('a draft invoice is never dunned', inv({ status: 'draft' }).reason === 'draft');
  ok('a paid invoice is never dunned', inv({ status: 'paid' }).reason === 'paid');
  ok('a fully-collected invoice whose status lagged is never dunned',
    inv({ status: 'sent', amountPaid: 10_000 }).reason === 'nothing_outstanding',
    'status is not trusted alone — the arithmetic rules');
  ok('a partially-paid overdue invoice IS still dunned',
    inv({ status: 'partially_paid', amountPaid: 4_000 }).eligible);

  // MONEY-F5 (audit 2026-09-03): retention the contract lets the client hold
  // is NOT chased. $100,000 invoice, $10,000 retention held, client paid the
  // $90,000 they were asked for on day 20 → nothing outstanding, no reminder
  // at any stage. This was the live "FINAL NOTICE on retention" harm.
  const retentionOnly = inv({
    status: 'partially_paid', totalDue: 100_000, retentionAmount: 10_000, amountPaid: 90_000,
    dueMs: NOW - 20 * DAY,
  });
  ok('a retention-only balance is never dunned',
    retentionOnly.reason === 'nothing_outstanding' && !retentionOnly.eligible,
    `got reason=${retentionOnly.reason} eligible=${retentionOnly.eligible}`);
  ok('...and reports $0 outstanding, not $10,000', retentionOnly.outstanding === 0);
  ok('...at every stage, cron or manual',
    !inv({ status: 'partially_paid', totalDue: 100_000, retentionAmount: 10_000, amountPaid: 90_000, dueMs: NOW - 45 * DAY, dunningStage: 2 }).eligible &&
    !inv({ status: 'partially_paid', totalDue: 100_000, retentionAmount: 10_000, amountPaid: 90_000, dueMs: NOW - 45 * DAY, dunningStage: 2, manual: true }).eligible);
  ok('released-and-unpaid retention IS dunned (release = now collectible)',
    inv({ status: 'partially_paid', totalDue: 100_000, retentionAmount: 10_000, retentionReleased: 10_000, amountPaid: 90_000, dueMs: NOW - 20 * DAY }).eligible);
  ok('the amount a reminder demands is net of held retention ($90,000, not $100,000)',
    inv({ totalDue: 100_000, retentionAmount: 10_000 }).outstanding === 90_000);
  ok('an invoice not yet due is not dunned',
    inv({ dueMs: NOW + 5 * DAY }).reason === 'not_overdue');
  ok('a same-day-due invoice is not dunned (stage starts the day AFTER)',
    inv({ dueMs: NOW - 2 * HOUR }).reason === 'not_overdue');
  ok('an unparseable due date is reported, not guessed',
    inv({ dueMs: NaN }).reason === 'bad_due_date');

  // Unsubscribe is checked BEFORE the stage math so a suppressed send never
  // burns a stage the recipient would need if they re-subscribe.
  const unsub = inv({ unsubscribed: true, dunningStage: 0 });
  ok('an unsubscribed recipient blocks the send', unsub.reason === 'unsubscribed');
  ok('...and does NOT consume a dunning stage', unsub.nextStage === 0);
  const unsubManual = inv({ unsubscribed: true, manual: true, dunningStage: 1 });
  ok('a manual send cannot bypass an unsubscribe',
    unsubManual.reason === 'unsubscribed' && unsubManual.nextStage === 1);

  // Cron dedupe: advance only.
  ok('cron sends when the stage has advanced (0 → 1 at 3 days)',
    inv({ dunningStage: 0 }).eligible && inv({ dunningStage: 0 }).nextStage === 1);
  ok('cron does NOT re-send at a stage already emailed',
    inv({ dunningStage: 1 }).reason === 'stage_already_sent');
  ok('cron escalates 1 → 2 at 8 days',
    inv({ dueMs: NOW - 8 * DAY, dunningStage: 1 }).nextStage === 2);
  ok('cron escalates to 3 at 20 days',
    inv({ dueMs: NOW - 20 * DAY, dunningStage: 2 }).nextStage === 3);
}

// ── 5. Manual send: no stage skipped, no stage duplicated ────────────
console.log('\nmanual "send reminder now":');
{
  const inv = (o: Partial<Parameters<typeof reminderEligibility>[0]> = {}) => reminderEligibility({
    status: 'sent', totalDue: 10_000, amountPaid: 0,
    dueMs: NOW - 3 * DAY, dunningStage: 0, lastSentMs: null, manual: true, nowMs: NOW, ...o,
  });

  ok('the 24h manual window is a full day', MANUAL_REMINDER_MIN_INTERVAL_MS === 24 * HOUR);

  ok('manual sends when nothing has gone out yet', inv().eligible && inv().nextStage === 1);

  // The whole point of the button: the cron already sent stage 1 and refuses
  // to speak again until day 7, but the GC just got off the phone.
  const reSend = inv({ dunningStage: 1, lastSentMs: NOW - 30 * HOUR });
  ok('manual CAN re-send at the current stage once 24h have passed', reSend.eligible);
  ok('...and the re-send does NOT skip ahead a stage',
    reSend.nextStage === 1 && reSend.targetStage === 1,
    `nextStage=${reSend.nextStage} — a day-3 nudge must not fire "FINAL NOTICE"`);

  // Duplicate protection, both sources of a duplicate:
  ok('manual cannot double-send within 24h of the cron',
    inv({ dunningStage: 1, lastSentMs: NOW - 2 * HOUR }).reason === 'too_soon');
  ok('manual cannot double-send within 24h of ITSELF (double tap)',
    inv({ dunningStage: 1, lastSentMs: NOW }).reason === 'too_soon');
  ok('the window is exclusive at exactly 24h + 1ms',
    inv({ dunningStage: 1, lastSentMs: NOW - (24 * HOUR + 1) }).eligible);
  ok('the window still blocks at exactly 24h - 1ms',
    inv({ dunningStage: 1, lastSentMs: NOW - (24 * HOUR - 1) }).reason === 'too_soon');

  // A manual send must not corrupt the cadence for the cron that follows it.
  const afterManual = reminderEligibility({
    status: 'sent', totalDue: 10_000, amountPaid: 0,
    dueMs: NOW - 4 * DAY, dunningStage: 1, lastSentMs: NOW - 20 * HOUR,
    manual: false, nowMs: NOW,
  });
  ok('after a manual send the cron still waits for the next real stage',
    afterManual.reason === 'stage_already_sent',
    'a manual nudge must not make the cron re-fire the same notice tomorrow');

  // Stage ceiling: manual at the final stage never invents a stage 4.
  const atFinal = inv({ dueMs: NOW - 40 * DAY, dunningStage: 3, lastSentMs: NOW - 40 * HOUR });
  ok('manual at the final stage stays at stage 3', atFinal.eligible && atFinal.nextStage === 3);

  // Never regress: a due date pushed out AFTER a final notice lowers the
  // day-derived target, but the client has already had the final notice.
  const regressed = inv({ dueMs: NOW - 2 * DAY, dunningStage: 3, lastSentMs: NOW - 40 * HOUR });
  ok('a lowered target never walks the stage backwards',
    regressed.eligible && regressed.nextStage === 3 && regressed.targetStage === 1);
  ok('nextDunningStage is max-in-both-directions',
    nextDunningStage(0, 2) === 2 && nextDunningStage(3, 1) === 3 && nextDunningStage(null, 1) === 1);
}

// ── 6. Reminder state the GC actually reads ──────────────────────────
console.log('\nreminder state line:');
{
  ok('nothing sent yet → no state line', reminderSentLabel(0, null) === null);
  ok('a stage with no timestamp → no state line', reminderSentLabel(2, null) === null);
  const label = reminderSentLabel(2, Date.UTC(2026, 10, 14, 18, 0, 0)) ?? '';
  ok('a sent reminder reads "Reminder sent · Stage 2 · <date>"',
    label.startsWith('Reminder sent · Stage 2 · ') && label.length > 26, label);
  ok('stage labels escalate',
    dunningStageLabel(1) === 'First reminder' &&
    dunningStageLabel(2) === 'Second notice' &&
    dunningStageLabel(3) === 'Final notice');
}

// ── 7. Cron / core parity + edge-function safety ─────────────────────
// The Deno function cannot import @/utils, so the rules live in two copies.
// These pins are the only thing keeping them honest.
console.log('\ninvoice-dunning edge function:');
{
  const fn = read('supabase/functions/invoice-dunning/index.ts');
  const core = read('utils/billingFlowCore.ts');

  ok('edge fn uses the same 24h manual window as the core',
    /MANUAL_REMINDER_MIN_INTERVAL_MS\s*=\s*24 \* 60 \* 60 \* 1000/.test(fn) &&
    /MANUAL_REMINDER_MIN_INTERVAL_MS\s*=\s*24 \* 60 \* 60 \* 1000/.test(core));
  ok('edge fn uses the same 14/7/1-day stage thresholds',
    /daysOverdue >= 14\) return 3/.test(fn) &&
    /daysOverdue >= 7\) return 2/.test(fn) &&
    /daysOverdue >= 1\) return 1/.test(fn));
  ok('edge fn caps the written stage with nextDunningStage',
    /function nextDunningStage/.test(fn) &&
    /dunning_stage:\s*nextStage/.test(fn),
    'writing the raw target would let a re-send walk a final notice backwards');
  ok('edge fn threads the manual flag through eligibility',
    /shouldDun\(invoice, target, manual, nowMs\)/.test(fn));
  ok('edge fn cron path still only advances (manual=false → stage<target)',
    /if \(stage < targetStage\) return true;\s*\n\s*if \(!manual\) return false;/.test(fn));

  ok('edge fn still checks the unsubscribe list before sending',
    /isEmailUnsubscribed\(/.test(fn));
  ok('edge fn skips an unsubscribed recipient WITHOUT advancing the stage',
    /unsubscribed[\s\S]{0,200}return skip\('unsubscribed'\)/.test(fn));
  // The marker write must be downstream of a confirmed send, or a failed send
  // permanently consumes a stage the client never received.
  const sendIdx = fn.indexOf('if (!sendResult.ok)');
  const markerIdx = fn.indexOf('dunning_last_sent_at: sentAt');
  ok('the dedup marker is written only AFTER a confirmed send',
    sendIdx > 0 && markerIdx > sendIdx);

  ok('the in-app path verifies the caller\'s JWT (never a bare claims decode)',
    /verifyUser\(req\)/.test(fn));
  ok('the in-app path checks invoice ownership before emailing anyone',
    /invoice\.user_id !== caller\.id/.test(fn),
    'the service-role client bypasses RLS — without this any signed-in user could dun any invoice');
  ok('an unauthenticated caller cannot fan out over every invoice',
    /if \(!body\.invoiceId\) return jsonResponse\(\{ success: false, error: 'unauthorized' \}, 401\)/.test(fn));
  ok('single-invoice mode reports the outcome + stage back to the app',
    /outcome: result\.outcome/.test(fn) && /stage: result\.stage/.test(fn));

  // The core must stay bun-parseable: one react-native import and every
  // validator that imports it dies.
  ok('billingFlowCore imports nothing from react-native / expo / supabase',
    !/from\s+['"](react-native|expo|@\/lib\/supabase)/.test(core));
}

// ── 8. The surfaces are actually wired up ────────────────────────────
console.log('\nsurfaces:');
{
  const contractSrc = read('app/contract.tsx');
  const invoiceSrc = read('app/invoice.tsx');
  const detailSrc = read('app/project-detail.tsx');

  ok('the contract screen offers "Create invoice" on a milestone row',
    /Create invoice/.test(contractSrc) && /milestone-create-invoice-/.test(contractSrc));
  ok('the milestone button prints the amount that will actually be billed',
    /Create invoice · \{formatMoney\(billability\.amount\)\}/.test(contractSrc),
    'a % milestone bills the derived figure, not the cached one — show it');
  ok('the contract screen re-reads on focus so a billed milestone shows as billed',
    /useFocusEffect/.test(contractSrc));

  ok('the invoice screen surfaces the reminder state line',
    /reminder-state-line/.test(invoiceSrc) && /reminderSentLabel/.test(invoiceSrc));
  ok('the invoice screen has a "Send reminder" button',
    /send-reminder-btn/.test(invoiceSrc));
  ok('the reminder button explains itself when unavailable',
    /reminderBlockMessage/.test(invoiceSrc));

  // Job 3: reuse the A/R engine, don't grow a second definition of outstanding.
  ok('the project invoice list shows days past due per row',
    /getDaysPastDue/.test(detailSrc) && /invDaysPastDue > 0/.test(detailSrc));
  ok('the project invoice list shows total outstanding',
    /invoices-ar-summary/.test(detailSrc));
  ok('...and reuses computeARAgingReport rather than reimplementing A/R',
    /computeARAgingReport/.test(detailSrc));

  // ── THE HERO STAT ROW WHEN A PROJECT CARRIES BOTH ESTIMATES.
  // commitEstimatePatch sets linkedEstimate and never clears the legacy
  // project.estimate, so "both present" is the NORMAL state for any project
  // that had an estimate before one was attached. The row has two mutually
  // exclusive blocks, and gating BOTH off in that state renders it EMPTY —
  // which is what shipped when PR #116 restored only one half of the pair from
  // the closed PR #81. Pinned here because it has now regressed twice.
  ok('the legacy hero stats yield to the linked estimate when both exist',
    /\{estimate && !linkedEstimate && \(/.test(detailSrc));
  ok('...and the linked block owns the row whenever a linkedEstimate exists',
    /\{linkedEstimate && \(/.test(detailSrc) &&
    !/\{!estimate && linkedEstimate && \(/.test(detailSrc));
  // The breakdown modal is computed from the LEGACY estimate only, while
  // heroTotal comes from effectiveEstimateTotal (which prefers linkedEstimate).
  // Offering the tap when both exist puts two disagreeing numbers on one card.
  ok('the breakdown tap is withheld when the legacy estimate is not the headline',
    /estimate && !linkedEstimate \? openDetail\('total'\) : undefined/.test(detailSrc) &&
    !/\{heroLabel\}\{estimate \? ' · Tap for breakdown' : ''\}/.test(detailSrc));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
