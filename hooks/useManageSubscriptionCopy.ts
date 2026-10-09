// hooks/useManageSubscriptionCopy.ts — the ONLY place the Manage Subscription
// row's words live (WEBCANCEL, 2026-10-09; i18n surface 'office.manage-sub').
// components/ManageSubscriptionRow and the Settings downgrade alert read it;
// they add no t() keys.
//
// What the words may say (scripts/validate-manage-subscription.ts pins it):
//   - where a plan is changed or cancelled, and that the row opens that place;
//   - the date RevenueCat reports, as "Renews on" or "Ends on";
//   - never that a plan was cancelled, never a time by which anything is done
//     (the Terms promise none), never a refund.
// An iPhone build shows only 'none', 'store-here', 'elsewhere-web',
// 'elsewhere' and 'plan-line' (utils/manageSubscription), and none of those
// names another phone platform or an email route (App Store 2.3.10, 3.1.1).
//
// Never call t() at module scope: the object is rebuilt when the language
// changes.
import { useMemo } from 'react';
import { useT } from '@/contexts/LanguageContext';
import { formatDateL } from '@/i18n/format';
import { PLAN_NAME, type ManageKind, type ManageTier, type RenewalFact } from '@/utils/manageSubscription';

export interface ManageSubscriptionLines {
  /** The row's label. */
  label: string;
  /** The line under it; null when the label says everything. */
  subtitle: string | null;
  /** Shown when the page could not be opened. */
  fallback: string;
  /** The body of the Switch to Free alert on the Free plan card. */
  downgrade: string;
}

export interface ManageSubscriptionCopy {
  lines: (kind: ManageKind, os: string, tier: ManageTier) => ManageSubscriptionLines;
  /** "Renews on Oct 9, 2026" / "Ends on Oct 9, 2026"; null when RevenueCat reported no date. */
  renewal: (fact: RenewalFact | null) => string | null;
}

