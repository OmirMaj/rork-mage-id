// utils/demoJob/schedule.ts — the Demo Job's schedule (pure).
//
// 120 tasks for a seven-storey mixed-use building: site, foundations, a
// cast-in-place podium, six floors of light-gauge framing, envelope, roof,
// rough-ins and finishes floor by floor, elevators, sitework, commissioning,
// punch and turnover. Each task names what it waits on; the dates come from a
// forward pass with the same rule utils/scheduleEngine.recalculateStartDays
// uses (scripts/validate-demo-job.ts runs both and compares).
//
// Two plans are worked out from one task table:
//   - the BASELINE, from each task's planned duration;
//   - the CURRENT schedule, from the planned duration plus any days a task ran
//     over (LATE below, each with the reason the contractor typed).
// Progress on the data date comes from the current plan, and the pay
// applications read progress from this file, so billing cannot drift from it.
import type { DependencyLink, ProjectSchedule, ScheduleTask, TradeKey } from '@/types';
import { DATA_DAY, type DemoClock } from './clock';

export const RES_LEVELS = [2, 3, 4, 5, 6, 7] as const;

export interface DemoTaskSpec {
  key: string;
  title: string;
  phase: string;
  /** Planned working days. */
  days: number;
  /** Predecessors: 'key', 'key+3' (finish to start with lag), 'key~SS+5' (start to start with lag). */
  after: string[];
  crew: string;
  crewSize: number;
  trade: TradeKey;
  /** CSI divisions whose billing follows this task. */
  divs: string[];
  /** The sub (world.ts SUBS key) doing the work, when one is. */
  sub?: string;
  milestone?: boolean;
  weather?: boolean;
}

const T = (
  key: string, title: string, phase: string, days: number, after: string[],
  crew: string, crewSize: number, trade: TradeKey, divs: string[], sub?: string,
  extra?: { milestone?: boolean; weather?: boolean },
): DemoTaskSpec => ({ key, title, phase, days, after, crew, crewSize, trade, divs, ...(sub ? { sub } : {}), ...(extra ?? {}) });

function floorTasks(n: number): DemoTaskSpec[] {
  const L = `l${n}`;
  const prev = n > 2 ? `l${n - 1}` : null;
  // Interior work on a floor starts once the floor above is framed (its deck is on).
  const above = n < 7 ? `l${n + 1}-frame` : 'roof-frame';
  const follow = (task: string): string[] => (prev ? [`${prev}-${task}`] : []);
  return [
    T(`${L}-frame`, `Level ${n} Wall Panels and Floor Deck`, 'Framing', 12, [prev ? `${prev}-frame` : 'pod-cure'], 'Framing Crew', 14, 'framing', ['05'], 'framing'),
    T(`${L}-plumb`, `Level ${n} Plumbing Rough-In`, 'Plumbing', 8, [above, ...follow('plumb')], 'Plumbers', 6, 'plumbing', ['22'], 'plumbing'),
    T(`${L}-hvac`, `Level ${n} HVAC Rough-In`, 'HVAC', 7, [above, ...follow('hvac')], 'Mechanical Crew', 5, 'hvac', ['23'], 'hvac'),
    T(`${L}-elec`, `Level ${n} Electrical Rough-In`, 'Electrical', 8, [`${L}-plumb~SS+2`, ...follow('elec')], 'Electricians', 6, 'electrical', ['26', '27'], 'electrical'),
    T(`${L}-spk`, `Level ${n} Sprinkler Rough-In`, 'MEP', 5, [`${L}-hvac~SS+3`, ...follow('spk')], 'Sprinkler Fitters', 4, 'plumbing', ['21'], 'fire'),
    T(`${L}-insp`, `Level ${n} Rough-In Inspection`, 'Inspections', 1, [`${L}-plumb`, `${L}-hvac`, `${L}-elec`, `${L}-spk`], 'Superintendent', 1, 'general', ['01']),
    T(`${L}-insul`, `Level ${n} Insulation and Firestopping`, 'Insulation', 5, [`${L}-insp`], 'Insulators', 5, 'finish', ['07'], 'insulation'),
    T(`${L}-dry`, `Level ${n} Drywall Hang and Finish`, 'Drywall', 18, [`${L}-insul`, ...follow('dry')], 'Drywall Crew', 12, 'finish', ['09'], 'drywall'),
    T(`${L}-paint`, `Level ${n} Prime and Paint`, 'Finishes', 7, [`${L}-dry`], 'Painters', 6, 'finish', ['09'], 'paint'),
    T(`${L}-cab`, `Level ${n} Cabinets, Tops and Trim`, 'Interior', 8, [`${L}-paint`], 'Finish Carpenters', 6, 'finish', ['06', '12'], 'millwork'),
    T(`${L}-floor`, `Level ${n} Flooring and Tile`, 'Finishes', 8, [`${L}-cab`], 'Flooring Crew', 6, 'finish', ['09'], 'flooring'),
    T(`${L}-trim`, `Level ${n} Fixtures, Devices and Appliances`, 'MEP', 7, [`${L}-floor`], 'MEP Trim Crews', 8, 'general', ['22', '26', '11', '10', '28'], 'electrical'),
    T(`${L}-punch`, `Level ${n} Punch List`, 'General', 5, [`${L}-trim`], 'Superintendent', 3, 'closeout', ['01']),
  ];
}

