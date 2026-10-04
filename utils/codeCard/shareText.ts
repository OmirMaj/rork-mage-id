// utils/codeCard/shareText.ts — the text a contractor sends a sub or an
// architect from a code card, and the links that open HIS OWN Messages / Mail.
//
// Pure: no React, no RN. scripts/validate-code-cards.ts drives it under bun.
//
// THE RULES THIS TEXT KEEPS
//   * No code wording. The requirement line is the card's `summary`, which is
//     MAGE's own words and passed summaryEchoCheck; nothing else quotes.
//   * A recalled section says so in the text itself ("section from AI recall,
//     confirm"), so the honesty label travels with the message. A record that
//     only names the PARENT section is recall too (sectionIsBacked).
//   * THE TRIGGER NUMBER IS ALWAYS AI RECALL, on every rung. It comes from the
//     model's structured output and from nowhere else: a "named" record
//     verifies the section NUMBER, and MAGE holds no record that supplies the
//     30 in. So "Applies above 30 in." always carries "(AI recall, confirm)",
//     and no surface credits that number to a government source.
//   * It always ends by naming who has the final word ("Confirm with …").
//   * A sample says "(Sample)" as its last word.
//   * MAGE sends nothing: these functions build text and sms:/mailto: links;
//     the user's own app does the sending.

import type { CitationEvidence } from '../codeAmendments';
import type { CodeCardItem, CodeJobValue, CodeJurisdictionInfo, CodeTrigger } from './types';
import { sectionIsBacked } from './evidence';
import { AS_CITED_MARK, editionViewFor } from './jurisdiction';
import { canRecheck, formatJobNumber, recheckEquation } from './verdict';

export interface ShareTextOptions {
  /** "Reyes deck, Massapequa". */
  jobLabel?: string | null;
  /** The re-measured number, when he changed it on the opened card. */
  jobValue?: CodeJobValue | null;
  info?: CodeJurisdictionInfo | null;
  sample?: boolean;
}

/**
 * True only when a government document stands behind the cited section itself
 * (rung amended / named, and NOT a parent-only match). The one rule lives in
 * ./evidence.ts `sectionIsBacked`; this is its name on the share-text side.
 */
export function isGovernmentRung(ev: CitationEvidence | null | undefined): boolean {
  return sectionIsBacked(ev);
}

export const SAMPLE_TAIL = '(Sample)';
export const RECALL_NOTE = 'section from AI recall, confirm';
export const TRIGGER_RECALL_NOTE = 'AI recall, confirm';
export const NO_SECTION_NOTE = 'no section given';

/**
 * "2025 RCNYS R312.1" + whether the recall note rides with it. A card with no
 * section says so instead of printing an empty reference; with no section
 * there is no recall note on the line either, so an edition the AI cited that
 * MAGE holds no record of at this address is marked "(as cited)" there
 * (`editionMarked`, the same rule as the card: ./jurisdiction.ts).
 */
function refFor(edition: string, section: string, backed: boolean, editionMarked: boolean): string {
  const sec = section.trim();
  if (!sec) return [edition && editionMarked ? `${edition} ${AS_CITED_MARK}` : edition, NO_SECTION_NOTE].filter(Boolean).join(', ');
  const ref = [edition, sec].filter(Boolean).join(' ');
  return backed ? ref : `${ref} (${RECALL_NOTE})`;
}

const TRIGGER_WORDS: Readonly<Record<CodeTrigger['comparison'], string>> = Object.freeze({
  '>': 'above',
  '>=': 'at or above',
  '<': 'below',
  '<=': 'at or below',
});

/** "above 30 in." */
export function triggerPhrase(trigger: CodeTrigger): string {
  return `${TRIGGER_WORDS[trigger.comparison] ?? trigger.comparison} ${formatJobNumber(trigger.value, trigger.unit)}`;
}

/** The architect list's reference: "R312.1.3, section from AI recall, confirm". */
function architectRef(item: Pick<CodeCardItem, 'section' | 'evidence'>): string {
  const sec = (item.section ?? '').trim();
  if (!sec) return NO_SECTION_NOTE;
  return isGovernmentRung(item.evidence) ? sec : `${sec}, ${RECALL_NOTE}`;
}

