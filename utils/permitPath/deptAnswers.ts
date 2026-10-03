// utils/permitPath/deptAnswers.ts — a department's answer, saved by the GC
// (lane PPASK). PURE: no React, no network, no storage, no clock. Every "today"
// is passed in, so scripts/validate-permit-path-ask.ts runs it under bun with a
// pinned date.
//
// WHAT A SAVED ANSWER IS. What one person at one building department said, on
// one date, through one channel (phone, email, counter, website, letter), in
// answer to one or more of the questions MAGE could not answer for that
// jurisdiction. It is never "verified": it stays a dated statement with who
// said it, and after 365 days it reads "Saved over a year ago. Ask again?"
// (PLAN F4). It applies to its own jurisdiction key only (answersFor matches
// the key exactly).
//
// THE ROW. public.jurisdiction_answers
// (supabase/migrations/20261002170000_jurisdiction_answers.sql). `rowSchema`
// mirrors the table's CHECK constraints one for one; the validator runs a
// single table of cases through both (zod here, SQL in the PGlite proof), so
// the two cannot drift apart unnoticed. The row carries no user_id: the column
// defaults to auth.uid() and RLS checks it.
//
// ONE ROW PER SAVE. question_ids holds every question the answer covers. The
// route engine (PPENGINE RouteInputs['deptAnswers']) wants one element per
// question, so `toEngineAnswers` flattens a row into one element per id.

import { z } from 'zod';

export const JURISDICTION_ANSWERS_TABLE = 'jurisdiction_answers';

/** Mirrors the SQL key check. 'NYC' or a PermitOffice.key. 'UNRESOLVED' is not
 *  a key an answer can be saved under (nobody knows which department it is). */
export const JURISDICTION_KEY_RE = /^(NYC|NY:[0-9]{7,10}|NJ:[0-9]{4}|CT:[A-Za-z0-9_-]{1,40}|MD:[0-9]{5})$/;

/** One question id ('li.survey', 'nyc.job_type_q'). Mirrors the SQL check on
 *  every element of question_ids. */
export const QUESTION_ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;

export const ANSWER_CHANNELS = ['phone', 'email', 'counter', 'website', 'letter', 'other'] as const;
export type AnswerChannel = (typeof ANSWER_CHANNELS)[number];

/** The columns the app reads (never user_id). */
export const ANSWER_COLUMNS =
  'id, jurisdiction_key, jurisdiction_name, question_ids, question_text, answer_text, answered_on, said_by_name, said_by_role, channel, source_url, project_id, created_at';

/** Limits, shared with the migration's CHECK constraints. */
export const LIMITS = {
  jurisdictionName: 200,
  questionIds: 20,
  questionText: 2000,
  answerText: 4000,
  saidBy: 120,
  sourceUrl: 2000,
} as const;

export const STALE_AFTER_DAYS = 365;

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Postgres char_length counts characters (code points), not UTF-16 units. */
function chars(s: string): number {
  return [...s].length;
}

/** Days since 1970-01-01 for a real calendar day, else null. */
function dayNumber(day: string): number | null {
  const m = DAY_RE.exec(day);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return Math.round(t / 86_400_000);
}

/** Whole days from `from` to `to` (both 'YYYY-MM-DD'); null if either is not a day. */
export function daysBetween(from: string, to: string): number | null {
  const a = dayNumber(from);
  const b = dayNumber(to);
  return a == null || b == null ? null : b - a;
}

/** The row the app inserts. Exactly the table's columns minus the server's
 *  (user_id, created_at, updated_at). */
export interface JurisdictionAnswerInsert {
  id: string;
  jurisdiction_key: string;
  jurisdiction_name: string;
  question_ids: string[];
  question_text: string;
  answer_text: string;
  answered_on: string;
  said_by_name: string | null;
  said_by_role: string | null;
  channel: AnswerChannel;
  source_url: string | null;
  project_id: string | null;
}

/** A row as read back (ANSWER_COLUMNS). */
export interface JurisdictionAnswerRow extends JurisdictionAnswerInsert {
  created_at: string | null;
}

const lengthBetween = (min: number, max: number) => (s: string) => chars(s) >= min && chars(s) <= max;

/**
 * The zod mirror of the table's CHECK constraints. `today` is the caller's
 * calendar day; the SQL allows up to New York's day + 1, and a device's local
 * day is never more than one day ahead of New York's, so a day this accepts
 * the table accepts too.
 */
