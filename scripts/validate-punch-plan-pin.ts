// scripts/validate-punch-plan-pin.ts — photo, then pin, then description.
//
// WHY THIS EXISTS. The founder, on a real punch walk (2026-09-17): "After
// taking photo, a picture plan of floor plan should come up and you should be
// able to pin the location." The pin step (components/punch/PlanPinStep.tsx,
// wired into app/punch-walk.tsx) is a feature whose failures are all silent:
//
//   • a pin normalised against the letterboxed CONTAINER instead of the image
//     still draws a tidy marker on the step that placed it — and lands a
//     door-width away in app/plan-viewer.tsx, which is where the sub looks;
//   • a walk that opens the form before the plan is the old flow with a new
//     button nobody presses;
//   • handleSave forgetting the pin fields saves a perfectly valid item with no
//     pin, and nothing on screen says it was ever placed;
//   • Skip writing `planSheetId: undefined`-shaped junk, or a stale pin from the
//     previous item, files a defect on the wrong drawing.
//
// HOW IT CHECKS.
//   1. utils/punchPlanPin.ts is pure and EXECUTED here: the contain rect, tap
//      normalisation, the marker round trip, zoom invariance, the drag grab,
//      the default-sheet choice, the existing-pin overlay and the save fields.
//   2. plan-viewer's drawing math is read out of its source and asserted equal
//      to pinMarkerPosition, so the two cannot drift apart unnoticed.
//   3. Source pins on comment-stripped text: punch-walk opens the pin step from
//      the camera handler before the form, handleSave spreads the pin fields,
//      Skip clears the pin, and the step goes through utils/addFloorPlan.
//
// Run via: bun run scripts/validate-punch-plan-pin.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PIN_MARKER_SIZE,
  choosePinSheet,
  containImageRect,
  isPinnableSheet,
  isTouchOnPin,
  normalizeTapToImage,
  offerablePinSheets,
  pinMarkerPosition,
  pinSheetLabel,
  pinTipFromMarker,
  pinStepImageSource,
  pinnableSheetCount,
  durablePinSheetCount,
  imageLoadAspectRatio,
  isDurablePinSheet,
  pinStepSheetMode,
  planViewerImageRatio,
  pinsOnSheet,
  planSheetPublicObjectUrl,
  planUploadBlockedReason,
  punchPinFields,
  sheetAspectRatio,
  shouldAutoOpenPinStep,
} from '../utils/punchPlanPin';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(label: string, got: T, want: T, why?: string) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(label, g === w, g === w ? undefined : `got  ${g}\n      want ${w}${why ? `\n      ${why}` : ''}`);
}
function near(label: string, got: number | undefined | null, want: number, eps = 1e-9) {
  ok(label, typeof got === 'number' && Math.abs(got - want) <= eps, `got ${got}, want ${want}`);
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

// ───────────────────────────────────────────────────────────────────────────
console.log('\ncontain rect — the image, not the container');
// ───────────────────────────────────────────────────────────────────────────
{
  // A landscape plan (2:1) on a portrait phone canvas: full width, letterboxed
  // top and bottom.
  const r = containImageRect({ w: 390, h: 600 }, 2);
  near('landscape plan on portrait canvas: full width', r?.w, 390);
  near('landscape plan on portrait canvas: height = width / ratio', r?.h, 195);
  near('…centred vertically', r?.top, (600 - 195) / 2);
  near('…no horizontal bar', r?.left, 0);

  // A portrait plan (0.5) on a wide web canvas: full height, bars at the sides.
  const w = containImageRect({ w: 1200, h: 700 }, 0.5);
  near('portrait plan on wide canvas: full height', w?.h, 700);
  near('portrait plan on wide canvas: width = height × ratio', w?.w, 350);
  near('…centred horizontally', w?.left, (1200 - 350) / 2);

  const same = containImageRect({ w: 400, h: 200 }, 2);
  eq('ratio equal to the container fills it exactly', same, { w: 400, h: 200, left: 0, top: 0 });

  eq('unknown ratio → null, no box to normalise against', containImageRect({ w: 390, h: 600 }, null), null);
  eq('unmeasured container → null', containImageRect(null, 2), null);
  eq('zero-height container → null, never Infinity', containImageRect({ w: 390, h: 0 }, 2), null);
  eq('NaN ratio → null', containImageRect({ w: 390, h: 600 }, Number.NaN), null);
}

console.log('\nsheet aspect ratio — known before the image loads');
eq('stored width/height give the ratio', sheetAspectRatio({ width: 3000, height: 2000 }), 1.5);
eq('missing height → null (fall back to onLoad)', sheetAspectRatio({ width: 3000 }), null);
eq('zero width → null', sheetAspectRatio({ width: 0, height: 10 }), null);
eq('no sheet → null', sheetAspectRatio(null), null);

// ───────────────────────────────────────────────────────────────────────────
console.log('\ntap normalisation and the plan-viewer round trip');
// ───────────────────────────────────────────────────────────────────────────
{
  const box = { w: 390, h: 195 };
  eq('centre tap → (0.5, 0.5)', normalizeTapToImage(195, 97.5, box), { x: 0.5, y: 0.5 });
  eq('top-left corner → (0, 0)', normalizeTapToImage(0, 0, box), { x: 0, y: 0 });
  eq('a thumb past the edge clamps to the sheet', normalizeTapToImage(420, -12, box), { x: 1, y: 0 });
  eq('unmeasured box → null, never a NaN pin', normalizeTapToImage(10, 10, null), null);
  eq('NaN touch → null', normalizeTapToImage(Number.NaN, 10, box), null);

  // THE CONTAINER BUG, stated as a number. Same physical tap, 3/4 of the way
  // down the plan: against the image box it is y = 0.75; against a 600pt
  // container that letterboxes the plan it would read (202.5 + 146.25) / 600.
  const rect = containImageRect({ w: 390, h: 600 }, 2)!;
  const tapInBoxY = 0.75 * rect.h;
  const wrongY = (rect.top + tapInBoxY) / 600;
  eq('tap 3/4 down the image normalises to 0.75 against the image box', normalizeTapToImage(100, tapInBoxY, rect)?.y, 0.75);
  ok('…and would NOT against the container (the regression this guards)', Math.abs(wrongY - 0.75) > 0.1, `container-normalised y = ${wrongY}`);

  // Round trip: a tap → normalised → drawn by plan-viewer's formula → the tip
  // of that marker is the tapped point, on any box size.
  for (const b of [{ w: 390, h: 195 }, { w: 1024, h: 512 }, { w: 350, h: 700 }]) {
    const tap = { x: b.w * 0.37, y: b.h * 0.81 };
    const pin = normalizeTapToImage(tap.x, tap.y, b)!;
    const m = pinMarkerPosition(pin, b);
    near(`box ${b.w}×${b.h}: marker left puts its centre on the tap`, m.left + PIN_MARKER_SIZE / 2, tap.x, 1e-6);
    near(`box ${b.w}×${b.h}: marker top puts its tip on the tap`, m.top + PIN_MARKER_SIZE, tap.y, 1e-6);
    const back = pinTipFromMarker(m.left, m.top, b)!;
    near(`box ${b.w}×${b.h}: tip → same normalised x`, back.x, pin.x, 1e-9);
    near(`box ${b.w}×${b.h}: tip → same normalised y`, back.y, pin.y, 1e-9);
  }

  // Placed on a phone, drawn on a laptop: normalised coordinates survive a
  // different box, the marker scales with it.
  const phone = { w: 390, h: 195 }, laptop = { w: 1200, h: 600 };
  const p = normalizeTapToImage(117, 58.5, phone)!;
  const mm = pinMarkerPosition(p, laptop);
  near('placed on a phone, the laptop draws the tip at the same spot (x)', mm.left + 14, 0.3 * 1200, 1e-6);
  near('placed on a phone, the laptop draws the tip at the same spot (y)', mm.top + 28, 0.3 * 600, 1e-6);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\nzoom — content coordinates do not move with the zoom scale');
// ───────────────────────────────────────────────────────────────────────────
{
  // The ScrollView scales the content view; a touch's locationX inside it is
  // in the content's unscaled coordinates. So the SAME point on the plan gives
  // the same pin at 1× and 3× — which only holds if nothing divides by zoom.
  const box = { w: 390, h: 195 };
  const contentPoint = { x: 250, y: 60 };
  const atFit = normalizeTapToImage(contentPoint.x, contentPoint.y, box);
  for (const zoom of [1, 2, 3, 4]) {
    // What the user sees on screen at this zoom (scaled, scrolled) is not what
    // is normalised; the content point is.
    const screenX = contentPoint.x * zoom - 100;
    ok(`zoom ${zoom}×: screen position differs from content position once zoomed`, zoom === 1 ? true : screenX !== contentPoint.x);
    eq(`zoom ${zoom}×: same content point → same pin`, normalizeTapToImage(contentPoint.x, contentPoint.y, box), atFit);
  }
  // Grab radius is measured in content points too, from the marker's centre.
  const pin = { x: 0.5, y: 0.5 };
  ok('a touch on the marker body grabs the pin', isTouchOnPin(195, 97.5 - 14, pin, box));
  ok('a touch on the tip grabs the pin', isTouchOnPin(195, 97.5, pin, box));
  ok('a touch well away from the pin does not grab it (it re-drops)', !isTouchOnPin(300, 150, pin, box));
  ok('no pin placed → nothing to grab', !isTouchOnPin(195, 97.5, null, box));
}

// ───────────────────────────────────────────────────────────────────────────
// ── the walk never loses a GPS stamp or a pin step (review 2026-09-17) ──────
{
  console.log('\nlate GPS stamp and reopening the pin step');
  const walkSrc = readFileSync(join(ROOT, 'app/punch-walk.tsx'), 'utf8');
  ok('a save before the GPS fix writes the stamp onto the saved item when it arrives',
    /pendingStamp\.promise\.then\(stamp => \{[\s\S]{0,120}updatePunchItem\(id, \{[\s\S]{0,80}photoLatitude: stamp\.latitude/.test(walkSrc));
  ok('the late stamp never overwrites the room he typed', !/updatePunchItem\(id, \{[\s\S]{0,300}location:/.test(walkSrc));
  ok('"Pin on plan" and the pin chip reopen through openPinStep (close, then open next frame)',
    /const openPinStep = useCallback\(\(\) => \{\s*setPinStepOpen\(false\);\s*requestAnimationFrame\(\(\) => setPinStepOpen\(true\)\);/.test(walkSrc)
    && !/onPress=\{\(\) => setPinStepOpen\(true\)\}/.test(walkSrc));
}

console.log('\nplan-viewer draws with the same math');
// ───────────────────────────────────────────────────────────────────────────
{
  const viewer = stripTsComments(read('app/plan-viewer.tsx'));
  ok('app/plan-viewer.tsx is readable', viewer.length > 0);
  ok('plan-viewer draws DrawingPins at x*w - 14 / y*h - 28',
    /left:\s*pin\.x\s*\*\s*imgLayout\.w\s*-\s*14/.test(viewer) && /top:\s*pin\.y\s*\*\s*imgLayout\.h\s*-\s*28/.test(viewer));
  ok('plan-viewer draws punch pins at pinX*w - 14 / pinY*h - 28',
    /left:\s*\(p\.pinX\s*\?\?\s*0\)\s*\*\s*imgLayout\.w\s*-\s*14/.test(viewer) && /top:\s*\(p\.pinY\s*\?\?\s*0\)\s*\*\s*imgLayout\.h\s*-\s*28/.test(viewer));
  const pinStyle = between(viewer, '  pin: {', '},');
  ok('plan-viewer marker is 28×28', /width:\s*28,\s*height:\s*28/.test(pinStyle));
  ok('PIN_MARKER_SIZE matches plan-viewer (28)', PIN_MARKER_SIZE === 28);
  ok('plan-viewer normalises taps as location / image-box size',
    /ex\s*\/\s*imgLayout\.w/.test(viewer) && /ey\s*\/\s*imgLayout\.h/.test(viewer));

  // THE LOAD-ORDER BUG (review 2026-09-17). plan-viewer computes imgLayout only
  // in onLayout; a remote plan whose onLoad (the ratio) arrives AFTER layout
  // leaves imgLayout = the whole container, so a pin the walk placed against
  // the image draws up to ~74pt off on a portrait photo of a plan. imgLayout
  // must be recomputed when the ratio arrives: derived (useMemo /
  // containImageRect) or set from the load handler too.
  const layoutHandler = between(viewer, 'const handleContainerLayout = useCallback', '}, [');
  const setsOutside = viewer.replace(layoutHandler, '').includes('setImgLayout(');
  const derived = /const\s+imgLayout\s*=\s*useMemo\(/.test(viewer) || /imgLayout[^\n]*containImageRect\(/.test(viewer);
  ok('plan-viewer recomputes imgLayout when the image ratio arrives after layout (not only in onLayout)',
    derived || setsOutside,
    'app/plan-viewer.tsx still sets imgLayout only inside handleContainerLayout — walk pins draw in the wrong place. Land the plan-viewer handoff (containerSize state + useMemo imgLayout = containImageRect(containerSize, ratio)) in the same OTA.');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\nwhich sheet the step opens on');
// ───────────────────────────────────────────────────────────────────────────
{
  const P = 'proj-1';
  const sheets = [
    { id: 's-new', projectId: P, name: 'Level 2', sheetNumber: 'A-102', updatedAt: '2026-09-10T00:00:00Z' },
    { id: 's-old-rev', projectId: P, name: 'Level 1', sheetNumber: 'A-101', superseded: true },
    { id: 's-l1', projectId: P, name: 'Level 1', sheetNumber: 'A-101' },
    { id: 's-other', projectId: 'proj-2', name: 'Elsewhere' },
  ];
  const items = [
    { projectId: P, planSheetId: 's-l1', pinX: 0.2, pinY: 0.3, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-15T00:00:00Z' },
    { projectId: P, planSheetId: 's-new', pinX: 0.2, pinY: 0.3, createdAt: '2026-09-02T00:00:00Z', updatedAt: '2026-09-03T00:00:00Z' },
    // Most recent of all, but on a superseded sheet — must not win.
    { projectId: P, planSheetId: 's-old-rev', pinX: 0.1, pinY: 0.1, createdAt: '2026-09-16T00:00:00Z', updatedAt: '2026-09-16T00:00:00Z' },
    // Most recent, but no numeric pin — a sheet id alone is not "pinned there".
    { projectId: P, planSheetId: 's-new', createdAt: '2026-09-17T00:00:00Z', updatedAt: '2026-09-17T00:00:00Z' },
  ] as never[];

  eq('this walk\'s last sheet wins', choosePinSheet({ sheets, projectId: P, sessionSheetId: 's-new', punchItems: items }), 's-new');
  eq('no session sheet → most recently pinned sheet on the project', choosePinSheet({ sheets, projectId: P, punchItems: items }), 's-l1');
  eq('a superseded session sheet falls through', choosePinSheet({ sheets, projectId: P, sessionSheetId: 's-old-rev', punchItems: items }), 's-l1');
  eq('a session sheet from another project falls through', choosePinSheet({ sheets, projectId: P, sessionSheetId: 's-other', punchItems: [] }), 's-new');
  eq('nothing pinned yet → first offerable sheet', choosePinSheet({ sheets, projectId: P, punchItems: [] }), 's-new');
  eq('no sheets → null (the "no plan on this job" screen)', choosePinSheet({ sheets: [], projectId: P }), null);
  eq('only a superseded sheet → null, not the old revision', choosePinSheet({ sheets: [sheets[1]], projectId: P }), null);

  eq('superseded sheets are not offered', offerablePinSheets(sheets, P).map(s => s.id), ['s-new', 's-l1']);
  eq('…unless an existing pin sits on one (keepId)', offerablePinSheets(sheets, P, 's-old-rev').map(s => s.id), ['s-new', 's-old-rev', 's-l1']);

  eq('label: number · name', pinSheetLabel({ sheetNumber: 'A-101', name: 'Level 1' }), 'A-101 · Level 1');
  eq('label: name only (IMG_1668)', pinSheetLabel({ name: 'IMG_1668' }), 'IMG_1668');
  eq('label: never empty', pinSheetLabel({ name: '  ' }), 'Plan');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\nexisting pins on the sheet');
// ───────────────────────────────────────────────────────────────────────────
{
  const P = 'proj-1';
  const items = [
    { id: 'a', projectId: P, planSheetId: 's1', pinX: 0.4, pinY: 0.6, description: 'Outlet cover' },
    { id: 'b', projectId: P, planSheetId: 's1', pinX: 0.1, pinY: 0.2, description: 'Paint touch-up' },
    { id: 'c', projectId: P, planSheetId: 's2', pinX: 0.5, pinY: 0.5, description: 'Other sheet' },
    { id: 'd', projectId: P, planSheetId: 's1', description: 'No pin' },
    { id: 'e', projectId: P, planSheetId: 's1', pinX: 1.4, pinY: 0.5, description: 'Out of range' },
    { id: 'f', projectId: 'proj-2', planSheetId: 's1', pinX: 0.5, pinY: 0.5, description: 'Other project' },
  ] as never[];
  const got = pinsOnSheet(items, P, 's1', ['b']);
  eq('only this project + this sheet + a real in-range pin', got.map(p => p.id), ['a', 'b']);
  eq('items saved this walk are flagged', got.map(p => p.fromThisWalk), [false, true]);
  eq('no sheet → no pins', pinsOnSheet(items, P, null), []);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\nwhat handleSave writes');
// ───────────────────────────────────────────────────────────────────────────
eq('a pin → planSheetId / pinX / pinY', punchPinFields({ sheetId: 's1', x: 0.25, y: 0.75 }), { planSheetId: 's1', pinX: 0.25, pinY: 0.75 });
eq('Skip (no pin) → no keys at all, the item saves as before', punchPinFields(undefined), {});
ok('Skip spreads nothing: not even an undefined planSheetId key', !('planSheetId' in punchPinFields(null)));
eq('a NaN pin is not written', punchPinFields({ sheetId: 's1', x: Number.NaN, y: 0.5 }), {});
eq('an out-of-range pin is clamped onto the sheet', punchPinFields({ sheetId: 's1', x: 1.2, y: -0.1 }), { planSheetId: 's1', pinX: 1, pinY: 0 });

console.log('\nwhen a photo opens the step by itself');
ok('a job with a plan: every photo', shouldAutoOpenPinStep({ pinnableSheetCount: 1, dismissedNoPlanThisWalk: true }));
ok('a job with no plan: the first photo', shouldAutoOpenPinStep({ pinnableSheetCount: 0, dismissedNoPlanThisWalk: false }));
ok('a job with no plan he already skipped this walk: not again', !shouldAutoOpenPinStep({ pinnableSheetCount: 0, dismissedNoPlanThisWalk: true }));
{
  // THE FOUNDER'S REAL DATA: one sheet, IMG_1668, image_uri ''. It is listed
  // but nothing can be pinned on it. It must count as "no plan" for auto-open,
  // or the add-its-image screen comes up after every photo of the walk.
  const P = 'watermark';
  const img1668 = { id: 'img1668', projectId: P, name: 'IMG_1668', imageUri: '' };
  eq('IMG_1668 (no image saved) is not pinnable', isPinnableSheet(img1668), false);
  eq('a stored plan (storage path) is pinnable', isPinnableSheet({ imageUri: '', storagePath: 'u/img-1.jpg' }), true);
  eq('a device-only plan is pinnable (it renders on this phone)', isPinnableSheet({ imageUri: 'file:///var/plan.jpg' }), true);
  eq('IMG_1668 alone → 0 pinnable sheets', pinnableSheetCount([img1668], P), 0);
  eq('a superseded stored sheet is not counted', pinnableSheetCount([{ ...img1668, id: 'old', storagePath: 'x/y.jpg', superseded: true }], P), 0);
  eq('IMG_1668 + a stored plan → 1', pinnableSheetCount([img1668, { id: 's2', projectId: P, name: 'L1', storagePath: 'x/y.jpg' }], P), 1);
  // The walk: photo 1 opens the step, he Skips (hadPlan = any pinnable = false)
  // → dismissedNoPlan; photo 2 must not open it.
  const count = pinnableSheetCount([img1668], P);
  ok('photo 1 on IMG_1668-only job: step opens', shouldAutoOpenPinStep({ pinnableSheetCount: count, dismissedNoPlanThisWalk: false }));
  const hadPlanOnSkip = [img1668].some(isPinnableSheet);
  ok('Skip there reports hadPlan:false', hadPlanOnSkip === false);
  ok('photo 2 after that Skip: step does NOT auto-open', !shouldAutoOpenPinStep({ pinnableSheetCount: count, dismissedNoPlanThisWalk: !hadPlanOnSkip }));
  eq('choosePinSheet with nothing pinned prefers a pinnable sheet over an imageless one',
    choosePinSheet({ sheets: [img1668, { id: 's2', projectId: P, name: 'L1', storagePath: 'x/y.jpg' }], projectId: P, punchItems: [] }), 's2');
}

console.log('\nthe image source — offline cold start still hits the disk cache');
{
  const base = 'https://proj.supabase.co';
  const path = '0b6c3c1e-9a0b-4c1f-9d57-2f1b8c9e0a11/img-abc.jpg';
  // Offline cold start: ProjectContext could not sign, imageUri is the bare path.
  const cold = pinStepImageSource({ imageUri: path, storagePath: path }, { publicBaseUrl: base });
  eq('cold start (imageUri = bare path): cacheKey is the path key', cold?.cacheKey, `plan-sheets/${path}`);
  ok('…and the uri is a real https URL, not the bare path (so expo-image checks its cache)', !!cold && /^https:\/\//.test(cold.uri) && cold.uri !== path, cold?.uri);
  eq('…built from the storage path', cold?.uri, `${base}/storage/v1/object/public/plan-sheets/${path}`);
  const signed = `${base}/storage/v1/object/sign/plan-sheets/${path}?token=t1`;
  eq('signed url: kept, same cache key', pinStepImageSource({ imageUri: signed, storagePath: path }, { publicBaseUrl: base }), { uri: signed, cacheKey: `plan-sheets/${path}` });
  const fresh = `${base}/storage/v1/object/sign/plan-sheets/${path}?token=t2`;
  eq('retry re-sign wins over the expired link, same cache key', pinStepImageSource({ imageUri: signed, storagePath: path }, { publicBaseUrl: base, resignedUri: fresh }), { uri: fresh, cacheKey: `plan-sheets/${path}` });
  eq('a re-sign that failed (returned the path) is ignored', pinStepImageSource({ imageUri: path, storagePath: path }, { publicBaseUrl: base, resignedUri: path })?.uri, `${base}/storage/v1/object/public/plan-sheets/${path}`);
  eq('just photographed: the local file renders, and seeds the path key', pinStepImageSource({ imageUri: 'file:///tmp/p.jpg', storagePath: path }, { publicBaseUrl: base }), { uri: 'file:///tmp/p.jpg', cacheKey: `plan-sheets/${path}` });
  eq('device-only sheet (no path): the local uri, no key', pinStepImageSource({ imageUri: 'file:///tmp/p.jpg' }, { publicBaseUrl: base }), { uri: 'file:///tmp/p.jpg' });
  eq('nothing at all → null', pinStepImageSource({ imageUri: '' }, { publicBaseUrl: base }), null);
  eq('no sheet → null', pinStepImageSource(null, { publicBaseUrl: base }), null);
  eq('path segments are encoded, slashes kept', planSheetPublicObjectUrl(`${base}/`, 'a b/c#d.jpg'), `${base}/storage/v1/object/public/plan-sheets/a%20b/c%23d.jpg`);
}

console.log('\nwho may add a plan (storage insert needs editor)');
{
  const idle = { isLoading: false, isError: false };
  eq('owner: allowed', planUploadBlockedReason('owner', idle), null);
  eq('editor: allowed', planUploadBlockedReason('editor', idle), null);
  ok('viewer: blocked with a reason', /view-only/.test(planUploadBlockedReason('viewer', idle) ?? ''));
  ok('field: blocked BEFORE picking, with its own reason', /Field access/.test(planUploadBlockedReason('field', idle) ?? ''));
  ok('role still loading: blocked, says it is checking', /Checking/.test(planUploadBlockedReason(null, { isLoading: true, isError: false }) ?? ''));
  ok('role failed to load: blocked, says why', /Couldn.t check/.test(planUploadBlockedReason(null, { isLoading: false, isError: true }) ?? ''));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\npunch-walk wiring (source)');
// ───────────────────────────────────────────────────────────────────────────
{
  const walk = stripTsComments(read('app/punch-walk.tsx'));
  ok('app/punch-walk.tsx is readable', walk.length > 0);
  ok('punch-walk renders PlanPinStep', /<PlanPinStep[\s\S]*?visible=\{pinStepOpen\}/.test(walk));

  const camera = between(walk, 'const handleCamera = useCallback', 'const handlePinNext = useCallback');
  ok('handleCamera exists', camera.length > 0);
  const photoSet = camera.indexOf('photoUri: result.assets[0].uri');
  const opens = camera.indexOf('setPinStepOpen(true)');
  ok('handleCamera opens the pin step', opens > 0);
  ok('…after the photo lands on the draft (photo, THEN pin)', photoSet > 0 && opens > photoSet);
  ok('…gated only by shouldAutoOpenPinStep', /shouldAutoOpenPinStep\(/.test(camera));
  ok('…on DURABLE sheets (durablePinSheetCount), not merely listed or device-only ones',
    /planSheetCount\s*=\s*durablePinSheetCount\(/.test(walk) && /pinnableSheetCount:\s*planSheetCount/.test(camera));
  ok('the GPS stamp is NOT awaited before the pin step opens', !/await\s+stampPhotoLocation\(/.test(camera));
  ok('…the late stamp only lands on the same photo', /d\.photoUri\s*!==\s*shotUri/.test(camera));
  ok('the open waits out the iOS camera dismiss (setTimeout, cleared on unmount)',
    /setTimeout\([\s\S]*setPinStepOpen\(true\)[\s\S]*CAMERA_DISMISS_MS/.test(camera) && /clearTimeout\(pinOpenTimerRef\.current\)/.test(walk));
  ok('the pin step opens over the form, not after a save (handleCamera does not call handleSave/onAdd)',
    !/handleSave\(|onAdd\(/.test(camera));

  const save = between(walk, 'const handleSave = useCallback', 'const handleUndo = useCallback');
  ok('handleSave exists', save.length > 0);
  ok('handleSave spreads punchPinFields(draft.pin) onto the PunchItem', /\.\.\.punchPinFields\(\s*draft\.pin\s*\)/.test(save));
  const itemLit = between(save, 'const item: PunchItem = {', 'onAdd(item)');
  ok('…inside the PunchItem literal handed to onAdd', /punchPinFields/.test(itemLit));
  ok('handleSave never hand-writes planSheetId (one path, the pure one)', !/planSheetId\s*:/.test(save));
  const reset = save.slice(save.lastIndexOf('setDraft('));
  ok('the post-save draft does not carry the pin to the next item', reset.length > 0 && !/\bpin\s*:/.test(reset) && !/\.\.\.draft\b/.test(reset));
  ok('handleSave dates via utils/calendarDate, not a UTC slice', !/toISOString\(\)\.slice\(0,\s*10\)/.test(save));

  const next = between(walk, 'const handlePinNext = useCallback', 'const handlePinSkip = useCallback');
  ok('Next puts the pin on the draft and closes the step', /pin\b/.test(next) && /setPinStepOpen\(false\)/.test(next));
  ok('Next does not invent a location from the pin', !/location\s*:/.test(next));
  ok('Next remembers the sheet for the next photo', /setLastPinSheetId\(\s*pin\.sheetId\s*\)/.test(next));

  const skip = between(walk, 'const handlePinSkip = useCallback', 'const handleRemovePin = useCallback');
  ok('Skip clears the pin and closes the step', /pin:\s*undefined/.test(skip) && /setPinStepOpen\(false\)/.test(skip));
  ok('Skip does not save or discard the photo', !/onAdd\(|photoUri\s*:/.test(skip));

  const photoRemove = between(walk, 'source={{ uri: draft.photoUri }}', '{draft.pin ?');
  ok('removing the photo leaves the pin alone', /photoUri:\s*undefined/.test(photoRemove) && !/pin:\s*undefined/.test(photoRemove));
  ok('a pinned draft shows a chip that re-opens the step', /testID="walk-pin-chip"/.test(walk));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\nPlanPinStep (source)');
// ───────────────────────────────────────────────────────────────────────────
{
  const step = stripTsComments(read('components/punch/PlanPinStep.tsx'));
  ok('components/punch/PlanPinStep.tsx is readable', step.length > 0);
  ok('titled "Where is this?"', /Where is this\?/.test(step));
  ok('normalises through normalizeTapToImage against the contain rect', /normalizeTapToImage\(/.test(step) && /containImageRect\(/.test(step));
  ok('never normalises screen-space pageX/pageY', !/pageX|pageY/.test(step));
  ok('draws markers with pinMarkerPosition (plan-viewer\'s formula)', /pinMarkerPosition\(/.test(step));
  // The loaded image's shape is the truth (stored dimensions can be swapped or
  // stale); the stored size only sizes the box before onLoad.
  ok('ratio from the loaded image first, stored sheet size before it loads', /loadedRatio\s*\?\?\s*sheetAspectRatio\(sheet\)/.test(step));
  ok('a disabled Next says what it is waiting for (loading / load error)', /loadState === 'error'[\s\S]{0,80}Plan didn’t load/.test(step) && /loadState === 'loading'[\s\S]{0,40}Loading the plan/.test(step));
  ok('children of the touch box do not take the touch (pointerEvents="none")', (step.match(/pointerEvents="none"/g) ?? []).length >= 3);
  ok('iOS pinch zoom through the ScrollView, starting fitted', /maximumZoomScale=\{Platform\.OS === 'ios'/.test(step) && /minimumZoomScale=\{1\}/.test(step));
  ok('a new plan goes through addFloorPlan (upload first)', /addFloorPlan\(/.test(step));
  ok('an imageless sheet is repaired in place with attachFloorPlanImage', /attachFloorPlanImage\(/.test(step));
  ok('no direct storage upload or addPlanSheet call from the step', !/supabase\.|\.upload\(|actionsRef\.current\.addPlanSheet\(/.test(step));
  ok('Skip is always rendered', /testID="walk-pin-skip"/.test(step));
  ok('Next is disabled until a pin is placed and says why', /disabled=\{!pin/.test(step) && /Tap the plan where this is/.test(step));
  ok('a plan that cannot load says so', /Plan can.{0,12}t load/.test(step));
  ok('the no-plan screen says so plainly', /No floor plan on this job yet/.test(step));
  ok('the image source comes from pinStepImageSource (path-keyed cache, valid url)', /pinStepImageSource\(sheet/.test(step) && !/cacheKey:/.test(step));
  ok('Try again re-signs from the storage path (an expired link never recovers otherwise)',
    /onPress=\{handleRetry\}/.test(step) && /resolvePlanSheetUrl\(target\.storagePath\)/.test(step)
      && /resign\(sheet\)/.test(between(step, 'const handleRetry = useCallback', '}, [')));
  ok('Skip reports hadPlan from DURABLE sheets only (a device-only save prompt mutes too)', /sheets\.some\(isDurablePinSheet\)/.test(step) && /hadPlan:\s*hadPinnablePlan/.test(step));
  ok('add-plan gate is planUploadBlockedReason (owner/editor only), not a viewer-only check',
    /planUploadBlockedReason\(/.test(step) && !/role\s*===\s*'viewer'/.test(step));
  ok('web drag ignores events whose target is not the image box', /nativeEvent\.target/.test(step) && /isOffBoxOnWeb\(e\)/.test(between(step, 'const handleMove = useCallback', '}, ['))
    && /isOffBoxOnWeb\(e\)/.test(between(step, 'const handleRelease = useCallback', '}, [')));
  ok('the error copy does not promise offline on web', !/Offline, a plan only opens/.test(step));
  ok('screen readers can place a pin (accessibility action + tap drops it at the plan centre)',
    /onAccessibilityTap=\{handleAccessibilityPin\}/.test(step) && /onAccessibilityAction=/.test(step)
      && /\{\s*x:\s*0\.5,\s*y:\s*0\.5\s*\}/.test(between(step, 'const handleAccessibilityPin = useCallback', '}, [')));
  ok('the screen-reader hint names Skip as the way out', /Skip to save without a pin/.test(step));
  ok('a camera-captured plan is named "Floor plan", not the camera UUID file name',
    /source === 'camera'[\s\S]{0,80}name:\s*'Floor plan'/.test(between(step, 'const runAdd = useCallback', '}, [')));
  ok('no reanimated / gesture-handler (OTA)', !/react-native-reanimated|react-native-gesture-handler/.test(step));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\nplan-viewer gets the image ratio on WEB (critic 2026-09-17 #2), executed');
// ───────────────────────────────────────────────────────────────────────────
// react-native-web's <Image> calls onLoad({ nativeEvent: <DOM load Event> }):
// no `source`, the size is on target.naturalWidth/Height. plan-viewer read only
// nativeEvent.source, so on web imgLayout stayed the whole container and a
// walk pin (normalised by PlanPinStep against the real image rect) drew in
// the letterbox. Executed here for the four shapes tomorrow's test meets, on
// the 1200x700 web canvas: where PlanPinStep put the pin vs where plan-viewer
// draws it, with (a) the ratio the viewer now derives and (b) none at all.
{
  const canvas = { w: 1200, h: 700 };
  const shapes: { label: string; w: number; h: number }[] = [
    { label: 'portrait phone photo (3024x4032)', w: 3024, h: 4032 },
    { label: 'landscape phone photo (4032x3024)', w: 4032, h: 3024 },
    { label: '36x24 PDF sheet (5184x3456)', w: 5184, h: 3456 },
    { label: 'IMG_1668 (1114x1349)', w: 1114, h: 1349 },
  ];
  const domEvent = (w: number, h: number) => ({ nativeEvent: { type: 'load', target: { naturalWidth: w, naturalHeight: h } } });
  for (const sh of shapes) {
    const trueRatio = sh.w / sh.h;
    // PlanPinStep (expo-image reports source on every platform) normalises a
    // tap at x=0.1/0.9 of the real image rect.
    const stepRect = containImageRect(canvas, trueRatio)!;
    // plan-viewer on web: the RNW event shape, with the stored dimensions.
    const webRatio = imageLoadAspectRatio(domEvent(sh.w, sh.h));
    near(`${sh.label}: the RNW DOM load event yields the ratio`, webRatio, trueRatio);
    const viewerRatio = planViewerImageRatio(webRatio, { width: sh.w, height: sh.h });
    const viewerBox = containImageRect(canvas, viewerRatio) ?? canvas;
    // No onLoad ratio at all (offline cold start / unknown event shape): the
    // stored width/height alone must still give the same box.
    const storedOnly = containImageRect(canvas, planViewerImageRatio(null, { width: sh.w, height: sh.h })) ?? canvas;
    for (const x of [0.1, 0.9]) {
      const pin = { x, y: 0.5 };
      const placedAt = stepRect.left + pin.x * stepRect.w;
      const drawnAt = (canvas.w - viewerBox.w) / 2 + pinMarkerPosition(pin, viewerBox).left + PIN_MARKER_SIZE / 2;
      near(`${sh.label}: pin x=${x} drawn where it was placed (web onLoad)`, drawnAt, placedAt, 1e-6);
      const drawnStored = (canvas.w - storedOnly.w) / 2 + pinMarkerPosition(pin, storedOnly).left + PIN_MARKER_SIZE / 2;
      near(`${sh.label}: pin x=${x} drawn where it was placed (stored size only, no onLoad)`, drawnStored, placedAt, 1e-6);
      // And what the old code did: no ratio → the container is the box.
      const oldDrawn = pinMarkerPosition(pin, canvas).left + PIN_MARKER_SIZE / 2;
      ok(`${sh.label}: x=${x} — the old container-box draw was ${Math.abs(oldDrawn - placedAt).toFixed(0)} px off (sanity: the bug is real)`,
        Math.abs(oldDrawn - placedAt) > 40);
    }
  }
  near('native / expo-image shape: source.{width,height}', imageLoadAspectRatio({ source: { width: 200, height: 100 } }), 2);
  near('RN native shape: nativeEvent.source', imageLoadAspectRatio({ nativeEvent: { source: { width: 100, height: 400 } } }), 0.25);
  eq('an event with neither → null', imageLoadAspectRatio({ nativeEvent: { type: 'load', target: {} } }), null);
  eq('a zero-size image → null, never Infinity', imageLoadAspectRatio({ nativeEvent: { target: { naturalWidth: 10, naturalHeight: 0 } } }), null);
  eq('no event → null', imageLoadAspectRatio(undefined), null);
  eq('loaded ratio wins over stored (same precedence as PlanPinStep)', planViewerImageRatio(0.75, { width: 2, height: 1 }), 0.75);
  eq('no loaded ratio, no stored size → null (container stays the box)', planViewerImageRatio(null, {}), null);

  const viewer = stripTsComments(read('app/plan-viewer.tsx'));
  const loadHandler = between(viewer, 'const handleImageLoad = useCallback', '}, [');
  ok('plan-viewer onLoad reads the ratio through imageLoadAspectRatio (not nativeEvent.source alone)',
    /imageLoadAspectRatio\(e\)/.test(loadHandler) && !/nativeEvent\.source/.test(loadHandler),
    'handleImageLoad must not depend on e.nativeEvent.source — react-native-web never sets it.');
  ok('plan-viewer sizes the image box with planViewerImageRatio(imgNaturalRatio, sheet) — a ratio source other than onLoad',
    /planViewerImageRatio\(imgNaturalRatio,\s*sheet\)/.test(viewer) && /containImageRect\(containerSize,\s*imgRatio\)/.test(viewer));
  ok('plan-viewer rings the punch item it was opened for (punchId param)',
    /p\.id\s*===\s*punchIdParam/.test(viewer) && /testID=\{isTarget \? 'plan-viewer-punch-target'/.test(viewer));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\na device-only plan is saved before it takes a pin (critic 2026-09-17 #3)');
// ───────────────────────────────────────────────────────────────────────────
{
  const P = 'watermark';
  // IMG_1668 on the phone that imported it: '' in Postgres, file:// here.
  const onPhone = { id: 'img1668', projectId: P, name: 'IMG_1668', imageUri: 'file:///var/mobile/Containers/Data/x/ImagePicker/IMG_1668.jpg', width: 1114, height: 1349 };
  const stored = { id: 's2', projectId: P, name: 'L1', imageUri: 'https://x/sign/plan.jpg', storagePath: `${P}/img-1.jpg` };
  eq('device-only is NOT durable', isDurablePinSheet(onPhone), false);
  eq('stored is durable', isDurablePinSheet(stored), true);
  eq('imageless is not durable', isDurablePinSheet({ imageUri: '' }), false);
  eq('IMG_1668 on its phone → 0 durable sheets (counts as "no plan" for auto-open)', durablePinSheetCount([onPhone], P), 0);
  eq('…while it is still listed as renderable (isPinnableSheet unchanged for other callers)', pinnableSheetCount([onPhone], P), 1);
  eq('device-only + stored → 1 durable', durablePinSheetCount([onPhone, stored], P), 1);

  eq('choosePinSheet: nothing pinned, device-only listed FIRST → the durable sheet',
    choosePinSheet({ sheets: [onPhone, stored], projectId: P, punchItems: [] }), 's2');
  eq('choosePinSheet: last pin of the walk was on the device-only sheet but a durable one exists → durable',
    choosePinSheet({ sheets: [onPhone, stored], projectId: P, sessionSheetId: 'img1668', punchItems: [] }), 's2');
  eq('choosePinSheet: most recent project pin on the device-only sheet → still the durable one',
    choosePinSheet({ sheets: [onPhone, stored], projectId: P, punchItems: [{ projectId: P, planSheetId: 'img1668', pinX: 0.5, pinY: 0.5, createdAt: '2026-09-17T00:00:00Z', updatedAt: '2026-09-17T00:00:00Z' }] as never[] }), 's2');
  eq('choosePinSheet: device-only is the ONLY sheet → it is offered (to be saved)',
    choosePinSheet({ sheets: [onPhone], projectId: P, punchItems: [] }), 'img1668');
  eq('choosePinSheet: two durable sheets keep the session rule',
    choosePinSheet({ sheets: [stored, { ...stored, id: 's3' }], projectId: P, sessionSheetId: 's3', punchItems: [] }), 's3');

  eq('mode: durable → pin', pinStepSheetMode({ imageState: 'durable', loadState: 'loaded' }), 'pin');
  eq('mode: imageless → add-image', pinStepSheetMode({ imageState: 'missing', loadState: 'loading' }), 'add-image');
  eq('mode: device-only that rendered → save (never pin)', pinStepSheetMode({ imageState: 'device-only', loadState: 'loaded' }), 'save');
  eq('mode: device-only still loading → save', pinStepSheetMode({ imageState: 'device-only', loadState: 'loading' }), 'save');
  eq('mode: device-only whose file is gone (load error) → repick, not "Try again"', pinStepSheetMode({ imageState: 'device-only', loadState: 'error' }), 'repick');
  eq('mode: device-only save failed with no signal → keep offering save', pinStepSheetMode({ imageState: 'device-only', loadState: 'loaded', saveFailure: 'transient' }), 'save');
  eq('mode: device-only save failed RLS → keep offering save', pinStepSheetMode({ imageState: 'device-only', loadState: 'loaded', saveFailure: 'rls-pending' }), 'save');
  for (const k of ['terminal', 'unsupported-format', 'too-large', 'no-image'] as const) {
    eq(`mode: device-only save failed '${k}' → repick into the same sheet`, pinStepSheetMode({ imageState: 'device-only', loadState: 'loaded', saveFailure: k }), 'repick');
  }

  const step = stripTsComments(read('components/punch/PlanPinStep.tsx'));
  ok('PlanPinStep only allows a pin in mode "pin"', /const canPin = !!sheet && mode === 'pin'/.test(step));
  ok('PlanPinStep computes mode with pinStepSheetMode', /pinStepSheetMode\(\{\s*imageState,\s*loadState/.test(step));
  const save = between(step, 'const runSaveDeviceOnly = useCallback', '}, [');
  ok('the save action uploads the file it already has via uploadDeviceOnlyFloorPlan through actionsRef',
    /uploadDeviceOnlyFloorPlan\(sheet,\s*\(\)\s*=>\s*actionsRef\.current\)/.test(save));
  ok('the save prompt is rendered for mode "save" and wired to runSaveDeviceOnly',
    /mode === 'save' &&[\s\S]{0,200}testID="walk-pin-device-only"/.test(step) && /onPress=\{\(\) => void runSaveDeviceOnly\(\)\}/.test(step));
  ok('repick renders the add buttons (not "Try again")',
    /mode === 'repick' &&[\s\S]{0,900}renderAddButtons\(/.test(step));
  ok('"Try again" / load-error overlay is only for a durable sheet', /mode === 'pin' && loadState === 'error' &&/.test(step));
  ok('a re-picked image attaches to the SAME sheet when it is not durable',
    /sheet && imageState !== 'durable'\s*\?\s*await attachFloorPlanImage\(sheet/.test(between(step, 'const runAdd = useCallback', '}, [')));
  ok('the disabled Next says why on a device-only sheet', /Save the plan to pin on it/.test(step) && /Add the plan image to pin on it/.test(step));
}

console.log('');
if (fail > 0) {
  console.error(`✗ validate-punch-plan-pin: ${fail} failure(s), ${pass} passed.\n`);
  process.exit(1);
}
console.log(`✓ validate-punch-plan-pin: ${pass} checks — the pin lands where plan-viewer draws it, and the walk goes photo → pin → description.\n`);
