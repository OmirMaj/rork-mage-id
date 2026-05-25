# Schedule — Calendar Jump + Top-Tier Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a month-calendar date picker that jumps the mobile schedule timeline to any date, and a PM-grade, paper-size-perfect schedule export (HTML→PDF).

**Architecture:** A pure data-model builder (`scheduleReportModel.ts`) assembles everything from existing engines (CPM floats/critical-path/finish, baseline, % complete, a duration-weighted schedule-SPI). A pure renderer (`scheduleReportHtml.ts`) turns the model into paginated, per-size HTML (markup ported from the approved mockup). A thin export util runs `expo-print` → `expo-sharing`. A friendly `ExportCenterSheet` drives presets + customization. The calendar picker reuses the already-shipped `selectedDate` → WeekStrip → MobileGantt scroll-to-day flow.

**Tech Stack:** React Native / Expo (TypeScript strict, no `any`), `expo-print`, `expo-sharing`, `expo-file-system`, `lucide-react-native`, theme via `useTheme()`/`useThemedStyles`.

**Per-task gate (NO unit runner — per CLAUDE.md):** each task ends with `npx tsc --noEmit` clean at the worktree root **plus** the grep assertion(s), then a commit. Strict TS, theme-aware, OTA-safe (no native modules, no migration). Run all commands from the worktree root `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`. **Do NOT `eas update` during the plan** — OTA is a separate ship step.

**Design reference:** `docs/superpowers/specs/2026-05-24-schedule-export-mockup.html` is the **approved visual** for the export report. Task 4 ports its markup/CSS verbatim. Read it before Task 4.

---

## File Structure

- **Create** `components/schedule/mobile/MonthCalendarSheet.tsx` — month-grid date picker (theme-aware modal). Owns: month navigation, activity dots, day selection.
- **Create** `utils/scheduleReportModel.ts` — pure data model: `assembleScheduleReport`, `detectRisks`, `scheduleSpi`, `pickPaperSize`, all report types.
- **Create** `utils/scheduleReportHtml.ts` — pure renderer: `renderScheduleReportHtml(model, options)` → HTML string (per-size, paginated, section-gated). Self-contained helpers (escapeHtml/addDays/paper maps).
- **Create** `utils/scheduleReportExport.ts` — side-effecting glue: `generateScheduleReportPdf`, `shareScheduleCsv`, `shareScheduleLink` (expo-print/sharing + reuse of existing generators).
- **Create** `components/schedule/mobile/ExportCenterSheet.tsx` — the export UI (presets + customize).
- **Modify** `components/schedule/mobile/MobileScheduleScreen.tsx` — add calendar + export icon buttons; mount both sheets; compute `cpm`; pass data.

---

## Task 1: MonthCalendarSheet (calendar date picker)

**Files:** Create `components/schedule/mobile/MonthCalendarSheet.tsx`

Mirror the theme-aware modal pattern of `components/schedule/mobile/TaskDetailSheet.tsx` (read it first: `useTheme().colors`, `useThemedStyles(makeStyles)`, `Modal transparent animationType="slide"`, backdrop + sheet + grab, `useSafeAreaInsets`).

- [ ] **Step 1: Create the component**

