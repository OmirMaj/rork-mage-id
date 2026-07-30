// validate-home-passport-consumer.ts — pins utils/passport/consumerPassport.ts.
//
// The HOMEOWNER-OWNED Home Passport: one home, many jobs, many contractors,
// kept forever. Client-safe by contract — permits / warranties / equipment /
// maintenance / docs and the owner's OWN payment record, never the
// contractor's cost, markup, margin, or job costing.
//
// Run: bun run scripts/validate-home-passport-consumer.ts

import {
  buildConsumerPassport,
  buildPassportHandoff,
  stripMoney,
  DEFAULT_EXPIRING_WITHIN_DAYS,
  DEFAULT_DUE_SOON_WITHIN_DAYS,
  type BuildConsumerPassportInput,
  type ConsumerPassport,
} from '../utils/passport/consumerPassport';
import type {
  Commitment, Invoice, Permit, ProjectDocument, ProjectPhoto,
  SelectionCategory, SelectionOption, Subcontractor, Warranty,
} from '../types';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else    { fail++; console.log('  ✗', name, '\n      got:  ', JSON.stringify(got), '\n      want: ', JSON.stringify(want)); }
}
function expectTrue(name: string, got: boolean) { expect(name, got, true); }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Canary values ───────────────────────────────────────────────────
// Every number below is a CONTRACTOR-INTERNAL figure. None of them may appear
// anywhere in the passport output. Each is unique so a leak is traceable.
const CANARY_COMMITMENT_AMOUNT   = 777777;
const CANARY_COMMITMENT_CHANGE   = 111111;
const CANARY_COMMITMENT_PAID     = 222222;
const CANARY_OPTION_UNIT_PRICE   = 333333;
const CANARY_OPTION_TOTAL        = 444444;
const CANARY_PERMIT_FEE          = 555555;
const CANARY_CLAIM_COST          = 666666;
const CANARY_SELECTION_BUDGET    = 888888;
const ALL_CANARIES = [
  CANARY_COMMITMENT_AMOUNT, CANARY_COMMITMENT_CHANGE, CANARY_COMMITMENT_PAID,
  CANARY_OPTION_UNIT_PRICE, CANARY_OPTION_TOTAL, CANARY_PERMIT_FEE,
  CANARY_CLAIM_COST, CANARY_SELECTION_BUDGET,
];

// The owner's OWN money — this IS allowed through.
const OWNER_BILLED_A = 48000, OWNER_PAID_A = 48000;
const OWNER_BILLED_B = 20000, OWNER_PAID_B = 12000;

// ── Fixtures: one home, two jobs, two eras ──────────────────────────

const NOW = Date.parse('2026-07-30T00:00:00Z');
const ADDRESS = '128 Maple Ave';

const GC = {
  id: 'gc-northstar',
  companyName: 'Northstar Builders',
  contactName: 'Dana Reyes',
  phone: '555-0142',
  email: 'dana@northstar.build',
  licenseNumber: 'GC-88213',
};

const JOB_A = {
  id: 'proj-a', name: 'Kitchen Remodel', location: ADDRESS, type: 'renovation',
  status: 'completed', createdAt: '2025-01-05', substantialCompletionDate: '2025-06-15',
  squareFootage: 2400, contractor: GC,
};
const JOB_B = {
  id: 'proj-b', name: 'Roof Replacement', location: ADDRESS, type: 'roofing',
  status: 'completed', createdAt: '2026-02-01', substantialCompletionDate: '2026-05-20',
  squareFootage: 2400, contractor: GC,
};

function mkWarranty(o: Partial<Warranty>): Warranty {
  return {
    id: 'w', projectId: 'proj-a', projectName: 'Kitchen Remodel', title: 'Warranty',
    category: 'general', provider: 'Provider', startDate: '2025-06-01',
    durationMonths: 120, endDate: '2035-06-01', status: 'active',
    claims: [{ id: 'cl-1', date: '2025-09-01', description: 'Rattle', cost: CANARY_CLAIM_COST }],
    createdAt: '2025-06-01T00:00:00.000Z', updatedAt: '2025-06-01T00:00:00.000Z',
    ...o,
  } as Warranty;
}
const W_HVAC  = mkWarranty({ id: 'w-hvac',  title: 'Trane HVAC',  category: 'hvac',      provider: 'Trane', endDate: '2035-06-01', coverageDetails: 'Compressor and parts', documentUri: 'file://w-hvac.pdf' });
const W_RANGE = mkWarranty({ id: 'w-range', title: 'Wolf Range',  category: 'appliances', provider: 'Wolf',  endDate: '2030-06-01' });
const W_PAINT = mkWarranty({ id: 'w-paint', title: 'Exterior Paint', category: 'finishes', provider: 'SW', startDate: '2024-01-01', endDate: '2025-01-01' });
const W_ROOF  = mkWarranty({ id: 'w-roof',  projectId: 'proj-b', projectName: 'Roof Replacement', title: 'Roof Membrane', category: 'roofing', provider: 'GAF', startDate: '2026-05-20', endDate: '2026-09-15' });

