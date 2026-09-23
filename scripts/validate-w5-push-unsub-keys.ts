// scripts/validate-w5-push-unsub-keys.ts — wave 5, lane push-unsub:
// every email a reader can turn off, they can turn back on.
//
//   #172  Once someone tapped Unsubscribe on a "Client paid", "Punch ready",
//         payment-reminder, weekly-recap or bid-invite email, no screen could
//         turn it back on: the preferences page's GROUPS and the unsubscribe
//         page's EVENT_LABELS were two hand-kept lists that had drifted from
//         the senders. Both pages now read ONE list, marketing/
//         email-event-keys.json; the preferences page lists anything else this
//         address turned off as "Other"; the unsubscribe page has an Undo.
//
// The guard that keeps it from drifting again: every eventKey / prefKey
// literal a sender uses (supabase/functions, app, utils) must be in the JSON or
// on EXCLUDED below, with the reason it is not a toggle.
//
// Run: bun run scripts/validate-w5-push-unsub-keys.ts

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.info('  ✓', name); }
  else { fail++; console.error('  ✗', name, detail ? `— ${detail}` : ''); }
}

// The document kinds come from ONE place, _shared/email.ts
// TRANSACTIONAL_DOCUMENT_KEYS — the same list send-email reads to withhold the
// one-click header (review of #45/#76). Imported under a Deno.env shim; the
// variable specifier keeps the Deno module out of the app's tsc program.
(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => (k === 'UNSUB_SECRET' ? 'x' : undefined) } };
const emailModPath = '../supabase/functions/_shared/email';
const { TRANSACTIONAL_DOCUMENT_KEYS } = await import(emailModPath) as { TRANSACTIONAL_DOCUMENT_KEYS: readonly string[] };

/** Keys a sender uses that are deliberately NOT a toggle, and why. Adding one
 *  here is a decision; the reason is the point. daily_digest is managed in the
 *  app; the document kinds are transactional — send-email checks no
 *  suppression and offers no one-click for them, and both pages say so instead
 *  of showing a switch. A suppressed row under an unknown key still shows as
 *  "Other" (the catch-all), so no unsubscribe is one-way. */
const EXCLUDED: Record<string, string> = {
  daily_digest: 'the GC digest is managed in the app (Settings → Push & email preferences); its truth is profiles.* and the resume RPC, not this page',
  ...Object.fromEntries(TRANSACTIONAL_DOCUMENT_KEYS.map((k) => [k,
    'a document the GC sends his own client or sub through send-email — transactional, no suppression check, no one-click (TRANSACTIONAL_DOCUMENT_KEYS)'])),
};

/** Keys the list must carry even before their sender lands in this tree:
 *  the finding's seven, and CONTRACT 8's three wave-5 notify events. */
const REQUIRED = [
  'invoice_paid', 'punch_ready', 'field_report', 'pro_response', 'payment_reminders', 'weekly_digest', 'bid_invite',
  'bid_invite_received', 'lien_waiver_signed', 'prequal_submitted',
];

// ── the list itself ──────────────────────────────────────────────────────────
type Item = { key: string; label: string; desc: string; noun: string };
let groups: { label: string; items: Item[] }[] = [];
try {
  const j = JSON.parse(read('marketing/email-event-keys.json')) as { groups?: typeof groups };
  groups = Array.isArray(j.groups) ? j.groups : [];
  ok('marketing/email-event-keys.json parses and has groups', groups.length > 0);
} catch (e) {
  ok('marketing/email-event-keys.json parses and has groups', false, String(e));
}
type DocItem = { key: string; label: string; noun: string };
let documents: { label?: string; note?: string; items?: DocItem[] } = {};
try {
  documents = (JSON.parse(read('marketing/email-event-keys.json')) as { documents?: typeof documents }).documents ?? {};
} catch { /* reported by the parse check above */ }
const docKeys = (documents.items ?? []).map((d) => d.key);
ok('the JSON\'s "documents" are exactly TRANSACTIONAL_DOCUMENT_KEYS (one list, two readers)',
  JSON.stringify([...docKeys].sort()) === JSON.stringify([...TRANSACTIONAL_DOCUMENT_KEYS].sort()),
  `${docKeys.join(',')} vs ${TRANSACTIONAL_DOCUMENT_KEYS.join(',')}`);
