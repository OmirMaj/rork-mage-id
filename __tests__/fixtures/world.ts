/**
 * __tests__/fixtures/world.ts — one seeded world.
 *
 * Spec: "The fixture is deliberately a product artifact, not test scaffolding.
 * It is the same shape wanted for demo data, for marketing screenshots, and for
 * a 'try it with sample data' onboarding path. Building it once and using it
 * three ways is the reason to make it realistic rather than minimal."
 *
 * So the numbers are a plausible small-GC job, not foo/bar: a $184,500 kitchen
 * and primary-suite remodel that is 60% through, carrying the paper trail such
 * a job actually accumulates.
 *
 * EVERY EXPORT IS TYPED AGAINST `@/types`. That is not decoration — it is the
 * mechanism that keeps the fixture honest, and it was learned the hard way. The
 * first draft of this file invented its own object shapes; `Project.quality` is
 * required and the invented project omitted it, so the home screen crashed on
 * `project.quality.charAt(0)` and the suite reported a bug in ProjectCard that
 * did not exist. A fixture that does not type-check manufactures fake findings,
 * which is worse than having no fixture: it costs someone an afternoon.
 * `npx tsc --noEmit` now catches that class of mistake before the suite runs.
 *
 * It seeds AsyncStorage rather than a database because the app is offline-first
 * (utils/offlineQueue.ts): every context hydrates from its `mageid_*` cache
 * first and reconciles with Supabase after. Seeding storage is therefore the
 * same path a real cold start takes on a device that has synced before.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  AppSettings,
  ClientPortalSettings,
  DailyFieldReport,
  LinkedEstimate,
  Permit,
  PortalMessage,
  Project,
  PunchItem,
  RFI,
} from '@/types';
import type { SeededRate } from '@/utils/costSeedCore';

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const SMOKE_USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'dana@ridgelinebuilders.test',
  name: 'Dana Ortiz',
  company: 'Ridgeline Builders',
};

export const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
export const ESTIMATE_ID = '33333333-3333-4333-8333-333333333333';
export const PORTAL_ID = '44444444-4444-4444-8444-444444444444';
export const PORTAL_TOKEN = 'smoke-portal-token-9f4c2a';

/**
 * A fixed "today" so the fixture's relative dates (a daily report from
 * yesterday, a permit expiring in three weeks) are identical on every run. A
 * fixture keyed off the real clock is a fixture that fails differently in
 * February.
 */
const TODAY = new Date('2026-08-15T12:00:00.000Z');
const day = (offset: number) => new Date(TODAY.getTime() + offset * 86_400_000).toISOString();
const dayOnly = (offset: number) => day(offset).slice(0, 10);

// ---------------------------------------------------------------------------
// The estimate the project carries
// ---------------------------------------------------------------------------

const linkedEstimate: LinkedEstimate = {
  id: ESTIMATE_ID,
  globalMarkup: 18,
  baseTotal: 131_502,
  markupTotal: 23_670,
  grandTotal: 155_172,
  createdAt: day(-58),
  items: [
    {
      materialId: 'mat-demo',
      name: 'Selective demolition — kitchen + primary bath',
      category: 'labor',
      unit: 'LS',
      quantity: 1,
      unitPrice: 6800,
      bulkPrice: 6800,
      markup: 18,
      usesBulk: false,
      lineTotal: 6800,
      supplier: 'In-house',
      csiDivision: '02',
    },
    {
      materialId: 'mat-framing',
      name: 'Rough carpentry — wall relocation, header at island',
      category: 'labor',
      unit: 'HR',
      quantity: 96,
      unitPrice: 78,
      bulkPrice: 78,
      markup: 18,
      usesBulk: false,
      lineTotal: 7488,
      supplier: 'In-house',
      csiDivision: '06',
    },
    {
      materialId: 'mat-cabinets',
      name: 'Semi-custom cabinetry, painted maple',
      category: 'millwork',
      unit: 'LS',
      quantity: 1,
      unitPrice: 41_250,
      bulkPrice: 39_800,
      markup: 15,
      usesBulk: true,
      lineTotal: 39_800,
      supplier: 'Cascade Cabinet Co.',
      csiDivision: '12',
    },
    {
      materialId: 'mat-counters',
      name: 'Quartz countertops + waterfall island',
      category: 'stone',
      unit: 'SF',
      quantity: 84,
      unitPrice: 96,
      bulkPrice: 96,
      markup: 20,
      usesBulk: false,
      lineTotal: 8064,
      supplier: 'Rose City Stone',
      csiDivision: '12',
    },
    {
      materialId: 'mat-plumbing',
      name: 'Plumbing rough + trim (sub)',
      category: 'subcontractor',
      unit: 'LS',
      quantity: 1,
      unitPrice: 18_400,
      bulkPrice: 18_400,
      markup: 12,
      usesBulk: false,
      lineTotal: 18_400,
      supplier: 'Alder Mechanical',
      csiDivision: '22',
    },
    {
      materialId: 'mat-electrical',
      name: 'Electrical rough + trim, panel upgrade (sub)',
      category: 'subcontractor',
      unit: 'LS',
      quantity: 1,
      unitPrice: 22_600,
      bulkPrice: 22_600,
      markup: 12,
      usesBulk: false,
      lineTotal: 22_600,
      supplier: 'Northline Electric',
      csiDivision: '26',
    },
    {
      materialId: 'mat-finish',
      name: 'Tile, paint, trim carpentry',
      category: 'labor',
      unit: 'LS',
      quantity: 1,
      unitPrice: 26_900,
      bulkPrice: 26_900,
      markup: 18,
      usesBulk: false,
      lineTotal: 26_900,
      supplier: 'In-house',
      csiDivision: '09',
    },
  ],
};

