// utils/copilot/intentTable.ts — the universal router's capability table +
// id coercion. Pure (no mageAI / RN imports) so it's unit-testable and safe to
// import from both the classifier and the hub screen.
import type { CopilotCapabilityId } from './types';

/** The capabilities the router can dispatch to, with a plain-English hint the
 *  classifier matches against. Add an entry here when a new field capability
 *  is registered. */
export const INTENTS: { id: CopilotCapabilityId; label: string; hint: string }[] = [
  { id: 'daily_report', label: 'Daily report', hint: 'log the end of the day — crew on site, work done, weather, issues' },
  { id: 'schedule', label: 'Schedule', hint: 'build or adjust the project schedule / timeline' },
  { id: 'estimate', label: 'Estimate', hint: 'price out a scope of work / create an estimate' },
  { id: 'change_order', label: 'Change order', hint: 'a change the owner wants — added scope and cost' },
  { id: 'rfi', label: 'RFI', hint: 'a question for the architect or engineer (request for information)' },
  { id: 'submittal', label: 'Submittal', hint: 'a submittal, shop drawing, or product sample for review' },
  { id: 'punch', label: 'Punch item', hint: 'a punch-list defect that needs fixing' },
  { id: 'invoice', label: 'Billing', hint: 'bill the client / a progress draw / an invoice' },
  { id: 'safety_incident', label: 'Safety incident', hint: 'a safety incident, injury, or near-miss' },
  { id: 'warranty', label: 'Warranty', hint: 'log a warranty on installed work — roof, HVAC, appliance, etc.' },
  { id: 'toolbox_talk', label: 'Toolbox talk', hint: 'run a jobsite safety meeting / toolbox talk / tailgate talk' },
  { id: 'new_project', label: 'New project', hint: 'start / set up a brand-new project or job from scratch' },
  { id: 'jha', label: 'JHA', hint: 'a job hazard analysis / JSA — hazards + controls for a task' },
  { id: 'lead', label: 'Lead', hint: 'a new sales lead / homeowner inquiry / potential client' },
  { id: 'permit', label: 'Permit', hint: 'log a building/trade permit — pulled, approved, or expiring' },
  { id: 'hazard', label: 'Hazard', hint: 'flag an unsafe condition / hazard observation on site' },
];

/** Validate a raw classifier result down to a known capability id (or null). */
export function coerceCapabilityId(raw: unknown): CopilotCapabilityId | null {
  return INTENTS.some((i) => i.id === raw) ? (raw as CopilotCapabilityId) : null;
}

export interface SplitAction {
  capabilityId: CopilotCapabilityId;
  /** The exact words for THIS action, seeded into that capability's interview. */
  text: string;
  /** Short human label for the queue card. */
  label: string;
}

/** Validate + clean a raw AI actions array down to usable SplitActions. Pure. */
export function normalizeSplitActions(raw: unknown): SplitAction[] {
  if (!Array.isArray(raw)) return [];
  const out: SplitAction[] = [];
  const seen = new Set<string>();
  for (const a of raw) {
    const capabilityId = coerceCapabilityId((a as { capabilityId?: unknown })?.capabilityId);
    const text = typeof (a as { text?: unknown })?.text === 'string' ? (a as { text: string }).text.trim() : '';
    const label = typeof (a as { label?: unknown })?.label === 'string' ? (a as { label: string }).label.trim() : '';
    if (!capabilityId || !text) continue;
    const key = capabilityId + '|' + text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ capabilityId, text, label: label || text.slice(0, 40) });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULE_EDIT — "change the schedule I already have" (audit W6 A2, E7).
//
// The router's `schedule` intent ("build or adjust the project schedule") sent
// EVERY schedule request to the builder, which regenerates the whole plan from
// the estimate. "Add three tasks after rough-in" on a job with a running
// schedule therefore opened a from-scratch interview whose Accept replaced the
// live plan. The editor (scheduleEdit) previews its ripple and asks before
// anything sticks, so on a job that already has tasks it is the right door —
// and the SAFE one when the words are ambiguous. The builder is kept for a job
// with no tasks and for a request that plainly asks for a new plan.
//
// Not a new row in INTENTS: the classifier's `schedule` hint already covers
// "adjust", and the split is a fact about the JOB (does it have tasks?), which
// the model cannot see. Deterministic + pure so a validator pins it.
// ─────────────────────────────────────────────────────────────────────────────

