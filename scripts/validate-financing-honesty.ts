// scripts/validate-financing-honesty.ts — Q4 (2026-09-24): Stripe payments +
// client financing say exactly what the app does.
//
// THE FOUNDER: "STRIPE SETUP/CLIENT FINANCING". The investigation found:
//   1. the portal "Finance this project" button never showed for a homeowner —
//      app/client-view.tsx decided it from the VIEWER's settings, and the page
//      homeowners actually get (marketing/portal/index.html) had no button;
//   2. the copy contradicted itself — a working "bring your own lender"
//      feature beside a "Wisetack early access Q3 2026" card and a Business-
//      only "Client financing (Wisetack)" plans row, a disclosure saying MAGE
//      ID "may receive compensation" (it receives none), and a toggle promising
//      "estimates & invoices" when only invoice emails carry the offer;
//   3. a re-used referral opened the lender at an EARLIER invoice's amount;
//   4. a "funded" counter that no lender can ever advance, and a partner
//      return page (/financing/thanks) that does not exist;
//   5. create-payment-link minted a PLATFORM-owned link (money in MAGE's
//      balance, no fee) whenever stripeAccountId was left out;
//   6. "Funds in your bank in 1–2 business days" and card-only fee copy.
//
// DECISION (founder, via the orchestrator): keep "bring your own lender", open
// to every plan; remove Wisetack and any claim of MAGE compensation; do NOT
// change the platform fee schedule.
//
// Pure halves are EXECUTED (utils/financingCore.ts and utils/platformFees.ts
// are imported; the edge function's resolvePayoutAccount and the static
// portal's financingPortalUrl / renderFinancingCard are lifted and run). The
// wiring is checked on comment-stripped source.
//
// Run via: bun run scripts/validate-financing-honesty.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../utils/financingCore';
import * as fees from '../utils/platformFees';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra ? `\n   ${extra}` : ''); }
}
const read = (p: string) => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return ''; } };
/** Source with comments removed, so a comment can never satisfy a code check. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

function liftFunction(src: string, name: string): string {
  const m = new RegExp(`(?:export\\s+)?function\\s+${name}\\s*\\(`).exec(src);
  if (!m) return '';
  let j = m.index + m[0].length - 1, paren = 0;
  for (; j < src.length; j++) {
    if (src[j] === '(') paren++;
    else if (src[j] === ')') { paren--; if (paren === 0) break; }
  }
  // Skip a return-type annotation that itself holds braces (PayoutAccountDecision
  // is a named type, so the first `{` after `)` is the body).
  const open = src.indexOf('{', j);
  let depth = 0;
  for (let p = open; p < src.length; p++) {
    if (src[p] === '{') depth++;
    else if (src[p] === '}') { depth--; if (depth === 0) return src.slice(m.index, p + 1).replace(/^export\s+/, ''); }
  }
  return '';
}
declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' }) => { transformSync(code: string): string };
};
const transpiler = new Bun.Transpiler({ loader: 'ts' });
function load<T>(sources: string[], expr: string): T {
  if (sources.some((s) => !s.trim())) {
    ok(`${expr} exists and can be lifted`, false);
    return ((() => undefined) as unknown) as T;
  }
  try {
    const js = transpiler.transformSync(sources.join('\n\n') + `\n;globalThis.__q4fin = (${expr});`);
    new Function(js)();
    return (globalThis as unknown as { __q4fin: T }).__q4fin;
  } catch (e) {
    ok(`${expr} evaluates`, false, String(e));
    return ((() => undefined) as unknown) as T;
  }
}

const LIVE = {
  enabled: true, partnerName: '  Acme Home Loans ', prequalBaseUrl: 'https://acme.example/prequal',
  gcRefCode: 'GC-42', exampleApr: 9.99, exampleTermMonths: 60, updatedAt: '2026-09-24T00:00:00.000Z',
};
const settingsWith = (financing: unknown) => ({ financing } as unknown as Parameters<typeof core.portalFinancingBlock>[0]);

// ════════════════════════════════════════════════════════════════════════════
// 1 · the words: bring your own lender, MAGE ID is not paid
// ════════════════════════════════════════════════════════════════════════════
{
  const d = core.financingDisclosureText('Acme Home Loans');
  ok('the disclosure names the lender as a third party', /Acme Home Loans, a third-party lender/.test(d), d);
  ok('…says MAGE ID is not a lender and is not paid for the referral', /MAGE ID is not a lender and is not paid for this referral/.test(d), d);
  ok('…and never "may receive compensation"', !/compensation/i.test(d), d);
  ok('the explainer says "bring your own lender", no lending partner, every plan',
    /Bring your own lender/.test(core.FINANCING_EXPLAINER) && /has no lending partner/.test(core.FINANCING_EXPLAINER)
    && /Available on every plan/.test(core.FINANCING_EXPLAINER) && /earns nothing/.test(core.FINANCING_EXPLAINER));
  ok('no GC-facing copy promises to be paid in full upfront (that is the lender\'s term, not ours)',
    !/paid in full upfront/i.test(core.FINANCING_EXPLAINER));
  ok('the toggle promises invoices and the portal — not estimates (estimate emails carry no offer)',
    core.FINANCING_TOGGLE_LABEL === 'Offer financing on invoices and your client portal');
  const sum = core.financingReferralSummary({ created: 3.7, clicked: -1 });
  ok('the referral line counts links created and clicked, and nothing "funded"',
    sum === 'Financing links: 3 created · 0 clicked' && !/funded/i.test(sum), sum);
  ok('…and says where approvals live instead', /lender's own dashboard/.test(core.FINANCING_TRACKING_LIMIT));
}

// ════════════════════════════════════════════════════════════════════════════
// 2 · the portal block: from the GC's settings, no URL or code inside
// ════════════════════════════════════════════════════════════════════════════
{
  ok('financing off → no portal block', core.portalFinancingBlock(settingsWith({ ...LIVE, enabled: false })) === undefined);
  ok('no settings at all → no portal block', core.portalFinancingBlock(undefined) === undefined);
  ok('on but no lender name → no portal block', core.portalFinancingBlock(settingsWith({ ...LIVE, partnerName: '  ' })) === undefined);
  ok('on but an http:// link → no portal block', core.portalFinancingBlock(settingsWith({ ...LIVE, prequalBaseUrl: 'http://acme.example' })) === undefined);
  const b = core.portalFinancingBlock(settingsWith(LIVE));
  ok('on, named, https → { partnerName (trimmed), disclosure }',
    !!b && b.partnerName === 'Acme Home Loans' && b.disclosure === core.financingDisclosureText('Acme Home Loans')
    && Object.keys(b).sort().join(',') === 'disclosure,partnerName', JSON.stringify(b));
  const json = JSON.stringify(b);
  ok('…carrying neither the lender URL nor the GC referral code nor example terms',
    !/acme\.example|GC-42|9\.99|60/.test(json), json);
}

// ════════════════════════════════════════════════════════════════════════════
// 3 · the portal link (app) and the SAME link (static portal page)
// ════════════════════════════════════════════════════════════════════════════
const PID = '22222222-2222-4222-8222-222222222222';
const FN = 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1';
{
  const url = core.portalFinancingRedirectUrl(`${FN}/`, { projectId: PID, portalId: 'portal 1', accessToken: 't/k' });
  ok('the app builds financing-redirect\'s portal entry, every part encoded',
    url === `${FN}/financing-redirect?project=${PID}&src=portal&portal=portal%201&t=t%2Fk`, String(url));
  ok('no access key → no link (the GC\'s own preview)', core.portalFinancingRedirectUrl(FN, { projectId: PID, portalId: 'p', accessToken: '' }) === null);
  ok('no portal id → no link', core.portalFinancingRedirectUrl(FN, { projectId: PID, portalId: null, accessToken: 'k' }) === null);
  ok('a project id financing-redirect would refuse (not a UUID) → no link',
    core.portalFinancingRedirectUrl(FN, { projectId: 'portal:abc', portalId: 'p', accessToken: 'k' }) === null);
  const note = core.portalFinancingPreviewNote('Acme Home Loans');
  ok('the GC preview says what the client sees and why it is not live here',
    /Your client sees a "Check financing options" button here/.test(note) && /Acme Home Loans/.test(note) && /not from this preview/.test(note), note);
}

const html = read('marketing/portal/index.html');
{
  const fnUrl = liftFunction(html, 'financingPortalUrl');
  const fnCard = liftFunction(html, 'renderFinancingCard');
  const esc = liftFunction(html, 'esc');
  type Data = { portalApi?: { projectId?: string; portalId?: string; supabaseUrl?: string }; project?: { id?: string } };
  const mk = (token: string) => load<(d: Data) => string>(
    [`function getPortalToken() { return ${JSON.stringify(token)}; }`, fnUrl], 'financingPortalUrl');
  const withKey = mk('t/k');
  const data: Data = { portalApi: { projectId: PID, portalId: 'portal 1', supabaseUrl: 'https://nteoqhcswappxxjlpvap.supabase.co/' } };
  const pageUrl = withKey(data);
  ok('the static portal builds the IDENTICAL link the app builds',
    pageUrl === core.portalFinancingRedirectUrl(FN, { projectId: PID, portalId: 'portal 1', accessToken: 't/k' }), pageUrl);
  ok('…with no ?t= key the page builds none (no dead button)', mk('')(data) === '');
  ok('…nor for a project id that is not a UUID', withKey({ portalApi: { projectId: 'x', portalId: 'p' } }) === '');
  const card = load<(f: unknown, u: string) => string>(
    [esc, 'var ICONS = { creditCard: "" }; function icn() { return ""; }', fnCard], 'renderFinancingCard');
  const cardHtml = card({ partnerName: 'Acme <b>Loans</b>', disclosure: core.financingDisclosureText('Acme') }, 'https://x/y?a=1&b=2');
  ok('the card is a real link to that URL, opened in a new tab',
    /<a class="invoice-pay-btn fin-btn" href="https:\/\/x\/y\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer"/.test(cardHtml), cardHtml.slice(0, 300));
  ok('…labelled "Check financing options", the lender name escaped', /Check financing options/.test(cardHtml) && /Acme &lt;b&gt;Loans&lt;\/b&gt;/.test(cardHtml) && !/<b>Loans/.test(cardHtml));
  ok('…with the snapshot\'s disclosure under it', cardHtml.includes('is not paid for this referral'));
  const page = code(html);
  ok('render() adds the section only when data.financing is present AND a link could be built',
    /var finUrl = data\.financing && data\.financing\.partnerName \? financingPortalUrl\(data\) : '';\s*if \(finUrl\) \{\s*addSection\('financing'/.test(page));
  ok('Open House mode strips the financing offer with the other money surfaces',
    /if \(IS_OPEN_HOUSE\) \{[\s\S]{0,400}delete data\.financing;/.test(page));
}

// ════════════════════════════════════════════════════════════════════════════
// 4 · the app reads the GC's decision, never the viewer's settings
// ════════════════════════════════════════════════════════════════════════════
{
  const cv = code(read('app/client-view.tsx'));
  ok('client-view no longer decides financing from the viewer\'s settings (isFinancingAvailable(settings))',
    !/isFinancingAvailable\(settings\)/.test(cv));
  ok('…a homeowner reads the snapshot\'s block; the GC\'s own preview reads his own settings',
    /const portalFinancing = localProject\s*\?\s*portalFinancingBlock\(settings\)\s*:\s*\(remote\.snapshot\?\.financing \?\? undefined\);/.test(cv));
  ok('…the button is drawn only with a buildable link, the preview note otherwise',
    /\{portalFinancing && portalFinancingUrl \? \(/.test(cv) && /\) : portalFinancing && localProject \? \(/.test(cv)
    && /Linking\.openURL\(portalFinancingUrl\)/.test(cv));
  ok('…and prints the snapshot\'s disclosure, not a hard-coded one', /\{portalFinancing\.disclosure\}/.test(cv)
    && !/Financing is provided by a third party/.test(cv));

  const snapSrc = read('utils/portalSnapshot.ts');
  const snap = code(snapSrc);
  ok('the portal snapshot declares `financing?: PortalFinancingBlock`', /financing\?: PortalFinancingBlock;/.test(snap));
  ok('…and every writer bakes it from the GC\'s settings', /financing: portalFinancingBlock\(settings\),/.test(snap));
}

// ════════════════════════════════════════════════════════════════════════════
// 5 · a re-used referral is brought to THIS invoice's amount
// ════════════════════════════════════════════════════════════════════════════
{
  ok('the refresh patch rounds cents and trims the lender',
    JSON.stringify(core.referralRefreshPatch({ amountCents: 4_000_000.4, partnerName: ' Acme ' })) === '{"amount_cents":4000000,"partner_name":"Acme"}');
  ok('…and never writes a negative or NaN amount',
    core.referralRefreshPatch({ amountCents: -5, partnerName: 'A' }).amount_cents === 0
    && core.referralRefreshPatch({ amountCents: Number.NaN, partnerName: 'A' }).amount_cents === 0);
  const refs = code(read('hooks/useFinancingReferrals.ts'));
  ok('ensureReferral no longer returns a re-used row untouched', !/if \(existing\) return existing\.id;/.test(refs));
  const reuse = (/if \(existing\) \{[\s\S]*?\n      \}\n/.exec(refs) ?? [''])[0];
  ok('…it UPDATEs the row with referralRefreshPatch(args) BEFORE returning its id',
    /\.from\('financing_referrals'\)\s*\.update\(\{ \.\.\.referralRefreshPatch\(args\), updated_at: [^}]+\}\)\s*\.eq\('id', existing\.id\);/.test(reuse)
    && reuse.indexOf('.update(') < reuse.lastIndexOf('return existing.id;'), reuse.slice(0, 400));
  ok('…and a failed refresh sends no link (\'\'), like a failed insert',
    /if \(refreshErr\) \{[\s\S]*?return '';\s*\}\s*return existing\.id;/.test(reuse));
  ok('the hook no longer exposes a "funded" count', !/funded:/.test(refs));
}

// ════════════════════════════════════════════════════════════════════════════
// 6 · never a dead end: the partner return URL is a page that exists
// ════════════════════════════════════════════════════════════════════════════
{
  const cb = code(read('supabase/functions/financing-callback/index.ts'));
  ok('financing-callback no longer defaults to the non-existent /financing/thanks',
    !/financing\/thanks/.test(cb) && /const THANKYOU_URL = Deno\.env\.get\("FINANCING_THANKYOU_URL"\) \|\| "https:\/\/mageid\.app";/.test(cb));
}

// ════════════════════════════════════════════════════════════════════════════
// 7 · create-payment-link: always the GC's connected account, never the platform
// ════════════════════════════════════════════════════════════════════════════
{
  const src = read('supabase/functions/create-payment-link/index.ts');
  const cpl = code(src);
  type Decision = { ok: boolean; accountId?: string; status?: number; code?: string; error?: string };
  const resolve = load<(own: string | null, asked?: string | null) => Decision>(
    [liftFunction(src, 'resolvePayoutAccount')], 'resolvePayoutAccount');
  const none = resolve(null, undefined) ?? ({} as Decision);
  ok('no connected account on the profile → 409 not_connected, nothing minted',
    none.ok === false && none.status === 409 && none.code === 'not_connected', JSON.stringify(none));
  ok('…with a sentence that says what to do', /finish Stripe setup in Settings → Payments/.test(none.error ?? ''));
  ok('…even when the body names an account', resolve(null, 'acct_1')?.ok === false && resolve('  ', 'acct_1')?.status === 409);
  const mis = resolve('acct_own', 'acct_other') ?? ({} as Decision);
  ok('a body account that is not the caller\'s own → 403', mis.ok === false && mis.status === 403, JSON.stringify(mis));
  ok('body left out → the PROFILE\'s account (the old platform-mode hole)', resolve('acct_own', undefined)?.accountId === 'acct_own');
  ok('body matches → that account', resolve('acct_own', 'acct_own')?.accountId === 'acct_own');
  ok('the handler refuses with the decision\'s status and code',
    /const decision = resolvePayoutAccount\(ownAccountId, body\.stripeAccountId\);\s*if \(!decision\.ok\) \{[\s\S]{0,300}return jsonResponse\(\{ success: false, code: decision\.code, error: decision\.error \}, decision\.status\);/.test(cpl));
  ok('the account check runs for EVERY call (no `if (body.stripeAccountId)` gate)', !/if \(body\.stripeAccountId\)/.test(cpl));
  ok('price, link and deactivation all go to the resolved account — never body.stripeAccountId',
    (cpl.match(/stripeFetch\([\s\S]*?\)\s*;/g) ?? []).length >= 3
    && !/stripeFetch\([^;]*body\.stripeAccountId/.test(cpl)
    && /\}, connectedAccountId\);/.test(cpl)
    && /stripeFetch\("\/payment_links", linkParams, connectedAccountId\)/.test(cpl)
    && /\{ active: false \}, connectedAccountId\)/.test(cpl));
  ok('the platform fee is no longer skipped when the body omits the account',
    !/body\.stripeAccountId\s*\?(?!\?)/.test(cpl) && !/body\.stripeAccountId &&/.test(cpl)
    && /const applicationFeeAmount = Math\.max\(0, Math\.round\(\(body\.amountCents \* feeBps\) \/ 10000\)\);/.test(cpl)
    && /if \(applicationFeeAmount > 0\) \{\s*linkParams\.application_fee_amount = applicationFeeAmount;/.test(cpl));
  ok('the account is resolved before anything is minted on Stripe',
    cpl.indexOf('resolvePayoutAccount(ownAccountId') > 0 && cpl.indexOf('resolvePayoutAccount(ownAccountId') < cpl.indexOf('stripeFetch("/prices"'));
  ok('no "(platform)" legacy mode is left', !/\(platform\)/.test(cpl));
}

// ════════════════════════════════════════════════════════════════════════════
// 8 · payouts + processing copy (no fee change)
// ════════════════════════════════════════════════════════════════════════════
{
  ok('the platform fee schedule is unchanged (0 / 30 / 50 / 40 bps)',
    JSON.stringify(fees.PLATFORM_FEE_BPS) === '{"free":0,"pro":30,"business":50,"enterprise":40}');
  ok('card processing is still 2.9% + 30¢', fees.STRIPE_CARD_PROCESSING.percent === 2.9 && fees.STRIPE_CARD_PROCESSING.fixedCents === 30);
  const p = fees.stripeProcessingCopy();
  ok('the processing copy states the ACH rate next to the card rate',
    p === 'cards 2.9% + 30¢; bank transfer (ACH) 0.8%, capped at $5', p);
  ok('payout copy: first payout about a week, ACH takes days to clear, never "1–2 business days"',
    /first payout usually takes about a week/.test(fees.PAYOUT_TIMING_COPY) && /take a few business days to clear/.test(fees.PAYOUT_TIMING_COPY)
    && !/1[–-]2 business days/.test(fees.PAYOUT_TIMING_COPY + fees.PAYOUT_TIMING_SHORT));

  const ps = code(read('app/payments-setup.tsx'));
  ok('Payments no longer says funds arrive in 1–2 business days', !/1[–-]2 business days/.test(ps));
  ok('…renders the payout timing from platformFees (NotConnected + Connected + fine print)',
    (ps.match(/PAYOUT_TIMING_(COPY|SHORT)/g) ?? []).length >= 4);
  ok('…and the processing fine print from stripeProcessingCopy()', /Stripe processing \(\{stripeProcessingCopy\(\)\}\)/.test(ps)
    && !/STRIPE_CARD_PROCESSING\.percent/.test(ps));
  ok('…does not promise bank pay unconditionally', !/One-tap card or bank pay on every invoice/.test(ps)
    && /bank transfer \(ACH\) once it is on in your Stripe account/.test(ps));
  ok('the financing card: explainer + honest toggle, no Wisetack, no "funded", no "estimates"',
    /\{FINANCING_EXPLAINER\}/.test(ps) && /\{FINANCING_TOGGLE_LABEL\}/.test(ps)
    && !/Wisetack/i.test(ps) && !/funded/.test(ps) && !/estimates & invoices/.test(ps) && !/paid in full upfront/.test(ps));
  ok('…the referral line comes from financingReferralSummary', /\{financingReferralSummary\(referralStats\)\}/.test(ps));
  ok('…and switching financing on without a lender name says why instead of saving a dead offer',
    /if \(enabled && !finPartner\.trim\(\)\) \{\s*showAlert\('Lender name needed'/.test(ps));
}

// ════════════════════════════════════════════════════════════════════════════
// 9 · plans page and the invoice email
// ════════════════════════════════════════════════════════════════════════════
{
  const pw = code(read('app/paywall.tsx'));
  ok('the plans page no longer names Wisetack', !/Wisetack/i.test(pw));
  ok('…lists client financing as bring-your-own-lender on every plan',
    /\{ label: 'Client financing \(bring your own lender\)', free: 'Yes', pro: 'Yes', business: 'Yes', enterprise: 'Yes' \}/.test(pw));
  const fin = code(read('utils/financing.ts'));
  ok('the invoice-email block renders the one disclosure (financingDisclosureText)',
    /escapeHtml\(financingDisclosureText\(cfg\.partnerName\)\)/.test(fin) && !/may receive compensation/.test(fin));
  ok('…and makes no claim about the lender\'s speed ("~2 min")', !/~2 min/.test(fin));
}

// Repo-wide: no surface a GC or homeowner reads claims MAGE ID is compensated.
{
  const files = ['utils/financing.ts', 'utils/financingCore.ts', 'app/payments-setup.tsx', 'app/client-view.tsx',
    'app/paywall.tsx', 'marketing/portal/index.html', 'utils/emailService.ts'];
  const hits = files.filter(f => /may receive compensation/i.test(code(read(f))));
  ok('no financing surface says MAGE ID "may receive compensation"', hits.length === 0, hits.join(', '));
  // Wave 6d M2 applied the fixq HANDOFF: the invoice's Wisetack card is gone.
  ok('app/invoice.tsx no longer names Wisetack (the "Wisetack-style partnership · early access" card is removed)',
    !/Wisetack/i.test(code(read('app/invoice.tsx'))));
}

// ════════════════════════════════════════════════════════════════════════════
// 10 · wave 6d M2 — the invoice's financing line, the early-access cards
//      (contract D8), the welcome / invoice email, instant-bid monthly line
// ════════════════════════════════════════════════════════════════════════════
{
  const inv = code(read('app/invoice.tsx'));
  // The executed copy.
  const on = core.invoiceFinancingOnLine('  Acme Home Loans ');
  ok('invoiceFinancingOnLine names the GC\'s own lender and says MAGE ID is not one and is not paid',
    on === 'Financing is on: invoice emails you send and your client portal offer "Check financing options" from Acme Home Loans. '
      + 'MAGE ID is not a lender and is not paid for referrals.', on);
  ok('INVOICE_FINANCING_SETUP_LINE is bring-your-own-lender, pointing at Payments',
    core.INVOICE_FINANCING_SETUP_LINE === 'Want to offer your client monthly payments? Bring your own lender — set it up in Payments →');
  ok('…neither names a partner, a rate or a date',
    !/Wisetack|%|Q3|20\d\d/i.test(on + core.INVOICE_FINANCING_SETUP_LINE));

  // The wiring: the Wisetack card and its icon are gone; the line replaces it.
  ok('the invoice-financing-cta card and its revenue.financing.wisetack event are removed',
    !/invoice-financing-cta/.test(inv) && !/revenue\.financing\.wisetack/.test(inv));
  ok('…HandCoins (used only by that card) is no longer imported', !/HandCoins/.test(inv));
  ok('…financing on → the invoice-financing-on line renders invoiceFinancingOnLine(partner)',
    /isFinancingAvailable\(settings\) \?\s*\(\s*<Text style=\{styles\.reminderHint\} testID="invoice-financing-on">\s*\{invoiceFinancingOnLine\(settings\?\.financing\?\.partnerName \?\? ''\)\}/.test(inv));
  ok('…financing off → a link to /payments-setup with INVOICE_FINANCING_SETUP_LINE',
    /<TouchableOpacity onPress=\{\(\) => router\.push\('\/payments-setup'\)\} accessibilityRole="link" testID="invoice-financing-setup">\s*<Text style=\{styles\.reminderHint\}>\{INVOICE_FINANCING_SETUP_LINE\}<\/Text>/.test(inv));
  ok('…and a sample job shows neither', /\{!isSampleJob && \(isFinancingAvailable\(settings\) \?/.test(inv));

  // Contract D8: the early-access cards on the invoice and prequal-manager.
  const FOOTER = 'Not available yet — tap to be told when it is';
  const D8: [string, string, string, string, string][] = [
    ['app/invoice.tsx', 'invoice-factoring-cta', 'revenue.factoring.altline', 'Advances on unpaid invoices',
      'We are looking at a factoring partner that could advance part of an unpaid invoice. No partner is signed yet, so there are no rates or timelines to show.'],
    ['app/prequal-manager.tsx', 'coi-requote-cta', 'revenue.insurance.coi_requote', 'Renewal quotes for expiring sub insurance',
      "We are working on requesting renewal quotes for a sub's expiring coverage, pre-filled from the COI on file. No insurer or broker is signed up yet."],
  ];
  const FORBIDDEN = ['LOI', 'Q3 2026', '24 hours', '60 seconds', 'Coterie', 'Hiscox', 'Next Insurance', '3 brokers', '%'];
  for (const [file, testID, eventKey, headline, body] of D8) {
    const src = read(file);
    const at = src.indexOf(`testID="${testID}"`);
    const from = at < 0 ? -1 : src.lastIndexOf('<RevenueEarlyAccessCard', at);
    const to = at < 0 ? -1 : src.indexOf('/>', at);
    const span = from >= 0 && to > at ? src.slice(from, to + 2) : '';
    ok(`${file} ${testID}: the card is still there (eventKey ${eventKey}, interest capture kept)`,
      !!span && span.includes(`eventKey="${eventKey}"`), span ? '' : 'card not found');
    ok(`${file} ${testID}: D8's exact headline, body and footer`,
      span.includes(`headline="${headline}"`) && span.includes(`body="${body}"`) && span.includes(`footer="${FOOTER}"`), span);
    const bad = FORBIDDEN.filter(w => span.includes(w)).concat(/today/i.test(span) ? ['today'] : []);
    ok(`${file} ${testID}: no rate, percentage, 'today', speed, partner, count, LOI or date`, !!span && bad.length === 0, bad.join(', '));
  }

  // The welcome email and the invoice email (utils/emailService.ts).
  const em = read('utils/emailService.ts');
  const emc = code(em);
  ok('emailService: no "1–2 business days" payout promise', !/1[–-]2 business days/.test(em));
  ok('…the welcome email\'s "Get paid in-app" line renders PAYOUT_TIMING_SHORT from platformFees',
    /import \{ PAYOUT_TIMING_SHORT \} from '@\/utils\/platformFees';/.test(emc)
    && /title: 'Get paid in-app', body: `One-tap Pay button on every invoice\. \$\{PAYOUT_TIMING_SHORT\}\.` \}/.test(emc));
  ok('…the Pay-link footer no longer promises bank payment (it exists only when ACH is on in Stripe)',
    !/card &amp; bank payment/.test(em) && /Powered by Stripe · secure online payment/.test(emc));

  // Instant-bid proposals: a monthly figure carries its APR, term and lender.
  const ib = read('utils/instantBid.ts');
  const tfl = liftFunction(ib, 'tierFinancingLine');
  ok('instantBid tierFinancingLine states the APR, the term and financingDisclosureText(…)',
    /\$\{cfg\.exampleApr\}% APR/.test(tfl) && /\$\{cfg\.exampleTermMonths\} months/.test(tfl) && /financingDisclosureText\(/.test(tfl)
    && /import \{ financingDisclosureText \} from '@\/utils\/financingCore';/.test(ib));
  ok('…and never a bare "As low as $"', !/As low as \$/.test(code(ib)));
  // Executed: lifted with the real illustrativeMonthly (lifted from utils/financing.ts).
  const im = liftFunction(read('utils/financing.ts'), 'illustrativeMonthly');
  let line: string | null = null, off: string | null = 'unset', noTerms: string | null = 'unset';
  try {
    const js = new (globalThis as unknown as { Bun: { Transpiler: new (o: { loader: 'ts' }) => { transformSync: (c: string) => string } } }).Bun
      .Transpiler({ loader: 'ts' }).transformSync(`${im}\n${tfl}`);
    const run = new Function('financingDisclosureText', `${js}\nreturn tierFinancingLine;`)(core.financingDisclosureText) as
      (a: number, c?: Record<string, unknown>) => string | null;
    const cfg = { enabled: true, partnerName: 'Acme Home Loans', prequalBaseUrl: 'https://acme.example/p', exampleApr: 9.99, exampleTermMonths: 60, updatedAt: '' };
    line = run(25000, cfg);
    off = run(25000, { ...cfg, enabled: false });
    noTerms = run(25000, { ...cfg, exampleApr: undefined });
  } catch (e) { line = `threw: ${(e as Error).message}`; }
  ok('…executed: "Est. $531/mo at 9.99% APR for 60 months (example)." + the lender disclosure',
    line === `Est. $531/mo at 9.99% APR for 60 months (example). ${core.financingDisclosureText('Acme Home Loans')}`, String(line));
  ok('…executed: no line when financing is off or has no example terms', off === null && noTerms === null, `${off} / ${noTerms}`);
}

console.log(`\n${fail === 0 ? '✓' : '✗'} validate-financing-honesty: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
