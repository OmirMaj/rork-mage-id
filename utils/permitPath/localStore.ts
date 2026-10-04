// utils/permitPath/localStore.ts — Permit Path's on-device state (lane PPUI, M2).
//
// The GC's interview answers and readiness marks live on THIS device only
// (founder default F2, "Saved on this device."), under one AsyncStorage key:
//
//   mageid_permit_path → { [projectId]: { answers, marks, updatedAt } }
//
// The mageid_ prefix is in APP_STORAGE_PREFIXES (utils/localCacheKeys.ts), so
// the sign-out sweep clears it with every other tenant key.
//
// PURE except loadPermitPathStore / savePermitPathStore at the bottom. The
// reducer is the ONLY way state changes, and it has no action that writes a
// pre-fill: a suggestion (PLUTO's landmark, the building year, the office)
// becomes an answer only through `confirmPrefill`, which the hook dispatches
// from the Confirm tap and nowhere else (validate-permit-path-ui pins both).
//
// A corrupt, foreign or older-shaped blob parses to EMPTY. It never throws and
// never half-reads a project: a project entry without both an `answers` and a
// `marks` object is dropped whole.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { InterviewAnswer, InterviewAnswers, ReadinessMark, ReadinessMarks } from '@/utils/permitPath/types';

export const PERMIT_PATH_KEY = 'mageid_permit_path';

export interface ProjectPermitPathState {
  answers: InterviewAnswers;
  marks: ReadinessMarks;
  /** ISO time of the last change; '' for a project never touched. */
  updatedAt: string;
}

export type PermitPathStore = Readonly<Record<string, ProjectPermitPathState>>;

export const EMPTY_PROJECT_STATE: ProjectPermitPathState = Object.freeze({
  answers: Object.freeze({}) as InterviewAnswers,
  marks: Object.freeze({}) as ReadinessMarks,
  updatedAt: '',
});

const MAX_ID = 120;
const MAX_TEXT = 400;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const okId = (k: string): boolean => k.length > 0 && k.length <= MAX_ID;
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : null);

function parseAnswer(v: unknown): InterviewAnswer | null {
  if (!isObj(v)) return null;
  const raw = v.value;
  let value: InterviewAnswer['value'];
  if (typeof raw === 'string') value = raw.slice(0, MAX_TEXT);
  else if (typeof raw === 'number' && Number.isFinite(raw)) value = raw;
  else if (Array.isArray(raw) && raw.length <= 40 && raw.every((x) => typeof x === 'string')) value = (raw as string[]).map((x) => x.slice(0, MAX_TEXT));
  else return null;
  if (v.from !== 'gc' && v.from !== 'prefill_confirmed') return null;
  if (typeof v.at !== 'string') return null;
  const note = v.prefillNote == null ? null : strOrNull(v.prefillNote);
  return { value, from: v.from, prefillNote: note, at: v.at.slice(0, 40) };
}

function parseMark(v: unknown): ReadinessMark | null {
  if (!isObj(v)) return null;
  if (v.state !== 'have' && v.state !== 'missing' && v.state !== 'n_a') return null;
  if (typeof v.at !== 'string') return null;
  let evidence: ReadinessMark['evidence'] = null;
  if (v.evidence != null) {
    const e = v.evidence;
    if (!isObj(e) || (e.kind !== 'attested' && e.kind !== 'permit' && e.kind !== 'document')) return null;
    evidence = { kind: e.kind, ref: e.ref == null ? null : strOrNull(e.ref) };
  }
  return { state: v.state, evidence, at: v.at.slice(0, 40) };
}

function parseRecord<T>(v: unknown, one: (x: unknown) => T | null): Record<string, T> | null {
  if (!isObj(v)) return null;
  const out: Record<string, T> = {};
  for (const [k, x] of Object.entries(v)) {
    if (!okId(k)) continue;
    const p = one(x);
    if (p) out[k] = p;
  }
  return out;
}

/** The stored blob (a JSON string, or an already-parsed value) → the store.
 *  Anything unreadable is {}. Never throws. */