export function useManageSubscriptionCopy(): ManageSubscriptionCopy {
  const { t, lang } = useT();
  return useMemo<ManageSubscriptionCopy>(() => {
    const manage = t('office.manageSub.label', 'Manage Subscription');
    const noneBody = t('office.manageSub.none.body', 'There is no paid subscription on this account.');
    const elsewhereWebBody = t('office.manageSub.elsewhereWeb.body', 'You subscribed in the web app. Manage it there, in Settings, Manage Subscription.');
    const elsewhereBody = t('office.manageSub.elsewhere.body', 'This plan was not bought on this phone. Manage it where you subscribed.');
    const emailBody = t('office.manageSub.email.body', 'To change or cancel your plan, email help@mageid.app.');
    const lines = (kind: ManageKind, os: string, tier: ManageTier): ManageSubscriptionLines => {
      const plan = PLAN_NAME[tier];
      const planLabel = t('office.manageSub.plan.label', '{plan} plan', { plan });
      switch (kind) {
        case 'none':
          return {
            label: t('office.manageSub.none.label', 'No Paid Subscription'),
            subtitle: noneBody,
            fallback: noneBody,
            downgrade: t('office.manageSub.none.downgrade', 'There is no paid subscription on this account, so there is nothing to cancel.'),
          };
        case 'store-here':
          return os === 'ios'
            ? {
              label: manage,
              subtitle: t('office.manageSub.storeIos.body', 'Opens your App Store subscriptions, where you can change or cancel your plan.'),
              fallback: t('office.manageSub.storeIos.fallback', 'Open the Settings app, tap your name, then Subscriptions to manage your MAGE ID plan.'),
              downgrade: t('office.manageSub.storeIos.downgrade', 'To switch to Free, cancel your subscription in your App Store subscriptions. Manage Subscription on this screen opens them. Nothing is deleted.'),
            }
            : {
              label: manage,
              subtitle: t('office.manageSub.storeAndroid.body', 'Opens your Google Play subscriptions, where you can change or cancel your plan.'),
              fallback: t('office.manageSub.storeAndroid.fallback', 'Open Google Play, then Subscriptions to manage your MAGE ID plan.'),
              downgrade: t('office.manageSub.storeAndroid.downgrade', 'To switch to Free, cancel your subscription in your Google Play subscriptions. Manage Subscription on this screen opens them. Nothing is deleted.'),
            };
        case 'web-portal':
          return {
            label: manage,
            subtitle: t('office.manageSub.web.body', 'Opens your billing page in a new tab, where you can change or cancel your plan.'),
            fallback: t('office.manageSub.web.fallback', 'The billing page did not open. To change or cancel your plan, email help@mageid.app.'),
            downgrade: t('office.manageSub.web.downgrade', 'To switch to Free, cancel your plan on your billing page. Manage Subscription on this screen opens it. Nothing is deleted.'),
          };
        case 'other-apple':
          return {
            label: manage,
            subtitle: t('office.manageSub.apple.body', 'You subscribed on iPhone. Manage it in your Apple account settings.'),
            fallback: t('office.manageSub.apple.fallback', 'On your iPhone, open the Settings app, tap your name, then Subscriptions.'),
            downgrade: t('office.manageSub.apple.downgrade', 'You subscribed on iPhone. To switch to Free, cancel the subscription in your Apple account settings. Nothing is deleted.'),
          };
        case 'other-google':
          return {
            label: manage,
            subtitle: t('office.manageSub.google.body', 'You subscribed on Android. Manage it in your Google Play subscriptions.'),
            fallback: t('office.manageSub.google.fallback', 'On your Android phone, open Google Play, then Subscriptions.'),
            downgrade: t('office.manageSub.google.downgrade', 'You subscribed on Android. To switch to Free, cancel the subscription in Google Play. Nothing is deleted.'),
          };
        case 'elsewhere-web':
          return {
            label: planLabel,
            subtitle: elsewhereWebBody,
            fallback: elsewhereWebBody,
            downgrade: t('office.manageSub.elsewhereWeb.downgrade', 'You subscribed in the web app. To switch to Free, cancel the plan there, in Settings, Manage Subscription. Nothing is deleted.'),
          };
        case 'elsewhere':
          return {
            label: planLabel,
            subtitle: elsewhereBody,
            fallback: elsewhereBody,
            downgrade: t('office.manageSub.elsewhere.downgrade', 'This plan was not bought on this phone. To switch to Free, cancel it where you subscribed. Nothing is deleted.'),
          };
        case 'plan-line':
          return {
            label: planLabel,
            subtitle: null,
            fallback: planLabel,
            downgrade: t('office.manageSub.plan.downgrade', 'Your {plan} plan can’t be changed from this screen. Nothing is deleted when a plan ends.', { plan }),
          };
        case 'email':
          return {
            label: manage,
            subtitle: emailBody,
            fallback: emailBody,
            downgrade: t('office.manageSub.email.downgrade', 'To switch to Free, email help@mageid.app. Nothing is deleted.'),
          };
        case 'by-hand':
        default:
          return {
            label: t('office.manageSub.byHand.label', 'Your Plan Was Turned On by MAGE ID'),
            subtitle: t('office.manageSub.byHand.body', 'Email help@mageid.app to change or cancel. Nothing is deleted.'),
            fallback: t('office.manageSub.byHand.fallback', 'Email help@mageid.app to change or cancel your plan. Nothing is deleted.'),
            downgrade: t('office.manageSub.byHand.downgrade', 'Your plan was turned on by MAGE ID, so there is no store subscription to cancel. Email help@mageid.app to switch to Free. Nothing is deleted.'),
          };
      }
    };
    const renewal = (fact: RenewalFact | null): string | null => {
      if (!fact) return null;
      const date = formatDateL(fact.iso, 'dayYear', lang);
      return fact.kind === 'renews'
        ? t('office.manageSub.renewsOn', 'Renews on {date}', { date })
        : t('office.manageSub.endsOn', 'Ends on {date}', { date });
    };
    return { lines, renewal };
  }, [t, lang]);
}
