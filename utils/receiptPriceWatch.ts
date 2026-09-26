// utils/receiptPriceWatch.ts — PRICE WATCH from his own receipts.
//
// Two findings, both read ONLY from receipts he reviewed (status 'reviewed':
// he checked the numbers on app/material-receipt.tsx before saving):
//   1. supplierSpreads — the same item, same unit, bought from two suppliers
//      in the window, and one yard charged him more.
//   2. estimateDrift — an OPEN (unsigned) estimate priced an item at one price
//      and his latest receipt for that exact item says another.
// repriceEstimate applies (2) to an estimate, touching only the drifted lines.
//
// EXACT normalised key only — never fuzzy. '2x4x8 stud' is not '2x6x8 stud',
// and a price per sheet is never compared with a price per each.
// All money is integer cents inside; the estimate's own dollar fields are
// written back through round2 exactly the way the estimator writes them.
//
// Pure — no React, no storage, no network, no clock (callers pass nowMs).
import type { LinkedEstimate, LinkedEstimateItem, MaterialReceipt, MaterialReceiptLine, Project } from '@/types';
import { normalizeUnit } from '@/utils/takeoffPricing';
import { calendarDayOf, parseCalendarDay } from '@/utils/calendarDate';

/** AsyncStorage key for the "Keep" choices (a JSON array of keptKeyFor()).
 *  Under the mageid_ prefix, so sign-out's wipeLocalUserCache sweeps it. */
export const PRICE_WATCH_KEPT_KEY = 'mageid_price_watch_kept';

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const toCents = (dollars: number) => Math.round(dollars * 100);

/** Copied from utils/costDatabase.ts `unitKey` (private there) so a receipt's
 *  unit normalises exactly the way the cost book's does: 'SF' / 'sq ft' → 'sf',
 *  a blank unit → 'unit'. */
function unitKey(unit: string): string {
  const raw = (unit || '').trim().toLowerCase();
  if (!raw || raw === 'unit') return 'unit';
  return normalizeUnit(raw) || raw;
}

/**
 * The exact key an item is compared on: the description lowercased, trimmed,
 * whitespace collapsed, punctuation dropped EXCEPT / . - x " ' (so 5/8",
 * 2x4x8 and 1/2in survive), then '|' and the normalised unit.
 * Null for an empty description. (A zero/negative price or a zero quantity
 * is filtered by the callers — see usableLine — since this key is also built
 * for estimate items, whose price lives elsewhere.)
 */
