// utils/codeAmendments.ts — the rung a Code Check citation is standing on.
//
// Pure: no React, no RN, no storage, no network. Its only import is the
// jurisdiction table it sits on top of. scripts/validate-code-jurisdiction.ts
// drives it under bun.
//
// ─────────────────────────────────────────────────────────────────────
// WHAT THIS IS, IN ONE SENTENCE
//   Code Check's section numbers come out of a model's memory. This module
//   cannot make them true — nothing in this repo can — but it CAN say, for
//   each one, exactly how much MAGE actually knows, and it can put the
//   contractor one tap from the document that settles it.
//
// ─────────────────────────────────────────────────────────────────────
// THE LADDER. A contractor must be able to tell which rung he is on at a
// glance, so every citation carries a badge, and the badges differ:
//
//   RUNG 1  STATE AMENDMENT      The state's own register amends this exact
//                                section of this exact model code, and MAGE
//                                holds the state's amendment text verbatim.
//                                Quoted, cited, linked, dated.
//                                (A weaker variant — PARENT SECTION AMENDED —
//                                fires when the register amends the PARENT of
//                                the cited number. It says so, and explicitly
//                                does NOT claim the cited subsection exists.)
//
//   RUNG 2  SECTION NAMED IN LAW A government document names this exact
//                                section of this code, but MAGE holds no text
//                                for it. Cited, linked, dated. The number is
//                                verified; the requirement is not reproduced.
//
//   RUNG 3  MODEL RECALL         MAGE knows the governing EDITION (that is
//           EDITION KNOWN        utils/codeJurisdiction.ts, 28 verified rows)
//                                and nothing about the section. The number is
//                                the model's recall. The chip now also hands
//                                over a link to the governing volume in ICC's
//                                free viewer, so "verify with your AHJ" costs
//                                one tap instead of an afternoon.
//
//   RUNG 4  MODEL RECALL         No adoption record for this address. Today's
//           NO JURISDICTION      behaviour, unchanged.
//
// ─────────────────────────────────────────────────────────────────────
// WHAT IS DELIBERATELY NOT HERE, AND WHY — read this before "improving" it
//
// 1. NO MODEL-CODE TEXT. Not the IBC, not the IRC, not an ICC state volume,
//    not one section of one, not cached, not embedded, not chunked into
//    memory_embeddings. ICC's Terms of Use (revised 2023-05-04) exclude from
//    their licence any "derivative use", any "commercial use", and any "use of
//    data mining, robots, or similar data gathering and extraction tools with
//    any Service or E-Content". A fair-use defence to copyright is not a
//    defence to breach of contract, and the favourable copyright authority
//    (ASTM v. UpCodes, 3d Cir. No. 24-2965, 7 Apr 2026) is out-of-circuit,
//    interlocutory, and says "at this juncture". Serving that text is a
//    decision for counsel and for a licence, not for a commit.
//
//    What IS here is government-edict text: a STATE'S OWN regulation amending
//    a named section. State regulations carry no copyright (Georgia v.
//    Public.Resource.Org, 590 U.S. 255 (2020)) and no terms of use. That is
//    the whole of rung 1, and it is often the part that actually fails an
//    inspection — the contractor who prices the model section and misses the
//    state amendment is the one who tears work out.
//
// 2. NO PROGRAMMATIC SECTION-EXISTENCE CHECK AGAINST ICC. It is technically
//    possible: codes.iccsafe.org/lookup/<ID>_Ch<NN>_Sec<N.N.N> returns a
//    server-rendered <title> for a real section and none for a fake one. It is
//    not built, for two independent reasons, either of which is sufficient.
//      (a) codes.iccsafe.org/robots.txt carries `Disallow: /lookup` for
//          User-agent: * — verified 2026-09-13 — and the terms above forbid
//          robots against E-Content for a commercial purpose.
//      (b) The oracle's NEGATIVE is ambiguous. IRC2021P1_Ch03_SecR310.1 and
//          bare /lookup/IRC2021P1 both return no title while
//          /content/IRC2021P1 is a valid volume: the IRC id namespace does not
//          follow the IBC's. An oracle that cannot deny is an oracle that
//          would have to stay silent on most of what this app's users build.
//    If ICC grants written permission (license@iccsafe.org is the address
//    their own terms name for "further uses"), this becomes a real rung 2 for
//    every jurisdiction at once. Until then it is a liability, not a feature.
//
// 3. NO SECTION-LEVEL DEEP LINK, EVER, FROM A RECALLED NUMBER. Verified
//    2026-09-13: https://codes.iccsafe.org/content/IBC2021P1/chapter-99-not-a-
//    real-chapter returns HTTP 200. Only the CODE ID is validated by that
//    route; everything below it renders. A section-level link built from a
//    model's recall is a link that opens, looks authoritative and points at
//    nothing — the exact "real URL beside a recalled claim" shape that
//    utils/codeJurisdiction.ts's header calls the most dangerous a row can
//    take. `iccViewerUrl` below refuses any id that is not a bare volume id,
//    and there is no function here that appends a section to one.
//
// 4. NO WEAKENING OF THE RECALL CHIP. Rungs 3 and 4 are still recall and the
//    screen still says so, in the same place, at the same size. This module
//    only ever ADDS evidence; it never removes a warning.

