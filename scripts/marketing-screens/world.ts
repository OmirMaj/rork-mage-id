// scripts/marketing-screens/world.ts: the one made-up job every screen shows.
//
// Example Builders is renovating the kitchen and hall bath at 14 Alder Street
// for a made-up client. Nobody here is a real person, the address is not a
// real address, the phone numbers are in the 555-01xx range kept for fiction
// and every email is @example.com. The numbers agree from screen to screen
// because every screen reads them from this one file: the estimate total is
// the contract sum on the pay application, the change order adds to that same
// sum, the daily report is dated inside the schedule's week.
//
// Like __tests__/fixtures/world.ts this seeds the device's storage (the app
// is offline-first and reads its mageid_* copies first), and hands the
// stand-in backend the rows a synced account would get back.
import type { ServerWorld } from './server';

export const TIMEZONE = 'America/New_York';
/** "Now" for every shot: Thursday 8 October 2026, 9:41 in the morning. */
export const NOW_ISO = '2026-10-08T09:41:00-04:00';
const NOW = new Date(NOW_ISO);
const day = (offset: number, hour = 12) => { const d = new Date(NOW.getTime() + offset * 86_400_000); d.setUTCHours(hour + 4, 0, 0, 0); return d.toISOString(); };
const dayOnly = (offset: number) => new Date(NOW.getTime() + offset * 86_400_000 - 4 * 3_600_000).toISOString().slice(0, 10);

export const USER = { id: 'a1e00000-0000-4000-8000-000000000001', email: 'robin@examplebuilders.example.com', name: 'Robin Vale', company: 'Example Builders' };
export const CLIENT = { name: 'Casey Linden', email: 'casey.linden@example.com', phone: '(555) 555-0142' };
export const P = { alder: 'b2e00000-0000-4000-8000-000000000001', birch: 'b2e00000-0000-4000-8000-000000000002', cedar: 'b2e00000-0000-4000-8000-000000000003' };

export interface WorldOptions {
  /** Which plan the account is on. */
  tier?: 'free' | 'pro' | 'business';
  /** Edge function answers for this shot (fixtures; no model is called). */
  functions?: Record<string, unknown | ((body: any) => unknown)>;
  /** Per-shot changes to the seeded storage, applied last. */
  patch?: (storage: Record<string, unknown>) => void;
}

export interface World {
  storage: Record<string, string>;
  server: ServerWorld;
  /** Canned answers for requests that would leave the machine. */
  outside: { match: string; body: unknown; type?: string }[];
}

