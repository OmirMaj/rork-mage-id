// utils/livingModel/palette.ts — the colours of the Living Model, in one place.
//
// The app's own tokens come from the theme object handed in (accent, concrete
// background, ink, teal for done). The rest are the colours of building
// materials in a schematic (stud timber, copper wire, batts, board), which the
// theme has no tokens for. They live here so no React component writes a
// colour, and the three.js materials take theirs from this object.
import type { ThemeColors } from '@/constants/colors';
import type { LookFinish } from './looks';
import type { RoomStage } from './stageCore';

export type PaletteMode = 'light' | 'dark';

export interface LivingModelPalette {
  mode: PaletteMode;
  ground: string;
  plinth: string;
  /** The far face of a wall. */
  shell: string;
  ink: string;
  accent: string;
  done: string;
  /** The light from the sky and the light from the sun. */
  sky: string;
  sun: string;
  /** How strong those two lights are. A dark scene is lit less, so pale walls do not glare. */
  skyStrength: number;
  sunStrength: number;
  /** The base a per-corner colour multiplies (pipes carry their own colours). */
  vertexBase: string;
  /** The wall that was there before any work. */
  wallOld: string;
  /** New drywall. */
  wallBoard: string;
  /** Wall colour once finishes are done. */
  wallFinished: string;
  stud: string;
  wire: string;
  insulation: string;
  trim: string;
  glass: string;
  floorOld: string;
  floorSub: string;
  floorFinished: string;
  pipeCold: string;
  pipeHot: string;
  pipeDrain: string;
  /** One colour per stage, for the floors, the flat plan, the legend and the scrubber. */
  stage: Record<RoomStage, string>;
  /** How far a room's floor is tinted toward its stage colour, 0 to 1. */
  floorTint: number;
  /**
   * Set by utils/livingModel/looks.lookPalette: how the scene is to be built, shaded, lit and framed for one of the two
   * looks. A palette without one (the palette this file makes) is drawn as Game Style: the scene builder asks looks.ts
   * for that look's palette itself.
   */
  finish?: LookFinish;
}

interface Materials {
  plinth: string; shell: string; wallOld: string; wallBoard: string; wallFinished: string; stud: string; wire: string;
  insulation: string; trim: string; glass: string; floorOld: string; floorSub: string; floorFinished: string;
  pipeCold: string; pipeHot: string; pipeDrain: string; sky: string; sun: string; vertexBase: string;
  stageDemolition: string; stageFraming: string; stageRoughIn: string; stageInsulation: string; stageDrywall: string; stageOther: string;
  skyStrength: number; sunStrength: number; floorTint: number;
}

/**
 * THE TABLE. The colours of building materials in a schematic, once for a
 * light screen and once for a dark one. The theme picks which
 * (`livingModelPalette(colors, mode)`); the ground, the ink, the accent and
 * the Done colour come from the theme itself in both.
 *
 * THE STAGE COLOURS ARE BOLD AND FAR APART (rust, amber, blue, pink, lilac,
 * slate, with the theme's green for Finishes and its teal for Done), so a
 * stage is told by its colour on a label, in the legend, on the flat plan, on
 * a Game Style floor and on a Realistic band alike.
 * scripts/validate-living-model-looks.ts measures the gaps.
 *
 * DARK: the same materials at a lower light, so the model sits on a dark page
 * without glaring, and the stage colours are lifted a step so they still read
 * against it.
 */
