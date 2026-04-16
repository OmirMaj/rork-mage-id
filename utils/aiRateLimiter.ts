import AsyncStorage from '@react-native-async-storage/async-storage';

const RATE_KEY = 'mage_ai_usage';

interface DailyUsage {
  date: string;
  count: number;
  tier: {
    fast: number;
    smart: number;
  };
}

const LIMITS = {
  free: { daily: 10, smart: 3 },
  pro: { daily: 75, smart: 25 },
  business: { daily: 200, smart: 75 },
} as const;

export type SubscriptionTierKey = 'free' | 'pro' | 'business';
export type RequestTier = 'fast' | 'smart';

export async function checkAILimit(
  subscriptionTier: SubscriptionTierKey,
  requestTier: RequestTier,
): Promise<{ allowed: boolean; remaining: number; message?: string }> {
  const today = new Date().toISOString().split('T')[0];
  const raw = await AsyncStorage.getItem(RATE_KEY);
  let usage: DailyUsage = raw
    ? JSON.parse(raw)
    : { date: today, count: 0, tier: { fast: 0, smart: 0 } };

  if (usage.date !== today) {
    usage = { date: today, count: 0, tier: { fast: 0, smart: 0 } };
  }

  const limits = LIMITS[subscriptionTier];
  const dailyRemaining = limits.daily - usage.count;

  if (usage.count >= limits.daily) {
    return {
      allowed: false,
      remaining: 0,
      message:
        subscriptionTier === 'free'
          ? "You've used all 10 AI requests today. Upgrade to Pro for 75/day."
          : subscriptionTier === 'pro'
            ? "You've used all 75 AI requests today. Upgrade to Business for 200/day."
            : "You've reached today's AI limit. Resets at midnight.",
    };
  }

  if (requestTier === 'smart' && usage.tier.smart >= limits.smart) {
    return {
      allowed: false,
      remaining: dailyRemaining,
      message:
        "You've used all advanced AI analysis for today. Try again tomorrow or use quick AI features instead.",
    };
  }

  return { allowed: true, remaining: dailyRemaining - 1 };
}

export async function recordAIUsage(requestTier: RequestTier): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const raw = await AsyncStorage.getItem(RATE_KEY);
  let usage: DailyUsage = raw
    ? JSON.parse(raw)
    : { date: today, count: 0, tier: { fast: 0, smart: 0 } };

  if (usage.date !== today) {
    usage = { date: today, count: 0, tier: { fast: 0, smart: 0 } };
  }

  usage.count += 1;
  usage.tier[requestTier] += 1;
  await AsyncStorage.setItem(RATE_KEY, JSON.stringify(usage));
}

export async function getAIUsageStats(
  subscriptionTier: SubscriptionTierKey,
): Promise<{
  used: number;
  limit: number;
  smartUsed: number;
  smartLimit: number;
}> {
  const today = new Date().toISOString().split('T')[0];
  const raw = await AsyncStorage.getItem(RATE_KEY);
  const usage: DailyUsage = raw
    ? JSON.parse(raw)
    : { date: today, count: 0, tier: { fast: 0, smart: 0 } };

  if (usage.date !== today) {
    return {
      used: 0,
      limit: LIMITS[subscriptionTier].daily,
      smartUsed: 0,
      smartLimit: LIMITS[subscriptionTier].smart,
    };
  }

  return {
    used: usage.count,
    limit: LIMITS[subscriptionTier].daily,
    smartUsed: usage.tier.smart,
    smartLimit: LIMITS[subscriptionTier].smart,
  };
}
