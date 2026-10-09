// utils/roomScan/clearanceRefs.ts — Clearance Check: the ONE table of
// commonly used figures a scanned distance is set beside.
//
// WHAT A ROW IS. A number that model codes carry and that places adopt with
// their own changes. It is a reference point for deciding where to put a tape.
// It is NOT a statement of what any place asks for: the app holds no checked
// local data for any figure here (see `checked`), and the screen says so on
// every row: "A commonly used figure. Your local code may differ."
//
// EACH ROW HOLDS
//   value, unit, bound   the number, and whether it is a least or a most;
//   called               what it is commonly called, in the app's own words;
//   family               the family of code it comes from, in plain words;
//   checked              whether the repo's OWN CHECKED jurisdiction data
//                        confirms the number for New York City or Baltimore;
//   section              a section number, ONLY from that checked data.
//
// THE FIREWALL (the utils/codeJurisdiction and utils/codeFlags/place rule,
// carried over). The repo's checked data was read for these figures on
// 2026-10-09: utils/codeJurisdiction.ts (LOCAL_ADOPTIONS: the New York City,
// Baltimore City and Baltimore County rows and their notes),
// utils/permitPath/packs (SOURCE_REFS), utils/codeScopeTriggers.ts and
// utils/codeCard. NONE of them carries a fixture clearance, a door or hallway
// width, a ceiling height or an escape-opening size. So every `checked` flag
// below is false and every `section` is null. A flag may be turned on only
// together with `checkedSource`, naming the row the number was found in, and
// scripts/validate-scan-clearance.ts looks the number up in that row. No
// section number is written from recall, here or in the words.
//
// LEFT OUT ON PURPOSE (the rule was: if it is not surely in common use, the
// measurement stays a plain number). Stair risers and treads (the scan does
// not carry them), a tub or shower opening (the scan gives a box, not an
// opening), a cased opening's width, the distance between two fixtures, and
// every figure that only one place uses.
//
// Pure data: no React, no storage, no network. The English `called` and
// `family` here are the words of record; the screen's strings (English and
// Spanish) live in hooks/useScanClearanceCopy.ts and the
// validator pins the English there equal to this table.

export type ClearanceRefId =
  | 'toilet_side_15'
  | 'toilet_front_21'
  | 'toilet_front_24'
  | 'sink_front_21'
  | 'door_clear_32'
  | 'passage_36'
  | 'ceiling_84'
  | 'ceiling_bath_80'
  | 'ceiling_96'
  | 'escape_area_5_7'
  | 'escape_height_24'
  | 'escape_width_20'
  | 'escape_sill_44';

export type ClearanceFamily =
  | 'residential_model'
  | 'residential_and_plumbing_model'
  | 'other_plumbing'
  | 'building_model'
  | 'some_city';

/** The plain words for each family of code. */
export const CLEARANCE_FAMILY_WORDS: Readonly<Record<ClearanceFamily, string>> = {
  residential_model: 'the model residential code',
  residential_and_plumbing_model: 'the model residential code and the model plumbing code',
  other_plumbing: 'some plumbing codes',
  building_model: 'the model building code',
  some_city: 'some city codes',
};

export type ClearancePlace = 'nyc' | 'baltimore';

export interface ClearanceRef {
  id: ClearanceRefId;
  /** Inches, or square feet when `unit` is 'sqft'. */
  value: number;
  unit: 'in' | 'sqft';
  /** 'min' = commonly a least. 'max' = commonly a most (a sill height). */
  bound: 'min' | 'max';
  /** What it is commonly called, in the app's own words. No code-book sentence. */
  called: string;
  family: ClearanceFamily;
  /** Does the repo's own checked jurisdiction data confirm this number there? */
  checked: Readonly<Record<ClearancePlace, boolean>>;
  /** Where in the checked data the number was found. Needed for any `checked: true`. */
  checkedSource: null | { place: ClearancePlace; row: string; needle: string };
  /** A section number, only ever taken from the checked data. */
  section: null | { label: string; row: string };
}

const NOT_CHECKED = Object.freeze({ nyc: false, baltimore: false });
const row = (r: Omit<ClearanceRef, 'checked' | 'checkedSource' | 'section'>): ClearanceRef => ({ ...r, checked: NOT_CHECKED, checkedSource: null, section: null });

export const CLEARANCE_REFS: readonly ClearanceRef[] = [
  row({ id: 'toilet_side_15', value: 15, unit: 'in', bound: 'min', called: 'toilet center line to a side wall or anything beside it', family: 'residential_and_plumbing_model' }),
  row({ id: 'toilet_front_21', value: 21, unit: 'in', bound: 'min', called: 'clear space in front of a toilet', family: 'residential_and_plumbing_model' }),
  row({ id: 'toilet_front_24', value: 24, unit: 'in', bound: 'min', called: 'clear space in front of a toilet', family: 'other_plumbing' }),
  row({ id: 'sink_front_21', value: 21, unit: 'in', bound: 'min', called: 'clear space in front of a bathroom sink', family: 'residential_and_plumbing_model' }),
  row({ id: 'door_clear_32', value: 32, unit: 'in', bound: 'min', called: 'clear width of a doorway with the door open', family: 'building_model' }),
  row({ id: 'passage_36', value: 36, unit: 'in', bound: 'min', called: 'width of a hallway', family: 'residential_model' }),
  row({ id: 'ceiling_84', value: 84, unit: 'in', bound: 'min', called: 'ceiling height in a room people live in', family: 'residential_model' }),
  row({ id: 'ceiling_bath_80', value: 80, unit: 'in', bound: 'min', called: 'ceiling height in a bathroom', family: 'residential_model' }),
  row({ id: 'ceiling_96', value: 96, unit: 'in', bound: 'min', called: 'ceiling height in a room people live in', family: 'some_city' }),
  row({ id: 'escape_area_5_7', value: 5.7, unit: 'sqft', bound: 'min', called: 'net clear area of an emergency escape opening', family: 'residential_model' }),
  row({ id: 'escape_height_24', value: 24, unit: 'in', bound: 'min', called: 'net clear height of an emergency escape opening', family: 'residential_model' }),
  row({ id: 'escape_width_20', value: 20, unit: 'in', bound: 'min', called: 'net clear width of an emergency escape opening', family: 'residential_model' }),
  row({ id: 'escape_sill_44', value: 44, unit: 'in', bound: 'max', called: 'height of an emergency escape opening off the floor', family: 'residential_model' }),
];

const BY_ID = new Map(CLEARANCE_REFS.map((r) => [r.id, r]));

export function clearanceRef(id: ClearanceRefId): ClearanceRef {
  const r = BY_ID.get(id);
  if (!r) throw new Error(`utils/roomScan/clearanceRefs: no figure "${id}"`);
  return r;
}

/** True only when the repo's checked data confirms the figure for one of the two places. Today: never. */
export function clearanceRefChecked(id: ClearanceRefId): boolean {
  const r = clearanceRef(id);
  return (r.checked.nyc || r.checked.baltimore) && r.checkedSource != null;
}

/** Who has read this table. Flip only with a named professional's review, as its own change. */
export const CLEARANCE_REFS_REVIEW = {
  status: 'pending_founder_review' as 'pending_founder_review' | 'founder_reviewed',
  professionalReview: 'none' as 'none' | 'architect_or_expediter',
};
