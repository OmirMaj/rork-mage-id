// __tests__/fixtures/demoJobFakeApp.ts — a stand-in app for the Demo Job writer.
//
// Used by scripts/validate-demo-job.ts (under bun) and by the builder screen's
// smoke test (under jest). It behaves the way the real contexts do where that
// matters to the writer:
//   - most add functions build their next list from the list AS OF THE LAST
//     RENDER (`stale`), so two adds in one tick keep only the second;
//   - the batch adds (change orders, RFIs, submittals, punch items) and the
//     functional ones (photos, time entries) are safe;
//   - every record keeps the id it is handed (the builder hands the real add
//     functions its own id for permits, equipment, submittals and shifts);
//   - deleting a project forgets every project-scoped list on the device. Like
//     the real one it trusts a safety-record count that is HANDED to it, and
//     with none it counts what the device knows plus what only the server
//     knows (`serverIncidents`), and refuses when there is any.
// Every call is written to `log`, so a test can prove what was and was not called.
import type { JobModel } from '@/utils/demoJob/model';
import type { DemoActions, DemoPorts, DemoWorld, DemoDeleteTable } from '@/utils/demoJob/writer';

type Lists = { [K in keyof DemoWorld]: DemoWorld[K][number][] };

const PROJECT_SCOPED: (keyof DemoWorld)[] = [
  'cois', 'commitments', 'changeOrders', 'invoices', 'aiaPayApps', 'dailyReports', 'rfis', 'submittals', 'punchItems', 'permits',
  'oacMeetings', 'warranties', 'toolboxTalks', 'hazards', 'deliveries', 'accessReservations', 'delayEvents', 'fieldTickets',
  'projectPhotos', 'planSheets',
];

export interface FakeApp {
  ports: DemoPorts;
  lists: Lists;
  log: string[];
  models: Map<string, JobModel>;
  /** Server rows by table that only a queued delete removes (the tables the server does not cascade). */
  serverDeletes: { table: string; id: string }[];
  /** Every deleteProject call, with the options it was handed (the writer must hand it none). */
  deleteCalls: { id: string; opts?: { safetyIncidentCount?: number } }[];
  engineRows: { lienWaivers: Map<string, string>; contracts: Map<string, string>; selections: Map<string, string> };
  set: (o: Partial<{ ready: boolean; serverIncidents: number; deleteKeepsJob: boolean; online: boolean; queued: number; dropAdds: keyof DemoWorld | null; stopAfterAdds: number | null; photoUri: string | null; planFails: string | null }>) => void;
  adds: () => number;
}

