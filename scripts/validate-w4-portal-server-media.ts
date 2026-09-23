#!/usr/bin/env bun
// scripts/validate-w4-portal-server-media.ts
//
// Audit wave 4, lane portal-server — #14 (and the plans lane's rfi_sheets carry).
//
// Photos on the homeowner portal were published as the GC's file:// camera URI
// or a 24-hour signed link baked into the snapshot: broken images for the
// homeowner, the same day or the next. The project-photos bucket is private
// and plpgsql cannot mint Storage URLs, so a new edge function,
// supabase/functions/signed-media-urls, signs per read (TTL 1 h) — and because
// a signed URL is an unrevocable bearer token, what it may sign is decided
// from the LIVE rows, never from what the caller sends.
//
// This runs the function's pure rules (core.ts) and pins the wiring in
// index.ts and supabase/config.toml.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_ITEMS,
  SIGNED_URL_TTL_SECONDS,
  parseMediaRequest,
  photoSource,
  portalStateIsShared,
  publishedPhotoIds,
  rfiSheetKey,
} from '../supabase/functions/signed-media-urls/core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return ''; } };
const INDEX = read('supabase/functions/signed-media-urls/index.ts');
const CONFIG = read('supabase/config.toml');

let passed = 0, failed = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}

const P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const U = '11111111-1111-4111-8111-111111111111';
const PH1 = 'f0000000-0000-4000-8000-000000000001';
const PH2 = 'f0000000-0000-4000-8000-000000000002';
const PH3 = 'f0000000-0000-4000-8000-000000000003';

console.log('\nsigned-media-urls — request shapes:');
{
  const r = parseMediaRequest({ kind: 'portal_photos', portalId: 'PORT', token: 'tok', photoIds: [PH1, PH1.toUpperCase(), 'not-a-uuid', 7] });
  ok('portal_photos parses; ids deduped, lower-cased, non-uuids dropped',
    !!r && r.kind === 'portal_photos' && r.photoIds.length === 1 && r.photoIds[0] === PH1, JSON.stringify(r));
  ok('portal_photos without a token is refused (400)', parseMediaRequest({ kind: 'portal_photos', portalId: 'PORT', photoIds: [PH1] }) === null);
  ok('more than MAX_ITEMS ids is refused, not truncated',
    parseMediaRequest({ kind: 'portal_photos', portalId: 'P', token: 't', photoIds: Array(MAX_ITEMS + 1).fill(PH1) }) === null);
  const s = parseMediaRequest({ kind: 'rfi_sheets', shareToken: P.toUpperCase(), paths: ['a', 'a', 5, ''] });
  ok('rfi_sheets parses; paths deduped, share token lower-cased', !!s && s.kind === 'rfi_sheets' && s.shareToken === P && s.paths.length === 1, JSON.stringify(s));
  ok('rfi_sheets with a non-uuid share token is refused', parseMediaRequest({ kind: 'rfi_sheets', shareToken: 'abc', paths: [] }) === null);
  ok('an unknown kind is refused', parseMediaRequest({ kind: 'anything', portalId: 'P', token: 't', photoIds: [] }) === null);
}

console.log('\nwhat a portal may have signed:');
{
  const snap = { sections: { photos: [{ id: PH1, url: 'file:///x.jpg' }, { id: PH2 }, { url: 'https://legacy' }] }, project: { heroPhotoId: PH3 } };
  const pub = publishedPhotoIds(snap);
  ok('published = the photos section ids + the hero id', pub.size === 3 && pub.has(PH1) && pub.has(PH2) && pub.has(PH3), [...pub].join(','));
  ok('no snapshot / photos off -> nothing is signable', publishedPhotoIds(null).size === 0 && publishedPhotoIds({ sections: {} }).size === 0);
  ok('shared = no portal_state or status sent', portalStateIsShared(null) && portalStateIsShared({ status: 'sent' }));
  ok('recalled / draft photo is not shared', !portalStateIsShared({ status: 'recalled' }) && !portalStateIsShared({ status: 'draft' }));
}

console.log('\nhow a live photos row is served:');
{
  const key = `${U}/${P}/${PH1}.jpg`;
  ok('a bucket key in the row\'s own project folder is signed', JSON.stringify(photoSource(key, P)) === JSON.stringify({ sign: key }));
  ok('a key under ANOTHER project is never signed (an editor cannot borrow a tenant\'s object)', photoSource(`${U}/${OTHER}/${PH1}.jpg`, P) === null);
  ok('a file:// / blob: / data: URI is never signed or passed', photoSource('file:///var/mobile/x.jpg', P) === null && photoSource('blob:https://a/b', P) === null && photoSource('data:image/png;base64,AA', P) === null);
  ok('path traversal is refused', photoSource(`${U}/${P}/../${OTHER}/x.jpg`, P) === null);
  const legacySigned = `https://ref.supabase.co/storage/v1/object/sign/project-photos/${U}/${P}/${PH1}.jpg?token=old`;
  ok('an expired signed link of this bucket is re-signed by its key', JSON.stringify(photoSource(legacySigned, P)) === JSON.stringify({ sign: key }));
  ok('a Supabase URL for another tenant\'s key is refused', photoSource(`https://ref.supabase.co/storage/v1/object/sign/project-photos/${U}/${OTHER}/x.jpg?t=1`, P) === null);
  ok('a legacy public http link passes through', JSON.stringify(photoSource('https://picsum.photos/seed/x/800', P)) === JSON.stringify({ pass: 'https://picsum.photos/seed/x/800' }));
  ok('a Storage URL on another bucket is not passed through', photoSource('https://ref.supabase.co/storage/v1/object/public/plan-sheets/x/y.png', P) === null);
}

