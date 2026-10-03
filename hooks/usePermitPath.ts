// hooks/usePermitPath.ts — one job's Permit Path (lane PPUI, M1).
//
// Composes what the app already knows about the job — the Census place and its
// permit office, NYC's building record and review benchmark, the building
// year, this job's permits and AI roadmap, the department answers the GC saved
// for this jurisdiction — with the GC's interview answers and readiness marks,
// and hands them to the pure engine (buildPermitRoute over ALL_PACKS). The same
// inputs give the same route.
//
// LOCAL STATE lives on this device under PERMIT_PATH_KEY (utils/permitPath/
// localStore.ts), shared by every mounted copy of the hook (the screen and the
// hero cards), changed ONLY through reducePermitPathState and written 300 ms
// after the last change. A corrupt blob means start fresh.
//
// PRE-FILLS are suggestions: `prefills` is computed for display and never
// written; confirmPrefill is the only path from a suggestion to an answer.
//
// Every change that can add or remove stations calls layoutNext() first.
//
// While the place lookup or the building record is loading the route builds
// with what is known (`loading` true, the header says so); a failed lookup is
// `lookupFailed`, with retryLookup.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '@/types';
import { useProjects } from '@/contexts/ProjectContext';
import { layoutNext } from '@/components/ui/motion';
import { useJobBuildingRecord } from '@/hooks/useJobBuildingRecord';
import { useReviewBenchmark } from '@/hooks/useReviewBenchmark';
import { useBuildingYear } from '@/hooks/useBuildingYear';
import { useJurisdictionAnswers } from '@/hooks/useJurisdictionAnswers';
import { placeLookup, usePlaceLookup, type PlaceLookupState } from '@/utils/placeLookup';
import { permitOfficeFor, placeQueryForProject, type PermitOffice, type PermitOfficeAnswer } from '@/utils/permitOffices';
import { departmentFor, issuingAuthorityForAddress, jobsiteAddressForProject, jurisdictionQueryForProject, resolveCodeJurisdiction } from '@/utils/codeJurisdiction';
import { isNycJobsite, type BuildingRecord } from '@/utils/buildingRecord';
import { jobFilingFor, routeQuestion } from '@/utils/departmentQuestion';
import { scopeSummary } from '@/utils/permitRoadmap';
import { toCalendarDayString } from '@/utils/calendarDate';
import {
  buildPermitRoute,
  classifyJurisdiction,
  verifiedDepartmentOffice,
  explainChange,
  interviewProgress,
  nextQuestion as nextQuestionOf,
  prefillFor,
  readinessFor,
  shareText,
  visibleQuestions as visibleQuestionsOf,
  UNRESOLVED_KEY,
  type DeptQuestion,
  type InterviewAnswer,
  type InterviewCtx,
  type PermitRoute,
  type Prefill,
  type PrefillInputs,
  type Question,
  type ReadinessMark,
  type RouteInputs,
} from '@/utils/permitPath';
import { ALL_PACKS, TRADE_HINTS } from '@/utils/permitPath/packs';
import { buildAsk, type AskDraft } from '@/utils/permitPath/askDepartment';
import type { SavedDeptAnswer } from '@/utils/permitPath/deptAnswers';
import {
  loadPermitPathStore,
  pendingPrefills,
  projectStateOf,
  reducePermitPathState,
  savePermitPathStore,
  withProjectState,
  type PermitPathAction,
  type PermitPathStore,
} from '@/utils/permitPath/localStore';

// ── The shared on-device store (one copy for every mounted hook) ───────────
let shared: PermitPathStore = {};
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
export const PERMIT_PATH_SAVE_DEBOUNCE_MS = 300;
/** How long "what changed" stays under the interview. */
const EXPLAIN_MS = 4000;

function publish(next: PermitPathStore): void {
  shared = next;
  listeners.forEach((l) => l());
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void savePermitPathStore(shared);
  }, PERMIT_PATH_SAVE_DEBOUNCE_MS);
}

/** Open violations on the NYC record (DOB + ECB), or null when any violations
 *  dataset was not read: "not read" is never zero. */