import {
  codesSummary,
  groundingFactsFor,
  iccViewerUrl,
  viewerLinksFor,
  type AdoptedCode,
  type CodeFamily,
  type ResolvedCodeJurisdiction,
} from './codeJurisdiction';

// ─────────────────────────────────────────────────────────────────────
// Shapes
// ─────────────────────────────────────────────────────────────────────

/**
 * One section of one model code, as amended or named by a government document.
 *
 * Every string is read off the page at `sourceUrl`, by a human, on the date in
 * `checkedOn`. `readBy` says who read it and how.
 *
 * THERE IS NO GENERATED SOURCE FOR THIS SHAPE, deliberately. A scripted
 * register scraper filled this table once, in 2026-09, and shipped a green
 * STATE AMENDMENT badge over the WRONG CODE on 19 of 141 rows — the WAC
 * chapter it read adopts two codes and the generator stamped the family from
 * the chapter rather than the block. Every layer of verification it came with
 * agreed it was correct, including a network receipt reading "141 confirmed,
 * 0 WRONG"; a human reading the register index by hand found it. The pipeline
 * was withdrawn. A row here is a row somebody opened.
 */
export interface StateAmendment {
  /** Two-letter USPS code of the state whose document this is. */
  state: string;
  /** Model-code family the amended section belongs to. */
  family: CodeFamily | string;
  /** The edition of that family the document amends, e.g. '2021'. */
  edition: string;
  /**
   * Set ONLY when the amended code is a locally-titled volume rather than a
   * model family — "2025 Residential Code of New York State". Must equal the
   * `name` on the matching AdoptedCode in codeJurisdiction.ts exactly, or the
   * row can never fire.
   */
  codeName?: string;
  /** Abbreviations the AUTHORITY ITSELF prints for `codeName`. Not invented. */
  codeAliases?: readonly string[];
  /** The section number exactly as the document prints it: '1011', 'R310'. */
  section: string;
  /** The document's own caption for the section, verbatim. */
  caption: string;
  /** The document's own citation: 'WAC 51-50-1011', '19 NYCRR § 1220.2(a)(6)'. */
  cite: string;
  /** The office that promulgated it, as it calls itself. */
  authorityName: string;
  /** The page this row was read off. */
  sourceUrl: string;
  /** ISO date (YYYY-MM-DD) the row was read off sourceUrl. */
  checkedOn: string;
  /**
   * The government's amendment text, verbatim. '' means MAGE holds no text —
   * that is rung 2, and it is a legitimate row, not a broken one.
   */
  amendmentText: string;
  /** False when `amendmentText` was cut for weight. The UI must say so. */
  textComplete: boolean;
  /** Who read the page, and how: 'human pass 2026-09-13 — curl + pdftotext …'. */
  readBy: string;
}

export type CitationRung = 'amended' | 'named' | 'edition' | 'unresolved';