export function parsePermitPathStore(raw: unknown): PermitPathStore {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try { v = JSON.parse(raw); } catch { return {}; }
  }
  if (!isObj(v)) return {};
  const out: Record<string, ProjectPermitPathState> = {};
  for (const [projectId, entry] of Object.entries(v)) {
    if (!okId(projectId) || !isObj(entry)) continue;
    const answers = parseRecord(entry.answers, parseAnswer);
    const marks = parseRecord(entry.marks, parseMark);
    if (!answers || !marks) continue;
    out[projectId] = { answers, marks, updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt.slice(0, 40) : '' };
  }
  return out;
}

export function projectStateOf(store: PermitPathStore, projectId: string | null | undefined): ProjectPermitPathState {
  return (projectId && store[projectId]) || EMPTY_PROJECT_STATE;
}

/** A new store with `projectId`'s state replaced. Pure. */
export function withProjectState(store: PermitPathStore, projectId: string, state: ProjectPermitPathState): PermitPathStore {
  return { ...store, [projectId]: state };
}

// ─────────────────────────────────────────────────────────────────────
// The reducer: every change to one project's state goes through here.
// ─────────────────────────────────────────────────────────────────────

export type PermitPathAction =
  /** The GC picked or typed an answer. */
  | { type: 'answer'; id: string; value: InterviewAnswer['value']; at: string }
  /** The GC tapped Confirm on a pre-fill suggestion: the ONLY way a pre-fill is stored. */
  | { type: 'confirmPrefill'; id: string; value: InterviewAnswer['value']; note: string; at: string }
  | { type: 'clearAnswer'; id: string; at: string }
  /** A readiness mark; null removes it (back to "missing"). */
  | { type: 'mark'; itemId: string; mark: ReadinessMark | null; at: string };

export function reducePermitPathState(state: ProjectPermitPathState, action: PermitPathAction): ProjectPermitPathState {
  switch (action.type) {
    case 'answer': {
      if (!okId(action.id)) return state;
      const a: InterviewAnswer = { value: action.value, from: 'gc', prefillNote: null, at: action.at };
      return { ...state, answers: { ...state.answers, [action.id]: a }, updatedAt: action.at };
    }
    case 'confirmPrefill': {
      if (!okId(action.id)) return state;
      const a: InterviewAnswer = { value: action.value, from: 'prefill_confirmed', prefillNote: action.note, at: action.at };
      return { ...state, answers: { ...state.answers, [action.id]: a }, updatedAt: action.at };
    }
    case 'clearAnswer': {
      if (!(action.id in state.answers)) return state;
      const answers: Record<string, InterviewAnswer> = { ...state.answers };
      delete answers[action.id];
      return { ...state, answers, updatedAt: action.at };
    }
    case 'mark': {
      if (!okId(action.itemId)) return state;
      const marks: Record<string, ReadinessMark> = { ...state.marks };
      if (action.mark) marks[action.itemId] = action.mark;
      else if (action.itemId in marks) delete marks[action.itemId];
      else return state;
      return { ...state, marks, updatedAt: action.at };
    }
    default: {
      const never: never = action;
      return never;
    }
  }
}

/**
 * Pending suggestions for the questions shown: `prefill(q)` for every question
 * id with no stored answer. The result is DISPLAY-ONLY — it is never written;
 * the store changes only through reducePermitPathState.
 */
export function pendingPrefills<Q extends { id: string }, P>(
  questions: readonly Q[],
  answers: InterviewAnswers,
  prefill: (q: Q) => P | null,
): Record<string, P> {
  const out: Record<string, P> = {};
  for (const q of questions) {
    if (q.id in answers) continue;
    const p = prefill(q);
    if (p != null) out[q.id] = p;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// The thin I/O pair.
// ─────────────────────────────────────────────────────────────────────

export async function loadPermitPathStore(): Promise<PermitPathStore> {
  try {
    return parsePermitPathStore(await AsyncStorage.getItem(PERMIT_PATH_KEY));
  } catch {
    return {};
  }
}

export async function savePermitPathStore(store: PermitPathStore): Promise<void> {
  try {
    await AsyncStorage.setItem(PERMIT_PATH_KEY, JSON.stringify(store));
  } catch {
    // A failed write keeps the in-memory state; the next change writes again.
  }
}
