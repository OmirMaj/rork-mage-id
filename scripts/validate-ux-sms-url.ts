// validate-ux-sms-url — the ONE sms: builder (UX wave, Lane 0).
//
// WHAT IT PROVES. utils/smsUrl.ts is buildDispatchSmsUrl moved verbatim out of
// utils/propertyMirror.ts; the old name is a re-export of the SAME function,
// so the work-order dispatch and the lineup texts can never drift apart.
//
// Run: bun run scripts/validate-ux-sms-url.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { smsUrl } from '../utils/smsUrl';
import { buildDispatchSmsUrl } from '../utils/propertyMirror';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  PASS  ' + name); return; }
  fail++;
  console.error('  FAIL  ' + name + (detail ? `\n        ${detail}` : ''));
}
function eq<T>(name: string, actual: T, expected: T) {
  ok(name, actual === expected, `expected ${String(expected)}, got ${String(actual)}`);
}

console.log('\nux sms-url validation:');
const body = { body: 'Tomorrow 7:00 AM · Henderson\nFraming crew & 2 laborers' };
const enc = encodeURIComponent(body.body);
eq('iOS: &body= after the number', smsUrl('(917) 555-0100', body, 'ios'), `sms:9175550100&body=${enc}`);
eq('Android: ?body=', smsUrl('917-555-0100', body, 'android'), `sms:9175550100?body=${enc}`);
eq('web: ?body=', smsUrl('917.555.0100', body, 'web'), `sms:9175550100?body=${enc}`);
eq('an unknown platform takes ?body=', smsUrl('1', { body: 'x' }, 'windows'), 'sms:1?body=x');
eq('keeps a leading + (international)', smsUrl('+1 917 555 0100', { body: 'x' }, 'ios'), 'sms:+19175550100&body=x');
ok('the body is fully encoded (newline, &, #, ?)', smsUrl('1', { body: 'a&b#c?d\ne' }, 'ios') === 'sms:1&body=a%26b%23c%3Fd%0Ae');
ok('the old name is the SAME function (a re-export, not a copy)', buildDispatchSmsUrl === smsUrl);
{
  const pm = read('utils/propertyMirror.ts');
  ok('propertyMirror.ts re-exports it and keeps no body of its own',
    /export \{ smsUrl as buildDispatchSmsUrl \} from '@\/utils\/smsUrl';/.test(pm) && !/function buildDispatchSmsUrl/.test(pm));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
console.log('ALL PASS');
