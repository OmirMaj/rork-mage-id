import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { HardHat, Megaphone, ShieldAlert, TriangleAlert, ChevronRight, ClipboardCheck, BadgeCheck, FileText, ArrowLeftRight } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { useProjects } from '@/contexts/ProjectContext';
import { useSafety } from '@/contexts/SafetyContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { useProjectRole, useProjectRoleState, type ProjectRoleState } from '@/hooks/useProjectRole';
import { collaboratorMayAccess } from '@/utils/collaboratorAccess';
import type { ProjectRole } from '@/utils/projectRole';
import Paywall from '@/components/Paywall';
import { ToolProjectPicker } from '@/components/ToolScreenChrome';
import { Button } from '@/components/ui';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { buildOsha300Log, currentOshaYear, incidentsForOwnEstablishment } from '@/utils/safety/oshaLog';
import { todayCalendarDay } from '@/utils/calendarDate';
import { safetySeatFor, type SafetySeat } from '@/utils/safety/osha';
import type { Project } from '@/types';

/**
 * What an access wall shows for a project-scoped safety screen, per the
 * wave-3 gating contract: a spinner ONLY while the role read is in flight
 * (an invited foreman's free tier would otherwise flash a Business paywall
 * over the job he was invited to), a retry when that read failed, and the
 * paywall — which says why — once the answer is in and it is "no".
 * Shared by the hub and the JHA / toolbox / hazard / inspection screens.
 */
export function SafetyAccessBlocked({ roleState, onClose }: { roleState: ProjectRoleState; onClose: () => void }) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  if (roleState.isLoading) {
    return (
      <View style={[styles.gateWrap, { backgroundColor: t.bg }]} testID="safety-gate-checking">
        <ActivityIndicator color={t.accent} />
        <Text style={styles.gateText}>Checking your access to this job…</Text>
      </View>
    );
  }
  if (roleState.isError) {
    return (
      <View style={[styles.gateWrap, { backgroundColor: t.bg }]} testID="safety-gate-error">
        <Text style={styles.gateTitle}>Could not check your access to this job</Text>
        <Text style={styles.gateText}>
          MAGE could not load who is on this project, so it cannot tell whether your GC invited you to its safety records. Check your connection and try again.
        </Text>
        <Button label="Try again" onPress={() => { void roleState.refetch(); }} variant="secondary" />
      </View>
    );
  }
  return <Paywall visible={true} feature="Safety Management" requiredTier="business" onClose={onClose} />;
}

/**
 * This person's seat on one job's safety records — owner, crew (field /
 * editor), viewer, or still checking. The screens use it to disable, with the
 * reason, what the project-scoped safety RLS refuses (delete is owner-only; a
 * viewer files nothing), instead of letting the offline queue drop it.
 */
export function useSafetySeat(projectId: string | undefined): SafetySeat {
  const { user } = useAuth();
  const { getProject } = useProjects();
  const role = useProjectRole(projectId);
  const project = projectId ? getProject(projectId) : undefined;
  return safetySeatFor({ ownerUserId: project?.ownerUserId, userId: user?.id, role, myRole: project?.myRole ?? null });
}

/** Shared projects on which this person's invite opens Safety. */
function invitedSafetyProjects(projects: Project[]): Project[] {
  return projects.filter(p => collaboratorMayAccess((p.myRole ?? null) as ProjectRole, 'safety_management'));
}

/**
 * The hub's gate. The hub is not scoped to one project, so useProjectAccess
 * alone cannot answer it (audit #170): it opens on his own Business tier, on
 * the collaborator grant for the project in the URL, or — with no project —
 * when he is an accepted collaborator on at least one job, in which case the
 * picker lists only those jobs.
 */
function useSafetyHubAccess(projectId: string | undefined) {
  const { canAccess: canAccessProject, canAccessOwnTier } = useProjectAccess(projectId);
  const roleState = useProjectRoleState(projectId);
  const { projects } = useProjects();
  const invited = useMemo(() => invitedSafetyProjects(projects), [projects]);
  const canAccess = useCallback(
    (feature: 'safety_management'): boolean =>
      projectId ? canAccessProject(feature) : (canAccessOwnTier(feature) || invited.length > 0),
    [projectId, canAccessProject, canAccessOwnTier, invited.length],
  );
  return { canAccess, roleState };
}

