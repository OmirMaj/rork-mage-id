// utils/codeCard/pins.ts — "Add to checklist": code cards pinned to a job's
// inspection, which Inspection Ready merges in as "Pinned from code cards".
//
// Device-local in v1 under `mageid_code_pins_v1` (prefix-swept on sign-out;
// bun run test:storage-hygiene). Pure reducers + a thin store; AsyncStorage is
// required lazily by ./store.ts so bun can drive all of it.
//
// The stage a card is pinned to starts as the AI's guess (`item.stage`, else
// 'other') and the contractor can move it; a moved pin stops being a guess.

import { safeJson, createPersistedStore, type KVStorage, type PersistedStore } from './store';
import { parseCodeCardItem } from './parse';
import type { CodeCardItem, CodePin, CodeStage } from './types';
import { CODE_STAGES, isCodeStage } from './verdict';

export const CODE_PINS_KEY = 'mageid_code_pins_v1';
/** Per job. A checklist longer than this is not a checklist. */
export const MAX_PINS_PER_PROJECT = 200;

/** projectId → pins, newest last. */
export type PinsState = Readonly<Record<string, readonly CodePin[]>>;

export type PinAction =
  | { type: 'pin'; pin: CodePin }
  | { type: 'unpin'; projectId: string; itemId: string }
  | { type: 'setStage'; projectId: string; itemId: string; stage: CodeStage }
  | { type: 'clearProject'; projectId: string };

export const EMPTY_PINS: PinsState = Object.freeze({});

export function pinIdFor(projectId: string, itemId: string): string {
  return `${projectId}:${itemId}`;
}

/** Build a pin. `stage` overrides the item's guess; no stage at all files it under 'other'. */
export function makePin(projectId: string, item: CodeCardItem, now: Date | string, stage?: CodeStage): CodePin {
  const chosen = stage ?? item.stage ?? 'other';
  const moved = !!stage && stage !== item.stage;
  return {
    id: pinIdFor(projectId, item.id),
    projectId,
    stage: chosen,
    item: moved ? { ...item, stage: chosen, stageIsGuess: false } : item,
    pinnedAt: typeof now === 'string' ? now : now.toISOString(),
  };
}

export function pinsReducer(state: PinsState, action: PinAction): PinsState {
  switch (action.type) {
    case 'pin': {
      const { pin } = action;
      if (!pin.projectId || !pin.item?.id) return state;
      const list = state[pin.projectId] ?? [];
      const without = list.filter((p) => p.item.id !== pin.item.id);
      const next = [...without, pin].slice(-MAX_PINS_PER_PROJECT);
      return { ...state, [pin.projectId]: next };
    }
    case 'unpin': {
      const list = state[action.projectId];
      if (!list || !list.some((p) => p.item.id === action.itemId)) return state;
      const next = list.filter((p) => p.item.id !== action.itemId);
      const out: Record<string, readonly CodePin[]> = { ...state };
      if (next.length) out[action.projectId] = next;
      else delete out[action.projectId];
      return out;
    }
    case 'setStage': {
      const list = state[action.projectId];
      if (!list) return state;
      let changed = false;
      const next = list.map((p) => {
        if (p.item.id !== action.itemId || p.stage === action.stage) return p;
        changed = true;
        return { ...p, stage: action.stage, item: { ...p.item, stage: action.stage, stageIsGuess: false } };
      });
      return changed ? { ...state, [action.projectId]: next } : state;
    }
    case 'clearProject': {
      if (!state[action.projectId]) return state;
      const out: Record<string, readonly CodePin[]> = { ...state };
      delete out[action.projectId];
      return out;
    }
    default:
      return state;
  }
}

/** Read the stored JSON back; malformed pins are dropped, never shown. */
export function parsePinsState(raw: string | null): PinsState {
  const data = safeJson(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return EMPTY_PINS;
  const out: Record<string, CodePin[]> = {};
  for (const [projectId, list] of Object.entries(data as Record<string, unknown>)) {
    if (!projectId || !Array.isArray(list)) continue;
    const pins: CodePin[] = [];
    for (const p of list) {
      if (!p || typeof p !== 'object') continue;
      const r = p as Record<string, unknown>;
      const item = parseCodeCardItem(r.item);
      if (!item || !isCodeStage(r.stage) || typeof r.pinnedAt !== 'string') continue;
      if (r.projectId !== projectId) continue;
      pins.push({ id: pinIdFor(projectId, item.id), projectId, stage: r.stage, item, pinnedAt: r.pinnedAt });
    }
    if (pins.length) out[projectId] = pins.slice(-MAX_PINS_PER_PROJECT);
  }
  return out;
}

export function pinsFor(state: PinsState, projectId: string | null | undefined): readonly CodePin[] {
  return projectId ? state[projectId] ?? [] : [];
}

export function isPinned(state: PinsState, projectId: string | null | undefined, itemId: string): boolean {
  return pinsFor(state, projectId).some((p) => p.item.id === itemId);
}

export function pinnedStage(state: PinsState, projectId: string | null | undefined, itemId: string): CodeStage | null {
  return pinsFor(state, projectId).find((p) => p.item.id === itemId)?.stage ?? null;
}

/** One job's pins grouped by inspection, in inspection order, empty stages left out. */
export function pinsByStage(state: PinsState, projectId: string | null | undefined): { stage: CodeStage; pins: CodePin[] }[] {
  const list = pinsFor(state, projectId);
  return CODE_STAGES
    .map((stage) => ({ stage, pins: list.filter((p) => p.stage === stage) }))
    .filter((g) => g.pins.length > 0);
}

export type PinStore = PersistedStore<PinsState, PinAction>;

export function createPinStore(storage?: KVStorage | null): PinStore {
  return createPersistedStore<PinsState, PinAction>({
    key: CODE_PINS_KEY,
    initial: EMPTY_PINS,
    reducer: pinsReducer,
    parse: parsePinsState,
    storage,
  });
}

let shared: PinStore | null = null;

/** The app's one pin store (created on first use). */
export function codePinStore(): PinStore {
  if (!shared) shared = createPinStore();
  return shared;
}
