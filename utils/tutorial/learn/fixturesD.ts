// utils/tutorial/learn/fixturesD.ts — the pure helpers behind lane D's three
// tutorials (contract-from-estimate, pay-app-period, closeout-binder).
// Pure data plus pure functions: no React, no RN, no context, no storage.
//
// THESE ARE LEGAL AND MONEY DOCUMENTS. Lane D bundles NO sample answers: the
// contract's sum and terms, the pay app's schedule of values and the binder's
// sections all come from the sample job's own records through the screens'
// real code. What lives here is only:
//   • the payload builders the three screens emit through (so a missing or
//     zero value is never sent as if he had typed it);
//   • the binder's real section list (the screen's own preview rows —
//     scripts/validate-tutorial-learn-d.ts reads them out of
//     app/closeout-binder.tsx and fails on a drift);
//   • the LEGAL / OUTBOUND rule: which target ids a lane D step may never
//     wait on (sign, seal, certify, deliver, send). The validator runs it over
//     every lane D def, and a planted mutation must turn it red.
//
// MONEY IS INTEGER CENTS in every payload (the screens hold dollars).

/** Dollars (as the screens hold them) to integer cents. Not finite → 0. */
export function toCentsD(dollars: number): number {
  return Number.isFinite(dollars) ? Math.round(dollars * 100) : 0;
}

// ── Contract ────────────────────────────────────────────────────────────────

/** The contract's timeline payload, or null while either half is missing.
 *  A completion date from a blank start is not a date (CONTRACT-TIME-1), so
 *  the step never completes on half a timeline. */
export function contractTimelinePayload(
  startDate: string | null | undefined,
  durationDays: number | null | undefined,
): { startDate: string; durationDays: number } | null {
  const s = (startDate ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  if (typeof durationDays !== 'number' || !Number.isInteger(durationDays) || durationDays <= 0) return null;
  return { startDate: s, durationDays };
}

/** Where the saved terms came from, as the screen's termsSource says it:
 *  'record' (the proposal this client was shown), 'profile' (his own split),
 *  else 'saved' — a contract loaded from the database (termsSource null) or
 *  one whose split he typed row by row: its schedule is a stored value. */
export type ContractTermsSource = 'record' | 'profile' | 'saved';

export function contractTermsSource(source: string | null | undefined): ContractTermsSource {
  return source === 'record' || source === 'profile' ? source : 'saved';
}

// ── Pay application ─────────────────────────────────────────────────────────

/** The line he just changed, as the payApp.line.set payload — or null when it
 *  bills nothing this period (a cleared field is not "work entered"). */
export function payAppLinePayload(
  line: { id: string; thisPeriod: number } | null | undefined,
): { lineId: string; thisPeriodCents: number } | null {
  if (!line || !line.id) return null;
  const cents = toCentsD(line.thisPeriod);
  return cents > 0 ? { lineId: line.id, thisPeriodCents: cents } : null;
}

/** PERIOD TO is a YYYY-MM-DD calendar day (the screen's own isCalendarDay
 *  rule, restated so this file stays pure). */
export function isPeriodDay(v: string | null | undefined): boolean {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** The payApp.period.set payload: only a real day that differs from the one
 *  the screen opened with (the step is "set the period end", not "look at
 *  it"). */
export function payAppPeriodPayload(
  periodTo: string | null | undefined,
  openedWith: string | null | undefined,
): { periodTo: string } | null {
  if (!isPeriodDay(periodTo)) return null;
  if (periodTo === (openedWith ?? null)) return null;
  return { periodTo: periodTo as string };
}

// ── Closeout binder ─────────────────────────────────────────────────────────

/** The binder's sections, exactly as app/closeout-binder.tsx's preview card
 *  lists them (PreviewRow labels, in order). The validator pins the match. */
export const BINDER_SECTION_LABELS = ['Finishes & fixtures', 'Trades', 'Warranties', 'Maintenance schedule'] as const;

/** How many of the binder's sections have something in them right now. */
export function binderSectionsFilled(counts: {
  selections: number;
  trades: number;
  warranties: number;
  maintenance: number;
}): number {
  return [counts.selections, counts.trades, counts.warranties, counts.maintenance].filter(n => Number.isFinite(n) && n > 0).length;
}

// ── The legal / outbound rule ───────────────────────────────────────────────

/** Ids lane D lights only to EXPLAIN (look steps). A do / wait step that
 *  waits on one of them would be practising a legal or outbound act. */
export const LANE_D_LEGAL_TARGETS = ['contract.sign', 'payApp.certifyExplain', 'binder.deliver'] as const;

/** Words that make any target id legal or outbound, wherever it lives. */
export const LANE_D_LEGAL_WORDS = ['seal', 'certify', 'deliver', 'send', 'sign'] as const;

/** True when a step may only ever LOOK at `id` (never wait on it). 'sign' is
 *  matched as a word part ('contract.sign', 'signTogether') but not inside
 *  'design' / 'assign'. */
export function isLegalOrOutboundTarget(id: string): boolean {
  if ((LANE_D_LEGAL_TARGETS as readonly string[]).includes(id)) return true;
  const low = id.toLowerCase();
  return LANE_D_LEGAL_WORDS.some(w => (w === 'sign' ? /(^|[.\-_])sign/.test(low) : low.includes(w)));
}