```tsx
import React, { useMemo, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import type { ScheduleTask } from '@/types';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MS_DAY = 86400000;

function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function sameDay(a: Date, b: Date): boolean { return startOfDay(a).getTime() === startOfDay(b).getTime(); }

interface Props {
  visible: boolean;
  selectedDate: Date;
  tasks: ScheduleTask[];
  startDateIso: string;        // schedule.startDate (ISO yyyy-mm-dd), Day 1
  onSelect: (d: Date) => void;
  onClose: () => void;
}

export function MonthCalendarSheet({ visible, selectedDate, tasks, startDateIso, onSelect, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [cursor, setCursor] = useState<Date>(startOfDay(selectedDate));

  // Days that have a task active (start..finish inclusive) — drives the activity dots.
  const activeDayKeys = useMemo(() => {
    const base = startOfDay(new Date(startDateIso));
    const keys = new Set<string>();
    for (const t of tasks) {
      if (t.isSummary) continue;
      const s = (t.startDay ?? 1) - 1;
      const e = s + Math.max(1, t.durationDays || 1) - 1;
      for (let d = s; d <= e; d++) {
        const day = new Date(base.getTime() + d * MS_DAY);
        keys.add(`${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`);
      }
    }
    return keys;
  }, [tasks, startDateIso]);

  const grid = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startOffset = first.getDay();
    const gridStart = new Date(first.getTime() - startOffset * MS_DAY);
    return Array.from({ length: 42 }, (_, i) => new Date(gridStart.getTime() + i * MS_DAY));
  }, [cursor]);

  const today = startOfDay(new Date());
  const shiftMonth = (delta: number) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));
  const pick = (d: Date) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    onSelect(startOfDay(d));
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.grab} />
        <View style={styles.head}>
          <TouchableOpacity onPress={() => shiftMonth(-1)} style={styles.nav} accessibilityLabel="Previous month"><ChevronLeft size={20} color={colors.text} /></TouchableOpacity>
          <Text style={styles.title}>{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</Text>
          <TouchableOpacity onPress={() => shiftMonth(1)} style={styles.nav} accessibilityLabel="Next month"><ChevronRight size={20} color={colors.text} /></TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={styles.nav} accessibilityLabel="Close"><X size={18} color={colors.textMuted} /></TouchableOpacity>
        </View>
        <View style={styles.dowRow}>
          {DOW.map((d, i) => <Text key={i} style={styles.dow}>{d}</Text>)}
        </View>
        <View style={styles.gridWrap}>
          {grid.map((d, i) => {
            const inMonth = d.getMonth() === cursor.getMonth();
            const isSel = sameDay(d, selectedDate);
            const isToday = sameDay(d, today);
            const hasWork = activeDayKeys.has(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
            return (
              <TouchableOpacity key={i} style={styles.cell} activeOpacity={0.7} onPress={() => pick(d)} testID={`cal-day-${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`}>
                <View style={[styles.dayWrap, isSel && { backgroundColor: colors.accent }]}>
                  <Text style={[styles.day, !inMonth && styles.dayDim, isSel && { color: '#FFFFFF' }, !isSel && isToday && { color: colors.accent, fontWeight: '800' }]}>{d.getDate()}</Text>
                </View>
                <View style={[styles.dot, hasWork && !isSel ? { backgroundColor: colors.accent } : null]} />
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity style={styles.todayBtn} onPress={() => pick(new Date())} testID="cal-today">
          <Text style={styles.todayBtnText}>Jump to Today</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { position: 'absolute' as const, left: 0, right: 0, bottom: 0, backgroundColor: t.bg, borderTopLeftRadius: Tokens.radius.xl, borderTopRightRadius: Tokens.radius.xl, padding: 16 },
  grab: { width: 40, height: 4, borderRadius: 2, backgroundColor: t.line, alignSelf: 'center' as const, marginBottom: 12 },
  head: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginBottom: 10 },
  title: { flex: 1, fontSize: 17, fontWeight: '800' as const, color: t.text },
  nav: { width: 34, height: 34, alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: 17, backgroundColor: t.surfaceAlt },
  dowRow: { flexDirection: 'row' as const },
  dow: { flex: 1, textAlign: 'center' as const, fontSize: 11, fontWeight: '700' as const, color: t.textMuted, paddingVertical: 4 },
  gridWrap: { flexDirection: 'row' as const, flexWrap: 'wrap' as const },
  cell: { width: `${100 / 7}%`, alignItems: 'center' as const, paddingVertical: 4 },
  dayWrap: { width: 36, height: 36, borderRadius: 12, alignItems: 'center' as const, justifyContent: 'center' as const },
  day: { fontSize: 15, fontWeight: '600' as const, color: t.text },
  dayDim: { color: t.textMuted, opacity: 0.45 },
  dot: { width: 5, height: 5, borderRadius: 2.5, marginTop: 2, backgroundColor: 'transparent' },
  todayBtn: { marginTop: 12, alignSelf: 'center' as const, paddingVertical: 10, paddingHorizontal: 22, borderRadius: Tokens.radius.md, backgroundColor: t.surfaceAlt },
  todayBtnText: { fontSize: 14, fontWeight: '700' as const, color: t.accent },
});
```

- [ ] **Step 2: Verify theme tokens exist**

Run: `grep -n "surfaceAlt\|textMuted\|accent\b\|line\b" constants/colors.ts | head`
Expected: `surfaceAlt`, `textMuted`, `accent`, `line` are members of `ThemeColors`. If any differ, match the real token name from `TaskDetailSheet.tsx`'s usage.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Grep**

Run: `grep -n "export function MonthCalendarSheet" components/schedule/mobile/MonthCalendarSheet.tsx && grep -n "activeDayKeys" components/schedule/mobile/MonthCalendarSheet.tsx`
Expected: both match.

- [ ] **Step 5: Commit**

```bash
git add components/schedule/mobile/MonthCalendarSheet.tsx
git commit -m "feat(schedule): month-calendar date picker sheet"
```

---

## Task 2: Wire the calendar into MobileScheduleScreen

**Files:** Modify `components/schedule/mobile/MobileScheduleScreen.tsx`

- [ ] **Step 1: Import the sheet + a calendar icon**

Add to the `lucide-react-native` import (currently `import { Bell, ChevronDown, FolderOpen } from 'lucide-react-native';`): add `CalendarDays`.
Add: `import { MonthCalendarSheet } from './MonthCalendarSheet';`

- [ ] **Step 2: Add state**

Next to the other `useState`s (near L44-51), add:
```ts
const [showCalendar, setShowCalendar] = useState(false);
```

- [ ] **Step 3: Add the calendar icon button in the header**

In the header `<View style={styles.header}>` block, add a calendar button as a sibling **before** the Bell button:
```tsx
<TouchableOpacity style={styles.iconBtn} onPress={() => setShowCalendar(true)} accessibilityLabel="Jump to date" testID="open-calendar">
  <CalendarDays size={19} color={colors.text} />
</TouchableOpacity>
```

- [ ] **Step 4: Mount the sheet**

Just before the closing `</View>` of the screen (next to where `TaskDetailSheet`/`AddTaskModal` are mounted), add:
```tsx
<MonthCalendarSheet
  visible={showCalendar}
  selectedDate={selectedDate}
  tasks={tasks}
  startDateIso={startDate}
  onSelect={setSelectedDate}
  onClose={() => setShowCalendar(false)}
/>
```

- [ ] **Step 2.5: Type-check + grep + commit**

Run: `npx tsc --noEmit` → clean.
Run: `grep -n "MonthCalendarSheet\|open-calendar" "components/schedule/mobile/MobileScheduleScreen.tsx"` → matches.
```bash
git add components/schedule/mobile/MobileScheduleScreen.tsx
git commit -m "feat(schedule): calendar jump button on mobile schedule header"
```

---

## Task 3: Report data model — `utils/scheduleReportModel.ts`

**Files:** Create `utils/scheduleReportModel.ts`

This is pure logic. It assembles a `ScheduleReportModel` from `runCpm` output + tasks + baseline. Key groundings (verified against code):
- A task has **no `endDay`** — finish day = `startDay + durationDays - 1`. `progress` is **0–100**.
- `cpm.perTask` is `Map<id, { es, ef, ls, lf, totalFloat, freeFloat, isCritical }>`; `cpm.projectFinish` is a day number; `cpm.criticalPath` is `string[]` of ids.
- **SPI:** `buildEarnedValueSnapshot` is cost-based and returns 1 with no cost-loading, so we compute a **duration-weighted schedule-SPI** here.
- **"Contract/Planned finish":** no contract-date field exists → use the **baseline** finish (max baseline `endDay`) when a baseline is present; otherwise omit variance.
- Baseline source: `schedule.baseline` (`ScheduleBaseline | null` = `{ savedAt, tasks: [{id,startDay,endDay}] }`), else per-task `baselineEndDay`.

- [ ] **Step 1: Create the file**

```ts
import type { Project, ScheduleTask, ScheduleBaseline } from '@/types';
import type { CpmResult } from '@/utils/cpm';

const MS_DAY = 86400000;

export type ReportPaperSize = 'letter' | 'a4' | 'tabloid' | 'a3' | 'arch_d' | 'arch_e';
export type ReportSectionKey =
  | 'kpis' | 'critPath' | 'risks' | 'lookahead' | 'milestones'
  | 'gantt' | 'slippages' | 'phaseProgress' | 'weather' | 'register';

export interface ReportOptions {
  paperSize: ReportPaperSize;            // resolved size (never 'auto' here)
  orientation: 'landscape' | 'portrait';
  sections: ReportSectionKey[];
  fitToOnePage: boolean;
  showPredecessors: boolean;
  singleWallSheet: boolean;              // Arch D/E: suppress page breaks
}

export interface ReportGanttRow {
  index: number; title: string; phase: string; crew: string;
  startIso: string; finishIso: string;
  baselineFinishIso: string | null; deltaDays: number | null;
  totalFloat: number; freeFloat: number; percent: number;
  predecessors: string;
  isCritical: boolean; isSummary: boolean; isMilestone: boolean;
  bar: { leftPct: number; widthPct: number };
  baselineBar: { leftPct: number; widthPct: number } | null;
}

export interface ScheduleReportModel {
  header: {
    projectName: string; location: string; company: string | null; client: string | null;
    reportDateIso: string; dataDateIso: string; startIso: string;
    forecastFinishIso: string; baselineFinishIso: string | null; forecastVarianceDays: number | null;
    taskCount: number; phaseCount: number; spanDays: number;
  };
  kpis: {
    percentComplete: number; tasksDone: number; tasksTotal: number;
    forecastVarianceDays: number | null; spi: number; svDays: number | null;
    criticalCount: number; minTotalFloat: number;
    behindCount: number; overdueCount: number; unstaffedCount: number;
  };
  criticalPath: { id: string; title: string; startIso: string; finishIso: string; isMilestone: boolean }[];
  risks: { kind: 'overdue' | 'zero_float' | 'low_float' | 'unstaffed' | 'behind' | 'inspection'; severity: 'hi' | 'md' | 'lo'; text: string }[];
  lookahead: { weekLabel: string; items: { title: string; crew: string; startIso: string; finishIso: string; isMilestone: boolean }[] }[];
  milestones: { title: string; dateIso: string; varianceDays: number | null; onTime: boolean }[];
  ganttRows: ReportGanttRow[];
  slippages: { title: string; deltaDays: number }[];
  phaseProgress: { phase: string; percent: number }[];
  weatherClosures: { label: string; note: string }[];
}

function startOfDay(d: Date): number { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }
function isoAddDays(startIso: string, dayNumber: number): string {
  // Day numbers are 1-indexed inclusive; day 1 === startIso. Calendar offset
  // (matches the shipped exportSchedulePdf convention).
  const d = new Date(startIso + 'T00:00:00');
  if (!Number.isFinite(d.getTime())) return '—';
  d.setDate(d.getDate() + Math.max(0, dayNumber - 1));
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function isoShort(startIso: string, dayNumber: number): string {
  const d = new Date(startIso + 'T00:00:00');
  if (!Number.isFinite(d.getTime())) return '—';
  d.setDate(d.getDate() + Math.max(0, dayNumber - 1));
  return d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
}
function finishDay(t: ScheduleTask): number { return (t.startDay ?? 1) + Math.max(1, t.durationDays || 1) - 1; }

/** Duration-weighted schedule SPI: earned ÷ planned-to-date. Always meaningful
 *  (no cost-loading required). dayCursor is the 1-indexed working day of "today". */
export function scheduleSpi(tasks: ScheduleTask[], dayCursor: number): number {
  let earned = 0, planned = 0;
  for (const t of tasks) {
    if (t.isSummary || t.isMilestone) continue;
    const dur = Math.max(1, t.durationDays || 1);
    earned += dur * Math.max(0, Math.min(100, t.progress ?? 0)) / 100;
    const start = t.startDay ?? 1;
    const end = start + dur - 1;
    const frac = dayCursor >= end ? 1 : dayCursor < start ? 0 : (dayCursor - start + 1) / dur;
    planned += dur * frac;
  }
  return planned > 0 ? earned / planned : 1;
}

export function detectRisks(
  tasks: ScheduleTask[], cpm: CpmResult, dayCursor: number,
  baselineEndById: Map<string, number>,
): ScheduleReportModel['risks'] {
  const out: ScheduleReportModel['risks'] = [];
  for (const t of tasks) {
    if (t.isSummary) continue;
    const done = t.status === 'done' || (t.progress ?? 0) >= 100;
    const ct = cpm.perTask.get(t.id);
    const tf = ct?.totalFloat ?? 0;
    if (!done && finishDay(t) < dayCursor) out.push({ kind: 'overdue', severity: 'hi', text: `${t.title} — overdue, ${t.progress ?? 0}%` });
    else if (!done && tf <= 0 && !t.isMilestone) out.push({ kind: 'zero_float', severity: 'hi', text: `${t.title} — 0 float (drives finish)` });
    else if (!done && tf > 0 && tf <= 2 && !t.isMilestone) out.push({ kind: 'low_float', severity: 'md', text: `${t.title} — only ${tf}d float` });
    if (!done && !t.isMilestone && !(t.crew || '').trim() && !t.assignedSubName) out.push({ kind: 'unstaffed', severity: 'lo', text: `${t.title} — no crew assigned` });
    const blEnd = baselineEndById.get(t.id);
    if (blEnd != null && finishDay(t) - blEnd >= 2) out.push({ kind: 'behind', severity: 'md', text: `${t.title} — +${finishDay(t) - blEnd}d vs baseline` });
    if (!done && t.isMilestone && /inspect/i.test(t.title) && (t.startDay ?? 1) >= dayCursor && (t.startDay ?? 1) <= dayCursor + 21) out.push({ kind: 'inspection', severity: 'md', text: `${t.title} — book ahead (${isoShort('', 0) ? '' : ''}around day ${t.startDay})` });
  }
  // De-dupe & cap to keep the register readable.
  return out.slice(0, 10);
}

export function pickPaperSize(taskCount: number): ReportPaperSize {
  if (taskCount <= 12) return 'letter';
  if (taskCount <= 35) return 'a3';
  if (taskCount <= 80) return 'arch_d';
  return 'arch_e';
}

export function assembleScheduleReport(input: {
  project: Project;
  tasks: ScheduleTask[];
  startDateIso: string;
  cpm: CpmResult;
  baseline?: ScheduleBaseline | null;
  company?: { name?: string } | null;
  nonWorkingDates?: string[];
  reportDate?: Date;
}): ScheduleReportModel {
  const { project, tasks, startDateIso, cpm, baseline, company, nonWorkingDates } = input;
  const reportDate = input.reportDate ?? new Date();
  const baseMs = startOfDay(new Date(startDateIso));
  const dayCursor = Math.max(1, Math.round((startOfDay(reportDate) - baseMs) / MS_DAY) + 1);

  const baselineEndById = new Map<string, number>();
  if (baseline?.tasks?.length) for (const b of baseline.tasks) baselineEndById.set(b.id, b.endDay);
  else for (const t of tasks) if (t.baselineEndDay != null) baselineEndById.set(t.id, t.baselineEndDay);

  const baselineFinishDay = baselineEndById.size ? Math.max(...baselineEndById.values()) : null;
  const forecastFinishDay = cpm.projectFinish;
  const totalDays = Math.max(1, forecastFinishDay, baselineFinishDay ?? 1);
  const forecastVarianceDays = baselineFinishDay != null ? forecastFinishDay - baselineFinishDay : null;

  const real = tasks.filter((t) => !t.isSummary);
  const totalDur = real.reduce((s, t) => s + Math.max(1, t.durationDays || 1), 0);
  const percentComplete = totalDur > 0 ? Math.round(real.reduce((s, t) => s + (t.progress ?? 0) * Math.max(1, t.durationDays || 1), 0) / totalDur) : 0;
  const tasksDone = real.filter((t) => t.status === 'done' || (t.progress ?? 0) >= 100).length;

  const ganttRows: ReportGanttRow[] = tasks.map((t, i) => {
    const ct = cpm.perTask.get(t.id);
    const es = ct?.es ?? t.startDay ?? 1;
    const ef = ct?.ef ?? finishDay(t);
    const dur = Math.max(1, t.durationDays || 1);
    const blEnd = baselineEndById.get(t.id) ?? null;
    const blStart = baseline?.tasks?.find((b) => b.id === t.id)?.startDay ?? t.baselineStartDay ?? null;
    return {
      index: i + 1, title: t.title || 'Untitled', phase: t.phase || 'General', crew: t.crew || (t.assignedSubName ?? ''),
      startIso: isoShort(startDateIso, es), finishIso: isoShort(startDateIso, ef),
      baselineFinishIso: blEnd != null ? isoShort(startDateIso, blEnd) : null,
      deltaDays: blEnd != null ? ef - blEnd : null,
      totalFloat: ct?.totalFloat ?? 0, freeFloat: ct?.freeFloat ?? 0,
      percent: Math.max(0, Math.min(100, t.progress ?? 0)),
      predecessors: (t.dependencies ?? []).map((id) => tasks.findIndex((x) => x.id === id) + 1).filter((n) => n > 0).join(', '),
      isCritical: !!ct?.isCritical && t.status !== 'done', isSummary: !!t.isSummary, isMilestone: !!t.isMilestone || dur === 0,
      bar: { leftPct: ((es - 1) / totalDays) * 100, widthPct: Math.max(0.4, (dur / totalDays) * 100) },
      baselineBar: blStart != null && blEnd != null ? { leftPct: ((blStart - 1) / totalDays) * 100, widthPct: Math.max(0.4, ((blEnd - blStart + 1) / totalDays) * 100) } : null,
    };
  });

  const phaseSet = new Set(real.map((t) => t.phase || 'General'));
  const phaseProgress = Array.from(phaseSet).map((phase) => {
    const ts = real.filter((t) => (t.phase || 'General') === phase);
    const dur = ts.reduce((s, t) => s + Math.max(1, t.durationDays || 1), 0);
    const pct = dur > 0 ? Math.round(ts.reduce((s, t) => s + (t.progress ?? 0) * Math.max(1, t.durationDays || 1), 0) / dur) : 0;
    return { phase, percent: pct };
  });

  const critIds = new Set(cpm.criticalPath);
  const criticalPath = cpm.criticalPath
    .map((id) => tasks.find((t) => t.id === id))
    .filter((t): t is ScheduleTask => !!t && !t.isSummary)
    .map((t) => ({ id: t.id, title: t.title || 'Untitled', startIso: isoShort(startDateIso, t.startDay ?? 1), finishIso: isoShort(startDateIso, finishDay(t)), isMilestone: !!t.isMilestone }));

  // 3-week look-ahead from the data date.
  const lookahead = [0, 1, 2].map((w) => {
    const lo = dayCursor + w * 7, hi = lo + 6;
    const items = real
      .filter((t) => { const s = t.startDay ?? 1; const e = finishDay(t); return s <= hi && e >= lo; })
      .slice(0, 6)
      .map((t) => ({ title: t.title || 'Untitled', crew: t.crew || (t.assignedSubName ?? ''), startIso: isoShort(startDateIso, t.startDay ?? 1), finishIso: isoShort(startDateIso, finishDay(t)), isMilestone: !!t.isMilestone }));
    return { weekLabel: w === 0 ? 'This week' : w === 1 ? 'Next week' : '+2 weeks', items };
  });

  const milestones = tasks
    .filter((t) => (t.isMilestone || (t.durationDays || 0) === 0) && finishDay(t) >= dayCursor)
    .slice(0, 8)
    .map((t) => { const blEnd = baselineEndById.get(t.id) ?? null; const v = blEnd != null ? finishDay(t) - blEnd : null; return { title: t.title || 'Milestone', dateIso: isoShort(startDateIso, finishDay(t)), varianceDays: v, onTime: v == null || v <= 0 }; });

  const slippages = ganttRows.filter((r) => (r.deltaDays ?? 0) > 0).sort((a, b) => (b.deltaDays ?? 0) - (a.deltaDays ?? 0)).slice(0, 8).map((r) => ({ title: r.title, deltaDays: r.deltaDays ?? 0 }));

  const minTotalFloat = real.length ? Math.min(...real.map((t) => cpm.perTask.get(t.id)?.totalFloat ?? 0)) : 0;
  const overdueCount = real.filter((t) => (t.status !== 'done' && (t.progress ?? 0) < 100) && finishDay(t) < dayCursor).length;
  const unstaffedCount = real.filter((t) => !t.isMilestone && !(t.crew || '').trim() && !t.assignedSubName && (t.status !== 'done')).length;
  const behindCount = ganttRows.filter((r) => (r.deltaDays ?? 0) > 0).length;
  const spi = scheduleSpi(tasks, dayCursor);

  // Weather/closures summary from the project calendar's non-working dates that
  // fall within the schedule span (skip generic weekends — only explicit closures).
  const spanEndMs = baseMs + (totalDays - 1) * MS_DAY;
  const closures = (nonWorkingDates ?? [])
    .map((iso) => ({ iso, ms: startOfDay(new Date(iso + 'T00:00:00')) }))
    .filter((c) => Number.isFinite(c.ms) && c.ms >= baseMs && c.ms <= spanEndMs)
    .sort((a, b) => a.ms - b.ms);
  const weatherClosures: ScheduleReportModel['weatherClosures'] = closures.slice(0, 6).map((c) => ({
    label: new Date(c.iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    note: 'non-working day',
  }));
  if (closures.length > 6) weatherClosures.push({ label: `+${closures.length - 6} more`, note: 'closures in span' });

  return {
    header: {
      projectName: project.name, location: project.location || '', company: company?.name ?? null,
      client: project.primaryContact?.name ?? null,
      reportDateIso: reportDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
      dataDateIso: reportDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
      startIso: new Date(startDateIso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
      forecastFinishIso: isoAddDays(startDateIso, forecastFinishDay),
      baselineFinishIso: baselineFinishDay != null ? isoAddDays(startDateIso, baselineFinishDay) : null,
      forecastVarianceDays, taskCount: real.length, phaseCount: phaseSet.size, spanDays: totalDays,
    },
    kpis: {
      percentComplete, tasksDone, tasksTotal: real.length, forecastVarianceDays, spi,
      svDays: forecastVarianceDays != null ? -forecastVarianceDays : null,
      criticalCount: criticalPath.length, minTotalFloat, behindCount, overdueCount, unstaffedCount,
    },
    criticalPath, risks: detectRisks(tasks, cpm, dayCursor, baselineEndById),
    lookahead, milestones, ganttRows, slippages, phaseProgress,
    weatherClosures: [], // populated from schedule.nonWorkingDates in Task 4 caller if desired
  };
}
```

(Note: the `inspection` risk text uses the task's start day — keep it simple; the implementer may refine the wording. Remove the dead `isoShort('', 0)` guard — write `text: \`${t.title} — upcoming inspection, book ahead\``.)

- [ ] **Step 2: Fix the inspection-risk text** to `text: \`${t.title} — upcoming inspection, book ahead\`` (drop the placeholder expression shown above).

- [ ] **Step 3: Verify imports resolve**

Run: `grep -n "export interface CpmResult\|perTask\|projectFinish\|criticalPath" utils/cpm.ts | head` and `grep -n "primaryContact\|baselineEndDay\|export interface ScheduleBaseline" types/index.ts | head`
Expected: `CpmResult`, `primaryContact`, `baselineEndDay`, `ScheduleBaseline` all present (confirms field names used above).

- [ ] **Step 4: Type-check + grep + commit**

Run: `npx tsc --noEmit` → clean.
Run: `grep -n "export function assembleScheduleReport\|export function scheduleSpi\|export function pickPaperSize" utils/scheduleReportModel.ts` → matches.
```bash
git add utils/scheduleReportModel.ts
git commit -m "feat(schedule): PM report data model (CPM + baseline + schedule-SPI + risks)"
```

---

## Task 4: Report HTML renderer — `utils/scheduleReportHtml.ts`

**Files:** Create `utils/scheduleReportHtml.ts`

**FIRST read the approved mockup** `docs/superpowers/specs/2026-05-24-schedule-export-mockup.html` — it is the exact visual target (the `.R` report block: header, KPI cards `.K`, three-column band `.cols` with critical path / risk `.risk` / look-ahead `.la`, the gantt `table.G` with bars `.tl/.bar/.bl/.prog/.ms`, slippages, phase progress `.ph2`, weather, legend). Port that markup + CSS into the function below, binding to the model fields.

This file is self-contained (its own `escapeHtml`/paper maps) so the shipped `exportSchedulePdf.ts` is untouched.

- [ ] **Step 1: Create the file skeleton + helpers**

```ts
import type { ScheduleReportModel, ReportOptions, ReportPaperSize, ReportSectionKey } from '@/utils/scheduleReportModel';

function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// @page size per paper size (landscape unless portrait requested).
function pageCss(size: ReportPaperSize, orientation: 'landscape' | 'portrait'): string {
  const land = orientation === 'landscape';
  switch (size) {
    case 'letter':  return land ? '11in 8.5in' : '8.5in 11in';
    case 'a4':      return land ? 'A4 landscape' : 'A4 portrait';
    case 'tabloid': return land ? '17in 11in' : '11in 17in';
    case 'arch_d':  return land ? '36in 24in' : '24in 36in';
    case 'arch_e':  return land ? '48in 36in' : '36in 48in';
    case 'a3':
    default:        return land ? 'A3 landscape' : 'A3 portrait';
  }
}

// Font/bar scale per paper size — bigger paper ⇒ bigger type & bars (not stretched).
function scale(size: ReportPaperSize): { base: number; h1: number; kpi: number; cell: number; bar: number } {
  switch (size) {
    case 'letter':
    case 'a4':      return { base: 9,  h1: 17, kpi: 14, cell: 7.5, bar: 9 };
    case 'tabloid': return { base: 11, h1: 22, kpi: 18, cell: 9,   bar: 11 };
    case 'arch_d':  return { base: 15, h1: 30, kpi: 24, cell: 12,  bar: 15 };
    case 'arch_e':  return { base: 19, h1: 38, kpi: 30, cell: 15,  bar: 19 };
    case 'a3':
    default:        return { base: 10, h1: 20, kpi: 16, cell: 8,   bar: 10 };
  }
}

const has = (opts: ReportOptions, k: ReportSectionKey) => opts.sections.includes(k);

export function renderScheduleReportHtml(model: ScheduleReportModel, opts: ReportOptions): string {
  const s = scale(opts.paperSize);
  const margin = opts.paperSize === 'arch_d' || opts.paperSize === 'arch_e' ? '24mm' : '16mm';
  const fit = opts.fitToOnePage ? 'transform: scale(0.92); transform-origin: top left;' : '';
  const breakRule = opts.singleWallSheet ? '' : 'tr, .card, .band { page-break-inside: avoid; } thead { display: table-header-group; }';
  // ... build section HTML strings (see Step 2), then assemble the document:
  return `<!doctype html><html><head><meta charset="utf-8"/>
<title>${esc(model.header.projectName)} — MAGE Schedule Report</title>
<style>
  @page { size: ${pageCss(opts.paperSize, opts.orientation)}; margin: ${margin}; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color:#111; margin:0; font-size:${s.base}px; ${fit} }
  ${breakRule}
  /* PORT the rest of the CSS from docs/superpowers/specs/2026-05-24-schedule-export-mockup.html
     (the .R/.K/.cols/.risk/.la/table.G/.tl/.bar/.bl/.prog/.ms/.ph2/.legend rules),
     swapping hardcoded px for the ${'${s.*}'} scale where it controls body/kpi/cell/bar/h1 sizes. */
</style></head>
<body>${sectionsHtml(model, opts, s)}</body></html>`;
}
```

- [ ] **Step 2: Implement `sectionsHtml` + per-section builders**

Add a `sectionsHtml(model, opts, s)` that concatenates, in this order, only the enabled sections (use `has(opts, key)`):
1. **header** (always) — `model.header`: brand eyebrow, project name (`h1` at `s.h1`px), location · company · client line; right-aligned meta with report date, data date, start, **forecast finish + variance** (`+Nd vs baseline` when `forecastVarianceDays != null`), task/phase/span counts. Port `.R .hd`/`.eb`/`.meta` markup.
2. **kpis** (`'kpis'`) — render the KPI cards from `model.kpis`: % complete, forecast variance, SPI (`model.kpis.spi.toFixed(2)`), critical count, min total float, behind, overdue, unstaffed. Tone classes: red when bad (variance>0, spi<0.95, float≤0, behind/overdue>0). Port `.K`.
3. **critPath / risks / lookahead** (each gated) inside the `.cols` 3-column band — map `model.criticalPath`, `model.risks` (tag class by `severity`: hi/md/lo), `model.lookahead` (week columns) + `model.milestones`. Port `.cols/.cp/.risk/.la`.
4. **gantt** (`'gantt'`) — `table.G`: header row (#, Task, Crew, Start, Finish, BL Fin, Δ, TF, FF, %, plus **Pred** column only when `opts.showPredecessors`), then phase-grouped rows. For each `ReportGanttRow`: a `.tl` track containing `.bl` (baselineBar) when present, `.bar`/`.bar.c` (critical) positioned by `bar.leftPct/widthPct`, `.prog` for `percent`, `.ms` for milestones. Δ cell red when `deltaDays>0`. Insert a `tr.ph` phase header whenever `row.phase` changes; show the phase's `phaseProgress` % in that header.
5. **slippages** (`'slippages'`) + **phaseProgress** (`'phaseProgress'`) + **weather** (`'weather'`) in a closing `.cols` band — map `model.slippages`, `model.phaseProgress` (`.ph2` bars), `model.weatherClosures`.
6. **register** (`'register'`, Dossier only) — a full task table (every `ganttRow`: #, Task, Phase, Crew, Start, Finish, Dur implied, %, Pred) with no bars.
7. **legend + footer** (always) — port `.legend`; footer `Generated by MAGE ID · ${model.header.reportDateIso}`.

Each builder returns `''` when its section is disabled. Use `esc()` on every string field. Numbers need no escaping.

**Exact markup/CSS:** copy each block from the mockup file verbatim, then replace the static demo values with `model.*` bindings and swap the size-controlling font-sizes for the `s.*` scale values. Do not invent new visual styling — the mockup is the source of truth.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit` → clean.

- [ ] **Step 4: Grep**

Run: `grep -n "export function renderScheduleReportHtml\|function pageCss\|function scale\|page-break-inside" utils/scheduleReportHtml.ts` → all match.

- [ ] **Step 5: Commit**

```bash
git add utils/scheduleReportHtml.ts
git commit -m "feat(schedule): paginated, per-paper-size PM report HTML renderer"
```

---

## Task 5: Export glue — `utils/scheduleReportExport.ts`

**Files:** Create `utils/scheduleReportExport.ts`

Wraps expo-print/sharing for the PDF, and reuses existing generators for CSV + share link. (iCal is reused directly via `exportScheduleIcal({ project })` in the Export Center — no wrapper needed.)

Verified reuse points: `exportTasksToCsv(tasks, projectStartDate: Date): string` and `buildSharePayload(name, projectStartDate: Date, tasks, opts?) ` + `tryEncodeShareToken(payload)` are in `utils/scheduleOps.ts`. **Important:** call `buildSharePayload` WITHOUT `opts` so the token stays schema **v1** (the viewer's `decodeShareToken` only accepts v1).

- [ ] **Step 1: Create the file**

```ts
import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import type { ScheduleTask } from '@/types';
import { exportTasksToCsv, buildSharePayload, tryEncodeShareToken } from '@/utils/scheduleOps';

/** Render HTML → PDF and present the iOS preview/share sheet (or print tab on web). */
export async function generateScheduleReportPdf(html: string, title: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return;
    const w = window.open('', '_blank', 'noopener,noreferrer');
    if (!w) { const blob = new Blob([html], { type: 'text/html' }); window.open(URL.createObjectURL(blob), '_blank'); return; }
    w.document.open(); w.document.write(html); w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch { /* user can Cmd-P */ } }, 350);
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: title, UTI: 'com.adobe.pdf' });
  else await Print.printAsync({ uri });
}

/** Write the schedule CSV to a temp file and share it (native) / download (web). */
export async function shareScheduleCsv(tasks: ScheduleTask[], projectStartDate: Date, projectName: string): Promise<void> {
  const csv = exportTasksToCsv(tasks, projectStartDate);
  const filename = `${projectName.replace(/[^\w]+/g, '_')}_schedule.csv`;
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return;
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    return;
  }
  const uri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, csv, { encoding: 'utf8' });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: filename });
}

