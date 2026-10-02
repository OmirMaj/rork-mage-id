// utils/oneMind/askAction.ts — Ask MAGE "do it for me" (lane AIDO).
//
// When he types or says a REQUEST in Ask ("create a project for the Henderson
// kitchen", "build the schedule", "write an RFI about the beam"), Ask stops
// answering "here is how" and offers to do it: a card that names the workflow,
// the job and the words it will hand over, with a Start button that opens the
// existing MAGE Copilot capability. Nothing is written by Ask; the Copilot's
// own review ("Build it") is where anything is saved.
//
// This file is the deterministic half, with NO AI call:
//   - detectAskActions: is this a do-request, and for which capabilities?
//   - howToOffer: an app how-to question that can be done for him instead;
//   - snapshotForAction / actionOutcome: what was ACTUALLY saved after Start,
//     read from the app's own records — never inferred from navigation.
//
// Pure: no React, no React Native, no mageAI, and NOT utils/copilot/registry
// (the registry imports every capability's impure apply()). Bun-validated by
// scripts/validate-ask-action.ts.

import type { CopilotCapabilityId } from '../copilot/types';
import {
  INTENTS,
  SCHEDULE_EDIT_INTENT,
  isScheduleEditUtterance,
  routeScheduleRequest,
  scheduleViewHref,
  type ScheduleRoute,
} from '../copilot/intentTable';
import { PROJECT_FREE, copilotPrecondition, pickableProjects } from '../copilot/projectScope';
import { resolveScope, isQuestionShaped } from './resolveScope';
import { isAppHowTo } from './composePrompt';

export type AskActionCapability = CopilotCapabilityId;

export type AskActionPrecondition =
  | { ok: true }
  | { ok: false; kind: 'no_project' | 'no_estimate'; message: string };

export interface AskActionProposal {
  capabilityId: AskActionCapability;
  /** English label (the card renders it through useAskCopy where a key exists). */
  label: string;
  /** The words handed to the Copilot, trimmed. '' = nothing handed over. */
  seed: string;
  /** '' = no job yet (the Copilot's own gate picks one). */
  projectId: string;
  projectName?: string;
  precondition: AskActionPrecondition;
  /** capabilityId 'schedule' only. */
  schedule?: ScheduleRoute;
  origin: 'request' | 'howto';
}

/** The project fields this lane reads. A real Project satisfies it. */
export interface AskProjectLike {
  id: string;
  name: string;
  status?: string;
  updatedAt?: string;
  schedule?: { id?: string; tasks?: readonly unknown[] | null } | null;
  linkedEstimate?: { id?: string; grandTotal?: number; items?: readonly unknown[] | null; createdAt?: string } | null;
}

/** A record in one of the job's collections. Real ChangeOrder / RFI / … rows satisfy it. */
export interface AskRecordLike {
  id: string;
  projectId?: string | null;
  name?: string;
  number?: number | string;
  subject?: string;
  title?: string;
  permitNumber?: string;
}

export interface AskActionData {
  projects: readonly AskProjectLike[];
  changeOrders: readonly AskRecordLike[];
  rfis: readonly AskRecordLike[];
  dailyReports: readonly AskRecordLike[];
  punchItems: readonly AskRecordLike[];
  invoices: readonly AskRecordLike[];
  submittals: readonly AskRecordLike[];
  permits: readonly AskRecordLike[];
  leads: readonly AskRecordLike[];
}

/** What existed when Start was tapped. `ids` holds record ids per collection,
 *  plus `schedule` / `estimate` fingerprints as `<projectId>|<hash>`. */
export type AskActionSnapshot = { ids: Record<string, string[]>; scheduleKey?: string; estimateId?: string };

export type AskActionOutcome =
  | { kind: 'saved'; label?: string; href?: { pathname: string; params: Record<string, string> } }
  | { kind: 'nothing' }
  | { kind: 'unobserved' };

export interface AskActionContext {
  projects: readonly AskProjectLike[];
  anchorProjectId?: string | null;
}

/** Longer than this is a paste, not a spoken request. */
export const ASK_ACTION_MAX_CHARS = 500;
/** At most this many workflows from one sentence. */
export const ASK_ACTION_MAX = 3;
/** The estimate editor's label (copy key ai.ask.action.label.estimateEdit). */
export const ESTIMATE_EDIT_LABEL = 'Change the estimate';