function mkPermit(o: Partial<Permit>): Permit {
  return {
    id: 'pm', projectId: 'proj-a', projectName: 'Kitchen Remodel', type: 'building',
    jurisdiction: 'City of Austin', status: 'approved', appliedDate: '2025-01-10',
    fee: CANARY_PERMIT_FEE, ...o,
  } as Permit;
}
const PM_FINAL = mkPermit({
  id: 'pm-1', permitNumber: 'B-2025-0091', status: 'inspection_passed',
  approvedDate: '2025-02-01', inspectionDate: '2025-06-10', attachmentUri: 'file://pm-1.jpg',
});
const PM_OPEN = mkPermit({
  id: 'pm-2', projectId: 'proj-b', projectName: 'Roof Replacement', type: 'electrical',
  permitNumber: 'E-2026-4410', status: 'approved', appliedDate: '2026-02-10',
  approvedDate: '2026-03-01', expiresDate: '2026-08-20',
});

function mkOption(o: Partial<SelectionOption>): SelectionOption {
  return {
    id: 'opt', categoryId: 'cat', source: 'gc_added', productName: 'Product',
    brand: '', sku: '', description: '', unitPrice: CANARY_OPTION_UNIT_PRICE, unit: 'ea',
    quantity: 1, total: CANARY_OPTION_TOTAL, highlights: [], isChosen: true,
    createdAt: '2025-05-01T00:00:00.000Z', ...o,
  };
}
function mkSelection(o: Partial<SelectionCategory>): SelectionCategory {
  return {
    id: 'cat', projectId: 'proj-a', userId: 'u1', category: 'Category', styleBrief: '',
    budget: CANARY_SELECTION_BUDGET, status: 'chosen', notes: '', displayOrder: 0,
    createdAt: '2025-04-01T00:00:00.000Z', updatedAt: '2025-05-02T00:00:00.000Z',
    options: [mkOption({})], ...o,
  } as SelectionCategory;
}
const SEL_RANGE = mkSelection({
  id: 'cat-range', category: 'Kitchen Range',
  options: [mkOption({
    id: 'opt-range', categoryId: 'cat-range', productName: 'Wolf 36in Gas Range',
    brand: 'Wolf', sku: 'GR366', supplier: 'Ferguson', chosenAt: '2025-05-01',
  })],
});
// No brand AND no model number → decor, not equipment.
const SEL_DECOR = mkSelection({
  id: 'cat-decor', category: 'Wall Paint',
  options: [mkOption({ id: 'opt-decor', categoryId: 'cat-decor', productName: 'Accent Wall Color' })],
});

const SUB: Subcontractor = {
  id: 'sub-1', companyName: 'Volt Bros Electric', contactName: 'Ray Ortiz',
  phone: '555-0100', email: 'ray@voltbros.com', address: '9 Amp Way', trade: 'Electrical',
  licenseNumber: 'E-1234', licenseExpiry: '2027-01-01', coiExpiry: '2027-01-01',
  w9OnFile: true, bidHistory: [], assignedProjects: [], notes: '',
  createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
};

function mkCommitment(o: Partial<Commitment>): Commitment {
  return {
    id: 'com', projectId: 'proj-a', number: 'SC-001', type: 'subcontract',
    description: 'Work', amount: CANARY_COMMITMENT_AMOUNT, changeAmount: CANARY_COMMITMENT_CHANGE,
    paidToDate: CANARY_COMMITMENT_PAID, signedDate: '2025-02-10', status: 'active',
    createdAt: '2025-02-10T00:00:00.000Z', updatedAt: '2025-02-10T00:00:00.000Z', ...o,
  } as Commitment;
}
const COM_TRADE = mkCommitment({
  id: 'com-1', subcontractorId: 'sub-1', phase: 'Rough-in', csiDivision: '26',
  description: `Full electrical rough-in and trim. Subcontract value $${CANARY_COMMITMENT_AMOUNT}.`,
});
const COM_SUPPLY = mkCommitment({
  id: 'com-2', projectId: 'proj-b', type: 'purchase_order', vendorName: 'ABC Supply',
  description: 'Architectural shingles and underlayment', signedDate: '2026-02-15',
});
const COM_DRAFT = mkCommitment({ id: 'com-3', subcontractorId: 'sub-1', status: 'draft' });

