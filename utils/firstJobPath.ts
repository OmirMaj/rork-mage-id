// utils/firstJobPath.ts — the rules behind "Your First Job", the interactive
// path on Home that replaces the old "Get up and running" starter card.
//
// PURE: no React, no React Native, no storage, no network. Everything the card
// decides lives here so scripts/validate-first-job-path.ts can run every rule
// under bun: the step list, the order an answer gives, what counts as done,
// which one step is open, the stage pills, progress, and the hide / remove /
// finish rules. components/FirstJobPath.tsx only draws what this returns.
//
// THE RULES, IN ONE PLACE
//   1. Seven steps, always all seven, each exactly once. The opening question
//      only moves ONE step to the front; the rest keep the usual order. Add
//      Your Prices is always ahead of Price Your First Job, because an estimate
//      priced from his own numbers is the moment the app counts as activation
//      (utils/activationSignals: estimate_generated with used_learned_costs).
//   2. A step is done ONLY when the account's real data says so. Nothing here
//      takes a tap as proof. A signal the app has not been able to read yet is
//      `undefined` ("not known"), which is never shown as done and never as
//      "you have not done this".
//   3. Stripe is not a step. It is a side note under the invoice step.
//   4. One step is open at a time: the first one still to do, or the one he
//      tapped.
//   5. Skip is per step. Hide collapses the card to one row. Remove takes it
//      away for good. When every step is done or skipped the finish state
//      shows once, then the card is gone.
//   6. An account that already did most of this before it ever answered the
//      question is established and never sees the card.

import type { FeatureKey } from '@/utils/featureTiers';
import { REQUIRED_TIER } from '@/utils/featureTiers';
import type { TutorialDefs, TutorialId, TutorialPersona, TutorialProgress } from '@/utils/tutorial/types';
import { TUTORIAL_DEFS } from '@/utils/tutorial/defs';
import { tutorialsForUser } from '@/utils/tutorial/offers';
import { missingTierFor } from '@/utils/tutorial/entryPoints';
import { countsTowardFreeCap } from '@/utils/projectCap';

// ── Steps, stages, answers ──────────────────────────────────────────────────

export type FirstJobStepId = 'company' | 'prices' | 'estimate' | 'send' | 'schedule' | 'daily' | 'invoice';
export type FirstJobStage = 'win' | 'plan' | 'build' | 'paid';
export type FirstJobFinishStage = FirstJobStage | 'close';
export type FirstJobAnswer = 'price' | 'schedule' | 'bill' | 'site' | 'unsure';

/** The order of a real job. This is the order "Not Sure" gives. */
export const USUAL_ORDER: readonly FirstJobStepId[] = [
  'company', 'prices', 'estimate', 'send', 'schedule', 'daily', 'invoice',
];

export const STAGE_ORDER: readonly FirstJobStage[] = ['win', 'plan', 'build', 'paid'];
/** The finish state names all five stages of a job; the path itself ends at Get Paid. */
export const FINISH_STAGES: readonly FirstJobFinishStage[] = ['win', 'plan', 'build', 'paid', 'close'];

export const ANSWERS: readonly FirstJobAnswer[] = ['price', 'schedule', 'bill', 'site', 'unsure'];

/** The ONE step an answer brings to the front. `null` keeps the usual order. */
export const ANSWER_LEAD: Record<FirstJobAnswer, FirstJobStepId | null> = {
  // Pricing starts with his own prices, never with the estimate itself: that
  // is what keeps rule 1 true for the answer most people pick.
  price: 'prices',
  schedule: 'schedule',
  bill: 'invoice',
  site: 'daily',
  unsure: null,
};

export interface FirstJobStepMeta {
  stage: FirstJobStage;
  /** The guided tutorial behind "Show Me First", or null when none exists. */
  tutorial: TutorialId | null;
  /** The paid feature the step's real screen opens behind, or null when it is free. */
  gate: FeatureKey | null;
  /** The step's screen has the AI write a first draft the person must check. */
  ai: boolean;
  /** The step happens inside a project, so it cannot start before one exists. */
  needsProject: boolean;
}

