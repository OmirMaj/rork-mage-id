// qc-checklists.tsx — Quality Control checklists, separate from punch.
//
// Why this exists (per the gap audit): "punch list" is end-of-project,
// reactive. QC checklists are during-construction, preventive. Every
// premium PM tool ships templated trade checklists; MAGE ID didn't.
//
// Out of the box we ship 8 trade-templated checklists. Users can also
// build custom ones. The template list is the moat — competitors ship
// generic forms; we ship contractor-specific ones in the language a
// site super uses ("pre-rock walls", "pre-pour foundation").
//
// Two-sided angle (per the all-in-one architecture):
//   - GC side: runs these during execution
//   - Homeowner side: doesn't see the checklist itself but benefits
//     from a better-built project — and the closeout binder
//     auto-includes signed-off QC reports as proof of due diligence
//
// Storage: tertiary_qc_checklists (local-first, syncs through
// OfflineSyncManager when a Supabase mirror is added in v2).

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ClipboardCheck, Check, ChevronRight, Plus, X } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { generateUUID } from '@/utils/generateId';

interface ChecklistItem {
  id: string;
  text: string;
  /** `passed` | `failed` | `na` | null (not yet checked) */
  status: 'passed' | 'failed' | 'na' | null;
  notes?: string;
}

interface Checklist {
  id: string;
  projectId: string | null;
  templateKey: string;
  title: string;
  trade: string;
  createdAt: string;
  completedAt?: string;
  inspector: string;
  items: ChecklistItem[];
}

const STORAGE_KEY = 'tertiary_qc_checklists';

// ─── 8 templated trade checklists ────────────────────────────────
// These are the highest-frequency QC moments in residential / small-
// commercial. Contractor-specific phrasing, not generic.

interface ChecklistTemplate {
  key: string;
  title: string;
  trade: string;
  items: string[];
}

const TEMPLATES: ChecklistTemplate[] = [
  {
    key: 'pre-pour-foundation',
    title: 'Pre-pour foundation',
    trade: 'Concrete',
    items: [
      'Forms plumb and braced',
      'Rebar size matches structural drawings',
      'Rebar clearances (3" to earth, 1.5" to forms)',
      'Anchor bolts placed per layout',
      'Vapor barrier intact, taped at seams',
      'Insulation continuous under slab (if required)',
      'PT sleeves through stem walls',
      'Utility stub-outs (water, sewer, electrical conduit) placed',
      'Inspection passed (city/AHJ)',
      'Concrete slump and strength match spec',
    ],
  },
  {
    key: 'pre-rock-walls',
    title: 'Pre-rock walls',
    trade: 'Framing/Drywall',
    items: [
      'All electrical rough-in inspected',
      'Plumbing rough-in inspected',
      'HVAC rough-in inspected',
      'Insulation installed and inspected',
      'Vapor barrier installed (climate-appropriate)',
      'Fire blocking installed where required',
      'Backing in place for: TVs, vanities, towel bars, grab bars',
      'Communication wiring complete',
      'Smoke detector wiring at correct locations',
      'No exposed sharp objects (foreman walk)',
    ],
  },
  {
    key: 'pre-rock-ceilings',
    title: 'Pre-rock ceilings',
    trade: 'Framing/Drywall',
    items: [
      'HVAC supply / return locations verified',
      'Recessed light cans aligned and braced',
      'Ceiling fan box rated for fan weight',
      'Smoke detector locations correct',
      'Attic access locations correct',
      'Insulation baffles at eaves',
    ],
  },
  {
    key: 'drywall-mockup',
    title: 'Drywall mockup approval',
    trade: 'Drywall',
    items: [
      'Texture sample matches spec',
      'Owner / designer sign-off on mockup',
      'Corner bead style matches throughout',
      'Level 4 vs Level 5 finish confirmed',
    ],
  },
  {
    key: 'rough-electrical',
    title: 'Rough electrical',
    trade: 'Electrical',
    items: [
      'Panel size per load calc',
      'Wire gauge correct per circuit',
      'GFCI / AFCI per code (kitchens, baths, bedrooms)',
      'Boxes at correct heights (46" countertop, 12" floor outlets)',
      'Romex stapled within 8" of box',
      'Grounding installed at all metal boxes',
      'Service entrance per utility spec',
      'Inspection passed',
    ],
  },
  {
    key: 'rough-plumbing',
    title: 'Rough plumbing',
    trade: 'Plumbing',
    items: [
      'DWV layout matches plans',
      'Cleanouts accessible at every change of direction',
      'Vents extend min 6" above flood rim',
      'Slope on horizontal lines (1/4" per foot)',
      'Hangers/strapping per code',
      'Air test held for required duration',
      'Inspection passed',
    ],
  },
  {
    key: 'roofing-dry-in',
    title: 'Roofing dry-in',
    trade: 'Roofing',
    items: [
      'Sheathing nailing pattern matches spec',
      'Underlayment / synthetic felt continuous',
      'Ice-and-water shield at eaves and valleys (climate zone)',
      'Drip edge installed before underlayment at eaves',
      'Flashing at sidewalls and chimneys',
      'Vent stack boots in place',
      'Tarps removed; no penetrations during weather window',
    ],
  },
  {
    key: 'window-install',
    title: 'Window install',
    trade: 'Carpentry',
    items: [
      'Rough opening matches window manufacturer spec',
      'Sill flashing pan installed and lapped',
      'Sealant at jambs (not at sill drain holes)',
      'Window square and plumb',
      'Shims at correct locations (not at sill mid-span)',
      'Manufacturer install instructions retained for warranty',
    ],
  },
];