/** 1 is the strongest. Used for ordering and for the badge's colour. */
export const RUNG_INDEX: Readonly<Record<CitationRung, 1 | 2 | 3 | 4>> = Object.freeze({
  amended: 1,
  named: 2,
  edition: 3,
  unresolved: 4,
});

export interface CitationEvidence {
  rung: CitationRung;
  rungIndex: 1 | 2 | 3 | 4;
  /** Two or three words, readable without reading. Differs on every rung. */
  badge: string;
  /** One sentence saying exactly what MAGE checked and what it did not. */
  detail: string;
  /** The government page that settles it, or null. */
  sourceUrl: string | null;
  /** What tapping sourceUrl opens: 'WAC 51-50-1011'. */
  sourceLabel: string | null;
  /** Government amendment text to quote, or null. NEVER model-code text. */
  quote: string | null;
  /** False when `quote` is an opening excerpt rather than the whole amendment. */
  quoteComplete: boolean;
  /** True when the row matched the PARENT of the cited section, not the section. */
  parentMatch: boolean;
  /** ICC free-viewer link for the governing volume. Volume level only. */
  viewerUrl: string | null;
  viewerLabel: string | null;
}

// ─────────────────────────────────────────────────────────────────────
// The table
// ─────────────────────────────────────────────────────────────────────

/**
 * Rows read by a HUMAN, held to codeJurisdiction.ts's discipline: each was
 * read off the document named in `sourceUrl` in a working session, and the
 * quote below was extracted from that document, not typed from memory.
 *
 * These are now the ONLY amendment rows MAGE holds. The generated table that
 * used to sit in front of them is gone.
 *
 * PROVENANCE. On 2026-09-13, https://dos.ny.gov/19-nycrr-part-1220 was
 * fetched with `curl -L` and a Safari User-Agent (HTTP 200, application/pdf,
 * 145,706 bytes — dos.ny.gov 403s this repo's own fetcher; see the "SOURCES
 * THIS ENVIRONMENT CANNOT OPEN" block in utils/codeJurisdiction.ts) and read
 * through `pdftotext -layout`.
 *
 * WHY NEW YORK IS THIS THIN, AND WHY THAT IS THE HONEST ANSWER. New York
 * publishes almost no code text of its own. 19 NYCRR § 1220.2(b) says so in
 * as many words: "The 2025 RCNYS is incorporated herein by reference. Copies
 * of the 2025 RCNYS may be obtained from the publisher… International Code
 * Council, Inc." The state points at ICC and at a filing cabinet in Albany.
 * Two rows is what the state actually gives you, and padding it would be the
 * one thing this whole module exists to prevent.
 *
 * TWO THINGS IN THAT DOCUMENT THAT ARE DELIBERATELY NOT ROWS:
 *   § 1220.2(a)(5) names "Section 508.5 of the 2025 BCNYS". Real, and a
 *     perfectly good rung 2 — except utils/codeJurisdiction.ts's New York row
 *     does not claim the 2025 BCNYS among its adopted codes, only the Uniform
 *     Code umbrella, the ECCCNYS and the RCNYS. A row here that fires against
 *     a code the jurisdiction table never verified as adopted would be making
 *     an adoption claim through the side door. Add the BCNYS to that table
 *     first, off a page that names it, and this row becomes free.
 *   § 1220.2(e)(4) is SELF-CONTRADICTING and is treated the way the Austin
 *     fire code is: it announces "the second definition entitled 'Home
 *     Occupation' is amended to read as follows" and then prints a definition
 *     of LOAD-BEARING ELEMENT. A document that disagrees with itself is not a
 *     source. Confirm with the Division of Building Standards and Codes.
 */