export const STEP_META: Record<FirstJobStepId, FirstJobStepMeta> = {
  company: { stage: 'win', tutorial: null, gate: null, ai: false, needsProject: false },
  // app/cost-seed.tsx opens behind job_costing (Pro). The welcome flow's paste
  // step is free, which is why many accounts arrive with this already done.
  prices: { stage: 'win', tutorial: null, gate: 'job_costing', ai: false, needsProject: false },
  // A free plan gets a small lifetime number of AI estimates
  // (utils/aiRateLimiter); the card shows the count that is left.
  estimate: { stage: 'win', tutorial: 'estimate-first', gate: 'ai_estimate_wizard', ai: true, needsProject: false },
  // The proposal / contract screen opens behind client_portal (Pro). Sharing
  // the estimate PDF is free and counts too.
  send: { stage: 'win', tutorial: 'contract-from-estimate', gate: 'client_portal', ai: false, needsProject: true },
  schedule: { stage: 'plan', tutorial: 'schedule-say-it', gate: null, ai: true, needsProject: true },
  daily: { stage: 'build', tutorial: 'daily-report-voice', gate: null, ai: false, needsProject: true },
  invoice: { stage: 'paid', tutorial: 'invoice-to-self', gate: 'change_orders_invoicing', ai: false, needsProject: true },
};

export const TOTAL_STEPS = USUAL_ORDER.length;

/**
 * An account that has never answered the question and already has this many
 * steps done is established: the card is not for it. The old card used 4 of 5;
 * 5 of 7 is the same share, rounded down.
 */
export const ESTABLISHED_AT_DONE = 5;

/** All seven steps, each once, with the answer's one step moved to the front. */
export function orderFor(answer: FirstJobAnswer | null | undefined): FirstJobStepId[] {
  const lead = answer ? ANSWER_LEAD[answer] ?? null : null;
  if (!lead) return [...USUAL_ORDER];
  return [lead, ...USUAL_ORDER.filter((s) => s !== lead)];
}

export function isStepId(v: unknown): v is FirstJobStepId {
  return typeof v === 'string' && (USUAL_ORDER as readonly string[]).includes(v);
}
export function isAnswer(v: unknown): v is FirstJobAnswer {
  return typeof v === 'string' && (ANSWERS as readonly string[]).includes(v);
}

// ── Done comes only from data ───────────────────────────────────────────────

/** true = the data says done. false = the data says not done. undefined = not known yet. */
export type FirstJobSignals = Record<FirstJobStepId, boolean | undefined>;

/**
 * What Home knows about the account. Counts are over REAL work only: owned,
 * non-sample projects (utils/projectCap), exactly as the old card counted. A
 * sample job never ticks a step. There is no field in here that a tap on the
 * card can set.
 */
export interface FirstJobData {
  settingsLoaded: boolean;
  /** settings.branding.companyName as typed. */
  companyName: string | null | undefined;
  /** The seeded-rate query has answered. */
  pricesLoaded: boolean;
  /** Live (not deleted) prices he stated, from hooks/useCostSeeds. */
  priceCount: number;
  projectsLoaded: boolean;
  /** Owned, non-sample projects. */
  realProjectCount: number;
  /** Of those, how many carry an estimate with lines or a total. */
  estimateCount: number;
  /** Of those, how many carry the stamp the estimate wizard writes when its PDF is shared. */
  sharedEstimateCount: number;
  /** The proposal / contract read: answered, failed, or still out. */
  contractsRead: 'ok' | 'failed' | 'loading';
  /** Of his real projects, how many have a proposal or contract that left draft (sent or signed). */
  sentContractCount: number;
  /** The local "an estimate left this phone" mark: true, false, or undefined while it is being read. */
  sentMarker: boolean | undefined;
  /** Of his real projects, how many have a schedule with at least one task. */
  scheduleCount: number;
  dailyReportsLoaded: boolean;
  /** Daily reports saved on his real projects. */
  dailyReportCount: number;
  invoicesLoaded: boolean;
  /** Invoices on his real projects. */
  invoiceCount: number;
}

function known(loaded: boolean, done: boolean): boolean | undefined {
  if (done) return true;
  return loaded ? false : undefined;
}

