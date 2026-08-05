import AsyncStorage from '@react-native-async-storage/async-storage';

export type SignupPlan = 'free' | 'pro' | 'business' | 'enterprise';
export interface SignupIntent { plan: SignupPlan; trialDays: number; }

const VALID_PLANS: readonly SignupPlan[] = ['free', 'pro', 'business', 'enterprise'];
export const SIGNUP_INTENT_KEY = 'mageid_signup_intent';

type Params = Record<string, string | undefined> | URLSearchParams;
function get(params: Params, key: string): string | undefined {
  return params instanceof URLSearchParams ? params.get(key) ?? undefined : params[key];
}

/** Parse the marketing ?plan=&trial= handoff. Returns null if plan is absent/invalid. */
export function parseSignupIntent(params: Params): SignupIntent | null {
  const plan = (get(params, 'plan') ?? '').toLowerCase() as SignupPlan;
  if (!VALID_PLANS.includes(plan)) return null;
  const rawTrial = get(params, 'trial');
  const parsed = rawTrial ? Math.floor(Number(rawTrial)) : 0;
  const trialDays = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  return { plan, trialDays };
}

export async function persistSignupIntent(intent: SignupIntent): Promise<void> {
  await AsyncStorage.setItem(SIGNUP_INTENT_KEY, JSON.stringify(intent));
}

export async function readSignupIntent(): Promise<SignupIntent | null> {
  const raw = await AsyncStorage.getItem(SIGNUP_INTENT_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as SignupIntent;
    return VALID_PLANS.includes(v.plan) ? v : null;
  } catch {
    return null;
  }
}

export async function clearSignupIntent(): Promise<void> {
  await AsyncStorage.removeItem(SIGNUP_INTENT_KEY);
}
