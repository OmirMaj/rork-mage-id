import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useLocalSearchParams, useRouter, Stack, useFocusEffect } from 'expo-router';
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
import { useT } from '@/contexts/LanguageContext';

/**
 * What an access wall shows for a project-scoped safety screen, per the
 * wave-3 gating contract: a spinner ONLY while the role read is in flight
 * (an invited foreman's free tier would otherwise flash a Business paywall
 * over the job he was invited to), a retry when that read failed, and the
 * paywall — which says why — once the answer is in and it is "no".
 * Shared by the hub and the JHA / toolbox / hazard / inspection screens.
 */
export function SafetyAccessBlocked({ roleState, onClose }: { roleState: ProjectRoleState; onClose: () => void }) {
  const { t } = useT();
  const { colors: tc } = useTheme();
  const styles = useThemedStyles(makeStyles);
  if (roleState.isLoading) {
    return (
      <View style={[styles.gateWrap, { backgroundColor: tc.bg }]} testID="safety-gate-checking">
        <ActivityIndicator color={tc.accent} />
        <Text style={styles.gateText}>{t('safety.hub.checkingYourAccessTo', 'Checking your access to this project…')}</Text>
      </View>
    );
  }
  if (roleState.isError) {
    return (
      <View style={[styles.gateWrap, { backgroundColor: tc.bg }]} testID="safety-gate-error">
        <Text style={styles.gateTitle}>{t('safety.hub.couldntCheckYourAccess', "Couldn't check your access to this project")}</Text>
        <Text style={styles.gateText}>
          {t('safety.hub.mageCouldntLoadWho', "MAGE couldn't load who is on this project, so it can't tell whether your GC invited you to its safety records. Check your connection and try again.")}
        </Text>
        <Button label={t('safety.hub.tryAgain', 'Try again')} onPress={() => { void roleState.refetch(); }} variant="secondary" />
      </View>
    );
  }
  // Offline with no role for this job on the phone (audit #125): the read is
  // paused, not refused, so the Business paywall would be the wrong reason.
  // roleState.reason already tells the two cases apart (job not on this phone
  // / role unknown). Keyed on the REASON, not isPaused alone: a paused read
  // that serves a cached role falls through to the normal allow / paywall
  // answer. Try again does nothing until signal returns — react-query resumes
  // the paused read by itself and this gate re-renders.
  if (roleState.isPaused && roleState.role === null && roleState.reason) {
    return (
      <View style={[styles.gateWrap, { backgroundColor: tc.bg }]} testID="safety-gate-offline">
        <Text style={styles.gateTitle}>{t('safety.hub.waitingForSignal', 'Waiting for signal')}</Text>
        <Text style={styles.gateText}>{roleState.reason}</Text>
        <Button label={t('safety.hub.tryAgain', 'Try again')} onPress={() => { void roleState.refetch(); }} variant="secondary" />
      </View>
    );
  }
  // i18n-keep-english: Paywall looks its explainer up by this exact feature name
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
  const { t } = useT();
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { colors: tc } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isDesktop } = useResponsiveLayout();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject, projects } = useProjects();
  const { user } = useAuth();
  const { canAccess: canAccessOwnTier } = useTierAccess();
  const {
    getJhasForProject, getToolboxTalksForProject, getIncidentsForProject, getHazardsForProject,
    getInspectionsForProject, expiringCertifications, templates, incidents, refresh,
  } = useSafety();
  // Re-read the job's safety records whenever the hub is shown (audit #119):
  // a foreman's incident filed while this screen sat open used to stay out
  // of the counts until a relaunch. refresh() rate-limits itself.
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

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
      { key: 'jha', label: t('safety.hub.tileJhas', 'JHAs'), icon: HardHat, count: getJhasForProject(pid).length,
        onPress: () => router.push({ pathname: '/safety-jha', params: { projectId: pid } }) },
      { key: 'toolbox', label: t('safety.hub.tileToolbox', 'Toolbox talks'), icon: Megaphone, count: getToolboxTalksForProject(pid).length,
        onPress: () => router.push({ pathname: '/safety-toolbox', params: { projectId: pid } }) },
      { key: 'incidents', label: t('safety.hub.tileIncidents', 'Incidents'), icon: ShieldAlert, count: getIncidentsForProject(pid).length,
        onPress: () => router.push({ pathname: '/safety-incidents', params: { projectId: pid } }) },
      { key: 'hazards', label: t('safety.hub.tileHazards', 'Hazard log'), icon: TriangleAlert, count: getHazardsForProject(pid).length,
        onPress: () => router.push({ pathname: '/safety-hazards', params: { projectId: pid } }) },
      { key: 'inspections', label: t('safety.hub.tileInspections', 'Inspections'), icon: ClipboardCheck, count: getInspectionsForProject(pid).length,
        onPress: () => router.push({ pathname: '/safety-inspections' as never, params: { projectId: pid } as never }) },
    ];
  }, [pid, project, router, getJhasForProject, getToolboxTalksForProject, getIncidentsForProject,
    getHazardsForProject, getInspectionsForProject, t]);

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
      { key: 'certifications', label: t('safety.hub.tileCertifications', 'Certifications'), icon: BadgeCheck, count: expiringCertifications(now).length,
        onPress: () => router.push('/safety-certifications' as never) },
      { key: 'forms', label: t('safety.hub.tileForms', 'Forms library'), icon: FileText, count: templates.length,
        onPress: () => router.push('/safety-forms' as never) },
      { key: 'osha', label: t('safety.hub.tileOsha', 'OSHA 300 Log · {year}', { year: oshaYear }), icon: ShieldAlert, count: oshaCount,
        onPress: () => router.push(
          pid
            ? ({ pathname: '/safety-osha' as never, params: { projectId: pid } as never })
            : ('/safety-osha' as never),
        ) },
    ];
  }, [ownTier, pid, router, getIncidentsForProject, incidents, projects, user?.id, oshaYear, expiringCertifications, templates, t]);

  const renderTile = (tile: Tile) => (
    <TouchableOpacity key={tile.key} style={[styles.tile, isDesktop && styles.tileDesktop]} activeOpacity={0.85} onPress={tile.onPress}>
      <View style={styles.tileIcon}><tile.icon size={22} color={tc.accent} strokeWidth={1.75} /></View>
      <Text style={styles.tileLabel}>{tile.label}</Text>
      <View style={styles.tileFooter}>
        <Text style={styles.tileCount}>{tile.count}</Text>
        <ChevronRight size={16} color={tc.textMuted} strokeWidth={1.75} />
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: tc.bg }]}>
      <Stack.Screen options={{ title: project ? t('safety.hub.titleWithProject', 'Safety — {name}', { name: project.name }) : t('safety.title', 'Safety') }} />
      <ScrollView {...fabScroll} contentContainerStyle={[{ padding: 20, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE, gap: 12 }, isDesktop && styles.contentDesktop]}>
        {project ? (
          <>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionLabel}>{t('safety.hub.project', 'Project')}</Text>
              {pickable.length > 1 ? (
                <TouchableOpacity
                  style={styles.switchBtn}
                  onPress={() => router.setParams({ projectId: '' })}
                  accessibilityRole="button"
                  accessibilityLabel={t('safety.hub.switchProject', 'Switch project')}
                  testID="safety-switch-project"
                >
                  <ArrowLeftRight size={14} color={tc.accent} strokeWidth={1.75} />
                  <Text style={styles.switchBtnText}>{t('safety.hub.switchProject', 'Switch project')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <View style={styles.grid}>{projectTiles.map(renderTile)}</View>
          </>
        ) : (
          <View style={styles.pickerWrap}>
            <ToolProjectPicker
              toolName={t('safety.title', 'Safety')}
              message={ownTier
                ? t('safety.hub.jhasToolboxTalksIncidents', 'JHAs, toolbox talks, incidents, the hazard log and inspections are tied to a project. Pick the project you are on.')
                // Audit #121: he cannot see a single JHA, talk or hazard the
                // GC wrote (20260919130000 — author or project owner only), so
                // this says what he CAN do rather than "run their" records.
                : t('safety.hub.yourGcInvitedYou', "Your GC invited you to these projects. JHAs, toolbox talks, hazards and incidents you file go to them, and you see the ones you file, not your GC's.")}
              projects={pickable}
              onPick={pickProject}
              staleProjectId={staleProjectId}
              icon={<HardHat size={36} color={tc.accent} strokeWidth={1.6} />}
            />
          </View>
        )}

        {ownTier ? (
          <>
            <Text style={styles.sectionLabel}>{t('safety.hub.companyWide', 'Company-wide')}</Text>
            <View style={styles.grid}>{companyTiles.map(renderTile)}</View>
          </>
        ) : (
          <Text style={styles.collabNote} testID="safety-company-tools-note">
            {t('safety.hub.certificationsTheFormsLibrary', "Certifications, the forms library and the OSHA 300 log are your own company's records, on the Business plan. The projects above are covered by your GC's.")}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: tc.bg },
  // Record lists (certs / incidents / inspections / forms) — desktop gets the
  // viewport rather than a 760px column stranded in the middle.
  contentDesktop: { width: '100%', maxWidth: 1200, alignSelf: 'center' as const },
  sectionLabel: { fontSize: Type.caption1.fontSize, fontWeight: '800' as const, color: tc.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginTop: 4 },
  sectionRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  switchBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, paddingHorizontal: 10, paddingVertical: 6, minHeight: 44 },
  switchBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: tc.accent },
  pickerWrap: { marginHorizontal: -20 },
  collabNote: { fontSize: Type.footnote.fontSize, color: tc.textSecondary, lineHeight: 19 },
  gateWrap: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, padding: 24, gap: 12 },
  gateTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: tc.text, textAlign: 'center' as const },
  gateText: { fontSize: Type.footnote.fontSize, color: tc.textSecondary, lineHeight: 19, textAlign: 'center' as const },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  // Desktop overrides the 47% two-up grid so tiles pack 4-5 across the wider
  // content column instead of stretching to ~570px each.
  tileDesktop: { width: 'auto' as const, flexBasis: 240, maxWidth: 340 },
  tile: {
    width: '47%', flexGrow: 1, backgroundColor: tc.surface, borderRadius: Tokens.radius.lg,
    borderWidth: 1, borderColor: tc.line, padding: 16, gap: 12, minHeight: 120, justifyContent: 'space-between',
  },
  tileIcon: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: tc.accent + '14',
  },
  tileLabel: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: tc.text },
  tileFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tileCount: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: tc.accent },
});