export const HAND_VERIFIED_AMENDMENTS: readonly StateAmendment[] = [
  {
    state: 'NY',
    family: 'LOCAL',
    edition: '2025',
    codeName: '2025 Residential Code of New York State',
    // "RCNYS" is the state's OWN abbreviation, defined in 19 NYCRR § 1220.1
    // ("the terms 2025 BCNYS, 2025 RCNYS … shall have the meanings ascribed to
    // those terms in section 1219.2") and printed in ICC's volume title,
    // "2025 Residential Code of New York State (2025 RCNYS)". Not invented.
    codeAliases: ['RCNYS'],
    section: 'P2904',
    caption:
      'Residential fire sprinkler system — named in § 1220.2(a)(6) as the standard an owner-occupied lodging house of five or fewer guestrooms must comply with.',
    cite: '19 NYCRR § 1220.2(a)(6)',
    authorityName:
      'New York State Department of State, Division of Building Standards and Codes',
    sourceUrl: 'https://dos.ny.gov/19-nycrr-part-1220',
    checkedOn: '2026-09-13',
    // Rung 2 on purpose: the regulation NAMES this section, it does not
    // reproduce it. The requirement itself lives in the RCNYS, which MAGE may
    // not hold. Naming it is the whole claim.
    amendmentText: '',
    textComplete: true,
    readBy: 'human pass 2026-09-13 — curl + pdftotext -layout of 19 NYCRR Part 1220',
  },
  {
    state: 'NY',
    family: 'LOCAL',
    edition: '2025',
    codeName: '2025 Residential Code of New York State',
    codeAliases: ['RCNYS'],
    // The regulation prints the section number twice and not identically —
    // "Section BA 113.3" in the introducing clause and "BA113.3" in the
    // amended text. The amended text is the operative one, so that is the
    // spelling recorded, exactly as it appears there.
    section: 'BA113.3',
    caption: 'Relocated Manufactured Homes (Appendix BA), as amended for New York.',
    cite: '19 NYCRR § 1220.2(e)(3)',
    authorityName:
      'New York State Department of State, Division of Building Standards and Codes',
    sourceUrl: 'https://dos.ny.gov/19-nycrr-part-1220',
    checkedOn: '2026-09-13',
    amendmentText:
      '[NY] BA113.3 Relocated Manufactured Homes. Relocated manufactured homes shall be installed on a foundation system constructed in accordance with this appendix and the installation instructions. Where the installation instructions are not available, foundation and anchorage systems that are constructed in accordance with the provisions of 24 CFR 3285 “Model Manufactured Home Installation Standards” or the provisions of NFPA 225 shall be deemed to meet the requirements of this code.',
    textComplete: true,
    readBy: 'human pass 2026-09-13 — curl + pdftotext -layout of 19 NYCRR Part 1220',
  },
];

/**
 * Every amendment MAGE holds.
 *
 * This used to concatenate a generated table in front of the hand-read rows.
 * The generated table was withdrawn (see StateAmendment above); the hand-read
 * rows are the whole of it, and the alias is kept because the module, the
 * validator and the network verifier all read the table through this name.
 */
export const ALL_AMENDMENTS: readonly StateAmendment[] = HAND_VERIFIED_AMENDMENTS;

// ─────────────────────────────────────────────────────────────────────
// ICC's free viewer — a LINK, never a fetch, never a section
// ─────────────────────────────────────────────────────────────────────

/**
 * The ICC free-viewer link builder lives in utils/codeJurisdiction.ts, not
 * here, because that module is deliberately import-free and `groundingFactsFor`
 * — the ONE renderer for the chip and the prompt — has to be able to produce
 * the links itself. Re-exported so a screen has a single import for the whole
 * ladder. Read the guard's comment there before touching it.
 */
export { iccViewerUrl, viewerLinksFor };

// ─────────────────────────────────────────────────────────────────────
// Reading what the model cited
// ─────────────────────────────────────────────────────────────────────

/**
 * The family a model's `code` string names — "IRC 2021", "2021 International
 * Residential Code", "NFPA 70" — or null when it names none unambiguously.
 *
 * Order matters: IFGC is tested before IFC so "IFGC" is not read as fire code
 * plus a stray G. Nothing here is a factual claim about a jurisdiction; it is
 * a parse of the model's own output, and a parse that gives up is safe,
 * because giving up drops the citation to rung 3 rather than attaching the
 * wrong state's amendment to it.
 */
