// validate-ux-client-contact — "the client is a field on the job" (UX wave, Lane 0).
//
// WHAT IT PROVES. resolveClientContact (utils/clientContact.ts) is what every
// sender pre-fills from: the contract email, the CO approver, the portal
// invite, the invoice bill-to. It must follow one order (primaryContact →
// first portal invitee with an '@' → the last recipient; for invoices the
// billed-to address first, exactly like reminderRecipient and the
// invoice-dunning cron), and it must NEVER invent a recipient. The patch
// builder must never enable a portal or add an invite to one that is off.
//
// Run: bun run scripts/validate-ux-client-contact.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  resolveClientContact, seedClientEverywhere, isUsableEmail, isUsablePhone, NO_CLIENT_ON_FILE,
} from '../utils/clientContact';
import { reminderRecipient } from '../utils/billingFlowCore';
import type { ClientPortalSettings, ClientPortalInvite } from '../types';

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

const invite = (email: string, name = ''): ClientPortalInvite => ({ id: `i-${email}`, email, name, invitedAt: '2026-09-01T00:00:00Z', status: 'pending' });
const portal = (invites: ClientPortalInvite[], enabled = true): ClientPortalSettings => ({
  enabled, portalId: 'p1', showSchedule: true, showChangeOrders: true, showInvoices: true, showPhotos: true,
  showBudgetSummary: false, showDailyReports: false, showPunchList: false, showRFIs: false, showDocuments: false, invites,
});

console.log('\nux client-contact validation:');

console.log('\n1. what counts as reachable');
ok('a normal address is usable', isUsableEmail(' tom@arch.com '));
ok('"n/a", "@x", "x@" and "a b@c" are not', !isUsableEmail('n/a') && !isUsableEmail('@x') && !isUsableEmail('x@') && !isUsableEmail('a b@c.com'));
ok('a 10-digit phone is usable; "TBD" and "12345" are not', isUsablePhone('(917) 555-0100') && !isUsablePhone('TBD') && !isUsablePhone('12345'));

console.log('\n2. the default order');
{
  const p = { primaryContact: { name: 'Amy Reyes', email: 'amy@home.com', phone: '917-555-0100' }, clientPortal: portal([invite('spouse@home.com', 'Ben')]) };
  eq('primaryContact wins', resolveClientContact(p), { name: 'Amy Reyes', source: 'primary_contact', email: 'amy@home.com', phone: '917-555-0100' });
}
{
  const p = { clientPortal: portal([invite('nope'), invite('ben@home.com', 'Ben')]) };
  eq('no primaryContact → the first invitee WITH an @', resolveClientContact(p), { name: 'Ben', source: 'portal_invite', email: 'ben@home.com' });
}
{
  const p = { clientPortal: portal([]) };
  eq('nothing on the job → the last recipient he used', resolveClientContact(p, { lastRecipient: { email: 'tom@arch.com', name: 'Tom' } }), { name: 'Tom', source: 'last_recipient', email: 'tom@arch.com' });
}
{
  const p = { primaryContact: { name: 'Amy', phone: '917-555-0100' }, clientPortal: portal([invite('ben@home.com', 'Ben')]) };
  eq('a phone-only primaryContact wins for a text', resolveClientContact(p, { need: 'phone' })?.source, 'primary_contact');
  eq('…but for an EMAIL it does not hide the invitee\'s address', resolveClientContact(p, { need: 'email' })?.email, 'ben@home.com');
  const inv = resolveClientContact(p, { need: 'email' });
  ok('…and the invitee does not borrow Amy\'s phone or name (never fabricate a person)', inv?.phone === undefined && inv?.name === 'Ben');
  eq('need:"phone" with no phone anywhere → null', resolveClientContact({ clientPortal: portal([invite('ben@home.com')]) }, { need: 'phone' }), null);
}

