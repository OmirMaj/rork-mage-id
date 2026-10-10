// __tests__/helpers/deliveriesGolden.ts — the fixture and the subtree picker
// shared by the two Deliveries That Follow The Schedule suites (lane
// DELIVERIES-1). Not a test file: importing it runs nothing.
import { PROJECT_ID } from '@/__tests__/fixtures/world';
import type { Delivery } from '@/utils/deliverySchedule';

const base = { projectId: PROJECT_ID, createdAt: '2026-10-01T16:00:00.000Z', updatedAt: '2026-10-01T16:00:00.000Z' };
export const GOLDEN_DELIVERIES: Delivery[] = [
  { ...base, id: 'dddddddd-0000-4000-8000-000000000001', description: 'Roof Trusses', supplier: 'Kessler Lumber Yard', expectedDate: '2026-10-11', status: 'scheduled' },
  { ...base, id: 'dddddddd-0000-4000-8000-000000000002', description: '14 Windows', supplier: 'Northside Glass', expectedDate: '2026-10-16', status: 'scheduled', window: '07:00-11:00', poNumber: '1042' },
  { ...base, id: 'dddddddd-0000-4000-8000-000000000003', description: 'Flashing Tape and Sealant', supplier: 'Harbor Building Supply', expectedDate: '2026-10-19', status: 'confirmed', confirmedAt: '2026-10-02T16:00:00.000Z' },
  { ...base, id: 'dddddddd-0000-4000-8000-000000000004', description: 'Framing Lumber Package', supplier: 'Kessler Lumber Yard', expectedDate: '2026-10-05', status: 'delivered', deliveredAt: '2026-10-05T15:00:00.000Z' },
];

export type Json = { type?: string; props?: Record<string, unknown>; children?: unknown[] | null } | string | null;

function holds(n: Json | Json[], id: string): boolean {
  if (Array.isArray(n)) return n.some((c) => holds(c, id));
  if (!n || typeof n === 'string') return false;
  if (n.props?.testID === id) return true;
  return (n.children ?? []).some((c) => holds(c as Json, id));
}

/**
 * The smallest node that holds every one of `ids`: the Deliveries screen
 * itself (or its sheet), without the app shell around it. Other lanes change
 * the shell; this golden is about this screen.
 */
export function smallestHolding(n: Json | Json[], ids: string[]): Json {
  const kids: Json[] = Array.isArray(n) ? n : (n && typeof n !== 'string' ? ((n.children ?? []) as Json[]) : []);
  for (const c of kids) if (ids.every((id) => holds(c, id))) return smallestHolding(c, ids);
  return Array.isArray(n) ? null : n;
}

export const SCREEN_IDS = ['deliveries-arrived', 'deliveries-horizon-7', 'deliveries-building-access'];
export const SHEET_IDS = ['delivery-description', 'delivery-supplier', 'delivery-date', 'delivery-save'];
