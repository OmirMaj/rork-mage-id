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
// 5. DOB IS NYC ONLY. Every string built for a job outside NYC (Baltimore
//    included) is worded without DOB, and the NYC strings are byte-identical
//    to what they were before Baltimore (scripts/validate-baltimore-ai.ts
//    holds their baseline).

import type { Project } from '@/types';
import type { BuildingRecord, BuildingRecordRow, BuildingRecordSummary } from '@/utils/buildingRecord';
import {
  departmentFor,
  jobsiteAddressForProject,
  resolveCodeJurisdiction,
  type BuildingDepartment,
  type DepartmentChannel,
  type DepartmentQuestionStage,
} from '@/utils/codeJurisdiction';
import { isMdJobsite } from '@/utils/buildingRecord';
import { placeQueryForProject } from '@/utils/permitOffices';

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
  /**
   * The prompt's filing lines, when this routing is not NYC's. Absent on every
   * NYC routing, so the NYC prompt is built exactly as before (filingFactFor).
   */
  filingFacts?: string[];
  /**
   * Who the email is addressed to in the prompt when nobody is named (the
   * office, in the department row's own words). Absent on NYC routings.
   */
  addressedTo?: string;
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
  /** A Baltimore City / Baltimore County job: routes by the contractor's
   *  chosen stage and Baltimore's permits data instead (routeMdQuestion). */
  md?: MdQuestionInput | null;
}): QuestionRouting {
  if (args.md) return routeMdQuestion({ department: args.department, ...args.md });
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
    // Outside NYC nothing here read DOB, so the filing lines never name it.
    filingFacts: neutralFilingFactFor(base),
  };
}

/** The filing lines for a job outside NYC with no Baltimore data: the same
 *  states as filingFactFor, in words that never name DOB. */
export function neutralFilingFactFor(
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
      return [`- Filings listed for this building in the records MAGE read: none${asOf}.`];
    case 'unmatched':
      return ['- Filing: not identified, so do not cite or describe any filing and do not say whether anything has been filed.'];
    case 'not_checked':
    default:
      return ["- Filing: not checked. MAGE did not read the building department's records for this job, so do not say whether anything has been filed."];
  }
}

// ─────────────────────────────────────────────────────────────────────
// Baltimore City and Baltimore County (Maryland)
// ─────────────────────────────────────────────────────────────────────
//
// Separate governments, never merged: Baltimore City's DHCD and Baltimore
// County's PAI each have their own department row (utils/codeJurisdiction.ts)
// and their own permits dataset. The types below are STRUCTURAL copies of the
// fields this file reads off utils/buildingRecord.ts's MdBuildingRecord, so
// this module stays pure and needs nothing new from that file.
//
// What the permits data can and cannot say (both layers' field lists read
// live on 2026-09-28):
//  - Baltimore City, "Housing and Building Permits 2019-Present"
//    https://baltegis.baltimorecity.gov/mapping/rest/services/Housing/DHCD_Open_Baltimore_Datasets/FeatureServer/3?f=json
//    (item https://www.arcgis.com/sharing/rest/content/items/189e6d1c65df4e13b38c0027cee574f6?f=json).
//    Fields: CaseNumber, Description, ExpirationDate, IssuedDate, Address, BLOCKLOT, ... There is NO status field, so a City
//    permit's status is never described. Its applicant/project-name fields are never read by MAGE.
//  - Baltimore County, "Cityworks Permits"
//    https://bcgisdata.baltimorecountymd.gov/arcgis/rest/services/DevelopmentManagement/ActiveDevelopment/MapServer/4?f=json
//    Has STATUS; distinct values read live 2026-09-28: EXPIRED, CANCELLED, CLOSED, OPEN, BL-EXPIRED, ISSUE. Shown raw, as the
//    County publishes it, never interpreted.
// Neither dataset publishes an applicant MAGE may show, so no Baltimore
// routing ever names a person: it names the office.
// The stage is the CONTRACTOR'S choice. Nothing here infers it from a permit
// (City data has no status; County STATUS is not a review stage).

export type MdSideLike = 'baltimore_city' | 'baltimore_county';

/** The fields of utils/buildingRecord.ts MdPermitRow this file reads. */
export interface MdPermitLike {
  number: string;
  issued: string | null;
  status: string | null;
}

/** The fields of MdBuildingRecord['permits'] this file reads. */
export interface MdPermitsRead {
  status: 'ok' | 'failed' | 'timeout';
  asOf: string | null;
  truncated: boolean;
}

export type MdFilingState = 'matched' | 'unmatched' | 'no_number' | 'not_checked';

