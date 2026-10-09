// utils/demoJob/writer.ts — hands the Demo Job to the app's own creation paths.
//
// THIN ON PURPOSE. Every record is written by the same function a screen would
// call (the contexts' add functions, the engines' save functions, the Living
// Model's store), reached through `DemoPorts`, so the records have exactly the
// shape the screens expect and sync like the contractor's own. This file never
// touches the database, the offline queue, an edge function, an email, a
// notification or an AI model, and it has no way to: none of those is a port.
// (Removal queues four deletes by id for tables the server does not cascade.)
//
// RESUMABLE AND IDEMPOTENT. Each area knows which of its records are already
// there (by id, or by a natural key where the app makes the id) and adds only
// the missing ones. "Finish Creating" is the same call as "Create".
//
// ONE AT A TIME, IN ORDER, WITH A BREATH BETWEEN. Many add functions build
// their next list from the list as of the last render, so two calls in one
// tick keep only the second on the device. The writer adds one record, waits
// until the app's own list shows it, and only then adds the next. That also
// paces the server (a few writes a second) and lets the screen draw progress.
//
// A FAILED AREA DOES NOT STOP THE REST. It is reported in plain words and the
// next area runs.
import type { JobModel } from '@/utils/livingModel/types';
import type { DemoJob } from './build';
import { equipmentSerialPrefix } from './fieldRecords';
import { isDemoProject } from './marker';
import { SUBS, CREW, PEOPLE } from './world';
import { childIds } from './ids';
import { DATA_DAY } from './clock';

type Row = { id: string; projectId?: string | null };

/** What the writer reads: the app's own lists, as of now. */
export interface DemoWorld {
  projects: readonly { id: string; name?: string | null; leadSource?: string | null }[];
  subcontractors: readonly Row[];
  contacts: readonly Row[];
  cois: readonly Row[];
  commitments: readonly Row[];
  changeOrders: readonly Row[];
  invoices: readonly Row[];
  aiaPayApps: readonly Row[];
  dailyReports: readonly Row[];
  rfis: readonly Row[];
  submittals: readonly (Row & { title: string })[];
  punchItems: readonly Row[];
  permits: readonly (Row & { permitNumber?: string })[];
  oacMeetings: readonly Row[];
  warranties: readonly Row[];
  toolboxTalks: readonly Row[];
  hazards: readonly Row[];
  safetyIncidents: readonly Row[];
  deliveries: readonly Row[];
  buildingAccessRules: readonly { projectId: string }[];
  accessReservations: readonly Row[];
  delayEvents: readonly Row[];
  equipment: readonly { id: string; serialNumber?: string }[];
  fieldTickets: readonly Row[];
  crew: readonly Row[];
  timeEntries: readonly (Row & { workerName: string; date: string })[];
  projectPhotos: readonly Row[];
  planSheets: readonly Row[];
}

/** What the writer calls: the app's own functions, as of now. */
export interface DemoActions {
  addProject: (p: DemoJob['project']) => unknown;
  addSubcontractor: (s: DemoJob['subcontractors'][number]) => unknown;
  addContact: (c: DemoJob['contacts'][number]) => unknown;
  addCOI: (c: DemoJob['cois'][number]) => unknown;
  addCommitment: (c: DemoJob['commitments'][number]) => unknown;
  addChangeOrders: (c: DemoJob['changeOrders']) => unknown;
  addInvoice: (i: DemoJob['invoices'][number]) => unknown;
  addAIAPayApp: (a: DemoJob['payApps'][number]) => unknown;
  addDailyReport: (d: DemoJob['dailyReports'][number]) => unknown;
  addRFIs: (r: DemoJob['rfis']) => unknown;
  addSubmittals: (s: DemoJob['submittals']) => unknown;
  addPunchItems: (p: DemoJob['punchItems']) => unknown;
  addPermit: (p: DemoJob['permits'][number]) => unknown;
  addOACMeeting: (m: DemoJob['oacMeetings'][number]) => unknown;
  addWarranty: (w: DemoJob['warranties'][number]) => unknown;
  addToolboxTalk: (t: DemoJob['toolboxTalks'][number]) => unknown;
  addHazard: (h: DemoJob['hazards'][number]) => unknown;
  addDelivery: (d: DemoJob['deliveries'][number]) => unknown;
  setBuildingAccess: (r: DemoJob['buildingAccess']) => unknown;
  addReservation: (r: DemoJob['reservations'][number]) => unknown;
  addDelayEvent: (e: DemoJob['delayEvents'][number]) => unknown;
  addEquipment: (e: DemoJob['equipment'][number]) => unknown;
  addFieldTicket: (t: DemoJob['fieldTickets'][number]) => unknown;
  addCrewMember: (c: DemoJob['crew'][number]) => unknown;
  addManualEntry: (e: { projectId: string; projectName: string; workerName: string; trade?: string; hours: number; notes?: string; date?: string }) => unknown;
  addProjectPhoto: (p: { id: string; projectId: string; uri: string; timestamp: string; location?: string; tag?: string; linkedTaskId?: string; linkedTaskName?: string; createdAt: string }) => unknown;
  // Removal.
  deleteProject: (id: string, opts?: { safetyIncidentCount?: number }) => Promise<{ ok: true } | { ok: false; reason: string }>;
  deleteSubcontractor: (id: string) => unknown;
  deleteContact: (id: string) => unknown;
  deleteEquipment: (id: string) => unknown;
  deleteCrewMember: (id: string) => unknown;
  deleteTimeEntry: (id: string) => unknown;
}