export function familyFromCitedCode(code: string): CodeFamily | null {
  const t = ` ${(code ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ')} `;
  const pairs: [CodeFamily, RegExp[]][] = [
    ['IFGC', [/ IFGC /, / INTERNATIONAL FUEL GAS CODE /]],
    ['IEBC', [/ IEBC /, / INTERNATIONAL EXISTING BUILDING CODE /]],
    ['IECC', [/ IECC /, / INTERNATIONAL ENERGY CONSERVATION CODE /]],
    ['IBC', [/ IBC /, / INTERNATIONAL BUILDING CODE /]],
    ['IRC', [/ IRC /, / INTERNATIONAL RESIDENTIAL CODE /]],
    ['IPC', [/ IPC /, / INTERNATIONAL PLUMBING CODE /]],
    ['IMC', [/ IMC /, / INTERNATIONAL MECHANICAL CODE /]],
    ['IFC', [/ IFC /, / INTERNATIONAL FIRE CODE /]],
    ['NEC', [/ NEC /, / NATIONAL ELECTRIC(?:AL)? CODE /, / NFPA 70 /]],
  ];
  const hits = pairs.filter(([, res]) => res.some((re) => re.test(t))).map(([f]) => f);
  return hits.length === 1 ? hits[0] : null;
}

/** The 4-digit year a model's `code` string carries, or null. */
export function yearFromCitedCode(code: string): string | null {
  const m = (code ?? '').match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : null;
}

/** Upper-case, whitespace-free, no trailing dot — for comparing two numbers. */
export function normalizeSection(section: string): string {
  return (section ?? '').toUpperCase().replace(/\s+/g, '').replace(/\.+$/, '');
}

const yearOf = (edition: string) => edition.match(/\b(19|20)\d{2}\b/)?.[0] ?? null;

/**
 * The ONE volume a given citation should open — the book that citation is
 * actually about — or null.
 *
 * WHY THIS IS NOT `viewerLinks[0]`, AND WHY IT IS NOT "THE FIRST THAT MATCHES"
 * EITHER. It was `viewerLinks[0]` in the first draft, and running the ladder
 * over real citations showed what that does: an IRC R310 citation in
 * Washington offered "2021 International Building Code". The fix — return the
 * first link whose title contains every substantial word of the citation —
 * was measurably no better, because the words a generic citation carries are
 * the words every volume on the row shares. Executed 2026-09-13:
 * viewerLinkForCitation(Ithaca NY, 'Code of New York State') returned the
 * ENERGY code, because CODE / YORK / STATE is the tail of every New York
 * volume's title and ECCCNYS happens to precede RCNYS in the table. The book
 * a residential job opened was decided by row order.
 *
 * THE RULE NOW: match on what the citation NAMES, and refuse ambiguity.
 *   • A citation that names a model family ("IBC 2021") may only open that
 *     family's volume.
 *   • A citation that names a locally-titled volume may open it when the
 *     citation carries ICC's own printed abbreviation for it — "(2025 RCNYS)"
 *     — or the volume's full local name.
 *   • Failing both, every substantial word of the citation must appear in the
 *     volume's title.
 *   • And whatever the route, EXACTLY ONE volume must qualify. That last
 *     clause is what actually fixes the New York case: CODE / YORK / STATE is
 *     in both titles, so BOTH qualify, so neither is returned. Two qualifying
 *     volumes is not a tie to be broken by array order; it is MAGE not
 *     knowing, and the honest output of not knowing is no link.
 *
 * A DISCARDED THIRD RULE, RECORDED SO IT IS NOT REINVENTED: an earlier draft
 * also required a matched word to DISCRIMINATE — to be absent from every other
 * candidate's title. It is unreachable behind the count rule with fewer than
 * three named volumes on a row (nothing in the table has three), and the only
 * cases where it would bite are ones where it gives the WRONG answer: with
 * titles {w1,w2}, {w1}, {w2} and a citation naming w1 and w2, it rejects the
 * one volume that carries both. A rule that cannot be turned red and is not
 * obviously right is not a guard, so it is gone.
 *
 * A link to the wrong book is worse than no link, because he will read it and
 * believe it. The jurisdiction chip separately offers EVERY volume the address
 * governs, which is the honest place for a general "open the governing code".
 */
