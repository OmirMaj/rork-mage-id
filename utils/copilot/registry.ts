// utils/copilot/registry.ts — capability lookup.
//
// One place that maps a CopilotCapabilityId to its capability object. Adding a
// new capability = register it here (and give it its own adapter files).
import type { CopilotCapability, CopilotCapabilityId } from './types';
import { scheduleCapability } from './schedule/scheduleCapability';
import { estimateCapability } from './estimate/estimateCapability';
import { dailyReportCapability } from './dailyReport/dfrCapability';
import { changeOrderCapability } from './changeOrder/coCapability';
import { rfiCapability } from './rfi/rfiCapability';
import { punchCapability } from './punch/punchCapability';

const REGISTRY: Partial<Record<CopilotCapabilityId, CopilotCapability>> = {
  schedule: scheduleCapability as CopilotCapability,
  estimate: estimateCapability as CopilotCapability,
  daily_report: dailyReportCapability as CopilotCapability,
  change_order: changeOrderCapability as CopilotCapability,
  rfi: rfiCapability as CopilotCapability,
  punch: punchCapability as CopilotCapability,
};

export function getCapability(id: CopilotCapabilityId): CopilotCapability | null {
  return REGISTRY[id] ?? null;
}
