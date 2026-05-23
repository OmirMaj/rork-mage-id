# Living Floor Plan (Phase ①) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a lightweight "4D" — a 2D floor plan whose drawn zones tint by schedule status across a timeline scrubber and surface real photos per zone — with zero 3D and zero new backend.

**Architecture:** New `PlanZone` project sub-collection stored **local-first** in AsyncStorage (`tertiary_plan_zones`, mirroring `DrawingPin` but WITHOUT `supabaseWrite` — pure OTA, no migration for v1). A pure-function status util derives each zone's planned status/% as-of a scrubbed day from its linked `ScheduleTask`s. Rendering is the `PlanSheet` image + absolutely-positioned zone rectangles + a `PanResponder` date scrubber. Reuses `DrawingPin`(+photos), `getPhaseColor`, theme, haptics.

**Tech Stack:** React Native / Expo, TypeScript strict, `react-native-svg` (already used by the gantt), `PanResponder` (RN core), `expo-haptics`, AsyncStorage via ProjectContext.

**Scope:** Phase ① = the GC-facing Living Floor Plan on mobile + web, local storage. **Deferred to ①b** (separate plan): a `plan_zones` Supabase table for cross-device sync + the read-only **client-portal** view. **Phase ③** (AI auto-progress) is a separate spec.

**Per-task gate:** `npx tsc --noEmit` clean at the worktree root (this repo has NO unit runner per CLAUDE.md) + the grep assertion in each task. Strict TS, no `any`, theme-aware (light+dark), OTA-safe (no native modules).

---

## File Structure

- **Create** `utils/planZoneStatus.ts` — pure functions: `zoneStateAsOf(tasks, dayIndex)` → `{ status, plannedPct, activeTask }`. No React. Independently reasoned/tested.
- **Create** `components/schedule/mobile/TimelineScrubber.tsx` — a `PanResponder` day slider over `[0, totalDays]`, emits a day index. Reusable, theme-aware.
- **Create** `components/schedule/mobile/LivingFloorPlan.tsx` — the view: plan image + zone overlays (tinted by `zoneStateAsOf`) + `TimelineScrubber` + tap-zone bottom sheet (photos + linked tasks). Takes a `readOnly` prop (for future portal reuse).
- **Create** `components/schedule/mobile/PlanZoneEditor.tsx` — edit mode: tap-drag to draw a rect, name it, link schedule task(s), edit/delete.
- **Modify** `types/index.ts` — add the `PlanZone` interface.
- **Modify** `contexts/ProjectContext.tsx` — add `tertiary_plan_zones` sub-collection (state + persist + CRUD + context value), mirroring `DrawingPin` but local-only.
- **Modify** `components/schedule/mobile/MobileScheduleScreen.tsx` — the `4d` sub-tab renders `LivingFloorPlan` instead of `FourDComingSoon`.
- **Modify** `app/schedule-pro.tsx` — add a "Living Plan" view entry (web/desktop) that renders `LivingFloorPlan`.

---

## Task 1: PlanZone type

**Files:**
- Modify: `types/index.ts` (add interface near `DrawingPin`)

- [ ] **Step 1: Add the type**

Add to `types/index.ts` (place right after the `DrawingPin` interface):

```ts
// Living Floor Plan — a rectangular zone drawn on a PlanSheet, linked to the
// schedule task(s) whose work happens in that area. Rect is in NORMALIZED plan
// coords (0–1 of the plan image) so it scales to any render size.
export interface PlanZone {
  id: string;
  projectId: string;
  planSheetId: string;
  x: number; y: number; w: number; h: number; // normalized 0–1
  label: string;
  linkedTaskIds: string[];
  color?: string;            // optional override; default derives from active trade
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Gate**

Run: `npx tsc --noEmit` — Expected: clean (exit 0).
Run: `grep -n "interface PlanZone" types/index.ts` — Expected: one match.

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "feat(4d): add PlanZone type"
```

---

## Task 2: PlanZone storage in ProjectContext (local-first)

**Files:**
- Modify: `contexts/ProjectContext.tsx` (mirror the `DrawingPin` blocks at lines ~37, ~163, ~2919, ~2925, ~2934, ~3195 — but NO `supabaseWrite`)