/** Build a read-only share URL for the schedule (inline v1 token). Returns null if oversize. */
export function buildScheduleShareUrl(projectName: string, projectStartDate: Date, tasks: ScheduleTask[]): string | null {
  const payload = buildSharePayload(projectName, projectStartDate, tasks); // no opts → v1 token (decodable)
  const res = tryEncodeShareToken(payload);
  if (res.kind !== 'inline') return null; // oversize: caller shows "too large to link" message
  return `https://rork.com/shared-schedule?t=${encodeURIComponent(res.token)}`;
}
```

- [ ] **Step 2: Verify reuse signatures**

Run: `grep -n "export function exportTasksToCsv\|export function buildSharePayload\|export function tryEncodeShareToken\|export async function exportScheduleIcal" utils/scheduleOps.ts utils/scheduleExportIcal.ts`
Expected: all present. If `tryEncodeShareToken`'s success shape differs from `{ kind: 'inline'; token }`, adjust the guard. Confirm the shared-schedule route base (`grep -n "shared-schedule" app/schedule-pro.tsx | head` — match its URL host/scheme; if it builds a relative `/shared-schedule?t=` path, use that instead of the rork.com host).

- [ ] **Step 3: Type-check + grep + commit**

Run: `npx tsc --noEmit` → clean.
Run: `grep -n "generateScheduleReportPdf\|shareScheduleCsv\|buildScheduleShareUrl" utils/scheduleReportExport.ts` → matches.
```bash
git add utils/scheduleReportExport.ts
git commit -m "feat(schedule): export glue — PDF via expo-print/sharing + CSV + share URL"
```

---

## Task 6: ExportCenterSheet (the friendly export UI)

**Files:** Create `components/schedule/mobile/ExportCenterSheet.tsx`

Theme-aware modal (mirror `TaskDetailSheet`). Receives the data it needs and does the assemble→render→export. Presets are one-tap; "Customize" exposes size/orientation/sections/fit.

- [ ] **Step 1: Create the component**

```tsx
import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, FileText, Hammer, FileStack, Sheet, Share as ShareIcon, CalendarPlus, Printer } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import type { Project, ScheduleTask, ScheduleBaseline } from '@/types';
import type { CpmResult } from '@/utils/cpm';
import {
  assembleScheduleReport, pickPaperSize,
  type ReportPaperSize, type ReportSectionKey, type ReportOptions,
} from '@/utils/scheduleReportModel';
import { renderScheduleReportHtml } from '@/utils/scheduleReportHtml';
import { generateScheduleReportPdf, shareScheduleCsv, buildScheduleShareUrl } from '@/utils/scheduleReportExport';