export interface DemoPorts {
  world: () => DemoWorld;
  actions: () => DemoActions;
  /** True when the device is online and signed in (the engines and the plan upload need it). */
  online: () => boolean;
  pause: (ms: number) => Promise<void>;
  /** Writes waiting in the offline queue right now. */
  queuedWrites: () => Promise<number>;
  engines: {
    lienWaiverIds: (projectId: string) => Promise<string[]>;
    saveLienWaiver: (w: DemoJob['lienWaivers'][number]) => Promise<unknown>;
    contractIds: (projectId: string) => Promise<string[]>;
    saveContract: (c: DemoJob['contract']) => Promise<unknown>;
    selectionIds: (projectId: string) => Promise<string[]>;
    saveSelection: (s: DemoJob['selections'][number]) => Promise<boolean>;
  };
  assets: {
    /** Put the bundled sample plan sheet on the job. Resolves to why not, or null when it is there. */
    ensurePlan: (projectId: string) => Promise<string | null>;
    /** The bundled sample photo as a local file the photo queue accepts, or null. */
    samplePhotoUri: () => Promise<string | null>;
  };
  model: {
    has: (projectId: string) => Promise<boolean>;
    save: (model: JobModel) => Promise<boolean>;
    remove: (projectId: string) => Promise<void>;
  };
  /** Queue a delete by id through the app's normal write path (removal only). */
  queueDelete: (table: DemoDeleteTable, id: string) => Promise<unknown>;
}

/** The only tables removal deletes from directly: project-scoped tables the server does not cascade. */
export const DEMO_DELETE_TABLES = ['cois', 'oac_meetings', 'delay_events', 'field_tickets'] as const;
export type DemoDeleteTable = (typeof DEMO_DELETE_TABLES)[number];

/** The offline queue keeps 1,000 writes and drops the oldest past that. The demo is about 300. */
export const QUEUE_ROOM_NEEDED = 400;
export const QUEUE_CAP = 1000;

export type AreaKey =
  | 'project' | 'subcontractors' | 'contacts' | 'commitments' | 'insurance' | 'changeOrders' | 'invoices' | 'payApps'
  | 'dailyReports' | 'rfis' | 'submittals' | 'punchItems' | 'permits' | 'meetings' | 'warranties' | 'toolboxTalks'
  | 'hazards' | 'deliveries' | 'access' | 'delays' | 'equipment' | 'fieldTickets' | 'crew' | 'timeEntries'
  | 'lienWaivers' | 'contract' | 'selections' | 'planSheet' | 'photos' | 'model';

export interface DemoArea {
  key: AreaKey;
  total: number;
  /** How many of this area's records are there now. */
  present: () => Promise<number>;
  /** Add what is missing. `tick` is called after each record. Throws a plain-words reason on failure. */
  run: (tick: () => void) => Promise<void>;
  /** True for an area that cannot be written offline. */
  needsConnection?: boolean;
}

export class DemoAreaError extends Error {
  constructor(public readonly code: 'not_showing' | 'offline' | 'asset' | 'refused', message: string) {
    super(message);
    this.name = 'DemoAreaError';
  }
}

