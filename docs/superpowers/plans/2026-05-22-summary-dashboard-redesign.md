# Summary "Morning Briefing" Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Summary tab's card-stack with a glanceable login briefing — hero greeting + Today on site + This Week + Money + Needs You — with the Tools list moved into a "•••" overflow sheet.

**Architecture:** A pure, React-free rollup util computes today/this-week/attention from the existing context data. Six focused presentational components render each widget. The screen composes them with loading + empty states. Theme-aware via `useThemedStyles`. No backend, no new deps.

**Tech Stack:** React Native / Expo Router, TypeScript (strict, no `any`), `lucide-react-native`, existing `ProjectContext` hooks + cash-flow engine.

**Visual reference:** the approved mockup at `.superpowers/brainstorm/40441-1779496231/content/dashboard-A-v2.html`. Map its hex to theme tokens (`ThemeColors`) so it works in light **and** dark.

**Spec:** `docs/superpowers/specs/2026-05-22-summary-dashboard-redesign-design.md` (@ 33589eb).

**Per-task gate:** `npx tsc --noEmit` clean at worktree root. The repo has **no unit-test runner**, so Task 1 ships with example input→output cases to sanity-check by reading; all other gating is tsc + manual walkthrough.

---

## File Structure

- **Create** `utils/summaryBriefing.ts` — pure functions: `computeTodayTasks`, `computeWeekLoad`, `aggregateAttention`, `projectColor`, `chipInitials` + their exported types. No React, no imports beyond `@/types`. (NOTE: `utils/summaryRollup.ts` already exists — it's the unrelated WBS summary-task rollup; do **not** touch it.)
- **Create** `components/summary/BriefingHero.tsx` — date line + greeting + status pills + `•••` button.
- **Create** `components/summary/TodayOnSite.tsx` — Today card (list + empty).
- **Create** `components/summary/WeekAheadStrip.tsx` — 7-day bar chart, today highlight, ◆ markers.
- **Create** `components/summary/MoneyStrip.tsx` — 3-stat tinted strip with tap targets.
- **Create** `components/summary/NeedsYou.tsx` — attention list (hidden when empty).
- **Create** `components/summary/ToolsSheet.tsx` — overflow `Modal` of tool `NavRow`s.
- **Rewrite** `app/(tabs)/summary/index.tsx` — compose widgets; loading skeleton; existing "No projects yet" `EmptyState`; tools-sheet state.

All components use `useTheme()` + `useThemedStyles(makeStyles)`, `Type`/`Tokens` constants, `lucide-react-native` icons. Routes used are only confirmed-existing ones: `/reports`, `/cash-flow`, `/report-inbox`, `/leads`, `/buyout`, `/tax-1099-export`, `/project-detail`.

---

## Task 1: Pure rollup util

**Files:**
- Create: `utils/summaryRollup.ts`

- [ ] **Step 1: Write `utils/summaryRollup.ts` in full**

```typescript
// utils/summaryRollup.ts
// Pure, React-free rollups that power the Summary "Morning Briefing".
// Day math: each project's schedule lives in a day-index space anchored at
// schedule.startDate (fallback project.createdAt). A calendar day maps to a
// per-project index; a task is "active" on that day when
// startDay <= index <= startDay + durationDays.
import type { Project, Invoice, PunchItem, ChangeOrder } from '@/types';

const MS_DAY = 24 * 60 * 60 * 1000;

export interface TodayTask {
  projectId: string;
  projectName: string;
  projectColor: string;
  taskTitle: string;
  isCritical: boolean;
  context: string; // crew or assigned sub; '' when none
}

export interface WeekDay {
  date: string;          // ISO yyyy-mm-dd
  weekdayLabel: string;  // 'M' 'T' 'W' 'T' 'F' 'S' 'S'
  isToday: boolean;
  isWeekend: boolean;
  count: number;         // tasks active that day across all projects
  hasMilestone: boolean; // a milestone lands that day
}
export interface WeekLoad {
  days: WeekDay[];       // length 7, Monday→Sunday
  totalTasks: number;    // sum of per-day counts
  milestoneCount: number;// milestone tasks landing within the week
}

export type AttentionSeverity = 'danger' | 'amber';
export interface AttentionItem {
  id: string;
  severity: AttentionSeverity;
  label: string;
  actionLabel: string;            // 'Send' | 'View' | 'Review'
  route: string;                  // expo-router pathname (confirmed routes only)
  params?: Record<string, string>;
}

const SUMMARY_PROJECT_COLORS = ['#F2700A', '#0A84FF', '#1F9D57', '#7A5AF8', '#0FB5AE', '#D0211A'];

export function projectColor(projectId: string): string {
  let h = 0;
  for (let i = 0; i < projectId.length; i++) h = (h * 31 + projectId.charCodeAt(i)) >>> 0;
  return SUMMARY_PROJECT_COLORS[h % SUMMARY_PROJECT_COLORS.length];
}

export function chipInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '–';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function startOfDayMs(d: Date): number { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }

function projectStartBaseMs(p: Project): number {
  const raw = p.schedule?.startDate ? new Date(p.schedule.startDate) : new Date(p.createdAt);
  raw.setHours(0, 0, 0, 0);
  return raw.getTime();
}

function dayIndexFor(p: Project, dayMs: number): number {
  return Math.round((dayMs - projectStartBaseMs(p)) / MS_DAY);
}

export function computeTodayTasks(projects: Project[], now: Date = new Date()): TodayTask[] {
  const todayMs = startOfDayMs(now);
  const out: TodayTask[] = [];
  for (const p of projects) {
    const tasks = p.schedule?.tasks;
    if (!tasks || tasks.length === 0) continue;
    const idx = dayIndexFor(p, todayMs);
    for (const t of tasks) {
      if (t.status === 'done') continue;
      const start = t.startDay ?? 0;
      const end = start + Math.max(0, t.durationDays ?? 0);
      if (idx >= start && idx <= end) {
        out.push({
          projectId: p.id,
          projectName: p.name,
          projectColor: projectColor(p.id),
          taskTitle: t.title,
          isCritical: !!t.isCriticalPath,
          context: (t.crew || t.assignedSubName || '').trim(),
        });
      }
    }
  }
  return out.sort((a, b) => Number(b.isCritical) - Number(a.isCritical));
}

export function computeWeekLoad(projects: Project[], now: Date = new Date()): WeekLoad {
  const base = new Date(now); base.setHours(0, 0, 0, 0);
  const mondayOffset = (base.getDay() + 6) % 7; // 0 = Monday
  const monday = new Date(base); monday.setDate(base.getDate() - mondayOffset);
  const todayMs = base.getTime();
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const days: WeekDay[] = [];
  let totalTasks = 0;
  let milestoneCount = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i); d.setHours(0, 0, 0, 0);
    const dayMs = d.getTime();
    let count = 0;
    let hasMilestone = false;
    for (const p of projects) {
      const tasks = p.schedule?.tasks;
      if (!tasks) continue;
      const idx = dayIndexFor(p, dayMs);
      for (const t of tasks) {
        if (t.status === 'done') continue;
        const start = t.startDay ?? 0;
        const end = start + Math.max(0, t.durationDays ?? 0);
        if (idx >= start && idx <= end) {
          count++;
          if (t.isMilestone && idx === start) { hasMilestone = true; milestoneCount++; }
        }
      }
    }
    totalTasks += count;
    days.push({
      date: d.toISOString().slice(0, 10),
      weekdayLabel: labels[i],
      isToday: dayMs === todayMs,
      isWeekend: i >= 5,
      count,
      hasMilestone,
    });
  }
  return { days, totalTasks, milestoneCount };
}

export function aggregateAttention(
  projects: Project[],
  invoices: Invoice[],
  punchItems: PunchItem[],
  changeOrders: ChangeOrder[],
  now: Date = new Date(),
): AttentionItem[] {
  const nowMs = now.getTime();
  const out: AttentionItem[] = [];

  const overdue = invoices.filter(i => i.status !== 'paid' && i.dueDate && new Date(i.dueDate).getTime() < nowMs);
  if (overdue.length > 0) {
    const worst = [...overdue].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];
    const days = Math.max(1, Math.floor((nowMs - new Date(worst.dueDate).getTime()) / MS_DAY));
    out.push({
      id: 'overdue-invoices',
      severity: 'danger',
      label: overdue.length === 1 ? `Invoice ${days} days overdue` : `${overdue.length} invoices overdue (worst ${days}d)`,
      actionLabel: 'View',
      route: '/reports',
    });
  }

  const urgentPunch = punchItems.filter(pi => pi.status !== 'closed' && pi.priority === 'high');
  if (urgentPunch.length > 0) {
    out.push({
      id: 'urgent-punch',
      severity: 'danger',
      label: `${urgentPunch.length} high-priority punch item${urgentPunch.length === 1 ? '' : 's'}`,
      actionLabel: 'View',
      route: '/project-detail',
      params: { id: urgentPunch[0].projectId },
    });
  }

  const pendingCO = changeOrders.filter(co => co.status === 'submitted' || co.status === 'under_review');
  if (pendingCO.length > 0) {
    out.push({
      id: 'pending-cos',
      severity: 'amber',
      label: `${pendingCO.length} change order${pendingCO.length === 1 ? '' : 's'} awaiting approval`,
      actionLabel: 'Review',
      route: '/project-detail',
      params: { id: pendingCO[0].projectId },
    });
  }

  return out;
}
```

- [ ] **Step 2: Sanity-check the logic by reading these cases**

  - A project with `schedule.startDate = today` and a task `{startDay:0, durationDays:2, status:'in_progress'}` → appears in `computeTodayTasks` (idx 0 ∈ [0,2]).
  - A `done` task never appears in Today or the week counts.
  - `computeWeekLoad` returns exactly 7 days, Monday→Sunday, with `isToday` true on exactly one (when today is in range) and `isWeekend` true on indices 5,6.
  - `aggregateAttention` with no overdue invoices, no high punch, no pending COs → `[]`.

- [ ] **Step 3: tsc gate**

Run: `npx tsc --noEmit` → Expected: clean (exit 0).

- [ ] **Step 4: Commit**

```bash
git add utils/summaryRollup.ts
git commit -m "feat(summary): pure rollup util (today/week/attention/projectColor)"
```

---

## Task 2: BriefingHero

**Files:**
- Create: `components/summary/BriefingHero.tsx`

**Contract (props):**
```typescript
interface BriefingHeroProps {
  greetingName: string;   // already-resolved first name or '' 
  attentionCount: number; // drives the danger pill (hidden when 0)
  activeCount: number;    // muted "N active" pill
  onOpenTools: () => void;// the ••• button
}
```

- [ ] **Step 1: Build the component.** Render: an uppercase date line (`new Date().toLocaleDateString('en-US',{weekday:'long', month:'long', day:'numeric'}).toUpperCase()`), a greeting `Good morning${greetingName ? ', ' + greetingName : ''}` (title3/largeTitle weight 800, letterSpacing -0.6, color `text`), a pills row, and a `•••` button (lucide `MoreHorizontal`) top-right that calls `onOpenTools` (hitSlop, `accessibilityLabel="More tools"`, `testID="summary-tools-button"`). Danger pill (`backgroundColor: danger+'18'`, color `danger`) shows `${attentionCount} need${attentionCount===1?'s':''} attention` only when `attentionCount > 0`; muted pill (`surfaceAlt`/`textMuted`) shows `${activeCount} active`. Use the hero spacing from the mockup. Theme via `useThemedStyles`.

- [ ] **Step 2: tsc gate** — `npx tsc --noEmit` clean.
- [ ] **Step 3: Commit** — `git add components/summary/BriefingHero.tsx && git commit -m "feat(summary): BriefingHero (greeting + status pills + tools button)"`

---

## Task 3: TodayOnSite

**Files:**
- Create: `components/summary/TodayOnSite.tsx`

**Contract (props):**
```typescript
import type { TodayTask } from '@/utils/summaryRollup';
interface TodayOnSiteProps {
  tasks: TodayTask[];
  jobCount: number;                 // distinct projects represented
  onPressTask: (projectId: string) => void;
}
```

- [ ] **Step 1: Build the component.** A card (`surface`, radius `xl`, hairline `line`, soft shadow) with a section header: tinted icon square (accentSoft) holding lucide `CalendarClock` (or `Sun`), label `TODAY ON SITE`, right meta `${tasks.length} task(s) · ${jobCount} job(s)`. Each row (TouchableOpacity → `onPressTask(task.projectId)`): a 30px rounded color chip (`task.projectColor`, white `chipInitials(task.projectName)`), title (`task.taskTitle`, weight 700) over subtitle `${task.projectName}${task.context ? ' · ' + task.context : ''}` (muted), and a `CRIT` flag pill (`danger` soft) when `task.isCritical`. Hairline divider between rows. Empty state (tasks.length === 0): muted centered "Nothing scheduled on site today." Map mockup styles to theme tokens. `testID="summary-today"`.

- [ ] **Step 2: tsc gate** — clean.
- [ ] **Step 3: Commit** — `git commit -m "feat(summary): TodayOnSite widget"`

---

## Task 4: WeekAheadStrip

**Files:**
- Create: `components/summary/WeekAheadStrip.tsx`

**Contract (props):**
```typescript
import type { WeekLoad } from '@/utils/summaryRollup';
interface WeekAheadStripProps {
  week: WeekLoad;
  onPress?: () => void; // optional: jump to schedule
}
```

- [ ] **Step 1: Build the component.** Card with header: tinted icon square (info soft) + lucide `BarChart3`, label `THIS WEEK`, right meta `${week.totalTasks} tasks · ${week.milestoneCount} ◆`. Below: a 7-column bar row, fixed height ~74px. For each `day`: a bar whose height = `maxCount === 0 ? 6% : Math.max(8, (day.count / maxCount) * 100)%` (compute `maxCount = Math.max(1, ...counts)`); color = `accent` when `day.isToday`, muted grey (`line`/`textMuted` tint) when `day.isWeekend`, light-accent otherwise; a small ◆ (rotated square, `accent`) absolutely positioned above the bar when `day.hasMilestone`; weekday label below (`accent` + bold when today, else `textMuted`); a tiny `TODAY` tag under the today column. Empty (totalTasks === 0): muted "No scheduled work this week." `testID="summary-week"`.

- [ ] **Step 2: tsc gate** — clean.
- [ ] **Step 3: Commit** — `git commit -m "feat(summary): WeekAheadStrip widget"`

---

## Task 5: MoneyStrip

**Files:**
- Create: `components/summary/MoneyStrip.tsx`

**Contract (props):**
```typescript
interface MoneyStripProps {
  budget: number;
  outstanding: number;
  cash4wk: number | null;   // null = cash flow not set up → render '—'
  onPressOutstanding: () => void; // → /reports
  onPressCash: () => void;        // → /cash-flow
}
```

- [ ] **Step 1: Build the component.** Card with header: tinted icon square (success soft) + lucide `DollarSign`, label `MONEY`, right meta "across all jobs". A tinted inset row (`surfaceAlt`, radius `md`, hairline dividers) of 3 columns: Budget (`formatMoneyShort(budget)`, `text`), Outstanding (TouchableOpacity → `onPressOutstanding`; `formatMoneyShort(outstanding)`, `danger` when > 0 else `textMuted`, label "OUTSTANDING"), Cash·4wk (TouchableOpacity → `onPressCash`; `cash4wk === null ? '—' : formatMoneyShort(cash4wk)`, `success` when positive, label "CASH · 4WK"). Import `formatMoneyShort` from `@/utils/formatters`. `testID="summary-money"`.

- [ ] **Step 2: tsc gate** — clean.
- [ ] **Step 3: Commit** — `git commit -m "feat(summary): MoneyStrip widget"`

---

## Task 6: NeedsYou

**Files:**
- Create: `components/summary/NeedsYou.tsx`

**Contract (props):**
```typescript
import type { AttentionItem } from '@/utils/summaryRollup';
interface NeedsYouProps {
  items: AttentionItem[];
  onPressItem: (item: AttentionItem) => void;
}
```

- [ ] **Step 1: Build the component.** Returns `null` when `items.length === 0`. Otherwise a card with header: tinted icon square (danger soft) + lucide `Bell`, label `NEEDS YOU`, right meta `${items.length} item(s)` in `danger`. Each row (TouchableOpacity → `onPressItem(item)`): a severity dot (8px; `danger` for `'danger'`, `accent` for `'amber'`), the `item.label` (flex, weight 600), and `${item.actionLabel} →` in `accentLabel`. Hairline dividers. `testID="summary-needs-you"`.

- [ ] **Step 2: tsc gate** — clean.
- [ ] **Step 3: Commit** — `git commit -m "feat(summary): NeedsYou widget"`

---

## Task 7: ToolsSheet

**Files:**
- Create: `components/summary/ToolsSheet.tsx`

**Contract (props):**
```typescript
interface ToolsSheetProps {
  visible: boolean;
  onClose: () => void;
  onNavigate: (route: string) => void; // screen pushes the route, then closes
}
```

- [ ] **Step 1: Build the component.** A RN `Modal` (`animationType="slide"`, `transparent`, `onRequestClose={onClose}`). A dimmed backdrop (`TouchableOpacity` full-screen → `onClose`) and a bottom sheet (`surface`, top radius `xl`, safe-area bottom pad) containing a grab handle, a "Tools" title, and `NavRow`s (import `{ NavRow } from '@/components/NavRow'`, icons from lucide):
  - `Inbox` "Reports inbox" → `/report-inbox`
  - `FileDown` "Reports" "WIP · Profit · A/R aging" → `/reports`
  - `Wallet` "Cash flow" → `/cash-flow`
  - `UserPlus` "Pipeline" → `/leads`
  - `Gavel` "Buyout" → `/buyout`
  - `FileDown` "1099-NEC export" → `/tax-1099-export`
  Each row's `onPress` calls `onNavigate(route)`. `testID="summary-tools-sheet"`.

- [ ] **Step 2: tsc gate** — clean.
- [ ] **Step 3: Commit** — `git commit -m "feat(summary): ToolsSheet overflow menu"`

---

## Task 8: Rewrite the Summary screen

**Files:**
- Modify (rewrite): `app/(tabs)/summary/index.tsx`

- [ ] **Step 1: Rewrite the screen** to compose the widgets:
  - Hooks: `useCoreData()` (`projects`, `isLoading`), `useFinancialsData()` (`invoices`, `changeOrders`), `useFieldData()` (`punchItems`), `useAuth()` (`user`), `useRouter`, `useSafeAreaInsets`, `useTheme`, `useThemedStyles`.
  - `active = projects.filter(p => p.status !== 'closed' && p.status !== 'completed')`.
  - Memoize: `today = useMemo(() => computeTodayTasks(active), [active])`; `week = useMemo(() => computeWeekLoad(active), [active])`; `attention = useMemo(() => aggregateAttention(active, invoices, punchItems, changeOrders), [active, invoices, punchItems, changeOrders])`.
  - `budget` = sum of `effectiveEstimateTotal(p)` over `active` (import from `@/utils/estimateCommit`). `outstanding` = sum over invoices of unpaid `max(0, (totalDue ?? 0) - (amountPaid ?? 0))`. `cash4wk`: keep the existing `useEffect` that loads the forecast (`isSetupComplete` → `loadCashFlowData` → `generateForecast(...)`); derive `cash4wk = forecast ? (forecast[3]?.runningBalance ?? forecast[forecast.length-1]?.runningBalance ?? null) : null`.
  - `greetingName`: first token of `user?.name`, capitalized (`const greetingName = (user?.name ?? '').trim().split(/\s+/)[0] ?? '';` then capitalize first letter; if it looks like an email-prefix that's acceptable).
  - `jobCount` for Today = `new Set(today.map(t => t.projectId)).size`.
  - `tools-sheet` state: `const [toolsOpen, setToolsOpen] = useState(false)`.
  - Render order inside a `ScrollView` (warm gradient/`bg` background, `paddingTop: insets.top + 16`, bottom inset pad): `BriefingHero` → `TodayOnSite` → `WeekAheadStrip` → `MoneyStrip` → `NeedsYou` → `ToolsSheet` (modal).
  - Wiring: hero `onOpenTools={() => setToolsOpen(true)}`, `attentionCount={attention.length}`, `activeCount={active.length}`; Today `onPressTask={(id) => router.push({ pathname: '/project-detail', params: { id } } as any)}`; Money `onPressOutstanding={() => router.push('/reports' as any)}`, `onPressCash={() => router.push('/cash-flow' as any)}`; NeedsYou `onPressItem={(it) => router.push(it.params ? { pathname: it.route, params: it.params } as any : it.route as any)}`; ToolsSheet `onNavigate={(r) => { setToolsOpen(false); router.push(r as any); }}`.
  - **Keep** the `isLoading` skeleton (briefing-shaped: hero block + 4 widget skeletons) and the existing `projects.length === 0` `EmptyState` ("No projects yet" → `/(tabs)/(home)`).
  - **Remove** the old `NextStepHero`, portfolio stat row, A/R aging strip, `CashFlowGlance`, `CashFlowAlerts`, "Bank-ready reports" CTA, the inline Tools group, the per-project `SummaryCard` map, and the now-unused helpers/`StyleSheet` entries/imports (`computeStats`, `ProjectSummaryStats`, `SummaryCard`, `PortfolioStat`, `AgingBucket`, `Stat`, `computeARAgingReport`, etc.). Delete imports that are no longer referenced so tsc/lint stays clean.

- [ ] **Step 2: tsc gate** — `npx tsc --noEmit` clean.

- [ ] **Step 3: Grep assertions**

```bash
grep -n "computeTodayTasks\|computeWeekLoad\|aggregateAttention" "app/(tabs)/summary/index.tsx"   # wired
grep -c "SummaryCard\|NextStepHero\|CashFlowGlance\|toolsGroup\|agingStrip" "app/(tabs)/summary/index.tsx"  # expect 0
grep -rn "BriefingHero\|TodayOnSite\|WeekAheadStrip\|MoneyStrip\|NeedsYou\|ToolsSheet" "app/(tabs)/summary/index.tsx"  # all 6 composed
```

- [ ] **Step 4: Commit** — `git add "app/(tabs)/summary/index.tsx" && git commit -m "feat(summary): compose Morning Briefing dashboard; retire card-stack + inline tools"`

---

## Self-Review (run before final review)

1. **Spec coverage:** hero ✓ (T2), Today ✓ (T1+T3), This Week ✓ (T1+T4), Money ✓ (T5), Needs You ✓ (T1+T6), Tools overflow ✓ (T7), removals + preserved access ✓ (T8), edge cases (loading/empty/no-schedule/cash-not-setup) ✓ (T1 guards + T8 states).
2. **Placeholders:** none — util has full code; components have exact props/data/routes/tokens; routes are confirmed-existing only.
3. **Type consistency:** `TodayTask`/`WeekLoad`/`AttentionItem` defined in T1 and imported unchanged in T3/T4/T6; `cash4wk: number | null` consistent; route strings consistent across T7/T8.

## Whole-impl gates (after Task 8)
- `npx tsc --noEmit` clean repo-wide.
- `git diff --stat main..HEAD` shows only: `utils/summaryRollup.ts`, `components/summary/*.tsx` (6), `app/(tabs)/summary/index.tsx`, plus the spec/plan docs.
- Manual: loading / no-projects / populated; Today + This-Week vs a known schedule; `•••` opens sheet, every row routes; Money taps route; light + dark themes.
