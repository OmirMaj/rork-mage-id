// scripts/validate-prequal-q5.ts — the wiring half of the Q5 prequal fixes
// (founder: "what is prequal link?", 2026-09-24). The pure rules — unreadable
// COI dates, approval expiry, the CSPRNG token, the status-aware award gate —
// are EXECUTED by scripts/validate-prequal-engine.ts. This pins that the
// screens and the server actually use them:
//
//   1. the award dialog asks prequalAwardLeg, and runs the auto-review only on
//      a SUBMITTED packet (invited-but-unfilled is pending; Reject blocks);
//   2. the sub sees "Submitted" only after the server said yes;
//   3. an approved (or refused) packet is read-only, with no alert per pause;
//   4. the form and the invite name the GC;
//   5. the invite, renewal and decision note offer a copyable link — also when
//      the open "succeeded", which on the web app it always does;
//   6. tokens come from expo-crypto;
//   7. the lookup RPC returns the GC's name from the OWNER's profile.
//
// The render behaviour of (2)-(4) is proven by
// __tests__/smoke/prequal-form-q5.test.tsx, and the mail helper behind (5) by
// __tests__/smoke/prequal-mail.test.tsx.
//
// Run: bun scripts/validate-prequal-q5.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Source without // line comments, so a sentence ABOUT a call is not a call. */
const code = (p: string) => read(p).split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, detail); }
}
const between = (src: string, a: string, b: string) => {
  const i = src.indexOf(a);
  if (i < 0) return '';
  const j = src.indexOf(b, i + a.length);
  return src.slice(i, j < 0 ? undefined : j);
};

// ── 1. award gate ─────────────────────────────────────────────────────────
console.log('\napp/buyout-package.tsx — award gate:');
const bp = code('app/buyout-package.tsx');
const award = between(bp, 'const handleAward', 'const handleGenerateSubcontract');
ok('the award reads prequalAwardLeg (status-aware), pushing its blockers and notes',
  /prequalAwardLeg\(packet, review, sub\.companyName, now\)/.test(award)
  && /blockers\.push\(\.\.\.leg\.blockers\)/.test(award) && /notes\.push\(\.\.\.leg\.notes\)/.test(award));
ok('the auto-review runs only on a submitted packet',
  /const review = packet && packet\.status === 'submitted' \? reviewPrequalPacket\(packet\) : null;/.test(award));
ok('no award path turns raw auto-review findings into blockers any more',
  !/for \(const f of review\.findings\)/.test(award));
ok('a missing packet is still the quiet note + Request prequal',
  /notes\.push\([^)]*No prequal packet/.test(award) && /Request prequal/.test(award));

// ── 2-4. the sub's form ───────────────────────────────────────────────────
console.log('\napp/prequal-form.tsx:');
const pf = code('app/prequal-form.tsx');
const submit = between(pf, 'const handleSubmit = useCallback(', '}, [submitting');
ok('Submit awaits the save and shows "Submitted" only after it',
  /outcome = await onSave\(next, 'submit'\)/.test(submit)
  && submit.indexOf("await onSave(next, 'submit')") < submit.indexOf("showAlert('Submitted'")
  && /if \(outcome !== 'saved'\) return;/.test(submit));
ok('a confirmed submit moves the footer to "Submitted — awaiting review"', /setStatus\('submitted'\)/.test(submit)
  && /const isSubmitted = status === 'submitted' \|\| status === 'approved';/.test(pf));
ok('the save reports how it ended (saved / refused / failed)',
  /async \(next: PrequalPacket, mode: 'autosave' \| 'submit'\): Promise<PrequalSaveOutcome>/.test(pf)
  && /return 'refused';/.test(pf) && /return 'failed';/.test(pf) && /return 'saved';/.test(pf));
ok('a refused save locks the form (one alert, not one per pause)',
  /if \(outcome === 'refused'\) setRefused\(true\)/.test(pf) && /if \(!dirty \|\| locked\) return;/.test(pf));
ok('an approved packet is locked and every input reads the lock',
  /const locked = status === 'approved' \|\| refused;/.test(pf)
  && /editable=\{!locked\}/.test(pf) && /disabled=\{locked\}/.test(pf)
  && /<FormLockContext\.Provider value=\{locked\}>/.test(pf));
ok('the lock is explained on screen', /Approved — answers locked/.test(pf) && /This link no longer accepts changes/.test(pf));
ok('an unreadable typed date is caught before submit and shown under the field (once typing stops)',
  /unreadableDates\.length > 0/.test(submit)
  && /error=\{typingDates\.has\('coi'\) \? undefined : dateError\(insurance\.coiExpiry\)\}/.test(pf)
  && /error=\{typingDates\.has\(`lic:\$\{lic\.id\}`\) \? undefined : dateError\(lic\.expiresAt\)\}/.test(pf));
// Review r1: Submit tapped with the date field still focused never blurred it
// (keyboardShouldPersistTaps="handled"), so a M/D/YYYY date was refused.
ok('Submit tidies the typed dates itself, checks the TIDIED values, and saves them',
  /const tidy = tidyTypedDates\(insurance, licenses\);/.test(submit)
  && /const unreadableDates = unreadableDatesOf\(tidy\.insurance, tidy\.licenses\);/.test(submit)
  && /insurance: tidy\.insurance, licenses: tidy\.licenses, w9OnFile,\s*submittedAt/.test(submit)
  && submit.indexOf('tidyTypedDates(') < submit.indexOf('unreadableDates.length > 0')
  && submit.indexOf('unreadableDates.length > 0') < submit.indexOf('const hardFail'));
