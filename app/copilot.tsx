// app/copilot.tsx — modal host for the MAGE Copilot conversational interview.
//
// Params: capabilityId (which capability to run) + projectId. Assembles the
// CopilotContext (project + adders + tier) and hands it to the shell.
//
// THE JOB GATE (#34). Home, the web sidebar, the hub and a few screens open
// this route with no projectId. Every project-scoped capability used to run
// the whole interview — each answer a metered AI turn — and then die on Build
// with "No project for this RFI." So before the shell mounts:
//   - a capability that writes onto a job (anything outside PROJECT_FREE) with
//     no resolvable job shows a picker (jobs not closed, most recent first;
//     exactly one → it is used, with "for <name> · Change"; none → "Create a
//     project first", which opens the new-project Copilot);
//   - schedule and billing need the job's estimate and say so up front;
//   - warranty on a job he does not own says why (#53, the owner-only interim).
// No metered turn can run without a job. Each capability's own apply() guard
// stays as the backstop, and a Build that still fails for want of a job keeps
// the draft and offers "Pick a job" over the running interview.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, ChevronRight, FolderPlus, Receipt, ShieldCheck, RefreshCw } from 'lucide-react-native';
import { useProjects } from '@/contexts/ProjectContext';
import { useSafety } from '@/contexts/SafetyContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useMaterialCart } from '@/contexts/MaterialCartContext';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useLaborCostSamples } from '@/hooks/useLaborRates';
import { useCostSeeds } from '@/hooks/useCostSeeds';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Colors, type ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import CopilotShell from '@/components/copilot/CopilotShell';
import { copilotPrecondition, pickableProjects, PROJECT_FREE, WARRANTY_OWNER_ONLY_COPY } from '@/utils/copilot/projectScope';
import type { CopilotCapabilityId } from '@/utils/copilot/types';
import type { Project } from '@/types';

