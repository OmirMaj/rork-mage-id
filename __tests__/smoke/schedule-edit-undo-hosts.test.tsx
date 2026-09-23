/**
 * Render coverage — the schedule editor's "what landed" card on every host.
 *
 * Mounts the REAL ScheduleEditPanel → CopilotShell → useCopilotConversation →
 * scheduleEditCapability → ScheduleDiffView (only mageAI and native modals
 * mocked) inside three host harnesses and runs the founder's sentence:
 *   - Schedule Pro: producer run on the live array, written verbatim → Undo works.
 *   - classic Schedule tab (tablet / web desktop via the hub): producer(sorted)
 *     → reflow → rows re-sorted by start day. Undo used to be REFUSED here
 *     (row-order fingerprint) with a pointer to a toolbar Undo that screen
 *     does not have.
 *   - a host that refuses the write (field / view-only seat): the card must
 *     say "Nothing was saved", never tick "Added …".
 * Plus the width cap: on a wide web window the sheet was the full viewport.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/contexts/ThemeContext';
import ScheduleEditPanel from '@/components/copilot/ScheduleEditPanel';
import { applyToProjectSchedule } from '@/utils/copilot/scheduleEdit/applyToProjectSchedule';
import { runCpm, stampCriticalPath } from '@/utils/cpm';
import type { ScheduleTask } from '@/types';

const mockProjectsCtx = { getProject: () => ({ id: 'p1', name: 'Henderson' }), projects: [] };
jest.mock('@/contexts/SubscriptionContext', () => ({ useSubscription: () => ({ tier: 'pro' }) }));
jest.mock('@/contexts/ProjectContext', () => ({ useProjects: () => mockProjectsCtx }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  usePathname: () => '/schedule-pro',
}));
jest.mock('@/utils/aiRateLimiter', () => ({
  checkAILimit: jest.fn(async () => ({ allowed: true })),
  recordAIUsage: jest.fn(async () => undefined),
}));
const mockMageAI = jest.fn();
jest.mock('@/utils/mageAI', () => ({ mageAI: (...a: unknown[]) => mockMageAI(...a) }));
jest.mock('@/components/VoiceCaptureModal', () => () => null);
jest.mock('@/components/DatePickerModal', () => () => null);

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <SafeAreaProvider initialMetrics={METRICS}><ThemeProvider>{children}</ThemeProvider></SafeAreaProvider>
);
const mk = (id: string, title: string, startDay: number, durationDays: number, deps: string[] = []): ScheduleTask => ({
  id, title, phase: 'P', durationDays, startDay, progress: 0, crew: '', dependencies: deps, notes: '', status: 'not_started',
} as ScheduleTask);
const TASKS: ScheduleTask[] = [
  mk('t1', 'Framing', 1, 5), mk('t2', 'Rough-in inspection', 6, 1, ['t1']),
  mk('t3', 'Insulation', 7, 2, ['t2']), mk('t4', 'Cabinets', 9, 4, ['t3']),
  mk('t5', 'Appliance delivery', 10, 1), // independent procurement task
];
const SAID = 'Add three tasks after rough-in: drywall hang 4 days, drywall tape 3 days, prime and paint 5 days';
const AI_OPS = { ops: [
  { op: 'addTask', title: 'Drywall hang', durationDays: 4, after: 't2' },
  { op: 'addTask', title: 'Drywall tape', durationDays: 3, after: 'Drywall hang' },
  { op: 'addTask', title: 'Prime and paint', durationDays: 5, after: 'Drywall tape' },
] };
const CPM = {};
const sortTasks = (ts: ScheduleTask[]) => ts.slice().sort((a, b) => a.startDay - b.startDay || a.title.localeCompare(b.title));

let hostTasks: ScheduleTask[] = [];
const REFUSAL = 'Not saved: you have view-only access to this project. Ask the project owner for editor access.';
type Kind = 'pro' | 'classic' | 'refuse' | 'refuseUndo';
function Host({ kind }: { kind: Kind }) {
  const [tasks, setTasks] = useState<ScheduleTask[]>(TASKS);
  hostTasks = tasks;
  const ref = useRef(tasks); ref.current = tasks;
  const sorted = useMemo(() => sortTasks(tasks), [tasks]);
  const commit = useCallback((producer: (prev: ScheduleTask[]) => ScheduleTask[]) => {
    if (kind === 'refuse') return REFUSAL;
    // Apply is taken; the Undo write is refused (the seat changed in between).
    if (kind === 'refuseUndo') {
      if (ref.current.length > TASKS.length) return REFUSAL;
      const next = producer(ref.current); setTasks(next); return;
    }
    if (kind === 'pro') { const next = producer(ref.current); setTasks(next); return; }
    const next = producer(sortTasks(ref.current));
    const reflowed = applyToProjectSchedule({ tasks: ref.current } as never, next, CPM).tasks;
    setTasks(stampCriticalPath(reflowed, runCpm(reflowed, CPM)));
  }, [kind]);

  return (
    <>
      <Text testID="host-count">{tasks.length}</Text>
      <ScheduleEditPanel visible onClose={() => {}} projectId="p1" tasks={kind === 'classic' ? sorted : tasks} commit={commit} cpmOptions={CPM} hasToolbarUndo={kind === 'pro' || kind === 'refuseUndo'} />
    </>
  );
}

async function review(kind: Kind) {
  mockMageAI.mockResolvedValue({ success: true, data: AI_OPS });
  const r = render(<Host kind={kind} />, { wrapper: Wrapper });
  const input = await r.findByTestId('copilot-compose');
  fireEvent.changeText(input, SAID);
  fireEvent.press(r.getByTestId('copilot-send'));
  await waitFor(() => expect(r.getByTestId('schedule-edit-understood')).toBeTruthy());
  expect(r.getAllByTestId('schedule-edit-added')).toHaveLength(3);
  fireEvent.press(r.getByTestId('schedule-edit-apply'));
  await waitFor(() => expect(r.getByTestId('copilot-landed')).toBeTruthy());
  return r;
}

describe('schedule editor — what landed, and Undo, on every host', () => {
  beforeEach(() => mockMageAI.mockReset());

  it('Schedule Pro: 3 rows land, Undo takes them back', async () => {
    const r = await review('pro');
    expect(hostTasks).toHaveLength(TASKS.length + 3);
    expect(r.getByText('Added Drywall tape (3d) after Drywall hang')).toBeTruthy();
    fireEvent.press(r.getByTestId('copilot-undo'));
    expect(hostTasks).toHaveLength(TASKS.length);
    expect(r.getByText(/Undone — the schedule is back/)).toBeTruthy();
  });

  it('classic Schedule tab: Undo works although the rows were re-sorted by start day', async () => {
    const r = await review('classic');
    expect(hostTasks).toHaveLength(TASKS.length + 3);
    fireEvent.press(r.getByTestId('copilot-undo'));
    expect(r.queryByText(/The schedule changed since/)).toBeNull();
    expect(hostTasks).toHaveLength(TASKS.length);
    expect(r.getByText(/Undone — the schedule is back/)).toBeTruthy();
  });

  it('a refused write says nothing was saved — no ticked "Added" lines, no Undo', async () => {
    const r = await review('refuse');
    expect(hostTasks).toHaveLength(TASKS.length);
    expect(r.getByText(REFUSAL)).toBeTruthy();
    expect(r.getByText('Nothing changed.')).toBeTruthy();
    expect(r.getByText('Not saved — Added Drywall hang (4d) after Rough-in inspection')).toBeTruthy();
    expect(r.queryByText(/^Added /)).toBeNull();
    expect(r.queryByTestId('copilot-undo')).toBeNull();
  });

  it('an Undo the host refuses says so — never "Undone" (review round 4)', async () => {
    const r = await review('refuseUndo');
    expect(hostTasks).toHaveLength(TASKS.length + 3);
    fireEvent.press(r.getByTestId('copilot-undo'));
    expect(hostTasks).toHaveLength(TASKS.length + 3);
    expect(r.queryByText(/Undone — the schedule is back/)).toBeNull();
    expect(r.getByText(REFUSAL)).toBeTruthy();
  });

  it('the sheet is a centred column capped at 720 on a wide window', async () => {
    mockMageAI.mockResolvedValue({ success: true, data: AI_OPS });
    const r = render(<Host kind="pro" />, { wrapper: Wrapper });
    await r.findByTestId('copilot-compose');
    const sheet = StyleSheet.flatten(r.getByTestId('schedule-edit-sheet').props.style);
    expect(sheet).toMatchObject({ width: '100%', maxWidth: 720 });
  });
});