export const TASK_SPECS: readonly DemoTaskSpec[] = [
  T('ntp', 'Notice to Proceed', 'General', 1, [], 'Project Manager', 1, 'general', ['01'], undefined, { milestone: true }),
  T('mob', 'Mobilize, Fence and Erosion Control', 'General', 9, ['ntp'], 'Site Crew', 6, 'general', ['01']),
  T('clear', 'Clear Site and Remove Old Paving', 'Demo', 6, ['mob'], 'Excavation Crew', 6, 'demo', ['02'], 'earthwork', { weather: true }),
  T('soe', 'Install Support of Excavation', 'Site Work', 12, ['clear'], 'Shoring Crew', 8, 'general', ['31'], 'earthwork', { weather: true }),
  T('exc', 'Mass Excavation', 'Site Work', 14, ['soe~SS+5'], 'Excavation Crew', 8, 'general', ['31'], 'earthwork', { weather: true }),
  T('util', 'Underground Utilities to Building', 'Site Work', 12, ['exc'], 'Utility Crew', 6, 'plumbing', ['33'], 'earthwork', { weather: true }),
  T('ftg', 'Footings and Grade Beams', 'Foundation', 15, ['exc'], 'Concrete Crew', 12, 'concrete', ['03'], 'concrete', { weather: true }),
  T('fwall', 'Foundation Walls and Elevator Pits', 'Foundation', 12, ['ftg'], 'Concrete Crew', 12, 'concrete', ['03'], 'concrete', { weather: true }),
  T('ftg-insp', 'Footing and Foundation Inspection', 'Inspections', 1, ['fwall'], 'Superintendent', 1, 'general', ['01']),
  T('wproof', 'Below-Grade Waterproofing', 'Foundation', 6, ['ftg-insp'], 'Waterproofers', 5, 'general', ['07'], 'roofing'),
  T('backfill', 'Backfill and Compact', 'Site Work', 6, ['wproof'], 'Excavation Crew', 6, 'general', ['31'], 'earthwork', { weather: true }),
  T('underslab', 'Under-Slab Plumbing and Electrical', 'MEP', 8, ['backfill', 'util'], 'Plumbers and Electricians', 8, 'plumbing', ['22', '26'], 'plumbing'),
  T('sog', 'Slab on Grade', 'Foundation', 6, ['underslab'], 'Concrete Crew', 10, 'concrete', ['03'], 'concrete', { weather: true }),
  T('pod-col', 'Level 1 Columns and Shear Walls', 'Foundation', 14, ['sog'], 'Concrete Crew', 14, 'concrete', ['03', '04'], 'concrete', { weather: true }),
  T('pod-deck', 'Podium Deck Formwork and Rebar', 'Foundation', 16, ['pod-col'], 'Concrete Crew', 16, 'concrete', ['03'], 'concrete', { weather: true }),
  T('pod-pour', 'Podium Deck Pour', 'Foundation', 3, ['pod-deck'], 'Concrete Crew', 18, 'concrete', ['03'], 'concrete', { weather: true }),
  T('pod-insp', 'Podium Structural Inspection', 'Inspections', 1, ['pod-pour'], 'Superintendent', 1, 'general', ['01']),
  T('pod-cure', 'Podium Cure and Strip Forms', 'Foundation', 8, ['pod-insp'], 'Concrete Crew', 8, 'concrete', ['03'], 'concrete'),
  ...RES_LEVELS.flatMap(floorTasks),
  T('roof-frame', 'Roof Framing and Deck', 'Framing', 8, ['l7-frame'], 'Framing Crew', 12, 'framing', ['05'], 'framing', { weather: true }),
  T('stairs', 'Stair Towers and Elevator Shafts', 'Framing', 30, ['l2-frame~SS+4'], 'Steel Crew', 6, 'steel', ['05', '04'], 'framing'),
  T('frame-insp', 'Structural Framing Inspection', 'Inspections', 2, ['roof-frame'], 'Superintendent', 1, 'general', ['01']),
  T('sheath', 'Exterior Sheathing and Air Barrier', 'Framing', 30, ['l4-frame'], 'Envelope Crew', 8, 'framing', ['07', '06'], 'framing', { weather: true }),
  T('windows', 'Windows, Levels 2 to 7', 'Framing', 24, ['sheath~SS+10'], 'Glaziers', 6, 'general', ['08'], 'glazing', { weather: true }),
  T('roofing', 'Roof Membrane and Flashing', 'Roofing', 12, ['frame-insp'], 'Roofers', 8, 'roofing', ['07'], 'roofing', { weather: true }),
  T('storefront', 'Retail Storefront Glazing', 'Framing', 10, ['windows'], 'Glaziers', 5, 'general', ['08'], 'glazing', { weather: true }),
  T('cladding', 'Brick Veneer and Fiber Cement Cladding', 'Framing', 45, ['windows~SS+12', 'sheath'], 'Masons and Siders', 10, 'general', ['04', '07'], 'masonry', { weather: true }),
  T('dry-in', 'Building Dry-In', 'General', 1, ['roofing', 'windows'], 'Superintendent', 1, 'general', ['01'], undefined, { milestone: true }),
  T('l1-mep', 'Level 1 Retail and Lobby Rough-In', 'MEP', 15, ['l3-frame'], 'MEP Crews', 10, 'general', ['22', '23', '26', '21'], 'electrical'),
  T('l1-fin', 'Level 1 Lobby and Retail Shell Finishes', 'Finishes', 25, ['l1-mep', 'storefront', 'l4-dry'], 'Finish Crews', 10, 'finish', ['09', '08', '10'], 'drywall'),
  T('elev', 'Elevator Installation', 'General', 45, ['roofing'], 'Elevator Mechanics', 4, 'general', ['14'], 'elevator'),
  T('elev-insp', 'Elevator Inspection', 'Inspections', 1, ['elev'], 'Superintendent', 1, 'general', ['01']),
  T('power', 'Permanent Power Energized', 'Electrical', 1, ['l7-elec'], 'Electricians', 3, 'electrical', ['26'], 'electrical', { milestone: true }),
  T('common', 'Corridors, Stairs and Common Area Finishes', 'Finishes', 25, ['l7-paint'], 'Finish Crews', 10, 'finish', ['09', '06', '10'], 'flooring'),
  T('paving', 'Sidewalks, Curbs and Paving', 'Site Work', 15, ['cladding'], 'Site Crew', 8, 'concrete', ['32', '33'], 'earthwork', { weather: true }),
  T('landscape', 'Landscaping and Site Furnishings', 'Landscaping', 10, ['paving'], 'Landscapers', 5, 'landscaping', ['32'], 'landscape', { weather: true }),
  T('cx', 'MEP Startup and Commissioning', 'MEP', 15, ['l7-trim', 'power', 'elev'], 'MEP Crews', 6, 'hvac', ['23', '22', '26'], 'hvac'),
  T('fa-test', 'Fire Alarm and Sprinkler Final Test', 'Inspections', 4, ['cx'], 'Fire Alarm Crew', 4, 'electrical', ['28', '21'], 'fire'),
  T('final-insp', 'Final Building Inspections', 'Inspections', 5, ['fa-test', 'elev-insp', 'l7-punch', 'common', 'l1-fin'], 'Superintendent', 2, 'general', ['01']),
  T('tco', 'Certificate of Occupancy', 'Inspections', 1, ['final-insp', 'landscape'], 'Project Manager', 1, 'closeout', ['01'], undefined, { milestone: true }),
  T('walk', 'Owner Walk-Through and Final Punch', 'General', 20, ['tco'], 'Superintendent', 6, 'closeout', ['01']),
  T('closeout', 'Closeout Documents and Turnover', 'General', 12, ['walk'], 'Project Manager', 2, 'closeout', ['01']),
  T('final', 'Final Completion', 'General', 1, ['closeout'], 'Project Manager', 1, 'closeout', ['01'], undefined, { milestone: true }),
];

