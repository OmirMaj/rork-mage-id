// components/copilot/ScheduleEditPanel.tsx — hosts the copilot shell for
// conversational schedule editing, wiring the editor's commit + live tasks +
// CPM options into ctx so the edit previews + applies against what's on screen.
import React, { useCallback, useMemo, useRef } from 'react';
import { Modal, View, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import CopilotShell from '@/components/copilot/CopilotShell';
import { useProjects } from '@/contexts/ProjectContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import type { ScheduleTask } from '@/types';
import type { RunCpmOptions } from '@/utils/cpm';
import { commitRefused, type CommitOutcome, type CopilotContext } from '@/utils/copilot/types';
import type { SchedulePreviewOverlay } from '@/utils/schedulePreviewOverlay';

/** What a structural undo compares: the shape of the plan, not the start days
 *  a host reflows after the commit (the classic tab writes CPM starts back),
 *  and NOT the row order either — the classic tab re-sorts its rows by start
 *  day after the reflow, so an order-sensitive fingerprint refused every Undo
 *  there whenever a task started between the new rows. Exported for the guard. */
export const fingerprint = (tasks: ScheduleTask[]) =>
  JSON.stringify([...tasks]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(t => [t.id, t.title, t.durationDays, t.progress, [...t.dependencies].sort()]));

export default function ScheduleEditPanel({
  visible, onClose, projectId, tasks, commit, cpmOptions, seed, hasToolbarUndo = false,
  presentation = 'modal', autoSubmitSeed, onPreview,
}: {
  visible: boolean;
  onClose: () => void;
  projectId: string;
  tasks: ScheduleTask[];
  /** Return `false` or the reason when the host refused the write. */
  commit: (producer: (prev: ScheduleTask[]) => ScheduleTask[]) => CommitOutcome;
  cpmOptions: RunCpmOptions;
  /** Pre-fill the compose box — the AI drawer hands an "add tasks" request
   *  here (with the selected rows named) instead of answering it itself. */
  seed?: string;
  /** The host has its own Undo control (Schedule Pro's toolbar). Only then
   *  may a refused Undo here point at it — the classic tab and the phone have
   *  none, and "use Undo in the toolbar" sent him looking for nothing. */
  hasToolbarUndo?: boolean;
  /** 'modal' (default): today's bottom sheet — the path the phone, the classic
   *  tab and the scheduleEdit tutorial layer use. 'docked' (Schedule Pro's
   *  desktop pane, wave 6c): the same shell in a flex:1 column, no Modal, so
   *  the Gantt beside it stays visible and interactive. */
  presentation?: 'modal' | 'docked';
  /** Send this as his first turn as soon as the shell is listening (the Pro
   *  toolbar's command field: he already typed the change). Default: none. */
  autoSubmitSeed?: string;
  /** The review's proposal as a Gantt overlay (null when it goes away). */
  onPreview?: (overlay: SchedulePreviewOverlay | null) => void;
}) {
  const projectsCtx = useProjects() as any;
  const { tier } = useSubscription();
  const project = projectsCtx.getProject?.(projectId) ?? null;

  // Snapshot the plan the Apply replaced, so the "what landed" card can undo
  // it through the host's own commit (the same undo-safe path as any edit).
  const beforeRef = useRef<ScheduleTask[] | null>(null);
  const afterRef = useRef<ScheduleTask[] | null>(null);
  const commitWithSnapshot = useCallback((producer: (prev: ScheduleTask[]) => ScheduleTask[]) => {
    const wrote = commit(prev => {
      const next = producer(prev);
      beforeRef.current = prev;
      afterRef.current = next;
      return next;
    });
    // A refused write leaves nothing to undo.
    if (commitRefused(wrote)) { beforeRef.current = null; afterRef.current = null; }
    return wrote;
  }, [commit]);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const undo = useCallback((): { ok: boolean; message: string } => {
    const before = beforeRef.current;
    const after = afterRef.current;
    if (!before || !after) return { ok: false, message: 'Nothing to undo yet.' };
    // Only while the schedule is still what this Apply produced — never roll
    // back someone else's change that landed in between.
    if (fingerprint(tasksRef.current) !== fingerprint(after)) {
      return {
        ok: false,
        message: hasToolbarUndo
          ? 'The schedule changed since — use Undo in the toolbar instead.'
          : 'The schedule changed since this was applied, so nothing was undone — change it back on the schedule.',
      };
    }
    // The host can refuse the write (seat role, a saved plan on screen) — then
    // nothing was undone, and the card must say so, not "Undone". The
    // snapshot is kept so a retry is still possible.
    const wrote = commit(() => before);
    if (commitRefused(wrote)) {
      return { ok: false, message: typeof wrote === 'string' ? wrote : 'Nothing was undone.' };
    }
    beforeRef.current = null;
    afterRef.current = null;
    return { ok: true, message: 'Undone — the schedule is back to how it was.' };
  }, [commit, hasToolbarUndo]);

  // Memoized: the shell's preview re-interprets the ops whenever ctx changes
  // identity. Rebuilt every render, it re-ran the whole preview (and, with the
  // old counter, burned a new-task id) on every keystroke.
  const ctx = useMemo<CopilotContext>(() => ({
    project, projectId, ctx: projectsCtx, tier, commitTasks: commitWithSnapshot, currentTasks: tasks, cpmOptions,
    ...(onPreview ? { onPreview } : {}),
  }), [project, projectId, projectsCtx, tier, commitWithSnapshot, tasks, cpmOptions, onPreview]);

  if (!visible) return null;
  if (presentation === 'docked') {
    return (
      <View style={styles.docked} testID="schedule-edit-docked">
        <CopilotShell
          capabilityId="scheduleEdit"
          ctx={ctx}
          onDone={onClose}
          seed={seed}
          onUndo={undo}
          autoSubmitSeed={autoSubmitSeed}
        />
      </View>
    );
  }
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* The keyboard must not cover the review's follow-up box and its Send
          (it sits under the diff and Apply in an 82% sheet). */}
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.sheet} testID="schedule-edit-sheet">
          <CopilotShell
            capabilityId="scheduleEdit"
            ctx={ctx}
            onDone={onClose}
            seed={seed}
            onUndo={undo}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// On a wide web window the sheet was the full viewport width (~1390px of
// compose box, diff and Apply pill). It is a column, centred, the same 720 the
// Copilot hub uses; a phone is narrower than 720 and is unchanged.
export const SCHEDULE_EDIT_SHEET_MAX_WIDTH = 720;
const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { height: '82%', width: '100%', maxWidth: SCHEDULE_EDIT_SHEET_MAX_WIDTH },
  docked: { flex: 1 },
});
