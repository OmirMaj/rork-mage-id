// utils/automation/inspectionResultToScheduleWork.ts
//
// INSPECTION-RESULT ADAPTER (pure, no side effects). The BACKWARD half of the
// permit-roadmap automation vertical: the forward half (roadmapToScheduleWork →
// eventToScheduleWork) BOOKED each inspection ahead of the task it gates; this
// half reacts when the contractor marks that inspection's RESULT — PASSED or
// FAILED — and prepares the DRAFT consequences the confirm surface commits.
//
// It invents NO scheduling math: releasing / reflowing goes entirely through
// the existing CPM engine (utils/scheduleEngine — getSuccessors / getDepLinks /
// recalculateStartDays), and the re-inspection draft goes through the existing
// factory (eventToScheduleWork). Lead time carries honest provenance from the
// lead-time library (NOT jurisdiction/high — that would present a guess as
// truth). Hazards go through the pure hazardFromFailedInspection factory.
//
// Contract:
//
//   inspectionResultToScheduleWork(
//     inspection: RoadmapInspection,
//     schedule:   ProjectSchedule,
//     result:     'passed' | 'failed',
//     opts:       { projectId; createdBy; now; hazardId; jurisdiction? },
//   ) => InspectionResultWork
//
// PASS  → { result:'passed',  releasedTaskIds, tasks }
//         The inspection's committed schedule task is found by sourceEventRef
//         ({feature:'permitRoadmap', id: inspection.id}); getSuccessors finds the
//         task(s) it gated; each is RELEASED (the inspection→successor dependency
//         link is dropped so it can start), then the WHOLE task set is reflowed
//         through recalculateStartDays. `tasks` is the full reflowed list to
//         commit. Nothing else is touched.
//
// FAIL  → { result:'failed', blockedTaskIds, reinspectionDraft, tasks, hazardDraft }
//         The gated successors stay BLOCKED (untouched — their dependency on the
//         inspection remains, so they can't start). A DRAFT re-inspection task is
//         built via eventToScheduleWork (kind 'dob_inspection', honest library
//         lead, sourceEventRef {feature:'permitRoadmap', id:'<inspId>:reinspect'})
//         gating the SAME task the original inspection gated. A DRAFT Hazard is
//         built via hazardFromFailedInspection (sourceInspectionId = inspection
//         id). `tasks` is the merged list to commit (existing + re-inspection +
//         any patched gating task). Nothing commits until the caller confirms.
//
// IDEMPOTENT:
//   • Re-marking PASSED: getDepLinks-based release is a set removal — dropping a
//     link that is already gone is a no-op, so a re-run releases the same set and
//     the reflow is stable.
//   • Re-marking FAILED: the re-inspection draft is keyed on sourceEventRef
//     ('<inspId>:reinspect'), so eventToScheduleWork returns the EXISTING task
//     rather than double-creating; and the hazard draft carries
//     sourceInspectionId = inspection id, which the caller dedups on (a re-run
//     produces a hazard draft with the same source, never a second live hazard).
//
// PURE: no Date.now(), no random, no I/O. `now` / `hazardId` are injected.

import type {
  ProjectSchedule,
  RoadmapInspection,
  ScheduleTask,
  Hazard,
} from '@/types';
import {
  getSuccessors,
  getDepLinks,
  recalculateStartDays,
} from '@/utils/scheduleEngine';
import {
  eventToScheduleWork,
  type ScheduleWorkRequest,
} from '@/utils/automation/eventToScheduleWork';
import { getLeadTime, type LeadTime } from '@/utils/automation/leadTimeLibrary';
import { hazardFromFailedInspection } from '@/utils/safety/inspectionScore';
import { ROADMAP_FEATURE } from '@/utils/automation/roadmapToScheduleWork';

/** The result the contractor marked on a scheduled roadmap inspection. */
export type InspectionResult = 'passed' | 'failed';

/**
 * The sourceEventRef id suffix for a re-inspection draft. Kept a single exported
 * constant so the adapter, the screen, and the test can never re-type it — and
 * so idempotency (dedupe on this exact ref) is airtight. The original inspection
 * task's ref id is `<inspId>`; its re-inspection's is `<inspId>:reinspect`.
 */
export const REINSPECT_SUFFIX = ':reinspect';

export function reinspectRefId(inspectionId: string): string {
  return `${inspectionId}${REINSPECT_SUFFIX}`;
}

