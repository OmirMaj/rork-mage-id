/**
 * validate-level-desk.ts — "The Level" composed for laptops and monitors
 * (lane LOADERDESK, utils/levelDesk.ts).
 *
 * Run: bun run scripts/validate-level-desk.ts
 *      VALIDATE_ROOT=<a scratch copy> bun run scripts/validate-level-desk.ts   (mutation tests)
 *
 * WHY. The founder: "the loading animation is so tiny on monitor and laptop
 * screens". The fix is a wide-canvas composition (a proportional level on a
 * datum) that must NEVER leak onto the phone: every native platform at any
 * width, and the web below 768 px, renders exactly what it did. These rules
 * hold both halves:
 *
 *  A. Tiers: one pure function of (width, platform); native is always 'phone'.
 *  B. Launch sizes: the spec's sample table; markH = markW·30/438; centred;
 *     continuous at 768 / 1280 / 1920; 240 ≤ markW ≤ 640 and non-decreasing
 *     for every W 768…3840; below 768 and on native launchRect IS splashRect.
 *  C. The wordmark box per tier; its clearance over the level.
 *  D. The datum: gutters, symmetry, inner ends, the centre line, ≥ 150 px.
 *  E. Desk geometry: identical to levelGeometry ≤ 120; monotonic with a real
 *     clearance 120…240; the 160 / 200 / 240 rows; levelPartsDesk ≡ levelParts
 *     wherever the phone draws.
 *  F. Source pins (comment-stripped) in the hosts: the phone expressions are
 *     still there, the desk override is additive, no new timer / value /
 *     timing, the datum only on the desk, the wordmark style never an array.
 *  G. The pre-JS still (public/index.html): three @media width rules, nothing
 *     else, mirroring DESK_SPLASH; the CSS = launchRect at 11 screens.
 *  H. The web launch is the GREEN brand (orchestrator decision 2026-10-01):
 *     tokens only, in the pre-JS still, BrandSplash, BootShell and the web
 *     splash tone; the native splash replica is untouched. It FOLLOWS LIGHT /
 *     DARK: on a dark page (the theme-boot data-theme tag, else the OS
 *     prefers-color-scheme) every one of them paints WEB_LAUNCH_DARK
 *     (Theme.dark.bg, BRAND_ACCENT_ON_DARK, Theme.dark.text) — one
 *     @media (prefers-color-scheme: dark) block + the html[data-theme='dark']
 *     rules in the still, webLaunchScheme / webLaunchPalette(color, scheme) in
 *     JS — so a dark-mode user never cuts from a light launch to the dark app.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.env.VALIDATE_ROOT ?? join(__dirname, '..');
const D = await import(`${ROOT}/utils/levelDesk.ts`);
const L = await import(`${ROOT}/utils/levelTimeline.ts`);
const C = await import(`${ROOT}/constants/colors.ts`);

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passes++; return; }
  failures++;
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;
const read = (rel: string) => { try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; } };
/** Source with // and /* *\/ comments blanked, so prose cannot trip a rule. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}
const count = (s: string, needle: string) => s.split(needle).length - 1;
/** The balanced (…) group that starts at s[i] === '('. */
function group(s: string, i: number): string {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '(') depth++;
    else if (s[j] === ')') { depth--; if (depth === 0) return s.slice(i, j + 1); }
  }
  return s.slice(i);
}

type Rect = { s: number; imgLeft: number; imgTop: number; markLeft: number; markTop: number; markW: number; markH: number };

// ── A. Tiers ─────────────────────────────────────────────────────────────────
for (const p of ['ios', 'android']) {
  for (const w of [393, 768, 1024, 1366, 2560]) check(`A ${p} ${w} → phone (native is always the phone picture)`, D.loaderTier(w, p) === 'phone', D.loaderTier(w, p));
}
const TIERS: [number, string][] = [[320, 'phone'], [767, 'phone'], [768, 'tablet'], [1279, 'tablet'], [1280, 'laptop'], [1919, 'laptop'], [1920, 'monitor'], [3840, 'monitor']];
for (const [w, t] of TIERS) check(`A web ${w} → ${t}`, D.loaderTier(w, 'web') === t, D.loaderTier(w, 'web'));
check('A a non-finite width is the phone', D.loaderTier(Number.NaN, 'web') === 'phone');
check('A DESK_MIN_W = 768 / 1280 / 1920', D.DESK_MIN_W.tablet === 768 && D.DESK_MIN_W.laptop === 1280 && D.DESK_MIN_W.monitor === 1920);

// ── B. Launch sizes ──────────────────────────────────────────────────────────
const SPLASH = D.DESK_SPLASH;
check('B DESK_SPLASH clamp rows: 240/30vw/360, 360/28vw/480, 480/25vw/640',
  SPLASH.tablet.minPx === 240 && SPLASH.tablet.vw === 0.3 && SPLASH.tablet.maxPx === 360
  && SPLASH.laptop.minPx === 360 && SPLASH.laptop.vw === 0.28 && SPLASH.laptop.maxPx === 480
  && SPLASH.monitor.minPx === 480 && SPLASH.monitor.vw === 0.25 && SPLASH.monitor.maxPx === 640, JSON.stringify(SPLASH));