export function signalsFromData(d: FirstJobData): FirstJobSignals {
  const sentPositive = d.sharedEstimateCount > 0 || d.sentContractCount > 0 || d.sentMarker === true;
  // "Not sent" is only an answer when every place a send can leave a mark has
  // been read. A failed proposal read (no signal on site) is not "not sent".
  const sentAllRead = d.projectsLoaded && d.contractsRead === 'ok' && d.sentMarker !== undefined;
  return {
    company: known(d.settingsLoaded, !!(d.companyName ?? '').trim()),
    prices: known(d.pricesLoaded, d.priceCount > 0),
    estimate: known(d.projectsLoaded, d.projectsLoaded && d.estimateCount > 0),
    send: sentPositive ? true : sentAllRead ? false : undefined,
    schedule: known(d.projectsLoaded, d.projectsLoaded && d.scheduleCount > 0),
    daily: known(d.dailyReportsLoaded && d.projectsLoaded, d.dailyReportsLoaded && d.projectsLoaded && d.dailyReportCount > 0),
    // Never done without a real project to hold it: seeded sample invoices
    // used to tick this (audit wave 5, #155).
    invoice: known(d.invoicesLoaded && d.projectsLoaded, d.invoicesLoaded && d.projectsLoaded && d.invoiceCount > 0 && d.realProjectCount > 0),
  };
}

export function doneCount(signals: FirstJobSignals): number {
  let n = 0;
  for (const id of USUAL_ORDER) if (signals[id] === true) n += 1;
  return n;
}

// ── Whose share counts ──────────────────────────────────────────────────────

/** The two fields of a project that say whose it is and whether it is a sample. */
export interface FirstJobSharedProject { name: string; ownerUserId?: string }

/**
 * Does a share that just succeeded count as "Send It To Your Client" for
 * `userId`? Only for his own work: a project he owns that is not a sample
 * (utils/projectCap.countsTowardFreeCap, the same test every other step's
 * count uses), or `null`, which means the estimate he built on this phone
 * with no project attached. An estimate shared from a job another contractor
 * invited him to is that contractor's work and ticks nothing. Nobody signed
 * in: nothing.
 */
export function estimateSentCounts(
  project: FirstJobSharedProject | null,
  userId: string | null | undefined,
): boolean {
  if (!userId) return false;
  if (project === null) return true;
  return countsTowardFreeCap(project, userId);
}

// ── What the card remembers ─────────────────────────────────────────────────

export interface FirstJobStored {
  v: 1;
  /** null until he answers the opening question. */
  answer: FirstJobAnswer | null;
  skipped: FirstJobStepId[];
  /** Collapsed to the one small row. */
  hidden: boolean;
  /** Taken away for good. */
  removed: boolean;
  /** The finish state has been on screen once. */
  finishShown: boolean;
}

export const EMPTY_STORED: FirstJobStored = {
  v: 1, answer: null, skipped: [], hidden: false, removed: false, finishShown: false,
};

/**
 * What a first read gives. Someone who closed the OLD starter card asked for
 * it to go away, so the new one starts as the one small row for him and never
 * as a full card he has to close a second time.
 */
export function initialStored(legacyDismissed: boolean): FirstJobStored {
  return { ...EMPTY_STORED, hidden: legacyDismissed };
}

/** Read what was saved. Anything unreadable is treated as nothing saved. */
export function parseStored(raw: string | null | undefined, legacyDismissed = false): FirstJobStored {
  if (!raw) return initialStored(legacyDismissed);
  try {
    const o = JSON.parse(raw) as Partial<FirstJobStored> | null;
    if (!o || typeof o !== 'object') return initialStored(legacyDismissed);
    const skipped: FirstJobStepId[] = [];
    for (const s of Array.isArray(o.skipped) ? o.skipped : []) {
      if (isStepId(s) && !skipped.includes(s)) skipped.push(s);
    }
    return {
      v: 1,
      answer: isAnswer(o.answer) ? o.answer : null,
      skipped,
      hidden: o.hidden === true,
      removed: o.removed === true,
      finishShown: o.finishShown === true,
    };
  } catch {
    return initialStored(legacyDismissed);
  }
}

export function serializeStored(s: FirstJobStored): string {
  return JSON.stringify({
    v: 1, answer: s.answer, skipped: s.skipped, hidden: s.hidden, removed: s.removed, finishShown: s.finishShown,
  });
}

export function answerQuestion(s: FirstJobStored, answer: FirstJobAnswer): FirstJobStored {
  return { ...s, answer };
}
export function skipStep(s: FirstJobStored, id: FirstJobStepId): FirstJobStored {
  return s.skipped.includes(id) ? s : { ...s, skipped: [...s.skipped, id] };
}
/** Tapping a skipped step brings it back. */
export function unskipStep(s: FirstJobStored, id: FirstJobStepId): FirstJobStored {
  return s.skipped.includes(id) ? { ...s, skipped: s.skipped.filter((x) => x !== id) } : s;
}
export function hidePath(s: FirstJobStored): FirstJobStored {
  return { ...s, hidden: true };
}
export function showPath(s: FirstJobStored): FirstJobStored {
  return { ...s, hidden: false };
}
export function removePath(s: FirstJobStored): FirstJobStored {
  return { ...s, removed: true, hidden: false };
}
export function markFinishShown(s: FirstJobStored): FirstJobStored {
  return { ...s, finishShown: true };
}

