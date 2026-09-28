// crewCerts.ts — which of a crew member's certifications need a flag, and the
// words the chip says.
//
// WHY THIS EXISTS (audit round 2, safety-compliance #2). Certifications are
// joined to a real person (Certification.workerId → CrewMember.id) and the
// crew screen already shows each one's status, but the moments a person is put
// on the job — the toolbox sign-in sheet, the JHA sign-off — never looked. An
// SST card that lapsed yesterday signed Monday's talk with no mark on it.
//
// EXACT JOINS ONLY. A chip is shown for an attendee whose row carries the crew
// member's id (picked from the roster), never for a typed name that happens to
// match — "Jose R" is not proof of which Jose, and a guessed "Expired" chip on
// the wrong man is worse than none. Pure, so the time-tracking clock-in modal
// can import the same words (time lane) and the validator runs it under bun.

import type { Certification } from '@/types';
import { certExpiryStatus } from '@/utils/crew/certExpiry';
import { formatCalendarDay } from '@/utils/calendarDate';
// Spanish (wave-next W2): whole sentences as catalog keys read at call time;
// in English t()/tn() return the inline English, so every output is unchanged.
import { t, tn } from '@/i18n/core';

export interface CertFlag {
  certId: string;
  type: string;
  expiresDate: string;
  status: 'expired' | 'expiring';
  /** "Expired: SST (Sep 12)" / "Expiring: OSHA 30 (Oct 2)". */
  label: string;
}

/**
 * Expired and expiring certs for one worker, expired first, soonest first.
 * `today` is a LOCAL calendar day ('YYYY-MM-DD', todayCalendarDay()) — a UTC
 * instant would flag a card expired during the evening of its last valid day.
 * A cert with no expiry date is not flagged: MAGE does not know when it lapses,
 * and saying so belongs on the certification screen, not on a sign-in row.
 */
export function certFlagsForWorker(
  certifications: Certification[],
  workerId: string | undefined | null,
  today: string,
): CertFlag[] {
  if (!workerId) return [];
  const out: CertFlag[] = [];
  for (const c of certifications) {
    if (c.workerId !== workerId) continue;
    const exp = (c.expiresDate ?? '').trim();
    if (!exp) continue;
    const status = certExpiryStatus(exp, today);
    if (status !== 'expired' && status !== 'expiring') continue;
    const when = formatCalendarDay(exp, { month: 'short', day: 'numeric' });
    out.push({
      certId: c.id,
      type: c.type,
      expiresDate: exp,
      status,
      label: status === 'expired'
        ? t('safety.cert.flagExpired', 'Expired: {type} ({date})', { type: c.type, date: when || exp })
        : t('safety.cert.flagExpiring', 'Expiring: {type} ({date})', { type: c.type, date: when || exp }),
    });
  }
  return out.sort((a, b) =>
    a.status !== b.status ? (a.status === 'expired' ? -1 : 1) : a.expiresDate.localeCompare(b.expiresDate));
}

/** The confirmation line for putting someone whose card has lapsed on the
 *  job. Names every lapsed certificate and its date — the super is told what,
 *  not "a cert" — in the same "Sep 12" form the chip on that row shows, and
 *  asks with the verb of the button under it (`action`: "Sign them in" on the
 *  toolbox / JHA sheets, "Clock them in" at clock-in). */
export function lapsedCertConfirmText(name: string, flags: CertFlag[], action = 'Sign them in'): string | null {
  const expired = flags.filter(f => f.status === 'expired');
  if (expired.length === 0) return null;
  const list = expired
    .map(f => t('safety.cert.lapsedItem', '{type} (expired {date})', {
      type: f.type,
      date: formatCalendarDay(f.expiresDate, { month: 'short', day: 'numeric' }) || f.expiresDate,
    }))
    .join(', ');
  const vars = { name, list };
  // One whole sentence per button verb the callers pass (never the verb as a
  // fragment in a translated frame). An unknown verb keeps the English frame.
  switch (action) {
    case 'Sign them in':
      return tn('safety.cert.lapsedConfirmSignIn', expired.length, {
        one: "{name}'s {list} has lapsed. Sign them in anyway?",
        other: "{name}'s {list} have lapsed. Sign them in anyway?",
      }, vars);
    case 'Sign them off':
      return tn('safety.cert.lapsedConfirmSignOff', expired.length, {
        one: "{name}'s {list} has lapsed. Sign them off anyway?",
        other: "{name}'s {list} have lapsed. Sign them off anyway?",
      }, vars);
    case 'Clock them in':
      return tn('safety.cert.lapsedConfirmClockIn', expired.length, {
        one: "{name}'s {list} has lapsed. Clock them in anyway?",
        other: "{name}'s {list} have lapsed. Clock them in anyway?",
      }, vars);
  }
  return `${name}'s ${list} ${expired.length === 1 ? 'has' : 'have'} lapsed. ${action} anyway?`;
}