const ALL_SECTIONS: ReportSectionKey[] = ['kpis','critPath','risks','lookahead','milestones','gantt','slippages','phaseProgress','weather'];
const SIZES: { key: ReportPaperSize | 'auto'; label: string }[] = [
  { key: 'auto', label: 'Auto' }, { key: 'letter', label: 'Letter' }, { key: 'a4', label: 'A4' },
  { key: 'tabloid', label: 'Tabloid' }, { key: 'a3', label: 'A3' }, { key: 'arch_d', label: 'Arch D' }, { key: 'arch_e', label: 'Arch E' },
];

interface Props {
  visible: boolean; onClose: () => void;
  project: Project; tasks: ScheduleTask[]; startDateIso: string; cpm: CpmResult;
  baseline?: ScheduleBaseline | null;
  nonWorkingDates?: string[];
  onExportIcal: () => void;     // parent passes () => exportScheduleIcal({ project })
}

export function ExportCenterSheet({ visible, onClose, project, tasks, startDateIso, cpm, baseline, nonWorkingDates, onExportIcal }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [size, setSize] = useState<ReportPaperSize | 'auto'>('auto');
  const [landscape, setLandscape] = useState(true);
  const [fitOne, setFitOne] = useState(false);
  const [showPred, setShowPred] = useState(false);
  const [sections, setSections] = useState<ReportSectionKey[]>(ALL_SECTIONS);

  const resolveSize = (s: ReportPaperSize | 'auto'): ReportPaperSize => s === 'auto' ? pickPaperSize(tasks.filter((t) => !t.isSummary).length) : s;

  const runReport = async (override?: Partial<ReportOptions> & { paperSizeChoice?: ReportPaperSize | 'auto'; secs?: ReportSectionKey[] }) => {
    if (busy) return;
    setBusy(true);
    try {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const model = assembleScheduleReport({ project, tasks, startDateIso, cpm, baseline, nonWorkingDates });
      const opts: ReportOptions = {
        paperSize: resolveSize(override?.paperSizeChoice ?? size),
        orientation: override?.orientation ?? (landscape ? 'landscape' : 'portrait'),
        sections: override?.secs ?? sections,
        fitToOnePage: override?.fitToOnePage ?? fitOne,
        showPredecessors: override?.showPredecessors ?? showPred,
        singleWallSheet: override?.singleWallSheet ?? false,
      };
      const html = renderScheduleReportHtml(model, opts);
      await generateScheduleReportPdf(html, `${project.name} — Schedule Report`);
      onClose();
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : 'Please try again.');
    } finally { setBusy(false); }
  };

  const runCsv = async () => { try { setBusy(true); await shareScheduleCsv(tasks, new Date(startDateIso), project.name); onClose(); } catch (e) { Alert.alert('Export failed', e instanceof Error ? e.message : 'Try again.'); } finally { setBusy(false); } };
  const runShare = async () => {
    const url = buildScheduleShareUrl(project.name, new Date(startDateIso), tasks);
    if (!url) { Alert.alert('Schedule too large', 'This schedule is too large for a quick link — export a PDF instead.'); return; }
    try { const { Share } = await import('react-native'); await Share.share({ message: `${project.name} schedule: ${url}`, url }); onClose(); } catch { /* user cancelled */ }
  };

  const toggleSection = (k: ReportSectionKey) => setSections((cur) => cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16, maxHeight: '88%' }]}>
        <View style={styles.grab} />
        <View style={styles.headRow}><Text style={styles.title}>Export schedule</Text><TouchableOpacity onPress={onClose}><X size={20} color={colors.textMuted} /></TouchableOpacity></View>
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Presets */}
          <Text style={styles.section}>One-tap</Text>
          <Preset icon={<FileText size={18} color={colors.accent} />} label="Client Report" sub="A3 · summary + gantt · for the owner" onPress={() => runReport({ paperSizeChoice: 'a3', secs: ['kpis','critPath','risks','milestones','gantt','phaseProgress'] })} styles={styles} />
          <Preset icon={<Hammer size={18} color={colors.accent} />} label="Field Gantt" sub="Arch D · look-ahead + big gantt · trailer wall" onPress={() => runReport({ paperSizeChoice: 'arch_d', secs: ['kpis','lookahead','risks','gantt'], singleWallSheet: true })} styles={styles} />
          <Preset icon={<FileStack size={18} color={colors.accent} />} label="Full Dossier" sub="Auto size · everything + task register" onPress={() => runReport({ paperSizeChoice: 'auto', secs: [...ALL_SECTIONS, 'register'], showPredecessors: true })} styles={styles} />
          <Preset icon={<Sheet size={18} color={colors.accent} />} label="CSV" sub="Open in Excel · 1 row per task" onPress={runCsv} styles={styles} />
          <Preset icon={<ShareIcon size={18} color={colors.accent} />} label="Share link" sub="Read-only · no login" onPress={runShare} styles={styles} />
          <Preset icon={<CalendarPlus size={18} color={colors.accent} />} label="iCal" sub="Add to Apple/Google Calendar" onPress={() => { onExportIcal(); onClose(); }} styles={styles} />

          {/* Customize */}
          <TouchableOpacity style={styles.customToggle} onPress={() => setShowCustom((v) => !v)}><Text style={styles.customToggleText}>{showCustom ? '▾ Customize' : '▸ Customize'}</Text></TouchableOpacity>
          {showCustom && (
            <View style={styles.customBox}>
              <Text style={styles.section}>Paper size</Text>
              <View style={styles.chipRow}>{SIZES.map((sz) => (
                <TouchableOpacity key={sz.key} style={[styles.chip, size === sz.key && styles.chipOn]} onPress={() => setSize(sz.key)}><Text style={[styles.chipText, size === sz.key && styles.chipTextOn]}>{sz.label}</Text></TouchableOpacity>
              ))}</View>
              <View style={styles.toggleRow}><Text style={styles.toggleLabel}>Landscape</Text><Switch01 on={landscape} onToggle={() => setLandscape((v) => !v)} styles={styles} /></View>
              <View style={styles.toggleRow}><Text style={styles.toggleLabel}>Fit to one page</Text><Switch01 on={fitOne} onToggle={() => setFitOne((v) => !v)} styles={styles} /></View>
              <View style={styles.toggleRow}><Text style={styles.toggleLabel}>Predecessors column</Text><Switch01 on={showPred} onToggle={() => setShowPred((v) => !v)} styles={styles} /></View>
              <Text style={styles.section}>Sections</Text>
              <View style={styles.chipRow}>{ALL_SECTIONS.map((k) => (
                <TouchableOpacity key={k} style={[styles.chip, sections.includes(k) && styles.chipOn]} onPress={() => toggleSection(k)}><Text style={[styles.chipText, sections.includes(k) && styles.chipTextOn]}>{k}</Text></TouchableOpacity>
              ))}</View>
              <TouchableOpacity style={[styles.generateBtn, busy && { opacity: 0.5 }]} disabled={busy} onPress={() => runReport()} testID="generate-report"><Text style={styles.generateBtnText}>{busy ? 'Generating…' : 'Generate PDF'}</Text></TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Preset({ icon, label, sub, onPress, styles }: { icon: React.ReactNode; label: string; sub: string; onPress: () => void; styles: ReturnType<typeof makeStyles> }) {
  return (
    <TouchableOpacity style={styles.preset} activeOpacity={0.7} onPress={onPress} testID={`preset-${label}`}>
      <View style={styles.presetIcon}>{icon}</View>
      <View style={{ flex: 1 }}><Text style={styles.presetLabel}>{label}</Text><Text style={styles.presetSub}>{sub}</Text></View>
      <Text style={styles.chev}>›</Text>
    </TouchableOpacity>
  );
}
function Switch01({ on, onToggle, styles }: { on: boolean; onToggle: () => void; styles: ReturnType<typeof makeStyles> }) {
  return <TouchableOpacity onPress={onToggle} style={[styles.sw, on && styles.swOn]}><View style={[styles.swKnob, on && styles.swKnobOn]} /></TouchableOpacity>;
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { position: 'absolute' as const, left: 0, right: 0, bottom: 0, backgroundColor: t.bg, borderTopLeftRadius: Tokens.radius.xl, borderTopRightRadius: Tokens.radius.xl, padding: 16 },
  grab: { width: 40, height: 4, borderRadius: 2, backgroundColor: t.line, alignSelf: 'center' as const, marginBottom: 12 },
  headRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 8 },
  title: { fontSize: 18, fontWeight: '800' as const, color: t.text },
  section: { fontSize: 11, fontWeight: '800' as const, letterSpacing: 0.5, textTransform: 'uppercase' as const, color: t.textMuted, marginTop: 12, marginBottom: 6 },
  preset: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingVertical: 11 },
  presetIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: t.surfaceAlt, alignItems: 'center' as const, justifyContent: 'center' as const },
  presetLabel: { fontSize: 15, fontWeight: '700' as const, color: t.text },
  presetSub: { fontSize: 11, color: t.textMuted, marginTop: 1 },
  chev: { fontSize: 20, color: t.textMuted },
  customToggle: { paddingVertical: 12 }, customToggleText: { fontSize: 14, fontWeight: '700' as const, color: t.accent },
  customBox: { gap: 4 },
  chipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: Tokens.radius.md, backgroundColor: t.surfaceAlt },
  chipOn: { backgroundColor: t.accent },
  chipText: { fontSize: 12, fontWeight: '600' as const, color: t.text }, chipTextOn: { color: '#FFFFFF' },
  toggleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, paddingVertical: 8 },
  toggleLabel: { fontSize: 14, color: t.text },
  sw: { width: 44, height: 26, borderRadius: 13, backgroundColor: t.line, padding: 3 }, swOn: { backgroundColor: t.accent },
  swKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF' }, swKnobOn: { alignSelf: 'flex-end' as const },
  generateBtn: { marginTop: 14, backgroundColor: t.accent, borderRadius: Tokens.radius.md, paddingVertical: 13, alignItems: 'center' as const },
  generateBtnText: { fontSize: 15, fontWeight: '800' as const, color: '#FFFFFF' },
});
```

- [ ] **Step 2: Verify lucide icons + Tokens**

Run: `grep -rn "FileStack\|Sheet\b" node_modules/lucide-react-native/dist/esm/lucide-react-native.d.ts | head` (or just `npx tsc --noEmit`). If `FileStack` or `Sheet` aren't exported by the installed lucide version, swap for confirmed ones (`FileText`, `Table`, `Files`). Confirm `Tokens.radius.xl/md` exist: `grep -n "radius" constants/designTokens.ts | head`.

- [ ] **Step 3: Type-check + grep + commit**

Run: `npx tsc --noEmit` → clean.
Run: `grep -n "export function ExportCenterSheet\|renderScheduleReportHtml\|preset-" components/schedule/mobile/ExportCenterSheet.tsx` → matches.
```bash
git add components/schedule/mobile/ExportCenterSheet.tsx
git commit -m "feat(schedule): mobile Export Center (presets + customize)"
```

---

## Task 7: Wire the Export Center into MobileScheduleScreen

**Files:** Modify `components/schedule/mobile/MobileScheduleScreen.tsx`

- [ ] **Step 1: Imports + CPM**

Add to lucide import: `Download` (export icon).
Add: `import { ExportCenterSheet } from './ExportCenterSheet';`, `import { runCpm } from '@/utils/cpm';`, `import { exportScheduleIcal } from '@/utils/scheduleExportIcal';`.

- [ ] **Step 2: State + memoized CPM**

Near the other state, add:
```ts
const [showExport, setShowExport] = useState(false);
const reportCpm = useMemo(
  () => runCpm(tasks, { scheduleStartDate: startDate, workingDaysPerWeek: activeSchedule?.workingDaysPerWeek, nonWorkingDates: activeSchedule?.nonWorkingDates }),
  [tasks, startDate, activeSchedule?.workingDaysPerWeek, activeSchedule?.nonWorkingDates],
);
```

- [ ] **Step 3: Export icon in the header**

Add another `styles.iconBtn` button as a sibling before the Bell (after the calendar button):
```tsx
<TouchableOpacity style={styles.iconBtn} onPress={() => setShowExport(true)} accessibilityLabel="Export schedule" testID="open-export" disabled={tasks.length === 0}>
  <Download size={19} color={tasks.length === 0 ? colors.textMuted : colors.text} />
