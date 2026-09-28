// focusModality.ts: a :focus-visible equivalent for react-native-web (moments wave).
//
// WHY. RN-web renders the capsule head as a native <button>. Chrome and Edge
// focus a button on a MOUSE press, so a plain onFocus would ring the head under
// the thumb and keep the ring through the drag, the busy ring and the result.
// The approved preview (morph.html .head:focus-visible) rings it for keyboard
// focus only, and the app's web CSS follows the same rule.
//
// THE RULE (the WICG focus-visible polyfill's): the last input decides. A
// keydown without Cmd/Ctrl/Alt means the keyboard is driving; a pointer, mouse
// or touch press means it is not. Both listeners sit on the document in the
// capture phase, so they run before the press moves focus. A focus counts as
// keyboard focus only when the keyboard drove last, and a change of driver
// while something is focused is published so the ring can follow (a mouse
// press on a keyboard-focused head drops the ring; a key on a mouse-focused
// head shows it), as :focus-visible does.
//
// Web only. With no document (iOS, Android, the native jest preset) install is
// a no-op and the modality stays 'pointer', so nothing ever rings.

import { Platform } from 'react-native';

export type InputModality = 'keyboard' | 'pointer';
type Listener = (m: InputModality) => void;

let modality: InputModality = 'pointer';
let installed = false;
const listeners = new Set<Listener>();

function set(next: InputModality): void {
  if (modality === next) return;
  modality = next;
  listeners.forEach((fn) => {
    try { fn(next); } catch { /* a listener never breaks input */ }
  });
}

function onKeyDown(e: KeyboardEvent): void {
  // Cmd+Tab, Ctrl+C and the like are not the keyboard driving the page.
  if (e.metaKey || e.altKey || e.ctrlKey) return;
  set('keyboard');
}

function onPointer(): void {
  set('pointer');
}

/** Start tracking (idempotent). Web only; a no-op without a document. */
export function installFocusModality(): void {
  if (installed || Platform.OS !== 'web') return;
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  installed = true;
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('pointerdown', onPointer, true);
  document.addEventListener('mousedown', onPointer, true);
  document.addEventListener('touchstart', onPointer, { capture: true, passive: true });
}

/** Who drove last: 'keyboard' means a focus now is keyboard focus. */
export function inputModality(): InputModality {
  return modality;
}

/** Hear every change of driver. Returns the unsubscribe. */
export function subscribeInputModality(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
