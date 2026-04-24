// app/job-costing.tsx — Live job cost-to-complete dashboard for one project.
//
// The screen answers the only four questions a PM has on Monday morning:
//   1. Am I over budget?
//   2. Where?
//   3. How much worse will it get?
//   4. What's actually signed vs. still open?
//
// Data flow: pulls commitments/invoices/changeOrders from ProjectContext,
// feeds them into `computeJobCost` (utils/jobCostEngine.ts), and renders
// the result. No network calls here — everything's in-memory from existing
// state. Adding a commitment from this screen triggers a recompute on the
// next render because ProjectContext is the source of truth.

import React, { useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform,
  Modal, TextInput, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  DollarSign, TrendingUp, TrendingDown, AlertTriangle, Plus,
  FileSignature, ChevronRight, ChevronLeft, Trash2, X, Check,
  CheckCircle2, Clock,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { generateUUID } from '@/utils/generateId';
import {
  computeJobCost, formatMoney, formatMoneyFull,
  type JobCostLine, type JobCostSummary,
} from '@/utils/jobCostEngine';
import type { Commitment, CommitmentType } from '@/types';

// ─────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────

export default function JobCostingScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('job_costing')) {
    return (
      <Paywall
        visible={true}
        feature="Job Costing"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <JobCostingInner />;
}

function JobCostingInner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const {
    getProject, commitments, invoices, changeOrders,
    addCommitment, updateCommitment, deleteCommitment, subcontractors,
  } = useProjects();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);

  const summary: JobCostSummary | null = useMemo(() => {
    if (!project) return null;
    return computeJobCost({ project, commitments, invoices, changeOrders });
  }, [project, commitments, invoices, changeOrders]);

  const projectCommitments = useMemo(
    () => commitments.filter(c => c.projectId === (projectId ?? '')),
    [commitments, projectId],
  );

  const [editingCommitment, setEditingCommitment] = useState<Commitment | null>(null);
  const [showAdd, setShowAdd] = useState<boolean>(false);
  const [selectedPhase, setSelectedPhase] = useState<JobCostLine | null>(null);

  const handleDelete = useCallback((id: string) => {
    const exec = () => {
      deleteCommitment(id);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    };
    if (Platform.OS === 'web') { if (confirm('Remove this commitment?')) exec(); return; }
    Alert.alert('Remove commitment?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: exec },
    ]);
  }, [deleteCommitment]);

  if (!project) {
    return (
      <View style={styles.errorWrap}>
        <Stack.Screen options={{ title: 'Job Costing' }} />
        <Text style={styles.errorText}>Project not found.</Text>
      </View>
    );
  }

  if (!summary) return null;

  const variancePositive = summary.variance >= 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12}>
          <ChevronLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Job Costing · MAGE</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>{project.name}</Text>
        </View>
        <TouchableOpacity onPress={() => setShowAdd(true)} style={[styles.headerBtn, styles.headerCta]} hitSlop={8}>
          <Plus size={18} color={Colors.textOnPrimary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 + insets.bottom }}>

        {/* KPI cards */}
        <View style={styles.kpiGrid}>
          <KpiCard
            label="Budget"
            value={formatMoney(summary.budget)}
            subtitle={`${project.linkedEstimate?.items.length ?? 0} line items`}
            accent={Colors.primary}
            icon={DollarSign}
          />
          <KpiCard
            label="Committed"
            value={formatMoney(summary.committed)}
            subtitle={`${summary.commitmentCoverage.toFixed(0)}% of budget`}
            accent={Colors.info}
            icon={FileSignature}
          />
          <KpiCard
            label="Actual paid"
            value={formatMoney(summary.actual)}
            subtitle={`${summary.spendPercent.toFixed(0)}% of budget`}
            accent={Colors.text}
            icon={CheckCircle2}
          />
          <KpiCard
            label={variancePositive ? 'Under by' : 'Over by'}
            value={formatMoney(Math.abs(summary.variance))}
            subtitle={`Projected ${formatMoney(summary.projectedFinal)}`}
            accent={variancePositive ? Colors.success : Colors.error}
            icon={variancePositive ? TrendingDown : TrendingUp}
          />
        </View>

        {/* Projection banner — the TL;DR */}
        <View style={[styles.banner, {
          backgroundColor: variancePositive ? Colors.successLight : Colors.errorLight,
          borderLeftColor: variancePositive ? Colors.success : Colors.error,
        }]}>
          <Text style={styles.bannerTitle}>
            {variancePositive
              ? `On track to finish ${formatMoney(Math.abs(summary.variance))} under budget`
              : `Projecting ${formatMoney(Math.abs(summary.variance))} over budget`}
          </Text>
          <Text style={styles.bannerSub}>
            Method: paid + remaining committed + uncommitted budget floor
          </Text>
        </View>

        {/* Biggest variances call-out */}
        {summary.biggestVariances.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Biggest variances</Text>
            {summary.biggestVariances.map(p => (
              <TouchableOpacity key={p.phase} style={styles.varianceRow} onPress={() => setSelectedPhase(p)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.varianceName}>{p.phase}</Text>
                  <Text style={styles.varianceSub}>
                    {formatMoney(p.budget)} budgeted → {formatMoney(p.projectedFinal)} projected
                  </Text>
                </View>
                <Text style={[styles.varianceDelta, {
                  color: p.variance >= 0 ? Colors.success : Colors.error,
                }]}>
                  {formatMoney(p.variance, { sign: true })}
                </Text>
                <ChevronRight size={16} color={Colors.textSecondary} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Per-phase stacked bars */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>By phase</Text>
          {summary.byPhase.length === 0 ? (
            <Text style={styles.emptyText}>No phases yet — add a commitment or estimate items.</Text>
          ) : (
            summary.byPhase.map(p => (
              <PhaseBar key={p.phase} line={p} onPress={() => setSelectedPhase(p)} />
            ))
          )}
        </View>

        {/* Overcommitted warning */}
        {summary.overcommittedCommitments.length > 0 && (
          <View style={[styles.section, styles.warningSection]}>
            <View style={styles.warningHeader}>
              <AlertTriangle size={16} color={Colors.error} />
              <Text style={styles.warningTitle}>Over-committed against budget</Text>
            </View>
            {summary.overcommittedCommitments.map(c => (
              <Text key={c.id} style={styles.warningItem}>
                • {c.description || c.number} — {formatMoney(c.amount + (c.changeAmount ?? 0))}
              </Text>
            ))}
          </View>
        )}

        {/* Commitments list */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Commitments ({projectCommitments.length})</Text>
            <TouchableOpacity onPress={() => setShowAdd(true)} style={styles.addLink}>
              <Plus size={14} color={Colors.primary} />
              <Text style={styles.addLinkText}>Add</Text>
            </TouchableOpacity>
          </View>
          {projectCommitments.length === 0 ? (
            <View style={styles.emptyBox}>
              <FileSignature size={22} color={Colors.textMuted} />
              <Text style={styles.emptyText}>
                Log signed subcontracts and POs here. They drive your cost-to-complete.
              </Text>
              <TouchableOpacity style={styles.emptyCta} onPress={() => setShowAdd(true)}>
                <Text style={styles.emptyCtaText}>Add first commitment</Text>
              </TouchableOpacity>
            </View>
          ) : (
            projectCommitments.map(c => {
              const sub = c.subcontractorId ? subcontractors.find(s => s.id === c.subcontractorId) : null;
              const vendorLabel = sub?.companyName ?? c.vendorName ?? '—';
              return (
                <TouchableOpacity
                  key={c.id}
                  style={styles.commitmentRow}
                  onPress={() => setEditingCommitment(c)}
                >
                  <View style={styles.commitmentNumBox}>
                    <Text style={styles.commitmentNumText}>{c.number || '—'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.commitmentTitle} numberOfLines={1}>
                      {c.description || '(no description)'}
                    </Text>
                    <Text style={styles.commitmentSub} numberOfLines={1}>
                      {vendorLabel} · {c.type === 'subcontract' ? 'Subcontract' : 'PO'}
                      {c.phase ? ` · ${c.phase}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.commitmentAmount}>
                    {formatMoney(c.amount + (c.changeAmount ?? 0))}
                  </Text>
                  <StatusChip status={c.status} />
                  <TouchableOpacity onPress={() => handleDelete(c.id)} hitSlop={8} style={styles.deleteBtn}>
                    <Trash2 size={14} color={Colors.error} />
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            })
          )}
        </View>

        <Text style={styles.footerNote}>
          Budget includes approved change orders. Actual is sum of invoice payments. EAC assumes
          remaining committed work lands at signed price; uncommitted budget is a floor.
        </Text>
      </ScrollView>

      {/* Add / edit modal */}
      <CommitmentEditor
        visible={showAdd || !!editingCommitment}
        projectId={projectId ?? ''}
        existing={editingCommitment}
        onClose={() => { setShowAdd(false); setEditingCommitment(null); }}
        onSave={(c, isNew) => {
          if (isNew) addCommitment(c); else updateCommitment(c.id, c);
          setShowAdd(false);
          setEditingCommitment(null);
          if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }}
      />

      {/* Phase detail modal */}
      <PhaseDetailModal
        line={selectedPhase}
        summary={summary}
        onClose={() => setSelectedPhase(null)}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Smaller pieces
// ─────────────────────────────────────────────────────────────

interface IconLike { size?: number; color?: string }

function KpiCard({ label, value, subtitle, accent, icon: Icon }: {
  label: string; value: string; subtitle?: string; accent: string;
  icon: React.ComponentType<IconLike>;
}) {
  return (
    <View style={[styles.kpiCard, { borderLeftColor: accent }]}>
      <View style={styles.kpiHeader}>
        <Icon size={14} color={accent} />
        <Text style={styles.kpiLabel}>{label}</Text>
      </View>
      <Text style={[styles.kpiValue, { color: accent }]}>{value}</Text>
      {subtitle ? <Text style={styles.kpiSub}>{subtitle}</Text> : null}
    </View>
  );
}

function PhaseBar({ line, onPress }: { line: JobCostLine; onPress: () => void }) {
  const max = Math.max(line.budget, line.projectedFinal, 1);
  const actualPct = (line.actual / max) * 100;
  const committedPct = (Math.max(0, line.committed - line.actual) / max) * 100;
  const budgetPct = (line.budget / max) * 100;
  const projectedPct = (line.projectedFinal / max) * 100;

  const statusColor = line.status === 'over' ? Colors.error : line.status === 'warning' ? Colors.warning : Colors.success;
  const statusLabel = line.status === 'over' ? 'Over' : line.status === 'warning' ? 'Watch' : 'On track';

  return (
    <TouchableOpacity style={styles.phaseWrap} onPress={onPress}>
      <View style={styles.phaseHeaderRow}>
        <Text style={styles.phaseName} numberOfLines={1}>{line.phase}</Text>
        <View style={[styles.phasePill, { backgroundColor: `${statusColor}22` }]}>
          <Text style={[styles.phasePillText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      <View style={styles.phaseTrack}>
        {/* Committed (remaining) underlay */}
        <View style={[styles.trackSeg, { width: `${actualPct + committedPct}%`, backgroundColor: Colors.info, opacity: 0.35 }]} />
        {/* Actual solid */}
        <View style={[styles.trackSeg, { width: `${actualPct}%`, backgroundColor: Colors.primary }]} />
        {/* Budget tick line */}
        <View style={[styles.budgetTick, { left: `${budgetPct}%` }]} />
        {/* Projected final marker */}
        <View style={[styles.projectedTick, { left: `${projectedPct}%`, backgroundColor: statusColor }]} />
      </View>

      <View style={styles.phaseNumbers}>
        <Text style={styles.phaseNumber}>Budget <Text style={styles.phaseNumberBold}>{formatMoney(line.budget)}</Text></Text>
        <Text style={styles.phaseNumber}>Committed <Text style={styles.phaseNumberBold}>{formatMoney(line.committed)}</Text></Text>
        <Text style={styles.phaseNumber}>Actual <Text style={styles.phaseNumberBold}>{formatMoney(line.actual)}</Text></Text>
        <Text style={styles.phaseNumber}>EAC <Text style={[styles.phaseNumberBold, { color: statusColor }]}>{formatMoney(line.projectedFinal)}</Text></Text>
      </View>
    </TouchableOpacity>
  );
}

function StatusChip({ status }: { status: Commitment['status'] }) {
  const { color, label } = status === 'active'
    ? { color: Colors.success, label: 'Active' }
    : status === 'draft' ? { color: Colors.textSecondary, label: 'Draft' }
    : { color: Colors.info, label: 'Closed' };
  return (
    <View style={[styles.statusChip, { backgroundColor: `${color}22` }]}>
      <Text style={[styles.statusChipText, { color }]}>{label}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Add / edit modal
// ─────────────────────────────────────────────────────────────

interface CommitmentEditorProps {
  visible: boolean;
  projectId: string;
  existing: Commitment | null;
  onClose: () => void;
  onSave: (c: Commitment, isNew: boolean) => void;
}

function CommitmentEditor({ visible, projectId, existing, onClose, onSave }: CommitmentEditorProps) {
  const { subcontractors } = useProjects();
  const [number, setNumber] = useState<string>('');
  const [type, setType] = useState<CommitmentType>('subcontract');
  const [description, setDescription] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [phase, setPhase] = useState<string>('');
  const [signedDate, setSignedDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [subId, setSubId] = useState<string>('');
  const [vendorName, setVendorName] = useState<string>('');

  React.useEffect(() => {
    if (existing) {
      setNumber(existing.number);
      setType(existing.type);
      setDescription(existing.description);
      setAmount(String(existing.amount));
      setPhase(existing.phase ?? '');
      setSignedDate(existing.signedDate);
      setSubId(existing.subcontractorId ?? '');
      setVendorName(existing.vendorName ?? '');
    } else if (visible) {
      setNumber(`C-${Math.floor(1000 + Math.random() * 9000)}`);
      setType('subcontract');
      setDescription('');
      setAmount('');
      setPhase('');
      setSignedDate(new Date().toISOString().slice(0, 10));
      setSubId('');
      setVendorName('');
    }
  }, [existing, visible]);

  const handleSave = () => {
    const amt = Number(amount) || 0;
    if (!description.trim() || amt <= 0) {
      Alert.alert('Missing info', 'Add a description and an amount.');
      return;
    }
    const now = new Date().toISOString();
    const c: Commitment = {
      id: existing?.id ?? generateUUID(),
      projectId,
      number: number.trim() || `C-${Date.now()}`,
      type,
      description: description.trim(),
      amount: amt,
      changeAmount: existing?.changeAmount ?? 0,
      signedDate,
      phase: phase.trim() || undefined,
      subcontractorId: type === 'subcontract' ? (subId || undefined) : undefined,
      vendorName: type === 'purchase_order' ? (vendorName.trim() || undefined) : undefined,
      status: existing?.status ?? 'active',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    onSave(c, !existing);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalOverlay}
      >
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{existing ? 'Edit commitment' : 'New commitment'}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}><X size={20} color={Colors.text} /></TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 500 }}>
            <View style={styles.segWrap}>
              {(['subcontract', 'purchase_order'] as CommitmentType[]).map(t => (
                <TouchableOpacity
                  key={t}
                  onPress={() => setType(t)}
                  style={[styles.segBtn, type === t && styles.segBtnActive]}
                >
                  <Text style={[styles.segBtnText, type === t && styles.segBtnTextActive]}>
                    {t === 'subcontract' ? 'Subcontract' : 'Purchase order'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Field label="Number">
              <TextInput style={styles.input} value={number} onChangeText={setNumber} placeholder="C-1001" />
            </Field>

            <Field label="Description">
              <TextInput style={styles.input} value={description} onChangeText={setDescription}
                placeholder="Electrical rough-in, 1st floor" />
            </Field>

            <Field label="Amount (USD)">
              <TextInput style={styles.input} value={amount} onChangeText={setAmount}
                keyboardType="decimal-pad" placeholder="45000" />
            </Field>

            <Field label="Phase (optional)">
              <TextInput style={styles.input} value={phase} onChangeText={setPhase} placeholder="Electrical" />
            </Field>

            <Field label="Signed date">
              <TextInput style={styles.input} value={signedDate} onChangeText={setSignedDate}
                placeholder="YYYY-MM-DD" />
            </Field>

            {type === 'subcontract' ? (
              <Field label="Subcontractor">
                <View style={styles.subList}>
                  {subcontractors.length === 0 ? (
                    <Text style={styles.emptyText}>No subs yet. You can still save a vendor name.</Text>
                  ) : subcontractors.map(s => (
                    <TouchableOpacity key={s.id}
                      style={[styles.subChip, subId === s.id && styles.subChipActive]}
                      onPress={() => setSubId(subId === s.id ? '' : s.id)}
                    >
                      <Text style={[styles.subChipText, subId === s.id && styles.subChipTextActive]}>
                        {s.companyName} · {s.trade}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </Field>
            ) : (
              <Field label="Vendor name">
                <TextInput style={styles.input} value={vendorName} onChangeText={setVendorName}
                  placeholder="Acme Supply Co." />
              </Field>
            )}
          </ScrollView>

          <View style={styles.modalFooter}>
            <TouchableOpacity onPress={onClose} style={styles.btnGhost}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSave} style={styles.btnPrimary}>
              <Check size={16} color={Colors.textOnPrimary} />
              <Text style={styles.btnPrimaryText}>{existing ? 'Save' : 'Add'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Phase drill-down modal
// ─────────────────────────────────────────────────────────────

function PhaseDetailModal({ line, summary, onClose }: {
  line: JobCostLine | null;
  summary: JobCostSummary;
  onClose: () => void;
}) {
  if (!line) return null;
  const variancePositive = line.variance >= 0;
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{line.phase}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}><X size={20} color={Colors.text} /></TouchableOpacity>
          </View>
          <View style={{ padding: 16 }}>
            <DetailRow label="Budget" value={formatMoneyFull(line.budget)} />
            <DetailRow label="Committed" value={formatMoneyFull(line.committed)} />
            <DetailRow label="Actual paid" value={formatMoneyFull(line.actual)} />
            <DetailRow label="Projected final" value={formatMoneyFull(line.projectedFinal)} bold />
            <View style={styles.detailDivider} />
            <DetailRow
              label="Variance"
              value={`${variancePositive ? 'Under' : 'Over'} by ${formatMoney(Math.abs(line.variance))}`}
              color={variancePositive ? Colors.success : Colors.error}
              bold
            />
            <View style={styles.detailDivider} />
            <DetailRow label="Commitments" value={`${line.sources.commitments}`} />
            <DetailRow label="Invoices contributed" value={`${line.sources.invoices}`} />
            <DetailRow label="COs contributed" value={`${line.sources.changeOrders}`} />

            <Text style={styles.detailNote}>
              This phase is {((line.budget / Math.max(1, summary.budget)) * 100).toFixed(1)}% of
              the project budget. Burn ratio {(line.burnRatio * 100).toFixed(0)}%.
            </Text>
          </View>

          <View style={styles.modalFooter}>
            <TouchableOpacity onPress={onClose} style={styles.btnPrimary}>
              <Text style={styles.btnPrimaryText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function DetailRow({ label, value, bold, color }: {
  label: string; value: string; bold?: boolean; color?: string;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[
        styles.detailValue,
        bold && { fontWeight: '700' },
        color && { color },
      ]}>{value}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  errorWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { fontSize: 15, color: Colors.textSecondary },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 12, paddingTop: 6,
    gap: 8, borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  headerBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.fillTertiary,
  },
  headerCta: { backgroundColor: Colors.primary },
  headerText: { flex: 1 },
  headerEyebrow: { fontSize: 10, color: Colors.primary, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },

  // KPI grid
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  kpiCard: {
    flexBasis: '48%', backgroundColor: Colors.card, borderRadius: 12, padding: 14,
    borderLeftWidth: 3, shadowColor: Colors.shadow, shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1, shadowRadius: 2, elevation: 1,
  },
  kpiHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  kpiLabel: { fontSize: 11, color: Colors.textSecondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  kpiValue: { fontSize: 22, fontWeight: '800', marginBottom: 2 },
  kpiSub: { fontSize: 11, color: Colors.textMuted },

  // Banner
  banner: {
    borderRadius: 12, padding: 14, marginBottom: 16, borderLeftWidth: 4,
  },
  bannerTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  bannerSub: { fontSize: 11, color: Colors.textSecondary, marginTop: 3 },

  // Sections
  section: {
    backgroundColor: Colors.card, borderRadius: 12, padding: 14, marginBottom: 12,
    shadowColor: Colors.shadow, shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1, shadowRadius: 2, elevation: 1,
  },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: Colors.text, marginBottom: 10 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  addLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addLinkText: { fontSize: 13, color: Colors.primary, fontWeight: '600' },

  warningSection: { backgroundColor: Colors.errorLight, borderWidth: 1, borderColor: `${Colors.error}40` },
  warningHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  warningTitle: { fontSize: 13, fontWeight: '700', color: Colors.error },
  warningItem: { fontSize: 12, color: Colors.text, marginLeft: 6, marginTop: 2 },

  // Variance rows
  varianceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  varianceName: { fontSize: 14, fontWeight: '600', color: Colors.text },
  varianceSub: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  varianceDelta: { fontSize: 14, fontWeight: '700' },

  // Phase bar
  phaseWrap: {
    paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: Colors.borderLight,
  },
  phaseHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  phaseName: { fontSize: 13, fontWeight: '700', color: Colors.text, flex: 1 },
  phasePill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  phasePillText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  phaseTrack: {
    height: 14, backgroundColor: Colors.fillSecondary, borderRadius: 4, overflow: 'hidden',
    position: 'relative', marginBottom: 6,
  },
  trackSeg: { height: 14, position: 'absolute', top: 0, left: 0 },
  budgetTick: { position: 'absolute', width: 2, height: 14, backgroundColor: Colors.text, top: 0 },
  projectedTick: { position: 'absolute', width: 3, height: 14, top: 0, borderRadius: 1 },
  phaseNumbers: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  phaseNumber: { fontSize: 10.5, color: Colors.textSecondary },
  phaseNumberBold: { fontWeight: '700', color: Colors.text },

  // Commitment rows
  commitmentRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: Colors.borderLight,
  },
  commitmentNumBox: {
    width: 44, paddingVertical: 4, borderRadius: 6, backgroundColor: Colors.fillSecondary,
    alignItems: 'center',
  },
  commitmentNumText: { fontSize: 10, fontWeight: '700', color: Colors.text },
  commitmentTitle: { fontSize: 13, fontWeight: '600', color: Colors.text },
  commitmentSub: { fontSize: 11, color: Colors.textSecondary, marginTop: 1 },
  commitmentAmount: { fontSize: 13, fontWeight: '700', color: Colors.text, fontVariant: ['tabular-nums'] },
  deleteBtn: { padding: 4 },
  statusChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  statusChipText: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },

  // Empty state
  emptyBox: { alignItems: 'center', padding: 20 },
  emptyText: { fontSize: 12, color: Colors.textSecondary, textAlign: 'center', marginTop: 8, marginBottom: 8 },
  emptyCta: { backgroundColor: Colors.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  emptyCtaText: { color: Colors.textOnPrimary, fontSize: 13, fontWeight: '700' },

  footerNote: { fontSize: 10, color: Colors.textMuted, textAlign: 'center', marginTop: 16, lineHeight: 14, paddingHorizontal: 16 },

  // Modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: Colors.overlay },
  modalCard: { backgroundColor: Colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '90%' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },
  modalFooter: { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: Colors.borderLight },

  btnGhost: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 10, backgroundColor: Colors.fillSecondary },
  btnGhostText: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  btnPrimary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.primary },
  btnPrimaryText: { color: Colors.textOnPrimary, fontSize: 14, fontWeight: '700' },

  // Form
  segWrap: { flexDirection: 'row', margin: 16, backgroundColor: Colors.fillSecondary, borderRadius: 10, padding: 2 },
  segBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  segBtnActive: { backgroundColor: Colors.surface },
  segBtnText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  segBtnTextActive: { color: Colors.text },

  fieldWrap: { marginHorizontal: 16, marginBottom: 12 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  input: {
    backgroundColor: Colors.fillSecondary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: Colors.text,
  },

  subList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  subChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.fillSecondary },
  subChipActive: { backgroundColor: Colors.primary },
  subChipText: { fontSize: 12, color: Colors.text },
  subChipTextActive: { color: Colors.textOnPrimary, fontWeight: '700' },

  // Detail modal
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  detailLabel: { fontSize: 13, color: Colors.textSecondary },
  detailValue: { fontSize: 13, color: Colors.text, fontVariant: ['tabular-nums'] },
  detailDivider: { height: 1, backgroundColor: Colors.borderLight, marginVertical: 6 },
  detailNote: { fontSize: 11, color: Colors.textMuted, marginTop: 14, lineHeight: 15 },
});

// This is exported so other screens can embed a mini job-cost summary if needed.
export { Clock };
