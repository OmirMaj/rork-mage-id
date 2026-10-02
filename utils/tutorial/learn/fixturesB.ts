// utils/tutorial/learn/fixturesB.ts — the bundled answers for lane B's three
// AI-backed tutorials (takeoff-to-estimate, ask-your-plans, construction-ai-ask).
//
// HONEST SEAMS (the rule in ../fixtures.ts, applied to three AI screens). Each
// fixture stands in for exactly ONE AI call on the SAMPLE job while a tutorial
// runs, and is labelled on screen with SAMPLE_NO_CREDITS_LABEL:
//   • SAMPLE_TAKEOFF_RESULT stands in for analyze-takeoff on sheet A-101. It
//     carries QUANTITIES only. The price on each line comes from HIS cost book
//     (utils/takeoffPricing.matchOwnRate) at run time; a line his book has no
//     rate for says "No price yet". No price is ever invented here.
//   • samplePlanAnswer(plan) stands in for project-memory-search + the answer
//     step. Every sentence is built from SAMPLE_PLAN (its sheet number and its
//     room labels), and every citation is that sheet.
//   • sampleJobAnswer(...) stands in for construction-answer. It is computed
//     from the sample job's OWN records (estimate, approved change orders,
//     invoices) when he asks, so it stays true if the sample changes — never a
//     hard-coded paragraph. It is a question about HIS JOB, never about codes,
//     safety or a trade (certificates are app skills only).
//
// Money is integer cents everywhere it is computed here. The estimate writer
// (utils/estimateLanding) stores dollars on the cent grid, like every other
// writer in the app; the conversion is one place (centsToDollars).
//
// Pure: no React, no storage, no network, no clock. scripts/validate-tutorial-
// learn-b.ts executes these exact functions under bun.

import type { ChangeOrder, Invoice, LinkedEstimate, LinkedEstimateItem, Project, TakeoffResult } from '@/types';
import type { CostBookEntry } from '@/utils/costDatabase';
import type { AnswerCitation } from '@/types/constructionAnswer';
import { matchOwnRate } from '@/utils/takeoffPricing';
import { appendAtEstimateRatio, buildNewEstimate, costItem } from '@/utils/estimateLanding';
import { round2 } from '@/utils/estimateMarkup';
import { SAMPLE_NO_CREDITS_LABEL, SAMPLE_PLAN, type SampleRoom } from '../fixtures';

// ── Shared ──────────────────────────────────────────────────────────────────

/** Normalize a typed question before comparing it to a sample question:
 *  exact words only, so an edited question runs the real (blocked) path. Same
 *  rule as SCHEDULE_SAMPLE.normalize, plus curly quotes. */
