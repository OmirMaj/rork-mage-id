// utils/codeCard/saved.ts — "Save to job": code cards kept with a job's codes
// and permits.
//
// Device-local in v1 under `mageid_code_saved_v1` (prefix-swept on sign-out;
// bun run test:storage-hygiene). Pure reducers + a thin store; AsyncStorage is
// required lazily by ./store.ts so bun can drive all of it.
//
// A saved card keeps the number he re-measured, if he changed it, so reopening
// it shows the same re-check he saw.

import { safeJson, createPersistedStore, type KVStorage, type PersistedStore } from './store';
import { parseCodeCardItem, parseJobValue } from './parse';
import type { CodeCardItem, CodeJobValue } from './types';

export const CODE_SAVED_KEY = 'mageid_code_saved_v1';
export const MAX_SAVED_PER_PROJECT = 200;

export interface SavedCodeCard {
  id: string;
  projectId: string;
  item: CodeCardItem;
  /** The re-measured number, when it differs from the item's own. */
  jobValue?: CodeJobValue;
  savedAt: string;
}

export type SavedState = Readonly<Record<string, readonly SavedCodeCard[]>>;

export type SavedAction =
  | { type: 'save'; card: SavedCodeCard }
  | { type: 'unsave'; projectId: string; itemId: string }
  | { type: 'clearProject'; projectId: string };

export const EMPTY_SAVED: SavedState = Object.freeze({});

export function savedIdFor(projectId: string, itemId: string): string {
  return `${projectId}:${itemId}`;
}

export function makeSaved(projectId: string, item: CodeCardItem, now: Date | string, jobValue?: CodeJobValue | null): SavedCodeCard {
  const out: SavedCodeCard = {
    id: savedIdFor(projectId, item.id),
    projectId,
    item,
    savedAt: typeof now === 'string' ? now : now.toISOString(),
  };
  if (jobValue && (!item.jobValue || jobValue.value !== item.jobValue.value || jobValue.unit !== item.jobValue.unit)) {
    out.jobValue = jobValue;
  }
  return out;
}

export function savedReducer(state: SavedState, action: SavedAction): SavedState {
  switch (action.type) {
    case 'save': {
      const { card } = action;
      if (!card.projectId || !card.item?.id) return state;
      const list = state[card.projectId] ?? [];
      const next = [...list.filter((c) => c.item.id !== card.item.id), card].slice(-MAX_SAVED_PER_PROJECT);
      return { ...state, [card.projectId]: next };
    }
    case 'unsave': {
      const list = state[action.projectId];
      if (!list || !list.some((c) => c.item.id === action.itemId)) return state;
      const next = list.filter((c) => c.item.id !== action.itemId);
      const out: Record<string, readonly SavedCodeCard[]> = { ...state };
      if (next.length) out[action.projectId] = next;
      else delete out[action.projectId];
      return out;
    }
    case 'clearProject': {
      if (!state[action.projectId]) return state;
      const out: Record<string, readonly SavedCodeCard[]> = { ...state };
      delete out[action.projectId];
      return out;
    }
    default:
      return state;
  }
}

export function parseSavedState(raw: string | null): SavedState {
  const data = safeJson(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return EMPTY_SAVED;
  const out: Record<string, SavedCodeCard[]> = {};
  for (const [projectId, list] of Object.entries(data as Record<string, unknown>)) {
    if (!projectId || !Array.isArray(list)) continue;
    const cards: SavedCodeCard[] = [];
    for (const c of list) {
      if (!c || typeof c !== 'object') continue;
      const r = c as Record<string, unknown>;
      const item = parseCodeCardItem(r.item);
      if (!item || typeof r.savedAt !== 'string' || r.projectId !== projectId) continue;
      const card: SavedCodeCard = { id: savedIdFor(projectId, item.id), projectId, item, savedAt: r.savedAt };
      const jv = parseJobValue(r.jobValue);
      if (jv) card.jobValue = jv;
      cards.push(card);
    }
    if (cards.length) out[projectId] = cards.slice(-MAX_SAVED_PER_PROJECT);
  }
  return out;
}

export function savedFor(state: SavedState, projectId: string | null | undefined): readonly SavedCodeCard[] {
  return projectId ? state[projectId] ?? [] : [];
}

export function isSaved(state: SavedState, projectId: string | null | undefined, itemId: string): boolean {
  return savedFor(state, projectId).some((c) => c.item.id === itemId);
}

export type SavedStore = PersistedStore<SavedState, SavedAction>;

export function createSavedStore(storage?: KVStorage | null): SavedStore {
  return createPersistedStore<SavedState, SavedAction>({
    key: CODE_SAVED_KEY,
    initial: EMPTY_SAVED,
    reducer: savedReducer,
    parse: parseSavedState,
    storage,
  });
}

let shared: SavedStore | null = null;

/** The app's one saved-cards store (created on first use). */
export function codeSavedStore(): SavedStore {
  if (!shared) shared = createSavedStore();
  return shared;
}