function mkPhoto(o: Partial<ProjectPhoto>): ProjectPhoto {
  return {
    id: 'ph', projectId: 'proj-a', uri: 'https://cdn.example/ph.jpg',
    timestamp: '2025-03-12T15:00:00.000Z', tag: 'Kitchen west wall',
    createdAt: '2025-03-12T15:00:00.000Z', ...o,
  };
}
const PHOTO_SHARED = mkPhoto({ id: 'ph-1' });
const PHOTO_DRAFT = mkPhoto({ id: 'ph-2', portalState: { status: 'draft' } });

function mkInvoice(o: Partial<Invoice>): Invoice {
  return {
    id: 'inv', number: 1, projectId: 'proj-a', type: 'full', issueDate: '2025-06-20',
    dueDate: '2025-07-20', paymentTerms: 'net_30', notes: '', lineItems: [],
    subtotal: 0, taxRate: 0, taxAmount: 0, totalDue: 0, amountPaid: 0,
    status: 'paid', payments: [],
    createdAt: '2025-06-20T00:00:00.000Z', updatedAt: '2025-06-20T00:00:00.000Z', ...o,
  } as Invoice;
}
const INV_A = mkInvoice({
  id: 'inv-1', number: 12, totalDue: OWNER_BILLED_A, amountPaid: OWNER_PAID_A,
  payments: [{ id: 'p1', date: '2025-07-01', amount: OWNER_PAID_A, method: 'check' }],
});
const INV_B = mkInvoice({
  id: 'inv-2', number: 13, projectId: 'proj-b', issueDate: '2026-05-25',
  totalDue: OWNER_BILLED_B, amountPaid: OWNER_PAID_B, status: 'partially_paid',
});

const DOCS: ProjectDocument[] = [
  { id: 'doc-1', projectId: 'proj-a', projectName: 'Kitchen Remodel', type: 'other', title: 'As-Built Drawings - Kitchen', status: 'signed', createdAt: '2025-06-20', fileUrl: 'file://asbuilt.pdf' },
  { id: 'doc-2', projectId: 'proj-b', projectName: 'Roof Replacement', type: 'contract', title: 'Roofing Agreement', status: 'signed', createdAt: '2026-02-05' },
  { id: 'doc-3', projectId: 'proj-a', projectName: 'Kitchen Remodel', type: 'permit', title: 'Building permit card', status: 'signed', createdAt: '2025-02-02' },
  { id: 'doc-x', projectId: 'proj-OTHER', projectName: 'Someone else', type: 'other', title: 'Not this home', status: 'signed', createdAt: '2026-01-01' },
];

function fullInput(over: Partial<BuildConsumerPassportInput> = {}): BuildConsumerPassportInput {
  return {
    projects: [JOB_A, JOB_B],
    warranties: [W_HVAC, W_RANGE, W_PAINT, W_ROOF],
    permits: [PM_FINAL, PM_OPEN],
    selections: [SEL_RANGE, SEL_DECOR],
    maintenance: [
      { projectId: 'proj-a', items: [
        { id: 'm1', task: 'HVAC filter replacement', frequency: 'Quarterly', nextDate: '2026-07-01', notes: 'MERV 11+' },
        { id: 'm2', task: 'Range hood filter', frequency: 'Semi-annual', nextDate: '2026-08-10' },
      ] },
      { projectId: 'proj-b', items: [
        { id: 'm3', task: 'Roof inspection', frequency: 'Annual', nextDate: '2027-05-01' },
        { id: 'm4', task: 'Gutter clean-out', frequency: 'Twice a year' },
      ] },
      { projectId: 'proj-OTHER', items: [{ id: 'm9', task: 'Not this home', frequency: 'Annual' }] },
    ],
    commitments: [COM_TRADE, COM_SUPPLY, COM_DRAFT],
    subcontractors: [SUB],
    photos: [PHOTO_SHARED, PHOTO_DRAFT],
    invoices: [INV_A, INV_B],
    documents: DOCS,
    nowMs: NOW,
    ...over,
  };
}

