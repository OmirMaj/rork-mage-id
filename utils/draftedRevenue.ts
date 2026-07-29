// utils/draftedRevenue.ts
//
// The payoff layer for the leak→CO autonomy. The Brain silently drafts change
// orders from job-site notes (utils/brain/leakCoDraft + useLeakCoDrafts), but a
// drafted CO earns nothing until it's sent + approved + billed. This surfaces
// every draft-status change order across ALL projects as one number —
// "$X in change orders ready to send" — so the money MAGE found doesn't rot.
//
// Pure: no React/network. Reuses the auto-draft marker so the UI can say how
// many MAGE drafted for you vs. drafted by hand.

import type { ChangeOrder, Project } from '@/types';
import { isAutoLeakDraft } from '@/utils/brain/leakCoDraft';

export interface DraftedCORow {
  id: string;
  coNumber: number;
  projectId: string;
  projectName: string;
  amount: number;
  isAuto: boolean; // MAGE auto-drafted from a leak scan
  ageDays: number;
}

export interface ReadyToBill {
  rows: DraftedCORow[]; // draft COs with a positive amount, biggest first
  count: number;
  total: number;
  autoCount: number; // how many MAGE drafted for you
  autoTotal: number;
}

export function buildReadyToBill(opts: {
  changeOrders: ChangeOrder[];
  projects: Project[];
  nowMs: number;
}): ReadyToBill {
  const { changeOrders, projects, nowMs } = opts;
  const nameById = new Map(projects.map((p) => [p.id, p.name]));

  const rows: DraftedCORow[] = changeOrders
    .filter((co) => co.status === 'draft' && (co.changeAmount ?? 0) > 0)
    .map((co) => {
      const stamp = co.createdAt ?? co.date ?? '';
      const ms = Date.parse(stamp);
      const ageDays = Number.isFinite(ms) ? Math.max(0, Math.floor((nowMs - ms) / 86400000)) : 0;
      return {
        id: co.id,
        coNumber: co.number ?? 0,
        projectId: co.projectId,
        projectName: nameById.get(co.projectId) ?? 'Project',
        amount: co.changeAmount ?? 0,
        isAuto: isAutoLeakDraft(co),
        ageDays,
      };
    })
    .sort((a, b) => b.amount - a.amount);

  const total = rows.reduce((s, r) => s + r.amount, 0);
  const autoRows = rows.filter((r) => r.isAuto);
  const autoTotal = autoRows.reduce((s, r) => s + r.amount, 0);

  return {
    rows,
    count: rows.length,
    total,
    autoCount: autoRows.length,
    autoTotal,
  };
}