/** Which government, in the words the prompt and card use. */
export function mdSideName(side: MdSideLike): string {
  return side === 'baltimore_city' ? 'Baltimore City' : 'Baltimore County';
}

/** The permits dataset MAGE reads for a side, as the prompt names it. */
export function mdPermitsSourceFor(side: MdSideLike): string {
  return side === 'baltimore_city'
    ? "Baltimore City's permits open data (2019 to present)"
    : "Baltimore County's permits open data";
}

const mdNorm = (x: string | null | undefined) => (x ?? '').toUpperCase().replace(/[\s-]+/g, '');

/** True when the job has at least one permit number worth matching. */
export function mdHasPermitNumber(permitNumbers: ReadonlyArray<string | null | undefined>): boolean {
  return permitNumbers.some((n) => mdNorm(n).length >= MIN_PERMIT_NO);
}

/**
 * What MAGE knows about THIS job's Baltimore permit. `match` is the row the
 * caller matched with utils/buildingRecord.ts mdPermitForNumber (which
 * already returns null for a permits read that is not 'ok').
 *  - not_checked: the record was not loaded, or the permits read failed or
 *    timed out. Never "none".
 *  - matched:     a permit row is this job's.
 *  - no_number:   the job has no permit number in MAGE to match.
 *  - unmatched:   the list was read and none of it is this job's.
 */
export function mdFilingStateFor(args: {
  permits: MdPermitsRead | null | undefined;
  permitNumbers: ReadonlyArray<string | null | undefined>;
  match: MdPermitLike | null | undefined;
}): MdFilingState {
  if (!args.permits || args.permits.status !== 'ok') return 'not_checked';
  if (args.match) return 'matched';
  if (!mdHasPermitNumber(args.permitNumbers)) return 'no_number';
  return 'unmatched';
}

/** The prompt's filing line for a Baltimore job, one per state. The City line
 *  never describes a permit's status: the City publishes none. */
export function mdFilingFactFor(args: {
  state: MdFilingState;
  side: MdSideLike;
  match: MdPermitLike | null | undefined;
  asOf: string | null | undefined;
  truncated?: boolean;
}): string {
  const source = mdPermitsSourceFor(args.side);
  const asOf = clean(args.asOf).slice(0, 10);
  const asOfText = asOf ? `as of ${asOf}` : 'as-of date not published';
  switch (args.state) {
    case 'matched': {
      const m = args.match;
      const number = clean(m?.number);
      const issued = clean(m?.issued).slice(0, 10);
      const issuedText = issued ? `issued ${issued}` : 'with no issue date published';
      const statusText = args.side === 'baltimore_county'
        ? (clean(m?.status)
          ? `Status '${clean(m?.status)}' as the County publishes it.`
          : 'The County publishes no status on this permit, so do not describe its status.')
        : "The City's open data does not publish permit status, so do not describe the permit's status.";
      return `- Filing: permit ${number} ${issuedText} in ${mdSideName(args.side)} open data (${asOfText}). ${statusText}`;
    }
    case 'unmatched':
      if (args.truncated) {
        return `- Filing: not identified. MAGE read only the newest permits listed for this address in ${source} and none of those is this job's, so do not cite or describe any filing and do not say whether anything has been filed.`;
      }
      return `- Filing: not identified. None of the permits listed for this address in ${source} (${asOfText}) matches this job's permit number, so do not cite or describe any filing.`;
    case 'no_number':
      return '- Filing: not identified. This job has no permit number in MAGE, so do not cite or describe any filing.';
    case 'not_checked':
    default:
      return `- Filing: not checked. MAGE did not read ${source} for this job, so do not say whether anything has been filed.`;
  }
}

/** Who a Baltimore question goes to when nobody can be named: the office.
 *  It never claims the data has no applicant: the City's permits layer does
 *  carry a permit name and the County's an initiator and contractor. MAGE
 *  simply never copies a person's name out of it. */
export function mdNoRecipientLine(side: MdSideLike, officeLabel: string | null | undefined): string {
  const office = clean(officeLabel) || 'building department';
  return `No person is named here: MAGE does not copy names from ${mdPermitsSourceFor(side)}. Ask the ${mdSideName(side)} ${office} directly.`;
}

export interface MdQuestionInput {
  side: MdSideLike;
  /** The authority's name as the department row gives it. */
  authorityName: string;
  /** The office the contractor picked, by its channel label. A department
   *  row can list several channels for one stage (Baltimore City has four
   *  'general' ones: Zoning, CHAP, Planning, Fire Marshal), so the pick is the
   *  label, not the stage. Never inferred from a permit. */
  channelLabel?: string | null;
  /** Used only when no channelLabel matches: the first channel of this stage. */
  stage?: DepartmentQuestionStage | null;
  filingState: MdFilingState;
  match: MdPermitLike | null | undefined;
  permitsAsOf: string | null | undefined;
  permitsTruncated?: boolean;
}

