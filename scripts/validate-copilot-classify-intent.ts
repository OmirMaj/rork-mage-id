// scripts/validate-copilot-classify-intent.ts — pure-fn validator for the
// universal router's id coercion + intent table.
import { coerceCapabilityId, INTENTS } from '../utils/copilot/intentTable';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

ok('valid id coerced through', coerceCapabilityId('rfi') === 'rfi');
ok('another valid id', coerceCapabilityId('safety_incident') === 'safety_incident');
ok('unknown string → null', coerceCapabilityId('order_pizza') === null);
ok('null → null', coerceCapabilityId(null) === null);
ok('undefined → null', coerceCapabilityId(undefined) === null);
ok('number → null', coerceCapabilityId(7) === null);
ok('object → null', coerceCapabilityId({ id: 'rfi' }) === null);
ok('intent ids are unique', new Set(INTENTS.map((i) => i.id)).size === INTENTS.length);
ok('router covers 11 field capabilities', INTENTS.length === 11);
ok('every intent has a label + hint', INTENTS.every((i) => !!i.label && !!i.hint));
ok('every intent id is coercible', INTENTS.every((i) => coerceCapabilityId(i.id) === i.id));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
