// utils/demoJob/world.ts — who and what the Demo Job is (pure).
//
// EVERY NAME IS MADE UP AND SAYS SO. Companies are "Sample ... Co." or
// "Example ...", people have placeholder surnames, every email is at
// example.com (reserved by RFC 2606, it can never be a real inbox) and every
// phone number is in 555-0100 to 555-0199 (reserved for fiction). The street
// does not exist. scripts/validate-demo-job.ts reads every generated record
// and fails on an email or a phone outside those two ranges.
import type { SubTrade } from '@/types';

export const JOB = {
  address: '1400 Example Wharf Street, Baltimore, MD 21230',
  city: 'Baltimore',
  state: 'MD',
  // Baltimore's Inner Harbor, to two decimals. Stamped at creation so the app
  // does not send the made-up street to a geocoder.
  latitude: 39.28,
  longitude: -76.61,
  grossSquareFeet: 62_000,
  storeys: 7,
  apartments: 48,
  description:
    'Made-up demo job. Seven-storey mixed-use building: ground-floor retail and lobby on a cast-in-place concrete podium, '
    + '48 apartments on six floors of light-gauge steel framing above (eight per floor), two elevators, about 62,000 gross square feet. '
    + 'Every name, number and record on this job is invented so you can try each screen. Nothing here is real.',
  jurisdiction: 'Baltimore City (made-up demo records)',
  owner: 'Example Development Group',
  architect: 'Sample Architects',
  engineer: 'Sample Structural Engineers',
  contractFor: 'General Construction',
} as const;

const phone = (n: number): string => `(410) 555-01${String(n).padStart(2, '0')}`;
const email = (local: string): string => `${local}@example.com`;

export interface DemoPerson { key: string; first: string; last: string; company: string; role: 'Client' | 'Architect' | 'Engineer' | 'Owner\'s Rep' | 'Inspector' | 'Supplier' | 'Lender'; email: string; phone: string; note: string }

export const PEOPLE: readonly DemoPerson[] = [
  { key: 'owner', first: 'Dana', last: 'Placeholder', company: JOB.owner, role: 'Client', email: email('dana.placeholder'), phone: phone(1), note: 'Owner, made-up contact for the demo job.' },
  { key: 'ownerrep', first: 'Morgan', last: 'Example', company: JOB.owner, role: 'Owner\'s Rep', email: email('morgan.example'), phone: phone(2), note: 'Owner\'s representative, made-up contact.' },
  { key: 'architect', first: 'Avery', last: 'Sampleton', company: JOB.architect, role: 'Architect', email: email('avery.sampleton'), phone: phone(3), note: 'Architect of record, made-up contact.' },
  { key: 'architect2', first: 'Riley', last: 'Draftwell', company: JOB.architect, role: 'Architect', email: email('riley.draftwell'), phone: phone(4), note: 'Project architect, made-up contact.' },
  { key: 'engineer', first: 'Jordan', last: 'Testcase', company: JOB.engineer, role: 'Engineer', email: email('jordan.testcase'), phone: phone(5), note: 'Structural engineer, made-up contact.' },
  { key: 'mep', first: 'Casey', last: 'Mockridge', company: 'Sample MEP Engineers', role: 'Engineer', email: email('casey.mockridge'), phone: phone(6), note: 'MEP engineer, made-up contact.' },
  { key: 'inspector', first: 'Sam', last: 'Fictional', company: 'Example Third-Party Inspections', role: 'Inspector', email: email('sam.fictional'), phone: phone(7), note: 'Special inspector, made-up contact.' },
  { key: 'lender', first: 'Taylor', last: 'Notreal', company: 'Example Construction Lender', role: 'Lender', email: email('taylor.notreal'), phone: phone(8), note: 'Lender\'s draw contact, made-up.' },
  { key: 'supplier', first: 'Jamie', last: 'Pretend', company: 'Sample Building Supply', role: 'Supplier', email: email('jamie.pretend'), phone: phone(9), note: 'Supplier inside sales, made-up contact.' },
  { key: 'windows', first: 'Robin', last: 'Madeup', company: 'Sample Window Supply', role: 'Supplier', email: email('robin.madeup'), phone: phone(10), note: 'Window supplier, made-up contact.' },
];

export const person = (key: string): DemoPerson => {
  const p = PEOPLE.find((x) => x.key === key);
  if (!p) throw new Error(`unknown demo person: ${key}`);
  return p;
};
export const fullName = (p: DemoPerson): string => `${p.first} ${p.last}`;

/** The contractor's own made-up field staff (crew members and time entries). */
export const CREW: readonly { key: string; name: string; trades: string[]; phone: string; email: string }[] = [
  { key: 'super', name: 'Alex Demo', trades: ['Superintendent'], phone: phone(20), email: email('alex.demo') },
  { key: 'asst', name: 'Jesse Sample', trades: ['Assistant Superintendent'], phone: phone(21), email: email('jesse.sample') },
  { key: 'carp1', name: 'Chris Example', trades: ['Carpenter'], phone: phone(22), email: email('chris.example') },
  { key: 'carp2', name: 'Pat Placeholder', trades: ['Carpenter'], phone: phone(23), email: email('pat.placeholder') },
  { key: 'labor1', name: 'Lee Testman', trades: ['Laborer'], phone: phone(24), email: email('lee.testman') },
  { key: 'labor2', name: 'Drew Mockler', trades: ['Laborer'], phone: phone(25), email: email('drew.mockler') },
];
export const SUPER_NAME = 'Alex Demo';

