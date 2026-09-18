// utils/plans/specBookRange.ts — pure. How much of a spec book one AI pass
// actually read, and how to say it.
//
// Audit round 2 (#22): extract-submittals renders 24 pages, analyze-spec-book
// reads 24, and the review hero said "{n} submittals found" with nothing about
// pages. On a 212-page book that is a submittal log built from the front matter
// and Division 01 — no hardware, no ceiling tile, no RTU — presented as the
// log. The only mention of the limit was a bullet the user saw before upload.

/** Pages one pass renders + ships to the model (extract-submittals maxPages,
 *  analyze-spec-book selectPageSource). Changing it means changing both. */
export const SPEC_PAGES_PER_PASS = 24;

export interface SpecCoverage {
  /** "Read pages 1–24 of 212" — always states both ends. */
  label: string;
  /** True when the pass covered the whole document. */
  complete: boolean;
  /** First page NOT read, when the pass stopped short. */
  nextPage: number | null;
  /** How many pages were left unread. */
  unread: number;
}

/**
 * @param pdfPageCount pages in the uploaded PDF (null when it could not be counted)
 * @param startPage    1-indexed first page of this pass
 * @param readCount    pages this pass actually rendered
 */
export function specCoverage(pdfPageCount: number | null, startPage: number, readCount: number): SpecCoverage {
  const from = Math.max(1, Math.floor(startPage));
  const read = Math.max(0, Math.floor(readCount));
  const to = from + read - 1;
  if (read === 0) {
    return { label: 'No pages were read', complete: false, nextPage: from, unread: pdfPageCount ? Math.max(0, pdfPageCount - from + 1) : 0 };
  }
  const range = read === 1 ? `page ${from}` : `pages ${from}–${to}`;
  // No page count — pdf-lib could not parse the file locally (countPdfPages
  // returns null on any load failure). "of N" is the honest part, so without N
  // the sentence stops at the range.
  //
  // But a SHORT render is itself proof of full coverage, and claiming unread
  // pages here would be the very thing #22 was about, inverted: the server
  // renders min(pdfPageCount - startPage + 1, SPEC_PAGES_PER_PASS), so getting
  // fewer pages back than the cap means the document ran out. A 10-page spec
  // section whose local count failed used to be labelled "The rest of the book
  // from page 11 on were not read", which is a guess stated as fact about a
  // book that was read end to end.
  if (!pdfPageCount || pdfPageCount <= 0) {
    // The label still says only what was read: with no N, "all" would be a
    // claim about a total this pass never learned.
    if (read < SPEC_PAGES_PER_PASS) return { label: `Read ${range}`, complete: true, nextPage: null, unread: 0 };
    return { label: `Read ${range}`, complete: false, nextPage: to + 1, unread: 0 };
  }
  const complete = to >= pdfPageCount;
  return {
    label: `Read ${range} of ${pdfPageCount}`,
    complete,
    nextPage: complete ? null : to + 1,
    unread: complete ? 0 : pdfPageCount - to,
  };
}

/** The warning under an incomplete read. Names what is missing in the terms a
 *  PM cares about: whole divisions, i.e. whole trades. */
export function specUnreadWarning(c: SpecCoverage): string | null {
  if (c.complete || c.nextPage === null) return null;
  const tail = c.unread > 0 ? `${c.unread} page${c.unread === 1 ? '' : 's'}` : 'The rest of the book';
  return `${tail} from page ${c.nextPage} on were not read — any submittal in those divisions is missing from this list.`;
}