export function makeFakeApp(): FakeApp {
  const empty = (): Lists => ({
    projects: [], subcontractors: [], contacts: [], cois: [], commitments: [], changeOrders: [], invoices: [], aiaPayApps: [],
    dailyReports: [], rfis: [], submittals: [], punchItems: [], permits: [], oacMeetings: [], warranties: [], toolboxTalks: [],
    hazards: [], safetyIncidents: [], deliveries: [], buildingAccessRules: [], accessReservations: [], delayEvents: [],
    equipment: [], fieldTickets: [], crew: [], timeEntries: [], projectPhotos: [], planSheets: [],
  });
  const lists = empty();
  // What the add functions closed over at the last "render".
  let stale: Lists = { ...lists };
  let renderQueued = false;
  const render = () => {
    if (renderQueued) return;
    renderQueued = true;
    void Promise.resolve().then(() => { renderQueued = false; stale = { ...lists }; });
  };
  const log: string[] = [];
  const models = new Map<string, JobModel>();
  const serverDeletes: { table: string; id: string }[] = [];
  const deleteCalls: { id: string; opts?: { safetyIncidentCount?: number } }[] = [];
  const engineRows = { lienWaivers: new Map<string, string>(), contracts: new Map<string, string>(), selections: new Map<string, string>() };
  const opt = { ready: true, serverIncidents: 0, deleteKeepsJob: false, online: true, queued: 0, dropAdds: null as keyof DemoWorld | null, stopAfterAdds: null as number | null, photoUri: 'file:///sample-outlet.jpg' as string | null, planFails: null as string | null };
  let addCount = 0;
  let seq = 0;
  const newId = () => `fake-${(seq += 1)}`;

  const guard = (name: string) => {
    log.push(name);
    addCount += 1;
    if (opt.stopAfterAdds !== null && addCount > opt.stopAfterAdds) throw new Error('app closed');
  };
  /** The render-time-array add most contexts have. */
  const staleAdd = <K extends keyof DemoWorld>(key: K, name: string) => (item: unknown) => {
    guard(name);
    if (opt.dropAdds === key) return;
    (lists[key] as unknown[]) = [item, ...(stale[key] as unknown[])];
    render();
  };
  /** An add that reads the latest list. */
  const safeAdd = <K extends keyof DemoWorld>(key: K, name: string, stamp?: (item: Record<string, unknown>) => Record<string, unknown>) => (item: unknown) => {
    guard(name);
    if (opt.dropAdds === key) return;
    const items = (Array.isArray(item) ? item : [item]) as Record<string, unknown>[];
    (lists[key] as unknown[]) = [...items.map((i) => (stamp ? stamp(i) : i)), ...(lists[key] as unknown[])];
    render();
  };
  const del = <K extends keyof DemoWorld>(key: K, name: string, table: string) => (id: string) => {
    log.push(name);
    (lists[key] as { id: string }[]) = (stale[key] as { id: string }[]).filter((r) => r.id !== id);
    serverDeletes.push({ table, id });
    render();
  };

  const actions: DemoActions = {
    addProject: staleAdd('projects', 'addProject'),
    addSubcontractor: staleAdd('subcontractors', 'addSubcontractor'),
    addContact: staleAdd('contacts', 'addContact'),
    addCOI: staleAdd('cois', 'addCOI'),
    addCommitment: staleAdd('commitments', 'addCommitment'),
    addChangeOrders: safeAdd('changeOrders', 'addChangeOrders'),
    addInvoice: safeAdd('invoices', 'addInvoice'),
    addAIAPayApp: staleAdd('aiaPayApps', 'addAIAPayApp'),
    addDailyReport: safeAdd('dailyReports', 'addDailyReport'),
    addRFIs: safeAdd('rfis', 'addRFIs'),
    addSubmittals: safeAdd('submittals', 'addSubmittals'),
    addPunchItems: safeAdd('punchItems', 'addPunchItems'),
    addPermit: staleAdd('permits', 'addPermit'),
    addOACMeeting: staleAdd('oacMeetings', 'addOACMeeting'),
    addWarranty: staleAdd('warranties', 'addWarranty'),
    addToolboxTalk: staleAdd('toolboxTalks', 'addToolboxTalk'),
    addHazard: staleAdd('hazards', 'addHazard'),
    addDelivery: staleAdd('deliveries', 'addDelivery'),
    setBuildingAccess: staleAdd('buildingAccessRules', 'setBuildingAccess'),
    addReservation: staleAdd('accessReservations', 'addReservation'),
    addDelayEvent: staleAdd('delayEvents', 'addDelayEvent'),
    addEquipment: staleAdd('equipment', 'addEquipment'),
    addFieldTicket: staleAdd('fieldTickets', 'addFieldTicket'),
    addCrewMember: staleAdd('crew', 'addCrewMember'),
    addManualEntry: safeAdd('timeEntries', 'addManualEntry'),
    addProjectPhoto: safeAdd('projectPhotos', 'addProjectPhoto'),
    deleteProject: async (id: string, opts?: { safetyIncidentCount?: number }) => {
      log.push('deleteProject');
      deleteCalls.push({ id, opts });
      const incidents = opts?.safetyIncidentCount ?? (lists.safetyIncidents.filter((r) => r.projectId === id).length + opt.serverIncidents);
      if (incidents > 0) return { ok: false, reason: 'This job has a safety incident on it. Those records are kept.' };
      // An app that says yes and keeps the job (the writer must notice and stop).
      if (opt.deleteKeepsJob) return { ok: true };
      lists.projects = lists.projects.filter((p) => p.id !== id);
      for (const key of PROJECT_SCOPED) (lists[key] as { projectId?: string | null }[]) = (lists[key] as { projectId?: string | null }[]).filter((r) => r.projectId !== id);
      lists.buildingAccessRules = lists.buildingAccessRules.filter((r) => r.projectId !== id);
      // The server cascades these with the project.
      for (const m of [engineRows.lienWaivers, engineRows.contracts, engineRows.selections]) for (const [rid, pid] of m) if (pid === id) m.delete(rid);
      serverDeletes.push({ table: 'projects', id });
      stale = { ...lists };
      return { ok: true };
    },
    deleteSubcontractor: del('subcontractors', 'deleteSubcontractor', 'subcontractors'),
    deleteContact: del('contacts', 'deleteContact', 'contacts'),
    deleteEquipment: del('equipment', 'deleteEquipment', 'equipment'),
    deleteCrewMember: del('crew', 'deleteCrewMember', 'crew_members'),
    deleteTimeEntry: (id) => {
      log.push('deleteTimeEntry');
      lists.timeEntries = lists.timeEntries.filter((r) => r.id !== id);
      serverDeletes.push({ table: 'time_entries', id });
      render();
    },
  };

  const ports: DemoPorts = {
    world: () => lists,
    actions: () => actions,
    ready: () => opt.ready,
    online: () => opt.online,
    pause: () => Promise.resolve(),
    queuedWrites: async () => opt.queued,
    engines: {
      lienWaiverIds: async (pid) => [...engineRows.lienWaivers].filter(([, p]) => p === pid).map(([id]) => id),
      saveLienWaiver: async (w) => { guard('saveLienWaiver'); engineRows.lienWaivers.set(w.id, w.projectId); return w; },
      contractIds: async (pid) => [...engineRows.contracts].filter(([, p]) => p === pid).map(([id]) => id),
      saveContract: async (c) => { guard('saveContract'); engineRows.contracts.set(c.id, c.projectId); return c; },
      selectionIds: async (pid) => [...engineRows.selections].filter(([, p]) => p === pid).map(([id]) => id),
      saveSelection: async (s) => { guard('saveSelection'); engineRows.selections.set(s.category.id, s.category.projectId); return true; },
    },
    assets: {
      ensurePlan: async (pid) => {
        guard('ensurePlan');
        if (opt.planFails) return opt.planFails;
        lists.planSheets = [{ id: newId(), projectId: pid }, ...lists.planSheets];
        return null;
      },
      samplePhotoUri: async () => opt.photoUri,
    },
    model: {
      has: async (pid) => (models.get(pid)?.rooms.length ?? 0) > 0,
      save: async (m) => { guard('saveJobModel'); models.set(m.projectId, m); return true; },
      remove: async (pid) => { log.push('removeJobModel'); models.delete(pid); },
    },
    queueDelete: async (table: DemoDeleteTable, id) => { log.push(`queueDelete:${table}`); serverDeletes.push({ table, id }); },
  };

  return {
    ports, lists, log, models, serverDeletes, deleteCalls, engineRows,
    set: (o) => { Object.assign(opt, o); },
    adds: () => addCount,
  };
}

/** How many records of a demo are in the fake app, over every list. */
export function fakeRecordCount(app: FakeApp): number {
  let n = 0;
  for (const rows of Object.values(app.lists)) n += rows.length;
  return n + app.engineRows.lienWaivers.size + app.engineRows.contracts.size + app.engineRows.selections.size + app.models.size;
}
