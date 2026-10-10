// utils/livingModel/looks.ts — the two looks of the Living Model's 3D view.
//
// PURE: no React, no React Native, no 3D library, no storage. The scene
// builder (components/livingModel/threeScene.ts) is handed what this file
// works out, on the web and on the phone alike.
//
// TWO LOOKS, ONE MODEL. The rooms, the replay, the picking, the Planned and
// Reported lens, the stage colours on the labels, the legend and the flat plan
// are the same in both. A look changes how the 3D picture is built and lit,
// and the two are meant to be told apart at a glance:
//
//   Game Style   A board-game piece. Chunky walls with a dark lid and a dark
//                line round every wall, bold flat colours shaded in three
//                steps, each floor filled with its stage colour, a level
//                camera with no vanishing point, and the whole model standing
//                on a round-cornered tile with a soft shadow under it. The
//                default.
//
//   Realistic    A cut-away of a building. Walls their real thickness with a
//                solid top where they are closed and open studs where they are
//                framed, window frames and glass where the model has windows,
//                boards, sheets and a slab with their own grain, a low warm
//                sun with soft shadows, light from the sky, shade in the
//                corners where a wall meets the floor, a film curve on the
//                picture and a camera with a vanishing point. The floor keeps
//                its material; the room's stage is a bright band round the
//                floor in the stage colour, which no light or shadow changes.
//
// WHAT A LOOK MAY COST (`LOOK_COST_TABLE`, read by `lookCost`). Measured on the
// seven-room test job with walls cut at 1.25 m, by
// scripts/validate-living-model-looks.ts (rule C1 holds these as ceilings):
//
//                          shading   shapes drawn  triangles  pictures  shadow map   sky dome
//   Game Style  web        3 steps   __GW_D__            __GW_T__     2         web's 2048   no
//   Game Style  phone Std  flat      __GS_D__            __GS_T__     1         quality's    no
//   Game Style  phone High 3 steps   __GH_D__            __GH_T__     2         quality's    no
//   Realistic   web        rough     __RW_D__            __RW_T__     7         web's 2048   yes
//   Realistic   phone Std  flat      __RS_D__            __RS_T__     2         quality's    no
//   Realistic   phone High rough     __RH_D__            __RH_T__     6         quality's    no
//
// "flat" is the one-step shading the view has always used (the cheapest a lit
// surface can be). "3 steps" costs about the same per pixel. "rough" is the
// costly one (roughness, the sky's light), so a phone only gets it at High.
// A "picture" is a small texture made from arithmetic: the tile's shadow, the
// shading steps, the corner shade, and the four surface grains
// (utils/livingModel/lookTextures.ts, 256 px square, about 0.35 MB each with
// its smaller copies). None is downloaded.
//
// WHAT A PHONE AT STANDARD GIVES UP. In Game Style: the three-step shading (it
// keeps the dark lines, the lids, the tile and the colours, so it is still
// plainly Game Style). In Realistic: the rough and smooth surfaces, the four
// grains and the sky's light (it keeps the materials' colours, the sun, the
// corner shade, the vanishing point and the stage band). No phone makes the
// sky dome: that needs a kind of drawing target a phone's surface may not have.
//
// NEITHER LOOK SAYS HOW RIGHT THE MODEL IS. Both draw the same schematic. The
// two lines every view carries (HonestyLines) stay under both. The grains and
// the tile are generic and no view says they are the job's own.
//
// NOTHING HERE MOVES. A look is a way of drawing one still picture. The views
// draw again only when a person turns the model, scrubs the replay or picks a
// look.
//
// scripts/validate-living-model-looks.ts runs every function here, and the
// scene builder with each look, with planted breaks.
import type { LivingModelPalette, PaletteMode } from './palette';
import { MATERIALS } from './palette';
import type { Phone3DQuality } from './phoneViewCore';
import type { RoomStage } from './stageCore';

/** The looks, in the order the switch shows them. */
export const MODEL_LOOKS = ['realistic', 'game'] as const;
export type ModelLook = (typeof MODEL_LOOKS)[number];

/** What a device that has never chosen sees. Game Style: it reads at a glance at any size, and it costs a phone the least. */
export const DEFAULT_MODEL_LOOK: ModelLook = 'game';

/** The English names on the switch (Title Case). hooks/useLivingModelCopy.ts carries the same words through the catalog. */
export const MODEL_LOOK_LABELS: Readonly<Record<ModelLook, string>> = { realistic: 'Realistic', game: 'Game Style' };

