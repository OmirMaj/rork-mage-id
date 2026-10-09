// scripts/validate-phone-3d.ts — the Living Model's 3D view on the phone (lane PHONE3D).
//
// The phone draws the SAME scene as the web (components/livingModel/threeScene.ts)
// on expo-gl's drawing surface. This gate holds what must stay true for that to
// be safe on EVERY installed build, including the ones with no 3D engine, which
// still receive this JavaScript over the air.
//
// A. FINGERS AND SIZES, AS NUMBERS (utils/livingModel/phoneViewCore, run
//    directly): one finger turns, two move and zoom, a still short touch is a
//    tap; the scene is handed the view in points with the buffer's pixels a
//    point, so nothing is converted; a small room shows its name alone; the
//    cost of the view (buffer, smoothing, shadow map) comes from one table.
// B. THE ENGINE IS OPTIONAL: one nullable lookup, from inside a function;
//    expo-gl is named in ONE file and read lazily inside a try; nothing else
//    in the app names it. (scripts/validate-living-model.ts rules E1 to E4 hold
//    the same line for the 3D library and the scene builder.)
// C. THE FLAT REPLAY IS ALWAYS REACHABLE: a build with no engine, a failed
//    start and a failed frame all end on the flat replay with one plain line,
//    and a throw while drawing is caught.
// D. FRAMES: a frame is drawn only when something changed; nothing is drawn
//    when the screen is not in front or the app is not active; every drawn
//    frame is shown (endFrameEXP); everything is given back on leaving; the
//    page behind does not scroll while a finger is on the model; a drawing
//    surface that never starts ends on the flat replay.
// E. THE SIMULATOR CHECK IS OFF IN EVERY BUILD ANYONE INSTALLS: its switch is
//    in no build profile, no app config and no committed env file; the auth
//    wall opens for it only under the same switch.
// F. THE GATE IS UNCHANGED: the Living Model's flag is off and its route still
//    redirects everyone the gate refuses.
// G. THE WORDS: English and Spanish for every string, the two lines the
//    founder asked for, and none of the words the Living Model may not say.
//
// Every rule has at least one planted mutation that must turn it red.
// Run: bun run test:phone-3d
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canvasStandIn, makePhoneScene } from '../components/livingModel/phone3d/phoneScene';
import { validateModel } from '../utils/livingModel/modelCore';
import type { JobSceneHandle } from '../components/livingModel/threeScene';
import { sevenRoomJob, tenWeekSchedule } from '../__tests__/fixtures/livingModelJobs';
import { EN as EN_SHARD } from '../i18n/catalog/en/office.living-model-phone.generated';
import { ES_OFFICE_LIVING_MODEL_PHONE } from '../i18n/catalog/es/office/livingModelPhone';
import { spikeFortyRoomJob, spikeSevenRoomJob, spikeTenWeekSchedule } from '../utils/livingModel/phoneSpikeSample';
import {
  MAX_TWIST_STEP, MAX_ZOOM_STEP, TAP_MAX_MS, TAP_SLOP_PT,
  PHONE_3D_QUALITY, frameStats, gestureBegin, gestureEnd, gestureMove, labelsToHide, phone3DSettings, surfaceBox, viewSize,
} from '../utils/livingModel/phoneViewCore';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

const SOURCE_DIRS = ['app', 'components', 'contexts', 'hooks', 'utils', 'constants', 'lib', 'i18n', 'stubs', 'modules', 'backend'];
function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name)) out.push(relative(ROOT, p));
  }
}
const ALL_SOURCE: string[] = [];
for (const d of SOURCE_DIRS) walk(join(ROOT, d), ALL_SOURCE);
for (const f of ['metro.config.js', 'babel.config.js', 'index.js', 'index.ts', 'App.tsx']) if (existsSync(join(ROOT, f))) ALL_SOURCE.push(f);

/** Files that are not source but that a build or a release reads. */
const CONFIG_FILES = ['eas.json', 'app.json', 'app.config.js', 'app.config.ts', 'package.json', '.github/workflows/ship-gate.yml'];
let tracked: string[] = [];
try { tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean); } catch { tracked = []; }
const ENV_FILES = tracked.filter((f) => /(^|\/)\.env(\.|$)/.test(f));
const WORKFLOWS = tracked.filter((f) => f.startsWith('.github/workflows/'));

const impl = { spikeSevenRoomJob, spikeTenWeekSchedule, spikeFortyRoomJob, gestureBegin, gestureMove, gestureEnd, viewSize, labelsToHide, frameStats, canvasStandIn, makePhoneScene, phone3DSettings, surfaceBox };
type Impl = typeof impl;
type Catalog = Record<string, unknown>;
interface World { files: Record<string, string>; EN: Catalog; ES: Catalog; impl: Impl; pkg: { scripts: Record<string, string>; dependencies: Record<string, string> } }

const files: Record<string, string> = {};
for (const f of ALL_SOURCE) files[f] = read(f);
for (const f of [...CONFIG_FILES, ...ENV_FILES, ...WORKFLOWS, 'scripts/validate-native-surface.ts']) if (existsSync(join(ROOT, f))) files[f] = read(f);
const esPlain: Catalog = {};
for (const [k, v] of Object.entries(ES_OFFICE_LIVING_MODEL_PHONE as Record<string, { s: unknown }>)) esPlain[k] = v.s;
const WORLD: World = { files, EN: EN_SHARD as Catalog, ES: esPlain, impl, pkg: JSON.parse(read('package.json')) };

/** Source with its comments taken out, so a rule reads code and not what a comment says about it. */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol;
const ENTRY = 'components/livingModel/JobReplay3D.tsx';
const ENGINE = 'components/livingModel/phone3d/engine.ts';
const VIEW = 'components/livingModel/phone3d/Phone3DView.tsx';
const SCENE = 'components/livingModel/phone3d/phoneScene.ts';
const SPIKE = 'app/dev-phone-3d.tsx';
const LAYOUT = 'app/_layout.tsx';
const LAUNCH = 'utils/phone3dSpikeLaunch.ts';
const SCREEN = 'components/livingModel/LivingModelScreen.tsx';
const THREE_SCENE = 'components/livingModel/threeScene.ts';
const SWITCH = 'EXPO_PUBLIC_PHONE3D_SPIKE';
const K = 'office.livingModelPhone.';

interface Rule { id: string; what: string; run: (w: World) => string[] }
const RULES: Rule[] = [];
const rule = (id: string, what: string, run: (w: World) => string[]): void => { RULES.push({ id, what, run }); };

// ── A. fingers and sizes, as numbers ─────────────────────────────────────────

rule('A1', 'one finger that stays put is a tap and turns nothing; one that travels turns the model by exactly its travel', (w) => {
  const out: string[] = [];
  const { gestureBegin: B, gestureMove: M, gestureEnd: E } = w.impl;
  // Lands at (100, 100), wobbles 3 points, lifts after 120 ms.
  let g = B([{ id: 'a', x: 100, y: 100 }], 1000);
  let r = M(g, [{ id: 'a', x: 103, y: 100 }]);
  if (r.acts.length) out.push(`a 3 point wobble moved the model: ${JSON.stringify(r.acts)}`);
  g = r.state;
  if (E(g, 1120).map((a) => a.kind).join() !== 'tap') out.push('a still touch of 120 ms is not a tap');
  if (E(g, 1000 + TAP_MAX_MS + 1).length) out.push('a still touch held past the limit is a tap');
  // Lands at (100, 100), goes to (120, 100) then (126, 104): 20 across, then 6 across and 4 down. 26 and 4 in all.
  g = B([{ id: 'a', x: 100, y: 100 }], 0);
  r = M(g, [{ id: 'a', x: 120, y: 100 }]);
  const first = r.acts[0];
  if (r.acts.length !== 1 || first.kind !== 'orbit' || first.dx !== 20 || first.dy !== 0) out.push(`the first travel past the slop gave ${JSON.stringify(r.acts)}; want one turn of 20, 0`);
  r = M(r.state, [{ id: 'a', x: 126, y: 104 }]);
  const second = r.acts[0];
  if (r.acts.length !== 1 || second.kind !== 'orbit' || second.dx !== 6 || second.dy !== 4) out.push(`the next travel gave ${JSON.stringify(r.acts)}; want one turn of 6, 4`);
  if (E(r.state, 50).length) out.push('a finger that travelled is a tap');
  if (!(TAP_SLOP_PT >= 4 && TAP_SLOP_PT <= 12)) out.push(`the slop is ${TAP_SLOP_PT} points: a tap needs a little room and a drag must start soon`);
  return out;
});

