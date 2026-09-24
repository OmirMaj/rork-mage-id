// utils/tutorial/progress.ts — the mageid_tutorials_v1 blob: which tutorials
// he has practised or walked out of, the one saved run the hub can offer as
// 'Continue', and the contextual chips he has seen or dismissed.
//
// WHY THESE RULES
//   • One key, mageid_ prefix. APP_STORAGE_PREFIXES covers it, so the
//     tenant-switch sweep (wipeLocalUserCache) clears it and one GC's progress
//     never shows on the next account signed in on the same phone. The
//     in-memory copy here is dropped on a user change too
//     (resetTutorialProgressCache, called by the host).
//   • Parsed with zod; garbage (an old shape, a half write, a hand edit) parses
//     to EMPTY instead of throwing into the hub.
//   • Written only at checkpoints and terminal states — never per step — so a
//     run costs a handful of writes, and what is saved is always somewhere a
//     resume can restart from.
//   • Resume is never automatic: `active` is only ever read to show
//     'Continue · step 3 of 8' and the paused pill.
//
// The transitions (withStarted, withCheckpoint, withPractised, withExited,
// withChipShown, withChipDismissed) are pure, so scripts/validate-tutorial-
// store.ts runs them under bun. AsyncStorage is imported lazily for the same
// reason: its module pulls react-native, which bun cannot load.

import { useEffect, useSyncExternalStore } from 'react';
import { z } from 'zod';
import type { SavedActiveRun, TutorialId, TutorialProgress, TutorialProgressEntry } from './types';
import { TUTORIAL_PROGRESS_KEY } from './registry';
import { EMPTY_PROGRESS } from './offers';
import { TUTORIAL_ORDER } from './defs';

const KNOWN = new Set<string>(TUTORIAL_ORDER);
const TutorialIdSchema = z.string().refine(s => KNOWN.has(s));

const EntrySchema = z.object({
  status: z.enum(['new', 'in_progress', 'practised', 'exited']),
  version: z.number(),
  checkpointStepId: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  exitedAt: z.string().optional(),
  bestMs: z.number().nonnegative().optional(),
});

const ActiveSchema = z.object({
  tutorialId: TutorialIdSchema,
  version: z.number(),
  stepIndex: z.number().int().nonnegative(),
  sandboxProjectId: z.string().min(1),
  entry: z.enum(['onboarding', 'chip', 'checklist', 'paywall', 'hub', 'chain']),
  returnTo: z.string().nullable().optional(),
  savedAt: z.number(),
});

const ChipSchema = z.object({ shownAt: z.string().optional(), dismissedAt: z.string().optional() });

const ProgressSchema = z.object({
  v: z.literal(1),
  byId: z.record(z.string(), EntrySchema),
  active: ActiveSchema.optional(),
  chips: z.record(z.string(), ChipSchema),
  lastChipDay: z.string().optional(),
});

/** Any stored value → a valid blob. Unknown tutorial ids are dropped (an id a
 *  later build removed), and anything unparseable is EMPTY. */
export function parseTutorialProgress(raw: unknown): TutorialProgress {
  let value = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch { return EMPTY_PROGRESS; }
  }
  const parsed = ProgressSchema.safeParse(value);
  if (!parsed.success) return EMPTY_PROGRESS;
  const p = parsed.data;
  const byId: TutorialProgress['byId'] = {};
  for (const [k, e] of Object.entries(p.byId)) if (KNOWN.has(k)) byId[k as TutorialId] = e as TutorialProgressEntry;
  const chips: TutorialProgress['chips'] = {};
  for (const [k, c] of Object.entries(p.chips)) if (KNOWN.has(k)) chips[k as TutorialId] = c;
  return {
    v: 1,
    byId,
    chips,
    ...(p.active ? { active: p.active as SavedActiveRun } : {}),
    ...(p.lastChipDay ? { lastChipDay: p.lastChipDay } : {}),
  };
}

// ── Pure transitions ────────────────────────────────────────────────────────

function entryOf(p: TutorialProgress, id: TutorialId, version: number): TutorialProgressEntry {
  return p.byId[id] ?? { status: 'new', version };
}

/** A run booted. A practised tutorial STAYS practised on replay — replaying
 *  is not un-learning it — but the saved run is replaced. */
export function withStarted(p: TutorialProgress, id: TutorialId, version: number, iso: string): TutorialProgress {
  const prev = entryOf(p, id, version);
  const status = prev.status === 'practised' ? 'practised' : 'in_progress';
  return { ...p, byId: { ...p.byId, [id]: { ...prev, status, version, startedAt: iso } } };
}

/** A checkpoint step was entered: the one place a run is saved for resume. */
export function withCheckpoint(p: TutorialProgress, saved: SavedActiveRun, checkpointStepId: string): TutorialProgress {
  const prev = entryOf(p, saved.tutorialId, saved.version);
  return {
    ...p,
    active: saved,
    byId: { ...p.byId, [saved.tutorialId]: { ...prev, version: saved.version, checkpointStepId } },
  };
}

function withoutActiveFor(p: TutorialProgress, id: TutorialId): TutorialProgress {
  if (!p.active || p.active.tutorialId !== id) return p;
  const { active: _drop, ...rest } = p;
  return rest;
}

/** Reached the finale. bestMs keeps the fastest MEASURED run; a run with no
 *  measured stat (skipped the timed step) leaves it untouched. */