export default function CopilotScreen() {
  const { capabilityId: rawCapability, projectId: rawProjectId, seed } = useLocalSearchParams<{ capabilityId: CopilotCapabilityId; projectId: string; seed?: string }>();
  const capabilityId = (rawCapability ?? 'schedule') as CopilotCapabilityId;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const projectsCtx = useProjects() as any;
  const safetyCtx = useSafety() as any;
  const { tier } = useSubscription();
  // Receipts live outside ProjectContext (useMaterialReceipts hook) — spread
  // them into the ctx bag so estimateGrounding's cost book sees live supplier
  // prices (B1: receipts into every cost-book build).
  const { receipts } = useMaterialReceipts();
  // Self-perform labor samples (D6) — same ctx-bag route as receipts, so the
  // estimate copilot's cost book prices labor from the GC's clocked hours.
  const laborSamples = useLaborCostSamples();
  // Cold-start cost seeds — same ctx-bag route. The estimate copilot is one of
  // the most visible AI surfaces after the wizard; without these a seeded
  // contractor gets ungrounded LLM pricing here while the wizard next door
  // prices off their own numbers. (`seeds`, not `seed` — that route param above
  // is the copilot's opening message.)
  const { seeds } = useCostSeeds();
  // The markup he decided in the estimator / wizard (read only). The estimate
  // Copilot builds at it when neither he nor the job says otherwise — it used
  // to fall through to a hard-coded 18% (#7). markupDecided null = hydrating.
  const { globalMarkup, markupDecided } = useMaterialCart();

  // ── which job ────────────────────────────────────────────────────────────
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [overlayPicker, setOverlayPicker] = useState(false);
  // Once the interview is running the gate stops re-checking, so a job that
  // disappears mid-interview surfaces as a Build error with "Pick a job"
  // (draft kept) instead of silently unmounting what he has said.
  const [started, setStarted] = useState(false);

  const projectFree = PROJECT_FREE.has(capabilityId);
  const candidates = useMemo(() => pickableProjects<Project>(projectsCtx.projects), [projectsCtx.projects]);
  const passedId = typeof rawProjectId === 'string' ? rawProjectId : '';
  const autoId = !projectFree && !passedId && !chosenId && candidates.length === 1 ? candidates[0].id : null;
  const projectId = passedId || chosenId || autoId || '';
  const project: Project | null = projectId ? projectsCtx.getProject?.(projectId) ?? null : null;
  // Picked here (auto or by tap) rather than handed in: say which, and let
  // him change it.
  const pickedHere = !projectFree && !!project && (!passedId || passedId === chosenId);

  // CARRY #53 (owner-only interim): warranties live on the project owner's
  // account. Read-only role lookup; only resolved for the warranty capability.
  const roleState = useProjectRoleState(capabilityId === 'warranty' && project ? projectId : undefined);

  const pick = (id: string) => {
    setChosenId(id);
    setChanging(false);
    setOverlayPicker(false);
    router.setParams({ projectId: id } as never);
  };
  const startNewProject = () => router.replace({ pathname: '/copilot', params: { capabilityId: 'new_project' } } as never);
  const buildEstimateFirst = () => router.replace({ pathname: '/copilot', params: { capabilityId: 'estimate', projectId } } as never);
  const close = () => router.back();

  const precondition = copilotPrecondition(capabilityId, project);
  const warrantyBlocked = capabilityId === 'warranty' && !!project && roleState.role !== 'owner';
  const gateOpen = projectFree || started || (!!project && !changing && precondition.ok && !warrantyBlocked);
  useEffect(() => { if (gateOpen && !projectFree && !started) setStarted(true); }, [gateOpen, projectFree, started]);

  const ctx = { project, projectId, ctx: { ...projectsCtx, markupDecided, markup: globalMarkup, receipts, laborSamples, seeds }, safety: safetyCtx, tier };

  const picker = (
    <ProjectPicker
      styles={styles}
      colors={colors}
      candidates={candidates}
      loading={!projectsCtx.projectsLoaded}
      staleId={passedId && !project ? passedId : undefined}
      currentId={project?.id}
      onPick={pick}
      onNewProject={startNewProject}
    />
  );

  if (!gateOpen) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <GateTopbar styles={styles} colors={colors} onClose={close} />
        <ScrollView contentContainerStyle={styles.body}>
          {(!project || changing) ? picker
            : !precondition.ok ? (
              <View style={styles.block} testID="copilot-gate-no-estimate">
                <Text style={styles.eyebrow}>{(project.name || 'This job').toUpperCase()}</Text>
                <Text style={styles.headline}>{precondition.message}</Text>
                <Text style={styles.muted}>
                  {capabilityId === 'invoice' ? 'Billing draws against the estimate.' : 'The schedule is built from the estimate’s lines.'} Nothing has been charged.
                </Text>
                <TouchableOpacity style={styles.primary} onPress={buildEstimateFirst} activeOpacity={0.9} testID="copilot-gate-build-estimate">
                  <Receipt size={18} color={Colors.textOnAccent} strokeWidth={2} />
                  <Text style={styles.primaryText}>Build the estimate first</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondary} onPress={() => setChanging(true)} activeOpacity={0.8}>
                  <Text style={styles.secondaryText}>Pick another job</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.block} testID="copilot-gate-warranty">
                <ShieldCheck size={22} color={colors.textMuted} strokeWidth={1.8} />
                {roleState.isLoading && roleState.role == null && !roleState.isPaused ? (
                  <View style={styles.center}>
                    <ActivityIndicator color={colors.accent} />
                    <Text style={styles.muted}>Checking your role on {project.name}…</Text>
                  </View>
                ) : roleState.isPaused && roleState.role == null ? (
                  <Text style={styles.headline}>{roleState.reason ?? 'You’re offline — your role on this job can’t be checked until you’re back online.'}</Text>
                ) : roleState.isError && roleState.role == null ? (
                  <>
                    <Text style={styles.headline}>Couldn’t check your role on this job.</Text>
                    <TouchableOpacity style={styles.primary} onPress={roleState.refetch} activeOpacity={0.9}>
                      <RefreshCw size={16} color={Colors.textOnAccent} strokeWidth={2} />
                      <Text style={styles.primaryText}>Try again</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <Text style={styles.headline}>{WARRANTY_OWNER_ONLY_COPY}</Text>
                )}
                <TouchableOpacity style={styles.secondary} onPress={() => setChanging(true)} activeOpacity={0.8}>
                  <Text style={styles.secondaryText}>Pick another job</Text>
                </TouchableOpacity>
              </View>
            )}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {pickedHere && project && (
        <View style={[styles.forBar, { paddingTop: insets.top + Tokens.spacing.xs }]}>
          <Text style={styles.forText} numberOfLines={1}>for {project.name}</Text>
          <TouchableOpacity onPress={() => { setStarted(false); setChanging(true); }} hitSlop={8} testID="copilot-change-job">
            <Text style={styles.forChange}>Change</Text>
          </TouchableOpacity>
        </View>
      )}
      <CopilotShell
        capabilityId={capabilityId}
        ctx={ctx}
        onDone={() => router.back()}
        seed={typeof seed === 'string' ? seed : undefined}
        onPickProject={projectFree ? undefined : () => setOverlayPicker(true)}
        onBuildEstimate={project ? buildEstimateFirst : undefined}
      />
      <Modal visible={overlayPicker} animationType="slide" transparent={false} onRequestClose={() => setOverlayPicker(false)}>
        <View style={[styles.root, { paddingTop: insets.top }]}>
          <GateTopbar styles={styles} colors={colors} onClose={() => setOverlayPicker(false)} />
          <ScrollView contentContainerStyle={styles.body}>{picker}</ScrollView>
        </View>
      </Modal>
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function GateTopbar({ styles, colors, onClose }: { styles: Styles; colors: ThemeColors; onClose: () => void }) {
  return (
    <View style={styles.topbar}>
      <Text style={styles.brand}>MAGE&nbsp;COPILOT</Text>
      <TouchableOpacity onPress={onClose} accessibilityLabel="Close" hitSlop={10}>
        <X size={20} color={colors.textMuted} strokeWidth={2} />
      </TouchableOpacity>
    </View>
  );
}

