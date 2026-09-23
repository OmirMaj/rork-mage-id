// validate-schedule-live-merge.ts — pins Schedule Pro's live-sync rule
// (utils/scheduleMerge.ts): while the screen has an unwritten edit or a write
// still leaving it takes no schedule copy from elsewhere; once quiet it adopts
// the server's copy whole. Every row save carries its own stamp
// (schedule.updatedAt), which is how its echo is told from anyone else's.
// Run via: bun run scripts/validate-schedule-live-merge.ts
//
// Post-ship hotfix, integration round 1. The 3-way merge + own-echo tracker
// that followed 357d0a34 never converged (three review rounds, each fix
// opening a gap; the last: a colleague's change the socket missed was ignored
// by the refetch and then overwritten). It was replaced by this rule, and this
// file replays, against the real functions, every case of that trail:
//   - the reported timeline — drags at 0 / 1.0 / 1.9 s with the real 500 ms
//     persist and 800 ms sync debounces — and slower echoes;
//   - undo ~1 s after a save, delete-then-undo, add-then-delete;
//   - more than 16 saves made offline and replayed;
//   - a colleague's change the socket missed (A and D′ from the review),
//     through the foreground refetch and through the reconnect re-read;
//   - a colleague's commit landing just before this screen's save;
//   - leaving the screen with a save in the sync debounce, a page reloaded
//     with saves still queued, the foreman's field RPC, render delays;
//   - bounded memory, and a seeded fuzz of whole sessions.
// Snap-back cases also run the rule as shipped in 357d0a34 (its merge copied
// verbatim) as the control that must lose. The last section pins the wiring
// in app/schedule-pro.tsx, hooks/useLiveSchedule.ts and ProjectContext.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  inLocalOrder, MAX_OWN_SCHEDULE_STAMPS, nextOwnScheduleStamp, noteFieldScheduleSave, noteOwnScheduleSave,
  noteScheduleSocketGap, openScheduleSyncGate, answerScheduleReread, beginScheduleReread, projectWriteQueued, queuedScheduleStamps, resetScheduleSyncGatesForTest,
  seedQueuedScheduleStamps, settleScheduleSyncGate, takeScheduleCopy, takeStoreScheduleCopy, type ScheduleCopy, type ScheduleSyncGate,
} from '../utils/scheduleMerge';
import { absorbServerScheduleTasks, FIELD_TASK_PATCH_KEYS, stampFieldEdits } from '../utils/fieldScheduleUpdate';
// 357d0a34's rebase, kept outside the app as this file's control.
import { rebaseWorkingTasks } from './shipped-schedule-rebase';
import { buildScheduleFromTasks } from '../utils/scheduleEngine';
import { absorbedScheduleMeta } from '../utils/projectContextPure';
import type { ScheduleTask } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want)); }
}

const mk = (id: string, d: number): ScheduleTask => ({ id, durationDays: d } as ScheduleTask);
const copyOf = (tasks: ScheduleTask[], stamp: string | null): ScheduleCopy => ({ tasks, stamp });

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nthe gate, rule by rule:');
{
  resetScheduleSyncGatesForTest();
  const g = openScheduleSyncGate('g1', 'L');
  expect('the store copy of the load is not news', takeScheduleCopy(g, copyOf([mk('a', 1)], 'L'), 'outside', false), null);
  expect('a foreign event while quiet, nothing of mine out → adopted', takeScheduleCopy(g, copyOf([mk('a', 2)], 'F1'), 'echo', false)?.stamp, 'F1');
  noteOwnScheduleSave(g, 'S1');
  noteOwnScheduleSave(g, 'S2');
  expect('the store copy of my own save is not a server copy (held)', takeScheduleCopy(g, copyOf([mk('a', 3)], 'S2'), 'outside', true), null);
  expect('the echo of my OLDER save is ignored, busy or not', [takeScheduleCopy(g, copyOf([], 'S1'), 'echo', true), takeScheduleCopy(g, copyOf([], 'S1'), 'echo', false), g.parked], [null, null, null]);
  expect('a foreign event before my latest save came back is ignored (it committed before it)', [takeScheduleCopy(g, copyOf([], 'F2'), 'echo', false), g.parked], [null, null]);
  expect('my latest save coming back while busy is parked, not adopted', [takeScheduleCopy(g, copyOf([mk('a', 3)], 'S2'), 'echo', true), g.parked?.stamp], [null, 'S2']);
  expect('...and adopted the moment the screen is quiet', settleScheduleSyncGate(g, false)?.stamp, 'S2');
  expect('...once', settleScheduleSyncGate(g, false), null);
  expect('a foreign event AFTER my latest came back → adopted when quiet', takeScheduleCopy(g, copyOf([mk('a', 9)], 'F3'), 'echo', false)?.stamp, 'F3');
  expect('...parked when busy', [takeScheduleCopy(g, copyOf([mk('a', 10)], 'F4'), 'echo', true), g.parked?.stamp], [null, 'F4']);
  noteOwnScheduleSave(g, 'S3');
  expect('...and dropped by a newer save of mine (which overwrote it)', [g.parked, settleScheduleSyncGate(g, false)], [null, null]);
  expect('a copy from outside while busy is ignored', takeScheduleCopy(g, copyOf([mk('a', 11)], 'F5'), 'outside', true), null);
  expect('a copy from outside while quiet is adopted whole even with my save unechoed (the socket dropped it)', takeScheduleCopy(g, copyOf([mk('a', 11)], 'F5'), 'outside', false)?.stamp, 'F5');
  expect('...and counts every save of mine as back: the next foreign event is taken', takeScheduleCopy(g, copyOf([mk('a', 12)], 'F6'), 'echo', false)?.stamp, 'F6');
  noteOwnScheduleSave(g, 'S4');
  expect('a refetch holding my own latest save, quiet, is not re-applied but marks it back',
    [takeScheduleCopy(g, copyOf([mk('a', 13)], 'S4'), 'outside', false), g.own.seen === g.own.stamps.length - 1], [null, true]);
  noteFieldScheduleSave(g);
  expect('a field save drops what was parked before it', g.parked, null);
  noteScheduleSocketGap(g);
  expect('a socket gap owes a re-read', g.rereadOwed, true);
  // The owed re-read (integration round 2). Guarded so a broken gate fails
  // these checks and the replays below still run.
  try {
    resetScheduleSyncGatesForTest();
    const r = openScheduleSyncGate('rr', 'L');
    expect('a new gate owes a re-read (the loaded copy may be stale), not as a gap', [r.rereadOwed, r.rereadForGap], [true, false]);
    const q = beginScheduleReread(r)!;
    expect('...begun once', [q !== null, beginScheduleReread(r)], [true, null]);
    expect('a failed read is owed again, not re-read at once', [answerScheduleReread(r, q, null, false), r.rereadOwed], [{ adopt: null, readAgain: false }, true]);
    const q2 = beginScheduleReread(r)!;
    takeScheduleCopy(r, copyOf([mk('a', 2)], 'F1'), 'echo', false); // a colleague's event adopted inside the round trip
    expect('an adoption inside the round trip: the answer is dropped and read again at once', [answerScheduleReread(r, q2, copyOf([mk('a', 1)], 'L'), false), r.rereadOwed], [{ adopt: null, readAgain: true }, true]);
    const q3 = beginScheduleReread(r)!;
    noteOwnScheduleSave(r, 'S1');
    expect('a row save inside the round trip settles it (its echo brings the row)', [answerScheduleReread(r, q3, copyOf([], 'F1'), false), r.rereadOwed], [{ adopt: null, readAgain: false }, false]);
    noteScheduleSocketGap(r);
    const q4 = beginScheduleReread(r)!;
    noteFieldScheduleSave(r);
    expect('a field save inside the round trip: owed again, still as a gap', [answerScheduleReread(r, q4, copyOf([], 'F1'), false).readAgain, r.rereadOwed, r.rereadForGap], [false, true, true]);
    noteOwnScheduleSave(r, 'S2');
    expect('...and a row save settles even a gap\'s re-read', [r.rereadOwed, r.rereadForGap], [false, false]);
    // A mount read of my own latest save must not count my saves as seen: its
    // echo is still coming, and a colleague's event committed before it can
    // arrive first.
    const m = openScheduleSyncGate('rr', 'S2'); // a remount: my saves S1, S2 are still unechoed (seen -1)
    const mq = beginScheduleReread(m)!;
    expect('a mount read of the copy I hold: nothing to adopt, and my saves are not marked seen', [answerScheduleReread(m, mq, copyOf([], 'S2'), false).adopt, m.own.seen], [null, -1]);
    expect('...so the colleague\'s older event arriving after it is ignored', takeScheduleCopy(m, copyOf([mk('a', 9)], 'PEER'), 'echo', false), null);
    noteScheduleSocketGap(m);
    const gq = beginScheduleReread(m)!;
    expect('a gap\'s re-read of it DOES stand in for my lost echo', [answerScheduleReread(m, gq, copyOf([], 'S2'), false).adopt, m.own.seen], [null, 1]);
  } catch (e) {
    expect('the owed re-read checks ran', String(e), 'no error');
  }
  // The store copy (integration round 3).
  try {
    resetScheduleSyncGatesForTest();
    const st = openScheduleSyncGate('st', 'L');
    noteOwnScheduleSave(st, 'S1');
    expect('store: my own save as the store took it is not news', takeStoreScheduleCopy(st, copyOf([], 'S1'), false, false), null);
    expect('store: another writer\'s copy while my sync is still out → adopted (it holds my save), my save NOT marked seen',
      [takeStoreScheduleCopy(st, copyOf([mk('a', 2)], 'R'), false, false)?.stamp, st.own.seen, st.heldThrough], ['R', -1, 'S1']);
    expect('...so my save\'s echo arriving later is older news, not adopted over it', takeScheduleCopy(st, copyOf([mk('a', 1)], 'S1'), 'echo', false), null);
    expect('store: while he has an edit not handed over → parked, and dropped by the save that follows',
      [takeStoreScheduleCopy(st, copyOf([mk('a', 3)], 'R2'), true, false), st.parked?.stamp, (noteOwnScheduleSave(st, 'S2'), st.parked)], [null, 'R2', null]);
    expect('store: settled → adopted and my saves marked seen', [takeStoreScheduleCopy(st, copyOf([mk('a', 4)], 'F'), false, true)?.stamp, st.own.seen], ['F', 1]);
    const bl = [{ id: 'pre-co', name: 'Pre-CO #3' }];
    expect('an adopted copy carries its baselines', takeStoreScheduleCopy(st, { tasks: [], stamp: 'F2', baselines: bl }, false, true)?.baselines, bl);
    // An EVENT adopted after my latest is not taken to hold my saves: the
    // "after" may rest on a gap re-read standing in for an echo still coming.
    noteOwnScheduleSave(st, 'S3');
    noteScheduleSocketGap(st);
    const gq = beginScheduleReread(st)!;
    answerScheduleReread(st, gq, copyOf([], 'S3'), false);
    expect('an event adopted after a gap re-read does not swallow my own echo that follows it',
      [takeScheduleCopy(st, copyOf([mk('a', 9)], 'PEER'), 'echo', false)?.stamp, takeScheduleCopy(st, copyOf([mk('a', 5)], 'S3'), 'echo', false)?.stamp], ['PEER', 'S3']);
  } catch (e) {
    expect('the store-copy checks ran', String(e), 'no error');
  }
  // Stamps.
  const g2 = openScheduleSyncGate('g2', null);
  const t0 = Date.UTC(2026, 8, 18, 12, 0, 0);
  const a = nextOwnScheduleStamp(g2, t0); noteOwnScheduleSave(g2, a);
  const b = nextOwnScheduleStamp(g2, t0);
  expect('two saves in one millisecond get different, ordered stamps', [a !== b, a < b], [true, true]);
  // Remount keeps the project's stamps.
  const g3 = openScheduleSyncGate('g2', b);
  expect('a remount knows the saves its previous mount made', g3.own.stamps.includes(a), true);
  // Queue seed.
  resetScheduleSyncGatesForTest();
  const g4 = openScheduleSyncGate('p', 'Q3');
  const queue = [
    { table: 'projects', data: { id: 'p', schedule: { updatedAt: 'Q1', tasks: [] } } },
    { table: 'invoices', data: { id: 'p' } },
    { table: 'projects', data: { id: 'other', schedule: { updatedAt: 'X', tasks: [] } } },
    { table: 'projects', data: { id: 'p', schedule: { updatedAt: 'Q3', tasks: [] } } },
  ] as { table: string; data: Record<string, unknown> }[];
  expect('queued stamps: this project\'s projects writes, oldest first', queuedScheduleStamps(queue, 'p'), ['Q1', 'Q3']);
  expect('projectWriteQueued', [projectWriteQueued(queue, 'p'), projectWriteQueued(queue, 'nope')], [true, false]);
  seedQueuedScheduleStamps(g4, queuedScheduleStamps(queue, 'p'));
  expect('seeded: the replay of the older queued save is mine and ignored', takeScheduleCopy(g4, copyOf([], 'Q1'), 'echo', false), null);
  // Memory.
  resetScheduleSyncGatesForTest();
  const g5 = openScheduleSyncGate('m', null);
  for (let i = 0; i < 5_000; i++) noteOwnScheduleSave(g5, nextOwnScheduleStamp(g5, t0 + i));
  expect(`5000 saves keep at most ${MAX_OWN_SCHEDULE_STAMPS} stamps, and the latest still answers`,
    [g5.own.stamps.length <= MAX_OWN_SCHEDULE_STAMPS, takeScheduleCopy(g5, copyOf([], g5.own.stamps[g5.own.stamps.length - 1]), 'echo', false) !== null], [true, true]);
  // Order.
  const local = [mk('c', 1), mk('a', 1), mk('b', 1)];
  const incoming = [mk('a', 2), mk('n', 1), mk('b', 1)];
  expect('adopted content in the grid\'s row order; a server-only row after the row it follows; a row the server lacks goes',
    inLocalOrder(incoming, local).map(t => `${t.id}:${t.durationDays}`), ['a:2', 'n:1', 'b:1']);
}