export function normalizeSampleQuestion(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[–—-]/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isSampleQuestion(typed: string, sample: string): boolean {
  const t = normalizeSampleQuestion(typed);
  return t.length > 0 && t === normalizeSampleQuestion(sample);
}

/** Dollars (any float) → integer cents, half away from zero. */
export function toCents(dollars: number): number {
  if (!Number.isFinite(dollars)) return 0;
  return Math.sign(dollars) * Math.round(Math.abs(dollars) * 100);
}

export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

/** '$278,400' / '$1,234.56' from integer cents. Whole dollars drop the cents. */
export function formatCents(cents: number): string {
  const c = Math.round(Number.isFinite(cents) ? cents : 0);
  const neg = c < 0;
  const abs = Math.abs(c);
  const dollars = Math.floor(abs / 100);
  const rest = abs % 100;
  const whole = dollars.toLocaleString('en-US');
  const body = rest === 0 ? `$${whole}` : `$${whole}.${String(rest).padStart(2, '0')}`;
  return neg ? `-${body}` : body;
}

/**
 * The tutorial lock on an AI screen: a tutorial run is live on THIS project,
 * or the practice pass is open on it. True wherever the pass can open an AI
 * gate (practicePass.ts keys the pass to the run's sandbox id, and keeps it
 * 1.5 s past the end), so a guard on this rule covers every place the pass
 * lets a user in. While it holds, the screen's AI entry points take the
 * fixture path for the sample question and the blocked reason for anything
 * else — they never reach the network.
 */
export function tutorialAiLock(projectId: string | null | undefined, sandboxId: string | null | undefined, practiceCount: number): boolean {
  if (!projectId) return false;
  return (!!sandboxId && sandboxId === projectId) || practiceCount > 0;
}

/** Shown on a sample during a run for any question that is not the sample's. */
export const SAMPLE_QUESTION_BLOCKED = 'On the sample, use the sample question. Your own questions run on a real job.';
/** Shown for an upload (or any other takeoff AI run) on the sample during a run. */
export const SAMPLE_UPLOAD_BLOCKED = 'On the sample, use the sample plan. Upload your own plans on a real job.';
/** The takeoff line his cost book has no rate for. */
export const NO_PRICE_YET = 'No price yet';

// ── 1. Takeoff: counts from sheet A-101 ─────────────────────────────────────

export type SampleTakeoffKind = 'flooring' | 'outlets' | 'plumbing';

export interface SampleTakeoffItem {
  /** Stable handle: the estimate line id is `sample-takeoff-<key>`. */
  key: string;
  room: SampleRoom;
  kind: SampleTakeoffKind;
  unit: 'SF' | 'EA';
  /** Whole numbers: a sample count, not a measurement to the inch. */
  quantity: number;
}

/** What each kind is called, and what it is priced against in his book. The
 *  ROOM is never part of the match: "Kitchen" would otherwise borrow a
 *  kitchen-cabinet rate for an outlet. */
export const SAMPLE_TAKEOFF_KINDS: Record<SampleTakeoffKind, { label: string; csiDivision: string; section: 'floor' | 'fixture' }> = {
  flooring: { label: 'Flooring', csiDivision: '09 Flooring', section: 'floor' },
  outlets: { label: 'Electrical outlets', csiDivision: '26 Electrical', section: 'fixture' },
  plumbing: { label: 'Plumbing fixtures', csiDivision: '22 Plumbing', section: 'fixture' },
};

function takeoffItem(kind: SampleTakeoffKind, room: SampleRoom, quantity: number): SampleTakeoffItem {
  return {
    key: `${kind}-${room.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    room,
    kind,
    unit: kind === 'flooring' ? 'SF' : 'EA',
    quantity,
  };
}

/**
 * The sample takeoff of sheet A-101: net floor area per room (755 SF against
 * the sample's 820 SF gross), outlets per room and plumbing fixtures where
 * there is water. Every room is a label on the bundled A-101 (SAMPLE_PLAN).
 */
export const SAMPLE_TAKEOFF_RESULT: { sheetNumber: string; sheetName: string; items: readonly SampleTakeoffItem[] } = {
  sheetNumber: SAMPLE_PLAN.sheetNumber,
  sheetName: SAMPLE_PLAN.name,
  items: [
    takeoffItem('flooring', 'Kitchen', 150),
    takeoffItem('flooring', 'Living', 250),
    takeoffItem('flooring', 'Primary Bedroom', 180),
    takeoffItem('flooring', 'Hall Bath', 45),
    takeoffItem('flooring', 'Hall', 60),
    takeoffItem('flooring', 'Primary Bath', 70),
    takeoffItem('outlets', 'Kitchen', 6),
    takeoffItem('outlets', 'Living', 5),
    takeoffItem('outlets', 'Primary Bedroom', 4),
    takeoffItem('outlets', 'Hall Bath', 1),
    takeoffItem('outlets', 'Hall', 2),
    takeoffItem('outlets', 'Primary Bath', 2),
    takeoffItem('plumbing', 'Kitchen', 1),
    takeoffItem('plumbing', 'Hall Bath', 3),
    takeoffItem('plumbing', 'Primary Bath', 3),
  ],
};

/** The head of each sample estimate line's materialId (never a storage key —
 *  and not named *_PREFIX, which validate-storage-hygiene reads as one). */
export const SAMPLE_TAKEOFF_LINE_ID_HEAD = 'sample-takeoff-';

/** The review's row key for a sample item — utils/takeoffPricing
 *  takeoffRowKey(section, id) spelled the same way (the validator pins it). */
export function sampleTakeoffRowKey(item: SampleTakeoffItem): string {
  return `${SAMPLE_TAKEOFF_KINDS[item.kind].section}:${item.key}`;
}

/** The sample items as he left them on the review: a row he rejected is
 *  dropped, a quantity he edited replaces the count. What he sees is what
 *  converts. */
export function sampleTakeoffItemsAfterEdits(
  overrides: Readonly<Record<string, number>>,
  rejected: Readonly<Record<string, true>>,
  items: readonly SampleTakeoffItem[] = SAMPLE_TAKEOFF_RESULT.items,
): SampleTakeoffItem[] {
  return items
    .filter(i => !rejected[sampleTakeoffRowKey(i)])
    .map(i => {
      const o = overrides[sampleTakeoffRowKey(i)];
      return typeof o === 'number' && Number.isFinite(o) && o >= 0 ? { ...i, quantity: o } : i;
    });
}

/** '<Kind> — <Room>' — the line name on the review and on the estimate. */
export function sampleTakeoffLineName(item: SampleTakeoffItem): string {
  return `${SAMPLE_TAKEOFF_KINDS[item.kind].label} — ${item.room}`;
}

/**
 * SAMPLE_TAKEOFF_RESULT in the screen's own TakeoffResult shape, so the REAL
 * review renders it. No page images (nothing was rendered), so sourcePages is
 * empty and the sheet rides in each row's text; the summary says plainly that
 * no AI read the sheet.
 */
export function sampleTakeoffAsResult(): TakeoffResult {
  const sheet = `Sheet ${SAMPLE_TAKEOFF_RESULT.sheetNumber}`;
  const items = SAMPLE_TAKEOFF_RESULT.items;
  return {
    summary: `Sample counts for ${sheet}, ${SAMPLE_TAKEOFF_RESULT.sheetName.toLowerCase()}. Bundled with the tutorial; no AI read this sheet.`,
    // Nothing measured the sheet, so no scale is claimed.
    scale: { num: 0, unit: 'in', perValue: 1, perUnit: 'ft', label: 'not read (sample counts)', confidence: 'low', sourcePages: [] },
    drawingsSeen: [],
    walls: [],
    floorAreas: items.filter(i => i.kind === 'flooring').map(i => ({
      id: i.key,
      roomName: i.room,
      areaSqFt: i.quantity,
      ceilingHeightFt: 8,
      csiDivision: SAMPLE_TAKEOFF_KINDS.flooring.csiDivision,
      confidence: 'high' as const,
      sourcePages: [],
      notes: sheet,
    })),
    doors: [],
    windows: [],
    finishes: [],
    fixtures: items.filter(i => i.kind !== 'flooring').map(i => ({
      id: i.key,
      category: i.kind === 'outlets' ? ('electrical' as const) : ('plumbing' as const),
      description: `${sampleTakeoffLineName(i)} · ${sheet}`,
      count: i.quantity,
      csiDivision: SAMPLE_TAKEOFF_KINDS[i.kind].csiDivision,
      confidence: 'high' as const,
      sourcePages: [],
    })),
    bulkMaterials: [],
    concerns: [],
    doubleCheck: [],
    missingScopes: [],
    confidenceOverall: 'high',
    confidenceExplanation: `${SAMPLE_NO_CREDITS_LABEL}.`,
  };
}

export interface SampleTakeoffLine {
  key: string;
  name: string;
  room: SampleRoom;
  kind: SampleTakeoffKind;
  csiDivision: string;
  unit: 'SF' | 'EA';
  quantity: number;
  /** His rate, in cents, or null when his book has none for this line. */
  unitCents: number | null;
  /** quantity × unitCents rounded to the cent, or null with no rate. */
  lineCents: number | null;
  /** The book trade it matched ('Flooring'), for the row's source line. */
  trade: string | null;
}

export interface PricedSampleTakeoff {
  lines: SampleTakeoffLine[];
  pricedCount: number;
  /** Σ lineCents of the priced lines, at cost. */
  totalCents: number;
}

/** Price every sample line from HIS cost book. A line with no matching rate
 *  stays unpriced (unitCents null) — the screen shows NO_PRICE_YET. */
export function priceSampleTakeoff(book: readonly CostBookEntry[], items: readonly SampleTakeoffItem[] = SAMPLE_TAKEOFF_RESULT.items): PricedSampleTakeoff {
  const lines = items.map((item): SampleTakeoffLine => {
    const kind = SAMPLE_TAKEOFF_KINDS[item.kind];
    const match = matchOwnRate({ csiDivision: kind.csiDivision, description: kind.label, unit: item.unit }, [...book]);
    const unitCents = match && match.rate > 0 ? toCents(match.rate) : null;
    return {
      key: item.key,
      name: sampleTakeoffLineName(item),
      room: item.room,
      kind: item.kind,
      csiDivision: kind.csiDivision,
      unit: item.unit,
      quantity: item.quantity,
      unitCents,
      lineCents: unitCents === null ? null : Math.round(unitCents * item.quantity),
      trade: match ? match.trade : null,
    };
  });
  const priced = lines.filter(l => l.lineCents !== null);
  return {
    lines,
    pricedCount: priced.length,
    totalCents: priced.reduce((s, l) => s + (l.lineCents ?? 0), 0),
  };
}

/** The estimate lines, at COST (markup 0 — the writer applies markup). An
 *  unpriced line lands at $0 with its quantity, named so he can price it. */
export function sampleTakeoffCostItems(priced: PricedSampleTakeoff): LinkedEstimateItem[] {
  return priced.lines.map(l => costItem({
    id: `${SAMPLE_TAKEOFF_LINE_ID_HEAD}${l.key}`,
    name: l.name,
    category: l.csiDivision,
    unit: l.unit,
    quantity: l.quantity,
    unitPrice: l.unitCents === null ? 0 : centsToDollars(l.unitCents),
    supplier: l.unitCents === null ? NO_PRICE_YET : 'Your cost book',
    csiDivision: l.csiDivision.split(' ')[0],
  }));
}

const isSampleTakeoffItem = (it: LinkedEstimateItem) => typeof it.materialId === 'string' && it.materialId.startsWith(SAMPLE_TAKEOFF_LINE_ID_HEAD);

/**
 * Land the sample takeoff on the sample's estimate.
 *
 * With no estimate (or an empty one) it is a NEW estimate at no markup. With
 * one, the lines are ADDED at that estimate's own ratio (appendAtEstimateRatio,
 * the takeoff screen's Append rule) — never a Replace, so the seeded lines the
 * invoice tutorial bills from stay. A replay first takes the previous run's
 * sample-takeoff lines back out (their cost and sell, to the cent), so the
 * estimate never grows by a second copy.
 */
export function mergeSampleTakeoffIntoEstimate(
  est: LinkedEstimate | null | undefined,
  items: LinkedEstimateItem[],
  id: string,
  createdAt: string,
): { next: LinkedEstimate; addedSellCents: number } {
  const kept = est ? est.items.filter(it => !isSampleTakeoffItem(it)) : [];
  if (!est || kept.length === 0) {
    const next = buildNewEstimate(items, null, est?.id ?? id, est?.createdAt ?? createdAt);
    return { next, addedSellCents: toCents(next.grandTotal) };
  }
  const removed = est.items.filter(isSampleTakeoffItem);
  const removedBase = round2(removed.reduce((s, it) => s + (it.unitPrice || 0) * (it.quantity || 0), 0));
  const removedSell = round2(removed.reduce((s, it) => s + (it.lineTotal || 0), 0));
  const stripped: LinkedEstimate = {
    ...est,
    items: kept,
    baseTotal: round2(est.baseTotal - removedBase),
    markupTotal: round2(est.markupTotal - round2(removedSell - removedBase)),
    grandTotal: round2(est.grandTotal - removedSell),
  };
  const { next, addedSell } = appendAtEstimateRatio(stripped, items, null);
  return { next, addedSellCents: toCents(addedSell) };
}

// ── 2. Ask your plans: rooms on A-101 ───────────────────────────────────────

export const SAMPLE_PLAN_QUESTION = 'Which rooms are on sheet A-101?';

export interface SamplePlanAnswer {
  question: string;
  answer: string;
  /** Sheet numbers the answer cites (the screen maps each to its sheet id). */
  citations: { ref: string }[];
}

/** The cited answer, built from the plan it is about: its sheet number and its
 *  room labels, in the order the sheet lists them. */
export function samplePlanAnswer(plan: { sheetNumber: string; rooms: Record<string, unknown> } = SAMPLE_PLAN): SamplePlanAnswer {
  const rooms = Object.keys(plan.rooms);
  const list = rooms.length <= 1 ? rooms.join('') : `${rooms.slice(0, -1).join(', ')} and ${rooms[rooms.length - 1]}`;
  const answer = rooms.length === 0
    ? `Sheet ${plan.sheetNumber} has no room labels.`
    : `Sheet ${plan.sheetNumber} labels ${rooms.length} room${rooms.length === 1 ? '' : 's'}: ${list}.`;
  return { question: SAMPLE_PLAN_QUESTION, answer, citations: [{ ref: plan.sheetNumber }] };
}

// ── 3. Construction AI: what's left to bill on this job ─────────────────────

export const SAMPLE_JOB_QUESTION = "What's left to bill on this job?";

type JobProject = Pick<Project, 'id' | 'name'> & {
  linkedEstimate?: Pick<LinkedEstimate, 'grandTotal' | 'items'> | null;
  estimate?: { grandTotal?: number } | null;
};
type JobInvoice = Pick<Invoice, 'projectId' | 'number' | 'status' | 'subtotal'> & { totalDue?: number; taxAmount?: number };
type JobChangeOrder = Pick<ChangeOrder, 'projectId' | 'number' | 'status' | 'changeAmount'>;

export interface SampleJobAnswer {
  answer: string;
  /** The records the number rests on: the estimate, each approved CO, each invoice. */
  citations: AnswerCitation[];
  /** Records it read and left out of the number (drafts, COs not approved). */
  consulted: AnswerCitation[];
  verified: boolean;
  disclaimer: string;
  usedAI: false;
  contractCents: number;
  billedCents: number;
  leftCents: number;
}

/** An invoice's billed amount before tax (tax is not contract value). */
function invoiceBilledCents(inv: JobInvoice): number {
  if (Number.isFinite(inv.subtotal)) return toCents(inv.subtotal);
  const total = Number.isFinite(inv.totalDue) ? (inv.totalDue as number) : 0;
  const tax = Number.isFinite(inv.taxAmount) ? (inv.taxAmount as number) : 0;
  return toCents(total - tax);
}

/**
 * "What's left to bill on this job?", answered from the job's own records:
 *   contract = the estimate's grand total + every APPROVED change order;
 *   billed   = every invoice that went out (not a draft), before tax;
 *   left     = contract − billed.
 * Every number in the sentence is one of those three, in cents; every record
 * behind them is cited, and every record it read but left out is listed as
 * consulted, so "Also checked" says exactly what was looked at.
 */
export function sampleJobAnswer(
  project: JobProject,
  invoices: readonly JobInvoice[],
  changeOrders: readonly JobChangeOrder[],
): SampleJobAnswer {
  const estimateDollars = project.linkedEstimate?.grandTotal ?? project.estimate?.grandTotal ?? 0;
  const estimateCents = toCents(estimateDollars);
  const cos = changeOrders.filter(c => c.projectId === project.id).slice().sort((a, b) => a.number - b.number);
  const approved = cos.filter(c => c.status === 'approved');
  const coCents = approved.reduce((s, c) => s + toCents(c.changeAmount), 0);
  const invs = invoices.filter(i => i.projectId === project.id).slice().sort((a, b) => a.number - b.number);
  const issued = invs.filter(i => i.status !== 'draft');
  const billedCents = issued.reduce((s, i) => s + invoiceBilledCents(i), 0);
  const contractCents = estimateCents + coCents;
  const leftCents = contractCents - billedCents;

  const citations: AnswerCitation[] = [];
  if (estimateCents > 0) citations.push({ kind: 'rate', label: `Estimate · ${formatCents(estimateCents)}` });
  for (const c of approved) citations.push({ kind: 'rate', label: `Change order #${c.number} · ${formatCents(toCents(c.changeAmount))}` });
  for (const i of issued) citations.push({ kind: 'rate', label: `Invoice #${i.number} · ${formatCents(invoiceBilledCents(i))}` });
  const consulted: AnswerCitation[] = [
    ...cos.filter(c => c.status !== 'approved').map(c => ({ kind: 'rate' as const, label: `Change order #${c.number} (${c.status.replace(/_/g, ' ')}, not in the contract yet)` })),
    ...invs.filter(i => i.status === 'draft').map(i => ({ kind: 'rate' as const, label: `Invoice #${i.number} (draft, not billed)` })),
  ];

  const coPart = approved.length === 0
    ? ''
    : ` plus ${approved.length} approved change order${approved.length === 1 ? '' : 's'} (${formatCents(coCents)})`;
  const billedPart = issued.length === 0
    ? 'Nothing has been billed yet.'
    : `Billed so far: ${formatCents(billedCents)} on ${issued.length} invoice${issued.length === 1 ? '' : 's'}.`;
  const lead = estimateCents === 0 && coCents === 0
    ? 'This job has no estimate or approved change orders yet, so there is no contract amount to bill against.'
    : leftCents >= 0
      ? `${formatCents(leftCents)} is left to bill.`
      : `Billed ${formatCents(-leftCents)} more than the contract.`;
  const contractPart = estimateCents === 0 && coCents === 0
    ? ''
    : ` Contract: ${formatCents(contractCents)} (estimate ${formatCents(estimateCents)}${coPart}).`;
  return {
    answer: `${lead}${contractPart} ${billedPart}`,
    citations,
    consulted,
    verified: true,
    disclaimer: `${SAMPLE_NO_CREDITS_LABEL}. Worked out from this job's own records.`,
    usedAI: false,
    contractCents,
    billedCents,
    leftCents,
  };
}
