// utils/deliveryLink/core.ts — the Supplier Link, as plain rules (lane
// DELIVERIES-2, Deliveries phase 2).
//
// A person makes a link for ONE delivery and hands it to the supplier
// themselves. The supplier opens mageid.app/delivery/ with no account and
// gives a delivery date and a tracking number. This file holds:
//   - who may see the section at all (the ONE place the flag is read);
//   - exactly what the link shows the supplier (`buildShown`): what is coming,
//     the supplier's name, the company's name and, only if the person leaves
//     it switched on, Needed on Site By. No price, no client, no address, no
//     task name, no other delivery;
//   - how a row of public.delivery_supplier_links is read (`readLinkRow`), with
//     the supplier's answer treated as text a stranger typed;
//   - what "Use This Date" writes (`replyDatePatch`): an ordinary change of
//     the supplier date through utils/deliveries/provenance.recordSupplierDate,
//     recorded as "the supplier said so" with a note that it came through the
//     link and the name that was typed there.
//
// THE ANSWER NEVER CHANGES A DELIVERY BY ITSELF. Not here, and not in the
// database (the proof is scripts/pgq/delivery-supplier-links.mjs, case 13).
// MAGE ID DOES NOT KNOW WHO OPENED THE LINK. Anyone holding it can answer; the
// screen says so next to every answer.
//
// Pure: no React, no storage, no network. `now` is handed in.
import { DELIVERY_SUPPLIER_LINK_ENABLED } from '@/constants/featureFlags';
import { isOwner } from '@/utils/owner';
import type { Delivery } from '@/utils/deliverySchedule';
import { dayOrEmpty } from '@/utils/deliveries/calendar';
import { recordSupplierDate } from '@/utils/deliveries/provenance';

/** The rule itself, with the flag handed in so a test can ask both ways. */
export function supplierLinkAllowedWith(flagOn: boolean, userEmail: string | null | undefined): boolean {
  return flagOn === true || isOwner(userEmail);
}
/** True when the flag is on, or the signed-in person is the app's owner account. */
export function supplierLinkAllowed(userEmail: string | null | undefined): boolean {
  return supplierLinkAllowedWith(DELIVERY_SUPPLIER_LINK_ENABLED, userEmail);
}
/** True while the flag is off: the section says "Owner Preview". */
export function supplierLinkIsOwnerPreview(): boolean {
  const flagOn: boolean = DELIVERY_SUPPLIER_LINK_ENABLED;
  return !flagOn;
}

/** Where the no-account page lives. The token is the only thing in the address. */
export const SUPPLIER_LINK_BASE = 'https://mageid.app/delivery/';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The link for a token, or '' for anything that is not a token the database made. */
export function supplierLinkUrl(token: string | null | undefined): string {
  const t = (token ?? '').trim();
  return UUID.test(t) ? `${SUPPLIER_LINK_BASE}?t=${t.toLowerCase()}` : '';
}

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Exactly what the page shows. Every key is listed here; there is no other. */
export interface SupplierLinkShown {
  company: string;
  description: string;
  supplier: string;
  /** Needed on Site By as it stood when the link was made, or absent when the person chose not to show it or there is none. */
  neededBy?: string;
}
export const SHOWN_KEYS = ['company', 'description', 'supplier', 'neededBy'] as const;

/**
 * What the link will show, built from the delivery and nothing else of the job.
 * `neededBy` is put in only when `showNeededBy` is true AND there is a date.
 */
export function buildShown(input: {
  delivery: Pick<Delivery, 'description' | 'supplier'>;
  company: string | null | undefined;
  neededBy: string | null | undefined;
  showNeededBy: boolean;
}): SupplierLinkShown {
  const company = clean(input.company, 80);
  const needed = dayOrEmpty(input.neededBy ?? '');
  return {
    // "MAGE ID" was an old fallback for a blank company name. MAGE ID is never the one asking.
    company: /^mage\s*id$/i.test(company) ? '' : company,
    description: clean(input.delivery.description, 200),
    supplier: clean(input.delivery.supplier, 120),
    ...(input.showNeededBy && needed ? { neededBy: needed } : {}),
  };
}

/** The supplier's answer, as typed by whoever opened the link. */
export interface SupplierReply {
  /** The delivery date given, or '' when only a tracking number was given. */
  date: string;
  window: string;
  tracking: string;
  carrier: string;
  name: string;
  note: string;
  /** When the answer was stored (an instant). */
  at: string;
}