export interface InspectionResultOptions {
  /** Owning project — stamped on the hazard draft. */
  projectId: string;
  /** Who marked the result — stamped as the hazard's createdBy. */
  createdBy: string;
  /** ISO timestamp for the hazard draft (injected → stays pure/testable). */
  now: string;
  /** Deterministic id for the hazard draft (injected → stays pure/testable). */
  hazardId: string;
  /** Optional jurisdiction for the re-inspection lead-time lookup (grounded
   *  override wins over the library default; absent = default). */
  jurisdiction?: string;
}

/**
 * The DRAFT consequences of an inspection result. The confirm surface renders
 * these and commits them ONLY on an explicit contractor confirm.
 *
 *   result            — echoed back so the caller branches without re-deriving.
 *   tasks             — the FULL task list to commit (undefined when there is
 *                       nothing to change, e.g. PASS with no gated successors).
 *   releasedTaskIds   — (PASS) ids of the successors that were unblocked.
 *   blockedTaskIds    — (FAIL) ids of the successors kept blocked (unchanged).
 *   reinspectionDraft — (FAIL) the NEW draft re-inspection task (isAutoGenerated,
 *                       sourceEventRef '<inspId>:reinspect'). Undefined on PASS.
 *   reinspectionLead  — (FAIL) the lead time + provenance for the re-inspection
 *                       (for the review chip). Undefined on PASS.
 *   reinspectionUnresolved — (FAIL) true when the re-inspection couldn't link to
 *                       a gating task (SNET book-by). Undefined on PASS.
 *   hazardDraft       — (FAIL) the DRAFT Hazard (sourceInspectionId = inspection
 *                       id). Undefined on PASS.
 */
export interface InspectionResultWork {
  result: InspectionResult;
  tasks?: ScheduleTask[];
  releasedTaskIds?: string[];
  blockedTaskIds?: string[];
  reinspectionDraft?: ScheduleTask;
  reinspectionLead?: LeadTime;
  reinspectionUnresolved?: boolean;
  hazardDraft?: Hazard;
}

/**
 * Find the inspection's COMMITTED schedule task — the one the forward vertical
 * stamped with sourceEventRef {feature:'permitRoadmap', id: inspection.id}. This
 * is the task getSuccessors keys off to find what the inspection gated. Returns
 * null when the inspection was never scheduled (nothing to release/keep-blocked).
 */
function findInspectionTask(
  inspection: RoadmapInspection,
  tasks: ScheduleTask[],
): ScheduleTask | null {
  return (
    tasks.find(
      (t) =>
        t.sourceEventRef?.feature === ROADMAP_FEATURE &&
        t.sourceEventRef?.id === inspection.id,
    ) ?? null
  );
}

/**
 * PASS: release every task the inspection gated. A gated successor depends on
 * the inspection task via an FS+lag link (the forward vertical's patch); to
 * release it we DROP exactly that one link — the inspection task id — from the
 * successor's dependencyLinks + legacy dependencies, leaving every OTHER
 * predecessor intact. Then the whole set is reflowed through CPM so the freed
 * successors slide earlier honestly (we invent no dates).
 *
 * Set-removal semantics make this idempotent: a second PASS finds the link
 * already gone and removes nothing, yielding the same reflowed schedule.
 */
function releaseOnPass(
  inspectionTaskId: string,
  schedule: ProjectSchedule,
): { tasks?: ScheduleTask[]; releasedTaskIds: string[] } {
  const tasks = schedule.tasks ?? [];
  const successors = getSuccessors(inspectionTaskId, tasks);
  if (successors.length === 0) {
    return { releasedTaskIds: [] };
  }
  const releasedIds = new Set(successors.map((t) => t.id));

  const unblocked = tasks.map((t) => {
    if (!releasedIds.has(t.id)) return t;
    // Normalize through getDepLinks so a task that only had the legacy
    // `dependencies` array still has its full link set before we drop one.
    const links = getDepLinks(t).filter((l) => l.taskId !== inspectionTaskId);
    return {
      ...t,
      dependencies: t.dependencies.filter((d) => d !== inspectionTaskId),
      dependencyLinks: links,
    };
  });

  // Reflow through the real engine — no hand-placed dates.
  const reflowed = recalculateStartDays(unblocked);
  return { tasks: reflowed, releasedTaskIds: Array.from(releasedIds) };
}

/**
 * Build the factory request for the DRAFT re-inspection. It gates the SAME task
 * the original inspection gated (found from the inspection task's successor), so
 * that task stays blocked until the re-inspection clears too. Falls back to the
 * inspection's own gatesTaskHint/Id when the original task can't be located.
 *
 * kind is 'dob_inspection' (the honest inspection default — a re-inspection is a
 * DOB/AHJ inspection); the lead comes from the library with real provenance.
 */
