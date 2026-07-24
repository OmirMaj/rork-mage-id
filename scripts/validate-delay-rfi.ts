// validate-delay-rfi.ts — unit tests for the Delay Cascade + RFI Brain pure
// engine: delay prompt grounding + coercion, strict task-title matching,
// RFI critical-path block status. Run via: bun run test:delay-rfi
import { buildDelayPrompt, coerceDelayResult, hashDelayText, DELAY_SCHEMA_HINT, MAX_DELAY_HITS, MAX_DELTA_DAYS } from '../utils/delayScan/delayPrompt';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got:  ', JSON.stringify(got), '\n      want: ', JSON.stringify(want)); }
}

console.log('\ndelayScan buildDelayPrompt:');

const TITLES = ['Electrical rough-in', 'Drywall hang', 'Paint interior'];
const prompt = buildDelayPrompt('Inspector no-show this morning — electrical rough-in pushed 2 days. Also drywall stack got rained on.', TITLES);

expect('embeds the issues text', prompt.includes('electrical rough-in pushed 2 days'), true);
expect('lists every task title', prompt.includes('- Electrical rough-in') && prompt.includes('- Drywall hang') && prompt.includes('- Paint interior'), true);
expect('rule: guess must be verbatim from the list or empty', /VERBATIM/.test(prompt), true);
expect('rule: prefer empty over speculation', /empty hits list over speculation/i.test(prompt), true);
expect('rule: quote the exact phrase', /exact phrase/i.test(prompt), true);
expect('rule: vague delay defaults to 1 day', /minimum 1/.test(prompt), true);
expect('empty task list stays safe', buildDelayPrompt('x', []).includes('(no tasks)'), true);
expect('schema hint carries the hit shape', Object.keys(DELAY_SCHEMA_HINT.hits[0]).sort(), ['deltaDays', 'quote', 'taskTitleGuess']);

console.log('\ndelayScan hashDelayText:');
expect('stable for identical input', hashDelayText('rain delay') === hashDelayText('rain delay'), true);
expect('changes when text changes', hashDelayText('rain delay') === hashDelayText('rain delay tomorrow'), false);
expect('ignores case and outer whitespace', hashDelayText('  Rain Delay ') === hashDelayText('rain delay'), true);

console.log('\ndelayScan coerceDelayResult:');
const goodHit = { taskTitleGuess: 'Electrical rough-in', deltaDays: 2, quote: 'rough-in pushed 2 days' };
expect('accepts the {hits:[...]} envelope', coerceDelayResult({ hits: [goodHit] }).hits.length, 1);
expect('accepts a bare array', coerceDelayResult([goodHit]).hits[0].taskTitleGuess, 'Electrical rough-in');
expect('clamps deltaDays below 1 up to 1', coerceDelayResult({ hits: [{ ...goodHit, deltaDays: 0 }] }).hits[0].deltaDays, 1);
expect('rounds fractional deltaDays', coerceDelayResult({ hits: [{ ...goodHit, deltaDays: 2.6 }] }).hits[0].deltaDays, 3);
expect('missing deltaDays defaults to 1', coerceDelayResult({ hits: [{ taskTitleGuess: '', quote: 'delayed by weather' }] }).hits[0].deltaDays, 1);
expect('caps oversize deltaDays', coerceDelayResult({ hits: [{ ...goodHit, deltaDays: 999 }] }).hits[0].deltaDays, MAX_DELTA_DAYS);
expect('drops hits without a quote', coerceDelayResult({ hits: [{ taskTitleGuess: 'Drywall hang', deltaDays: 3 }] }).hits.length, 0);
expect('missing guess defaults to empty string', coerceDelayResult({ hits: [{ quote: 'stuck on inspection' }] }).hits[0].taskTitleGuess, '');
expect('junk input → empty hits', coerceDelayResult('nope').hits.length, 0);
expect('caps the hit count', coerceDelayResult({ hits: Array.from({ length: 9 }, (_, i) => ({ quote: `q${i}` })) }).hits.length, MAX_DELAY_HITS);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
