#!/usr/bin/env bun
// scripts/validate-w4-portal-server-overlay.ts
//
// Audit wave 4, lane portal-server — #13, #65, #71 (= #132), #20, #14 (the
// overlay half), and the carries #12, #28, #83 (= #135).
//
// The homeowner portal is a snapshot the GC's app publishes, laid over with
// live rows on every read (portal_overlay_live). Everything the homeowner
// DOES — sign the contract, pick a selection, decide a change order — writes a
// live row the old overlay never read, so the page reloaded onto the frozen
// snapshot and asked again: a second signature got "ask your contractor to
// re-send your link", a second phone could decline a CO the client had
// already e-signed and the reconciler flipped it to Rejected.
// 20260920060000_portal_live_overlay_v2.sql fixes it on the server.
//
// The migration's behaviour is EXECUTED in PGlite (twice, with and without
// money-ledger's 20260920020000, 71 scenarios, 20 mutations all killed —
// scratchpad pgtest/w4_portal_server.mjs). Ship-check has no Postgres, so
// this pins the structure those scenarios proved, so a later edit that drops
// a guard fails here.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return ''; } };
const FILE = 'supabase/migrations/20260920060000_portal_live_overlay_v2.sql';
const SQL = read(FILE);
// Comments out: a guard named in prose is not a guard.
const CODE = SQL.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

let passed = 0, failed = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}

/** The body of `create or replace function public.<name>(` up to its closing dollar-quote. */
function fnBody(name: string): string {
  const at = CODE.indexOf(`create or replace function public.${name}(`);
  if (at < 0) return '';
  const open = CODE.slice(at).match(/as (\$[a-z]*\$)/);
  if (!open || open.index === undefined) return '';
  const start = at + open.index + open[0].length;
  const end = CODE.indexOf(open[1], start);
  return end < 0 ? '' : CODE.slice(at, end + open[1].length);
}

ok(`${FILE} exists`, SQL.length > 0);

