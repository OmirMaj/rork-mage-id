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
// THE REVIEWER'S READ (2026-10-09). An independent reviewer read this table
// and it was changed as each row's comment says. NOTHING the reviewer said is
// confirmed by the repo's checked data either, so every row keeps "A commonly
// used figure. Your local code may differ." and no section number, and the
// table stays `pending_founder_review` with no professional named.
//
// TWO KINDS OF ROW (`use`)
//   'compared'    a scanned distance is set beside it and gets a state;
//   'words_only'  it is only ever MENTIONED in a sentence on a row. No scanned
//                 distance is set beside it and it never gives a state.
//                 utils/roomScan/clearanceCore must not name one.
// AND WHERE (`where`)
//   'anywhere'    used in every place;
//   'nyc_only'    used ONLY when the project's address resolves to New York
//                 City (utils/codeFlags/place, asked by the caller). Named as
//                 that city's commonly cited figure, still not confirmed.
//
// LEFT OUT ON PURPOSE (the rule was: if it is not surely in common use, the
// measurement stays a plain number). Stair risers and treads (the scan does
// not carry them), a tub or shower opening (the scan gives a box, not an
// opening), a cased opening's width, the measured distance between two
// fixtures (the spacing figure is words only: the scan cannot be trusted for
// two centre lines at once), and every figure that only one place uses other
// than the two New York City ceiling lines.
//
// Pure data: no React, no storage, no network. The English `called` and
// `family` here are the words of record; the screen's strings (English and
// Spanish) live in hooks/useScanClearanceCopy.ts and the
// validator pins the English there equal to this table.

export type ClearanceRefId =
  | 'toilet_side_15'
  | 'toilet_front_21'
  | 'toilet_front_24'
  | 'toilet_spacing_30'
  | 'sink_front_21'
  | 'door_clear_32'
  | 'passage_36'
  | 'ceiling_84'
  | 'ceiling_bath_80'
  | 'ceiling_bath_84_nyc'
  | 'ceiling_90'
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
  | 'several_homes'
  | 'nyc_cited';

/** The plain words for each family of code. */
export const CLEARANCE_FAMILY_WORDS: Readonly<Record<ClearanceFamily, string>> = {
  residential_model: 'the model residential code',
  residential_and_plumbing_model: 'the model residential code and the model plumbing code',
  other_plumbing: 'a different family of plumbing code than the one New York and Maryland use',
  building_model: 'the model building code',
  several_homes: 'codes for buildings with several homes',
  nyc_cited: 'what is commonly cited for New York City, which this app has not confirmed',
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
  /** 'compared': a scanned distance is set beside it. 'words_only': only ever mentioned in a sentence. */
  use: 'compared' | 'words_only';
  /** 'nyc_only': used only when the project resolves to New York City. */
  where: 'anywhere' | 'nyc_only';
  /** Does the repo's own checked jurisdiction data confirm this number there? */
  checked: Readonly<Record<ClearancePlace, boolean>>;
  /** Where in the checked data the number was found. Needed for any `checked: true`. */
  checkedSource: null | { place: ClearancePlace; row: string; needle: string };
  /** A section number, only ever taken from the checked data. */
  section: null | { label: string; row: string };
}

const NOT_CHECKED = Object.freeze({ nyc: false, baltimore: false });
type RowIn = Omit<ClearanceRef, 'checked' | 'checkedSource' | 'section' | 'use' | 'where'> & Partial<Pick<ClearanceRef, 'use' | 'where'>>;
const row = (r: RowIn): ClearanceRef => ({ use: 'compared', where: 'anywhere', ...r, checked: NOT_CHECKED, checkedSource: null, section: null });

