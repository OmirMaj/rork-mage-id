/**
 * Smoke: the iPhone's "Tell me what to change" commits what the preview showed
 * (audit wave 6, lane A2, E6 — review round 1).
 *
 * Before this lane a phone had no AI way to add to a running schedule: the
 * editor lived only on the tablet screen and Schedule Pro. The phone's commit
 * (MobileScheduleScreen.commitAiEdit) was guarded only by source-text checks,
 * so a refactor that kept the strings but broke the write would still pass.
 * This mounts the REAL /schedule route on the phone layout, arriving the way
 * the Copilot hub sends him (projectId + focus nonce + editSeed), and drives
 * the commit with the producer ScheduleEditPanel hands it for "add three
 * tasks after rough-in":
 *   1. the editor opens once, on the routed job, pre-filled with his words;
 *   2. the commit lands all three new rows on the project, chained after
 *      rough-in, with the derived finish recomputed;
 *   3. one History row is written for the AI change;
 *   4. the same sticky arrival does not re-open it on a later visit.
 * (The field / view-only refusal is pinned in validate-w6a-entry-points: a
 * seat's role comes from the server's collaborator read, which this harness
 * does not fake.)
 * ScheduleEditPanel itself is stubbed (its internals are lane A's, covered by
 * schedule-edit-acknowledgement.test.tsx); only its props are captured.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, screen, waitFor } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { world } from '@/__tests__/fixtures/world';
import type { Project, ScheduleTask } from '@/types';
import { interpretScheduleOps } from '@/utils/copilot/scheduleEdit/interpretOps';
import type { EditOp } from '@/utils/copilot/scheduleEdit/editOps';

type PanelProps = {
  visible: boolean;
  projectId: string;
  tasks: ScheduleTask[];
  seed?: string;
  commit: (producer: (prev: ScheduleTask[]) => ScheduleTask[]) => void;
};
const mockPanel: { last: PanelProps | null } = { last: null };
jest.mock('@/components/copilot/ScheduleEditPanel', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (p: PanelProps) => {
      mockPanel.last = p;
      return p.visible ? <View testID="stub-schedule-edit-panel" /> : null;
    },
  };
});

const SEED = 'Add three tasks after rough-in: drywall hang 4 days, drywall tape 3 days, prime and paint 5 days';

function mondayISO(): string {
  const d = new Date();
  const ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = new Date(ms).getUTCDay();
  return new Date(ms + (dow === 0 ? -6 : 1 - dow) * 86400000).toISOString().slice(0, 10);
}
const task = (o: Partial<ScheduleTask> & { id: string; title: string; startDay: number; durationDays: number }): ScheduleTask => ({
  phase: 'Interior', progress: 0, crew: '', dependencies: [], notes: '', status: 'not_started', ...o,
} as ScheduleTask);
const TASKS: ScheduleTask[] = [
  task({ id: 't1', title: 'Framing', startDay: 1, durationDays: 5 }),
  task({ id: 't2', title: 'Rough-in electrical', startDay: 6, durationDays: 3, dependencies: ['t1'] }),
  task({ id: 't3', title: 'Cabinets', startDay: 9, durationDays: 4, dependencies: ['t2'] }),
];
const PID = 'p-henderson';
const henderson: Project = {
  ...(world.project as Project),
  id: PID,
  name: 'Henderson',
  schedule: {
    id: `${PID}-s`, name: 'Henderson schedule', projectId: PID,
    startDate: mondayISO(), workingDaysPerWeek: 5, bufferDays: 0,
    tasks: TASKS, totalDurationDays: 12, criticalPathDays: 12, laborAlignmentScore: 0, riskItems: [],
  },
} as unknown as Project;

const THREE: EditOp[] = [
  { op: 'addTask', title: 'Drywall hang', durationDays: 4, after: 'Rough-in electrical' },
  { op: 'addTask', title: 'Drywall tape', durationDays: 3, after: 'Drywall hang' },
  { op: 'addTask', title: 'Prime and paint', durationDays: 5, after: 'Drywall tape' },
];

async function storedSchedule(): Promise<{ tasks: ScheduleTask[]; criticalPathDays?: number } | null> {
  const raw = await AsyncStorage.getItem('mageid_projects');
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  const list: Project[] = Array.isArray(parsed) ? parsed : parsed?.data ?? [];
  return (list.find((p) => p.id === PID)?.schedule as never) ?? null;
}

describe('iPhone schedule: AI editor commit', () => {
  jest.setTimeout(40000);
  beforeEach(async () => {
    mockPanel.last = null;
    await primeWorld('empty');
    await AsyncStorage.setItem('mageid_projects', JSON.stringify([henderson]));
  });

  it('opens seeded from the hub, commits three chained rows and writes one History row', async () => {
    await mountRouteChecked(`/schedule?projectId=${PID}&focus=n1&editSeed=${encodeURIComponent(SEED)}`);

    // The phone surface, with its front door.
    await waitFor(() => expect(screen.getByTestId('mobile-schedule-copilot-bar')).toBeTruthy());
    // 1. Opened once, on the routed job, with his words.
    await waitFor(() => expect(mockPanel.last?.visible).toBe(true));
    expect(mockPanel.last!.projectId).toBe(PID);
    expect(mockPanel.last!.seed).toBe(SEED);
    expect(mockPanel.last!.tasks.map((t) => t.id)).toEqual(['t1', 't2', 't3']);

    // 2. Commit exactly what ScheduleEditPanel hands over on Apply.
    let results: { ok: boolean }[] = [];
    await act(async () => {
      mockPanel.last!.commit((prev) => {
        const r = interpretScheduleOps(THREE, prev);
        results = r.results;
        return r.nextTasks;
      });
    });
    expect(results.every((r) => r.ok)).toBe(true);

    // The screen now feeds the panel the saved plan: three more rows.
    await waitFor(() => expect(mockPanel.last!.tasks).toHaveLength(6));
    const byTitle = new Map(mockPanel.last!.tasks.map((t) => [t.title, t]));
    const hang = byTitle.get('Drywall hang')!;
    const tape = byTitle.get('Drywall tape')!;
    const paint = byTitle.get('Prime and paint')!;
    expect(hang && tape && paint).toBeTruthy();
    // Chained in the order spoken, after rough-in — not reversed, not parallel.
    expect(hang.dependencies).toContain('t2');
    expect(tape.dependencies).toContain(hang.id);
    expect(paint.dependencies).toContain(tape.id);
    expect(tape.startDay).toBeGreaterThan(hang.startDay);
    expect(paint.startDay).toBeGreaterThan(tape.startDay);
    // Three distinct, fresh ids.
    expect(new Set([hang.id, tape.id, paint.id, 't1', 't2', 't3']).size).toBe(6);

    // Persisted to the project, with the derived finish recomputed (the
    // ripple the preview showed, not the stored 12).
    await waitFor(async () => {
      const s = await storedSchedule();
      expect(s?.tasks).toHaveLength(6);
      expect((s?.criticalPathDays ?? 0)).toBeGreaterThan(12);
    });

    // 3. One History row for the one AI decision.
    await waitFor(async () => {
      const raw = await AsyncStorage.getItem(`mageid_schedule_audit::${PID}`);
      const entries = raw ? JSON.parse(raw) : [];
      expect(entries).toHaveLength(1);
      expect(JSON.stringify(entries[0])).toMatch(/AI schedule change/);
    });
  });

  it('a later visit carrying the same (sticky) arrival does not re-open the editor', async () => {
    // Tab params are sticky: the hub's projectId + focus + editSeed stay on the
    // route after he closes the editor. The arrival above (focus n1) was
    // claimed, so the same params mount the screen — with its front door —
    // but the editor stays shut and nothing is written.
    await mountRouteChecked(`/schedule?projectId=${PID}&focus=n1&editSeed=${encodeURIComponent(SEED)}`);
    await waitFor(() => expect(screen.getByTestId('mobile-schedule-copilot-bar')).toBeTruthy());
    expect(mockPanel.last).not.toBeNull();
    expect(mockPanel.last!.visible).toBe(false);
    expect(mockPanel.last!.tasks).toHaveLength(3);
    const s = await storedSchedule();
    expect(s?.tasks).toHaveLength(3);
  });
});
