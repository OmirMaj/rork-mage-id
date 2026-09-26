// utils/registers/leadRows.ts — the desktop Pipeline (wave 6d, lane R3): one
// list row per lead, the board's column width, and the KPI cells.
//
// PURE: type-only '@/types' imports plus types/index.ts constants (a module
// with no imports) and pure utils, so scripts/validate-registers-lead-doc.ts
// executes it under bun. Every number is the phone's own: the budget is
// statedBudgetOf (the reader LeadCard, lead-detail and Convert use), the
// waiting clock is LeadCard's floor-of-hours, the win rate is the phone KPI's
// formula — except that nothing closed is "—", never a fake 0 %.

import type { Lead, LeadStage } from '@/types';
import { LEAD_SOURCE_LABELS, LEAD_STAGES, LEAD_STAGE_LABELS } from '@/types';
import { statedBudgetOf } from '@/utils/widgetLeadCore';
import type { RegisterCsvColumn } from './registerCsv';
import { logDayKey } from '../logs/logRoutes';

const HOUR_MS = 3_600_000;

/** Mirrors constants/designTokens.ts `Layout.register` (validated by text:
 *  that module imports react-native, which bun cannot load). */
export const LEADS_BOARD = { colMin: 180, colMax: 360, gap: 12, columns: 5 } as const;

/**
 * The desktop board's five columns in a container W wide.
 *   colWidth = clamp(floor((W − 4·gap) / 5), colMin, colMax)
 *   fits     = W ≥ 5·colMin + 4·gap (= 948): below it the row scrolls
 *              sideways, with a visible scrollbar.
 */
export function leadsBoardLayout(W: number): { fits: boolean; colWidth: number } {
  const { colMin, colMax, gap, columns } = LEADS_BOARD;
  const w = Number.isFinite(W) && W > 0 ? W : 0;
  const raw = Math.floor((w - (columns - 1) * gap) / columns);
  const colWidth = Math.min(colMax, Math.max(colMin, raw));
  return { fits: w >= columns * colMin + (columns - 1) * gap, colWidth };
}

export interface LeadRegisterRow {
  id: string;
  name: string;
  stage: LeadStage;
  /** LEAD_STAGES.indexOf(stage): the Stage column sorts in pipeline order. */
  stageIndex: number;
  stageLabel: string;
  score: number | null;
  /** The HOMEOWNER'S stated budget (max, else min), or null. */
  budget: number | null;
  /** New and never replied to: whole hours since it arrived (LeadCard's clock). */
  waitingHours: number | null;
  /** Hours from arrival to the first reply, or null (none logged). */
  firstReplyHours: number | null;
  receivedAt: string;
  projectType: string | null;
  source: string | null;
  phone: string | null;
  email: string | null;
}

const text = (s: string | null | undefined): string | null => (typeof s === 'string' && s.trim() ? s.trim() : null);
const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
};

export function leadRegisterRow(lead: Lead, nowMs: number): LeadRegisterRow {
  const stated = statedBudgetOf(lead);
  const received = ms(lead.receivedAt);
  const replied = ms(lead.firstRespondedAt);
  const waiting = lead.stage === 'new' && !lead.firstRespondedAt;
  return {
    id: lead.id,
    name: lead.name,
    stage: lead.stage,
    stageIndex: LEAD_STAGES.indexOf(lead.stage),
    stageLabel: LEAD_STAGE_LABELS[lead.stage] ?? lead.stage,
    score: typeof lead.score === 'number' && Number.isFinite(lead.score) ? lead.score : null,
    budget: stated.max || stated.min || null,
    waitingHours: waiting && received !== null ? Math.max(0, Math.floor((nowMs - received) / HOUR_MS)) : null,
    firstReplyHours: replied !== null && received !== null ? Math.max(0, Math.round((replied - received) / HOUR_MS)) : null,
    receivedAt: lead.receivedAt,
    projectType: text(lead.projectType),
    source: lead.source
      ? (lead.source === 'other' && text(lead.sourceOther)) || LEAD_SOURCE_LABELS[lead.source] || null
      : null,
    phone: text(lead.phone),
    email: text(lead.email),
  };
}

/** The First reply cell: 'waiting Nh' (danger) at >= 1 h, 'just now' under an
 *  hour (LeadCard's words), 'Nh' once replied, null ('—') when unknown. */