const P: ConsumerPassport = buildConsumerPassport(fullInput());

// ─────────────────────────────────────────────────────────────────────
console.log('\nconsumer passport — totality:');
// ─────────────────────────────────────────────────────────────────────

const empty = buildConsumerPassport({ projects: [], nowMs: NOW });
expect('empty input → no projects', empty.projects.length, 0);
expect('empty input → unknown home id', empty.home.homeId, 'home:unknown');
expect('empty input → empty address', empty.home.address, '');
expect('empty input → no alerts', empty.alerts.length, 0);
expect('empty input → zeroed stats',
  [empty.stats.projectCount, empty.stats.contractorCount, empty.stats.activeWarranties,
   empty.stats.equipmentCount, empty.stats.documentCount, empty.stats.totalPaid],
  [0, 0, 0, 0, 0, 0]);
expect('empty input → onRecordSince null', empty.home.onRecordSince, null);
expect('nowMs is echoed, never sampled', empty.generatedAtMs, NOW);

const noCollections = buildConsumerPassport({ projects: [JOB_A], nowMs: NOW });
expect('projects-only input still yields a home', noCollections.home.address, ADDRESS);
expect('projects-only input → GC still on file', noCollections.contractors.length, 1);

// ─────────────────────────────────────────────────────────────────────
console.log('\nconsumer passport — home identity:');
// ─────────────────────────────────────────────────────────────────────

expect('address derived from the jobs', P.home.address, ADDRESS);
expect('addressKey normalized', P.home.addressKey, '128 maple ave');
expect('homeId is a stable slug of the address', P.home.homeId, 'home:128-maple-ave');
expect('projectCount on the home', P.home.projectCount, 2);
expect('onRecordSince = earliest job date', P.home.onRecordSince, '2025-01-05');
expect('squareFootage inferred from the jobs', P.home.squareFootage, 2400);
expect('explicit home address overrides derivation',
  buildConsumerPassport(fullInput({ home: { address: '9 Cedar Ct', city: 'Austin', state: 'TX' } })).home.address,
  '9 Cedar Ct');
expect('majority address wins when jobs disagree',
  buildConsumerPassport({
    projects: [
      { ...JOB_A, id: 'x1', location: '5 Elm St' },
      { ...JOB_A, id: 'x2', location: ADDRESS },
      { ...JOB_A, id: 'x3', location: ADDRESS },
    ],
    nowMs: NOW,
  }).home.address, ADDRESS);

// ─────────────────────────────────────────────────────────────────────
console.log('\nconsumer passport — projects across jobs:');
// ─────────────────────────────────────────────────────────────────────

expect('both jobs present, newest completion first', P.projects.map((p) => p.id), ['proj-b', 'proj-a']);
expect('both jobs read as completed', P.projects.map((p) => p.state), ['completed', 'completed']);
expect('completion dates carried', P.projects.map((p) => p.completedOn), ['2026-05-20', '2025-06-15']);
expect('every job points at the GC that ran it',
  P.projects.map((p) => p.contractorName), ['Northstar Builders', 'Northstar Builders']);
const projA = P.projects.find((p) => p.id === 'proj-a')!;
expect('owner payment record rolls up per job', [projA.amountBilled, projA.amountPaid], [OWNER_BILLED_A, OWNER_PAID_A]);
expect('per-job record counts', [projA.warrantyCount, projA.permitCount, projA.photoCount], [3, 1, 1]);
const inProgress = buildConsumerPassport({
  projects: [{ id: 'p9', name: 'Bath', location: ADDRESS, status: 'in_progress', createdAt: '2026-06-01' }],
  nowMs: NOW,
});
expect('un-finished job reads in_progress', inProgress.projects[0].state, 'in_progress');
expect('un-finished job is not counted as completed', inProgress.stats.completedProjectCount, 0);

// ─────────────────────────────────────────────────────────────────────
console.log('\nconsumer passport — warranties w/ expiry:');
// ─────────────────────────────────────────────────────────────────────

expect('warranties sorted by soonest expiry', P.warranties.map((w) => w.id), ['w-paint', 'w-roof', 'w-range', 'w-hvac']);
expect('expiry states derived from nowMs', P.warranties.map((w) => w.state),
  ['expired', 'expiring_soon', 'active', 'active']);
