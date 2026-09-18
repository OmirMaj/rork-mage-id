// validate-photo-markup-join.ts — the markup has to travel with the photo.
//
// WHY: a GC opens a photo of a ceiling, circles the duct clashing with the
// beam, types "conflict here", saves, and taps "Create RFI". The markup IS the
// question. Until this guard existed both escalation paths handed on the raw
// image and dropped everything the photo already knew:
//
//   * app/rfi.tsx used `prefillPhotoId` only to read `.uri`, so the RFI arrived
//     with no link to the schedule task the photo was taken of — and the screen
//     never rendered its attachments at all, so nobody could see what was being
//     sent.
//   * app/punch-list.tsx used `prefillPhotoId` as a truthy check and nothing
//     else, so the room the photo was taken in was retyped or left blank.
//   * PhotoMarkupOverlay lived inside app/project-detail.tsx, so the lightbox
//     was the only surface in the app that could draw a mark.
//
// The cost is measured in days: an architect looking at an unmarked MEP photo
// replies "please clarify which conflict" and a 3-day RFI becomes 6 while the
// ceiling crew waits. A sub who can't tell which scratch he is being
// back-charged for disputes it. (Audit 2026-09-17 #12.)
//
// Run: bun run scripts/validate-photo-markup-join.ts
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Bun's own transpiler, used below to run the pure resolvers out of a .tsx the
// bun runtime cannot import (react-native / react-native-svg don't resolve
// here). Declared locally because the repo doesn't ship @types/bun and one
// global is cheaper than a dependency.
declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' }) => { transformSync: (code: string) => string };
};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}
const read = (p: string) => existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : '';

console.log('\nPhoto markup → RFI / punch join:');

// ── 1. The shared overlay exists ────────────────────────────────────────────
console.log('\n  the overlay is shared, not screen-local');
const overlayPath = 'components/PhotoMarkupOverlay.tsx';
const overlay = read(overlayPath);
ok('components/PhotoMarkupOverlay.tsx exists', overlay.length > 0);
ok('it exports the component', /export function PhotoMarkupOverlay/.test(overlay));
ok('it exports the URI → photo resolver the escalation screens need',
  /export function photoForUri/.test(overlay) && /export function markupForUri/.test(overlay)
  && /export function markupForSource/.test(overlay) && /export function sourcePhotoIdOf/.test(overlay));
ok('it renders every primitive the annotator can draw',
  ['arrow', 'circle', 'freehand', 'text'].every(t => overlay.includes(`m.type === '${t}'`)));
ok('it is transparent to touches — an overlay must never eat the tap that opens the photo',
  /pointerEvents="none"/.test(overlay));
ok('it scales the normalized 0..1 coordinates to its OWN measured box',
  /onLayout/.test(overlay) && /size\.w > 0 && size\.h > 0/.test(overlay));
ok('it also ships a variant for a letterboxed (`contain`) photo',
  /export function ContainedPhotoMarkupOverlay/.test(overlay));
