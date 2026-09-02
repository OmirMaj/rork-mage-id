// LivingFloorPlan — the "4D" view: a floor plan whose drawn zones tint by
// planned schedule status across a timeline scrubber, with the site photos
// that existed as of the scrubbed date.
//
// Rendered on THREE surfaces from this one file:
//   1. the mobile Schedule screen's "4D Model" sub-tab (GC, editable),
//   2. Schedule Pro's "Living Plan" view on web (GC, editable),
//   3. /shared-plan — the unauthenticated homeowner link (`clientMode`).
//
// CLIENT MODE IS A SAFETY BOUNDARY, NOT A STYLE FLAG. In `clientMode` the
// component drops the zone editor and, critically, stops rendering the linked
// TASK LIST — task titles carry sub names and internal shorthand, and a
// homeowner must not be able to work out which sub is behind. What a homeowner
// gets instead is the trade, the plain-English planned status of the room, and
// the photos. Nothing money-adjacent renders on ANY surface of this component:
// it is never handed a cost, a price, or a markup (see the props below — it
// takes tasks and zones, not a Project), and scripts/validate-plan-share.ts
// pins that at the source level.
//
// Note on props: this used to take a whole `Project` and reach into
// `project.schedule`. It now takes just `tasks` + `scheduleStartDate` — the
// only two things it ever read — so the client-facing surface can't be handed
// a Project full of budget fields in the first place.

import React, { useMemo, useState } from 'react';
import { View, Text, Image, TouchableOpacity, ScrollView, StyleSheet, Modal, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pencil, X, FolderOpen, Share2 } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import type { PlanZone, ScheduleTask, DrawingPin } from '@/types';
import { getPhaseColor } from '@/utils/scheduleEngine';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { zoneStateAsOf, type ZoneState } from '@/utils/planZoneStatus';
import { TimelineScrubber } from './TimelineScrubber';
import EmptyState from '@/components/EmptyState';
import { parseCalendarDay } from '@/utils/calendarDate';

const MS_DAY = 86400000;

interface LivingFloorPlanProps {
  /** Schedule tasks the zones link to. NOT a Project — see the header. */
  tasks: ScheduleTask[];
  /** Schedule anchor (yyyy-mm-dd). Day 0 of the scrubber. */
  scheduleStartDate?: string;
  planSheetId: string;
  zones: PlanZone[];
  pins: DrawingPin[];                 // pins on this plan sheet (for photo→zone)
  photoById: (photoId: string) => { uri: string; createdAt: string } | undefined;
  imageUri: string;
  imageW?: number; imageH?: number;
  readOnly?: boolean;
  /** Homeowner-facing mode: implies readOnly, and additionally suppresses the
   *  linked-task list in the zone sheet. See the header. */
  clientMode?: boolean;
  onEdit?: () => void;
  onShare?: () => void;
  onAddPlan?: () => void;
}

/** Plain-English planned status for a homeowner. Deliberately says "planned"
 *  — zoneStateAsOf reads the SCHEDULE, not what actually got built, and
 *  dressing a plan up as an actual is how a portal loses trust. */
function clientStatusLine(state: ZoneState): string {
  const trade = state.activeTask?.phase?.trim();
  if (state.status === 'done') return trade ? `${trade} complete` : 'Complete';
  if (state.status === 'in_progress') return trade ? `${trade} underway` : 'Work underway';
  return 'Not started yet';
}

