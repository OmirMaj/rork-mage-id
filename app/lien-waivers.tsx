// lien-waivers — GC-side hub for managing lien waivers on a project.
// Generate one of the four waiver types pre-filled from a paid invoice
// or commitment. Status flows: requested → signed → received.
//
// Sub-portal-side signing is deferred to a follow-up push; for now the
// GC can also countersign on behalf of the sub when they have a paper
// waiver in hand (which is how a lot of GCs actually operate).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Platform, Modal,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Plus, FileSignature, FileDown, CheckCircle2,
  Clock, XCircle, Trash2, ShieldCheck, AlertTriangle,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { FeatureHeader } from '@/components/FeatureHeader';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import {
  fetchLienWaiversForProject, saveLienWaiver, deleteLienWaiver,
  shareLienWaiverPDF, WAIVER_LABELS,
} from '@/utils/lienWaiverEngine';
import { formatMoney } from '@/utils/formatters';
import { statusPillStyle } from '@/utils/statusPill';
import type { LienWaiver, LienWaiverType, CompanyBranding } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert, showPrompt } from '@/utils/alert';

export default function LienWaiversScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('lien_waiver_manager')) {
    return (
      <Paywall
        visible={true}
        feature="Lien Waiver Manager"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <LienWaiversScreenInner />;
}

function LienWaiversScreenInner() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { projectId, prefillFromInvoice, prefillAmount, prefillThroughDate } = useLocalSearchParams<{
    projectId: string;
    prefillFromInvoice?: string;
    prefillAmount?: string;
    prefillThroughDate?: string;
  }>();
  const { getProject, settings, getInvoicesForProject, getCommitmentsForProject, subcontractors } = useProjects() as any;
  const project = projectId ? getProject(projectId) : undefined;

  const [waivers, setWaivers] = useState<LienWaiver[]>([]);
  const [loading, setLoading] = useState(true);
  const [addModal, setAddModal] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);

  // Prefill seed for the New Waiver modal — populated when this screen
  // is opened with `prefillFromInvoice` query params (the "Collect a
  // lien waiver" CTA on a paid invoice). Resolves the sub from the
  // invoice's commitmentId so the GC doesn't have to retype the name.
  const prefillSeed = useMemo(() => {
    if (!prefillFromInvoice) return null;
    const invoice = (getInvoicesForProject(projectId ?? '') ?? []).find((i: any) => i.id === prefillFromInvoice);
    if (!invoice) return null;
    let subName = '';
    let subEmail: string | undefined;
    let subCompanyId: string | undefined;
    if (invoice.commitmentId) {
      const commit = (getCommitmentsForProject(projectId ?? '') ?? []).find((c: any) => c.id === invoice.commitmentId);
      if (commit) {
        subName = commit.vendorName ?? '';
        subCompanyId = commit.companyId ?? commit.subcontractorId;
        if (subCompanyId) {
          const sub = subcontractors?.find((s: any) => s.id === subCompanyId);
          if (sub) subEmail = sub.email ?? undefined;
        }
      }
    }
    return {
      invoiceId: prefillFromInvoice,
      commitmentId: invoice.commitmentId,
      subName,
      subEmail,
      subCompanyId,
      paidAmount: prefillAmount ? Number(prefillAmount) : (invoice.amountPaid ?? invoice.totalDue ?? 0),
      throughDate: prefillThroughDate ?? new Date().toISOString().slice(0, 10),
    };
  }, [prefillFromInvoice, projectId, prefillAmount, prefillThroughDate, getInvoicesForProject, getCommitmentsForProject, subcontractors]);

  // Auto-open the modal when arriving with prefill params.
  useEffect(() => {
    if (prefillSeed && !loading) setAddModal(true);
  }, [prefillSeed, loading]);

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

  const refresh = useCallback(async () => {
    if (!projectId) { setLoading(false); return; }
    const list = await fetchLienWaiversForProject(projectId);
    setWaivers(list);
  }, [projectId]);

  useEffect(() => {
    void (async () => {
      setLoading(true); await refresh(); setLoading(false);
    })();
  }, [refresh]);

  const handleCreate = useCallback(async (input: { waiverType: LienWaiverType; subName: string; subEmail?: string; throughDate: string; paidAmount: number; notes?: string }) => {
    if (!projectId || !input.subName.trim()) return;
    const saved = await saveLienWaiver({
      projectId,
      waiverType: input.waiverType,
      subName: input.subName.trim(),
      subEmail: input.subEmail?.trim() || undefined,
      throughDate: input.throughDate,
      paidAmount: input.paidAmount,
      notes: input.notes,
      status: 'requested',
      // Carry through any prefill linkage so the waiver references the
      // source invoice and commitment for downstream reporting.
      invoiceId: prefillSeed?.invoiceId,
      commitmentId: prefillSeed?.commitmentId,
      subCompanyId: prefillSeed?.subCompanyId,
    });
    if (saved) {
      setWaivers(prev => [saved, ...prev]);
      setAddModal(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      showAlert('Save failed', 'Could not save the waiver.');
    }
  }, [projectId, prefillSeed]);

  const handleExport = useCallback(async (w: LienWaiver) => {
    setExporting(w.id);
    try {
      await shareLienWaiverPDF(w, branding, project?.name ?? 'Project', project?.location);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      showAlert('Export failed', e instanceof Error ? e.message : 'Could not generate PDF.');
    } finally {
      setExporting(null);
    }
  }, [branding, project]);

  const handleStatusChange = useCallback(async (w: LienWaiver, status: LienWaiver['status']) => {
    const saved = await saveLienWaiver({ ...w, id: w.id, status });
    if (saved) setWaivers(prev => prev.map(x => x.id === w.id ? saved : x));
  }, []);

  const handleMarkSigned = useCallback(async (w: LienWaiver) => {
    const persist = async (rawName: string) => {
      const name = rawName.trim();
      if (!name || name.length < 2) {
        showAlert('Name required', 'Type the subcontractor\'s legal name to confirm signature.');
        return;
      }
      try {
        const saved = await saveLienWaiver({
          ...w, id: w.id,
          status: 'signed',
          signedAt: new Date().toISOString(),
          subSignature: { name, role: 'gc', signedAt: new Date().toISOString() },
        });
        if (saved) {
          setWaivers(prev => prev.map(x => x.id === w.id ? saved : x));
          if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        } else {
          showAlert('Save failed', 'Could not mark this waiver as signed. Try again.');
        }
      } catch (e) {
        showAlert('Save failed', e instanceof Error ? e.message : 'Try again.');
      }
    };
    // showPrompt covers every platform now (native Alert.prompt on iOS, the
    // themed modal on Android + web), so the old hand-rolled window.prompt
    // fallback this file carried for web is no longer needed.
    showPrompt(
      'Mark as signed',
      `Type the subcontractor's name to confirm they've signed the waiver:`,
      (name) => { if (name != null) void persist(name); },
      'plain-text',
      w.subName,
    );
  }, []);

  const handleDelete = useCallback((w: LienWaiver) => {
    showAlert(
      `Delete waiver for ${w.subName}?`,
      'This is permanent.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            const ok = await deleteLienWaiver(w.id);
            if (ok) setWaivers(prev => prev.filter(x => x.id !== w.id));
          },
        },
      ],
    );
  }, []);

  if (!project) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <EmptyState
          icon={<ShieldCheck size={36} color={themeColors.accent} strokeWidth={1.75} />}
          title="Lien waivers live inside a project"
          message="A lien waiver is tied to a specific job's payments, so it lives inside a project. To generate one:"
          steps={[
            'Open or create a project from the Projects tab.',
            'Tap Lien Waivers inside the project tile grid.',
            'Pick the waiver type — we auto-fill the sub, paid amount, and through-date.',
          ]}
          actionLabel="Open Projects"
          onAction={() => router.push('/(tabs)/(home)' as any)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={26} color={themeColors.accent} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>{project.name}</Text>
          <Text style={styles.title}>Lien Waivers</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => setAddModal(true)}>
          <Plus size={14} color="#FFF" strokeWidth={1.75} />
          <Text style={styles.addBtnText}>New</Text>
        </TouchableOpacity>
      </View>
      <FeatureHeader
        eyebrow="Lien Waivers"
        title="Sign-offs your bank wants"
        subtitle="A signed slip from each sub saying &ldquo;I&apos;ve been paid; I won&apos;t lien the job.&rdquo; Most lenders require these on every draw. We auto-fill from the invoice — you just pick the type."
        explainer={{
          term: 'Lien Waiver',
          definition: 'A lien waiver is a legal document a contractor or subcontractor signs giving up their right to file a mechanic\'s lien against the property for the amount they\'ve been paid. Banks require these on most draws to make sure no sub will come back later claiming they weren\'t paid.',
          whenToUse: [
            'Every time you pay a sub on a bank-financed project',
            'Before issuing the next progress draw to the lender',
            'At final payment / closeout (a "final unconditional waiver")',
          ],
        }}
      />

      <ScrollView {...fabScroll} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}>
        {loading && (
          <View style={styles.loading}><ActivityIndicator size="small" color={themeColors.accent} /></View>
        )}

        {!loading && waivers.length === 0 && (
          <View style={styles.emptyCard}>
            <ShieldCheck size={28} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>No waivers yet</Text>
            <Text style={styles.emptyBody}>
              Generate a lien waiver after every sub payment. Banks ask for them on every draw.
              We'll auto-fill the sub's name, paid amount, and through-date — you just pick the type.
            </Text>
            <TouchableOpacity style={styles.bigCta} onPress={() => setAddModal(true)}>
              <Plus size={14} color="#FFF" strokeWidth={1.75} />
              <Text style={styles.bigCtaText}>New waiver</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.disclaimer}>
          <AlertTriangle size={14} color={Colors.warning} strokeWidth={1.75} />
          <Text style={styles.disclaimerText}>
            Generic 4-type waivers cover ~38 states. CA, TX, FL, GA, AZ require state-specific
            statutory forms — consult an attorney for those.
          </Text>
        </View>

        {waivers.map(w => (
          <WaiverCard
            key={w.id}
            waiver={w}
            exporting={exporting === w.id}
            onExport={() => handleExport(w)}
            onMarkSigned={() => handleMarkSigned(w)}
            onMarkReceived={() => handleStatusChange(w, 'received')}
            onMarkVoid={() => handleStatusChange(w, 'voided')}
            onDelete={() => handleDelete(w)}
          />
        ))}
      </ScrollView>

      <NewWaiverModal
        visible={addModal}
        onClose={() => setAddModal(false)}
        onCreate={handleCreate}
        seed={prefillSeed}
      />
    </View>
  );
}

