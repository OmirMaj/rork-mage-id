// validate-w4-integration-docs-team-server — the wave-4 integration fixes from
// the docs-team-server lens.
//
//   A. An RFI email never attaches a plan sheet it could not sign. The send
//      used `minted.get(u) ?? v.uri`, so an unsigned sheet fell through to its
//      bare durable key; on web emailService fetched that relative path, got
//      the SPA's index.html and attached it to the architect's email as a
//      ".png". rfiEmailAttachments leaves such a sheet out and counts it.
//   B. rfis/submittals.share_token are unique (a reply link resolves to one
//      record) — the migration exists, is partial on NOT NULL, and is
//      idempotent. Executed in PGlite by scratchpad pgtest/w4_share_token_unique.mjs.
//
// Run: bun run scripts/validate-w4-integration-docs-team-server.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rfiEmailAttachments, type RfiAttachmentView } from '../utils/rfiSendAttachments';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}

// ── A. what the RFI email attaches ───────────────────────────────────────────
console.log('\nA. an RFI email attaches only fetchable drawings');
const KEY = '0f6f7a52-1111-4222-8333-944444444444/sheet-a-page-1.png';
const KEY2 = '0f6f7a52-1111-4222-8333-944444444444/sheet-b-page-1.png';
const SIGNED = `https://x.supabase.co/storage/v1/object/sign/plan-sheets/${KEY}?token=abc`;
const PUBLIC = `https://x.supabase.co/storage/v1/object/public/plan-sheets/${KEY2}`;
const PHOTO = 'https://x.supabase.co/storage/v1/object/sign/project-photos/p.jpg?token=z';

const views: Record<string, RfiAttachmentView> = {
  [PHOTO]: { uri: PHOTO, sheet: null },
  [KEY]: { uri: KEY, sheet: 'unavailable' },
  [KEY2]: { uri: KEY2, sheet: 'loading' },
};
const view = (u: string) => views[u] ?? { uri: u, sheet: null };

{
  const r = rfiEmailAttachments([PHOTO, KEY, KEY2], view, new Map());
  check('offline send: an unsigned sheet (bare key) is NOT attached', !r.uris.includes(KEY) && !r.uris.includes(KEY2), JSON.stringify(r.uris));
  check('…both are counted so the email and the alert can say so', r.droppedSheets === 2, String(r.droppedSheets));
  check('…the photo still goes', r.uris.length === 1 && r.uris[0] === PHOTO, JSON.stringify(r.uris));
  check('…nothing attached is a relative path', r.uris.every(u => /^https?:\/\//.test(u)));
}
{
  const r = rfiEmailAttachments([KEY], view, new Map([[KEY, SIGNED]]));
  check('a sheet signed for this send is attached by its signed URL', r.uris.length === 1 && r.uris[0] === SIGNED && r.droppedSheets === 0, JSON.stringify(r));
}
{
  const r = rfiEmailAttachments([KEY2], () => ({ uri: PUBLIC, sheet: 'ready' }), new Map());
  check('a sheet the screen already shows (legacy public URL, ready) is attached', r.uris[0] === PUBLIC && r.droppedSheets === 0, JSON.stringify(r));
}
{
  const r = rfiEmailAttachments([KEY], () => ({ uri: KEY, sheet: 'ready' }), new Map());
  check('"ready" is not trusted over a non-URL: a bare key is still left out', r.uris.length === 0 && r.droppedSheets === 1, JSON.stringify(r));
}
{
  const r = rfiEmailAttachments([], view, new Map());
  check('no attachments → nothing, nothing dropped', r.uris.length === 0 && r.droppedSheets === 0);
}

const RFI = read('app/rfi.tsx');
check('rfi.tsx builds the send list through rfiEmailAttachments(durable, attachmentView, minted)',
  /rfiEmailAttachments\(durable, attachmentView, minted\)/.test(RFI));
check('rfi.tsx no longer falls back to the stored value for an unsigned sheet',
  !/minted\.get\(u\) \?\? v\.uri/.test(RFI));
check('the email note says where to see a drawing that was left out',
  /droppedLine/.test(RFI) && /could not be attached to this email/.test(RFI) && /\[sendEmail_Note\.trim\(\), pinLine, droppedLine\]/.test(RFI));
check('the GC is told too (never a plain "RFI Sent" when a drawing was left out)',
  /else if \(droppedSheets > 0\)/.test(RFI) && /RFI sent without/.test(RFI));
check('an empty list sends no attachments key', /attachments: sendUris\.length \? sendUris : undefined/.test(RFI));

// ── B. share_token uniqueness ────────────────────────────────────────────────
console.log('\nB. one reply link, one record');
const MIG = read('supabase/migrations/20260920191000_rfi_submittal_share_token_unique.sql');
const sqlOnly = MIG.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
check('rfis.share_token gets a unique partial index (idempotent)',
  /create unique index if not exists rfis_share_token_key\s+on public\.rfis \(share_token\)\s+where share_token is not null/i.test(sqlOnly));
check('submittals.share_token gets a unique partial index (idempotent)',
  /create unique index if not exists submittals_share_token_key\s+on public\.submittals \(share_token\)\s+where share_token is not null/i.test(sqlOnly));
check('the migration changes nothing else (no drop, no policy, no function)',
  !/\b(drop|policy|function|alter)\b/i.test(sqlOnly));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
