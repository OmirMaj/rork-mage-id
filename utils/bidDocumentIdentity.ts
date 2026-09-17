// utils/bidDocumentIdentity.ts — the identity a bid PDF has to carry before a
// homeowner can be handed it, and which of it is missing.
//
// WHY THIS EXISTS. utils/pdfDesign.ts renders the header off CompanyBranding
// and falls back to the literal string "MAGE ID" when companyName is blank
// (`branding.companyName || 'MAGE ID'`), while the licence line is dropped
// entirely when licenseNumber is blank. app/estimate-wizard.tsx then passed
// that same "MAGE ID" string as its OWN default, so the very first proposal a
// new contractor sends — the document a homeowner reads before signing a
// six-figure remodel — went out under the software vendor's name with no
// licence number anywhere on it. The name is an embarrassment; in California,
// Florida and Arizona the missing number is what the state board fines you for.
//
// Pure: no React, no react-native, no storage. scripts/validate-activation-
// signals.ts drives it under bun.
//
// ── THE LICENCE TABLE IS SMALL AND CITED, AND AN ABSENT ROW IS A CORRECT
//    ANSWER ────────────────────────────────────────────────────────────────
// Same rule utils/codeJurisdiction.ts states for code editions, for the same
// reason: a row written from recall would stop a contractor from sending a bid
// over a requirement their state does not actually have, which is a worse
// failure than not asking. Every row below was read off the statute text on the
// date in `checkedOn`, at the URL in `sourceUrl`. A state with no row is never
// asked for a licence number — only for a company name, which every bid in
// every jurisdiction needs.
//
// Deliberately NOT rows here, each checked and rejected on 2026-09-08:
//   NV — NRS 624.720 requires the company name and licence number in
//        ADVERTISING, and its definition of advertising is signs, vehicles,
//        directories and broadcast. A proposal handed to one homeowner is not
//        obviously any of those, so the requirement is not asserted.
//   LA — R.S. 37:2163 puts the number on the BID ENVELOPE for public work let
//        by an awarding authority. Not the residential proposal this wizard
//        produces.
//   UT — 58-55-501 forbids an unlicensed person from bidding at all; it does
//        not require the number to appear on the document.

import type { CompanyBranding } from '@/types';
import { normalizeState, splitLocationText } from '@/utils/codeJurisdiction';
import { parseCalendarDay } from '@/utils/calendarDate';

/** The vendor name utils/pdfDesign.ts prints when companyName is blank. A
 *  branding still carrying it has not been filled in — it IS the fallback, and
 *  treating it as a real answer is how "MAGE ID" reached homeowners. */
export const PDF_VENDOR_PLACEHOLDER = 'MAGE ID';

export interface BidLicenceRule {
  /** Two-letter USPS code, as normalizeState returns it. */
  state: string;
  /** The board a contractor would recognise, used in the ask ("your CSLB
   *  number"). */
  authority: string;
  /** The statute, cited the way it is cited in that state. */
  citation: string;
  /** What the statute says must carry the number, in the statute's own terms.
   *  Rendered into the ask, so it must read as a sentence fragment. */
  requirement: string;
  /** ISO date the statute text at sourceUrl was read. */
  checkedOn: string;
  sourceUrl: string;
}

export const BID_LICENCE_RULES: readonly BidLicenceRule[] = [
  {
    state: 'CA',
    authority: 'CSLB',
    citation: 'Business and Professions Code § 7030.5',
    requirement: 'all construction contracts, subcontracts and calls for bid, and all forms of advertising',
    checkedOn: '2026-09-08',
    sourceUrl: 'https://california.public.law/codes/business_and_professions_code_section_7030.5',
  },
  {
    state: 'FL',
    authority: 'DBPR',
    citation: 'Florida Statutes § 489.119(5)(b)',
    requirement: 'each offer of services, business proposal, bid, contract, or advertisement',
    checkedOn: '2026-09-08',
    sourceUrl: 'https://www.flsenate.gov/laws/statutes/2024/489.119',
  },
  {
    state: 'AZ',
    authority: 'AZ ROC',
    citation: 'A.R.S. § 32-1124(B)(2)',
    requirement: 'all written bids and estimates submitted by the licensee',
    checkedOn: '2026-09-08',
    sourceUrl: 'https://www.azleg.gov/ars/32/01124.htm',
  },
];

/** The rule for a state, or null — which is the answer for every state the
 *  table does not cover, and never a guess at a neighbouring state's law. */
export function bidLicenceRuleForState(state: string | null | undefined): BidLicenceRule | null {
  const code = normalizeState(state);
  if (!code) return null;
  return BID_LICENCE_RULES.find((r) => r.state === code) ?? null;
}

