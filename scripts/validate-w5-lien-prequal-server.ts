// validate-w5-lien-prequal-server.ts — wave 5, lane lien-prequal, server half.
//
// Pins supabase/migrations/20260923130000_lien_prequal_hardening.sql and the
// signing page's handling of what it now answers:
//   #31  a sub's e-signature can't be overwritten by an app write (silent pin,
//        never RAISE — a queued stale write must not become a permanent failure)
//   #31  'lien_waiver_signed' fires from an AFTER trigger (CONTRACT 8), not the RPC
//   #111 'prequal_submitted' fires from an AFTER trigger (CONTRACT 8)
//   #29  lw_gc_insert / lw_gc_update require project ownership; the signing page
//        names the project owner's company
//   #114 a voided waiver can't be signed; the sub's link can't rewrite criteria
//   #24  a stale empty prequal write can't blank a submission
//
// Behaviour is proven in PGlite (scratchpad w5_lien_prequal.mjs, 50 checks,
// mutation-tested); this is the static guard that ships with the repo, so a
// later edit that moves a fire_notify call into an RPC body — where
// fire_notify's pg_trigger_depth() check refuses it and the exception block
// swallows the refusal — fails the build instead of silently losing every event.
//
// Run: bun run scripts/validate-w5-lien-prequal-server.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, detail); }
}

const MIGRATION = 'supabase/migrations/20260923130000_lien_prequal_hardening.sql';
/** SQL without `--` comments, so a sentence ABOUT fire_notify is not a call. */
const sql = read(MIGRATION).replace(/--[^\n]*/g, '');

