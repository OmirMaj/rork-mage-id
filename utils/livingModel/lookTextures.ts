// utils/livingModel/lookTextures.ts — the Realistic look's surface pictures, made from arithmetic (pure).
//
// No picture is downloaded and none is shipped: each one is worked out here as
// plain bytes when a scene is made, from a fixed seed, so it is the same on
// every device and in every test. No React, no 3D library, no canvas, no
// storage. components/livingModel/threeScene.ts wraps the bytes in a texture
// where utils/livingModel/looks.lookCost allows pictures at all (the web, and a
// phone at High).
//
// EACH PICTURE IS A LIGHT GREY PATTERN, near white. The material's own colour
// (utils/livingModel/looks.REALISTIC_COLOURS) multiplies it, so one picture of
// boards serves the worn floor and the new one, and the colour tables stay the
// one place a colour is written.
//
// EACH ONE TILES: its left edge meets its right and its top meets its bottom.
//
// These are generic finishes. They are not the job's real materials and no view
// says they are.

export const LOOK_TEXTURES = ['boards', 'sheet', 'slab', 'plaster'] as const;
export type LookTexture = (typeof LOOK_TEXTURES)[number];

/** Each picture is this many pixels square (a power of two, so every device can shrink it cleanly). */
export const LOOK_TEXTURE_SIZE = 256;

/** How many metres one picture covers on a surface. Boards are 0.2 m wide at eight to the picture; a sheet is 1.2 m wide at two. */
export const LOOK_TEXTURE_SPAN_M: Readonly<Record<LookTexture, number>> = { boards: 1.6, sheet: 2.4, slab: 2, plaster: 1.5 };

/** A small fixed-seed generator (mulberry32). The same numbers every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth noise on a grid of `cellsX` by `cellsY` that wraps at both edges. 0 to 1. */
function wrapNoise(seed: number, cellsX: number, cellsY: number): (u: number, v: number) => number {
  const r = seeded(seed);
  const g: number[] = [];
  for (let i = 0; i < cellsX * cellsY; i++) g.push(r());
  const at = (x: number, y: number) => g[(((y % cellsY) + cellsY) % cellsY) * cellsX + (((x % cellsX) + cellsX) % cellsX)];
  const s = (t: number) => t * t * (3 - 2 * t);
  return (u, v) => {
    const x = u * cellsX;
    const y = v * cellsY;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = s(x - x0);
    const fy = s(y - y0);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
    return a + (b - a) * fy;
  };
}

/**
 * One picture as RGBA bytes, `size` by `size`. Grey (r = g = b), from about 0.6 to 1, opaque.
 *
 *   boards   floor boards running along u: eight to the picture, each its own shade, a dark seam between, joints staggered
 *   sheet    subfloor sheets: a long soft grain, a seam down the middle and round the edge
 *   slab     a poured slab: fine speckle and a few darker pores
 *   plaster  a painted wall: almost flat, a faint mottle
 */
export function lookTexturePixels(kind: LookTexture, size: number = LOOK_TEXTURE_SIZE): Uint8Array {
  const N = Math.max(8, Math.round(size));
  const px = new Uint8Array(N * N * 4);
  const rnd = seeded(kind === 'boards' ? 11 : kind === 'sheet' ? 23 : kind === 'slab' ? 37 : 53);
  const fine = wrapNoise(101, 64, 64);
  const grain = wrapNoise(202, 6, 96);
  const cloud = wrapNoise(303, 5, 5);
  const ROWS = 8;
  const shade: number[] = [];
  const joint: number[] = [];
  for (let i = 0; i < ROWS; i++) { shade.push(0.86 + rnd() * 0.14); joint.push(rnd()); }
  const pores: { x: number; y: number }[] = [];
  for (let i = 0; i < 90; i++) pores.push({ x: Math.floor(rnd() * N), y: Math.floor(rnd() * N) });
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const u = i / N;
      const v = j / N;
      let k = 1;
      if (kind === 'boards') {
        const row = Math.min(ROWS - 1, Math.floor(v * ROWS));
        const inRow = v * ROWS - row;
        // Two boards to a row, the joint somewhere along it.
        const second = ((u - joint[row]) % 1 + 1) % 1 > 0.5;
        k = shade[row] * (second ? 0.94 : 1) * (0.93 + grain(u, v) * 0.07);
        const seam = inRow < 0.05 || inRow > 0.97;
        const butt = Math.abs((((u - joint[row]) % 0.5) + 0.5) % 0.5) < 1.2 / N;
        if (seam || butt) k *= 0.62;
      } else if (kind === 'sheet') {
        k = 0.86 + grain(v, u) * 0.1 + cloud(u, v) * 0.04;
        if (i < 1 || j < 1 || Math.abs(i - N / 2) < 1) k *= 0.7;
      } else if (kind === 'slab') {
        k = 0.84 + fine(u, v) * 0.1 + cloud(u, v) * 0.06;
      } else {
        k = 0.955 + fine(u, v) * 0.03 + cloud(u, v) * 0.015;
      }
      const b = Math.max(0, Math.min(255, Math.round(k * 255)));
      const o = (j * N + i) * 4;
      px[o] = b; px[o + 1] = b; px[o + 2] = b; px[o + 3] = 255;
    }
  }
  if (kind === 'slab') for (const p of pores) { const o = (p.y * N + p.x) * 4; const b = Math.round(px[o] * 0.78); px[o] = b; px[o + 1] = b; px[o + 2] = b; }
  return px;
}

/** The steps of light a Game Style surface is shaded in, darkest first, as RGBA bytes one pixel tall. A face is one of these and nothing between. */
export function toonRampPixels(steps: readonly number[]): Uint8Array {
  const px = new Uint8Array(steps.length * 4);
  steps.forEach((s, i) => { const b = Math.max(0, Math.min(255, Math.round((Number.isFinite(s) ? s : 1) * 255))); px[i * 4] = b; px[i * 4 + 1] = b; px[i * 4 + 2] = b; px[i * 4 + 3] = 255; });
  return px;
}

/** A soft edge as RGBA bytes one pixel tall: white, opaque at the first pixel and clear at the last, easing out. The shade where a wall meets a floor. */
export function fadePixels(n: number = 16): Uint8Array {
  const N = Math.max(2, Math.round(n));
  const px = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) { const k = 1 - i / (N - 1); px[i * 4] = 255; px[i * 4 + 1] = 255; px[i * 4 + 2] = 255; px[i * 4 + 3] = Math.round(255 * k * k); }
  return px;
}