// ─── tokens ────────────────────────────────────────────────────────────────

interface Tok { w: string; start: number; end: number; afterPunct: boolean }

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  const re = /[a-z0-9][a-z0-9'.-]*/gi;
  let m: RegExpExecArray | null;
  let prevEnd = 0;
  while ((m = re.exec(text))) {
    let w = m[0].toLowerCase();
    // "c.o." keeps its dots; any other word loses a trailing full stop.
    if (!/^c\.o\.?$/.test(w)) w = w.replace(/[.'-]+$/, '');
    const gap = text.slice(prevEnd, m.index);
    out.push({ w, start: m.index, end: m.index + m[0].length, afterPunct: /[,;:.!?]/.test(gap) });
    prevEnd = m.index + m[0].length;
  }
  return out;
}

const norm = (s: string) => s.replace(/[‘’]/g, "'").trim();

// ─── the request shape ─────────────────────────────────────────────────────

/** Leads that may come before the verb. Polite ones ("can you …") make a
 *  question-shaped sentence a request again. */
const LEAD_FILLERS = new Set(['please', 'ok', 'okay', 'hey', 'so', 'mage']);
const POLITE_LEADS: string[][] = [
  ['can', 'you'], ['could', 'you'], ['would', 'you'], ['will', 'you'],
];
const OTHER_LEADS: string[][] = [
  ['i', 'need', 'you', 'to'], ['i', 'want', 'you', 'to'], ['go', 'ahead', 'and'], ['help', 'me'],
  ["let's"], ['lets'], ['let', 'us'],
];

/** DO verbs. Two-word verbs first so "write up" / "price out" win over "write" / "price". */
const DO_VERBS: string[][] = [
  ['write', 'up'], ['set', 'up'], ['price', 'out'], ['price', 'up'],
  ['create'], ['start'], ['make'], ['build'], ['draft'], ['write'], ['open'], ['add'], ['log'],
  ['file'], ['submit'], ['raise'], ['record'], ['price'], ['bill'], ['invoice'], ['run'], ['do'],
  ['redo'], ['rebuild'], ['change'], ['edit'], ['update'], ['new'],
];
/** Imperative verbs of a change to a running schedule (the editor's door). */
const SCHEDULE_EDIT_LEAD = /^(add|insert|put in|squeeze in|push|pull|move|slide|shift|delay|bump|extend|lengthen|shorten|stretch|remove|delete|drop|cut|link|unlink|re-?level|level|swap|rename|split|chain)\b/i;

const NEGATIONS = new Set(['never', 'not', "don't", 'dont', "didn't", 'didnt', "doesn't", "won't", "can't", 'cannot']);
/** A pronoun or modal right before the verb makes it a statement ("I'll
 *  create", "the sub will submit"), not an instruction to MAGE. */
const STATEMENT_BEFORE = new Set(['i', 'we', 'they', 'he', 'she', 'it', "i'll", "we'll", "they'll", "he'll", "she'll", "it'll", 'will', 'would', 'should', 'might', 'could', 'can', 'may', 'must', "i'd", "we'd"]);
const CONJUNCTIONS = new Set(['and', 'then', 'also', 'plus']);
const DETERMINERS = new Set(['a', 'an', 'the', 'my', 'this', "today's", 'todays', 'new', 'another', 'our']);

function seqAt(toks: Tok[], i: number, seq: string[]): boolean {
  if (i + seq.length > toks.length) return false;
  return seq.every((w, k) => toks[i + k].w === w);
}

/** Strip the leading fillers / polite lead. Returns where the request starts. */
function leadEnd(toks: Tok[]): { at: number; polite: boolean } {
  let i = 0;
  let polite = false;
  while (i < toks.length && LEAD_FILLERS.has(toks[i].w)) i++;
  for (const seq of POLITE_LEADS) if (seqAt(toks, i, seq)) { i += seq.length; polite = true; break; }
  if (!polite) for (const seq of OTHER_LEADS) if (seqAt(toks, i, seq)) { i += seq.length; break; }
  while (i < toks.length && (toks[i].w === 'please' || toks[i].w === 'just')) i++;
  return { at: i, polite };
}

function verbAt(toks: Tok[], i: number): string[] | null {
  // "make sure the schedule is right" is a check, not a request to build one.
  if (toks[i]?.w === 'make' && toks[i + 1]?.w === 'sure') return null;
  for (const v of DO_VERBS) if (seqAt(toks, i, v)) return v;
  return null;
}

// ─── the capability noun table (M2) ────────────────────────────────────────

type NounRow = { id: AskActionCapability; phrases: string[][] };
const NOUNS: NounRow[] = [
  { id: 'jha', phrases: [['job', 'hazard', 'analysis'], ['jha'], ['jsa']] },
  { id: 'rfi', phrases: [['request', 'for', 'information'], ['rfi']] },
  { id: 'change_order', phrases: [['change', 'order']] },
  { id: 'daily_report', phrases: [['daily', 'report'], ['daily', 'log'], ['dfr']] },
  { id: 'submittal', phrases: [['shop', 'drawing'], ['submittal']] },
  { id: 'punch', phrases: [['punch', 'item'], ['punch', 'list']] },
  { id: 'invoice', phrases: [['progress', 'draw'], ['draw', 'request'], ['invoice']] },
  { id: 'safety_incident', phrases: [['near', 'miss'], ['near-miss'], ['incident'], ['injury']] },
  { id: 'toolbox_talk', phrases: [['toolbox', 'talk'], ['tailgate', 'talk'], ['safety', 'meeting']] },
  { id: 'hazard', phrases: [['unsafe', 'condition'], ['hazard']] },
  { id: 'warranty', phrases: [['warranty']] },
  { id: 'permit', phrases: [['permit']] },
  { id: 'lead', phrases: [['lead'], ['inquiry']] },
  { id: 'estimate', phrases: [['estimate'], ['quote'], ['bid']] },
  { id: 'schedule', phrases: [['schedule'], ['timeline'], ['gantt']] },
  { id: 'new_project', phrases: [['project'], ['job']] },
];
/** The table's rows, in match order (the validator pins a positive and a
 *  negative sentence for each). */
export const ASK_ACTION_NOUN_ROWS: readonly AskActionCapability[] = NOUNS.map((r) => r.id);
/** Words that follow "lead" / "job" when they are NOT the capability noun. */
const LEAD_NOT = new Set(['paint', 'carpenter', 'abatement', 'time', 'times', 'pipe', 'flashing', 'man', 'foreman']);
const NEW_PROJECT_VERBS = new Set(['create', 'start', 'make', 'set up', 'open', 'new', 'add']);
/** "a / an / new / another" project is a new one; "the / my / this …" job is
 *  one he already has ("start the Henderson job", "add a photo to the job"). */
const INDEFINITE = new Set(['a', 'an', 'new', 'another']);

const plural = (tok: string, w: string) =>
  tok === w || tok === w + 's' || tok === w + 'es' || (w.endsWith('y') && tok === w.slice(0, -1) + 'ies');

function phraseAt(toks: Tok[], i: number, phrase: string[]): boolean {
  if (i + phrase.length > toks.length) return false;
  return phrase.every((w, k) => (k === phrase.length - 1 ? plural(toks[i + k].w, w) : toks[i + k].w === w));
}

interface NounHit { id: AskActionCapability; at: number; len: number }

/** The capability noun right after a verb: optional determiners, then up to 3
 *  other words, then the noun. The nearest noun wins; at the same place the
 *  longest phrase ("job hazard analysis" over "job"). */
function nounAfter(
  toks: Tok[],
  verb: string,
  from: number,
  scheduleWordsOk: boolean,
  namesJob: (words: string) => boolean = () => false,
): NounHit | null {
  let i = from;
  const dets: string[] = [];
  while (i < toks.length && DETERMINERS.has(toks[i].w)) { dets.push(toks[i].w); i++; }
  const firstAfterDets = i;

  // "log the day" / "log today's day" is a daily report.
  if (verb === 'log' && dets.length > 0 && (dets[dets.length - 1] === 'the' || dets[dets.length - 1].startsWith('today')) && toks[i]?.w === 'day') {
    return { id: 'daily_report', at: i, len: 1 };
  }
  // "bill (the) owner / client / homeowner / customer" is billing.
  if (verb === 'bill' && toks[i] && ['owner', 'client', 'homeowner', 'customer'].includes(toks[i].w) && (dets.length === 0 || dets.every((d) => d === 'the'))) {
    return { id: 'invoice', at: i, len: 1 };
  }

  for (let k = firstAfterDets; k < toks.length && k <= firstAfterDets + 3; k++) {
    // A conjunction or a new clause ends this verb's reach.
    if (k > firstAfterDets && (toks[k].afterPunct || CONJUNCTIONS.has(toks[k].w))) break;
    // "CO" / "c.o." only right after the verb (+ determiners): "add a CO for 2 extra days".
    if (k === firstAfterDets && /^(co|cos|c\.o\.?)$/.test(toks[k].w)) return { id: 'change_order', at: k, len: 1 };
    let best: NounHit | null = null;
    for (const row of NOUNS) {
      for (const ph of row.phrases) {
        if (!phraseAt(toks, k, ph)) continue;
        const next = toks[k + ph.length]?.w;
        if (row.id === 'lead' && next && LEAD_NOT.has(next)) continue;
        if (row.id === 'new_project') {
          if (next === 'hazard' || next === 'site' || next === 'walk') continue;
          if (!NEW_PROJECT_VERBS.has(verb)) continue;
          // A definite determiner names a job he has: "start the Henderson
          // job", "set up the job" ("the new project" still reads as new).
          if (dets.some((d) => !INDEFINITE.has(d)) && !dets.some((d) => d === 'new' || d === 'another')) continue;
          // "add a photo to the job": the word right before the noun is
          // definite, so the job is an existing one whatever came before.
          const before = k > 0 ? toks[k - 1].w : '';
          if (k > firstAfterDets && DETERMINERS.has(before) && !INDEFINITE.has(before)) continue;
          // "open / add" a job only with "a / an / new / another" right before
          // it: "open the Henderson job" is opening one he has.
          if ((verb === 'open' || verb === 'add') && !INDEFINITE.has(before)) continue;
          // "start a Henderson job" when Henderson is already one of his jobs.
          if (k > firstAfterDets && namesJob(toks.slice(firstAfterDets, k).map((t) => t.w).join(' '))) continue;
        }
        if (!best || ph.length > best.len) best = { id: row.id, at: k, len: ph.length };
      }
    }
    if (best) return best;
    // Tasks / milestones are schedule words only when the editor would take
    // the sentence (no other document named, an edit verb, …).
    if (scheduleWordsOk && (plural(toks[k].w, 'task') || plural(toks[k].w, 'milestone'))) return { id: 'schedule', at: k, len: 1 };
  }
  // "add the cracked tile to the punch list": the noun comes after what goes on it.
  for (let k = firstAfterDets; k < toks.length && k <= firstAfterDets + 8; k++) {
    if (k > firstAfterDets && (toks[k].afterPunct || CONJUNCTIONS.has(toks[k].w))) break;
    if (seqAt(toks, k, ['to', 'the', 'punch']) || seqAt(toks, k, ['to', 'my', 'punch']) || seqAt(toks, k, ['to', 'punch'])) {
      const at = toks[k + 1].w === 'punch' ? k + 1 : k + 2;
      if (toks[at + 1]?.w === 'list') return { id: 'punch', at, len: 2 };
    }
  }
  return null;
}

function hasNegationBefore(toks: Tok[], from: number, to: number): boolean {
  for (let i = from; i < to; i++) {
    if (NEGATIONS.has(toks[i].w)) return true;
    if (toks[i].w === 'do' && toks[i + 1]?.w === 'not') return true;
    if (toks[i].w === 'no' && toks[i + 1]?.w === 'need') return true;
  }
  return false;
}

// ─── jobs ──────────────────────────────────────────────────────────────────

const taskTitles = (p: AskProjectLike | null | undefined): string[] =>
  Array.isArray(p?.schedule?.tasks)
    ? (p!.schedule!.tasks as unknown[]).map((t) => (t && typeof t === 'object' ? String((t as { title?: unknown }).title ?? '') : '')).filter(Boolean)
    : [];

function resolveJob(text: string, ctx: AskActionContext): AskProjectLike | null {
  const projects = Array.isArray(ctx.projects) ? ctx.projects : [];
  const s = resolveScope(text, projects.map((p) => ({ id: p.id, name: p.name ?? '' })));
  if (s.scope === 'project') return projects.find((p) => p.id === s.projectId) ?? null;
  const anchor = ctx.anchorProjectId ? projects.find((p) => p.id === ctx.anchorProjectId) : undefined;
  return anchor ?? null;
}

const labelFor = (id: AskActionCapability): string =>
  id === 'scheduleEdit' ? SCHEDULE_EDIT_INTENT.label
    : id === 'estimateEdit' ? ESTIMATE_EDIT_LABEL
      : INTENTS.find((i) => i.id === id)?.label ?? id;

/** Which precondition a proposal carries. The schedule EDITOR and VIEW need no
 *  estimate (they change / open a plan that exists), so only the builder is
 *  checked against copilotPrecondition('schedule'). */
function preconditionFor(id: AskActionCapability, route: ScheduleRoute | undefined, job: AskProjectLike | null): AskActionPrecondition {
  const asId: AskActionCapability = id === 'schedule' && route && route.kind !== 'build' ? 'scheduleEdit' : id;
  return copilotPrecondition(asId, job as never) as AskActionPrecondition;
}

function buildProposal(
  id: AskActionCapability,
  text: string,
  ctx: AskActionContext,
  origin: 'request' | 'howto',
  verb: string,
): AskActionProposal {
  const seed = origin === 'howto' ? '' : text;
  if (PROJECT_FREE.has(id)) {
    // The words are the seed: "create a project for the Henderson kitchen"
    // must NOT bind to an existing Henderson job.
    return { capabilityId: id, label: labelFor(id), seed, projectId: '', precondition: { ok: true }, origin };
  }
  const projects = Array.isArray(ctx.projects) ? ctx.projects : [];
  let job = resolveJob(text, ctx);
  let capabilityId = id;
  if (id === 'estimate' && (verb === 'change' || verb === 'edit' || verb === 'update') && job?.linkedEstimate) capabilityId = 'estimateEdit';
  let route: ScheduleRoute | undefined;
  if (id === 'schedule') {
    route = routeScheduleRequest({
      text: scheduleRouteText(text, verb),
      projectId: job?.id ?? '',
      projects: job ? (projects as never) : (pickableProjects(projects as never) as never),
    });
    if (route.kind === 'build' || route.kind === 'edit' || route.kind === 'pick') route = { ...route, seed: text } as ScheduleRoute;
    if (origin === 'howto' && 'seed' in route) route = { ...route, seed: route.kind === 'build' ? undefined : route.seed } as ScheduleRoute;
    const pid = route.kind === 'pick' ? '' : route.projectId;
    job = pid ? projects.find((p) => p.id === pid) ?? null : null;
  }
  // The editor's door is its own workflow: "Change the schedule".
  const toEditor = route && (route.kind === 'edit' || (route.kind === 'pick' && route.then === 'edit'));
  const out: AskActionProposal = {
    capabilityId,
    label: toEditor ? SCHEDULE_EDIT_INTENT.label : labelFor(capabilityId),
    seed,
    projectId: job?.id ?? '',
    precondition: preconditionFor(capabilityId, route, job),
    origin,
  };
  if (job?.name) out.projectName = job.name;
  if (route) out.schedule = route;
  return out;
}

/** The words the schedule router reads. Two phrasings the hub's rules miss:
 *  "start building / start making the schedule" is the builder, and "open /
 *  pull up the schedule" is a look at the plan, not an edit. The seed handed
 *  over is still his own words. */
function scheduleRouteText(text: string, verb: string): string {
  if (/\b(start|begin)\s+(building|making|creating|drafting)\b/i.test(text)) {
    return text.replace(/\b(start|begin)\s+(building|making|creating|drafting)\b/i, 'build');
  }
  if (verb === 'open' && !/\b(rebuild|redo|new|fresh)\b/i.test(text)) {
    return text.replace(/\bopen\b/i, 'show me');
  }
  return text;
}

/** Schedule rows last (hubRouting's scheduleCardsLast): the others are quick
 *  logs; the schedule may leave Ask for the Schedule tab. */
function scheduleLast(list: AskActionProposal[]): AskActionProposal[] {
  return [...list.filter((p) => p.capabilityId !== 'schedule'), ...list.filter((p) => p.capabilityId === 'schedule')];
}

/** A sentence that starts "do the / do a / do today's …" is an instruction,
 *  not the question "do I / do we …". */
const DO_IMPERATIVE = /^do\s+(the|a|an|my|our|this|today'?s|tomorrow'?s|another|new)\b/i;

/**
 * Is this a do-request, and for which capabilities (spoken order, distinct, at
 * most 3)? Empty = not a request: One Mind answers it as today.
 */
export function detectAskActions(raw: string, ctx: AskActionContext): AskActionProposal[] {
  const text = norm(raw ?? '');
  if (!text || text.length > ASK_ACTION_MAX_CHARS) return [];
  if (isAppHowTo(text)) return [];
  const toks = tokenize(text);
  if (toks.length === 0) return [];
  const { at: start, polite } = leadEnd(toks);
  const rest = text.slice(toks[start]?.start ?? text.length);

  // The first DO verb, within the first 6 words of the request.
  let first = -1;
  for (let i = start; i < toks.length && i < start + 6; i++) {
    const v = verbAt(toks, i);
    if (!v) continue;
    if (v[0] === 'new' && i !== start) continue; // "new" is a verb only as the first word
    if (i > 0 && STATEMENT_BEFORE.has(toks[i - 1].w) && i - 1 >= start) break; // "I'll create …"
    first = i;
    break;
  }

  // Data questions: question-shaped and no polite "can you <DO verb>" lead.
  const question = isQuestionShaped(text) && !(polite && first === start) && !(DO_IMPERATIVE.test(rest) && !/\?\s*$/.test(text));
  if (question) return [];

  const job = resolveJob(text, ctx);
  const scheduleWordsOk = isScheduleEditUtterance(text, taskTitles(job));
  const jobList = (Array.isArray(ctx.projects) ? ctx.projects : []).map((p) => ({ id: p.id, name: p.name ?? '' }));
  const namesJob = (words: string) => jobList.length > 0 && resolveScope(words, jobList).scope === 'project';

  const hits: { id: AskActionCapability; at: number; verb: string }[] = [];
  if (first >= 0) {
    if (hasNegationBefore(toks, 0, first)) return [];
    for (let i = first; i < toks.length; i++) {
      const v = verbAt(toks, i);
      if (!v) continue;
      if (i !== first) {
        // A later verb starts its own clause ("… and add a punch item …").
        const joined = toks[i].afterPunct || CONJUNCTIONS.has(toks[i - 1]?.w ?? '') ||
          (CONJUNCTIONS.has(toks[i - 2]?.w ?? '') && ['also', 'then', 'please'].includes(toks[i - 1]?.w ?? ''));
        if (!joined) continue;
        if (hasNegationBefore(toks, Math.max(first, i - 3), i)) continue;
        if (v[0] === 'new') continue;
      }
      const verb = v.join(' ');
      const hit = nounAfter(toks, verb, i + v.length, scheduleWordsOk, namesJob);
      if (hit) hits.push({ id: hit.id, at: hit.at, verb });
      else if (verb.startsWith('price')) hits.push({ id: 'estimate', at: i, verb });
      else if (verb === 'bill' || verb === 'invoice') hits.push({ id: 'invoice', at: i, verb });
      i += v.length - 1;
    }
  }
  // "Push framing a week" / "move the inspection milestone": an imperative
  // change the schedule editor takes, on a job whose tasks it names.
  if (hits.length === 0 && scheduleWordsOk && SCHEDULE_EDIT_LEAD.test(rest) && !hasNegationBefore(toks, 0, toks.length)) {
    hits.push({ id: 'schedule', at: start, verb: 'edit' });
  }

  const seen = new Set<string>();
  const out: AskActionProposal[] = [];
  for (const h of hits.sort((a, b) => a.at - b.at)) {
    const p = buildProposal(h.id, text, ctx, 'request', h.verb);
    if (seen.has(p.capabilityId)) continue;
    seen.add(p.capabilityId);
    out.push(p);
    if (out.length >= ASK_ACTION_MAX) break;
  }
  return scheduleLast(out);
}

/**
 * An app how-to question ("how do I create a project") that MAGE can do for
 * him instead. Ask still answers it from the guide; this is the offer under
 * the answer. Nothing is handed over as words (the question is not the job).
 */
export function howToOffer(raw: string, ctx: AskActionContext): AskActionProposal | null {
  const text = norm(raw ?? '');
  if (!text || text.length > ASK_ACTION_MAX_CHARS || !isAppHowTo(text)) return null;
  if (/\b(create|start|make|set up|open)\b[\s\S]*\b(project|job)s?\b(?!\s+hazard)/i.test(text)) {
    return buildProposal('new_project', text, ctx, 'howto', 'create');
  }
  if (/\b(create|build|make|set up|start)\b[\s\S]*\b(schedule|timeline|gantt)\b/i.test(text)) {
    return buildProposal('schedule', text, ctx, 'howto', 'build');
  }
  return null;
}

/** True when the card should say "You'll pick the job next": a job-scoped
 *  workflow with no job yet that is not a schedule pick (the card lists those
 *  jobs itself). A PROJECT_FREE workflow (new project, lead) has no job to
 *  pick, and /copilot shows no picker for it. */
export function needsJobPick(p: Pick<AskActionProposal, 'capabilityId' | 'projectId' | 'schedule'>): boolean {
  if (PROJECT_FREE.has(p.capabilityId) || p.projectId) return false;
  return !(p.capabilityId === 'schedule' && p.schedule?.kind === 'pick');
}

/** Re-derive a stored proposal's precondition from the live jobs: a card that
 *  was blocked on "no estimate yet" un-blocks once the estimate exists. */
export function refreshPrecondition(p: AskActionProposal, projects: readonly AskProjectLike[]): AskActionProposal {
  if (PROJECT_FREE.has(p.capabilityId)) return p;
  const job = p.projectId ? (projects ?? []).find((x) => x.id === p.projectId) ?? null : null;
  const precondition = preconditionFor(p.capabilityId, p.schedule, job);
  const same = precondition.ok === p.precondition.ok && (precondition.ok || (!p.precondition.ok && precondition.kind === p.precondition.kind));
  return same ? p : { ...p, precondition };
}

// ─── outcome (M6) ──────────────────────────────────────────────────────────

/** djb2 over a JSON dump: any change to the value changes the key. */
function hash(value: unknown): string {
  let s = '';
  try { s = JSON.stringify(value) ?? ''; } catch { s = ''; }
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${s.length}:${h.toString(36)}`;
}

/** The PLAN fields of a task: what the builder and the editor write (add,
 *  move, lengthen, rename, re-link, remove). Progress, status, notes and
 *  checklists are left out, so a teammate's progress update synced in while
 *  he was away does not read as "Saved". */
const planOf = (t: unknown): unknown => {
  if (!t || typeof t !== 'object') return t;
  const x = t as Record<string, unknown>;
  return [x.id, x.title, x.phase, x.startDay, x.durationDays, x.dependencies, x.dependencyLinks, x.isMilestone, x.parentId];
};
const scheduleKeyOf = (p: AskProjectLike): string | null => {
  const s = p.schedule;
  if (!s) return null;
  const tasks = Array.isArray(s.tasks) ? s.tasks : [];
  return `${p.id}|${s.id ?? ''}|${tasks.length}|${hash(tasks.map(planOf))}`;
};
const estimateKeyOf = (p: AskProjectLike): string | null => {
  const e = p.linkedEstimate;
  if (!e) return null;
  const items = Array.isArray(e.items) ? e.items : [];
  return `${p.id}|${e.id ?? ''}|${items.length}|${e.grandTotal ?? ''}|${hash(items)}`;
};

/** The collection a capability's records land in (ProjectContext). */
const COLLECTION: Partial<Record<AskActionCapability, Exclude<keyof AskActionData, 'projects'>>> = {
  change_order: 'changeOrders',
  rfi: 'rfis',
  daily_report: 'dailyReports',
  punch: 'punchItems',
  invoice: 'invoices',
  submittal: 'submittals',
  permit: 'permits',
  lead: 'leads',
};

const arr = <T>(x: readonly T[] | null | undefined): readonly T[] => (Array.isArray(x) ? x : []);

export function snapshotForAction(p: AskActionProposal, data: AskActionData): AskActionSnapshot {
  const projects = arr(data.projects);
  const ids: Record<string, string[]> = {
    projects: projects.map((x) => x.id),
    schedule: projects.map(scheduleKeyOf).filter((k): k is string => !!k),
    estimate: projects.map(estimateKeyOf).filter((k): k is string => !!k),
  };
  for (const key of Object.values(COLLECTION)) {
    if (key) ids[key] = arr(data[key]).map((r) => r.id);
  }
  const job = p.projectId ? projects.find((x) => x.id === p.projectId) : undefined;
  const snap: AskActionSnapshot = { ids };
  const sk = job ? scheduleKeyOf(job) : null;
  const ek = job ? estimateKeyOf(job) : null;
  if (sk) snap.scheduleKey = sk;
  if (ek) snap.estimateId = ek;
  return snap;
}

const detailHref = (id: string) => ({ pathname: '/project-detail', params: { id } });

function recordLabel(p: AskActionProposal, r: AskRecordLike): string {
  const words = (r.subject || r.title || r.name || r.permitNumber || '').trim();
  const num = r.number !== undefined && r.number !== null && String(r.number).trim() !== '' ? `#${String(r.number).trim()}` : '';
  const head = num ? `${p.label} ${num}` : p.label;
  return words ? `${head}: ${words}` : head;
}

/** "Schedule · Henderson Remodel": what was saved, and on which job. */
function jobLabel(p: AskActionProposal, projects: readonly AskProjectLike[], pid: string): string {
  const name = projects.find((x) => x.id === pid)?.name;
  return name ? `${p.label} · ${name}` : p.label;
}

/** A fingerprint (`<projectId>|…`) present now that was not there before, on
 *  the proposal's job when it has one. Returns the job id it belongs to. */
function changedJob(before: string[] | undefined, now: string[], projectId: string): string | null {
  const had = new Set(before ?? []);
  for (const k of now) {
    if (had.has(k)) continue;
    const pid = k.slice(0, k.indexOf('|'));
    if (!projectId || pid === projectId) return pid;
  }
  return null;
}

/**
 * What Start actually produced, from the app's own records. Never 'saved'
 * from navigation: only a record (or a schedule / estimate change) present in
 * ProjectContext now and absent at Start counts.
 */
export function actionOutcome(p: AskActionProposal, before: AskActionSnapshot, now: AskActionData): AskActionOutcome {
  const projects = arr(now.projects);
  const b = before?.ids ?? {};
  switch (p.capabilityId) {
    case 'new_project': {
      const had = new Set(b.projects ?? []);
      const fresh = projects.find((x) => x && x.id && !had.has(x.id));
      return fresh ? { kind: 'saved', label: fresh.name, href: detailHref(fresh.id) } : { kind: 'nothing' };
    }
    case 'schedule':
    case 'scheduleEdit': {
      const nowKeys = projects.map(scheduleKeyOf).filter((k): k is string => !!k);
      const pid = changedJob(b.schedule, nowKeys, p.projectId);
      if (pid) return { kind: 'saved', label: jobLabel(p, projects, pid), href: scheduleViewHref(pid, 'ask') as { pathname: string; params: Record<string, string> } };
      // The builder writes a schedule; the editor / a view may change nothing
      // on purpose, so it claims nothing either way.
      return p.capabilityId === 'schedule' && (!p.schedule || p.schedule.kind === 'build') ? { kind: 'nothing' } : { kind: 'unobserved' };
    }
    case 'estimate':
    case 'estimateEdit': {
      const nowKeys = projects.map(estimateKeyOf).filter((k): k is string => !!k);
      const pid = changedJob(b.estimate, nowKeys, p.projectId);
      return pid ? { kind: 'saved', label: jobLabel(p, projects, pid), href: detailHref(pid) } : { kind: 'nothing' };
    }
    default: {
      const key = COLLECTION[p.capabilityId];
      if (!key) return { kind: 'unobserved' };
      const had = new Set(b[key] ?? []);
      const fresh = arr(now[key]).find((r) => r && r.id && !had.has(r.id) && (!p.projectId || r.projectId === p.projectId));
      if (!fresh) return { kind: 'nothing' };
      if (p.capabilityId === 'lead') return { kind: 'saved', label: fresh.name || undefined };
      const pid = fresh.projectId || p.projectId;
      return { kind: 'saved', label: recordLabel(p, fresh), ...(pid ? { href: detailHref(pid) } : {}) };
    }
  }
}
