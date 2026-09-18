// utils/paymentTerms.ts — the ONE place a GC's payment split and workmanship
// warranty become rows, cents, contract milestones, warranty sentences or copy.
//
// WHY THIS EXISTS. Before it, every client-facing document carried terms nobody
// chose, and no two agreed: the quick-estimate PDF and the wizard preview
// printed 25 / 65 / 10, the Review share link and the portal proposal printed a
// 10% deposit (utils/clientEstimateView.defaultPaymentSchedule), and a new
// contract seeded 25 / 25 / 25 / 25 with a one-year warranty paragraph
// (utils/contractEngine). A homeowner could hold three different deposits for
// the same job. Direction B ("Ask when it matters") replaces every literal with
// the GC's own answer, asked the first time a document is about to print it
// and saved once on profiles (20260917150000_profiles_payment_terms.sql).
//
// RULES THIS FILE KEEPS
//   · No generator keeps a literal or a fallback. "Not set" is a state the
//     caller must handle (ask, or say "not set yet"), never a number.
//   · One amount function (stageAmounts). The printed deposit and final are the
//     exact cents utils/billingFlowCore.milestoneBillableAmount bills for a
//     percent row at the same contract value — billing refuses a milestone even
//     1 cent over what is left, so a second rounding rule here would make a
//     signed schedule unbillable.
//   · Bounds equal the database CHECKs. A CHECK violation is TERMINAL in the
//     offline queue; the validators below refuse everything the CHECK would.
//   · A portal stamp only ever copies the saved terms, and replacing one needs
//     proof the client has not accepted (nextProposalStamp).
//
// Pure: imports only @/types and ./generateId — no react-native, expo,
// supabase, or billingFlowCore (the guard imports billingFlowCore to prove
// parity; importing it here would make that proof circular).
// Guard: scripts/validate-payment-terms.ts.

import type {
  AppSettings,
  ClientPortalSettings,
  PaymentMilestone,
  PaymentSplit,
  Project,
  ProposalPaymentTerms,
} from '@/types';
import { generateUUID } from './generateId';

// ─── Bounds (== the CHECKs in 20260917150000) ────────────────────────────────

export const PAYMENT_SPLIT_BOUNDS = { min: 0, max: 100, sum: 100 } as const;
export const WARRANTY_MONTHS_BOUNDS = { min: 1, max: 120 } as const;

/** profiles columns, in the order the split is written. */
export const PAYMENT_SPLIT_COLUMNS = ['deposit_pct', 'progress_pct', 'final_pct'] as const;
export const WARRANTY_MONTHS_COLUMN = 'warranty_months' as const;

// ─── Validation ──────────────────────────────────────────────────────────────

type RawPercent = string | number | null | undefined;

/**
 * A whole percent as typed. `'25'`, `' 25 '`, `'25%'` and `25` are 25. `''` is
 * missing. `'2.5'`, `'-1'`, `'abc'`, `NaN` and `2.5` are invalid — a decimal
 * cannot reach a smallint column, and silently rounding a deposit he typed is
 * the product changing a contract term.
 */
function parseWholeNumber(raw: RawPercent): number | 'missing' | 'invalid' {
  if (raw == null) return 'missing';
  if (typeof raw === 'number') {
    return Number.isInteger(raw) ? raw : 'invalid';
  }
  const trimmed = String(raw).trim().replace(/\s*%$/, '').trim();
  if (trimmed === '') return 'missing';
  if (!/^\d+$/.test(trimmed)) return 'invalid';
  return Number(trimmed);
}

export type SplitValidation =
  | { ok: true; split: PaymentSplit }
  | { ok: false; reason: string };

const STAGE_NAMES = { deposit: 'deposit', progress: 'progress', final: 'final' } as const;