/**
 * The contractor's licensing state, from the first of three profile fields
 * that names one:
 *
 *   1. branding.licenseState — his explicit answer to "which state licenses
 *      you?" (Company Profile's licensing-state row, Get Verified's issuing
 *      state). profiles.license_state.
 *   2. the state in branding.address — the office on the letterhead.
 *   3. the state in his pricing market (`settings.location`).
 *
 * Licensing follows the contractor, never the jobsite, and these are the only
 * places the profile records where the contractor is. None resolving yields
 * '', which bidLicenceRuleForState turns into "no licence asked for".
 *
 * WHY AN EXPLICIT FIELD, AND WHY IT OUTRANKS THE OTHER TWO (2026-09-17).
 * The 2026-09-16 fix had nowhere to keep the answer — CompanyBranding had no
 * state — so the licensing-state picker wrote it onto settings.location, the
 * pricing market. That coupled two different facts: picking a Los Angeles
 * market in Materials turned on California's licence-number block, and a GC
 * licensed in Arizona who prices in Nevada could not say so without
 * re-pricing his work (the picker refused, and told him to lie in his address
 * instead). The licence now has its own column. It wins because it is the only
 * one of the three that is an answer to the licensing question; the address
 * and the market are inferences from where he sits and where he prices.
 *
 * WHY THE ADDRESS AND MARKET FALLBACKS STAY. A brand-new account has neither
 * answered the question nor typed an address, and the company profile's old
 * placeholder ("123 Main St, City") carried no state — so with no fallback a
 * new California contractor's first bid went out with no licence number and
 * was never asked for one. The market is his own answer to "where do you
 * work", not the jobsite (guessing from the jobsite would block a bid across
 * a state line over the wrong statute), and accounts that set their state
 * through the market on 2026-09-16 keep their gate without re-answering.
 * Every block reason names which of the three the state came from, so a
 * contractor walled by an inference can find the field that overrides it.
 *
 * What still resolves to '' — asked for a company name only: no licensing
 * state, no address state, and a market left at the 'United States' default,
 * a bare city ("Houston"), or a non-US place.
 */
export function bidStateFromBranding(
  branding: Partial<CompanyBranding> | null | undefined,
  marketLocation?: string | null,
): string {
  return bidLicenceStateSource(branding, marketLocation).state;
}

export type BidLicenceStateSource = 'licence' | 'address' | 'market' | null;

/** Which profile field the licensing state came from, so a screen can say
 *  WHERE it read it — a state the contractor cannot trace is a state he
 *  cannot correct. Precedence documented on bidStateFromBranding. */
export function bidLicenceStateSource(
  branding: Partial<CompanyBranding> | null | undefined,
  marketLocation?: string | null,
): { state: string; source: BidLicenceStateSource } {
  const explicit = normalizeState(branding?.licenseState);
  if (explicit) return { state: explicit, source: 'licence' };
  const fromAddress = splitLocationText(branding?.address ?? '').state;
  if (fromAddress) return { state: fromAddress, source: 'address' };
  const fromMarket = splitLocationText(marketLocation ?? '').state;
  if (fromMarket) return { state: fromMarket, source: 'market' };
  return { state: '', source: null };
}

/**
 * profiles.license_state as it may be sent: a two-letter USPS code or null.
 * The column carries CHECK (license_state ~ '^[A-Z]{2}$'), and a CHECK
 * violation is TERMINAL in utils/offlineQueue.ts — it would drop the WHOLE
 * profiles update the value rides on (company name, tax rate, digest, all of
 * it). So nothing reaches the column that normalizeState did not produce, and
 * blank is NULL ("not told"), never ''.
 */
export function licenceStateColumnValue(value: string | null | undefined): string | null {
  return normalizeState(value) || null;
}

/**
 * profiles.license_expiry (a `date`) as it may be sent: a real calendar day
 * 'YYYY-MM-DD' or null. A string Postgres cannot cast ('2026-02-30', '12/31')
 * would fail the same whole-row update, so it is checked with the repo's
 * round-tripping calendar-day parser — never `new Date('YYYY-MM-DD')`, which
 * reads UTC midnight and accepts rollover. A full ISO instant is cut to its
 * date part, the way PostgREST can hand a date back.
 */
export function licenceExpiryColumnValue(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim();
  // A day, or a day followed by a time — never a day with trailing junk
  // ("2027-06-30abc" is a typo, not an answer).
  if (raw.length !== 10 && raw[10] !== 'T') return null;
  const day = raw.slice(0, 10);
  return parseCalendarDay(day) ? day : null;
}

/** True when the field would leave the PDF header printing the vendor's name
 *  instead of the contractor's. Covers blank, whitespace, and the literal
 *  placeholder — `?? 'MAGE ID'` only ever caught null/undefined, so an empty
 *  string sailed through the caller and hit pdfDesign's own `|| 'MAGE ID'`. */
