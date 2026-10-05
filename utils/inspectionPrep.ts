// utils/inspectionPrep.ts — Inspection Ready: the pre-inspection checklist that
// learns from the contractor's OWN inspector. PURE: no React, no RN, no
// storage, no network. scripts/validate-inspection-prep.ts drives the real
// functions under bun.
//
// WHAT IT IS FOR
//   Three days before an inspection the GC gets one list, top to bottom:
//     1. what HIS inspector with THIS authority flagged before — the notes he
//        typed into the permit history, reproduced verbatim with their date
//        (utils/permitInspectionFacts.ts renders them; nothing here rewrites
//        an inspector's words);
//     2. what this job's own estimate says is in scope for the trade;
//     3. what an inspector commonly checks, from MODEL RECALL, labelled as
//        such, never carrying a figure, and with low-confidence items split
//        into their own "verify on site" group.
//   After the inspection he taps Pass or Fail, types what the inspector
//   wrote, and that note is filed on the permit history — so next time the
//   same authority inspects his work, it leads group 1.
//
// HONESTY RULES THIS FILE HOLDS
//   - Never a name invented from the permit type ("Electrical inspection" on
//     a plumbing rough-in). The name is the permit phase, the history row's
//     name, the schedule task's title, or plainly 'Inspection'.
//   - Never an anchor invented for an undated schedule (scheduleOps: THERE IS
//     NO FALLBACK ANCHOR). An undated schedule contributes no inspection.
//   - A codeRef survives only when the model actually gave one.
//   - The recall list never shows a model code's wording. Every recall line
//     goes through the code cards' own-words gate (recallOwnWords) before the
//     checklist is built; what was taken out is counted, and the sheet says
//     so once, with the section numbers still shown.
//   - Recording a result never erases an earlier called inspection or its
//     notes: the old called head is folded into the history BEFORE the head
//     moves (foldCurrentInspection already skips a row that matches it).

import type { Permit, PermitInspection, PermitType, Project, PunchItem, ScheduleTask } from '@/types';
import { daysUntilCalendarDay, parseCalendarDay, toCalendarDayString } from '@/utils/calendarDate';
import {
  decodePermitInspectionNotes,
  encodePermitInspectionNotes,
  foldCurrentInspection,
  inspectionResultForStatus,
  sortPermitInspections,
} from '@/utils/permitInspectionHistory';
import { inspectionHistoryFactsFor, type InspectionHistoryGrounding } from '@/utils/permitInspectionFacts';
import { resolveScheduleAnchor, taskCalendarRange } from '@/utils/scheduleOps';
import { ROADMAP_FEATURE } from '@/utils/automation/roadmapToScheduleWork';
import type { CodePin, CodeStage } from '@/utils/codeCard/types';
import { PLAIN_SENTENCE_RULE, SPECIFICS_RULE, ownWordsProse, sectionsIn } from '@/utils/codeCard/echoCheck';
import {
  issuingAuthorityForAddress,
  jurisdictionQueryForProject,
  type JurisdictionGrounding,
} from '@/utils/codeJurisdiction';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Local calendar days 0..N ahead that count as "coming up". */
export const PREP_WINDOW_DAYS = 3;
/** Rendered as a fixed <Text> by the sheet. Never model text. */
export const PREP_DISCLAIMER = 'Prep list, not a code review. Not a substitute for the adopted code. Confirm with your building department.';
/** Device-local prep state (N/A marks, linked punch ids, answers, recall). */
export const PREP_STORAGE_KEY = 'mageid_inspection_prep_v1';

const HISTORY_CAP = 4;
const SCOPE_CAP = 5;
const RECALL_CAP = 8;
const FOLLOW_UP_CAP = 3;

// ─── Types ────────────────────────────────────────────────────────────────────

export type PrepSource = { kind: 'permit'; permitId: string } | { kind: 'task'; taskId: string };

export interface UpcomingInspection {
  key: string;
  projectId: string;
  name: string;
  /** Calendar day 'YYYY-MM-DD'. */
  day: string;
  daysUntil: number;
  source: PrepSource;
  authority: string | null;
  category: string | null;
  permitId: string | null;
  taskId: string | null;
  taskName: string | null;
}

/** 'pinned' = a code card pinned to this inspection's stage (lane CCWIRE). */
export type PrepGroup = 'history' | 'scope' | 'recall' | 'verify' | 'pinned';