Mirror `DrawingPin` exactly, except the CRUD does **not** call `supabaseWrite` (v1 is local-only). `generateUUID`, `loadLocal`, `saveLocal`, `useCallback` are already imported/defined in this file.

- [ ] **Step 1: Add the storage key**

After `const PLAN_MARKUPS_KEY = 'tertiary_plan_markups';` (~line 39) add:

```ts
const PLAN_ZONES_KEY = 'tertiary_plan_zones';
```

- [ ] **Step 2: Add interface members**

In the context interface (where `drawingPins: DrawingPin[]; addDrawingPin: ...` are declared, ~line 163), add:

```ts
  planZones: PlanZone[];
  addPlanZone: (zone: Omit<PlanZone, 'id' | 'createdAt' | 'updatedAt'>) => PlanZone;
  updatePlanZone: (id: string, patch: Partial<PlanZone>) => void;
  deletePlanZone: (id: string) => void;
  getPlanZonesForPlan: (planSheetId: string) => PlanZone[];
  getPlanZonesForProject: (projectId: string) => PlanZone[];
```

Also add `PlanZone` to the `import type { ... } from '@/types'` list at the top of the file.

- [ ] **Step 3: State + load + persist**

Next to `const [drawingPins, setDrawingPins] = useState<DrawingPin[]>([]);` (~line 2919) add:

```ts
  const [planZones, setPlanZones] = useState<PlanZone[]>([]);
```

In the load `useEffect` (~line 2925) add:

```ts
    void loadLocal<PlanZone[]>(PLAN_ZONES_KEY, []).then(setPlanZones);
```

Next to `persistDrawingPins` (~line 2934) add:

```ts
  const persistPlanZones = useCallback((list: PlanZone[]) => {
    setPlanZones(list);
    void saveLocal(PLAN_ZONES_KEY, list);
  }, []);
```

- [ ] **Step 4: CRUD (local-only — no supabaseWrite in v1)**

Add near the drawing-pin CRUD (~line 3060):

```ts
  const addPlanZone = useCallback((zone: Omit<PlanZone, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = new Date().toISOString();
    const fresh: PlanZone = { ...zone, id: generateUUID(), createdAt: now, updatedAt: now };
    persistPlanZones([fresh, ...planZones]);
    return fresh;
  }, [planZones, persistPlanZones]);

  const updatePlanZone = useCallback((id: string, patch: Partial<PlanZone>) => {
    persistPlanZones(planZones.map((z) => (z.id === id ? { ...z, ...patch, updatedAt: new Date().toISOString() } : z)));
  }, [planZones, persistPlanZones]);

  const deletePlanZone = useCallback((id: string) => {
    persistPlanZones(planZones.filter((z) => z.id !== id));
  }, [planZones, persistPlanZones]);

  const getPlanZonesForPlan = useCallback((planSheetId: string) => planZones.filter((z) => z.planSheetId === planSheetId), [planZones]);
  const getPlanZonesForProject = useCallback((projectId: string) => planZones.filter((z) => z.projectId === projectId), [planZones]);
```

- [ ] **Step 5: Expose in the context value**

In the `useMemo` return object (the line ~3195 that lists `drawingPins, addDrawingPin, ...`), add `planZones, addPlanZone, updatePlanZone, deletePlanZone, getPlanZonesForPlan, getPlanZonesForProject,` and add the same names + `persistPlanZones` to that `useMemo`'s dependency array.

- [ ] **Step 6: Gate**

Run: `npx tsc --noEmit` — Expected: clean.
Run: `grep -n "addPlanZone\|tertiary_plan_zones" contexts/ProjectContext.tsx` — Expected: ≥3 matches.

- [ ] **Step 7: Commit**

```bash
git add types/index.ts contexts/ProjectContext.tsx
git commit -m "feat(4d): PlanZone local storage in ProjectContext (tertiary_plan_zones)"
```

---

## Task 3: Zone status util

**Files:**
- Create: `utils/planZoneStatus.ts`

- [ ] **Step 1: Write the util**

