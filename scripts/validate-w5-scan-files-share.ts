// validate-w5-scan-files-share.ts — the shared photo timeline shows the
// photos, keeps working, and puts them on the right day (wave 5, #62 / #164).
//
//   #62  the link is built from photos WITH A STORAGE COPY (the iPhone that
//        took them keeps file:// for good, so the old uri test dropped all of
//        them forever); drafted / recalled photos stay out; a v2 link carries
//        ids, never URLs, and the page signs them through shared-photos-sign
//        on every load. The edge function's decision block is transpiled from
//        its source and run here: foreign project, foreign path, recalled,
//        unstored, unasked ids are all refused. Plan shares pick photos by the
//        same storage rule.
//   #164 days group on the LOCAL calendar day (TZ=America/Denver: a
//        2026-09-22T01:30Z photo is Sep 21), preferring the day the GC's phone
//        stamped into the link.
//
// Run: bun run scripts/validate-w5-scan-files-share.ts
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildPhotoSharePayload, encodePhotoShareToken, decodePhotoShareToken, groupPhotosByDay,
  readSignedSharePhotos, isPhotoShareable,
} from '../utils/photoShareToken';
import { buildPlanSharePayload } from '../utils/planShareToken';
import type { ProjectPhoto, PlanSheet, DrawingPin } from '../types';

// Set before any Date is read (the modules above only define functions).
process.env.TZ = 'America/Denver';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
}

const PID = '2f31d28f-dd61-4396-bd41-1203e533a1cc';
const UID = '291a590e-c15b-4561-b00a-db1bf54177c8';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const photo = (n: number, over: Partial<ProjectPhoto> = {}): ProjectPhoto => ({
  id: id(n), projectId: PID, uri: `file:///var/mobile/${n}.jpg`, storagePath: `${UID}/${PID}/${id(n)}.jpg`,
  timestamp: `2026-09-0${n}T15:00:00.000Z`, createdAt: `2026-09-0${n}T15:00:00.000Z`, ...over,
});

// ── #164 local day ──────────────────────────────────────────────────────────
console.log('\n#164 local calendar day:');
ok('the process really is in America/Denver', new Date('2026-09-22T01:30:00Z').getHours() === 19);
{
  const g = groupPhotosByDay([{ ts: '2026-09-22T01:30:00Z' }]);
  eq('a 7:30 pm Denver photo (01:30Z) groups under the 21st, not the 22nd', g.map(x => x.dayISO), ['2026-09-21']);
  const withD = groupPhotosByDay([{ ts: '2026-09-22T01:30:00Z', d: '2026-09-22' }]);
  eq('the day stamped into the link wins over the viewer\'s zone', withD.map(x => x.dayISO), ['2026-09-22']);
  const built = buildPhotoSharePayload('Maple', [photo(1, { timestamp: '2026-09-22T01:30:00Z' })]);
  eq('the builder stamps the GC\'s local day', built.payload.photos[0]?.d, '2026-09-21');
  eq('an unparseable timestamp is "unknown", not a crash', groupPhotosByDay([{ ts: 'garbage' }]).map(x => x.dayISO), ['unknown']);
}

