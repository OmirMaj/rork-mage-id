// app/copilot.tsx — modal host for the MAGE Copilot conversational interview.
//
// Params: capabilityId (which capability to run) + projectId. Assembles the
// CopilotContext (project + adders + tier) and hands it to the shell.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useProjects } from '@/contexts/ProjectContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import CopilotShell from '@/components/copilot/CopilotShell';
import type { CopilotCapabilityId } from '@/utils/copilot/types';

export default function CopilotScreen() {
  const { capabilityId, projectId } = useLocalSearchParams<{ capabilityId: CopilotCapabilityId; projectId: string }>();
  const router = useRouter();
  const projectsCtx = useProjects() as any;
  const { tier } = useSubscription();
  const project = projectsCtx.getProject?.(projectId ?? '') ?? null;

  return (
    <CopilotShell
      capabilityId={(capabilityId ?? 'schedule') as CopilotCapabilityId}
      ctx={{ project, projectId: projectId ?? '', ctx: projectsCtx, tier }}
      onDone={() => router.back()}
    />
  );
}
