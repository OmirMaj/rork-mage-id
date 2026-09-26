// utils/departmentQuestion.ts — "Draft a question" for the building
// department (NYC first). PURE: no React, no network, no storage, so
// scripts/validate-code-check-honesty.ts can run it under bun.
//
// THE RULES THIS FILE EXISTS TO KEEP
// 1. NOTHING IS SENT. This module only builds a prompt and a routing card; the
//    contractor edits the draft and sends it from his own mail app.
// 2. NO INVENTED RECIPIENT. In NYC the person to ask about a filing is the
//    APPLICANT OF RECORD named on that filing in DOB's public dataset, and the
//    dataset carries no email address — so `toEmail` is null there, always.
//    Outside NYC an email appears only when the department row carries one
//    that was read off the authority's own site.
// 3. THE WHY IS THE ROW'S OWN WORDS. `whyThisChannel` is the verified channel
//    note verbatim (plus the row's applicant-of-record note), never a
//    paraphrase the model or this file wrote.
// 4. THE MODEL ASKS; IT DOES NOT ASSERT. The prompt carries no persona and
//    forbids stating code requirements, fees or legal consequences.

import type { Project } from '@/types';
import type { BuildingRecord, BuildingRecordRow, BuildingRecordSummary } from '@/utils/buildingRecord';
import {
  jobsiteAddressForProject,
  type BuildingDepartment,
  type DepartmentChannel,
  type DepartmentQuestionStage,
} from '@/utils/codeJurisdiction';

/** Where the filing is in its life, read off DOB's status text verbatim. */
export function questionStageFor(filing: BuildingRecordRow | null | undefined): DepartmentQuestionStage {
  if (!filing) return 'pre_filing';
  const s = (filing.status ?? '').trim().toLowerCase();
  if (s.startsWith('pending plan examiner') || s.startsWith('plan examiner')) return 'in_review';
  if (s.includes('objection')) return 'objection';
  if (/\bnot approved\b/.test(s)) return 'general';
  if (s.includes('permit issued') || s.includes('permit entire') || /\bapproved\b/.test(s)) return 'inspection';
  return 'general';
}

/**
 * What MAGE knows about THIS job's DOB NOW filing. Four states, never merged:
 *
 *  - 'not_checked' — no building record, or the filings dataset (w9ak-ipjd)
 *    failed / timed out / is missing. MAGE did not read DOB's filings, so it
 *    says "not checked" and never "none".
 *  - 'none'        — the dataset read cleanly and lists no filing for the BIN.
 *  - 'unmatched'   — the building has filings, but MAGE cannot tie one to this
 *    job. In a multi-tenant building the newest open filing is usually SOMEONE
 *    ELSE'S, so MAGE names no applicant and cites no filing. `reason` says why,
 *    and only 'complete' may be worded as "none matches":
 *      'no_numbers' — the job has no plausible permit number in MAGE to match;
 *      'partial'    — MAGE holds only DOB's latest filings (a truncated page, or
 *                     the server kept only the newest rows) and this job's
 *                     filing is not among them, so it may still exist;
 *      'complete'   — the whole list was read and none matches the job's number.
 *  - 'matched'     — a filing's number equals a permit number of this job, or
 *    one is the other plus '-…' work-type suffixes. Only this state names an
 *    applicant of record, whatever the filing's status (a 'Permit Issued'
 *    filing routes to the inspection channel).
 */
export type JobFilingState = 'not_checked' | 'none' | 'unmatched' | 'matched';
export type UnmatchedReason = 'no_numbers' | 'partial' | 'complete';

export interface JobFiling {
  state: JobFilingState;
  /** Set only when state === 'matched'. */
  filing: BuildingRecordRow | null;
  /** The filings dataset's as-of date when it was read. */
  asOf: string | null;
  /** Set only when state === 'unmatched'. */
  reason?: UnmatchedReason | null;
}

const normNo = (x: string | null | undefined) => (x ?? '').trim().toUpperCase();
/** A DOB job number is 9+ characters; anything under 6 is junk, not a number to match on. */
const MIN_PERMIT_NO = 6;