function openViolationsOf(record: BuildingRecord | null): number | null {
  if (!record) return null;
  const sets = record.datasets.filter((d) => /violation/i.test(d.name));
  if (!sets.length || sets.some((d) => d.status !== 'ok' || d.activeCount == null)) return null;
  return sets.reduce((n, d) => n + (d.activeCount ?? 0), 0);
}

export interface UsePermitPath {
  route: PermitRoute | null;
  /** The place lookup or the building record is still loading. */
  loading: boolean;
  /** The place lookup failed: "Couldn't look up the building department. Try again." */
  lookupFailed: boolean;
  retryLookup: () => void;
  nextQuestion: Question | null;
  visibleQuestions: Question[];
  progress: { answered: number; visible: number };
  answers: Readonly<Record<string, InterviewAnswer>>;
  /** Pending suggestions by question id. Display only: never stored. */
  prefills: Readonly<Record<string, Prefill>>;
  answer: (id: string, value: InterviewAnswer['value']) => void;
  confirmPrefill: (id: string) => void;
  clearAnswer: (id: string) => void;
  mark: (itemId: string, mark: ReadinessMark | null) => void;
  readiness: ReturnType<typeof readinessFor> | null;
  /** The plain-text checklist for Share. */
  shareChecklist: string;
  office: PermitOffice | null;
  nycDepartment: ReturnType<typeof departmentFor>;
  askFor: (questionIds: readonly string[]) => AskDraft | null;
  /** The department questions behind these ids (for Save answer). */
  questionsFor: (questionIds: readonly string[]) => DeptQuestion[];
  deptAnswers: SavedDeptAnswer[];
  savedAnswer: (id: string) => SavedDeptAnswer | undefined;
  /** What the last answer changed on the route, for 4 s. */
  explain: string[];
  address: string;
  today: string;
}

const NONE: readonly string[] = [];