// [W, H, markW, markH, markLeft, markTop, bubbleW, bubbleH, amp] — the spec's sample table.
const SAMPLES: number[][] = [
  [768, 1024, 240.0, 16.44, 264.0, 503.78, 36.71, 14.25, 60.27],
  [1024, 768, 307.2, 21.04, 358.4, 373.48, 46.99, 18.24, 77.15],
  [1280, 800, 360.0, 24.66, 460.0, 387.67, 55.07, 21.37, 90.41],
  [1440, 900, 403.2, 27.62, 518.4, 436.19, 61.68, 23.93, 101.26],
  [1512, 982, 423.36, 29.0, 544.32, 476.5, 64.76, 25.13, 106.32],
  [1920, 1080, 480.0, 32.88, 720.0, 523.56, 73.42, 28.49, 120.55],
  [2560, 1440, 640.0, 43.84, 960.0, 698.08, 97.9, 37.99, 160.73],
  [3440, 1440, 640.0, 43.84, 1400.0, 698.08, 97.9, 37.99, 160.73],
];
for (const [W, H, mw, mh, ml, mt, bw, bh, amp] of SAMPLES) {
  const r = D.launchRect(W, H, 'web') as Rect;
  check(`B ${W}×${H}: markW ${mw} exact, markLeft ${ml} exact`, near(r.markW, mw, 1e-9) && near(r.markLeft, ml, 1e-9), `${r.markW} @ ${r.markLeft}`);
  check(`B ${W}×${H}: markH = markW·30/438 (1e-9), ≈ ${mh}`, near(r.markH, (r.markW * 30) / 438, 1e-9) && near(r.markH, mh, 0.006), String(r.markH));
  check(`B ${W}×${H}: centred on (W/2, H/2) (1e-9), markTop ≈ ${mt}`,
    near(r.markLeft + r.markW / 2, W / 2, 1e-9) && near(r.markTop + r.markH / 2, H / 2, 1e-9) && near(r.markTop, mt, 0.006), `${r.markTop}`);
  check(`B ${W}×${H}: s = markW/438`, near(r.s, r.markW / 438, 1e-12));
  const parts = L.levelParts(r.markW, 'splash');
  check(`B ${W}×${H}: bubble ${bw} × ${bh}, amp ${amp} (the splash parts scaled by s)`,
    near(parts.bubble.width, bw, 0.006) && near(parts.bubble.height, bh, 0.006) && near(parts.amp, amp, 0.006),
    `${parts.bubble.width} × ${parts.bubble.height}, ${parts.amp}`);
}
check('B 768: the desk starts where the web phone stops (launchRect(768) = splashRect(767) = 240)',
  (D.launchRect(768, 1024, 'web') as Rect).markW === 240 && L.splashRect(767, 1024, 'web').markW === 240);
for (const b of [768, 1280, 1920]) {
  const a = (D.launchRect(b - 0.001, 1024, 'web') as Rect).markW;
  const c = (D.launchRect(b, 1024, 'web') as Rect).markW;
  check(`B continuous at ${b}: |f(b − 0.001) − f(b)| < 0.01`, Math.abs(a - c) < 0.01, `${a} → ${c}`);
}
{
  let prev = 0;
  const bad: string[] = [];
  for (let W = 768; W <= 3840; W++) {
    const m = (D.launchRect(W, 900, 'web') as Rect).markW;
    if (m < 240 || m > 640) bad.push(`${W}: ${m} outside 240…640`);
    if (m < prev - 1e-9) bad.push(`${W}: ${m} < ${prev}`);
    prev = m;
  }
  check('B every integer W 768…3840 (H 900): 240 ≤ markW ≤ 640 and non-decreasing', bad.length === 0, bad.slice(0, 4).join(' | '));
}
{
  const bad: string[] = [];
  for (let W = 200; W < 768; W += 7) {
    for (const H of [480, 844, 1024]) {
      if (D.deskLaunchLayout(W, H, 'web') !== null) bad.push(`web ${W}×${H} has a desk layout`);
      if (JSON.stringify(D.launchRect(W, H, 'web')) !== JSON.stringify(L.splashRect(W, H, 'web'))) bad.push(`web ${W}×${H}`);
    }
  }
  for (const p of ['ios', 'android']) {
    for (const [W, H] of [[393, 852], [430, 932], [820, 1180], [1024, 1366], [1366, 1024], [1280, 800], [2560, 1600]]) {
      if (D.deskLaunchLayout(W, H, p) !== null) bad.push(`${p} ${W}×${H} has a desk layout`);
      if (JSON.stringify(D.launchRect(W, H, p)) !== JSON.stringify(L.splashRect(W, H, p))) bad.push(`${p} ${W}×${H}`);
    }
  }
  check('B the phone path is untouched: web < 768 and every native size → no desk layout, launchRect deep-equals splashRect', bad.length === 0, bad.slice(0, 4).join(' | '));
}

// ── C. The wordmark ──────────────────────────────────────────────────────────
const WM: [string, number, number, number, boolean][] = [['tablet', 34, 32, 3.4, false], ['laptop', 42, 40, 4.4, true], ['monitor', 42, 48, 4.4, true]];
for (const [t, h, gap, tr, large] of WM) {
  const T = (SPLASH as Record<string, { wordmarkH: number; wordmarkGap: number; tracking: number; wordmarkLarge: boolean }>)[t];
  check(`C ${t}: wordmark box ${h}, gap ${gap}, tracking ${tr}, large ${large}`,
    T.wordmarkH === h && T.wordmarkGap === gap && T.tracking === tr && T.wordmarkLarge === large, JSON.stringify(T));
}
{
  const bad: string[] = [];
  for (let W = 768; W <= 3840; W++) {
    const H = 900;
    const l = D.deskLaunchLayout(W, H, 'web');
    if (!l) { bad.push(`${W}: no layout`); continue; }
    const T = SPLASH[l.tier as 'tablet' | 'laptop' | 'monitor'];
    const b = l.wordmarkBox;
    if (!near(b.top + b.height, H / 2 - T.wordmarkGap, 1e-9) || b.height !== T.wordmarkH || b.left !== 0 || b.right !== 0) bad.push(`${W}: box ${JSON.stringify(b)}`);
    if (l.wordmarkLarge !== T.wordmarkLarge) bad.push(`${W}: large flag`);
    if (T.wordmarkGap - l.rect.markH / 2 < 16) bad.push(`${W}: clearance ${T.wordmarkGap - l.rect.markH / 2}`);
  }
  check('C every W 768…3840: box bottom = H/2 − gap, full width; gap − markH/2 ≥ 16', bad.length === 0, bad.slice(0, 4).join(' | '));
}

