// utils/alert.ts — cross-platform alerts.
//
// WHY THIS EXISTS: react-native-web ships `class Alert { static alert() {} }` —
// a literal no-op. Every Alert.alert in the app (600+ call sites) therefore
// did NOTHING on the web build: confirmations never appeared, destructive
// actions silently proceeded or silently didn't, validation errors were
// invisible, and success messages never showed. Alert.prompt is worse — it's
// iOS-only, so it no-ops on Android AND web.
//
// Behaviour:
//   • native (ios/android) → delegates to the real RN Alert, unchanged. Native
//     UX is already correct and we don't want to regress it.
//   • web → dispatches to <AlertHost/> (mounted once in app/_layout), which
//     renders a real themed modal supporting 1–3 buttons and prompt input.
//
// Usage is a drop-in rename:  Alert.alert(...) → showAlert(...)
//                             Alert.prompt(...) → showPrompt(...)

import { Alert, Platform } from 'react-native';
import { normalizeButtons } from './alertCore';

// Pure logic lives in alertCore (RN-free) so it can be unit-tested under Bun.
export { normalizeButtons, cancelButtonIndex } from './alertCore';
export type { AlertButton, AlertButtonStyle } from './alertCore';
import type { AlertButton } from './alertCore';

export interface AlertRequest {
  id: number;
  title: string;
  message?: string;
  buttons: AlertButton[];
  /** When set, the host renders a text field and passes its value to onPress. */
  prompt?: { defaultValue?: string; placeholder?: string; secure?: boolean };
}

type Listener = (req: AlertRequest) => void;

let listener: Listener | null = null;
let seq = 0;
/** Requests raised before the host mounted (e.g. an error during first paint). */
const pending: AlertRequest[] = [];

/** Called by <AlertHost/>. Flushes anything queued before mount. */
export function registerAlertHost(fn: Listener | null): void {
  listener = fn;
  if (!fn) return;
  while (pending.length > 0) {
    const next = pending.shift();
    if (next) fn(next);
  }
}

function dispatch(req: AlertRequest): void {
  if (listener) listener(req);
  else pending.push(req); // host not mounted yet — replay on register
}

/** Drop-in replacement for Alert.alert that actually works on web. */
export function showAlert(
  title: string,
  message?: string,
  buttons?: AlertButton[],
  // onDismiss is forwarded to the native Alert (Android back-button / outside
  // tap fire it and NO button onPress). Callers that resolve a Promise from
  // button callbacks depend on it, or the Promise never settles. On web
  // AlertHost routes a backdrop tap through the CANCEL button's onPress, so the
  // same callers are covered there without needing this.
  options?: { cancelable?: boolean; onDismiss?: () => void },
): void {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons as Parameters<typeof Alert.alert>[2], options);
    return;
  }
  seq += 1;
  dispatch({ id: seq, title, message, buttons: normalizeButtons(buttons) });
}

/**
 * Drop-in replacement for Alert.prompt. Native Alert.prompt is iOS-ONLY, so on
 * Android this previously no-opped too — here Android and web both get the
 * modal with a text field.
 */
export function showPrompt(
  title: string,
  message?: string,
  callbackOrButtons?: ((value: string) => void) | AlertButton[],
  _type?: string,
  defaultValue?: string,
): void {
  if (Platform.OS === 'ios') {
    Alert.prompt(
      title,
      message,
      callbackOrButtons as Parameters<typeof Alert.prompt>[2],
      _type as Parameters<typeof Alert.prompt>[3],
      defaultValue,
    );
    return;
  }
  const buttons: AlertButton[] = typeof callbackOrButtons === 'function'
    ? [
        { text: 'Cancel', style: 'cancel' },
        { text: 'OK', style: 'default', onPress: (v?: string) => (callbackOrButtons as (value: string) => void)(v ?? '') },
      ]
    : normalizeButtons(callbackOrButtons);
  seq += 1;
  dispatch({ id: seq, title, message, buttons, prompt: { defaultValue } });
}
