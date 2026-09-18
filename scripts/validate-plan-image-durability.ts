// validate-plan-image-durability.ts — a plan sheet created from a picture must
// store a DURABLE image: an uploaded plan-sheets path, never '' and never a
// device-local file:// / blob: uri.
//
// WHY. app/plans.tsx "Import image" called addPlanSheet with the ImagePicker
// file:// and uploaded nothing. ProjectContext correctly strips a device-local
// uri before Postgres (durablePlanSheetValue, audit DB-F11), so
// plan_sheets.image_uri landed as ''. Production 2026-09-17: the founder's only
// sheet, "IMG_1668" on Watermark 9F, is that row — blank on every device, so
// the punch walk's new "photo, then pin" step had no plan to show.
//
// What this pins, by EXECUTING the real modules against a stubbed storage
// client (not by grepping):
//   1. addFloorPlan uploads FIRST and only then creates the sheet, with a
//      project-scoped storagePath; the value ProjectContext would persist
//      (durablePlanSheetValue) is that path.
//   2. Every failure (no signal, RLS refusal, HEIC, oversize, non-uuid project,
//      zero bytes, unconfigured build) creates NO sheet, and says why.
//   3. The upload goes to plan-sheets, upsert:false, with a jpeg/png type and
//      real bytes.
//   4. Repair keeps the sheet id and writes nothing unless the upload landed.
//   5. The actions are resolved AFTER the upload (stale-closure guard).
//   6. Source: app/plans.tsx no longer hands a picker uri to addPlanSheet;
//      ProjectContext still routes image_uri through durablePlanSheetValue on
//      insert and update; the INSERT policy migration exists and is scoped.
//
// Run: bun run scripts/validate-plan-image-durability.ts

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    `got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
}

// ── stub the network / RN edges ─────────────────────────────────────────────
const log: string[] = [];
let uploadError: { message: string; status?: number } | null = null;
let uploads: { bucket: string; path: string; size: number; opts: { contentType?: string; upsert?: boolean } }[] = [];
let bytesToReturn: Uint8Array = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
let readThrows: Error | null = null;
const pickerLaunches: { kind: 'camera' | 'library'; opts: Record<string, unknown> }[] = [];

const supabaseStub = {
  storage: {
    from: (bucket: string) => ({
      upload: async (path: string, bytes: Uint8Array, opts: { contentType?: string; upsert?: boolean }) => {
        log.push('upload');
        if (uploadError) return { data: null, error: uploadError };
        uploads.push({ bucket, path, size: bytes?.byteLength ?? 0, opts });
        return { data: { path }, error: null };
      },
      createSignedUrls: async () => ({ data: [], error: null }),
    }),
  },
};

interface VirtualModuleBuilder {
  module(specifier: string, cb: () => { exports: Record<string, unknown>; loader: 'object' }): void;
}
interface BunGlobal {
  plugin(def: { name: string; setup: (build: VirtualModuleBuilder) => void }): void;
}
const bun = (globalThis as unknown as { Bun?: BunGlobal }).Bun;
if (!bun) {
  console.error('\n✗ validate-plan-image-durability must run under bun (needs Bun.plugin)\n');
  process.exit(1);
}
bun.plugin({
  name: 'stub-edges-for-plan-image-durability',
  setup(build) {
    build.module('@/lib/supabase', () => ({
      exports: {
        supabase: supabaseStub,
        isSupabaseConfigured: true,
      },
      loader: 'object',
    }));
    build.module('react-native', () => ({ exports: { Platform: { OS: 'ios' } }, loader: 'object' }));
    // expo-image-picker: records what pickFloorPlanImage ASKS the native
    // picker for. The enum values are the library's own string values
    // (ImagePicker.types.ts), which is what the Swift side decodes.
    build.module('expo-image-picker', () => ({
      exports: {
        UIImagePickerPreferredAssetRepresentationMode: { Automatic: 'automatic', Compatible: 'compatible', Current: 'current' },
        requestCameraPermissionsAsync: async () => ({ status: 'granted' }),
        requestMediaLibraryPermissionsAsync: async () => ({ status: 'granted' }),
        launchCameraAsync: async (opts: Record<string, unknown>) => {
          pickerLaunches.push({ kind: 'camera', opts });
          return { canceled: false, assets: [{ uri: 'file:///cam.jpg', width: 4032, height: 3024, mimeType: 'image/jpeg' }] };
        },
        launchImageLibraryAsync: async (opts: Record<string, unknown>) => {
          pickerLaunches.push({ kind: 'library', opts });
          return { canceled: false, assets: [{ uri: 'file:///lib.jpg', width: 1114, height: 1349, mimeType: 'image/jpeg', fileName: 'IMG_1668.jpg' }] };
        },
      },
      loader: 'object',
    }));
    build.module('@/utils/fileBytes', () => ({
      exports: {
        readFileBytes: async () => {
          log.push('read');
          if (readThrows) throw readThrows;
          return bytesToReturn;
        },
      },
      loader: 'object',
    }));
  },
});

const core = await import('../utils/planSheetImageCore');
const { addFloorPlan, attachFloorPlanImage, uploadDeviceOnlyFloorPlan } = await import('../utils/addFloorPlan');
const { durablePlanSheetValue, isProjectScopedPlanSheetPath, PLAN_SHEET_BUCKET } = await import('../utils/planSheetUrls');

const PROJECT = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const PHOTO = { uri: 'file:///var/mobile/Containers/Data/tmp/ImagePicker/IMG_1668.jpg', width: 3024, height: 4032, mimeType: 'image/jpeg', fileName: 'IMG_1668.JPG', fileSize: 2_400_000 };

type Sheet = { id: string; projectId: string; name: string; imageUri: string; storagePath?: string; width?: number; height?: number; sheetNumber?: string; pageNumber?: number; createdAt: string; updatedAt: string };

function makeActions() {
  const created: Sheet[] = [];
  const updates: { id: string; patch: Partial<Sheet> }[] = [];
  const actions = {
    addPlanSheet: (input: Omit<Sheet, 'id' | 'createdAt' | 'updatedAt'>) => {
      log.push('addPlanSheet');
      const s = { ...input, id: `sheet-${created.length + 1}`, createdAt: 'now', updatedAt: 'now' } as Sheet;
      created.push(s);
      return s as never;
    },
    updatePlanSheet: (id: string, patch: Partial<Sheet>) => {
      log.push('updatePlanSheet');
      updates.push({ id, patch });
    },
  };
  return { created, updates, actions };
}
function reset() {
  log.length = 0; uploads = []; uploadError = null; readThrows = null;
  bytesToReturn = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
}
/** What ProjectContext.addPlanSheet writes to plan_sheets.image_uri for a created sheet. */
const persisted = (s: Sheet) => durablePlanSheetValue(s.storagePath, s.imageUri);

// ── 1. the happy path: upload, then create, durable path persisted ─────────
console.log('\naddFloorPlan stores a durable image:');
reset();
{
  const { created, actions } = makeActions();
  const r = await addFloorPlan({ projectId: PROJECT, image: PHOTO }, actions as never);
  ok('resolves ok', r.ok === true, JSON.stringify(r));
  eq('exactly one sheet created', created.length, 1);
  eq('upload happens BEFORE the sheet is created', log.filter(x => x !== 'read'), ['upload', 'addPlanSheet']);
  const s = created[0];
  ok('the sheet carries a storagePath', !!s?.storagePath, JSON.stringify(s));
  ok('storagePath is project-scoped (folder[1] = project uuid)', isProjectScopedPlanSheetPath(s?.storagePath) && s.storagePath!.startsWith(`${PROJECT}/`), s?.storagePath);
  eq('the storagePath is the object that was uploaded', s?.storagePath, uploads[0]?.path);
  const durable = s ? persisted(s) : '';
  ok('the persisted image_uri is not empty', durable.length > 0, `persisted: "${durable}"`);
  ok('the persisted image_uri is not device-local', !/^(file|blob|data|content|ph|assets-library):/i.test(durable), durable);
  ok('core agrees it is a durable value', core.isDurablePlanImageValue(durable));
  eq('imageUri stays the local capture so it renders right now', s?.imageUri, PHOTO.uri);
  eq('name defaults to the file name without extension', s?.name, 'IMG_1668');
  eq('dimensions carried', [s?.width, s?.height], [3024, 4032]);
  eq('uploaded to the plan-sheets bucket', uploads[0]?.bucket, PLAN_SHEET_BUCKET);
  eq('never overwrites an object (upsert false)', uploads[0]?.opts.upsert, false);
  eq('jpeg content type', uploads[0]?.opts.contentType, 'image/jpeg');
  ok('real bytes went up', (uploads[0]?.size ?? 0) > 0);
  ok('result.storagePath matches', r.ok && r.storagePath === s?.storagePath);
}

// PNG on web: a blob: uri with no suffix must be typed by its mime type.
reset();
{
  const { created, actions } = makeActions();
  const r = await addFloorPlan({ projectId: PROJECT, image: { uri: 'blob:https://app.mageid.app/abc', mimeType: 'image/png', width: 10, height: 10 }, name: 'Level 1' }, actions as never);
  ok('web png upload resolves ok', r.ok);
  ok('png path ends .png', !!created[0]?.storagePath?.endsWith('.png'), created[0]?.storagePath);
  eq('png content type', uploads[0]?.opts.contentType, 'image/png');
  eq('explicit name wins', created[0]?.name, 'Level 1');
}

// ── 2. failures create nothing ─────────────────────────────────────────────
console.log('\nevery failure creates NO sheet and says why:');
async function expectNoSheet(label: string, run: (a: ReturnType<typeof makeActions>['actions']) => Promise<{ ok: boolean; reason?: string; kind?: string }>, wantKind?: string) {
  const { created, updates, actions } = makeActions();
  const r = await run(actions);
  ok(`${label}: not ok`, r.ok === false, JSON.stringify(r));
  eq(`${label}: no sheet created`, created.length, 0);
  eq(`${label}: no sheet updated`, updates.length, 0);
  ok(`${label}: has a reason`, !!r.reason && r.reason.length > 20, r.reason);
  if (wantKind) eq(`${label}: kind`, r.kind, wantKind);
}
reset(); uploadError = { message: 'Network request failed' };
await expectNoSheet('no signal', a => addFloorPlan({ projectId: PROJECT, image: PHOTO }, a as never), 'transient');
reset(); uploadError = { message: 'new row violates row-level security policy', status: 403 };
await expectNoSheet('RLS refusal (policy not applied / not an editor)', a => addFloorPlan({ projectId: PROJECT, image: PHOTO }, a as never), 'rls-pending');
// A fresh object name cannot already exist, and the error carries no path to
// adopt — "already exists" must not be mistaken for a stored plan.
reset(); uploadError = { message: 'The resource already exists', status: 409 };
await expectNoSheet('already-exists with no adoptable path', a => addFloorPlan({ projectId: PROJECT, image: PHOTO }, a as never), 'retryable');
reset(); uploadError = { message: 'Internal Server Error', status: 500 };
await expectNoSheet('server error', a => addFloorPlan({ projectId: PROJECT, image: PHOTO }, a as never), 'retryable');
reset();
await expectNoSheet('HEIC', a => addFloorPlan({ projectId: PROJECT, image: { uri: 'file:///x/IMG_1.HEIC', mimeType: 'image/heic' } }, a as never), 'unsupported-format');
eq('HEIC never uploaded', log.includes('upload'), false);
reset();
await expectNoSheet('oversize', a => addFloorPlan({ projectId: PROJECT, image: { ...PHOTO, fileSize: 60 * 1024 * 1024 } }, a as never), 'too-large');
reset();
await expectNoSheet('non-uuid project (tmp prefix)', a => addFloorPlan({ projectId: 'tmp', image: PHOTO }, a as never), 'project-not-synced');
eq('non-uuid project never uploaded', log.includes('upload'), false);
reset();
await expectNoSheet('no image', a => addFloorPlan({ projectId: PROJECT, image: { uri: '' } }, a as never), 'no-image');
reset(); bytesToReturn = new Uint8Array(0);
await expectNoSheet('zero-byte read', a => addFloorPlan({ projectId: PROJECT, image: PHOTO }, a as never), 'terminal');
eq('zero bytes never uploaded', log.includes('upload'), false);
reset(); readThrows = new Error('File does not exist');
await expectNoSheet('purged picker file', a => addFloorPlan({ projectId: PROJECT, image: PHOTO }, a as never), 'terminal');
// (An unconfigured build — isSupabaseConfigured false — is a static import
// binding the virtual module cannot toggle mid-run; the refusal is pinned at
// source level below instead.)

// ── 3. repair keeps the id; writes only after upload ───────────────────────
console.log('\nrepairing an empty sheet (IMG_1668):');
const EMPTY: Sheet = { id: 'watermark-9f', projectId: PROJECT, name: 'IMG_1668', imageUri: '', createdAt: 'x', updatedAt: 'x' };
eq('an empty row reads as missing', core.planSheetImageState(EMPTY), 'missing');
eq('a file:// row reads as device-only', core.planSheetImageState({ imageUri: PHOTO.uri }), 'device-only');
eq('a path reads as durable', core.planSheetImageState({ imageUri: 'x', storagePath: `${PROJECT}/a.png` }), 'durable');
// Right after a repair the in-memory imageUri is still the local capture; the
// path is what makes it durable, so the row must not keep nagging "upload".
eq('a path + local capture reads as durable', core.planSheetImageState({ imageUri: PHOTO.uri, storagePath: `${PROJECT}/a.png` }), 'durable');
eq('a legacy https url reads as durable', core.planSheetImageState({ imageUri: 'https://h/storage/v1/object/public/plan-sheets/p/a.png' }), 'durable');
reset();
{
  const { created, updates, actions } = makeActions();
  const r = await attachFloorPlanImage(EMPTY as never, PHOTO, actions as never);
  ok('repair ok', r.ok);
  eq('no new sheet', created.length, 0);
  eq('updates the SAME sheet id', updates.map(u => u.id), ['watermark-9f']);
  eq('upload before update', log.filter(x => x !== 'read'), ['upload', 'updatePlanSheet']);
  const merged = { ...EMPTY, ...updates[0]?.patch } as Sheet;
  ok('repaired row persists a durable project path', core.isDurablePlanImageValue(persisted(merged)) && isProjectScopedPlanSheetPath(persisted(merged)), persisted(merged));
}
reset(); uploadError = { message: 'Network request failed' };
await expectNoSheet('repair with no signal', a => attachFloorPlanImage(EMPTY as never, PHOTO, a as never), 'transient');
reset();
{
  const { updates, actions } = makeActions();
  const local = { ...EMPTY, imageUri: PHOTO.uri };
  const r = await uploadDeviceOnlyFloorPlan(local as never, actions as never);
  ok('device-only sheet uploads its own local file', r.ok && updates[0]?.id === 'watermark-9f' && !!updates[0]?.patch.storagePath);
}
reset();
await expectNoSheet('device-only upload on a missing sheet', a => uploadDeviceOnlyFloorPlan(EMPTY as never, a as never), 'no-image');

// ── 4. actions are read after the upload ───────────────────────────────────
console.log('\nactions resolved at write time, not before the upload:');
reset();
{
  const stale = makeActions();
  const fresh = makeActions();
  let current = stale.actions;
  let getterCalledBeforeUpload = false;
  const p = addFloorPlan({ projectId: PROJECT, image: PHOTO }, () => {
    if (!log.includes('upload')) getterCalledBeforeUpload = true;
    return current as never;
  });
  current = fresh.actions; // a hydration landed while the upload was in flight
  await p;
  eq('the getter is not read before the upload', getterCalledBeforeUpload, false);
  eq('the fresh addPlanSheet was used', [stale.created.length, fresh.created.length], [0, 1]);
}

// ── 5. pure helpers ────────────────────────────────────────────────────────
console.log('\npure helpers:');
eq('path shape', core.buildPlanSheetImagePath(PROJECT, 'abc', 'jpg'), `${PROJECT}/img-abc.jpg`);
eq('non-uuid project → null', core.buildPlanSheetImagePath('tmp', 'abc', 'jpg'), null);
eq('user-first photo path is not project-scoped', isProjectScopedPlanSheetPath('user-1/' + PROJECT + '/x.jpg'), false);
eq('webp refused', core.planSheetImageFormat('blob:x', 'image/webp'), null);
eq('suffix png', core.planSheetImageFormat('file:///a/b.PNG')?.ext, 'png');
eq('suffix heic refused', core.planSheetImageFormat('file:///a/b.heic'), null);
eq('no suffix defaults to jpg (camera)', core.planSheetImageFormat('file:///a/b')?.ext, 'jpg');
eq('file:// is not durable', core.isDurablePlanImageValue('file:///a.jpg'), false);
eq('empty is not durable', core.isDurablePlanImageValue(''), false);
eq('name fallback', core.floorPlanNameFromFile(null, 'Floor plan'), 'Floor plan');

// ── 5b. HEIC from Photos, the real bucket limit (critic 2026-09-17 #1, #4) ──
console.log('\nthe iOS library pick asks for a JPEG, and the size limit is the LIVE bucket\'s:');
{
  const { pickFloorPlanImage } = await import('../utils/pickFloorPlanImage');
  pickerLaunches.length = 0;
  const lib = await pickFloorPlanImage('library');
  ok('library pick resolves', lib.status === 'picked');
  const libOpts = pickerLaunches.find(l => l.kind === 'library')?.opts ?? {};
  // expo-image-picker 17's native default is `.current` (ImagePickerOptions.swift),
  // which hands back the HEIC original at ANY quality (ImageUtils.swift
  // `case UTType.heic.identifier: return (rawData, ".heic")`). Only
  // `.compatible` makes PHPicker transcode to JPEG.
  eq('iOS library launch requests preferredAssetRepresentationMode Compatible', libOpts.preferredAssetRepresentationMode, 'compatible');
  eq('…images only', libOpts.mediaTypes, ['images']);
  pickerLaunches.length = 0;
  await pickFloorPlanImage('camera');
  const camOpts = pickerLaunches.find(l => l.kind === 'camera')?.opts ?? {};
  ok('the camera launch is used for camera (it already captures JPEG)', pickerLaunches[0]?.kind === 'camera');
  eq('…and does not carry the library-only option', camOpts.preferredAssetRepresentationMode, undefined);
}
eq('PLAN_SHEET_MAX_BYTES is the production bucket file_size_limit (10485760)', core.PLAN_SHEET_MAX_BYTES, 10485760);
reset();
await expectNoSheet('an 11 MB library photo', a => addFloorPlan({ projectId: PROJECT, image: { ...PHOTO, fileSize: 11 * 1024 * 1024 } }, a as never), 'too-large');
eq('an 11 MB image never uploaded', log.includes('upload'), false);
reset();
{
  const { created, actions } = makeActions();
  const r = await addFloorPlan({ projectId: PROJECT, image: { ...PHOTO, fileSize: 9 * 1024 * 1024 } }, actions as never);
  ok('a 9 MB image still goes up', r.ok && created.length === 1);
}
// No fileSize from the picker (some web/Android paths): Storage refuses, and
// that must read as too-large, not a "Try again" that can never succeed.
reset(); uploadError = { message: 'The object exceeded the maximum allowed size', status: 413 };
await expectNoSheet('Storage size refusal', a => addFloorPlan({ projectId: PROJECT, image: { ...PHOTO, fileSize: null } }, a as never), 'too-large');
reset(); uploadError = { message: 'Payload too large' };
await expectNoSheet('gateway size refusal', a => addFloorPlan({ projectId: PROJECT, image: { ...PHOTO, fileSize: null } }, a as never), 'too-large');
reset(); uploadError = { message: 'Request failed', status: 413 };
await expectNoSheet('a bare 413', a => addFloorPlan({ projectId: PROJECT, image: { ...PHOTO, fileSize: null } }, a as never), 'too-large');
ok('too-large copy names the real 10 MB limit', /under 10 MB/.test(core.floorPlanFailureReason('too-large', '11.0')) && !/50/.test(core.floorPlanFailureReason('too-large')),
  core.floorPlanFailureReason('too-large', '11.0'));
ok('too-large copy does not say "Try again"', !/try again/i.test(core.floorPlanFailureReason('too-large')));
for (const k of ['terminal', 'no-image', 'unsupported-format', 'too-large'] as const) {
  eq(`re-pick after a device-only upload fails '${k}'`, core.shouldRepickAfterDeviceUploadFailure(k), true);
}
for (const k of ['transient', 'rls-pending', 'project-not-synced', 'not-configured', 'retryable'] as const) {
  eq(`no re-pick after '${k}' (a new image fails the same way)`, core.shouldRepickAfterDeviceUploadFailure(k), false);
}
reset();
{
  // The old full-quality import kept the HEIC original on the phone: uploading
  // it is refused before any bytes move, with a kind that sends the repair on
  // to a fresh pick.
  const { updates, actions } = makeActions();
  const heicLocal = { ...EMPTY, imageUri: 'file:///var/mobile/tmp/ImagePicker/IMG_1668.heic' };
  const r = await uploadDeviceOnlyFloorPlan(heicLocal as never, actions as never);
  ok('a device-only HEIC is refused as unsupported-format', !r.ok && r.kind === 'unsupported-format');
  ok('…which the repair re-picks for', !r.ok && core.shouldRepickAfterDeviceUploadFailure(r.kind));
  eq('…and nothing was written', updates.length, 0);
}

// ── 6. source-level ────────────────────────────────────────────────────────
console.log('\nsource:');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const plans = read('app/plans.tsx');
{
  const repair = plans.slice(plans.indexOf('const handleRepairImage'), plans.indexOf('const handleDelete'));
  ok('plans.tsx repair re-picks via shouldRepickAfterDeviceUploadFailure (HEIC/oversize/gone), not only on terminal',
    /if \(!shouldRepickAfterDeviceUploadFailure\(direct\.kind\)\)/.test(repair) && !/direct\.kind !== 'terminal'/.test(repair));
  // A blocked control says why: the re-pick branch must explain (with the
  // upload's own reason) before the photo library opens, and only on his tap.
  const afterRepickTest = repair.slice(repair.indexOf('if (!shouldRepickAfterDeviceUploadFailure(direct.kind))'));
  const repickBranch = afterRepickTest.slice(afterRepickTest.indexOf('}') + 1);
  ok('the re-pick after a failed device upload says why before the picker opens',
    /showAlert\([^;]*direct\.reason[^;]*onPress:\s*\(\)\s*=>\s*\{\s*void repickAndAttach\(sheet\)/.test(repickBranch)
    && !/pickFloorPlanImage\(/.test(repair), repickBranch.slice(0, 400));
}
const confirmStart = plans.indexOf('const confirmImport');
const confirmBody = confirmStart >= 0 ? plans.slice(confirmStart, plans.indexOf('useCallback(', plans.indexOf('}, [', confirmStart))) : '';
ok('plans.tsx confirmImport goes through addFloorPlan', /addFloorPlan\(/.test(confirmBody), 'Import image must upload before creating the sheet.');
ok('plans.tsx confirmImport no longer calls addPlanSheet directly', !/addPlanSheet\(/.test(confirmBody));
// The only direct addPlanSheet in plans.tsx is the PDF path, which passes a storagePath.
const directAdds = [...plans.matchAll(/addPlanSheet\(\{([\s\S]*?)\}\);/g)].map(m => m[1]);
ok('every direct addPlanSheet in plans.tsx passes a storagePath', directAdds.every(b => /storagePath:/.test(b)), directAdds.join('\n---\n'));
const addFp = read('utils/addFloorPlan.ts');
ok('addFloorPlan has no device-only fallback that creates a sheet without a path',
  !/addPlanSheet\([^)]*imageUri:\s*[a-zA-Z.]*uri[^)]*\)/.test(addFp) && (addFp.match(/addPlanSheet\(/g) ?? []).length === 1);
const ctx = read('contexts/ProjectContext.tsx');
ok('ProjectContext insert writes image_uri through durablePlanSheetValue',
  /image_uri:\s*durablePlanSheetValue\(fresh\.storagePath,\s*fresh\.imageUri\)/.test(ctx));
ok('ProjectContext update writes image_uri through durablePlanSheetValue',
  /patch\.image_uri\s*=\s*durablePlanSheetValue\(/.test(ctx));
const uploadSrc = read('utils/planSheetImageUpload.ts').replace(/\/\/.*$/gm, '');
ok('upload never uses fetch().blob()', !/\.blob\(\)/.test(uploadSrc));
ok('upload reads bytes via readFileBytes', /readFileBytes\(/.test(uploadSrc));
ok('an unconfigured build refuses before reading or uploading',
  /if \(!isSupabaseConfigured\) throw/.test(uploadSrc)
  && uploadSrc.indexOf('!isSupabaseConfigured') < uploadSrc.indexOf('readFileBytes('));
const migDir = join(ROOT, 'supabase/migrations');
const migName = readdirSync(migDir).find(f => /plan_sheets_member_insert\.sql$/.test(f));
ok('the plan-sheets INSERT policy migration exists', !!migName);
if (migName) {
  const sql = readFileSync(join(migDir, migName), 'utf8').replace(/--.*$/gm, '');
  ok('policy is FOR INSERT TO authenticated', /for\s+insert\s+to\s+authenticated/i.test(sql));
  ok('policy is scoped to plan-sheets + editor of folder[1]',
    /bucket_id\s*=\s*'plan-sheets'/.test(sql) && /can_access_project\(\(storage\.foldername\(name\)\)\[1\],\s*'editor'\)/.test(sql));
  ok('policy does not use the invalid CREATE POLICY IF NOT EXISTS', !/create\s+policy\s+if\s+not\s+exists/i.test(sql));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
