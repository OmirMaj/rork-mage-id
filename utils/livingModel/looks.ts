// utils/livingModel/looks.ts — the two looks of the Living Model's 3D view.
//
// PURE: no React, no React Native, no 3D library, no storage. The scene
// builder (components/livingModel/threeScene.ts) is handed what this file
// works out, on the web and on the phone alike.
//
// TWO LOOKS, ONE MODEL. The shapes, the replay, the stage colours on the
// labels, the legend and the flat plan are the same in both. A look changes
// only how the 3D picture is lit and shaded:
//
//   Game Style   THE LOOK THE VIEW HAS ALWAYS HAD, and the default. Flat
//                shading, clean schematic colours, a level camera with no
//                vanishing point, each floor filled with its stage colour.
//                `lookPalette` hands the palette back untouched for it (the
//                very same object), so the scene builder runs the lines it
//                always ran. Nothing about it is changed by this file.
//
//   Realistic    Muted colours of the materials themselves (concrete, lumber,
//                drywall, glass, oak), rough and smooth surfaces, a warm sun
//                and a cool sky, soft shadows, a soft dark patch where the
//                slab meets the ground, and a camera with a mild vanishing
//                point. A room's stage is a light tint on its floor plus a
//                band of the stage colour round the floor's edge, so the
//                floor still looks like a floor and the stage still reads.
//
// WHAT A LOOK MAY COST (`lookCost`). The web gets all of Realistic. A phone at
// Standard quality keeps the shading it has always used, with the Realistic
// colours, light and camera, so Realistic costs it what Game Style costs plus
// one flat patch on the ground. A phone at High gets the rough and smooth
// surfaces as well. No phone gets the light from the sky dome: that needs a
// kind of drawing target a phone's surface may not have.
//
// NEITHER LOOK SAYS HOW RIGHT THE MODEL IS. Both draw the same schematic. The
// two lines every view carries (HonestyLines) stay under both.
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

/** The look the 3D view drew before there was a switch. It is kept as it was. */
export const PRE_EXISTING_LOOK: ModelLook = 'game';
/** What a device that has never chosen sees: the look it has always seen. */
export const DEFAULT_MODEL_LOOK: ModelLook = PRE_EXISTING_LOOK;

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

/** The ground is the page itself in both looks (Realistic lays only the model's shadow on it), so it has no surface of its own. */
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
  plinth: { roughness: 0.9, metalness: 0 },
  shell: { roughness: 0.92, metalness: 0 },
  wallOld: { roughness: 0.9, metalness: 0 },
  wallBoard: { roughness: 0.95, metalness: 0 },
  wallFinished: { roughness: 0.74, metalness: 0 },
  stud: { roughness: 0.82, metalness: 0 },
  pipes: { roughness: 0.42, metalness: 0.05 },
  wire: { roughness: 0.5, metalness: 0 },
  insulation: { roughness: 1, metalness: 0 },
  trim: { roughness: 0.46, metalness: 0 },
  glass: { roughness: 0.06, metalness: 0 },
  floorOld: { roughness: 0.86, metalness: 0 },
  floorSub: { roughness: 0.9, metalness: 0 },
  floorFinished: { roughness: 0.42, metalness: 0 },
};

interface RealisticColours {
  plinth: string; shell: string; wallOld: string; wallBoard: string; wallFinished: string; stud: string; wire: string;
  insulation: string; trim: string; glass: string; floorOld: string; floorSub: string; floorFinished: string;
  pipeCold: string; pipeHot: string; pipeDrain: string; sky: string; sun: string;
  /** The sky dome that lights the model on the web: straight up, at the horizon, and the ground's bounce. */
  envZenith: string; envHorizon: string; envGround: string;
  /** The soft patch where the slab meets the ground. */
  contact: string;
  skyStrength: number; sunStrength: number;
  /** The two strengths when the sky dome is also lighting the model (the web). */
  skyStrengthWithEnv: number; sunStrengthWithEnv: number; envStrength: number;
  exposure: number; contactOpacity: number; groundShadow: number; floorTint: number; bandGlow: number;
}

/**
 * THE REALISTIC TABLE. The colours of the materials themselves, a step quieter than the schematic's, once for a
 * light page and once for a dark one. The stage colours are NOT here: both looks use the palette's own
 * (palette.stage), so a stage is one colour on the label, the legend, the flat plan and the 3D floor.
 */
