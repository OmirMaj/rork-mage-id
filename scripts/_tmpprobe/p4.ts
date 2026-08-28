import { computeSubScorecards } from '../../utils/subScorecard';
import type { Subcontractor, RFI } from '../../types';

const sub: Subcontractor = {
  id: 's1', companyName: 'Acme Drywall', trade: 'Drywall',
  contactName: 'A', phone: '1', email: 'a@b.c', w9OnFile: true,
  coiExpiry: '2027-01-01', licenseExpiry: '2027-01-01',
} as unknown as Subcontractor;

const mk = (id: string, opts: { chain: boolean; open: boolean }): RFI => ({
  id, projectId: 'p', number: id, subject: id, question: 'q',
  status: opts.open ? 'open' : 'closed',
  ballInCourt: opts.open ? 'sub' : 'closed',
  dateSubmitted: '2026-08-01T00:00:00.000Z',
  assignedSubId: 's1',
  ...(opts.chain ? { handoffs: [
    { fromParty: 'gc', toParty: 'sub', at: '2026-08-01T00:00:00.000Z' },
    ...(opts.open ? [] : [{ fromParty: 'sub', toParty: 'gc', at: '2026-08-04T00:00:00.000Z' }]),
  ] } : {}),
} as unknown as RFI);

// X: legacy row, NO handoff chain -> not measurable. Closed.
// Y: measurable, still open with the sub.
// Z: measurable, still open with the sub.
const rfis = [ mk('X', { chain: false, open: false }), mk('Y', { chain: true, open: true }), mk('Z', { chain: true, open: true }) ];

const res = computeSubScorecards({ subcontractors: [sub], commitments: [], rfis });
const card = res.cards[0];
const f = card.factors.find(x => x.key === 'rfi_responsiveness')!;
console.log('  applicable =', f.applicable);
console.log('  detail     =', JSON.stringify(f.detail));
console.log('  TRUTH: 2 measurable RFIs (Y and Z) are still sitting with the sub.');

// Second shape: no unmeasurable rows -> indices line up, answer is right.
const rfis2 = [ mk('Y', { chain: true, open: true }), mk('Z', { chain: true, open: true }) ];
const f2 = computeSubScorecards({ subcontractors: [sub], commitments: [], rfis: rfis2 }).cards[0]
  .factors.find(x => x.key === 'rfi_responsiveness')!;
console.log('  control (no legacy row) detail =', JSON.stringify(f2.detail));