export function usePermitPath(project: Project | null | undefined): UsePermitPath {
  const { permits, settings, getPermitRoadmapForProject } = useProjects();
  const projectId = project?.id ?? null;
  const today = toCalendarDayString(new Date());

  // ── Local state (shared store) ────────────────────────────────────────
  const [, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const l = () => { if (alive) setTick((t) => t + 1); };
    listeners.add(l);
    // The disk copy is the truth on every mount (after a sign-out sweep it is
    // empty) unless this session has a write still waiting to land.
    if (!saveTimer) {
      void loadPermitPathStore().then((s) => { if (alive && !saveTimer) publish(s); });
    }
    return () => { alive = false; listeners.delete(l); };
  }, []);
  const state = projectStateOf(shared, projectId);

  // ── Where the job is ──────────────────────────────────────────────────
  const addr = useMemo(() => jobsiteAddressForProject(project), [project]);
  // A job with a verified department block (NYC, Baltimore City and County)
  // never calls place-lookup: the same rule DepartmentCard keeps.
  const verifiedResolved = useMemo(() => resolveCodeJurisdiction(jurisdictionQueryForProject(project)), [project]);
  const departmentVerified = departmentFor(verifiedResolved) !== null;
  const query = useMemo(() => (departmentVerified ? null : placeQueryForProject(project)), [project, departmentVerified]);
  const lookupBase = usePlaceLookup(query);
  const queryKey = query ? `${query.address}|${query.lat}|${query.lon}` : null;
  const [retried, setRetried] = useState<{ key: string; state: PlaceLookupState } | null>(null);
  const lookup = retried && retried.key === queryKey ? retried.state : lookupBase;
  const retryLookup = useCallback(() => {
    if (!query || !queryKey) return;
    setRetried({ key: queryKey, state: { status: 'loading', place: null } });
    void placeLookup(query).then((res) => {
      setRetried({ key: queryKey, state: res.ok ? { status: 'done', place: res.place } : { status: 'error', place: null } });
    });
  }, [query, queryKey]);
  const place = lookup.place;
  const nyc = useMemo(() => isNycJobsite(addr), [addr]);
  const officeAnswer = useMemo((): PermitOfficeAnswer => {
    if (departmentVerified) {
      if (nyc || (verifiedResolved.kind === 'city' && verifiedResolved.entry.name === 'New York City')) return { kind: 'nyc', office: null, headline: null, cautions: [] };
      const verifiedOffice = verifiedDepartmentOffice(verifiedResolved);
      if (verifiedOffice) return { kind: 'office', office: verifiedOffice, headline: null, cautions: [] };
    }
    return permitOfficeFor(place, { state: addr.state, postalCity: addr.city });
  }, [departmentVerified, nyc, verifiedResolved, place, addr.state, addr.city]);
  const jurisdiction = useMemo(
    () => classifyJurisdiction({ officeAnswer, place, nyc, departmentVerified }),
    [officeAnswer, place, nyc, departmentVerified],
  );
  const office = officeAnswer.office;
  const nycDepartment = useMemo(() => departmentFor(resolveCodeJurisdiction(addr)), [addr]);

  // ── What the app knows about the building ─────────────────────────────
  const building = useJobBuildingRecord(project);
  const record = building.nyc.phase === 'ready' ? building.nyc.record : null;
  const parcel = record?.parcel ?? null;
  const openViolations = useMemo(() => openViolationsOf(record), [record]);
  const year = useBuildingYear(project);
  const measured = useReviewBenchmark(project);
  const aiRoadmap = projectId ? getPermitRoadmapForProject(projectId) ?? null : null;
  const scope = useMemo(() => (project ? scopeSummary(project) : ''), [project]);
  const authority = useMemo(
    () => issuingAuthorityForAddress(jurisdictionQueryForProject(project, building.confirmedCounty)),
    [project, building.confirmedCounty],
  );
  const jobPermits = useMemo(() => (projectId ? permits.filter((p) => p.projectId === projectId) : []), [permits, projectId]);

  // ── Department answers (exact key; never under UNRESOLVED) ────────────
  const answerKey = jurisdiction.key === UNRESOLVED_KEY ? null : jurisdiction.key;
  const dept = useJurisdictionAnswers(answerKey);

  // ── The interview ─────────────────────────────────────────────────────
  const ctx = useMemo<InterviewCtx>(
    () => ({ answers: state.answers, family: jurisdiction.family, countyFips: jurisdiction.countyFips, signals: { openViolations } }),
    [state.answers, jurisdiction.family, jurisdiction.countyFips, openViolations],
  );
  const visible = useMemo(() => visibleQuestionsOf(ALL_PACKS, ctx), [ctx]);
  const next = useMemo(() => nextQuestionOf(ALL_PACKS, ctx), [ctx]);
  const progress = useMemo(() => interviewProgress(ALL_PACKS, ctx), [ctx]);
  const buildingYear = useMemo(() => ({ entered: year.entered, pluto: year.pluto }), [year.entered, year.pluto]);
  const prefillInputs = useMemo<PrefillInputs>(() => ({
    parcel,
    buildingYear,
    officeTitle: jurisdiction.officeTitle,
    placeMatch: place?.match ?? null,
    scope,
    tradeHints: TRADE_HINTS,
  }), [parcel, buildingYear, jurisdiction.officeTitle, place?.match, scope]);
  const prefills = useMemo(
    () => pendingPrefills(visible, state.answers, (q) => prefillFor(q, prefillInputs)),
    [visible, state.answers, prefillInputs],
  );

  // ── The route ─────────────────────────────────────────────────────────
  const inputs = useMemo<RouteInputs | null>(() => (projectId ? {
    projectId,
    jurisdiction,
    answers: state.answers,
    marks: state.marks,
    deptAnswers: dept.engineAnswers,
    permits,
    measured,
    parcel,
    buildingYear,
    aiRoadmap,
    today,
    office,
    scope,
    authority,
    openViolations,
  } : null), [projectId, jurisdiction, state.answers, state.marks, dept.engineAnswers, permits, measured, parcel, buildingYear, aiRoadmap, today, office, scope, authority, openViolations]);
  const route = useMemo(() => (inputs ? buildPermitRoute(inputs, ALL_PACKS) : null), [inputs]);
  const readiness = useMemo(() => (route ? readinessFor(route, state.marks) : null), [route, state.marks]);

  // ── "What changed", for 4 s after an answer ───────────────────────────
  const routeRef = useRef<PermitRoute | null>(route);
  routeRef.current = route;
  const explainFrom = useRef<PermitRoute | null>(null);
  const [explain, setExplain] = useState<string[]>([]);
  const explainTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const from = explainFrom.current;
    if (!from || !route || from.inputsKey === route.inputsKey) return;
    explainFrom.current = null;
    const lines = explainChange(from, route);
    setExplain(lines);
    if (explainTimer.current) clearTimeout(explainTimer.current);
    explainTimer.current = lines.length ? setTimeout(() => setExplain([]), EXPLAIN_MS) : null;
  }, [route]);
  useEffect(() => () => { if (explainTimer.current) clearTimeout(explainTimer.current); }, []);

  // ── Changes: the reducer is the only writer ───────────────────────────
  const dispatch = useCallback((action: PermitPathAction) => {
    if (!projectId) return;
    const cur = projectStateOf(shared, projectId);
    const nextState = reducePermitPathState(cur, action);
    if (nextState === cur) return;
    if (action.type !== 'mark') explainFrom.current = routeRef.current;
    // Stations can appear, vanish or flip to "not needed": animate the reflow.
    layoutNext();
    publish(withProjectState(shared, projectId, nextState));
    scheduleSave();
  }, [projectId]);

  const answer = useCallback((id: string, value: InterviewAnswer['value']) => {
    dispatch({ type: 'answer', id, value, at: new Date().toISOString() });
  }, [dispatch]);
  const confirmPrefill = useCallback((id: string) => {
    const p = prefills[id];
    if (!p) return;
    dispatch({ type: 'confirmPrefill', id, value: p.value, note: p.note, at: new Date().toISOString() });
  }, [dispatch, prefills]);
  const clearAnswer = useCallback((id: string) => {
    dispatch({ type: 'clearAnswer', id, at: new Date().toISOString() });
  }, [dispatch]);
  const mark = useCallback((itemId: string, m: ReadinessMark | null) => {
    dispatch({ type: 'mark', itemId, mark: m, at: new Date().toISOString() });
  }, [dispatch]);

  // ── Asking the department ─────────────────────────────────────────────
  const address = query?.address ?? (project?.location ?? '').trim();
  const company = settings?.branding?.companyName ?? '';
  const permitNumbersKey = jobPermits.map((p) => p.permitNumber ?? '').join('\u0001');
  const nycRouting = useMemo(() => {
    if (!nycDepartment) return null;
    const job = jobFilingFor(building.nyc.record, permitNumbersKey ? permitNumbersKey.split('\u0001') : NONE);
    return routeQuestion({ department: nycDepartment, job, nyc });
  }, [nycDepartment, building.nyc.record, permitNumbersKey, nyc]);

  const questionsFor = useCallback((ids: readonly string[]): DeptQuestion[] => {
    const out: DeptQuestion[] = [];
    for (const id of ids) {
      const q = route?.openDeptQuestions.find((x) => x.id === id)
        ?? ALL_PACKS.flatMap((p) => p.deptQuestions).find((x) => x.id === id);
      if (q && !out.some((x) => x.id === q.id)) out.push(q);
    }
    return out;
  }, [route]);

  const askFor = useCallback((ids: readonly string[]): AskDraft | null => {
    if (!route) return null;
    const questions = questionsFor(ids);
    if (!questions.length) return null;
    return buildAsk({ route, questions, office, nycDepartment, nycRouting, address, company, scopeLine: scope, today });
  }, [route, questionsFor, office, nycDepartment, nycRouting, address, company, scope, today]);

  const savedAnswer = useCallback((id: string) => dept.answers.find((a) => a.id === id), [dept.answers]);

  const shareChecklist = useMemo(
    () => (route && readiness ? shareText(route, readiness.rows, { company, address, today }) : ''),
    [route, readiness, company, address, today],
  );

  const loading = lookup.status === 'loading' || building.phase === 'loading' || building.phase === 'resolving';

  return {
    route,
    loading,
    lookupFailed: lookup.status === 'error',
    retryLookup,
    nextQuestion: next,
    visibleQuestions: visible,
    progress,
    answers: state.answers,
    prefills,
    answer,
    confirmPrefill,
    clearAnswer,
    mark,
    readiness,
    shareChecklist,
    office,
    nycDepartment,
    askFor,
    questionsFor,
    deptAnswers: dept.answers,
    savedAnswer,
    explain,
    address,
    today,
  };
}

export default usePermitPath;
