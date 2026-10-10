// scripts/validate-delivery-supplier-link.ts — the Supplier Link (lane
// DELIVERIES-2, Deliveries phase 2): a link a contractor hands a supplier, with
// no account, to give a delivery date and a tracking number.
//
// WHAT THIS HOLDS
//   A. The pure rules (utils/deliveryLink/core.ts), by running them: who may see
//      the section, exactly what the link shows, how an answer typed by a
//      stranger is read, and what "Use This Date" writes.
//   B. The lane's lines, by reading every file of it:
//        - the flag is read in ONE file;
//        - the app sends nothing, calls no server function, opens no URL, moves
//          no task, and touches ONE table (never public.deliveries);
//        - nothing happens by itself: no effect in the section, and the one
//          write of a delivery is inside the handler of Use This Date;
//        - the words never call an answer confirmed or say a delivery "will"
//          arrive;
//        - the no-account page writes every server value as text, calls only
//          the two functions, keeps no storage, loads no analytics, and carries
//          the Notice To Recipients word for word;
//        - the migration's answer function writes one table and calls nothing.
//   C. Planted mutations: each line in B is broken once, in memory, and the
//      rule that holds it must go red. A rule nobody has watched fail is not
//      known to work.
//
// Run: bun run scripts/validate-delivery-supplier-link.ts
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAX_REPLIES, SHOWN_KEYS, SUPPLIER_LINK_BASE, buildShown, linkMessage, readLinkRow, replyDateDiffers, replyDatePatch,
  replyIsNew, supplierLinkAllowedWith, supplierLinkUrl,
} from '../utils/deliveryLink/core';
import { RECIPIENT_NOTICE_PARTS } from '../utils/recipientNotice';

