// scripts/validate-living-model-looks.ts — the two looks of the Living Model's 3D view (lane LOOKS).
//
// The founder asked for a switch between "Realistic" and "Game Style". This
// gate holds what must stay true about it.
//
// A. THE SWITCH: exactly two looks, named Realistic and Game Style, in English
//    and in Spanish; Game Style is the default and a palette with no look
//    named is drawn as Game Style; THE TWO LOOKS ARE BUILT APART (camera,
//    shading, wall thickness, dark lines, grains, where the stage colour
//    goes), so one cannot drift back into the other; the choice is kept under
//    a key the app owns, so the sweep at a change of account covers it.
// B. EVERY ELEMENT AND EVERY STAGE HAS AN APPEARANCE IN BOTH LOOKS, on a light
//    page and a dark one, as tables (utils/livingModel/looks.ts, run directly)
//    and through the scene builder itself, run here with a renderer that draws
//    nothing. Game Style fills a floor with its stage colour. Realistic leaves
//    the floor its material and draws a band in the stage colour as written.
//    B3 MEASURES THE COLOURS: every stage's band stands at least
//    BAND_MIN_GAP_FROM_FLOOR from each of Realistic's three floors and
//    BAND_MIN_GAP_BETWEEN_STAGES from every other stage, light and dark.
//    B4 holds the shapes both looks are built from (lids, window frames only
//    where the model has a window, the dark rim, the corner shade), and B5 the
//    grains made from arithmetic.
// C. COST: the cost table, tier by tier; the scene makes what its tier may
//    and nothing more; a phone stays inside PHONE_LOOK_BUDGET; the figures
//    written at the top of looks.ts are the ones measured here; throwing a
//    scene away lets go of every material and picture the look made.
// D. THE GATE AND THE WORDS: LIVING_MODEL_ENABLED is still false and is read in
//    one file; the looks modules are pure (no React, no storage, no 3D
//    library); no animation library came in and nothing in the scene builder
//    moves by itself; neither look's words say how right the model is.
//
// NOT PROVED HERE: what the two looks look like. That was looked at in a
// browser (design-previews/living-model/looks2-*.png). Frame rate on a real
// iPhone is not measured here either: rule C1 holds the cost table and the
// counts, not a clock.
//
// Every rule has at least one planted mutation that must turn it red.
// Run: bun run test:living-model-looks
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as THREE_LIB from 'three';

import { sevenRoomJob } from '../__tests__/fixtures/livingModelJobs';
import { createJobScene, type JobSceneHandle, type RoomLook } from '../components/livingModel/threeScene';
import { Theme, deriveAccentPalette, getCustomPrimary, type ThemeColors } from '../constants/colors';
import { EN as EN_SHARD } from '../i18n/catalog/en/office.living-model.generated';
import { ES_OFFICE_LIVING_MODEL } from '../i18n/catalog/es/office/livingModel';
import { livingModelAllowedWith } from '../utils/livingModel/allowed';
import {
  BAND_MIN_GAP_BETWEEN_STAGES, BAND_MIN_GAP_FROM_FLOOR, DEFAULT_MODEL_LOOK, GAME_COLOURS, LOOK_BUILD, LOOK_COST_TABLE, LOOK_ELEMENTS, LOOK_STAGES, LOOK_TIERS, MODEL_LOOKS, MODEL_LOOK_LABELS,
  MODEL_LOOK_STORAGE_KEY, PHONE_LOOK_BUDGET, PLAIN_FLOOR_STAGES, REALISTIC_COLOURS,
  colourGap, elementAppearance, isModelLook, lookCost, lookPalette, lookTier, readModelLook, stageAppearance, type LookCost, type LookTier, type ModelLook,
} from '../utils/livingModel/looks';
import { LOOK_TEXTURES, LOOK_TEXTURE_SIZE, fadePixels, lookTexturePixels, toonRampPixels } from '../utils/livingModel/lookTextures';
import { buildFloorBand, buildRoomGeometry, buildRoomInk, buildWallShade, planarUV } from '../utils/livingModel/sceneCore';
import { roomBounds, worldWalls } from '../utils/livingModel/modelCore';
import { MATERIALS, livingModelPalette, type LivingModelPalette } from '../utils/livingModel/palette';
import type { RoomLayers } from '../utils/livingModel/replayCore';
import type { RoomStage } from '../utils/livingModel/stageCore';
import { APP_STORAGE_PREFIXES, CURRENT_STORAGE_PREFIXES, DEVICE_SCOPED_KEYS, isAppStorageKey } from '../utils/localCacheKeys';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

const SOURCE_DIRS = ['app', 'components', 'contexts', 'hooks', 'utils', 'constants', 'lib'];
function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) out.push(relative(ROOT, p));
  }
}
const ALL_SOURCE: string[] = [];
for (const d of SOURCE_DIRS) walk(join(ROOT, d), ALL_SOURCE);

const impl = {
  MODEL_LOOKS: MODEL_LOOKS as readonly string[],
  LABELS: MODEL_LOOK_LABELS as Record<string, string>,
  DEFAULT: DEFAULT_MODEL_LOOK as string,
  KEY: MODEL_LOOK_STORAGE_KEY,
  ELEMENTS: LOOK_ELEMENTS as readonly string[],
  STAGES: LOOK_STAGES as readonly string[],
  isModelLook, readModelLook, lookPalette, lookCost, elementAppearance, stageAppearance, createJobScene,
  REALISTIC: REALISTIC_COLOURS as unknown as Record<'light' | 'dark', Record<string, string | number>>,
  GAME: GAME_COLOURS as unknown as Record<'light' | 'dark', Record<string, string | number>>,
  COSTS: LOOK_COST_TABLE as Record<string, Record<string, LookCost>>,
  BUILD: LOOK_BUILD as Record<string, { wallT: number; studHalf: number; studGap: number }>,
  BUDGET: PHONE_LOOK_BUDGET as { drawables: number; triangles: number },
  GAPS: { floor: BAND_MIN_GAP_FROM_FLOOR as number, stages: BAND_MIN_GAP_BETWEEN_STAGES as number },
  buildRoomGeometry, buildRoomInk, buildWallShade, buildFloorBand, planarUV, lookTexturePixels, toonRampPixels, fadePixels,
};
type Impl = typeof impl;
type Catalog = Record<string, unknown>;
interface World { files: Record<string, string>; EN: Catalog; ES: Catalog; impl: Impl; pkg: { scripts: Record<string, string>; dependencies: Record<string, string> } }

const files: Record<string, string> = {};
for (const f of ALL_SOURCE) files[f] = read(f);
const esPlain: Catalog = {};
for (const [k, v] of Object.entries(ES_OFFICE_LIVING_MODEL as Record<string, { s: unknown }>)) esPlain[k] = v.s;
const WORLD: World = { files, EN: EN_SHARD as Catalog, ES: esPlain, impl, pkg: JSON.parse(read('package.json')) };

/** Source with its comments taken out, so a rule reads code and not what a comment says about it. */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const K = 'office.livingModel.replay.';
const LOOKS_FILE = 'utils/livingModel/looks.ts';
const TEXTURES_FILE = 'utils/livingModel/lookTextures.ts';
const STORE = 'utils/livingModel/lookStore.ts';
const SCENE = 'components/livingModel/threeScene.ts';
const SCREEN = 'components/livingModel/LivingModelScreen.tsx';
const WEB = 'components/livingModel/JobReplay3D.web.tsx';
const PHONE = 'components/livingModel/JobReplay3D.tsx';
const PHONE_VIEW = 'components/livingModel/phone3d/Phone3DView.tsx';
const SHARED = 'components/livingModel/replayShared.tsx';
const FLAGS = 'constants/featureFlags.ts';
const HEX = /^#[0-9A-Fa-f]{6}$/;

