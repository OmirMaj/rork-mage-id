// utils/planRevisionCore.ts — the RN-free half of drawing revision control.
//
// WHY THIS EXISTS
// Building from a superseded drawing is the single largest rework driver on a
// job: a wall framed two feet off an old sheet is demo + RFI + delay + change
// order, and the GC carries that liability because the GC distributed the
// sheet. ProjectContext.addPlanSheet already stamps `revision` /
// `previousSheetId` / `superseded` when a sheet number is re-uploaded, but
// nothing READ those flags — the viewer rendered a stale sheet identically to
// a current one. This module is the decision the viewer and the list both ask:
// "is this sheet stale, and if so which sheet should they be building from?"
//
// Same pattern as utils/alertCore.ts and utils/brain/predictionLedgerCore.ts:
// zero react / react-native imports so `bun run scripts/validate-plan-revisions.ts`
// can execute it directly (bun cannot parse `react-native`).

/**
 * The subset of `PlanSheet` (types/index.ts) this decision needs. Structural,
 * not a re-declaration of the domain type — a full `PlanSheet` satisfies it,
 * and tests can build fixtures without inventing image URIs and timestamps.
 */
export interface RevisionSheetLike {
  id: string;
  projectId: string;
  sheetNumber?: string;
  revision?: number;
  previousSheetId?: string;
  superseded?: boolean;
}

/**
 * Outcome of asking "which sheet is current for this sheet number?".
 *
 * `ambiguous` is deliberately a first-class outcome rather than a guess. Two
 * live heads for one sheet number means two devices raced an upload offline;
 * picking one at random is exactly the wrong-sheet navigation this feature
 * exists to prevent. The UI shows the warning and disables the jump instead.
 */
export type CurrentSheetLookup =
  /** This sheet IS the current one — nothing to jump to. */
  | { status: 'self' }
  /** Exactly one live sheet carries this number. Safe to navigate. */
  | { status: 'resolved'; sheetId: string; revision: number }
  /** No live sheet carries this number (head deleted, or number was blank). */
  | { status: 'not_found' }
  /** More than one live candidate — un-navigable by design. */
  | { status: 'ambiguous'; candidateIds: string[] };

export interface PlanRevisionStatus {
  /** True when a newer revision of this sheet exists. Drives the banner. */
  stale: boolean;
  /** Effective revision — legacy rows predate the field and are Rev 1. */
  revision: number;
  /** Where the current drawing lives, if we can say so unambiguously. */
  current: CurrentSheetLookup;
}

/**
 * Sheet-number identity. MUST stay byte-identical to the comparison
 * `addPlanSheet` uses when it decides to bump a revision — `(x ?? '').trim()`,
 * case-SENSITIVE. If the reader normalized more aggressively than the writer
 * (e.g. case-folding), it could pair "a-101" with "A-101" — two rows the
 * writer treated as unrelated sheets — and route the user to a drawing of a
 * different room. Under-matching only costs us a jump button; over-matching
 * sends someone to the wrong wall.
 *
 * A blank number is NOT an identity: PDF-imported pages land with
 * `sheetNumber: undefined`, and grouping them would make every unnumbered page
 * in a 50-page set a "revision" of every other.
 */
export function sheetNumberKey(sheet: RevisionSheetLike): string | null {
  const key = (sheet.sheetNumber ?? '').trim();
  return key.length > 0 ? key : null;
}

/** Legacy rows have no `revision`; they are the first upload, i.e. Rev 1. */
export function effectiveRevision(sheet: RevisionSheetLike): number {
  const r = sheet.revision;
  return typeof r === 'number' && Number.isFinite(r) && r >= 1 ? r : 1;
}

/**
 * Is this sheet superseded? Only the explicit flag counts.
 *
 * Note we do NOT infer staleness from "some other sheet has a higher
 * revision" — that would flag a current sheet the moment a bad row appeared,
 * and a false "do not build from this" is how a real warning gets trained out
 * of the crew.
 */
export function isStale(sheet: RevisionSheetLike): boolean {
  return sheet.superseded === true;
}

/**
 * Live (non-superseded) sheets sharing `sheet`'s number within `sheet`'s
 * project, excluding `sheet` itself. Sorted by id so the result is stable
 * regardless of the order the caller's array happens to be in.
 *
 * Cross-project isolation is not incidental — sheet numbers like "A-101" are
 * near-universal, so without the projectId guard every job in the account
 * would look like a revision of every other.
 */
export function currentSheetCandidates(
  sheet: RevisionSheetLike,
  allSheets: readonly RevisionSheetLike[],
): RevisionSheetLike[] {
  const key = sheetNumberKey(sheet);
  if (key === null) return [];
  return allSheets
    .filter(s =>
      s.id !== sheet.id &&
      s.projectId === sheet.projectId &&
      sheetNumberKey(s) === key &&
      !isStale(s))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Resolve where the current drawing for this sheet number lives.
 *
 * Resolution walks FORWARD, which `previousSheetId` cannot do — that pointer
 * runs newer → older, and it also breaks the moment anyone deletes a row mid
 * chain. So "current" is defined by state, not by the chain: the live sheet
 * with the same number in the same project.
 */
export function resolveCurrentSheet(
  sheet: RevisionSheetLike,
  allSheets: readonly RevisionSheetLike[],
): CurrentSheetLookup {
  if (!isStale(sheet)) return { status: 'self' };
  const candidates = currentSheetCandidates(sheet, allSheets);
  if (candidates.length === 0) return { status: 'not_found' };
  if (candidates.length > 1) {
    return { status: 'ambiguous', candidateIds: candidates.map(c => c.id) };
  }
  return { status: 'resolved', sheetId: candidates[0].id, revision: effectiveRevision(candidates[0]) };
}

/** One call for the viewer: stale? which revision? where's the live one? */
export function planRevisionStatus(
  sheet: RevisionSheetLike,
  allSheets: readonly RevisionSheetLike[],
): PlanRevisionStatus {
  return {
    stale: isStale(sheet),
    revision: effectiveRevision(sheet),
    current: resolveCurrentSheet(sheet, allSheets),
  };
}

/** The one line the crew has to read. Pinned by the validator so it can't
 *  drift into something softer than an instruction. */
export const STALE_BANNER_TITLE = 'Superseded — do not build from this sheet';

/**
 * Banner copy, or `null` for a sheet that is fine to build from. Lives here
 * rather than in the .tsx so the wording is unit-pinned, and so "is there a
 * banner?" is a single call the viewer can't get half-right.
 */
export function staleBannerCopy(
  status: PlanRevisionStatus,
): { title: string; detail: string } | null {
  if (!status.stale) return null;
  const rev = `Rev ${status.revision}`;
  switch (status.current.status) {
    case 'resolved':
      return {
        title: STALE_BANNER_TITLE,
        detail: `This is ${rev}. Rev ${status.current.revision} replaced it.`,
      };
    case 'ambiguous':
      return {
        title: STALE_BANNER_TITLE,
        detail: `This is ${rev}. ${status.current.candidateIds.length} newer copies of this sheet number exist — confirm which one is current before you build.`,
      };
    default:
      // not_found (and the unreachable 'self', which `status.stale` already
      // filtered out): we know it's dead, we just can't point anywhere.
      return {
        title: STALE_BANNER_TITLE,
        detail: `This is ${rev}. A newer revision replaced it, but it is not in this project — get the current sheet before you build.`,
      };
  }
}