/** Tasks that ran, or are running, longer than planned, with the reason the contractor recorded. */
export const LATE: Readonly<Record<string, { days: number; reason: string }>> = {
  exc: { days: 4, reason: 'Ran 4 working days over. Unsuitable fill found at the east footings. Over-excavated and replaced with structural fill (Change Order 1).' },
  'pod-deck': { days: 3, reason: 'Ran 3 working days over. A transfer beam was added at gridline C by a structural revision (Change Order 3).' },
  'pod-col': { days: 4, reason: 'Ran 4 working days over. Rebar shop drawings for the shear walls came back Revise and Resubmit and the bars were released late.' },
  windows: { days: 12, reason: 'Running 12 working days over. The Level 5 to 7 window shipment was pushed two weeks by the supplier. Levels 2 to 4 are set.' },
};

interface Link { key: string; type: 'FS' | 'SS'; lag: number }

export function parseAfter(text: string): Link {
  const m = /^([a-z0-9-]+?)(?:~(SS))?(?:\+(\d+))?$/.exec(text);
  if (!m) throw new Error(`bad predecessor: ${text}`);
  return { key: m[1], type: m[2] === 'SS' ? 'SS' : 'FS', lag: m[3] ? Number(m[3]) : 0 };
}

export interface PlannedTask { key: string; start: number; days: number; end: number }

