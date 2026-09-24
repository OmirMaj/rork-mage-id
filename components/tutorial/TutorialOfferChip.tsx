// components/tutorial/TutorialOfferChip.tsx — the contextual offer: one
// dismissible line under a screen's header, the first time he opens that
// screen on a REAL job.
//
//   'New here? Practise once on a sample job · 35 s'   [Show me] [×]
//
// It is the one door that shows on real work, so it is the one most able to
// nag. Every rule that keeps it quiet lives in utils/tutorial/offers.ts
// (shouldOfferChip): once per tutorial, × is forever, at most one chip a day
// across the whole app, never on a sample, never mid-draft, never with the
// keyboard up, never while a run is live, and never for a tutorial he has
// practised or walked out of. This component only feeds it facts.
//
// LATCHED. The decision is taken once per mount: the moment the chip is shown
// it is recorded (markTutorialChipShown), and that record is itself one of the
// reasons shouldOfferChip says no — so re-evaluating would hide the chip a
// frame after it appeared. After the latch only the live conditions (a run
// started, the keyboard came up, he started a draft) hide it again.
//
// A screen mounts it with one line, e.g. in app/daily-report.tsx:
//   <TutorialOfferChip tutorialId="daily-report-voice" projectId={projectId} midDraft={isDirty} />
// Paywalled screens pass screenOpened={false} until the gate lets him in, so
// a paywalled user gets the Paywall's 'Try it on a sample first' instead.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useGlobalSearchParams, usePathname } from 'expo-router';
import { X } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { Button } from '@/components/ui/Button';
import { isSampleProject } from '@/utils/sampleGuard';
import type { TutorialId } from '@/utils/tutorial/types';
import { TUTORIAL_DEFS } from '@/utils/tutorial/defs';
import { shouldOfferChip } from '@/utils/tutorial/offers';
import { chipCopy, chipReturnTo } from '@/utils/tutorial/entryPoints';
import { isFieldOnlyUser, localDay } from '@/utils/tutorial/sandboxCore';
import { dismissTutorialChip, markTutorialChipShown, useTutorialProgress } from '@/utils/tutorial/progress';
import { startTutorial, useTutorialRun } from '@/utils/tutorial/store';
import { track, AnalyticsEvents } from '@/utils/analytics';

export interface TutorialOfferChipProps {
  /** The tutorial this screen offers. */
  tutorialId: TutorialId;
  /** The project the screen is showing. The chip never shows on a sample, and
   *  never before the project is known (projects still loading). */
  projectId: string | null | undefined;
  /** False while the screen is paywalled / gated. Default true. */
  screenOpened?: boolean;
  /** True once he has typed or captured anything on this screen. Default false. */
  midDraft?: boolean;
  /** Where the finale's 'Back to <job>' returns. Default: this screen, with
   *  its current params. */
  returnTo?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Keyboard up/down; always false on web (no soft-keyboard events there). */
function useKeyboardUp(): boolean {
  const [up, setUp] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setUp(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setUp(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return up;
}

const selectRunActive = (s: { status: string }) => s.status === 'running';

export function TutorialOfferChip({
  tutorialId,
  projectId,
  screenOpened = true,
  midDraft = false,
  returnTo,
  style,
  testID = 'tutorial-offer-chip',
}: TutorialOfferChipProps) {
  const { colors } = useTheme();
  const { projects, projectsLoaded, userRole } = useProjects();
  const { user } = useAuth();
  const { progress, loaded } = useTutorialProgress();
  const runActive = useTutorialRun(selectRunActive);
  const keyboardUp = useKeyboardUp();
  const pathname = usePathname();
  const params = useGlobalSearchParams();

  const def = TUTORIAL_DEFS[tutorialId];
  const project = useMemo(() => (projectId ? projects.find(p => p.id === projectId) ?? null : null), [projects, projectId]);
  // An unknown project (not loaded yet, or not his) is treated as "don't know
  // yet", never as real: offering on a sample that hadn't loaded would be the
  // one chip that practises on the thing it is sitting on.
  const projectIsSample = !project || isSampleProject(project);
  const fieldOnly = useMemo(() => isFieldOnlyUser(projects, user?.id ?? null), [projects, user?.id]);

  const [shown, setShown] = useState(false);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (shown || closed || !def || !loaded || !projectsLoaded) return;
    const today = localDay(new Date());
    const offer = shouldOfferChip(progress, {
      tutorialId,
      persona: userRole,
      fieldOnly,
      projectIsSample,
      screenOpened,
      midDraft,
      keyboardUp,
      runActive,
      today,
    });
    if (!offer) return;
    setShown(true);
    void markTutorialChipShown(tutorialId, today);
    track(AnalyticsEvents.TUTORIAL_OFFERED, { tutorial_id: tutorialId, entry: 'chip' });
  }, [shown, closed, def, loaded, projectsLoaded, progress, tutorialId, userRole, fieldOnly, projectIsSample, screenOpened, midDraft, keyboardUp, runActive]);

  const onDismiss = useCallback(() => {
    setClosed(true);
    // × is forever for this tutorial (offers.ts reads dismissedAt).
    void dismissTutorialChip(tutorialId);
  }, [tutorialId]);

  const onShowMe = useCallback(() => {
    setClosed(true);
    void startTutorial(tutorialId, { entry: 'chip', returnTo: returnTo ?? chipReturnTo(pathname, params) });
  }, [tutorialId, returnTo, pathname, params]);

  if (!def || !shown || closed || runActive || keyboardUp || midDraft) return null;

  return (
    <View
      testID={testID}
      style={[styles.chip, { backgroundColor: colors.surface, borderColor: colors.line }, style]}
    >
      <Text style={[Type.footnote, styles.copy, { color: colors.text }]} numberOfLines={2}>
        {chipCopy(def)}
      </Text>
      <Button label="Show me" variant="secondary" size="sm" onPress={onShowMe} testID={`${testID}-show`} />
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Don't offer this tutorial again"
        hitSlop={8}
        style={styles.close}
        testID={`${testID}-dismiss`}
      >
        <X size={16} strokeWidth={2} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: Tokens.radius.md,
    paddingLeft: 14,
    paddingRight: 4,
    paddingVertical: 6,
    marginHorizontal: 16,
    marginVertical: 8,
  },
  copy: { flex: 1, fontWeight: '600' },
  close: {
    width: Tokens.touchTarget.min,
    height: Tokens.touchTarget.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default TutorialOfferChip;
