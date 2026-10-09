// utils/demoJob/records.ts — the project, its money records and its directory (pure).
//
// Plain domain objects (types/index.ts) built from the tables in world.ts,
// money.ts and schedule.ts. Nothing here writes anything: demoWriter.ts hands
// these to the app's own add functions.
//
// WHAT IS DELIBERATELY NOT SET, ON EVERY RECORD (the liability rules):
//   - no signature, seal, certificate or "verified at" field of any kind;
//   - no approver rows on a change order (an approval here is the contractor's
//     own note of what the owner told him, and the audit line says so);
//   - no client email on the project or an invoice, no portal invite, no
//     weekly digest, the portal off;
//   - no insurance expiry date (the server's daily insurance check emails the
//     account for any sub that has one), no pay link, no QuickBooks id.
import type {
  CertificateOfInsurance, ChangeOrder, Commitment, Contact, LinkedEstimate, Project, ProjectSchedule, Subcontractor,
} from '@/types';
import { roundCents } from '@/utils/invoiceBilling';
import { DATA_DAY, type DemoClock } from './clock';
import { divisionPercentOn } from './billing';
import { DEMO_LEAD_SOURCE, DEMO_PROJECT_NAME } from './marker';
import {
  BASE_COST, CHANGE_ORDERS, COMMITMENTS, MARKUP_PERCENT, ORIGINAL_CONTRACT_SUM, PAID_PAY_APPS, PAY_APP_PERIOD_END,
  RETAINAGE_PERCENT, SOV, approvedCosBy, scheduledValue, sovLabel,
} from './money';
import { LATE, buildDemoTasks, type DemoScheduleParts } from './schedule';
import { CREW, JOB, PEOPLE, SUBS, SUPER_NAME, fullName, person, sub, subEmail, subPhone } from './world';

export type IdOf = (key: string) => string;
export const subId = (id: IdOf, key: string): string => id(`sub:${key}`);

export function buildSubcontractors(id: IdOf, clock: DemoClock): Subcontractor[] {
  return SUBS.map((s, i) => ({
    id: subId(id, s.key),
    companyName: s.company,
    contactName: s.contact,
    phone: subPhone(s),
    email: subEmail(s),
    address: `${200 + i * 10} Sample Trade Way, Baltimore, MD 21230`,
    trade: s.trade,
    licenseNumber: `DEMO-${String(1000 + s.n)}`,
    licenseState: 'MD',
    // A licence date is typed by the contractor and nothing on the server reads it.
    licenseExpiry: clock.fromToday(i % 5 === 0 ? 21 : 200 + i * 9),
    w9OnFile: i % 4 !== 3,
    bidHistory: [],
    assignedProjects: s.contract > 0 ? [id('project')] : [],
    notes: `Made-up company for the demo job. ${s.what}.`,
    createdAt: clock.at(-20 + i, 9),
    updatedAt: clock.at(-20 + i, 9),
  }));
}

export function buildCois(id: IdOf, clock: DemoClock): CertificateOfInsurance[] {
  return SUBS.filter((s) => s.contract > 0).map((s, i) => ({
    id: id(`coi:${s.key}`),
    subcontractorId: subId(id, s.key),
    projectId: id('project'),
    fileUri: '',
    uploadedAt: clock.at(Math.max(1, i * 6), 11),
    coverages: [
      { type: 'general_liability', carrierName: 'Example Insurance Company', policyNumber: `DEMO-GL-${1000 + s.n}`, eachOccurrence: 1_000_000, generalAggregate: 2_000_000, source: 'manual' },
      { type: 'workers_comp', carrierName: 'Example Insurance Company', policyNumber: `DEMO-WC-${1000 + s.n}`, source: 'manual' },
    ],
    notes: 'Made-up certificate, typed by hand. No file is attached and no expiry date is entered, so no insurance reminder can ever be sent for it.',
  }));
}

export function buildContacts(id: IdOf, clock: DemoClock): Contact[] {
  return PEOPLE.map((p, i) => ({
    id: id(`contact:${p.key}`),
    firstName: p.first,
    lastName: p.last,
    companyName: p.company,
    role: p.role,
    email: p.email,
    phone: p.phone,
    address: `${100 + i} Example Office Plaza, Baltimore, MD 21202`,
    notes: p.note,
    linkedProjectIds: [id('project')],
    createdAt: clock.at(-25 + i, 9),
    updatedAt: clock.at(-25 + i, 9),
  }));
}