// ---------------------------------------------------------------------------
// The estimate. lineTotal = unit price x (1 + markup) x quantity, and the
// grand total is the sum of the lines (utils/applyCalibration.ts).
// ---------------------------------------------------------------------------
type Line = { materialId: string; name: string; category: string; unit: string; quantity: number; unitPrice: number; markup: number; supplier: string; csiDivision: string; priceSource?: 'learned' | 'seeded' | 'regional' };
const LINES: Line[] = [
  { materialId: 'ln-demo', name: 'Selective demolition, kitchen and hall bath', category: 'labor', unit: 'LS', quantity: 1, unitPrice: 4200, markup: 15, supplier: 'In-house', csiDivision: '02', priceSource: 'learned' },
  { materialId: 'ln-frame', name: 'Framing, open wall to dining room with new header', category: 'labor', unit: 'HR', quantity: 64, unitPrice: 75, markup: 15, supplier: 'In-house', csiDivision: '06', priceSource: 'learned' },
  { materialId: 'ln-plumb', name: 'Plumbing rough and trim (sub)', category: 'subcontractor', unit: 'LS', quantity: 1, unitPrice: 9800, markup: 10, supplier: 'Sample Plumbing Co.', csiDivision: '22' },
  { materialId: 'ln-elec', name: 'Electrical rough and trim, 6 new circuits (sub)', category: 'subcontractor', unit: 'LS', quantity: 1, unitPrice: 11400, markup: 10, supplier: 'Sample Electric Co.', csiDivision: '26' },
  { materialId: 'ln-drywall', name: 'Drywall, hang and finish level 4', category: 'labor', unit: 'SF', quantity: 1150, unitPrice: 3.2, markup: 15, supplier: 'In-house', csiDivision: '09', priceSource: 'learned' },
  { materialId: 'ln-cab', name: 'Cabinets, painted maple, 22 linear feet', category: 'millwork', unit: 'LF', quantity: 22, unitPrice: 720, markup: 12, supplier: 'Sample Cabinet Shop', csiDivision: '12' },
  { materialId: 'ln-counter', name: 'Quartz countertops, installed', category: 'stone', unit: 'SF', quantity: 58, unitPrice: 92, markup: 15, supplier: 'Sample Stone Yard', csiDivision: '12' },
  { materialId: 'ln-tile', name: 'Tile, bath floor and shower walls', category: 'labor', unit: 'SF', quantity: 210, unitPrice: 18, markup: 15, supplier: 'In-house', csiDivision: '09', priceSource: 'learned' },
  { materialId: 'ln-paint', name: 'Paint, walls and ceilings, 2 coats', category: 'labor', unit: 'SF', quantity: 1900, unitPrice: 2.1, markup: 15, supplier: 'In-house', csiDivision: '09', priceSource: 'seeded' },
  { materialId: 'ln-trim', name: 'Trim carpentry and finish hardware', category: 'labor', unit: 'LS', quantity: 1, unitPrice: 3600, markup: 15, supplier: 'In-house', csiDivision: '06' },
];
const cents = (n: number) => Math.round(n * 100) / 100;
export const estimateItems = LINES.map((l) => ({ ...l, bulkPrice: l.unitPrice, usesBulk: false, lineTotal: cents(l.unitPrice * (1 + l.markup / 100) * l.quantity) }));
export const BASE_TOTAL = cents(LINES.reduce((s, l) => s + l.unitPrice * l.quantity, 0));
export const CONTRACT_SUM = cents(estimateItems.reduce((s, l) => s + l.lineTotal, 0));
const linkedEstimate = { id: 'c3e00000-0000-4000-8000-000000000001', items: estimateItems, globalMarkup: 15, baseTotal: BASE_TOTAL, markupTotal: cents(CONTRACT_SUM - BASE_TOTAL), grandTotal: CONTRACT_SUM, createdAt: day(-52) };

// ---------------------------------------------------------------------------
// The jobs
// ---------------------------------------------------------------------------
const alder = {
  id: P.alder, name: '14 Alder Street, kitchen and bath', type: 'renovation', location: '14 Alder Street, Sampleton, NY',
  locationLatitude: 41.2, locationLongitude: -74.1, locationGeocodedAt: day(-60), squareFootage: 640, quality: 'standard',
  description: 'Kitchen opened to the dining room, new cabinets and counters, hall bath rebuilt with a tiled shower.',
  primaryContact: { name: CLIENT.name, phone: CLIENT.phone, email: CLIENT.email }, leadSource: 'referral',
  createdAt: day(-60), updatedAt: day(-1), estimate: null, linkedEstimate, status: 'in_progress', collaborators: [],
  photoCount: 0, contractMode: 'fixed', retainagePercent: 10, retainagePercentAssumed: false, handoverChecklist: {},
};
const birch = {
  id: P.birch, name: '27 Birch Lane, basement finish', type: 'renovation', location: '27 Birch Lane, Sampleton, NY', squareFootage: 780, quality: 'standard',
  description: 'Finish the basement: framing, egress window, bath rough-in, LVP floor.',
  primaryContact: { name: 'Morgan Ashby', phone: '(555) 555-0117', email: 'morgan.ashby@example.com' },
  createdAt: day(-21), updatedAt: day(-3), estimate: null, linkedEstimate: null, status: 'estimated', collaborators: [], photoCount: 0, contractMode: 'fixed', handoverChecklist: {},
};
const cedar = {
  id: P.cedar, name: '5 Cedar Court, deck and porch', type: 'renovation', location: '5 Cedar Court, Sampleton, NY', squareFootage: 320, quality: 'standard',
  description: 'Replace the rear deck, rebuild the porch steps and railings.',
  primaryContact: { name: 'Jamie Okoro', phone: '(555) 555-0163', email: 'jamie.okoro@example.com' },
  createdAt: day(-130), updatedAt: day(-34), estimate: null, linkedEstimate: null, status: 'completed', collaborators: [], photoCount: 0, contractMode: 'fixed', handoverChecklist: {},
};

const settings = {
  location: 'Sampleton, NY', units: 'imperial', taxRate: 0, contingencyRate: 0,
  branding: { companyName: USER.company, contactName: USER.name, email: USER.email, phone: '(555) 555-0100', address: '100 Sample Road, Sampleton, NY', licenseNumber: 'HIC-000000', tagline: '' },
};


