// ============================================================================
// hooks/useSmartInbox.ts
//
// Smart Inbox — deterministic "needs attention" rules over the user's data.
// Produces a small, ranked list of items the PM should look at today. Every
// row points to a real EntityRef so tapping a row can navigate via
// useEntityNavigation().
//
// Rules (9 total). Only the 7 that can be sourced from ProjectContext are
// implemented — `permit_expiring` and any other rule that would need data not
// held in-context are stubbed so adding them later is a pure data lift.
//
//   overdue_invoice      Invoice with dueDate < today and status != paid
//   rfi_past_due         RFI with dateRequired < today and still open
//   weather_risk         Schedule weather alert (undismissed) in next 3 days
//   submittal_stale      Submittal in_review whose last reviewCycle.sentDate > 7d
//   co_awaiting_approval Change order in submitted/under_review for > 3d
//   punch_verify         PunchItem status === 'ready_for_review'
//   task_starting_today  ScheduleTask whose absolute start date is today and
//                        status === 'not_started'
//   coi_expiring         Subcontractor.coiExpiry within 30 days
//   permit_expiring      SKIPPED — permits live outside ProjectContext
//
// Scoring: each rule emits a severity 1..3 (3 = hottest). The list is sorted
// by severity desc, then by the source date asc (earlier = first). Tap-closed
// dismissals are persisted in AsyncStorage key `tertiary_inbox_dismissed` as
// a string[] of item IDs. A dismissed item re-appears if it re-qualifies under
// a different source date (e.g. a new invoice hitting overdue).
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useProjects } from '@/contexts/ProjectContext';
import type {
  EntityRef, Project, Invoice, RFI, Submittal, ChangeOrder, PunchItem,
  Subcontractor, ScheduleTask, WeatherAlert,
} from '@/types';

export type InboxCategory = 'money' | 'schedule' | 'safety' | 'other';

export type InboxRule =
  | 'overdue_invoice'
  | 'rfi_past_due'
  | 'weather_risk'
  | 'submittal_stale'
  | 'co_awaiting_approval'
  | 'punch_verify'
  | 'task_starting_today'
  | 'coi_expiring'
  | 'permit_expiring';

export interface InboxItem {
  /** Stable id used for dismissal tracking. `${rule}:${refKind}:${refId}` */
  id: string;
  rule: InboxRule;
  category: InboxCategory;
  severity: 1 | 2 | 3;
  title: string;
  subtitle?: string;
  projectId?: string;
  projectName?: string;
  sourceDate: string; // ISO string used for secondary sort
  ref: EntityRef;
}

export interface SmartInboxResult {
  items: InboxItem[];
  byCategory: Record<InboxCategory, InboxItem[]>;
  counts: Record<InboxCategory | 'all', number>;
  dismiss: (id: string) => void;
  dismissedIds: Set<string>;
  isReady: boolean;
}

const DISMISSED_STORAGE_KEY = 'tertiary_inbox_dismissed';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Module-level dismissed store so every call site (tab badge, inbox card,
// anywhere else) sees the same dismissal state without threading a Context.
// AsyncStorage is the source of truth on cold start; after that the in-memory
// set is authoritative and we fire subscribers on every change.
let dismissedStore: Set<string> = new Set();
let dismissedLoaded = false;
let dismissedLoadPromise: Promise<void> | null = null;
const dismissedSubscribers = new Set<(s: Set<string>) => void>();

function ensureDismissedLoaded(): Promise<void> {
  if (dismissedLoaded) return Promise.resolve();
  if (dismissedLoadPromise) return dismissedLoadPromise;
  dismissedLoadPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(DISMISSED_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          dismissedStore = new Set(parsed.filter((v): v is string => typeof v === 'string'));
        }
      }
    } catch (err) {
      console.log('[SmartInbox] failed to load dismissed ids', err);
    } finally {
      dismissedLoaded = true;
      notifyDismissedSubscribers();
    }
  })();
  return dismissedLoadPromise;
}

function notifyDismissedSubscribers() {
  const snapshot = new Set(dismissedStore);
  for (const sub of dismissedSubscribers) sub(snapshot);
}

function persistDismissed() {
  AsyncStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(Array.from(dismissedStore))).catch(err => {
    console.log('[SmartInbox] failed to persist dismissal', err);
  });
}