/** The channels a contractor can put a question to: the ones with a phone
 *  or an email. A reference link (Baltimore City's "Work exempt from permit"
 *  list) is a channel in the row but not an office. */
export function mdOfficeChannels(department: BuildingDepartment): DepartmentChannel[] {
  return (department.questionChannels ?? []).filter((c) => !!clean(c.email) || !!clean(c.phone));
}

/**
 * Routing for a Baltimore City or Baltimore County job: the office the
 * contractor picked (else the first office for the stage, else a general
 * one), that office's own email, and never a person's name. An office with
 * no email gets none: MAGE never sends a zoning question to the permits desk
 * because that desk has an address. The department's email is used only when
 * the row has no office channel at all.
 */
export function routeMdQuestion(args: MdQuestionInput & { department: BuildingDepartment }): QuestionRouting {
  const { department } = args;
  const channels = mdOfficeChannels(department);
  const picked = clean(args.channelLabel);
  const channel =
    (picked ? channels.find((c) => c.label === picked) : undefined) ??
    (args.stage ? channels.find((c) => c.stage === args.stage) : undefined) ??
    channels.find((c) => c.stage === 'general') ??
    channels[0] ??
    null;
  const why = [channel ? channel.note : '', clean(department.applicantOfRecordNote)]
    .filter((s) => s.length > 0)
    .join(' ');
  const office = channel?.label ?? null;
  const authority = clean(args.authorityName) || mdSideName(args.side);
  const jobState: JobFilingState =
    args.filingState === 'matched' ? 'matched' : args.filingState === 'not_checked' ? 'not_checked' : 'unmatched';
  const reason: UnmatchedReason | null =
    args.filingState === 'no_number' ? 'no_numbers'
      : args.filingState === 'unmatched' ? (args.permitsTruncated ? 'partial' : 'complete')
        : null;
  return {
    toName: null,
    toDetail: null,
    toEmail: channel ? (clean(channel.email) || null) : (clean(department.email) || null),
    toFallback: mdNoRecipientLine(args.side, office),
    channel,
    whyThisChannel: why,
    filingState: jobState,
    filingReason: reason,
    filing: null,
    filingAsOf: clean(args.permitsAsOf) || null,
    filingFacts: [mdFilingFactFor({
      state: args.filingState, side: args.side, match: args.match,
      asOf: args.permitsAsOf, truncated: args.permitsTruncated,
    })],
    addressedTo: office ? `the ${office} at ${authority}` : authority,
  };
}

/** The prompt's filing fact, one per state. Never "none" for an unread list.
 *  A routing built outside NYC carries its own lines (no DOB wording); those
 *  win. NYC routings carry none, so their lines are exactly as before. */