const BREATH_MS = 40;
const SHOW_TRIES = 150; // times 40 ms: six seconds for the app's own list to show a record.

async function untilShown(ports: DemoPorts, shown: () => boolean): Promise<void> {
  for (let i = 0; i < SHOW_TRIES; i += 1) {
    if (shown()) return;
    await ports.pause(BREATH_MS);
  }
  throw new DemoAreaError('not_showing', 'A record was added and did not show up in the app. Nothing else in this area was written.');
}

function listArea<T>(
  ports: DemoPorts, key: AreaKey, items: readonly T[], keyOf: (item: T) => string,
  presentKeys: (w: DemoWorld) => Set<string>, add: (a: DemoActions, item: T) => void,
): DemoArea {
  const missing = (): T[] => {
    const have = presentKeys(ports.world());
    return items.filter((i) => !have.has(keyOf(i)));
  };
  return {
    key,
    total: items.length,
    present: async () => items.length - missing().length,
    run: async (tick) => {
      for (const item of missing()) {
        add(ports.actions(), item);
        await untilShown(ports, () => presentKeys(ports.world()).has(keyOf(item)));
        tick();
        await ports.pause(BREATH_MS);
      }
    },
  };
}

/** Like listArea, for an add function that takes the whole list and is safe to call once. */
function batchArea<T>(
  ports: DemoPorts, key: AreaKey, items: readonly T[], keyOf: (item: T) => string,
  presentKeys: (w: DemoWorld) => Set<string>, addAll: (a: DemoActions, items: T[]) => void,
): DemoArea {
  const missing = (): T[] => {
    const have = presentKeys(ports.world());
    return items.filter((i) => !have.has(keyOf(i)));
  };
  return {
    key,
    total: items.length,
    present: async () => items.length - missing().length,
    run: async (tick) => {
      const todo = missing();
      if (todo.length === 0) return;
      addAll(ports.actions(), todo);
      await untilShown(ports, () => missing().length === 0);
      todo.forEach(() => tick());
      await ports.pause(BREATH_MS);
    },
  };
}

const idsOf = (rows: readonly Row[]): Set<string> => new Set(rows.map((r) => r.id));
const inProject = <T extends Row>(rows: readonly T[], projectId: string): T[] => rows.filter((r) => r.projectId === projectId);