// ── #62 builder ─────────────────────────────────────────────────────────────
console.log('\n#62 the link is built from stored photos:');
{
  const photos = [
    photo(1),                                                     // iPhone original: file:// uri, stored
    photo(2, { uri: 'https://x/2.jpg' }),                         // web: signed uri, stored
    photo(3, { storagePath: undefined }),                         // really not uploaded
    photo(4, { portalState: { status: 'recalled' } }),            // withdrawn from the client
    photo(5, { portalState: { status: 'draft' } }),               // never sent
    photo(6, { portalState: { status: 'sent' } }),                // sent
    photo(7, { projectId: 'another-project' }),                   // another job
  ];
  const r = buildPhotoSharePayload('Maple', photos, { gcName: 'Northwind' });
  eq('the iPhone\'s own file:// photos ship (by storage path)', r.payload.photos.map(p => p.id).sort(), [id(1), id(2), id(6)].sort());
  eq('only the photo with no storage copy counts as not synced', r.droppedLocal, 1);
  eq('drafted / recalled photos are left out and counted', r.droppedWithdrawn, 2);
  eq('the payload is v2 and scoped to the project', [r.payload.v, r.payload.pid], [2, PID]);
  ok('NO URL of any kind travels in the link', !JSON.stringify(r.payload).includes('http') && !JSON.stringify(r.payload).includes('file:'),
    JSON.stringify(r.payload));
  ok('no photo carries a u key', r.payload.photos.every(p => !('u' in p)));
  const round = decodePhotoShareToken(encodePhotoShareToken(r.payload));
  ok('a v2 token round-trips', round?.v === 2 && round.pid === PID && round.photos.length === 3);
  const v1 = { v: 1 as const, n: 'Old', photos: [{ id: 'a', u: 'https://x/a.jpg', ts: '2026-01-01T00:00:00Z' }] };
  eq('a legacy v1 token still decodes', decodePhotoShareToken(encodePhotoShareToken(v1))?.v, 1);
  eq('a v2 token without a project id is refused', decodePhotoShareToken(encodePhotoShareToken({ ...r.payload, pid: '' })), null);
  eq('isPhotoShareable', [isPhotoShareable({}), isPhotoShareable({ portalState: { status: 'sent' } }), isPhotoShareable({ portalState: { status: 'recalled' } })], [true, true, false]);
}