expect('daysRemaining is exact and signed',
  P.warranties.find((w) => w.id === 'w-roof')!.daysRemaining, 47);
expectTrue('expired warranty has negative daysRemaining',
  (P.warranties.find((w) => w.id === 'w-paint')!.daysRemaining ?? 0) < 0);
expect('coverage terms carried for the owner',
  P.warranties.find((w) => w.id === 'w-hvac')!.coverageDetails, 'Compressor and parts');
expect('claims surface as a COUNT only (claim cost is internal)',
  P.warranties.find((w) => w.id === 'w-hvac')!.claimCount, 1);
expect('warranty with no end date reads unknown',
  buildConsumerPassport(fullInput({ warranties: [mkWarranty({ id: 'w-none', endDate: '' })] })).warranties[0].state,
  'unknown');
expect('expiry window is caller-tunable',
  buildConsumerPassport(fullInput({ expiringWithinDays: 10 })).warranties.find((w) => w.id === 'w-roof')!.state,
  'active');
expect('DEFAULT_EXPIRING_WITHIN_DAYS is 90', DEFAULT_EXPIRING_WITHIN_DAYS, 90);
expect('other-home warranty excluded',
  buildConsumerPassport(fullInput({ warranties: [mkWarranty({ id: 'w-z', projectId: 'proj-OTHER' })] })).warranties.length, 0);

// ─────────────────────────────────────────────────────────────────────
console.log('\nconsumer passport — permits:');
// ─────────────────────────────────────────────────────────────────────

expect('both permits carried', P.permits.map((p) => p.id).sort(), ['pm-1', 'pm-2']);
expect('finaled permit flagged (resale proof)', P.permits.find((p) => p.id === 'pm-1')!.isFinaled, true);
expect('open permit not flagged', P.permits.find((p) => p.id === 'pm-2')!.isFinaled, false);
expect('permit number + jurisdiction carried',
  [P.permits.find((p) => p.id === 'pm-1')!.permitNumber, P.permits.find((p) => p.id === 'pm-1')!.jurisdiction],
  ['B-2025-0091', 'City of Austin']);
expect('daysUntilExpiry derived from nowMs', P.permits.find((p) => p.id === 'pm-2')!.daysUntilExpiry, 21);
expectTrue('permit fee is never carried onto the passport',
  !Object.prototype.hasOwnProperty.call(P.permits[0], 'fee'));

// ─────────────────────────────────────────────────────────────────────
console.log('\nconsumer passport — equipment w/ model numbers:');
// ─────────────────────────────────────────────────────────────────────

expect('equipment assembled from selections + equipment warranties',
  P.equipment.map((e) => e.name), ['Roof Membrane', 'Trane HVAC', 'Wolf 36in Gas Range']);
const range = P.equipment.find((e) => e.id === 'equipment:selection:cat-range')!;
expect('model number is the part number the owner will need', range.modelNumber, 'GR366');
expect('brand carried', range.brand, 'Wolf');
expect('supplier carried', range.supplier, 'Ferguson');
expect('install date carried', range.installedOn, '2025-05-01');
expect('equipment linked to its warranty', [range.warrantyId, range.warrantyEndDate], ['w-range', '2030-06-01']);
expect('a warranty already represented by a selection is not duplicated',
  P.equipment.filter((e) => e.id === 'equipment:warranty:w-range').length, 0);
expect('non-equipment warranty (finishes) is not equipment',
  P.equipment.filter((e) => e.name === 'Exterior Paint').length, 0);
expect('decor with no brand and no model is not equipment',
  P.equipment.filter((e) => e.id === 'equipment:selection:cat-decor').length, 0);
expect('unchosen selection yields no equipment',
  buildConsumerPassport(fullInput({
    selections: [mkSelection({ id: 'cat-range', options: [mkOption({ brand: 'Wolf', sku: 'GR366', isChosen: false })] })],
  })).equipment.filter((e) => e.source === 'selection').length, 0);

// ─────────────────────────────────────────────────────────────────────
console.log('\nconsumer passport — maintenance schedule:');
// ─────────────────────────────────────────────────────────────────────

expect('maintenance sorted by next due, undated last',
  P.maintenance.map((m) => m.task),
  ['HVAC filter replacement', 'Range hood filter', 'Roof inspection', 'Gutter clean-out']);
expect('due states derived from nowMs',
  P.maintenance.map((m) => m.state), ['overdue', 'due_soon', 'scheduled', 'unscheduled']);
