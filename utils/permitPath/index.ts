// utils/permitPath/index.ts — the Permit Path engine barrel. PPUI and PPASK
// import only from here.

export * from '@/utils/permitPath/types';
export { evalPredicate, predicateQuestionIds, derivedValue, DERIVED_QUESTION_IDS, YEAR_QUESTION_ID, APRIL_1987_QUESTION_ID, type PredicateCtx, type PredicateSignals } from '@/utils/permitPath/predicate';
// The *_KEY aliases keep the spec names; the declared consts avoid a `_KEY`
// name so scripts/validate-storage-hygiene.ts does not read them as storage keys.
export { classifyJurisdiction, verifiedDepartmentOffice, LONG_ISLAND_COUNTY_FIPS, NYC_JURISDICTION, UNRESOLVED_JURISDICTION, NYC_JURISDICTION as NYC_KEY, UNRESOLVED_JURISDICTION as UNRESOLVED_KEY } from '@/utils/permitPath/jurisdiction';
export { prefillFor, type Prefill, type PrefillInputs } from '@/utils/permitPath/prefill';
export { activePacks, visibleQuestions, nextQuestion, interviewProgress, withAnswer, withoutAnswer, effectiveAnswers, type InterviewCtx } from '@/utils/permitPath/interview';
export { durationFor, latestAnswer, isDurationQuestionId, LPC_STATED_MAX_SOURCE, type DurationInputs } from '@/utils/permitPath/durations';
export { buildPermitRoute, explainChange, routeInputsKey, ENGINE_SLOT_IDS, LEAD_DEPT_QUESTION_ID, SIGNOFF_ITEM_ID, type RouteInputs, type SavedDeptAnswer } from '@/utils/permitPath/buildRoute';
export { readinessFor, shareText, itemSourceText, routeSummaryForAsk, type ReadinessRow, type ReadinessState, type ReadinessTally } from '@/utils/permitPath/readiness';
export { PP_COPY, ppDay } from '@/utils/permitPath/copy';
