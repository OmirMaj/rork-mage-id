// utils/wh347.ts — WH-347 (federal Davis-Bacon) certified payroll CSV
// builder.
//
// What is WH-347:
//   Required weekly submission for any federally-funded public-works
//   job in the US. The contractor swears under penalty of perjury that
//   each worker was paid at least the prevailing wage for their craft.
//   Form layout: one row per worker per week, with hours-worked
//   broken down per day (Sun → Sat), gross pay, deductions, and net.
//
// Why this matters for MAGE ID:
//   No public-work residential GC can bid HUD / VA / federally-funded
//   projects without producing a WH-347 for every payroll period.
//   Buildertrend / CoConstruct / JobTread don't ship this — it's a
//   moat for residential GCs entering public-work bid lanes.
//
// Scope of this v1:
//   - CSV ONLY. The form is a 2-page PDF; rendering it to PDF is a
//     follow-up (the same way our G702/G703 path renders to PDF
//     server-side via the pdf-render edge function). State DOL
//     submission systems (LCPtracker, Elation, eMars, eComply) all
//     accept CSV upload — most contractors actually upload CSV, not
//     the PDF.
//   - Imports time_entries + workers. Work-classification is the
//     worker's `trade`; gross = hours × hourlyRate. Deductions are
//     left as zero in v1 (most state systems compute them anyway from
//     the gross + a state-supplied tax table); the GC fills in real
//     deduction columns in their state portal post-upload.
//
// Caveats called out in the README of every ship of this:
//   1. Prevailing wage RATE is not stored on the worker row — the
//      sub or GC has to set hourlyRate to the prevailing wage for
//      the job's location. Wrong rates produce a fraud risk and the
//      GC bears it. We surface this in the export header.
//   2. Trade classifications must match the published Davis-Bacon
//      decision. The CSV has the worker's `trade` string verbatim;
//      the GC maps it to the right BLS classification on upload.

import type { TimeEntry, Worker } from '@/types';

export interface WH347Row {
  workerName: string;
  /** Last-4 SSN. We don't store the full number — the GC keeps the
   *  W-9 separately. Federal form requires last-4 only on the row. */
  ssnLast4: string;
  /** Davis-Bacon work classification — the worker's trade column.
   *  GC remaps to BLS codes when uploading to the state portal. */
  classification: string;
  /** Hourly rate (prevailing). Pulled from worker.hourlyRate. */
  rate: number;
  /** Hours worked per day, Sun=0 → Sat=6 (length 7). */
  hoursPerDay: number[];
  /** Sum of hoursPerDay. */
  totalHours: number;
  /** Hours over 40 in the week (everything in hoursPerDay above 40). */
  overtimeHours: number;
  /** Straight-time hours = min(totalHours, 40). */
  straightHours: number;
  /** rate × straightHours + 1.5 × rate × overtimeHours. */
  grossPay: number;
  /** Project the work was on. WH-347 expects one form per project,
   *  so callers should split by projectId before calling this. */
  projectId: string;
  projectName: string;
}

/**
 * Build WH-347 rows for one week starting `weekStart` (a Sunday) for a
 * single project. Aggregates time entries by worker. Skips workers
 * with no hours on the week.
 */