export interface DemoSub {
  key: string;
  company: string;
  contact: string;
  trade: SubTrade;
  /** CSI division and the label of the budget line it is bought against. */
  div: string;
  /** Subcontract amount at award, at cost. 0 = no subcontract in the demo. */
  contract: number;
  /** Changes to the subcontract the contractor carries himself (not an owner change order: those are their own commitments, money.ts). */
  change: number;
  what: string;
  n: number;
}

const S = (n: number, key: string, company: string, contact: string, trade: SubTrade, div: string, contract: number, change: number, what: string): DemoSub =>
  ({ key, company, contact, trade, div, contract, change, what, n });

export const SUBS: readonly DemoSub[] = [
  S(30, 'earthwork', 'Sample Earthwork Co.', 'Terry Digwell', 'Other', '31', 668_000, 0, 'Support of excavation, mass excavation, backfill and site utilities'),
  S(31, 'concrete', 'Sample Concrete Co.', 'Quinn Formwork', 'Concrete', '03', 2_418_000, 0, 'Footings, foundation walls, slab on grade and podium deck'),
  S(32, 'masonry', 'Sample Masonry Co.', 'Blake Brickman', 'Other', '04', 362_000, 0, 'Brick veneer and shaft walls'),
  S(33, 'framing', 'Sample Framing Co.', 'Skyler Studwell', 'Framing', '05', 2_058_000, 0, 'Light-gauge wall panels, floor deck, roof framing and stairs'),
  S(34, 'millwork', 'Sample Millwork Co.', 'Reese Cabinet', 'Millwork', '06', 624_000, 0, 'Unit cabinets, tops, trim and lobby millwork'),
  S(35, 'roofing', 'Sample Roofing and Waterproofing Co.', 'Harper Membrane', 'Roofing', '07', 1_104_000, 0, 'Below-grade waterproofing, roof membrane, insulation subcontract and flashing'),
  S(36, 'glazing', 'Sample Glazing Co.', 'Rowan Paneworth', 'Glazing', '08', 1_292_000, 0, 'Windows, storefront, doors and hardware'),
  S(37, 'drywall', 'Sample Drywall Co.', 'Emerson Tapewell', 'Drywall', '09', 2_246_000, 88_000, 'Drywall, paint, flooring and tile under one finishes subcontract'),
  S(38, 'elevator', 'Sample Elevator Co.', 'Finley Hoistman', 'Other', '14', 548_000, 0, 'Two traction elevators'),
  S(39, 'fire', 'Sample Fire Protection Co.', 'Sage Sprinkle', 'Fire Protection', '21', 462_000, 0, 'Sprinkler system and fire alarm'),
  S(40, 'plumbing', 'Sample Plumbing Co.', 'Kendall Pipewright', 'Plumbing', '22', 1_236_000, 0, 'Plumbing rough-in, fixtures and domestic water'),
  S(41, 'hvac', 'Sample Mechanical Co.', 'Devon Ductworth', 'HVAC', '23', 1_322_000, 0, 'Unit heat pumps, corridor ventilation and retail shell mechanical'),
  S(42, 'electrical', 'Sample Electric Co.', 'Marlow Wireman', 'Electrical', '26', 1_548_000, 0, 'Power, lighting, low voltage and service entrance'),
  S(43, 'landscape', 'Sample Landscape Co.', 'Arden Greenfield', 'Landscaping', '32', 356_000, 0, 'Sidewalks, paving, planting and site furnishings'),
  // On the bidders list, never awarded: no subcontract, shown so the directory has depth.
  S(44, 'paint', 'Sample Painting Co.', 'Ellis Brushby', 'Painting', '09', 0, 0, 'Painting (works under the finishes subcontract)'),
  S(45, 'flooring', 'Sample Flooring Co.', 'Shiloh Plankton', 'Flooring', '09', 0, 0, 'Flooring and tile (works under the finishes subcontract)'),
  S(46, 'insulation', 'Sample Insulation Co.', 'Oakley Battson', 'Other', '07', 0, 0, 'Insulation and firestopping (works under the roofing and waterproofing subcontract)'),
];

export const sub = (key: string): DemoSub => {
  const s = SUBS.find((x) => x.key === key);
  if (!s) throw new Error(`unknown demo sub: ${key}`);
  return s;
};
export const subPhone = (s: DemoSub): string => phone(s.n);
export const subEmail = (s: DemoSub): string => email(s.key === 'hvac' ? 'office.mechanical' : `office.${s.key}`);

export const EMAIL_RULE = /^[a-z0-9.]+@example\.com$/;
export const PHONE_RULE = /^\(410\) 555-01\d\d$/;