export default function QCChecklistsScreen() {
  const insets = useSafeAreaInsets();
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (cancelled) return;
        if (raw) setChecklists(JSON.parse(raw));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const save = useCallback(async (next: Checklist[]) => {
    setChecklists(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const handleAddFromTemplate = useCallback((t: ChecklistTemplate) => {
    const list: Checklist = {
      id: generateUUID(),
      projectId: null,
      templateKey: t.key,
      title: t.title,
      trade: t.trade,
      createdAt: new Date().toISOString(),
      inspector: '',
      items: t.items.map(text => ({ id: generateUUID(), text, status: null })),
    };
    void save([list, ...checklists]);
    setActiveId(list.id);
    setTemplatePickerOpen(false);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [checklists, save]);

  const handleStatusToggle = useCallback((listId: string, itemId: string, next: ChecklistItem['status']) => {
    const updated = checklists.map(l =>
      l.id !== listId
        ? l
        : {
            ...l,
            items: l.items.map(i => i.id !== itemId ? i : { ...i, status: next }),
          },
    );
    void save(updated);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [checklists, save]);

  const handleComplete = useCallback((listId: string) => {
    const list = checklists.find(l => l.id === listId);
    if (!list) return;
    const open = list.items.filter(i => i.status === null);
    if (open.length > 0) {
      Alert.alert(`${open.length} item${open.length === 1 ? '' : 's'} unmarked`, 'Mark every item before completing.');
      return;
    }
    const updated = checklists.map(l =>
      l.id !== listId ? l : { ...l, completedAt: new Date().toISOString() },
    );
    void save(updated);
    setActiveId(null);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [checklists, save]);

  const handleDelete = useCallback((listId: string) => {
    Alert.alert('Delete checklist?', '', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: () => {
          void save(checklists.filter(l => l.id !== listId));
          if (activeId === listId) setActiveId(null);
        },
      },
    ]);
  }, [checklists, save, activeId]);

  const activeList = useMemo(() => checklists.find(l => l.id === activeId) ?? null, [checklists, activeId]);

  // Detail view — active checklist open for marking
  if (activeList) {
    const passCount = activeList.items.filter(i => i.status === 'passed').length;
    const failCount = activeList.items.filter(i => i.status === 'failed').length;
    const total = activeList.items.length;
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ title: activeList.title }} />
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}>
          <View style={styles.detailHeader}>
            <Text style={styles.eyebrow}>{activeList.trade.toUpperCase()}</Text>
            <Text style={styles.heading}>{activeList.title}</Text>
            <Text style={styles.sub}>
              {passCount} passed · {failCount} failed · {total - passCount - failCount} unmarked
            </Text>
            <TouchableOpacity onPress={() => setActiveId(null)} style={styles.backBtn}>
              <Text style={styles.backText}>← Back to list</Text>
            </TouchableOpacity>
          </View>

          {activeList.items.map(item => (
            <View key={item.id} style={styles.checkItem}>
              <Text style={styles.checkItemText}>{item.text}</Text>
              <View style={styles.statusRow}>
                <StatusBtn label="Pass" tone="success" active={item.status === 'passed'} onPress={() => handleStatusToggle(activeList.id, item.id, 'passed')} />
                <StatusBtn label="Fail" tone="error" active={item.status === 'failed'} onPress={() => handleStatusToggle(activeList.id, item.id, 'failed')} />
                <StatusBtn label="N/A" tone="neutral" active={item.status === 'na'} onPress={() => handleStatusToggle(activeList.id, item.id, 'na')} />
              </View>
            </View>
          ))}

          <View style={styles.detailFooter}>
            <TouchableOpacity onPress={() => handleDelete(activeList.id)} style={styles.deleteBtn}>
              <Text style={styles.deleteText}>Delete</Text>
            </TouchableOpacity>
            {!activeList.completedAt && (
              <TouchableOpacity onPress={() => handleComplete(activeList.id)} style={styles.completeBtn}>
                <Check size={14} color={Colors.cream} />
                <Text style={styles.completeText}>Complete checklist</Text>
              </TouchableOpacity>
            )}
            {activeList.completedAt && (
              <View style={styles.completedPill}>
                <Check size={14} color={Colors.success} />
                <Text style={styles.completedText}>
                  Completed {new Date(activeList.completedAt).toLocaleDateString()}
                </Text>
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: 'QC Checklists' }} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>QUALITY CONTROL</Text>
          <Text style={styles.heading}>QC <Text style={styles.headingItalic}>checklists.</Text></Text>
          <Text style={styles.sub}>
            Templated trade inspections — separate from your end-of-project punch list. Catch issues before they're hidden behind drywall.
          </Text>
          <TouchableOpacity onPress={() => setTemplatePickerOpen(o => !o)} style={styles.newBtn} testID="qc-new">
            <Plus size={14} color={Colors.cream} />
            <Text style={styles.newBtnText}>New checklist</Text>
          </TouchableOpacity>
        </View>

        {templatePickerOpen && (
          <View style={styles.templatePicker}>
            <Text style={styles.formLabel}>Pick a template</Text>
            {TEMPLATES.map(t => (
              <TouchableOpacity
                key={t.key}
                style={styles.templateCard}
                onPress={() => handleAddFromTemplate(t)}
                testID={`qc-template-${t.key}`}
              >
                <View>
                  <Text style={styles.templateTitle}>{t.title}</Text>
                  <Text style={styles.templateSub}>{t.trade} · {t.items.length} items</Text>
                </View>
                <ChevronRight size={16} color={Colors.textMuted} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={() => setTemplatePickerOpen(false)} style={styles.cancelTemplateBtn}>
              <X size={14} color={Colors.textSecondary} />
              <Text style={styles.cancelText}>Close</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && checklists.length === 0 && !templatePickerOpen && (
          <View style={styles.empty}>
            <ClipboardCheck size={36} color={Colors.accent} />
            <Text style={styles.emptyTitle}>No checklists yet</Text>
            <Text style={styles.emptyBody}>
              Tap New checklist to pick from 8 trade templates — pre-pour foundation, pre-rock walls, rough electrical, and more.
            </Text>
          </View>
        )}

        {checklists.map(l => {
          const passed = l.items.filter(i => i.status === 'passed').length;
          const total = l.items.length;
          const isDone = l.completedAt !== undefined;
          return (
            <TouchableOpacity
              key={l.id}
              onPress={() => setActiveId(l.id)}
              style={styles.listCard}
              activeOpacity={0.85}
              testID={`qc-checklist-${l.id}`}
            >
              <View style={styles.listIconWrap}>
                <ClipboardCheck size={18} color={isDone ? Colors.success : Colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.listTitle}>{l.title}</Text>
                <Text style={styles.listMeta}>
                  {l.trade} · {passed}/{total} passed · {new Date(l.createdAt).toLocaleDateString()}
                </Text>
              </View>
              {isDone && <View style={styles.donePill}><Text style={styles.donePillText}>DONE</Text></View>}
              <ChevronRight size={14} color={Colors.textMuted} />
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

function StatusBtn({
  label, tone, active, onPress,
}: { label: string; tone: 'success' | 'error' | 'neutral'; active: boolean; onPress: () => void }) {
  const bg = active
    ? tone === 'success' ? Colors.success
    : tone === 'error' ? Colors.error
    : Colors.fillSecondary
    : Colors.fillTertiary;
  const color = active
    ? '#fff'
    : tone === 'success' ? Colors.success
    : tone === 'error' ? Colors.error
    : Colors.textSecondary;
  return (
    <TouchableOpacity onPress={onPress} style={[styles.statusBtn, { backgroundColor: bg }]}>
      <Text style={[styles.statusBtnText, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14 },
  eyebrow: { ...Type.monoSm, color: Colors.accent, fontWeight: '600' as const, marginBottom: 8 },
  heading: { ...Type.display, color: Colors.ink, marginBottom: 4 },
  headingItalic: { ...Type.displayItalic, color: Colors.accent },
  sub: { fontSize: Type.subhead.fontSize, color: Colors.textSecondary, lineHeight: 21, marginBottom: 16 },
  newBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, alignSelf: 'flex-start' as const, gap: 4,
    backgroundColor: Colors.accent, paddingHorizontal: 14, paddingVertical: 9, borderRadius: Tokens.radius.full,
  },
  newBtnText: { ...Type.bodyCompact, color: Colors.cream, fontWeight: '700' as const },
  empty: { padding: 32, alignItems: 'center' as const, gap: 8 },
  emptyTitle: { ...Type.headline, color: Colors.text, marginTop: 8 },
  emptyBody: { ...Type.footnote, color: Colors.textSecondary, textAlign: 'center' as const, maxWidth: 320, lineHeight: 18 },
  templatePicker: {
    marginHorizontal: 16, padding: 14, marginBottom: 12,
    backgroundColor: Colors.cream, borderRadius: Tokens.radius.lg, borderWidth: 1, borderColor: Colors.bone,
  },
  formLabel: { ...Type.caption1, color: Colors.concrete, fontWeight: '700' as const, marginBottom: 10 },
  templateCard: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12,
    backgroundColor: Colors.surface, padding: 12, borderRadius: Tokens.radius.md, marginBottom: 8,
    borderWidth: 1, borderColor: Colors.bone,
  },
  templateTitle: { ...Type.bodyEmphasized, color: Colors.ink, marginBottom: 2 },
  templateSub: { ...Type.caption1, color: Colors.concrete },
  cancelTemplateBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 4,
    paddingVertical: 10, marginTop: 4,
  },
  cancelText: { ...Type.bodyCompact, color: Colors.textSecondary, fontWeight: '600' as const },
  listCard: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12,
    marginHorizontal: 16, marginBottom: 8, padding: 12,
    backgroundColor: Colors.surface, borderRadius: Tokens.radius.lg,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  listIconWrap: {
    width: 36, height: 36, borderRadius: Tokens.radius.md,
    backgroundColor: Colors.accentSoft, alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  listTitle: { ...Type.bodyEmphasized, color: Colors.text, marginBottom: 2 },
  listMeta: { ...Type.caption1, color: Colors.textMuted },
  donePill: {
    backgroundColor: Colors.success + '20', paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: Tokens.radius.xs,
  },
  donePillText: { ...Type.monoSm, color: Colors.success, fontWeight: '700' as const, fontSize: 9 },
  detailHeader: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  backBtn: { alignSelf: 'flex-start' as const, paddingVertical: 6 },
  backText: { ...Type.bodyCompact, color: Colors.accent, fontWeight: '600' as const },
  checkItem: {
    marginHorizontal: 16, marginBottom: 8, padding: 12,
    backgroundColor: Colors.surface, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  checkItemText: { ...Type.body, color: Colors.text, marginBottom: 8 },
  statusRow: { flexDirection: 'row' as const, gap: 6 },
  statusBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: Tokens.radius.full },
  statusBtnText: { ...Type.caption1, fontWeight: '700' as const, letterSpacing: 0.3 },
  detailFooter: {
    flexDirection: 'row' as const, gap: 8, paddingHorizontal: 16, paddingTop: 16,
  },
  deleteBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: Tokens.radius.full, backgroundColor: Colors.fillTertiary },
  deleteText: { ...Type.bodyCompact, color: Colors.error, fontWeight: '700' as const },
  completeBtn: {
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 4,
    backgroundColor: Colors.accent, paddingHorizontal: 14, paddingVertical: 9, borderRadius: Tokens.radius.full,
  },
  completeText: { ...Type.bodyCompact, color: Colors.cream, fontWeight: '700' as const },
  completedPill: {
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6,
    backgroundColor: Colors.success + '15', paddingHorizontal: 14, paddingVertical: 9, borderRadius: Tokens.radius.full,
  },
  completedText: { ...Type.bodyCompact, color: Colors.success, fontWeight: '700' as const },
});