ok('…each with a label and noun, plus a group label and a note that says they can\'t be turned off here',
  (documents.items ?? []).every((d) => !!d.label?.trim() && !!d.noun?.trim()) && !!documents.label?.trim()
  && /can't turn them off/i.test(documents.note ?? '') && /reply to your contractor/i.test(documents.note ?? ''));
const items = groups.flatMap((g) => g.items ?? []);
const listed = new Set(items.map((i) => i.key));
ok('every entry has a key, label, desc and noun',
  items.length > 0 && items.every((i) => /^[a-z][a-z0-9_]*$/.test(i.key) && !!i.label?.trim() && !!i.desc?.trim() && !!i.noun?.trim()),
  JSON.stringify(items.filter((i) => !(i.label && i.desc && i.noun))));
ok('no key is listed twice', listed.size === items.length);
ok('every group has a label', groups.every((g) => !!g.label?.trim()));
for (const k of REQUIRED) ok(`the list carries '${k}'`, listed.has(k));
ok('no excluded key is also listed', Object.keys(EXCLUDED).every((k) => !listed.has(k)),
  Object.keys(EXCLUDED).filter((k) => listed.has(k)).join(', '));
ok('invoice_paid says it also covers a failed bank payment (client_payment_failed shares the key)',
  /fail/i.test(items.find((i) => i.key === 'invoice_paid')?.desc ?? ''));

// ── every sender key is on the list or excluded ──────────────────────────────
const files: string[] = [];
const walk = (dir: string) => {
  if (!existsSync(join(ROOT, dir))) return;
  for (const f of readdirSync(join(ROOT, dir))) {
    if (f === 'node_modules') continue;
    const p = `${dir}/${f}`;
    if (statSync(join(ROOT, p)).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(p)) files.push(p);
  }
};
['supabase/functions', 'app', 'utils', 'contexts', 'components', 'hooks'].forEach(walk);

const PATTERNS = [
  /\b(?:eventKey|prefKey)\s*:\s*(?:[\w.?]+\s*\?\?\s*)?'([a-z][a-z0-9_]*)'/g,             // eventKey: 'x' | prefKey: 'x' | eventKey: opts.eventKey ?? 'x'
  /\bisEmailUnsubscribed\([^)]*?,\s*'([a-z][a-z0-9_]*)'\s*\)/g,                          // isEmailUnsubscribed(url, key, email, 'x')
  /\bisUnsubscribed\([^)]*?,\s*'([a-z][a-z0-9_]*)'\s*\)/g,                               // notify's local helper
];
const found = new Map<string, Set<string>>();
for (const f of files) {
  const src = stripComments(read(f));
  for (const re of PATTERNS) {
    for (const m of src.matchAll(re)) {
      if (!found.has(m[1])) found.set(m[1], new Set());
      found.get(m[1])!.add(f);
    }
  }
}
ok('the scan finds the senders it should (sanity: portal_message, invoice_paid, payment_reminders, weekly_digest, bid_invite, daily_digest)',
  ['portal_message', 'invoice_paid', 'payment_reminders', 'weekly_digest', 'bid_invite', 'daily_digest'].every((k) => found.has(k)),
  [...found.keys()].join(', '));
const unknown = [...found.entries()].filter(([k]) => !listed.has(k) && !(k in EXCLUDED));
ok('every eventKey / prefKey a sender uses is in email-event-keys.json or EXCLUDED (with a reason)',
  unknown.length === 0,
  unknown.map(([k, fs]) => `${k} (${[...fs].join(', ')})`).join('; '));
const staleExcluded = Object.keys(EXCLUDED).filter((k) => !found.has(k));
ok('every EXCLUDED key is still used by a sender (the list only shrinks)', staleExcluded.length === 0, staleExcluded.join(', '));

