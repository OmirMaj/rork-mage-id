// scripts/validate-w5-crew-magic-link.ts — #72 (2026-09-23 audit): the crew
// claim invite is its own email, sent in the inviting contractor's name, and no
// email this function sends claims "no account will be created".
//
// The decisions live in supabase/functions/auth-magic-link/copy.ts (pure, no
// Deno globals), exercised directly here; index.ts is pinned by source for the
// parts that are wiring (caller verified before the branded mail, company name
// from the caller's profile, never from the body).
//
// Run via: bun run scripts/validate-w5-crew-magic-link.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parsePurpose, inviterIdentity, checkClaimInvite, claimRedirect,
  signInEmailCopy, crewClaimEmailCopy, isValidClaimTokenFormat,
} from '../supabase/functions/auth-magic-link/copy';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra ? `\n   ${extra}` : ''); }
}
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const T = 'crew_11111111-2222-4333-8444-555555555555';
const T2 = 'crew_99999999-2222-4333-8444-555555555555';

console.log('\npurpose');
ok('absent / empty / sign_in → sign_in', parsePurpose(undefined) === 'sign_in' && parsePurpose('') === 'sign_in' && parsePurpose('sign_in') === 'sign_in');
ok('crew_claim → crew_claim', parsePurpose('crew_claim') === 'crew_claim');
ok('anything else → null (400, never a silent fallback)', parsePurpose('invite') === null && parsePurpose(1) === null);
ok('token format matches utils/crew/claimToken', isValidClaimTokenFormat(T) && !isValidClaimTokenFormat('crew_abc'));

console.log('\nwho the invite is from');
ok('company name wins', inviterIdentity({ company_name: ' Ridge Builders ', contact_name: 'Omir' }).display === 'Ridge Builders');
ok('contact name when there is no company', inviterIdentity({ company_name: '', contact_name: 'Omir M' }).fromCompanyName === 'Omir M');
ok('nobody named → "Your contractor", plain MAGE ID sender',
  inviterIdentity(null).display === 'Your contractor' && inviterIdentity(null).fromCompanyName === undefined);

console.log('\nmay this caller send this invite');
const row = { id: 'm1', email: 'Maria@X.com ', claim_token: T, claimed_by_user_id: null };
let c = checkClaimInvite(row, 'maria@x.com', T2);
ok('his unclaimed row, matching email → mails the SERVER token, not the request\'s', c.ok && c.token === T && !c.mint, JSON.stringify(c));
c = checkClaimInvite(null, 'maria@x.com', T);
ok('not his row → 404 not_your_crew', !c.ok && c.status === 404 && c.code === 'not_your_crew');
c = checkClaimInvite({ ...row, claimed_by_user_id: 'w1' }, 'maria@x.com', T);
ok('already claimed → 409', !c.ok && c.code === 'already_claimed');
c = checkClaimInvite(row, 'someone@else.com', T);
ok('an address that is not the saved one → email_mismatch', !c.ok && c.code === 'email_mismatch');
c = checkClaimInvite({ ...row, email: null }, 'maria@x.com', T);
ok('no saved email → email_mismatch', !c.ok && c.code === 'email_mismatch');
c = checkClaimInvite({ ...row, claim_token: null }, 'maria@x.com', T2);
ok('no token on the server yet → mint the request token', c.ok && c.token === T2 && c.mint, JSON.stringify(c));
c = checkClaimInvite({ ...row, claim_token: null }, 'maria@x.com', 'junk');
ok('no token anywhere → refused', !c.ok && c.code === 'no_invite_token');

console.log('\nthe claim redirect');
ok('https claim route, token replaced by the server one',
  claimRedirect(`https://app.mageid.app/claim-crew?token=${T2}`, T) === `https://app.mageid.app/claim-crew?token=${T}`);
ok('localhost http allowed for dev', claimRedirect('http://localhost:8081/claim-crew', T) === `http://localhost:8081/claim-crew?token=${T}`);
ok('another path refused', claimRedirect('https://app.mageid.app/login?x=1', T) === null);
ok('plain http on a real host refused', claimRedirect('http://evil.example/claim-crew', T) === null);
ok('junk refused', claimRedirect('not a url', T) === null && claimRedirect(undefined, T) === null);

console.log('\nthe copy');
const signIn = signInEmailCopy('a@b.co');
const claim = crewClaimEmailCopy('Ridge Builders', 'maria@x.com');
const allText = (x: Record<string, string>) => Object.values(x).join(' ');
ok('no email says "no account will be created"', !/no account will be created/i.test(allText({ ...signIn })) && !/no account will be created/i.test(allText({ ...claim })));
ok('no email says "Welcome back"', !/welcome back/i.test(allText({ ...signIn })) && !/welcome back/i.test(allText({ ...claim })));
ok('claim subject names the company', claim.subject === 'Ridge Builders added you to their crew on MAGE ID', claim.subject);
ok('claim title / CTA', claim.title === 'Claim your crew profile' && claim.ctaLabel === 'Claim my profile');
ok('claim body says what claiming gives him', /phone, email and trades/.test(claim.subtitle));
ok('claim copy promises nothing about hiring (marketplace off)', !/hire|hiring|marketplace|found by/i.test(allText({ ...claim })));
ok('sign-in copy is neutral', signIn.title === 'Your MAGE ID sign-in link' && /ignore this email/.test(signIn.footer));

console.log('\nindex.ts wiring');
const src = stripComments(readFileSync(join(ROOT, 'supabase/functions/auth-magic-link/index.ts'), 'utf8'));
const branch = src.slice(src.indexOf("if (purpose === 'crew_claim')"), src.indexOf('// Mint the magic link') > 0 ? src.indexOf('generateLink') : undefined);
ok('crew_claim verifies the caller with GoTrue first', /const caller = await verifyUser\(req\);[\s\S]*?if \(!caller\?\.id\)/.test(branch));
ok('the row is read scoped to the CALLER as owner', /crew_members\?id=eq\.\$\{body\.memberId\}&user_id=eq\.\$\{caller\.id\}/.test(branch));
ok('the company name is read from the caller\'s profile', /profiles\?id=eq\.\$\{caller\.id\}&select=company_name,contact_name/.test(branch));
ok('no company name is taken from the request body', !/body\.(companyName|fromCompanyName|company)/.test(src));
ok('the mint is conditioned on an unclaimed, token-less row',
  /claim_token=is\.null&claimed_by_user_id=is\.null/.test(src));
ok('the email is sent from the inviter identity', /fromCompanyName = inviter\.fromCompanyName;/.test(branch) && /fromCompanyName,\n/.test(src));
ok('the throttle runs before the crew_claim branch',
  src.indexOf('rateLimitCount(`magiclink:email:') > 0 && src.indexOf('rateLimitCount(`magiclink:email:') < src.indexOf("if (purpose === 'crew_claim')"));
ok('index.ts has no "no account will be created" / "Welcome back" left', !/no account will be created|Welcome back/i.test(src));
ok('the action link is escaped into the HTML', /\$\{escapeHtml\(actionLink\)\}/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
