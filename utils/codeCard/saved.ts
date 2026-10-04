// utils/codeCard/saved.ts — "Save to job": code cards kept with a job's codes
// and permits.
//
// Device-local in v1 under `mageid_code_saved_v1` (prefix-swept on sign-out;
// bun run test:storage-hygiene). Pure reducers + a thin store; AsyncStorage is
// required lazily by ./store.ts so bun can drive all of it.
//
// A saved card keeps the number he re-measured, if he changed it, so reopening
// it shows the same re-check he saw: pass `jobValue={saved.jobValue}` to
// CodeCardSheet (or CodeCard) and the card opens on that number.
//
// A RE-MEASURE NEEDS THE CARD'S OWN NUMBER. A saved re-measure is kept only
// for a card that carries its own job number and a trigger in the same unit
// (`keepsRemeasure`): it is the number he stepped to FROM that number. A card
// with no number of its own is saved with none, so a saved card can never be
// re-checked against a number that was not on it.
//
// WHAT THE STORE ACCEPTS IS WHAT IT READS BACK. `storedSaved` is the one gate:
// the reducer runs every card through it on the way in and parseSavedState on
// the way out (the same rule as pins.ts storedPin), so a card that showed
// "Saved" is still there after a restart and a card it refuses is never saved.

import { safeJson, createPersistedStore, type KVStorage, type PersistedStore } from './store';
import { parseJobValue, storedCodeCardItem, STORED_TEXT_MAX } from './parse';
import type { CodeCardItem, CodeJobValue } from './types';
import { canRecheck } from './verdict';

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

/** May a saved copy of `item` carry `jobValue` as its re-measure? See the header. */
export function keepsRemeasure(item: Pick<CodeCardItem, 'jobValue' | 'trigger'>, jobValue: CodeJobValue | null | undefined): jobValue is CodeJobValue {
  return !!jobValue && !!item.jobValue && canRecheck(item) && jobValue.unit === item.jobValue.unit;
}

export function makeSaved(projectId: string, item: CodeCardItem, now: Date | string, jobValue?: CodeJobValue | null): SavedCodeCard {
  const out: SavedCodeCard = {
    id: savedIdFor(projectId, item.id),
    projectId,
    item,
    savedAt: typeof now === 'string' ? now : now.toISOString(),
  };
  if (keepsRemeasure(item, jobValue) && jobValue.value !== item.jobValue?.value) {
    out.jobValue = jobValue;
  }
  return out;
}

/**
 * One saved card in the form the store keeps, or null when it cannot be kept.
 * Used by the reducer (accept) AND by parseSavedState (read back).
 */
export function storedSaved(raw: unknown, projectId: string): SavedCodeCard | null {
  if (!projectId || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.projectId !== projectId || typeof r.savedAt !== 'string') return null;
  // Device-local: evidence and stage edits were attached on this device.
  const item = storedCodeCardItem(r.item);
  if (!item) return null;
  const card: SavedCodeCard = { id: savedIdFor(projectId, item.id), projectId, item, savedAt: r.savedAt };
  const jv = parseJobValue(r.jobValue, STORED_TEXT_MAX);
  if (keepsRemeasure(item, jv)) card.jobValue = jv;
  return card;
}

export function savedReducer(state: SavedState, action: SavedAction): SavedState {
  switch (action.type) {
    case 'save': {
      // The same gate the reader uses. A card it refuses is not saved.
      const card = storedSaved(action.card, typeof action.card?.projectId === 'string' ? action.card.projectId : '');
      if (!card) return state;
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

/** Read the stored JSON back through the SAME gate the reducer accepted it with (storedSaved). */
export function parseSavedState(raw: string | null): SavedState {
  const data = safeJson(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return EMPTY_SAVED;
  const out: Record<string, SavedCodeCard[]> = {};
  for (const [projectId, list] of Object.entries(data as Record<string, unknown>)) {
    if (!projectId || !Array.isArray(list)) continue;
    const cards: SavedCodeCard[] = [];
    for (const c of list) {
      const card = storedSaved(c, projectId);
      if (card) cards.push(card);
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

/** Tenant wipe: empty the shared store's memory (see ./reset.ts). No store yet = nothing held. */
export function resetCodeSavedStore(): void {
  shared?.reset();
}

/** Tests only: point the shared store at a storage double (null = a fresh default one on next use). */
export function __setCodeSavedStoreForTest(store: SavedStore | null): void {
  shared = store;
}
