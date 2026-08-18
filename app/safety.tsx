import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { HardHat, Megaphone, ShieldAlert, TriangleAlert, ChevronRight, ClipboardCheck, BadgeCheck, FileText } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { useProjects } from '@/contexts/ProjectContext';
import { useSafety } from '@/contexts/SafetyContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
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
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isDesktop } = useResponsiveLayout();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject } = useProjects();
  const {
    getJhasForProject, getToolboxTalksForProject, getIncidentsForProject, getHazardsForProject,
    getInspectionsForProject, expiringCertifications, templates, incidents,
  } = useSafety();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const pid = projectId ?? '';

  type Tile = { key: string; label: string; icon: typeof HardHat; count: number; onPress: () => void };

  // Project-scoped tools — only meaningful once a project is selected.
  const projectTiles = useMemo<Tile[]>(() => {
    if (!project) return [];
    return [
      { key: 'jha', label: 'JHAs', icon: HardHat, count: getJhasForProject(pid).length,
        onPress: () => router.push({ pathname: '/safety-jha', params: { projectId: pid } }) },
      { key: 'toolbox', label: 'Toolbox Talks', icon: Megaphone, count: getToolboxTalksForProject(pid).length,
        onPress: () => router.push({ pathname: '/safety-toolbox', params: { projectId: pid } }) },
      { key: 'incidents', label: 'Incidents', icon: ShieldAlert, count: getIncidentsForProject(pid).length,
        onPress: () => router.push({ pathname: '/safety-incidents', params: { projectId: pid } }) },
      { key: 'hazards', label: 'Hazard Log', icon: TriangleAlert, count: getHazardsForProject(pid).length,
        onPress: () => router.push({ pathname: '/safety-hazards', params: { projectId: pid } }) },
      { key: 'inspections', label: 'Inspections', icon: ClipboardCheck, count: getInspectionsForProject(pid).length,
        onPress: () => router.push({ pathname: '/safety-inspections' as never, params: { projectId: pid } as never }) },
    ];
  }, [pid, project, router, getJhasForProject, getToolboxTalksForProject, getIncidentsForProject,
    getHazardsForProject, getInspectionsForProject]);

  // Company-scoped tools — project-independent, so they must stay reachable even
  // when no project is selected (e.g. from the desktop sidebar's /safety entry,
  // which passes no projectId). OSHA takes an OPTIONAL projectId; org-wide when
  // none is set.
  const companyTiles = useMemo<Tile[]>(() => {
    const now = new Date().toISOString();
    const oshaCount = (pid ? getIncidentsForProject(pid) : incidents).filter((i) => i.oshaRecordable).length;
    return [
      { key: 'certifications', label: 'Certifications', icon: BadgeCheck, count: expiringCertifications(now).length,
        onPress: () => router.push('/safety-certifications' as never) },
      { key: 'forms', label: 'Forms Library', icon: FileText, count: templates.length,
        onPress: () => router.push('/safety-forms' as never) },
      { key: 'osha', label: 'OSHA 300 Log', icon: ShieldAlert, count: oshaCount,
        onPress: () => router.push(
          pid
            ? ({ pathname: '/safety-osha' as never, params: { projectId: pid } as never })
            : ('/safety-osha' as never),
        ) },
    ];
  }, [pid, router, getIncidentsForProject, incidents, expiringCertifications, templates]);

  const renderTile = (tile: Tile) => (
    <TouchableOpacity key={tile.key} style={[styles.tile, isDesktop && styles.tileDesktop]} activeOpacity={0.85} onPress={tile.onPress}>
      <View style={styles.tileIcon}><tile.icon size={22} color={t.accent} strokeWidth={1.75} /></View>
      <Text style={styles.tileLabel}>{tile.label}</Text>
      <View style={styles.tileFooter}>
        <Text style={styles.tileCount}>{tile.count}</Text>
        <ChevronRight size={16} color={t.textMuted} strokeWidth={1.75} />
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: t.bg }]}>
      <Stack.Screen options={{ title: project ? `Safety — ${project.name}` : 'Safety' }} />
      <ScrollView {...fabScroll} contentContainerStyle={[{ padding: 20, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE, gap: 12 }, isDesktop && styles.contentDesktop]}>
        {project ? (
          <>
            <Text style={styles.sectionLabel}>Project</Text>
            <View style={styles.grid}>{projectTiles.map(renderTile)}</View>
          </>
        ) : (
          <View style={styles.projectPrompt}>
            <HardHat size={28} color={t.accent} strokeWidth={1.75} />
            <Text style={styles.projectPromptTitle}>Open a project for on-site tools</Text>
            <Text style={styles.projectPromptText}>
              JHAs, toolbox talks, incidents, the hazard log, and inspections are tied to a specific job.
              The company-wide tools below don&apos;t need a project.
            </Text>
            <TouchableOpacity style={styles.projectPromptBtn} activeOpacity={0.85} onPress={() => router.push('/(tabs)/(home)' as never)}>
              <Text style={styles.projectPromptBtnText}>Open Projects</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.sectionLabel}>Company-wide</Text>
        <View style={styles.grid}>{companyTiles.map(renderTile)}</View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  // Record lists (certs / incidents / inspections / forms) — desktop gets the
  // viewport rather than a 760px column stranded in the middle.
  contentDesktop: { width: '100%', maxWidth: 1200, alignSelf: 'center' as const },
  sectionLabel: { fontSize: Type.caption1.fontSize, fontWeight: '800' as const, color: t.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  projectPrompt: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.lg, borderWidth: 1, borderColor: t.line,
    padding: 20, gap: 10, alignItems: 'flex-start' as const,
  },
  projectPromptTitle: { fontSize: Type.subhead.fontSize, fontWeight: '800' as const, color: t.text },
  projectPromptText: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 19 },
  projectPromptBtn: { marginTop: 4, paddingHorizontal: 16, paddingVertical: 10, borderRadius: Tokens.radius.md, backgroundColor: t.accent + '14' },
  projectPromptBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.accent },
  // Desktop overrides the 47% two-up grid so tiles pack 4-5 across the wider
  // content column instead of stretching to ~570px each.
  tileDesktop: { width: 'auto' as const, flexBasis: 240, maxWidth: 340 },
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
