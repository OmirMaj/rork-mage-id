import AsyncStorage from '@react-native-async-storage/async-storage';

export type SignupPlan = 'free' | 'pro' | 'business' | 'enterprise';
export interface SignupIntent { plan: SignupPlan; trialDays: number; }

const VALID_PLANS: readonly SignupPlan[] = ['free', 'pro', 'business', 'enterprise'];
export const SIGNUP_INTENT_KEY = 'mageid_signup_intent';

/**
 * The longest trial the marketing site actually offers, and therefore the
 * longest one the paywall is allowed to print.
 *
 * WHY A CLAMP EXISTS AT ALL. `trialDays` comes off the URL — it is whatever a
 * stranger types after `?trial=` — and app/paywall.tsx renders it verbatim as
 * "{intentTrialDays}-day free trial" on the Pro, Business and Enterprise cards.
 * With no upper bound, `https://app.mageid.app/?plan=pro&trial=999` made the
 * PAID app advertise a 999-day free trial, in the product's own chrome, to
 * anyone who could be sent a link. Nothing downstream honoured it — RevenueCat
 * decides the real trial — so the only thing the number could ever do was
 * promise a trial that would not be given.
 *
 * The single link on the site is marketing/pricing.html's
 * `?plan=pro&trial=14`, so 14 is the whole offer. If a longer trial is ever
 * genuinely offered, raise this constant AND the RevenueCat product together —
 * the constant is the promise, not the source of it.
 */
export const MAX_TRIAL_DAYS = 14;

/**
 * Whole days, never negative, never above the cap. Anything unparseable is 0.
 *
 * This lives on its own because BOTH doors have to use it. Clamping only in
 * parseSignupIntent would have been half a fix: parse runs once, on the web
 * deep-link entry (app/_layout.tsx), and writes the result to AsyncStorage —
 * but readSignupIntent is what app/paywall.tsx and app/onboarding-paywall.tsx
 * actually call, and this app ships JS by OTA over installed builds. A
 * `mageid_signup_intent` of {"plan":"pro","trialDays":999} written by
 * yesterday's build survives the update, so the read path has to re-clamp what
 * it finds on disk rather than trust that a fixed parser put it there.
 */
export function clampTrialDays(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_TRIAL_DAYS) : 0;
}

type Params = Record<string, string | undefined> | URLSearchParams;
function get(params: Params, key: string): string | undefined {
  return params instanceof URLSearchParams ? params.get(key) ?? undefined : params[key];
}

/** Parse the marketing ?plan=&trial= handoff. Returns null if plan is absent/invalid. */
export function parseSignupIntent(params: Params): SignupIntent | null {
  const plan = (get(params, 'plan') ?? '').trim().toLowerCase() as SignupPlan;
  if (!VALID_PLANS.includes(plan)) return null;
  // Clamped, never merely floored — see MAX_TRIAL_DAYS. An out-of-range value
  // is capped rather than rejected so a stale or fat-fingered link still lands
  // the visitor on the paywall with the real offer, instead of silently losing
  // the plan selection they came for.
  return { plan, trialDays: clampTrialDays(get(params, 'trial')) };
}

export async function persistSignupIntent(intent: SignupIntent): Promise<void> {
  // Clamp on the way in as well as on the way out, so nothing over the cap is
  // ever written by this build in the first place.
  await AsyncStorage.setItem(
    SIGNUP_INTENT_KEY,
    JSON.stringify({ plan: intent.plan, trialDays: clampTrialDays(intent.trialDays) }),
  );
}

/**
 * What the paywall screens read. Re-validates BOTH fields, because what is on
 * disk was not necessarily written by this build — see clampTrialDays.
 */
export function normalizeStoredIntent(raw: string | null): SignupIntent | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<SignupIntent> | null;
    const plan = (typeof v?.plan === 'string' ? v.plan.trim().toLowerCase() : '') as SignupPlan;
    if (!VALID_PLANS.includes(plan)) return null;
    return { plan, trialDays: clampTrialDays(v?.trialDays) };
  } catch {
    return null;
  }
}

export async function readSignupIntent(): Promise<SignupIntent | null> {
  return normalizeStoredIntent(await AsyncStorage.getItem(SIGNUP_INTENT_KEY));
}

export async function clearSignupIntent(): Promise<void> {
  await AsyncStorage.removeItem(SIGNUP_INTENT_KEY);
}