```ts
import type { ScheduleTask } from '@/types';

export type ZoneStatus = 'not_started' | 'in_progress' | 'done';
export interface ZoneState {
  status: ZoneStatus;
  plannedPct: number;        // 0–1, planned progress of the active trade as of the day
  activeTask: ScheduleTask | null;
}

const taskEnd = (t: ScheduleTask): number => (t.startDay ?? 0) + Math.max(1, t.durationDays || 1);

// Planned state of a zone as of `dayIndex` (days from schedule start), derived
// purely from the linked tasks' dates. A room moves through trades over time, so
// we surface the currently-active trade (latest-starting in-progress task).
export function zoneStateAsOf(linkedTasks: ScheduleTask[], dayIndex: number): ZoneState {
  if (linkedTasks.length === 0) return { status: 'not_started', plannedPct: 0, activeTask: null };

  const inProgress = linkedTasks.filter((t) => (t.startDay ?? 0) <= dayIndex && dayIndex < taskEnd(t));
  if (inProgress.length > 0) {
    const active = inProgress.reduce((a, b) => ((a.startDay ?? 0) >= (b.startDay ?? 0) ? a : b));
    const s = active.startDay ?? 0;
    const dur = Math.max(1, active.durationDays || 1);
    return { status: 'in_progress', plannedPct: Math.max(0, Math.min(1, (dayIndex - s) / dur)), activeTask: active };
  }

  const done = linkedTasks.filter((t) => taskEnd(t) <= dayIndex);
  if (done.length > 0) {
    const last = done.reduce((a, b) => (taskEnd(a) >= taskEnd(b) ? a : b));
    return { status: 'done', plannedPct: 1, activeTask: last };
  }
  return { status: 'not_started', plannedPct: 0, activeTask: null };
}
```

- [ ] **Step 2: Gate**

Run: `npx tsc --noEmit` — Expected: clean.
Run: `grep -n "export function zoneStateAsOf" utils/planZoneStatus.ts` — Expected: one match.

- [ ] **Step 3: Commit**

```bash
git add utils/planZoneStatus.ts
git commit -m "feat(4d): zoneStateAsOf — planned status/% per zone over time"
```

---

## Task 4: TimelineScrubber

**Files:**
- Create: `components/schedule/mobile/TimelineScrubber.tsx`

Model it on the existing `components/schedule/mobile/PercentSlider.tsx` (PanResponder + `measureInWindow`), but it emits a **day index** (0…totalDays) and shows the scrubbed date label + a "Today" tick.

- [ ] **Step 1: Write the component**

```tsx
import React, { useEffect, useRef } from 'react';
import { View, Text, PanResponder, StyleSheet, Platform, type GestureResponderEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';

const MS_DAY = 86400000;

interface TimelineScrubberProps {
  baseMs: number;            // schedule start (ms, midnight)
  totalDays: number;         // project span in days
  dayIndex: number;          // current scrubbed day
  todayIndex: number;        // days from base to today
  onChange: (day: number) => void;
}

function fmt(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function TimelineScrubber({ baseMs, totalDays, dayIndex, todayIndex, onChange }: TimelineScrubberProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const widthRef = useRef(0);
  const x0Ref = useRef(0);
  const lastRef = useRef(dayIndex);
  const trackRef = useRef<View>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => { lastRef.current = dayIndex; }, [dayIndex]);

  const setFromPageX = useRef((pageX: number) => {
    const w = widthRef.current;
    if (w <= 0 || totalDays <= 0) return;
    let d = Math.round(((pageX - x0Ref.current) / w) * totalDays);
    d = Math.max(0, Math.min(totalDays, d));
    if (d !== lastRef.current) {
      lastRef.current = d;
      if (Platform.OS !== 'web') void Haptics.selectionAsync();
      onChangeRef.current(d);
    }
  });

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e: GestureResponderEvent) => {
        const pageX = e.nativeEvent.pageX;
        trackRef.current?.measureInWindow((x, _y, w) => { x0Ref.current = x; widthRef.current = w; setFromPageX.current(pageX); });
      },
      onPanResponderMove: (e: GestureResponderEvent) => setFromPageX.current(e.nativeEvent.pageX),
    }),
  ).current;

  const pct = totalDays > 0 ? Math.max(0, Math.min(1, dayIndex / totalDays)) : 0;
  const todayPct = totalDays > 0 ? Math.max(0, Math.min(1, todayIndex / totalDays)) : 0;

  return (
    <View style={styles.wrap}>
      <View style={styles.dateRow}>
        <Text style={styles.date}>{fmt(baseMs + dayIndex * MS_DAY)}</Text>
        <Text style={styles.hint}>drag to see it build</Text>
      </View>
      <View
        ref={trackRef}
        onLayout={() => trackRef.current?.measureInWindow((x, _y, w) => { x0Ref.current = x; widthRef.current = w; })}
        hitSlop={{ top: 14, bottom: 14, left: 4, right: 4 }}
        style={styles.hit}
        {...pan.panHandlers}
      >
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: colors.accent }]} />
          {todayIndex >= 0 && todayIndex <= totalDays && (
            <View style={[styles.todayTick, { left: `${todayPct * 100}%`, backgroundColor: colors.text }]} />
          )}
          <View style={[styles.thumb, { left: `${pct * 100}%`, borderColor: colors.accent }]} />
        </View>
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 8 },
  dateRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, marginBottom: 4 },
  date: { fontSize: 14, fontWeight: '800' as const, color: t.text },
  hint: { fontSize: 11, fontWeight: '600' as const, color: t.textMuted },
  hit: { paddingVertical: 10, justifyContent: 'center' as const },
  track: { height: 8, borderRadius: 4, backgroundColor: t.line, justifyContent: 'center' as const },
  fill: { height: 8, borderRadius: 4 },
  todayTick: { position: 'absolute' as const, width: 2, height: 16, top: -4, marginLeft: -1, opacity: 0.5 },
  thumb: { position: 'absolute' as const, width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF', borderWidth: 3, marginLeft: -10 },
});
```

