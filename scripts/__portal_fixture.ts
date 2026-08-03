import { buildPortalSnapshot, buildPortalUrl } from '../utils/portalSnapshot';
import type { Project, ClientPortalSettings, SavedAIAPayApp, SelectionCategory, ChangeOrder, DailyFieldReport, ProjectPhoto, Invoice } from '../types';
import { writeFileSync } from 'node:fs';

const project = {
  id: 'p1', name: 'Maple St Renovation', type: 'renovation', status: 'in_progress',
  location: '12 Maple St, Portland ME',
  linkedEstimate: { grandTotal: 400000, baseTotal: 320000, items: [] },
  contractMode: 'fixed',
  schedule: {
    startDate: '2026-05-01', workingDaysPerWeek: 5, totalDurationDays: 120,
    tasks: [
      { id: 't1', title: 'Framing complete', phase: 'Structure', durationDays: 25, startDay: 1, progress: 100, status: 'done', isMilestone: true },
      { id: 't2', title: 'Rough electrical complete', phase: 'MEP', durationDays: 30, startDay: 1, progress: 100, status: 'done', isMilestone: true },
      { id: 't3', title: 'Drywall complete', phase: 'Finishes', durationDays: 90, startDay: 1, progress: 10, status: 'in_progress', isMilestone: true },
    ],
  },
  updatedAt: '2026-06-15T00:00:00.000Z',
} as unknown as Project;

const portal = {
  portalId: 'portal-demo', enabled: true, showSchedule: true, showBudgetSummary: true,
  showInvoices: true, showChangeOrders: true, showPhotos: true, showDailyReports: true,
  showPunchList: false, showRFIs: false, showDocuments: false, coApprovalEnabled: true,
  welcomeMessage: 'Framing is done and electrical is roughed in. On track for August.',
} as unknown as ClientPortalSettings;