ok('…which asks the platform for the photo\'s real dimensions',
  /RNImage\.getSize\(/.test(overlay));
ok('…and cancels a late size callback, so one photo cannot size another\'s marks',
  /let live = true;/.test(overlay) && /return \(\) => \{ live = false; \};/.test(overlay));
ok('…and draws nothing until it knows both the box and the image',
  /const frame = image \? containedMarkupFrame\(box, image\) : undefined;/.test(overlay)
  && /\{!!frame && \(/.test(overlay));
// The annotator's palette and the overlay's must agree, or a mark changes
// colour between the screen it was drawn on and the screen it is read on.
const annotator = read('app/photo-annotator.tsx');
for (const hex of ['#E5484D', '#F5A623', '#1E8E4A']) {
  ok(`pen colour ${hex} matches the annotator`,
    overlay.includes(hex) && annotator.includes(hex));
}

// ── 2. The resolver's actual behaviour ──────────────────────────────────────
// Executed, not just grepped: per types/index.ts ProjectPhoto.uri is a
// device-local file:// path OR a short-lived signed URL, so the same photo
// reaches an RFI attachment under any of three spellings. Matching on only one
// of them silently loses the markup on every device but the one that shot it.
console.log('\n  resolving a copied URI back to its photo');
const sliceStart = overlay.indexOf('export function photoForUri');
const sliceEnd = overlay.indexOf('export function PhotoMarkupOverlay');
ok('the pure resolvers can be isolated for testing', sliceStart > 0 && sliceEnd > sliceStart);
const fragment = overlay.slice(sliceStart, sliceEnd).replace(/export function/g, 'function');
const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(fragment);
const { photoForUri, markupForUri, markupForSource, sourcePhotoIdOf, containedMarkupFrame } = new Function(
  `${js}\nreturn { photoForUri, markupForUri, markupForSource, sourcePhotoIdOf, containedMarkupFrame };`,
)() as {
  markupForSource: (photos: unknown[] | undefined, id: string | undefined, uri: string | undefined) => unknown[];
  sourcePhotoIdOf: (record: unknown) => string | undefined;
  photoForUri: (photos: unknown[] | undefined, uri: string | undefined) => unknown;
  markupForUri: (photos: unknown[] | undefined, uri: string | undefined) => unknown[];
  containedMarkupFrame: (
    box: { width: number; height: number },
    image: { width: number; height: number },
  ) => { left: number; top: number; size: number } | undefined;
};

const MARK = [{ id: 'm1', type: 'circle', color: 'red', points: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.4 }] }];
const photos = [
  { id: 'p1', projectId: 'proj', uri: 'https://signed.example/p1?tok=abc', storagePath: 'u/proj/p1.jpg', localUri: 'file:///var/p1.jpg', markup: MARK },
  { id: 'p2', projectId: 'proj', uri: 'file:///var/p2.jpg' },
];
eq('matches the URI the photo renders as today',
  (photoForUri(photos, 'https://signed.example/p1?tok=abc') as { id: string } | undefined)?.id, 'p1');
eq('matches this device\'s local original', (photoForUri(photos, 'file:///var/p1.jpg') as { id: string } | undefined)?.id, 'p1');
eq('matches the durable bucket path', (photoForUri(photos, 'u/proj/p1.jpg') as { id: string } | undefined)?.id, 'p1');
eq('an unknown URI resolves to nothing', photoForUri(photos, 'file:///var/other.jpg'), undefined);
eq('an empty URI resolves to nothing', photoForUri(photos, ''), undefined);
eq('no photos loaded yet resolves to nothing', photoForUri(undefined, 'file:///var/p1.jpg'), undefined);
eq('the markup comes back for a matched photo', markupForUri(photos, 'u/proj/p1.jpg'), MARK);
eq('a photo with no markup yields an empty list, never undefined',
  markupForUri(photos, 'file:///var/p2.jpg'), []);
eq('a corrupt markup field yields an empty list rather than crashing the screen',
  markupForUri([{ id: 'p3', uri: 'x', markup: 'not-an-array' }], 'x'), []);

// ── 2a. By the photo's ID, not the copied URI ───────────────────────────────
// The URI match only works on the device that shot the photo. A punch photo is
// re-uploaded under `punch-<itemId>`, and every OTHER device (the office, web,
// the sub) gets back a signed URL for THAT object — which never equals the
// source photo's uri, localUri or storagePath. This is the case the first
// version of this guard never exercised (review 2 on #12).
console.log('\n  resolving by the source photo id (the cross-device case)');
const SIGNED_PUNCH = 'https://x.supabase.co/storage/v1/object/sign/photos/u/proj/punch-pi1.jpg?token=zzz';
eq('a punch photo signed under punch-<id> matches no gallery photo by URI',
  markupForUri(photos, SIGNED_PUNCH), []);
eq('…but the markup is still found through sourcePhotoId',
  markupForSource(photos, 'p1', SIGNED_PUNCH), MARK);
eq('an RFI attachment that is another device\'s file:// still finds it by id',
  markupForSource(photos, 'p1', 'file:///private/other-phone/p1.jpg'), MARK);
eq('no id falls back to the URI match (records written before the id existed)',
  markupForSource(photos, undefined, 'file:///var/p1.jpg'), MARK);
eq('an id for a photo not loaded yet falls back to the URI match',
  markupForSource(photos, 'gone', 'u/proj/p1.jpg'), MARK);
eq('an id and URI that match nothing draw nothing',
  markupForSource(photos, 'gone', SIGNED_PUNCH), []);
eq('the id is read off a record that has one', sourcePhotoIdOf({ sourcePhotoId: 'p1' }), 'p1');
eq('…and is undefined on a record written before it existed', sourcePhotoIdOf({ id: 'x' }), undefined);
eq('…and on no record at all', sourcePhotoIdOf(null), undefined);
eq('…and on a non-string or empty value', [sourcePhotoIdOf({ sourcePhotoId: 3 }), sourcePhotoIdOf({ sourcePhotoId: '' })], [undefined, undefined]);

// ── 2b. Placing a square markup on a letterboxed photo ──────────────────────
// The full-screen views show the WHOLE photo with `contain`; the annotator drew
// on a centred SQUARE COVER crop of it. Drawing the marks over the whole box
// would put the circle beside the defect, which is worse than drawing nothing.
// This is the arithmetic that puts it back where it was drawn, so it is
// executed rather than grepped — an off-by-a-half here is a wrong accusation
// against a sub.
console.log('\n  placing the marks on a letterboxed photo');
// Landscape 4000×3000 in a tall 400×800 box: contain fits the WIDTH, so the
// photo is 400×300 sitting mid-box, and the square crop is its 300×300 centre.
eq('a landscape photo: the square crop sits inside the fitted image',
  containedMarkupFrame({ width: 400, height: 800 }, { width: 4000, height: 3000 }),
  { left: 50, top: 250, size: 300 });
// Portrait 3000×4000: contain fits the HEIGHT here, and the crop is the full width.
eq('a portrait photo: the crop spans the width and is vertically centred',
  containedMarkupFrame({ width: 400, height: 800 }, { width: 3000, height: 4000 }),
  { left: 0, top: 200, size: 400 });
eq('a square photo fills the fitted box exactly — no crop to account for',
  containedMarkupFrame({ width: 400, height: 800 }, { width: 1000, height: 1000 }),
  { left: 0, top: 200, size: 400 });
eq('a square photo in a square box is the identity case',
  containedMarkupFrame({ width: 300, height: 300 }, { width: 1200, height: 1200 }),
  { left: 0, top: 0, size: 300 });
// The frame must never spill outside the fitted image, or a mark drawn at the
// canvas edge lands on the black letterbox.
for (const [iw, ih] of [[4000, 3000], [3000, 4000], [1000, 1000], [5000, 1000]]) {
  const box = { width: 375, height: 700 };
  const f = containedMarkupFrame(box, { width: iw, height: ih })!;
  const scale = Math.min(box.width / iw, box.height / ih);
  const dispW = iw * scale, dispH = ih * scale;
  const inside =
    f.left >= (box.width - dispW) / 2 - 1e-6 &&
    f.top >= (box.height - dispH) / 2 - 1e-6 &&
    f.size <= Math.min(dispW, dispH) + 1e-6;
  ok(`${iw}×${ih}: the markup square stays inside the fitted photo`, inside,
    JSON.stringify(f));
}
ok('a box that has not been measured yet draws nothing',
  containedMarkupFrame({ width: 0, height: 800 }, { width: 100, height: 100 }) === undefined);
ok('an image whose size never arrived draws nothing',
  containedMarkupFrame({ width: 400, height: 800 }, { width: 0, height: 0 }) === undefined);
ok('a NaN dimension draws nothing rather than an SVG at NaN',
  containedMarkupFrame({ width: 400, height: NaN }, { width: 100, height: 100 }) === undefined);

// ── 3. The annotator still hands the ID across ──────────────────────────────
console.log('\n  the annotator hands over the photo, not just the picture');
ok('Create RFI carries prefillPhotoId',
  /pathname: '\/rfi'[\s\S]{0,160}prefillPhotoId: photo\.id/.test(annotator));
ok('Add to Punch List carries prefillPhotoId',
  /pathname: '\/punch-list'[\s\S]{0,200}prefillPhotoId: photo\.id/.test(annotator));
ok('the markup is saved before either handoff',
  /updateProjectPhoto\(photo\.id, \{ markup: markups \}\)/.test(annotator));

// ── 4. RFI ──────────────────────────────────────────────────────────────────
console.log('\n  RFI');
const rfi = read('app/rfi.tsx');
ok('the prefill resolves the whole photo, not just its .uri',
  /const prefillPhoto = useMemo\([\s\S]{0,220}p\.id === prefillPhotoId/.test(rfi));
ok('the RFI is linked to the task the photo was taken of',
  /prefillPhoto\?\.linkedTaskId/.test(rfi));
// Both paths, because they cover different arrivals: the initializer handles a
// photo already in cache, the latched effect handles one that hydrates after
// mount. Losing either silently drops the link for half the users.
ok('…both when the photo is already cached and when it arrives late',
  /useState\(\s*existingRFI\?\.linkedTaskId \?\? prefillPhoto\?\.linkedTaskId/.test(rfi)
  && /setLinkedTaskId\(prev => prev \|\| \(prefillPhoto\.linkedTaskId/.test(rfi));
ok('a photo that hydrates AFTER mount still fills the form',
  /prefillPulled/.test(rfi) && /\}, \[prefillPhoto, existingRFI\]\);/.test(rfi));
ok('…and never overwrites an existing RFI or something already typed',
  /if \(!prefillPhoto \|\| existingRFI \|\| prefillPulled\.current\) return;/.test(rfi));
ok('attachments are actually rendered (they used to be invisible)',
  /attachments\.map\(\(stored, index\) =>/.test(rfi));
ok('…with the markup drawn over them',
  /const \{ uri, markup \} = attachmentView\(stored, index\);/.test(rfi)
  && /<PhotoMarkupOverlay markup=\{markup\}/.test(rfi));
ok('…resolved by the source photo id first, the copied URI only as fallback',
  /markup: markupForSource\(projectPhotos, fromSource\?\.id, uri\)/.test(rfi)
  && !/markupForUri\(/.test(rfi));
ok('…and the source photo\'s CURRENT uri is rendered over a stale stored copy',
  /uri: fromSource\?\.uri \|\| uri,/.test(rfi));
ok('a new RFI raised from a photo keeps the photo id',
  /\.\.\.\(sourcePhotoId && attachments\.length > 0 \? \{ sourcePhotoId \} : \{\}\)/.test(rfi));
ok('an existing RFI reads its own id; a new one takes the prefill\'s',
  /const sourcePhotoId = existingRFI \? sourcePhotoIdOf\(existingRFI\) : \(prefillPhotoId \|\| undefined\);/.test(rfi));
ok('the emailed attachment is the source photo\'s current uri, not an expired copy',
  /existingRFI\.attachments\.map\(\(stored, index\) => attachmentView\(stored, index\)\.uri\)/.test(rfi));
ok('the note does not promise the markup shows everywhere in MAGE ID',
  !/shows here and in MAGE ID/.test(rfi));
ok('…on a SQUARE cover thumbnail, the frame the annotator normalized against',
  /attachmentThumbWrap: \{[\s\S]{0,160}width: (\d+), height: \1,/.test(rfi)
  && /style=\{styles\.attachmentThumb\} contentFit="cover"/.test(rfi));
ok('the screen is honest that an EMAILED copy is the plain photo',
  /emailed copy of the photo is the plain/i.test(rfi));
ok('projectPhotos is read from the typed context, not an `as any` escape hatch',
  !/\(ctx as any\)\.projectPhotos/.test(rfi));

// ── 5. Punch list ───────────────────────────────────────────────────────────
console.log('\n  punch list');
const punch = read('app/punch-list.tsx');
ok('prefillPhotoId resolves the photo instead of being a truthy check',
  /const prefillPhoto = useMemo\([\s\S]{0,220}p\.id === prefillPhotoId/.test(punch));
ok('the punch item inherits the room the photo was taken in',
  /setLocation\(prev => \(prev\.trim\(\) \? prev : prefillPhoto\.location/.test(punch));
ok('…and the schedule task the photo belongs to',
  /setLinkedTaskId\(prev => prev \|\| \(prefillPhoto\.linkedTaskId/.test(punch));
ok('a photo that hydrates AFTER mount still fills the form',
  /prefillPulled/.test(punch) && /\}, \[prefillPhoto, editingItem\]\);/.test(punch));
// The mirror of the existingRFI guard above. A photo can resolve in the window
// where he has already opened an EXISTING item to edit, and an existing item
// with no room and no linked task leaves both fields '' — falsy — so without
// this an unrelated photo's room is written into that item and saved with it.
ok('…and never overwrites an item he opened for editing',
  /if \(!prefillPhoto \|\| editingItem \|\| prefillPulled\.current\) return;/.test(punch));
ok('the attached-photo preview draws the markup',
  /<PhotoMarkupOverlay markup=\{markupForSource\(projectPhotos, attachedSourcePhotoId, attachedPhotoUri\)\}/.test(punch));
ok('the prefill keeps the source photo id, on mount and when the photo arrives late',
  /setAttachedSourcePhotoId\(prefillPhotoId \|\| undefined\)/.test(punch)
  && /setAttachedSourcePhotoId\(prev => prev \?\? prefillPhoto\.id\)/.test(punch));
ok('a new punch item is saved with that id',
  /\.\.\.\(attachedPhotoUri && attachedSourcePhotoId \? \{ sourcePhotoId: attachedSourcePhotoId \} : \{\}\)/.test(punch));
ok('…and the id is cleared everywhere the attached photo is, so it cannot ride onto the next item',
  (punch.match(/setAttachedPhotoUri\(undefined\)/g) ?? []).length
    === (punch.match(/setAttachedSourcePhotoId\(undefined\)/g) ?? []).length);
ok('no punch surface resolves markup by URI alone any more', !/markupForUri\(/.test(punch));
// The sub portal carries only the photo (utils/subPortalSnapshot maps
// photoUri, no markup), so the punch form must say what the RFI form says.
ok('the punch form is honest that the SUB sees the plain photo when it carries markup',
  /The sub sees the plain photo/.test(punch)
  && /attachedPhotoUri && markupForSource\(projectPhotos, attachedSourcePhotoId, attachedPhotoUri\)\.length > 0 \?/.test(punch));
ok('the preview frame is SQUARE and covers — the frame the marks were drawn on',
  /photoImgWrap: \{ width: (\d+), height: \1,/.test(punch)
  && /style=\{styles\.photoImg\} resizeMode="cover"/.test(punch));
// The full-screen viewer is the frame the sub actually argues over, so it draws
// the markup too — but through the CONTAINED variant, which accounts for the
// letterboxing. A plain overlay here would put the circle beside the defect.
ok('the full-screen viewer draws the markup',
  /<ContainedPhotoMarkupOverlay[\s\S]{0,400}markupForSource\(projectPhotos, sourcePhotoIdOf\(viewerItem\), viewerPhotoUri\)/.test(punch));
ok('…through the contained variant, not the square-frame one',
  !/<PhotoMarkupOverlay markup=\{markupFor\w+\(projectPhotos,[^}]*viewerPhotoUri\)\}/.test(punch));
ok('…inside a wrapper the image and the overlay share (not over the caption)',
  /viewerImageWrap: \{ flex: 1, width: '100%', position: 'relative'/.test(punch)
  && /<View style=\{styles\.viewerImageWrap\}>/.test(punch));

// ── The id survives a sync round-trip ───────────────────────────────────────
// Everything above is local. Without the type, the migration, the write
// mappers AND the read mappers, the id never reached the server, the next
// server-first load (mergeLocalOnly keeps the server row) dropped it even on
// the device that drew the markup, and the circle vanished everywhere.
{
  const types = readFileSync(join(ROOT, 'types/index.ts'), 'utf8');
  const ctx = readFileSync(join(ROOT, 'contexts/ProjectContext.tsx'), 'utf8');
  const block = (name: string): string => {
    const i = types.indexOf(`export interface ${name} {`);
    return i < 0 ? '' : types.slice(i, types.indexOf('\n}\n', i));
  };
  ok('PunchItem and RFI both declare sourcePhotoId',
    /\n  sourcePhotoId\?: string;/.test(block('PunchItem')) && /\n  sourcePhotoId\?: string;/.test(block('RFI')));
  const migDir = join(ROOT, 'supabase/migrations');
  const mig = readdirSync(migDir).filter(f => f.endsWith('.sql'))
    .map(f => readFileSync(join(migDir, f), 'utf8')).join('\n');
  ok('a migration adds source_photo_id to punch_items and rfis',
    /alter table public\.punch_items add column if not exists source_photo_id text/i.test(mig)
      && /alter table public\.rfis add column if not exists source_photo_id text/i.test(mig));
  const writes = ctx.match(/\.\.\.\((?:pi|item|r)\.sourcePhotoId \? \{ source_photo_id: (?:pi|item|r)\.sourcePhotoId \} : \{\}\)/g) ?? [];
  ok('the punch insert, punch update and RFI row builders all write it (only when set)', writes.length === 3,
    `found ${writes.length}`);
  const reads = ctx.match(/sourcePhotoId: \(r\.source_photo_id as string \| null\) \?\? undefined/g) ?? [];
  ok('the punch and RFI read mappers both read it back', reads.length === 2, `found ${reads.length}`);
}

// ── A legacy punch photo renders from its source photo ─────────────────────
// Items raised from a gallery photo NOT on the device were saved with that
// photo's 24-hour signed URL, and the loader passes such a value through as-is
// — so, until the item is next edited, punch-list and the sub portal snapshot
// showed a dead image. The context's exposed list borrows the source photo's
// live uri + durable path (utils/punchSourcePhoto).
{
  const { withSourcePhotoUris, withSourcePhotoUri } = await import('../utils/punchSourcePhoto');
  const photos = [{ id: 'ph1', uri: 'https://x.supabase.co/sign/fresh?token=new', storagePath: 'u1/p1/ph1.jpg' }];
  const byId = new Map(photos.map(p => [p.id, p] as const));
  const legacy: { id: string; photoUri: string; sourcePhotoId: string; photoStoragePath?: string } = { id: 'pi1', photoUri: 'https://x.supabase.co/sign/old?token=expired', sourcePhotoId: 'ph1' };
  const healed = withSourcePhotoUri(legacy, byId);
  eq('a legacy item (signed URL, no path) renders the source photo\'s current uri',
    [healed.photoUri, healed.photoStoragePath], ['https://x.supabase.co/sign/fresh?token=new', 'u1/p1/ph1.jpg']);
  const durable = { ...legacy, photoStoragePath: 'u1/p1/punch-pi1.jpg' };
  ok('an item with its own durable path is left alone', withSourcePhotoUri(durable, byId) === durable);
  const local = { ...legacy, photoUri: 'file:///var/mobile/punch.jpg' };
  ok('…and so is one whose photo is a file on this phone', withSourcePhotoUri(local, byId) === local);
  const orphan = { ...legacy, sourcePhotoId: 'gone' };
  ok('…and one whose source photo is not loaded (keeps its own uri)', withSourcePhotoUri(orphan, byId) === orphan);
  const plain = { id: 'pi2', photoUri: 'https://elsewhere/a.jpg' };
  const list = [plain];
  ok('a list with nothing to heal is returned as the same array', withSourcePhotoUris(list, photos) === list);
  const mixed = [plain, legacy];
  const out = withSourcePhotoUris(mixed, photos);
  ok('a list with a legacy item is healed item-by-item', out !== mixed && out[0] === plain && out[1].photoUri === photos[0].uri);

  const ctxSrc = readFileSync(join(ROOT, 'contexts/ProjectContext.tsx'), 'utf8');
  ok('ProjectContext exposes the healed list as punchItems and to getPunchItemsForProject',
    /const punchItemsView = useMemo\(\(\) => withSourcePhotoUris\(punchItems, projectPhotos\), \[punchItems, projectPhotos\]\);/.test(ctxSrc)
      && /punchItems: punchItemsView, addPunchItem,/.test(ctxSrc)
      && /const getPunchItemsForProject = useCallback\(\(projectId: string\) => punchItemsView\.filter\(/.test(ctxSrc));
}

// ── Report ──────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