export function validatePaymentSplit(input: { deposit: RawPercent; progress: RawPercent; final: RawPercent }): SplitValidation {
  const values: Record<keyof typeof STAGE_NAMES, number> = { deposit: 0, progress: 0, final: 0 };
  for (const key of ['deposit', 'progress', 'final'] as const) {
    const parsed = parseWholeNumber(input[key]);
    if (parsed === 'missing') {
      return { ok: false, reason: `Enter the ${STAGE_NAMES[key]} percent — a whole number from 0 to 100.` };
    }
    if (parsed === 'invalid' || parsed < PAYMENT_SPLIT_BOUNDS.min || parsed > PAYMENT_SPLIT_BOUNDS.max) {
      return { ok: false, reason: `The ${STAGE_NAMES[key]} needs to be a whole percent from 0 to 100.` };
    }
    values[key] = parsed;
  }
  const sum = values.deposit + values.progress + values.final;
  if (sum !== PAYMENT_SPLIT_BOUNDS.sum) {
    return { ok: false, reason: `Adds up to ${sum}% — deposit, progress and final need to total 100%.` };
  }
  return { ok: true, split: { depositPct: values.deposit, progressPct: values.progress, finalPct: values.final } };
}

export type WarrantyValidation = { ok: true; months: number } | { ok: false; reason: string };

export function validateWarrantyMonths(raw: RawPercent): WarrantyValidation {
  const parsed = parseWholeNumber(raw);
  if (parsed === 'missing') return { ok: false, reason: 'Enter how many months you warrant your work — 1 to 120.' };
  if (parsed === 'invalid' || parsed < WARRANTY_MONTHS_BOUNDS.min || parsed > WARRANTY_MONTHS_BOUNDS.max) {
    return { ok: false, reason: 'The warranty needs to be a whole number of months from 1 to 120.' };
  }
  return { ok: true, months: parsed };
}

/** A stored split (DB row, cache, record), all-or-none, or undefined. */
export function coercePaymentSplit(d: unknown, p: unknown, f: unknown): PaymentSplit | undefined {
  const asRaw = (v: unknown): RawPercent => (typeof v === 'number' || typeof v === 'string' ? v : undefined);
  const v = validatePaymentSplit({ deposit: asRaw(d), progress: asRaw(p), final: asRaw(f) });
  return v.ok ? v.split : undefined;
}

export function coerceWarrantyMonths(raw: unknown): number | undefined {
  if (typeof raw !== 'number' && typeof raw !== 'string') return undefined;
  const v = validateWarrantyMonths(raw);
  return v.ok ? v.months : undefined;
}

/** True when `x` is a valid split object (depositPct/progressPct/finalPct). */
export function isValidSplit(x: unknown): x is PaymentSplit {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return typeof o.depositPct === 'number' && typeof o.progressPct === 'number' && typeof o.finalPct === 'number'
    && coercePaymentSplit(o.depositPct, o.progressPct, o.finalPct) !== undefined;
}

export interface TermsColumns {
  split?: { deposit_pct: number; progress_pct: number; final_pct: number };
  warranty?: { warranty_months: number };
}

/**
 * The profiles columns a terms save sends, or a refusal. Anything the CHECK
 * would reject is refused HERE, so no write that could be terminally dropped
 * by the offline queue is ever enqueued.
 */
export function termsColumnsForWrite(input: { split?: unknown; warrantyMonths?: unknown }): TermsColumns | { refused: string } {
  const out: TermsColumns = {};
  if (input.split !== undefined) {
    if (!isValidSplit(input.split)) return { refused: 'Payment terms need whole percents that total 100%.' };
    out.split = { deposit_pct: input.split.depositPct, progress_pct: input.split.progressPct, final_pct: input.split.finalPct };
  }
  if (input.warrantyMonths !== undefined) {
    const months = typeof input.warrantyMonths === 'number' ? coerceWarrantyMonths(input.warrantyMonths) : undefined;
    if (months === undefined) return { refused: 'The warranty needs to be a whole number of months from 1 to 120.' };
    out.warranty = { warranty_months: months };
  }
  return out;
}

// ─── Load ────────────────────────────────────────────────────────────────────

export interface QueueEntryLikeForTerms {
  table: string;
  operation: string;
  data: Record<string, unknown>;
}

/**
 * Whether a terms write for this user is still waiting in the offline queue.
 * Only a profiles UPDATE that CARRIES the terms columns counts — the
 * onboarding_complete and user_role writes also update profiles, and treating
 * them as pending would keep a stale device copy over the server's answer.
 */
