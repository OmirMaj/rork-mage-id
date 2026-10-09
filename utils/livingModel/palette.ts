// utils/livingModel/palette.ts — the colours of the Living Model, in one place.
//
// The app's own tokens come from the theme object handed in (accent, concrete
// background, ink, teal for done). The rest are the colours of building
// materials in a schematic (stud timber, copper wire, batts, board), which the
// theme has no tokens for. They live here so no React component writes a
// colour, and the three.js materials take theirs from this object.
import type { ThemeColors } from '@/constants/colors';
import type { RoomStage } from './stageCore';

export interface LivingModelPalette {
  ground: string;
  plinth: string;
  ink: string;
  accent: string;
  done: string;
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
  /** One colour per stage, for the flat plan, the legend and the scrubber. */
  stage: Record<RoomStage, string>;
}

const MATERIALS = {
  plinth: '#C2C5BE',
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
  stageDemolition: '#8A8D86',
  stageFraming: '#B8935A',
  stageRoughIn: '#2E7FB8',
  stageInsulation: '#D9968A',
  stageDrywall: '#A8A49A',
  stageOther: '#5E6A7D',
} as const;

export function livingModelPalette(t: ThemeColors): LivingModelPalette {
  return {
    ground: t.bg,
    plinth: MATERIALS.plinth,
    ink: t.text,
    accent: t.accent,
    done: t.success,
    wallOld: MATERIALS.wallOld,
    wallBoard: MATERIALS.wallBoard,
    wallFinished: MATERIALS.wallFinished,
    stud: MATERIALS.stud,
    wire: MATERIALS.wire,
    insulation: MATERIALS.insulation,
    trim: MATERIALS.trim,
    glass: MATERIALS.glass,
    floorOld: MATERIALS.floorOld,
    floorSub: MATERIALS.floorSub,
    floorFinished: MATERIALS.floorFinished,
    pipeCold: MATERIALS.pipeCold,
    pipeHot: MATERIALS.pipeHot,
    pipeDrain: MATERIALS.pipeDrain,
    stage: {
      no_tasks: t.surfaceAlt,
      not_started: t.surfaceAlt,
      demolition: MATERIALS.stageDemolition,
      framing: MATERIALS.stageFraming,
      rough_in: MATERIALS.stageRoughIn,
      insulation: MATERIALS.stageInsulation,
      drywall: MATERIALS.stageDrywall,
      finishes: t.accent,
      other: MATERIALS.stageOther,
      done: t.success,
    },
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