const snap = buildPortalSnapshot({
  project, portal,
  aiaPayApps: [
    { id: 'aia1', projectId: 'p1', applicationNumber: 1, applicationDate: '2026-06-01', periodTo: '2026-05-31',
      ownerName: 'Dana Reyes', contractorName: 'Northgate Builders', projectName: 'Maple St Renovation',
      originalContractSum: 400000, netChangeByCO: 0, contractSumToDate: 400000, retainagePercent: 10, lessPreviousCertificates: 0,
      lines: [{ id: 'l1', itemNo: '06', description: 'Wood & Plastics', scheduledValue: 90000, fromPreviousApp: 0, thisPeriod: 40000, materialsPresentlyStored: 0, retainagePercent: 10 }],
      totals: { totalScheduledValue: 400000, totalCompletedAndStored: 40000, totalRetainage: 4000, totalEarnedLessRetainage: 36000, currentPaymentDue: 36000, balanceToFinish: 364000, percentComplete: 10 } },
    { id: 'aia2', projectId: 'p1', applicationNumber: 2, applicationDate: '2026-07-01', periodTo: '2026-06-30',
      ownerName: 'Dana Reyes', contractorName: 'Northgate Builders', projectName: 'Maple St Renovation',
      originalContractSum: 400000, netChangeByCO: 0, contractSumToDate: 400000, retainagePercent: 10, lessPreviousCertificates: 36000,
      lines: [{ id: 'l2', itemNo: '09', description: 'Finishes', scheduledValue: 120000, fromPreviousApp: 40000, thisPeriod: 14200, materialsPresentlyStored: 0, retainagePercent: 10 }],
      totals: { totalScheduledValue: 400000, totalCompletedAndStored: 54200, totalRetainage: 5420, totalEarnedLessRetainage: 48780, currentPaymentDue: 12780, balanceToFinish: 345800, percentComplete: 14 } },
    { id: 'aia3', projectId: 'p1', applicationNumber: 3, applicationDate: '2026-08-01', periodTo: '2026-07-31',
      ownerName: 'Dana Reyes', contractorName: 'Northgate Builders', projectName: 'Maple St Renovation',
      originalContractSum: 400000, netChangeByCO: 0, contractSumToDate: 400000, retainagePercent: 10, lessPreviousCertificates: 48780,
      lines: [{ id: 'l3', itemNo: '09', description: 'Finishes', scheduledValue: 120000, fromPreviousApp: 54200, thisPeriod: 9000, materialsPresentlyStored: 0, retainagePercent: 10 }],
      totals: { totalScheduledValue: 400000, totalCompletedAndStored: 63200, totalRetainage: 6320, totalEarnedLessRetainage: 56880, currentPaymentDue: 8100, balanceToFinish: 336800, percentComplete: 16 } },
  ] as unknown as SavedAIAPayApp[],
  dailyReports: [
    { id: 'r1', projectId: 'p1', date: '2026-06-03', workPerformed: 'Framed the second-floor walls and set the ridge beam.', manpower: [{ headcount: 4, hoursWorked: 8, trade: 'Carpentry' }] },
    { id: 'r2', projectId: 'p1', date: '2026-06-05', workPerformed: 'Rough electrical pulled through the new framing.', manpower: [{ headcount: 2, hoursWorked: 8, trade: 'Electrical' }] },
    { id: 'r3', projectId: 'p1', date: '2026-06-09', workPerformed: 'Electrical inspection passed. Insulation delivered.', manpower: [{ headcount: 3, hoursWorked: 8, trade: 'Electrical' }] },
  ] as unknown as DailyFieldReport[],
  photos: [
    { id: 'ph1', projectId: 'p1', uri: 'https://placehold.co/600x400/png?text=Framing', timestamp: '2026-06-03T09:00:00Z' },
    { id: 'ph2', projectId: 'p1', uri: 'https://placehold.co/600x400/png?text=Rough+E', timestamp: '2026-06-04T09:00:00Z' },
    { id: 'ph3', projectId: 'p1', uri: 'https://placehold.co/600x400/png?text=Ridge', timestamp: '2026-06-07T17:00:00Z' },
  ] as unknown as ProjectPhoto[],
  changeOrders: [
    { id: 'co1', projectId: 'p1', number: 4, description: 'Add radiant floor heat to the primary bath', reason: 'Owner request after the tile selection; requires new manifold and a dedicated circuit.', date: '2026-06-05', status: 'submitted', changeAmount: 12400, newContractTotal: 412400, scheduleImpactDays: 4, lineItems: [] },
  ] as unknown as ChangeOrder[],
  invoices: [
    { id: 'inv1', projectId: 'p1', number: 12, status: 'sent', totalDue: 8000, amountPaid: 0, dueDate: '2026-06-09', issueDate: '2026-05-25', lineItems: [] },
  ] as unknown as Invoice[],
  selections: [
    { id: 'sel-late', projectId: 'p1', userId: 'u1', category: 'Bathroom Tile', styleBrief: 'warm neutral zellige', budget: 4200, dueDate: '2026-06-10', status: 'pending', notes: '', displayOrder: 0, createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z',
      options: [
        { id: 'o1', productName: 'Zellige 4x4 Bone', brand: 'Cle', description: 'Handmade Moroccan zellige', unitPrice: 22, unit: 'sf', quantity: 180, total: 3960, supplier: 'Tile Co', highlights: ['Handmade'], isChosen: false },
        { id: 'o2', productName: 'Subway 3x6 White', brand: 'Daltile', description: 'Classic ceramic subway', unitPrice: 9, unit: 'sf', quantity: 180, total: 1620, supplier: 'Tile Co', highlights: ['In stock'], isChosen: false },
      ] },
    { id: 'sel-soon', projectId: 'p1', userId: 'u1', category: 'Kitchen Cabinets', styleBrief: 'shaker, painted', budget: 22000, dueDate: '2099-01-05', status: 'pending', notes: '', displayOrder: 1, createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z',
      options: [{ id: 'o3', productName: 'Painted Shaker', brand: 'Koch', description: 'Full overlay', unitPrice: 1, unit: 'ls', quantity: 1, total: 21500, supplier: 'Kitchen Co', highlights: [], isChosen: false }] },
  ] as unknown as SelectionCategory[],
  supabaseUrl: 'https://example.supabase.co',
  supabaseAnonKey: 'anon-key',
  settings: { branding: { companyName: 'Northgate Builders' } } as never,
});

const url = buildPortalUrl('http://localhost:8899/portal', 'portal-demo', snap);
writeFileSync('/private/tmp/claude-501/-Users-omirmajeed/07fb7f3d-09eb-46fb-87e7-f8cc08b6ddad/scratchpad/portal-url.txt', url.replace('/portal/portal-demo', '/portal/index.html'));
console.log('narrative(aia2):', JSON.stringify(snap.sections.aiaPayApps?.find(a=>a.id==='aia2')?.narrative, null, 1));
console.log('narrative(aia3 headline):', snap.sections.aiaPayApps?.find(a=>a.id==='aia3')?.narrative?.headline);
console.log('decisions:', snap.ownerDecisions?.map(d=>`${d.urgency}|${d.kind}|${d.title}`));