export function viewerLinkForCitation(
  resolved: ResolvedCodeJurisdiction,
  citedCode: string,
): { label: string; url: string } | null {
  if (resolved.kind === 'unknown') return null;
  const family = familyFromCitedCode(citedCode);
  const year = yearFromCitedCode(citedCode);
  const upper = (citedCode ?? '').toUpperCase();

  // A year the model states and the volume contradicts is a different edition,
  // and a different edition is a different book. Drop those first so they
  // cannot count towards ambiguity either.
  const candidates = viewerLinksFor(resolved).filter((l) => {
    const y = yearOf(l.code.edition);
    return !(year && y && year !== y);
  });

  const titleOf = (l: (typeof candidates)[number]) => (l.code.iccVolumeTitle ?? '').toUpperCase();
  const words = upper.split(/[^A-Z]+/).filter((w) => w.length >= 4);

  const matches = candidates.filter((link) => {
    const c = link.code;
    // The citation names a model family: only that family's volume, ever.
    if (family) return c.family === family;
    if (!(c.family === 'LOCAL' || c.name)) return false;

    const title = titleOf(link);
    // ICC prints the authority's own abbreviation in the volume title's
    // parenthetical — "(2025 RCNYS)", "(2025 ECCCNYS)". That is the token a
    // model actually cites, and it is ICC's word, not one invented here.
    const abbrevs = [...title.matchAll(/\(([^)]*)\)/g)]
      .flatMap((m) => m[1].split(/[^A-Z0-9]+/))
      .filter((t) => /^[A-Z]{4,}$/.test(t));
    if (abbrevs.some((t) => upper.includes(t))) return true;
    if (c.name && upper.includes(c.name.toUpperCase())) return true;

    // The word fallback. It only ever decides anything when it picks out ONE
    // volume — see the return below, which is the whole of the rule.
    if (words.length === 0) return false;
    return words.every((w) => title.includes(w));
  });

  return matches.length === 1 ? { label: matches[0].label, url: matches[0].url } : null;
}

/**
 * Does the jurisdiction actually adopt the code this amendment amends?
 *
 * THE `!c.name` ON THE SECOND LINE IS LOAD-BEARING. An AdoptedCode WITH a
 * `name` is claiming a locally-titled volume — Seattle's row is
 * `{ family: 'IBC', edition: '2021', name: '2021 Seattle Building Code' }` —
 * and a state amendment to the bare IBC is not automatically the law of that
 * volume. Matching on family+edition alone fired Washington's WAC 51-50-1011
 * for a Seattle address, under a green STATE AMENDMENT badge, while the
 * jurisdiction chip on the same screen named the Seattle Building Code and
 * Seattle's own amendment to that section was neither held nor mentioned
 * (executed 2026-09-13). This is the same rule `iccVolumeId` already applies
 * to LINKS in utils/codeJurisdiction.ts — a locally-titled code is not the
 * model volume. The module must not link conservatively and quote
 * permissively. A row that genuinely governs a locally-named volume says so
 * by carrying `codeName`, off a page that says it.
 */
function jurisdictionAdopts(codes: readonly AdoptedCode[], a: StateAmendment): boolean {
  if (a.codeName) return codes.some((c) => c.name === a.codeName);
  return codes.some((c) => !c.name && c.family === a.family && c.edition === a.edition);
}

/** Does the model's citation name the code this amendment amends? */
function citationNames(citedCode: string, a: StateAmendment): boolean {
  const year = yearFromCitedCode(citedCode);
  // A year the model states and the register contradicts is a different
  // edition, and a different edition's amendments are the wrong law.
  if (year && yearOf(a.edition) && year !== yearOf(a.edition)) return false;

  if (a.codeName) {
    const t = (citedCode ?? '').toUpperCase();
    if (t.includes(a.codeName.toUpperCase())) return true;
    return (a.codeAliases ?? []).some((alias) => t.includes(alias.toUpperCase()));
  }
  return familyFromCitedCode(citedCode) === a.family;
}

// ─────────────────────────────────────────────────────────────────────
// The one renderer for a citation's evidence
// ─────────────────────────────────────────────────────────────────────