/** The editor's capability id, surfaced to the hub as its own intent. */
export const SCHEDULE_EDIT_INTENT = {
  id: 'scheduleEdit' as const,
  label: 'Change the schedule',
  hint: 'add, move, remove, lengthen or re-link tasks on a schedule that already exists',
};

/** Words that ask for a NEW plan rather than a change to the running one.
 *  "redo / rebuild / regenerate / scrap" count only when a PLAN noun follows:
 *  "redo the drywall task" is a change to one task, and sending it to the
 *  builder would regenerate the whole plan from the estimate. */
const PLAN_NOUN = '(schedule|timeline|plan|gantt)';
const DETERMINERS = '((the|my|this|that|our|a|an|whole|entire|full|complete|new|project|job)\\s+)*';
const REBUILD_SHAPED = new RegExp(
  '\\b(' +
    `(re-?build|re-?do|re-?generate|re-?make|re-?create|scrap|throw out|start over on)\\s+${DETERMINERS}${PLAN_NOUN}` +
    `|(build|create|make|generate|draft)\\s+(me\\s+)?${DETERMINERS}${PLAN_NOUN}` +
    '|(new|fresh) (schedule|timeline|plan|gantt)' +
    '|start (it |the schedule |the plan )?over' +
    '|start (it |the schedule |the plan )?from scratch' +
  ')\\b',
  'i',
);

/** The verbs of a change to tasks on a running plan. */
const EDIT_VERB = /\b(add|insert|append|create|put in|squeeze in|push|pull|move|slide|shift|delay|bump|extend|lengthen|shorten|stretch|remove|delete|drop|cut|link|unlink|re-?level|level|swap|rename|split|chain)\b/i;

/** Something on the SCHEDULE is being named. Without one, an edit verb is just
 *  a verb — "add a change order for 2 extra days" is a change order. */
const SCHEDULE_NOUN = /\b(tasks?|activit(y|ies)|milestones?|schedule|gantt|timeline|critical path)\b/i;

/** Another document kind named outright: that request belongs to the mic's
 *  own parser (RFI, CO, punch, invoice, note, lead, …), never to the editor,
 *  even on a job with a running schedule. */
const OTHER_DOC = /\b(rfis?|request for information|change orders?|c\.?o\.?s?|punch( ?list| items?)?|invoices?|bills?|billing|draws?|submittals?|notes?|leads?|daily (report|log)s?|dfr|meetings?|estimates?|quotes?|bids?|purchase orders?|p\.?o\.?s?|receipts?|expenses?|photos?|warrant(y|ies)|permits?|incidents?)\b/i;

/** A question he asked, not a change — "what is the critical path", "when
 *  does framing finish?". No edit verb + question shape. */
const QUESTION_SHAPED = /^(what|when|where|why|how|who|which|whose|is|are|was|were|does|do|did|can|could|will|would|should|show( me)?|tell me|explain)\b|\?\s*$/i;

const normWords = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
const TITLE_STOP = new Set(['the', 'and', 'for', 'with', 'from', 'task', 'work', 'install', 'rough', 'final', 'phase']);

/** True when the words name one of the job's tasks: the whole title, or its
 *  first distinctive word ("drywall" for "Drywall hang"). */
function namesScheduleTask(text: string, taskTitles: readonly (string | null | undefined)[] | undefined): boolean {
  if (!taskTitles || taskTitles.length === 0) return false;
  const said = normWords(text);
  for (const raw of taskTitles) {
    const title = normWords(raw ?? '').trim();
    if (!title) continue;
    if (title.length >= 3 && said.includes(` ${title} `)) return true;
    const first = title.split(' ').find((w) => w.length >= 4 && !TITLE_STOP.has(w));
    if (first && said.includes(` ${first} `)) return true;
  }
  return false;
}