const themeColors = (name: 'light' | 'dark'): ThemeColors => ({ ...Theme[name], ...deriveAccentPalette(getCustomPrimary(), name) }) as ThemeColors;
const BASE: Record<'light' | 'dark', LivingModelPalette> = { light: livingModelPalette(themeColors('light')), dark: livingModelPalette(themeColors('dark')) };
const MODES = ['light', 'dark'] as const;
const lum = (h: string): number => { const v = parseInt(h.slice(1), 16); return (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255; };

interface SceneLog { flat: number; surface: number; toon: number; basic: number; shadowOnly: number; textures: number; domes: number; disposedMaterials: number; disposedTextures: number; disposedDomes: number; level: number; perspective: number; toneMapping: number; shadowsOn: boolean | null; castShadow: boolean | null }

/** The real three.js with a renderer that draws nothing and makers that count, so the scene builder runs here with no WebGL. */
function countingThree(): { lib: typeof import('three'); log: SceneLog } {
  const log: SceneLog = { flat: 0, surface: 0, toon: 0, basic: 0, shadowOnly: 0, textures: 0, domes: 0, disposedMaterials: 0, disposedTextures: 0, disposedDomes: 0, level: 0, perspective: 0, toneMapping: 0, shadowsOn: null, castShadow: null };
  const T = THREE_LIB as unknown as Record<string, new (...a: any[]) => any>;
  const counted = (name: string, key: 'flat' | 'surface' | 'toon' | 'basic' | 'shadowOnly') => class extends T[name] {
    constructor(...a: any[]) { super(...a); log[key] += 1; }
    dispose(): void { log.disposedMaterials += 1; super.dispose(); }
  };
  class Renderer {
    shadowMap = new Proxy({ enabled: false, type: 0 }, { set: (t, k, v) => { (t as Record<string | symbol, unknown>)[k] = v; if (k === 'enabled') log.shadowsOn = v as boolean; return true; } });
    domElement = {};
    set toneMapping(v: number) { log.toneMapping = v; }
    toneMappingExposure = 1;
    setClearColor(): void { /* nothing to draw on */ }
    setPixelRatio(): void { /* nothing to draw on */ }
    setSize(): void { /* nothing to draw on */ }
    render(): void { /* nothing to draw on */ }
    dispose(): void { /* nothing to let go */ }
    forceContextLoss(): void { /* nothing to give back */ }
  }
  class Dome {
    fromScene(): { texture: object; dispose: () => void } { log.domes += 1; return { texture: {}, dispose: () => { log.disposedDomes += 1; } }; }
    dispose(): void { /* nothing to let go */ }
  }
  class Tex extends T.DataTexture {
    constructor(...a: any[]) { super(...a); log.textures += 1; }
    dispose(): void { log.disposedTextures += 1; super.dispose(); }
  }
  class Sun extends T.DirectionalLight {
    set castShadow(v: boolean) { log.castShadow = v; }
    get castShadow(): boolean { return log.castShadow === true; }
  }
  class Level extends T.OrthographicCamera { constructor(...a: any[]) { super(...a); log.level += 1; } }
  class Lens extends T.PerspectiveCamera { constructor(...a: any[]) { super(...a); log.perspective += 1; } }
  const lib = {
    ...(THREE_LIB as object), WebGLRenderer: Renderer, PMREMGenerator: Dome, DataTexture: Tex, DirectionalLight: Sun, OrthographicCamera: Level, PerspectiveCamera: Lens,
    MeshLambertMaterial: counted('MeshLambertMaterial', 'flat'), MeshStandardMaterial: counted('MeshStandardMaterial', 'surface'), MeshToonMaterial: counted('MeshToonMaterial', 'toon'),
    MeshBasicMaterial: counted('MeshBasicMaterial', 'basic'), ShadowMaterial: counted('ShadowMaterial', 'shadowOnly'),
  } as unknown as typeof import('three');
  return { lib, log };
}

const SOLID_DONE: RoomLayers = { skin: 0, studs: 1, roughIn: 1, insulation: 1, board: 1, finish: 1 };
const SOLID_OPEN: RoomLayers = { skin: 0, studs: 1, roughIn: 0.4, insulation: 0, board: 0, finish: 0 };
const UNTOUCHED: RoomLayers = { skin: 1, studs: 0, roughIn: 0, insulation: 0, board: 0, finish: 0 };
const layersFor = (stage: RoomStage): RoomLayers => (PLAIN_FLOOR_STAGES.includes(stage) ? UNTOUCHED : stage === 'done' || stage === 'finishes' ? SOLID_DONE : SOLID_OPEN);

/** A scene of the seven-room job with every room at one stage. */
function sceneAt(w: World, palette: LivingModelPalette, stage: RoomStage | null): { h: JobSceneHandle; log: SceneLog; lib: typeof import('three') } {
  const t = countingThree();
  const h = w.impl.createJobScene(t.lib, {} as HTMLCanvasElement, palette);
  const rooms = sevenRoomJob().rooms;
  h.setRooms(rooms, 1.25);
  h.resize(1100, 560, 1);
  if (stage) {
    const looks = new Map<string, RoomLook>();
    for (const r of rooms) looks.set(r.id, { solid: layersFor(stage), ghost: layersFor(stage), opens: !PLAIN_FLOOR_STAGES.includes(stage), stage });
    h.apply(looks);
  }
  return { h, log: t.log, lib: t.lib };
}

interface Rule { id: string; what: string; run: (w: World) => string[] }
const RULES: Rule[] = [];
const rule = (id: string, what: string, run: (w: World) => string[]): void => { RULES.push({ id, what, run }); };

// ── A. the switch ────────────────────────────────────────────────────────────

rule('A1', 'there are exactly two looks, Realistic then Game Style, and anything else that was stored reads as the default', (w) => {
  const out: string[] = [];
  const L = w.impl.MODEL_LOOKS;
  if (L.length !== 2) out.push(`there are ${L.length} looks; the switch has two`);
  if (L.join() !== 'realistic,game') out.push(`the looks are ${L.join(', ')}; want realistic, game`);
  if (new Set(L).size !== L.length) out.push('a look is listed twice');
  for (const l of L) if (!w.impl.isModelLook(l)) out.push(`${l} is listed and is not taken as a look`);
  for (const bad of ['', 'Realistic', 'toon', null, undefined, 3, {}]) {
    if (w.impl.isModelLook(bad)) out.push(`${JSON.stringify(bad)} is taken as a look`);
    if (w.impl.readModelLook(bad) !== w.impl.DEFAULT) out.push(`a stored ${JSON.stringify(bad)} does not read as the default`);
  }
  for (const l of L) if (w.impl.readModelLook(l) !== l) out.push(`a stored ${l} reads as ${w.impl.readModelLook(l)}`);
  const screen = code(w.files[SCREEN] ?? '');
  if (!/options=\{MODEL_LOOKS\.map\(\(l\) => \(\{ value: l, label: l === 'realistic' \? copy\.lookRealisticLabel : copy\.lookGameLabel \}\)\)\}/.test(screen)) out.push('the switch is not built from the list of looks');
  return out;
});

rule('A2', 'the two names are "Realistic" and "Game Style", the catalog says the same words, and Spanish has them', (w) => {
  const out: string[] = [];
  if (w.impl.LABELS.realistic !== 'Realistic') out.push(`the realistic look is called "${w.impl.LABELS.realistic}"`);
  if (w.impl.LABELS.game !== 'Game Style') out.push(`the game look is called "${w.impl.LABELS.game}"`);
  if (Object.keys(w.impl.LABELS).sort().join() !== [...w.impl.MODEL_LOOKS].sort().join()) out.push('the names do not cover exactly the looks');
  if (w.EN[`${K}lookRealisticLabel`] !== w.impl.LABELS.realistic) out.push(`the catalog calls the realistic look ${JSON.stringify(w.EN[`${K}lookRealisticLabel`])}`);
  if (w.EN[`${K}lookGameLabel`] !== w.impl.LABELS.game) out.push(`the catalog calls the game look ${JSON.stringify(w.EN[`${K}lookGameLabel`])}`);
  for (const k of ['lookLabel', 'lookRealisticLabel', 'lookGameLabel', 'lookHelpSub']) {
    const en = w.EN[`${K}${k}`];
    const es = w.ES[`${K}${k}`];
    if (typeof en !== 'string' || !en.trim()) { out.push(`no English for ${k}`); continue; }
    if (typeof es !== 'string' || !es.trim()) out.push(`no Spanish for ${k}`);
    if (/[—–&]/.test(en) || (typeof es === 'string' && /[—–&]/.test(es))) out.push(`${k} has a dash or an "and" sign`);
    if (k.endsWith('Label') && en.split(' ').some((word) => /^[a-z]/.test(word))) out.push(`${k} ("${en}") is a label and is not in Title Case`);
    if (k.endsWith('Sub') && (/\.$/.test(en) || !/^[A-Z]/.test(en))) out.push(`${k} is a caption: capital first letter, no period`);
  }
  const hook = w.files['hooks/useLivingModelCopy.ts'] ?? '';
  if (!/lookRealisticLabel: t\('office\.livingModel\.replay\.lookRealisticLabel', 'Realistic'\)/.test(hook) || !/lookGameLabel: t\('office\.livingModel\.replay\.lookGameLabel', 'Game Style'\)/.test(hook)) out.push('the copy hook does not carry the two names');
  return out;
});

rule('A3', 'Game Style is the default, a palette with no look named is drawn as Game Style, and the two looks are built apart in every way that shows', (w) => {
  const out: string[] = [];
  if (w.impl.DEFAULT !== 'game') out.push(`the default is ${w.impl.DEFAULT}; it is Game Style`);
  for (const mode of MODES) {
    const base = BASE[mode];
    if (base.finish !== undefined) out.push(`${mode}: the theme's own palette carries a finish`);
    const pg = w.impl.lookPalette(base, 'game');
    const pr = w.impl.lookPalette(base, 'realistic');
    if (pg === base || pr === base) out.push(`${mode}: a look's palette is the theme's own object: the views would not make a new scene for it`);
    if (pg.finish?.look !== 'game' || pr.finish?.look !== 'realistic') { out.push(`${mode}: a look's palette does not say which look it is`); continue; }
    // No look named: Game Style.
    const bare = sceneAt(w, base, 'rough_in');
    const sb = bare.h.stats?.();
    if (!sb || sb.look !== 'game' || !sb.outlines || sb.camera !== 'level') out.push(`${mode}: a palette with no look named is drawn as ${JSON.stringify(sb)}`);
    bare.h.dispose();
    const g = sceneAt(w, pg, 'rough_in');
    const r = sceneAt(w, pr, 'rough_in');
    const sg = g.h.stats?.();
    const sr = r.h.stats?.();
    if (!sg || !sr) { out.push(`${mode}: a scene has no stats`); continue; }
    // Game Style: level camera, three steps, dark lines, chunky walls, no film, no grain, the floor is the stage.
    if (sg.look !== 'game' || sg.camera !== 'level' || sg.shading !== 'toon' || !sg.outlines || sg.film || sg.grains || sg.wallShade || sg.skyDome || !sg.shadows || !sg.groundPatch) out.push(`${mode}: Game Style's scene is ${JSON.stringify(sg)}`);
    if (g.log.perspective !== 0 || g.log.toneMapping !== 0 || g.log.surface !== 0 || g.log.domes !== 0 || g.log.toon === 0) out.push(`${mode}: Game Style made ${JSON.stringify(g.log)}`);
    // Realistic: a lens, rough and smooth, grains, corner shade, film, the sky's light, no dark lines.
    if (sr.look !== 'realistic' || sr.camera !== 'perspective' || sr.shading !== 'surface' || sr.outlines || !sr.film || !sr.grains || !sr.wallShade || !sr.skyDome || !sr.shadows || !sr.groundPatch) out.push(`${mode}: Realistic's scene is ${JSON.stringify(sr)}`);
    if (r.log.perspective !== 1 || !r.log.toneMapping || r.log.surface === 0 || r.log.toon !== 0 || r.log.domes !== 1) out.push(`${mode}: Realistic made ${JSON.stringify(r.log)}`);
    if (!(sg.wallT >= sr.wallT * 1.4)) out.push(`${mode}: Game Style's walls are ${sg.wallT} m thick and Realistic's ${sr.wallT} m: not chunky`);
    // Where the stage colour goes: all over the floor in Game Style, on a band in Realistic.
    const fg = g.h.floorHex('kitchen');
    const fr = r.h.floorHex('kitchen');
    if (!fg || colourGap(fg, base.stage.rough_in) > 10) out.push(`${mode}: a Game Style floor at Rough-In is ${fg}; the stage colour is ${base.stage.rough_in}`);
    if (!fr || colourGap(fr, pr.floorSub) > 1) out.push(`${mode}: a Realistic floor at Rough-In is ${fr}; its material is ${pr.floorSub}`);
    if (g.h.bandHex?.('kitchen') != null) out.push(`${mode}: Game Style draws a band round the floor`);
    if ((r.h.bandHex?.('kitchen') ?? '').toLowerCase() !== base.stage.rough_in.toLowerCase()) out.push(`${mode}: Realistic's band at Rough-In is ${r.h.bandHex?.('kitchen')}`);
    if (!(pg.floorTint >= 0.8) || !(pr.floorTint <= 0.15)) out.push(`${mode}: floor fill is ${pg.floorTint} in Game Style and ${pr.floorTint} in Realistic`);
    // Bold against quiet: Game Style's timber, batts, wire and glass are stronger colours than Realistic's.
    const chroma = (h: string): number => colourGap(h, `#${Array(3).fill(Math.round(lum(h) * 255).toString(16).padStart(2, '0')).join('')}`);
    const loud = (T: Record<string, string | number>): number => ['stud', 'insulation', 'wire', 'glass'].reduce((n, k) => n + chroma(String(T[k])), 0);
    if (!(loud(w.impl.GAME[mode]) > loud(w.impl.REALISTIC[mode]) * 1.25)) out.push(`${mode}: Game Style's colours (${loud(w.impl.GAME[mode]).toFixed(0)}) are no bolder than Realistic's (${loud(w.impl.REALISTIC[mode]).toFixed(0)})`);
    // The same model under both: the same rooms, and the same room under the middle of the picture.
    if (g.h.roomCount() !== r.h.roomCount() || g.h.roomCount() !== 7) out.push(`${mode}: ${g.h.roomCount()} rooms in Game Style and ${r.h.roomCount()} in Realistic`);
    if (!g.h.pick(550, 280) || g.h.pick(550, 280) !== r.h.pick(550, 280)) out.push(`${mode}: the room under the middle of the picture is ${g.h.pick(550, 280)} in Game Style and ${r.h.pick(550, 280)} in Realistic`);
    g.h.dispose();
    r.h.dispose();
  }
  const scene = code(w.files[SCENE] ?? '');
  for (const [line, what] of [
    ['new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 600)', 'the level camera'],
    ["const palette = given.finish ? given : lookPalette(given, 'game');", 'Game Style for a palette with no look named'],
    ["const lens = finish.camera === 'lens' ? new THREE.PerspectiveCamera(finish.fovDeg, 1, 0.5, 2000) : null;", 'the lens only where the look asks'],
    ['if (el && ramp) return new THREE.MeshToonMaterial({ color, gradientMap: ramp, ...extra });', 'the three steps of light'],
    ["inkRim: finish.ink && cost.outlines ? new THREE.MeshBasicMaterial({ color: finish.ink.color, side: THREE.BackSide }) : null,", 'the dark rim, drawn inside out'],
    ['const bandMat = finish.band ? new THREE.MeshBasicMaterial({ color: palette.vertexBase, toneMapped: false }) : null;', 'the band in the stage colour as written'],
    ['* finish.fit;', 'the home view'],
    ['* finish.sunLift,', 'the sun\'s height'],
  ] as const) if (!scene.includes(line)) out.push(`the scene builder no longer has ${what}`);
  return out;
});

rule('A4', 'the choice is kept under one key with a prefix the app owns, written in one file, and swept at a change of account', (w) => {
  const out: string[] = [];
  const key = w.impl.KEY;
  if (typeof key !== 'string' || !key) return ['there is no key'];
  if (!CURRENT_STORAGE_PREFIXES.some((p) => key.startsWith(p))) out.push(`"${key}" does not begin with one of ${CURRENT_STORAGE_PREFIXES.join(', ')}`);
  if (!APP_STORAGE_PREFIXES.some((p) => key.startsWith(p)) || !isAppStorageKey(key)) out.push(`"${key}" is not a key the app owns: the sweep would never see it`);
  if (DEVICE_SCOPED_KEYS.includes(key)) out.push(`"${key}" was added to the keys that outlive a change of account`);
  if (/::|\$\{/.test(key)) out.push('the key is per job or per person; a look is one choice for the device');
  const store = code(w.files[STORE] ?? '');
  if (!/AsyncStorage\.getItem\(MODEL_LOOK_STORAGE_KEY\)/.test(store) || !/AsyncStorage\.setItem\(MODEL_LOOK_STORAGE_KEY, look\)/.test(store)) out.push('the store does not read and write the one key');
  if (!/readModelLook\(await AsyncStorage\.getItem/.test(store)) out.push('what was stored is not read back through readModelLook');
  if (/AsyncStorage\.(clear|multiRemove|removeItem)\(/.test(store)) out.push('the look store removes keys');
  for (const [f, src] of Object.entries(w.files)) {
    if (f === LOOKS_FILE) continue;
    if (code(src).includes(`'${key}'`) || code(src).includes(`"${key}"`)) out.push(`${f} writes the key out by hand`);
    if (f !== STORE && /MODEL_LOOK_STORAGE_KEY/.test(code(src))) out.push(`${f} reaches for the key; only the store may`);
  }
  const screen = code(w.files[SCREEN] ?? '');
  if (!/useState<ModelLook>\(\(\) => rememberedModelLook\(\)\)/.test(screen) || !/void loadModelLook\(\)\.then\(\(l\) => \{ if \(alive\) setLook\(l\); \}\);/.test(screen)) out.push('the screen does not read the stored look when it opens');
  if (!/const onLook = useCallback\(\(l: ModelLook\) => \{ setLook\(l\); void saveModelLook\(l\); \}, \[\]\);/.test(screen)) out.push('the screen does not keep a new choice');
  return out;
});

// ── B. every element and every stage, in both looks ──────────────────────────

rule('B1', 'every element the view draws has a colour and a shading in both looks, on a light page and a dark one', (w) => {
  const out: string[] = [];
  // The list covers every material the palette holds, so a new one cannot be left without a colour in a look.
  const fromPalette = Object.entries(MATERIALS.light).filter(([k, v]) => typeof v === 'string' && !/^stage|^sky$|^sun$|^vertexBase$/.test(k)).map(([k]) => (/^pipe/.test(k) ? 'pipes' : k));
  for (const k of new Set(fromPalette)) if (!w.impl.ELEMENTS.includes(k)) out.push(`the palette's ${k} is not in the list of elements`);
  if (!w.impl.ELEMENTS.includes('ground')) out.push('the ground is not in the list of elements');
  for (const [name, T] of [['Realistic', w.impl.REALISTIC], ['Game Style', w.impl.GAME]] as const) {
    if (Object.keys(T.light).sort().join() !== Object.keys(T.dark).sort().join()) out.push(`the ${name} table does not hold the same things for a light page and a dark one`);
    for (const k of ['plinth', 'shell', 'wallOld', 'wallBoard', 'wallFinished', 'trim', 'floorOld', 'floorSub', 'floorFinished']) {
      const L = T.light[k];
      const D = T.dark[k];
      if (typeof L !== 'string' || typeof D !== 'string' || !HEX.test(L) || !HEX.test(D)) { out.push(`the ${name} table has no ${k}`); continue; }
      if (lum(D) >= lum(L) - 0.08) out.push(`${name} ${k} is not darker on a dark page (${D}) than on a light one (${L})`);
    }
  }
  for (const look of w.impl.MODEL_LOOKS as readonly ModelLook[]) for (const mode of MODES) for (const el of w.impl.ELEMENTS) {
    let a: ReturnType<typeof elementAppearance>;
    try { a = w.impl.elementAppearance(look, el as (typeof LOOK_ELEMENTS)[number], mode, BASE[mode].ground); } catch (e) { out.push(`${look} ${mode} ${el}: threw ${String(e)}`); continue; }
    const where = `${look} ${mode} ${el}`;
    if (!a || !Array.isArray(a.colours) || a.colours.length !== (el === 'pipes' ? 3 : 1)) { out.push(`${where}: has ${a?.colours?.length ?? 0} colours`); continue; }
    for (const c of a.colours) if (!HEX.test(c)) out.push(`${where}: "${c}" is not a colour`);
    if (!(a.opacity > 0 && a.opacity <= 1)) out.push(`${where}: opacity ${a.opacity}`);
    if ((el === 'glass') !== (a.opacity < 1)) out.push(`${where}: ${el === 'glass' ? 'the glass is solid' : 'is see-through'}`);
    if (look === 'game') {
      if (a.shading !== 'toon' || a.roughness !== null || a.metalness !== null) out.push(`${where}: Game Style on the web is shaded ${a.shading}, roughness ${a.roughness}`);
    } else if (el === 'ground') {
      if (a.roughness !== null) out.push(`${where}: the ground is the page; it has no surface of its own`);
    } else {
      if (a.shading !== 'surface') out.push(`${where}: no surface on the web`);
      if (!(typeof a.roughness === 'number' && a.roughness >= 0 && a.roughness <= 1) || !(typeof a.metalness === 'number' && a.metalness >= 0 && a.metalness <= 1)) out.push(`${where}: roughness ${a.roughness}, metalness ${a.metalness}`);
    }
    if (el === 'ground' && a.colours[0] !== BASE[mode].ground) out.push(`${where}: the ground is not the page's colour`);
    // On a phone at Standard both looks are flat.
    const phone = w.impl.elementAppearance(look, el as (typeof LOOK_ELEMENTS)[number], mode, BASE[mode].ground, w.impl.lookCost(look, 'phone', 'standard'));
    if (phone.shading !== 'flat' || phone.roughness !== null) out.push(`${where}: on a phone at Standard it is shaded ${phone.shading}`);
  }
  // The palette the scene is handed carries every one of them, in both looks, and keeps the theme's own colours.
  for (const mode of MODES) for (const look of w.impl.MODEL_LOOKS as readonly ModelLook[]) {
    const p = w.impl.lookPalette(BASE[mode], look) as unknown as Record<string, unknown>;
    const T = look === 'realistic' ? w.impl.REALISTIC[mode] : w.impl.GAME[mode];
    for (const k of Object.keys(MATERIALS.light)) {
      if (/^stage/.test(k)) continue;
      if (p[k] === undefined || p[k] === null) out.push(`${mode}: ${look}'s palette has no ${k}`);
      else if (typeof T[k] === 'string' && p[k] !== T[k]) out.push(`${mode}: ${look}'s palette draws ${k} in ${String(p[k])}; its table says ${String(T[k])}`);
    }
    if (p.ground !== BASE[mode].ground || p.accent !== BASE[mode].accent || p.done !== BASE[mode].done || p.ink !== BASE[mode].ink) out.push(`${mode}: ${look} does not keep the theme's own ground, ink, accent and Done colour`);
  }
  return out;
});

rule('B2', 'every stage shows on a room in both looks: the same stage colours, the floor filled in Game Style, and in Realistic a band while the floor keeps its material', (w) => {
  const out: string[] = [];
  const all = Object.keys(BASE.light.stage).sort();
  if ([...w.impl.STAGES].sort().join() !== all.join()) out.push(`the list of stages (${w.impl.STAGES.join(', ')}) is not the palette's (${all.join(', ')})`);
  for (const mode of MODES) {
    const base = BASE[mode];
    for (const look of w.impl.MODEL_LOOKS as readonly ModelLook[]) {
      const palette = w.impl.lookPalette(base, look);
      for (const s of all as RoomStage[]) if (palette.stage[s] !== base.stage[s]) out.push(`${mode}: ${s} is ${palette.stage[s]} in ${look} and ${base.stage[s]} on the labels: one stage, two colours`);
      const plain = sceneAt(w, palette, 'not_started');
      const plainFloor = plain.h.floorHex('kitchen');
      plain.h.dispose();
      if (!plainFloor) { out.push(`${mode} ${look}: no floor`); continue; }
      for (const s of all as RoomStage[]) {
        const where = `${mode} ${look} ${s}`;
        const a = w.impl.stageAppearance(look, s, palette);
        if (!a || !HEX.test(a.colour) || a.colour !== palette.stage[s]) { out.push(`${where}: no colour, or not the palette's`); continue; }
        if (!(a.floorTint >= 0 && a.floorTint <= 1)) out.push(`${where}: floor tint ${a.floorTint}`);
        const marked = !PLAIN_FLOOR_STAGES.includes(s);
        if (!marked && (a.floorTint !== 0 || a.band)) out.push(`${where}: a room with nothing to show is marked`);
        if (marked && a.band !== (look === 'realistic')) out.push(`${where}: band ${a.band}`);
        if (marked && look === 'game' && !(a.floorTint >= 0.8)) out.push(`${where}: the floor is not filled with the stage colour (${a.floorTint})`);
        if (marked && look === 'realistic' && !(a.floorTint <= 0.15)) out.push(`${where}: the floor is tinted ${a.floorTint}: it would not keep its material`);
        if (marked && Math.abs(a.floorTint - palette.floorTint) > 1e-9) out.push(`${where}: the table says ${a.floorTint} and the palette the scene is handed says ${palette.floorTint}`);
        // The scene itself.
        const { h } = sceneAt(w, palette, s);
        const floor = h.floorHex('kitchen');
        const band = h.bandHex?.('kitchen') ?? null;
        h.dispose();
        if (!floor) { out.push(`${where}: no floor in the scene`); continue; }
        if (look === 'realistic') {
          if (marked && (band ?? '').toLowerCase() !== palette.stage[s].toLowerCase()) out.push(`${where}: the band is ${band}; the stage colour is ${palette.stage[s]}`);
          if (!marked && band !== null) out.push(`${where}: a band is drawn (${band})`);
          // The floor is one of the look's own three floor materials, or between them: never pulled toward the stage colour.
          const mats = [palette.floorOld, palette.floorSub, palette.floorFinished];
          if (marked && Math.min(...mats.map((m) => colourGap(floor, m))) > 1) out.push(`${where}: the floor is ${floor}, which is none of its materials (${mats.join(', ')})`);
        } else {
          if (band !== null) out.push(`${where}: Game Style draws a band`);
          if (marked && colourGap(floor, palette.stage[s]) > 10) out.push(`${where}: the floor is ${floor}; the stage colour is ${palette.stage[s]}`);
        }
        if (!marked && floor !== plainFloor) out.push(`${where}: the floor is ${floor}; a plain floor is ${plainFloor}`);
      }
    }
  }
  return out;
});

rule('B3', 'the stage reads in Realistic: every band stands well clear of each of the three floors it can lie on and of every other stage, on a light page and a dark one, and no light changes it', (w) => {
  const out: string[] = [];
  if (!(w.impl.GAPS.floor >= 25) || !(w.impl.GAPS.stages >= 18)) out.push(`the gaps asked for are ${JSON.stringify(w.impl.GAPS)}: too small to be told at a glance`);
  for (const mode of MODES) {
    const p = w.impl.lookPalette(BASE[mode], 'realistic');
    const marked = (w.impl.STAGES as RoomStage[]).filter((s) => !PLAIN_FLOOR_STAGES.includes(s));
    for (const s of marked) {
      for (const f of ['floorOld', 'floorSub', 'floorFinished'] as const) {
        const gap = colourGap(p.stage[s], p[f]);
        if (!(gap >= w.impl.GAPS.floor)) out.push(`${mode}: the ${s} band (${p.stage[s]}) is ${gap.toFixed(0)} from the ${f} floor (${p[f]}); want ${w.impl.GAPS.floor}`);
      }
      for (const t of marked) {
        if (t <= s) continue;
        const gap = colourGap(p.stage[s], p.stage[t]);
        if (!(gap >= w.impl.GAPS.stages)) out.push(`${mode}: ${s} (${p.stage[s]}) and ${t} (${p.stage[t]}) are ${gap.toFixed(0)} apart; want ${w.impl.GAPS.stages}`);
      }
    }
    // The band is wide enough to see and is drawn with no light on it.
    if (!p.finish?.band || !(p.finish.band.widthM >= 0.12)) out.push(`${mode}: the band is ${p.finish?.band?.widthM} m wide`);
    const r = sceneAt(w, p, 'framing');
    const lit = r.log.basic;
    r.h.dispose();
    // One unlit material per room for the band, with the dome's paint, the corner shade and the ground patch.
    if (lit < 7) out.push(`${mode}: only ${lit} unlit materials were made for seven rooms: the bands are lit, so a shadow would change their colour`);
  }
  return out;
});

rule('B4', 'both looks are built from the same pure shapes: lids on the walls, frames only where the model has a window, a dark rim that wraps each wall, shade at the foot of each wall, and fat studs that stay inside the wall', (w) => {
  const out: string[] = [];
  const rooms = sevenRoomJob().rooms;
  for (const look of ['realistic', 'game'] as const) {
    const build = w.impl.BUILD[look];
    for (const room of rooms) {
      const geo = w.impl.buildRoomGeometry(room, { cutHeightM: 1.25, ...build, lidInsetM: look === 'game' ? 0.035 : 0 });
      const walls = worldWalls(room);
      const windows = walls.reduce((n, wl) => n + wl.openings.filter((o) => o.kind === 'window' && o.y0 < 1.25).length, 0);
      const where = `${look} ${room.id}`;
      if (geo.cap.boxes === 0) out.push(`${where}: no lid on its walls`);
      if ((geo.lid.boxes > 0) !== (look === 'game')) out.push(`${where}: ${geo.lid.boxes} pale lids`);
      // A frame is three or four pieces. None is drawn where the model has no window.
      if (windows === 0 ? geo.frames.boxes !== 0 : geo.frames.boxes < windows * 3 || geo.frames.boxes > windows * 4) out.push(`${where}: ${windows} windows in the model and ${geo.frames.boxes} frame pieces`);
      if (geo.glass.boxes !== windows) out.push(`${where}: ${windows} windows in the model and ${geo.glass.boxes} panes of glass`);
      // Every stud stays inside the room's own outline.
      const b = roomBounds(room);
      if (b) for (let i = 0; i < geo.studs.p.length; i += 3) {
        const x = geo.studs.p[i]; const z = geo.studs.p[i + 2];
        if (x < b.minX - 1e-6 || x > b.maxX + 1e-6 || z < b.minY - 1e-6 || z > b.maxY + 1e-6) { out.push(`${where}: a stud pokes out of the room at ${x.toFixed(3)}, ${z.toFixed(3)}`); break; }
      }
    }
  }
  // Realistic's measures are the ones the shapes have always had: the same boxes as with no measure given.
  const k = rooms[1];
  const plain = w.impl.buildRoomGeometry(k, { cutHeightM: 1.25 });
  const real = w.impl.buildRoomGeometry(k, { cutHeightM: 1.25, ...w.impl.BUILD.realistic });
  if (plain.studs.boxes !== real.studs.boxes || plain.skin.boxes !== real.skin.boxes || plain.insulation.boxes !== real.insulation.boxes) out.push('Realistic\'s wall measures are not the plain ones');
  const fat = w.impl.buildRoomGeometry(k, { cutHeightM: 1.25, ...w.impl.BUILD.game });
  if (!(fat.studs.boxes < plain.studs.boxes)) out.push(`Game Style draws ${fat.studs.boxes} studs and Realistic ${plain.studs.boxes}: they are no fewer and fatter`);
  if (!(w.impl.BUILD.game.wallT >= w.impl.BUILD.realistic.wallT * 1.4) || !(w.impl.BUILD.game.studHalf >= w.impl.BUILD.realistic.studHalf * 1.5)) out.push('Game Style\'s walls and studs are not chunkier than Realistic\'s');
  // The dark rim: one box per solid stretch, larger than the wall on every side but the bottom; none for no width.
  const ink = w.impl.buildRoomInk(k, 0.035, { cutHeightM: 1.25, ...w.impl.BUILD.game });
  if (ink.boxes === 0) out.push('the dark rim has no shapes');
  if (w.impl.buildRoomInk(k, 0, { cutHeightM: 1.25 }).boxes !== 0 || w.impl.buildRoomInk(k, Number.NaN, { cutHeightM: 1.25 }).boxes !== 0) out.push('a rim of no width has shapes');
  const top = (buf: { p: number[] }): number => { let m = -Infinity; for (let i = 1; i < buf.p.length; i += 3) m = Math.max(m, buf.p[i]); return m; };
  const low = (buf: { p: number[] }): number => { let m = Infinity; for (let i = 1; i < buf.p.length; i += 3) m = Math.min(m, buf.p[i]); return m; };
  const withLid = w.impl.buildRoomGeometry(k, { cutHeightM: 1.25, ...w.impl.BUILD.game, lidInsetM: 0.035 });
  if (!(top(ink) > top(withLid.lid)) || low(ink) < -1e-9) out.push(`the dark rim tops out at ${top(ink).toFixed(3)} and the lid at ${top(withLid.lid).toFixed(3)}: it does not wrap the wall, or it goes under the floor`);
  const kb = roomBounds(k);
  if (kb) { let past = false; for (let i = 0; i < ink.p.length; i += 3) if (ink.p[i] < kb.minX - 1e-6 || ink.p[i] > kb.maxX + 1e-6) past = true; if (!past) out.push('the dark rim never reaches past the wall: no line would show'); }
  // The shade at the foot of the walls: flat strips, v from 0 at the wall to 1, none across a door.
  const shade = w.impl.buildWallShade(k, 0.7);
  if (shade.p.length === 0 || shade.p.length / 3 !== shade.uv.length / 2 || shade.p.length % 18 !== 0) out.push('the corner shade is not whole strips');
  if (shade.uv.some((v, i) => i % 2 === 1 && v !== 0 && v !== 1) || !shade.uv.some((v, i) => i % 2 === 1 && v === 1)) out.push('the corner shade does not fade from the wall to its open edge');
  if (shade.n.some((v, i) => i % 3 === 1 && v !== 1)) out.push('a strip of corner shade does not lie flat');
  if (w.impl.buildWallShade(k, 0).p.length !== 0) out.push('shade of no width has shapes');
  const doors = worldWalls(k).reduce((n, wl) => n + wl.openings.filter((o) => o.y0 <= 0).length, 0);
  const wallsWithShade = worldWalls(k).filter((wl) => wl.lengthM > 0.3).length;
  if (doors > 0 && shade.p.length / 18 !== wallsWithShade + doors) out.push(`the kitchen has ${doors} doors and ${wallsWithShade} walls, and ${shade.p.length / 18} strips of shade: a door is shaded across, or a wall is not shaded`);
  // A picture laid by the metre: a floor takes its place from the plan, a wall from the way along it and the height.
  const uv = w.impl.planarUV([1, 0, 2, 3, 0, 4, 5, 7, 6, 8, 9, 6], [0, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0], 1);
  if (uv.join() !== '1,2,3,4,5,7,6,9') out.push(`a picture is laid at ${uv.join()}`);
  if (w.impl.planarUV([2, 0, 4], [0, 1, 0], 0.5).join() !== '1,2') out.push('a picture is not laid by the metre');
  // The band of stage colour sits inside the look's own wall.
  const band = w.impl.buildFloorBand(k, 0.16, w.impl.BUILD.game.wallT);
  if (band.boxes !== worldWalls(k).length) out.push('the band is not one piece per wall');
  return out;
});

rule('B5', 'the grains are made from arithmetic: the same bytes every time, grey, opaque, near white, each kind its own, and the module is pure', (w) => {
  const out: string[] = [];
  if (LOOK_TEXTURES.length !== 4 || LOOK_TEXTURE_SIZE !== 256) out.push(`there are ${LOOK_TEXTURES.length} grains of ${LOOK_TEXTURE_SIZE} px; the cost table counts four of 256`);
  const sums: number[] = [];
  for (const kind of LOOK_TEXTURES) {
    const a = w.impl.lookTexturePixels(kind, 64);
    const b = w.impl.lookTexturePixels(kind, 64);
    if (a.length !== 64 * 64 * 4) { out.push(`${kind}: ${a.length} bytes`); continue; }
    let same = true; let grey = true; let solid = true; let sum = 0; let min = 255;
    for (let i = 0; i < a.length; i += 4) {
      if (a[i] !== b[i]) same = false;
      if (a[i] !== a[i + 1] || a[i] !== a[i + 2]) grey = false;
      if (a[i + 3] !== 255) solid = false;
      sum += a[i]; min = Math.min(min, a[i]);
    }
    const mean = sum / (a.length / 4) / 255;
    if (!same) out.push(`${kind}: two runs made two pictures`);
    if (!grey) out.push(`${kind}: carries a colour of its own; the colour tables are the one place a colour is written`);
    if (!solid) out.push(`${kind}: is see-through`);
    if (!(mean >= 0.8 && mean <= 1) || min < 110) out.push(`${kind}: mean ${mean.toFixed(2)}, darkest ${min}: it would pull the material off its colour`);
    sums.push(sum);
  }
  if (new Set(sums).size !== LOOK_TEXTURES.length) out.push('two grains are the same picture');
  const ramp = w.impl.toonRampPixels([0.5, 0.5, 0.8, 1]);
  if (ramp.length !== 16 || ramp[0] !== 128 || ramp[8] !== 204 || ramp[12] !== 255 || ramp[3] !== 255) out.push(`the steps of light are ${Array.from(ramp).join()}`);
  const fade = w.impl.fadePixels(16);
  let falls = fade.length === 64 && fade[3] === 255 && fade[63] === 0;
  for (let i = 7; i < fade.length; i += 4) if (fade[i] > fade[i - 4]) falls = false;
  if (!falls) out.push('the corner shade does not fade from full to nothing');
  const src = code(w.files[TEXTURES_FILE] ?? '');
  if (!src) return [...out, 'utils/livingModel/lookTextures.ts is missing'];
  if (/\bimport\b|\brequire\s*\(/.test(src)) out.push('lookTextures.ts imports something');
  if (/Math\.random|Date\.now|new Date|document\.|window\.|createElement|canvas\b/i.test(src)) out.push('lookTextures.ts reaches for chance, the clock or the page');
  if (/#[0-9a-fA-F]{6}\b/.test(src)) out.push('lookTextures.ts writes a colour');
  return out;
});

// ── C. cost ──────────────────────────────────────────────────────────────────

const TIER_ARGS: Record<LookTier, readonly ['web' | 'phone', 'standard' | 'high']> = { web: ['web', 'standard'], phoneStandard: ['phone', 'standard'], phoneHigh: ['phone', 'high'] };
const WANT_COSTS: Record<ModelLook, Record<LookTier, LookCost>> = {
  game: {
    web: { shading: 'toon', shadows: true, skyDome: false, groundPatch: true, textures: false, outlines: true, wallShade: false },
    phoneStandard: { shading: 'flat', shadows: true, skyDome: false, groundPatch: true, textures: false, outlines: true, wallShade: false },
    phoneHigh: { shading: 'toon', shadows: true, skyDome: false, groundPatch: true, textures: false, outlines: true, wallShade: false },
  },
  realistic: {
    web: { shading: 'surface', shadows: true, skyDome: true, groundPatch: true, textures: true, outlines: false, wallShade: true },
    phoneStandard: { shading: 'flat', shadows: true, skyDome: false, groundPatch: true, textures: false, outlines: false, wallShade: true },
    phoneHigh: { shading: 'surface', shadows: true, skyDome: false, groundPatch: true, textures: true, outlines: false, wallShade: true },
  },
};
/** The row of the table at the top of looks.ts for one look on one tier. */
const HEADER_ROW: Record<ModelLook, Record<LookTier, RegExp>> = {
  game: { web: /^\/\/\s+Game Style\s+web\s+(.*)$/m, phoneStandard: /^\/\/\s+Game Style\s+phone Std\s+(.*)$/m, phoneHigh: /^\/\/\s+Game Style\s+phone High\s+(.*)$/m },
  realistic: { web: /^\/\/\s+Realistic\s+web\s+(.*)$/m, phoneStandard: /^\/\/\s+Realistic\s+phone Std\s+(.*)$/m, phoneHigh: /^\/\/\s+Realistic\s+phone High\s+(.*)$/m },
};
const SHADING_WORD = { flat: 'flat', toon: '3 steps', surface: 'rough' } as const;

rule('C1', 'a look spends only what its device may: the cost table tier by tier, a phone at Standard is flat in both looks and inside its budget, no phone makes the sky dome, the figures written in looks.ts are the measured ones, and a scene thrown away lets go of all it made', (w) => {
  const out: string[] = [];
  const C = w.impl.lookCost;
  const same = (a: object, b: object): boolean => JSON.stringify(a) === JSON.stringify(b);
  const header = w.files[LOOKS_FILE] ?? '';
  for (const look of ['game', 'realistic'] as const) for (const tier of LOOK_TIERS) {
    const [device, q] = TIER_ARGS[tier];
    const where = `${look} on ${tier}`;
    const cost = C(look, device, q);
    if (!same(cost, WANT_COSTS[look][tier])) out.push(`${where} costs ${JSON.stringify(cost)}`);
    if (!same(w.impl.COSTS[look]?.[tier] ?? {}, WANT_COSTS[look][tier])) out.push(`${where}: the cost table says ${JSON.stringify(w.impl.COSTS[look]?.[tier])}`);
    if (lookTier(device, q) !== tier) out.push(`${device} at ${q} is taken as ${lookTier(device, q)}`);
    if (tier !== 'web' && cost.skyDome) out.push(`${where} makes the sky dome`);
    if (tier === 'phoneStandard' && cost.shading !== 'flat') out.push(`${where} is shaded ${cost.shading}: a phone at Standard keeps the flat shading`);
    if (tier === 'phoneStandard' && cost.textures) out.push(`${where} is given the grains`);
    // The scene does what the cost says, and no more.
    const r = sceneAt(w, w.impl.lookPalette(BASE.light, look, cost), 'framing');
    const st = r.h.stats?.();
    if (!st) { out.push(`${where}: no stats`); r.h.dispose(); continue; }
    if (st.shading !== cost.shading || st.skyDome !== cost.skyDome || st.groundPatch !== cost.groundPatch || st.outlines !== cost.outlines || st.wallShade !== cost.wallShade || st.grains !== cost.textures || st.shadows !== cost.shadows) out.push(`${where}: the scene is ${JSON.stringify(st)}`);
    if ((r.log.surface > 0) !== (cost.shading === 'surface')) out.push(`${where}: ${r.log.surface} rough-and-smooth materials`);
    if ((r.log.toon > 0) !== (cost.shading === 'toon')) out.push(`${where}: ${r.log.toon} three-step materials`);
    if (r.log.domes !== (cost.skyDome ? 1 : 0)) out.push(`${where}: ${r.log.domes} sky domes`);
    const pictures = (cost.groundPatch ? 1 : 0) + (cost.shading === 'toon' ? 1 : 0) + (cost.wallShade ? 1 : 0) + (cost.textures ? 4 : 0);
    if (r.log.textures !== pictures || st.textures !== pictures) out.push(`${where}: ${r.log.textures} pictures were made and ${st.textures} are held; its cost comes to ${pictures}`);
    if (r.log.shadowsOn !== cost.shadows || r.log.castShadow !== cost.shadows) out.push(`${where}: shadows ${r.log.shadowsOn}, sun ${r.log.castShadow}`);
    if (tier !== 'web' && (st.drawables > w.impl.BUDGET.drawables || st.triangles > w.impl.BUDGET.triangles)) out.push(`${where}: ${st.drawables} shapes and ${st.triangles} triangles; a phone's budget is ${w.impl.BUDGET.drawables} and ${w.impl.BUDGET.triangles}`);
    // The figures written at the top of looks.ts are these.
    const row = HEADER_ROW[look][tier].exec(header)?.[1] ?? '';
    const cells = row.trim().split(/\s{2,}/);
    if (cells[0] !== SHADING_WORD[cost.shading] || cells[1] !== String(st.drawables) || cells[2] !== st.triangles.toLocaleString('en-US') || cells[3] !== String(pictures) || (cells[5] === 'yes') !== cost.skyDome) out.push(`${where}: looks.ts says "${row.trim()}"; measured ${SHADING_WORD[cost.shading]}, ${st.drawables} shapes, ${st.triangles.toLocaleString('en-US')} triangles, ${pictures} pictures, sky dome ${cost.skyDome ? 'yes' : 'no'}`);
    // Leaving: everything the look made is let go.
    const made = r.log.flat + r.log.surface + r.log.toon + r.log.basic + r.log.shadowOnly;
    r.h.dispose();
    const after = r.h.stats?.();
    if (r.log.disposedMaterials !== made) out.push(`${where}: made ${made} materials and let go of ${r.log.disposedMaterials}`);
    if (r.log.disposedTextures !== r.log.textures) out.push(`${where}: made ${r.log.textures} pictures and let go of ${r.log.disposedTextures}`);
    if (r.log.disposedDomes !== r.log.domes) out.push(`${where}: made ${r.log.domes} sky domes and let go of ${r.log.disposedDomes}`);
    if (!after || after.textures !== 0 || after.ownedMaterials !== 0 || after.skyDome || after.drawables !== 0 || r.h.roomCount() !== 0) out.push(`${where}: thrown away, it still holds ${JSON.stringify(after)}`);
  }
  if (!same(C('realistic', 'phone'), C('realistic', 'phone', 'standard')) || !same(C('game', 'phone'), C('game', 'phone', 'standard'))) out.push('a phone whose quality is not said is not taken as Standard');
  if (!(w.impl.BUDGET.drawables <= 100 && w.impl.BUDGET.triangles <= 20000)) out.push(`the phone's budget was raised to ${JSON.stringify(w.impl.BUDGET)}`);
  // With nothing afforded, nothing extra is made.
  for (const look of ['game', 'realistic'] as const) {
    const bare = sceneAt(w, w.impl.lookPalette(BASE.light, look, { shading: 'flat', shadows: false, skyDome: false, groundPatch: false, textures: false, outlines: false, wallShade: false }), 'framing');
    if (bare.log.textures !== 0 || bare.log.shadowsOn !== false || bare.log.castShadow !== false || bare.log.toon !== 0 || bare.log.surface !== 0 || bare.log.domes !== 0) out.push(`${look}: with nothing afforded the scene still made ${JSON.stringify(bare.log)}`);
    bare.h.dispose();
  }
  // A new look is a new scene: the views key the scene on the palette, and the palette changes with the look.
  const shared = code(w.files[SHARED] ?? '');
  if (!/return useMemo\(\(\) => lookPalette\(base, look, lookCost\(look, device, quality\)\), \[base, look, device, quality\]\);/.test(shared)) out.push('the palette the views draw with does not change with the look, the device and the quality');
  const web3d = code(w.files[WEB] ?? '');
  if (!/const palette = useLookPalette\(look, 'web'\);/.test(web3d) || !/\}, \[palette, reloads, loadLibrary\]\);/.test(web3d)) out.push('the web view does not make a new scene for a new look');
  const phone = code(w.files[PHONE] ?? '');
  if (!/const palette = useLookPalette\(look, 'phone', quality\);/.test(phone) || !/paletteKey\.current\.palette !== palette/.test(phone)) out.push('the phone does not make a new drawing surface for a new look');
  const view = code(w.files[PHONE_VIEW] ?? '');
  if (!/const palette = useLookPalette\(look, 'phone', quality\);/.test(view)) out.push('the phone\'s 3D view does not draw the look at the cost its quality allows');
  if (!/shadowMapSize: settings\.shadowMapSize/.test(view)) out.push('the phone\'s shadow map no longer comes from PHONE_3D_QUALITY');
  const screen = code(w.files[SCREEN] ?? '');
  if (!screen.includes('<JobReplay3D model={model}') || !screen.includes(' quality={quality} look={look} weekLine={weekLine}')) out.push('the screen does not hand the look to the 3D view');
  return out;
});

// ── D. the gate and the words ────────────────────────────────────────────────

rule('D1', 'LIVING_MODEL_ENABLED is still false, is read in one file, and the looks do not open the feature to anyone', (w) => {
  const out: string[] = [];
  const flags = w.files[FLAGS] ?? '';
  if (!/^export const LIVING_MODEL_ENABLED = false;$/m.test(flags)) out.push('LIVING_MODEL_ENABLED is not false');
  const readers = Object.keys(w.files).filter((f) => f !== FLAGS && /\bLIVING_MODEL_ENABLED\b/.test(code(w.files[f])));
  if (readers.join() !== 'utils/livingModel/allowed.ts') out.push(`the flag is read by ${readers.join(', ') || 'nobody'}; want only utils/livingModel/allowed.ts`);
  if (livingModelAllowedWith(false, null) || livingModelAllowedWith(false, 'someone@example.com')) out.push('with the flag off, someone who is not the owner is let in');
  for (const f of [LOOKS_FILE, STORE]) if (/featureFlags|isOwner|OWNER_EMAILS|allowed/.test(code(w.files[f] ?? ''))) out.push(`${f} reaches for the gate`);
  return out;
});

rule('D2', 'the looks module is pure, nothing new loads the 3D library, and no animation library came in', (w) => {
  const out: string[] = [];
  const looks = code(w.files[LOOKS_FILE] ?? '');
  if (!looks) return ['utils/livingModel/looks.ts is missing'];
  const froms = Array.from(looks.matchAll(/from ['"]([^'"]+)['"]/g)).map((m) => m[1]);
  for (const f of froms) if (!/^\.\/(palette|phoneViewCore|stageCore)$/.test(f)) out.push(`looks.ts imports ${f}`);
  if (/\bimport\s*\(|\brequire\s*\(/.test(looks)) out.push('looks.ts loads something at run time');
  const store = code(w.files[STORE] ?? '');
  if (/['"]three['"]|['"]expo-gl['"]|['"]react['"]|['"]react-native['"]/.test(store)) out.push('the look store reaches past storage');
  for (const f of [LOOKS_FILE, STORE, SHARED, SCREEN, PHONE, PHONE_VIEW]) {
    const src = code(w.files[f] ?? '');
    if (/from ['"]three['"]|import\s*\(\s*['"]three['"]\s*\)/.test(src)) out.push(`${f} loads the 3D library`);
  }
  for (const f of [LOOKS_FILE, STORE, SCENE, SHARED, SCREEN, WEB, PHONE, PHONE_VIEW]) {
    const src = w.files[f] ?? '';
    const m = /['"](react-native-reanimated|moti|lottie[\w-]*|gsap|framer-motion)['"]/.exec(src);
    if (m) out.push(`${f} uses ${m[0]}`);
  }
  // Nothing in the scene builder, or in what a look is made of, moves by itself: no clock, no frame loop, no timer, no tween.
  for (const f of [SCENE, LOOKS_FILE, TEXTURES_FILE, 'utils/livingModel/sceneCore.ts']) {
    const m = /Animated\.(timing|spring|loop|decay)\(|requestAnimationFrame|setInterval\(|setTimeout\(|performance\.now|Date\.now|new THREE\.Clock|AnimationMixer/.exec(code(w.files[f] ?? ''));
    if (m) out.push(`${f} moves on its own: ${m[0]}`);
  }
  for (const dep of Object.keys(w.pkg.dependencies)) if (/^(three-|@react-three|postprocessing|troika|drei)/.test(dep)) out.push(`a new 3D dependency: ${dep}`);
  if (!/^\d+\.\d+\.\d+$/.test(w.pkg.dependencies.three ?? '')) out.push('three is not pinned to one version');
  // No picture is fetched: the scene's only textures are made from numbers.
  const scene = code(w.files[SCENE] ?? '');
  if (/TextureLoader|ImageLoader|CubeTextureLoader|\.load\(|https?:\/\//.test(scene)) out.push('the scene builder loads a picture');
  return out;
});

rule('D3', 'neither look\'s words say how right the model is', (w) => {
  const out: string[] = [];
  const EN_BAD = /\b(exact|exactly|accurate|accuracy|precise|precision|to scale|true to life|true-to-life|photoreal\w*|as-built|real-time|live|verified|digital twin|BIM|actual)\b/i;
  const ES_BAD = /\b(exact[oa]s?|precis[oa]s?|precisión|a escala|fiel(es)?|verificad[oa]s?|tiempo real|en vivo|gemelo digital|BIM)\b/i;
  for (const k of ['lookLabel', 'lookRealisticLabel', 'lookGameLabel', 'lookHelpSub']) {
    const en = String(w.EN[`${K}${k}`] ?? '');
    const es = String(w.ES[`${K}${k}`] ?? '');
    const a = EN_BAD.exec(en);
    if (a) out.push(`${k} says "${a[0]}"`);
    const b = ES_BAD.exec(es);
    if (b) out.push(`${k} says "${b[0]}" in Spanish`);
  }
  for (const l of Object.values(w.impl.LABELS)) { const a = EN_BAD.exec(l); if (a) out.push(`a look is named with "${a[0]}"`); }
  const help = String(w.EN[`${K}lookHelpSub`] ?? '');
  if (!/schematic/i.test(help)) out.push('the line under the switch does not say both looks are the same schematic');
  // The two lines every view carries stay under the 3D view in both looks.
  const screen = code(w.files[SCREEN] ?? '');
  if (!/<HonestyLines ghost=\{past\} testID=\{threeD \? 'lm-honesty-3d' : 'lm-honesty-flat'\} \/>/.test(screen)) out.push('the two plain lines are no longer under the replay');
  if (!/\{threeD \? \(\s*<View style=\{styles\.stack\} testID="lm-look">/.test(screen)) out.push('the switch is not drawn with the 3D view (and only with it)');
  return out;
});

// ── planted mutations ────────────────────────────────────────────────────────

interface Mutation { rule: string; name: string; plant: (w: World) => World }
const swapCount = { n: 0 };
const edit = (file: string, from: string, to: string) => (w: World): World => {
  const src = w.files[file];
  if (src === undefined || !src.includes(from)) throw new Error(`cannot plant: "${from.slice(0, 60)}" is not in ${file}`);
  return { ...w, files: { ...w.files, [file]: src.replace(from, to) } };
};
const swap = (over: Partial<Impl>) => (w: World): World => ({ ...w, impl: { ...w.impl, ...over } });
const en = (key: string, value: unknown) => (w: World): World => ({ ...w, EN: { ...w.EN, [`${K}${key}`]: value } });
const es = (key: string, value: unknown) => (w: World): World => ({ ...w, ES: { ...w.ES, [`${K}${key}`]: value } });
const pkgEdit = (fn: (p: World['pkg']) => World['pkg']) => (w: World): World => ({ ...w, pkg: fn(JSON.parse(JSON.stringify(w.pkg))) });
/** The scene builder with one line of its source changed cannot be run from a string, so scene mutations hand it a changed palette or wrap its handle. */
const wrapScene = (fn: (h: JobSceneHandle, palette: LivingModelPalette) => JobSceneHandle) => swap({ createJobScene: ((T: typeof import('three'), c: HTMLCanvasElement, p: LivingModelPalette, o?: object) => fn(createJobScene(T, c, p, o), p)) as typeof createJobScene });

const MUTATIONS: Mutation[] = [
  { rule: 'A1', name: 'a third look', plant: swap({ MODEL_LOOKS: ['realistic', 'game', 'blueprint'] }) },
  { rule: 'A1', name: 'one look only', plant: swap({ MODEL_LOOKS: ['game'] }) },
  { rule: 'A1', name: 'the looks the other way round', plant: swap({ MODEL_LOOKS: ['game', 'realistic'] }) },
  { rule: 'A1', name: 'anything stored is taken as a look', plant: swap({ isModelLook: ((v: unknown) => typeof v === 'string') as typeof isModelLook }) },
  { rule: 'A1', name: 'a stored look is ignored', plant: swap({ readModelLook: () => 'game' }) },
  { rule: 'A1', name: 'the switch lists its own looks', plant: edit(SCREEN, 'options={MODEL_LOOKS.map((l) => ({ value: l, label: l === \'realistic\' ? copy.lookRealisticLabel : copy.lookGameLabel }))}', 'options={[{ value: \'game\' as ModelLook, label: copy.lookGameLabel }]}') },
  { rule: 'A2', name: 'the game look renamed', plant: swap({ LABELS: { realistic: 'Realistic', game: 'Toon' } }) },
  { rule: 'A2', name: 'a label not in Title Case', plant: en('lookGameLabel', 'Game style') },
  { rule: 'A2', name: 'the catalog says Real', plant: en('lookRealisticLabel', 'Real') },
  { rule: 'A2', name: 'no Spanish for a look', plant: es('lookRealisticLabel', undefined) },
  { rule: 'A2', name: 'an "and" sign in the caption', plant: en('lookHelpSub', 'Both looks draw the same schematic & the same reported progress') },
  { rule: 'A2', name: 'a caption that ends in a period', plant: en('lookHelpSub', 'Both looks draw the same schematic and the same reported progress.') },
  { rule: 'A3', name: 'Realistic becomes the default', plant: swap({ DEFAULT: 'realistic' }) },
  { rule: 'A3', name: 'Game Style is handed the theme\'s own palette, with no finish', plant: swap({ lookPalette: ((b: LivingModelPalette, l: ModelLook, c?: LookCost) => (l === 'game' ? b : lookPalette(b, l, c))) as typeof lookPalette }) },
  { rule: 'A3', name: 'Game Style only tints its floors', plant: swap({ lookPalette: ((b: LivingModelPalette, l: ModelLook, c?: LookCost) => (l === 'game' ? { ...lookPalette(b, l, c), floorTint: 0.3 } : lookPalette(b, l, c))) as typeof lookPalette }) },
  { rule: 'A3', name: 'Game Style is handed Realistic\'s finish', plant: swap({ lookPalette: ((b: LivingModelPalette, _l: ModelLook, c?: LookCost) => lookPalette(b, 'realistic', c)) as typeof lookPalette }) },
  { rule: 'A3', name: 'Game Style loses its dark lines', plant: swap({ lookPalette: ((b: LivingModelPalette, l: ModelLook, c?: LookCost) => lookPalette(b, l, { ...(c ?? lookCost(l, 'web')), outlines: false })) as typeof lookPalette }) },
  { rule: 'A3', name: 'Game Style loses its three steps', plant: swap({ lookPalette: ((b: LivingModelPalette, l: ModelLook, c?: LookCost) => lookPalette(b, l, { ...(c ?? lookCost(l, 'web')), shading: l === 'game' ? 'flat' : 'surface' })) as typeof lookPalette }) },
  { rule: 'A3', name: 'Game Style\'s walls are as thin as Realistic\'s', plant: swap({ lookPalette: ((b: LivingModelPalette, l: ModelLook, c?: LookCost) => { const p = lookPalette(b, l, c); return l === 'game' && p.finish ? { ...p, finish: { ...p.finish, build: LOOK_BUILD.realistic } } : p; }) as typeof lookPalette }) },
  { rule: 'A3', name: 'Realistic is drawn with the level camera', plant: swap({ lookPalette: ((b: LivingModelPalette, l: ModelLook, c?: LookCost) => { const p = lookPalette(b, l, c); return p.finish ? { ...p, finish: { ...p.finish, camera: 'level' as const } } : p; }) as typeof lookPalette }) },
  { rule: 'A3', name: 'Realistic loses its film curve', plant: swap({ lookPalette: ((b: LivingModelPalette, l: ModelLook, c?: LookCost) => { const p = lookPalette(b, l, c); return p.finish ? { ...p, finish: { ...p.finish, film: false } } : p; }) as typeof lookPalette }) },
  { rule: 'A3', name: 'Realistic loses its grains and its corner shade', plant: swap({ lookPalette: ((b: LivingModelPalette, l: ModelLook, c?: LookCost) => lookPalette(b, l, { ...(c ?? lookCost(l, 'web')), textures: false, wallShade: false })) as typeof lookPalette }) },
  { rule: 'A3', name: 'Realistic fills its floors like Game Style', plant: swap({ lookPalette: ((b: LivingModelPalette, l: ModelLook, c?: LookCost) => (l === 'realistic' ? { ...lookPalette(b, l, c), floorTint: 1 } : lookPalette(b, l, c))) as typeof lookPalette }) },
  { rule: 'A3', name: 'both looks in the same quiet colours', plant: swap({ GAME: impl.REALISTIC }) },
  { rule: 'A3', name: 'the level camera is dropped', plant: edit(SCENE, 'new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 600)', 'new THREE.OrthographicCamera(-2, 2, 2, -2, 1, 900)') },
  { rule: 'A3', name: 'a palette with no look named is drawn as Realistic', plant: edit(SCENE, "const palette = given.finish ? given : lookPalette(given, 'game');", "const palette = given.finish ? given : lookPalette(given, 'realistic');") },
  { rule: 'A3', name: 'the dark rim is drawn right side out', plant: edit(SCENE, 'new THREE.MeshBasicMaterial({ color: finish.ink.color, side: THREE.BackSide })', 'new THREE.MeshBasicMaterial({ color: finish.ink.color })') },
  { rule: 'A3', name: 'the band is lit like the floor', plant: edit(SCENE, 'new THREE.MeshBasicMaterial({ color: palette.vertexBase, toneMapped: false })', "lambert(palette.vertexBase, {}, 'trim')") },
  { rule: 'A3', name: 'the sun is lowered in both looks', plant: edit(SCENE, '* finish.sunLift,', '* 0.5,') },
  { rule: 'A4', name: 'a key with no owned prefix', plant: swap({ KEY: 'living_model_look' }) },
  { rule: 'A4', name: 'a key under a brand-new prefix', plant: swap({ KEY: 'lm_look' }) },
  { rule: 'A4', name: 'a key per job', plant: swap({ KEY: 'mageid_living_model_look::p1' }) },
  { rule: 'A4', name: 'the store writes another key', plant: edit(STORE, 'await AsyncStorage.setItem(MODEL_LOOK_STORAGE_KEY, look);', "await AsyncStorage.setItem('look', look);") },
  { rule: 'A4', name: 'what was stored is used unread', plant: edit(STORE, 'readModelLook(await AsyncStorage.getItem(MODEL_LOOK_STORAGE_KEY))', '(await AsyncStorage.getItem(MODEL_LOOK_STORAGE_KEY)) as ModelLook') },
  { rule: 'A4', name: 'the screen never reads the stored look', plant: edit(SCREEN, 'void loadModelLook().then((l) => { if (alive) setLook(l); });', 'void 0;') },
  { rule: 'A4', name: 'a new choice is not kept', plant: edit(SCREEN, '{ setLook(l); void saveModelLook(l); }', '{ setLook(l); }') },
  { rule: 'A4', name: 'the screen writes the key itself', plant: edit(SCREEN, "type Tab = 'rooms' | 'tasks' | 'replay';", "const LOOK_KEY = 'mageid_living_model_look';\ntype Tab = 'rooms' | 'tasks' | 'replay';") },
  { rule: 'B1', name: 'an element left out of the list', plant: swap({ ELEMENTS: LOOK_ELEMENTS.filter((e) => e !== 'insulation') }) },
  { rule: 'B1', name: 'an element with no colour in Realistic', plant: swap({ elementAppearance: ((l: ModelLook, e: (typeof LOOK_ELEMENTS)[number], m: 'light' | 'dark', g: string) => (l === 'realistic' && e === 'stud' ? { ...elementAppearance(l, e, m, g), colours: ['undefined'] } : elementAppearance(l, e, m, g))) as typeof elementAppearance }) },
  { rule: 'B1', name: 'Game Style given a rough surface', plant: swap({ elementAppearance: ((l: ModelLook, e: (typeof LOOK_ELEMENTS)[number], m: 'light' | 'dark', g: string) => elementAppearance('realistic', e, m, g)) as typeof elementAppearance }) },
  { rule: 'B1', name: 'a roughness past 1', plant: swap({ elementAppearance: ((l: ModelLook, e: (typeof LOOK_ELEMENTS)[number], m: 'light' | 'dark', g: string) => (l === 'realistic' && e === 'trim' ? { ...elementAppearance(l, e, m, g), roughness: 1.4 } : elementAppearance(l, e, m, g))) as typeof elementAppearance }) },
  { rule: 'B1', name: 'solid glass', plant: swap({ elementAppearance: ((l: ModelLook, e: (typeof LOOK_ELEMENTS)[number], m: 'light' | 'dark', g: string) => ({ ...elementAppearance(l, e, m, g), opacity: 1 })) as typeof elementAppearance }) },
  { rule: 'B1', name: 'a dark Realistic wall as pale as the light one', plant: swap({ REALISTIC: { ...impl.REALISTIC, dark: { ...impl.REALISTIC.dark, wallFinished: '#F2EFE7' } } }) },
  { rule: 'B1', name: 'a Realistic material missing on a dark page', plant: swap({ REALISTIC: { ...impl.REALISTIC, dark: Object.fromEntries(Object.entries(impl.REALISTIC.dark).filter(([k]) => k !== 'trim')) } }) },
  { rule: 'B1', name: 'Realistic drops a palette colour', plant: swap({ lookPalette: ((b: LivingModelPalette, l: ModelLook, c?: LookCost) => (l === 'realistic' ? { ...lookPalette(b, l, c), insulation: undefined as unknown as string } : b)) as typeof lookPalette }) },
  { rule: 'B2', name: 'a stage left out of the list', plant: swap({ STAGES: LOOK_STAGES.filter((s) => s !== 'other') }) },
  { rule: 'B2', name: 'Realistic recolours a stage', plant: swap({ lookPalette: ((b: LivingModelPalette, l: ModelLook, c?: LookCost) => (l === 'realistic' ? { ...lookPalette(b, l, c), stage: { ...b.stage, framing: '#808080' } } : b)) as typeof lookPalette }) },
  { rule: 'B2', name: 'Realistic shows no stage on the floor', plant: swap({ stageAppearance: ((l: ModelLook, s: RoomStage, p: LivingModelPalette) => (l === 'realistic' ? { ...stageAppearance(l, s, p), floorTint: 0, band: false } : stageAppearance(l, s, p))) as typeof stageAppearance }) },
  { rule: 'B2', name: 'Realistic fills the floor with the stage colour', plant: swap({ lookPalette: ((b: LivingModelPalette, l: ModelLook, c?: LookCost) => (l === 'realistic' ? { ...lookPalette(b, l, c), floorTint: 0.62 } : b)) as typeof lookPalette }) },
  { rule: 'B2', name: 'a room not started is marked', plant: swap({ stageAppearance: ((l: ModelLook, s: RoomStage, p: LivingModelPalette) => ({ ...stageAppearance(l, s, p), floorTint: 0.3, band: l === 'realistic' })) as typeof stageAppearance }) },
  { rule: 'B2', name: 'the scene draws no band', plant: wrapScene((h) => ({ ...h, bandHex: () => null })) },
  { rule: 'B2', name: 'the band is one colour for every stage', plant: wrapScene((h, p) => ({ ...h, bandHex: (id: string) => (h.bandHex?.(id) ? p.accent : null) })) },
  { rule: 'B2', name: 'the band stays on a room that is not started', plant: wrapScene((h, p) => ({ ...h, bandHex: (id: string) => h.bandHex?.(id) ?? (p.finish ? p.stage.not_started : null) })) },
  { rule: 'B3', name: 'Framing goes back to a tan that is lost on the subfloor', plant: swap({ lookPalette: ((b: LivingModelPalette, l: ModelLook, c?: LookCost) => { const p = lookPalette(b, l, c); return { ...p, stage: { ...p.stage, framing: p.floorSub } }; }) as typeof lookPalette }) },
  { rule: 'B3', name: 'Drywall and Demolition are two greys again', plant: swap({ lookPalette: ((b: LivingModelPalette, l: ModelLook, c?: LookCost) => { const p = lookPalette(b, l, c); return { ...p, stage: { ...p.stage, demolition: '#8A8D86', drywall: '#A8A49A' } }; }) as typeof lookPalette }) },
  { rule: 'B3', name: 'a Realistic floor is repainted in a stage colour', plant: swap({ lookPalette: ((b: LivingModelPalette, l: ModelLook, c?: LookCost) => { const p = lookPalette(b, l, c); return { ...p, floorFinished: p.stage.finishes }; }) as typeof lookPalette }) },
  { rule: 'B3', name: 'the gaps asked for are lowered', plant: swap({ GAPS: { floor: 5, stages: 5 } }) },
  { rule: 'B3', name: 'the band is a hairline', plant: swap({ lookPalette: ((b: LivingModelPalette, l: ModelLook, c?: LookCost) => { const p = lookPalette(b, l, c); return p.finish ? { ...p, finish: { ...p.finish, band: { widthM: 0.03 } } } : p; }) as typeof lookPalette }) },
  { rule: 'B4', name: 'a window frame is drawn where the model has no window', plant: swap({ buildRoomGeometry: ((room: Parameters<typeof buildRoomGeometry>[0], o?: Parameters<typeof buildRoomGeometry>[1]) => { const g = buildRoomGeometry(room, o); return g.frames.boxes ? g : { ...g, frames: { ...g.studs, boxes: 4 } }; }) as typeof buildRoomGeometry }) },
  { rule: 'B4', name: 'a window in the model gets no glass', plant: swap({ buildRoomGeometry: ((room: Parameters<typeof buildRoomGeometry>[0], o?: Parameters<typeof buildRoomGeometry>[1]) => { const g = buildRoomGeometry(room, o); return { ...g, glass: { p: [], n: [], c: [], boxes: 0 } }; }) as typeof buildRoomGeometry }) },
  { rule: 'B4', name: 'the walls have no lid', plant: swap({ buildRoomGeometry: ((room: Parameters<typeof buildRoomGeometry>[0], o?: Parameters<typeof buildRoomGeometry>[1]) => { const g = buildRoomGeometry(room, o); return { ...g, cap: { p: [], n: [], c: [], boxes: 0 } }; }) as typeof buildRoomGeometry }) },
  { rule: 'B4', name: 'fat studs poke out of the room', plant: swap({ buildRoomGeometry: ((room: Parameters<typeof buildRoomGeometry>[0], o?: Parameters<typeof buildRoomGeometry>[1]) => { const g = buildRoomGeometry(room, o); return { ...g, studs: { ...g.studs, p: g.studs.p.map((v, i) => (i % 3 === 0 ? v - 0.05 : v)) } }; }) as typeof buildRoomGeometry }) },
  { rule: 'B4', name: 'Game Style\'s walls are built to Realistic\'s measures', plant: swap({ BUILD: { ...impl.BUILD, game: impl.BUILD.realistic } }) },
  { rule: 'B4', name: 'the dark rim is no larger than the wall', plant: swap({ buildRoomInk: ((room: Parameters<typeof buildRoomInk>[0], _e: number, o?: Parameters<typeof buildRoomInk>[2]) => buildRoomInk(room, 1e-9, o)) as typeof buildRoomInk }) },
  { rule: 'B4', name: 'the dark rim has no shapes', plant: swap({ buildRoomInk: (() => ({ p: [], n: [], c: [], boxes: 0 })) as typeof buildRoomInk }) },
  { rule: 'B4', name: 'a doorway is shaded across', plant: swap({ buildWallShade: ((room: Parameters<typeof buildWallShade>[0], wd: number, t?: number) => { const s2 = buildWallShade(room, wd, t); return s2.p.length ? { p: s2.p.slice(18), n: s2.n.slice(18), uv: s2.uv.slice(12) } : s2; }) as typeof buildWallShade }) },
  { rule: 'B4', name: 'the corner shade does not fade', plant: swap({ buildWallShade: ((room: Parameters<typeof buildWallShade>[0], wd: number, t?: number) => { const s2 = buildWallShade(room, wd, t); return { ...s2, uv: s2.uv.map(() => 0) }; }) as typeof buildWallShade }) },
  { rule: 'B4', name: 'a picture is stretched to fit, not laid by the metre', plant: swap({ planarUV: ((pp: readonly number[], nn: readonly number[]) => planarUV(pp, nn, 1)) as typeof planarUV }) },
  { rule: 'B5', name: 'a grain made from chance', plant: swap({ lookTexturePixels: ((k: Parameters<typeof lookTexturePixels>[0], n?: number) => { const px = lookTexturePixels(k, n); const t = (swapCount.n += 1); px[0] = px[1] = px[2] = 200 + (t % 2); return px; }) as typeof lookTexturePixels }) },
  { rule: 'B5', name: 'a grain with a colour of its own', plant: swap({ lookTexturePixels: ((k: Parameters<typeof lookTexturePixels>[0], n?: number) => { const px = lookTexturePixels(k, n); for (let i = 1; i < px.length; i += 4) px[i] = Math.round(px[i] * 0.8); return px; }) as typeof lookTexturePixels }) },
  { rule: 'B5', name: 'a dark grain', plant: swap({ lookTexturePixels: ((k: Parameters<typeof lookTexturePixels>[0], n?: number) => lookTexturePixels(k, n).map((v, i) => (i % 4 === 3 ? v : Math.round(v * 0.6)))) as typeof lookTexturePixels }) },
  { rule: 'B5', name: 'one grain for everything', plant: swap({ lookTexturePixels: ((_k: Parameters<typeof lookTexturePixels>[0], n?: number) => lookTexturePixels('slab', n)) as typeof lookTexturePixels }) },
  { rule: 'B5', name: 'the corner shade fades the wrong way', plant: swap({ fadePixels: ((n?: number) => { const f = fadePixels(n); const out = new Uint8Array(f.length); for (let i = 0; i < f.length; i += 4) out.set(f.slice(f.length - 4 - i, f.length - i), i); return out; }) as typeof fadePixels }) },
  { rule: 'B5', name: 'the grains are drawn on a canvas', plant: edit(TEXTURES_FILE, 'export const LOOK_TEXTURE_SIZE = 256;', "export const LOOK_TEXTURE_SIZE = 256;\nexport const sheet = () => document.createElement('canvas');") },
  { rule: 'B5', name: 'a grain from the clock', plant: edit(TEXTURES_FILE, 'let a = seed >>> 0;', 'let a = (seed + Date.now()) >>> 0;') },
  { rule: 'C1', name: 'a phone at Standard gets the costly shading', plant: swap({ lookCost: ((l: ModelLook, d: 'web' | 'phone', q?: 'standard' | 'high') => ({ ...lookCost(l, d, q), shading: l === 'realistic' ? 'surface' : lookCost(l, d, q).shading })) as typeof lookCost }) },
  { rule: 'C1', name: 'a phone at Standard gets the three steps', plant: swap({ lookCost: ((l: ModelLook, d: 'web' | 'phone', q?: 'standard' | 'high') => ({ ...lookCost(l, d, q), shading: l === 'game' ? 'toon' : lookCost(l, d, q).shading })) as typeof lookCost }) },
  { rule: 'C1', name: 'a phone at Standard gets the grains', plant: swap({ lookCost: ((l: ModelLook, d: 'web' | 'phone', q?: 'standard' | 'high') => ({ ...lookCost(l, d, q), textures: l === 'realistic' })) as typeof lookCost }) },
  { rule: 'C1', name: 'the cost table says one thing and lookCost another', plant: swap({ COSTS: { ...impl.COSTS, game: { ...impl.COSTS.game, phoneStandard: impl.COSTS.game.web } } }) },
  { rule: 'C1', name: 'the phone\'s budget is raised', plant: swap({ BUDGET: { drawables: 500, triangles: 90000 } }) },
  { rule: 'C1', name: 'the phone\'s budget is under what the looks draw', plant: swap({ BUDGET: { drawables: 60, triangles: 12000 } }) },
  { rule: 'C1', name: 'a figure in looks.ts is stale', plant: edit(LOOKS_FILE, 'phone Std  flat      88      16,958', 'phone Std  flat      61      14,632') },
  { rule: 'C1', name: 'a phone makes the sky dome', plant: swap({ lookCost: ((l: ModelLook, d: 'web' | 'phone', q?: 'standard' | 'high') => ({ ...lookCost(l, d, q), skyDome: l === 'realistic' })) as typeof lookCost }) },
  { rule: 'C1', name: 'Game Style is given the grains', plant: swap({ lookCost: ((l: ModelLook, d: 'web' | 'phone', q?: 'standard' | 'high') => ({ ...lookCost(l, d, q), textures: true })) as typeof lookCost }) },
  { rule: 'C1', name: 'the web loses the surfaces', plant: swap({ lookCost: ((l: ModelLook, d: 'web' | 'phone', q?: 'standard' | 'high') => ({ ...lookCost(l, d, q), shading: 'flat' })) as typeof lookCost }) },
  { rule: 'C1', name: 'a thrown-away scene keeps what it made', plant: wrapScene((h) => ({ ...h, dispose: () => { /* kept */ } })) },
  { rule: 'C1', name: 'the palette does not change with the look', plant: edit(SHARED, 'return useMemo(() => lookPalette(base, look, lookCost(look, device, quality)), [base, look, device, quality]);', 'return useMemo(() => lookPalette(base, look, lookCost(look, device, quality)), [base]);') },
  { rule: 'C1', name: 'the web view ignores the look', plant: edit(WEB, "const palette = useLookPalette(look, 'web');", 'const palette = useLookPalette();') },
  { rule: 'C1', name: 'the phone spends the web\'s cost', plant: edit(PHONE_VIEW, "const palette = useLookPalette(look, 'phone', quality);", "const palette = useLookPalette(look, 'web');") },
  { rule: 'C1', name: 'the screen never hands the look down', plant: edit(SCREEN, 'quality={quality} look={look} ', 'quality={quality} ') },
  { rule: 'D1', name: 'the flag is turned on', plant: edit(FLAGS, 'export const LIVING_MODEL_ENABLED = false;', 'export const LIVING_MODEL_ENABLED = true;') },
  { rule: 'D1', name: 'the look store reads the flag', plant: edit(STORE, "import AsyncStorage from '@react-native-async-storage/async-storage';", "import AsyncStorage from '@react-native-async-storage/async-storage';\nimport { LIVING_MODEL_ENABLED } from '@/constants/featureFlags';\nexport const on = LIVING_MODEL_ENABLED;") },
  { rule: 'D2', name: 'the looks module imports the 3D library', plant: edit(LOOKS_FILE, "import type { RoomStage } from './stageCore';", "import type { RoomStage } from './stageCore';\nimport { Color } from 'three';\nexport const c = new Color();") },
  { rule: 'D2', name: 'the looks module reads storage', plant: edit(LOOKS_FILE, "import type { RoomStage } from './stageCore';", "import type { RoomStage } from './stageCore';\nimport AsyncStorage from '@react-native-async-storage/async-storage';\nexport const s = AsyncStorage;") },
  { rule: 'D2', name: 'an animation library in the phone view', plant: edit(PHONE_VIEW, "import { useFocusEffect } from 'expo-router';", "import { useFocusEffect } from 'expo-router';\nimport Animated2 from 'react-native-reanimated';\nexport const A2 = Animated2;") },
  { rule: 'D2', name: 'a texture fetched from the network', plant: edit(SCENE, 'const soft = new THREE.DataTexture(px, N, N);', "const soft = new THREE.TextureLoader().load('https://example.com/concrete.jpg');") },
  { rule: 'D2', name: 'a new 3D package', plant: pkgEdit((p) => ({ ...p, dependencies: { ...p.dependencies, 'three-stdlib': '2.0.0' } })) },
  { rule: 'D2', name: 'the scene eases its camera on its own', plant: edit(SCENE, '    camera.updateMatrixWorld();', '    camera.updateMatrixWorld();\n    requestAnimationFrame(updateCamera);') },
  { rule: 'D3', name: 'the caption says exact', plant: en('lookHelpSub', 'Realistic shows the exact building') },
  { rule: 'D3', name: 'a look named Accurate', plant: swap({ LABELS: { realistic: 'Accurate', game: 'Game Style' } }) },
  { rule: 'D3', name: 'the caption says to scale', plant: en('lookHelpSub', 'Both looks draw the same schematic to scale') },
  { rule: 'D3', name: 'Spanish says exacto', plant: es('lookHelpSub', 'Los dos aspectos dibujan el mismo esquema exacto') },
  { rule: 'D3', name: 'the caption drops the word schematic', plant: en('lookHelpSub', 'Both looks draw the same model') },
  { rule: 'D3', name: 'the switch is drawn over the flat replay too', plant: edit(SCREEN, '{threeD ? (\n            <View style={styles.stack} testID="lm-look">', '{true ? (\n            <View style={styles.stack} testID="lm-look">') },
];

// ── run ──────────────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
console.log('validate-living-model-looks: Realistic and Game Style\n');
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

console.log(`\n${fail === 0 ? '✓' : '✗'} validate-living-model-looks: ${pass} checks (${MUTATIONS.length} planted mutations), ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
