import React, { useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Modal, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Shield, Plus, X, Trash2, AlertTriangle, CheckCircle2, Clock,
  ChevronRight, FileText,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import type { Warranty, WarrantyCategory } from '@/types';

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

function daysBetween(a: string, b: string): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.ceil((new Date(a).getTime() - new Date(b).getTime()) / msPerDay);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const STATUS_META: Record<Warranty['status'], { label: string; color: string; bg: string; Icon: any }> = {
  active: { label: 'Active', color: '#34C759', bg: '#E8F5E9', Icon: CheckCircle2 },
  expiring_soon: { label: 'Expiring Soon', color: '#FF9500', bg: '#FFF3E0', Icon: AlertTriangle },
  expired: { label: 'Expired', color: Colors.error, bg: '#FFF0EF', Icon: Clock },
  claimed: { label: 'Claimed', color: Colors.info, bg: '#E3F2FD', Icon: Shield },
  void: { label: 'Void', color: Colors.textMuted, bg: Colors.fillTertiary, Icon: X },
};

export default function WarrantiesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const {
    projects, getProject, warranties, addWarranty, updateWarranty, deleteWarranty,
    getWarrantiesForProject,
  } = useProjects();

  const project = useMemo(() => projectId ? getProject(projectId) : null, [projectId, getProject]);

  const list: Warranty[] = useMemo(() => {
    if (project) return getWarrantiesForProject(project.id);
    return [...warranties].sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());
  }, [project, warranties, getWarrantiesForProject]);

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
    if (!title.trim()) { Alert.alert('Missing Title', 'Please enter a warranty title.'); return; }
    if (!formProjectId) { Alert.alert('Missing Project', 'Please select a project.'); return; }
    const months = parseInt(durationMonths, 10);
    if (!Number.isFinite(months) || months <= 0) { Alert.alert('Invalid Duration', 'Enter months as a positive integer.'); return; }
    const proj = projects.find(p => p.id === formProjectId);
    const startISO = new Date(startDate).toISOString();
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
    Alert.alert('Delete Warranty', `Remove "${w.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteWarranty(w.id) },
    ]);
  }, [deleteWarranty]);

  const title_label = project ? `${project.name} · Warranties` : 'Warranties';

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: title_label,
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
      }} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Shield size={24} color={Colors.primary} />
          <Text style={styles.heroTitle}>Warranty Tracker</Text>
          <Text style={styles.heroSub}>Track active, expiring, and claimed warranties across projects.</Text>
        </View>

        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{list.filter(w => w.status === 'active').length}</Text>
            <Text style={styles.metricLabel}>Active</Text>
          </View>
          <View style={[styles.metricCard, { backgroundColor: '#FFF3E0' }]}>
            <Text style={[styles.metricValue, { color: '#FF9500' }]}>{list.filter(w => w.status === 'expiring_soon').length}</Text>
            <Text style={styles.metricLabel}>Expiring</Text>
          </View>
          <View style={[styles.metricCard, { backgroundColor: '#FFF0EF' }]}>
            <Text style={[styles.metricValue, { color: Colors.error }]}>{list.filter(w => w.status === 'expired').length}</Text>
            <Text style={styles.metricLabel}>Expired</Text>
          </View>
        </View>

        {list.length === 0 ? (
          <View style={styles.emptyState}>
            <Shield size={36} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No warranties yet</Text>
            <Text style={styles.emptyDesc}>Track equipment, roofing, HVAC, and finish warranties to protect your clients and your liability.</Text>
          </View>
        ) : (
          list.map(w => {
            const meta = STATUS_META[w.status];
            const StatusIcon = meta.Icon;
            const daysLeft = daysBetween(w.endDate, new Date().toISOString());
            return (
              <TouchableOpacity key={w.id} style={styles.card} onPress={() => openEdit(w)} activeOpacity={0.85}>
                <View style={styles.cardHeader}>
                  <View style={[styles.statusPill, { backgroundColor: meta.bg }]}>
                    <StatusIcon size={12} color={meta.color} />
                    <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                  <Text style={styles.categoryText}>{CATEGORIES.find(c => c.key === w.category)?.label ?? w.category}</Text>
                </View>
                <Text style={styles.cardTitle} numberOfLines={1}>{w.title}</Text>
                {!project ? <Text style={styles.cardProject}>{w.projectName}</Text> : null}
                <Text style={styles.cardProvider}>Provider: {w.provider}</Text>
                <View style={styles.cardFooter}>
                  <Text style={styles.dateText}>{formatDate(w.startDate)} → {formatDate(w.endDate)}</Text>
                  <Text style={[styles.daysText, { color: daysLeft < 0 ? Colors.error : daysLeft <= 30 ? '#FF9500' : Colors.textSecondary }]}>
                    {daysLeft < 0 ? `${Math.abs(daysLeft)}d ago` : `${daysLeft}d left`}
                  </Text>
                </View>
                <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(w)}>
                  <Trash2 size={14} color={Colors.error} />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })
        )}

        <TouchableOpacity style={styles.addBtn} onPress={openNew} activeOpacity={0.85}>
          <Plus size={18} color={Colors.primary} />
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
                  <TouchableOpacity onPress={() => setShowForm(false)}>
                    <X size={20} color={Colors.textMuted} />
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
                <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Roof - 10-Year Manufacturer" placeholderTextColor={Colors.textMuted} />

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
                <TextInput style={styles.input} value={provider} onChangeText={setProvider} placeholder="e.g. GAF, Carrier, Kohler" placeholderTextColor={Colors.textMuted} />

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Start Date</Text>
                    <TextInput style={styles.input} value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.textMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Duration (months)</Text>
                    <TextInput style={styles.input} value={durationMonths} onChangeText={setDurationMonths} keyboardType="number-pad" placeholder="12" placeholderTextColor={Colors.textMuted} />
                  </View>
                </View>

                <Text style={styles.fieldLabel}>Coverage Details</Text>
                <TextInput style={[styles.input, { minHeight: 80, paddingTop: 12, textAlignVertical: 'top' as const }]} value={coverage} onChangeText={setCoverage} placeholder="What's covered (parts, labor, etc.)" placeholderTextColor={Colors.textMuted} multiline />

                <Text style={styles.fieldLabel}>Notes</Text>
                <TextInput style={[styles.input, { minHeight: 60, paddingTop: 12, textAlignVertical: 'top' as const }]} value={description} onChangeText={setDescription} placeholder="Optional notes" placeholderTextColor={Colors.textMuted} multiline />

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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  hero: { marginHorizontal: 20, marginTop: 16, marginBottom: 12, padding: 16, backgroundColor: Colors.primary + '10', borderRadius: 16, borderWidth: 1, borderColor: Colors.primary + '25', gap: 4 },
  heroTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text, marginTop: 4 },
  heroSub: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  metricsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginBottom: 16 },
  metricCard: { flex: 1, padding: 14, borderRadius: 14, backgroundColor: '#E8F5E9', alignItems: 'center' as const, gap: 2 },
  metricValue: { fontSize: 22, fontWeight: '800' as const, color: '#34C759' },
  metricLabel: { fontSize: 12, color: Colors.textSecondary, fontWeight: '600' as const },
  emptyState: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 40, gap: 10 },
  emptyTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text },
  emptyDesc: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' as const, lineHeight: 18 },
  card: { marginHorizontal: 20, marginBottom: 10, padding: 16, borderRadius: 14, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.cardBorder, gap: 4, position: 'relative' as const },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' as const, marginBottom: 4 },
  statusPill: { flexDirection: 'row', alignItems: 'center' as const, gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 11, fontWeight: '700' as const },
  categoryText: { fontSize: 11, color: Colors.textMuted, fontWeight: '600' as const, textTransform: 'uppercase' as const, letterSpacing: 0.3 },
  cardTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  cardProject: { fontSize: 12, color: Colors.primary, fontWeight: '600' as const },
  cardProvider: { fontSize: 13, color: Colors.textSecondary },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' as const, marginTop: 6, paddingTop: 6, borderTopWidth: 0.5, borderTopColor: Colors.borderLight },
  dateText: { fontSize: 12, color: Colors.textMuted },
  daysText: { fontSize: 12, fontWeight: '700' as const },
  deleteBtn: { position: 'absolute' as const, top: 10, right: 10, width: 26, height: 26, borderRadius: 6, backgroundColor: Colors.errorLight, alignItems: 'center' as const, justifyContent: 'center' as const },
  addBtn: { flexDirection: 'row', alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8, marginHorizontal: 20, marginTop: 12, paddingVertical: 14, borderRadius: 14, backgroundColor: Colors.primary + '12', borderWidth: 1, borderColor: Colors.primary + '25' },
  addBtnText: { fontSize: 15, fontWeight: '600' as const, color: Colors.primary },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' as const },
  modalCard: { backgroundColor: Colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 4, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' as const, marginBottom: 8 },
  modalTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  fieldLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary, marginTop: 10, marginBottom: 4 },
  input: { minHeight: 44, borderRadius: 12, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 14, fontSize: 15, color: Colors.text },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.fillTertiary },
  chipActive: { backgroundColor: Colors.primary },
  chipText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  chipTextActive: { color: '#FFF' },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  cancelBtn: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: Colors.fillTertiary, alignItems: 'center' as const, justifyContent: 'center' as const },
  cancelBtnText: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  saveBtn: { flex: 2, minHeight: 48, borderRadius: 14, backgroundColor: Colors.primary, alignItems: 'center' as const, justifyContent: 'center' as const },
  saveBtnText: { fontSize: 15, fontWeight: '700' as const, color: '#FFF' },
});