/** How far a commitment is paid: the share of its division billed on the last PAID application, less retainage. */
function paidShare(div: string): number {
  const day = PAY_APP_PERIOD_END[PAID_PAY_APPS - 1];
  return (divisionPercentOn(div, day) / 100) * (1 - RETAINAGE_PERCENT / 100);
}

export function buildCommitments(id: IdOf, clock: DemoClock): Commitment[] {
  return COMMITMENTS.map((c) => {
    const value = c.amount + c.change;
    return {
      id: id(`commitment:${c.key}`),
      projectId: id('project'),
      number: c.number,
      type: c.type,
      ...(c.subKey ? { subcontractorId: subId(id, c.subKey) } : {}),
      vendorName: c.vendor,
      description: c.description,
      amount: c.amount,
      ...(c.change ? { changeAmount: c.change } : {}),
      paidToDate: Math.round(value * paidShare(c.div)),
      signedDate: clock.dayOf(c.signedDay),
      phase: sovLabel(c.div),
      csiDivision: c.div,
      linkedEstimateItems: [id(`sov:${c.div}`)],
      status: 'active',
      notes: 'Made-up demo commitment, recorded by the contractor. No subcontract document is attached and nothing was sent for signature.',
      createdAt: clock.at(c.signedDay, 9),
      updatedAt: clock.at(Math.max(c.signedDay, PAY_APP_PERIOD_END[PAID_PAY_APPS - 1]), 9),
    };
  });
}

export function buildChangeOrders(id: IdOf, clock: DemoClock, contractorName: string): ChangeOrder[] {
  return CHANGE_ORDERS.map((c) => {
    const priorApproved = approvedCosBy((c.decidedDay ?? c.day) - 1).filter((x) => x.n !== c.n).reduce((s, x) => s + x.amount, 0);
    const decided = c.decidedDay !== undefined;
    const trail = [
      { id: id(`co:${c.n}:a1`), action: 'created', actor: contractorName, timestamp: clock.at(c.day, 10), detail: 'Made-up demo change order, typed by the contractor.' },
      ...(decided ? [{
        id: id(`co:${c.n}:a2`),
        action: c.status === 'approved' ? 'approved' : 'rejected',
        actor: contractorName,
        timestamp: clock.at(c.decidedDay as number, 15),
        detail: c.status === 'approved'
          ? 'Approved, recorded by the contractor. No client signature is stored on this demo record.'
          : 'Not accepted by the owner, recorded by the contractor. No client signature is stored on this demo record.',
      }] : []),
    ];
    return {
      id: id(`co:${c.n}`),
      number: c.n,
      projectId: id('project'),
      date: clock.at(c.day, 10),
      description: c.title,
      reason: c.reason,
      lineItems: c.lines.map((l, i) => ({
        id: id(`co:${c.n}:line:${i}`),
        name: l.name,
        description: '',
        quantity: l.qty,
        unit: l.unit,
        unitPrice: l.unitPrice,
        total: l.qty * l.unitPrice,
        isNew: true,
        unitCost: roundCents(l.unitPrice / (1 + MARKUP_PERCENT / 100)),
        csiDivision: c.div,
      })),
      originalContractValue: ORIGINAL_CONTRACT_SUM,
      changeAmount: c.amount,
      newContractTotal: ORIGINAL_CONTRACT_SUM + priorApproved + c.amount,
      priorApprovedChangesTotal: priorApproved,
      ...(c.scheduleDays ? { scheduleImpactDays: c.scheduleDays, scheduleImpactApplied: true } : {}),
      ...(c.task ? { scheduleImpactTaskIds: [id(`task:${c.task}`)], scheduleAnchorTaskId: id(`task:${c.task}`) } : {}),
      status: c.status,
      auditTrail: trail,
      revision: 1,
      createdAt: clock.at(c.day, 10),
      updatedAt: clock.at(c.decidedDay ?? c.day, 15),
    };
  });
}

