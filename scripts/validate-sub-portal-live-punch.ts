// scripts/validate-sub-portal-live-punch.ts — wave 3, lane punch (#16, #17, #107, #108, #109)
//
// The sub's portal punch list: live, honest about its size, groups what is on
// him apart from what waits on the GC, carries the plan pin (never a device
// file://), and lets him say "fixed".
//
//   #17  the page reads the server FIRST when the link has ?t= and an id; the
//        hash is only a fallback. The server read merges punch_items LIVE.
//        Copy/Share/Email hand out the short link once the server copy is
//        known written; the upsert goes through the offline queue.
//   #16  a token-gated sub_portal_mark_punch_ready + a "Mark fixed" button.
//   #107 photoStoragePath / planSheetId / sheetLabel / pinX / pinY in the
//        snapshot; the portal row says "On sheet A-101" or "Not pinned".
//   #108 the edit sheet no longer claims the sub sees the photo.
//   #109 sort before the cap, punchTotal, a "Waiting on … to verify" group, and
//        the banner counts through the same scopePunchForSub.
//
// Run: bun run scripts/validate-sub-portal-live-punch.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSubPortalSnapshot, scopePunchForSub, punchIsOnSub, SUB_PORTAL_PUNCH_CAP,
} from '../utils/subPortalSnapshot';
import type { PunchItem } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

const ABC = { id: 'sub-abc', companyName: 'ABC Electric', trade: 'Electrical' };
const P = 'p1';
let seq = 0;
const item = (o: Partial<PunchItem>): PunchItem => ({
  id: `i${++seq}`, projectId: P, description: `item ${seq}`, location: '', assignedSub: 'ABC Electric', assignedSubId: ABC.id,
  dueDate: '', priority: 'medium', status: 'open', createdAt: `2026-09-0${Math.min(9, seq)}T00:00:00Z`, updatedAt: '', ...o,
} as PunchItem);

console.log('scopePunchForSub — one rule for the portal and the banner (#109):');
{
  seq = 0;
  const items = [
    item({ priority: 'low', dueDate: '2026-09-30', description: 'low late-due' }),
    item({ priority: 'high', dueDate: '2026-09-20', description: 'high early' }),
    item({ priority: 'high', dueDate: 'Fri', description: 'high unreadable due' }),
    item({ priority: 'high', status: 'ready_for_review', description: 'waiting' }),
    item({ priority: 'high', status: 'closed', description: 'closed' }),
    item({ priority: 'high', projectId: 'other', description: 'other job' }),
    item({ priority: 'high', assignedSub: 'Rivera Drywall', description: 'reassigned (stale id)' }),
    item({ priority: 'medium', assignedSub: ' abc electric ', assignedSubId: undefined, description: 'legacy by name' }),
  ];
  const scoped = scopePunchForSub(items, ABC, P).map(i => i.description);
  check('on-him first; priority high→low; earliest due; unreadable due after readable; waiting last',
    scoped.join('|') === 'high early|high unreadable due|legacy by name|low late-due|waiting', scoped.join('|'));
  check('closed, other-job and reassigned rows are out', !scoped.some(d => /closed|other job|reassigned/.test(d)));
  check('punchIsOnSub: open/in_progress yes, ready_for_review no',
    punchIsOnSub({ status: 'open' }) && punchIsOnSub({ status: 'in_progress' }) && !punchIsOnSub({ status: 'ready_for_review' }));
}