export function leadFirstReplyCell(row: Pick<LeadRegisterRow, 'waitingHours' | 'firstReplyHours'>): { text: string; tone: 'danger' | 'warning' | null } | null {
  if (row.waitingHours !== null) {
    return row.waitingHours >= 1
      ? { text: `waiting ${row.waitingHours}h`, tone: 'danger' }
      : { text: 'just now', tone: 'warning' };
  }
  if (row.firstReplyHours !== null) return { text: `${row.firstReplyHours}h`, tone: null };
  return null;
}

/** The phone's KPI memo, the fields the strip reads. */
export interface LeadKpiInput {
  total: number;
  outstanding: number;
  avgResponseHours: number | null;
  wonCount: number;
  lostCount: number;
}

/** KpiStrip's cell shape (components/desktop/KpiStrip KpiCell), kept pure. */
export interface LeadKpiCell {
  key: string;
  label: string;
  value: string | number | null;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
  blockedReason?: string | null;
}

export const LEAD_KPI_LOADING = 'Loading…';

/**
 * Open leads · Awaiting reply · Avg first reply · Win rate. Nothing closed is
 * '—' with its reason (the phone keeps "0%"); no reply logged is '—'. Until
 * the leads read has settled (`loaded` false) every cell is '—' + 'Loading…'
 * (contract D9): a count read before the load is a lie.
 */
export function leadKpiCells(kpi: LeadKpiInput, loaded = true): LeadKpiCell[] {
  const cells: LeadKpiCell[] = [
    { key: 'open', label: 'Open leads', value: kpi.total },
    { key: 'awaiting', label: 'Awaiting reply', value: kpi.outstanding, tone: kpi.outstanding > 0 ? 'warn' : undefined },
    {
      key: 'avg', label: 'Avg first reply',
      value: kpi.avgResponseHours === null ? null : `${kpi.avgResponseHours}h`,
      blockedReason: kpi.avgResponseHours === null ? 'No replies logged yet' : null,
    },
  ];
  const closed = kpi.wonCount + kpi.lostCount;
  cells.push({
    key: 'win', label: 'Win rate',
    value: closed > 0 ? `${Math.round((kpi.wonCount / closed) * 100)}%` : null,
    blockedReason: closed > 0 ? null : 'No won or lost leads yet',
  });
  if (loaded) return cells;
  return cells.map((c) => ({ key: c.key, label: c.label, value: null, blockedReason: LEAD_KPI_LOADING }));
}

export type LeadChip = 'all' | LeadStage;

/** All + one chip per stage, in pipeline order. */
export const LEAD_CHIPS: readonly { key: LeadChip; label: string }[] = [
  { key: 'all', label: 'All' },
  ...LEAD_STAGES.map((s) => ({ key: s as LeadChip, label: LEAD_STAGE_LABELS[s] })),
];

export function leadChipCounts(rows: readonly Pick<LeadRegisterRow, 'stage'>[]): Record<LeadChip, number> {
  const out: Record<LeadChip, number> = { all: rows.length, new: 0, qualified: 0, proposal: 0, won: 0, lost: 0 };
  for (const r of rows) if (r.stage in out) out[r.stage]++;
  return out;
}

export const LEAD_CSV_COLUMNS: readonly RegisterCsvColumn<LeadRegisterRow>[] = [
  { key: 'name', label: 'Name', csvValue: (r) => text(r.name) },
  { key: 'stage', label: 'Stage', csvValue: (r) => r.stageLabel },
  { key: 'score', label: 'Score', csvValue: (r) => r.score },
  { key: 'budget', label: 'Stated budget', csvValue: (r) => r.budget },
  { key: 'waiting', label: 'Waiting (hours)', csvValue: (r) => r.waitingHours },
  { key: 'firstReply', label: 'First reply (hours)', csvValue: (r) => r.firstReplyHours },
  { key: 'received', label: 'Received', csvValue: (r) => logDayKey(r.receivedAt) },
  { key: 'projectType', label: 'Project type', csvValue: (r) => r.projectType },
  { key: 'source', label: 'Source', csvValue: (r) => r.source },
  { key: 'phone', label: 'Phone', csvValue: (r) => r.phone },
  { key: 'email', label: 'Email', csvValue: (r) => r.email },
];
