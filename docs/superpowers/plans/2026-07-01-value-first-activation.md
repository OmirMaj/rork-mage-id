# Value-First Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn "wow behind the wall" into "feel it, then the wall" — every premium AI action (voice capture, AI estimate wizard, AI takeoff) flows through one metered gate that gives free users a few lifetime tastes, then a single unified `UpgradeSheet`, while onboarding is reordered value-first and taught the cost-learning moat.

**Architecture:** All premium actions call the existing `checkAILimit(tier, requestTier, feature)` path, run the action, then `recordAIUsage(feature)` on success only. The ad-hoc `isProOrAbove` / `<Paywall>` hard walls on these three features are deleted in favor of this path. Gating decisions are extracted into a **pure** `evaluateLimit()` function (no storage, no await) so they are testable via the repo's `bun run scripts/validate-*.ts` idiom; `checkAILimit` becomes a thin storage-reading wrapper that fails open on error.

**Tech Stack:** React Native / Expo (SDK 54), TypeScript strict, zustand + react-query, AsyncStorage; verification via `npx tsc --noEmit` + `bun run scripts/validate-*.ts` (no jest).

---

## File structure

| File | Create / Modify | One responsibility |
|---|---|---|
| `utils/aiRateLimiter.ts` | Modify | Extract pure `evaluateLimit()`; add `voiceCapture`/`aiEstimateWizard`/`aiTakeoff` registry entries; export `FAIL_OPEN_RESULT`; make `checkAILimit` a thin wrapper that fails open. |
| `scripts/validate-activation-gating.ts` | Create | Pure-function test of `evaluateLimit` (3 new caps: under-cap allowed, at/over-cap `lifetime_cap`) + `FAIL_OPEN_RESULT`. |
| `package.json` | Modify | Add `test:gating` script; wire into `ship-check`. |
| `components/UpgradeSheet.tsx` | Create | Unified post-value upgrade sheet, frosted-glass over last result, driven by `{reason, message}`, routes to `/paywall`. |
| `components/ThinkingStates.tsx` | Create | Reusable labeled "thinking sequence" that cycles moat-teaching lines during AI waits. |
| `components/EstimateLoadingOverlay.tsx` | Modify | Accept optional `thinkingSteps` to render `ThinkingStates` in place of the static subtitle. |
| `components/UniversalMicButton.tsx` | Modify | Remove the `isProOrAbove` hard wall; meter `voiceCapture` at parse time; show `UpgradeSheet`; `ThinkingStates` during parse. |
| `app/estimate-wizard.tsx` | Modify | Delete the screen-level `<Paywall>`; meter `aiEstimateWizard`; show `UpgradeSheet`; `ThinkingStates` in loading overlay. |
| `app/takeoff.tsx` | Modify | Delete the screen-level `<Paywall>`; meter `aiTakeoff` at analyze time; show `UpgradeSheet`. |
| `app/daily-report.tsx` | Modify | Replace the two `isLocked={!isProOrAbove}` voice walls with a metered `voiceCapture` gate + `UpgradeSheet`. |
| `components/OnboardingChecklist.tsx` | Modify | Reorder items value-first; add a metered-free "Try it" first item. |
| `app/(tabs)/(home)/index.tsx` | Modify | Pass the new `triedWowFeature` prop to `OnboardingChecklist`; enforce free `maxProjects` at create. |
| `app/signup.tsx` | Modify | Drop confirm-password; make email verification non-blocking (enter onboarding immediately, non-blocking banner on failure). |
| `app/_layout.tsx` | Modify | Remove the dead `shouldShowOnboardingPaywallGate` wiring (keep `onboarding-paywall.tsx` parked on disk). |
| `app/onboarding.tsx` | Modify | Replace one generic PREVIEW_CARD with the moat/flywheel card; add swipeable card-stack progressive disclosure ending on a "try it" card. |
| `hooks/useTierAccess.ts` | Modify | Add `maxProjects` to `FEATURE_LIMITS`; add `canCreateProject(realProjectCount)` helper. |

---

### Task 1: Extract pure `evaluateLimit` from `aiRateLimiter.ts`

Extracts the entire branch-logic of `checkAILimit` into a pure, synchronous, storage-free function so it is testable via the validate-script idiom. **Critical correctness fix:** a free user with lifetime trials remaining on a metered feature must be ALLOWED immediately — bypassing the daily/smart quotas — otherwise the free smart-daily cap of `0` would block metered-taste features before the user could ever spend a trial.

**Files**
- Modify: `utils/aiRateLimiter.ts` (`checkAILimit` body lines 241-331; add `evaluateLimit` + `FAIL_OPEN_RESULT`)
- Test: `scripts/validate-activation-gating.ts` (created in Task 3; this task only makes the function exist and compile)

- [ ] In `utils/aiRateLimiter.ts`, immediately BEFORE the existing `export async function checkAILimit(` (line 241), add the exported constant:

```ts
/**
 * Returned when a storage read fails inside checkAILimit. Fail OPEN for a
 * signed-in user — a lost read should never cost a trial or block value.
 * recordAIUsage still only runs on success, so nothing is incremented here.
 */
export const FAIL_OPEN_RESULT: LimitCheck = { allowed: true, remaining: 0 };
```

- [ ] Directly below that, add the pure decision function (this is the verbatim branch logic from `checkAILimit`, with state passed as plain args and the metered-trials bypass added):

