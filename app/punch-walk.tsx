// app/punch-walk.tsx — Walk Mode for punch-list capture.
//
// The user flow this is optimized for: a super walking the job with a
// clipboard app open, dictating "hallway 2, outlet cover missing" over
// and over. Traditional punch-list UIs require 6 taps per item — picking
// a location, a sub, a priority, writing a description. In walk mode we
// cut that to: press → talk → release → saved.
//
// Mechanics:
//   • Voice-first, but text + camera fallbacks for noisy jobsites.
//   • Trade auto-routing via `inferTradeFromText` — no manual picker
//     unless the GC wants to override. One tap on the trade chip cycles
//     through alternatives.
//   • Location is free-text — we remember the last entry and stick it
//     in the next item, because supers say "hall 2, hall 2, hall 2" as
//     they walk the corridor.
//   • Everything is captured locally first; `addPunchItem` is called on
//     every save so the offline queue can flush when we're back online.
//   • Session roll-up at the bottom: "captured 7 items this walk" with
//     undo. The list clears when the user leaves the screen.

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput,
  Alert, Platform, Modal, Image, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Camera, Mic, Check, X, Undo2, MapPin,
  AlertTriangle, ChevronRight, Plus, Flag,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { generateUUID } from '@/utils/generateId';
import VoiceRecorder from '@/components/VoiceRecorder';
import { inferTradeFromText, pickSubForTrade } from '@/utils/tradeInference';
import { stampPhotoLocation, type PhotoGeoStamp } from '@/utils/photoGeoStamp';
import type { PunchItem, PunchItemPriority, SubTrade, Subcontractor } from '@/types';
import { SUB_TRADES } from '@/types';

const TRADE_ORDER: SubTrade[] = SUB_TRADES;

// ─────────────────────────────────────────────────────────────

export default function PunchWalkScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string }>();
  const projectId = typeof params.projectId === 'string' ? params.projectId : undefined;
  const { projects, getProject, subcontractors, addPunchItem, deletePunchItem } = useProjects();

  // If no projectId was passed, show a project picker. Walk mode is
  // always bound to one project — you can't mix items across jobs.
  const project = projectId ? getProject(projectId) : null;

  if (!projectId || !project) {
    return <ProjectPicker projects={projects} onPick={(p) => router.replace({ pathname: '/punch-walk' as never, params: { projectId: p } as never })} onBack={() => router.back()} />;
  }

  return (
    <WalkInner
      projectName={project.name}
      projectId={projectId}
      subcontractors={subcontractors}
      onAdd={addPunchItem}
      onDelete={deletePunchItem}
      onBack={() => router.back()}
    />
  );
}

// ─────────────────────────────────────────────────────────────

interface SessionCapture {
  id: string;
  description: string;
  location: string;
  trade: SubTrade;
  priority: PunchItemPriority;
  photoUri?: string;
  capturedAt: string;
}