/**
 * Where the choice is kept on the device. One key for the device, not one per job: a look is how a person likes to
 * see every model. It is under `mageid_`, so the sweep at a change of account covers it (utils/localCacheKeys.ts);
 * the next person on a shared device starts from the default.
 */
export const MODEL_LOOK_STORAGE_KEY = 'mageid_living_model_look';

export const isModelLook = (v: unknown): v is ModelLook => typeof v === 'string' && (MODEL_LOOKS as readonly string[]).includes(v);
/** What was stored, read back. Anything that is not a look is the default. */
export const readModelLook = (stored: unknown): ModelLook => (isModelLook(stored) ? stored : DEFAULT_MODEL_LOOK);

/** Everything the 3D view draws that has a surface of its own. */
export const LOOK_ELEMENTS = [
  'ground', 'plinth', 'shell', 'wallOld', 'wallBoard', 'wallFinished', 'stud', 'pipes', 'wire', 'insulation', 'trim', 'glass', 'floorOld', 'floorSub', 'floorFinished',
] as const;
export type LookElement = (typeof LOOK_ELEMENTS)[number];

/** Every stage a room can be at (utils/livingModel/stageCore.RoomStage). */
export const LOOK_STAGES: readonly RoomStage[] = ['no_tasks', 'not_started', 'demolition', 'framing', 'rough_in', 'insulation', 'drywall', 'finishes', 'other', 'done'];
/** A room with nothing ticked, or not started, keeps a plain floor in both looks: its label carries the stage. */
export const PLAIN_FLOOR_STAGES: readonly RoomStage[] = ['no_tasks', 'not_started'];

/** The ground is the page itself in both looks, so it has no surface of its own. */
export type SurfacedElement = Exclude<LookElement, 'ground'>;

export interface Surface {
  /** 0 is a mirror, 1 is chalk. */
  roughness: number;
  /** 0 for everything that is not bare metal. */
  metalness: number;
}

/**
 * How rough each material is in Realistic. Nothing here is metal: the pipes are drawn as plastic supply and drain
 * lines and the wire as sheathed cable.
 */
export const REALISTIC_SURFACES: Readonly<Record<SurfacedElement, Surface>> = {
  plinth: { roughness: 0.94, metalness: 0 },
  shell: { roughness: 0.92, metalness: 0 },
  wallOld: { roughness: 0.9, metalness: 0 },
  wallBoard: { roughness: 0.95, metalness: 0 },
  wallFinished: { roughness: 0.78, metalness: 0 },
  stud: { roughness: 0.82, metalness: 0 },
  pipes: { roughness: 0.42, metalness: 0.05 },
  wire: { roughness: 0.5, metalness: 0 },
  insulation: { roughness: 1, metalness: 0 },
  trim: { roughness: 0.5, metalness: 0 },
  glass: { roughness: 0.05, metalness: 0 },
  floorOld: { roughness: 0.88, metalness: 0 },
  floorSub: { roughness: 0.92, metalness: 0 },
  floorFinished: { roughness: 0.38, metalness: 0 },
};

/** The colours a look draws its materials and lights in. */
interface LookColours {
  plinth: string; shell: string; wallOld: string; wallBoard: string; wallFinished: string; stud: string; wire: string;
  insulation: string; trim: string; glass: string; floorOld: string; floorSub: string; floorFinished: string;
  pipeCold: string; pipeHot: string; pipeDrain: string; sky: string; sun: string;
  /** The patch of shadow on the ground under the model. */
  contact: string;
  skyStrength: number; sunStrength: number;
  contactOpacity: number; floorTint: number;
  /** How dark the model's own shadow is where it falls on the ground, 0 to 1. */
  groundShadow: number;
}

interface RealisticColours extends LookColours {
  /** The sky dome that lights the model on the web: straight up, at the horizon, and the ground's bounce. */
  envZenith: string; envHorizon: string; envGround: string;
  /** The two strengths when the sky dome is also lighting the model (the web). */
  skyStrengthWithEnv: number; sunStrengthWithEnv: number; envStrength: number;
  exposure: number;
  /** How dark the shade in a corner is, 0 to 1. */
  wallShade: number;
}

interface GameColours extends LookColours {
  /** The dark line round the walls and the tile, and the lid on every wall. */
  ink: string;
}