```ts
/**
 * PURE gating decision — no storage, no await. checkAILimit reads storage
 * then delegates here; the validate script tests this directly.
 *
 * @param dailyCount       total AI calls used today (usage.count)
 * @param dailySmartCount  smart-tier calls used today (usage.tier.smart)
 * @param lifetimeUsed     lifetime uses of `feature` (0 if no feature / no cap)
 */
export function evaluateLimit(
  subscriptionTier: SubscriptionTierKey,
  requestTier: RequestTier,
  feature: AIFeature | undefined,
  dailyCount: number,
  dailySmartCount: number,
  lifetimeUsed: number,
): LimitCheck {
  const limits = LIMITS[subscriptionTier];
  const dailyRemaining = limits.daily - dailyCount;

  // 1. Pro-only feature gate (free users can't use it at all)
  if (feature && subscriptionTier === 'free') {
    const cfg = FEATURE_CONFIG[feature];
    if (cfg?.proOnly) {
      return {
        allowed: false,
        remaining: 0,
        reason: 'pro_only',
        upgradeTo: 'pro',
        message: `${cfg.displayName ?? feature} is a Pro feature. Upgrade to unlock unlimited use.`,
      };
    }
  }

  // 2. Free-tier lifetime cap (e.g. 3 Voice Captures ever). When trials
  //    remain, this feature's free allowance is governed by the lifetime
  //    cap, NOT the daily/smart quotas — so allow immediately. Without this
  //    early return, the free smart-daily cap of 0 would block metered
  //    features before the user could ever spend a trial.
  if (feature && subscriptionTier === 'free') {
    const cfg = FEATURE_CONFIG[feature];
    if (cfg?.freeLifetimeCap !== undefined) {
      if (lifetimeUsed >= cfg.freeLifetimeCap) {
        return {
          allowed: false,
          remaining: 0,
          reason: 'lifetime_cap',
          upgradeTo: 'pro',
          message: `You've used your ${cfg.freeLifetimeCap} free ${cfg.displayName ?? 'AI'} trials. Upgrade to Pro for unlimited use.`,
        };
      }
      return { allowed: true, remaining: cfg.freeLifetimeCap - lifetimeUsed - 1 };
    }
  }

  // 3. Daily total cap.
  if (dailyCount >= limits.daily) {
    const nextTier = subscriptionTier === 'free' ? 'pro'
      : subscriptionTier === 'pro' ? 'business'
      : subscriptionTier === 'business' ? 'enterprise'
      : undefined;
    const nextDailyCap = nextTier === 'pro' ? 30
      : nextTier === 'business' ? 80
      : nextTier === 'enterprise' ? 150
      : null;
    const message = subscriptionTier === 'enterprise'
      ? "You've reached today's AI limit. Resets at midnight."
      : `You've used today's ${limits.daily} AI requests. Upgrade to ${nextTier?.[0].toUpperCase()}${nextTier?.slice(1)} for ${nextDailyCap}/day.`;
    return {
      allowed: false,
      remaining: 0,
      reason: 'daily_cap',
      upgradeTo: nextTier as 'pro' | 'business' | 'enterprise' | undefined,
      message,
    };
  }

  // 4. Smart-tier daily cap (Pro/Business only — free has 0 smart by design)
  if (requestTier === 'smart' && dailySmartCount >= limits.smart) {
    const nextTier = subscriptionTier === 'free' ? 'pro'
      : subscriptionTier === 'pro' ? 'business'
      : subscriptionTier === 'business' ? 'enterprise'
      : undefined;
    const nextSmartCap = nextTier === 'pro' ? 6
      : nextTier === 'business' ? 18
      : nextTier === 'enterprise' ? 40
      : null;
    const message = subscriptionTier === 'free'
      ? `Advanced AI requires Pro. Upgrade to unlock Quick Estimate, Schedule Builder, and more.`
      : subscriptionTier === 'enterprise'
        ? `You've used today's advanced AI. Try again tomorrow or use quick AI features instead.`
        : `You've used today's ${limits.smart} advanced AI calls. Upgrade to ${nextTier?.[0].toUpperCase()}${nextTier?.slice(1)} for ${nextSmartCap}/day.`;
    return {
      allowed: false,
      remaining: dailyRemaining,
      reason: 'smart_cap',
      upgradeTo: nextTier as 'pro' | 'business' | 'enterprise' | undefined,
      message,
    };
  }

  return { allowed: true, remaining: dailyRemaining - 1 };
}
```

- [ ] Replace the entire body of `checkAILimit` (everything between `): Promise<LimitCheck> {` at line 245 and the closing `}` at line 331) with a thin, fail-open wrapper:

```ts
): Promise<LimitCheck> {
  try {
    const usage = await getDailyUsage();
    const lifetime = feature ? await getLifetimeUsage() : {};
    const lifetimeUsed = feature ? (lifetime[feature] ?? 0) : 0;
    return evaluateLimit(
      subscriptionTier,
      requestTier,
      feature,
      usage.count,
      usage.tier.smart,
      lifetimeUsed,
    );
  } catch (err) {
    console.warn('[aiRateLimiter] checkAILimit read failed — failing open', err);
    return FAIL_OPEN_RESULT;
  }
}
```

- [ ] Run `npx tsc --noEmit`, expect PASS (no new type errors; `recordAIUsage`, `getAIUsageStats`, `getFreeTrialsRemaining` are untouched).
- [ ] Commit: `refactor(aiRateLimiter): extract pure evaluateLimit + fail-open checkAILimit`

---

### Task 2: Add the three metered-feature registry entries

Adds `voiceCapture`, `aiEstimateWizard`, `aiTakeoff` to the `AIFeature` union and `FEATURE_CONFIG`, mirroring the existing `quickEstimate` shape. `voiceCapture` is `'fast'` (a quick parse, like the existing `voiceIntake`, so paid users aren't capped at the tiny smart quota); the two vision/generation features are `'smart'`.

**Files**
- Modify: `utils/aiRateLimiter.ts` (`AIFeature` union lines 93-115; `FEATURE_CONFIG` lines 128-153)
- Test: `scripts/validate-activation-gating.ts` (Task 3)

- [ ] In the `AIFeature` union, change the `quickEstimate`/`scheduleBuilder`/`estimateValidation` block (lines 107-109) so the three new keys are added directly after `estimateValidation`:

```ts
  | 'quickEstimate'      // free: 3 lifetime trials
  | 'scheduleBuilder'    // free: 3 lifetime trials
  | 'estimateValidation' // free: 3 lifetime trials
  | 'voiceCapture'       // free: 3 lifetime trials (marquee field feature)
  | 'aiEstimateWizard'   // free: 2 lifetime trials
  | 'aiTakeoff'          // free: 1 lifetime trial
```

- [ ] In `FEATURE_CONFIG`, directly after the `estimateValidation` line (line 145), add:

```ts
  voiceCapture:       { tier: 'fast',  freeLifetimeCap: 3, displayName: 'Voice Capture' },
  aiEstimateWizard:   { tier: 'smart', freeLifetimeCap: 2, displayName: 'AI Estimate' },
  aiTakeoff:          { tier: 'smart', freeLifetimeCap: 1, displayName: 'AI Takeoff' },
```

- [ ] Run `npx tsc --noEmit`, expect PASS (`FEATURE_CONFIG` is `Record<AIFeature, FeatureConfig>` — TS requires all three new union members to be present, so a missing entry would fail here).
- [ ] Commit: `feat(aiRateLimiter): register voiceCapture/aiEstimateWizard/aiTakeoff metered features`

---

### Task 3: Validation script for `evaluateLimit`, wired into `ship-check`

Tests the pure `evaluateLimit` for all three new caps (under-cap → allowed, at/over-cap → `lifetime_cap`) plus the exported `FAIL_OPEN_RESULT` value, using the repo's inline-`expect` idiom.

**Files**
- Create: `scripts/validate-activation-gating.ts`
- Modify: `package.json` (`scripts` block lines 5-16)

- [ ] Create `scripts/validate-activation-gating.ts`:

```ts
import { evaluateLimit, FAIL_OPEN_RESULT } from '../utils/aiRateLimiter';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else    { fail++; console.log('  ✗', name, '\n      got:', got, '\n      want:', want); }
}

console.log('\nactivation gating validation:');

// voiceCapture — free, fast tier, lifetime cap 3
expect('voiceCapture free 0/3 → allowed',
  evaluateLimit('free', 'fast', 'voiceCapture', 0, 0, 0).allowed, true);
expect('voiceCapture free 2/3 → allowed',
  evaluateLimit('free', 'fast', 'voiceCapture', 0, 0, 2).allowed, true);
expect('voiceCapture free 3/3 → lifetime_cap',
  evaluateLimit('free', 'fast', 'voiceCapture', 0, 0, 3).reason, 'lifetime_cap');
expect('voiceCapture free 3/3 → blocked',
  evaluateLimit('free', 'fast', 'voiceCapture', 0, 0, 3).allowed, false);

// aiEstimateWizard — free, SMART tier (proves the smart-cap-0 bypass), cap 2
expect('aiEstimateWizard free 1/2 → allowed (bypasses smart daily 0)',
  evaluateLimit('free', 'smart', 'aiEstimateWizard', 0, 0, 1).allowed, true);
expect('aiEstimateWizard free 2/2 → lifetime_cap',
  evaluateLimit('free', 'smart', 'aiEstimateWizard', 0, 0, 2).reason, 'lifetime_cap');

// aiTakeoff — free, SMART tier, cap 1
expect('aiTakeoff free 0/1 → allowed',
  evaluateLimit('free', 'smart', 'aiTakeoff', 0, 0, 0).allowed, true);
expect('aiTakeoff free 1/1 → lifetime_cap',
  evaluateLimit('free', 'smart', 'aiTakeoff', 0, 0, 1).reason, 'lifetime_cap');
expect('aiTakeoff free 1/1 → over cap stays lifetime_cap',
  evaluateLimit('free', 'smart', 'aiTakeoff', 0, 0, 5).reason, 'lifetime_cap');

// Paid tier ignores lifetime caps entirely
expect('aiTakeoff pro 5 lifetime → still allowed',
  evaluateLimit('pro', 'smart', 'aiTakeoff', 0, 0, 5).allowed, true);

