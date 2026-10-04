// utils/permitPath/askDepartment.ts — "We don't know yet, so let's ask"
// (lane PPASK). PURE: no React, no network, no storage, no clock.
//
// When a Permit Path station has items nobody knows yet, the GC taps "Ask" and
// this builds the exact questions for that building department, twice:
//   • an EMAIL draft, addressed only to an email read off the office's own site
//     (or the dated state list it came from);
//   • a CALL script, with the office's main number as a tel: link and its hours.
// MAGE sends nothing. The GC edits the draft and sends it from his own mail
// app, or dials from his own phone.
//
// THE RULES (carried over unchanged from utils/departmentQuestion.ts:1-21)
// 1. NOTHING IS SENT. This builds text; the sheet opens the GC's mail app.
// 2. NO INVENTED RECIPIENT. `to` comes from `office.email` only when the office
//    is hand-verified or from a state list, never from a name-only office (the
//    name comes from Census geography and nothing else is known). In NYC it
//    comes only from the routed channel's own email, and a FILING question
//    names nobody: the person to ask is the applicant of record on that
//    filing, and DOB's datasets publish no email (noRecipientLine, verbatim).
// 3. THE MODEL IS NOT HERE, AND NEITHER ARE CLAIMS. The body asks; it never
//    states a requirement, cites a code section or quotes a fee. The questions
//    are the packs' own words with <scope> filled in.
// 4. DOB IS NYC ONLY. Only the NYC branch uses DOB's routing words.

import type { BuildingDepartment } from '@/utils/codeJurisdiction';
import { noRecipientLine, type QuestionRouting } from '@/utils/departmentQuestion';
import { NAME_ONLY_NOTE, telUrlFor, type PermitOffice } from '@/utils/permitOffices';
import { STATION_ORDER, type DeptQuestion, type PermitRoute } from './types';

/** At most this many questions in one email or call. */
export const MAX_QUESTIONS_PER_ASK = 8;

export interface AskCall {
  /** 'tel:5165388500' — the office's main number, or null (shown as text, or not at all). */
  tel: string | null;
  /** The number as the office lists it. */
  phoneLabel: string | null;
  hours: string | null;
  opener: string;
  numbered: string[];
  /** What to write down during the call. */
  capture: string[];
}

export interface AskDraft {
  /** An email read off the office's own source, or null. Never invented. */
  to: string | null;
  /** Where the email came from, or why there isn't one. */
  toNote: string;
  subject: string;
  body: string;
  call: AskCall;
  officeLabel: string;
  /** Where the office's contact facts came from (or NAME_ONLY_NOTE). */
  sourceLine: string;
  /** The office is a name-only card: the sheet shows NAME_ONLY_BADGE. */
  nameOnly: boolean;
  /** The questions in this draft, in the order asked. */
  questionIds: string[];
  /** Questions left over past MAX_QUESTIONS_PER_ASK ("Ask the next <n>"). */
  remaining: number;
  remainingIds: string[];
}

export interface AskInput {
  route: Pick<PermitRoute, 'jurisdiction'> | null;
  questions: readonly DeptQuestion[];
  office: PermitOffice | null;
  nycDepartment: BuildingDepartment | null;
  nycRouting: QuestionRouting | null;
  address: string;
  company: string;
  scopeLine: string;
  /** 'YYYY-MM-DD'. Part of the contract; nothing in the draft is dated today. */
  today: string;
}

export const CAPTURE_LINES: readonly string[] = ['Their name', 'Their title', 'Today’s date', 'What they said, in their words'];

const clean = (v: string | null | undefined): string => (v ?? '').trim();
const noEnd = (v: string): string => v.replace(/[\s.;:,]+$/, '');

/** Questions in station order (input order within a station), each id once. */
export function orderQuestions(questions: readonly DeptQuestion[]): DeptQuestion[] {
  const seen = new Set<string>();
  const unique = questions.filter((q) => (seen.has(q.id) ? false : (seen.add(q.id), true)));
  const rank = (q: DeptQuestion) => {
    const i = STATION_ORDER.indexOf(q.station);
    return i < 0 ? STATION_ORDER.length : i;
  };
  return unique
    .map((q, i) => ({ q, i }))
    .sort((a, b) => rank(a.q) - rank(b.q) || a.i - b.i)
    .map((x) => x.q);
}

/** A question's text with <scope> filled in. */
export function fillQuestion(text: string, scopeLine: string): string {
  const scope = noEnd(clean(scopeLine)) || 'this work';
  return clean(text).replace(/<scope>/g, scope);
}

function noEmailNote(officeLabel: string): string {
  return `No email on file for ${officeLabel}. Call them, or look up their email on their site.`;
}