export const MATERIALS: Readonly<Record<PaletteMode, Materials>> = {
  light: {
    plinth: '#C2C5BE',
    shell: '#D3D0C7',
    wallOld: '#CDC5B4',
    wallBoard: '#E9E7E0',
    wallFinished: '#F6F4EE',
    stud: '#DDB878',
    wire: '#E2A019',
    insulation: '#E4B4A6',
    trim: '#FBFAF6',
    glass: '#A8C8D8',
    floorOld: '#B9AE98',
    floorSub: '#DCCDAE',
    floorFinished: '#C9A26B',
    pipeCold: '#2E7FB8',
    pipeHot: '#C4543A',
    pipeDrain: '#5C6B73',
    sky: '#FFFFFF',
    sun: '#FFFFFF',
    vertexBase: '#FFFFFF',
    stageDemolition: '#B5533C',
    stageFraming: '#E0A12E',
    stageRoughIn: '#2E7FB8',
    stageInsulation: '#E58AA0',
    stageDrywall: '#9B8FC9',
    stageOther: '#5E6A7D',
    skyStrength: 2.2,
    sunStrength: 1.0,
    floorTint: 0.62,
  },
  dark: {
    plinth: '#3A3F3B',
    shell: '#565A55',
    wallOld: '#7A7466',
    wallBoard: '#A9A79F',
    wallFinished: '#C9C6BC',
    stud: '#B8935A',
    wire: '#E2A019',
    insulation: '#C48E80',
    trim: '#D9D6CC',
    glass: '#6E98AC',
    floorOld: '#6B6455',
    floorSub: '#8E8168',
    floorFinished: '#A07E4E',
    pipeCold: '#4C9AD0',
    pipeHot: '#D8694E',
    pipeDrain: '#8A98A0',
    sky: '#DDE3DD',
    sun: '#FFF4E0',
    vertexBase: '#FFFFFF',
    stageDemolition: '#D0705A',
    stageFraming: '#EDB54A',
    stageRoughIn: '#4C9AD0',
    stageInsulation: '#F0A0B4',
    stageDrywall: '#B3A8DD',
    stageOther: '#8090A6',
    skyStrength: 1.5,
    sunStrength: 0.8,
    floorTint: 0.6,
  },
};

/** Which table a theme asks for, from how dark its page is. The theme decides; nothing here reads the device. */
export function paletteModeOf(t: Pick<ThemeColors, 'bg'>): PaletteMode {
  const [r, g, b] = hexToRgb(t.bg);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.4 ? 'dark' : 'light';
}

export function livingModelPalette(t: ThemeColors, mode: PaletteMode = paletteModeOf(t)): LivingModelPalette {
  const M = MATERIALS[mode];
  return {
    mode,
    ground: t.bg,
    plinth: M.plinth,
    shell: M.shell,
    ink: t.text,
    accent: t.accent,
    done: t.success,
    sky: M.sky,
    sun: M.sun,
    skyStrength: M.skyStrength,
    sunStrength: M.sunStrength,
    vertexBase: M.vertexBase,
    wallOld: M.wallOld,
    wallBoard: M.wallBoard,
    wallFinished: M.wallFinished,
    stud: M.stud,
    wire: M.wire,
    insulation: M.insulation,
    trim: M.trim,
    glass: M.glass,
    floorOld: M.floorOld,
    floorSub: M.floorSub,
    floorFinished: M.floorFinished,
    pipeCold: M.pipeCold,
    pipeHot: M.pipeHot,
    pipeDrain: M.pipeDrain,
    stage: {
      no_tasks: t.surfaceAlt,
      not_started: t.surfaceAlt,
      demolition: M.stageDemolition,
      framing: M.stageFraming,
      rough_in: M.stageRoughIn,
      insulation: M.stageInsulation,
      drywall: M.stageDrywall,
      finishes: t.accent,
      other: M.stageOther,
      done: t.success,
    },
    floorTint: M.floorTint,
  };
}

/** '#RRGGBB' to three numbers from 0 to 1. Anything else reads as mid grey. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0.5, 0.5, 0.5];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** A colour part of the way from one to another, as '#rrggbb'. */
export function mixHex(a: string, b: string, k: number): string {
  const p = hexToRgb(a);
  const q = hexToRgb(b);
  const t = Math.max(0, Math.min(1, Number.isFinite(k) ? k : 0));
  const h = (i: number) => Math.round((p[i] + (q[i] - p[i]) * t) * 255).toString(16).padStart(2, '0');
  return `#${h(0)}${h(1)}${h(2)}`;
}