export interface PrepItem {
  id: string;
  group: PrepGroup;
  text: string;
  why: string;
  quoteDate?: string;
  codeRef?: string;
  confidence?: 'high' | 'med' | 'low';
  /** 'pinned' only: the pinned code card's own id, so the sheet can unpin it. */
  pinItemId?: string;
}

export interface RecallAnswer {
  items: { text: string; codeRef: string; confidence: 'high' | 'med' | 'low'; why: string }[];
  followUps: { question: string; options: string[] }[];
}

// ─── Small helpers ────────────────────────────────────────────────────────────

/** FNV-1a content fingerprint (not security). Stable across runs. */
function digest(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

function itemId(group: PrepGroup, text: string): string {
  return `${group}_${digest(`${group}|${text}`)}`;
}

function inWindow(day: string, now: Date): number | null {
  const d = daysUntilCalendarDay(day, now);
  if (d === null || d < 0 || d > PREP_WINDOW_DAYS) return null;
  return d;
}

function isFinishedTask(task: ScheduleTask): boolean {
  const status = String(task.status ?? '');
  return status === 'done' || status === 'complete' || (task.progress ?? 0) >= 100;
}

// ─── Category ─────────────────────────────────────────────────────────────────

const PERMIT_TYPE_CATEGORY: Partial<Record<PermitType, string>> = {
  electrical: 'electrical',
  plumbing: 'plumbing',
  fire: 'egress_fire',
  grading: 'zoning',
  special_inspection: 'structural',
};

/**
 * The utils/permitInspectionFacts category an inspection belongs to, or null
 * for the whole record. The name decides first; the permit type is only a
 * hint when the name says nothing.
 *
 * One deliberate refinement of the plain table: a bare "service" is read as
 * electrical only AFTER the plumbing words, so "Water service" and "Gas
 * service" are plumbing (the same trap validate-inspection-history-facts
 * caught in the facts module's own regex).
 */
export function inspectionCategoryFor(name: string, permitType?: PermitType | null): string | null {
  const n = (name ?? '').toLowerCase();
  if (/electric|wiring|panel/.test(n)) return 'electrical';
  if (/plumb|drain|water|gas/.test(n)) return 'plumbing';
  if (/\bservice\b/.test(n)) return 'electrical';
  if (/footing|foundation|framing|structural|rebar|slab/.test(n)) return 'structural';
  if (/fire|egress|sprinkler|smoke/.test(n)) return 'egress_fire';
  if (/\bada\b|accessib/.test(n)) return 'accessibility';
  if (/zoning|site|grading/.test(n)) return 'zoning';
  if (permitType && PERMIT_TYPE_CATEGORY[permitType]) return PERMIT_TYPE_CATEGORY[permitType] as string;
  return null;
}

// ─── Upcoming inspections ─────────────────────────────────────────────────────

/**
 * Every inspection on this job in the next PREP_WINDOW_DAYS local calendar
 * days (today included), from two sources:
 *   (a) the job's permits — the booked head, and any history row still
 *       'scheduled';
 *   (b) the job's schedule — roadmap-tagged tasks and tasks titled
 *       "…inspection…", only on a DATED schedule, only while unfinished.
 * Deduped on day + lowercased name (the permit wins), sorted by day.
 */
export function upcomingInspectionsFor(project: Project, permits: readonly Permit[], now: Date): UpcomingInspection[] {
  const out: UpcomingInspection[] = [];
  const seen = new Set<string>();
  const keys = new Set<string>();
  const push = (u: UpcomingInspection) => {
    const k = `${u.day}|${u.name.trim().toLowerCase()}`;
    if (seen.has(k)) return;
    seen.add(k);
    // Two differently named inspections on one permit on one day (a booked
    // head + a scheduled history row) would share permit:<id>:<day> — one
    // React key, one prep state. The first keeps the plain key (stable for
    // the common case); a later one gets its name's digest appended.
    const key = keys.has(u.key) ? `${u.key}:${digest(u.name.trim().toLowerCase())}` : u.key;
    keys.add(key);
    out.push(key === u.key ? u : { ...u, key });
  };

  // (a) permits
  for (const permit of permits) {
    if (permit.projectId !== project.id) continue;
    const authority = (permit.jurisdiction ?? '').trim() || null;
    const phase = (permit.phase ?? '').trim();
    const rows = decodePermitInspectionNotes(permit.inspectionNotes).inspections;
    const scheduledRows = rows.filter((r) => r.result === 'scheduled');

    const headDay = (permit.inspectionDate ?? '').slice(0, 10);
    if (headDay && permit.status !== 'inspection_passed' && permit.status !== 'inspection_failed') {
      const daysUntil = inWindow(headDay, now);
      if (daysUntil !== null) {
        const sameDayRow = scheduledRows.find((r) => r.scheduledFor.slice(0, 10) === headDay);
        const name = phase || (sameDayRow?.name ?? '').trim() || 'Inspection';
        push({
          key: `permit:${permit.id}:${headDay}`,
          projectId: project.id,
          name,
          day: headDay,
          daysUntil,
          source: { kind: 'permit', permitId: permit.id },
          authority,
          category: inspectionCategoryFor(name, permit.type),
          permitId: permit.id,
          taskId: null,
          taskName: null,
        });
      }
    }

    for (const row of scheduledRows) {
      const day = row.scheduledFor.slice(0, 10);
      const daysUntil = inWindow(day, now);
      if (daysUntil === null) continue;
      // The row's own name is the most specific thing the record has; the
      // generic 'Inspection' placeholder defers to the permit phase.
      const rowName = (row.name ?? '').trim();
      const name = (rowName && rowName !== 'Inspection' ? rowName : '') || phase || 'Inspection';
      push({
        key: `permit:${permit.id}:${day}`,
        projectId: project.id,
        name,
        day,
        daysUntil,
        source: { kind: 'permit', permitId: permit.id },
        authority,
        category: inspectionCategoryFor(name, permit.type),
        permitId: permit.id,
        taskId: null,
        taskName: null,
      });
    }
  }

  // (b) schedule tasks
  const schedule = project.schedule;
  if (schedule && Array.isArray(schedule.tasks) && schedule.tasks.length > 0) {
    const anchor = resolveScheduleAnchor(schedule, now);
    if (anchor.dated && anchor.date) {
      const authority = issuingAuthorityForAddress(jurisdictionQueryForProject(project));
      for (const task of schedule.tasks) {
        const title = (task.title ?? '').trim();
        const tagged = task.sourceEventRef?.feature === ROADMAP_FEATURE;
        if (!tagged && !/\binspection\b/i.test(title)) continue;
        if (isFinishedTask(task)) continue;
        const range = taskCalendarRange(task, anchor.date, schedule.workingDaysPerWeek, schedule.nonWorkingDates);
        const day = toCalendarDayString(range.start);
        const daysUntil = inWindow(day, now);
        if (daysUntil === null) continue;
        const name = title || 'Inspection';
        push({
          key: `task:${task.id}:${day}`,
          projectId: project.id,
          name,
          day,
          daysUntil,
          source: { kind: 'task', taskId: task.id },
          authority,
          category: inspectionCategoryFor(name, null),
          permitId: null,
          taskId: task.id,
          taskName: title || null,
        });
      }
    }
  }

  return out.sort((a, b) => (a.day !== b.day ? (a.day < b.day ? -1 : 1) : a.name.localeCompare(b.name)));
}

// ─── Scope (this job's estimate) ──────────────────────────────────────────────

type ScopeTrade = { divisions: readonly string[]; re: RegExp };

const SCOPE_TRADES: Record<string, ScopeTrade> = {
  electrical: { divisions: ['26'], re: /electric|wiring|panel|circuit|breaker|conduit|lighting|receptacle|outlet/i },
  plumbing: { divisions: ['22'], re: /plumb|drain|water heater|water line|sewer|gas (?:line|pipe|piping)|dwv|backflow/i },
  mechanical: { divisions: ['23'], re: /hvac|mechanical|duct|furnace|heat pump|condenser|exhaust fan/i },
  structural: { divisions: ['03', '04', '05', '06'], re: /concrete|footing|foundation|framing|rebar|masonry|steel beam|header|joist|shear/i },
  egress_fire: { divisions: ['21'], re: /sprinkler|fire alarm|smoke (?:alarm|detector)|fire.?rated|egress window/i },
  accessibility: { divisions: [], re: /\bada\b|grab bar|ramp|accessib/i },
  zoning: { divisions: [], re: /grading|excavat|site work|sitework|erosion/i },
};

/** The trade whose estimate lines are "this inspection's scope". A category
 *  first; a mechanical inspection has no facts category, so its name decides. */
function scopeTradeFor(inspection: UpcomingInspection): ScopeTrade | null {
  if (inspection.category && SCOPE_TRADES[inspection.category]) return SCOPE_TRADES[inspection.category];
  if (/mechanic|hvac|duct/i.test(inspection.name)) return SCOPE_TRADES.mechanical;
  return null;
}

function csiOf(raw: string | undefined): string | null {
  const m = /^\s*(\d{1,2})/.exec(raw ?? '');
  return m ? m[1].padStart(2, '0') : null;
}

function qtyText(q: number): string {
  if (!Number.isFinite(q)) return '';
  return String(Math.round(q * 100) / 100);
}

// ─── The recall list, in MAGE's own words only ───────────────────────────────
//
// COPYRIGHT. The recall list is AI text about a model code, so it passes the
// same own-words gate as a code card (utils/codeCard/echoCheck.ts, prose
// mode: sentence by sentence, no length cap) BEFORE the checklist reads it.
//   - text      a sentence that reads like code text is taken out; a line
//               with nothing left is dropped (it is never a checklist row, a
//               punch item or a photo check).
//   - why       its words, or nothing.
//   - codeRef   a short reference as the model gave it; when it carries
//               anything else (a quoted title, a sentence), only the section
//               numbers in it are kept.
//   - a follow-up question is asked whole or not at all.
// What was taken out is COUNTED, with the references of the lines it came
// from, so the sheet can say it once and still show the section numbers.

/** What the gate took out of one recall answer. */
export interface RecallWithheld {
  /** Sentences, references and questions taken out. 0 = nothing was hidden. */
  count: number;
  /** The references of the lines something was taken out of, each once. */
  codeRefs: string[];
}

/** A code reference is short: an edition and a section number. */
const CODE_REF_MAX = 60;

/** A recall answer with every line through the own-words gate. Pure. */
export function recallOwnWords(recall: RecallAnswer | null | undefined): {
  items: RecallAnswer['items'];
  followUps: RecallAnswer['followUps'];
  withheld: RecallWithheld;
} {
  const items: RecallAnswer['items'] = [];
  const followUps: RecallAnswer['followUps'] = [];
  const codeRefs: string[] = [];
  let count = 0;
  for (const it of recall?.items ?? []) {
    const text = ownWordsProse(it.text, { notice: false });
    const why = ownWordsProse(it.why, { notice: false });
    const ref = ownWordsProse(it.codeRef, { notice: false });
    const refOk = ref.withheld === 0 && ref.text.length <= CODE_REF_MAX;
    const codeRef = refOk ? ref.text : sectionsIn(typeof it.codeRef === 'string' ? it.codeRef : '').join(', ');
    const hidden = text.withheld + why.withheld + (refOk ? 0 : 1);
    if (hidden > 0) {
      count += hidden;
      if (codeRef && !codeRefs.includes(codeRef)) codeRefs.push(codeRef);
    }
    if (!text.text) continue;
    items.push({ text: text.text, codeRef, confidence: it.confidence, why: why.text });
  }
  for (const f of recall?.followUps ?? []) {
    const question = ownWordsProse(f.question, { notice: false });
    const options = (f.options ?? []).map((o) => ownWordsProse(String(o), { notice: false }));
    if (question.withheld > 0 || options.some((o) => o.withheld > 0)) { count += 1; continue; }
    followUps.push({ question: question.text, options: options.map((o) => o.text) });
  }
  return { items, followUps, withheld: { count, codeRefs } };
}

// ─── The checklist ────────────────────────────────────────────────────────────

export function buildChecklist(a: {
  inspection: UpcomingInspection;
  project: Project;
  permits: readonly Permit[];
  recall?: RecallAnswer | null;
}): {
  items: PrepItem[];
  history: InspectionHistoryGrounding;
  followUps: RecallAnswer['followUps'];
  /** What the own-words gate took out of the recall answer (count 0 = nothing). */
  recallWithheld: RecallWithheld;
} {
  const { inspection, project, permits } = a;
  // The AI's answer is read HERE, through the gate, and nowhere else.
  const recall = recallOwnWords(a.recall);
  const items: PrepItem[] = [];
  const ids = new Set<string>();
  const add = (it: PrepItem) => {
    if (ids.has(it.id)) return false;
    ids.add(it.id);
    items.push(it);
    return true;
  };

  // 1. What his inspector wrote before — verbatim, from the facts module.
  const history = inspectionHistoryFactsFor(permits, inspection.authority, inspection.category);
  for (const q of history.quotes.slice(0, HISTORY_CAP)) {
    add({ id: itemId('history', q.line), group: 'history', text: q.line, why: 'From your inspection record', quoteDate: q.date });
  }

  // 2. What this job's estimate puts in scope for the trade.
  const trade = scopeTradeFor(inspection);
  if (trade) {
    let n = 0;
    for (const line of project.linkedEstimate?.items ?? []) {
      if (n >= SCOPE_CAP) break;
      const name = (line.name ?? '').trim();
      if (!name) continue;
      const csi = csiOf(line.csiDivision);
      const hit = (csi !== null && trade.divisions.includes(csi)) || trade.re.test(`${name} ${line.category ?? ''}`);
      if (!hit) continue;
      const qty = qtyText(line.quantity);
      const unit = (line.unit ?? '').trim();
      const text = qty ? `${name} (${qty}${unit ? ` ${unit}` : ''})` : name;
      if (add({ id: itemId('scope', text), group: 'scope', text, why: `From this project's estimate: ${name}` })) n += 1;
    }
  }

  // 3. Model recall — high/med first, then the low-confidence ones to verify.
  const covered = new Set(items.map((i) => i.text.trim().toLowerCase()));
  const recallItems = recall.items.filter((r) => !covered.has(r.text.toLowerCase()));
  const ordered = [
    ...recallItems.filter((r) => r.confidence === 'high' || r.confidence === 'med'),
    ...recallItems.filter((r) => r.confidence !== 'high' && r.confidence !== 'med'),
  ];
  let r = 0;
  for (const it of ordered) {
    if (r >= RECALL_CAP) break;
    const confident = it.confidence === 'high' || it.confidence === 'med';
    const group: PrepGroup = confident ? 'recall' : 'verify';
    const item: PrepItem = {
      id: itemId(group, it.text),
      group,
      text: it.text,
      why: it.why,
      confidence: confident ? it.confidence : 'low',
    };
    if (it.codeRef) item.codeRef = it.codeRef;
    if (add(item)) r += 1;
  }

  const followUps = recall.followUps
    .map((f) => ({ question: f.question, options: f.options.filter(Boolean).slice(0, 4) }))
    .filter((f) => f.question && f.options.length >= 2)
    .slice(0, FOLLOW_UP_CAP);

  return { items, history, followUps, recallWithheld: recall.withheld };
}

// ─── The recall prompt ────────────────────────────────────────────────────────

/** Moves with the prompt's wording: the last part of the recall cache key. */
export const RECALL_PROMPT_VERSION = 'specific1';

export function buildRecallPrompt(a: {
  inspection: UpcomingInspection;
  project: Project;
  jurisdiction: JurisdictionGrounding;
  covered: readonly PrepItem[];
  answers: Readonly<Record<string, string>>;
}): { prompt: string; cacheKey: string } {
  const { inspection, project, jurisdiction, covered, answers } = a;
  const scope = covered.filter((c) => c.group === 'scope').map((c) => c.text);
  const already = covered.filter((c) => c.group === 'history' || c.group === 'scope').map((c) => c.text);
  const sortedAnswers = Object.keys(answers)
    .sort()
    .filter((k) => (answers[k] ?? '').trim())
    .map((k) => [k, answers[k]] as [string, string]);

  const lines: string[] = [
    jurisdiction.promptBlock,
    '',
    `INSPECTION: ${inspection.name} on ${inspection.day}${inspection.authority ? `, with ${inspection.authority}` : ''}.`,
    `JOB: ${(project.name ?? '').trim() || 'this job'}.`,
    '',
    'TRADE SCOPE ON THIS JOB (from its estimate):',
    ...(scope.length ? scope.map((s) => `- ${s}`) : ['- none matched this inspection']),
    '',
    'ALREADY COVERED (do not repeat):',
    ...(already.length ? already.map((s) => `- ${s}`) : ['- nothing yet']),
    '',
    'ANSWERS SO FAR:',
    ...(sortedAnswers.length ? sortedAnswers.map(([q, ans]) => `- ${q} ${ans}`) : ['- none']),
    '',
    'RULES:',
    '- List what an inspector commonly checks at this inspection, from your recall of the model codes. You cannot look anything up.',
    // The figure IS the check. Until 2026-10-04 this line told the AI never to
    // state a dimension, so the list read "check the guard height" with no
    // height. The recall group is labelled AI recall on the sheet, and its low-
    // confidence lines sit under Verify, so the figure is stated and labelled,
    // not left out.
    '- State the figure the inspector checks against, with its unit and when it applies. It is shown as AI recall to confirm with the building department, so never leave it out. When you do not know the figure, say what the inspector checks and mark confidence low.',
    '- Give a codeRef only when you are certain of it, using the edition named above; otherwise leave it empty.',
    ...(jurisdiction.grounded ? [] : ['- No edition is named above, so leave every codeRef empty.']),
    '- Mark confidence low when unsure.',
    '- Ask at most 3 follow-up questions, each with 2-4 short tap options, only when the answer changes the list (e.g. "Any basement bedrooms?" Yes / No / Not sure).',
    '- Each item: text (what the inspector checks, with the figure and its unit, one short line), codeRef, confidence (high, med or low), why (one short line).',
    // Copyright: the same sentence every code prompt carries.
    '- Write every requirement in your own words. Never quote or reproduce the text of any model code (ICC, NFPA) word for word.',
    // ...and the Code Check prompt's own next line (one source): short plain
    // sentences, no quotation marks, in. and ft. The own-words gate withholds
    // a line that carries a quotation mark, so the AI is told not to write one.
    `- ${PLAIN_SENTENCE_RULE}`,
    // ...and the specifics rule (one source): the number is stated, as recall.
    `- ${SPECIFICS_RULE}`,
  ];
  const prompt = lines.join('\n');
  // RECALL_PROMPT_VERSION: an answer cached under the prompt's earlier wording is
  // not replayed (the 24 h AI cache is keyed on this string).
  const cacheKey = `inspection_prep::${inspection.key}::${jurisdiction.cacheKey}::${digest(covered.map((c) => c.text).join('\n'))}::${JSON.stringify(sortedAnswers)}::${RECALL_PROMPT_VERSION}`;
  return { prompt, cacheKey };
}

// ─── Recording the result ─────────────────────────────────────────────────────

/**
 * The permit patch that files one called inspection on the permit history.
 *
 * A result on or after the permit's head day becomes the head (status +
 * inspectionDate + phase + notes). Before it moves, the OLD head is folded
 * into the history whatever its state — a called head keeps its inspector
 * note, and a head that was only BOOKED (another inspection, another name)
 * survives as its own 'scheduled' row instead of being silently erased.
 *
 * The one rule that keeps the permit record honest: the head this returns is
 * already in the history, under its own name, as the FIRST row of its day.
 * The permits screen runs foldCurrentInspection(head, phase) on every save;
 * with phase = the row's name and the row first in its day, that fold finds
 * this row and changes nothing — it can never invent a second, differently
 * named failed row carrying the same inspector note, nor rewrite another
 * inspection booked for the same day.
 *
 * A result on an EARLIER day is history only: it resolves a matching
 * still-scheduled row in place, or appends a row, and never touches the head.
 */
export function recordInspectionResult(
  permit: Permit,
  r: { name: string; day: string; result: 'passed' | 'failed'; notes: string; inspectorName?: string },
  now: string,
  newId: () => string,
): Partial<Permit> {
  const decoded = decodePermitInspectionNotes(permit.inspectionNotes);
  let rows: PermitInspection[] = decoded.inspections;
  const day = r.day.slice(0, 10);
  const headDay = (permit.inspectionDate ?? '').slice(0, 10);
  const name = (r.name ?? '').trim() || 'Inspection';
  const notes = (r.notes ?? '').trim();
  const inspectorName = (r.inspectorName ?? '').trim() || undefined;

  if (!headDay || day >= headDay) {
    // 1. Preserve the old head first — called OR booked. foldCurrentInspection
    //    is idempotent: a head already in the history is left alone, a booked
    //    head resolves a same-day scheduled row in place or gets its own row.
    if (headDay && inspectionResultForStatus(permit.status)) {
      rows = foldCurrentInspection({
        inspections: rows,
        status: permit.status,
        inspectionDate: headDay,
        inspectionNotes: decoded.notes,
        phase: permit.phase,
        inspectorName: permit.inspectorName,
        now,
        newId,
      });
    }
    // 2. The new result, on the row that IS this inspection: same day and the
    //    same name (a correction), else a same-day scheduled placeholder with
    //    no name of its own, else a new row. A differently named inspection
    //    that day is never taken over.
    const status = r.result === 'passed' ? 'inspection_passed' : 'inspection_failed';
    const lower = name.toLowerCase();
    const isPlaceholder = (row: PermitInspection) => !(row.name ?? '').trim() || (row.name ?? '').trim() === 'Inspection';
    let idx = rows.findIndex((row) => row.scheduledFor.slice(0, 10) === day && (row.name ?? '').trim().toLowerCase() === lower);
    if (idx < 0) idx = rows.findIndex((row) => row.scheduledFor.slice(0, 10) === day && row.result === 'scheduled' && isPlaceholder(row));
    // Strictly newer than every other row that day, so the history sort (day
    // desc, then recordedAt desc) puts the head's row first in its day.
    let stampMs = Date.parse(now);
    for (const row of rows) {
      if (row.scheduledFor.slice(0, 10) !== day) continue;
      const t = Date.parse(row.recordedAt ?? '');
      if (Number.isFinite(t) && (!Number.isFinite(stampMs) || t >= stampMs)) stampMs = t;
    }
    const stamp = Number.isFinite(stampMs) ? new Date(stampMs + 1).toISOString() : now;
    const headRow: PermitInspection = idx >= 0
      ? {
          ...rows[idx],
          name: isPlaceholder(rows[idx]) ? name : (rows[idx].name ?? '').trim(),
          scheduledFor: day,
          result: r.result,
          notes: notes || undefined,
          inspectorName: inspectorName ?? rows[idx].inspectorName,
          recordedAt: stamp,
        }
      : { id: newId(), name, scheduledFor: day, result: r.result, notes: notes || undefined, inspectorName, recordedAt: stamp };
    const others = idx >= 0 ? rows.filter((_, i) => i !== idx) : rows;
    rows = sortPermitInspections([...others, headRow]);
    // 3. The head — named after its own row.
    return {
      status,
      inspectionDate: day,
      phase: headRow.name,
      inspectionNotes: encodePermitInspectionNotes(notes, rows),
      inspections: rows,
    };
  }

  // An earlier day: history only.
  const idx = rows.findIndex((row) =>
    row.scheduledFor.slice(0, 10) === day
    && row.result === 'scheduled'
    && ((row.name || 'Inspection').trim().toLowerCase() === name.toLowerCase() || (row.name || 'Inspection') === 'Inspection'));
  if (idx >= 0) {
    const next = [...rows];
    next[idx] = {
      ...rows[idx],
      name: rows[idx].name && rows[idx].name !== 'Inspection' ? rows[idx].name : name,
      result: r.result,
      notes: notes || undefined,
      inspectorName: inspectorName ?? rows[idx].inspectorName,
      recordedAt: now,
    };
    rows = sortPermitInspections(next);
  } else {
    rows = sortPermitInspections([
      ...rows,
      { id: newId(), name, scheduledFor: day, result: r.result, notes: notes || undefined, inspectorName, recordedAt: now },
    ]);
  }
  return { inspectionNotes: encodePermitInspectionNotes(decoded.notes, rows), inspections: rows };
}

// ─── Punch item from a prep item ──────────────────────────────────────────────

/**
 * An INTERNAL crew-list punch item for one prep line. Unassigned on purpose:
 * a sub sees it only once someone assigns it in Punch List (the sub portal's
 * RLS filters by assignment). No room — Inspection Ready has none to give.
 * Due the day before the inspection, never before today.
 */
export function punchForPrepItem(item: PrepItem, inspection: UpcomingInspection, now: string, newId: () => string): PunchItem {
  const insp = parseCalendarDay(inspection.day);
  let dueDate = inspection.day;
  if (insp) {
    const before = new Date(insp.getFullYear(), insp.getMonth(), insp.getDate() - 1);
    dueDate = toCalendarDayString(before);
    const nowDate = new Date(now);
    if (Number.isFinite(nowDate.getTime())) {
      const today = toCalendarDayString(nowDate);
      if (dueDate < today) dueDate = today;
    }
  }
  const punch: PunchItem = {
    id: newId(),
    projectId: inspection.projectId,
    description: `Before ${inspection.name}: ${item.text}`,
    location: '',
    assignedSub: '',
    dueDate,
    priority: item.group === 'history' ? 'high' : 'medium',
    status: 'open',
    listType: 'crew',
    createdAt: now,
    updatedAt: now,
  };
  if (inspection.source.kind === 'task') {
    punch.linkedTaskId = inspection.source.taskId;
    if (inspection.taskName) punch.linkedTaskName = inspection.taskName;
  }
  return punch;
}

/** The key one inspection's prep state is stored under. */
export function prepStateKey(inspection: UpcomingInspection): string {
  return inspection.key;
}

// ─── Pinned from code cards (lane CCWIRE) ─────────────────────────────────────
//
// A code card's "Checklist" action pins the card to one inspection stage on
// one job (utils/codeCard/pins.ts, device-local). Inspection Ready shows the
// job's pins for the inspection it is preparing, in their own group, BELOW
// the inspector's words and the job's scope (trust order holds: a pin is MAGE's
// paraphrase of a requirement whose section is usually AI recall).
//
// THE MATCH RULE (the simplest provable one): an inspection's stage is read
// off its NAME only (stageForInspectionName). A pin shows when its stage is
// that stage. A pin whose stage is 'other' shows on every inspection of the
// job, labelled as having no stage. An inspection whose name names no stage
// shows only the 'other' pins: MAGE never guesses which inspection a framing
// item belongs to from a vague name.

/**
 * The code-card stage an inspection is, from its name, or null when the name
 * names none. Order matters: "Final electrical" is a final, "Rough framing"
 * is framing (framing is checked before rough), "Foundation/footing" is a
 * footing (the earlier inspection).
 */
export function stageForInspectionName(name: string | null | undefined): Exclude<CodeStage, 'other'> | null {
  const n = (name ?? '').toLowerCase();
  if (/\bfinal\b|certificate of occupancy/.test(n)) return 'final';
  if (/footing/.test(n)) return 'footing';
  if (/foundation|\bslab\b|\brebar\b/.test(n)) return 'foundation';
  if (/fram/.test(n)) return 'framing';
  if (/insulat|energy/.test(n)) return 'insulation';
  if (/\brough\b|rough-in|\bmep\b|electric|plumb|mechanic|hvac|\bgas\b/.test(n)) return 'rough';
  return null;
}

/** The pin group's one-line source note (fixed; never model text). */
export const PINNED_NOTE = 'Pinned from code cards. In MAGE’s words; section from AI recall unless marked. Confirm with your building department.';

/**
 * The job's pins for this inspection, as prep items in the 'pinned' group,
 * newest first. Pure: the caller reads the pins store.
 */
export function pinnedPrepItems(pins: readonly CodePin[], inspection: Pick<UpcomingInspection, 'projectId' | 'name'>): PrepItem[] {
  const stage = stageForInspectionName(inspection.name);
  const seen = new Set<string>();
  return pins
    .filter((p) => p.projectId === inspection.projectId && (p.stage === 'other' || (stage !== null && p.stage === stage)))
    .slice()
    .sort((a, b) => (a.pinnedAt < b.pinnedAt ? 1 : a.pinnedAt > b.pinnedAt ? -1 : 0))
    .flatMap((p) => {
      const text = (p.item.summary ?? '').trim();
      if (!text) return [];
      const id = itemId('pinned', `${p.id}|${text}`);
      if (seen.has(id)) return [];
      seen.add(id);
      const ref = [(p.item.citedEdition ?? '').trim(), (p.item.section ?? '').trim()].filter(Boolean).join(' ');
      const item: PrepItem = {
        id,
        group: 'pinned',
        text,
        why: p.stage === 'other' ? 'Pinned from a code card · no inspection stage set' : 'Pinned from a code card',
        pinItemId: p.item.id,
      };
      if (ref) item.codeRef = ref;
      return [item];
    });
}

/**
 * The next booked inspection day per code-card stage on one job, for the plan
 * check's "By inspection" view: from each permit's booked head (not yet
 * passed or failed) and its still-'scheduled' history rows, on or after
 * `today`, staged by name with stageForInspectionName. A stage with no booked
 * day is absent (the list then says "Not booked"). Never a schedule guess.
 */
export function bookedStageDays(permits: readonly Permit[], projectId: string, today: string): Partial<Record<CodeStage, string>> {
  const out: Partial<Record<CodeStage, string>> = {};
  const take = (name: string, day: string) => {
    const d = (day ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < today) return;
    const stage = stageForInspectionName(name);
    if (!stage) return;
    const prev = out[stage];
    if (!prev || d < prev) out[stage] = d;
  };
  for (const permit of permits) {
    if (permit.projectId !== projectId) continue;
    const phase = (permit.phase ?? '').trim();
    if (permit.inspectionDate && permit.status !== 'inspection_passed' && permit.status !== 'inspection_failed') {
      take(phase, permit.inspectionDate);
    }
    for (const row of decodePermitInspectionNotes(permit.inspectionNotes).inspections) {
      if (row.result !== 'scheduled') continue;
      const rowName = (row.name ?? '').trim();
      take(rowName && rowName !== 'Inspection' ? rowName : phase, row.scheduledFor);
    }
  }
  return out;
}