const RECALL_TAIL = 'The section number is the model’s own recall.';

/**
 * Which rung ONE citation stands on, and the exact words that say so.
 *
 * Like groundingFactsFor, this is the ONLY place the wording lives, so the
 * badge, the sentence under it and the quote cannot drift apart.
 *
 * It never contradicts the model and never confirms it beyond the evidence:
 * an absent amendment means "MAGE has no record", not "no such section".
 */
export function citationEvidenceFor(
  resolved: ResolvedCodeJurisdiction,
  citedCode: string,
  citedSection: string,
): CitationEvidence {
  const viewer = viewerLinkForCitation(resolved, citedCode);
  const base = {
    viewerUrl: viewer?.url ?? null,
    viewerLabel: viewer?.label ?? null,
    quote: null as string | null,
    quoteComplete: true,
    parentMatch: false,
    sourceUrl: null as string | null,
    sourceLabel: null as string | null,
  };

  if (resolved.kind === 'unknown') {
    return {
      ...base,
      rung: 'unresolved',
      rungIndex: RUNG_INDEX.unresolved,
      badge: 'MODEL RECALL · NO JURISDICTION',
      detail: `${resolved.reason} ${RECALL_TAIL}`,
    };
  }

  const entry = resolved.entry;
  const section = normalizeSection(citedSection);

  const match = section ? bestAmendmentFor(resolved, citedCode, section) : null;

  if (match) {
    const { row, parent } = match;
    const what = row.codeName ?? `${row.family} ${row.edition}`;
    if (row.amendmentText) {
      return {
        ...base,
        rung: 'amended',
        rungIndex: RUNG_INDEX.amended,
        badge: parent ? 'PARENT SECTION AMENDED' : 'STATE AMENDMENT',
        detail: parent
          ? `${row.cite} amends ${what} § ${row.section}, the parent of the number cited. Read off ${row.authorityName} on ${row.checkedOn}. MAGE did NOT verify § ${citedSection.trim()} itself — that number is still model recall.`
          // THE LAST CLAUSE IS NOT PADDING. A green badge sits directly under
          // the model's own requirement prose, and a reader takes the badge to
          // be vouching for the whole row. It is not: MAGE read a register
          // entry, and the requirement summarised above it is still recall.
          // The parent variant already disclaimed the cited section; the exact
          // variant disclaimed nothing at all.
          : `${row.cite} amends ${what} § ${row.section}. Read off ${row.authorityName} on ${row.checkedOn}. The text below is the state’s own, not the model code’s — the requirement summarised above it is still the model’s recall.`,
        sourceUrl: row.sourceUrl,
        sourceLabel: row.cite,
        quote: row.amendmentText,
        quoteComplete: row.textComplete,
        parentMatch: parent,
      };
    }
    return {
      ...base,
      rung: 'named',
      rungIndex: RUNG_INDEX.named,
      badge: parent ? 'PARENT SECTION NAMED IN LAW' : 'SECTION NAMED IN LAW',
      detail: parent
        ? `${row.cite} names ${what} § ${row.section}, the parent of the number cited. Read off ${row.authorityName} on ${row.checkedOn}. MAGE holds no text for it and did NOT verify § ${citedSection.trim()} itself.`
        : `${row.cite} names ${what} § ${row.section}. Read off ${row.authorityName} on ${row.checkedOn}. The section number is verified; MAGE does not reproduce what it requires.`,
      sourceUrl: row.sourceUrl,
      sourceLabel: row.cite,
      parentMatch: parent,
    };
  }

  return {
    ...base,
    rung: 'edition',
    rungIndex: RUNG_INDEX.edition,
    badge: 'MODEL RECALL · EDITION KNOWN',
    detail:
      `MAGE verified the governing code here — ${codesSummary(entry.codes)}, ` +
      `checked ${entry.checkedOn} — but has no government record naming this section. ${RECALL_TAIL}`,
  };
}

/**
 * The strongest amendment row that applies, or null.
 *
 * Exact beats parent, and quoted beats named, so a contractor is shown the
 * most evidence MAGE holds rather than the first row that happened to match.
 */