expect('daysUntilDue is exact and signed', P.maintenance.map((m) => m.daysUntilDue), [-29, 11, 275, null]);
expect('maintenance ids are namespaced by project', P.maintenance[0].id, 'maintenance:proj-a:m1');
expect('maintenance carries the job it came from', P.maintenance[0].projectName, 'Kitchen Remodel');
expect('notes carried', P.maintenance[0].notes, 'MERV 11+');
expect('other-home maintenance excluded',
  P.maintenance.filter((m) => m.task === 'Not this home').length, 0);
expect('due-soon window is caller-tunable',
  buildConsumerPassport(fullInput({ dueSoonWithinDays: 5 })).maintenance.find((m) => m.task === 'Range hood filter')!.state,
  'scheduled');
expect('DEFAULT_DUE_SOON_WITHIN_DAYS is 30', DEFAULT_DUE_SOON_WITHIN_DAYS, 30);

// ─────────────────────────────────────────────────────────────────────
console.log('\nconsumer passport — contractors who did the work:');
// ─────────────────────────────────────────────────────────────────────

expect('GC first, then trades, then suppliers',
  P.contractors.map((c) => [c.companyName, c.role]),
  [['Northstar Builders', 'general_contractor'], ['Volt Bros Electric', 'trade'], ['ABC Supply', 'supplier']]);
expect('one GC row spans both jobs',
  P.contractors[0].projectIds, ['proj-a', 'proj-b']);
expect('GC contact info carried for the owner',
  [P.contractors[0].phone, P.contractors[0].email, P.contractors[0].licenseNumber],
  ['555-0142', 'dana@northstar.build', 'GC-88213']);
expect('trade carries its trade + reachable contact',
  [P.contractors[1].trade, P.contractors[1].phone], ['Electrical', '555-0100']);
expectTrue('trade scope survives', P.contractors[1].scopes[0].includes('Full electrical rough-in and trim'));
expectTrue('trade scope is money-scrubbed',
  !P.contractors[1].scopes.join(' ').includes(String(CANARY_COMMITMENT_AMOUNT)));
expect('draft commitment never creates a contractor',
  P.contractors.filter((c) => c.companyName === 'Volt Bros Electric').length, 1);
expect('worked-on dates bracket the GC engagement',
  [P.contractors[0].firstWorkedOn, P.contractors[0].lastWorkedOn], ['2025-01-05', '2026-05-20']);
expect('stripMoney removes dollar figures but keeps the scope',
  stripMoney('Rebuild south deck. Contract $12,400.00 total.'),
  'Rebuild south deck. Contract total.');
expect('stripMoney is a no-op on money-free text',
  stripMoney('Replace roof underlayment'), 'Replace roof underlayment');

// ─────────────────────────────────────────────────────────────────────
console.log('\nconsumer passport — documents, photos, receipts:');
// ─────────────────────────────────────────────────────────────────────

const kinds = P.documents.map((d) => d.kind).sort();
expect('documents span permits, warranties, as-builts, contracts, photos',
  Array.from(new Set(kinds)).sort(), ['as_built', 'contract', 'permit', 'photo', 'warranty']);
expect('as-built detected from the title',
  P.documents.find((d) => d.id === 'document:file:doc-1')!.kind, 'as_built');
expect('permit scan becomes a document', P.documents.filter((d) => d.id === 'document:permit:pm-1').length, 1);
expect('warranty PDF becomes a document', P.documents.filter((d) => d.id === 'document:warranty:w-hvac').length, 1);
expect('unsent photo excluded', P.documents.filter((d) => d.id === 'document:photo:ph-2').length, 0);
expect('shared photo included', P.documents.filter((d) => d.id === 'document:photo:ph-1').length, 1);
expect('other-home document excluded', P.documents.filter((d) => d.id === 'document:file:doc-x').length, 0);
expect('receipts are the owner\'s own invoices, newest first',
  P.receipts.map((r) => r.label), ['Invoice #13', 'Invoice #12']);
expect('paid-in-full flag', P.receipts.map((r) => r.paidInFull), [false, true]);
expect('payment schedule carried', P.receipts.find((r) => r.id === 'receipt:inv-1')!.payments,
  [{ date: '2025-07-01', amountPaid: OWNER_PAID_A, method: 'check' }]);

// ─────────────────────────────────────────────────────────────────────
console.log('\nconsumer passport — alerts + stats:');
// ─────────────────────────────────────────────────────────────────────

