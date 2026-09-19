// validate-plan-scale-frame.ts — a plan's saved scale means the same thing on
// Plan Viewer and Visual Takeoff (audit round 2, #4).
// Run via: bun run scripts/validate-plan-scale-frame.ts
//
// THE BUG. Both screens save and reuse one PlanCalibration (two 0–1 points +
// a real distance) but normalised against different rectangles: Visual
// Takeoff against its 3:4 canvas (letterbox included), Plan Viewer against
// its flex:1 container. One iPhone, one 3:2 sheet, scale set on a vertical
// dimension in Plan Viewer, read in Visual Takeoff → every traced area ~32%
// high under "scale saved · ready to trace", straight into the estimate.
//
// Pins:
//   1. REPRO — the old canvas frame gets the area wrong by the ratio of the
//      two frames; the image frame gets the same area on both screens.
//   2. MARKER — a new row is stamped image-frame and the stamp survives a
//      JSON round trip (the jsonb p1/p2 columns); an unstamped row reads
//      'recheck' and is not used.
//   3. TAPS — canvas touch → image-normalised → drawn back lands on the touch.
//   4. WIRING — both screens normalise and measure in the image rect, stamp
//      what they save, and refuse an unstamped row.
import { readFileSync } from 'node:fs';
import { containImageRect } from '../utils/punchPlanPin';
import { feetPerPixel, polygonAreaSqFt } from '../utils/takeoffGeometry';
import {
  boxToImageNorm, imageNormToBox, planScaleStatus, stampImageFrame, usableCalibration,
} from '../utils/planScale';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// A 3:2 sheet. A 20 ft vertical dimension runs half the drawing's height;
// a room is a rectangle 40% × 30% of the drawing.
const RATIO = 1.5;
const viewerBox = { w: 393, h: 600 };   // Plan Viewer's flex:1 area on an iPhone
const takeoffBox = { w: 361, h: 481 };  // Visual Takeoff's 3:4 canvas
const viewerRect = containImageRect(viewerBox, RATIO)!;
const takeoffRect = containImageRect(takeoffBox, RATIO)!;
const room = [{ x: 0.2, y: 0.2 }, { x: 0.6, y: 0.2 }, { x: 0.6, y: 0.5 }, { x: 0.2, y: 0.5 }];
// The drawing's true scale: the image height spans 40 ft (20 ft = half of it),
// so the image is 60 × 40 ft and the room is 24 × 12 = 288 SF.
const TRUE_SF = 288;

console.log('\n1. the repro');
{
  // Scale set in Plan Viewer, image frame: p1/p2 half the image height apart.
  const cal = { p1: { x: 0.5, y: 0.25 }, p2: { x: 0.5, y: 0.75 }, realDistanceFt: 20 };
  const inViewer = polygonAreaSqFt(room, viewerRect.w, viewerRect.h, feetPerPixel(cal, viewerRect.w, viewerRect.h)!);
  const inTakeoff = polygonAreaSqFt(room, takeoffRect.w, takeoffRect.h, feetPerPixel(cal, takeoffRect.w, takeoffRect.h)!);
  ok('image frame: Plan Viewer reads the room at 288 SF', near(inViewer, TRUE_SF), `got ${inViewer}`);
  ok('image frame: Visual Takeoff reads the SAME 288 SF', near(inTakeoff, TRUE_SF), `got ${inTakeoff}`);

  // The OLD frames: Plan Viewer (pre-fix) saved Δy against its whole 600-pt
  // container; Visual Takeoff read it against its whole 481-pt canvas, and
  // traced the room against the canvas too.
  const dyImagePx = 0.5 * viewerRect.h;                    // 131 px of drawing
  const oldCal = { p1: { x: 0.5, y: 0.3 }, p2: { x: 0.5, y: 0.3 + dyImagePx / viewerBox.h }, realDistanceFt: 20 };
  const roomInCanvas = room.map(p => ({
    x: (takeoffRect.left + p.x * takeoffRect.w) / takeoffBox.w,
    y: (takeoffRect.top + p.y * takeoffRect.h) / takeoffBox.h,
  }));
  const oldTakeoff = polygonAreaSqFt(roomInCanvas, takeoffBox.w, takeoffBox.h, feetPerPixel(oldCal, takeoffBox.w, takeoffBox.h)!);
  ok('the old canvas frame read that room ~30% high (the bug this fixes)', oldTakeoff / TRUE_SF > 1.25,
    `old/true = ${(oldTakeoff / TRUE_SF).toFixed(3)}`);
}

