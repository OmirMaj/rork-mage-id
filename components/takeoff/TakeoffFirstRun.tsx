// components/takeoff/TakeoffFirstRun.tsx — the desktop takeoff's first-run
// state (wave 4, lane T2): the job has no plan sheets yet, or there is no job
// to take off at all. Desktop web only (TakeoffWorkspace mounts it).
//
// A centred 480 px column, no dashed card, no italics: one sentence of what
// this does, one primary action, one line of steps.

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Layout, Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import EstimateJobPicker from '@/components/estimate/EstimateJobPicker';

export interface TakeoffFirstRunProps {
  /** The job being taken off; null when there is none to pick yet. */
  projectId: string | null;
  /** Jobs he can pick (estimateProjectCandidates) — shown when there is no job. */
  jobs: { id: string; name: string }[];
  onPickJob: (id: string) => void;
}

export default function TakeoffFirstRun({ projectId, jobs, onPickJob }: TakeoffFirstRunProps) {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();

  if (!projectId) {
    return (
      <View style={styles.wrap} testID="takeoffws-firstrun-nojob">
        <View style={styles.col}>
          <Text style={styles.title} accessibilityRole="header">Pick a job to take off</Text>
          {jobs.length > 0 ? (
            <EstimateJobPicker label="Take off for" jobs={jobs} selectedId={undefined} onPick={onPickJob} testID="takeoffws-firstrun-jobs" />
          ) : (
            <Text style={styles.steps}>No job has an estimate yet. Start one in Estimate, then come back to measure its plans.</Text>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap} testID="takeoffws-firstrun">
      <View style={styles.col}>
        <Text style={styles.title} accessibilityRole="header">Measure a plan. Price it from your own jobs.</Text>
        <TouchableOpacity
          style={styles.primary}
          onPress={() => router.push({ pathname: '/plans', params: { projectId } })}
          accessibilityRole="button"
          accessibilityLabel="Upload plans"
          testID="takeoffws-upload-plans"
        >
          <Text style={styles.primaryText}>Upload plans</Text>
        </TouchableOpacity>
        <Text style={styles.steps}>1 Set scale (K) · 2 Pick a condition · 3 Click to measure</Text>
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Layout.gutter, backgroundColor: t.surfaceAlt },
  col: { width: '100%', maxWidth: Layout.page.auth, alignItems: 'center', gap: Layout.groupGap },
  title: { ...Type.title3, color: t.text, textAlign: 'center' },
  primary: {
    minHeight: Layout.control.md,
    minWidth: Layout.button.minWidth.lg,
    paddingHorizontal: Layout.cardPad,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.accentFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { ...Type.bodyCompactEmphasized, color: '#FFFFFF' },
  steps: { ...Type.footnote, color: t.textMuted, textAlign: 'center' },
});
