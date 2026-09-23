// validate-w5-join-server-events.ts — wave 5, join lane w5-join-server.
//
// CONTRACT 8: three sub-side events reach the GC only through AFTER triggers
// calling public.fire_notify, and notify sends them:
//   bid_invite_received  trg_notify_bid_invite_received  (bid_package_invites)
//   lien_waiver_signed   trg_notify_lien_waiver_signed   (lien_waivers)
//   prequal_submitted    trg_notify_prequal_submitted    (prequal_packets)
// For each one this checks that it is SERVICE-ONLY in notify, has a dispatch
// case, is ROUTED to a real screen with params that screen reads, has a MUTE
// ROW in app/notifications-settings.tsx (prefKey = the event name), a
// daily-digest label and a preferences-page key, and that its trigger exists
// in a supabase/migrations file as an AFTER trigger raising that event name.
// The wording block (wave5NotifyText) is executed: money exact to the cent,
// sub-typed names flattened and clipped, nothing printed that was not read.
//
// Also pinned here (same lane): bid_invite_sent answers ok:false + a reason
// when the email did not go; sub_invoice_submitted names the sub from the
// trusted link (#149); project-invite honours the master override through
// public.is_master_account (#1); config.toml pins shared-photos-sign false
// (CONTRACT 11); the digest preview / Email row name the sign-in address (#130).
//
// Run: bun run scripts/validate-w5-join-server-events.ts

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const NOTIFY = process.env.NOTIFY_PATH ? readFileSync(process.env.NOTIFY_PATH, 'utf8') : read('supabase/functions/notify/index.ts');
const SETTINGS = process.env.SETTINGS_PATH ? readFileSync(process.env.SETTINGS_PATH, 'utf8') : read('app/notifications-settings.tsx');
const INVITE = process.env.INVITE_PATH ? readFileSync(process.env.INVITE_PATH, 'utf8') : read('supabase/functions/project-invite/index.ts');
const DIGEST = process.env.DIGEST_PATH ? readFileSync(process.env.DIGEST_PATH, 'utf8') : read('supabase/functions/daily-digest/index.ts');
const CONFIG = read('supabase/config.toml');

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

type TranspilerCtor = new (o: { loader: string }) => { transformSync(s: string): string };
const Transpiler = (globalThis as unknown as { Bun: { Transpiler: TranspilerCtor } }).Bun.Transpiler;
function block(src: string, marker: string): string {
  const start = src.indexOf(`// >>> ${marker}`);
  const end = src.indexOf(`// <<< ${marker}`);
  ok(`notify carries the ${marker} marker block`, start > -1 && end > start);
  return start > -1 && end > start ? src.slice(start, end) : '';
}

const EVENTS: { event: string; trigger: string; table: string; column: string }[] = [
  { event: 'bid_invite_received', trigger: 'trg_notify_bid_invite_received', table: 'bid_package_invites', column: 'responded_at' },
  { event: 'lien_waiver_signed', trigger: 'trg_notify_lien_waiver_signed', table: 'lien_waivers', column: 'signed_at' },
  { event: 'prequal_submitted', trigger: 'trg_notify_prequal_submitted', table: 'prequal_packets', column: 'status' },
];

