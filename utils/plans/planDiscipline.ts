// utils/plans/planDiscipline.ts — which discipline a plan sheet belongs to,
// read from its sheet number (wave 6d, lane P1). Pure; bun-importable.
//
// A drawing set is filed by discipline: the letter in front of the sheet
// number. The US National CAD Standard (NCS 6, Uniform Drawing System) fixes
// both the letters and the order a set is bound in — General first, then
// Hazmat, Survey, Geotech, Civil works (W), Civil, Landscape, Structural,
// Architectural, Interiors, Equipment, Fire protection, Plumbing, Process,
// Mechanical, Electrical, Telecom, Resource, Other, Shop drawings (Z),
// Operations. The desktop Plans grid filters on these as chips.
//
// Only the FIRST letter decides: two-letter designators are sub-disciplines
// of the first (AD = architectural demolition, FP = fire protection,
// EP = electrical power, ID = interior design). Anything the rule cannot read
// — no leading letters ("1", "Cover"), a blank, a letter NCS does not assign —
// is 'unnumbered', never guessed.

export type Discipline =
  | 'G' | 'H' | 'V' | 'B' | 'W' | 'C' | 'L' | 'S' | 'A' | 'I' | 'Q'
  | 'F' | 'P' | 'D' | 'M' | 'E' | 'T' | 'R' | 'X' | 'Z' | 'O'
  | 'unnumbered';

/** The NCS binding order, unnumbered sheets last. */
export const DISCIPLINE_ORDER: readonly Discipline[] = [
  'G', 'H', 'V', 'B', 'W', 'C', 'L', 'S', 'A', 'I', 'Q',
  'F', 'P', 'D', 'M', 'E', 'T', 'R', 'X', 'Z', 'O',
  'unnumbered',
];

export const DISCIPLINE_LABEL: Readonly<Record<Discipline, string>> = {
  G: 'General',
  H: 'Hazmat',
  V: 'Survey',
  B: 'Geotech',
  W: 'Civil works',
  C: 'Civil',
  L: 'Landscape',
  S: 'Structural',
  A: 'Architectural',
  I: 'Interiors',
  Q: 'Equipment',
  F: 'Fire protection',
  P: 'Plumbing',
  D: 'Process',
  M: 'Mechanical',
  E: 'Electrical',
  T: 'Telecom',
  R: 'Resource',
  X: 'Other',
  Z: 'Shop drawings',
  O: 'Operations',
  unnumbered: 'Unnumbered',
};

// One or two letters, then (optionally one separator and) a digit.
const DESIGNATOR = /^\s*([A-Za-z]{1,2})(?=[\s\-._]?\d)/;

/** The discipline a sheet number files under. */
export function disciplineOf(sheetNumber?: string | null): Discipline {
  const m = DESIGNATOR.exec(String(sheetNumber ?? ''));
  if (!m) return 'unnumbered';
  const letter = m[1][0].toUpperCase() as Discipline;
  return letter !== 'unnumbered' && Object.prototype.hasOwnProperty.call(DISCIPLINE_LABEL, letter) ? letter : 'unnumbered';
}

export interface DisciplineChip {
  value: Discipline | 'all';
  label: string;
  count: number;
}

/** 'All' first, then every discipline PRESENT in the set, in NCS order, with
 *  its count. An empty discipline is never listed. */
export function disciplineChips(sheets: readonly { sheetNumber?: string | null }[]): DisciplineChip[] {
  const counts = new Map<Discipline, number>();
  for (const s of sheets) {
    const d = disciplineOf(s.sheetNumber);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const chips: DisciplineChip[] = [{ value: 'all', label: 'All', count: sheets.length }];
  for (const d of DISCIPLINE_ORDER) {
    const n = counts.get(d) ?? 0;
    if (n > 0) chips.push({ value: d, label: DISCIPLINE_LABEL[d], count: n });
  }
  return chips;
}