const ROOT = join(import.meta.dir, '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) passed++; else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

// ═══ A. The pure rules ══════════════════════════════════════════════════════
// The owner list is private to utils/owner.ts; the support address is on it and is not a person's.
const OWNER = 'support@mageid.app';
ok('flag off: a contractor who is not the owner account is not allowed', supplierLinkAllowedWith(false, 'someone@builder.test') === false);
ok('flag off: a signed-out person is not allowed', supplierLinkAllowedWith(false, null) === false && supplierLinkAllowedWith(false, '') === false);
ok('flag off: the owner account is allowed (owner preview)', !!OWNER && supplierLinkAllowedWith(false, OWNER) === true);
ok('flag on: everyone is allowed', supplierLinkAllowedWith(true, 'someone@builder.test') === true);

const TOKEN = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
ok('the link is the page plus the token and nothing else', supplierLinkUrl(TOKEN) === `${SUPPLIER_LINK_BASE}?t=${TOKEN}` && SUPPLIER_LINK_BASE === 'https://mageid.app/delivery/');
ok('anything that is not a token gives no link', supplierLinkUrl('') === '' && supplierLinkUrl('abc') === '' && supplierLinkUrl(`${TOKEN}&x=1`) === '' && supplierLinkUrl(null) === '');

const DELIVERY = {
  id: 'd1', projectId: 'p1', description: '  14   Windows ', supplier: 'Northside Glass', expectedDate: '2026-11-12', status: 'scheduled' as const,
  poNumber: 'PO-4471', notes: 'Client Mrs Alvarez, 14 Alder Street, $48,300 order', location: 'Rear dock', createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z',
};
const shown = buildShown({ delivery: DELIVERY, company: ' Example  Builders ', neededBy: '2026-11-13', showNeededBy: true });
ok('what the link shows is the four listed keys and no other', Object.keys(shown).every((k) => (SHOWN_KEYS as readonly string[]).includes(k)) && Object.keys(shown).length === 4, Object.keys(shown).join(','));
ok('what the link shows is cleaned of stray spaces', shown.description === '14 Windows' && shown.company === 'Example Builders');
ok('nothing else of the delivery reaches the link: no PO number, no note, no client, no address, no price, no place', !/PO-4471|Alvarez|Alder|48,300|Rear dock|p1|d1/.test(JSON.stringify(shown)), JSON.stringify(shown));
ok('with the switch off, Needed on Site By is not in the link', !('neededBy' in buildShown({ delivery: DELIVERY, company: 'X', neededBy: '2026-11-13', showNeededBy: false })));
ok('with no needed-by date, none is invented', !('neededBy' in buildShown({ delivery: DELIVERY, company: 'X', neededBy: '', showNeededBy: true })) && !('neededBy' in buildShown({ delivery: DELIVERY, company: 'X', neededBy: 'soon', showNeededBy: true })));
ok('MAGE ID is never the one asking: the old blank-name fallback is left blank', buildShown({ delivery: DELIVERY, company: 'MAGE ID', neededBy: '', showNeededBy: true }).company === '' && buildShown({ delivery: DELIVERY, company: null, neededBy: '', showNeededBy: true }).company === '');
ok('what the link shows is capped', buildShown({ delivery: { description: 'x'.repeat(500), supplier: 'y'.repeat(500) }, company: 'z'.repeat(500), neededBy: '', showNeededBy: true }).description.length === 200
  && JSON.stringify(buildShown({ delivery: { description: 'x'.repeat(500), supplier: 'y'.repeat(500) }, company: 'z'.repeat(500), neededBy: '2026-11-13', showNeededBy: true })).length < 2000);

const ROW = {
  delivery_id: 'd1', token: TOKEN, shown: { company: 'Example Builders', description: '14 Windows', supplier: 'Northside Glass', neededBy: '2026-11-13', price: '$48,300' },
  made_at: '2026-10-10T14:00:00Z', reply_count: 1, reply_seen_at: null,
  reply: { date: '2026-12-01', window: '7 to 11 AM', tracking: '1Z 999 AA1 01 2345 6784', carrier: 'UPS Freight', name: 'Dana at Northside', note: 'Two pallets', at: '2026-10-11T09:30:00Z' },
};
const link = readLinkRow(ROW);
ok('a link row is read: the token, what it shows and the answer', !!link && link.token === TOKEN && link.shown.neededBy === '2026-11-13' && link.reply?.date === '2026-12-01' && link.reply?.tracking === '1Z 999 AA1 01 2345 6784' && link.replyCount === 1);
ok('a key the app did not put in what the link shows is dropped on read', !!link && !('price' in (link.shown as unknown as Record<string, unknown>)));
ok('a row with no real token is not a link', readLinkRow({ ...ROW, token: 'nope' }) === null && readLinkRow(null) === null && readLinkRow({ ...ROW, delivery_id: '' }) === null);
ok('an answer with no name, or with neither a date nor a tracking number, is not an answer', readLinkRow({ ...ROW, reply: { ...ROW.reply, name: ' ' } })?.reply === null
  && readLinkRow({ ...ROW, reply: { name: 'Dana', at: '2026-10-11T09:30:00Z', note: 'soon' } })?.reply === null && readLinkRow({ ...ROW, reply: [1, 2] })?.reply === null && readLinkRow({ ...ROW, reply: 'x' })?.reply === null);
const hostile = readLinkRow({ ...ROW, reply: { ...ROW.reply, tracking: '<img src=x onerror=alert(1)>', note: 'a\n\n b\t c', name: 'N'.repeat(200) } });
ok('a tracking number that is not letters, digits, spaces and dashes is never drawn', hostile?.reply?.tracking === '');
ok('an answer is cleaned and capped on read', hostile?.reply?.note === 'a b c' && hostile?.reply?.name.length === 80);
ok('the answer count is kept inside the table\'s own range', readLinkRow({ ...ROW, reply_count: 9999 })?.replyCount === MAX_REPLIES && readLinkRow({ ...ROW, reply_count: -3 })?.replyCount === 0 && readLinkRow({ ...ROW, reply_count: 'x' })?.replyCount === 0);

ok('an answer nobody has looked at is new; one marked seen is not; no answer is not', replyIsNew(link) === true && replyIsNew({ ...link!, replySeenAt: '2026-10-11T10:00:00Z' }) === false && replyIsNew({ ...link!, reply: null }) === false && replyIsNew(null) === false);
ok('the answer\'s date is compared with the supplier date as it stands', replyDateDiffers(DELIVERY, link!.reply) === true && replyDateDiffers({ expectedDate: '2026-12-01' }, link!.reply) === false && replyDateDiffers(DELIVERY, { date: '' }) === false && replyDateDiffers(DELIVERY, null) === false);

const NOW = new Date('2026-10-11T15:00:00.000Z');
const noteFor = (name: string) => `Through the supplier link, typed by ${name}`;
const patch = replyDatePatch(DELIVERY, link!.reply, { now: NOW, by: 'u1', byName: 'Omir', noteFor });
const entry = patch?.dateHistory?.[patch.dateHistory.length - 1];
ok('Use This Date sets the supplier date to the answer\'s date', patch?.expectedDate === '2026-12-01');
ok('Use This Date keeps the record: the supplier\'s word, how it came, the name typed, who pressed it and when', !!entry && entry.source === 'supplier_said' && entry.note === 'Through the supplier link, typed by Dana at Northside'
  && entry.previousDate === '2026-11-12' && entry.by === 'u1' && entry.byName === 'Omir' && entry.at === NOW.toISOString(), JSON.stringify(entry));
ok('Use This Date writes the three date fields and nothing else: no status, no task, no order', !!patch && Object.keys(patch).sort().join(',') === 'dateHistory,expectedDate,promisedDate', patch ? Object.keys(patch).join(',') : 'null');
ok('an answer with no date gives nothing to use', replyDatePatch(DELIVERY, { date: '', name: 'Dana' }, { now: NOW, by: 'u1', byName: 'Omir', noteFor }) === null && replyDatePatch(DELIVERY, null, { now: NOW, by: 'u1', byName: 'Omir', noteFor }) === null);
const frozen = Object.freeze({ ...DELIVERY, dateHistory: Object.freeze([]) as never });
let threw = false;
try { replyDatePatch(frozen, link!.reply, { now: NOW, by: 'u1', byName: 'Omir', noteFor }); } catch { threw = true; }
ok('Use This Date does not change the delivery it is handed', !threw && frozen.expectedDate === '2026-11-12');

const msg = linkMessage({ ask: (w) => `Please give the date for: ${w}`, sign: (c) => `Thank you, ${c}` }, link!.shown, supplierLinkUrl(TOKEN));
ok('the message a person can paste holds the ask, the link and the company, and no other fact of the job', msg.split('\n').length === 3 && msg.includes(supplierLinkUrl(TOKEN)) && msg.includes('14 Windows') && !/2026|Alvarez|\$/.test(msg), msg);
ok('with no company name the message is not signed for one', linkMessage({ ask: (w) => w, sign: (c) => `Thank you, ${c}` }, { description: 'x', company: '' }, 'u').split('\n').length === 2);

// ═══ B. The lane's lines ════════════════════════════════════════════════════
type Files = Map<string, string>;
const LANE_CODE = [
  ...readdirSync(join(ROOT, 'utils/deliveryLink')).map((f) => `utils/deliveryLink/${f}`),
  ...readdirSync(join(ROOT, 'components/deliveryLink')).map((f) => `components/deliveryLink/${f}`),
  'hooks/useDeliverySupplierLinks.ts',
  'hooks/useSupplierLinkCopy.ts',
];
const PAGE = 'marketing/delivery/index.html';
const MIGRATION = 'supabase/migrations/20261013090000_delivery_supplier_links.sql';
const SECTION = 'components/deliveryLink/SupplierLinkSection.tsx';
const HOOK = 'hooks/useDeliverySupplierLinks.ts';
const COPY = 'hooks/useSupplierLinkCopy.ts';
const OTHER = ['constants/featureFlags.ts', 'components/deliveries/DeliveryFollowSheet.tsx', 'marketing/_redirects', 'marketing/netlify.toml', 'marketing/robots.txt', 'scripts/validate-protections.ts', 'i18n/surfaces.ts', 'scripts/pgq/delivery-supplier-links.mjs'];
const ALL = [...LANE_CODE, PAGE, MIGRATION, ...OTHER];
const missing = ALL.filter((f) => !existsSync(join(ROOT, f)));
ok('every file of the lane exists', missing.length === 0, missing.join(', '));
if (missing.length) { console.log(`\n✗ validate-delivery-supplier-link: ${passed} passed, ${failed} failed`); process.exit(1); }

/** Code with its comments taken out, so a rule reads what runs and not what is said about it. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const sqlBody = (s: string) => s.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
const REAL: Files = new Map(ALL.map((f) => [f, read(f)] as const));

/** Every English string of the copy hook. */
function english(src: string): string[] {
  return [...src.matchAll(/t\('office\.deliverySupplierLink\.[A-Za-z]+',\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\'/g, "'"));
}
const BANNED_WORDS = /\b(will arrive|will be delivered|guarantee[ds]?|verified|confirmed|confirms|on time|promise[ds]?|accurate|approved|compliant|safe)\b/i;

interface Rule { name: string; run: (f: Files) => string[] }
const RULES: Rule[] = [
  { name: 'the flag is read in one file, utils/deliveryLink/core.ts', run: (f) => {
    const out: string[] = [];
    for (const file of walkCode()) {
      if (file === 'constants/featureFlags.ts' || file === 'utils/deliveryLink/core.ts') continue;
      const src = f.get(file) ?? read(file);
      if (/DELIVERY_SUPPLIER_LINK_ENABLED/.test(strip(src))) out.push(`${file} reads the flag`);
    }
    if (!/export const DELIVERY_SUPPLIER_LINK_ENABLED: boolean = false;/.test(f.get('constants/featureFlags.ts')!)) out.push('the flag is not false');
    if (!/supplierLinkAllowedWith\(DELIVERY_SUPPLIER_LINK_ENABLED, userEmail\)/.test(f.get('utils/deliveryLink/core.ts')!)) out.push('the gate does not ask the flag');
    return out;
  } },
  { name: 'the app side sends nothing, calls no server function, opens no URL and moves no task', run: (f) => {
    const out: string[] = [];
    for (const file of LANE_CODE) {
      const src = strip(f.get(file)!);
      if (/functions\.invoke|\.rpc\(|\bfetch\(|XMLHttpRequest|sendBeacon/.test(src)) out.push(`${file} calls a server function or the network`);
      if (/Linking\.|mailto:|sms:|tel:|MailComposer|expo-sms|expo-mail-composer|Notifications\.|schedulePushNotification|notify\(/.test(src)) out.push(`${file} opens a URL, a mail or text composer, or a notification`);
      if (/updateProject|updateSchedule|setSchedule|saveSchedule|proposedTasks|releasedTasks|runCpm|\bschedule\s*:/.test(src)) out.push(`${file} reaches for the schedule`);
      if (/supabaseWrite|offlineQueue/.test(src)) out.push(`${file} writes through the queue itself`);
      if (file !== HOOK && /supabase\b/.test(src)) out.push(`${file} talks to the server (only the one hook may)`);
      if (/AsyncStorage|localStorage|SecureStore/.test(src)) out.push(`${file} keeps something on the device`);
    }
    return out;
  } },
  { name: 'the one hook touches one table, and never public.deliveries', run: (f) => {
    const src = strip(f.get(HOOK)!);
    const out: string[] = [];
    const froms = [...src.matchAll(/\.from\(([^)]*)\)/g)].map((m) => m[1].trim());
    if (froms.length === 0 || froms.some((a) => a !== 'TABLE')) out.push(`the hook reads or writes ${froms.join(', ')}`);
    if (!/const TABLE = 'delivery_supplier_links';/.test(src)) out.push('TABLE is not delivery_supplier_links');
    if (/'deliveries'|"deliveries"/.test(src)) out.push('the hook names the deliveries table');
    const updates = src.split('.update(').slice(1);
    if (updates.length !== 1 || !updates[0].startsWith('{ reply_seen_at: new Date().toISOString() })')) out.push('the hook updates something other than reply_seen_at');
    if ((src.match(/\.insert\(/g) ?? []).length !== 1 || !/\.insert\(\{ delivery_id: deliveryId, project_id: projectId, user_id: userId, shown \}\)/.test(src)) out.push('the hook inserts something other than the link and what it shows');
    if (!/on: allowed && query\.isSuccess/.test(src)) out.push('the section opens before the table has answered');
    if (!/enabled: allowed/.test(src)) out.push('the table is read for a person the gate does not allow');
    if (/refetchInterval|setInterval|setTimeout/.test(src)) out.push('the hook polls');
    return out;
  } },
  { name: 'nothing in the section happens by itself', run: (f) => {
    const src = strip(f.get(SECTION)!);
    const out: string[] = [];
    if (/useEffect|useLayoutEffect|useFocusEffect/.test(src)) out.push('the section has an effect');
    if ((src.match(/onUpdate\(/g) ?? []).length !== 1) out.push('the delivery is written from more or fewer than one place');
    const useDate = /const useDate = \(\) => \{([\s\S]*?)\n  \};/.exec(src)?.[1] ?? '';
    if (!/onUpdate\(delivery\.id, patch\)/.test(useDate) || !/replyDatePatch\(/.test(useDate)) out.push('the one write of the delivery is not inside Use This Date');
    if (!/onPress=\{useDate\}/.test(src)) out.push('Use This Date is not a button');
    for (const call of ['links.make(', 'links.turnOff(', 'links.markSeen(', 'links.refresh(', 'Share.share(', 'Clipboard.setStringAsync(']) {
      const at = src.indexOf(call);
      if (at < 0) { out.push(`${call} is gone`); continue; }
    }
    // Every server action and every share is reached only from a handler: none is called while drawing.
    const body = src.replace(/const (copyText|share|useDate) = [\s\S]*?\n  \};/g, '').replace(/const turnOff = [\s\S]*?\n  \]\);/, '');
    for (const line of body.split('\n')) {
      if (/links\.(make|turnOff|markSeen|refresh)\(|Share\.share\(|Clipboard\.setStringAsync\(/.test(line) && !/onPress=\{\(\) => \{/.test(line)) out.push(`a server action or a share runs outside a handler: ${line.trim().slice(0, 70)}`);
    }
    if (!/if \(!links\.on \|\| isSettled\(delivery\)\) return null;/.test(src)) out.push('the section draws with the gate closed or on a settled delivery');
    if (!/links\.make\(delivery\.id, draft\)/.test(src) || !/buildShown\(\{ delivery, company, neededBy, showNeededBy \}\)/.test(src)) out.push('the link is made with something other than what the person was shown');
    return out;
  } },
  { name: 'the sheet hands the section in once, and the section is the only door', run: (f) => {
    const sheet = strip(f.get('components/deliveries/DeliveryFollowSheet.tsx')!);
    const out: string[] = [];
    if ((sheet.match(/<SupplierLinkSection /g) ?? []).length !== 1) out.push('the sheet does not render the section exactly once');
    if (/useDeliverySupplierLinks|deliveryLink\/core/.test(sheet)) out.push('the sheet reaches past the section');
    for (const file of walkCode()) {
      if (LANE_CODE.includes(file) || file === 'components/deliveries/DeliveryFollowSheet.tsx') continue;
      if (/deliveryLink\/|useDeliverySupplierLinks|useSupplierLinkCopy/.test(strip(f.get(file) ?? read(file)))) out.push(`${file} uses the lane`);
    }
    return out;
  } },
  { name: 'the words: no answer is called confirmed, nothing "will" arrive, and the three plain facts are said', run: (f) => {
    const lines = english(f.get(COPY)!);
    const out: string[] = [];
    if (lines.length < 35) out.push(`only ${lines.length} strings were read from the copy hook`);
    for (const l of lines) {
      if (BANNED_WORDS.test(l)) out.push(`"${l}" uses a word the lane does not use`);
      if (/[—–&]|->|→/.test(l)) out.push(`"${l}" has a dash, an and-sign or an arrow`);
    }
    const all = lines.join('\n');
    if (!/MAGE ID sends nothing/.test(all)) out.push('nothing says the app sends nothing');
    if (!/MAGE ID does not know who opened it/.test(all)) out.push('nothing says MAGE ID does not know who opened the link');
    if (!/MAGE ID does not know who they are or whether the date is right/.test(all)) out.push('the answer does not say MAGE ID does not know who typed it');
    if (!/does not move your schedule/.test(all)) out.push('nothing says using the date does not move the schedule');
    if (!/MAGE ID does not notify you/.test(all)) out.push('nothing says there is no notification');
    return out;
  } },
  { name: 'the no-account page: text only, two functions, no storage, no analytics, the notice word for word', run: (f) => {
    const html = f.get(PAGE)!;
    const js = strip(/<script>\s*\(function \(\) \{([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '');
    const out: string[] = [];
    if (!js) out.push('the page script was not found');
    if (!/<meta name="robots" content="noindex" \/>/.test(html)) out.push('the page can be indexed');
    if (!/<meta name="referrer" content="no-referrer" \/>/.test(html)) out.push('the page sends its address (with the token) as a referrer');
    if (/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(js)) out.push('the page writes a server value as markup');
    const rpcs = [...js.matchAll(/rpc\('([a-z_]+)'/g)].map((m) => m[1]);
    if (rpcs.length === 0 || rpcs.some((r) => r !== 'delivery_link_view' && r !== 'delivery_link_reply')) out.push(`the page calls ${[...new Set(rpcs)].join(', ') || 'nothing'}`);
    if ((js.match(/fetch\(/g) ?? []).length !== 1 || !/fetch\(SUPABASE_URL \+ '\/rest\/v1\/rpc\/' \+ fn,/.test(js)) out.push('the page reaches the network some other way');
    if (/localStorage|sessionStorage|document\.cookie|indexedDB/.test(js)) out.push('the page keeps something in the browser');
    if (/posthog|growth\.js|gtag|analytics|formspree/i.test(html.replace(/<style>[\s\S]*?<\/style>/, ''))) out.push('the page loads analytics');
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    if (scripts.length !== 1 || !scripts[0].startsWith('/protect-notice.js')) out.push(`the page loads ${scripts.join(', ')}`);
    if (!/history\.replaceState\(null, '', location\.pathname\)/.test(js)) out.push('the token is left in the address bar');
    const flat = html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
    const notice = `${RECIPIENT_NOTICE_PARTS.before}your contractor${RECIPIENT_NOTICE_PARTS.after} ${RECIPIENT_NOTICE_PARTS.second}`;
    if (!flat.includes(notice)) out.push('the Notice To Recipients is not on the page word for word');
    if (!/data-recipient-notice="1"/.test(html)) out.push('the notice is not marked');
    const visible = flat.replace(notice, '') + ' ' + [...js.matchAll(/'((?:[^'\\]|\\.){12,})'/g)].map((m) => m[1]).filter((s) => / /.test(s)).join(' ');
    if (BANNED_WORDS.test(visible)) out.push(`the page uses a word the lane does not use: ${BANNED_WORDS.exec(visible)?.[0]}`);
    if (/[—–]/.test(visible)) out.push('the page has a dash');
    if (!/It does not change their schedule and it is not an order or an acceptance of one\./.test(js)) out.push('the page does not say what an answer is not');
    if (!/MAGE ID does not text or email them for you/.test(js)) out.push('the page does not say nobody is notified');
    if (!/id="stLoading"[\s\S]*?needs JavaScript turned on/.test(html)) out.push('with JavaScript off the page says nothing');
    return out;
  } },
  { name: 'the migration: the answer writes one table, anon holds nothing on it, and nothing is called', run: (f) => {
    const sql = sqlBody(f.get(MIGRATION)!);
    const out: string[] = [];
    const updates = [...sql.matchAll(/\bupdate\s+(public\.[a-z_]+)/g)].map((m) => m[1]);
    if (updates.length !== 1 || updates[0] !== 'public.delivery_supplier_links') out.push(`the migration updates ${updates.join(', ') || 'nothing'}`);
    if (/\binsert\s+into\b|\bdelete\s+from\b|pg_notify|net\.http|http_post|\bperform\b|create\s+trigger|cron\.schedule/i.test(sql)) out.push('the migration inserts, deletes, notifies, calls out, or adds a trigger or a job');
    if (!/revoke all on public\.delivery_supplier_links from anon, authenticated, public;/.test(sql)) out.push('the table is not taken back from anon');
    if (/grant[^;]*on public\.delivery_supplier_links to[^;]*\banon\b/.test(sql)) out.push('anon is granted something on the table');
    if (!/grant update \(shown, reply_seen_at\) on public\.delivery_supplier_links to authenticated;/.test(sql)) out.push('a signed-in client can update more than shown and reply_seen_at');
    if ((sql.match(/security definer\s+set search_path = ''/g) ?? []).length !== 2) out.push('a function is not SECURITY DEFINER with an empty search_path');
    if (!/'shown', v_link\.shown,\s+'reply', v_link\.reply/.test(sql) || /to_jsonb\(d\)|row_to_json|d\.\*/.test(sql)) out.push('the view returns more than what is shown and the answer');
    if (!/select d\.status into v_status from public\.deliveries d/.test(sql) || (sql.match(/from public\.deliveries/g) ?? []).length !== 3) out.push('the migration reads something other than the status (and the insert policy\'s own check) from deliveries');
    return out;
  } },
  { name: 'the page is routed, kept out of search, and held to the notice by the protections check', run: (f) => {
    const out: string[] = [];
    const red = f.get('marketing/_redirects')!;
    const toml = f.get('marketing/netlify.toml')!;
    if (!/^\/delivery {2}\/delivery\/index\.html {2}200$/m.test(red) || !/^\/delivery\/\* {2}\/delivery\/index\.html {2}200$/m.test(red)) out.push('_redirects lacks the two rules');
    if (!/from = "\/delivery"\s+to = "\/delivery\/index\.html"\s+status = 200/.test(toml) || !/from = "\/delivery\/\*"\s+to = "\/delivery\/index\.html"\s+status = 200/.test(toml)) out.push('netlify.toml lacks the two rules');
    if (red.indexOf('/delivery/*') > red.lastIndexOf('/*  ') && /^\/\*\s/m.test(red)) out.push('the catch-all in _redirects comes before the delivery rule');
    if (!/^Disallow: \/delivery\/$/m.test(f.get('marketing/robots.txt')!)) out.push('robots.txt does not keep the page out');
    if (!/'marketing\/delivery\/index\.html',/.test(f.get('scripts/validate-protections.ts')!)) out.push('the protections check does not know the page');
    if (!/id: 'office\.delivery-supplier-link'[^\n]*keyPrefixes: \['office\.deliverySupplierLink\.'\][^\n]*files: \['hooks\/useSupplierLinkCopy\.ts'\]/.test(f.get('i18n/surfaces.ts')!)) out.push('the strings are not a registered surface');
    if (!/20261013090000_delivery_supplier_links\.sql/.test(f.get('scripts/pgq/delivery-supplier-links.mjs')!)) out.push('the PGlite proof does not run this migration');
    return out;
  } },
];

function walkCode(): string[] {
  const out: string[] = [];
  const go = (dir: string) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== 'node_modules') go(p); } else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
    }
  };
  for (const d of ['app', 'components', 'utils', 'constants', 'contexts', 'hooks']) go(d);
  return out;
}

for (const r of RULES) {
  const bad = r.run(REAL);
  ok(r.name, bad.length === 0, bad.join(' | '));
}

// ═══ C. Planted mutations ═══════════════════════════════════════════════════
/** [what is planted, the rule that must go red, the file, text to find, text to put] */
const PLANTS: [string, number, string, string, string][] = [
  ['a screen reads the flag itself', 0, SECTION, "import { DateRow }", "import { DELIVERY_SUPPLIER_LINK_ENABLED } from '@/constants/featureFlags';\nconst X = DELIVERY_SUPPLIER_LINK_ENABLED;\nimport { DateRow }"],
  ['the flag is turned on', 0, 'constants/featureFlags.ts', 'export const DELIVERY_SUPPLIER_LINK_ENABLED: boolean = false;', 'export const DELIVERY_SUPPLIER_LINK_ENABLED: boolean = true;'],
  ['the hook calls a server function to send the link', 1, HOOK, "const COLUMNS =", "export const send = () => supabase.functions.invoke('send-email', { body: {} });\nconst COLUMNS ="],
  ['the section opens the mail app', 1, SECTION, 'const share = async () => {', "const mail = () => Linking.openURL('mailto:yard@example.com');\n  const share = async () => {"],
  ['the section moves the schedule', 1, SECTION, 'if (patch) onUpdate(delivery.id, patch);', 'if (patch) { onUpdate(delivery.id, patch); updateProject(projectId, { schedule: next }); }'],
  ['the section talks to the server itself', 1, SECTION, 'const turnOff = () =>', "const direct = () => supabase.from('delivery_supplier_links').select('*');\n  const turnOff = () =>"],
  ['the hook writes the delivery', 2, HOOK, "supabase.from(TABLE).update({ reply_seen_at: new Date().toISOString() }).eq('delivery_id', deliveryId)", "supabase.from('deliveries').update({ expected_date: null }).eq('id', deliveryId)"],
  ['the hook forges an answer', 2, HOOK, '.update({ reply_seen_at: new Date().toISOString() })', ".update({ reply: { date: '2026-01-01' } })"],
  ['the section opens before the table has answered', 2, HOOK, 'on: allowed && query.isSuccess', 'on: allowed'],
  ['the hook polls for an answer', 2, HOOK, 'staleTime: 30 * 1000, retry: false', 'staleTime: 30 * 1000, retry: false, refetchInterval: 5000'],
  ['the answer\'s date is used by itself', 3, SECTION, '  const useDate = () => {', '  useEffect(() => { if (reply && differs) useDate(); }, [reply]);\n  const useDate = () => {'],
  ['the delivery is written while drawing', 3, SECTION, '  const turnOff = () =>', '  if (reply && differs) onUpdate(delivery.id, { expectedDate: reply.date });\n  const turnOff = () =>'],
  ['a link is made while drawing', 3, SECTION, '  if (!link) {', '  if (!link) void links.make(delivery.id, draft);\n  if (!link) {'],
  ['the section draws on a delivered load', 3, SECTION, 'if (!links.on || isSettled(delivery)) return null;', 'if (!links.on) return null;'],
  ['the link is made with more than the person was shown', 3, SECTION, 'links.make(delivery.id, draft)', 'links.make(delivery.id, { ...draft, notes: delivery.notes } as never)'],
  ['another screen makes links', 4, 'components/deliveries/DeliveryFollowSheet.tsx', "import { SupplierLinkSection } from '@/components/deliveryLink/SupplierLinkSection';", "import { SupplierLinkSection } from '@/components/deliveryLink/SupplierLinkSection';\nimport { useDeliverySupplierLinks } from '@/hooks/useDeliverySupplierLinks';"],
  ['an answer is called confirmed', 5, COPY, "'Answer Through the Link'", "'Supplier Confirmed'"],
  ['the words say the load will arrive', 5, COPY, "'No answer yet. An answer shows here", "'It will arrive on the date given. An answer shows here"],
  ['the line that the app sends nothing is cut', 5, COPY, ' You send the link yourself. MAGE ID sends nothing.', ''],
  ['the line that MAGE ID does not know who answered is cut', 5, COPY, ' MAGE ID does not know who they are or whether the date is right.', ''],
  ['the page writes the answer as markup', 6, PAGE, 'dt.textContent = label; dd.textContent = value;', 'dt.textContent = label; dd.innerHTML = value;'],
  ['the page calls another function', 6, PAGE, "rpc('delivery_link_view', { p_token: TOKEN }).then(function (v) {\n      if (!v || v.found !== true) { only('stGone'); return; }", "rpc('get_portal_snapshot', { p_token: TOKEN }).then(function (v) {\n      if (!v || v.found !== true) { only('stGone'); return; }"],
  ['the page keeps the token in the browser', 6, PAGE, "var company = 'the contractor';", "localStorage.setItem('t', TOKEN);\n  var company = 'the contractor';"],
  ['the page loads analytics', 6, PAGE, '<script src="/protect-notice.js?v=2026-10-09"></script>', '<script src="/protect-notice.js?v=2026-10-09"></script>\n<script src="/growth.js"></script>'],
  ['the notice is reworded', 6, PAGE, 'MAGE ID did not prepare, review or check this document', 'MAGE ID reviewed this document'],
  ['the page can be indexed', 6, PAGE, '<meta name="robots" content="noindex" />', ''],
  ['the page leaves the token in the address', 6, PAGE, "history.replaceState(null, '', location.pathname)", "history.replaceState(null, '', location.href)"],
  ['the page calls the answer confirmed', 6, PAGE, '<h2>Sent</h2>', '<h2>Delivery Confirmed</h2>'],
  ['the answer also writes the delivery', 7, MIGRATION, "  return jsonb_build_object('ok', true);", "  update public.deliveries set expected_date = p_date where id = v_link.delivery_id;\n  return jsonb_build_object('ok', true);"],
  ['anon is given the table', 7, MIGRATION, 'grant select, delete on public.delivery_supplier_links to authenticated;', 'grant select, delete on public.delivery_supplier_links to authenticated;\ngrant select on public.delivery_supplier_links to anon;'],
  ['a signed-in client may write the answer', 7, MIGRATION, 'grant update (shown, reply_seen_at) on', 'grant update (shown, reply_seen_at, reply) on'],
  ['the answer notifies someone', 7, MIGRATION, "  return jsonb_build_object('ok', true);", "  perform pg_notify('supplier_answer', v_link.delivery_id::text);\n  return jsonb_build_object('ok', true);"],
  ['the view returns the delivery row', 7, MIGRATION, "    'shown', v_link.shown,", "    'shown', v_link.shown, 'delivery', (select to_jsonb(d) from public.deliveries d where d.id = v_link.delivery_id),"],
  ['the path rule is dropped from _redirects', 8, 'marketing/_redirects', '/delivery/*  /delivery/index.html  200', ''],
  ['robots.txt lets the page be crawled', 8, 'marketing/robots.txt', 'Disallow: /delivery/\n', ''],
  ['the protections check forgets the page', 8, 'scripts/validate-protections.ts', "  'marketing/delivery/index.html',\n", ''],
];
let caught = 0;
for (const [what, ruleIndex, file, from, to] of PLANTS) {
  const src = REAL.get(file)!;
  if (!src.includes(from)) { ok(`plant "${what}": its anchor is in ${file}`, false, from.slice(0, 80)); continue; }
  const mutated: Files = new Map(REAL);
  mutated.set(file, src.replace(from, to));
  const bad = RULES[ruleIndex].run(mutated);
  if (bad.length > 0) caught++;
  ok(`plant "${what}" turns "${RULES[ruleIndex].name}" red`, bad.length > 0);
}

console.log(`\n${failed === 0 ? '✓' : '✗'} validate-delivery-supplier-link: ${passed} passed, ${failed} failed (${caught} of ${PLANTS.length} planted mutations caught)`);
process.exit(failed === 0 ? 0 : 1);