// ---------------------------------------------------------------------------
// The schedule: ten working weeks from Monday 31 August 2026. Start days are
// working-day numbers (day 1 = 31 August), so "today" is day 29.
// ---------------------------------------------------------------------------
import { buildScheduleFromTasks } from '@/utils/scheduleEngine';
export const SCHEDULE_START = '2026-08-31';
type T = [id: string, title: string, phase: string, start: number, dur: number, progress: number, deps: string[], crew: string, trade: string];
const TASKS: T[] = [
  ['t-demo', 'Demolition', 'Demo', 1, 4, 100, [], 'Example Builders', 'demo'],
  ['t-frame', 'Framing and new header', 'Framing', 5, 5, 100, ['t-demo'], 'Example Builders', 'framing'],
  ['t-plumb', 'Plumbing rough', 'Rough-In', 10, 4, 100, ['t-frame'], 'Sample Plumbing Co.', 'plumbing'],
  ['t-elec', 'Electrical rough', 'Rough-In', 10, 5, 100, ['t-frame'], 'Sample Electric Co.', 'electrical'],
  ['t-insp', 'Rough inspections', 'Inspections', 15, 1, 100, ['t-plumb', 't-elec'], 'Example Builders', 'general'],
  ['t-insul', 'Insulation', 'Drywall', 16, 2, 100, ['t-insp'], 'Example Builders', 'general'],
  ['t-dry', 'Drywall, hang and finish', 'Drywall', 18, 8, 100, ['t-insul'], 'Example Builders', 'finish'],
  ['t-prime', 'Prime and first coat', 'Finishes', 26, 3, 100, ['t-dry'], 'Example Builders', 'finish'],
  ['t-tile', 'Tile, bath floor and shower', 'Finishes', 26, 7, 40, ['t-dry'], 'Example Builders', 'finish'],
  ['t-cab', 'Cabinet install', 'Finishes', 29, 4, 10, ['t-prime'], 'Example Builders', 'finish'],
  ['t-counter', 'Countertop template and install', 'Finishes', 33, 6, 0, ['t-cab'], 'Sample Stone Yard', 'finish'],
  ['t-trimout', 'Plumbing and electrical trim', 'Finishes', 39, 4, 0, ['t-counter'], 'Sample Plumbing Co.', 'plumbing'],
  ['t-finish', 'Finish paint and trim carpentry', 'Finishes', 43, 5, 0, ['t-trimout'], 'Example Builders', 'finish'],
  ['t-final', 'Final inspection', 'Inspections', 48, 1, 0, ['t-finish'], 'Example Builders', 'closeout'],
  ['t-punch', 'Punch list and handover', 'Closeout', 49, 2, 0, ['t-final'], 'Example Builders', 'closeout'],
];
const scheduleTasks = TASKS.map(([id, title, phase, startDay, durationDays, progress, dependencies, crew, tradeKey]) => ({
  id, title, phase, startDay, durationDays, progress, crew, crewSize: crew === 'Example Builders' ? 3 : 2, dependencies, notes: '',
  status: progress >= 100 ? 'done' : progress > 0 ? 'in_progress' : 'not_started', tradeKey,
  baselineStartDay: startDay, baselineEndDay: startDay + durationDays - 1,
}));
const schedule = { ...buildScheduleFromTasks('14 Alder Street schedule', P.alder, scheduleTasks as never, null, { startDate: SCHEDULE_START }), id: 'd4e00000-0000-4000-8000-000000000001', updatedAt: day(-1) };

