// scripts/validate-w5-crew-screens.ts — the crew lane's screens, hook and
// migration after audit wave 5 (2026-09-23). Source pins (the screens import
// react-native and cannot run under bun); the pure halves are exercised in
// validate-w5-crew-pure.ts / validate-w5-crew-magic-link.ts, and the migration
// runs in PGlite (scratchpad w5crew_pg/w5_crew.mjs).
//
//   #70  Crew refetches the roster on focus; the freeze covers the owner.
//   #71  edit details, Active/Inactive switch, 'Add email', 'Mark inactive'.
//   #72  the invite goes out as crew_claim and the GC is told whose name.
//   #73  claim-crew: link error / timeout → honest state, Sign in, Retry, a
//        way out in every state but an in-flight redeem.
//   #74  the claimed profile renders on claim-crew; /sub-profile link gone.
//   #165 Re-scan ID always; expired IDs say so.   #166 scan save honesty.
//   #167 local today; 'Check date'.   #169 private presence channel + RLS.
//   #170 honest Direct Hire copy.     #124 carry: scan caps → /paywall.
//
// Run via: bun run scripts/validate-w5-crew-screens.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra ? `\n   ${extra}` : ''); }
}
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const crew = code('app/crew.tsx');
const claim = code('app/claim-crew.tsx');
const hook = code('hooks/useSchedulePresence.ts');
const mig = read('supabase/migrations/20260923160000_crew_claim_freeze_and_schedule_presence.sql');
const presence = code('utils/crewPresence.ts');

