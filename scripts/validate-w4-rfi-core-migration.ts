// validate-w4-rfi-core-migration.ts — pins supabase/migrations/
// 20260920190000_rfi_submittal_answers_kept.sql (wave 4, lane rfi-core:
// #25 #26 #27 #92).
//
// The migration is EXECUTED twice over 20260919080000 in the PGlite harness
// (scratchpad pgtest/w4_rfi_core_mig.mjs, 36 scenarios: the offline paraphrase
// synced after the reply-link answer, the offline cycle after an approval and
// after a comments-only reply, the stamp on an already-closed cycle, a second
// answer, a closed / void RFI). PGlite is not a repo dependency, so this
// validator pins the clauses those scenarios rest on.
//
// Run: bun run scripts/validate-w4-rfi-core-migration.ts   (MIG_PATH overrides)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = 'supabase/migrations/20260920190000_rfi_submittal_answers_kept.sql';
const SQL = readFileSync(process.env.MIG_PATH ?? join(__dirname, '..', FILE), 'utf8');
const CODE = SQL.replace(/--[^\n]*/g, '');

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}
const fn = (name: string) => {
  const a = CODE.indexOf(`function public.${name}(`);
  const b = CODE.indexOf('$function$;', a);
  return a > -1 && b > a ? CODE.slice(a, b) : '';
};

console.log('\nshape');
for (const f of ['rfis_answer_guard_fn', 'submittals_answer_guard_fn', 'submittal_append_review_cycle', 'submit_pro_response', 'get_rfi_by_token']) {
  ok(`${f} is CREATE OR REPLACE'd`, new RegExp(`create or replace function public\\.${f}\\(`).test(CODE));
}
ok('no DROP FUNCTION (signatures kept)', !/drop function/i.test(CODE));
ok('grants restated: submit_pro_response to anon + authenticated + service_role',
  /grant execute on function public\.submit_pro_response\(uuid, text, text, text, text, text, text\) to anon, authenticated, service_role;/.test(CODE));
ok('grants restated: the append RPC to authenticated + service_role, not anon',
  /revoke execute on function public\.submittal_append_review_cycle\(uuid, jsonb\) from public, anon;/.test(CODE)
  && /grant execute on function public\.submittal_append_review_cycle\(uuid, jsonb\) to authenticated, service_role;/.test(CODE));
ok('grants restated: get_rfi_by_token', /grant execute on function public\.get_rfi_by_token\(uuid\) to anon, authenticated, service_role;/.test(CODE));
ok('the append RPC stays SECURITY INVOKER (RLS decides)', /security invoker/.test(fn('submittal_append_review_cycle')));
ok('submit_pro_response / get_rfi_by_token stay SECURITY DEFINER', /security definer/.test(fn('submit_pro_response')) && /security definer/.test(fn('get_rfi_by_token')));

console.log('\n#25 rfis guard: an answer on record is never replaced by a stale writer');
const rg = fn('rfis_answer_guard_fn');
ok('a writer naming the current updated_at is still deliberate', /if NEW\.updated_at is not distinct from OLD\.updated_at then\s+return NEW;/.test(rg));
ok('a DIFFERENT non-empty response is tested for an unseen reply-link answer',
  /elsif btrim\(NEW\.response\) is distinct from btrim\(OLD\.response\) then[\s\S]{0,900}where not v_new_h @> jsonb_build_array\(o\.e\)\s+and \(coalesce\(o\.e ->> 'note', ''\) like 'Response via portal%'\s+or coalesce\(o\.e ->> 'note', ''\) like 'Revised answer via portal%'\)\s+\) into v_portal_unseen;/.test(rg));
ok('…and keeps OLD.response ONLY then (his own correction of his own answer lands — review round 1)',
  /if v_portal_unseen then[\s\S]{0,400}v_gc_note := btrim\(NEW\.response\);\s+NEW\.response := OLD\.response;/.test(rg)
  && (rg.match(/NEW\.response := OLD\.response;/g) || []).length === 2
  && /if coalesce\(btrim\(NEW\.response\), ''\) = '' then\s+NEW\.response := OLD\.response;/.test(rg));
ok('…and the architect answer keeps its own date', /if v_portal_unseen then[\s\S]{0,500}if OLD\.date_responded is not null then\s+NEW\.date_responded := OLD\.date_responded;/.test(rg));
ok('his text is kept as a GC handoff note, not concatenated into response',
  /'note', 'GC note \(not saved over the architect answer\): ' \|\| v_gc_note/.test(rg) && !/NEW\.response := [^;]*\|\|/.test(rg));