export const CLEARANCE_REFS: readonly ClearanceRef[] = [
  // Reviewer: agreed. Unchanged.
  row({ id: 'toilet_side_15', value: 15, unit: 'in', bound: 'min', called: 'toilet center line to a side wall or anything beside it', family: 'residential_and_plumbing_model' }),
  // Reviewer: agreed, and this is now the ONLY figure a toilet's front is read against.
  row({ id: 'toilet_front_21', value: 21, unit: 'in', bound: 'min', called: 'clear space in front of a toilet', family: 'residential_and_plumbing_model' }),
  // Reviewer: CHANGED. Was compared (22 in read Tight). Now words only: a figure from a different family of plumbing
  // code than the one New York and Maryland use. 22 in reads Close, against the 21 in row alone.
  row({ id: 'toilet_front_24', value: 24, unit: 'in', bound: 'min', called: 'clear space in front of a toilet', family: 'other_plumbing', use: 'words_only' }),
  // Reviewer: ADDED, words only. The scan is not trusted for two centre lines at once, so it is not measured.
  row({ id: 'toilet_spacing_30', value: 30, unit: 'in', bound: 'min', called: 'center to center between two fixtures side by side', family: 'residential_and_plumbing_model', use: 'words_only' }),
  // Reviewer: agreed. Unchanged. Measured from the front of the cabinet when the sink sits in one.
  row({ id: 'sink_front_21', value: 21, unit: 'in', bound: 'min', called: 'clear space in front of a bathroom sink', family: 'residential_and_plumbing_model' }),
  // Reviewer: CHANGED. Too broad as applied: a 28 or 30 in bathroom door is ordinary. Was compared (every door 33.5 in
  // or under read Close). Now words only: no interior door is labelled, and the row says the figure is commonly asked
  // of a home's main exit door, which a scan cannot identify.
  row({ id: 'door_clear_32', value: 32, unit: 'in', bound: 'min', called: 'clear width of the main exit door of a home with the door open', family: 'building_model', use: 'words_only' }),
  // Reviewer: agreed on the number. CHANGED in how a hallway is told: by the stretch two facing walls share.
  row({ id: 'passage_36', value: 36, unit: 'in', bound: 'min', called: 'width of a hallway', family: 'residential_model' }),
  // Reviewer: agreed. Unchanged.
  row({ id: 'ceiling_84', value: 84, unit: 'in', bound: 'min', called: 'ceiling height in a room people live in', family: 'residential_model' }),
  // Reviewer: agreed for places on the model residential code. In New York City the next row is set beside it.
  row({ id: 'ceiling_bath_80', value: 80, unit: 'in', bound: 'min', called: 'ceiling height in a bathroom', family: 'residential_model' }),
  // Reviewer: ADDED. The reviewer believes New York City uses 7 ft for bathrooms. Not confirmed. New York City only.
  row({ id: 'ceiling_bath_84_nyc', value: 84, unit: 'in', bound: 'min', called: 'ceiling height in a bathroom', family: 'nyc_cited', where: 'nyc_only' }),
  // Reviewer: ADDED, words only. The habitable-room figure for multi-family work.
  row({ id: 'ceiling_90', value: 90, unit: 'in', bound: 'min', called: 'ceiling height in a room people live in', family: 'several_homes', use: 'words_only' }),
  // Reviewer: CHANGED. Was "some city codes", shown everywhere. It is New York City's habitable-room figure: now shown
  // ONLY when the project resolves to New York City, named as that city's commonly cited figure. Not confirmed.
  row({ id: 'ceiling_96', value: 96, unit: 'in', bound: 'min', called: 'ceiling height in a room people live in', family: 'nyc_cited', where: 'nyc_only' }),
  // Reviewer: the four escape-opening rows are agreed as the model residential figures and unchanged. ADDED in words on
  // every window row: New York City is commonly stricter, and the row never clears a window.
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

export interface ClearanceRefsReview {
  status: 'pending_founder_review' | 'founder_reviewed' | 'professional_reviewed';
  professionalReview: 'none' | 'architect_or_expediter';
  /** The professional's own name. Null until one has read the table. */
  reviewedBy: string | null;
}

/**
 * Who has read this table. Flip only with a named professional's review, as
 * its own change. utils/roomScan/clearanceAllowed READS this: nobody but the
 * owner sees Clearance Check until `clearanceRefsProfessionallyRead` is true.
 */
export const CLEARANCE_REFS_REVIEW: ClearanceRefsReview = {
  status: 'pending_founder_review',
  professionalReview: 'none',
  reviewedBy: null,
};

/** True only when the status says a professional read the table AND that professional is named. */
export function clearanceRefsProfessionallyRead(review: ClearanceRefsReview = CLEARANCE_REFS_REVIEW): boolean {
  return review.status === 'professional_reviewed'
    && review.professionalReview === 'architect_or_expediter'
    && typeof review.reviewedBy === 'string' && review.reviewedBy.trim().length > 0;
}
