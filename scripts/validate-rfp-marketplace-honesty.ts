// validate-rfp-marketplace-honesty.ts — the homeowner marketplace and the
// supplier/company directories say only what is true.
//
// WHY THIS EXISTS (audit round 2, 2026-09-18 — findings #7, #8, #11, #19)
//
// #7/#19 — award_rfp built the winning contractor's project from title +
//   city/state + scope. It SELECTed photo_urls, drawing_urls, bid_amount and
//   estimate_summary and threw every one away, never read address_line or
//   contact_email, and seeded the portal invite as {name:'', email:''}. The
//   homeowner was then told "the project + client portal are set up". The
//   fix lives in supabase/migrations/20260918120000 (executed against PGlite
//   in the scratchpad test award_rfp_carry.mjs). This guard pins, statically,
//   that the NEWEST migration defining award_rfp still carries each field,
//   and that the homeowner-facing copy promises the link, not the portal.
//
// #8 — post-rfp told every homeowner contractors "will be notified". The
//   matcher treated a company with no service area as covering the whole
//   country, and its count went to a pg_net call that discards responses.
//   The rule and the homeowner's sentence now live in one pure module
//   (supabase/functions/notify-nearby-contractors/reach.ts), which this guard
//   EXECUTES.
//
// #11 — the Suppliers screen emailed invented prices, signed "Sent via MAGE
//   ID", to invented addresses at real-looking domains; the Tools card
//   promised "price history"; Companies called Google Places rows members
//   "publishing public profiles".
//
// Run: bun run scripts/validate-rfp-marketplace-honesty.ts

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  companyServesRfp, rfpReachLine, postedAlertBody, REACH_REPORT_GRACE_MS,
} from '../supabase/functions/notify-nearby-contractors/reach';
import { awardCarriedItems, joinItems } from '../supabase/functions/award-rfp/carried';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

/** Source with // and /* *\/ comments removed, so a comment QUOTING the old
 *  promise (as the fixes do, to explain themselves) never counts as shipping it. */
