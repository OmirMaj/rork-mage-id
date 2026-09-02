// hooks/useClientPaywall.ts — orchestrates the client paywall.
//
// Pattern: the hook owns the modal's visibility + mode + a one-shot
// promise that the caller awaits. Caller does:
//
//   const { gate, ClientPaywallElement } = useClientPaywall();
//   const ok = await gate('rfp-post');
//   if (!ok) return;             // user dismissed; abort
//   // ... continue with the action ...
//
// And renders <ClientPaywallElement /> somewhere in their JSX so the
// modal can portal in when gate() is called. This keeps the call-site
// linear instead of forcing every gated action to thread "is the
// paywall open?" state through itself.
//
// The hook also exposes a synchronous `hasActiveClientSubscription`
// flag the caller can branch on first — subscribers should never see
// the paywall on RFP-post since their subscription includes unlimited
// posts.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import ClientPaywall, {
  type ClientPaywallMode,
  RFP_PAID_POST_ENABLED,
  CLIENT_SUBS_ENABLED,
} from '@/components/ClientPaywall';
import {
  consumeRfpPostCredit,
  getRfpPostCreditBalance,
  loadClientSubState,
  hasActiveClientSubscription as hasActiveClientSubscriptionPure,
  type ClientSubState,
} from '@/utils/clientPricing';

interface ClientPaywallController {
  /** Open the paywall and resolve true once the user has unlocked the
   *  action, false if they dismissed without paying. Promise never
   *  rejects — callers branch on the boolean. */
  gate: (mode: ClientPaywallMode, feature?: string) => Promise<boolean>;
  /** True when the user is on a paid client subscription (Pro or PM,
   *  including the 14-day trial window). When true, RFP-post gating
   *  should be skipped entirely. */
  hasActiveClientSubscription: boolean;
  /** Local subscription state. Re-read on every paywall close so the
   *  UI reflects "you just started a trial" without a page refresh. */
  clientSubState: ClientSubState;
  /** Render this somewhere in the consuming screen's JSX. It's a Modal,
   *  so where it appears in the tree doesn't matter visually — but it
   *  must be mounted at all times so gate() can flip it open. */
  ClientPaywallElement: React.ReactElement;
}

export function useClientPaywall(): ClientPaywallController {
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<ClientPaywallMode>('rfp-post');
  const [feature, setFeature] = useState<string | undefined>(undefined);
  const [clientSubState, setClientSubState] = useState<ClientSubState>({
    tier: 'free',
    trialEndsAt: null,
    updatedAt: new Date(0).toISOString(),
  });

  // The promise resolver currently in flight. The hook stores it in a
  // ref so that opening the paywall ↔ closing the paywall transitions
  // through one shared continuation. If gate() is called twice before
  // the first resolves, we reject the previous one (the user has moved
  // on) so we don't leak listeners.
  const pendingResolverRef = useRef<((ok: boolean) => void) | null>(null);

  // Hydrate subscription state on mount + every time the modal closes
  // (the modal mutates state via startClientTrial / saveClientSubState).
  useEffect(() => {
    let cancelled = false;
    void loadClientSubState().then(state => {
      if (!cancelled) setClientSubState(state);
    });
    return () => { cancelled = true; };
  }, [visible]);

  const gate = useCallback(async (nextMode: ClientPaywallMode, nextFeature?: string): Promise<boolean> => {
    // NOTHING IS SELLABLE YET -> DO NOT SHOW A PAYWALL.
    //
    // Both monetization paths are behind kill switches in ClientPaywall:
    // RFP_PAID_POST_ENABLED (no server-confirmed payment yet) and
    // CLIENT_SUBS_ENABLED (handleStartTrial is an AsyncStorage stub, not IAP).
    // With both off the modal has nothing to sell, but it still RENDERED —
    // quoting $19/mo and $49/mo with auto-renew terms and a trial button that
    // unlocked the feature without any purchase sheet. That is Guideline 3.1.1
    // plus 2.3.1, on the homeowner persona's very first action.
    //
    // Allowing the action outright is the honest behaviour while the tiers are
    // unbuilt: the homeowner path ships free for 1.0. Flip either flag and this
    // short-circuit stops applying, so the gate returns automatically once
    // there is something real to charge for.
    if (!RFP_PAID_POST_ENABLED && !CLIENT_SUBS_ENABLED) {
      return true;
    }

    // Subscriber short-circuit: if the user is already on Pro/PM (or
    // in trial), skip the paywall for RFP posts entirely.
    if (nextMode === 'rfp-post' && hasActiveClientSubscriptionPure(clientSubState)) {
      return true;
    }
    // For rfp-post we also honor any prepaid credits (e.g. user bought
    // 3 posts at once in a previous session). Consume one and proceed
    // without showing the paywall.
    if (nextMode === 'rfp-post') {
      const balance = await getRfpPostCreditBalance();
      if (balance > 0) {
        const consumed = await consumeRfpPostCredit();
        if (consumed) return true;
      }
    }

    // Cancel any in-flight resolver — the previous gate call is being
    // superseded by this one (user re-tried after a partial flow).
    if (pendingResolverRef.current) {
      pendingResolverRef.current(false);
      pendingResolverRef.current = null;
    }

    setMode(nextMode);
    setFeature(nextFeature);
    setVisible(true);
    return new Promise<boolean>((resolve) => {
      pendingResolverRef.current = resolve;
    });
  }, [clientSubState]);

  const handleClose = useCallback(() => {
    setVisible(false);
    if (pendingResolverRef.current) {
      pendingResolverRef.current(false);
      pendingResolverRef.current = null;
    }
  }, []);

  const handleUnlocked = useCallback(async (via: 'rfp_post_fee' | 'pro_trial' | 'pm_trial') => {
    setVisible(false);
    // The paywall itself recorded the unlock (credit / subscription
    // state). For RFP-post we need to *consume* the credit we just
    // recorded so the very-next submit doesn't open the paywall again.
    if (via === 'rfp_post_fee') {
      await consumeRfpPostCredit();
    }
    if (pendingResolverRef.current) {
      pendingResolverRef.current(true);
      pendingResolverRef.current = null;
    }
  }, []);

  const ClientPaywallElement = React.createElement(ClientPaywall, {
    visible,
    mode,
    feature,
    onClose: handleClose,
    onUnlocked: handleUnlocked,
  });

  return {
    gate,
    hasActiveClientSubscription: hasActiveClientSubscriptionPure(clientSubState),
    clientSubState,
    ClientPaywallElement,
  };
}