// ── D. The datum ─────────────────────────────────────────────────────────────
const DD = D.DESK_DATUM;
for (const [W, g] of [[768, 46], [1280, 77], [1440, 86], [1920, 115], [2560, 154], [3440, 160], [400, 32]]) {
  check(`D gutter(${W}) = ${g}`, D.deskGutter(W) === g, String(D.deskGutter(W)));
}
check('D DESK_DATUM: gap 24, line 1, tick 1 × 9, opacities 0.12 (splash) / 0.3 (theme)', DD.gapPx === 24 && DD.lineH === 1 && DD.tickH === 9
  && DD.tickW === 1 && DD.splashOpacity === 0.12 && DD.themeOpacity === 0.3 && DD.gutterVw === 0.06 && DD.gutterMin === 32 && DD.gutterMax === 160);
{
  const bad: string[] = [];
  for (let W = 768; W <= 3840; W++) {
    for (const H of [600, 900, 1440]) {
      const l = D.deskLaunchLayout(W, H, 'web');
      if (!l) { bad.push(`${W}: no layout`); continue; }
      const { left: a, right: b } = l.datum;
      const r = l.rect;
      const g = D.deskGutter(W);
      if (!near(a.left, g, 1e-9) || !near(b.left + b.width, W - g, 1e-9)) bad.push(`${W}×${H}: outer ends`);
      if (!near(a.left + a.width, r.markLeft - 24, 1e-9) || !near(b.left, r.markLeft + r.markW + 24, 1e-9)) bad.push(`${W}×${H}: inner ends`);
      if (!near(a.left + (b.left + b.width), W, 1e-9) || !near(a.width, b.width, 1e-9)) bad.push(`${W}×${H}: not symmetric about W/2`);
      if (!near(a.top, H / 2 - 4.5, 1e-9) || a.top !== b.top || a.height !== 9 || b.height !== 9) bad.push(`${W}×${H}: top/height`);
      if (a.width < 150) bad.push(`${W}×${H}: ${a.width.toFixed(1)} px < 150`);
    }
  }
  check('D every W 768…3840 × H 600/900/1440: segments from the gutter to 24 px short of the level, symmetric, on the centre line (top H/2 − 4.5, 9 tall), ≥ 150 px',
    bad.length === 0, bad.slice(0, 4).join(' | '));
}

// ── E. Desk geometry ─────────────────────────────────────────────────────────
const A = D.LEVEL_DESK_ANCHORS;
{
  const g = L.levelGeometry(120);
  check('E the 120 anchor row equals levelGeometry(120) field by field', A.widths[0] === 120 && A.bubbleW[0] === g.bubble.w && A.bubbleH[0] === g.bubble.h
    && A.amp[0] === g.amp && A.trackH[0] === g.track.h && A.capH[0] === g.caps!.h && A.stretch === g.stretch && A.squash === g.squash,
  JSON.stringify(A));
  check('E LEVEL_DESK_ANCHORS 240 row: 36 × 13, amp 60, track 4, caps 18; LEVEL_DESK_MAX_W 240', A.widths[1] === 240 && A.bubbleW[1] === 36
    && A.bubbleH[1] === 13 && A.amp[1] === 60 && A.trackH[1] === 4 && A.capH[1] === 18 && D.LEVEL_DESK_MAX_W === 240);
  const just = D.levelGeometryDesk(120.0001);
  check('E continuous past 120 (levelGeometryDesk(120.0001) ≈ levelGeometry(120))', near(just.bubble.w, g.bubble.w, 1e-3) && near(just.amp, g.amp, 1e-3)
    && near(just.boxH, g.boxH, 1e-3) && near(just.caps!.h, g.caps!.h, 1e-3) && near(just.track.h, g.track.h, 1e-3));
}
{
  const bad: string[] = [];
  for (let w = 20; w <= 120; w++) if (JSON.stringify(D.levelGeometryDesk(w)) !== JSON.stringify(L.levelGeometry(w))) bad.push(String(w));
  check('E levelGeometryDesk deep-equals levelGeometry for every integer 20…120', bad.length === 0, bad.join(','));
}
{
  const bad: string[] = [];
  let p = D.levelGeometryDesk(120);
  for (let w = 120; w <= 240; w++) {
    const g = D.levelGeometryDesk(w);
    const inner = g.boxW - g.caps!.w;
    const clear = inner - (g.boxW / 2 + g.amp + g.bubble.w / 2);
    if (clear < 1.5) bad.push(`${w}: clearance ${clear.toFixed(2)} < 1.5`);
    if (clear < 0.1 * w) bad.push(`${w}: clearance ${clear.toFixed(2)} < 10 % of the width`);
    for (const [k, a, b] of [['boxW', p.boxW, g.boxW], ['boxH', p.boxH, g.boxH], ['bubbleW', p.bubble.w, g.bubble.w], ['bubbleH', p.bubble.h, g.bubble.h],
      ['amp', p.amp, g.amp], ['trackH', p.track.h, g.track.h], ['capH', p.caps!.h, g.caps!.h], ['gradH', p.grads!.h, g.grads!.h]] as [string, number, number][]) {
      if (b < a - 1e-9) bad.push(`${w}: ${k} falls ${a} → ${b}`);
    }
    if (!g.caps || !g.grads || g.cls !== 'XL' || g.track.opacity !== 0.25 || g.grads.opacity !== 0.55) bad.push(`${w}: caps / grads / class / opacities`);
    p = g;
  }
  check('E every integer 120…240: MONOTONIC; CLEARANCE ≥ 1.5 px and ≥ 10 % of the width (the bubble never crowds the caps); caps + grads, XL',
    bad.length === 0, bad.slice(0, 4).join(' | '));
}
check('E > 240 clamps to 240', JSON.stringify(D.levelGeometryDesk(300)) === JSON.stringify(D.levelGeometryDesk(240))
  && JSON.stringify(D.levelGeometryDesk(1e6)) === JSON.stringify(D.levelGeometryDesk(240)));