function WalkInner({ projectName, projectId, subcontractors, onAdd, onDelete, onBack }: {
  projectName: string;
  projectId: string;
  subcontractors: Subcontractor[];
  onAdd: (item: PunchItem) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();

  // Draft — what the user is building right now. Each save clears it
  // back to an empty draft seeded with the last location (see persist).
  const [draft, setDraft] = useState<{
    description: string;
    location: string;
    trade: SubTrade;
    matchedKeyword?: string;
    priority: PunchItemPriority;
    photoUri?: string;
    /** GPS stamp from when the photo was captured. Stored on the draft so a
     *  subsequent edit doesn't drop it on save. */
    photoStamp?: PhotoGeoStamp;
  }>({ description: '', location: '', trade: 'General', priority: 'medium' });

  // Session history — everything saved in this walk, in reverse-chron.
  // Kept on-screen so the user can undo a mistaken save.
  const [session, setSession] = useState<SessionCapture[]>([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [showTradeOverride, setShowTradeOverride] = useState(false);

  // Auto-infer trade whenever description changes. Doesn't fire on
  // every keystroke — the inference is stable and cheap, but we want
  // the UI to feel like the chip settles only when you pause typing.
  const inferenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!draft.description) return;
    if (inferenceTimer.current) clearTimeout(inferenceTimer.current);
    inferenceTimer.current = setTimeout(() => {
      const result = inferTradeFromText(draft.description);
      // Only auto-update if the user hasn't manually overridden.
      setDraft(d => d.trade !== 'General' && d.trade !== result.trade
        ? d // user picked something explicit, don't clobber
        : { ...d, trade: result.trade, matchedKeyword: result.matchedKeyword });
    }, 300);
    return () => { if (inferenceTimer.current) clearTimeout(inferenceTimer.current); };
  }, [draft.description]);

  // Voice transcript handler. We append rather than replace so the user
  // can dictate "hallway 2" then tap again for "outlet cover missing"
  // and get both sentences.
  const handleTranscript = useCallback((text: string) => {
    setIsTranscribing(false);
    setDraft(d => ({
      ...d,
      description: d.description ? `${d.description} ${text}`.trim() : text.trim(),
    }));
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const handleCamera = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera access needed', 'Grant camera permission in Settings to attach punch photos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: false });
    if (!result.canceled && result.assets[0]) {
      // Geo-stamp runs in parallel with the camera dismiss animation; its
      // own 3s timeout means a missing GPS fix never blocks the next punch.
      const stamp = await stampPhotoLocation();
      setDraft(d => ({
        ...d,
        photoUri: result.assets[0].uri,
        photoStamp: stamp ?? undefined,
        // If the user hasn't typed a location yet, seed it with the geo
        // label so the punch still has SOMETHING for the closeout report.
        location: d.location || stamp?.label || '',
      }));
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, []);

  const cycleTrade = useCallback(() => {
    setDraft(d => {
      const idx = TRADE_ORDER.indexOf(d.trade);
      const next = TRADE_ORDER[(idx + 1) % TRADE_ORDER.length];
      return { ...d, trade: next, matchedKeyword: undefined }; // user overrode
    });
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  const cyclePriority = useCallback(() => {
    setDraft(d => ({
      ...d,
      priority: d.priority === 'low' ? 'medium' : d.priority === 'medium' ? 'high' : 'low',
    }));
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  const handleSave = useCallback(() => {
    if (!draft.description.trim()) {
      Alert.alert('Nothing to save', 'Dictate or type a description first.');
      return;
    }
    const now = new Date().toISOString();
    const due = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const sub = pickSubForTrade(draft.trade, subcontractors, projectId);
    const id = generateUUID();

    const item: PunchItem = {
      id,
      projectId,
      description: draft.description.trim(),
      location: draft.location.trim() || 'Unspecified',
      assignedSub: sub?.companyName ?? draft.trade,
      assignedSubId: sub?.id,
      dueDate: due,
      priority: draft.priority,
      status: 'open',
      photoUri: draft.photoUri,
      ...(draft.photoStamp ? {
        photoLatitude: draft.photoStamp.latitude,
        photoLongitude: draft.photoStamp.longitude,
        photoLocationAccuracyMeters: draft.photoStamp.accuracyMeters,
        photoLocationLabel: draft.photoStamp.label,
      } : null),
      createdAt: now,
      updatedAt: now,
    };
    onAdd(item);

    setSession(s => [{
      id,
      description: item.description,
      location: item.location,
      trade: draft.trade,
      priority: item.priority,
      photoUri: item.photoUri,
      capturedAt: now,
    }, ...s]);

    // Reset draft but KEEP the location. The whole point of walk mode
    // is the super stays in one room and captures 5 items before moving.
    // photoStamp is dropped \u2014 next photo gets its own fresh fix.
    setDraft({ description: '', location: draft.location, trade: 'General', priority: 'medium' });

    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [draft, subcontractors, projectId, onAdd]);

  const handleUndo = useCallback((id: string) => {
    onDelete(id);
    setSession(s => s.filter(c => c.id !== id));
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [onDelete]);

  const priorityColor =
    draft.priority === 'high' ? Colors.error :
    draft.priority === 'low' ? Colors.textSecondary : Colors.warning;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.headerBtn} hitSlop={12}>
          <ChevronLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEyebrow}>Walk Mode · Punch</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>{projectName}</Text>
        </View>
        {session.length > 0 && (
          <View style={styles.sessionChip}>
            <Text style={styles.sessionChipText}>{session.length}</Text>
          </View>
        )}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ paddingBottom: 40 + insets.bottom }} keyboardShouldPersistTaps="handled">

          {/* Location — sticky context bar */}
          <View style={styles.locationRow}>
            <MapPin size={14} color={Colors.primary} />
            <TextInput
              style={styles.locationInput}
              value={draft.location}
              onChangeText={(v) => setDraft(d => ({ ...d, location: v }))}
              placeholder="Location (e.g. Hall 2, Unit 204, Kitchen)"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="sentences"
              testID="walk-location"
            />
            {draft.location.length > 0 && (
              <TouchableOpacity onPress={() => setDraft(d => ({ ...d, location: '' }))} hitSlop={8}>
                <X size={14} color={Colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          {/* Description — the big centerpiece */}
          <View style={styles.descCard}>
            <TextInput
              style={styles.descInput}
              value={draft.description}
              onChangeText={(v) => setDraft(d => ({ ...d, description: v }))}
              placeholder={'What\u2019s the issue?\nTap mic and talk, or type here.'}
              placeholderTextColor={Colors.textMuted}
              multiline
              autoCapitalize="sentences"
              testID="walk-description"
            />

            {/* Inferred-trade + priority badges */}
            <View style={styles.metaRow}>
              <TouchableOpacity style={styles.metaChip} onPress={cycleTrade}>
                <View style={[styles.metaDot, { backgroundColor: tradeColor(draft.trade) }]} />
                <Text style={styles.metaChipText}>{draft.trade}</Text>
                {draft.matchedKeyword && (
                  <Text style={styles.metaChipHint}>· {draft.matchedKeyword}</Text>
                )}
                <ChevronRight size={10} color={Colors.textMuted} />
              </TouchableOpacity>

              <TouchableOpacity style={[styles.metaChip, { backgroundColor: `${priorityColor}18` }]} onPress={cyclePriority}>
                <Flag size={11} color={priorityColor} />
                <Text style={[styles.metaChipText, { color: priorityColor }]}>{draft.priority.toUpperCase()}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.metaChipGhost} onPress={() => setShowTradeOverride(true)}>
                <Text style={styles.metaChipGhostText}>Pick trade</Text>
              </TouchableOpacity>
            </View>

            {/* Preview photo */}
            {draft.photoUri && (
              <View style={styles.photoPreview}>
                <Image source={{ uri: draft.photoUri }} style={styles.photoImg} />
                <TouchableOpacity style={styles.photoRemove} onPress={() => setDraft(d => ({ ...d, photoUri: undefined }))}>
                  <X size={12} color="#fff" />
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Action bar */}
          <View style={styles.actionRow}>
            <View style={styles.voiceWrap}>
              <VoiceRecorder
                onTranscriptReady={handleTranscript}
                isLoading={isTranscribing}
              />
            </View>
            <TouchableOpacity style={styles.cameraBtn} onPress={handleCamera}>
              <Camera size={18} color={Colors.text} />
              <Text style={styles.cameraBtnText}>Photo</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.saveBtn, !draft.description.trim() && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={!draft.description.trim()}
            activeOpacity={0.85}
            testID="walk-save"
          >
            <Check size={18} color={Colors.textOnPrimary} />
            <Text style={styles.saveBtnText}>Save & keep walking</Text>
          </TouchableOpacity>

          <Text style={styles.hint}>
            Location stays between saves — tap X to clear it when you move rooms. Mic appends to the description so you can keep dictating.
          </Text>

          {/* Session roll-up */}
          {session.length > 0 && (
            <View style={styles.sessionCard}>
              <Text style={styles.sessionTitle}>Captured this walk · {session.length}</Text>
              {session.map(c => (
                <View key={c.id} style={styles.sessionRow}>
                  <View style={[styles.sessionDot, { backgroundColor: tradeColor(c.trade) }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sessionDesc} numberOfLines={2}>{c.description}</Text>
                    <Text style={styles.sessionMeta}>{c.location} · {c.trade} · {c.priority}</Text>
                  </View>
                  <TouchableOpacity onPress={() => handleUndo(c.id)} hitSlop={12}>
                    <Undo2 size={14} color={Colors.textMuted} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {session.length === 0 && (
            <View style={styles.emptyCard}>
              <Mic size={18} color={Colors.textMuted} />
              <Text style={styles.emptyText}>
                Tap the mic below and say what you see. Walk mode is built for capturing 30 items in 10 minutes — don{'\u2019'}t worry about getting the trade or priority right, you can fix them later from the punch list screen.
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Trade override sheet */}
      <Modal visible={showTradeOverride} animationType="slide" transparent onRequestClose={() => setShowTradeOverride(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Pick trade</Text>
              <TouchableOpacity onPress={() => setShowTradeOverride(false)} hitSlop={12}>
                <X size={18} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 12 }}>
              {TRADE_ORDER.map(t => (
                <TouchableOpacity
                  key={t}
                  style={[styles.tradeOption, draft.trade === t && styles.tradeOptionActive]}
                  onPress={() => {
                    setDraft(d => ({ ...d, trade: t, matchedKeyword: undefined }));
                    setShowTradeOverride(false);
                  }}
                >
                  <View style={[styles.metaDot, { backgroundColor: tradeColor(t) }]} />
                  <Text style={styles.tradeOptionText}>{t}</Text>
                  {draft.trade === t && <Check size={14} color={Colors.primary} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Project picker (when opened without a projectId)

function ProjectPicker({ projects, onPick, onBack }: {
  projects: { id: string; name: string; status?: string }[];
  onPick: (projectId: string) => void;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.headerBtn} hitSlop={12}>
          <ChevronLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEyebrow}>Walk Mode · Punch</Text>
          <Text style={styles.headerTitle}>Pick a project</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {projects.length === 0 ? (
          <View style={styles.emptyCard}>
            <AlertTriangle size={18} color={Colors.warning} />
            <Text style={styles.emptyText}>No projects on file. Create one first, then come back to walk punch items.</Text>
          </View>
        ) : (
          projects.map(p => (
            <TouchableOpacity key={p.id} style={styles.pickerRow} onPress={() => onPick(p.id)}>
              <Plus size={14} color={Colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.pickerRowTitle}>{p.name}</Text>
                {p.status && <Text style={styles.pickerRowSub}>{p.status}</Text>}
              </View>
              <ChevronRight size={14} color={Colors.textMuted} />
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────

function tradeColor(trade: SubTrade): string {
  switch (trade) {
    case 'Electrical': return '#F59E0B';
    case 'Plumbing':   return '#3B82F6';
    case 'HVAC':       return '#06B6D4';
    case 'Roofing':    return '#8B5CF6';
    case 'Drywall':    return '#A78BFA';
    case 'Painting':   return '#EC4899';
    case 'Flooring':   return '#10B981';
    case 'Concrete':   return '#6B7280';
    case 'Framing':    return '#92400E';
    case 'Landscaping': return '#16A34A';
    case 'General':
    case 'Other':
    default:           return Colors.textMuted;
  }
}

// ─────────────────────────────────────────────────────────────
// Styles

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },

  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 8,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  headerBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.fillTertiary,
  },
  headerEyebrow: { fontSize: 10, color: Colors.primary, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },
  sessionChip: {
    minWidth: 28, height: 28, borderRadius: 14, paddingHorizontal: 8,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  sessionChipText: { color: Colors.textOnPrimary, fontWeight: '800', fontSize: 12 },

  locationRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, marginTop: 14,
    backgroundColor: Colors.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  locationInput: { flex: 1, fontSize: 14, color: Colors.text },

  descCard: {
    backgroundColor: Colors.card, borderRadius: 14, padding: 16, marginHorizontal: 14, marginTop: 12,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  descInput: {
    minHeight: 110, fontSize: 18, color: Colors.text, textAlignVertical: 'top',
    lineHeight: 24, fontWeight: '500',
  },

  metaRow: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, backgroundColor: Colors.fillSecondary,
  },
  metaDot: { width: 8, height: 8, borderRadius: 4 },
  metaChipText: { fontSize: 12, fontWeight: '700', color: Colors.text },
  metaChipHint: { fontSize: 10, color: Colors.textMuted },
  metaChipGhost: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6 },
  metaChipGhostText: { fontSize: 11, color: Colors.primary, fontWeight: '600' },

  photoPreview: {
    marginTop: 12, position: 'relative', alignSelf: 'flex-start',
    borderRadius: 10, overflow: 'hidden',
  },
  photoImg: { width: 110, height: 82, borderRadius: 10 },
  photoRemove: {
    position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center',
  },

  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, marginTop: 14 },
  voiceWrap: { flex: 1, alignItems: 'center' },
  cameraBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 12,
    borderRadius: 12, backgroundColor: Colors.fillSecondary,
  },
  cameraBtnText: { fontSize: 13, fontWeight: '700', color: Colors.text },

  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 14, marginTop: 14, paddingVertical: 16, borderRadius: 14,
    backgroundColor: Colors.primary,
  },
  saveBtnDisabled: { backgroundColor: Colors.textMuted },
  saveBtnText: { color: Colors.textOnPrimary, fontWeight: '800', fontSize: 15 },

  hint: { fontSize: 11, color: Colors.textMuted, textAlign: 'center', marginHorizontal: 20, marginTop: 10, lineHeight: 15 },

  sessionCard: {
    marginHorizontal: 14, marginTop: 20, padding: 14, borderRadius: 14,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.borderLight,
  },
  sessionTitle: { fontSize: 11, color: Colors.primary, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.1, marginBottom: 10 },
  sessionRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 8, borderTopWidth: 1, borderTopColor: Colors.borderLight },
  sessionDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  sessionDesc: { fontSize: 13, color: Colors.text, fontWeight: '600' },
  sessionMeta: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },

  emptyCard: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    marginHorizontal: 14, marginTop: 20, padding: 14, borderRadius: 14,
    backgroundColor: Colors.fillSecondary,
  },
  emptyText: { flex: 1, fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },

  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: Colors.overlay },
  modalSheet: { backgroundColor: Colors.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '70%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  modalTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  tradeOption: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10 },
  tradeOptionActive: { backgroundColor: `${Colors.primary}15` },
  tradeOptionText: { flex: 1, fontSize: 14, color: Colors.text, fontWeight: '600' },

  pickerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14,
    backgroundColor: Colors.card, borderRadius: 12, marginBottom: 8,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  pickerRowTitle: { fontSize: 14, fontWeight: '700', color: Colors.text },
  pickerRowSub: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
});
