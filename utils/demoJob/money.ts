// utils/demoJob/money.ts — the Demo Job's ONE set of numbers (pure).
//
// Every dollar figure on the demo comes from this file, so the estimate, the
// schedule of values, the change orders, the pay applications, the invoices,
// the subcontracts and the budget cannot disagree:
//
//   schedule of values at cost            $20,000,000   (22 CSI divisions)
//   markup, 12 percent on every line       $2,400,000
//   ORIGINAL CONTRACT SUM                 $22,400,000
//   approved change orders, 7              +$640,000
//   CONTRACT SUM TO DATE                  $23,040,000
//
// Retainage is a flat 10 percent on every pay application (the app holds one
// rate per line; a step-down to 5 percent at half way is not modelled here).
import type { Commitment } from '@/types';
import { roundCents } from '@/utils/invoiceBilling';
import { SUBS } from './world';

export const MARKUP_PERCENT = 12;
export const RETAINAGE_PERCENT = 10;

export interface SovLine { div: string; label: string; cost: number }

/** The schedule of values at cost. Whole thousands, so 12 percent is exact to the cent. */
export const SOV: readonly SovLine[] = [
  { div: '01', label: '01 General Conditions', cost: 1_460_000 },
  { div: '02', label: '02 Existing Conditions', cost: 160_000 },
  { div: '03', label: '03 Concrete', cost: 2_300_000 },
  { div: '04', label: '04 Masonry', cost: 380_000 },
  { div: '05', label: '05 Metals and Light-Gauge Framing', cost: 2_150_000 },
  { div: '06', label: '06 Wood, Plastics and Casework', cost: 660_000 },
  { div: '07', label: '07 Thermal and Moisture Protection', cost: 1_180_000 },
  { div: '08', label: '08 Openings', cost: 1_360_000 },
  { div: '09', label: '09 Finishes', cost: 2_200_000 },
  { div: '10', label: '10 Specialties', cost: 170_000 },
  { div: '11', label: '11 Equipment and Appliances', cost: 370_000 },
  { div: '12', label: '12 Furnishings', cost: 200_000 },
  { div: '14', label: '14 Conveying Equipment', cost: 560_000 },
  { div: '21', label: '21 Fire Suppression', cost: 480_000 },
  { div: '22', label: '22 Plumbing', cost: 1_300_000 },
  { div: '23', label: '23 HVAC', cost: 1_400_000 },
  { div: '26', label: '26 Electrical', cost: 1_620_000 },
  { div: '27', label: '27 Communications', cost: 190_000 },
  { div: '28', label: '28 Electronic Safety and Security', cost: 260_000 },
  { div: '31', label: '31 Earthwork', cost: 700_000 },
  { div: '32', label: '32 Exterior Improvements', cost: 380_000 },
  { div: '33', label: '33 Utilities', cost: 520_000 },
];

export const sovLabel = (div: string): string => {
  const l = SOV.find((x) => x.div === div);
  if (!l) throw new Error(`no schedule of values line for division ${div}`);
  return l.label;
};
/** A line's scheduled value: cost plus markup. */
export const scheduledValue = (line: SovLine): number => roundCents(line.cost * (1 + MARKUP_PERCENT / 100));

export const BASE_COST = SOV.reduce((s, l) => s + l.cost, 0);
export const ORIGINAL_CONTRACT_SUM = SOV.reduce((s, l) => s + scheduledValue(l), 0);

export type DemoCoStatus = 'approved' | 'submitted' | 'under_review' | 'rejected';

export interface DemoCo {
  n: number;
  title: string;
  reason: string;
  /** Price to the owner. Negative = a credit. */
  amount: number;
  div: string;
  status: DemoCoStatus;
  /** Working day it was written, and the day the contractor recorded the owner's answer. */
  day: number;
  decidedDay?: number;
  scheduleDays?: number;
  /** Schedule task (schedule.ts key) the work sits on. */
  task?: string;
  lines: { name: string; qty: number; unit: string; unitPrice: number }[];
}