export function termsWritesPending(
  queue: readonly QueueEntryLikeForTerms[],
  userId: string | null | undefined,
): { split: boolean; warranty: boolean } {
  const out = { split: false, warranty: false };
  if (!userId) return out;
  for (const e of queue) {
    if (e.table !== 'profiles' || e.operation !== 'update' || e.data?.id !== userId) continue;
    if ('deposit_pct' in e.data) out.split = true;
    if (WARRANTY_MONTHS_COLUMN in e.data) out.warranty = true;
  }
  return out;
}

/**
 * Folds "a terms write is still on the wire" into the queue's per-group answer.
 * supabaseWrite tries the network BEFORE it queues, so an empty queue does not
 * mean nothing is pending: a refetch that raced the write would otherwise let
 * the pre-answer row (NULL columns) win and ask him again. In flight is not
 * per-group (the save issues both writes together), so it marks both.
 * Returns an object, never `queue || inFlight` — an object is always truthy
 * and would swallow the in-flight half.
 */
export function pendingWithInFlight(
  queued: { split: boolean; warranty: boolean },
  inFlight: boolean,
): { split: boolean; warranty: boolean } {
  return { split: queued.split || inFlight, warranty: queued.warranty || inFlight };
}

/**
 * The terms a server load leaves on AppSettings, per group (split / warranty):
 *   · the row HAS the column(s) and nothing is queued → the server's value
 *     (NULL → absent: never asked, or cleared elsewhere);
 *   · otherwise → the device's cached value, validated. Column missing means
 *     the migration has not landed; a queued write means the SELECT is older
 *     than the answer. Dropping the cache in either case would ask again.
 */
export function paymentTermsAfterLoad(input: {
  row: Record<string, unknown> | null | undefined;
  cached: Partial<AppSettings> | null | undefined;
  pending: { split: boolean; warranty: boolean };
}): Pick<AppSettings, 'paymentSplit' | 'warrantyMonths'> {
  const { row, cached, pending } = input;
  const out: Pick<AppSettings, 'paymentSplit' | 'warrantyMonths'> = {};

  const rowHasSplit = !!row && PAYMENT_SPLIT_COLUMNS.every((c) => c in row);
  const split = rowHasSplit && !pending.split
    ? coercePaymentSplit(row!.deposit_pct, row!.progress_pct, row!.final_pct)
    : (isValidSplit(cached?.paymentSplit) ? cached!.paymentSplit : undefined);
  if (split) out.paymentSplit = { depositPct: split.depositPct, progressPct: split.progressPct, finalPct: split.finalPct };

  const rowHasWarranty = !!row && WARRANTY_MONTHS_COLUMN in row;
  const months = rowHasWarranty && !pending.warranty
    ? coerceWarrantyMonths(row![WARRANTY_MONTHS_COLUMN])
    : coerceWarrantyMonths(cached?.warrantyMonths);
  if (months !== undefined) out.warrantyMonths = months;

  return out;
}

// ─── Resolution ──────────────────────────────────────────────────────────────

export type ResolvedSplit =
  | { split: PaymentSplit; source: 'record' | 'profile' }
  | { split: null; source: 'not_set' };

/**
 * The split a document prints. A job's own record (a portal stamp, a contract
 * draft's answer) wins; an invalid record is ignored rather than trusted; then
 * the profile; otherwise not set — which the caller must ask about or label.
 */
export function resolvePaymentSplit(input: { record?: unknown; settings?: Pick<AppSettings, 'paymentSplit'> | null }): ResolvedSplit {
  if (isValidSplit(input.record)) return { split: pickSplit(input.record), source: 'record' };
  if (isValidSplit(input.settings?.paymentSplit)) return { split: pickSplit(input.settings!.paymentSplit), source: 'profile' };
  return { split: null, source: 'not_set' };
}

export function resolveWarrantyMonths(settings: Pick<AppSettings, 'warrantyMonths'> | null | undefined): number | null {
  return coerceWarrantyMonths(settings?.warrantyMonths) ?? null;
}

