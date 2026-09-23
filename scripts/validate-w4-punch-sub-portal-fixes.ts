// scripts/validate-w4-punch-sub-portal-fixes.ts — wave 4, lane punch-sub-portal
//
//   #46/#53/#140  a stale or queued GC edit can't put a sub's "Mark fixed" back
//                 to Open: punch_items_guard (only a REAL reject — a later
//                 rejected_at — un-reviews a row). Executed twice in PGlite
//                 with production roles; this file pins the SQL that did it.
//   #47/#55       the sub sees WHY it came back (gcNote), never last round's
//                 note under it; sub_note = v_note; the trigger clears it on a
//                 real reject or a reassignment.
//   #48           a note being typed survives every redraw.
//   #49           already-in-Review saves the note and the page tells the truth.
//   #50           the page tells "no signal" from "link turned off" from
//                 "nothing published", with a timeout and a loading card.
//   #52           user_id / sub_note pinned for client roles; the delete
//                 creator branch needs field access.
//   carries #3 (due_date default ''), #51 (notify payload), #56 (no
//   'Unspecified' room, no invented 'Plan' sheet).
//
// Run: bun run scripts/validate-w4-punch-sub-portal-fixes.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSubPortalSnapshot, portalPunchLocation } from '../utils/subPortalSnapshot';
import type { PunchItem } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

