#!/usr/bin/env bun
// scripts/validate-portal-message-files.ts — track MSG, lane MSGPORTAL.
//
// Photos and PDFs in the homeowner's portal thread (marketing/portal/index.html).
// Boots the REAL page in jsdom on a snapshot the REAL builder
// (utils/portalSnapshot.buildPortalSnapshot) made, with ?t=tok in the URL and
// fetch / XMLHttpRequest / localStorage / window.open stubbed, and walks:
//   A render  — server rows with files: one 'urls' call (token in the body,
//               never the URL), only https URLs on the Supabase origin are used,
//               a hostile file name is text, no storage key or signed URL in
//               localStorage; photo tap = lightbox, PDF Open / Download; a 401
//               shows the ended-link screen and stops signing.
//   B pick    — size / type / sniff / count refusals, one note, the tray.
//   C send    — upload POSTs, then XHR PUTs (storage-js FormData shape), then
//               ONE send after the last upload; the bubble shows real progress
//               and never a time until the server row (same id) replaces it;
//               a text-only message keeps portal_post_message.
//   D failure — "Not sent." + Try again (only the failed file) + Remove, the
//               text kept; offline waits and retries on 'online'; 422
//               not_uploaded re-uploads exactly those ids; 401 ends quietly.
//   E reload  — a pending record not in the thread: text back, note shown.
//   F source  — constants equal utils/messageAttachments.ts, the accept list,
//               no direct portal_messages REST, every new string linted.
//
// MUTATION PROOF: MSG_PORTAL_PAGE=<path> reads that page instead of the repo's.
//
// Run: bun run scripts/validate-portal-message-files.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { buildPortalSnapshot } from '../utils/portalSnapshot';
import {
  MESSAGE_ATTACHMENT_MAX_BYTES,
  MESSAGE_ATTACHMENT_MAX_COUNT,
  MESSAGE_ATTACHMENT_MIMES,
  MESSAGE_ATTACHMENT_URL_TTL_SECONDS,
} from '../utils/messageAttachments';
import { PORTAL_UI_STRINGS } from '../utils/portalLanguages';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE_PATH = process.env.MSG_PORTAL_PAGE || join(ROOT, 'marketing/portal/index.html');
const html = readFileSync(PAGE_PATH, 'utf8');
const SUPA = 'https://nteoqhcswappxxjlpvap.supabase.co';
const FN = SUPA + '/functions/v1/portal-message-files';

let pass = 0;
let fail = 0;
const failed: string[] = [];
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log('  ✓', name); return; }
  fail++; failed.push(name);
  console.log('  ✗', name, detail !== undefined ? `\n      ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : '');
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, ms = 2500): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return true; await sleep(15); }
  return cond();
}

// ── ids ──
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const M1 = uuid(101), M2 = uuid(102), M3 = uuid(103), X_LOST = uuid(201), X_ARRIVED = uuid(202);
const P1 = uuid(11), D1 = uuid(12), P2 = uuid(13), P3 = uuid(14);
const SIGNED_P1 = `${SUPA}/storage/v1/object/sign/message-attachments/p/${M1}/${P1}.jpg?token=s1`;
const SIGNED_D1 = `${SUPA}/storage/v1/object/sign/message-attachments/p/${M1}/${D1}.pdf?token=s2`;
const DOWNLOAD_D1 = `${SUPA}/storage/v1/object/sign/message-attachments/p/${M1}/${D1}.pdf?token=dl&download=Plan.pdf`;
const XSS_NAME = '<img src=x onerror=alert(1)>.pdf';
const STORAGE_KEY_IN_ROW = `proj/${M1}/${P1}.jpg`;

// ── the snapshot ──
const snap: any = buildPortalSnapshot({
  project: { id: 'p1', name: 'Maple St', status: 'in_progress', updatedAt: 'x' },
  portal: { portalId: 'pid', enabled: true, showInvoices: false, showPhotos: false, showChangeOrders: false, showSchedule: false },
  invite: { id: 'inv-1', name: 'Dana Client', email: 'dana@example.com' },
  supabaseUrl: SUPA, supabaseAnonKey: 'anon',
} as any);
const b64 = Buffer.from(JSON.stringify(snap)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

type Res = { status: number; body?: any } | 'network';
type Call = { url: string; body: any; seq: number };
interface Ctx {
  w: any; d: any;
  errors: string[];
  calls: Call[];
  fnCalls(action?: string): Call[];
  xhrs: any[];
  log: string[];
  live: any[];
  state: { online: boolean; fnNetworkDown: boolean };
  fn: (body: any) => Res | undefined;
  opened: any[];
  openReturnsNull: boolean;
  revoked: string[];
  refresh(): void;
  close(): void;
}

function bytes(w: any, head: number[], size: number) {
  const a = new w.Uint8Array(size);
  head.forEach((b, i) => { a[i] = b; });
  return a;
}
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34];
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
function file(ctx: Ctx, name: string, type: string, head: number[], size: number) {
  return new ctx.w.File([bytes(ctx.w, head, size)], name, { type });
}

async function boot(opts: { live?: any[]; flag?: boolean; storage?: Record<string, string>; fn?: Ctx['fn']; setup?: (w: any) => void } = {}): Promise<Ctx> {
  const errors: string[] = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(String((e && (e as any).message) || e)));
  vc.on('error', (e) => errors.push(String(e)));
  let seq = 0;
  const ctx: any = {
    errors, calls: [] as Call[], xhrs: [] as any[], log: [] as string[], live: opts.live ?? [],
    state: { online: true, fnNetworkDown: false }, fn: opts.fn ?? (() => undefined),
    opened: [], openReturnsNull: false, revoked: [] as string[],
  };
  ctx.fnCalls = (action?: string) => ctx.calls.filter((c: Call) => c.url.startsWith(FN) && (!action || (c.body && c.body.action === action)));
  let blobN = 0;
  const dom = new JSDOM(html.replace(/<script src="\/motion\.js[^"]*" defer><\/script>/, ''), {
    url: `https://mageid.app/portal/pid?t=tok#d=${b64}`, runScripts: 'dangerously', virtualConsole: vc, pretendToBeVisual: true,
    beforeParse(w: any) {
      if (opts.flag !== false) w.__MSG_FILES_TEST__ = true;
      if (opts.storage) for (const [k, v] of Object.entries(opts.storage)) w.localStorage.setItem(k, v);
      w.IntersectionObserver = class { observe() {} disconnect() {} };
      Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => ctx.state.online });
      w.URL.createObjectURL = () => `blob:https://mageid.app/local-${++blobN}`;
      w.URL.revokeObjectURL = (u: string) => { ctx.revoked.push(u); };
      w.open = () => {
        if (ctx.openReturnsNull) return null;
        const win = { closed: false, opener: {}, location: { href: '' }, close() { this.closed = true; } };
        ctx.opened.push(win);
        return win;
      };
      class FakeXHR {
        method = ''; url = ''; headers: Record<string, string> = {}; body: any = null; status = 0; responseText = '';
        upload: any = { onprogress: null };
        onload: any = null; onerror: any = null; onabort: any = null; ontimeout: any = null;
        open(m: string, u: string) { this.method = m; this.url = u; }
        setRequestHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; }
        send(b: any) { this.body = b; ctx.xhrs.push(this); ctx.log.push(`put:${this.url}`); }
        progress(loaded: number, total: number) { this.upload.onprogress && this.upload.onprogress({ lengthComputable: true, loaded, total }); }
        finish(status = 200) { this.status = status; ctx.log.push(`done:${this.url}:${status}`); this.onload && this.onload(); }
        fail() { ctx.log.push(`err:${this.url}`); this.onerror && this.onerror(); }
      }
      w.XMLHttpRequest = FakeXHR;
      if (opts.setup) opts.setup(w);
      w.fetch = async (url: string, init: any) => {
        let body: any = null;
        try { body = init && init.body ? JSON.parse(init.body) : null; } catch { body = init && init.body; }
        ctx.calls.push({ url, body, seq: ++seq });
        const json = (b: any, status = 200) => ({ ok: status < 300, status, json: async () => b, text: async () => JSON.stringify(b) });
        if (url.startsWith(SUPA + '/functions/v1/portal-message-files')) {
          ctx.log.push(`fn:${body && body.action}:${body && body.file ? body.file.id : ''}`);
          if (ctx.state.fnNetworkDown) throw new TypeError('Failed to fetch');
          const r = ctx.fn(body);
          if (r === 'network') throw new TypeError('Failed to fetch');
          if (r) return json(r.body ?? {}, r.status);
          if (body.action === 'upload') {
            return json({ uploadUrl: `${SUPA}/storage/v1/object/upload/sign/message-attachments/p/${body.messageId}/${body.file.id}?token=up`, expiresInSeconds: 7200 });
          }
          if (body.action === 'send') return json({ ok: true, id: body.messageId });
          if (body.action === 'urls') return json({ urls: {}, expiresInSeconds: 300 });
          if (body.action === 'download') return json({ error: 'not_found' }, 404);
          return json({ error: 'bad_request' }, 400);
        }
        if (url.includes('portal_get_snapshot_v2')) return json({ status: 'ok', snapshot: snap });
        if (url.includes('portal_get_messages')) return json(ctx.live);
        if (url.includes('portal_post_message')) return json(null);
        if (url.includes('signed-media-urls')) return json({ urls: {} });
        return json({});
      };
    },
  });
  ctx.w = dom.window;
  ctx.d = dom.window.document;
  ctx.refresh = () => {
    Object.defineProperty(ctx.d, 'hidden', { configurable: true, get: () => false });
    ctx.d.dispatchEvent(new ctx.w.Event('visibilitychange'));
  };
  ctx.close = () => { try { dom.window.close(); } catch { /* */ } };
  await waitFor(() => !!ctx.d.getElementById('msg-thread') && ctx.calls.some((c: Call) => c.url.includes('portal_get_messages')), 3000);
  await sleep(350);
  return ctx as Ctx;
}