export function bestAmendmentFor(
  resolved: ResolvedCodeJurisdiction,
  citedCode: string,
  normalizedSection: string,
): { row: StateAmendment; parent: boolean } | null {
  if (resolved.kind === 'unknown' || !normalizedSection) return null;
  const codes = resolved.entry.codes;

  let best: { row: StateAmendment; parent: boolean; score: number } | null = null;
  for (const row of ALL_AMENDMENTS) {
    if (row.state !== resolved.state) continue;
    if (!jurisdictionAdopts(codes, row)) continue;
    if (!citationNames(citedCode, row)) continue;

    const target = normalizeSection(row.section);
    let parent: boolean;
    if (target === normalizedSection) parent = false;
    else if (normalizedSection.startsWith(`${target}.`)) parent = true;
    else continue;

    // exact+text 3 > exact 2 > parent+text 1 > parent 0
    const score = (parent ? 0 : 2) + (row.amendmentText ? 1 : 0);
    if (!best || score > best.score) best = { row, parent, score };
  }
  return best ? { row: best.row, parent: best.parent } : null;
}

/**
 * The rung an ENTIRE result is standing on: the weakest of its citations,
 * because a contractor is only as safe as the least-verified line on the page.
 * Used for the one-line summary above the code list; the per-citation badges
 * carry the detail.
 */
export function weakestRung(evidence: readonly CitationEvidence[]): CitationRung {
  if (evidence.length === 0) return 'edition';
  return evidence.reduce<CitationEvidence>((w, e) => (e.rungIndex > w.rungIndex ? e : w), evidence[0]).rung;
}

/** How many citations landed on each rung. For the summary line and tests. */
export function rungTally(evidence: readonly CitationEvidence[]): Record<CitationRung, number> {
  const t: Record<CitationRung, number> = { amended: 0, named: 0, edition: 0, unresolved: 0 };
  for (const e of evidence) t[e.rung] += 1;
  return t;
}

/**
 * The line that goes ABOVE the code list, next to (never instead of) the
 * model-recall chip. It states how many citations MAGE could back with a
 * government document and how many it could not.
 *
 * A PARENT MATCH IS NOT BACKING, AND THIS LINE USED TO SAY IT WAS. `backed`
 * was `t.amended + t.named`, and both of those rungs include the parent-only
 * variant — the variant whose own detail sentence reads "MAGE did NOT verify
 * § 1201.2 itself". Three Spokane citations, two of them parent-only, printed
 * "2 of 3 are backed by a government document MAGE has read" (executed
 * 2026-09-13). This is the one line a contractor reads before scanning, and it
 * was converting an explicit non-verification into a claim of verification.
 * Parents now get their own clause, in their own words.
 */
export function rungSummaryLine(evidence: readonly CitationEvidence[]): string {
  const total = evidence.length;
  if (total === 0) return '';
  const isBacked = (e: CitationEvidence) => e.rung === 'amended' || e.rung === 'named';
  const exact = evidence.filter((e) => isBacked(e) && !e.parentMatch).length;
  const parent = evidence.filter((e) => isBacked(e) && e.parentMatch).length;
  const recall = total - exact - parent;

  if (exact === 0 && parent === 0) {
    return total === 1
      ? 'This citation is not backed by any government document MAGE has read.'
      : `None of these ${total} citations is backed by a government document MAGE has read.`;
  }

  const clauses: string[] = [];
  if (exact > 0) {
    clauses.push(
      `${exact} of ${total} ${exact === 1 ? 'is' : 'are'} backed by a government document MAGE has read`,
    );
  }
  if (parent > 0) {
    clauses.push(
      `${parent} ${parent === 1 ? 'has an amended PARENT section' : 'have an amended PARENT section'} but the cited number itself is unverified`,
    );
  }
  if (recall > 0) clauses.push(`${recall} ${recall === 1 ? 'is' : 'are'} model recall`);
  return `${clauses.join('; ')}.`;
}

/** Re-exported so the screen has ONE import for the whole ladder. */
export { groundingFactsFor };