/** Forward pass. `end` is the first day AFTER the task (start + days), as the app's engine counts it. */
export function forwardPass(durationOf: (spec: DemoTaskSpec) => number): Map<string, PlannedTask> {
  const byKey = new Map(TASK_SPECS.map((s) => [s.key, s] as const));
  const done = new Map<string, PlannedTask>();
  const visit = (key: string, trail: string[]): PlannedTask => {
    const hit = done.get(key);
    if (hit) return hit;
    const spec = byKey.get(key);
    if (!spec) throw new Error(`unknown task: ${key}`);
    if (trail.includes(key)) throw new Error(`dependency loop at ${key}`);
    let start = 1;
    for (const text of spec.after) {
      const link = parseAfter(text);
      const dep = visit(link.key, [...trail, key]);
      start = Math.max(start, (link.type === 'SS' ? dep.start : dep.end) + link.lag);
    }
    const days = durationOf(spec);
    const out: PlannedTask = { key, start, days, end: start + days };
    done.set(key, out);
    return out;
  };
  for (const s of TASK_SPECS) visit(s.key, []);
  return done;
}

export const baselinePlan = (): Map<string, PlannedTask> => forwardPass((s) => s.days);
export const currentPlan = (): Map<string, PlannedTask> => forwardPass((s) => s.days + (LATE[s.key]?.days ?? 0));

/** Percent complete (0 to 100) of a task on working day `day`, counted at the end of that day. */
export function progressOn(plan: PlannedTask, day: number): number {
  if (day >= plan.end - 1) return 100;
  if (day < plan.start) return 0;
  const raw = ((day - plan.start + 1) / plan.days) * 100;
  // Reported in fives, and never 100 before the last day.
  return Math.max(5, Math.min(95, Math.round(raw / 5) * 5));
}

