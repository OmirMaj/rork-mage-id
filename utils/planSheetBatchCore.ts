// utils/planSheetBatchCore.ts — fold one or many new plan sheets into the
// project's sheet list in ONE pass. The pure half of ProjectContext's
// addPlanSheet / addPlanSheets, kept outside the context so a guard can
// execute it (bun cannot load a .tsx that pulls react-native).
//
// WHY (audit round 2, #18). app/plans.tsx "Import PDF" called addPlanSheet once
// per rendered page inside pages.forEach, and addPlanSheet built its list from
// the render-time `planSheets`. Every iteration wrote `[page_i, ...original]`,
// so the last page won: a 12-page set showed ONE sheet ("Set — Page 12") while
// the alert said "12 sheets added" and Postgres got all twelve rows. The GC's
// natural retry spent another 12 takeoff pages and, because PDF pages carry no
// sheet number, superseded nothing — after a relaunch the project showed every
// page twice. Same stale-closure bug addSubmittals and addPunchItems already
// fixed; the shape here mirrors them: one working list, one persist, N inserts.
//
// IDENTITY — when a new sheet REPLACES a current one (revision + 1, the old one
// marked superseded and hidden by default):
//   • same project and same sheetNumber (trimmed, case-sensitive) — the rule
//     addPlanSheet has always had, now run against the WORKING list so two
//     pages of one batch can never both claim Rev 2 of the same prior sheet;
//   • for a PDF re-import only (`matchUnnumberedByPage`): an UNNUMBERED sheet
//     with the same name (trimmed, case-insensitive) and the same page number.
//     The name is `<file name> — Page N`, so this is "page N of the same file".
//     Deliberately NOT applied to a single image import: two photos both
//     titled "Floor plan" are two plans, and silently hiding one would be the
//     worse bug.

import type { PlanSheet } from '@/types';

export type NewPlanSheet = Omit<PlanSheet, 'id' | 'createdAt' | 'updatedAt'>;

export interface PlanSheetFold {
  /** The whole list to persist — newest first, like the one-at-a-time path. */
  list: PlanSheet[];
  /** Exactly the sheets this call created, in input order and final state. What the alert counts. */
  created: PlanSheet[];
  /** Prior sheets this call marked superseded (need a server update each). */
  superseded: PlanSheet[];
}

const trimmed = (s: string | undefined | null): string => (s ?? '').trim();

/** Page N of a PDF import. One-page PDFs keep the bare file name. */
export function pdfPageSheetName(baseName: string, pageCount: number, pageNumber: number): string {
  return pageCount === 1 ? baseName : `${baseName} — Page ${pageNumber}`;
}

/**
 * Current (not superseded) sheets of `projectId` that an earlier import of a
 * PDF with this base name created. Used BEFORE the upload: re-rendering the
 * same set charges the month's takeoff pages again, so the GC is asked first.
 */
export function priorImportOf(sheets: PlanSheet[], projectId: string, baseName: string): PlanSheet[] {
  const base = trimmed(baseName).toLowerCase();
  if (!base) return [];
  const pagePrefix = `${base} — page `;
  return sheets.filter(s => {
    if (s.projectId !== projectId || s.superseded || trimmed(s.sheetNumber)) return false;
    const n = trimmed(s.name).toLowerCase();
    return n === base || (n.startsWith(pagePrefix) && /^\d+$/.test(n.slice(pagePrefix.length)));
  });
}

function sameSheet(existing: PlanSheet, incoming: NewPlanSheet, matchUnnumberedByPage: boolean): boolean {
  if (existing.projectId !== incoming.projectId || existing.superseded) return false;
  const inNumber = trimmed(incoming.sheetNumber);
  if (inNumber) return trimmed(existing.sheetNumber) === inNumber;
  if (!matchUnnumberedByPage || trimmed(existing.sheetNumber)) return false;
  return trimmed(existing.name).toLowerCase() === trimmed(incoming.name).toLowerCase()
    && (existing.pageNumber ?? 1) === (incoming.pageNumber ?? 1);
}

/**
 * Fold `incoming` into `base`. Pure: ids and the timestamp are injected.
 * Each incoming sheet is checked against the list AS IT STANDS after the ones
 * before it, never against `base` alone.
 */
export function foldPlanSheets(
  base: PlanSheet[],
  incoming: NewPlanSheet[],
  opts: { now: string; newId: () => string; matchUnnumberedByPage?: boolean },
): PlanSheetFold {
  let working = base;
  const created: PlanSheet[] = [];
  const superseded: PlanSheet[] = [];
  for (const sheet of incoming) {
    let revision = 1;
    let previousSheetId: string | undefined;
    const same = working.filter(s => sameSheet(s, sheet, !!opts.matchUnnumberedByPage));
    if (same.length > 0) {
      // Highest existing revision, so repeated re-uploads bump monotonically.
      const latest = same.reduce((a, b) => ((a.revision ?? 1) > (b.revision ?? 1) ? a : b));
      revision = (latest.revision ?? 1) + 1;
      previousSheetId = latest.id;
      working = working.map(s => {
        if (s.id !== latest.id) return s;
        const marked = { ...s, superseded: true, updatedAt: opts.now };
        superseded.push(marked);
        return marked;
      });
    }
    const fresh: PlanSheet = {
      ...sheet,
      id: opts.newId(),
      revision,
      previousSheetId,
      createdAt: opts.now,
      updatedAt: opts.now,
    };
    working = [fresh, ...working];
    created.push(fresh);
  }
  // A sheet created AND superseded inside this same call (two pages claiming
  // one sheet number) is inserted in its final state, so it needs no separate
  // update — and an update queued before its insert would be refused.
  const createdIds = new Set(created.map(c => c.id));
  const finalById = new Map(working.map(s => [s.id, s]));
  return {
    list: working,
    created: created.map(c => finalById.get(c.id) ?? c),
    superseded: superseded.filter(s => !createdIds.has(s.id)),
  };
}