const clientPortal: ClientPortalSettings = {
  enabled: true,
  portalId: PORTAL_ID,
  accessToken: PORTAL_TOKEN,
  requirePasscode: false,
  showSchedule: true,
  showChangeOrders: true,
  showInvoices: true,
  showPhotos: true,
  showBudgetSummary: true,
  showDailyReports: true,
  showPunchList: true,
  showRFIs: false,
  showDocuments: true,
  welcomeMessage: 'Hi Meredith — weekly updates land here every Friday afternoon.',
};

// ---------------------------------------------------------------------------
// The project
// ---------------------------------------------------------------------------

const project: Project = {
  id: PROJECT_ID,
  name: 'Harlow Residence — kitchen + primary suite',
  type: 'renovation',
  location: '4218 SE Rex St, Portland, OR 97206',
  locationLatitude: 45.4735,
  locationLongitude: -122.6104,
  locationGeocodedAt: day(-70),
  squareFootage: 1180,
  quality: 'premium',
  description:
    'Full gut of the 1948 kitchen, wall removed to the dining room, primary '
    + 'bath reconfigured with a curbless shower. Owner is living on site.',
  primaryContact: {
    name: 'Meredith Harlow',
    phone: '(503) 555-0148',
    email: 'm.harlow@example.test',
  },
  leadSource: 'referral',
  createdAt: day(-72),
  updatedAt: day(-1),
  // `estimate` is the old EstimateBreakdown shape; this project is on the
  // newer linkedEstimate path, which is what the estimate screens read.
  estimate: null,
  linkedEstimate,
  status: 'in_progress',
  collaborators: [],
  clientPortal,
  photoCount: 0,
  contractMode: 'fixed',
  handoverChecklist: {},
};

// ---------------------------------------------------------------------------
// The paper trail
// ---------------------------------------------------------------------------

const rfis: RFI[] = [
  {
    id: 'rfi-1',
    projectId: PROJECT_ID,
    number: 1,
    subject: 'Header size at island opening',
    question:
      'Plans show a 4x10 DF header at the 11\'-2" island opening. Existing point '
      + 'load from the second-floor bearing wall lands mid-span. Confirm size or '
      + 'provide alternate.',
    submittedBy: SMOKE_USER.name,
    assignedTo: 'Kestrel Structural',
    dateSubmitted: day(-31),
    dateRequired: day(-24),
    dateResponded: day(-26),
    response: 'Upsize to 5-1/4 x 11-7/8 LVL, (2) ply, with a 4x4 post to foundation.',
    status: 'answered',
    priority: 'urgent',
    attachments: [],
    createdAt: day(-31),
    updatedAt: day(-26),
  },
  {
    id: 'rfi-2',
    projectId: PROJECT_ID,
    number: 2,
    subject: 'Shower niche waterproofing detail',
    question: 'Which waterproofing assembly is specified for the curbless pan?',
    submittedBy: SMOKE_USER.name,
    assignedTo: 'Architect',
    dateSubmitted: day(-4),
    dateRequired: day(3),
    status: 'open',
    priority: 'normal',
    attachments: [],
    createdAt: day(-4),
    updatedAt: day(-4),
  },
];

