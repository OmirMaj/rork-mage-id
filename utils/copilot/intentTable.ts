// utils/copilot/intentTable.ts — the universal router's capability table +
// id coercion. Pure (no mageAI / RN imports) so it's unit-testable and safe to
// import from both the classifier and the hub screen.
import type { CopilotCapabilityId } from './types';

/** The capabilities the router can dispatch to, with a plain-English hint the
 *  classifier matches against. Add an entry here when a new field capability
 *  is registered. */
export const INTENTS: { id: CopilotCapabilityId; label: string; hint: string }[] = [
  { id: 'daily_report', label: 'Daily report', hint: 'log the end of the day — crew on site, work done, weather, issues' },
  { id: 'schedule', label: 'Schedule', hint: 'build or adjust the project schedule / timeline' },
  { id: 'estimate', label: 'Estimate', hint: 'price out a scope of work / create an estimate' },
  { id: 'change_order', label: 'Change order', hint: 'a change the owner wants — added scope and cost' },
  { id: 'rfi', label: 'RFI', hint: 'a question for the architect or engineer (request for information)' },
  { id: 'submittal', label: 'Submittal', hint: 'a submittal, shop drawing, or product sample for review' },
  { id: 'punch', label: 'Punch item', hint: 'a punch-list defect that needs fixing' },
  { id: 'invoice', label: 'Billing', hint: 'bill the client / a progress draw / an invoice' },
  { id: 'safety_incident', label: 'Safety incident', hint: 'a safety incident, injury, or near-miss' },
  { id: 'warranty', label: 'Warranty', hint: 'log a warranty on installed work — roof, HVAC, appliance, etc.' },
  { id: 'toolbox_talk', label: 'Toolbox talk', hint: 'run a jobsite safety meeting / toolbox talk / tailgate talk' },
];

/** Validate a raw classifier result down to a known capability id (or null). */
export function coerceCapabilityId(raw: unknown): CopilotCapabilityId | null {
  return INTENTS.some((i) => i.id === raw) ? (raw as CopilotCapabilityId) : null;
}

export interface SplitAction {
  capabilityId: CopilotCapabilityId;
  /** The exact words for THIS action, seeded into that capability's interview. */
  text: string;
  /** Short human label for the queue card. */
  label: string;
}

/** Validate + clean a raw AI actions array down to usable SplitActions. Pure. */
export function normalizeSplitActions(raw: unknown): SplitAction[] {
  if (!Array.isArray(raw)) return [];
  const out: SplitAction[] = [];
  const seen = new Set<string>();
  for (const a of raw) {
    const capabilityId = coerceCapabilityId((a as { capabilityId?: unknown })?.capabilityId);
    const text = typeof (a as { text?: unknown })?.text === 'string' ? (a as { text: string }).text.trim() : '';
    const label = typeof (a as { label?: unknown })?.label === 'string' ? (a as { label: string }).label.trim() : '';
    if (!capabilityId || !text) continue;
    const key = capabilityId + '|' + text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ capabilityId, text, label: label || text.slice(0, 40) });
  }
  return out;
}