// ── What the card shows ─────────────────────────────────────────────────────

export type FirstJobStepStatus = 'done' | 'skipped' | 'todo';

export interface FirstJobStepView {
  id: FirstJobStepId;
  stage: FirstJobStage;
  status: FirstJobStepStatus;
  /** False while the app cannot tell whether the step is done. */
  known: boolean;
  open: boolean;
  /** 1-based place in this account's order. */
  position: number;
}

export type FirstJobStageState = 'done' | 'now' | 'later';
export interface FirstJobStageView { stage: FirstJobStage; state: FirstJobStageState }

export type FirstJobView =
  | { kind: 'none'; reason: 'removed' | 'established' | 'finished' | 'hidden-complete' | 'loading' }
  | { kind: 'question'; done: number; total: number }
  | { kind: 'hidden'; done: number; total: number }
  | {
      kind: 'path';
      steps: FirstJobStepView[];
      /** The one open step. */
      openId: FirstJobStepId;
      /** The first step still to do, in order: what "Next" names. */
      nextId: FirstJobStepId;
      done: number;
      total: number;
      /** How many nodes from the top are done in an unbroken run: how far the line is filled. */
      filled: number;
      stages: FirstJobStageView[];
    }
  | { kind: 'finish'; done: number; skipped: number; total: number };

export interface BuildViewOpts {
  /** The step he tapped open, if any. Ignored when that step is done. */
  selected?: FirstJobStepId | null;
  /** The finish state went up during THIS visit, so it stays until he leaves. */
  finishLive?: boolean;
}

export function stepStatus(id: FirstJobStepId, stored: FirstJobStored, signals: FirstJobSignals): FirstJobStepStatus {
  if (signals[id] === true) return 'done';
  return stored.skipped.includes(id) ? 'skipped' : 'todo';
}

/** Every step is done or skipped. */
export function allResolved(stored: FirstJobStored, signals: FirstJobSignals): boolean {
  return USUAL_ORDER.every((id) => stepStatus(id, stored, signals) !== 'todo');
}

export function buildView(stored: FirstJobStored, signals: FirstJobSignals, opts: BuildViewOpts = {}): FirstJobView {
  const total = TOTAL_STEPS;
  const done = doneCount(signals);
  if (stored.removed) return { kind: 'none', reason: 'removed' };

  const resolved = allResolved(stored, signals);
  if (resolved) {
    // Hidden means hidden: a path finished while it was collapsed leaves quietly.
    if (stored.hidden) return { kind: 'none', reason: 'hidden-complete' };
    // An account that finished everything without ever meeting the card is
    // established; it gets no finish screen for work the card did not guide.
    if (stored.answer === null && !opts.finishLive) return { kind: 'none', reason: 'established' };
    if (stored.finishShown && !opts.finishLive) return { kind: 'none', reason: 'finished' };
    return { kind: 'finish', done, skipped: total - done, total };
  }

  if (stored.answer === null && done >= ESTABLISHED_AT_DONE) return { kind: 'none', reason: 'established' };
  // Before he has answered, wait until the account's own lists have loaded:
  // putting the question up and then taking it away from an established
  // account a second later would be worse than a short wait. The proposal read
  // is left out on purpose (it needs the network; the rest are on the device).
  if (stored.answer === null && USUAL_ORDER.some((id) => id !== 'send' && signals[id] === undefined)) {
    return { kind: 'none', reason: 'loading' };
  }
  if (stored.hidden) return { kind: 'hidden', done, total };
  if (stored.answer === null) return { kind: 'question', done, total };

  const order = orderFor(stored.answer);
  const statuses = order.map((id) => stepStatus(id, stored, signals));
  const nextIndex = statuses.indexOf('todo');
  // `resolved` is false, so there is always a step still to do.
  const nextId = order[nextIndex];
  const sel = opts.selected;
  const openId = sel && order.includes(sel) && signals[sel] !== true ? sel : nextId;

  let filled = 0;
  while (filled < statuses.length && statuses[filled] === 'done') filled += 1;

  const steps: FirstJobStepView[] = order.map((id, i) => ({
    id,
    stage: STEP_META[id].stage,
    status: statuses[i],
    known: signals[id] !== undefined,
    open: id === openId,
    position: i + 1,
  }));

  const nowStage = STEP_META[nextId].stage;
  const stages: FirstJobStageView[] = STAGE_ORDER.map((stage) => {
    const left = order.some((id, i) => STEP_META[id].stage === stage && statuses[i] === 'todo');
    return { stage, state: !left ? 'done' : stage === nowStage ? 'now' : 'later' };
  });

  return { kind: 'path', steps, openId, nextId, done, total, filled, stages };
}