export function isScheduleRebuildUtterance(text: string | null | undefined): boolean {
  return REBUILD_SHAPED.test((text ?? '').trim());
}

/** A question about the plan, with no change asked for. */
export function isScheduleQuestionUtterance(text: string | null | undefined): boolean {
  const t = (text ?? '').trim();
  return !!t && QUESTION_SHAPED.test(t) && !EDIT_VERB.test(t);
}

/**
 * "Add three tasks after rough-in", "remove the paint task", "push framing a
 * week" (when Framing is on the job) → true. For a caller that already knows
 * the words are about the schedule (a classifier said `schedule`). The global
 * mic does NOT use this — task-title matching there swallowed field logs; it
 * uses isMicScheduleEditUtterance below. Still strict: an edit verb AND a
 * schedule noun or one of the job's task titles, and NO other document kind
 * named — "create an RFI about the beam after framing", "add a change order for
 * 2 extra days" and "delete the punch item in the kitchen" all stay with the
 * mic's parser. A rebuild request is never an edit.
 */
export function isScheduleEditUtterance(
  text: string | null | undefined,
  taskTitles?: readonly (string | null | undefined)[],
): boolean {
  const t = (text ?? '').trim();
  if (!t || REBUILD_SHAPED.test(t) || OTHER_DOC.test(t)) return false;
  if (!EDIT_VERB.test(t)) return false;
  return SCHEDULE_NOUN.test(t) || namesScheduleTask(t, taskTitles);
}

/** An IMPERATIVE add of new schedule work, said as the first thing in the
 *  utterance: an optional "please / okay / hey / so", an optional "can you /
 *  let's / go ahead and / I need you to / we need to", then add / add in /
 *  insert / create / put in / throw in / schedule (in), an optional count
 *  ("a", "three", "a few", "another"), an optional "new / more", and then
 *  task(s) / milestone(s). Anchored at the START on purpose — see below.
 *
 *  Review round 4: "activity" is a daily-log word ("add an activity: framing
 *  crew installed the joists"), so it is not a schedule noun here; and a noun
 *  followed by a log / progress / time word ("add task progress: …", "add
 *  tasks done today: …", "add milestone reached: …") is dictation, not a new
 *  task, so the match is refused there. */