// ─────────────────────────────────────────────────────────────────────────────
// The simulation: one server row, realtime per device, the real debounces, a
// request latency, the offline queue, and Schedule Pro's handlers as wired in
// app/schedule-pro.tsx. `shipped` is 357d0a34's rule (its merge verbatim).
// ─────────────────────────────────────────────────────────────────────────────
type Rule = 'fixed' | 'shipped';
type Tk = ScheduleTask & Record<string, unknown>;
interface Timer { at: number; seq: number; fn: () => void }
interface Row { tasks: ScheduleTask[]; stamp: string | null }
const EPOCH = Date.UTC(2026, 8, 18, 14, 0, 0);
const PERSIST_MS = 500;   // schedulePersist debounce (app/schedule-pro.tsx)
const SYNC_MS = 800;      // syncProjectToSupabase debounce (ProjectContext)

/** utils/scheduleMerge.ts mergeScheduleTasks as shipped in 357d0a34. */
function shippedMerge(baseline: ScheduleTask[], incoming: ScheduleTask[], local: ScheduleTask[]): ScheduleTask[] {
  const sameTask = (a: ScheduleTask, b: ScheduleTask) => JSON.stringify(a) === JSON.stringify(b);
  const baseById = new Map(baseline.map((t) => [t.id, t]));
  const localById = new Map(local.map((t) => [t.id, t]));
  const result = incoming.map((inc) => {
    const base = baseById.get(inc.id);
    if (!base || !sameTask(inc, base)) return inc;
    return localById.get(inc.id) ?? inc;
  });
  for (const loc of local) {
    if (!baseById.has(loc.id) && !incoming.some((i) => i.id === loc.id)) result.push(loc);
  }
  return result;
}

/** JSONB: the stored copy comes back with its object keys re-ordered. */
function jsonb<T>(v: T): T {
  const sortKeys = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sortKeys);
    if (x && typeof x === 'object') {
      const r = x as Record<string, unknown>;
      return Object.fromEntries(Object.keys(r).sort((a, b) => a.length - b.length || (a < b ? -1 : 1)).map(k => [k, sortKeys(r[k])]));
    }
    return x;
  };
  return sortKeys(JSON.parse(JSON.stringify(v))) as T;
}

/** projects_keep_newer_field_progress (migration 20260917160000), in JS. */
function keepNewerTrigger(oldTasks: ScheduleTask[], newTasks: ScheduleTask[]): ScheduleTask[] {
  const oldById = new Map((oldTasks as Tk[]).filter(t => t.fieldEditedAt && typeof t.fieldEditedAt === 'object').map(t => [t.id, t] as const));
  if (oldById.size === 0) return newTasks;
  return (newTasks as Tk[]).map(t => {
    const o = oldById.get(t.id);
    if (!o) return t;
    const os = o.fieldEditedAt as Record<string, string>;
    let ns: Record<string, string> = t.fieldEditedAt && typeof t.fieldEditedAt === 'object' ? { ...(t.fieldEditedAt as Record<string, string>) } : {};
    let next: Record<string, unknown> | null = null;
    const or = o as Record<string, unknown>;
    for (const k of FIELD_TASK_PATCH_KEYS as readonly string[]) {
      const ots = os[k] ? Date.parse(os[k]) : NaN;
      if (!Number.isFinite(ots)) continue;
      const nts = ns[k] ? Date.parse(ns[k]) : NaN;
      if (!Number.isFinite(nts) || nts < ots) {
        next = next ?? { ...t };
        if (k in or) next[k] = or[k]; else delete next[k];
        ns = { ...ns, [k]: os[k] };
      }
    }
    if (!next) return t;
    next.fieldEditedAt = ns;
    return next as Tk;
  });
}

class World {
  now = 0;
  q: Timer[] = [];
  seq = 0;
  server: Row;
  sims: Sim[] = [];
  peerSeq = 0;
  constructor(initial: ScheduleTask[]) { this.server = { tasks: jsonb(initial), stamp: 'LOAD' }; }
  set(ms: number, fn: () => void): Timer { const t = { at: this.now + ms, seq: this.seq++, fn }; this.q.push(t); return t; }
  clear(t: Timer | null) { if (t) this.q = this.q.filter(x => x !== t); }
  at(ms: number, fn: () => void) { this.q.push({ at: ms, seq: this.seq++, fn }); }
  run(until = 30_000) {
    for (;;) {
      this.q.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = this.q[0];
      if (!next || next.at > until) break;
      this.q.shift();
      this.now = next.at;
      next.fn();
    }
  }
  iso() { return new Date(EPOCH + this.now).toISOString(); }
  /** A write commits (the keep-newer trigger runs on the tasks; the stamp is
   *  the writer's) and realtime tells every device. */
  commit(tasks: ScheduleTask[], stamp: string | null) {
    this.server = { tasks: jsonb(keepNewerTrigger(this.server.tasks, tasks)), stamp };
    const row = this.server;
    for (const s of this.sims) s.deliver(row);
  }
  /** A colleague (another device) saves: the server's row with one change. */
  peerRowWrite(change: (tasks: ScheduleTask[]) => ScheduleTask[]) {
    this.commit(buildScheduleFromTasks('S', 'p1', change(this.server.tasks), null, { criticalPathDays: 60 }).tasks, `PEER-${++this.peerSeq}`);
  }
  /** The foreman's field RPC: merges field keys onto the server's tasks, server-stamped. */
  peerFieldRpc(id: string, patch: Record<string, unknown>) {
    const nowIso = this.iso();
    this.commit((this.server.tasks as Tk[]).map(t => {
      if (t.id !== id) return t;
      const stamps = { ...((t.fieldEditedAt as Record<string, string> | undefined) ?? {}) };
      for (const k of Object.keys(patch)) stamps[k] = nowIso;
      return { ...t, ...patch, fieldEditedAt: stamps };
    }), `RPC-${++this.peerSeq}`);
  }
}

