// validate-ux-routes — the route-param contract between the UX lanes (Lane 0).
//
// WHAT IT PROVES. Every new door in the UX wave is sent by one lane and read
// by another. utils/uxRoutes.ts fixes the names; this proves the builders say
// what the table says, a flag is on only for exactly '1', every pathname is a
// real screen, and the milestone invoice builder sends the same params as
// contract.tsx's "Create invoice" row.
//
// Run: bun run scripts/validate-ux-routes.ts

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  UX_PARAM, SOURCE_PROJECT, FROM_JOB, readParam, readFlag, readUxDoorParams,
  punchListNewHref, deliveryArrivedHref, clockInHref, tomorrowLineupHref, codeCheckFromJobHref,
  scheduleFromJobHref, photoTriageHref, subPortalSetupHref, invoiceForMilestoneHref,
} from '../utils/uxRoutes';

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
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(name, a === e, `expected ${e}, got ${a}`);
}

console.log('\nux route-contract validation:');

console.log('\n1. the table');
eq('/punch-list?projectId&new=1', punchListNewHref('p'), { pathname: '/punch-list', params: { projectId: 'p', new: '1' } });
eq('/deliveries?projectId&arrived=1', deliveryArrivedHref('p'), { pathname: '/deliveries', params: { projectId: 'p', arrived: '1' } });
eq('/time-tracking?projectId&clockIn=1', clockInHref('p'), { pathname: '/time-tracking', params: { projectId: 'p', clockIn: '1' } });
eq('/tomorrow-lineup?projectId', tomorrowLineupHref('p'), { pathname: '/tomorrow-lineup', params: { projectId: 'p' } });
eq('/(tabs)/construction-ai?projectId&source=project', codeCheckFromJobHref('p'), { pathname: '/(tabs)/construction-ai', params: { projectId: 'p', source: 'project' } });
eq('/(tabs)/schedule?projectId&from=job', scheduleFromJobHref('p'), { pathname: '/(tabs)/schedule', params: { projectId: 'p', from: 'job' } });
eq('/photo-triage?projectId', photoTriageHref('p'), { pathname: '/photo-triage', params: { projectId: 'p' } });
eq('/sub-portal-setup?projectId&subId', subPortalSetupHref('p', 's'), { pathname: '/sub-portal-setup', params: { projectId: 'p', subId: 's' } });
eq('the param names', UX_PARAM, { projectId: 'projectId', newItem: 'new', arrived: 'arrived', clockIn: 'clockIn', source: 'source', from: 'from', milestoneId: 'milestoneId', subId: 'subId' });
ok('source=project, from=job', SOURCE_PROJECT === 'project' && FROM_JOB === 'job');

console.log('\n2. every pathname is a real screen');
for (const h of [punchListNewHref('p'), deliveryArrivedHref('p'), clockInHref('p'), tomorrowLineupHref('p'), codeCheckFromJobHref('p'),
  scheduleFromJobHref('p'), photoTriageHref('p'), subPortalSetupHref('p', 's'), invoiceForMilestoneHref({ projectId: 'p', contractId: 'c', milestoneId: 'm', line: {}, note: '' })]) {
  const rel = h.pathname.replace(/^\//, '');
  const file = ['app/' + rel + '.tsx', 'app/' + rel + '/index.tsx'].find(f => existsSync(join(ROOT, f)));
  ok(`${h.pathname} exists`, !!file);
}

console.log('\n3. receivers: a flag is on only for exactly "1"');
ok('"1" is on', readFlag('1') && readFlag(['1', '0']) && readFlag(' 1 '));
ok('"true", "0", "", undefined, null, ["0","1"] are off', !readFlag('true') && !readFlag('0') && !readFlag('') && !readFlag(undefined) && !readFlag(null) && !readFlag(['0', '1']));
eq('readParam trims and drops blanks', [readParam(' p1 '), readParam('  '), readParam(['a', 'b']), readParam(undefined)], ['p1', null, 'a', null]);
eq('readUxDoorParams reads every door', readUxDoorParams({ projectId: 'p', new: '1', arrived: '0', clockIn: '1', source: 'project', from: 'job' }),
  { projectId: 'p', openNew: true, openArrived: false, openClockIn: true, source: 'project', fromProjectSource: true, fromJob: true });
eq('…a punch/plan-sheet source is carried raw (the screen parses all three)', readUxDoorParams({ source: 'punch' }).source, 'punch');
eq('…and nothing set means nothing opens', readUxDoorParams({}), { projectId: null, openNew: false, openArrived: false, openClockIn: false, source: null, fromProjectSource: false, fromJob: false });

console.log('\n4. milestone invoice params = contract.tsx\'s Create invoice row');
{
  const line = { description: 'Deposit', quantity: 1, unit: 'ls', unitPrice: 4500, total: 4500 };
  const dep = invoiceForMilestoneHref({ projectId: 'p', contractId: 'c', milestoneId: 'm1', line, note: 'Deposit per contract', terms: 'due_on_receipt', trigger: 'on_signing', depositNoRetainage: true });
  eq('a deposit sends every key', dep, { pathname: '/invoice', params: { projectId: 'p', type: 'quick', prefillLines: JSON.stringify([line]), prefillNotes: 'Deposit per contract', milestoneId: 'm1', contractId: 'c', contractTerms: 'due_on_receipt', milestoneTrigger: 'on_signing', depositNoRetainage: '1' } });
  const mid = invoiceForMilestoneHref({ projectId: 'p', contractId: 'c', milestoneId: 'm2', line, note: 'n', terms: null, trigger: 'on_rough', depositNoRetainage: false });
  ok('no terms → no contractTerms and no milestoneTrigger; no deposit → no depositNoRetainage', !('contractTerms' in mid.params) && !('milestoneTrigger' in mid.params) && !('depositNoRetainage' in mid.params));
  const c = read('app/contract.tsx');
  const at = c.indexOf("type: 'quick',");
  const block = at >= 0 ? c.slice(c.lastIndexOf("pathname: '/invoice'", at), c.indexOf('} as never);', at)) : '';
  const keys = ['projectId', "type: 'quick'", 'prefillLines: JSON.stringify([effect.line])', 'prefillNotes: effect.note', 'milestoneId: effect.milestoneId', 'contractId: contract.id',
    'contractTerms: effect.terms, milestoneTrigger: m.trigger', "depositNoRetainage: '1'"];
  const missing = keys.filter(k => !block.includes(k));
  ok('contract.tsx still sends exactly these params (else this builder is stale)', block.length > 0 && missing.length === 0, missing.join(', '));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
console.log('ALL PASS');
