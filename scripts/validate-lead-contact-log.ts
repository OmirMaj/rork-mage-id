// validate-lead-contact-log.ts — website leads reach the GC, and reach the RIGHT
// GC (audit round 2, wave 2: findings #9 and #10).
//
//   #9  A website lead used to land in Pipeline with no push, email or inbox
//       row — on a screen whose own header calls first-response time "the
//       single biggest driver of close rate". Now an AFTER INSERT trigger on
//       leads raises `lead_received` for service-written website leads (the
//       quote form and the widget), and notify pushes/emails it with the range
//       the widget showed and the phone number. The lead screen's Call / Text /
//       Email asks "Log this call?" on return — only after the app actually
//       left, so a mis-tap never marks a lead answered — and logs through
//       addLeadTouch, which stamps firstRespondedAt.
//   #10 Leads were routed by a company-name slug: two same-named companies
//       sent every lead to the lower id, an accented name never matched, and a
//       GC with no company name was handed "project" — which resolved to any
//       stranger whose name slugs to it. The widget now embeds the account id
//       (unique, immutable, verified against profiles), the portfolio page can
//       send it too, and the slug RPC answers only a unique match. (The RPC is
//       executed in PGlite by the scratchpad harness; its text is pinned here.)

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (s: string) => s.replace(/^\s*\/\/.*$/gm, '');

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

type TranspilerCtor = new (o: { loader: string }) => { transformSync(s: string): string };
const Transpiler = (globalThis as unknown as { Bun: { Transpiler: TranspilerCtor } }).Bun.Transpiler;

function evalBlock<T>(file: string, marker: string, names: string[]): T | null {
  const src = read(file);
  const start = src.indexOf(`// >>> ${marker}`);
  const end = src.indexOf(`// <<< ${marker}`);
  ok(`${file} carries the ${marker} marker block`, start > -1 && end > start);
  if (!(start > -1 && end > start)) return null;
  const js = new Transpiler({ loader: 'ts' }).transformSync(src.slice(start, end).replace(/^export /gm, ''));
  return new Function(`${js}\nreturn { ${names.join(', ')} };`)() as T;
}

function caseBody(src: string, label: string): string {
  const i = src.indexOf(`case '${label}':`);
  if (i < 0) return '';
  const next = src.slice(i + 10).search(/\n {4}(case '[a-z_]+':|default:)/);
  return next < 0 ? src.slice(i) : src.slice(i, i + 10 + next);
}

console.log('\n#9 the lead reaches the GC');
const MIG = read('supabase/migrations/20260918140000_portal_reply_and_website_lead_notify.sql');
ok('an AFTER INSERT trigger on leads raises lead_received', /after insert on public\.leads[\s\S]*trg_notify_website_lead/.test(MIG) && /'lead_received'/.test(MIG));
ok('…only for service-written website leads in stage new', /NEW\.source = 'website'/.test(MIG) && /coalesce\(NEW\.stage, 'new'\) = 'new'/.test(MIG) && /v_role = 'service_role' or current_user = 'service_role'/.test(MIG));
const NOTIFY = read('supabase/functions/notify/index.ts');
const LEAD = caseBody(NOTIFY, 'lead_received');
ok('notify has a lead_received branch', LEAD.length > 0);
ok('the push names the range the widget showed and the phone', /saw \$\{saw\}/.test(LEAD) && /phone\]\.filter\(Boolean\)/.test(LEAD));
ok('the email button opens THIS lead', /appLink\('lead_received', \{ lead_id: leadId \}\)/.test(LEAD));
ok('the widget range is labelled as the widget\'s, not his price', /not your price/.test(LEAD));
const fmt = evalBlock<{ widgetBallparkText: (s: unknown) => string | null; scopeWithoutBallpark: (s: unknown) => string }>(
  'supabase/functions/notify/index.ts', 'notify-format', ['widgetBallparkText', 'scopeWithoutBallpark']);