export const REALISTIC_COLOURS: Readonly<Record<PaletteMode, RealisticColours>> = {
  light: {
    plinth: '#ABA9A2',
    shell: '#C9C5BB',
    wallOld: '#D2C9B6',
    wallBoard: '#D8D7D0',
    wallFinished: '#F2EFE7',
    stud: '#D3B07C',
    wire: '#D3AA3C',
    insulation: '#DBAB9D',
    trim: '#F5F3ED',
    glass: '#9DBFCC',
    floorOld: '#A99C85',
    floorSub: '#CBB48B',
    floorFinished: '#B58955',
    pipeCold: '#3D7CAB',
    pipeHot: '#B4533D',
    pipeDrain: '#687276',
    sky: '#E6EEF6',
    sun: '#FFF3E4',
    envZenith: '#BFD3E8',
    envHorizon: '#F3F1EA',
    envGround: '#9C9889',
    contact: '#1C211D',
    skyStrength: 1.4,
    sunStrength: 2.4,
    skyStrengthWithEnv: 0.5,
    sunStrengthWithEnv: 2.4,
    envStrength: 0.35,
    exposure: 1,
    contactOpacity: 0.22,
    groundShadow: 0.26,
    floorTint: 0.3,
    bandGlow: 0.35,
  },
  dark: {
    plinth: '#42463F',
    shell: '#57584F',
    wallOld: '#797263',
    wallBoard: '#8F8E86',
    wallFinished: '#BDB9AE',
    stud: '#A98A5A',
    wire: '#C79B2E',
    insulation: '#B58577',
    trim: '#CFCCC1',
    glass: '#648B9C',
    floorOld: '#655E50',
    floorSub: '#857862',
    floorFinished: '#96733F',
    pipeCold: '#4A8DBC',
    pipeHot: '#C4634B',
    pipeDrain: '#84909A',
    sky: '#B9C6D4',
    sun: '#FFE6C4',
    envZenith: '#66788C',
    envHorizon: '#8D8E86',
    envGround: '#3A3C36',
    contact: '#050605',
    skyStrength: 1.9,
    sunStrength: 2.8,
    skyStrengthWithEnv: 1.0,
    sunStrengthWithEnv: 2.8,
    envStrength: 0.9,
    exposure: 1,
    contactOpacity: 0.4,
    groundShadow: 0.45,
    floorTint: 0.3,
    bandGlow: 0.3,
  },
};

/** What a look is allowed to spend on one device. Game Style spends what the view has always spent. */
export interface LookCost {
  /** Rough and smooth surfaces (the costlier shading). Off: the shading the view has always used, with the look's colours. */
  surfaces: boolean;
  /** The sun casts shadows. Their size is the caller's (the web's 2048, or PHONE_3D_QUALITY's). */
  shadows: boolean;
  /** The sky dome lights the model as well as the two lamps. The web only. */
  skyDome: boolean;
  /** The soft dark patch where the slab meets the ground. One flat shape, no shadow map. */
  groundPatch: boolean;
}

export type LookDevice = 'web' | 'phone';

/**
 * The cost of a look on a device. A phone at Standard gets Realistic at the price of Game Style: the same shading and
 * the same one shadow map, plus the ground patch. So choosing Realistic cannot be what slows a phone down.
 */
export function lookCost(look: ModelLook, device: LookDevice, quality: Phone3DQuality = 'standard'): LookCost {
  if (look !== 'realistic') return { surfaces: false, shadows: true, skyDome: false, groundPatch: false };
  if (device === 'web') return { surfaces: true, shadows: true, skyDome: true, groundPatch: true };
  return { surfaces: quality === 'high', shadows: true, skyDome: false, groundPatch: true };
}

/** What the scene builder needs beyond colours to draw Realistic. Game Style has none: its palette carries no finish. */
export interface LookFinish {
  look: 'realistic';
  cost: LookCost;
  surfaces: Readonly<Record<SurfacedElement, Surface>>;
  /** How bright the picture is developed (the film curve's exposure). */
  exposure: number;
  /** The camera's angle of view, top to bottom, in degrees. Narrow, so the vanishing point is mild. */
  fovDeg: number;
  /** The home view is pulled back by this much, since near walls draw larger than far ones. */
  fit: number;
  /** How high the sun stands, as a share of Game Style's height. Lower, so the walls throw a shadow that can be seen. */
  sunLift: number;
  glassOpacity: number;
  /** The band of stage colour round a room's floor. */
  band: { widthM: number; glow: number };
  /** The sky dome (used when cost.skyDome). */
  env: { zenith: string; horizon: string; ground: string; strength: number };
  /** The patch where the slab meets the ground (used when cost.groundPatch). */
  contact: { color: string; opacity: number; spreadM: number };
  /** How dark the model's shadow is where it falls on the ground, 0 to 1. The ground itself stays the page's colour. */
  groundShadow: number;
}

export const REALISTIC_FOV_DEG = 26;
export const REALISTIC_FIT = 0.9;
export const REALISTIC_SUN_LIFT = 0.5;
export const REALISTIC_GLASS_OPACITY = 0.34;
export const STAGE_BAND_WIDTH_M = 0.12;
export const CONTACT_SPREAD_M = 1.6;

