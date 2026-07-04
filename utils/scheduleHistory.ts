/** Pure, RN-free undo/redo reducer over an immutable present + past/future
 *  stacks. Used by app/schedule-pro.tsx so every mutation is undoable and the
 *  logic is unit-testable under bun (no react-native imports). */
export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

export function emptyHistory<T>(present: T): HistoryState<T> {
  return { past: [], present, future: [] };
}

/** Record a new present. Pushes the old present onto `past` (bounded to `cap`),
 *  clears `future` (a new edit invalidates redo). */
export function pushHistory<T>(s: HistoryState<T>, next: T, cap = 20): HistoryState<T> {
  const past = [...s.past, s.present];
  const trimmed = past.length > cap ? past.slice(past.length - cap) : past;
  return { past: trimmed, present: next, future: [] };
}

export function canUndo<T>(s: HistoryState<T>): boolean { return s.past.length > 0; }
export function canRedo<T>(s: HistoryState<T>): boolean { return s.future.length > 0; }

export function undo<T>(s: HistoryState<T>): HistoryState<T> {
  if (s.past.length === 0) return s;
  const present = s.past[s.past.length - 1];
  return { past: s.past.slice(0, -1), present, future: [s.present, ...s.future] };
}

export function redo<T>(s: HistoryState<T>): HistoryState<T> {
  if (s.future.length === 0) return s;
  const present = s.future[0];
  return { past: [...s.past, s.present], present, future: s.future.slice(1) };
}
