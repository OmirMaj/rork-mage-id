// Validator: computeRFILatency basic contract
import { computeRFILatency } from '../utils/rfiLatency';
import type { RFI } from '../types';

const baseRFI: RFI = {
  id: 'r1', projectId: 'p1', number: 1,
  subject: 'Test RFI', question: 'Is this test?',
  submittedBy: 'gc', assignedTo: 'architect',
  ballInCourt: 'architect',
  status: 'answered', priority: 'normal',
  attachments: [],
  dateSubmitted: '2026-01-01', dateRequired: '2026-01-10',
  dateResponded: '2026-01-08',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

// 1. empty input → null factLine
const empty = computeRFILatency([]);
console.assert(empty.factLine === null, 'empty → null factLine');

// 2. single response → null (< 2 samples)
const one = computeRFILatency([baseRFI]);
console.assert(one.factLine === null, 'one sample → null factLine');
console.assert(one.medianResponseDays === 7, `median should be 7, got ${one.medianResponseDays}`);

// 3. two responses → fact line present
const two = computeRFILatency([baseRFI, { ...baseRFI, id: 'r2', dateResponded: '2026-01-15' }]);
console.assert(two.factLine !== null, 'two samples → factLine present');
console.assert(typeof two.factLine === 'string', 'factLine is string');

// 4. overdue count
const overdue = computeRFILatency([{ ...baseRFI, dateResponded: undefined, dateRequired: '2026-01-02' }]);
console.assert(overdue.overdueCount === 1, 'overdue count = 1');

console.log('validate-rfi-latency: all assertions passed');