class Sim {
  readonly w: World;
  get now() { return this.w.now; }
  get server() { return this.w.server.tasks; }
  echoMs: (at: number) => number = () => 350;
  reqMs = 160;
  renderMs: () => number = () => 0;
  private lastDelivery = 0;
  socketUp = true;
  online = true;
  gapMs = 120;
  // ProjectContext
  ctx: Row;
  private ctxServerPrev: ScheduleTask[];
  private syncTimer: Timer | null = null;
  private inFlight = 0;
  outbox: Row[] = [];
  private draining = false;
  // Schedule Pro
  working: ScheduleTask[];
  private persistTimer: Timer | null = null;
  private persistPending = false;
  private persistArg: ScheduleTask[] = [];
  gate: ScheduleSyncGate;
  private lastEffect: Row;
  private renderScheduled = false;
  private shippedBaseline: ScheduleTask[];
  private undoStack: ScheduleTask[][] = [];
  private redoStack: ScheduleTask[][] = [];
  /** Every copy the screen showed, and why. */
  shown: { at: number; tasks: ScheduleTask[]; why: string }[] = [];
  /** The copy his edits last left on the screen. */
  intended: ScheduleTask[];

  constructor(private rule: Rule, initial: ScheduleTask[] = INITIAL, world?: World, public name = 'dev1') {
    this.w = world ?? new World(initial);
    this.w.sims.push(this);
    const load = { tasks: jsonb(this.w.server.tasks), stamp: this.w.server.stamp };
    this.ctx = load;
    this.ctxServerPrev = load.tasks;
    this.working = load.tasks;
    this.intended = load.tasks;
    this.gate = openScheduleSyncGate(`${this.name}:p1`, load.stamp);
    this.shippedBaseline = load.tasks;
    this.lastEffect = load;
    this.mounted();
  }
  /** The mount's first queue read calls settleSync (app/schedule-pro.tsx):
   *  the re-read a new gate owes goes out at the first quiet moment. */
  private mounted() { this.set(0, () => this.settle()); }

  set(ms: number, fn: () => void): Timer { return this.w.set(ms, fn); }
  clear(t: Timer | null) { this.w.clear(t); }
  at(ms: number, fn: () => void) { this.w.at(ms, fn); }
  run(until = 30_000) { this.w.run(until); return this; }
  iso() { return this.w.iso(); }

  // ── Schedule Pro: edits ──
  private show(tasks: ScheduleTask[], why: string) {
    this.working = tasks;
    if (why === 'edit' || why === 'undo' || why === 'redo') this.intended = tasks;
    this.shown.push({ at: this.now, tasks, why });
  }
  commit(producer: (prev: ScheduleTask[]) => ScheduleTask[]) {
    const next = producer(this.working);
    if (next === this.working) return;
    this.undoStack.push(this.working);
    this.redoStack = [];
    this.show(next, 'edit');
    this.schedulePersist(next);
  }
  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.working);
    this.show(prev, 'undo');
    this.schedulePersist(prev);
  }
  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.working);
    this.show(next, 'redo');
    this.schedulePersist(next);
  }
  private schedulePersist(tasks: ScheduleTask[]) {
    this.clear(this.persistTimer);
    this.persistPending = true;
    this.persistArg = tasks;
    this.persistTimer = this.set(PERSIST_MS, () => {
      this.persistPending = false;
      this.saveAsRow(buildScheduleFromTasks('S', 'p1', this.persistArg, null, { criticalPathDays: 60 }).tasks);
      this.settle();
    });
  }
  /** saveAsRow → ProjectContext.updateProject → syncProjectToSupabase. */
  private saveAsRow(sent: ScheduleTask[]) {
    let stamp: string | null = null;
    if (this.rule === 'fixed') {
      stamp = nextOwnScheduleStamp(this.gate, EPOCH + this.now);
      noteOwnScheduleSave(this.gate, stamp);
    } else {
      stamp = this.iso();
    }
    this.ctx = { tasks: stampFieldEdits(this.ctx.tasks, sent, this.iso()), stamp };
    this.render();
    this.sync();
  }
  private sync() {
    this.clear(this.syncTimer);
    const payload = this.ctx;
    this.syncTimer = this.set(SYNC_MS, () => { this.syncTimer = null; this.send(payload); });
  }
  /** The sync's write: behind the queue when one is waiting (writeInOrder),
   *  else a request that commits half-way and reports at the end. */
  private send(row: Row) {
    if (this.outbox.length > 0) { this.outbox.push(row); this.settle(); return; }
    this.inFlight++;
    let landed = false;
    this.set(this.reqMs / 2, () => { if (this.online) { landed = true; this.w.commit(row.tasks, row.stamp); } });
    this.set(this.reqMs, () => {
      this.inFlight--;
      if (!landed) { this.outbox.push(row); this.drain(); } // failed → queued (drained at the next chance)
      this.settle();
    });
  }
  private drain() {
    if (!this.online || this.draining) return;
    this.draining = true;
    const step = () => {
      if (!this.online || this.outbox.length === 0) {
        this.draining = false;
        this.settle();
        return;
      }
      const head = this.outbox[0];
      let landed = false;
      this.set(this.reqMs / 2, () => { if (this.online) { landed = true; this.w.commit(head.tasks, head.stamp); } });
      this.set(this.reqMs, () => {
        if (landed) this.outbox.shift();
        else { // failed: stays queued; the next drain retries it (backoff / foreground)
          this.draining = false;
          this.set(this.gapMs, () => this.drain());
          this.settle();
          return;
        }
        if (this.outbox.length === 0) { this.draining = false; this.settle(); this.refetch(); return; } // post-flush re-pull
        this.set(this.gapMs, step);
      });
    };
    step();
  }
  private busy() {
    return this.persistPending || !!this.syncTimer || this.inFlight > 0 || this.outbox.length > 0;
  }
  private render() {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    this.set(this.renderMs(), () => { this.renderScheduled = false; this.outsideEffect(); });
  }
  /** adoptServerCopy. `fromServer` false: the store's own copy with a sync
   *  still out — shown, but ProjectContext already holds it. */
  private adopt(copy: ScheduleCopy, fromServer = true) {
    const shown = inLocalOrder(copy.tasks, this.working);
    if (JSON.stringify(shown) !== JSON.stringify(this.working)) this.show(shown, 'adopt');
    if (!fromServer) return;
    // absorbServerSchedule(..., { stamp }): whole unless a sync is out.
    const whole = !this.syncTimer && this.inFlight === 0;
    const next: Row = whole
      ? { tasks: copy.tasks, stamp: copy.stamp ?? this.ctx.stamp }
      : { tasks: absorbServerScheduleTasks(this.ctxServerPrev, copy.tasks, this.ctx.tasks), stamp: this.ctx.stamp };
    this.ctxServerPrev = copy.tasks;
    if (JSON.stringify(next) !== JSON.stringify(this.ctx)) { this.ctx = next; this.render(); }
  }
  /** The outside-copy effect (project.schedule changed). */
  private outsideEffect() {
    const incoming = this.ctx;
    if (incoming === this.lastEffect) return;
    this.lastEffect = incoming;
    if (this.rule === 'fixed') {
      const settled = !this.busy();
      const c = takeStoreScheduleCopy(this.gate, { tasks: incoming.tasks, stamp: incoming.stamp }, this.persistPending, settled);
      if (c) this.adopt(c, settled);
      return;
    }
    // As shipped in 357d0a34.
    const base = this.shippedBaseline;
    if (incoming.tasks === base || JSON.stringify(incoming.tasks) === JSON.stringify(base)) return;
    this.shippedBaseline = incoming.tasks;
    const merged = rebaseWorkingTasks(base, incoming.tasks, this.working);
    if (JSON.stringify(merged) === JSON.stringify(this.working)) return;
    if (this.persistPending) this.schedulePersist(merged);
    this.show(merged, 'rebase');
  }
  /** onPeerSchedule. */
  private onPeer(row: Row) {
    if (this.rule === 'fixed') {
      const c = takeScheduleCopy(this.gate, row, 'echo', this.busy());
      if (c) this.adopt(c);
      return;
    }
    const next = absorbServerScheduleTasks(this.ctxServerPrev, row.tasks, this.ctx.tasks);
    this.ctxServerPrev = row.tasks;
    if (JSON.stringify(next) !== JSON.stringify(this.ctx.tasks)) { this.ctx = { ...this.ctx, tasks: next }; this.render(); }
    const merged = shippedMerge(this.shippedBaseline, row.tasks, this.working);
    this.shippedBaseline = row.tasks;
    if (JSON.stringify(merged) !== JSON.stringify(this.working)) {
      this.show(merged, 'echo');
      if (this.persistPending) this.schedulePersist(merged);
    }
  }
  /** settleSync. */
  private settle() {
    if (this.rule !== 'fixed' || this.busy()) return;
    const parked = settleScheduleSyncGate(this.gate, false);
    if (parked) this.adopt(parked);
    const gate = this.gate;
    const reread = beginScheduleReread(gate);
    if (!reread) return;
    let read: Row | null = null;
    this.set(this.reqMs / 2, () => { read = this.online ? { tasks: jsonb(this.w.server.tasks), stamp: this.w.server.stamp } : null; });
    this.set(this.reqMs, () => {
      if (this.gate !== gate) return;
      const { adopt, readAgain } = answerScheduleReread(gate, reread, read, this.busy());
      if (adopt) this.adopt(adopt);
      if (readAgain) this.settle();
    });
  }

  // ── the device ──
  /** Realtime delivers in commit order, each event after its own latency. */
  deliver(row: Row) {
    const deliverAt = Math.max(this.lastDelivery, this.now + this.echoMs(this.now));
    this.lastDelivery = deliverAt;
    const copy = { tasks: jsonb(row.tasks), stamp: row.stamp };
    this.w.q.push({ at: deliverAt, seq: this.w.seq++, fn: () => { if (this.socketUp && this.online) this.onPeer(copy); } });
  }
  /** The foreground refetch: skipped while a sync is out or queued (ProjectContext); the loader takes the server's row. */
  refetch() {
    if (this.syncTimer || this.inFlight > 0 || this.outbox.length > 0) return;
    let read: Row | null = null;
    this.set(this.reqMs / 2, () => { read = { tasks: jsonb(this.w.server.tasks), stamp: this.w.server.stamp }; });
    this.set(this.reqMs, () => {
      // The loader keeps the device row when a write started meanwhile (#8).
      if (!read || this.syncTimer || this.inFlight > 0 || this.outbox.length > 0) return;
      this.ctx = read;
      this.ctxServerPrev = read.tasks;
      this.render();
    });
  }
  /** ANOTHER writer on this device changes project.schedule (a client's
   *  portal CO approval reflowing it before deferReflow, a schedule accepted
   *  on a screen pushed over this one): ProjectContext's copy + its 800 ms
   *  sync, exactly as saveAsRow's write — not stamped as this screen's. */
  localWrite(change: (tasks: ScheduleTask[]) => ScheduleTask[], stamp = `LOCAL-${this.now}`) {
    this.ctx = { tasks: jsonb(change(this.ctx.tasks)), stamp };
    this.render();
    this.sync();
  }
  socketDown() { this.socketUp = false; }
  /** He opens Schedule Pro: a fresh channel (no gap — it only ever hears
   *  events from its join), a mount on ProjectContext's copy. */
  mountFresh() { this.socketUp = true; this.remount(); }
  socketBack() {
    this.socketUp = true;
    if (this.rule === 'fixed') { noteScheduleSocketGap(this.gate); this.settle(); }
  }
  goOffline() { this.online = false; }
  reconnect(gapMs = 120) { this.online = true; this.gapMs = gapMs; this.drain(); }
  /** He leaves Schedule Pro and comes back: the unmount flush, then a new mount loaded from `projects`. */
  remount() {
    if (this.persistPending) {
      this.clear(this.persistTimer);
      this.persistPending = false;
      this.saveAsRow(buildScheduleFromTasks('S', 'p1', this.working, null, { criticalPathDays: 60 }).tasks);
    }
    this.working = this.ctx.tasks;
    this.undoStack = [];
    this.redoStack = [];
    this.lastEffect = this.ctx;
    if (this.rule === 'fixed') { this.gate = openScheduleSyncGate(`${this.name}:p1`, this.ctx.stamp); this.mounted(); }
    else this.shippedBaseline = this.ctx.tasks;
  }
  /** The page reloads (a fresh JS runtime) with saves still queued. */
  reload() {
    resetScheduleSyncGatesForTest();
    this.clear(this.persistTimer);
    this.persistPending = false;
    this.working = this.ctx.tasks;
    this.undoStack = [];
    this.redoStack = [];
    this.lastEffect = this.ctx;
    this.gate = openScheduleSyncGate(`${this.name}:p1`, this.ctx.stamp);
    seedQueuedScheduleStamps(this.gate, queuedScheduleStamps(
      this.outbox.map(r => ({ table: 'projects', data: { id: 'p1', schedule: { updatedAt: r.stamp, tasks: r.tasks } } })), 'p1'));
    this.mounted();
  }
}