export const CHANGE_ORDERS: readonly DemoCo[] = [
  { n: 1, title: 'Unsuitable Soil at East Footings', reason: 'Differing site condition. Loose fill found below the east footings. Over-excavate and replace with structural fill, as directed by the structural engineer (RFI 2).', amount: 148_500, div: '31', status: 'approved', day: 36, decidedDay: 44, scheduleDays: 4, task: 'exc',
    lines: [{ name: 'Over-excavation and haul-off', qty: 1_350, unit: 'CY', unitPrice: 58 }, { name: 'Structural fill, placed and compacted', qty: 1_350, unit: 'CY', unitPrice: 44 }, { name: 'Compaction testing', qty: 1, unit: 'LS', unitPrice: 10_800 }] },
  { n: 2, title: 'Storefront Upgrade to Thermally Broken System', reason: 'Owner request. Retail storefront changed to a thermally broken frame with low-e insulating glass.', amount: 96_000, div: '08', status: 'approved', day: 78, decidedDay: 90, task: 'storefront',
    lines: [{ name: 'Storefront frame and glass upgrade', qty: 1_600, unit: 'SF', unitPrice: 60 }] },
  { n: 3, title: 'Added Transfer Beam at Level 2', reason: 'Design revision. Structural revision added a transfer beam at gridline C (RFI 5).', amount: 112_000, div: '03', status: 'approved', day: 104, decidedDay: 112, scheduleDays: 3, task: 'pod-deck',
    lines: [{ name: 'Transfer beam formwork, rebar and concrete', qty: 1, unit: 'LS', unitPrice: 97_500 }, { name: 'Added shoring', qty: 1, unit: 'LS', unitPrice: 14_500 }] },
  { n: 4, title: 'Relocated Electrical Service Entrance', reason: 'Utility requirement. The utility moved the service point to the north alley. Longer duct bank and a relocated switchgear pad.', amount: 87_500, div: '26', status: 'approved', day: 122, decidedDay: 133, task: 'underslab',
    lines: [{ name: 'Duct bank extension', qty: 140, unit: 'LF', unitPrice: 425 }, { name: 'Switchgear pad and feeders', qty: 1, unit: 'LS', unitPrice: 28_000 }] },
  { n: 5, title: 'Quartz Countertops in All 48 Units', reason: 'Owner request. Kitchen and bath tops upgraded from laminate to quartz.', amount: 134_400, div: '06', status: 'approved', day: 150, decidedDay: 161, task: 'l2-cab',
    lines: [{ name: 'Quartz countertop upgrade, per unit', qty: 48, unit: 'EA', unitPrice: 2_800 }] },
  { n: 6, title: 'Credit: Decorative Roof Screen Deleted', reason: 'Owner request. The decorative screen at the roof was deleted from the work.', amount: -38_400, div: '05', status: 'approved', day: 168, decidedDay: 174, task: 'roof-frame',
    lines: [{ name: 'Credit for deleted roof screen', qty: 1, unit: 'LS', unitPrice: -38_400 }] },
  { n: 7, title: 'Electric Vehicle Charging Rough-In', reason: 'Owner request. Conduit, panel capacity and pull boxes for 12 future charging stations.', amount: 100_000, div: '26', status: 'approved', day: 186, decidedDay: 196, task: 'l1-mep',
    lines: [{ name: 'Charging rough-in, per stall', qty: 12, unit: 'EA', unitPrice: 6_500 }, { name: 'Panel and feeder upgrade', qty: 1, unit: 'LS', unitPrice: 22_000 }] },
  { n: 8, title: 'Corridor Flooring Changed to Plank', reason: 'Owner request. Corridor carpet tile changed to luxury vinyl plank on Levels 2 to 7.', amount: 42_800, div: '09', status: 'submitted', day: 205, task: 'common',
    lines: [{ name: 'Flooring material and labor difference', qty: 5_350, unit: 'SF', unitPrice: 8 }] },
  { n: 9, title: 'Lobby Feature Wall', reason: 'Owner request. Added wood slat feature wall and bench at the residential lobby.', amount: 61_200, div: '06', status: 'under_review', day: 210, task: 'l1-fin',
    lines: [{ name: 'Feature wall millwork', qty: 1, unit: 'LS', unitPrice: 48_700 }, { name: 'Built-in bench', qty: 1, unit: 'LS', unitPrice: 12_500 }] },
  { n: 10, title: 'Winter Protection and Temporary Heat', reason: 'Contractor request for added winter protection during the podium pours. The owner did not accept it: the contract already includes winter conditions.', amount: 58_000, div: '03', status: 'rejected', day: 118, decidedDay: 126, task: 'pod-pour',
    lines: [{ name: 'Blankets, enclosures and temporary heat', qty: 1, unit: 'LS', unitPrice: 58_000 }] },
];

export const approvedCos = (): DemoCo[] => CHANGE_ORDERS.filter((c) => c.status === 'approved');
export const APPROVED_CO_TOTAL = approvedCos().reduce((s, c) => s + c.amount, 0);
export const CONTRACT_SUM_TO_DATE = ORIGINAL_CONTRACT_SUM + APPROVED_CO_TOTAL;