// ---------------------------------------------------------------------------
// Change orders. CO 1 was found at demolition; CO 2 is the client's add.
// ---------------------------------------------------------------------------
export const CO1_AMOUNT = 1480;
export const CO2_AMOUNT = 1860;
const approver = (status: 'pending' | 'approved', when?: string) => [{ id: 'ap-1', name: CLIENT.name, email: CLIENT.email, role: 'Client', required: true, order: 1, status, ...(when ? { responseDate: when } : {}) }];
const co1 = {
  id: 'e5e00000-0000-4000-8000-000000000001', number: 1, projectId: P.alder, date: day(-34),
  description: 'Replace rotted subfloor at the tub', reason: 'Found at demolition: the subfloor under the old tub was soft across about 24 square feet.',
  lineItems: [
    { id: 'co1-a', name: 'Remove and replace subfloor, 3/4 in. plywood', description: '', quantity: 24, unit: 'SF', unitPrice: 35, total: 840, isNew: true },
    { id: 'co1-b', name: 'Sister two floor joists', description: '', quantity: 8, unit: 'HR', unitPrice: 80, total: 640, isNew: true },
  ],
  originalContractValue: CONTRACT_SUM, changeAmount: CO1_AMOUNT, newContractTotal: cents(CONTRACT_SUM + CO1_AMOUNT), scheduleImpactDays: 0,
  status: 'approved', approvers: approver('approved', day(-32)), approvalMode: 'sequential', priorApprovedChangesTotal: 0, revision: 1,
  auditTrail: [
    { id: 'co1-au1', action: 'created', actor: USER.name, timestamp: day(-34) },
    { id: 'co1-au2', action: 'submitted', actor: USER.name, timestamp: day(-34, 15) },
    { id: 'co1-au3', action: 'approved', actor: CLIENT.name, timestamp: day(-32) },
  ],
  createdAt: day(-34), updatedAt: day(-32),
};
export function co2(status: 'draft' | 'submitted' | 'approved') {
  return {
    id: 'e5e00000-0000-4000-8000-000000000002', number: 2, projectId: P.alder, date: day(-9),
    description: 'Add under-cabinet lighting and move the range outlet', reason: 'Client request after the cabinet layout walk.',
    lineItems: [
      { id: 'co2-a', name: 'LED under-cabinet lighting, 18 linear feet, with dimmer', description: '', quantity: 18, unit: 'LF', unitPrice: 65, total: 1170, isNew: true },
      { id: 'co2-b', name: 'Move the range outlet 30 in. to the left', description: '', quantity: 1, unit: 'LS', unitPrice: 450, total: 450, isNew: true },
      { id: 'co2-c', name: 'Patch and repaint the wall at the old outlet', description: '', quantity: 3, unit: 'HR', unitPrice: 80, total: 240, isNew: true },
    ],
    originalContractValue: cents(CONTRACT_SUM + CO1_AMOUNT), changeAmount: CO2_AMOUNT, newContractTotal: cents(CONTRACT_SUM + CO1_AMOUNT + CO2_AMOUNT), scheduleImpactDays: 1,
    status, approvers: approver(status === 'approved' ? 'approved' : 'pending', status === 'approved' ? day(-6) : undefined), approvalMode: 'sequential',
    priorApprovedChangesTotal: CO1_AMOUNT, revision: 1,
    auditTrail: [
      { id: 'co2-au1', action: 'created', actor: USER.name, timestamp: day(-9) },
      ...(status !== 'draft' ? [{ id: 'co2-au2', action: 'submitted', actor: USER.name, timestamp: day(-8) }] : []),
      ...(status === 'approved' ? [{ id: 'co2-au3', action: 'approved', actor: CLIENT.name, timestamp: day(-6) }] : []),
    ],
    createdAt: day(-9), updatedAt: status === 'approved' ? day(-6) : day(-8),
  };
}
export const REVISED_CONTRACT = cents(CONTRACT_SUM + CO1_AMOUNT + CO2_AMOUNT);