if (fmt) {
  const scope = 'Kitchen remodel · ~200 sq ft · standard finishes · zip 78701 · Instant Estimate shown: $38,000–$52,000 · Island please';
  ok('reads the range widget-estimate printed', fmt.widgetBallparkText(scope) === '$38,000–$52,000', String(fmt.widgetBallparkText(scope)));
  ok('a quote-form lead has no widget range', fmt.widgetBallparkText('Redo the deck') === null && fmt.widgetBallparkText(null) === null);
  ok('the quoted scope is the homeowner\'s own words', fmt.scopeWithoutBallpark(scope) === 'Kitchen remodel · ~200 sq ft · standard finishes · zip 78701 · Island please');
}

console.log('\n#9 calling from the lead screen counts — once he says so');
const logic = evalBlock<{ contactToConfirm: (p: { kind: string; startedAt: number; leftApp: boolean } | null, now: number) => string | null }>(
  'app/lead-detail.tsx', 'lead-contact-log', ['contactToConfirm']);
if (logic) {
  const t = 1_700_000_000_000;
  ok('no pending tap → no prompt', logic.contactToConfirm(null, t) === null);
  ok('tapped Call but never left the app (cancelled sheet, mis-tap) → no prompt', logic.contactToConfirm({ kind: 'call', startedAt: t, leftApp: false }, t + 5000) === null);
  ok('left for the dialer and came back → ask about the call', logic.contactToConfirm({ kind: 'call', startedAt: t, leftApp: true }, t + 60_000) === 'call');
  ok('texts and emails are asked about as themselves', logic.contactToConfirm({ kind: 'text', startedAt: t, leftApp: true }, t + 1000) === 'text' && logic.contactToConfirm({ kind: 'email', startedAt: t, leftApp: true }, t + 1000) === 'email');
  ok('a tap from hours ago is not asked about', logic.contactToConfirm({ kind: 'call', startedAt: t, leftApp: true }, t + 3 * 3600_000) === null);
}
const LD = code(read('app/lead-detail.tsx'));
ok('Call / Text / Email all go through startContact', /startContact\('call', `tel:/.test(LD) && /startContact\('text', `sms:/.test(LD) && /startContact\('email', buildMailtoUrl/.test(LD));
ok('no quick action opens the dialer bare any more', !/Linking\.openURL\(`(tel|sms):/.test(LD));
ok('nothing is logged on the tap itself', !/startContact[\s\S]{0,200}addLeadTouch/.test(LD.slice(LD.indexOf('const startContact'), LD.indexOf('const startContact') + 250)));
ok('"Log it" logs through addLeadTouch (which stamps firstRespondedAt)', /text: 'Log it', onPress: \(\) => addLeadTouch\(leadIdNow, kind, copy\.touch\)/.test(LD));
ok('the app must have gone to the background first', /next === 'background'\) \{ markLeft\(\); return; \}/.test(LD) && /if \(pendingContactRef\.current\) pendingContactRef\.current\.leftApp = true;/.test(LD));
ok('…and on desktop web, losing window focus to the dialer/mail app counts as leaving', /win\?\.addEventListener\('blur', markLeft\)/.test(LD) && /win\?\.addEventListener\('focus', askOnReturn\)/.test(LD));

console.log('\n#9 a flood against one GC cannot become a flood of pushes');
{
  const PLIc = code(read('supabase/functions/public-lead-intake/index.ts'));
  const resolveAt = PLIc.indexOf('userId = contractorId ? await userForId(contractorId) : null;');
  const bucketAt = PLIc.indexOf('rateLimitCount(`lead:gc:${userId}`)');
  ok('public-lead-intake buckets per RESOLVED account, after resolving', resolveAt > -1 && bucketAt > resolveAt);
  ok('…and no bucket keyed on the caller-chosen slug string', !/lead:slug:/.test(PLIc));
  const WEc = code(read('supabase/functions/widget-estimate/index.ts'));
  ok('widget-estimate lowercases the per-contractor key', /rateLimitCount\(`widget:gc:\$\{contractorId\.toLowerCase\(\)\}`\)/.test(WEc) && !/`widget:gc:\$\{contractorId\}`/.test(WEc));
  ok('…and caps captured leads per resolved account', /rateLimitCount\(`widget:lead:\$\{userId\}`\)/.test(WEc) && /leadCount > WIDGET_LEAD_HOURLY_LIMIT/.test(WEc));
  // Post-ship review: the lead mail goes TO the GC, so its footer must not say
  // "Sent by <his own company>" and Reply must reach the homeowner.
  ok('lead_received names the lead as sender, not the GC', /sender: \{ name: who, email: leadEmail \?\? undefined, phone: phone \?\? undefined \}/.test(LEAD));
  ok('lead_received replies go to a well-formed lead email', /replyTo: leadEmail && \/\^[^\n]*\.test\(leadEmail\) \? leadEmail : undefined/.test(LEAD));
  ok('dispatchOne honours a sender override over sharedEmail', /\.\.\.sharedEmail,\s*\.\.\.\(spec\.sender !== undefined \? \{ sender: spec\.sender \?\? undefined \} : \{\}\)/.test(read('supabase/functions/notify/index.ts')));
  ok('notify caps lead_received per GC before dispatching', /exceedsRateLimit\(`notify:lead:\$\{gcUserId\}`, LEAD_NOTIFY_HOURLY_CAP\)[\s\S]*?break;[\s\S]*?await dispatchOne\('gc'/.test(LEAD));
}

console.log('\n#9 generated widget text is not quoted as the homeowner\'s words');
{
  const f2 = evalBlock<{ isWidgetScope: (s: unknown) => boolean }>('supabase/functions/notify/index.ts', 'notify-format', ['isWidgetScope']);
  if (f2) {
    ok('a widget scope is recognised', f2.isWidgetScope('Kitchen · ~200 sq ft · Instant Estimate shown: $1–$2') && f2.isWidgetScope('Deck · Instant Estimate could not price this scope'));
    ok('a quote-form scope is the homeowner\'s own words', !f2.isWidgetScope('Redo the deck before June') && !f2.isWidgetScope(null));
  }
  ok('the email quotes the scope only when it is not widget-built', /!fromWidget && ownWords \? emailQuote\(/.test(LEAD) && /fromWidget && ownWords \? emailStatRow\('Request details'/.test(LEAD));
}

console.log('\n#10 the lead reaches the RIGHT GC');
const WS = read('app/widget-setup.tsx');
const readyBlock = WS.slice(WS.indexOf('// >>> widget-ready'), WS.indexOf('// <<< widget-ready'));
ok('widget-setup gates on the company name, not on a slug that is never empty', /const ready = companyName\.length > 0 && widgetId\.length > 0;/.test(readyBlock));
ok('the snippet embeds the account id, not slugify(companyName)', /buildEmbedSnippet\(ready \? widgetId : WIDGET_SLUG_PLACEHOLDER/.test(WS) && !/slugify/.test(code(WS)));
const WE = read('supabase/functions/widget-estimate/index.ts');
ok('widget-estimate confirms a uuid names a real profile', /if \(UUID_RE\.test\(contractorId\)\) \{\s*const rows = await sbGet\(`profiles\?id=eq\./.test(WE));
const PLI = read('supabase/functions/public-lead-intake/index.ts');
ok('the quote form can route by account id first', /userId = contractorId \? await userForId\(contractorId\) : null;/.test(PLI));
ok('the portfolio snapshot can carry the account id', /contractorId: opts\.ownerId/.test(read('utils/publicProfileSnapshot.ts')));
const SLUG = read('supabase/migrations/20260918140100_company_slug_routing.sql').replace(/--.*$/gm, '');
ok('the slug RPC answers only a UNIQUE match', /case when \(select count\(\*\) from matches\) = 1 then/.test(SLUG) && !/order by p\.id\s+limit 1/.test(SLUG));
ok('…strips accents the way the app does', /normalize\(lower\(p\.company_name\), NFKD\)/.test(SLUG));
ok('…and never resolves the empty-name fallback "project"', /w\.s <> 'project'/.test(SLUG));
ok('embed.js tells the contractor when his snippet matches no account', /leadError === 'unknown_contractor'/.test(read('marketing/widget/embed.js')));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