rule('A2', 'two fingers move the model by their middle, zoom it by their spread and turn it by their twist; a finger landing or lifting moves nothing and ends the tap', (w) => {
  const out: string[] = [];
  const { gestureBegin: B, gestureMove: M, gestureEnd: E } = w.impl;
  // Fingers at (100, 200) and (200, 200): 100 apart, middle (150, 200).
  // They go to (90, 210) and (240, 210): 150 apart, middle (165, 210). Zoom 1.5, move 15 across and 10 down.
  const g = B([{ id: 'a', x: 100, y: 200 }, { id: 'b', x: 200, y: 200 }], 0);
  const r = M(g, [{ id: 'a', x: 90, y: 210 }, { id: 'b', x: 240, y: 210 }]);
  const zoom = r.acts.find((a) => a.kind === 'zoom');
  const pan = r.acts.find((a) => a.kind === 'pan');
  if (!zoom || zoom.kind !== 'zoom' || !near(zoom.factor, 1.5)) out.push(`the spread went 100 to 150 and the zoom is ${JSON.stringify(zoom)}; want 1.5`);
  if (!pan || pan.kind !== 'pan' || !near(pan.dx, 15) || !near(pan.dy, 10)) out.push(`the middle went (150, 200) to (165, 210) and the move is ${JSON.stringify(pan)}; want 15, 10`);
  if (r.acts.some((a) => a.kind === 'orbit')) out.push('two fingers turned the model');
  if (r.acts.some((a) => a.kind === 'twist')) out.push('two fingers that stayed level turned the model');
  // Fingers at (100, 200) and (200, 200) turn a quarter of a right angle about their middle without spreading:
  // the second goes to (192.39, 238.27), the first to (107.61, 161.73). The model turns by pi / 8 and does not zoom or move.
  const c8 = Math.cos(Math.PI / 8) * 50;
  const s8 = Math.sin(Math.PI / 8) * 50;
  const tw = M(B([{ id: 'a', x: 100, y: 200 }, { id: 'b', x: 200, y: 200 }], 0), [{ id: 'a', x: 150 - c8, y: 200 - s8 }, { id: 'b', x: 150 + c8, y: 200 + s8 }]);
  const twist = tw.acts.find((a) => a.kind === 'twist');
  if (!twist || twist.kind !== 'twist' || !near(twist.radians, Math.PI / 8, 1e-9)) out.push(`two fingers turned by pi / 8 and the model turned by ${JSON.stringify(twist)}`);
  if (tw.acts.some((a) => (a.kind === 'zoom' && !near(a.factor, 1, 1e-9)) || (a.kind === 'pan' && (Math.abs(a.dx) > 1e-9 || Math.abs(a.dy) > 1e-9)))) out.push('a pure twist also zoomed or moved the model');
  // Two fingers that swap sides in one step are a jump, not a turn.
  const flip = M(B([{ id: 'a', x: 100, y: 200 }, { id: 'b', x: 200, y: 200 }], 0), [{ id: 'a', x: 150, y: 150 }, { id: 'b', x: 150, y: 250 }]).acts.find((a) => a.kind === 'twist');
  if (flip) out.push(`a quarter turn in one step turned the model (${JSON.stringify(flip)}); the limit is ${MAX_TWIST_STEP}`);
  // A second finger lands: nothing moves. Then it lifts: nothing moves. Then the first lifts quickly: not a tap.
  let s = B([{ id: 'a', x: 50, y: 50 }], 0);
  let step = M(s, [{ id: 'a', x: 50, y: 50 }, { id: 'b', x: 300, y: 400 }]);
  if (step.acts.length) out.push(`a second finger landing moved the model: ${JSON.stringify(step.acts)}`);
  s = step.state;
  step = M(s, [{ id: 'b', x: 300, y: 400 }]);
  if (step.acts.length) out.push(`a finger lifting moved the model: ${JSON.stringify(step.acts)}`);
  if (E(step.state, 100).length) out.push('a touch that had two fingers ended as a tap');
  // A spread that jumps from 10 to 400 in one step is held to the limit.
  const j = M(B([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 0 }], 0), [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 400, y: 0 }]).acts.find((a) => a.kind === 'zoom');
  if (!j || j.kind !== 'zoom' || !near(j.factor, MAX_ZOOM_STEP)) out.push(`a jump in the spread zoomed by ${JSON.stringify(j)}; want the limit ${MAX_ZOOM_STEP}`);
  // A reading that is not a number is dropped, not passed on.
  const bad = M(B([{ id: 'a', x: 0, y: 0 }], 0), [{ id: 'a', x: Number.NaN, y: 40 }]);
  if (bad.acts.length) out.push('a touch with no position moved the model');
  return out;
});

rule('A3', 'the scene is handed the view in points and the buffer\'s pixels a point, whatever the buffer is, so the picture fills it and nothing is converted', (w) => {
  const out: string[] = [];
  const V = w.impl.viewSize;
  // A 390 by 380 point view on a 3x phone drawn in full: a 1170 by 1140 pixel buffer. 390 by 380 at 3 pixels a point.
  const a = V(390, 380, 1170, 1140);
  if (!a || !near(a.pixelRatio, 3) || a.width !== 390 || a.height !== 380) out.push(`3x in full: ${JSON.stringify(a)}; want 390 by 380 at 3`);
  // The same view held to 2 pixels a point (Standard on a 3x phone), and on a 2x phone: a 780 by 760 buffer. 390 by 380 at 2.
  const b = V(390, 380, 780, 760);
  if (!b || !near(b.pixelRatio, 2) || b.width !== 390 || b.height !== 380) out.push(`2 pixels a point: ${JSON.stringify(b)}; want 390 by 380 at 2`);
  const c = V(400, 300, 400, 300);
  if (!c || c.pixelRatio !== 1 || c.width !== 400) out.push(`1x: ${JSON.stringify(c)}; want 400 wide at 1`);
  for (const [sz, buf] of [[a, 1170], [b, 780], [c, 400]] as const) if (sz && !near(sz.width * sz.pixelRatio, buf, 1e-6)) out.push('width times ratio is not the buffer width: part of the buffer would be left undrawn');
  if (V(0, 380, 1170, 1140) !== null || V(390, 380, 0, 0) !== null || V(Number.NaN, 1, 1, 1) !== null) out.push('a size that cannot be used is not refused');
  // The scene must accept that ratio: its own cap is the web's 2 unless the caller raises it.
  const view = code(w.files[VIEW] ?? '');
  if (!/maxPixelRatio: PHONE_MAX_PIXEL_RATIO/.test(view)) out.push('the phone does not raise the scene\'s pixel-ratio cap: a 3x buffer would be two thirds filled');
  const three = code(w.files[THREE_SCENE] ?? '');
  if (!/renderer\.setPixelRatio\(Math\.min\(maxPixelRatio, Math\.max\(1, pixelRatio\)\)\);/.test(three)) out.push('the scene does not take its pixel-ratio cap from its caller');
  if (!/export const WEB_SCENE_DEFAULTS = \{ antialias: true, maxPixelRatio: 2, shadowMapSize: 2048 \} as const;/.test(three)) out.push('the scene\'s defaults are no longer the web\'s (smoothing on, 2 pixels a point, a 2048 shadow map)');
  return out;
});

