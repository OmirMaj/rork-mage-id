// hooks/useSafeBack.ts — Back that still works when there is nothing to pop.
//
// Audit UX-F18 (2026-09-03): the app has 254 unconditional `router.back()`
// calls and one `canGoBack()`. On any screen opened as the FIRST route — a
// fresh web tab at app.mageid.app/payments-setup from the Stripe email, the
// `mageid://qbo-setup` return from QuickBooks OAuth, a notification cold start
// — expo-router's back is an unhandled GO_BACK: the chevron does nothing, and
// on web the browser's own Back leaves the site. Fall through to the home tab
// instead, the way app/rfp-detail.tsx already does.

import { useCallback } from 'react';
import { useRouter } from 'expo-router';

export function useSafeBack(): () => void {
  const router = useRouter();
  return useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/(home)');
  }, [router]);
}