function pickSplit(s: PaymentSplit): PaymentSplit {
  return { depositPct: s.depositPct, progressPct: s.progressPct, finalPct: s.finalPct };
}

/** '25 / 65 / 10' — deposit / progress / final. */
export function splitLabel(s: PaymentSplit): string {
  return `${s.depositPct} / ${s.progressPct} / ${s.finalPct}`;
}

export function sameSplit(a: PaymentSplit | null | undefined, b: PaymentSplit | null | undefined): boolean {
  if (!a || !b) return false;
  return a.depositPct === b.depositPct && a.progressPct === b.progressPct && a.finalPct === b.finalPct;
}

// ─── Money — the one amount function ─────────────────────────────────────────

/** Integer cents of `value × pct%`, computed EXACTLY the way billingFlowCore's
 *  toCents(contractValue × (percent / 100)) does, so the two can never differ. */
function percentCents(value: number, pct: number): number {
  return Math.round(value * (pct / 100) * 100);
}

function totalCents(value: number): number {
  return Math.round(value * 100);
}

function safeTotal(total: number): number {
  return Number.isFinite(total) && total > 0 ? total : 0;
}

/**
 * Dollar amounts (to the cent) of the three stages. They add up to exactly
 * cents(total).
 *
 *   deposit = cents(total × d%)            — what billing bills for the row
 *   final   = cents(total × f%)            — likewise
 *   progress = cents(total) − deposit − final
 *
 * Progress takes the remainder because it is the one stage billing never bills
 * as a lump (it is billed as work is completed), so the rounding cent lands
 * where nobody is refused over it. Two edges, both sub-cent rounding:
 *   · progress is 0% — then the remainder belongs to final, or the schedule
 *     would not foot (e.g. $100.01 at 50 / 0 / 50 rounds both halves up);
 *   · a remainder that would go negative (totals under a dollar) is taken from
 *     final instead of printing a negative progress payment.
 */
export function stageAmounts(total: number, split: PaymentSplit): { deposit: number; progress: number; final: number } {
  const t = safeTotal(total);
  const all = totalCents(t);
  const deposit = Math.min(all, percentCents(t, split.depositPct));
  let final = percentCents(t, split.finalPct);
  let progress = all - deposit - final;
  if (split.progressPct === 0 || progress < 0) {
    final = all - deposit;
    progress = 0;
  }
  return { deposit: deposit / 100, progress: progress / 100, final: final / 100 };
}

export type PaymentStageKey = 'deposit' | 'progress' | 'final';

export const PAYMENT_STAGE_COPY: Record<PaymentStageKey, { label: string; detail: string }> & { depositNone: string } = {
  deposit: { label: 'Deposit', detail: 'Due on signing' },
  progress: { label: 'Progress payments', detail: 'Billed as work is completed' },
  final: { label: 'Final payment', detail: 'Due at substantial completion' },
  depositNone: 'No deposit',
};

export interface PaymentStageRow {
  key: PaymentStageKey;
  label: string;
  detail: string;
  pct: number;
  amount: number;
}

/**
 * The rows a document prints. The deposit row is ALWAYS present — a 0% deposit
 * prints "No deposit" at $0, so anything that highlights the first row as "due
 * now" stays true. Progress and final rows are left out at 0%.
 */
export function paymentStageRows(total: number, split: PaymentSplit): PaymentStageRow[] {
  const a = stageAmounts(total, split);
  const rows: PaymentStageRow[] = [{
    key: 'deposit',
    label: PAYMENT_STAGE_COPY.deposit.label,
    detail: split.depositPct === 0 ? PAYMENT_STAGE_COPY.depositNone : PAYMENT_STAGE_COPY.deposit.detail,
    pct: split.depositPct,
    amount: a.deposit,
  }];
  if (split.progressPct > 0) {
    rows.push({ key: 'progress', label: PAYMENT_STAGE_COPY.progress.label, detail: PAYMENT_STAGE_COPY.progress.detail, pct: split.progressPct, amount: a.progress });
  }
  if (split.finalPct > 0) {
    rows.push({ key: 'final', label: PAYMENT_STAGE_COPY.final.label, detail: PAYMENT_STAGE_COPY.final.detail, pct: split.finalPct, amount: a.final });
  }
  return rows;
}

