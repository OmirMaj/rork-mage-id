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
 * The contractor's own state, read off the address they typed into their
 * company profile. Licensing follows the contractor, and this is the only
 * state the profile knows — a blank or unparseable address yields '', which
 * bidLicenceRuleForState turns into "no licence asked for".
 *
 * WHAT THAT SILENTLY SKIPS, stated plainly because it is not obvious and it is
 * the common case: a brand-new account has no company address, so a new
 * California contractor's FIRST bid — the exact document this module exists
 * for — goes out with no licence number and is never asked for one. Asking
 * anyway would mean guessing the contractor's licensing state from the
 * JOBSITE, and a bid priced for a job across a state line would then be
 * blocked over the wrong state's statute, or worse, stamped with a number the
 * board there has never issued. A false block on a bid is worse than a missing
 * line, so the skip is deliberate: the ask arrives the moment the profile
 * carries an address, and app/company-profile.tsx is where that gets typed.
 * Closing the gap properly means asking the contractor which state licenses
 * them, which is a profile question, not a share-sheet question.
 *
 * REVIEWED AND KEPT (2026-09-10). The size of the skip was measured, not
 * guessed: an empty profile, an address with no state, a PO box, a street line
 * with no city, and any non-US address all resolve to '' and are asked for a
 * company name only. That is most FIRST bids — so this module closes the
 * vendor-name hole for everybody and the licence hole only for contractors whose
 * profile address is already typed in. The alternative considered was rendering
 * the licence field as an optional extra when no state is known; rejected not
 * because it would block anyone (it would not) but because it puts a second
 * field on the one screen standing between a brand-new account and its first
 * finished bid, and the reason for asking here rather than in onboarding was to
 * ask for the minimum. The skip is honest, narrower than it looks, and written
 * down.
 */
export function bidStateFromBranding(branding: Partial<CompanyBranding> | null | undefined): string {
  return splitLocationText(branding?.address ?? '').state;
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

/**
 * What is missing from the branding that a client-facing bid PDF is built from.
 *
 * Company name is required everywhere. The licence number is required only in
 * the states in BID_LICENCE_RULES, resolved from the contractor's own profile
 * address — see the header comment on why the table stays small.
 */
export function bidIdentityGap(
  branding: Partial<CompanyBranding> | null | undefined,
): BidIdentityGap {
  const rule = bidLicenceRuleForState(bidStateFromBranding(branding));
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
  draft: { companyName?: string; licenseNumber?: string },
): CompanyBranding {
  return {
    companyName:   (draft.companyName ?? existing?.companyName ?? '').trim(),
    contactName:   existing?.contactName ?? '',
    email:         existing?.email ?? '',
    phone:         existing?.phone ?? '',
    address:       existing?.address ?? '',
    licenseNumber: (draft.licenseNumber ?? existing?.licenseNumber ?? '').trim(),
    tagline:       existing?.tagline ?? '',
    logoUri:       existing?.logoUri,
    signatureData: existing?.signatureData,
  };
}
