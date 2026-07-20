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
];

/** Validate a raw classifier result down to a known capability id (or null). */
export function coerceCapabilityId(raw: unknown): CopilotCapabilityId | null {
  return INTENTS.some((i) => i.id === raw) ? (raw as CopilotCapabilityId) : null;
}