/**
 * The palette a look draws with. Game Style: the palette handed in, the same object, untouched. Realistic: the same
 * theme colours (ground, ink, accent, Done, every stage colour) with the Realistic table's materials and lights, and
 * a `finish` the scene builder reads.
 */
export function lookPalette(base: LivingModelPalette, look: ModelLook, cost: LookCost = lookCost(look, 'web')): LivingModelPalette {
  if (look !== 'realistic') return base;
  const R = REALISTIC_COLOURS[base.mode];
  return {
    ...base,
    plinth: R.plinth,
    shell: R.shell,
    wallOld: R.wallOld,
    wallBoard: R.wallBoard,
    wallFinished: R.wallFinished,
    stud: R.stud,
    wire: R.wire,
    insulation: R.insulation,
    trim: R.trim,
    glass: R.glass,
    floorOld: R.floorOld,
    floorSub: R.floorSub,
    floorFinished: R.floorFinished,
    pipeCold: R.pipeCold,
    pipeHot: R.pipeHot,
    pipeDrain: R.pipeDrain,
    sky: R.sky,
    sun: R.sun,
    skyStrength: cost.skyDome ? R.skyStrengthWithEnv : R.skyStrength,
    sunStrength: cost.skyDome ? R.sunStrengthWithEnv : R.sunStrength,
    floorTint: R.floorTint,
    finish: {
      look: 'realistic',
      cost,
      surfaces: REALISTIC_SURFACES,
      exposure: R.exposure,
      fovDeg: REALISTIC_FOV_DEG,
      fit: REALISTIC_FIT,
      sunLift: REALISTIC_SUN_LIFT,
      glassOpacity: REALISTIC_GLASS_OPACITY,
      band: { widthM: STAGE_BAND_WIDTH_M, glow: R.bandGlow },
      env: { zenith: R.envZenith, horizon: R.envHorizon, ground: R.envGround, strength: R.envStrength },
      contact: { color: R.contact, opacity: R.contactOpacity, spreadM: CONTACT_SPREAD_M },
      groundShadow: R.groundShadow,
    },
  };
}

export interface ElementAppearance {
  /** The colours the element is drawn in. The pipes have three (cold, hot, drain); the ground is the page's own colour, from the theme. */
  colours: readonly string[];
  /** 'flat' is the shading the view has always used. 'surface' adds how rough the material is. */
  shading: 'flat' | 'surface';
  roughness: number | null;
  metalness: number | null;
  /** 1 for everything but the glass. */
  opacity: number;
}

/** The glass in Game Style, as the scene builder has always drawn it. */
export const GAME_GLASS_OPACITY = 0.55;

/**
 * How one element looks in one look, on a light or a dark page. Every element has an answer in both looks; the
 * validator walks the whole table. `ground` is the page's colour and comes from the theme, so it is passed in.
 */
export function elementAppearance(look: ModelLook, element: LookElement, mode: PaletteMode, pageColour: string, cost: LookCost = lookCost(look, 'web')): ElementAppearance {
  const realistic = look === 'realistic';
  const T: Record<string, string | number> = realistic ? (REALISTIC_COLOURS[mode] as unknown as Record<string, string | number>) : (MATERIALS[mode] as unknown as Record<string, string | number>);
  const colours: string[] = element === 'ground' ? [pageColour]
    : element === 'pipes' ? [String(T.pipeCold), String(T.pipeHot), String(T.pipeDrain)]
    : [String(T[element])];
  const surface = realistic && cost.surfaces && element !== 'ground' ? REALISTIC_SURFACES[element] : null;
  return {
    colours,
    shading: surface ? 'surface' : 'flat',
    roughness: surface ? surface.roughness : null,
    metalness: surface ? surface.metalness : null,
    opacity: element === 'glass' ? (realistic ? REALISTIC_GLASS_OPACITY : GAME_GLASS_OPACITY) : 1,
  };
}

export interface StageAppearance {
  /** The stage's colour: the palette's own, the same in both looks. */
  colour: string;
  /** How far the room's floor is tinted toward that colour, 0 to 1. 0 leaves the floor its material. */
  floorTint: number;
  /** A band of the colour is drawn round the floor's edge. */
  band: boolean;
}

/**
 * How one stage shows on a room in one look. Game Style fills the floor with the stage colour, as it always has.
 * Realistic tints the floor lightly and draws the band, so the floor keeps its material. A room with nothing ticked
 * or not started has a plain floor in both.
 */
export function stageAppearance(look: ModelLook, stage: RoomStage, palette: LivingModelPalette): StageAppearance {
  const colour = palette.stage[stage];
  if (PLAIN_FLOOR_STAGES.includes(stage)) return { colour, floorTint: 0, band: false };
  if (look === 'realistic') return { colour, floorTint: REALISTIC_COLOURS[palette.mode].floorTint, band: true };
  return { colour, floorTint: MATERIALS[palette.mode].floorTint, band: false };
}