/** A proposal's payment line — structurally utils/clientEstimateView's
 *  PaymentMilestone ({ label, detail, amount? }), declared here so this file
 *  does not import the view module. */
export interface ProposalPaymentLine { label: string; detail: string; amount?: number }

/** 'Due on signing · 25%'; a 0% deposit reads 'No deposit'. */
export function proposalPaymentLines(total: number, split: PaymentSplit): ProposalPaymentLine[] {
  return paymentStageRows(total, split).map((r) => ({
    label: r.label,
    detail: r.key === 'deposit' && r.pct === 0 ? r.detail : `${r.detail} · ${r.pct}%`,
    amount: r.amount,
  }));
}

/**
 * A contract's payment schedule from the split. Amounts come from stageAmounts,
 * and a 0% stage (deposit included — a signed contract has no business billing
 * $0) is omitted. The progress row is `on_invoice`: it is billed as work is
 * completed, never as one lump invoice.
 *
 * `percent` is on every row EXCEPT a final row that carries the rounding
 * remainder. billingFlowCore.milestoneBillableAmount bills a percent row as
 * cents(value × pct) and ignores its stored amount, so a remainder row with a
 * percent would bill a cent more than the contract printed — and after the
 * deposit is billed, billing refuses anything over what is left (at 50 / 0 / 50
 * of $100.01 the deposit bills $50.01, $50.00 remains, and a percent final
 * would ask for $50.01 and be refused as fully billed). With no progress row
 * the final ALWAYS carries the remainder, so it is always amount-only there —
 * one shape, not one that flickers with the cents. retieContractSchedule knows
 * that shape and keeps it footing.
 */
export function contractScheduleFromSplit(
  value: number,
  split: PaymentSplit,
  newId: () => string = generateUUID,
): PaymentMilestone[] {
  const t = safeTotal(value);
  const a = stageAmounts(t, split);
  const out: PaymentMilestone[] = [];
  if (split.depositPct > 0) {
    out.push({ id: newId(), label: PAYMENT_STAGE_COPY.deposit.label, trigger: 'on_signing', percent: split.depositPct, amount: a.deposit, status: 'pending' });
  }
  if (split.progressPct > 0) {
    out.push({ id: newId(), label: PAYMENT_STAGE_COPY.progress.label, trigger: 'on_invoice', percent: split.progressPct, amount: a.progress, status: 'pending' });
  }
  if (split.finalPct > 0) {
    const finalCents = Math.round(a.final * 100);
    const carriesRemainder = split.progressPct === 0 || finalCents !== percentCents(t, split.finalPct);
    out.push(carriesRemainder
      ? { id: newId(), label: PAYMENT_STAGE_COPY.final.label, trigger: 'on_final', amount: a.final, status: 'pending' }
      : { id: newId(), label: PAYMENT_STAGE_COPY.final.label, trigger: 'on_final', percent: split.finalPct, amount: a.final, status: 'pending' });
  }
  return out;
}

/**
 * Re-tie a schedule's cached amounts to a new contract value. Percent rows
 * become cents(value × pct%); rows without a percent (a fixed amount he typed)
 * are untouched — with one exception below. The remainder cent goes where
 * stageAmounts puts it, so the schedule still foots to the cent:
 *   · all-percent summing to 100 with a single `on_invoice` row → that row
 *     (never billed as a lump, so no billing ceiling can refuse it);
 *   · no `on_invoice` row → the single `on_final` row, which is then written
 *     amount-only (see contractScheduleFromSplit for why a remainder row may
 *     not keep a percent). That covers both an all-percent schedule summing to
 *     100 and the shape contractScheduleFromSplit writes with no progress row:
 *     every other row a percent summing under 100 (or no other row — 0 / 0 /
 *     100), the final amount-only.
 *     A final amount he typed on such a schedule is re-tied too — after a
 *     value change the balance is the only final amount that foots.
 */