function pick(ctx: Ctx, files: any[]) {
  const input = ctx.d.getElementById('msg-file');
  Object.defineProperty(input, 'files', { configurable: true, get: () => files });
  input.dispatchEvent(new ctx.w.Event('change'));
}
const chips = (ctx: Ctx) => ctx.d.querySelectorAll('#msg-tray .msg-chip').length;
const note = (ctx: Ctx) => { const n = ctx.d.getElementById('msg-note'); return n && !n.hidden ? String(n.textContent) : ''; };
const pendingBubbles = (ctx: Ctx) => [...ctx.d.querySelectorAll('#msg-thread .msg.pending')] as any[];
function typeAndSend(ctx: Ctx, text: string) {
  ctx.d.getElementById('msg-input').value = text;
  ctx.d.getElementById('msg-send').click();
}
const serverRow = (id: string, body: string, attachments: any[], author = 'client') =>
  ({ id, author_type: author, author_name: author === 'gc' ? 'Acme Builders' : 'Dana Client', body, created_at: new Date(Date.now() - 120000).toISOString(), attachments });

const allCalls: Call[] = [];
const allErrors: string[] = [];
async function retire(ctx: Ctx) { await sleep(200); allCalls.push(...ctx.calls); allErrors.push(...ctx.errors); ctx.close(); }