/** Every area of the demo, in the order it is written. */
export function demoAreas(job: DemoJob, ports: DemoPorts): DemoArea[] {
  const pid = job.project.id;
  const byId = <T extends { id: string }>(key: AreaKey, items: readonly T[], rows: (w: DemoWorld) => readonly Row[], add: (a: DemoActions, item: T) => void) =>
    listArea(ports, key, items, (i) => i.id, (w) => idsOf(rows(w)), add);
  const timeKey = (e: { workerName: string; date: string }) => `${e.date}|${e.workerName}`;

  const engineArea = (key: AreaKey, wanted: string[], have: () => Promise<string[]>, write: (tick: () => void, missing: Set<string>) => Promise<void>): DemoArea => ({
    key,
    total: wanted.length,
    needsConnection: true,
    present: async () => {
      if (!ports.online()) return 0;
      const got = new Set(await have().catch(() => [] as string[]));
      return wanted.filter((w) => got.has(w)).length;
    },
    run: async (tick) => {
      if (!ports.online()) throw new DemoAreaError('offline', 'This part needs a connection. Tap Finish Creating when you are back online.');
      const got = new Set(await have());
      await write(tick, new Set(wanted.filter((w) => !got.has(w))));
    },
  });

  return [
    byId('project', [job.project], (w) => w.projects, (a, p) => a.addProject(p)),
    byId('subcontractors', job.subcontractors, (w) => w.subcontractors, (a, s) => a.addSubcontractor(s)),
    byId('contacts', job.contacts, (w) => w.contacts, (a, c) => a.addContact(c)),
    byId('commitments', job.commitments, (w) => w.commitments, (a, c) => a.addCommitment(c)),
    byId('insurance', job.cois, (w) => w.cois, (a, c) => a.addCOI(c)),
    batchArea(ports, 'changeOrders', job.changeOrders, (c) => c.id, (w) => idsOf(w.changeOrders), (a, cs) => a.addChangeOrders(cs)),
    byId('invoices', job.invoices, (w) => w.invoices, (a, i) => a.addInvoice(i)),
    byId('payApps', job.payApps, (w) => w.aiaPayApps, (a, p) => a.addAIAPayApp(p)),
    byId('dailyReports', job.dailyReports, (w) => w.dailyReports, (a, d) => a.addDailyReport(d)),
    batchArea(ports, 'rfis', job.rfis, (r) => r.id, (w) => idsOf(w.rfis), (a, rs) => a.addRFIs(rs)),
    batchArea(ports, 'submittals', job.submittals, (s) => s.title, (w) => new Set(inProject(w.submittals, pid).map((s) => s.title)), (a, ss) => a.addSubmittals(ss)),
    batchArea(ports, 'punchItems', job.punchItems, (p) => p.id, (w) => idsOf(w.punchItems), (a, ps) => a.addPunchItems(ps)),
    listArea(ports, 'permits', job.permits, (p) => p.permitNumber ?? '', (w) => new Set(inProject(w.permits, pid).map((p) => p.permitNumber ?? '')), (a, p) => a.addPermit(p)),
    byId('meetings', job.oacMeetings, (w) => w.oacMeetings, (a, m) => a.addOACMeeting(m)),
    byId('warranties', job.warranties, (w) => w.warranties, (a, x) => a.addWarranty(x)),
    byId('toolboxTalks', job.toolboxTalks, (w) => w.toolboxTalks, (a, t) => a.addToolboxTalk(t)),
    byId('hazards', job.hazards, (w) => w.hazards, (a, h) => a.addHazard(h)),
    byId('deliveries', job.deliveries, (w) => w.deliveries, (a, d) => a.addDelivery(d)),
    {
      key: 'access',
      total: 1 + job.reservations.length,
      present: async () => {
        const w = ports.world();
        const have = idsOf(w.accessReservations);
        return (w.buildingAccessRules.some((r) => r.projectId === pid) ? 1 : 0) + job.reservations.filter((r) => have.has(r.id)).length;
      },
      run: async (tick) => {
        if (!ports.world().buildingAccessRules.some((r) => r.projectId === pid)) {
          ports.actions().setBuildingAccess(job.buildingAccess);
          await untilShown(ports, () => ports.world().buildingAccessRules.some((r) => r.projectId === pid));
          tick();
        }
        for (const r of job.reservations) {
          if (idsOf(ports.world().accessReservations).has(r.id)) continue;
          ports.actions().addReservation(r);
          await untilShown(ports, () => idsOf(ports.world().accessReservations).has(r.id));
          tick();
          await ports.pause(BREATH_MS);
        }
      },
    },
    byId('delays', job.delayEvents, (w) => w.delayEvents, (a, e) => a.addDelayEvent(e)),
    listArea(ports, 'equipment', job.equipment, (e) => e.serialNumber ?? '', (w) => new Set(w.equipment.map((e) => e.serialNumber ?? '')), (a, e) => a.addEquipment(e)),
    byId('fieldTickets', job.fieldTickets, (w) => w.fieldTickets, (a, t) => a.addFieldTicket(t)),
    byId('crew', job.crew, (w) => w.crew, (a, c) => a.addCrewMember(c)),
    listArea(ports, 'timeEntries', job.timeEntries, timeKey, (w) => new Set(inProject(w.timeEntries, pid).map(timeKey)), (a, e) =>
      a.addManualEntry({ projectId: pid, projectName: job.project.name, workerName: e.workerName, trade: e.trade, hours: e.hours, notes: e.notes, date: e.date })),
    engineArea('lienWaivers', job.lienWaivers.map((w) => w.id), () => ports.engines.lienWaiverIds(pid), async (tick, missing) => {
      for (const w of job.lienWaivers) {
        if (!missing.has(w.id)) continue;
        if (!(await ports.engines.saveLienWaiver(w))) throw new DemoAreaError('refused', 'A lien waiver record was not saved.');
        tick();
        await ports.pause(BREATH_MS);
      }
    }),
    engineArea('contract', [job.contract.id], () => ports.engines.contractIds(pid), async (tick, missing) => {
      if (!missing.has(job.contract.id)) return;
      if (!(await ports.engines.saveContract(job.contract))) throw new DemoAreaError('refused', 'The draft contract was not saved.');
      tick();
    }),
    engineArea('selections', job.selections.map((s) => s.category.id), () => ports.engines.selectionIds(pid), async (tick, missing) => {
      for (const s of job.selections) {
        if (!missing.has(s.category.id)) continue;
        if (!(await ports.engines.saveSelection(s))) throw new DemoAreaError('refused', 'A selection was not saved.');
        tick();
        await ports.pause(BREATH_MS);
      }
    }),
    {
      key: 'planSheet',
      total: 1,
      needsConnection: true,
      present: async () => (inProject(ports.world().planSheets, pid).length > 0 ? 1 : 0),
      run: async (tick) => {
        if (inProject(ports.world().planSheets, pid).length > 0) return;
        if (!ports.online()) throw new DemoAreaError('offline', 'The sample plan sheet needs a connection. Tap Finish Creating when you are back online.');
        const why = await ports.assets.ensurePlan(pid);
        if (why) throw new DemoAreaError('asset', why);
        tick();
      },
    },
    {
      key: 'photos',
      total: job.photos.length,
      present: async () => {
        const have = idsOf(ports.world().projectPhotos);
        return job.photos.filter((p) => have.has(job.id(`photo:${p.key}`))).length;
      },
      run: async (tick) => {
        const todo = job.photos.filter((p) => !idsOf(ports.world().projectPhotos).has(job.id(`photo:${p.key}`)));
        if (todo.length === 0) return;
        const uri = await ports.assets.samplePhotoUri();
        if (!uri) throw new DemoAreaError('asset', 'The bundled sample photo could not be read on this device, so the job has no photos.');
        for (const p of todo) {
          const photoId = job.id(`photo:${p.key}`);
          const day = job.clock.dayOf(DATA_DAY - p.daysAgo);
          const taken = job.clock.atDay(day, 13);
          ports.actions().addProjectPhoto({
            id: photoId, projectId: pid, uri, timestamp: taken, location: p.location, tag: p.tag,
            linkedTaskId: job.id(`task:${p.task}`), linkedTaskName: job.project.schedule?.tasks.find((t) => t.id === job.id(`task:${p.task}`))?.title,
            createdAt: taken,
          });
          await untilShown(ports, () => idsOf(ports.world().projectPhotos).has(photoId));
          tick();
          await ports.pause(BREATH_MS);
        }
      },
    },
    {
      key: 'model',
      total: 1,
      present: async () => ((await ports.model.has(pid)) ? 1 : 0),
      run: async (tick) => {
        if (await ports.model.has(pid)) return;
        if (!(await ports.model.save(job.model))) throw new DemoAreaError('refused', 'The job model could not be saved on this device.');
        tick();
      },
    },
  ];
}