// ── #62 the page trusts only what it asked for ──────────────────────────────
console.log('\n#62 the viewer reads the signing response defensively:');
{
  const m = readSignedSharePhotos({ photos: [
    { id: 'a', url: 'https://x.supabase.co/sign/a?token=1' },
    { id: 'b', url: 'javascript:alert(1)' },
    { id: 'zzz', url: 'https://x/zzz' },
  ] }, ['a', 'b']);
  eq('https URLs for asked ids only', [...m.entries()], [['a', 'https://x.supabase.co/sign/a?token=1']]);
  eq('garbage body → nothing', readSignedSharePhotos(null, ['a']).size, 0);
  const SP = readFileSync('app/shared-photos.tsx', 'utf8');
  ok('/shared-photos signs v2 links through shared-photos-sign', /invokeWithTimeout<unknown>\('shared-photos-sign'/.test(SP) && /photoIds: ids/.test(SP));
  ok('…and hides dead tiles instead of rendering them broken', /onError=\{\(\) => markBroken\(p\.id\)\}/.test(SP));
  ok('…and says how many it could not show', /can&apos;t be shown/.test(SP));
  ok('the "CDN URL" belief is gone from the token module', !/CDN URL/.test(readFileSync('utils/photoShareToken.ts', 'utf8')));
}

// ── #62 the signer's decision block, run from its own source ───────────────
console.log('\n#62 shared-photos-sign refuses everything it should:');
{
  const src = readFileSync('supabase/functions/shared-photos-sign/index.ts', 'utf8');
  const a = src.indexOf('// ── pure:begin');
  const b = src.indexOf('// ── pure:end');
  ok('the function has its pure block', a > 0 && b > a);
  const dir = mkdtempSync(join(tmpdir(), 'w5-share-'));
  const file = join(dir, 'pure.ts');
  writeFileSync(file, src.slice(a, b));
  // Typed by hand: importing the Deno module's types would drag its https
  // imports into tsc (supabase/functions is outside the app's tsconfig).
  type Req = { projectId: string; photoIds: string[] };
  const fn = await import(file) as {
    parseShareSignRequest: (body: unknown) => Req | null;
    signableSharePhotos: (rows: Record<string, unknown>[], req: Req) => { id: string; path: string }[];
    shareStoragePathOf: (uri: unknown) => string;
  };
  const req = fn.parseShareSignRequest({ projectId: PID, photoIds: [id(1), id(2), 'not-a-uuid', id(1)] });
  eq('ids are validated and de-duplicated; a non-UUID is skipped', req?.photoIds, [id(1), id(2)]);
  eq('a bad project id is refused', fn.parseShareSignRequest({ projectId: "x' or 1=1", photoIds: [id(1)] }), null);
  eq('an oversized id list is refused', fn.parseShareSignRequest({ projectId: PID, photoIds: Array.from({ length: 61 }, (_, i) => id(i)) }), null);
  const row = (n: number, over: Record<string, unknown> = {}) => ({
    id: id(n), user_id: UID, project_id: PID, uri: `${UID}/${PID}/${id(n)}.jpg`, timestamp: 't', tag: null, portal_state: null, ...over,
  });
  const all = fn.parseShareSignRequest({ projectId: PID, photoIds: [1, 2, 3, 4, 5, 6, 7, 8].map(id) })!;
  const out = fn.signableSharePhotos([
    row(1),
    row(2, { portal_state: { status: 'sent' } }),
    row(3, { portal_state: { status: 'recalled' } }),
    row(4, { uri: 'file:///var/mobile/4.jpg' }),
    row(5, { uri: `${UID}/OTHER-PROJECT/${id(5)}.jpg` }),            // a crafted path into another job
    row(6, { uri: `someone-else/${PID}/${id(6)}.jpg` }),              // not the row owner's folder
    row(7, { project_id: 'another' }),
    row(8, { uri: `https://x.supabase.co/storage/v1/object/public/project-photos/${UID}/${PID}/${id(8)}.jpg` }),
    row(9),                                                           // never asked for
  ], all);
  eq('only stored, sent-or-plain, same-project, owner-folder, asked photos are signed', out.map(p => p.id), [id(1), id(2), id(8)]);
  eq('a legacy object URL is reduced to its path', out[2]?.path, `${UID}/${PID}/${id(8)}.jpg`);
  eq('a seed / demo URL is not a storage path', fn.shareStoragePathOf('https://picsum.photos/seed/x/640/480'), '');
  ok('refusals are one 401 "denied" (no oracle)', /const DENIED = \(\) => json\(\{ error: "denied", code: "denied" \}, 401\)/.test(src));
  ok('signed URLs live 1 hour', /SIGNED_URL_TTL_SECONDS = 60 \* 60;/.test(src));
}

// ── #62 plan share: same storage rule ───────────────────────────────────────
console.log('\n#62 plan shares pick photos by storage copy:');
{
  const sheet = { id: 's1', projectId: PID, name: 'A-101', imageUri: 'https://x/plan.png', createdAt: '', updatedAt: '' } as PlanSheet;
  const pins: DrawingPin[] = [1, 2, 3].map(n => ({ id: `pin${n}`, planSheetId: 's1', projectId: PID, x: 0.1, y: 0.1, kind: 'photo', linkedPhotoId: id(n), createdAt: '', updatedAt: '' }) as DrawingPin);
  const photos = [photo(1), photo(2), photo(3, { storagePath: undefined })];
  const signed = buildPlanSharePayload({ projectName: 'M', sheet, zones: [], tasks: [], pins, photos, photoUrls: { [id(1)]: 'https://x/signed-1', [id(2)]: 'https://x/signed-2' } });
  eq('stored iPhone photos ship with the caller-signed URLs', signed.payload.photos.map(p => p.u).sort(), ['https://x/signed-1', 'https://x/signed-2']);
  eq('only the truly unstored photo is "not synced"', [signed.droppedLocal, signed.droppedUnsigned], [1, 0]);
  const unsigned = buildPlanSharePayload({ projectName: 'M', sheet, zones: [], tasks: [], pins, photos });
  eq('stored but unsigned photos are counted apart from unsynced ones', [unsigned.droppedLocal, unsigned.droppedUnsigned, unsigned.payload.photos.length], [1, 2, 0]);
  ok('no file:// ever reaches a plan payload', !JSON.stringify(unsigned.payload).includes('file:'));
  const storedSheet = { ...sheet, imageUri: 'file:///local.png', storagePath: `${PID}/s1-page-1.png` } as PlanSheet;
  const r2 = buildPlanSharePayload({ projectName: 'M', sheet: storedSheet, zones: [], tasks: [], pins: [], photos: [] });
  eq('a stored sheet with no URL is refused but flagged as unsigned, not unsynced', [r2.planNotSynced, r2.planUnsigned, r2.payload.img], [true, true, '']);
  const r3 = buildPlanSharePayload({ projectName: 'M', sheet: storedSheet, zones: [], tasks: [], pins: [], photos: [], sheetUrl: 'https://x/sheet-signed' });
  eq('…and ships with a caller-signed sheet URL', [r3.planNotSynced, r3.payload.img], [false, 'https://x/sheet-signed']);
}

console.log(`\n${fail === 0 ? '✓' : '✗'} w5 scan-files (share): ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