console.log('\n2. the frame marker');
{
  const stamped = { p1: stampImageFrame({ x: 0.1, y: 0.2 }), p2: stampImageFrame({ x: 0.3, y: 0.4 }), realDistanceFt: 10 };
  ok('a stamped row is ready', planScaleStatus(stamped) === 'ready');
  const roundTrip = JSON.parse(JSON.stringify(stamped));
  ok('…and stays ready through the jsonb round trip', planScaleStatus(roundTrip) === 'ready' && usableCalibration(roundTrip) !== null);
  const legacy = { p1: { x: 0.1, y: 0.2 }, p2: { x: 0.3, y: 0.4 }, realDistanceFt: 10 };
  ok('an unstamped (older) row reads re-check', planScaleStatus(legacy) === 'recheck');
  ok('…and is not used to size anything', usableCalibration(legacy) === null);
  ok('one stamped point is not enough', planScaleStatus({ ...legacy, p1: stampImageFrame(legacy.p1) }) === 'recheck');
  ok('no row → none', planScaleStatus(null) === 'none');
}

console.log('\n3. taps round-trip through the image rect');
{
  const touch = { x: takeoffRect.left + 0.37 * takeoffRect.w, y: takeoffRect.top + 0.81 * takeoffRect.h };
  const n = boxToImageNorm(touch.x, touch.y, takeoffRect)!;
  ok('canvas touch → image-normalised', near(n.x, 0.37) && near(n.y, 0.81));
  const back = imageNormToBox(n, takeoffRect);
  ok('…and drawn back on the touch', near(back.cx, touch.x) && near(back.cy, touch.y));
  ok('a touch in the letterbox clamps to the drawing edge', boxToImageNorm(10, 2, takeoffRect)!.y === 0);
  ok('no image rect yet → no point', boxToImageNorm(10, 10, null) === null);
}

console.log('\n4. wiring');
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const takeoff = read('app/area-takeoff.tsx');
ok('area-takeoff derives the image rect from the canvas + image ratio',
  /containImageRect\(canvasSize, planViewerImageRatio\(imgRatio, sheetDims\)\)/.test(takeoff));
ok('area-takeoff reads the ratio from the image\'s onLoad', /onLoad=\{onImageLoad\}/.test(takeoff) && /imageLoadAspectRatio\(e\)/.test(takeoff));
ok('area-takeoff normalises taps to the image rect', /boxToImageNorm\(ex, ey, imgRect\)/.test(takeoff) && !/ex \/ imgLayout\.w/.test(takeoff));
ok('area-takeoff measures in the image rect',
  /feetPerPixel\(calibration, imgRect\.w, imgRect\.h\)/.test(takeoff) && /polygonAreaSqFt\(drawPoints, imgRect\.w, imgRect\.h, ftPerPx\)/.test(takeoff));