export interface AreaStatus { key: AreaKey; present: number; total: number; needsConnection: boolean }
export type DemoState = 'none' | 'partial' | 'complete';

export async function demoStatus(job: DemoJob, ports: DemoPorts): Promise<{ state: DemoState; areas: AreaStatus[] }> {
  const areas: AreaStatus[] = [];
  for (const a of demoAreas(job, ports)) {
    areas.push({ key: a.key, present: Math.min(a.total, await a.present()), total: a.total, needsConnection: !!a.needsConnection });
  }
  const exists = areas[0].present > 0;
  const all = areas.every((a) => a.present >= a.total);
  return { state: !exists ? 'none' : all ? 'complete' : 'partial', areas };
}

export interface DemoProgress { key: AreaKey; done: number; total: number }
export interface DemoFailure { key: AreaKey; code: DemoAreaError['code'] | 'error'; message: string }
export interface DemoRunResult { ok: boolean; failures: DemoFailure[]; refused?: 'queue_full' | 'exists_elsewhere' }

/** The demo projects in the app's list right now. */
export function existingDemoProjects(world: DemoWorld): { id: string }[] {
  return world.projects.filter((p) => isDemoProject(p));
}

/**
 * Create the demo, or finish one that is part way. The project is written
 * first and must show before anything hangs off it. Every other area runs
 * even if an earlier one failed.
 */