/** The one filing that is provably this job's, and how sure MAGE is. */
export function jobFilingFor(
  record: BuildingRecord | null | undefined,
  permitNumbers: ReadonlyArray<string | null | undefined>,
): JobFiling {
  const filings = record?.datasets?.find((d) => d.id === 'w9ak-ipjd');
  if (!record || !filings || filings.status !== 'ok') return { state: 'not_checked', filing: null, asOf: null };
  const asOf = filings.asOf ?? null;
  const rows = filings.rows ?? [];
  if (rows.length === 0) {
    // A full page that returned no rows cannot happen; if it ever does, MAGE
    // did not see the whole list and must not say "none".
    return filings.truncated ? { state: 'not_checked', filing: null, asOf } : { state: 'none', filing: null, asOf };
  }
  const wanted = permitNumbers.map(normNo).filter((p) => p.length >= MIN_PERMIT_NO);
  if (wanted.length === 0) return { state: 'unmatched', filing: null, asOf, reason: 'no_numbers' };
  for (const p of wanted) {
    const hit = rows.find((r) => {
      const f = normNo(r.jobFilingNumber ?? r.primary);
      return !!f && (f === p || p.startsWith(`${f}-`) || f.startsWith(`${p}-`));
    });
    if (hit) return { state: 'matched', filing: hit, asOf };
  }
  // 'complete' needs the WHOLE list in hand: an untruncated page AND every row
  // DOB returned passed to the client (the server keeps only the newest few).
  const sawAll = !filings.truncated && typeof filings.returned === 'number' && rows.length >= filings.returned;
  return { state: 'unmatched', filing: null, asOf, reason: sawAll ? 'complete' : 'partial' };
}

export interface QuestionRouting {
  toName: string | null;
  toDetail: string | null;
  toEmail: string | null;
  /** The line the card shows when there is no name to address it to. */
  toFallback: string;
  channel: DepartmentChannel | null;
  whyThisChannel: string;
  filingState: JobFilingState;
  /** Why an 'unmatched' filing is unmatched; null for every other state. */
  filingReason: UnmatchedReason | null;
  /** The matched filing, and only the matched one. */
  filing: BuildingRecordRow | null;
  filingAsOf: string | null;
}

function clean(v: string | null | undefined): string {
  return (v ?? '').trim();
}

const RA_PE = 'address it to your RA/PE or expeditor';

/** Where a question goes when MAGE has no provable filing for the job. */
export function noRecipientLine(state: JobFilingState, nyc: boolean, reason?: UnmatchedReason | null): string {
  if (!nyc) return 'Address it to the building department or your RA/PE.';
  switch (state) {
    case 'not_checked': return `DOB filings not checked — ${RA_PE}`;
    case 'none': return `No DOB NOW filing listed for this building — ${RA_PE}`;
    case 'unmatched':
      // "None matches" only over a complete list AND a real job number.
      if (reason === 'complete') return `No DOB NOW filing on this building matches this job's permit number — ${RA_PE}`;
      if (reason === 'no_numbers') return `This job has no permit number in MAGE to match to a DOB filing — ${RA_PE}`;
      return `MAGE read only DOB's latest filings on this building; none of those is this job's — ${RA_PE}`;
    case 'matched': return `DOB publishes no applicant on this filing — ${RA_PE}`;
  }
}

/**
 * Who the question goes to and through which channel.
 *
 * NYC: `to` is the applicant of record on the filing MATCHED to this job's own
 * permit number (name, title, license and the job filing number, all from the
 * dataset). Any other state names nobody; the card says why, in its own words
 * for each state.
 */
export function routeQuestion(args: {
  department: BuildingDepartment;
  job: JobFiling;
  nyc: boolean;
}): QuestionRouting {
  const { department, nyc, job } = args;
  const filing = job.state === 'matched' ? job.filing : null;
  const stage: DepartmentQuestionStage =
    job.state === 'matched' ? questionStageFor(filing) : job.state === 'none' ? 'pre_filing' : 'general';
  const channels = department.questionChannels ?? [];
  const channel =
    channels.find((c) => c.stage === stage) ??
    channels.find((c) => c.stage === 'general') ??
    null;

  const why = [channel ? channel.note : '', clean(department.applicantOfRecordNote)]
    .filter((s) => s.length > 0)
    .join(' ');
  const base = {
    toFallback: noRecipientLine(job.state, nyc, job.state === 'unmatched' ? job.reason : null),
    channel,
    whyThisChannel: why,
    filingState: job.state,
    filingReason: job.state === 'unmatched' ? (job.reason ?? null) : null,
    filing,
    filingAsOf: job.asOf,
  };

  if (nyc) {
    const name = filing ? clean(filing.applicantName) : '';
    let toDetail: string | null = null;
    if (filing && name) {
      const title = clean(filing.applicantTitle) || 'Applicant of record';
      const license = clean(filing.applicantLicense);
      const filingNo = clean(filing.jobFilingNumber) || clean(filing.primary);
      toDetail = `${title}${license ? ' · license ' + license : ''} on ${filingNo}`;
    }
    return {
      ...base,
      toName: name || null,
      toDetail,
      // DOB's filing datasets publish no applicant email. Never invent one.
      toEmail: null,
    };
  }

  return {
    ...base,
    toName: null,
    toDetail: null,
    toEmail: clean(department.email) || null,
  };
}