export function rowSchema(today: string) {
  const todayN = dayNumber(today);
  return z.object({
    id: z.string().regex(UUID_RE),
    jurisdiction_key: z.string().regex(JURISDICTION_KEY_RE),
    jurisdiction_name: z.string().refine(lengthBetween(1, LIMITS.jurisdictionName)),
    question_ids: z.array(z.string().regex(QUESTION_ID_RE)).min(1).max(LIMITS.questionIds),
    question_text: z.string().refine(lengthBetween(1, LIMITS.questionText)),
    answer_text: z.string().refine(lengthBetween(1, LIMITS.answerText)),
    answered_on: z.string().refine((d) => {
      const n = dayNumber(d);
      return n != null && todayN != null && n <= todayN + 1;
    }),
    said_by_name: z.string().refine(lengthBetween(0, LIMITS.saidBy)).nullable(),
    said_by_role: z.string().refine(lengthBetween(0, LIMITS.saidBy)).nullable(),
    channel: z.enum(ANSWER_CHANNELS),
    source_url: z.string().regex(/^https:\/\//).refine(lengthBetween(0, LIMITS.sourceUrl)).nullable(),
    project_id: z.string().regex(UUID_RE).nullable(),
  }).strict();
}

/** What the Save answer sheet hands over. */
export interface DeptAnswerInput {
  id: string;
  jurisdictionKey: string;
  jurisdictionName: string;
  questionIds: readonly string[];
  questionText: string;
  answerText: string;
  answeredOn: string;
  saidByName?: string | null;
  saidByRole?: string | null;
  channel: AnswerChannel;
  sourceUrl?: string | null;
  projectId?: string | null;
}

export type ToRowResult =
  | { ok: true; row: JurisdictionAnswerInsert }
  | { ok: false; field: keyof DeptAnswerInput; reason: string };

const blankToNull = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim();
  return s.length > 0 ? s : null;
};

/** The first problem, in the words the sheet shows under a blocked Save. */
function reasonFor(path: string): { field: keyof DeptAnswerInput; reason: string } {
  switch (path) {
    case 'answer_text': return { field: 'answerText', reason: 'Add what they said' };
    case 'answered_on': return { field: 'answeredOn', reason: 'Pick the day they told you (today or earlier)' };
    case 'question_ids': return { field: 'questionIds', reason: 'Tick the questions this answers' };
    case 'source_url': return { field: 'sourceUrl', reason: 'Links start with https://' };
    case 'said_by_name': return { field: 'saidByName', reason: 'Their name is too long' };
    case 'said_by_role': return { field: 'saidByRole', reason: 'Their title is too long' };
    case 'channel': return { field: 'channel', reason: 'Pick how they told you' };
    case 'jurisdiction_key': return { field: 'jurisdictionKey', reason: 'MAGE doesn’t know which department this is yet' };
    case 'question_text': return { field: 'questionText', reason: 'Tick the questions this answers' };
    case 'project_id': return { field: 'projectId', reason: 'This job can’t be linked' };
    case 'id':
    case 'jurisdiction_name':
    default: return { field: 'jurisdictionName', reason: 'Something about this answer can’t be saved' };
  }
}

/** Field order for the first-problem message: what the GC sees first. */
const REASON_ORDER = [
  'answer_text', 'question_ids', 'answered_on', 'channel', 'source_url', 'said_by_name', 'said_by_role',
  'question_text', 'jurisdiction_key', 'jurisdiction_name', 'project_id', 'id',
];

/**
 * The row for an insert, or the first reason it can't be saved. Text is
 * trimmed, an empty optional field becomes null, and duplicate question ids
 * collapse. The row never carries user_id.
 */
export function toRow(input: DeptAnswerInput, opts: { today: string }): ToRowResult {
  const candidate = {
    id: input.id,
    jurisdiction_key: input.jurisdictionKey,
    jurisdiction_name: (input.jurisdictionName ?? '').trim(),
    question_ids: [...new Set(input.questionIds)],
    question_text: (input.questionText ?? '').trim(),
    answer_text: (input.answerText ?? '').trim(),
    answered_on: input.answeredOn,
    said_by_name: blankToNull(input.saidByName),
    said_by_role: blankToNull(input.saidByRole),
    channel: input.channel,
    source_url: blankToNull(input.sourceUrl),
    project_id: input.projectId ?? null,
  };
  const parsed = rowSchema(opts.today).safeParse(candidate);
  if (parsed.success) return { ok: true, row: parsed.data as JurisdictionAnswerInsert };
  const paths = new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '')));
  const first = REASON_ORDER.find((p) => paths.has(p)) ?? 'id';
  return { ok: false, ...reasonFor(first) };
}

/** The questions an answer covers, as the text saved with it: one per line,
 *  numbered, capped at the column's length. */
export function questionTextFor(texts: readonly string[]): string {
  const joined = texts.map((t, i) => `${i + 1}. ${t.trim()}`).join('\n');
  const cps = [...joined];
  return cps.length <= LIMITS.questionText ? joined : `${cps.slice(0, LIMITS.questionText - 1).join('')}…`;
}

/** A saved answer, as the app uses it. */
export interface SavedDeptAnswer {
  id: string;
  jurisdictionKey: string;
  jurisdictionName: string;
  questionIds: string[];
  questionText: string;
  answerText: string;
  answeredOn: string;
  /** "J. Smith · plans examiner", one of the two, or null. */
  saidBy: string | null;
  saidByName: string | null;
  saidByRole: string | null;
  channel: AnswerChannel;
  sourceUrl: string | null;
  projectId: string | null;
  createdAt: string | null;
}