console.log('\nbuildSubPortalSnapshot — sorted BEFORE the cap, with the total (#109), pin + path, never a file:// (#107):');
{
  seq = 0;
  const many: PunchItem[] = [];
  // 70 low-priority early items, then 5 high-priority items created LAST: a
  // cap before the sort dropped exactly the urgent ones.
  for (let i = 0; i < 70; i++) many.push(item({ priority: 'low', createdAt: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}Z` }));
  for (let i = 0; i < 5; i++) many.push(item({ priority: 'high', description: `urgent ${i}`, createdAt: '2026-09-17T00:00:00Z' }));
  many.push(item({
    priority: 'high', description: 'pinned', createdAt: '2026-09-18T00:00:00Z',
    photoUri: 'file:///var/mobile/x.jpg', photoStoragePath: 'u1/p1/punch-x.jpg', planSheetId: 'sh1', pinX: 0.2, pinY: 0.7,
  }));
  many.push(item({ priority: 'high', description: 'device only photo', photoUri: 'file:///var/mobile/y.jpg', createdAt: '2026-09-18T00:00:01Z' }));
  const snap = buildSubPortalSnapshot({
    link: { id: 'l1' } as never, project: { id: P, name: 'Job' } as never, sub: ABC as never, commitments: [],
    punchItems: many, planSheets: [{ id: 'sh1', name: 'Level 2', sheetNumber: 'A-101' }],
  });
  const rows = snap.punchItems ?? [];
  check(`capped at SUB_PORTAL_PUNCH_CAP (${SUB_PORTAL_PUNCH_CAP}) with punchTotal = every scoped row`,
    rows.length === SUB_PORTAL_PUNCH_CAP && snap.punchTotal === 77, `${rows.length}/${snap.punchTotal}`);
  check('the urgent rows created last survive the cap', ['urgent 0', 'urgent 4', 'pinned'].every(d => rows.some(r => r.description === d)));
  const pinned = rows.find(r => r.description === 'pinned');
  check('pinned row carries planSheetId, sheetLabel "A-101 · Level 2", pinX/pinY and the storage path',
    !!pinned && pinned.planSheetId === 'sh1' && pinned.sheetLabel === 'A-101 · Level 2' && pinned.pinX === 0.2 && pinned.pinY === 0.7
      && pinned.photoStoragePath === 'u1/p1/punch-x.jpg', JSON.stringify(pinned));
  const json = JSON.stringify(snap);
  check('no device URI and no photoUri key anywhere in the snapshot', !/file:\/\//.test(json) && !/"photoUri"/.test(json));
  check('an unpinned row has no sheet fields', !('planSheetId' in (rows.find(r => r.description === 'device only photo') ?? {})));
}

console.log('\nthe portal page (marketing/sub-portal/index.html):');
const html = read('marketing', 'sub-portal', 'index.html');
{
  // Boot: server first with ?t= and an id; hash only as the fallback.
  const boot = html.slice(html.indexOf('var hashData = decodeHash();'));
  check('#17 with ?t= and an id the page fetches the server copy BEFORE using the hash',
    /if \(subPortalIdFromPath && getSubToken\(\)\) \{\s*fetchSubSnapshot\(subPortalIdFromPath\)\.then\(function \(fresh\) \{\s*if \(fresh\) \{ renderGated\(fresh\); return; \}\s*if \(hashData\) \{ renderGated\(hashData\); return; \}/.test(boot));
  check('#17 nothing renders the hash before the server read is tried',
    /function renderGated\(d\) \{ runGate\(d, function \(\) \{ render\(d\); \}\); \}\s*if \(subPortalIdFromPath && getSubToken\(\)\) \{/.test(boot));
  check('#17 the old "hash first, never ask the server" boot is gone', !/var data = decodeHash\(\);\s*if \(data\) \{/.test(html));
  check('#16 Mark fixed calls the token-gated RPC', /\/rest\/v1\/rpc\/sub_portal_mark_punch_ready/.test(html) && /p_access_token: token, p_punch_id: id/.test(html));
  check('#17 money is dated, not presented as live', /Contract, invoices and schedule as of <span id="snapshot-time">/.test(html));

  // Render the section for real (lifted from the page, fake DOM).
  const start = html.indexOf('  var punchState = {');
  const end = html.indexOf('  // Mark fixed → sub_portal_mark_punch_ready.');
  const helpers = ['esc', 'fmtDate', 'parseCalendarDate', 'fmtCalendarDay'].map(n => {
    const i = html.indexOf(`  function ${n}(`);
    let depth = 0, j = html.indexOf('{', i);
    for (; j < html.length; j++) { if (html[j] === '{') depth++; else if (html[j] === '}' && --depth === 0) break; }
    return html.slice(i, j + 1);
  }).join('\n');
  const sec = { innerHTML: '' };
  const body = `${helpers}\nfunction getSubToken(){return 'tok';}\nfunction parseSubPortalIdFromPath(){return 'l1';}\n${html.slice(start, end)}\nreturn { renderPunch: renderPunch };`;
  // eslint-disable-next-line no-new-func
  const api = new Function('document', body)({ getElementById: () => sec }) as { renderPunch: (d: unknown) => void };
  api.renderPunch({
    company: { name: 'Acme Builders' }, snapshotAt: '2026-09-01T00:00:00Z', punchLiveAt: '2026-09-18T12:00:00Z', punchTotal: 75,
    submitInvoice: { subPortalId: 'l1' },
    punchItems: [
      { id: 'a', description: 'outlet cover', status: 'open', priority: 'high', dueDate: '2026-10-20', planSheetId: 'sh1', sheetLabel: 'A-101', photoStoragePath: 'u/p/x.jpg' },
      { id: 'b', description: 'bad due', status: 'in_progress', dueDate: 'Fri' },
      { id: 'c', description: 'swapped', status: 'ready_for_review', subNote: 'done <b>' },
    ],
  });
  const out = sec.innerHTML;
  check('#109 "Waiting on Acme Builders to verify" is its own group, after "Still on you"',
    out.indexOf('Still on you') > -1 && out.indexOf('Waiting on Acme Builders to verify') > out.indexOf('Still on you'));
  check('#109 the header counts on-him and waiting separately', /2 still on you · 1 waiting on Acme Builders to verify/.test(out));
  check('#109 a capped list says "Showing 3 of 75"', /Showing 3 of 75/.test(out));
  check('#107 a pinned row says the sheet; an unpinned one says so', /On sheet A-101/.test(out) && /Not pinned on a plan/.test(out));
  check('#107 the photo is not drawn (private bucket) and the row says the contractor has one',
    !/<img/.test(out) && /Photo on file with Acme Builders/.test(out));
  check('#113 a free-text due date is flagged, not printed as a date', /not a date, ask your contractor/.test(out) && /Due Oct 20, 2026/.test(out));
  check('#16 open rows get Mark fixed; the waiting row does not',
    (out.match(/data-punch-fix="/g) ?? []).length === 2 && !/data-punch-fix="c"/.test(out));
  check('the sub note is escaped', /Your note: done &lt;b&gt;/.test(out));
  check('#17 live rows say they are live', /Live from Acme Builders/.test(out));
  api.renderPunch({ company: { name: 'Acme' }, snapshotAt: '2026-09-01T00:00:00Z', punchItems: [{ id: 'z', description: 'x', status: 'open' }] });
  check('#17 a hash-only (frozen) list says "As of <date>" and that it could not be refreshed',
    /As of Sep 1, 2026 — this copy could not be refreshed/.test(sec.innerHTML) || /As of Aug 31, 2026 — this copy could not be refreshed/.test(sec.innerHTML), sec.innerHTML.slice(0, 300));
}

console.log('\napp/sub-portal-setup.tsx (#17):');
{
  const setup = read('app', 'sub-portal-setup.tsx');
  check('the snapshot upsert goes through the offline queue', /supabaseWriteDetailed\('sub_portal_snapshots', 'upsert', \{/.test(setup)
    && !/\.from\('sub_portal_snapshots'\)\s*\.upsert/.test(setup));
  check('the short link is handed out only once the server copy is confirmed written',
    /if \(outcome === 'synced'\) setServerCopyFor\(link\.id\);/.test(setup)
    && /if \(!snapshot \|\| serverCopyFor === link\.id\) return buildShortSubPortalUrl\(SUB_PORTAL_BASE_URL, link\.id, link\.accessToken\);/.test(setup));
  check('plan sheets reach the snapshot for the sheet label', /planSheets: projectPlanSheets,/.test(setup));
}

console.log('\napp/punch-list.tsx (#108, #109):');
{
  const list = read('app', 'punch-list.tsx');
  check('#108 the edit sheet no longer says the sub sees the photo', !/The sub sees the plain photo/.test(list)
    && /The sub portal shows the description, location and plan sheet, not the photo or the mark/.test(list));
  check('#109 the banner count comes from scopePunchForSub, on-him rows only',
    /scopePunchForSub\(allItems, sub, projectId \?\? ''\)\.filter\(punchIsOnSub\)\.length/.test(list));
}

console.log('\nmigration 20260919200000_punch_sub_portal.sql:');
{
  const sql = read('supabase', 'migrations', '20260919200000_punch_sub_portal.sql');
  check('adds punch_items.sub_note', /alter table public\.punch_items add column if not exists sub_note text;/.test(sql));
  check('the read replaces punchItems with the live list', /'punchItems', v_live -> 'items'/.test(sql));
  check('cap in SQL equals SUB_PORTAL_PUNCH_CAP', new RegExp(`where o\\.rn <= ${SUB_PORTAL_PUNCH_CAP};`).test(sql));
  check('mark-ready checks enabled + non-empty equal token', /where id = p_sub_portal_id and enabled = true\s*and coalesce\(access_token, ''\) <> '' and access_token = p_access_token/.test(sql));
  check('mark-ready uses the same scope predicate the read publishes with',
    /not public\.sub_portal_punch_belongs\(v_item\.assigned_sub, v_item\.assigned_sub_id, v_sub\.id, v_sub\.company_name\)/.test(sql));
  check('mark-ready writes sub_note, never rejection_note', /sub_note = coalesce\(v_note, sub_note\)/.test(sql) && !/rejection_note\s*=/.test(sql));
  check('mark-ready patches the stored snapshot in the same function', /update public\.sub_portal_snapshots s\s*set snapshot = jsonb_set\(s\.snapshot, '\{punchItems\}'/.test(sql));
  check('mark-ready granted to anon; helpers revoked from anon',
    /grant execute on function public\.sub_portal_mark_punch_ready\(text, text, text, text\) to anon/.test(sql)
    && /revoke execute on function public\.sub_portal_live_punch\(text\) from public, anon, authenticated;/.test(sql));
  check('the GC is notified only for a SUB mark (transaction-local flag)',
    /set_config\('mageid\.punch_ready_sub'/.test(sql) && /current_setting\('mageid\.punch_ready_sub', true\)/.test(sql)
    && /'punch_marked_ready', 'punch_items'/.test(sql));
}

console.log(fail ? `\n✗ validate-sub-portal-live-punch: ${fail} failure(s)` : `\nall sub-portal live punch checks passed (${pass})`);
if (fail) process.exit(1);