expect('alerts ordered by urgency (soonest / most overdue first)',
  P.alerts.map((a) => a.kind),
  ['maintenance_overdue', 'maintenance_due', 'permit_expiring', 'warranty_expiring']);
expect('alert severities', P.alerts.map((a) => a.severity), ['high', 'high', 'high', 'medium']);
expect('alert daysOut', P.alerts.map((a) => a.daysOut), [-29, 11, 21, 47]);
expect('finaled permits never alert', P.alerts.filter((a) => a.id === 'alert:permit:pm-1').length, 0);
expect('expired warranty does not alert (nothing left to do)',
  P.alerts.filter((a) => a.id === 'alert:warranty:w-paint').length, 0);
expect('stats',
  [P.stats.projectCount, P.stats.completedProjectCount, P.stats.contractorCount,
   P.stats.activeWarranties, P.stats.expiringWarranties, P.stats.expiredWarranties,
   P.stats.permitCount, P.stats.finaledPermits, P.stats.equipmentCount,
   P.stats.documentCount, P.stats.photoCount,
   P.stats.maintenanceOverdue, P.stats.maintenanceDueSoon, P.stats.totalPaid],
  [2, 2, 3, 2, 1, 1, 2, 1, 3, 5, 1, 1, 1, OWNER_PAID_A + OWNER_PAID_B]);

// ─────────────────────────────────────────────────────────────────────
console.log('\nconsumer passport — HOMEOWNER SAFETY (no cost / markup / margin):');
// ─────────────────────────────────────────────────────────────────────

function walkKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) { for (const x of v) walkKeys(x, out); return out; }
  if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out.push(k);
      walkKeys(val, out);
    }
  }
  return out;
}

// Any key naming a contractor-internal money concept is a hard fail.
const BANNED_KEY_SUBSTRING = /cost|markup|margin|profit|overhead|burden|unitprice|committed|budget|wholesale|payable|gmp|retain/;
const BANNED_KEY_EXACT = new Set(['fee', 'fees', 'bid', 'rate', 'dailyrate', 'amount', 'total', 'subtotal', 'price', 'taxrate']);

const allKeys = Array.from(new Set(walkKeys(P))).sort();
const bannedHits = allKeys.filter((k) => {
  const lower = k.toLowerCase();
  return BANNED_KEY_SUBSTRING.test(lower) || BANNED_KEY_EXACT.has(lower);
});
expect('NO cost/markup/margin field can appear in the output (key scan)', bannedHits, []);
expectTrue('key scan actually walked the object (sanity)', allKeys.length > 40);
expectTrue('key scan would catch a planted violation',
  walkKeys({ a: [{ b: { markupPercent: 1 } }] }).includes('markupPercent'));

// Value canary: every contractor-internal number fed in must be absent from
// the serialized passport, no matter what field it might have ridden in on.
const serialized = JSON.stringify(P);
const leaked = ALL_CANARIES.filter((n) => serialized.includes(String(n)));
expect('NO contractor-internal figure leaks by value (canary scan)', leaked, []);
expectTrue('canary scan is meaningful — the fixtures really carried them',
  [COM_TRADE.amount, COM_TRADE.changeAmount, COM_TRADE.paidToDate,
   SEL_RANGE.options![0].unitPrice, SEL_RANGE.options![0].total,
   PM_FINAL.fee, W_HVAC.claims[0].cost, SEL_RANGE.budget]
    .every((n) => ALL_CANARIES.includes(n as number)));

// The owner's OWN money is allowed — and must actually be there.
expectTrue('the owner\'s own payment record IS present', serialized.includes(String(OWNER_PAID_A)));
expect('lifetime owner spend across every contractor', P.stats.totalPaid, OWNER_PAID_A + OWNER_PAID_B);

// ─────────────────────────────────────────────────────────────────────
console.log('\nconsumer passport — purity + determinism:');
// ─────────────────────────────────────────────────────────────────────

const src = readFileSync(join(ROOT, 'utils/passport/consumerPassport.ts'), 'utf8');
// Comments talk ABOUT Date.now / fetch; only real code counts.
const code = src
  .split('\n')
  .filter((l) => { const s = l.trim(); return !(s.startsWith('//') || s.startsWith('*') || s.startsWith('/*')); })
  .join('\n');