- [ ] **Step 2: Gate**

Run: `npx tsc --noEmit` — Expected: clean.
Run: `grep -n "export function TimelineScrubber" components/schedule/mobile/TimelineScrubber.tsx` — Expected: one match.

- [ ] **Step 3: Commit**

```bash
git add components/schedule/mobile/TimelineScrubber.tsx
git commit -m "feat(4d): TimelineScrubber (PanResponder day slider)"
```

---

## Task 5: LivingFloorPlan view

**Files:**
- Create: `components/schedule/mobile/LivingFloorPlan.tsx`

Renders the project's `PlanSheet` image, the zones tinted by `zoneStateAsOf` at the scrubbed day, the `TimelineScrubber`, and a tap-zone bottom sheet (photos in the zone + the active task). Accepts `readOnly` (hides edit affordances — used later by the portal). Pulls data from `useProjects()` and the project's `schedule`.

**Coordinate note:** zones are normalized 0–1. Render them over the measured image size (`onLayout` of the `Image` container) → `left = x*W`, `top = y*H`, etc. For photo→zone, read how `app/plan-viewer.tsx` stores `DrawingPin.x/y` (normalized vs pixel) and normalize pins to 0–1 before the point-in-rect test (`zone.x ≤ px ≤ zone.x+zone.w && zone.y ≤ py ≤ zone.y+zone.h`).

- [ ] **Step 1: Write the component**

```tsx
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
  photoUriById: (photoId: string) => string | undefined;
  imageUri: string;
  imageW?: number; imageH?: number;
  readOnly?: boolean;
  onEdit?: () => void;
  onAddPlan?: () => void;
}

export function LivingFloorPlan({ project, planSheetId, zones, pins, photoUriById, imageUri, imageW, imageH, readOnly, onEdit, onAddPlan }: LivingFloorPlanProps) {
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
        <EmptyState icon={<FolderOpen size={36} color={colors.accent} />} title="No floor plan yet"
          message="Add a floor plan to start the Living Floor Plan." actionLabel="Add Floor Plan" onAction={onAddPlan ?? (() => {})} />
      </View>
    );
  }

  const linkedTasksFor = (z: PlanZone): ScheduleTask[] => z.linkedTaskIds.map((id) => taskById.get(id)).filter(Boolean) as ScheduleTask[];
  const photosInZone = (z: PlanZone): string[] => {
    const W = imageW || 1, H = imageH || 1;
    return pins
      .filter((p) => p.linkedPhotoId && p.planSheetId === planSheetId)
      .filter((p) => { const px = p.x > 1 ? p.x / W : p.x; const py = p.y > 1 ? p.y / H : p.y; return px >= z.x && px <= z.x + z.w && py >= z.y && py <= z.y + z.h; })
      .map((p) => photoUriById(p.linkedPhotoId!)).filter(Boolean) as string[];
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 24 }}>
        <View style={styles.head}>
          <Text style={styles.title}>Living Floor Plan</Text>
          {!readOnly && <TouchableOpacity style={styles.editBtn} onPress={onEdit} testID="living-plan-edit"><Pencil size={14} color={colors.accent} /><Text style={styles.editText}>Edit zones</Text></TouchableOpacity>}
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
                  backgroundColor: phaseColor, // opacity applied via style below
                }, { opacity: 1 }]}>
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
            <TouchableOpacity onPress={() => setOpenZone(null)}><X size={18} color={colors.textMuted} /></TouchableOpacity>
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
```