export function buildWH347Rows(opts: {
  weekStart: Date;
  projectId: string;
  projectName: string;
  entries: TimeEntry[];
  workers: Worker[];
}): WH347Row[] {
  const { weekStart, projectId, projectName, entries, workers } = opts;
  // Normalize weekStart to midnight Sunday in local time.
  const start = new Date(weekStart);
  start.setHours(0, 0, 0, 0);
  // Move backwards to Sunday if not already there. JS Date.getDay():
  // 0 = Sunday, 6 = Saturday.
  const dayOfWeek = start.getDay();
  if (dayOfWeek !== 0) start.setDate(start.getDate() - dayOfWeek);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  const workerById = new Map(workers.map(w => [w.id, w]));
  const byWorker = new Map<string, TimeEntry[]>();

  for (const e of entries) {
    if (e.projectId !== projectId) continue;
    const t = Date.parse(e.clockIn);
    if (!Number.isFinite(t)) continue;
    if (t < start.getTime() || t >= end.getTime()) continue;
    if (!byWorker.has(e.workerId)) byWorker.set(e.workerId, []);
    byWorker.get(e.workerId)!.push(e);
  }

  const rows: WH347Row[] = [];
  for (const [workerId, list] of byWorker.entries()) {
    const worker = workerById.get(workerId);
    if (!worker) continue;

    const hoursPerDay = [0, 0, 0, 0, 0, 0, 0];
    for (const e of list) {
      const t = new Date(e.clockIn);
      const dow = t.getDay();
      hoursPerDay[dow] += e.totalHours ?? 0;
    }
    const totalHours = hoursPerDay.reduce((s, h) => s + h, 0);
    if (totalHours <= 0) continue;
    const overtimeHours = Math.max(0, totalHours - 40);
    const straightHours = Math.min(totalHours, 40);
    const rate = worker.hourlyRate ?? 0;
    const grossPay = rate * straightHours + rate * 1.5 * overtimeHours;

    rows.push({
      workerName: worker.name,
      ssnLast4: '****',  // Real SSN never stored — the GC enters last-4
                          // in the state DOL portal at upload time.
      classification: worker.trade ?? 'Laborer',
      rate,
      hoursPerDay,
      totalHours,
      overtimeHours,
      straightHours,
      grossPay,
      projectId,
      projectName,
    });
  }

  return rows.sort((a, b) => a.workerName.localeCompare(b.workerName));
}

/**
 * Render WH-347 rows to the CSV format every state DOL portal
 * (LCPtracker, Elation, eMars, eComply) will accept. Header row is
 * the standard WH-347 column set, in WH-347 form order.
 */
export function buildWH347Csv(opts: {
  rows: WH347Row[];
  weekStart: Date;
  projectName: string;
  projectAddress?: string;
  contractorName: string;
  contractorAddress?: string;
}): string {
  const { rows, weekStart, projectName, projectAddress, contractorName, contractorAddress } = opts;

  // Normalize weekStart same way buildWH347Rows does.
  const start = new Date(weekStart);
  start.setHours(0, 0, 0, 0);
  const dow = start.getDay();
  if (dow !== 0) start.setDate(start.getDate() - dow);

  const dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => {
    const day = new Date(start);
    day.setDate(day.getDate() + i);
    return `${d} ${day.getMonth() + 1}/${day.getDate()}`;
  });

  const escape = (v: string | number): string => {
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const lines: string[] = [];
  // Form-level metadata as comment-style header rows. Every CSV-
  // ingesting state portal we tested ignores rows starting with '#'.
  lines.push(`# WH-347 Certified Payroll`);
  lines.push(`# Contractor: ${contractorName}${contractorAddress ? ' — ' + contractorAddress : ''}`);
  lines.push(`# Project: ${projectName}${projectAddress ? ' — ' + projectAddress : ''}`);
  lines.push(`# Payroll week: ${start.toISOString().slice(0, 10)} (Sun) through ${new Date(start.getTime() + 6 * 86_400_000).toISOString().slice(0, 10)} (Sat)`);
  lines.push(`# IMPORTANT: hourlyRate column must equal the published Davis-Bacon prevailing wage for each classification. The contractor signs the Statement of Compliance on the form's page 2 — false rates are perjury.`);
  lines.push('');

  // Column headers — WH-347 row order.
  lines.push([
    'Worker Name',
    'SSN (last 4)',
    'Work Classification',
    'Hourly Rate',
    ...dayHeaders,
    'Total Hours',
    'Straight Hours',
    'OT Hours',
    'Gross Pay',
    'Project',
  ].map(escape).join(','));

  for (const r of rows) {
    lines.push([
      r.workerName,
      r.ssnLast4,
      r.classification,
      r.rate.toFixed(2),
      ...r.hoursPerDay.map(h => h.toFixed(2)),
      r.totalHours.toFixed(2),
      r.straightHours.toFixed(2),
      r.overtimeHours.toFixed(2),
      r.grossPay.toFixed(2),
      r.projectName,
    ].map(escape).join(','));
  }

  return lines.join('\n');
}