expectTrue('engine never samples the clock itself', !/Date\.now\s*\(/.test(code));
expectTrue('engine never uses Math.random', !/Math\.random\s*\(/.test(code));
expectTrue('engine imports no React', !/from\s+['"]react/.test(code));
expectTrue('engine imports no network / storage client',
  !/(from\s+['"]@?\/?lib\/supabase)|(AsyncStorage)|(\bfetch\s*\()/.test(code));
expectTrue('engine has only type-only imports (bun-runnable)',
  code.split('\n').filter((l) => /^import\s/.test(l)).every((l) => /^import type\s/.test(l)));
expectTrue('purity scan is meaningful — it still sees real code', code.includes('buildConsumerPassport'));

const runA = buildConsumerPassport(fullInput());
const runB = buildConsumerPassport(fullInput());
expect('re-generation is byte-identical', JSON.stringify(runA), JSON.stringify(runB));
expect('shuffled input order yields the same passport',
  JSON.stringify(buildConsumerPassport(fullInput({
    projects: [JOB_B, JOB_A],
    warranties: [W_ROOF, W_PAINT, W_HVAC, W_RANGE],
    permits: [PM_OPEN, PM_FINAL],
  })).warranties.map((w) => w.id)),
  JSON.stringify(P.warranties.map((w) => w.id)));
expect('a later clock moves the states, not the records',
  buildConsumerPassport(fullInput({ nowMs: Date.parse('2027-01-01T00:00:00Z') })).warranties.map((w) => w.state),
  ['expired', 'expired', 'active', 'active']);

// ─────────────────────────────────────────────────────────────────────
console.log('\nconsumer passport — handoff brief (the wedge):');
// ─────────────────────────────────────────────────────────────────────

const handoff = buildPassportHandoff(P);
expectTrue('handoff names the home', handoff.includes(ADDRESS));
expectTrue('handoff lists the work history', handoff.includes('Kitchen Remodel') && handoff.includes('Roof Replacement'));
expectTrue('handoff lists live warranties', handoff.includes('Trane HVAC'));
expectTrue('handoff lists model numbers', handoff.includes('GR366'));
expectTrue('handoff lists finaled permits', handoff.includes('B-2025-0091'));
expectTrue('handoff states owner ownership', handoff.toLowerCase().includes('belongs to the homeowner'));
expectTrue('handoff carries NO money at all', !handoff.includes('$'));
expectTrue('handoff carries no canary figure', ALL_CANARIES.every((n) => !handoff.includes(String(n))));
expect('empty passport still produces a handoff header',
  buildPassportHandoff(empty).split('\n')[0], 'HOME PASSPORT — this home');

// ─────────────────────────────────────────────────────────────────────
console.log('\ncomponents/passport design-system compliance:');
// ─────────────────────────────────────────────────────────────────────

function walkDir(dir: string): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return []; }
  const out: string[] = [];
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkDir(full));
    else if (name.endsWith('.tsx') || name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const uiFiles = walkDir(join(ROOT, 'components/passport'));
expectTrue('components/passport ships at least one component', uiFiles.length > 0);

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
const RAW_HEX = /#[0-9A-Fa-f]{3,8}\b/;
const INLINE_FONT_SIZE = /fontSize:\s*\d/;
type UiHit = { file: string; line: number; text: string };
const uiHits: Record<string, UiHit[]> = { emoji: [], hex: [], fontSize: [] };
for (const file of uiFiles) {
  readFileSync(file, 'utf8').split('\n').forEach((text, i) => {
    const trimmed = text.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    const hit: UiHit = { file: relative(ROOT, file), line: i + 1, text: trimmed };
    if (EMOJI.test(text)) uiHits.emoji.push(hit);
    if (RAW_HEX.test(text)) uiHits.hex.push(hit);
    if (INLINE_FONT_SIZE.test(text)) uiHits.fontSize.push(hit);
  });
}
expect('no emoji in components/passport', uiHits.emoji, []);
expect('no raw hex colors in components/passport', uiHits.hex, []);
expect('no inline fontSize literals in components/passport', uiHits.fontSize, []);

const uiSrc = uiFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
expectTrue('UI uses the theme system', uiSrc.includes('useTheme') || uiSrc.includes('ThemeColors'));
expectTrue('UI uses the typography tokens', uiSrc.includes("from '@/constants/typography'"));
expectTrue('UI uses the design tokens', uiSrc.includes("from '@/constants/designTokens'"));
expectTrue('UI uses lucide icons', uiSrc.includes("from 'lucide-react-native'"));

// ─────────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