export function buildLinkedEstimate(id: IdOf, clock: DemoClock): LinkedEstimate {
  return {
    id: id('estimate'),
    items: SOV.map((l) => ({
      materialId: id(`sov:${l.div}`),
      name: l.label,
      category: l.label,
      unit: 'LS',
      quantity: 1,
      unitPrice: l.cost,
      bulkPrice: l.cost,
      markup: MARKUP_PERCENT,
      usesBulk: false,
      lineTotal: scheduledValue(l),
      supplier: '',
      csiDivision: l.div,
    })),
    globalMarkup: MARKUP_PERCENT,
    baseTotal: BASE_COST,
    markupTotal: ORIGINAL_CONTRACT_SUM - BASE_COST,
    grandTotal: ORIGINAL_CONTRACT_SUM,
    createdAt: clock.at(-15, 9),
  };
}

export function buildSchedule(id: IdOf, clock: DemoClock, parts: DemoScheduleParts): ProjectSchedule {
  return {
    id: id('schedule'),
    name: 'Master Schedule',
    projectId: id('project'),
    startDate: clock.startDate,
    workingDaysPerWeek: 5,
    bufferDays: 0,
    tasks: parts.tasks,
    totalDurationDays: parts.finishDay,
    criticalPathDays: parts.finishDay,
    laborAlignmentScore: 84,
    healthScore: 78,
    riskItems: [
      { id: id('risk:1'), title: 'Upper-floor windows are late', detail: LATE.windows.reason, severity: 'high' },
      { id: id('risk:2'), title: 'Drywall is on the critical path', detail: 'One drywall crew moves up the building a floor at a time. A lost day on any floor pushes turnover.', severity: 'medium' },
      { id: id('risk:3'), title: 'Elevator inspection lead time', detail: 'The elevator inspection has to be requested well ahead. Book it as soon as the cars are set.', severity: 'medium' },
    ],
    baseline: { savedAt: clock.at(1, 8), tasks: parts.baseline },
    updatedAt: clock.at(DATA_DAY, 7),
  };
}

export function buildProject(id: IdOf, clock: DemoClock, userId: string): { project: Project; schedule: DemoScheduleParts } {
  const parts = buildDemoTasks(id, clock, (key) => {
    const s = sub(key);
    return { id: subId(id, key), name: s.company };
  });
  const owner = person('owner');
  const project: Project = {
    id: id('project'),
    name: DEMO_PROJECT_NAME,
    type: 'new_build',
    location: JOB.address,
    // Stamped here so the made-up street is never sent to a geocoder.
    locationLatitude: JOB.latitude,
    locationLongitude: JOB.longitude,
    locationGeocodedAt: clock.at(1, 8),
    squareFootage: JOB.grossSquareFeet,
    quality: 'standard',
    description: JOB.description,
    // A name and a 555 number only. No email: nothing on this job can be addressed to a client.
    primaryContact: { name: `${fullName(owner)}, ${JOB.owner}`, phone: owner.phone },
    leadSource: DEMO_LEAD_SOURCE,
    createdAt: clock.at(-15, 9),
    updatedAt: clock.at(DATA_DAY, 7),
    estimate: {
      materials: [],
      labor: [],
      permits: 0,
      overhead: 0,
      contingency: 0,
      materialTotal: 0,
      laborTotal: 0,
      subtotal: BASE_COST,
      tax: 0,
      grandTotal: ORIGINAL_CONTRACT_SUM,
      pricePerSqFt: roundCents(ORIGINAL_CONTRACT_SUM / JOB.grossSquareFeet),
      estimatedDuration: '18 months',
      notes: ['Made-up demo estimate. The schedule of values by CSI division is on the linked estimate.'],
    },
    linkedEstimate: buildLinkedEstimate(id, clock),
    schedule: buildSchedule(id, clock, parts),
    // The job stays OPEN. A closed job is what the cost book learns from.
    status: 'in_progress',
    ownerUserId: userId,
    contractMode: 'fixed',
    retainagePercent: RETAINAGE_PERCENT,
    // Set up, switched OFF, with nobody invited: the portal screen has something to show and nobody can be reached.
    clientPortal: {
      enabled: false,
      portalId: `demo-${id('portal').slice(0, 8)}`,
      showSchedule: true,
      showChangeOrders: true,
      showInvoices: true,
      showPhotos: true,
      showBudgetSummary: false,
      showDailyReports: true,
      showPunchList: true,
      showRFIs: false,
      showDocuments: false,
      welcomeMessage: 'Made-up demo job. This portal is switched off and nobody has been invited.',
      invites: [],
      coApprovalEnabled: false,
      clientCanSetBudget: false,
    },
  };
  return { project, schedule: parts };
}

export { CREW, SUPER_NAME };