/**
 * THE REALISTIC TABLE. The colours of the materials themselves, once for a light page and once for a dark one. The
 * stage colours are NOT here: both looks use the palette's own (palette.stage), so a stage is one colour on the
 * label, the legend, the flat plan, Game Style's floor and Realistic's band.
 */
export const REALISTIC_COLOURS: Readonly<Record<PaletteMode, RealisticColours>> = {
  light: {
    plinth: '#A19F98',
    shell: '#B9B1A1',
    wallOld: '#D6CDBB',
    wallBoard: '#E2E0D9',
    wallFinished: '#F6F3EC',
    stud: '#D6A866',
    wire: '#D8A82E',
    insulation: '#E3A9A0',
    trim: '#FAF8F2',
    glass: '#A9CFDD',
    floorOld: '#9C9184',
    floorSub: '#CDB58A',
    floorFinished: '#C2955C',
    pipeCold: '#3D7CAB',
    pipeHot: '#B4533D',
    pipeDrain: '#687276',
    sky: '#DCE8F5',
    sun: '#FFE9CC',
    envZenith: '#A9C6E8',
    envHorizon: '#F4F1E8',
    envGround: '#A39E8E',
    contact: '#1C211D',
    skyStrength: 1.5,
    sunStrength: 2.6,
    skyStrengthWithEnv: 0.25,
    sunStrengthWithEnv: 3.4,
    envStrength: 0.42,
    exposure: 0.86,
    contactOpacity: 0.36,
    groundShadow: 0.4,
    floorTint: 0,
    wallShade: 0.5,
  },
  dark: {
    plinth: '#4A4D47',
    shell: '#5F5F56',
    wallOld: '#7D7667',
    wallBoard: '#9A9990',
    wallFinished: '#C4C0B5',
    stud: '#B08E5A',
    wire: '#C79B2E',
    insulation: '#B88679',
    trim: '#D3D0C5',
    glass: '#6A93A6',
    floorOld: '#625B4E',
    floorSub: '#8C7E64',
    floorFinished: '#96703C',
    pipeCold: '#4A8DBC',
    pipeHot: '#C4634B',
    pipeDrain: '#84909A',
    sky: '#AFC0D4',
    sun: '#FFDDB0',
    envZenith: '#5C7088',
    envHorizon: '#8D8E86',
    envGround: '#3A3C36',
    contact: '#020302',
    skyStrength: 1.7,
    sunStrength: 2.9,
    skyStrengthWithEnv: 0.8,
    sunStrengthWithEnv: 3.2,
    envStrength: 0.8,
    exposure: 1,
    contactOpacity: 0.5,
    groundShadow: 0.5,
    floorTint: 0,
    wallShade: 0.42,
  },
};

/**
 * THE GAME STYLE TABLE. Bold, clean colours: white walls, orange timber, a pale tile. The floors are filled with the
 * stage colour (palette.stage) nearly all the way (`floorTint`), so a room is its stage's colour.
 */
export const GAME_COLOURS: Readonly<Record<PaletteMode, GameColours>> = {
  light: {
    plinth: '#FBF9F2',
    shell: '#E7DFCB',
    wallOld: '#D8CCB2',
    wallBoard: '#F3F0E6',
    wallFinished: '#FFFFFF',
    stud: '#F0A63E',
    wire: '#FFC400',
    insulation: '#FF9DB1',
    trim: '#FFFFFF',
    glass: '#6CCFF0',
    floorOld: '#DAD5C8',
    floorSub: '#EAD9B0',
    floorFinished: '#E2B273',
    pipeCold: '#1E88E5',
    pipeHot: '#E5483A',
    pipeDrain: '#56636B',
    sky: '#FFFFFF',
    sun: '#FFFFFF',
    contact: '#1F2A24',
    ink: '#1F2A24',
    skyStrength: 2.3,
    sunStrength: 1.5,
    contactOpacity: 0.24,
    groundShadow: 0.2,
    floorTint: 0.9,
  },
  dark: {
    plinth: '#3D453F',
    shell: '#6B6F66',
    wallOld: '#867F6E',
    wallBoard: '#BCBAB0',
    wallFinished: '#DDDAD0',
    stud: '#DB9638',
    wire: '#F2B90F',
    insulation: '#E88BA0',
    trim: '#E8E5DC',
    glass: '#58B4D6',
    floorOld: '#716B5D',
    floorSub: '#95886D',
    floorFinished: '#B28C54',
    pipeCold: '#4C9AD0',
    pipeHot: '#E0604A',
    pipeDrain: '#8A98A0',
    sky: '#E6ECE6',
    sun: '#FFF4E0',
    contact: '#000000',
    ink: '#080B09',
    skyStrength: 1.7,
    sunStrength: 1.3,
    contactOpacity: 0.5,
    groundShadow: 0.45,
    floorTint: 0.88,
  },
};

