// utils/permitPath/buildRoute.ts — the Permit Path route. PURE and
// DETERMINISTIC: no React, no storage, no network, no clock (`today` is an
// input). The same inputs give the same route, byte for byte, whatever order
// the department answers or permits arrive in.
//
// What this file enforces (scripts/validate-permit-path-engine.ts pins each):
//   - the shape guard: verified ⇔ source, department_said ⇔ answer,
//     unknown ⇔ askQuestionId — normalised here, whatever a pack says;
//   - department answers match on (jurisdictionKey, questionId) only, never
//     under 'UNRESOLVED', latest answeredOn wins;
//   - the AI roadmap is a list of 'ai_draft' lines with no readiness and no
//     duration: its leadTimeDays is never read;
//   - station state comes from the project's own permit rows and the GC's own
//     sign-off mark; nothing infers "signed off" from a PermitStatus.

import type { Permit, PermitRoadmap } from '@/types';
import type { MeasuredReviewLead } from '@/utils/automation/learnedLeadTime';
import type { BuildingParcel } from '@/utils/buildingRecord';
import type { BuildingYear } from '@/utils/buildingScopeTriggers';
import { NAME_ONLY_BADGE, VILLAGE_CAUTION, type PermitOffice } from '@/utils/permitOffices';
import { PP_COPY } from '@/utils/permitPath/copy';
import { answerRef, durationFor, isDurationQuestionId, latestAnswer, type SavedDeptAnswer } from '@/utils/permitPath/durations';
import { activePacks, effectiveAnswers, interviewProgress, nextQuestion } from '@/utils/permitPath/interview';
import { evalPredicate, type PredicateCtx } from '@/utils/permitPath/predicate';
import { readinessFor } from '@/utils/permitPath/readiness';
import {
  STATION_ORDER,
  type DeptQuestion, type InterviewAnswers, type ItemTemplate, type Party, type PermitRoute, type QuestionPack,
  type ReadinessMarks, type RouteItem, type SourceRef, type Station, type StationId, type StationState,
} from '@/utils/permitPath/types';

export type { SavedDeptAnswer } from '@/utils/permitPath/durations';

export interface RouteInputs {
  projectId: string;
  jurisdiction: PermitRoute['jurisdiction'];
  answers: InterviewAnswers;
  marks: ReadinessMarks;
  deptAnswers: readonly SavedDeptAnswer[];
  /** Every permit the GC has. Station state reads only this project's rows;
   *  the learned review time reads his history with this authority. */
  permits: readonly Permit[];
  measured: MeasuredReviewLead | null;
  parcel: BuildingParcel | null;
  /** Carried for prefillFor and the inputs key. A year is used by the route
   *  only once the GC confirms it as the base.building_year answer. */
  buildingYear: { entered: BuildingYear | null; pluto: BuildingYear | null } | null;
  aiRoadmap: PermitRoadmap | null;
  /** 'YYYY-MM-DD'. */
  today: string;
  /** The resolved permit office (fills the li.office and li.village_caution slots). */
  office?: PermitOffice | null;
  /** scopeSummary(project). Fills "<scope>" in base.permit_needed. */
  scope?: string;
  /** The issuing authority string the GC's permits are filed under (learned tier). */
  authority?: string | null;
  /** Open violations on the building record; null when not read. */
  openViolations?: number | null;
}

/** Item ids whose text or source the engine fills from runtime data
 *  (li.village_caution only has its text pinned to VILLAGE_CAUTION). */
export const ENGINE_SLOT_IDS: readonly string[] = ['nyc.zoning_fact', 'li.office', 'li.village_caution'];
/** The department question that leads the ask list: nothing else can be asked
 *  until the GC knows which department issues. */
export const LEAD_DEPT_QUESTION_ID = 'base.which_department';
/** The GC's own mark that the department signed the job off. */
export const SIGNOFF_ITEM_ID = 'signoff.received';

/** Phrasings an AI roadmap line may not carry into Permit Path (PLAN §6.3). */
const AI_BANNED = /\bfiles?\s+(the\s+)?permits?\b|\bfile\s+(it\s+)?for\s+you\b/i;

const DATE_IN = /(\d{4}-\d{2}-\d{2})/;

// ─────────────────────────────────────────────────────────────────────
// Stable key
// ─────────────────────────────────────────────────────────────────────

export function stableStringify(v: unknown): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

/** The scopeHashOf idiom (utils/permitRoadmap.ts), doubled with FNV-1a so two
 *  32-bit hashes must collide at once. */
export function ppHash(s: string): string {
  let h = 0;
  let f = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h = (h * 31 + c) | 0;
    f = Math.imul(f ^ c, 0x01000193);
  }
  return `pp1-${(h >>> 0).toString(16)}-${(f >>> 0).toString(16)}`;
}