console.log('\n#13 / #65 — portal_sign_contract answers "already signed":');
{
  const b = fnBody('portal_sign_contract');
  ok('same signature as production (p_portal_id, p_contract_id uuid, p_signer_name, p_passcode, p_access_token)',
    /portal_sign_contract\(\s*p_portal_id text, p_contract_id uuid, p_signer_name text,\s*p_passcode text default null::text, p_access_token text default null::text\)/.test(b));
  ok('SECURITY DEFINER with a pinned search_path', /security definer\s+set search_path to 'public'/.test(b));
  ok('locks the contract row (a second device waits, then reads signed)', /from public\.project_contracts\s+where id = p_contract_id and project_id = v_project_id\s+for update;/.test(b));
  const pass = b.indexOf("p_passcode <> (v_portal->>'passcode')");
  const already = b.indexOf("return jsonb_build_object('ok', true, 'already', true);");
  const denySent = b.indexOf("v_status <> 'sent' then");
  ok('already-signed answers {ok:true, already:true}', already > 0);
  ok('…only AFTER the token and passcode checks (no oracle)', pass > 0 && already > pass, `passcode@${pass} already@${already}`);
  ok('…and BEFORE the not-sent refusal', denySent > already);
  ok('a signature by any method (portal / in person / paper) counts as signed', /v_status = 'signed'\s+or \(v_sig is not null/.test(b));
  ok("a portal signature records method 'portal'", /'method', 'portal'/.test(b));
}

console.log('\n#71 / #132 — one decision per send of a change order:');
for (const name of ['portal_submit_co_approval', 'portal_submit_co_approval_signed']) {
  const b = fnBody(name);
  ok(`${name}: body found`, b.length > 0);
  ok(`${name}: locks the CO row before looking for a decision`, /from public\.change_orders c\s+where c\.id::text = btrim\(p_change_order_id\) and c\.project_id = v_pid\s+for update;/.test(b));
  const prior = b.indexOf('v_prior := public.portal_co_decision_for_send(v_pid, p_change_order_id, v_ps);');
  const insert = b.indexOf('insert into public.change_order_approvals(');
  ok(`${name}: a decision for the current send is looked up BEFORE the insert`, prior > 0 && insert > prior);
  ok(`${name}: an existing decision answers recorded:false with decision / signer_name / sealed_at`,
    /'recorded', false,\s+'decision', v_prior->>'decision', 'signer_name', v_prior->>'signer_name',\s+'sealed_at', v_prior->>'sealed_at'/.test(b));
  ok(`${name}: a CO no longer pending (utils/portalOwnerCore PENDING_CO_STATUSES) records nothing`,
    /if lower\(coalesce\(v_status, ''\)\) not in \('submitted', 'pending', 'under_review', 'review'\) then\s+return jsonb_build_object\('ok', true, 'recorded', false,/.test(b));
  ok(`${name}: the row carries the send stamp`, /public\.portal_co_send_stamp\(v_ps\)\)\s+returning id into v_id;/.test(b));
  // Review round 1: a server-side status flip reaches the app by realtime
  // before the reconciler runs, so ProjectContext.updateChangeOrder never sees
  // becameApproved — the "place these days" marker + notification and
  // fireGradingEvent silently never run. The overlay closes the CO from the
  // approval row instead; the reconciler flips the status.
  ok(`${name}: change_orders.status is NOT written (the app reconciler flips it)`,
    !/update public\.change_orders\s+set[^;]*\bstatus\s*=/.test(b) && !/status\s+= case when p_decision/.test(b));
  ok(`${name}: still refuses a CO not shared (#44)`, /if not public\.portal_state_is_shared\(v_ps\) then raise exception 'co_not_shared'; end if;/.test(b));
}
{
  const b = fnBody('portal_submit_co_approval_signed');
  ok('CONTRACT 7: sealed action names unchanged', /'client_signed_via_portal' else 'client_declined_via_portal'/.test(b) && /'id',\s+v_id::text,/.test(b));
  ok('the refusal happens before the e-sign validation (a second phone needs no signature to be told)',
    b.indexOf('v_prior := public.portal_co_decision_for_send') < b.indexOf("raise exception 'esign_consent_required'"));
}
{
  const stamp = fnBody('portal_co_send_stamp');
  ok('the send stamp is sentVersion@sentAt — compared by equality, never by clock',
    /coalesce\(nullif\(p_ps->>'sentVersion', ''\), '0'\) \|\| '@' \|\| coalesce\(p_ps->>'sentAt', ''\)/.test(stamp));
  const dec = fnBody('portal_co_decision_for_send');
  ok('a decision counts for the current send by stamp; a legacy (null-stamp) row only when made at/after sentAt',
    /a\.send_stamp = public\.portal_co_send_stamp\(p_ps\)/.test(dec) && /a\.send_stamp is null/.test(dec) && /a\.created_at >= public\.portal_try_timestamptz\(p_ps->>'sentAt'\)/.test(dec));
  ok('unique backstop includes the send stamp (a re-sent CO can be decided again)',
    /create unique index if not exists change_order_approvals_one_per_send\s+on public\.change_order_approvals \(project_id, change_order_id, send_stamp\)\s+where send_stamp is not null;/.test(CODE));
  ok('the evidence freeze trigger pins send_stamp for a JWT caller', /new\.send_stamp\s+:= old\.send_stamp;/.test(fnBody('co_approval_freeze_evidence')));
  ok('send_stamp column added idempotently', /alter table public\.change_order_approvals add column if not exists send_stamp text;/.test(CODE));
}

console.log('\nportal_overlay_live:');
const O = fnBody('portal_overlay_live');
ok('body found, SECURITY DEFINER, pinned search_path', O.length > 0 && /stable\s+security definer\s+set search_path to 'public'/.test(O));
{
  ok('#13/#65/#12 the live, non-void, not-superseded contract', /from public\.project_contracts pc\s+where pc\.project_id = p_pid and pc\.superseded_by is null and pc\.status <> 'void'/.test(O));
  ok('draft / void / none drops the contract block', /v_snap := v_snap - 'contract';/.test(O));
  ok('a block for ANOTHER contract is not this contract\'s terms', /\(v_snap->'contract'->>'id'\) = v_c_id::text/.test(O) && /v_contract := '\{\}'::jsonb;/.test(O));
  ok('status / needsSignature / contractValue / title laid over live', /'status', v_c_status,/.test(O) && /'needsSignature', v_c_open\)/.test(O) && /'contractValue', coalesce\(v_c_value, 0\)/.test(O));
  ok('evidencePath / homeownerSignature never leave (a private secure-contracts path)', /- 'evidencePath' - 'signaturePaths' - 'homeownerSignature'/.test(O));
  ok('signed: signer name, signed-at and method only', /'homeownerSignerName'/.test(O) && /'homeownerSignedAt'/.test(O) && /'homeownerSignatureMethod', case when \(v_c_sig->>'method'\) in \('portal', 'in_person', 'paper'\)/.test(O));
  // Integration round 1: …and needsSignature false with it (the old page drew
  // the Sign box on status 'sent' + needsSignature).
  ok('no published terms -> contentPending, needsSignature false, and not "waiting on you" yet', /jsonb_build_object\('contentPending', true, 'needsSignature', false\);\s+v_c_open := false;/.test(O));
  // Review round 1: contentPending means "no block for THIS contract", never
  // "the terms are not a `content` object" — that rule would lock signing on
  // every existing snapshot and on a builder publishing #64's terms flat.
  ok('contentPending keys on "no block for this contract id", not on the shape of the terms',
    /v_c_same_block := jsonb_typeof\(v_snap->'contract'\) = 'object'\s+and \(v_snap->'contract'->>'id'\) = v_c_id::text;/.test(O)
    && /if v_c_same_block then[\s\S]{0,400}v_contract := v_contract - 'contentPending';/.test(O)
    && !/jsonb_typeof\(v_contract->'content'\)/.test(O));
  ok("the 'contract' decision stays only while it is open", /not \(coalesce\(e\.value->>'kind', ''\) = 'contract' and not v_c_open\)/.test(O));
}
{
  ok('#13 options[].isChosen from selection_options', /jsonb_build_object\('isChosen', \(v_opt->>'id'\) is not distinct from v_chosen\)/.test(O) && /from public\.selection_options o\s+where o\.category_id::text = v_el->>'id' and o\.is_chosen/.test(O));
  ok("#13 a picked category reads chosen / exceeded (selectionsEngine's rule)", /case when v_cat_budget > 0 and coalesce\(v_opt_total, 0\) > v_cat_budget\s+then 'exceeded' else 'chosen' end/.test(O));
  ok('#13 a picked selection leaves ownerDecisions', /not \(coalesce\(e\.value->>'kind', ''\) = 'selection' and coalesce\(e\.value->>'id', ''\) = any\(v_picked\)\)/.test(O));
}
{
  ok('#132 a decision for the current send closes the CO whatever its status says', /v_decision := public\.portal_co_decision_for_send\(p_pid, v_el->>'id', v_ps\);/.test(O) && /if v_decision is not null then\s+v_co_closed := v_co_closed \|\| \(v_el->>'id'\);/.test(O));
  ok('#132 clientDecision {decision, signerName, sealedAt}', /'clientDecision', jsonb_build_object\(\s+'decision', v_decision->>'decision',\s+'signerName', v_decision->>'signer_name',\s+'sealedAt', v_decision->>'sealed_at'\)/.test(O));
  ok('#132 a decided CO leaves ownerDecisions', /not \(coalesce\(e\.value->>'kind', ''\) = 'change_order' and coalesce\(e\.value->>'id', ''\) = any\(v_co_closed\)\)/.test(O));
  ok('the ownerDecisions pass always runs (the new sets are not gated behind the old ones)', /if jsonb_typeof\(v_snap->'ownerDecisions'\) = 'array' then\s+select/.test(O));
}
{
  ok('#83 pay_pending_* read through to_jsonb(row) — compiles and runs with or without 20260920020000',
    (O.match(/to_jsonb\(i\)->>'pay_pending_at'/g) ?? []).length === 1 && (O.match(/to_jsonb\(a\)->>'pay_pending_at'/g) ?? []).length === 1 && !/\bi\.pay_pending_at\b|\ba\.pay_pending_at\b/.test(O));
  ok('#83 paymentProcessing {since, amount} and NO payLinkUrl while the 10-day hold runs',
    (O.match(/\(v_el - 'payLinkUrl'\) \|\| jsonb_build_object\('paymentProcessing', jsonb_build_object\(/g) ?? []).length === 2 && (O.match(/v_pend_at > now\(\) - interval '10 days'/g) ?? []).length === 2);
  ok('#83 an invoice the pending payment covers leaves ownerDecisions', /coalesce\(e\.value->>'id', ''\) = any\(v_covered\)/.test(O));
  ok('#28 the live RFI number', /select r\.status, r\.portal_state, r\.number, true into v_status, v_ps, v_num, v_found/.test(O) && /jsonb_build_object\('number', v_num\)/.test(O));
}
{
  ok('#14 only an http(s) photo url survives; the page signs the id', /if coalesce\(v_el->>'url', ''\) !~\* '\^https\?:\/\/' then\s+v_el := v_el - 'url';/.test(O));
  ok('#14 an entry with neither id nor http url goes (NULL-safe typeof)', /if coalesce\(jsonb_typeof\(v_el->'id'\), ''\) <> 'string' and not \(v_el \? 'url'\) then continue; end if;/.test(O));
  ok('#14 the hero is matched by heroPhotoId', /where ph\.id::text = v_hero_id and ph\.project_id = p_pid;/.test(O));
  ok('#14 a recalled or non-http legacy hero falls back to the newest shared photo id', /v_recalled := \(v_any and not v_shared\) or v_hero !~\* '\^https\?:\/\/';/.test(O) && /v_hero_id := case when jsonb_typeof\(v_snap->'sections'->'photos'->0->'id'\) = 'string'/.test(O));
}
{
  ok('#20 the latest update by the full instant, not the UTC day', /order by public\.portal_try_timestamptz\(d\.date\) desc nulls last, d\.updated_at desc nulls last/.test(O) && !/order by left\(d\.date, 10\)/.test(O));
  ok("#20 labelled in the snapshot's validated timeZone", /v_tz := public\.portal_safe_time_zone\(v_snap->>'timeZone'\);/.test(O) && /v_day := \(v_ts at time zone v_tz\)::date;/.test(O));
  ok('#20 a malformed date never throws', /exception when others then\s+return null;/.test(fnBody('portal_try_timestamptz')));
  ok('#20 a bad zone falls back to UTC', /exception when others then\s+return 'UTC';/.test(fnBody('portal_safe_time_zone')));
  ok('portal_try_timestamptz is STABLE (a text→timestamptz cast reads the session zone)', /returns timestamptz\s+language plpgsql\s+stable/.test(fnBody('portal_try_timestamptz')));
}

console.log('\ngrants:');
ok('the overlay and every helper stay unreachable from client roles',
  ['portal_try_timestamptz(text)', 'portal_safe_time_zone(text)', 'portal_co_send_stamp(jsonb)', 'portal_co_decision_for_send(uuid, text, jsonb)', 'portal_overlay_live(uuid, jsonb)']
    .every((f) => CODE.includes(`revoke all on function public.${f} from public, anon, authenticated;`)));
ok('the three portal RPCs keep their anon / authenticated grants',
  /grant execute on function public\.portal_submit_co_approval\(\s*text, text, text, text, text, text, text\) to anon, authenticated;/.test(CODE)
  && /grant execute on function public\.portal_submit_co_approval_signed\(\s*text, text, text, text, text, text, text, text, text, text, text, text, boolean\) to anon, authenticated;/.test(CODE)
  && /grant execute on function public\.portal_sign_contract\(text, uuid, text, text, text\) to anon, authenticated;/.test(CODE));
ok('no DROP FUNCTION (CREATE OR REPLACE keeps signatures)', !/drop function/i.test(CODE));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
