// validate-ux-remind-invoice — ONE way to chase an invoice (UX wave, Lane 0).
//
// WHAT IT PROVES. remindInvoice (utils/remindInvoice.ts) is the only path a
// manual payment reminder takes — the invoice screen, the payments list and
// the desktop dock all call it. Every guard runs in order: a sample never
// sends and never asks; a QuickBooks-closed invoice asks first unless the
// caller already asked; the server's answer is told in the invoice screen's
// own words; and only a real send carries the dunning-marker patch. The copy
// is pinned to the strings invoice.tsx used before the extraction, so the
// move is provably verbatim.
//
// Run: bun run scripts/validate-ux-remind-invoice.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  remindInvoice, confirmViaAlert, qboClosedConfirmMessage, remindSentMessage,
  REMIND_NO_RECIPIENT, REMIND_FAILED_FALLBACK, REMIND_NOT_ELIGIBLE, REMIND_QBO_CLOSED_TITLE, REMIND_QBO_CONFIRM_LABEL,
  type RemindInvoiceDeps,
} from '../utils/remindInvoice';
import type { SendReminderResult } from '../utils/invoiceReminders';
import { QBO_CLOSED_WITHOUT_PAYMENT_PREFIX, qboClosedFlagAlertReason } from '../utils/qboClosedFlag';
import { SAMPLE_NOTHING_SENT } from '../utils/sampleGuard';
import { reminderBlockMessage, dunningStageLabel } from '../utils/billingFlowCore';
import type { AlertButton } from '../utils/alertCore';

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

interface Harness { deps: RemindInvoiceDeps; log: string[] }
function harness(result: SendReminderResult | Error, confirmAnswer = true): Harness {
  const log: string[] = [];
  return {
    log,
    deps: {
      send: async (id) => { log.push(`send:${id}`); if (result instanceof Error) throw result; return result; },
      confirm: async (title, message, label) => { log.push(`confirm:${title}|${label}|${message}`); return confirmAnswer; },
      onSendStart: () => { log.push('start'); },
      now: () => 1_000_000_000_000,
    },
  };
}
const FLAG = `${QBO_CLOSED_WITHOUT_PAYMENT_PREFIX} (credit memo CM-12).`;
const base = { invoiceId: 'inv-1', projectName: 'Henderson Residence' };
const SENT: SendReminderResult = { success: true, outcome: 'sent', stage: 2, sentAt: '2026-09-27T12:00:00Z', recipient: 'amy@home.com' };

