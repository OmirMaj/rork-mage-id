// validate-glossary.ts — pins constants/glossary.ts (powers <InfoBubble>).
// Run: bun run scripts/validate-glossary.ts
import { GLOSSARY, getGlossaryEntry } from '../constants/glossary';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

console.log('\nglossary:');

const entries = Object.entries(GLOSSARY);
ok('has a meaningful set of terms (≥12)', entries.length >= 12, `found ${entries.length}`);

for (const [mapKey, e] of entries) {
  ok(`${mapKey}: key matches map key`, e.key === mapKey, `key=${e.key}`);
  ok(`${mapKey}: snake_case key`, /^[a-z][a-z0-9_]*$/.test(e.key));
  ok(`${mapKey}: non-empty term`, typeof e.term === 'string' && e.term.trim().length > 0);
  ok(`${mapKey}: non-empty 'what'`, typeof e.what === 'string' && e.what.trim().length > 0);
  ok(`${mapKey}: non-empty 'why'`, typeof e.why === 'string' && e.why.trim().length > 0);
  ok(`${mapKey}: 'what' is a real sentence (>20 chars)`, e.what.trim().length > 20);
}

// getGlossaryEntry behaves
ok('getGlossaryEntry returns a known term', getGlossaryEntry('change_order')?.term === 'Change Order');
ok('getGlossaryEntry returns null for unknown', getGlossaryEntry('not_a_real_term') === null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
