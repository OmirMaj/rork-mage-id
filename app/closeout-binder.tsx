// closeout-binder — GC reviews + finalizes the homeowner closeout binder.
// The engine auto-compiles everything from selections, commitments,
// warranties, photos. This screen is intentionally thin because the
// magic is in the compiler — GC just adds a note + tweaks the
// maintenance schedule + taps Generate PDF.
//
// Status flow:
//   draft     → editable, not visible to homeowner
//   finalized → "ready to deliver", still editable, still not in portal
//   sent      → visible in homeowner portal (closeout section), GC can
//               re-deliver (re-fire notification) but content is locked
//
// The portal snapshot only emits the binder block when status ∈
// {finalized, sent}, so flipping the toggle is what makes it appear.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Platform,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, FileDown, Plus, Trash2, Wrench,
  CheckCircle2, Send, Lock, RefreshCw, Stamp, FileText, Shield, X,
  ShieldCheck, BookOpen,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { ToolHeader, ToolProjectPicker } from '@/components/ToolScreenChrome';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { FeatureHeader } from '@/components/FeatureHeader';
import {
  fetchCloseoutBinder, saveCloseoutBinder, shareCloseoutBinderPDF,
  DEFAULT_MAINTENANCE,
  type MaintenanceItem, type CloseoutBinder,
} from '@/utils/closeoutBinderEngine';
import { statusPillStyle } from '@/utils/statusPill';
import { fetchSelectionsForProject } from '@/utils/selectionsEngine';
import { fetchLienWaiversForProject } from '@/utils/lienWaiverEngine';
import { generateUUID } from '@/utils/generateId';
import { notifyEvent } from '@/utils/notifyClient';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import {
  generateG704PDF, generateG706PDF, generateG706APDF, generateG707PDF,
  type G704Data, type G706Data, type G706AData, type G707Data,
} from '@/utils/aiaForms';
import type {
  CompanyBranding, SelectionCategory, LienWaiver,
} from '@/types';
import { effectiveEstimateTotal } from '@/utils/estimateCommit';
import { buildHomePassport } from '@/utils/passport/buildHomePassport';
import type { BakedFaqEntry, BakedHomePassport } from '@/utils/passport/types';
import { loadBakedPassport, saveBakedPassport } from '@/utils/passport/passportStore';
import { syncMemoryEmbeddings, answerFromMemory, type MemoryDoc } from '@/utils/projectMemory';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { showAlert } from '@/utils/alert';

type BinderStatus = CloseoutBinder['status'];

