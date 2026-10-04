// utils/codeCard/jurisdiction.ts — the "code in force" + "permit office" facts
// a code-card answer states ONCE (JurisdictionBlock), each with its own source
// and its own check date.
//
// Pure: imports only the pure jurisdiction tables. Nothing here is recalled:
// the edition comes from utils/codeJurisdiction.ts (hand-verified rows), the
// office from utils/permitOffices.ts permitOfficeFor(). When either is
// missing the field is null and the block says so; it never fills a gap.

import { codesSummary, codeLine, departmentFor, viewerLinksFor, type ResolvedCodeJurisdiction } from '../codeJurisdiction';
import { viewerLinkForCitation, type CitationEvidence } from '../codeAmendments';
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

// ── Which edition a card may print, and how ──────────────────────────────
//
// THE RULE, in two halves:
//   1. A government source line only ever sits under `info.editionLabel`, the
//      jurisdiction's own verified edition. Nothing the AI cited is ever
//      printed over it.
//   2. An edition printed WITHOUT a recall mark is always, word for word, a
//      name MAGE itself holds for a volume adopted at this address. That is
//      one of two things:
//        'same'     a name of the answer's verified edition (`info`), or
//        'adopted'  a name of the ONE adopted volume MAGE's own lookup
//                   resolved THIS card's citation to (`evidence.viewerLabel`,
//                   stamped by citationEvidenceFor; never taken off the wire).
//      Anything else the AI cited is 'recall': "(as cited)" on the card's meta
//      line and the list row, "The AI cited: … (model recall)" on the opened
//      card. It is never guessed to be close enough: against a verified 2025
//      RCNYS, '2020 RCNYS', 'IRC 2021', 'IRC' and a bare 'RCNYS' are all recall.
//
// On the opened card the cited edition gets its own line, with no source under
// it, whenever it is not the edition printed above it ('adopted' or 'recall').

export const AS_CITED_MARK = '(as cited)';

/** "The AI cited: 2020 RCNYS (model recall)": an edition MAGE holds no record of here. */
export function citedEditionLine(cited: string): string {
  return `The AI cited: ${cited.trim()} (model recall)`;
}

/** "Cited on this card: 2025 ECCCNYS": an adopted volume that is not the edition printed above it. */
export function adoptedEditionLine(cited: string): string {
  return `Cited on this card: ${cited.trim()}`;
}

function editionTokens(text: string | null | undefined): string {
  const tokens = (text ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return [...new Set(tokens)].sort().join(' ');
}

/** A volume's own names: its title, and the short name in the title's closing parenthetical ("2025 RCNYS"). */
function volumeNames(title: string | null | undefined): string[] {
  const t = (title ?? '').trim();
  if (!t) return [];
  const paren = /\(([^)]+)\)\s*$/.exec(t);
  return paren ? [t, paren[1]] : [t];
}

function namesOne(cited: string | null | undefined, names: readonly (string | null | undefined)[]): boolean {
  const own = editionTokens(cited);
  return !!own && names.some((name) => !!name && editionTokens(name) === own);
}

/**
 * Is the cited edition the answer's verified one? True ONLY when its words are
 * exactly the words of one of that edition's own names: `info.editionLabel`,
 * ICC's volume title (`info.viewerLabel`) or the short name in that title's
 * parenthetical. Case, punctuation and word order are ignored; nothing else
 * is. No verified edition = never.
 */
export function isVerifiedEdition(cited: string | null | undefined, info: CodeJurisdictionInfo | null | undefined): boolean {
  if (!info?.editionLabel) return false;
  return namesOne(cited, [info.editionLabel, ...volumeNames(info.viewerLabel)]);
}

/**
 * Is the cited edition, word for word, the adopted volume MAGE's own lookup
 * resolved this card's citation to? (`evidence.viewerLabel` is ICC's title of
 * that ONE volume; it is null when the lookup found none, or more than one.)
 */
export function isAdoptedVolume(cited: string | null | undefined, evidence: Pick<CitationEvidence, 'viewerLabel'> | null | undefined): boolean {
  return namesOne(cited, volumeNames(evidence?.viewerLabel));
}

export type CitedEditionKind = 'same' | 'adopted' | 'recall';

export interface EditionView {
  /** The jurisdiction's verified edition (the ONLY text a source line may sit under), or null. */
  verified: string | null;
  /** What the AI cited, trimmed; null when it cited none. */
  cited: string | null;
  /** How the cited edition stands (see THE RULE); null when none was cited. */
  kind: CitedEditionKind | null;
  /** The card's meta line / the list row: an edition MAGE holds, bare, or the cited one with its mark. Null = not confirmed. */
  meta: string | null;
  /** The opened card's own line for the cited edition; null when it IS the verified edition printed above it, or none was cited. */
  citedLine: string | null;
}

type EditionInput = Pick<CodeCardItem, 'citedEdition'> & { evidence?: Pick<CitationEvidence, 'viewerLabel'> | null };

/** What a card may print about its edition (see THE RULE above). */
export function editionViewFor(item: EditionInput, info: CodeJurisdictionInfo | null | undefined): EditionView {
  const cited = (item.citedEdition ?? '').trim();
  const verified = info?.editionLabel ?? null;
  if (!cited) return { verified, cited: null, kind: null, meta: verified, citedLine: null };
  if (isVerifiedEdition(cited, info)) return { verified, cited, kind: 'same', meta: cited, citedLine: null };
  if (isAdoptedVolume(cited, item.evidence)) return { verified, cited, kind: 'adopted', meta: cited, citedLine: adoptedEditionLine(cited) };
  return { verified, cited, kind: 'recall', meta: `${cited} ${AS_CITED_MARK}`, citedLine: citedEditionLine(cited) };
}

/**
 * The edition text a card's meta line shows (editionViewFor().meta): the cited
 * edition, bare, when it is a name MAGE holds for a volume adopted here; the
 * cited edition marked "(as cited)" when it is not; the jurisdiction's edition
 * when none was cited; else null (the card then says the edition is not
 * confirmed rather than guessing).
 */
export function editionForItem(item: EditionInput, info: CodeJurisdictionInfo | null | undefined): string | null {
  return editionViewFor(item, info).meta;
}