(async () => {
  // ───────────────────────── A render ─────────────────────────
  console.log('\nA. server rows with files');
  {
    const live = [
      serverRow(M1, 'Photo and the plan', [
        { id: P1, name: 'Kitchen.jpg', mime: 'image/jpeg', size: 245000, kind: 'image', width: 1600, height: 1200, path: STORAGE_KEY_IN_ROW },
        { id: D1, name: XSS_NAME, mime: 'application/pdf', size: 2516582, kind: 'pdf' },
      ], 'gc'),
      serverRow(M2, '', [{ id: P2, name: 'two.jpg', mime: 'image/jpeg', size: 1000, kind: 'image' }], 'gc'),
      serverRow(M3, 'third', [{ id: P3, name: 'three.jpg', mime: 'image/jpeg', size: 1000, kind: 'image' }], 'gc'),
    ];
    const ctx = await boot({
      live,
      fn: (b) => {
        if (b.action === 'urls') return { status: 200, body: { urls: { [P1]: SIGNED_P1, [D1]: SIGNED_D1, [P2]: 'javascript:alert(1)', [P3]: 'https://evil.example/p3.jpg' } } };
        if (b.action === 'download') return { status: 200, body: { url: DOWNLOAD_D1 } };
        return undefined;
      },
    });
    await waitFor(() => !!ctx.d.querySelector(`img[data-msg-att="${P1}"][src]`));
    const urlsCalls = ctx.fnCalls('urls');
    ok('one urls POST for the thread', urlsCalls.length === 1, urlsCalls.length);
    const b = urlsCalls[0]?.body ?? {};
    ok('…its body carries portalId, token and the message ids', b.portalId === 'pid' && b.token === 'tok' && Array.isArray(b.messageIds) && b.messageIds.includes(M1));
    ok('…and the token is not in its URL', !!urlsCalls[0] && urlsCalls[0].url === FN, urlsCalls[0]?.url);
    ok('the photo img gets the signed https URL', ctx.d.querySelector(`img[data-msg-att="${P1}"]`)?.getAttribute('src') === SIGNED_P1);
    ok('a returned javascript: URL is not used', !ctx.d.querySelector(`img[data-msg-att="${P2}"]`)?.hasAttribute('src'));
    ok('a returned URL on another origin is not used', !ctx.d.querySelector(`img[data-msg-att="${P3}"]`)?.hasAttribute('src'));
    const pdfName = ctx.d.querySelector('#msg-thread .msg-file-pdf-name');
    ok('a hostile PDF name renders as text', pdfName?.textContent === XSS_NAME);
    ok('…and creates no element from it', ctx.d.querySelectorAll('#msg-thread .msg-file-pdf img').length === 0 && !ctx.d.querySelector('img[src="x"]'));
    ok('the PDF chip reads "PDF · 2.4 MB" with Open and Download',
      ctx.d.querySelector('#msg-thread .msg-file-pdf-meta')?.textContent === 'PDF · 2.4 MB'
      && !!ctx.d.querySelector(`[data-msg-act="open"][data-msg-att="${D1}"]`) && !!ctx.d.querySelector(`[data-msg-act="download"][data-msg-att="${D1}"]`));
    ok('a photo-only message has no empty body line', !!ctx.d.querySelector(`img[data-msg-att="${P2}"]`) && !ctx.d.querySelector(`img[data-msg-att="${P2}"]`).closest('.msg').querySelector('.msg-body'));
    const threadHtml = ctx.d.getElementById('msg-thread').innerHTML as string;
    ok('the storage key a row carried never reaches the page', !threadHtml.includes(STORAGE_KEY_IN_ROW));
    const ls = Object.keys(ctx.w.localStorage).map((k) => `${k}=${ctx.w.localStorage.getItem(k)}`).join('\n');
    ok('no storage key, signed URL or token in localStorage', !ls.includes(STORAGE_KEY_IN_ROW) && !ls.includes('token=s1') && !ls.includes('/storage/v1/') && !/"tok"|=tok\b/.test(ls), ls.slice(0, 300));
    // photo tap → lightbox
    ctx.d.querySelector(`[data-msg-act="photo"][data-msg-att="${P1}"]`)?.click();
    const lb = ctx.d.getElementById('lightbox');
    ok('a photo tap opens the lightbox on the signed URL with the name as caption',
      lb.classList.contains('open') && ctx.d.getElementById('lightbox-img').getAttribute('src') === SIGNED_P1 && ctx.d.getElementById('lightbox-cap').textContent === 'Kitchen.jpg');
    lb.classList.remove('open');
    // PDF Open
    ctx.d.querySelector(`[data-msg-act="open"][data-msg-att="${D1}"]`)?.click();
    ok('PDF Open opens a tab in the tap itself', ctx.opened.length === 1);
    await waitFor(() => ctx.opened[0]?.location.href === SIGNED_D1);
    ok('…then points it at the PDF URL from a urls POST', ctx.opened[0]?.location.href === SIGNED_D1 && ctx.fnCalls('urls').length === 2);
    ok('…with the opener cut', ctx.opened[0]?.opener === null);
    ctx.d.querySelector(`[data-msg-act="download"][data-msg-att="${D1}"]`)?.click();
    await waitFor(() => ctx.opened[1]?.location.href === DOWNLOAD_D1);
    const dl = ctx.fnCalls('download')[0]?.body ?? {};
    ok('PDF Download asks for the download URL of exactly that file', ctx.opened[1]?.location.href === DOWNLOAD_D1 && dl.messageId === M1 && dl.attachmentId === D1 && dl.token === 'tok');
    ctx.openReturnsNull = true;
    ctx.d.querySelector(`[data-msg-act="open"][data-msg-att="${D1}"]`)?.click();
    ok('a blocked pop-up says so', /blocked the new tab/.test(note(ctx)), note(ctx));
    ctx.openReturnsNull = false;
    ctx.fn = (bb) => (bb.action === 'urls' ? { status: 503, body: { error: 'unavailable' } } : undefined);
    ctx.d.querySelector(`[data-msg-act="open"][data-msg-att="${D1}"]`)?.click();
    const win = ctx.opened[ctx.opened.length - 1];
    await waitFor(() => win.closed);
    ok('an open that cannot get a URL closes the tab and says so', win.closed && /Couldn't open the file/.test(note(ctx)));
    ok('the composer offers attach with the exact accept list',
      ctx.d.getElementById('msg-file')?.getAttribute('accept') === 'image/jpeg,image/png,image/webp,application/pdf'
      && ctx.d.getElementById('msg-file')?.hasAttribute('multiple')
      && ctx.d.getElementById('msg-attach')?.getAttribute('aria-label') === 'Attach a photo or PDF');
    // pure helpers
    const T = ctx.w.__msgFilesTest;
    ok('the test hook exists under the test flag', !!T);
    if (T) {
      ok('parity: MSG_FILE_MAX_BYTES = utils/messageAttachments', T.MSG_FILE_MAX_BYTES === MESSAGE_ATTACHMENT_MAX_BYTES, T.MSG_FILE_MAX_BYTES);
      ok('parity: MSG_FILE_MAX_COUNT = utils/messageAttachments', T.MSG_FILE_MAX_COUNT === MESSAGE_ATTACHMENT_MAX_COUNT);
      ok('parity: MSG_FILE_MIMES = utils/messageAttachments', JSON.stringify(T.MSG_FILE_MIMES) === JSON.stringify(MESSAGE_ATTACHMENT_MIMES));
      ok('re-signing runs before the display URLs lapse', T.MSG_FILE_URL_REFRESH_MS === 240000 && T.MSG_FILE_URL_REFRESH_MS < MESSAGE_ATTACHMENT_URL_TTL_SECONDS * 1000);
      ok('MSG_FILE_FN is the function URL, nothing appended', T.msgFileFn() === FN, T.msgFileFn());
      const U8 = (a: number[]) => ctx.w.Uint8Array.from(a);
      const webp = [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50];
      ok('sniff: JPEG / PNG / WebP / PDF / GIF', T.msgFileSniff(U8(JPEG)) === 'image/jpeg' && T.msgFileSniff(U8(PNG)) === 'image/png'
        && T.msgFileSniff(U8(webp)) === 'image/webp' && T.msgFileSniff(U8(PDF)) === 'application/pdf' && T.msgFileSniff(U8(GIF)) === null);
      ok('check: count first, then type, empty, sniff, size',
        T.msgFileCheck({ type: 'image/gif', name: 'a.gif', size: 5 }, null, 10).reason === 'count'
        && T.msgFileCheck({ type: 'image/gif', name: 'a.gif', size: 5 }, null, 0).reason === 'type'
        && T.msgFileCheck({ type: 'image/heic', name: 'a.heic', size: 5 }, null, 0).reason === 'type'
        && T.msgFileCheck({ type: 'image/jpeg', name: 'a.jpg', size: 0 }, null, 0).reason === 'empty'
        && T.msgFileCheck({ type: 'image/jpeg', name: 'a.jpg', size: null }, U8(PNG), 0).reason === 'type'
        && T.msgFileCheck({ type: 'application/pdf', name: 'a.pdf', size: MESSAGE_ATTACHMENT_MAX_BYTES + 1 }, U8(PDF), 0).reason === 'size'
        && T.msgFileCheck({ type: '', name: 'Scan.PDF', size: 10 }, U8(PDF), 9).mime === 'application/pdf'
        && T.msgFileCheck({ type: 'image/jpg', name: 'x', size: 10 }, U8(JPEG), 0).mime === 'image/jpeg');
      ok('urlOk: https on the Supabase origin only',
        T.msgFileUrlOk(SIGNED_P1) && !T.msgFileUrlOk(SIGNED_P1.replace('https:', 'http:')) && !T.msgFileUrlOk('https://evil.example/x')
        && !T.msgFileUrlOk(`https://nteoqhcswappxxjlpvap.supabase.co.evil.example/x`) && !T.msgFileUrlOk('javascript:alert(1)')
        && !T.msgFileUrlOk('') && !T.msgFileUrlOk(null));
      ok('sizes print as "2.4 MB" / "840 KB"', T.msgFmtSize(2516582) === '2.4 MB' && T.msgFmtSize(860160) === '840 KB');
      const six = [1, 2, 3, 4, 5, 6].map((i) => ({ id: uuid(300 + i), name: `p${i}.jpg`, mime: 'image/jpeg', size: 10, kind: 'image' }));
      const h6 = T.renderAttachmentsHtml({ id: M1, attachments: six }, {});
      ok('six photos: four tiles, "+3" on the fourth, no src before signing',
        (h6.match(/<img /g) ?? []).length === 4 && h6.includes('>+3<') && !/ src=/.test(h6) && h6.includes('data-msg-act="more"'));
      const hx = T.renderAttachmentsHtml({ id: M1, attachments: [{ id: D1, name: XSS_NAME, mime: 'application/pdf', size: 10, kind: 'pdf' }, { id: P1, name: '"><b>x', mime: 'image/png', size: 10, kind: 'image' }] }, { urls: { [P1]: 'https://evil.example/a.png' } });
      ok('renderAttachmentsHtml escapes every name and refuses a foreign URL', !hx.includes('<img src=x') && !hx.includes('"><b>') && hx.includes('&lt;img src=x') && !hx.includes('evil.example'));
      const parsed = T.msgParseAttachments([{ id: P1, name: 'a.jpg', mime: 'image/jpeg', size: 5, kind: 'image', path: 'x/y/z.jpg' }, { id: 'nope', name: 'b', mime: 'image/jpeg', size: 5 }, { id: P2, name: 'c.gif', mime: 'image/gif', size: 5 }, { id: P3, name: 'd.pdf', mime: 'application/pdf', size: 5, kind: 'image' }, null, 'x']);
      ok('parseAttachments keeps the good file, drops its path and every malformed one', parsed.length === 1 && parsed[0].id === P1 && !('path' in parsed[0]));
    }
    await retire(ctx);
  }

  // A 401 while signing: the ended-link screen, and no more signing.
  console.log('\nA2. a 401 while signing');
  {
    const ctx = await boot({
      live: [serverRow(M1, 'x', [{ id: P1, name: 'k.jpg', mime: 'image/jpeg', size: 10, kind: 'image' }], 'gc')],
      fn: (b) => (b.action === 'urls' ? { status: 401, body: { error: 'denied' } } : undefined),
    });
    await waitFor(() => ctx.d.getElementById('fallback')?.style.display === 'flex');
    ok('a 401 shows the ended-link problem screen', ctx.d.getElementById('fallback')?.style.display === 'flex' && /no longer valid/.test(ctx.d.getElementById('fallback-title')?.textContent ?? ''));
    const n = ctx.fnCalls('urls').length;
    ctx.refresh();
    await sleep(300);
    ok('…and signing stops', ctx.fnCalls('urls').length === n, `${n} → ${ctx.fnCalls('urls').length}`);
    await retire(ctx);
  }

  // ───────────────────────── B pick ─────────────────────────
  console.log('\nB. picking files');
  {
    const ctx = await boot();
    pick(ctx, [file(ctx, 'Big plan.pdf', 'application/pdf', PDF, 21 * 1048576)]);
    await waitFor(() => !!note(ctx));
    ok('a 21 MB PDF is refused by size, by name', note(ctx) === 'Big plan.pdf is 21.0 MB. Files can be up to 20 MB.', note(ctx));
    ok('…and the tray stays empty', chips(ctx) === 0 && ctx.d.getElementById('msg-tray').hidden === true);
    pick(ctx, [file(ctx, 'party.gif', 'image/gif', GIF, 200)]);
    await waitFor(() => /party\.gif/.test(note(ctx)));
    ok('a GIF is refused by type', note(ctx) === 'party.gif can\'t be sent. Send a photo (JPG, PNG or WebP) or a PDF.', note(ctx));
    pick(ctx, [file(ctx, 'fake.jpg', 'image/jpeg', PNG, 200)]);
    await waitFor(() => /fake\.jpg/.test(note(ctx)));
    ok('a .jpg whose bytes are a PNG is refused by type', /^fake\.jpg can't be sent/.test(note(ctx)) && chips(ctx) === 0, note(ctx));
    pick(ctx, [file(ctx, 'empty.pdf', 'application/pdf', [], 0)]);
    await waitFor(() => /empty\.pdf/.test(note(ctx)));
    ok('an empty file is refused as empty', note(ctx) === 'empty.pdf is empty, so it can\'t be sent.', note(ctx));
    pick(ctx, [file(ctx, 'Deck.jpg', 'image/jpeg', JPEG, 5000)]);
    await waitFor(() => chips(ctx) === 1);
    ok('a real JPEG becomes a tray chip with a local preview', chips(ctx) === 1 && /^blob:/.test(ctx.d.querySelector('#msg-tray .msg-chip-img')?.getAttribute('src') ?? ''));
    ok('…the note clears and the attach badge reads 1', note(ctx) === '' && ctx.d.getElementById('msg-attach-count').textContent === '1' && !ctx.d.getElementById('msg-attach-count').hidden);
    ok('…its remove button is named for the file', ctx.d.querySelector('#msg-tray .msg-chip-x')?.getAttribute('aria-label') === 'Remove Deck.jpg');
    ctx.d.querySelector('#msg-tray .msg-chip-x')?.click();
    ok('removing the chip empties the tray and frees the preview', chips(ctx) === 0 && ctx.revoked.length === 1 && ctx.d.getElementById('msg-attach-count').hidden);
    const eleven = Array.from({ length: 11 }, (_, i) => file(ctx, `p${i + 1}.jpg`, 'image/jpeg', JPEG, 300));
    pick(ctx, eleven);
    await waitFor(() => !!note(ctx));
    ok('11 files: 10 kept, the 11th refused by count', chips(ctx) === 10 && note(ctx) === 'A message can carry up to 10 files.', `${chips(ctx)} / ${note(ctx)}`);
    await retire(ctx);
  }


  // Photos are downsized and re-encoded where the browser can decode them.
  console.log('\nB2. preparing photos');
  {
    const decodeOk = { v: true };
    const drawn: number[][] = [];
    const ctx = await boot({
      setup(w: any) {
        w.createImageBitmap = async (f: any) => {
          if (!decodeOk.v) throw new Error('cannot decode');
          return f.size > 4 * 1048576 ? { width: 4000, height: 3000, close() {} } : { width: 1200, height: 800, close() {} };
        };
        w.Image = class { onload: any; onerror: any; naturalWidth = 0; naturalHeight = 0; set src(_v: string) { setTimeout(() => this.onerror && this.onerror(), 0); } };
        w.HTMLCanvasElement.prototype.getContext = function () { return { fillRect() {}, drawImage: (_s: any, _x: number, _y: number, cw: number, ch: number) => { drawn.push([cw, ch]); } }; };
        w.HTMLCanvasElement.prototype.toBlob = function (cb: any) { cb(new w.Blob([w.Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3])], { type: 'image/jpeg' })); };
      },
    });
    pick(ctx, [file(ctx, 'Shot.png', 'image/png', PNG, 5 * 1048576)]);
    await waitFor(() => chips(ctx) === 1);
    ok('a big photo is drawn at most 2560 px on the long edge', JSON.stringify(drawn[0]) === JSON.stringify([2560, 1920]), drawn);
    pick(ctx, [file(ctx, 'Screen.png', 'image/png', PNG, 300000)]);
    await waitFor(() => chips(ctx) === 2);
    ok('a PNG of 4 MB or less is kept as it is (not redrawn)', drawn.length === 1);
    decodeOk.v = false;
    pick(ctx, [file(ctx, 'Odd.jpg', 'image/jpeg', JPEG, 3000)]);
    await waitFor(() => !!note(ctx));
    ok('a photo no decoder can read is refused as decode', note(ctx) === 'This photo type can\'t be sent from this browser. Save it as a JPG, then attach it.' && chips(ctx) === 2, note(ctx));
    typeAndSend(ctx, 'Screens');
    await waitFor(() => ctx.fnCalls('upload').length === 2);
    const files = ctx.fnCalls('upload').map((c) => c.body.file);
    const big = files.find((f: any) => /^Shot/.test(f.name));
    const small = files.find((f: any) => /^Screen/.test(f.name));
    ok('…the redrawn photo travels as Shot.jpg, image/jpeg, the new size', !!big && big.name === 'Shot.jpg' && big.mime === 'image/jpeg' && big.size === 7);
    ok('…the small PNG travels as itself', !!small && small.name === 'Screen.png' && small.mime === 'image/png' && small.size === 300000);
    await waitFor(() => ctx.xhrs.length === 2);
    ctx.xhrs.forEach((x: any) => x.finish(200));
    await waitFor(() => ctx.fnCalls('send').length === 1);
    const sf = ctx.fnCalls('send')[0]?.body.files ?? [];
    ok('…and send carries the drawn width and height', sf.some((f: any) => f.name === 'Shot.jpg' && f.width === 2560 && f.height === 1920) && sf.some((f: any) => f.name === 'Screen.png' && f.width === 1200 && f.height === 800));
    await retire(ctx);
  }

  // ───────────────────────── C send ─────────────────────────
  console.log('\nC. sending with files');
  {
    const ctx = await boot();
    const jpgSize = 6000, pdfSize = 4000;
    pick(ctx, [file(ctx, 'Deck.jpg', 'image/jpeg', JPEG, jpgSize), file(ctx, 'Quote.pdf', 'application/pdf', PDF, pdfSize)]);
    await waitFor(() => chips(ctx) === 2);
    const before = ctx.d.querySelectorAll('#msg-thread .msg').length;
    typeAndSend(ctx, 'Here are the photos');
    await waitFor(() => ctx.xhrs.length === 2);
    const ups = ctx.fnCalls('upload');
    ok('two upload POSTs, each with the token in the body only', ups.length === 2 && ups.every((c) => c.url === FN && c.body.token === 'tok' && c.body.portalId === 'pid'));
    const msgId = ups[0]?.body.messageId;
    ok('one message id for both files, one file id each', !!msgId && ups[1]?.body.messageId === msgId && ups[0].body.file.id !== ups[1].body.file.id);
    ok('then two XHR PUTs to the signed upload URLs', ctx.xhrs.length === 2 && ctx.xhrs.every((x: any) => x.method === 'PUT' && x.url.startsWith(SUPA + '/storage/v1/object/upload/sign/')));
    ok('…each upload POST before its PUT', ups.every((c) => {
      const iFn = ctx.log.indexOf(`fn:upload:${c.body.file.id}`);
      const iPut = ctx.log.findIndex((l) => l.startsWith('put:') && l.includes(c.body.file.id));
      return iFn > -1 && iPut > iFn;
    }), ctx.log);
    const fd = ctx.xhrs[0]?.body;
    ok('…FormData with cacheControl 3600 and the file under the "" field, x-upsert false',
      !!fd && fd.get('cacheControl') === '3600' && !!fd.get('') && ctx.xhrs.every((x: any) => x.headers['x-upsert'] === 'false'));
    const types = ctx.xhrs.map((x: any) => x.body.get('').type).sort();
    ok('…each blob carries its checked type', JSON.stringify(types) === JSON.stringify(['application/pdf', 'image/jpeg']), types);
    ok('the composer clears: tray and text', chips(ctx) === 0 && ctx.d.getElementById('msg-input').value === '');
    const bubble = () => ctx.d.querySelector(`#msg-thread .msg.pending[data-msg-id="${msgId}"]`);
    ok('the pending bubble is drawn at once with the text and both files', !!bubble() && /Here are the photos/.test(bubble().textContent)
      && bubble().querySelectorAll('img.msg-file-img').length === 1 && bubble().querySelectorAll('.msg-file-pdf').length === 1
      && ctx.d.querySelectorAll('#msg-thread .msg').length === before + 1);
    const jx = ctx.xhrs.find((x: any) => x.body.get('').type === 'image/jpeg');
    const px = ctx.xhrs.find((x: any) => x.body.get('').type === 'application/pdf');
    jx?.progress(50, 100);
    const pct = Math.floor((jpgSize * 0.5) * 100 / (jpgSize + pdfSize));
    ok(`real progress: "Uploading… ${pct}%" over the message's bytes`, bubble()?.querySelector('.msg-status')?.textContent === `Uploading… ${pct}%`, bubble()?.querySelector('.msg-status')?.textContent);
    ok('while uploading: no time, no "just now"', !bubble().querySelector('.msg-time') && !/just now|min ago|recently/.test(bubble().textContent));
    ok('the pending record is in localStorage: text and names only', (() => {
      const raw = ctx.w.localStorage.getItem('mage_portal_pending_files_pid') || '';
      return raw.includes(msgId) && raw.includes('Here are the photos') && !raw.includes('blob:') && !raw.includes('token') && !raw.includes('/storage/');
    })());
    jx?.finish(200);
    await sleep(60);
    ok('no send while one upload is still running', ctx.fnCalls('send').length === 0);
    px?.progress(100, 100);
    px?.finish(200);
    await waitFor(() => ctx.fnCalls('send').length === 1);
    const sends = ctx.fnCalls('send');
    const sendIdx = ctx.log.findIndex((l) => l.startsWith('fn:send'));
    const lastDone = Math.max(...ctx.log.map((l, i) => (l.startsWith('done:') ? i : -1)));
    ok('ONE send POST, after the last upload finished', sends.length === 1 && sendIdx > lastDone, ctx.log);
    const sb = sends[0]?.body ?? {};
    ok('…carrying the id, text, author and both files', sb.messageId === msgId && sb.body === 'Here are the photos' && sb.authorName === 'Dana Client'
      && Array.isArray(sb.files) && sb.files.length === 2 && sb.files.every((f: any) => ups.some((u) => u.body.file.id === f.id && u.body.file.size === f.size)));
    await waitFor(() => bubble()?.querySelector('.msg-status')?.textContent === 'Sending…');
    ok('the server took it: "Sending…" until the row paints, still no time', bubble()?.querySelector('.msg-status')?.textContent === 'Sending…' && !bubble().querySelector('.msg-time'));
    ctx.live = [serverRow(msgId, 'Here are the photos', sb.files.map((f: any) => ({ ...f, kind: f.mime === 'application/pdf' ? 'pdf' : 'image' })))];
    ctx.refresh();
    await waitFor(() => !bubble());
    const withText = [...ctx.d.querySelectorAll('#msg-thread .msg')].filter((m: any) => /Here are the photos/.test(m.textContent));
    ok('the server row (same id) replaces the pending bubble: one bubble', !bubble() && withText.length === 1 && !!withText[0].querySelector('.msg-time') && pendingBubbles(ctx).length === 0, withText.length);
    ok('…the pending record is gone and the previews are freed', !ctx.w.localStorage.getItem('mage_portal_pending_files_pid') && ctx.revoked.length >= 1);
    // M6 + mutation 8: two file-only messages, the server has only the first.
    pick(ctx, [file(ctx, 'One.jpg', 'image/jpeg', JPEG, 900)]);
    await waitFor(() => chips(ctx) === 1);
    typeAndSend(ctx, '');
    await waitFor(() => ctx.xhrs.length === 3);
    ok('a message with files and no text is allowed', pendingBubbles(ctx).length === 1);
    ctx.xhrs[2]?.finish(200);
    await waitFor(() => ctx.fnCalls('send').length === 2);
    pick(ctx, [file(ctx, 'Two.jpg', 'image/jpeg', JPEG, 900)]);
    await waitFor(() => chips(ctx) === 1);
    typeAndSend(ctx, '');
    await waitFor(() => ctx.xhrs.length === 4);
    ctx.xhrs[3]?.finish(200);
    await waitFor(() => ctx.fnCalls('send').length === 3);
    const e1 = ctx.fnCalls('send')[1]?.body ?? {}, e2 = ctx.fnCalls('send')[2]?.body ?? {};
    ok('…its send carries body ""', e1.body === '' && e2.body === '');
    ctx.live = ctx.live.concat([serverRow(e1.messageId, '', (e1.files ?? []).map((f: any) => ({ ...f, kind: 'image' })))]);
    ctx.refresh();
    await waitFor(() => !ctx.d.querySelector(`#msg-thread .msg.pending[data-msg-id="${e1.messageId}"]`));
    ok('file messages settle by id: the first is replaced, the second (same empty text) still pending',
      !ctx.d.querySelector(`#msg-thread .msg.pending[data-msg-id="${e1.messageId}"]`) && !!ctx.d.querySelector(`#msg-thread .msg.pending[data-msg-id="${e2.messageId}"]`)
      && pendingBubbles(ctx).length === 1);
    // text-only keeps portal_post_message
    const fnBefore = ctx.fnCalls().length;
    typeAndSend(ctx, 'Just text');
    await waitFor(() => ctx.calls.some((c) => c.url.includes('portal_post_message')));
    ok('text-only: the portal_post_message RPC, not portal-message-files',
      ctx.calls.filter((c) => c.url.includes('portal_post_message')).length === 1 && ctx.fnCalls().length === fnBefore
      && ctx.calls.find((c) => c.url.includes('portal_post_message'))?.body.p_access_token === 'tok');
    await retire(ctx);
  }

  // ───────────────────────── D failures ─────────────────────────
  console.log('\nD. failures');
  {
    const ctx = await boot();
    pick(ctx, [file(ctx, 'A.jpg', 'image/jpeg', JPEG, 1000), file(ctx, 'B.jpg', 'image/jpeg', JPEG, 1000)]);
    await waitFor(() => chips(ctx) === 2);
    typeAndSend(ctx, 'Two photos');
    await waitFor(() => ctx.xhrs.length === 2);
    const msgId = ctx.fnCalls('upload')[0]?.body.messageId;
    const failedId = ctx.fnCalls('upload')[0]?.body.file?.id;
    ctx.xhrs[0]?.fail();
    ctx.xhrs[1]?.finish(200);
    const bubble = () => ctx.d.querySelector(`#msg-thread .msg.pending[data-msg-id="${msgId}"]`);
    await waitFor(() => !!bubble()?.classList.contains('failed'));
    ok('an XHR error: "Not sent." with the reason', !!bubble() && bubble().classList.contains('failed')
      && /Not sent\./.test(bubble().textContent) && /The upload didn't finish/.test(bubble().textContent));
    ok('…Try again and Remove, the text still in the bubble', !!bubble()?.querySelector('[data-msg-act="retry"]') && !!bubble()?.querySelector('[data-msg-act="remove"]') && /Two photos/.test(bubble()?.textContent ?? ''));
    ok('…and no send was attempted', ctx.fnCalls('send').length === 0);
    bubble()?.querySelector('[data-msg-act="retry"]')?.click();
    await waitFor(() => ctx.xhrs.length === 3);
    const reUps = ctx.fnCalls('upload').slice(2);
    ok('Try again re-uploads only the failed file', reUps.length === 1 && reUps[0].body.file.id === failedId && ctx.xhrs.length === 3, reUps.map((c) => c.body.file.id));
    ctx.xhrs[2]?.finish(200);
    await waitFor(() => ctx.fnCalls('send').length === 1);
    ok('…then sends, with both files', ctx.fnCalls('send').length === 1 && ctx.fnCalls('send')[0]?.body.files.length === 2);
    // Remove
    pick(ctx, [file(ctx, 'C.jpg', 'image/jpeg', JPEG, 1000)]);
    await waitFor(() => chips(ctx) === 1);
    typeAndSend(ctx, 'Drop me');
    await waitFor(() => ctx.xhrs.length === 4);
    const rmId = ctx.fnCalls('upload').slice(-1)[0]?.body?.messageId;
    ctx.xhrs[3]?.finish(503);
    const rm = () => ctx.d.querySelector(`#msg-thread .msg.pending[data-msg-id="${rmId}"]`);
    await waitFor(() => !!rm()?.classList.contains('failed'));
    const callsBefore = ctx.fnCalls().length;
    rm()?.querySelector('[data-msg-act="remove"]')?.click();
    await sleep(100);
    ok('Remove drops the bubble and its record, and calls nothing',
      !rm() && ctx.fnCalls().length === callsBefore && !(ctx.w.localStorage.getItem('mage_portal_pending_files_pid') || '').includes(rmId));
    await retire(ctx);
  }
  {
    const ctx = await boot();
    pick(ctx, [file(ctx, 'Off.jpg', 'image/jpeg', JPEG, 1000)]);
    await waitFor(() => chips(ctx) === 1);
    ctx.state.online = false;
    ctx.state.fnNetworkDown = true;
    typeAndSend(ctx, 'Sent from the basement');
    const bubble = () => pendingBubbles(ctx)[0];
    await waitFor(() => /Waiting for a connection/.test(bubble()?.textContent ?? ''));
    ok('offline: the waiting copy, the text kept, no time', /Waiting for a connection\. Keep this page open/.test(bubble()?.textContent ?? '')
      && /Sent from the basement/.test(bubble()?.textContent ?? '') && !bubble()?.querySelector('.msg-time'));
    ctx.state.online = true;
    ctx.state.fnNetworkDown = false;
    ctx.w.dispatchEvent(new ctx.w.Event('online'));
    await waitFor(() => ctx.xhrs.length === 1);
    ok('back online: retried without a click', ctx.fnCalls('upload').length === 1 && ctx.xhrs.length === 1);
    ctx.xhrs[0]?.finish(200);
    await waitFor(() => ctx.fnCalls('send').length === 1);
    ok('…and sent', ctx.fnCalls('send').length === 1);
    // a fetch TypeError while the browser still says online also waits
    pick(ctx, [file(ctx, 'Flaky.jpg', 'image/jpeg', JPEG, 1000)]);
    await waitFor(() => chips(ctx) === 1);
    ctx.state.fnNetworkDown = true;
    typeAndSend(ctx, 'Flaky');
    await waitFor(() => pendingBubbles(ctx).some((b: any) => /Flaky/.test(b.textContent) && /Waiting for a connection/.test(b.textContent)));
    ok('a fetch TypeError waits for a connection too', pendingBubbles(ctx).some((b: any) => /Flaky/.test(b.textContent) && /Waiting for a connection/.test(b.textContent)));
    await retire(ctx);
  }
  {
    let sendN = 0;
    const ctx = await boot({
      fn: (b) => {
        if (b.action !== 'send') return undefined;
        sendN++;
        return sendN === 1 ? { status: 422, body: { error: 'not_uploaded', ids: [b.files[0].id] } } : undefined;
      },
    });
    pick(ctx, [file(ctx, 'One.jpg', 'image/jpeg', JPEG, 1000), file(ctx, 'Two.jpg', 'image/jpeg', JPEG, 1000)]);
    await waitFor(() => chips(ctx) === 2);
    typeAndSend(ctx, 'Retry me');
    await waitFor(() => ctx.xhrs.length === 2);
    ctx.xhrs[0]?.finish(200);
    ctx.xhrs[1]?.finish(200);
    await waitFor(() => ctx.xhrs.length === 3);
    const first = ctx.fnCalls('send')[0]?.body;
    const again = ctx.fnCalls('upload').slice(2);
    ok('422 not_uploaded: exactly those ids upload again', !!first && again.length === 1 && again[0].body.file.id === first.files[0].id && ctx.xhrs.length === 3);
    ok('…and no second send before that upload finishes', ctx.fnCalls('send').length === 1);
    ctx.xhrs[2]?.finish(200);
    await waitFor(() => ctx.fnCalls('send').length === 2);
    ok('…then it sends again', ctx.fnCalls('send').length === 2);
    await retire(ctx);
  }
  {
    const ctx = await boot({ fn: (b) => (b.action === 'upload' ? { status: 401, body: { error: 'denied' } } : undefined) });
    pick(ctx, [file(ctx, 'Late.jpg', 'image/jpeg', JPEG, 1000)]);
    await waitFor(() => chips(ctx) === 1);
    typeAndSend(ctx, 'Too late');
    const bubble = () => pendingBubbles(ctx)[0];
    await waitFor(() => !!bubble()?.classList.contains('failed'));
    ok('401: "Not sent." with the ended-link copy', /Not sent\./.test(bubble()?.textContent ?? '') && /This portal link has ended\. Ask your contractor for a new one\./.test(bubble()?.textContent ?? ''));
    ctx.w.dispatchEvent(new ctx.w.Event('online'));
    await sleep(250);
    ok('…and no further calls: no PUT, no send, no auto-retry', ctx.fnCalls().length === 1 && ctx.xhrs.length === 0, ctx.fnCalls().map((c) => c.body.action));
    await retire(ctx);
  }
  {
    const ctx = await boot({ fn: (b) => (b.action === 'send' ? { status: 422, body: { error: 'file_rejected', ids: [b.files[0].id] } } : undefined) });
    pick(ctx, [file(ctx, 'Lies.pdf', 'application/pdf', PDF, 1000)]);
    await waitFor(() => chips(ctx) === 1);
    typeAndSend(ctx, 'See attached');
    await waitFor(() => ctx.xhrs.length === 1);
    ctx.xhrs[0]?.finish(200);
    await waitFor(() => !!pendingBubbles(ctx)[0]?.classList.contains('failed'));
    ok('422 file_rejected names the file', /Lies\.pdf isn't the photo or PDF it says it is, so it wasn't sent\./.test(pendingBubbles(ctx)[0]?.textContent ?? ''));
    await retire(ctx);
  }
  {
    const ctx = await boot({ fn: (b) => (b.action === 'upload' ? { status: 429, body: { error: 'rate_limited' } } : undefined) });
    pick(ctx, [file(ctx, 'Many.jpg', 'image/jpeg', JPEG, 1000)]);
    await waitFor(() => chips(ctx) === 1);
    typeAndSend(ctx, 'x');
    await waitFor(() => !!pendingBubbles(ctx)[0]?.classList.contains('failed'));
    ok('429: the busy copy', /Too many files at once\./.test(pendingBubbles(ctx)[0]?.textContent ?? ''));
    await retire(ctx);
  }

  // ───────────────────────── E reload ─────────────────────────
  console.log('\nE. reload with a pending record');
  {
    const rec = [
      { id: X_ARRIVED, body: 'This one made it', files: [{ name: 'a.jpg', size: 10, mime: 'image/jpeg' }], createdAt: '2026-10-01T10:00:00Z' },
      { id: X_LOST, body: 'Lost text', files: [{ name: 'b.jpg', size: 10, mime: 'image/jpeg' }], createdAt: '2026-10-01T10:01:00Z' },
    ];
    const ctx = await boot({
      flag: false,
      storage: { mage_portal_pending_files_pid: JSON.stringify(rec) },
      live: [serverRow(X_ARRIVED, 'This one made it', [{ id: P1, name: 'a.jpg', mime: 'image/jpeg', size: 10, kind: 'image' }])],
    });
    await waitFor(() => ctx.d.getElementById('msg-input')?.value === 'Lost text');
    ok('the lost message\'s text is back in the composer', ctx.d.getElementById('msg-input')?.value === 'Lost text');
    ok('…with the not-kept note (one message)', note(ctx) === '1 message didn\'t send before the page closed. Its text is back in the box. Attach the files again.', note(ctx));
    ok('…and both records are cleared (the arrived one silently)', !ctx.w.localStorage.getItem('mage_portal_pending_files_pid'));
    ok('production (no flag, not localhost) has no test hook', ctx.w.__msgFilesTest === undefined);
    await retire(ctx);
  }

  // ───────────────────────── F source ─────────────────────────
  console.log('\nF. source');
  {
    ok('MSG_FILE_MAX_BYTES literal = utils/messageAttachments', new RegExp(`var MSG_FILE_MAX_BYTES = ${MESSAGE_ATTACHMENT_MAX_BYTES};`).test(html));
    ok('MSG_FILE_MAX_COUNT literal = utils/messageAttachments', new RegExp(`var MSG_FILE_MAX_COUNT = ${MESSAGE_ATTACHMENT_MAX_COUNT};`).test(html));
    ok('MSG_FILE_MIMES literal = utils/messageAttachments', html.includes(`var MSG_FILE_MIMES = [${MESSAGE_ATTACHMENT_MIMES.map((m) => `'${m}'`).join(', ')}];`));
    ok('no image/heic anywhere in the page', !/image\/heic/.test(html));
    ok('no direct /rest/v1/portal_messages access', !/\/rest\/v1\/portal_messages/.test(html));
    for (const rpc of ['portal_get_snapshot', 'portal_get_messages', 'portal_mark_messages_read', 'portal_post_message', 'portal_submit_co_approval', 'portal_submit_budget_proposal']) {
      ok(`the page still calls /rpc/${rpc}`, html.includes('/rest/v1/rpc/' + rpc));
    }
    ok('the function is reached only through msgFileFn()', (html.match(/functions\/v1\/portal-message-files/g) ?? []).length === 1 && /var MSG_FILE_FN_PATH = '\/functions\/v1\/portal-message-files';/.test(html));
    ok('no signed URL is ever written to localStorage (msgFileUrls is memory only)', !/localStorage\.setItem\([^)]*msgFileUrls/.test(html));

    const COPY: Record<string, string> = {
      msgFileAttach: 'Attach a photo or PDF',
      msgFileRemove: 'Remove {name}',
      msgFileRefuseType: "{name} can't be sent. Send a photo (JPG, PNG or WebP) or a PDF.",
      msgFileRefuseSize: '{name} is {size}. Files can be up to 20 MB.',
      msgFileRefuseEmpty: "{name} is empty, so it can't be sent.",
      msgFileRefuseCount: 'A message can carry up to 10 files.',
      msgFileRefuseDecode: "This photo type can't be sent from this browser. Save it as a JPG, then attach it.",
      msgFileUploading: 'Uploading… {pct}%',
      msgFileSending: 'Sending…',
      msgFileWaiting: "Waiting for a connection. Keep this page open and it sends when you're back online.",
      msgFileNotSent: 'Not sent.',
      msgFileFailEnded: 'This portal link has ended. Ask your contractor for a new one.',
      msgFileFailBusy: 'Too many files at once. Wait a few minutes, then try again.',
      msgFileFailRejected: "{name} isn't the photo or PDF it says it is, so it wasn't sent.",
      msgFileFailServer: "The upload didn't finish. Try again when you have a good connection.",
      msgFileTryAgain: 'Try again',
      msgFileRemoveMsg: 'Remove',
      msgFileNotKeptOne: "1 message didn't send before the page closed. Its text is back in the box. Attach the files again.",
      msgFileNotKeptOther: "{count} messages didn't send before the page closed. The last one's text is back in the box. Attach the files again.",
      msgFilePhotoAlt: 'Photo {name}',
      msgFilePhotoFailed: "Couldn't load this photo. Tap to try again.",
      msgFilePdfMeta: 'PDF · {size}',
      msgFileOpen: 'Open',
      msgFileDownload: 'Download',
      msgFileOpenFailed: "Couldn't open the file. Check your connection and try again.",
      msgFilePopupBlocked: 'Your browser blocked the new tab. Allow pop-ups for this page, then try again.',
      msgFileMore: '+{count}',
    };
    const block = html.slice(html.indexOf('var FALLBACK_STRINGS = {'), html.indexOf('\n  };', html.indexOf('var FALLBACK_STRINGS = {')));
    const fallback = new Map([...block.matchAll(/^\s{4}(\w+): '((?:[^'\\]|\\.)*)',?$/gm)].map((m) => [m[1], m[2].replace(/\\'/g, "'")]));
    const drift = Object.entries(COPY).filter(([k, v]) => fallback.get(k) !== v).map(([k]) => k);
    ok('every COPY line is in FALLBACK_STRINGS, word for word', drift.length === 0, drift);
    const en = PORTAL_UI_STRINGS.en as unknown as Record<string, string>;
    const es = PORTAL_UI_STRINGS.es as unknown as Record<string, string>;
    const enDrift = Object.entries(COPY).filter(([k, v]) => en[k] !== v).map(([k]) => k);
    ok('utils/portalLanguages en carries the same English', enDrift.length === 0, enDrift);
    ok('es carries a draft for every line (keeping every {placeholder})', Object.keys(COPY).every((k) => typeof es[k] === 'string' && es[k].length > 0
      && (COPY[k].match(/\{\w+\}/g) ?? []).every((ph) => es[k].includes(ph))));
    ok('pt / zh / vi / fr omit them (English fallback)', (['pt', 'zh', 'vi', 'fr'] as const).every((l) => Object.keys(COPY).every((k) => !(k in (PORTAL_UI_STRINGS[l] as any)))));
    const BANNED = /\b(?:Oops|Whoops|Uh oh|Yay|Awesome|Magic(?:al)?|Let's|seamless(?:ly)?|effortless(?:ly)?|unlock(?:s|ed)?|powerful|robust|Simply|Easily|Click here|please)\b/i;
    const DEV = /\b(?:token|upload URL|bucket|payload|null|undefined|edge function|storage key|signed|RLS|server)\b/i;
    const lint = Object.entries(COPY).flatMap(([k, v]) => {
      const f: string[] = [];
      if (/!/.test(v)) f.push(`${k}: "!"`);
      if (BANNED.test(v)) f.push(`${k}: banned word`);
      if (DEV.test(v)) f.push(`${k}: developer word`);
      if (/\b(?:he|him|his|she|her|hers)\b/i.test(v)) f.push(`${k}: gendered`);
      if (/\.\.\./.test(v)) f.push(`${k}: three dots`);
      if (/…/.test(v) && !['msgFileUploading', 'msgFileSending'].includes(k)) f.push(`${k}: "…" outside work in progress`);
      if (/\w\(s\)/.test(v)) f.push(`${k}: "(s)" plural`);
      if (/colour|grey|cancelled|licence|favour/i.test(v)) f.push(`${k}: British spelling`);
      return f;
    });
    ok('every new line: no "!", no "please", no banned or developer words, American spelling', lint.length === 0, lint);
    ok('real plurals: one / other keys for the not-kept note', !!fallback.get('msgFileNotKeptOne') && !!fallback.get('msgFileNotKeptOther') && !/\{count\}/.test(fallback.get('msgFileNotKeptOne') ?? 'x'));
  }

  // ───────────────────────── across every run ─────────────────────────
  console.log('\nacross every scenario');
  ok('the token never appears in any request URL', !allCalls.some((c) => /[?&]t=|tok/.test(c.url.replace('https://mageid.app', ''))), allCalls.filter((c) => /tok/.test(c.url)).map((c) => c.url));
  ok('portal-message-files is only ever called at its exact URL', allCalls.filter((c) => c.url.includes('portal-message-files')).every((c) => c.url === FN));
  ok('no uncaught errors in any run', allErrors.length === 0, allErrors.slice(0, 3));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) console.log('FAILED: ' + failed.join(' | '));
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