const INITIAL: ScheduleTask[] = [
  { id: 'A', title: 'Demo', phase: 'Site', startDay: 1, durationDays: 3, progress: 0, crew: '', dependencies: [], notes: '', status: 'not_started' },
  { id: 'B', title: 'Framing', phase: 'Frame', startDay: 10, durationDays: 5, progress: 0, crew: '', dependencies: [], notes: '', status: 'not_started' },
  { id: 'C', title: 'Drywall', phase: 'Finish', startDay: 20, durationDays: 4, progress: 0, crew: '', dependencies: [], notes: '', status: 'not_started' },
  { id: 'P', title: 'Paint', phase: 'Finish', startDay: 30, durationDays: 3, progress: 0, crew: '', dependencies: [], notes: '', status: 'not_started' },
] as unknown as ScheduleTask[];

const drag = (id: string, startDay: number) => (ts: ScheduleTask[]) => ts.map(t => t.id === id ? { ...t, startDay } : t);
const setProgress = (id: string, progress: number) => (ts: ScheduleTask[]) => ts.map(t => t.id === id ? { ...t, progress } : t);
const addAfter = (afterId: string, row: Partial<ScheduleTask>) => (ts: ScheduleTask[]) => {
  const i = ts.findIndex(t => t.id === afterId);
  return [...ts.slice(0, i + 1), { ...INITIAL[0], ...row } as ScheduleTask, ...ts.slice(i + 1)];
};
const remove = (id: string) => (ts: ScheduleTask[]) => ts.filter(t => t.id !== id);
const day = (ts: ScheduleTask[], id: string) => ts.find(t => t.id === id)?.startDay;
const prog = (ts: ScheduleTask[], id: string) => ts.find(t => t.id === id)?.progress;
const days = (ts: ScheduleTask[], ...which: string[]) => which.map(id => day(ts, id));
const has = (ts: ScheduleTask[], id: string) => ts.some(t => t.id === id);
/** Content per id, ignoring order and the keys the app derives by itself. */
function content(ts: ScheduleTask[]): string {
  const DERIVED = new Set(['isCriticalPath', 'wbsCode', 'collapsed', 'fieldEditedAt']);
  const clean = (ts as Tk[]).map(t => Object.fromEntries(Object.entries(t).filter(([k, v]) => !DERIVED.has(k) && v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1))));
  clean.sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
  return JSON.stringify(clean);
}
/** Did the screen ever show `id` somewhere other than `want` after `from` ms? */
const snappedBack = (s: Sim, id: string, want: number, from: number) => s.shown.some(x => x.at >= from && day(x.tasks, id) !== want);
const reappeared = (s: Sim, id: string, from: number) => s.shown.some(x => x.at >= from && has(x.tasks, id));
const vanished = (s: Sim, id: string, from: number) => s.shown.some(x => x.at >= from && !has(x.tasks, id));
/** A copy shown that is not what his edits left (with no one else writing, any is a snap-back). */
const deviated = (s: Sim) => s.shown.some((x, i) => x.why === 'adopt' || x.why === 'echo' || x.why === 'rebase'
  ? content(x.tasks) !== content(s.shown.slice(0, i).reverse().find(y => y.why === 'edit' || y.why === 'undo' || y.why === 'redo')?.tasks ?? INITIAL)
  : false);
const converged = (s: Sim) => content(s.working) === content(s.server);
const both = (script: (s: Sim) => void, until?: number, echo?: (at: number) => number) => {
  const mk2 = (rule: Rule) => { resetScheduleSyncGatesForTest(); const s = new Sim(rule); if (echo) s.echoMs = echo; script(s); return s.run(until); };
  return { fixed: mk2('fixed'), shipped: mk2('shipped') };
};

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nthe reported timeline — drags at 0 / 1.0 / 1.9 s, online (500 ms persist + 800 ms sync + request + echo):');
{
  const { fixed, shipped } = both((s) => {
    s.at(0, () => s.commit(drag('A', 2)));
    s.at(1_000, () => s.commit(drag('B', 12)));
    s.at(1_900, () => s.commit(drag('C', 22)));
  });
  expect('control — as shipped, B snaps back and the server ends with B unmoved', [snappedBack(shipped, 'B', 12, 1_050), day(shipped.server, 'B')], [true, 10]);
  expect('fixed: nothing he did snaps back', [snappedBack(fixed, 'B', 12, 1_050), snappedBack(fixed, 'C', 22, 1_950), deviated(fixed)], [false, false, false]);
  expect('fixed: the server keeps all three drags, and the screen ends where the server is', [...days(fixed.server, 'A', 'B', 'C'), converged(fixed)], [2, 12, 22, true]);
  expect('fixed: at rest the screen took the server copy whole (its own last save came back)', fixed.shown.some(x => x.why === 'adopt') || content(fixed.working) === content(fixed.server), true);
  for (const lat of [150, 1_200, 2_000, 4_000]) {
    const r = both((s) => {
      s.at(0, () => s.commit(drag('A', 2)));
      s.at(1_000, () => s.commit(drag('B', 12)));
      s.at(1_900, () => s.commit(drag('C', 22)));
      s.at(2_900, () => s.commit(drag('P', 33)));
    }, undefined, () => lat);
    if (lat >= 1_200) expect(`control — echo ${lat} ms: as shipped, an edit is lost or snaps back`,
      JSON.stringify(days(r.shipped.server, 'A', 'B', 'C', 'P')) !== JSON.stringify([2, 12, 22, 33]) || deviated(r.shipped), true);
    expect(`fixed — echo ${lat} ms: every edit on the server, nothing snaps back, at rest on the server`,
      [...days(r.fixed.server, 'A', 'B', 'C', 'P'), deviated(r.fixed), converged(r.fixed)], [2, 12, 22, 33, false, true]);
  }
  for (const rm of [0, 16, 40]) {
    resetScheduleSyncGatesForTest();
    const s = new Sim('fixed'); s.renderMs = () => rm;
    s.at(0, () => s.commit(drag('A', 2))); s.at(1_000, () => s.commit(drag('B', 12))); s.at(1_900, () => s.commit(drag('C', 22)));
    s.run();
    expect(`fixed — renders ${rm} ms late: nothing snaps back, converged`, [deviated(s), converged(s), ...days(s.server, 'A', 'B', 'C')], [false, true, 2, 12, 22]);
  }
}

