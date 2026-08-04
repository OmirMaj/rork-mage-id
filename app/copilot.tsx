// app/copilot.tsx — modal host for the MAGE Copilot conversational interview.
//
// Params: capabilityId (which capability to run) + projectId. Assembles the
// CopilotContext (project + adders + tier) and hands it to the shell.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useProjects } from '@/contexts/ProjectContext';
import { useSafety } from '@/contexts/SafetyContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useLaborCostSamples } from '@/hooks/useLaborRates';
import { useCostSeeds } from '@/hooks/useCostSeeds';
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
  // Self-perform labor samples (D6) — same ctx-bag route as receipts, so the
  // estimate copilot's cost book prices labor from the GC's clocked hours.
  const laborSamples = useLaborCostSamples();
  // Cold-start cost seeds — same ctx-bag route. The estimate copilot is one of
  // the most visible AI surfaces after the wizard; without these a seeded
  // contractor gets ungrounded LLM pricing here while the wizard next door
  // prices off their own numbers. (`seeds`, not `seed` — that route param above
  // is the copilot's opening message.)
  const { seeds } = useCostSeeds();
  const project = projectsCtx.getProject?.(projectId ?? '') ?? null;

  return (
    <CopilotShell
      capabilityId={(capabilityId ?? 'schedule') as CopilotCapabilityId}
      ctx={{ project, projectId: projectId ?? '', ctx: { ...projectsCtx, receipts, laborSamples, seeds }, safety: safetyCtx, tier }}
      onDone={() => router.back()}
      seed={typeof seed === 'string' ? seed : undefined}
    />
  );
}
