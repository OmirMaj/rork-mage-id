type EventProperties = Record<string, string | number | boolean | undefined>;

interface AnalyticsProvider {
  track: (eventName: string, properties?: EventProperties) => void;
}

const consoleProvider: AnalyticsProvider = {
  track: (eventName: string, properties?: EventProperties) => {
    console.log(`[Analytics] ${eventName}`, properties ?? '');
  },
};

let provider: AnalyticsProvider = consoleProvider;

export function setAnalyticsProvider(newProvider: AnalyticsProvider): void {
  provider = newProvider;
}

export function track(eventName: string, properties?: EventProperties): void {
  try {
    provider.track(eventName, properties);
  } catch (err) {
    console.log('[Analytics] Failed to track event:', eventName, err);
  }
}

export const AnalyticsEvents = {
  USER_SIGNED_UP: 'user_signed_up',
  USER_LOGGED_IN: 'user_logged_in',
  USER_LOGGED_OUT: 'user_logged_out',
  // First activation step after signup — which surface the user is here for.
  // `onboarding: true` marks the first-run pick (vs. a later change in Settings).
  PERSONA_SELECTED: 'persona_selected',
  PROJECT_CREATED: 'project_created',
  ESTIMATE_GENERATED: 'estimate_generated',
  INVOICE_CREATED: 'invoice_created',
  CHANGE_ORDER_CREATED: 'change_order_created',
  BID_POSTED: 'bid_posted',
  MESSAGE_SENT: 'message_sent',
  SUBSCRIPTION_PURCHASED: 'subscription_purchased',
  DAILY_REPORT_CREATED: 'daily_report_created',
  PUNCH_ITEM_CREATED: 'punch_item_created',
  RFI_CREATED: 'rfi_created',
  SUBMITTAL_CREATED: 'submittal_created',
  EQUIPMENT_ADDED: 'equipment_added',
  CONTACT_ADDED: 'contact_added',
  PDF_GENERATED: 'pdf_generated',
  PHOTO_ADDED: 'photo_added',
  // ── Monetization funnel ──
  // PAYWALL_VIEWED fires when the modal becomes visible.
  // PAYWALL_DISMISSED fires from every close path (X, Not now, hardware
  //   back). Compute view→dismiss to get bounce rate.
  // SUBSCRIPTION_PURCHASE_STARTED fires the moment user taps Upgrade,
  //   BEFORE Apple's confirm sheet. Catches intent even when the user
  //   cancels Apple's prompt or it fails downstream.
  // SUBSCRIPTION_PURCHASE_FAILED fires on RC throw (non-cancel error).
  PAYWALL_VIEWED: 'paywall_viewed',
  PAYWALL_DISMISSED: 'paywall_dismissed',
  SUBSCRIPTION_PURCHASE_STARTED: 'subscription_purchase_started',
  SUBSCRIPTION_PURCHASE_FAILED: 'subscription_purchase_failed',
  // ── Activation funnel: import-your-pipeline during first-run ──
  // The "contractor brings their own clients" cold-start bet. Fires from
  // app/onboarding.tsx's import step.
  // ONBOARDING_IMPORT_VIEWED fires when the import step is shown (only
  //   contractor/both personas reach it — client/PM skip onboarding).
  // ONBOARDING_IMPORT_COMPLETED fires after leads are committed; `count`
  //   is how many clients they brought.
  // ONBOARDING_IMPORT_SKIPPED fires from the in-step "add them later".
  // Compute viewed→completed for the activation rate, and the count
  // distribution for how much pipeline new users actually carry in.
  ONBOARDING_IMPORT_VIEWED: 'onboarding_import_viewed',
  ONBOARDING_IMPORT_COMPLETED: 'onboarding_import_completed',
  ONBOARDING_IMPORT_SKIPPED: 'onboarding_import_skipped',
  // ── Activation funnel: seed-your-rates during first-run ──
  // The cold-start fix for the cost book (utils/costSeedCore). Without it a
  // twenty-year contractor's day-one estimate is a beginner's, because
  // buildCostDatabase only learns from jobs closed inside MAGE.
  // ONBOARDING_RATES_VIEWED fires when the step renders;
  // ONBOARDING_RATES_COMPLETED carries `count` = rates committed;
  // ONBOARDING_RATES_SKIPPED fires from "I'll add them later".
  ONBOARDING_RATES_VIEWED: 'onboarding_rates_viewed',
  ONBOARDING_RATES_COMPLETED: 'onboarding_rates_completed',
  ONBOARDING_RATES_SKIPPED: 'onboarding_rates_skipped',
  // ── AI schedule generation ──
  // Fires when a generated schedule is applied to a project. `source` is
  // 'estimate' (cost-linked, the moat) or 'text'; `cost_linked_tasks` shows
  // how many tasks landed wired to the estimate.
  SCHEDULE_GENERATED: 'schedule_generated',
  // ── Marketplace supply-side growth ──
  // Fires when a GC shares an invite for a sub/contractor to join (free for
  // subs). `source` says where the invite was triggered (e.g. 'subs'). Each
  // accepted invite seeds the supply side of the marketplace.
  CONTRACTOR_INVITE_SHARED: 'contractor_invite_shared',
  // ── Activation funnel: the aha + send-to-client ──
  // ESTIMATE_SHARED fires when a priced estimate/proposal is sent to a
  //   homeowner (the funnel's final step). `method` is 'pdf_share' |
  //   'proposal_link' | 'email'; `source` names the screen.
  // COST_RATES_SEEDED fires when the contractor commits seeded rates OUTSIDE
  //   first-run onboarding (the standalone cost-seed screen). Onboarding rates
  //   already emit ONBOARDING_RATES_COMPLETED.
  // MATERIAL_RECEIPT_SAVED fires when a scanned/entered material receipt is
  //   saved — real cost actuals, a legitimate step-4 "own cost data" input.
  // The aha itself is the EXISTING estimate_generated, now enriched with
  //   used_learned_costs / learned_rate_count / jobs_analyzed (see later tasks).
  ESTIMATE_SHARED: 'estimate_shared',
  COST_RATES_SEEDED: 'cost_rates_seeded',
  MATERIAL_RECEIPT_SAVED: 'material_receipt_saved',
} as const;