/** What a look is allowed to spend on one device. */
export interface LookCost {
  /** 'flat': one step of light per face, the cheapest. 'toon': three steps, about the same price. 'surface': rough and smooth, the costly one. */
  shading: 'flat' | 'toon' | 'surface';
  /** The sun casts shadows. Their size is the caller's (the web's 2048, or PHONE_3D_QUALITY's). */
  shadows: boolean;
  /** The sky dome lights the model as well as the two lamps. The web only. */
  skyDome: boolean;
  /** The soft patch of shadow on the ground under the model. One flat shape and one small picture, no shadow map. */
  groundPatch: boolean;
  /** The four surface grains (boards, sheets, slab, plaster). Realistic only. */
  textures: boolean;
  /** The dark line round the walls and the tile, and the dark lid on every wall. Game Style only. A few boxes per wall. */
  outlines: boolean;
  /** The shade on the floor where a wall meets it. Realistic only. One flat strip per wall and one small picture. */
  wallShade: boolean;
}

export type LookDevice = 'web' | 'phone';
export const LOOK_TIERS = ['web', 'phoneStandard', 'phoneHigh'] as const;
export type LookTier = (typeof LOOK_TIERS)[number];
export const lookTier = (device: LookDevice, quality: Phone3DQuality = 'standard'): LookTier => (device === 'web' ? 'web' : quality === 'high' ? 'phoneHigh' : 'phoneStandard');

/**
 * THE COST TABLE. What each look spends on each kind of device. The figures at the top of this file are what these
 * switches come to on the seven-room test job.
 */