const punchItems: PunchItem[] = [
  {
    id: 'punch-1',
    projectId: PROJECT_ID,
    description: 'Touch-up paint at dining room return — roller lap marks in raking light.',
    location: 'Dining room',
    assignedSub: 'Vega Painting',
    dueDate: dayOnly(9),
    priority: 'low',
    status: 'open',
    createdAt: day(-3),
    updatedAt: day(-3),
  },
  {
    id: 'punch-2',
    projectId: PROJECT_ID,
    description: 'Undercabinet light dimmer buzzes below 40% — wrong driver for the tape.',
    location: 'Kitchen',
    assignedSub: 'Northline Electric',
    dueDate: dayOnly(5),
    priority: 'medium',
    status: 'in_progress',
    createdAt: day(-2),
    updatedAt: day(-1),
  },
  {
    id: 'punch-3',
    projectId: PROJECT_ID,
    description: 'Cabinet door reveal inconsistent, run 3 — right-hand stack 1/8" tight at top.',
    location: 'Kitchen',
    assignedSub: 'In-house',
    dueDate: dayOnly(-4),
    priority: 'medium',
    status: 'closed',
    closedAt: day(-6),
    createdAt: day(-11),
    updatedAt: day(-6),
  },
];

const permits: Permit[] = [
  {
    id: 'permit-1',
    projectId: PROJECT_ID,
    projectName: project.name,
    type: 'building',
    permitNumber: 'BLD-26-04871',
    jurisdiction: 'City of Portland BDS',
    status: 'inspection_passed',
    appliedDate: dayOnly(-64),
    approvedDate: dayOnly(-55),
    expiresDate: dayOnly(128),
    inspectionDate: dayOnly(-18),
    inspectionNotes: 'Framing approved. Insulation inspection to be scheduled.',
    fee: 1840,
    createdAt: day(-64),
    updatedAt: day(-18),
  },
  {
    id: 'permit-2',
    projectId: PROJECT_ID,
    projectName: project.name,
    type: 'electrical',
    permitNumber: 'ELE-26-02219',
    jurisdiction: 'City of Portland BDS',
    status: 'approved',
    appliedDate: dayOnly(-56),
    approvedDate: dayOnly(-49),
    // Deliberately close: exercises the expiring-soon branch.
    expiresDate: dayOnly(21),
    fee: 410,
    createdAt: day(-56),
    updatedAt: day(-49),
  },
];

const dailyReports: DailyFieldReport[] = [
  {
    id: 'dfr-1',
    projectId: PROJECT_ID,
    date: dayOnly(-1),
    weather: { temperature: '71°F', conditions: 'Overcast', wind: '6 mph NW', isManual: true },
    manpower: [
      { id: 'mp-1', trade: 'Carpentry', company: 'Ridgeline Builders', headcount: 3, hoursWorked: 24 },
      { id: 'mp-2', trade: 'Electrical', company: 'Northline Electric', headcount: 1, hoursWorked: 8 },
    ],
    workPerformed:
      'Set base cabinets on the north and west runs. Scribed filler at the chimney '
      + 'chase. Started upper cabinet layout.',
    materialsDelivered: ['Cabinet run 2 of 3 (Cascade)', 'Shims + construction adhesive'],
    issuesAndDelays: '',
    photos: [],
    status: 'sent',
    createdAt: day(-1),
    updatedAt: day(-1),
  },
  {
    id: 'dfr-2',
    projectId: PROJECT_ID,
    date: dayOnly(-2),
    weather: { temperature: '64°F', conditions: 'Rain', wind: '12 mph S', isManual: true },
    manpower: [
      { id: 'mp-3', trade: 'Tile', company: 'Ridgeline Builders', headcount: 3, hoursWorked: 21 },
    ],
    workPerformed: 'Tile backer at primary shower. Pan pre-slope poured.',
    materialsDelivered: ['Schluter Kerdi kit', 'Deck mud, 12 bags'],
    issuesAndDelays: 'Countertop template pushed one day — fabricator truck breakdown.',
    photos: [],
    status: 'sent',
    createdAt: day(-2),
    updatedAt: day(-2),
  },
  {
    id: 'dfr-3',
    projectId: PROJECT_ID,
    date: dayOnly(-5),
    weather: { temperature: '79°F', conditions: 'Clear', wind: '4 mph NE', isManual: true },
    manpower: [
      { id: 'mp-4', trade: 'Drywall', company: 'Cutline Drywall', headcount: 5, hoursWorked: 40 },
    ],
    workPerformed: 'Drywall finish level 4 complete throughout. Primer applied.',
    materialsDelivered: [],
    issuesAndDelays: '',
    photos: [],
    status: 'draft',
    createdAt: day(-5),
    updatedAt: day(-5),
  },
];

