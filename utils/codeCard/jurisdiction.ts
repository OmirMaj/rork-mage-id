// utils/codeCard/jurisdiction.ts — the "code in force" + "permit office" facts
// a code-card answer states ONCE (JurisdictionBlock), each with its own source
// and its own check date.
//
// Pure: imports only the pure jurisdiction tables. Nothing here is recalled:
// the edition comes from utils/codeJurisdiction.ts (hand-verified rows), the
// office from utils/permitOffices.ts permitOfficeFor(). When either is
// missing the field is null and the block says so; it never fills a gap.

import { codesSummary, codeLine, departmentFor, viewerLinksFor, type ResolvedCodeJurisdiction } from '../codeJurisdiction';
import { viewerLinkForCitation } from '../codeAmendments';
import type { PermitOfficeAnswer } from '../permitOffices';
import type { CodeCardItem, CodeJurisdictionInfo } from './types';

export const EMPTY_JURISDICTION_INFO: CodeJurisdictionInfo = Object.freeze({
  editionLabel: null,
  editionSourceUrl: null,
  editionCheckedOn: null,
  permitOfficeTitle: null,
  permitOfficeSourceUrl: null,
  permitOfficeCheckedOn: null,
  viewerUrl: null,
  viewerLabel: null,
});

/** The first YYYY-MM-DD in a source label ("hempsteadny.gov, checked 2026-09-26"). */
export function isoDateIn(label: string | null | undefined): string | null {
  const m = /\b(\d{4}-\d{2}-\d{2})\b/.exec(label ?? '');
  return m ? m[1] : null;
}

/**
 * Build the block's facts.
 *
 * `citedCode` (the edition the answer cites, e.g. '2025 RCNYS') picks the ONE
 * governing volume it names, the same rule as viewerLinkForCitation. With no
 * citation, or one that names no single volume, the edition line is every
 * adopted code and the viewer link is the address's only volume, if it has
 * exactly one. A link to the wrong book is worse than no link.
 */
export function codeJurisdictionInfoFor(
  resolved: ResolvedCodeJurisdiction | null | undefined,
  permit: PermitOfficeAnswer | null | undefined,
  citedCode?: string | null,
): CodeJurisdictionInfo {
  const out: CodeJurisdictionInfo = { ...EMPTY_JURISDICTION_INFO };

  if (resolved && resolved.kind !== 'unknown') {
    const entry = resolved.entry;
    const links = viewerLinksFor(resolved);
    const cited = citedCode ? viewerLinkForCitation(resolved, citedCode) : null;
    const link = cited ?? (links.length === 1 ? { label: links[0].label, url: links[0].url } : null);
    const linkCode = link ? links.find((l) => l.url === link.url)?.code ?? null : null;
    out.editionLabel = linkCode ? linkCode.name ?? codeLine(linkCode) : codesSummary(entry.codes) || null;
    out.editionSourceUrl = linkCode?.sourceUrl ?? entry.sourceUrl;
    out.editionCheckedOn = entry.checkedOn;
    out.viewerUrl = link?.url ?? null;
    out.viewerLabel = link?.label ?? null;
  }

  if (permit) {
    if (permit.kind === 'office' && permit.office) {
      const o = permit.office;
      out.permitOfficeTitle = o.title;
      // A name-only office carries no source; the block says its contact
      // details are not verified rather than borrowing anyone else's.
      out.permitOfficeSourceUrl = o.verification === 'name-only' ? null : o.sourceUrl;
      out.permitOfficeCheckedOn = o.verification === 'name-only' ? null : isoDateIn(o.sourceLabel);
    } else if (permit.kind === 'nyc' && resolved && resolved.kind !== 'unknown') {
      const dept = departmentFor(resolved);
      out.permitOfficeTitle = resolved.entry.authorityName;
      out.permitOfficeSourceUrl = dept?.sourceUrl ?? resolved.entry.sourceUrl;
      out.permitOfficeCheckedOn = dept?.checkedOn ?? resolved.entry.checkedOn;
    }
  }

  return out;
}

/** "dos.ny.gov" from a source URL, for the small source line. */
export function sourceHost(url: string | null | undefined): string | null {
  const m = /^https?:\/\/([^/?#]+)/i.exec((url ?? '').trim());
  if (!m) return null;
  return m[1].replace(/^www\./i, '').toLowerCase();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09-12" → "Sep 12, 2026". Anything else comes back unchanged. */
export function formatCheckedOn(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return iso;
  return `${month} ${Number(m[3])}, ${m[1]}`;
}

/** "dos.ny.gov · checked Sep 12, 2026"; null when there is no source at all. */
export function sourceLine(url: string | null | undefined, checkedOn: string | null | undefined): string | null {
  const host = sourceHost(url);
  const date = formatCheckedOn(checkedOn);
  if (!host && !date) return null;
  if (host && date) return `${host} · checked ${date}`;
  return host ?? `Checked ${date}`;
}

/**
 * The edition text a card's meta line shows: the item's own `citedEdition`
 * when it has one, else the jurisdiction's edition, else null (the card then
 * says the edition is not confirmed rather than guessing).
 */
export function editionForItem(item: Pick<CodeCardItem, 'citedEdition'>, info: CodeJurisdictionInfo | null | undefined): string | null {
  const own = (item.citedEdition ?? '').trim();
  if (own) return own;
  return info?.editionLabel ?? null;
}
