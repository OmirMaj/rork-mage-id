// scripts/validate-plan-answer.ts — pure-fn validator for planAnswer.
import { buildAskPrompt, citedSheetRefs, type PlanMatch } from '../utils/plans/planAnswer';

let pass = 0, fail = 0;
function ok(n: string, c: boolean) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

const matches: PlanMatch[] = [
  { doc_id: 'plan-sheet:s2', source: 'Plan Sheet', ref: 'S-201', content: 'Beam on grid 4: W12x26.', similarity: 0.82 },
  { doc_id: 'plan-sheet:e3', source: 'Plan Sheet', ref: 'E-301', content: 'Panel: 200A, 42 circuits.', similarity: 0.44 },
];
const p = buildAskPrompt('what beam is on grid 4?', matches);
ok('prompt carries the question', p.includes('what beam is on grid 4?'));
ok('prompt includes sheet refs as sources', p.includes('S-201') && p.includes('E-301'));
ok('prompt includes the content', p.includes('W12x26'));
ok('prompt forbids hallucination', /only.*sheets|do not|prefer.*not found|if.*not.*say/i.test(p));
ok('prompt asks for a citation', /cite|sheet/i.test(p));

ok('no matches → prompt still safe (say not found)', /not found|couldn.t find|no/i.test(buildAskPrompt('x', [])));

ok('citedSheetRefs extracts refs mentioned in an answer', JSON.stringify(citedSheetRefs('It is on Sheet S-201.', matches)) === JSON.stringify([{ ref: 'S-201', sheetId: 's2' }]));
ok('citedSheetRefs empty when none named', citedSheetRefs('Not found.', matches).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