// ── the pages read the one list ──────────────────────────────────────────────
const prefs = read('marketing/preferences/index.html');
const unsub = read('marketing/unsubscribe/index.html');
ok('the preferences page fetches /email-event-keys.json', /var KEYS_URL = '\/email-event-keys\.json';/.test(prefs) && /fetch\(KEYS_URL/.test(prefs));
ok('the unsubscribe page fetches /email-event-keys.json', /var KEYS_URL = '\/email-event-keys\.json';/.test(unsub) && /fetch\(KEYS_URL/.test(unsub));
ok('the preferences page keeps no key list of its own', !/var GROUPS = \[/.test(prefs) && !/\{ key: '[a-z_]+', label:/.test(prefs));
ok('the unsubscribe page keeps no label map of its own', !/EVENT_LABELS\s*=\s*\{/.test(unsub));
ok('the unsubscribe page falls back to "these notifications" for a key the list lacks',
  /\$categoryLabel\.textContent = 'these notifications';/.test(unsub) && /it\.key === qs\.key && it\.noun/.test(unsub));

// ── the catch-all ────────────────────────────────────────────────────────────
ok('the preferences page reads every suppressed key for the address (list=1, with the token)',
  /'&t=' \+ encodeURIComponent\(qs\.token\) \+ '&list=1'/.test(prefs));
ok('…and renders each key the list does not know under "Other", turned off, re-enableable',
  /addGroupLabel\('Other'\)/.test(prefs) && /!known\[k\]/.test(prefs) && /suppressed: true/.test(prefs)
  && /callApi\(action, item\.key\)/.test(prefs));
ok('rows are built with textContent — an "Other" key comes from the server', !/row\.innerHTML/.test(prefs) && /labelEl\.textContent = item\.label/.test(prefs));
ok('a list that fails to load says so instead of showing an empty page', /could not load the list of email categories/i.test(prefs));
ok('the global row is still liftable (resubscribe with event_key null)', /id="resubAll"/.test(prefs) && /callApi\('resubscribe', null\)/.test(prefs));

// ── Undo on the unsubscribe page ─────────────────────────────────────────────
ok('the success block has an Undo button', /id="undoBtn"/.test(unsub));
ok('Undo POSTs { action: \'resubscribe\', event_key, token } with the same signed token',
  /JSON\.stringify\(\{ email: qs\.email, action: 'resubscribe', event_key: qs\.key \|\| null, token: qs\.token \}\)/.test(unsub));
ok('"reply to any past email and we\'ll restore it" is gone (nothing reads replies)', !/Reply to any past email/i.test(stripComments(unsub)));
ok('the success block links the preferences page with the same e + t', /'\/preferences\?e=' \+ encodeURIComponent\(qs\.email\) \+ '&t=' \+ encodeURIComponent\(qs\.token\)/.test(unsub));

// ── the function serves the catch-all ────────────────────────────────────────
const fn = stripComments(read('supabase/functions/unsubscribe/index.ts'));
ok('unsubscribe GET list=1 returns every suppressed key', /url\.searchParams\.get\('list'\) === '1'/.test(fn) && /return jsonResponse\(\{ ok: true, suppressed: listed\.keys \}\)/.test(fn));

// ── the JSON is served, not 404'd ────────────────────────────────────────────
const redirects = read('marketing/_redirects') + read('marketing/netlify.toml');
ok('no redirect shadows /email-event-keys.json and the catch-all 404 is not forced',
  !/email-event-keys/.test(redirects) && !/\/\*\s+\/404\.html\s+404!/.test(redirects) && !/force\s*=\s*true[\s\S]{0,40}404/.test(redirects));

// ── the pages, executed (jsdom, stubbed fetch) ───────────────────────────────
// The source pins above say the code is there; this says it works: the real
// page scripts run against the real JSON, and the POST bodies they send are
// read back.
{
  const { JSDOM } = await import('jsdom');
  const keysJson = JSON.parse(read('marketing/email-event-keys.json'));
  type Reply = { status: number; body: unknown };
  type Call = { u: string; init?: { method?: string; body?: string } };
  const tick = () => new Promise((r) => setTimeout(r, 25));
  async function runPage(path: string, url: string, handler: (u: string) => Reply) {
    const html = read(path).replace('<script src="/motion.js" defer></script>', '');
    const calls: Call[] = [];
    const dom = new JSDOM(html, {
      url,
      runScripts: 'dangerously',
      beforeParse(w) {
        (w as unknown as { fetch: unknown }).fetch = async (u: string, init?: Call['init']) => {
          calls.push({ u: String(u), init });
          const r = handler(String(u));
          return { ok: r.status < 400, status: r.status, json: async () => r.body };
        };
        (w as unknown as { confirm: () => boolean }).confirm = () => true;
      },
    });
    for (let i = 0; i < 10; i++) await tick();
    return { doc: dom.window.document, win: dom.window, calls };
  }
  const posts = (calls: Call[]) => calls.filter((c) => c.init?.method === 'POST').map((c) => JSON.parse(c.init?.body ?? '{}'));

  const p = await runPage('marketing/preferences/index.html', 'https://mageid.app/preferences?e=gc%40x.com&t=TOK', (u) => {
    if (u === '/email-event-keys.json') return { status: 200, body: keysJson };
    if (u.includes('&list=1')) return { status: 200, body: { ok: true, suppressed: ['punch_ready', 'estimate', 'future_kind', null, '<img src=x onerror=alert(1)>'] } };
    if (u.includes('&k=punch_ready')) return { status: 200, body: { ok: true, unsubscribed: true } };
    return { status: 200, body: { ok: true, unsubscribed: false } };
  });
  const boxes = [...p.doc.querySelectorAll('input[type=checkbox]')] as HTMLInputElement[];
  const keyOf = (b: HTMLInputElement) => b.getAttribute('data-key');
  ok('page: every key in the shared list renders a toggle', [...listed].every((k) => boxes.some((b) => keyOf(b) === k)));
  ok('page: a suppressed listed key shows OFF', boxes.find((b) => keyOf(b) === 'punch_ready')?.checked === false);
  const est = boxes.find((b) => keyOf(b) === 'estimate');
  const estNote = p.doc.querySelector('[data-document-key="estimate"]');
  ok('page: a suppressed DOCUMENT key (estimate) gets no switch and no "Turned off"', !est && !!estNote
    && !/turned off/i.test(estNote?.textContent ?? '') && /can't turn them off/i.test(estNote?.textContent ?? '')
    && (estNote?.textContent ?? '').includes('Estimates'), estNote?.textContent ?? '(no row)');
  ok('page: …under the documents group label', (p.doc.body.textContent ?? '').includes(documents.label ?? '\u0000'));
  const other = boxes.find((b) => keyOf(b) === 'future_kind');
  ok('page: an unlisted suppressed key gets an "Other" row, OFF', !!other && other.checked === false);
  ok('page: a hostile key renders as text, never markup', !p.doc.querySelector('img') && (p.doc.body.textContent ?? '').includes('<img src=x onerror=alert(1)>'));
  if (other) { other.checked = true; other.dispatchEvent(new p.win.Event('change')); }
  await tick();
  const pb = posts(p.calls)[0] ?? {};
  ok('page: turning an Other row on POSTs resubscribe for that key with the token',
    pb.action === 'resubscribe' && pb.event_key === 'future_kind' && pb.token === 'TOK', JSON.stringify(pb));

  const u2 = await runPage('marketing/unsubscribe/index.html', 'https://mageid.app/unsubscribe?e=gc%40x.com&k=invoice_paid&t=TOK', (u) =>
    (u === '/email-event-keys.json' ? { status: 200, body: keysJson } : { status: 200, body: { ok: true } }));
  ok('unsubscribe page: the category wording comes from the list', u2.doc.getElementById('categoryLabel')?.textContent === 'client payment alerts');
  (u2.doc.getElementById('confirmBtn') as HTMLButtonElement).click();
  for (let i = 0; i < 5; i++) await tick();
  (u2.doc.getElementById('undoBtn') as HTMLButtonElement).click();
  for (let i = 0; i < 5; i++) await tick();
  const ub = posts(u2.calls);
  ok('unsubscribe page: Undo POSTs resubscribe for the same key with the same token',
    ub[1]?.action === 'resubscribe' && ub[1]?.event_key === 'invoice_paid' && ub[1]?.token === 'TOK', JSON.stringify(ub));
  ok('unsubscribe page: Undo says it worked', /subscribed again/i.test(u2.doc.getElementById('title')?.textContent ?? ''));

  // A document key (the app's footer on an invoice still links here until the
  // join drops it): no Confirm, no POST, and it says why.
  const u3 = await runPage('marketing/unsubscribe/index.html', 'https://mageid.app/unsubscribe?e=client%40home.com&k=invoice&t=TOK', (u) =>
    (u === '/email-event-keys.json' ? { status: 200, body: keysJson } : { status: 200, body: { ok: true } }));
  const actions = u3.doc.getElementById('actionsBlock');
  ok('unsubscribe page, document key: the confirm actions are hidden', !!actions && actions.classList.contains('hidden'));
  ok('unsubscribe page, document key: it says the contractor sends these directly and how to stop them',
    /from your contractor directly/i.test(u3.doc.getElementById('title')?.textContent ?? '')
    && /invoices/.test(u3.doc.getElementById('lede')?.textContent ?? '')
    && /reply to your contractor/i.test(u3.doc.getElementById('lede')?.textContent ?? ''));
  (u3.doc.getElementById('confirmBtn') as HTMLButtonElement).click();
  for (let i = 0; i < 5; i++) await tick();
  ok('unsubscribe page, document key: nothing is POSTed', posts(u3.calls).length === 0, JSON.stringify(posts(u3.calls)));

  // Confirm waits for the list, so a fast tap can't record a document key
  // before the page knows what it is.
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  const html4 = read('marketing/unsubscribe/index.html').replace('<script src="/motion.js" defer></script>', '');
  const calls4: Call[] = [];
  const dom4 = new JSDOM(html4, {
    url: 'https://mageid.app/unsubscribe?e=client%40home.com&k=invoice&t=TOK',
    runScripts: 'dangerously',
    beforeParse(w) {
      (w as unknown as { fetch: unknown }).fetch = async (u: string, init?: Call['init']) => {
        calls4.push({ u: String(u), init });
        if (String(u) === '/email-event-keys.json') await gate;
        return { ok: true, status: 200, json: async () => (String(u) === '/email-event-keys.json' ? keysJson : { ok: true }) };
      };
    },
  });
  await tick();
  const btn4 = dom4.window.document.getElementById('confirmBtn') as HTMLButtonElement;
  ok('unsubscribe page: Confirm is disabled while the list loads', btn4.disabled === true);
  release();
  for (let i = 0; i < 5; i++) await tick();
  ok('unsubscribe page: …and a document key still shows no Confirm once it has', dom4.window.document.getElementById('actionsBlock')?.classList.contains('hidden') === true);
  const u5 = await runPage('marketing/unsubscribe/index.html', 'https://mageid.app/unsubscribe?e=gc%40x.com&k=invoice_paid&t=TOK', (u) =>
    (u === '/email-event-keys.json' ? { status: 404, body: null } : { status: 200, body: { ok: true } }));
  ok('unsubscribe page: a list that fails to load gives Confirm back (generic wording)',
    (u5.doc.getElementById('confirmBtn') as HTMLButtonElement).disabled === false
    && u5.doc.getElementById('categoryLabel')?.textContent === 'these notifications');
}

console.info(`\n${fail === 0 ? `validate-w5-push-unsub-keys: ${pass} checks passed` : `${fail} of ${pass + fail} checks FAILED`}\n`);
process.exit(fail === 0 ? 0 : 1);