ok('the header names the GC from the lookup, never "MAGE ID" as the asker',
  /Prequalification for \$\{gcName\}/.test(pf) && !/Prequalification · MAGE ID/.test(pf)
  && /gc_company_name/.test(pf) && /sub_company_name/.test(pf));

// ── 4-6. the GC's manager ─────────────────────────────────────────────────
console.log('\napp/prequal-manager.tsx:');
const pm = code('app/prequal-manager.tsx');
const invite = between(pm, 'const handleInvite = useCallback(', '}, [getPrequalPacketForSub');
ok('the invite is signed with the GC\'s company, not "MAGE ID"',
  /signOff\n?\s*\);/.test(invite) && !/Thanks,\\nMAGE ID/.test(pm)
  && /prequalSignOff\(settings\?\.branding\?\.companyName\)/.test(pm));
ok('a failed mail open offers the link to copy instead of doing nothing',
  !/\.catch\(\(\) => \{\}\)/.test(invite) && /Invite saved — no email went out/.test(invite)
  && /composeMailOrOfferLink\(\{/.test(invite) && /Invite ready to send/.test(invite));
// Review r1: on react-native-web Linking.openURL resolves whenever window.open
// does not throw, so the "opened" branch is the ONLY branch the web app ever
// sees. It must carry the link too, and must not claim the mail app opened.
const mailHelper = between(code('utils/prequalMail.ts'), 'export async function composeMailOrOfferLink(', '\n}\n');
const readyBranch = mailHelper.slice(mailHelper.indexOf('if (!opened)'));
const readyTail = readyBranch.slice(readyBranch.indexOf('return;'));
ok('the RESOLVED open (all the web app ever sees) still offers Copy link',
  /const copyLink = \{ text: 'Copy link', onPress: \(\) => \{ void copyToClipboard\(p\.link\); \} \};/.test(mailHelper)
  && /showAlert\(\s*p\.ready\.title,/.test(readyTail) && /\[\{ text: 'Done', style: 'cancel' \}, copyLink\]/.test(readyTail));
ok('on the web the resolved open says the mail app SHOULD open, never that it did',
  /Platform\.OS === 'web' \? p\.ready\.webBody : p\.ready\.nativeBody/.test(readyTail)
  && (pm.match(/webBody: `Your mail app should open/g) ?? []).length === 3
  && !/webBody: `[^`]*mail app opened with/.test(pm));
const renew = between(pm, 'const handleRenew = useCallback(', '}, [upsertPrequalPacket');
const decision = between(pm, 'const emailDecision = useCallback(', '}, [subcontractors');
ok('the renewal and the decision note go through the same helper (no bare openURL left)',
  /composeMailOrOfferLink\(\{/.test(renew) && /composeMailOrOfferLink\(\{/.test(decision)
  && /import \{ composeMailOrOfferLink \} from '@\/utils\/prequalMail';/.test(pm)
  && !/Linking\.openURL\(/.test(pm) && (mailHelper.match(/Linking\.openURL\(/g) ?? []).length === 1);
ok('tokens come from utils/prequalToken (expo-crypto), not the engine\'s old Math.random',
  /import \{ generatePrequalToken \} from '@\/utils\/prequalToken';/.test(pm));
ok('Approve warns before writing an approval capped by an unreadable/past COI',
  /prequalApprovalRisk\(/.test(pm) && /'Approve with this COI date\?'/.test(pm));

// ── 7. the lookup RPC ─────────────────────────────────────────────────────
console.log('\nsupabase/migrations/20260924150500_prequal_lookup_names.sql:');
const sql = read('supabase/migrations/20260924150500_prequal_lookup_names.sql').replace(/--[^\n]*/g, '');
ok('redefines lookup_prequal_packet_by_token as SECURITY DEFINER with a pinned search_path',
  /create or replace function public\.lookup_prequal_packet_by_token\(\s*p_token text\s*\)/i.test(sql)
  && /security definer/i.test(sql) && /set search_path to 'public'/i.test(sql));
ok('an empty or null token returns null before any lookup',
  /if coalesce\(p_token, ''\) = '' then\s+return null;\s+end if;/i.test(sql)
  && sql.search(/if coalesce\(p_token, ''\) = '' then/i) < sql.search(/p\.invite_token = p_token/));
ok('keeps the match + expiry rule', /p\.invite_token = p_token/.test(sql) && /p\.expires_at is null or p\.expires_at > now\(\)/.test(sql));
ok('reads the GC name from the packet OWNER\'s profile, never from the caller',
  /from public\.profiles pr\s+where pr\.id = v_p\.user_id/.test(sql) && !/p_gc|p_company/i.test(sql));
ok('reads the sub name from the same owner\'s roster, compared as text',
  /s\.id::text = v_p\.subcontractor_id/.test(sql) && /s\.user_id = v_p\.user_id/.test(sql));
ok('adds the names to the old row shape (older forms read it unchanged)',
  /to_jsonb\(v_p\) \|\| jsonb_build_object\(/.test(sql) && /'gc_company_name'/.test(sql) && /'sub_company_name'/.test(sql));
ok('stays callable by the signed-out sub', /revoke all on function public\.lookup_prequal_packet_by_token\(text\) from public;/.test(sql)
  && /grant execute on function public\.lookup_prequal_packet_by_token\(text\) to anon, authenticated;/.test(sql));

console.log(`\n${fail === 0 ? '✓' : '✗'} validate-prequal-q5: ${pass} passed, ${fail} failed\n`);
if (fail) process.exit(1);