console.log('\nundo ~1 s after a save; delete-then-undo; add-then-delete:');
{
  let shippedUndoLost = false;
  for (const at of [900, 1_000, 1_300, 1_900]) {
    const u = both((s) => { s.at(0, () => s.commit(drag('B', 12))); s.at(at, () => s.undo()); });
    const d = both((s) => { s.at(0, () => s.commit(remove('C'))); s.at(at, () => s.undo()); });
    shippedUndoLost ||= snappedBack(u.shipped, 'B', 10, at + 1) || day(u.shipped.server, 'B') !== 10 || vanished(d.shipped, 'C', at + 1) || !has(d.shipped.server, 'C');
    expect(`fixed — undo at +${at} ms: B stays at 10 on the screen and the server`, [snappedBack(u.fixed, 'B', 10, at + 1), day(u.fixed.server, 'B'), converged(u.fixed)], [false, 10, true]);
    expect(`fixed — delete C, undo at +${at} ms: C never vanishes again, the server has it`, [vanished(d.fixed, 'C', at + 1), has(d.fixed.server, 'C'), converged(d.fixed)], [false, true, true]);
    const a = both((s) => { s.at(0, () => s.commit(addAfter('B', { id: 'N', title: 'New row', startDay: 12 }))); s.at(at, () => s.commit(remove('N'))); });
    if (at === 1_000) expect(`control — add then delete at +${at} ms: as shipped, the row comes back or stays on the server`, reappeared(a.shipped, 'N', at + 1) || has(a.shipped.server, 'N'), true);
    expect(`fixed — add then delete at +${at} ms: the row never comes back, the server lacks it`, [reappeared(a.fixed, 'N', at + 1), has(a.fixed.server, 'N'), converged(a.fixed)], [false, false, true]);
  }
  expect('control — as shipped, an undo or a delete-undo ~1 s after a save comes back wrong at one of these timings', shippedUndoLost, true);
  const ur = both((s) => { s.at(0, () => s.commit(drag('B', 12))); s.at(700, () => s.commit(drag('B', 14))); s.at(1_400, () => s.undo()); s.at(2_100, () => s.redo()); s.at(2_800, () => s.undo()); });
  expect('fixed — drag, drag, undo, redo, undo ~0.7 s apart: nothing snaps back, B=12 everywhere', [deviated(ur.fixed), day(ur.fixed.server, 'B'), converged(ur.fixed)], [false, 12, true]);
}

console.log('\nmore than 16 saves made offline, then replayed:');
{
  for (const n of [17, 40]) {
    const r = both((s) => {
      s.at(0, () => s.goOffline());
      for (let i = 0; i < n; i++) s.at(100 + i * 1_500, () => s.commit(drag(i % 2 ? 'B' : 'C', 11 + (i % 7) + (i % 2 ? 0 : 10))));
      s.at(100 + n * 1_500, () => s.commit(drag('A', 5)));
      s.at(200 + n * 1_500 + 2_000, () => s.reconnect(120));
    }, 200_000);
    expect(`control — ${n} offline saves: as shipped, the replay walks the grid back`, deviated(r.shipped), true);
    expect(`fixed — ${n} offline saves: the replay never shows an older state, the server ends on the last, converged`,
      [deviated(r.fixed), content(r.fixed.server) === content(r.fixed.intended), converged(r.fixed)], [false, true, true]);
  }
  // An edit made WHILE the replay runs.
  resetScheduleSyncGatesForTest();
  const s = new Sim('fixed');
  s.at(0, () => s.goOffline());
  for (let i = 0; i < 20; i++) s.at(100 + i * 1_500, () => s.commit(drag('B', 11 + i)));
  s.at(33_000, () => s.reconnect(400));
  s.at(33_900, () => s.commit(drag('C', 29)));
  s.run(200_000);
  expect('fixed — an edit during the replay: kept, joins the queue behind it, nothing older shown', [deviated(s), day(s.server, 'B'), day(s.server, 'C'), converged(s)], [false, 30, 29, true]);
  // A reload with saves still queued (a fresh runtime: the stamps come from the queue seed).
  resetScheduleSyncGatesForTest();
  const rl = new Sim('fixed');
  rl.at(0, () => rl.goOffline());
  for (let i = 0; i < 18; i++) rl.at(100 + i * 1_500, () => rl.commit(drag('B', 11 + i)));
  rl.at(30_000, () => rl.reload());
  rl.at(31_000, () => rl.reconnect(150));
  rl.run(200_000);
  expect('fixed — page reloaded with 18 saves queued: the replay shows nothing older, converged', [deviated(rl), day(rl.server, 'B'), converged(rl)], [false, 28, true]);
  expect('...and the device keeps a bounded number of stamps', rl.gate.own.stamps.length <= MAX_OWN_SCHEDULE_STAMPS, true);
}

console.log('\na colleague\'s change the socket missed (review cases A and D′):');
{
  const caseA = (via: 'refetch' | 'reconnect') => {
    resetScheduleSyncGatesForTest();
    const s = new Sim('fixed');
    s.at(0, () => s.commit(drag('B', 12)));
    s.at(3_000, () => s.commit(drag('B', 14)));
    s.at(6_000, () => s.socketDown());
    s.at(7_000, () => s.w.peerRowWrite(drag('B', 12)));
    s.at(9_000, () => (via === 'refetch' ? s.refetch() : s.socketBack()));
    s.at(12_000, () => s.commit(drag('A', 4)));
    return s.run();
  };
  for (const via of ['refetch', 'reconnect'] as const) {
    const a = caseA(via);
    expect(`A via ${via}: the laptop shows the phone's B=12, and its next save keeps it (server B=12, A=4)`, [day(a.server, 'B'), day(a.server, 'A'), converged(a)], [12, 4, true]);
  }
  const caseD = (via: 'refetch' | 'reconnect', thenEdit: boolean) => {
    resetScheduleSyncGatesForTest();
    const s = new Sim('fixed');
    s.at(0, () => s.commit(drag('B', 12)));
    s.at(3_000, () => s.commit(drag('C', 22)));
    s.at(6_000, () => s.socketDown());
    s.at(7_000, () => s.w.peerRowWrite(drag('C', 20)));
    s.at(9_000, () => (via === 'refetch' ? s.refetch() : s.socketBack()));
    if (thenEdit) s.at(12_000, () => s.commit(drag('A', 4)));
    return s.run();
  };
  for (const via of ['refetch', 'reconnect'] as const) {
    const d = caseD(via, true);
    expect(`D′ via ${via}: server keeps the phone's C=20 after the laptop's next drag`, [day(d.server, 'C'), day(d.server, 'B'), day(d.server, 'A'), converged(d)], [20, 12, 4, true]);
    const idle = caseD(via, false);
    expect(`D′ via ${via}, no further edit: the idle laptop shows C=20, as the server does`, [day(idle.working, 'C'), converged(idle)], [20, true]);
  }
  // A again, but the socket drops before his B=14 save comes back: its echo is
  // lost, so only the refetch / re-read can say it landed.
  for (const via of ['refetch', 'reconnect'] as const) {
    resetScheduleSyncGatesForTest();
    const s = new Sim('fixed');
    s.at(0, () => s.commit(drag('B', 12)));
    s.at(3_000, () => s.commit(drag('B', 14)));
    s.at(4_400, () => s.socketDown()); // his save commits at ~4.38 s, its echo would land ~4.73 s
    s.at(7_000, () => s.w.peerRowWrite(drag('B', 12)));
    s.at(9_000, () => (via === 'refetch' ? s.refetch() : s.socketBack()));
    s.at(12_000, () => s.commit(drag('A', 4)));
    s.run();
    expect(`A with his own echo lost, via ${via}: the phone's B=12 is shown and kept (server B=12, A=4)`, [day(s.server, 'B'), day(s.server, 'A'), converged(s)], [12, 4, true]);
  }
  // The socket drops the ECHO of his own last save, then the phone writes.
  resetScheduleSyncGatesForTest();
  const e = new Sim('fixed');
  e.at(0, () => e.commit(drag('B', 12)));
  e.at(1_000, () => e.socketDown());
  e.at(3_000, () => e.socketBack());
  e.at(6_000, () => e.w.peerRowWrite(drag('P', 31)));
  e.run();
  expect('his echo lost in a gap: the re-read settles it, and the phone\'s later change comes in live', [day(e.working, 'P'), day(e.working, 'B'), converged(e)], [31, 12, true]);
}

