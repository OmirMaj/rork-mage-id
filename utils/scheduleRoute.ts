// utils/scheduleRoute.ts — where a "open this job's schedule" link lands
// (wave 6c, lane DC).
//
// WHY. The founder, on a 1512 × 945 MacBook: "the scheduler does not work
// well". On desktop web a Pro-tier GC has Schedule Pro — the grid, the Gantt,
// CPM — but every link into a job's schedule (Discover › Schedule, the AI
// review's "Use this schedule", the Copilot hub, Summary's task rows) opened
// the classic phone-shaped tab, and Pro was three clicks further on. This
// module is the ONE answer to "which schedule screen": Pro for a Pro tier on
// desktop web, the classic tab everywhere else (the phone, a tablet, a free
// tier). The classic tab stays reachable on desktop through Pro's "Today &
// lookahead (classic)" link, which carries `classic=<the focus nonce>`.
//
// PURE: no React, no react-native, no expo-router import — bun runs it in
// scripts/validate-schedule-classic.ts. The objects it returns are plain
// { pathname, params } hrefs; the callers push or <Redirect> them.
//
// PRO ONLY WHERE PRO WILL OPEN (fix round 1). A link goes to Pro only when
// Pro itself would render for this viewer on this job in this window:
//  - `proFits` — the window minus the sidebar Pro will have is at least
//    GRID_BREAKPOINT (proFitsWindow below). Below it Pro shows its narrow
//    gate, whose "Open classic schedule" button lands back on the classic
//    tab; if that tab then bounced the arrival to Pro again the GC looped and
//    never reached the job (a half-width 960 px window with the 64 px rail).
//  - `canPro` — Pro's OWN gate: useProjectAccess(projectId), own tier OR the
//    collaborator grant on that job (#91). canOpenSchedulePro evaluates it
//    without a hook, from the seat ProjectContext stamped on the job, for the
//    screens that link to many jobs (Summary, Discover).

import { scheduleProFits } from './scheduleProLayout';
import { sidebarWidthForRoute, type RailPref } from './sidebarRail';
import { resolveProjectAccess } from './collaboratorAccess';
import type { ProjectRole } from './projectRole';

/** The classic tab's route (a hidden tab: `href: null`). */
export const CLASSIC_SCHEDULE_PATH = '/(tabs)/schedule' as const;
/** Schedule Pro (desktop: grid + Gantt + CPM). */
export const PRO_SCHEDULE_PATH = '/schedule-pro' as const;

/** The feature Schedule Pro gates on (app/schedule-pro.tsx). */
export const SCHEDULE_PRO_FEATURE = 'schedule_gantt_pdf' as const;

/**
 * Would Pro's own gate open this job for this viewer? Pro reads
 * useProjectAccess(projectId).canAccess('schedule_gantt_pdf'): the viewer's
 * own tier OR the collaborator grant for his seat on the job. A link that
 * cannot call that hook per job passes the seat ProjectContext stamped on the
 * project (Project.myRole; undefined on his own job, which is then his tier
 * alone). An invited foreman on a free account therefore lands in the GC's
 * Pro plan, exactly as Pro would admit him, instead of the classic tab.
 */
export function canOpenSchedulePro(ownTierAllows: boolean, stampedRole: ProjectRole | undefined): boolean {
  return resolveProjectAccess(ownTierAllows, stampedRole ?? null, SCHEDULE_PRO_FEATURE);
}

/**
 * Does Pro's grid fit this window? The same sum Pro runs before its narrow
 * gate: the window minus the sidebar it will sit beside. On desktop web that
 * is the sidebar Pro gets (a canvas route: the 64 px rail unless the GC
 * pinned it open); anywhere else nothing (a phone at 390 never fits).
 */
export function proFitsWindow(windowWidth: number, webDesktop: boolean, railPref: RailPref): boolean {
  return scheduleProFits(windowWidth, webDesktop ? sidebarWidthForRoute('schedule-pro', railPref) : 0);
}

export interface ScheduleDestinationInput {
  projectId: string;
  /** useIsDesktopWeb(): desktop layout AND a browser. False on every phone. */
  webDesktop: boolean;
  /** Pro's own gate for this job (canOpenSchedulePro). */
  canPro: boolean;
  /** Pro's grid fits this window (proFitsWindow). Without it Pro shows its
   *  narrow gate, so the link goes to the classic tab. */
  proFits: boolean;
  /** Open this task once the schedule is up (Summary's task rows). */
  taskId?: string;
  /** Words the Copilot routed here, pre-filled into the schedule editor. */
  editSeed?: string;
  /** The arrival nonce. The classic tab only re-applies a routed projectId
   *  when the nonce is new (tab params are sticky), so it always has one. */
  focus?: string;
}

export type ProScheduleHref = {
  pathname: typeof PRO_SCHEDULE_PATH;
  params: { projectId: string; taskId?: string; editSeed?: string; focus?: string };
};
export type ClassicScheduleHref = {
  pathname: typeof CLASSIC_SCHEDULE_PATH;
  params: { projectId: string; focus: string; editSeed?: string; taskId?: string };
};
export type ScheduleHref = ProScheduleHref | ClassicScheduleHref;

/** Only the keys that carry a value: expo-router would otherwise write
 *  `?taskId=undefined` into the URL. */
function defined<T extends Record<string, string | undefined>>(o: T): { [K in keyof T]?: string } {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) if (typeof v === 'string' && v.length > 0) out[k] = v;
  return out as { [K in keyof T]?: string };
}

