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
import { billingCapability } from './billing/billingCapability';
import { safetyCapability } from './safety/safetyCapability';
import { submittalCapability } from './submittal/submittalCapability';
import { warrantyCapability } from './warranty/warrantyCapability';
import { toolboxCapability } from './toolbox/toolboxCapability';

const REGISTRY: Partial<Record<CopilotCapabilityId, CopilotCapability>> = {
  schedule: scheduleCapability as CopilotCapability,
  estimate: estimateCapability as CopilotCapability,
  daily_report: dailyReportCapability as CopilotCapability,
  change_order: changeOrderCapability as CopilotCapability,
  rfi: rfiCapability as CopilotCapability,
  punch: punchCapability as CopilotCapability,
  invoice: billingCapability as CopilotCapability,
  safety_incident: safetyCapability as CopilotCapability,
  submittal: submittalCapability as CopilotCapability,
  warranty: warrantyCapability as CopilotCapability,
  toolbox_talk: toolboxCapability as CopilotCapability,
};

export function getCapability(id: CopilotCapabilityId): CopilotCapability | null {
  return REGISTRY[id] ?? null;
}