// ── The migration ───────────────────────────────────────────────────────────
console.log('migration 20260920120000_punch_sub_portal_v2.sql:');
const sql = read('supabase', 'migrations', '20260920120000_punch_sub_portal_v2.sql');
const code = sql.replace(/--[^\n]*/g, '');
{
  check('adds punch_items.rejected_at timestamptz', /alter table public\.punch_items add column if not exists rejected_at timestamptz;/.test(code));
  check('#3 due_date gets default \'\'', /alter table public\.punch_items alter column due_date set default '';/.test(code));
  const guard = code.slice(code.indexOf('create or replace function public.punch_items_guard()'), code.indexOf('create trigger punch_items_guard'));
  check('guard is SECURITY INVOKER with an empty search_path', !/security definer/i.test(guard) && /set search_path to ''/.test(guard));
  check('a real reject = NEW.rejected_at later than OLD (or OLD null) — not rejection_note, not updated_at',
    /v_real_reject boolean := new\.rejected_at is not null\s*and \(old\.rejected_at is null or new\.rejected_at > old\.rejected_at\);/.test(guard)
    && !/rejection_note is distinct/.test(guard) && !/updated_at/.test(guard));
  check('acts on client roles only (service_role / SECURITY DEFINER pass)', /if current_user in \('authenticated', 'anon'\) then/.test(guard));
  check('#52 pins user_id and sub_note for a client', /new\.user_id := old\.user_id;\s*new\.sub_note := old\.sub_note;/.test(guard));
  check('#46 un-review without a real reject keeps status, closed_at, rejection_note, rejected_at (never raises)',
    /coalesce\(old\.status, 'open'\) = 'ready_for_review'\s*and new\.status in \('open', 'in_progress'\)\s*and not v_real_reject then\s*new\.status := old\.status;\s*new\.closed_at := old\.closed_at;\s*new\.rejection_note := old\.rejection_note;\s*new\.rejected_at := old\.rejected_at;/.test(guard)
    && !/raise/i.test(guard));
  check('the reject clock never runs backwards from a client', /if not v_real_reject then\s*new\.rejected_at := old\.rejected_at;/.test(guard));
  check('#47 sub_note cleared on a real reject or a real change of sub (linking/dropping the id on the same name, or a rename keeping the id, is not one)',
    /v_reassigned := case\s*when v_old_id is not null and v_new_id is not null then v_old_id <> v_new_id\s*else lower\(btrim\(coalesce\(old\.assigned_sub, ''\)\)\) <> lower\(btrim\(coalesce\(new\.assigned_sub, ''\)\)\)\s*end;/.test(guard)
    && /if v_real_reject or v_reassigned then\s*new\.sub_note := null;/.test(guard));
  check('rejection_note is never cleared (rework history)', !/rejection_note := null/.test(code) && !/rejection_note = null/.test(code));
  check('trigger is BEFORE UPDATE, dropped first (idempotent)',
    /drop trigger if exists punch_items_guard on public\.punch_items;\s*create trigger punch_items_guard\s*before update on public\.punch_items\s*for each row\s*execute function public\.punch_items_guard\(\);/.test(code));
  check('#52 delete creator branch needs field access; owner branch kept',
    /create policy punch_items_collab_delete on public\.punch_items\s*for delete to authenticated\s*using \(\s*\(auth\.uid\(\) = user_id and public\.can_access_project\(project_id, 'field'::text\)\)\s*or exists \(select 1 from public\.projects p/.test(code));
  check('#52 SELECT policy untouched', !/punch_items_collab_select/.test(code));
  const live = code.slice(code.indexOf('create or replace function public.sub_portal_live_punch'), code.indexOf('create or replace function public.sub_portal_get_snapshot'));
  check('#47 gcNote only on rows back on the sub', /'gcNote', case when coalesce\(o\.status, 'open'\) in \('open', 'in_progress'\)\s*then nullif\(btrim\(coalesce\(o\.rejection_note, ''\)\), ''\) end/.test(live));
  check('#56 "Unspecified" is no location', /'location', case when lower\(btrim\(coalesce\(o\.location, ''\)\)\) in \('', 'unspecified'\) then null/.test(live));
  check('#56 no \'Plan\' literal in the sheet label', !/'Plan'/.test(live));
  check('cap still 60', /where o\.rn <= 60;/.test(live));
  const get = code.slice(code.indexOf('create or replace function public.sub_portal_get_snapshot'), code.indexOf('create or replace function public.sub_portal_mark_punch_ready'));
  check('#50 a denied read is errcode 42501', /raise exception 'sub_portal_denied' using errcode = '42501';/.test(get));
  check('get_snapshot grants kept', /grant execute on function public\.sub_portal_get_snapshot\(text, text\) to anon, authenticated, service_role;/.test(code));
  const mark = code.slice(code.indexOf('create or replace function public.sub_portal_mark_punch_ready'), code.indexOf('create or replace function public.trg_notify_punch_marked_ready'));
  check('#55 sub_note = v_note (no coalesce)', /set status = 'ready_for_review',\s*sub_note = v_note,/.test(mark) && !/coalesce\(v_note, sub_note\)/.test(mark));
  check('#49 the already branch saves a new note without setting the notify flag',
    /if v_note is not null then\s*update public\.punch_items\s*set sub_note = v_note,/.test(mark)
    && mark.indexOf("set_config('mageid.punch_ready_sub'") > mark.indexOf("'already', true, 'note_added', false"));
  check('#49 a resend of the SAME stored note answers note_added true (it is with the GC) without a write',
    /if v_note is not null and v_note is not distinct from v_item\.sub_note then\s*return jsonb_build_object\('ok', true, 'status', 'ready_for_review', 'already', true, 'note_added', true\);/.test(mark));
  check('#49 answers {ok, already, note_added} on every path',
    /'already', true, 'note_added', true/.test(mark) && /'already', true, 'note_added', false/.test(mark) && /'already', false, 'note_added', v_note is not null/.test(mark));
  check('#55 stored snapshot: subNote replaced or removed, gcNote dropped', /\(e - 'subNote' - 'gcNote'\) \|\| jsonb_build_object\('status', 'ready_for_review'\)/.test(mark));
  check('mark-ready grants kept', /grant execute on function public\.sub_portal_mark_punch_ready\(text, text, text, text\) to anon, authenticated, service_role;/.test(code));
  check('#51 notify payload adds description, location, sub_note (CONTRACT 10)',
    /'punch_item_id', new\.id::text,\s*'sub_name', v_sub,\s*'description',[\s\S]*?'location',[\s\S]*?'sub_note',/.test(code));
  check('the shipped 20260919200000 file is not edited (its Narrow caveat is retired HERE)',
    /A GC edit of the same item that was queued offline BEFORE the sub marked/.test(read('supabase', 'migrations', '20260919200000_punch_sub_portal.sql'))
    && /That caveat is\s*--\s*retired/.test(sql));
}

// ── The snapshot builder (hash copy) ────────────────────────────────────────
console.log('\nutils/subPortalSnapshot.ts:');
{
  const ABC = { id: 'sub-abc', companyName: 'ABC Electric', trade: 'Electrical' };
  let seq = 0;
  const item = (o: Partial<PunchItem>): PunchItem => ({
    id: `i${++seq}`, projectId: 'p1', description: `item ${seq}`, location: '', assignedSub: 'ABC Electric', assignedSubId: ABC.id,
    dueDate: '', priority: 'medium', status: 'open', createdAt: `2026-09-0${seq}T00:00:00Z`, updatedAt: '', ...o,
  } as PunchItem);
  const snap = buildSubPortalSnapshot({
    link: { id: 'l1' } as never, project: { id: 'p1', name: 'Job' } as never, sub: ABC as never, commitments: [],
    punchItems: [
      item({ description: 'sent back', status: 'open', rejectionNote: 'Cover cracked', subNote: 'swapped the cover', location: 'Unspecified', planSheetId: 'sh-empty' }),
      item({ description: 'in review', status: 'ready_for_review', rejectionNote: 'old round', subNote: 'fixed again', location: 'Hall bath', planSheetId: 'sh-missing' }),
      item({ description: 'fresh', status: 'open', location: '  unspecified ' }),
    ],
    planSheets: [{ id: 'sh-empty', name: '', sheetNumber: '' }],
  });
  const rows = snap.punchItems ?? [];
  const by = (d: string) => rows.find(r => r.description === d);
  check('#47 a row back on the sub carries gcNote and NOT last round\'s note',
    by('sent back')?.gcNote === 'Cover cracked' && by('sent back')?.subNote === undefined, JSON.stringify(by('sent back')));
  check('#47 a row in Review carries its note and no gcNote', by('in review')?.subNote === 'fixed again' && by('in review')?.gcNote === undefined);
  check('#56 "Unspecified" (any case/space) is no location; a real room stays',
    by('sent back')?.location === undefined && by('fresh')?.location === undefined && by('in review')?.location === 'Hall bath');
  check('#56 no invented "Plan": unnamed and missing sheets have no sheetLabel, keep planSheetId',
    by('sent back')?.planSheetId === 'sh-empty' && by('sent back')?.sheetLabel === undefined
      && by('in review')?.planSheetId === 'sh-missing' && by('in review')?.sheetLabel === undefined, JSON.stringify(rows.map(r => r.sheetLabel)));
  check('portalPunchLocation', portalPunchLocation('UNSPECIFIED') === undefined && portalPunchLocation(' Kitchen ') === 'Kitchen' && portalPunchLocation(undefined) === undefined);
}

// ── The page ────────────────────────────────────────────────────────────────
console.log('\nmarketing/sub-portal/index.html — punch rows, drafts, the mark answer:');
const html = read('marketing', 'sub-portal', 'index.html');
function lift(name: string): string {
  const i = html.indexOf(`  function ${name}(`);
  if (i < 0) throw new Error(`no function ${name}`);
  let depth = 0, j = html.indexOf('{', i);
  for (; j < html.length; j++) { if (html[j] === '{') depth++; else if (html[j] === '}' && --depth === 0) break; }
  return html.slice(i, j + 1);
}
const helpers = ['esc', 'fmtDate', 'parseCalendarDate', 'fmtCalendarDay'].map(lift).join('\n');

type Listener = (e: { target: unknown }) => void;
function fakeDom() {
  const sec = { innerHTML: '' };
  const listeners: Record<string, Listener[]> = {};
  const doc = {
    getElementById: () => sec,
    querySelector: () => null,
    addEventListener: (type: string, fn: Listener) => { (listeners[type] ||= []).push(fn); },
  };
  const el = (attrs: Record<string, string>, value?: string) => ({ value, getAttribute: (k: string) => attrs[k] ?? null });
  const fire = (type: string, target: unknown) => (listeners[type] || []).forEach(fn => fn({ target }));
  return { sec, doc, el, fire };
}
const tick = () => new Promise(r => setTimeout(r, 0));

{
  const start = html.indexOf('  var punchState = {');
  const end = html.indexOf('  // ───────── Render: Schedule slice');
  const block = html.slice(start, end);
  type Api = { renderPunch: (d: unknown) => void; punchState: { items: Record<string, unknown>[] } };
  const make = (fetchImpl: (url: string, init: { body: string }) => Promise<unknown>) => {
    const dom = fakeDom();
    const body = `${helpers}
      var SUPABASE_URL_PUBLIC = 'https://x.supabase.co', SUPABASE_ANON_PUBLIC = 'anon';
      function getSubToken(){return 'tok';}
      function parseSubPortalIdFromPath(){return 'l1';}
      ${block}
      return { renderPunch: renderPunch, punchState: punchState };`;
    const api = new Function('document', 'fetch', 'AbortController', body)(dom.doc, fetchImpl, AbortController) as Api;
    return { ...dom, api };
  };
  const data = (items: unknown[]) => ({ company: { name: 'Acme Builders' }, punchLiveAt: '2026-09-19T00:00:00Z', submitInvoice: { subPortalId: 'l1' }, punchItems: items });

  // Render: why it came back, the note label, location / sheet copy.
  const r = make(() => new Promise(() => {}));
  r.api.renderPunch(data([
    { id: 'a', description: 'outlet', status: 'open', gcNote: 'Cover is cracked, <replace>', subNote: 'stale' },
    { id: 'b', description: 'trim', status: 'in_progress', gcNote: 'Rejected — needs rework' },
    { id: 'c', description: 'waiting', status: 'ready_for_review', gcNote: 'old round', subNote: 'swapped it' },
    { id: 'd', description: 'pinned', status: 'open', planSheetId: 'sh1', location: 'Unspecified' },
    { id: 'e', description: 'named', status: 'open', planSheetId: 'sh2', sheetLabel: 'A-101', location: 'Hall bath' },
  ]));
  const out = r.sec.innerHTML;
  check('#47 "Sent back by <contractor>: <reason>", escaped', /Sent back by Acme Builders: Cover is cracked, &lt;replace&gt;/.test(out));
  check('#47 the app\'s default reads as "no reason given"', /Sent back by Acme Builders — no reason given/.test(out) && !/needs rework/.test(out));
  check('#47 no sent-back box on a row in Review; its note is labelled "Note sent with your last mark"',
    !/old round/.test(out) && /Note sent with your last mark: swapped it/.test(out));
  check('#47 last round\'s note never shows under a sent-back reason', !/stale/.test(out));
  check('#47 "Your note:" is gone', !/Your note:/.test(out));
  check('#56 no "Unspecified" room; a pinned row with no room says to check the sheet',
    !/Unspecified/.test(out) && /No room given — check the sheet/.test(out));
  check('#56 an unnamed/missing sheet says so — never "On sheet Plan"', /Pinned on a plan \(sheet not available\)/.test(out) && !/On sheet Plan/.test(out) && /On sheet A-101/.test(out));

  // #48 + #49: type, redraw, fail, keep; then the server's answer.
  let answer: () => Promise<unknown> = () => Promise.reject(new TypeError('Failed to fetch'));
  const sent: string[] = [];
  const m = make((_u, init) => { sent.push(JSON.parse(init.body).p_note); return answer(); });
  m.api.renderPunch(data([
    { id: 'a', description: 'outlet', status: 'open' },
    { id: 'b', description: 'trim', status: 'open' },
  ]));
  m.fire('click', m.el({ 'data-punch-fix': 'a' }));
  m.fire('input', m.el({ 'data-note-for': 'a' }, 'swapped cover plate, see panel label'));
  m.fire('click', m.el({ 'data-punch-fix': 'b' }));
  check('#48 Mark fixed on another row keeps A\'s note in its box', /data-note-for="a"[^>]*>swapped cover plate, see panel label<\/textarea>/.test(m.sec.innerHTML));
  m.fire('click', m.el({ 'data-punch-cancel': 'b' }));
  check('#48 Cancel on another row keeps A\'s note', /swapped cover plate, see panel label<\/textarea>/.test(m.sec.innerHTML));
  m.fire('click', m.el({ 'data-punch-send': 'a' }));
  check('#48 the box is disabled while sending', /data-note-for="a"[^>]*disabled>/.test(m.sec.innerHTML));
  await tick(); await tick();
  check('#48 a failed send keeps the note and says so in words (not "Failed to fetch")',
    /swapped cover plate, see panel label<\/textarea>/.test(m.sec.innerHTML) && /your note is kept/.test(m.sec.innerHTML) && !/Failed to fetch/.test(m.sec.innerHTML), m.sec.innerHTML.slice(0, 400));
  // Retry: the first send landed but its answer was lost → the RPC says already.
  answer = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, already: true, note_added: false }) });
  m.fire('click', m.el({ 'data-punch-send': 'a' }));
  await tick(); await tick();
  check('#49 retry sends the kept note', sent[1] === 'swapped cover plate, see panel label', JSON.stringify(sent));
  check('#49 already + note not added: the page says it was not added, and does not show it as his note',
    /Already marked fixed — your note was not added/.test(m.sec.innerHTML) && !/Note sent with your last mark: swapped/.test(m.sec.innerHTML));
  check('#48 the draft is cleared once the server answered', !/swapped cover plate, see panel label<\/textarea>/.test(m.sec.innerHTML));
  answer = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, already: true, note_added: true }) });
  m.fire('click', m.el({ 'data-punch-fix': 'b' }));
  m.fire('input', m.el({ 'data-note-for': 'b' }, 'used 5/8 type X'));
  m.fire('click', m.el({ 'data-punch-send': 'b' }));
  await tick(); await tick();
  check('#49 already + note added: says so and shows it', /your note was added for Acme Builders/.test(m.sec.innerHTML) && /Note sent with your last mark: used 5\/8 type X/.test(m.sec.innerHTML));
  const a = m.api.punchState.items.find(i => i.id === 'a');
  check('#49 the optimistic item never claims a note the server dropped', a?.subNote === undefined && a?.status === 'ready_for_review');
}

