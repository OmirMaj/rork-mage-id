import { getActiveTutorialId } from '@/utils/tutorial/activeRun';
import { isKnownSampleProjectId } from '@/utils/sampleGuard';

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

/**
 * Funnel hygiene, applied to EVERY event so no call site can forget it:
 *   • is_sample — an event that names a `project_id` says whether that project
 *     is a sample (utils/sampleGuard's registry, kept by ProjectContext). The
 *     sample seed fires PROJECT_CREATED / INVOICE_CREATED / DAILY_REPORT_CREATED
 *     / PUNCH_ITEM_CREATED for data the user never made; without this the
 *     Activation funnel counted a tapped "Try it on a sample job" as a first
 *     project. A caller that already knows (addProject) passes is_sample and wins.
 *   • in_tutorial / tutorial_id — while a tutorial run is live, so practice on
 *     the sample is never read as real use (utils/tutorial/activeRun, which
 *     imports nothing, so this file stays cycle-free).
 * Exported for scripts/validate-sample-guard.ts; track() is the only caller.
 */
export function withFunnelContext(properties?: EventProperties): EventProperties | undefined {
  let out = properties;
  const pid = properties?.project_id;
  if (typeof pid === 'string' && properties?.is_sample === undefined) {
    out = { ...out, is_sample: isKnownSampleProjectId(pid) };
  }
  const tutorialId = getActiveTutorialId();
  if (tutorialId) out = { ...out, in_tutorial: true, tutorial_id: tutorialId };
  return out;
}

export function track(eventName: string, properties?: EventProperties): void {
  try {
    provider.track(eventName, withFunnelContext(properties));
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
  // ── Learn-by-doing tutorials (utils/tutorial, components/tutorial) ──
  // Every event fired DURING a run also carries in_tutorial / tutorial_id
  // (withFunnelContext above). The success metric is TUTORIAL_COMPLETED →
  // the same create event with is_sample:false and no in_tutorial within 7
  // days; for practice-passed tutorials, TUTORIAL_HANDOFF_CLICKED(paywall) →
  // PAYWALL_VIEWED → SUBSCRIPTION_PURCHASED.
  // TUTORIAL_OFFERED {tutorial_id, entry: onboarding|chip|checklist|paywall|hub|chain}
  // TUTORIAL_STARTED {tutorial_id, version, entry, platform, persona, tier, practice_pass}
  // TUTORIAL_STEP_COMPLETED {tutorial_id, step_id, step_index, ms, via: signal|next|skip_ahead|skip_step|assist}
  // TUTORIAL_STUCK {tutorial_id, step_id} — 15 s idle on a step
  // TUTORIAL_ASSIST_USED {tutorial_id, step_id, assist_id}
  // TUTORIAL_TARGET_MISSING {tutorial_id, step_id, target_id} — target rot in the field
  // TUTORIAL_EXITED {tutorial_id, step_id, reason}
  // TUTORIAL_COMPLETED {tutorial_id, ms, skipped_steps}
  // TUTORIAL_HANDOFF_CLICKED {tutorial_id, destination: real_job|create_job|paywall|stripe|chain}
  TUTORIAL_OFFERED: 'tutorial_offered',
  TUTORIAL_STARTED: 'tutorial_started',
  TUTORIAL_STEP_COMPLETED: 'tutorial_step_completed',
  TUTORIAL_STUCK: 'tutorial_stuck',
  TUTORIAL_ASSIST_USED: 'tutorial_assist_used',
  TUTORIAL_TARGET_MISSING: 'tutorial_target_missing',
  TUTORIAL_EXITED: 'tutorial_exited',
  TUTORIAL_COMPLETED: 'tutorial_completed',
  TUTORIAL_HANDOFF_CLICKED: 'tutorial_handoff_clicked',
} as const;
