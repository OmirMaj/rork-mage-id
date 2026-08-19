import React, { useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal, Platform, KeyboardAvoidingView,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import {
  Shield, Plus, X, Trash2, AlertTriangle, CheckCircle2, Clock,
  ChevronRight, FileText,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import type { Warranty, WarrantyCategory } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { PortalStatusPill } from '@/components/PortalStatusPill';
import { SendToClientButton } from '@/components/SendToClientButton';
import { showAlert } from '@/utils/alert';
import { warrantyStatus } from '@/utils/workflowPipelines';
import type { DerivedStatus } from '@/utils/workflowPipelines';

const CATEGORIES: { key: WarrantyCategory; label: string }[] = [
  { key: 'general', label: 'General' },
  { key: 'roofing', label: 'Roofing' },
  { key: 'plumbing', label: 'Plumbing' },
  { key: 'electrical', label: 'Electrical' },
  { key: 'hvac', label: 'HVAC' },
  { key: 'foundation', label: 'Foundation' },
  { key: 'windows', label: 'Windows' },
  { key: 'appliances', label: 'Appliances' },
  { key: 'finishes', label: 'Finishes' },
  { key: 'structural', label: 'Structural' },
  { key: 'other', label: 'Other' },
];

function addMonths(isoDate: string, months: number): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

// ─────────────────────────────────────────────────────────────
// Display status
//
// This is the set of states a warranty can be RENDERED in, and it is
// deliberately NOT `Warranty['status']`. warrantyStatus() also returns
// 'unknown' (endDate unparseable), and the previous code cast that away with
// `as Warranty['status']` on the strength of a comment claiming "endDate is a
// required field so NaN cannot occur". Read the arithmetic instead:
// ProjectContext maps a null `end_date` column to `endDate: ''`, and
// Date.parse('') is NaN — so 'unknown' is reachable from any Supabase row that
// never got an end date. With the cast in place that value then missed every
// statusMeta key and `meta.Icon` threw on render.
//
// Every one of these must land in exactly one summary bucket: TILE_STATUSES
// gets a metric tile, everything else gets a line under the tiles. The two
// Records below are typed so tsc refuses to compile a DisplayStatus that has
// neither.
// ─────────────────────────────────────────────────────────────
const DISPLAY_STATUSES = ['active', 'expiring_soon', 'expired', 'claimed', 'void', 'unknown'] as const;
type DisplayStatus = (typeof DISPLAY_STATUSES)[number];

const TILE_STATUSES = ['active', 'expiring_soon', 'expired'] as const;
type TileStatus = (typeof TILE_STATUSES)[number];

/** Sentence fragments for the statuses that have no tile of their own. */
const OVERFLOW_LABEL: Record<Exclude<DisplayStatus, TileStatus>, string> = {
  claimed: 'with an open claim',
  void: 'voided',
  unknown: 'missing an end date',
};
// Derived from the two lists rather than hand-written, so "has a tile" and
// "reported in the overflow line" can never both be false for a status.
const OVERFLOW_STATUSES = DISPLAY_STATUSES.filter(
  (s): s is Exclude<DisplayStatus, TileStatus> => !(TILE_STATUSES as readonly string[]).includes(s),
);

// Derive the warranty's status at READ time from its endDate — the stored
// `w.status` is only recomputed inside add/updateWarranty, so a warranty that
// silently crossed its endDate keeps rendering a stale "Active" pill. Delegates
// to the single shared warrantyStatus from workflowPipelines so there is one
// source of truth.
function deriveStatus(w: Warranty): DisplayStatus {
  const key = warrantyStatus(w, Date.now()).key;
  // DerivedStatus is shared with coiStatus, whose union spells the warning
  // state 'expiring'. warrantyStatus returns 'expiring_soon', but normalise
  // rather than assume — an alias must not fall through to 'unknown'.
  if (key === 'expiring') return 'expiring_soon';
  return (DISPLAY_STATUSES as readonly string[]).includes(key) ? (key as DisplayStatus) : 'unknown';
}

/** A warranty plus the status it should RENDER as (see DisplayStatus above). */
type WarrantyRow = Warranty & { displayStatus: DisplayStatus };

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Themed per-status chip styling — a FUNCTION of the palette (not a module
// static) so the chip fills flip with the theme instead of staying bright
// light-theme pastels on dark cards. Also kills the old hardcoded 'void'
// near-black chip (#1A1F26) that sat on a white card in light mode.
// Keyed by DisplayStatus (not Warranty['status']) so the Record is exhaustive
// over everything deriveStatus can actually produce — including 'unknown',
// whose absence used to crash the card renderer.
const statusMeta = (t: ThemeColors): Record<DisplayStatus, { label: string; color: string; bg: string; Icon: any }> => ({
  active: { label: 'Active', color: t.success, bg: t.successSoft, Icon: CheckCircle2 },
  expiring_soon: { label: 'Expiring Soon', color: t.warningLabel, bg: t.warningSoft, Icon: AlertTriangle },
  expired: { label: 'Expired', color: t.dangerLabel, bg: t.dangerSoft, Icon: Clock },
  claimed: { label: 'Claimed', color: t.info, bg: t.info + '1F', Icon: Shield },
  void: { label: 'Void', color: t.textSecondary, bg: t.surfaceAlt, Icon: X },
  unknown: { label: 'No End Date', color: t.textSecondary, bg: t.surfaceAlt, Icon: FileText },
});

export default function WarrantiesScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const {
    projects, getProject, warranties, addWarranty, updateWarranty, deleteWarranty,
    getWarrantiesForProject,
  } = useProjects();

  const project = useMemo(() => projectId ? getProject(projectId) : null, [projectId, getProject]);

  const list: WarrantyRow[] = useMemo(() => {
    const base = project
      ? getWarrantiesForProject(project.id)
      : [...warranties].sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());
    // Recompute status on read so an expired warranty stops showing "Active"
    // even though nothing wrote to it since it crossed its endDate. Kept in a
    // SEPARATE field: `displayStatus` can be 'unknown', which is not a member
    // of Warranty['status'], so overwriting `status` needed a lying cast.
    return base.map(w => ({ ...w, displayStatus: deriveStatus(w) }));
  }, [project, warranties, getWarrantiesForProject]);

  // One bucket per DisplayStatus, seeded from DISPLAY_STATUSES so the tally is
  // exhaustive by construction: sum(counts) === list.length, always. The old
  // code ran three independent `list.filter(...)` passes over three of the five
  // statuses, so a claimed or void warranty was counted nowhere and a
  // 4-warranty portfolio summed to 3.
  const counts = useMemo(() => {
    const out = Object.fromEntries(DISPLAY_STATUSES.map(s => [s, 0])) as Record<DisplayStatus, number>;
    for (const w of list) out[w.displayStatus] += 1;
    return out;
  }, [list]);

  const overflow = useMemo(
    () => OVERFLOW_STATUSES.filter(s => counts[s] > 0).map(s => `${counts[s]} ${OVERFLOW_LABEL[s]}`),
    [counts],
  );

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formProjectId, setFormProjectId] = useState<string>(project?.id ?? projects[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<WarrantyCategory>('general');
  const [provider, setProvider] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [durationMonths, setDurationMonths] = useState('12');
  const [coverage, setCoverage] = useState('');

  const resetForm = useCallback(() => {
    setEditingId(null);
    setFormProjectId(project?.id ?? projects[0]?.id ?? '');
    setTitle('');
    setCategory('general');
    setProvider('');
    setDescription('');
    setStartDate(new Date().toISOString().slice(0, 10));
    setDurationMonths('12');
    setCoverage('');
  }, [project, projects]);

  const openNew = useCallback(() => {
    resetForm();
    setShowForm(true);
  }, [resetForm]);

  const openEdit = useCallback((w: Warranty) => {
    setEditingId(w.id);
    setFormProjectId(w.projectId);
    setTitle(w.title);
    setCategory(w.category);
    setProvider(w.provider);
    setDescription(w.description ?? '');
    setStartDate(w.startDate.slice(0, 10));
    setDurationMonths(String(w.durationMonths));
    setCoverage(w.coverageDetails ?? '');
    setShowForm(true);
  }, []);

  const handleSave = useCallback(() => {
    if (!title.trim()) { showAlert('Missing Title', 'Please enter a warranty title.'); return; }
    if (!formProjectId) { showAlert('Missing Project', 'Please select a project.'); return; }
    const months = parseInt(durationMonths, 10);
    if (!Number.isFinite(months) || months <= 0) { showAlert('Invalid Duration', 'Enter months as a positive integer.'); return; }
    // Guard the start date before deriving start/end. new Date('garbage')
    // yields Invalid Date, whose toISOString() throws — and addMonths would
    // otherwise silently fall back to "today + N months", saving dates the GC
    // never intended with no warning.
    const startParsed = new Date(startDate);
    if (Number.isNaN(startParsed.getTime())) {
      showAlert('Invalid Start Date', 'Enter the start date as YYYY-MM-DD (e.g. 2026-07-14).');
      return;
    }
    const proj = projects.find(p => p.id === formProjectId);
    const startISO = startParsed.toISOString();
    const endISO = addMonths(startISO, months);
    const payload = {
      projectId: formProjectId,
      projectName: proj?.name ?? 'Project',
      title: title.trim(),
      category,
      description: description.trim() || undefined,
      provider: provider.trim() || 'Unknown',
      startDate: startISO,
      durationMonths: months,
      endDate: endISO,
      coverageDetails: coverage.trim() || undefined,
      reminderDays: 30,
    };
    if (editingId) {
      updateWarranty(editingId, payload);
    } else {
      addWarranty(payload);
    }
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setShowForm(false);
    resetForm();
  }, [title, formProjectId, durationMonths, projects, startDate, category, description, provider, coverage, editingId, updateWarranty, addWarranty, resetForm]);

  const handleDelete = useCallback((w: Warranty) => {
    showAlert('Delete Warranty', `Remove "${w.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteWarranty(w.id) },
    ]);
  }, [deleteWarranty]);

  const title_label = project ? `${project.name} · Warranties` : 'Warranties';

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: title_label,
        headerStyle: { backgroundColor: themeColors.bg },
        headerTintColor: "#FF6A1A",
        headerTitleStyle: { fontWeight: '700' as const, color: themeColors.text },
      }} />
      <ScrollView
        {...fabScroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Shield size={24} color={"#FF6A1A"} strokeWidth={1.75} />
          <Text style={styles.heroTitle}>Warranty Tracker</Text>
          <Text style={styles.heroSub}>Track active, expiring, and claimed warranties across projects.</Text>
        </View>

        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{counts.active}</Text>
            <Text style={styles.metricLabel}>Active</Text>
          </View>
          <View style={[styles.metricCard, { backgroundColor: themeColors.warningSoft }]}>
            <Text style={[styles.metricValue, { color: themeColors.warningLabel }]}>{counts.expiring_soon}</Text>
            <Text style={styles.metricLabel}>Expiring</Text>
          </View>
          <View style={[styles.metricCard, { backgroundColor: themeColors.dangerSoft }]}>
            <Text style={[styles.metricValue, { color: themeColors.dangerLabel }]}>{counts.expired}</Text>
            <Text style={styles.metricLabel}>Expired</Text>
          </View>
        </View>

        {/* Claimed / void / no-end-date warranties have no tile of their own —
            three tiles is all that fits legibly at phone width — but they are
            still in the portfolio, so they are reported here rather than
            silently dropped. Tiles + this line always account for every row. */}
        {overflow.length > 0 && (
          <Text style={styles.metricsOverflow}>
            Also tracking {overflow.join(' · ')}.
          </Text>
        )}

        {list.length === 0 ? (
          <View style={styles.emptyState}>
            <Shield size={36} color={"#9AA3AD"} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>No warranties yet</Text>
            <Text style={styles.emptyDesc}>Track equipment, roofing, HVAC, and finish warranties to protect your clients and your liability.</Text>
          </View>
        ) : (
          list.map(w => {
            const meta = statusMeta(themeColors)[w.displayStatus];
            const StatusIcon = meta.Icon;
            const derived: DerivedStatus = warrantyStatus(w, Date.now());
            const derivedColor = derived.tone === 'bad' ? themeColors.dangerLabel
              : derived.tone === 'warn' ? themeColors.warningLabel
              : derived.tone === 'good' ? themeColors.success
              : themeColors.textMuted;
            return (
              <TouchableOpacity key={w.id} style={styles.card} onPress={() => openEdit(w)} activeOpacity={0.85}>
                {/* The trash button is a FLOW child of this row, not an
                    absolutely-positioned overlay. It used to be
                    `position:'absolute', top:6, right:6, width:44` inside a
                    card whose padding is 16 — so it painted a 44px square
                    starting 34px left of the category label's right edge and
                    landed on top of it on every single card ("PLUMBI[trash]G").
                    In flow the row reserves the space it occupies, so no
                    padding arithmetic has to be kept in sync. */}
                <View style={styles.cardHeader}>
                  <View style={[styles.statusPill, { backgroundColor: meta.bg }]}>
                    <StatusIcon size={12} color={meta.color} />
                    <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                  <View style={styles.cardHeaderRight}>
                    <Text style={styles.categoryText} numberOfLines={1}>{CATEGORIES.find(c => c.key === w.category)?.label ?? w.category}</Text>
                    <TouchableOpacity
                      style={styles.deleteBtn}
                      onPress={(e) => { e.stopPropagation(); handleDelete(w); }}
                      // 32px box + 6px slop on every side = a 44x44 touch
                      // target, the iOS minimum, without a 44px block of
                      // dangerSoft dominating the card header.
                      hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete warranty ${w.title}`}
                    >
                      <Trash2 size={14} color={themeColors.dangerLabel} strokeWidth={1.75} />
                    </TouchableOpacity>
                  </View>
                </View>
                <Text style={styles.cardTitle} numberOfLines={1}>{w.title}</Text>
                {!project ? <Text style={styles.cardProject}>{w.projectName}</Text> : null}
                <Text style={styles.cardProvider}>Provider: {w.provider}</Text>
                <View style={styles.cardFooter}>
                  <Text style={styles.dateText}>{formatDate(w.startDate)} → {formatDate(w.endDate)}</Text>
                  <Text style={[styles.daysText, { color: derivedColor }]}>{derived.label}</Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}

        <TouchableOpacity style={styles.addBtn} onPress={openNew} activeOpacity={0.85}>
          <Plus size={18} color={"#FF6A1A"} strokeWidth={1.75} />
          <Text style={styles.addBtnText}>Add Warranty</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={showForm} transparent animationType="slide" onRequestClose={() => setShowForm(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>{editingId ? 'Edit Warranty' : 'New Warranty'}</Text>
                  <TouchableOpacity onPress={() => setShowForm(false)} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={20} color={"#9AA3AD"} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>

                {!project && (
                  <>
                    <Text style={styles.fieldLabel}>Project</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 4 }}>
                      {projects.map(p => (
                        <TouchableOpacity
                          key={p.id}
                          style={[styles.chip, formProjectId === p.id && styles.chipActive]}
                          onPress={() => setFormProjectId(p.id)}
                        >
                          <Text style={[styles.chipText, formProjectId === p.id && styles.chipTextActive]} numberOfLines={1}>{p.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </>
                )}

                <Text style={styles.fieldLabel}>Title</Text>
                <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Roof - 10-Year Manufacturer" placeholderTextColor={"#9AA3AD"} />

                <Text style={styles.fieldLabel}>Category</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 4 }}>
                  {CATEGORIES.map(c => (
                    <TouchableOpacity
                      key={c.key}
                      style={[styles.chip, category === c.key && styles.chipActive]}
                      onPress={() => setCategory(c.key)}
                    >
                      <Text style={[styles.chipText, category === c.key && styles.chipTextActive]}>{c.label}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={styles.fieldLabel}>Provider / Manufacturer</Text>
                <TextInput style={styles.input} value={provider} onChangeText={setProvider} placeholder="e.g. GAF, Carrier, Kohler" placeholderTextColor={"#9AA3AD"} />

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Start Date</Text>
                    <TextInput style={styles.input} value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" placeholderTextColor={"#9AA3AD"} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Duration (months)</Text>
                    <TextInput style={styles.input} value={durationMonths} onChangeText={setDurationMonths} keyboardType="number-pad" placeholder="12" placeholderTextColor={"#9AA3AD"} />
                  </View>
                </View>

                <Text style={styles.fieldLabel}>Coverage Details</Text>
                <TextInput style={[styles.input, { minHeight: 80, paddingTop: 12, textAlignVertical: 'top' as const }]} value={coverage} onChangeText={setCoverage} placeholder="What's covered (parts, labor, etc.)" placeholderTextColor={"#9AA3AD"} multiline />

                <Text style={styles.fieldLabel}>Notes</Text>
                <TextInput style={[styles.input, { minHeight: 60, paddingTop: 12, textAlignVertical: 'top' as const }]} value={description} onChangeText={setDescription} placeholder="Optional notes" placeholderTextColor={"#9AA3AD"} multiline />

                {editingId && (() => {
                  const editingWarranty = list.find(w => w.id === editingId);
                  if (!editingWarranty) return null;
                  return (
                    <>
                      <View style={{ marginTop: 12 }}>
                        <PortalStatusPill portalState={editingWarranty.portalState} itemUpdatedAt={editingWarranty.updatedAt} />
                      </View>
                      <SendToClientButton
                        kind="warranty"
                        itemId={editingWarranty.id}
                        projectId={editingWarranty.projectId}
                        portalState={editingWarranty.portalState}
                        itemUpdatedAt={editingWarranty.updatedAt}
                        canSend={title.trim().length > 0}
                        canSendReason={title.trim().length === 0 ? 'Add a warranty title before sending.' : undefined}
                      />
                    </>
                  );
                })()}

                <View style={styles.formActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowForm(false)}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85}>
                    <Text style={styles.saveBtnText}>{editingId ? 'Update' : 'Add Warranty'}</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  hero: { marginHorizontal: 20, marginTop: 16, marginBottom: 12, padding: 16, backgroundColor: t.accent + '10', borderRadius: Tokens.radius.panel, borderWidth: 1, borderColor: t.accent + '25', gap: 4 },
  heroTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text, marginTop: 4 },
  heroSub: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },
  metricsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginBottom: 16 },
  metricCard: { flex: 1, padding: 14, borderRadius: Tokens.radius.lg, backgroundColor: t.successSoft, alignItems: 'center' as const, gap: 2 },
  metricValue: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: t.success },
  metricLabel: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  metricsOverflow: { fontSize: Type.caption1.fontSize, color: t.textSecondary, paddingHorizontal: 20, marginTop: -8, marginBottom: 16 },
  emptyState: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 40, gap: 10 },
  emptyTitle: { fontSize: Type.body.fontSize, fontWeight: '700' as const, color: t.text },
  emptyDesc: { fontSize: Type.footnote.fontSize, color: t.textSecondary, textAlign: 'center' as const, lineHeight: 18 },
  card: { marginHorizontal: 20, marginBottom: 10, padding: 16, borderRadius: Tokens.radius.lg, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, gap: 4 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' as const, gap: 8, marginBottom: 4 },
  // Category + delete share the right end of the header. flexShrink lets the
  // category truncate (numberOfLines={1}) instead of squeezing the button.
  cardHeaderRight: { flexDirection: 'row', alignItems: 'center' as const, gap: 8, flexShrink: 1 },
  statusPill: { flexDirection: 'row', alignItems: 'center' as const, gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.sm },
  statusText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const },
  categoryText: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' as const, textTransform: 'uppercase' as const, letterSpacing: 0.3, flexShrink: 1 },
  cardTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  cardProject: { fontSize: Type.caption1.fontSize, color: t.accent, fontWeight: '600' as const },
  cardProvider: { fontSize: Type.footnote.fontSize, color: t.textSecondary },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' as const, marginTop: 6, paddingTop: 6, borderTopWidth: 0.5, borderTopColor: t.line },
  dateText: { fontSize: Type.caption1.fontSize, color: t.textMuted },
  daysText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const },
  // NOT absolutely positioned — see the comment at the render site. Anything
  // that overlays cardHeader lands on the category label.
  deleteBtn: { width: 32, height: 32, borderRadius: Tokens.radius.md, backgroundColor: t.dangerSoft, alignItems: 'center' as const, justifyContent: 'center' as const },
  addBtn: { flexDirection: 'row', alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8, marginHorizontal: 20, marginTop: 12, paddingVertical: 14, borderRadius: Tokens.radius.lg, backgroundColor: t.accent + '12', borderWidth: 1, borderColor: t.accent + '25' },
  addBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.accent },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' as const },
  modalCard: { backgroundColor: t.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 4, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' as const, marginBottom: 8 },
  modalTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: t.text },
  fieldLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.textSecondary, marginTop: 10, marginBottom: 4 },
  input: { minHeight: 44, borderRadius: Tokens.radius.card, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 14, fontSize: Type.subhead.fontSize, color: t.text },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Tokens.radius.md, backgroundColor: t.surfaceAlt },
  chipActive: { backgroundColor: t.accent },
  chipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.textSecondary },
  chipTextActive: { color: '#FFF' },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  cancelBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: t.surfaceAlt, alignItems: 'center' as const, justifyContent: 'center' as const },
  cancelBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  saveBtn: { flex: 2, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: t.accent, alignItems: 'center' as const, justifyContent: 'center' as const },
  saveBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: '#FFF' },
});