export const LOOK_COST_TABLE: Readonly<Record<ModelLook, Readonly<Record<LookTier, LookCost>>>> = {
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

/** The cost of a look on a device. A phone at Standard draws either look with the flat shading: choosing a look cannot be what slows a phone down. */
export function lookCost(look: ModelLook, device: LookDevice, quality: Phone3DQuality = 'standard'): LookCost {
  return LOOK_COST_TABLE[look === 'realistic' ? 'realistic' : 'game'][lookTier(device, quality)];
}

/** How a look builds the walls. The rooms and their openings are the model's in both; these are only how thick the pencil is. */
export interface LookBuild {
  /** How thick a wall is drawn, in metres. */
  wallT: number;
  /** Half the width of a stud, and the gap from one stud to the next. */
  studHalf: number;
  studGap: number;
}

/** Realistic: a 4.5 inch wall, 1.5 inch studs 16 inches apart. Game Style: a chunky wall with a few fat studs. */
export const LOOK_BUILD: Readonly<Record<ModelLook, LookBuild>> = {
  realistic: { wallT: 0.11, studHalf: 0.019, studGap: 0.406 },
  game: { wallT: 0.17, studHalf: 0.04, studGap: 0.61 },
};

/** What the scene builder needs beyond colours to draw a look. */
export interface LookFinish {
  look: ModelLook;
  cost: LookCost;
  build: LookBuild;
  /** 'level': no vanishing point (Game Style). 'lens': a vanishing point (Realistic). */
  camera: 'level' | 'lens';
  /** The lens's angle of view, top to bottom, in degrees. */
  fovDeg: number;
  /** The home view is drawn at this share of the fitted size: a lens draws near walls larger than far ones, and the tile needs room. */
  fit: number;
  /** How high the sun stands, as a share of straight overhead. Lower, and the walls throw a shadow that can be seen. */
  sunLift: number;
  /** A film curve on the picture, and how bright it is developed. Game Style has none: its colours are drawn as written. */
  film: boolean;
  exposure: number;
  /** How rough each surface is (used when cost.shading is 'surface'). */
  surfaces: Readonly<Record<SurfacedElement, Surface>>;
  /** The steps of light a face is shaded in, darkest first (used when cost.shading is 'toon'). */
  toonSteps: readonly number[];
  glassOpacity: number;
  /** The dark line and lid (Game Style): its colour and how wide the line is, in metres. null: none. */
  ink: { color: string; widthM: number } | null;
  /** What the model stands on: how far it reaches past the walls, how round its corners are and how thick it is. */
  tile: { padM: number; radiusM: number; heightM: number };
  /** The band of stage colour round a room's floor (Realistic). null: the floor itself is filled with the colour. */
  band: { widthM: number } | null;
  /** The sky dome (used when cost.skyDome). */
  env: { zenith: string; horizon: string; ground: string; strength: number } | null;
  /** The patch of shadow on the ground (used when cost.groundPatch): how far it spreads and how far it is pushed away from the sun. */
  contact: { color: string; opacity: number; spreadM: number; shiftM: number };
  /** The shade where a wall meets the floor (used when cost.wallShade). */
  wallShade: { widthM: number; opacity: number } | null;
  /** The ground is the page itself and takes only the model's shadow, this dark (0 to 1). */
  groundShadow: number;
}

export const REALISTIC_FOV_DEG = 40;
export const REALISTIC_FIT = 0.88;
export const REALISTIC_SUN_LIFT = 0.64;
export const REALISTIC_GLASS_OPACITY = 0.3;
export const STAGE_BAND_WIDTH_M = 0.16;
export const WALL_SHADE_WIDTH_M = 0.7;
export const CONTACT_SPREAD_M = 1.6;
export const GAME_FIT = 0.88;
export const GAME_INK_WIDTH_M = 0.035;
export const GAME_TOON_STEPS = [0.62, 0.62, 0.84, 1] as const;
export const GAME_TILE = { padM: 0.9, radiusM: 0.7, heightM: 0.3 } as const;
export const REALISTIC_SLAB = { padM: 0.35, radiusM: 0, heightM: 0.2 } as const;
/** The glass in Game Style. */
export const GAME_GLASS_OPACITY = 0.62;

const MATERIAL_KEYS = ['plinth', 'shell', 'wallOld', 'wallBoard', 'wallFinished', 'stud', 'wire', 'insulation', 'trim', 'glass', 'floorOld', 'floorSub', 'floorFinished', 'pipeCold', 'pipeHot', 'pipeDrain', 'sky', 'sun'] as const;

/**
 * The palette a look draws with: the theme's own colours (ground, ink, accent, Done, every stage colour) with the
 * look's materials and lights, and a `finish` the scene builder reads. A palette that already carries the finish of
 * the look asked for is handed back as it is.
 */
export function lookPalette(base: LivingModelPalette, look: ModelLook, cost: LookCost = lookCost(look, 'web')): LivingModelPalette {
  const realistic = look === 'realistic';
  const R = REALISTIC_COLOURS[base.mode];
  const G = GAME_COLOURS[base.mode];
  const T: LookColours = realistic ? R : G;
  const out: LivingModelPalette = { ...base };
  for (const k of MATERIAL_KEYS) out[k] = T[k];
  out.skyStrength = realistic && cost.skyDome ? R.skyStrengthWithEnv : T.skyStrength;
  out.sunStrength = realistic && cost.skyDome ? R.sunStrengthWithEnv : T.sunStrength;
  out.floorTint = T.floorTint;
  out.finish = realistic
    ? {
      look: 'realistic',
      cost,
      build: LOOK_BUILD.realistic,
      camera: 'lens',
      fovDeg: REALISTIC_FOV_DEG,
      fit: REALISTIC_FIT,
      sunLift: REALISTIC_SUN_LIFT,
      film: true,
      exposure: R.exposure,
      surfaces: REALISTIC_SURFACES,
      toonSteps: GAME_TOON_STEPS,
      glassOpacity: REALISTIC_GLASS_OPACITY,
      ink: null,
      tile: REALISTIC_SLAB,
      band: { widthM: STAGE_BAND_WIDTH_M },
      env: { zenith: R.envZenith, horizon: R.envHorizon, ground: R.envGround, strength: R.envStrength },
      contact: { color: R.contact, opacity: R.contactOpacity, spreadM: CONTACT_SPREAD_M, shiftM: 0 },
      wallShade: { widthM: WALL_SHADE_WIDTH_M, opacity: R.wallShade },
      groundShadow: R.groundShadow,
    }
    : {
      look: 'game',
      cost,
      build: LOOK_BUILD.game,
      camera: 'level',
      fovDeg: REALISTIC_FOV_DEG,
      fit: GAME_FIT,
      sunLift: 1,
      film: false,
      exposure: 1,
      surfaces: REALISTIC_SURFACES,
      toonSteps: GAME_TOON_STEPS,
      glassOpacity: GAME_GLASS_OPACITY,
      ink: { color: G.ink, widthM: GAME_INK_WIDTH_M },
      tile: GAME_TILE,
      band: null,
      env: null,
      contact: { color: G.contact, opacity: G.contactOpacity, spreadM: CONTACT_SPREAD_M, shiftM: 0.5 },
      wallShade: null,
      groundShadow: G.groundShadow,
    };
  return out;
}

export interface ElementAppearance {
  /** The colours the element is drawn in. The pipes have three (cold, hot, drain); the ground is the page's own colour, from the theme. */
  colours: readonly string[];
  shading: 'flat' | 'toon' | 'surface';
  roughness: number | null;
  metalness: number | null;
  /** 1 for everything but the glass. */
  opacity: number;
}

/**
 * How one element looks in one look, on a light or a dark page. Every element has an answer in both looks; the
 * validator walks the whole table. `ground` is the page's colour and comes from the theme, so it is passed in.
 */
export function elementAppearance(look: ModelLook, element: LookElement, mode: PaletteMode, pageColour: string, cost: LookCost = lookCost(look, 'web')): ElementAppearance {
  const realistic = look === 'realistic';
  const T = (realistic ? REALISTIC_COLOURS[mode] : GAME_COLOURS[mode]) as unknown as Record<string, string | number>;
  const colours: string[] = element === 'ground' ? [pageColour]
    : element === 'pipes' ? [String(T.pipeCold), String(T.pipeHot), String(T.pipeDrain)]
    : [String(T[element])];
  const surface = cost.shading === 'surface' && element !== 'ground' ? REALISTIC_SURFACES[element] : null;
  return {
    colours,
    shading: cost.shading,
    roughness: surface ? surface.roughness : null,
    metalness: surface ? surface.metalness : null,
    opacity: element === 'glass' ? (realistic ? REALISTIC_GLASS_OPACITY : GAME_GLASS_OPACITY) : 1,
  };
}

export interface StageAppearance {
  /** The stage's colour: the palette's own, the same in both looks. */
  colour: string;
  /** How far the room's floor is filled with that colour, 0 to 1. 0 leaves the floor its material. */
  floorTint: number;
  /** A band of the colour is drawn round the floor's edge. */
  band: boolean;
}

/**
 * How one stage shows on a room in one look. Game Style fills the floor with the stage colour. Realistic leaves the
 * floor its material and draws the band. A room with nothing ticked or not started has a plain floor in both.
 */
export function stageAppearance(look: ModelLook, stage: RoomStage, palette: LivingModelPalette): StageAppearance {
  const colour = palette.stage[stage];
  if (PLAIN_FLOOR_STAGES.includes(stage)) return { colour, floorTint: 0, band: false };
  if (look === 'realistic') return { colour, floorTint: REALISTIC_COLOURS[palette.mode].floorTint, band: true };
  return { colour, floorTint: GAME_COLOURS[palette.mode].floorTint, band: false };
}

/** Which of Realistic's floor materials a room in a stage stands on: the worn floor before work opens it, the subfloor while the walls are open, the new floor at the end. */
export function realisticFloorFor(stage: RoomStage): 'floorOld' | 'floorSub' | 'floorFinished' {
  if (stage === 'finishes' || stage === 'done') return 'floorFinished';
  if (stage === 'no_tasks' || stage === 'not_started' || stage === 'other') return 'floorOld';
  return 'floorSub';
}

/** sRGB '#rrggbb' to CIE L*a*b* (D65). */
export function hexToLab(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0x808080;
  const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const r = lin((n >> 16) & 255);
  const g = lin((n >> 8) & 255);
  const b = lin(n & 255);
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** How far apart two colours look (CIE76). About 2 is the least a careful eye can see side by side; 20 and up is plain at a glance. */
export function colourGap(a: string, b: string): number {
  const p = hexToLab(a);
  const q = hexToLab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** A stage's band must stand this far from the floor it lies on, and from every other stage's band, to be told at a glance. */
export const BAND_MIN_GAP_FROM_FLOOR = 25;
export const BAND_MIN_GAP_BETWEEN_STAGES = 14;
