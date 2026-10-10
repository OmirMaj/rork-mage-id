// utils/oneMind/demoFence.ts — keeps the owner's Demo Job out of One Mind (pure).
//
// One Mind answers from "everything the app knows", and while the Demo Job
// exists the app knows a made-up $23M job: its margin, its overdue items, its
// subs. None of that may reach a prompt, a fallback answer or a citation, so
// the bundle is fenced where it is built (components/brain/AskConversation)
// and again where it is read (utils/oneMind/answer.askOneMind): the second is
// the one a new caller cannot forget.
//
// What goes: the demo projects (name or stamp, utils/demoJob/marker), every
// row that names one by project id, the demo's made-up subcontractors, and the
// demo's Last Planner constraints. A bundle with no demo job is handed back
// as it came (the same object), so the fence costs nothing for anyone else.
import { demoProjectIdSet, withoutDemoProjects } from '@/utils/demoJob/marker';
import { demoSubcontractorIds } from '@/utils/demoJob/payees';
import type { OneMindBundle } from './factBlocks';

export function withoutDemoFacts(bundle: OneMindBundle): OneMindBundle {
  const demoIds = demoProjectIdSet(bundle.projects);
  if (demoIds.size === 0) return bundle;
  const subIds = demoSubcontractorIds(bundle.projects);
  const onDemo = (row: unknown): boolean => {
    const r = row as { projectId?: unknown; currentProjectId?: unknown };
    return (typeof r.projectId === 'string' && demoIds.has(r.projectId)) || (typeof r.currentProjectId === 'string' && demoIds.has(r.currentProjectId));
  };
  const rows = <T>(list: T[]): T[] => list.filter((r) => !onDemo(r));
  const maybe = <T>(list: T[] | undefined): T[] | undefined => (list ? rows(list) : list);
  const cs = bundle.costSources;
  return {
    ...bundle,
    projects: withoutDemoProjects(bundle.projects),
    commitments: rows(bundle.commitments),
    changeOrders: rows(bundle.changeOrders),
    invoices: rows(bundle.invoices),
    rfis: rows(bundle.rfis),
    dailyReports: rows(bundle.dailyReports),
    permits: rows(bundle.permits),
    submittals: rows(bundle.submittals),
    punchItems: rows(bundle.punchItems),
    aiaPayApps: maybe(bundle.aiaPayApps),
    receipts: maybe(bundle.receipts),
    laborSamples: maybe(bundle.laborSamples),
    costSources: cs ? {
      ...cs,
      receipts: maybe(cs.receipts),
      timeEntries: maybe(cs.timeEntries),
      equipment: maybe(cs.equipment),
      permits: maybe(cs.permits),
      subcontractors: cs.subcontractors ? cs.subcontractors.filter((s) => !subIds.has(s.id)) : cs.subcontractors,
    } : cs,
    constraints: bundle.constraints
      ? Object.fromEntries(Object.entries(bundle.constraints).filter(([projectId]) => !demoIds.has(projectId)))
      : bundle.constraints,
  };
}