console.log('\nRFI plan sheets (share token):');
{
  ok('a key in the RFI\'s project folder is signable', rfiSheetKey(`${P}/sheet-1.png`, P) === `${P}/sheet-1.png`);
  ok('a legacy public URL reduces to its key', rfiSheetKey(`https://r.supabase.co/storage/v1/object/public/plan-sheets/${P}/s.png`, P) === `${P}/s.png`);
  ok('a signed URL reduces to its key', rfiSheetKey(`https://r.supabase.co/storage/v1/object/sign/plan-sheets/${P}/s.png?token=x`, P) === `${P}/s.png`);
  ok('another project\'s sheet is refused', rfiSheetKey(`${OTHER}/s.png`, P) === '');
  ok('traversal out of the folder is refused', rfiSheetKey(`${P}/../${OTHER}/s.png`, P) === '');
  ok('a device-local URI is refused', rfiSheetKey('file:///x.png', P) === '');
}

console.log('\npasscode is never an oracle:');
{
  // The snapshot is served on the access token alone, so the token is the
  // gate. A passcode check here would answer 401 for a wrong one and 200 for
  // the right one — a guessing oracle outside validate-portal-passcode's
  // per-portal / per-IP ceilings (review round 1).
  const withPass = parseMediaRequest({ kind: 'portal_photos', portalId: 'p', token: 't', passcode: '9999', photoIds: [] });
  ok('a supplied passcode is dropped by the parser', !!withPass && !('passcode' in withPass));
  ok('index.ts never reads or compares a passcode', !/passcode/i.test(INDEX.replace(/^\s*\/\/.*$/gm, '')));
  ok('index.ts has no project client_portal read (only the passcode needed it)', !/client_portal/.test(INDEX));
}

console.log('\nindex.ts wiring:');
ok('TTL is one hour', SIGNED_URL_TTL_SECONDS === 3600 && /createSignedUrls\(unique, SIGNED_URL_TTL_SECONDS\)/.test(INDEX));
ok('portal photos authorise through portal_project_for_token with the access token', /svc\.rpc\("portal_project_for_token", \{\s*p_portal_id: req\.portalId,\s*p_access_token: req\.token,/.test(INDEX));
ok('every authentication failure is 401 {error:"denied"}', /const DENIED = \(\) => json\(\{ error: "denied" \}, 401\);/.test(INDEX) && (INDEX.match(/return DENIED\(\);/g) ?? []).length >= 2);
ok('only ids published in the stored snapshot are looked up', /publishedPhotoIds\(/.test(INDEX) && /req\.photoIds\.filter\(\(id\) => published\.has\(id\)\)/.test(INDEX));
ok('rows are read in the portal\'s project and re-checked shared + project', /\.eq\("project_id", projectId\)\.in\("id", wanted\)/.test(INDEX) && /if \(!portalStateIsShared\(r\.portal_state\)\) continue;/.test(INDEX) && /photoSource\(r\.uri, projectId\)/.test(INDEX));
ok('rfi_sheets checks the share token like get_rfi_by_token and scopes keys to its project', /\.from\("rfis"\)\.select\("id, project_id, attachments"\)\.eq\("share_token", req\.shareToken\)/.test(INDEX) && /rfiSheetKeysToSign\(req\.paths, projectId, referenced\)/.test(INDEX) && /const key = rfiSheetKey\(p, projectId\);/.test(read('supabase/functions/signed-media-urls/core.ts')));
// Integration round 2 (docs-team-server): only the sheets the RFI row itself
// references are signed — see validate-w4-integration-docs-team-server-r2.
ok('rfi_sheets signs only keys the RFI references (attachments + linked pins)', /const byKey = rfiSheetKeysToSign\(req\.paths, projectId, referenced\);/.test(INDEX) && /rfiReferencedSheetKeys\(row\?\.attachments, pinSheetPaths, projectId\)/.test(INDEX));
ok('project-photos and plan-sheets are the only buckets signed', /signKeys\(svc, PHOTO_BUCKET,/.test(INDEX) && /signKeys\(svc, PLAN_SHEET_BUCKET,/.test(INDEX) && (INDEX.match(/storage\.from\(/g) ?? []).length === 1);
ok('CORS answers the preflight', /if \(req\.method === "OPTIONS"\) return new Response\(null, \{ headers: CORS \}\);/.test(INDEX));
ok('no response body echoes a PostgREST / Storage message', !/json\(\{[^}]*\.message/.test(INDEX) && !/json\(\{[^}]*String\(e/.test(INDEX));
ok('rate-limited per caller address via clientIpFrom', /rateLimitCount\(`signed-media:ip:\$\{clientIpFrom\(req\.headers\)\}`\)/.test(INDEX));

console.log('\nsupabase/config.toml:');
ok('signed-media-urls is pinned verify_jwt = false (the homeowner has no Supabase session)', /\[functions\.signed-media-urls\]\s*\nverify_jwt = false/.test(CONFIG));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
