// app/tutorials.tsx — Help → Tutorials: every learn-by-doing tutorial in one
// place, practised on a sample job.
//
// WHY A HUB AND NOT A SLIDESHOW. The old components/Tutorial.tsx was 1,012
// lines of mock screens nobody could act on, reached from one row buried in
// Settings. A tutorial here starts the real thing: the coach-mark engine
// (components/tutorial/TutorialHost) opens the sample job, dims the screen
// around one real control, and moves on only when the app's real success
// point fires. This screen is just the menu.
//
// WHAT IT SHOWS (the rules are pure, in utils/tutorial/entryPoints.ts)
//   • cards grouped On site / Money / Schedule / Your client / Estimating,
//     filtered by persona: a field seat sees daily report and punch only; a
//     client or property manager sees an explanation and no cards;
//   • each card: title, time, 'Ends with: …', a status pill (New /
//     Continue · step 3 of 8 / Practised · Replay) and a tier tag when the
//     practice pass is what lets him run it ('Business — practise free on
//     the sample');
//   • Continue resumes a paused run from its last checkpoint — ONLY when he
//     taps it. Nothing here, or anywhere, resumes by itself.
//
// Doors in: the Brain Help sheet (components/HelpFab), Settings → Help &
// support, the desktop sidebar, universal search, and mageid://tutorials.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarDays, Calculator, ClipboardCheck, Receipt, Users, type LucideIcon } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { Card } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/StatusPill';
import { BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import type { TutorialGroup, TutorialId } from '@/utils/tutorial/types';
import type { CardStatus } from '@/utils/tutorial/offers';
import { hubEmptyReason, hubSections, type HubCard, type HubSection } from '@/utils/tutorial/entryPoints';
import { TUTORIAL_PRACTICE_PASS } from '@/utils/tutorial/practicePass';
import { isFieldOnlyUser } from '@/utils/tutorial/sandboxCore';
import { useTutorialProgress } from '@/utils/tutorial/progress';
import { startTutorial } from '@/utils/tutorial/store';
import { track, AnalyticsEvents } from '@/utils/analytics';

export const TUTORIALS_HUB_INTRO = 'Practise on a sample job — each under a minute. Nothing goes to a client or a sub.';

const GROUP_ICON: Record<TutorialGroup, LucideIcon> = {
  site: ClipboardCheck,
  money: Receipt,
  schedule: CalendarDays,
  client: Users,
  bid: Calculator,
};

/** The card's action word follows its pill. */
function actionLabel(status: CardStatus, duration: string): string {
  if (status.kind === 'continue') return 'Continue';
  if (status.kind === 'practised') return 'Replay';
  return `Start · ${duration}`;
}

function pillTone(status: CardStatus): 'neutral' | 'success' | 'info' {
  if (status.kind === 'practised') return 'success';
  if (status.kind === 'continue') return 'info';
  return 'neutral';
}

export interface TutorialsHubViewProps {
  sections: readonly HubSection[];
  /** Shown instead of cards (client personas, or nothing available). */
  emptyReason: string | null;
  /** The tutorial whose start is in flight (its card shows a spinner). */
  busyId: TutorialId | null;
  onStart: (card: HubCard) => void;
}

/** The hub's presentation, separate from its data so the smoke test can
 *  render every persona's version without the 16-provider stack. */
export function TutorialsHubView({ sections, emptyReason, busyId, onStart }: TutorialsHubViewProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // Two columns once a row of two cards still leaves each ~360 pt.
  const twoUp = width >= 768;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]}
      testID="tutorials-hub"
    >
      <View style={styles.inner}>
        <Text style={[Type.subheadEmphasized, { color: colors.text }]} testID="tutorials-hub-intro">
          {TUTORIALS_HUB_INTRO}
        </Text>
        <Text style={[Type.footnote, styles.introSub, { color: colors.textSecondary }]}>
          Each one runs in the real screens on a sample job. You do the real thing; the app points the way and moves on when it worked.
        </Text>

        {emptyReason ? (
          <View style={[styles.empty, { borderColor: colors.line, backgroundColor: colors.surface }]} testID="tutorials-hub-empty">
            <Text style={[Type.footnote, { color: colors.textSecondary }]}>{emptyReason}</Text>
          </View>
        ) : null}

        {sections.map(section => {
          const Icon = GROUP_ICON[section.group];
          return (
            <View key={section.group} style={styles.section} testID={`tutorials-group-${section.group}`}>
              <View style={styles.sectionHead}>
                <Icon size={16} strokeWidth={1.75} color={colors.textSecondary} />
                <Text style={[Type.footnoteEmphasized, styles.sectionLabel, { color: colors.textSecondary }]}>
                  {section.label.toUpperCase()}
                </Text>
              </View>
              <View style={[styles.grid, twoUp && styles.gridTwoUp]}>
                {section.cards.map(card => {
                  const busy = busyId === card.id;
                  const action = actionLabel(card.status, card.duration);
                  // The column width sits on a plain wrapper: a pressable Card
                  // is an Animated.View around its Pressable, so a flexBasis
                  // passed as the Card's style would size the inner layer.
                  return (
                    <View key={card.id} style={twoUp ? styles.cardTwoUp : undefined}>
                    <Card
                      pressable
                      onPress={() => onStart(card)}
                      accessibilityLabel={`${card.title}. ${card.status.label}. ${action}`}
                      testID={`tutorial-card-${card.id}`}
                    >
                      <View style={styles.cardHead}>
                        <Text style={[Type.bodyCompactEmphasized, styles.cardTitle, { color: colors.text }]}>{card.title}</Text>
                        <StatusPill
                          label={card.status.label}
                          tone={pillTone(card.status)}
                          size="compact"
                          testID={`tutorial-card-${card.id}-status`}
                        />
                      </View>
                      <Text style={[Type.footnote, { color: colors.textSecondary }]}>
                        {card.duration} · Ends with: {card.endsWith}
                      </Text>
                      {card.tierTag ? (
                        <Text style={[Type.caption1, styles.tierTag, { color: colors.textSecondary }]} testID={`tutorial-card-${card.id}-tier`}>
                          {card.tierTag}
                        </Text>
                      ) : null}
                      <View style={styles.cardFoot}>
                        {busy ? <ActivityIndicator size="small" color={colors.textSecondary} /> : null}
                        <Text style={[Type.footnoteEmphasized, { color: colors.accentLabel }]}>
                          {busy ? 'Opening the sample job…' : action}
                        </Text>
                      </View>
                    </Card>
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

export default function TutorialsScreen() {
  const { projects, userRole } = useProjects();
  const { user } = useAuth();
  const { canAccess } = useTierAccess();
  const { progress } = useTutorialProgress();
  const fieldOnly = useMemo(() => isFieldOnlyUser(projects, user?.id ?? null), [projects, user?.id]);

  const sections = useMemo(
    () => hubSections({ persona: userRole, fieldOnly, progress, canAccess, practicePass: TUTORIAL_PRACTICE_PASS }),
    [userRole, fieldOnly, progress, canAccess],
  );
  const emptyReason = hubEmptyReason(userRole, sections);

  // tutorial_offered{entry:'hub'} once per tutorial per visit — the funnel's
  // denominator for "saw it in the hub" vs "started it".
  const offered = useRef(new Set<TutorialId>());
  useEffect(() => {
    for (const s of sections) {
      for (const c of s.cards) {
        if (offered.current.has(c.id)) continue;
        offered.current.add(c.id);
        track(AnalyticsEvents.TUTORIAL_OFFERED, { tutorial_id: c.id, entry: 'hub' });
      }
    }
  }, [sections]);

  const [busyId, setBusyId] = useState<TutorialId | null>(null);
  const busyRef = useRef(false);
  const onStart = useCallback(async (card: HubCard) => {
    // One start at a time: the host drops a second start while booting, but a
    // double tap would still flash two spinners.
    if (busyRef.current) return;
    busyRef.current = true;
    setBusyId(card.id);
    try {
      // 'Continue' is the same call: the host resumes a paused run of the same
      // tutorial from its checkpoint instead of restarting it.
      await startTutorial(card.id, { entry: 'hub' });
    } finally {
      busyRef.current = false;
      setBusyId(null);
    }
  }, []);

  return <TutorialsHubView sections={sections} emptyReason={emptyReason} busyId={busyId} onStart={onStart} />;
}

const styles = StyleSheet.create({
  content: { paddingTop: 16 },
  // No page-width literal here: on desktop the page frame caps the column (the
  // route's 'form' entry in utils/desktopPage), and the desktop-layout ratchet
  // counts every hand-rolled maxWidth.
  inner: { width: '100%', alignSelf: 'center', paddingHorizontal: 16, gap: 8 },
  introSub: { marginBottom: 8 },
  empty: { borderWidth: 1, borderRadius: Tokens.radius.lg, padding: 16, marginTop: 8 },
  section: { marginTop: 16, gap: 8 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionLabel: { letterSpacing: 0.6 },
  grid: { gap: 10 },
  gridTwoUp: { flexDirection: 'row', flexWrap: 'wrap' },
  // Two columns whenever each card still gets 320 pt; a fixed basis instead of
  // a percentage (the desktop-layout ratchet counts percentage tiles).
  cardTwoUp: { flexBasis: 320, flexGrow: 1 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 4 },
  cardTitle: { flex: 1 },
  tierTag: { marginTop: 6, fontWeight: '600' },
  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
});