/** Approved change orders decided on or before working day `day`. */
export const approvedCosBy = (day: number): DemoCo[] => approvedCos().filter((c) => (c.decidedDay ?? 0) <= day);

// ── Pay applications ────────────────────────────────────────────────────────

export const PAY_APP_COUNT = 9;
/** The last working day each application bills through. Monthly; the ninth closed twelve working days before the data date. */
export const PAY_APP_PERIOD_END: readonly number[] = [40, 62, 84, 106, 128, 150, 172, 194, 216];
/** Working days from a period's end to the application date, and to the owner's payment. */
export const PAY_APP_ISSUED_AFTER = 3;
export const PAY_APP_PAID_AFTER = 24;
/** Applications 1 to 8 are paid. The ninth is out and not yet due. */
export const PAID_PAY_APPS = 8;

// ── Subcontracts and purchase orders ────────────────────────────────────────

export interface DemoCommitment {
  key: string;
  number: string;
  type: Commitment['type'];
  subKey?: string;
  vendor: string;
  div: string;
  description: string;
  amount: number;
  change: number;
  signedDay: number;
}

const PURCHASE_ORDERS: readonly DemoCommitment[] = [
  { key: 'po-appliances', number: 'PO-101', type: 'purchase_order', vendor: 'Sample Appliance Supply', div: '11', description: 'Unit appliance packages, 48 units', amount: 352_000, change: 0, signedDay: 150 },
  { key: 'po-specialties', number: 'PO-102', type: 'purchase_order', vendor: 'Sample Building Supply', div: '10', description: 'Toilet accessories, mailboxes, signage and fire extinguishers', amount: 158_000, change: 0, signedDay: 160 },
  { key: 'po-blinds', number: 'PO-103', type: 'purchase_order', vendor: 'Sample Building Supply', div: '12', description: 'Window treatments, all units', amount: 186_000, change: 0, signedDay: 172 },
  { key: 'po-access', number: 'PO-104', type: 'purchase_order', vendor: 'Sample Security Systems', div: '28', description: 'Access control and video intercom', amount: 238_000, change: 0, signedDay: 140 },
];

export const COMMITMENTS: readonly DemoCommitment[] = [
  ...SUBS.filter((s) => s.contract > 0).map((s, i): DemoCommitment => ({
    key: `sc-${s.key}`,
    number: `SC-${String(i + 1).padStart(3, '0')}`,
    type: 'subcontract',
    subKey: s.key,
    vendor: s.company,
    div: s.div,
    description: s.what,
    amount: s.contract,
    change: s.change,
    signedDay: Math.max(2, i * 6),
  })),
  ...PURCHASE_ORDERS,
];

/** Cost the contractor carries himself (general conditions and the divisions with no subcontract or purchase order). */
export const SELF_PERFORM_DIVS = ['01', '02', '27', '33'] as const;

/** Budget at cost: the schedule of values plus the cost side of the approved change orders. */
export const coCost = (amount: number): number => roundCents(amount / (1 + MARKUP_PERCENT / 100));
export const BUDGET_COST = roundCents(BASE_COST + approvedCos().reduce((s, c) => s + coCost(c.amount), 0));

/**
 * Projected final cost: what is committed, plus the budget of every division
 * nothing is committed against yet. The two divisions that run over are the
 * ones whose commitments exceed their budget (Concrete and Finishes).
 */
export function projectedFinalCost(): { total: number; byDiv: { div: string; budget: number; committed: number; projected: number; over: number }[] } {
  const byDiv = SOV.map((l) => {
    const budget = roundCents(l.cost + approvedCos().filter((c) => c.div === l.div).reduce((s, c) => s + coCost(c.amount), 0));
    const committed = COMMITMENTS.filter((c) => c.div === l.div).reduce((s, c) => s + c.amount + c.change, 0);
    const projected = Math.max(budget, committed);
    return { div: l.div, budget, committed, projected, over: Math.max(0, roundCents(committed - budget)) };
  });
  return { total: roundCents(byDiv.reduce((s, d) => s + d.projected, 0)), byDiv };
}

/** Projected margin on the contract sum to date, as a percent (one decimal). */
export function projectedMarginPercent(): number {
  return Math.round(((CONTRACT_SUM_TO_DATE - projectedFinalCost().total) / CONTRACT_SUM_TO_DATE) * 1000) / 10;
}