export function withPractised(p: TutorialProgress, id: TutorialId, version: number, iso: string, ms: number | null): TutorialProgress {
  const prev = entryOf(p, id, version);
  const best = typeof ms === 'number' && ms >= 0 ? (typeof prev.bestMs === 'number' ? Math.min(prev.bestMs, ms) : ms) : prev.bestMs;
  const { checkpointStepId: _c, ...kept } = prev;
  const entry: TutorialProgressEntry = { ...kept, status: 'practised', version, completedAt: iso, ...(typeof best === 'number' ? { bestMs: best } : {}) };
  return withoutActiveFor({ ...p, byId: { ...p.byId, [id]: entry } }, id);
}

/** Walked out. A tutorial he has ALREADY practised stays practised (exiting
 *  a replay is not a failure); otherwise it is 'exited', which the chip rules
 *  read as "never offer again". */
export function withExited(p: TutorialProgress, id: TutorialId, version: number, iso: string): TutorialProgress {
  const prev = entryOf(p, id, version);
  const status = prev.status === 'practised' ? 'practised' : 'exited';
  const { checkpointStepId: _c, ...kept } = prev;
  return withoutActiveFor({ ...p, byId: { ...p.byId, [id]: { ...kept, status, version, exitedAt: iso } } }, id);
}

/** An exit he did NOT choose (the boot failed offline, the sample vanished, a
 *  timeout, a persona switch, sign-out): drop this tutorial's saved run and
 *  checkpoint but keep its status, so it is still offered. Marking it
 *  'exited' would suppress its chip for good over a network blip. */
export function withInterrupted(p: TutorialProgress, id: TutorialId): TutorialProgress {
  const prev = p.byId[id];
  if (!prev) return withoutActiveFor(p, id);
  const { checkpointStepId: _c, ...kept } = prev;
  return withoutActiveFor({ ...p, byId: { ...p.byId, [id]: kept } }, id);
}

/** Drop a saved run that can no longer restore (sample gone, stale). */
export function withoutActive(p: TutorialProgress): TutorialProgress {
  if (!p.active) return p;
  const { active: _drop, ...rest } = p;
  return rest;
}

export function withChipShown(p: TutorialProgress, id: TutorialId, iso: string, today: string): TutorialProgress {
  return { ...p, chips: { ...p.chips, [id]: { ...(p.chips[id] ?? {}), shownAt: iso } }, lastChipDay: today };
}

export function withChipDismissed(p: TutorialProgress, id: TutorialId, iso: string): TutorialProgress {
  return { ...p, chips: { ...p.chips, [id]: { ...(p.chips[id] ?? {}), dismissedAt: iso } } };
}

// ── The cached blob + persistence ───────────────────────────────────────────

let cache: TutorialProgress = EMPTY_PROGRESS;
let loaded = false;
let loading: Promise<TutorialProgress> | null = null;
/** Bumped on reset so a load that started for the previous user is dropped. */
let generation = 0;
let writeChain: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

interface ProgressSnapshot {
  progress: TutorialProgress;
  loaded: boolean;
}
let snapshot: ProgressSnapshot = { progress: cache, loaded };

function publish(): void {
  snapshot = { progress: cache, loaded };
  for (const l of Array.from(listeners)) l();
}

async function storage() {
  const mod = await import('@react-native-async-storage/async-storage');
  return mod.default;
}

export function loadTutorialProgress(): Promise<TutorialProgress> {
  if (loaded) return Promise.resolve(cache);
  if (loading) return loading;
  const gen = generation;
  loading = (async () => {
    let next = EMPTY_PROGRESS;
    try {
      const s = await storage();
      next = parseTutorialProgress(await s.getItem(TUTORIAL_PROGRESS_KEY));
    } catch (err) {
      console.warn('[tutorial] progress read failed', err);
    }
    if (gen !== generation) return cache;
    cache = next;
    loaded = true;
    loading = null;
    publish();
    return cache;
  })();
  return loading;
}

export function getTutorialProgress(): TutorialProgress {
  return cache;
}

/** Apply a pure transition and persist it. Writes are serialized so two
 *  quick transitions (checkpoint, then finale) land in order. */
export function updateTutorialProgress(fn: (p: TutorialProgress) => TutorialProgress): Promise<void> {
  const gen = generation;
  const run = async () => {
    await loadTutorialProgress();
    if (gen !== generation) return;
    const next = fn(cache);
    if (next === cache) return;
    cache = next;
    publish();
    try {
      const s = await storage();
      await s.setItem(TUTORIAL_PROGRESS_KEY, JSON.stringify(next));
    } catch (err) {
      console.warn('[tutorial] progress write failed', err);
    }
  };
  writeChain = writeChain.then(run, run);
  return writeChain;
}

/** The user changed (sign-out, account switch): forget the in-memory copy.
 *  The wipe sweep removes the stored key; this drops what we held of it. */
export function resetTutorialProgressCache(): void {
  generation += 1;
  cache = EMPTY_PROGRESS;
  loaded = false;
  loading = null;
  publish();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

const getSnapshot = () => snapshot;

/** The hub, the chip and the checklist read progress through this. Kicks off
 *  the first load. */
export function useTutorialProgress(): ProgressSnapshot {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const needsLoad = !s.loaded;
  useEffect(() => {
    if (needsLoad) void loadTutorialProgress();
  }, [needsLoad]);
  return s;
}

/** Chip bookkeeping (components/tutorial/TutorialOfferChip). */
export function markTutorialChipShown(id: TutorialId, today: string): Promise<void> {
  return updateTutorialProgress(p => withChipShown(p, id, new Date().toISOString(), today));
}

export function dismissTutorialChip(id: TutorialId): Promise<void> {
  return updateTutorialProgress(p => withChipDismissed(p, id, new Date().toISOString()));
}
