// utils/buildingScopeCopy.ts — every word the building-age lines say (Bet 1,
// "The Building Prices Itself", first slice). Plain English, sentence case,
// docs/VOICE.md. Kept in one module so the validator can read every string
// the rules and the card print and hold them to the honesty rules:
//   • a line is a reminder to CHECK, never a finding — nothing here says the
//     building has lead paint or asbestos;
//   • a rule with no rate of yours reads "Needs price", never a typical or
//     market number;
//   • PLUTO's year built is named as PLUTO's, and as possibly an estimate.
//
// Pure — no React, no storage, no network.

export const RRP_TOPIC = 'Lead-safe setup (EPA RRP)';
export const ACP5_TOPIC = 'Asbestos survey (NYC ACP-5)';

/** The cost-book labels the two rules price under. A rate he sets from the
 *  card is seeded under exactly this trade (hooks/useCostSeeds.addSeeds). */
export const RRP_BOOK_TRADE = 'Lead-safe setup';
export const ACP5_BOOK_TRADE = 'Asbestos survey';

export const RRP_REQUIRES =
  "EPA's RRP rule covers homes and child-occupied facilities built before 1978 when the work disturbs painted surfaces.";
export const RRP_EXEMPTION =
  'Small jobs under 6 sq ft inside or 20 sq ft outside, and buildings tested lead-free, can be exempt. Check before you price it.';

export const ACP5_REQUIRES =
  'If this project needs a DOB permit, NYC requires an asbestos investigation (ACP-5) first.';
export const ACP5_1987_LINE =
  'Built in 1987: ACP-5 depends on whether the new-building permit was issued before April 1, 1987.';

export function rrpWhy(year: number, triggeredBy: string): string {
  return `Built ${year}, before 1978. Your scope touches painted surfaces: ${triggeredBy}.`;
}

export function acp5Why(year: number): string {
  return year === 1987 ? ACP5_1987_LINE : `Built ${year}, before April 1, 1987.`;
}

export const PLUTO_FOOTER = "PLUTO's year built can be an estimate. Confirm with the building department.";
export const BUILDING_HEADER_NOTE =
  "Lead and asbestos lines come from the building's age. They are reminders to check, not findings.";

export const NEEDS_PRICE = 'Needs price';
export const SET_YOUR_PRICE = 'Set your price';
export const SET_PRICE_FIRST = 'Set your price first.';
export const PRICE_INPUT_HINT = 'Your price for one, in dollars and cents.';
export function priceBlockedReason(max: string): string {
  return `Enter an amount above $0.00 and up to ${max}.`;
}

export function plutoChip(year: number): string {
  return `PLUTO lists built ${year}`;
}
export function enteredChip(year: number): string {
  return `You entered ${year}`;
}
export function bothChip(entered: number, pluto: number): string {
  return `You entered ${entered} · PLUTO lists ${pluto}`;
}

export const YEAR_MISSING_NYC =
  'Year built not on file. Look up the building record on this project, or enter the year.';
export const YEAR_MISSING_ELSEWHERE = 'Year built not on file. Enter it to check lead and asbestos rules.';
export const ENTER_YEAR = 'Enter year';
export const CHANGE_YEAR = 'Change';
export const SAVE_YEAR = 'Save';
export const CANCEL = 'Cancel';
export const REMOVE_YEAR = 'Remove your year';
export const SAVED_ON_DEVICE = 'Saved on this device.';
export function yearBlockedReason(thisYear: number): string {
  return `Enter a year between 1600 and ${thisYear}`;
}
export function plutoAsOf(asOf: string): string {
  return `From PLUTO ${asOf}.`;
}

export function buildingInternalNote(ruleId: string, topic: string, chip: string, triggeredBy: string): string {
  return `Building-age reminder ${ruleId} (${topic}). ${chip}. Triggered by ${triggeredBy}. A reminder to check, not a finding.`;
}