function toReinspectRequest(
  inspection: RoadmapInspection,
  lead: LeadTime,
  gatingTaskId: string | undefined,
): ScheduleWorkRequest {
  return {
    kind: 'dob_inspection',
    gatingTaskId: gatingTaskId ?? inspection.gatesTaskId,
    gatingTaskHint: inspection.gatesTaskHint,
    leadTimeDays: lead.days,
    whoActs: 'gc',
    sourceEventRef: { feature: ROADMAP_FEATURE, id: reinspectRefId(inspection.id) },
    title: `Re-inspection: ${inspection.title}`,
    // §7.2: the re-inspection's lead provenance survives onto the committed task.
    leadProvenance: { source: lead.source, confidence: lead.confidence },
  };
}

/**
 * FAIL: keep the gated successors BLOCKED (untouched), draft a re-inspection,
 * and draft a hazard. Nothing is released, nothing is committed.
 */
function consequencesOnFail(
  inspection: RoadmapInspection,
  inspectionTaskId: string | null,
  schedule: ProjectSchedule,
  opts: InspectionResultOptions,
): InspectionResultWork {
  const tasks = schedule.tasks ?? [];

  // The task(s) the original inspection gated — kept blocked (we don't touch
  // their dependency on the failed inspection). The re-inspection is wired to
  // gate the FIRST such task so it must clear before that task starts.
  const successors =
    inspectionTaskId != null ? getSuccessors(inspectionTaskId, tasks) : [];
  const blockedTaskIds = successors.map((t) => t.id);
  const primaryGatingId = successors[0]?.id;

  // Honest lead-time provenance for the re-inspection (library default unless a
  // grounded jurisdiction override exists). NEVER jurisdiction/high by fiat.
  const reinspectionLead = getLeadTime('dob_inspection', opts.jurisdiction);
  const req = toReinspectRequest(inspection, reinspectionLead, primaryGatingId);
  // Idempotent: if a re-inspection for this inspection is already in the
  // schedule (same sourceEventRef), the factory returns it rather than adding a
  // duplicate.
  const factory = eventToScheduleWork(req, schedule);

  const reinspectRef = reinspectRefId(inspection.id);
  const reinspectionDraft =
    factory.tasks.find(
      (t) =>
        t.sourceEventRef?.feature === ROADMAP_FEATURE &&
        t.sourceEventRef?.id === reinspectRef,
    ) ?? factory.tasks[0];

  // Merge factory output into the current tasks by id (idempotent: a re-run's
  // pre-existing draft / patched gating task replaces its prior copy, never
  // duplicates). This is the task list to commit on confirm.
  const byId = new Map<string, ScheduleTask>();
  for (const t of tasks) byId.set(t.id, t);
  for (const t of factory.tasks) byId.set(t.id, t);
  const merged = Array.from(byId.values());

  const hazardDraft = hazardFromFailedInspection(
    inspection,
    opts.projectId,
    opts.createdBy,
    opts.now,
    opts.hazardId,
  );

  return {
    result: 'failed',
    tasks: merged,
    blockedTaskIds,
    reinspectionDraft,
    reinspectionLead,
    reinspectionUnresolved: factory.unresolved,
    hazardDraft,
  };
}

/**
 * inspectionResultToScheduleWork — see file header for the full contract.
 *
 * PURE. Reads the schedule (never mutates it) and returns DRAFT consequences.
 * The caller (construction-ai inspection UI) presents a confirm surface and, on
 * an explicit contractor confirm, commits: updateProject({schedule}) with the
 * returned `tasks`, marks the inspection status, and (on fail) addHazard.
 */
export function inspectionResultToScheduleWork(
  inspection: RoadmapInspection,
  schedule: ProjectSchedule,
  result: InspectionResult,
  opts: InspectionResultOptions,
): InspectionResultWork {
  const tasks = schedule.tasks ?? [];
  const inspectionTask = findInspectionTask(inspection, tasks);

  if (result === 'passed') {
    // No committed inspection task → nothing was gated → nothing to release.
    if (!inspectionTask) {
      return { result: 'passed', releasedTaskIds: [] };
    }
    const { tasks: reflowed, releasedTaskIds } = releaseOnPass(
      inspectionTask.id,
      schedule,
    );
    return { result: 'passed', tasks: reflowed, releasedTaskIds };
  }

  // FAIL
  return consequencesOnFail(
    inspection,
    inspectionTask?.id ?? null,
    schedule,
    opts,
  );
}