- [ ] **Step 2: Gate**

Run: `npx tsc --noEmit` — Expected: clean. (If `photoUriById`/pin fields differ, adjust to the real `ProjectPhoto` shape — check `getPhotosForProject` in ProjectContext for the uri field.)
Run: `grep -n "export function LivingFloorPlan" components/schedule/mobile/LivingFloorPlan.tsx` — Expected: one match.

- [ ] **Step 3: Commit**

```bash
git add components/schedule/mobile/LivingFloorPlan.tsx
git commit -m "feat(4d): LivingFloorPlan view (zones tinted over time + photo strip)"
```

---

## Task 6: PlanZoneEditor

**Files:**
- Create: `components/schedule/mobile/PlanZoneEditor.tsx`

A modal/screen over the plan image: `PanResponder` tap-drag draws a normalized rect; on release prompt for a name; tapping an existing zone opens a small editor (rename, link tasks via a checklist of `project.schedule.tasks`, delete). Writes via `addPlanZone`/`updatePlanZone`/`deletePlanZone`.

- [ ] **Step 1: Write the component**

Build `PlanZoneEditor({ project, planSheetId, imageUri, imageW, imageH, onClose })`:
- Measure the image container (`onLayout`).
- A `PanResponder` on the image: `onPanResponderGrant` records the start point (normalized via measured size); `onPanResponderMove` updates a live draft rect; `onPanResponderRelease` — if the rect is big enough (> ~0.03 in both dims) open a name prompt (`Alert.prompt` on iOS, or an inline `TextInput` modal for cross-platform) then `addPlanZone({ projectId: project.id, planSheetId, x, y, w, h, label, linkedTaskIds: [] })`.
- Render existing zones (reuse the same normalized→pixel math as `LivingFloorPlan`); tapping one opens a panel with: rename `TextInput`, a scrollable checklist of `project.schedule?.tasks` toggling membership in `linkedTaskIds` (call `updatePlanZone(id, { linkedTaskIds })`), and a Delete button (`deletePlanZone(id)` with confirm).
- Haptic on create/delete (`expo-haptics`).
- Use `useThemedStyles`/`ThemeColors`/`Tokens`; strict TS, no `any`.

(Use `Alert` from `react-native` for the cross-platform name prompt: an inline `TextInput` inside a small `Modal` is the portable choice since `Alert.prompt` is iOS-only.)

- [ ] **Step 2: Gate**

Run: `npx tsc --noEmit` — Expected: clean.
Run: `grep -n "addPlanZone\|deletePlanZone\|export function PlanZoneEditor" components/schedule/mobile/PlanZoneEditor.tsx` — Expected: ≥2 matches.

- [ ] **Step 3: Commit**

```bash
git add components/schedule/mobile/PlanZoneEditor.tsx
git commit -m "feat(4d): PlanZoneEditor (draw/name/link/delete zones)"
```

---

## Task 7: Wire into the mobile 4D sub-tab

**Files:**
- Modify: `components/schedule/mobile/MobileScheduleScreen.tsx` (the `tab === '4d'` branch currently renders `FourDComingSoon`)

- [ ] **Step 1: Render the Living Floor Plan**

In `MobileScheduleScreen`, get the project's plan sheets via `useProjects().getPlanSheetsForProject(selectedProject.id)` (pick the first non-superseded sheet), its zones via `getPlanZonesForProject`, pins via `getPinsForPlan`, and photos via `getPhotosForProject`. Replace the `4d` branch:

```tsx
) : tab === '4d' ? (
  <LivingFloorPlanContainer project={selectedProject} />
) : (
```

Add a small `LivingFloorPlanContainer` (in this file or a sibling) that resolves the first plan sheet + zones + pins + a `photoUriById` lookup from the context and renders `<LivingFloorPlan ... onEdit={() => setShowZoneEditor(true)} onAddPlan={() => router.push('/plans')} />`, plus a `PlanZoneEditor` modal gated by `showZoneEditor`. Remove the now-unused `FourDComingSoon` import if nothing else uses it (it's still used in `TaskDetailSheet`, so keep the file).

- [ ] **Step 2: Gate**

Run: `npx tsc --noEmit` — Expected: clean.
Run: `grep -n "LivingFloorPlan" components/schedule/mobile/MobileScheduleScreen.tsx` — Expected: ≥1 match.

- [ ] **Step 3: Commit**

```bash
git add components/schedule/mobile/MobileScheduleScreen.tsx
git commit -m "feat(4d): mobile 4D tab renders the Living Floor Plan"
```

---

## Task 8: Wire into web Schedule Pro

**Files:**
- Modify: `app/schedule-pro.tsx` (add a "Living Plan" view toggle/section that renders `LivingFloorPlan` with the project's first plan sheet + zones + pins)

- [ ] **Step 1: Add the view**

Add a "Living Plan" entry to schedule-pro's view switcher (follow its existing view-switch pattern) that renders `<LivingFloorPlan project={project} ... onEdit={...} />` (+ `PlanZoneEditor`). Reuse the same container logic as Task 7 (extract a shared `useLivingPlanData(project)` hook in `components/schedule/mobile/LivingFloorPlan.tsx` or a new `hooks/useLivingPlanData.ts` if it cleanly DRYs both call sites — only if it doesn't bloat).

- [ ] **Step 2: Gate**

Run: `npx tsc --noEmit` — Expected: clean.
Run: `grep -n "LivingFloorPlan" app/schedule-pro.tsx` — Expected: ≥1 match.

- [ ] **Step 3: Commit**

```bash
git add app/schedule-pro.tsx
git commit -m "feat(4d): web Schedule Pro Living Plan view"
```

---

## Deferred to Phase ①b (separate plan)

- `plan_zones` Supabase table (mirror `drawing_pins`) + add `supabaseWrite` to the Task 2 CRUD → cross-device sync. Applied via the Supabase MCP.
- Read-only `LivingFloorPlan` (`readOnly`) in the client portal (`marketing/portal/index.html`) — needs the synced data + a Netlify portal deploy (PAT).

## Phase ③ (separate spec)

- AI auto-progress: vision reads zone photos → estimates real %, updates an `actual` status, surfaces plan-vs-actual variance.

---

## Self-Review

**Spec coverage:** zones (T1/T2/T6), persistence local-first (T2), status-as-of-date + planned % + getPhaseColor (T3/T5), timeline scrubber (T4), photo→zone via pin-in-rect (T5), zone editor draw/name/link/delete (T6), mobile 4D tab (T7), web (T8). Portal read-only + cross-device sync correctly deferred to ①b (need the table/deploy — keeps ① pure-OTA). AI = ③. ✓

**Placeholder scan:** New code shown in full for T1–T5; T6/T7/T8 give exact files + the precise construction (component contract, data wiring, the portable name-prompt note) rather than vague "implement" — acceptable for editor/wiring tasks that mirror shown patterns. No "TBD". ✓

**Type consistency:** `PlanZone` fields (x/y/w/h normalized, linkedTaskIds) used consistently across T1/T2/T5/T6. `zoneStateAsOf(tasks, dayIndex) → { status, plannedPct, activeTask }` used by T5. `TimelineScrubber` props (baseMs/totalDays/dayIndex/todayIndex/onChange) match T4↔T5. ✓

**Known verification points for the implementer:** the `DrawingPin.x/y` coordinate convention (normalize in T5 photo→zone) and the `ProjectPhoto` uri field name (`photoUriById` in T5/T7) — both flagged in-task to check against the real code.