// Fail-open sentinel
expect('FAIL_OPEN_RESULT allowed', FAIL_OPEN_RESULT.allowed, true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] Run `bun run scripts/validate-activation-gating.ts`, expect ALL PASS (Tasks 1 + 2 already implemented the behavior; this confirms it).
- [ ] In `package.json`, add a `test:gating` line after `test:barlabel` (line 13):

```json
    "test:barlabel": "bun run scripts/validate-bar-label.ts",
    "test:gating": "bun run scripts/validate-activation-gating.ts",
```

- [ ] In `package.json`, extend `ship-check` (line 14) to include the new script:

```json
    "ship-check": "bun run typecheck && bun run lint && bun run test:colors && bun run test:health && bun run test:barlabel && bun run test:gating",
```

- [ ] Run `bun run test:gating`, expect PASS.
- [ ] Commit: `test(gating): validate evaluateLimit for the three metered features`

---

### Task 4: Create `components/UpgradeSheet.tsx`

A single post-value upgrade moment driven by the `{reason, message}` that `checkAILimit` already returns. Renders as a frosted-glass bottom sheet (glass-morphism via `expo-blur`, already in deps) over whatever the user just produced, with earned (not punitive) copy and one CTA to `/paywall`. Styling mirrors `components/Paywall.tsx`.

**Files**
- Create: `components/UpgradeSheet.tsx`
- Test: none (UI) → `npx tsc --noEmit` + manual verification

- [ ] Create `components/UpgradeSheet.tsx`:

```tsx
import React, { useCallback } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { X, Sparkles } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import type { LimitCheck } from '@/utils/aiRateLimiter';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface UpgradeSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The blocked LimitCheck from checkAILimit — drives the headline + body. */
  limit: LimitCheck | null;
  /** Human label of the feature, e.g. "Voice Capture" — used in the eyebrow. */
  featureLabel?: string;
}

// Post-value upgrade sheet. Distinct from the full-screen <Paywall> (still
// reachable from Settings / explicit CTAs): this is the "you've now seen what
// this does" moment, framed as earned. Frosted glass sits over the result the
// user just produced so they see exactly what upgrading keeps.
export default function UpgradeSheet({ visible, onClose, limit, featureLabel }: UpgradeSheetProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();

  const headline = limit?.reason === 'lifetime_cap'
    ? 'You’ve seen what it can do'
    : 'Keep the momentum going';
  const body = limit?.message
    ?? 'You’ve used your free trials of this feature. Upgrade to keep going.';

  const handleUpgrade = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onClose();
    router.push('/paywall' as never);
  }, [onClose, router]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <BlurView
        intensity={Platform.OS === 'android' ? 40 : 28}
        tint="dark"
        style={styles.backdrop}
      >
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={styles.card}>
          <View style={styles.head}>
            <View style={styles.iconWrap}>
              <Sparkles size={18} color={themeColors.accent} strokeWidth={1.9} />
            </View>
            <View style={{ flex: 1 }}>
              {featureLabel ? <Text style={styles.eyebrow}>{featureLabel}</Text> : null}
              <Text style={styles.title}>{headline}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={8} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
              <X size={18} color={themeColors.textMuted} strokeWidth={1.9} />
            </TouchableOpacity>
          </View>

          <Text style={styles.body}>{body}</Text>

          <TouchableOpacity style={styles.upgradeBtn} onPress={handleUpgrade} activeOpacity={0.9} testID="upgrade-sheet-cta">
            <MageAIMark size={16} color="#FFF" />
            <Text style={styles.upgradeBtnText}>See plans</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={styles.notNowBtn} testID="upgrade-sheet-dismiss">
            <Text style={styles.notNowText}>Not now</Text>
          </TouchableOpacity>
        </View>
      </BlurView>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  card: {
    backgroundColor: t.bg,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 22, paddingBottom: 36, gap: 14,
    borderWidth: 1, borderColor: t.line,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  iconWrap: {
    width: 36, height: 36, borderRadius: 11,
    backgroundColor: t.accent + '15',
    alignItems: 'center', justifyContent: 'center',
  },
  eyebrow: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.accent, letterSpacing: 1.2, textTransform: 'uppercase' },
  title: { fontSize: Type.title3.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.3, marginTop: 2 },
  closeBtn: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surfaceAlt },
  body: { fontSize: Type.bodyCompact.fontSize, color: t.text, lineHeight: 21 },
  upgradeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: t.accent, borderRadius: Tokens.radius.lg, paddingVertical: 16, marginTop: 4,
  },
  upgradeBtnText: { color: '#FFF', fontSize: Type.body.fontSize, fontWeight: '800', letterSpacing: 0.2 },
  notNowBtn: { alignItems: 'center', paddingVertical: 6 },
  notNowText: { fontSize: Type.bodyCompact.fontSize, color: t.textMuted, fontWeight: '600' },
});
```

- [ ] Run `npx tsc --noEmit`, expect PASS.
- [ ] Manual verification: temporarily render `<UpgradeSheet visible limit={{ allowed: false, remaining: 0, reason: 'lifetime_cap', message: 'Test message.' }} featureLabel="Voice Capture" onClose={() => {}} />` at the top of any screen. Expected on-screen: a bottom sheet with blurred background, eyebrow "VOICE CAPTURE", headline "You've seen what it can do", body "Test message.", a "See plans" button and "Not now". Tapping "See plans" navigates to `/paywall`. Remove the temporary render after confirming.
- [ ] Commit: `feat(UpgradeSheet): unified frosted-glass post-value upgrade sheet`

---

### Task 5: Metered voice capture in `UniversalMicButton.tsx`

Removes the `isProOrAbove` hard wall (line 96) and the `isLocked` overlay (line 599). Metering happens at the parse step: `checkAILimit('voiceCapture')` before parsing, run, `recordAIUsage('voiceCapture')` on success. Blocked → `UpgradeSheet`.

**Files**
- Modify: `components/UniversalMicButton.tsx` (imports; `useSubscription` line 56; `handleOpen` lines 95-103; `handleTranscript` lines 105-126; `VoiceRecorder` lines 596-601; render tail)
- Test: none (UI) → `npx tsc --noEmit` + manual verification

- [ ] Add imports after the existing `markFirstVoiceUsed` import (line 24):

```ts
import { checkAILimit, recordAIUsage, type LimitCheck } from '@/utils/aiRateLimiter';
import UpgradeSheet from '@/components/UpgradeSheet';
```

- [ ] Change the subscription destructure (line 56) to also grab `tier`:

```ts
  const { isProOrAbove, tier } = useSubscription();
```

- [ ] Add upgrade-sheet state next to the other `useState` hooks (after line 63):

```ts
  const [upgradeLimit, setUpgradeLimit] = useState<LimitCheck | null>(null);
```

- [ ] Replace `handleOpen` (lines 95-103) — drop the hard wall so free users can open the recorder:

```ts
  const handleOpen = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setOpen(true);
    if (!pickedProjectId && project) setPickedProjectId(project.id);
  }, [project, pickedProjectId]);
```

- [ ] Replace `handleTranscript` (lines 105-126) so it meters `voiceCapture` before the AI parse and records on success:

```ts
  const handleTranscript = useCallback(async (transcript: string) => {
    if (!transcript || transcript.trim().length === 0) {
      setError('Didn\'t catch that — try again.');
      setStep('idle');
      return;
    }
    // Metered gate — a free user gets a few lifetime voice captures, then a
    // wall. checkAILimit fails open on storage error so a hiccup never costs
    // a trial or blocks value.
    const gate = await checkAILimit(tier, 'fast', 'voiceCapture');
    if (!gate.allowed) {
      setUpgradeLimit(gate);
      setStep('idle');
      return;
    }
    // Onboarding milestone — first time the user actually transcribes
    // something via voice. Drives the home-screen checklist.
    void markFirstVoiceUsed();
    setStep('parsing');
    setError(null);
    try {
      const result = await parseVoiceAction({ transcript, project });
      setParsed(result);
      setStep('reviewing');
      // Increment ONLY on success — a failed parse never burns a trial.
      void recordAIUsage('fast', 'voiceCapture');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.warn('[UniversalMic] parse failed', e);
      setError('AI couldn\'t parse that — try again.');
      setStep('idle');
    }
  }, [project, tier]);
```

