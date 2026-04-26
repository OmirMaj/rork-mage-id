// Lightweight demo project seed for first-time users. Same Henderson
// Residence story as dev-seeder.tsx but trimmed to the essentials so the
// new user immediately sees what a populated MAGE ID looks like — without
// the seeder's owner gate or full breadth of fixtures.
//
// Usage: pass the relevant ProjectContext setters + a navigate callback.
//   await seedDemoProject({ addProject, addInvoice, ..., onDone })

import type {
  Project, Invoice, DailyFieldReport, PunchItem, ProjectPhoto,
  ChangeOrder, RFI,
} from '@/types';
import { generateUUID } from '@/utils/generateId';

interface SeedCtx {
  addProject: (p: Project) => void;
  addInvoice: (i: Invoice) => void;
  addDailyReport: (d: DailyFieldReport) => void;
  addPunchItem: (p: PunchItem) => void;
  addProjectPhoto: (p: ProjectPhoto) => void;
  addRFI: (r: Omit<RFI, 'id' | 'number' | 'createdAt' | 'updatedAt'>) => void;
  addChangeOrder: (co: ChangeOrder) => void;
}

export async function seedDemoProject(ctx: SeedCtx): Promise<{ projectId: string }> {
  const now = new Date();
  const projectId = generateUUID();
  const isoNow = now.toISOString();
  const dayMs = 24 * 60 * 60 * 1000;
  const isoDaysAgo = (n: number) => new Date(now.getTime() - n * dayMs).toISOString();

  // Project
  const project = {
    id: projectId,
    name: 'The Henderson Residence',
    type: 'renovation',
    location: '124 Park Slope, Brooklyn NY 11215',
    squareFootage: 3200,
    quality: 'premium',
    description: 'Demo project — full-gut renovation of a 3-story brownstone. Wipe me anytime from Settings.',
    createdAt: isoDaysAgo(45),
    updatedAt: isoNow,
    estimate: {
      materialTotal: 184_500,
      laborTotal: 142_000,
      permits: 8_500,
      overhead: 33_500,
      contingency: 18_400,
      taxAmount: 32_660,
      totalCost: 419_560,
      markupPercent: 22,
      markupAmount: 92_303,
      grandTotal: 511_863,
      pricePerSqFt: 159.96,
      estimatedDuration: '5-6 months',
      bulkSavingsTotal: 14_780,
      materials: [],
    },
    status: 'in_progress',
  } as unknown as Project;
  ctx.addProject(project);

  // Invoices — 3 to keep it simple but populated
  const invoices: Array<{ number: number; pct: number; daysAgoIssue: number; daysAgoDue: number; amount: number; paid: number; status: Invoice['status'] }> = [
    { number: 1, pct: 15, daysAgoIssue: 40, daysAgoDue: 10, amount: 76_780, paid: 76_780, status: 'paid' },
    { number: 2, pct: 30, daysAgoIssue: 20, daysAgoDue: -3, amount: 76_780, paid: 50_000, status: 'partially_paid' },
    { number: 3, pct: 45, daysAgoIssue: 4, daysAgoDue: -25, amount: 76_780, paid: 0, status: 'sent' },
  ];
  for (const inv of invoices) {
    ctx.addInvoice({
      id: generateUUID(),
      projectId,
      number: inv.number,
      type: 'progress',
      progressPercent: inv.pct,
      issueDate: isoDaysAgo(inv.daysAgoIssue),
      dueDate: isoDaysAgo(inv.daysAgoDue),
      paymentTerms: 'net_30',
      notes: '',
      lineItems: [
        { id: generateUUID(), description: `Progress billing — ${inv.pct}% completion`, quantity: 1, unit: 'lump', unitPrice: inv.amount * 0.92, total: inv.amount * 0.92 },
      ],
      subtotal: inv.amount * 0.92,
      taxRate: 8.875,
      taxAmount: inv.amount * 0.08,
      totalDue: inv.amount,
      amountPaid: inv.paid,
      status: inv.status,
      payments: inv.paid > 0 ? [{ id: generateUUID(), amount: inv.paid, method: 'check', receivedAt: isoDaysAgo(inv.daysAgoDue), reference: `Check #1${inv.number}042` }] : [],
      createdAt: isoDaysAgo(inv.daysAgoIssue),
      updatedAt: isoNow,
    } as unknown as Invoice);
  }

  // 3 daily reports
  const dfrTopics = [
    { temp: '64°F', conditions: 'Clear', work: 'Demo of west wall complete. Started rough framing for the new kitchen island.' },
    { temp: '58°F', conditions: 'Cloudy', work: 'MEP rough-in continues — electrical pulled to all 1F outlets. Plumbing rough for primary bath underway.' },
    { temp: '52°F', conditions: 'Rain', work: 'Indoor work only. Drywall delivery received. Insulation crew finished walls + ceiling on 2F.' },
  ];
  dfrTopics.forEach((d, i) => {
    const date = isoDaysAgo(i * 2 + 1);
    ctx.addDailyReport({
      id: generateUUID(),
      projectId,
      date,
      weather: { temperature: d.temp, conditions: d.conditions, wind: '', isManual: false },
      manpower: [
        { id: generateUUID(), trade: 'Carpentry', company: 'Henderson Build', headcount: 3, hoursWorked: 8 },
        { id: generateUUID(), trade: 'Electrical', company: 'Volt Bros Electric', headcount: 2, hoursWorked: 8 },
      ],
      workPerformed: d.work,
      materialsDelivered: i === 0 ? ['Drywall — 40 sheets', 'Insulation — R-21 rolls'] : [],
      issuesAndDelays: '',
      photos: [],
      status: i === 0 ? 'sent' : 'draft',
      createdAt: date,
      updatedAt: date,
    } as unknown as DailyFieldReport);
  });

  // 2 RFIs
  ctx.addRFI({
    projectId,
    subject: 'Knob-and-tube wiring discovered in NE corner — replace or splice?',
    question: 'Knob-and-tube wiring discovered in NE corner — replace or splice?',
    priority: 'urgent',
    status: 'open',
    assignedTo: 'D. Henderson (Architect)',
    dateSubmitted: isoDaysAgo(3),
    dateRequired: isoDaysAgo(-2),
    submittedBy: 'Henderson Build',
    attachments: [],
  } as unknown as Omit<RFI, 'id' | 'number' | 'createdAt' | 'updatedAt'>);
  ctx.addRFI({
    projectId,
    subject: 'Confirm tile pattern for primary bath',
    question: 'Confirm tile pattern for primary bath floor (matrix vs. herringbone)',
    priority: 'normal',
    status: 'answered',
    assignedTo: 'L. Henderson (Owner)',
    dateSubmitted: isoDaysAgo(12),
    dateRequired: isoDaysAgo(7),
    dateResponded: isoDaysAgo(10),
    response: 'Confirmed — herringbone in primary bath.',
    submittedBy: 'Henderson Build',
    attachments: [],
  } as unknown as Omit<RFI, 'id' | 'number' | 'createdAt' | 'updatedAt'>);

  // 3 punch items
  ([
    { description: 'Touch-up paint above hallway light switch', priority: 'low', status: 'open', location: '2F Hallway' },
    { description: 'Caulk gap between tub and tile in hall bath', priority: 'medium', status: 'in_progress', location: '2F Hall Bath' },
    { description: 'Sand and re-stain banister handrail', priority: 'medium', status: 'closed', location: 'Stairwell' },
  ] as const).forEach(p => {
    ctx.addPunchItem({
      id: generateUUID(),
      projectId,
      description: p.description,
      location: p.location,
      priority: p.priority,
      status: p.status,
      createdAt: isoDaysAgo(8),
      updatedAt: isoNow,
      closedAt: p.status === 'closed' ? isoDaysAgo(2) : undefined,
      notes: '',
      photos: [],
    } as unknown as PunchItem);
  });

  // 5 photos for the grid
  const photoSpec = [
    { tag: 'before', location: 'Kitchen — west wall' },
    { tag: 'progress', location: 'Primary bath rough-in' },
    { tag: 'progress', location: 'Living room subfloor' },
    { tag: 'progress', location: 'Stairwell framing' },
    { tag: 'after', location: 'Kitchen island' },
  ];
  photoSpec.forEach((p, i) => {
    ctx.addProjectPhoto({
      id: generateUUID(),
      projectId,
      uri: `https://picsum.photos/seed/mage-demo-${i}/640/480`,
      timestamp: isoDaysAgo(30 - i * 4),
      location: p.location,
      tag: p.tag,
      latitude: 40.6712 + (Math.random() - 0.5) * 0.001,
      longitude: -73.9876 + (Math.random() - 0.5) * 0.001,
    } as unknown as ProjectPhoto);
  });

  // One approved CO
  ctx.addChangeOrder({
    id: generateUUID(),
    projectId,
    number: 1,
    date: isoDaysAgo(15),
    description: 'Owner-requested upgrade: subway tile → marble herringbone for primary bath',
    reason: 'Owner direction at site walk',
    status: 'approved',
    scheduleImpactDays: 3,
    originalContractValue: 511_863,
    changeAmount: 4_280,
    newContractTotal: 516_143,
    lineItems: [
      { id: generateUUID(), description: 'Marble tile (herringbone) — primary bath', quantity: 110, unit: 'sf', unitPrice: 24.50, total: 2_695 },
      { id: generateUUID(), description: 'Additional labor for herringbone install', quantity: 1, unit: 'lump', unitPrice: 1_585, total: 1_585 },
    ],
    createdAt: isoDaysAgo(15),
    updatedAt: isoNow,
  } as unknown as ChangeOrder);

  return { projectId };
}
