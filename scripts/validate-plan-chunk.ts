// scripts/validate-plan-chunk.ts — pure-fn validator for planChunk.
import { sheetToDocs, sheetIdFromDocId, type ExtractedSheet } from '../utils/plans/planChunk';

let pass = 0, fail = 0;
function ok(n: string, c: boolean) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

const sheet: ExtractedSheet = { sheetId: 'abc', sheetNumber: 'S-201', text: 'Beam on grid 4 is W12x26. Panel schedule note 3.' };
const docs = sheetToDocs(sheet);
ok('one doc for a short sheet', docs.length === 1);
ok('source is Plan Sheet', docs[0].source === 'Plan Sheet');
ok('ref is the sheet number', docs[0].ref === 'S-201');
ok('doc_id encodes the sheet id', docs[0].doc_id === 'plan-sheet:abc');
ok('content carries the text', docs[0].content.includes('W12x26'));

const big: ExtractedSheet = { sheetId: 'x', sheetNumber: 'A-1', text: 'z'.repeat(9000) };
const bigDocs = sheetToDocs(big);
ok('splits >8000 chars into multiple chunks', bigDocs.length >= 2);
ok('chunk doc_ids are unique + suffixed', bigDocs[0].doc_id === 'plan-sheet:x#0' && bigDocs[1].doc_id === 'plan-sheet:x#1');
ok('every chunk ≤ 8000 chars', bigDocs.every(d => d.content.length <= 8000));

ok('sheetIdFromDocId parses single', sheetIdFromDocId('plan-sheet:abc') === 'abc');
ok('sheetIdFromDocId parses chunked', sheetIdFromDocId('plan-sheet:x#1') === 'x');
ok('sheetIdFromDocId ignores non-plan docs', sheetIdFromDocId('RFI#12') === null);
ok('empty text → no docs', sheetToDocs({ sheetId: 'e', sheetNumber: 'E', text: '   ' }).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