console.log('\nthe re-read races a live event; a copy that was stale before the screen opened (integration round 2):');
{
  // Critic round 2: a colleague's event adopted while the reconnect re-read is
  // out; the re-read's older answer must not be adopted over it.
  resetScheduleSyncGatesForTest();
  const s = new Sim('fixed');
  s.echoMs = () => 80;
  s.reqMs = 400;
  s.at(0, () => s.commit(drag('B', 12)));
  s.at(3_000, () => s.socketDown());
  s.at(5_000, () => s.w.peerRowWrite(drag('C', 25))); // missed
  s.at(8_000, () => s.socketBack());                  // re-read reads at 8.2 s, answers at 8.4 s
  s.at(8_250, () => s.w.peerRowWrite(drag('P', 31))); // its event lands inside the re-read's round trip
  s.at(10_000, () => s.commit(drag('A', 4)));
  s.run();
  expect('a colleague\'s P=31 adopted during the re-read survives its older answer and his next drag (server P=31, C=25, A=4)',
    [day(s.server, 'P'), day(s.server, 'C'), day(s.server, 'A'), day(s.server, 'B'), converged(s)], [31, 25, 4, 12, true]);
  expect('...and once shown it never disappears from his screen', s.shown.some(x => x.at > 8_330 && day(x.tasks, 'P') !== 31 && x.at < 10_000), false);

  // A peer write before the screen opened, on a copy ProjectContext never
  // refreshed (the laptop tab stayed visible, so no foreground refetch). The
  // new channel only hears events from its join on.
  for (const late of [false, true]) {
    resetScheduleSyncGatesForTest();
    const m = new Sim('fixed');
    m.at(0, () => m.socketDown());                          // not on the screen: no channel
    m.at(1_000, () => m.w.peerRowWrite(drag('C', 25)));    // his phone
    m.at(2_000, () => m.mountFresh());                      // opens Schedule Pro from the stale copy
    m.at(late ? 2_100 : 4_000, () => m.commit(drag('A', 4))); // drags before / after the mount read answers
    m.run();
    // Drag BEFORE the mount read answers: the screen is busy when it lands, so
    // it is ignored and his save wins — the stated last-write-wins residual.
    expect(late
      ? 'a peer write before mount, drag before the mount read answers: his save wins (last write, the stated residual), converged'
      : 'a peer write before mount, drag after the mount read answers: the phone\'s C=25 is shown and kept (server C=25, A=4), converged',
      [day(m.server, 'C'), day(m.server, 'A'), converged(m)], late ? [20, 4, true] : [25, 4, true]);
  }
}

console.log('\ncolleagues and the foreman:');
{
  // A colleague's commit lands a moment before his save; its echo arrives after his request reported.
  resetScheduleSyncGatesForTest();
  const r = new Sim('fixed');
  r.echoMs = () => 600;
  r.at(0, () => r.commit(drag('B', 12)));
  r.at(1_300 + 70, () => r.w.peerRowWrite(drag('P', 31))); // commits just before his (sync fires at 1300, commits at +80)
  r.run();
  expect('a colleague commit just BEFORE his save: never shown over his drag; he wins (last write), converged',
    [snappedBack(r, 'B', 12, 1), day(r.server, 'B'), day(r.server, 'P'), converged(r)], [false, 12, 30, true]);
  // A colleague writes while he is idle: taken live.
  resetScheduleSyncGatesForTest();
  const idle = new Sim('fixed');
  idle.at(0, () => idle.commit(drag('B', 12)));
  idle.at(5_000, () => idle.w.peerRowWrite(drag('C', 25)));
  idle.at(5_100, () => idle.w.peerRowWrite(remove('P')));
  idle.run();
  expect('a colleague\'s changes while he is idle come in whole (a date, a deleted row)', [day(idle.working, 'C'), has(idle.working, 'P'), day(idle.working, 'B'), converged(idle)], [25, false, 12, true]);
  // A colleague writes while he is mid-edit: last write wins (the stated residual).
  resetScheduleSyncGatesForTest();
  const busy = new Sim('fixed');
  busy.at(0, () => busy.commit(drag('B', 12)));
  busy.at(300, () => busy.w.peerRowWrite(drag('C', 25)));
  busy.run();
  expect('a colleague\'s non-field change landing while he is mid-save is overwritten (last write wins), and the screen never jumps',
    [day(busy.server, 'C'), deviated(busy), converged(busy)], [20, false, true]);
  // The foreman's progress while the GC is mid-save: protected by the server.
  resetScheduleSyncGatesForTest();
  const f = new Sim('fixed');
  f.at(0, () => f.commit(drag('B', 12)));
  f.at(300, () => f.w.peerFieldRpc('C', { progress: 60 }));
  f.at(4_000, () => f.commit(drag('A', 3)));
  f.run();
  expect('the foreman\'s progress landing mid-save survives the GC\'s saves (server trigger) and reaches his screen',
    [prog(f.server, 'C'), prog(f.working, 'C'), day(f.server, 'B'), day(f.server, 'A'), converged(f)], [60, 60, 12, 3, true]);
}

console.log('\nleaving the screen with a save still leaving:');
{
  for (const at of [200, 600, 1_000, 1_450]) {
    const r = both((s) => { s.at(0, () => s.commit(drag('B', 12))); s.at(700, () => s.commit(drag('C', 22))); s.at(at + 700, () => s.remount()); s.at(at + 900, () => s.commit(drag('P', 33))); });
    expect(`fixed — remount at +${at} ms after the last drag: no snap-back, every drag on the server, converged`,
      [deviated(r.fixed), ...days(r.fixed.server, 'B', 'C', 'P'), converged(r.fixed)], [false, 12, 22, 33, true]);
  }
}

console.log('\nanother writer on this device while he edits (integration round 3):');
{
  // The CO reflow modelled as the critic's replay did: C +5 days, P shifted 5.
  const reflow = (ts: ScheduleTask[]) => ts.map(t => (t.id === 'C' ? { ...t, durationDays: (t.durationDays ?? 0) + 5 } : t.id === 'P' ? { ...t, startDay: (t.startDay ?? 0) + 5 } : t));
  const dur = (ts: ScheduleTask[], id: string) => ts.find(t => t.id === id)?.durationDays;
  const kept = (s: Sim) => [dur(s.server, 'C'), day(s.server, 'P'), day(s.server, 'A'), converged(s)];
  const timeline = (gap: number, echo?: number) => both((s) => {
    s.at(0, () => s.commit(drag('B', 12)));          // an earlier edit, long settled
    s.at(5_000, () => s.localWrite(reflow));          // the other writer
    s.at(5_000 + gap, () => s.commit(drag('A', 4)));  // he drags a DIFFERENT task
  }, undefined, echo ? () => echo : undefined);
  for (const gap of [100, 400, 700, 1_000, 1_300, 2_000, 4_000]) {
    const r = timeline(gap);
    expect(`drag ${gap} ms after the other write: it is shown at once and his drag is built on it (server C=9d, P=35, A=4), converged`, kept(r.fixed), [9, 35, 4, true]);
  }
  for (const gap of [1_300, 2_000, 2_600]) {
    expect(`echo 1.2 s, drag ${gap} ms after: kept`, kept(timeline(gap, 1_200).fixed), [9, 35, 4, true]);
  }
  // The residual: the other write lands inside his 500 ms persist debounce.
  // His save is built on a working copy without it and replaces it (last
  // write wins) — the screen never shows it, so it never shows a lie. The
  // portal reconciler no longer writes the schedule (deferReflow), which was
  // the reachable case.
  const inside = timeline(-300);
  expect('residual — the other write lands inside his persist debounce: his save wins, never shown, converged',
    [dur(inside.fixed.server, 'C'), day(inside.fixed.server, 'A'), inside.fixed.shown.some(x => dur(x.tasks, 'C') === 9), converged(inside.fixed)], [4, 4, false, true]);
  for (const dragAt of [8_000, 20_000, 60_000]) {
    const r = both((s) => {
      s.at(0, () => s.commit(drag('B', 12)));
      s.at(3_000, () => s.socketDown());
      s.at(5_000, () => s.localWrite(reflow));
      s.at(dragAt, () => s.commit(drag('A', 4)));
    }, 90_000);
    expect(`socket down, idle, drag at ${dragAt / 1000} s: shown before his drag and kept`,
      [r.fixed.shown.some(x => x.at < dragAt && dur(x.tasks, 'C') === 9), ...kept(r.fixed)], [true, 9, 35, 4, true]);
  }
  // Schedule Pro on the empty on-ramp → builder → review's Accept replaces
  // itself with a NEW Schedule Pro; the old one stays mounted underneath.
  // Offline, the Accept's write sits in the queue.
  for (const rule of ['fixed', 'shipped'] as Rule[]) {
    resetScheduleSyncGatesForTest();
    const s = new Sim(rule, []);
    s.at(1_000, () => s.goOffline());
    s.at(2_000, () => s.localWrite(() => INITIAL, 'GEN'));
    s.at(9_000, () => s.commit(ts => [...ts, { ...INITIAL[0], id: 'M', title: 'Manual row', startDay: 40 } as ScheduleTask]));
    s.at(15_000, () => s.reconnect(150));
    s.run(60_000);
    expect(`${rule === 'fixed' ? 'fixed' : 'control (as shipped, rebased)'} — the old instance under an accepted schedule, offline: it shows the schedule and his added row joins it`,
      [s.shown.some(x => x.at < 9_000 && x.tasks.length === 4), s.server.map(t => t.id).sort().join(','), converged(s)], [true, 'A,B,C,M,P', true]);
  }
  // Critic round 3, minor: his own save's echo, slower than the mount
  // re-read, must not replace the newer copy that read already showed.
  for (const dragAt of [0, 2_950]) {
    resetScheduleSyncGatesForTest();
    const s = new Sim('fixed');
    s.echoMs = () => 1_500;
    s.at(0, () => s.commit(drag('B', 12)));            // S1: commits ~1.38 s, echo ~2.88 s
    s.at(600, () => s.remount());                       // a new gate; the mount re-read goes out once quiet
    s.at(1_500, () => s.w.peerRowWrite(drag('P', 31))); // a colleague, after S1
    if (dragAt) s.at(dragAt, () => s.commit(drag('A', 4)));
    s.run();
    const firstShown = s.shown.find(x => day(x.tasks, 'P') === 31)?.at ?? Infinity;
    expect(`the mount read showed the colleague's P=31; his own older echo does not take it away${dragAt ? ', and his drag keeps it (server P=31, A=4)' : ''}`,
      [firstShown < 2_880, s.shown.some(x => x.at > firstShown && day(x.tasks, 'P') !== 31), day(s.server, 'P'), converged(s)], [true, false, 31, true]);
  }
  // Leftovers review: the same race after a SOCKET GAP instead of a remount.
  // The gap re-read shows the colleague's P=31 (and stands in for my S1);
  // S1's own echo, landing after it, is older news (heldThrough).
  for (const dragAt of [0, 2_950]) {
    resetScheduleSyncGatesForTest();
    const s = new Sim('fixed');
    s.echoMs = () => 1_500;
    s.at(0, () => s.commit(drag('B', 12)));            // S1: commits ~1.38 s, echo ~2.88 s
    s.at(100, () => s.socketDown());
    s.at(1_500, () => s.w.peerRowWrite(drag('P', 31))); // a colleague, after S1, while the socket is down
    s.at(1_600, () => s.socketBack());                  // gap re-read once quiet
    if (dragAt) s.at(dragAt, () => s.commit(drag('A', 4)));
    s.run();
    const firstShown = s.shown.find(x => day(x.tasks, 'P') === 31)?.at ?? Infinity;
    expect(`after a socket gap: the re-read showed P=31; his own older echo does not take it away${dragAt ? ', and his drag keeps it (server P=31, A=4)' : ''}`,
      [firstShown < 2_880, s.shown.some(x => x.at > firstShown && day(x.tasks, 'P') !== 31), day(s.server, 'P'), converged(s)], [true, false, 31, true]);
  }
}