function sentence(s: string): string {
  const t = s.trim();
  if (!t) return '';
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** Who has the final word, by name when MAGE knows the office. */
export function confirmLine(info: CodeJurisdictionInfo | null | undefined): string {
  const office = info?.permitOfficeTitle?.trim();
  return office ? `Confirm with ${office}.` : 'Confirm with your building department.';
}

/**
 * The one-message text for a sub (or anyone) about one card.
 *
 * Re-runs with the measured number: pass `jobValue` after − / + and the job
 * line and the outcome change with it.
 */
export function shareTextFor(item: CodeCardItem, opts: ShareTextOptions = {}): string {
  const parts: string[] = [];
  const job = (opts.jobLabel ?? '').trim();
  const summary = sentence(item.summary);
  parts.push(job ? `${job}: ${summary}` : summary);

  const jv = opts.jobValue ?? item.jobValue ?? null;
  if (jv && item.trigger && canRecheck({ jobValue: jv, trigger: item.trigger })) {
    const eq = recheckEquation(item, jv);
    const from = (jv.sourceLabel ?? '').trim();
    // sentence(): "34 in." already ends in a period, so none is added twice.
    parts.push(sentence(`Job: ${formatJobNumber(jv.value, jv.unit)}${from ? ` (${from})` : ''}`));
    // The trigger number is the model's, on every rung (see the header).
    const trig = `${item.verdict === 'limit' ? 'Limit' : 'Applies'} ${triggerPhrase(item.trigger)}`;
    parts.push(`${trig} (${TRIGGER_RECALL_NOTE}).`);
    if (eq) parts.push(sentence(`Result: ${eq.words}`));
  }

  const cited = (item.citedEdition ?? '').trim();
  const edition = cited || (opts.info?.editionLabel ?? '').trim();
  const editionMarked = editionViewFor(item, opts.info).kind === 'recall';
  parts.push(sentence(`Ref: ${refFor(edition, item.section ?? '', isGovernmentRung(item.evidence), editionMarked)}`));
  parts.push(confirmLine(opts.info));
  if (opts.sample) parts.push(SAMPLE_TAIL);
  return parts.join(' ');
}

/**
 * One email to the architect for the plan-check rows that need one: every
 * "fix" row and every "ask" row that carries a question.
 */
export function architectMessageFor(
  items: readonly CodeCardItem[],
  opts: { jobLabel?: string | null; sheetLabel?: string | null; info?: CodeJurisdictionInfo | null; sample?: boolean } = {},
): { subject: string; body: string; fixes: number; questions: number } {
  const fixes = items.filter((i) => i.status === 'fix');
  const asks = items.filter((i) => i.status === 'ask' && (i.question ?? '').trim());
  const job = (opts.jobLabel ?? '').trim();
  const sheet = (opts.sheetLabel ?? '').trim();
  const subject = [job || 'Plan code check', sheet].filter(Boolean).join(' · ');
  const lines: string[] = [];
  lines.push(`A pre-check of ${sheet || 'the drawings'} found items to look at before we submit.`);
  if (fixes.length) {
    lines.push('');
    lines.push('To fix:');
    for (const f of fixes) {
      const where = [f.observed, f.location].map((s) => (s ?? '').trim()).filter(Boolean).join(', ');
      lines.push(`- ${sentence(f.summary)}${where ? ` (${where})` : ''} ${sentence(`Ref: ${architectRef(f)}`)}`);
    }
  }
  if (asks.length) {
    lines.push('');
    lines.push('Questions:');
    for (const a of asks) {
      lines.push(`- ${sentence(a.question ?? '')} ${sentence(`Ref: ${architectRef(a)}`)}`);
    }
  }
  lines.push('');
  lines.push('This is an AI read of the drawing, not plan review.');
  lines.push(confirmLine(opts.info));
  if (opts.sample) lines.push(SAMPLE_TAIL);
  return { subject, body: lines.join('\n'), fixes: fixes.length, questions: asks.length };
}

// ── Opening HIS app ──────────────────────────────────────────────────────

/** Digits only, with a leading + kept. Null when there is nothing dialable. */
export function phoneDigits(phone: string | null | undefined): string | null {
  const raw = (phone ?? '').split(/\s*(?:x|ext\.?)\s*\d/i)[0];
  const plus = raw.trim().startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7) return null;
  return plus ? `+${digits}` : digits;
}

/**
 * An sms: link that opens the user's own Messages with the text filled in.
 * iOS reads `&body=`, Android and the web read `?body=`. Null when the phone
 * is not dialable (the caller then offers to share the text instead).
 */
export function smsUrlFor(phone: string | null | undefined, body: string, os: 'ios' | 'android' | 'web' | string): string | null {
  const to = phoneDigits(phone);
  if (!to) return null;
  const sep = os === 'ios' ? '&' : '?';
  return `sms:${to}${sep}body=${encodeURIComponent(body)}`;
}

/** A mailto: link for his own Mail. */
export function mailtoUrlFor(to: string | null | undefined, subject: string, body: string): string {
  const addr = (to ?? '').trim();
  return `mailto:${encodeURIComponent(addr).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ── Sub picker ───────────────────────────────────────────────────────────

export interface SubLike {
  id: string;
  contactName?: string | null;
  companyName?: string | null;
  phone?: string | null;
  trade?: string | null;
}

export interface SubRecipient {
  id: string;
  /** "Dave R." */
  name: string;
  trade: string | null;
  phone: string | null;
  /** True when the sub's trade matches the card's `trade`. */
  matches: boolean;
}

/** "Dave Reyes" → "Dave R."; a company name stays whole. */
export function shortName(sub: SubLike): string {
  const contact = (sub.contactName ?? '').trim();
  if (contact) {
    const words = contact.split(/\s+/);
    if (words.length >= 2) return `${words[0]} ${words[words.length - 1][0].toUpperCase()}.`;
    return contact;
  }
  return (sub.companyName ?? '').trim() || 'Sub';
}

function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
}

/** Does a sub's trade match the card's trade? Word overlap, case-insensitive. */
export function tradeMatches(subTrade: string | null | undefined, cardTrade: string | null | undefined): boolean {
  const a = norm(subTrade);
  const b = norm(cardTrade);
  if (!a || !b) return false;
  if (a === b) return true;
  const aw = new Set(a.split(' ').filter((w) => w.length >= 3));
  return b.split(' ').some((w) => w.length >= 3 && aw.has(w));
}

/** The picker's chips: trade matches first, then the rest, each group in list order. */
export function subRecipientsFor(subs: readonly SubLike[], cardTrade?: string | null): SubRecipient[] {
  const rows = subs.map((s) => ({
    id: s.id,
    name: shortName(s),
    trade: (s.trade ?? '').trim() || null,
    phone: (s.phone ?? '').trim() || null,
    matches: tradeMatches(s.trade, cardTrade),
  }));
  return [...rows.filter((r) => r.matches), ...rows.filter((r) => !r.matches)];
}
