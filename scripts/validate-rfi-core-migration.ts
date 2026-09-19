// validate-rfi-core-migration.ts — pins supabase/migrations/20260919080000_
// rfi_submittal_integrity.sql (wave 3, lane rfi-core: #55 #56 #77 #147 #148).
//
// The migration is EXECUTED twice in the PGlite harness
// (scratchpad pgtest/rfi_core_mig.mjs, 48 scenarios: the stale phone Update,
// the portal answer, the cycle close, two devices both guessing #7, the
// notify payload, RLS on the append RPC). PGlite is not a repo dependency, so
// this validator pins the clauses those scenarios rest on — the ones a later
// edit could quietly drop.
//
// Run: bun run scripts/validate-rfi-core-migration.ts   (MIG_PATH overrides)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = 'supabase/migrations/20260919080000_rfi_submittal_integrity.sql';
const SQL = readFileSync(process.env.MIG_PATH ?? join(__dirname, '..', FILE), 'utf8');
// Comments out, so a clause that survives only in prose does not pass.
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

console.log('\ncontract');
ok('the header states the client write contract context-integrator must match', /CLIENT WRITE CONTRACT/.test(SQL) && /MUST[\s-]{0,12}also name updated_at/.test(SQL));

console.log('\n#55 rfis guard');
const rg = fn('rfis_answer_guard_fn');
ok('fires BEFORE rfis_updated_at (alphabetical trigger order), so it sees the client\'s updated_at',
  /create trigger rfis_answer_guard\s+before update on public\.rfis/.test(CODE) && 'rfis_answer_guard' < 'rfis_updated_at');
ok('a writer naming the current updated_at is deliberate', /if NEW\.updated_at is not distinct from OLD\.updated_at then\s+return NEW;/.test(rg));
ok('a non-empty response is never nulled', /coalesce\(btrim\(OLD\.response\), ''\) <> '' and coalesce\(btrim\(NEW\.response\), ''\) = ''/.test(rg) && /NEW\.response := OLD\.response;/.test(rg));
ok('date_responded is never nulled', /OLD\.date_responded is not null and NEW\.date_responded is null/.test(rg));
ok('answered/closed never go back to open', /OLD\.status in \('answered', 'closed'\) and NEW\.status = 'open'/.test(rg));
ok('handoffs are append-only (server chain first)', /NEW\.handoffs := v_old_h \|\| v_added;/.test(rg));
ok('the guard coerces, it never raises (no terminal queue error)', !/raise exception/i.test(rg));

console.log('\n#55 submittals guard');
const sg = fn('submittals_answer_guard_fn');
ok('fires before submittals_updated_at', /create trigger submittals_answer_guard\s+before update on public\.submittals/.test(CODE) && 'submittals_answer_guard' < 'submittals_updated_at');
ok('a cycle is identified by cycleNumber AND sentDate', /\(o\.e -> 'cycleNumber'\) is not distinct from \(n\.e -> 'cycleNumber'\)/.test(sg) && /\(o\.e -> 'sentDate'\) is not distinct from \(n\.e -> 'sentDate'\)/.test(sg));
ok('the server\'s cycles are kept, the writer\'s new ones appended and renumbered', /NEW\.review_cycles := v_old_c \|\| v_added;/.test(sg) && /v_max \+ a\.rn/.test(sg));
ok('current_status follows the server unless a cycle was appended', /NEW\.current_status := OLD\.current_status;/.test(sg));
ok('never raises', !/raise exception/i.test(sg));

console.log('\n#148 numbers');
for (const t of ['rfis', 'submittals']) {
  const f = fn(`${t}_assign_number_fn`);
  ok(`${t}: SECURITY DEFINER (the max sees rows RLS hides)`, /security definer/.test(f));
  ok(`${t}: per-project advisory lock`, new RegExp(`pg_advisory_xact_lock\\(hashtext\\('${t}'\\), hashtext\\(NEW\\.project_id::text\\)\\)`).test(f));
  ok(`${t}: the client's number is replaced, not trusted`, /\+ 1 into NEW\.number/.test(f));
  ok(`${t}: BEFORE INSERT trigger`, new RegExp(`create trigger ${t}_assign_number\\s+before insert on public\\.${t}`).test(CODE));
}
const idx = CODE.indexOf('create unique index if not exists rfis_project_number_key');
ok('the unique index comes only AFTER the numbering triggers and the renumber',
  idx > CODE.indexOf('create trigger rfis_assign_number') && idx > CODE.indexOf('$renumber$;') && /submittals_project_number_key on public\.submittals \(project_id, number\)/.test(CODE));
