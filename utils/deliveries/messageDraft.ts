// utils/deliveries/messageDraft.ts — the DRAFT a person may send to a supplier
// (lane DELIVERIES-1). MAGE ID SENDS NOTHING: this file only builds text and
// the address of a draft in the phone's own mail app (a `mailto:` with no
// recipient filled in). The person reads it, picks who it goes to, and sends
// it themselves. On the web the text is copied instead.
//
// THE DRAFT STATES ONLY FACTS: what the delivery is, the PO number when there
// is one, the date the supplier gave, the old and new needed-by dates, and one
// question. It carries NO price, NO client name, NO project name and NO
// address, so a draft sent to the wrong yard gives nothing away.
//
// No import of any sender: no edge function, no notify, no email relay. The
// validator fails the build if this folder gains one.
//
// Pure: no React, no storage, no network. The words are handed in (the copy
// hook owns them, in English and Spanish).
import type { Delivery } from '@/utils/deliverySchedule';
import { dayOrEmpty } from './calendar';
import type { SupplierGap } from './flags';

export interface DraftWords {
  subject: (what: string) => string;
  hello: (supplier: string) => string;
  about: (what: string) => string;
  po: (po: string) => string;
  yourDate: (date: string) => string;
  noDateFromYou: string;
  neededChanged: (was: string, now: string) => string;
  needed: (date: string) => string;
  askHold: (date: string) => string;
  askEarlier: (date: string) => string;
  askDate: string;
  thanks: string;
}

export interface DraftInput {
  delivery: Pick<Delivery, 'description' | 'supplier' | 'poNumber' | 'expectedDate'>;
  /** Needed On Site By today ('' when there is none). */
  neededBy: string;
  /** What it was before the schedule moved ('' when it did not move). */
  neededByWas: string;
  gap: SupplierGap;
  /** The sender's own name, for the last line ('' leaves it off). */
  senderName: string;
  /** How a calendar day is written for the reader. */
  formatDay: (day: string) => string;
  words: DraftWords;
}

export interface MessageDraft { subject: string; body: string }

export function buildSupplierDraft(i: DraftInput): MessageDraft {
  const w = i.words;
  const what = i.delivery.description.trim();
  const supplierDate = dayOrEmpty(i.delivery.expectedDate);
  const lines: string[] = [w.hello(i.delivery.supplier.trim()), '', w.about(what)];
  const po = (i.delivery.poNumber ?? '').trim();
  if (po) lines.push(w.po(po));
  lines.push(supplierDate ? w.yourDate(i.formatDay(supplierDate)) : w.noDateFromYou);
  if (i.neededBy) {
    lines.push(i.neededByWas && i.neededByWas !== i.neededBy
      ? w.neededChanged(i.formatDay(i.neededByWas), i.formatDay(i.neededBy))
      : w.needed(i.formatDay(i.neededBy)));
  }
  lines.push('');
  if (!supplierDate || !i.neededBy) lines.push(w.askDate);
  else if (i.gap.kind === 'after') lines.push(w.askEarlier(i.formatDay(i.neededBy)));
  else if (i.gap.kind === 'before') lines.push(w.askHold(i.formatDay(i.neededBy)));
  else lines.push(w.askDate);
  lines.push('', w.thanks);
  if (i.senderName.trim()) lines.push(i.senderName.trim());
  return { subject: w.subject(what), body: lines.join('\n') };
}

/** A draft in the device's own mail app: no recipient, the person chooses. Opening it sends nothing. */
export function draftMailUrl(draft: MessageDraft): string {
  return `mailto:?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
}