// ---------------------------------------------------------------------------
// Invoices: one progress bill so far, made from the estimate's lines (the app's
// Bill from Estimate), 10% retainage held as the contract says. Each line
// carries the percent of that estimate line billed on this invoice, which is
// what the pay application reads its schedule of values from.
// ---------------------------------------------------------------------------
const RETAINAGE = 10;
const bill = (n: number, issued: number, paidOn: number | null, notes: string, parts: [materialId: string, pct: number][]) => {
  const lineItems = parts.map(([materialId, pct], i) => {
    const src = estimateItems.find((e) => e.materialId === materialId)!;
    return { id: `inv${n}-${i + 1}`, name: src.name, description: `${pct}% of ${src.name.toLowerCase()}`, quantity: 1, unit: 'LS', unitPrice: cents(src.lineTotal * pct / 100), total: cents(src.lineTotal * pct / 100), sourceEstimateItemId: materialId, billedPercent: pct };
  });
  const subtotal = cents(lineItems.reduce((t, l) => t + l.total, 0));
  const retentionAmount = cents(subtotal * RETAINAGE / 100);
  const net = cents(subtotal - retentionAmount);
  return {
    id: `f6e00000-0000-4000-8000-00000000000${n}`, number: n, projectId: P.alder, type: 'progress', progressPercent: Math.round(subtotal / CONTRACT_SUM * 100), issueDate: day(issued), dueDate: day(issued + 15), paymentTerms: 'net_15', notes,
    lineItems, subtotal, taxRate: 0, taxAmount: 0, totalDue: subtotal, amountPaid: paidOn == null ? 0 : net, status: paidOn == null ? 'sent' : 'paid',
    payments: paidOn == null ? [] : [{ id: `pay-${n}`, date: day(paidOn), amount: net, method: 'check', reference: 'Check 1042' }],
    retentionPercent: RETAINAGE, retentionAmount, retentionReleased: 0, retentionReleases: [], billToName: CLIENT.name, billToEmail: CLIENT.email, createdAt: day(issued), updatedAt: day(paidOn ?? issued),
  };
};
export const invoice1 = bill(1, -6, null, 'Pay application 1: work from 31 August through 30 September.', [['ln-demo', 100], ['ln-frame', 100], ['ln-plumb', 60], ['ln-elec', 60], ['ln-drywall', 60]]);
const invoices = [invoice1];

// ---------------------------------------------------------------------------
// Daily reports. Weather on a filed report is the reading the app stored with
// it (source 'openweather' and the time it was read).
// ---------------------------------------------------------------------------
const reading = (offset: number, temperature: string, conditions: string, wind: string, hour: number) => ({ temperature, conditions, wind, isManual: false, source: 'openweather', readAt: day(offset, hour), readDay: dayOnly(offset), readOffsetMin: -240 });
export const yesterdayReport = {
  id: '07e00000-0000-4000-8000-000000000001', projectId: P.alder, date: dayOnly(-1), weather: reading(-1, '61°F', 'Partly cloudy', '7 mph NW', 15),
  manpower: [
    { id: 'mp-1', trade: 'Carpentry', company: 'Example Builders', headcount: 2, hoursWorked: 16 },
    { id: 'mp-2', trade: 'Tile', company: 'Example Builders', headcount: 1, hoursWorked: 8 },
    { id: 'mp-3', trade: 'Painting', company: 'Example Builders', headcount: 1, hoursWorked: 6 },
  ],
  workPerformed: 'First coat finished in the kitchen and dining room. Shower walls tiled to 5 feet, floor tile set and ready for grout. Cabinets delivered at 2 PM, checked against the order and staged in the dining room.',
  workProgress: [
    { taskId: 't-prime', taskName: 'Prime and first coat', phase: 'Finishes', pct: 100 },
    { taskId: 't-tile', taskName: 'Tile, bath floor and shower', phase: 'Finishes', pct: 40 },
  ],
  materialsDelivered: ['Cabinets, 14 boxes (Sample Cabinet Shop)', 'Grout, 2 bags'],
  issuesAndDelays: 'One base cabinet (B24) arrived with a cracked side panel. Photo sent to the shop, replacement due Monday. Does not hold up the install.',
  photos: [], status: 'sent', createdAt: day(-1, 16), updatedAt: day(-1, 16),
};
const dailyReports = [
  yesterdayReport,
  { id: '07e00000-0000-4000-8000-000000000002', projectId: P.alder, date: dayOnly(-2), weather: reading(-2, '58°F', 'Light rain', '10 mph S', 15), manpower: [{ id: 'mp-4', trade: 'Painting', company: 'Example Builders', headcount: 2, hoursWorked: 16 }, { id: 'mp-5', trade: 'Tile', company: 'Example Builders', headcount: 1, hoursWorked: 8 }], workPerformed: 'Primer on all new drywall. Shower pan flood test held overnight, tile started on the bath floor.', workProgress: [{ taskId: 't-prime', taskName: 'Prime and first coat', phase: 'Finishes', pct: 60 }, { taskId: 't-tile', taskName: 'Tile, bath floor and shower', phase: 'Finishes', pct: 20 }], materialsDelivered: ['Floor tile, 12 boxes'], issuesAndDelays: '', photos: [], status: 'sent', createdAt: day(-2, 16), updatedAt: day(-2, 16) },
  { id: '07e00000-0000-4000-8000-000000000003', projectId: P.alder, date: dayOnly(-3), weather: reading(-3, '64°F', 'Clear', '5 mph W', 15), manpower: [{ id: 'mp-6', trade: 'Drywall', company: 'Example Builders', headcount: 2, hoursWorked: 14 }], workPerformed: 'Final sand and touch-up on drywall. Dust control down, site cleaned for paint.', workProgress: [{ taskId: 't-dry', taskName: 'Drywall, hang and finish', phase: 'Drywall', pct: 100 }], materialsDelivered: [], issuesAndDelays: '', photos: [], status: 'sent', createdAt: day(-3, 16), updatedAt: day(-3, 16) },
];

