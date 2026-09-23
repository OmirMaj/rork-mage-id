// scripts/validate-w4-punch-web-edit-layout.ts — the punch item add/edit sheet
// on a wide web window: 75 % form, 25 % photo.
//
// WHY THIS EXISTS. Founder, 2026-09-22: "When adding photos to punchlist on the
// web browser. Why not make it like 75% of the screen be the edit item then
// other 25% is the photo so you can visualize." On a laptop the phone's bottom
// sheet showed the photo as a 112 px thumbnail, and the EDIT sheet showed no
// photo at all. What can go wrong, silently:
//
//   • the split leaking onto the phone (iPhone is the primary target — its
//     sheet must stay exactly as it was), or onto a web window too narrow for
//     a useful 25 % column;
//   • the phone sheet's pieces re-ordered while being shared with the panel;
//   • a photo change on an existing item written with no durable-path reset
//     (the new file never uploads), or a Remove that JSON drops so the server
//     keeps the old photo;
//   • a Replace uploaded under the item's old `punch-<id>` key: the web file
//     chooser's blob: URL has no extension, so it resolves to `.jpg` — the key
//     the old (iPhone) photo already holds. Storage answers 409, the queue
//     reads that as "already uploaded" and drops it, and every other device
//     keeps the OLD photo while this tab shows the new one (review, round 1);
//   • Replace / Remove on a photo linked to a gallery photo: the update never
//     clears source_photo_id, so other devices would draw the OLD markup over
//     the new picture, or show the old picture again — those buttons must say
//     so instead;
//   • the plan close-up's window off the pin, or not square (the box is).
//
// HOW IT CHECKS. A. executes utils/punchEditLayout.ts; B. executes
// punchPhotoPatch through ProjectContext's own punch-batch pure block (lifted
// and run, as validate-punch-batch does) down to the UPDATE row; C. executes
// utils/punchPlanPin.pinCropWindow; D. source pins on app/punch-list.tsx and
// components/punch/PunchEditPanes.tsx (comment-stripped).
//
// Run via: bun run scripts/validate-w4-punch-web-edit-layout.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { punchListTypeOf } from '../types';
import type { PunchItem } from '../types';
import { isDeviceLocalUri, buildPhotoStoragePath, photoExtFromUri, contentTypeForExt } from '../utils/photoUploadCore';
import {
  loadedImageAspect,
  punchEditLayout,
  punchEditPanelSize,
  punchPhotoActionBlocked,
  punchPhotoPatch,
  punchReplacementUpload,
  PUNCH_EDIT_FORM_FLEX,
  PUNCH_EDIT_PHOTO_FLEX,
  PUNCH_EDIT_PANEL_MAX_WIDTH,
  PUNCH_EDIT_PANEL_MARGIN,
  PUNCH_EDIT_SPLIT_MIN_WIDTH,
  PUNCH_PHOTO_LINKED_REASON,
} from '../utils/punchEditLayout';
import { pinCropWindow, PIN_CROP_FRACTION } from '../utils/punchPlanPin';

declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' }) => { transformSync(code: string): string };
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(label: string, got: T, want: T) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(label, g === w, g === w ? undefined : `got  ${g}\n      want ${w}`);
}
const read = (rel: string): string => { try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; } };
function stripTsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
function between(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  if (i < 0) return '';
  const j = src.indexOf(end, i + start.length);
  return j < 0 ? '' : src.slice(i, j);
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nA. which shape the sheet takes');
// ─────────────────────────────────────────────────────────────────────────────
eq('iPhone at any width keeps the sheet', ['ios', 'android'].map(p => punchEditLayout(1400, p)), ['sheet', 'sheet']);
eq('web below the desktop line keeps the sheet', [punchEditLayout(375, 'web'), punchEditLayout(899, 'web')], ['sheet', 'sheet']);
eq('web from the desktop line splits', [punchEditLayout(900, 'web'), punchEditLayout(1440, 'web')], ['split', 'split']);
eq('a width that is not a number keeps the sheet', [punchEditLayout(NaN, 'web'), punchEditLayout(Infinity, 'web')], ['sheet', 'sheet']);
{
  // One breakpoint with the rest of the app's desktop web layout.
  const rl = stripTsComments(read('utils/useResponsiveLayout.ts'));
  ok('the split line is the app\'s own desktop web line (useResponsiveLayout: isWeb && width >= 900)',
    PUNCH_EDIT_SPLIT_MIN_WIDTH === 900 && /isWeb\s*&&\s*width\s*>=\s*900/.test(rl), `const=${PUNCH_EDIT_SPLIT_MIN_WIDTH}`);
}
eq('form : photo is 75 % : 25 %', PUNCH_EDIT_FORM_FLEX / (PUNCH_EDIT_FORM_FLEX + PUNCH_EDIT_PHOTO_FLEX), 0.75);
eq('panel on a 1440×900 window leaves a margin', punchEditPanelSize(1440, 900), { width: 1280, height: 836 });
eq('panel on a 1000×700 window', punchEditPanelSize(1000, 700), { width: 1000 - 2 * PUNCH_EDIT_PANEL_MARGIN, height: 700 - 2 * PUNCH_EDIT_PANEL_MARGIN });
ok('panel never wider than its cap', punchEditPanelSize(4000, 2000).width === PUNCH_EDIT_PANEL_MAX_WIDTH);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nA2. what the photo buttons may do');
// ─────────────────────────────────────────────────────────────────────────────
const linked = { editing: true, linkedSourcePhotoId: 'photo-1', showingSavedPhoto: true };
eq('linked saved photo: Replace and Remove say why', [punchPhotoActionBlocked({ ...linked, action: 'replace' }), punchPhotoActionBlocked({ ...linked, action: 'remove' })], [PUNCH_PHOTO_LINKED_REASON, PUNCH_PHOTO_LINKED_REASON]);
eq('Add is never blocked', punchPhotoActionBlocked({ ...linked, action: 'add' }), null);
eq('an unlinked saved photo can be replaced and removed', [punchPhotoActionBlocked({ ...linked, linkedSourcePhotoId: undefined, action: 'replace' }), punchPhotoActionBlocked({ ...linked, linkedSourcePhotoId: null, action: 'remove' })], [null, null]);
eq('a new item\'s prefilled (gallery) photo can always be changed — nothing is on the server yet', punchPhotoActionBlocked({ editing: false, linkedSourcePhotoId: 'photo-1', showingSavedPhoto: false, action: 'replace' }), null);
ok('the reason names the way out', /Photos/.test(PUNCH_PHOTO_LINKED_REASON) && /markup/.test(PUNCH_PHOTO_LINKED_REASON));

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nB. a photo change, all the way to the UPDATE row');
// ─────────────────────────────────────────────────────────────────────────────
eq('keep adds no keys at all (an untouched Update writes what it always wrote)', Object.keys(punchPhotoPatch({ kind: 'keep' })), []);
{
  const r = punchPhotoPatch({ kind: 'replace', uri: 'data:image/jpeg;base64,AAAA' });
  eq('replace with no upload: the new file + the old durable path and local copy dropped (own keys)', [r.photoUri, 'photoStoragePath' in r, r.photoStoragePath, 'photoLocalUri' in r, r.photoLocalUri], ['data:image/jpeg;base64,AAAA', true, undefined, true, undefined]);
  const d = punchPhotoPatch({ kind: 'remove' });
  eq('remove: all three present as own undefined keys', ['photoUri', 'photoStoragePath', 'photoLocalUri'].map(k => k in d && (d as Record<string, unknown>)[k] === undefined), [true, true, true]);
}
{
  const RAW_CTX = read('contexts/ProjectContext.tsx');
  const block = between(RAW_CTX, '// ── punch-batch pure (begin)', '// ── punch-batch pure (end)');
  const durableFn = between(RAW_CTX, 'function durablePhotoValue(', '\n}');
  ok('the punch-batch pure block and durablePhotoValue were located', block.length > 0 && durableFn.length > 0);
  type Pure = {
    applyPunchBatchUpdate: (items: PunchItem[], ids: readonly string[], updates: Partial<PunchItem>, now: string, finish?: (i: PunchItem) => PunchItem) => { changed: PunchItem[]; cleared?: Record<string, string[]>; touched?: Record<string, string[]> };
    punchItemToUpdateRow: (pi: PunchItem, now: string, clears?: readonly string[], scope?: readonly string[]) => Record<string, unknown>;
  };
  let pure: Pure | null = null;
  try {
    const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(`${durableFn}\n}\n${block}\n`);
    pure = new Function('isDeviceLocalUri', 'punchListTypeOf', `${js}\nreturn { applyPunchBatchUpdate, punchItemToUpdateRow };`)(isDeviceLocalUri, punchListTypeOf) as Pure;
  } catch (e) {
    ok('the pure block evaluates standalone', false, String(e));
  }
  if (pure) {
    const NOW = '2026-09-22T12:00:00.000Z';
    const saved = {
      id: 'a', projectId: 'p1', description: 'Scratch', location: 'Hall', assignedSub: '', dueDate: '', priority: 'medium', status: 'open',
      photoUri: 'https://x.supabase.co/sign/u/p1/punch-a.jpg?token=t', photoStoragePath: 'u/p1/punch-a.jpg', photoLocalUri: 'file:///old.jpg',
      createdAt: NOW, updatedAt: NOW,
    } as PunchItem;
    const run = (patch: Partial<PunchItem>, finish?: (i: PunchItem) => PunchItem) => {
      // Exactly as ProjectContext.updatePunchItems calls it: the cleared pin
      // columns and — once the patch-scoped update (#46) is in — the keys the
      // edit touched. Without `touched` the row is the whole row, as before.
      const r = pure!.applyPunchBatchUpdate([saved], ['a'], { description: 'Scratch', ...patch }, NOW, finish);
      const merged = r.changed[0];
      return { merged, row: pure!.punchItemToUpdateRow(merged, NOW, r.cleared?.a ?? [], r.touched ? (r.touched.a ?? []) : undefined) };
    };
    const kept = run(punchPhotoPatch({ kind: 'keep' })).row;
    ok('keep: the photo is left as it is (not named in a scoped row, or the saved durable path in a whole row)',
      !('photo_uri' in kept) || kept.photo_uri === 'u/p1/punch-a.jpg', JSON.stringify(kept.photo_uri));
    const rem = run(punchPhotoPatch({ kind: 'remove' }));
    ok('remove: photo_uri goes out as an explicit NULL (not dropped by JSON)', rem.row.photo_uri === null && JSON.stringify(rem.row).includes('"photo_uri":null'), JSON.stringify(rem.row.photo_uri));
    ok('remove: the local row has no photo left to render', !rem.merged.photoUri && !rem.merged.photoStoragePath && !rem.merged.photoLocalUri);
    // The finish hook is where ProjectContext stages the upload. This stand-in
    // is FAITHFUL to stagePunchPhoto + stagePhotoUpload (the real path
    // builders, the real `punch-<id>` record id, the real "already staged
    // this exact file" skip) — a stand-in that invented a fresh path is what
    // hid the replace collision in round 1.
    const UID = 'u';
    let staged: string[] = [];
    const stage = (i: PunchItem): PunchItem => {
      if (!i.photoUri || !isDeviceLocalUri(i.photoUri)) return i;
      if (i.photoStoragePath && i.photoLocalUri === i.photoUri) return i;
      const path = buildPhotoStoragePath(UID, i.projectId, `punch-${i.id}`, photoExtFromUri(i.photoUri));
      staged.push(path);
      return { ...i, photoStoragePath: path, photoLocalUri: i.photoUri };
    };
    const BLOB = 'blob:https://app.mageid.app/6f1c2a4e-1111-2222-3333-444455556666';
    // The collision itself, from the real builders: the saved iPhone photo's
    // key and the web replacement's deterministic key are the same object.
    ok('(the hazard) a blob: replacement under the deterministic key IS the saved object',
      buildPhotoStoragePath(UID, 'p1', 'punch-a', photoExtFromUri(BLOB)) === saved.photoStoragePath,
      buildPhotoStoragePath(UID, 'p1', 'punch-a', photoExtFromUri(BLOB)));
    const up = punchReplacementUpload({ userId: UID, projectId: 'p1', itemId: 'a', uri: BLOB, mimeType: 'image/png', nowMs: Date.UTC(2026, 8, 22, 12) });
    ok('replace: the upload gets its own key, different from the saved photo\'s', !!up && up.storagePath !== saved.photoStoragePath && up.storagePath.startsWith('u/p1/punch-a-r'), JSON.stringify(up));
    ok('replace: the key keeps the uploader\'s folder first (storage RLS) and the picked file\'s type', !!up && up.storagePath.split('/')[0] === UID && up.storagePath.endsWith('.png') && up.contentType === 'image/png' && up.photoId === up.storagePath.split('/')[2].replace(/\.png$/, ''));
    const up2 = punchReplacementUpload({ userId: UID, projectId: 'p1', itemId: 'a', uri: BLOB, nowMs: Date.UTC(2026, 8, 22, 12, 5) });
    ok('a second replacement gets yet another key; no mime → the URI\'s type (jpg)', !!up && !!up2 && up2.storagePath !== up.storagePath && up2.storagePath.endsWith('.jpg') && up2.contentType === contentTypeForExt('jpg'));
    eq('nothing to stage → null (no user, no project, a remote URL, a bad clock)', [
      punchReplacementUpload({ userId: null, projectId: 'p1', itemId: 'a', uri: BLOB, nowMs: 1 }),
      punchReplacementUpload({ userId: UID, projectId: '', itemId: 'a', uri: BLOB, nowMs: 1 }),
      punchReplacementUpload({ userId: UID, projectId: 'p1', itemId: 'a', uri: 'https://x/y.jpg', nowMs: 1 }),
      punchReplacementUpload({ userId: UID, projectId: 'p1', itemId: 'a', uri: BLOB, nowMs: NaN }),
    ], [null, null, null, null]);
    staged = [];
    const rep = run(punchPhotoPatch({ kind: 'replace', uri: BLOB, mimeType: 'image/png' }, up), stage);
    ok('replace: the row names the replacement\'s NEW object (not the saved one), and nothing re-stages it under punch-<id>',
      !!up && rep.row.photo_uri === up.storagePath && rep.row.photo_uri !== saved.photoStoragePath && staged.length === 0,
      `staged=${JSON.stringify(staged)} photo_uri=${String(rep.row.photo_uri)}`);
    ok('replace: the local row shows the picked file and keeps it as the local copy', rep.merged.photoUri === BLOB && rep.merged.photoLocalUri === BLOB && rep.merged.photoStoragePath === up?.storagePath);
    staged = [];
    const bare = run(punchPhotoPatch({ kind: 'replace', uri: BLOB }), stage);
    ok('replace with nothing staged (no upload) falls back to the reset, which stagePunchPhoto picks up', staged.length === 1 && bare.row.photo_uri === staged[0], `staged=${JSON.stringify(staged)} photo_uri=${String(bare.row.photo_uri)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nC. the plan close-up window');
// ─────────────────────────────────────────────────────────────────────────────
{
  const cases: [number, number, number][] = [[0.5, 0.5, 2200 / 1700], [0.02, 0.97, 2200 / 1700], [0.9, 0.1, 3024 / 4032], [0.5, 0.5, 6], [1, 1, 1]];
  for (const [x, y, a] of cases) {
    const w = pinCropWindow(x, y, a);
    if (!w) { ok(`window exists for (${x},${y}) aspect ${a.toFixed(2)}`, false); continue; }
    // Pixels with the image a wide, 1 tall.
    const pxW = w.width * a;
    const pxH = w.height;
    ok(`(${x},${y}) aspect ${a.toFixed(2)}: square in pixels`, near(pxW, pxH), `${pxW} vs ${pxH}`);
    ok(`(${x},${y}) aspect ${a.toFixed(2)}: inside the sheet`, w.left >= 0 && w.top >= 0 && w.left + w.width <= 1 + 1e-12 && w.top + w.height <= 1 + 1e-12);
    ok(`(${x},${y}) aspect ${a.toFixed(2)}: the marker lands back on the pin`, near(w.left + w.pinX * w.width, x) && near(w.top + w.pinY * w.height, y));
  }
  const land = pinCropWindow(0.5, 0.5, 1.5);
  const port = pinCropWindow(0.5, 0.5, 0.75);
  ok('side is PIN_CROP_FRACTION of the long edge', !!land && !!port && near(land.width, PIN_CROP_FRACTION) && near(port.height, PIN_CROP_FRACTION));
  ok('a centred pin is centred', !!land && near(land.pinX, 0.5) && near(land.pinY, 0.5));
  eq('no aspect / NaN pin → no window (never a guessed one)', [pinCropWindow(0.5, 0.5, null), pinCropWindow(NaN, 0.5, 1), pinCropWindow(0.5, 0.5, 0)], [null, null, null]);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nD. the screen and the pane');
// ─────────────────────────────────────────────────────────────────────────────
{
  const src = stripTsComments(read('app/punch-list.tsx'));
  ok('punch-list decides the shape with punchEditLayout(window width, Platform.OS)', /punchEditLayout\(windowWidth,\s*Platform\.OS\)/.test(src) && /useWindowDimensions\(\)/.test(src));
  const sheet = between(src, "<View style={[styles.formCard, { paddingBottom: insets.bottom + 20 }]}>", '</View>');
  ok('the phone sheet keeps its order: header, stage, photo preview, fields, actions',
    /\{formHeaderEl\}\s*\{formPipelineEl\}\s*\{formPhotoPreviewEl\}\s*\{formFieldsEl\}\s*\{formActionsEl\}/.test(sheet), sheet.slice(0, 200));
  const split = between(src, "editLayout === 'split' ? (", ') : (');
  ok('the split panel holds the form at PUNCH_EDIT_FORM_FLEX and the pane at PUNCH_EDIT_PHOTO_FLEX',
    /flex:\s*PUNCH_EDIT_FORM_FLEX/.test(split) && /flex:\s*PUNCH_EDIT_PHOTO_FLEX/.test(split) && split.includes('<PunchEditPhotoPane'));
  ok('the split form still has every field and the actions', split.includes('{formFieldsEl}') && split.includes('{formActionsEl}') && split.includes('{formPipelineEl}') && split.includes('{formHeaderEl}'));
  ok('the split does not repeat the phone\'s small preview', !split.includes('{formPhotoPreviewEl}'));
  ok('the three pane buttons are wired to the one decision', /addBlocked=\{paneBlocked\('add'\)\}/.test(split) && /replaceBlocked=\{paneBlocked\('replace'\)\}/.test(split) && /removeBlocked=\{paneBlocked\('remove'\)\}/.test(split));
  const save = between(src, 'const handleSave = useCallback(', 'const startPhotoWalk');
  const upd = between(save, 'updatePunchItem(editingItem.id, {', '});');
  ok('Update spreads the photo change with its own upload (and only that decides the photo)', /\.\.\.punchPhotoPatch\(photoEdit, replacementUpload\)/.test(upd));
  const edBranch = between(save, 'if (editingItem) {', 'updatePunchItem(editingItem.id, {');
  ok('Update queues the replacement\'s bytes under punchReplacementUpload\'s key, from the picked file',
    /replacementUpload = punchReplacementUpload\(\{[\s\S]*uri: photoEdit\.uri[\s\S]*mimeType: photoEdit\.mimeType/.test(edBranch)
    && /queuePhotoUpload\(\{[\s\S]*photoId: replacementUpload\.photoId[\s\S]*localUri: photoEdit\.uri[\s\S]*storagePath: replacementUpload\.storagePath[\s\S]*contentType: replacementUpload\.contentType/.test(edBranch),
    edBranch.slice(0, 300));
  ok('handleSave lists photoEdit in its deps (no stale Update)', /\[description,[^\]]*photoEdit\]/.test(save));
  const reset = between(src, 'const resetForm = useCallback(', '}, [activeList]);');
  const openEdit = between(src, 'const openEditForm = useCallback(', '}, [pickerSubs');
  ok('resetForm and openEditForm both start the photo change at keep', /setPhotoEdit\(\{ kind: 'keep' \}\)/.test(reset) && /setPhotoEdit\(\{ kind: 'keep' \}\)/.test(openEdit));
  const pick = between(src, 'const pickPanePhoto = useCallback(', '}, [editingItem, attachNewItemPhoto]);');
  const attach = between(src, 'const attachNewItemPhoto = useCallback(', '}, []);');
  ok('picking on an existing item is a pending replace; on a new item it drops the gallery link',
    /setPhotoEdit\(\{ kind: 'replace', uri, mimeType: asset\?\.mimeType \?\? null \}\)/.test(pick) && /attachNewItemPhoto\(uri, undefined\)/.test(pick)
    && /setAttachedPhotoUri\(uri\);\s*setAttachedSourcePhotoId\(sourcePhotoId\);/.test(attach));
  const markup = between(src, 'const paneMarkup = useMemo(', '}, [editingItem');
  ok('a photo chosen here never borrows the old photo\'s markup', /photoEdit\.kind === 'keep' \?[\s\S]*: \[\]/.test(markup));

  const pane = stripTsComments(read('components/punch/PunchEditPanes.tsx'));
  ok('the pane draws the photo in a square cover frame with the markup overlay', /aspectRatio:\s*1/.test(pane) && /resizeMode="cover"/.test(pane) && pane.includes('<PhotoMarkupOverlay markup={p.markup} />'));
  ok('the photo taps through to the full-size viewer', /onPress=\{p\.onOpenPhoto\}/.test(pane));
  ok('no photo → an Add photo drop zone', pane.includes('testID="punch-edit-photo-add"') && pane.includes('Add photo'));
  ok('a blocked button is drawn disabled with its reason under it', /disabled=\{!!p\.replaceBlocked\}/.test(pane) && /disabled=\{!!p\.removeBlocked\}/.test(pane) && pane.includes('testID="punch-edit-photo-blocked"'));
  ok('the close-up uses pinCropWindow and waits for a real aspect', /pinCropWindow\(pin\.x,\s*pin\.y,\s*aspect\)/.test(pane) && /aspect \? pinCropWindow/.test(pane));
  ok('PunchPhotoViewer is mounted inside the form Modal for the pane', /<PunchPhotoViewer[\s\S]*visible=\{paneViewerOpen && editLayout === 'split'\}/.test(src));
}

console.log('\nThe plan close-up on web (integration round 1)');
{
  // react-native-web's Image onLoad hands over the DOM event: no `source`,
  // the shape is on the <img> target.
  ok('native: the shape comes from nativeEvent.source', loadedImageAspect({ source: { width: 2459, height: 1349 } }) === 2459 / 1349);
  ok('web: the shape comes from target.naturalWidth/Height', loadedImageAspect({ target: { naturalWidth: 1114, naturalHeight: 1290 } }) === 1114 / 1290);
  ok('no usable shape → null (never a guessed aspect)',
    loadedImageAspect({}) === null && loadedImageAspect(undefined) === null && loadedImageAspect({ target: { naturalWidth: 0, naturalHeight: 0 } }) === null);
  const panes = read('components/punch/PunchEditPanes.tsx');
  ok('the close-up reads its shape through loadedImageAspect', /const a = loadedImageAspect\(e\.nativeEvent\);/.test(panes) && !/\.nativeEvent as \{ source\?/.test(panes));
  ok('no shape at all → the pin row says the close-up is not available (no blank square)',
    /!w && shapeUnknown \? \(/.test(panes) && /close-up not available/.test(panes) && /else setShapeUnknown\(true\);/.test(panes));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