/** Longest path through the current plan: the keys with no float. */
export function criticalKeys(plan: Map<string, PlannedTask>): Set<string> {
  const finish = Math.max(...[...plan.values()].map((p) => p.end));
  const succ = new Map<string, { key: string; link: Link }[]>();
  for (const s of TASK_SPECS) {
    for (const text of s.after) {
      const link = parseAfter(text);
      succ.set(link.key, [...(succ.get(link.key) ?? []), { key: s.key, link }]);
    }
  }
  const lateEnd = new Map<string, number>();
  const visit = (key: string): number => {
    const hit = lateEnd.get(key);
    if (hit !== undefined) return hit;
    const me = plan.get(key)!;
    let le = finish;
    for (const { key: sk, link } of succ.get(key) ?? []) {
      const sLateStart = visit(sk) - plan.get(sk)!.days;
      le = Math.min(le, link.type === 'SS' ? sLateStart - link.lag + me.days : sLateStart - link.lag);
    }
    lateEnd.set(key, le);
    return le;
  };
  const out = new Set<string>();
  for (const s of TASK_SPECS) if (visit(s.key) - plan.get(s.key)!.end <= 0) out.add(s.key);
  return out;
}

/** Share of the whole job's planned working days that is done on `day` (0 to 100, one decimal). */
export function schedulePercentOn(day: number): number {
  const plan = currentPlan();
  let total = 0;
  let earned = 0;
  for (const p of plan.values()) {
    total += p.days;
    earned += (p.days * progressOn(p, day)) / 100;
  }
  return Math.round((earned / total) * 1000) / 10;
}

export interface DemoScheduleParts {
  tasks: ScheduleTask[];
  baseline: { id: string; startDay: number; endDay: number }[];
  finishDay: number;
  baselineFinishDay: number;
}

export function buildDemoTasks(
  id: (key: string) => string,
  clock: DemoClock,
  subName: (subKey: string) => { id: string; name: string } | null,
): DemoScheduleParts {
  const base = baselinePlan();
  const cur = currentPlan();
  const critical = criticalKeys(cur);
  const tasks: ScheduleTask[] = TASK_SPECS.map((s, i) => {
    const p = cur.get(s.key)!;
    const b = base.get(s.key)!;
    const pct = progressOn(p, DATA_DAY);
    const late = LATE[s.key];
    const links: DependencyLink[] = s.after.map((text) => {
      const l = parseAfter(text);
      return { taskId: id(`task:${l.key}`), type: l.type, lagDays: l.lag };
    });
    const sub = s.sub ? subName(s.sub) : null;
    const started = pct > 0;
    const done = pct >= 100;
    return {
      id: id(`task:${s.key}`),
      title: s.title,
      phase: s.phase,
      durationDays: p.days,
      startDay: p.start,
      progress: pct,
      crew: s.crew,
      crewSize: s.crewSize,
      dependencies: links.map((l) => l.taskId),
      dependencyLinks: links,
      notes: late ? late.reason : '',
      status: done ? 'done' : started ? 'in_progress' : 'not_started',
      ...(s.milestone ? { isMilestone: true } : {}),
      wbsCode: String(i + 1),
      isCriticalPath: critical.has(s.key),
      ...(s.weather ? { isWeatherSensitive: true } : {}),
      baselineStartDay: b.start,
      baselineEndDay: b.end,
      ...(sub ? { assignedSubId: sub.id, assignedSubName: sub.name } : {}),
      ...(started ? { actualStartDay: p.start, actualStartDate: clock.dayOf(p.start) } : {}),
      ...(done ? { actualEndDay: p.end - 1, actualEndDate: clock.dayOf(p.end - 1) } : {}),
      tradeKey: s.trade,
    };
  });
  return {
    tasks,
    baseline: TASK_SPECS.map((s) => {
      const b = base.get(s.key)!;
      return { id: id(`task:${s.key}`), startDay: b.start, endDay: b.end };
    }),
    finishDay: Math.max(...[...cur.values()].map((p) => p.end)) - 1,
    baselineFinishDay: Math.max(...[...base.values()].map((p) => p.end)) - 1,
  };
}

export type { ProjectSchedule };