function WaiverCard({ waiver, exporting, onExport, onMarkSigned, onMarkReceived, onMarkVoid, onDelete }: {
  waiver: LienWaiver;
  exporting: boolean;
  onExport: () => void;
  onMarkSigned: () => void;
  onMarkReceived: () => void;
  onMarkVoid: () => void;
  onDelete: () => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const meta = WAIVER_LABELS[waiver.waiverType];
  // Use the shared statusPillStyle so SIGNED/RECEIVED/VOIDED/REQUESTED
  // match the same color scheme used on contract + closeout binder.
  // Icons stay per-status because they convey extra meaning beyond color.
  const statusIcons = {
    received: CheckCircle2,
    signed:   FileSignature,
    voided:   XCircle,
    requested: Clock,
  } as const;
  const Icon = statusIcons[waiver.status] ?? Clock;
  const labelMap: Record<typeof waiver.status, string> = {
    received: 'RECEIVED', signed: 'SIGNED', voided: 'VOIDED', requested: 'REQUESTED',
  };
  const { color: statusColor, backgroundColor: statusBg } = statusPillStyle(waiver.status);
  const statusCfg = { bg: statusBg, color: statusColor, label: labelMap[waiver.status] };
  const StatusIcon = Icon;

  return (
    <View style={styles.waiverCard}>
      <View style={styles.waiverHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.waiverType}>{meta.short.toUpperCase()}</Text>
          <Text style={styles.waiverSubName}>{waiver.subName}</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: statusCfg.bg }]}>
          <StatusIcon size={11} color={statusCfg.color} />
          <Text style={[styles.statusPillText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
        </View>
      </View>

      <View style={styles.waiverGrid}>
        <View style={styles.waiverField}>
          <Text style={styles.waiverFieldLabel}>Through</Text>
          <Text style={styles.waiverFieldValue}>{new Date(waiver.throughDate).toLocaleDateString()}</Text>
        </View>
        <View style={styles.waiverField}>
          <Text style={styles.waiverFieldLabel}>Amount</Text>
          <Text style={styles.waiverFieldValue}>{formatMoney(waiver.paidAmount)}</Text>
        </View>
      </View>

      {waiver.subSignature && (
        <View style={styles.sigPreview}>
          <FileSignature size={12} color={themeColors.success} strokeWidth={1.75} />
          <Text style={styles.sigPreviewText}>
            Signed by <Text style={{ fontWeight: '800' }}>{waiver.subSignature.name}</Text> on {new Date(waiver.subSignature.signedAt).toLocaleDateString()}
          </Text>
        </View>
      )}

      <View style={styles.waiverActions}>
        <TouchableOpacity style={styles.actionSecondary} onPress={onExport} disabled={exporting}>
          {exporting ? <ActivityIndicator size="small" color={themeColors.text} /> : (
            <>
              <FileDown size={13} color={themeColors.text} strokeWidth={1.75} />
              <Text style={styles.actionSecondaryText}>PDF</Text>
            </>
          )}
        </TouchableOpacity>
        {waiver.status === 'requested' && (
          <TouchableOpacity style={styles.actionPrimary} onPress={onMarkSigned}>
            <FileSignature size={13} color="#FFF" strokeWidth={1.75} />
            <Text style={styles.actionPrimaryText}>Mark signed</Text>
          </TouchableOpacity>
        )}
        {waiver.status === 'signed' && (
          <TouchableOpacity style={styles.actionPrimary} onPress={onMarkReceived}>
            <CheckCircle2 size={13} color="#FFF" strokeWidth={1.75} />
            <Text style={styles.actionPrimaryText}>Mark received</Text>
          </TouchableOpacity>
        )}
        {(waiver.status === 'requested' || waiver.status === 'signed') && (
          <TouchableOpacity style={styles.actionGhost} onPress={onMarkVoid}>
            <XCircle size={13} color={Colors.warning} strokeWidth={1.75} />
            <Text style={styles.actionGhostText}>Void</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.actionGhost} onPress={onDelete} accessibilityRole="button" accessibilityLabel="Delete"><Trash2 size={13} color={themeColors.danger} strokeWidth={1.75} /></TouchableOpacity>
      </View>
    </View>
  );
}

function NewWaiverModal({ visible, onClose, onCreate, seed }: {
  visible: boolean;
  onClose: () => void;
  onCreate: (input: { waiverType: LienWaiverType; subName: string; subEmail?: string; throughDate: string; paidAmount: number; notes?: string }) => void;
  /** Optional prefill from a "Create lien waiver" CTA on a paid invoice. */
  seed?: { subName?: string; subEmail?: string; paidAmount?: number; throughDate?: string } | null;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [type, setType] = useState<LienWaiverType>('unconditional_partial');
  const [subName, setSubName] = useState('');
  const [subEmail, setSubEmail] = useState('');
  const [throughDate, setThroughDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');

  useEffect(() => {
    if (visible) {
      setType('unconditional_partial');
      setSubName(seed?.subName ?? '');
      setSubEmail(seed?.subEmail ?? '');
      setThroughDate(seed?.throughDate ?? new Date().toISOString().slice(0, 10));
      setAmount(seed?.paidAmount ? String(seed.paidAmount) : '');
    }
  }, [visible, seed]);

  const handleSubmit = () => {
    const trimmedName = subName.trim();
    const trimmedEmail = subEmail.trim();
    const numericAmount = Number(amount);
    if (!trimmedName) {
      showAlert('Sub name required', 'Type the subcontractor\'s legal company or person name.');
      return;
    }
    if (!isFinite(numericAmount) || numericAmount <= 0) {
      showAlert('Amount required', 'Enter the dollar amount paid through this date.');
      return;
    }
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      showAlert('Email looks off', 'Either fix the email or leave it blank.');
      return;
    }
    onCreate({
      waiverType: type,
      subName: trimmedName,
      subEmail: trimmedEmail || undefined,
      throughDate,
      paidAmount: numericAmount,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>New lien waiver</Text>
          <Text style={styles.modalBody}>Pick the type, fill in the sub + amount, generate the PDF.</Text>

          <Text style={styles.modalLabel}>Type</Text>
          <View style={styles.typeRow}>
            {(['conditional_partial', 'unconditional_partial', 'conditional_final', 'unconditional_final'] as LienWaiverType[]).map(t => (
              <TouchableOpacity
                key={t}
                style={[styles.typeChip, type === t && styles.typeChipActive]}
                onPress={() => setType(t)}
              >
                <Text style={[styles.typeChipText, type === t && styles.typeChipTextActive]}>{WAIVER_LABELS[t].short}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.typeHint}>{WAIVER_LABELS[type].description}</Text>

          <Text style={styles.modalLabel}>Subcontractor name *</Text>
          <TextInput
            style={styles.modalInput}
            value={subName}
            onChangeText={setSubName}
            placeholder="Hallway Homes LLC"
            placeholderTextColor={themeColors.textMuted}
            autoCapitalize="words"
          />

          <Text style={styles.modalLabel}>Subcontractor email</Text>
          <TextInput
            style={styles.modalInput}
            value={subEmail}
            onChangeText={setSubEmail}
            placeholder="optional — for signing requests later"
            placeholderTextColor={themeColors.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <View style={styles.modalRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalLabel}>Through date</Text>
              <TextInput
                style={styles.modalInput}
                value={throughDate}
                onChangeText={setThroughDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={themeColors.textMuted}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalLabel}>Paid amount *</Text>
              <TextInput
                style={styles.modalInput}
                value={amount}
                onChangeText={setAmount}
                placeholder="0"
                placeholderTextColor={themeColors.textMuted}
                keyboardType="numeric"
              />
            </View>
          </View>

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalCancel} onPress={onClose}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalConfirm, (!subName.trim() || !amount) && styles.modalConfirmDisabled]}
              onPress={handleSubmit}
              disabled={!subName.trim() || !Number(amount) || Number(amount) <= 0}
            >
              <Plus size={14} color="#FFF" strokeWidth={1.75} />
              <Text style={styles.modalConfirmText}>Create</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  eyebrow: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.accent, letterSpacing: 1.4, textTransform: 'uppercase' },
  title:   { fontSize: Type.title3.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.4, marginTop: 4 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, backgroundColor: t.accentFill },
  addBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: '#FFF' },

  loading: { padding: 30, alignItems: 'center' },
  emptyCard: { backgroundColor: Colors.card, borderRadius: Tokens.radius.lg, padding: 28, alignItems: 'center', gap: 10, marginTop: 22, borderWidth: 1, borderColor: t.line },
  emptyTitle: { fontSize: Type.callout.fontSize, fontWeight: '800', color: t.text, marginTop: 4 },
  emptyBody:  { fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center', lineHeight: 19, maxWidth: 320 },
  bigCta: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 11, backgroundColor: t.accentFill, marginTop: 8 },
  bigCtaText: { color: '#FFF', fontSize: Type.bodyCompact.fontSize, fontWeight: '800' },

  disclaimer: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    padding: 12, borderRadius: Tokens.radius.md, marginBottom: 12,
    backgroundColor: Colors.warning + '0D',
    borderWidth: 1, borderColor: Colors.warning + '30',
  },
  disclaimerText: { flex: 1, fontSize: Type.caption2.fontSize, color: t.text, lineHeight: 16 },

  waiverCard: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.card, padding: 14,
    borderWidth: 1, borderColor: t.line,
    marginBottom: 10, gap: 10,
  },
  waiverHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  waiverType: { fontSize: 9, fontWeight: '800', color: t.accent, letterSpacing: 0.8 },
  waiverSubName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800', color: t.text, marginTop: 3 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full },
  statusPillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },

  waiverGrid: { flexDirection: 'row', gap: 12 },
  waiverField: { flex: 1, padding: 8, borderRadius: Tokens.radius.sm, backgroundColor: t.bg, borderWidth: 1, borderColor: t.line },
  waiverFieldLabel: { fontSize: 9, fontWeight: '800', color: t.textMuted, letterSpacing: 0.6 },
  waiverFieldValue: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text, marginTop: 2 },

  sigPreview: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: Tokens.radius.sm, backgroundColor: t.success + '0D', borderWidth: 1, borderColor: t.success + '30' },
  sigPreviewText: { flex: 1, fontSize: Type.caption2.fontSize, color: t.text },

  waiverActions: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  actionPrimary: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, backgroundColor: t.accentFill },
  actionPrimaryText: { fontSize: Type.caption1.fontSize, fontWeight: '800', color: '#FFF' },
  actionSecondary: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 9, backgroundColor: t.bg, borderWidth: 1, borderColor: t.line },
  actionSecondaryText: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.text },
  actionGhost: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 9 },
  actionGhostText: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: Colors.warning },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(11, 13, 16, 0.75)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, gap: 8 },
  modalTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: t.text },
  modalBody: { fontSize: Type.footnote.fontSize, color: t.textMuted, lineHeight: 18 },
  modalLabel: { fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.textMuted, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 8 },
  modalInput: {
    backgroundColor: t.bg, borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.md,
    paddingHorizontal: 12, paddingVertical: 11, fontSize: Type.bodyCompact.fontSize, color: t.text,
  },
  modalRow: { flexDirection: 'row', gap: 10, marginTop: -4 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  typeChip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9, backgroundColor: t.bg, borderWidth: 1, borderColor: t.line },
  typeChipActive: { backgroundColor: t.accent + '15', borderColor: t.accent },
  typeChipText: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.text },
  typeChipTextActive: { color: t.accent },
  typeHint: { fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 16, marginTop: 4, fontStyle: 'italic' },

  modalActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  modalCancel: { flex: 1, paddingVertical: 12, borderRadius: 11, backgroundColor: t.bg, alignItems: 'center', borderWidth: 1, borderColor: t.line },
  modalCancelText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  modalConfirm: { flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 11, backgroundColor: t.accentFill },
  modalConfirmDisabled: { opacity: 0.45 },
  modalConfirmText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800', color: '#FFF' },
});