/** Every CREATE FUNCTION block: name, whether it returns trigger, body. */
interface Fn { name: string; returnsTrigger: boolean; securityDefiner: boolean; text: string }
const fns: Fn[] = [];
for (const m of sql.matchAll(/create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(([\s\S]*?)\$function\$([\s\S]*?)\$function\$/gi)) {
  const header = m[2];
  fns.push({
    name: m[1],
    returnsTrigger: /returns\s+trigger/i.test(header),
    securityDefiner: /security\s+definer/i.test(header),
    text: header + m[3],
  });
}
const fn = (n: string) => fns.find(f => f.name === n);

console.log('\nCONTRACT 8 — notify from SQL only from AFTER triggers:');
const callers = fns.filter(f => /fire_notify\s*\(/i.test(f.text));
ok('fire_notify is called by exactly the two new trigger functions',
  callers.map(f => f.name).sort().join(',') === 'notify_lien_waiver_signed_fn,notify_prequal_submitted_fn',
  callers.map(f => f.name).join(','));
ok('no fire_notify call sits in a non-trigger (RPC) body',
  callers.every(f => f.returnsTrigger),
  callers.filter(f => !f.returnsTrigger).map(f => f.name).join(','));
for (const f of callers) {
  ok(`${f.name} wraps fire_notify in an exception block (a notify failure never undoes the write)`,
    /begin\s+[\s\S]*?perform\s+public\.fire_notify[\s\S]*?exception\s+when\s+others/i.test(f.text));
}
ok('the waiver event is lien_waiver_signed with the CONTRACT 8 payload',
  /fire_notify\(\s*'lien_waiver_signed',\s*'lien_waivers',\s*new\.id::text,\s*jsonb_build_object\(\s*'user_id',\s*new\.user_id,\s*'project_id',\s*new\.project_id,\s*'waiver_id',\s*new\.id,\s*'sub_name',\s*new\.sub_signature->>'name'\s*\)/i.test(fn('notify_lien_waiver_signed_fn')?.text ?? ''));
ok('the prequal event is prequal_submitted with the CONTRACT 8 payload',
  /fire_notify\(\s*'prequal_submitted',\s*'prequal_packets',\s*new\.id::text,\s*jsonb_build_object\(\s*'user_id',\s*new\.user_id,\s*'packet_id',\s*new\.id,\s*'sub_name',\s*v_sub_name\s*\)/i.test(fn('notify_prequal_submitted_fn')?.text ?? ''));

const trig = (name: string) => (sql.match(new RegExp(`create\\s+trigger\\s+${name}\\s+([\\s\\S]*?);`, 'i')) ?? [])[1] ?? '';
const tWaiver = trig('trg_notify_lien_waiver_signed');
ok('trg_notify_lien_waiver_signed is AFTER UPDATE OF signed_at',
  /^after\s+update\s+of\s+signed_at\s+on\s+public\.lien_waivers/i.test(tWaiver.trim()), tWaiver.slice(0, 80));
ok('…only on the unsigned → signed transition',
  /old\.signed_at\s+is\s+null\s+and\s+new\.signed_at\s+is\s+not\s+null/i.test(tWaiver));
ok('…and never for the GC\'s own paper record',
  /coalesce\(new\.sub_signature->>'role',\s*''\)\s*<>\s*'gc'/i.test(tWaiver));
const tPrequal = trig('trg_notify_prequal_submitted');
ok('trg_notify_prequal_submitted is AFTER UPDATE OF status',
  /^after\s+update\s+of\s+status\s+on\s+public\.prequal_packets/i.test(tPrequal.trim()), tPrequal.slice(0, 80));
ok('…only when a packet becomes submitted',
  /new\.status\s*=\s*'submitted'\s+and\s+old\.status\s+is\s+distinct\s+from\s+'submitted'/i.test(tPrequal));

console.log('\nguard triggers pin silently — never RAISE (#31, #24):');
for (const n of ['lien_waivers_protect_signature', 'prequal_packets_protect_submission']) {
  const f = fn(n);
  ok(`${n} exists and returns trigger`, !!f && f.returnsTrigger);
  ok(`${n} never raises`, !!f && !/raise\s+exception/i.test(f.text));
  ok(`${n} is SECURITY INVOKER (current_user must be the caller's role)`, !!f && !f.securityDefiner);
  ok(`${n} leaves the definer RPCs and the service role alone`, !!f && /current_user\s*(=|<>)\s*'authenticated'/i.test(f.text));
  ok(`${n} is a BEFORE UPDATE trigger`,
    new RegExp(`create\\s+trigger\\s+${n}\\s+before\\s+update\\s+on`, 'i').test(sql));
}
const lwGuard = fn('lien_waivers_protect_signature')?.text ?? '';
ok('a signed row keeps OLD sub_signature and signed_at',
  /old\.signed_at\s+is\s+not\s+null/i.test(lwGuard)
  && /new\.sub_signature\s*:=\s*old\.sub_signature/i.test(lwGuard)
  && /new\.signed_at\s*:=\s*old\.signed_at/i.test(lwGuard));
ok('a signed row is never knocked back to requested by a stale card',
  /if\s+new\.status\s*=\s*'requested'\s+then\s+new\.status\s*:=\s*old\.status/i.test(lwGuard));
ok('a void moves the signing token off the live column for every caller',
  /if\s+new\.status\s*=\s*'voided'[\s\S]*?new\.sign_token\s*:=\s*null/i.test(lwGuard)
  && lwGuard.indexOf("new.status = 'voided'") < lwGuard.indexOf("current_user"));
const pqGuard = fn('prequal_packets_protect_submission')?.text ?? '';
for (const col of ['financials', 'safety', 'insurance', 'criteria', 'licenses', 'w9_on_file', 'w9_doc_path', 'submitted_at']) {
  ok(`the prequal guard keeps OLD.${col} on an empty write`, new RegExp(`new\\.${col}\\s*:=\\s*old\\.${col}`, 'i').test(pqGuard));
}
ok('the prequal guard only acts once the sub has submitted', /old\.submitted_at\s+is\s+null[\s\S]*?return\s+new/i.test(pqGuard));
ok('a renewal (new token, invited) may clear submitted_at',
  /v_renewal\s*:=\s*new\.status\s*=\s*'invited'\s+and\s+new\.invite_token\s+is\s+distinct\s+from\s+old\.invite_token/i.test(pqGuard)
  && /new\.submitted_at\s+is\s+null\s+and\s+not\s+v_renewal/i.test(pqGuard));

console.log('\n#29 owner-only writes + the owner\'s name on the signing page:');
const policy = (n: string) => (sql.match(new RegExp(`create\\s+policy\\s+${n}\\s+on\\s+public\\.lien_waivers([\\s\\S]*?);`, 'i')) ?? [])[1] ?? '';
const OWN = /exists\s*\(\s*select\s+1\s+from\s+public\.projects\s+p\s+where\s+p\.id\s*=\s*project_id\s+and\s+p\.user_id\s*=\s*auth\.uid\(\)\s*\)/i;
ok('lw_gc_insert WITH CHECK requires owning the project', /for\s+insert/i.test(policy('lw_gc_insert')) && OWN.test(policy('lw_gc_insert')));
{
  const up = policy('lw_gc_update');
  const using = (up.match(/using\s*\(([\s\S]*?)\)\s*with\s+check/i) ?? [])[1] ?? '';
  const check = (up.match(/with\s+check\s*\(([\s\S]*)\)\s*$/i) ?? [])[1] ?? '';
  ok('lw_gc_update requires owning the project in USING and WITH CHECK', OWN.test(using) && OWN.test(check));
}
const get = fn('lien_waiver_get_for_signing')?.text ?? '';
ok('the signing page\'s company is the project owner\'s',
  /select\s+name,\s*user_id\s+into\s+v_proj_name,\s*v_owner\s+from\s+public\.projects/i.test(get)
  && /from\s+public\.profiles\s+where\s+id\s*=\s*coalesce\(v_owner,\s*v_w\.user_id\)/i.test(get));

console.log('\n#114 voided waivers and GC-owned criteria:');
const sign = fn('lien_waiver_submit_signature')?.text ?? '';
const lockAt = sign.search(/for\s+update/i);
const voidAt = sign.search(/if\s+v_w\.status\s*=\s*'voided'\s+then\s+raise\s+exception\s+'lien_waiver_voided'/i);
const signedAt = sign.search(/if\s+v_w\.signed_at\s+is\s+not\s+null/i);
ok('lien_waiver_submit_signature refuses a voided waiver after the lock, before the signed check',
  lockAt > 0 && voidAt > lockAt && signedAt > voidAt, `lock=${lockAt} void=${voidAt} signed=${signedAt}`);
ok('a token retired by a void is answered lien_waiver_voided, not "denied"',
  /voided_sign_token\s*=\s*p_access_token\)\s*then\s+raise\s+exception\s+'lien_waiver_voided'/i.test(sign));
ok('lien_waiver_get_for_signing finds a voided waiver by its retired token',
  /status\s*=\s*'voided'\s+and\s+coalesce\(voided_sign_token,\s*''\)\s*<>\s*''\s+and\s+voided_sign_token\s*=\s*p_access_token/i.test(get));
const submit = fn('submit_prequal_packet')?.text ?? '';
ok('submit_prequal_packet no longer writes criteria', !!submit && !/criteria\s*=\s*p_criteria/i.test(submit));
ok('…and keeps its 9-argument signature so deployed forms still bind',
  /p_token\s+text,\s*p_criteria\s+jsonb,\s*p_financials\s+jsonb,\s*p_safety\s+jsonb,\s*p_insurance\s+jsonb,\s*p_licenses\s+jsonb,\s*p_w9_on_file\s+boolean,\s*p_w9_doc_path\s+text,\s*p_status\s+text/i.test(submit));

console.log('\nsignatures, definer and grants are kept:');
for (const n of ['lien_waiver_get_for_signing', 'lien_waiver_submit_signature', 'submit_prequal_packet']) {
  const f = fn(n);
  ok(`${n} stays SECURITY DEFINER with search_path public`, !!f && f.securityDefiner && /set\s+search_path\s+to\s+'public'/i.test(f.text));
}
ok('both signing RPCs stay granted to anon', /grant\s+execute\s+on\s+function\s+public\.lien_waiver_get_for_signing\(uuid,\s*text\)\s+to\s+anon,\s*authenticated/i.test(sql)
  && /grant\s+execute\s+on\s+function\s+public\.lien_waiver_submit_signature\(uuid,\s*text,\s*text,\s*text,\s*text,\s*text,\s*text,\s*boolean,\s*text\)\s+to\s+anon,\s*authenticated/i.test(sql));
ok('submit_prequal_packet stays granted to anon',
  /grant\s+execute\s+on\s+function\s+public\.submit_prequal_packet\(\s*text,\s*jsonb,\s*jsonb,\s*jsonb,\s*jsonb,\s*jsonb,\s*boolean,\s*text,\s*text\s*\)\s+to\s+anon,\s*authenticated/i.test(sql));

console.log('\nthe signing page says "voided" for a voided waiver:');
const page = read('marketing/lien-waiver/index.html');
const voidedBranch = page.indexOf("indexOf('lien_waiver_voided')");
const deniedBranch = page.indexOf("indexOf('lien_waiver_denied') !== -1) {\n            $('submit-note')");
ok('the submit handler has its own lien_waiver_voided branch', voidedBranch > 0);
ok('…checked before the generic denied branch', voidedBranch > 0 && deniedBranch > voidedBranch, `${voidedBranch} / ${deniedBranch}`);
ok('…and it tells the sub the contractor voided it',
  /lien_waiver_voided'\) !== -1\) \{[\s\S]{0,400}voided by the contractor/.test(page));
ok('the load state for a voided waiver names the contractor', /This waiver was voided by the contractor/.test(page));

console.log(`\n${fail === 0 ? '✓' : '✗'} validate-w5-lien-prequal-server: ${pass} passed, ${fail} failed\n`);
if (fail) process.exit(1);