export function receiptLineKey(description: string, unit: string): string | null {
  const desc = String(description ?? '')
    .toLowerCase()
    .replace(/[“”″]/g, '"')
    .replace(/[‘’′]/g, "'")
    .replace(/[^a-z0-9\s/.\-"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!desc) return null;
  return `${desc}|${unitKey(unit)}`;
}

/** 'Home Depot, Inc.' and 'home depot' are one supplier. */
export function vendorKey(v: string): string {
  let s = String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  for (;;) {
    const next = s.replace(/[.,]+$/, '').replace(/ (inc|llc)$/, '').trim();
    if (next === s) return s;
    s = next;
  }
}

/** The calendar day a receipt line counts on: the printed receipt date when it
 *  is a real 'YYYY-MM-DD', else the day the receipt was saved. */
function receiptDay(r: MaterialReceipt): string | null {
  const printed = (r.receiptDate ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(printed) && parseCalendarDay(printed)) return printed;
  return calendarDayOf(r.createdAt);
}

interface UsableLine {
  receipt: MaterialReceipt;
  line: MaterialReceiptLine;
  key: string;
  vendor: string;
  vendorKey: string;
  day: string;
  qty: number;
  unitCents: number;
}

/** Every line of a REVIEWED receipt that can be compared: a key, a day, a
 *  positive quantity and a positive price. */
function usableLines(receipts: MaterialReceipt[]): UsableLine[] {
  const out: UsableLine[] = [];
  for (const r of receipts ?? []) {
    if (!r || r.status !== 'reviewed') continue;
    const day = receiptDay(r);
    const vk = vendorKey(r.vendor);
    if (!day || !vk) continue;
    for (const line of r.lines ?? []) {
      const qty = Number(line.quantity);
      const unitCents = toCents(Number(line.unitPrice));
      if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(unitCents) || unitCents <= 0) continue;
      const key = receiptLineKey(line.description, line.unit);
      if (!key) continue;
      out.push({ receipt: r, line, key, vendor: (r.vendor ?? '').trim(), vendorKey: vk, day, qty, unitCents });
    }
  }
  return out;
}

/** Newest first: by day, then by when the receipt was saved. */
function newestFirst(a: UsableLine, b: UsableLine): number {
  if (a.day !== b.day) return a.day < b.day ? 1 : -1;
  const ac = a.receipt.createdAt ?? '';
  const bc = b.receipt.createdAt ?? '';
  return ac === bc ? 0 : ac < bc ? 1 : -1;
}

export interface SpreadFinding {
  key: string;
  label: string;
  unit: string;
  cheapVendor: string;
  cheapUnitCents: number;
  dearVendor: string;
  dearUnitCents: number;
  /** Whole percent the dear vendor's mean is above the cheap one's. */
  pctMore: number;
  overpaidCents: number;
  evidence: { receiptId: string; vendor: string; date: string; qty: number; unitCents: number }[];
}

/**
 * The same item (exact key) bought from ≥ 2 suppliers inside the window.
 * Per supplier: the quantity-weighted mean unit price in cents. Reported only
 * when the dear supplier is ≥ 5% above the cheap one AND the dear supplier's
 * lines cost him ≥ $25 more than the cheap price would have.
 */
export function supplierSpreads(receipts: MaterialReceipt[], nowMs: number, windowDays = 30): SpreadFinding[] {
  const now = new Date(nowMs);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const fromMs = todayStart - windowDays * DAY_MS;
  const inWindow = usableLines(receipts).filter((u) => {
    const d = parseCalendarDay(u.day);
    if (!d) return false;
    const t = d.getTime();
    return t >= fromMs && t <= todayStart;
  });

  const byKey = new Map<string, UsableLine[]>();
  for (const u of inWindow) {
    const list = byKey.get(u.key);
    if (list) list.push(u); else byKey.set(u.key, [u]);
  }

  const findings: SpreadFinding[] = [];
  for (const [key, lines] of byKey) {
    const byVendor = new Map<string, UsableLine[]>();
    for (const u of lines) {
      const list = byVendor.get(u.vendorKey);
      if (list) list.push(u); else byVendor.set(u.vendorKey, [u]);
    }
    if (byVendor.size < 2) continue;

    const means = [...byVendor.entries()].map(([vk, vl]) => {
      const qty = vl.reduce((s, u) => s + u.qty, 0);
      const cents = vl.reduce((s, u) => s + u.qty * u.unitCents, 0);
      const newest = [...vl].sort(newestFirst)[0];
      return { vk, lines: vl, name: newest.vendor || vk, meanCents: Math.round(cents / qty) };
    });
    means.sort((a, b) => a.meanCents - b.meanCents || (a.vk < b.vk ? -1 : 1));
    const cheap = means[0];
    const dear = means[means.length - 1];
    if (cheap.meanCents <= 0 || dear.meanCents <= cheap.meanCents) continue;

    const rawPct = ((dear.meanCents - cheap.meanCents) / cheap.meanCents) * 100;
    const overpaidCents = dear.lines.reduce((s, u) => s + Math.round(u.qty * (u.unitCents - cheap.meanCents)), 0);
    if (rawPct < 5 || overpaidCents < 2500) continue;

    const sorted = [...lines].sort(newestFirst);
    findings.push({
      key,
      label: (sorted[0].line.description ?? '').replace(/\s+/g, ' ').trim(),
      unit: (sorted[0].line.unit ?? '').trim() || 'unit',
      cheapVendor: cheap.name,
      cheapUnitCents: cheap.meanCents,
      dearVendor: dear.name,
      dearUnitCents: dear.meanCents,
      pctMore: Math.round(rawPct),
      overpaidCents,
      evidence: sorted.map((u) => ({ receiptId: u.receipt.id, vendor: u.vendor, date: u.day, qty: u.qty, unitCents: u.unitCents })),
    });
  }
  return findings.sort((a, b) => b.overpaidCents - a.overpaidCents || (a.key < b.key ? -1 : 1));
}

export interface DriftFinding {
  projectId: string;
  projectName: string;
  materialId: string;
  itemName: string;
  unit: string;
  pricedUnitCents: number;
  latestUnitCents: number;
  latestReceiptId: string;
  latestReceiptLineId: string;
  latestVendor: string;
  latestDate: string;
  /** Signed percent, one decimal: + = his latest receipt is higher. */
  pct: number;
  /** Cost delta across the line's quantity, pre-markup, integer cents. */
  deltaCents: number;
}

/** Estimates that are still OPEN: nothing signed, nothing in progress. */
const OPEN_STATUSES: ReadonlySet<Project['status']> = new Set(['draft', 'estimated']);
const LABOR_RE = /labor|labour/i;

/** The price field the estimator prices this line with. */
function pricedDollars(it: LinkedEstimateItem): number {
  return it.usesBulk ? Number(it.bulkPrice) : Number(it.unitPrice);
}

/**
 * Lines on an OPEN estimate whose price his latest reviewed receipt for the
 * exact same item (same key, same unit) contradicts by ≥ minPct.
 * Labor-looking lines are skipped: a receipt is never a labor rate.
 */
export function estimateDrift(projects: Project[], receipts: MaterialReceipt[], minPct = 5): DriftFinding[] {
  const latestByKey = new Map<string, UsableLine>();
  for (const u of usableLines(receipts)) {
    const cur = latestByKey.get(u.key);
    if (!cur || newestFirst(u, cur) < 0) latestByKey.set(u.key, u);
  }
  if (latestByKey.size === 0) return [];

  const out: DriftFinding[] = [];
  for (const p of projects ?? []) {
    if (!p || !OPEN_STATUSES.has(p.status)) continue;
    const items = p.linkedEstimate?.items;
    if (!Array.isArray(items)) continue;
    for (const it of items) {
      if (LABOR_RE.test(it.category ?? '')) continue;
      const key = receiptLineKey(it.name, it.unit);
      if (!key) continue;
      const latest = latestByKey.get(key);
      if (!latest) continue;
      const pricedUnitCents = toCents(pricedDollars(it));
      const qty = Number(it.quantity);
      if (!Number.isFinite(pricedUnitCents) || pricedUnitCents <= 0 || !Number.isFinite(qty)) continue;
      const rawPct = ((latest.unitCents - pricedUnitCents) / pricedUnitCents) * 100;
      if (Math.abs(rawPct) < minPct) continue;
      out.push({
        projectId: p.id,
        projectName: p.name,
        materialId: it.materialId,
        itemName: it.name,
        unit: it.unit,
        pricedUnitCents,
        latestUnitCents: latest.unitCents,
        latestReceiptId: latest.receipt.id,
        latestReceiptLineId: latest.line.id,
        latestVendor: latest.vendor,
        latestDate: latest.day,
        pct: Math.round(rawPct * 10) / 10,
        deltaCents: Math.round(qty * (latest.unitCents - pricedUnitCents)),
      });
    }
  }
  return out;
}

/**
 * The estimate with each drifted line (matched by materialId) repriced to his
 * latest receipt. Each line KEEPS its own markup; its lineTotal is the
 * estimator's per-line formula (utils/copilot/estimateEdit/estimateOps
 * recomputeEstimate): round2(quantity × price × (1 + markup/100)).
 *
 * Totals move by the DELTA of the touched lines only — the estimate is never
 * recomputed whole, which would drop anything carried outside the lines
 * (permits, contingency). So Σ items.lineTotal === grandTotal holds after
 * exactly when it held before.
 */
export function repriceEstimate(
  est: LinkedEstimate,
  drifts: DriftFinding[],
): { next: LinkedEstimate; costDeltaCents: number; sellDeltaCents: number } {
  const byMaterial = new Map<string, DriftFinding>();
  for (const d of drifts ?? []) if (!byMaterial.has(d.materialId)) byMaterial.set(d.materialId, d);

  let costDeltaCents = 0;
  let sellDeltaCents = 0;
  const items = est.items.map((it) => {
    const d = byMaterial.get(it.materialId);
    if (!d || receiptLineKey(it.name, it.unit) !== receiptLineKey(d.itemName, d.unit)) return it;
    const oldPriceCents = toCents(pricedDollars(it));
    const price = d.latestUnitCents / 100;
    const qty = Number(it.quantity) || 0;
    const markup = Number.isFinite(Number(it.markup)) ? Number(it.markup) : 0;
    const lineTotal = round2(qty * price * (1 + markup / 100));
    costDeltaCents += Math.round(qty * (d.latestUnitCents - oldPriceCents));
    sellDeltaCents += toCents(lineTotal) - toCents(Number(it.lineTotal) || 0);
    return it.usesBulk ? { ...it, bulkPrice: price, lineTotal } : { ...it, unitPrice: price, lineTotal };
  });

  if (costDeltaCents === 0 && sellDeltaCents === 0 && items.every((it, i) => it === est.items[i])) {
    return { next: est, costDeltaCents: 0, sellDeltaCents: 0 };
  }
  const baseCents = toCents(Number(est.baseTotal) || 0) + costDeltaCents;
  const grandCents = toCents(Number(est.grandTotal) || 0) + sellDeltaCents;
  const markupCents = toCents(Number(est.markupTotal) || 0) + (sellDeltaCents - costDeltaCents);
  return {
    next: { ...est, items, baseTotal: baseCents / 100, grandTotal: grandCents / 100, markupTotal: markupCents / 100 },
    costDeltaCents,
    sellDeltaCents,
  };
}

/** The "Keep" memory key for one drift: a newer receipt line resurfaces it. */
export function keptKeyFor(d: Pick<DriftFinding, 'projectId' | 'materialId' | 'latestReceiptLineId'>): string {
  return `${d.projectId}|${d.materialId}|${d.latestReceiptLineId}`;
}