export async function createDemoJob(job: DemoJob, ports: DemoPorts, onProgress: (p: DemoProgress) => void): Promise<DemoRunResult> {
  // One demo at a time: never a second job beside one that is already there.
  if (existingDemoProjects(ports.world()).some((p) => p.id !== job.project.id)) return { ok: false, failures: [], refused: 'exists_elsewhere' };
  if ((await ports.queuedWrites()) > QUEUE_CAP - QUEUE_ROOM_NEEDED) return { ok: false, failures: [], refused: 'queue_full' };
  const failures: DemoFailure[] = [];
  const areas = demoAreas(job, ports);
  for (const area of areas) {
    let done = Math.min(area.total, await area.present().catch(() => 0));
    onProgress({ key: area.key, done, total: area.total });
    try {
      await area.run(() => {
        done = Math.min(area.total, done + 1);
        onProgress({ key: area.key, done, total: area.total });
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'This part was not written.';
      failures.push({ key: area.key, code: err instanceof DemoAreaError ? err.code : 'error', message });
      // Nothing can hang off a job that is not there.
      if (area.key === 'project') return { ok: false, failures };
    }
    await ports.pause(BREATH_MS);
  }
  return { ok: failures.length === 0, failures };
}

export interface DemoRemoveResult { ok: boolean; reason?: string }

/** The account-level records a demo job with this project id made (they are not deleted with the project). */
export function demoAccountIds(projectId: string): { subcontractors: string[]; contacts: string[]; crew: string[] } {
  const id = childIds(projectId);
  return {
    subcontractors: SUBS.map((s) => id(`sub:${s.key}`)),
    contacts: PEOPLE.map((p) => id(`contact:${p.key}`)),
    crew: CREW.map((c) => id(`crew:${c.key}`)),
  };
}

/**
 * Remove a demo job and everything made with it.
 *
 * The project goes first, through the app's own deleteProject: the server
 * cascades its children and the app forgets its own copies. If that is refused
 * (a safety incident was added to the job by hand: those are kept by law)
 * nothing else is touched. Then the rows a project delete does not reach:
 * the four tables the server does not cascade, the directory records, the
 * equipment, the crew, the shifts, and the Living Model on this device.
 */
export async function removeDemoJob(projectId: string, ports: DemoPorts): Promise<DemoRemoveResult> {
  const w = ports.world();
  const incidents = inProject(w.safetyIncidents, projectId).length;
  // Snapshot what a project delete would make this device forget.
  const strays: [DemoDeleteTable, string[]][] = [
    ['cois', inProject(w.cois, projectId).map((r) => r.id)],
    ['oac_meetings', inProject(w.oacMeetings, projectId).map((r) => r.id)],
    ['delay_events', inProject(w.delayEvents, projectId).map((r) => r.id)],
    ['field_tickets', inProject(w.fieldTickets, projectId).map((r) => r.id)],
  ];
  const shifts = inProject(w.timeEntries, projectId).map((r) => r.id);
  const prefix = equipmentSerialPrefix(projectId);
  const machines = w.equipment.filter((e) => (e.serialNumber ?? '').startsWith(prefix)).map((e) => e.id);
  const account = demoAccountIds(projectId);

  if (w.projects.some((p) => p.id === projectId)) {
    const res = await ports.actions().deleteProject(projectId, { safetyIncidentCount: incidents });
    if (!res.ok) return { ok: false, reason: res.reason };
  }
  for (const [table, ids] of strays) {
    for (const id of ids) {
      await ports.queueDelete(table, id);
      await ports.pause(BREATH_MS);
    }
  }
  const sweep = async (ids: string[], has: () => Set<string>, del: (a: DemoActions, id: string) => unknown) => {
    for (const id of ids) {
      if (!has().has(id)) continue;
      del(ports.actions(), id);
      // One at a time, for the same reason as the adds.
      for (let i = 0; i < SHOW_TRIES && has().has(id); i += 1) await ports.pause(BREATH_MS);
    }
  };
  await sweep(shifts, () => idsOf(ports.world().timeEntries), (a, id) => a.deleteTimeEntry(id));
  await sweep(machines, () => new Set(ports.world().equipment.map((e) => e.id)), (a, id) => a.deleteEquipment(id));
  await sweep(account.crew, () => idsOf(ports.world().crew), (a, id) => a.deleteCrewMember(id));
  await sweep(account.contacts, () => idsOf(ports.world().contacts), (a, id) => a.deleteContact(id));
  await sweep(account.subcontractors, () => idsOf(ports.world().subcontractors), (a, id) => a.deleteSubcontractor(id));
  await ports.model.remove(projectId);
  return { ok: true };
}