ok('area-takeoff saves stamped points', /p1: stampImageFrame\(cal\.p1\), p2: stampImageFrame\(cal\.p2\)/.test(takeoff));
ok('area-takeoff refuses an unstamped row and says re-check', /usableCalibration\(existing\)/.test(takeoff) && /re-check scale/.test(takeoff));
ok('"scale saved · ready to trace" only for a ready row', /st === 'ready'\s*\?\s*<Text style=\{styles\.sheetCal\}>scale saved · ready to trace/.test(takeoff));
const viewer = read('app/plan-viewer.tsx');
ok('plan-viewer measures only with an image-frame row', /usableCalibration\(savedCalibration\)/.test(viewer));
ok('plan-viewer saves stamped points', /p1: stampImageFrame\(pointBuffer\[0\]\)/.test(viewer) && /p2: stampImageFrame\(pointBuffer\[1\]\)/.test(viewer));
ok('plan-viewer shows Re-check scale for an older row', /scaleNeedsRecheck \? \(/.test(viewer));
ok('the Re-check scale pill is blocked up front like Calibrate when the frame is unknown',
  (() => { const at = viewer.indexOf("showAlert('Re-check scale', PLAN_SCALE_RECHECK_COPY)");
    const pre = at > 0 ? viewer.slice(Math.max(0, at - 600), at) : '';
    return /if \(!imageFrameKnown\) \{ showAlert\('Can\\'t calibrate yet', CALIBRATE_FRAME_UNKNOWN_COPY\); return; \}\s*switchMode\('calibrate'\); $/.test(pre); })());
// Integration round 1: with the sheet's aspect ratio unknown, imgLayout falls
// back to the whole container, and points tapped there were still stamped
// frame:'image' — a container-frame scale that every reader then trusted.
ok('an unknown ratio yields no image rect (so the frame is not known)',
  containImageRect(viewerBox, null) === null && containImageRect(viewerBox, undefined) === null);
ok('plan-viewer knows whether imgLayout is the image rect or the container fallback',
  /const imageFrameKnown = !!containerSize && containImageRect\(containerSize, imgRatio\) != null;/.test(viewer));
{
  const cc = viewer.slice(viewer.indexOf('const confirmCalibration = useCallback('));
  const refuse = cc.indexOf('if (!imageFrameKnown)');
  const save = cc.indexOf('upsertPlanCalibration({');
  ok('confirmCalibration refuses to stamp before the frame is known — before the save, and says why',
    refuse > 0 && refuse < save && /CALIBRATE_FRAME_UNKNOWN_COPY/.test(cc.slice(refuse, save)));
}
ok('the Calibrate button is blocked with the reason while the frame is unknown',
  /if \(!imageFrameKnown\) \{ showAlert\('Can\\'t calibrate yet', CALIBRATE_FRAME_UNKNOWN_COPY\); return; \}/.test(viewer));
// Integration round 3: Measure with no usable scale was a third way into
// calibrate mode that skipped the frame block, and called a re-check "no scale".
{
  const m = viewer.indexOf("if (!scaleFtPerPx) {");
  const branch = m > 0 ? viewer.slice(m, viewer.indexOf("switchMode('measure');", m)) : '';
  const block = branch.indexOf("if (!imageFrameKnown) { showAlert('Can\\'t calibrate yet', CALIBRATE_FRAME_UNKNOWN_COPY); return; }");
  const enter = branch.indexOf("switchMode('calibrate');");
  ok('Measure with no scale is blocked up front when the frame is unknown, before entering calibrate',
    block >= 0 && enter > block);
  ok('...and an older scale is called a re-check there, not "no scale"',
    /if \(scaleNeedsRecheck\) \{\s*showAlert\('Re-check scale', PLAN_SCALE_RECHECK_COPY\);/.test(branch.slice(enter)));
}
// Integration round 3: a re-calibration keeps the row's id, and a plain insert
// on that id is refused (plan_calibrations_pkey) online and dropped as
// "already landed" offline — the re-check never reached the server.
{
  const ctx = read('contexts/ProjectContext.tsx');
  const fn = ctx.slice(ctx.indexOf('const upsertPlanCalibration = useCallback('));
  const existingBranch = fn.slice(fn.indexOf('if (existing) {'), fn.indexOf('const fresh: PlanCalibration'));
  ok('re-calibrating an existing sheet sends an upsert (ON CONFLICT (id)), never a plain insert',
    /(?:supabaseWrite\(|trackedWrite\(planWriteTouchRef, )'plan_calibrations', 'upsert', \{\s*id: next\.id,/.test(existingBranch) && !/'plan_calibrations', 'insert'/.test(existingBranch));
  ok('a first calibration is still a plain insert of a fresh id',
    /(?:supabaseWrite\(|trackedWrite\(planWriteTouchRef, )'plan_calibrations', 'insert', \{\s*id: fresh\.id,/.test(fn));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