function isPlaceholderCompanyName(name: string | null | undefined): boolean {
  const trimmed = (name ?? '').trim();
  return trimmed.length === 0
    || trimmed.toUpperCase() === PDF_VENDOR_PLACEHOLDER.toUpperCase();
}

export interface BidIdentityGap {
  needsCompanyName: boolean;
  needsLicence: boolean;
  /** The rule that made needsLicence true, or the rule for the contractor's
   *  state when the number is already on file. Null outside the cited states. */
  rule: BidLicenceRule | null;
  /** Whether the share must stop and ask. */
  blocking: boolean;
  /** Heading for the ask. Names the document, not the field. */
  title: string;
  /** Why this is being asked, in terms of what the homeowner will be holding.
   *  '' when nothing is missing. The repo rule is that a blocked button says
   *  why, so this is the only wording of the reason — the ask and the
   *  still-incomplete hint both render this string. */
  reason: string;
}

/** The block reason's "where we read the state" sentence, per source. */
function licenceSourceSentence(state: string, source: BidLicenceStateSource): string {
  switch (source) {
    case 'licence':
      return `${state} is the licensing state on your company profile.`;
    case 'address':
      return `We read ${state} from your company address. Licensed in a different state? Set your licensing state in Company Profile.`;
    case 'market':
      return `We read ${state} from your pricing market in Settings. Licensed in a different state? Set your licensing state in Company Profile.`;
    default:
      return '';
  }
}

/**
 * What is missing from the branding that a client-facing bid PDF is built from.
 *
 * Company name is required everywhere. The licence number is required only in
 * the states in BID_LICENCE_RULES, resolved from the contractor's licensing
 * state, then his profile address, then his pricing market (`settings.location`
 * — pass it, or a new account with neither of the first two is never asked) —
 * see bidStateFromBranding, and the header comment on why the table stays small.
 */
export function bidIdentityGap(
  branding: Partial<CompanyBranding> | null | undefined,
  marketLocation?: string | null,
): BidIdentityGap {
  const where = bidLicenceStateSource(branding, marketLocation);
  const rule = bidLicenceRuleForState(where.state);
  const needsCompanyName = isPlaceholderCompanyName(branding?.companyName);
  const needsLicence = !!rule && (branding?.licenseNumber ?? '').trim().length === 0;

  const parts: string[] = [];
  if (needsCompanyName) {
    parts.push(
      `The header of this PDF prints your company name. With it blank the proposal goes out as “${PDF_VENDOR_PLACEHOLDER}” — the software’s name, not yours.`,
    );
  }
  if (needsLicence && rule) {
    parts.push(
      `Your ${rule.authority} licence number prints underneath it, and the line is simply left off when the field is empty. ${rule.citation} requires the number on ${rule.requirement}.`,
    );
    // Always say which field the state was read from. Two of the three are
    // inferences, and a contractor licensed somewhere other than where he
    // sits or prices must be able to find the one field that overrides them
    // (Company Profile → Licensing state) rather than be walled by the wrong
    // state's statute — or be told to type a false office address, which is
    // what this sentence said while the market was the only place to save it.
    parts.push(licenceSourceSentence(rule.state, where.source));
  }

  return {
    needsCompanyName,
    needsLicence,
    rule,
    blocking: needsCompanyName || needsLicence,
    title: 'This prints on the homeowner’s copy',
    reason: parts.join(' '),
  };
}

/**
 * Fold what the contractor just typed onto their saved branding, trimmed.
 *
 * Callers must share the PDF from the RESULT of this, not from context state
 * they re-read after saving: updateSettings writes through the offline queue
 * and the `settings` value already captured in the share closure is the old
 * one, so re-reading it would generate the PDF with exactly the blank fields
 * the user was just asked to fill in.
 */
export function mergedBidBranding(
  existing: Partial<CompanyBranding> | null | undefined,
  draft: { companyName?: string; licenseNumber?: string; licenseState?: string; licenseExpiry?: string },
): CompanyBranding {
  return {
    companyName:   (draft.companyName ?? existing?.companyName ?? '').trim(),
    contactName:   existing?.contactName ?? '',
    email:         existing?.email ?? '',
    phone:         existing?.phone ?? '',
    address:       existing?.address ?? '',
    licenseNumber: (draft.licenseNumber ?? existing?.licenseNumber ?? '').trim(),
    // Carried even when the draft does not touch them: this object REPLACES
    // settings.branding, and ProjectContext writes an absent licenceState as
    // NULL — so a merge that forgot them would erase the contractor's
    // licensing answer every time the wizard's ask saved a company name.
    licenseState:  licenceStateColumnValue(draft.licenseState ?? existing?.licenseState) ?? '',
    licenseExpiry: licenceExpiryColumnValue(draft.licenseExpiry ?? existing?.licenseExpiry) ?? '',
    tagline:       existing?.tagline ?? '',
    logoUri:       existing?.logoUri,
    signatureData: existing?.signatureData,
  };
}