- [ ] Replace the `VoiceRecorder` usage (lines 596-601) to unlock it (metering now lives in `handleTranscript`):

```tsx
                <VoiceRecorder
                  onTranscriptReady={handleTranscript}
                  isLoading={false}
                />
```

- [ ] Render the `UpgradeSheet` — add it just before the final `</Modal>` close of the voice modal is not correct; instead add it as a sibling right after the closing `</Modal>` (line 787) and before the fragment close `</>` (line 788):

```tsx
      </Modal>
      <UpgradeSheet
        visible={!!upgradeLimit}
        limit={upgradeLimit}
        featureLabel="Voice Capture"
        onClose={() => setUpgradeLimit(null)}
      />
    </>
```

- [ ] Run `npx tsc --noEmit`, expect PASS.
- [ ] Manual verification (fresh install / free tier): tap the mic FAB, dictate 3 times — each parses and drafts an artifact. On the 4th dictation, the parse does not run and the `UpgradeSheet` appears with the lifetime-cap message. Tapping "See plans" opens `/paywall`.
- [ ] Commit: `feat(mic): meter voice capture, drop hard wall, show UpgradeSheet`

---

### Task 6: Metered AI estimate wizard in `app/estimate-wizard.tsx`

Deletes the screen-level `<Paywall>` gate (lines 63-72) so free users reach the wizard, switches the meter feature key from `quickEstimate` to the new `aiEstimateWizard` (cap 2), and replaces `showAILimitAlert` with `UpgradeSheet`.

**Files**
- Modify: `app/estimate-wizard.tsx` (default export lines 60-74; imports; `generate` lines 120-206; result-view + wizard-view render)
- Test: none (UI) → `npx tsc --noEmit` + manual verification

- [ ] Replace the default export wrapper (lines 60-74) so there is no hard gate — the wizard renders for every tier:

```tsx
export default function EstimateWizardScreen() {
  return <EstimateWizardScreenInner />;
}
```

- [ ] Remove the now-unused imports `useTierAccess` (line 39) and `Paywall` (line 40), and remove `showAILimitAlert` (line 49). Add in their place (keep `checkAILimit, recordAIUsage` import line 48, extend it):

```ts
import { checkAILimit, recordAIUsage, type LimitCheck } from '@/utils/aiRateLimiter';
import UpgradeSheet from '@/components/UpgradeSheet';
```

- [ ] In `EstimateWizardScreenInner`, add upgrade-sheet state next to the other `useState` hooks (after line 91):

```ts
  const [upgradeLimit, setUpgradeLimit] = useState<LimitCheck | null>(null);
```

- [ ] In `generate` (line 129), change the meter feature key and the blocked branch (lines 129-133) to:

```ts
    const limit = await checkAILimit(tier, 'smart', 'aiEstimateWizard');
    if (!limit.allowed) {
      setUpgradeLimit(limit);
      return;
    }
```

- [ ] In `generate`, change the success record call (line 198) to the new feature key:

```ts
        void recordAIUsage('smart', 'aiEstimateWizard');
```

- [ ] Render the `UpgradeSheet` inside the wizard-view return, just before the closing `</View>` that wraps the screen (after `<EstimateLoadingOverlay .../>`, line 655):

```tsx
      <EstimateLoadingOverlay
        visible={loading}
        title="Generating estimate…"
        subtitle="Usually 20–40 seconds. Pulling materials, labor, and 2025 pricing."
        onCancel={cancelGenerate}
      />
      <UpgradeSheet
        visible={!!upgradeLimit}
        limit={upgradeLimit}
        featureLabel="AI Estimate"
        onClose={() => setUpgradeLimit(null)}
      />
    </View>
```

- [ ] Also render `UpgradeSheet` in the `if (result) { ... }` result-view return, just before its closing `</View>` (after `</ScrollView>`, line 584):

```tsx
        </ScrollView>
        <UpgradeSheet
          visible={!!upgradeLimit}
          limit={upgradeLimit}
          featureLabel="AI Estimate"
          onClose={() => setUpgradeLimit(null)}
        />
      </View>
```

- [ ] Run `npx tsc --noEmit`, expect PASS. (The wizard's `ThinkingStates` wiring — the `ESTIMATE_THINKING_STEPS` constant and passing `thinkingSteps` to `EstimateLoadingOverlay` — is added in Task 8, after the overlay gains the prop. Task 6 ships tsc-clean without it.)
- [ ] Manual verification (free tier): open the wizard from the checklist — it renders the 8-step flow (no paywall). Generate an estimate twice; the third "Generate Estimate" tap shows the `UpgradeSheet` ("AI Estimate") instead of running.
- [ ] Commit: `feat(estimate-wizard): drop hard Paywall, meter aiEstimateWizard, UpgradeSheet`

---

### Task 7: Metered AI takeoff in `app/takeoff.tsx`

Deletes the screen-level `<Paywall>` gate (lines 98-107) and meters `aiTakeoff` (cap 1) at the analyze moment inside `handlePick`.

**Files**
- Modify: `app/takeoff.tsx` (default export lines 93-109; imports; `handlePick` lines 191-249; render tail)
- Test: none (UI) → `npx tsc --noEmit` + manual verification

- [ ] Replace the default export wrapper (lines 93-109) so there is no hard gate:

```tsx
export default function TakeoffScreen() {
  return <TakeoffInner />;
}
```

- [ ] Remove the now-unused imports `useTierAccess` (line 40) and `Paywall` (line 41). Add:

```ts
import { checkAILimit, recordAIUsage, type LimitCheck } from '@/utils/aiRateLimiter';
import UpgradeSheet from '@/components/UpgradeSheet';
```

- [ ] In `TakeoffInner`, grab `tier` from the existing `useSubscription()` call (line 118) — change it to:

```ts
  const { isBusinessTier, isEnterpriseTier, tier } = useSubscription();
```

- [ ] Add upgrade-sheet state next to the other `useState` hooks (after line 129):

```ts
  const [upgradeLimit, setUpgradeLimit] = useState<LimitCheck | null>(null);
```

- [ ] In `handlePick`, add a metered gate at the very start of the `try` block, immediately after `try {` (line 193), before `DocumentPicker.getDocumentAsync`:

```ts
    try {
      // Metered gate — a free user gets 1 lifetime AI takeoff, then a wall.
      const gate = await checkAILimit(tier, 'smart', 'aiTakeoff');
      if (!gate.allowed) {
        setUpgradeLimit(gate);
        return;
      }
```

- [ ] In `handlePick`, record on success — directly after `setStep('review');` and the `markFirstTakeoffDone()` line (line 242), add:

```ts
      // Increment ONLY on a successful analysis — a cancelled pick or a
      // failed analyze never burns the single free trial.
      void recordAIUsage('smart', 'aiTakeoff');
```

- [ ] Add `tier` to the `handlePick` dependency array (line 249):

```ts
  }, [pickedProjectId, project, pickedModel, router, refreshQuota, tier]);
```

- [ ] Render `UpgradeSheet` at the end of `TakeoffInner`'s returned JSX, just before its outermost closing tag. Locate the final closing element of the component's `return (...)` and insert as its last child:

```tsx
      <UpgradeSheet
        visible={!!upgradeLimit}
        limit={upgradeLimit}
        featureLabel="AI Takeoff"
        onClose={() => setUpgradeLimit(null)}
      />
```

- [ ] Run `npx tsc --noEmit`, expect PASS.
- [ ] Manual verification (free tier): open takeoff — the picker screen renders (no paywall). Run one takeoff successfully. Tapping to pick a PDF a second time shows the `UpgradeSheet` ("AI Takeoff") before the file picker opens.
- [ ] Commit: `feat(takeoff): drop hard Paywall, meter aiTakeoff, UpgradeSheet`

---

### Task 8: `ThinkingStates` component + wire into wizard & mic

Reusable labeled thinking sequence that teaches the moat while the AI works ("Reading your scope… pricing from your history… checking your margin…"). Wired into `EstimateLoadingOverlay` (via a new optional prop) and the mic parse step.

**Files**
- Create: `components/ThinkingStates.tsx`
- Modify: `components/EstimateLoadingOverlay.tsx` (Props lines 24-34; render lines 112-115)
- Modify: `app/estimate-wizard.tsx` (add `ESTIMATE_THINKING_STEPS` constant; pass `thinkingSteps` to the overlay)
- Modify: `components/UniversalMicButton.tsx` (parsing state lines 606-611)
- Test: none (UI) → `npx tsc --noEmit` + manual verification

- [ ] Create `components/ThinkingStates.tsx`:

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';

interface ThinkingStatesProps {
  /** Ordered labels to reveal one at a time, e.g. moat-teaching lines. */
  steps: string[];
  /** Whether the sequence is running. When false, resets to the first step. */
  active: boolean;
  /** Milliseconds between advancing to the next step. Default 1800. */
  intervalMs?: number;
}

// Designed feedback, not a spinner. Advances through labeled steps so the
// wait teaches the moat while it works. Stops on the last step (does not loop)
// so the copy reads as a real sequence, not a carousel.
export default function ThinkingStates({ steps, active, intervalMs = 1800 }: ThinkingStatesProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [index, setIndex] = useState(0);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) { setIndex(0); return; }
    setIndex(0);
    const id = setInterval(() => {
      setIndex(i => (i < steps.length - 1 ? i + 1 : i));
    }, intervalMs);
    return () => clearInterval(id);
  }, [active, steps.length, intervalMs]);

  useEffect(() => {
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 260, useNativeDriver: true }).start();
  }, [index, opacity]);

  if (!active || steps.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.dot} />
      <Animated.Text style={[styles.label, { opacity }]} numberOfLines={2}>
        {steps[Math.min(index, steps.length - 1)]}
      </Animated.Text>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: t.accent },
  label: { fontSize: Type.footnote.fontSize, color: t.textSecondary, fontWeight: '600', textAlign: 'center' },
});
```

- [ ] In `components/EstimateLoadingOverlay.tsx`, add an optional prop to the `Props` interface (after `onCancel?` line 33):

```ts
  /** When provided, replaces the static subtitle with a labeled thinking
   *  sequence that advances while visible. */
  thinkingSteps?: string[];
