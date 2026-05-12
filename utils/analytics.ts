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
} as const;