</TouchableOpacity>
```

- [ ] **Step 4: Mount the sheet**

Next to the `MonthCalendarSheet` mount:
```tsx
<ExportCenterSheet
  visible={showExport}
  onClose={() => setShowExport(false)}
  project={selectedProject}
  tasks={tasks}
  startDateIso={startDate}
  cpm={reportCpm}
  baseline={activeSchedule?.baseline ?? null}
  nonWorkingDates={activeSchedule?.nonWorkingDates}
  onExportIcal={() => { void exportScheduleIcal({ project: selectedProject }); }}
/>
```

- [ ] **Step 5: Type-check + grep + commit**

Run: `npx tsc --noEmit` → clean.
Run: `grep -n "ExportCenterSheet\|open-export\|reportCpm" "components/schedule/mobile/MobileScheduleScreen.tsx"` → matches.
```bash
git add components/schedule/mobile/MobileScheduleScreen.tsx
git commit -m "feat(schedule): wire Export Center into mobile schedule"
```

---

## Final verification (after all tasks)

- [ ] `npx tsc --noEmit` clean at the worktree root.
- [ ] `bun run lint` — no new errors on the touched files (design-token warnings are pre-existing; new inline hex in the HTML *string* is fine — it's not RN styles).
- [ ] Whole-implementation review (opus): model math correct (float, %, variance vs baseline, schedule-SPI), renderer ports the mockup faithfully + paginates + scales per size, export glue handles web + native + share-too-large, no `any`, OTA-safe.
- [ ] **Do NOT OTA here** — the controller ships after review.

## Edge cases covered (from spec)
- No baseline → variance/slippages/BL columns omitted; SPI from schedule-SPI.
- No tasks → export icon disabled.
- No crew/dates → unstaffed risk / em-dashes.
- Long schedule → paginates (or single wall sheet on Arch D/E).
- Web → print-tab path for PDF; `<a download>` for CSV.
- Share token oversize → friendly "too large, export PDF" alert.

## Out of scope (v1)
In-app WebView live preview (no `react-native-webview`); S-curve chart; xlsx; preset sync; fixing the v2/v3 `decodeShareToken` bug (we stay on v1 tokens).