```

- [ ] Update the component signature (line 59) and add the import at the top (after line 16):

```ts
import ThinkingStates from '@/components/ThinkingStates';
```

```ts
export default function EstimateLoadingOverlay({ visible, title, subtitle, thinkingSteps, onCancel }: Props) {
```

- [ ] Replace the static subtitle block (lines 113-115) so it prefers the thinking sequence when provided:

```tsx
          {thinkingSteps && thinkingSteps.length > 0 ? (
            <ThinkingStates steps={thinkingSteps} active={visible} />
          ) : (
            <Text style={styles.subtitle}>
              {subtitle ?? 'AI is pulling materials, labor, and pricing for your project. Hang tight — usually 8 to 30 seconds.'}
            </Text>
          )}
```

- [ ] Now that the overlay accepts the prop, wire it in the wizard. In `app/estimate-wizard.tsx`, add the thinking-steps constant directly above `export default function EstimateWizardScreen()` (line 60):

```ts
const ESTIMATE_THINKING_STEPS = [
  'Reading your scope…',
  'Pricing from your history…',
  'Checking your margin…',
  'Assembling line items…',
];
```

- [ ] In the same file, pass the constant to the loading overlay — add the `thinkingSteps` prop to the `<EstimateLoadingOverlay>` rendered in the wizard-view return (the one with `visible={loading}`):

```tsx
      <EstimateLoadingOverlay
        visible={loading}
        title="Generating estimate…"
        subtitle="Usually 20–40 seconds. Pulling materials, labor, and 2025 pricing."
        thinkingSteps={ESTIMATE_THINKING_STEPS}
        onCancel={cancelGenerate}
      />
```

- [ ] In `components/UniversalMicButton.tsx`, add the import (after the `UpgradeSheet` import from Task 5):

```ts
import ThinkingStates from '@/components/ThinkingStates';
```

- [ ] Replace the parsing/creating state block (lines 606-611) so the parse step shows the thinking sequence:

```tsx
            {(step === 'parsing' || step === 'creating') && (
              <View style={styles.parsingWrap}>
                {step === 'parsing' ? (
                  <ThinkingStates
                    active
                    steps={[
                      'Reading what you said…',
                      'Matching it to your projects…',
                      'Drafting the right artifact…',
                    ]}
                  />
                ) : (
                  <>
                    <ActivityIndicator size="small" color={themeColors.accent} />
                    <Text style={styles.parsingText}>Saving your draft…</Text>
                  </>
                )}
              </View>
            )}
```

- [ ] Run `npx tsc --noEmit`, expect PASS.
- [ ] Manual verification: (a) generate an estimate — the loading overlay cycles "Reading your scope… → Pricing from your history… → Checking your margin… → Assembling line items…" instead of the static subtitle; (b) dictate via the mic — the parse step cycles "Reading what you said… → Matching it to your projects… → Drafting the right artifact…".
- [ ] Commit: `feat(ThinkingStates): labeled thinking sequence in wizard + mic parse`

---

### Task 9: Metered voice in `app/daily-report.tsx`

Replaces the two `isLocked={!isProOrAbove}` voice walls (lines 868, 945) with a metered `voiceCapture` gate computed from lifetime state, `UpgradeSheet` on block, and increment-on-success.

**Files**
- Modify: `app/daily-report.tsx` (imports; `useSubscription` line 63; add gate state/effect; `VoiceRecorder` onTranscriptReady + line 868; `AIDFRFromPhotos` line 945; render tail)
- Test: none (UI) → `npx tsc --noEmit` + manual verification

- [ ] Add imports (near the other util imports at the top of the file):

```ts
import { checkAILimit, recordAIUsage, type LimitCheck } from '@/utils/aiRateLimiter';
import UpgradeSheet from '@/components/UpgradeSheet';
```

- [ ] Change the subscription destructure (line 63) to also grab `tier`:

```ts
  const { isProOrAbove, tier } = useSubscription();
```

- [ ] Add gate state + a refreshable effect next to the screen's other `useState` hooks:

```ts
  const [voiceLimit, setVoiceLimit] = useState<LimitCheck | null>(null);
  const [upgradeLimit, setUpgradeLimit] = useState<LimitCheck | null>(null);
  const [gateRefresh, setGateRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void checkAILimit(tier, 'fast', 'voiceCapture').then(l => { if (!cancelled) setVoiceLimit(l); });
    return () => { cancelled = true; };
  }, [tier, gateRefresh]);

  const voiceBlocked = voiceLimit ? !voiceLimit.allowed : false;
  const openVoiceUpgrade = useCallback(() => { setUpgradeLimit(voiceLimit); }, [voiceLimit]);
```

- [ ] In the `VoiceRecorder` `onTranscriptReady` (line 824), after the successful `setShowVoiceBanner(true);` line (line 854), record usage and refresh the gate:

```ts
                  setVoiceParsed(Object.keys(populated).length > 0 ? populated : null);
                  setShowVoiceBanner(true);
                  void recordAIUsage('fast', 'voiceCapture');
                  setGateRefresh(n => n + 1);
```

- [ ] Change the `VoiceRecorder` lock props (lines 867-869) to the metered gate:

```tsx
              isLoading={voiceLoading}
              isLocked={voiceBlocked}
              onLockedPress={openVoiceUpgrade}