// [w, bubbleW, bubbleH, amp, trackH, capH, gradW, gradH, gradOffset, clearance]
const DESK_ROWS: number[][] = [
  [160, 24, 9, 38.67, 2.67, 12.67, 1.33, 8, 13.76, 26.67],
  [200, 30, 11, 49.33, 3.33, 15.33, 1.67, 10, 17.2, 32.33],
  [240, 36, 13, 60, 4, 18, 2, 12, 20.64, 38],
];
for (const [w, bw, bh, amp, th, ch, gw, gh, off, clr] of DESK_ROWS) {
  const g = D.levelGeometryDesk(w);
  const inner = g.boxW - g.caps!.w;
  const clear = inner - (g.boxW / 2 + g.amp + g.bubble.w / 2);
  const gOff = g.boxW / 2 - (g.grads!.xL + g.grads!.w / 2);
  check(`E the ${w} row: bubble ${bw} × ${bh}, amp ${amp}, track ${th}, caps ${ch}, grads ${gw} × ${gh} at ±${off}, clearance ${clr}`,
    near(g.bubble.w, bw, 0.006) && near(g.bubble.h, bh, 0.006) && near(g.amp, amp, 0.006) && near(g.track.h, th, 0.006)
    && near(g.caps!.h, ch, 0.006) && near(g.grads!.w, gw, 0.006) && near(g.grads!.h, gh, 0.006) && near(gOff, off, 0.006) && near(clear, clr, 0.006),
    JSON.stringify({ b: [g.bubble.w, g.bubble.h], amp: g.amp, th: g.track.h, ch: g.caps!.h, g: [g.grads!.w, g.grads!.h, gOff], clear }));
}
{
  const bad: string[] = [];
  for (let w = 20; w <= 120; w++) {
    for (const t of ['accent', 'onAccent', 'muted', 'splash'] as const) {
      if (JSON.stringify(D.levelPartsDesk(w, t)) !== JSON.stringify(L.levelParts(w, t))) bad.push(`${w} ${t}`);
    }
  }
  for (let w = 240; w <= 640; w++) if (JSON.stringify(D.levelPartsDesk(w, 'splash')) !== JSON.stringify(L.levelParts(w, 'splash'))) bad.push(`${w} splash`);
  check('E levelPartsDesk deep-equals levelParts for 20…120 × 4 tones and for the splash at 240…640', bad.length === 0, bad.slice(0, 6).join(','));
  const p = D.levelPartsDesk(200, 'accent');
  check('E levelPartsDesk(200) maps the desk geometry (box 200 × 15.33, grads, it\'s-level accent)', p.boxW === 200 && near(p.boxH, 15.333, 0.001)
    && p.grads != null && p.hasLvl && p.trackOpacity === 0.25 && p.gradOpacity === 0.55 && p.capOpacity === 1 && !p.splash
    && D.levelPartsDesk(200, 'muted').trackOpacity === 0.3 && D.levelPartsDesk(200, 'onAccent').trackOpacity === 0.35);
}
check('E deskScreenLevelW: phone 64, tablet 160, laptop 200, monitor 240', D.deskScreenLevelW('phone') === 64 && D.deskScreenLevelW('tablet') === 160
  && D.deskScreenLevelW('laptop') === 200 && D.deskScreenLevelW('monitor') === 240);
check('E DESK_SCREEN captions: footnoteEmphasized 12/320, headline 20/480 ×2', D.DESK_SCREEN.tablet.caption === 'footnoteEmphasized'
  && D.DESK_SCREEN.tablet.captionGap === 12 && D.DESK_SCREEN.tablet.captionMaxW === 320 && D.DESK_SCREEN.laptop.caption === 'headline'
  && D.DESK_SCREEN.laptop.captionGap === 20 && D.DESK_SCREEN.laptop.captionMaxW === 480 && D.DESK_SCREEN.monitor.caption === 'headline');
check('E DESK_INLINE_LG = 120 / 160 / 200', D.DESK_INLINE_LG.tablet === 120 && D.DESK_INLINE_LG.laptop === 160 && D.DESK_INLINE_LG.monitor === 200);

