// app/skills-certificates.tsx — "Certificates": his MAGE ID app-skills
// certificates, and the skills he has not earned yet.
//
// WHAT IT SHOWS
//   • "{n} of 15 skills" — n = topics whose newest certificate is not revoked
//     (utils/learn/certificateDoc earnedCount; the Settings row uses the same).
//   • one CertificateCard per earned topic, newest first, each with Save PDF,
//     Share link and Remove from profile;
//   • every topic not earned yet, in hub order, with its next step:
//       "Take the skills check" once its tutorial is practised (checkAvailability
//       'open'), "Take the tutorial" while it is locked, and "Passed, not issued
//       yet" + "Try again" for a pass kept on this phone (a pending award).
//     A topic with no tutorial in this build (checkAvailability 'hidden') is
//     left out: a button to a check that does not exist would be a dead end.
//
// HONESTY. Only server rows are certificates: the list is read from the
// table (useMyCertificates). A pending pass is never drawn as a certificate.
// A failed read says so with "Try again"; it never falls through to the empty
// state. Pending awards are sent again when this screen gains focus and when
// the app comes back to the foreground while it is open (the same shared
// loop the skills check uses, so the two can never send one pass twice).
//
// Phone: one column, BRAIN_FAB_CLEARANCE under the last row. Desktop web: the
// 'form' frame (utils/desktopPage), cards two-up at ≥ 768 pt with a fixed
// flexBasis (the desktop-layout ratchet counts percentage tiles).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useBreakpointWidth } from '@/utils/useBreakpointWidth';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/contexts/ThemeContext';
import { useT } from '@/contexts/LanguageContext';
import { Type } from '@/constants/typography';
import { Layout } from '@/constants/designTokens';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { notice } from '@/components/animations/NailItToast';
import { BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { CertificateCard } from '@/components/learn/CertificateCard';
import { TUTORIAL_DEFS } from '@/utils/tutorial/defs';
import { useTutorialProgress } from '@/utils/tutorial/progress';
import { startTutorial } from '@/utils/tutorial/store';
import { QUIZ_BANKS } from '@/utils/learn/quizBank';
import { skillTopic } from '@/utils/learn/topics';
import { checkAvailability } from '@/utils/learn/quizEngine';
import { loadSkillsProgress, retryPendingAwards } from '@/utils/learn/skillsProgress';
import { SKILL_CERTIFICATES_QUERY_ROOT, awardSkillCertificate, useMyCertificates } from '@/utils/learn/certificateClient';
import { SKILL_TOPIC_COUNT, earnedCertificates, topicsNotEarned } from '@/utils/learn/certificateDoc';
import type { SkillTopicId } from '@/utils/learn/types';

type NextStep = 'pending' | 'check' | 'tutorial';

export default function SkillsCertificatesScreen() {
  const { colors } = useTheme();
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { isDesktop, sidebarWidth } = useResponsiveLayout();
  const twoUp = useBreakpointWidth() >= 768; // a native phone is a phone sideways too (utils/nativePhone)
  // The grid's width: a card never grows past half of it (minus the 12 gap), so
  // a lone last card keeps its column instead of stretching. Until onLayout
  // reports, it is seeded from the frame's own arithmetic (the desktop 'form'
  // column beside the sidebar, else the window, minus the 2 × 16 padding), so
  // the first web frame is already capped instead of flashing full width.
  const [measuredGridWidth, setGridWidth] = useState(0);
  const columnWidth = isDesktop ? Math.min(width - sidebarWidth, Layout.page.form) : width;
  const gridWidth = measuredGridWidth > 0 ? measuredGridWidth : columnWidth - 32;
  const halfColumn = twoUp ? { maxWidth: (gridWidth - 12) / 2 } : null;
  const queryClient = useQueryClient();
  const certsQ = useMyCertificates();
  const { progress } = useTutorialProgress();

  // Pending passes on this phone (current quiz version only: an older one can
  // never be issued, and pendingFor never offers it either).
  const [pending, setPending] = useState<ReadonlySet<SkillTopicId>>(new Set());
  const [retrying, setRetrying] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const loadPending = useCallback(async () => {
    const p = await loadSkillsProgress();
    if (!mounted.current) return;
    setPending(new Set(p.pending.filter(e => skillTopic(e.topic)?.quizVersion === e.quizVersion).map(e => e.topic)));
  }, []);

  const retryPending = useCallback(async (announce: boolean) => {
    setRetrying(true);
    try {
      const outcomes = await retryPendingAwards(awardSkillCertificate);
      if (outcomes.some(o => o.result.ok && o.result.passed)) {
        void queryClient.invalidateQueries({ queryKey: [SKILL_CERTIFICATES_QUERY_ROOT] });
      }
      if (announce) {
        const refused = outcomes.find(o => !o.result.ok);
        if (refused && !refused.result.ok) notice(refused.result.message, { icon: 'alert' });
      }
    } finally {
      await loadPending();
      if (mounted.current) setRetrying(false);
    }
  }, [queryClient, loadPending]);

  useFocusEffect(useCallback(() => {
    void retryPending(false);
    const sub = AppState.addEventListener('change', s => { if (s === 'active') void retryPending(false); });
    return () => sub.remove();
  }, [retryPending]));

  const certs = certsQ.data;
  const earned = useMemo(() => (certs ? earnedCertificates(certs) : []), [certs]);
  const notEarned = useMemo(() => {
    if (!certs) return [];
    const rows: { id: SkillTopicId; label: string; step: NextStep }[] = [];
    for (const topic of topicsNotEarned(certs)) {
      if (pending.has(topic.id)) { rows.push({ id: topic.id, label: topic.label, step: 'pending' }); continue; }
      const a = checkAvailability(topic.id, progress, TUTORIAL_DEFS, certs, QUIZ_BANKS);
      if (a.kind === 'open') rows.push({ id: topic.id, label: topic.label, step: 'check' });
      else if (a.kind === 'locked') rows.push({ id: topic.id, label: topic.label, step: 'tutorial' });
    }
    return rows;
  }, [certs, pending, progress]);

  const openCheck = useCallback((id: SkillTopicId) => {
    router.push({ pathname: '/skills-check', params: { topic: id } });
  }, [router]);

  const failed = !certs && certsQ.isError;
  const loading = !certs && !certsQ.isError;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]}
      testID="skills-certificates"
    >
      <View style={styles.inner}>
        {loading ? (
          <View style={styles.loading} testID="skills-certificates-loading">
            <ActivityIndicator color={colors.textSecondary} />
          </View>
        ) : null}

        {failed ? (
          <Card testID="skills-certificates-error">
            <Text style={[Type.bodyCompact, { color: colors.text }]}>
              {t('settings.learn.certsLoadError', "Couldn't load your certificates.")}
            </Text>
            <Button
              label={t('settings.learn.tryAgain', 'Try again')}
              variant="secondary"
              size="sm"
              onPress={() => { void certsQ.refetch(); }}
              containerStyle={styles.blockAction}
              testID="skills-certificates-retry"
            />
          </Card>
        ) : null}

        {certs ? (
          <Text style={[Type.subheadEmphasized, { color: colors.text }]} testID="skills-certificates-progress">
            {t('settings.learn.certsProgress', '{n} of {total} skills', { n: String(earned.length), total: String(SKILL_TOPIC_COUNT) })}
          </Text>
        ) : null}

        {certs && earned.length === 0 ? (
          <Card testID="skills-certificates-empty">
            <Text style={[Type.bodyCompact, { color: colors.text }]}>
              {t('settings.learn.certsEmpty', 'No certificates yet. Each tutorial ends with a short skills check.')}
            </Text>
            <Button
              label={t('settings.learn.seeTutorials', 'See tutorials')}
              variant="secondary"
              size="sm"
              onPress={() => router.push('/tutorials')}
              containerStyle={styles.blockAction}
              testID="skills-certificates-see-tutorials"
            />
          </Card>
        ) : null}

        {earned.length > 0 ? (
          <View
            style={[styles.grid, twoUp && styles.gridTwoUp]}
            onLayout={twoUp ? (e) => setGridWidth(e.nativeEvent.layout.width) : undefined}
            testID="skills-certificates-list"
          >
            {earned.map(cert => {
              const topic = skillTopic(cert.topic);
              if (!topic) return null;
              // The column width sits on a plain wrapper, like the tutorials hub.
              return (
                <View key={cert.id} style={twoUp ? [styles.cardTwoUp, halfColumn] : undefined}>
                  <CertificateCard cert={cert} topic={topic} actions />
                </View>
              );
            })}
          </View>
        ) : null}

        {notEarned.length > 0 ? (
          <View style={styles.section} testID="skills-certificates-not-earned">
            <Text style={[Type.footnoteEmphasized, styles.sectionLabel, { color: colors.textSecondary }]}>
              {t('settings.learn.notEarned', 'Not earned yet')}
            </Text>
            <Card pad="none">
              {notEarned.map((row, i) => (
                <View
                  key={row.id}
                  style={[styles.topicRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line }]}
                  testID={`skills-certificates-topic-${row.id}`}
                >
                  <View style={styles.topicText}>
                    <Text style={[Type.bodyCompactEmphasized, { color: colors.text }]}>{row.label}</Text>
                    {row.step === 'pending' ? (
                      <Text style={[Type.footnote, { color: colors.warningLabel }]} testID={`skills-certificates-topic-${row.id}-pending`}>
                        {t('settings.learn.pendingIssue', 'Passed, not issued yet')}
                      </Text>
                    ) : null}
                  </View>
                  {row.step === 'pending' ? (
                    <Button
                      label={t('settings.learn.tryAgain', 'Try again')}
                      variant="secondary"
                      size="sm"
                      loading={retrying}
                      disabled={retrying}
                      onPress={() => { void retryPending(true); }}
                      testID={`skills-certificates-topic-${row.id}-retry`}
                    />
                  ) : row.step === 'check' ? (
                    <Button
                      label={t('settings.learn.takeCheck', 'Take the skills check')}
                      variant="secondary"
                      size="sm"
                      onPress={() => openCheck(row.id)}
                      testID={`skills-certificates-topic-${row.id}-check`}
                    />
                  ) : (
                    <Button
                      label={t('settings.learn.takeTutorial', 'Take the tutorial')}
                      variant="ghost"
                      size="sm"
                      onPress={() => { void startTutorial(row.id, { entry: 'hub' }); }}
                      testID={`skills-certificates-topic-${row.id}-tutorial`}
                    />
                  )}
                </View>
              ))}
            </Card>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 16 },
  // No page-width literal: on desktop the 'form' frame caps the column.
  inner: { width: '100%', alignSelf: 'center', paddingHorizontal: 16, gap: 12 },
  loading: { paddingVertical: 32, alignItems: 'center' },
  blockAction: { marginTop: 12, alignSelf: 'flex-start' },
  grid: { gap: 12 },
  gridTwoUp: { flexDirection: 'row', flexWrap: 'wrap' },
  cardTwoUp: { flexBasis: 320, flexGrow: 1 },
  section: { marginTop: 8, gap: 8 },
  sectionLabel: { letterSpacing: 0.6, textTransform: 'uppercase' },
  topicRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, minHeight: 56 },
  topicText: { flex: 1, gap: 2 },
});
