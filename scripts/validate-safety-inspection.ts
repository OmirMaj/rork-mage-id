// validate-safety-inspection.ts — unit tests for utils/safety/inspectionScore.
// Run via: bun run scripts/validate-safety-inspection.ts
import { scoreInspection, inspectionItemsFromTemplate, hazardFromFailedItem } from '../utils/safety/inspectionScore';
import type { InspectionItem } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T){ const ok = JSON.stringify(got)===JSON.stringify(want); if(ok){pass++;console.log('  ✓',name);}else{fail++;console.log('  ✗',name,'\n   got:',got,'\n   want:',want);} }

console.log('\nsafety inspection validation:');

const items: InspectionItem[] = [
  { id: '1', prompt: 'Guardrails in place', result: 'pass' },
  { id: '2', prompt: 'Fire extinguisher tagged', result: 'fail', note: 'Missing tag', photoUrl: 'p.jpg' },
  { id: '3', prompt: 'Eyewash station clear', result: 'na' },
  { id: '4', prompt: 'PPE worn', result: 'pass' },
];

const s = scoreInspection(items);
expect('pass count', s.pass, 2);
expect('fail count', s.fail, 1);
expect('na count', s.na, 1);
expect('total', s.total, 4);
expect('score = 2/3', s.score, 2 / 3);
expect('all-na → score 1', scoreInspection([{ id: 'x', prompt: 'q', result: 'na' }]).score, 1);
expect('empty → score 1', scoreInspection([]).score, 1);
expect('all-pass → 1', scoreInspection([{ id: 'a', prompt: 'q', result: 'pass' }]).score, 1);
expect('all-fail → 0', scoreInspection([{ id: 'a', prompt: 'q', result: 'fail' }]).score, 0);

// template → checklist items
let n = 0; const mk = () => `it-${++n}`;
const derived = inspectionItemsFromTemplate({ fields: [{ id: 'f1', label: 'Guardrails?' }, { id: 'f2', label: 'PPE?' }] }, mk);
expect('template → 2 items', derived.length, 2);
expect('first prompt from label', derived[0].prompt, 'Guardrails?');
expect('items default to na', derived[1].result, 'na');
expect('ids from makeId', derived[0].id, 'it-1');

// fail → hazard mapping
const hz = hazardFromFailedItem(
  { id: 'insp1', projectId: 'proj1', createdBy: 'user1' },
  items[1],
  '2026-07-08T00:00:00.000Z',
  'haz1',
);
expect('hazard id', hz.id, 'haz1');
expect('hazard links inspection', hz.sourceInspectionId, 'insp1');
expect('hazard projectId', hz.projectId, 'proj1');
expect('hazard description = prompt', hz.description, 'Fire extinguisher tagged');
expect('hazard correctiveAction = note', hz.correctiveAction, 'Missing tag');
expect('hazard photo carried over', hz.photoUrl, 'p.jpg');
expect('hazard severity default', hz.severity, 3);
expect('hazard likelihood default', hz.likelihood, 3);
expect('hazard riskScore = 9', hz.riskScore, 9);
expect('hazard status open', hz.status, 'open');
expect('hazard createdBy', hz.createdBy, 'user1');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