console.log('\nfuzz — whole sessions:');
{
  const rnd = (seed: number) => () => { seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff; return seed / 0x7fffffff; };
  interface Mode { offline?: boolean; undo?: boolean; remount?: boolean; refetch?: boolean; jitter?: boolean; socket?: boolean; peer?: boolean }
  const run = (rule: Rule, seed: number, m: Mode) => {
    resetScheduleSyncGatesForTest();
    const r = rnd(seed);
    const s = new Sim(rule);
    s.echoMs = () => 80 + Math.floor(r() * 1_800);
    s.reqMs = 60 + Math.floor(r() * 400);
    if (m.jitter) s.renderMs = () => Math.floor(r() * 40);
    let t = 0, offline = false, sockDown = false, n = 0;
    let live = ['A', 'B', 'C', 'P'];
    for (let i = 0; i < 16; i++) {
      t += Math.floor(100 + r() * 2_400);
      const at = t;
      if (m.offline && r() < 0.12) { const on = offline; s.at(at, () => (on ? s.reconnect(50 + Math.floor(r() * 600)) : s.goOffline())); offline = !offline; continue; }
      if (m.socket && r() < 0.1) { const d = sockDown; s.at(at, () => (d ? s.socketBack() : s.socketDown())); sockDown = !sockDown; continue; }
      if (m.undo) { const u = r(); if (u < 0.14) { s.at(at, () => s.undo()); continue; } if (u < 0.2) { s.at(at, () => s.redo()); continue; } }
      if (m.remount && r() < 0.08) { s.at(at, () => s.remount()); continue; }
      if (m.refetch && r() < 0.08) { s.at(at, () => s.refetch()); continue; }
      if (m.peer && r() < 0.2) { const pv = Math.floor(1 + r() * 40); s.at(at, () => s.w.peerRowWrite(drag('P', pv))); continue; }
      const pool = m.peer ? live.filter(x => x !== 'P') : live;
      const id = pool[Math.floor(r() * pool.length)];
      const y = r();
      let op: (ts: ScheduleTask[]) => ScheduleTask[];
      if (y < 0.55) op = drag(id, Math.floor(1 + r() * 40));
      else if (y < 0.75) op = setProgress(id, Math.floor(r() * 10) * 10);
      else if (y < 0.9) { const nid = `N${n++}`; op = addAfter(id, { id: nid, title: `Row ${nid}`, startDay: Math.floor(1 + r() * 40) }); live = [...live, nid]; }
      else if (pool.length > 2) { op = remove(id); live = live.filter(q => q !== id); }
      else op = drag(id, 5);
      s.at(at, () => s.commit(op));
    }
    if (offline) s.at(t + 1_000, () => s.reconnect(300));
    if (sockDown) s.at(t + 1_200, () => s.socketBack());
    // The foreground at the end (the laptop wakes): what realtime missed is read.
    s.at(t + 60_000, () => s.refetch());
    s.run(t + 120_000);
    const mine = (ts: ScheduleTask[]) => content(m.peer ? ts.map(x => (x.id === 'P' ? { ...x, startDay: 0 } : x)) : ts);
    // Without a colleague: never shows anything but his own last state, and the server ends on it.
    const snapped = m.peer ? false : deviated(s);
    const lost = mine(s.server) !== mine(s.intended);
    return { lost, snapped, apart: !converged(s) };
  };
  const N = 300;
  const modes: Mode[] = [
    {}, { offline: true }, { undo: true }, { offline: true, undo: true }, { undo: true, jitter: true },
    { remount: true, refetch: true }, { offline: true, undo: true, remount: true, refetch: true }, { socket: true }, { socket: true, offline: true, undo: true }, { peer: true, socket: true, refetch: true },
  ];
  for (const m of modes) {
    const tally = (rule: Rule) => { let lost = 0, snapped = 0, apart = 0; for (let seed = 1; seed <= N; seed++) { const x = run(rule, seed, m); if (process.env.TRACE && rule === 'fixed' && (x.lost || x.snapped || x.apart)) console.log('    seed', seed, JSON.stringify(m), JSON.stringify(x)); lost += +x.lost; snapped += +x.snapped; apart += +x.apart; } return { lost, snapped, apart }; };
    const name = [m.offline ? 'offline spells' : 'online', m.undo && 'undo/redo', m.jitter && 'renders 0–40 ms late', m.remount && 'leaving and coming back',
      m.refetch && 'foreground refetches', m.socket && 'socket drops', m.peer && 'a colleague writing'].filter(Boolean).join(', ');
    const f = tally('fixed');
    if (!m.peer && !m.socket) { const c = tally('shipped'); expect(`control — ${name}: as shipped, sessions lose or snap back an edit`, c.lost + c.snapped > 0, true); }
    expect(`fixed — ${name}: ${N} sessions, none loses his edit, snaps one back, or ends apart from the server`, f, { lost: 0, snapped: 0, apart: 0 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nwiring:');
{
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const PRO = readFileSync(process.env.SCHEDULE_PRO_PATH ?? join(ROOT, 'app', 'schedule-pro.tsx'), 'utf8');
  const LIVE = readFileSync(join(ROOT, 'hooks', 'useLiveSchedule.ts'), 'utf8');
  const CTX = readFileSync(join(ROOT, 'contexts', 'ProjectContext.tsx'), 'utf8');
  const SM = readFileSync(join(ROOT, 'utils', 'scheduleMerge.ts'), 'utf8');
  const slice = (src: string, a: string, b: string) => { const i = src.indexOf(a); const j = i < 0 ? -1 : src.indexOf(b, i + a.length); return i < 0 || j < 0 ? '' : src.slice(i, j); };

  const row = slice(PRO, 'const saveAsRow = useCallback(', '}, [updateProjectRaw]);');
  expect('every row save is stamped and noted BEFORE it reaches updateProject',
    /const stamp = rawUpdates\.schedule \? nextOwnScheduleStamp\(syncGateRef\.current\) : null;/.test(row)
      && /if \(stamp\) noteOwnScheduleSave\(syncGateRef\.current, stamp\);\s*updateProjectRaw\(id, updates\);/.test(row)
      && /schedule: \{ \.\.\.rawUpdates\.schedule, updatedAt: stamp \}/.test(row), true);
  expect('...and every write site goes through the row / field save',
    /writePath === 'row'\s*\? saveAsRow\s*: writePath === 'field_rpc'/.test(PRO) && [...PRO.matchAll(/updateProjectRaw\(/g)].length === 2, true);
  expect('a field save counts as busy until the RPC answers, then settles',
    /fieldSavesInFlightRef\.current \+= 1;\s*noteFieldScheduleSave\(syncGateRef\.current\);\s*try \{/.test(PRO)
      && /\} finally \{\s*fieldSavesInFlightRef\.current -= 1;[^}]*settleSyncRef\.current\(\);\s*\}/.test(PRO), true);
  const busy = slice(PRO, 'const syncBusy = useCallback(', '), [livePeerProjectId, isProjectSyncUnconfirmed]);');
  expect('busy = persist waiting || field RPC out || a sync waiting or on the wire || a queued write',
    /persistPendingRef\.current/.test(busy) && /fieldSavesInFlightRef\.current > 0/.test(busy)
      && /isProjectSyncUnconfirmed\(livePeerProjectId\)/.test(busy) && /queueBusyRef\.current/.test(busy), true);
  const peer = slice(PRO, 'const onPeerSchedule = useCallback(', 'useLiveSchedule(project?.id, onPeerSchedule, onLiveGap);');
  expect('a realtime event goes through the gate, told whether the screen is busy, and nothing merges',
    /takeScheduleCopy\(syncGateRef\.current, incoming, 'echo', syncBusy\(\)\)/.test(peer) && /if \(copy\) adoptServerCopy\(copy\);/.test(peer), true);
  const outside = slice(PRO, 'useLiveSchedule(project?.id, onPeerSchedule, onLiveGap);', '}, [project?.schedule?.tasks, project?.schedule?.updatedAt, project?.schedule?.baselines]);');
  expect('a copy reaching project.schedule goes through takeStoreScheduleCopy: editing = persist waiting || field RPC out, settled = not busy; skipped when a save was noted after its render',
    /const rowSavesAtRender = syncGateRef\.current\.rowSaves;/.test(PRO)
      && /if \(gate\.rowSaves !== rowSavesAtRender\) return;/.test(outside)
      && /const settled = !syncBusy\(\);/.test(outside)
      && /takeStoreScheduleCopy\(gate, \{[\s\S]*?\}, persistPendingRef\.current \|\| fieldSavesInFlightRef\.current > 0, settled\);\s*if \(copy\) adoptServerCopy\(copy, settled\);/.test(outside)
      && /baselines: Array\.isArray\(incoming\.baselines\)/.test(outside), true);
  const adopt = slice(PRO, 'const adoptServerCopy = useCallback(', '}, [livePeerProjectId, absorbServerSchedule, setActiveBaselineId]);');
  expect('adoption is whole (grid in its own row order, sub rollup re-applied, baselines taken) and — when it is the server\'s — reaches ProjectContext with its stamp; no persist, no undo entry',
    /withSubRollup\(inLocalOrder\(copy\.tasks, h\.present\), subRollupRef\.current\)/.test(adopt)
      && /baselinesRef\.current = next;\s*setNamedBaselines\(next\);/.test(adopt)
      && /if \(!fromServer\) return;\s*lastServerTasksRef\.current = copy\.tasks;/.test(adopt)
      // wave 4 #86: the active baseline rides with the copy (when it says).
      && /absorbServerSchedule\(livePeerProjectId, copy\.tasks, \{\s*stamp: copy\.stamp,\s*baselines: copy\.baselines,\s*\.\.\.\(copy\.activeBaselineId !== undefined \? \{ activeBaselineId: copy\.activeBaselineId \} : \{\}\),\s*\}\)/.test(adopt)
      && /if \(copy\.activeBaselineId !== undefined\) \{/.test(adopt) && !/schedulePersist|pushHistory/.test(adopt), true);
  // wave 4 #86: ONE reader for the row's schedule (utils/fieldScheduleUpdate
  // scheduleCopyFromRow) — events and the re-read both go through it, and it
  // carries baselines and the active baseline id (missing key = cleared).
  const FSU = readFileSync(join(ROOT, 'utils', 'fieldScheduleUpdate.ts'), 'utf8');
  expect('events and the re-read carry the row\'s baselines (and the active baseline id)',
    /baselines: Array\.isArray\(s\.baselines\) \? s\.baselines : undefined/.test(FSU)
      && /activeBaselineId: typeof s\.activeBaselineId === 'string' \? s\.activeBaselineId : null/.test(FSU)
      && /liveScheduleCopyFromRow\(\(payload\.new as \{ schedule\?: unknown \} \| null\)\?\.schedule\)/.test(LIVE)
      && /answered\(error \? null : liveScheduleCopyFromRow\(\(data as \{ schedule\?: unknown \} \| null\)\?\.schedule\)\)/.test(PRO), true);
  const settle = slice(PRO, 'const settleSync = useCallback(', '}, [syncBusy, adoptServerCopy, livePeerProjectId]);');
  expect('settling: nothing while busy; a parked copy; the owed re-read begun and answered through the gate (as the Sim does), re-read at once when it says so',
    /if \(syncBusy\(\)\) return;/.test(settle) && /settleScheduleSyncGate\(gate, false\)/.test(settle)
      && /const read = beginScheduleReread\(gate\);\s*if \(!read\) return;/.test(settle)
      && /answerScheduleReread\(gate, read, answer, syncBusy\(\)\)/.test(settle)
      && /if \(adopt\) adoptServerCopy\(adopt\);\s*if \(readAgain\) settleSyncRef\.current\(\);/.test(settle)
      && /if \(syncGateRef\.current !== gate\) return;/.test(settle) && /\(\) => answered\(null\)/.test(settle), true);
  expect('settling is triggered by a sync reporting, the queue changing, the persist timer and the field RPC',
    /onProjectSyncSettled\(\(\) => settleSyncRef\.current\(\)\)/.test(PRO) && /onQueueChanged\(refresh\)/.test(PRO)
      && /updateProject\(project\.id, \{ schedule: withBaselines \}\);[\s\S]{0,200}settleSyncRef\.current\(\);/.test(PRO), true);
  expect('the queue read seeds the stamps of saves queued before this mount',
    /seedQueuedScheduleStamps\(syncGateRef\.current, queuedScheduleStamps\(queue, pid\)\)/.test(PRO) && /queueBusyRef\.current = projectWriteQueued\(queue, pid\);/.test(PRO), true);
  expect('the load opens a new gate with the loaded copy\'s stamp',
    /syncGateRef\.current = openScheduleSyncGate\(project\?\.id, project\?\.schedule\?\.updatedAt \?\? null\);/.test(PRO), true);
  expect('the stale-estimate cleanup is saved like any edit (adoption would otherwise put the ids back)',
    /setHist\(h => \(\{ \.\.\.h, present: cleanedTasks \}\)\);\s*schedulePersistRef\.current\(cleanedTasks\);/.test(PRO), true);
  expect('no merge / rebase / tracker left in the screen or the module',
    !/mergeScheduleTasks|rebaseWorkingTasks|echoTracker|absorbScheduleEcho|convergeToServer|shieldUnechoed|takeClobbered|parkSchedule|ownEchoes/.test(PRO + SM), true);
  const flush = slice(PRO, '// Flush on unmount so we never lose an edit to a pending timer.', '// Phase 2 — live sync + presence');
  expect('the unmount flush is bound once (deps []), writes only when an edit is waiting, through the stamped row save',
    /useEffect\(\(\) => \{\s*return \(\) => \{\s*if \(!persistPendingRef\.current\) return;/.test(flush)
      && /\n  \}, \[\]\);/.test(flush) && /flushUpdateProjectRef\.current\(project\.id, \{/.test(flush), true);
  expect('useLiveSchedule hands over the save stamp and reports a re-subscribe after a drop',
    /stamp: typeof s\.updatedAt === 'string' \? s\.updatedAt : null,/.test(readFileSync(join(ROOT, 'utils', 'fieldScheduleUpdate.ts'), 'utf8'))
      && /export const liveScheduleCopyFromRow = scheduleCopyFromRow;/.test(LIVE)
      && /if \(joined && dropped\) gapRef\.current\?\.\(\);/.test(LIVE), true);
  const abs = slice(CTX, 'const absorbServerSchedule = useCallback(', 'const saveChangeOrdersMutationRaw = useMutation(');
  expect('ProjectContext takes an adopted copy whole with its stamp — unless a sync of the project is still out',
    /const whole = !!adopt && !unconfirmedProjectSyncIds\(syncDebounceMap\.current, inFlightProjectSyncsRef\.current\)\.has\(projectId\);/.test(abs)
      && /const next = whole \? tasks : absorbServerScheduleTasks\(prevServer, tasks, localTasks\);/.test(abs), true);
  // Leftovers review: the store took TASKS only, so another screen's write of
  // project.schedule from it deleted a baseline captured on another device.
  // #86 (wave 4) moved the rule into utils/projectContextPure.absorbedScheduleMeta
  // (it also carries the active baseline id): run the rule, pin the call site.
  {
    const stored = { baselines: [{ id: 'v1' }], activeBaselineId: 'v1' };
    const withKey = { baselines: [{ id: 'v1' }, { id: 'v2' }], activeBaselineId: 'v2' };
    const took = absorbedScheduleMeta(stored, withKey, true);
    const noKey = absorbedScheduleMeta(stored, { activeBaselineId: undefined }, true);
    const partial = absorbedScheduleMeta(stored, withKey, false);
    const cleared = absorbedScheduleMeta(stored, { baselines: [], activeBaselineId: null }, true);
    expect('…and whole means its named baselines too (a copy without the key keeps the stored ones)',
      JSON.stringify(took.baselines) === JSON.stringify(withKey.baselines) && took.activeBaselineId === 'v2'
        && noKey.baselines === stored.baselines && noKey.activeBaselineId === 'v1'
        && partial.baselines === stored.baselines && partial.activeBaselineId === 'v1'
        && JSON.stringify(cleared.baselines) === '[]' && cleared.activeBaselineId === undefined
        && /const meta = absorbedScheduleMeta\(p\.schedule, adopt, whole\);\s*const baselines = meta\.baselines;/.test(abs)
        && /schedule: withActiveBaselineId\(\{ \.\.\.x\.schedule, tasks: next, updatedAt: stamp, baselines \}, meta\.activeBaselineId\)/.test(abs)
        && /JSON\.stringify\(baselines\) === JSON\.stringify\(p\.schedule\.baselines\)[\s\S]{0,160}&& meta\.activeBaselineId === p\.schedule\.activeBaselineId\) return;/.test(abs), true);
  }
  expect('ProjectContext tells listeners each time a project sync reports',
    /inFlightProjectSyncsRef\.current\.delete\(entry\);[\s\S]{0,200}for \(const listener of Array\.from\(projectSyncSettledListenersRef\.current\)\)/.test(CTX), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