console.log('\n3. invoices: the billed-to address wins, like the reminder cron');
{
  const p = { primaryContact: { name: 'Amy', email: 'amy@home.com' }, clientPortal: portal([invite('ap@office.com', 'Accounts')]) };
  eq('billToEmail wins over primaryContact', resolveClientContact(p, { billToEmail: 'ap@office.com' })?.email, 'ap@office.com');
  eq('…named from the invite with the SAME address', resolveClientContact(p, { billToEmail: 'AP@office.com' })?.name, 'Accounts');
  eq('…source bill_to', resolveClientContact(p, { billToEmail: 'ap@office.com' })?.source, 'bill_to');
  eq('a blank billToEmail is ignored', resolveClientContact(p, { billToEmail: '  ' })?.source, 'primary_contact');
  // Agreement with reminderRecipient for every invoice case the cron sees
  // (no primaryContact, so both read the same two sources).
  const cases: [string | null, ClientPortalInvite[]][] = [
    ['bill@x.com', [invite('inv@x.com')]], [null, [invite('inv@x.com')]], ['', [invite('bad'), invite('two@x.com')]],
    [null, []], ['nope', []],
  ];
  const agree = cases.every(([bill, invs]) => {
    const mine = resolveClientContact({ clientPortal: portal(invs) }, { billToEmail: bill, need: 'email' })?.email ?? null;
    return mine === reminderRecipient(bill, invs);
  });
  ok('for invoices it names the same address reminderRecipient() does, in every case', agree);
}

console.log('\n4. it never fabricates');
eq('an empty project → null', resolveClientContact({}), null);
eq('a null project → null', resolveClientContact(null), null);
eq('a name with no email or phone → null (nobody to reach)', resolveClientContact({ primaryContact: { name: 'Amy' } }), null);
eq('garbage fields → null', resolveClientContact({ primaryContact: { name: 'Amy', email: 'n/a', phone: 'TBD' } }), null);
ok('the empty-state line', NO_CLIENT_ON_FILE === 'No client on file');

console.log('\n5. seedClientEverywhere');
{
  const opts = { newId: () => 'new-1', nowIso: '2026-09-27T12:00:00Z' };
  const bare = { primaryContact: { name: 'Amy', phone: '917-555-0100' }, clientPortal: portal([], false) };
  const patch = seedClientEverywhere(bare, { email: 'amy@home.com' }, opts);
  eq('writes the email onto primaryContact, keeping the name and phone', patch.primaryContact, { name: 'Amy', phone: '917-555-0100', email: 'amy@home.com' });
  ok('adds NO invite when the caller did not say the portal is being turned on', patch.clientPortal === undefined);
  const on = seedClientEverywhere(bare, { email: 'amy@home.com' }, { ...opts, portalBeingEnabled: true });
  eq('adds exactly one pending invite when it is', on.clientPortal?.invites, [{ id: 'new-1', email: 'amy@home.com', name: 'Amy', invitedAt: '2026-09-27T12:00:00Z', status: 'pending' }]);
  ok('…and never flips `enabled` itself (the confirm is the caller\'s)', on.clientPortal?.enabled === false);
  const dup = seedClientEverywhere({ ...bare, clientPortal: portal([invite('AMY@home.com')]) }, { email: 'amy@home.com' }, { ...opts, portalBeingEnabled: true });
  ok('no duplicate invite (case-insensitive)', dup.clientPortal === undefined);
  eq('a blank field never erases one on file', seedClientEverywhere(bare, { name: '', phone: '' }, opts), {});
  eq('unchanged contact → empty patch', seedClientEverywhere({ primaryContact: { name: 'Amy', email: 'amy@home.com' } }, { name: 'Amy', email: 'amy@home.com' }, opts), {});
  eq('an unusable email is not written', seedClientEverywhere(bare, { email: 'n/a' }, { ...opts, portalBeingEnabled: true }), {});
  ok('no portal settings at all → no invite (the caller sets the portal up first)', seedClientEverywhere({}, { email: 'a@b.com' }, { ...opts, portalBeingEnabled: true }).clientPortal === undefined);
}

console.log('\n6. source pins');
{
  const src = read('utils/clientContact.ts').replace(/\/\/.*$/gm, '');
  ok('no enabled: true anywhere (it can never switch a portal on)', !/enabled:\s*true/.test(src));
  ok('pure: no react / react-native / storage import', !/from 'react(-native)?'|AsyncStorage|supabase/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
console.log('ALL PASS');