// ---------------------------------------------------------------------------
// Punch items. The pictures are flat tinted tiles, not photographs: nothing
// here pretends to be a site photo.
// ---------------------------------------------------------------------------
export const tile = (tint: string, ink = 'rgba(255,255,255,0.55)') => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="450" viewBox="0 0 600 450"><rect width="600" height="450" fill="${tint}"/><g fill="none" stroke="${ink}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" transform="translate(252 177)"><path d="M10 28h18l9-13h22l9 13h18a8 8 0 0 1 8 8v44a8 8 0 0 1-8 8H10a8 8 0 0 1-8-8V36a8 8 0 0 1 8-8z"/><circle cx="48" cy="56" r="15"/></g></svg>`);
const punch = (n: number, description: string, location: string, assignedSub: string, priority: string, status: string, due: number, tint: string, extra: Record<string, unknown> = {}) => ({
  id: `08e00000-0000-4000-8000-00000000000${n}`, projectId: P.alder, description, location, assignedSub, dueDate: dayOnly(due), priority, status, photoUri: tile(tint), listType: 'punch', createdAt: day(-4 + n * 0.1), updatedAt: day(-2), ...extra,
});
const punchItems = [
  punch(1, 'Drywall seam shows at the dining room opening in raking light', 'Dining room', 'Example Builders', 'medium', 'open', 4, '#8FA39A'),
  punch(2, 'Outlet box sits proud of the backsplash line, left of the range', 'Kitchen', 'Sample Electric Co.', 'high', 'in_progress', 2, '#A8977F'),
  punch(3, 'Shower valve trim not centered on the tile joint', 'Hall bath', 'Sample Plumbing Co.', 'medium', 'open', 5, '#7F96A8'),
  punch(4, 'Paint holiday on the ceiling above the pantry door', 'Kitchen', 'Example Builders', 'low', 'ready_for_review', 3, '#A39FB0', { afterPhotoUri: tile('#9DB5A2'), afterPhotoTakenAt: day(-1, 14) }),
  punch(5, 'Door stop missing at the bath door', 'Hall bath', 'Example Builders', 'low', 'closed', -1, '#B0A58F', { closedAt: day(-1), afterPhotoUri: tile('#9DB5A2'), afterPhotoTakenAt: day(-1, 11) }),
];

const PORTAL_ID = '09e00000-0000-4000-8000-000000000001';
const clientPortal = {
  enabled: true, portalId: PORTAL_ID, accessToken: 'marketing-screens-portal', requirePasscode: false, showSchedule: true, showChangeOrders: true, showInvoices: true, showPhotos: true,
  showBudgetSummary: true, showDailyReports: true, showPunchList: true, showRFIs: false, showDocuments: true, coApprovalEnabled: true,
  welcomeMessage: 'Hi Casey. Updates land here every Friday afternoon.',
};
export { PORTAL_ID };

const TUTORIAL_IDS = ['daily-report-voice', 'punch-walk', 'invoice-to-self', 'schedule-say-it', 'client-portal-preview', 'first-bid-coach', 'estimate-first', 'change-order-draft', 'field-ticket-log', 'takeoff-to-estimate', 'ask-your-plans', 'construction-ai-ask', 'time-clock-in', 'punch-list-close', 'contract-from-estimate', 'pay-app-period', 'closeout-binder'];

// What the weather service answers (the shape of the weather-forecast relay,
// which is OpenWeather's own). A fixture: a mild, dry October week.
const nowSec = Math.floor(NOW.getTime() / 1000);
const WEATHER_NOW = { cod: '200', kind: 'current', dt: nowSec - 300, name: 'Sampleton', main: { temp: 57.4 }, weather: [{ main: 'Clouds', description: 'scattered clouds' }], wind: { speed: 6.2, deg: 315 } };
const WEATHER_FORECAST = {
  cod: '200', city: { name: 'Sampleton', timezone: -14400 },
  list: Array.from({ length: 40 }, (_, i) => {
    const dt = nowSec + i * 10800; const d = Math.floor(i / 8); const rain = d === 3;
    return { dt, dt_txt: new Date(dt * 1000).toISOString().slice(0, 19).replace('T', ' '), main: { temp_max: 62 - d * 1.5 + (i % 8 < 4 ? 0 : 3), temp_min: 48 - d }, weather: [rain ? { main: 'Rain', description: 'light rain' } : { main: 'Clouds', description: 'scattered clouds' }], wind: { speed: 6 + d }, pop: rain ? 0.7 : 0.1 };
  }),
};

/** A session the app's Supabase client reads from storage. The token is a
 *  made-up, unsigned string: the only thing that ever sees it is server.ts. */
function session() {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(NOW.getTime() / 1000) + 3600 * 24 * 365;
  const user = {
    id: USER.id, aud: 'authenticated', role: 'authenticated', email: USER.email, email_confirmed_at: day(-200), phone: '', confirmed_at: day(-200), last_sign_in_at: day(-1),
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: { full_name: USER.name, name: USER.name, company_name: USER.company }, identities: [], created_at: day(-200), updated_at: day(-1),
  };
  const access_token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: USER.id, email: USER.email, role: 'authenticated', aud: 'authenticated', exp, iat: exp - 3600 })}.marketing-screens-stand-in`;
  return { access_token, refresh_token: 'marketing-screens-stand-in', token_type: 'bearer', expires_in: 3600 * 24 * 365, expires_at: exp, user };
}