// ── F. Source pins ───────────────────────────────────────────────────────────
const HEX = /#[0-9a-fA-F]{3,8}\b/;
{
  const s = code(read('utils/levelDesk.ts'));
  check('F utils/levelDesk.ts imports nothing from react-native', s.length > 0 && !/from ['"]react-native['"]/.test(s) && !/require\(['"]react-native/.test(s));
  check('F utils/levelDesk.ts carries no hex colour (tokens only)', !HEX.test(s), (s.match(HEX) ?? [''])[0]);
}
// Recorded on c5cf89fb (comment-stripped by code() above): a desk override adds no motion of its own.
const BASE_COUNTS: Record<string, { value: number; timing: number; timeout: number; ampRef: string }> = {
  'components/BrandSplash.tsx': { value: 12, timing: 14, timeout: 13, ampRef: 'amp' },
  'components/loaders/BootShell.tsx': { value: 4, timing: 3, timeout: 0, ampRef: 'ampRef.current' },
};
for (const [f, base] of Object.entries(BASE_COUNTS)) {
  const s = code(read(f));
  check(`F ${f}: exactly one deskLaunchLayout(width, height, Platform.OS)`, count(s, 'deskLaunchLayout(width, height, Platform.OS)') === 1);
  check(`F ${f}: the phone expressions stay — splashRect(width, height, Platform.OS) and splashWordmarkBox(rect)`,
    /const rect = splashRect\(width, height, Platform\.OS\);/.test(s) && /splashWordmarkBox\(rect\)/.test(s));
  check(`F ${f}: const markRect = desk ? desk.rect : rect;`, s.includes('const markRect = desk ? desk.rect : rect;'));
  check(`F ${f}: the wordmark box is desk ? desk.wordmarkBox : splashWordmarkBox(rect)`, s.includes('const box = desk ? desk.wordmarkBox : splashWordmarkBox(rect);'));
  check(`F ${f}: the mark View and LevelMark read markRect (left/top/width/height + size)`,
    /left: markRect\.markLeft, top: markRect\.markTop, width: markRect\.markW, height: markRect\.markH/.test(s)
    && /<LevelMark\s+tone="splash"\s+size=\{markRect\.markW\}/.test(s) && !/\brect\.mark(Left|Top|W|H)\b/.test(s.replace(/markRect\./g, 'MR.')));
  // Every DatumSegment lives inside a `{desk && (…)}` group.
  const groups: [number, number][] = [];
  let gi = s.indexOf('{desk && (');
  while (gi >= 0) {
    const open = s.indexOf('(', gi);
    groups.push([open, open + group(s, open).length]);
    gi = s.indexOf('{desk && (', gi + 1);
  }
  const segs = [...s.matchAll(/<DatumSegment\b/g)].map((m) => m.index ?? -1);
  check(`F ${f}: two DatumSegments, both only inside \`desk && (…)\``, segs.length === 2 && segs.every((i) => groups.some(([a, b]) => i > a && i < b)),
    `${segs.length} segments, ${groups.length} desk groups`);
  const drives = [...s.matchAll(/<DatumSegment\b[^>]*?drive=\{([^}]*)\}/g)].map((m) => m[1]);
  check(`F ${f}: the datum's drive is the host's own ${base.ampRef} (no new value)`, drives.length === 2 && drives.every((d) => d === base.ampRef), drives.join(','));
  check(`F ${f}: the datum sits after the ink and before the mark`, segs.length > 0 && s.indexOf(f.includes('Brand') ? 'styles.ink' : 'styles.root') < segs[0]
    && segs[segs.length - 1] < s.indexOf(`testID=${f.includes('Brand') ? '"brand-splash-mark"' : '{`${testID}-mark`}'}`));
  check(`F ${f}: new Animated.Value( count = base ${base.value}`, count(s, 'new Animated.Value(') === base.value, String(count(s, 'new Animated.Value(')));
  check(`F ${f}: Animated.timing( count = base ${base.timing}`, count(s, 'Animated.timing(') === base.timing, String(count(s, 'Animated.timing(')));
  check(`F ${f}: setTimeout( count = base ${base.timeout}`, count(s, 'setTimeout(') === base.timeout, String(count(s, 'setTimeout(')));
  const wmStyle = 'style={desk?.wordmarkLarge ? ls.wordmarkLarge : web ? ls.wordmarkWeb : styles.wordmark}';
  check(`F ${f}: the wordmark style is ONE ternary of whole styles, never an array (an array would change the phone render)`,
    s.includes(wmStyle) && !/\[\s*(styles|ls)\.wordmark\b/.test(s) && !/(styles|ls)\.wordmark(Large|Web)?\s*,\s*\{/.test(s));
  check(`F ${f}: the web wordmarks come from the shared launch styles (const ls = WEB_LAUNCH_STYLES[scheme])`,
    s.includes('const ls = WEB_LAUNCH_STYLES[scheme];') && !/\bwordmark(Large|Web):\s*\{/.test(s));
  check(`F ${f}: no breakpoint hook (useIsDesktop / useResponsiveLayout) — the tier is loaderTier's`, !/useIsDesktop|useResponsiveLayout/.test(s));
  check(`F ${f}: no theme read (it renders outside ThemeProvider)`, !/useTheme/.test(s));
}
{
  const s = code(read('components/loaders/webLaunch.ts'));
  check('F webLaunch.ts: wordmarkLarge = Type.serifLargeTitle, DESK_SPLASH.laptop.tracking, the scheme\'s launch ink, centred',
    /wordmarkLarge:\s*\{\s*\.\.\.Type\.serifLargeTitle,\s*letterSpacing: DESK_SPLASH\.laptop\.tracking,\s*color: c\.fg,\s*textAlign: 'center',?\s*\}/.test(s));
}
{
  const s = code(read('components/loaders/ScreenLoader.tsx'));
  check('F ScreenLoader: const tier = loaderTier(width, Platform.OS)', s.includes('const tier = loaderTier(width, Platform.OS);'));
  const at = s.indexOf("if (tier === 'phone')");
  const ret = at >= 0 ? s.indexOf('return (', at) : -1;
  const phone = ret >= 0 ? group(s, s.indexOf('(', ret)) : '';
  check("F ScreenLoader: the `if (tier === 'phone')` return keeps today's JSX — <LevelMark size={64} …> and the footnote caption",
    phone.includes('<LevelMark size={64} revealDelayMs={revealDelayMs} done={done} exit="settle" onSettled={onSettled} />')
    && phone.includes('Type.footnoteEmphasized, styles.caption') && phone.includes('styles.root, { backgroundColor: colors.bg }, style, { opacity: ground }')
    && !/DatumSegment|desk/.test(phone), phone.slice(0, 120));
  const rest = at >= 0 ? s.slice(at + 'if (tier === \'phone\')'.length + phone.length) : '';
  check('F ScreenLoader: the desk branch passes desk and size={levelW} from deskScreenLevelW(tier)',
    /const levelW = deskScreenLevelW\(tier\);/.test(rest) && /<LevelMark\s+desk\s+size=\{levelW\}/.test(rest));
  check('F ScreenLoader: the desk datum is the theme\'s textMuted at DESK_DATUM.themeOpacity, testIDs -datum-l / -datum-r',
    /color=\{colors\.textMuted\}/.test(rest) && /opacity=\{DESK_DATUM\.themeOpacity\}/.test(rest)
    && rest.includes('testID={`${testID}-datum-l`}') && rest.includes('testID={`${testID}-datum-r`}'));
  check('F ScreenLoader: the desk companions fade with the level (deskFadeStyle)', /deskFadeStyle\(revealDelayMs, done, reduce\)/.test(rest));
  check('F ScreenLoader: every hook is called before the tier branch', at > 0 && ['useTheme()', 'useLevelReveal(revealDelayMs', 'useLevelReveal(0', 'useWindowDimensions()', 'useReducedMotion()']
    .every((h) => { const i = s.indexOf(h); return i > 0 && i < at; }) && !/use[A-Z]\w*\(/.test(rest));
}
for (const f of ['components/loaders/LevelMark.tsx', 'components/loaders/LevelMarkWeb.tsx']) {
  const s = code(read(f));
  check(`F ${f}: parts = desk ? levelPartsDesk(size, tone) : levelParts(size, tone)`, s.includes('desk ? levelPartsDesk(size, tone) : levelParts(size, tone)'));
  check(`F ${f}: desk is an optional prop defaulting to false`, /\bdesk = false,/.test(s));
}
check('F LevelMark.tsx: desk is in the parts useMemo deps', /useMemo\(\(\) => \(desk \? levelPartsDesk\(size, tone\) : levelParts\(size, tone\)\), \[size, tone, desk\]\)/.test(code(read('components/loaders/LevelMark.tsx'))));
check('F LevelMark.tsx: LevelMarkProps gains `desk?: boolean`', /desk\?: boolean;/.test(code(read('components/loaders/LevelMark.tsx'))));
{
  const s = code(read('components/loaders/LevelDatum.tsx'));
  check("F LevelDatum: the left segment pivots on 'right center', the right on 'left center' (it draws OUTWARD, never a bar)",
    /originLeft:\s*\{\s*transformOrigin: 'right center'\s*\}/.test(s) && /originRight:\s*\{\s*transformOrigin: 'left center'\s*\}/.test(s)
    && /left \? styles\.originLeft : styles\.originRight/.test(s) && /const left = side === 'left';/.test(s));
  const keys = [...s.matchAll(/(\w+)\s*:\s*drive\b/g)].map((m) => m[1]);
  check('F LevelDatum: the only animated key is transform scaleX (drive)', keys.length === 1 && keys[0] === 'scaleX' && /transform: \[\{ scaleX: drive \}\]/.test(s), keys.join(','));
  check('F LevelDatum: decorative (hidden from screen readers, no touches), theme-free, no hex',
    /accessibilityElementsHidden/.test(s) && /importantForAccessibility="no-hide-descendants"/.test(s) && /pointerEvents: 'none'/.test(s)
    && !/useTheme/.test(s) && !HEX.test(s));
  check('F LevelDatum: no timing, no value, no timer of its own', !/new Animated\.Value\(|Animated\.(timing|spring|loop)\(|setTimeout|setInterval/.test(s));
}

// ── G. The pre-JS still ──────────────────────────────────────────────────────
const html = read('public/index.html');
const sm = /<style id="mage-prejs-level-css">([\s\S]*?)<\/style>/.exec(html);
check('G the <style id="mage-prejs-level-css"> block exists', !!sm);
/** The dark-page recolour block (rule H pins it; G reads the width rules without it). */
const SCHEME_RE = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g;
if (sm) {
  const css = sm[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(SCHEME_RE, '');
  const media = [...css.matchAll(/@media\s*\(([^)]*)\)\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)];
  check('G exactly three @media blocks', media.length === 3, String(media.length));
  const want: [number, typeof SPLASH.tablet][] = [[768, SPLASH.tablet], [1280, SPLASH.laptop], [1920, SPLASH.monitor]];
  media.forEach((m, i) => {
    const [minW, T] = want[i] ?? [NaN, SPLASH.tablet];
    check(`G @media ${i + 1} is (min-width: ${minW}px)`, m[1].trim() === `min-width: ${minW}px`, m[1]);
    const body = m[2].trim().replace(/\s+/g, ' ');
    const exp = `#mage-prejs-level .mpl-mark { width: clamp(${T.minPx}px, ${Math.round(T.vw * 100)}vw, ${T.maxPx}px); }`;
    check(`G @media ${minW} holds ONLY ${exp}`, body === exp, body);
    check(`G @media ${minW}: no colour, animation or transition`, !/color|#[0-9a-f]{3,8}\b|animation|transition|@keyframes/i.test(body));
  });
  const base = css.replace(/@media\s*\([^)]*\)\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  check('G the base .mpl-mark width is still min(42.7734375vmin, 240px)', /#mage-prejs-level \.mpl-mark \{[^}]*width: min\(42\.7734375vmin, 240px\);/.test(base));
  // The CSS formula (last matching media block, else the base) = launchRect.
  const cssW = (W: number, H: number) => {
    let w = Math.min((42.7734375 / 100) * Math.min(W, H), 240);
    for (const [minW, T] of want) if (W >= minW) w = Math.min(T.maxPx, Math.max(T.minPx, (Math.round(T.vw * 100) / 100) * W));
    return w;
  };
  for (const [W, H] of [[390, 844], [320, 568], [767, 1024], [768, 1024], [1024, 768], [1280, 800], [1440, 900], [1512, 945], [1920, 1080], [2560, 1440], [3440, 1440]]) {
    const r = D.launchRect(W, H, 'web') as Rect;
    const w = cssW(W, H);
    const h = (w * 30) / 438;
    check(`G ${W}×${H}: the CSS mark (${w.toFixed(2)} × ${h.toFixed(2)} at ${(W / 2 - w / 2).toFixed(2)},${(H / 2 - h / 2).toFixed(2)}) = launchRect within 0.05 px`,
      near(w, r.markW, 0.05) && near(h, r.markH, 0.05) && near(W / 2 - w / 2, r.markLeft, 0.05) && near(H / 2 - h / 2, r.markTop, 0.05),
      `${r.markW} × ${r.markH} at ${r.markLeft},${r.markTop}`);
  }
}

// ── H. The web launch is the green brand, and follows light / dark ─────────
{
  const W = D.WEB_LAUNCH;
  const WD = D.WEB_LAUNCH_DARK;
  check('H WEB_LAUNCH = concrete ground (Theme.light.bg), brand green (BRAND_ACCENT), light ink (Theme.light.text)',
    W.bg === C.Theme.light.bg && W.accent === C.BRAND_ACCENT && W.cap === C.Theme.light.text && W.fg === C.Theme.light.text, JSON.stringify(W));
  check('H WEB_LAUNCH_DARK = Theme.dark.bg, BRAND_ACCENT_ON_DARK (what the dark app paints as accent), Theme.dark.text',
    !!WD && WD.bg === C.Theme.dark.bg && WD.accent === C.BRAND_ACCENT_ON_DARK && WD.cap === C.Theme.dark.text && WD.fg === C.Theme.dark.text
    && WD.accent === C.deriveAccentPalette(C.BRAND_ACCENT, 'dark').accent, JSON.stringify(WD));
  // Build 18 bakes the native splash in BRAND_ACCENT_ON_DARK, so the DARK web
  // launch now shares the splash green on purpose; the light launch and the
  // ground still never borrow the native splash.
  check('H the light web launch never borrows the native splash accent or ink', W.accent.toUpperCase() !== L.NATIVE_SPLASH_ACCENT.toUpperCase()
    && W.bg.toUpperCase() !== L.NATIVE_SPLASH_BG.toUpperCase() && !!WD && WD.bg.toUpperCase() !== L.NATIVE_SPLASH_BG.toUpperCase());
  // webLaunchScheme: the data-theme tag wins when it is light / dark, else the OS.
  const SCHEMES: [string | null | undefined, boolean, string][] = [
    [null, false, 'light'], [null, true, 'dark'], [undefined, true, 'dark'], ['', true, 'dark'], ['bogus', false, 'light'],
    ['dark', false, 'dark'], ['dark', true, 'dark'], ['light', true, 'light'], ['light', false, 'light'],
  ];
  const badScheme = SCHEMES.filter(([t, os, want]) => typeof D.webLaunchScheme !== 'function' || D.webLaunchScheme(t, os) !== want);
  check('H webLaunchScheme(tag, osDark): the data-theme tag wins when light / dark, else the OS (the theme-boot resolution)', badScheme.length === 0,
    badScheme.map(([t, os]) => `${String(t)}/${os}`).join(','));
  check('H webLaunchColors: light (and the default) → WEB_LAUNCH, dark → WEB_LAUNCH_DARK',
    D.webLaunchColors() === W && D.webLaunchColors('light') === W && D.webLaunchColors('dark') === WD);
  check('H webLaunchHue: the scheme\'s accent of the default brand (light → WEB_LAUNCH.accent, dark → WEB_LAUNCH_DARK.accent)',
    D.webLaunchHue() === W.accent && D.webLaunchHue('light') === W.accent && D.webLaunchHue('dark') === WD.accent);
  for (const [scheme, X] of [['light', W], ['dark', WD]] as const) {
    const p = scheme === 'light' ? D.webLaunchPalette() : D.webLaunchPalette(undefined, scheme);
    check(`H webLaunchPalette(${scheme}): bubble / track / beat / lvl the scheme's green, caps + grads its ink; a passed colour overrides the bubble only`,
      p.bubble === X.accent && p.track === X.accent && p.beat === X.accent && p.lvl === X.accent && p.cap === X.cap && p.grad === X.cap
      && D.webLaunchPalette('X', scheme).bubble === 'X' && D.webLaunchPalette('X', scheme).track === X.accent, JSON.stringify(p));
  }
  const brand = code(read('components/BrandSplash.tsx'));
  const boot = code(read('components/loaders/BootShell.tsx'));
  const web = code(read('components/loaders/LevelMarkWeb.tsx'));
  const native = code(read('components/loaders/LevelMark.tsx'));
  const wl = code(read('components/loaders/webLaunch.ts'));
  const SCHEME_READ = "const [scheme] = useState<LaunchScheme>(() => (web ? readWebLaunchScheme() : 'light'));";
  for (const [f, s] of [['BrandSplash', brand], ['BootShell', boot]] as const) {
    check(`H ${f}: const web = Platform.OS === 'web'; the scheme is read ONCE and only on the web; launch = webLaunchColors(scheme); ls = WEB_LAUNCH_STYLES[scheme]`,
      s.includes("const web = Platform.OS === 'web';") && count(s, SCHEME_READ) === 1 && count(s, 'readWebLaunchScheme(') === 1
      && s.includes('const launch = webLaunchColors(scheme);') && s.includes('const ls = WEB_LAUNCH_STYLES[scheme];'));
    check(`H ${f}: the web hue is the scheme's accent`,
      s.includes('const liveHue = web ? webLaunchHue(scheme) : deriveAccentPalette(getCustomPrimary(), \'dark\').accent;'));
    check(`H ${f}: the desk datum is the scheme's launch ink at DESK_DATUM.splashOpacity`,
      (s.match(/color=\{launch\.cap\} opacity=\{DESK_DATUM\.splashOpacity\}/g) ?? []).length === 2);
    check(`H ${f}: no WEB_LAUNCH literal palette read directly (every colour goes through the scheme)`, !/\bWEB_LAUNCH(_DARK)?\./.test(s));
  }
  check('H BrandSplash: the ink is web ? ls.ink : styles.ink; the hue shifts only when it differs from the scheme\'s launch green',
    brand.includes('web ? ls.ink : styles.ink, { opacity: inkOpacity }')
    && brand.includes('const hueShift = web ? liveHue.toUpperCase() !== launch.accent.toUpperCase() : liveHue.toUpperCase() !== NATIVE_SPLASH_ACCENT;'));
  check('H BootShell: the root is web ? ls.root : styles.root', boot.includes('style={web ? ls.root : styles.root}'));
  check('H native untouched: BrandSplash styles.ink = NATIVE_SPLASH_BG, BootShell styles.root = NATIVE_SPLASH_BG, both wordmarks NATIVE_SPLASH_FG',
    /\bink:\s*\{\s*backgroundColor: NATIVE_SPLASH_BG,?\s*\}/.test(brand) && /\broot:\s*\{\s*flex: 1, backgroundColor: NATIVE_SPLASH_BG\s*\}/.test(boot)
    && [brand, boot].every((s) => /\bwordmark:\s*\{[^}]*color: NATIVE_SPLASH_FG,/.test(s)));
  check('H LevelMarkWeb: the splash tone reads the scheme once per mount and draws webLaunchPalette(color, launchScheme) (the token tones keep levelPalette)',
    web.includes("const [launchScheme] = useState<LaunchScheme>(() => (splash ? readWebLaunchScheme() : 'light'));")
    && web.includes('const pal = splash ? webLaunchPalette(color, launchScheme) : levelPalette(tone, color, colors);'));
  check('H native LevelMark.tsx never reads the web launch (no webLaunch / readWebLaunchScheme / webLaunchPalette)',
    native.length > 0 && !/webLaunch|readWebLaunchScheme|WEB_LAUNCH/.test(native));
  check('H webLaunch.ts: readWebLaunchScheme = webLaunchScheme(the data-theme tag, matchMedia prefers-color-scheme: dark), light when unreadable',
    /document\.documentElement\.getAttribute\('data-theme'\)/.test(wl) && /window\.matchMedia\('\(prefers-color-scheme: dark\)'\)\.matches/.test(wl)
    && /return webLaunchScheme\(tag, osDark\);/.test(wl) && /catch\s*\{\s*return 'light';\s*\}/.test(wl));
  check('H webLaunch.ts: WEB_LAUNCH_STYLES = { light: launchStyles(WEB_LAUNCH), dark: launchStyles(WEB_LAUNCH_DARK) }; ink / root = c.bg; wordmarkWeb = Type.serifTitle, 3.4, c.fg; no hex',
    wl.includes('WEB_LAUNCH_STYLES = { light: launchStyles(WEB_LAUNCH), dark: launchStyles(WEB_LAUNCH_DARK) }')
    && /\bink:\s*\{\s*backgroundColor: c\.bg\s*\}/.test(wl) && /\broot:\s*\{\s*flex: 1, backgroundColor: c\.bg\s*\}/.test(wl)
    && /wordmarkWeb:\s*\{\s*\.\.\.Type\.serifTitle,\s*letterSpacing: 3\.4,\s*color: c\.fg,\s*textAlign: 'center',?\s*\}/.test(wl) && !HEX.test(wl));
  if (sm) {
    const css = sm[1].replace(/\/\*[\s\S]*?\*\//g, '');
    /** Flat `selector { decls }` rules, whitespace-normalised. */
    const flatRules = (src: string) => [...src.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
      sel: m[1].trim().replace(/\s+/g, ' '), body: m[2].trim().replace(/\s+/g, ' ').replace(/;$/, ''),
    }));
    const schemeBlocks = [...css.matchAll(SCHEME_RE)];
    const outside = css.replace(SCHEME_RE, '').replace(/@media\s*\([^)]*\)\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    const TAG = "html[data-theme='dark']";
    const tagRules = flatRules(outside).filter((r) => r.sel.startsWith(TAG));
    const lightRules = flatRules(outside).filter((r) => !r.sel.startsWith('html['));
    const darkWant = (pre: string) => [
      { sel: `${pre} #mage-prejs-level`, body: `background-color: ${WD.bg}` },
      { sel: `${pre} #mage-prejs-level .mpl-cap-l, ${pre} #mage-prejs-level .mpl-cap-r`, body: `background-color: ${WD.cap}` },
      { sel: `${pre} #mage-prejs-level .mpl-track, ${pre} #mage-prejs-level .mpl-bubble`, body: `background-color: ${WD.accent}` },
    ];
    const same = (got: { sel: string; body: string }[], want: { sel: string; body: string }[]) => got.length === want.length
      && got.every((g, i) => g.sel === want[i].sel && g.body.toLowerCase() === want[i].body.toLowerCase());
    check('H the pre-JS still has exactly one @media (prefers-color-scheme: dark) block', schemeBlocks.length === 1, String(schemeBlocks.length));
    const mediaRules = schemeBlocks.length === 1 ? flatRules(schemeBlocks[0][1]) : [];
    check("H the dark @media block = html:not([data-theme='light']) ground Theme.dark.bg, caps Theme.dark.text, track + bubble BRAND_ACCENT_ON_DARK — background-color only",
      same(mediaRules, darkWant("html:not([data-theme='light'])")), JSON.stringify(mediaRules));
    check("H the html[data-theme='dark'] rules = the same three recolours (an explicit in-app dark choice on a light OS is dark too)",
      same(tagRules, darkWant(TAG)), JSON.stringify(tagRules));
    check('H every html[…] rule is a dark recolour: no other tagged rule, no geometry or opacity in any of them',
      flatRules(outside).filter((r) => r.sel.startsWith('html[')).length === 3
      && [...mediaRules, ...tagRules].every((r) => /^background-color: #[0-9a-fA-F]{6}$/.test(r.body)));
    const hexOf = (rules: { body: string }[]) => rules.flatMap((r) => [...r.body.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toUpperCase()));
    const lightHex = hexOf(lightRules);
    const allowed = new Set([W.bg, W.accent, W.cap].map((x: string) => x.toUpperCase()));
    check('H the light still paints only the web launch tokens (concrete, brand green, light ink) — no orange, no ink ground',
      lightHex.length > 0 && lightHex.every((x) => allowed.has(x)) && !lightHex.includes(L.NATIVE_SPLASH_ACCENT.toUpperCase()), lightHex.join(','));
    const darkHex = hexOf([...mediaRules, ...tagRules]);
    const allowedDark = new Set([WD.bg, WD.accent, WD.cap].map((x: string) => x.toUpperCase()));
    check('H the dark rules paint only WEB_LAUNCH_DARK tokens — never the light ground or the light-only brand green',
      darkHex.length === 6 && darkHex.every((x) => allowedDark.has(x)), darkHex.join(','));
    const allHex = [...css.matchAll(/#[0-9a-fA-F]{6}\b/g)].length;
    check('H every colour in the still is accounted for (light rules + dark recolours)', allHex === lightHex.length + darkHex.length, `${allHex} vs ${lightHex.length}+${darkHex.length}`);
  }
}

if (failures > 0) {
  console.error(`\nvalidate-level-desk: ${failures} failed, ${passes} passed`);
  process.exit(1);
}
console.info(`validate-level-desk: all ${passes} checks passed`);
