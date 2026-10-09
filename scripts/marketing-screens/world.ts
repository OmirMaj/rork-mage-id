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
  squareFootage: 640, quality: 'standard',
  description: 'Kitchen opened to the dining room, new cabinets and counters, hall bath rebuilt with a tiled shower.',
  primaryContact: { name: CLIENT.name, phone: CLIENT.phone, email: CLIENT.email }, leadSource: 'referral',
  createdAt: day(-60), updatedAt: day(-1), estimate: null, linkedEstimate, status: 'in_progress', collaborators: [],
  photoCount: 0, contractMode: 'fixed', retainagePercent: 10, handoverChecklist: {},
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
    mageid_projects: [alder, birch, cedar],
    mageid_settings: settings,
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
      },
      functions: {},
    },
    outside: [],
  };
}