/**
 * The card can never be shown again on this visit of the app: the finish state
 * has been seen, the account is established, or the path was finished while
 * hidden. The mounted card stops ALL of its work on this (no price read, no
 * storage read, no proposal read). "loading" is not on the list (the answer is
 * still coming) and neither is "removed" (the card never mounts for it).
 */
export function viewRetiresCard(view: FirstJobView): boolean {
  return view.kind === 'none'
    && (view.reason === 'finished' || view.reason === 'established' || view.reason === 'hidden-complete');
}

/**
 * A step was done out of order when a step ahead of it in this account's
 * order was still to do at that moment. `before` is the signals as they were
 * just before the step turned done.
 */
export function isOutOfOrder(id: FirstJobStepId, stored: FirstJobStored, before: FirstJobSignals): boolean {
  const order = orderFor(stored.answer);
  const at = order.indexOf(id);
  for (let i = 0; i < at; i++) {
    if (stepStatus(order[i], stored, before) === 'todo') return true;
  }
  return false;
}

/**
 * Steps that turned done since the last look AND were once seen
 * known-and-not-done. A list that loads already done (projects hydrating, the
 * proposal read answering) is not something he just did, so it never ticks.
 */
export function freshlyDone(
  signals: FirstJobSignals,
  seenDone: ReadonlySet<FirstJobStepId>,
  seenOpen: ReadonlySet<FirstJobStepId>,
): FirstJobStepId[] {
  const out: FirstJobStepId[] = [];
  for (const id of USUAL_ORDER) {
    if (signals[id] === true && !seenDone.has(id) && seenOpen.has(id)) out.push(id);
  }
  return out;
}

// ── Paid plans: say so before the tap ───────────────────────────────────────

export type FirstJobPlan = 'pro' | 'business';

export type FirstJobCost =
  /** Nothing to say: the step is free for this account. */
  | { kind: 'free' }
  /** The step's screen opens on a paywall for this account. */
  | { kind: 'locked'; plan: FirstJobPlan }
  /** A free plan's counted allowance: `left` runs still to use, or null when the count could not be read. */
  | { kind: 'metered'; left: number | null; plan: FirstJobPlan };

/**
 * What a step costs THIS account, decided from the tier table that
 * hooks/useTierAccess reads (utils/featureTiers), never from RevenueCat.
 * `freeEstimatesLeft` is utils/aiRateLimiter's read-only count.
 */
export function stepCost(
  id: FirstJobStepId,
  a: { canAccess: (f: FeatureKey) => boolean; freeEstimatesLeft: number | null },
): FirstJobCost {
  const gate = STEP_META[id].gate;
  if (!gate || a.canAccess(gate)) return { kind: 'free' };
  const required = REQUIRED_TIER[gate];
  const plan: FirstJobPlan = required === 'business' ? 'business' : 'pro';
  if (id === 'estimate') {
    if (a.freeEstimatesLeft === 0) return { kind: 'locked', plan };
    return { kind: 'metered', left: a.freeEstimatesLeft, plan };
  }
  return { kind: 'locked', plan };
}

// ── Show Me First ───────────────────────────────────────────────────────────

export type FirstJobShowMe =
  | { kind: 'offer'; tutorialId: TutorialId }
  | { kind: 'practised'; tutorialId: TutorialId };

/**
 * The practice run behind a step, or null: no tutorial exists for the step,
 * the step is already done, this person may not see that tutorial, or his plan
 * lacks its feature while the practice pass is off (it would open on a
 * paywall). Practising never marks a step done.
 */
