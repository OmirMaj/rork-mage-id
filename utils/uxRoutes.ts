// ============================================================================
// utils/uxRoutes.ts — the route-param contract for the UX wave (Lane 0).
//
// Every door below is SENT by one lane and RECEIVED by another, so the param
// names are fixed here, once, and both sides import this file. A sender builds
// its href with the function; a receiver reads its flag with readFlag /
// readParam. Nobody spells '?new=1' by hand.
//
//   route + params                             receiver (lane)  sender (lane)          effect
//   /punch-list?projectId&new=1                B                D (CreateMenu, job)    opens the Add form
//   /deliveries?projectId&arrived=1            B                D (CreateMenu), B scan opens "It's here now"
//   /time-tracking?projectId&clockIn=1         B                D (job page, Create)   opens the crew sheet on that job
//   /tomorrow-lineup?projectId                 B (exists)       D, B (TodayView)       none; gated on schedule_gantt_pdf
//   /(tabs)/construction-ai?projectId&source=project
//                                              B (parses source) B (CodeChecksCard), D hides Bid Advisor; Back → job
//   /(tabs)/schedule?projectId&from=job        D                D                      Back reads "< <Job>" → job
//   /photo-triage?projectId                    (exists)         D (job Photo action)   none
//   /invoice?projectId&milestoneId&...         C (exists)       C (NextStepHero), D    bills that contract milestone
//   /sub-portal-setup?projectId&subId          C (exists)       D (Subs & pay, Create) none
//
// A flag is ON only when the param is exactly '1'. Anything else ('true',
// '0', '', an array whose first value is not '1') is off, so a stale or
// hand-typed URL never opens a sheet by surprise.
//
// Tier / role gates are NOT encoded here: a door checks the same
// useTierAccess gate as its destination (the lineup is schedule_gantt_pdf,
// the portal is client_portal) and the field role never sees a money door.
//
// Pure: no expo-router value import (bun crashes on those). The pathnames are
// literal types, so expo-router's typed routes check them at the call site
// when the result is passed to router.push.
// ============================================================================

/** The param names, one place. */
export const UX_PARAM = {
  projectId: 'projectId',
  newItem: 'new',
  arrived: 'arrived',
  clockIn: 'clockIn',
  source: 'source',
  from: 'from',
  milestoneId: 'milestoneId',
  subId: 'subId',
} as const;

/** The value of `source` a job page sends to the code-check screen. */
export const SOURCE_PROJECT = 'project';
/** The value of `from` a job page sends to the schedule tab. */
export const FROM_JOB = 'job';

type RawParam = string | string[] | undefined | null;

/** The first value of a search param, trimmed; null when absent or blank. */
export function readParam(v: RawParam): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t.length > 0 ? t : null;
}

/** True only when the param is exactly '1'. */
export function readFlag(v: RawParam): boolean {
  return readParam(v) === '1';
}

// ── Senders ─────────────────────────────────────────────────────────────────

export function punchListNewHref(projectId: string) {
  return { pathname: '/punch-list' as const, params: { projectId, new: '1' } };
}

export function deliveryArrivedHref(projectId: string) {
  return { pathname: '/deliveries' as const, params: { projectId, arrived: '1' } };
}

export function clockInHref(projectId: string) {
  return { pathname: '/time-tracking' as const, params: { projectId, clockIn: '1' } };
}

export function tomorrowLineupHref(projectId: string) {
  return { pathname: '/tomorrow-lineup' as const, params: { projectId } };
}

export function codeCheckFromJobHref(projectId: string) {
  return { pathname: '/(tabs)/construction-ai' as const, params: { projectId, source: SOURCE_PROJECT } };
}

export function scheduleFromJobHref(projectId: string) {
  return { pathname: '/(tabs)/schedule' as const, params: { projectId, from: FROM_JOB } };
}

export function photoTriageHref(projectId: string) {
  return { pathname: '/photo-triage' as const, params: { projectId } };
}

export function subPortalSetupHref(projectId: string, subId: string) {
  return { pathname: '/sub-portal-setup' as const, params: { projectId, subId } };
}

/**
 * Bill one contract milestone — the exact params contract.tsx's "Create
 * invoice" row sends (its handler beside the payment schedule). The line, the
 * note and the terms come from billingFlowCore.milestoneBillEffect; this
 * builder derives no amount of its own.
 */
export interface MilestoneInvoiceInput {
  projectId: string;
  contractId: string;
  milestoneId: string;
  /** effect.line — serialized as a one-element prefillLines array. */
  line: unknown;
  /** effect.note */
  note: string;
  /** effect.terms, when the signed contract decided them. */
  terms?: string | null;
  /** The milestone's trigger, sent only alongside terms. */
  trigger?: string | null;
  /** effect.depositNoRetainage */
  depositNoRetainage?: boolean;
}

export function invoiceForMilestoneHref(i: MilestoneInvoiceInput) {
  const params: Record<string, string> = {
    projectId: i.projectId,
    type: 'quick',
    prefillLines: JSON.stringify([i.line]),
    prefillNotes: i.note,
    milestoneId: i.milestoneId,
    contractId: i.contractId,
  };
  if (i.terms) {
    params.contractTerms = i.terms;
    if (i.trigger) params.milestoneTrigger = i.trigger;
  }
  if (i.depositNoRetainage) params.depositNoRetainage = '1';
  return { pathname: '/invoice' as const, params };
}

// ── Receivers ───────────────────────────────────────────────────────────────

export interface UxDoorParams {
  projectId: string | null;
  /** /punch-list: open the Add form. */
  openNew: boolean;
  /** /deliveries: open "It's here now". */
  openArrived: boolean;
  /** /time-tracking: open the crew clock-in sheet. */
  openClockIn: boolean;
  /** /(tabs)/construction-ai: the raw `source` ('project', 'punch',
   *  'plan_sheet' — the screen already parses all three). Any value means
   *  it was opened from a job's record. */
  source: string | null;
  /** /(tabs)/construction-ai: source === 'project' (the job page's door). */
  fromProjectSource: boolean;
  /** /(tabs)/schedule: opened from a job (Back → job). */
  fromJob: boolean;
}

/** Read every UX door param from a screen's search params in one call. */
export function readUxDoorParams(p: Record<string, RawParam>): UxDoorParams {
  return {
    projectId: readParam(p[UX_PARAM.projectId]),
    openNew: readFlag(p[UX_PARAM.newItem]),
    openArrived: readFlag(p[UX_PARAM.arrived]),
    openClockIn: readFlag(p[UX_PARAM.clockIn]),
    source: readParam(p[UX_PARAM.source]),
    fromProjectSource: readParam(p[UX_PARAM.source]) === SOURCE_PROJECT,
    fromJob: readParam(p[UX_PARAM.from]) === FROM_JOB,
  };
}