async function main() {
  console.log('\nux remind-invoice validation:');

  console.log('\n1. a sample never sends and never asks');
  {
    const h = harness(SENT);
    const out = await remindInvoice({ ...base, projectName: 'Sample — Kitchen Remodel', qboError: FLAG }, h.deps);
    eq('kind sample, the shared sample line', [out.kind, out.title, out.message], ['sample', 'Sample Job', SAMPLE_NOTHING_SENT]);
    eq('no confirm, no spinner, no send', h.log, []);
  }

  console.log('\n2. QuickBooks closed it: ask first');
  {
    const h = harness(SENT, false);
    const out = await remindInvoice({ ...base, qboError: FLAG }, h.deps);
    eq('Cancel → cancelled, nothing sent', out.kind, 'cancelled');
    ok('…the question was asked with the screen\'s title, label and reason', h.log.length === 1
      && h.log[0] === `confirm:${REMIND_QBO_CLOSED_TITLE}|${REMIND_QBO_CONFIRM_LABEL}|${qboClosedFlagAlertReason(FLAG)} Send a reminder to the client anyway?`, h.log.join(' / '));
    const h2 = harness(SENT, true);
    const out2 = await remindInvoice({ ...base, qboError: FLAG }, h2.deps);
    eq('Send anyway → sent, in order: confirm, spinner, send', [out2.kind, h2.log.map(l => l.split(':')[0])], ['sent', ['confirm', 'start', 'send']]);
    const h3 = harness(SENT, false);
    await remindInvoice({ ...base, qboError: FLAG, qboClosedConfirmed: true }, h3.deps);
    ok('already confirmed by the caller → not asked twice', !h3.log.some(l => l.startsWith('confirm')) && h3.log.includes('send:inv-1'));
    const h4 = harness(SENT, false);
    await remindInvoice({ ...base, qboError: 'QBO 400 /invoice: something else' }, h4.deps);
    ok('a QuickBooks error that is NOT the closed flag does not ask', !h4.log.some(l => l.startsWith('confirm')));
    const throwing: RemindInvoiceDeps = { ...harness(SENT).deps, confirm: async () => { throw new Error('dialog gone'); } };
    eq('a confirm that throws counts as No', (await remindInvoice({ ...base, qboError: FLAG }, throwing)).kind, 'cancelled');
  }

  console.log('\n3. the server\'s answer, in the screen\'s words');
  {
    let out = await remindInvoice(base, harness({ success: false, error: 'This invoice hasn’t finished syncing yet.' }).deps);
    eq('a failed call shows the server\'s reason', [out.kind, out.title, out.message], ['failed', 'Reminder Not Sent', 'This invoice hasn’t finished syncing yet.']);
    out = await remindInvoice(base, harness({ success: false }).deps);
    eq('…or the fallback', out.message, REMIND_FAILED_FALLBACK);
    out = await remindInvoice(base, harness(new Error('network down')).deps);
    eq('a send that throws is a failed outcome, never a crash, and raw error text never reaches the alert', [out.kind, out.message], ['failed', REMIND_FAILED_FALLBACK]);
    out = await remindInvoice(base, harness(new Error('This invoice was voided by the client portal owner.')).deps);
    eq('…a thrown sentence written for a person is shown as it is', [out.kind, out.message], ['failed', 'This invoice was voided by the client portal owner.']);
    out = await remindInvoice(base, harness({ success: true, outcome: 'skipped', reason: 'no_recipient' }).deps);
    eq('no_recipient has its own kind and sentence', [out.kind, out.title, out.message], ['no_recipient', 'No Reminder Sent', REMIND_NO_RECIPIENT]);
    const last = 1_000_000_000_000 - 5 * 3_600_000;
    out = await remindInvoice({ ...base, lastReminderMs: last }, harness({ success: true, outcome: 'skipped', reason: 'too_soon' }).deps);
    eq('other skips use reminderBlockMessage with the last-sent time', [out.kind, out.message], ['skipped', reminderBlockMessage('too_soon', last, 1_000_000_000_000)]);
    out = await remindInvoice(base, harness({ success: true, outcome: 'skipped' }).deps);
    eq('a skip with no reason', out.message, REMIND_NOT_ELIGIBLE);
  }

  console.log('\n4. a real send');
  {
    const out = await remindInvoice(base, harness(SENT).deps);
    eq('the toast text', out.message, `${dunningStageLabel(2)} sent to amy@home.com`);
    eq('the marker patch mirrors the server', out.patch, { dunningStage: 2, dunningLastSentAt: '2026-09-27T12:00:00Z' });
    const noAt = await remindInvoice(base, harness({ success: true, outcome: 'sent', stage: 2 }).deps);
    ok('no sentAt → no patch (never invent a timestamp)', noAt.kind === 'sent' && noAt.patch === undefined);
    eq('no stage → the first stage\'s label, no recipient', remindSentMessage(undefined, undefined), `${dunningStageLabel(1)} sent`);
    const skipped = await remindInvoice(base, harness({ success: true, outcome: 'skipped', reason: 'paid', stage: 3, sentAt: 'x' }).deps);
    ok('a skip never carries a patch, even if the server echoed a stage', skipped.patch === undefined);
  }

  console.log('\n5. confirmViaAlert');
  {
    const press = (idx: number | 'dismiss') => (_t: string, _m?: string, b?: AlertButton[], o?: { onDismiss?: () => void }) => {
      if (idx === 'dismiss') o?.onDismiss?.(); else b?.[idx]?.onPress?.();
    };
    eq('Cancel → false', await confirmViaAlert(press(0))('t', 'm', 'Send anyway'), false);
    eq('the confirm button → true', await confirmViaAlert(press(1))('t', 'm', 'Send anyway'), true);
    eq('dismissed (Android back / web Escape) → false', await confirmViaAlert(press('dismiss'))('t', 'm', 'Send anyway'), false);
    let labels: string[] = [];
    await confirmViaAlert((_t, _m, b) => { labels = (b ?? []).map(x => x.text ?? ''); b?.[0]?.onPress?.(); })('t', 'm', 'Send Anyway');
    eq('buttons: Cancel, then the label', labels, ['Cancel', 'Send Anyway']);
  }

  console.log('\n6. the extraction is verbatim, and invoice.tsx calls it');
  {
    // The exact strings app/invoice.tsx showed before the move (2859f55b).
    ok('no_recipient sentence unchanged', REMIND_NO_RECIPIENT === 'No client email is on file for this invoice. Email the invoice to your client (the address is kept for reminders) or add a portal invitee in Client Portal setup, then try again.');
    ok('fallback sentence unchanged', REMIND_FAILED_FALLBACK === 'Could not reach the reminder service. Try again in a moment.');
    ok('not-eligible sentence unchanged', REMIND_NOT_ELIGIBLE === 'This invoice is not eligible for a reminder right now.');
    ok('QuickBooks question matches the button\'s own alert', qboClosedConfirmMessage(FLAG) === `${qboClosedFlagAlertReason(FLAG)} Send a reminder to the client anyway?`);
    const inv = read('app/invoice.tsx');
    const i = inv.indexOf('const handleSendReminder = useCallback(');
    const rest = inv.slice(i);
    const end = /\n {2}\}, \[[^\n]*\]\);/.exec(rest);
    const region = end ? rest.slice(0, end.index) : '';
    ok('invoice.tsx imports remindInvoice', /import \{ remindInvoice \} from '@\/utils\/remindInvoice';/.test(inv));
    ok('handleSendReminder calls remindInvoice with sendInvoiceReminderNow as the transport', /remindInvoice\(/.test(region) && /send: sendInvoiceReminderNow/.test(region));
    ok('…and no longer calls the transport itself', !/sendInvoiceReminderNow\(/.test(region));
    ok('…nor re-implements the skip wording', !/res\.outcome === 'skipped'|No client email is on file/.test(region));
    ok('…mirrors the patch and toasts only a real send', /if \(out\.patch\) updateInvoice\(existingInvoice\.id, out\.patch\);/.test(region) && /out\.kind === 'sent'/.test(region) && /nailIt\(out\.message\)/.test(region));
    ok('the button still asks the QuickBooks question before calling it (so qboClosedConfirmed: true is honest)',
      /qboClosedConfirmed: true/.test(region) && /if \(!qboClosedFlag\) \{ void handleSendReminder\(\); return; \}[\s\S]{0,700}'Send Anyway'/.test(inv));
    const helper = read('utils/remindInvoice.ts').replace(/\/\/.*$/gm, '');
    ok('the helper is pure (no react-native, no supabase value import)', !/from 'react-native'|from '@\/lib\/supabase'/.test(helper) && /import type \{ SendReminderResult \}/.test(helper));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
  console.log('ALL PASS');
}
void main();