const snake = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), v]));

export function buildWorld(opts: WorldOptions = {}): World {
  const tier = opts.tier ?? 'business';
  const s = session();
  const data: Record<string, unknown> = {
    mageid_projects: [{ ...alder, schedule, clientPortal }, birch, cedar],
    mageid_settings: settings,
    mageid_change_orders: [co2('approved'), co1],
    mageid_invoices: invoices,
    mageid_daily_reports: dailyReports,
    mageid_punch_items: punchItems,
  };
  opts.patch?.(data);
  const storage: Record<string, string> = {
    'sb-127-auth-token': JSON.stringify(s),
    mageid_last_user_id: USER.id,
    mageid_last_user_email: USER.email,
    mageid_onboarding_complete: 'true',
    mageid_user_role: 'contractor',
    mageid_subscription_tier: tier,
    mageid_ai_consent_v2: 'granted',
    mageid_code_answer_ack: JSON.stringify({ v: 1, at: day(-4), account: USER.id }),
    // An account that has been in use: the starter card was removed from its
    // own menu and the practice offers were closed.
    [`mageid_first_job_path::${USER.id}`]: JSON.stringify({ v: 1, answer: null, skipped: [], hidden: false, removed: true, finishShown: false }),
    mageid_tutorials_v1: JSON.stringify({ v: 1, byId: {}, chips: Object.fromEntries(TUTORIAL_IDS.map((id) => [id, { dismissedAt: day(-20) }])), lastChipDay: dayOnly(0) }),
  };
  for (const [k, v] of Object.entries(data)) storage[k] = typeof v === 'string' ? v : JSON.stringify(v);
  const mirror = (key: string) => ((data[key] as Record<string, unknown>[] | undefined) ?? []).map(snake);
  return {
    storage,
    server: {
      user: s.user,
      subscription: tier === 'free' ? null : { user_id: USER.id, tier, end_date: null, tier_source: 'manual', manual_tier: tier },
      tables: {
        commitments: mirror('mageid_commitments'), rfis: mirror('mageid_rfis'), permits: mirror('mageid_permits'),
        punch_items: mirror('mageid_punch_items'), daily_reports: mirror('mageid_daily_reports'),
        change_orders: mirror('mageid_change_orders'), invoices: mirror('mageid_invoices'),
      },
      functions: { 'weather-forecast': (body: { kind?: string } | null) => (body?.kind === 'current' ? WEATHER_NOW : WEATHER_FORECAST), ...(opts.functions ?? {}) },
    },
    outside: [
      { match: 'api.openweathermap.org/data/2.5/weather', body: WEATHER_NOW },
      { match: 'api.openweathermap.org/data/2.5/forecast', body: WEATHER_FORECAST },
    ],
  };
}
