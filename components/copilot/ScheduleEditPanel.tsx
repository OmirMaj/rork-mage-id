// components/copilot/ScheduleEditPanel.tsx — hosts the copilot shell for
// conversational schedule editing, wiring the editor's commit + live tasks +
// CPM options into ctx so the edit previews + applies against what's on screen.
import React from 'react';
import { Modal, View, StyleSheet } from 'react-native';
import CopilotShell from '@/components/copilot/CopilotShell';
import { useProjects } from '@/contexts/ProjectContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import type { ScheduleTask } from '@/types';
import type { RunCpmOptions } from '@/utils/cpm';

export default function ScheduleEditPanel({ visible, onClose, projectId, tasks, commit, cpmOptions }: {
  visible: boolean;
  onClose: () => void;
  projectId: string;
  tasks: ScheduleTask[];
  commit: (producer: (prev: ScheduleTask[]) => ScheduleTask[]) => void;
  cpmOptions: RunCpmOptions;
}) {
  const projectsCtx = useProjects() as any;
  const { tier } = useSubscription();
  if (!visible) return null;
  const project = projectsCtx.getProject?.(projectId) ?? null;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <CopilotShell
            capabilityId={'scheduleEdit' as never}
            ctx={{ project, projectId, ctx: projectsCtx, tier, commitTasks: commit, currentTasks: tasks, cpmOptions }}
            onDone={onClose}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: { height: '82%' },
});