const byId = <T extends { id: string }>(xs: readonly T[]): T[] => [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export function routeInputsKey(inputs: RouteInputs, packs: readonly QuestionPack[]): string {
  const norm = { ...inputs, deptAnswers: byId(inputs.deptAnswers), permits: byId(inputs.permits) };
  return ppHash(stableStringify({ inputs: norm, packs }));
}

// ─────────────────────────────────────────────────────────────────────
// Items
// ─────────────────────────────────────────────────────────────────────

function fillTokens(text: string, inputs: RouteInputs): string {
  const scope = (inputs.scope ?? '').trim() || PP_COPY.scopeFallback;
  const zoning = inputs.parcel?.zoning?.length ? inputs.parcel.zoning.join(', ') : '';
  const version = inputs.parcel?.plutoVersion ?? '';
  return text
    .replace(/\{scope\}|<scope>/g, scope)
    .replace(/\{zoning\}|<districts>/g, zoning)
    .replace(/\{plutoVersion\}|<version>/g, version);
}

/** The office's own source, when it carries a URL and a checked date. */
function officeSource(office: PermitOffice | null | undefined): SourceRef | null {
  if (!office || !office.sourceUrl) return null;
  const d = DATE_IN.exec(office.sourceLabel);
  if (!d) return null;
  const label = office.sourceLabel.replace(/,?\s*(checked|as of)\s+\d{4}-\d{2}-\d{2}\s*$/i, '').trim() || office.sourceLabel;
  return { label, url: office.sourceUrl, checkedOn: d[1] };
}

/** The shape guard. Whatever a pack or slot says, an item leaves here with
 *  verified ⇔ source, department_said ⇔ answer, unknown ⇔ askQuestionId. */
function normalise(item: RouteItem): RouteItem {
  let { certainty, source, answer, askQuestionId } = item;
  if (certainty === 'verified' && !source) certainty = 'unknown';
  if (certainty === 'department_said' && !answer) certainty = 'unknown';
  if (certainty !== 'verified') source = null;
  if (certainty !== 'department_said') answer = null;
  if (certainty === 'unknown') askQuestionId = askQuestionId || item.id;
  else askQuestionId = null;
  return { ...item, certainty, source, answer, askQuestionId };
}

function instantiate(t: ItemTemplate, inputs: RouteInputs): RouteItem | null {
  const base: RouteItem = {
    id: t.id, station: t.station, kind: t.kind, text: fillTokens(t.text, inputs), who: [...t.who],
    certainty: t.certainty, source: t.source, answer: null, askQuestionId: t.askQuestionId, readiness: t.readiness,
  };
  if (t.id === 'nyc.zoning_fact') {
    const p = inputs.parcel;
    if (!p || p.status !== 'ok' || !p.zoning.length) return null;
    const text = /\{zoning\}|<districts>/.test(t.text) ? base.text : PP_COPY.zoningFact(p.zoning, p.plutoVersion);
    return { ...base, text };
  }
  if (t.id === 'li.office') {
    const o = inputs.office;
    if (!o) return null;
    const src = o.verification === 'hand-verified' ? officeSource(o) : null;
    const facts = PP_COPY.officeFact(o.title, o.phone, o.hours);
    const text = o.verification === 'name-only' ? `${facts} · ${NAME_ONLY_BADGE}` : facts;
    return src ? { ...base, text, certainty: 'verified', source: src } : { ...base, text, certainty: 'unknown', source: null };
  }
  if (t.id === 'li.village_caution') {
    // Verbatim, always. The engine never raises it to verified: no office page
    // states it, and citing the office's page for it would put a real URL next
    // to a claim that page does not make. Only a pack source can verify it.
    return t.certainty === 'verified' && t.source
      ? { ...base, text: VILLAGE_CAUTION }
      : { ...base, text: VILLAGE_CAUTION, certainty: 'unknown', source: null, askQuestionId: t.askQuestionId ?? LEAD_DEPT_QUESTION_ID };
  }
  return base;
}

const sub = (whoPulls: string): Party[] => (whoPulls === 'gc' ? ['gc'] : whoPulls === 'owner' ? ['owner'] : []);

function aiItems(roadmap: PermitRoadmap | null): RouteItem[] {
  if (!roadmap) return [];
  const out: RouteItem[] = [];
  const add = (id: string, station: StationId, title: string, who: Party[]) => {
    const text = (title ?? '').trim();
    if (!text || AI_BANNED.test(text)) return;
    out.push({ id, station, kind: 'need', text, who, certainty: 'ai_draft', source: null, answer: null, askQuestionId: null, readiness: false });
  };
  for (const p of roadmap.permits ?? []) add(`ai.permit.${p.id}`, 'filing', p.title, sub(p.whoPulls));
  for (const i of roadmap.inspections ?? []) add(`ai.inspection.${i.id}`, 'work', i.title, []);
  return out;
}

const INSPECTION_STATES = ['inspection_scheduled', 'inspection_passed', 'inspection_failed'];

// ─────────────────────────────────────────────────────────────────────
// The route
// ─────────────────────────────────────────────────────────────────────

export function buildPermitRoute(inputs: RouteInputs, packs: readonly QuestionPack[]): PermitRoute {
  const j = inputs.jurisdiction;
  const ctx: PredicateCtx = { answers: inputs.answers, family: j.family, countyFips: j.countyFips, signals: { openViolations: inputs.openViolations ?? null } };
  const active = activePacks(packs, ctx);
  const ectx: PredicateCtx = { ...ctx, answers: effectiveAnswers(packs, ctx) };
  const holds = (p: Parameters<typeof evalPredicate>[0] | null) => p == null || evalPredicate(p, ectx);

  // Skips: the first holding rule for a station wins.
  const skipped = new Map<StationId, string>();
  for (const pack of active) for (const s of pack.skips) {
    if (!skipped.has(s.station) && evalPredicate(s.when, ectx)) skipped.set(s.station, s.because);
  }

  // Active department questions (askIf holds), first definition of an id wins.
  const activeDq: DeptQuestion[] = [];
  for (const pack of active) for (const dq of pack.deptQuestions) {
    if (!activeDq.some((d) => d.id === dq.id) && holds(dq.askIf)) activeDq.push(dq);
  }
  const allDq = new Map<string, DeptQuestion>();
  for (const pack of packs) for (const dq of pack.deptQuestions) if (!allDq.has(dq.id)) allDq.set(dq.id, dq);

  const answerFor = (qid: string) => latestAnswer(inputs.deptAnswers, j.key, [qid]);

  // 1. Pack items whose `when` holds.
  const packItems: RouteItem[] = [];
  const referenced = new Set<string>();
  for (const pack of active) for (const t of pack.items) {
    if (packItems.some((x) => x.id === t.id) || !holds(t.when)) continue;
    const it = instantiate(t, inputs);
    if (!it) continue;
    let item = normalise(it);
    if (item.certainty === 'unknown' && item.askQuestionId) {
      referenced.add(item.askQuestionId);
      const said = answerFor(item.askQuestionId);
      if (said) item = normalise({ ...item, certainty: 'department_said', answer: answerRef(said), text: PP_COPY.deptAnswered(item.text, said.answerText) });
    }
    packItems.push(item);
  }

  // 3–5. Department questions not already carried by a pack item.
  const deptItems: RouteItem[] = [];
  for (const dq of activeDq) {
    if (referenced.has(dq.id)) continue;
    const text = fillTokens(dq.text, inputs);
    const said = answerFor(dq.id);
    deptItems.push(normalise(said
      ? { id: dq.id, station: dq.station, kind: 'need', text: PP_COPY.deptAnswered(text, said.answerText), who: ['department'], certainty: 'department_said', source: null, answer: answerRef(said), askQuestionId: null, readiness: true }
      : { id: dq.id, station: dq.station, kind: 'need', text, who: ['department'], certainty: 'unknown', source: null, answer: null, askQuestionId: dq.id, readiness: true }));
  }

  // 6. This project's permit rows.
  const mine = byId(inputs.permits.filter((p) => p.projectId === inputs.projectId));
  const statusItems: RouteItem[] = [];
  for (const p of mine) {
    if (p.status !== 'denied' && p.status !== 'expired') continue;
    statusItems.push({
      id: `permit.${p.status}.${p.id}`, station: p.status === 'denied' ? 'review' : 'issued', kind: 'fact',
      text: PP_COPY.permitStatusLine(p.status, p.permitNumber ?? null), who: ['gc'], certainty: 'your_records',
      source: null, answer: null, askQuestionId: null, readiness: false,
    });
  }

  const items = [...statusItems, ...packItems, ...deptItems, ...aiItems(inputs.aiRoadmap)].filter((i) => !skipped.has(i.station));

  // Station state.
  const filed = mine.some((p) => p.status !== 'denied');
  const issued = mine.some((p) => p.status === 'approved' || INSPECTION_STATES.includes(p.status));
  const signedOff = inputs.marks[SIGNOFF_ITEM_ID]?.state === 'have';
  const prog = interviewProgress(packs, ctx);
  const interviewDone = prog.answered > 0 && nextQuestion(packs, ctx) === null;
  const done: Record<StationId, boolean> = {
    scope: interviewDone || filed,
    checks: filed,
    drawings: filed,
    filing: filed,
    review: issued,
    issued,
    // Never from a PermitStatus. Only the GC's own sign-off mark closes it out.
    work: signedOff,
    signoff: signedOff,
  };

  const lpcApplies = items.some((i) => i.station === 'checks' && i.who.includes('lpc') && i.certainty !== 'unknown');
  let currentSet = false;
  const stations: Station[] = STATION_ORDER.map((id) => {
    const sItems = items.filter((i) => i.station === id);
    let state: StationState;
    if (skipped.has(id)) state = 'not_needed';
    else if (done[id]) state = 'done';
    else if (!currentSet) { state = 'current'; currentSet = true; }
    else state = sItems.length > 0 && sItems.every((i) => i.certainty === 'unknown') ? 'unknown' : 'ahead';
    const duration = durationFor(id, {
      jurisdictionKey: j.key,
      deptAnswers: inputs.deptAnswers,
      durationQuestionIds: activeDq.filter((d) => d.station === id && isDurationQuestionId(d.id)).map((d) => d.id),
      lpcApplies,
      permits: inputs.permits,
      measured: inputs.measured,
      authority: inputs.authority ?? j.officeTitle ?? null,
    });
    return {
      id,
      title: PP_COPY.stationTitle(id),
      state,
      summary: state === 'not_needed' ? skipped.get(id) ?? PP_COPY.stationSummary(id) : PP_COPY.stationSummary(id),
      items: sItems,
      duration,
      unknownCount: sItems.filter((i) => i.certainty === 'unknown').length,
      notNeededBecause: state === 'not_needed' ? skipped.get(id) ?? null : null,
      confirmLine: PP_COPY.confirmLine(id, j.officeTitle),
    };
  });

  // Open department questions: one per unknown item's askQuestionId, in station
  // order; the which-department question leads.
  const open: DeptQuestion[] = [];
  for (const s of stations) for (const i of s.items) {
    if (i.certainty !== 'unknown' || !i.askQuestionId || open.some((d) => d.id === i.askQuestionId)) continue;
    open.push(allDq.get(i.askQuestionId) ?? { id: i.askQuestionId, station: i.station, text: i.text, askIf: null });
  }
  open.sort((a, b) => (a.id === LEAD_DEPT_QUESTION_ID ? -1 : 0) - (b.id === LEAD_DEPT_QUESTION_ID ? -1 : 0));

  const route: PermitRoute = {
    projectId: inputs.projectId,
    jurisdiction: { ...j, cautions: [...j.cautions] },
    stations,
    unknownCount: stations.reduce((n, s) => n + s.unknownCount, 0),
    openDeptQuestions: open,
    readiness: { have: 0, missing: 0, unknown: 0, total: 0 },
    inputsKey: routeInputsKey(inputs, packs),
  };
  const t = readinessFor(route, inputs.marks).tally;
  route.readiness = { have: t.have, missing: t.missing, unknown: t.unknown, total: t.total };
  return route;
}

// ─────────────────────────────────────────────────────────────────────
// S1: what changed after an answer
// ─────────────────────────────────────────────────────────────────────

function shortText(text: string): string {
  const first = text.split(/(?<=[.?])\s/)[0].replace(/[.]$/, '');
  if (first.length <= 80) return first;
  const cut = first.slice(0, 80);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).trim();
}

/** Short lines naming what one answer changed on the route. At most 4. */
export function explainChange(prev: PermitRoute, next: PermitRoute): string[] {
  const out: string[] = [];
  const prevItems = new Map(prev.stations.flatMap((s) => s.items).map((i) => [i.id, i]));
  const nextItems = new Map(next.stations.flatMap((s) => s.items).map((i) => [i.id, i]));
  for (const s of next.stations) {
    const before = prev.stations.find((p) => p.id === s.id);
    if (before && before.state !== 'not_needed' && s.state === 'not_needed') out.push(PP_COPY.explain.notNeeded(s.title, s.notNeededBecause ?? ''));
    if (before && before.state === 'not_needed' && s.state !== 'not_needed') out.push(PP_COPY.explain.backOn(s.title));
  }
  for (const [id, i] of nextItems) if (!prevItems.has(id) && i.certainty !== 'ai_draft') out.push(PP_COPY.explain.added(shortText(i.text)));
  for (const [id, i] of prevItems) {
    const st = next.stations.find((s) => s.id === i.station);
    if (!nextItems.has(id) && i.certainty !== 'ai_draft' && st?.state !== 'not_needed') out.push(PP_COPY.explain.removed(shortText(i.text)));
  }
  return out.slice(0, 4);
}