ok('the note moves no ball (toParty = where the ball is)', /'toParty', coalesce\(nullif\(NEW\.ball_in_court, ''\)/.test(rg));
ok('the invoker trigger never calls mage_iso_now (authenticated has no EXECUTE on it)', !/mage_iso_now/.test(rg));

console.log('\n#26 submittals guard: one round, not a phantom cycle');
const sg = fn('submittals_answer_guard_fn');
ok('matches his open cycle (in_review, no returnDate, a sentDate)',
  /coalesce\(w\.e ->> 'status', ''\) = 'in_review'\s+and coalesce\(w\.e ->> 'returnDate', ''\) = ''\s+and coalesce\(w\.e ->> 'sentDate', ''\) <> ''/.test(sg));
ok('…to a server cycle of the SAME original number with a NULL sentDate, not in his copy',
  /\(o\.e ->> 'cycleNumber'\) = \(w\.e ->> 'cycleNumber'\)\s+and coalesce\(o\.e ->> 'sentDate', ''\) = ''\s+and not v_new_c @> jsonb_build_array\(o\.e\)/.test(sg));
ok('fills the send day in place (server verdict / comments untouched)',
  /v_s := v_s \|\| jsonb_build_object\('sentDate', w\.e -> 'sentDate'\);/.test(sg) && /if coalesce\(btrim\(v_s ->> 'comments'\), ''\) = ''/.test(sg));
ok('only a genuinely appended cycle moves current_status', /if jsonb_array_length\(v_added\) > 0 and coalesce\(v_added -> -1 ->> 'status', ''\) <> '' then\s+NEW\.current_status := v_added -> -1 ->> 'status';\s+else\s+NEW\.current_status := OLD\.current_status;/.test(sg));

console.log('\n#27 closesOpenCycle with nothing open');
const ap = fn('submittal_append_review_cycle');
ok('answers already_closed with cycle_number + status (CONTRACT 16) before any write',
  /if not v_open then[\s\S]{0,300}'success', false, 'error', 'already_closed',[\s\S]{0,40}'cycle_number',[\s\S]{0,160}'status', v_last ->> 'status'\);/.test(ap)
  && ap.indexOf("'already_closed'") < ap.indexOf('update public.submittals'));
ok('never falls through to an append for a close', /if coalesce\(\(p_cycle ->> 'closesOpenCycle'\)::boolean, false\) then\s+if not v_open then/.test(ap));

console.log('\n#92 submit_pro_response');
const sp = fn('submit_pro_response');
ok('a closed / void RFI refuses with rfi_closed (CONTRACT 16)',
  /if coalesce\(v_rfi\.status, ''\) in \('closed', 'void'\) then\s+return jsonb_build_object\('success', false, 'error', 'rfi_closed'\);/.test(sp));
ok('…before the rfis update and the pro_responses insert (no push)',
  sp.indexOf("'rfi_closed'") > -1 && sp.indexOf("'rfi_closed'") < sp.indexOf('update public.rfis') && sp.indexOf("'rfi_closed'") < sp.indexOf('insert into public.pro_responses'));
ok('a second answer is appended under a dated, named separator',
  /when v_revision then\s+v_rfi\.response \|\| E'\\n\\n— Revised '[\s\S]{0,120}coalesce\(' by ' \|\| v_name, ''\)/.test(sp));
ok('date_responded stays the first answer\'s', /date_responded = coalesce\(date_responded, v_now\)/.test(sp));
ok('the answer reports revision', /jsonb_build_object\('revision', v_revision\)/.test(sp));
ok('the submittal branch is unchanged: an action code closes the open cycle in place', /if v_open then[\s\S]{0,200}v_cycle_no :=/.test(sp));

console.log('\n#92 get_rfi_by_token');
const gr = fn('get_rfi_by_token');
ok('returns status and is_closed (the page shows the closed banner)', /'status', r\.status,/.test(gr) && /'is_closed', coalesce\(r\.status, ''\) in \('closed', 'void'\)/.test(gr));
ok('still returns pin_marks and has_existing_response', /'pin_marks'/.test(gr) && /'has_existing_response'/.test(gr));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
