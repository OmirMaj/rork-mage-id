import React, { useMemo, useState } from 'react';
import { View, Text, Image, TouchableOpacity, ScrollView, StyleSheet, Modal, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pencil, X, FolderOpen } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import type { Project, PlanZone, ScheduleTask, DrawingPin } from '@/types';
import { getPhaseColor } from '@/utils/scheduleEngine';
import { Tokens } from '@/constants/designTokens';
import { zoneStateAsOf } from '@/utils/planZoneStatus';
import { TimelineScrubber } from './TimelineScrubber';
import EmptyState from '@/components/EmptyState';

const MS_DAY = 86400000;

interface LivingFloorPlanProps {
  project: Project;
  planSheetId: string;
  zones: PlanZone[];
  pins: DrawingPin[];                 // pins on this plan sheet (for photo→zone)
  photoById: (photoId: string) => { uri: string; createdAt: string } | undefined;
  imageUri: string;
  imageW?: number; imageH?: number;
  readOnly?: boolean;
  onEdit?: () => void;
  onAddPlan?: () => void;
}

export function LivingFloorPlan({ project, planSheetId, zones, pins, photoById, imageUri, imageW, imageH, readOnly, onEdit, onAddPlan }: LivingFloorPlanProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const tasks = useMemo(() => project.schedule?.tasks ?? [], [project.schedule]);
  const startDate = project.schedule?.startDate ?? new Date().toISOString().slice(0, 10);
  const baseMs = useMemo(() => { const d = new Date(startDate); d.setHours(0, 0, 0, 0); return d.getTime(); }, [startDate]);
  const totalDays = useMemo(() => Math.max(1, tasks.reduce((m, t) => Math.max(m, (t.startDay ?? 0) + Math.max(1, t.durationDays || 1)), 1)), [tasks]);
  const todayIndex = Math.round((Date.now() - baseMs) / MS_DAY);

  const [dayIndex, setDayIndex] = useState(Math.max(0, Math.min(totalDays, todayIndex)));
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [openZone, setOpenZone] = useState<PlanZone | null>(null);

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const aspect = imageW && imageH ? imageW / imageH : 4 / 3;

  if (!imageUri) {
    return (
      <View style={{ flex: 1, paddingTop: 24 }}>
        <EmptyState icon={<FolderOpen size={36} color={colors.accent} strokeWidth={1.75} />} title="No floor plan yet"
          message="Add a floor plan to start the Living Floor Plan." actionLabel="Add Floor Plan" onAction={onAddPlan ?? (() => {})} />
      </View>
    );
  }

  const linkedTasksFor = (z: PlanZone): ScheduleTask[] => z.linkedTaskIds.map((id) => taskById.get(id)).filter(Boolean) as ScheduleTask[];
  const cutoffMs = baseMs + dayIndex * MS_DAY;
  const photosInZone = (z: PlanZone): string[] => {
    const W = imageW || 1, H = imageH || 1;
    return pins
      .filter((p) => p.linkedPhotoId && p.planSheetId === planSheetId)
      .filter((p) => { const px = p.x > 1 ? p.x / W : p.x; const py = p.y > 1 ? p.y / H : p.y; return px >= z.x && px <= z.x + z.w && py >= z.y && py <= z.y + z.h; })
      .map((p) => photoById(p.linkedPhotoId!))
      .filter((ph): ph is { uri: string; createdAt: string } => ph !== undefined && new Date(ph.createdAt).getTime() <= cutoffMs)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((ph) => ph.uri);
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 24 }}>
        <View style={styles.head}>
          <Text style={styles.title}>Living Floor Plan</Text>
          {!readOnly && <TouchableOpacity style={styles.editBtn} onPress={onEdit} testID="living-plan-edit"><Pencil size={14} color={colors.accent} strokeWidth={1.75} /><Text style={styles.editText}>Edit zones</Text></TouchableOpacity>}
        </View>
        <View style={[styles.planWrap, { aspectRatio: aspect }]} onLayout={(e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
          {zones.map((z) => {
            const st = zoneStateAsOf(linkedTasksFor(z), dayIndex);
            const phaseColor = z.color || getPhaseColor(st.activeTask?.phase || 'Other');
            const fillOpacity = st.status === 'done' ? 0.5 : st.status === 'in_progress' ? 0.18 + 0.32 * st.plannedPct : 0;
            return (
              <TouchableOpacity key={z.id} activeOpacity={0.8} onPress={() => setOpenZone(z)}
                style={[styles.zone, {
                  left: z.x * size.w, top: z.y * size.h, width: z.w * size.w, height: z.h * size.h,
                  borderColor: st.status === 'not_started' ? colors.textMuted : phaseColor,
                  borderStyle: st.status === 'not_started' ? 'dashed' : 'solid',
                }]}>
                <View style={[StyleSheet.absoluteFill, { backgroundColor: phaseColor, opacity: fillOpacity, borderRadius: 4 }]} />
                <Text style={styles.zoneLabel} numberOfLines={1}>{z.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TimelineScrubber baseMs={baseMs} totalDays={totalDays} dayIndex={dayIndex} todayIndex={todayIndex} onChange={setDayIndex} />
      </ScrollView>

      <Modal visible={!!openZone} transparent animationType="slide" onRequestClose={() => setOpenZone(null)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpenZone(null)} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{openZone?.label}</Text>
            <TouchableOpacity onPress={() => setOpenZone(null)}><X size={18} color={colors.textMuted} strokeWidth={1.75} /></TouchableOpacity>
          </View>
          {openZone && (() => {
            const lt = linkedTasksFor(openZone);
            const photos = photosInZone(openZone);
            return (
              <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ paddingBottom: 8 }}>
                <Text style={styles.sub}>{lt.length ? lt.map((t) => `${t.title} · ${t.progress ?? 0}%`).join('\n') : 'No linked tasks'}</Text>
                {photos.length === 0
                  ? <Text style={styles.sub}>No photos in this zone yet.</Text>
                  : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
                      {photos.map((uri, i) => <Image key={i} source={{ uri }} style={styles.photo} />)}
                    </ScrollView>}
              </ScrollView>
            );
          })()}
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  head: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 10 },
  title: { fontSize: 16, fontWeight: '800' as const, color: t.text },
  editBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5 },
  editText: { fontSize: 13, fontWeight: '700' as const, color: t.accent },
  planWrap: { width: '100%' as const, borderRadius: Tokens.radius.lg, overflow: 'hidden' as const, backgroundColor: t.surfaceAlt, position: 'relative' as const },
  zone: { position: 'absolute' as const, borderWidth: 1.5, borderRadius: 4, justifyContent: 'flex-start' as const },
  zoneLabel: { fontSize: 10, fontWeight: '800' as const, color: t.text, margin: 3 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: t.bg, borderTopLeftRadius: Tokens.radius.xl, borderTopRightRadius: Tokens.radius.xl, padding: 16 },
  sheetHead: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 8 },
  sheetTitle: { fontSize: 17, fontWeight: '800' as const, color: t.text },
  sub: { fontSize: 13, fontWeight: '600' as const, color: t.textMuted, lineHeight: 19 },
  photo: { width: 130, height: 100, borderRadius: 10, backgroundColor: t.surfaceAlt },
});
