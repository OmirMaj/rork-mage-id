/**
 * PlanZoneEditor — draw, name, link-to-tasks, and delete plan zones.
 *
 * Usage:
 *   <PlanZoneEditor project={project} planSheetId={id} imageUri={uri}
 *     imageW={w} imageH={h} onClose={() => setEditing(false)} />
 *
 * Interaction:
 *   • Tap-drag on the blank image → draws a normalized rect → name prompt
 *     (cross-platform inline TextInput Modal, not Alert.prompt).
 *   • Tap an existing zone → opens an edit panel (rename, link tasks, delete).
 *   • Haptic on zone create/delete.
 */

import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  PanResponder,
  TextInput,
  Platform,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { X, Trash2, Check, Link2 } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import { useProjects } from '@/contexts/ProjectContext';
import type { Project, PlanZone } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DraftRect {
  x0: number; y0: number; x1: number; y1: number;
}

interface PlanZoneEditorProps {
  project: Project;
  planSheetId: string;
  imageUri: string;
  imageW?: number;
  imageH?: number;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normRect(d: DraftRect): { x: number; y: number; w: number; h: number } {
  const x = Math.min(d.x0, d.x1);
  const y = Math.min(d.y0, d.y1);
  const w = Math.abs(d.x1 - d.x0);
  const h = Math.abs(d.y1 - d.y0);
  return { x, y, w, h };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PlanZoneEditor({
  project,
  planSheetId,
  imageUri,
  imageW,
  imageH,
  onClose,
}: PlanZoneEditorProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  const {
    addPlanZone,
    updatePlanZone,
    deletePlanZone,
    getPlanZonesForProject,
  } = useProjects();

  const zones = getPlanZonesForProject(project.id).filter(
    (z) => z.planSheetId === planSheetId,
  );
  const tasks = project.schedule?.tasks ?? [];

  // Measured image container size
  const sizeRef = useRef({ w: 0, h: 0 });
  const containerRef = useRef<View>(null);
  const x0ContainerRef = useRef(0);
  const y0ContainerRef = useRef(0);

  // Live draft while finger is dragging
  const [draftRect, setDraftRect] = useState<DraftRect | null>(null);

  // State for "name new zone" prompt
  const [pendingRect, setPendingRect] = useState<{
    x: number; y: number; w: number; h: number;
  } | null>(null);
  const [nameInput, setNameInput] = useState('');

  // State for editing an existing zone
  const [editingZone, setEditingZone] = useState<PlanZone | null>(null);
  const [editNameInput, setEditNameInput] = useState('');
  const [editLinkedIds, setEditLinkedIds] = useState<string[]>([]);

  const aspect = imageW && imageH ? imageW / imageH : 4 / 3;

  // -------------------------------------------------------------------------
  // PanResponder — captures tap-drag to draw a new zone
  // -------------------------------------------------------------------------

  const toNorm = useCallback((pageX: number, pageY: number) => {
    const { w, h } = sizeRef.current;
    if (w <= 0 || h <= 0) return { nx: 0, ny: 0 };
    const nx = Math.max(0, Math.min(1, (pageX - x0ContainerRef.current) / w));
    const ny = Math.max(0, Math.min(1, (pageY - y0ContainerRef.current) / h));
    return { nx, ny };
  }, []);

  const startRef = useRef<{ nx: number; ny: number } | null>(null);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e: GestureResponderEvent) => {
        const { nx, ny } = toNorm(e.nativeEvent.pageX, e.nativeEvent.pageY);
        startRef.current = { nx, ny };
        setDraftRect({ x0: nx, y0: ny, x1: nx, y1: ny });
      },
      onPanResponderMove: (e: GestureResponderEvent) => {
        if (!startRef.current) return;
        const { nx, ny } = toNorm(e.nativeEvent.pageX, e.nativeEvent.pageY);
        setDraftRect({ x0: startRef.current.nx, y0: startRef.current.ny, x1: nx, y1: ny });
      },
      onPanResponderRelease: (e: GestureResponderEvent) => {
        if (!startRef.current) return;
        const { nx, ny } = toNorm(e.nativeEvent.pageX, e.nativeEvent.pageY);
        const rect = normRect({ x0: startRef.current.nx, y0: startRef.current.ny, x1: nx, y1: ny });
        startRef.current = null;
        setDraftRect(null);
        // Only open name prompt if the rect is big enough (>3% each dim)
        if (rect.w > 0.03 && rect.h > 0.03) {
          setPendingRect(rect);
          setNameInput('');
        }
      },
    }),
  ).current;

  // -------------------------------------------------------------------------
  // Confirm new zone
  // -------------------------------------------------------------------------

  const confirmNewZone = useCallback(() => {
    if (!pendingRect) return;
    const label = nameInput.trim() || 'Zone';
    addPlanZone({
      projectId: project.id,
      planSheetId,
      x: pendingRect.x,
      y: pendingRect.y,
      w: pendingRect.w,
      h: pendingRect.h,
      label,
      linkedTaskIds: [],
    });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setPendingRect(null);
    setNameInput('');
  }, [pendingRect, nameInput, addPlanZone, project.id, planSheetId]);

  // -------------------------------------------------------------------------
  // Open / save / delete an existing zone
  // -------------------------------------------------------------------------

  const openZone = useCallback((z: PlanZone) => {
    setEditingZone(z);
    setEditNameInput(z.label);
    setEditLinkedIds([...z.linkedTaskIds]);
  }, []);

  const saveZoneEdit = useCallback(() => {
    if (!editingZone) return;
    updatePlanZone(editingZone.id, {
      label: editNameInput.trim() || editingZone.label,
      linkedTaskIds: editLinkedIds,
    });
    setEditingZone(null);
  }, [editingZone, editNameInput, editLinkedIds, updatePlanZone]);

  const deleteZone = useCallback((id: string) => {
    deletePlanZone(id);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setEditingZone(null);
  }, [deletePlanZone]);

  const toggleTask = useCallback((taskId: string) => {
    setEditLinkedIds((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId],
    );
  }, []);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const { w: imgW, h: imgH } = sizeRef.current;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Edit Zones</Text>
        <Text style={styles.headerHint}>Drag to draw · tap to edit</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <X size={18} color={colors.text} strokeWidth={1.75} />
        </TouchableOpacity>
      </View>

      {/* Plan image + zone overlays + PanResponder */}
      <ScrollView contentContainerStyle={{ padding: 14 }} scrollEnabled={false}>
        <View
          ref={containerRef}
          style={[styles.planWrap, { aspectRatio: aspect }]}
          onLayout={(e: LayoutChangeEvent) => {
            const { width, height } = e.nativeEvent.layout;
            sizeRef.current = { w: width, h: height };
            // measureInWindow to get page-relative origin for PanResponder
            containerRef.current?.measureInWindow((x, y) => {
              x0ContainerRef.current = x;
              y0ContainerRef.current = y;
            });
          }}
          {...pan.panHandlers}
        >
          <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} resizeMode="contain" />

          {/* Existing zones */}
          {zones.map((z) => (
            <TouchableOpacity
              key={z.id}
              activeOpacity={0.7}
              onPress={() => openZone(z)}
              style={[
                styles.zone,
                {
                  left: z.x * imgW,
                  top: z.y * imgH,
                  width: z.w * imgW,
                  height: z.h * imgH,
                  borderColor: colors.accent,
                },
              ]}
            >
              <Text style={styles.zoneLabel} numberOfLines={1}>{z.label}</Text>
            </TouchableOpacity>
          ))}

          {/* Live draft rect */}
          {draftRect && (() => {
            const r = normRect(draftRect);
            return (
              <View
                pointerEvents="none"
                style={[
                  styles.draftZone,
                  {
                    left: r.x * imgW,
                    top: r.y * imgH,
                    width: r.w * imgW,
                    height: r.h * imgH,
                    borderColor: colors.accent,
                  },
                ]}
              />
            );
          })()}
        </View>
      </ScrollView>

      {/* ------------------------------------------------------------------ */}
      {/* Name-new-zone prompt (cross-platform Modal + TextInput)             */}
      {/* ------------------------------------------------------------------ */}
      <Modal
        visible={!!pendingRect}
        transparent
        animationType="fade"
        onRequestClose={() => setPendingRect(null)}
      >
        <View style={styles.promptOverlay}>
          <View style={[styles.promptBox, { paddingBottom: insets.bottom + 12 }]}>
            <Text style={styles.promptTitle}>Name this zone</Text>
            <TextInput
              style={styles.promptInput}
              value={nameInput}
              onChangeText={setNameInput}
              placeholder="e.g. Living Room, Kitchen..."
              placeholderTextColor={colors.textMuted}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={confirmNewZone}
            />
            <View style={styles.promptBtns}>
              <TouchableOpacity style={styles.promptCancel} onPress={() => setPendingRect(null)}>
                <Text style={styles.promptCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.promptConfirm, { backgroundColor: colors.accent }]} onPress={confirmNewZone}>
                <Text style={styles.promptConfirmText}>Add Zone</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ------------------------------------------------------------------ */}
      {/* Edit existing zone — bottom sheet                                   */}
      {/* ------------------------------------------------------------------ */}
      <Modal
        visible={!!editingZone}
        transparent
        animationType="slide"
        onRequestClose={() => setEditingZone(null)}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => setEditingZone(null)}
        />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          {/* Sheet header */}
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Edit Zone</Text>
            <TouchableOpacity onPress={saveZoneEdit}>
              <Check size={18} color={colors.accent} strokeWidth={1.75} />
            </TouchableOpacity>
          </View>

          {/* Rename */}
          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput
            style={styles.fieldInput}
            value={editNameInput}
            onChangeText={setEditNameInput}
            returnKeyType="done"
            onSubmitEditing={saveZoneEdit}
          />

          {/* Link tasks */}
          <View style={styles.linkHeader}>
            <Link2 size={14} color={colors.textMuted} strokeWidth={1.75} />
            <Text style={styles.fieldLabel}>Linked tasks</Text>
          </View>
          {tasks.length === 0 ? (
            <Text style={styles.noTasks}>No schedule tasks yet.</Text>
          ) : (
            <ScrollView style={styles.taskList} contentContainerStyle={{ paddingBottom: 8 }}>
              {tasks.map((t) => {
                const linked = editLinkedIds.includes(t.id);
                return (
                  <TouchableOpacity
                    key={t.id}
                    style={styles.taskRow}
                    onPress={() => toggleTask(t.id)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.checkbox, linked && { backgroundColor: colors.accent, borderColor: colors.accent }]}>
                      {linked && <Check size={10} color="#fff" strokeWidth={1.75} />}
                    </View>
                    <Text style={[styles.taskRowText, linked && { color: colors.text }]} numberOfLines={1}>
                      {t.title}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* Delete */}
          {editingZone && (
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => deleteZone(editingZone.id)}
              activeOpacity={0.7}
            >
              <Trash2 size={14} color="#FF3B30" strokeWidth={1.75} />
              <Text style={styles.deleteBtnText}>Delete Zone</Text>
            </TouchableOpacity>
          )}
        </View>
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
    gap: 8,
  },
  headerTitle: { fontSize: 16, fontWeight: '800' as const, color: t.text, flex: 1 },
  headerHint: { fontSize: 12, fontWeight: '600' as const, color: t.textMuted },
  closeBtn: { padding: 4 },

  planWrap: {
    width: '100%' as const,
    borderRadius: Tokens.radius.lg,
    overflow: 'hidden' as const,
    backgroundColor: t.surfaceAlt,
    position: 'relative' as const,
  },
  zone: {
    position: 'absolute' as const,
    borderWidth: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(0,122,255,0.12)',
    justifyContent: 'flex-start' as const,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  zoneLabel: { fontSize: 9, fontWeight: '800' as const, color: t.text },
  draftZone: {
    position: 'absolute' as const,
    borderWidth: 2,
    borderStyle: 'dashed' as const,
    borderRadius: 4,
    backgroundColor: 'rgba(0,122,255,0.08)',
  },

  // Name prompt modal
  promptOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center' as const,
    paddingHorizontal: 24,
  },
  promptBox: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.xl,
    padding: 20,
    gap: 12,
  },
  promptTitle: { fontSize: 17, fontWeight: '800' as const, color: t.text },
  promptInput: {
    borderWidth: 1,
    borderColor: t.line,
    borderRadius: Tokens.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: t.text,
    backgroundColor: t.bg,
  },
  promptBtns: { flexDirection: 'row' as const, gap: 10, marginTop: 4 },
  promptCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.surfaceAlt,
    alignItems: 'center' as const,
  },
  promptCancelText: { fontSize: 15, fontWeight: '700' as const, color: t.textMuted },
  promptConfirm: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: Tokens.radius.md,
    alignItems: 'center' as const,
  },
  promptConfirmText: { fontSize: 15, fontWeight: '700' as const, color: '#FFFFFF' },

  // Edit zone bottom sheet
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: t.bg,
    borderTopLeftRadius: Tokens.radius.xl,
    borderTopRightRadius: Tokens.radius.xl,
    padding: 16,
    maxHeight: '70%' as const,
  },
  sheetHead: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 14,
  },
  sheetTitle: { fontSize: 17, fontWeight: '800' as const, color: t.text },

  fieldLabel: { fontSize: 12, fontWeight: '700' as const, color: t.textMuted, marginBottom: 4, marginTop: 10 },
  fieldInput: {
    borderWidth: 1,
    borderColor: t.line,
    borderRadius: Tokens.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    color: t.text,
    backgroundColor: t.bg,
  },
  linkHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, marginTop: 14, marginBottom: 4 },
  noTasks: { fontSize: 13, color: t.textMuted, fontStyle: 'italic' as const },
  taskList: { maxHeight: 200 },
  taskRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.line },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: t.textMuted,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  taskRowText: { flex: 1, fontSize: 13, fontWeight: '600' as const, color: t.textMuted },

  deleteBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: Tokens.radius.md,
    borderWidth: 1,
    borderColor: '#FF3B30',
  },
  deleteBtnText: { fontSize: 14, fontWeight: '700' as const, color: '#FF3B30' },
});