const svc = /SERVICE_ONLY_EVENTS: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\)/.exec(NOTIFY);
const serviceOnly = new Set((svc?.[1] ?? '').match(/'[a-z_]+'/g)?.map((x) => x.slice(1, -1)) ?? []);
ok('notify refuses a SERVICE_ONLY event from any non-service caller', /if \(!isService && SERVICE_ONLY_EVENTS\.has\(event\)\) \{\s*return \{ ok: false, reason: 'service_only_event', event, httpStatus: 403 \};/.test(NOTIFY));

const migDir = join(ROOT, 'supabase/migrations');
const migs = readdirSync(migDir).filter((f) => f.endsWith('.sql')).map((f) => ({ f, sql: readFileSync(join(migDir, f), 'utf8') }));
let eventKeys: Set<string> = new Set();
try {
  const j = JSON.parse(read('marketing/email-event-keys.json')) as { groups: { items: { key: string }[] }[] };
  eventKeys = new Set(j.groups.flatMap((g) => g.items.map((i) => i.key)));
} catch { /* reported per event below */ }

async function main() {
  const ROUTES = '../supabase/functions/notify/routes.ts';
  const routes = (await import(ROUTES)) as {
    notificationRoute: (e: string, d: Record<string, unknown>) => { pathname: string; params: Record<string, string> } | null;
  };
  const sample: Record<string, unknown> = {
    user_id: 'u-1', project_id: '11111111-2222-3333-4444-555555555555', package_id: 'pkg-1', invite_id: 'inv-1',
    bid_id: 'bid-1', waiver_id: 'lw-1', packet_id: 'pq-1', sub_name: 'Rivera Drywall',
  };

  for (const { event, trigger, table, column } of EVENTS) {
    console.log(`\n${event}`);
    ok('is service-only in notify', serviceOnly.has(event));
    ok('has a dispatch case in notify', NOTIFY.includes(`case '${event}':`));
    ok('is resolved from its source row (WAVE5_SOURCE_EVENTS)', new RegExp(`WAVE5_SOURCE_EVENTS: ReadonlySet<string> = new Set\\(\\[[^\\]]*'${event}'`).test(NOTIFY));

    const r = routes.notificationRoute(event, sample);
    ok('is routed to a screen', !!r, JSON.stringify(r));
    if (r) {
      const seg = r.pathname.replace(/^\//, '');
      const file = [`app/${seg}.tsx`, `app/${seg}/index.tsx`].find((c) => existsSync(join(ROOT, c)));
      ok(`${r.pathname} is a real screen`, !!file);
      const src = file ? read(file) : '';
      const keys = new Set<string>();
      for (const m of src.matchAll(/useLocalSearchParams<\{([\s\S]*?)\}>/g)) for (const k of m[1].matchAll(/([A-Za-z_][A-Za-z0-9_]*)\??\s*:/g)) keys.add(k[1]);
      const unread = Object.keys(r.params).filter((k) => !keys.has(k));
      ok(`${r.pathname} reads every param the route sends`, unread.length === 0, `unread: ${unread.join(',')}`);
    }

    ok('has a mute row (prefKey = event name) in notifications settings',
      new RegExp(`\\n    key: '${event}',\\n    label: '[^']+',\\n    description: '[^\\n]+',\\n    icon: [^\\n]+,\\n    group: 'sub',`).test(SETTINGS)
        && new RegExp(`\\| '${event}'`).test(SETTINGS));
    ok('has a daily-digest label', new RegExp(`\\n  ${event}:\\s+\\{ label: '`).test(DIGEST));
    ok('is on the email preferences page (email-event-keys.json)', eventKeys.has(event));

    const trig = migs.find(({ sql }) => new RegExp(`create trigger ${trigger}\\s+after update of ${column} on public\\.${table}\\s+for each row`, 'i').test(sql));
    ok(`${trigger} is an AFTER UPDATE OF ${column} trigger on ${table} in supabase/migrations`, !!trig);
    ok(`…and a trigger function there raises '${event}' through fire_notify`,
      !!trig && new RegExp(`perform public\\.fire_notify\\(\\s*'${event}',\\s*'${table}'`).test(trig.sql));
  }

  console.log('\nthe source row decides, not the payload');
  const loader = NOTIFY.slice(NOTIFY.indexOf('async function loadWave5Source('), NOTIFY.indexOf('// ─── Preference check'));
  ok('the loader exists', loader.length > 200);
  ok('the recipient is payload.user_id only when every source row belongs to it',
    /invite\.user_id !== ownerId \|\| pkg\.user_id !== ownerId \|\| invite\.package_id !== pkg\.id/.test(loader)
      && /!w \|\| w\.user_id !== ownerId \|\| !w\.signed_at/.test(loader)
      && /!pk \|\| pk\.user_id !== ownerId \|\| pk\.status !== 'submitted'/.test(loader));
  ok('the bid is the INVITE ROW\'s bid on this package, never a payload id', /const bidId = uuidOrNull\(invite\.bid_id\)/.test(loader) && /package_id=eq\.\$\{pkg\.id\}/.test(loader) && !/payload\.bid_id/.test(loader));
  ok('the GC\'s own paper waiver is not news to him', /w\.sub_signature\.role === 'gc'/.test(loader));
  ok('the prequal sub name comes from the GC\'s own roster row', /subcontractors\?id=eq\.\$\{pk\.subcontractor_id\}&user_id=eq\.\$\{ownerId\}/.test(loader));
  ok('the dispatch overrides gcUserId / projectId from the loaded row', /gcUserId = src\.ownerId;\s*projectId = src\.projectId;/.test(NOTIFY));
  const branch = NOTIFY.slice(NOTIFY.indexOf("case 'bid_invite_received':\n    case 'lien_waiver_signed':"), NOTIFY.indexOf("case 'nearby_rfp_posted': {"));
  ok('the dispatch branch exists', branch.length > 100);
  ok('every stat row is escaped (sub-typed names)', /emailStatRow\(k, escapeHtml\(v\)/.test(branch));
  ok('mail TO the GC about his sub carries no "Sent by <himself>"', /sender: null/.test(branch));
  ok('the email button goes through the shared route table', /href: appLink\(event, /.test(branch));
  ok('the stored payload gets the server-read facts (inbox / digest read them)', /Object\.assign\(payload, wave5\.facts\)/.test(branch));

  console.log('\nthe wording (wave5NotifyText, executed)');
  const src = `${block(NOTIFY, 'notify-format')}\n${block(NOTIFY, 'wave5-notify-text')}`;
  type Text = { prefKey: string; pushTitle: string; pushBody: string; emailSubject: string; title: string; subtitle: string; rows: [string, string, boolean?][]; ctaLabel: string } | null;
  type TextFn = (e: string, f: Record<string, unknown>, p: string | null) => Text;
  const load = (): TextFn | null => {
    try {
      const js = new Transpiler({ loader: 'ts' }).transformSync(src.replace(/^export /gm, ''));
      return new Function(`${js}\nreturn wave5NotifyText;`)() as TextFn;
    } catch (e) {
      ok('the wave5 block evaluates', false, String(e));
      return null;
    }
  };
  const T = load();
  if (T) {
    const bid = T('bid_invite_received', { package_name: 'Drywall', vendor_name: 'Rivera Drywall LLC', amount: 48250 }, 'Henderson');
    ok('bid: prefKey is the event name', bid?.prefKey === 'bid_invite_received');
    ok('bid: the amount is exact with both decimals', bid?.pushBody === 'Rivera Drywall LLC bid $48,250.00 on Drywall (Henderson).', bid?.pushBody);
    ok('bid: cents survive (numeric from PostgREST as a string too)', T('bid_invite_received', { package_name: 'D', vendor_name: 'R', amount: '1234.5' }, null)?.title === 'R bid $1,234.50');
    const noAmt = T('bid_invite_received', { package_name: 'Drywall', sub_name: 'Rivera' }, null);
    ok('bid: no amount read → no number invented, falls back to the invite\'s sub name', noAmt?.title === 'Rivera filed a bid' && !/\$/.test(noAmt?.pushBody ?? ''), JSON.stringify(noAmt));
    ok('bid: no project → the copy names none', noAmt?.emailSubject === 'Rivera filed a bid · Drywall' && !/\(/.test(noAmt.pushBody), noAmt?.emailSubject);
    const nasty = T('bid_invite_received', { package_name: 'Drywall', vendor_name: 'Evil\nCo <b>' + 'x'.repeat(200), amount: 1 }, null);
    ok('bid: a sub-typed name is flattened to one line and clipped', !!nasty && !/\n/.test(nasty.pushBody) && nasty.rows.every(([, v]) => v.length <= 80), nasty?.rows.map((r) => r[1].length).join(','));
    const lw = T('lien_waiver_signed', { signer_name: 'Ana Rivera', sub_company: 'Rivera Drywall', waiver_type: 'conditional_progress', through_date: '2026-09-15', paid_amount: 18400 }, 'Henderson');
    ok('waiver: names the sub, the type and the exact amount', lw?.pushBody === 'Rivera Drywall signed their conditional progress lien waiver for $18,400.00.', lw?.pushBody);
    ok('waiver: the through day is read as that calendar day', lw?.rows.some(([k, v]) => k === 'Through' && v === 'Sep 15, 2026') === true, JSON.stringify(lw?.rows));
    ok('waiver: the signer is shown when it differs from the company', lw?.rows.some(([k, v]) => k === 'Signed by' && v === 'Ana Rivera') === true);
    const lwBare = T('lien_waiver_signed', { through_date: 'yesterday', waiver_type: 'DROP TABLE' }, null);
    ok('waiver: an unreadable day / type prints nothing guessed', !!lwBare && !lwBare.rows.some(([k]) => k === 'Through' || k === 'Waiver') && lwBare.title === 'A subcontractor signed their lien waiver', JSON.stringify(lwBare));
    const pq = T('prequal_submitted', { sub_name: null }, null);
    ok('prequal: a sub with no roster name is "A subcontractor"', pq?.title === 'A subcontractor submitted their prequalification packet' && pq.prefKey === 'prequal_submitted');
    ok('an event this block does not own → null', T('bid_invite_sent', {}, null) === null);
  }

  console.log('\nbid_invite_sent says when the email did not go (CONTRACT 8)');
  const sent = NOTIFY.slice(NOTIFY.indexOf("case 'bid_invite_sent': {"), NOTIFY.indexOf("case 'portal_reply': {"));
  ok('no recipient / no link → ok:false, reason no_recipient', /email_status: 'skipped_no_email', payload,\s*\}\)\.catch\(\(\) => \{\}\);[\s\S]{0,200}return \{ ok: false, reason: 'no_recipient', event \};/.test(sent));
  ok('suppressed / failed → ok:false with the reason', /if \(!r\.ok\) return \{ ok: false, reason: r\.suppressed \? 'suppressed_unsubscribed' : 'email_send_failed', event \};/.test(sent));

  console.log('\n#149 sub_invoice_submitted opens that sub');
  ok('the sub id comes from the trusted link row, on this GC\'s job', /const linkSubId = strOrNull\(trustedSubLink\?\.subcontractor_id\);\s*if \(linkSubId && trustedSubLink\?\.user_id === gcUserId && projectId && trustedSubLink\?\.project_id === projectId\) \{\s*payload\.sub_id = linkSubId;/.test(NOTIFY));
  ok('the email button carries it', /appLink\('sub_invoice_submitted', \{ project_id: projectId, sub_id: payload\.sub_id \}\)/.test(NOTIFY));

  console.log('\n#1 project-invite honours the master override');
  const tierFn = INVITE.slice(INVITE.indexOf('async function callerTier('), INVITE.indexOf('async function callerTier(') + 600);
  ok('callerTier asks public.is_master_account before the subscriptions row',
    /if \(await isMasterAccount\(userId\)\) return "business";/.test(tierFn) && tierFn.indexOf('isMasterAccount') < tierFn.indexOf('subscriptions?'));
  ok('isMasterAccount calls the RPC with p_user_id (no private email list here)',
    /rest\("rpc\/is_master_account", \{\s*method: "POST",\s*body: JSON\.stringify\(\{ p_user_id: userId \}\)/.test(INVITE) && !/new Set<string>\(\[/.test(INVITE) && !/['"][\w.+-]+@[\w-]+(\.[\w-]+)*\.[a-z]{2,}['"]/i.test(INVITE));

  console.log('\nconfig.toml');
  ok('[functions.shared-photos-sign] verify_jwt = false (CONTRACT 11)', /\[functions\.shared-photos-sign\]\s*\nverify_jwt = false/.test(CONFIG));

  console.log('\n#130 the digest names the sign-in address');
  ok('the preview passes the sign-in email to morningPreviewCopy', /morningPreviewCopy\(data as \{ sent\?: unknown; reason\?: unknown \} \| null, user\?\.email \?\? null\)/.test(SETTINGS));
  ok('the Email row shows digestRecipientLine(user?.email)', /\{digestRecipientLine\(user\?\.email\)\}/.test(SETTINGS));

  console.log('\ndaily-digest cards name who bid / signed / submitted (CONTRACT 8 facts)');
  {
    const hs = DIGEST.indexOf('/** A sub-typed name as one clipped line');
    const he = DIGEST.indexOf('function groupEvents(');
    ok('the digest carries the oneLine / fmtMoneyCents / subBidLine helpers', hs > -1 && he > hs);
    type DigestFns = { oneLine: (v: unknown) => string; fmtMoneyCents: (v: unknown) => string | null; subBidLine: (p: Record<string, unknown> | null) => string };
    let fns: DigestFns | null = null;
    try {
      const js = new Transpiler({ loader: 'ts' }).transformSync(DIGEST.slice(hs, he)).replace(/\bexport\s+/g, '');
      fns = new Function(`${js}\nreturn { oneLine, fmtMoneyCents, subBidLine };`)() as DigestFns;
    } catch (e) { ok('the digest helpers transpile', false, String(e)); }
    if (fns) {
      ok('a bid prints exact to the cent', fns.subBidLine({ vendor_name: 'Acme Framing', amount: 48250.5 }) === 'Acme Framing bid $48,250.50', fns.subBidLine({ vendor_name: 'Acme Framing', amount: 48250.5 }));
      ok('a string amount is read too; junk is null', fns.fmtMoneyCents('1234.5') === '$1,234.50' && fns.fmtMoneyCents('abc') === null && fns.fmtMoneyCents('') === null);
      ok('falls back to the invite\'s sub_name, then "A sub"', fns.subBidLine({ sub_name: 'Bob\'s Drywall', amount: 12 }) === "Bob's Drywall bid $12.00" && fns.subBidLine({ amount: 1 }) === 'A sub bid $1.00');
      ok('no amount read → no guessed $0', fns.subBidLine({ vendor_name: 'Acme', amount: null }) === 'Acme filed a bid' && fns.subBidLine({ vendor_name: 'Acme' }) === 'Acme filed a bid');
      ok('a sub-typed name is flattened to one line and clipped', fns.oneLine('  Acme\n\n Framing  ') === 'Acme Framing' && fns.oneLine('x'.repeat(200)).length === 80);
    }
    ok('bid_invite_received card uses subBidLine', /g\.key === 'bid_invite_received' \? subBidLine\(g\.latestPayload\)/.test(DIGEST));
    ok('lien_waiver_signed card names sub_company, then signer_name', /g\.key === 'lien_waiver_signed'\s+\? `\$\{oneLine\(g\.latestPayload\?\.sub_company\) \|\| oneLine\(g\.latestPayload\?\.signer_name\) \|\| 'A sub'\} signed/.test(DIGEST));
    ok('prequal_submitted card names sub_name', /g\.key === 'prequal_submitted'\s+\? `\$\{oneLine\(g\.latestPayload\?\.sub_name\) \|\| 'A sub'\} submitted/.test(DIGEST));
    ok('the card line is still escaped', /\$\{escapeHtml\(detail \|\| \(projectName \|\| 'Activity logged'\)\)\}/.test(DIGEST));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