// ── Boot: the tagged server answer (#50) ────────────────────────────────────
console.log('\nmarketing/sub-portal/index.html — boot (#50):');
{
  const start = html.indexOf('  // #50 One card, told apart by kind.');
  const end = html.indexOf('})();\n</script>');
  const boot = html.slice(start, end);
  type Resp = { status: number; ok: boolean; json: () => Promise<unknown>; text: () => Promise<string> };
  const resp = (status: number, body: unknown): Resp => ({
    status, ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body), text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  });
  async function run(opts: { hash?: unknown; token?: string; path?: string; fetch: (url: string, init: { signal?: AbortSignal }) => Promise<Resp>; fireTimeout?: boolean }) {
    const els: Record<string, { style: Record<string, string>; textContent: string; disabled?: boolean; addEventListener: (t: string, f: () => void) => void }> = {};
    const get = (id: string) => (els[id] ||= { style: { display: 'none' }, textContent: id === 'fallback-title' ? 'This link is incomplete' : id === 'fallback-text' ? 'no id' : '', addEventListener: () => {} });
    const rendered: Record<string, unknown>[] = [];
    let reloaded = false;
    const body = `
      var punchState = { frozenWhy: null };
      function renderPunchSection() {}
      function getSubToken() { return ${JSON.stringify(opts.token ?? 'tok')}; }
      ${boot}
    `;
    new Function('document', 'window', 'fetch', 'decodeHash', 'runGate', 'render', 'setTimeout', 'clearTimeout', 'AbortController', body)(
      { getElementById: get, addEventListener: () => {} },
      { location: { pathname: opts.path ?? '/sub-portal/L-1', reload: () => { reloaded = true; } } },
      opts.fetch,
      () => opts.hash ?? null,
      (_d: unknown, onPass: () => void) => onPass(),
      (d: Record<string, unknown>) => rendered.push(d),
      (fn: () => void) => { if (opts.fireTimeout) queueMicrotask(fn); return 1; },
      () => {},
      AbortController,
    );
    for (let i = 0; i < 6; i++) await tick();
    return { title: get('fallback-title').textContent, text: get('fallback-text').textContent, card: get('fallback').style.display, retry: get('fallback-retry').style.display, rendered, reloaded };
  }
  const HASH = { company: { name: 'Acme Builders' }, snapshotAt: '2026-09-01T00:00:00Z', punchItems: [] };

  let r = await run({ fetch: () => Promise.reject(new TypeError('Failed to fetch')) });
  check('short link + no signal → "Couldn\'t reach the server" with Try again, never "expired"',
    /Couldn’t reach the server/.test(r.title) && r.retry === 'block' && !/expired/i.test(r.title + r.text) && r.rendered.length === 0, r.title);
  r = await run({ fetch: () => Promise.resolve(resp(401, { code: '42501', message: 'sub_portal_denied' })) });
  check('short link + 401 → "turned off or replaced"', /turned off or replaced/.test(r.title) && r.retry === 'none' && r.rendered.length === 0, r.title);
  r = await run({ hash: HASH, fetch: () => Promise.resolve(resp(400, { code: 'P0001', message: 'sub_portal_denied' })) });
  check('long link + a denial (old server: 400 + message) → denied card, the frozen copy NOT rendered',
    /turned off or replaced/.test(r.title) && /Acme Builders/.test(r.text) && r.rendered.length === 0, `${r.title} / ${r.text}`);
  r = await run({ hash: HASH, fetch: () => Promise.reject(new TypeError('Load failed')) });
  check('long link + no signal → the hash renders, marked frozen for the network',
    r.rendered.length === 1 && r.rendered[0].__frozenWhy === 'network' && r.card === 'none');
  r = await run({ hash: HASH, fetch: () => Promise.resolve(resp(503, 'upstream')) });
  check('a 5xx is "network", not "turned off"', r.rendered.length === 1 && r.rendered[0].__frozenWhy === 'network');
  r = await run({ hash: HASH, fetch: () => Promise.resolve(resp(200, { live: true, punchItems: [] })) });
  check('ok → the server copy renders, not the hash', r.rendered.length === 1 && r.rendered[0].live === true && r.card === 'none');
  r = await run({ fetch: () => Promise.resolve(resp(200, null)) });
  check('200 null, no hash → "Nothing published yet"', /Nothing published yet/.test(r.title) && /^Your contractor/.test(r.text), `${r.title} / ${r.text}`);
  r = await run({
    fireTimeout: true,
    fetch: (_u, init) => new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))),
  });
  check('a hung request is aborted by the timeout → network card', /Couldn’t reach the server/.test(r.title), r.title);
  check('the timeout is ~10 s and the request carries the abort signal',
    /var SNAPSHOT_TIMEOUT_MS = 10000;/.test(boot) && /signal: ctl \? ctl\.signal : undefined,/.test(boot));
  r = await run({ hash: HASH, token: '', path: '/sub-portal/' , fetch: () => Promise.reject(new Error('must not fetch')) });
  check('a tokenless hash link renders its copy as "the copy saved in this link"', r.rendered.length === 1 && r.rendered[0].__frozenWhy === 'hash_only');
  r = await run({ token: '', path: '/x', fetch: () => Promise.reject(new Error('must not fetch')) });
  check('nothing at all → "This link is incomplete" (not "expired")', r.title === 'This link is incomplete' && r.card === 'flex');
  check('a loading card shows while the server read is in flight', /if \(subPortalIdFromPath && getSubToken\(\)\) \{\s*showCard\('loading'\);/.test(boot));
  check('the old "Sub portal link expired" heading is gone', !/Sub portal link expired/.test(html));
}

console.log(fail ? `\n✗ validate-w4-punch-sub-portal-fixes: ${fail} failure(s)` : `\nall w4 punch-sub-portal checks passed (${pass})`);
if (fail) process.exit(1);