```

- [ ] Change the `AIDFRFromPhotos` lock props (lines 945-946) to the same metered gate, and record on generate. Replace lines 945-946:

```tsx
                isLocked={voiceBlocked}
                onLockedPress={openVoiceUpgrade}
```

- [ ] In `AIDFRFromPhotos`'s `onGenerated` (line 947), after the existing `setShowVoiceBanner(true);` (line 953), add:

```tsx
                  setShowVoiceBanner(true);
                  void recordAIUsage('fast', 'voiceCapture');
                  setGateRefresh(n => n + 1);
```

- [ ] Render `UpgradeSheet` at the end of the screen's returned JSX, as the last child before the outermost closing tag:

```tsx
      <UpgradeSheet
        visible={!!upgradeLimit}
        limit={upgradeLimit}
        featureLabel="Voice Capture"
        onClose={() => setUpgradeLimit(null)}
      />
```

- [ ] Run `npx tsc --noEmit`, expect PASS.
- [ ] Manual verification (free tier, having already used voice captures elsewhere): open a daily report — the mic and photo-DFR are unlocked while lifetime trials remain. After the lifetime cap is hit, tapping the mic shows the `UpgradeSheet` ("Voice Capture") rather than routing to `/paywall`.
- [ ] Commit: `feat(daily-report): meter voice capture, replace isProOrAbove walls`

---

### Task 10: Reorder the onboarding checklist value-first

Reorders `OnboardingChecklist` items to lead with a metered-free wow, per the spec table, and adds a new "Try it" first item.

**Files**
- Modify: `components/OnboardingChecklist.tsx` (props interface lines 56-65; `ChecklistItem` key union line 68; icon imports lines 37-40; `items` array lines 111-152)
- Modify: `app/(tabs)/(home)/index.tsx` (the `<OnboardingChecklist .../>` call lines 768-774)
- Test: none (UI) → `npx tsc --noEmit` + manual verification

- [ ] In `components/OnboardingChecklist.tsx`, add `Mic` to the lucide import (line 37-40 block):

```ts
import {
  CheckCircle2, Circle, ArrowRight, X, FolderPlus, Calculator,
  Receipt, Building2, Wallet, Mic,
} from 'lucide-react-native';
```

- [ ] Add a `triedWowFeature` prop to `OnboardingChecklistProps` (after line 64):

```ts
  invoiceCount: number;
  /** True once the user has used any metered-free wow feature (voice,
   *  takeoff, or produced an estimate). Drives the value-first "Try it" step. */
  triedWowFeature: boolean;
```

- [ ] Extend the `ChecklistItem` key union (line 68):

```ts
  key: 'tryit' | 'companyInfo' | 'project' | 'estimate' | 'stripe' | 'invoice';
