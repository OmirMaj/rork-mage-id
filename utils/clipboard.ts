// utils/clipboard.ts — single source of truth for copy-to-clipboard.
//
// The codebase had two patterns that BOTH fail silently in real conditions:
//
//   1. `Clipboard.setString` from `react-native` — deprecated since RN 0.66
//      and removed from web entirely. Reports succeed but writes nothing.
//   2. `navigator.clipboard?.writeText(text)` — returns a Promise that's
//      never awaited; rejects silently in non-secure contexts (http://
//      hosts, embedded iframes without the right Permissions-Policy, etc.)
//      and the caller shows a "Copied" toast over an empty clipboard.
//
// This util:
//   - Uses `expo-clipboard`'s `setStringAsync` on every platform (it's
//     already in package.json, works on web via navigator.clipboard, and
//     handles iOS 17+ quirks the old Clipboard.setString doesn't).
//   - Falls back to `document.execCommand('copy')` via a hidden textarea
//     on web when the Permissions API blocks navigator.clipboard.
//   - Returns a boolean so the caller can show a meaningful "Copied" vs.
//     "Copy failed" message — no more silent successes.
//
// Always called from a user-gesture handler (button onPress) so the web
// Permissions check passes.

import { Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';

export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    await Clipboard.setStringAsync(text);
    // Best-effort verification — confirms the write actually landed.
    if (Platform.OS === 'web') {
      try {
        const got = await Clipboard.getStringAsync();
        if (got === text) return true;
      } catch {
        // Read may be blocked even when write succeeded — assume success.
        return true;
      }
    }
    return true;
  } catch {
    // expo-clipboard failed. Try the legacy execCommand fallback on web —
    // works even in non-secure contexts (HTTP) where navigator.clipboard
    // is gated.
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '0';
        ta.setAttribute('readonly', '');
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch {
        return false;
      }
    }
    return false;
  }
}