/** The NYC recipient: the routed channel's own email, or nobody. */
function nycRecipient(
  routing: QuestionRouting | null,
  asksAboutFiling: boolean,
  officeLabel: string,
): { to: string | null; toNote: string } {
  if (asksAboutFiling) {
    // The applicant-of-record rule: a filing question goes to the applicant
    // named on the filing, and DOB publishes no email for them.
    const fallback = routing ? routing.toFallback : noRecipientLine('not_checked', true);
    if (routing?.toName) {
      return {
        to: null,
        toNote: `${routing.toName}${routing.toDetail ? ` (${routing.toDetail})` : ''}. DOB publishes no email for the applicant of record.`,
      };
    }
    return { to: null, toNote: fallback };
  }
  const email = clean(routing?.channel?.email);
  if (email) {
    return { to: email, toNote: clean(routing?.whyThisChannel) || clean(routing?.channel?.label) || `Email from ${officeLabel}.` };
  }
  return { to: null, toNote: noEmailNote(officeLabel) };
}

/**
 * The email draft and call script for these questions. Questions are grouped
 * by station, at most MAX_QUESTIONS_PER_ASK per draft; the rest are counted in
 * `remaining` / `remainingIds` for "Ask the next <n>".
 */
export function buildAsk(input: AskInput): AskDraft {
  const { route, office, nycDepartment, nycRouting } = input;
  const ordered = orderQuestions(input.questions);
  const asked = ordered.slice(0, MAX_QUESTIONS_PER_ASK);
  const rest = ordered.slice(MAX_QUESTIONS_PER_ASK);

  const nyc = route?.jurisdiction.family === 'nyc';
  const nameOnly = !!office && office.verification === 'name-only';

  const officeLabel =
    clean(office?.title)
    || clean(route?.jurisdiction.officeTitle)
    || (nyc ? 'NYC Department of Buildings' : '')
    || clean(route?.jurisdiction.name)
    || 'the building department';

  // ── Recipient ────────────────────────────────────────────────────────────
  let to: string | null = null;
  let toNote: string;
  if (office) {
    const email = nameOnly ? '' : clean(office.email);
    if (email) {
      to = email;
      toNote = `Email from ${clean(office.sourceLabel) || officeLabel}.`;
    } else {
      toNote = noEmailNote(officeLabel);
    }
  } else if (nyc) {
    ({ to, toNote } = nycRecipient(nycRouting, asked.some((q) => q.station === 'filing'), officeLabel));
  } else if (nycDepartment && clean(nycDepartment.email)) {
    // A verified department row outside NYC (every fact read off its own site).
    to = clean(nycDepartment.email);
    toNote = `Email from ${clean(nycDepartment.sourceLabel) || clean(nycDepartment.sourceUrl)}.`;
  } else {
    toNote = noEmailNote(officeLabel);
  }

  // ── Text ─────────────────────────────────────────────────────────────────
  const address = clean(input.address) || 'the job';
  const company = clean(input.company);
  const scope = noEnd(clean(input.scopeLine));
  const numbered = asked.map((q) => fillQuestion(q.text, input.scopeLine));
  const list = numbered.map((t, i) => `${i + 1}. ${t}`);

  const about = scope ? `I have a few questions about a job at ${address}: ${scope}.` : `I have a few questions about a job at ${address}.`;
  const body = ['Hello,', '', about, '', ...list, '', company ? `Thank you,\n${company}` : 'Thank you,'].join('\n');

  const opener = company
    ? `Hi, I'm ${company}, a contractor. I have a few questions about a job at ${address}.`
    : `Hi, I'm a contractor. I have a few questions about a job at ${address}.`;

  // ── Phone ────────────────────────────────────────────────────────────────
  let phoneLabel: string | null = null;
  let hours: string | null = null;
  if (office) {
    // A name-only card carries no verified contact, so nothing is dialled.
    phoneLabel = nameOnly ? null : clean(office.phone) || null;
    hours = nameOnly ? null : clean(office.hours) || null;
  } else if (nycDepartment) {
    phoneLabel = clean(nyc ? nycRouting?.channel?.phone : '') || clean(nycDepartment.phone) || null;
    hours = clean(nycDepartment.hours) || null;
  }

  // ── Source ───────────────────────────────────────────────────────────────
  let sourceLine: string;
  if (office) sourceLine = nameOnly ? NAME_ONLY_NOTE : clean(office.sourceLabel) || NAME_ONLY_NOTE;
  else if (nycDepartment) sourceLine = `${clean(nycDepartment.sourceLabel) || 'nyc.gov'}, checked ${nycDepartment.checkedOn}`;
  else sourceLine = 'MAGE has no contact details on file for this department.';

  return {
    to,
    toNote,
    subject: `Permit question · ${address} · ${officeLabel}`,
    body,
    call: {
      tel: telUrlFor(phoneLabel),
      phoneLabel,
      hours,
      opener,
      numbered,
      capture: [...CAPTURE_LINES],
    },
    officeLabel,
    sourceLine,
    nameOnly,
    questionIds: asked.map((q) => q.id),
    remaining: rest.length,
    remainingIds: rest.map((q) => q.id),
  };
}
