// utils/codeCard/sunlight.ts — the Sunlight preference for code cards: white
// ground, black ink, heavier rules and one type size up, for reading a card on
// a ladder in direct sun.
//
// A module store (the pattern of utils/sidebarRailStore.ts), read with
// useSyncExternalStore in components/codeCard/palette.ts. Scoped to code cards
// on purpose: it never touches the global theme. Kept on the device under
// `mageid_code_sunlight_v1` (prefix-swept on sign-out like every mageid_ key).
// AsyncStorage is required lazily by ./store.ts, so bun can import this file.

import { defaultStorage, type KVStorage } from './store';

export const CODE_SUNLIGHT_KEY = 'mageid_code_sunlight_v1';

let on = false;
let loadStarted = false;
let touched = false;
let storageOverride: KVStorage | null | undefined;
const listeners = new Set<() => void>();

function storage(): KVStorage | null {
  return storageOverride === undefined ? defaultStorage() : storageOverride;
}

function emit(): void {
  for (const fn of listeners) fn();
}

function loadOnce(): void {
  if (loadStarted) return;
  loadStarted = true;
  const s = storage();
  if (!s) return;
  s.getItem(CODE_SUNLIGHT_KEY)
    .then((raw) => {
      if (touched) return;
      const next = raw === '1';
      if (next !== on) { on = next; emit(); }
    })
    .catch(() => { /* off stands */ });
}

export function getSunlight(): boolean {
  return on;
}

export function subscribeSunlight(cb: () => void): () => void {
  listeners.add(cb);
  loadOnce();
  return () => { listeners.delete(cb); };
}

export function setSunlight(next: boolean): void {
  touched = true;
  if (next === on) return;
  on = next;
  emit();
  storage()?.setItem(CODE_SUNLIGHT_KEY, next ? '1' : '0').catch(() => { /* the screen state stands */ });
}

export function toggleSunlight(): void {
  setSunlight(!on);
}

/**
 * Tenant wipe (see ./reset.ts): the preference is stored under a swept key, so
 * the next user must not inherit it from module memory either. Sunlight goes
 * off for everyone listening, and a read still in flight is ignored.
 */
export function resetSunlight(): void {
  touched = true;
  loadStarted = true;
  if (!on) return;
  on = false;
  emit();
}

/** Tests only: reset the module and point it at a storage double (null = none). */
export function __resetSunlightForTest(s: KVStorage | null = null): void {
  on = false;
  loadStarted = false;
  touched = false;
  storageOverride = s;
  listeners.clear();
}