export function retieContractSchedule(value: number, schedule: readonly PaymentMilestone[]): PaymentMilestone[] {
  const t = safeTotal(value);
  const hasPct = (m: PaymentMilestone) => m.percent != null && Number.isFinite(m.percent);
  const next = schedule.map((m) => (hasPct(m) ? { ...m, amount: percentCents(t, m.percent as number) / 100 } : { ...m }));
  const invoiceRows = next.filter((m) => m.trigger === 'on_invoice');
  const finalRows = next.filter((m) => m.trigger === 'on_final');
  const pctSumOf = (rows: PaymentMilestone[]) => rows.reduce((s, m) => s + (m.percent ?? 0), 0);
  const allPercent = next.length > 0 && next.every(hasPct);
  const centsOf = (rows: PaymentMilestone[]) => rows.reduce((s, m) => s + Math.round((m.amount ?? 0) * 100), 0);

  if (allPercent && pctSumOf(next) === 100 && invoiceRows.length === 1) {
    const row = invoiceRows[0];
    row.amount = Math.max(0, totalCents(t) - centsOf(next.filter((m) => m !== row))) / 100;
    return next;
  }
  if (invoiceRows.length === 0 && finalRows.length === 1) {
    const row = finalRows[0];
    const others = next.filter((m) => m !== row);
    const balanceShape = !hasPct(row) && others.every(hasPct) && pctSumOf(others) < 100;
    if ((allPercent && pctSumOf(next) === 100) || balanceShape) {
      row.amount = Math.max(0, totalCents(t) - centsOf(others)) / 100;
      delete row.percent;
    }
  }
  return next;
}

/** The "when" a schedule row prints when it has no date. */
export function milestoneDueText(m: Pick<PaymentMilestone, 'trigger' | 'triggerDate' | 'triggerMilestone'>): string {
  switch (m.trigger) {
    case 'on_signing': return PAYMENT_STAGE_COPY.deposit.detail;
    case 'on_invoice': return PAYMENT_STAGE_COPY.progress.detail;
    case 'on_final':   return PAYMENT_STAGE_COPY.final.detail;
    case 'on_date':    return m.triggerDate ? `Due ${m.triggerDate}` : 'Due on a scheduled date';
    default:           return m.triggerMilestone?.trim() || 'Contract payment milestone';
  }
}

/**
 * The 25 / 25 / 25 / 25 schedule utils/contractEngine seeded before this change
 * (labels, triggers and percents exactly). A saved draft still carrying it is
 * MAGE's placeholder, not the GC's terms — the contract screen says so with a
 * banner and never rewrites it silently.
 */
export const LEGACY_SEED_SCHEDULE: readonly { label: string; trigger: PaymentMilestone['trigger']; percent: number }[] = [
  { label: 'Deposit (signing)', trigger: 'on_signing', percent: 25 },
  { label: 'Rough-in / framing complete', trigger: 'on_milestone', percent: 25 },
  { label: 'Finishes complete', trigger: 'on_milestone', percent: 25 },
  { label: 'Substantial completion', trigger: 'on_final', percent: 25 },
];

export function isLegacySeedSchedule(schedule: readonly Pick<PaymentMilestone, 'label' | 'trigger' | 'percent'>[] | null | undefined): boolean {
  if (!schedule || schedule.length !== LEGACY_SEED_SCHEDULE.length) return false;
  return LEGACY_SEED_SCHEDULE.every((seed, i) => {
    const m = schedule[i];
    return m.label === seed.label && m.trigger === seed.trigger && m.percent === seed.percent;
  });
}

/** The proposal's closing sentence. It mentions a deposit only when there is one. */
export function acceptanceSentence(split: PaymentSplit | null): string {
  const lead = 'To proceed, please reply to this estimate with your approval, and we’ll prepare a formal contract reflecting the scope and terms above.';
  return split && split.depositPct > 0
    ? `${lead} Final pricing is locked once the contract is signed and the deposit received.`
    : `${lead} Final pricing is locked once the contract is signed.`;
}

// ─── Warranty ────────────────────────────────────────────────────────────────

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** 1..999 in words, the way a contract spells a number. */
function numberWords(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
  const rest = n % 100;
  return `${ONES[Math.floor(n / 100)]} hundred${rest ? ` ${numberWords(rest)}` : ''}`;
}

