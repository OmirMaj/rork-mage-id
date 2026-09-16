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
 * company profile — and, when that address carries no state, off the market
 * they price in (`settings.location`). Licensing follows the contractor, and
 * these are the only two places the profile records where the contractor is.
 * Neither resolving yields '', which bidLicenceRuleForState turns into "no
 * licence asked for".
 *
 * WHAT THIS USED TO SILENTLY SKIP (2026-09-08 → 2026-09-16). The address was
 * the ONLY input, a brand-new account has no company address, and the company
 * profile's own placeholder taught "123 Main St, City" — no state. So a new
 * California contractor's first bid went out with no licence number and was
 * never asked for one, and a contractor who typed exactly what the box showed
 * him was exempted forever. The header of this function said so and called the
 * fix "a profile question, not a share-sheet question".
 *
 * WHY THE MARKET IS A LEGITIMATE SECOND SOURCE. The refusal that made the skip
 * deliberate was to guess the licensing state from the JOBSITE: a bid for a job
 * across a state line would be blocked over the wrong state's statute. The
 * market is not the jobsite. It is the contractor's own answer to "where do you
 * work", saved once on his profile (Settings → Location, the Materials market
 * picker, or the company profile's licensing-state row, which writes it), and it
 * already prices every catalog figure and change order he sends. The address
 * still wins when it carries a state: it is the office on the letterhead, and a
 * contractor licensed somewhere other than where he prices is told, in the
 * block reason, that the address is where to say so.
 *
 * What still resolves to '' — asked for a company name only: no address state
 * AND a market left at the 'United States' default, a bare city ("Houston"),
 * or a non-US place. That remainder is honest and written down.
 */
export function bidStateFromBranding(
  branding: Partial<CompanyBranding> | null | undefined,
  marketLocation?: string | null,
): string {
  return bidLicenceStateSource(branding, marketLocation).state;
}

export type BidLicenceStateSource = 'address' | 'market' | null;

/** Which of the two profile fields the licensing state came from, so a screen
 *  can say WHERE it read it — a state the contractor cannot trace is a state
 *  he cannot correct. */
export function bidLicenceStateSource(
  branding: Partial<CompanyBranding> | null | undefined,
  marketLocation?: string | null,
): { state: string; source: BidLicenceStateSource } {
  const fromAddress = splitLocationText(branding?.address ?? '').state;
  if (fromAddress) return { state: fromAddress, source: 'address' };
  const fromMarket = splitLocationText(marketLocation ?? '').state;
  if (fromMarket) return { state: fromMarket, source: 'market' };
  return { state: '', source: null };
}

/**
 * The market text to save when the contractor picks his licensing state on a
 * profile screen and his address does not already carry one — or why it must
 * not be saved.
 *
 * The state goes onto `settings.location` because that is the persisted field
 * bidStateFromBranding reads next (CompanyBranding has no state column). That
 * field also PRICES his work, so the edit is refused whenever it would move his
 * pricing market: "Houston" + CA would re-price a Texas contractor at the West
 * Coast index without a word. `resolveMarket` is injected (callers pass
 * constants/materials' resolvePricingMarket) so this module stays free of the
 * catalog.
 */
export function licenceStateMarketEdit(
  currentLocation: string | null | undefined,
  stateCode: string,
  resolveMarket: (location: string) => { label: string; multiplier: number; resolved: boolean },
): { ok: true; location: string } | { ok: false; reason: string } {
  const code = normalizeState(stateCode);
  if (!code) return { ok: false, reason: 'Pick a US state.' };
  const current = (currentLocation ?? '').trim();
  const parsed = splitLocationText(current);
  if (parsed.state === code) return { ok: true, location: current };
  // The 'United States' default parses as a city named "United States".
  const isDefault = !current || /^united states$/i.test(current);
  const city = isDefault ? '' : parsed.city;
  const next = city ? `${city}, ${code}` : code;
  const before = resolveMarket(current);
  const after = resolveMarket(next);
  const samePricing = before.label === after.label && before.multiplier === after.multiplier;
  if (!before.resolved || samePricing) return { ok: true, location: next };
  return {
    ok: false,
    reason: `Your pricing market is ${before.label}, and saving ${code} there would re-price your materials and change orders for ${after.resolved ? after.label : 'the US average'}. If you are licensed in a different state from where you work, put that state in your company address instead.`,
  };
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
 * address, then his pricing market (`settings.location` — pass it, or a new
 * account with no address is never asked) — see bidStateFromBranding, and the
 * header comment on why the table stays small.
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
    // Say where the state was read when it was not the address, so a
    // contractor licensed somewhere other than where he prices can correct it
    // rather than being walled by the wrong state's statute.
    if (where.source === 'market') {
      parts.push(
        `We read ${rule.state} from your pricing market in Settings. Licensed in a different state? Put that state in your company address.`,
      );
    }
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