export function LivingFloorPlan({
  tasks, scheduleStartDate, planSheetId, zones, pins, photoById, imageUri, imageW, imageH,
  readOnly, clientMode, onEdit, onShare, onAddPlan,
}: LivingFloorPlanProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // clientMode is strictly stronger than readOnly — a caller that passes
  // clientMode never has to remember to also pass readOnly.
  const locked = !!readOnly || !!clientMode;
  const startDate = scheduleStartDate ?? new Date().toISOString().slice(0, 10);
  // parseCalendarDay, not new Date(): a bare 'YYYY-MM-DD' parses as UTC
  // midnight and floors to the PREVIOUS local day at negative offsets, so every
  // date here rendered a day early. Same fix as MobileGantt / TaskDetailSheet /
  // SchedulerHeader / MobileScheduleList.
  const baseMs = useMemo(() => {
    const d = parseCalendarDay(startDate) ?? new Date();
    d.setHours(0, 0, 0, 0); return d.getTime();
  }, [startDate]);
  // startDay is 1-indexed; the scrubber runs on a 0-indexed day offset, so shift down by one.
  const totalDays = useMemo(() => Math.max(1, tasks.reduce((m, t) => Math.max(m, ((t.startDay ?? 1) - 1) + Math.max(1, t.durationDays || 1)), 1)), [tasks]);
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
          message={clientMode
            ? 'Your contractor hasn’t added a floor plan to this link yet.'
            : 'Add a floor plan to start the Living Floor Plan.'}
          actionLabel={clientMode ? undefined : 'Add Floor Plan'}
          onAction={onAddPlan ?? (() => {})} />
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
          <Text style={styles.title}>{clientMode ? 'Your floor plan' : 'Living Floor Plan'}</Text>
          {!locked && !!onShare && (
            <TouchableOpacity style={styles.headBtn} onPress={onShare} testID="living-plan-share"
              accessibilityRole="button" accessibilityLabel="Share this plan with the client">
              <Share2 size={14} color={colors.accent} strokeWidth={1.75} />
              <Text style={styles.headBtnText}>Share</Text>
            </TouchableOpacity>
          )}
          {!locked && (
            <TouchableOpacity style={styles.headBtn} onPress={onEdit} testID="living-plan-edit"
              accessibilityRole="button" accessibilityLabel="Edit zones">
              <Pencil size={14} color={colors.accent} strokeWidth={1.75} />
              <Text style={styles.headBtnText}>Edit zones</Text>
            </TouchableOpacity>
          )}
        </View>
        {clientMode && (
          <Text style={styles.clientHint} testID="living-plan-client-hint">
            Drag the timeline to see how the work is planned to move through the house. Photos appear once they were taken.
          </Text>
        )}
        <View style={[styles.planWrap, { aspectRatio: aspect }]} onLayout={(e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
          {zones.map((z) => {
            const st = zoneStateAsOf(linkedTasksFor(z), dayIndex);
            const phaseColor = z.color || getPhaseColor(st.activeTask?.phase || 'Other');
            const fillOpacity = st.status === 'done' ? 0.5 : st.status === 'in_progress' ? 0.18 + 0.32 * st.plannedPct : 0;
            return (
              <TouchableOpacity key={z.id} activeOpacity={0.8} onPress={() => setOpenZone(z)}
                accessibilityRole="button"
                accessibilityLabel={`${z.label} — ${clientStatusLine(st)}`}
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
            <TouchableOpacity onPress={() => setOpenZone(null)} accessibilityRole="button" accessibilityLabel="Close">
              <X size={18} color={colors.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
          </View>
          {openZone && (() => {
            const lt = linkedTasksFor(openZone);
            const state = zoneStateAsOf(lt, dayIndex);
            const photos = photosInZone(openZone);
            return (
              <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ paddingBottom: 8 }}>
                {clientMode ? (
                  // Trade + planned status ONLY. No task titles, no sub names,
                  // no percentages that could be read as blame. See the header.
                  <View style={[styles.statusPill, { backgroundColor: colors.accentSoft }]} testID="zone-client-status">
                    <Text style={[styles.statusPillText, { color: colors.accentLabel }]}>{clientStatusLine(state)}</Text>
                  </View>
                ) : (
                  <Text style={styles.sub}>{lt.length ? lt.map((t) => `${t.title} · ${t.progress ?? 0}%`).join('\n') : 'No linked tasks'}</Text>
                )}
                {photos.length === 0
                  ? <Text style={styles.sub}>{clientMode ? 'No photos of this room yet.' : 'No photos in this zone yet.'}</Text>
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
  head: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: 12, marginBottom: 10 },
  title: { flex: 1, fontSize: 16, fontWeight: '800' as const, color: t.text },
  headBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5 },
  headBtnText: { fontSize: 13, fontWeight: '700' as const, color: t.accent },
  clientHint: { ...Type.caption1, fontWeight: '600' as const, color: t.textMuted, marginBottom: 10 },
  planWrap: { width: '100%' as const, borderRadius: Tokens.radius.lg, overflow: 'hidden' as const, backgroundColor: t.surfaceAlt, position: 'relative' as const },
  zone: { position: 'absolute' as const, borderWidth: 1.5, borderRadius: 4, justifyContent: 'flex-start' as const },
  zoneLabel: { fontSize: 10, fontWeight: '800' as const, color: t.text, margin: 3 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: t.bg, borderTopLeftRadius: Tokens.radius.xl, borderTopRightRadius: Tokens.radius.xl, padding: 16 },
  sheetHead: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 8 },
  sheetTitle: { fontSize: 17, fontWeight: '800' as const, color: t.text },
  statusPill: { alignSelf: 'flex-start' as const, paddingHorizontal: 12, paddingVertical: 6, borderRadius: Tokens.radius.full },
  statusPillText: { fontSize: 13, fontWeight: '700' as const },
  sub: { fontSize: 13, fontWeight: '600' as const, color: t.textMuted, lineHeight: 19 },
  photo: { width: 130, height: 100, borderRadius: 10, backgroundColor: t.surfaceAlt },
});