ok('the renumber keeps the oldest (created_at, id)', /order by created_at nulls last, id\) as rn/.test(CODE));

console.log('\n#56 / #147 submit_pro_response');
const sp = fn('submit_pro_response');
ok('same signature and grants as production', /p_token uuid, p_doc_type text, p_responder_name text, p_responder_email text,\s+p_responder_role text, p_response_body text, p_action_code text default null::text/.test(sp)
  && /grant execute on function public\.submit_pro_response\(uuid, text, text, text, text, text, text\) to anon, authenticated, service_role;/.test(CODE));
ok('the parent row is locked', /from public\.rfis where share_token = p_token limit 1 for update/.test(sp) && /from public\.submittals where share_token = p_token limit 1 for update/.test(sp));
ok('RFI: ball back to the GC unless closed/void', /else 'gc' end/.test(sp) && /status in \('closed', 'void'\) then ball_in_court/.test(sp));
ok('RFI: an RFIHandoff-shaped entry is appended', /'at', v_now,\s+'fromParty', coalesce\(nullif\(ball_in_court, ''\), 'architect'\),\s+'toParty', 'gc',\s+'note', 'Response via portal'/.test(sp));
ok('dates are ISO (Hermes-parseable), not now()::text', /v_now text := public\.mage_iso_now\(\)/.test(sp) && !/now\(\)::text/.test(sp));
ok('submittal: an action code closes the open cycle IN PLACE', /v_cycles := jsonb_set\(v_cycles, array\[\(v_len - 1\)::text\], v_last\);/.test(sp) && /'returnDate', v_now, 'status', v_code/.test(sp));
ok('submittal: no action code records comments and closes nothing', /if v_code is null then[\s\S]{0,200}'comments', coalesce\(nullif\(v_last ->> 'comments', ''\)/.test(sp));
ok('submittal: an appended cycle has sentDate NULL (unknown), numbered max + 1', /v_cycle_no := v_max \+ 1;/.test(sp) && /'sentDate', null, 'returnDate', v_now/.test(sp));
ok('the parent is written BEFORE pro_responses (the notify reads it)', sp.indexOf('update public.submittals') < sp.indexOf('insert into public.pro_responses') && sp.indexOf('update public.rfis') < sp.indexOf('insert into public.pro_responses'));

console.log('\n#56 the notification');
const nt = fn('trg_notify_pro_response');
ok('AFTER INSERT on pro_responses', /create trigger notify_pro_response\s+after insert on public\.pro_responses/.test(CODE));
ok('raises pro_response_received through fire_notify (the cron-secret path)', /perform public\.fire_notify\(\s*'pro_response_received',\s*'pro_responses',/.test(nt));
ok('payload is the cross-chain contract', ['project_id', 'kind', 'item_id', 'number', 'responder_name', 'action_code'].every(k => new RegExp(`'${k}', `).test(nt)));
ok('the trigger function is not callable by clients', /revoke execute on function public\.trg_notify_pro_response\(\) from public, anon, authenticated;/.test(CODE));

console.log('\n#55 c submittal_append_review_cycle');
const ap = fn('submittal_append_review_cycle');
ok('SECURITY INVOKER — the caller\'s RLS decides', /security invoker/.test(ap));
ok('locked read, server-side number', /for update/.test(ap) && /v_no := v_max \+ 1;/.test(ap) && /\(p_cycle - 'closesOpenCycle' - 'cycleNumber'\)/.test(ap));
ok('closesOpenCycle fills the open cycle, keeping its sentDate', /coalesce\(\(p_cycle ->> 'closesOpenCycle'\)::boolean, false\)/.test(ap) && /v_entry := v_last \|\| jsonb_strip_nulls/.test(ap));
ok('authenticated only — never anon', /revoke execute on function public\.submittal_append_review_cycle\(uuid, jsonb\) from public, anon;/.test(CODE) && /grant execute on function public\.submittal_append_review_cycle\(uuid, jsonb\) to authenticated, service_role;/.test(CODE));

console.log('\n#77 get_rfi_by_token pin marks');
const gr = fn('get_rfi_by_token');
ok('returns the linked pins with the sheet path', /'pin_marks', coalesce\(\(/.test(gr) && /where dp\.linked_rfi_id = r\.id/.test(gr) && /'sheet_path', ps\.image_uri/.test(gr));
ok('keeps every field the page read before', ['number', 'subject', 'question', 'date_required', 'attachments', 'company_name', 'has_existing_response'].every(k => new RegExp(`'${k}', `).test(gr)));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