/**
 * The schedule screen a link should open.
 *  - Desktop web AND Pro's gate opens AND Pro fits the window → /schedule-pro
 *    with {projectId, taskId?, editSeed?, focus?} (lane DB reads all four).
 *  - Anything else → the classic tab with {projectId, focus, editSeed?,
 *    taskId?}; `focus` is minted from `now` when the caller has none, so a
 *    second visit to the same job still re-selects it.
 * The phone always gets the classic tab with exactly the params it got before.
 */
export function scheduleDestination(input: ScheduleDestinationInput, now: number = Date.now()): ScheduleHref {
  const { projectId, webDesktop, canPro, proFits, taskId, editSeed, focus } = input;
  if (webDesktop && canPro && proFits) {
    return { pathname: PRO_SCHEDULE_PATH, params: { projectId, ...defined({ taskId, editSeed, focus }) } };
  }
  return {
    pathname: CLASSIC_SCHEDULE_PATH,
    params: { projectId, focus: focus && focus.length > 0 ? focus : String(now), ...defined({ editSeed, taskId }) },
  };
}

export interface ClassicRedirectInput {
  /** The classic tab's own route params. */
  routeProjectId?: string;
  routeFocus?: string;
  /** `classic=<nonce>`: Pro's "Today & lookahead (classic)" link. */
  classic?: string;
  webDesktop: boolean;
  canPro: boolean;
  /** Pro's grid fits this window (proFitsWindow). */
  proFits: boolean;
  taskId?: string;
  editSeed?: string;
}

/**
 * Should the classic tab hand this arrival to Schedule Pro? Returns the Pro
 * href, or null to stay. It stays (null) when:
 *  - not desktop web (every phone, every tablet, native at any width);
 *  - Pro's gate would not open (a free GC keeps the classic tab and its Pro
 *    teaser);
 *  - Pro does not fit the window: Pro would show its narrow gate, whose
 *    "Open classic schedule" button comes straight back here — bouncing that
 *    arrival to Pro again was a loop the GC could never leave;
 *  - there is no routed job (the bare tab — nothing to open in Pro);
 *  - `classic` equals the arrival's focus nonce: the GC asked for the classic
 *    view from inside Pro. Tied to the nonce so the sticky tab param from that
 *    visit cannot pin a LATER arrival (a fresh focus) to the classic tab.
 * taskId, editSeed and focus pass through to Pro.
 */
export function classicRedirect(input: ClassicRedirectInput): ProScheduleHref | null {
  const { routeProjectId, routeFocus, classic, webDesktop, canPro, proFits, taskId, editSeed } = input;
  if (!webDesktop || !canPro || !proFits || !routeProjectId) return null;
  if (classic === routeFocus) return null;
  return {
    pathname: PRO_SCHEDULE_PATH,
    params: { projectId: routeProjectId, ...defined({ taskId, editSeed, focus: routeFocus }) },
  };
}

/** The once-per-arrival key the classic tab opens a routed task under. */
export function routedTaskKey(projectId: string, focus: string | undefined, taskId: string): string {
  return `${projectId}:${focus ?? ''}:${taskId}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The classic tab's desktop maths. Here (not in the screen) so bun can run it:
// the screen imports react-native. Both are desktop-only; the phone and the
// tablet branch never call them.
// ─────────────────────────────────────────────────────────────────────────────

/** A run of consecutive task rows drawn as ONE row of `cols` cards. */
export interface BoardChunk<R> {
  kind: 'tasks';
  key: string;
  rows: R[];
}

/**
 * The Board's desktop rows: every run of consecutive `task` rows (one phase's
 * cards — a phase row always separates two phases) cut into rows of `cols`
 * cards, so a 1,232 px column shows three ~400 px cards across instead of one
 * 1,300 px strip each. Phase rows pass through untouched and in place; no
 * chunk ever spans two phases. `cols` below 1 is treated as 1.
 */
export function chunkBoardRows<R extends { kind: string; key: string }>(
  rows: readonly R[],
  cols: number,
): (R | BoardChunk<R>)[] {
  const n = Math.max(1, Math.floor(Number.isFinite(cols) ? cols : 1));
  const out: (R | BoardChunk<R>)[] = [];
  let run: R[] = [];
  const flush = () => {
    for (let i = 0; i < run.length; i += n) {
      const rowsOf = run.slice(i, i + n);
      out.push({ kind: 'tasks', key: `tasks:${rowsOf[0].key}`, rows: rowsOf });
    }
    run = [];
  };
  for (const row of rows) {
    if (row.kind === 'task') { run.push(row); continue; }
    flush();
    out.push(row);
  }
  flush();
  return out;
}

/** The classic GanttChart's label gutter + margins: the 200 in its default
 *  width formula (`totalDays * 14 + 200`). */
export const GANTT_CHROME = 200;
export const GANTT_MIN_PX_PER_DAY = 8;
export const GANTT_MAX_PX_PER_DAY = 24;

/**
 * Pixels per day for the classic Gantt given the width it actually has:
 * clamp((viewport − 200) / totalDays, 8, 24). A short job fills the panel (up
 * to 24 px a day); a long one scrolls at no less than 8 px a day. null when
 * there is nothing to fit (no viewport measured yet, or no days) — the chart
 * then keeps its default width formula.
 */
export function ganttPxPerDay(viewportWidth: number | undefined, totalDays: number): number | null {
  if (!(typeof viewportWidth === 'number' && viewportWidth > 0) || !(totalDays > 0)) return null;
  const raw = (viewportWidth - GANTT_CHROME) / totalDays;
  return Math.min(GANTT_MAX_PX_PER_DAY, Math.max(GANTT_MIN_PX_PER_DAY, raw));
}
