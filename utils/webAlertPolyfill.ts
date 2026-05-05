// Web polyfill for react-native's Alert.alert.
//
// Background: react-native-web's Alert.alert is essentially a no-op for the
// multi-button form most of our code uses. A single-button alert maps to
// window.alert, but anything with Cancel/OK or destructive options silently
// does nothing — the user clicks Sign Out, Delete, etc. and nothing happens.
//
// We have ~400 Alert.alert call sites. Patching them individually would be
// a months-long crawl, so instead we monkey-patch Alert.alert ONCE at boot
// and route through window.confirm. This preserves every existing call site:
//
//   Alert.alert('Sign Out', 'Are you sure?', [
//     { text: 'Cancel', style: 'cancel' },
//     { text: 'Sign Out', style: 'destructive', onPress: () => doIt() },
//   ]);
//
// On web, window.confirm shows the title + message and returns true/false.
// We map true → fire the first non-cancel button's onPress; false → fire
// the cancel button's onPress (if any).
//
// Three-button alerts (Cancel / Skip / Save) collapse to two on web — we
// can't distinguish multiple "OK" branches with window.confirm. The vast
// majority of our calls are two-button (cancel + action), so this is fine.
// For the rare three-button case, the destructive/default button wins.

import { Alert, Platform } from 'react-native';
import type { AlertButton, AlertOptions } from 'react-native';

let patched = false;

export function patchAlertForWeb(): void {
  if (Platform.OS !== 'web') return;
  if (patched) return;
  patched = true;

  Alert.alert = (
    title: string,
    message?: string,
    buttons?: AlertButton[],
    _options?: AlertOptions,
  ): void => {
    // No buttons → informational alert. Use window.alert.
    if (!buttons || buttons.length === 0) {
      const text = message ? `${title}\n\n${message}` : title;
      if (typeof window !== 'undefined' && window.alert) window.alert(text);
      return;
    }

    // Single button → fire its onPress, no confirm needed.
    if (buttons.length === 1) {
      const text = message ? `${title}\n\n${message}` : title;
      if (typeof window !== 'undefined' && window.alert) window.alert(text);
      buttons[0]?.onPress?.();
      return;
    }

    // 2+ buttons → window.confirm. Resolve OK to the first non-cancel
    // button (preferring destructive > default), Cancel to the cancel button.
    const cancelBtn = buttons.find(b => b.style === 'cancel') ?? buttons[0];
    const actionBtn =
      buttons.find(b => b.style === 'destructive') ??
      buttons.find(b => b.style === 'default') ??
      buttons.find(b => b !== cancelBtn) ??
      buttons[buttons.length - 1];

    const text = message ? `${title}\n\n${message}` : title;
    const confirmed = typeof window !== 'undefined' && window.confirm
      ? window.confirm(text)
      : true;

    if (confirmed) {
      actionBtn?.onPress?.();
    } else {
      cancelBtn?.onPress?.();
    }
  };

  // Alert.prompt is iOS-only on native; we leave it alone on web for now.
  // The codebase doesn't use Alert.prompt for any critical flow, and the
  // RN type narrows onPress to a credential shape that fights window.prompt.
}