/** The prompt's filing fact, one per state. Never "none" for an unread list. */
export function filingFactFor(
  routing: Pick<QuestionRouting, 'filingState' | 'filing' | 'filingAsOf'> & { filingReason?: UnmatchedReason | null },
): string[] {
  const asOf = routing.filingAsOf ? ` (as of ${routing.filingAsOf.slice(0, 10)})` : '';
  switch (routing.filingState) {
    case 'matched': {
      const f = routing.filing;
      return [
        `- Filing number: ${clean(f?.jobFilingNumber) || clean(f?.primary)}`,
        `- Filing status (as published): ${f?.status ?? '(no status published)'}`,
      ];
    }
    case 'none':
      return [`- DOB NOW filings listed for this building: none${asOf}. Older BIS jobs are not in that list.`];
    case 'unmatched':
      if (routing.filingReason === 'complete') {
        return ["- Filing: not identified. DOB lists filings on this building, but none matches this job's permit number, so do not cite or describe any filing."];
      }
      if (routing.filingReason === 'no_numbers') {
        return ["- Filing: not identified. This job has no permit number in MAGE to match to a DOB filing, so do not cite or describe any filing and do not say whether anything has been filed."];
      }
      return ["- Filing: not identified. MAGE read only DOB's latest filings on this building and this job's is not among them, so do not cite or describe any filing and do not say whether anything has been filed."];
    case 'not_checked':
    default:
      return ["- Filing: not checked. MAGE did not read DOB's filings for this job, so do not say whether anything has been filed."];
  }
}

/** Plain-text jobsite address for the prompt. */
function addressLine(project: Project | null | undefined): string {
  const a = jobsiteAddressForProject(project);
  const parts = [a.street, a.city, [a.state, a.zip].filter(Boolean).join(' ')].map((p) => p.trim()).filter(Boolean);
  return parts.join(', ') || clean(project?.location) || '(no address on file)';
}

/** Up to 20 scope line names off the linked estimate. */
function scopeLines(project: Project | null | undefined): string[] {
  const items = project?.linkedEstimate?.items;
  if (!Array.isArray(items)) return [];
  return items
    .map((li) => clean(li?.name))
    .filter((n) => n.length > 0)
    .slice(0, 20);
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
}

/**
 * The prompt for the {subject, body} draft and its cache key.
 *
 * No persona. The model writes only a subject and a body; every job fact is
 * handed to it verbatim (the filing number and status exactly as DOB
 * publishes them) and the building summary block is the same one the card
 * shows.
 */
export function buildQuestionPrompt(args: {
  project: Project | null | undefined;
  routing: QuestionRouting;
  question: string;
  buildingSummary: BuildingRecordSummary | null | undefined;
  bin?: string | null;
  topic?: string | null;
}): { prompt: string; cacheKey: string } {
  const { project, routing, buildingSummary } = args;
  const question = clean(args.question);
  const lines = scopeLines(project);
  const facts: string[] = [
    `- Job: ${clean(project?.name) || '(unnamed job)'}`,
    `- Address: ${addressLine(project)}`,
  ];
  if (clean(args.bin)) facts.push(`- BIN: ${clean(args.bin)}`);
  if (clean(args.topic)) facts.push(`- Topic: ${clean(args.topic)}`);
  if (lines.length) facts.push(`- Scope lines: ${lines.join('; ')}`);
  facts.push(...filingFactFor(routing));
  const recipient = routing.toName
    ? `${routing.toName}${routing.toDetail ? ` (${routing.toDetail})` : ''}`
    : 'the registered design professional or expeditor on the job';
  const block = clean(buildingSummary?.promptBlock);

  const prompt = `Draft a short email from a general contractor asking a question about a construction job.

JOB FACTS
${facts.join('\n')}
${block ? `\n${block}\n` : ''}
The email is addressed to: ${recipient}
The contractor's question, in his own words: ${question}

Return a JSON object with:
- subject: a short subject line naming the job address and the question
- body: the email body, 4-8 sentences, that puts the contractor's question clearly and asks for the answer or the next step

Rules:
- Do not state code requirements, fees or legal consequences. Ask; do not assert. Plain, short, professional.
- Use only the job facts above. Do not invent names, numbers, dates or addresses.
- Do not say whether the job has been filed unless a filing number is given above.
- Leave the sign-off as "[Your name]".`;

  const cacheKey = `dept_question::${hash(prompt)}`;
  return { prompt, cacheKey };
}