/** One element of PPENGINE's RouteInputs['deptAnswers'] (structurally the
 *  same type; this file does not import the engine). */
export interface EngineDeptAnswer {
  id: string;
  jurisdictionKey: string;
  questionId: string;
  answerText: string;
  answeredOn: string;
  saidBy: string | null;
  channel: string;
  sourceUrl: string | null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** A row read from the table → a saved answer. Null for a row that isn't one
 *  (a malformed read is dropped, never shown half-filled). */
export function fromRow(row: Partial<Record<keyof JurisdictionAnswerRow, unknown>> | null | undefined): SavedDeptAnswer | null {
  if (!row) return null;
  const id = str(row.id);
  const key = str(row.jurisdiction_key);
  const answer = str(row.answer_text);
  const answeredOn = str(row.answered_on)?.slice(0, 10) ?? null;
  const channel = str(row.channel);
  const ids = Array.isArray(row.question_ids) ? row.question_ids.filter((q): q is string => typeof q === 'string' && q.length > 0) : [];
  if (!id || !key || !answer || !answeredOn || dayNumber(answeredOn) == null || ids.length === 0) return null;
  if (!channel || !(ANSWER_CHANNELS as readonly string[]).includes(channel)) return null;
  const name = blankToNull(str(row.said_by_name));
  const role = blankToNull(str(row.said_by_role));
  const url = str(row.source_url);
  return {
    id,
    jurisdictionKey: key,
    jurisdictionName: str(row.jurisdiction_name) ?? '',
    questionIds: ids,
    questionText: str(row.question_text) ?? '',
    answerText: answer,
    answeredOn,
    saidBy: name && role ? `${name} · ${role}` : name ?? role,
    saidByName: name,
    saidByRole: role,
    channel: channel as AnswerChannel,
    sourceUrl: url && /^https:\/\//.test(url) ? url : null,
    projectId: str(row.project_id),
    createdAt: str(row.created_at),
  };
}

/** The saved answer an insert row becomes (the optimistic copy). */
export function fromInsert(row: JurisdictionAnswerInsert, createdAt: string | null = null): SavedDeptAnswer {
  return fromRow({ ...row, created_at: createdAt }) as SavedDeptAnswer;
}

/** This jurisdiction's answers only (EXACT key), newest answer first. */
export function answersFor(rows: readonly SavedDeptAnswer[], key: string | null | undefined): SavedDeptAnswer[] {
  if (!key) return [];
  return rows
    .filter((r) => r.jurisdictionKey === key)
    .sort((a, b) =>
      a.answeredOn !== b.answeredOn
        ? (a.answeredOn < b.answeredOn ? 1 : -1)
        : (a.createdAt ?? '') < (b.createdAt ?? '') ? 1 : (a.createdAt ?? '') > (b.createdAt ?? '') ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
}

/** One engine element per (answer, question id). */
export function toEngineAnswers(answers: readonly SavedDeptAnswer[]): EngineDeptAnswer[] {
  const out: EngineDeptAnswer[] = [];
  for (const a of answers) {
    for (const q of a.questionIds) {
      out.push({
        id: a.id,
        jurisdictionKey: a.jurisdictionKey,
        questionId: q,
        answerText: a.answerText,
        answeredOn: a.answeredOn,
        saidBy: a.saidBy,
        channel: a.channel,
        sourceUrl: a.sourceUrl,
      });
    }
  }
  return out;
}

/** Older than `days` (default 365) on `today`. At exactly 365 days it is not. */
export function isStale(answer: Pick<SavedDeptAnswer, 'answeredOn'>, today: string, days: number = STALE_AFTER_DAYS): boolean {
  const n = daysBetween(answer.answeredOn, today);
  return n != null && n > days;
}

/** "J. Smith, plans examiner" · "J. Smith" · "Plans examiner" · "Building department". */
export function saidByLabel(answer: Pick<SavedDeptAnswer, 'saidByName' | 'saidByRole'>): string {
  const name = blankToNull(answer.saidByName);
  const role = blankToNull(answer.saidByRole);
  if (name && role) return `${name}, ${role}`;
  if (name) return name;
  if (role) return role.charAt(0).toUpperCase() + role.slice(1);
  return 'Building department';
}

/** The words for each channel, as the chips and the answer line show them. */
export const CHANNEL_LABELS: Readonly<Record<AnswerChannel, string>> = {
  phone: 'Phone',
  email: 'Email',
  counter: 'At the counter',
  website: 'Website',
  letter: 'Letter',
  other: 'Other',
};

export const STALE_LINE = 'Saved over a year ago. Ask again?';
export const PRIVATE_NOTE = 'Only you can see saved answers.';
