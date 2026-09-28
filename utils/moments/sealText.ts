// sealText.ts — the seal's ring text and the record line under the signature.
//
// LEGAL RULES (pinned by scripts/moments-checks/signline.ts S4):
//  - Built ONLY from the stored record: signedAt exactly as the write returned
//    it, labelled "(device time)" where it is the device clock and
//    "(server time)" where the server stamped it (the portal).
//  - Never "MAGE ID" on a legal seal: the seal is the signer's record, not our
//    brand.
//  - A proposal is ACCEPTED, never SIGNED.
//  - A paper signature never gets a seal: 'paper' throws here, and the ceremony
//    refuses it before it gets this far.
//
// Deterministic: Intl.DateTimeFormat('en-US', { timeZone }) pieces. The
// validator passes 'America/New_York'; the app passes nothing (device zone).
//
// Pure TypeScript apart from one pure import (bun loads it).

import { homeownerSignatureMethodLabel } from '@/utils/contractSignatureCore';

export type SealVerb = 'SIGNED' | 'SIGNED ON SITE' | 'ACCEPTED';
export type SignMethod = 'drawn' | 'typed' | 'in_person' | 'portal' | 'paper';
export type RecordVerb = 'Signed' | 'Accepted' | 'Signed on site' | 'Signed in person';

export const SEAL_SEPARATOR = ' · ';

/**
 * The status chip after the GC's first-of-two signature. It says "Sent" ONLY
 * when a fold (the sign-and-send card) exists and the email left; a failed
 * email, or no send at all (signed in person before the hand-off), never
 * claims one.
 */
export function waitingChipText(fold?: { to: string; sent?: boolean } | null): string {
  if (!fold) return 'Signed · awaiting countersignature';
  if (fold.sent === false) return 'Signed · Email not sent';
  return `Sent · awaiting ${fold.to}`;
}

interface DateParts {
  month: string;
  day: string;
  year: string;
  hour: string;
  minute: string;
  period: string;
}

function dateParts(signedAtIso: string, timeZone?: string): DateParts {
  const d = new Date(signedAtIso);
  if (!signedAtIso || Number.isNaN(d.getTime())) {
    throw new Error(`Seal text needs a stored timestamp, got ${String(signedAtIso)}`);
  }
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) out[p.type] = p.value;
  return {
    month: out.month ?? '',
    day: out.day ?? '',
    year: out.year ?? '',
    hour: out.hour ?? '',
    minute: out.minute ?? '',
    period: (out.dayPeriod ?? out.dayperiod ?? '').toUpperCase(),
  };
}

/** "2:41 PM" */
function time12(p: DateParts): string {
  return `${p.hour}:${p.minute} ${p.period}`;
}

/**
 * The ring text, closed with a trailing separator so it reads round the ring:
 * "SIGNED · SEP 27 2026 · 2:41 PM · ". In person: "SIGNED IN PERSON · ...".
 * Uppercase month, no comma, 12-hour time. Never "MAGE ID".
 */
export function buildSealRingText(o: {
  verb: SealVerb;
  method?: SignMethod;
  signedAtIso: string;
  timeZone?: string;
}): string {
  if (o.method === 'paper') throw new Error('A paper signature never gets a seal');
  const p = dateParts(o.signedAtIso, o.timeZone);
  const head = o.method === 'in_person' && o.verb === 'SIGNED' ? 'SIGNED IN PERSON' : o.verb;
  const date = `${p.month.toUpperCase()} ${p.day} ${p.year}`;
  return `${head}${SEAL_SEPARATOR}${date}${SEAL_SEPARATOR}${time12(p)}${SEAL_SEPARATOR}`;
}

/**
 * The printed record under the signature line. Rendered as
 * `${lead}<b>${verb}</b> ${rest}`:
 *   { lead: '', verb: 'Signed', rest: 'Sep 27, 2026, 2:41 PM (device time)' }
 *   with a name: lead 'Jane Smith · '.
 *   binding (portal): verb 'Signed.', rest 'Binding · Sep 27, 2026, 2:41 PM (server time)'.
 */
export function buildRecordLine(o: {
  name?: string;
  verb: RecordVerb;
  signedAtIso: string;
  timeSource: 'device' | 'server';
  timeZone?: string;
  binding?: boolean;
}): { lead: string; verb: string; rest: string; text: string } {
  const p = dateParts(o.signedAtIso, o.timeZone);
  const when = `${p.month} ${p.day}, ${p.year}, ${time12(p)} (${o.timeSource === 'server' ? 'server' : 'device'} time)`;
  const name = (o.name ?? '').trim();
  const lead = name ? `${name}${SEAL_SEPARATOR}` : '';
  const verb = o.binding ? `${o.verb}.` : o.verb;
  const rest = o.binding ? `Binding${SEAL_SEPARATOR}${when}` : when;
  return { lead, verb, rest, text: `${lead}${verb} ${rest}` };
}

/** "Sep 27, 2026, 2:41 PM" — the fold's "Sent" row and the hand-back record. */
export function formatRecordTime(signedAtIso: string, timeZone?: string): string {
  const p = dateParts(signedAtIso, timeZone);
  return `${p.month} ${p.day}, ${p.year}, ${time12(p)}`;
}

/** "Sep 27, 2026" — the name row's date. */
export function formatRecordDay(signedAtIso: string, timeZone?: string): string {
  const p = dateParts(signedAtIso, timeZone);
  return `${p.month} ${p.day}, ${p.year}`;
}

/** The method chip. 'paper' throws: a paper signature never reaches the ceremony. */
export function methodLabel(method: SignMethod): string {
  if (method === 'paper') throw new Error('A paper signature never reaches the ceremony');
  if (method === 'in_person') return homeownerSignatureMethodLabel({ method: 'in_person' }) ?? 'Signed in person';
  if (method === 'portal') return homeownerSignatureMethodLabel({ method: 'portal' }) ?? 'Signed in the client portal';
  if (method === 'typed') return 'Typed name';
  return 'Signed on this device';
}
