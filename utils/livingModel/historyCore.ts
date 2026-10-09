// utils/livingModel/historyCore.ts — undo and redo for the Room Editor (pure).
//
// A plain three-part history: what came before, what is on screen, what was
// undone. A new change clears what was undone. Capped so a long session cannot
// grow without end.

export const MAX_HISTORY = 100;

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export function historyOf<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/** Record a change. The same object handed back (an edit that was refused) records nothing. */
export function historyPush<T>(h: History<T>, next: T): History<T> {
  if (next === h.present) return h;
  const past = [...h.past, h.present];
  return { past: past.length > MAX_HISTORY ? past.slice(past.length - MAX_HISTORY) : past, present: next, future: [] };
}

export const canUndo = <T>(h: History<T>): boolean => h.past.length > 0;
export const canRedo = <T>(h: History<T>): boolean => h.future.length > 0;

export function historyUndo<T>(h: History<T>): History<T> {
  if (!canUndo(h)) return h;
  const past = h.past.slice(0, -1);
  return { past, present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function historyRedo<T>(h: History<T>): History<T> {
  if (!canRedo(h)) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}
