// useDocumentTitle — set document.title on web per route.
//
// Audit-2026-05-21 W1 (HIGH): pre-fix every browser tab showed "MAGE ID"
// because Expo Router's Stack.Screen `title` prop sets the in-app header
// title only — React Navigation does NOT bridge that to document.title
// on web. Result: every bookmark, every browser tab, every share-as-link
// preview reads identically. Tabs are indistinguishable.
//
// Usage in a screen:
//   useDocumentTitle('Invoice');
//   // → "Invoice · MAGE ID" on web
//   // → no-op on native
//
// The hook also restores the prior title on unmount so navigating back
// from a deep route resets the title cleanly without a lingering child
// page title in the parent tab.
//
// Native (iOS / Android) ignores this entirely — document is undefined.

import { useEffect } from 'react';
import { Platform } from 'react-native';

const SITE_NAME = 'MAGE ID';

export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof document === 'undefined') return;
    const prev = document.title;
    if (title && title.trim().length > 0) {
      // "Invoice · MAGE ID" — site name suffix matches the dot-separator
      // convention used by Linear, Vercel, Notion, Stripe Dashboard.
      document.title = `${title.trim()} · ${SITE_NAME}`;
    } else {
      document.title = SITE_NAME;
    }
    return () => {
      // Restore prior title so the parent route reverts when this screen
      // unmounts (deep-linking back, modal dismiss, etc.).
      document.title = prev;
    };
  }, [title]);
}

export default useDocumentTitle;
