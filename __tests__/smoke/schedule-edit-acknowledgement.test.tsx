/**
 * Render coverage — the schedule editor tells the truth about what it heard.
 *
 * The founder: "I asked it to create multiple new tasks, but I got only 1
 * acknowledged." Two surfaces produced that:
 *   (a) the editor's review (ScheduleDiffView) listed only the ops that
 *       survived normalisation and enabled "Apply it" if any did — three adds
 *       and a move showed just the move;
 *   (b) the Schedule Pro "AI" drawer answered an add request itself, as an
 *       edit of the selected row ("1 change(s) proposed").
 *
 * Mounted for real inside the real ThemeProvider:
 *   1. three addTask ops → three '+' rows and an "Apply 3 changes" button;
 *   2. one op the app couldn't read → "Understood 3 of 4 changes" plus a
 *      "Couldn't read" line;
 *   3. an "add tasks" request typed into the drawer's Ask box is handed to the
 *      editor (seeded with his words) and costs no AI call here.
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/contexts/ThemeContext';
import ScheduleDiffView from '@/components/copilot/ScheduleDiffView';
import type { ScheduleTask } from '@/types';
import { adoptCompleteDraft, normalizeEditOps, type EditOp } from '@/utils/copilot/scheduleEdit/editOps';

jest.mock('@/contexts/SubscriptionContext', () => ({ useSubscription: () => ({ tier: 'pro' }) }));
jest.mock('@/contexts/ProjectContext', () => ({ useProjects: () => ({ projects: [] }) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }) }));
jest.mock('@/utils/aiRateLimiter', () => ({
  checkAILimit: jest.fn(async () => ({ allowed: true })),
  recordAIUsage: jest.fn(async () => undefined),
}));
const mockAsk = jest.fn(async () => ({ ok: true, answer: 'x' }));
const mockGenerate = jest.fn(async () => ({ ok: true, tasks: [] }));
const mockBulk = jest.fn(async () => ({ ok: true, patches: [], summary: '' }));
jest.mock('@/utils/scheduleAI', () => ({
  aiDetectRisks: jest.fn(), aiOptimizeSchedule: jest.fn(), aiExplainCriticalPath: jest.fn(),
  aiAskSchedule: (...a: unknown[]) => mockAsk(...(a as [])),
  aiLogAsBuilt: jest.fn(), aiGenerateSchedule: (...a: unknown[]) => mockGenerate(...(a as [])), aiGenerateScheduleFromEstimate: jest.fn(),
  aiBulkEdit: (...a: unknown[]) => mockBulk(...(a as [])),
  materializeGeneratedTasks: jest.fn(() => []),
}));

// Required after the mocks so the panel picks them up.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const AIAssistantPanel = require('@/components/schedule/AIAssistantPanel').default;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider>{children}</ThemeProvider>
    </SafeAreaProvider>
  );
}

const mk = (id: string, title: string, startDay: number, durationDays: number, deps: string[] = []): ScheduleTask => ({
  id, title, phase: 'Interior', durationDays, startDay, progress: 0, crew: '', dependencies: deps, notes: '', status: 'not_started',
});
const TASKS: ScheduleTask[] = [mk('t1', 'Framing', 1, 5), mk('t2', 'Rough-in inspection', 6, 1, ['t1']), mk('t3', 'Cabinets', 7, 4, ['t2'])];
const CTX = { project: null, projectId: 'p1', ctx: {}, tier: 'pro', currentTasks: TASKS, cpmOptions: {} };
const THREE: EditOp[] = [
  { op: 'addTask', title: 'Drywall hang', durationDays: 4, after: 't2' },
  { op: 'addTask', title: 'Drywall tape', durationDays: 3, after: 'Drywall hang' },
  { op: 'addTask', title: 'Prime and paint', durationDays: 5, after: 'Drywall tape' },
];

describe('schedule editor review — honest acknowledgement', () => {
  it('lists all three new tasks and offers "Apply 3 changes"', () => {
    const onApply = jest.fn();
    const r = render(<ScheduleDiffView ops={THREE} ctx={CTX} onApply={onApply} onDiscard={jest.fn()} />, { wrapper: Wrapper });
    const added = r.getAllByTestId('schedule-edit-added');
    expect(added).toHaveLength(3);
    expect(r.getByText(/^\+ Drywall hang \(4d/)).toBeTruthy();
    expect(r.getByText(/^\+ Drywall tape \(3d/)).toBeTruthy();
    expect(r.getByText(/^\+ Prime and paint \(5d/)).toBeTruthy();
    expect(r.getByText('Apply 3 changes')).toBeTruthy();
    expect(r.getByTestId('schedule-edit-understood').props.children).toBe('Understood 3 changes');
    fireEvent.press(r.getByTestId('schedule-edit-apply'));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('says "Understood 3 of 4" and names the one it could not read', () => {
    const r = render(
      <ScheduleDiffView ops={THREE} dropped={[{ summary: 'addTask “Punch walk” — no valid duration' }]} ctx={CTX} onApply={jest.fn()} onDiscard={jest.fn()} />,
      { wrapper: Wrapper },
    );
    expect(r.getByTestId('schedule-edit-understood').props.children).toBe('Understood 3 of 4 changes');
    expect(r.getAllByTestId('schedule-edit-unread')).toHaveLength(1);
    expect(r.getByText(/Couldn’t read: addTask “Punch walk”/)).toBeTruthy();
    expect(r.getByText('Apply 3 changes')).toBeTruthy();
  });

  it('three same-named adds (one AI answer, through the real merge) are three rows, not one', () => {
    // Integration round 2: opKey keyed an add by title alone and the merge
    // collapsed ops inside one answer — three "Inspection"s read "+1". The
    // merge is now the complete-draft rule (the answer replaces the draft).
    const draft = adoptCompleteDraft({ ops: [] }, normalizeEditOps([
      { op: 'addTask', title: 'Inspection', durationDays: 1, after: 't1' },
      { op: 'addTask', title: 'Inspection', durationDays: 1, after: 't2' },
      { op: 'addTask', title: 'Inspection', durationDays: 1, after: 't3' },
    ]));
    const r = render(<ScheduleDiffView ops={draft.ops} dropped={draft.dropped} ctx={CTX} onApply={jest.fn()} onDiscard={jest.fn()} />, { wrapper: Wrapper });
    expect(r.getAllByTestId('schedule-edit-added')).toHaveLength(3);
    expect(r.getByTestId('schedule-edit-understood').props.children).toBe('Understood 3 changes');
    expect(r.getByText('Apply 3 changes')).toBeTruthy();
  });

  it('with nothing usable, Apply is off and says so', () => {
    const r = render(
      <ScheduleDiffView ops={[]} dropped={[{ summary: 'addTask — no valid duration' }]} ctx={CTX} onApply={jest.fn()} onDiscard={jest.fn()} />,
      { wrapper: Wrapper },
    );
    expect(r.getByText('Nothing to apply')).toBeTruthy();
    expect(r.getByTestId('schedule-edit-understood').props.children).toBe('Understood 0 of 1 change');
  });
});

const onReplaceAllSpy = (p: { onReplaceAll: jest.Mock }) => p.onReplaceAll;

describe('Schedule Pro AI drawer — add requests go to the editor', () => {
  const baseProps = {
    visible: true, onClose: jest.fn(), tasks: TASKS,
    cpm: { perTask: new Map(), criticalPath: [], projectFinish: 11, conflicts: [] },
    projectStartDate: new Date('2026-09-01T00:00:00Z'), todayDayNumber: 3,
    onApplyPatch: jest.fn(), onReplaceAll: jest.fn(),
  };

  it('hands "Add three tasks after rough-in…" to the editor with no AI call', () => {
    const onHandOff = jest.fn();
    const r = render(<AIAssistantPanel {...baseProps} onHandOffToEditor={onHandOff} />, { wrapper: Wrapper });
    fireEvent.press(r.getByText('Ask'));
    const input = r.getByPlaceholderText('Ask anything about the schedule…');
    fireEvent.changeText(input, 'Add three tasks after rough-in: drywall hang 4 days, drywall tape 3 days, prime and paint 5 days');
    fireEvent(input, 'submitEditing');
    expect(onHandOff).toHaveBeenCalledTimes(1);
    expect(onHandOff.mock.calls[0][0]).toMatch(/^Add three tasks after rough-in/);
    expect(mockAsk).not.toHaveBeenCalled();
  });

  it('hands a Bulk add over with the selected rows named', () => {
    const onHandOff = jest.fn();
    const r = render(<AIAssistantPanel {...baseProps} selectedIds={new Set(['t2'])} onHandOffToEditor={onHandOff} />, { wrapper: Wrapper });
    const input = r.getByPlaceholderText('What should I do with the selected tasks?');
    fireEvent.changeText(input, 'Add a drywall inspection after this');
    fireEvent(input, 'submitEditing');
    expect(onHandOff).toHaveBeenCalledWith('Add a drywall inspection after this (selected: Rough-in inspection)');
    expect(mockBulk).not.toHaveBeenCalled();
  });

  it('Generate on a job with tasks hands an add request to the editor instead of offering to replace the plan', () => {
    const onHandOff = jest.fn();
    const r = render(<AIAssistantPanel {...baseProps} onHandOffToEditor={onHandOff} />, { wrapper: Wrapper });
    fireEvent.press(r.getByText('Generate'));
    const input = r.getByPlaceholderText('Describe your project in 1-2 sentences…');
    fireEvent.changeText(input, 'Add three tasks after rough-in: drywall hang 4 days, drywall tape 3 days, prime and paint 5 days');
    fireEvent(input, 'submitEditing');
    expect(onHandOff).toHaveBeenCalledTimes(1);
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(onReplaceAllSpy(baseProps)).not.toHaveBeenCalled();
  });

  it('keeps a real question in the drawer', async () => {
    const onHandOff = jest.fn();
    const r = render(<AIAssistantPanel {...baseProps} onHandOffToEditor={onHandOff} />, { wrapper: Wrapper });
    fireEvent.press(r.getByText('Ask'));
    const input = r.getByPlaceholderText('Ask anything about the schedule…');
    fireEvent.changeText(input, 'When does drywall start?');
    fireEvent(input, 'submitEditing');
    expect(onHandOff).not.toHaveBeenCalled();
    await waitFor(() => expect(mockAsk).toHaveBeenCalledTimes(1));
  });
});
