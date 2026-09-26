// utils/backcharges.ts — backcharges against a sub: the damage, the cleanup,
// the rework he did not do, with a photo, taken off the sub's next bill.
//
// Pure: no React, no storage, no clock (callers pass nowIso). The hook
// (hooks/useBackcharges.ts) persists the list device-local under a mageid_
// key, so the tenant sweep on sign-out clears it; a synced table is deferred.
//
// MONEY: integer cents everywhere. Dollars appear only at the edge
// (formatCents below, for the notice text and the screens).
//
// The deduction rule is deliberately blunt: a backcharge comes off a bill
// WHOLE or not at all. Splitting one silently across two bills is how a GC
// ends up unable to say which invoice paid for which broken window.
//
// Pinned by scripts/validate-backcharges.ts.

import { formatMoney } from '@/utils/formatters';

export const BACKCHARGES_KEY = 'mageid_backcharges';

export type BackchargeStatus = 'open' | 'applied' | 'void';

export interface Backcharge {
  id: string;
  projectId: string;
  subId: string;
  subName: string;
  commitmentId: string | null;
  reason: string;
  /** Integer cents, > 0. */
  amountCents: number;
  /** 'hours_x_rate': amountCents === Math.round(hours × rateCents). */
  basis: 'typed' | 'hours_x_rate';
  hours: number | null;
  rateCents: number | null;
  photoUri: string | null;
  /** The ProjectPhoto (durable, uploaded) that carries the picture. */
  photoId: string | null;
  punchItemId: string | null;
  status: BackchargeStatus;
  appliedInvoiceId: string | null;
  appliedAt: string | null;
  createdAt: string;
}

const STATUSES: readonly BackchargeStatus[] = ['open', 'applied', 'void'];

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}
function optStr(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
function optNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Never throws. Drops any row with a missing id, a non-integer or ≤ 0
 *  amount, or an unknown status — a half-row must not become a deduction. */
export function parseBackcharges(raw: string | null | undefined): Backcharge[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: Backcharge[] = [];
  for (const r of parsed) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const id = str(o.id);
    const projectId = str(o.projectId);
    const subId = str(o.subId);
    const reason = str(o.reason);
    const createdAt = str(o.createdAt);
    const amountCents = o.amountCents;
    if (!id || !projectId || !subId || !reason || !createdAt) continue;
    if (typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents <= 0) continue;
    const status = STATUSES.includes(o.status as BackchargeStatus) ? (o.status as BackchargeStatus) : null;
    if (!status) continue;
    out.push({
      id, projectId, subId,
      subName: typeof o.subName === 'string' ? o.subName : '',
      commitmentId: optStr(o.commitmentId),
      reason,
      amountCents,
      basis: o.basis === 'hours_x_rate' ? 'hours_x_rate' : 'typed',
      hours: optNum(o.hours),
      rateCents: optNum(o.rateCents),
      photoUri: optStr(o.photoUri),
      photoId: optStr(o.photoId),
      punchItemId: optStr(o.punchItemId),
      status,
      appliedInvoiceId: optStr(o.appliedInvoiceId),
      appliedAt: optStr(o.appliedAt),
      createdAt,
    });
  }
  return out;
}

/** The open backcharges on one sub on one job, oldest first. */
export function openFor(list: Backcharge[], projectId: string, subId: string): Backcharge[] {
  return list
    .filter(b => b.status === 'open' && b.projectId === projectId && b.subId === subId)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

export class BackchargeHoursError extends Error {
  readonly kind: 'hours' | 'rate';
  constructor(kind: 'hours' | 'rate', message: string) {
    super(message);
    this.kind = kind;
    this.name = 'BackchargeHoursError';
  }
}

export const MAX_BACKCHARGE_HOURS = 200;

/** Hours × his labor rate, in cents. Throws a BackchargeHoursError (whose
 *  message is the words the sheet shows) outside 0 < hours ≤ 200. */
export function amountFromHours(hours: number, rateCents: number): number {
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new BackchargeHoursError('hours', 'Hours must be more than zero.');
  }
  if (hours > MAX_BACKCHARGE_HOURS) {
    throw new BackchargeHoursError('hours', `That is more than ${MAX_BACKCHARGE_HOURS} hours — type the amount instead.`);
  }
  if (!Number.isInteger(rateCents) || rateCents <= 0) {
    throw new BackchargeHoursError('rate', 'No labor rate on file — type the amount.');
  }
  return Math.round(hours * rateCents);
}

