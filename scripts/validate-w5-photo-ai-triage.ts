// validate-w5-photo-ai-triage.ts — wave 5, lane photo-ai: Photo Triage's
// Apply (audit #41: no punch rows without Punch List, and the summary names
// real destinations; #69: a gallery photo keeps its id and storage path on
// every record it becomes) and the photos geo-stamp migration (#65).
//
// Evaluates the `photo-triage-apply` marker block of app/photo-triage.tsx (the
// pure builder Apply runs) with the real isDeviceLocalUri, then pins the
// screen's wiring and the migration by source.
//
// Run: bun run scripts/validate-w5-photo-ai-triage.ts

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeviceLocalUri } from '../utils/photoUploadCore';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.info('  ✓', name); }
  else { fail++; console.info('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
}

type TranspilerCtor = new (o: { loader: string }) => { transformSync(s: string): string };
const Transpiler = (globalThis as unknown as { Bun?: { Transpiler: TranspilerCtor } }).Bun?.Transpiler;
if (!Transpiler) { console.error('\n✗ must run under bun (Bun.Transpiler evaluates the marker block)\n'); process.exit(1); }

const SCREEN = 'app/photo-triage.tsx';
const screenSrc = read(SCREEN);
const start = screenSrc.indexOf('// >>> photo-triage-apply');
const end = screenSrc.indexOf('// <<< photo-triage-apply');
ok(`${SCREEN} carries the photo-triage-apply marker block`, start > -1 && end > start);
if (!(start > -1 && end > start)) { console.info(`\n${pass} passed, ${fail} failed`); process.exit(1); }
const js = new Transpiler({ loader: 'ts' }).transformSync(screenSrc.slice(start, end).replace(/^export /gm, ''));

interface Gallery { id: string; uri: string; storagePath?: string; localUri?: string }
interface Entry {
  photoUri: string; sourcePhotoId?: string; title: string; editedTitle: string;
  location?: string; editedLocation: string; trade: string; priority: string; rationale?: string;
}
interface Records {
  punchItems: Record<string, unknown>[]; rfis: Record<string, unknown>[];
  dfrLines: string[]; dfrPhotos: Record<string, unknown>[]; punchRefiled: number;
  dfrObservations: number; progressPhotos: Record<string, unknown>[];
}
const mod = new Function('isDeviceLocalUri', `${js}\nreturn { buildTriageRecords, mergeDfrPhotos, triageSummary };`)(isDeviceLocalUri) as {
  buildTriageRecords: (i: Record<string, unknown>) => Records;
  mergeDfrPhotos: (a: { id: string }[], b: { id: string }[]) => { id: string }[];
  triageSummary: (r: { punch: number; rfi: number; dfrObservations: number; punchRefiled: number; progress: number }) => string;
};

let n = 0;
const newId = () => `new-${++n}`;
const SIGNED = 'https://x.supabase.co/storage/v1/object/sign/project-photos/u/p/x.jpg?token=abc';
const gallery: Gallery[] = [
  { id: 'g-web', uri: SIGNED, storagePath: 'u/p/x.jpg' },
  { id: 'g-phone', uri: 'file:///var/mobile/x2.jpg', storagePath: 'u/p/g-phone.jpg', localUri: 'file:///var/mobile/x2.jpg' },
  { id: 'g-legacy', uri: 'https://legacy.example/old.jpg' },
];
const entry = (over: Partial<Entry>): Entry => ({
  photoUri: SIGNED, title: 'Cracked tile', editedTitle: 'Cracked tile', editedLocation: 'Master bath',
  trade: 'tile', priority: 'high', rationale: 'Visible crack', ...over,
});
const base = {
  projectId: 'proj-1', gallery, submittedBy: 'Omir', nowIso: '2026-09-23T15:00:00.000Z',
  rfiDueDay: '2026-09-30', newId,
};

console.info('\n#69 — a gallery photo keeps its id and durable path');
{
  const r = mod.buildTriageRecords({
    ...base, canPunch: true,
    punch: [entry({ sourcePhotoId: 'g-web' }), entry({ photoUri: 'file:///var/mobile/x2.jpg', sourcePhotoId: 'g-phone' }), entry({ photoUri: 'file:///cam/1.jpg' })],
    rfi: [entry({ sourcePhotoId: 'g-web' })],
    dfr: [entry({ sourcePhotoId: 'g-web' }), entry({ sourcePhotoId: 'g-web', title: 'dup' }), entry({ photoUri: 'file:///cam/2.jpg' })],
    progress: [entry({ sourcePhotoId: 'g-web' }), entry({ photoUri: 'file:///cam/3.jpg' })],
  });
  const [web, phone, cam] = r.punchItems;
  ok('punch from a web gallery photo: sourcePhotoId = the gallery id', web?.sourcePhotoId === 'g-web');
  ok('…and photoStoragePath = u/p/x.jpg (the row stores the path, not the 24 h link)', web?.photoStoragePath === 'u/p/x.jpg', JSON.stringify(web));
  ok('…with no photoLocalUri for a signed URL', web?.photoLocalUri === undefined);
  ok('punch from a gallery photo on this phone: source id, but its OWN copy (no shared object deleteProjectPhoto could free)',
    phone?.sourcePhotoId === 'g-phone' && phone?.photoStoragePath === undefined && phone?.photoUri === 'file:///var/mobile/x2.jpg');
  ok('punch from a fresh camera shot: no source id, no borrowed path (it stages its own)',
    cam?.sourcePhotoId === undefined && cam?.photoStoragePath === undefined);
  const rfi = r.rfis[0];
  ok('RFI from a gallery photo: sourcePhotoId = the gallery id (app/rfi.tsx renders attachment 0 through it)', rfi?.sourcePhotoId === 'g-web');
  ok('…its attachment is the photo it was raised from', JSON.stringify(rfi?.attachments) === JSON.stringify([SIGNED]));
  ok('RFI dateRequired is the calendar day given', rfi?.dateRequired === '2026-09-30');
  const [d1, d2] = r.dfrPhotos;
  ok('DFR photo from the gallery reuses the gallery id and storagePath u/p/x.jpg', d1?.id === 'g-web' && d1?.storagePath === 'u/p/x.jpg', JSON.stringify(d1));
  ok('the same gallery photo triaged twice into the report is added once', r.dfrPhotos.filter(p => p.id === 'g-web').length === 1 && r.dfrPhotos.length === 2);
  ok('a camera pick still gets a fresh id', typeof d2?.id === 'string' && String(d2.id).startsWith('new-') && d2?.uri === 'file:///cam/2.jpg');
  ok('both observations still become report lines', r.dfrLines.length === 3);
  ok('progress: a photo already in the gallery (by id) is not re-added; a camera shot is', r.progressPhotos.length === 1 && r.progressPhotos[0].uri === 'file:///cam/3.jpg');
  const legacy = mod.buildTriageRecords({ ...base, canPunch: true, punch: [entry({ photoUri: 'https://legacy.example/old.jpg', sourcePhotoId: 'g-legacy' })], rfi: [], dfr: [entry({ photoUri: 'https://legacy.example/old.jpg', sourcePhotoId: 'g-legacy' })], progress: [] });
  ok('a legacy gallery row with no storagePath keeps its id and invents no path',
    legacy.punchItems[0]?.sourcePhotoId === 'g-legacy' && legacy.punchItems[0]?.photoStoragePath === undefined
    && legacy.dfrPhotos[0]?.id === 'g-legacy' && legacy.dfrPhotos[0]?.storagePath === undefined);
  const merged = mod.mergeDfrPhotos([{ id: 'g-web' }, { id: 'a' }], [{ id: 'g-web' }, { id: 'b' }]);
  ok('mergeDfrPhotos adds each id once onto an existing draft', JSON.stringify(merged.map(p => p.id)) === JSON.stringify(['g-web', 'a', 'b']));
}

console.info('\n#41 — no punch rows without Punch List');
{
  const r = mod.buildTriageRecords({
    ...base, canPunch: false,
    punch: [entry({ sourcePhotoId: 'g-web', editedTitle: 'Loose outlet cover' }), entry({ photoUri: 'file:///cam/1.jpg', editedTitle: 'Chipped door' }), entry({ photoUri: '', editedTitle: 'Paint drip' })],
    rfi: [], dfr: [entry({ photoUri: 'file:///cam/9.jpg', editedTitle: 'Framing done' })], progress: [],
  });
  ok('canPunch false → zero punch items', r.punchItems.length === 0);
  ok('…the 3 punch findings go to the daily report', r.punchRefiled === 3 && r.dfrObservations === 4 && r.dfrLines.some(l => /Loose outlet cover/.test(l)) && r.dfrLines.some(l => /Paint drip/.test(l)));
  ok('…with their photos (the gallery one by id)', r.dfrPhotos.some(p => p.id === 'g-web') && r.dfrPhotos.some(p => p.uri === 'file:///cam/1.jpg'));
  const s = mod.triageSummary({ punch: 0, rfi: 0, dfrObservations: r.dfrObservations, punchRefiled: r.punchRefiled, progress: 0 });
  ok('the summary says they were filed as observations because Punch List is on Business',
    /3 punch findings were filed as daily-report observations — Punch List is on Business/.test(s), s);
  ok('…and never names the Punch List as a place to review them', !/in the project's Punch List/.test(s));
  ok('…nor "Review them on the project screen"', !/project screen/.test(s));
  const withPunch = mod.buildTriageRecords({ ...base, canPunch: true, punch: [entry({})], rfi: [], dfr: [], progress: [] });
  ok('canPunch true → the punch item is made and nothing is refiled', withPunch.punchItems.length === 1 && withPunch.punchRefiled === 0 && withPunch.dfrLines.length === 0);
  const s2 = mod.triageSummary({ punch: 1, rfi: 2, dfrObservations: 1, punchRefiled: 0, progress: 1 });
  ok('the summary names each real destination', /1 punch item — in the project's Punch List/.test(s2) && /2 RFIs — in the project's RFIs/.test(s2) && /today's draft daily report/.test(s2) && /project's Photos/.test(s2), s2);
  ok('nothing kept → the nothing-to-apply sentence', /Nothing to apply/.test(mod.triageSummary({ punch: 0, rfi: 0, dfrObservations: 0, punchRefiled: 0, progress: 0 })));
}

console.info('\nscreen wiring');
{
  const s = code(screenSrc);
  ok('canPunch is project-scoped: useProjectAccess(projectId).canAccess(\'punch_list_closeout\')',
    /useProjectAccess\(projectId\)/.test(s) && /canPunch = canAccessOnProject\('punch_list_closeout'\)/.test(s));
  ok('Apply passes canPunch to the builder and calls addPunchItems only with rows',
    /canPunch,\s*\n/.test(s) && /if \(records\.punchItems\.length > 0\) addPunchItems\(records\.punchItems\)/.test(s));
  ok('addPunchItems is called nowhere else on the screen', (s.match(/addPunchItems\(/g) ?? []).length === 1);
  ok('ReviewEntry carries sourcePhotoId from a gallery pick only', /sourcePhotoId: src\?\.fromProject \? src\.id : undefined/.test(s));
  ok('the picked photo is read once per entry (uri and id together)', /photoUri: src\?\.uri \?\? ''/.test(s));
  ok('the Punch chip is blocked with the reason, not silently moved',
    /cls === 'punch' && !canPunch/.test(s) && /'Punch list is on Business'/.test(s));
  ok('the punch bucket says where its entries will go', /these will be filed as observations in today\\'s daily report/.test(s));
  ok('the old "Review them on the project screen" is gone', !/Review them on the project screen/.test(s));
  ok('the DFR draft merge dedupes by id', /mergeDfrPhotos\(existingDraft\.photos/.test(s));
  ok('the analyze error is the server refusal first', /const refusal = showAiRefusal\(err, router\)/.test(s));
}

console.info('\n#65 — photos geo-stamp migration');
{
  const f = 'supabase/migrations/20260923230000_photos_geo_stamp.sql';
  ok(`${f} exists`, existsSync(join(ROOT, f)));
  const m = existsSync(join(ROOT, f)) ? read(f) : '';
  for (const [col, type] of [['latitude', 'double precision'], ['longitude', 'double precision'], ['location_accuracy_meters', 'double precision'], ['location_label', 'text']]) {
    ok(`adds photos.${col} ${type}, re-runnable`, new RegExp(`add column if not exists ${col} ${type}`).test(m));
  }
  ok('no NOT NULL, default or backfill', !/not null|default |update public\.photos/i.test(m.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')));
  ok('photoGeoStamp.ts names the columns it lands in', /20260923230000_photos_geo_stamp\.sql/.test(read('utils/photoGeoStamp.ts')) && /location_accuracy_meters/.test(read('utils/photoGeoStamp.ts')));
}

console.info(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