/**
 * Cold-start cost seeds — the rates the contractor stated before MAGE had
 * watched a single job close.
 *
 * Spec: "a few cost seeds (so the seeded/earned provenance paths render)".
 * These are what make `seed:`-provenance visible on the cost-truth / cost-xray
 * screens; without them those screens only ever render their "no history yet"
 * branch and the provenance code never executes.
 */
const costSeeds: SeededRate[] = [
  {
    id: 'seed-rough-carpentry-hr',
    trade: 'Rough carpentry, journeyman',
    unit: 'hr',
    rate: 78,
    reportedJobs: 6,
    asOf: dayOnly(-70),
    note: 'Loaded rate incl. burden',
    createdAt: day(-70),
    method: 'manual',
  },
  {
    id: 'seed-interior-paint-sf',
    trade: 'Interior paint, walls + ceilings, 2 coats',
    unit: 'sf',
    rate: 2.35,
    reportedJobs: 11,
    asOf: dayOnly(-70),
    createdAt: day(-70),
    method: 'paste',
  },
  {
    id: 'seed-floor-tile-sf',
    trade: 'Tile setting, floor, 12x24 porcelain',
    unit: 'sf',
    rate: 11.5,
    reportedJobs: 4,
    asOf: dayOnly(-70),
    createdAt: day(-70),
    method: 'manual',
  },
];

const portalMessages: PortalMessage[] = [
  {
    id: 'pm-1',
    projectId: PROJECT_ID,
    portalId: PORTAL_ID,
    authorType: 'client',
    authorName: 'Meredith Harlow',
    body: 'Can we still hit the 5th for the countertop template?',
    createdAt: day(-3),
    readByGc: true,
    readByClient: true,
  },
  {
    id: 'pm-2',
    projectId: PROJECT_ID,
    portalId: PORTAL_ID,
    authorType: 'gc',
    authorName: SMOKE_USER.name,
    body: 'Template moved to Thursday — fabricator truck went down. Install date holds.',
    createdAt: day(-3),
    readByGc: true,
    readByClient: false,
  },
];

const settings: AppSettings = {
  location: 'Portland, OR',
  units: 'imperial',
  taxRate: 0,
  contingencyRate: 5,
  branding: {
    companyName: SMOKE_USER.company,
    contactName: SMOKE_USER.name,
    email: SMOKE_USER.email,
    phone: '(503) 555-0111',
    address: '1140 SE Division St, Portland, OR 97202',
    licenseNumber: 'CCB #221847',
    tagline: 'Remodels that survive the punch list.',
  },
};

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/**
 * Every `mageid_*` key the fixture writes.
 *
 * An explicit table rather than something derived, so it is obvious at a glance
 * what the populated state contains — and, equally, what it deliberately leaves
 * empty (invoices, change orders, photos, submittals, warranties). Those empty
 * collections are not an oversight: a real job at 60% has some of these and not
 * others, and screens that render a mix of populated and empty collections are
 * exactly where the interesting crashes live.
 */
const WORLD: Record<string, unknown> = {
  mageid_projects: [project],
  mageid_settings: settings,
  mageid_rfis: rfis,
  mageid_punch_items: punchItems,
  mageid_permits: permits,
  mageid_daily_reports: dailyReports,
  mageid_cost_seeds: costSeeds,
  mageid_portal_messages: portalMessages,
};

/** Write the seeded world into AsyncStorage. Call before mounting. */
export async function seedWorld(): Promise<void> {
  const pairs: [string, string][] = Object.entries(WORLD).map(([k, v]) => [k, JSON.stringify(v)]);
  await AsyncStorage.multiSet(pairs);
}

/**
 * Reset to the empty state.
 *
 * A full clear rather than removing only the fixture's own keys, because the
 * previous mount's providers write their own caches (AI result caches, the
 * offline queue, analytics ids) and leaking those between states would make
 * "empty" not actually empty.
 */
export async function clearWorld(): Promise<void> {
  await AsyncStorage.clear();
}

export const world = {
  user: SMOKE_USER,
  project,
  linkedEstimate,
  rfis,
  punchItems,
  permits,
  dailyReports,
  costSeeds,
  portalMessages,
  settings,
  portalId: PORTAL_ID,
  portalToken: PORTAL_TOKEN,
};