export default function SafetyScreen() {
  const router = useRouter();
  const { projectId: gateProjectId } = useLocalSearchParams<{ projectId?: string }>();
  const { canAccess, roleState } = useSafetyHubAccess(gateProjectId || undefined);
  if (!canAccess('safety_management')) {
    return <SafetyAccessBlocked roleState={roleState} onClose={() => router.back()} />;
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
  const { getProject, projects } = useProjects();
  const { user } = useAuth();
  const { canAccess: canAccessOwnTier } = useTierAccess();
  const {
    getJhasForProject, getToolboxTalksForProject, getIncidentsForProject, getHazardsForProject,
    getInspectionsForProject, expiringCertifications, templates, incidents,
  } = useSafety();

  // His own Business tier covers every job and the company-wide records. An
  // invited foreman on a free account reaches the hub only through the jobs
  // he was invited to, so that is all the picker lists — and it says so.
  const ownTier = canAccessOwnTier('safety_management');
  const pickable = useMemo(() => (ownTier ? projects : invitedSafetyProjects(projects)), [ownTier, projects]);
  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const pid = project ? project.id : '';
  // A projectId that matches no project (deleted, stale link) — the picker
  // says so instead of silently showing the list.
  const staleProjectId = projectId && !project ? projectId : undefined;

  // Picking a job re-renders this hub scoped to it, so the tiles, the Tools
  // row, the sidebar and search all end up with a project (audit #81 — this
  // used to be a card whose only button bounced to Home).
  const pickProject = useCallback((id: string) => router.setParams({ projectId: id }), [router]);

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

  // Company-scoped tools — project-independent, so they stay reachable with no
  // project selected. OSHA takes an OPTIONAL projectId; org-wide when none is
  // set. These are HIS company's records, so they need his own tier: a
  // collaborator does not get the GC's certifications or OSHA log.
  const oshaYear = currentOshaYear();
  const companyTiles = useMemo<Tile[]>(() => {
    if (!ownTier) return [];
    // The certificate screen's calendar day, not an instant: certExpiryStatus
    // compares day strings, and a UTC instant flips a card to "Expired" during
    // the evening of its last valid day west of Greenwich.
    const now = todayCalendarDay();
    // The tile counts through the SAME function, year and establishment filter
    // the log opens on (audit #169). It used to count every year's recordable
    // cases while the log showed this year's, so "3" opened onto "No
    // recordable cases in 2026".
    const scoped = incidentsForOwnEstablishment(pid ? getIncidentsForProject(pid) : incidents, projects, user?.id);
    const oshaCount = buildOsha300Log(scoped, oshaYear).length;
    return [
      { key: 'certifications', label: 'Certifications', icon: BadgeCheck, count: expiringCertifications(now).length,
        onPress: () => router.push('/safety-certifications' as never) },
      { key: 'forms', label: 'Forms Library', icon: FileText, count: templates.length,
        onPress: () => router.push('/safety-forms' as never) },
      { key: 'osha', label: `OSHA 300 Log · ${oshaYear}`, icon: ShieldAlert, count: oshaCount,
        onPress: () => router.push(
          pid
            ? ({ pathname: '/safety-osha' as never, params: { projectId: pid } as never })
            : ('/safety-osha' as never),
        ) },
    ];
  }, [ownTier, pid, router, getIncidentsForProject, incidents, projects, user?.id, oshaYear, expiringCertifications, templates]);

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
            <View style={styles.sectionRow}>
              <Text style={styles.sectionLabel}>Project</Text>
              {pickable.length > 1 ? (
                <TouchableOpacity
                  style={styles.switchBtn}
                  onPress={() => router.setParams({ projectId: '' })}
                  accessibilityRole="button"
                  accessibilityLabel="Switch project"
                  testID="safety-switch-project"
                >
                  <ArrowLeftRight size={14} color={t.accent} strokeWidth={1.75} />
                  <Text style={styles.switchBtnText}>Switch job</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <View style={styles.grid}>{projectTiles.map(renderTile)}</View>
          </>
        ) : (
          <View style={styles.pickerWrap}>
            <ToolProjectPicker
              toolName="Safety"
              message={ownTier
                ? 'JHAs, toolbox talks, incidents, the hazard log and inspections are tied to a job. Pick the job you are on.'
                : 'Your plan does not include Safety, but your GC invited you to the jobs below, so you can run their JHAs, toolbox talks, hazard log and incident reports here.'}
              projects={pickable}
              onPick={pickProject}
              staleProjectId={staleProjectId}
              icon={<HardHat size={36} color={t.accent} strokeWidth={1.6} />}
            />
          </View>
        )}

        {ownTier ? (
          <>
            <Text style={styles.sectionLabel}>Company-wide</Text>
            <View style={styles.grid}>{companyTiles.map(renderTile)}</View>
          </>
        ) : (
          <Text style={styles.collabNote} testID="safety-company-tools-note">
            Certifications, the forms library and the OSHA 300 log are your own company&apos;s records. They come with the Business plan; the jobs above are covered by your GC&apos;s.
          </Text>
        )}
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
  sectionRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  switchBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, paddingHorizontal: 10, paddingVertical: 6, minHeight: 44 },
  switchBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.accent },
  pickerWrap: { marginHorizontal: -20 },
  collabNote: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 19 },
  gateWrap: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, padding: 24, gap: 12 },
  gateTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text, textAlign: 'center' as const },
  gateText: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 19, textAlign: 'center' as const },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
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
