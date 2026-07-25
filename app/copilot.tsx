// app/copilot.tsx — modal host for the MAGE Copilot conversational interview.
//
// Params: capabilityId (which capability to run) + projectId. Assembles the
// CopilotContext (project + adders + tier) and hands it to the shell.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useProjects } from '@/contexts/ProjectContext';
import { useSafety } from '@/contexts/SafetyContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import CopilotShell from '@/components/copilot/CopilotShell';
import type { CopilotCapabilityId } from '@/utils/copilot/types';

export default function CopilotScreen() {
  const { capabilityId, projectId, seed } = useLocalSearchParams<{ capabilityId: CopilotCapabilityId; projectId: string; seed?: string }>();
  const router = useRouter();
  const projectsCtx = useProjects() as any;
  const safetyCtx = useSafety() as any;
  const { tier } = useSubscription();
  // Receipts live outside ProjectContext (useMaterialReceipts hook) — spread
  // them into the ctx bag so estimateGrounding's cost book sees live supplier
  // prices (B1: receipts into every cost-book build).
  const { receipts } = useMaterialReceipts();
  const project = projectsCtx.getProject?.(projectId ?? '') ?? null;

  return (
    <CopilotShell
      capabilityId={(capabilityId ?? 'schedule') as CopilotCapabilityId}
      ctx={{ project, projectId: projectId ?? '', ctx: { ...projectsCtx, receipts }, safety: safetyCtx, tier }}
      onDone={() => router.back()}
      seed={typeof seed === 'string' ? seed : undefined}
    />
  );
}