export default function CloseoutBinderScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isDesktop } = useResponsiveLayout();
  const { projectId: paramProjectId } = useLocalSearchParams<{ projectId: string }>();
  const { projects, getProject, commitments, warranties, projectPhotos, rfis, submittals, settings, updateProject: ctxUpdateProject, getPunchItemsForProject, getInvoicesForProject, getChangeOrdersForProject, subcontractors } = useProjects() as any;

  // Reached from the sidebar, universal search or a deep link there is no
  // projectId, so ToolProjectPicker sets one locally (field-ticket pattern).
  // A pick outranks the param so a STALE id in the URL — deleted project,
  // shared link — can't make the picker inert.
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const projectId = pickedProjectId ?? paramProjectId ?? '';
  const project = projectId ? getProject(projectId) : undefined;
  /** The URL named a project that doesn't exist — different from "no id". */
  const staleProjectId = !project && paramProjectId ? paramProjectId : undefined;

  const [maintenance, setMaintenance] = useState<MaintenanceItem[]>(DEFAULT_MAINTENANCE);
  const [notes, setNotes] = useState('');
  const [binderId, setBinderId] = useState<string | undefined>();
  const [status, setStatus] = useState<BinderStatus>('draft');
  const [finalizedAt, setFinalizedAt] = useState<string | undefined>();
  const [sentAt, setSentAt] = useState<string | undefined>();
  const [selections, setSelections] = useState<SelectionCategory[]>([]);
  const [lienWaivers, setLienWaivers] = useState<LienWaiver[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [delivering, setDelivering] = useState(false);
  // Tracks which AIA form (if any) is open in the input modal.
  // null when no modal is open. Each form needs slightly different
  // extras the user has to fill in (notary state, surety, etc.) so
  // we use a single modal that branches on `form`.
  const [aiaModal, setAiaModal] = useState<AiaFormId | null>(null);
  // Home Passport — baked result (FAQ + counts) for this project, plus
  // generation progress. Generation is ALWAYS non-blocking: the binder
  // finalize/deliver flow never waits on it and never fails because of it.
  const [passportBaked, setPassportBaked] = useState<BakedHomePassport | null>(null);
  const [passportBusy, setPassportBusy] = useState(false);
  const [passportStep, setPassportStep] = useState('');
  const { canAccess } = useTierAccess();

  const branding = useMemo<CompanyBranding>(() => ({
    companyName:   settings?.branding?.companyName ?? 'MAGE ID',
    contactName:   settings?.branding?.contactName ?? '',
    phone:         settings?.branding?.phone ?? '',
    email:         settings?.branding?.email ?? '',
    address:       settings?.branding?.address ?? '',
    licenseNumber: settings?.branding?.licenseNumber ?? '',
    tagline:       settings?.branding?.tagline ?? '',
    logoUri:       settings?.branding?.logoUri,
  }), [settings]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!projectId) { setLoading(false); return; }
      const [existing, sels, waivers, baked] = await Promise.all([
        fetchCloseoutBinder(projectId),
        fetchSelectionsForProject(projectId),
        fetchLienWaiversForProject(projectId),
        loadBakedPassport(projectId),
      ]);
      if (cancelled) return;
      setPassportBaked(baked);
      if (existing) {
        setBinderId(existing.id);
        setMaintenance(existing.maintenanceSchedule.length ? existing.maintenanceSchedule : DEFAULT_MAINTENANCE);
        setNotes(existing.notes);
        setStatus(existing.status);
        setFinalizedAt(existing.finalizedAt);
        setSentAt(existing.sentAt);
      }
      setSelections(sels);
      setLienWaivers(waivers);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const persistBinder = useCallback(async (overrides: Partial<CloseoutBinder>) => {
    if (!projectId) return null;
    return saveCloseoutBinder({
      id: binderId,
      projectId,
      maintenanceSchedule: maintenance,
      notes,
      status,
      finalizedAt,
      sentAt,
      ...overrides,
    });
  }, [binderId, projectId, maintenance, notes, status, finalizedAt, sentAt]);

  const handleSave = useCallback(async () => {
    if (!projectId) return;
    setSaving(true);
    try {
      const saved = await persistBinder({});
      if (saved) {
        setBinderId(saved.id);
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        showAlert('Save failed', 'Could not save the binder. Check your connection and try again.');
      }
    } catch (e) {
      showAlert('Save failed', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  }, [persistBinder, projectId]);

  // ── Home Passport generation ──────────────────────────────────────
  // 1. buildHomePassport assembles pure docs from this project's data.
  // 2. Docs are indexed into memory_embeddings via project-memory-embed
  //    (contractor JWT, source 'Home Passport', idempotent by docId) so
  //    the homeowner's portal-ask-home can retrieve them.
  // 3. Each FaqInput is pre-answered via answerFromMemory over the
  //    passport docs ONLY (never the full project index — change orders /
  //    punch items stay contractor-internal) and baked to AsyncStorage;
  //    the next snapshot push carries it to the portal (v9).
  const runPassportGeneration = useCallback(async () => {
    if (!project || passportBusy) return;
    if (!canAccess('client_portal')) {
      router.push('/paywall');
      return;
    }
    setPassportBusy(true);
    setPassportStep('Assembling home records…');
    try {
      const generatedAt = new Date().toISOString();
      const projectCommitments = (commitments ?? []).filter((c: any) => c.projectId === project.id);
      const projectWarranties = (warranties ?? []).filter((w: any) => w.projectId === project.id);
      const projectPhotosArr = (projectPhotos ?? []).filter((p: any) => p.projectId === project.id);
      const passport = buildHomePassport({
        project: { id: project.id, name: project.name, location: project.location },
        selections,
        warranties: projectWarranties,
        commitments: projectCommitments,
        subcontractors: subcontractors ?? [],
        photos: projectPhotosArr,
        maintenance,
        generatedAt,
      });
      if (passport.docs.length === 0) {
        showAlert(
          'Nothing to index yet',
          'The passport is assembled from selections, warranties, commitments, photos, and the maintenance schedule. Add some of those to this project first.',
        );
        return;
      }

      setPassportStep('Indexing for the portal…');
      const memoryDocs: MemoryDoc[] = passport.docs.map(d => ({
        id: d.docId,
        source: 'Home Passport',
        ref: d.ref,
        date: d.date,
        text: d.text,
      }));
      await syncMemoryEmbeddings(project.id, memoryDocs);

      const faq: BakedFaqEntry[] = [];
      let consecutiveFailures = 0;
      for (let i = 0; i < passport.faqInputs.length; i++) {
        const item = passport.faqInputs[i];
        setPassportStep(`Pre-answering ${i + 1} of ${passport.faqInputs.length}…`);
        const res = await answerFromMemory(item.question, memoryDocs);
        if (res.answer && !res.errorKind) {
          faq.push({ q: item.question, a: res.answer, refs: res.usedRefs.slice(0, 4) });
          consecutiveFailures = 0;
        } else {
          consecutiveFailures += 1;
          if (consecutiveFailures >= 2) break; // offline / signed out / capped — keep what we have
        }
      }

      const baked: BakedHomePassport = { faq, summary: passport.summary, generatedAt };
      await saveBakedPassport(project.id, baked);
      setPassportBaked(baked);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      // Non-blocking by design — the binder flow is untouched.
      console.warn('[home-passport] generation failed:', e);
      showAlert('Passport not generated', 'The binder is unaffected. Check your connection and tap Generate again.');
    } finally {
      setPassportBusy(false);
      setPassportStep('');
    }
  }, [project, passportBusy, canAccess, router, commitments, warranties, projectPhotos, selections, subcontractors, maintenance]);

  const handleFinalize = useCallback(() => {
    showAlert(
      'Finalize binder?',
      'You can still tweak the note and maintenance items, but the binder will be marked ready to deliver. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Finalize', onPress: async () => {
            const now = new Date().toISOString();
            setSaving(true);
            try {
              const saved = await persistBinder({ status: 'finalized', finalizedAt: now });
              if (saved) {
                setBinderId(saved.id);
                setStatus('finalized');
                setFinalizedAt(now);
                if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                // Home Passport: index + pre-answer in the background.
                // Never blocks or fails the finalize itself.
                void runPassportGeneration();
              } else {
                showAlert('Failed', 'Could not finalize. Try again.');
              }
            } finally {
              setSaving(false);
            }
          }
        },
      ],
    );
  }, [persistBinder, runPassportGeneration]);

  const handleDeliver = useCallback(() => {
    if (!project) return;
    const title = sentAt ? 'Re-deliver to homeowner?' : 'Deliver to homeowner?';
    const message = sentAt
      ? 'The homeowner already received this binder. We\'ll re-send the email and refresh the portal copy. Continue?'
      : 'The binder will appear in the homeowner\'s portal under the Closeout section, and we\'ll send them an email so they know where to find it. Continue?';
    showAlert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Deliver', onPress: async () => {
          setDelivering(true);
          try {
            const now = new Date().toISOString();
            const saved = await persistBinder({ status: 'sent', sentAt: now });
            if (!saved) {
              showAlert('Failed', 'Could not deliver. Try again.');
              return;
            }
            setBinderId(saved.id);
            setStatus('sent');
            setSentAt(now);
            // Fire-and-forget notification — don't block UI on email.
            // Pull the first portal invite (the homeowner) so we can
            // address the email by name + send to the right inbox.
            const invite = (project.clientPortal?.invites ?? [])[0];
            void notifyEvent('closeout_binder_sent', {
              project_id: project.id,
              binder_id: saved.id,
              project_name: project.name,
              gc_user_id: saved.userId,
              portal_id: project.clientPortal?.portalId,
              homeowner_email: invite?.email,
              homeowner_name: invite?.name,
            });
            if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            // Connector: flip the project to 'closed' on first delivery.
            // Only on first delivery (not re-deliver) and only if the
            // project isn't already past the active phase. Asks the GC
            // first because some projects keep working after binder
            // delivery (e.g., warranty work, punch follow-ups).
            const wasFirstDeliver = !sentAt;
            if (wasFirstDeliver && project.status !== 'closed' && project.status !== 'completed') {
              showAlert(
                'Mark project as closed?',
                'Now that the binder is delivered, do you want to mark the whole project as closed? You can still come back to it for warranty work, punch follow-ups, or invoice tracking.',
                [
                  { text: 'Keep open', style: 'cancel' },
                  {
                    text: 'Mark as closed',
                    onPress: () => {
                      ctxUpdateProject(project.id, { status: 'closed', closedAt: new Date().toISOString() });
                    },
                  },
                ],
              );
            } else {
              showAlert('Delivered', 'The homeowner can see it in their portal now.');
            }
          } finally {
            setDelivering(false);
          }
        }
      },
    ]);
  }, [persistBinder, project, sentAt]);

  const handleExport = useCallback(async () => {
    if (!project) return;
    setExporting(true);
    try {
      const projectCommitments = (commitments ?? []).filter((c: any) => c.projectId === project.id);
      const projectPhotosArr = (projectPhotos ?? []).filter((p: any) => p.projectId === project.id);
      const projectRfis = (rfis ?? []).filter((r: any) => r.projectId === project.id);
      const projectSubmittals = (submittals ?? []).filter((s: any) => s.projectId === project.id);
      await shareCloseoutBinderPDF({
        project,
        branding,
        binder: {
          id: binderId ?? '',
          projectId: project.id,
          userId: '',
          maintenanceSchedule: maintenance,
          notes,
          status,
          createdAt: '',
          updatedAt: '',
        },
        commitments: projectCommitments,
        photos: projectPhotosArr,
        selections,
        warranties: warranties ?? [],
        rfis: projectRfis,
        submittals: projectSubmittals,
        lienWaivers,
      });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      showAlert('Export failed', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setExporting(false);
    }
  }, [project, branding, binderId, maintenance, notes, status, commitments, projectPhotos, rfis, submittals, selections, warranties, lienWaivers]);

  const addMaintenance = useCallback(() => {
    setMaintenance(prev => [...prev, { id: generateUUID(), task: '', frequency: 'Annual', notes: '' }]);
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
  }, []);
  const removeMaintenance = useCallback((id: string) => {
    const m = maintenance.find(x => x.id === id);
    showAlert(
      'Remove maintenance item?',
      m?.task ? `"${m.task}" will be removed from the binder.` : 'This will remove the item from the binder.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => {
          setMaintenance(prev => prev.filter(x => x.id !== id));
          if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
        } },
      ],
    );
  }, [maintenance]);
  const updateMaintenance = useCallback((id: string, patch: Partial<MaintenanceItem>) => {
    setMaintenance(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m));
  }, []);

  // ── AIA closeout forms (G704 / G706 / G706A / G707) ─────────────
  // Each form has slightly different "extras" the user has to provide
  // (notary state, surety info). We branch in handleAiaFormTap to
  // open the modal only when extras are needed; if nothing's missing
  // (G704), we generate immediately.
  const handleAiaFormTap = useCallback((formId: AiaFormId) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    if (formId === 'G704') {
      // No extras needed — generate from project data.
      void generateAiaForm(formId, {});
      return;
    }
    setAiaModal(formId);
  }, []);

  const generateAiaForm = useCallback(async (formId: AiaFormId, extras: Record<string, string>) => {
    if (!project) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const punch = (getPunchItemsForProject?.(project.id) ?? []) as { description: string; location?: string; trade?: string; status: string }[];
      const openPunch = punch.filter(p => p.status !== 'closed').map(p => ({
        description: p.description,
        location: p.location,
        trade: p.trade,
      }));
      const projectAddress = (project as { location?: string; address?: string }).location ?? (project as { address?: string }).address ?? '';
      const owner = (project.clientPortal?.invites?.[0]?.name) ?? (project.owner) ?? 'Owner';

      switch (formId) {
        case 'G704': {
          const scDate = new Date().toISOString();
          const data: G704Data = {
            ownerName: owner,
            contractorName: branding.companyName,
            projectName: project.name,
            projectAddress,
            contractDate: undefined,
            dateOfSubstantialCompletion: scDate,
            punchList: openPunch,
            punchCompletionDate: new Date(Date.now() + 30 * 86400000).toISOString(),
            warrantyStartDate: scDate,
          };
          await generateG704PDF(data, branding);
          // Stamp the project so the 11-month warranty walk reminder
          // can fire ~11 months from now. Only sets if not already set;
          // a re-issued G704 (re-walk after revisions) shouldn't reset
          // the warranty clock.
          if (!project.substantialCompletionDate && ctxUpdateProject) {
            ctxUpdateProject(project.id, { substantialCompletionDate: scDate });
          }
          break;
        }
        case 'G706': {
          const data: G706Data = {
            ownerName: owner,
            contractorName: branding.companyName,
            projectName: project.name,
            projectAddress,
            contractDate: undefined,
            contractorState: (extras.state || '').toUpperCase(),
            contractorCounty: extras.county || undefined,
            exceptions: extras.exceptions || undefined,
          };
          await generateG706PDF(data, branding);
          break;
        }
        case 'G706A': {
          const data: G706AData = {
            ownerName: owner,
            contractorName: branding.companyName,
            projectName: project.name,
            projectAddress,
            contractDate: undefined,
            contractorState: (extras.state || '').toUpperCase(),
            contractorCounty: extras.county || undefined,
          };
          await generateG706APDF(data, branding);
          break;
        }
        case 'G707': {
          const cos = (getChangeOrdersForProject?.(project.id) ?? []) as { status: string; changeAmount: number }[];
          const coTotal = cos.filter(c => c.status === 'approved').reduce((s, c) => s + (c.changeAmount ?? 0), 0);
          const baseSum = effectiveEstimateTotal(project);
          const data: G707Data = {
            ownerName: owner,
            contractorName: branding.companyName,
            projectName: project.name,
            projectAddress,
            contractDate: undefined,
            suretyName: extras.suretyName || '',
            bondNumber: extras.bondNumber || undefined,
            bondDate: extras.bondDate || undefined,
            finalContractSum: baseSum + coTotal,
          };
          await generateG707PDF(data, branding);
          break;
        }
      }
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error('[AIA Forms] Generate failed:', err);
      showAlert('Could not generate', err instanceof Error ? err.message : 'Try again.');
    }
  }, [project, branding, getPunchItemsForProject, getChangeOrdersForProject]);

  if (!project) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.bg, paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        {/* This screen hides the nav header, so without ToolHeader the picker
            would have no back affordance at all — the exact dead end #3 is
            about. */}
        <ToolHeader eyebrow="CLOSEOUT · MAGE" title="Closeout Binder" />
        <ToolProjectPicker
          toolName="the Closeout Binder"
          message="The closeout binder pulls warranties, selections, and as-builts from a single project."
          projects={projects}
          onPick={setPickedProjectId}
          staleProjectId={staleProjectId}
          icon={<ShieldCheck size={36} color={themeColors.accent} strokeWidth={1.6} />}
          steps={[
            'Open or create a project from the Projects tab.',
            'Inside the project, log warranties, selections, and any final invoices or change orders.',
            'Tap Closeout in the project tile grid to assemble and send the binder PDF.',
          ]}
        />
      </View>
    );
  }

  const selectionsCount = selections.filter(s => (s.options ?? []).some(o => o.isChosen)).length;
  const projectCommitmentsCount = (commitments ?? []).filter((c: any) => c.projectId === project.id && c.status !== 'draft').length;
  const projectWarrantiesCount  = (warranties ?? []).filter((w: any) => w.projectId === project.id).length;

  const statusPill = (() => {
    const label = status === 'sent' ? 'DELIVERED' : status === 'finalized' ? 'FINALIZED' : 'DRAFT';
    const { color, backgroundColor } = statusPillStyle(status);
    return { label, color, bg: backgroundColor };
  })();

  const formattedAt = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={26} color={themeColors.accent} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>{project.name}</Text>
          <Text style={styles.title}>The handover packet</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: statusPill.bg }]}>
          <Text style={[styles.statusPillText, { color: statusPill.color }]}>{statusPill.label}</Text>
        </View>
      </View>
      <FeatureHeader
        eyebrow="Closeout Binder"
        title="Everything the homeowner gets at the end"
        subtitle="Warranties, manuals, paint colors, sub contacts, as-builts — all bundled into one PDF binder you hand over on closeout day."
        explainer={{
          term: 'Closeout Binder',
          definition: 'The closeout binder is the package of everything the homeowner needs to live with their new home: warranty docs from each manufacturer, operating manuals for installed equipment, paint colors and finishes for touch-ups, sub contact info for warranty claims, and as-built drawings showing what was actually built (not just what was designed).',
          whenToUse: [
            'At project closeout, before you hand over the keys',
            'When the homeowner asks "where\'s the warranty for the dishwasher?"',
            'A year later, when something needs warranty work and they call you',
          ],
        }}
      />

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="small" color={themeColors.accent} />
          <Text style={styles.loadingText}>Loading your binder…</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[{ padding: 16, paddingBottom: insets.bottom + 130 }, isDesktop && styles.contentDesktop]}>
          {/* Status timeline — small and informational so the GC always
              knows where this binder stands. */}
          {(finalizedAt || sentAt) && (
            <View style={styles.timeline}>
              {finalizedAt && (
                <View style={styles.timelineRow}>
                  <CheckCircle2 size={14} color={'#C26A00'} strokeWidth={1.75} />
                  <Text style={styles.timelineText}>Finalized {formattedAt(finalizedAt)}</Text>
                </View>
              )}
              {sentAt && (
                <View style={styles.timelineRow}>
                  <Send size={13} color={themeColors.success} strokeWidth={1.75} />
                  <Text style={styles.timelineText}>Delivered to homeowner {formattedAt(sentAt)}</Text>
                </View>
              )}
            </View>
          )}

          {/* What's in it */}
          <View style={styles.previewCard}>
            <View style={styles.previewHead}>
              <MageAIMark size={14} color={themeColors.accent} />
              <Text style={styles.previewTitle}>Auto-compiled from this project</Text>
            </View>
            <Text style={styles.previewBody}>
              Your binder will pull live data from the project so the homeowner gets a complete record:
            </Text>
            <View style={styles.previewList}>
              <PreviewRow label="Finishes & fixtures" value={`${selectionsCount} chosen`} />
              <PreviewRow label="Subcontractor contacts" value={`${projectCommitmentsCount} commitments`} />
              <PreviewRow label="Warranties" value={`${projectWarrantiesCount} on file`} />
              <PreviewRow label="Maintenance schedule" value={`${maintenance.length} items`} />
            </View>
            {selectionsCount === 0 && projectCommitmentsCount === 0 && projectWarrantiesCount === 0 && (
              <Text style={styles.emptyHint}>Tip: even with no data yet, your maintenance schedule and personal note still go into the binder. You can deliver a partial binder now and re-deliver as the project closes out.</Text>
            )}
          </View>

          {/* Home Passport — generation status + manual (re-)generate.
              Shown once the binder is finalized; auto-runs at finalize. */}
          {status !== 'draft' && (
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardLabel}>Home Passport</Text>
                  <Text style={styles.cardHelper}>
                    Indexes this project&apos;s finishes, warranties, trades, and photos so the homeowner can ask their portal questions — &ldquo;what paint is the kitchen?&rdquo; — and get cited answers, plus a pre-answered FAQ.
                  </Text>
                </View>
                <BookOpen size={18} color={themeColors.accent} strokeWidth={1.75} />
              </View>
              {passportBaked ? (
                <Text style={styles.emptyHint}>
                  Generated {formattedAt(passportBaked.generatedAt)} — {passportBaked.summary.docCount} records indexed, {passportBaked.faq.length} questions pre-answered. Re-generate after editing selections, warranties, or contacts.
                </Text>
              ) : (
                <Text style={styles.emptyHint}>
                  Not generated yet. The portal shows the binder either way; the passport adds the question box and pre-answered FAQ.
                </Text>
              )}
              <TouchableOpacity
                style={[styles.smallBtn, { alignSelf: 'flex-start', marginTop: 8 }]}
                onPress={() => { void runPassportGeneration(); }}
                disabled={passportBusy}
                testID="passport-generate"
                accessibilityRole="button"
                accessibilityLabel={passportBaked ? 'Re-generate Home Passport' : 'Generate Home Passport'}
              >
                {passportBusy ? (
                  <>
                    <ActivityIndicator size="small" color={themeColors.accent} />
                    <Text style={styles.smallBtnText}>{passportStep || 'Generating…'}</Text>
                  </>
                ) : (
                  <>
                    <RefreshCw size={13} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={styles.smallBtnText}>{passportBaked ? 'Re-generate passport' : 'Generate Home Passport'}</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Notes */}
          <View style={styles.card}>
            <Text style={styles.cardLabel}>A note to the homeowner</Text>
            <Text style={styles.cardHelper}>Goes at the top of the binder. Personal touch, sign-off, anything they should know.</Text>
            <TextInput
              style={styles.textarea}
              value={notes}
              onChangeText={setNotes}
              placeholder="Thanks for choosing us. Here's everything you need..."
              placeholderTextColor={themeColors.textMuted}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
            />
          </View>

          {/* Maintenance schedule */}
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardLabel}>Maintenance schedule</Text>
                <Text style={styles.cardHelper}>Routine tasks the homeowner should do. Pre-filled with sane defaults — edit, add, remove.</Text>
              </View>
              <TouchableOpacity style={styles.smallBtn} onPress={addMaintenance}>
                <Plus size={14} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={styles.smallBtnText}>Add</Text>
              </TouchableOpacity>
            </View>
            {maintenance.map(m => (
              <View key={m.id} style={styles.maintRow}>
                <View style={styles.maintMain}>
                  <TextInput
                    style={styles.maintTask}
                    value={m.task}
                    onChangeText={v => updateMaintenance(m.id, { task: v })}
                    placeholder="Task (e.g. HVAC filter replacement)"
                    placeholderTextColor={themeColors.textMuted}
                  />
                  <View style={styles.maintMeta}>
                    <Wrench size={11} color={themeColors.textMuted} strokeWidth={1.75} />
                    <TextInput
                      style={styles.maintFreq}
                      value={m.frequency}
                      onChangeText={v => updateMaintenance(m.id, { frequency: v })}
                      placeholder="Frequency"
                      placeholderTextColor={themeColors.textMuted}
                    />
                  </View>
                </View>
                <TouchableOpacity onPress={() => removeMaintenance(m.id)} hitSlop={6} testID={`maint-remove-${m.id}`} accessibilityRole="button" accessibilityLabel="Delete">
                  <Trash2 size={13} color={themeColors.danger} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>
            ))}
            {maintenance.length === 0 && (
              <Text style={styles.emptyHint}>No maintenance items. Tap Add to start, or leave it blank — the rest of the binder still ships.</Text>
            )}
          </View>

          {/* AIA-styled closeout forms — collapsed by default to keep
              the screen calm. Shows 4 form rows with one-tap Generate.
              Each form pulls live project data; only G706/A and G707
              prompt for the small extras (notary state, surety info)
              they need. Lives here because closeout is the natural
              moment to issue these — not buried in a separate menu. */}
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardLabel}>AIA-styled closeout forms</Text>
                <Text style={styles.cardHelper}>Generate G704 (Substantial Completion), G706/A affidavits, and G707 (Surety) as PDFs you can sign and send. Auto-fills from project data.</Text>
              </View>
            </View>
            {AIA_FORM_LIST.map(form => (
              <TouchableOpacity
                key={form.id}
                style={styles.aiaFormRow}
                onPress={() => handleAiaFormTap(form.id)}
                activeOpacity={0.7}
                testID={`aia-${form.id.toLowerCase()}-row`}
              >
                <View style={[styles.aiaFormIcon, { backgroundColor: form.color + '15' }]}>
                  <form.Icon size={18} color={form.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.aiaFormTitle}>{form.title}</Text>
                  <Text style={styles.aiaFormSub}>{form.subtitle}</Text>
                </View>
                <FileDown size={16} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            ))}
            <Text style={styles.emptyHint}>
              These are MAGE ID-styled versions of the AIA forms. Some lenders, sureties, and architects require official AIA documents — verify before you send.
            </Text>
          </View>
        </ScrollView>
      )}

      {/* AIA form input modal — captures only the fields we couldn't
          auto-derive (state/county for notary affidavits, surety info
          for G707, exceptions etc.). Tap "Generate PDF" to render. */}
      {aiaModal && (
        <AiaFormModal
          form={aiaModal}
          onClose={() => setAiaModal(null)}
          onGenerate={(extras) => {
            void generateAiaForm(aiaModal, extras);
            setAiaModal(null);
          }}
        />
      )}

      {/* Action bar — different actions per status. PDF is always
          available so the GC can always pull a paper copy. */}
      {!loading && (
        <View style={[styles.actionBar, { paddingBottom: insets.bottom + 12 }]}>
          {status === 'draft' && (
            <>
              <TouchableOpacity style={styles.secondary} onPress={handleSave} disabled={saving} testID="binder-save-draft">
                {saving ? <ActivityIndicator size="small" color={themeColors.text} /> : <Text style={styles.secondaryText}>Save draft</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondary} onPress={handleExport} disabled={exporting} testID="binder-pdf">
                {exporting ? <ActivityIndicator size="small" color={themeColors.text} /> : (
                  <>
                    <FileDown size={14} color={themeColors.text} strokeWidth={1.75} />
                    <Text style={styles.secondaryText}>PDF</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={styles.primary} onPress={handleFinalize} disabled={saving} testID="binder-finalize">
                <Lock size={14} color="#FFF" strokeWidth={1.75} />
                <Text style={styles.primaryText}>Finalize</Text>
              </TouchableOpacity>
            </>
          )}
          {status === 'finalized' && (
            <>
              <TouchableOpacity style={styles.secondary} onPress={handleSave} disabled={saving} testID="binder-save-final">
                {saving ? <ActivityIndicator size="small" color={themeColors.text} /> : <Text style={styles.secondaryText}>Save</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondary} onPress={handleExport} disabled={exporting} testID="binder-pdf-final">
                {exporting ? <ActivityIndicator size="small" color={themeColors.text} /> : (
                  <>
                    <FileDown size={14} color={themeColors.text} strokeWidth={1.75} />
                    <Text style={styles.secondaryText}>PDF</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={styles.primary} onPress={handleDeliver} disabled={delivering} testID="binder-deliver">
                {delivering ? <ActivityIndicator size="small" color="#FFF" /> : (
                  <>
                    <Send size={14} color="#FFF" strokeWidth={1.75} />
                    <Text style={styles.primaryText}>Deliver to homeowner</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}
          {status === 'sent' && (
            <>
              <TouchableOpacity style={styles.secondary} onPress={handleExport} disabled={exporting} testID="binder-pdf-sent">
                {exporting ? <ActivityIndicator size="small" color={themeColors.text} /> : (
                  <>
                    <FileDown size={14} color={themeColors.text} strokeWidth={1.75} />
                    <Text style={styles.secondaryText}>PDF</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={styles.primary} onPress={handleDeliver} disabled={delivering} testID="binder-redeliver">
                {delivering ? <ActivityIndicator size="small" color="#FFF" /> : (
                  <>
                    <RefreshCw size={14} color="#FFF" strokeWidth={1.75} />
                    <Text style={styles.primaryText}>Re-deliver</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      )}
    </View>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.previewRow}>
      <Text style={styles.previewRowLabel}>{label}</Text>
      <Text style={styles.previewRowValue}>{value}</Text>
    </View>
  );
}

// ── AIA closeout forms catalog ──────────────────────────────────────
// Static list rendered as the form grid. Each entry is one row in the
// closeout-binder screen; tapping fires handleAiaFormTap.
type AiaFormId = 'G704' | 'G706' | 'G706A' | 'G707';

const AIA_FORM_LIST: {
  id: AiaFormId;
  title: string;
  subtitle: string;
  Icon: typeof FileText;
  color: string;
}[] = [
  { id: 'G704',  title: 'G704 — Substantial Completion',         subtitle: 'Certifies the project is complete enough for owner to occupy. Includes punch list.', Icon: Stamp,    color: '#16A34A' },
  { id: 'G706',  title: 'G706 — Affidavit of Debts & Claims',    subtitle: 'Notarized — confirms all bills and claims are paid except as listed.',               Icon: FileText, color: '#1E5BC6' },
  { id: 'G706A', title: 'G706A — Affidavit of Lien Releases',    subtitle: 'Notarized — confirms all lien waivers received except as listed.',                   Icon: FileText, color: '#1E5BC6' },
  { id: 'G707',  title: 'G707 — Consent of Surety',              subtitle: 'Surety company approves final payment to contractor without releasing bond.',         Icon: Shield,   color: '#C26A00' },
];

// ── AIA form input modal ────────────────────────────────────────────
// Captures the small extras each form needs (state/county for notary,
// surety info for G707). Single component branches by form ID so the
// closeout-binder screen stays clean — no per-form modal explosion.
function AiaFormModal({
  form,
  onClose,
  onGenerate,
}: {
  form: AiaFormId;
  onClose: () => void;
  onGenerate: (extras: Record<string, string>) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors: themeColors } = useTheme();
  const modalStyles = useThemedStyles(makeModalStyles);
  const [state, setState] = useState('');
  const [county, setCounty] = useState('');
  const [exceptions, setExceptions] = useState('');
  const [suretyName, setSuretyName] = useState('');
  const [bondNumber, setBondNumber] = useState('');
  const [bondDate, setBondDate] = useState('');

  const formMeta = AIA_FORM_LIST.find(f => f.id === form);
  const needsNotary = form === 'G706' || form === 'G706A';
  const isSurety = form === 'G707';
  const isG706 = form === 'G706';

  const canGenerate = needsNotary
    ? state.trim().length === 2
    : isSurety
      ? suretyName.trim().length > 1
      : true;

  const handleSubmit = () => {
    onGenerate({ state, county, exceptions, suretyName, bondNumber, bondDate });
  };

  return (
    <View style={modalStyles.backdrop}>
      <View style={modalStyles.sheet}>
        <View style={modalStyles.head}>
          <View style={{ flex: 1 }}>
            <Text style={modalStyles.headSub}>Generate</Text>
            <Text style={modalStyles.headTitle}>{formMeta?.title}</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={10} testID="aia-modal-close" accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={themeColors.textMuted} strokeWidth={1.75} /></TouchableOpacity>
        </View>

        <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
          {needsNotary && (
            <>
              <Text style={modalStyles.label}>State (2-letter)</Text>
              <TextInput
                style={modalStyles.input}
                value={state}
                onChangeText={t => setState(t.slice(0, 2).toUpperCase())}
                placeholder="e.g. TX"
                placeholderTextColor={themeColors.textMuted}
                autoCapitalize="characters"
                maxLength={2}
                testID="aia-state-input"
              />
              <Text style={modalStyles.label}>County (optional)</Text>
              <TextInput
                style={modalStyles.input}
                value={county}
                onChangeText={setCounty}
                placeholder="e.g. Travis"
                placeholderTextColor={themeColors.textMuted}
              />
              {isG706 && (
                <>
                  <Text style={modalStyles.label}>Exceptions / unsettled items (optional)</Text>
                  <TextInput
                    style={[modalStyles.input, { minHeight: 70, textAlignVertical: 'top' }]}
                    value={exceptions}
                    onChangeText={setExceptions}
                    placeholder="Leave blank if all settled"
                    placeholderTextColor={themeColors.textMuted}
                    multiline
                  />
                </>
              )}
              <Text style={modalStyles.helper}>
                Sign before a notary public. The form has signature + commission lines ready.
              </Text>
            </>
          )}

          {isSurety && (
            <>
              <Text style={modalStyles.label}>Surety company *</Text>
              <TextInput
                style={modalStyles.input}
                value={suretyName}
                onChangeText={setSuretyName}
                placeholder="e.g. Travelers Casualty and Surety"
                placeholderTextColor={themeColors.textMuted}
                testID="aia-surety-input"
              />
              <Text style={modalStyles.label}>Bond number</Text>
              <TextInput
                style={modalStyles.input}
                value={bondNumber}
                onChangeText={setBondNumber}
                placeholder="e.g. 105-XXXX-22"
                placeholderTextColor={themeColors.textMuted}
              />
              <Text style={modalStyles.label}>Bond date</Text>
              <TextInput
                style={modalStyles.input}
                value={bondDate}
                onChangeText={setBondDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={themeColors.textMuted}
              />
              <Text style={modalStyles.helper}>
                Final contract sum is auto-pulled from your linked estimate + approved change orders.
              </Text>
            </>
          )}
        </ScrollView>

        <TouchableOpacity
          style={[modalStyles.cta, !canGenerate && modalStyles.ctaDisabled]}
          onPress={handleSubmit}
          disabled={!canGenerate}
          activeOpacity={0.85}
          testID="aia-modal-generate"
        >
          <FileDown size={16} color="#FFF" strokeWidth={1.75} />
          <Text style={modalStyles.ctaText}>Generate PDF</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeModalStyles = (themeColors: ThemeColors) => StyleSheet.create({
  backdrop: {
    position: 'absolute', inset: 0,
    backgroundColor: 'rgba(11,13,16,0.5)',
    justifyContent: 'flex-end' as const,
  } as any,
  sheet: {
    backgroundColor: themeColors.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 18, paddingTop: 16, paddingBottom: 22,
    gap: 8,
  },
  head: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingBottom: 12, marginBottom: 4,
    borderBottomWidth: 1, borderBottomColor: themeColors.line,
  },
  headSub: {
    fontSize: 10, fontWeight: '800' as const, color: themeColors.textMuted,
    letterSpacing: 0.8, textTransform: 'uppercase' as const,
  },
  headTitle: {
    fontSize: Type.callout.fontSize, fontWeight: '800' as const, color: themeColors.text,
    marginTop: 2,
  },
  label: {
    fontSize: Type.caption2.fontSize, fontWeight: '800' as const, color: themeColors.textMuted,
    letterSpacing: 0.6, textTransform: 'uppercase' as const,
    marginTop: 12, marginBottom: 5,
  },
  input: {
    backgroundColor: themeColors.bg,
    borderWidth: 1, borderColor: themeColors.line, borderRadius: Tokens.radius.md,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: Type.bodyCompact.fontSize, color: themeColors.text,
  },
  helper: {
    fontSize: Type.caption2.fontSize, color: themeColors.textMuted, lineHeight: 16,
    marginTop: 10, fontStyle: 'italic' as const,
  },
  cta: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: themeColors.accent,
    borderRadius: Tokens.radius.card, paddingVertical: 14,
    marginTop: 14,
  },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { color: '#FFF', fontSize: Type.subhead.fontSize, fontWeight: '800' as const },
});

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: themeColors.bg },
  contentDesktop: { width: '100%', maxWidth: 1200, alignSelf: 'center' as const },
  center: { alignItems: 'center', justifyContent: 'center' },
  loading: { padding: 30, alignItems: 'center', gap: 10 },
  loadingText: { fontSize: Type.footnote.fontSize, color: themeColors.textMuted },

  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: themeColors.line,
  },
  eyebrow: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: themeColors.accent, letterSpacing: 1.4, textTransform: 'uppercase' },
  title:   { fontSize: Type.title3.fontSize, fontWeight: '800', color: themeColors.text, letterSpacing: -0.4, marginTop: 4 },
  statusPill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: Tokens.radius.full, marginTop: 6 },
  statusPillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  emptyTitle: { fontSize: Type.callout.fontSize, fontWeight: '800', color: themeColors.text },
  emptyBack: { marginTop: 12, paddingHorizontal: 18, paddingVertical: 10, borderRadius: Tokens.radius.md, backgroundColor: themeColors.accent },
  emptyBackText: { color: '#FFF', fontWeight: '800', fontSize: Type.footnote.fontSize },

  timeline: { gap: 4, marginBottom: 10, paddingHorizontal: 4 },
  timelineRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timelineText: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, fontWeight: '600' },

  previewCard: { backgroundColor: themeColors.accent + '0D', borderRadius: Tokens.radius.lg, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: themeColors.accent + '30', gap: 8 },
  previewHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  previewTitle: { fontSize: Type.footnote.fontSize, fontWeight: '800', color: themeColors.accent, letterSpacing: -0.2 },
  previewBody: { fontSize: Type.caption1.fontSize, color: themeColors.text, lineHeight: 17 },
  previewList: { gap: 4 },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  previewRowLabel: { fontSize: Type.caption1.fontSize, color: themeColors.text, fontWeight: '600' },
  previewRowValue: { fontSize: Type.caption1.fontSize, color: themeColors.accent, fontWeight: '800' },
  emptyHint: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, fontStyle: 'italic', lineHeight: 16, marginTop: 4 },

  card: { backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg, padding: 14, borderWidth: 1, borderColor: themeColors.line, marginBottom: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  cardLabel: { fontSize: Type.caption2.fontSize, fontWeight: '800', color: themeColors.textMuted, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 },
  cardHelper: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginBottom: 10, lineHeight: 17 },

  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9, backgroundColor: themeColors.accent + '0D', borderWidth: 1, borderColor: themeColors.accent + '30' },
  smallBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '800', color: themeColors.accent },

  textarea: { backgroundColor: themeColors.bg, borderWidth: 1, borderColor: themeColors.line, borderRadius: Tokens.radius.md, paddingHorizontal: 12, paddingVertical: 11, fontSize: Type.bodyCompact.fontSize, color: themeColors.text, minHeight: 110 },

  // AIA closeout form rows — clean tappable list inside the binder card
  aiaFormRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: themeColors.line,
  },
  aiaFormIcon: {
    width: 36, height: 36,
    borderRadius: Tokens.radius.md,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  aiaFormTitle: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.text },
  aiaFormSub: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, marginTop: 2, lineHeight: 15 },

  maintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: themeColors.line },
  maintMain: { flex: 1, gap: 6 },
  maintTask: { fontSize: Type.footnote.fontSize, color: themeColors.text, fontWeight: '600', padding: 0 },
  maintMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  maintFreq: { flex: 1, fontSize: Type.caption2.fontSize, color: themeColors.textMuted, padding: 0 },

  actionBar: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: themeColors.line, backgroundColor: themeColors.surface },
  secondary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 13, borderRadius: 11, backgroundColor: themeColors.bg, borderWidth: 1, borderColor: themeColors.line },
  secondaryText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: themeColors.text },
  primary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 11, backgroundColor: themeColors.accent, shadowColor: themeColors.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.28, shadowRadius: 8, elevation: 4 },
  primaryText: { fontSize: Type.footnote.fontSize, fontWeight: '800', color: '#FFF' },
});
