import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { HardHat, Megaphone, ShieldAlert, TriangleAlert, ChevronRight } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useSafety } from '@/contexts/SafetyContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export default function SafetyScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('safety_management')) {
    return (
      <Paywall
        visible={true}
        feature="Safety Management"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <SafetyHubInner />;
}

function SafetyHubInner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject } = useProjects();
  const { getJhasForProject, getToolboxTalksForProject, getIncidentsForProject, getHazardsForProject } = useSafety();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const pid = projectId ?? '';

  const tiles = useMemo(() => ([
    { key: 'jha', label: 'JHAs', icon: HardHat, count: getJhasForProject(pid).length, route: '/safety-jha' as const },
    { key: 'toolbox', label: 'Toolbox Talks', icon: Megaphone, count: getToolboxTalksForProject(pid).length, route: '/safety-toolbox' as const },
    { key: 'incidents', label: 'Incidents', icon: ShieldAlert, count: getIncidentsForProject(pid).length, route: '/safety-incidents' as const },
    { key: 'hazards', label: 'Hazard Log', icon: TriangleAlert, count: getHazardsForProject(pid).length, route: '/safety-hazards' as const },
  ]), [pid, getJhasForProject, getToolboxTalksForProject, getIncidentsForProject, getHazardsForProject]);

  if (!project) {
    return (
      <View style={[styles.container, { backgroundColor: t.bg }]}>
        <Stack.Screen options={{ title: 'Safety' }} />
        <EmptyState
          icon={<HardHat size={36} color={t.accent} strokeWidth={1.75} />}
          title="Safety is tied to a project"
          message="Open a project to run JHAs, toolbox talks, incident reports, and the hazard log for that job."
          steps={[
            'Open or create a project from the Projects tab.',
            'Tap Safety inside the project tile grid.',
            'Pick a tool below to start capturing.',
          ]}
          actionLabel="Open Projects"
          onAction={() => router.push('/(tabs)/(home)' as never)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: t.bg }]}>
      <Stack.Screen options={{ title: `Safety — ${project.name}` }} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40, gap: 12 }}>
        <View style={styles.grid}>
          {tiles.map(tile => (
            <TouchableOpacity
              key={tile.key}
              style={styles.tile}
              activeOpacity={0.85}
              onPress={() => router.push({ pathname: tile.route, params: { projectId: pid } })}
            >
              <View style={styles.tileIcon}><tile.icon size={22} color={t.accent} strokeWidth={1.75} /></View>
              <Text style={styles.tileLabel}>{tile.label}</Text>
              <View style={styles.tileFooter}>
                <Text style={styles.tileCount}>{tile.count}</Text>
                <ChevronRight size={16} color={t.textMuted} strokeWidth={1.75} />
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: {
    width: '47%', flexGrow: 1, backgroundColor: t.surface, borderRadius: Tokens.radius.lg,
    borderWidth: 1, borderColor: t.line, padding: 16, gap: 12, minHeight: 120, justifyContent: 'space-between',
  },
  tileIcon: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.accent + '14',
  },
  tileLabel: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  tileFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tileCount: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: t.accent },
});
