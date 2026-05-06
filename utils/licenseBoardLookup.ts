// licenseBoardLookup — maps US state codes to the official contractor
// licensing board's public lookup URL, so MAGE ID can deep-link a sub's
// license number into the right state's verifier.
//
// The "verified license + insurance badges" feature has two parts:
//   1. URL helpers (this file) — open the state's official source so the
//      GC sees the live, authoritative answer (active / expired /
//      suspended). No scraping, no maintenance burden.
//   2. Verification timestamp (Subcontractor.licenseVerifiedAt) — the
//      GC taps "I verified it's active" after looking, which stamps the
//      sub's record. The badge on the sub card grows greener when the
//      stamp is recent (under 90 days).
//
// Design choice: we open the official source rather than scraping it.
// Each state's website changes its DOM regularly; a scraper would break
// silently. A direct deep-link gives the user the LIVE answer from the
// authority and keeps us out of the "we said valid but they're suspended"
// liability zone.
//
// Coverage note: the URLs below cover the largest states by residential
// construction volume. For unsupported states, the fallback is a generic
// "search [state name] contractor license [number]" Google query, which
// usually surfaces the right state board within the first result.

export interface LicenseLookupTarget {
  /** State name shown in the UI ("California"). */
  stateName: string;
  /** State agency name shown in the verification banner. */
  agencyName: string;
  /** Either a deep-link template that takes the license number directly,
   *  or null when the agency requires manual entry on the search form
   *  (in which case we open the search page and the GC types it). */
  buildUrl: (licenseNumber: string) => string;
  /** When true, the URL deep-links the lookup; false means it just opens
   *  the search page for the GC to enter the number. Affects how we
   *  word the CTA: "Verify on CSLB" vs "Open CSLB search". */
  directDeepLink: boolean;
}

const ENC = encodeURIComponent;

const STATE_BOARDS: Record<string, LicenseLookupTarget> = {
  CA: {
    stateName: 'California',
    agencyName: 'CSLB',
    buildUrl: (n) => `https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/LicenseDetail.aspx?LicNum=${ENC(n)}`,
    directDeepLink: true,
  },
  TX: {
    stateName: 'Texas',
    agencyName: 'TDLR',
    // TDLR doesn't deep-link by license# directly; sends to search form.
    buildUrl: () => `https://www.tdlr.texas.gov/license_search/`,
    directDeepLink: false,
  },
  FL: {
    stateName: 'Florida',
    agencyName: 'DBPR',
    buildUrl: (n) => `https://www.myfloridalicense.com/wl11.asp?mode=2&search=Number&SID=&licnbr=${ENC(n)}`,
    directDeepLink: true,
  },
  NY: {
    stateName: 'New York',
    agencyName: 'NY State Dept. of State',
    // NY doesn't have a unified contractor license — most are NYC DCWP /
    // local. Send to NYC's home-improvement contractor lookup as the
    // most common case for residential.
    buildUrl: () => `https://a866-ilsweb.nyc.gov/ils/businessHome.html`,
    directDeepLink: false,
  },
  AZ: {
    stateName: 'Arizona',
    agencyName: 'AZ ROC',
    buildUrl: (n) => `https://roc.az.gov/contractor-search?keys=${ENC(n)}`,
    directDeepLink: true,
  },
  NV: {
    stateName: 'Nevada',
    agencyName: 'NSCB',
    buildUrl: () => `https://app.nvcontractorsboard.com/Clients/NVSCB/Public/ContractorLicenseSearch/ContractorLicenseSearch.aspx`,
    directDeepLink: false,
  },
  WA: {
    stateName: 'Washington',
    agencyName: 'L&I',
    buildUrl: (n) => `https://secure.lni.wa.gov/verify/Detail.aspx?LicenseNumber=${ENC(n)}`,
    directDeepLink: true,
  },
  OR: {
    stateName: 'Oregon',
    agencyName: 'CCB',
    buildUrl: (n) => `https://search.ccb.state.or.us/search/search_no_idx.aspx?lic=${ENC(n)}`,
    directDeepLink: true,
  },
  GA: {
    stateName: 'Georgia',
    agencyName: 'GA SLBGC',
    buildUrl: () => `https://verify.sos.ga.gov/Verification/`,
    directDeepLink: false,
  },
  CO: {
    stateName: 'Colorado',
    agencyName: 'DORA',
    buildUrl: () => `https://apps.colorado.gov/dora/licensing/Lookup/LicenseLookup.aspx`,
    directDeepLink: false,
  },
  NC: {
    stateName: 'North Carolina',
    agencyName: 'NCLBGC',
    buildUrl: () => `https://portal.nclbgc.org/Public/Search`,
    directDeepLink: false,
  },
  VA: {
    stateName: 'Virginia',
    agencyName: 'DPOR',
    buildUrl: () => `https://dporweb.dpor.virginia.gov/lookupbycriteria.aspx`,
    directDeepLink: false,
  },
  MD: {
    stateName: 'Maryland',
    agencyName: 'MHIC',
    buildUrl: () => `https://www.dllr.state.md.us/cgi-bin/ElectronicLicensing/OP_search/OP_search.cgi?calling_app=MHIC::MHIC_qselect`,
    directDeepLink: false,
  },
};

/**
 * Resolve the right official lookup target for a given state code.
 * Falls back to a Google search if the state isn't in our coverage map.
 */
export function getLicenseLookupTarget(stateCode: string | undefined, licenseNumber: string): LicenseLookupTarget | null {
  const trimmed = (licenseNumber ?? '').trim();
  if (!trimmed) return null;
  const code = (stateCode ?? '').trim().toUpperCase();
  const known = STATE_BOARDS[code];
  if (known) return known;
  // Fallback: Google query that usually finds the right state board.
  if (!code) return null;
  return {
    stateName: code,
    agencyName: `${code} contractor board (search)`,
    buildUrl: (n) => `https://www.google.com/search?q=${ENC(`${code} contractor license ${n}`)}`,
    directDeepLink: false,
  };
}

/**
 * Quick way for the UI to know if we have first-class coverage of a
 * state vs. falling back to Google. Lets the badge show "via CSLB"
 * confidently when we do, and stay quiet when we don't.
 */
export function hasFirstClassLicenseLookup(stateCode: string | undefined): boolean {
  if (!stateCode) return false;
  return Object.prototype.hasOwnProperty.call(STATE_BOARDS, stateCode.trim().toUpperCase());
}

/**
 * List every state we have first-class coverage for. Used in pickers
 * (the licenseState selector on the sub edit form).
 */
export function getSupportedLicenseStates(): { code: string; name: string }[] {
  return Object.entries(STATE_BOARDS).map(([code, t]) => ({ code, name: t.stateName }));
}