function ProjectPicker({ styles, colors, candidates, loading, staleId, currentId, onPick, onNewProject }: {
  styles: Styles; colors: ThemeColors; candidates: Project[]; loading: boolean;
  staleId?: string; currentId?: string; onPick: (id: string) => void; onNewProject: () => void;
}) {
  if (loading && candidates.length === 0) {
    return (
      <View style={styles.center} testID="copilot-picker-loading">
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.muted}>Loading your jobs…</Text>
      </View>
    );
  }
  if (candidates.length === 0) {
    return (
      <View style={styles.block} testID="copilot-picker-empty">
        <Text style={styles.eyebrow}>NO JOB YET</Text>
        <Text style={styles.headline}>Create a project first.</Text>
        <Text style={styles.muted}>This goes on a job, and you don’t have an open one. Nothing has been charged.</Text>
        <TouchableOpacity style={styles.primary} onPress={onNewProject} activeOpacity={0.9} testID="copilot-picker-new-project">
          <FolderPlus size={18} color={Colors.textOnAccent} strokeWidth={2} />
          <Text style={styles.primaryText}>Start a project</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <View style={styles.block} testID="copilot-picker">
      <Text style={styles.eyebrow}>WHICH JOB IS THIS FOR?</Text>
      {staleId ? (
        <Text style={styles.muted}>That job isn’t on this device any more — pick the one this is for.</Text>
      ) : (
        <Text style={styles.muted}>Pick the job first, so nothing you say is spent on the wrong one.</Text>
      )}
      {candidates.map((p) => (
        <TouchableOpacity key={p.id} style={[styles.card, p.id === currentId && styles.cardCurrent]} onPress={() => onPick(p.id)} activeOpacity={0.85} testID={`copilot-picker-${p.id}`}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardLabel} numberOfLines={1}>{p.name || 'Untitled job'}</Text>
            {!!p.location && <Text style={styles.muted} numberOfLines={1}>{p.location}</Text>}
          </View>
          <ChevronRight size={16} color={colors.textMuted} strokeWidth={1.9} />
        </TouchableOpacity>
      ))}
      <TouchableOpacity style={styles.secondary} onPress={onNewProject} activeOpacity={0.8}>
        <Text style={styles.secondaryText}>It’s a new job — start a project</Text>
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Tokens.spacing.lg, paddingTop: Tokens.spacing.md, paddingBottom: Tokens.spacing.sm },
    brand: { ...Type.monoEyebrow, color: colors.textSecondary },
    body: { paddingHorizontal: Tokens.spacing.lg, paddingBottom: Tokens.spacing['3xl'], gap: Tokens.spacing.sm },
    block: { gap: Tokens.spacing.sm },
    center: { alignItems: 'center', gap: Tokens.spacing.sm, paddingVertical: Tokens.spacing['2xl'] },
    eyebrow: { ...Type.monoEyebrow, color: colors.accentLabel },
    headline: { ...Type.serifHeadline, color: colors.text },
    muted: { ...Type.footnote, color: colors.textMuted },
    card: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm, padding: Tokens.spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: Tokens.radius.lg, backgroundColor: colors.surface },
    cardCurrent: { borderColor: colors.accent },
    cardLabel: { ...Type.subheadEmphasized, color: colors.text },
    primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Tokens.spacing.xs, backgroundColor: colors.accentFill, borderRadius: Tokens.radius.lg, paddingVertical: Tokens.spacing.md, marginTop: Tokens.spacing.sm },
    primaryText: { ...Type.bodyEmphasized, color: Colors.textOnAccent },
    secondary: { alignItems: 'center', justifyContent: 'center', paddingVertical: Tokens.spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: Tokens.radius.lg },
    secondaryText: { ...Type.subheadEmphasized, color: colors.textSecondary },
    forBar: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm, paddingHorizontal: Tokens.spacing.lg, paddingBottom: Tokens.spacing.xs, backgroundColor: colors.bg },
    forText: { ...Type.monoLabel, color: colors.textSecondary, flex: 1 },
    forChange: { ...Type.monoLabel, color: colors.accentLabel },
  });
}
