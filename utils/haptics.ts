// haptics.ts — the ONE haptics module.
//
// WHY. The motion audit found two things: every Button press ticked
// selectionAsync (a buzz on every tap reads as noise, not feedback), and a
// Send followed by its toast buzzed Success TWICE — the Button's commit morph
// and the NailItToast host each fired their own notification a few frames
// apart. Routing both through here fixes the second: a 400 ms de-dupe window
// PER NOTIFICATION TYPE, so the button and the toast can both "fire" success
// and the phone buzzes once.
//
//   haptic.tap()      impact Light
//   haptic.select()   selection tick
//   haptic.success()  notification Success  ┐
//   haptic.warning()  notification Warning  ├ de-duped per type (400 ms)
//   haptic.error()    notification Error    ┘
//
// Every call swallows failures (a device without a Taptic Engine, a
// simulator, jest) and is a no-op on the web. Platform is read at CALL time.

import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/** Two notifications of the same type closer than this buzz once. */
export const HAPTIC_DEDUPE_MS = 400;

type NoteKind = 'success' | 'warning' | 'error';

const NEVER = Number.NEGATIVE_INFINITY;
const lastFired: Record<NoteKind, number> = { success: NEVER, warning: NEVER, error: NEVER };

function swallow(p: unknown): void {
  const maybe = p as { catch?: (fn: () => void) => unknown } | undefined;
  if (maybe && typeof maybe.catch === 'function') maybe.catch(() => {});
}

function run(fn: () => unknown): void {
  if (Platform.OS === 'web') return;
  try { swallow(fn()); } catch { /* a missing native module must never throw into a press */ }
}

const NOTE_TYPE: Record<NoteKind, () => Haptics.NotificationFeedbackType> = {
  success: () => Haptics.NotificationFeedbackType.Success,
  warning: () => Haptics.NotificationFeedbackType.Warning,
  error: () => Haptics.NotificationFeedbackType.Error,
};

/** Fires the notification unless one of the same type fired inside the window. Returns whether it fired. */
function note(kind: NoteKind): boolean {
  if (Platform.OS === 'web') return false;
  const now = Date.now();
  if (now - lastFired[kind] <= HAPTIC_DEDUPE_MS) return false;
  lastFired[kind] = now;
  run(() => Haptics.notificationAsync(NOTE_TYPE[kind]()));
  return true;
}

export const haptic = {
  tap(): void { run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)); },
  select(): void { run(() => Haptics.selectionAsync()); },
  success(): boolean { return note('success'); },
  warning(): boolean { return note('warning'); },
  error(): boolean { return note('error'); },
};

/** Tests only: forget every de-dupe timestamp. */
export function __resetHapticsForTests(): void {
  lastFired.success = NEVER;
  lastFired.warning = NEVER;
  lastFired.error = NEVER;
}

export default haptic;