console.log('\n#70 stale roster');
ok('Crew invalidates [\'crew_members\'] on focus',
  /useFocusEffect\(useCallback\(\(\) => \{\s*void queryClient\.invalidateQueries\(\{ queryKey: \['crew_members'\] \}\);/.test(crew));
ok('…in the route component, before the tier branch (both views refresh)',
  crew.indexOf('useFocusEffect(') > 0 && crew.indexOf('useFocusEffect(') < crew.indexOf("if (!canAccess('crew_management'))"));
{
  const all = mig.slice(mig.indexOf('-- Every authenticated caller, owner included'));
  ok('freeze: a block for every authenticated caller, owner included', /IF auth\.uid\(\) IS NOT NULL THEN\s+-- Claim state[^\n]*\n\s+NEW\.claimed_by_user_id := OLD\.claimed_by_user_id;\s+NEW\.claimed_at := OLD\.claimed_at;/.test(all));
  ok('freeze: token burned once claimed, NULL → value only while unclaimed',
    /IF OLD\.claimed_by_user_id IS NOT NULL OR OLD\.claim_token IS NOT NULL THEN\s+NEW\.claim_token := OLD\.claim_token;/.test(all));
  ok('freeze: ID fields change only with a strictly newer scan',
    /IF OLD\.id_scanned_at IS NOT NULL\s+AND NOT \(NEW\.id_scanned_at IS NOT NULL AND NEW\.id_scanned_at > OLD\.id_scanned_at\) THEN/.test(all));
  ok('freeze: the non-owner block is kept verbatim',
    /IF auth\.uid\(\) IS NOT NULL AND auth\.uid\(\) IS DISTINCT FROM OLD\.user_id THEN\s+NEW\.user_id := OLD\.user_id;[\s\S]*?NEW\.project_ids := OLD\.project_ids;\s+END IF;/.test(mig));
  ok('freeze: silent pins only — no RAISE', !/RAISE/i.test(mig.replace(/--.*$/gm, '')));
  ok('freeze: still plpgsql, no SECURITY DEFINER / search_path (live shape)',
    /\$\$ LANGUAGE plpgsql;/.test(mig) && !/SECURITY DEFINER|SET search_path/i.test(mig.replace(/--.*$/gm, '')));
}

console.log('\n#71 edit a worker');
ok('Edit details saves name / trades / phone / email through updateCrewMember',
  /const changes: Partial<CrewMember> = \{ fullName: name \};/.test(crew)
  && /changes\.trades = editTrades\.split\(','\)/.test(crew) && /changes\.email = mail \|\| undefined;/.test(crew)
  && /updateCrewMember\(member\.id, changes\);/.test(crew));
ok('name required like handleAdd', /if \(!name\) \{ showAlert\('Name required'\); return; \}/.test(crew));
ok('a claimed worker\'s contact fields are locked with the reason',
  /const contactLocked = !!member\?\.claimedByUserId && member\.claimedByUserId !== auth\.user\?\.id;/.test(crew)
  && /He manages his contact details now/.test(crew) && /editable=\{!contactLocked\}/.test(crew));
ok('Active/Inactive switch writes status', /updateCrewMember\(member\.id, \{ status: active \? 'active' : 'inactive' \}\);/.test(crew)
  && /testID="crew-active-switch"/.test(crew) && /Inactive workers drop off Clock In and cert pickers; their shifts and certs stay\./.test(crew));
ok('the read-only status pill is gone', !/styles\.statusPill/.test(crew));
ok('inactive workers sorted last', /sortedMembers\.map\(m =>/.test(crew) && /a\.status === 'inactive' \? 1 : 0\) - \(b\.status === 'inactive' \? 1 : 0\)/.test(crew));
ok('"Email needed" offers Add email → the editor, email focused',
  /showAlert\('Email needed'[\s\S]{0,200}\{ text: 'Add email', onPress: \(\) => openEditor\(true\) \}/.test(crew)
  && /autoFocus=\{focusEmail && !contactLocked\}/.test(crew));
ok('Delete suggests Mark inactive first', /text: 'Mark inactive', onPress: \(\) => handleSetActive\(false\)/.test(crew)
  && /mark him inactive instead/.test(crew));

console.log('\n#72 the invite');
ok('the invite passes the member id', /sendClaimInvite\(member\.email, token, member\.id\)/.test(crew));
ok('the confirmation names the sender the server used', /gets an email from \$\{companyName\} to claim the profile/.test(crew));

console.log('\n#73/#74 claim-crew');
ok('reads the link error (web href, native initial URL + listener)',
  /parseAuthLinkError\(url\)/.test(claim) && /window\.location\.href/.test(claim)
  && /Linking\.getInitialURL\(\)/.test(claim) && /Linking\.addEventListener\('url'/.test(claim));
ok('no session 8 s after auth finished loading → link_expired',
  /const SESSION_WAIT_MS = 8000;/.test(claim) && /if \(!token \|\| authLoading \|\| isAuthenticated \|\| state !== 'waiting'\) return;/.test(claim));
ok('expired copy', /This sign-in link has expired or was already used\. Your invite is still good\. Sign in to finish claiming your profile\./.test(claim));
ok('Sign in stashes the claim path then goes to /login',
  /await setPendingDeepLink\(claimAppPath\(token\)\);[\s\S]{0,300}router\.replace\('\/login'\);/.test(claim));
ok('a fresh link can be requested right here', /requestFreshClaimLink\(addr, token\)/.test(claim));
ok('failures classified from the server code', /classifyClaimFailure\(edgeErrorCode\(e\)\)/.test(claim));
ok('network → "Couldn’t reach MAGE ID. Your invite is still good." + Retry',
  /Couldn’t reach MAGE ID\. Your invite is still good\./.test(claim) && /setRetryKey\(k => k \+ 1\)/.test(claim) && /retryKey\]\);/.test(claim));
ok('Go to app in every state but an in-flight redeem', /\{state !== 'redeeming' && \(/.test(claim) && !/state !== 'waiting' &&/.test(claim));
ok('done renders his profile inline', /import \{ ClaimedWorkerSelfView \} from '\.\/crew';/.test(claim)
  && /<ClaimedWorkerSelfView\s+members=\{myRows\}\s+embedded/.test(claim)
  && /crewMembers\.filter\(m => m\.claimedByUserId === user\.id\)/.test(claim));
ok('"Go to app" on done is the secondary "Set up your own MAGE account"', /Set up your own MAGE account/.test(claim));
ok('the /sub-profile "every contractor" link is gone (#74, #113 carry)', !/sub-profile/.test(claim) && !/every contractor/.test(claim));
ok('ClaimedWorkerSelfView is exported', /export function ClaimedWorkerSelfView\(/.test(crew) && /\{!embedded && <Stack\.Screen options=\{\{ title: 'My Profile' \}\} \/>\}/.test(crew));

console.log('\n#165/#166/#167 ID scan and certs');
ok('Re-scan ID is always rendered', /\{member\.idScannedAt \|\| member\.idMaskedLast4 \? 'Re-scan ID' : 'Scan ID'\}/.test(crew)
  && !/verifiedBadge\(member\) === 'id_verified' \? \(/.test(crew));
ok('expired IDs show "ID expired <date>" at the card, header chip and detail row',
  (crew.match(/<IdBadgeChip member=/g) ?? []).length === 2 && /badge === 'id_expired'/.test(crew) && /idExpiredLabel\(member\.idExpiry\)/.test(crew));
ok('Remove ID writes a fresh stamp and deletes the kept photo',
  /idScannedAt: new Date\(\)\.toISOString\(\),\s*\}\);\s*if \(oldPath\) void deleteStorageFile\('worker-ids', oldPath\);/.test(crew));
ok('a re-scan deletes the previously kept photo', /if \(previousImage && previousImage !== idImagePath\) void deleteStorageFile\('worker-ids', previousImage\);/.test(crew));
ok('the corrected name is written back', /const fullName = scanFields\.fullName\.trim\(\) \|\| target\?\.fullName;/.test(crew) && /\.\.\.\(fullName \? \{ fullName \} : \{\}\),/.test(crew));
ok('never verified without a number', /computeIdVerified\(\{ scanCompleted: true, userConfirmed: true \}\) && !!maskedLast4/.test(crew) && /if \(!maskedLast4\) return;/.test(crew));
ok('Save disabled with the reason', /disabled=\{!canSave\}/.test(crew) && /We couldn’t read an ID number — retake the photo or type the number\./.test(crew));
ok('retain switch hidden on web', /Platform\.OS === 'web' \? \(\s*<Text style=\{styles\.retainHelp\} testID="scan-retain-web-note">\s*Keeping the photo is iPhone-only/.test(crew));
ok('upload failed → alert + warning haptic, not success',
  /if \(imageNotKept\) \{[\s\S]{0,700}NotificationFeedbackType\.Warning\);\s*return;\s*\}/.test(crew));
ok('today is the local calendar day at render', /const today = todayCalendarDay\(\);/.test(crew) && !/toISOString\(\)\.slice\(0, 10\)/.test(crew));
ok('unreadable cert expiry → Check date (danger)', /check_date: 'Check date'/.test(crew) && /check_date: \{ color: t\.danger \}/.test(crew)
  && /crewCertRowStatus\(cert\.expiresDate, certExpiryStatus\(cert\.expiresDate, today\)\)/.test(crew));

console.log('\n#170 / #124');
ok('Direct Hire copy follows HIRE_ENABLED', /HIRE_ENABLED\s*\?\s*'Controls whether your profile can appear in the hiring marketplace\.'\s*:\s*'Direct Hire isn\\u2019t live yet\. Turn this on to be listed when it opens\.'/.test(crew));
ok('scan caps / plan gate go to /paywall, no retry',
  /if \(code === 'monthly_cap_reached' \|\| code === 'tier_required'\) \{\s*closeScan\(\);[\s\S]{0,300}router\.push\('\/paywall'\)/.test(crew));
ok('crewScan throws through edgeFunctionError', (read('utils/crewScan.ts').match(/throw await edgeFunctionError\(error,/g) ?? []).length >= 4);

console.log('\n#168 / #169');
ok('reportDay reads the LOCAL day of an instant', /function reportDay\(raw: string \| null \| undefined\): string \| null \{\s*return calendarDayOf\(raw\?\.trim\(\)\);\s*\}/.test(presence));
ok('presence channel is private', /config: \{ private: true, presence: \{ key: self\.userId \} \}/.test(hook));
ok('setAuth before subscribe', /await supabase\.realtime\.setAuth\(\);[\s\S]*?channel\.subscribe\(/.test(hook));
ok('a peer whose userId disagrees with its key is dropped', /if \(m\.userId !== key\) continue;/.test(hook));
ok('realtime policies: authenticated, schedule topics, presence/broadcast, can_access_project(text, text)',
  (mig.match(/ON realtime\.messages\s+FOR (SELECT|INSERT) TO authenticated/g) ?? []).length === 2
  && (mig.match(/realtime\.messages\.extension IN \('presence', 'broadcast'\)/g) ?? []).length === 2
  && (mig.match(/public\.can_access_project\(split_part\(realtime\.topic\(\), ':', 2\)::text, 'viewer'::text\)/g) ?? []).length === 2
  && !/::uuid/.test(mig.replace(/--.*$/gm, '')));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