export function showMeFor(
  id: FirstJobStepId,
  a: {
    done: boolean;
    persona: TutorialPersona | null | undefined;
    fieldOnly: boolean;
    progress: TutorialProgress;
    canAccess: (f: FeatureKey) => boolean;
    practicePass: boolean;
  },
  defs: TutorialDefs = TUTORIAL_DEFS,
): FirstJobShowMe | null {
  if (a.done) return null;
  const tutorialId = STEP_META[id].tutorial;
  if (!tutorialId) return null;
  const def = tutorialsForUser(a.persona, a.fieldOnly, defs).find((d) => d.id === tutorialId);
  if (!def) return null;
  if (!a.practicePass && missingTierFor(def, a.canAccess) !== null) return null;
  if (a.progress?.byId?.[tutorialId]?.status === 'practised') return { kind: 'practised', tutorialId };
  return { kind: 'offer', tutorialId };
}

// ── Where a step's button goes ──────────────────────────────────────────────

/** A real project, reduced to what the card needs to pick one. */
export interface FirstJobProject {
  id: string;
  hasEstimate: boolean;
  hasSchedule: boolean;
  /** Milliseconds; newest first wins a tie. */
  updatedAt: number;
}

export type FirstJobTarget =
  | { to: 'company' }
  | { to: 'prices' }
  | { to: 'estimate' }
  /** The step lives inside a project and he has none yet. */
  | { to: 'createProject' }
  /** Send needs an estimate to send. */
  | { to: 'estimateFirst' }
  | { to: 'proposal'; projectId: string }
  /** The free way to send: the estimate on the project, where Share PDF lives. */
  | { to: 'projectEstimate'; projectId: string }
  | { to: 'schedule'; projectId: string }
  | { to: 'daily'; projectId: string }
  | { to: 'invoice'; projectId: string };

function newest(list: readonly FirstJobProject[]): FirstJobProject | undefined {
  let best: FirstJobProject | undefined;
  for (const p of list) if (!best || p.updatedAt > best.updatedAt) best = p;
  return best;
}

/**
 * The real screen a step's one button opens. A step that happens inside a
 * project never opens a screen that would dead-end without one: it sends him
 * to create the project first and says so on the button.
 */
export function stepTarget(
  id: FirstJobStepId,
  a: { projects: readonly FirstJobProject[]; canProposal: boolean },
): FirstJobTarget {
  if (id === 'company') return { to: 'company' };
  if (id === 'prices') return { to: 'prices' };
  if (id === 'estimate') return { to: 'estimate' };
  if (id === 'send') {
    const withEstimate = newest(a.projects.filter((p) => p.hasEstimate));
    if (!withEstimate) return { to: 'estimateFirst' };
    return a.canProposal
      ? { to: 'proposal', projectId: withEstimate.id }
      : { to: 'projectEstimate', projectId: withEstimate.id };
  }
  if (a.projects.length === 0) return { to: 'createProject' };
  if (id === 'schedule') {
    const p = newest(a.projects.filter((x) => !x.hasSchedule)) ?? newest(a.projects);
    return { to: 'schedule', projectId: (p as FirstJobProject).id };
  }
  const p = newest(a.projects) as FirstJobProject;
  return id === 'daily' ? { to: 'daily', projectId: p.id } : { to: 'invoice', projectId: p.id };
}

// ── Who sees it ─────────────────────────────────────────────────────────────

export type FirstJobAudience =
  /** A contractor (or "both", or a role not chosen yet): the path. */
  | 'path'
  /** An invited field seat with no job of his own: the card he had before. */
  | 'legacy'
  /** A property owner or property manager: no contractor steps. */
  | 'none';

export function audienceFor(a: {
  enabled: boolean;
  persona: TutorialPersona | null | undefined;
  fieldOnly: boolean;
}): FirstJobAudience {
  if (a.persona === 'client' || a.persona === 'property_manager') return a.enabled ? 'none' : 'legacy';
  if (!a.enabled) return 'legacy';
  return a.fieldOnly ? 'legacy' : 'path';
}

// ── Storage keys ────────────────────────────────────────────────────────────

/** Both keys sit under `mageid_`, so the tenant-switch sweep
 *  (utils/localCacheKeys) removes them, and both carry the user id. */
export const FIRST_JOB_STATE_KEY_PREFIX = 'mageid_first_job_path::';
export const FIRST_JOB_SENT_KEY_PREFIX = 'mageid_first_job_sent::';
export function firstJobStateKey(userId: string): string {
  return `${FIRST_JOB_STATE_KEY_PREFIX}${userId}`;
}
export function firstJobSentKey(userId: string): string {
  return `${FIRST_JOB_SENT_KEY_PREFIX}${userId}`;
}