export interface SupplierLink {
  deliveryId: string;
  token: string;
  shown: SupplierLinkShown;
  madeAt: string;
  reply: SupplierReply | null;
  replyCount: number;
  /** When a person on the job marked the latest answer as seen, or ''. */
  replySeenAt: string;
}

/** The most answers one link takes (the table's own check). */
export const MAX_REPLIES = 20;

function readReply(raw: unknown): SupplierReply | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const at = clean(r.at, 40);
  const name = clean(r.name, 80);
  const date = dayOrEmpty(typeof r.date === 'string' ? r.date : '');
  const tracking = clean(r.tracking, 60);
  // An answer always has a name and a time, and a date or a tracking number. Anything else is not one.
  if (!at || !name || (!date && !tracking)) return null;
  return {
    date,
    window: clean(r.window, 40),
    // The database only stores letters, digits, spaces and dashes here. Read it the same way, so nothing else is ever drawn.
    tracking: /^[A-Za-z0-9][A-Za-z0-9 -]{3,59}$/.test(tracking) ? tracking : '',
    carrier: clean(r.carrier, 40),
    name,
    note: clean(r.note, 300),
    at,
  };
}

/** One row of public.delivery_supplier_links, made safe to read. Null for a row with no delivery or no token. */
export function readLinkRow(row: Record<string, unknown> | null | undefined): SupplierLink | null {
  if (!row) return null;
  const deliveryId = clean(row.delivery_id, 60);
  const token = clean(row.token, 60);
  if (!deliveryId || !UUID.test(token)) return null;
  const s = row.shown && typeof row.shown === 'object' && !Array.isArray(row.shown) ? (row.shown as Record<string, unknown>) : {};
  const needed = dayOrEmpty(typeof s.neededBy === 'string' ? s.neededBy : '');
  const count = typeof row.reply_count === 'number' && Number.isFinite(row.reply_count) ? Math.max(0, Math.min(MAX_REPLIES, Math.round(row.reply_count))) : 0;
  return {
    deliveryId,
    token,
    shown: { company: clean(s.company, 80), description: clean(s.description, 200), supplier: clean(s.supplier, 120), ...(needed ? { neededBy: needed } : {}) },
    madeAt: clean(row.made_at, 40),
    reply: readReply(row.reply),
    replyCount: count,
    replySeenAt: clean(row.reply_seen_at, 40),
  };
}

/** True when the link has an answer nobody on the job has marked as seen. */
export function replyIsNew(link: Pick<SupplierLink, 'reply' | 'replySeenAt'> | null | undefined): boolean {
  return !!link && !!link.reply && !link.replySeenAt;
}

/** True when the answer gives a date that is not the delivery's supplier date as it stands. */
export function replyDateDiffers(delivery: Pick<Delivery, 'expectedDate'>, reply: Pick<SupplierReply, 'date'> | null | undefined): boolean {
  return !!reply && !!reply.date && reply.date !== dayOrEmpty(delivery.expectedDate);
}

/**
 * "Use This Date": the delivery update that records the answer's date as the
 * supplier date. Null when the answer has no date or it is already the date.
 * `noteFor` turns the typed name into the note kept with the date ("Through
 * the supplier link, typed by Dana"); it is words, so the caller passes it.
 */
export function replyDatePatch(
  delivery: Pick<Delivery, 'expectedDate' | 'dateHistory' | 'promisedDate' | 'createdAt'>,
  reply: Pick<SupplierReply, 'date' | 'name'> | null | undefined,
  input: { now: Date; by: string; byName: string; noteFor: (name: string) => string },
): Pick<Delivery, 'expectedDate' | 'dateHistory' | 'promisedDate'> | null {
  if (!reply || !reply.date) return null;
  return recordSupplierDate(delivery, {
    date: reply.date,
    source: 'supplier_said',
    note: input.noteFor(reply.name),
    now: input.now,
    by: input.by,
    byName: input.byName,
  });
}

/** The words a person can paste to the supplier with the link. Nothing is sent from here. */
export function linkMessage(words: { ask: (what: string) => string; sign: (company: string) => string }, shown: Pick<SupplierLinkShown, 'description' | 'company'>, url: string): string {
  const lines = [words.ask(shown.description), url];
  if (shown.company) lines.push(words.sign(shown.company));
  return lines.join('\n');
}