function code(src: string): string {
  // A block comment opens after whitespace or `{` — never inside a string
  // like 'image/*', which would otherwise swallow half of post-rfp.
  return src
    .replace(/(^|[\s{(])\/\*[\s\S]*?\*\//g, '$1')
    .split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
}

// ── #8: the matcher (executed) ──────────────────────────────────────────────
console.log('\n#8 — who a homeowner RFP alerts');
const AUSTIN = { state: 'TX', latitude: 30.27, longitude: -97.74 };
ok('a company with no service area is NOT alerted (it used to match every RFP in the country)',
  companyServesRfp({ service_states: [], service_origin_lat: null, service_origin_lng: null }, AUSTIN) === false);
ok('states covering the RFP state → alerted',
  companyServesRfp({ service_states: ['TX'] }, AUSTIN) === true);
ok('states that do not include the RFP state → not alerted',
  companyServesRfp({ service_states: ['CA'] }, AUSTIN) === false);
ok('origin within radius → alerted',
  companyServesRfp({ service_origin_lat: 30.3, service_origin_lng: -97.7, service_radius_miles: 25 }, AUSTIN) === true);
ok('origin outside radius → not alerted (Dallas is ~180 mi from Austin)',
  companyServesRfp({ service_origin_lat: 32.78, service_origin_lng: -96.8, service_radius_miles: 25 }, AUSTIN) === false);
ok('states set but the RFP state did not parse and there are no coords → cannot tell → not alerted',
  companyServesRfp({ service_states: ['TX'] }, { state: '', latitude: null, longitude: null }) === false);
ok('state matches but origin is out of range → not alerted (every check that can run must pass)',
  companyServesRfp({ service_states: ['TX'], service_origin_lat: 32.78, service_origin_lng: -96.8, service_radius_miles: 25 }, AUSTIN) === false);

const fanout = read('supabase/functions/notify-nearby-contractors/index.ts');
const fanoutCode = code(fanout);
ok('the fan-out matches through reach.ts companyServesRfp',
  /import \{[^}]*companyServesRfp[^}]*\} from "\.\/reach\.ts"/.test(fanout) && /companyServesRfp\(c, rfp\)/.test(fanoutCode));
ok('the fan-out no longer treats "no states" as "anywhere"',
  !/states\.length === 0 \|\|/.test(fanoutCode));
ok('the fan-out writes its count back onto public_bids (notified_count / notified_at)',
  /recordReach\(rfp\.id, dispatched\)/.test(fanoutCode) && /notified_count: notifiedCount, notified_at:/.test(fanoutCode)
  && /method: "PATCH"/.test(fanoutCode));

const reachMig = readdirSync(join(ROOT, 'supabase/migrations')).find(f => /_rfp_notify_reach\.sql$/.test(f));
const reachSql = reachMig ? read(`supabase/migrations/${reachMig}`) : '';
ok('a migration adds public_bids.notified_count / notified_at, server-owned by trigger',
  /add column if not exists notified_count integer/.test(reachSql) && /add column if not exists notified_at timestamptz/.test(reachSql)
  && /create trigger public_bids_keep_notify_result/.test(reachSql));

// ── #8: what the homeowner reads (executed) ─────────────────────────────────
console.log('\n#8 — what the homeowner is told');
const NOW = Date.parse('2026-09-18T12:00:00Z');
const fresh = new Date(NOW - 60_000).toISOString();
const stale = new Date(NOW - REACH_REPORT_GRACE_MS - 60_000).toISOString();
const zero = rfpReachLine({ notified_count: 0, notified_at: fresh, posted_date: fresh }, NOW, false);
ok('0 reached is said as 0', zero.tone === 'none' && /nobody was alerted/.test(zero.text), zero.text);
const zeroVerified = rfpReachLine({ notified_count: 0, notified_at: fresh, verified_only: true, posted_date: fresh }, NOW, false);
ok('verified-only with 0 reached names the license filter', /license on file/.test(zeroVerified.text), zeroVerified.text);
const three = rfpReachLine({ notified_count: 3, notified_at: fresh, posted_date: fresh }, NOW, false);
ok('a real count is shown as that count', three.tone === 'some' && three.text.startsWith('3 contractors'), three.text);
ok('no report yet, just posted → "checking", not a number',
  rfpReachLine({ notified_count: null, notified_at: null, posted_date: fresh }, NOW, false).tone === 'pending');
const noReport = rfpReachLine({ notified_count: null, notified_at: null, posted_date: stale }, NOW, false);
ok('no report after the grace window → "no record", never a promise and never a zero',
  noReport.tone === 'unknown' && !/will be notified|nobody was alerted/.test(noReport.text), noReport.text);
ok('the post-rfp alert promises nothing about who "will be notified"',
  !/will be notified/i.test(postedAlertBody('Austin', false, false)) && /My RFPs shows how many/.test(postedAlertBody('Austin', true, false)));
ok('a count says "were alerted" — the fan-out counts only notify-reported deliveries',
  /were alerted/.test(three.text), three.text);
{
  const notifySrc = read('supabase/functions/notify/index.ts');
  ok('notify reports `delivered` only when a push or email was actually sent',
    /if \(pushStatus === 'sent' \|\| emailStatus === 'sent'\) deliveredAny = true;/.test(notifySrc)
    && /return \{ ok: true, event, gc: gcUserId, delivered: deliveredAny \};/.test(notifySrc));
  ok('the fan-out counts a contractor only when notify says delivered',
    /if \(j\?\.result\?\.delivered === true\) dispatched\+\+; else undelivered\+\+;/.test(fanout));
  ok('matched-but-nobody-reached writes no count (never a false "nobody covers your area")',
    /if \(uniq\.length === 0 \|\| dispatched > 0\) \{\s*await recordReach\(rfp\.id, dispatched\);/.test(fanout));
}

// Round-2 review: "your post stays listed for contractors who browse nearby
// jobs" was appended to every line, but RFP_BROWSE_ENABLED is false — no
// contractor can browse a homeowner post. With browsing off, nothing may say
// the post is listed or browsable, and a zero must say nobody will see it.
const browseOff = [
  zero.text, zeroVerified.text, three.text, noReport.text,
  postedAlertBody('Austin', false, false), postedAlertBody('Austin', true, false),
];
ok('browsing off → no line claims the post is "listed" or browsable nearby',
  browseOff.every(t => !/listed|browse nearby/i.test(t)), browseOff.find(t => /listed|browse nearby/i.test(t)));
ok('browsing off → every line says contractors can\'t browse posted projects yet',
  browseOff.every(t => /can't browse posted projects/.test(t)));
ok('browsing off and 0 alerted → says nobody will see it',
  /Nobody will see this post/.test(zero.text) && /Nobody will see this post/.test(zeroVerified.text));
ok('browsing on → the listed sentence is used instead',
  /stays listed/.test(rfpReachLine({ notified_count: 0, notified_at: fresh }, NOW, true).text)
  && /stays listed/.test(postedAlertBody('Austin', false, true)));
const flags = read('constants/featureFlags.ts');
ok('RFP_BROWSE_ENABLED is the flag these screens pass (still exported)',
  /export const RFP_BROWSE_ENABLED = (true|false);/.test(flags));

const post = read('app/post-rfp.tsx');
const postCode = code(post);
ok('post-rfp success alert comes from postedAlertBody',
  /postedAlertBody\(cityState\.city, verifiedOnly, RFP_BROWSE_ENABLED\)/.test(postCode)
  && /import \{ RFP_BROWSE_ENABLED \} from '@\/constants\/featureFlags'/.test(post));
ok('post-rfp says, under the verified-only toggle, that it can mean nobody is alerted',
  /If no contractor with a license on file covers your area, nobody is alerted\./.test(postCode));
ok('post-rfp no longer promises contractors "will be notified" or "verified contractors near you"',
  !/will be notified/i.test(postCode) && !/find verified contractors near you/i.test(postCode));

const myRfps = read('app/my-rfps.tsx');
const myCode = code(myRfps);
ok('my-rfps reads the fan-out count and renders it through rfpReachLine',
  /notified_count,notified_at,verified_only/.test(myCode) && /rfpReachLine\(r, Date\.now\(\), RFP_BROWSE_ENABLED\)/.test(myCode)
  && /import \{ RFP_BROWSE_ENABLED \} from '@\/constants\/featureFlags'/.test(myRfps));
ok('my-rfps retries without the reach columns when the migration is missing (never an empty list for real posts)',
  /error\.code === '42703' \|\| error\.code === 'PGRST204'/.test(myCode) && /fetchRfps\(BASE_COLS\)/.test(myCode));
ok('my-rfps empty state no longer promises "verified contractors near you get notified" or "No fees"',
  !/get notified/i.test(myCode) && !/No fees/.test(myCode));

// ── #7/#19: the award carries what the homeowner gave ──────────────────────
console.log('\n#7/#19 — award_rfp hands over the job');
const migs = readdirSync(join(ROOT, 'supabase/migrations')).filter(f => /^\d{14}_.*\.sql$/.test(f)).sort();
const awardMigs = migs.filter(f => /create or replace function public\.award_rfp\(/i.test(read(`supabase/migrations/${f}`)));
const newest = awardMigs[awardMigs.length - 1] ?? '';
const award = newest ? read(`supabase/migrations/${newest}`) : '';
const body = award.slice(award.search(/create or replace function public\.award_rfp\(/i));
ok(`newest award_rfp definition found (${newest || 'none'})`, !!newest);
ok('award_rfp reads address_line, contact_email and the post\'s lat/lng',
  /address_line/.test(body) && /contact_email/.test(body) && /latitude, longitude/.test(body));
ok('project location is the street address first (not CONCAT_WS(city, state) alone)',
  /v_location := COALESCE\(\s*NULLIF\(btrim\(v_bid\.address_line\), ''\)/.test(body) && /\bv_location,/.test(body));
ok('the accepted bid becomes target_budget, to the cent, setBy client',
  /round\(v_winner\.bid_amount::numeric, 2\)/.test(body) && /'setBy',\s*'client'/.test(body) && /target_budget/.test(body));
ok('primary_contact and the portal invite carry the homeowner email',
  /primary_contact/.test(body) && /'email', v_email/.test(body) && !/'email', ''/.test(body));
ok('photos (and image drawings) are filed on the new project',
  /INSERT INTO public\.photos/.test(body) && /'Homeowner photo'/.test(body) && /'Homeowner drawing'/.test(body));
ok('drawings are linked from the description (PDFs have no other home)',
  /Drawings the homeowner attached:/.test(body));
ok('the portalId is minted portal-<id8>-<ts>, not a bare uuid',
  /v_portal_id := 'portal-' \|\| left\(v_project_id::text, 8\)/.test(body));
ok('award_rfp returns contractValue, heroPhotoUrl and homeownerEmail',
  /'contractValue'/.test(body) && /'heroPhotoUrl'/.test(body) && /'homeownerEmail'/.test(body));
ok('award_rfp stays service-role only',
  /revoke execute on function public\.award_rfp\(uuid, uuid, uuid\) from public, anon, authenticated/.test(award));

const edge = code(read('supabase/functions/award-rfp/index.ts'));
ok('award-rfp forwards contract_value and hero_photo_url to the rfp_awarded email',
  /contract_value: Number\(result\.contractValue\)/.test(edge) && /hero_photo_url: result\.heroPhotoUrl/.test(edge));
ok('award-rfp returns homeownerEmail to the app',
  /homeownerEmail: result\.homeownerEmail/.test(edge));
ok('award-rfp forwards homeowner_email to the rfp_awarded email',
  /homeowner_email: result\.homeownerEmail/.test(edge));
// The contractor's email must match what the homeowner was told: HE sends the
// portal link. No "live portal between the two of you" / "kickoff message".
{
  const notifySrc = read('supabase/functions/notify/index.ts');
  const at = notifySrc.indexOf("case 'rfp_awarded':");
  const rfpCase = at >= 0 ? notifySrc.slice(at, notifySrc.indexOf('\n    case ', at + 10)) : '';
  ok('rfp_awarded tells the contractor to publish the portal and send the link',
    /open portal setup to publish it and send them the link/.test(rfpCase)
    && /publish their portal and send the link to/.test(rfpCase)
    && !/live portal between the two of you/.test(rfpCase)
    && !/kickoff message/.test(rfpCase));
}

const review = code(read('app/rfp-responses-review.tsx'));
ok('the award screen no longer says the client portal is "set up" / "will be created"',
  !/client portal are set up/.test(review) && !/client portal will be created/.test(review));
ok('the award screen says the contractor will send the portal link, to the email award_rfp used',
  /data\.homeownerEmail/.test(review) && /send the link to \$\{email\}/.test(review));

ok('both award alerts name only what award_rfp carried (built from the RFP header)',
  /select\('id,user_id,title,status,awarded_response_id,address_line,photo_urls,drawing_urls'\)/.test(review)
  && (review.match(/awardCarriedItems\(rfp \?\? \{\}/g) ?? []).length >= 2
  && /'Awarded!',\s*`\$\{company\} has been notified\. \$\{carried\.charAt\(0\)/.test(review)
  && !/your address, photos, any drawings/i.test(review));
const carriedNone = joinItems(awardCarriedItems({ address_line: '', photo_urls: [], drawing_urls: null }, null));
ok('no street address, no photos, no drawings, no price → only "your city" is claimed',
  carriedNone === 'your city (you gave no street address)', carriedNone);
const carriedAll = joinItems(awardCarriedItems({ address_line: '412 Elm St', photo_urls: ['a', ' '], drawing_urls: ['d1', 'd2'] }, '$48,500.00'));
ok('address, photos, drawings and price are each named with real counts',
  carriedAll === 'your street address, 1 photo, 2 drawings and the $48,500.00 price', carriedAll);
ok('the award screen\'s no-bids state promises no "contractors near you will see your project"',
  !/will see your project/.test(review) && !/start submitting bids/.test(review)
  && /RFP_BROWSE_ENABLED\s*\?/.test(review));

const clientHome = code(read('components/ClientHome.tsx'));
ok('ClientHome promises no "verified contractors" bidding or sending bids',
  !/verified contractors will bid/i.test(clientHome) && !/verified contractors near the property send you bids/i.test(clientHome)
  && (clientHome.match(/We alert MAGE ID contractors who cover your area and show you how many that was\./g) ?? []).length === 2);
ok('ClientHome\'s awarded card says who sends the portal link',
  /isAwarded\s*\?\s*'Your contractor has your details and will send your project portal link\.'/.test(clientHome));

// ── #11: supplier + company directories ─────────────────────────────────────
console.log('\n#11 — invented and scraped businesses are labelled, never contacted');
const mkt = code(read('app/(tabs)/marketplace/index.tsx'));
ok('the Suppliers screen opens no mail/phone/web link to a mock supplier',
  !/mailto:/.test(mkt) && !/Linking\.openURL/.test(mkt) && !/tel:/.test(mkt));
ok('no "Request Quote" and no "Sent via MAGE ID" email body',
  !/Request Quote/i.test(mkt) && !/Sent via MAGE ID/.test(mkt));
ok('the banner no longer says to "tap Contact", and says every row is made up',
  !/Contact&quot; to reach out/.test(mkt) && /Every supplier, price and stock level here is a made-up example/.test(mkt));
ok('mock star ratings and "Featured" badges are not rendered',
  !/renderStars\(/.test(mkt) && !/>Featured</.test(mkt));

const tools = code(read('app/(tabs)/discover/tools.tsx'));
const toolsRow = tools.split('\n').find(l => /feature: 'marketplace'/.test(l)) ?? '';
ok('the Tools card no longer promises "price history" and says it is a sample',
  !!toolsRow && !/price history/i.test(toolsRow) && /Sample catalog/.test(toolsRow), toolsRow.trim());
const side = code(read('components/DesktopSidebar.tsx'));
const sideRow = side.split('\n').find(l => /feature: 'marketplace'/.test(l)) ?? '';
ok('the sidebar row is labelled a sample', /label: 'Suppliers \(sample\)'/.test(sideRow), sideRow.trim());

const companies = code(read('app/(tabs)/discover/companies.tsx'));
ok('Companies no longer calls Google rows firms "publishing public profiles"',
  !/publishing public profiles/.test(companies) && !/as more companies join/.test(companies));
ok('each Companies row is labelled a public Google listing, not a member',
  /Public business listing \(Google\) · not a MAGE ID member/.test(companies) && /Google reviews/.test(companies));
ok('the dead Call/Website buttons are replaced by a Google Maps link on place_id',
  !/tel:\$\{/.test(companies) && /query_place_id=/.test(companies));

console.log('\nmoney on the award path is exact to the cent');
const reviewCents = code(read('app/rfp-responses-review.tsx'));
ok('priceTextFor and the award confirmation print cents (award_rfp stores round(bid, 2))',
  /formatMoney\(amount, 2\)/.test(reviewCents) && /formatMoney\(response\.bid_amount, 2\)/.test(reviewCents) && !/formatMoney\(amount\)/.test(reviewCents));
const notifySrc = read('supabase/functions/notify/index.ts');
const awardedCase = notifySrc.slice(notifySrc.indexOf("case 'rfp_awarded':"), notifySrc.indexOf("case 'contract_signed':"));
ok('the rfp_awarded email hero prints the contract value to the cent',
  /const awardedValueText = Number\(contractValue\) > 0 \? fmtMoneyCents\(contractValue\) : null;/.test(awardedCase) && !/fmtMoney\(contractValue\)/.test(awardedCase));

console.log('\n#7/#8/#19 — the public selling pages say what the app says');
// The app stopped promising a portal on award, alerts to "verified contractors
// near you" and a settable service area; the marketing pages kept all three
// until the integration review (2026-09-18). Tag-stripped visible text + meta.
const pageText = (p: string) => {
  const html = read(p);
  const metas = [...html.matchAll(/<(?:meta[^>]+content|title)[^>]*>/g)].map(m => m[0]).join(' ');
  const visible = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ');
  return (metas + ' ' + visible + ' ' + [...html.matchAll(/data-label="([^"]*)"|alt="([^"]*)"/g)].map(m => m[1] ?? m[2]).join(' '))
    .replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');
};
const OVERCLAIMS: [RegExp, string][] = [
  [/verified contractors (near you|nearby)|nearby verified contractors/i, '"verified contractors near you"'],
  [/portal (opens|goes live|is set up)|portal opens (automatically|instantly)/i, 'a portal that opens on award'],
  [/Set your service area once/i, 'a service area you can set today'],
  [/within seconds|the second a (matching )?project lands/i, 'instant alerts'],
  [/first bid the same day/i, 'same-day bids'],
  // Post-ship review: every signed-in account can read a homeowner RFP's
  // street address and email (public_bids_select USING (true)), so the page
  // may not promise the address stays private.
  [/street address stays private|address kept private|full address shared after/i, 'a private street address'],
  [/real bids in\s*days|days, not\s*months/i, 'bids within days'],
  [/see exactly who your post reached/i, 'seeing who the post reached (it shows a count)'],
];
for (const page of ['marketing/features/post-a-project.html', 'marketing/features/vs-competitors.html']) {
  const txt = pageText(page);
  for (const [re, what] of OVERCLAIMS) ok(`${page} does not promise ${what}`, !re.test(txt), txt.match(re)?.[0]);
}
const pap = pageText('marketing/features/post-a-project.html');
ok('post-a-project says how many it reached, that browsing is not open, and that the contractor sends the link',
  /how many it reached/.test(pap) && /can t browse open posts yet|can't browse open posts yet/.test(pap) && /send(s)? you (the|your) (project portal )?link/i.test(pap));
ok('post-a-project says service-area setup is coming', /Service-area setup is coming/.test(pap));
ok('the Property Manager\'s "Post for bids" does not promise verified contractors',
  !/verified contractors compete/.test(code(read('app/work-order.tsx'))) && /contractors who cover your area/.test(read('app/work-order.tsx')));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