export function useSmartInbox(): SmartInboxResult {
  const store = useProjects();

  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set(dismissedStore));
  const [isReady, setIsReady] = useState(dismissedLoaded);

  useEffect(() => {
    const handler = (s: Set<string>) => setDismissedIds(s);
    dismissedSubscribers.add(handler);
    if (!dismissedLoaded) {
      void ensureDismissedLoaded().then(() => setIsReady(true));
    }
    return () => { dismissedSubscribers.delete(handler); };
  }, []);

  const dismiss = useCallback((id: string) => {
    if (dismissedStore.has(id)) return;
    dismissedStore = new Set(dismissedStore);
    dismissedStore.add(id);
    persistDismissed();
    notifyDismissedSubscribers();
  }, []);

  const allItems = useMemo<InboxItem[]>(() => {
    const out: InboxItem[] = [];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const nowMs = now.getTime();

    const projectNameById = new Map<string, string>();
    for (const p of store.projects) projectNameById.set(p.id, p.name);

    for (const inv of store.invoices as Invoice[]) {
      if (inv.status === 'paid' || inv.status === 'draft') continue;
      const due = parseISODate(inv.dueDate);
      if (due === null) continue;
      if (due < today) {
        const daysLate = Math.floor((today - due) / MS_PER_DAY);
        const outstanding = Math.max(0, (inv.totalDue ?? 0) - (inv.amountPaid ?? 0));
        out.push({
          id: `overdue_invoice:invoice:${inv.id}`,
          rule: 'overdue_invoice',
          category: 'money',
          severity: daysLate >= 14 ? 3 : daysLate >= 7 ? 2 : 1,
          title: `Invoice #${inv.number} · ${daysLate}d late`,
          subtitle: `${formatMoneyShort(outstanding)} outstanding${projectNameById.get(inv.projectId) ? ` · ${projectNameById.get(inv.projectId)}` : ''}`,
          projectId: inv.projectId,
          projectName: projectNameById.get(inv.projectId),
          sourceDate: inv.dueDate,
          ref: { kind: 'invoice', id: inv.id, projectId: inv.projectId },
        });
      }
    }

    for (const rfi of store.rfis as RFI[]) {
      if (rfi.status !== 'open') continue;
      const req = parseISODate(rfi.dateRequired);
      if (req === null || req >= today) continue;
      const daysLate = Math.floor((today - req) / MS_PER_DAY);
      out.push({
        id: `rfi_past_due:rfi:${rfi.id}`,
        rule: 'rfi_past_due',
        category: 'schedule',
        severity: daysLate >= 7 ? 3 : daysLate >= 3 ? 2 : 1,
        title: `RFI #${rfi.number} past due · ${daysLate}d`,
        subtitle: `${rfi.subject}${projectNameById.get(rfi.projectId) ? ` · ${projectNameById.get(rfi.projectId)}` : ''}`,
        projectId: rfi.projectId,
        projectName: projectNameById.get(rfi.projectId),
        sourceDate: rfi.dateRequired,
        ref: { kind: 'rfi', id: rfi.id, projectId: rfi.projectId },
      });
    }

    for (const subm of store.submittals as Submittal[]) {
      if (subm.currentStatus !== 'in_review' && subm.currentStatus !== 'pending') continue;
      const cycles = subm.reviewCycles ?? [];
      const last = cycles.length > 0 ? cycles[cycles.length - 1] : null;
      const baseDate = last?.sentDate ?? subm.submittedDate;
      const sent = parseISODate(baseDate);
      if (sent === null) continue;
      const daysStale = Math.floor((today - sent) / MS_PER_DAY);
      if (daysStale < 7) continue;
      out.push({
        id: `submittal_stale:submittal:${subm.id}`,
        rule: 'submittal_stale',
        category: 'schedule',
        severity: daysStale >= 21 ? 3 : daysStale >= 14 ? 2 : 1,
        title: `Submittal #${subm.number} stale · ${daysStale}d`,
        subtitle: `${subm.title}${projectNameById.get(subm.projectId) ? ` · ${projectNameById.get(subm.projectId)}` : ''}`,
        projectId: subm.projectId,
        projectName: projectNameById.get(subm.projectId),
        sourceDate: baseDate,
        ref: { kind: 'submittal', id: subm.id, projectId: subm.projectId },
      });
    }

    for (const co of store.changeOrders as ChangeOrder[]) {
      if (co.status !== 'submitted' && co.status !== 'under_review') continue;
      const created = new Date(co.createdAt).getTime();
      if (Number.isNaN(created)) continue;
      const daysWaiting = Math.floor((nowMs - created) / MS_PER_DAY);
      if (daysWaiting < 3) continue;
      out.push({
        id: `co_awaiting_approval:changeOrder:${co.id}`,
        rule: 'co_awaiting_approval',
        category: 'money',
        severity: daysWaiting >= 10 ? 3 : daysWaiting >= 5 ? 2 : 1,
        title: `CO #${co.number} waiting · ${daysWaiting}d`,
        subtitle: `${formatMoneyShort(co.changeAmount)}${projectNameById.get(co.projectId) ? ` · ${projectNameById.get(co.projectId)}` : ''}`,
        projectId: co.projectId,
        projectName: projectNameById.get(co.projectId),
        sourceDate: co.createdAt,
        ref: { kind: 'changeOrder', id: co.id, projectId: co.projectId },
      });
    }

    for (const pi of store.punchItems as PunchItem[]) {
      if (pi.status !== 'ready_for_review') continue;
      out.push({
        id: `punch_verify:punchItem:${pi.id}`,
        rule: 'punch_verify',
        category: 'safety',
        severity: pi.priority === 'high' ? 3 : pi.priority === 'medium' ? 2 : 1,
        title: `Punch item ready to verify`,
        subtitle: `${pi.description}${projectNameById.get(pi.projectId) ? ` · ${projectNameById.get(pi.projectId)}` : ''}`,
        projectId: pi.projectId,
        projectName: projectNameById.get(pi.projectId),
        sourceDate: pi.updatedAt,
        ref: { kind: 'punchItem', id: pi.id, projectId: pi.projectId },
      });
    }

    for (const project of store.projects as Project[]) {
      const schedule = project.schedule;
      if (!schedule) continue;
      const startIso = schedule.startDate;
      if (!startIso) continue;
      const scheduleStart = parseISODate(startIso);
      if (scheduleStart === null) continue;

      for (const task of (schedule.tasks as ScheduleTask[]) ?? []) {
        if (task.status !== 'not_started') continue;
        const taskStart = scheduleStart + (task.startDay - 1) * MS_PER_DAY;
        if (taskStart !== today) continue;
        out.push({
          id: `task_starting_today:task:${task.id}`,
          rule: 'task_starting_today',
          category: 'schedule',
          severity: task.isCriticalPath ? 3 : 2,
          title: `Starts today: ${task.title}`,
          subtitle: `${project.name}${task.crew ? ` · ${task.crew}` : ''}`,
          projectId: project.id,
          projectName: project.name,
          sourceDate: new Date(taskStart).toISOString(),
          ref: { kind: 'task', id: task.id, projectId: project.id },
        });
      }

      const alerts = (schedule.weatherAlerts as WeatherAlert[]) ?? [];
      for (const alert of alerts) {
        if (alert.dismissed) continue;
        const alertDate = parseISODate(alert.date);
        if (alertDate === null) continue;
        const daysUntil = Math.floor((alertDate - today) / MS_PER_DAY);
        if (daysUntil < 0 || daysUntil > 3) continue;
        out.push({
          id: `weather_risk:task:${alert.taskId}:${alert.id}`,
          rule: 'weather_risk',
          category: 'schedule',
          severity: daysUntil <= 1 ? 3 : 2,
          title: `Weather risk: ${alert.condition}`,
          subtitle: `${alert.taskName} in ${daysUntil === 0 ? 'today' : `${daysUntil}d`} · ${project.name}`,
          projectId: project.id,
          projectName: project.name,
          sourceDate: alert.date,
          ref: { kind: 'task', id: alert.taskId, projectId: project.id },
        });
      }
    }

    for (const sub of store.subcontractors as Subcontractor[]) {
      const exp = parseISODate(sub.coiExpiry);
      if (exp === null) continue;
      const daysUntil = Math.floor((exp - today) / MS_PER_DAY);
      if (daysUntil > 30) continue;
      const severity: 1 | 2 | 3 = daysUntil < 0 ? 3 : daysUntil <= 7 ? 3 : daysUntil <= 14 ? 2 : 1;
      out.push({
        id: `coi_expiring:contact:${sub.id}`,
        rule: 'coi_expiring',
        category: 'safety',
        severity,
        title: daysUntil < 0
          ? `COI expired · ${sub.companyName}`
          : `COI expires in ${daysUntil}d · ${sub.companyName}`,
        subtitle: `${sub.trade}${sub.contactName ? ` · ${sub.contactName}` : ''}`,
        sourceDate: sub.coiExpiry,
        ref: { kind: 'contact', id: sub.id },
      });
    }

    out.sort((a, b) => {
      if (a.severity !== b.severity) return b.severity - a.severity;
      return a.sourceDate.localeCompare(b.sourceDate);
    });

    return out;
  }, [store]);

  const items = useMemo(() => allItems.filter(i => !dismissedIds.has(i.id)), [allItems, dismissedIds]);

  const byCategory = useMemo<Record<InboxCategory, InboxItem[]>>(() => {
    const buckets: Record<InboxCategory, InboxItem[]> = { money: [], schedule: [], safety: [], other: [] };
    for (const item of items) buckets[item.category].push(item);
    return buckets;
  }, [items]);

  const counts = useMemo<Record<InboxCategory | 'all', number>>(() => ({
    all: items.length,
    money: byCategory.money.length,
    schedule: byCategory.schedule.length,
    safety: byCategory.safety.length,
    other: byCategory.other.length,
  }), [items, byCategory]);

  return { items, byCategory, counts, dismiss, dismissedIds, isReady };
}

function parseISODate(iso: string | undefined | null): number | null {
  if (!iso) return null;
  // Accept both YYYY-MM-DD and full ISO. Build a local-midnight Date so
  // rule comparisons are all in the same (local) basis.
  const dateOnly = iso.length >= 10 ? iso.slice(0, 10) : iso;
  const parts = dateOnly.split('-');
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return new Date(y, m - 1, d).getTime();
}

function formatMoneyShort(n: number | undefined | null): string {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}