export function filingFactFor(
  routing: Pick<QuestionRouting, 'filingState' | 'filing' | 'filingAsOf'> & {
    filingReason?: UnmatchedReason | null;
    filingFacts?: string[];
  },
): string[] {
  if (routing.filingFacts) return [...routing.filingFacts];
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
  // NYC routings carry no filingFacts / addressedTo, so they build exactly as before.
  facts.push(...filingFactFor(routing));
  const recipient = routing.toName
    ? `${routing.toName}${routing.toDetail ? ` (${routing.toDetail})` : ''}`
    : routing.addressedTo ?? 'the registered design professional or expeditor on the job';
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

// ─────────────────────────────────────────────────────────────────────
// New York, New Jersey and Connecticut towns (code cards, lane CCWIRE)
// ─────────────────────────────────────────────────────────────────────
//
// Outside New York City and Maryland the office comes from
// utils/permitOffices.ts permitOfficeFor(): a hand-verified Long Island /
// Westchester card, the NJ DCA roster, the CT DAS list, or a NAME-ONLY card
// (the name from Census geography, nothing else verified). The same rules as
// above hold, word for word:
//   - NOTHING IS SENT. The routing only fills the draft; he sends it from his
//     own Mail.
//   - NO INVENTED RECIPIENT. No person is ever named (none of those lists names
//     one MAGE may show). An email appears only when the office row carries
//     one; a name-only office has none, and the card says MAGE hasn't verified
//     its contact details.
//   - THE WHY IS THE ROW'S OWN WORDS: the row's own source label, or the fixed
//     name-only note.
//   - NO FILING CLAIM. MAGE reads no town's permit records, so the prompt says
//     "not checked" and forbids saying whether anything has been filed.

/** The fields of utils/permitOffices.ts PermitOffice this file reads. */
export interface TownOfficeLike {
  title: string;
  jurisdiction: string;
  email: string | null;
  phone: string | null;
  verification: 'hand-verified' | 'state-list' | 'name-only';
  sourceLabel: string;
}

/** The fixed line a name-only office shows (utils/permitOffices NAME_ONLY_NOTE, verbatim). */
export const TOWN_NAME_ONLY_NOTE = "Derived from Census geography; MAGE hasn't verified this office's contact details.";

/** The prompt's filing line for a town job: MAGE never reads a town's permits. */
export const TOWN_FILING_FACT =
  "- Filing: not checked. MAGE did not read this town's permit records, so do not say whether anything has been filed.";

/**
 * Routing for a NY / NJ / CT town office. Never names a person; the office's
 * own email only when the row carries one; the why in the row's own words.
 */
export function routeOfficeQuestion(office: TownOfficeLike): QuestionRouting {
  const named = clean(office.title) || clean(office.jurisdiction);
  const title = named || 'building department';
  const nameOnly = office.verification === 'name-only';
  return {
    toName: null,
    toDetail: null,
    toEmail: nameOnly ? null : (clean(office.email) || null),
    toFallback: nameOnly
      ? `Address it to the ${title}. MAGE hasn't verified this office's contact details, so look up their email before you send.`
      : `Address it to the ${title}.`,
    channel: null,
    whyThisChannel: nameOnly ? TOWN_NAME_ONLY_NOTE : `From ${clean(office.sourceLabel) || 'the office list'}.`,
    filingState: 'not_checked',
    filingReason: null,
    filing: null,
    filingAsOf: null,
    filingFacts: [TOWN_FILING_FACT],
    addressedTo: named || 'the building department',
  };
}

/**
 * Which "Draft a question" a job gets, decided from its address alone (pure,
 * synchronous, so a code card can say why Ask town is blocked BEFORE any
 * lookup runs):
 *   'md'   — a Maryland job (MdDraftQuestion, which opens from its own button);
 *   'nyc'  — a verified department row (New York City);
 *   'town' — any other New York, New Jersey or Connecticut job with an address
 *            (the place lookup then names the office);
 *   null   — no job, or a job outside those states, or no address.
 */
export type AskTownKind = 'md' | 'nyc' | 'town';
export function askTownKind(project: (Parameters<typeof placeQueryForProject>[0]) | null | undefined): AskTownKind | null {
  if (!project) return null;
  const addr = jobsiteAddressForProject(project);
  if (isMdJobsite(addr)) return 'md';
  if (departmentFor(resolveCodeJurisdiction(addr))) return 'nyc';
  const q = placeQueryForProject(project);
  if (q && q.state !== 'MD') return 'town';
  return null;
}

/** Why Ask town is blocked for this job, or null when it can open. Every
 *  blocked button says why. */
export function askTownBlockedReason(project: (Parameters<typeof placeQueryForProject>[0]) | null | undefined): string | null {
  if (!project) return 'Link a project first. The question goes to that project’s town.';
  const kind = askTownKind(project);
  if (kind === 'md') return 'For a Maryland project, use Draft a question on its permit card.';
  if (!kind) return 'Draft a question works for New York, New Jersey and Connecticut projects with an address.';
  return null;
}

/**
 * The question a code card pre-fills, in MAGE's own words: the card's summary
 * (our paraphrase, already echo-checked), its section and the edition, and
 * the ask. Never any code text. He edits it before anything is drafted.
 *
 *  - `noWords`: the card has no requirement in words (its line was withheld or
 *    missing), so the question asks what the section requires instead of
 *    repeating MAGE's stand-in line.
 *  - The "AI recall" sentence is said only when the section IS recall: a card
 *    whose evidence is a government rung ('amended' / 'named') does not say it.
 */
export function codeCardQuestion(
  item: { summary: string; section: string; citedEdition?: string | null; evidence?: { rung: string } | null },
  opts: { noWords?: boolean } = {},
): string {
  const ref = [clean(item.citedEdition), clean(item.section)].filter(Boolean).join(' ');
  const summary = opts.noWords ? '' : clean(item.summary).replace(/[.\s]+$/, '');
  const government = item.evidence?.rung === 'amended' || item.evidence?.rung === 'named';
  const ask = summary
    ? `Does this apply here, and does the town amend it? ${summary}${ref ? ` (${ref})` : ''}.`
    : ref
      ? `What does ${ref} require here, and does the town amend it?`
      : 'Which code section covers this work here, and does the town amend it?';
  const confirm = government
    ? 'Can you confirm the section and edition you enforce?'
    : 'MAGE marked the section as AI recall. Can you confirm the section and edition you enforce?';
  return `${ask} ${confirm}`;
}