export interface DeductionPlan {
  deductCents: number;
  payCents: number;
  applied: Backcharge[];
  carried: Backcharge[];
}

/**
 * What comes off this bill. Oldest first; each backcharge whole or not at
 * all; stop at the first one that would push the running total past the bill
 * (so the carry order stays oldest first); the rest carries to the next bill.
 */
export function planDeduction(invoiceAmountCents: number, open: Backcharge[]): DeductionPlan {
  const bill = Number.isFinite(invoiceAmountCents) ? Math.max(0, Math.round(invoiceAmountCents)) : 0;
  const ordered = [...open]
    .filter(b => b.status === 'open')
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const applied: Backcharge[] = [];
  const carried: Backcharge[] = [];
  let running = 0;
  let stopped = false;
  for (const b of ordered) {
    if (!stopped && running + b.amountCents <= bill) {
      running += b.amountCents;
      applied.push(b);
    } else {
      stopped = true;
      carried.push(b);
    }
  }
  return { deductCents: running, payCents: Math.max(0, bill - running), applied, carried };
}

/** Mark the given open backcharges as taken off `invoiceId`. Anything not
 *  open (already applied, void) is left exactly as it was. */
export function markApplied(list: Backcharge[], ids: string[], invoiceId: string, nowIso: string): Backcharge[] {
  const set = new Set(ids);
  return list.map(b => (set.has(b.id) && b.status === 'open'
    ? { ...b, status: 'applied' as const, appliedInvoiceId: invoiceId, appliedAt: nowIso }
    : b));
}

/**
 * What one submitted invoice's deduction card shows. The simplest provable
 * rule: once ANY backcharge has been taken off this bill, the card only shows
 * that recorded deduction (no further Apply) and the open items wait for the
 * next bill — so the total applied to one bill can never exceed it.
 *  - 'recorded': this bill already carries a deduction.
 *  - 'plan':     nothing recorded here yet and the sub has open items.
 *  - 'none':     nothing to show.
 */
export type InvoiceDeduction =
  | { kind: 'none' }
  | { kind: 'recorded'; appliedHere: Backcharge[]; deductCents: number; payCents: number; openAfter: Backcharge[] }
  | { kind: 'plan'; open: Backcharge[]; plan: DeductionPlan };

export function invoiceDeduction(
  list: Backcharge[], projectId: string, subId: string, invoiceId: string, billCents: number,
): InvoiceDeduction {
  const bill = Number.isFinite(billCents) ? Math.max(0, Math.round(billCents)) : 0;
  const open = openFor(list, projectId, subId);
  const appliedHere = list
    .filter(b => b.status === 'applied' && b.appliedInvoiceId === invoiceId && b.projectId === projectId && b.subId === subId)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  if (appliedHere.length > 0) {
    const deductCents = sumCents(appliedHere);
    return { kind: 'recorded', appliedHere, deductCents, payCents: Math.max(0, bill - deductCents), openAfter: open };
  }
  if (open.length === 0) return { kind: 'none' };
  return { kind: 'plan', open, plan: planDeduction(bill, open) };
}

/** Dollars from integer cents, for display only. */
export function formatCents(cents: number): string {
  return formatMoney(cents / 100, cents % 100 === 0 ? 0 : 2);
}

export function sumCents(items: readonly Backcharge[]): number {
  return items.reduce((s, b) => s + b.amountCents, 0);
}

/** A plain draft the GC sends himself. Never sent by MAGE. */
export function backchargeNotice(a: { subName: string; projectName: string; companyName: string; items: Backcharge[] }): string {
  const who = a.subName?.trim() || 'there';
  const project = a.projectName?.trim() || 'the project';
  const lines = a.items.map(b => `- ${b.reason}: ${formatCents(b.amountCents)}`);
  const total = sumCents(a.items);
  const from = a.companyName?.trim();
  return [
    `Hi ${who},`,
    '',
    `We're backcharging the following on ${project}:`,
    ...lines,
    '',
    `Total: ${formatCents(total)}`,
    '',
    `This will be deducted from your next payment on ${project}. Photos available on request.`,
    '',
    from ? `Thanks,\n${from}` : 'Thanks',
  ].join('\n');
}
