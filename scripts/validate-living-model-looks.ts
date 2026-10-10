// scripts/validate-living-model-looks.ts — the two looks of the Living Model's 3D view (lane LOOKS).
//
// The founder asked for a switch between "Realistic" and "Game Style". This
// gate holds what must stay true about it.
//
// A. THE SWITCH: exactly two looks, named Realistic and Game Style, in English
//    and in Spanish; the default is the look the view had before the switch,
//    and that look is drawn by the lines that always drew it (the same palette
//    object, flat shading, the level camera, the same floor colours); the
//    choice is kept under a key the app owns, so the sweep at a change of
//    account covers it.
// B. EVERY ELEMENT AND EVERY STAGE HAS AN APPEARANCE IN BOTH LOOKS, on a light
//    page and a dark one, as tables (utils/livingModel/looks.ts, run directly)
//    and through the scene builder itself, run here with a renderer that draws
//    nothing: each working stage changes a room's floor in both looks, and in
//    Realistic the floor keeps its material while a band carries the stage
//    colour.
// C. COST: Game Style spends what the view always spent; Realistic on a phone
//    at Standard keeps the shading Game Style uses; the sky dome is never made
//    on a phone; throwing a scene away lets go of every material and texture
//    the look made.
// D. THE GATE AND THE WORDS: LIVING_MODEL_ENABLED is still false and is read in
//    one file; the looks module is pure (no React, no storage, no 3D library);
//    no animation library came in; neither look's words say how right the
//    model is.
//
// NOT PROVED HERE: what the two looks look like. That was looked at in a
// browser (design-previews/living-model/looks-realistic.png and looks-game.png).
// Frame rate on a real iPhone is not measured here either: rule C1 holds the
// cost table, not a clock.
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
  DEFAULT_MODEL_LOOK, LOOK_ELEMENTS, LOOK_STAGES, MODEL_LOOKS, MODEL_LOOK_LABELS, MODEL_LOOK_STORAGE_KEY, PLAIN_FLOOR_STAGES, PRE_EXISTING_LOOK, REALISTIC_COLOURS,
  elementAppearance, isModelLook, lookCost, lookPalette, readModelLook, stageAppearance, type ModelLook,
} from '../utils/livingModel/looks';
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
  PRE_EXISTING: PRE_EXISTING_LOOK as string,
  KEY: MODEL_LOOK_STORAGE_KEY,
  ELEMENTS: LOOK_ELEMENTS as readonly string[],
  STAGES: LOOK_STAGES as readonly string[],
  isModelLook, readModelLook, lookPalette, lookCost, elementAppearance, stageAppearance, createJobScene,
  REALISTIC: REALISTIC_COLOURS as unknown as Record<'light' | 'dark', Record<string, string | number>>,
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
const hexDist = (a: string, b: string): number => {
  const n = (h: string) => { const v = parseInt(h.replace('#', ''), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
  const p = n(a); const q = n(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};
const lum = (h: string): number => { const v = parseInt(h.slice(1), 16); return (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255; };

interface SceneLog { flat: number; surface: number; basic: number; shadowOnly: number; textures: number; domes: number; disposedMaterials: number; disposedTextures: number; disposedDomes: number; level: number; perspective: number; toneMapping: number; shadowsOn: boolean | null; castShadow: boolean | null }

/** The real three.js with a renderer that draws nothing and makers that count, so the scene builder runs here with no WebGL. */
function countingThree(): { lib: typeof import('three'); log: SceneLog } {
  const log: SceneLog = { flat: 0, surface: 0, basic: 0, shadowOnly: 0, textures: 0, domes: 0, disposedMaterials: 0, disposedTextures: 0, disposedDomes: 0, level: 0, perspective: 0, toneMapping: 0, shadowsOn: null, castShadow: null };
  const T = THREE_LIB as unknown as Record<string, new (...a: any[]) => any>;
  const counted = (name: string, key: 'flat' | 'surface' | 'basic' | 'shadowOnly') => class extends T[name] {
    constructor(...a: any[]) { super(...a); log[key] += 1; }
    dispose(): void { log.disposedMaterials += 1; super.dispose(); }
  };
  class Renderer {
    shadowMap = new Proxy({ enabled: false, type: 0 }, { set: (t, k, v) => { (t as Record<string | symbol, unknown>)[k] = v; if (k === 'enabled') log.shadowsOn = v as boolean; return true; } });
    domElement = {};
    set toneMapping(v: number) { log.toneMapping = v; }
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
    MeshLambertMaterial: counted('MeshLambertMaterial', 'flat'), MeshStandardMaterial: counted('MeshStandardMaterial', 'surface'),
    MeshBasicMaterial: counted('MeshBasicMaterial', 'basic'), ShadowMaterial: counted('ShadowMaterial', 'shadowOnly'),
  } as unknown as typeof import('three');
  return { lib, log };
}

const SOLID_DONE: RoomLayers = { skin: 0, studs: 1, roughIn: 1, insulation: 1, board: 1, finish: 1 };
const SOLID_OPEN: RoomLayers = { skin: 0, studs: 1, roughIn: 0.4, insulation: 0, board: 0, finish: 0 };
const UNTOUCHED: RoomLayers = { skin: 1, studs: 0, roughIn: 0, insulation: 0, board: 0, finish: 0 };
const layersFor = (stage: RoomStage): RoomLayers => (PLAIN_FLOOR_STAGES.includes(stage) ? UNTOUCHED : stage === 'done' || stage === 'finishes' ? SOLID_DONE : SOLID_OPEN);

/** A scene of the seven-room job with every room at one stage. */
function sceneAt(w: World, palette: LivingModelPalette, stage: RoomStage | null): { h: JobSceneHandle; log: SceneLog } {
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
  return { h, log: t.log };
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

rule('A3', 'the default is the look the view had before the switch, and that look is drawn as it always was', (w) => {
  const out: string[] = [];
  if (w.impl.PRE_EXISTING !== 'game') out.push(`the look from before the switch is recorded as ${w.impl.PRE_EXISTING}; it was the flat schematic, Game Style`);
  if (w.impl.DEFAULT !== w.impl.PRE_EXISTING) out.push(`the default is ${w.impl.DEFAULT}; the look from before the switch is ${w.impl.PRE_EXISTING}`);
  for (const mode of MODES) {
    const base = BASE[mode];
    if (base.finish !== undefined) out.push(`${mode}: the theme's own palette carries a finish`);
    // The very same object: the scene builder cannot tell Game Style from the view before the switch.
    for (const device of ['web', 'phone'] as const) for (const q of ['standard', 'high'] as const) {
      if (w.impl.lookPalette(base, 'game', w.impl.lookCost('game', device, q)) !== base) out.push(`${mode} ${device} ${q}: Game Style's palette is not the theme's own palette, untouched`);
    }
    const { h, log } = sceneAt(w, w.impl.lookPalette(base, 'game'), 'rough_in');
    const s = h.stats?.();
    if (!s || s.look !== 'game' || s.shading !== 'flat' || s.camera !== 'level' || s.textures !== 0 || s.skyDome || s.groundPatch) out.push(`${mode}: Game Style's scene is ${JSON.stringify(s)}`);
    if (log.surface !== 0 || log.basic !== 0 || log.shadowOnly !== 0 || log.textures !== 0 || log.domes !== 0 || log.perspective !== 0 || log.toneMapping !== 0) out.push(`${mode}: Game Style made something it never made before: ${JSON.stringify(log)}`);
    if (log.shadowsOn !== true || log.castShadow !== true) out.push(`${mode}: Game Style lost its shadows`);
    // The floor, by the numbers the view has always used: the subfloor, tinted to the stage by the palette's own share.
    const Colour = (THREE_LIB as unknown as { Color: new (c: string) => { lerp(c: unknown, k: number): unknown; getHexString(): string } }).Color;
    const mixed = new Colour(base.floorSub);
    mixed.lerp(new Colour(base.stage.rough_in), MATERIALS[mode].floorTint);
    const want = `#${mixed.getHexString()}`;
    const got = h.floorHex('kitchen');
    if (!got || got !== want) out.push(`${mode}: a room at Rough-In has a ${got} floor in Game Style; the view has always drawn ${want}`);
    if (h.bandHex?.('kitchen') != null) out.push(`${mode}: Game Style draws a band round the floor`);
    h.dispose();
  }
  const scene = code(w.files[SCENE] ?? '');
  for (const [line, what] of [
    ['new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 600)', 'the level camera'],
    ['const finish = palette.finish ?? null;', 'the one switch between the looks'],
    ['sun.castShadow = finish ? finish.cost.shadows : true;', 'the sun\'s shadow'],
    ['new THREE.MeshLambertMaterial({ color: palette.glass, transparent: true, opacity: 0.55, depthWrite: false })', 'the glass'],
    [': lambert(palette.ground),', 'the ground'],
    ['* (finish ? finish.fit : 1)', 'the home view'],
    ['* (finish ? finish.sunLift : 1)', 'the sun\'s height'],
  ] as const) if (!scene.includes(line)) out.push(`the scene builder no longer keeps ${what} as it was when there is no finish`);
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

rule('B1', 'every element the view draws has a colour and a surface in both looks, on a light page and a dark one', (w) => {
  const out: string[] = [];
  // The list covers every material the palette holds, so a new one cannot be left without a Realistic colour.
  const fromPalette = Object.entries(MATERIALS.light).filter(([k, v]) => typeof v === 'string' && !/^stage|^sky$|^sun$|^vertexBase$/.test(k)).map(([k]) => (/^pipe/.test(k) ? 'pipes' : k));
  for (const k of new Set(fromPalette)) if (!w.impl.ELEMENTS.includes(k)) out.push(`the palette's ${k} is not in the list of elements`);
  if (!w.impl.ELEMENTS.includes('ground')) out.push('the ground is not in the list of elements');
  if (Object.keys(w.impl.REALISTIC.light).sort().join() !== Object.keys(w.impl.REALISTIC.dark).sort().join()) out.push('the Realistic table does not hold the same things for a light page and a dark one');
  for (const look of w.impl.MODEL_LOOKS as readonly ModelLook[]) for (const mode of MODES) for (const el of w.impl.ELEMENTS) {
    let a: ReturnType<typeof elementAppearance>;
    try { a = w.impl.elementAppearance(look, el as (typeof LOOK_ELEMENTS)[number], mode, BASE[mode].ground); } catch (e) { out.push(`${look} ${mode} ${el}: threw ${String(e)}`); continue; }
    const where = `${look} ${mode} ${el}`;
    if (!a || !Array.isArray(a.colours) || a.colours.length !== (el === 'pipes' ? 3 : 1)) { out.push(`${where}: has ${a?.colours?.length ?? 0} colours`); continue; }
    for (const c of a.colours) if (!HEX.test(c)) out.push(`${where}: "${c}" is not a colour`);
    if (!(a.opacity > 0 && a.opacity <= 1)) out.push(`${where}: opacity ${a.opacity}`);
    if ((el === 'glass') !== (a.opacity < 1)) out.push(`${where}: ${el === 'glass' ? 'the glass is solid' : 'is see-through'}`);
    if (look === 'game') {
      if (a.shading !== 'flat' || a.roughness !== null || a.metalness !== null) out.push(`${where}: Game Style has a rough-and-smooth surface`);
    } else if (el === 'ground') {
      if (a.shading !== 'flat') out.push(`${where}: the ground is the page; it has no surface of its own`);
    } else {
      if (a.shading !== 'surface') out.push(`${where}: no surface on the web`);
      if (!(typeof a.roughness === 'number' && a.roughness >= 0 && a.roughness <= 1) || !(typeof a.metalness === 'number' && a.metalness >= 0 && a.metalness <= 1)) out.push(`${where}: roughness ${a.roughness}, metalness ${a.metalness}`);
    }
    if (el === 'ground' && a.colours[0] !== BASE[mode].ground) out.push(`${where}: the ground is not the page's colour`);
  }
  // The same materials, quieter: no Realistic colour is a loud one, and dark walls are darker than light ones.
  for (const k of ['plinth', 'shell', 'wallOld', 'wallBoard', 'wallFinished', 'trim', 'floorOld', 'floorSub', 'floorFinished']) {
    const L = w.impl.REALISTIC.light[k];
    const D = w.impl.REALISTIC.dark[k];
    if (typeof L !== 'string' || typeof D !== 'string' || !HEX.test(L) || !HEX.test(D)) { out.push(`the Realistic table has no ${k}`); continue; }
    if (lum(D) >= lum(L) - 0.08) out.push(`Realistic ${k} is not darker on a dark page (${D}) than on a light one (${L})`);
  }
  // The palette the scene is handed carries every one of them.
  for (const mode of MODES) {
    const p = w.impl.lookPalette(BASE[mode], 'realistic') as unknown as Record<string, unknown>;
    for (const k of Object.keys(MATERIALS.light)) {
      if (/^stage/.test(k)) continue;
      if (p[k] === undefined || p[k] === null) out.push(`${mode}: Realistic's palette has no ${k}`);
    }
    if (p.ground !== BASE[mode].ground || p.accent !== BASE[mode].accent || p.done !== BASE[mode].done || p.ink !== BASE[mode].ink) out.push(`${mode}: Realistic does not keep the theme's own ground, ink, accent and Done colour`);
  }
  return out;
});

rule('B2', 'every stage shows on a room in both looks: the same stage colours, a floor that changes, and in Realistic a band while the floor keeps its material', (w) => {
  const out: string[] = [];
  const all = Object.keys(BASE.light.stage).sort();
  if ([...w.impl.STAGES].sort().join() !== all.join()) out.push(`the list of stages (${w.impl.STAGES.join(', ')}) is not the palette's (${all.join(', ')})`);
  for (const mode of MODES) {
    const base = BASE[mode];
    const real = w.impl.lookPalette(base, 'realistic');
    for (const s of all as RoomStage[]) if (real.stage[s] !== base.stage[s]) out.push(`${mode}: ${s} is ${real.stage[s]} in Realistic and ${base.stage[s]} in Game Style: one stage, two colours`);
    for (const look of w.impl.MODEL_LOOKS as readonly ModelLook[]) {
      const palette = w.impl.lookPalette(base, look);
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
        if (marked && !(a.floorTint > 0)) out.push(`${where}: the floor is not tinted`);
        if (!marked && (a.floorTint !== 0 || a.band)) out.push(`${where}: a room with nothing to show is marked`);
        if (marked && a.band !== (look === 'realistic')) out.push(`${where}: band ${a.band}`);
        if (marked && look === 'realistic' && !(a.floorTint < 0.5)) out.push(`${where}: the floor is more stage colour than material (${a.floorTint})`);
        if (marked && look === 'game' && !(a.floorTint >= 0.5)) out.push(`${where}: the floor is not filled with the stage colour (${a.floorTint})`);
        if (marked && Math.abs(a.floorTint - palette.floorTint) > 1e-9) out.push(`${where}: the table says ${a.floorTint} and the palette the scene is handed says ${palette.floorTint}`);
        // The scene itself.
        const { h } = sceneAt(w, palette, s);
        const floor = h.floorHex('kitchen');
        const band = h.bandHex?.('kitchen') ?? null;
        h.dispose();
        if (!floor) { out.push(`${where}: no floor in the scene`); continue; }
        if (marked && s !== 'done' && s !== 'finishes') {
          // Same layers as the plain room would have once opened; the stage alone must move the floor.
          const opened = sceneAt(w, { ...palette, floorTint: 0 }, s);
          const untinted = opened.h.floorHex('kitchen') ?? floor;
          opened.h.dispose();
          if (hexDist(floor, untinted) < 6 && hexDist(palette.stage[s], untinted) > 24) out.push(`${where}: the floor (${floor}) does not move toward the stage colour from ${untinted}`);
        }
        if (look === 'realistic') {
          if (marked && (band ?? '').toLowerCase() !== palette.stage[s].toLowerCase()) out.push(`${where}: the band is ${band}; the stage colour is ${palette.stage[s]}`);
          if (!marked && band !== null) out.push(`${where}: a band is drawn (${band})`);
        } else if (band !== null) out.push(`${where}: Game Style draws a band`);
        if (!marked && floor !== plainFloor) out.push(`${where}: the floor is ${floor}; a plain floor is ${plainFloor}`);
      }
    }
  }
  return out;
});

// ── C. cost ──────────────────────────────────────────────────────────────────

rule('C1', 'a look spends only what its device may: Realistic at Standard on a phone keeps Game Style\'s shading, no phone makes the sky dome, and a scene thrown away lets go of all it made', (w) => {
  const out: string[] = [];
  const C = w.impl.lookCost;
  const same = (a: object, b: object): boolean => JSON.stringify(a) === JSON.stringify(b);
  for (const device of ['web', 'phone'] as const) for (const q of ['standard', 'high'] as const) {
    if (!same(C('game', device, q), { surfaces: false, shadows: true, skyDome: false, groundPatch: false })) out.push(`Game Style on ${device} at ${q} costs ${JSON.stringify(C('game', device, q))}; it costs what the view always cost`);
  }
  if (!same(C('realistic', 'web'), { surfaces: true, shadows: true, skyDome: true, groundPatch: true })) out.push(`Realistic on the web is ${JSON.stringify(C('realistic', 'web'))}`);
  if (!same(C('realistic', 'phone', 'standard'), { surfaces: false, shadows: true, skyDome: false, groundPatch: true })) out.push(`Realistic on a phone at Standard is ${JSON.stringify(C('realistic', 'phone', 'standard'))}`);
  if (!same(C('realistic', 'phone', 'high'), { surfaces: true, shadows: true, skyDome: false, groundPatch: true })) out.push(`Realistic on a phone at High is ${JSON.stringify(C('realistic', 'phone', 'high'))}`);
  if (!same(C('realistic', 'phone'), C('realistic', 'phone', 'standard'))) out.push('a phone whose quality is not said is not taken as Standard');
  for (const q of ['standard', 'high'] as const) if (C('realistic', 'phone', q).skyDome) out.push(`a phone at ${q} makes the sky dome`);
  // The scene does what the cost says.
  const run = (device: 'web' | 'phone', q: 'standard' | 'high') => {
    const cost = C('realistic', device, q);
    const p = w.impl.lookPalette(BASE.light, 'realistic', cost);
    const r = sceneAt(w, p, 'framing');
    return { ...r, cost, stats: r.h.stats?.() };
  };
  const web = run('web', 'standard');
  // One flat material is always made: the one that draws nothing, for a layer with no faint twin.
  if (web.log.surface === 0 || web.log.flat > 1) out.push(`Realistic on the web made ${web.log.surface} rough-and-smooth materials and ${web.log.flat} flat ones`);
  if (web.log.domes !== 1 || !web.stats?.skyDome) out.push('Realistic on the web did not make its sky dome');
  if (web.log.perspective !== 1 || web.stats?.camera !== 'perspective' || !web.log.toneMapping) out.push('Realistic on the web has no lens, or no film curve');
  if (web.log.textures !== 1 || web.log.shadowOnly !== 1 || web.log.shadowsOn !== true || web.log.castShadow !== true) out.push(`Realistic on the web: ${JSON.stringify(web.log)}`);
  const std = run('phone', 'standard');
  if (std.log.surface !== 0) out.push(`Realistic on a phone at Standard made ${std.log.surface} rough-and-smooth materials: it must keep the flat shading`);
  if (std.log.domes !== 0 || std.stats?.skyDome) out.push('Realistic on a phone made the sky dome');
  if (std.log.textures !== 1 || !std.stats?.groundPatch) out.push('Realistic on a phone has no ground patch');
  const high = run('phone', 'high');
  if (high.log.surface === 0 || high.log.domes !== 0) out.push(`Realistic on a phone at High: ${high.log.surface} rough-and-smooth materials, ${high.log.domes} sky domes`);
  // Without the patch, none is made.
  const bare = sceneAt(w, w.impl.lookPalette(BASE.light, 'realistic', { ...C('realistic', 'phone'), groundPatch: false, shadows: false }), 'framing');
  if (bare.log.textures !== 0 || bare.log.shadowsOn !== false || bare.log.castShadow !== false) out.push(`with the patch and the shadows not afforded the scene still made them: ${JSON.stringify(bare.log)}`);
  bare.h.dispose();
  // Leaving: everything the look made is let go.
  for (const r of [web, std, high]) {
    const made = r.log.flat + r.log.surface + r.log.basic + r.log.shadowOnly;
    r.h.dispose();
    const after = r.h.stats?.();
    if (r.log.disposedMaterials !== made) out.push(`a Realistic scene made ${made} materials and let go of ${r.log.disposedMaterials}`);
    if (r.log.disposedTextures !== r.log.textures) out.push(`a Realistic scene made ${r.log.textures} textures and let go of ${r.log.disposedTextures}`);
    if (r.log.disposedDomes !== r.log.domes) out.push(`a Realistic scene made ${r.log.domes} sky domes and let go of ${r.log.disposedDomes}`);
    if (!after || after.textures !== 0 || after.ownedMaterials !== 0 || after.skyDome || r.h.roomCount() !== 0) out.push(`a Realistic scene that was thrown away still holds ${JSON.stringify(after)}`);
  }
  // A new look is a new scene: the views key the scene on the palette, and the palette changes with the look.
  const a = w.impl.lookPalette(BASE.light, 'realistic');
  if (a === BASE.light || !a.finish) out.push('Realistic\'s palette is the theme\'s own: the views would not make a new scene for it');
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
  if (/Animated\.(timing|spring|loop)\(|requestAnimationFrame/.test(code(w.files[SCENE] ?? ''))) out.push('the scene builder moves on its own');
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
  { rule: 'A3', name: 'the old look is recorded as Realistic', plant: swap({ PRE_EXISTING: 'realistic', DEFAULT: 'realistic' }) },
  { rule: 'A3', name: 'Game Style gets a copy of the palette', plant: swap({ lookPalette: ((b: LivingModelPalette, l: ModelLook, c?: ReturnType<typeof lookCost>) => (l === 'game' ? { ...b } : lookPalette(b, l, c))) as typeof lookPalette }) },
  { rule: 'A3', name: 'Game Style gets a lighter floor tint', plant: swap({ lookPalette: ((b: LivingModelPalette, l: ModelLook, c?: ReturnType<typeof lookCost>) => (l === 'game' ? { ...b, floorTint: 0.3 } : lookPalette(b, l, c))) as typeof lookPalette }) },
  { rule: 'A3', name: 'Game Style is handed Realistic\'s finish', plant: swap({ lookPalette: ((b: LivingModelPalette, _l: ModelLook, c?: ReturnType<typeof lookCost>) => lookPalette(b, 'realistic', c)) as typeof lookPalette }) },
  { rule: 'A3', name: 'the level camera is dropped', plant: edit(SCENE, 'new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 600)', 'new THREE.OrthographicCamera(-2, 2, 2, -2, 1, 900)') },
  { rule: 'A3', name: 'the old glass is changed', plant: edit(SCENE, 'opacity: 0.55, depthWrite: false })', 'opacity: 0.34, depthWrite: false })') },
  { rule: 'A3', name: 'the sun is lowered in both looks', plant: edit(SCENE, '* (finish ? finish.sunLift : 1)', '* 0.5') },
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
  { rule: 'B1', name: 'Realistic drops a palette colour', plant: swap({ lookPalette: ((b: LivingModelPalette, l: ModelLook, c?: ReturnType<typeof lookCost>) => (l === 'realistic' ? { ...lookPalette(b, l, c), insulation: undefined as unknown as string } : b)) as typeof lookPalette }) },
  { rule: 'B2', name: 'a stage left out of the list', plant: swap({ STAGES: LOOK_STAGES.filter((s) => s !== 'other') }) },
  { rule: 'B2', name: 'Realistic recolours a stage', plant: swap({ lookPalette: ((b: LivingModelPalette, l: ModelLook, c?: ReturnType<typeof lookCost>) => (l === 'realistic' ? { ...lookPalette(b, l, c), stage: { ...b.stage, framing: '#808080' } } : b)) as typeof lookPalette }) },
  { rule: 'B2', name: 'Realistic shows no stage on the floor', plant: swap({ stageAppearance: ((l: ModelLook, s: RoomStage, p: LivingModelPalette) => (l === 'realistic' ? { ...stageAppearance(l, s, p), floorTint: 0, band: false } : stageAppearance(l, s, p))) as typeof stageAppearance }) },
  { rule: 'B2', name: 'Realistic fills the floor with the stage colour', plant: swap({ lookPalette: ((b: LivingModelPalette, l: ModelLook, c?: ReturnType<typeof lookCost>) => (l === 'realistic' ? { ...lookPalette(b, l, c), floorTint: 0.62 } : b)) as typeof lookPalette }) },
  { rule: 'B2', name: 'a room not started is marked', plant: swap({ stageAppearance: ((l: ModelLook, s: RoomStage, p: LivingModelPalette) => ({ ...stageAppearance(l, s, p), floorTint: 0.3, band: l === 'realistic' })) as typeof stageAppearance }) },
  { rule: 'B2', name: 'the scene draws no band', plant: wrapScene((h) => ({ ...h, bandHex: () => null })) },
  { rule: 'B2', name: 'the band is one colour for every stage', plant: wrapScene((h, p) => ({ ...h, bandHex: (id: string) => (h.bandHex?.(id) ? p.accent : null) })) },
  { rule: 'B2', name: 'the band stays on a room that is not started', plant: wrapScene((h, p) => ({ ...h, bandHex: (id: string) => h.bandHex?.(id) ?? (p.finish ? p.stage.not_started : null) })) },
  { rule: 'C1', name: 'a phone at Standard gets the costly shading', plant: swap({ lookCost: ((l: ModelLook, d: 'web' | 'phone', q?: 'standard' | 'high') => ({ ...lookCost(l, d, q), surfaces: l === 'realistic' })) as typeof lookCost }) },
  { rule: 'C1', name: 'a phone makes the sky dome', plant: swap({ lookCost: ((l: ModelLook, d: 'web' | 'phone', q?: 'standard' | 'high') => ({ ...lookCost(l, d, q), skyDome: l === 'realistic' })) as typeof lookCost }) },
  { rule: 'C1', name: 'Game Style is charged for the ground patch', plant: swap({ lookCost: ((l: ModelLook, d: 'web' | 'phone', q?: 'standard' | 'high') => ({ ...lookCost(l, d, q), groundPatch: true })) as typeof lookCost }) },
  { rule: 'C1', name: 'the web loses the surfaces', plant: swap({ lookCost: ((l: ModelLook, d: 'web' | 'phone', q?: 'standard' | 'high') => ({ ...lookCost(l, d, q), surfaces: false })) as typeof lookCost }) },
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
