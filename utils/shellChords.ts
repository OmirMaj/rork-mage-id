// utils/shellChords.ts — the 'g' chords of the desktop keyboard shell.
//
// WHY (wave 6d restore, d6r lane K1). A PM who lives in the web app expects
// to jump between tools without the mouse: 'g' then 'r' for RFIs, 'g' then 's'
// for the schedule (Linear / GitHub / Gmail teach the pattern). These are the
// 13 chords components/desktop/ShellHotkeys registers at GLOBAL scope through
// the one shortcut registry (hooks/useHotkeys sequences, 1,000 ms apart), and
// the '?' sheet lists under 'Go to'.
//
// Rules the chords keep (scripts/validate-shell-6c.ts "d6r K1" runs them):
//   • 'g j' and 'g k' are deliberately unbound — j / k move the row in every
//     DataTable log, and a pending 'g' that meets no chord falls through to
//     the page's own single key;
//   • a job tool goes where the sidebar row goes: jobScopedTarget over
//     featureFor(f).projectScoped — exactly DesktopSidebar's hrefFor rule —
//     so with an active job 'g r' opens /rfi?projectId=<job>, and with none
//     the bare route (the screen's own picker asks, as the sidebar does);
//   • the schedule goes through scheduleDestination (C6: the ONE way to build
//     a schedule link) — Schedule Pro when his seat opens it and it fits the
//     window, else the classic tab; with no job, the schedule on-ramp.
//
// Pure: expo-router is a TYPE-only import, so bun can load this file.

import type { Route } from 'expo-router';
import { jobScopedTarget } from '@/utils/activeProject';
import { featureFor, type FeatureId } from '@/utils/featureRegistry';
import { scheduleDestination } from '@/utils/scheduleRoute';

export type ShellChordTarget =
  | { kind: 'route'; route: Route }
  | { kind: 'job-tool'; feature: FeatureId; route: Route }
  | { kind: 'overview' }
  | { kind: 'schedule' };

export interface ShellChord {
  combo: string;
  label: string;
  target: ShellChordTarget;
  /** Hidden for a client or a property manager (a GC's own tools). */
  contractorOnly: boolean;
}

export const G_CHORDS: readonly ShellChord[] = [
  { combo: 'g h', label: 'Projects', target: { kind: 'route', route: '/(tabs)/(home)' }, contractorOnly: false },
  { combo: 'g b', label: 'Summary', target: { kind: 'route', route: '/(tabs)/summary' }, contractorOnly: true },
  { combo: 'g o', label: 'Job Overview', target: { kind: 'overview' }, contractorOnly: true },
  { combo: 'g s', label: 'Schedule', target: { kind: 'schedule' }, contractorOnly: true },
  { combo: 'g d', label: 'Daily Reports', target: { kind: 'job-tool', feature: 'daily-report', route: '/daily-report' }, contractorOnly: true },
  { combo: 'g r', label: 'RFIs', target: { kind: 'job-tool', feature: 'rfi', route: '/rfi' }, contractorOnly: true },
  { combo: 'g u', label: 'Submittals', target: { kind: 'job-tool', feature: 'submittal', route: '/submittal' }, contractorOnly: true },
  { combo: 'g c', label: 'Change Orders', target: { kind: 'job-tool', feature: 'change-order', route: '/change-order' }, contractorOnly: true },
  { combo: 'g i', label: 'Invoices', target: { kind: 'job-tool', feature: 'invoice', route: '/invoice' }, contractorOnly: true },
  { combo: 'g p', label: 'Punch List', target: { kind: 'job-tool', feature: 'punch-list', route: '/punch-list' }, contractorOnly: true },
  { combo: 'g w', label: 'Waiting on Others', target: { kind: 'route', route: '/waiting-on' }, contractorOnly: true },
  { combo: 'g n', label: 'Inbox', target: { kind: 'route', route: '/notifications-inbox' }, contractorOnly: false },
  { combo: 'g a', label: 'Action Required', target: { kind: 'route', route: '/attention' }, contractorOnly: true },
];

/** Single keys DataTable owns on every log page — no chord may start with or
 *  be one of them. */
export const RESERVED_SINGLE_KEYS: readonly string[] = ['j', 'k', 'x', '/'];

export interface ChordContext {
  activeProjectId: string | null;
  schedule: {
    /** Pro's own gate for the active job (useProjectAccess(id).canAccess). */
    canPro: boolean;
    /** Pro's grid fits this window (proFitsWindow). */
    proFits: boolean;
  };
}

export interface ChordHref {
  pathname: Route;
  params?: Record<string, string>;
}

/** Where a chord goes, given the active job. Pure (bun-validated). */
export function chordTarget(chord: ShellChord, ctx: ChordContext, now: number = Date.now()): ChordHref {
  const t = chord.target;
  const id = ctx.activeProjectId;
  switch (t.kind) {
    case 'route':
      return { pathname: t.route };
    case 'job-tool': {
      const r = jobScopedTarget(t.route, {
        projectScoped: featureFor(t.feature).projectScoped === true,
        activeProjectId: id,
      });
      return r.params ? { pathname: r.pathname, params: r.params } : { pathname: r.pathname };
    }
    case 'overview':
      return id ? { pathname: '/project-detail', params: { id } } : { pathname: '/(tabs)/(home)' };
    case 'schedule': {
      if (!id) return { pathname: '/(tabs)/discover/schedule' };
      const d = scheduleDestination(
        { projectId: id, webDesktop: true, canPro: ctx.schedule.canPro, proFits: ctx.schedule.proFits },
        now,
      );
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(d.params)) if (typeof v === 'string') params[k] = v;
      return { pathname: d.pathname, params };
    }
  }
}

/** The chords a persona gets: a client or property manager keeps only the
 *  all-persona ones (Projects, Inbox). */
export function chordsFor(userRole: string | null | undefined): ShellChord[] {
  const limited = userRole === 'client' || userRole === 'property_manager';
  return G_CHORDS.filter((c) => !limited || !c.contractorOnly);
}