/** Whole years when the months divide by 12, otherwise months. */
function warrantyUnits(months: number): { n: number; unit: 'year' | 'month' } {
  return months % 12 === 0 ? { n: months / 12, unit: 'year' } : { n: months, unit: 'month' };
}

/** 'one (1) year', 'eighteen (18) months', 'ten (10) years'. */
export function warrantyPeriodPhrase(months: number): string {
  const { n, unit } = warrantyUnits(months);
  return `${numberWords(n)} (${n}) ${unit}${n === 1 ? '' : 's'}`;
}

/** '2 years', '18 months', '1 year'. */
export function warrantyShortLabel(months: number): string {
  const { n, unit } = warrantyUnits(months);
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/** Printed where the period goes until he answers. Visible on purpose: a
 *  contract must never quietly promise a period nobody chose. */
export const WARRANTY_PERIOD_PLACEHOLDER = '[warranty period — set before signing]';

/** The paragraph utils/contractEngine seeded before this change, exactly. */
export const LEGACY_WARRANTY_TEXT = `
The Contractor warrants the workmanship of the project for one (1) year from the date of substantial completion. Defects in workmanship reported in writing during the warranty period will be corrected at no additional cost.

Materials and appliances are covered by their respective manufacturer warranties, which pass through to the Owner. The Contractor will provide warranty documentation in the closeout binder.

This warranty does not cover damage from normal wear and tear, neglect, abuse, modifications by others, or acts of God.
`.trim();

/** The contract's warranty paragraph for his months, or with the placeholder. */
export function contractWarrantyText(months: number | null): string {
  const valid = months == null ? undefined : coerceWarrantyMonths(months);
  const period = valid === undefined ? WARRANTY_PERIOD_PLACEHOLDER : warrantyPeriodPhrase(valid);
  return LEGACY_WARRANTY_TEXT.replace('one (1) year', period);
}

export function hasWarrantyPlaceholder(text: string | null | undefined): boolean {
  return (text ?? '').includes(WARRANTY_PERIOD_PLACEHOLDER);
}

/** The live sentence under the warranty field. */
export function warrantySentence(months: number): string {
  return `…warrants the workmanship … for ${warrantyPeriodPhrase(months)} from the date of substantial completion.`;
}

/** A tier quote's inclusion line: his period, or no period at all. */
export function workmanshipWarrantyLine(months: number | null): string {
  const valid = months == null ? undefined : coerceWarrantyMonths(months);
  return valid === undefined ? 'Workmanship warranty' : `Workmanship warranty (${warrantyShortLabel(valid)})`;
}

// ─── Portal stamp ────────────────────────────────────────────────────────────

export function isValidStamp(x: unknown): x is ProposalPaymentTerms {
  if (!isValidSplit(x)) return false;
  const confirmedAt = (x as unknown as { confirmedAt?: unknown }).confirmedAt;
  return typeof confirmedAt === 'string' && confirmedAt.length > 0;
}

/** Whether the client has accepted this project's proposal, as last read. */
export type AcceptanceState = 'none' | 'accepted' | 'unknown';

export const ACCEPTANCE_UNKNOWN_REASON = 'Couldn’t check whether your client already accepted — try again.';

/**
 * The stamp to write when he publishes, confirms, or uses his current terms.
 *   · a valid stamp with the same split is KEPT, confirmedAt included;
 *   · a FIRST stamp is always allowed — a proposal without one cannot be
 *     accepted, so no signed text can change;
 *   · REPLACING a stamp needs acceptance === 'none', read fresh by the caller.
 */
export function nextProposalStamp(input: {
  existing: unknown;
  split: PaymentSplit;
  acceptance: AcceptanceState;
  nowIso: string;
}): { stamp: ProposalPaymentTerms } | { refused: string } {
  const { existing, split, acceptance, nowIso } = input;
  if (!isValidSplit(split)) return { refused: 'Payment terms need whole percents that total 100%.' };
  const fresh: ProposalPaymentTerms = { ...pickSplit(split), confirmedAt: nowIso };
  if (!isValidStamp(existing)) return { stamp: fresh };
  if (sameSplit(existing, split)) return { stamp: { ...pickSplit(existing), confirmedAt: existing.confirmedAt } };
  if (acceptance === 'accepted') {
    return { refused: `Your client accepted this proposal on ${splitLabel(existing)} — those terms can’t change.` };
  }
  if (acceptance === 'unknown') return { refused: ACCEPTANCE_UNKNOWN_REASON };
  return { stamp: fresh };
}

export type ProposalTermsState =
  | { state: 'off' }
  | { state: 'unconfirmed'; action: 'use-profile'; profileSplit: PaymentSplit }
  | { state: 'unconfirmed'; action: 'ask' }
  | { state: 'current'; stamp: ProposalPaymentTerms }
  | { state: 'differs'; stamp: ProposalPaymentTerms; profileSplit: PaymentSplit; action: 'use-current' }
  | { state: 'differs'; stamp: ProposalPaymentTerms; profileSplit: PaymentSplit; action: 'blocked'; reason: string }
  | { state: 'locked'; stamp: ProposalPaymentTerms };

/** What the portal-setup row under "Accept the proposal" shows. */
export function proposalTermsState(input: {
  portal: ClientPortalSettings | null | undefined;
  profileSplit: PaymentSplit | null | undefined;
  acceptance: AcceptanceState;
}): ProposalTermsState {
  const { portal, acceptance } = input;
  const profileSplit = isValidSplit(input.profileSplit) ? pickSplit(input.profileSplit) : null;
  if (!portal?.enabled || !portal.proposalApprovalEnabled) return { state: 'off' };
  const stamp = portal.proposalPaymentTerms;
  if (!isValidStamp(stamp)) {
    return profileSplit ? { state: 'unconfirmed', action: 'use-profile', profileSplit } : { state: 'unconfirmed', action: 'ask' };
  }
  if (acceptance === 'accepted') return { state: 'locked', stamp };
  if (profileSplit && !sameSplit(stamp, profileSplit)) {
    return acceptance === 'none'
      ? { state: 'differs', stamp, profileSplit, action: 'use-current' }
      : { state: 'differs', stamp, profileSplit, action: 'blocked', reason: ACCEPTANCE_UNKNOWN_REASON };
  }
  return { state: 'current', stamp };
}

/**
 * Classify a proposal_approvals read. A missing table is 'none' — the
 * acceptance migration is held, so no acceptance can exist yet. Any OTHER
 * error is 'unknown', which blocks replacing a stamp: treating a failed read
 * as "nobody accepted" is how signed text would get rewritten.
 */
export function acceptanceStateFromRead(res: {
  data: unknown;
  error: { code?: string | null; message?: string | null } | null | undefined;
}): AcceptanceState {
  if (res.error) {
    const code = res.error.code ?? '';
    const msg = res.error.message ?? '';
    // Only a missing TABLE. "column … does not exist" (42703) or a missing
    // function means the table IS there and the read broke — 'unknown'.
    if (code === 'PGRST205' || code === '42P01') return 'none';
    if (!code && /could not find the table|relation "?[\w.]+"? does not exist/i.test(msg)) return 'none';
    return 'unknown';
  }
  return Array.isArray(res.data) && res.data.length > 0 ? 'accepted' : 'none';
}

/**
 * OWNED projects whose portal is on with the proposal switched on and no valid
 * stamp — the portals from before this change, published read-only until he
 * confirms. The first "Use on every job" stamps these. A project he only
 * collaborates on is never stamped from his profile.
 */
export function portalsNeedingTerms(
  projects: readonly Pick<Project, 'id' | 'ownerUserId' | 'clientPortal'>[],
  userId: string | null | undefined,
): Pick<Project, 'id' | 'ownerUserId' | 'clientPortal'>[] {
  if (!userId) return [];
  return projects.filter((p) => p.ownerUserId === userId
    && !!p.clientPortal?.enabled
    && !!p.clientPortal.proposalApprovalEnabled
    && !isValidStamp(p.clientPortal.proposalPaymentTerms));
}