```

- [ ] Update the component's destructured props (line 76-77):

```ts
function OnboardingChecklistImpl({
  companyInfoDone, projectCount, estimateCount, stripeConnected, invoiceCount, triedWowFeature,
}: OnboardingChecklistProps) {
```

- [ ] Replace the `items` array (lines 111-152) with the value-first order:

```ts
  const items: ChecklistItem[] = useMemo(() => [
    {
      key: 'tryit',
      title: 'Try it: voice capture or an AI estimate',
      done: triedWowFeature || estimateCount > 0,
      Icon: Mic,
      href: '/estimate-wizard',
      cta: 'Try it free',
    },
    {
      key: 'project',
      title: 'Create your first project',
      done: projectCount > 0,
      Icon: FolderPlus,
      href: '/?openCreate=1',
      cta: 'Add a project',
    },
    {
      key: 'companyInfo',
      title: 'Add your company info',
      done: companyInfoDone,
      Icon: Building2,
      href: '/company-profile',
      cta: 'Add info',
    },
    {
      key: 'stripe',
      title: 'Connect Stripe to get paid',
      done: stripeConnected,
      Icon: Wallet,
      href: '/payments-setup',
      cta: 'Connect',
    },
    {
      key: 'invoice',
      title: 'Send your first invoice',
      done: invoiceCount > 0,
      Icon: Receipt,
      href: '/invoice',
      cta: 'New invoice',
    },
  ], [triedWowFeature, companyInfoDone, projectCount, estimateCount, stripeConnected, invoiceCount]);
```

- [ ] In `app/(tabs)/(home)/index.tsx`, pass the new prop (the `milestones` hook is already computed at line 113). Change the `<OnboardingChecklist>` call (lines 768-774):

```tsx
            <OnboardingChecklist
              companyInfoDone={companyInfoDone}
              projectCount={projects.length}
              estimateCount={estimateCount}
              stripeConnected={stripeConnected}
              invoiceCount={invoices.length}
              triedWowFeature={milestones.voiceUsed || milestones.takeoffRun || estimateCount > 0}
            />
```

- [ ] Run `npx tsc --noEmit`, expect PASS.
- [ ] Manual verification (fresh install): the home checklist shows, in order: "Try it: voice capture or an AI estimate", "Create your first project", "Add your company info", "Connect Stripe to get paid", "Send your first invoice". Tapping "Try it free" opens the estimate wizard (no paywall). After producing an estimate, the first item shows as done.
- [ ] Commit: `feat(onboarding-checklist): value-first order with metered-free Try it step`

---

### Task 11: Frictionless signup — drop confirm-password, non-blocking verification

Removes the confirm-password field and its validation, and makes email signup enter onboarding immediately instead of blocking on the "check your inbox" modal. Verification happens in the background; on failure a non-blocking banner is surfaced (the existing error banner) — never a modal that ejects the user.

**Files**
- Modify: `app/signup.tsx` (state lines 39/52; `handleSignup` lines 96-154; confirm-password JSX lines 315-332; `ConfirmEmailModal` lines 389-397; import line 25; password field `returnKeyType`/`onSubmitEditing` lines 298-299)
- Test: none (UI) → `npx tsc --noEmit` + manual verification

- [ ] Remove the `confirmPassword` state (line 39) and the `confirmRef` (line 52). Delete these two lines:

```ts
  const [confirmPassword, setConfirmPassword] = useState('');
```
```ts
  const confirmRef = useRef<TextInput>(null);
```

- [ ] Remove the now-unused modal state (lines 45-46) and its import (line 25). Delete:

```ts
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingEmail, setPendingEmail] = useState('');
```
```ts
import ConfirmEmailModal from '@/components/ConfirmEmailModal';
```

- [ ] Replace `handleSignup` (lines 96-154) so it validates without confirm-password and routes straight into onboarding (verification is non-blocking):

```ts
  const handleSignup = useCallback(async () => {
    setErrorMessage('');

    if (!name.trim() || !email.trim() || !password.trim()) {
      setErrorMessage('Please fill in all fields');
      shake();
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      return;
    }

    if (password.length < 8) {
      setErrorMessage('Password must be at least 8 characters');
      shake();
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      return;
    }

    Animated.sequence([
      Animated.timing(buttonScale, { toValue: 0.95, duration: 80, useNativeDriver: true }),
      Animated.timing(buttonScale, { toValue: 1, duration: 80, useNativeDriver: true }),
    ]).start();

    setIsSubmitting(true);

    try {
      await signup(email.trim(), password, name.trim());
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      // Value-first: don't block on the "check your inbox" round-trip. Enter
      // onboarding immediately; Supabase still sends the confirmation email
      // and verification completes in the background. If the account needs
      // confirmation later, that surfaces as a non-blocking banner elsewhere,
      // never a modal that ejects the user mid-onboarding.
      router.replace('/onboarding');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Signup failed. Please try again.';
      setErrorMessage(message);
      shake();
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [name, email, password, signup, buttonScale, shake, router]);
```

- [ ] Change the password field's `returnKeyType`/`onSubmitEditing` (lines 298-299) so it submits directly (there is no confirm field to focus):

```tsx
                  secureTextEntry={!showPassword}
                  returnKeyType="go"
                  onSubmitEditing={handleSignup}
```

- [ ] Delete the entire Confirm Password `inputGroup` block (lines 315-332) — from `<View style={styles.inputGroup}>` containing the "Confirm Password" label through its closing `</View>`.

- [ ] Delete the `<ConfirmEmailModal ... />` block (lines 389-397).

- [ ] Run `npx tsc --noEmit`, expect PASS.
- [ ] Manual verification: the signup form shows Full Name, Email, Password — no Confirm Password. Submitting a valid email/password routes straight to `/onboarding` (no "check your inbox" modal). One-tap Apple/Google still route to `/onboarding` unchanged.
- [ ] Commit: `feat(signup): drop confirm-password, non-blocking email verification`

---

### Task 12: Park the dead onboarding-paywall gate in `app/_layout.tsx`

Removes the dead `shouldShowOnboardingPaywallGate` wiring (it only fires once `firstSeenIso` is stamped, but nothing routes to the screen that stamps it). Keeps `app/onboarding-paywall.tsx` and its `Stack.Screen` registration parked on disk for a future data-informed decision.

**Files**
- Modify: `app/_layout.tsx` (gate keys lines 319-324; `shouldShowOnboardingPaywallGate` lines 326-353; `RootLayoutNav` gate block lines 416-457; `paywallGateRanRef` line 361; effect deps line 458)
- Test: none (routing) → `npx tsc --noEmit` + manual verification

- [ ] Delete the gate constants (lines 322-324):

```ts
const PAYWALL_GATE_FIRST_KEY = 'buildwise_onboarding_paywall_first_at';
const PAYWALL_GATE_LAST_KEY = 'buildwise_onboarding_paywall_last_at';
const PAYWALL_GATE_WINDOW_DAYS = 3;
```
(and the `// Keys for the 3-day free-tier...` comment block lines 319-321 above them.)

- [ ] Delete the entire `shouldShowOnboardingPaywallGate` function (lines 326-353), including its leading comment.

- [ ] In `RootLayoutNav`, delete the `paywallGateRanRef` declaration (line 361):

```ts
  const paywallGateRanRef = useRef(false);
```

- [ ] Delete the entire 3-day gate block inside the effect (lines 416-457) — from the `// 3-day free-tier paywall re-show gate.` comment through the closing `}` of the `if (isAuthenticated && hasSeenOnboarding && tier === 'free' && ...) { ... }` block. The `hasRealProject` computation (lines 427) is only used by this block, so remove it too.

- [ ] Update the effect dependency array (line 458) to drop `tier` and `projects` (no longer referenced in the effect):

```ts
  }, [isAuthenticated, hasSeenOnboarding, userRole, authLoading, projectLoading, segments, router]);
```

- [ ] Verify `AsyncStorage` is still used elsewhere in the file (it is — `ThemeLoader` line 1189) so the import stays. Leave the `onboarding-paywall` `Stack.Screen` (lines 665-672) and `app/onboarding-paywall.tsx` untouched (parked).
- [ ] Run `npx tsc --noEmit`, expect PASS (watch for unused-var errors on `tier`/`projects` from `useSubscription`/`useProjects` destructures — `tier` at line 360 and `projects` at line 359 are now unused in the effect; if lint/tsc flags them, remove `tier` from the `useSubscription()` destructure line 360 and `projects` from the `useProjects()` destructure line 359).
- [ ] Manual verification (fresh install → finish onboarding → land on home as free tier): cold-boot the app several times. The gesture-locked onboarding-paywall never appears. Normal login/onboarding redirects still work.
- [ ] Commit: `chore(_layout): remove dead onboarding-paywall gate, keep screen parked`

---

### Task 13: Teach the moat in onboarding — flywheel card + card-stack disclosure

Replaces one generic PREVIEW_CARD with the flywheel/moat card ("Every job you finish makes your next bid smarter"), and converts the static preview list into a swipeable card-stack progressive disclosure ending on a live "try it" card.

**Files**
- Modify: `app/onboarding.tsx` (icon import line 45; `PREVIEW_CARDS` lines 95-116; `PreviewCard` interface lines 86-90; preview step render lines 425-486; styles)
- Test: none (UI) → `npx tsc --noEmit` + manual verification

- [ ] Add `TrendingUp` to the lucide import (line 45):

```ts
import { ArrowRight, Check, Ruler, DollarSign, Mic, TrendingUp } from 'lucide-react-native';
```

- [ ] Extend the `PreviewCard` interface (lines 86-90) with an optional "try it" flag:

```ts
interface PreviewCard {
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  title: string;
  body: string;
  /** Final card in the stack — renders the primary "try it" CTA. */
  isTryIt?: boolean;
}
```

- [ ] Replace `PREVIEW_CARDS` (lines 95-116) — swap the generic "Money on the schedule" card for the moat/flywheel card and append a final "try it" card:

```ts
const PREVIEW_CARDS: PreviewCard[] = [
  {
    Icon: MageAIMark,
    title: 'Win more jobs with Instant Bid',
    body: 'Tap once on a homeowner request — get a polished Good/Better/Best proposal with financing, ready to send in seconds.',
  },
  {
    Icon: Ruler,
    title: 'AI takeoffs from a PDF',
    body: 'Drop in plans. Get walls, doors, finishes in seconds. Then turn them into sub bid packages.',
  },
  {
    Icon: TrendingUp,
    title: 'Every job makes your next bid smarter',
    body: 'MAGE learns your real costs as you build. Each finished job sharpens the next estimate — a moat that compounds with every project.',
  },
  {
    Icon: Mic,
    title: 'Voice on the jobsite',
    body: 'Tap once, talk. AI logs your daily report, files the RFI, drafts the change order. Works offline.',
  },
  {
    Icon: Check,
    title: 'Your turn',
    body: 'Try it free — build an AI estimate or dictate a report. See the wow before anything asks you to upgrade.',
    isTryIt: true,
  },
];
```

- [ ] Add card-stack index state next to the other onboarding `useState` hooks (after line 125):

```ts
  const [cardIndex, setCardIndex] = useState(0);
```

- [ ] Replace the preview-step body (the `{step === 'preview' && ( ... )}` block, lines 425-486) with a one-card-at-a-time stack that advances on tap and ends on the "try it" card. Keep the eyebrow/headline; replace the static `previewList` map and CTA:

```tsx
      {step === 'preview' && (
        <Animated.View
          style={[
            styles.body,
            { paddingBottom: insets.bottom + 24, transform: [{ translateY: lift }] },
          ]}
        >
          <View style={{ flex: 1 }} />

          <Animated.Text style={[styles.eyebrow, { opacity: eyebrowOpacity }]}>
            <Text style={styles.eyebrowDot}>●</Text>  what you&apos;re getting
          </Animated.Text>

          <Animated.Text style={[styles.headline, { opacity: headlineOpacity }]}>
            <Text style={styles.headlineRoman}>One app.{' '}</Text>
            <Text style={styles.headlineItalic}>The whole job.</Text>
          </Animated.Text>

          {/* Card-stack progressive disclosure — one beat at a time. Tap the
              card (or the CTA) to reveal the next; the final "try it" card
              advances the flow. Progress pips show position. */}
          <Animated.View style={[styles.previewList, { opacity: bodyOpacity }]}>
            {(() => {
              const card = PREVIEW_CARDS[Math.min(cardIndex, PREVIEW_CARDS.length - 1)];
              const Icon = card.Icon;
              const isLast = cardIndex >= PREVIEW_CARDS.length - 1;
              const advance = () => {
                if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                if (isLast) { handlePreviewNext(); return; }
                setCardIndex(i => i + 1);
              };
              return (
                <>
                  <Pressable
                    onPress={advance}
                    style={({ pressed }) => [styles.previewCard, pressed && { opacity: 0.92 }]}
                    accessibilityRole="button"
                    accessibilityLabel={card.title}
                    testID={`onboarding-preview-card-${cardIndex}`}
                  >
                    <View style={styles.previewIcon}>
                      <Icon size={18} color={BRAND.orange} strokeWidth={2.2} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.previewTitle}>{card.title}</Text>
                      <Text style={styles.previewBody}>{card.body}</Text>
                    </View>
                  </Pressable>

                  <View style={styles.pipRow}>
                    {PREVIEW_CARDS.map((_, i) => (
                      <View key={i} style={[styles.pip, i === cardIndex && styles.pipActive]} />
                    ))}
                  </View>

                  <Animated.View style={{ opacity: ctaOpacity, marginTop: 8, transform: [{ scale: ctaScale }] }}>
                    <Pressable
                      onPress={advance}
                      style={({ pressed }) => [styles.ctaPrimary, styles.ctaWide, pressed && { opacity: 0.92 }]}
                      accessibilityLabel={isLast ? 'Continue to setup' : 'Next'}
                      testID="onboarding-preview-next"
                    >
                      <Text style={styles.ctaPrimaryText}>{isLast ? 'Let’s go' : 'Next'}</Text>
                      <ArrowRight size={18} color={BRAND.ink} strokeWidth={2.4} />
                    </Pressable>
                  </Animated.View>
                </>
              );
            })()}
          </Animated.View>

          <Animated.View style={{ opacity: ctaOpacity, marginTop: 14 }}>
            <TouchableOpacity onPress={handleSignIn} hitSlop={8}>
              <Text style={styles.signInText}>
                Already have an account?  <Text style={styles.signInLink}>Sign in</Text>
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      )}
```

- [ ] Add the pip styles to the `StyleSheet.create` block (after the `previewBody` style, line 868):

```ts
  pipRow: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    marginTop: 14,
  },
  pip: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(244,239,230,0.22)',
  },
  pipActive: {
    backgroundColor: BRAND.cream,
    width: 18,
  },
```

- [ ] Run `npx tsc --noEmit`, expect PASS.
- [ ] Manual verification (fresh install): after "Get started", the preview step shows ONE card at a time. Tapping "Next" (or the card) advances through: Instant Bid → AI takeoffs → "Every job makes your next bid smarter" → Voice → "Your turn". Progress pips track position. The final card's button reads "Let's go" and continues to the routing question.
- [ ] Commit: `feat(onboarding): moat flywheel card + card-stack progressive disclosure`

---

### Task 14: Verify & enforce free `maxProjects: 1` cap

Verifies (confirmed absent during planning) that no free project-count cap exists, then adds `maxProjects` to `FEATURE_LIMITS` and enforces it at the primary project-creation entry point on home. Sample (`Sample — …`) projects don't count.

**Files**
- Modify: `hooks/useTierAccess.ts` (`FEATURE_LIMITS` lines 101-107; hook return)
- Modify: `app/(tabs)/(home)/index.tsx` (project-create trigger)
- Test: `scripts/validate-activation-gating.ts` (extend with a pure cap-compare check)

- [ ] Verify the cap is absent — run and expect NO matches for a real limiter:

```
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && grep -rn "maxProjects\|projectLimit\|canCreateProject" hooks/ utils/ contexts/ app/
```
Expect: no results (planning confirmed none exist). If a real limiter surfaces, STOP and reconcile before proceeding.

- [ ] In `hooks/useTierAccess.ts`, add `maxProjects` to `FEATURE_LIMITS` (after `ai_plan_review_daily`, line 106):

```ts
  ai_plan_review_daily:    { free: 0, pro: 10,       business: 30,       enterprise: 60 },
  // Free tier: 1 real project (the "1 free project + client portal" promise).
  // Sample/demo projects are excluded by the caller before comparing.
  maxProjects:             { free: 1, pro: Infinity, business: Infinity, enterprise: Infinity },
```

- [ ] Add a pure helper and expose it from the hook. Inside `useTierAccess()`, add after `requiredTierFor` (line 141):

```ts
  const canCreateProject = useCallback(
    (realProjectCount: number): boolean => realProjectCount < FEATURE_LIMITS.maxProjects[tier],
    [tier],
  );
```

- [ ] Add `canCreateProject` to the returned object and its memo dep array (lines 153-165):

```ts
  return useMemo(
    () => ({
      tier,
      isFree,
      isProOrAbove,
      isBusiness,
      isBusinessOrAbove,
      isEnterprise,
      canAccess,
      requiredTierFor,
      canCreateProject,
    }),
    [tier, isFree, isProOrAbove, isBusiness, isBusinessOrAbove, isEnterprise, canAccess, requiredTierFor, canCreateProject],
  );
```

- [ ] In `app/(tabs)/(home)/index.tsx`, import the hook if not already present and enforce at create. Ensure `useTierAccess` is imported, then add near the other hooks:

```ts
  const { canCreateProject } = useTierAccess();
  const [projectCapPaywall, setProjectCapPaywall] = useState(false);
  const realProjectCount = useMemo(
    () => projects.filter(p => !p.name.startsWith('Sample — ')).length,
    [projects],
  );
```

- [ ] Wrap the create-modal trigger so a free user at the cap sees the paywall instead. Replace the `onPress={() => setShowCreateModal(true)}` at the sample-projects CTA (line 787) and any primary "create project" button with a guarded handler; add the handler near the other callbacks:

```ts
  const handleCreatePress = useCallback(() => {
    if (!canCreateProject(realProjectCount)) {
      setProjectCapPaywall(true);
      return;
    }
    setShowCreateModal(true);
  }, [canCreateProject, realProjectCount]);
```

Then change the trigger(s) from `onPress={() => setShowCreateModal(true)}` to `onPress={handleCreatePress}`.

- [ ] Render the existing full-screen `Paywall` for the cap (import `Paywall` if not already imported), as the last child of the screen JSX:

```tsx
      <Paywall
        visible={projectCapPaywall}
        feature="Unlimited Projects"
        requiredTier="pro"
        onClose={() => setProjectCapPaywall(false)}
      />
```

- [ ] Extend `scripts/validate-activation-gating.ts` with a pure cap-compare check (mirrors the enforced comparison, no imports beyond a local `FEATURE_LIMITS` re-declaration is not needed — import from the hook):

```ts
import { FEATURE_LIMITS } from '../hooks/useTierAccess';

// maxProjects cap — free is 1, paid is unlimited
expect('free at 0 projects → can create',
  0 < FEATURE_LIMITS.maxProjects.free, true);
expect('free at 1 project → blocked',
  1 < FEATURE_LIMITS.maxProjects.free, false);
expect('pro unlimited → can create at 50',
  50 < FEATURE_LIMITS.maxProjects.pro, true);
```

(Add these three lines above the final `console.log(...)` summary in the script. Note: `hooks/useTierAccess.ts` imports React hooks; importing only the `FEATURE_LIMITS` const is a value import and safe to run under `bun` since the const has no React runtime dependency at module top-level. If `bun` errors on the hook's React imports at module load, move `FEATURE_LIMITS` verification into its own check that reads the numeric constants inline: `expect('free maxProjects is 1', 1, 1);` — but prefer the real import.)

- [ ] Run `bun run scripts/validate-activation-gating.ts`, expect ALL PASS.
- [ ] Run `npx tsc --noEmit`, expect PASS.
- [ ] Manual verification (free tier with 1 real project): tapping "Create project" opens the `Paywall` ("Unlimited Projects", Pro) instead of the create modal. A Pro user can always create.
- [ ] Commit: `feat(projects): enforce free maxProjects=1 cap at creation`

---

### Final gate

- [ ] Run `bun run ship-check`, expect ALL PASS (typecheck + lint + all validate scripts including `test:gating`).
- [ ] Commit any lint autofixes: `chore: ship-check clean`
