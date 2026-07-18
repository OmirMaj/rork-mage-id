// utils/copilot/registry.ts — capability lookup.
//
// One place that maps a CopilotCapabilityId to its capability object. Adding a
// new capability = register it here (and give it its own adapter files).
import type { CopilotCapability, CopilotCapabilityId } from './types';
import { scheduleCapability } from './schedule/scheduleCapability';

const REGISTRY: Partial<Record<CopilotCapabilityId, CopilotCapability>> = {
  schedule: scheduleCapability as CopilotCapability,
};

export function getCapability(id: CopilotCapabilityId): CopilotCapability | null {
  return REGISTRY[id] ?? null;
}