const MIC_ADD_TASK = /^\s*(?:(?:please|ok(?:ay)?|hey|so)[,\s]+)?(?:(?:can|could|would) you\s+|let'?s\s+|go ahead and\s+|i (?:need|want) (?:you )?to\s+|we need to\s+)?(?:add(?: in)?|insert|create|put in|throw in|schedule(?: in)?)\s+(?:(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|a few|a couple(?: of)?|some|another|more)\s+)?(?:new\s+|more\s+)?(?:tasks?|milestones?)\b(?!\s*:?\s*(?:progress|time|hours?|log|entry|entries|notes?|update|status|done|completed|finished|reached|percent|for today)\b)/i;

/** A log, time, material or progress word ANYWHERE in the utterance. The
 *  lookahead in MIC_ADD_TASK only sees the word right after the task noun, so
 *  "Add tasks we did today: framing, sheathing, 8 hours", "Add a new task,
 *  framing is 80 percent done" and "Add milestone: framing inspection passed"
 *  (review round 5) still reached the editor, and the hours and deliveries in
 *  them were never filed. None of the add-new-work phrasings carries one. A
 *  real add that happens to stays with the parser — the safe side, because
 *  the parser still files his words; a wrong "yes" here files nothing. */
const MIC_LOG_MARKER = /\b(today|tonight|this morning|yesterday|hours?|hrs|delivered|delivery|done|finished|complete(?:d)?|percent|passed|sheets)\b|%/i;

/**
 * The GLOBAL MIC's door to the schedule editor. The mic sits in front of every
 * daily log, time entry, CO and progress report, and it asks this BEFORE its
 * own parser, so a false "yes" throws away what he said (nothing is filed; the
 * editor opens pre-filled instead).
 *
 * Review round 3 — the third rule on this door, so it is now the simplest one
 * that can be proven: ONLY an imperative add of new tasks at the start of the
 * utterance ("Add three tasks after rough-in…", "insert a milestone before
 * trim", "can you add a task after drywall hang"), which is all spec E8 asked
 * the mic to route. The two looser rules before it (an edit verb ANYWHERE plus
 * a task title, then plus a schedule noun) kept catching field speech: "add to
 * the log that the framing crew started the roof task", "crew is on level 2,
 * the pour task starts tomorrow" ('level' is a floor), "this will push the
 * schedule a day". Push / move / remove sentences go back to the parser, as at
 * 6065b326 — it files "push framing a week" as a schedule field update. A
 * sentence that names another document outright ("add a task to the punch
 * list") also stays with the parser.
 */
export function isMicScheduleEditUtterance(text: string | null | undefined): boolean {
  const t = (text ?? '').trim();
  if (!t || OTHER_DOC.test(t) || MIC_LOG_MARKER.test(t)) return false;
  return MIC_ADD_TASK.test(t);
}

export interface ScheduleJobLike {
  id: string;
  name?: string;
  schedule?: { tasks?: readonly unknown[] | null } | null;
}

export type ScheduleRoute =
  /** Open the editor on this job, seeded with the words. */
  | { kind: 'edit'; projectId: string; seed: string }
  /** Open the builder (/copilot?capabilityId=schedule); its own gate picks a
   *  job / asks for an estimate. projectId '' = no job chosen. */
  | { kind: 'build'; projectId: string; seed?: string }
  /** A question about a running plan ("what is the critical path"): open the
   *  schedule itself — the editor has nothing to change and the builder would
   *  regenerate the plan he is asking about. */
  | { kind: 'view'; projectId: string }
  /** No job was named and more than one has a running schedule: ask which.
   *  `then` is what the pick opens: the editor, or the schedule for a question. */
  | { kind: 'pick'; candidates: { id: string; name: string }[]; seed: string; then: 'edit' | 'view' };

const taskCount = (p: ScheduleJobLike | null | undefined) =>
  Array.isArray(p?.schedule?.tasks) ? (p!.schedule!.tasks as unknown[]).length : 0;

/**
 * Where a schedule request goes.
 *   job named + has tasks + a question with no edit verb → VIEW the schedule
 *   job named + has tasks + not a rebuild request        → EDIT (seeded)
 *   job named + no tasks, or a rebuild request           → BUILD
 *   no job named → the jobs (closed ones excluded by the caller) that have a
 *     running schedule: one → EDIT / VIEW it, several → PICK, none → BUILD.
 * A request with no words (a bare tile tap) keeps the builder, which is what
 * the tile has always opened.
 */
export function routeScheduleRequest(input: {
  text: string | null | undefined;
  projectId?: string | null;
  projects: readonly ScheduleJobLike[];
}): ScheduleRoute {
  const seed = (input.text ?? '').trim();
  const pid = input.projectId ?? '';
  if (!seed || isScheduleRebuildUtterance(seed)) return { kind: 'build', projectId: pid, ...(seed ? { seed } : {}) };
  const then: 'edit' | 'view' = isScheduleQuestionUtterance(seed) ? 'view' : 'edit';
  const land = (projectId: string): ScheduleRoute => (then === 'view' ? { kind: 'view', projectId } : { kind: 'edit', projectId, seed });
  if (pid) {
    const job = input.projects.find((p) => p?.id === pid);
    return taskCount(job) > 0 ? land(pid) : { kind: 'build', projectId: pid, seed };
  }
  const running = input.projects.filter((p) => p && typeof p.id === 'string' && taskCount(p) > 0);
  if (running.length === 1) return land(running[0].id);
  if (running.length > 1) return { kind: 'pick', candidates: running.map((p) => ({ id: p.id, name: p.name || 'Untitled job' })), seed, then };
  return { kind: 'build', projectId: '', seed };
}

/** The route that opens the editor. The Schedule tab hosts it on every form
 *  factor (phone: MobileScheduleScreen, tablet/web: the classic screen), and
 *  both honour projectId + a fresh `focus` nonce + `editSeed`. */
export function scheduleEditHref(projectId: string, seed: string, nonce: string = String(Date.now())) {
  return { pathname: '/(tabs)/schedule', params: { projectId, focus: nonce, editSeed: seed } };
}

/** The route that just opens the job's schedule (a question about it).
 *  `editSeed: ''` on purpose: tab params are sticky, and a seed left over from
 *  an earlier arrival would otherwise open the editor under this new nonce. */
export function scheduleViewHref(projectId: string, nonce: string = String(Date.now())) {
  return { pathname: '/(tabs)/schedule', params: { projectId, focus: nonce, editSeed: '' } };
}

/** Tab params are STICKY: the seed would re-open the editor on every later
 *  visit to the tab. Each arrival (projectId + focus nonce + words) opens it
 *  once, across both schedule surfaces and a breakpoint remount. */
const claimedEditSeeds = new Set<string>();
/** On the web the arrival also lives in the URL's query string, and module
 *  memory is emptied by a reload — so a reload (or the link opened in a new
 *  tab) re-claimed the same arrival and re-opened the editor pre-filled; one
 *  tap on Send then added the same tasks twice (review round 4). The hosts
 *  clear the param once claimed, and the claim is also remembered in the web
 *  origin's storage (localStorage — AsyncStorage's own backing store on web,
 *  under the mageid_ prefix the tenant wipe sweeps). Only a hash is kept,
 *  never his words; the last 50 arrivals. Native has no localStorage and no
 *  reload of route params, so module memory is enough there. */
export const CLAIMED_EDIT_SEEDS_KEY = 'mageid_claimed_edit_seeds';
const seedHash = (key: string): string => {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0;
  return `${key.length}:${h.toString(36)}`;
};
function webStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void } | null {
  try {
    const s = (globalThis as { localStorage?: unknown }).localStorage as { getItem?: unknown; setItem?: unknown } | undefined;
    return s && typeof s.getItem === 'function' && typeof s.setItem === 'function' ? (s as never) : null;
  } catch { return null; }
}
export function claimScheduleEditSeed(key: string): boolean {
  if (!key || claimedEditSeeds.has(key)) return false;
  claimedEditSeeds.add(key);
  const store = webStorage();
  if (!store) return true;
  const h = seedHash(key);
  let saved: string[] = [];
  try {
    const parsed: unknown = JSON.parse(store.getItem(CLAIMED_EDIT_SEEDS_KEY) ?? '[]');
    saved = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch { saved = []; }
  if (saved.includes(h)) return false;
  try { store.setItem(CLAIMED_EDIT_SEEDS_KEY, JSON.stringify([...saved, h].slice(-50))); } catch { /* storage blocked: memory still holds it */ }
  return true;
}

/** How the Copilot hub (a native `presentation: 'modal'` route) reaches the
 *  Schedule tab. On iOS/Android a push of '(tabs)' from INSIDE the modal is
 *  placed by react-native-screens UNDER the sheet — the hub stays on screen,
 *  the Schedule tab mounts behind it, and its editor Modal is refused by UIKit
 *  (the root is still presenting the hub) and never retried. So on native an
 *  EDIT/VIEW arrival dismisses the hub first and navigates once it has gone
 *  (the codebase's 350ms iOS guard, as UniversalSearch does); with nothing to
 *  go back to (a cold deep link) the hub is replaced instead. The builder
 *  (/copilot) is itself a modal that stacks normally, and the web has no
 *  native presentation — both keep what they did. Pure, so a table pins it. */
export type HubScheduleNav = 'push' | 'replace' | 'dismiss-then-push';
export function hubScheduleNav(input: {
  kind: ScheduleRoute['kind'];
  how: 'push' | 'replace';
  platform: string;
  canGoBack: boolean;
}): HubScheduleNav {
  const leavesForTab = input.kind === 'edit' || input.kind === 'view';
  if (!leavesForTab || input.platform === 'web') return input.how;
  return input.canGoBack ? 'dismiss-then-push' : 'replace';
}
/** The wait after dismissing a modal before presenting the next thing. */
export const MODAL_DISMISS_DELAY_MS = (platform: string) => (platform === 'ios' ? 350 : 0);