rule('A4', 'two labels never sit on one another: the larger room keeps its label; and frame timing is read right', (w) => {
  const out: string[] = [];
  // Three labels 60 by 24. A at (100, 100) for a 20 m2 room, B at (130, 110) for a 6 m2 room (on top of A),
  // C at (200, 100) for a 4 m2 room (40 points clear of A's edge). B is hidden; A and C stay.
  const hide = w.impl.labelsToHide([{ id: 'b', x: 130, y: 110, w: 60, h: 24, weight: 6 }, { id: 'a', x: 100, y: 100, w: 60, h: 24, weight: 20 }, { id: 'c', x: 200, y: 100, w: 60, h: 24, weight: 4 }]);
  if ([...hide].join() !== 'b') out.push(`of three labels where the small room's sits on the large room's, hidden: ${[...hide].join(', ') || 'none'}; want only the small room's`);
  if (w.impl.labelsToHide([]).size !== 0) out.push('no labels, and something is hidden');
  const st = w.impl.frameStats([10, 30, 20, 40, Number.NaN]);
  if (st.frames !== 4 || st.medianMs !== 30 || st.worstMs !== 40) out.push(`frame timing of 10, 20, 30, 40 gave ${JSON.stringify(st)}`);
  const view = code(w.files[VIEW] ?? '');
  if (!/next\[r\.id\] = pinSize\(scene\.roomWidthPt\(r\.id\) \?\? Number\.NaN, r\.id === selectedRef\.current\);/.test(view)) out.push('how much of a label a room carries is not the scene\'s own rule (sceneCore.pinSize), so the phone and the web would differ');
  if (!/\{detail === 'full' \? <Text style=\{styles\.pinSub\}/.test(view) || !/\{detail === 'dot' \? null : <Text style=\{styles\.pinName\}/.test(view)) out.push('a small room still draws its second line, or a tiny one its name');
  return out;
});

rule('A5', 'the stand-in for a canvas answers only a WebGL2 context, and the wrapper hands points straight through, shows every frame and gives the scene back', (w) => {
  const out: string[] = [];
  const log: string[] = [];
  const gl = { drawingBufferWidth: 1170, drawingBufferHeight: 1140, endFrameEXP: () => { log.push('end'); }, getError: () => { log.push('wait'); return 0; } };
  const canvas = w.impl.canvasStandIn(gl);
  if (canvas.getContext('webgl2') !== gl) out.push('the stand-in does not hand the renderer the phone\'s own drawing context');
  if (canvas.getContext('webgl') !== null || canvas.getContext('2d') !== null) out.push('the stand-in answers a context the phone does not have');
  if (canvas.width !== 1170 || canvas.height !== 1140) out.push('the stand-in is not the size of the drawing buffer');
  try { canvas.addEventListener(); canvas.removeEventListener(); } catch { out.push('the stand-in cannot be listened to: the renderer would throw'); }
  const handle: JobSceneHandle = {
    setRooms: () => { log.push('rooms'); },
    apply: () => { log.push('apply'); },
    resize: (wd, h, pr) => { log.push(`resize ${wd} ${h} ${pr}`); },
    render: () => { log.push('render'); },
    orbit: (dx, dy) => { log.push(`orbit ${dx} ${dy}`); },
    pan: (dx, dy) => { log.push(`pan ${dx} ${dy}`); },
    zoomBy: (f) => { log.push(`zoom ${f}`); },
    resetView: () => { log.push('reset'); },
    turnBy: (r) => { log.push(`turn ${r}`); },
    roomWidthPx: () => 300,
    floorHex: () => null,
    roomCount: () => 0,
    pick: (x, y) => { log.push(`pick ${x} ${y}`); return 'kitchen'; },
    project: () => ({ x: 300, y: 150 }),
    dispose: () => { log.push('dispose'); },
  };
  const scene = w.impl.makePhoneScene(handle, gl);
  if (scene.layout(0, 0) !== false) out.push('a view with no size was laid out');
  if (scene.layout(390, 380) !== true || !log.includes('resize 390 380 3')) out.push(`a 390 by 380 view on a 3x phone was handed to the scene as ${log.filter((l) => l.startsWith('resize')).join('; ') || 'nothing'}; want 390 380 3`);
  log.length = 0;
  scene.draw();
  if (log.join() !== 'render,end') out.push(`a frame did ${log.join(', ') || 'nothing'}; want the scene drawn and then shown`);
  log.length = 0;
  scene.draw(true);
  if (log.join() !== 'render,end,wait') out.push('a timed frame does not wait for the phone to finish drawing');
  log.length = 0;
  scene.orbit(10, 4);
  scene.pan(10, 4);
  if (log.join() !== 'orbit 10 4,pan 10 4') out.push(`a turn and a move of 10, 4 points reached the scene as ${log.join(', ')}; want both in points, as they came`);
  log.length = 0;
  if (scene.pickAt(100, 200) !== 'kitchen' || log.join() !== 'pick 100 200') out.push(`a tap at 100, 200 points asked the scene about ${log.join(', ')}; want 100, 200`);
  const p = scene.labelAt('kitchen');
  if (!p || !near(p.x, 300) || !near(p.y, 150)) out.push(`a label the scene puts at 300, 150 points is drawn at ${JSON.stringify(p)}; want 300, 150`);
  if (scene.roomWidthPt('kitchen') !== 300) out.push(`a room 300 points wide is ${scene.roomWidthPt('kitchen')} points wide; want 300`);
  log.length = 0;
  scene.turnBy(0.25);
  if (log.join() !== 'turn 0.25') out.push('a twist does not reach the scene');
  log.length = 0;
  scene.dispose();
  if (log.join() !== 'dispose') out.push('leaving does not give the scene back');
  return out;
});

rule('A6', 'what the view costs a phone comes from one table: Standard holds a 3x screen to 2 pixels a point with a 1024 shadow map, High is the full screen', (w) => {
  const out: string[] = [];
  const S = w.impl.phone3DSettings;
  const std3 = S('standard', 3);
  if (!near(std3.surfaceScale, 2 / 3) || std3.msaaSamples !== 4 || std3.shadowMapSize !== 1024) out.push(`Standard on a 3x phone: ${JSON.stringify(std3)}; want the surface at two thirds, 4 samples, a 1024 shadow map`);
  const std2 = S('standard', 2);
  if (std2.surfaceScale !== 1 || std2.msaaSamples !== 2 || std2.shadowMapSize !== 1024) out.push(`Standard on a 2x phone: ${JSON.stringify(std2)}; want the whole surface, 2 samples, a 1024 shadow map`);
  const high3 = S('high', 3);
  if (high3.surfaceScale !== 1 || high3.msaaSamples !== 4 || high3.shadowMapSize !== 2048) out.push(`High on a 3x phone: ${JSON.stringify(high3)}; want the whole surface, 4 samples, a 2048 shadow map`);
  if (S('standard', Number.NaN).surfaceScale !== 1 || S('standard', 0).msaaSamples !== 2) out.push('a screen scale that cannot be read is not taken as 2');
  if (S('nonsense' as 'high', 3).shadowMapSize !== 1024) out.push('a quality that is not one of the two is not Standard');
  if (PHONE_3D_QUALITY.standard.maxBufferScale > 2 || PHONE_3D_QUALITY.standard.shadowMapSize > 1024) out.push('Standard is no longer the conservative one');
  // A 390 by 380 view with its surface at two thirds: 260 by 253.33, moved 65 across and 63.33 down, grown 1.5 times. It covers the view.
  const B = w.impl.surfaceBox(390, 380, 2 / 3);
  if (!near(B.width, 260, 1e-6) || !near(B.height, 380 * 2 / 3, 1e-6) || !near(B.translateX, 65, 1e-6) || !near(B.translateY, 380 / 6, 1e-6) || !near(B.scale, 1.5, 1e-9)) out.push(`the surface for a 390 by 380 view at two thirds is ${JSON.stringify(B)}`);
  // After the grow about its middle and the move, its left edge is at 0 and its right edge at the view's width.
  const left = B.translateX + B.width / 2 - (B.width * B.scale) / 2;
  if (!near(left, 0, 1e-6) || !near(left + B.width * B.scale, 390, 1e-6)) out.push(`the grown surface spans ${left} to ${left + B.width * B.scale}; want 0 to 390`);
  const whole = w.impl.surfaceBox(390, 380, 1);
  if (whole.width !== 390 || whole.height !== 380 || whole.translateX !== 0 || whole.translateY !== 0 || whole.scale !== 1) out.push('a whole surface is moved or scaled');
  if (w.impl.surfaceBox(390, 380, 0).scale !== 1 || w.impl.surfaceBox(390, 380, 2).scale !== 1) out.push('a surface scale that cannot be used is not taken as the whole view');
  const view = code(w.files[VIEW] ?? '');
  if (!/const settings = useMemo\(\(\) => phone3DSettings\(quality, PixelRatio\.get\(\)\), \[quality\]\);/.test(view)) out.push('the view does not take its cost from the table');
  if (!/shadowMapSize: settings\.shadowMapSize/.test(view) || !/antialias: false/.test(view)) out.push('the scene is not built with the table\'s shadow map, or asks the renderer for smoothing the surface already does');
  if (!/const surface = box \? surfaceBox\(box\.w, box\.h, settings\.surfaceScale\) : null;/.test(view)) out.push('the drawing surface is not laid out at the table\'s size');
  if (!/transform: \[\{ translateX: surface\.translateX \}, \{ translateY: surface\.translateY \}, \{ scale: surface\.scale \}\]/.test(view)) out.push('the smaller surface is not moved and then grown back over the view');
  const entry = code(w.files[ENTRY] ?? '');
  if (!/quality = 'standard'/.test(entry)) out.push('a view that is told no quality does not draw at Standard');
  const screen = code(w.files[SCREEN] ?? '');
  if (!/let chosenQuality: Phone3DQuality = 'standard';/.test(screen)) out.push('the screen does not start at Standard');
  if (!/\{threeD && onPhone && ownerTools \? \(/.test(screen)) out.push('the 3D Quality switch is not for the owner alone, on the phone, over a 3D picture');
  if (!/return isOwner\(userEmail\);/.test(/export function livingModelOwnerTools\([\s\S]*?\n\}/.exec(code(w.files['utils/livingModel/allowed.ts'] ?? ''))?.[0] ?? '')) out.push('the owner\'s switches are not gated on the owner account');
  if (!/ownerTools=\{livingModelOwnerTools\(user\?\.email\)\}/.test(code(w.files['app/living-model.tsx'] ?? ''))) out.push('the route does not ask the gate who gets the owner\'s switches');
  return out;
});

// ── B. the engine is optional ────────────────────────────────────────────────

rule('B1', 'the native half is asked for with ONE nullable lookup, inside a function and inside a try', (w) => {
  const out: string[] = [];
  const src = code(w.files[ENGINE] ?? '');
  if (!src) return [`${ENGINE} is missing`];
  if (!/import \{ requireOptionalNativeModule \} from 'expo';/.test(src)) out.push('the lookup is not the nullable one from `expo`');
  if (/\brequireNativeModule\b|\brequireNativeViewManager\b|\bNativeModules\b|expo-modules-core/.test(src)) out.push('the engine file names a lookup that throws when the module is not in the build');
  const fn = /export function phone3DEngineInBuild\(\): boolean \{([\s\S]*?)\n\}/.exec(src);
  if (!fn) out.push('phone3DEngineInBuild is missing');
  else {
    const tryAt = fn[1].indexOf('try {');
    const look = fn[1].indexOf('requireOptionalNativeModule(EXPO_GL_NATIVE_MODULE) != null');
    if (tryAt < 0 || look < 0 || look < tryAt) out.push('the lookup is not inside a try');
    if (!/\} catch \{\s*inBuild = false;\s*\}/.test(fn[1])) out.push('a lookup that throws is not answered with "not in this build"');
    if (!/if \(Platform\.OS === 'web'\) \{ inBuild = false; return inBuild; \}/.test(fn[1])) out.push('a browser is not answered with "not in this build" before the lookup');
  }
  if ((src.match(/requireOptionalNativeModule\(/g) ?? []).length !== 1) out.push('there is not exactly one lookup');
  if (!/export const EXPO_GL_NATIVE_MODULE = 'ExponentGLObjectManager';/.test(src)) out.push('the module is not looked up by the name expo-gl registers');
  for (const [f, s] of Object.entries(w.files)) {
    if (!/\.(ts|tsx|js|jsx)$/.test(f)) continue;
    if (/^(?:export\s+)?(?:const|let|var)\s[^\n]*phone3DEngineInBuild\(\)|^void phone3DEngineInBuild\(\)|^phone3DEngineInBuild\(\)/m.test(code(s))) out.push(`${f} asks for the engine at module scope`);
  }
  return out;
});

rule('B2', 'expo-gl is named in ONE source file and read there lazily; nothing imports it statically', (w) => {
  const out: string[] = [];
  const namers = Object.keys(w.files).filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f) && !f.startsWith('scripts/') && /['"]expo-gl(?:\/[^'"]*)?['"]/.test(code(w.files[f])));
  if (namers.join() !== ENGINE) out.push(`expo-gl is named by ${namers.join(', ') || 'nobody'}; want only ${ENGINE}`);
  const src = code(w.files[ENGINE] ?? '');
  if (/from\s+['"]expo-gl|require\s*\(\s*['"]expo-gl|^\s*import\s+['"]expo-gl/m.test(src)) out.push('the engine file imports expo-gl statically: a build without it would throw as the bundle loads');
  if ((src.match(/import\(\s*'expo-gl'\s*\)/g) ?? []).length !== 1) out.push('expo-gl is not read by exactly one dynamic import');
  const users = Object.keys(w.files).filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith('scripts/') && /phone3d\/(engine|Phone3DView|phoneScene)['"]/.test(code(w.files[f])) && !f.startsWith('components/livingModel/phone3d/'));
  // The simulator check may ask the engine file two questions (is it in the build, why did it not load) and nothing else.
  if (users.filter((f) => f !== SPIKE).join() !== ENTRY) out.push(`the phone's 3D files are imported by ${users.join(', ') || 'nobody'}; want only ${ENTRY}`);
  const spikePhone = code(w.files[SPIKE] ?? '').split('\n').filter((l) => /phone3d\//.test(l));
  if (spikePhone.some((l) => l.trim() !== "import { phone3DEngineError, phone3DEngineInBuild } from '@/components/livingModel/phone3d/engine';")) out.push(`${SPIKE} reaches into the phone's 3D files for more than the two questions it may ask`);
  const view = code(w.files[VIEW] ?? '');
  if (/import\s*\(|\brequire\s*\(|['"]three['"]/.test(view)) out.push('the phone view reads a library itself instead of being handed it');
  if (!/const \{ GLView \} = engine;/.test(view)) out.push('the phone view does not take its drawing surface from the engine it is handed');
  return out;
});

// ── C. the flat replay is always reachable ───────────────────────────────────

rule('C1', 'no engine, a failed read, a failed start and a failed frame all end on the flat replay with one plain line', (w) => {
  const out: string[] = [];
  const src = code(w.files[ENTRY] ?? '');
  if (!/if \(e\) \{ setEngine\(e\); setMode\('3d'\); \} else setMode\('failed'\);/.test(src)) out.push('an engine that would not load does not end on the flat replay');
  if (!/onFailed=\{\(\) => setMode\('failed'\)\}/.test(src)) out.push('a start or a frame that failed does not end on the flat replay');
  if (!/\{mode === 'no_engine' \? phoneCopy\.needsNewVersionBody : phoneCopy\.couldNotStartBody\}/.test(src)) out.push('the flat replay does not say which of the two it is');
  const tail = src.slice(src.lastIndexOf('return ('));
  if (!/<FlatReplay /.test(tail) || /Phone3DView/.test(tail)) out.push('the last thing the entry file can draw is not the flat replay');
  if (w.EN[`${K}needsNewVersionBody`] !== '3D needs the newest version of the app.') out.push('the line for a build with no engine is not the one that was asked for');
  if (/onUnavailable\(\)/.test(src)) out.push('the phone tells the screen 3D is unavailable: the screen would add the browser\'s sentence above the flat replay');
  return out;
});

rule('C2', 'a throw while the 3D view is drawn is caught, and every call into the scene is inside a try', (w) => {
  const out: string[] = [];
  const src = code(w.files[ENTRY] ?? '');
  if (!/static getDerivedStateFromError\(\)/.test(src) || !/componentDidCatch\(\): void \{ this\.props\.onError\(\); \}/.test(src)) out.push('there is no boundary that catches a throw');
  if (!/<Phone3DBoundary onError=\{\(\) => setMode\('failed'\)\}>\s*<Phone3DView /.test(src)) out.push('the 3D view is not inside the boundary');
  const view = code(w.files[VIEW] ?? '');
  const lines = view.split('\n');
  lines.forEach((line, i) => {
    const calls = line.match(/\b(?:scene|live|s|sceneRef\.current)\??\.(?:draw|setRooms|apply|orbit|pan|zoomBy|resetView|pickAt|dispose)\(/g) ?? [];
    if (!calls.length) return;
    const back = lines.slice(Math.max(0, i - 6), i + 1).join('\n');
    if (!/try \{/.test(back)) out.push(`${VIEW}:${i + 1} calls the scene outside a try`);
  });
  if (!/const scene = makePhoneScene\(engine\.createScene\(canvasStandIn\(gl\), palette, \{[^\n]*\}\), gl\);/.test(view)) out.push('the scene is not built on the phone\'s drawing context');
  const made = view.indexOf('makePhoneScene(engine.createScene(');
  if (made < 0 || view.lastIndexOf('try {', made) < 0 || view.indexOf('} catch (e) {\n      fail(e);', made) < 0) out.push('a start that throws is not reported');
  if (!/if \(failed\.current\) return;\s*failed\.current = true;/.test(view)) out.push('a failure can be reported more than once');
  return out;
});

rule('C3', 'the screen says the phone\'s own sentence under a 3D picture and nothing 3D under a flat one', (w) => {
  const out: string[] = [];
  const entry = code(w.files[ENTRY] ?? '');
  if (!/const flat = mode === 'no_engine' \|\| mode === 'failed';/.test(entry) || !/useLayoutEffect\(\(\) => \{ onFlatRef\.current\?\.\(flat\); \}, \[flat\]\);/.test(entry)) out.push('the phone view does not tell the screen, before the frame is shown, that it is drawing the flat replay');
  const screen = code(w.files[SCREEN] ?? '');
  if (!/onFlat=\{setPhoneFlat\}/.test(screen)) out.push('the screen does not listen for the flat replay');
  if (!/const try3d = JOB_REPLAY_3D_ON_THIS_PLATFORM && !no3d;\s*const threeD = try3d && !phoneFlat;/.test(screen)) out.push('the screen still counts a flat picture drawn by the phone view as a 3D one');
  if (!/\{threeD \? <Text style=\{styles\.note\} testID="lm-3d-hint">\{onPhone \? phoneCopy\.touchHelpSub : wide \? copy\.orbitHelpSub : copy\.touchHelpSub\}<\/Text> : null\}/.test(screen)) out.push('the line under the 3D view is not the phone\'s own on the phone, or is printed under a flat picture');
  if (!/const onPhone = Platform\.OS !== 'web';/.test(screen)) out.push('the screen does not know the phone from a narrow browser');
  const touch = String(w.EN[`${K}touchHelpSub`] ?? '');
  if (!/^Drag to turn\./.test(touch) || /scrolls the page/i.test(touch)) out.push(`the phone's line does not say one finger turns the model: "${touch}"`);
  if (/phoneNoteTitleBody|phoneNoteBody|lm-phone-note/.test(screen) || /phoneNoteTitleBody|phoneNoteBody/.test(w.files['hooks/useLivingModelCopy.ts'] ?? '')) out.push('the old "3D is on the web for now" note is back: the phone has a 3D view');
  if (!/<View style=\{styles\.panel\}>\s*<Text style=\{styles\.para\} testID="lm-phone-3d-note">/.test(entry)) out.push('the one line above the flat replay is not drawn as a plain panel');
  if ((entry.match(/<HonestyLines/g) ?? []).length !== 0) out.push('the phone view draws honesty lines of its own: the screen draws them once, under every view');
  return out;
});

// ── D. frames ────────────────────────────────────────────────────────────────

rule('D1', 'a frame is drawn only when something changed, and the frames stop when nothing is owed', (w) => {
  const out: string[] = [];
  const view = code(w.files[VIEW] ?? '');
  if (!/if \(dirty\.current\) \{\s*dirty\.current = false;\s*try \{ scene\.draw\(\); \}/.test(view)) out.push('a frame is drawn whether or not anything changed');
  if (!/if \(dirty\.current \|\| labelsStale\.current\) raf\.current = requestAnimationFrame\(/.test(view)) out.push('the next frame is asked for even when nothing is owed');
  const frame = /frameRef\.current = \(ts: number\) => \{([\s\S]*?)\n  \};/.exec(view);
  if (!frame) out.push('the frame function is missing');
  else if ((frame[1].match(/requestAnimationFrame\(/g) ?? []).length !== 1) out.push('the frame function asks for more than one next frame');
  if (/setInterval\(/.test(view)) out.push('the view draws on a timer');
  if (!/if \(labelsStale\.current && ts - labelsAt\.current >= LABEL_THROTTLE_MS\)/.test(view)) out.push('the labels are moved on every frame instead of about thirty times a second');
  if (!/style=\{\[styles\.pin, [^\n]*\]\}\s*pointerEvents="none"\s*accessibilityElementsHidden/.test(view)) out.push('a label can take a touch meant for the model, or is read twice by a screen reader');
  return out;
});

rule('D2', 'nothing is drawn when the screen is not in front or the app is not active, and coming back draws once', (w) => {
  const out: string[] = [];
  const view = code(w.files[VIEW] ?? '');
  if ((view.match(/if \(raf\.current \|\| failed\.current \|\| !sceneRef\.current \|\| !focused\.current \|\| !appActive\.current\) return;/g) ?? []).length !== 2 || (view.match(/requestAnimationFrame\(/g) ?? []).length !== 5) out.push('a frame can be asked for while the screen is not in front or the app is not active');
  if (!/if \(!scene \|\| failed\.current \|\| !focused\.current \|\| !appActive\.current\) return;/.test(view)) out.push('a frame already asked for is still drawn after the app leaves the front');
  if (!/AppState\.addEventListener\('change', \(s\) => \{\s*appActive\.current = s === 'active';\s*if \(appActive\.current\) requestDraw\(\);\s*else \{ cancelAnimationFrame\(raf\.current\); raf\.current = 0; \}/.test(view)) out.push('the app leaving the front does not stop the frames, or coming back does not draw');
  if (!/return \(\) => sub\.remove\(\);/.test(view)) out.push('the app-state listener is never removed');
  if (!/useFocusEffect\(useCallback\(\(\) => \{\s*focused\.current = true;\s*requestDraw\(\);\s*return \(\) => \{\s*focused\.current = false;\s*cancelAnimationFrame\(raf\.current\);/.test(view)) out.push('another screen coming in front does not stop the frames');
  return out;
});

rule('D3', 'every drawn frame is shown, and leaving stops the frames and gives the scene back', (w) => {
  const out: string[] = [];
  const scene = code(w.files[SCENE] ?? '');
  if (!/draw\(wait\) \{\s*handle\.render\(\);\s*gl\.endFrameEXP\(\);/.test(scene)) out.push('a drawn frame is not shown: expo-gl draws off screen until endFrameEXP');
  if (!/dispose: \(\) => handle\.dispose\(\),/.test(scene)) out.push('the wrapper does not give the scene back');
  const view = code(w.files[VIEW] ?? '');
  if (!/alive\.current = false;\s*cancelAnimationFrame\(raf\.current\);\s*raf\.current = 0;\s*const s = sceneRef\.current;\s*sceneRef\.current = null;\s*try \{ s\?\.dispose\(\); \}/.test(view)) out.push('leaving the view does not stop the frames and give the scene back');
  if (!/<GLView style=\{\{ flex: 1 \}\} msaaSamples=\{debug\?\.msaaSamples \?\? settings\.msaaSamples\} onContextCreate=\{onContextCreate\} \/>/.test(view)) out.push('the drawing surface is not the engine\'s own view, so its context would not end with it');
  const entry = code(w.files[ENTRY] ?? '');
  if (!/<Phone3DView key=\{`\$\{paletteKey\.current\.n\}-\$\{quality\}`\}/.test(entry)) out.push('a new theme, or a new quality, does not build the scene again');
  return out;
});

rule('D4', 'nothing moves on its own, and the one fade is skipped under Reduce Motion', (w) => {
  const out: string[] = [];
  const view = code(w.files[VIEW] ?? '');
  if (!/const reduceMotion = useReducedMotion\(\);/.test(view)) out.push('the view does not read Reduce Motion');
  if (!/if \(reduceRef\.current\) \{ fade\.setValue\(1\); return; \}/.test(view)) out.push('the fade runs under Reduce Motion');
  if ((view.match(/Animated\.(timing|spring|decay)\(/g) ?? []).length !== 1 || /Animated\.loop\(/.test(view)) out.push('the view animates more than its one fade');
  return out;
});

rule('D5', 'the page behind does not scroll while a finger is on the model, and gets its scrolling back when the last finger lifts, the touch is taken away, the view fails or leaves', (w) => {
  const out: string[] = [];
  const view = code(w.files[VIEW] ?? '');
  if (!/onPanResponderGrant: \(e\) => \{\s*hold\(true\);/.test(view)) out.push('a finger landing on the model does not hold the page');
  if (!/onPanResponderRelease: \(\) => \{\s*hold\(false\);/.test(view)) out.push('the last finger lifting does not give the page back');
  if (!/onPanResponderTerminate: \(\) => \{ hold\(false\); gesture\.current = null; \},/.test(view)) out.push('a touch that is taken away leaves the page held');
  if (!/try \{ s\?\.dispose\(\); \} catch \{[^}]*\}\s*hold\(false\);\s*\};\s*\}, \[hold\]\);/.test(view)) out.push('a view that leaves with a finger down leaves the page held');
  if (!/try \{ s\?\.dispose\(\); \} catch \{[^}]*\}\s*hold\(false\);\s*if \(alive\.current\) onFailedRef\.current\(\);/.test(view)) out.push('a view that fails with a finger down leaves the page held');
  if (!/if \(held\.current === on\) return;\s*held\.current = on;\s*onHoldRef\.current\?\.\(on\);/.test(view)) out.push('the page is told more than once each way, or not at all');
  if (!/onStartShouldSetPanResponder: \(\) => true,\s*onMoveShouldSetPanResponder: \(\) => true,\s*onPanResponderTerminationRequest: \(\) => false,/.test(view)) out.push('the model does not take the touch as it lands and keep it');
  const screen = code(w.files[SCREEN] ?? '');
  if (!/scrollEnabled=\{!\(modelHeld && tab === 'replay'\)\}/.test(screen)) out.push('the screen\'s page scrolls while the model is held, or stays held on another tab');
  if (!/onHold=\{onHoldModel\}/.test(screen) || !/onHoldModel=\{setModelHeld\}/.test(screen)) out.push('the screen does not hear that a finger is on the model');
  // The page must still scroll from outside the model: the model's box is a fixed height, never the whole page.
  if (!/height=\{wide \? 560 : 380\}/.test(screen)) out.push('the model\'s box is no longer a fixed height: on a small phone it could fill the page and leave nowhere to scroll from');
  return out;
});

rule('D6', 'a drawing surface that never starts ends on the flat replay instead of "Loading" for good', (w) => {
  const out: string[] = [];
  const view = code(w.files[VIEW] ?? '');
  if (!/if \(ready\) return;\s*const id = setTimeout\(\(\) => \{\s*if \(!sceneRef\.current && appActive\.current\) fail\(new Error\('The drawing surface did not start\.'\)\);\s*\}, SURFACE_START_WAIT_MS\);\s*return \(\) => clearTimeout\(id\);/.test(view)) out.push('nothing waits for the drawing surface to start');
  if (!/\{surface \? \(/.test(view) || !/setBox\(\(prev\) =>/.test(view)) out.push('the drawing surface is mounted before its box has a size');
  return out;
});

// ── E. the simulator check ───────────────────────────────────────────────────

rule('E1', 'the simulator check\'s switch is in no build profile, no app config, no workflow and no committed env file', (w) => {
  const out: string[] = [];
  const envFiles = Object.keys(w.files).filter((f) => /(^|\/)\.env(\.|$)/.test(f));
  for (const f of [...CONFIG_FILES, ...envFiles, ...WORKFLOWS]) {
    if ((w.files[f] ?? '').includes(SWITCH)) out.push(`${f} names ${SWITCH}: a build anyone installs would open the check`);
  }
  if (!('eas.json' in w.files) || !('app.json' in w.files)) out.push('eas.json or app.json could not be read');
  const namers = Object.keys(w.files).filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f) && !f.startsWith('scripts/') && code(w.files[f]).includes(SWITCH));
  if (namers.slice().sort().join() !== [LAYOUT, SPIKE, LAUNCH].sort().join()) out.push(`the switch is read by ${namers.join(', ') || 'nobody'}; want only the route, the auth wall and the launch argument reader`);
  const launch = code(w.files[LAUNCH] ?? '');
  if (!/if \(process\.env\.EXPO_PUBLIC_PHONE3D_SPIKE !== '1' \|\| Platform\.OS !== 'ios'\) return null;\s*try \{/.test(launch)) out.push('the launch argument is read in a build made without the switch');
  return out;
});

rule('E2', 'without the switch the route sends everyone Home and mounts nothing, and the auth wall opens for it only under the switch', (w) => {
  const out: string[] = [];
  const spike = code(w.files[SPIKE] ?? '');
  if (!spike) return [`${SPIKE} is missing`];
  if (!/export const PHONE3D_SPIKE_ON = process\.env\.EXPO_PUBLIC_PHONE3D_SPIKE === '1';/.test(spike)) out.push('the route is not switched by the variable alone');
  const route = /export default function DevPhone3DRoute\(\) \{([\s\S]*?)\n\}/.exec(spike);
  if (!route || !/^\s*if \(!PHONE3D_SPIKE_ON\) return <Redirect href="\/\(tabs\)\/\(home\)" \/>;\s*return <Spike \/>;\s*$/.test(route[1])) out.push('the route does not redirect, before anything else, when the switch is off');
  const layout = code(w.files[LAYOUT] ?? '');
  if (!/const inPhone3dSpike = process\.env\.EXPO_PUBLIC_PHONE3D_SPIKE === '1' && \(segments\[0\] as string\) === 'dev-phone-3d';/.test(layout)) out.push('the auth wall does not tie its opening to the switch');
  if (!/if \(!inPhone3dSpike && !phone3dSpikeOpened\.current && phone3dSpikeLaunchArgs\(\)\) \{\s*phone3dSpikeOpened\.current = true;\s*router\.replace\('\/dev-phone-3d'\);/.test(layout)) out.push('the check is opened by something other than a launch argument, or more than once');
  if ((layout.match(/dev-phone-3d/g) ?? []).length !== 3) out.push('app/_layout.tsx names the route somewhere other than its Stack.Screen, the auth wall and the launch argument');
  if (!/name="dev-phone-3d"/.test(layout)) out.push('the route is not declared in the Stack');
  for (const f of ['app/(tabs)/_layout.tsx', 'components/DesktopSidebar.tsx']) if (/dev-phone-3d/.test(w.files[f] ?? '')) out.push(`${f} links the simulator check`);
  const linkers = Object.keys(w.files).filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith('scripts/') && f !== LAYOUT && f !== SPIKE && f !== LAUNCH && f !== 'utils/desktopPage.ts' && /dev-phone-3d/.test(code(w.files[f])));
  // utils/desktopPage.ts gives every route file a page width; that table is not a door.
  if (linkers.length) out.push(`the simulator check is linked from ${linkers.join(', ')}`);
  return out;
});

rule('E3', 'the check draws the Living Model\'s own sample: the copy equals the fixture, and the big sample is forty rooms that do not overlap', (w) => {
  const out: string[] = [];
  if (JSON.stringify(w.impl.spikeSevenRoomJob()) !== JSON.stringify(sevenRoomJob())) out.push('the seven-room sample is not the fixture\'s seven-room job');
  if (JSON.stringify(w.impl.spikeTenWeekSchedule()) !== JSON.stringify(tenWeekSchedule())) out.push('the ten-week sample is not the fixture\'s schedule');
  const big = w.impl.spikeFortyRoomJob();
  if (big.rooms.length !== 40) out.push(`the big sample has ${big.rooms.length} rooms; want 40`);
  const check = validateModel(big);
  if (!check.ok || check.warnings.length) out.push(`the big sample has warnings: ${JSON.stringify(check.warnings).slice(0, 200)}`);
  if (big.rooms.some((r) => (big.links[r.id] ?? []).length === 0)) out.push('a room of the big sample has no tasks ticked, so it would never change');
  return out;
});

// ── F. the gate is unchanged ─────────────────────────────────────────────────

rule('F1', 'the Living Model\'s flag is off and its route still redirects everyone the gate refuses', (w) => {
  const out: string[] = [];
  if (!/^export const LIVING_MODEL_ENABLED = false;$/m.test(w.files['constants/featureFlags.ts'] ?? '')) out.push('LIVING_MODEL_ENABLED is not false');
  const route = code(w.files['app/living-model.tsx'] ?? '');
  if (!/if \(!livingModelAllowed\(user\?\.email\)\) return <Redirect href="\/\(tabs\)\/\(home\)" \/>;/.test(route)) out.push('app/living-model.tsx no longer redirects a person the gate refuses');
  const allowed = code(w.files['utils/livingModel/allowed.ts'] ?? '');
  if (!/import \{ LIVING_MODEL_ENABLED \} from '@\/constants\/featureFlags';/.test(allowed)) out.push('the gate no longer reads the flag');
  for (const f of [ENTRY, ENGINE, VIEW, SCENE]) if (/LIVING_MODEL_ENABLED|livingModelAllowed|OWNER_EMAILS|isOwner/.test(code(w.files[f] ?? ''))) out.push(`${f} makes a gate decision of its own: the screen's gate is the only one`);
  return out;
});

rule('F2', 'this gate is wired into the ship check, and the bundle check knows expo-gl', (w) => {
  const out: string[] = [];
  if (w.pkg.scripts['test:phone-3d'] !== 'bun run scripts/validate-phone-3d.ts') out.push('package.json has no test:phone-3d script');
  if (!/&& bun run test:phone-3d(?: |$)/.test(w.pkg.scripts['ship-check'] ?? '')) out.push('the ship check does not run test:phone-3d');
  const ns = w.files['scripts/validate-native-surface.ts'] ?? '';
  if (!/\{ pkg: 'expo-gl', markers: \['ExponentGLObjectManager', 'ExponentGLView'\] \}/.test(ns)) out.push('the bundle check has no row for expo-gl');
  if (!/PHONE_3D_ENGINE/.test(ns)) out.push('the bundle check does not tie the 3D library in the phone bundle to expo-gl being declared');
  return out;
});

// ── G. the words ─────────────────────────────────────────────────────────────

const BANNED_EN = /\b(accurate|accurately|accuracy|exact|exactly|verified|verify|real-time|realtime|live|as-built|digital twin|bim)\b/i;
const BANNED_ES = /\b(exact[oa]s?|exactamente|precis[oa]s?|precisión|verificad[oa]s?|tiempo real|en vivo|como construido|gemelo digital|bim)\b/i;
rule('G1', 'every string is in English and Spanish, in the house voice, and says nothing about how right the model is', (w) => {
  const out: string[] = [];
  const en = Object.keys(w.EN).sort();
  const es = Object.keys(w.ES).sort();
  if (en.join() !== es.join()) out.push(`English has ${en.length} keys and Spanish ${es.length}, or they differ`);
  if (en.length !== 8) out.push(`the surface has ${en.length} keys; this gate knows 8`);
  for (const k of en) {
    const e = String(w.EN[k] ?? '');
    const s = String(w.ES[k] ?? '');
    for (const [lang, v, banned] of [['English', e, BANNED_EN], ['Spanish', s, BANNED_ES]] as const) {
      if (!v.trim()) { out.push(`${k} has no ${lang}`); continue; }
      if (banned.test(v)) out.push(`${k} (${lang}) says how right the model is: "${v}"`);
      if (/[—–&→←]|e\.g\./.test(v)) out.push(`${k} (${lang}) has an em dash, an "and" sign, an arrow or "e.g."`);
      if (k.endsWith('Body') && !/[.?!]$/.test(v)) out.push(`${k} (${lang}) is a sentence with no end`);
      if (k.endsWith('Sub') && /[.]$/.test(v)) out.push(`${k} (${lang}) is a caption that ends in a period`);
      if (v[0] !== v[0].toUpperCase()) out.push(`${k} (${lang}) does not start with a capital`);
    }
  }
  const hook = w.files['hooks/usePhone3DCopy.ts'] ?? '';
  for (const k of en) if (!hook.includes(`'${k}'`)) out.push(`${k} is not in the copy hook`);
  for (const f of [ENTRY, VIEW]) if (/\bt\(\s*['"]/.test(code(w.files[f] ?? ''))) out.push(`${f} has a string key of its own: they live in the copy hooks`);
  return out;
});

// ── planted mutations ────────────────────────────────────────────────────────

interface Mutation { rule: string; name: string; plant: (w: World) => World }
const edit = (file: string, from: string | RegExp, to: string) => (w: World): World => {
  const s = w.files[file];
  if (s === undefined) throw new Error(`mutation file not found: ${file}`);
  const next = s.replace(from as string, to);
  if (next === s) throw new Error(`mutation anchor not found in ${file}: ${String(from)}`);
  return { ...w, files: { ...w.files, [file]: next } };
};
const addFile = (file: string, body: string) => (w: World): World => ({ ...w, files: { ...w.files, [file]: body } });
const swap = (over: Partial<Impl>) => (w: World): World => ({ ...w, impl: { ...w.impl, ...over } });
const en = (key: string, value: unknown) => (w: World): World => ({ ...w, EN: { ...w.EN, [`${K}${key}`]: value } });
const es = (key: string, value: unknown) => (w: World): World => ({ ...w, ES: { ...w.ES, [`${K}${key}`]: value } });
const pkgEdit = (fn: (p: World['pkg']) => World['pkg']) => (w: World): World => ({ ...w, pkg: fn(JSON.parse(JSON.stringify(w.pkg))) });

const MUTATIONS: Mutation[] = [
  { rule: 'A1', name: 'a wobble turns the model', plant: swap({ gestureMove: (p, f) => { const r = gestureMove({ ...p, moved: true }, f); return r; } }) },
  { rule: 'A1', name: 'every lift is a tap', plant: swap({ gestureEnd: () => [{ kind: 'tap' }] }) },
  { rule: 'A1', name: 'the first travel is thrown away', plant: swap({ gestureMove: (p, f) => { const r = gestureMove(p, f); return !p.moved ? { state: r.state, acts: [] } : r; } }) },
  { rule: 'A2', name: 'two fingers also turn the model', plant: swap({ gestureMove: (p, f) => { const r = gestureMove(p, f); return f.length === 2 ? { state: r.state, acts: [...r.acts, { kind: 'orbit', dx: 1, dy: 1 }] } : r; } }) },
  { rule: 'A2', name: 'the zoom is the inverse of the spread', plant: swap({ gestureMove: (p, f) => { const r = gestureMove(p, f); return { state: r.state, acts: r.acts.map((a) => (a.kind === 'zoom' ? { kind: 'zoom' as const, factor: 1 / a.factor } : a)) }; } }) },
  { rule: 'A2', name: 'a touch that had two fingers can end as a tap', plant: swap({ gestureEnd: (p, now) => gestureEnd({ ...p, multi: false, moved: false }, now) }) },
  { rule: 'A2', name: 'a jump in the spread is not held back', plant: swap({ gestureMove: (p, f) => { const r = gestureMove(p, f); return { state: r.state, acts: r.acts.map((a) => (a.kind === 'zoom' && f.length === 2 && f[1].x === 400 ? { kind: 'zoom' as const, factor: 40 } : a)) }; } }) },
  { rule: 'A3', name: 'the scene is handed the size in pixels', plant: swap({ viewSize: (lw, lh, bw, bh) => { const s = viewSize(lw, lh, bw, bh); return s ? { ...s, width: bw, height: bh } : s; } }) },
  { rule: 'A3', name: 'the ratio is held to the web\'s 2', plant: swap({ viewSize: (lw, lh, bw, bh) => { const s = viewSize(lw, lh, bw, bh); return s ? { ...s, pixelRatio: Math.min(2, s.pixelRatio) } : s; } }) },
  { rule: 'A3', name: 'the phone leaves the scene\'s cap at the web\'s', plant: edit(VIEW, 'maxPixelRatio: PHONE_MAX_PIXEL_RATIO, ', '') },
  { rule: 'A3', name: 'the scene ignores its caller\'s cap', plant: edit(THREE_SCENE, 'renderer.setPixelRatio(Math.min(maxPixelRatio, Math.max(1, pixelRatio)));', 'renderer.setPixelRatio(Math.min(2, Math.max(1, pixelRatio)));') },
  { rule: 'A3', name: 'the web\'s defaults are changed', plant: edit(THREE_SCENE, 'maxPixelRatio: 2, shadowMapSize: 2048 }', 'maxPixelRatio: 3, shadowMapSize: 1024 }') },
  { rule: 'A6', name: 'Standard draws the full 3x screen', plant: swap({ phone3DSettings: (q, sc) => ({ ...phone3DSettings(q, sc), surfaceScale: 1 }) }) },
  { rule: 'A6', name: 'Standard keeps the 2048 shadow map', plant: swap({ phone3DSettings: (q, sc) => ({ ...phone3DSettings(q, sc), shadowMapSize: 2048 }) }) },
  { rule: 'A6', name: 'High is the same as Standard', plant: swap({ phone3DSettings: (_q, sc) => phone3DSettings('standard', sc) }) },
  { rule: 'A6', name: 'the smaller surface grows from its corner', plant: swap({ surfaceBox: (wd, h, k) => ({ ...surfaceBox(wd, h, k), translateX: 0, translateY: 0 }) }) },
  { rule: 'A6', name: 'the view ignores the table\'s smoothing', plant: edit(VIEW, 'const settings = useMemo(() => phone3DSettings(quality, PixelRatio.get()), [quality]);', "const settings = useMemo(() => phone3DSettings('high', 3), []);") },
  { rule: 'A6', name: 'the view opens at High', plant: edit(ENTRY, "quality = 'standard'", "quality = 'high'") },
  { rule: 'A6', name: 'everyone gets the switch', plant: edit(SCREEN, '{threeD && onPhone && ownerTools ? (', '{threeD && onPhone ? (') },
  { rule: 'A6', name: 'the owner\'s switches are for everyone', plant: edit('utils/livingModel/allowed.ts', '  return isOwner(userEmail);\n}\n\nexport type LivingModelSeat', '  return true;\n}\n\nexport type LivingModelSeat') },
  { rule: 'A3', name: 'a view with no size is laid out', plant: swap({ viewSize: (lw, lh, bw, bh) => viewSize(Math.max(1, lw || 1), Math.max(1, lh || 1), Math.max(1, bw || 1), Math.max(1, bh || 1)) }) },
  { rule: 'A2', name: 'a twist is ignored', plant: swap({ gestureMove: (p, f) => { const r = gestureMove(p, f); return { state: r.state, acts: r.acts.filter((a) => a.kind !== 'twist') }; } }) },
  { rule: 'A2', name: 'a twist turns the model the wrong way', plant: swap({ gestureMove: (p, f) => { const r = gestureMove(p, f); return { state: r.state, acts: r.acts.map((a) => (a.kind === 'twist' ? { kind: 'twist' as const, radians: -a.radians } : a)) }; } }) },
  { rule: 'A4', name: 'the phone has a label rule of its own', plant: edit(VIEW, "next[r.id] = pinSize(scene.roomWidthPt(r.id) ?? Number.NaN, r.id === selectedRef.current);", "next[r.id] = 'full';") },
  { rule: 'A5', name: 'a room\'s width is scaled by the screen', plant: swap({ makePhoneScene: (h, gl) => { const s = makePhoneScene(h, gl); return { ...s, roomWidthPt: (id) => (h.roomWidthPx(id) ?? 0) / 1.5 }; } }) },
  { rule: 'A4', name: 'labels may sit on one another', plant: swap({ labelsToHide: () => new Set<string>() }) },
  { rule: 'A4', name: 'the large room loses its label to the small one', plant: swap({ labelsToHide: (boxes) => labelsToHide(boxes.map((x) => ({ ...x, weight: -x.weight }))) }) },
  { rule: 'A5', name: 'a frame is drawn and never shown', plant: swap({ makePhoneScene: (h, gl) => makePhoneScene(h, { ...gl, endFrameEXP: () => {} }) }) },
  { rule: 'A5', name: 'a tap is scaled by the screen', plant: swap({ makePhoneScene: (h, gl) => { const s = makePhoneScene(h, gl); return { ...s, pickAt: (x, y) => h.pick(x * 1.5, y * 1.5) }; } }) },
  { rule: 'A5', name: 'the stand-in answers any context', plant: swap({ canvasStandIn: (gl) => ({ ...canvasStandIn(gl), getContext: () => gl }) }) },
  { rule: 'A5', name: 'labels are scaled by the screen', plant: swap({ makePhoneScene: (h, gl) => { const s = makePhoneScene(h, gl); return { ...s, labelAt: (id) => { const q = h.project(id); return q ? { x: q.x / 1.5, y: q.y / 1.5 } : null; } }; } }) },
  { rule: 'B1', name: 'the lookup that throws', plant: edit(ENGINE, "import { requireOptionalNativeModule } from 'expo';", "import { requireOptionalNativeModule, requireNativeModule } from 'expo';\nexport const GL = requireNativeModule('ExponentGLObjectManager');") },
  { rule: 'B1', name: 'the lookup at module scope', plant: edit(ENTRY, 'type Mode = ', 'export const HAS = phone3DEngineInBuild();\ntype Mode = ') },
  { rule: 'B1', name: 'the lookup outside its try', plant: edit(ENGINE, '  try {\n    inBuild = requireOptionalNativeModule(EXPO_GL_NATIVE_MODULE) != null;', '  inBuild = requireOptionalNativeModule(EXPO_GL_NATIVE_MODULE) != null;\n  try {') },
  { rule: 'B1', name: 'a second lookup, by the view\'s name', plant: edit(ENGINE, 'let loading: Promise', "export const hasView = () => requireOptionalNativeModule('ExponentGLView') != null;\nlet loading: Promise") },
  { rule: 'B2', name: 'a static import of expo-gl in the engine file', plant: edit(ENGINE, "import { requireOptionalNativeModule } from 'expo';", "import { requireOptionalNativeModule } from 'expo';\nimport { GLView as Surface } from 'expo-gl';\nexport { Surface };") },
  { rule: 'B2', name: 'the view imports expo-gl itself', plant: edit(VIEW, 'const touchesOf = ', "const loadSurface = () => import('expo-gl');\nvoid loadSurface;\nconst touchesOf = ") },
  { rule: 'B2', name: 'another screen imports the phone view', plant: addFile('app/somewhere.tsx', "import { Phone3DView } from '@/components/livingModel/phone3d/Phone3DView';\nexport default Phone3DView;\n") },
  { rule: 'B2', name: 'the simulator check mounts the phone view itself', plant: edit(SPIKE, "import { phone3DEngineError, phone3DEngineInBuild } from '@/components/livingModel/phone3d/engine';", "import { phone3DEngineError, phone3DEngineInBuild } from '@/components/livingModel/phone3d/engine';\nimport { Phone3DView } from '@/components/livingModel/phone3d/Phone3DView';\nvoid Phone3DView;") },
  { rule: 'B2', name: 'a require of expo-gl in a util', plant: addFile('utils/glSnapshot.ts', "export const gl = () => require('expo-gl');\n") },
  { rule: 'C1', name: 'a failed read leaves the loading box up for good', plant: edit(ENTRY, "if (e) { setEngine(e); setMode('3d'); } else setMode('failed');", "if (e) { setEngine(e); setMode('3d'); }") },
  { rule: 'C1', name: 'a failed frame is not reported to the entry file', plant: edit(ENTRY, "onFailed={() => setMode('failed')}", 'onFailed={() => {}}') },
  { rule: 'C1', name: 'the line for a build with no engine is reworded', plant: en('needsNewVersionBody', 'Update the app to see this in 3D.') },
  { rule: 'C1', name: 'the phone hands the failure to the screen\'s browser sentence', plant: edit(ENTRY, "  if (mode === 'loading') {", "  if (mode === 'failed') props.onUnavailable();\n  if (mode === 'loading') {") },
  { rule: 'C3', name: 'the phone prints the browser\'s sentence', plant: edit(SCREEN, '{onPhone ? phoneCopy.touchHelpSub : wide ? copy.orbitHelpSub : copy.touchHelpSub}', '{wide ? copy.orbitHelpSub : copy.touchHelpSub}') },
  { rule: 'C3', name: 'the 3D line stays under a flat picture', plant: edit(SCREEN, '  const threeD = try3d && !phoneFlat;', '  const threeD = try3d;') },
  { rule: 'C3', name: 'the phone view never tells the screen', plant: edit(ENTRY, '  useLayoutEffect(() => { onFlatRef.current?.(flat); }, [flat]);\n', '') },
  { rule: 'C3', name: 'the screen does not listen', plant: edit(SCREEN, ' onFlat={setPhoneFlat}', '') },
  { rule: 'C3', name: 'the old phone note comes back', plant: edit(SCREEN, '<Text style={styles.para}>{copy.noWebglBody}</Text>', '<Text style={styles.para}>{copy.phoneNoteBody}</Text>') },
  { rule: 'C3', name: 'the phone view draws honesty lines of its own', plant: edit(ENTRY, '      <FlatReplay model={model}', '      <HonestyLines />\n      <FlatReplay model={model}') },
  { rule: 'C2', name: 'the boundary is removed', plant: edit(ENTRY, "<Phone3DBoundary onError={() => setMode('failed')}>", '<React.Fragment>') },
  { rule: 'C2', name: 'a frame is drawn outside a try', plant: edit(VIEW, 'try { scene.draw(); } catch (e) { fail(e); return; }', 'scene.draw();') },
  { rule: 'C2', name: 'a failure is reported every frame', plant: edit(VIEW, '    if (failed.current) return;\n    failed.current = true;', '    failed.current = true;') },
  { rule: 'D1', name: 'a frame is drawn every time round', plant: edit(VIEW, 'if (dirty.current) {\n      dirty.current = false;', 'if (scene) {\n      dirty.current = false;') },
  { rule: 'D1', name: 'the frames never stop', plant: edit(VIEW, 'if (dirty.current || labelsStale.current) raf.current = requestAnimationFrame(', 'raf.current = requestAnimationFrame(') },
  { rule: 'D1', name: 'the labels move on every frame', plant: edit(VIEW, 'if (labelsStale.current && ts - labelsAt.current >= LABEL_THROTTLE_MS)', 'if (labelsStale.current)') },
  { rule: 'D1', name: 'a label takes the touch', plant: edit(VIEW, '            pointerEvents="none"\n', '') },
  { rule: 'D2', name: 'a frame is asked for in the background', plant: edit(VIEW, 'if (raf.current || failed.current || !sceneRef.current || !focused.current || !appActive.current) return;', 'if (raf.current || failed.current || !sceneRef.current) return;') },
  { rule: 'D2', name: 'the app leaving the front does not stop the frames', plant: edit(VIEW, 'else { cancelAnimationFrame(raf.current); raf.current = 0; }\n    });', '});') },
  { rule: 'D2', name: 'a pending frame is drawn in the background', plant: edit(VIEW, 'if (!scene || failed.current || !focused.current || !appActive.current) return;', 'if (!scene || failed.current) return;') },
  { rule: 'D2', name: 'another screen in front keeps drawing', plant: edit(VIEW, '      focused.current = false;\n      cancelAnimationFrame(raf.current);', '      cancelAnimationFrame(raf.current);') },
  { rule: 'D3', name: 'the frame is never shown', plant: edit(SCENE, '      gl.endFrameEXP();\n', '') },
  { rule: 'D3', name: 'leaving does not give the scene back', plant: edit(VIEW, '      const s = sceneRef.current;\n      sceneRef.current = null;\n      try { s?.dispose(); } catch { /* the drawing surface is already gone */ }\n      // The page gets', '      // The page gets') },
  { rule: 'D3', name: 'a new theme keeps the old colours', plant: edit(ENTRY, '<Phone3DView key={`${paletteKey.current.n}-${quality}`} ', '<Phone3DView key={quality} ') },
  { rule: 'D3', name: 'a new quality keeps the old drawing surface', plant: edit(ENTRY, '<Phone3DView key={`${paletteKey.current.n}-${quality}`} ', '<Phone3DView key={paletteKey.current.n} ') },
  { rule: 'D5', name: 'a finger on the model does not hold the page', plant: edit(VIEW, '    onPanResponderGrant: (e) => {\n      hold(true);', '    onPanResponderGrant: (e) => {') },
  { rule: 'D5', name: 'lifting leaves the page held', plant: edit(VIEW, '    onPanResponderRelease: () => {\n      hold(false);', '    onPanResponderRelease: () => {') },
  { rule: 'D5', name: 'a touch taken away leaves the page held', plant: edit(VIEW, 'onPanResponderTerminate: () => { hold(false); gesture.current = null; },', 'onPanResponderTerminate: () => { gesture.current = null; },') },
  { rule: 'D5', name: 'leaving with a finger down leaves the page held', plant: edit(VIEW, "      // The page gets its scrolling back even if the view left with a finger still down.\n      hold(false);\n", '') },
  { rule: 'D5', name: 'the screen ignores the hold', plant: edit(SCREEN, " scrollEnabled={!(modelHeld && tab === 'replay')}", '') },
  { rule: 'D5', name: 'the page stays held on another tab', plant: edit(SCREEN, "scrollEnabled={!(modelHeld && tab === 'replay')}", 'scrollEnabled={!modelHeld}') },
  { rule: 'D5', name: 'the model hands its touch to the page', plant: edit(VIEW, 'onPanResponderTerminationRequest: () => false,', 'onPanResponderTerminationRequest: () => true,') },
  { rule: 'D6', name: 'nothing waits for the drawing surface', plant: edit(VIEW, "      if (!sceneRef.current && appActive.current) fail(new Error('The drawing surface did not start.'));\n", '') },
  { rule: 'D4', name: 'the fade ignores Reduce Motion', plant: edit(VIEW, '    if (reduceRef.current) { fade.setValue(1); return; }\n', '') },
  { rule: 'D4', name: 'the model spins on its own', plant: edit(VIEW, 'const touchesOf = ', 'export const spin = (v: Animated.Value) => Animated.loop(Animated.timing(v, { toValue: 1, duration: 4000, useNativeDriver: true }));\nconst touchesOf = ') },
  { rule: 'E1', name: 'the switch is put in a build profile', plant: edit('eas.json', '{', `{ "env_note": "${SWITCH}=1",`) },
  { rule: 'E1', name: 'the switch is put in the app config', plant: edit('app.json', '{', `{ "extra_note": "${SWITCH}",`) },
  { rule: 'E1', name: 'the switch is committed in an env file', plant: (w) => ({ ...addFile('.env.production', `${SWITCH}=1\n`)(w) }) },
  { rule: 'E1', name: 'another screen reads the switch', plant: addFile('app/other.tsx', `export const on = process.env.${SWITCH} === '1';\n`) },
  { rule: 'E1', name: 'a launch argument is read in every build', plant: edit(LAUNCH, "if (process.env.EXPO_PUBLIC_PHONE3D_SPIKE !== '1' || Platform.OS !== 'ios') return null;", "if (Platform.OS !== 'ios') return null;") },
  { rule: 'E2', name: 'the check opens itself on every launch', plant: edit(LAYOUT, "if (!inPhone3dSpike && !phone3dSpikeOpened.current && phone3dSpikeLaunchArgs()) {", "if (!inPhone3dSpike && !phone3dSpikeOpened.current) {") },
  { rule: 'E2', name: 'the route draws for everyone', plant: edit(SPIKE, '  if (!PHONE3D_SPIKE_ON) return <Redirect href="/(tabs)/(home)" />;\n', '') },
  { rule: 'E2', name: 'the route is on unless switched off', plant: edit(SPIKE, "process.env.EXPO_PUBLIC_PHONE3D_SPIKE === '1'", "process.env.EXPO_PUBLIC_PHONE3D_SPIKE !== '0'") },
  { rule: 'E2', name: 'the auth wall opens for the route in every build', plant: edit(LAYOUT, "const inPhone3dSpike = process.env.EXPO_PUBLIC_PHONE3D_SPIKE === '1' && (segments[0] as string) === 'dev-phone-3d';", "const inPhone3dSpike = (segments[0] as string) === 'dev-phone-3d';") },
  { rule: 'E2', name: 'a tab links the check', plant: edit('app/(tabs)/_layout.tsx', 'export default', "const DEV = '/dev-phone-3d';\nvoid DEV;\nexport default") },
  { rule: 'E3', name: 'the sample drifts from the fixture', plant: swap({ spikeSevenRoomJob: () => { const m = spikeSevenRoomJob(); return { ...m, rooms: m.rooms.slice(1) }; } }) },
  { rule: 'E3', name: 'the schedule drifts from the fixture', plant: swap({ spikeTenWeekSchedule: () => { const s = spikeTenWeekSchedule(); return { ...s, clock: { ...s.clock, todayOffset: 10 } }; } }) },
  { rule: 'E3', name: 'the big sample is not forty rooms', plant: swap({ spikeFortyRoomJob: () => { const m = spikeFortyRoomJob(); return { ...m, rooms: m.rooms.slice(0, 12) }; } }) },
  { rule: 'F1', name: 'the flag is turned on', plant: edit('constants/featureFlags.ts', 'export const LIVING_MODEL_ENABLED = false;', 'export const LIVING_MODEL_ENABLED = true;') },
  { rule: 'F1', name: 'the route no longer redirects', plant: edit('app/living-model.tsx', '  if (!livingModelAllowed(user?.email)) return <Redirect href="/(tabs)/(home)" />;\n', '') },
  { rule: 'F1', name: 'the phone view makes a gate of its own', plant: edit(ENTRY, 'type Mode = ', "import { LIVING_MODEL_ENABLED } from '@/constants/featureFlags';\nexport const OPEN = LIVING_MODEL_ENABLED || true;\ntype Mode = ") },
  { rule: 'F2', name: 'the gate is taken out of the ship check', plant: pkgEdit((p) => { p.scripts['ship-check'] = p.scripts['ship-check'].replace(' && bun run test:phone-3d', ''); return p; }) },
  { rule: 'F2', name: 'the bundle check forgets expo-gl', plant: edit('scripts/validate-native-surface.ts', "  { pkg: 'expo-gl', markers: ['ExponentGLObjectManager', 'ExponentGLView'] },\n", '') },
  { rule: 'G1', name: 'a Spanish line is missing', plant: (w) => { const e = { ...w.ES }; delete e[`${K}couldNotStartBody`]; return { ...w, ES: e }; } },
  { rule: 'G1', name: 'the English says the model is exact', plant: en('modelA11yBody', 'An exact 3D model of the job. The room list below reads each room.') },
  { rule: 'G1', name: 'the Spanish says the model is exact', plant: es('modelA11yBody', 'Modelo exacto del trabajo en 3D. La lista de cuartos de abajo lee cada cuarto.') },
  { rule: 'G1', name: 'an em dash', plant: en('couldNotStartBody', 'The 3D view could not start on this phone — the same replay is drawn flat below.') },
  { rule: 'G1', name: 'a caption that ends in a period', plant: en('touchHelpSub', 'Drag to turn. Use two fingers to move. Pinch to zoom. Tap a room to pick it.') },
  { rule: 'G1', name: 'a string key in the entry file', plant: edit(ENTRY, 'type Mode = ', "export const say = (t: (k: string, e: string) => string) => t('office.livingModelPhone.extraBody', 'Hello.');\ntype Mode = ") },
];

// ── run ──────────────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
console.log('validate-phone-3d: the Living Model\'s 3D view on the phone\n');
for (const r of RULES) {
  let problems: string[];
  try { problems = r.run(WORLD); } catch (e) { problems = [`threw: ${e instanceof Error ? e.message : String(e)}`]; }
  if (problems.length === 0) { pass += 1; console.log(`  ✓ ${r.id}  ${r.what}`); }
  else { fail += 1; console.log(`  ✗ ${r.id}  ${r.what}`); for (const p of problems.slice(0, 12)) console.log(`        ${p}`); }
}

console.log('\n── planted mutations (each must turn its own rule red)');
const caught = new Set<string>();
for (const m of MUTATIONS) {
  const r = RULES.find((x) => x.id === m.rule);
  let red = false;
  let how = '';
  try {
    const w = m.plant(WORLD);
    let problems: string[];
    try { problems = r ? r.run(w) : []; } catch (e) { problems = [`threw: ${e instanceof Error ? e.message : String(e)}`]; }
    red = problems.length > 0;
    how = red ? '' : 'the rule stayed green';
  } catch (e) {
    how = `mutation could not be planted: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (red) { pass += 1; caught.add(m.rule); } else { fail += 1; console.log(`  ✗ ${m.rule}  NOT CAUGHT: ${m.name} (${how})`); }
}
console.log(`  ${caught.size} of ${RULES.length} rules caught a planted mutation`);
const unproven = RULES.filter((r) => !caught.has(r.id)).map((r) => r.id);
if (unproven.length === 0) { pass += 1; console.log('  ✓ every rule has at least one planted mutation that it catches'); }
else { fail += 1; console.log(`  ✗ rules with no caught mutation: ${unproven.join(', ')}`); }

console.log(`\n${fail === 0 ? '✓' : '✗'} validate-phone-3d: ${pass} checks (${MUTATIONS.length} planted mutations), ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
